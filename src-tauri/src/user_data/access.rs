//! Read-only directory capabilities. Native picker/storage are the only callers
//! allowed to construct a root. Never deserialize SavedRoot from a WebView call.
use serde::{Deserialize, Serialize};
use cap_fs_ext::OpenOptionsSyncExt;
use cap_std::{ambient_authority, fs::{Dir, OpenOptions}};
use std::{collections::BTreeMap, fs, io::{Read, Seek, SeekFrom}, path::{Path, PathBuf},
    sync::{Arc, atomic::{AtomicBool, Ordering}}, time::UNIX_EPOCH};

pub const MAX_CHUNK_BYTES: usize = 1024 * 1024;
pub const MAX_DIRECTORY_PAGE: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessError { InvalidRequest, PathDenied, RootChanged, Revoked, Cancelled, FileChanged, ReadFailed, BudgetExceeded }
pub type AccessResult<T> = Result<T, AccessError>;
impl AccessError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidRequest => "data_invalid_request", Self::PathDenied => "data_path_denied",
            Self::RootChanged => "data_root_changed", Self::Revoked => "data_revoked",
            Self::Cancelled => "data_cancelled", Self::FileChanged => "data_file_changed",
            Self::ReadFailed => "data_read_failed", Self::BudgetExceeded => "data_budget_exceeded",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedRoot { version: u8, locator: PathBuf, identity: FileIdentity }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileIdentity { device: u64, file: [u8; 16], created: Option<(u64, u32)> }
#[derive(Clone)]
pub struct RootGrant(Arc<RootInner>);
struct RootInner { dir: Dir, saved: SavedRoot, revoked: AtomicBool }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChunk { pub data: Vec<u8>, pub offset: u64, pub size: u64, pub revision: String }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry { pub name: String, pub kind: String }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPage { pub entries: Vec<DirectoryEntry>, pub next: Option<String> }

fn io_error(_: std::io::Error) -> AccessError { AccessError::ReadFailed }

fn identity(file: &fs::File) -> AccessResult<FileIdentity> {
    let metadata = file.metadata().map_err(io_error)?;
    let created = metadata.created().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|t| (t.as_secs(), t.subsec_nanos()));
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let mut id = [0u8; 16]; id[..8].copy_from_slice(&metadata.ino().to_le_bytes());
        Ok(FileIdentity { device: metadata.dev(), file: id, created })
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandleEx, FileIdInfo, FILE_ID_INFO};
        let mut info: FILE_ID_INFO = unsafe { std::mem::zeroed() };
        // FileIdInfo returns the full 128-bit identity, including on ReFS. The
        // handle remains owned by `file`; the API writes exactly this struct.
        let ok = unsafe { GetFileInformationByHandleEx(file.as_raw_handle(), FileIdInfo,
            (&mut info as *mut FILE_ID_INFO).cast(), std::mem::size_of::<FILE_ID_INFO>() as u32) };
        if ok == 0 { return Err(AccessError::ReadFailed); }
        Ok(FileIdentity { device: info.VolumeSerialNumber, file: info.FileId.Identifier, created })
    }
    #[cfg(not(any(unix, windows)))]
    { let _ = created; Err(AccessError::ReadFailed) }
}

fn dir_identity(dir: &Dir) -> AccessResult<FileIdentity> {
    identity(&dir.try_clone().map_err(io_error)?.into_std_file())
}

/// A portable relative name is a locator *inside* an existing grant, never
/// authority. cap-std still enforces containment while resolving links/opening.
pub fn relative_path(name: &str, root_allowed: bool) -> AccessResult<&Path> {
    if name.is_empty() && root_allowed { return Ok(Path::new(".")); }
    if name.is_empty() || name.len() > 4096 || name.contains(['\\', ':', '\0']) || name.starts_with('/') {
        return Err(AccessError::PathDenied);
    }
    for part in name.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' ']) {
            return Err(AccessError::PathDenied);
        }
        let stem = part.split('.').next().unwrap_or("").trim_end().to_uppercase();
        if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
            || ["COM", "LPT"].iter().any(|prefix| stem.strip_prefix(prefix)
                .is_some_and(|s| ["0","1","2","3","4","5","6","7","8","9","¹","²","³"].contains(&s))) {
            return Err(AccessError::PathDenied);
        }
    }
    Ok(Path::new(name))
}

