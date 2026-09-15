//! TradeFlow Lite 的编译期行情适配器合同。
//!
//! 这个模块只描述跨 provider 的边界。适配器由 Rust 静态链接进应用，不能在运行时
//! 加载任意脚本或动态库。历史批次和实时事件都在 Rust 类型之间传递；只有最终的
//! Tauri sink 才负责把事件交给前端。

use std::borrow::Cow;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::contracts::{
    Adjustment, AppError, Bar, ProbabilityPoint, Resolution, Symbol, SymbolKind,
};

pub use crate::market_data::{HistoryDiagnostics, HistoryResponse, QuoteSnapshot};

/// 当前公开适配器合同的版本。
pub const ADAPTER_CONTRACT_VERSION: &str = "2";
pub const MAX_PROVIDER_ID_CHARS: usize = 64;

/// provider id 会进入 `providerId|symbol` 的稳定身份 key，只允许与前端解析器
/// 相同的 ASCII 字符集合，避免分隔符注入、空白和 Unicode 规范化歧义。
pub fn is_valid_provider_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_PROVIDER_ID_CHARS
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub catalog: bool,
    pub history: bool,
    pub quote: bool,
    pub realtime: bool,
    pub venues: &'static [&'static str],
    pub kinds: &'static [SymbolKind],
    pub resolutions: &'static [Resolution],
    pub adjustments: &'static [Adjustment],
}

