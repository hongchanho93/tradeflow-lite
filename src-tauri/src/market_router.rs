use std::sync::OnceLock;

use crate::contracts::{Adjustment, AppError, Bar, MarketSeriesKind, Resolution};
use crate::market_adapter::{HistoryResponse, QuoteAdapter, TDX_PROVIDER_DESCRIPTOR};
use crate::market_data;
#[cfg(feature = "provider-binance")]
use crate::market_providers::binance::{BinanceSpotAdapter, BinanceUsdMarginedAdapter};
#[cfg(feature = "provider-okx")]
use crate::market_providers::okx::{OkxSpotAdapter, OkxSwapAdapter};
#[cfg(feature = "provider-polymarket")]
use crate::market_providers::polymarket::PolymarketAdapter;

pub use crate::market_adapter::{
    AdapterRegistration, AdapterRegistry, CatalogAdapter, CatalogPage, CatalogPageRequest,
    CatalogRequest, CatalogSymbol, HistoryRequest, MarketDataAdapter, MarketDataSnapshot,
    PredictionMarketMetadata, ProviderCapabilities, ProviderDescriptor, QuoteRequest,
    QuoteResponse, QuoteSnapshot, RealtimeAdapter, RealtimeEventEnvelope, RealtimePayload,
    RealtimePriceLevel, RealtimeRequest, RealtimeSink,
};

struct TdxAdapter;

impl QuoteAdapter for TdxAdapter {
    fn fetch_quote(&self, request: QuoteRequest) -> Result<QuoteResponse, AppError> {
        let symbol = request.symbol.clone();
        let quote = market_data::fetch_quote_snapshot(request.symbol, request.kind)?;
        Ok(QuoteResponse {
            provider_id: TDX_PROVIDER_DESCRIPTOR.id.to_string(),
            symbol,
            source: "tradeflow-tdx".to_string(),
            quote,
        })
    }
}

impl MarketDataAdapter for TdxAdapter {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        &TDX_PROVIDER_DESCRIPTOR
    }

    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        market_data::fetch_history_bars_raw(
            request.symbol,
            request.kind,
            request.resolution,
            request.adjustment,
            request.count,
            request.include_quote,
        )
    }

    fn quote_adapter(&self) -> Option<&dyn QuoteAdapter> {
        Some(self)
    }
}

#[cfg(not(feature = "provider-binance"))]
struct BinanceSpotAdapter;

#[cfg(not(feature = "provider-binance"))]
impl MarketDataAdapter for BinanceSpotAdapter {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        &crate::market_adapter::BINANCE_SPOT_DISABLED_DESCRIPTOR
    }

    fn history_available(&self) -> bool {
        false
    }

    fn fetch_history(&self, _request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        Err(AppError::new(
            "market_data_source_unavailable",
            "Binance 现货行情适配器未启用",
        ))
    }
}

#[cfg(not(feature = "provider-binance"))]
struct BinanceUsdMarginedAdapter;

#[cfg(not(feature = "provider-binance"))]
impl MarketDataAdapter for BinanceUsdMarginedAdapter {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        &crate::market_adapter::BINANCE_USDM_DISABLED_DESCRIPTOR
    }

    fn history_available(&self) -> bool {
        false
    }

    fn fetch_history(&self, _request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        Err(AppError::new(
            "market_data_source_unavailable",
            "Binance USD-M 行情适配器未启用",
        ))
    }
}

#[cfg(not(feature = "provider-okx"))]
struct OkxSpotAdapter;

#[cfg(not(feature = "provider-okx"))]
impl MarketDataAdapter for OkxSpotAdapter {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        &crate::market_adapter::OKX_SPOT_DISABLED_DESCRIPTOR
    }

    fn history_available(&self) -> bool {
        false
    }

    fn fetch_history(&self, _request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        Err(AppError::new(
            "market_data_source_unavailable",
            "OKX 现货行情适配器未启用",
        ))
    }
}

#[cfg(not(feature = "provider-okx"))]
struct OkxSwapAdapter;

#[cfg(not(feature = "provider-okx"))]
impl MarketDataAdapter for OkxSwapAdapter {
    fn descriptor(&self) -> &'static ProviderDescriptor {
        &crate::market_adapter::OKX_SWAP_DISABLED_DESCRIPTOR
    }

    fn history_available(&self) -> bool {
        false
    }

    fn fetch_history(&self, _request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        Err(AppError::new(
            "market_data_source_unavailable",
            "OKX 永续行情适配器未启用",
        ))
    }
}

static TDX_ADAPTER: TdxAdapter = TdxAdapter;
static BINANCE_SPOT_ADAPTER: BinanceSpotAdapter = BinanceSpotAdapter;
static BINANCE_USDM_ADAPTER: BinanceUsdMarginedAdapter = BinanceUsdMarginedAdapter;
static OKX_SPOT_ADAPTER: OkxSpotAdapter = OkxSpotAdapter;
static OKX_SWAP_ADAPTER: OkxSwapAdapter = OkxSwapAdapter;
#[cfg(feature = "provider-polymarket")]
static POLYMARKET_ADAPTER: PolymarketAdapter = PolymarketAdapter;

/// 内置编译期注册点。第三方 provider 只需实现公开合同并把自己的 registration 加入
/// 一个 `AdapterRegistry`；Registry 会在安装时检查重复 id、重叠路由和能力漂移。
static REGISTERED_ADAPTERS: &[AdapterRegistration] = &[
    AdapterRegistration::new(&TDX_ADAPTER),
    AdapterRegistration::new(&BINANCE_SPOT_ADAPTER),
    AdapterRegistration::new(&BINANCE_USDM_ADAPTER),
    AdapterRegistration::new(&OKX_SPOT_ADAPTER),
    AdapterRegistration::new(&OKX_SWAP_ADAPTER),
    #[cfg(feature = "provider-polymarket")]
    AdapterRegistration::new(&POLYMARKET_ADAPTER),
];

/// 返回内置 provider 的可注入 Registry 副本。
///
/// 应用默认启动使用它；需要接入自定义静态 provider 的宿主可以把自己的
/// `AdapterRegistry` 交给 [`MarketRouter::new`]，再调用应用层的 `run_with_router`。
pub fn builtin_registry() -> Result<AdapterRegistry, AppError> {
    AdapterRegistry::new(REGISTERED_ADAPTERS.iter().copied())
}

fn builtin_registry_static() -> Result<&'static AdapterRegistry, AppError> {
    static REGISTRY: OnceLock<Result<AdapterRegistry, AppError>> = OnceLock::new();
    REGISTRY
        .get_or_init(|| AdapterRegistry::new(REGISTERED_ADAPTERS.iter().copied()))
        .as_ref()
        .map_err(Clone::clone)
}

