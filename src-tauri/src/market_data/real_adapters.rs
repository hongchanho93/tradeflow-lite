//! 经由 `MarketRouter`/`AdapterRegistry` 的真实 provider 验收，以及不联网的恢复边界。
//!
//! 这些测试默认忽略，避免普通单元测试依赖 Binance/TDX 公共网络。它们与直接测试
//! provider transport 的测试分开，证据只说明请求确实穿过了适配器合同和统一路由。

use std::collections::{HashMap, VecDeque};
#[cfg(feature = "provider-binance")]
use std::sync::atomic::AtomicBool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::QuoteSnapshot;
use super::hosts::{self, DEFAULT_HOSTS};
use crate::contracts::{
    Adjustment, AppError, Bar, MarketSeriesKind, Resolution, Symbol, SymbolKind,
};
#[cfg(feature = "provider-binance")]
use crate::market_adapter::CatalogRequest;
use crate::market_adapter::{
    AdapterRegistration, HistoryDiagnostics, HistoryResponse, MarketDataAdapter,
    ProviderCapabilities, ProviderDescriptor, QuoteRequest, RealtimeAdapter, RealtimeEventEnvelope,
    RealtimePayload, RealtimeRequest, RealtimeSink,
};
use crate::market_router::{HistoryRequest, MarketRouter};
use crate::tdx::standard::{Market, SecurityQuotes};
use crate::tdx::{SecurityCode, Session};

const TDX_COUNT: usize = 40;
const TDX_QUOTE_COUNT: usize = 3;
#[cfg(feature = "provider-binance")]
const REALTIME_TIMEOUT: Duration = Duration::from_secs(25);

fn tdx_representative_cases() -> [(&'static str, &'static str, SymbolKind); 5] {
    [
        ("SH", "600000", SymbolKind::Stock),
        ("SZ", "000001", SymbolKind::Stock),
        ("BJ", "899050", SymbolKind::Index),
        ("SH", "510050", SymbolKind::Etf),
        ("SH", "000001", SymbolKind::Index),
    ]
}

fn assert_history_contract(
    response: &HistoryResponse,
    provider_id: &str,
    source: &str,
    symbol: &Symbol,
    expected_rows: usize,
    expected_host: Option<&str>,
) {
    assert_eq!(response.symbol, *symbol);
    assert_eq!(response.diagnostics.source, source);
    assert_eq!(
        response.bars.len(),
        expected_rows,
        "{provider_id}: incomplete history"
    );
    assert!(!response.diagnostics.host.is_empty());
    if let Some(expected_host) = expected_host {
        assert_eq!(response.diagnostics.host, expected_host);
    }
    assert!(
        expected_host.is_some() || DEFAULT_HOSTS.contains(&response.diagnostics.host.as_str()),
        "{provider_id}: response used a host outside the validated TDX pool: {}",
        response.diagnostics.host
    );
    assert!(
        response
            .bars
            .windows(2)
            .all(|bars| bars[0].time < bars[1].time),
        "{provider_id}: history must be strictly ascending"
    );
    Bar::validate_series(&response.bars).unwrap_or_else(|error| {
        panic!(
            "{provider_id}: invalid history returned by adapter: {}",
            error.message
        )
    });
}

fn matches_recent_close(
    value: f64,
    history: &HistoryResponse,
    relative_tolerance: f64,
    absolute_tolerance: f64,
) -> bool {
    history.bars.iter().rev().take(3).any(|bar| {
        let scale = value.abs().max(bar.close.abs());
        (value - bar.close).abs() <= scale * relative_tolerance + absolute_tolerance
    })
}

