//! 在一台主站上完成一次完整的历史 K 线请求：分页取数、标准化、指数 OHLC 修复、
//! 数据校验、前复权、周/月线聚合，以及可选的最新行情。

use std::collections::HashMap;

use chrono::{Datelike, NaiveDate};

use super::clock::{shanghai_date, shanghai_timestamp};
use super::quote::QuoteSnapshot;
use super::validate_tdx_quote_identity;
use crate::contracts::{Adjustment, Bar, Resolution, SymbolKind};
use crate::tdx::standard::{
    BarPeriod, IndexBars, MAX_BARS_PER_REQUEST, Market, RawBar, SecurityBars, SecurityQuotes,
    Standard, XdxrDetail, XdxrEntry, XdxrInfo,
};
use crate::tdx::{SecurityCode, Session};

/// 按周/月聚合前复权数据时，最多向主站请求的日线条数。
const MAX_AGGREGATION_SOURCE_BARS: usize = 8_000;

pub(crate) struct HistoryQuery {
    pub market: Market,
    pub code: SecurityCode,
    pub kind: SymbolKind,
    pub resolution: Resolution,
    pub adjustment: Adjustment,
    pub count: usize,
    pub include_quote: bool,
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Repairs {
    pub ohlc_envelope: usize,
    pub first_time: Option<i64>,
    pub last_time: Option<i64>,
    pub non_positive_adjusted_bars: usize,
}

#[derive(Debug)]
pub(crate) struct HistoryData {
    pub bars: Vec<Bar>,
    pub repairs: Repairs,
    pub quote: Option<QuoteSnapshot>,
}

pub(crate) fn period_for(resolution: Resolution) -> BarPeriod {
    match resolution {
        Resolution::Minute1 => BarPeriod::Minute1,
        Resolution::Minute5 => BarPeriod::Minute5,
        Resolution::Minute15 => BarPeriod::Minute15,
        Resolution::Minute30 => BarPeriod::Minute30,
        Resolution::Minute60 => BarPeriod::Minute60,
        Resolution::Day => BarPeriod::Day,
        Resolution::Week => BarPeriod::Week,
        Resolution::Month => BarPeriod::Month,
    }
}

pub(crate) fn load_history<S: Session<Standard>>(
    session: &mut S,
    query: &HistoryQuery,
    today: NaiveDate,
) -> Result<HistoryData, String> {
    let is_index = query.kind == SymbolKind::Index;
    let adjusted = query.adjustment == Adjustment::Qfq && !is_index;
    // 前复权的周/月线必须由复权后的日线聚合，否则除权日所在的周/月会失真。
    let aggregate = adjusted && matches!(query.resolution, Resolution::Week | Resolution::Month);
    let native_resolution = if aggregate {
        Resolution::Day
    } else {
        query.resolution
    };
    let native_count = if aggregate {
        let days_per_bar = if query.resolution == Resolution::Week {
            6
        } else {
            24
        };
        MAX_AGGREGATION_SOURCE_BARS.min(query.count * days_per_bar + 60)
    } else {
        query.count
    };

    let raw = fetch_native_bars(session, query, period_for(native_resolution), native_count)
        .map_err(|error| error.to_string())?;
    if raw.is_empty() {
        return Err(format!("empty {} response", query.resolution.as_str()));
    }
    let mut bars = normalize(&raw, native_resolution)?;
    let mut repairs = if is_index {
        repair_index_ohlc_envelopes(&mut bars)
    } else {
        Repairs::default()
    };
    validate_source_bars(&bars)?;
    if adjusted {
        let entries = session
            .call(&XdxrInfo {
                market: query.market,
                code: query.code,
            })
            .map_err(|error| error.to_string())?;
        bars = apply_qfq(bars, &qfq_events(&entries, today));
    }
    if aggregate {
        bars = aggregate_bars(bars, query.resolution);
    }
    if bars.len() > query.count {
        bars.drain(..bars.len() - query.count);
    }
    if query.adjustment == Adjustment::Qfq {
        repairs.non_positive_adjusted_bars = bars
            .iter()
            .filter(|bar| bar.open.min(bar.high).min(bar.low).min(bar.close) <= 0.0)
            .count();
    }
    let quote = if query.include_quote {
        match session
            .call(&SecurityQuotes {
                securities: vec![(query.market, query.code)],
            })
            .map_err(|error| error.to_string())
        {
            Ok(quotes) => match quotes.first() {
                Some(quote) => match validate_tdx_quote_identity(quote, query.market, query.code) {
                    Ok(_) => Some(QuoteSnapshot::from_tdx(quote, &query.kind)),
                    Err(error) => {
                        eprintln!(
                            "market.history.quote.identity_mismatch provider=tdx market={} code={} expected_market={} expected_code={} raw_market={} raw_code={} message={error}",
                            query.market.code(),
                            query.code,
                            query.market.code(),
                            query.code,
                            quote.market,
                            quote.code
                        );
                        None
                    }
                },
                None => None,
            },
            Err(error) => {
                eprintln!(
                    "market.history.quote_degraded provider=tdx market={} code={} message={error}",
                    query.market.code(),
                    query.code
                );
                None
            }
        }
    } else {
        None
    };
    Ok(HistoryData {
        bars,
        repairs,
        quote,
    })
}

/// 在同一台主站上从最新一根往前分页取数，直到够数或主站没有更多数据。
fn fetch_native_bars<S: Session<Standard>>(
    session: &mut S,
    query: &HistoryQuery,
    period: BarPeriod,
    count: usize,
) -> Result<Vec<RawBar>, crate::tdx::TdxError> {
    let mut rows = Vec::with_capacity(count);
    while rows.len() < count {
        let page_size = usize::from(MAX_BARS_PER_REQUEST).min(count - rows.len());
        let offset = u16::try_from(rows.len()).map_err(|_| {
            crate::tdx::TdxError::InvalidArgument(format!("bar offset {} is too large", rows.len()))
        })?;
        let page = if query.kind == SymbolKind::Index {
            session
                .call(&IndexBars {
                    market: query.market,
                    code: query.code,
                    period,
                    offset,
                    count: page_size as u16,
                })?
                .into_iter()
                .map(|row| row.bar)
                .collect()
        } else {
            session.call(&SecurityBars {
                market: query.market,
                code: query.code,
                period,
                offset,
                count: page_size as u16,
            })?
        };
        let short_page = page.len() < page_size;
        if page.is_empty() {
            break;
        }
        rows.extend(page);
        if short_page {
            break;
        }
    }
    Ok(rows)
}

fn normalize(raw: &[RawBar], resolution: Resolution) -> Result<Vec<Bar>, String> {
    // 日线及以上的成交量单位是手，统一换算成股。
    let volume_scale = match resolution {
        Resolution::Day | Resolution::Week | Resolution::Month => 100.0,
        _ => 1.0,
    };
    let mut bars = raw
        .iter()
        .map(|row| {
            let date = row.time.date;
            let time = NaiveDate::from_ymd_opt(
                i32::from(date.year),
                u32::from(date.month),
                u32::from(date.day),
            )
            .and_then(|day| {
                shanghai_timestamp(day, u32::from(row.time.hour), u32::from(row.time.minute))
            })
            .ok_or_else(|| format!("invalid bar time {:?}", row.time))?;
            Ok(Bar::new(
                time,
                row.open,
                row.high,
                row.low,
                row.close,
                row.volume * volume_scale,
                row.amount.is_finite().then_some(row.amount),
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    bars.sort_by_key(|bar| bar.time);
    Ok(bars)
}

/// 部分早期指数日线的最高/最低价没有包住开盘和收盘价，按实体补齐，不丢弃任何交易日。
fn repair_index_ohlc_envelopes(bars: &mut [Bar]) -> Repairs {
    let mut repairs = Repairs::default();
    for bar in bars {
        let high = bar.high.max(bar.open).max(bar.close);
        let low = bar.low.min(bar.open).min(bar.close);
        if high == bar.high && low == bar.low {
            continue;
        }
        bar.high = high;
        bar.low = low;
        repairs.ohlc_envelope += 1;
        repairs.first_time.get_or_insert(bar.time);
        repairs.last_time = Some(bar.time);
    }
    repairs
}

fn validate_source_bars(bars: &[Bar]) -> Result<(), String> {
    let mut previous_time = None;
    for bar in bars {
        let prices = [bar.open, bar.high, bar.low, bar.close];
        if !prices.iter().all(|price| price.is_finite() && *price > 0.0)
            || !bar.volume.is_finite()
            || bar.volume < 0.0
            || bar.high < bar.open.max(bar.close)
            || bar.low > bar.open.min(bar.close)
            || bar.high < bar.low
            || previous_time.is_some_and(|time| bar.time <= time)
        {
            return Err(format!("invalid source bar at {}", bar.time));
        }
        previous_time = Some(bar.time);
    }
    Ok(())
}

#[derive(Debug, PartialEq)]
struct QfqEvent {
    time: i64,
    ratio: f64,
    adjustment: f64,
}

/// 把除权除息记录换算成前复权事件：除权日之前的价格按 `(价格 - adjustment) / ratio` 调整。
fn qfq_events(entries: &[XdxrEntry], today: NaiveDate) -> Vec<QfqEvent> {
    let mut events = entries
        .iter()
        .filter_map(|entry| {
            let date = NaiveDate::from_ymd_opt(
                i32::from(entry.date.year),
                u32::from(entry.date.month),
                u32::from(entry.date.day),
            )?;
            if date > today {
                return None;
            }
            let (cash, rights_price, bonus, rights, split) = match entry.detail {
                XdxrDetail::Dividend {
                    cash,
                    rights_price,
                    bonus_shares,
                    rights_shares,
                } => (cash, rights_price, bonus_shares, rights_shares, 1.0),
                XdxrDetail::Consolidation { ratio } => (0.0, 0.0, 0.0, 0.0, ratio),
                _ => return None,
            };
            let split = if split.is_finite() && split > 0.0 {
                split
            } else {
                1.0
            };
            let ratio = (1.0 + bonus / 10.0 + rights / 10.0) * split;
            let adjustment = cash / 10.0 - rights_price * rights / 10.0;
            if !ratio.is_finite() || !adjustment.is_finite() || ratio <= 0.0 {
                return None;
            }
            if (ratio - 1.0).abs() < 1e-12 && adjustment.abs() < 1e-12 {
                return None;
            }
            Some(QfqEvent {
                time: shanghai_timestamp(date, 0, 0)?,
                ratio,
                adjustment,
            })
        })
        .collect::<Vec<_>>();
    events.sort_by_key(|event| event.time);
    events
}

fn apply_qfq(mut bars: Vec<Bar>, events: &[QfqEvent]) -> Vec<Bar> {
    for event in events {
        for bar in bars.iter_mut().filter(|bar| bar.time < event.time) {
            for price in [&mut bar.open, &mut bar.high, &mut bar.low, &mut bar.close] {
                *price = (*price - event.adjustment) / event.ratio;
            }
        }
    }
    bars
}

fn aggregate_bars(bars: Vec<Bar>, resolution: Resolution) -> Vec<Bar> {
    let mut groups: Vec<Bar> = Vec::new();
    let mut index_by_key: HashMap<(i32, u32), usize> = HashMap::new();
    for bar in bars {
        let date = shanghai_date(bar.time);
        let key = if resolution == Resolution::Week {
            let week = date.iso_week();
            (week.year(), week.week())
        } else {
            (date.year(), date.month())
        };
        let Some(&index) = index_by_key.get(&key) else {
            index_by_key.insert(key, groups.len());
            groups.push(bar);
            continue;
        };
        let group = &mut groups[index];
        group.high = group.high.max(bar.high);
        group.low = group.low.min(bar.low);
        group.close = bar.close;
        group.time = bar.time;
        group.volume += bar.volume;
        group.amount = group
            .amount
            .zip(bar.amount)
            .map(|(total, amount)| total + amount);
    }
    groups
}

#[cfg(test)]
mod tests {
    use std::any::Any;
    use std::collections::VecDeque;

    use chrono::NaiveDate;

    use super::{
        HistoryQuery, QfqEvent, Repairs, aggregate_bars, apply_qfq, load_history, normalize,
        qfq_events, repair_index_ohlc_envelopes, validate_source_bars,
    };
    use crate::contracts::{Adjustment, Bar, Resolution, SymbolKind};
    use crate::market_data::clock::shanghai_timestamp;
    use crate::tdx::standard::{
        BookLevel, IndexBars, Market, RawBar, SecurityBars, SecurityQuote, SecurityQuotes,
        Standard, XdxrDetail, XdxrEntry, XdxrInfo,
    };
    use crate::tdx::{Request, SecurityCode, Session, TdxDate, TdxDateTime, TdxError};

    /// 不走网络的会话：记录收到的请求，按顺序返回预设响应。
    #[derive(Default)]
    pub(crate) struct FakeSession {
        pub calls: Vec<String>,
        pub responses: VecDeque<Box<dyn Any>>,
        pub quote_error: bool,
    }

    impl Session<Standard> for FakeSession {
        fn call<R: Request<Dialect = Standard>>(
            &mut self,
            request: &R,
        ) -> Result<R::Response, TdxError> {
            let request: &dyn Any = request;
            if let Some(bars) = request.downcast_ref::<SecurityBars>() {
                self.calls
                    .push(format!("security_bars {} {}", bars.offset, bars.count));
                if self.responses.is_empty() {
                    let rows: Vec<RawBar> =
                        (0..bars.count).map(|index| raw(1, index as f64)).collect();
                    return Ok(*(Box::new(rows) as Box<dyn Any>)
                        .downcast::<R::Response>()
                        .unwrap());
                }
            } else if request.downcast_ref::<IndexBars>().is_some() {
                self.calls.push("index_bars".to_string());
            } else if request.downcast_ref::<XdxrInfo>().is_some() {
                self.calls.push("xdxr".to_string());
            } else if request.downcast_ref::<SecurityQuotes>().is_some() {
                self.calls.push("quotes".to_string());
                if self.quote_error {
                    self.quote_error = false;
                    return Err(TdxError::Broken);
                }
            }
            let response = self.responses.pop_front().expect("fake response queued");
            Ok(*response
                .downcast::<R::Response>()
                .expect("fake response type matches request"))
        }
    }

    fn raw(day: u8, open: f64) -> RawBar {
        RawBar {
            time: TdxDateTime {
                date: TdxDate {
                    year: 2026,
                    month: 9,
                    day,
                },
                hour: 15,
                minute: 0,
            },
            open: 10.0 + open,
            high: 11.0 + open,
            low: 9.0 + open,
            close: 10.5 + open,
            volume: 1.0,
            amount: 10.0,
        }
    }

    fn pre_open_zero_quote() -> SecurityQuote {
        SecurityQuote {
            market: Market::Shanghai.code(),
            code: SecurityCode::new("600000").unwrap(),
            active1: 0,
            price: 0,
            previous_close: 1_000,
            open: 0,
            high: 0,
            low: 0,
            server_time: 0,
            unknown_1: 0,
            volume: 0,
            current_volume: 0,
            amount: 0.0,
            sell_volume: 0,
            buy_volume: 0,
            unknown_2: 0,
            unknown_3: 0,
            bids: [BookLevel::default(); 5],
            asks: [BookLevel::default(); 5],
            unknown_4: 0,
            unknown_5: 0,
            unknown_6: 0,
            unknown_7: 0,
            unknown_8: 0,
            speed: 0,
            active2: 0,
        }
    }

    fn quote_with_identity(market: Market, code: &str) -> SecurityQuote {
        SecurityQuote {
            market: market.code(),
            code: SecurityCode::new(code).unwrap(),
            active1: 0,
            price: 1_050,
            previous_close: 1_000,
            open: 1_020,
            high: 1_060,
            low: 1_010,
            server_time: 0,
            unknown_1: 0,
            volume: 100,
            current_volume: 10,
            amount: 1_000.0,
            sell_volume: 0,
            buy_volume: 0,
            unknown_2: 0,
            unknown_3: 0,
            bids: [BookLevel::default(); 5],
            asks: [BookLevel::default(); 5],
            unknown_4: 0,
            unknown_5: 0,
            unknown_6: 0,
            unknown_7: 0,
            unknown_8: 0,
            speed: 0,
            active2: 0,
        }
    }

    fn ts(year: i32, month: u32, day: u32, hour: u32) -> i64 {
        shanghai_timestamp(NaiveDate::from_ymd_opt(year, month, day).unwrap(), hour, 0).unwrap()
    }

    fn flat(time: i64, price: f64, volume: f64) -> Bar {
        Bar::new(time, price, price, price, price, volume, None)
    }

    fn query(
        kind: SymbolKind,
        resolution: Resolution,
        adjustment: Adjustment,
        count: usize,
    ) -> HistoryQuery {
        HistoryQuery {
            market: Market::Shanghai,
            code: SecurityCode::new("600000").unwrap(),
            kind,
            resolution,
            adjustment,
            count,
            include_quote: false,
        }
    }

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, 14).unwrap()
    }

    #[test]
    fn deep_history_uses_same_session_pagination() {
        let mut session = FakeSession::default();
        let result = super::fetch_native_bars(
            &mut session,
            &query(SymbolKind::Stock, Resolution::Day, Adjustment::None, 1_700),
            super::period_for(Resolution::Day),
            1_700,
        )
        .unwrap();
        assert_eq!(result.len(), 1_700);
        assert_eq!(
            session.calls,
            [
                "security_bars 0 800",
                "security_bars 800 800",
                "security_bars 1600 100"
            ]
        );
    }

    #[test]
    fn short_page_stops_pagination() {
        let mut session = FakeSession::default();
        session
            .responses
            .push_back(Box::new(vec![raw(11, 0.0), raw(12, 0.0)]));
        let data = load_history(
            &mut session,
            &query(SymbolKind::Stock, Resolution::Day, Adjustment::None, 300),
            today(),
        )
        .unwrap();
        assert_eq!(session.calls, ["security_bars 0 300"]);
        assert_eq!(data.bars.len(), 2);
    }

    #[test]
    fn quote_failure_keeps_valid_history_bars() {
        let mut session = FakeSession::default();
        session.quote_error = true;
        session
            .responses
            .push_back(Box::new(vec![raw(11, 0.0), raw(12, 0.0)]));
        let mut query = query(SymbolKind::Stock, Resolution::Day, Adjustment::None, 2);
        query.include_quote = true;

        let data = load_history(&mut session, &query, today()).unwrap();

        assert_eq!(session.calls, ["security_bars 0 2", "quotes"]);
        assert_eq!(data.bars.len(), 2);
        assert!(data.quote.is_none());
    }

    #[test]
    fn matching_tdx_quote_identity_is_attached_after_raw_validation() {
        let mut session = FakeSession::default();
        session
            .responses
            .push_back(Box::new(vec![raw(11, 0.0), raw(12, 0.0)]));
        session
            .responses
            .push_back(Box::new(vec![quote_with_identity(
                Market::Shanghai,
                "600000",
            )]));
        let mut query = query(SymbolKind::Stock, Resolution::Day, Adjustment::None, 2);
        query.include_quote = true;

        let data = load_history(&mut session, &query, today()).unwrap();

        assert_eq!(session.calls, ["security_bars 0 2", "quotes"]);
        assert_eq!(data.bars.len(), 2);
        let quote = data
            .quote
            .expect("matching raw identity must be attachable");
        assert_eq!((quote.last, quote.previous_close), (10.5, 10.0));
        assert!(quote.is_valid());
    }

    #[test]
    fn mismatched_tdx_quote_identity_is_dropped_without_discarding_history() {
        for (label, quote) in [
            ("market", quote_with_identity(Market::Shenzhen, "600000")),
            ("code", quote_with_identity(Market::Shanghai, "600001")),
        ] {
            let mut session = FakeSession::default();
            session
                .responses
                .push_back(Box::new(vec![raw(11, 0.0), raw(12, 0.0)]));
            session.responses.push_back(Box::new(vec![quote]));
            let mut query = query(SymbolKind::Stock, Resolution::Day, Adjustment::None, 2);
            query.include_quote = true;

            let data = load_history(&mut session, &query, today()).unwrap();

            assert_eq!(session.calls, ["security_bars 0 2", "quotes"], "{label}");
            assert_eq!(data.bars.len(), 2, "{label}: history must remain usable");
            assert!(
                data.quote.is_none(),
                "{label}: wrong raw identity must not reach the UI as a quote"
            );
        }
    }

    #[test]
    fn pre_open_zero_quote_keeps_history_and_is_unavailable_as_independent_quote() {
        let mut session = FakeSession::default();
        session
            .responses
            .push_back(Box::new(vec![raw(11, 0.0), raw(12, 0.0)]));
        session
            .responses
            .push_back(Box::new(vec![pre_open_zero_quote()]));
        let mut query = query(SymbolKind::Stock, Resolution::Day, Adjustment::None, 2);
        query.include_quote = true;

        let data = load_history(&mut session, &query, today()).unwrap();

        assert_eq!(session.calls, ["security_bars 0 2", "quotes"]);
        assert_eq!(data.bars.len(), 2, "invalid quote must not discard history");
        assert!(
            data.bars.windows(2).all(|bars| bars[0].time < bars[1].time),
            "history bars must remain ascending"
        );

        let source_quote = data.quote.expect("fake TDX session returned a quote");
        assert_eq!(
            (
                source_quote.last,
                source_quote.previous_close,
                source_quote.open,
                source_quote.high,
                source_quote.low,
                source_quote.volume,
                source_quote.amount,
            ),
            (0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            "fixture must represent a pre-open zero quote with a valid previous close"
        );
        assert!(!source_quote.is_valid());

        let history_quote = Some(source_quote.clone()).filter(|quote| quote.is_valid());
        assert!(
            history_quote.is_none(),
            "pre-open zero quote must degrade attached history quote to None"
        );

        let independent_quote = source_quote.is_valid().then_some(()).ok_or_else(|| {
            crate::contracts::AppError::new("market_data_unavailable", "quote response was invalid")
        });
        assert_eq!(
            independent_quote.unwrap_err().code,
            "market_data_unavailable",
            "independent quote must remain strict when pre-open data is unavailable"
        );
    }

    #[test]
    fn index_and_security_use_distinct_commands() {
        let mut session = FakeSession::default();
        session
            .responses
            .push_back(Box::new(Vec::<crate::tdx::standard::IndexBar>::new()));
        let error = load_history(
            &mut session,
            &query(SymbolKind::Index, Resolution::Day, Adjustment::None, 10),
            today(),
        )
        .unwrap_err();
        assert_eq!(session.calls, ["index_bars"]);
        assert_eq!(error, "empty 1D response");
    }

    #[test]
    fn normalize_returns_ascending_bars_with_share_volume() {
        let raw = [raw(12, 0.2), raw(11, 0.0)];
        let bars = normalize(&raw, Resolution::Day).unwrap();
        assert_eq!(
            bars.iter().map(|bar| bar.time).collect::<Vec<_>>(),
            [1_789_110_000, 1_789_196_400]
        );
        assert_eq!(bars[0].volume, 100.0);
        assert_eq!(bars[1].amount, Some(10.0));
        assert_eq!(normalize(&raw, Resolution::Minute5).unwrap()[0].volume, 1.0);
    }

    #[test]
    fn index_ohlc_repair_preserves_rows_and_bounds_bodies() {
        let mut bars = vec![
            Bar::new(1, 109.36, 110.12, 109.31, 109.29, 1.0, None),
            Bar::new(2, 1171.75, 1135.6, 1164.24, 1166.7, 1.0, None),
            Bar::new(3, 10.0, 11.0, 9.0, 10.5, 1.0, None),
        ];
        let repairs = repair_index_ohlc_envelopes(&mut bars);
        assert_eq!(
            bars.len(),
            3,
            "repair must not drop historical trading days"
        );
        assert_eq!(
            repairs,
            Repairs {
                ohlc_envelope: 2,
                first_time: Some(1),
                last_time: Some(2),
                non_positive_adjusted_bars: 0
            }
        );
        assert_eq!(bars[0].low, 109.29);
        assert_eq!((bars[1].high, bars[1].low), (1171.75, 1164.24));
        assert_eq!(bars[2].high, 11.0);
    }

    #[test]
    fn raw_source_prices_must_be_positive_and_ascending() {
        let negative = [Bar::new(1, -0.2, -0.1, -0.5, -0.3, 1.0, None)];
        assert_eq!(
            validate_source_bars(&negative).unwrap_err(),
            "invalid source bar at 1"
        );
        let duplicate = [flat(5, 1.0, 1.0), flat(5, 1.0, 1.0)];
        assert!(validate_source_bars(&duplicate).is_err());
    }

    fn dividend(year: u16, month: u8, day: u8, cash: f64, bonus: f64) -> XdxrEntry {
        XdxrEntry {
            date: TdxDate { year, month, day },
            category: 1,
            detail: XdxrDetail::Dividend {
                cash,
                rights_price: 0.0,
                bonus_shares: bonus,
                rights_shares: 0.0,
            },
        }
    }

    fn consolidation(year: u16, month: u8, day: u8, ratio: f64) -> XdxrEntry {
        XdxrEntry {
            date: TdxDate { year, month, day },
            category: 11,
            detail: XdxrDetail::Consolidation { ratio },
        }
    }

    #[test]
    fn qfq_applies_all_past_share_events_and_ignores_future_ones() {
        let entries = [
            consolidation(2026, 2, 3, 3.0),
            consolidation(2026, 7, 6, 2.0),
            consolidation(2026, 12, 1, 5.0),
            XdxrEntry {
                date: TdxDate {
                    year: 2026,
                    month: 3,
                    day: 1,
                },
                category: 5,
                detail: XdxrDetail::ShareChange {
                    float_before: 1.0,
                    total_before: 1.0,
                    float_after: 2.0,
                    total_after: 2.0,
                },
            },
        ];
        let events = qfq_events(&entries, today());
        assert_eq!(
            events,
            [
                QfqEvent {
                    time: ts(2026, 2, 3, 0),
                    ratio: 3.0,
                    adjustment: 0.0
                },
                QfqEvent {
                    time: ts(2026, 7, 6, 0),
                    ratio: 2.0,
                    adjustment: 0.0
                },
            ]
        );
        let bars = vec![
            flat(ts(2026, 2, 2, 15), 3.16, 1.0),
            flat(ts(2026, 7, 3, 15), 1.579, 1.0),
        ];
        let adjusted = apply_qfq(bars, &events);
        assert!((adjusted[0].close - 3.16 / 6.0).abs() < 1e-9);
        assert!((adjusted[1].close - 1.579 / 2.0).abs() < 1e-9);
    }

    #[test]
    fn qfq_cash_dividend_and_weekly_aggregation() {
        let events = qfq_events(&[dividend(2026, 9, 10, 10.0, 0.0)], today());
        let bars = vec![
            Bar::new(ts(2026, 9, 9, 15), 10.0, 11.0, 9.0, 10.0, 100.0, Some(1.0)),
            Bar::new(ts(2026, 9, 10, 15), 9.0, 10.0, 8.0, 9.0, 200.0, Some(2.0)),
        ];
        let weekly = aggregate_bars(apply_qfq(bars, &events), Resolution::Week);
        assert_eq!(weekly.len(), 1);
        assert_eq!(
            (weekly[0].open, weekly[0].close, weekly[0].volume),
            (9.0, 9.0, 300.0)
        );
        assert_eq!((weekly[0].high, weekly[0].low), (10.0, 8.0));
        assert_eq!(
            (weekly[0].time, weekly[0].amount),
            (ts(2026, 9, 10, 15), Some(3.0))
        );
    }

    #[test]
    fn monthly_aggregation_splits_months_and_drops_partial_amounts() {
        let bars = vec![
            Bar::new(ts(2026, 8, 31, 15), 1.0, 1.0, 1.0, 1.0, 1.0, Some(1.0)),
            Bar::new(ts(2026, 9, 1, 15), 2.0, 2.0, 2.0, 2.0, 1.0, Some(1.0)),
            Bar::new(ts(2026, 9, 2, 15), 3.0, 3.0, 3.0, 3.0, 1.0, None),
            Bar::new(ts(2026, 9, 3, 15), 4.0, 4.0, 4.0, 4.0, 1.0, Some(1.0)),
        ];
        let monthly = aggregate_bars(bars, Resolution::Month);
        assert_eq!(monthly.len(), 2);
        assert_eq!(monthly[1].amount, None);
        assert_eq!(
            (monthly[1].open, monthly[1].close, monthly[1].volume),
            (2.0, 4.0, 3.0)
        );
    }

    #[test]
    fn adjusted_weekly_history_is_built_from_daily_bars_and_trimmed() {
        let mut session = FakeSession::default();
        session
            .responses
            .push_back(Box::new(vec![raw(7, 0.0), raw(8, 0.0), raw(14, 0.0)]));
        session
            .responses
            .push_back(Box::new(vec![dividend(2026, 9, 14, 5.0, 0.0)]));
        let mut weekly = query(SymbolKind::Stock, Resolution::Week, Adjustment::Qfq, 1);
        weekly.include_quote = false;
        let data = load_history(&mut session, &weekly, today()).unwrap();
        assert_eq!(session.calls, ["security_bars 0 66", "xdxr"]);
        assert_eq!(data.bars.len(), 1);
        assert_eq!(data.bars[0].time, ts(2026, 9, 14, 15));
        assert_eq!(data.repairs.non_positive_adjusted_bars, 0);
    }
}
