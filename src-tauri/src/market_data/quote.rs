#[cfg(tradeflow_tdx)]
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[cfg(tradeflow_tdx)]
use crate::contracts::SymbolKind;
#[cfg(tradeflow_tdx)]
use tradeflow_tdx::standard::SecurityQuote;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteBookLevel {
    pub price: f64,
    pub quantity: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteSnapshot {
    pub last: f64,
    pub previous_close: f64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub volume: f64,
    pub amount: f64,
    pub received_at: u64,
    #[serde(default)]
    pub bids: Vec<QuoteBookLevel>,
    #[serde(default)]
    pub asks: Vec<QuoteBookLevel>,
}

impl QuoteSnapshot {
    #[cfg(tradeflow_tdx)]
    pub(crate) fn from_tdx(quote: &SecurityQuote, kind: &SymbolKind) -> Self {
        // ETF 报价精确到厘，与其三位小数的历史 K 线保持一致；股票和指数精确到分。
        let divisor = if *kind == SymbolKind::Etf {
            1000.0
        } else {
            100.0
        };
        let price = |raw: i64| raw as f64 / divisor;
        let levels = |rows: &[tradeflow_tdx::standard::BookLevel; 5], ascending| {
            if !matches!(kind, SymbolKind::Stock | SymbolKind::Etf) {
                return Vec::new();
            }
            let levels = rows
                .iter()
                .filter(|level| level.price > 0 && level.volume > 0)
                .map(|level| QuoteBookLevel {
                    price: price(level.price),
                    quantity: level.volume as f64,
                })
                .collect::<Vec<_>>();
            if valid_book_side(&levels, ascending) {
                levels
            } else {
                Vec::new()
            }
        };
        Self {
            last: price(quote.price),
            previous_close: price(quote.previous_close),
            open: price(quote.open),
            high: price(quote.high),
            low: price(quote.low),
            volume: quote.volume as f64,
            amount: quote.amount,
            received_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|elapsed| elapsed.as_secs())
                .unwrap_or_default(),
            bids: levels(&quote.bids, false),
            asks: levels(&quote.asks, true),
        }
    }

    pub fn is_valid(&self) -> bool {
        [
            self.last,
            self.previous_close,
            self.open,
            self.high,
            self.low,
            self.volume,
            self.amount,
        ]
        .into_iter()
        .all(f64::is_finite)
            && self.last > 0.0
            && self.previous_close > 0.0
            && self.open >= 0.0
            && self.high >= 0.0
            && self.low >= 0.0
            && self.volume >= 0.0
            && self.amount >= 0.0
            && self.received_at > 0
            && (self.high == 0.0 || self.low == 0.0 || self.high >= self.low)
            && valid_book_side(&self.bids, false)
            && valid_book_side(&self.asks, true)
    }
}

fn valid_book_side(levels: &[QuoteBookLevel], ascending: bool) -> bool {
    levels.len() <= 5
        && levels.iter().all(|level| {
            level.price.is_finite()
                && level.quantity.is_finite()
                && level.price > 0.0
                && level.quantity >= 0.0
        })
        && levels.windows(2).all(|rows| {
            if ascending {
                rows[0].price < rows[1].price
            } else {
                rows[0].price > rows[1].price
            }
        })
}

#[cfg(all(test, tradeflow_tdx))]
mod tests {
    use super::{QuoteBookLevel, QuoteSnapshot};
    use crate::contracts::SymbolKind;
    use tradeflow_tdx::SecurityCode;
    use tradeflow_tdx::standard::{BookLevel, SecurityQuote};

    fn tdx_quote() -> SecurityQuote {
        SecurityQuote {
            market: 1,
            code: SecurityCode::new("510050").unwrap(),
            active1: 0,
            price: 3037,
            previous_close: 3043,
            open: 3048,
            high: 3067,
            low: 3034,
            server_time: 0,
            unknown_1: 0,
            volume: 100,
            current_volume: 0,
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

    #[test]
    fn etf_quote_price_units_match_three_decimal_history() {
        let mut raw = tdx_quote();
        raw.bids[0] = BookLevel {
            price: 3036,
            volume: 10,
        };
        raw.bids[1] = BookLevel {
            price: 3035,
            volume: 11,
        };
        raw.asks[0] = BookLevel {
            price: 3038,
            volume: 20,
        };
        raw.asks[1] = BookLevel {
            price: 3039,
            volume: 21,
        };
        let etf = QuoteSnapshot::from_tdx(&raw, &SymbolKind::Etf);
        assert_eq!((etf.last, etf.previous_close), (3.037, 3.043));
        assert_eq!(
            etf.bids,
            vec![
                QuoteBookLevel {
                    price: 3.036,
                    quantity: 10.0
                },
                QuoteBookLevel {
                    price: 3.035,
                    quantity: 11.0
                },
            ]
        );
        assert_eq!(
            etf.asks[0],
            QuoteBookLevel {
                price: 3.038,
                quantity: 20.0
            }
        );
        let stock = QuoteSnapshot::from_tdx(&raw, &SymbolKind::Stock);
        assert_eq!(
            (stock.last, stock.volume, stock.amount),
            (30.37, 100.0, 1_000.0)
        );
        assert_eq!(stock.bids[0].price, 30.36);
        let index = QuoteSnapshot::from_tdx(&raw, &SymbolKind::Index);
        assert!(index.bids.is_empty() && index.asks.is_empty());
        assert!(stock.received_at > 0);
    }

    #[test]
    fn malformed_quote_is_rejected_without_rejecting_history() {
        let valid = QuoteSnapshot {
            last: 10.2,
            previous_close: 10.0,
            open: 10.1,
            high: 10.3,
            low: 9.9,
            volume: 100.0,
            amount: 1_000.0,
            received_at: 1_789_196_400,
            bids: vec![QuoteBookLevel {
                price: 10.1,
                quantity: 20.0,
            }],
            asks: vec![QuoteBookLevel {
                price: 10.2,
                quantity: 30.0,
            }],
        };
        assert!(valid.is_valid());
        assert!(
            !QuoteSnapshot {
                last: 0.0,
                ..valid.clone()
            }
            .is_valid()
        );
        assert!(!QuoteSnapshot { high: 9.8, ..valid }.is_valid());
    }

    #[test]
    fn malformed_order_book_is_rejected_without_reordering_levels() {
        let quote = QuoteSnapshot {
            last: 10.2,
            previous_close: 10.0,
            open: 10.1,
            high: 10.3,
            low: 9.9,
            volume: 100.0,
            amount: 1_000.0,
            received_at: 1_789_196_400,
            bids: vec![
                QuoteBookLevel {
                    price: 10.1,
                    quantity: 20.0,
                },
                QuoteBookLevel {
                    price: 10.0,
                    quantity: 30.0,
                },
            ],
            asks: vec![
                QuoteBookLevel {
                    price: 10.2,
                    quantity: 20.0,
                },
                QuoteBookLevel {
                    price: 10.3,
                    quantity: 30.0,
                },
            ],
        };
        assert!(quote.is_valid());
        assert!(
            !QuoteSnapshot {
                bids: vec![
                    QuoteBookLevel {
                        price: 10.0,
                        quantity: 20.0
                    },
                    QuoteBookLevel {
                        price: 10.1,
                        quantity: 30.0
                    },
                ],
                ..quote
            }
            .is_valid()
        );
    }
}
