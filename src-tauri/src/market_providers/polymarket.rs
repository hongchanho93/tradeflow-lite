use std::borrow::Cow;
use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::Value;

use crate::contracts::{
    Adjustment, AppError, MarketSeriesKind, ProbabilityPoint, Resolution, SymbolKind,
};
use crate::market_adapter::{
    CatalogAdapter, CatalogRequest, CatalogSymbol, POLYMARKET_PROVIDER_DESCRIPTOR,
    PredictionMarketMetadata, ProviderDescriptor, RealtimeAdapter, RealtimePayload,
    RealtimePriceLevel, RealtimeRequest, RealtimeSink,
};
use crate::market_data::{HistoryDiagnostics, HistoryResponse};
use crate::market_router::{HistoryRequest, MarketDataAdapter};

const GAMMA_BASE: &str = "https://gamma-api.polymarket.com";
const CLOB_BASE: &str = "https://clob.polymarket.com";
const CATALOG_LIMIT: usize = 100;
const SOURCE: &str = "polymarket";
const HTTP_TIMEOUT: Duration = Duration::from_secs(8);
const POLL_INTERVAL: Duration = Duration::from_secs(2);

pub(crate) struct PolymarketAdapter;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GammaMarket {
    question: String,
    condition_id: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    resolution_source: String,
    #[serde(default)]
    end_date: String,
    #[serde(default)]
    outcomes: Value,
    #[serde(default)]
    clob_token_ids: Value,
    #[serde(default)]
    outcome_prices: Value,
    #[serde(default)]
    one_day_price_change: Option<f64>,
    #[serde(default)]
    volume_num: Option<f64>,
    #[serde(default)]
    liquidity_num: Option<f64>,
}

#[derive(Deserialize)]
struct PriceHistoryResponse {
    #[serde(default)]
    history: Vec<RawProbabilityPoint>,
}

#[derive(Deserialize)]
struct RawProbabilityPoint {
    t: i64,
    p: f64,
}

#[derive(Deserialize)]
struct MidpointResponse {
    mid: String,
}

#[derive(Deserialize)]
struct BookResponse {
    #[serde(default)]
    bids: Vec<BookLevel>,
    #[serde(default)]
    asks: Vec<BookLevel>,
}

#[derive(Deserialize)]
struct BookLevel {
    price: String,
    size: String,
}

#[derive(Deserialize)]
struct LastTradeResponse {
    price: String,
    #[serde(default)]
    side: String,
}

fn client() -> Result<&'static Client, AppError> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            Client::builder()
                .timeout(HTTP_TIMEOUT)
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("TradeFlow-Lite/0.1 read-only Polymarket market data")
                .build()
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|message| AppError::new("market_data_client_unavailable", message.clone()))
}

fn map_http_error(error: reqwest::Error) -> AppError {
    let message = if error.status().is_some_and(|status| status.as_u16() == 451) {
        "Polymarket 在当前网络区域不可用".to_string()
    } else {
        format!("Polymarket 请求失败：{error}")
    };
    AppError::new("market_data_unavailable", message)
}

fn value_string_array(value: &Value) -> Option<Vec<String>> {
    match value {
        Value::String(raw) => serde_json::from_str(raw).ok(),
        Value::Array(rows) => rows
            .iter()
            .map(|row| row.as_str().map(str::to_owned))
            .collect(),
        _ => None,
    }
}

fn catalog_symbols(markets: Vec<GammaMarket>) -> Vec<CatalogSymbol> {
    markets
        .into_iter()
        .filter_map(|market| {
            let outcomes = value_string_array(&market.outcomes)?;
            let token_ids = value_string_array(&market.clob_token_ids)?;
            let prices = value_string_array(&market.outcome_prices).unwrap_or_default();
            if outcomes.len() != token_ids.len() {
                return None;
            }
            let yes_index = outcomes
                .iter()
                .position(|outcome| outcome.eq_ignore_ascii_case("yes"))?;
            let no_index = outcomes
                .iter()
                .position(|outcome| outcome.eq_ignore_ascii_case("no"))?;
            let yes_token = token_ids.get(yes_index)?.clone();
            let no_token = token_ids.get(no_index)?.clone();
            if yes_token.len() > 96 || no_token.len() > 96 {
                return None;
            }
            let probability = prices
                .get(yes_index)
                .and_then(|value| value.parse::<f64>().ok())
                .filter(|value| value.is_finite() && (0.0..=1.0).contains(value))
                .unwrap_or(0.0)
                * 100.0;
            Some(CatalogSymbol {
                provider_id: POLYMARKET_PROVIDER_DESCRIPTOR.id.to_string(),
                symbol: format!("POLYMARKET:{yes_token}"),
                name: market.question,
                kind: SymbolKind::Prediction,
                base_asset: Some("YES".to_string()),
                quote_asset: None,
                prediction: Some(PredictionMarketMetadata {
                    condition_id: market.condition_id,
                    outcome: "YES".to_string(),
                    opposing_symbol: format!("POLYMARKET:{no_token}"),
                    description: market.description,
                    resolution_source: market.resolution_source,
                    end_date: market.end_date,
                    volume: market.volume_num.unwrap_or(0.0).max(0.0),
                    liquidity: market.liquidity_num.unwrap_or(0.0).max(0.0),
                    probability,
                    change_24h: market.one_day_price_change.unwrap_or(0.0) * 100.0,
                }),
            })
        })
        .collect()
}

