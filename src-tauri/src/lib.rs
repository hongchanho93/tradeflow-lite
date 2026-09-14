pub mod contracts;
mod market_data;
pub mod tdx;

use contracts::{Adjustment, AppError, Resolution, Symbol, SymbolKind};
use market_data::{HistoryResponse, HostBenchmarkResponse};

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
        market_data::fetch_history_bars(symbol, kind, resolution, adjustment, count, include_quote)
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

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_history_bars, benchmark_hosts])
        .run(tauri::generate_context!())
        .expect("failed to run TradeFlow Lite");
}
