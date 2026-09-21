//! Origin-independent persistence for user workspace assets.
//!
//! WebView localStorage/IndexedDB remain fast frontend stores, but their
//! identity is tied to WebView origin/profile. This native mirror uses one
//! stable product directory so user-facing dev/preview launches and a later
//! packaged build do not silently look like a fresh workspace.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, env, fs::{self, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}, sync::Mutex};
use tauri::State;

const SCHEMA: u8 = 1;
const MAX_KEY: usize = 160;
const MAX_VALUE: usize = 32 * 1024 * 1024;
const MAX_TOTAL: usize = 128 * 1024 * 1024;
const SLOT_A: &str = "workspace-state-a.json";
const SLOT_B: &str = "workspace-state-b.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    schema_version: u8,
    generation: u64,
    entries: BTreeMap<String, String>,
}

struct Loaded {
    root: PathBuf,
    generation: u64,
    entries: BTreeMap<String, String>,
}

#[derive(Default)]
pub struct WorkspaceState {
    inner: Mutex<Option<Loaded>>,
    test_root: Option<PathBuf>,
}

impl WorkspaceState {
    #[cfg(test)]
    fn at(root: PathBuf) -> Self { Self { inner: Mutex::new(None), test_root: Some(root) } }

    fn root(&self) -> Result<PathBuf, String> {
        if let Some(root) = &self.test_root { return Ok(root.clone()); }
        product_data_dir()
    }

    fn with_loaded<T>(&self, run: impl FnOnce(&mut Loaded) -> Result<T, String>) -> Result<T, String> {
        let mut inner = self.inner.lock().map_err(|_| "workspace_storage_failed")?;
        if inner.is_none() { *inner = Some(load(self.root()?)?); }
        run(inner.as_mut().ok_or("workspace_storage_failed")?)
    }

    fn load_entries(&self) -> Result<BTreeMap<String, String>, String> {
        self.with_loaded(|loaded| Ok(loaded.entries.clone()))
    }

    fn set(&self, key: String, value: String) -> Result<(), String> {
        validate_entry(&key, &value)?;
        self.with_loaded(|loaded| {
            let mut next = loaded.entries.clone();
            next.insert(key, value);
            persist_next(loaded, next)
        })
    }

    fn remove(&self, key: String) -> Result<(), String> {
        validate_key(&key)?;
        self.with_loaded(|loaded| {
            if !loaded.entries.contains_key(&key) { return Ok(()); }
            let mut next = loaded.entries.clone();
            next.remove(&key);
            persist_next(loaded, next)
        })
    }

    fn merge_missing(&self, entries: BTreeMap<String, String>) -> Result<(), String> {
        for (key, value) in &entries { validate_entry(key, value)?; }
        self.with_loaded(|loaded| {
            let mut next = loaded.entries.clone();
            let before = next.len();
            for (key, value) in entries { next.entry(key).or_insert(value); }
            if next.len() == before { return Ok(()); }
            persist_next(loaded, next)
        })
    }

    fn compare_exchange(&self, key: String, expected: Option<String>, value: Option<String>) -> Result<bool, String> {
        validate_key(&key)?;
        if let Some(value) = &value { validate_entry(&key, value)?; }
        self.with_loaded(|loaded| {
            if loaded.entries.get(&key).cloned() != expected { return Ok(false); }
            let mut next = loaded.entries.clone();
            if let Some(value) = value { next.insert(key, value); } else { next.remove(&key); }
            persist_next(loaded, next)?;
            Ok(true)
        })
    }
}

fn validate_key(key: &str) -> Result<(), String> {
    let allowed = key.starts_with("tradeflow-lite.") || key.starts_with("tradeflow_lite_");
    if !allowed || key.len() > MAX_KEY || key.contains('\0') || key.contains("desktop-e2e") {
        return Err("workspace_invalid_key".into());
    }
    Ok(())
}

fn validate_entry(key: &str, value: &str) -> Result<(), String> {
    validate_key(key)?;
    if value.len() > MAX_VALUE { return Err("workspace_storage_too_large".into()); }
    Ok(())
}

fn encoded(envelope: &Envelope) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(envelope).map_err(|_| "workspace_storage_failed")?;
    if bytes.len() > MAX_TOTAL { return Err("workspace_storage_too_large".into()); }
    Ok(bytes)
}

fn read_slot(path: &Path) -> Result<Option<Envelope>, String> {
    let mut file = match OpenOptions::new().read(true).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("workspace_storage_failed".into()),
    };
    let size = file.metadata().map_err(|_| "workspace_storage_failed")?.len();
    if size > MAX_TOTAL as u64 { return Err("workspace_storage_invalid".into()); }
    let mut bytes = Vec::with_capacity(size as usize);
    file.read_to_end(&mut bytes).map_err(|_| "workspace_storage_failed")?;
    let envelope: Envelope = serde_json::from_slice(&bytes).map_err(|_| "workspace_storage_invalid")?;
    if envelope.schema_version != SCHEMA { return Err("workspace_storage_invalid".into()); }
    for (key, value) in &envelope.entries { validate_entry(key, value).map_err(|_| "workspace_storage_invalid")?; }
    Ok(Some(envelope))
}

fn load(root: PathBuf) -> Result<Loaded, String> {
    fs::create_dir_all(&root).map_err(|_| "workspace_storage_failed")?;
    let mut valid = Vec::new();
    let mut invalid = false;
    for name in [SLOT_A, SLOT_B] {
        match read_slot(&root.join(name)) {
            Ok(Some(value)) => valid.push(value),
            Ok(None) => {}
            Err(error) if error == "workspace_storage_invalid" => invalid = true,
            Err(error) => return Err(error),
        }
    }
    if valid.is_empty() && invalid { return Err("workspace_storage_invalid".into()); }
    valid.sort_by_key(|value| value.generation);
    let latest = valid.pop().unwrap_or(Envelope { schema_version: SCHEMA, generation: 0, entries: BTreeMap::new() });
    Ok(Loaded { root, generation: latest.generation, entries: latest.entries })
}