fn assert_quote_contract(
    response: &crate::market_adapter::QuoteResponse,
    symbol: &Symbol,
    kind: &SymbolKind,
    history: &HistoryResponse,
) {
    assert_eq!(response.provider_id, "tdx");
    assert_eq!(response.source, "tradeflow-tdx");
    assert_eq!(response.symbol, *symbol);
    assert!(
        response.quote.is_valid(),
        "{}: independent quote must be valid",
        symbol.as_str()
    );

    let quote = &response.quote;
    assert!(
        matches_recent_close(
            quote.previous_close,
            history,
            0.08,
            if *kind == SymbolKind::Etf {
                0.002
            } else {
                0.02
            },
        ),
        "{}: previous_close={} does not match recent history closes {:?}",
        symbol.as_str(),
        quote.previous_close,
        history
            .bars
            .iter()
            .rev()
            .take(3)
            .map(|bar| bar.close)
            .collect::<Vec<_>>()
    );
    assert!(
        matches_recent_close(
            quote.last,
            history,
            0.30,
            if *kind == SymbolKind::Etf {
                0.002
            } else {
                0.02
            },
        ),
        "{}: last={} is not reasonably consistent with recent history closes {:?}",
        symbol.as_str(),
        quote.last,
        history
            .bars
            .iter()
            .rev()
            .take(3)
            .map(|bar| bar.close)
            .collect::<Vec<_>>()
    );

    let no_book_session = quote.open == 0.0
        && quote.high == 0.0
        && quote.low == 0.0
        && quote.volume == 0.0
        && quote.amount == 0.0;
    if no_book_session {
        // TDX may expose only last/prev-close outside the continuous session. The
        // prices are still valid and the zero session fields are a legal no-book state.
        println!(
            "adapter.real.quote provider=tdx symbol={} state=valid_no_book last={:.6} previous_close={:.6}",
            symbol.as_str(),
            quote.last,
            quote.previous_close
        );
        return;
    }

    assert!(
        quote.open > 0.0,
        "{}: non-zero quote must have open",
        symbol.as_str()
    );
    assert!(
        quote.high > 0.0,
        "{}: non-zero quote must have high",
        symbol.as_str()
    );
    assert!(
        quote.low > 0.0,
        "{}: non-zero quote must have low",
        symbol.as_str()
    );
    assert!(
        quote.high >= quote.open.max(quote.last),
        "{}: quote high={} does not envelope open/last ({}, {})",
        symbol.as_str(),
        quote.high,
        quote.open,
        quote.last
    );
    assert!(
        quote.low <= quote.open.min(quote.last),
        "{}: quote low={} does not envelope open/last ({}, {})",
        symbol.as_str(),
        quote.low,
        quote.open,
        quote.last
    );
}

fn tdx_market(exchange: &str) -> Market {
    match exchange {
        "SH" => Market::Shanghai,
        "SZ" => Market::Shenzhen,
        "BJ" => Market::Beijing,
        _ => panic!("unsupported TDX exchange in real quote case: {exchange}"),
    }
}

struct RawQuoteProof {
    snapshot: QuoteSnapshot,
    identity: super::TdxQuoteIdentity,
}

fn read_raw_quote_on_host(
    host: &str,
    symbol: &Symbol,
    kind: &SymbolKind,
) -> Result<RawQuoteProof, String> {
    let (exchange, code) = symbol.parts();
    let market = tdx_market(exchange);
    let security_code = SecurityCode::new(code).map_err(|error| error.to_string())?;
    hosts::connect_and_run(host, |client| {
        let quotes = client
            .call(&SecurityQuotes {
                securities: vec![(market, security_code)],
            })
            .map_err(|error| error.to_string())?;
        let quote = quotes
            .into_iter()
            .next()
            .ok_or_else(|| "quote response was empty".to_string())?;
        let identity = super::validate_tdx_quote_identity(&quote, market, security_code)?;
        Ok(RawQuoteProof {
            snapshot: QuoteSnapshot::from_tdx(&quote, kind),
            identity,
        })
    })
}

fn is_legal_no_book_quote(
    quote: &QuoteSnapshot,
    history: &HistoryResponse,
    kind: &SymbolKind,
) -> bool {
    quote.last == 0.0
        && quote.previous_close > 0.0
        && quote.open == 0.0
        && quote.high == 0.0
        && quote.low == 0.0
        && quote.volume == 0.0
        && quote.amount == 0.0
        && matches_recent_close(
            quote.previous_close,
            history,
            0.08,
            if *kind == SymbolKind::Etf {
                0.002
            } else {
                0.02
            },
        )
}

