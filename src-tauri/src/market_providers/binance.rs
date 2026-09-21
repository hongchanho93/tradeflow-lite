use std::borrow::Cow;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tradeflow_binance_market_data::{Client, Interval, Kline, RealtimeStream};

use crate::contracts::{
    Adjustment, AppError, Bar, BinanceSpotSymbol, BinanceUsdMarginedSymbol, MarketSeriesKind,
    Resolution,
};
use crate::market_adapter::{
    BINANCE_SPOT_PROVIDER_DESCRIPTOR, BINANCE_USDM_PROVIDER_DESCRIPTOR, CatalogAdapter,
    CatalogRequest, CatalogSymbol, ProviderDescriptor, QuoteAdapter, QuoteRequest, QuoteResponse,
    RealtimeAdapter, RealtimePayload, RealtimePriceLevel, RealtimeRequest, RealtimeSink,
    trade_bar_time,
};
use crate::market_data::{HistoryDiagnostics, HistoryResponse, QuoteSnapshot};
use crate::market_router::{HistoryRequest, MarketDataAdapter};

const SPOT_SOURCE: &str = "tradeflow-binance-spot";
const SPOT_HOST: &str = "data-api.binance.vision";
const USDM_SOURCE: &str = "tradeflow-binance-usdm";
const USDM_HOST: &str = "fapi.binance.com";

pub(crate) struct BinanceSpotAdapter;
pub(crate) struct BinanceUsdMarginedAdapter;

pub(crate) fn list_spot_symbols() -> Result<Vec<BinanceSpotSymbol>, AppError> {
    let started_at = Instant::now();
    spot_client()?
        .fetch_spot_symbols()
        .map_err(map_error)
        .map(|symbols| {
            let symbols = symbols
                .into_iter()
                .map(|symbol| BinanceSpotSymbol {
                    symbol: symbol.symbol,
                    base_asset: symbol.base_asset,
                    quote_asset: symbol.quote_asset,
                })
                .collect::<Vec<_>>();
            eprintln!(
                "market.catalog.binance provider=binance_spot venue=BINANCE symbols={} latency_ms={:.1}",
                symbols.len(),
                started_at.elapsed().as_secs_f64() * 1000.0,
            );
            symbols
        })
}

pub(crate) fn list_usd_margined_symbols() -> Result<Vec<BinanceUsdMarginedSymbol>, AppError> {
    let started_at = Instant::now();
    usd_margined_client()?
        .fetch_usd_margined_perpetual_symbols()
        .map_err(map_error)
        .map(|symbols| {
            let symbols = symbols
                .into_iter()
                .map(|symbol| BinanceUsdMarginedSymbol {
                    symbol: symbol.symbol,
                    base_asset: symbol.base_asset,
                    quote_asset: symbol.quote_asset,
                })
                .collect::<Vec<_>>();
            eprintln!(
                "market.catalog.binance provider=binance_usdm venue=BINANCE_USDM symbols={} latency_ms={:.1}",
                symbols.len(),
                started_at.elapsed().as_secs_f64() * 1000.0,
            );
            symbols
        })
}

impl MarketDataAdapter for BinanceSpotAdapter {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        &BINANCE_SPOT_PROVIDER_DESCRIPTOR
    }

    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        fetch_binance_history(
            request,
            spot_client()?,
            SPOT_SOURCE,
            SPOT_HOST,
            "数字货币现货",
        )
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

impl MarketDataAdapter for BinanceUsdMarginedAdapter {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        &BINANCE_USDM_PROVIDER_DESCRIPTOR
    }

    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        fetch_binance_history(
            request,
            usd_margined_client()?,
            USDM_SOURCE,
            USDM_HOST,
            "U 本位永续合约",
        )
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

impl RealtimeAdapter for BinanceSpotAdapter {
    fn replace_subscription(
        &self,
        request: RealtimeRequest,
        sink: Arc<dyn RealtimeSink>,
    ) -> Result<(), AppError> {
        start_realtime(request, sink, false);
        Ok(())
    }
}

impl RealtimeAdapter for BinanceUsdMarginedAdapter {
    fn replace_subscription(
        &self,
        request: RealtimeRequest,
        sink: Arc<dyn RealtimeSink>,
    ) -> Result<(), AppError> {
        start_realtime(request, sink, true);
        Ok(())
    }
}

impl QuoteAdapter for BinanceSpotAdapter {
    fn fetch_quote(&self, request: QuoteRequest) -> Result<QuoteResponse, AppError> {
        let symbol = request.symbol;
        let (_, code) = symbol.parts();
        let quote = fetch_binance_quote(spot_client()?, code, "数字货币现货")?;
        Ok(QuoteResponse {
            provider_id: BINANCE_SPOT_PROVIDER_DESCRIPTOR.id.to_string(),
            symbol,
            source: SPOT_SOURCE.to_string(),
            quote,
        })
    }
}