impl ProviderCapabilities {
    pub fn supports_symbol(&self, symbol: &Symbol, kind: &SymbolKind) -> bool {
        let (venue, _) = symbol.parts();
        self.venues.contains(&venue) && self.kinds.contains(kind)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: &'static str,
    pub display_name: &'static str,
    pub version: &'static str,
    pub contract_version: &'static str,
    pub enabled: bool,
    pub capabilities: ProviderCapabilities,
}

impl ProviderDescriptor {
    /// 内置历史诊断沿用 `tradeflow-*` 前缀，外部适配器通常直接使用 provider id。
    pub fn accepts_diagnostics_source(&self, source: &str) -> bool {
        if source == self.id {
            return true;
        }
        source
            .strip_prefix("tradeflow-")
            .map(|value| value.replace('-', "_") == self.id)
            .unwrap_or(false)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoryRequest {
    pub provider_id: String,
    pub symbol: Symbol,
    pub kind: SymbolKind,
    pub resolution: Resolution,
    pub adjustment: Adjustment,
    pub count: usize,
    pub include_quote: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuoteRequest {
    pub provider_id: String,
    pub symbol: Symbol,
    pub kind: SymbolKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogRequest {
    pub provider_id: String,
    pub venue: String,
}

/// 目录返回的 provider-neutral 稳定身份。`symbol` 必须是包含 venue 的 `VENUE:CODE`。
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSymbol {
    pub provider_id: String,
    pub symbol: String,
    pub name: String,
    pub kind: SymbolKind,
    pub base_asset: Option<String>,
    pub quote_asset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prediction: Option<PredictionMarketMetadata>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictionMarketMetadata {
    pub condition_id: String,
    pub outcome: String,
    pub opposing_symbol: String,
    pub description: String,
    pub resolution_source: String,
    pub end_date: String,
    pub volume: f64,
    pub liquidity: f64,
    pub probability: f64,
    pub change_24h: f64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteResponse {
    pub provider_id: String,
    pub symbol: Symbol,
    pub source: String,
    pub quote: QuoteSnapshot,
}

pub trait QuoteAdapter: Sync {
    fn fetch_quote(&self, request: QuoteRequest) -> Result<QuoteResponse, AppError>;
}

pub trait CatalogAdapter: Sync {
    fn list_symbols(&self, request: CatalogRequest) -> Result<Vec<CatalogSymbol>, AppError>;
}

/// Provider 产生的实时事件。`RealtimeRequest` 中的 identity 会被复制到每个 envelope，
/// 使前端能够丢弃旧订阅；provider 线程不需要再次访问 Registry。
#[derive(Clone, Debug, PartialEq)]
pub struct RealtimeEventEnvelope {
    pub request_id: u64,
    pub provider_id: &'static str,
    pub symbol: Symbol,
    pub resolution: Resolution,
    pub sequence: Option<u64>,
    pub payload: RealtimePayload,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RealtimePayload {
    Status {
        status: &'static str,
        message: Option<String>,
    },
    Bar {
        bar: Bar,
        closed: bool,
        event_time_ms: i64,
        source: Cow<'static, str>,
    },
    Point {
        point: ProbabilityPoint,
        event_time_ms: i64,
        source: Cow<'static, str>,
    },
    Depth {
        event_time_ms: i64,
        bids: Vec<RealtimePriceLevel>,
        asks: Vec<RealtimePriceLevel>,
    },
    Trade {
        trade_id: i64,
        trade_time_ms: i64,
        price: f64,
        quantity: f64,
        side: Option<Cow<'static, str>>,
        flags: Option<u64>,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct RealtimePriceLevel {
    pub price: f64,
    pub quantity: f64,
}

#[derive(Clone)]
pub struct RealtimeRequest {
    pub request_id: u64,
    pub provider_id: &'static str,
    pub symbol: Symbol,
    pub kind: SymbolKind,
    pub resolution: Resolution,
    pub active_request_id: Arc<AtomicU64>,
}

impl RealtimeRequest {
    pub fn is_active(&self) -> bool {
        self.active_request_id.load(Ordering::Acquire) == self.request_id
    }

    pub fn envelope(
        &self,
        sequence: Option<u64>,
        payload: RealtimePayload,
    ) -> RealtimeEventEnvelope {
        RealtimeEventEnvelope {
            request_id: self.request_id,
            provider_id: self.provider_id,
            symbol: self.symbol.clone(),
            resolution: self.resolution,
            sequence,
            payload,
        }
    }
}

pub trait RealtimeSink: Send + Sync {
    fn emit(&self, event: RealtimeEventEnvelope) -> Result<(), AppError>;
}

pub trait RealtimeAdapter: Sync {
    fn start(&self, request: RealtimeRequest, sink: Arc<dyn RealtimeSink>) -> Result<(), AppError>;
}

/// 一个适配器同时提供历史入口，并可选择性暴露报价、目录和推送 facet。
///
/// `ProviderCapabilities` 是可读的声明；Registry 创建时会校验三个可选 facet 与声明
/// 一致，避免“只改 bool、实际仍走旧 provider 分支”的假适配。
pub trait MarketDataAdapter: Sync {
    fn descriptor(&self) -> &'static ProviderDescriptor;

    /// 是否真的可以执行历史请求。默认适配器都有这个入口；关闭构建 feature 的
    /// 占位适配器必须显式返回 false，Registry 会据此校验 capability 声明。
    fn history_available(&self) -> bool {
        true
    }

    fn fetch_history(&self, request: HistoryRequest) -> Result<HistoryResponse, AppError>;

    fn quote_adapter(&self) -> Option<&dyn QuoteAdapter> {
        None
    }

    fn catalog_adapter(&self) -> Option<&dyn CatalogAdapter> {
        None
    }

    fn realtime_adapter(&self) -> Option<&dyn RealtimeAdapter> {
        None
    }
}

#[derive(Clone, Copy)]
pub struct AdapterRegistration {
    adapter: &'static dyn MarketDataAdapter,
}

impl AdapterRegistration {
    pub const fn new(adapter: &'static dyn MarketDataAdapter) -> Self {
        Self { adapter }
    }

    pub fn adapter(self) -> &'static dyn MarketDataAdapter {
        self.adapter
    }

    pub fn descriptor(self) -> &'static ProviderDescriptor {
        self.adapter.descriptor()
    }

    pub fn quote_adapter(self) -> Option<&'static dyn QuoteAdapter> {
        self.adapter.quote_adapter()
    }

    pub fn catalog_adapter(self) -> Option<&'static dyn CatalogAdapter> {
        self.adapter.catalog_adapter()
    }

    pub fn realtime_adapter(self) -> Option<&'static dyn RealtimeAdapter> {
        self.adapter.realtime_adapter()
    }
}

/// 可注入的静态 Registry。应用内置 Registry 使用一次性初始化；测试和未来编译进来的
/// provider 可以构造自己的 Registry，从而在不改路由算法的情况下验证完整四面调用。
#[derive(Clone)]
pub struct AdapterRegistry {
    registrations: Vec<AdapterRegistration>,
}

impl AdapterRegistry {
    pub fn new(
        registrations: impl IntoIterator<Item = AdapterRegistration>,
    ) -> Result<Self, AppError> {
        let mut registry = Self {
            registrations: Vec::new(),
        };
        for registration in registrations {
            registry.register(registration)?;
        }
        Ok(registry)
    }

    pub fn register(&mut self, registration: AdapterRegistration) -> Result<(), AppError> {
        let descriptor = registration.descriptor();
        if !is_valid_provider_id(descriptor.id)
            || descriptor.display_name.is_empty()
            || descriptor.version.is_empty()
            || descriptor.contract_version != ADAPTER_CONTRACT_VERSION
        {
            return Err(AppError::new(
                "invalid_provider_descriptor",
                format!("{} 的 provider 描述不合法", descriptor.display_name),
            ));
        }
        if self
            .registrations
            .iter()
            .any(|item| item.descriptor().id == descriptor.id)
        {
            return Err(AppError::new(
                "duplicate_provider_id",
                format!("provider id {} 已注册", descriptor.id),
            ));
        }
        if let Some(existing) = self
            .registrations
            .iter()
            .find(|item| routes_overlap(item.descriptor(), descriptor))
        {
            return Err(AppError::new(
                "ambiguous_provider_route",
                format!(
                    "{} 与 {} 的市场/品种路由重叠",
                    existing.descriptor().id,
                    descriptor.id
                ),
            ));
        }
        let capabilities = descriptor.capabilities;
        if capabilities.history != registration.adapter().history_available()
            || capabilities.quote != registration.quote_adapter().is_some()
            || capabilities.catalog != registration.catalog_adapter().is_some()
            || capabilities.realtime != registration.realtime_adapter().is_some()
        {
            return Err(AppError::new(
                "provider_capability_mismatch",
                format!("{} 的能力声明与实际 facet 不一致", descriptor.id),
            ));
        }
        self.registrations.push(registration);
        Ok(())
    }

    pub fn registrations(&self) -> &[AdapterRegistration] {
        &self.registrations
    }

    pub fn descriptors(&self) -> impl Iterator<Item = &'static ProviderDescriptor> + '_ {
        self.registrations
            .iter()
            .map(|registration| registration.descriptor())
    }

    pub fn resolve(
        &self,
        symbol: &Symbol,
        kind: &SymbolKind,
    ) -> Result<AdapterRegistration, AppError> {
        let mut matches = self.registrations.iter().filter(|registration| {
            registration
                .descriptor()
                .capabilities
                .supports_symbol(symbol, kind)
        });
        let Some(first) = matches.next() else {
            let (venue, _) = symbol.parts();
            return Err(AppError::new(
                "instrument_route_not_found",
                format!("品种类型 {} 与市场 {venue} 不匹配", kind.as_str()),
            ));
        };
        if matches.next().is_some() {
            return Err(AppError::new(
                "ambiguous_provider_route",
                "一个品种匹配了多个行情适配器",
            ));
        }
        Ok(*first)
    }

    pub fn resolve_for_provider(
        &self,
        provider_id: &str,
        symbol: &Symbol,
        kind: &SymbolKind,
    ) -> Result<AdapterRegistration, AppError> {
        if provider_id.is_empty() {
            return Err(AppError::new(
                "provider_identity_required",
                "请求必须包含 provider identity",
            ));
        }
        let registration = self.resolve(symbol, kind)?;
        if registration.descriptor().id != provider_id {
            return Err(AppError::new(
                "provider_identity_mismatch",
                format!("品种 {} 不属于 provider {}", symbol.as_str(), provider_id),
            ));
        }
        Ok(registration)
    }

    pub fn resolve_catalog(
        &self,
        provider_id: &str,
        venue: &str,
    ) -> Result<AdapterRegistration, AppError> {
        if provider_id.is_empty() {
            return Err(AppError::new(
                "provider_identity_required",
                "目录请求必须包含 provider identity",
            ));
        }
        let mut matches = self.registrations.iter().filter(|registration| {
            registration
                .descriptor()
                .capabilities
                .venues
                .contains(&venue)
                && registration.descriptor().id == provider_id
        });
        let Some(first) = matches.next() else {
            return Err(AppError::new(
                "catalog_route_not_found",
                format!("市场 {venue} 没有目录适配器"),
            ));
        };
        if matches.next().is_some() {
            return Err(AppError::new(
                "ambiguous_provider_route",
                format!("市场 {venue} 匹配了多个行情适配器"),
            ));
        }
        Ok(*first)
    }
}

fn routes_overlap(left: &ProviderDescriptor, right: &ProviderDescriptor) -> bool {
    left.capabilities
        .venues
        .iter()
        .any(|venue| right.capabilities.venues.contains(venue))
        && left
            .capabilities
            .kinds
            .iter()
            .any(|kind| right.capabilities.kinds.contains(kind))
}

pub struct MarketDataSnapshot<'a> {
    pub symbol: &'a Symbol,
    pub bars: &'a [Bar],
    pub quote: Option<&'a QuoteSnapshot>,
    pub diagnostics: &'a HistoryDiagnostics,
}

impl<'a> MarketDataSnapshot<'a> {
    pub fn from_response(response: &'a HistoryResponse) -> Self {
        Self {
            symbol: &response.symbol,
            bars: &response.bars,
            quote: response.quote.as_ref(),
            diagnostics: &response.diagnostics,
        }
    }

    pub fn recent_bars(&self, max_bars: usize) -> &'a [Bar] {
        let start = self.bars.len().saturating_sub(max_bars);
        &self.bars[start..]
    }
}

pub static TDX_PROVIDER_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
    id: "tdx",
    display_name: "通达信主站",
    version: "1",
    contract_version: ADAPTER_CONTRACT_VERSION,
    enabled: true,
    capabilities: ProviderCapabilities {
        catalog: false,
        history: true,
        quote: true,
        realtime: false,
        venues: &["SH", "SZ", "BJ"],
        kinds: &[SymbolKind::Stock, SymbolKind::Etf, SymbolKind::Index],
        resolutions: &[
            Resolution::Minute1,
            Resolution::Minute5,
            Resolution::Minute15,
            Resolution::Minute30,
            Resolution::Minute60,
            Resolution::Day,
            Resolution::Week,
            Resolution::Month,
        ],
        adjustments: &[Adjustment::None, Adjustment::Qfq],
    },
};

#[cfg(feature = "provider-binance")]
pub static BINANCE_SPOT_PROVIDER_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
    id: "binance_spot",
    display_name: "Binance 现货",
    version: "1",
    contract_version: ADAPTER_CONTRACT_VERSION,
    enabled: true,
    capabilities: ProviderCapabilities {
        catalog: true,
        history: true,
        quote: true,
        realtime: true,
        venues: &["BINANCE"],
        kinds: &[SymbolKind::Crypto],
        resolutions: &[
            Resolution::Minute1,
            Resolution::Minute5,
            Resolution::Minute15,
            Resolution::Minute30,
            Resolution::Minute60,
            Resolution::Day,
            Resolution::Week,
            Resolution::Month,
        ],
        adjustments: &[Adjustment::None],
    },
};

#[cfg(not(feature = "provider-binance"))]
pub static BINANCE_SPOT_DISABLED_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
    id: "binance_spot",
    display_name: "Binance 现货",
    version: "1",
    contract_version: ADAPTER_CONTRACT_VERSION,
    enabled: false,
    capabilities: ProviderCapabilities {
        catalog: false,
        history: false,
        quote: false,
        realtime: false,
        venues: &["BINANCE"],
        kinds: &[SymbolKind::Crypto],
        resolutions: &[],
        adjustments: &[],
    },
};