#[test]
#[ignore = "connects to public TDX hosts through MarketRouter"]
fn real_adapter_tdx_history_matrix() {
    let router = MarketRouter::builtin().expect("built-in adapter registry must be valid");
    let resolutions = [
        Resolution::Minute1,
        Resolution::Minute5,
        Resolution::Minute15,
        Resolution::Minute30,
        Resolution::Minute60,
        Resolution::Minute120,
        Resolution::Minute240,
        Resolution::Day,
        Resolution::Week,
        Resolution::Month,
    ];

    for (exchange, code, kind) in tdx_representative_cases() {
        let symbol = Symbol::new(exchange, code).unwrap();
        for resolution in resolutions {
            let include_quote = resolution == Resolution::Day;
            let response = router
                .fetch_history(HistoryRequest {
                    provider_id: "tdx".to_string(),
                    symbol: symbol.clone(),
                    kind: kind.clone(),
                    resolution,
                    adjustment: Adjustment::None,
                    count: TDX_COUNT,
                    include_quote,
                })
                .unwrap_or_else(|error| {
                    panic!(
                        "adapter history failed provider=tdx symbol={} resolution={}: {}",
                        symbol.as_str(),
                        resolution.as_str(),
                        error.message
                    )
                });
            assert_history_contract(&response, "tdx", "tradeflow-tdx", &symbol, TDX_COUNT, None);
            if let Some(quote) = response.quote.as_ref() {
                assert!(
                    quote.is_valid(),
                    "attached TDX quote must be valid when present"
                );
            } else if include_quote {
                println!(
                    "adapter.real.history provider=tdx symbol={} resolution={} quote=unavailable bars_retained={} host={}",
                    symbol.as_str(),
                    resolution.as_str(),
                    response.bars.len(),
                    response.diagnostics.host
                );
            }
            println!(
                "adapter.real.history provider=tdx symbol={} resolution={} rows={} source={} host={}",
                symbol.as_str(),
                resolution.as_str(),
                response.bars.len(),
                response.diagnostics.source,
                response.diagnostics.host
            );
        }
    }
}

#[test]
#[ignore = "connects to public TDX hosts through MarketRouter"]
fn real_adapter_tdx_quote_matrix() {
    let router = MarketRouter::builtin().expect("built-in adapter registry must be valid");

    for (exchange, code, kind) in tdx_representative_cases() {
        let symbol = Symbol::new(exchange, code).unwrap();
        let history = router
            .fetch_history(HistoryRequest {
                provider_id: "tdx".to_string(),
                symbol: symbol.clone(),
                kind: kind.clone(),
                resolution: Resolution::Day,
                adjustment: Adjustment::None,
                count: TDX_QUOTE_COUNT,
                include_quote: false,
            })
            .unwrap_or_else(|error| {
                panic!(
                    "quote cross-check history failed symbol={} kind={}: {}",
                    symbol.as_str(),
                    kind.as_str(),
                    error.message
                )
            });
        assert_history_contract(
            &history,
            "tdx",
            "tradeflow-tdx",
            &symbol,
            TDX_QUOTE_COUNT,
            None,
        );

        match router.fetch_quote(QuoteRequest {
            provider_id: "tdx".to_string(),
            symbol: symbol.clone(),
            kind: kind.clone(),
        }) {
            Ok(response) => {
                let raw = read_raw_quote_on_host(&history.diagnostics.host, &symbol, &kind)
                    .unwrap_or_else(|error| {
                        panic!(
                            "{}: raw TDX quote identity proof failed after MarketRouter success: {}",
                            symbol.as_str(),
                            error
                        )
                    });
                assert_eq!(
                    raw.identity.market,
                    tdx_market(exchange).code(),
                    "{}: raw quote market identity must match the requested exchange",
                    symbol.as_str()
                );
                assert_eq!(
                    raw.identity.code.to_string(),
                    code,
                    "{}: raw quote code identity must match the requested code",
                    symbol.as_str()
                );
                assert_quote_contract(&response, &symbol, &kind, &history);
                println!(
                    "adapter.real.quote provider=tdx symbol={} kind={} state=valid last={:.6} previous_close={:.6} source={} host={}",
                    symbol.as_str(),
                    kind.as_str(),
                    response.quote.last,
                    response.quote.previous_close,
                    response.source,
                    history.diagnostics.host
                );
            }
            Err(error) => {
                assert_eq!(
                    error.code,
                    "market_data_unavailable",
                    "{}: independent quote failed with an unexpected error: {}",
                    symbol.as_str(),
                    error.message
                );
                let raw = read_raw_quote_on_host(&history.diagnostics.host, &symbol, &kind)
                    .unwrap_or_else(|diagnostic| {
                        panic!(
                            "{}: quote service unavailable after MarketRouter failure (router={}): {}",
                            symbol.as_str(),
                            error.message,
                            diagnostic
                        )
                    });
                if raw.snapshot.is_valid() {
                    panic!(
                        "{}: MarketRouter rejected a quote that the diagnostic host returned as valid: {:?}",
                        symbol.as_str(),
                        raw.snapshot
                    );
                } else if is_legal_no_book_quote(&raw.snapshot, &history, &kind) {
                    println!(
                        "adapter.real.quote provider=tdx symbol={} kind={} state=no_book raw_valid=false previous_close={:.6} host={} reason=pre_open_or_closed",
                        symbol.as_str(),
                        kind.as_str(),
                        raw.snapshot.previous_close,
                        history.diagnostics.host
                    );
                } else {
                    panic!(
                        "{}: TDX returned an invalid independent quote rather than a legal no-book state: {:?}",
                        symbol.as_str(),
                        raw.snapshot
                    );
                }
            }
        }
    }
}