pub fn provider_descriptors() -> Vec<ProviderDescriptor> {
    builtin_registry_static()
        .expect("built-in provider registry must be valid")
        .descriptors()
        .copied()
        .collect()
}

fn validate_history_capability(
    registration: AdapterRegistration,
    request: &HistoryRequest,
) -> Result<(), AppError> {
    let descriptor = registration.descriptor();
    let capabilities = &descriptor.capabilities;
    if !descriptor.enabled {
        return Err(AppError::new(
            "market_data_source_unavailable",
            format!("{} 行情适配器未启用", descriptor.display_name),
        ));
    }
    if !capabilities.history {
        return Err(AppError::new(
            "market_data_source_unavailable",
            format!("{} 行情适配器未启用", descriptor.display_name),
        ));
    }
    if !capabilities.resolutions.contains(&request.resolution) {
        return Err(AppError::new(
            "unsupported_resolution",
            format!(
                "{} 不支持 {} 周期",
                descriptor.display_name,
                request.resolution.as_str()
            ),
        ));
    }
    if !capabilities.adjustments.contains(&request.adjustment) {
        return Err(AppError::new(
            "unsupported_adjustment",
            format!(
                "{} 不支持 {} 复权",
                descriptor.display_name,
                request.adjustment.as_str()
            ),
        ));
    }
    // 历史是主结果；provider 没有 quote facet 或本次报价暂不可用时，允许以
    // `quote=None` 降级返回。独立 QuoteRequest 仍严格要求 quote 能力。
    Ok(())
}

fn validate_history_response(
    registration: AdapterRegistration,
    request: &HistoryRequest,
    response: &HistoryResponse,
) -> Result<(), AppError> {
    let descriptor = registration.descriptor();
    if response.symbol != request.symbol {
        return Err(AppError::new(
            "provider_contract_violation",
            format!("{} 返回了与请求不同的品种", descriptor.id),
        ));
    }
    let max_count = request.count.clamp(2, 12_000);
    match response.series_kind {
        MarketSeriesKind::Ohlcv => {
            if response.bars.is_empty() || !response.points.is_empty() {
                return Err(AppError::new(
                    "provider_contract_violation",
                    format!("{} 返回了不匹配的 OHLCV 数据", descriptor.id),
                ));
            }
            if response.bars.len() > max_count {
                return Err(AppError::new(
                    "provider_contract_violation",
                    format!("{} 返回的 K 线超过请求数量", descriptor.id),
                ));
            }
            match request.adjustment {
                Adjustment::None => Bar::validate_series(&response.bars)?,
                Adjustment::Qfq => Bar::validate_adjusted_series(&response.bars)?,
            }
        }
        MarketSeriesKind::Probability => {
            if request.kind != crate::contracts::SymbolKind::Prediction
                || !response.bars.is_empty()
                || response.points.is_empty()
                || response.points.len() > max_count
            {
                return Err(AppError::new(
                    "provider_contract_violation",
                    format!("{} 返回了不匹配的概率数据", descriptor.id),
                ));
            }
            crate::contracts::ProbabilityPoint::validate_series(&response.points)?;
        }
    }
    if !descriptor.accepts_diagnostics_source(response.diagnostics.source) {
        return Err(AppError::new(
            "provider_contract_violation",
            format!("{} 返回了不匹配的 source", descriptor.id),
        ));
    }
    if response.quote.is_some() && !descriptor.capabilities.quote {
        return Err(AppError::new(
            "provider_capability_mismatch",
            format!("{} 未声明 quote 能力却返回了行情快照", descriptor.id),
        ));
    }
    if let Some(quote) = response.quote.as_ref() {
        if !quote.is_valid() {
            return Err(AppError::new(
                "invalid_market_data",
                format!("{} 返回了不合法的行情快照", descriptor.id),
            ));
        }
    }
    Ok(())
}

/// 一个可注入的路由器。内置自由函数使用下面的静态实例；测试或编译进来的新 provider
/// 可以直接构造 `MarketRouter`，不需要复制路由规则。
pub struct MarketRouter {
    registry: AdapterRegistry,
}

impl MarketRouter {
    /// 构造默认宿主使用的内置路由器。外部宿主可改用 [`MarketRouter::new`] 注入自己的
    /// 静态 registration 集合，再交给应用层 `run_with_router`。
    pub fn builtin() -> Result<Self, AppError> {
        Self::new(REGISTERED_ADAPTERS.iter().copied())
    }

    pub fn new(
        registrations: impl IntoIterator<Item = AdapterRegistration>,
    ) -> Result<Self, AppError> {
        Ok(Self {
            registry: AdapterRegistry::new(registrations)?,
        })
    }

    pub fn from_registry(registry: AdapterRegistry) -> Self {
        Self { registry }
    }

    pub fn registry(&self) -> &AdapterRegistry {
        &self.registry
    }

    pub fn provider_descriptors(&self) -> Vec<ProviderDescriptor> {
        self.registry.descriptors().copied().collect()
    }

