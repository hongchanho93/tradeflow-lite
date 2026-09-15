use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::AppHandle;
use tauri::Emitter;

use crate::contracts::{AppError, Resolution, Symbol, SymbolKind};
use crate::market_adapter::{
    RealtimeEventEnvelope, RealtimePayload, RealtimeRequest, RealtimeSink,
};
use crate::market_router::MarketRouter;

pub const BAR_EVENT: &str = "market-realtime-bar";
pub const POINT_EVENT: &str = "market-realtime-point";
pub const STATUS_EVENT: &str = "market-realtime-status";
pub const DEPTH_EVENT: &str = "market-realtime-depth";
pub const TRADE_EVENT: &str = "market-realtime-trade";

#[derive(Default)]
pub struct RealtimeState {
    active_request_id: Arc<AtomicU64>,
}

impl RealtimeState {
    fn activate(&self, request_id: u64) -> bool {
        let mut current = self.active_request_id.load(Ordering::Acquire);
        loop {
            if request_id <= current {
                return false;
            }
            match self.active_request_id.compare_exchange_weak(
                current,
                request_id,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return true,
                Err(actual) => current = actual,
            }
        }
    }

    fn handle(&self) -> Arc<AtomicU64> {
        Arc::clone(&self.active_request_id)
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeBarPayload {
    request_id: u64,
    provider_id: &'static str,
    symbol: String,
    resolution: Resolution,
    sequence: Option<u64>,
    bar: crate::contracts::Bar,
    closed: bool,
    event_time_ms: i64,
    source: std::borrow::Cow<'static, str>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimePointPayload {
    request_id: u64,
    provider_id: &'static str,
    symbol: String,
    resolution: Resolution,
    sequence: Option<u64>,
    point: crate::contracts::ProbabilityPoint,
    event_time_ms: i64,
    source: std::borrow::Cow<'static, str>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeStatusPayload {
    request_id: u64,
    provider_id: &'static str,
    symbol: String,
    resolution: Resolution,
    sequence: Option<u64>,
    status: &'static str,
    message: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimePriceLevelPayload {
    price: f64,
    quantity: f64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeDepthPayload {
    request_id: u64,
    provider_id: &'static str,
    symbol: String,
    resolution: Resolution,
    sequence: Option<u64>,
    event_time_ms: i64,
    bids: Vec<RealtimePriceLevelPayload>,
    asks: Vec<RealtimePriceLevelPayload>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeTradePayload {
    request_id: u64,
    provider_id: &'static str,
    symbol: String,
    resolution: Resolution,
    sequence: Option<u64>,
    trade_id: i64,
    trade_time_ms: i64,
    price: f64,
    quantity: f64,
    side: Option<std::borrow::Cow<'static, str>>,
    flags: Option<u64>,
}

struct TauriRealtimeSink {
    app: AppHandle,
}

impl RealtimeSink for TauriRealtimeSink {
    fn emit(&self, event: RealtimeEventEnvelope) -> Result<(), AppError> {
        let symbol = event.symbol.as_str().to_string();
        let request_id = event.request_id;
        let provider_id = event.provider_id;
        let resolution = event.resolution;
        let sequence = event.sequence;
        let result = match event.payload {
            RealtimePayload::Status { status, message } => self.app.emit(
                STATUS_EVENT,
                RealtimeStatusPayload {
                    request_id,
                    provider_id,
                    symbol,
                    resolution,
                    sequence,
                    status,
                    message,
                },
            ),
            RealtimePayload::Bar {
                bar,
                closed,
                event_time_ms,
                source,
            } => self.app.emit(
                BAR_EVENT,
                RealtimeBarPayload {
                    request_id,
                    provider_id,
                    symbol,
                    resolution,
                    sequence,
                    bar,
                    closed,
                    event_time_ms,
                    source,
                },
            ),
            RealtimePayload::Point {
                point,
                event_time_ms,
                source,
            } => self.app.emit(
                POINT_EVENT,
                RealtimePointPayload {
                    request_id,
                    provider_id,
                    symbol,
                    resolution,
                    sequence,
                    point,
                    event_time_ms,
                    source,
                },
            ),
            RealtimePayload::Depth {
                event_time_ms,
                bids,
                asks,
            } => self.app.emit(
                DEPTH_EVENT,
                RealtimeDepthPayload {
                    request_id,
                    provider_id,
                    symbol,
                    resolution,
                    sequence,
                    event_time_ms,
                    bids: bids
                        .into_iter()
                        .map(|level| RealtimePriceLevelPayload {
                            price: level.price,
                            quantity: level.quantity,
                        })
                        .collect(),
                    asks: asks
                        .into_iter()
                        .map(|level| RealtimePriceLevelPayload {
                            price: level.price,
                            quantity: level.quantity,
                        })
                        .collect(),
                },
            ),
            RealtimePayload::Trade {
                trade_id,
                trade_time_ms,
                price,
                quantity,
                side,
                flags,
            } => self.app.emit(
                TRADE_EVENT,
                RealtimeTradePayload {
                    request_id,
                    provider_id,
                    symbol,
                    resolution,
                    sequence,
                    trade_id,
                    trade_time_ms,
                    price,
                    quantity,
                    side,
                    flags,
                },
            ),
        };
        result.map_err(|error| AppError::new("realtime_emit_failed", error.to_string()))
    }
}

pub fn stop(state: &RealtimeState, request_id: u64) {
    state.activate(request_id);
}

pub fn start(
    app: AppHandle,
    state: &RealtimeState,
    router: &MarketRouter,
    request_id: u64,
    provider_id: String,
    symbol: Symbol,
    kind: SymbolKind,
    resolution: Resolution,
) -> Result<(), AppError> {
    let registration = router
        .registry()
        .resolve_for_provider(&provider_id, &symbol, &kind)?;
    if !state.activate(request_id) {
        return Ok(());
    }
    let request = RealtimeRequest {
        request_id,
        provider_id: registration.descriptor().id,
        symbol,
        kind,
        resolution,
        active_request_id: state.handle(),
    };
    let sink: Arc<dyn RealtimeSink> = Arc::new(TauriRealtimeSink { app });
    router.start_realtime_registration(registration, request, sink)
}

#[cfg(test)]
mod tests {
    use super::RealtimeState;

    #[test]
    fn older_realtime_requests_cannot_replace_the_latest_selection() {
        let state = RealtimeState::default();
        assert!(state.activate(2));
        assert!(!state.activate(1));
        assert!(!state.activate(2));
        assert!(state.activate(3));
    }
}