#[cfg(feature = "provider-binance")]
#[test]
#[ignore = "connects to Binance public REST APIs through MarketRouter"]
fn real_adapter_binance_catalog_history_and_quote() {
    let router = MarketRouter::builtin().expect("built-in adapter registry must be valid");
    let cases = [
        (
            "binance_spot",
            "BINANCE",
            "BTCUSDT",
            "tradeflow-binance-spot",
            "data-api.binance.vision",
        ),
        (
            "binance_usdm",
            "BINANCE_USDM",
            "BTCUSDT",
            "tradeflow-binance-usdm",
            "fapi.binance.com",
        ),
    ];

    for (provider_id, venue, code, source, host) in cases {
        let catalog = router
            .list_catalog(CatalogRequest {
                provider_id: provider_id.to_string(),
                venue: venue.to_string(),
            })
            .unwrap_or_else(|error| panic!("{provider_id} catalog failed: {}", error.message));
        assert!(
            !catalog.is_empty(),
            "{provider_id} catalog must not be empty"
        );
        assert!(
            catalog
                .iter()
                .any(|symbol| symbol.symbol == format!("{venue}:{code}"))
        );
        assert!(
            catalog
                .iter()
                .all(|symbol| symbol.provider_id == provider_id)
        );
        println!(
            "adapter.real.catalog provider={} venue={} rows={}",
            provider_id,
            venue,
            catalog.len()
        );

        let symbol = Symbol::new(venue, code).unwrap();
        let history = router
            .fetch_history(HistoryRequest {
                provider_id: provider_id.to_string(),
                symbol: symbol.clone(),
                kind: SymbolKind::Crypto,
                resolution: Resolution::Minute1,
                adjustment: Adjustment::None,
                count: 3,
                include_quote: false,
            })
            .unwrap_or_else(|error| panic!("{provider_id} history failed: {}", error.message));
        assert_history_contract(&history, provider_id, source, &symbol, 3, Some(host));
        assert!(history.quote.is_none());
        println!(
            "adapter.real.history provider={} symbol={} rows={} source={} host={}",
            provider_id,
            symbol.as_str(),
            history.bars.len(),
            history.diagnostics.source,
            history.diagnostics.host
        );

        let quote = router
            .fetch_quote(QuoteRequest {
                provider_id: provider_id.to_string(),
                symbol: symbol.clone(),
                kind: SymbolKind::Crypto,
            })
            .unwrap_or_else(|error| panic!("{provider_id} quote failed: {}", error.message));
        assert_eq!(quote.provider_id, provider_id);
        assert_eq!(quote.symbol, symbol);
        assert_eq!(quote.source, source);
        assert!(quote.quote.is_valid());
        println!(
            "adapter.real.quote provider={} symbol={} state=valid last={:.8}",
            provider_id,
            quote.symbol.as_str(),
            quote.quote.last
        );
    }
}