fn resolution_seconds(resolution: Resolution) -> i64 {
    match resolution {
        Resolution::Minute1 => 60,
        Resolution::Minute5 => 5 * 60,
        Resolution::Minute15 => 15 * 60,
        Resolution::Minute30 => 30 * 60,
        Resolution::Minute60 => 60 * 60,
        Resolution::Day => 24 * 60 * 60,
        Resolution::Week => 7 * 24 * 60 * 60,
        Resolution::Month => 30 * 24 * 60 * 60,
    }
}

fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn fetch_history(request: HistoryRequest) -> Result<HistoryResponse, AppError> {
    let started = Instant::now();
    let (_, token_id) = request.symbol.parts();
    let end_ts = unix_seconds();
    let interval_seconds = resolution_seconds(request.resolution);
    let requested = request.count.clamp(2, 12_000);
    let start_ts = end_ts.saturating_sub(interval_seconds.saturating_mul(requested as i64));
    let fidelity = (interval_seconds / 60).max(1);
    let response = client()?
        .get(format!("{CLOB_BASE}/prices-history"))
        .query(&[
            ("market", token_id.to_string()),
            ("startTs", start_ts.to_string()),
            ("endTs", end_ts.to_string()),
            ("fidelity", fidelity.to_string()),
        ])
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(map_http_error)?
        .json::<PriceHistoryResponse>()
        .map_err(map_http_error)?;
    let mut unique = BTreeMap::new();
    for point in response.history {
        if point.p.is_finite() && (0.0..=1.0).contains(&point.p) {
            unique.insert(point.t, point.p * 100.0);
        }
    }
    let mut points = unique
        .into_iter()
        .map(|(time, value)| ProbabilityPoint { time, value })
        .collect::<Vec<_>>();
    if points.len() > requested {
        points.drain(..points.len() - requested);
    }
    if points.is_empty() {
        return Err(AppError::new(
            "empty_history",
            "Polymarket 没有返回可用的概率历史",
        ));
    }
    Ok(HistoryResponse {
        symbol: request.symbol,
        series_kind: MarketSeriesKind::Probability,
        bars: Vec::new(),
        points,
        diagnostics: HistoryDiagnostics {
            source: SOURCE,
            host: "clob.polymarket.com".to_string(),
            latency_ms: started.elapsed().as_secs_f64() * 1_000.0,
        },
        quote: None,
    })
}

fn fetch_midpoint(token_id: &str) -> Result<f64, AppError> {
    let response = client()?
        .get(format!("{CLOB_BASE}/midpoint"))
        .query(&[("token_id", token_id)])
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(map_http_error)?
        .json::<MidpointResponse>()
        .map_err(map_http_error)?;
    let value = response
        .mid
        .parse::<f64>()
        .map_err(|_| AppError::new("invalid_market_data", "Polymarket 中间价格式无效"))?
        * 100.0;
    if !value.is_finite() || !(0.0..=100.0).contains(&value) {
        return Err(AppError::new(
            "invalid_market_data",
            "Polymarket 中间价超出概率范围",
        ));
    }
    Ok(value)
}

fn parse_level(level: BookLevel) -> Option<RealtimePriceLevel> {
    let price = level.price.parse::<f64>().ok()? * 100.0;
    let quantity = level.size.parse::<f64>().ok()?;
    (price.is_finite() && (0.0..=100.0).contains(&price) && quantity.is_finite() && quantity >= 0.0)
        .then_some(RealtimePriceLevel { price, quantity })
}

