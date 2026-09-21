import { readFileSync } from 'node:fs';
import {
  listMarketSymbols,
  mergeMarketCatalogPage,
  marketSymbolFromCatalog,
  marketSymbolMatchesSource,
  searchMarketSymbols,
} from '../src/market-universe.ts';
import { binanceSpotSymbols, buildBinanceSpotSymbols } from '../src/providers/binance/catalog.ts';
import { binanceUsdMarginedSymbols, buildBinanceUsdMarginedSymbols } from '../src/providers/binance/usdm-catalog.ts';

const marketPackage = JSON.parse(readFileSync(new URL('../src/market-universe.json', import.meta.url), 'utf8'));
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const rows = [...marketPackage.rows, ...binanceSpotSymbols, ...binanceUsdMarginedSymbols];

const customProvider = {
  id: 'custom-feed',
  displayName: 'Custom Feed',
  version: '1',
  contractVersion: '2',
  enabled: true,
  capabilities: {
    catalog: true,
    history: true,
    quote: false,
    realtime: true,
    venues: ['CUSTOM'],
    kinds: ['crypto'],
    resolutions: ['1'],
    adjustments: ['none'],
  },
};
const customSymbol = marketSymbolFromCatalog({
  providerId: 'custom-feed',
  symbol: 'CUSTOM:ABCUSD',
  name: 'ABC / USD',
  kind: 'crypto',
  baseAsset: 'ABC',
  quoteAsset: 'USD',
}, customProvider, 'CUSTOM');
if (customSymbol.providerId !== 'custom-feed' || customSymbol.venue !== 'CUSTOM'
  || customSymbol.providerDisplayName !== 'Custom Feed' || customSymbol.realtime !== true) {
  throw new Error('provider-neutral catalog metadata conversion failed');
}
if (customSymbol.exchange !== 'CUSTOM' || customSymbol.baseAsset !== 'ABC') {
  throw new Error('catalog compatibility display metadata failed');
}