impl QuoteAdapter for BinanceUsdMarginedAdapter {
    fn fetch_quote(&self, request: QuoteRequest) -> Result<QuoteResponse, AppError> {
        let symbol = request.symbol;
        let (_, code) = symbol.parts();
        let quote = fetch_binance_quote(usd_margined_client()?, code, "U 本位永续合约")?;
        Ok(QuoteResponse {
            provider_id: BINANCE_USDM_PROVIDER_DESCRIPTOR.id.to_string(),
            symbol,
            source: USDM_SOURCE.to_string(),
            quote,
        })
    }
}

impl CatalogAdapter for BinanceSpotAdapter {
    fn list_symbols(&self, request: CatalogRequest) -> Result<Vec<CatalogSymbol>, AppError> {
        if request.provider_id != BINANCE_SPOT_PROVIDER_DESCRIPTOR.id || request.venue != "BINANCE"
        {
            return Err(AppError::new(
                "catalog_route_not_found",
                "目录市场与现货 provider 不匹配",
            ));
        }
        list_spot_symbols().map(|symbols| {
            symbols
                .into_iter()
                .map(|symbol| CatalogSymbol {
                    provider_id: BINANCE_SPOT_PROVIDER_DESCRIPTOR.id.to_string(),
                    symbol: format!("BINANCE:{}", symbol.symbol),
                    name: format!("{} / {}", symbol.base_asset, symbol.quote_asset),
                    kind: crate::contracts::SymbolKind::Crypto,
                    base_asset: Some(symbol.base_asset),
                    quote_asset: Some(symbol.quote_asset),
                    prediction: None,
                })
                .collect()
        })
    }
}

impl CatalogAdapter for BinanceUsdMarginedAdapter {
    fn list_symbols(&self, request: CatalogRequest) -> Result<Vec<CatalogSymbol>, AppError> {
        if request.provider_id != BINANCE_USDM_PROVIDER_DESCRIPTOR.id
            || request.venue != "BINANCE_USDM"
        {
            return Err(AppError::new(
                "catalog_route_not_found",
                "目录市场与 USD-M provider 不匹配",
            ));
        }
        list_usd_margined_symbols().map(|symbols| {
            symbols
                .into_iter()
                .map(|symbol| CatalogSymbol {
                    provider_id: BINANCE_USDM_PROVIDER_DESCRIPTOR.id.to_string(),
                    symbol: format!("BINANCE_USDM:{}", symbol.symbol),
                    name: format!("{} / {} Perpetual", symbol.base_asset, symbol.quote_asset),
                    kind: crate::contracts::SymbolKind::Crypto,
                    base_asset: Some(symbol.base_asset),
                    quote_asset: Some(symbol.quote_asset),
                    prediction: None,
                })
                .collect()
        })
    }
}

/// Binance 的协议、校准和重连逻辑留在 provider 内部；通用层只持有这个 typed facet。
#[derive(Clone, Copy, Debug)]
enum BinanceStreamKind {
    Spot,
    UsdMarginedMarket,
    UsdMarginedDepth,
}

#[derive(Default)]
struct BinanceStreamPoolState {
    available: Option<RealtimeStream>,
    leased: bool,
}

#[derive(Default)]
struct BinanceStreamPool {
    state: Mutex<BinanceStreamPoolState>,
    released: Condvar,
}

impl BinanceStreamPool {
    fn acquire(&'static self, request: &RealtimeRequest) -> Option<BinanceStreamLease> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while state.leased {
            if !request.is_active() {
                return None;
            }
            let (next, _) = self
                .released
                .wait_timeout(state, Duration::from_millis(50))
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state = next;
        }
        state.leased = true;
        let stream = state.available.take();
        let reused = stream.is_some();
        Some(BinanceStreamLease {
            pool: self,
            stream,
            reused,
        })
    }
}

struct BinanceStreamLease {
    pool: &'static BinanceStreamPool,
    stream: Option<RealtimeStream>,
    reused: bool,
}

impl Drop for BinanceStreamLease {
    fn drop(&mut self) {
        let mut state = self
            .pool
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.available = self.stream.take();
        state.leased = false;
        self.pool.released.notify_all();
    }
}

fn stream_pool(kind: BinanceStreamKind) -> &'static BinanceStreamPool {
    static SPOT: OnceLock<BinanceStreamPool> = OnceLock::new();
    static USD_MARGINED_MARKET: OnceLock<BinanceStreamPool> = OnceLock::new();
    static USD_MARGINED_DEPTH: OnceLock<BinanceStreamPool> = OnceLock::new();
    match kind {
        BinanceStreamKind::Spot => SPOT.get_or_init(BinanceStreamPool::default),
        BinanceStreamKind::UsdMarginedMarket => {
            USD_MARGINED_MARKET.get_or_init(BinanceStreamPool::default)
        }
        BinanceStreamKind::UsdMarginedDepth => {
            USD_MARGINED_DEPTH.get_or_init(BinanceStreamPool::default)
        }
    }
}

