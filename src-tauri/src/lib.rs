pub mod contracts;
pub mod market_adapter;
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
use market_router::{
    CatalogRequest, CatalogSymbol, HistoryRequest, MarketRouter, ProviderDescriptor, QuoteRequest,
    QuoteResponse,
};
use realtime::RealtimeState;
use tauri::{AppHandle, State};

#[cfg(feature = "provider-binance")]
#[tauri::command]
async fn list_binance_spot_symbols(
    router: State<'_, MarketRouter>,
) -> Result<Vec<BinanceSpotSymbol>, AppError> {
    list_catalog_for_router(
        router.inner().clone(),
        "binance_spot".to_string(),
        "BINANCE".to_string(),
    )
    .await
    .map(|symbols| {
        symbols
            .into_iter()
            .map(|symbol| BinanceSpotSymbol {
                symbol: symbol
                    .symbol
                    .split_once(':')
                    .map(|parts| parts.1.to_string())
                    .unwrap_or_else(|| symbol.symbol.clone()),
                base_asset: symbol.base_asset.unwrap_or_default(),
                quote_asset: symbol.quote_asset.unwrap_or_default(),
            })
            .collect()
    })
}

#[cfg(feature = "provider-binance")]
#[tauri::command]
async fn list_binance_usd_margined_symbols(
    router: State<'_, MarketRouter>,
) -> Result<Vec<BinanceUsdMarginedSymbol>, AppError> {
    list_catalog_for_router(
        router.inner().clone(),
        "binance_usdm".to_string(),
        "BINANCE_USDM".to_string(),
    )
    .await
    .map(|symbols| {
        symbols
            .into_iter()
            .map(|symbol| BinanceUsdMarginedSymbol {
                symbol: symbol
                    .symbol
                    .split_once(':')
                    .map(|parts| parts.1.to_string())
                    .unwrap_or_else(|| symbol.symbol.clone()),
                base_asset: symbol.base_asset.unwrap_or_default(),
                quote_asset: symbol.quote_asset.unwrap_or_default(),
            })
            .collect()
    })
}

#[cfg(not(feature = "provider-binance"))]
#[tauri::command]
async fn list_binance_spot_symbols(
    router: State<'_, MarketRouter>,
) -> Result<Vec<BinanceSpotSymbol>, AppError> {
    list_catalog_for_router(
        router.inner().clone(),
        "binance_spot".to_string(),
        "BINANCE".to_string(),
    )
    .await
    .map(|_| Vec::new())
}

#[cfg(not(feature = "provider-binance"))]
#[tauri::command]
async fn list_binance_usd_margined_symbols(
    router: State<'_, MarketRouter>,
) -> Result<Vec<BinanceUsdMarginedSymbol>, AppError> {
    list_catalog_for_router(
        router.inner().clone(),
        "binance_usdm".to_string(),
        "BINANCE_USDM".to_string(),
    )
    .await
    .map(|_| Vec::new())
}

async fn list_catalog_for_router(
    router: MarketRouter,
    provider_id: String,
    venue: String,
) -> Result<Vec<CatalogSymbol>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        router.list_catalog(CatalogRequest { provider_id, venue })
    })
    .await
    .map_err(|error| {
        AppError::new(
            "catalog_task_failed",
            format!("品种目录任务异常结束：{error}"),
        )
    })?
}

#[tauri::command]
fn list_market_providers(router: State<'_, MarketRouter>) -> Vec<ProviderDescriptor> {
    router.provider_descriptors()
}

#[tauri::command]
async fn list_market_catalog(
    router: State<'_, MarketRouter>,
    provider_id: String,
    venue: String,
) -> Result<Vec<CatalogSymbol>, AppError> {
    list_catalog_for_router(router.inner().clone(), provider_id, venue).await
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
    router: State<'_, MarketRouter>,
    provider_id: String,
    symbol: String,
    kind: SymbolKind,
    resolution: Resolution,
    adjustment: Adjustment,
    count: usize,
    include_quote: bool,
) -> Result<HistoryResponse, AppError> {
    let (exchange, code) = symbol
        .split_once(':')
        .ok_or_else(|| AppError::new("invalid_symbol", "证券代码格式应为 VENUE:CODE"))?;
    let symbol = Symbol::new(exchange, code)?;
    let router = router.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        router.fetch_history(HistoryRequest {
            provider_id,
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
            "market.history.ok symbol={} requested={} series={:?} rows={} first_time={} last_time={} source={} host={} latency_ms={}",
            response.symbol.parts().1,
            count,
            response.series_kind,
            response.bars.len().max(response.points.len()),
            response
                .bars
                .first()
                .map(|bar| bar.time)
                .or_else(|| response.points.first().map(|point| point.time))
                .unwrap_or_default(),
            response
                .bars
                .last()
                .map(|bar| bar.time)
                .or_else(|| response.points.last().map(|point| point.time))
                .unwrap_or_default(),
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
async fn get_quote_snapshot(
    router: State<'_, MarketRouter>,
    provider_id: String,
    symbol: String,
    kind: SymbolKind,
) -> Result<QuoteResponse, AppError> {
    let (exchange, code) = symbol
        .split_once(':')
        .ok_or_else(|| AppError::new("invalid_symbol", "品种代码格式应为 VENUE:CODE"))?;
    let symbol = Symbol::new(exchange, code)?;
    let router = router.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        router.fetch_quote(QuoteRequest {
            provider_id,
            symbol,
            kind,
        })
    })
    .await
    .map_err(|error| {
        AppError::new(
            "quote_task_failed",
            format!("行情快照任务异常结束：{error}"),
        )
    })?
}

#[tauri::command]
fn start_realtime_market(
    app: AppHandle,
    state: State<'_, RealtimeState>,
    router: State<'_, MarketRouter>,
    request_id: u64,
    provider_id: String,
    symbol: String,
    kind: SymbolKind,
    resolution: Resolution,
) -> Result<(), AppError> {
    let (exchange, code) = symbol
        .split_once(':')
        .ok_or_else(|| AppError::new("invalid_symbol", "品种代码格式应为 VENUE:CODE"))?;
    realtime::start(
        app,
        &state,
        router.inner(),
        request_id,
        provider_id,
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

/// 使用调用方提供的公开路由器启动 Tauri。外部宿主可构造自己的静态 Registry，
/// 通过 `MarketRouter::new` 注入后复用同一组命令入口。
pub fn run_with_router(router: MarketRouter) {
    tauri::Builder::default()
        .manage(router)
        .manage(RealtimeState::default())
        .invoke_handler(tauri::generate_handler![
            get_history_bars,
            get_quote_snapshot,
            list_market_providers,
            list_market_catalog,
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

pub fn run() {
    let router = MarketRouter::builtin().expect("built-in provider registry must be valid");
    run_with_router(router);
}