fn persist_next(loaded: &mut Loaded, entries: BTreeMap<String, String>) -> Result<(), String> {
    let generation = loaded.generation.checked_add(1).ok_or("workspace_storage_failed")?;
    let envelope = Envelope { schema_version: SCHEMA, generation, entries };
    let bytes = encoded(&envelope)?;
    let target = loaded.root.join(if generation % 2 == 0 { SLOT_A } else { SLOT_B });
    let mut file = OpenOptions::new().write(true).create(true).truncate(true).open(target)
        .map_err(|_| "workspace_storage_failed")?;
    file.write_all(&bytes).map_err(|_| "workspace_storage_failed")?;
    file.sync_all().map_err(|_| "workspace_storage_failed")?;
    loaded.generation = generation;
    loaded.entries = envelope.entries;
    Ok(())
}

/// Stable product directory. The private desktop runners override it so test
/// identities never read or write the real user's workspace.
pub(crate) fn product_data_dir() -> Result<PathBuf, String> {
    if let Ok(root) = env::var("TRADEFLOW_WORKSPACE_ROOT") {
        let path = PathBuf::from(root);
        if path.is_absolute() { return Ok(path); }
        return Err("workspace_storage_failed".into());
    }
    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME").ok_or("workspace_storage_failed")?;
        return Ok(PathBuf::from(home).join("Library/Application Support/TradeFlow Lite"));
    }
    #[cfg(target_os = "windows")]
    {
        let root = env::var_os("APPDATA").ok_or("workspace_storage_failed")?;
        return Ok(PathBuf::from(root).join("TradeFlow Lite"));
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        if let Some(root) = env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(root).join("tradeflow-lite"));
        }
        let home = env::var_os("HOME").ok_or("workspace_storage_failed")?;
        Ok(PathBuf::from(home).join(".local/share/tradeflow-lite"))
    }
}

#[tauri::command]
pub fn workspace_state_load(state: State<'_, WorkspaceState>) -> Result<BTreeMap<String, String>, String> {
    state.load_entries()
}

#[tauri::command]
pub fn workspace_state_set(state: State<'_, WorkspaceState>, key: String, value: String) -> Result<(), String> {
    state.set(key, value)
}

#[tauri::command]
pub fn workspace_state_remove(state: State<'_, WorkspaceState>, key: String) -> Result<(), String> {
    state.remove(key)
}

#[tauri::command]
pub fn workspace_state_merge(state: State<'_, WorkspaceState>, entries: BTreeMap<String, String>) -> Result<(), String> {
    state.merge_missing(entries)
}

#[tauri::command]
pub fn workspace_state_compare_exchange(
    state: State<'_, WorkspaceState>,
    key: String,
    expected: Option<String>,
    value: Option<String>,
) -> Result<bool, String> {
    state.compare_exchange(key, expected, value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let mut id = [0u8; 16]; getrandom::fill(&mut id).unwrap();
        let root = std::env::temp_dir().join(format!("tf-workspace-{:016x}", u64::from_le_bytes(id[..8].try_into().unwrap())));
        fs::create_dir_all(&root).unwrap(); root
    }
    #[test]
    fn two_slot_store_survives_a_torn_latest_slot_and_keeps_previous_generation() {
        let root = fixture(); let state = WorkspaceState::at(root.clone());
        state.set("tradeflow-lite.watchlist.v1".into(), "first".into()).unwrap();
        state.set("tradeflow-lite.watchlist.v1".into(), "second".into()).unwrap();
        // generation 2 is slot A; corrupt it and reopen from slot B generation 1.
        fs::write(root.join(SLOT_A), b"{torn").unwrap();
        let reopened = WorkspaceState::at(root.clone());
        assert_eq!(reopened.load_entries().unwrap().get("tradeflow-lite.watchlist.v1").unwrap(), "first");
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn merge_migrates_only_missing_browser_values_and_invalid_keys_never_persist() {
        let root = fixture(); let state = WorkspaceState::at(root.clone());
        state.set("tradeflow-lite.watchlist.v1".into(), "native".into()).unwrap();
        state.merge_missing(BTreeMap::from([
            ("tradeflow-lite.watchlist.v1".into(), "browser".into()),
            ("tradeflow_lite_resolution_favorites_v1".into(), "[\"1D\"]".into()),
        ])).unwrap();
        let entries = state.load_entries().unwrap();
        assert_eq!(entries.get("tradeflow-lite.watchlist.v1").unwrap(), "native");
        assert_eq!(entries.get("tradeflow_lite_resolution_favorites_v1").unwrap(), "[\"1D\"]");
        assert!(state.set("other-app.key".into(), "x".into()).is_err());
        assert!(state.set("tradeflow-lite.user-indicator-desktop-e2e.run".into(), "x".into()).is_err());
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn compare_exchange_is_atomic_and_does_not_overwrite_a_newer_writer() {
        let root = fixture(); let state = WorkspaceState::at(root.clone());
        let key = "tradeflow-lite.indicators.v1".to_string();
        assert!(state.compare_exchange(key.clone(), None, Some("one".into())).unwrap());
        assert!(!state.compare_exchange(key.clone(), None, Some("stale".into())).unwrap());
        assert!(state.compare_exchange(key.clone(), Some("one".into()), Some("two".into())).unwrap());
        assert_eq!(state.load_entries().unwrap().get(&key).unwrap(), "two");
        let _ = fs::remove_dir_all(root);
    }
}