fn prepare_stream(
    lease: &mut BinanceStreamLease,
    kind: BinanceStreamKind,
    code: &str,
    interval: Interval,
    request: &RealtimeRequest,
) -> Result<bool, tradeflow_binance_market_data::Error> {
    if let Some(mut stream) = lease.stream.take() {
        match stream.replace_subscription(code, interval) {
            Ok(()) => {
                lease.stream = Some(stream);
                return Ok(lease.reused);
            }
            Err(error) => {
                eprintln!(
                    "market.realtime.subscription_reuse_failed request_id={} provider={} symbol={} resolution={} socket={kind:?} error={error}",
                    request.request_id,
                    request.provider_id,
                    request.symbol.as_str(),
                    request.resolution.as_str(),
                );
                lease.reused = false;
            }
        }
    }
    let stream = match kind {
        BinanceStreamKind::Spot => RealtimeStream::connect_with_cancellation(
            code,
            interval,
            request_cancellation_check(request),
        ),
        BinanceStreamKind::UsdMarginedMarket => {
            RealtimeStream::connect_usd_margined_market_with_cancellation(
                code,
                interval,
                request_cancellation_check(request),
            )
        }
        BinanceStreamKind::UsdMarginedDepth => {
            RealtimeStream::connect_usd_margined_depth_with_cancellation(
                code,
                interval,
                request_cancellation_check(request),
            )
        }
    }?;
    lease.stream = Some(stream);
    Ok(false)
}

