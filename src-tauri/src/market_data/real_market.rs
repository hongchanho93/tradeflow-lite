//! 连接真实公共主站的验收矩阵。默认忽略，用 `npm run test:real-market` 运行。

use chrono::NaiveDate;
use std::thread;
use std::time::{Duration, Instant};

use super::clock::{shanghai_timestamp, shanghai_today};
use super::history::{HistoryData, HistoryQuery, load_history};
use super::hosts::{self, DEFAULT_HOSTS, HostSuccess};
use crate::contracts::{Adjustment, Bar, Resolution, Symbol, SymbolKind};
use crate::market_router::{self, HistoryRequest, QuoteRequest};
use tradeflow_tdx::SecurityCode;
use tradeflow_tdx::Session;
use tradeflow_tdx::standard::{BarPeriod, Market, SecurityBars, SecurityQuotes, Transactions};

const PRODUCTS: [(SymbolKind, Market, &str); 8] = [
    (SymbolKind::Stock, Market::Shanghai, "600000"),
    (SymbolKind::Stock, Market::Shenzhen, "000001"),
    (SymbolKind::Stock, Market::Beijing, "920000"),
    (SymbolKind::Etf, Market::Shanghai, "510050"),
    (SymbolKind::Etf, Market::Shenzhen, "159915"),
    (SymbolKind::Index, Market::Shanghai, "000001"),
    (SymbolKind::Index, Market::Shenzhen, "399001"),
    (SymbolKind::Index, Market::Beijing, "899050"),
];
const RESOLUTIONS: [Resolution; 10] = [
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
const ADJUSTMENTS: [Adjustment; 2] = [Adjustment::None, Adjustment::Qfq];
const COUNT: usize = 40;

fn fetch(healthy: &[String], today: NaiveDate, query: HistoryQuery) -> HostSuccess<HistoryData> {
    hosts::run_with_failover(healthy, |host| {
        hosts::connect_and_run(host, |client| load_history(client, &query, today))
    })
    .unwrap_or_else(|attempts| panic!("all healthy hosts failed: {attempts:?}"))
}

fn query(
    kind: SymbolKind,
    market: Market,
    code: &str,
    resolution: Resolution,
    adjustment: Adjustment,
    count: usize,
) -> HistoryQuery {
    HistoryQuery {
        market,
        code: SecurityCode::new(code).unwrap(),
        include_quote: resolution == Resolution::Day && adjustment == Adjustment::None,
        kind,
        resolution,
        adjustment,
        count,
    }
}

fn validate(label: &str, bars: &[Bar], allow_non_positive_prices: bool) {
    assert!(!bars.is_empty(), "{label}: empty bars");
    let result = if allow_non_positive_prices {
        Bar::validate_adjusted_series(bars)
    } else {
        Bar::validate_series(bars)
    };
    if let Err(error) = result {
        panic!("{label}: {}", error.message);
    }
}

#[test]
#[ignore = "samples live TDX update cadence for 20 seconds"]
fn real_tdx_update_cadence_probe() {
    let host =
        std::env::var("TDX_CADENCE_HOST").unwrap_or_else(|_| "115.238.56.198:7709".to_string());
    let code_text = std::env::var("TDX_CADENCE_CODE").unwrap_or_else(|_| "603118".to_string());
    let duration_seconds = std::env::var("TDX_CADENCE_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(20);
    let code = SecurityCode::new(&code_text).unwrap();
    let started = Instant::now();
    let mut previous_bar = None;
    let mut previous_quote = None;
    let mut previous_trades = None;
    let mut bar_changes = Vec::new();
    let mut quote_changes = Vec::new();
    let mut trade_changes = Vec::new();
    while started.elapsed() < Duration::from_secs(duration_seconds) {
        let sample_started = Instant::now();
        let (bar, quote, trades) = hosts::connect_and_run(&host, |client| {
            let bar = client
                .call(&SecurityBars {
                    market: Market::Shanghai,
                    code,
                    period: BarPeriod::Minute1,
                    offset: 0,
                    count: 1,
                })
                .map_err(|error| error.to_string())?
                .into_iter()
                .next();
            let quote = client
                .call(&SecurityQuotes {
                    securities: vec![(Market::Shanghai, code)],
                })
                .map_err(|error| error.to_string())?
                .into_iter()
                .next();
            let trades = client
                .call(&Transactions {
                    market: Market::Shanghai,
                    code,
                    offset: 0,
                    count: 100,
                })
                .map_err(|error| error.to_string())?;
            Ok((bar, quote, trades))
        })
        .expect("cadence probe request must succeed");
        let elapsed = started.elapsed();
        if previous_bar
            .as_ref()
            .is_some_and(|previous| Some(previous) != bar.as_ref())
        {
            bar_changes.push(elapsed);
        }
        if previous_quote
            .as_ref()
            .is_some_and(|previous| Some(previous) != quote.as_ref())
        {
            quote_changes.push(elapsed);
        }
        if previous_trades
            .as_ref()
            .is_some_and(|previous| previous != &trades)
        {
            trade_changes.push(elapsed);
        }
        previous_bar = bar;
        previous_quote = quote;
        previous_trades = Some(trades);
        let target = Duration::from_millis(200);
        if sample_started.elapsed() < target {
            thread::sleep(target - sample_started.elapsed());
        }
    }
    let intervals = |changes: &[Duration]| {
        changes
            .windows(2)
            .map(|pair| (pair[1] - pair[0]).as_millis())
            .collect::<Vec<_>>()
    };
    println!(
        "tdx.cadence host={host} symbol=SH:{code_text} sample_ms=200 duration_s={duration_seconds} bar_changes_ms={:?} bar_intervals_ms={:?} quote_changes_ms={:?} quote_intervals_ms={:?} trade_changes_ms={:?} trade_intervals_ms={:?}",
        bar_changes
            .iter()
            .map(Duration::as_millis)
            .collect::<Vec<_>>(),
        intervals(&bar_changes),
        quote_changes
            .iter()
            .map(Duration::as_millis)
            .collect::<Vec<_>>(),
        intervals(&quote_changes),
        trade_changes
            .iter()
            .map(Duration::as_millis)
            .collect::<Vec<_>>(),
        intervals(&trade_changes),
    );
    assert!(
        !quote_changes.is_empty(),
        "quote did not change during the sample"
    );
    assert!(
        !trade_changes.is_empty(),
        "transactions did not change during the sample"
    );
}

#[test]
#[ignore = "connects to public TDX hosts"]
fn real_market_matrix() {
    let today = shanghai_today();
    let probes = hosts::benchmark(&DEFAULT_HOSTS);
    let healthy = probes
        .iter()
        .filter(|probe| probe.ok)
        .map(|probe| probe.host.clone())
        .collect::<Vec<_>>();
    assert!(!healthy.is_empty(), "no healthy Lite host: {probes:?}");
    println!(
        "hosts: {}/{} healthy; fastest={}",
        healthy.len(),
        probes.len(),
        healthy[0]
    );

    let routed = market_router::fetch_history(HistoryRequest {
        provider_id: "tdx".to_string(),
        symbol: Symbol::new("SH", "600000").unwrap(),
        kind: SymbolKind::Stock,
        resolution: Resolution::Day,
        adjustment: Adjustment::None,
        count: COUNT,
        include_quote: true,
    })
    .expect("Rust router must preserve the existing TDX history path");
    assert_eq!(routed.diagnostics.source, "tradeflow-tdx");
    validate("router:stock:600000:1D:none", &routed.bars, false);
    if let Some(quote) = routed.quote.as_ref() {
        assert!(
            quote.is_valid(),
            "router:stock:600000:1D:none: attached quote must be valid when present"
        );
        println!(
            "adapter.history.quote provider=tdx symbol=SH:600000 state=valid last={:.3}",
            quote.last
        );
    } else {
        println!(
            "adapter.history.quote provider=tdx symbol=SH:600000 state=unavailable bars_retained={}",
            routed.bars.len()
        );
    }
    match market_router::fetch_quote(QuoteRequest {
        provider_id: "tdx".to_string(),
        symbol: Symbol::new("SH", "600000").unwrap(),
        kind: SymbolKind::Stock,
    }) {
        Ok(response) => {
            assert_eq!(response.provider_id, "tdx");
            assert_eq!(response.source, "tradeflow-tdx");
            assert_eq!(response.symbol.as_str(), "SH:600000");
            assert!(
                response.quote.is_valid(),
                "independent TDX quote must pass strict QuoteSnapshot validation"
            );
            println!(
                "adapter.quote provider=tdx symbol=SH:600000 state=valid last={:.3}",
                response.quote.last
            );
        }
        Err(error) => {
            assert_eq!(
                error.code, "market_data_unavailable",
                "independent quote may be unavailable before open, but never invalid: {}",
                error.message
            );
            println!(
                "adapter.quote provider=tdx symbol=SH:600000 state=unavailable code={}",
                error.code
            );
        }
    }
    let trades =
        super::fetch_recent_trades(Symbol::new("SH", "600000").unwrap(), SymbolKind::Stock, 800)
            .expect("TDX recent trades must use the validated host pool");
    assert_eq!(trades.provider_id, "tdx");
    assert_eq!(trades.symbol, "SH:600000");
    assert_eq!(trades.source, "tradeflow-tdx-transactions");
    assert!(
        trades
            .trades
            .windows(2)
            .all(|rows| rows[0].trade_time_ms <= rows[1].trade_time_ms),
        "TDX recent trades must preserve chronological source order"
    );
    assert!(
        trades
            .trades
            .iter()
            .all(|trade| trade.price > 0.0 && trade.quantity >= 0.0),
        "TDX recent trades must contain valid price and quantity"
    );
    println!(
        "adapter.trades provider=tdx symbol=SH:600000 rows={} latest_time_ms={} latest_price={:.3} host={}",
        trades.trades.len(),
        trades
            .trades
            .last()
            .map(|trade| trade.trade_time_ms)
            .unwrap_or_default(),
        trades
            .trades
            .last()
            .map(|trade| trade.price)
            .unwrap_or_default(),
        trades.diagnostics.host
    );

    let composite = fetch(
        &healthy,
        today,
        query(
            SymbolKind::Index,
            Market::Shanghai,
            "000001",
            Resolution::Day,
            Adjustment::None,
            12_000,
        ),
    );
    validate("index:000001:1D:deep", &composite.value.bars, false);
    let listing = shanghai_timestamp(NaiveDate::from_ymd_opt(1990, 12, 19).unwrap(), 15, 0);
    assert_eq!(
        Some(composite.value.bars[0].time),
        listing,
        "index:000001:1D:deep: incomplete start date"
    );
    assert!(
        composite.value.repairs.ohlc_envelope > 0,
        "index:000001:1D:deep: legacy OHLC repair was not exercised"
    );
    println!(
        "ok index:000001:1D:deep bars={} repairs={}",
        composite.value.bars.len(),
        composite.value.repairs.ohlc_envelope
    );

    for (market, code) in [
        (Market::Shanghai, "000002"),
        (Market::Shanghai, "000003"),
        (Market::Shenzhen, "399001"),
    ] {
        let label = format!("index:{code}:1D:deep");
        let response = fetch(
            &healthy,
            today,
            query(
                SymbolKind::Index,
                market,
                code,
                Resolution::Day,
                Adjustment::None,
                12_000,
            ),
        );
        validate(&label, &response.value.bars, false);
        assert!(
            response.value.repairs.ohlc_envelope > 0,
            "{label}: legacy OHLC repair was not exercised"
        );
        println!(
            "ok {label} bars={} repairs={}",
            response.value.bars.len(),
            response.value.repairs.ohlc_envelope
        );
    }

    for (kind, code) in [(SymbolKind::Stock, "600000"), (SymbolKind::Etf, "510050")] {
        let label = format!("{}:{code}:1D:qfq:deep", kind.as_str());
        let response = fetch(
            &healthy,
            today,
            query(
                kind,
                Market::Shanghai,
                code,
                Resolution::Day,
                Adjustment::Qfq,
                12_000,
            ),
        );
        validate(&label, &response.value.bars, true);
        let lowest = response
            .value
            .bars
            .iter()
            .map(|bar| bar.low)
            .fold(f64::INFINITY, f64::min);
        assert!(
            lowest <= 0.0,
            "{label}: non-positive adjusted-price boundary was not exercised"
        );
        println!("ok {label} bars={}", response.value.bars.len());
    }

    let mut routes = 0;
    for (kind, market, code) in PRODUCTS {
        for resolution in RESOLUTIONS {
            let mut latest = Vec::new();
            for adjustment in ADJUSTMENTS {
                let label = format!(
                    "{}:{code}:{}:{}",
                    kind.as_str(),
                    resolution.as_str(),
                    adjustment.as_str()
                );
                let response = fetch(
                    &healthy,
                    today,
                    query(kind.clone(), market, code, resolution, adjustment, COUNT),
                );
                assert!(
                    healthy.contains(&response.host),
                    "{label}: response used a host outside the validated pool"
                );
                assert!(
                    response
                        .attempts
                        .iter()
                        .all(|attempt| attempt.host != response.host),
                    "{label}: selected host also appears as a failed attempt"
                );
                validate(&label, &response.value.bars, false);
                if resolution == Resolution::Day && adjustment == Adjustment::None {
                    if let Some(quote) = response.value.quote.as_ref() {
                        assert!(quote.is_valid(), "{label}: attached quote must be valid");
                    } else {
                        println!(
                            "adapter.history.quote provider=tdx symbol={code} state=unavailable bars_retained={}",
                            response.value.bars.len()
                        );
                    }
                }
                println!(
                    "ok {label} bars={} host={} latency={:.1}ms",
                    response.value.bars.len(),
                    response.host,
                    response.latency_ms
                );
                latest.push(response.value.bars);
                routes += 1;
            }
            // 两种复权是先后两次请求；交易时段中间最新一根可能仍在变化或新增一根，
            // 所以只要求前复权包含不复权的最新时间，并只比较双方都已走完的 K 线。
            let (raw, adjusted) = (&latest[0], &latest[1]);
            let raw_last = raw.last().expect("validated non-empty").time;
            let adjusted_last = adjusted.last().expect("validated non-empty").time;
            assert!(
                adjusted_last >= raw_last && adjusted.iter().any(|bar| bar.time == raw_last),
                "{}:{code}:{}: adjustment changed latest timestamp",
                kind.as_str(),
                resolution.as_str()
            );
            if kind == SymbolKind::Index {
                let first = raw[0].time.max(adjusted[0].time);
                let settled = |bars: &[Bar]| {
                    bars.iter()
                        .filter(|bar| bar.time >= first && bar.time < raw_last)
                        .cloned()
                        .collect::<Vec<_>>()
                };
                let settled_raw = settled(raw);
                assert!(
                    settled_raw.len() >= COUNT - 2,
                    "index:{code}: too few settled bars"
                );
                assert_eq!(
                    settled_raw,
                    settled(adjusted),
                    "index:{code}:{}: qfq must be an exact no-op",
                    resolution.as_str()
                );
            }
        }
    }
    println!("real market matrix OK ({routes} routes)");
}
