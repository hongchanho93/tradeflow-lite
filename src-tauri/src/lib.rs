pub mod contracts;
mod market_data;
mod market_providers;
pub mod market_router;
mod realtime;
pub mod tdx;

use contracts::{
    Adjustment, AppError, BinanceSpotSymbol, BinanceUsdMarginedSymbol, Resolution, Symbol,
    SymbolKind,
};
use market_data::{HistoryResponse, HostBenchmarkResponse};
use market_router::HistoryRequest;
use realtime::RealtimeState;
use tauri::{AppHandle, State};

#[cfg(feature = "provider-binance")]
#[tauri::command]
async fn list_binance_spot_symbols() -> Result<Vec<BinanceSpotSymbol>, AppError> {
    tauri::async_runtime::spawn_blocking(market_providers::binance::list_spot_symbols)
        .await
        .map_err(|error| {
            AppError::new(
                "catalog_task_failed",
                format!("品种目录任务异常结束：{error}"),
            )
        })?
}

#[cfg(feature = "provider-binance")]
#[tauri::command]
async fn list_binance_usd_margined_symbols() -> Result<Vec<BinanceUsdMarginedSymbol>, AppError> {
    tauri::async_runtime::spawn_blocking(market_providers::binance::list_usd_margined_symbols)
        .await
        .map_err(|error| {
            AppError::new(
                "catalog_task_failed",
                format!("品种目录任务异常结束：{error}"),
            )
        })?
}

#[cfg(not(feature = "provider-binance"))]
#[tauri::command]
async fn list_binance_spot_symbols() -> Result<Vec<BinanceSpotSymbol>, AppError> {
    Err(AppError::new(
        "market_data_source_unavailable",
        "Binance 行情适配器未启用",
    ))
}

#[cfg(not(feature = "provider-binance"))]
#[tauri::command]
async fn list_binance_usd_margined_symbols() -> Result<Vec<BinanceUsdMarginedSymbol>, AppError> {
    Err(AppError::new(
        "market_data_source_unavailable",
        "Binance U 本位行情适配器未启用",
    ))
}

#[tauri::command]
fn benchmark_hosts() -> Result<HostBenchmarkResponse, AppError> {
    let result = market_data::benchmark_hosts();
    match &result {
        Ok(response) => eprintln!(
            "market.hosts.benchmark healthy={} total={}",
            response.probes.iter().filter(|probe| probe.ok).count(),
            response.probes.len()
        ),
        Err(error) => eprintln!(
            "market.hosts.benchmark_error code={} message={}",
            error.code, error.message
        ),
    }
    result
}

#[tauri::command]
async fn get_history_bars(
    symbol: String,
    kind: SymbolKind,
    resolution: Resolution,
    adjustment: Adjustment,
    count: usize,
    include_quote: bool,
) -> Result<HistoryResponse, AppError> {
    let (exchange, code) = symbol
        .split_once(':')
        .ok_or_else(|| AppError::new("invalid_symbol", "证券代码格式应为 SH:600000"))?;
    let symbol = Symbol::new(exchange, code)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        market_router::fetch_history(HistoryRequest {
            symbol,
            kind,
            resolution,
            adjustment,
            count,
            include_quote,
        })
    })
    .await
    .map_err(|error| AppError::new("history_task_failed", format!("行情任务异常结束：{error}")))?;
    match &result {
        Ok(response) => eprintln!(
            "market.history.ok symbol={} requested={} bars={} first_time={} last_time={} source={} host={} latency_ms={}",
            response.symbol.parts().1,
            count,
            response.bars.len(),
            response
                .bars
                .first()
                .map(|bar| bar.time)
                .unwrap_or_default(),
            response.bars.last().map(|bar| bar.time).unwrap_or_default(),
            response.diagnostics.source,
            response.diagnostics.host,
            response.diagnostics.latency_ms
        ),
        Err(error) => eprintln!(
            "market.history.error code={} message={}",
            error.code, error.message
        ),
    }
    result
}

#[tauri::command]
fn start_realtime_market(
    app: AppHandle,
    state: State<'_, RealtimeState>,
    request_id: u64,
    symbol: String,
    kind: SymbolKind,
    resolution: Resolution,
) -> Result<(), AppError> {
    let (exchange, code) = symbol
        .split_once(':')
        .ok_or_else(|| AppError::new("invalid_symbol", "品种代码格式应为 BINANCE:BTCUSDT"))?;
    realtime::start(
        app,
        &state,
        request_id,
        Symbol::new(exchange, code)?,
        kind,
        resolution,
    )
}

#[tauri::command]
fn stop_realtime_market(state: State<'_, RealtimeState>, request_id: u64) {
    realtime::stop(&state, request_id);
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn report_realtime_render_health(
    request_id: u64,
    symbol: String,
    resolution: Resolution,
    bars_received: u64,
    bars_applied: u64,
    bars_coalesced: u64,
    depth_received: u64,
    trades_received: u64,
    market_renders: u64,
    max_queue_ms: f64,
    max_event_age_ms: u64,
    max_frame_ms: f64,
    max_arrival_gap_ms: u64,
    max_apply_gap_ms: u64,
    fallback_flushes: u64,
) {
    eprintln!(
        "market.realtime.render_health request_id={request_id} symbol={symbol} resolution={} bars_received={bars_received} bars_applied={bars_applied} bars_coalesced={bars_coalesced} depth_received={depth_received} trades_received={trades_received} market_renders={market_renders} fallback_flushes={fallback_flushes} max_queue_ms={max_queue_ms} max_event_age_ms={max_event_age_ms} max_frame_ms={max_frame_ms} max_arrival_gap_ms={max_arrival_gap_ms} max_apply_gap_ms={max_apply_gap_ms}",
        resolution.as_str()
    );
}

pub fn run() {
    tauri::Builder::default()
        .manage(RealtimeState::default())
        .invoke_handler(tauri::generate_handler![
            get_history_bars,
            benchmark_hosts,
            list_binance_spot_symbols,
            list_binance_usd_margined_symbols,
            start_realtime_market,
            stop_realtime_market,
            report_realtime_render_health
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TradeFlow Lite");
}