fn fetch_book(
    token_id: &str,
) -> Result<(Vec<RealtimePriceLevel>, Vec<RealtimePriceLevel>), AppError> {
    let response = client()?
        .get(format!("{CLOB_BASE}/book"))
        .query(&[("token_id", token_id)])
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(map_http_error)?
        .json::<BookResponse>()
        .map_err(map_http_error)?;
    let mut bids = response
        .bids
        .into_iter()
        .filter_map(parse_level)
        .collect::<Vec<_>>();
    let mut asks = response
        .asks
        .into_iter()
        .filter_map(parse_level)
        .collect::<Vec<_>>();
    bids.sort_by(|left, right| right.price.total_cmp(&left.price));
    asks.sort_by(|left, right| left.price.total_cmp(&right.price));
    bids.truncate(10);
    asks.truncate(10);
    Ok((bids, asks))
}

fn fetch_last_trade(token_id: &str) -> Result<(f64, String), AppError> {
    let response = client()?
        .get(format!("{CLOB_BASE}/last-trade-price"))
        .query(&[("token_id", token_id)])
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(map_http_error)?
        .json::<LastTradeResponse>()
        .map_err(map_http_error)?;
    let price = response
        .price
        .parse::<f64>()
        .map_err(|_| AppError::new("invalid_market_data", "Polymarket 成交价格式无效"))?
        * 100.0;
    if !price.is_finite() || !(0.0..=100.0).contains(&price) {
        return Err(AppError::new(
            "invalid_market_data",
            "Polymarket 成交价超出概率范围",
        ));
    }
    Ok((price, response.side.to_ascii_lowercase()))
}

fn sleep_while_active(request: &RealtimeRequest) {
    for _ in 0..8 {
        if !request.is_active() {
            return;
        }
        thread::sleep(POLL_INTERVAL / 8);
    }
}

impl CatalogAdapter for PolymarketAdapter {
    fn list_symbols(&self, request: CatalogRequest) -> Result<Vec<CatalogSymbol>, AppError> {
        if request.provider_id != POLYMARKET_PROVIDER_DESCRIPTOR.id || request.venue != "POLYMARKET"
        {
            return Err(AppError::new(
                "catalog_route_not_found",
                "目录市场与 Polymarket provider 不匹配",
            ));
        }
        let markets = client()?
            .get(format!("{GAMMA_BASE}/markets"))
            .query(&[
                ("active", "true"),
                ("closed", "false"),
                ("limit", &CATALOG_LIMIT.to_string()),
                ("order", "volume24hr"),
                ("ascending", "false"),
            ])
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(map_http_error)?
            .json::<Vec<GammaMarket>>()
            .map_err(map_http_error)?;
        let symbols = catalog_symbols(markets);
        if symbols.is_empty() {
            return Err(AppError::new(
                "empty_catalog",
                "Polymarket 没有返回可用的二元预测市场",
            ));
        }
        Ok(symbols)
    }
}

impl RealtimeAdapter for PolymarketAdapter {
    fn start(&self, request: RealtimeRequest, sink: Arc<dyn RealtimeSink>) -> Result<(), AppError> {
        thread::spawn(move || {
            let (_, token_id) = request.symbol.parts();
            let token_id = token_id.to_string();
            let mut connected = false;
            let mut sequence = 0_u64;
            let mut last_trade = None;
            let _ = sink.emit(request.envelope(
                None,
                RealtimePayload::Status {
                    status: "connecting",
                    message: Some("正在连接 Polymarket 公开行情".to_string()),
                },
            ));
            while request.is_active() {
                match fetch_midpoint(&token_id) {
                    Ok(value) => {
                        sequence = sequence.saturating_add(1);
                        if !connected {
                            connected = true;
                            let _ = sink.emit(request.envelope(
                                None,
                                RealtimePayload::Status {
                                    status: "connected",
                                    message: Some("Polymarket 实时轮询已连接".to_string()),
                                },
                            ));
                        }
                        let received_at = unix_seconds();
                        let bucket = resolution_seconds(request.resolution);
                        let now = received_at - received_at.rem_euclid(bucket);
                        let _ = sink.emit(request.envelope(
                            Some(sequence),
                            RealtimePayload::Point {
                                point: ProbabilityPoint { time: now, value },
                                event_time_ms: received_at.saturating_mul(1_000),
                                source: Cow::Borrowed("midpoint"),
                            },
                        ));
                        if let Ok((bids, asks)) = fetch_book(&token_id) {
                            sequence = sequence.saturating_add(1);
                            let _ = sink.emit(request.envelope(
                                Some(sequence),
                                RealtimePayload::Depth {
                                    event_time_ms: received_at.saturating_mul(1_000),
                                    bids,
                                    asks,
                                },
                            ));
                        }
                        if let Ok((price, side)) = fetch_last_trade(&token_id) {
                            if last_trade.as_ref() != Some(&(price, side.clone())) {
                                last_trade = Some((price, side.clone()));
                                sequence = sequence.saturating_add(1);
                                let _ = sink.emit(request.envelope(
                                    Some(sequence),
                                    RealtimePayload::Trade {
                                        trade_id: i64::try_from(sequence).unwrap_or(i64::MAX),
                                        trade_time_ms: received_at.saturating_mul(1_000),
                                        price,
                                        quantity: 0.0,
                                        side: (!side.is_empty()).then_some(Cow::Owned(side)),
                                        flags: None,
                                    },
                                ));
                            }
                        }
                    }
                    Err(error) => {
                        connected = false;
                        let _ = sink.emit(request.envelope(
                            None,
                            RealtimePayload::Status {
                                status: "reconnecting",
                                message: Some(error.message),
                            },
                        ));
                    }
                }
                sleep_while_active(&request);
            }
        });
        Ok(())
    }
}

