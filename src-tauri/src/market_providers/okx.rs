use std::borrow::Cow;
use std::collections::BTreeMap;
use std::io::Read;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{Datelike, TimeZone, Utc};
use serde_json::{Value, json};
use tungstenite::client::{IntoClientRequest, uri_mode};
use tungstenite::stream::{MaybeTlsStream, Mode};
use tungstenite::{Message, WebSocket, client_tls_with_config};

use crate::contracts::{
    Adjustment, AppError, Bar, MarketSeriesKind, Resolution, Symbol, SymbolKind,
};
use crate::market_adapter::{
    CatalogAdapter, CatalogRequest, CatalogSymbol, OKX_SPOT_PROVIDER_DESCRIPTOR,
    OKX_SWAP_PROVIDER_DESCRIPTOR, ProviderDescriptor, QuoteAdapter, QuoteRequest, QuoteResponse,
    RealtimeAdapter, RealtimePayload, RealtimePriceLevel, RealtimeRequest, RealtimeSink,
};
use crate::market_data::{HistoryDiagnostics, HistoryResponse, QuoteSnapshot};
use crate::market_router::{HistoryRequest, MarketDataAdapter};

const REST_ORIGIN: &str = "https://www.okx.com";
const REST_HOST: &str = "www.okx.com";
const PUBLIC_WS_URL: &str = "wss://ws.okx.com:8443/ws/v5/public";
const BUSINESS_WS_URL: &str = "wss://ws.okx.com:8443/ws/v5/business";
const MAX_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_HISTORY_COUNT: usize = 12_000;
const HISTORY_PAGE_SIZE: usize = 300;
const HISTORY_PAGE_DELAY: Duration = Duration::from_millis(110);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const IO_TIMEOUT: Duration = Duration::from_millis(200);
const PING_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OkxMarket {
    Spot,
    Swap,
}

impl OkxMarket {
    fn instrument_type(self) -> &'static str {
        match self {
            Self::Spot => "SPOT",
            Self::Swap => "SWAP",
        }
    }

    fn venue(self) -> &'static str {
        match self {
            Self::Spot => "OKX",
            Self::Swap => "OKX_SWAP",
        }
    }

    fn source(self) -> &'static str {
        match self {
            Self::Spot => "tradeflow-okx-spot",
            Self::Swap => "tradeflow-okx-swap",
        }
    }
}

pub(crate) struct OkxSpotAdapter;
pub(crate) struct OkxSwapAdapter;

impl MarketDataAdapter for OkxSpotAdapter {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        &OKX_SPOT_PROVIDER_DESCRIPTOR
    }

    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        fetch_history(OkxMarket::Spot, request)
    }

    fn quote_adapter(&self) -> Option<&dyn QuoteAdapter> {
        Some(self)
    }

    fn catalog_adapter(&self) -> Option<&dyn CatalogAdapter> {
        Some(self)
    }

    fn realtime_adapter(&self) -> Option<&dyn RealtimeAdapter> {
        Some(self)
    }
}

impl MarketDataAdapter for OkxSwapAdapter {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        &OKX_SWAP_PROVIDER_DESCRIPTOR
    }

    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        fetch_history(OkxMarket::Swap, request)
    }

    fn quote_adapter(&self) -> Option<&dyn QuoteAdapter> {
        Some(self)
    }

    fn catalog_adapter(&self) -> Option<&dyn CatalogAdapter> {
        Some(self)
    }

    fn realtime_adapter(&self) -> Option<&dyn RealtimeAdapter> {
        Some(self)
    }
}

impl QuoteAdapter for OkxSpotAdapter {
    fn fetch_quote(&self, request: QuoteRequest) -> Result<QuoteResponse, AppError> {
        fetch_quote(OkxMarket::Spot, request)
    }
}

impl QuoteAdapter for OkxSwapAdapter {
    fn fetch_quote(&self, request: QuoteRequest) -> Result<QuoteResponse, AppError> {
        fetch_quote(OkxMarket::Swap, request)
    }
}

impl CatalogAdapter for OkxSpotAdapter {
    fn list_symbols(&self, request: CatalogRequest) -> Result<Vec<CatalogSymbol>, AppError> {
        fetch_catalog(OkxMarket::Spot, request)
    }
}

impl CatalogAdapter for OkxSwapAdapter {
    fn list_symbols(&self, request: CatalogRequest) -> Result<Vec<CatalogSymbol>, AppError> {
        fetch_catalog(OkxMarket::Swap, request)
    }
}

impl RealtimeAdapter for OkxSpotAdapter {
    fn replace_subscription(
        &self,
        request: RealtimeRequest,
        sink: Arc<dyn RealtimeSink>,
    ) -> Result<(), AppError> {
        replace_realtime_subscription(OkxMarket::Spot, request, sink)
    }
}

impl RealtimeAdapter for OkxSwapAdapter {
    fn replace_subscription(
        &self,
        request: RealtimeRequest,
        sink: Arc<dyn RealtimeSink>,
    ) -> Result<(), AppError> {
        replace_realtime_subscription(OkxMarket::Swap, request, sink)
    }
}

fn fetch_catalog(
    market: OkxMarket,
    request: CatalogRequest,
) -> Result<Vec<CatalogSymbol>, AppError> {
    let started_at = Instant::now();
    let descriptor = descriptor(market);
    if request.provider_id != descriptor.id || request.venue != market.venue() {
        return Err(AppError::new(
            "catalog_route_not_found",
            "OKX 目录身份与市场不匹配",
        ));
    }
    let rows = client()?.get_data(
        "/api/v5/public/instruments",
        &[("instType", market.instrument_type().to_string())],
    )?;
    let mut symbols = rows
        .iter()
        .filter(|row| text(row, "state").ok() == Some("live"))
        .filter_map(|row| catalog_symbol(market, row).transpose())
        .collect::<Result<Vec<_>, _>>()?;
    symbols.sort_by(|left, right| left.symbol.cmp(&right.symbol));
    symbols.dedup_by(|left, right| left.symbol == right.symbol);
    if symbols.is_empty() {
        return Err(AppError::new(
            "invalid_market_data",
            "OKX 没有返回可用的交易品种",
        ));
    }
    eprintln!(
        "market.catalog.okx provider={} venue={} symbols={} latency_ms={:.1}",
        descriptor.id,
        market.venue(),
        symbols.len(),
        started_at.elapsed().as_secs_f64() * 1000.0
    );
    Ok(symbols)
}

fn catalog_symbol(market: OkxMarket, row: &Value) -> Result<Option<CatalogSymbol>, AppError> {
    if text(row, "instType")? != market.instrument_type() {
        return Ok(None);
    }
    let instrument_id = text(row, "instId")?;
    let (base, quote) = match market {
        OkxMarket::Spot => (text(row, "baseCcy")?, text(row, "quoteCcy")?),
        OkxMarket::Swap => text(row, "instFamily")?
            .split_once('-')
            .ok_or_else(|| AppError::new("invalid_market_data", "OKX SWAP 缺少产品族"))?,
    };
    if !valid_asset(base) || !valid_asset(quote) {
        return Ok(None);
    }
    let symbol = Symbol::new(market.venue(), instrument_id)?;
    Ok(Some(CatalogSymbol {
        provider_id: descriptor(market).id.to_string(),
        symbol: symbol.as_str().to_string(),
        name: if market == OkxMarket::Swap {
            format!("{base} / {quote} Perpetual")
        } else {
            format!("{base} / {quote}")
        },
        kind: SymbolKind::Crypto,
        base_asset: Some(base.to_string()),
        quote_asset: Some(quote.to_string()),
        prediction: None,
    }))
}

