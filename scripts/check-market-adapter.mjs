import assert from 'node:assert/strict';
import fs from 'node:fs';

const adapter = fs.readFileSync('src-tauri/src/market_adapter.rs', 'utf8');
const router = fs.readFileSync('src-tauri/src/market_router.rs', 'utf8');
const realtime = fs.readFileSync('src-tauri/src/realtime.rs', 'utf8');
const lib = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
const binance = fs.readFileSync('src-tauri/src/market_providers/binance.rs', 'utf8');
const okx = fs.readFileSync('src-tauri/src/market_providers/okx.rs', 'utf8');
const tdxHistory = fs.readFileSync('src-tauri/src/market_data/history.rs', 'utf8');
const frontendQuote = fs.readFileSync('src/quote.ts', 'utf8');
const frontendRealtime = fs.readFileSync('src/realtime-market.ts', 'utf8');
const frontendMain = fs.readFileSync('src/main.ts', 'utf8');

assert.match(adapter, /pub const ADAPTER_CONTRACT_VERSION: &str = "2"/);
assert.match(adapter, /pub struct PredictionMarketMetadata/);
assert.match(adapter, /Point \{\s*point: ProbabilityPoint/);
assert.match(adapter, /pub struct ProviderCapabilities/);
for (const field of ['catalog', 'history', 'quote', 'realtime']) {
  assert.match(adapter, new RegExp(`pub ${field}: bool`));
}
assert.match(adapter, /pub trait MarketDataAdapter/);
assert.match(adapter, /fn fetch_history\(&self, request: HistoryRequest\)/);
assert.match(adapter, /pub trait QuoteAdapter/);
assert.match(adapter, /pub struct QuoteResponse/);
assert.match(adapter, /pub trait CatalogAdapter/);
assert.match(adapter, /pub struct CatalogSymbol/);
assert.match(adapter, /pub struct CatalogPageRequest/);
assert.match(adapter, /pub struct CatalogPage/);
assert.match(adapter, /fn list_symbols_page\(/);
assert.doesNotMatch(adapter, /option_env!\("TRADEFLOW_POLYMARKET_GATEWAY_URL"\)/);
for (const field of ['provider_id', 'symbol', 'name', 'kind']) {
  assert.match(adapter, new RegExp(`pub ${field}:`));
}
assert.match(adapter, /pub trait RealtimeAdapter/);
assert.match(adapter, /pub struct RealtimeEventEnvelope/);
assert.match(adapter, /pub provider_id: &'static str/);
assert.match(adapter, /pub struct AdapterRegistration/);
assert.match(adapter, /pub struct AdapterRegistry/);
assert.match(adapter, /duplicate_provider_id/);
assert.match(adapter, /ambiguous_provider_route/);
assert.match(adapter, /pub struct MarketDataSnapshot<'a>/);
assert.match(adapter, /pub fn recent_bars\(&self, max_bars: usize\) -> &'a \[Bar\]/);
assert.doesNotMatch(adapter, /serde_json/);

assert.match(router, /static REGISTERED_ADAPTERS/);
assert.match(router, /AdapterRegistration::new\(&TDX_ADAPTER\)/);
assert.match(router, /AdapterRegistration::new\(&BINANCE_SPOT_ADAPTER\)/);
assert.match(router, /AdapterRegistration::new\(&BINANCE_USDM_ADAPTER\)/);
assert.match(router, /AdapterRegistration::new\(&OKX_SPOT_ADAPTER\)/);
assert.match(router, /AdapterRegistration::new\(&OKX_SWAP_ADAPTER\)/);
assert.match(router, /validate_history_capability\(registration, &request\)/);
assert.match(router, /pub fn fetch_quote\(/);
assert.match(router, /pub fn list_catalog\(/);
assert.match(router, /pub fn list_catalog_page\(/);
assert.doesNotMatch(router, /serde_json/);

assert.match(lib, /pub fn run_with_router\(router: MarketRouter\)/);
assert.match(lib, /\.manage\(router\)/);
assert.match(lib, /State<'_, MarketRouter>/);
assert.match(lib, /list_market_providers/);
assert.match(lib, /list_market_catalog/);
assert.match(lib, /list_market_catalog_page/);
assert.match(lib, /router\.fetch_history\(/);
assert.match(lib, /\.list_catalog\(CatalogRequest/);
assert.match(lib, /router\.fetch_quote\(/);
assert.match(frontendMain, /invoke<MarketCatalogPage>\('list_market_catalog_page'/);
assert.match(frontendMain, /function shouldLoadMorePolymarketSymbols/);
assert.match(frontendMain, /下滑继续加载/);
assert.match(frontendMain, /market\.catalog\.partial/);
assert.doesNotMatch(frontendMain, /while \(pages < 100\)/);

assert.match(realtime, /resolve_for_provider\(&provider_id, &symbol, &kind\)/);
assert.match(realtime, /provider_id/);
assert.match(realtime, /sequence/);
assert.doesNotMatch(realtime, /#\[cfg\(feature = "provider-binance"\)\][\s\S]*struct RealtimeTradePayload/);
const eventLoopStart = realtime.indexOf('start_realtime_registration');
assert.notEqual(eventLoopStart, -1);
const eventLoop = realtime.slice(eventLoopStart);
assert.doesNotMatch(eventLoop, /resolve_realtime_adapter|REGISTERED_ADAPTERS/);
assert.match(realtime, /request_id/);
assert.doesNotMatch(realtime, /market_data_source_unavailable[\s\S]*Binance 实时行情适配器未启用/);

assert.match(frontendQuote, /export type QuoteResponse/);
for (const field of ['providerId', 'symbol', 'source', 'quote']) {
  assert.match(frontendQuote, new RegExp(`${field}:`));
}
for (const field of ['providerId', 'sequence', 'tradeId', 'side', 'flags']) {
  assert.match(frontendRealtime, new RegExp(`${field}`));
}
assert.match(frontendRealtime, /eventTimeMs/);
assert.doesNotMatch(frontendRealtime, /lastUpdateId/);
assert.doesNotMatch(frontendRealtime, /aggregateTradeId|buyerIsMaker/);
assert.match(frontendRealtime, /sequence > previousSequence/);
assert.match(adapter, /Depth \{\s*event_time_ms: i64/);
assert.doesNotMatch(adapter, /last_update_id/);

// History owns one router-level full-series validation. Binance must not add a
// second full pass; depth sequence extraction must not clone the whole update.
assert.doesNotMatch(binance, /Bar::validate_series\(&bars\)/);
assert.match(binance, /u64::try_from\(depth\.last_update_id\)\.ok\(\)/);
assert.doesNotMatch(binance, /RealtimeEvent::Depth\(depth\.clone\(\)\)/);
assert.match(okx, /impl MarketDataAdapter for OkxSpotAdapter/);
assert.match(okx, /impl MarketDataAdapter for OkxSwapAdapter/);
assert.match(okx, /HISTORY_PAGE_DELAY/);
assert.match(okx, /request\.is_active\(\)/);
assert.match(okx, /market_quantity/);
assert.match(tdxHistory, /market\.history\.quote_degraded provider=tdx/);

console.log('market adapter structural contract: OK');
