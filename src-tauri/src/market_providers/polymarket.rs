use std::borrow::Cow;
use std::collections::BTreeMap;
use std::io::Read;
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::Datelike;
use reqwest::blocking::Client;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::contracts::{
    Adjustment, AppError, MarketSeriesKind, ProbabilityPoint, Resolution, SymbolKind,
};
use crate::market_adapter::{
    CatalogAdapter, CatalogPage, CatalogPageRequest, CatalogRequest, CatalogSymbol,
    POLYMARKET_PROVIDER_DESCRIPTOR, PredictionMarketMetadata, ProviderDescriptor, RealtimeAdapter,
    RealtimePayload, RealtimePriceLevel, RealtimeRequest, RealtimeSink, trade_bar_open_time,
};
use crate::market_data::{HistoryDiagnostics, HistoryResponse};
use crate::market_router::{HistoryRequest, MarketDataAdapter};

const GAMMA_BASE: &str = "https://gamma-api.polymarket.com";
const CLOB_BASE: &str = "https://clob.polymarket.com";
const GATEWAY_ENV: &str = "TRADEFLOW_POLYMARKET_GATEWAY_URL";
const CATALOG_PAGE_SIZE: usize = 100;
const SOURCE: &str = "polymarket";
const HTTP_TIMEOUT: Duration = Duration::from_secs(8);
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const MAX_JSON_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

pub(crate) struct PolymarketAdapter;

#[derive(Debug, PartialEq)]
struct ApiBases {
    gamma: String,
    clob: String,
    diagnostics_host: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GammaMarket {
    question: Option<String>,
    condition_id: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    resolution_source: Option<String>,
    #[serde(default)]
    end_date: Option<String>,
    #[serde(default)]
    active: Option<bool>,
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
struct GammaMarketPage {
    #[serde(default)]
    markets: Vec<GammaMarket>,
    #[serde(default)]
    next_cursor: Option<String>,
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

fn api_bases_from(gateway: Option<&str>) -> Result<ApiBases, AppError> {
    let Some(raw_gateway) = gateway.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(ApiBases {
            gamma: GAMMA_BASE.to_string(),
            clob: CLOB_BASE.to_string(),
            diagnostics_host: "clob.polymarket.com".to_string(),
        });
    };
    let parsed = reqwest::Url::parse(raw_gateway).map_err(|_| {
        AppError::new(
            "market_data_configuration_invalid",
            format!("{GATEWAY_ENV} 不是有效 URL"),
        )
    })?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.host_str().is_none()
    {
        return Err(AppError::new(
            "market_data_configuration_invalid",
            format!("{GATEWAY_ENV} 必须是无凭据、无查询参数的 HTTP(S) URL"),
        ));
    }
    let base = raw_gateway.trim_end_matches('/');
    let diagnostics_host = parsed
        .port()
        .map(|port| format!("{}:{port}", parsed.host_str().unwrap_or_default()))
        .unwrap_or_else(|| parsed.host_str().unwrap_or_default().to_string());
    Ok(ApiBases {
        gamma: format!("{base}/v1/polymarket/gamma"),
        clob: format!("{base}/v1/polymarket/clob"),
        diagnostics_host,
    })
}

fn api_bases() -> Result<ApiBases, AppError> {
    let runtime = std::env::var(GATEWAY_ENV).ok();
    api_bases_from(runtime.as_deref())
}

fn map_http_error(error: reqwest::Error) -> AppError {
    let message = match error.status().map(|status| status.as_u16()) {
        Some(451) => "Polymarket 在当前网络区域不可用".to_string(),
        Some(502..=504) => "Polymarket 只读数据服务暂不可用".to_string(),
        _ => format!("Polymarket 请求失败：{error}"),
    };
    AppError::new("market_data_unavailable", message)
}

fn response_too_large_error() -> AppError {
    AppError::new(
        "market_data_response_too_large",
        "Polymarket 返回的数据超过客户端安全上限",
    )
}

fn decode_json_reader<T: DeserializeOwned, R: Read>(
    reader: R,
    max_bytes: usize,
) -> Result<T, AppError> {
    let mut reader = reader.take((max_bytes as u64).saturating_add(1));
    let mut body = Vec::with_capacity(max_bytes.min(64 * 1024));
    reader.read_to_end(&mut body).map_err(|error| {
        AppError::new(
            "market_data_unavailable",
            format!("Polymarket 响应读取失败：{error}"),
        )
    })?;
    if body.len() > max_bytes {
        return Err(response_too_large_error());
    }
    serde_json::from_slice(&body).map_err(|error| {
        AppError::new(
            "invalid_market_data",
            format!("Polymarket JSON 响应无效：{error}"),
        )
    })
}

fn decode_json_response<T: DeserializeOwned>(
    response: reqwest::blocking::Response,
) -> Result<T, AppError> {
    let response = response.error_for_status().map_err(map_http_error)?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_JSON_RESPONSE_BYTES as u64)
    {
        return Err(response_too_large_error());
    }
    decode_json_reader(response, MAX_JSON_RESPONSE_BYTES)
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
            if market.active == Some(false) {
                return None;
            }
            let question = market.question?.trim().to_string();
            if question.is_empty() {
                return None;
            }
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
                name: question,
                kind: SymbolKind::Prediction,
                base_asset: Some("YES".to_string()),
                quote_asset: None,
                prediction: Some(PredictionMarketMetadata {
                    condition_id: market.condition_id,
                    outcome: "YES".to_string(),
                    opposing_symbol: format!("POLYMARKET:{no_token}"),
                    description: market.description.unwrap_or_default(),
                    resolution_source: market.resolution_source.unwrap_or_default(),
                    end_date: market.end_date.unwrap_or_default(),
                    volume: market.volume_num.unwrap_or(0.0).max(0.0),
                    liquidity: market.liquidity_num.unwrap_or(0.0).max(0.0),
                    probability,
                    change_24h: market.one_day_price_change.unwrap_or(0.0) * 100.0,
                }),
            })
        })
        .collect()
}