impl MarketDataAdapter for PolymarketAdapter {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        &POLYMARKET_PROVIDER_DESCRIPTOR
    }

    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        if request.adjustment != Adjustment::None {
            return Err(AppError::new(
                "unsupported_adjustment",
                "预测市场不支持复权",
            ));
        }
        fetch_history(request)
    }

    fn catalog_adapter(&self) -> Option<&dyn CatalogAdapter> {
        Some(self)
    }

    fn realtime_adapter(&self) -> Option<&dyn RealtimeAdapter> {
        Some(self)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CatalogAdapter, CatalogRequest, GammaMarket, HistoryRequest, MarketDataAdapter,
        PolymarketAdapter, Resolution, SymbolKind, catalog_symbols, value_string_array,
    };
    use crate::contracts::{Adjustment, MarketSeriesKind, Symbol};
    use serde_json::json;

    #[test]
    fn parses_string_and_array_metadata_without_confusing_yes_and_no() {
        assert_eq!(
            value_string_array(&json!("[\"Yes\",\"No\"]")).unwrap(),
            ["Yes", "No"]
        );
        assert_eq!(
            value_string_array(&json!(["Up", "Down"])).unwrap(),
            ["Up", "Down"]
        );
        let rows = catalog_symbols(vec![GammaMarket {
            question: "Will it happen?".to_string(),
            condition_id: "0xabc".to_string(),
            description: "Rules".to_string(),
            resolution_source: "https://example.com".to_string(),
            end_date: "2026-12-31T00:00:00Z".to_string(),
            outcomes: json!("[\"No\",\"Yes\"]"),
            clob_token_ids: json!("[\"222\",\"111\"]"),
            outcome_prices: json!("[\"0.4\",\"0.6\"]"),
            one_day_price_change: Some(0.05),
            volume_num: Some(10.0),
            liquidity_num: Some(5.0),
        }]);
        assert_eq!(rows[0].symbol, "POLYMARKET:111");
        assert_eq!(
            rows[0].prediction.as_ref().unwrap().opposing_symbol,
            "POLYMARKET:222"
        );
        assert_eq!(rows[0].prediction.as_ref().unwrap().probability, 60.0);
    }

    #[test]
    #[ignore = "connects to Polymarket public REST APIs"]
    fn real_polymarket_catalog_and_probability_history() {
        let adapter = PolymarketAdapter;
        let catalog = adapter
            .list_symbols(CatalogRequest {
                provider_id: "polymarket".to_string(),
                venue: "POLYMARKET".to_string(),
            })
            .expect("Polymarket catalog must be reachable");
        let first = &catalog[0];
        let (_, token_id) = first.symbol.split_once(':').unwrap();
        let response = adapter
            .fetch_history(HistoryRequest {
                provider_id: "polymarket".to_string(),
                symbol: Symbol::new("POLYMARKET", token_id).unwrap(),
                kind: SymbolKind::Prediction,
                resolution: Resolution::Minute60,
                adjustment: Adjustment::None,
                count: 24,
                include_quote: false,
            })
            .expect("Polymarket probability history must be reachable");
        assert_eq!(response.series_kind, MarketSeriesKind::Probability);
        assert!(!response.points.is_empty());
    }
}
