import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  enabledProviderIds,
  loadMarketProviderPreferences,
  marketProviderSelectionChanged,
  marketProviderPreferencesKey,
  providerForMarketSource,
  providerIsAvailable,
  saveMarketProviderPreferences,
  showTdxAdjustmentControls,
} from '../src/market-edition.ts';

const descriptors = [
  { id:'tdx', displayName:'TDX', version:'1', contractVersion:'1', enabled:false,
    capabilities:{ catalog:false, history:true, quote:true, realtime:false, venues:['SH'], kinds:['stock'], resolutions:['1D'], adjustments:['none'] } },
  { id:'binance_spot', displayName:'Binance', version:'1', contractVersion:'1', enabled:true,
    capabilities:{ catalog:true, history:true, quote:true, realtime:true, venues:['BINANCE'], kinds:['crypto'], resolutions:['1D'], adjustments:['none'] } },
  { id:'missing', displayName:'Missing', version:'1', contractVersion:'1', enabled:false,
    capabilities:{ catalog:false, history:false, quote:false, realtime:false, venues:['X'], kinds:['stock'], resolutions:[], adjustments:[] } },
];

assert.equal(marketProviderPreferencesKey('cn'), 'tradeflow-lite.market-providers.cn.v1');
assert.equal(marketProviderPreferencesKey('global'), 'tradeflow-lite.market-providers.global.v1');
assert.notEqual(marketProviderPreferencesKey('cn'), marketProviderPreferencesKey('global'));
assert.equal(providerIsAvailable(descriptors[0]), true);
assert.equal(providerIsAvailable(descriptors[2]), false);
assert.deepEqual([...enabledProviderIds(descriptors)], ['binance_spot']);
assert.equal(marketProviderSelectionChanged(new Set(['binance_spot']), new Set(['binance_spot'])), false);
assert.equal(marketProviderSelectionChanged(new Set(['binance_spot', 'tdx']), new Set(['binance_spot'])), true);
assert.equal(marketProviderSelectionChanged(new Set(['tdx']), new Set(['binance_spot'])), true);
assert.equal(providerForMarketSource('sh'), 'tdx');
assert.equal(providerForMarketSource('binance_usdt'), 'binance_spot');
assert.equal(providerForMarketSource('binance_usdm_usdt'), 'binance_usdm');
assert.equal(providerForMarketSource('okx_swap_usdt'), 'okx_swap');
assert.equal(providerForMarketSource('polymarket'), 'polymarket');
assert.equal(providerForMarketSource('all'), null);
assert.equal(showTdxAdjustmentControls({ ...descriptors[0], enabled:true, capabilities:{ ...descriptors[0].capabilities, adjustments:['none','qfq'] } }, 'tdx'), true);
assert.equal(showTdxAdjustmentControls({ ...descriptors[0], enabled:false, capabilities:{ ...descriptors[0].capabilities, adjustments:['none','qfq'] } }, 'tdx'), false);
assert.equal(showTdxAdjustmentControls({ ...descriptors[1], enabled:true, capabilities:{ ...descriptors[1].capabilities, adjustments:['none','qfq'] } }, 'binance_spot'), false);

const values = new Map();
const storage = {
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, value); },
};
assert.equal(loadMarketProviderPreferences(storage, 'global', descriptors), null);
assert.equal(saveMarketProviderPreferences(storage, 'global', ['tdx','binance_spot','missing']), true);
assert.deepEqual([...loadMarketProviderPreferences(storage, 'global', descriptors)], ['binance_spot','tdx']);
assert.equal(loadMarketProviderPreferences(storage, 'cn', descriptors), null, 'edition preferences must not leak across builds');

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
for (const phrase of [
  "invoke<MarketEditionInfo>('get_market_edition')",
  "invoke('set_market_provider_enabled'",
  "activeMarketProviderIds.has('tdx') ? staticTdxSymbols : []",
  "defaultSymbol.providerId === 'none'",
  "showNoMarketProviderState()",
  "marketSourceEnabled(source.value)",
  "compiledMarketKinds.has('stock')",
  "showTdxAdjustmentControls(descriptor, symbol.providerId)",
]) assert.ok(main.includes(phrase), `main edition wiring missing: ${phrase}`);
assert.match(main, /currentSymbol\.providerId === 'none'[\s\S]*scheduleLatestPoll/);
assert.match(main, /id="adjustment-switcher"[\s\S]*activeMarketProviderIds\.has\('tdx'\).*hidden/);

