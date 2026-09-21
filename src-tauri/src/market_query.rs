//! Independent, bounded Router requests. Never activates a foreground history incarnation.
use std::{cell::RefCell, collections::HashMap, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, time::{Duration, Instant}};
use serde::Deserialize;
use serde_json::Value;
use tauri::{State, WebviewWindow};
use crate::{contracts::{Adjustment, Resolution, Symbol, SymbolKind}, market_router::{HistoryRequest, MarketRouter, QuoteRequest}};

const QUERY_SLOTS: usize = 4;
const QUERY_DEADLINE: Duration = Duration::from_secs(120);

#[derive(Clone, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum QueryInput {
    History { provider_id: String, symbol: String, kind: SymbolKind, resolution: Resolution, adjustment: Adjustment, count: usize },
    Quote { provider_id: String, symbol: String, kind: SymbolKind },
}
impl QueryInput {
    fn validate(&self) -> Result<(), String> {
        let (provider, symbol) = match self {
            Self::History { provider_id, symbol, count, .. } => {
                if !(2..=12_000).contains(count) { return Err("invalid_request".into()); }
                (provider_id, symbol)
            }
            Self::Quote { provider_id, symbol, .. } => (provider_id, symbol),
        };
        if provider.is_empty() || provider.len() > 64 || !provider.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)) {
            return Err("invalid_request".into());
        }
        canonical_symbol(symbol).map(|_| ())
    }
}
fn canonical_symbol(value: &str) -> Result<Symbol, String> {
    let (venue, code) = value.split_once(':').ok_or("invalid_symbol")?;
    let symbol = Symbol::new(venue, code).map_err(|_| "invalid_symbol")?;
    if symbol.as_str() != value { return Err("invalid_symbol".into()); }
    Ok(symbol)
}

struct QueryJob { input: QueryInput, cancelled: AtomicBool, started: AtomicBool, deadline: Instant, epoch: u64, lifecycle: Arc<AtomicU64> }
impl QueryJob {
    fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) || self.lifecycle.load(Ordering::Acquire) != self.epoch { return Err("cancelled".into()); }
        if Instant::now() >= self.deadline { return Err("timeout".into()); }
        Ok(())
    }
}
thread_local! { static CURRENT: RefCell<Option<Arc<QueryJob>>> = const { RefCell::new(None) }; }
pub(crate) fn is_independent() -> bool { CURRENT.with(|slot| slot.borrow().is_some()) }
pub(crate) fn check_active() -> Result<(), String> {
    CURRENT.with(|slot| slot.borrow().as_ref().map_or(Ok(()), |job| job.check()))
}
fn with_scope<T>(job: Arc<QueryJob>, run: impl FnOnce() -> T) -> T {
    CURRENT.with(|slot| {
        struct Restore<'a>(&'a RefCell<Option<Arc<QueryJob>>>, Option<Arc<QueryJob>>);
        impl Drop for Restore<'_> { fn drop(&mut self) { self.0.replace(self.1.take()); } }
        let _restore = Restore(slot, slot.replace(Some(job)));
        run()
    })
}