fn fetch_history(market: OkxMarket, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
    if request.adjustment != Adjustment::None {
        return Err(AppError::new(
            "unsupported_adjustment",
            "OKX 数字货币不支持复权",
        ));
    }
    let started_at = Instant::now();
    let code = request.symbol.parts().1.to_string();
    let requested = request.count.clamp(2, MAX_HISTORY_COUNT);
    let mut after: Option<i64> = None;
    let mut bars = BTreeMap::new();
    let mut pages = 0_usize;

    while bars.len() < requested {
        let limit = (requested - bars.len()).min(HISTORY_PAGE_SIZE);
        let mut query = vec![
            ("instId", code.clone()),
            ("bar", interval_for(request.resolution).to_string()),
            ("limit", limit.to_string()),
        ];
        if let Some(cursor) = after {
            query.push(("after", cursor.to_string()));
            thread::sleep(HISTORY_PAGE_DELAY);
        }
        let rows = client()?.get_data("/api/v5/market/history-candles", &query)?;
        pages += 1;
        if rows.is_empty() {
            break;
        }
        let oldest = rows
            .iter()
            .map(candle_open_time_ms)
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .min()
            .ok_or_else(|| AppError::new("invalid_market_data", "OKX K 线分页为空"))?;
        if after.is_some_and(|previous| oldest >= previous) {
            return Err(AppError::new(
                "invalid_market_data",
                "OKX K 线分页没有向更早时间推进",
            ));
        }
        for row in &rows {
            let bar = parse_candle(market, request.resolution, row)?;
            bars.insert(bar.time, bar);
        }
        after = Some(oldest);
        if rows.len() < limit {
            break;
        }
    }

    let mut bars = bars.into_values().collect::<Vec<_>>();
    if bars.len() > requested {
        bars.drain(..bars.len() - requested);
    }
    let quote = if request.include_quote {
        match fetch_quote_snapshot(market, &request.symbol) {
            Ok(quote) => Some(quote),
            Err(error) => {
                eprintln!(
                    "market.history.quote_degraded provider={} symbol={} code={} message={}",
                    request.provider_id,
                    request.symbol.as_str(),
                    error.code,
                    error.message
                );
                None
            }
        }
    } else {
        None
    };
    eprintln!(
        "market.history.okx provider={} symbol={} requested={} rows={} pages={} latency_ms={:.1}",
        request.provider_id,
        request.symbol.as_str(),
        requested,
        bars.len(),
        pages,
        started_at.elapsed().as_secs_f64() * 1_000.0
    );
    Ok(HistoryResponse {
        symbol: request.symbol,
        series_kind: MarketSeriesKind::Ohlcv,
        bars,
        points: Vec::new(),
        diagnostics: HistoryDiagnostics {
            source: market.source(),
            host: REST_HOST.to_string(),
            latency_ms: started_at.elapsed().as_secs_f64() * 1_000.0,
        },
        quote,
    })
}

fn fetch_quote(market: OkxMarket, request: QuoteRequest) -> Result<QuoteResponse, AppError> {
    let quote = fetch_quote_snapshot(market, &request.symbol)?;
    Ok(QuoteResponse {
        provider_id: descriptor(market).id.to_string(),
        symbol: request.symbol,
        source: market.source().to_string(),
        quote,
    })
}

fn fetch_quote_snapshot(market: OkxMarket, symbol: &Symbol) -> Result<QuoteSnapshot, AppError> {
    let code = symbol.parts().1;
    let rows = client()?.get_data("/api/v5/market/ticker", &[("instId", code.to_string())])?;
    let ticker = rows
        .first()
        .ok_or_else(|| AppError::new("invalid_market_data", "OKX ticker 为空"))?;
    if text(ticker, "instId")? != code || text(ticker, "instType")? != market.instrument_type() {
        return Err(AppError::new(
            "provider_contract_violation",
            "OKX ticker 返回了其他品种",
        ));
    }
    let quote = QuoteSnapshot {
        last: number(ticker, "last")?,
        previous_close: number(ticker, "sodUtc0")?,
        open: number(ticker, "open24h")?,
        high: number(ticker, "high24h")?,
        low: number(ticker, "low24h")?,
        volume: number(
            ticker,
            if market == OkxMarket::Swap {
                "volCcy24h"
            } else {
                "vol24h"
            },
        )?,
        // OKX SWAP ticker 不提供精确的计价币成交额。0 表示该字段不可得，
        // K 线仍使用 volCcyQuote 提供的精确计价币成交额。
        amount: if market == OkxMarket::Spot {
            number(ticker, "volCcy24h")?
        } else {
            0.0
        },
        received_at: now_seconds(),
    };
    if !quote.is_valid() {
        return Err(AppError::new(
            "invalid_market_data",
            "OKX ticker 不能满足统一报价合同",
        ));
    }
    Ok(quote)
}

fn parse_candle(market: OkxMarket, resolution: Resolution, row: &Value) -> Result<Bar, AppError> {
    let row = row
        .as_array()
        .filter(|row| row.len() == 9)
        .ok_or_else(|| AppError::new("invalid_market_data", "OKX candle 字段数不是 9"))?;
    let open_time_ms = json_i64(&row[0], "candle ts")?;
    Ok(Bar::new(
        candle_close_time(open_time_ms, resolution)?,
        json_number(&row[1], "open")?,
        json_number(&row[2], "high")?,
        json_number(&row[3], "low")?,
        json_number(&row[4], "close")?,
        json_number(
            &row[if market == OkxMarket::Swap { 6 } else { 5 }],
            "volume",
        )?,
        Some(json_number(&row[7], "quote volume")?),
    ))
}

fn candle_open_time_ms(row: &Value) -> Result<i64, AppError> {
    let row = row
        .as_array()
        .and_then(|row| row.first())
        .ok_or_else(|| AppError::new("invalid_market_data", "OKX candle 缺少时间"))?;
    json_i64(row, "candle ts")
}

fn candle_close_time(open_time_ms: i64, resolution: Resolution) -> Result<i64, AppError> {
    let open_seconds = open_time_ms / 1_000;
    if resolution != Resolution::Month {
        let interval_seconds = match resolution {
            Resolution::Minute1 => 60,
            Resolution::Minute5 => 5 * 60,
            Resolution::Minute15 => 15 * 60,
            Resolution::Minute30 => 30 * 60,
            Resolution::Minute60 => 60 * 60,
            Resolution::Day => 24 * 60 * 60,
            Resolution::Week => 7 * 24 * 60 * 60,
            Resolution::Month => unreachable!(),
        };
        return open_seconds
            .checked_add(interval_seconds)
            .ok_or_else(|| AppError::new("invalid_market_data", "OKX K 线时间溢出"));
    }
    let open = chrono::DateTime::<Utc>::from_timestamp_millis(open_time_ms)
        .ok_or_else(|| AppError::new("invalid_market_data", "OKX 月线时间越界"))?;
    let (year, month) = if open.month() == 12 {
        (open.year() + 1, 1)
    } else {
        (open.year(), open.month() + 1)
    };
    Utc.with_ymd_and_hms(year, month, 1, 0, 0, 0)
        .single()
        .map(|time| time.timestamp())
        .ok_or_else(|| AppError::new("invalid_market_data", "OKX 月线结束时间无效"))
}