const predictionProvider = {
  id: 'polymarket',
  displayName: 'Polymarket 预测市场',
  version: '1',
  contractVersion: '2',
  enabled: true,
  capabilities: {
    catalog: true,
    history: true,
    quote: false,
    realtime: true,
    venues: ['POLYMARKET'],
    kinds: ['prediction'],
    resolutions: ['1', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M'],
    adjustments: ['none'],
  },
};
const predictionMetadata = {
  conditionId: 'condition-1',
  outcome: 'YES',
  opposingSymbol: 'POLYMARKET:NO_TOKEN',
  description: 'Resolves from the published source.',
  resolutionSource: 'https://example.com/rules',
  endDate: '2026-12-31T00:00:00Z',
  volume: 120000,
  liquidity: 45000,
  probability: 62.5,
  change24h: 3.2,
};
const predictionSymbol = marketSymbolFromCatalog({
  providerId: 'polymarket',
  symbol: 'POLYMARKET:YES_TOKEN',
  name: 'Will the event happen?',
  kind: 'prediction',
  prediction: predictionMetadata,
}, predictionProvider, 'POLYMARKET');
if (predictionSymbol.code !== 'YES 62.5%' || predictionSymbol.prediction?.opposingSymbol !== 'POLYMARKET:NO_TOKEN') {
  throw new Error('prediction catalog metadata conversion failed');
}
if (!searchMarketSymbols([predictionSymbol], 'condition-1').length) {
  throw new Error('prediction condition-id search failed');
}
if (!marketSymbolMatchesSource(predictionSymbol, 'prediction', 'polymarket')) {
  throw new Error('Polymarket source hierarchy failed');
}

const stock = searchMarketSymbols(rows, '600000')[0];
if (stock?.symbol !== 'SH:600000' || stock.kind !== 'stock') throw new Error('stock code search failed');
if (searchMarketSymbols(rows, '浦发银行')[0]?.symbol !== 'SH:600000') throw new Error('Chinese name search failed');
if (searchMarketSymbols(rows, 'PAYH')[0]?.symbol !== 'SZ:000001') throw new Error('alias search failed');
const exactIndex = searchMarketSymbols(rows, 'SH:000001')[0];
if (exactIndex?.kind !== 'index') throw new Error('exchange-qualified index search failed');
const ambiguous = searchMarketSymbols(rows, '000001', 10);
if (!ambiguous.some((item) => item.symbol === 'SZ:000001' && item.kind === 'stock')) throw new Error('ambiguous stock result missing');
if (!ambiguous.some((item) => item.symbol === 'SH:000001' && item.kind === 'index')) throw new Error('ambiguous index result missing');
if (searchMarketSymbols(rows, '').length !== 0) throw new Error('empty search must have no results');

const fixtures = [
  { symbol: 'SH:600000', code: '600000', name: '浦发银行', exchange: 'SH', kind: 'stock' },
  { symbol: 'SH:688001', code: '688001', name: '科创样本', exchange: 'SH', kind: 'stock' },
  { symbol: 'SZ:000001', code: '000001', name: '平安银行', exchange: 'SZ', kind: 'stock' },
  { symbol: 'SZ:302132', code: '302132', name: '创业样本', exchange: 'SZ', kind: 'stock' },
  { symbol: 'BJ:920000', code: '920000', name: '北交样本', exchange: 'BJ', kind: 'stock' },
  { symbol: 'SH:000001', code: '000001', name: '上证指数', exchange: 'SH', kind: 'index' },
  { symbol: 'SZ:159915', code: '159915', name: '创业板ETF', exchange: 'SZ', kind: 'etf' },
  { symbol: 'BINANCE:BTCUSDT', code: 'BTC/USDT', name: 'Bitcoin / TetherUS', exchange: 'BINANCE', kind: 'crypto', quoteAsset: 'USDT' },
  { symbol: 'BINANCE_USDM:BTCUSDT', code: 'BTC/USDT 永续', name: 'Bitcoin / TetherUS Perpetual', exchange: 'BINANCE_USDM', kind: 'crypto', quoteAsset: 'USDT' },
  { symbol: 'OKX:BTC-USDT', code: 'BTC/USDT', name: 'BTC / USDT', exchange: 'OKX', kind: 'crypto', quoteAsset: 'USDT' },
  { symbol: 'OKX_SWAP:BTC-USDT-SWAP', code: 'BTC/USDT 永续', name: 'BTC / USDT Perpetual', exchange: 'OKX_SWAP', kind: 'crypto', quoteAsset: 'USDT' },
  predictionSymbol,
];
const bundledBitcoin = binanceSpotSymbols[0];
const firstBinancePage = [{
  ...bundledBitcoin, symbol: 'BINANCE:AAAUSDT', code: 'AAA/USDT', name: 'AAA / USDT', baseAsset: 'AAA',
}];
const staleBinanceSymbol = {
  ...bundledBitcoin, symbol: 'BINANCE:STALEUSDT', code: 'STALE/USDT', name: 'STALE / USDT', baseAsset: 'STALE',
};
const okxBitcoin = {
  ...bundledBitcoin, providerId: 'okx_spot', providerDisplayName: 'OKX Spot', symbol: 'OKX:BTC-USDT', exchange: 'OKX', venue: 'OKX',
};
const mergedFirstPage = mergeMarketCatalogPage(
  [bundledBitcoin, staleBinanceSymbol, okxBitcoin],
  firstBinancePage,
  'binance_spot',
  'BINANCE',
  true,
  new Set(['binance_spot|BINANCE:BTCUSDT']),
);
if (!mergedFirstPage.some((item) => item.symbol === 'BINANCE:BTCUSDT')) {
  throw new Error('first catalog page discarded bundled Binance fallback outside the page');
}
if (mergedFirstPage.some((item) => item.symbol === 'BINANCE:STALEUSDT')) {
  throw new Error('first catalog page retained a stale non-bundled Binance symbol');
}
if (!mergedFirstPage.some((item) => item.symbol === 'OKX:BTC-USDT')) {
  throw new Error('catalog page merge disturbed another provider');
}
if (!/const MARKET_CATALOG_PAGE_SIZE = 1_000;/.test(mainSource)
  || !/descriptor\.id !== 'polymarket' && state\.nextCursor[\s\S]*loadRemainingMarketCatalogPages\(state\)/.test(mainSource)
  || !/while \(state\.nextCursor\)[\s\S]*loadNextMarketCatalogPage\(state\)/.test(mainSource)) {
  throw new Error('finite exchange catalogs must load every page instead of exposing only the first page');
}
if (!marketSymbolMatchesSource(fixtures[3], 'stock', 'chinext')) throw new Error('302 stock must be classified as ChiNext');
if (marketSymbolMatchesSource(fixtures[1], 'stock', 'sh_main')) throw new Error('STAR stock leaked into SH main board');
if (listMarketSymbols(fixtures, '', 'stock', 'star', 20)[0]?.symbol !== 'SH:688001') throw new Error('stock secondary filter failed');
if (listMarketSymbols(fixtures, '000001', 'index', 'all', 20)[0]?.kind !== 'index') throw new Error('primary category filter failed');
if (listMarketSymbols(fixtures, '', 'etf', 'sz', 20)[0]?.symbol !== 'SZ:159915') throw new Error('ETF exchange filter failed');
if (listMarketSymbols(rows, '899050', 'index', 'bj', rows.length)[0]?.symbol !== 'BJ:899050') throw new Error('BJ index missing from search');
if (listMarketSymbols(rows, '', 'stock', 'all', rows.length).length <= 80) throw new Error('full stock browse result was truncated');
if (searchMarketSymbols(rows, 'BTCUSD')[0]?.symbol !== 'BINANCE:BTCUSDT') throw new Error('Binance pair search failed');
if (!marketSymbolMatchesSource(fixtures[7], 'crypto', 'binance_spot')) throw new Error('Binance spot hierarchy failed');
if (listMarketSymbols(fixtures, '', 'crypto', 'binance_spot', 20)[0]?.symbol !== 'BINANCE:BTCUSDT') {
  throw new Error('crypto secondary filter failed');
}
if (listMarketSymbols(fixtures, '', 'crypto', 'binance_usdt', 20)[0]?.symbol !== 'BINANCE:BTCUSDT') {
  throw new Error('crypto quote-asset filter failed');
}
if (listMarketSymbols(fixtures, '', 'crypto', 'binance_usdm', 20)[0]?.symbol !== 'BINANCE_USDM:BTCUSDT') {
  throw new Error('USD-M perpetual secondary filter failed');
}
if (listMarketSymbols(fixtures, '', 'crypto', 'binance_usdm_usdt', 20)[0]?.symbol !== 'BINANCE_USDM:BTCUSDT') {
  throw new Error('USD-M perpetual quote-asset filter failed');
}
if (listMarketSymbols(fixtures, '', 'crypto', 'okx_spot_usdt', 20)[0]?.symbol !== 'OKX:BTC-USDT') {
  throw new Error('OKX spot quote-asset filter failed');
}
if (listMarketSymbols(fixtures, '', 'crypto', 'okx_swap_usdt', 20)[0]?.symbol !== 'OKX_SWAP:BTC-USDT-SWAP') {
  throw new Error('OKX swap quote-asset filter failed');
}
if (listMarketSymbols(fixtures, '', 'prediction', 'polymarket', 20)[0]?.symbol !== 'POLYMARKET:YES_TOKEN') {
  throw new Error('prediction category filter failed');
}
const dynamic = buildBinanceSpotSymbols([
  { symbol: 'WTRY', baseAsset: 'W', quoteAsset: 'TRY' },
  { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' },
]);
if (dynamic[0]?.symbol !== 'BINANCE:WTRY' || dynamic[0]?.quoteAsset !== 'TRY') {
  throw new Error('dynamic Binance catalog conversion failed');
}
if (dynamic[1]?.name !== 'Bitcoin / TetherUS') throw new Error('curated Binance symbol metadata was lost');
const perpetuals = buildBinanceUsdMarginedSymbols([
  { symbol: 'WIFUSDT', baseAsset: 'WIF', quoteAsset: 'USDT' },
  { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' },
]);
if (perpetuals[0]?.symbol !== 'BINANCE_USDM:WIFUSDT' || perpetuals[0]?.code !== 'WIF/USDT 永续') {
  throw new Error('dynamic Binance USD-M catalog conversion failed');
}
if (perpetuals[1]?.name !== 'Bitcoin / TetherUS Perpetual') {
  throw new Error('curated Binance USD-M symbol metadata was lost');
}

console.log(`Market search OK (${rows.length} instruments)`);