fn validate_catalog_cursor(cursor: Option<&str>) -> Result<(), AppError> {
    let Some(cursor) = cursor else {
        return Ok(());
    };
    if cursor.is_empty()
        || cursor.len() > 512
        || !cursor
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._~+/=-".contains(&byte))
    {
        return Err(AppError::new(
            "catalog_cursor_invalid",
            "Polymarket 目录游标无效",
        ));
    }
    Ok(())
}

fn fetch_catalog_page(request: CatalogPageRequest) -> Result<CatalogPage, AppError> {
    if request.provider_id != POLYMARKET_PROVIDER_DESCRIPTOR.id || request.venue != "POLYMARKET" {
        return Err(AppError::new(
            "catalog_route_not_found",
            "目录市场与 Polymarket provider 不匹配",
        ));
    }
    validate_catalog_cursor(request.cursor.as_deref())?;
    let limit = request.limit.clamp(1, CATALOG_PAGE_SIZE);
    let bases = api_bases()?;
    let mut query = vec![
        ("closed", "false".to_string()),
        ("limit", limit.to_string()),
        ("order", "volume24hr".to_string()),
        ("ascending", "false".to_string()),
    ];
    if let Some(cursor) = request.cursor {
        query.push(("after_cursor", cursor));
    }
    let response = client()?
        .get(format!("{}/markets-keyset", bases.gamma))
        .query(&query)
        .send()
        .map_err(map_http_error)?;
    let page = decode_json_response::<GammaMarketPage>(response)?;
    let symbols = catalog_symbols(page.markets);
    Ok(CatalogPage {
        symbols,
        next_cursor: page.next_cursor.filter(|cursor| !cursor.is_empty()),
    })
}