#[cfg(feature = "provider-binance")]
#[derive(Default)]
struct TestRealtimeSink {
    events: Mutex<Vec<RealtimeEventEnvelope>>,
    changed: Condvar,
    stopped: AtomicBool,
}

#[cfg(feature = "provider-binance")]
impl TestRealtimeSink {
    fn has_all_channels(events: &[RealtimeEventEnvelope]) -> bool {
        let mut connected = false;
        let mut bar = false;
        let mut trade = false;
        let mut depth = false;
        for event in events {
            match &event.payload {
                RealtimePayload::Status { status, .. } => connected |= *status == "connected",
                RealtimePayload::Bar { .. } => bar = true,
                RealtimePayload::Point { .. } => {}
                RealtimePayload::Trade { .. } => trade = true,
                RealtimePayload::Depth { .. } => depth = true,
            }
        }
        connected && bar && trade && depth
    }

    fn wait_for_all_channels(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut events = self.events.lock().expect("realtime sink mutex poisoned");
        while !Self::has_all_channels(&events) {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return false;
            };
            let (next, result) = self
                .changed
                .wait_timeout(events, remaining)
                .expect("realtime sink condvar poisoned");
            events = next;
            if result.timed_out() {
                break;
            }
        }
        Self::has_all_channels(&events)
    }

    fn cancel(&self) {
        self.stopped.store(true, Ordering::Release);
        self.changed.notify_all();
    }

    fn snapshot(&self) -> Vec<RealtimeEventEnvelope> {
        self.events
            .lock()
            .expect("realtime sink mutex poisoned")
            .clone()
    }
}

#[cfg(feature = "provider-binance")]
impl RealtimeSink for TestRealtimeSink {
    fn emit(&self, event: RealtimeEventEnvelope) -> Result<(), AppError> {
        if self.stopped.load(Ordering::Acquire) {
            return Err(AppError::new(
                "test_sink_complete",
                "test sink reached its target",
            ));
        }
        let complete = {
            let mut events = self.events.lock().expect("realtime sink mutex poisoned");
            events.push(event);
            Self::has_all_channels(&events)
        };
        self.changed.notify_all();
        if complete {
            self.stopped.store(true, Ordering::Release);
            return Err(AppError::new(
                "test_sink_complete",
                "test sink reached its target",
            ));
        }
        Ok(())
    }
}

#[cfg(feature = "provider-binance")]
fn assert_realtime_envelopes(
    events: &[RealtimeEventEnvelope],
    request_id: u64,
    provider_id: &str,
    symbol: &Symbol,
    resolution: Resolution,
) {
    assert!(TestRealtimeSink::has_all_channels(events));
    for event in events {
        assert_eq!(event.request_id, request_id);
        assert_eq!(event.provider_id, provider_id);
        assert_eq!(event.symbol, *symbol);
        assert_eq!(event.resolution, resolution);
        match &event.payload {
            RealtimePayload::Status { .. } => assert!(event.sequence.is_none()),
            RealtimePayload::Bar { bar, source, .. } => {
                assert!(event.sequence.is_some_and(|sequence| sequence > 0));
                assert!(!source.is_empty());
                Bar::validate_series(std::slice::from_ref(bar)).unwrap();
            }
            RealtimePayload::Point { point, source, .. } => {
                assert!(event.sequence.is_some_and(|sequence| sequence > 0));
                assert!(!source.is_empty());
                crate::contracts::ProbabilityPoint::validate_series(std::slice::from_ref(point))
                    .unwrap();
            }
            RealtimePayload::Trade {
                price, quantity, ..
            } => {
                assert!(event.sequence.is_some_and(|sequence| sequence > 0));
                assert!(price.is_finite() && *price > 0.0);
                assert!(quantity.is_finite() && *quantity > 0.0);
            }
            RealtimePayload::Depth { bids, asks, .. } => {
                assert!(event.sequence.is_some_and(|sequence| sequence > 0));
                assert!(!bids.is_empty() || !asks.is_empty());
            }
        }
    }
}