fn start_realtime(request: RealtimeRequest, sink: Arc<dyn RealtimeSink>, usd_margined: bool) {
    let interval = interval_for(request.resolution);
    if usd_margined {
        spawn_usd_margined_depth(request.clone(), Arc::clone(&sink), interval);
    }
    thread::spawn(move || {
        use tradeflow_binance_market_data::{
            RealtimeEvent, RealtimeKlineState, RealtimeUpdateSource,
        };

        let mut retry_delay = Duration::from_secs(1);
        let mut kline_sequence = KlineSequenceClock::default();
        let symbol_id = request.symbol.as_str().to_string();
        let code = request.symbol.parts().1.to_string();
        let kind = if usd_margined {
            BinanceStreamKind::UsdMarginedMarket
        } else {
            BinanceStreamKind::Spot
        };
        emit_status(&request, &sink, "connecting", None);
        let Some(mut lease) = stream_pool(kind).acquire(&request) else {
            return;
        };
        while request.is_active() {
            let switch_started = Instant::now();
            match prepare_stream(&mut lease, kind, &code, interval, &request) {
                Ok(reused) => {
                    eprintln!(
                        "market.realtime.subscription_switch request_id={} provider={} symbol={} resolution={} socket={kind:?} connection_reused={} switch_ms={:.1}",
                        request.request_id,
                        request.provider_id,
                        symbol_id,
                        request.resolution.as_str(),
                        reused,
                        switch_started.elapsed().as_secs_f64() * 1000.0,
                    );
                    let mut first_bar_emitted = false;
                    let mut first_aggregate_trade_emitted = false;
                    let mut first_depth_emitted = false;
                    let mut stream_failed = false;
                    let mut kline_state = RealtimeKlineState::default();
                    let mut calibration_pauses = 0_u64;
                    let mut calibration_recoveries = 0_u64;
                    let mut aggregate_trades_skipped = 0_u64;
                    let mut last_freshness_log = Instant::now()
                        .checked_sub(Duration::from_secs(10))
                        .unwrap_or_else(Instant::now);
                    eprintln!(
                        "market.realtime.connected request_id={} provider={} symbol={} resolution={}",
                        request.request_id,
                        request.provider_id,
                        symbol_id,
                        request.resolution.as_str()
                    );
                    if !emit_status(&request, &sink, "connected", None) {
                        return;
                    }
                    while request.is_active() {
                        let read_result = lease
                            .stream
                            .as_mut()
                            .expect("prepared Binance stream")
                            .poll_event();
                        match read_result {
                            Ok(Some(event)) => {
                                retry_delay = Duration::from_secs(1);
                                if !request.is_active() {
                                    break;
                                }
                                if last_freshness_log.elapsed() >= Duration::from_secs(10) {
                                    let event_time_ms = match &event {
                                        RealtimeEvent::AggregateTrade(event) => event.event_time_ms,
                                        RealtimeEvent::Kline(event) => event.event_time_ms,
                                        RealtimeEvent::Depth(_) => 0,
                                    };
                                    if event_time_ms > 0 {
                                        let now_ms = SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .map(|elapsed| elapsed.as_millis() as i64)
                                            .unwrap_or(event_time_ms);
                                        eprintln!(
                                            "market.realtime.freshness request_id={} provider={} symbol={} lag_ms={} calibration_pauses={} calibration_recoveries={} aggregate_trades_skipped={}",
                                            request.request_id,
                                            request.provider_id,
                                            symbol_id,
                                            now_ms.saturating_sub(event_time_ms),
                                            calibration_pauses,
                                            calibration_recoveries,
                                            aggregate_trades_skipped,
                                        );
                                        calibration_pauses = 0;
                                        calibration_recoveries = 0;
                                        aggregate_trades_skipped = 0;
                                        last_freshness_log = Instant::now();
                                    }
                                }
                                let sequence = event_sequence(&event, &mut kline_sequence);
                                match &event {
                                    RealtimeEvent::AggregateTrade(trade) => {
                                        if sink
                                            .emit(
                                                request.envelope(
                                                    sequence,
                                                    RealtimePayload::Trade {
                                                        trade_id: trade.aggregate_trade_id,
                                                        first_trade_id: Some(trade.first_trade_id),
                                                        last_trade_id: Some(trade.last_trade_id),
                                                        trade_time_ms: trade.trade_time_ms,
                                                        bar_time: trade_bar_time(
                                                            trade.trade_time_ms,
                                                            request.resolution,
                                                        )
                                                        .unwrap_or_default(),
                                                        price: trade.price,
                                                        quantity: trade.quantity,
                                                        side: Some(Cow::Borrowed(
                                                            if trade.buyer_is_maker {
                                                                "sell"
                                                            } else {
                                                                "buy"
                                                            },
                                                        )),
                                                        flags: None,
                                                    },
                                                ),
                                            )
                                            .is_err()
                                        {
                                            return;
                                        }
                                    }
                                    RealtimeEvent::Depth(depth) => {
                                        if !emit_depth(&request, &sink, depth, sequence) {
                                            return;
                                        }
                                        if !first_depth_emitted {
                                            first_depth_emitted = true;
                                            eprintln!(
                                                "market.realtime.first_depth request_id={} provider={} symbol={} bids={} asks={} update_id={}",
                                                request.request_id,
                                                request.provider_id,
                                                symbol_id,
                                                depth.bids.len(),
                                                depth.asks.len(),
                                                depth.last_update_id
                                            );
                                        }
                                    }
                                    RealtimeEvent::Kline(_) => {}
                                }
                                let was_awaiting_calibration = kline_state.awaiting_calibration();
                                let aggregate_trade =
                                    matches!(&event, RealtimeEvent::AggregateTrade(_));
                                let update = match kline_state.apply(&event) {
                                    Ok(update) => update,
                                    Err(error) => {
                                        emit_reconnecting(&request, &sink, error.to_string());
                                        stream_failed = true;
                                        break;
                                    }
                                };
                                if !was_awaiting_calibration && kline_state.awaiting_calibration() {
                                    calibration_pauses += 1;
                                }
                                if was_awaiting_calibration && !kline_state.awaiting_calibration() {
                                    calibration_recoveries += 1;
                                }
                                if aggregate_trade && update.is_none() {
                                    aggregate_trades_skipped += 1;
                                }
                                let Some(update) = update else {
                                    continue;
                                };
                                let bar = match bar_from_kline(&update.kline) {
                                    Ok(bar) => bar,
                                    Err(error) => {
                                        emit_reconnecting(&request, &sink, error.message);
                                        stream_failed = true;
                                        break;
                                    }
                                };
                                if let Err(error) = validate_realtime_bar(&bar) {
                                    emit_reconnecting(&request, &sink, error.message);
                                    stream_failed = true;
                                    break;
                                }
                                if !request.is_active() {
                                    break;
                                }
                                if sink
                                    .emit(request.envelope(
                                        sequence,
                                        RealtimePayload::Bar {
                                            bar,
                                            closed: update.closed,
                                            event_time_ms: update.event_time_ms,
                                            source: Cow::Borrowed(update.source.as_str()),
                                        },
                                    ))
                                    .is_err()
                                {
                                    return;
                                }
                                if !first_bar_emitted {
                                    first_bar_emitted = true;
                                    eprintln!(
                                        "market.realtime.first_bar request_id={} provider={} symbol={} resolution={} source={} bar_time={} event_time_ms={} closed={}",
                                        request.request_id,
                                        request.provider_id,
                                        symbol_id,
                                        request.resolution.as_str(),
                                        update.source.as_str(),
                                        update.kline.close_time_ms.saturating_add(1) / 1_000,
                                        update.event_time_ms,
                                        update.closed
                                    );
                                }
                                if update.source == RealtimeUpdateSource::AggregateTrade
                                    && !first_aggregate_trade_emitted
                                {
                                    first_aggregate_trade_emitted = true;
                                    eprintln!(
                                        "market.realtime.first_aggregate_trade request_id={} provider={} symbol={} resolution={} event_time_ms={}",
                                        request.request_id,
                                        request.provider_id,
                                        symbol_id,
                                        request.resolution.as_str(),
                                        update.event_time_ms
                                    );
                                }
                            }
                            Ok(None) => {}
                            Err(error) => {
                                emit_reconnecting(&request, &sink, error.to_string());
                                stream_failed = true;
                                break;
                            }
                        }
                    }
                    if stream_failed {
                        lease.stream = None;
                    } else if !request.is_active() {
                        if let Some(mut stream) = lease.stream.take() {
                            if stream.unsubscribe().is_ok() {
                                lease.stream = Some(stream);
                            }
                        }
                    }
                }
                Err(error) => {
                    if request.is_active() {
                        emit_reconnecting(&request, &sink, error.to_string());
                    } else {
                        break;
                    }
                }
            }
            if !wait_while_active(&request, retry_delay) {
                break;
            }
            retry_delay = (retry_delay * 2).min(Duration::from_secs(15));
        }
        eprintln!(
            "market.realtime.stopped request_id={} provider={} symbol={} resolution={}",
            request.request_id,
            request.provider_id,
            symbol_id,
            request.resolution.as_str()
        );
    });
}