fn trade_bar_close_time(trade_time_ms: i64, resolution: Resolution) -> Option<i64> {
    if resolution != Resolution::Month {
        let interval_ms = match resolution {
            Resolution::Minute1 => 60_000,
            Resolution::Minute5 => 5 * 60_000,
            Resolution::Minute15 => 15 * 60_000,
            Resolution::Minute30 => 30 * 60_000,
            Resolution::Minute60 => 60 * 60_000,
            Resolution::Day => 24 * 60 * 60_000,
            Resolution::Week => 7 * 24 * 60 * 60_000,
            Resolution::Month => unreachable!(),
        };
        // Unix epoch was a Thursday. Offset the weekly bucket so OKX 1Wutc
        // rolls at Monday 00:00 UTC, like the official candle channel.
        let origin_ms = if resolution == Resolution::Week {
            -3 * 24 * 60 * 60_000
        } else {
            0
        };
        return trade_time_ms
            .checked_sub(origin_ms)?
            .div_euclid(interval_ms)
            .checked_add(1)?
            .checked_mul(interval_ms)?
            .checked_add(origin_ms)?
            .checked_div(1_000);
    }
    let trade = chrono::DateTime::<Utc>::from_timestamp_millis(trade_time_ms)?;
    let (year, month) = if trade.month() == 12 {
        (trade.year() + 1, 1)
    } else {
        (trade.year(), trade.month() + 1)
    };
    Utc.with_ymd_and_hms(year, month, 1, 0, 0, 0)
        .single()
        .map(|time| time.timestamp())
}

fn interval_for(resolution: Resolution) -> &'static str {
    match resolution {
        Resolution::Minute1 => "1m",
        Resolution::Minute5 => "5m",
        Resolution::Minute15 => "15m",
        Resolution::Minute30 => "30m",
        Resolution::Minute60 => "1H",
        Resolution::Day => "1Dutc",
        Resolution::Week => "1Wutc",
        Resolution::Month => "1Mutc",
    }
}

fn replace_realtime_subscription(
    market: OkxMarket,
    request: RealtimeRequest,
    sink: Arc<dyn RealtimeSink>,
) -> Result<(), AppError> {
    emit_status(&request, &sink, "connecting", None);
    let contract = contract_spec(market, request.symbol.parts().1)?;
    let bar_state = Arc::new(Mutex::new(OkxRealtimeBarState::default()));
    let subscription = OkxSubscription {
        market,
        request: request.clone(),
        sink: Arc::clone(&sink),
        contract: contract.clone(),
        bar_state: Arc::clone(&bar_state),
        requested_at: Instant::now(),
    };
    realtime_manager()?.replace(
        subscription,
        OkxSubscription {
            market,
            request,
            sink,
            contract,
            bar_state,
            requested_at: Instant::now(),
        },
    )
}

#[derive(Default)]
struct OkxRealtimeBarState {
    current: Option<Bar>,
    closed: bool,
    last_trade_time_ms: i64,
    official_candle_time: Option<i64>,
}

impl OkxRealtimeBarState {
    fn observe_candle(&mut self, mut incoming: Bar, closed: bool) -> Bar {
        let same_bar = self
            .current
            .as_ref()
            .is_some_and(|current| current.time == incoming.time);
        if same_bar && self.last_trade_time_ms > 0 && !closed {
            let current = self
                .current
                .as_ref()
                .expect("same bar requires current state");
            incoming.high = incoming.high.max(current.high);
            incoming.low = incoming.low.min(current.low);
            incoming.close = current.close;
        } else if !same_bar {
            self.last_trade_time_ms = 0;
        }
        self.current = Some(incoming.clone());
        self.closed = closed;
        self.official_candle_time = Some(incoming.time);
        incoming
    }

    fn apply_trade(
        &mut self,
        resolution: Resolution,
        trade_time_ms: i64,
        price: f64,
        quantity: f64,
    ) -> Option<Bar> {
        if !price.is_finite()
            || price <= 0.0
            || !quantity.is_finite()
            || quantity <= 0.0
            || trade_time_ms < self.last_trade_time_ms
        {
            return None;
        }
        let target_time = trade_bar_close_time(trade_time_ms, resolution)?;
        match self.current.as_ref() {
            Some(current) if current.time > target_time => return None,
            Some(current) if current.time == target_time && self.closed => return None,
            Some(current) if current.time == target_time => {}
            _ => {
                self.current = Some(Bar::new(
                    target_time,
                    price,
                    price,
                    price,
                    price,
                    0.0,
                    Some(0.0),
                ));
                self.closed = false;
            }
        }
        let current = self.current.as_mut()?;
        current.high = current.high.max(price);
        current.low = current.low.min(price);
        current.close = price;
        if self.official_candle_time != Some(target_time) {
            current.volume += quantity;
            current.amount = Some(current.amount.unwrap_or(0.0) + price * quantity);
        }
        self.last_trade_time_ms = trade_time_ms;
        Some(current.clone())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WsKind {
    Public,
    Business,
}

impl WsKind {
    fn url(self) -> &'static str {
        match self {
            Self::Public => PUBLIC_WS_URL,
            Self::Business => BUSINESS_WS_URL,
        }
    }
}

#[derive(Clone)]
struct OkxSubscription {
    market: OkxMarket,
    request: RealtimeRequest,
    sink: Arc<dyn RealtimeSink>,
    contract: Option<Arc<ContractSpec>>,
    bar_state: Arc<Mutex<OkxRealtimeBarState>>,
    requested_at: Instant,
}

struct OkxRealtimeManager {
    public: Sender<OkxSubscription>,
    business: Sender<OkxSubscription>,
}

impl OkxRealtimeManager {
    fn new() -> Self {
        let (public, public_rx) = mpsc::channel();
        let (business, business_rx) = mpsc::channel();
        thread::spawn(move || run_persistent_worker(WsKind::Public, public_rx));
        thread::spawn(move || run_persistent_worker(WsKind::Business, business_rx));
        Self { public, business }
    }

    fn replace(&self, public: OkxSubscription, business: OkxSubscription) -> Result<(), AppError> {
        self.public
            .send(public)
            .map_err(|_| AppError::new("realtime_state_unavailable", "OKX 公共行情会话不可用"))?;
        self.business
            .send(business)
            .map_err(|_| AppError::new("realtime_state_unavailable", "OKX 业务行情会话不可用"))
    }
}

fn realtime_manager() -> Result<&'static OkxRealtimeManager, AppError> {
    static MANAGER: OnceLock<OkxRealtimeManager> = OnceLock::new();
    Ok(MANAGER.get_or_init(OkxRealtimeManager::new))
}

