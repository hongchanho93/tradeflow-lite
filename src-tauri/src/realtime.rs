use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(feature = "provider-binance")]
use std::thread;
#[cfg(feature = "provider-binance")]
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(feature = "provider-binance")]
use serde::Serialize;
use tauri::AppHandle;
#[cfg(feature = "provider-binance")]
use tauri::Emitter;

#[cfg(feature = "provider-binance")]
use crate::contracts::Bar;
use crate::contracts::{AppError, Resolution, Symbol, SymbolKind};

#[cfg(feature = "provider-binance")]
pub const BAR_EVENT: &str = "market-realtime-bar";
#[cfg(feature = "provider-binance")]
pub const STATUS_EVENT: &str = "market-realtime-status";
#[cfg(feature = "provider-binance")]
pub const DEPTH_EVENT: &str = "market-realtime-depth";
#[cfg(feature = "provider-binance")]
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

    #[cfg(feature = "provider-binance")]
    fn handle(&self) -> Arc<AtomicU64> {
        Arc::clone(&self.active_request_id)
    }
}

#[cfg(feature = "provider-binance")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeBarPayload {
    request_id: u64,
    symbol: String,
    resolution: Resolution,
    bar: Bar,
    closed: bool,
    event_time_ms: i64,
    source: &'static str,
}

#[cfg(feature = "provider-binance")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeStatusPayload {
    request_id: u64,
    symbol: String,
    resolution: Resolution,
    status: &'static str,
    message: Option<String>,
}

#[cfg(feature = "provider-binance")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimePriceLevelPayload {
    price: f64,
    quantity: f64,
}

#[cfg(feature = "provider-binance")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeDepthPayload {
    request_id: u64,
    symbol: String,
    resolution: Resolution,
    last_update_id: i64,
    bids: Vec<RealtimePriceLevelPayload>,
    asks: Vec<RealtimePriceLevelPayload>,
}

#[cfg(feature = "provider-binance")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeTradePayload {
    request_id: u64,
    symbol: String,
    resolution: Resolution,
    aggregate_trade_id: i64,
    trade_time_ms: i64,
    price: f64,
    quantity: f64,
    buyer_is_maker: bool,
}

pub fn stop(state: &RealtimeState, request_id: u64) {
    state.activate(request_id);
}