#[derive(Clone, Default)]
pub struct MarketQueryState { jobs: Arc<Mutex<HashMap<String, Arc<QueryJob>>>>, lifecycle: Arc<AtomicU64> }
struct QueryLease { id: String, job: Arc<QueryJob>, state: MarketQueryState }
impl Drop for QueryLease {
    fn drop(&mut self) {
        if let Ok(mut jobs) = self.state.jobs.lock() {
            if jobs.get(&self.id).is_some_and(|job| Arc::ptr_eq(job, &self.job)) { jobs.remove(&self.id); }
        }
    }
}
impl MarketQueryState {
    fn reserve(&self, input: QueryInput) -> Result<String, String> {
        input.validate()?;
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes).map_err(|_| "random_unavailable")?;
        let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let mut jobs = self.jobs.lock().map_err(|_| "query_unavailable")?;
        jobs.retain(|_, job| job.started.load(Ordering::Acquire) || job.check().is_ok());
        if jobs.len() >= QUERY_SLOTS { return Err("busy".into()); }
        if jobs.contains_key(&id) { return Err("request_conflict".into()); }
        jobs.insert(id.clone(), Arc::new(QueryJob { input, cancelled: AtomicBool::new(false), started: AtomicBool::new(false), deadline: Instant::now() + QUERY_DEADLINE,
            epoch: self.lifecycle.load(Ordering::Acquire), lifecycle: self.lifecycle.clone() }));
        Ok(id)
    }
    fn start(&self, id: &str) -> Result<QueryLease, String> {
        let jobs = self.jobs.lock().map_err(|_| "query_unavailable")?;
        let job = jobs.get(id).cloned().ok_or("request_closed")?;
        job.check()?;
        if job.started.swap(true, Ordering::AcqRel) { return Err("request_conflict".into()); }
        Ok(QueryLease { id: id.into(), job, state: self.clone() })
    }
    fn cancel(&self, id: &str) {
        if let Ok(mut jobs) = self.jobs.lock() {
            if let Some(job) = jobs.get(id) {
                job.cancelled.store(true, Ordering::Release);
                // Running jobs retain capacity until the actual blocking I/O returns.
                if !job.started.load(Ordering::Acquire) { jobs.remove(id); }
            }
        }
    }
    pub fn reset(&self) {
        self.lifecycle.fetch_add(1, Ordering::AcqRel);
        if let Ok(mut jobs) = self.jobs.lock() {
            for job in jobs.values() { job.cancelled.store(true, Ordering::Release); }
            jobs.retain(|_, job| job.started.load(Ordering::Acquire));
        }
    }
}
fn execute(lease: QueryLease, router: MarketRouter) -> Result<Value, String> {
    with_scope(lease.job.clone(), || {
        check_active()?;
        let result = match lease.job.input.clone() {
            QueryInput::History { provider_id, symbol, kind, resolution, adjustment, count } => {
                router.fetch_history(HistoryRequest { provider_id, symbol: canonical_symbol(&symbol)?, kind, resolution, adjustment, count, include_quote: false })
                    .map_err(|e| e.code).and_then(|v| serde_json::to_value(v).map_err(|_| "invalid_output".into()))
            }
            QueryInput::Quote { provider_id, symbol, kind } => {
                router.fetch_quote(QuoteRequest { provider_id, symbol: canonical_symbol(&symbol)?, kind })
                    .map_err(|e| e.code).and_then(|v| serde_json::to_value(v).map_err(|_| "invalid_output".into()))
            }
        };
        check_active()?;
        result
    })
}
fn allowed(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("window_denied".into()) }
}
#[tauri::command]
pub fn market_query_begin(window: WebviewWindow, state: State<'_, MarketQueryState>, input: QueryInput) -> Result<String, String> {
    allowed(&window)?; state.reserve(input)
}
#[tauri::command]
pub async fn market_query_execute(window: WebviewWindow, state: State<'_, MarketQueryState>, router: State<'_, MarketRouter>, query_id: String) -> Result<Value, String> {
    allowed(&window)?;
    let lease = state.start(&query_id)?;
    let job = lease.job.clone();
    let router = router.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || execute(lease, router)).await.map_err(|_| "query_failed")?;
    // Revocation may race with serialization / the async join, not only provider I/O.
    job.check()?;
    result
}
#[tauri::command]
pub fn market_query_cancel(window: WebviewWindow, state: State<'_, MarketQueryState>, query_id: String) -> Result<(), String> {
    allowed(&window)?; state.cancel(&query_id); Ok(())
}

#[cfg(test)] mod tests;

#[cfg(test)]
pub(crate) fn test_scope<T>(run: impl FnOnce() -> T) -> T {
    let state = MarketQueryState::default();
    let id = state.reserve(QueryInput::Quote { provider_id: "tdx".into(), symbol: "SH:600000".into(), kind: SymbolKind::Stock }).unwrap();
    let lease = state.start(&id).unwrap();
    with_scope(lease.job.clone(), run)
}
