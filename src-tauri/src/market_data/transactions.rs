use chrono::NaiveDate;
use serde::Serialize;

use super::clock;
use crate::contracts::SymbolKind;
use tradeflow_tdx::standard::Transaction;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentTrade {
    pub trade_id: u64,
    pub trade_time_ms: i64,
    pub price: f64,
    pub quantity: f64,
    pub transaction_count: i64,
    pub side: Option<&'static str>,
}

pub(crate) fn normalize(
    rows: Vec<Transaction>,
    kind: &SymbolKind,
    date: NaiveDate,
) -> Vec<RecentTrade> {
    let divisor = if *kind == SymbolKind::Etf {
        1000.0
    } else {
        100.0
    };
    rows.into_iter()
        .enumerate()
        .filter_map(|(index, row)| {
            let hour = u32::from(row.minute / 60);
            let minute = u32::from(row.minute % 60);
            let trade_time_ms = clock::shanghai_timestamp(date, hour, minute)? * 1_000;
            Some(RecentTrade {
                trade_id: u64::try_from(trade_time_ms).unwrap_or_default() * 1_000
                    + u64::try_from(index).unwrap_or_default(),
                trade_time_ms,
                price: row.price as f64 / divisor,
                quantity: row.volume as f64,
                transaction_count: row.transaction_count,
                side: match row.buy_or_sell {
                    0 => Some("buy"),
                    1 => Some("sell"),
                    _ => None,
                },
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::normalize;
    use crate::contracts::SymbolKind;
    use tradeflow_tdx::standard::Transaction;

    #[test]
    fn normalizes_protocol_minutes_prices_and_sides_without_inventing_seconds() {
        let date = NaiveDate::from_ymd_opt(2026, 9, 16).unwrap();
        let rows = normalize(
            vec![
                Transaction {
                    minute: 652,
                    price: 902,
                    volume: 16,
                    transaction_count: 3,
                    buy_or_sell: 1,
                    unknown: 0,
                },
                Transaction {
                    minute: 652,
                    price: 903,
                    volume: 40,
                    transaction_count: 1,
                    buy_or_sell: 0,
                    unknown: 0,
                },
            ],
            &SymbolKind::Stock,
            date,
        );
        assert_eq!(rows.len(), 2);
        assert_eq!(
            (rows[0].price, rows[0].quantity, rows[0].side),
            (9.02, 16.0, Some("sell"))
        );
        assert_eq!(rows[0].trade_time_ms, rows[1].trade_time_ms);
        assert_eq!(rows[1].price, 9.03);
    }
}