#[cfg(feature = "provider-binance")]
pub fn start(
    app: AppHandle,
    state: &RealtimeState,
    request_id: u64,
    symbol: Symbol,
    kind: SymbolKind,
    resolution: Resolution,
) -> Result<(), AppError> {
    let venue = symbol.parts().0;
    if kind != SymbolKind::Crypto || !matches!(venue, "BINANCE" | "BINANCE_USDM") {
        return Err(AppError::new(
            "realtime_route_not_found",
            "当前品种没有实时行情路由",
        ));
    }
    if !state.activate(request_id) {
        return Ok(());
    }

    use crate::market_providers::binance::{bar_from_kline, interval_for};
    use tradeflow_binance_market_data::{
        RealtimeEvent, RealtimeKlineState, RealtimeStream, RealtimeUpdateSource,
    };

    let active_request_id = state.handle();
    let symbol_id = format!("{}:{}", symbol.parts().0, symbol.parts().1);
    let code = symbol.parts().1.to_string();
    let usd_margined = venue == "BINANCE_USDM";
    let interval = interval_for(resolution);
    if usd_margined {
        spawn_usd_margined_depth(
            app.clone(),
            Arc::clone(&active_request_id),
            request_id,
            symbol_id.clone(),
            code.clone(),
            resolution,
            interval,
        );
    }
    thread::spawn(move || {
        let mut retry_delay = Duration::from_secs(1);
        emit_status(&app, request_id, &symbol_id, resolution, "connecting", None);
        while is_active(&active_request_id, request_id) {
            let connection = if usd_margined {
                RealtimeStream::connect_usd_margined_market(&code, interval)
            } else {
                RealtimeStream::connect(&code, interval)
            };
            match connection {
                Ok(mut stream) => {
                    let mut first_bar_emitted = false;
                    let mut first_aggregate_trade_emitted = false;
                    let mut first_depth_emitted = false;
                    let mut kline_state = RealtimeKlineState::default();
                    let mut calibration_pauses = 0_u64;
                    let mut calibration_recoveries = 0_u64;
                    let mut aggregate_trades_skipped = 0_u64;
                    let mut last_freshness_log = Instant::now()
                        .checked_sub(Duration::from_secs(10))
                        .unwrap_or_else(Instant::now);
                    eprintln!(
                        "market.realtime.connected request_id={request_id} symbol={symbol_id} resolution={}",
                        resolution.as_str()
                    );
                    if !emit_status(&app, request_id, &symbol_id, resolution, "connected", None) {
                        return;
                    }
                    while is_active(&active_request_id, request_id) {
                        match stream.read_event() {
                            Ok(event) => {
                                retry_delay = Duration::from_secs(1);
                                if !is_active(&active_request_id, request_id) {
                                    break;
                                }
                                if last_freshness_log.elapsed() >= Duration::from_secs(10) {
                                    let event_time_ms = match &event {
                                        RealtimeEvent::AggregateTrade(event) => event.event_time_ms,
                                        RealtimeEvent::Kline(event) => event.event_time_ms,
                                        RealtimeEvent::Depth(_) => 0,
                                    };
                                    if event_time_ms > 0 {
                                        let now_ms = SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .map(|elapsed| elapsed.as_millis() as i64)
                                            .unwrap_or(event_time_ms);
                                        eprintln!(
                                            "market.realtime.freshness request_id={request_id} symbol={symbol_id} lag_ms={} calibration_pauses={calibration_pauses} calibration_recoveries={calibration_recoveries} aggregate_trades_skipped={aggregate_trades_skipped}",
                                            now_ms.saturating_sub(event_time_ms),
                                        );
                                        calibration_pauses = 0;
                                        calibration_recoveries = 0;
                                        aggregate_trades_skipped = 0;
                                        last_freshness_log = Instant::now();
                                    }
                                }
                                match &event {
                                    RealtimeEvent::AggregateTrade(trade) => {
                                        let payload = RealtimeTradePayload {
                                            request_id,
                                            symbol: symbol_id.clone(),
                                            resolution,
                                            aggregate_trade_id: trade.aggregate_trade_id,
                                            trade_time_ms: trade.trade_time_ms,
                                            price: trade.price,
                                            quantity: trade.quantity,
                                            buyer_is_maker: trade.buyer_is_maker,
                                        };
                                        if app.emit(TRADE_EVENT, payload).is_err() {
                                            return;
                                        }
                                    }
                                    RealtimeEvent::Depth(depth) => {
                                        if !emit_depth(
                                            &app, request_id, &symbol_id, resolution, depth,
                                        ) {
                                            return;
                                        }
                                        if !first_depth_emitted {
                                            first_depth_emitted = true;
                                            eprintln!(
                                                "market.realtime.first_depth request_id={request_id} symbol={symbol_id} bids={} asks={} update_id={}",
                                                depth.bids.len(),
                                                depth.asks.len(),
                                                depth.last_update_id
                                            );
                                        }
                                    }
                                    RealtimeEvent::Kline(_) => {}
                                }
                                let was_awaiting_calibration = kline_state.awaiting_calibration();
                                let aggregate_trade =
                                    matches!(event, RealtimeEvent::AggregateTrade(_));
                                let update = match kline_state.apply(&event) {
                                    Ok(update) => update,
                                    Err(error) => {
                                        emit_reconnecting(
                                            &app,
                                            request_id,
                                            &symbol_id,
                                            resolution,
                                            error.to_string(),
                                        );
                                        break;
                                    }
                                };
                                if !was_awaiting_calibration && kline_state.awaiting_calibration() {
                                    calibration_pauses += 1;
                                }
                                if was_awaiting_calibration && !kline_state.awaiting_calibration() {
                                    calibration_recoveries += 1;
                                }
                                if aggregate_trade && update.is_none() {
                                    aggregate_trades_skipped += 1;
                                }
                                let Some(update) = update else {
                                    continue;
                                };
                                let bar = match bar_from_kline(&update.kline) {
                                    Ok(bar) => bar,
                                    Err(error) => {
                                        emit_reconnecting(
                                            &app,
                                            request_id,
                                            &symbol_id,
                                            resolution,
                                            error.message,
                                        );
                                        break;
                                    }
                                };
                                if !is_active(&active_request_id, request_id) {
                                    break;
                                }
                                let payload = RealtimeBarPayload {
                                    request_id,
                                    symbol: symbol_id.clone(),
                                    resolution,
                                    bar,
                                    closed: update.closed,
                                    event_time_ms: update.event_time_ms,
                                    source: update.source.as_str(),
                                };
                                if app.emit(BAR_EVENT, payload).is_err() {
                                    return;
                                }
                                if !first_bar_emitted {
                                    first_bar_emitted = true;
                                    eprintln!(
                                        "market.realtime.first_bar request_id={request_id} symbol={symbol_id} resolution={} source={} bar_time={} event_time_ms={} closed={}",
                                        resolution.as_str(),
                                        update.source.as_str(),
                                        update.kline.close_time_ms.saturating_add(1) / 1_000,
                                        update.event_time_ms,
                                        update.closed
                                    );
                                }
                                if update.source == RealtimeUpdateSource::AggregateTrade
                                    && !first_aggregate_trade_emitted
                                {
                                    first_aggregate_trade_emitted = true;
                                    eprintln!(
                                        "market.realtime.first_aggregate_trade request_id={request_id} symbol={symbol_id} resolution={} event_time_ms={}",
                                        resolution.as_str(),
                                        update.event_time_ms
                                    );
                                }
                            }
                            Err(error) => {
                                emit_reconnecting(
                                    &app,
                                    request_id,
                                    &symbol_id,
                                    resolution,
                                    error.to_string(),
                                );
                                break;
                            }
                        }
                    }
                }
                Err(error) => {
                    emit_reconnecting(&app, request_id, &symbol_id, resolution, error.to_string())
                }
            }
            if !wait_while_active(&active_request_id, request_id, retry_delay) {
                break;
            }
            retry_delay = (retry_delay * 2).min(Duration::from_secs(15));
        }
        eprintln!(
            "market.realtime.stopped request_id={request_id} symbol={symbol_id} resolution={}",
            resolution.as_str()
        );
    });
    Ok(())
}

