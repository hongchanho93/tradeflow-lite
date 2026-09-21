use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};

const MAX_CONTENT_BYTES: usize = 16 * 1024 * 1024;
const MAX_FOLDER_CHARS: usize = 512;
const MAX_FILENAME_CHARS: usize = 180;

#[derive(Default)]
pub struct AiResultFileState {
    pending: Mutex<HashMap<String, PreparedFile>>,
}

#[derive(Clone)]
struct PreparedFile {
    temp: PathBuf,
    target: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultFileInput {
    destination: String,
    folder: Option<String>,
    filename: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedResultFile {
    ticket: String,
    destination: String,
    display_path: String,
    filename: String,
    bytes: usize,
}

fn result_error(code: &str) -> String { code.to_string() }

fn allowed_extension(filename: &str) -> bool {
    Path::new(filename).extension().and_then(|value| value.to_str())
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "md" | "txt" | "csv" | "json" | "tsv"))
}

fn validate_filename(filename: &str) -> Result<(), String> {
    if filename.is_empty() || filename.chars().count() > MAX_FILENAME_CHARS || !allowed_extension(filename) {
        return Err(result_error("result_file_invalid_name"));
    }
    let mut components = Path::new(filename).components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return Err(result_error("result_file_invalid_name"));
    }
    if filename.chars().any(|ch| ch == '\0' || ch == '/' || ch == '\\' || ch.is_control()) {
        return Err(result_error("result_file_invalid_name"));
    }
    Ok(())
}

fn folder_components(folder: Option<&str>) -> Result<Vec<String>, String> {
    let Some(folder) = folder.map(str::trim).filter(|value| !value.is_empty()) else { return Ok(Vec::new()); };
    if folder.chars().count() > MAX_FOLDER_CHARS || folder.contains('\0') { return Err(result_error("result_file_invalid_folder")); }
    let mut result = Vec::new();
    for component in Path::new(folder).components() {
        match component {
            Component::Normal(value) => {
                let value = value.to_str().ok_or_else(|| result_error("result_file_invalid_folder"))?;
                if value.is_empty() || value.chars().any(|ch| ch.is_control()) { return Err(result_error("result_file_invalid_folder")); }
                result.push(value.to_string());
            }
            _ => return Err(result_error("result_file_invalid_folder")),
        }
    }
    Ok(result)
}

fn resolve_folder(root: &Path, folder: Option<&str>) -> Result<PathBuf, String> {
    let canonical_root = fs::canonicalize(root).map_err(|_| result_error("result_file_location_unavailable"))?;
    let mut current = canonical_root.clone();
    for component in folder_components(folder)? {
        current.push(component);
        if current.exists() {
            let canonical = fs::canonicalize(&current).map_err(|_| result_error("result_file_invalid_folder"))?;
            if !canonical.starts_with(&canonical_root) { return Err(result_error("result_file_invalid_folder")); }
            current = canonical;
        } else {
            fs::create_dir(&current).map_err(|_| result_error("result_file_write_failed"))?;
        }
    }
    Ok(current)
}

fn unique_target(folder: &Path, filename: &str, pending: &HashMap<String, PreparedFile>) -> Result<PathBuf, String> {
    let original = Path::new(filename);
    let stem = original.file_stem().and_then(|value| value.to_str()).ok_or_else(|| result_error("result_file_invalid_name"))?;
    let extension = original.extension().and_then(|value| value.to_str()).ok_or_else(|| result_error("result_file_invalid_name"))?;
    for index in 1..=10_000 {
        let candidate = if index == 1 { filename.to_string() } else { format!("{stem}-{index}.{extension}") };
        let path = folder.join(candidate);
        if !path.exists() && !pending.values().any(|item| item.target == path) { return Ok(path); }
    }
    Err(result_error("result_file_capacity"))
}

fn random_ticket() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|_| result_error("result_file_write_failed"))?;
    Ok(bytes.iter().map(|value| format!("{value:02x}")).collect())
}

fn prepare_in_root(
    state: &AiResultFileState,
    root: &Path,
    label: &str,
    input: ResultFileInput,
) -> Result<PreparedResultFile, String> {
    validate_filename(&input.filename)?;
    let content = input.content.as_bytes();
    if content.len() > MAX_CONTENT_BYTES { return Err(result_error("result_file_too_large")); }
    let folder = resolve_folder(root, input.folder.as_deref())?;
    let mut pending = state.pending.lock().map_err(|_| result_error("result_file_write_failed"))?;
    let target = unique_target(&folder, &input.filename, &pending)?;
    let ticket = random_ticket()?;
    let temp = folder.join(format!(".tradeflow-lite-{ticket}.tmp"));
    let mut file = OpenOptions::new().create_new(true).write(true).open(&temp).map_err(|_| result_error("result_file_write_failed"))?;
    if file.write_all(content).and_then(|_| file.sync_all()).is_err() {
        let _ = fs::remove_file(&temp);
        return Err(result_error("result_file_write_failed"));
    }
    let actual_name = target.file_name().and_then(|value| value.to_str()).ok_or_else(|| result_error("result_file_invalid_name"))?.to_string();
    let relative = input.folder.as_deref().map(str::trim).filter(|value| !value.is_empty())
        .map(|folder| format!("{label}/{folder}/{actual_name}")).unwrap_or_else(|| format!("{label}/{actual_name}"));
    let prepared = PreparedFile { temp, target };
    pending.insert(ticket.clone(), prepared);
    Ok(PreparedResultFile { ticket, destination: input.destination, display_path: relative, filename: actual_name, bytes: content.len() })
}

