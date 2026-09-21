use super::{library::{Change, ChangeReceipt, Library, PreparedChange, SourceInfo}, state::{DataRequest, UserDataState}};
use serde_json::Value;
use std::{sync::atomic::Ordering, time::Instant};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

fn allowed(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("data_window_denied".into()) }
}
async fn with_library<T: Send + 'static>(app: AppHandle, state: UserDataState,
    run: impl FnOnce(&mut Library) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let epoch = state.epoch(); let check = state.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        state.initialize(&app, epoch)?; state.with_library(epoch, run)
    }).await.map_err(|_| "data_storage_failed")?;
    if check.epoch() != epoch { return Err("data_cancelled".into()); } result
}

#[tauri::command]
pub async fn user_data_list(window: WebviewWindow, app: AppHandle, state: State<'_, UserDataState>) -> Result<Vec<SourceInfo>, String> {
    allowed(&window)?; with_library(app, state.inner().clone(), |l| Ok(l.list())).await
}
#[tauri::command]
pub async fn user_data_source(window: WebviewWindow, app: AppHandle, state: State<'_, UserDataState>, source_id: String, revision: String) -> Result<Option<String>, String> {
    allowed(&window)?; with_library(app, state.inner().clone(), move |l| l.source(&source_id, &revision)).await
}
#[tauri::command]
pub async fn user_data_pick(window: WebviewWindow, app: AppHandle, state: State<'_, UserDataState>, replacement_id: Option<String>) -> Result<Option<SourceInfo>, String> {
    allowed(&window)?;
    let state = state.inner().clone(); let epoch = state.epoch(); let initialize = state.clone();
    tauri::async_runtime::spawn_blocking(move || initialize.initialize(&app, epoch)).await.map_err(|_| "data_storage_failed")??;
    let lease = state.begin_picker(replacement_id)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    // No JavaScript dialog/filesystem plugin permission is granted. No path
    // parameter, default home selection, model tool, or arbitrary grant command.
    window.dialog().file().set_parent(&window).set_title("添加我的数据 · 只选择数据目录")
        .set_can_create_directories(false).pick_folder(move |path| { let _ = send.send(path); });
    let path = receive.await.map_err(|_| "data_picker_cancelled")?
        .map(|path| path.into_path().map_err(|_| "data_path_denied")).transpose()?;
    tauri::async_runtime::spawn_blocking(move || lease.complete(path.as_deref())).await.map_err(|_| "data_read_failed")?
}
#[tauri::command]
pub async fn user_data_prepare(window: WebviewWindow, app: AppHandle, state: State<'_, UserDataState>, source_id: String, revision: String, change: Change) -> Result<PreparedChange, String> {
    allowed(&window)?; with_library(app, state.inner().clone(), move |l| l.prepare(&source_id, &revision, change)).await
}
#[tauri::command]
pub async fn user_data_commit(window: WebviewWindow, app: AppHandle, state: State<'_, UserDataState>, ticket_id: String) -> Result<ChangeReceipt, String> {
    allowed(&window)?; with_library(app, state.inner().clone(), move |l| l.commit(&ticket_id)).await
}
#[tauri::command]
pub async fn user_data_rollback(window: WebviewWindow, app: AppHandle, state: State<'_, UserDataState>, ticket_id: String) -> Result<(), String> {
    allowed(&window)?; with_library(app, state.inner().clone(), move |l| l.rollback(&ticket_id)).await
}
#[tauri::command]
pub async fn user_data_finish(window: WebviewWindow, app: AppHandle, state: State<'_, UserDataState>, ticket_id: String) -> Result<(), String> {
    allowed(&window)?; with_library(app, state.inner().clone(), move |l| { l.finish(&ticket_id); Ok(()) }).await
}
#[tauri::command]
pub fn user_data_begin(window: WebviewWindow, state: State<'_, UserDataState>, input: DataRequest) -> Result<String, String> {
    allowed(&window)?; state.reserve(input)
}
#[tauri::command]
pub async fn user_data_execute(window: WebviewWindow, state: State<'_, UserDataState>, request_id: String) -> Result<Value, String> {
    allowed(&window)?; let lease = state.start(&request_id)?; let job = lease.job.clone();
    let remaining = job.deadline.saturating_duration_since(Instant::now());
    let work = tauri::async_runtime::spawn_blocking(move || lease.execute());
    let result = tokio::select! {
        result = work => result.map_err(|_| "data_read_failed")?,
        _ = tokio::time::sleep(remaining) => { job.cancelled.store(true, Ordering::Release); return Err("data_timeout".into()); }
    };
    job.check()?; result
}
#[tauri::command]
pub fn user_data_cancel(window: WebviewWindow, state: State<'_, UserDataState>, request_id: String) -> Result<(), String> {
    allowed(&window)?; state.cancel(&request_id); Ok(())
}