#[cfg(feature = "provider-binance")]
fn spawn_usd_margined_depth(
    app: AppHandle,
    active_request_id: Arc<AtomicU64>,
    request_id: u64,
    symbol_id: String,
    code: String,
    resolution: Resolution,
    interval: tradeflow_binance_market_data::Interval,
) {
    use tradeflow_binance_market_data::{RealtimeEvent, RealtimeStream};

    thread::spawn(move || {
        let mut retry_delay = Duration::from_secs(1);
        while is_active(&active_request_id, request_id) {
            match RealtimeStream::connect_usd_margined_depth(&code, interval) {
                Ok(mut stream) => {
                    retry_delay = Duration::from_secs(1);
                    let mut first_depth_emitted = false;
                    eprintln!(
                        "market.realtime.depth_connected request_id={request_id} symbol={symbol_id}"
                    );
                    while is_active(&active_request_id, request_id) {
                        match stream.read_event() {
                            Ok(RealtimeEvent::Depth(depth)) => {
                                if !is_active(&active_request_id, request_id)
                                    || !emit_depth(&app, request_id, &symbol_id, resolution, &depth)
                                {
                                    return;
                                }
                                if !first_depth_emitted {
                                    first_depth_emitted = true;
                                    eprintln!(
                                        "market.realtime.first_depth request_id={request_id} symbol={symbol_id} bids={} asks={} update_id={}",
                                        depth.bids.len(),
                                        depth.asks.len(),
                                        depth.last_update_id
                                    );
                                }
                            }
                            Ok(_) => {
                                eprintln!(
                                    "market.realtime.depth_unexpected_event request_id={request_id} symbol={symbol_id}"
                                );
                                break;
                            }
                            Err(error) => {
                                eprintln!(
                                    "market.realtime.depth_reconnecting request_id={request_id} symbol={symbol_id} error={error}"
                                );
                                break;
                            }
                        }
                    }
                }
                Err(error) => eprintln!(
                    "market.realtime.depth_reconnecting request_id={request_id} symbol={symbol_id} error={error}"
                ),
            }
            if !wait_while_active(&active_request_id, request_id, retry_delay) {
                break;
            }
            retry_delay = (retry_delay * 2).min(Duration::from_secs(15));
        }
        eprintln!("market.realtime.depth_stopped request_id={request_id} symbol={symbol_id}");
    });
}