#[cfg(feature = "provider-binance")]
pub static BINANCE_USDM_PROVIDER_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
    id: "binance_usdm",
    display_name: "Binance USD-M 永续",
    version: "1",
    contract_version: ADAPTER_CONTRACT_VERSION,
    enabled: true,
    capabilities: ProviderCapabilities {
        catalog: true,
        history: true,
        quote: true,
        realtime: true,
        venues: &["BINANCE_USDM"],
        kinds: &[SymbolKind::Crypto],
        resolutions: &[
            Resolution::Minute1,
            Resolution::Minute5,
            Resolution::Minute15,
            Resolution::Minute30,
            Resolution::Minute60,
            Resolution::Day,
            Resolution::Week,
            Resolution::Month,
        ],
        adjustments: &[Adjustment::None],
    },
};

#[cfg(not(feature = "provider-binance"))]
pub static BINANCE_USDM_DISABLED_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
    id: "binance_usdm",
    display_name: "Binance USD-M 永续",
    version: "1",
    contract_version: ADAPTER_CONTRACT_VERSION,
    enabled: false,
    capabilities: ProviderCapabilities {
        catalog: false,
        history: false,
        quote: false,
        realtime: false,
        venues: &["BINANCE_USDM"],
        kinds: &[SymbolKind::Crypto],
        resolutions: &[],
        adjustments: &[],
    },
};

