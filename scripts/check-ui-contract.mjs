import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const markup = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const tauriConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const defaultCapability = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
const upArrowTool = readFileSync(new URL('../src/drawing-tools/up-arrow.ts', import.meta.url), 'utf8');
const chartTypeAssets = {
  'bars.svg': 'cae5df3735549d56910a2e85697368ffb2241a151aabd33050b394559ec9fc56',
  'candles.svg': '2b38951b31df70e53877de729df3308bf0654ee1dda04b7a6b1e29410bda80ce',
  'line.svg': 'bb5e94bfc98785376d190ee119e3be88cf3cbb0ea68df4b3105314385ef79d35',
  'area.svg': 'ce42c218c4450d69e302e10d08223c6ac4a4b35996903858f505f14eb7d53e74',
  'baseline.svg': 'bcb64ff09e873637792e4ec52ed8b2c054d37930c6b9d54d8b93cb4e4fd2bff5',
};

const requiredMarkup = [
  'chart-toolbar',
  'drawing-toolbar',
  'ohlc-legend',
  'volume-legend',
  'connection-status',
  'benchmark_hosts',
  'list_market_providers',
  'list_market_catalog',
  'start_realtime_market',
  'stop_realtime_market',
  'report_realtime_render_health',
  'market-realtime-bar',
  'market-realtime-status',
  'market-realtime-depth',
  'market-realtime-trade',
  'market-realtime-point',
  'updateLatestBarInPlace(currentBars, event.bar)',
  'scheduleRealtimeIndicators(event.bar.time)',
  'marketDataRenderDelay(now, lastMarketDataRenderAt)',
  'realtimeFrameFallbackTimerId = window.setTimeout',
  'fallbackFlushes: realtimeHealthFallbackFlushes',
  'ensureMarketRows(marketTrades, recentTrades.length',
  'loadMarketCatalogs',
  'marketSymbolFromCatalog',
  'providerId: symbol.providerId',
  'if (!range || !deepHistoryNavigationReady) return;',
  'providerDisplayName',
  '正在测试 19 台主站',
  'HistogramSeries',
  'subscribeCrosshairMove',
  'id="open"',
  'id="refresh"',
  'id="fit-chart"',
  'id="market-data-toggle"',
  'id="market-data-panel"',
  'data-market-data-tab="depth"',
  'data-market-data-tab="trades"',
  'id="open-chart-settings"',
  'id="language-select"',
  '<option value="zh-CN">简体中文</option><option value="en-US">English</option>',
  'observeLocalizedUi(appRoot, appLocale)',
  'saveAppLocale(localStorage, nextLocale)',
  'id="chart-settings-layer"',
  'id="chart-settings-dialog"',
  'data-settings-tab="symbol"',
  'data-settings-tab="status"',
  'data-settings-tab="scales"',
  'data-settings-tab="appearance"',
  'id="confirm-chart-settings"',
  'id="cancel-chart-settings"',
  'openChartSettings',
  'applyChartSettings',
  'id="chart-type-menu"',
  'data-chart-type="candles"',
  'data-chart-type="bars"',
  'data-chart-type="line"',
  'data-chart-type="area"',
  'data-chart-type="baseline"',
  "./assets/chart-types/bars.svg?raw",
  "./assets/chart-types/candles.svg?raw",
  "./assets/chart-types/line.svg?raw",
  "./assets/chart-types/area.svg?raw",
  "./assets/chart-types/baseline.svg?raw",
  'id="price-scale-controls"',
  './assets/price-scale-gear.svg?raw',
  'class="price-scale-gear"',
  'data-price-scale="normal"',
  'data-price-scale="logarithmic"',
  'data-price-scale="percentage"',
  'data-price-scale="indexed"',
  'id="price-scale-auto"',
  'id="price-scale-invert"',
  'id="price-scale-manual"',
  'setAutoScale',
  'setVisibleRange',
  'invertScale',
  'id="time-navigation"',
  'data-time-range="1m"',
  'data-time-range="all"',
  'id="go-to-date"',
  'id="go-to-latest"',
  'scrollToRealTime',
  'panLogicalRange',
  'id="marker-tool"',
  'id="marker-editor"',
  'id="marker-shape"',
  'id="marker-position"',
  'persistMarkers',
  'markerScope',
  'seriesMarkerApis',
  'managed-series-row',
  'setSeriesOrder',
  'id="previous-close-toggle"',
  'id="edit-cost-price"',
  'renderPriceLines',
  'id="price-line-editor"',
  'id="price-line-input"',
  'id="chart-capture-menu"',
  'takeScreenshot(true, true)',
  'id="copy-chart"',
  'id="save-chart"',
  'object-tree-pane-order',
  'swapPanes',
  'id="volume-toggle"',
  'id="watchlist-add"',
  'id="watchlist-toggle"',
  'watchlist-panel',
  'moveWatchlistSymbol',
  'indicator-menu',
  'data-indicator="ma"',
  'data-indicator="ema"',
  'data-indicator="boll"',
  'data-indicator="macd"',
  'data-indicator="rsi"',
  'ensureMacdPane',
  'ensureRsiPane',
  'id="symbol-results"',
  'id="symbol-search-dialog"',
  'id="symbol-dialog-input"',
  'data-symbol-category="all"',
  'data-symbol-category="stock"',
  'data-symbol-category="index"',
  'data-symbol-category="etf"',
  'data-symbol-category="crypto"',
  'data-symbol-category="prediction"',
  'id="symbol-source-trigger"',
  'id="symbol-source-menu"',
  'id="symbol-dialog-close"',
  'id="prediction-rules-tab"',
  'id="prediction-rules-view"',
  'id="prediction-yes"',
  'id="prediction-no"',
  'renderPredictionRules',
  'normalizeProbabilityHistory',
  'listMarketSymbols',
  'appendNextSymbolResults',
  "symbolResults.addEventListener('scroll'",
  'createSymbolLogo',
  'createExchangeBadge',
  'IntersectionObserver',
  "image.loading = 'lazy'",
  "image.decoding = 'async'",
  'symbol-logo-placeholder',
  "kind: symbol.kind",
  'RESOLUTION_OPTIONS',
  'id="resolution-menu"',
  'data-favorite-resolution="${option.value}"',
  'id="trading-time-menu"',
  'data-trading-time="${option.value}"',
  'tickMarkFormatter: formatChartTick',
  "resolution: requestedResolution",
  'data-adjustment="none"',
  'data-adjustment="qfq"',
  "adjustment: requestedAdjustment",
  'includeQuote: true',
  'pollLatestBars',
  'mergeLatestBars',
  'INITIAL_HISTORY_BARS',
  'deepHistoryBars',
  'HistoryMemoryCache',
  'historyCacheKey',
  'shouldLoadDeepHistory',
  'getVisibleRange',
  'setVisibleRange',
  'market.history.deep_ready',
  'initialVisibleLogicalRange',
  'createLineToolsPlugin',
  'data-drawing-tool="TrendLine"',
  'data-drawing-tool="Rectangle"',
  'data-drawing-tool="Circle"',
  'data-drawing-tool="FibRetracement"',
  'data-drawing-tool="Ray"',
  'data-drawing-tool="Arrow"',
  'data-drawing-tool="HorizontalLine"',
  'data-drawing-tool="ParallelChannel"',
  'data-drawing-tool="Brush"',
  'data-drawing-tool="Text"',
  'data-drawing-tool="PriceRange"',
  'data-drawing-tool="LongShortPosition"',
  'data-drawing-tool="UpArrow"',
  'data-drawing-tool="ExtendedLine"',
  'data-drawing-tool="HorizontalRay"',
  'data-drawing-tool="VerticalLine"',
  'data-drawing-tool="CrossLine"',
  'data-drawing-tool="Callout"',
  'data-drawing-tool="Highlighter"',
  'data-drawing-tool="Triangle"',
  'data-drawing-tool="Path"',
  "registerLineTool('ExtendedLine', LineToolExtendedLine)",
  "registerLineTool('HorizontalRay', LineToolHorizontalRay)",
  "registerLineTool('VerticalLine', LineToolVerticalLine)",
  "registerLineTool('CrossLine', LineToolCrossLine)",
  "registerLineTool('Callout', LineToolCallout)",
  "registerLineTool('Highlighter', LineToolHighlighter)",
  "registerLineTool('Triangle', LineToolTriangle)",
  "registerLineTool('Path', LineToolPath)",
  'drawing-properties',
  'id="undo-drawing"',
  'id="redo-drawing"',
  'id="drawing-manager-toggle"',
  "from './assets/drawing-toolbar/zoom.svg?raw'",
  "from './assets/drawing-toolbar/cursor.svg?raw'",
  "from './assets/drawing-toolbar/magnet.svg?raw'",
  "from './assets/drawing-toolbar/lock.svg?raw'",
  "from './assets/drawing-toolbar/lock-active.svg?raw'",
  "from './assets/drawing-toolbar/undo.svg?raw'",
  "from './assets/drawing-toolbar/redo.svg?raw'",
  "from './assets/drawing-toolbar/object-tree.svg?raw'",
  "from './assets/drawing-toolbar/trash.svg?raw'",
  'data-icon-state="unlocked"',
  'data-icon-state="locked"',
  'id="crosshair-tool" class="rail-button active" aria-label="鼠标指针" title="鼠标指针"',
  'drawing-manager-items',
  'commitDrawingState',
  'restoreDrawingScope',
  'createSeriesMarkers',
  'BollingerBandPrimitive',
  '突破上轨',
  '跌破下轨',
  'drawing-property-grip',
  'drawing-property-popover',
  'drawing-tool-menu-section',
  'subscribeLineToolsSingleClick',
  'applyLineToolOptions',
  'drawing-tool-menu',
  'drawing-text-editor',
  'drawing-mode-hint',
];
const forbiddenMarkup = [
  'app-titlebar',
  'workspace-tab',
  'title-home',
  '尚未接入',
  'right-toolbar',
  'range-toolbar',
  'price-badges',
  'market-closed',
  'status-tab',
  'ticker',
  '卖出',
  '买入',
  '模拟账户',
  '信号',
  '快讯',
];
const requiredStyles = [
  '--tv-bg',
  '--tv-toolbar-bg',
  '--tv-border',
  '--tf-shell-toolbar-height: 48px',
  '--tf-shell-drawing-width: 52px',
  'width: 260px',
  'height: 40px',
  '.workspace',
  '.symbol-results',
  '.symbol-dialog-layer',
  '.symbol-search-dialog',
  '.symbol-category-tabs',
  '.symbol-source-menu',
  '.symbol-dialog-footer',
  '.symbol-result-name',
  '.symbol-result-exchange',
  '.resolution-switcher',
  '.adjustment-switcher',
  '.indicator-menu',
  '.chart-control-menu',
  '.chart-control-menu-panel',
  'font: 14px/18px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
  '.price-line-menu-item',
  '.price-line-editor-popover',
  '.price-scale-controls',
  '.price-scale-menu',
  '.price-range-editor',
  '.time-navigation',
  '.marker-editor-popover',
  '.managed-series-row',
  '.marker-object-row',
  '.drawing-manager-section',
  '.chart-toast',
  '.watchlist-panel',
  '.watchlist-row',
  '.market-data-panel',
  '.market-depth-row',
  '.market-trade-row',
  '.prediction-rules-view',
  '.prediction-outcomes',
  '.drawing-toolbar',
  '.drawing-mode-hint',
  '.drawing-tool-menu',
  '.drawing-text-editor',
  '.drawing-properties',
  '.drawing-manager',
  '.drawing-manager-row',
  '.rail-button[data-drawing-tool].active',
  '.connection-status',
  '.chart-settings-layer',
  '.chart-settings-dialog',
  '.chart-settings-tabs',
  '.chart-settings-panel',
  '.chart-settings-footer',
  '.chart-brand[hidden], .time-navigation[hidden], .instrument-logo[hidden] { display: none;',
  ':focus-visible',
];