#[cfg(feature = "provider-binance")]
fn emit_depth(
    app: &AppHandle,
    request_id: u64,
    symbol: &str,
    resolution: Resolution,
    depth: &tradeflow_binance_market_data::DepthEvent,
) -> bool {
    let map_level = |level: &tradeflow_binance_market_data::PriceLevel| RealtimePriceLevelPayload {
        price: level.price,
        quantity: level.quantity,
    };
    app.emit(
        DEPTH_EVENT,
        RealtimeDepthPayload {
            request_id,
            symbol: symbol.to_string(),
            resolution,
            last_update_id: depth.last_update_id,
            bids: depth.bids.iter().map(map_level).collect(),
            asks: depth.asks.iter().map(map_level).collect(),
        },
    )
    .is_ok()
}

#[cfg(not(feature = "provider-binance"))]
pub fn start(
    _app: AppHandle,
    state: &RealtimeState,
    request_id: u64,
    _symbol: Symbol,
    _kind: SymbolKind,
    _resolution: Resolution,
) -> Result<(), AppError> {
    state.activate(request_id);
    Err(AppError::new(
        "market_data_source_unavailable",
        "Binance 实时行情适配器未启用",
    ))
}

#[cfg(feature = "provider-binance")]
fn is_active(active_request_id: &AtomicU64, request_id: u64) -> bool {
    active_request_id.load(Ordering::Acquire) == request_id
}

#[cfg(feature = "provider-binance")]
fn wait_while_active(active_request_id: &AtomicU64, request_id: u64, duration: Duration) -> bool {
    let steps = duration.as_millis().div_ceil(100);
    for _ in 0..steps {
        if !is_active(active_request_id, request_id) {
            return false;
        }
        thread::sleep(Duration::from_millis(100));
    }
    is_active(active_request_id, request_id)
}

#[cfg(feature = "provider-binance")]
fn emit_status(
    app: &AppHandle,
    request_id: u64,
    symbol: &str,
    resolution: Resolution,
    status: &'static str,
    message: Option<String>,
) -> bool {
    app.emit(
        STATUS_EVENT,
        RealtimeStatusPayload {
            request_id,
            symbol: symbol.to_string(),
            resolution,
            status,
            message,
        },
    )
    .is_ok()
}

#[cfg(feature = "provider-binance")]
fn emit_reconnecting(
    app: &AppHandle,
    request_id: u64,
    symbol: &str,
    resolution: Resolution,
    message: String,
) {
    eprintln!(
        "market.realtime.reconnecting request_id={request_id} symbol={symbol} resolution={} error={message}",
        resolution.as_str()
    );
    emit_status(
        app,
        request_id,
        symbol,
        resolution,
        "reconnecting",
        Some(message),
    );
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