fn run_persistent_worker(kind: WsKind, receiver: Receiver<OkxSubscription>) {
    let mut socket = None;
    let mut current: Option<OkxSubscription> = None;
    let mut connected = false;
    let mut last_activity = Instant::now();
    let mut sequence = SequenceClock::default();
    loop {
        let mut replacement = match receiver.try_recv() {
            Ok(value) => Some(value),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => return,
        };
        while let Ok(value) = receiver.try_recv() {
            replacement = Some(value);
        }
        if let Some(next) = replacement {
            let mut reused = socket.is_some();
            let unsubscribe_failed = match (socket.as_mut(), current.as_ref()) {
                (Some(open_socket), Some(previous)) => {
                    send_subscription(open_socket, kind, previous, "unsubscribe").is_err()
                }
                _ => false,
            };
            if unsubscribe_failed {
                socket = None;
                reused = false;
            }
            current = Some(next);
            connected = false;
            sequence = SequenceClock::default();
            if socket.is_none() {
                match connect_socket(kind.url()) {
                    Ok(value) => socket = Some(value),
                    Err(error) => {
                        if let Some(active) =
                            current.as_ref().filter(|value| value.request.is_active())
                        {
                            emit_reconnecting(&active.request, &active.sink, error.message);
                        }
                        wait_for_replacement(&receiver, &mut current, Duration::from_secs(1));
                        continue;
                    }
                }
            }
            let active = current
                .as_ref()
                .expect("replacement sets current subscription");
            if let Err(error) = send_subscription(
                socket.as_mut().expect("socket connected before subscribe"),
                kind,
                active,
                "subscribe",
            ) {
                emit_reconnecting(&active.request, &active.sink, error.message);
                socket = None;
                continue;
            }
            eprintln!(
                "market.realtime.subscription_switch provider={} symbol={} resolution={} socket={kind:?} connection_reused={} switch_ms={:.1}",
                active.request.provider_id,
                active.request.symbol.as_str(),
                active.request.resolution.as_str(),
                reused,
                active.requested_at.elapsed().as_secs_f64() * 1000.0
            );
        }

        if current
            .as_ref()
            .is_some_and(|value| !value.request.is_active())
        {
            if let (Some(socket), Some(previous)) = (socket.as_mut(), current.as_ref()) {
                let _ = send_subscription(socket, kind, previous, "unsubscribe");
            }
            current = None;
            connected = false;
        }

        if socket.is_none() {
            if current.is_none() {
                match receiver.recv() {
                    Ok(value) => current = Some(value),
                    Err(_) => return,
                }
            }
            if current
                .as_ref()
                .is_some_and(|value| value.request.is_active())
            {
                match connect_socket(kind.url()) {
                    Ok(mut value) => {
                        let active = current.as_ref().expect("current checked above");
                        if let Err(error) = send_subscription(&mut value, kind, active, "subscribe")
                        {
                            emit_reconnecting(&active.request, &active.sink, error.message);
                            wait_for_replacement(&receiver, &mut current, Duration::from_secs(1));
                            continue;
                        }
                        eprintln!(
                            "market.realtime.subscription_switch provider={} symbol={} resolution={} socket={kind:?} connection_reused=false switch_ms={:.1}",
                            active.request.provider_id,
                            active.request.symbol.as_str(),
                            active.request.resolution.as_str(),
                            active.requested_at.elapsed().as_secs_f64() * 1000.0
                        );
                        socket = Some(value);
                        last_activity = Instant::now();
                    }
                    Err(error) => {
                        let active = current.as_ref().expect("current checked above");
                        emit_reconnecting(&active.request, &active.sink, error.message);
                        wait_for_replacement(&receiver, &mut current, Duration::from_secs(1));
                        continue;
                    }
                }
            } else {
                current = None;
                continue;
            }
        }

        let read_result = socket.as_mut().expect("socket ensured above").read();
        match read_result {
            Ok(Message::Text(text)) => {
                last_activity = Instant::now();
                if text.as_str() == "pong" {
                    continue;
                }
                let payload: Value = match serde_json::from_str(text.as_str()) {
                    Ok(value) => value,
                    Err(error) => {
                        if let Some(active) =
                            current.as_ref().filter(|value| value.request.is_active())
                        {
                            emit_reconnecting(
                                &active.request,
                                &active.sink,
                                format!("OKX WebSocket JSON 无效：{error}"),
                            );
                        }
                        socket = None;
                        continue;
                    }
                };
                let Some(active) = current.as_ref() else {
                    continue;
                };
                if !payload_matches_subscription(&payload, kind, active) {
                    continue;
                }
                let control_event = payload.get("event").and_then(Value::as_str);
                if control_event == Some("error") {
                    let error = AppError::new(
                        "market_data_source_unavailable",
                        format!(
                            "OKX WebSocket {}: {}",
                            payload
                                .get("code")
                                .and_then(Value::as_str)
                                .unwrap_or("unknown"),
                            payload
                                .get("msg")
                                .and_then(Value::as_str)
                                .unwrap_or("订阅失败")
                        ),
                    );
                    emit_reconnecting(&active.request, &active.sink, error.message);
                    socket = None;
                    continue;
                }
                if control_event == Some("subscribe") {
                    if !connected {
                        connected = true;
                        emit_status(&active.request, &active.sink, "connected", None);
                    }
                    continue;
                }
                if is_control_payload(&payload) {
                    continue;
                }
                if let Err(error) = emit_ws_payload(
                    active.market,
                    &active.request,
                    &active.sink,
                    kind,
                    active.contract.as_deref(),
                    &mut sequence,
                    &active.bar_state,
                    &payload,
                ) {
                    emit_reconnecting(&active.request, &active.sink, error.message);
                    socket = None;
                }
            }
            Ok(Message::Ping(payload)) => {
                socket
                    .as_mut()
                    .expect("socket exists")
                    .send(Message::Pong(payload))
                    .ok();
            }
            Ok(Message::Close(frame)) => {
                let reason = frame
                    .map(|frame| frame.reason.to_string())
                    .filter(|reason| !reason.is_empty())
                    .unwrap_or_else(|| "服务器关闭连接".to_string());
                if let Some(active) = current.as_ref().filter(|value| value.request.is_active()) {
                    emit_reconnecting(&active.request, &active.sink, reason);
                }
                socket = None;
            }
            Ok(Message::Binary(_)) => {
                socket = None;
            }
            Ok(Message::Pong(_) | Message::Frame(_)) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                ) =>
            {
                if last_activity.elapsed() >= PING_INTERVAL {
                    if socket
                        .as_mut()
                        .expect("socket exists")
                        .send(Message::Text("ping".into()))
                        .is_err()
                    {
                        socket = None;
                    }
                    last_activity = Instant::now();
                }
            }
            Err(error) => {
                if let Some(active) = current.as_ref().filter(|value| value.request.is_active()) {
                    emit_reconnecting(
                        &active.request,
                        &active.sink,
                        ws_error("读取失败", error).message,
                    );
                }
                socket = None;
            }
        }
    }
}

fn wait_for_replacement(
    receiver: &Receiver<OkxSubscription>,
    current: &mut Option<OkxSubscription>,
    duration: Duration,
) {
    if let Ok(value) = receiver.recv_timeout(duration) {
        *current = Some(value);
    }
}

fn subscription_args(kind: WsKind, subscription: &OkxSubscription) -> Vec<Value> {
    let code = subscription.request.symbol.parts().1;
    match kind {
        WsKind::Public => vec![json!({"channel": "books5", "instId": code})],
        WsKind::Business => vec![
            json!({"channel": format!("candle{}", interval_for(subscription.request.resolution)), "instId": code}),
            json!({"channel": "trades-all", "instId": code}),
        ],
    }
}

fn send_subscription(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    kind: WsKind,
    subscription: &OkxSubscription,
    operation: &str,
) -> Result<(), AppError> {
    socket
        .send(Message::Text(
            json!({
                "id": format!(
                    "{}{}{}",
                    subscription.request.request_id,
                    if kind == WsKind::Public { "P" } else { "B" },
                    if operation == "subscribe" { "S" } else { "U" },
                ),
                "op": operation,
                "args": subscription_args(kind, subscription),
            })
            .to_string()
            .into(),
        ))
        .map_err(|error| ws_error("订阅切换发送失败", error))
}

