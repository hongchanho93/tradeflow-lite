use super::{FormatFile, MAX_CELL, MAX_COLUMNS, add_row, binary, float, integer};
use crate::user_data::access::RootGrant;
use rusqlite::{Connection, OpenFlags, hooks::{AuthAction, AuthContext, Authorization}, limits::Limit, types::{Value as SqlValue, ValueRef}};
use serde_json::{Value, json};
use sqlite_vfs::{DatabaseHandle, LockKind, OpenAccess, OpenKind, Vfs, WalDisabled};
use std::{collections::HashMap, io, sync::{Arc, Mutex, OnceLock, Weak}, time::Duration};

const VFS: &str = "tradeflow-selected-readonly-v1";
static FILES: OnceLock<Mutex<HashMap<String, Weak<FormatFile>>>> = OnceLock::new();
static REGISTERED: OnceLock<Result<(), String>> = OnceLock::new();
fn files() -> &'static Mutex<HashMap<String, Weak<FormatFile>>> { FILES.get_or_init(Default::default) }
fn denied() -> io::Error { io::Error::new(io::ErrorKind::PermissionDenied, "data_sqlite_readonly") }
struct ReadVfs;
struct Handle { file: Arc<FormatFile>, lock: LockKind }
impl DatabaseHandle for Handle {
    type WalIndex = WalDisabled;
    fn size(&self) -> io::Result<u64> { self.file.check().map_err(io::Error::other)?; Ok(self.file.file.size) }
    fn read_exact_at(&mut self, buf: &mut [u8], offset: u64) -> io::Result<()> {
        let mut n = 0;
        while n < buf.len() { let read = self.file.read_at(offset+n as u64, &mut buf[n..])?;
            if read == 0 { buf[n..].fill(0); return Err(io::ErrorKind::UnexpectedEof.into()); } n += read; }
        Ok(())
    }
    fn write_all_at(&mut self, _: &[u8], _: u64) -> io::Result<()> { Err(denied()) }
    fn sync(&mut self, _: bool) -> io::Result<()> { Err(denied()) }
    fn set_len(&mut self, _: u64) -> io::Result<()> { Err(denied()) }
    fn lock(&mut self, lock: LockKind) -> io::Result<bool> {
        self.file.check().map_err(io::Error::other)?;
        if !matches!(lock, LockKind::None | LockKind::Shared) { return Err(denied()); }
        self.lock = lock; Ok(true)
    }
    fn reserved(&mut self) -> io::Result<bool> { Ok(false) }
    fn current_lock(&self) -> io::Result<LockKind> { Ok(self.lock) }
    fn wal_index(&self, _: bool) -> io::Result<WalDisabled> { Err(denied()) }
}
impl Vfs for ReadVfs {
    type Handle = Handle;
    fn open(&self, name: &str, options: sqlite_vfs::OpenOptions) -> io::Result<Handle> {
        if options.kind != OpenKind::MainDb || options.access != OpenAccess::Read { return Err(denied()); }
        let file = files().lock().map_err(|_|denied())?.get(name).and_then(Weak::upgrade).ok_or_else(denied)?;
        file.check().map_err(io::Error::other)?;
        Ok(Handle { file, lock: LockKind::None })
    }
    fn delete(&self, _: &str) -> io::Result<()> { Err(denied()) }
    fn exists(&self, name: &str) -> io::Result<bool> { Ok(files().lock().map_err(|_|denied())?.get(name).and_then(Weak::upgrade).is_some()) }
    fn access(&self, name: &str, write: bool) -> io::Result<bool> { if write { Ok(false) } else { self.exists(name) } }
    fn temporary_name(&self) -> String { "temporary-files-denied".into() }
    fn random(&self, buffer: &mut [i8]) {
        for part in buffer.chunks_mut(256) { let mut bytes = [0u8;256];
            if getrandom::fill(&mut bytes[..part.len()]).is_err() { part.fill(0); continue; }
            for (dst,src) in part.iter_mut().zip(bytes) { *dst=src as i8; } }
    }
    fn sleep(&self, _: Duration) -> Duration { Duration::ZERO }
}
struct Registration(String);
impl Drop for Registration { fn drop(&mut self) { if let Ok(mut map)=files().lock() { map.remove(&self.0); } } }
fn sql_error(_: rusqlite::Error) -> String { "data_sqlite_query_failed".into() }

