use serde::Serialize;

use crate::contracts::{Adjustment, AppError, Resolution, Symbol, SymbolKind};
use crate::market_data::{self, HistoryResponse};
#[cfg(feature = "provider-binance")]
use crate::market_providers::binance::{BinanceSpotAdapter, BinanceUsdMarginedAdapter};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MarketDataSource {
    Tdx,
    BinanceSpot,
    BinanceUsdMargined,
}

impl MarketDataSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Tdx => "tdx",
            Self::BinanceSpot => "binance_spot",
            Self::BinanceUsdMargined => "binance_usdm",
        }
    }
}

pub struct HistoryRequest {
    pub symbol: Symbol,
    pub kind: SymbolKind,
    pub resolution: Resolution,
    pub adjustment: Adjustment,
    pub count: usize,
    pub include_quote: bool,
}

struct SourceRule {
    venues: &'static [&'static str],
    kinds: &'static [SymbolKind],
    source: MarketDataSource,
}

const SOURCE_RULES: &[SourceRule] = &[
    SourceRule {
        venues: &["SH", "SZ", "BJ"],
        kinds: &[SymbolKind::Stock, SymbolKind::Etf, SymbolKind::Index],
        source: MarketDataSource::Tdx,
    },
    SourceRule {
        venues: &["BINANCE"],
        kinds: &[SymbolKind::Crypto],
        source: MarketDataSource::BinanceSpot,
    },
    SourceRule {
        venues: &["BINANCE_USDM"],
        kinds: &[SymbolKind::Crypto],
        source: MarketDataSource::BinanceUsdMargined,
    },
];

fn resolve_source(symbol: &Symbol, kind: &SymbolKind) -> Result<MarketDataSource, AppError> {
    let (venue, _) = symbol.parts();
    SOURCE_RULES
        .iter()
        .find(|rule| rule.venues.contains(&venue) && rule.kinds.contains(kind))
        .map(|rule| rule.source)
        .ok_or_else(|| {
            AppError::new(
                "instrument_route_not_found",
                format!("品种类型 {} 与市场 {venue} 不匹配", kind.as_str()),
            )
        })
}

pub(crate) trait MarketDataAdapter {
    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError>;
}

struct TdxAdapter;

impl MarketDataAdapter for TdxAdapter {
    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        market_data::fetch_history_bars(
            request.symbol,
            request.kind,
            request.resolution,
            request.adjustment,
            request.count,
            request.include_quote,
        )
    }
}

#[cfg(not(feature = "provider-binance"))]
struct BinanceSpotAdapter;

#[cfg(not(feature = "provider-binance"))]
impl MarketDataAdapter for BinanceSpotAdapter {
    fn fetch_history(&self, _request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        Err(AppError::new(
            "market_data_source_unavailable",
            "Binance 行情适配器尚未接通",
        ))
    }
}

#[cfg(not(feature = "provider-binance"))]
struct BinanceUsdMarginedAdapter;

#[cfg(not(feature = "provider-binance"))]
impl MarketDataAdapter for BinanceUsdMarginedAdapter {
    fn fetch_history(&self, _request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        Err(AppError::new(
            "market_data_source_unavailable",
            "Binance U 本位行情适配器尚未接通",
        ))
    }
}

static TDX_ADAPTER: TdxAdapter = TdxAdapter;
static BINANCE_SPOT_ADAPTER: BinanceSpotAdapter = BinanceSpotAdapter;
static BINANCE_USDM_ADAPTER: BinanceUsdMarginedAdapter = BinanceUsdMarginedAdapter;

fn adapter_for(source: MarketDataSource) -> &'static dyn MarketDataAdapter {
    match source {
        MarketDataSource::Tdx => &TDX_ADAPTER,
        MarketDataSource::BinanceSpot => &BINANCE_SPOT_ADAPTER,
        MarketDataSource::BinanceUsdMargined => &BINANCE_USDM_ADAPTER,
    }
}

pub fn fetch_history(request: HistoryRequest) -> Result<HistoryResponse, AppError> {
    let source = resolve_source(&request.symbol, &request.kind)?;
    eprintln!(
        "market.router.selected symbol={}:{} kind={} source={}",
        request.symbol.parts().0,
        request.symbol.parts().1,
        request.kind.as_str(),
        source.as_str()
    );
    adapter_for(source).fetch_history(request)
}

#[cfg(test)]
mod tests {
    #[cfg(not(feature = "provider-binance"))]
    use super::{HistoryRequest, fetch_history};
    use super::{MarketDataSource, resolve_source};
    #[cfg(not(feature = "provider-binance"))]
    use crate::contracts::{Adjustment, Resolution};
    use crate::contracts::{Symbol, SymbolKind};

    #[test]
    fn routes_a_share_instruments_to_tdx() {
        let symbol = Symbol::new("SH", "600000").unwrap();
        assert_eq!(
            resolve_source(&symbol, &SymbolKind::Stock).unwrap(),
            MarketDataSource::Tdx
        );
    }

    #[test]
    fn routes_crypto_instruments_to_binance() {
        let symbol = Symbol::new("BINANCE", "BTCUSDT").unwrap();
        assert_eq!(
            resolve_source(&symbol, &SymbolKind::Crypto).unwrap(),
            MarketDataSource::BinanceSpot
        );
    }

    #[test]
    fn routes_usd_margined_perpetuals_to_their_own_binance_adapter() {
        let symbol = Symbol::new("BINANCE_USDM", "BTCUSDT").unwrap();
        assert_eq!(
            resolve_source(&symbol, &SymbolKind::Crypto).unwrap(),
            MarketDataSource::BinanceUsdMargined
        );
    }

    #[cfg(not(feature = "provider-binance"))]
    #[test]
    fn disabled_binance_provider_does_not_fall_through_to_tdx() {
        let symbol = Symbol::new("BINANCE", "BTCUSDT").unwrap();
        let error = fetch_history(HistoryRequest {
            symbol,
            kind: SymbolKind::Crypto,
            resolution: Resolution::Minute1,
            adjustment: Adjustment::None,
            count: 300,
            include_quote: true,
        })
        .unwrap_err();
        assert_eq!(error.code, "market_data_source_unavailable");
        assert!(error.message.contains("Binance"));
    }

    #[test]
    fn rejects_a_kind_that_does_not_belong_to_the_venue() {
        let symbol = Symbol::new("SH", "600000").unwrap();
        let error = resolve_source(&symbol, &SymbolKind::Crypto).unwrap_err();
        assert_eq!(error.code, "instrument_route_not_found");
    }
}