fn payload_matches_subscription(
    payload: &Value,
    kind: WsKind,
    subscription: &OkxSubscription,
) -> bool {
    let Some(argument) = payload.get("arg") else {
        return payload.get("event").and_then(Value::as_str) != Some("error");
    };
    let Some(instrument_id) = argument.get("instId").and_then(Value::as_str) else {
        return false;
    };
    let Some(channel) = argument.get("channel").and_then(Value::as_str) else {
        return false;
    };
    instrument_id == subscription.request.symbol.parts().1
        && subscription_args(kind, subscription)
            .iter()
            .any(|value| value.get("channel").and_then(Value::as_str) == Some(channel))
}

fn is_control_payload(payload: &Value) -> bool {
    payload.get("event").and_then(Value::as_str).is_some()
}

fn emit_ws_payload(
    market: OkxMarket,
    request: &RealtimeRequest,
    sink: &Arc<dyn RealtimeSink>,
    kind: WsKind,
    contract: Option<&ContractSpec>,
    sequence: &mut SequenceClock,
    bar_state: &Arc<Mutex<OkxRealtimeBarState>>,
    payload: &Value,
) -> Result<(), AppError> {
    let argument = payload
        .get("arg")
        .ok_or_else(|| AppError::new("invalid_market_data", "OKX 推送缺少 arg"))?;
    let channel = text(argument, "channel")?;
    let code = request.symbol.parts().1;
    if text(argument, "instId")? != code {
        return Err(AppError::new(
            "provider_contract_violation",
            "OKX 推送返回了其他品种",
        ));
    }
    let rows = payload
        .get("data")
        .and_then(Value::as_array)
        .filter(|rows| !rows.is_empty())
        .ok_or_else(|| AppError::new("invalid_market_data", "OKX 推送 data 为空"))?;

    match kind {
        WsKind::Business if channel.starts_with("candle") => {
            let expected = format!("candle{}", interval_for(request.resolution));
            if channel != expected {
                return Err(AppError::new(
                    "invalid_market_data",
                    "OKX 返回了意外 K 线频道",
                ));
            }
            for row in rows {
                let parsed = parse_candle(market, request.resolution, row)?;
                let closed = row
                    .as_array()
                    .and_then(|values| values.get(8))
                    .and_then(Value::as_str)
                    == Some("1");
                let bar = bar_state
                    .lock()
                    .map_err(|_| AppError::new("realtime_state_unavailable", "OKX K 线状态锁异常"))?
                    .observe_candle(parsed, closed);
                Bar::validate_series(std::slice::from_ref(&bar))?;
                let event_time_ms = now_millis();
                sink.emit(request.envelope(
                    Some(sequence.next(event_time_ms.max(0) as u64)),
                    RealtimePayload::Bar {
                        bar,
                        closed,
                        event_time_ms,
                        source: Cow::Borrowed(market.source()),
                    },
                ))?;
            }
        }
        WsKind::Business if channel == "trades-all" => {
            for row in rows {
                let price = number(row, "px")?;
                let quantity = market_quantity(market, number(row, "sz")?, price, contract)?;
                let trade_time_ms = integer(row, "ts")?;
                let trade_id = integer(row, "tradeId")?;
                let candidate = optional_integer(row, "seqId")?.unwrap_or(trade_time_ms);
                sink.emit(request.envelope(
                    Some(sequence.next(candidate.max(0) as u64)),
                    RealtimePayload::Trade {
                        trade_id,
                        trade_time_ms,
                        price,
                        quantity,
                        side: Some(Cow::Owned(text(row, "side")?.to_string())),
                        flags: None,
                    },
                ))?;
                let trade_bar = bar_state
                    .lock()
                    .map_err(|_| AppError::new("realtime_state_unavailable", "OKX K 线状态锁异常"))?
                    .apply_trade(request.resolution, trade_time_ms, price, quantity);
                if let Some(bar) = trade_bar {
                    Bar::validate_series(std::slice::from_ref(&bar))?;
                    sink.emit(request.envelope(
                        Some(sequence.next(candidate.max(0) as u64)),
                        RealtimePayload::Bar {
                            bar,
                            closed: false,
                            event_time_ms: trade_time_ms,
                            source: Cow::Borrowed("trade"),
                        },
                    ))?;
                }
            }
        }
        WsKind::Public if channel == "books5" => {
            let row = &rows[0];
            let event_time_ms = integer(row, "ts")?;
            let bids = price_levels(row, "bids", market, contract)?;
            let asks = price_levels(row, "asks", market, contract)?;
            validate_book(&bids, &asks)?;
            let candidate = optional_integer(row, "seqId")?.unwrap_or(event_time_ms);
            sink.emit(request.envelope(
                Some(sequence.next(candidate.max(0) as u64)),
                RealtimePayload::Depth {
                    event_time_ms,
                    bids,
                    asks,
                },
            ))?;
        }
        WsKind::Public => {
            return Err(AppError::new(
                "invalid_market_data",
                format!("OKX 返回了意外公共频道 {channel}"),
            ));
        }
        WsKind::Business => {
            return Err(AppError::new(
                "invalid_market_data",
                format!("OKX 返回了意外业务频道 {channel}"),
            ));
        }
    }
    Ok(())
}

fn price_levels(
    payload: &Value,
    field: &str,
    market: OkxMarket,
    contract: Option<&ContractSpec>,
) -> Result<Vec<RealtimePriceLevel>, AppError> {
    payload
        .get(field)
        .and_then(Value::as_array)
        .filter(|rows| !rows.is_empty() && rows.len() <= 5)
        .ok_or_else(|| AppError::new("invalid_market_data", format!("OKX {field} 盘口无效")))?
        .iter()
        .map(|row| {
            let row = row
                .as_array()
                .filter(|row| row.len() >= 2)
                .ok_or_else(|| AppError::new("invalid_market_data", "OKX 盘口档位无效"))?;
            let price = json_number(&row[0], "depth price")?;
            let quantity =
                market_quantity(market, json_number(&row[1], "depth size")?, price, contract)?;
            if price <= 0.0 || quantity <= 0.0 {
                return Err(AppError::new(
                    "invalid_market_data",
                    "OKX 盘口价格或数量无效",
                ));
            }
            Ok(RealtimePriceLevel { price, quantity })
        })
        .collect()
}

fn validate_book(bids: &[RealtimePriceLevel], asks: &[RealtimePriceLevel]) -> Result<(), AppError> {
    if !bids.windows(2).all(|rows| rows[0].price > rows[1].price)
        || !asks.windows(2).all(|rows| rows[0].price < rows[1].price)
        || bids[0].price >= asks[0].price
    {
        return Err(AppError::new("invalid_market_data", "OKX 盘口顺序无效"));
    }
    Ok(())
}

#[derive(Clone, Debug)]
struct ContractSpec {
    contract_value: f64,
    multiplier: f64,
    value_currency: String,
    base_currency: String,
    quote_currency: String,
}