#[cfg(feature = "provider-polymarket")]
pub static POLYMARKET_PROVIDER_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
    id: "polymarket",
    display_name: "Polymarket 预测市场",
    version: "1",
    contract_version: ADAPTER_CONTRACT_VERSION,
    enabled: true,
    capabilities: ProviderCapabilities {
        catalog: true,
        history: true,
        quote: false,
        realtime: true,
        venues: &["POLYMARKET"],
        kinds: &[SymbolKind::Prediction],
        resolutions: &[
            Resolution::Minute1,
            Resolution::Minute5,
            Resolution::Minute15,
            Resolution::Minute30,
            Resolution::Minute60,
            Resolution::Day,
            Resolution::Week,
            Resolution::Month,
        ],
        adjustments: &[Adjustment::None],
    },
};

#[cfg(test)]
mod tests {
    use super::{
        ADAPTER_CONTRACT_VERSION, AdapterRegistration, AdapterRegistry, HistoryRequest,
        HistoryResponse, MarketDataAdapter, ProviderCapabilities, ProviderDescriptor,
        is_valid_provider_id,
    };
    use crate::contracts::{Adjustment, AppError, Resolution, SymbolKind};

    static INVALID_ID_DESCRIPTOR: ProviderDescriptor = ProviderDescriptor {
        id: "bad|provider",
        display_name: "Invalid provider",
        version: "1",
        contract_version: ADAPTER_CONTRACT_VERSION,
        enabled: true,
        capabilities: ProviderCapabilities {
            catalog: false,
            history: true,
            quote: false,
            realtime: false,
            venues: &["INVALID"],
            kinds: &[SymbolKind::Stock],
            resolutions: &[Resolution::Day],
            adjustments: &[Adjustment::None],
        },
    };

