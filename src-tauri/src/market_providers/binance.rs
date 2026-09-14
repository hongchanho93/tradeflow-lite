use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tradeflow_binance_market_data::{Client, Interval, Kline};

use crate::contracts::{
    Adjustment, AppError, Bar, BinanceSpotSymbol, BinanceUsdMarginedSymbol, Resolution,
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
    spot_client()?
        .fetch_spot_symbols()
        .map_err(map_error)
        .map(|symbols| {
            symbols
                .into_iter()
                .map(|symbol| BinanceSpotSymbol {
                    symbol: symbol.symbol,
                    base_asset: symbol.base_asset,
                    quote_asset: symbol.quote_asset,
                })
                .collect()
        })
}

pub(crate) fn list_usd_margined_symbols() -> Result<Vec<BinanceUsdMarginedSymbol>, AppError> {
    usd_margined_client()?
        .fetch_usd_margined_perpetual_symbols()
        .map_err(map_error)
        .map(|symbols| {
            symbols
                .into_iter()
                .map(|symbol| BinanceUsdMarginedSymbol {
                    symbol: symbol.symbol,
                    base_asset: symbol.base_asset,
                    quote_asset: symbol.quote_asset,
                })
                .collect()
        })
}

impl MarketDataAdapter for BinanceSpotAdapter {
    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        fetch_binance_history(
            request,
            spot_client()?,
            SPOT_SOURCE,
            SPOT_HOST,
            "数字货币现货",
        )
    }
}

impl MarketDataAdapter for BinanceUsdMarginedAdapter {
    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        fetch_binance_history(
            request,
            usd_margined_client()?,
            USDM_SOURCE,
            USDM_HOST,
            "U 本位永续合约",
        )
    }
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
        .fetch_klines(code, interval_for(request.resolution), request.count)
        .map_err(map_error)?;
    let bars = klines
        .into_iter()
        .map(|kline| bar_from_kline(&kline))
        .collect::<Result<Vec<_>, AppError>>()?;
    Bar::validate_series(&bars)?;
    let quote = if request.include_quote {
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
        };
        if !quote.is_valid() {
            return Err(AppError::new(
                "invalid_market_data",
                "币安返回的 24 小时行情不合法",
            ));
        }
        Some(quote)
    } else {
        None
    };
    Ok(HistoryResponse {
        symbol: request.symbol,
        bars,
        diagnostics: HistoryDiagnostics {
            source,
            host: host.to_string(),
            latency_ms: started_at.elapsed().as_secs_f64() * 1000.0,
        },
        quote,
    })
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
    Bar::validate_series(std::slice::from_ref(&bar))?;
    Ok(bar)
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
    use super::interval_for;
    use crate::contracts::{Adjustment, Resolution, Symbol, SymbolKind};
    use crate::market_router::{HistoryRequest, fetch_history};
    use tradeflow_binance_market_data::Interval;

    #[test]
    fn maps_every_lite_resolution_to_binance_spot() {
        assert_eq!(interval_for(Resolution::Minute1), Interval::Minute1);
        assert_eq!(interval_for(Resolution::Minute5), Interval::Minute5);
        assert_eq!(interval_for(Resolution::Minute15), Interval::Minute15);
        assert_eq!(interval_for(Resolution::Minute30), Interval::Minute30);
        assert_eq!(interval_for(Resolution::Minute60), Interval::Hour1);
        assert_eq!(interval_for(Resolution::Day), Interval::Day1);
        assert_eq!(interval_for(Resolution::Week), Interval::Week1);
        assert_eq!(interval_for(Resolution::Month), Interval::Month1);
    }

    #[test]
    #[ignore = "connects to Binance Spot public market data"]
    fn binance_spot_real_market() {
        for (code, resolution) in [
            ("BTCUSDT", Resolution::Minute1),
            ("ETHUSDT", Resolution::Day),
            ("SOLUSDT", Resolution::Month),
        ] {
            let response = fetch_history(HistoryRequest {
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