fn fetch_contract_spec(instrument_id: &str) -> Result<ContractSpec, AppError> {
    let rows = client()?.get_data(
        "/api/v5/public/instruments",
        &[
            ("instType", "SWAP".to_string()),
            ("instId", instrument_id.to_string()),
        ],
    )?;
    let row = rows
        .first()
        .ok_or_else(|| AppError::new("invalid_market_data", "OKX SWAP 合约规格为空"))?;
    let (base, quote) = text(row, "instFamily")?
        .split_once('-')
        .ok_or_else(|| AppError::new("invalid_market_data", "OKX SWAP 产品族无效"))?;
    Ok(ContractSpec {
        contract_value: number(row, "ctVal")?,
        multiplier: number(row, "ctMult")?,
        value_currency: text(row, "ctValCcy")?.to_string(),
        base_currency: base.to_string(),
        quote_currency: quote.to_string(),
    })
}

fn contract_spec(
    market: OkxMarket,
    instrument_id: &str,
) -> Result<Option<Arc<ContractSpec>>, AppError> {
    if market == OkxMarket::Spot {
        return Ok(None);
    }
    static CACHE: OnceLock<Mutex<BTreeMap<String, Arc<ContractSpec>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(BTreeMap::new()));
    if let Some(value) = cache
        .lock()
        .map_err(|_| AppError::new("realtime_state_unavailable", "OKX 合约规格缓存锁异常"))?
        .get(instrument_id)
        .cloned()
    {
        return Ok(Some(value));
    }
    let value = Arc::new(fetch_contract_spec(instrument_id)?);
    cache
        .lock()
        .map_err(|_| AppError::new("realtime_state_unavailable", "OKX 合约规格缓存锁异常"))?
        .insert(instrument_id.to_string(), Arc::clone(&value));
    Ok(Some(value))
}

fn market_quantity(
    market: OkxMarket,
    size: f64,
    price: f64,
    contract: Option<&ContractSpec>,
) -> Result<f64, AppError> {
    if market == OkxMarket::Spot {
        return Ok(size);
    }
    let contract =
        contract.ok_or_else(|| AppError::new("invalid_market_data", "OKX SWAP 缺少合约规格"))?;
    let notional = size * contract.contract_value * contract.multiplier;
    let quantity = if contract.value_currency == contract.base_currency {
        notional
    } else if contract.value_currency == contract.quote_currency {
        notional / price
    } else {
        return Err(AppError::new(
            "invalid_market_data",
            "OKX SWAP 合约价值币种无法映射",
        ));
    };
    if !quantity.is_finite() || quantity <= 0.0 {
        return Err(AppError::new(
            "invalid_market_data",
            "OKX SWAP 数量换算无效",
        ));
    }
    Ok(quantity)
}

#[derive(Default)]
struct SequenceClock(u64);

impl SequenceClock {
    fn next(&mut self, candidate: u64) -> u64 {
        self.0 = candidate.max(self.0.saturating_add(1));
        self.0
    }
}

fn connect_socket(url: &str) -> Result<WebSocket<MaybeTlsStream<TcpStream>>, AppError> {
    let request = url
        .into_client_request()
        .map_err(|error| AppError::new("market_data_source_unavailable", error.to_string()))?;
    let uri = request.uri();
    let mode = uri_mode(uri)
        .map_err(|error| AppError::new("market_data_source_unavailable", error.to_string()))?;
    let host = uri
        .host()
        .ok_or_else(|| AppError::new("market_data_source_unavailable", "OKX WS 缺少主机"))?;
    let port = uri.port_u16().unwrap_or(match mode {
        Mode::Plain => 80,
        Mode::Tls => 443,
    });
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| AppError::new("market_data_source_unavailable", error.to_string()))?;
    let mut last_error = None;
    for address in addresses.take(8) {
        match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
            Ok(stream) => {
                stream.set_nodelay(true).ok();
                stream.set_read_timeout(Some(CONNECT_TIMEOUT)).ok();
                stream.set_write_timeout(Some(CONNECT_TIMEOUT)).ok();
                let (mut socket, response) =
                    client_tls_with_config(request.clone(), stream, None, None).map_err(
                        |error| {
                            AppError::new(
                                "market_data_source_unavailable",
                                format!("OKX WebSocket 握手失败：{error}"),
                            )
                        },
                    )?;
                if response.status().as_u16() != 101 {
                    return Err(AppError::new(
                        "market_data_source_unavailable",
                        format!("OKX WebSocket 握手返回 HTTP {}", response.status().as_u16()),
                    ));
                }
                configure_socket_timeout(&mut socket)?;
                return Ok(socket);
            }
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    Err(AppError::new(
        "market_data_source_unavailable",
        format!(
            "OKX WebSocket TCP 连接失败：{}",
            last_error.unwrap_or_else(|| "没有可用地址".to_string())
        ),
    ))
}

fn configure_socket_timeout(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
) -> Result<(), AppError> {
    let stream = match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream,
        MaybeTlsStream::Rustls(stream) => &stream.sock,
        _ => {
            return Err(AppError::new(
                "market_data_source_unavailable",
                "OKX WebSocket TLS transport 不受支持",
            ));
        }
    };
    stream
        .set_read_timeout(Some(IO_TIMEOUT))
        .and_then(|_| stream.set_write_timeout(Some(IO_TIMEOUT)))
        .map_err(|error| AppError::new("market_data_source_unavailable", error.to_string()))
}

fn emit_status(
    request: &RealtimeRequest,
    sink: &Arc<dyn RealtimeSink>,
    status: &'static str,
    message: Option<String>,
) {
    let _ = sink.emit(request.envelope(None, RealtimePayload::Status { status, message }));
}

fn emit_reconnecting(request: &RealtimeRequest, sink: &Arc<dyn RealtimeSink>, message: String) {
    eprintln!(
        "market.realtime.reconnecting request_id={} provider={} symbol={} resolution={} error={message}",
        request.request_id,
        request.provider_id,
        request.symbol.as_str(),
        request.resolution.as_str()
    );
    emit_status(request, sink, "reconnecting", Some(message));
}

fn ws_error(context: &str, error: tungstenite::Error) -> AppError {
    AppError::new(
        "market_data_source_unavailable",
        format!("OKX WebSocket {context}：{error}"),
    )
}

fn descriptor(market: OkxMarket) -> &'static ProviderDescriptor {
    match market {
        OkxMarket::Spot => &OKX_SPOT_PROVIDER_DESCRIPTOR,
        OkxMarket::Swap => &OKX_SWAP_PROVIDER_DESCRIPTOR,
    }
}

fn valid_asset(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

fn text<'a>(payload: &'a Value, field: &str) -> Result<&'a str, AppError> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::new("invalid_market_data", format!("OKX 缺少 {field}")))
}

fn number(payload: &Value, field: &str) -> Result<f64, AppError> {
    text(payload, field)?
        .parse::<f64>()
        .map_err(|_| AppError::new("invalid_market_data", format!("OKX {field} 不是数字")))
}

fn integer(payload: &Value, field: &str) -> Result<i64, AppError> {
    text(payload, field)?
        .parse::<i64>()
        .map_err(|_| AppError::new("invalid_market_data", format!("OKX {field} 不是整数")))
}

fn optional_integer(payload: &Value, field: &str) -> Result<Option<i64>, AppError> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .map(|value| {
            value
                .parse::<i64>()
                .map_err(|_| AppError::new("invalid_market_data", format!("OKX {field} 不是整数")))
        })
        .transpose()
}

fn json_number(value: &Value, field: &str) -> Result<f64, AppError> {
    value
        .as_str()
        .and_then(|value| value.parse::<f64>().ok())
        .ok_or_else(|| AppError::new("invalid_market_data", format!("OKX {field} 不是数字")))
}

