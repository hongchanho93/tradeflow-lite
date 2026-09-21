use crate::workspace_state::product_data_dir;
use serde::{Deserialize, Serialize};
use std::{env, fs::{self, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}};

const PREFS_FILE: &str = "mcp-preferences-v1.json";
pub const RUNTIME_FILE: &str = "mcp-runtime-v1.json";
const TOKEN_FILE: &str = "mcp-token-v1.txt";
const TOKEN_SERVICE: &str = "tradeflow-lite.mcp";
const TOKEN_ACCOUNT: &str = "pairing-token-v1";
const MAX_SMALL_FILE: u64 = 8 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Preferences { version: u8, enabled: bool }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeEndpoint { pub version: u8, pub server_id: String, pub port: u16 }

fn valid_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn random_token() -> Result<String, String> {
    let mut data = [0u8; 32];
    getrandom::fill(&mut data).map_err(|_| "mcp_secure_storage_unavailable")?;
    Ok(data.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn root() -> Result<PathBuf, String> { product_data_dir().map_err(|_| "mcp_storage_unavailable".into()) }

fn read_small(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let mut file = match OpenOptions::new().read(true).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("mcp_storage_unavailable".into()),
    };
    if file.metadata().map_err(|_| "mcp_storage_unavailable")?.len() > MAX_SMALL_FILE {
        return Err("mcp_storage_invalid".into());
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|_| "mcp_storage_unavailable")?;
    Ok(Some(bytes))
}

fn private_file(path: &Path) -> Result<std::fs::File, String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(|_| "mcp_storage_unavailable".into())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 > MAX_SMALL_FILE { return Err("mcp_storage_invalid".into()); }
    let parent = path.parent().ok_or("mcp_storage_unavailable")?;
    fs::create_dir_all(parent).map_err(|_| "mcp_storage_unavailable")?;
    let mut nonce = [0u8; 8]; getrandom::fill(&mut nonce).map_err(|_| "mcp_storage_unavailable")?;
    let suffix: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
    let name = path.file_name().and_then(|name| name.to_str()).ok_or("mcp_storage_unavailable")?;
    let temp = parent.join(format!(".{name}.{suffix}.tmp"));
    let result = (|| {
        let mut file = private_file(&temp)?;
        file.write_all(bytes).map_err(|_| "mcp_storage_unavailable")?;
        file.sync_all().map_err(|_| "mcp_storage_unavailable")?;
        #[cfg(windows)]
        if path.exists() { fs::remove_file(path).map_err(|_| "mcp_storage_unavailable")?; }
        fs::rename(&temp, path).map_err(|_| "mcp_storage_unavailable")?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

fn enabled_at(root: &Path) -> Result<bool, String> {
    let Some(bytes) = read_small(&root.join(PREFS_FILE))? else { return Ok(false); };
    let value: Preferences = serde_json::from_slice(&bytes).map_err(|_| "mcp_storage_invalid")?;
    if value.version != 1 { return Err("mcp_storage_invalid".into()); }
    Ok(value.enabled)
}
fn set_enabled_at(root: &Path, enabled: bool) -> Result<(), String> {
    let bytes = serde_json::to_vec(&Preferences { version: 1, enabled }).map_err(|_| "mcp_storage_unavailable")?;
    write_atomic(&root.join(PREFS_FILE), &bytes)
}

fn file_token_at(root: &Path) -> Result<String, String> {
    let path = root.join(TOKEN_FILE);
    if let Some(bytes) = read_small(&path)? {
        if let Ok(value) = std::str::from_utf8(&bytes) {
            let value = value.trim();
            if valid_token(value) { return Ok(value.to_string()); }
        }
    }
    let token = random_token()?; write_atomic(&path, token.as_bytes())?; Ok(token)
}

fn should_use_file_token() -> bool {
    env::var_os("TRADEFLOW_WORKSPACE_ROOT").is_some() || !cfg!(any(target_os = "macos", target_os = "windows"))
}

fn secure_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(TOKEN_SERVICE, TOKEN_ACCOUNT).map_err(|_| "mcp_secure_storage_unavailable".into())
}

pub fn enabled() -> Result<bool, String> { enabled_at(&root()?) }
pub fn set_enabled(value: bool) -> Result<(), String> { set_enabled_at(&root()?, value) }

pub fn load_or_create_token() -> Result<String, String> {
    let root = root()?;
    if should_use_file_token() { return file_token_at(&root); }
    let entry = secure_entry()?;
    match entry.get_password() {
        Ok(value) if valid_token(&value) => Ok(value),
        Ok(_) | Err(keyring::Error::NoEntry) => {
            let token = random_token()?;
            entry.set_password(&token).map_err(|_| "mcp_secure_storage_unavailable")?;
            Ok(token)
        }
        Err(_) => Err("mcp_secure_storage_unavailable".into()),
    }
}

pub fn reset_token() -> Result<(), String> {
    let root = root()?;
    if should_use_file_token() {
        match fs::remove_file(root.join(TOKEN_FILE)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("mcp_storage_unavailable".into()),
        }
    } else {
        match secure_entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("mcp_secure_storage_unavailable".into()),
        }
    }
}

pub fn runtime_file_path() -> Result<PathBuf, String> { Ok(root()?.join(RUNTIME_FILE)) }

pub fn write_runtime(server_id: &str, port: u16) -> Result<PathBuf, String> {
    if server_id.len() != 32 || !server_id.bytes().all(|byte| byte.is_ascii_hexdigit()) || port == 0 {
        return Err("mcp_runtime_invalid".into());
    }
    let path = runtime_file_path()?;
    let bytes = serde_json::to_vec(&RuntimeEndpoint { version: 1, server_id: server_id.to_string(), port })
        .map_err(|_| "mcp_storage_unavailable")?;
    write_atomic(&path, &bytes)?; Ok(path)
}

pub fn clear_runtime(server_id: &str) {
    let Ok(path) = runtime_file_path() else { return; };
    let Ok(Some(bytes)) = read_small(&path) else { return; };
    let Ok(value) = serde_json::from_slice::<RuntimeEndpoint>(&bytes) else { return; };
    if value.server_id == server_id { let _ = fs::remove_file(path); }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let mut id = [0u8; 8]; getrandom::fill(&mut id).unwrap();
        let root = std::env::temp_dir().join(format!("tf-mcp-persistence-{:016x}", u64::from_le_bytes(id)));
        fs::create_dir_all(&root).unwrap(); root
    }
    #[test]
    fn enabled_preference_and_file_token_survive_reopen() {
        let root = fixture();
        assert!(!enabled_at(&root).unwrap()); set_enabled_at(&root, true).unwrap(); assert!(enabled_at(&root).unwrap());
        let first = file_token_at(&root).unwrap(); let second = file_token_at(&root).unwrap();
        assert_eq!(first, second); assert!(valid_token(&first)); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn runtime_file_is_stable_and_only_matching_owner_clears_it() {
        let root = fixture();
        let path = root.join(RUNTIME_FILE);
        let endpoint = RuntimeEndpoint { version: 1, server_id: "a".repeat(32), port: 12345 };
        write_atomic(&path, &serde_json::to_vec(&endpoint).unwrap()).unwrap();
        let parsed: RuntimeEndpoint = serde_json::from_slice(&read_small(&path).unwrap().unwrap()).unwrap();
        assert_eq!(parsed.port, 12345); assert_eq!(parsed.server_id, "a".repeat(32)); fs::remove_dir_all(root).unwrap();
    }
}