    struct InvalidIdAdapter;
    static INVALID_ID_ADAPTER: InvalidIdAdapter = InvalidIdAdapter;

    impl MarketDataAdapter for InvalidIdAdapter {
        fn descriptor(&self) -> &'static ProviderDescriptor {
            &INVALID_ID_DESCRIPTOR
        }

        fn fetch_history(&self, _request: HistoryRequest) -> Result<HistoryResponse, AppError> {
            unreachable!("invalid provider descriptor must be rejected before invocation")
        }
    }

    #[test]
    fn provider_id_grammar_matches_frontend_identity_keys() {
        assert!(is_valid_provider_id("example.provider"));
        assert!(is_valid_provider_id("a_b-c.1"));
        assert!(!is_valid_provider_id(""));
        assert!(!is_valid_provider_id(&"a".repeat(65)));
        for value in ["bad|provider", "bad provider", "bad\nprovider", "行情源"] {
            assert!(!is_valid_provider_id(value), "{value:?} must be rejected");
        }
    }

    #[test]
    fn registry_rejects_invalid_provider_id() {
        let error = match AdapterRegistry::new([AdapterRegistration::new(&INVALID_ID_ADAPTER)]) {
            Ok(_) => panic!("invalid provider id must be rejected"),
            Err(error) => error,
        };
        assert_eq!(error.code, "invalid_provider_descriptor");
    }
}
