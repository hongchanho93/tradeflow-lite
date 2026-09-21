mod profile;
mod stream;
mod network;
#[cfg(test)] mod tests;

use std::{collections::HashMap, sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}}};
use tauri::{Manager, State, WebviewWindow};
use tokio::sync::{mpsc, watch};
use serde::Deserialize;
use serde_json::Value;
use profile::{ApiResult, OsVault, ProfileView, Settings, StoredProfile, Vault};
use network::Frame;

pub(super) const MAX_REQUEST: usize = 64 * 1024 * 1024;

struct Active { profile: StoredProfile, view: ProfileView, lifecycle: u64 }
struct Job { rx: tokio::sync::Mutex<mpsc::Receiver<Frame>>, stop: watch::Sender<bool> }
pub struct ApiState {
    profile: Arc<tokio::sync::Mutex<Option<Active>>>,
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    lifecycle: AtomicU64,
    slots: Arc<tokio::sync::Semaphore>,
}
impl Default for ApiState {
    fn default() -> Self { Self { profile: Arc::new(tokio::sync::Mutex::new(None)), jobs: Mutex::new(HashMap::new()),
        lifecycle: AtomicU64::new(0), slots: Arc::new(tokio::sync::Semaphore::new(2)) } }
}
impl ApiState {
    pub fn reset(&self) {
        self.lifecycle.fetch_add(1, Ordering::AcqRel);
        self.cancel_all();
        if let Ok(mut value) = self.profile.try_lock() { *value = None; }
    }
    fn cancel_all(&self) {
        for job in self.jobs.lock().unwrap().drain().map(|(_, job)| job) { let _ = job.stop.send(true); }
    }
    async fn next_frame(&self, request_id: &str) -> ApiResult<Frame> {
        let job = self.jobs.lock().unwrap().get(request_id).cloned().ok_or("request_closed")?;
        let mut receiver = job.rx.try_lock().map_err(|_| "api_busy")?;
        let frame = receiver.recv().await.unwrap_or(Frame::Error { code: "request_closed" });
        let mut jobs = self.jobs.lock().unwrap();
        if !jobs.get(request_id).is_some_and(|current| Arc::ptr_eq(current, &job)) { return Err("request_closed"); }
        if matches!(frame, Frame::Done | Frame::Error { .. }) { jobs.remove(request_id); }
        Ok(frame)
    }
}
fn allowed(window: &WebviewWindow) -> ApiResult<()> { if window.label() == "main" { Ok(()) } else { Err("window_denied") } }
fn vault(window: &WebviewWindow) -> OsVault { OsVault(window.app_handle().config().identifier.clone()) }
fn revision() -> ApiResult<String> {
    let mut bytes = [0u8; 16]; getrandom::fill(&mut bytes).map_err(|_| "random_unavailable")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn prepare_profile(settings: Settings, key: Option<String>, old: Option<&StoredProfile>) -> ApiResult<StoredProfile> {
    let key = match key {
        Some(value) => value,
        None => {
            let old = old.ok_or("api_key_required")?;
            if old.settings.endpoint != settings.endpoint || old.settings.protocol != settings.protocol {
                return Err("endpoint_change_requires_key");
            }
            old.key.clone()
        }
    };
    let profile = StoredProfile { settings, key }; profile.validate()?; Ok(profile)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configure { settings: Settings, key: Option<String>, remember: bool, expected_revision: Option<String> }

#[tauri::command]
pub async fn ai_api_configure(window: WebviewWindow, state: State<'_, ApiState>, input: Configure) -> Result<ProfileView, String> {
    allowed(&window)?; input.settings.validate()?;
    let lifecycle = state.lifecycle.load(Ordering::Acquire);
    let mut current = state.profile.lock().await;
    if current.as_ref().is_some_and(|p| p.lifecycle != lifecycle) { *current = None; }
    if current.as_ref().map(|v| &v.view.revision) != input.expected_revision.as_ref() { return Err("configuration_stale".into()); }
    let profile = prepare_profile(input.settings, input.key, current.as_ref().map(|p| &p.profile))?;
    let view = ProfileView { revision: revision()?, settings: profile.settings.clone(), has_key: !profile.key.is_empty(), remembered: input.remember };
    // A new memory-only profile must not require OS-store access. It does not
    // overwrite an older profile that has not been loaded. Opting out after a
    // remembered profile was loaded explicitly deletes that known saved entry.
    if input.remember || current.as_ref().is_some_and(|p| p.view.remembered) {
        let store = vault(&window); let value = input.remember.then(|| profile.clone());
        tauri::async_runtime::spawn_blocking(move || store.save(value.as_ref())).await.map_err(|_| "secure_storage_unavailable")??;
    }
    if state.lifecycle.load(Ordering::Acquire) != lifecycle { *current = None; return Err("configuration_stale".into()); }
    state.cancel_all(); *current = Some(Active { profile, view: view.clone(), lifecycle }); Ok(view)
}

#[tauri::command]
pub async fn ai_api_load(window: WebviewWindow, state: State<'_, ApiState>) -> Result<Option<ProfileView>, String> {
    allowed(&window)?;
    let lifecycle = state.lifecycle.load(Ordering::Acquire);
    let mut current = state.profile.lock().await;
    if current.as_ref().is_some_and(|p| p.lifecycle != lifecycle) { *current = None; }
    if let Some(value) = current.as_ref() { return Ok(Some(value.view.clone())); }
    let store = vault(&window);
    let saved = tauri::async_runtime::spawn_blocking(move || store.load()).await.map_err(|_| "secure_storage_unavailable")??;
    if state.lifecycle.load(Ordering::Acquire) != lifecycle { *current = None; return Err("configuration_stale".into()); }
    if let Some(profile) = saved {
        let view = ProfileView { revision: revision()?, settings: profile.settings.clone(), has_key: !profile.key.is_empty(), remembered: true };
        *current = Some(Active { profile, view: view.clone(), lifecycle }); Ok(Some(view))
    } else { Ok(None) }
}

#[tauri::command]
pub async fn ai_api_forget(window: WebviewWindow, state: State<'_, ApiState>) -> Result<(), String> {
    allowed(&window)?;
    let mut current = state.profile.lock().await; state.cancel_all(); *current = None;
    let store = vault(&window);
    tauri::async_runtime::spawn_blocking(move || store.save(None)).await.map_err(|_| "secure_storage_unavailable")??; Ok(())
}

#[tauri::command]
pub async fn ai_api_start(window: WebviewWindow, state: State<'_, ApiState>, request_id: String, profile_revision: String, payload: Value) -> Result<(), String> {
    allowed(&window)?;
    if request_id.len() != 36 || !request_id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') { return Err("invalid_request".into()); }
    let current = state.profile.lock().await;
    let active = current.as_ref().filter(|p| p.view.revision == profile_revision && p.lifecycle == state.lifecycle.load(Ordering::Acquire)).ok_or("configuration_stale")?;
    network::validate_payload(&active.profile, &payload)?;
    if serde_json::to_vec(&payload).map_err(|_| "invalid_request")?.len() > MAX_REQUEST { return Err("request_too_large".into()); }
    let mut jobs = state.jobs.lock().unwrap();
    if jobs.len() >= 2 { return Err("api_busy".into()); }
    if jobs.contains_key(&request_id) { return Err("request_conflict".into()); }
    // Cancellation does not reclaim this slot until the network future exits.
    let slot = state.slots.clone().try_acquire_owned().map_err(|_| "api_busy")?;
    let (tx, rx) = mpsc::channel(4); let (stop, signal) = watch::channel(false);
    jobs.insert(request_id, Arc::new(Job { rx: tokio::sync::Mutex::new(rx), stop }));
    let profile = active.profile.clone();
    tauri::async_runtime::spawn(async move { let _slot = slot; network::perform(profile, payload, tx, signal).await; }); Ok(())
}
#[tauri::command]
pub async fn ai_api_next(window: WebviewWindow, state: State<'_, ApiState>, request_id: String) -> Result<Frame, String> {
    allowed(&window)?;
    state.next_frame(&request_id).await.map_err(String::from)
}
#[tauri::command]
pub fn ai_api_cancel(window: WebviewWindow, state: State<'_, ApiState>, request_id: String) -> Result<(), String> {
    allowed(&window)?;
    if let Some(job) = state.jobs.lock().unwrap().remove(&request_id) { let _ = job.stop.send(true); } Ok(())
}