fn spawn_usd_margined_depth(
    request: RealtimeRequest,
    sink: Arc<dyn RealtimeSink>,
    interval: Interval,
) {
    thread::spawn(move || {
        use tradeflow_binance_market_data::RealtimeEvent;

        let mut retry_delay = Duration::from_secs(1);
        let symbol_id = request.symbol.as_str().to_string();
        let code = request.symbol.parts().1.to_string();
        let kind = BinanceStreamKind::UsdMarginedDepth;
        let Some(mut lease) = stream_pool(kind).acquire(&request) else {
            return;
        };
        while request.is_active() {
            let switch_started = Instant::now();
            match prepare_stream(&mut lease, kind, &code, interval, &request) {
                Ok(reused) => {
                    retry_delay = Duration::from_secs(1);
                    let mut first_depth_emitted = false;
                    let mut stream_failed = false;
                    eprintln!(
                        "market.realtime.subscription_switch request_id={} provider={} symbol={} resolution={} socket={kind:?} connection_reused={} switch_ms={:.1}",
                        request.request_id,
                        request.provider_id,
                        symbol_id,
                        request.resolution.as_str(),
                        reused,
                        switch_started.elapsed().as_secs_f64() * 1000.0,
                    );
                    while request.is_active() {
                        let read_result = lease
                            .stream
                            .as_mut()
                            .expect("prepared Binance depth stream")
                            .poll_event();
                        match read_result {
                            Ok(Some(RealtimeEvent::Depth(depth))) => {
                                if !request.is_active()
                                    || !emit_depth(
                                        &request,
                                        &sink,
                                        &depth,
                                        u64::try_from(depth.last_update_id).ok(),
                                    )
                                {
                                    return;
                                }
                                if !first_depth_emitted {
                                    first_depth_emitted = true;
                                    eprintln!(
                                        "market.realtime.first_depth request_id={} provider={} symbol={} bids={} asks={} update_id={}",
                                        request.request_id,
                                        request.provider_id,
                                        symbol_id,
                                        depth.bids.len(),
                                        depth.asks.len(),
                                        depth.last_update_id
                                    );
                                }
                            }
                            Ok(Some(_)) => {
                                eprintln!(
                                    "market.realtime.depth_unexpected_event request_id={} provider={} symbol={}",
                                    request.request_id, request.provider_id, symbol_id
                                );
                                stream_failed = true;
                                break;
                            }
                            Ok(None) => {}
                            Err(error) => {
                                eprintln!(
                                    "market.realtime.depth_reconnecting request_id={} provider={} symbol={} error={error}",
                                    request.request_id, request.provider_id, symbol_id
                                );
                                stream_failed = true;
                                break;
                            }
                        }
                    }
                    if stream_failed {
                        lease.stream = None;
                    } else if !request.is_active() {
                        if let Some(mut stream) = lease.stream.take() {
                            if stream.unsubscribe().is_ok() {
                                lease.stream = Some(stream);
                            }
                        }
                    }
                }
                Err(error) => {
                    if request.is_active() {
                        eprintln!(
                            "market.realtime.depth_reconnecting request_id={} provider={} symbol={} error={error}",
                            request.request_id, request.provider_id, symbol_id
                        );
                    } else {
                        break;
                    }
                }
            }
            if !wait_while_active(&request, retry_delay) {
                break;
            }
            retry_delay = (retry_delay * 2).min(Duration::from_secs(15));
        }
        eprintln!(
            "market.realtime.depth_stopped request_id={} provider={} symbol={}",
            request.request_id, request.provider_id, symbol_id
        );
    });
}