fn resolution_seconds(resolution: Resolution) -> i64 {
    match resolution {
        Resolution::Minute1 => 60,
        Resolution::Minute5 => 5 * 60,
        Resolution::Minute15 => 15 * 60,
        Resolution::Minute30 => 30 * 60,
        Resolution::Minute60 => 60 * 60,
        Resolution::Minute120 => 2 * 60 * 60,
        Resolution::Minute240 => 4 * 60 * 60,
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

fn bucket_time(timestamp: i64, resolution: Resolution) -> i64 {
    const DAY_SECONDS: i64 = 24 * 60 * 60;
    match resolution {
        Resolution::Week => {
            // Unix epoch 是周四；向前偏移 3 天后按 7 天整除，对齐 UTC 周一 00:00。
            let monday_offset = 3 * DAY_SECONDS;
            timestamp - (timestamp + monday_offset).rem_euclid(7 * DAY_SECONDS)
        }
        Resolution::Month => chrono::DateTime::<chrono::Utc>::from_timestamp(timestamp, 0)
            .and_then(|datetime| {
                datetime
                    .date_naive()
                    .with_day(1)?
                    .and_hms_opt(0, 0, 0)
                    .map(|value| value.and_utc().timestamp())
            })
            .unwrap_or(timestamp),
        _ => {
            let interval_seconds = resolution_seconds(resolution).max(1);
            timestamp - timestamp.rem_euclid(interval_seconds)
        }
    }
}

fn fetch_history(request: HistoryRequest) -> Result<HistoryResponse, AppError> {
    let started = Instant::now();
    let bases = api_bases()?;
    let (_, token_id) = request.symbol.parts();
    let end_ts = unix_seconds();
    let interval_seconds = resolution_seconds(request.resolution);
    let requested = request.count.clamp(2, 12_000);
    let start_ts = end_ts.saturating_sub(interval_seconds.saturating_mul(requested as i64));
    let fidelity = (interval_seconds / 60).max(1);
    let http = client()?;
    let response = http
        .get(format!("{}/prices-history", bases.clob))
        .query(&[
            ("market", token_id.to_string()),
            ("startTs", start_ts.to_string()),
            ("endTs", end_ts.to_string()),
            ("fidelity", fidelity.to_string()),
        ])
        .send()
        .map_err(map_http_error)?;
    // CLOB rejects a window whose start predates a newly-created market.
    // In that specific case, asking for the market's complete lifetime is bounded
    // by the shorter lifetime and preserves the requested fidelity.
    let response = if response.status() == reqwest::StatusCode::BAD_REQUEST {
        http.get(format!("{}/prices-history", bases.clob))
            .query(&[
                ("market", token_id.to_string()),
                ("interval", "max".to_string()),
                ("fidelity", fidelity.to_string()),
            ])
            .send()
            .map_err(map_http_error)?
    } else {
        response
    };
    let response = decode_json_response::<PriceHistoryResponse>(response)?;
    let mut unique = BTreeMap::new();
    for point in response.history {
        if point.p.is_finite() && (0.0..=1.0).contains(&point.p) {
            unique.insert(bucket_time(point.t, request.resolution), point.p * 100.0);
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
            host: bases.diagnostics_host,
            latency_ms: started.elapsed().as_secs_f64() * 1_000.0,
        },
        quote: None,
    })
}

fn fetch_midpoint(token_id: &str) -> Result<f64, AppError> {
    let bases = api_bases()?;
    let response = client()?
        .get(format!("{}/midpoint", bases.clob))
        .query(&[("token_id", token_id)])
        .send()
        .map_err(map_http_error)?;
    let response = decode_json_response::<MidpointResponse>(response)?;
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
    let bases = api_bases()?;
    let response = client()?
        .get(format!("{}/book", bases.clob))
        .query(&[("token_id", token_id)])
        .send()
        .map_err(map_http_error)?;
    let response = decode_json_response::<BookResponse>(response)?;
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
    let bases = api_bases()?;
    let response = client()?
        .get(format!("{}/last-trade-price", bases.clob))
        .query(&[("token_id", token_id)])
        .send()
        .map_err(map_http_error)?;
    let response = decode_json_response::<LastTradeResponse>(response)?;
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
        let symbols = fetch_catalog_page(CatalogPageRequest {
            provider_id: request.provider_id,
            venue: request.venue,
            cursor: None,
            limit: CATALOG_PAGE_SIZE,
        })?
        .symbols;
        if symbols.is_empty() {
            return Err(AppError::new(
                "empty_catalog",
                "Polymarket 没有返回可用的二元预测市场",
            ));
        }
        Ok(symbols)
    }

    fn list_symbols_page(&self, request: CatalogPageRequest) -> Result<CatalogPage, AppError> {
        fetch_catalog_page(request)
    }
}