for (const contract of requiredMarkup) {
  if (!markup.includes(contract)) throw new Error(`missing UI contract: ${contract}`);
}
for (const contract of forbiddenMarkup) {
  if (markup.includes(contract)) throw new Error(`forbidden UI contract: ${contract}`);
}
if (markup.includes("item.name.slice(0, 1)")) throw new Error('search result still uses first-character avatar');
if (markup.includes("candles: icon('<path") || markup.includes("bars: icon('<path")) {
  throw new Error('chart type menu still uses recreated inline icons');
}
if (markup.includes('id="price-scale-label"')) throw new Error('price scale trigger still exposes mode text instead of the Trade Flow gear');
if (markup.includes('image.src = exchangeLogoUrl(exchange)')) throw new Error('exchange logos are still eagerly loaded');
const mainWindow = tauriConfig.app?.windows?.[0];
if (mainWindow?.decorations !== true) throw new Error('native window title bar is not enabled');
if (mainWindow?.resizable !== true) throw new Error('native window resizing is not enabled');
if (!defaultCapability.permissions?.includes('core:event:allow-listen')) {
  throw new Error('Tauri main window cannot listen for realtime market events');
}
if (markup.includes('data-tauri-drag-region') || markup.includes('window-drag-region')) {
  throw new Error('custom drag region remains after restoring native window chrome');
}
if (markup.includes('currentBars = mergeLatestBars(currentBars, [event.bar])')) {
  throw new Error('realtime still rebuilds and sorts the complete history on every forming-bar update');
}
if (markup.includes('marketDepthAsks.replaceChildren();') || markup.includes('marketDepthBids.replaceChildren();')) {
  throw new Error('realtime depth still destroys every DOM row before each update');
}
const openHistoryBody = markup.slice(markup.indexOf('async function openHistory('), markup.indexOf('async function pollLatestBars('));
if (openHistoryBody.includes('scheduleDeepHistory(')) {
  throw new Error('opening a symbol still schedules an automatic deep-history replacement over realtime');
}
if (!markup.includes('shouldLoadDeepHistory(range.from') || !markup.includes('scheduleDeepHistory(\n      currentSymbol,')) {
  throw new Error('deep history must remain available when the user reaches the left history edge');
}
for (const contract of [
  '#chart-type-menu > summary { width: 40px; min-width: 40px; height: 40px;',
  '.chart-type-options { width: 156px;',
  '.chart-type-options > button { min-height: 40px;',
  '.chart-type-options svg, #chart-type-menu > summary svg { width: 28px; height: 28px; flex: 0 0 28px;',
  '.chart-type-options > button.active { color: #1f1f1f; background: #f2f2f2;',
]) {
  if (!styles.includes(contract)) throw new Error(`chart type menu scale differs from Trade Flow: ${contract}`);
}
for (const contract of [
  '.price-scale-controls > summary { width: 28px; height: 28px;',
  '.price-scale-controls > summary svg { width: 18px; height: 18px;',
]) {
  if (!styles.includes(contract)) throw new Error(`price scale gear differs from Trade Flow: ${contract}`);
}
if (styles.includes('border: 1px solid rgba(255, 255, 255, .12); border-radius: 50%; background: #f2f3f5;')) {
  throw new Error('symbol logos still have a forced white circular frame');
}
if (!styles.includes('overflow: hidden; border-radius: 50%;')) {
  throw new Error('symbol logos are not consistently circular');
}
for (const contract of requiredStyles) {
  if (!styles.includes(contract)) throw new Error(`missing style contract: ${contract}`);
}
for (const [file, expectedHash] of Object.entries(chartTypeAssets)) {
  const content = readFileSync(new URL(`../src/assets/chart-types/${file}`, import.meta.url));
  const actualHash = createHash('sha256').update(content).digest('hex');
  if (actualHash !== expectedHash) throw new Error(`chart type asset differs from UI extract: ${file}`);
}
for (const contract of ['class LineToolUpArrow', 'class LineToolUpArrowPaneView', 'PolygonRenderer', "toolType = 'UpArrow'"]) {
  if (!upArrowTool.includes(contract)) throw new Error(`missing up-arrow contract: ${contract}`);
}

console.log(`UI contract OK (${requiredMarkup.length + requiredStyles.length + forbiddenMarkup.length + 12 + Object.keys(chartTypeAssets).length} assertions)`);