#[derive(Default)]
struct KlineSequenceClock {
    last: u64,
}

impl KlineSequenceClock {
    fn next(&mut self, event_time_ms: i64) -> Option<u64> {
        let candidate = u64::try_from(event_time_ms).ok()?;
        self.last = if candidate > self.last {
            candidate
        } else {
            self.last.saturating_add(1)
        };
        Some(self.last)
    }
}

fn event_sequence(
    event: &tradeflow_binance_market_data::RealtimeEvent,
    kline_sequence: &mut KlineSequenceClock,
) -> Option<u64> {
    match event {
        tradeflow_binance_market_data::RealtimeEvent::AggregateTrade(event) => {
            u64::try_from(event.aggregate_trade_id).ok()
        }
        tradeflow_binance_market_data::RealtimeEvent::Kline(event) => {
            kline_sequence.next(event.event_time_ms)
        }
        tradeflow_binance_market_data::RealtimeEvent::Depth(event) => {
            u64::try_from(event.last_update_id).ok()
        }
    }
}

fn emit_depth(
    request: &RealtimeRequest,
    sink: &Arc<dyn RealtimeSink>,
    depth: &tradeflow_binance_market_data::DepthEvent,
    sequence: Option<u64>,
) -> bool {
    sink.emit(
        request.envelope(
            sequence,
            RealtimePayload::Depth {
                event_time_ms: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_millis() as i64)
                    .unwrap_or_default(),
                bids: depth
                    .bids
                    .iter()
                    .map(|level| RealtimePriceLevel {
                        price: level.price,
                        quantity: level.quantity,
                    })
                    .collect(),
                asks: depth
                    .asks
                    .iter()
                    .map(|level| RealtimePriceLevel {
                        price: level.price,
                        quantity: level.quantity,
                    })
                    .collect(),
            },
        ),
    )
    .is_ok()
}

fn wait_while_active(request: &RealtimeRequest, duration: Duration) -> bool {
    let steps = duration.as_millis().div_ceil(100);
    for _ in 0..steps {
        if !request.is_active() {
            return false;
        }
        thread::sleep(Duration::from_millis(100));
    }
    request.is_active()
}

fn request_cancellation_check(
    request: &RealtimeRequest,
) -> impl Fn() -> bool + Send + Sync + 'static {
    let active_request_id = Arc::clone(&request.active_request_id);
    let request_id = request.request_id;
    move || active_request_id.load(Ordering::Acquire) != request_id
}

