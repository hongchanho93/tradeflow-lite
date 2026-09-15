//! 面向 Tauri 命令的行情功能。
//!
//! - `hosts`：主站池与整次请求故障切换，所有联网功能共用。
//! - `history`：历史 K 线流水线。
//! - `quote`：行情快照的对外格式。
//! - `clock`：北京时间换算。
//!
//! 新增一项行情功能（例如分笔成交、F10、财务数据）时：在 `tdx::standard` 里添加协议命令，
//! 在这里新增一个模块写业务处理，再用 [`hosts::run_with_failover`] 执行。

mod clock;
mod history;
mod hosts;
mod quote;
#[cfg(test)]
mod real_market;

use serde::Serialize;

use crate::contracts::{Adjustment, AppError, Bar, Resolution, Symbol, SymbolKind};
use crate::tdx::standard::{Market, SecurityQuotes};
use crate::tdx::{SecurityCode, Session};
use history::HistoryQuery;
pub use hosts::HostProbe;
pub use quote::QuoteSnapshot;

const MAX_HISTORY_BARS: usize = 12_000;
const SOURCE: &str = "tradeflow-tdx";

fn normalize_history_count(count: usize) -> usize {
    count.clamp(2, MAX_HISTORY_BARS)
}

fn tdx_market(exchange: &str) -> Result<Market, AppError> {
    match exchange {
        "SH" => Ok(Market::Shanghai),
        "SZ" => Ok(Market::Shenzhen),
        "BJ" => Ok(Market::Beijing),
        _ => Err(AppError::new("invalid_symbol", "不支持的交易所")),
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct HostBenchmarkResponse {
    pub probes: Vec<HostProbe>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResponse {
    pub symbol: Symbol,
    pub bars: Vec<Bar>,
    pub diagnostics: HistoryDiagnostics,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quote: Option<QuoteSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDiagnostics {
    pub source: &'static str,
    pub host: String,
    pub latency_ms: f64,
}

pub fn benchmark_hosts() -> Result<HostBenchmarkResponse, AppError> {
    Ok(HostBenchmarkResponse {
        probes: hosts::benchmark(&hosts::DEFAULT_HOSTS),
    })
}

pub(crate) fn fetch_history_bars_raw(
    symbol: Symbol,
    kind: SymbolKind,
    resolution: Resolution,
    adjustment: Adjustment,
    count: usize,
    include_quote: bool,
) -> Result<HistoryResponse, AppError> {
    let (exchange, code) = symbol.parts();
    let market = tdx_market(exchange)?;
    eprintln!(
        "market.history.route exchange={} code={} market={} kind={}",
        exchange,
        code,
        market.code(),
        kind.as_str()
    );
    let query = HistoryQuery {
        market,
        code: SecurityCode::new(code)
            .map_err(|error| AppError::new("invalid_symbol", error.to_string()))?,
        kind: kind.clone(),
        resolution,
        adjustment,
        count: normalize_history_count(count),
        include_quote,
    };
    let today = clock::shanghai_today();
    let hosts = hosts::ordered_hosts();
    let success = hosts::run_with_failover(&hosts, |host| {
        hosts::connect_and_run(host, |client| history::load_history(client, &query, today))
    })
    .map_err(|attempts| {
        hosts::record_attempts(None, &attempts);
        let detail = attempts
            .iter()
            .map(|attempt| format!("{} {}", attempt.host, attempt.error))
            .collect::<Vec<_>>()
            .join(" | ");
        AppError::new(
            "market_data_unavailable",
            format!("all Lite hosts failed; {detail}"),
        )
    })?;
    let history::HistoryData {
        bars,
        repairs,
        quote,
    } = success.value;

    if bars.is_empty() {
        return Err(AppError::new("empty_history", "行情源没有返回日线数据"));
    }
    if repairs.ohlc_envelope > 0 {
        eprintln!(
            "market.history.ohlc_repaired exchange={} code={} kind={} count={} first_time={:?} last_time={:?}",
            exchange,
            code,
            kind.as_str(),
            repairs.ohlc_envelope,
            repairs.first_time,
            repairs.last_time
        );
    }
    if repairs.non_positive_adjusted_bars > 0 {
        eprintln!(
            "market.history.qfq_non_positive exchange={} code={} kind={} bars={}",
            exchange,
            code,
            kind.as_str(),
            repairs.non_positive_adjusted_bars
        );
    }
    hosts::record_attempts(Some(&success.host), &success.attempts);
    let quote = quote.filter(|quote| {
        let valid = quote.is_valid();
        if !valid {
            eprintln!("market.quote.invalid symbol={exchange}:{code}");
        }
        valid
    });

    Ok(HistoryResponse {
        symbol,
        bars,
        diagnostics: HistoryDiagnostics {
            source: SOURCE,
            host: success.host,
            latency_ms: success.latency_ms,
        },
        quote,
    })
}

/// 保留给旧的直接 helper 调用方的可信边界。经由 `MarketRouter` 的生产路径使用
/// `fetch_history_bars_raw`，由通用路由器统一执行一次批次校验。
#[allow(dead_code)]
pub fn fetch_history_bars(
    symbol: Symbol,
    kind: SymbolKind,
    resolution: Resolution,
    adjustment: Adjustment,
    count: usize,
    include_quote: bool,
) -> Result<HistoryResponse, AppError> {
    let response =
        fetch_history_bars_raw(symbol, kind, resolution, adjustment, count, include_quote)?;
    match adjustment {
        Adjustment::None => Bar::validate_series(&response.bars)?,
        Adjustment::Qfq => Bar::validate_adjusted_series(&response.bars)?,
    }
    Ok(response)
}

/// 通过与历史相同的 TDX 主站池读取一份报价快照。
///
/// 每次尝试都在同一条可复用连接上完成；失败时丢弃该次尝试并换站，不把不同主站的
/// 字段拼成一份快照。历史适配器仍保留其“同一请求同时取报价”的旧路径，外部 quote
/// facet 使用这个独立入口时不会改变历史批次语义。
pub fn fetch_quote_snapshot(symbol: Symbol, kind: SymbolKind) -> Result<QuoteSnapshot, AppError> {
    let (exchange, code) = symbol.parts();
    let market = tdx_market(exchange)?;
    let security_code = SecurityCode::new(code)
        .map_err(|error| AppError::new("invalid_symbol", error.to_string()))?;
    let hosts = hosts::ordered_hosts();
    let success = hosts::run_with_failover(&hosts, |host| {
        hosts::connect_and_run(host, |client| {
            let quote = client
                .call(&SecurityQuotes {
                    securities: vec![(market, security_code)],
                })
                .map_err(|error| error.to_string())?
                .into_iter()
                .next()
                .ok_or_else(|| "quote response was empty".to_string())?;
            let quote = QuoteSnapshot::from_tdx(&quote, &kind);
            if quote.is_valid() {
                Ok(quote)
            } else {
                Err("quote response was invalid".to_string())
            }
        })
    })
    .map_err(|attempts| {
        hosts::record_attempts(None, &attempts);
        let detail = attempts
            .iter()
            .map(|attempt| format!("{} {}", attempt.host, attempt.error))
            .collect::<Vec<_>>()
            .join(" | ");
        AppError::new(
            "market_data_unavailable",
            format!("all Lite hosts failed for quote; {detail}"),
        )
    })?;
    hosts::record_attempts(Some(&success.host), &success.attempts);
    Ok(success.value)
}

#[cfg(test)]
mod tests {
    use super::{normalize_history_count, tdx_market};
    use crate::tdx::standard::Market;

    #[test]
    fn deep_history_requests_are_not_truncated_to_one_protocol_page() {
        assert_eq!(normalize_history_count(8_000), 8_000);
        assert_eq!(normalize_history_count(12_000), 12_000);
        assert_eq!(normalize_history_count(50_000), 12_000);
        assert_eq!(normalize_history_count(1), 2);
    }

    #[test]
    fn exchanges_use_distinct_tdx_market_codes() {
        assert_eq!(tdx_market("SH").unwrap(), Market::Shanghai);
        assert_eq!(tdx_market("SZ").unwrap(), Market::Shenzhen);
        assert_eq!(tdx_market("BJ").unwrap(), Market::Beijing);
        assert_eq!(
            [Market::Shenzhen, Market::Shanghai, Market::Beijing].map(Market::code),
            [0, 1, 2]
        );
        assert!(tdx_market("HK").is_err());
    }
}