const router = readFileSync(new URL('../src-tauri/src/market_router.rs', import.meta.url), 'utf8');
assert.match(router, /Self::Global[\s\S]*"binance_spot"/);
assert.doesNotMatch(router, /Self::Core/);
assert.match(router, /#\[cfg\(tradeflow_tdx\)\][\s\S]*AdapterRegistration::new\(&TDX_ADAPTER\)/);
assert.match(router, /require_provider_enabled\(&request\.provider_id\)/);
assert.match(router, /market_data_source_disabled/);

const devConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const releaseConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.release.conf.json', import.meta.url), 'utf8'));
assert.equal(devConfig.identifier, 'com.tradeflow.lite.dev');
assert.equal(devConfig.bundle.active, false, 'development must not accidentally become a distributable build');
assert.equal(releaseConfig.identifier, 'com.tradeflow.lite');
assert.equal(releaseConfig.bundle.active, true);
assert.deepEqual(releaseConfig.bundle.icon, [
  'icons/32x32.png',
  'icons/128x128.png',
  'icons/128x128@2x.png',
  'icons/icon.icns',
  'icons/icon.ico',
]);

const runner = readFileSync(new URL('run-edition.mjs', import.meta.url), 'utf8');
assert.match(runner, /TRADEFLOW_LITE_EDITION: edition/);
assert.match(runner, /VITE_TRADEFLOW_LITE_EDITION: edition/);
assert.match(runner, /command === 'build'.*tauri\.release\.conf\.json/);
assert.match(runner, /isWindows.*tauri\.windows\.release\.conf\.json/);
assert.match(runner, /edition === 'cn' \? \['--features', 'provider-tdx'\] : \[\]/);
assert.doesNotMatch(runner, /['"]core['"]/);

const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
assert.match(cargo, /provider-tdx = \["dep:tradeflow-tdx"\]/);
assert.match(cargo, /tradeflow-tdx = \{ git = "https:\/\/github\.com\/hongchanho93\/tradeflow-tdx\.git", rev = "8b2b01905369c795e0c434288c038fe037ef519f", optional = true \}/);
assert.doesNotMatch(cargo, /tradeflow-tdx = \{ path =/);
const buildScript = readFileSync(new URL('../src-tauri/build.rs', import.meta.url), 'utf8');
assert.match(buildScript, /CN edition requires the provider-tdx Cargo feature/);
assert.match(buildScript, /Global edition must not compile the provider-tdx Cargo feature/);

const windowsReleaseAdapter = readFileSync(new URL('vite.windows-release.config.mjs', import.meta.url), 'utf8');
assert.match(windowsReleaseAdapter, /await workspaceStorage\.flush\(\);/);
assert.doesNotMatch(windowsReleaseAdapter, /BUNDLED_CVD|crypto-orderflow-cvd|USER_PLUGIN_GLOB/);

const releaseWorkflow = readFileSync(new URL('../.github/workflows/release-editions.yml', import.meta.url), 'utf8');
assert.match(releaseWorkflow, /tags:\s*\n\s*- 'v\*'/, 'only version tags should start an automatic package build');
assert.match(releaseWorkflow, /releaseDraft: true/, 'generated installers require review before publication');
assert.match(releaseWorkflow, /tauri\.windows\.release\.conf\.json/, 'Windows packages require the Windows release adapter');
assert.match(releaseWorkflow, /edition: cn[\s\S]*edition: global/, 'both editions must be packaged');

console.log('market editions: ok');