fn emit_status(
    request: &RealtimeRequest,
    sink: &Arc<dyn RealtimeSink>,
    status: &'static str,
    message: Option<String>,
) -> bool {
    sink.emit(request.envelope(None, RealtimePayload::Status { status, message }))
        .is_ok()
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

fn fetch_binance_history(
    request: HistoryRequest,
    client: &Client,
    source: &'static str,
    host: &'static str,
    market_label: &'static str,
) -> Result<HistoryResponse, AppError> {
    if request.adjustment != Adjustment::None {
        return Err(AppError::new(
            "unsupported_adjustment",
            format!("{market_label}不支持前复权"),
        ));
    }
    let (_, code) = request.symbol.parts();
    let started_at = Instant::now();
    let klines = client
        .fetch_klines_with_cancellation(code, interval_for(request.resolution), request.count, || crate::market_query::check_active().is_ok())
        .map_err(map_error)?;
    let bars = klines
        .into_iter()
        .map(|kline| bar_from_kline(&kline))
        .collect::<Result<Vec<_>, AppError>>()?;
    let quote = if request.include_quote {
        match fetch_binance_quote(client, code, market_label) {
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
    Ok(HistoryResponse {
        symbol: request.symbol,
        series_kind: MarketSeriesKind::Ohlcv,
        bars,
        points: Vec::new(),
        diagnostics: HistoryDiagnostics {
            source,
            host: host.to_string(),
            latency_ms: started_at.elapsed().as_secs_f64() * 1000.0,
        },
        quote,
    })
}

fn fetch_binance_quote(
    client: &Client,
    code: &str,
    market_label: &str,
) -> Result<QuoteSnapshot, AppError> {
    let ticker = client.fetch_ticker_24h(code).map_err(map_error)?;
    let quote = QuoteSnapshot {
        last: ticker.last,
        previous_close: ticker.previous_close,
        open: ticker.open,
        high: ticker.high,
        low: ticker.low,
        volume: ticker.volume,
        amount: ticker.quote_volume,
        received_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default(),
        bids: Vec::new(),
        asks: Vec::new(),
    };
    if !quote.is_valid() {
        return Err(AppError::new(
            "invalid_market_data",
            format!("{market_label}返回的 24 小时行情不合法"),
        ));
    }
    Ok(quote)
}

fn spot_client() -> Result<&'static Client, AppError> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| Client::public_market_data().map_err(|error| error.to_string()))
        .as_ref()
        .map_err(|message| AppError::new("market_data_source_unavailable", message.clone()))
}

fn usd_margined_client() -> Result<&'static Client, AppError> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            Client::public_usd_margined_market_data().map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|message| AppError::new("market_data_source_unavailable", message.clone()))
}

pub(crate) fn interval_for(resolution: Resolution) -> Interval {
    match resolution {
        Resolution::Minute1 => Interval::Minute1,
        Resolution::Minute5 => Interval::Minute5,
        Resolution::Minute15 => Interval::Minute15,
        Resolution::Minute30 => Interval::Minute30,
        Resolution::Minute60 => Interval::Hour1,
        Resolution::Minute120 => Interval::Hour2,
        Resolution::Minute240 => Interval::Hour4,
        Resolution::Day => Interval::Day1,
        Resolution::Week => Interval::Week1,
        Resolution::Month => Interval::Month1,
    }
}

pub(crate) fn bar_from_kline(kline: &Kline) -> Result<Bar, AppError> {
    let time = kline
        .close_time_ms
        .checked_add(1)
        .ok_or_else(|| AppError::new("invalid_market_data", "币安 K 线时间溢出"))?
        / 1_000;
    let bar = Bar::new(
        time,
        kline.open,
        kline.high,
        kline.low,
        kline.close,
        kline.volume,
        Some(kline.quote_volume),
    );
    Ok(bar)
}

fn validate_realtime_bar(bar: &Bar) -> Result<(), AppError> {
    Bar::validate_series(std::slice::from_ref(bar))
}

fn map_error(error: tradeflow_binance_market_data::Error) -> AppError {
    let message = error.to_string();
    let code = if message.contains("HTTP 429") || message.contains("HTTP 418") {
        "market_data_rate_limited"
    } else if message.contains("HTTP 400") && message.contains("Invalid symbol") {
        "invalid_symbol"
    } else if message.contains("returned an invalid") || message.contains("must be") {
        "invalid_market_data"
    } else {
        "market_data_source_unavailable"
    };
    AppError::new(code, message)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread;
    use std::time::{Duration, Instant};

    use super::{
        BinanceSpotAdapter, BinanceUsdMarginedAdapter, KlineSequenceClock, event_sequence,
        interval_for, wait_while_active,
    };
    use crate::contracts::{Adjustment, Resolution, Symbol, SymbolKind};
    use crate::market_adapter::{MarketDataAdapter, RealtimeRequest};
    use crate::market_router::{HistoryRequest, fetch_history};
    use tradeflow_binance_market_data::{Interval, Kline, KlineEvent, RealtimeEvent};

    fn kline_event(event_time_ms: i64, last_trade_id: i64, closed: bool) -> RealtimeEvent {
        RealtimeEvent::Kline(KlineEvent {
            event_time_ms,
            symbol: "BTCUSDT".to_string(),
            interval: Interval::Minute1,
            kline: Kline {
                open_time_ms: 1_000,
                close_time_ms: 60_999,
                open: 10.0,
                high: 11.0,
                low: 9.0,
                close: 10.5,
                volume: 1.0,
                quote_volume: 10.5,
            },
            first_trade_id: last_trade_id,
            last_trade_id,
            closed,
        })
    }

    #[test]
    fn kline_sequence_advances_even_when_last_trade_id_does_not() {
        let mut clock = KlineSequenceClock::default();
        let open = kline_event(1_000, 106, false);
        let closed = kline_event(1_001, 106, true);
        let same_millisecond = kline_event(1_001, 106, true);

        assert_eq!(event_sequence(&open, &mut clock), Some(1_000));
        assert_eq!(event_sequence(&closed, &mut clock), Some(1_001));
        assert_eq!(event_sequence(&same_millisecond, &mut clock), Some(1_002));
    }

    #[test]
    fn maps_every_lite_resolution_to_binance_spot() {
        assert_eq!(interval_for(Resolution::Minute1), Interval::Minute1);
        assert_eq!(interval_for(Resolution::Minute5), Interval::Minute5);
        assert_eq!(interval_for(Resolution::Minute15), Interval::Minute15);
        assert_eq!(interval_for(Resolution::Minute30), Interval::Minute30);
        assert_eq!(interval_for(Resolution::Minute60), Interval::Hour1);
        assert_eq!(interval_for(Resolution::Minute120), Interval::Hour2);
        assert_eq!(interval_for(Resolution::Minute240), Interval::Hour4);
        assert_eq!(interval_for(Resolution::Day), Interval::Day1);
        assert_eq!(interval_for(Resolution::Week), Interval::Week1);
        assert_eq!(interval_for(Resolution::Month), Interval::Month1);
    }

    #[test]
    fn both_binance_adapters_implement_the_public_provider_contract() {
        let spot = BinanceSpotAdapter.descriptor();
        assert_eq!(spot.id, "binance_spot");
        assert!(spot.capabilities.history);
        assert!(spot.capabilities.quote);
        assert!(spot.capabilities.catalog);
        assert!(spot.capabilities.realtime);

        let usdm = BinanceUsdMarginedAdapter.descriptor();
        assert_eq!(usdm.id, "binance_usdm");
        assert!(usdm.capabilities.history);
        assert!(usdm.capabilities.quote);
        assert!(usdm.capabilities.catalog);
        assert!(usdm.capabilities.realtime);
    }

    #[test]
    fn realtime_backoff_wait_releases_after_request_cancellation() {
        let active_request_id = Arc::new(AtomicU64::new(7));
        let request = RealtimeRequest {
            request_id: 7,
            provider_id: "binance_spot",
            symbol: Symbol::new("BINANCE", "BTCUSDT").unwrap(),
            kind: SymbolKind::Crypto,
            resolution: Resolution::Minute1,
            active_request_id: Arc::clone(&active_request_id),
        };
        let started = Instant::now();
        let worker = thread::spawn(move || wait_while_active(&request, Duration::from_secs(15)));
        thread::sleep(Duration::from_millis(20));
        active_request_id.store(8, Ordering::Release);

        assert!(!worker.join().unwrap());
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "cancelled realtime backoff worker did not release promptly"
        );
    }

    #[test]
    #[ignore = "connects to Binance Spot public market data"]
    fn binance_spot_real_market() {
        for (code, resolution) in [
            ("BTCUSDT", Resolution::Minute1),
            ("BTCUSDT", Resolution::Minute120),
            ("BTCUSDT", Resolution::Minute240),
            ("ETHUSDT", Resolution::Day),
            ("SOLUSDT", Resolution::Month),
        ] {
            let response = fetch_history(HistoryRequest {
                provider_id: "binance_spot".to_string(),
                symbol: Symbol::new("BINANCE", code).unwrap(),
                kind: SymbolKind::Crypto,
                resolution,
                adjustment: Adjustment::None,
                count: 3,
                include_quote: code == "BTCUSDT",
            })
            .unwrap_or_else(|error| panic!("{code}:{}: {}", resolution.as_str(), error.message));
            assert_eq!(response.diagnostics.source, "tradeflow-binance-spot");
            assert_eq!(response.bars.len(), 3);
            assert!(
                response
                    .bars
                    .windows(2)
                    .all(|bars| bars[0].time < bars[1].time)
            );
            if code == "BTCUSDT" {
                assert!(response.quote.is_some());
            }
        }

        let deep = fetch_history(HistoryRequest {
            provider_id: "binance_spot".to_string(),
            symbol: Symbol::new("BINANCE", "BTCUSDT").unwrap(),
            kind: SymbolKind::Crypto,
            resolution: Resolution::Minute1,
            adjustment: Adjustment::None,
            count: 1_200,
            include_quote: false,
        })
        .unwrap_or_else(|error| panic!("BTCUSDT deep history: {}", error.message));
        assert_eq!(deep.bars.len(), 1_200);
        assert!(deep.bars.windows(2).all(|bars| bars[0].time < bars[1].time));
    }

    #[test]
    #[ignore = "connects to Binance USD-M Futures public market data"]
    fn binance_usd_margined_real_market() {
        for resolution in [Resolution::Minute1, Resolution::Day, Resolution::Month] {
            let response = fetch_history(HistoryRequest {
                provider_id: "binance_usdm".to_string(),
                symbol: Symbol::new("BINANCE_USDM", "BTCUSDT").unwrap(),
                kind: SymbolKind::Crypto,
                resolution,
                adjustment: Adjustment::None,
                count: 3,
                include_quote: resolution == Resolution::Minute1,
            })
            .unwrap_or_else(|error| panic!("{}: {}", resolution.as_str(), error.message));
            assert_eq!(response.diagnostics.source, "tradeflow-binance-usdm");
            assert_eq!(response.diagnostics.host, "fapi.binance.com");
            assert_eq!(response.bars.len(), 3);
            assert!(
                response
                    .bars
                    .windows(2)
                    .all(|bars| bars[0].time < bars[1].time)
            );
            if resolution == Resolution::Minute1 {
                assert!(response.quote.is_some());
            }
        }
    }
}