fn file_revision(file: &fs::File) -> AccessResult<String> {
    let id = identity(file)?;
    let m = file.metadata().map_err(io_error)?;
    if !m.is_file() { return Err(AccessError::PathDenied); }
    let modified = m.modified().map_err(io_error)?.duration_since(UNIX_EPOCH).map_err(|_| AccessError::ReadFailed)?;
    // Opaque metadata version, never a path. Full identity + nanosecond mtime +
    // size prevents replacing a file between range requests without detection.
    Ok(format!("{:x}-{:032x}-{}-{}-{}-{:?}", id.device, u128::from_le_bytes(id.file),
        modified.as_secs(), modified.subsec_nanos(), m.len(), id.created))
}

/// A format decoder gets one pinned regular file, never an ambient filename.
/// All reads use the same handle; final delivery also checks its current name.
pub(super) struct GrantedFile {
    root: RootGrant, name: String, file: std::sync::Mutex<fs::File>,
    pub revision: String, pub size: u64,
}
impl GrantedFile {
    pub fn read_at(&self, offset: u64, buffer: &mut [u8]) -> AccessResult<usize> {
        self.root.checkpoint(&AtomicBool::new(false))?;
        let mut file = self.file.lock().map_err(|_| AccessError::ReadFailed)?;
        if file_revision(&file)? != self.revision { return Err(AccessError::FileChanged); }
        if offset > self.size { return Err(AccessError::InvalidRequest); }
        file.seek(SeekFrom::Start(offset)).map_err(io_error)?;
        let count = file.read(buffer).map_err(io_error)?;
        if file_revision(&file)? != self.revision { return Err(AccessError::FileChanged); }
        self.root.checkpoint(&AtomicBool::new(false))?;
        Ok(count)
    }
    pub fn check(&self) -> AccessResult<()> {
        self.root.read(&self.name, 0, 1, Some(&self.revision), &AtomicBool::new(false)).map(|_| ())
    }
}
impl RootGrant {
    /// Online WAL / rollback recovery requires a separate snapshot protocol.
    /// Refuse sidecars and aliases rather than silently reading stale pages.
    pub(super) fn sqlite_snapshot(&self, name: &str) -> Result<(), String> {
        self.check(&AtomicBool::new(false)).map_err(|e| e.code())?;
        relative_path(name, false).map_err(|e| e.code())?;
        let mut prefix = PathBuf::new();
        for part in name.split('/') {
            prefix.push(part);
            if self.0.dir.symlink_metadata(&prefix).map_err(|_| "data_read_failed")?.file_type().is_symlink() {
                return Err("data_sqlite_snapshot_required".into());
            }
        }
        for suffix in ["-wal", "-journal"] {
            match self.0.dir.symlink_metadata(format!("{name}{suffix}")) {
                Ok(_) => return Err("data_sqlite_snapshot_required".into()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
                Err(_) => return Err("data_read_failed".into()),
            }
        }
        Ok(())
    }
    pub(super) fn open_file(&self, name: &str, expected: Option<&str>) -> AccessResult<GrantedFile> {
        self.check(&AtomicBool::new(false))?;
        let mut options = OpenOptions::new(); options.read(true);
        #[cfg(unix)]
        options.nonblock(true);
        let file = self.0.dir.open_with(relative_path(name, false)?, &options).map_err(io_error)?.into_std();
        let revision = file_revision(&file)?;
        if expected.is_some_and(|v| v != revision) { return Err(AccessError::FileChanged); }
        let size = file.metadata().map_err(io_error)?.len();
        if size > 9_007_199_254_740_991 { return Err(AccessError::BudgetExceeded); }
        self.check(&AtomicBool::new(false))?;
        Ok(GrantedFile { root: self.clone(), name: name.into(), file: std::sync::Mutex::new(file), revision, size })
    }
    /// Trusted native picker callback ONLY; deliberately not a Tauri command.
    pub fn select(path: &Path) -> AccessResult<Self> {
        let locator = fs::canonicalize(path).map_err(io_error)?;
        let dir = Dir::open_ambient_dir(&locator, ambient_authority()).map_err(io_error)?;
        let saved = SavedRoot { version: 1, identity: dir_identity(&dir)?, locator };
        let root = Self(Arc::new(RootInner { dir, saved, revoked: AtomicBool::new(false) }));
        root.check(&AtomicBool::new(false))?;
        Ok(root)
    }
    /// Only records loaded from the fixed native grant store may reach here.
    pub fn restore(saved: &SavedRoot) -> AccessResult<Self> {
        if saved.version != 1 || !saved.locator.is_absolute() { return Err(AccessError::RootChanged); }
        let dir = Dir::open_ambient_dir(&saved.locator, ambient_authority()).map_err(|_| AccessError::RootChanged)?;
        if dir_identity(&dir)? != saved.identity { return Err(AccessError::RootChanged); }
        let root = Self(Arc::new(RootInner { dir, saved: saved.clone(), revoked: AtomicBool::new(false) }));
        root.check(&AtomicBool::new(false))?;
        Ok(root)
    }
    pub fn saved(&self) -> SavedRoot { self.0.saved.clone() }
    pub fn name(&self) -> String {
        self.0.saved.locator.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "我的数据".into())
    }
    /// Deny overlapping the host's storage/resources in either direction.
    /// Compare actual ancestor identities, including case aliases on Windows.
    pub fn contains_protected(&self, protected: &Path) -> AccessResult<bool> {
        let canonical = fs::canonicalize(protected).map_err(io_error)?;
        let protected_dir = Dir::open_ambient_dir(&canonical, ambient_authority()).map_err(io_error)?;
        let protected_identity = dir_identity(&protected_dir)?;
        for ancestor in canonical.ancestors() {
            let dir = Dir::open_ambient_dir(ancestor, ambient_authority()).map_err(io_error)?;
            if dir_identity(&dir)? == self.0.saved.identity { return Ok(true); }
        }
        for ancestor in self.0.saved.locator.ancestors() {
            let dir = Dir::open_ambient_dir(ancestor, ambient_authority()).map_err(io_error)?;
            if dir_identity(&dir)? == protected_identity { return Ok(true); }
        }
        Ok(false)
    }
    pub fn revoke(&self) { self.0.revoked.store(true, Ordering::Release); }
    pub fn is_revoked(&self) -> bool { self.0.revoked.load(Ordering::Acquire) }
    fn checkpoint(&self, cancel: &AtomicBool) -> AccessResult<()> {
        if self.0.revoked.load(Ordering::Acquire) { return Err(AccessError::Revoked); }
        if cancel.load(Ordering::Acquire) { return Err(AccessError::Cancelled); }
        Ok(())
    }
    pub fn check(&self, cancel: &AtomicBool) -> AccessResult<()> {
        self.checkpoint(cancel)?;
        // The ambient open is only an identity probe. Reads below always use
        // the original pinned handle, never the directory returned here.
        let current = Dir::open_ambient_dir(&self.0.saved.locator, ambient_authority()).map_err(|_| AccessError::RootChanged)?;
        if dir_identity(&current)? != self.0.saved.identity { return Err(AccessError::RootChanged); }
        self.checkpoint(cancel)
    }
    pub fn read(&self, name: &str, offset: u64, length: usize, expected: Option<&str>, cancel: &AtomicBool) -> AccessResult<FileChunk> {
        self.read_inner(name, offset, length, expected, cancel, || {})
    }
    fn read_inner(&self, name: &str, offset: u64, length: usize, expected: Option<&str>, cancel: &AtomicBool, opened: impl FnOnce()) -> AccessResult<FileChunk> {
        self.check(cancel)?;
        let path = relative_path(name, false)?;
        if length == 0 || length > MAX_CHUNK_BYTES { return Err(AccessError::BudgetExceeded); }
        let mut options = OpenOptions::new(); options.read(true);
        #[cfg(unix)]
        options.nonblock(true); // In particular, never wait for a FIFO writer.
        let mut file = self.0.dir.open_with(path, &options).map_err(io_error)?.into_std();
        let revision = file_revision(&file)?;
        if expected.is_some_and(|e| e != revision) { return Err(AccessError::FileChanged); }
        let size = file.metadata().map_err(io_error)?.len();
        if offset > size || size > 9_007_199_254_740_991 { return Err(AccessError::InvalidRequest); }
        file.seek(SeekFrom::Start(offset)).map_err(io_error)?;
        opened();
        let mut data = Vec::with_capacity(length.min(size.saturating_sub(offset) as usize));
        let mut buffer = [0u8; 64 * 1024];
        while data.len() < length {
            self.checkpoint(cancel)?;
            let wanted = buffer.len().min(length - data.len());
            let read = file.read(&mut buffer[..wanted]).map_err(io_error)?;
            if read == 0 { break; }
            data.extend_from_slice(&buffer[..read]);
        }
        if file_revision(&file)? != revision { return Err(AccessError::FileChanged); }
        self.check(cancel)?;
        Ok(FileChunk { data, offset, size, revision })
    }
    /// Sorted live directory page. Keeps only limit+1 entries, not the entire
    /// user's universe. `next` is a relative entry name, not a filesystem grant.
    pub fn list(&self, name: &str, after: Option<&str>, limit: usize, cancel: &AtomicBool) -> AccessResult<DirectoryPage> {
        self.check(cancel)?;
        let path = relative_path(name, true)?;
        if limit == 0 || limit > MAX_DIRECTORY_PAGE { return Err(AccessError::BudgetExceeded); }
        if after.is_some_and(|s| s.len() > 4096) { return Err(AccessError::InvalidRequest); }
        let mut selected = BTreeMap::new();
        for entry in self.0.dir.read_dir(path).map_err(io_error)? {
            self.checkpoint(cancel)?;
            let entry = entry.map_err(io_error)?;
            let name = entry.file_name().into_string().map_err(|_| AccessError::ReadFailed)?;
            if after.is_some_and(|a| name.as_str() <= a) { continue; }
            let kind = entry.file_type().map_err(io_error)?;
            let kind = if kind.is_file() { "file" } else if kind.is_dir() { "directory" } else if kind.is_symlink() { "link" } else { "other" };
            selected.insert(name, kind.to_owned());
            if selected.len() > limit + 1 { selected.pop_last(); }
        }
        self.check(cancel)?;
        let more = selected.len() > limit;
        if more { selected.pop_last(); }
        let next = if more { selected.last_key_value().map(|(name, _)| name.clone()) } else { None };
        Ok(DirectoryPage { entries: selected.into_iter().map(|(name, kind)| DirectoryEntry { name, kind }).collect(), next })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let mut id = [0u8; 16]; getrandom::fill(&mut id).unwrap();
            // The MCP runner's nested TMPDIR can itself exceed sockaddr_un.
            // Each test still owns and removes only its random fixture directory.
            #[cfg(unix)]
            let base = PathBuf::from("/tmp");
            #[cfg(not(unix))]
            let base = std::env::temp_dir();
            let dir = base.join(format!("tfd-{:016x}", u64::from_le_bytes(id[..8].try_into().unwrap())));
            fs::create_dir(&dir).unwrap(); Self(dir)
        }
        fn root(&self) -> RootGrant { RootGrant::select(&self.0).unwrap() }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn active() -> AtomicBool { AtomicBool::new(false) }

