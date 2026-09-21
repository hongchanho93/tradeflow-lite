mod ai_api;
mod ai_result_files;
pub mod contracts;
pub mod ai_mcp;
pub mod market_adapter;
mod market_data;
mod market_query;
mod user_data;
mod workspace_state;
mod market_providers;
pub mod market_router;
mod realtime;
use contracts::{
    Adjustment, AppError, BinanceSpotSymbol, BinanceUsdMarginedSymbol, Resolution, Symbol,
    SymbolKind,
};
use market_data::HistoryResponse;
#[cfg(tradeflow_tdx)]
use market_data::{HostBenchmarkResponse, RecentTradesResponse};
use market_router::{
    CatalogPage, CatalogPageRequest, CatalogRequest, CatalogSymbol, HistoryRequest, MarketRouter,
    MarketEditionInfo, ProviderDescriptor, QuoteRequest, QuoteResponse,
};
use realtime::RealtimeState;
use tauri::{AppHandle, State, Manager};

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
fn get_market_edition(router: State<'_, MarketRouter>) -> MarketEditionInfo {
    router.edition_info()
}

#[tauri::command]
fn set_market_provider_enabled(
    router: State<'_, MarketRouter>,
    provider_id: String,
    enabled: bool,
) -> Result<ProviderDescriptor, AppError> {
    router.set_provider_enabled(&provider_id, enabled)
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
async fn list_market_catalog_page(
    router: State<'_, MarketRouter>,
    provider_id: String,
    venue: String,
    cursor: Option<String>,
    limit: usize,
) -> Result<CatalogPage, AppError> {
    let router = router.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = router.list_catalog_page(CatalogPageRequest {
            provider_id: provider_id.clone(),
            venue: venue.clone(),
            cursor,
            limit,
        });
        if let Ok(page) = result.as_ref() {
            eprintln!(
                "market.catalog.page_loaded provider={} venue={} page_symbols={} next_cursor={}",
                provider_id,
                venue,
                page.symbols.len(),
                page.next_cursor.as_deref().unwrap_or("complete"),
            );
        }
        result
    })
    .await
    .map_err(|error| {
        AppError::new(
            "catalog_task_failed",
            format!("品种目录分页任务异常结束：{error}"),
        )
    })?
}

#[cfg(tradeflow_tdx)]
#[tauri::command]
async fn benchmark_hosts(router: State<'_, MarketRouter>) -> Result<HostBenchmarkResponse, AppError> {
    router.require_provider_enabled("tdx")?;
    let result = tauri::async_runtime::spawn_blocking(market_data::benchmark_hosts)
        .await
        .map_err(|error| {
            AppError::new(
                "benchmark_task_failed",
                format!("行情主站测速任务异常结束：{error}"),
            )
        })?;
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
fn activate_history_incarnation(request_incarnation: u64) -> Result<(), AppError> {
    if market_data::activate_history_incarnation(request_incarnation) {
        Ok(())
    } else {
        Err(AppError::new(
            "history_request_cancelled",
            "历史行情请求已被更新的选择替代",
        ))
    }
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
    request_incarnation: u64,
) -> Result<HistoryResponse, AppError> {
    if !market_data::activate_history_incarnation(request_incarnation) {
        return Err(AppError::new(
            "history_request_cancelled",
            "历史行情请求已被更新的选择替代",
        ));
    }
    let (exchange, code) = symbol
        .split_once(':')
        .ok_or_else(|| AppError::new("invalid_symbol", "证券代码格式应为 VENUE:CODE"))?;
    let symbol = Symbol::new(exchange, code)?;
    let router = router.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        market_data::with_history_incarnation(request_incarnation, || {
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

#[cfg(tradeflow_tdx)]
#[tauri::command]
async fn get_tdx_recent_trades(
    router: State<'_, MarketRouter>,
    provider_id: String,
    symbol: String,
    kind: SymbolKind,
    count: usize,
) -> Result<RecentTradesResponse, AppError> {
    if provider_id != "tdx" {
        return Err(AppError::new(
            "unsupported_provider",
            "该逐笔成交入口只支持 TDX",
        ));
    }
    router.require_provider_enabled("tdx")?;
    let (exchange, code) = symbol
        .split_once(':')
        .ok_or_else(|| AppError::new("invalid_symbol", "证券代码格式应为 VENUE:CODE"))?;
    let symbol = Symbol::new(exchange, code)?;
    tauri::async_runtime::spawn_blocking(move || {
        market_data::fetch_recent_trades(symbol, kind, count)
    })
    .await
    .map_err(|error| {
        AppError::new(
            "recent_trades_task_failed",
            format!("逐笔成交任务异常结束：{error}"),
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(router)
        .manage(RealtimeState::default())
        .manage(market_query::MarketQueryState::default())
        .manage(user_data::UserDataState::default())
        .manage(workspace_state::WorkspaceState::default())
        .manage(ai_mcp::McpState::default())
        .manage(ai_api::ApiState::default())
        .manage(ai_result_files::AiResultFileState::default())
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                webview.state::<ai_mcp::McpState>().stop();
                webview.state::<ai_api::ApiState>().reset();
                webview.state::<market_query::MarketQueryState>().reset();
                webview.state::<user_data::UserDataState>().reset();
                webview.state::<ai_result_files::AiResultFileState>().reset();
            }
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<ai_mcp::McpState>().stop();
                window.state::<ai_api::ApiState>().reset();
                window.state::<market_query::MarketQueryState>().reset();
                window.state::<user_data::UserDataState>().reset();
                window.state::<ai_result_files::AiResultFileState>().reset();
            }
        })
        .invoke_handler(tauri::generate_handler![
            workspace_state::workspace_state_load,
            workspace_state::workspace_state_set,
            workspace_state::workspace_state_remove,
            workspace_state::workspace_state_merge,
            workspace_state::workspace_state_compare_exchange,
            user_data::user_data_list,
            user_data::user_data_source,
            user_data::user_data_pick,
            user_data::user_data_prepare,
            user_data::user_data_commit,
            user_data::user_data_rollback,
            user_data::user_data_finish,
            user_data::user_data_begin,
            user_data::user_data_execute,
            user_data::user_data_cancel,
            market_query::market_query_begin,
            market_query::market_query_execute,
            market_query::market_query_cancel,
            ai_api::ai_api_configure,
            ai_api::ai_api_load,
            ai_api::ai_api_forget,
            ai_api::ai_api_start,
            ai_api::ai_api_next,
            ai_api::ai_api_cancel,
            ai_result_files::ai_result_prepare,
            ai_result_files::ai_result_commit,
            ai_result_files::ai_result_rollback,
            ai_mcp::ai_mcp_start,
            ai_mcp::ai_mcp_stop,
            ai_mcp::ai_mcp_enabled,
            ai_mcp::ai_mcp_reset_credentials,
            ai_mcp::ai_mcp_finish,
            ai_mcp::ai_mcp_tools_changed,
            ai_mcp::ai_mcp_disconnect,
            activate_history_incarnation,
            get_history_bars,
            get_quote_snapshot,
            #[cfg(tradeflow_tdx)]
            get_tdx_recent_trades,
            list_market_providers,
            get_market_edition,
            set_market_provider_enabled,
            list_market_catalog,
            list_market_catalog_page,
            #[cfg(tradeflow_tdx)]
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