pub(super) fn query(file: Arc<FormatFile>, root: &RootGrant, path: &str, sql: &str, parameters: &[Value], limit: usize) -> Result<Value, String> {
    root.sqlite_snapshot(path)?;
    if file.file.size < 100 { return Err("data_invalid_sqlite".into()); }
    let header=file.bytes(0,100)?;
    if &header[..16]!=b"SQLite format 3\0" { return Err("data_invalid_sqlite".into()); }
    if header[18]!=1 || header[19]!=1 { return Err("data_sqlite_snapshot_required".into()); }
    REGISTERED.get_or_init(||sqlite_vfs::register(VFS,ReadVfs,false).map_err(|_|"data_sqlite_unavailable".into())).clone()?;
    let registration=Registration(crate::user_data::library::token()?);
    files().lock().map_err(|_|"data_sqlite_unavailable")?.insert(registration.0.clone(),Arc::downgrade(&file));
    let connection=Connection::open_with_flags_and_vfs(&registration.0,OpenFlags::SQLITE_OPEN_READ_ONLY|OpenFlags::SQLITE_OPEN_NO_MUTEX,VFS).map_err(sql_error)?;
    // Bootstrap PRAGMAs may read the untrusted database schema. Install parser
    // and execution budgets before preparing even the first trusted statement.
    for (kind,value) in [(Limit::SQLITE_LIMIT_LENGTH,MAX_CELL as i32),(Limit::SQLITE_LIMIT_SQL_LENGTH,32768),
        (Limit::SQLITE_LIMIT_COLUMN,MAX_COLUMNS as i32),(Limit::SQLITE_LIMIT_EXPR_DEPTH,32),
        (Limit::SQLITE_LIMIT_COMPOUND_SELECT,16),(Limit::SQLITE_LIMIT_VDBE_OP,40000),(Limit::SQLITE_LIMIT_VARIABLE_NUMBER,128),
        (Limit::SQLITE_LIMIT_ATTACHED,0),(Limit::SQLITE_LIMIT_WORKER_THREADS,0)] { connection.set_limit(kind,value).map_err(sql_error)?; }
    let active=file.clone(); let mut ticks=0usize;
    connection.progress_handler(1000,Some(move || { ticks+=1; ticks>20000 || active.check().is_err() })).map_err(sql_error)?;
    // A spill may fail through the read-only VFS, but must never write a user or
    // ambient temporary file. Do not put an entire sort in an unlimited heap.
    connection.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA mmap_size=0; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE;").map_err(sql_error)?;
    connection.authorizer(Some(|ctx:AuthContext<'_>| match ctx.action {
        AuthAction::Select | AuthAction::Recursive => Authorization::Allow,
        AuthAction::Read {..} if matches!(ctx.database_name,Some("main")|None) => Authorization::Allow,
        AuthAction::Function {function_name} if !["load_extension","readfile","writefile","fts3_tokenizer"].contains(&function_name.to_ascii_lowercase().as_str()) => Authorization::Allow,
        AuthAction::Pragma {pragma_name,..} if ["table_info","table_xinfo","index_list","index_info","index_xinfo"].contains(&pragma_name.to_ascii_lowercase().as_str()) => Authorization::Allow,
        _ => Authorization::Deny,
    })).map_err(sql_error)?;
    let values: Vec<SqlValue> = parameters.iter().map(|v|match v {
        Value::Null=>Ok(SqlValue::Null),Value::String(s)=>Ok(SqlValue::Text(s.clone())),
        Value::Number(n)=> if let Some(n)=n.as_i64(){Ok(SqlValue::Integer(n))}else{n.as_f64().map(SqlValue::Real).ok_or_else(||"data_invalid_io".to_string())},
        _=>Err("data_invalid_io".into()),
    }).collect::<Result<_,String>>()?;
    let mut statement=connection.prepare(sql).map_err(sql_error)?;
    if !statement.readonly() || statement.column_count()==0 { return Err("data_sqlite_readonly".into()); }
    let columns:Vec<String>=statement.column_names().iter().map(|s|s.to_string()).collect();
    if columns.len()>MAX_COLUMNS || columns.iter().any(|s|s.len()>256) { return Err("data_output_limit".into()); }
    let mut rows=Vec::new();let mut size=0;let mut truncated=false;
    let mut cursor=statement.query(rusqlite::params_from_iter(values)).map_err(sql_error)?;
    while let Some(row)=cursor.next().map_err(sql_error)? {
        file.check()?;if rows.len()==limit {truncated=true;break;}
        let mut values=Vec::with_capacity(columns.len());
        for index in 0..columns.len(){values.push(match row.get_ref(index).map_err(sql_error)? {
            ValueRef::Null=>Value::Null,ValueRef::Integer(n)=>integer(n as i128),ValueRef::Real(n)=>float(n)?,
            ValueRef::Text(s)=>{if s.len()>MAX_CELL{return Err("data_output_limit".into());}Value::String(std::str::from_utf8(s).map_err(|_|"data_invalid_utf8")?.into())},
            ValueRef::Blob(b)=>binary(b)?,
        });}
        add_row(&mut rows,values,&mut size)?;
    }
    root.sqlite_snapshot(path)?;
    Ok(json!({"types":vec!["sqlite-dynamic";columns.len()],"columns":columns,"rows":rows,"revision":file.file.revision,"truncated":truncated}))
}