impl AiResultFileState {
    pub fn reset(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            for item in pending.values() { let _ = fs::remove_file(&item.temp); }
            pending.clear();
        }
    }
}

#[tauri::command]
pub fn ai_result_prepare(app: AppHandle, state: State<'_, AiResultFileState>, input: ResultFileInput) -> Result<PreparedResultFile, String> {
    if let Ok(root) = env::var("TRADEFLOW_RESULT_ROOT") {
        let root = PathBuf::from(root);
        fs::create_dir_all(&root).map_err(|_| result_error("result_file_location_unavailable"))?;
        return prepare_in_root(&state, &root, "测试输出", input);
    }
    let (root, label) = match input.destination.as_str() {
        "desktop" => (app.path().desktop_dir().map_err(|_| result_error("result_file_location_unavailable"))?, "桌面"),
        "documents" => (app.path().document_dir().map_err(|_| result_error("result_file_location_unavailable"))?, "文档"),
        "downloads" => (app.path().download_dir().map_err(|_| result_error("result_file_location_unavailable"))?, "下载"),
        _ => return Err(result_error("result_file_invalid_location")),
    };
    prepare_in_root(&state, &root, label, input)
}

#[tauri::command]
pub fn ai_result_commit(state: State<'_, AiResultFileState>, ticket: String) -> Result<(), String> {
    let prepared = {
        let pending = state.pending.lock().map_err(|_| result_error("result_file_write_failed"))?;
        pending.get(&ticket).cloned().ok_or_else(|| result_error("result_file_unavailable"))?
    };
    let mut source = OpenOptions::new().read(true).open(&prepared.temp).map_err(|_| result_error("result_file_write_failed"))?;
    let mut target = OpenOptions::new().create_new(true).write(true).open(&prepared.target).map_err(|_| result_error("result_file_conflict"))?;
    let copied = std::io::copy(&mut source, &mut target).and_then(|_| target.sync_all());
    if copied.is_err() {
        let _ = fs::remove_file(&prepared.target);
        return Err(result_error("result_file_write_failed"));
    }
    let _ = fs::remove_file(&prepared.temp);
    if let Ok(mut pending) = state.pending.lock() { pending.remove(&ticket); }
    Ok(())
}

#[tauri::command]
pub fn ai_result_rollback(state: State<'_, AiResultFileState>, ticket: String) -> Result<(), String> {
    let prepared = state.pending.lock().map_err(|_| result_error("result_file_write_failed"))?.remove(&ticket);
    if let Some(prepared) = prepared { let _ = fs::remove_file(prepared.temp); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "tradeflow-lite-result-files-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
    fn input(folder: Option<&str>, filename: &str, content: &str) -> ResultFileInput {
        ResultFileInput {
            destination: "desktop".into(), folder: folder.map(str::to_string),
            filename: filename.into(), content: content.into(),
        }
    }

    #[test]
    fn nested_result_file_is_prepared_committed_and_collision_gets_a_new_name() {
        let root = temp_root(); let state = AiResultFileState::default();
        let first = prepare_in_root(&state, &root, "桌面", input(Some("研究结果"), "复盘.md", "# 结果")).unwrap();
        assert_eq!(first.display_path, "桌面/研究结果/复盘.md");
        {
            let prepared = state.pending.lock().unwrap().get(&first.ticket).cloned().unwrap();
            let mut source = OpenOptions::new().read(true).open(&prepared.temp).unwrap();
            let mut target = OpenOptions::new().create_new(true).write(true).open(&prepared.target).unwrap();
            std::io::copy(&mut source, &mut target).unwrap(); target.sync_all().unwrap();
            fs::remove_file(&prepared.temp).unwrap(); state.pending.lock().unwrap().remove(&first.ticket);
        }
        assert_eq!(fs::read_to_string(root.join("研究结果/复盘.md")).unwrap(), "# 结果");
        let second = prepare_in_root(&state, &root, "桌面", input(Some("研究结果"), "复盘.md", "第二份")).unwrap();
        assert_eq!(second.filename, "复盘-2.md");
        state.reset(); let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn result_writer_rejects_escape_and_executable_extensions() {
        let root = temp_root(); let state = AiResultFileState::default();
        assert!(prepare_in_root(&state, &root, "桌面", input(Some("../外部"), "a.md", "x")).is_err());
        assert!(prepare_in_root(&state, &root, "桌面", input(None, "../a.md", "x")).is_err());
        assert!(prepare_in_root(&state, &root, "桌面", input(None, "a.sh", "x")).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