fn json_i64(value: &Value, field: &str) -> Result<i64, AppError> {
    value
        .as_str()
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(|| AppError::new("invalid_market_data", format!("OKX {field} 不是整数")))
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

struct OkxClient {
    http: reqwest::blocking::Client,
}

impl OkxClient {
    fn new() -> Result<Self, AppError> {
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("TradeFlow-Lite/0.1")
            .build()
            .map_err(|error| AppError::new("market_data_source_unavailable", error.to_string()))?;
        Ok(Self { http })
    }

    fn get_data(&self, path: &str, query: &[(&str, String)]) -> Result<Vec<Value>, AppError> {
        let query = query
            .iter()
            .map(|(key, value)| (*key, value.as_str()))
            .collect::<Vec<_>>();
        let response = self
            .http
            .get(format!("{REST_ORIGIN}{path}"))
            .query(&query)
            .send()
            .map_err(|error| AppError::new("market_data_source_unavailable", error.to_string()))?;
        let status = response.status();
        let mut body = String::new();
        response
            .take(MAX_RESPONSE_BYTES + 1)
            .read_to_string(&mut body)
            .map_err(|error| AppError::new("market_data_source_unavailable", error.to_string()))?;
        if body.len() as u64 > MAX_RESPONSE_BYTES {
            return Err(AppError::new(
                "invalid_market_data",
                "OKX 响应超过 8 MiB 安全上限",
            ));
        }
        if !status.is_success() {
            let code = if status.as_u16() == 429 {
                "market_data_rate_limited"
            } else {
                "market_data_source_unavailable"
            };
            return Err(AppError::new(code, format!("OKX HTTP {}", status.as_u16())));
        }
        let payload: Value = serde_json::from_str(&body)
            .map_err(|error| AppError::new("invalid_market_data", error.to_string()))?;
        if payload.get("code").and_then(Value::as_str) != Some("0") {
            let remote_code = payload
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let code = if remote_code == "50011" {
                "market_data_rate_limited"
            } else if remote_code == "51001" {
                "invalid_symbol"
            } else {
                "market_data_source_unavailable"
            };
            return Err(AppError::new(
                code,
                format!(
                    "OKX {remote_code}: {}",
                    payload
                        .get("msg")
                        .and_then(Value::as_str)
                        .unwrap_or("请求失败")
                ),
            ));
        }
        payload
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(|| AppError::new("invalid_market_data", "OKX 响应缺少 data"))
    }
}

fn client() -> Result<&'static OkxClient, AppError> {
    static CLIENT: OnceLock<Result<OkxClient, AppError>> = OnceLock::new();
    CLIENT
        .get_or_init(OkxClient::new)
        .as_ref()
        .map_err(Clone::clone)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};

    use serde_json::json;

    use super::{
        ContractSpec, OkxMarket, OkxRealtimeBarState, candle_close_time, interval_for,
        is_control_payload, market_quantity, parse_candle,
    };
    use crate::contracts::{Adjustment, AppError, Bar, Resolution, Symbol, SymbolKind};
    use crate::market_adapter::{
        CatalogRequest, HistoryRequest, QuoteRequest, RealtimeEventEnvelope, RealtimePayload,
        RealtimeRequest, RealtimeSink,
    };
    use crate::market_router::MarketRouter;

    #[test]
    fn maps_every_lite_resolution_to_okx_utc_candles() {
        assert_eq!(interval_for(Resolution::Minute1), "1m");
        assert_eq!(interval_for(Resolution::Minute5), "5m");
        assert_eq!(interval_for(Resolution::Minute15), "15m");
        assert_eq!(interval_for(Resolution::Minute30), "30m");
        assert_eq!(interval_for(Resolution::Minute60), "1H");
        assert_eq!(interval_for(Resolution::Day), "1Dutc");
        assert_eq!(interval_for(Resolution::Week), "1Wutc");
        assert_eq!(interval_for(Resolution::Month), "1Mutc");
    }

    #[test]
    fn unsubscribe_ack_is_control_not_empty_market_data() {
        assert!(is_control_payload(&json!({
            "event": "unsubscribe",
            "arg": {"channel": "trades-all", "instId": "BTC-USDT"}
        })));
        assert!(!is_control_payload(&json!({
            "arg": {"channel": "trades-all", "instId": "BTC-USDT"},
            "data": [{"px": "1"}]
        })));
    }

    #[test]
    fn candle_mapping_uses_base_volume_and_next_boundary_time() {
        let row = json!([
            "1789467900000",
            "77038.8",
            "77041",
            "77017.2",
            "77020",
            "125",
            "1.25",
            "96275",
            "0"
        ]);
        let spot = parse_candle(OkxMarket::Spot, Resolution::Minute1, &row).unwrap();
        let swap = parse_candle(OkxMarket::Swap, Resolution::Minute1, &row).unwrap();
        assert_eq!(spot.time, 1_789_467_960);
        assert_eq!(spot.volume, 125.0);
        assert_eq!(swap.volume, 1.25);
        assert_eq!(swap.amount, Some(96_275.0));
        Bar::validate_series(&[spot]).unwrap();
        Bar::validate_series(&[swap]).unwrap();
        assert_eq!(
            candle_close_time(1_767_225_600_000, Resolution::Month).unwrap(),
            1_769_904_000
        );
    }

    #[test]
    fn swap_contract_sizes_convert_to_base_currency() {
        let linear = ContractSpec {
            contract_value: 0.01,
            multiplier: 1.0,
            value_currency: "BTC".to_string(),
            base_currency: "BTC".to_string(),
            quote_currency: "USDT".to_string(),
        };
        let inverse = ContractSpec {
            contract_value: 100.0,
            multiplier: 1.0,
            value_currency: "USD".to_string(),
            base_currency: "BTC".to_string(),
            quote_currency: "USD".to_string(),
        };
        assert_eq!(
            market_quantity(OkxMarket::Swap, 2.0, 80_000.0, Some(&linear)).unwrap(),
            0.02
        );
        assert_eq!(
            market_quantity(OkxMarket::Swap, 2.0, 80_000.0, Some(&inverse)).unwrap(),
            0.0025
        );
    }

    #[test]
    fn aggregate_trades_update_price_without_double_counting_candle_volume() {
        let candle = Bar {
            time: 120,
            open: 100.0,
            high: 102.0,
            low: 99.0,
            close: 101.0,
            volume: 12.0,
            amount: Some(1_205.0),
        };
        let mut state = OkxRealtimeBarState::default();
        state.observe_candle(candle, false);

        let updated = state
            .apply_trade(Resolution::Minute1, 90_000, 103.0, 0.25)
            .unwrap();
        assert_eq!(updated.high, 103.0);
        assert_eq!(updated.low, 99.0);
        assert_eq!(updated.close, 103.0);
        assert_eq!(updated.volume, 12.0);
        assert_eq!(updated.amount, Some(1_205.0));

        let next = state
            .apply_trade(Resolution::Minute1, 120_000, 104.0, 0.5)
            .unwrap();
        assert_eq!(next.time, 180);
        assert_eq!(
            (next.open, next.high, next.low, next.close),
            (104.0, 104.0, 104.0, 104.0)
        );
        assert_eq!(next.volume, 0.5);
        assert_eq!(next.amount, Some(52.0));
        assert!(
            state
                .apply_trade(Resolution::Minute1, 89_000, 98.0, 0.1)
                .is_none()
        );
    }

    #[test]
    fn trade_starts_current_bar_before_first_candle_arrives() {
        let mut state = OkxRealtimeBarState::default();
        let bar = state
            .apply_trade(Resolution::Minute1, 90_000, 101.5, 0.25)
            .unwrap();
        assert_eq!(bar.time, 120);
        assert_eq!(
            (bar.open, bar.high, bar.low, bar.close),
            (101.5, 101.5, 101.5, 101.5)
        );
        assert_eq!(bar.volume, 0.25);
        assert_eq!(bar.amount, Some(25.375));
    }

    #[test]
    fn trade_rolls_forward_after_official_candle_closes() {
        let mut state = OkxRealtimeBarState::default();
        state.observe_candle(
            Bar {
                time: 120,
                open: 100.0,
                high: 102.0,
                low: 99.0,
                close: 101.0,
                volume: 12.0,
                amount: Some(1_205.0),
            },
            true,
        );
        let bar = state
            .apply_trade(Resolution::Minute1, 120_250, 103.0, 0.5)
            .unwrap();
        assert_eq!(bar.time, 180);
        assert_eq!(bar.close, 103.0);
        assert_eq!(bar.volume, 0.5);
    }

    #[test]
    fn official_candle_keeps_a_newer_trade_price_until_the_feed_catches_up() {
        let mut state = OkxRealtimeBarState::default();
        state.observe_candle(
            Bar {
                time: 120,
                open: 100.0,
                high: 102.0,
                low: 99.0,
                close: 101.0,
                volume: 12.0,
                amount: Some(1_205.0),
            },
            false,
        );
        state
            .apply_trade(Resolution::Minute1, 90_000, 103.0, 0.25)
            .unwrap();
        let merged = state.observe_candle(
            Bar {
                time: 120,
                open: 100.0,
                high: 102.5,
                low: 98.5,
                close: 102.0,
                volume: 13.0,
                amount: Some(1_307.0),
            },
            false,
        );
        assert_eq!(merged.high, 103.0);
        assert_eq!(merged.low, 98.5);
        assert_eq!(merged.close, 103.0);
        assert_eq!(merged.volume, 13.0);
    }

    #[test]
    #[ignore = "connects to OKX official public REST APIs through MarketRouter"]
    fn okx_real_market() {
        let router = MarketRouter::builtin().unwrap();
        for (provider_id, venue, code) in [
            ("okx_spot", "OKX", "BTC-USDT"),
            ("okx_swap", "OKX_SWAP", "BTC-USDT-SWAP"),
        ] {
            let catalog = router
                .list_catalog(CatalogRequest {
                    provider_id: provider_id.to_string(),
                    venue: venue.to_string(),
                })
                .unwrap();
            assert!(
                catalog
                    .iter()
                    .any(|item| item.symbol == format!("{venue}:{code}"))
            );
            let symbol = Symbol::new(venue, code).unwrap();
            let history = router
                .fetch_history(HistoryRequest {
                    provider_id: provider_id.to_string(),
                    symbol: symbol.clone(),
                    kind: SymbolKind::Crypto,
                    resolution: Resolution::Minute1,
                    adjustment: Adjustment::None,
                    count: 300,
                    include_quote: true,
                })
                .unwrap();
            assert_eq!(history.bars.len(), 300);
            assert!(
                history
                    .bars
                    .windows(2)
                    .all(|rows| rows[0].time < rows[1].time)
            );
            assert!(history.quote.is_some());
            let quote = router
                .fetch_quote(QuoteRequest {
                    provider_id: provider_id.to_string(),
                    symbol,
                    kind: SymbolKind::Crypto,
                })
                .unwrap();
            assert!(quote.quote.is_valid());
            println!(
                "okx.real provider={provider_id} catalog={} bars={} last={}",
                catalog.len(),
                history.bars.len(),
                quote.quote.last
            );
        }
    }

    #[derive(Default)]
    struct ProbeSink {
        events: Mutex<Vec<RealtimeEventEnvelope>>,
        changed: Condvar,
    }

    impl ProbeSink {
        fn complete(events: &[RealtimeEventEnvelope]) -> bool {
            let mut trade_bars = 0;
            let mut trades = 0;
            let mut depth = false;
            for event in events {
                match event.payload {
                    RealtimePayload::Bar { ref source, .. } if source == "trade" => {
                        trade_bars += 1;
                    }
                    RealtimePayload::Trade { .. } => trades += 1,
                    RealtimePayload::Depth { .. } => depth = true,
                    _ => {}
                }
            }
            trade_bars >= 5 && trades >= 5 && depth
        }

        fn wait(&self, timeout: Duration) -> bool {
            let deadline = Instant::now() + timeout;
            let mut events = self.events.lock().unwrap();
            while !Self::complete(&events) {
                let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                    return false;
                };
                let result = self.changed.wait_timeout(events, remaining).unwrap();
                events = result.0;
                if result.1.timed_out() {
                    break;
                }
            }
            Self::complete(&events)
        }

        fn snapshot(&self) -> Vec<RealtimeEventEnvelope> {
            self.events.lock().unwrap().clone()
        }
    }

    impl RealtimeSink for ProbeSink {
        fn emit(&self, event: RealtimeEventEnvelope) -> Result<(), AppError> {
            self.events.lock().unwrap().push(event);
            self.changed.notify_all();
            Ok(())
        }
    }

    fn run_realtime_case(
        router: &MarketRouter,
        request_id: u64,
        provider_id: &'static str,
        symbol: Symbol,
        resolution: Resolution,
    ) {
        let active = Arc::new(AtomicU64::new(request_id));
        let sink = Arc::new(ProbeSink::default());
        router
            .start_realtime(
                RealtimeRequest {
                    request_id,
                    provider_id,
                    symbol: symbol.clone(),
                    kind: SymbolKind::Crypto,
                    resolution,
                    active_request_id: Arc::clone(&active),
                },
                sink.clone(),
            )
            .unwrap();
        assert!(
            sink.wait(Duration::from_secs(25)),
            "events={:?}",
            sink.snapshot()
        );
        let events = sink.snapshot();
        for event in &events {
            assert_eq!(event.request_id, request_id);
            assert_eq!(event.provider_id, provider_id);
            assert_eq!(event.symbol, symbol);
        }
        active.store(request_id + 1, Ordering::Release);
        let deadline = Instant::now() + Duration::from_secs(4);
        while Arc::strong_count(&sink) > 1 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(
            Arc::strong_count(&sink),
            1,
            "OKX realtime workers did not release after cancellation"
        );
        println!(
            "okx.real.realtime provider={provider_id} events={}",
            events.len()
        );
    }

    #[test]
    #[ignore = "connects to OKX official public WebSocket APIs through MarketRouter"]
    fn okx_real_realtime() {
        let router = MarketRouter::builtin().unwrap();
        run_realtime_case(
            &router,
            21_001,
            "okx_spot",
            Symbol::new("OKX", "BTC-USDT").unwrap(),
            Resolution::Minute1,
        );
        run_realtime_case(
            &router,
            21_002,
            "okx_spot",
            Symbol::new("OKX", "BTC-USDT").unwrap(),
            Resolution::Minute5,
        );
        run_realtime_case(
            &router,
            21_003,
            "okx_swap",
            Symbol::new("OKX_SWAP", "BTC-USDT-SWAP").unwrap(),
            Resolution::Minute1,
        );
    }
}
