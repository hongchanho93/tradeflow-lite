mod broker;
mod persistence;
mod stdio;
mod wire;
#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex};
use tauri::{State, WebviewWindow, ipc::Channel};
use broker::{BridgeEvent, Broker, ConnectionConfig};

#[derive(Default)]
pub struct McpState { run: Mutex<Option<Arc<Broker>>> }
impl McpState {
    pub fn stop(&self) {
        if let Some(run) = self.run.lock().unwrap().take() { let id = run.id.clone(); run.stop(); persistence::clear_runtime(&id); }
    }
    fn current(&self, id: &str) -> Result<Arc<Broker>, String> {
        self.run.lock().unwrap().as_ref().filter(|b| b.id == id).cloned().ok_or_else(|| "mcp_not_running".into())
    }
}
impl Drop for McpState { fn drop(&mut self) { self.stop(); } }
fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("mcp_window_denied".into()) }
}

#[tauri::command]
pub fn ai_mcp_start(window: WebviewWindow, state: State<'_, McpState>, channel: Channel<BridgeEvent>, remember: bool) -> Result<ConnectionConfig, String> {
    main_window(&window)?;
    let mut active = state.run.lock().unwrap();
    if active.is_some() { return Err("mcp_already_running".into()); }
    let executable = std::env::current_exe().ok().and_then(|p| p.into_os_string().into_string().ok()).ok_or("mcp_executable_unavailable")?;
    let token = persistence::load_or_create_token()?;
    let run = Broker::start_with_token(Arc::new(move |event| channel.send(event).is_ok()), token).map_err(|_| "mcp_start_failed")?;
    let runtime = match persistence::write_runtime(&run.id, run.port()) {
        Ok(path) => path,
        Err(error) => { run.stop(); return Err(error); }
    };
    if remember { if let Err(error) = persistence::set_enabled(true) { run.stop(); persistence::clear_runtime(&run.id); return Err(error); } }
    let config = run.config(executable, runtime.into_os_string().into_string().map_err(|_| "mcp_runtime_invalid")?);
    *active = Some(run); Ok(config)
}
#[tauri::command]
pub fn ai_mcp_stop(window: WebviewWindow, state: State<'_, McpState>, server_id: String, disable: bool) -> Result<(), String> {
    main_window(&window)?;
    let mut active = state.run.lock().unwrap();
    if active.as_ref().is_some_and(|b| b.id == server_id) {
        if disable { persistence::set_enabled(false)?; }
        let run = active.take().unwrap(); run.stop(); persistence::clear_runtime(&server_id); Ok(())
    } else { Err("mcp_not_running".into()) }
}
#[tauri::command]
pub fn ai_mcp_enabled(window: WebviewWindow) -> Result<bool, String> { main_window(&window)?; persistence::enabled() }
#[tauri::command]
pub fn ai_mcp_reset_credentials(window: WebviewWindow, state: State<'_, McpState>) -> Result<(), String> {
    main_window(&window)?;
    if state.run.lock().unwrap().is_some() { return Err("mcp_running".into()); }
    persistence::reset_token()
}
#[tauri::command]
pub async fn ai_mcp_finish(window: WebviewWindow, state: State<'_, McpState>, server_id: String,
    connection_id: String, sequence: u64, response: Option<String>) -> Result<(), String> {
    main_window(&window)?;
    let run = state.current(&server_id)?;
    tauri::async_runtime::spawn_blocking(move || run.finish(&connection_id, sequence, response))
        .await.map_err(|_| "mcp_reply_failed")?.map_err(|_| "mcp_reply_failed".into())
}
#[tauri::command]
pub async fn ai_mcp_tools_changed(window: WebviewWindow, state: State<'_, McpState>, server_id: String,
    connection_id: String) -> Result<(), String> {
    main_window(&window)?;
    let run = state.current(&server_id)?;
    let Some(job) = run.reserve_tools_changed(&connection_id).map_err(|_| "mcp_notification_failed")? else { return Ok(()); };
    tauri::async_runtime::spawn_blocking(move || job.send())
        .await.map_err(|_| "mcp_notification_failed")?.map_err(|_| "mcp_notification_failed".into())
}
#[tauri::command]
pub fn ai_mcp_disconnect(window: WebviewWindow, state: State<'_, McpState>, server_id: String, connection_id: String) -> Result<(), String> {
    main_window(&window)?;
    state.current(&server_id)?.disconnect(&connection_id); Ok(())
}

pub fn run_stdio() -> i32 {
    match stdio::run() {
        Ok(()) => 0,
        Err(error) if error.to_string().starts_with("mcp_session_limit:") => {
            let message = error.to_string();
            let limit = message.split(':').nth(1).unwrap_or("8");
            eprintln!("TradeFlow MCP: session limit reached (limit {limit}); close an unused MCP client and retry");
            1
        }
        Err(_) => { eprintln!("TradeFlow MCP: connection closed or invalid local configuration"); 1 }
    }
}