impl RealtimeAdapter for PolymarketAdapter {
    fn replace_subscription(
        &self,
        request: RealtimeRequest,
        sink: Arc<dyn RealtimeSink>,
    ) -> Result<(), AppError> {
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
                        let now = bucket_time(received_at, request.resolution);
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
                                let _ = sink.emit(
                                    request.envelope(
                                        Some(sequence),
                                        RealtimePayload::Trade {
                                            trade_id: i64::try_from(sequence).unwrap_or(i64::MAX),
                                            first_trade_id: None,
                                            last_trade_id: None,
                                            trade_time_ms: received_at.saturating_mul(1_000),
                                            bar_time: trade_bar_open_time(
                                                received_at.saturating_mul(1_000),
                                                request.resolution,
                                            )
                                            .unwrap_or_default(),
                                            price,
                                            quantity: 0.0,
                                            side: (!side.is_empty()).then_some(Cow::Owned(side)),
                                            flags: None,
                                        },
                                    ),
                                );
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
    use std::io::Cursor;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    use super::{
        ApiBases, CatalogAdapter, CatalogPageRequest, GammaMarket, HistoryRequest,
        MarketDataAdapter, PolymarketAdapter, RealtimeAdapter, Resolution, SymbolKind,
        api_bases_from, bucket_time, catalog_symbols, decode_json_reader, validate_catalog_cursor,
        value_string_array,
    };
    use crate::contracts::{Adjustment, AppError, MarketSeriesKind, Symbol};
    use crate::market_adapter::{
        RealtimeEventEnvelope, RealtimePayload, RealtimeRequest, RealtimeSink,
    };
    use serde_json::{Value, json};

    #[derive(Default)]
    struct RealtimeProbeSink {
        events: Mutex<Vec<RealtimeEventEnvelope>>,
    }

    impl RealtimeProbeSink {
        fn snapshot(&self) -> Vec<RealtimeEventEnvelope> {
            self.events.lock().unwrap().clone()
        }
    }

    impl RealtimeSink for RealtimeProbeSink {
        fn emit(&self, event: RealtimeEventEnvelope) -> Result<(), AppError> {
            self.events.lock().unwrap().push(event);
            Ok(())
        }
    }

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
            question: Some("Will it happen?".to_string()),
            condition_id: "0xabc".to_string(),
            description: Some("Rules".to_string()),
            resolution_source: Some("https://example.com".to_string()),
            end_date: Some("2026-12-31T00:00:00Z".to_string()),
            active: Some(true),
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
    fn gateway_configuration_switches_both_polymarket_api_families() {
        assert_eq!(
            api_bases_from(Some("https://market-data.example.test/base/")).unwrap(),
            ApiBases {
                gamma: "https://market-data.example.test/base/v1/polymarket/gamma".to_string(),
                clob: "https://market-data.example.test/base/v1/polymarket/clob".to_string(),
                diagnostics_host: "market-data.example.test".to_string(),
            }
        );
        assert!(api_bases_from(Some("file:///tmp/socket")).is_err());
        assert!(api_bases_from(Some("https://user:secret@example.test")).is_err());
        assert!(api_bases_from(Some("https://example.test?target=evil")).is_err());
    }

    #[test]
    fn json_reader_enforces_response_size_before_deserialization() {
        let valid = br#"{"mid":"0.5"}"#;
        let value: Value = decode_json_reader(Cursor::new(valid), valid.len()).unwrap();
        assert_eq!(value["mid"], "0.5");

        let error = decode_json_reader::<Value, _>(Cursor::new(vec![b' '; 65]), 64).unwrap_err();
        assert_eq!(error.code, "market_data_response_too_large");
    }

    #[test]
    fn history_and_realtime_share_the_same_resolution_bucket() {
        assert_eq!(bucket_time(1_789_455_016, Resolution::Day), 1_789_430_400);
        assert_eq!(bucket_time(1_789_455_069, Resolution::Day), 1_789_430_400);
        assert_eq!(
            bucket_time(1_789_455_069, Resolution::Minute60),
            1_789_452_000
        );
    }

    #[test]
    fn week_and_month_buckets_follow_utc_calendar_boundaries() {
        let unix = |value: &str| {
            chrono::DateTime::parse_from_rfc3339(value)
                .unwrap()
                .timestamp()
        };
        let monday = unix("2026-09-14T00:00:00Z");
        let next_monday = unix("2026-09-21T00:00:00Z");
        assert_eq!(
            bucket_time(unix("2026-09-20T23:59:59Z"), Resolution::Week),
            monday
        );
        assert_eq!(bucket_time(next_monday, Resolution::Week), next_monday);

        let september = unix("2026-09-01T00:00:00Z");
        let october = unix("2026-10-01T00:00:00Z");
        assert_eq!(
            bucket_time(unix("2026-09-30T23:59:59Z"), Resolution::Month),
            september
        );
        assert_eq!(bucket_time(october, Resolution::Month), october);
    }

    #[test]
    fn catalog_cursor_is_opaque_bounded_and_url_safe() {
        assert!(validate_catalog_cursor(None).is_ok());
        assert!(validate_catalog_cursor(Some("MTAwMA==")).is_ok());
        assert!(validate_catalog_cursor(Some("")).is_err());
        assert!(validate_catalog_cursor(Some("cursor with spaces")).is_err());
        assert!(validate_catalog_cursor(Some("https://example.com")).is_err());
    }

    #[test]
    #[ignore = "connects to Polymarket public REST APIs"]
    fn real_polymarket_catalog_and_probability_history() {
        let adapter = PolymarketAdapter;
        let first_page = adapter
            .list_symbols_page(CatalogPageRequest {
                provider_id: "polymarket".to_string(),
                venue: "POLYMARKET".to_string(),
                cursor: None,
                limit: 100,
            })
            .expect("Polymarket catalog must be reachable");
        assert!(!first_page.symbols.is_empty());
        let second_page = adapter
            .list_symbols_page(CatalogPageRequest {
                provider_id: "polymarket".to_string(),
                venue: "POLYMARKET".to_string(),
                cursor: first_page.next_cursor.clone(),
                limit: 100,
            })
            .expect("Polymarket second catalog page must be reachable");
        assert!(!second_page.symbols.is_empty());
        assert!(first_page.symbols.iter().all(|first| {
            second_page
                .symbols
                .iter()
                .all(|second| second.symbol != first.symbol)
        }));
        let first = &first_page.symbols[0];
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
        assert!(response.points.iter().all(|point| point.time % 3_600 == 0));
    }

    #[test]
    #[ignore = "connects to Polymarket public REST APIs for realtime polling"]
    fn real_polymarket_realtime_and_cancellation() {
        let adapter = PolymarketAdapter;
        let first_page = adapter
            .list_symbols_page(CatalogPageRequest {
                provider_id: "polymarket".to_string(),
                venue: "POLYMARKET".to_string(),
                cursor: None,
                limit: 100,
            })
            .expect("Polymarket catalog must be reachable");
        let first = first_page
            .symbols
            .first()
            .expect("Polymarket catalog must contain a realtime candidate");
        let (_, token_id) = first.symbol.split_once(':').unwrap();
        let request_id = 31_001;
        let active_request_id = Arc::new(AtomicU64::new(request_id));
        let sink = Arc::new(RealtimeProbeSink::default());

        adapter
            .replace_subscription(
                RealtimeRequest {
                    request_id,
                    provider_id: "polymarket",
                    symbol: Symbol::new("POLYMARKET", token_id).unwrap(),
                    kind: SymbolKind::Prediction,
                    resolution: Resolution::Minute60,
                    active_request_id: Arc::clone(&active_request_id),
                },
                sink.clone(),
            )
            .expect("Polymarket realtime polling must start");

        let deadline = Instant::now() + Duration::from_secs(20);
        let events = loop {
            let events = sink.snapshot();
            let connected = events.iter().any(|event| {
                matches!(
                    &event.payload,
                    RealtimePayload::Status { status, .. } if *status == "connected"
                )
            });
            let point = events
                .iter()
                .any(|event| matches!(event.payload, RealtimePayload::Point { .. }));
            let depth = events
                .iter()
                .any(|event| matches!(event.payload, RealtimePayload::Depth { .. }));
            if connected && point && depth {
                break events;
            }
            assert!(
                Instant::now() < deadline,
                "Polymarket realtime did not produce connected/point/depth: {events:?}"
            );
            thread::sleep(Duration::from_millis(100));
        };
        assert!(events.iter().all(|event| {
            event.request_id == request_id
                && event.provider_id == "polymarket"
                && event.symbol.as_str() == format!("POLYMARKET:{token_id}")
                && event.resolution == Resolution::Minute60
        }));

        active_request_id.store(request_id + 1, Ordering::Release);
        let release_deadline = Instant::now() + Duration::from_secs(12);
        while Arc::strong_count(&sink) > 1 && Instant::now() < release_deadline {
            thread::sleep(Duration::from_millis(100));
        }
        assert_eq!(
            Arc::strong_count(&sink),
            1,
            "Polymarket realtime worker did not release after cancellation"
        );
        let count_after_cancel = sink.snapshot().len();
        thread::sleep(Duration::from_millis(500));
        assert_eq!(sink.snapshot().len(), count_after_cancel);
    }
}