    #[test]
    fn selected_root_reads_bytes_without_returning_absolute_paths() {
        let f = Fixture::new(); fs::write(f.0.join("prices.csv"), "中文,close\n1,10").unwrap();
        let r = f.root(); let chunk = r.read("prices.csv", 0, 4, None, &active()).unwrap();
        assert_eq!(chunk.data.len(), 4); assert!(chunk.size > 4);
        let tail = r.read("prices.csv", 4, 128, Some(&chunk.revision), &active()).unwrap();
        assert_eq!([chunk.data, tail.data].concat(), "中文,close\n1,10".as_bytes());
        assert!(!serde_json::to_string(&r.list("", None, 10, &active()).unwrap()).unwrap().contains(f.0.to_str().unwrap()));
    }
    #[test]
    fn portable_paths_cannot_escape_or_name_windows_streams_and_devices() {
        let f = Fixture::new(); let r = f.root();
        for name in ["../outside", "/etc/passwd", "C:/data", "C:\\data", "\\\\server\\share", "file:stream", "a/../../b", "x\0y", "CON", "NUL.txt", "data/COM1", "file.", "file "] {
            assert_eq!(r.read(name, 0, 10, None, &active()).unwrap_err(), AccessError::PathDenied, "{name}");
        }
    }
    #[test]
    fn revocation_and_cancellation_apply_to_all_clones() {
        let f = Fixture::new(); fs::write(f.0.join("a"), b"allowed").unwrap();
        let r = f.root(); let clone = r.clone();
        assert_eq!(r.read("a", 0, 10, None, &AtomicBool::new(true)).unwrap_err(), AccessError::Cancelled);
        r.revoke(); assert_eq!(clone.read("a", 0, 10, None, &active()).unwrap_err(), AccessError::Revoked);
        assert_eq!(clone.list("", None, 10, &active()).unwrap_err(), AccessError::Revoked);
    }
    #[test]
    fn directory_replacement_never_retargets_an_existing_grant_or_restore() {
        let f = Fixture::new(); fs::create_dir(f.0.join("data")).unwrap();
        let path = f.0.join("data"); fs::write(path.join("a"), b"old").unwrap();
        let r = RootGrant::select(&path).unwrap(); let saved = r.saved();
        #[cfg(windows)]
        {
            assert!(fs::rename(&path, f.0.join("old")).is_err(),
                "Windows must not replace a directory while the grant handle is open");
            drop(r);
        }
        #[cfg(not(windows))]
        fs::rename(&path, f.0.join("old")).unwrap();
        #[cfg(windows)]
        fs::rename(&path, f.0.join("old")).unwrap();
        fs::create_dir(&path).unwrap(); fs::write(path.join("a"), b"new").unwrap();
        #[cfg(not(windows))]
        assert_eq!(r.read("a", 0, 10, None, &active()).unwrap_err(), AccessError::RootChanged);
        assert!(matches!(RootGrant::restore(&saved), Err(AccessError::RootChanged)));
    }
    #[test]
    fn native_saved_identity_restores_only_the_same_directory() {
        let f = Fixture::new(); fs::write(f.0.join("a"), b"same").unwrap();
        let saved = f.root().saved(); let encoded = serde_json::to_vec(&saved).unwrap();
        let saved: SavedRoot = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(RootGrant::restore(&saved).unwrap().read("a", 0, 10, None, &active()).unwrap().data, b"same");
    }
    #[test]
    fn file_revision_prevents_mixing_pages_of_changed_files() {
        let f = Fixture::new(); fs::write(f.0.join("a"), b"old").unwrap(); let r = f.root();
        let first = r.read("a", 0, 1, None, &active()).unwrap();
        fs::write(f.0.join("a"), b"replacement-longer").unwrap();
        assert_eq!(r.read("a", 1, 10, Some(&first.revision), &active()).unwrap_err(), AccessError::FileChanged);
    }
    #[test]
    fn directory_pages_cover_more_than_five_thousand_files_with_bounded_pages() {
        let f = Fixture::new(); for n in 0..5017 { fs::write(f.0.join(format!("{n:05}.csv")), b"").unwrap(); }
        let r = f.root(); let mut cursor = None; let mut all = Vec::new();
        loop {
            let p = r.list("", cursor.as_deref(), 256, &active()).unwrap();
            assert!(p.entries.len() <= 256); all.extend(p.entries.into_iter().map(|e| e.name)); cursor = p.next;
            if cursor.is_none() { break; }
        }
        assert_eq!(all.len(), 5017); assert!(all.windows(2).all(|pair| pair[0] < pair[1]));
    }
    #[test]
    fn sparse_large_file_is_read_by_range_not_loaded_whole() {
        let f = Fixture::new(); let file = fs::File::create(f.0.join("large.bin")).unwrap(); file.set_len(1024*1024*1024).unwrap();
        let r = f.root(); let chunk = r.read("large.bin", 100_000_000, 4096, None, &active()).unwrap();
        assert_eq!(chunk.data.len(), 4096); assert_eq!(chunk.size, 1024*1024*1024);
        assert_eq!(r.read("large.bin", 0, 1024*1024+1, None, &active()).unwrap_err(), AccessError::BudgetExceeded);
    }
    #[cfg(unix)]
    #[test]
    fn relative_internal_symlinks_work_but_external_links_and_loops_do_not() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new(); let outside = Fixture::new(); fs::write(f.0.join("a"), b"inside").unwrap(); fs::write(outside.0.join("secret"), b"outside").unwrap();
        symlink("a", f.0.join("inside-link")).unwrap(); symlink(&outside.0, f.0.join("outside-link")).unwrap(); symlink("loop", f.0.join("loop")).unwrap();
        let r = f.root(); assert_eq!(r.read("inside-link", 0, 10, None, &active()).unwrap().data, b"inside");
        assert!(r.read("outside-link/secret", 0, 10, None, &active()).is_err()); assert!(r.read("loop", 0, 10, None, &active()).is_err());
        assert!(r.list("outside-link", None, 10, &active()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn special_files_are_not_data_streams() {
        let f = Fixture::new(); let _socket = std::os::unix::net::UnixListener::bind(f.0.join("socket")).unwrap();
        assert!(f.root().read("socket", 0, 10, None, &active()).is_err());
    }
    #[test]
    fn revoke_between_open_and_delivery_discards_bytes() {
        let f = Fixture::new(); fs::write(f.0.join("a"), b"not delivered").unwrap(); let r = f.root();
        assert_eq!(r.read_inner("a", 0, 30, None, &active(), || r.revoke()).unwrap_err(), AccessError::Revoked);
    }
    #[cfg(unix)]
    #[test]
    fn symlink_swap_race_never_reads_outside_the_selected_root() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new(); let outside = Fixture::new();
        fs::write(f.0.join("a"), b"inside").unwrap(); fs::write(outside.0.join("secret"), b"outside").unwrap();
        symlink("a", f.0.join("link")).unwrap();
        let r = f.root(); let path = f.0.clone(); let out = outside.0.join("secret");
        let swap = std::thread::spawn(move || { for n in 0..250 {
            let _ = fs::remove_file(path.join("swap"));
            symlink(if n % 2 == 0 { Path::new("a") } else { out.as_path() }, path.join("swap")).unwrap();
            fs::rename(path.join("swap"), path.join("link")).unwrap();
        } });
        for _ in 0..250 { if let Ok(c) = r.read("link", 0, 20, None, &active()) { assert_eq!(c.data, b"inside"); } }
        swap.join().unwrap();
    }
}