    pub fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
        let registration = self.registry.resolve_for_provider(
            &request.provider_id,
            &request.symbol,
            &request.kind,
        )?;
        validate_history_capability(registration, &request)?;
        let descriptor = registration.descriptor();
        eprintln!(
            "market.router.selected symbol={} kind={} provider={}",
            request.symbol.as_str(),
            request.kind.as_str(),
            descriptor.id
        );
        // 请求在路由检查后直接移动给 provider；没有 JSON 边界。
        let response = registration.adapter().fetch_history(request.clone())?;
        validate_history_response(registration, &request, &response)?;
        Ok(response)
    }

    pub fn list_catalog(&self, request: CatalogRequest) -> Result<Vec<CatalogSymbol>, AppError> {
        let registration = self
            .registry
            .resolve_catalog(&request.provider_id, &request.venue)?;
        let descriptor = registration.descriptor();
        if !descriptor.enabled {
            return Err(AppError::new(
                "market_data_source_unavailable",
                format!("{} 行情适配器未启用", descriptor.display_name),
            ));
        }
        let Some(catalog) = registration.catalog_adapter() else {
            return Err(AppError::new(
                "unsupported_capability",
                format!("{} 没有目录 facet", descriptor.display_name),
            ));
        };
        let venue = request.venue.clone();
        let symbols = catalog.list_symbols(request)?;
        validate_catalog_symbols(descriptor, &venue, &symbols)?;
        Ok(symbols)
    }

    pub fn list_catalog_page(&self, request: CatalogPageRequest) -> Result<CatalogPage, AppError> {
        let registration = self
            .registry
            .resolve_catalog(&request.provider_id, &request.venue)?;
        let descriptor = registration.descriptor();
        if !descriptor.enabled {
            return Err(AppError::new(
                "market_data_source_unavailable",
                format!("{} 行情适配器未启用", descriptor.display_name),
            ));
        }
        let Some(catalog) = registration.catalog_adapter() else {
            return Err(AppError::new(
                "unsupported_capability",
                format!("{} 没有目录 facet", descriptor.display_name),
            ));
        };
        let venue = request.venue.clone();
        let page = catalog.list_symbols_page(request)?;
        validate_catalog_symbols(descriptor, &venue, &page.symbols)?;
        Ok(page)
    }

    pub fn fetch_quote(&self, request: QuoteRequest) -> Result<QuoteResponse, AppError> {
        let registration = self.registry.resolve_for_provider(
            &request.provider_id,
            &request.symbol,
            &request.kind,
        )?;
        let descriptor = registration.descriptor();
        if !descriptor.enabled {
            return Err(AppError::new(
                "market_data_source_unavailable",
                format!("{} 行情适配器未启用", descriptor.display_name),
            ));
        }
        if !descriptor.capabilities.quote {
            return Err(AppError::new(
                "unsupported_capability",
                format!("{} 不提供行情快照", descriptor.display_name),
            ));
        }
        let Some(quote_adapter) = registration.quote_adapter() else {
            return Err(AppError::new(
                "provider_capability_mismatch",
                format!("{} 声明报价能力但没有 quote facet", descriptor.id),
            ));
        };
        let response = quote_adapter.fetch_quote(request.clone())?;
        if response.provider_id != descriptor.id || response.symbol != request.symbol {
            return Err(AppError::new(
                "provider_contract_violation",
                format!("{} 返回了不匹配的报价身份", descriptor.id),
            ));
        }
        if !descriptor.accepts_diagnostics_source(&response.source) {
            return Err(AppError::new(
                "provider_contract_violation",
                format!("{} 返回了不匹配的报价 source", descriptor.id),
            ));
        }
        if !response.quote.is_valid() {
            return Err(AppError::new(
                "invalid_market_data",
                format!("{} 返回了不合法的行情快照", descriptor.id),
            ));
        }
        Ok(response)
    }

    pub fn start_realtime(
        &self,
        request: RealtimeRequest,
        sink: std::sync::Arc<dyn RealtimeSink>,
    ) -> Result<(), AppError> {
        let registration = self.registry.resolve(&request.symbol, &request.kind)?;
        self.start_realtime_registration(registration, request, sink)
    }

    pub fn start_realtime_registration(
        &self,
        registration: AdapterRegistration,
        request: RealtimeRequest,
        sink: std::sync::Arc<dyn RealtimeSink>,
    ) -> Result<(), AppError> {
        validate_realtime_capability(registration, request.resolution)?;
        if registration.descriptor().id != request.provider_id {
            return Err(AppError::new(
                "provider_identity_mismatch",
                "实时请求的 provider identity 与路由结果不一致",
            ));
        }
        if !request.is_active() {
            return Ok(());
        }
        registration
            .realtime_adapter()
            .expect("realtime capability was validated")
            .replace_subscription(request, sink)
    }
}

fn validate_realtime_capability(
    registration: AdapterRegistration,
    resolution: Resolution,
) -> Result<(), AppError> {
    let descriptor = registration.descriptor();
    if !descriptor.enabled {
        return Err(AppError::new(
            "market_data_source_unavailable",
            format!("{} 行情适配器未启用", descriptor.display_name),
        ));
    }
    if !descriptor.capabilities.realtime || registration.realtime_adapter().is_none() {
        return Err(AppError::new(
            "unsupported_capability",
            format!("{} 没有可用的推送实时 facet", descriptor.display_name),
        ));
    }
    if !descriptor.capabilities.resolutions.contains(&resolution) {
        return Err(AppError::new(
            "unsupported_resolution",
            format!(
                "{} 不支持 {} 周期",
                descriptor.display_name,
                resolution.as_str()
            ),
        ));
    }
    Ok(())
}