#[cfg(feature = "provider-binance")]
fn run_real_realtime_probe(
    router: &MarketRouter,
    request_id: u64,
    provider_id: &'static str,
    symbol: Symbol,
    resolution: Resolution,
) {
    let active_request_id = Arc::new(AtomicU64::new(request_id));
    let sink = Arc::new(TestRealtimeSink::default());
    router
        .start_realtime(
            RealtimeRequest {
                request_id,
                provider_id,
                symbol: symbol.clone(),
                kind: SymbolKind::Crypto,
                resolution,
                active_request_id: Arc::clone(&active_request_id),
            },
            sink.clone(),
        )
        .unwrap_or_else(|error| {
            panic!("{provider_id} realtime failed to start: {}", error.message)
        });
    assert!(
        sink.wait_for_all_channels(REALTIME_TIMEOUT),
        "{provider_id} realtime did not produce status/bar/trade/depth: {:?}",
        sink.snapshot()
    );
    let before_cancel = sink.snapshot();
    assert_realtime_envelopes(&before_cancel, request_id, provider_id, &symbol, resolution);
    active_request_id.store(request_id + 1, Ordering::Release);
    sink.cancel();

    let deadline = Instant::now() + Duration::from_secs(12);
    let mut released = false;
    while Instant::now() < deadline {
        if Arc::strong_count(&sink) == 1 {
            released = true;
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    assert!(
        released,
        "{provider_id} realtime worker still holds the sink after cancellation"
    );
    thread::sleep(Duration::from_millis(100));
    assert_eq!(sink.snapshot().len(), before_cancel.len());
    println!(
        "adapter.real.realtime provider={} symbol={} events={} cancelled=true sink_released=true",
        provider_id,
        symbol.as_str(),
        before_cancel.len()
    );
}

#[cfg(feature = "provider-binance")]
#[test]
#[ignore = "connects to Binance public WebSocket streams through MarketRouter"]
fn real_adapter_binance_realtime_spot_and_usdm() {
    let router = MarketRouter::builtin().expect("built-in adapter registry must be valid");
    run_real_realtime_probe(
        &router,
        9_100,
        "binance_spot",
        Symbol::new("BINANCE", "BTCUSDT").unwrap(),
        Resolution::Minute1,
    );
    run_real_realtime_probe(
        &router,
        9_200,
        "binance_usdm",
        Symbol::new("BINANCE_USDM", "BTCUSDT").unwrap(),
        Resolution::Minute1,
    );
}

// 这是仅测试用的最小 connector/runner seam，不复用 Binance transport，也不改变生产
// 重连实现。它把失败、退避、迟到旧订阅和乱序事件固定成可重复输入，避免强制断公网连接。
#[derive(Default)]
struct FakeConnector {
    outcomes: Mutex<VecDeque<Result<(), &'static str>>>,
    connect_attempts: AtomicU64,
    backoff_waits: AtomicU64,
}

impl FakeConnector {
    fn new(outcomes: impl IntoIterator<Item = Result<(), &'static str>>) -> Self {
        Self {
            outcomes: Mutex::new(outcomes.into_iter().collect()),
            connect_attempts: AtomicU64::new(0),
            backoff_waits: AtomicU64::new(0),
        }
    }

    fn connect(&self) -> Result<(), &'static str> {
        self.connect_attempts.fetch_add(1, Ordering::AcqRel);
        self.outcomes
            .lock()
            .expect("fake connector mutex poisoned")
            .pop_front()
            .unwrap_or(Ok(()))
    }
}

#[derive(Default)]
struct ReleaseGate {
    released: Mutex<bool>,
    changed: Condvar,
}

impl ReleaseGate {
    fn wait(&self) {
        let mut released = self.released.lock().expect("release gate mutex poisoned");
        while !*released {
            released = self
                .changed
                .wait(released)
                .expect("release gate condvar poisoned");
        }
    }

    fn release(&self) {
        *self.released.lock().expect("release gate mutex poisoned") = true;
        self.changed.notify_all();
    }
}

#[derive(Default)]
struct RecoverySink {
    active_request_id: Option<Arc<AtomicU64>>,
    events: Mutex<Vec<RealtimeEventEnvelope>>,
    last_sequences: Mutex<HashMap<String, u64>>,
    stale_rejected: AtomicU64,
    sequence_rejected: AtomicU64,
}

impl RecoverySink {
    fn with_active(active_request_id: Arc<AtomicU64>) -> Self {
        Self {
            active_request_id: Some(active_request_id),
            ..Self::default()
        }
    }

    fn channel_key(event: &RealtimeEventEnvelope) -> Option<String> {
        let channel = match event.payload {
            RealtimePayload::Bar { .. } => "bar",
            RealtimePayload::Point { .. } => "point",
            RealtimePayload::Trade { .. } => "trade",
            RealtimePayload::Depth { .. } => "depth",
            RealtimePayload::Status { .. } => return None,
        };
        Some(format!(
            "{}:{}:{}:{}:{}",
            event.request_id,
            event.provider_id,
            event.symbol.as_str(),
            event.resolution.as_str(),
            channel
        ))
    }

    fn accepted(&self) -> Vec<RealtimeEventEnvelope> {
        self.events
            .lock()
            .expect("recovery sink mutex poisoned")
            .clone()
    }
}

impl RealtimeSink for RecoverySink {
    fn emit(&self, event: RealtimeEventEnvelope) -> Result<(), AppError> {
        if self
            .active_request_id
            .as_ref()
            .is_some_and(|active| active.load(Ordering::Acquire) != event.request_id)
        {
            self.stale_rejected.fetch_add(1, Ordering::AcqRel);
            return Ok(());
        }
        if let (Some(key), Some(sequence)) = (Self::channel_key(&event), event.sequence) {
            let mut last = self
                .last_sequences
                .lock()
                .expect("recovery sequence mutex poisoned");
            if last.get(&key).is_some_and(|previous| sequence <= *previous) {
                self.sequence_rejected.fetch_add(1, Ordering::AcqRel);
                return Ok(());
            }
            last.insert(key, sequence);
        }
        self.events
            .lock()
            .expect("recovery sink mutex poisoned")
            .push(event);
        Ok(())
    }
}

static RECOVERY_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
    id: "fake.recovery",
    display_name: "Fake recovery provider",
    version: "test",
    contract_version: crate::market_adapter::ADAPTER_CONTRACT_VERSION,
    enabled: true,
    capabilities: ProviderCapabilities {
        catalog: false,
        history: true,
        quote: false,
        realtime: true,
        venues: &["RECOVERY"],
        kinds: &[SymbolKind::Stock],
        resolutions: &[Resolution::Day],
        adjustments: &[Adjustment::None],
    },
};

