use std::fmt;
use std::io::Read;
use std::net::TcpStream;
use std::time::Duration;

use serde_json::Value;
use tungstenite::client::connect_with_config;
use tungstenite::protocol::WebSocketConfig;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

const MAX_PAGE_SIZE: usize = 1_000;
const MAX_HISTORY_COUNT: usize = 12_000;
const MAX_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_EXCHANGE_INFO_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_STREAM_MESSAGE_BYTES: usize = 256 * 1024;
const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Market {
    Spot,
    UsdMarginedFutures,
}

impl Market {
    fn rest_base_url(self) -> &'static str {
        match self {
            Self::Spot => "https://data-api.binance.vision",
            Self::UsdMarginedFutures => "https://fapi.binance.com",
        }
    }

    fn websocket_base_url(self) -> &'static str {
        match self {
            Self::Spot => "wss://data-stream.binance.vision",
            Self::UsdMarginedFutures => "wss://fstream.binance.com",
        }
    }

    fn api_path(self, spot: &'static str, usdm: &'static str) -> &'static str {
        match self {
            Self::Spot => spot,
            Self::UsdMarginedFutures => usdm,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Interval {
    Minute1,
    Minute5,
    Minute15,
    Minute30,
    Hour1,
    Day1,
    Week1,
    Month1,
}

impl Interval {
    pub fn as_api_str(self) -> &'static str {
        match self {
            Self::Minute1 => "1m",
            Self::Minute5 => "5m",
            Self::Minute15 => "15m",
            Self::Minute30 => "30m",
            Self::Hour1 => "1h",
            Self::Day1 => "1d",
            Self::Week1 => "1w",
            Self::Month1 => "1M",
        }
    }

    fn from_api_str(value: &str) -> Option<Self> {
        Some(match value {
            "1m" => Self::Minute1,
            "5m" => Self::Minute5,
            "15m" => Self::Minute15,
            "30m" => Self::Minute30,
            "1h" => Self::Hour1,
            "1d" => Self::Day1,
            "1w" => Self::Week1,
            "1M" => Self::Month1,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Kline {
    pub open_time_ms: i64,
    pub close_time_ms: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub quote_volume: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Ticker24h {
    pub last: f64,
    pub previous_close: f64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub volume: f64,
    pub quote_volume: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct KlineEvent {
    pub event_time_ms: i64,
    pub symbol: String,
    pub interval: Interval,
    pub kline: Kline,
    pub first_trade_id: i64,
    pub last_trade_id: i64,
    pub closed: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AggregateTradeEvent {
    pub event_time_ms: i64,
    pub trade_time_ms: i64,
    pub symbol: String,
    pub aggregate_trade_id: i64,
    pub first_trade_id: i64,
    pub last_trade_id: i64,
    pub price: f64,
    pub quantity: f64,
    pub buyer_is_maker: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PriceLevel {
    pub price: f64,
    pub quantity: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DepthEvent {
    pub symbol: String,
    pub last_update_id: i64,
    pub bids: Vec<PriceLevel>,
    pub asks: Vec<PriceLevel>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpotSymbol {
    pub symbol: String,
    pub base_asset: String,
    pub quote_asset: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UsdMarginedSymbol {
    pub symbol: String,
    pub base_asset: String,
    pub quote_asset: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RealtimeEvent {
    AggregateTrade(AggregateTradeEvent),
    Kline(KlineEvent),
    Depth(DepthEvent),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RealtimeUpdateSource {
    AggregateTrade,
    Kline,
}

impl RealtimeUpdateSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AggregateTrade => "aggTrade",
            Self::Kline => "kline",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RealtimeKlineUpdate {
    pub event_time_ms: i64,
    pub kline: Kline,
    pub closed: bool,
    pub source: RealtimeUpdateSource,
}

#[derive(Default)]
pub struct RealtimeKlineState {
    current: Option<Kline>,
    last_kline_event_time_ms: Option<i64>,
    last_aggregate_trade_id: Option<i64>,
    awaiting_calibration: bool,
}

impl RealtimeKlineState {
    pub fn awaiting_calibration(&self) -> bool {
        self.awaiting_calibration
    }

    pub fn apply(&mut self, event: &RealtimeEvent) -> Result<Option<RealtimeKlineUpdate>, Error> {
        match event {
            RealtimeEvent::Kline(event) => self.apply_kline(event),
            RealtimeEvent::AggregateTrade(event) => self.apply_aggregate_trade(event),
            RealtimeEvent::Depth(_) => Ok(None),
        }
    }

    fn apply_kline(&mut self, event: &KlineEvent) -> Result<Option<RealtimeKlineUpdate>, Error> {
        if self.current.as_ref().is_some_and(|current| {
            current.open_time_ms == event.kline.open_time_ms
                && self
                    .last_kline_event_time_ms
                    .is_some_and(|event_time_ms| event.event_time_ms < event_time_ms)
        }) {
            return Ok(None);
        }
        self.current = Some(event.kline.clone());
        self.last_kline_event_time_ms = Some(event.event_time_ms);
        self.awaiting_calibration = false;
        Ok(Some(RealtimeKlineUpdate {
            event_time_ms: event.event_time_ms,
            kline: event.kline.clone(),
            closed: event.closed,
            source: RealtimeUpdateSource::Kline,
        }))
    }

    fn apply_aggregate_trade(
        &mut self,
        event: &AggregateTradeEvent,
    ) -> Result<Option<RealtimeKlineUpdate>, Error> {
        if self
            .last_aggregate_trade_id
            .is_some_and(|aggregate_trade_id| event.aggregate_trade_id <= aggregate_trade_id)
        {
            return Ok(None);
        }
        self.last_aggregate_trade_id = Some(event.aggregate_trade_id);
        if self.awaiting_calibration {
            return Ok(None);
        }
        let Some(current) = self.current.as_ref() else {
            return Ok(None);
        };
        if self
            .last_kline_event_time_ms
            .is_some_and(|event_time_ms| event.event_time_ms < event_time_ms)
        {
            return Ok(None);
        }
        if event.trade_time_ms < current.open_time_ms {
            return Ok(None);
        }
        if event.trade_time_ms > current.close_time_ms {
            let interval_ms = current
                .close_time_ms
                .saturating_sub(current.open_time_ms)
                .saturating_add(1);
            let next_open_time_ms = current.close_time_ms.saturating_add(1);
            let next_close_time_ms = next_open_time_ms
                .saturating_add(interval_ms)
                .saturating_sub(1);
            if interval_ms <= 7 * 24 * 60 * 60 * 1_000
                && event.trade_time_ms <= next_close_time_ms
            {
                let provisional = Kline {
                    open_time_ms: next_open_time_ms,
                    close_time_ms: next_close_time_ms,
                    open: event.price,
                    high: event.price,
                    low: event.price,
                    close: event.price,
                    volume: 0.0,
                    quote_volume: 0.0,
                };
                validate_klines(std::slice::from_ref(&provisional))?;
                self.current = Some(provisional.clone());
                return Ok(Some(RealtimeKlineUpdate {
                    event_time_ms: event.event_time_ms,
                    kline: provisional,
                    closed: false,
                    source: RealtimeUpdateSource::AggregateTrade,
                }));
            }
            self.awaiting_calibration = true;
            return Ok(None);
        }

        let current = self.current.as_mut().expect("current kline checked above");
        current.high = current.high.max(event.price);
        current.low = current.low.min(event.price);
        current.close = event.price;
        validate_klines(std::slice::from_ref(current))?;
        Ok(Some(RealtimeKlineUpdate {
            event_time_ms: event.event_time_ms,
            kline: current.clone(),
            closed: false,
            source: RealtimeUpdateSource::AggregateTrade,
        }))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    message: String,
}

impl Error {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

pub struct Client {
    base_url: String,
    http: reqwest::blocking::Client,
    market: Market,
}

pub struct RealtimeStream {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
    symbol: String,
    interval: Interval,
}

impl RealtimeStream {
    pub fn connect(symbol: &str, interval: Interval) -> Result<Self, Error> {
        let symbol = normalize_symbol(symbol)?;
        let url = spot_stream_url(&symbol, interval);
        Self::connect_url(symbol, interval, url)
    }

    pub fn connect_usd_margined_market(
        symbol: &str,
        interval: Interval,
    ) -> Result<Self, Error> {
        let symbol = normalize_symbol(symbol)?;
        let url = usd_margined_market_stream_url(&symbol, interval);
        Self::connect_url(symbol, interval, url)
    }

    pub fn connect_usd_margined_depth(
        symbol: &str,
        interval: Interval,
    ) -> Result<Self, Error> {
        let symbol = normalize_symbol(symbol)?;
        let url = usd_margined_depth_stream_url(&symbol);
        Self::connect_url(symbol, interval, url)
    }

    fn connect_url(symbol: String, interval: Interval, url: String) -> Result<Self, Error> {
        let socket = connect_stream_socket(url, STREAM_READ_TIMEOUT)?;
        Ok(Self {
            socket,
            symbol,
            interval,
        })
    }

    pub fn read_event(&mut self) -> Result<RealtimeEvent, Error> {
        loop {
            let message = self
                .socket
                .read()
                .map_err(|error| Error::new(format!("Binance WebSocket read failed: {error}")))?;
            match message {
                Message::Text(text) => {
                    return parse_realtime_event(text.as_str(), &self.symbol, self.interval);
                }
                Message::Ping(_) => self.socket.flush().map_err(|error| {
                    Error::new(format!("Binance WebSocket pong failed: {error}"))
                })?,
                Message::Close(frame) => {
                    let detail = frame
                        .map(|frame| frame.reason.to_string())
                        .filter(|reason| !reason.is_empty())
                        .unwrap_or_else(|| "server closed connection".to_string());
                    return Err(Error::new(format!("Binance WebSocket closed: {detail}")));
                }
                Message::Binary(_) => {
                    return Err(Error::new(
                        "Binance WebSocket returned unexpected binary data",
                    ));
                }
                Message::Pong(_) | Message::Frame(_) => {}
            }
        }
    }
}

fn spot_stream_url(symbol: &str, interval: Interval) -> String {
    let symbol = symbol.to_ascii_lowercase();
    format!(
        "{}/stream?streams={symbol}@aggTrade/{symbol}@kline_{}/{symbol}@depth20@100ms",
        Market::Spot.websocket_base_url(),
        interval.as_api_str()
    )
}

fn usd_margined_market_stream_url(symbol: &str, interval: Interval) -> String {
    let symbol = symbol.to_ascii_lowercase();
    format!(
        "{}/market/stream?streams={symbol}@aggTrade/{symbol}@kline_{}",
        Market::UsdMarginedFutures.websocket_base_url(),
        interval.as_api_str()
    )
}

fn usd_margined_depth_stream_url(symbol: &str) -> String {
    let symbol = symbol.to_ascii_lowercase();
    format!(
        "{}/public/stream?streams={symbol}@depth20@100ms",
        Market::UsdMarginedFutures.websocket_base_url()
    )
}

fn connect_stream_socket(
    url: String,
    timeout: Duration,
) -> Result<WebSocket<MaybeTlsStream<TcpStream>>, Error> {
        let config = WebSocketConfig::default()
            .read_buffer_size(16 * 1024)
            .write_buffer_size(0)
            .max_write_buffer_size(MAX_STREAM_MESSAGE_BYTES)
            .max_message_size(Some(MAX_STREAM_MESSAGE_BYTES))
            .max_frame_size(Some(MAX_STREAM_MESSAGE_BYTES));
        let (mut socket, response) = connect_with_config(url, Some(config), 0)
            .map_err(|error| Error::new(format!("Binance WebSocket connect failed: {error}")))?;
        if response.status().as_u16() != 101 {
            return Err(Error::new(format!(
                "Binance WebSocket handshake returned HTTP {}",
                response.status().as_u16()
            )));
        }
        set_stream_timeout(socket.get_mut(), timeout)?;
        Ok(socket)
}

fn set_stream_timeout(
    stream: &mut MaybeTlsStream<TcpStream>,
    timeout: Duration,
) -> Result<(), Error> {
    let result = match stream {
        MaybeTlsStream::Plain(stream) => stream.set_read_timeout(Some(timeout)),
        MaybeTlsStream::Rustls(stream) => stream.sock.set_read_timeout(Some(timeout)),
        _ => return Err(Error::new("unsupported Binance WebSocket TLS transport")),
    };
    result.map_err(|error| Error::new(format!("failed to configure Binance WebSocket: {error}")))
}

impl Client {
    pub fn public_market_data() -> Result<Self, Error> {
        Self::new_for_market(Market::Spot, Market::Spot.rest_base_url(), Duration::from_secs(8))
    }

    pub fn public_usd_margined_market_data() -> Result<Self, Error> {
        Self::new_for_market(
            Market::UsdMarginedFutures,
            Market::UsdMarginedFutures.rest_base_url(),
            Duration::from_secs(8),
        )
    }

    pub fn new(base_url: &str, timeout: Duration) -> Result<Self, Error> {
        Self::new_for_market(Market::Spot, base_url, timeout)
    }

    fn new_for_market(market: Market, base_url: &str, timeout: Duration) -> Result<Self, Error> {
        let base_url = base_url.trim_end_matches('/').to_string();
        if !base_url.starts_with("https://") && !base_url.starts_with("http://127.0.0.1:") {
            return Err(Error::new("Binance base URL must use HTTPS"));
        }
        let http = reqwest::blocking::Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("TradeFlow-Lite/0.1")
            .build()
            .map_err(|error| Error::new(format!("failed to build Binance HTTP client: {error}")))?;
        Ok(Self { base_url, http, market })
    }

    pub fn fetch_klines(
        &self,
        symbol: &str,
        interval: Interval,
        count: usize,
    ) -> Result<Vec<Kline>, Error> {
        let symbol = normalize_symbol(symbol)?;
        let requested = count.clamp(1, MAX_HISTORY_COUNT);
        let mut remaining = requested;
        let mut end_time_ms: Option<i64> = None;
        let mut pages = Vec::new();

        while remaining > 0 {
            let limit = remaining.min(MAX_PAGE_SIZE);
            let mut query = vec![
                ("symbol", symbol.clone()),
                ("interval", interval.as_api_str().to_string()),
                ("limit", limit.to_string()),
            ];
            if let Some(end_time_ms) = end_time_ms {
                query.push(("endTime", end_time_ms.to_string()));
            }
            let payload = self.get_json(self.market.api_path("/api/v3/klines", "/fapi/v1/klines"), &query)?;
            let rows = payload
                .as_array()
                .ok_or_else(|| Error::new("Binance klines response must be an array"))?;
            if rows.is_empty() {
                break;
            }
            let page = rows
                .iter()
                .map(parse_kline)
                .collect::<Result<Vec<_>, _>>()?;
            validate_klines(&page)?;
            let oldest_open_time = page[0].open_time_ms;
            let received = page.len();
            pages.push(page);
            remaining = remaining.saturating_sub(received);
            if received < limit {
                break;
            }
            end_time_ms = Some(
                oldest_open_time
                    .checked_sub(1)
                    .ok_or_else(|| Error::new("Binance kline timestamp underflow"))?,
            );
        }

        let klines = merge_pages(pages, requested)?;
        if klines.is_empty() {
            return Err(Error::new(format!(
                "Binance returned no klines for {symbol}"
            )));
        }
        Ok(klines)
    }

    pub fn fetch_ticker_24h(&self, symbol: &str) -> Result<Ticker24h, Error> {
        let symbol = normalize_symbol(symbol)?;
        let mut query = vec![("symbol", symbol)];
        if self.market == Market::Spot {
            query.push(("type", "FULL".to_string()));
        }
        let payload = self.get_json(
            self.market.api_path("/api/v3/ticker/24hr", "/fapi/v1/ticker/24hr"),
            &query,
        )?;
        let ticker = Ticker24h {
            last: object_number(&payload, "lastPrice")?,
            previous_close: if self.market == Market::Spot {
                object_number(&payload, "prevClosePrice")?
            } else {
                object_number(&payload, "openPrice")?
            },
            open: object_number(&payload, "openPrice")?,
            high: object_number(&payload, "highPrice")?,
            low: object_number(&payload, "lowPrice")?,
            volume: object_number(&payload, "volume")?,
            quote_volume: object_number(&payload, "quoteVolume")?,
        };
        validate_ticker(&ticker)?;
        Ok(ticker)
    }

    pub fn fetch_spot_symbols(&self) -> Result<Vec<SpotSymbol>, Error> {
        if self.market != Market::Spot {
            return Err(Error::new("client is not configured for Binance Spot"));
        }
        let payload = self.get_json_with_limit(
            "/api/v3/exchangeInfo",
            &[
                ("permissions", "SPOT".to_string()),
                ("symbolStatus", "TRADING".to_string()),
                ("showPermissionSets", "false".to_string()),
            ],
            MAX_EXCHANGE_INFO_RESPONSE_BYTES,
        )?;
        let rows = payload
            .get("symbols")
            .and_then(Value::as_array)
            .ok_or_else(|| Error::new("Binance exchange info is missing symbols"))?;
        let mut symbols = rows
            .iter()
            .filter_map(|row| parse_spot_symbol(row).transpose())
            .collect::<Result<Vec<_>, _>>()?;
        symbols.sort_by(|left, right| left.symbol.cmp(&right.symbol));
        symbols.dedup_by(|left, right| left.symbol == right.symbol);
        if symbols.is_empty() {
            return Err(Error::new("Binance returned no active Spot symbols"));
        }
        Ok(symbols)
    }

    pub fn fetch_usd_margined_perpetual_symbols(
        &self,
    ) -> Result<Vec<UsdMarginedSymbol>, Error> {
        if self.market != Market::UsdMarginedFutures {
            return Err(Error::new(
                "client is not configured for Binance USD-M Futures",
            ));
        }
        let payload = self.get_json_with_limit(
            "/fapi/v1/exchangeInfo",
            &[],
            MAX_EXCHANGE_INFO_RESPONSE_BYTES,
        )?;
        let rows = payload
            .get("symbols")
            .and_then(Value::as_array)
            .ok_or_else(|| Error::new("Binance USD-M exchange info is missing symbols"))?;
        let mut symbols = rows
            .iter()
            .filter_map(|row| parse_usd_margined_symbol(row).transpose())
            .collect::<Result<Vec<_>, _>>()?;
        symbols.sort_by(|left, right| left.symbol.cmp(&right.symbol));
        symbols.dedup_by(|left, right| left.symbol == right.symbol);
        if symbols.is_empty() {
            return Err(Error::new(
                "Binance returned no active USD-M perpetual symbols",
            ));
        }
        Ok(symbols)
    }

    fn get_json(&self, path: &str, query: &[(&str, String)]) -> Result<Value, Error> {
        self.get_json_with_limit(path, query, MAX_RESPONSE_BYTES)
    }

    fn get_json_with_limit(
        &self,
        path: &str,
        query: &[(&str, String)],
        max_response_bytes: u64,
    ) -> Result<Value, Error> {
        let response = self
            .http
            .get(format!("{}{path}", self.base_url))
            .query(query)
            .send()
            .map_err(|error| Error::new(format!("Binance request failed: {error}")))?;
        let status = response.status();
        let mut body = String::new();
        response
            .take(max_response_bytes + 1)
            .read_to_string(&mut body)
            .map_err(|error| Error::new(format!("Binance response read failed: {error}")))?;
        if body.len() as u64 > max_response_bytes {
            return Err(Error::new(format!(
                "Binance response exceeded {} MiB limit",
                max_response_bytes / 1024 / 1024
            )));
        }
        if !status.is_success() {
            let detail = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|value| value.get("msg").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| {
                    status
                        .canonical_reason()
                        .unwrap_or("request failed")
                        .to_string()
                });
            return Err(Error::new(format!(
                "Binance HTTP {}: {detail}",
                status.as_u16()
            )));
        }
        serde_json::from_str(&body)
            .map_err(|error| Error::new(format!("Binance returned invalid JSON: {error}")))
    }
}

fn normalize_symbol(symbol: &str) -> Result<String, Error> {
    let symbol = symbol.trim().to_ascii_uppercase();
    let char_count = symbol.chars().count();
    if !(2..=32).contains(&char_count)
        || symbol.len() > 96
        || !symbol.chars().all(char::is_alphanumeric)
    {
        return Err(Error::new("invalid Binance Spot symbol"));
    }
    Ok(symbol)
}

fn parse_kline(value: &Value) -> Result<Kline, Error> {
    let row = value
        .as_array()
        .filter(|row| row.len() >= 8)
        .ok_or_else(|| Error::new("Binance kline row must contain at least 8 fields"))?;
    Ok(Kline {
        open_time_ms: json_i64(&row[0], "open time")?,
        open: json_number(&row[1], "open")?,
        high: json_number(&row[2], "high")?,
        low: json_number(&row[3], "low")?,
        close: json_number(&row[4], "close")?,
        volume: json_number(&row[5], "volume")?,
        close_time_ms: json_i64(&row[6], "close time")?,
        quote_volume: json_number(&row[7], "quote volume")?,
    })
}

#[cfg(test)]
fn parse_kline_event(text: &str) -> Result<KlineEvent, Error> {
    let payload = serde_json::from_str::<Value>(text)
        .map_err(|error| Error::new(format!("Binance WebSocket returned invalid JSON: {error}")))?;
    parse_kline_event_value(&payload)
}

fn parse_realtime_event(
    text: &str,
    expected_symbol: &str,
    expected_interval: Interval,
) -> Result<RealtimeEvent, Error> {
    let payload = serde_json::from_str::<Value>(text)
        .map_err(|error| Error::new(format!("Binance WebSocket returned invalid JSON: {error}")))?;
    let stream = payload
        .get("stream")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::new("Binance combined stream is missing stream name"))?;
    let data = payload
        .get("data")
        .ok_or_else(|| Error::new("Binance combined stream is missing event data"))?;
    let lower_symbol = expected_symbol.to_ascii_lowercase();
    let event = if stream == format!("{lower_symbol}@aggTrade") {
        RealtimeEvent::AggregateTrade(parse_aggregate_trade_event(data)?)
    } else if stream == format!("{lower_symbol}@kline_{}", expected_interval.as_api_str()) {
        RealtimeEvent::Kline(parse_kline_event_value(data)?)
    } else if stream == format!("{lower_symbol}@depth20@100ms") {
        RealtimeEvent::Depth(parse_depth_event(data, expected_symbol)?)
    } else {
        return Err(Error::new(
            "Binance WebSocket event does not match subscription",
        ));
    };
    let matches = match &event {
        RealtimeEvent::AggregateTrade(event) => event.symbol == expected_symbol,
        RealtimeEvent::Kline(event) => {
            event.symbol == expected_symbol && event.interval == expected_interval
        }
        RealtimeEvent::Depth(event) => event.symbol == expected_symbol,
    };
    if !matches {
        return Err(Error::new(
            "Binance WebSocket event does not match subscription",
        ));
    }
    Ok(event)
}

fn parse_spot_symbol(payload: &Value) -> Result<Option<SpotSymbol>, Error> {
    if payload.get("status").and_then(Value::as_str) != Some("TRADING")
        || payload.get("isSpotTradingAllowed").and_then(Value::as_bool) != Some(true)
    {
        return Ok(None);
    }
    let symbol = payload
        .get("symbol")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::new("Binance Spot symbol is missing symbol"))?;
    let base_asset = payload
        .get("baseAsset")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::new("Binance Spot symbol is missing base asset"))?;
    let quote_asset = payload
        .get("quoteAsset")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::new("Binance Spot symbol is missing quote asset"))?;
    let symbol = normalize_symbol(symbol)?;
    let base_asset = normalize_asset(base_asset)?;
    let quote_asset = normalize_asset(quote_asset)?;
    Ok(Some(SpotSymbol {
        symbol,
        base_asset,
        quote_asset,
    }))
}

fn parse_usd_margined_symbol(payload: &Value) -> Result<Option<UsdMarginedSymbol>, Error> {
    if payload.get("status").and_then(Value::as_str) != Some("TRADING")
        || payload.get("contractType").and_then(Value::as_str) != Some("PERPETUAL")
    {
        return Ok(None);
    }
    let symbol = payload
        .get("symbol")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::new("Binance USD-M symbol is missing symbol"))?;
    let base_asset = payload
        .get("baseAsset")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::new("Binance USD-M symbol is missing base asset"))?;
    let quote_asset = payload
        .get("quoteAsset")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::new("Binance USD-M symbol is missing quote asset"))?;
    Ok(Some(UsdMarginedSymbol {
        symbol: normalize_symbol(symbol)?,
        base_asset: normalize_asset(base_asset)?,
        quote_asset: normalize_asset(quote_asset)?,
    }))
}

fn normalize_asset(asset: &str) -> Result<String, Error> {
    let asset = asset.trim().to_ascii_uppercase();
    if asset.is_empty()
        || asset.chars().count() > 24
        || asset.len() > 72
        || !asset.chars().all(char::is_alphanumeric)
    {
        return Err(Error::new("invalid Binance asset code"));
    }
    Ok(asset)
}

fn parse_depth_event(payload: &Value, symbol: &str) -> Result<DepthEvent, Error> {
    let (update_field, bids_field, asks_field) = if payload.get("lastUpdateId").is_some() {
        ("lastUpdateId", "bids", "asks")
    } else {
        ("u", "b", "a")
    };
    let last_update_id = object_i64(payload, update_field)?;
    let bids = parse_price_levels(payload, bids_field)?;
    let asks = parse_price_levels(payload, asks_field)?;
    if last_update_id < 0 || bids.is_empty() || asks.is_empty() {
        return Err(Error::new("Binance depth snapshot is invalid"));
    }
    if !bids
        .windows(2)
        .all(|levels| levels[0].price > levels[1].price)
        || !asks
            .windows(2)
            .all(|levels| levels[0].price < levels[1].price)
        || bids[0].price >= asks[0].price
    {
        return Err(Error::new("Binance depth snapshot is not ordered"));
    }
    Ok(DepthEvent {
        symbol: symbol.to_string(),
        last_update_id,
        bids,
        asks,
    })
}

fn parse_price_levels(payload: &Value, field: &str) -> Result<Vec<PriceLevel>, Error> {
    let rows = payload
        .get(field)
        .and_then(Value::as_array)
        .filter(|rows| rows.len() <= 20)
        .ok_or_else(|| Error::new(format!("Binance depth {field} is invalid")))?;
    rows.iter()
        .map(|row| {
            let row = row
                .as_array()
                .filter(|row| row.len() >= 2)
                .ok_or_else(|| Error::new(format!("Binance depth {field} level is invalid")))?;
            let level = PriceLevel {
                price: json_number(&row[0], "depth price")?,
                quantity: json_number(&row[1], "depth quantity")?,
            };
            if level.price <= 0.0 || level.quantity <= 0.0 {
                return Err(Error::new("Binance depth level must be positive"));
            }
            Ok(level)
        })
        .collect()
}

fn parse_kline_event_value(payload: &Value) -> Result<KlineEvent, Error> {
    if payload.get("e").and_then(Value::as_str) != Some("kline") {
        return Err(Error::new("Binance WebSocket returned an unexpected event"));
    }
    let event_time_ms = object_i64(&payload, "E")?;
    let symbol = payload
        .get("s")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| Error::new("Binance WebSocket kline is missing symbol"))?;
    let raw = payload
        .get("k")
        .ok_or_else(|| Error::new("Binance WebSocket event is missing kline"))?;
    let interval = raw
        .get("i")
        .and_then(Value::as_str)
        .and_then(Interval::from_api_str)
        .ok_or_else(|| Error::new("Binance WebSocket returned an unsupported interval"))?;
    let kline = Kline {
        open_time_ms: object_i64(raw, "t")?,
        close_time_ms: object_i64(raw, "T")?,
        open: object_number(raw, "o")?,
        high: object_number(raw, "h")?,
        low: object_number(raw, "l")?,
        close: object_number(raw, "c")?,
        volume: object_number(raw, "v")?,
        quote_volume: object_number(raw, "q")?,
    };
    validate_klines(std::slice::from_ref(&kline))?;
    let closed = raw
        .get("x")
        .and_then(Value::as_bool)
        .ok_or_else(|| Error::new("Binance WebSocket kline is missing closed state"))?;
    let first_trade_id = object_i64(raw, "f")?;
    let last_trade_id = object_i64(raw, "L")?;
    if !((first_trade_id == -1 && last_trade_id == -1)
        || (first_trade_id >= 0 && last_trade_id >= first_trade_id))
    {
        return Err(Error::new(
            "Binance WebSocket kline contains invalid trade IDs",
        ));
    }
    Ok(KlineEvent {
        event_time_ms,
        symbol,
        interval,
        kline,
        first_trade_id,
        last_trade_id,
        closed,
    })
}

fn parse_aggregate_trade_event(payload: &Value) -> Result<AggregateTradeEvent, Error> {
    if payload.get("e").and_then(Value::as_str) != Some("aggTrade") {
        return Err(Error::new("Binance WebSocket returned an unexpected event"));
    }
    let event = AggregateTradeEvent {
        event_time_ms: object_i64(payload, "E")?,
        trade_time_ms: object_i64(payload, "T")?,
        symbol: payload
            .get("s")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| Error::new("Binance aggregate trade is missing symbol"))?,
        aggregate_trade_id: object_i64(payload, "a")?,
        first_trade_id: object_i64(payload, "f")?,
        last_trade_id: object_i64(payload, "l")?,
        price: object_number(payload, "p")?,
        quantity: object_number(payload, "q")?,
        buyer_is_maker: payload
            .get("m")
            .and_then(Value::as_bool)
            .ok_or_else(|| Error::new("Binance aggregate trade is missing maker side"))?,
    };
    if event.event_time_ms <= 0
        || event.trade_time_ms <= 0
        || event.aggregate_trade_id < 0
        || event.first_trade_id < 0
        || event.last_trade_id < event.first_trade_id
        || event.price <= 0.0
        || event.quantity <= 0.0
    {
        return Err(Error::new(
            "Binance WebSocket returned an invalid aggregate trade",
        ));
    }
    Ok(event)
}

fn json_i64(value: &Value, field: &str) -> Result<i64, Error> {
    value
        .as_i64()
        .ok_or_else(|| Error::new(format!("Binance {field} must be an integer")))
}

fn json_number(value: &Value, field: &str) -> Result<f64, Error> {
    let parsed = match value {
        Value::String(text) => text.parse::<f64>().ok(),
        Value::Number(number) => number.as_f64(),
        _ => None,
    }
    .ok_or_else(|| Error::new(format!("Binance {field} must be numeric")))?;
    if !parsed.is_finite() {
        return Err(Error::new(format!("Binance {field} must be finite")));
    }
    Ok(parsed)
}

fn object_number(value: &Value, field: &str) -> Result<f64, Error> {
    let raw = value
        .get(field)
        .ok_or_else(|| Error::new(format!("Binance ticker is missing {field}")))?;
    json_number(raw, field)
}

fn object_i64(value: &Value, field: &str) -> Result<i64, Error> {
    let raw = value
        .get(field)
        .ok_or_else(|| Error::new(format!("Binance payload is missing {field}")))?;
    json_i64(raw, field)
}

fn validate_klines(klines: &[Kline]) -> Result<(), Error> {
    let mut previous_open = None;
    for kline in klines {
        if previous_open.is_some_and(|time| time >= kline.open_time_ms) {
            return Err(Error::new("Binance klines must be strictly ascending"));
        }
        if kline.close_time_ms < kline.open_time_ms
            || [kline.open, kline.high, kline.low, kline.close]
                .into_iter()
                .any(|price| price <= 0.0)
            || kline.volume < 0.0
            || kline.quote_volume < 0.0
            || kline.high < kline.open.max(kline.close)
            || kline.low > kline.open.min(kline.close)
            || kline.high < kline.low
        {
            return Err(Error::new("Binance returned an invalid kline"));
        }
        previous_open = Some(kline.open_time_ms);
    }
    Ok(())
}

fn validate_ticker(ticker: &Ticker24h) -> Result<(), Error> {
    if [
        ticker.last,
        ticker.previous_close,
        ticker.open,
        ticker.high,
        ticker.low,
    ]
    .into_iter()
    .any(|price| !price.is_finite() || price <= 0.0)
        || !ticker.volume.is_finite()
        || ticker.volume < 0.0
        || !ticker.quote_volume.is_finite()
        || ticker.quote_volume < 0.0
        || ticker.high < ticker.low
    {
        return Err(Error::new("Binance returned an invalid 24h ticker"));
    }
    Ok(())
}

fn merge_pages(mut pages: Vec<Vec<Kline>>, requested: usize) -> Result<Vec<Kline>, Error> {
    pages.reverse();
    let mut klines = pages.into_iter().flatten().collect::<Vec<_>>();
    validate_klines(&klines)?;
    if klines.len() > requested {
        klines.drain(..klines.len() - requested);
    }
    Ok(klines)
}

#[cfg(test)]
mod tests {
    use super::{
        AggregateTradeEvent, Client, Interval, Market, RealtimeEvent, RealtimeKlineState,
        RealtimeStream, RealtimeUpdateSource, merge_pages, parse_kline, parse_kline_event,
        parse_realtime_event, parse_spot_symbol, parse_usd_margined_symbol, spot_stream_url,
        usd_margined_depth_stream_url, usd_margined_market_stream_url,
    };
    use serde_json::json;
    use std::time::Duration;

    #[test]
    fn interval_values_match_binance_spot_contract() {
        assert_eq!(Interval::Minute1.as_api_str(), "1m");
        assert_eq!(Interval::Hour1.as_api_str(), "1h");
        assert_eq!(Interval::Month1.as_api_str(), "1M");
    }

    #[test]
    fn market_endpoints_keep_spot_and_usd_margined_futures_separate() {
        assert_eq!(Market::Spot.rest_base_url(), "https://data-api.binance.vision");
        assert_eq!(
            Market::UsdMarginedFutures.rest_base_url(),
            "https://fapi.binance.com"
        );
        assert_eq!(
            Market::UsdMarginedFutures.websocket_base_url(),
            "wss://fstream.binance.com"
        );
        assert_eq!(
            Market::UsdMarginedFutures.api_path("/api/v3/klines", "/fapi/v1/klines"),
            "/fapi/v1/klines"
        );
        let spot = spot_stream_url("BTCUSDT", Interval::Minute1);
        assert!(spot.contains("@aggTrade") && spot.contains("@depth20@100ms"));
        let market = usd_margined_market_stream_url("BTCUSDT", Interval::Minute1);
        let depth = usd_margined_depth_stream_url("BTCUSDT");
        assert!(market.contains("/market/stream?"));
        assert!(market.contains("@aggTrade") && market.contains("@kline_1m"));
        assert!(!market.contains("@depth"));
        assert!(depth.contains("/public/stream?"));
        assert!(depth.contains("@depth20@100ms"));
        assert!(!depth.contains("@aggTrade") && !depth.contains("@kline"));
    }

    #[test]
    fn rejects_untrusted_plain_http_origins() {
        let error = match Client::new("http://example.com", Duration::from_secs(1)) {
            Ok(_) => panic!("plain HTTP origin must be rejected"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("HTTPS"));
    }

    #[test]
    fn parses_kline_fields_without_losing_decimal_precision_shape() {
        let kline = parse_kline(&json!([
            1_789_375_200_000_i64,
            "77770.17000000",
            "77790.01000000",
            "77766.00000000",
            "77766.01000000",
            "3.52271000",
            1_789_375_259_999_i64,
            "273996.51768920",
            1771,
            "1.19268000",
            "92760.34470020",
            "0"
        ]))
        .unwrap();
        assert_eq!(kline.open_time_ms, 1_789_375_200_000);
        assert_eq!(kline.close_time_ms, 1_789_375_259_999);
        assert_eq!(kline.open, 77_770.17);
        assert_eq!(kline.quote_volume, 273_996.5176892);
    }

    #[test]
    fn parses_and_validates_websocket_kline_events() {
        let event = parse_kline_event(
            r#"{
                "e":"kline","E":1789375234567,"s":"BTCUSDT",
                "k":{"t":1789375200000,"T":1789375259999,"s":"BTCUSDT","i":"1m",
                "o":"77770.17","c":"77766.01","h":"77790.01","l":"77766.00",
                "v":"3.52271","f":100,"L":106,"x":false,"q":"273996.5176892"}
            }"#,
        )
        .unwrap();
        assert_eq!(event.symbol, "BTCUSDT");
        assert_eq!(event.interval, Interval::Minute1);
        assert_eq!(event.kline.close_time_ms, 1_789_375_259_999);
        assert_eq!(event.kline.close, 77_766.01);
        assert_eq!(event.last_trade_id, 106);
        assert!(!event.closed);
    }

    #[test]
    fn rejects_websocket_events_with_invalid_ohlc() {
        let error = parse_kline_event(
            r#"{
                "e":"kline","E":1789375234567,"s":"BTCUSDT",
                "k":{"t":1789375200000,"T":1789375259999,"i":"1m",
                "o":"10","c":"11","h":"9","l":"8","v":"1","f":100,"L":100,
                "x":false,"q":"10"}
            }"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("invalid kline"));
    }

    #[test]
    fn parses_combined_aggregate_trade_events() {
        let text = r#"{
            "stream":"btcusdt@aggTrade",
            "data":{"e":"aggTrade","E":1789375235000,"s":"BTCUSDT","a":81,
            "p":"77780.25","q":"0.125","f":107,"l":109,"T":1789375234999,"m":false}
        }"#;
        let event = parse_realtime_event(text, "BTCUSDT", Interval::Minute1).unwrap();
        let RealtimeEvent::AggregateTrade(event) = event else {
            panic!("expected aggregate trade");
        };
        assert_eq!(event.first_trade_id, 107);
        assert_eq!(event.last_trade_id, 109);
        assert_eq!(event.quantity, 0.125);
        assert!(!event.buyer_is_maker);
    }

    #[test]
    fn parses_only_active_spot_catalog_entries() {
        let active = parse_spot_symbol(&json!({
            "symbol": "BTCUSDT",
            "status": "TRADING",
            "baseAsset": "BTC",
            "quoteAsset": "USDT",
            "isSpotTradingAllowed": true
        }))
        .unwrap()
        .unwrap();
        assert_eq!(active.symbol, "BTCUSDT");
        assert_eq!(active.base_asset, "BTC");
        assert_eq!(active.quote_asset, "USDT");
        assert!(
            parse_spot_symbol(&json!({
                "symbol": "OLDUSDT",
                "status": "BREAK",
                "baseAsset": "OLD",
                "quoteAsset": "USDT",
                "isSpotTradingAllowed": true
            }))
            .unwrap()
            .is_none()
        );
    }

    #[test]
    fn parses_only_active_usd_margined_perpetual_contracts() {
        let active = parse_usd_margined_symbol(&json!({
            "symbol": "BTCUSDT",
            "status": "TRADING",
            "contractType": "PERPETUAL",
            "baseAsset": "BTC",
            "quoteAsset": "USDT"
        }))
        .unwrap()
        .unwrap();
        assert_eq!(active.symbol, "BTCUSDT");
        assert_eq!(active.quote_asset, "USDT");
        assert!(
            parse_usd_margined_symbol(&json!({
                "symbol": "BTCUSDT_261225",
                "status": "TRADING",
                "contractType": "CURRENT_QUARTER",
                "baseAsset": "BTC",
                "quoteAsset": "USDT"
            }))
            .unwrap()
            .is_none()
        );
    }

    #[test]
    fn parses_usd_margined_partial_depth_snapshots() {
        let text = r#"{
            "stream":"btcusdt@depth20@100ms",
            "data":{"e":"depthUpdate","E":1789375235000,"T":1789375234999,
            "s":"BTCUSDT","U":150,"u":160,"pu":149,
            "b":[["100.0","2.0"],["99.5","3.0"]],
            "a":[["100.5","1.5"],["101.0","4.0"]]}
        }"#;
        let event = parse_realtime_event(text, "BTCUSDT", Interval::Minute1).unwrap();
        let RealtimeEvent::Depth(event) = event else {
            panic!("expected depth snapshot");
        };
        assert_eq!(event.last_update_id, 160);
        assert_eq!(event.bids[0].price, 100.0);
        assert_eq!(event.asks[0].quantity, 1.5);
    }

    #[test]
    fn parses_top_twenty_partial_depth_snapshots() {
        let text = r#"{
            "stream":"btcusdt@depth20@100ms",
            "data":{"lastUpdateId":160,"bids":[["100.0","2.0"],["99.5","3.0"]],
            "asks":[["100.5","1.5"],["101.0","4.0"]]}
        }"#;
        let event = parse_realtime_event(text, "BTCUSDT", Interval::Minute1).unwrap();
        let RealtimeEvent::Depth(event) = event else {
            panic!("expected depth snapshot");
        };
        assert_eq!(event.last_update_id, 160);
        assert_eq!(event.bids[0].price, 100.0);
        assert_eq!(event.asks[0].quantity, 1.5);
    }

    #[test]
    fn aggregate_trade_updates_price_without_recounting_official_kline_volume() {
        let mut state = RealtimeKlineState::default();
        let baseline = parse_kline_event(
            r#"{
                "e":"kline","E":1789375234567,"s":"BTCUSDT",
                "k":{"t":1789375200000,"T":1789375259999,"i":"1m",
                "o":"100","c":"101","h":"102","l":"99","v":"5","f":100,"L":106,
                "x":false,"q":"505"}
            }"#,
        )
        .unwrap();
        state.apply(&RealtimeEvent::Kline(baseline)).unwrap();
        let trade = AggregateTradeEvent {
            event_time_ms: 1_789_375_235_000,
            trade_time_ms: 1_789_375_234_999,
            symbol: "BTCUSDT".to_string(),
            aggregate_trade_id: 81,
            first_trade_id: 107,
            last_trade_id: 109,
            price: 103.0,
            quantity: 2.0,
            buyer_is_maker: false,
        };
        let update = state
            .apply(&RealtimeEvent::AggregateTrade(trade.clone()))
            .unwrap()
            .unwrap();
        assert_eq!(update.source, RealtimeUpdateSource::AggregateTrade);
        assert_eq!(update.kline.high, 103.0);
        assert_eq!(update.kline.close, 103.0);
        assert_eq!(update.kline.volume, 5.0);
        assert_eq!(update.kline.quote_volume, 505.0);
        assert!(
            state
                .apply(&RealtimeEvent::AggregateTrade(trade))
                .unwrap()
                .is_none(),
            "a repeated aggregate trade must not add volume twice"
        );
    }

    #[test]
    fn overlapping_raw_trade_ranges_do_not_pause_live_price_updates() {
        let mut state = RealtimeKlineState::default();
        let baseline = parse_kline_event(
            r#"{
                "e":"kline","E":1789375234567,"s":"BTCUSDT",
                "k":{"t":1789375200000,"T":1789375259999,"i":"1m",
                "o":"100","c":"101","h":"102","l":"99","v":"5","f":100,"L":106,
                "x":false,"q":"505"}
            }"#,
        )
        .unwrap();
        state
            .apply(&RealtimeEvent::Kline(baseline.clone()))
            .unwrap();
        let skipped = AggregateTradeEvent {
            event_time_ms: 1_789_375_235_000,
            trade_time_ms: 1_789_375_234_999,
            symbol: "BTCUSDT".to_string(),
            aggregate_trade_id: 82,
            first_trade_id: 108,
            last_trade_id: 109,
            price: 103.0,
            quantity: 2.0,
            buyer_is_maker: false,
        };
        let update = state
            .apply(&RealtimeEvent::AggregateTrade(skipped))
            .unwrap()
            .expect("an overlapping aggregate still carries the latest tradable price");
        assert_eq!(update.kline.close, 103.0);
        assert!(!state.awaiting_calibration());
        let next = AggregateTradeEvent {
            event_time_ms: 1_789_375_235_100,
            trade_time_ms: 1_789_375_235_099,
            symbol: "BTCUSDT".to_string(),
            aggregate_trade_id: 83,
            first_trade_id: 110,
            last_trade_id: 110,
            price: 104.0,
            quantity: 1.0,
            buyer_is_maker: true,
        };
        let update = state
            .apply(&RealtimeEvent::AggregateTrade(next))
            .unwrap()
            .expect("later aggregate trades must keep the live close moving");
        assert_eq!(update.kline.close, 104.0);
        assert_eq!(update.kline.volume, 5.0);
        assert!(!state.awaiting_calibration());

        assert!(state.apply(&RealtimeEvent::Kline(baseline)).unwrap().is_some());
    }

    #[test]
    fn first_trade_of_a_new_fixed_interval_opens_a_provisional_bar() {
        let mut state = RealtimeKlineState::default();
        let baseline = parse_kline_event(
            r#"{
                "e":"kline","E":1789375259900,"s":"BTCUSDT",
                "k":{"t":1789375200000,"T":1789375259999,"i":"1m",
                "o":"100","c":"101","h":"102","l":"99","v":"5","f":100,"L":106,
                "x":true,"q":"505"}
            }"#,
        )
        .unwrap();
        state.apply(&RealtimeEvent::Kline(baseline)).unwrap();
        let trade = AggregateTradeEvent {
            event_time_ms: 1_789_375_260_050,
            trade_time_ms: 1_789_375_260_049,
            symbol: "BTCUSDT".to_string(),
            aggregate_trade_id: 82,
            first_trade_id: 107,
            last_trade_id: 107,
            price: 103.0,
            quantity: 2.0,
            buyer_is_maker: false,
        };
        let update = state
            .apply(&RealtimeEvent::AggregateTrade(trade))
            .unwrap()
            .expect("the first real trade must open the next minute without waiting for Kline");
        assert_eq!(update.kline.open_time_ms, 1_789_375_260_000);
        assert_eq!(update.kline.close_time_ms, 1_789_375_319_999);
        assert_eq!(update.kline.open, 103.0);
        assert_eq!(update.kline.high, 103.0);
        assert_eq!(update.kline.low, 103.0);
        assert_eq!(update.kline.close, 103.0);
        assert_eq!(update.kline.volume, 0.0);
        assert_eq!(update.kline.quote_volume, 0.0);
        assert!(!state.awaiting_calibration());
    }

    #[test]
    #[ignore = "connects to Binance Spot WebSocket market stream"]
    fn receives_real_aggregate_trade_and_kline_events() {
        let mut stream = RealtimeStream::connect("BTCUSDT", Interval::Minute1).unwrap();
        let mut state = RealtimeKlineState::default();
        let mut aggregate_update = false;
        let mut kline_update = false;
        let mut depth_update = false;
        let started = std::time::Instant::now();
        let mut last_update_at = None;
        let mut max_update_gap_ms = 0;
        let mut calibration_pauses = 0;
        let mut updates = 0;
        let mut aggregate_events = 0;
        let mut aggregate_updates = 0;
        let mut last_close = None;
        let mut last_price_change_at = None;
        let mut price_changes = 0;
        let mut max_price_change_gap_ms = 0;
        while started.elapsed() < Duration::from_secs(20) {
            let event = stream.read_event().unwrap();
            match &event {
                RealtimeEvent::AggregateTrade(event) => {
                    aggregate_events += 1;
                    assert_eq!(event.symbol, "BTCUSDT");
                    assert!(event.price > 0.0);
                }
                RealtimeEvent::Kline(event) => {
                    assert_eq!(event.symbol, "BTCUSDT");
                    assert_eq!(event.interval, Interval::Minute1);
                    assert!(event.kline.close > 0.0);
                }
                RealtimeEvent::Depth(event) => {
                    assert_eq!(event.symbol, "BTCUSDT");
                    assert!(event.bids.len() <= 20);
                    assert!(event.asks.len() <= 20);
                    depth_update = true;
                }
            }
            let was_awaiting = state.awaiting_calibration();
            if let Some(update) = state.apply(&event).unwrap() {
                let now = std::time::Instant::now();
                if let Some(previous) = last_update_at {
                    max_update_gap_ms = max_update_gap_ms
                        .max(now.duration_since(previous).as_millis());
                }
                last_update_at = Some(now);
                updates += 1;
                if last_close.is_some_and(|close| close != update.kline.close) {
                    if let Some(previous) = last_price_change_at {
                        max_price_change_gap_ms = max_price_change_gap_ms
                            .max(now.duration_since(previous).as_millis());
                    }
                    last_price_change_at = Some(now);
                    price_changes += 1;
                } else if last_close.is_none() {
                    last_price_change_at = Some(now);
                }
                last_close = Some(update.kline.close);
                match update.source {
                    RealtimeUpdateSource::AggregateTrade => aggregate_update = true,
                    RealtimeUpdateSource::Kline => kline_update = true,
                }
                if update.source == RealtimeUpdateSource::AggregateTrade {
                    aggregate_updates += 1;
                }
            }
            if !was_awaiting && state.awaiting_calibration() {
                calibration_pauses += 1;
            }
        }
        assert!(aggregate_update && kline_update && depth_update);
        eprintln!(
            "Spot 20s cadence: updates={updates} aggregate_events={aggregate_events} aggregate_updates={aggregate_updates} price_changes={price_changes} max_update_gap_ms={max_update_gap_ms} max_price_change_gap_ms={max_price_change_gap_ms} calibration_pauses={calibration_pauses}"
        );
    }

    #[test]
    #[ignore = "connects to Binance Spot exchange information"]
    fn receives_real_active_spot_catalog() {
        let symbols = Client::public_market_data()
            .unwrap()
            .fetch_spot_symbols()
            .unwrap();
        assert!(symbols.len() > 100);
        assert!(symbols.iter().any(|symbol| {
            symbol.symbol == "BTCUSDT" && symbol.base_asset == "BTC" && symbol.quote_asset == "USDT"
        }));
    }

    #[test]
    #[ignore = "connects to Binance USD-M Futures public market data"]
    fn receives_real_usd_margined_perpetual_market() {
        let client = Client::public_usd_margined_market_data().unwrap();
        let symbols = client.fetch_usd_margined_perpetual_symbols().unwrap();
        assert!(symbols.iter().any(|symbol| symbol.symbol == "BTCUSDT"));
        let klines = client
            .fetch_klines("BTCUSDT", Interval::Minute1, 3)
            .unwrap();
        assert_eq!(klines.len(), 3);
        assert!(client.fetch_ticker_24h("BTCUSDT").unwrap().last > 0.0);
    }

    #[test]
    #[ignore = "connects to Binance USD-M Futures WebSocket market stream"]
    fn receives_real_usd_margined_realtime_events() {
        let depth_worker = std::thread::spawn(|| {
            let mut depth =
                RealtimeStream::connect_usd_margined_depth("BTCUSDT", Interval::Minute1).unwrap();
            for _ in 0..300 {
                assert!(matches!(
                    depth.read_event().unwrap(),
                    RealtimeEvent::Depth(_)
                ));
            }
        });
        let mut market =
            RealtimeStream::connect_usd_margined_market("BTCUSDT", Interval::Minute1).unwrap();
        let mut aggregate_trade = false;
        let mut kline = false;
        let mut state = RealtimeKlineState::default();
        let started = std::time::Instant::now();
        let mut events = 0;
        let mut updates = 0;
        let mut calibration_pauses = 0;
        let mut last_update_at = None;
        let mut max_update_gap_ms = 0;
        let mut max_lag_ms = 0;
        while started.elapsed() < Duration::from_secs(30) {
            let event = market.read_event().unwrap();
            let event_time_ms = match &event {
                RealtimeEvent::AggregateTrade(event) => {
                    aggregate_trade = true;
                    event.event_time_ms
                }
                RealtimeEvent::Kline(event) => {
                    kline = true;
                    event.event_time_ms
                }
                RealtimeEvent::Depth(_) => panic!("depth must not share the USD-M market stream"),
            };
            let was_awaiting = state.awaiting_calibration();
            if state.apply(&event).unwrap().is_some() {
                let now = std::time::Instant::now();
                if let Some(previous) = last_update_at {
                    max_update_gap_ms = max_update_gap_ms
                        .max(now.duration_since(previous).as_millis());
                }
                last_update_at = Some(now);
                updates += 1;
            }
            if !was_awaiting && state.awaiting_calibration() {
                calibration_pauses += 1;
            }
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64;
            max_lag_ms = max_lag_ms.max(now_ms.saturating_sub(event_time_ms));
            events += 1;
        }
        depth_worker.join().unwrap();
        assert!(aggregate_trade && kline);
        eprintln!(
            "USD-M 30s cadence: events={events} updates={updates} max_lag_ms={max_lag_ms} max_update_gap_ms={max_update_gap_ms} calibration_pauses={calibration_pauses}"
        );
        assert!(events > 100, "USD-M market stream was unexpectedly quiet");
        assert!(
            max_lag_ms < 2_000,
            "USD-M market stream accumulated {max_lag_ms}ms of lag"
        );
    }

    #[test]
    fn rejects_overlapping_history_pages_instead_of_splicing_them() {
        let row = |open_time_ms| super::Kline {
            open_time_ms,
            close_time_ms: open_time_ms + 59_999,
            open: 10.0,
            high: 11.0,
            low: 9.0,
            close: 10.5,
            volume: 1.0,
            quote_volume: 10.0,
        };
        let error =
            merge_pages(vec![vec![row(120_000)], vec![row(60_000), row(120_000)]], 3).unwrap_err();
        assert!(error.to_string().contains("strictly ascending"));
    }
}