fn validate_catalog_symbols(
    descriptor: &ProviderDescriptor,
    venue: &str,
    symbols: &[CatalogSymbol],
) -> Result<(), AppError> {
    const MAX_CATALOG_SYMBOLS: usize = 100_000;
    if symbols.is_empty() || symbols.len() > MAX_CATALOG_SYMBOLS {
        return Err(AppError::new(
            "provider_contract_violation",
            format!("{} 返回的目录行数不在合理范围内", descriptor.id),
        ));
    }
    let mut seen = std::collections::HashSet::with_capacity(symbols.len());
    for symbol in symbols {
        if symbol.provider_id != descriptor.id
            || !seen.insert(symbol.symbol.clone())
            || symbol.name.trim().is_empty()
            || !descriptor.capabilities.kinds.contains(&symbol.kind)
        {
            return Err(AppError::new(
                "provider_contract_violation",
                format!("{} 返回了不合法或重复的目录身份", descriptor.id),
            ));
        }
        let Ok(canonical) = crate::contracts::Symbol::new(
            symbol
                .symbol
                .split_once(':')
                .map(|parts| parts.0)
                .unwrap_or_default(),
            symbol
                .symbol
                .split_once(':')
                .map(|parts| parts.1)
                .unwrap_or_default(),
        ) else {
            return Err(AppError::new(
                "provider_contract_violation",
                format!("{} 返回了不安全的目录 symbol", descriptor.id),
            ));
        };
        if canonical.as_str() != symbol.symbol || canonical.parts().0 != venue {
            return Err(AppError::new(
                "provider_contract_violation",
                format!("{} 返回了与目录请求不匹配的 venue", descriptor.id),
            ));
        }
        if symbol
            .base_asset
            .as_deref()
            .is_some_and(|asset| !valid_catalog_asset(asset))
            || symbol
                .quote_asset
                .as_deref()
                .is_some_and(|asset| !valid_catalog_asset(asset))
        {
            return Err(AppError::new(
                "provider_contract_violation",
                format!("{} 返回了不安全的目录资产身份", descriptor.id),
            ));
        }
        match (&symbol.kind, &symbol.prediction) {
            (crate::contracts::SymbolKind::Prediction, Some(metadata)) => {
                let opposing = metadata.opposing_symbol.split_once(':');
                let opposing = opposing
                    .and_then(|(market, code)| crate::contracts::Symbol::new(market, code).ok());
                if metadata.condition_id.trim().is_empty()
                    || !matches!(metadata.outcome.as_str(), "YES" | "NO")
                    || opposing.as_ref().map(|value| value.as_str())
                        != Some(metadata.opposing_symbol.as_str())
                    || opposing.as_ref().map(|value| value.parts().0) != Some(venue)
                    || !metadata.volume.is_finite()
                    || metadata.volume < 0.0
                    || !metadata.liquidity.is_finite()
                    || metadata.liquidity < 0.0
                    || !metadata.probability.is_finite()
                    || !(0.0..=100.0).contains(&metadata.probability)
                    || !metadata.change_24h.is_finite()
                {
                    return Err(AppError::new(
                        "provider_contract_violation",
                        format!("{} 返回了不合法的预测市场元数据", descriptor.id),
                    ));
                }
            }
            (crate::contracts::SymbolKind::Prediction, None) | (_, Some(_)) => {
                return Err(AppError::new(
                    "provider_contract_violation",
                    format!("{} 返回了不匹配的预测市场元数据", descriptor.id),
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

fn valid_catalog_asset(asset: &str) -> bool {
    !asset.is_empty()
        && asset.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

impl Clone for MarketRouter {
    fn clone(&self) -> Self {
        Self {
            registry: self.registry.clone(),
        }
    }
}

fn builtin_router() -> Result<&'static MarketRouter, AppError> {
    static ROUTER: OnceLock<Result<MarketRouter, AppError>> = OnceLock::new();
    ROUTER
        .get_or_init(MarketRouter::builtin)
        .as_ref()
        .map_err(Clone::clone)
}

pub fn fetch_history(request: HistoryRequest) -> Result<HistoryResponse, AppError> {
    builtin_router()?.fetch_history(request)
}

pub fn fetch_quote(request: QuoteRequest) -> Result<QuoteResponse, AppError> {
    builtin_router()?.fetch_quote(request)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::{
        AdapterRegistration, Adjustment, CatalogRequest, CatalogSymbol, HistoryRequest,
        HistoryResponse, MarketDataAdapter, MarketRouter, ProviderDescriptor, QuoteAdapter,
        QuoteRequest, RealtimeAdapter, RealtimePayload, RealtimeRequest, RealtimeSink, Resolution,
        provider_descriptors,
    };
    use crate::contracts::{AppError, Bar, MarketSeriesKind, Symbol, SymbolKind};
    use crate::market_adapter::{
        ADAPTER_CONTRACT_VERSION, HistoryDiagnostics, ProviderCapabilities, QuoteResponse,
        QuoteSnapshot, RealtimeEventEnvelope,
    };

    #[test]
    fn provider_descriptors_declare_real_facets() {
        let descriptors = provider_descriptors();
        let expected = 5 + usize::from(cfg!(feature = "provider-polymarket"));
        assert_eq!(descriptors.len(), expected);
        assert!(descriptors.iter().all(|descriptor| {
            !descriptor.id.is_empty()
                && !descriptor.display_name.is_empty()
                && !descriptor.version.is_empty()
                && descriptor.contract_version == ADAPTER_CONTRACT_VERSION
                && !descriptor.capabilities.venues.is_empty()
                && !descriptor.capabilities.kinds.is_empty()
        }));

        let tdx = descriptors.iter().find(|item| item.id == "tdx").unwrap();
        assert!(tdx.capabilities.history);
        assert!(tdx.capabilities.quote);
        assert!(!tdx.capabilities.catalog);
        assert!(!tdx.capabilities.realtime);

        let spot = descriptors
            .iter()
            .find(|item| item.id == "binance_spot")
            .unwrap();
        assert_eq!(
            (
                spot.capabilities.catalog,
                spot.capabilities.history,
                spot.capabilities.quote,
                spot.capabilities.realtime,
            ),
            (
                cfg!(feature = "provider-binance"),
                cfg!(feature = "provider-binance"),
                cfg!(feature = "provider-binance"),
                cfg!(feature = "provider-binance"),
            )
        );

        for provider_id in ["okx_spot", "okx_swap"] {
            let okx = descriptors
                .iter()
                .find(|item| item.id == provider_id)
                .unwrap();
            assert_eq!(
                (
                    okx.capabilities.catalog,
                    okx.capabilities.history,
                    okx.capabilities.quote,
                    okx.capabilities.realtime,
                ),
                (
                    cfg!(feature = "provider-okx"),
                    cfg!(feature = "provider-okx"),
                    cfg!(feature = "provider-okx"),
                    cfg!(feature = "provider-okx"),
                )
            );
        }
    }

    #[test]
    fn catalog_and_realtime_resolve_only_at_operation_start() {
        let builtin = MarketRouter::builtin().unwrap();
        let catalog = builtin
            .registry()
            .resolve_catalog("binance_spot", "BINANCE")
            .and_then(|registration| {
                if registration.descriptor().enabled
                    && registration.descriptor().capabilities.catalog
                    && registration.catalog_adapter().is_some()
                {
                    Ok(registration)
                } else {
                    Err(AppError::new("unsupported_capability", "catalog disabled"))
                }
            });
        assert_eq!(catalog.is_ok(), cfg!(feature = "provider-binance"));
        let symbol = Symbol::new("BINANCE", "BTCUSDT").unwrap();
        let builtin = MarketRouter::builtin().unwrap();
        let realtime = builtin
            .registry()
            .resolve(&symbol, &SymbolKind::Crypto)
            .and_then(|registration| {
                if registration.descriptor().capabilities.realtime
                    && registration.realtime_adapter().is_some()
                    && registration
                        .descriptor()
                        .capabilities
                        .resolutions
                        .contains(&Resolution::Minute1)
                {
                    Ok(registration)
                } else {
                    Err(AppError::new("unsupported_capability", "realtime disabled"))
                }
            });
        assert_eq!(realtime.is_ok(), cfg!(feature = "provider-binance"));
    }

    #[cfg(not(feature = "provider-binance"))]
    #[test]
    fn disabled_binance_spot_provider_does_not_fall_through_to_tdx() {
        let symbol = Symbol::new("BINANCE", "BTCUSDT").unwrap();
        let error = super::fetch_history(HistoryRequest {
            provider_id: "binance_spot".to_string(),
            symbol,
            kind: SymbolKind::Crypto,
            resolution: Resolution::Minute1,
            adjustment: Adjustment::None,
            count: 2,
            include_quote: false,
        })
        .unwrap_err();
        assert_eq!(error.code, "market_data_source_unavailable");

        let router = MarketRouter::builtin().unwrap();
        let quote_error = router
            .fetch_quote(QuoteRequest {
                provider_id: "binance_spot".to_string(),
                symbol: Symbol::new("BINANCE", "BTCUSDT").unwrap(),
                kind: SymbolKind::Crypto,
            })
            .unwrap_err();
        assert_eq!(quote_error.code, "market_data_source_unavailable");
        let catalog_error = router
            .list_catalog(CatalogRequest {
                provider_id: "binance_spot".to_string(),
                venue: "BINANCE".to_string(),
            })
            .unwrap_err();
        assert_eq!(catalog_error.code, "market_data_source_unavailable");
        let realtime_error = router
            .start_realtime(
                RealtimeRequest {
                    request_id: 1,
                    provider_id: "binance_spot",
                    symbol: Symbol::new("BINANCE", "BTCUSDT").unwrap(),
                    kind: SymbolKind::Crypto,
                    resolution: Resolution::Minute1,
                    active_request_id: Arc::new(AtomicU64::new(0)),
                },
                Arc::new(CollectSink::default()),
            )
            .unwrap_err();
        assert_eq!(realtime_error.code, "market_data_source_unavailable");
    }

    #[cfg(not(feature = "provider-binance"))]
    #[test]
    fn disabled_binance_usdm_provider_does_not_fall_through_to_tdx() {
        let router = MarketRouter::builtin().unwrap();
        let symbol = Symbol::new("BINANCE_USDM", "BTCUSDT").unwrap();
        let history_error = router
            .fetch_history(HistoryRequest {
                provider_id: "binance_usdm".to_string(),
                symbol: symbol.clone(),
                kind: SymbolKind::Crypto,
                resolution: Resolution::Minute1,
                adjustment: Adjustment::None,
                count: 2,
                include_quote: false,
            })
            .unwrap_err();
        assert_eq!(history_error.code, "market_data_source_unavailable");

        let quote_error = router
            .fetch_quote(QuoteRequest {
                provider_id: "binance_usdm".to_string(),
                symbol: symbol.clone(),
                kind: SymbolKind::Crypto,
            })
            .unwrap_err();
        assert_eq!(quote_error.code, "market_data_source_unavailable");

        let catalog_error = router
            .list_catalog(CatalogRequest {
                provider_id: "binance_usdm".to_string(),
                venue: "BINANCE_USDM".to_string(),
            })
            .unwrap_err();
        assert_eq!(catalog_error.code, "market_data_source_unavailable");

        let realtime_error = router
            .start_realtime(
                RealtimeRequest {
                    request_id: 2,
                    provider_id: "binance_usdm",
                    symbol,
                    kind: SymbolKind::Crypto,
                    resolution: Resolution::Minute1,
                    active_request_id: Arc::new(AtomicU64::new(2)),
                },
                Arc::new(CollectSink::default()),
            )
            .unwrap_err();
        assert_eq!(realtime_error.code, "market_data_source_unavailable");
    }

    #[cfg(not(feature = "provider-okx"))]
    #[test]
    fn disabled_okx_providers_do_not_fall_through_to_other_routes() {
        let router = MarketRouter::builtin().unwrap();
        for (provider_id, venue, code) in [
            ("okx_spot", "OKX", "BTC-USDT"),
            ("okx_swap", "OKX_SWAP", "BTC-USDT-SWAP"),
        ] {
            let symbol = Symbol::new(venue, code).unwrap();
            let history = router
                .fetch_history(HistoryRequest {
                    provider_id: provider_id.to_string(),
                    symbol: symbol.clone(),
                    kind: SymbolKind::Crypto,
                    resolution: Resolution::Minute1,
                    adjustment: Adjustment::None,
                    count: 2,
                    include_quote: false,
                })
                .unwrap_err();
            assert_eq!(history.code, "market_data_source_unavailable");
            let quote = router
                .fetch_quote(QuoteRequest {
                    provider_id: provider_id.to_string(),
                    symbol,
                    kind: SymbolKind::Crypto,
                })
                .unwrap_err();
            assert_eq!(quote.code, "market_data_source_unavailable");
            let catalog = router
                .list_catalog(CatalogRequest {
                    provider_id: provider_id.to_string(),
                    venue: venue.to_string(),
                })
                .unwrap_err();
            assert_eq!(catalog.code, "market_data_source_unavailable");
        }
    }

    #[test]
    fn fake_provider_calls_history_quote_catalog_and_realtime_facets() {
        let router = MarketRouter::new([AdapterRegistration::new(&FAKE_ADAPTER)]).unwrap();
        let symbol = Symbol::new("EXAMPLE", "ABC").unwrap();
        reset_fake_facet_calls();
        let response = router
            .fetch_history(HistoryRequest {
                provider_id: "fake".to_string(),
                symbol: symbol.clone(),
                kind: SymbolKind::Stock,
                resolution: Resolution::Day,
                adjustment: Adjustment::None,
                count: 2,
                include_quote: true,
            })
            .unwrap();
        assert_eq!(response.symbol, symbol);
        assert!(response.quote.is_some());
        assert_eq!(FAKE_HISTORY_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(FAKE_QUOTE_CALLS.load(Ordering::Acquire), 0);
        assert_eq!(FAKE_CATALOG_CALLS.load(Ordering::Acquire), 0);
        assert_eq!(FAKE_REALTIME_STARTS.load(Ordering::Acquire), 0);
        assert!(
            router
                .fetch_quote(QuoteRequest {
                    provider_id: "fake".to_string(),
                    symbol: Symbol::new("EXAMPLE", "ABC").unwrap(),
                    kind: SymbolKind::Stock,
                })
                .is_ok()
        );
        assert_eq!(FAKE_HISTORY_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(FAKE_QUOTE_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(FAKE_CATALOG_CALLS.load(Ordering::Acquire), 0);
        assert_eq!(FAKE_REALTIME_STARTS.load(Ordering::Acquire), 0);
        let rows = router
            .list_catalog(CatalogRequest {
                provider_id: "fake".to_string(),
                venue: "EXAMPLE".to_string(),
            })
            .unwrap();
        assert_eq!(rows[0].symbol, "EXAMPLE:ABC");
        assert_eq!(FAKE_HISTORY_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(FAKE_QUOTE_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(FAKE_CATALOG_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(FAKE_REALTIME_STARTS.load(Ordering::Acquire), 0);

        let sink = Arc::new(CollectSink::default());
        let active = Arc::new(AtomicU64::new(7));
        FAKE_REALTIME_STARTS.store(0, std::sync::atomic::Ordering::Release);
        router
            .start_realtime(
                RealtimeRequest {
                    request_id: 7,
                    provider_id: "fake",
                    symbol,
                    kind: SymbolKind::Stock,
                    resolution: Resolution::Day,
                    active_request_id: active.clone(),
                },
                sink.clone(),
            )
            .unwrap();
        assert_eq!(sink.events.lock().unwrap().len(), 1);
        assert_eq!(FAKE_HISTORY_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(FAKE_QUOTE_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(FAKE_CATALOG_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(FAKE_REALTIME_STARTS.load(Ordering::Acquire), 1);
        active.store(8, std::sync::atomic::Ordering::Release);
        let stale_sink = Arc::new(CollectSink::default());
        router
            .start_realtime(
                RealtimeRequest {
                    request_id: 7,
                    provider_id: "fake",
                    symbol: Symbol::new("EXAMPLE", "ABC").unwrap(),
                    kind: SymbolKind::Stock,
                    resolution: Resolution::Day,
                    active_request_id: Arc::clone(&active),
                },
                stale_sink.clone(),
            )
            .unwrap();
        assert!(stale_sink.events.lock().unwrap().is_empty());
        assert_eq!(FAKE_HISTORY_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(FAKE_QUOTE_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(FAKE_CATALOG_CALLS.load(Ordering::Acquire), 1);
        assert_eq!(
            FAKE_REALTIME_STARTS.load(Ordering::Acquire),
            1,
            "stale subscription must not start the provider again"
        );
        assert!(
            !RealtimeRequest {
                request_id: 7,
                provider_id: "fake",
                symbol: Symbol::new("EXAMPLE", "ABC").unwrap(),
                kind: SymbolKind::Stock,
                resolution: Resolution::Day,
                active_request_id: Arc::clone(&active),
            }
            .is_active()
        );
    }

    #[test]
    fn pure_route_resolution_microbench_has_no_provider_side_effects() {
        let router = MarketRouter::new([AdapterRegistration::new(&FAKE_ADAPTER)]).unwrap();
        let symbol = Symbol::new("EXAMPLE", "ABC").unwrap();
        for _ in 0..10_000 {
            let registration = router
                .registry()
                .resolve_for_provider("fake", &symbol, &SymbolKind::Stock)
                .unwrap();
            assert_eq!(registration.descriptor().id, "fake");
        }
        println!(
            "adapter.route.microbench iterations=10000 registry_resolutions=10000 provider_starts=0"
        );
    }

    #[test]
    fn registry_rejects_duplicate_ids_and_overlapping_routes() {
        let duplicate = match MarketRouter::new([
            AdapterRegistration::new(&FAKE_ADAPTER),
            AdapterRegistration::new(&FAKE_ADAPTER),
        ]) {
            Ok(_) => panic!("duplicate provider id must be rejected"),
            Err(error) => error,
        };
        assert_eq!(duplicate.code, "duplicate_provider_id");
        let overlap = match MarketRouter::new([
            AdapterRegistration::new(&FAKE_ADAPTER),
            AdapterRegistration::new(&OVERLAP_ADAPTER),
        ]) {
            Ok(_) => panic!("overlapping provider route must be rejected"),
            Err(error) => error,
        };
        assert_eq!(overlap.code, "ambiguous_provider_route");
    }

    #[test]
    fn malformed_catalog_identity_is_rejected_at_router_boundary() {
        let duplicate = CatalogSymbol {
            provider_id: "fake".to_string(),
            symbol: "EXAMPLE:ABC".to_string(),
            name: "A / B".to_string(),
            kind: SymbolKind::Stock,
            base_asset: Some("A".to_string()),
            quote_asset: Some("B".to_string()),
            prediction: None,
        };
        let error = super::validate_catalog_symbols(
            &FAKE_DESCRIPTOR,
            "EXAMPLE",
            &[duplicate.clone(), duplicate],
        )
        .unwrap_err();
        assert_eq!(error.code, "provider_contract_violation");

        let unsafe_symbol = CatalogSymbol {
            symbol: "EXAMPLE:ABC:BAD".to_string(),
            base_asset: Some("A:B".to_string()),
            ..CatalogSymbol {
                provider_id: "fake".to_string(),
                symbol: "EXAMPLE:ABC".to_string(),
                name: "A / B".to_string(),
                kind: SymbolKind::Stock,
                base_asset: Some("A".to_string()),
                quote_asset: Some("B".to_string()),
                prediction: None,
            }
        };
        let error = super::validate_catalog_symbols(&FAKE_DESCRIPTOR, "EXAMPLE", &[unsafe_symbol])
            .unwrap_err();
        assert_eq!(error.code, "provider_contract_violation");

        let empty_error =
            super::validate_catalog_symbols(&FAKE_DESCRIPTOR, "EXAMPLE", &[]).unwrap_err();
        assert_eq!(empty_error.code, "provider_contract_violation");
    }

    #[test]
    fn malformed_fake_response_is_rejected_at_router_boundary() {
        let router = MarketRouter::new([AdapterRegistration::new(&MALFORMED_ADAPTER)]).unwrap();
        let error = router
            .fetch_history(HistoryRequest {
                provider_id: "malformed".to_string(),
                symbol: Symbol::new("MALFORMED", "BAD").unwrap(),
                kind: SymbolKind::Stock,
                resolution: Resolution::Day,
                adjustment: Adjustment::None,
                count: 2,
                include_quote: false,
            })
            .unwrap_err();
        assert_eq!(error.code, "provider_contract_violation");
    }

    #[test]
    fn malformed_quote_count_and_source_are_rejected_at_router_boundary() {
        let missing_quote_router =
            MarketRouter::new([AdapterRegistration::new(&MISSING_QUOTE_ADAPTER)]).unwrap();
        let missing_quote = missing_quote_router
            .fetch_history(HistoryRequest {
                provider_id: "bad_missing_quote".to_string(),
                symbol: Symbol::new("BAD_MISSING", "ABC").unwrap(),
                kind: SymbolKind::Stock,
                resolution: Resolution::Day,
                adjustment: Adjustment::None,
                count: 2,
                include_quote: true,
            })
            .unwrap();
        assert!(missing_quote.quote.is_none());

        let mut invalid_quote_response = fake_response(Symbol::new("EXAMPLE", "ABC").unwrap());
        invalid_quote_response.quote.as_mut().unwrap().last = f64::NAN;
        let invalid_quote_error = super::validate_history_response(
            AdapterRegistration::new(&FAKE_ADAPTER),
            &HistoryRequest {
                provider_id: "fake".to_string(),
                symbol: Symbol::new("EXAMPLE", "ABC").unwrap(),
                kind: SymbolKind::Stock,
                resolution: Resolution::Day,
                adjustment: Adjustment::None,
                count: 2,
                include_quote: true,
            },
            &invalid_quote_response,
        )
        .unwrap_err();
        assert_eq!(invalid_quote_error.code, "invalid_market_data");

        let no_quote_capability_request = HistoryRequest {
            provider_id: "malformed".to_string(),
            symbol: Symbol::new("MALFORMED", "BAD").unwrap(),
            kind: SymbolKind::Stock,
            resolution: Resolution::Day,
            adjustment: Adjustment::None,
            count: 2,
            include_quote: false,
        };
        let mut quote_without_capability =
            fake_response(no_quote_capability_request.symbol.clone());
        quote_without_capability.diagnostics.source = "malformed";
        let no_quote_capability_error = super::validate_history_response(
            AdapterRegistration::new(&MALFORMED_ADAPTER),
            &no_quote_capability_request,
            &quote_without_capability,
        )
        .unwrap_err();
        assert_eq!(
            no_quote_capability_error.code,
            "provider_capability_mismatch"
        );

        let count_router =
            MarketRouter::new([AdapterRegistration::new(&TOO_MANY_BARS_ADAPTER)]).unwrap();
        let count_error = count_router
            .fetch_history(HistoryRequest {
                provider_id: "bad_count".to_string(),
                symbol: Symbol::new("BAD_COUNT", "ABC").unwrap(),
                kind: SymbolKind::Stock,
                resolution: Resolution::Day,
                adjustment: Adjustment::None,
                count: 2,
                include_quote: false,
            })
            .unwrap_err();
        assert_eq!(count_error.code, "provider_contract_violation");

        let source_router =
            MarketRouter::new([AdapterRegistration::new(&WRONG_SOURCE_ADAPTER)]).unwrap();
        let source_error = source_router
            .fetch_history(HistoryRequest {
                provider_id: "bad_source".to_string(),
                symbol: Symbol::new("BAD_SOURCE", "ABC").unwrap(),
                kind: SymbolKind::Stock,
                resolution: Resolution::Day,
                adjustment: Adjustment::None,
                count: 2,
                include_quote: false,
            })
            .unwrap_err();
        assert_eq!(source_error.code, "provider_contract_violation");
    }

    #[derive(Default)]
    struct CollectSink {
        events: std::sync::Mutex<Vec<RealtimeEventEnvelope>>,
    }

    impl RealtimeSink for CollectSink {
        fn emit(&self, event: RealtimeEventEnvelope) -> Result<(), AppError> {
            self.events.lock().unwrap().push(event);
            Ok(())
        }
    }

    static FAKE_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
        id: "fake",
        display_name: "Fake provider",
        version: "1",
        contract_version: ADAPTER_CONTRACT_VERSION,
        enabled: true,
        capabilities: ProviderCapabilities {
            catalog: true,
            history: true,
            quote: true,
            realtime: true,
            venues: &["EXAMPLE"],
            kinds: &[SymbolKind::Stock],
            resolutions: &[Resolution::Day],
            adjustments: &[Adjustment::None],
        },
    };

    static OVERLAP_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
        id: "overlap",
        display_name: "Overlap provider",
        version: "1",
        contract_version: ADAPTER_CONTRACT_VERSION,
        enabled: true,
        capabilities: ProviderCapabilities {
            catalog: false,
            history: true,
            quote: false,
            realtime: false,
            venues: &["EXAMPLE"],
            kinds: &[SymbolKind::Stock],
            resolutions: &[Resolution::Day],
            adjustments: &[Adjustment::None],
        },
    };

    static MALFORMED_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
        id: "malformed",
        display_name: "Malformed provider",
        version: "1",
        contract_version: ADAPTER_CONTRACT_VERSION,
        enabled: true,
        capabilities: ProviderCapabilities {
            catalog: false,
            history: true,
            quote: false,
            realtime: false,
            venues: &["MALFORMED"],
            kinds: &[SymbolKind::Stock],
            resolutions: &[Resolution::Day],
            adjustments: &[Adjustment::None],
        },
    };

    static MISSING_QUOTE_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
        id: "bad_missing_quote",
        display_name: "Missing quote provider",
        version: "1",
        contract_version: ADAPTER_CONTRACT_VERSION,
        enabled: true,
        capabilities: ProviderCapabilities {
            catalog: false,
            history: true,
            quote: true,
            realtime: false,
            venues: &["BAD_MISSING"],
            kinds: &[SymbolKind::Stock],
            resolutions: &[Resolution::Day],
            adjustments: &[Adjustment::None],
        },
    };

    static TOO_MANY_BARS_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
        id: "bad_count",
        display_name: "Too many bars provider",
        version: "1",
        contract_version: ADAPTER_CONTRACT_VERSION,
        enabled: true,
        capabilities: ProviderCapabilities {
            catalog: false,
            history: true,
            quote: true,
            realtime: false,
            venues: &["BAD_COUNT"],
            kinds: &[SymbolKind::Stock],
            resolutions: &[Resolution::Day],
            adjustments: &[Adjustment::None],
        },
    };

    static WRONG_SOURCE_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
        id: "bad_source",
        display_name: "Wrong source provider",
        version: "1",
        contract_version: ADAPTER_CONTRACT_VERSION,
        enabled: true,
        capabilities: ProviderCapabilities {
            catalog: false,
            history: true,
            quote: true,
            realtime: false,
            venues: &["BAD_SOURCE"],
            kinds: &[SymbolKind::Stock],
            resolutions: &[Resolution::Day],
            adjustments: &[Adjustment::None],
        },
    };

    struct FakeAdapter;
    struct OverlapAdapter;
    struct MalformedAdapter;
    #[derive(Clone, Copy)]
    enum BadResponse {
        MissingQuote,
        TooManyBars,
        WrongSource,
    }
    struct BadAdapter {
        descriptor: &'static ProviderDescriptor,
        response: BadResponse,
    }
    static FAKE_ADAPTER: FakeAdapter = FakeAdapter;
    static FAKE_HISTORY_CALLS: AtomicU64 = AtomicU64::new(0);
    static FAKE_QUOTE_CALLS: AtomicU64 = AtomicU64::new(0);
    static FAKE_CATALOG_CALLS: AtomicU64 = AtomicU64::new(0);
    static FAKE_REALTIME_STARTS: AtomicU64 = AtomicU64::new(0);
    static OVERLAP_ADAPTER: OverlapAdapter = OverlapAdapter;
    static MALFORMED_ADAPTER: MalformedAdapter = MalformedAdapter;
    static MISSING_QUOTE_ADAPTER: BadAdapter = BadAdapter {
        descriptor: &MISSING_QUOTE_DESCRIPTOR,
        response: BadResponse::MissingQuote,
    };
    static TOO_MANY_BARS_ADAPTER: BadAdapter = BadAdapter {
        descriptor: &TOO_MANY_BARS_DESCRIPTOR,
        response: BadResponse::TooManyBars,
    };
    static WRONG_SOURCE_ADAPTER: BadAdapter = BadAdapter {
        descriptor: &WRONG_SOURCE_DESCRIPTOR,
        response: BadResponse::WrongSource,
    };

    fn fake_response(symbol: Symbol) -> HistoryResponse {
        HistoryResponse {
            symbol,
            series_kind: MarketSeriesKind::Ohlcv,
            bars: vec![Bar::new(1, 10.0, 11.0, 9.0, 10.5, 1.0, None)],
            points: Vec::new(),
            diagnostics: HistoryDiagnostics {
                source: "fake",
                host: "fake.test".to_string(),
                latency_ms: 0.0,
            },
            quote: Some(QuoteSnapshot {
                last: 10.5,
                previous_close: 10.0,
                open: 10.1,
                high: 11.0,
                low: 9.0,
                volume: 1.0,
                amount: 10.5,
                received_at: 1,
            }),
        }
    }

    fn reset_fake_facet_calls() {
        FAKE_HISTORY_CALLS.store(0, Ordering::Release);
        FAKE_QUOTE_CALLS.store(0, Ordering::Release);
        FAKE_CATALOG_CALLS.store(0, Ordering::Release);
        FAKE_REALTIME_STARTS.store(0, Ordering::Release);
    }

    impl QuoteAdapter for FakeAdapter {
        fn fetch_quote(&self, _request: QuoteRequest) -> Result<QuoteResponse, AppError> {
            FAKE_QUOTE_CALLS.fetch_add(1, Ordering::AcqRel);
            Ok(QuoteResponse {
                provider_id: "fake".to_string(),
                symbol: Symbol::new("EXAMPLE", "ABC").unwrap(),
                source: "fake".to_string(),
                quote: fake_response(Symbol::new("EXAMPLE", "ABC").unwrap())
                    .quote
                    .unwrap(),
            })
        }
    }

    impl super::CatalogAdapter for FakeAdapter {
        fn list_symbols(&self, _request: CatalogRequest) -> Result<Vec<CatalogSymbol>, AppError> {
            FAKE_CATALOG_CALLS.fetch_add(1, Ordering::AcqRel);
            Ok(vec![CatalogSymbol {
                provider_id: "fake".to_string(),
                symbol: "EXAMPLE:ABC".to_string(),
                name: "A / B".to_string(),
                kind: SymbolKind::Stock,
                base_asset: Some("A".to_string()),
                quote_asset: Some("B".to_string()),
                prediction: None,
            }])
        }
    }

    impl RealtimeAdapter for FakeAdapter {
        fn replace_subscription(
            &self,
            request: RealtimeRequest,
            sink: Arc<dyn RealtimeSink>,
        ) -> Result<(), AppError> {
            FAKE_REALTIME_STARTS.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
            if request.is_active() {
                sink.emit(request.envelope(
                    Some(1),
                    RealtimePayload::Status {
                        status: "connected",
                        message: None,
                    },
                ))?;
            }
            Ok(())
        }
    }

    impl MarketDataAdapter for FakeAdapter {
        fn descriptor(&self) -> &'static ProviderDescriptor {
            &FAKE_DESCRIPTOR
        }

        fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
            FAKE_HISTORY_CALLS.fetch_add(1, Ordering::AcqRel);
            Ok(fake_response(request.symbol))
        }

        fn quote_adapter(&self) -> Option<&dyn QuoteAdapter> {
            Some(self)
        }

        fn catalog_adapter(&self) -> Option<&dyn super::CatalogAdapter> {
            Some(self)
        }

        fn realtime_adapter(&self) -> Option<&dyn RealtimeAdapter> {
            Some(self)
        }
    }

    impl MarketDataAdapter for OverlapAdapter {
        fn descriptor(&self) -> &'static ProviderDescriptor {
            &OVERLAP_DESCRIPTOR
        }

        fn fetch_history(&self, _request: HistoryRequest) -> Result<HistoryResponse, AppError> {
            unreachable!("registry conflict must be rejected before invocation")
        }
    }

    impl MarketDataAdapter for MalformedAdapter {
        fn descriptor(&self) -> &'static ProviderDescriptor {
            &MALFORMED_DESCRIPTOR
        }

        fn fetch_history(&self, _request: HistoryRequest) -> Result<HistoryResponse, AppError> {
            Ok(HistoryResponse {
                symbol: Symbol::new("MALFORMED", "OTHER").unwrap(),
                series_kind: MarketSeriesKind::Ohlcv,
                bars: vec![Bar::new(1, 10.0, 11.0, 9.0, 10.5, 1.0, None)],
                points: Vec::new(),
                diagnostics: HistoryDiagnostics {
                    source: "malformed",
                    host: "fake.test".to_string(),
                    latency_ms: 0.0,
                },
                quote: None,
            })
        }
    }

    impl QuoteAdapter for BadAdapter {
        fn fetch_quote(&self, request: QuoteRequest) -> Result<QuoteResponse, AppError> {
            Ok(QuoteResponse {
                provider_id: self.descriptor.id.to_string(),
                symbol: request.symbol,
                source: self.descriptor.id.to_string(),
                quote: fake_response(Symbol::new("BAD", "ABC").unwrap())
                    .quote
                    .unwrap(),
            })
        }
    }

    impl MarketDataAdapter for BadAdapter {
        fn descriptor(&self) -> &'static ProviderDescriptor {
            self.descriptor
        }

        fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError> {
            let mut response = fake_response(request.symbol);
            response.diagnostics.source = match self.response {
                BadResponse::MissingQuote => "bad_missing_quote",
                BadResponse::TooManyBars => "bad_count",
                BadResponse::WrongSource => "unrelated_provider",
            };
            if matches!(self.response, BadResponse::MissingQuote) {
                response.quote = None;
            }
            if matches!(self.response, BadResponse::TooManyBars) {
                response.bars = vec![
                    Bar::new(1, 10.0, 11.0, 9.0, 10.5, 1.0, None),
                    Bar::new(2, 10.5, 11.5, 10.0, 11.0, 1.0, None),
                    Bar::new(3, 11.0, 12.0, 10.5, 11.5, 1.0, None),
                ];
            }
            Ok(response)
        }

        fn quote_adapter(&self) -> Option<&dyn QuoteAdapter> {
            Some(self)
        }
    }
}
