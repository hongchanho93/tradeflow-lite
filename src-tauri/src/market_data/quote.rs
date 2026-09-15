use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::contracts::SymbolKind;
use crate::tdx::standard::SecurityQuote;

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
}

impl QuoteSnapshot {
    pub(crate) fn from_tdx(quote: &SecurityQuote, kind: &SymbolKind) -> Self {
        // ETF 报价精确到厘，与其三位小数的历史 K 线保持一致；股票和指数精确到分。
        let divisor = if *kind == SymbolKind::Etf {
            1000.0
        } else {
            100.0
        };
        let price = |raw: i64| raw as f64 / divisor;
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
    }
}

#[cfg(test)]
mod tests {
    use super::QuoteSnapshot;
    use crate::contracts::SymbolKind;
    use crate::tdx::SecurityCode;
    use crate::tdx::standard::{BookLevel, SecurityQuote};

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
        let etf = QuoteSnapshot::from_tdx(&tdx_quote(), &SymbolKind::Etf);
        assert_eq!((etf.last, etf.previous_close), (3.037, 3.043));
        let stock = QuoteSnapshot::from_tdx(&tdx_quote(), &SymbolKind::Stock);
        assert_eq!(
            (stock.last, stock.volume, stock.amount),
            (30.37, 100.0, 1_000.0)
        );
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
}