struct RecoveryAdapter {
    connector: Arc<FakeConnector>,
    gate: Arc<ReleaseGate>,
    joins: Mutex<Vec<thread::JoinHandle<()>>>,
}

impl RecoveryAdapter {
    fn join_all(&self) {
        let joins = std::mem::take(&mut *self.joins.lock().expect("join mutex poisoned"));
        for join in joins {
            join.join().expect("fake recovery worker panicked");
        }
    }
}

impl RealtimeAdapter for RecoveryAdapter {
    fn replace_subscription(
        &self,
        request: RealtimeRequest,
        sink: Arc<dyn RealtimeSink>,
    ) -> Result<(), AppError> {
        let connector = Arc::clone(&self.connector);
        let gate = Arc::clone(&self.gate);
        let join = thread::spawn(move || {
            let mut backoff = Duration::from_millis(1);
            loop {
                if !request.is_active() {
                    return;
                }
                match connector.connect() {
                    Ok(()) => {
                        sink.emit(request.envelope(
                            None,
                            RealtimePayload::Status {
                                status: "connected",
                                message: None,
                            },
                        ))
                        .ok();
                        if request.request_id == 101 {
                            gate.wait();
                            // Deliberately emit after the request switch; RecoverySink must reject it.
                            sink.emit(request.envelope(
                                Some(10),
                                RealtimePayload::Bar {
                                    bar: Bar::new(1, 10.0, 11.0, 9.0, 10.5, 1.0, None),
                                    closed: false,
                                    event_time_ms: 1,
                                    source: "fake".into(),
                                },
                            ))
                            .ok();
                        } else {
                            for sequence in [10, 10, 9, 11] {
                                sink.emit(request.envelope(
                                    Some(sequence),
                                    RealtimePayload::Bar {
                                        bar: Bar::new(
                                            sequence as i64,
                                            10.0,
                                            11.0,
                                            9.0,
                                            10.5,
                                            1.0,
                                            None,
                                        ),
                                        closed: false,
                                        event_time_ms: sequence as i64,
                                        source: "fake".into(),
                                    },
                                ))
                                .ok();
                            }
                        }
                        return;
                    }
                    Err(message) => {
                        sink.emit(request.envelope(
                            None,
                            RealtimePayload::Status {
                                status: "reconnecting",
                                message: Some(message.to_string()),
                            },
                        ))
                        .ok();
                        connector.backoff_waits.fetch_add(1, Ordering::AcqRel);
                        thread::sleep(backoff);
                        backoff = (backoff * 2).min(Duration::from_millis(8));
                    }
                }
            }
        });
        self.joins.lock().expect("join mutex poisoned").push(join);
        Ok(())
    }
}

