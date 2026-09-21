//! Native-owned grants and connector records. Only fixed application storage is
//! written. User data files are never modified by a library operation.
use super::access::{RootGrant, SavedRoot};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::{Read, Write}, path::{Path, PathBuf}, time::{Duration, Instant}};

pub const MAX_SOURCE_BYTES: usize = 256 * 1024;
const MAX_SOURCES: usize = 128;
const MAX_STORE_BYTES: usize = 36 * 1024 * 1024;
const MAX_MUTATIONS: usize = 4;
const MUTATION_TTL: Duration = Duration::from_secs(300);
pub fn token() -> Result<String, String> {
    let mut bytes = [0u8; 16]; getrandom::fill(&mut bytes).map_err(|_| "data_random_unavailable")?;
    Ok(bytes.iter().map(|v| format!("{v:02x}")).collect())
}
fn valid_id(id: &str) -> bool { id.len() == 32 && id.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo { pub id: String, pub name: String, pub revision: String, pub state: String, pub has_connector: bool }
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Change { Connector { source: Option<String> }, Enabled { enabled: bool }, Remove }
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeReceipt { pub source_id: String, pub revision: String, pub state: String }
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedChange { pub ticket_id: String, pub result: ChangeReceipt }

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedSource { id: String, name: String, enabled: bool, root: SavedRoot, source: Option<String> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedLibrary { version: u8, records: Vec<SavedSource> }
struct MountedSource { saved: SavedSource, revision: String, grant: Option<RootGrant> }
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage { Prepared, Committed, RolledBack }
struct Mutation {
    previous: SavedSource, next: Option<SavedSource>, next_grant: Option<RootGrant>,
    prepared: PreparedChange, stage: Stage, deadline: Instant,
}
pub struct Library {
    storage: PathBuf, protected: Vec<PathBuf>, records: BTreeMap<String, MountedSource>,
    mutations: BTreeMap<String, Mutation>,
}
impl Drop for Library {
    fn drop(&mut self) { for item in self.records.values() { if let Some(grant) = &item.grant { grant.revoke(); } } }
}
impl MountedSource {
    fn info(&self) -> SourceInfo {
        SourceInfo { id: self.saved.id.clone(), name: self.saved.name.clone(), revision: self.revision.clone(),
            state: if !self.saved.enabled { "disabled" } else if self.grant.is_some() { "ready" } else { "needs_directory" }.into(),
            has_connector: self.saved.source.is_some() }
    }
}
impl Library {
    pub fn open(storage: &Path, mut protected: Vec<PathBuf>) -> Result<Self, String> {
        fs::create_dir_all(storage).map_err(|_| "data_storage_failed")?;
        let storage = fs::canonicalize(storage).map_err(|_| "data_storage_failed")?;
        protected.push(storage.clone());
        let saved = match fs::File::open(storage.join("connections.json")) {
            Ok(file) => {
                let mut bytes = Vec::new(); file.take((MAX_STORE_BYTES + 1) as u64).read_to_end(&mut bytes).map_err(|_| "data_storage_failed")?;
                if bytes.len() > MAX_STORE_BYTES { return Err("data_storage_invalid".into()); }
                serde_json::from_slice::<SavedLibrary>(&bytes).map_err(|_| "data_storage_invalid")?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => SavedLibrary { version: 1, records: Vec::new() },
            Err(_) => return Err("data_storage_failed".into()),
        };
        if saved.version != 1 || saved.records.len() > MAX_SOURCES { return Err("data_storage_invalid".into()); }
        let mut library = Self { storage, protected, records: BTreeMap::new(), mutations: BTreeMap::new() };
        for record in saved.records {
            if !valid_id(&record.id) || record.name.is_empty() || record.name.chars().count() > 128
                || record.source.as_ref().is_some_and(|s| s.len() > MAX_SOURCE_BYTES) || library.records.contains_key(&record.id) {
                return Err("data_storage_invalid".into());
            }
            let grant = library.restore(&record);
            library.records.insert(record.id.clone(), MountedSource { saved: record, revision: token()?, grant });
        }
        Ok(library)
    }
    fn allowed_root(&self, root: &RootGrant) -> Result<(), String> {
        for path in &self.protected {
            if root.contains_protected(path).map_err(|e| e.code())? { return Err("data_scope_too_broad".into()); }
        }
        Ok(())
    }
    fn restore(&self, record: &SavedSource) -> Option<RootGrant> {
        if !record.enabled { return None; }
        let root = RootGrant::restore(&record.root).ok()?;
        self.allowed_root(&root).ok()?; Some(root)
    }
    fn get(&self, id: &str, revision: &str) -> Result<&MountedSource, String> {
        let source = self.records.get(id).ok_or("data_unavailable")?;
        if source.revision != revision { return Err("data_conflict".into()); }
        Ok(source)
    }
    fn prune(&mut self) { self.mutations.retain(|_, t| t.deadline > Instant::now()); }
    fn busy(&self, id: &str) -> bool { self.mutations.values().any(|t| t.previous.id == id) }
    pub fn list(&self) -> Vec<SourceInfo> { self.records.values().map(MountedSource::info).collect() }
    pub fn select(&mut self, root: RootGrant, replacement: Option<(&str, &str)>) -> Result<SourceInfo, String> {
        self.prune(); self.allowed_root(&root)?;
        root.check(&std::sync::atomic::AtomicBool::new(false)).map_err(|e| e.code())?;
        let previous = if let Some((id, revision)) = replacement {
            if self.busy(id) { return Err("data_busy".into()); }
            Some(self.get(id, revision)?.saved.clone())
        } else { None };
        if previous.is_none() && self.records.len() >= MAX_SOURCES { return Err("data_budget_exceeded".into()); }
        let id = match &previous { Some(previous) => previous.id.clone(), None => token()? };
        if previous.is_none() && self.records.contains_key(&id) { return Err("data_conflict".into()); }
        let record = SavedSource { id: id.clone(), name: root.name().chars().take(128).collect(), enabled: true,
            root: root.saved(), source: previous.and_then(|p| p.source) };
        let mounted = MountedSource { saved: record, revision: token()?, grant: Some(root) };
        self.persist(&id, Some(&mounted.saved))?;
        self.replace(&id, Some(mounted)); Ok(self.records[&id].info())
    }
    pub fn grant(&self, id: &str, revision: &str) -> Result<RootGrant, String> {
        let entry = self.get(id, revision)?;
        if !entry.saved.enabled { return Err("data_revoked".into()); }
        entry.grant.clone().ok_or_else(|| "data_root_changed".into())
    }
    pub fn source(&self, id: &str, revision: &str) -> Result<Option<String>, String> { Ok(self.get(id, revision)?.saved.source.clone()) }
    pub fn prepare(&mut self, id: &str, revision: &str, change: Change) -> Result<PreparedChange, String> {
        self.prune();
        if self.mutations.len() >= MAX_MUTATIONS || self.busy(id) { return Err("data_busy".into()); }
        let previous = self.get(id, revision)?.saved.clone(); let mut next = previous.clone();
        let state = match &change {
            Change::Connector { source } => {
                if source.as_ref().is_some_and(|s| s.is_empty() || s.len() > MAX_SOURCE_BYTES) { return Err("data_budget_exceeded".into()); }
                next.source = source.clone(); if source.is_some() { "installed" } else { "connector_removed" }
            }
            Change::Enabled { enabled } => { next.enabled = *enabled; if *enabled { "enabled" } else { "disabled" } }
            Change::Remove => "removed",
        };
        let next = if matches!(change, Change::Remove) { None } else { Some(next) };
        let next_grant = next.as_ref().and_then(|n| self.restore(n));
        if matches!(change, Change::Enabled { enabled: true }) && next_grant.is_none() { return Err("data_root_changed".into()); }
        let prepared = PreparedChange { ticket_id: token()?, result: ChangeReceipt { source_id: id.into(), revision: token()?, state: state.into() } };
        if self.mutations.contains_key(&prepared.ticket_id) { return Err("data_conflict".into()); }
        self.mutations.insert(prepared.ticket_id.clone(), Mutation { previous, next, next_grant,
            prepared: prepared.clone(), stage: Stage::Prepared, deadline: Instant::now() + MUTATION_TTL });
        Ok(prepared)
    }
    pub fn commit(&mut self, ticket: &str) -> Result<ChangeReceipt, String> {
        self.prune(); let mutation = self.mutations.get(ticket).ok_or("data_change_closed")?;
        if mutation.stage == Stage::Committed { return Ok(mutation.prepared.result.clone()); }
        if mutation.stage != Stage::Prepared { return Err("data_conflict".into()); }
        let result = mutation.prepared.result.clone();
        self.persist(&result.source_id, mutation.next.as_ref())?;
        let mutation = self.mutations.get_mut(ticket).expect("mutation under exclusive library lock");
        let mounted = mutation.next.clone().map(|saved| MountedSource { saved, revision: result.revision.clone(), grant: mutation.next_grant.take() });
        mutation.stage = Stage::Committed;
        self.replace(&result.source_id, mounted); Ok(result)
    }
    pub fn rollback(&mut self, ticket: &str) -> Result<(), String> {
        self.prune(); let mutation = self.mutations.get(ticket).ok_or("data_change_closed")?;
        if mutation.stage != Stage::Committed {
            self.mutations.get_mut(ticket).unwrap().stage = Stage::RolledBack; return Ok(());
        }
        let previous = mutation.previous.clone(); let id = previous.id.clone();
        let mounted = MountedSource { grant: self.restore(&previous), saved: previous, revision: token()? };
        self.persist(&id, Some(&mounted.saved))?;
        self.replace(&id, Some(mounted)); self.mutations.get_mut(ticket).unwrap().stage = Stage::RolledBack; Ok(())
    }
    pub fn finish(&mut self, ticket: &str) { self.mutations.remove(ticket); }
    fn replace(&mut self, id: &str, next: Option<MountedSource>) {
        if let Some(old) = self.records.remove(id) { if let Some(root) = old.grant { root.revoke(); } }
        if let Some(next) = next { self.records.insert(id.into(), next); }
    }
    fn persist(&self, id: &str, next: Option<&SavedSource>) -> Result<(), String> {
        #[derive(Serialize)] struct Store<'a> { version: u8, records: Vec<&'a SavedSource> }
        let records = self.records.iter().filter(|(key, _)| key.as_str() != id).map(|(_, v)| &v.saved).chain(next).collect();
        let bytes = serde_json::to_vec(&Store { version: 1, records }).map_err(|_| "data_storage_failed")?;
        if bytes.len() > MAX_STORE_BYTES { return Err("data_budget_exceeded".into()); }
        let path = self.storage.join(format!(".connections-{}.tmp", token()?));
        let mut options = fs::OpenOptions::new(); options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let write = || -> std::io::Result<()> {
            let mut file = options.open(&path)?; file.write_all(&bytes)?; file.sync_all()?; drop(file);
            // This rename is the commit point. No fallible work after it may
            // report that the old record is still current.
            fs::rename(&path, self.storage.join("connections.json"))
        };
        if write().is_err() { let _ = fs::remove_file(&path); return Err("data_storage_failed".into()); }
        #[cfg(unix)] { let _ = fs::File::open(&self.storage).and_then(|d| d.sync_all()); }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, sync::atomic::AtomicBool};
    struct Fixture { dir: PathBuf, data: PathBuf, store: PathBuf }
    impl Fixture {
        fn new() -> Self {
            let mut bytes = [0u8; 16]; getrandom::fill(&mut bytes).unwrap();
            let dir = std::env::temp_dir().join(format!("tf-library-{:032x}", u128::from_le_bytes(bytes)));
            let data = dir.join("data"); let store = dir.join("store"); fs::create_dir_all(&data).unwrap();
            fs::write(data.join("a.csv"), b"user data").unwrap(); Self { dir, data, store }
        }
        fn library(&self) -> Library { Library::open(&self.store, Vec::new()).unwrap() }
        fn selected(&self, library: &mut Library) -> SourceInfo { library.select(RootGrant::select(&self.data).unwrap(), None).unwrap() }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.dir); } }
    fn apply(l: &mut Library, s: &SourceInfo, change: Change) -> ChangeReceipt {
        let ticket = l.prepare(&s.id, &s.revision, change).unwrap();
        let result = l.commit(&ticket.ticket_id).unwrap(); l.finish(&ticket.ticket_id); result
    }
    #[test]
    fn only_native_selection_creates_a_source_and_public_info_has_no_locator() {
        let f = Fixture::new(); let mut l = f.library(); assert!(l.list().is_empty());
        assert!(l.grant("some/path", "fake").is_err()); let s = f.selected(&mut l);
        assert_eq!(s.state, "ready"); assert!(!s.has_connector);
        assert!(!serde_json::to_string(&s).unwrap().contains(f.dir.to_str().unwrap()));
    }
    #[test]
    fn source_and_grant_restore_with_a_new_runtime_revision() {
        let f = Fixture::new(); let mut l = f.library(); let s = f.selected(&mut l);
        apply(&mut l, &s, Change::Connector { source: Some("user connector".into()) });
        let old = l.list().remove(0); let old_grant = l.grant(&old.id, &old.revision).unwrap(); drop(l);
        assert!(old_grant.read("a.csv", 0, 30, None, &AtomicBool::new(false)).is_err());
        let next = f.library(); let s = next.list().remove(0); assert_ne!(s.revision, old.revision);
        assert_eq!(next.source(&s.id, &s.revision).unwrap().as_deref(), Some("user connector"));
        assert!(next.grant(&s.id, &old.revision).is_err()); assert!(next.grant(&s.id, &s.revision).is_ok());
    }
    #[test]
    fn disabling_is_durable_and_reenabling_never_revives_old_grants() {
        let f = Fixture::new(); let mut l = f.library(); let s = f.selected(&mut l); let old = l.grant(&s.id, &s.revision).unwrap();
        apply(&mut l, &s, Change::Enabled { enabled: false });
        assert!(old.read("a.csv", 0, 20, None, &AtomicBool::new(false)).is_err()); drop(l);
        let mut l = f.library(); let s = l.list().remove(0); assert_eq!(s.state, "disabled"); assert!(l.grant(&s.id, &s.revision).is_err());
        apply(&mut l, &s, Change::Enabled { enabled: true }); let s = l.list().remove(0);
        assert_eq!(s.state, "ready"); assert!(l.grant(&s.id, &s.revision).is_ok());
    }
    #[test]
    fn delete_removes_only_the_record_and_can_be_compensated_natively() {
        let f = Fixture::new(); let mut l = f.library(); let s = f.selected(&mut l);
        let t = l.prepare(&s.id, &s.revision, Change::Remove).unwrap(); l.commit(&t.ticket_id).unwrap();
        assert!(l.list().is_empty()); assert!(f.data.join("a.csv").is_file());
        l.rollback(&t.ticket_id).unwrap(); l.finish(&t.ticket_id); let restored = l.list().remove(0);
        assert_eq!(restored.id, s.id); assert_ne!(restored.revision, s.revision);
        apply(&mut l, &restored, Change::Remove); drop(l); assert!(f.library().list().is_empty()); assert!(f.data.join("a.csv").is_file());
    }
    #[test]
    fn stale_revisions_and_parallel_mutations_do_not_overwrite_changes() {
        let f = Fixture::new(); let mut l = f.library(); let s = f.selected(&mut l);
        let t = l.prepare(&s.id, &s.revision, Change::Connector { source: Some("v2".into()) }).unwrap();
        assert!(l.prepare(&s.id, &s.revision, Change::Remove).is_err()); l.commit(&t.ticket_id).unwrap(); l.finish(&t.ticket_id);
        assert!(l.prepare(&s.id, &s.revision, Change::Remove).is_err()); let s = l.list().remove(0);
        assert_eq!(l.source(&s.id, &s.revision).unwrap().as_deref(), Some("v2"));
    }
    #[test]
    fn failed_durable_commit_does_not_change_the_live_record_or_grant() {
        let f = Fixture::new(); let mut l = f.library(); let s = f.selected(&mut l); let old = l.grant(&s.id, &s.revision).unwrap();
        let t = l.prepare(&s.id, &s.revision, Change::Remove).unwrap();
        fs::remove_file(f.store.join("connections.json")).unwrap(); fs::create_dir(f.store.join("connections.json")).unwrap();
        assert!(l.commit(&t.ticket_id).is_err()); l.rollback(&t.ticket_id).unwrap(); l.finish(&t.ticket_id);
        assert_eq!(l.list().len(), 1); assert!(old.read("a.csv", 0, 20, None, &AtomicBool::new(false)).is_ok());
    }
    #[test]
    fn corrupted_storage_is_not_silently_replaced_with_an_empty_library() {
        let f = Fixture::new(); fs::create_dir_all(&f.store).unwrap(); fs::write(f.store.join("connections.json"), b"broken").unwrap();
        assert!(Library::open(&f.store, Vec::new()).is_err()); assert_eq!(fs::read(f.store.join("connections.json")).unwrap(), b"broken");
    }
    #[test]
    fn replaced_root_on_restart_is_unavailable_without_breaking_other_sources() {
        let f = Fixture::new(); let mut l = f.library(); let old = f.selected(&mut l);
        let other = f.dir.join("other"); fs::create_dir(&other).unwrap(); l.select(RootGrant::select(&other).unwrap(), None).unwrap(); drop(l);
        fs::rename(&f.data, f.dir.join("old")).unwrap(); fs::create_dir(&f.data).unwrap(); let l = f.library(); let all = l.list();
        assert_eq!(all.iter().find(|s| s.id == old.id).unwrap().state, "needs_directory");
        assert_eq!(all.iter().filter(|s| s.state == "ready").count(), 1);
    }
    #[test]
    fn selecting_ancestor_of_application_storage_is_not_a_data_grant() {
        let f = Fixture::new(); let mut l = f.library();
        assert!(l.select(RootGrant::select(&f.dir).unwrap(), None).is_err()); assert!(l.list().is_empty());
    }
    #[test]
    fn selecting_inside_application_storage_cannot_expose_private_subdirectories() {
        let f = Fixture::new(); let mut l = f.library();
        let private = f.store.join("private").join("nested"); fs::create_dir_all(&private).unwrap();
        assert!(l.select(RootGrant::select(&private).unwrap(), None).is_err());
        assert!(l.list().is_empty());
        // A separate ordinary data directory remains usable, not a global ban.
        assert_eq!(f.selected(&mut l).state, "ready");
    }
    #[test]
    fn saved_grant_that_now_overlaps_private_storage_is_quarantined_without_erasure() {
        let f = Fixture::new(); let mut l = f.library(); let source = f.selected(&mut l); drop(l);
        let original = fs::read(f.store.join("connections.json")).unwrap();
        let next = Library::open(&f.store, vec![f.dir.clone()]).unwrap();
        let restored = next.list().remove(0);
        assert_eq!(restored.id, source.id); assert_eq!(restored.state, "needs_directory");
        assert!(next.grant(&restored.id, &restored.revision).is_err());
        assert_eq!(fs::read(f.store.join("connections.json")).unwrap(), original);
    }
}
