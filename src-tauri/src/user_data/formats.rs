//! Native format readers share the selected-directory capability and I/O lease.
//! Never give a decoder an ambient path, network client or writable file.
mod sqlite;
mod parquet;
mod compact;
#[cfg(test)]
pub(super) mod tests;
use super::{access::{GrantedFile, RootGrant}, state::FileOperation};
use serde_json::{Value, json};
use std::{io, sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}}};
pub(super) type Check = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;
pub(super) const MAX_READ: usize = 128 * 1024 * 1024;
pub(super) const MAX_OUTPUT: usize = 4 * 1024 * 1024;
pub(super) const MAX_CELL: usize = 64 * 1024;
pub(super) const MAX_COLUMNS: usize = 128;
pub(super) const MAX_ROWS: usize = 12000;

pub(super) struct FormatFile {
    pub file: GrantedFile, check: Check, read: AtomicUsize, failure: Mutex<Option<String>>,
}
impl FormatFile {
    pub fn new(root: &RootGrant, path: &str, revision: Option<&str>, check: Check) -> Result<Arc<Self>, String> {
        check()?;
        let file = root.open_file(path, revision).map_err(|e| e.code())?;
        Ok(Arc::new(Self { file, check, read: AtomicUsize::new(0), failure: Mutex::new(None) }))
    }
    pub fn check(&self) -> Result<(), String> { (self.check)() }
    fn failed(&self, code: String) -> io::Error {
        if let Ok(mut error) = self.failure.lock() { if error.is_none() { *error = Some(code.clone()); } }
        io::Error::other(code)
    }
    pub fn read_at(&self, offset: u64, buffer: &mut [u8]) -> io::Result<usize> {
        self.check().map_err(|e| self.failed(e))?;
        if buffer.len() > MAX_READ || self.read.fetch_add(buffer.len(), Ordering::Relaxed).saturating_add(buffer.len()) > MAX_READ {
            return Err(self.failed("data_io_budget".into()));
        }
        self.file.read_at(offset, buffer).map_err(|e| self.failed(e.code().into()))
    }
    pub fn bytes(&self, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        if length > MAX_READ || offset.checked_add(length as u64).is_none_or(|n| n > self.file.size) { return Err("data_budget_exceeded".into()); }
        let mut bytes = vec![0; length]; let mut read = 0;
        while read < length { let n = self.read_at(offset + read as u64, &mut bytes[read..]).map_err(|_| self.error("data_read_failed"))?;
            if n == 0 { return Err("data_file_changed".into()); } read += n; }
        Ok(bytes)
    }
    pub fn finish(&self) -> Result<(), String> { self.check()?; self.file.check().map_err(|e| e.code().into()) }
    pub fn error(&self, fallback: &str) -> String {
        self.check().err().or_else(|| self.failure.lock().ok().and_then(|v| v.clone())).unwrap_or_else(|| fallback.into())
    }
}
pub(super) fn integer(n: i128) -> Value {
    if (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&n) { json!(n as i64) }
    else { json!({"type":"integer","value":n.to_string()}) }
}
pub(super) fn float(n: f64) -> Result<Value, String> {
    if !n.is_finite() { return Err("data_nonfinite_value".into()); }
    if n.fract() == 0.0 && n.abs() > 9_007_199_254_740_991.0 { return Err("data_numeric_precision".into()); }
    Ok(json!(n))
}
pub(super) fn binary(bytes: &[u8]) -> Result<Value, String> {
    if bytes.len() > MAX_CELL/2 { return Err("data_output_limit".into()); }
    Ok(json!({"type":"binary","value":bytes.iter().map(|b|format!("{b:02x}")).collect::<String>()}))
}
pub(super) fn add_row(rows: &mut Vec<Value>, row: Vec<Value>, size: &mut usize) -> Result<(), String> {
    let bytes = serde_json::to_vec(&row).map_err(|_| "data_invalid_output")?;
    if bytes.len() > MAX_OUTPUT || size.saturating_add(bytes.len()) > MAX_OUTPUT-32768 { return Err("data_output_limit".into()); }
    *size += bytes.len(); rows.push(Value::Array(row)); Ok(())
}
pub(super) fn execute(root: &RootGrant, request: &FileOperation, check: Check) -> Result<Value, String> {
    let (path, revision) = match request {
        FileOperation::Sqlite {path,file_revision,..} | FileOperation::Parquet {path,file_revision,..} => (path, file_revision.as_deref()),
        _ => return Err("data_invalid_io".into()),
    };
    let file = FormatFile::new(root, path, revision, check)?;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match request {
        FileOperation::Sqlite {sql,parameters,limit,..} => sqlite::query(file.clone(), root, path, sql, parameters, *limit),
        FileOperation::Parquet {offset,limit,columns,..} => parquet::query(file.clone(), *offset, *limit, columns.as_deref()),
        _ => unreachable!(),
    })).unwrap_or_else(|_| Err("data_invalid_format".into()));
    file.finish()?;
    let result = result.map_err(|e| file.error(&e))?;
    if serde_json::to_vec(&result).map_err(|_| "data_invalid_output")?.len() > MAX_OUTPUT { return Err("data_output_limit".into()); }
    Ok(result)
}