impl MarketDataAdapter for RecoveryAdapter {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        &RECOVERY_DESCRIPTOR
    }

    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        Ok(HistoryResponse {
            symbol: request.symbol,
            series_kind: MarketSeriesKind::Ohlcv,
            bars: vec![Bar::new(1, 10.0, 11.0, 9.0, 10.5, 1.0, None)],
            points: Vec::new(),
            diagnostics: HistoryDiagnostics {
                source: "fake.recovery",
                host: "fake.test".to_string(),
                latency_ms: 0.0,
            },
            quote: None,
        })
    }

    fn realtime_adapter(&self) -> Option<&dyn RealtimeAdapter> {
        Some(self)
    }
}

#[test]
fn deterministic_adapter_recovery_rejects_stale_and_sequence_regressions() {
    let active_request_id = Arc::new(AtomicU64::new(101));
    let connector = Arc::new(FakeConnector::new([Err("connect failed"), Ok(()), Ok(())]));
    let gate = Arc::new(ReleaseGate::default());
    let adapter = Box::leak(Box::new(RecoveryAdapter {
        connector: Arc::clone(&connector),
        gate: Arc::clone(&gate),
        joins: Mutex::new(Vec::new()),
    }));
    let router = MarketRouter::new([AdapterRegistration::new(adapter)]).unwrap();
    let sink = Arc::new(RecoverySink::with_active(Arc::clone(&active_request_id)));
    let old_symbol = Symbol::new("RECOVERY", "ABC").unwrap();

    router
        .start_realtime(
            RealtimeRequest {
                request_id: 101,
                provider_id: "fake.recovery",
                symbol: old_symbol.clone(),
                kind: SymbolKind::Stock,
                resolution: Resolution::Day,
                active_request_id: Arc::clone(&active_request_id),
            },
            sink.clone(),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while connector.connect_attempts.load(Ordering::Acquire) < 2 {
        assert!(Instant::now() < deadline, "fake reconnect did not recover");
        thread::sleep(Duration::from_millis(1));
    }
    active_request_id.store(102, Ordering::Release);
    gate.release();

    router
        .start_realtime(
            RealtimeRequest {
                request_id: 102,
                provider_id: "fake.recovery",
                symbol: old_symbol,
                kind: SymbolKind::Stock,
                resolution: Resolution::Day,
                active_request_id: Arc::clone(&active_request_id),
            },
            sink.clone(),
        )
        .unwrap();
    adapter.join_all();

    assert_eq!(connector.connect_attempts.load(Ordering::Acquire), 3);
    assert_eq!(connector.backoff_waits.load(Ordering::Acquire), 1);
    assert_eq!(sink.stale_rejected.load(Ordering::Acquire), 1);
    assert_eq!(sink.sequence_rejected.load(Ordering::Acquire), 2);
    let accepted = sink.accepted();
    let accepted_sequences = accepted
        .iter()
        .filter_map(|event| event.sequence)
        .collect::<Vec<_>>();
    assert_eq!(accepted_sequences, vec![10, 11]);
    println!(
        "adapter.recovery.fake connect_attempts={} backoff_waits={} stale_rejected={} sequence_rejected={} accepted_sequences={accepted_sequences:?}",
        connector.connect_attempts.load(Ordering::Acquire),
        connector.backoff_waits.load(Ordering::Acquire),
        sink.stale_rejected.load(Ordering::Acquire),
        sink.sequence_rejected.load(Ordering::Acquire),
    );
}
