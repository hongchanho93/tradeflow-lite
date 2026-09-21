use super::{access::{RootGrant, relative_path, MAX_CHUNK_BYTES, MAX_DIRECTORY_PAGE}, library::{Library, SourceInfo, token}};
use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashMap, fs, path::Path, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, time::{Duration, Instant}};
use tauri::{AppHandle, Manager};

pub const IO_SLOTS: usize = 4;
const IO_DEADLINE: Duration = Duration::from_secs(30);
fn ensure_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "data_storage_failed".into())
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum FileOperation {
    List { path: String, after: Option<String>, limit: usize },
    Read { path: String, offset: u64, length: usize, file_revision: Option<String> },
    Sqlite { path: String, sql: String, parameters: Vec<Value>, limit: usize, file_revision: Option<String> },
    Parquet { path: String, offset: u64, limit: usize, columns: Option<Vec<String>>, file_revision: Option<String> },
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataRequest { pub source_id: String, pub revision: String, pub request: FileOperation }
#[derive(Default)]
struct Inner { library: Option<Library>, epoch: u64, picker: Option<String> }
#[derive(Default, Clone)]
pub struct UserDataState { inner: Arc<Mutex<Inner>>, jobs: Arc<Mutex<HashMap<String, Arc<Job>>>>, epoch: Arc<AtomicU64> }
pub(super) struct Job { request: FileOperation, root: RootGrant, pub(super) cancelled: AtomicBool, started: AtomicBool, pub(super) deadline: Instant, epoch: u64, lifecycle: Arc<AtomicU64> }
pub struct IoLease { id: String, pub(super) job: Arc<Job>, state: UserDataState }
pub struct PickerLease { id: String, epoch: u64, replacement: Option<(String, String)>, state: UserDataState }
impl UserDataState {
    pub fn epoch(&self) -> u64 { self.epoch.load(Ordering::Acquire) }
    pub fn initialize(&self, app: &AppHandle, expected: u64) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "data_unavailable")?;
        if self.epoch() != expected { return Err("data_cancelled".into()); }
        if inner.epoch == expected && inner.library.is_some() { return Ok(()); }
        inner.library.take(); inner.picker = None; inner.epoch = expected;
        let data = app.path().app_data_dir().map_err(|_| "data_storage_failed")?;
        // The old identifier-scoped user-data storage implicitly created this
        // parent. Stable workspace storage lives elsewhere, but protected-root
        // identity checks still require the app-data directory to exist.
        ensure_directory(&data)?;
        let legacy_storage = data.join("user-data-v1");
        let storage = crate::workspace_state::product_data_dir()?.join("user-data-v1");
        // One-time migration from the old identifier-scoped app-data location.
        // Only the app-owned connection record is copied; user market files are
        // never copied or rewritten.
        let stable_record = storage.join("connections.json");
        let legacy_record = legacy_storage.join("connections.json");
        if !stable_record.exists() && legacy_record.is_file() {
            fs::create_dir_all(&storage).map_err(|_| "data_storage_failed")?;
            fs::copy(&legacy_record, &stable_record).map_err(|_| "data_storage_failed")?;
        }
        let mut protected = vec![data, crate::workspace_state::product_data_dir()?];
        if let Ok(exe) = std::env::current_exe() { if let Some(parent) = exe.parent() { protected.push(parent.into()); } }
        if let Ok(resources) = app.path().resource_dir() { if resources.is_dir() { protected.push(resources); } }
        let library = Library::open(&storage, protected)?;
        if self.epoch() != expected { return Err("data_cancelled".into()); }
        inner.library = Some(library); Ok(())
    }
    pub fn with_library<T>(&self, expected: u64, run: impl FnOnce(&mut Library) -> Result<T, String>) -> Result<T, String> {
        let mut inner = self.inner.lock().map_err(|_| "data_unavailable")?;
        if self.epoch() != expected || inner.epoch != expected { return Err("data_cancelled".into()); }
        run(inner.library.as_mut().ok_or("data_not_ready")?)
    }
    pub fn reserve(&self, input: DataRequest) -> Result<String, String> {
        input.request.validate()?;
        let epoch = self.epoch();
        let root = self.with_library(epoch, |library| library.grant(&input.source_id, &input.revision))?;
        let id = token()?;
        let mut jobs = self.jobs.lock().map_err(|_| "data_unavailable")?;
        jobs.retain(|_, job| job.started.load(Ordering::Acquire) || job.check().is_ok());
        if self.epoch() != epoch || root.is_revoked() { return Err("data_cancelled".into()); }
        if jobs.len() >= IO_SLOTS { return Err("data_busy".into()); }
        if jobs.contains_key(&id) { return Err("data_conflict".into()); }
        jobs.insert(id.clone(), Arc::new(Job { request: input.request, root, cancelled: AtomicBool::new(false),
            started: AtomicBool::new(false), deadline: Instant::now() + IO_DEADLINE, epoch, lifecycle: self.epoch.clone() }));
        Ok(id)
    }
    pub fn start(&self, id: &str) -> Result<IoLease, String> {
        let jobs = self.jobs.lock().map_err(|_| "data_unavailable")?;
        let job = jobs.get(id).cloned().ok_or("data_request_closed")?; job.check()?;
        if job.started.swap(true, Ordering::AcqRel) { return Err("data_conflict".into()); }
        Ok(IoLease { id: id.into(), job, state: self.clone() })
    }
    pub fn cancel(&self, id: &str) {
        if let Ok(mut jobs) = self.jobs.lock() { if let Some(job) = jobs.get(id) {
            job.cancelled.store(true, Ordering::Release);
            // A running filesystem operation owns its capacity until real exit.
            if !job.started.load(Ordering::Acquire) { jobs.remove(id); }
        } }
    }
    pub fn reset(&self) {
        let epoch = self.epoch.fetch_add(1, Ordering::AcqRel).wrapping_add(1);
        if let Ok(mut jobs) = self.jobs.lock() {
            for job in jobs.values() { job.cancelled.store(true, Ordering::Release); }
            jobs.retain(|_, job| job.started.load(Ordering::Acquire));
        }
        // Window callbacks must not wait for a slow disk. An in-flight library
        // operation serializes before the next initialized generation; old I/O
        // delivery and late picker callbacks are revoked immediately above.
        if let Ok(mut inner) = self.inner.try_lock() { inner.library.take(); inner.epoch = epoch; inner.picker = None; }
    }
    pub fn begin_picker(&self, replacement_id: Option<String>) -> Result<PickerLease, String> {
        let mut inner = self.inner.lock().map_err(|_| "data_unavailable")?; let epoch = self.epoch();
        if inner.epoch != epoch { return Err("data_cancelled".into()); }
        if inner.picker.is_some() { return Err("data_busy".into()); }
        let library = inner.library.as_ref().ok_or("data_not_ready")?;
        let replacement = if let Some(id) = replacement_id {
            let info = library.list().into_iter().find(|s| s.id == id).ok_or("data_unavailable")?;
            Some((id, info.revision))
        } else { None };
        let id = token()?; inner.picker = Some(id.clone());
        Ok(PickerLease { id, epoch, replacement, state: self.clone() })
    }
}
impl FileOperation {
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Sqlite { path, sql, parameters, limit, file_revision } => {
                relative_path(path, false).map_err(|e| e.code())?;
                if sql.is_empty() || sql.len()>32768 || sql.contains('\0') || parameters.len()>128 || *limit==0 || *limit>super::formats::MAX_ROWS
                    || file_revision.as_ref().is_some_and(|s| s.is_empty() || s.len()>256)
                    || parameters.iter().any(|v| match v { Value::Null=>false, Value::String(s)=>s.len()>16384,
                        Value::Number(n)=>n.as_f64().is_none_or(|v|!v.is_finite()||(v.fract()==0.0&&v.abs()>9_007_199_254_740_991.0)), _=>true }) {
                    return Err("data_invalid_io".into());
                }
            }
            Self::Parquet { path, offset, limit, columns, file_revision } => {
                relative_path(path, false).map_err(|e| e.code())?;
                if *offset>9_007_199_254_740_991 || *limit>super::formats::MAX_ROWS
                    || file_revision.as_ref().is_some_and(|s|s.is_empty()||s.len()>256)
                    || columns.as_ref().is_some_and(|c| c.is_empty()||c.len()>super::formats::MAX_COLUMNS
                        || c.iter().any(|s|s.is_empty()||s.len()>256)||c.iter().collect::<std::collections::HashSet<_>>().len()!=c.len()) {
                    return Err("data_invalid_io".into());
                }
            }
            Self::List { path, after, limit } => {
                relative_path(path, true).map_err(|e| e.code())?;
                if *limit == 0 || *limit > MAX_DIRECTORY_PAGE || after.as_ref().is_some_and(|s| s.len() > 4096) { return Err("data_budget_exceeded".into()); }
            }
            Self::Read { path, offset, length, file_revision } => {
                relative_path(path, false).map_err(|e| e.code())?;
                if *length == 0 || *length > MAX_CHUNK_BYTES || *offset > 9_007_199_254_740_991
                    || file_revision.as_ref().is_some_and(|s| s.len() > 256) { return Err("data_budget_exceeded".into()); }
            }
        } Ok(())
    }
}
impl Job {
    pub(super) fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) || self.lifecycle.load(Ordering::Acquire) != self.epoch { return Err("data_cancelled".into()); }
        if self.root.is_revoked() { return Err("data_revoked".into()); }
        if Instant::now() >= self.deadline { return Err("data_timeout".into()); } Ok(())
    }
}
impl Drop for IoLease {
    fn drop(&mut self) { if let Ok(mut jobs) = self.state.jobs.lock() {
        if jobs.get(&self.id).is_some_and(|j| Arc::ptr_eq(j, &self.job)) { jobs.remove(&self.id); }
    } }
}
impl IoLease {
    pub fn execute(self) -> Result<Value, String> {
        self.job.check()?;
        let result = match &self.job.request {
            FileOperation::Sqlite {..} | FileOperation::Parquet {..} => {
                let job = self.job.clone();
                return super::formats::execute(&self.job.root, &self.job.request, Arc::new(move || job.check()));
            }
            FileOperation::Read { path, offset, length, file_revision } => serde_json::to_value(self.job.root.read(path, *offset, *length, file_revision.as_deref(), &self.job.cancelled).map_err(|e| e.code())?),
            FileOperation::List { path, after, limit } => serde_json::to_value(self.job.root.list(path, after.as_deref(), *limit, &self.job.cancelled).map_err(|e| e.code())?),
        }.map_err(|_| "data_invalid_output")?;
        self.job.check()?; Ok(result)
    }
}
impl Drop for PickerLease {
    fn drop(&mut self) { if let Ok(mut inner) = self.state.inner.lock() {
        if inner.picker.as_deref() == Some(self.id.as_str()) { inner.picker = None; }
    } }
}
impl PickerLease {
    /// Only the native system picker callback (or test-owned fixture) supplies a path.
    pub fn complete(self, path: Option<&Path>) -> Result<Option<SourceInfo>, String> {
        if self.state.epoch() != self.epoch { return Err("data_cancelled".into()); }
        let root = path.map(RootGrant::select).transpose().map_err(|e| e.code())?;
        let mut inner = self.state.inner.lock().map_err(|_| "data_unavailable")?;
        if self.state.epoch() != self.epoch || inner.epoch != self.epoch || inner.picker.as_deref() != Some(self.id.as_str()) { return Err("data_cancelled".into()); }
        let Some(root) = root else { return Ok(None); };
        let replacement = self.replacement.as_ref().map(|(id, revision)| (id.as_str(), revision.as_str()));
        inner.library.as_mut().ok_or("data_not_ready")?.select(root, replacement).map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};
    struct Fixture { directory: PathBuf, state: UserDataState, info: SourceInfo }
    impl Fixture {
        fn new() -> Self {
            let directory = std::env::temp_dir().join(format!("tf-data-state-{}", super::super::library::token().unwrap()));
            fs::create_dir_all(directory.join("data")).unwrap(); fs::write(directory.join("data/a"), b"hello").unwrap();
            let mut library = Library::open(&directory.join("store"), Vec::new()).unwrap();
            let info = library.select(RootGrant::select(&directory.join("data")).unwrap(), None).unwrap();
            let state = UserDataState::default(); state.inner.lock().unwrap().library = Some(library);
            Self { directory, state, info }
        }
        fn request(&self) -> DataRequest { DataRequest { source_id: self.info.id.clone(), revision: self.info.revision.clone(),
            request: FileOperation::Read { path: "a".into(), offset: 0, length: 20, file_revision: None } } }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.directory); } }
    #[test]
    fn protected_application_directory_is_created_before_identity_checks() {
        let directory = std::env::temp_dir()
            .join(format!("tf-data-protected-{}", super::super::library::token().unwrap()))
            .join("missing");
        assert!(!directory.exists());
        ensure_directory(&directory).unwrap();
        assert!(directory.is_dir());
        let _ = fs::remove_dir_all(directory.parent().unwrap());
    }
    #[test]
    fn reserved_read_executes_only_once_and_returns_selected_bytes() {
        let f = Fixture::new(); let id = f.state.reserve(f.request()).unwrap(); let lease = f.state.start(&id).unwrap();
        assert!(f.state.start(&id).is_err()); assert_eq!(lease.execute().unwrap()["data"], serde_json::json!([104,101,108,108,111]));
        assert!(f.state.start(&id).is_err());
    }
    #[test]
    fn cancel_before_execute_closes_the_reserved_request() {
        let f = Fixture::new(); let id = f.state.reserve(f.request()).unwrap(); f.state.cancel(&id); assert!(f.state.start(&id).is_err());
    }
    #[test]
    fn cancelled_active_io_retains_capacity_until_actual_exit() {
        let f = Fixture::new(); let mut leases = Vec::new();
        for _ in 0..IO_SLOTS { let id = f.state.reserve(f.request()).unwrap(); leases.push(f.state.start(&id).unwrap()); f.state.cancel(&id); }
        assert_eq!(f.state.reserve(f.request()).unwrap_err(), "data_busy");
        assert!(leases.pop().unwrap().execute().is_err()); assert!(f.state.reserve(f.request()).is_ok());
    }
    #[test]
    fn page_reset_invalidates_existing_jobs_and_late_picker_results() {
        let f = Fixture::new(); let id = f.state.reserve(f.request()).unwrap(); let lease = f.state.start(&id).unwrap(); let picker = f.state.begin_picker(None).unwrap();
        f.state.reset(); assert!(lease.execute().is_err()); assert!(picker.complete(Some(&f.directory.join("data"))).is_err());
    }
    #[test]
    fn cancelled_picker_creates_no_grant_and_releases_picker_slot() {
        let f = Fixture::new(); let picker = f.state.begin_picker(None).unwrap(); assert!(f.state.begin_picker(None).is_err());
        assert!(picker.complete(None).unwrap().is_none()); assert!(f.state.begin_picker(None).is_ok());
        assert_eq!(f.state.inner.lock().unwrap().library.as_ref().unwrap().list().len(), 1);
    }
    #[test]
    fn unknown_grants_and_path_strings_are_not_authority() {
        let f = Fixture::new(); let mut request = f.request(); request.source_id = f.directory.to_string_lossy().into_owned();
        assert!(f.state.reserve(request).is_err()); let mut request = f.request(); request.revision = "old".into(); assert!(f.state.reserve(request).is_err());
        assert!(serde_json::from_value::<DataRequest>(serde_json::json!({"path":"/tmp"})).is_err());
        assert!(serde_json::from_value::<FileOperation>(serde_json::json!({"operation":"read","path":"a","offset":0,"length":10,"grant":"/tmp"})).is_err());
    }
    #[test]
    fn disabling_after_reservation_revokes_the_captured_directory_handle() {
        let f = Fixture::new(); let id = f.state.reserve(f.request()).unwrap();
        let mut inner = f.state.inner.lock().unwrap(); let library = inner.library.as_mut().unwrap();
        let ticket = library.prepare(&f.info.id, &f.info.revision, super::super::library::Change::Enabled { enabled: false }).unwrap();
        library.commit(&ticket.ticket_id).unwrap(); library.finish(&ticket.ticket_id); drop(inner);
        assert!(f.state.start(&id).and_then(IoLease::execute).is_err());
    }

    /// Explicit local integration fixture only. Not compiled into the app or
    /// exposed as Tauri/MCP: the protocol can access only files created here.
    #[test]
    #[ignore = "explicit native binary/Worker integration bridge"]
    fn format_bridge() {
        use std::io::{BufRead, Write};
        let f=Fixture::new();super::super::formats::tests::write_examples(&f.directory.join("data"));
        println!("TF_FORMAT_READY {}",serde_json::to_string(&f.info).unwrap());std::io::stdout().flush().unwrap();
        for line in std::io::stdin().lock().lines() {
            let line=line.unwrap();if line.len()>1024*1024{break;}
            let input:Value=serde_json::from_str(&line).unwrap();let id=input["id"].clone();
            let command=input["command"].as_str().unwrap_or("");let args=&input["args"];
            if command=="quit"{break;}
            let string=|name:&str|args[name].as_str().map(str::to_owned).ok_or_else(||"data_invalid_request".to_string());
            let run=||->Result<Value,String>{
                if command=="test_fixtures"{
                    return Ok(serde_json::json!(["market.db","SH_600000.parquet","SZ_000001.parquet"].iter().map(|name|
                        serde_json::json!({"name":name,"data":fs::read(f.directory.join("data").join(name)).unwrap()})).collect::<Vec<_>>()));
                }
                if command=="test_restart"{
                    f.state.reset();let mut inner=f.state.inner.lock().unwrap();inner.epoch=f.state.epoch();
                    inner.library=Some(Library::open(&f.directory.join("store"),Vec::new())?);
                    return serde_json::to_value(inner.library.as_ref().unwrap().list()).map_err(|_|"data_invalid_output".into());
                }
                match command {
                    "user_data_begin"=>Ok(Value::String(f.state.reserve(serde_json::from_value(args["input"].clone()).map_err(|_|"data_invalid_request")?)?)),
                    "user_data_execute"=>f.state.start(&string("requestId")?)?.execute(),
                    "user_data_cancel"=>{f.state.cancel(&string("requestId")?);Ok(Value::Null)},
                    _=>f.state.with_library(f.state.epoch(),|library|{
                        let value=match command{
                            "user_data_list"=>serde_json::to_value(library.list()),
                            "user_data_source"=>serde_json::to_value(library.source(&string("sourceId")?,&string("revision")?)?),
                            "user_data_prepare"=>serde_json::to_value(library.prepare(&string("sourceId")?,&string("revision")?,serde_json::from_value(args["change"].clone()).map_err(|_|"data_invalid_request")?)?),
                            "user_data_commit"=>serde_json::to_value(library.commit(&string("ticketId")?)?),
                            "user_data_rollback"=>{library.rollback(&string("ticketId")?)?;Ok(Value::Null)},
                            "user_data_finish"=>{library.finish(&string("ticketId")?);Ok(Value::Null)},
                            _=>return Err("data_invalid_request".into()),
                        };value.map_err(|_|"data_invalid_output".into())
                    }),
                }
            };
            let output=match run(){Ok(value)=>serde_json::json!({"id":id,"value":value}),Err(code)=>serde_json::json!({"id":id,"error":code})};
            println!("TF_FORMAT_REPLY {}",output);std::io::stdout().flush().unwrap();
        }
    }
}
