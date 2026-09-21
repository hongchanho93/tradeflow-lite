import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  LineSeries,
  PriceScaleMode,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type AutoscaleInfo,
  type IPaneApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import packageInfo from '../package.json' with { type: 'json' };
import { createLineToolsPlugin, roundPriceToStep, type LineToolType } from 'lightweight-charts-line-tools-core';
import { LineToolCircle } from 'lightweight-charts-line-tools-circle';
import { LineToolFibRetracement } from 'lightweight-charts-line-tools-fib-retracement';
import { LineToolBrush, LineToolHighlighter } from 'lightweight-charts-line-tools-freehand';
import {
  LineToolArrow,
  LineToolCallout,
  LineToolCrossLine,
  LineToolExtendedLine,
  LineToolHorizontalLine,
  LineToolHorizontalRay,
  LineToolRay,
  LineToolTrendLine,
  LineToolVerticalLine,
} from 'lightweight-charts-line-tools-lines';
import { LineToolLongShortPosition } from 'lightweight-charts-line-tools-long-short-position';
import { LineToolParallelChannel } from 'lightweight-charts-line-tools-parallel-channel';
import { LineToolPath } from 'lightweight-charts-line-tools-path';
import { LineToolPriceRange } from 'lightweight-charts-line-tools-price-range';
import { LineToolRectangle } from 'lightweight-charts-line-tools-rectangle';
import { LineToolText } from 'lightweight-charts-line-tools-text';
import { LineToolTriangle } from 'lightweight-charts-line-tools-triangle';
import areaChartIcon from './assets/chart-types/area.svg?raw';
import barsChartIcon from './assets/chart-types/bars.svg?raw';
import baselineChartIcon from './assets/chart-types/baseline.svg?raw';
import candlesChartIcon from './assets/chart-types/candles.svg?raw';
import lineChartIcon from './assets/chart-types/line.svg?raw';
import calloutDrawingIcon from './assets/drawing-tools/callout.svg?raw';
import crossLineDrawingIcon from './assets/drawing-tools/cross-line.svg?raw';
import extendedLineDrawingIcon from './assets/drawing-tools/extended-line.svg?raw';
import highlighterDrawingIcon from './assets/drawing-tools/highlighter.svg?raw';
import horizontalRayDrawingIcon from './assets/drawing-tools/horizontal-ray.svg?raw';
import pathDrawingIcon from './assets/drawing-tools/path.svg?raw';
import triangleDrawingIcon from './assets/drawing-tools/triangle.svg?raw';
import verticalLineDrawingIcon from './assets/drawing-tools/vertical-line.svg?raw';
import cursorToolbarIcon from './assets/drawing-toolbar/cursor.svg?raw';
import lockActiveToolbarIcon from './assets/drawing-toolbar/lock-active.svg?raw';
import lockToolbarIcon from './assets/drawing-toolbar/lock.svg?raw';
import magnetToolbarIcon from './assets/drawing-toolbar/magnet.svg?raw';
import objectTreeToolbarIcon from './assets/drawing-toolbar/object-tree.svg?raw';
import redoToolbarIcon from './assets/drawing-toolbar/redo.svg?raw';
import trashToolbarIcon from './assets/drawing-toolbar/trash.svg?raw';
import undoToolbarIcon from './assets/drawing-toolbar/undo.svg?raw';
import zoomToolbarIcon from './assets/drawing-toolbar/zoom.svg?raw';
import settingsHexIcon from './assets/settings-hex.svg?raw';
import addSymbolWidgetIcon from './assets/widget-bar/add-symbol.svg?raw';
import dataWindowWidgetIcon from './assets/widget-bar/data-window.svg?raw';
import marketDepthWidgetIcon from './assets/widget-bar/market-depth.svg?raw';
import moveDownWidgetIcon from './assets/widget-bar/move-down.svg?raw';
import moveUpWidgetIcon from './assets/widget-bar/move-up.svg?raw';
import refreshWidgetIcon from './assets/widget-bar/refresh.svg?raw';
import removeSymbolWidgetIcon from './assets/widget-bar/remove-symbol.svg?raw';
import watchlistWidgetIcon from './assets/widget-bar/watchlist.svg?raw';
import { aiPageMarkup } from './ai-mcp/page';
import { AiApiController } from './ai-api/controller';
import { AiConversationHistoryStore } from './ai-api/history';
import './ai-api/page.css';
import { UserDataController } from './user-data/controller';
import { UserDataManager } from './user-data/manager';
import { createUserDataNative } from './user-data/native-client';
import { createUserDataTools } from './user-data/tools';
import './user-data/page.css';
import { UserTaskController, type TaskUiSource } from './user-task/controller';
import { UserTaskManager } from './user-task/manager';
import { UserTaskLibrary } from './user-task/library';
import { IndexedDbTaskStore } from './user-task/library-store';
import {
  createWorkspaceStorage,
  MirroredUserIndicatorStore,
  MirroredUserTaskStore,
} from './workspace-persistence';
import { createTaskDataHost } from './user-task/sources';
import { createUserTaskTools, createSavedTaskTool, type TaskToolHost } from './user-task/tools';
import type { TaskSymbol } from './user-task/contracts';
import './user-task/page.css';
import { createResultFileTools, type PreparedResultFile, type ResultFileFormat, type ResultFilePort, type ResultFilePrepareInput } from './ai-capabilities/result-files';
import { createAiHelpTools } from './ai-capabilities/help-tools';
import { AiMcpController } from './ai-mcp/controller';
import './ai-mcp/page.css';
import { LineToolUpArrow } from './drawing-tools/up-arrow';
import {
  historyOverlapsTrustedBar,
  initialVisibleLogicalRange,
  mergeDeepHistoryWithLiveTail,
  realtimeRecoveryHistoryCounts,
  reconcileBars,
  type BarReconciliation,
} from './bar-series';
import {
  candlestickColorOptions,
  chartColorWithOpacity,
  loadChartSettings,
  saveChartSettings,
  type ChartAppearanceSettings,
  type ChartSettings,
} from './chart-settings';
import { installTfColorPickers, refreshTfColorPicker } from './color-picker';
import { appThemePalette, loadAppTheme, saveAppTheme, type AppTheme } from './theme';
import {
  APP_LOCALES,
  loadAppLocale,
  observeLocalizedUi,
  saveAppLocale,
  translateUiText,
  type AppLocale,
} from './i18n';
import {
  RESOLUTION_OPTIONS,
  TRADING_TIME_ZONE_OPTIONS,
  formatUtcOffset,
  loadFavoriteResolutions,
  loadTradingTimeChoice,
  resolveTradingTimeZone,
  saveFavoriteResolutions,
  saveTradingTimeChoice,
  timeZoneOffsetMinutes,
  toggleFavoriteResolution,
  type Resolution,
  type TradingTimeChoice,
} from './chart-time-controls';
import {
  loadChartPreferences,
  movePaneOrder,
  previousCloseFromBars,
  saveChartPreferences,
  type ChartType,
  type MainOverlaySeries,
  type ManagedSeries,
  type PriceLineSettings,
  type PriceScaleSetting,
  type SecondaryPane,
} from './chart-controls';
import {
  DrawingHistory,
  drawingScope,
  loadDrawingScopes,
  saveDrawingScopes,
  validateDrawingSnapshot,
  type DrawingExport,
} from './drawing-state';
import {
  DEEP_HISTORY_DELAY_MS,
  HistoryMemoryCache,
  INITIAL_HISTORY_BARS,
  historyCacheKey,
  deepHistoryBars,
  retainRealtimeHistory,
  shouldLoadDeepHistory,
} from './history-loader';
import { LatestRequestGate } from './latest-request';
import { IndicatorChartHost } from './indicator-sdk/chart-host';
import { IndicatorDataRouter } from './indicator-sdk/data-router';
import { IndicatorMainSeriesHost } from './indicator-sdk/main-series-host';
import { refreshIndicatorBarStyles } from './indicator-sdk/main-series-refresh';
import { IndicatorMarketRouter } from './indicator-sdk/market-router';
import { IndicatorRegistry } from './indicator-sdk/registry';
import { IndicatorRuntime, indicatorInstrumentMetadata } from './indicator-sdk/runtime';
import {
  IndicatorInputFormValidationError,
  readIndicatorInputForm,
  renderIndicatorInputForm,
} from './indicator-sdk/input-form';
import type {
  IndicatorDataEvent,
  IndicatorMarker,
  IndicatorRealtimeBarUpdate,
  SavedUserIndicatorState,
} from './indicator-sdk/contracts';
import { builtinIndicators } from './indicator-plugins/builtins';
import { registerExternalIndicators } from './indicator-plugins';
import {
  loadIndicatorState,
  resolveUserIndicatorStateEntries,
  saveIndicatorState,
  INDICATOR_STATE_STORAGE_KEY,
  type LoadedIndicatorState,
} from './indicator-sdk/state';
import { UserIndicatorRuntimeController } from './user-indicator-runtime/controller';
import { IndexedDbUserIndicatorStore } from './user-indicator-runtime/indexeddb-store';
import {
  UserIndicatorLibrary,
  UserIndicatorLibraryError,
  readUserIndicatorFile,
  type PreparedUserIndicatorImport,
  type UserIndicatorLibraryRecord,
} from './user-indicator-runtime/library';
import {
  UserIndicatorDataUnavailableError,
  UserIndicatorRuntimeManager,
  alignUserIndicatorDataBars,
  normalizeUserIndicatorInputs,
} from './user-indicator-runtime/runtime-manager';
import { testUserIndicatorSourceIsolated } from './user-indicator-runtime/preflight';
import { createWorkspaceReadTools } from './ai-capabilities/workspace-tools';
import { createWorkspaceActionTools, parseIndicatorInputPatch,
  type WatchlistChange, type IndicatorChange } from './ai-capabilities/workspace-actions';
import { createMarketQueryTools, type MarketQueryHost } from './ai-capabilities/market-tools';
import { createNativeMarketQueryPort } from './ai-capabilities/market-query';
import { copyHistory, MarketResultStore } from './ai-capabilities/market-data';
import { createChartActionTools, type ChartNavigation } from './ai-capabilities/chart-actions';
import { createIndicatorLibraryTools } from './ai-capabilities/indicator-library-tools';
import {
  formatUserIndicatorAiDiagnostic,
  safeUserIndicatorFailureDetail,
  type UserIndicatorAiDiagnosticInput,
} from './user-indicator-runtime/ai-guide';
import userIndicatorE2eSma from '../fixtures/user-indicators/01-sma.tfi?raw';
import userIndicatorE2eRange from '../fixtures/user-indicators/02-range-pane.tfi?raw';
import userIndicatorE2eMarkerStyle from '../fixtures/user-indicators/03-marker-style.tfi?raw';
import userIndicatorE2eCanvas from '../fixtures/user-indicators/04-canvas.tfi?raw';
import userIndicatorE2ePanel from '../fixtures/user-indicators/05-panel.tfi?raw';
import { marketPollPlan, remainingPollDelay } from './market-session';
import marketUniversePackage from './market-universe.json';
import { binanceSpotSymbols } from './providers/binance/catalog';
import { binanceUsdMarginedSymbols } from './providers/binance/usdm-catalog';
import {
  listMarketSymbols,
  isCanonicalMarketSymbol,
  mergeMarketCatalogPage,
  marketProviderKey,
  marketSymbolFromCatalog,
  type MarketCatalogPage,
  type MarketProviderDescriptor,
  type MarketSearchCategory,
  type MarketSearchSource,
  type MarketSymbol,
} from './market-universe';
import {
  enabledProviderIds,
  loadMarketProviderPreferences,
  marketProviderSelectionChanged,
  providerForMarketSource,
  providerIsAvailable,
  saveMarketProviderPreferences,
  showTdxAdjustmentControls,
  type MarketEditionInfo,
} from './market-edition';
import { exchangeDisplayName, exchangeLogoUrl, symbolLogoUrls } from './symbol-logos';
import { setStatusLabel } from './status-label';
import { isUsableTdxRecentTrades, type TdxRecentTradesResponse } from './tdx-trades';
import {
  isUsableQuote,
  matchesQuoteResponse,
  quoteBookLevels,
  shouldFetchStandaloneQuote,
  type QuoteResponse,
  type QuoteSnapshot,
} from './quote';
import {
  aggregateTradeGap,
  canApplyRealtimeBar,
  isRealtimeSequenceFresh,
  marketDataRenderDelay,
  matchesRealtimeSelection,
  REALTIME_FRAME_FALLBACK_MS,
  RealtimePollBarrier,
  realtimeSequenceKey,
  realtimeRequestSeed,
  type RealtimeBarEvent,
  type RealtimeBarSource,
  type RealtimeDepthEvent,
  type RealtimePointEvent,
  type RealtimeStatusEvent,
  type RealtimeTradeEvent,
} from './realtime-market';
import { normalizeProbabilityHistory, type ProbabilityPoint } from './probability-series';
import {
  loadMarkerScopes,
  markerScope,
  saveMarkerScopes,
  type ChartMarker,
  type MarkerPosition,
  type MarkerShape,
} from './marker-state';
import {
  calendarMonthDays,
  logicalRangeAround,
  nearestBarIndex,
  parseShanghaiDate,
  resolutionShowsIntradayTime,
  visibleRangeForPreset,
  type TimeRangePreset,
} from './time-navigation';
import {
  loadWatchlist,
  moveWatchlistSymbol,
  saveWatchlist,
  watchlistSymbolKey,
  WATCHLIST_STORAGE_KEY,
} from './watchlist';
import './style.css';
import './color-picker.css';
import { ChartReadBridge } from './ai-capabilities/chart-host';
import { DrawingAttachments } from './ai-capabilities/drawing-attachments';
import { DrawingJournalStorage } from './ai-capabilities/drawing-journal';
import { NativeDrawingPort } from './ai-capabilities/drawing-native';
import type { ChartReadState } from './ai-capabilities/chart-data';
import { CapabilityError, sameSelection, requireChartSelection,
  type Permission, type SelectionRef, type ToolExecutionContext, type ToolTransaction, type AsyncToolTransaction, type JsonValue, type ToolSessionScope } from './ai-capabilities/contracts';
import type { CapabilitySession } from './ai-capabilities/core';

type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number; amount?: number };
type HistoryResponse = {
  symbol: string;
  seriesKind: 'ohlcv' | 'probability';
  bars: Bar[];
  points?: ProbabilityPoint[];
  diagnostics: { source: string; host: string; latencyMs: number };
  quote?: QuoteSnapshot;
};
type HostBenchmarkResponse = {
  probes: Array<{ host: string; ok: boolean; latencyMs: number; error?: string }>;
};
type Adjustment = 'none' | 'qfq';
type IndicatorName = 'ma' | 'ema' | 'boll' | 'macd' | 'rsi';
type DrawingToolType = LineToolType | 'UpArrow';
type SelectedDrawing = {
  id: string;
  toolType: DrawingToolType;
  options: Record<string, any>;
  points?: Array<{ timestamp: Time; price: number }>;
};

const drawingToolTypes: DrawingToolType[] = [
  'TrendLine', 'Ray', 'Arrow', 'ExtendedLine', 'HorizontalLine', 'HorizontalRay', 'VerticalLine',
  'CrossLine', 'Callout', 'Rectangle', 'Circle', 'Triangle', 'Path', 'ParallelChannel',
  'FibRetracement', 'Brush', 'Highlighter', 'Text', 'PriceRange', 'LongShortPosition', 'UpArrow',
];
const knownDrawingTypes = new Set<string>(drawingToolTypes);

type LegacyMarketSymbol = Omit<MarketSymbol, 'providerId' | 'providerDisplayName' | 'venue'> & {
  providerId?: string;
  providerDisplayName?: string;
  venue?: string;
};

const workspaceStorage = await createWorkspaceStorage(invoke, localStorage);
const marketEditionInfo = await invoke<MarketEditionInfo>('get_market_edition');
let initialMarketProviderDescriptors = await invoke<MarketProviderDescriptor[]>('list_market_providers');
const compiledMarketKinds = new Set(
  initialMarketProviderDescriptors.flatMap((descriptor) => descriptor.capabilities.kinds),
);
const storedMarketProviderIds = loadMarketProviderPreferences(
  workspaceStorage,
  marketEditionInfo.edition,
  initialMarketProviderDescriptors,
);
if (storedMarketProviderIds !== null) {
  for (const descriptor of initialMarketProviderDescriptors.filter(providerIsAvailable)) {
    const enabled = storedMarketProviderIds.has(descriptor.id);
    if (descriptor.enabled !== enabled) {
      await invoke('set_market_provider_enabled', { providerId: descriptor.id, enabled });
    }
  }
  initialMarketProviderDescriptors = await invoke<MarketProviderDescriptor[]>('list_market_providers');
}
const appLocale = loadAppLocale(workspaceStorage);
let appTheme = loadAppTheme(workspaceStorage);
document.documentElement.lang = appLocale;
document.documentElement.classList.toggle('theme-light', appTheme === 'light');
document.documentElement.classList.toggle('theme-dark', appTheme === 'dark');
document.body.classList.toggle('theme-light', appTheme === 'light');
document.body.classList.toggle('theme-dark', appTheme === 'dark');
const ui = (value: string): string => translateUiText(value, appLocale);

const tdxDisplayName = '通达信主站';
const buildEdition = import.meta.env?.VITE_TRADEFLOW_LITE_EDITION || 'cn';
const buildIncludesTdx = buildEdition === 'cn';
const staticTdxSymbols: MarketSymbol[] = (buildIncludesTdx
  ? (marketUniversePackage as { rows: LegacyMarketSymbol[] }).rows
  : []).map((item) => ({
  ...item,
  providerId: item.providerId ?? 'tdx',
  providerDisplayName: item.providerDisplayName ?? tdxDisplayName,
  venue: item.venue ?? item.exchange,
  realtime: item.realtime ?? false,
  quote: true,
  baseAsset: item.baseAsset,
}));

const marketProviderById = new Map<string, MarketProviderDescriptor>(
  initialMarketProviderDescriptors.map((descriptor) => [descriptor.id, descriptor]),
);
let activeMarketProviderIds = enabledProviderIds(initialMarketProviderDescriptors);
let marketSymbols: MarketSymbol[] = [
  ...(activeMarketProviderIds.has('tdx') ? staticTdxSymbols : []),
  ...(activeMarketProviderIds.has('binance_spot') ? binanceSpotSymbols : []),
  ...(activeMarketProviderIds.has('binance_usdm') ? binanceUsdMarginedSymbols : []),
];
const bundledMarketSymbolKeys = new Set(
  [...staticTdxSymbols, ...binanceSpotSymbols, ...binanceUsdMarginedSymbols]
    .map((item) => marketProviderKey(item.providerId, item.symbol)),
);
const marketSymbolById = new Map<string, MarketSymbol>();

function rebuildMarketSymbolIndex() {
  marketSymbolById.clear();
  for (const item of marketSymbols) {
    // Keep the legacy symbol key for existing local state; provider-qualified keys
    // are the canonical identity when more than one provider can serve a venue.
    if (!marketSymbolById.has(item.symbol)) marketSymbolById.set(item.symbol, item);
    marketSymbolById.set(marketProviderKey(item.providerId, item.symbol), item);
  }
}

rebuildMarketSymbolIndex();

function rebuildMarketSymbolsForProviderPolicy() {
  const retainedDynamic = marketSymbols.filter((item) => activeMarketProviderIds.has(item.providerId)
    && !['tdx', 'binance_spot', 'binance_usdm'].includes(item.providerId));
  marketSymbols = [
    ...(activeMarketProviderIds.has('tdx') ? staticTdxSymbols : []),
    ...(activeMarketProviderIds.has('binance_spot') ? binanceSpotSymbols : []),
    ...(activeMarketProviderIds.has('binance_usdm') ? binanceUsdMarginedSymbols : []),
    ...retainedDynamic,
  ];
  rebuildMarketSymbolIndex();
}

function marketSourceEnabled(source: MarketSearchSource): boolean {
  const providerId = providerForMarketSource(source);
  return providerId === null || activeMarketProviderIds.has(providerId);
}

function marketSymbolKey(symbol: MarketSymbol): string {
  return marketProviderKey(symbol.providerId, symbol.symbol);
}

function legacyMarketSymbolKey(symbol: MarketSymbol): string {
  return symbol.symbol;
}

function providerSupportsQuote(symbol: MarketSymbol): boolean {
  const descriptor = marketProviderById.get(symbol.providerId);
  return descriptor === undefined
    ? symbol.quote === true
    : descriptor.enabled && descriptor.capabilities.quote;
}

function marketStatusText(symbol: MarketSymbol, detail: string): string {
  return symbol.providerId === 'tdx' ? detail : `${symbol.providerDisplayName} · ${detail}`;
}

function legacyStateBelongsToProvider(symbol: MarketSymbol): boolean {
  return marketSymbolById.get(symbol.symbol)?.providerId === symbol.providerId;
}

function isCurrentMarketSelection(
  symbol: MarketSymbol,
  resolution: Resolution,
  adjustment: Adjustment,
): boolean {
  return currentSymbol.providerId === symbol.providerId
    && currentSymbol.symbol === symbol.symbol
    && currentResolution === resolution
    && currentAdjustment === adjustment;
}

const emptyMarketSymbol: MarketSymbol = {
  symbol: 'NONE:EMPTY', code: '', name: '', exchange: 'NONE', providerId: 'none',
  providerDisplayName: '', venue: 'NONE', kind: 'stock', realtime: false, quote: false,
};
function preferredInitialMarketSymbol(): MarketSymbol {
  return marketSymbols.find((item) => item.providerId === 'tdx' && item.symbol === 'SH:600000' && item.kind === 'stock')
    ?? marketSymbols.find((item) => item.providerId === 'binance_spot' && item.symbol === 'BINANCE:BTCUSDT')
    ?? marketSymbols[0]
    ?? emptyMarketSymbol;
}
let defaultSymbol = preferredInitialMarketSymbol();
const kindLabels: Record<MarketSymbol['kind'], string> = { stock: '股票', etf: 'ETF', index: '指数', crypto: '数字货币', prediction: '预测市场' };
const symbolSources: Record<MarketSearchCategory, { value: MarketSearchSource; label: string }[]> = {
  all: [
    { value: 'all', label: '全部来源' },
    { value: 'sh', label: '上海市场' },
    { value: 'sz', label: '深圳市场' },
    { value: 'bj', label: '北京市场' },
    { value: 'binance_spot', label: '币安现货' },
    { value: 'binance_usdm', label: '币安 U 本位永续' },
    { value: 'okx_spot', label: 'OKX 现货' },
    { value: 'okx_swap', label: 'OKX 永续合约' },
    { value: 'polymarket', label: 'Polymarket' },
  ],
  stock: [
    { value: 'all', label: '全部来源' },
    { value: 'sh_main', label: '沪市主板' },
    { value: 'star', label: '科创板' },
    { value: 'sz_main', label: '深市主板' },
    { value: 'chinext', label: '创业板' },
    { value: 'bj', label: '北交所' },
  ],
  index: [
    { value: 'all', label: '全部来源' },
    { value: 'sh', label: '上证指数' },
    { value: 'sz', label: '深证指数' },
    { value: 'bj', label: '北证指数' },
  ],
  etf: [
    { value: 'all', label: '全部来源' },
    { value: 'sh', label: '沪市 ETF' },
    { value: 'sz', label: '深市 ETF' },
  ],
  crypto: [
    { value: 'all', label: '全部数字货币' },
    { value: 'binance_spot', label: '币安现货' },
    { value: 'binance_usdt', label: '币安现货 · USDT' },
    { value: 'binance_usdc', label: '币安现货 · USDC' },
    { value: 'binance_fdusd', label: '币安现货 · FDUSD' },
    { value: 'binance_btc', label: '币安现货 · BTC' },
    { value: 'binance_other', label: '币安现货 · 其他计价' },
    { value: 'binance_usdm', label: '币安合约 · U 本位永续' },
    { value: 'binance_usdm_usdt', label: 'U 本位永续 · USDT' },
    { value: 'binance_usdm_usdc', label: 'U 本位永续 · USDC' },
    { value: 'okx_spot', label: 'OKX 现货' },
    { value: 'okx_spot_usdt', label: 'OKX 现货 · USDT' },
    { value: 'okx_spot_usdc', label: 'OKX 现货 · USDC' },
    { value: 'okx_spot_other', label: 'OKX 现货 · 其他计价' },
    { value: 'okx_swap', label: 'OKX 永续合约' },
    { value: 'okx_swap_usdt', label: 'OKX 永续 · USDT' },
    { value: 'okx_swap_usdc', label: 'OKX 永续 · USDC' },
    { value: 'okx_swap_usd', label: 'OKX 永续 · USD' },
  ],
  prediction: [
    { value: 'all', label: '全部预测市场' },
    { value: 'polymarket', label: 'Polymarket' },
  ],
};
const resolutionLabels = Object.fromEntries(
  RESOLUTION_OPTIONS.map((option) => [option.value, option.shortLabel]),
) as Record<Resolution, string>;
const realtimeTimeFormatter = new Intl.DateTimeFormat(appLocale, {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const shanghaiTradeTimeFormatter = new Intl.DateTimeFormat(appLocale, {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const chartTypeLabels: Record<ChartType, string> = {
  candles: 'K线', bars: '美国线', line: '折线', area: '面积', baseline: '基准',
};
const priceScaleModes: Record<PriceScaleSetting, PriceScaleMode> = {
  normal: PriceScaleMode.Normal,
  logarithmic: PriceScaleMode.Logarithmic,
  percentage: PriceScaleMode.Percentage,
  indexed: PriceScaleMode.IndexedTo100,
};
let currentSymbol = defaultSymbol;
let currentSeriesKind: HistoryResponse['seriesKind'] = 'ohlcv';
let currentResolution: Resolution = '1D';
let currentAdjustment: Adjustment = 'none';
let favoriteResolutions = loadFavoriteResolutions(workspaceStorage);
let tradingTimeChoice: TradingTimeChoice = loadTradingTimeChoice(workspaceStorage);
const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const historyRequestGate = new LatestRequestGate();
const historyRequestIncarnationSeed = realtimeRequestSeed(Date.now());
const historyCache = new HistoryMemoryCache<HistoryResponse>();
const historyRequests = new Map<string, Promise<HistoryResponse>>();
let currentBars: Bar[] = [];
let currentHistoryDiagnostics: HistoryResponse['diagnostics'] | null = null;
let aiDataWindowTime: number | null = null;
const aiChartAppInstanceId = crypto.randomUUID();
let aiDisplayedHistoryGeneration = -1;
let aiChartDataRevision = 0;
let aiChartReadBridge: ChartReadBridge | undefined;
let aiChartWorkbenchBridge: ChartReadBridge | undefined;
let userDataManager: UserDataManager | undefined;
let userTaskManager: UserTaskManager | undefined;
let userTaskLibrary: UserTaskLibrary | undefined;
const aiResultFilePort: ResultFilePort = {
  async prepare(input: ResultFilePrepareInput, signal: AbortSignal): Promise<PreparedResultFile> {
    if (signal.aborted) throw new CapabilityError('cancelled');
    const prepared = await invoke<PreparedResultFile>('ai_result_prepare', { input });
    if (signal.aborted) {
      await invoke('ai_result_rollback', { ticket: prepared.ticket }).catch(() => {});
      throw new CapabilityError('cancelled');
    }
    return prepared;
  },
  async commit(ticket: string) { await invoke('ai_result_commit', { ticket }); },
  async rollback(ticket: string) { await invoke('ai_result_rollback', { ticket }); },
};
let aiNativeDrawingPort: NativeDrawingPort | undefined;
let aiDrawingPointerDown = false;
let currentQuote: QuoteSnapshot | null = null;
let magnetEnabled = false;
let drawingsLocked = false;
let activeDrawingId: string | null = null;
let selectedDrawing: SelectedDrawing | null = null;
let suppressDrawingDeselect = false;
let latestPollInFlight = false;
let latestPollTimer: number | undefined;
const realtimePollBarrier = new RealtimePollBarrier();
let realtimeRecoveryAnchorTime: number | null = null;
let realtimeRequestSequence = realtimeRequestSeed(Date.now());
let activeRealtimeRequestId = 0;
let activeRealtimeProviderId = '';
let activeRealtimeProviderDisplayName = '';
const lastRealtimeSequenceByChannel = new Map<string, number>();
let lastIndicatorAggregateTradeId: number | null = null;
let realtimeConnected = false;
let realtimeBarRequestId = 0;
let latestDepth: RealtimeDepthEvent | null = null;
let recentTrades: RealtimeTradeEvent[] = [];
let activeMarketDataTab: 'depth' | 'trades' | 'rules' = 'depth';
let deepHistoryTimer: number | undefined;
let deepHistoryTimerKey = '';
let deepHistoryNavigationReady = false;
const deepHistoryLoading = new Map<string, number>();
const chartPreferences = loadChartPreferences(workspaceStorage);
let chartSettings = loadChartSettings(workspaceStorage, appTheme);
saveChartSettings(workspaceStorage, chartSettings);
const activeIndicators = new Set<IndicatorName>(
  chartPreferences.activeSeries.filter((series): series is IndicatorName => series !== 'volume'),
);
const hiddenSeries = new Set<ManagedSeries>(chartPreferences.hiddenSeries);
let volumeVisible = chartPreferences.activeSeries.includes('volume');
let currentChartType: ChartType = chartPreferences.chartType;
let currentPriceScale: PriceScaleSetting = chartPreferences.priceScale;
let priceScaleAuto = true;
let priceScaleInverted = chartPreferences.priceScaleInverted;
let secondaryPaneOrder: SecondaryPane[] = chartPreferences.paneOrder;
let mainSeriesOrder: MainOverlaySeries[] = chartPreferences.mainSeriesOrder;
let watchlistSymbols = loadWatchlist(workspaceStorage, new Set(marketSymbolById.keys()));
let aiWatchlistRevision = 0;
const watchlistQuotes = new Map<string, QuoteSnapshot>();
let watchlistQuoteRefreshId = 0;
const drawingScopes = loadDrawingScopes(workspaceStorage, knownDrawingTypes);
const drawingJournalStorage = new DrawingJournalStorage(workspaceStorage, knownDrawingTypes);
const markerScopes = loadMarkerScopes(workspaceStorage);
let drawingHistory = new DrawingHistory('[]');
let restoringDrawings = false;
let drawingsInitialized = false;
let markerPlacementActive = false;
let editingMarkerId: string | null = null;
let pendingMarkerTime: number | null = null;
let primarySeriesVisible = true;
let goToCalendarYear = new Date().getFullYear();
let goToCalendarMonth = new Date().getMonth();

const icon = (paths: string, viewBox = '0 0 24 24') => `
  <svg aria-hidden="true" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const drawingIcon = (paths: string) => `
  <svg aria-hidden="true" viewBox="0 0 28 28">${paths}</svg>`;

const icons = {
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  star: icon('<path d="m12 3 2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84L6.6 19.6l1.03-6-4.36-4.25 6.03-.88L12 3Z"/>'),
  search: icon('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'),
  indicator: icon('<path d="M3 17 8 9l4 4 5-8 4 3"/><path d="M3 21h18"/>'),
  refresh: icon('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>'),
  fullscreen: icon('<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>'),
  priceLine: icon('<path d="M3 12h18"/><circle cx="12" cy="12" r="2.5"/>'),
  camera: icon('<path d="M4 7h4l1.5-2h5L16 7h4v12H4V7Z"/><circle cx="12" cy="13" r="3.5"/>'),
  goToDate: icon('<path d="M5 4v3M19 4v3M4 8h16v12H4V8Z"/><path d="M9 14h7m-3-3 3 3-3 3"/>'),
  copy: icon('<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  download: icon('<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 19h16"/>'),
  crosshair: cursorToolbarIcon,
  trend: drawingIcon('<g fill="currentColor" fill-rule="nonzero"><path d="M7.354 21.354l14-14-.707-.707-14 14z"/><path d="M22.5 7c.828 0 1.5-.672 1.5-1.5S23.328 4 22.5 4 21 4.672 21 5.5 21.672 7 22.5 7zm0 1A2.5 2.5 0 1 1 25 5.5 2.5 2.5 0 0 1 22.5 8zM5.5 24c.828 0 1.5-.672 1.5-1.5S6.328 21 5.5 21 4 21.672 4 22.5 4.672 24 5.5 24zm0 1A2.5 2.5 0 1 1 8 22.5 2.5 2.5 0 0 1 5.5 25z"/></g>'),
  ray: drawingIcon('<g fill="currentColor" fill-rule="nonzero"><path d="M8.354 20.354l5-5-.707-.707-5 5zM16.354 12.354l8-8-.707-.707-8 8z"/><path d="M14.5 15c.828 0 1.5-.672 1.5-1.5S15.328 12 14.5 12s-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1a2.5 2.5 0 1 1 2.5-2.5 2.5 2.5 0 0 1-2.5 2.5zM6.5 23c.828 0 1.5-.672 1.5-1.5S7.328 20 6.5 20 5 20.672 5 21.5 5.672 23 6.5 23zm0 1A2.5 2.5 0 1 1 9 21.5 2.5 2.5 0 0 1 6.5 24z"/></g>'),
  arrow: drawingIcon('<g fill="currentColor"><path fill-rule="nonzero" d="M7.354 21.354l14-14-.707-.707-14 14z"/><path d="M21 7l-8 3 5 5z"/><path fill-rule="nonzero" d="M22.5 7c.828 0 1.5-.672 1.5-1.5S23.328 4 22.5 4 21 4.672 21 5.5 21.672 7 22.5 7zm0 1A2.5 2.5 0 1 1 25 5.5 2.5 2.5 0 0 1 22.5 8zM5.5 24c.828 0 1.5-.672 1.5-1.5S6.328 21 5.5 21 4 21.672 4 22.5 4.672 24 5.5 24zm0 1A2.5 2.5 0 1 1 8 22.5 2.5 2.5 0 0 1 5.5 25z"/></g>'),
  upArrow: drawingIcon('<path fill="currentColor" fill-rule="nonzero" d="M11 16v6h6v-6h4.865L14 6.562 6.135 16H11zm7 7h-8v-6H4L14 5l10 12h-6v6z"/>'),
  horizontal: drawingIcon('<g fill="currentColor" fill-rule="nonzero"><path d="M4 15h8.5v-1H4zM16.5 15H25v-1h-8.5z"/><path d="M14.5 16c.828 0 1.5-.672 1.5-1.5S15.328 13 14.5 13s-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1a2.5 2.5 0 1 1 2.5-2.5 2.5 2.5 0 0 1-2.5 2.5z"/></g>'),
  extendedLine: extendedLineDrawingIcon,
  horizontalRay: horizontalRayDrawingIcon,
  verticalLine: verticalLineDrawingIcon,
  crossLine: crossLineDrawingIcon,
  callout: calloutDrawingIcon,
  highlighter: highlighterDrawingIcon,
  triangle: triangleDrawingIcon,
  path: pathDrawingIcon,
  rectangle: drawingIcon('<g fill="currentColor" fill-rule="nonzero"><path d="M7.5 6h13V5h-13zM7.5 23h13v-1h-13zM5 7.5v13h1v-13zM22 7.5v13h1v-13z"/><path d="M5.5 7A1.5 1.5 0 1 0 4 5.5 1.5 1.5 0 0 0 5.5 7zm0 1A2.5 2.5 0 1 1 8 5.5 2.5 2.5 0 0 1 5.5 8zM22.5 7A1.5 1.5 0 1 0 21 5.5 1.5 1.5 0 0 0 22.5 7zm0 1A2.5 2.5 0 1 1 25 5.5 2.5 2.5 0 0 1 22.5 8zM22.5 24a1.5 1.5 0 1 0-1.5-1.5 1.5 1.5 0 0 0 1.5 1.5zm0 1a2.5 2.5 0 1 1 2.5-2.5 2.5 2.5 0 0 1-2.5 2.5zM5.5 24A1.5 1.5 0 1 0 4 22.5 1.5 1.5 0 0 0 5.5 24zm0 1A2.5 2.5 0 1 1 8 22.5 2.5 2.5 0 0 1 5.5 25z"/></g>'),
  circle: drawingIcon('<path stroke="currentColor" fill="none" d="M16 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"/><path fill="currentColor" fill-rule="evenodd" d="M4.5 14a9.5 9.5 0 0 1 18.7-2.37 2.5 2.5 0 0 0 0 4.74A9.5 9.5 0 0 1 4.5 14zm19.7 2.5a10.5 10.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM22.5 14a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"/>'),
  channel: drawingIcon('<g fill="currentColor" fill-rule="nonzero"><path d="M8.354 18.354l10-10-.707-.707-10 10zM12.354 25.354l5-5-.707-.707-5 5zM20.354 17.354l5-5-.707-.707-5 5z"/><path d="M19.5 8A1.5 1.5 0 1 0 18 6.5 1.5 1.5 0 0 0 19.5 8zm0 1A2.5 2.5 0 1 1 22 6.5 2.5 2.5 0 0 1 19.5 9zM6.5 21A1.5 1.5 0 1 0 5 19.5 1.5 1.5 0 0 0 6.5 21zm0 1A2.5 2.5 0 1 1 9 19.5 2.5 2.5 0 0 1 6.5 22zM18.5 20a1.5 1.5 0 1 0 1.5 1.5 1.5 1.5 0 0 0-1.5-1.5zm0-1a2.5 2.5 0 1 1-2.5 2.5 2.5 2.5 0 0 1 2.5-2.5z"/></g>'),
  fib: drawingIcon('<g fill="currentColor" fill-rule="nonzero"><path d="M3 5h22V4H3zM3 17h22v-1H3zM3 11h19.5v-1H3zM5.5 23H25v-1H5.5z"/><path d="M3.5 24A1.5 1.5 0 1 0 2 22.5 1.5 1.5 0 0 0 3.5 24zm0 1A2.5 2.5 0 1 1 6 22.5 2.5 2.5 0 0 1 3.5 25zM24.5 12a1.5 1.5 0 1 0-1.5-1.5 1.5 1.5 0 0 0 1.5 1.5zm0 1a2.5 2.5 0 1 1 2.5-2.5 2.5 2.5 0 0 1-2.5 2.5z"/></g>'),
  brush: drawingIcon('<g fill="currentColor" fill-rule="nonzero"><path d="M1.789 23l.859-.854.221-.228c.18-.19.38-.409.597-.655.619-.704 1.238-1.478 1.815-2.298.982-1.396 1.738-2.776 2.177-4.081 1.234-3.667 5.957-4.716 8.923-1.263 3.251 3.785-.037 9.38-5.379 9.38H1.789zM11 22c4.544 0 7.272-4.642 4.621-7.728-2.45-2.853-6.225-2.015-7.216.931-.474 1.408-1.273 2.869-2.307 4.337-.599.852-1.241 1.653-1.882 2.383L4.148 22H11z"/><path d="M18.182 6.002l-1.419 1.286c-1.031.935-1.075 2.501-.096 3.48l1.877 1.877c.976.976 2.553.954 3.513-.045l5.65-5.874-.721-.693-5.65 5.874c-.574.596-1.507.609-2.086.031l-1.877-1.877c-.574-.574-.548-1.48.061-2.032l1.419-1.286-.672-.741z"/></g>'),
  text: drawingIcon('<path fill="currentColor" d="M8 6.5c0-.28.22-.5.5-.5H14v16h-2v1h5v-1h-2V6h5.5c.28 0 .5.22.5.5V9h1V6.5c0-.83-.67-1.5-1.5-1.5h-12C7.67 5 7 5.67 7 6.5V9h1V6.5z"/>'),
  ruler: drawingIcon('<g fill="currentColor"><path fill-rule="nonzero" d="M4 5h16.5V4H4zM25 24H8.5v1H25z"/><path fill-rule="nonzero" d="M6.5 26A1.5 1.5 0 1 0 5 24.5 1.5 1.5 0 0 0 6.5 26zm0 1A2.5 2.5 0 1 1 9 24.5 2.5 2.5 0 0 1 6.5 27zM22.5 6A1.5 1.5 0 1 0 21 4.5 1.5 1.5 0 0 0 22.5 6zm0 1A2.5 2.5 0 1 1 25 4.5 2.5 2.5 0 0 1 22.5 7zM14 9v14h1V9z"/><path d="M14.5 6L17 9h-5z"/></g>'),
  position: drawingIcon('<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M4.5 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM2 6.5A2.5 2.5 0 0 1 6.95 6H24v1H6.95A2.5 2.5 0 0 1 2 6.5zM4.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM2 16.5a2.5 2.5 0 0 1 4.95-.5h13.1a2.5 2.5 0 1 1 0 1H6.95A2.5 2.5 0 0 1 2 16.5zM22.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-18 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM2 22.5a2.5 2.5 0 0 1 4.95-.5H24v1H6.95A2.5 2.5 0 0 1 2 22.5z"/>'),
  zoom: zoomToolbarIcon,
  magnet: magnetToolbarIcon,
  lock: lockToolbarIcon,
  lockActive: lockActiveToolbarIcon,
  eye: icon('<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>'),
  undo: undoToolbarIcon,
  redo: redoToolbarIcon,
  layers: objectTreeToolbarIcon,
  info: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
  trash: trashToolbarIcon,
  close: icon('<path d="m7 7 10 10M17 7 7 17"/>'),
  marker: drawingIcon('<path fill="currentColor" fill-rule="nonzero" d="M7.382 16h14.483l-4.167-5 4.167-5h-15.865v12.764l1.382-2.764zm-2.382 7v-18h19l-5 6 5 6h-16l-3 6z"/>'),
};
const chartTypeIcons: Record<ChartType, string> = {
  candles: candlesChartIcon,
  bars: barsChartIcon,
  line: lineChartIcon,
  area: areaChartIcon,
  baseline: baselineChartIcon,
};
const themeButtonIcons = `
  <svg class="theme-moon" viewBox="0 0 28 28" aria-hidden="true"><path d="M19.7 18.1A7.3 7.3 0 0 1 9.9 8.3a8 8 0 1 0 9.8 9.8Z"></path></svg>
  <svg class="theme-sun" viewBox="0 0 28 28" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M18.5 14a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-1 0a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"></path><path d="M13.5 3h1v4h-1V3ZM13.5 21h1v4h-1v-4ZM3 13.5h4v1H3v-1ZM21 13.5h4v1h-4v-1ZM5.65 6.36l.71-.71 2.83 2.83-.71.71-2.83-2.83ZM18.81 19.52l.71-.71 2.83 2.83-.71.71-2.83-2.83ZM21.65 5.65l.71.71-2.83 2.83-.71-.71 2.83-2.83ZM8.48 18.81l.71.71-2.83 2.83-.71-.71-2.83-2.83Z"></path></svg>`;

const appRoot = document.querySelector<HTMLDivElement>('#app')!;
appRoot.innerHTML = `
  <div class="app-shell">
    <div class="chart-toolbar">
      <div class="symbol-search">
        <div class="symbol-control">
          ${icons.search}<input id="search" value="600000" aria-label="商品代码搜索" aria-controls="symbol-search-dialog" aria-expanded="false" autocomplete="off" readonly />
        </div>
      </div>
      <button id="open" class="toolbar-button compact" aria-label="打开证券">${icons.plus}</button>
      <button id="watchlist-add" class="toolbar-button compact" aria-label="添加当前证券到自选" title="添加到自选">${icons.star}</button>
      <span class="toolbar-divider"></span>
      <div class="resolution-switcher" aria-label="K线周期">
        <div id="resolution-favorites" class="resolution-favorites"></div>
        <details id="resolution-menu" class="chart-control-menu resolution-menu">
          <summary class="toolbar-button resolution-menu-trigger" aria-label="选择K线周期" title="选择K线周期" tabindex="0"><span>⌄</span></summary>
          <div class="resolution-menu-panel" aria-label="选择K线周期">
            ${(['分钟', '小时', '天'] as const).map((group) => `
              <section>
                <h3>${group}</h3>
                ${RESOLUTION_OPTIONS.filter((option) => option.group === group).map((option) => `
                  <div class="resolution-menu-row" data-resolution-row="${option.value}">
                    <button type="button" data-resolution="${option.value}">${option.label}</button>
                    <button type="button" class="resolution-favorite-toggle" data-favorite-resolution="${option.value}" aria-label="收藏${option.label}" aria-pressed="false">${icons.star}</button>
                  </div>`).join('')}
              </section>`).join('')}
          </div>
        </details>
      </div>
      <span class="toolbar-divider"></span>
      <details id="chart-type-menu" class="chart-control-menu">
        <summary class="toolbar-button icon-only" aria-label="K线图" title="K线图">${candlesChartIcon}<span id="chart-type-label" class="visually-hidden">K线</span></summary>
        <div class="chart-control-menu-panel chart-type-options" aria-label="选择图表类型">
          <button type="button" data-chart-type="bars" aria-label="美国线">${barsChartIcon}<span>美国线</span></button>
          <button type="button" data-chart-type="candles" aria-label="K线图">${candlesChartIcon}<span>K线图</span></button>
          <button type="button" data-chart-type="line" aria-label="线形图">${lineChartIcon}<span>线形图</span></button>
          <button type="button" data-chart-type="area" aria-label="面积图">${areaChartIcon}<span>面积图</span></button>
          <button type="button" data-chart-type="baseline" aria-label="基准线">${baselineChartIcon}<span>基准线</span></button>
        </div>
      </details>
      <span class="toolbar-divider"></span>
      <div id="adjustment-switcher" class="adjustment-switcher" aria-label="复权方式"${activeMarketProviderIds.has('tdx') ? '' : ' hidden'}>
        <button data-adjustment="none" class="toolbar-button active">不复权</button>
        <button data-adjustment="qfq" class="toolbar-button">前复权</button>
      </div>
      <button id="open-indicator-picker" class="toolbar-button" type="button" aria-label="打开指标">${icons.indicator}<span>指标</span></button>
      <div class="toolbar-spacer"></div>
      <button id="status" class="connection-status" aria-label="正在连接" title="点击重新测速"><i></i><span>正在连接</span></button>
      <button id="refresh" class="toolbar-button" aria-label="重新加载K线" title="重新加载K线">${icons.refresh}</button>
      <button id="theme-toggle" class="toolbar-button" type="button" data-mode="${appTheme}" aria-label="${appTheme === 'light' ? '当前为亮色模式，点击切换到暗色模式' : '当前为暗色模式，点击切换到亮色模式'}" aria-pressed="${appTheme === 'light'}">${themeButtonIcons}</button>
      <button id="toggle-fullscreen" class="toolbar-button" aria-label="切换全屏" title="切换全屏">${icons.fullscreen}</button>
      <button id="open-chart-settings" class="toolbar-button icon-only" aria-label="设置" title="设置">${settingsHexIcon}</button>
      <details id="chart-capture-menu" class="chart-control-menu chart-capture-menu">
        <summary class="toolbar-button icon-only" aria-label="生成快照" title="生成快照">${icons.camera}</summary>
        <div class="chart-control-menu-panel" aria-label="生成快照">
          <button id="save-chart" type="button" aria-label="下载图片">${icons.download}<span>下载图片</span></button>
          <button id="copy-chart" type="button" aria-label="复制图片">${icons.copy}<span>复制图片</span></button>
        </div>
      </details>
    </div>

    <div id="indicator-picker-layer" class="indicator-picker-layer" hidden>
      <section id="indicator-picker-dialog" class="indicator-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="indicator-picker-title">
        <header class="indicator-picker-header">
          <h2 id="indicator-picker-title">指标</h2>
          <span class="indicator-picker-header-actions">
            <button id="import-user-indicator" type="button">导入 .tfi</button>
            <button id="close-indicator-picker" type="button" aria-label="关闭指标">${icons.close}</button>
          </span>
        </header>
        <input id="user-indicator-file" type="file" accept=".tfi" hidden />
        <label class="indicator-picker-search" for="indicator-picker-search">
          ${icons.search}
          <input id="indicator-picker-search" type="search" autocomplete="off" placeholder="搜索指标" aria-label="搜索指标" />
        </label>
        <div class="indicator-picker-content">
          <h3>全部指标</h3>
          <div id="indicator-picker-list" class="indicator-picker-list"></div>
          <p id="indicator-picker-empty" class="indicator-picker-empty" hidden>没有匹配的指标</p>
        </div>
      </section>
    </div>

    <div id="user-indicator-import-layer" class="indicator-config-layer" hidden>
      <section class="indicator-config-dialog user-indicator-import-dialog" role="dialog" aria-modal="true" aria-labelledby="user-indicator-import-title">
        <header class="indicator-config-header">
          <div><span>用户指标</span><h2 id="user-indicator-import-title">导入预览</h2></div>
          <button id="close-user-indicator-import" type="button" aria-label="关闭导入预览">${icons.close}</button>
        </header>
        <div id="user-indicator-import-preview" class="user-indicator-import-preview"></div>
        <p id="user-indicator-import-error" class="indicator-config-error" hidden></p>
        <footer class="indicator-config-footer">
          <button id="copy-user-indicator-ai-diagnostic" type="button" hidden>复制给 AI</button>
          <button id="cancel-user-indicator-import" type="button">取消</button>
          <button id="confirm-user-indicator-import" type="button">仅保存</button>
          <button id="confirm-and-add-user-indicator" class="primary" type="button">导入并添加</button>
        </footer>
      </section>
    </div>

    <div id="indicator-config-layer" class="indicator-config-layer" hidden>
      <section id="indicator-config-form" class="indicator-config-dialog" role="dialog" aria-modal="true" aria-labelledby="indicator-config-title">
        <header class="indicator-config-header">
          <div><span>指标参数</span><h2 id="indicator-config-title">指标</h2></div>
          <button id="close-indicator-config" type="button" aria-label="关闭指标参数">${icons.close}</button>
        </header>
        <div id="indicator-config-fields" class="indicator-config-fields"></div>
        <p id="indicator-config-error" class="indicator-config-error" hidden></p>
        <footer class="indicator-config-footer">
          <button id="cancel-indicator-config" type="button">取消</button>
          <button id="confirm-indicator-config" class="primary" type="button">确认</button>
        </footer>
      </section>
    </div>

    <div id="chart-settings-layer" class="chart-settings-layer" hidden>
      <section id="chart-settings-dialog" class="chart-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="chart-settings-title">
        <header class="chart-settings-header">
          <h2 id="chart-settings-title">设置</h2>
          <button id="close-chart-settings" type="button" aria-label="关闭设置">${icons.close}</button>
        </header>
        <nav class="chart-settings-tabs" aria-label="设置分类">
          <button type="button" data-settings-tab="symbol" aria-selected="true">${icons.indicator}<span>商品代码</span></button>
          <button type="button" data-settings-tab="data" aria-selected="false">${icons.layers}<span>数据源</span></button>
          <button type="button" data-settings-tab="status" aria-selected="false">${icons.layers}<span>状态行</span></button>
          <button type="button" data-settings-tab="scales" aria-selected="false">${icons.priceLine}<span>坐标和线条</span></button>
          <button type="button" data-settings-tab="appearance" aria-selected="false">${icons.fullscreen}<span>版面</span></button>
          <button type="button" data-settings-tab="about" aria-selected="false">${icons.info}<span>关于</span></button>
        </nav>
        <div class="chart-settings-content">
          <div class="chart-settings-panel" data-settings-panel="symbol">
            <h3>K线图</h3>
            <div class="chart-settings-row"><label class="chart-settings-style-toggle"><input data-chart-setting="bodyVisible" type="checkbox" /><span>主体</span></label><span class="chart-settings-color-pair">
              <input data-chart-setting="downColor" type="color" aria-label="下跌颜色" data-tf-color-opacity-target="chart-settings-down-opacity" />
              <input data-chart-setting="upColor" type="color" aria-label="上涨颜色" data-tf-color-opacity-target="chart-settings-up-opacity" />
            </span></div>
            <div class="chart-settings-row"><label class="chart-settings-style-toggle"><input data-chart-setting="borderVisible" type="checkbox" /><span>边框</span></label><span class="chart-settings-color-pair">
              <input data-chart-setting="borderDownColor" type="color" aria-label="下跌边框颜色" data-tf-color-opacity-target="chart-settings-border-down-opacity" />
              <input data-chart-setting="borderUpColor" type="color" aria-label="上涨边框颜色" data-tf-color-opacity-target="chart-settings-border-up-opacity" />
            </span></div>
            <div class="chart-settings-row"><label class="chart-settings-style-toggle"><input data-chart-setting="wickVisible" type="checkbox" /><span>影线</span></label><span class="chart-settings-color-pair">
              <input data-chart-setting="wickDownColor" type="color" aria-label="下跌影线颜色" data-tf-color-opacity-target="chart-settings-wick-down-opacity" />
              <input data-chart-setting="wickUpColor" type="color" aria-label="上涨影线颜色" data-tf-color-opacity-target="chart-settings-wick-up-opacity" />
            </span></div>
            <input id="chart-settings-up-opacity" class="chart-settings-opacity-source" data-chart-opacity-setting="upOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="上涨颜色不透明度" />
            <input id="chart-settings-down-opacity" class="chart-settings-opacity-source" data-chart-opacity-setting="downOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="下跌颜色不透明度" />
            <input id="chart-settings-border-up-opacity" class="chart-settings-opacity-source" data-chart-opacity-setting="borderUpOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="上涨边框颜色不透明度" />
            <input id="chart-settings-border-down-opacity" class="chart-settings-opacity-source" data-chart-opacity-setting="borderDownOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="下跌边框颜色不透明度" />
            <input id="chart-settings-wick-up-opacity" class="chart-settings-opacity-source" data-chart-opacity-setting="wickUpOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="上涨影线颜色不透明度" />
            <input id="chart-settings-wick-down-opacity" class="chart-settings-opacity-source" data-chart-opacity-setting="wickDownOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="下跌影线颜色不透明度" />
            <div class="chart-settings-section-title">数据修改</div>
            <label class="chart-settings-row"><span>时区</span><select id="chart-settings-time-zone" aria-label="时区">${TRADING_TIME_ZONE_OPTIONS.map((option) => `<option value="${option.value}">${option.label}</option>`).join('')}</select></label>
          </div>
          <div class="chart-settings-panel" data-settings-panel="data" hidden>
            <h3>行情数据源</h3>
            <p id="market-edition-label" class="chart-settings-panel-note"></p>
            <div id="market-provider-settings"></div>
            <p class="chart-settings-panel-note">关闭数据源只影响当前发行版的默认使用；适配器仍保留在应用中，可以随时重新启用。</p>
          </div>
          <div class="chart-settings-panel" data-settings-panel="status" hidden>
            <h3>状态行</h3>
            <label class="chart-settings-row"><span>商品代码和图标</span><input data-chart-setting="legendSymbolVisible" type="checkbox" /></label>
            <label class="chart-settings-row"><span>开、高、低、收</span><input data-chart-setting="legendValuesVisible" type="checkbox" /></label>
            <label class="chart-settings-row"><span>成交量数值</span><input data-chart-setting="volumeLegendVisible" type="checkbox" /></label>
          </div>
          <div class="chart-settings-panel" data-settings-panel="scales" hidden>
            <h3>坐标和线条</h3>
            <label class="chart-settings-row"><span>垂直网格线</span><input data-chart-setting="verticalGridVisible" type="checkbox" /></label>
            <label class="chart-settings-row"><span>水平网格线</span><input data-chart-setting="horizontalGridVisible" type="checkbox" /></label>
            <label class="chart-settings-row"><span>十字线标签</span><input data-chart-setting="crosshairLabelsVisible" type="checkbox" /></label>
            <label class="chart-settings-row"><span>最新价格线和标签</span><input data-chart-setting="lastPriceLineVisible" type="checkbox" /></label>
            <label class="chart-settings-row"><span>昨收线</span><input id="chart-settings-previous-close" type="checkbox" /></label>
          </div>
          <div class="chart-settings-panel" data-settings-panel="appearance" hidden>
            <h3>版面</h3>
            <div class="chart-settings-appearance-colors">
              <div class="chart-settings-row"><span>背景</span><input data-chart-appearance-color="backgroundColor" type="color" aria-label="背景颜色" data-tf-color-opacity-target="chart-settings-background-opacity" /></div>
              <div class="chart-settings-row"><span>网格线</span><span class="chart-settings-color-pair">
                <input data-chart-appearance-color="verticalGridColor" type="color" aria-label="垂直网格线颜色" data-tf-color-opacity-target="chart-settings-vertical-grid-opacity" />
                <input data-chart-appearance-color="horizontalGridColor" type="color" aria-label="水平网格线颜色" data-tf-color-opacity-target="chart-settings-horizontal-grid-opacity" />
              </span></div>
              <div class="chart-settings-row"><span>窗格分隔符</span><input data-chart-appearance-color="paneSeparatorColor" type="color" aria-label="窗格分隔符颜色" data-tf-color-opacity-target="chart-settings-pane-separator-opacity" /></div>
              <div class="chart-settings-row"><span>十字线</span><input data-chart-appearance-color="crosshairColor" type="color" aria-label="十字线颜色" data-tf-color-opacity-target="chart-settings-crosshair-opacity" /></div>
              <div class="chart-settings-section-title">坐标</div>
              <div class="chart-settings-row"><span>文本</span><input data-chart-appearance-color="axisTextColor" type="color" aria-label="坐标文本颜色" data-tf-color-opacity-target="chart-settings-axis-text-opacity" /></div>
              <div class="chart-settings-row"><span>线条</span><input data-chart-appearance-color="axisLineColor" type="color" aria-label="坐标线条颜色" data-tf-color-opacity-target="chart-settings-axis-line-opacity" /></div>
              <input id="chart-settings-background-opacity" class="chart-settings-opacity-source" data-chart-appearance-opacity="backgroundOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="背景颜色不透明度" />
              <input id="chart-settings-vertical-grid-opacity" class="chart-settings-opacity-source" data-chart-appearance-opacity="verticalGridOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="垂直网格线颜色不透明度" />
              <input id="chart-settings-horizontal-grid-opacity" class="chart-settings-opacity-source" data-chart-appearance-opacity="horizontalGridOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="水平网格线颜色不透明度" />
              <input id="chart-settings-pane-separator-opacity" class="chart-settings-opacity-source" data-chart-appearance-opacity="paneSeparatorOpacity" type="range" min="0" max="100" step="1" value="14" aria-label="窗格分隔符颜色不透明度" />
              <input id="chart-settings-crosshair-opacity" class="chart-settings-opacity-source" data-chart-appearance-opacity="crosshairOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="十字线颜色不透明度" />
              <input id="chart-settings-axis-text-opacity" class="chart-settings-opacity-source" data-chart-appearance-opacity="axisTextOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="坐标文本颜色不透明度" />
              <input id="chart-settings-axis-line-opacity" class="chart-settings-opacity-source" data-chart-appearance-opacity="axisLineOpacity" type="range" min="0" max="100" step="1" value="100" aria-label="坐标线条颜色不透明度" />
            </div>
            <div class="chart-settings-section-title">显示</div>
            <label class="chart-settings-row"><span>底部时间导航</span><input data-chart-setting="timeNavigationVisible" type="checkbox" /></label>
            <label class="chart-settings-row"><span>语言</span><select id="language-select" aria-label="语言">
              <option value="zh-CN">简体中文</option><option value="en-US">English</option>
            </select></label>
          </div>
          <div class="chart-settings-panel chart-settings-about" data-settings-panel="about" hidden>
            <h3>关于 TradeFlow Lite</h3>
            <p class="chart-settings-about-summary">免费、开源的桌面行情图表。</p>
            <div class="chart-settings-about-list">
              <div><span>版本</span><strong>${packageInfo.version}</strong></div>
              <a href="https://tradeflow.cn" data-external-url><span>官方网站</span><strong>tradeflow.cn ↗</strong></a>
              <a href="https://github.com/hongchanho93/tradeflow-lite" data-external-url><span>GitHub</span><strong>hongchanho93/tradeflow-lite ↗</strong></a>
              <a href="https://github.com/hongchanho93/tradeflow-lite/issues" data-external-url><span>问题反馈</span><strong>GitHub Issues ↗</strong></a>
            </div>
          </div>
        </div>
        <footer class="chart-settings-footer">
          <button id="cancel-chart-settings" type="button">取消</button>
          <button id="confirm-chart-settings" class="primary" type="button">确认</button>
        </footer>
      </section>
    </div>

    <div id="go-to-dialog-layer" class="go-to-dialog-layer" hidden>
      <section id="go-to-dialog" class="go-to-dialog" role="dialog" aria-modal="true" aria-labelledby="go-to-dialog-title">
        <header><h2 id="go-to-dialog-title">前往到</h2><button id="close-go-to-dialog" type="button" aria-label="关闭前往到">${icons.close}</button></header>
        <div class="go-to-dialog-body">
          <div class="go-to-dialog-tabs"><strong>日期</strong></div>
          <div class="go-to-dialog-fields">
            <input id="go-to-date" type="text" inputmode="numeric" placeholder="YYYY-MM-DD" aria-label="定位日期" maxlength="10" />
            <input type="text" value="00:00" aria-label="时间" disabled />
          </div>
          <div class="go-to-calendar-header">
            <button id="go-to-previous-month" type="button" aria-label="上一个月">‹</button>
            <strong id="go-to-calendar-title"></strong>
            <button id="go-to-next-month" type="button" aria-label="下一个月">›</button>
          </div>
          <div class="go-to-calendar-weekdays"><span>周一</span><span>周二</span><span>周三</span><span>周四</span><span>周五</span><span>周六</span><span>周日</span></div>
          <div id="go-to-calendar-grid" class="go-to-calendar-grid"></div>
        </div>
        <footer><button id="cancel-go-to-date" type="button">取消</button><button id="confirm-go-to-date" class="primary" type="button">前往到</button></footer>
      </section>
    </div>

    <div id="symbol-dialog-layer" class="symbol-dialog-layer" hidden>
      <section id="symbol-search-dialog" class="symbol-search-dialog" role="dialog" aria-modal="true" aria-labelledby="symbol-dialog-title">
        <header class="symbol-dialog-header">
          <h2 id="symbol-dialog-title">商品代码搜索</h2>
          <button id="symbol-dialog-close" type="button" aria-label="关闭代码搜索">${icons.close}</button>
        </header>
        <label class="symbol-dialog-search">
          ${icons.search}
          <input id="symbol-dialog-input" type="search" placeholder="搜索代码、名称或拼音" autocomplete="off" aria-controls="symbol-results" />
        </label>
        <nav class="symbol-category-tabs" aria-label="证券分类">
          <button type="button" data-symbol-category="all" aria-selected="true">全部</button>
          ${compiledMarketKinds.has('stock') ? '<button type="button" data-symbol-category="stock" aria-selected="false">股票</button>' : ''}
          ${compiledMarketKinds.has('index') ? '<button type="button" data-symbol-category="index" aria-selected="false">指数</button>' : ''}
          ${compiledMarketKinds.has('etf') ? '<button type="button" data-symbol-category="etf" aria-selected="false">ETF</button>' : ''}
          ${compiledMarketKinds.has('crypto') ? '<button type="button" data-symbol-category="crypto" aria-selected="false">数字货币</button>' : ''}
          ${compiledMarketKinds.has('prediction') ? '<button type="button" data-symbol-category="prediction" aria-selected="false">预测市场</button>' : ''}
        </nav>
        <div class="symbol-source-row">
          <button id="symbol-source-trigger" class="symbol-source-trigger" type="button" aria-haspopup="menu" aria-expanded="false">全部来源</button>
          <div id="symbol-source-menu" class="symbol-source-menu" role="menu" hidden></div>
          <span id="symbol-result-count"></span>
        </div>
        <div id="symbol-results" class="symbol-results" role="listbox"></div>
        <footer id="symbol-dialog-footer" class="symbol-dialog-footer">输入代码、名称或拼音查找品种，点击结果即可切换图表</footer>
      </section>
    </div>

    <div class="workspace">
      <aside class="drawing-toolbar" aria-label="绘图工具栏">
        <button id="crosshair-tool" class="rail-button active" aria-label="鼠标指针" title="鼠标指针">${icons.crosshair}</button>
        <span class="rail-divider"></span>
        <details class="drawing-tool-menu">
          <summary class="rail-button" aria-label="线条工具" title="线条工具">${icons.trend}</summary>
          <div class="drawing-tool-menu-panel">
            <div class="drawing-tool-menu-section">线条</div>
            <button data-drawing-tool="TrendLine" aria-label="趋势线" title="趋势线">${icons.trend}<span>趋势线</span></button>
            <button data-drawing-tool="Ray" aria-label="射线" title="射线">${icons.ray}<span>射线</span></button>
            <button data-drawing-tool="Arrow" aria-label="箭头" title="箭头">${icons.arrow}<span>箭头</span></button>
            <button data-drawing-tool="ExtendedLine" aria-label="延长线" title="延长线">${icons.extendedLine}<span>延长线</span></button>
            <button data-drawing-tool="HorizontalLine" aria-label="水平线" title="水平线">${icons.horizontal}<span>水平线</span></button>
            <button data-drawing-tool="HorizontalRay" aria-label="水平射线" title="水平射线">${icons.horizontalRay}<span>水平射线</span></button>
            <button data-drawing-tool="VerticalLine" aria-label="垂直线" title="垂直线">${icons.verticalLine}<span>垂直线</span></button>
            <button data-drawing-tool="CrossLine" aria-label="十字线" title="十字线">${icons.crossLine}<span>十字线</span></button>
            <div class="drawing-tool-menu-separator"></div>
            <div class="drawing-tool-menu-section">价格线</div>
            <button id="edit-cost-price" class="price-line-menu-item" type="button" aria-label="成本线">${icons.priceLine}<span>成本线</span></button>
            <button id="add-custom-price" class="price-line-menu-item" type="button" aria-label="自定义价格线">${icons.plus}<span>自定义价格线</span></button>
            <div class="drawing-tool-menu-separator"></div>
            <div class="drawing-tool-menu-section">通道</div>
            <button data-drawing-tool="ParallelChannel" aria-label="平行通道" title="平行通道">${icons.channel}<span>平行通道</span></button>
            <div class="drawing-tool-menu-separator"></div>
            <div class="drawing-tool-menu-section">标注和手绘</div>
            <button data-drawing-tool="Callout" aria-label="标注框" title="标注框">${icons.callout}<span>标注框</span></button>
            <button data-drawing-tool="Highlighter" aria-label="荧光笔" title="荧光笔">${icons.highlighter}<span>荧光笔</span></button>
            <div class="drawing-tool-menu-separator"></div>
            <div class="drawing-tool-menu-section">几何形状</div>
            <button data-drawing-tool="Triangle" aria-label="三角形" title="三角形">${icons.triangle}<span>三角形</span></button>
            <button data-drawing-tool="Path" aria-label="多段路径" title="多段路径">${icons.path}<span>多段路径</span></button>
          </div>
        </details>
        <button class="rail-button" data-drawing-tool="Rectangle" aria-label="矩形" title="矩形">${icons.rectangle}</button>
        <button class="rail-button" data-drawing-tool="Circle" aria-label="圆形" title="圆形">${icons.circle}</button>
        <button class="rail-button" data-drawing-tool="UpArrow" aria-label="向上箭头" title="向上箭头">${icons.upArrow}</button>
        <button id="marker-tool" class="rail-button" aria-label="添加图表标记" title="添加标记">${icons.marker}</button>
        <button class="rail-button" data-drawing-tool="FibRetracement" aria-label="斐波那契回撤" title="斐波那契回撤">${icons.fib}</button>
        <button class="rail-button" data-drawing-tool="Brush" aria-label="笔刷" title="笔刷">${icons.brush}</button>
        <button class="rail-button" data-drawing-tool="Text" aria-label="文字" title="文字">${icons.text}</button>
        <details class="drawing-tool-menu">
          <summary class="rail-button" aria-label="测量与仓位工具" title="测量与仓位工具">${icons.ruler}</summary>
          <div class="drawing-tool-menu-panel">
            <div class="drawing-tool-menu-section">测量</div>
            <button data-drawing-tool="PriceRange" aria-label="价格区间" title="价格区间">${icons.ruler}<span>价格区间</span></button>
            <div class="drawing-tool-menu-separator"></div>
            <div class="drawing-tool-menu-section">预测和测量</div>
            <button data-drawing-tool="LongShortPosition" aria-label="多空仓位" title="多空仓位">${icons.position}<span>多空仓位</span></button>
          </div>
        </details>
        <span class="rail-divider"></span>
        <button id="zoom-tool" class="rail-button" aria-label="放大">${icons.zoom}</button>
        <button id="magnet-tool" class="rail-button" aria-label="磁铁">${icons.magnet}</button>
        <button id="lock-drawings" class="rail-button" aria-label="锁定绘图" title="锁定绘图"><span data-icon-state="unlocked">${icons.lock}</span><span data-icon-state="locked">${icons.lockActive}</span></button>
        <button id="undo-drawing" class="rail-button" aria-label="撤销绘图操作" title="撤销" disabled>${icons.undo}</button>
        <button id="redo-drawing" class="rail-button" aria-label="重做绘图操作" title="重做" disabled>${icons.redo}</button>
        <div class="rail-spacer"></div>
        <button id="clear-drawings" class="rail-button" aria-label="移除全部绘图" title="移除全部绘图">${icons.trash}</button>
      </aside>

      <main class="chart-stage">
        <div id="market-empty-state" class="market-empty-state" hidden>
          <strong>当前没有启用行情数据源</strong>
          <span>可在设置 → 数据源中启用内置适配器，或使用自己的数据连接。</span>
          <button id="open-market-provider-settings" type="button">打开数据源设置</button>
        </div>
        <div class="chart-meta">
          <div class="ohlc-legend" id="ohlc-legend">
            <span id="instrument-logo" class="instrument-logo"></span>
            <strong id="legend-symbol">${defaultSymbol.name} · ${defaultSymbol.code} · ${exchangeDisplayName(defaultSymbol.exchange)}</strong>
            <span id="legend-values" class="legend-values">开=-- 高=-- 低=-- 收=--</span>
          </div>
        </div>
        <div id="chart" aria-label="K线图"></div>
        <div id="indicator-marker-tooltip" class="indicator-marker-tooltip" role="tooltip" hidden></div>
        <div id="indicator-legend-layer" class="indicator-legend-layer" aria-label="图表指标"></div>
        <div id="drawing-mode-hint" class="drawing-mode-hint" hidden></div>
        <div id="drawing-text-editor" class="drawing-text-editor" hidden>
          <input id="drawing-text-input" aria-label="图表文字" maxlength="80" placeholder="输入图表文字" />
          <button id="place-drawing-text">放置</button>
        </div>
        <div id="price-line-editor" class="price-line-editor-popover" hidden>
          <strong id="price-line-editor-title">设置成本线</strong>
          <input id="price-line-input" type="number" min="0" step="any" inputmode="decimal" placeholder="输入价格" aria-label="价格" />
          <button id="confirm-price-line" type="button">确定</button>
          <button id="cancel-price-line" type="button" aria-label="取消">${icons.close}</button>
          <p id="price-line-message" hidden></p>
        </div>
        <div id="marker-editor" class="marker-editor-popover" hidden>
          <header><strong id="marker-editor-title">添加标记</strong><span id="marker-editor-time"></span></header>
          <input id="marker-text" maxlength="80" placeholder="标记文字（可选）" aria-label="标记文字" />
          <select id="marker-shape" aria-label="标记形状">
            <option value="arrowUp">向上箭头</option><option value="arrowDown">向下箭头</option>
            <option value="circle">圆点</option><option value="square">方块</option>
          </select>
          <select id="marker-position" aria-label="标记位置">
            <option value="belowBar">K线下方</option><option value="aboveBar">K线上方</option><option value="inBar">K线内部</option>
          </select>
          <label class="marker-color"><span>颜色</span><input id="marker-color" type="color" value="#2962ff" aria-label="标记颜色" /></label>
          <label class="marker-size"><span>大小</span><input id="marker-size" type="range" min="1" max="3" step="1" value="1" aria-label="标记大小" /></label>
          <footer>
            <button id="delete-marker" class="danger" type="button" hidden>删除</button>
            <span></span><button id="cancel-marker" type="button">取消</button><button id="confirm-marker" class="primary" type="button">保存</button>
          </footer>
          <p id="marker-message" hidden></p>
        </div>
        <div id="drawing-properties" class="drawing-properties" hidden>
          <span class="drawing-property-grip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
          <strong id="drawing-properties-name">绘图</strong>
          <label class="drawing-property-color" title="颜色">
            <input id="drawing-color" type="color" value="#089981" aria-label="绘图颜色" data-tf-color-opacity-target="drawing-opacity" />
          </label>
          <details class="drawing-property-control">
            <summary title="粗细"><span class="drawing-line-sample"></span><output id="drawing-size-value">2px</output></summary>
            <label class="drawing-property-popover"><span id="drawing-size-label">粗细</span><input id="drawing-size" type="range" min="1" max="5" step="1" value="2" aria-label="绘图大小" /></label>
          </details>
          <details class="drawing-property-control">
            <summary title="透明度"><span class="drawing-opacity-sample"></span><output id="drawing-opacity-value">100%</output></summary>
            <label class="drawing-property-popover"><span>透明度</span><input id="drawing-opacity" type="range" min="5" max="100" step="5" value="100" aria-label="绘图透明度" /></label>
          </details>
          <button id="delete-selected-drawing" class="drawing-property-button danger" aria-label="删除所选绘图" title="删除">${icons.trash}</button>
          <button id="close-drawing-properties" class="drawing-property-button" aria-label="关闭绘图属性" title="关闭">${icons.close}</button>
        </div>
        <details id="price-scale-controls" class="price-scale-controls">
          <summary class="price-scale-gear" aria-label="价格轴设置" title="价格轴设置">${settingsHexIcon}</summary>
          <div class="price-scale-menu" aria-label="价格轴设置">
            <div class="control-menu-title">价格轴</div>
            <button type="button" data-price-scale="normal"><span>常规</span><i></i></button>
            <button type="button" data-price-scale="logarithmic"><span>对数</span><i></i></button>
            <button type="button" data-price-scale="percentage"><span>百分比</span><i></i></button>
            <button type="button" data-price-scale="indexed"><span>基准 100</span><i></i></button>
            <div class="control-menu-separator"></div>
            <button id="price-scale-auto" type="button"><span>自动缩放</span><i></i></button>
            <button id="price-scale-invert" type="button"><span>反转价格轴</span><i></i></button>
            <button id="price-scale-manual" type="button"><span>设置可见范围…</span></button>
            <button id="price-scale-reset" type="button"><span>重置价格轴</span></button>
          </div>
        </details>
        <div id="price-range-editor" class="price-range-editor" hidden>
          <strong>价格范围</strong><input id="price-range-min" type="number" step="any" placeholder="最低" aria-label="最低价格" />
          <input id="price-range-max" type="number" step="any" placeholder="最高" aria-label="最高价格" />
          <button id="confirm-price-range" type="button">应用</button><button id="cancel-price-range" type="button">取消</button>
          <p id="price-range-message" hidden></p>
        </div>
        <nav id="time-navigation" class="time-navigation" aria-label="时间导航">
          <button data-time-range="5y" type="button">5年</button><button data-time-range="1y" type="button">1年</button>
          <button data-time-range="6m" type="button">6月</button><button data-time-range="3m" type="button">3月</button>
          <button data-time-range="1m" type="button">1月</button><button data-time-range="5d" type="button">5天</button>
          <button data-time-range="1d" type="button">1天</button><span></span>
          <button id="go-to-date-button" class="time-navigation-calendar" type="button" aria-label="前往到" title="前往到">${icons.goToDate}</button>
        </nav>
        <details id="trading-time-menu" class="trading-time-menu">
          <summary id="trading-time-trigger" aria-label="切换交易时间"><span>交易时间</span><strong>--:--:-- UTC</strong></summary>
          <div class="trading-time-menu-panel" aria-label="交易时间">
            ${TRADING_TIME_ZONE_OPTIONS.map((option) => `
              <button type="button" data-trading-time="${option.value}" aria-label="${option.label}"><span>${option.label}</span><small></small><i></i></button>`).join('')}
          </div>
        </details>
        <div id="volume-legend" class="volume-legend" hidden>成交量 <span>--</span></div>
        <div id="loading-layer" class="loading-layer"><span></span><span></span><span></span></div>
        <div id="chart-error" class="chart-error" hidden></div>
        <div id="chart-toast" class="chart-toast" role="status" hidden></div>
      </main>
      <aside id="widget-bar" class="widget-bar" aria-label="右侧栏">
        <div id="widget-bar-resizer" class="widget-bar-resizer" role="separator" aria-label="调整右侧栏宽度" aria-orientation="vertical" aria-valuemin="280" aria-valuemax="520" tabindex="0"></div>
        <div class="widget-bar-pages" hidden>
          <section id="watchlist-panel" class="watchlist-panel" role="tabpanel" aria-labelledby="watchlist-toggle" hidden>
            <header class="watchlist-toolbar">
              <strong>自选</strong>
              <span class="watchlist-toolbar-spacer"></span>
              <button id="watchlist-refresh" type="button" aria-label="刷新自选行情" title="刷新自选行情">${refreshWidgetIcon}</button>
              <button id="watchlist-panel-add" type="button" aria-label="搜索并添加证券" aria-controls="symbol-search-dialog" aria-expanded="false" title="添加商品代码">${addSymbolWidgetIcon}</button>
            </header>
            <div class="watchlist-columns" role="row">
              <span role="columnheader">名称</span><span role="columnheader">最新价</span><span role="columnheader">涨跌</span><span role="columnheader">涨跌%</span>
            </div>
            <div id="watchlist-items" class="watchlist-items" role="table" aria-label="自选行情"></div>
            <p id="watchlist-empty">点击右上角 + 添加当前证券</p>
          </section>
          <section id="market-data-panel" class="market-data-panel" role="tabpanel" aria-labelledby="market-data-toggle" hidden>
            <header>
              <div><strong id="market-data-title">盘口</strong><span id="market-data-symbol">--</span></div>
              <button id="close-market-data" type="button" aria-label="关闭盘口">${icons.close}</button>
            </header>
            <nav class="market-data-tabs" aria-label="公开市场数据">
              <button type="button" data-market-data-tab="depth" aria-selected="true">盘口</button>
              <button type="button" data-market-data-tab="trades" aria-selected="false">成交</button>
              <button id="prediction-rules-tab" type="button" data-market-data-tab="rules" aria-selected="false" hidden>规则</button>
            </nav>
            <div id="market-data-unavailable" class="market-data-unavailable">当前品种暂未接入盘口和逐笔成交</div>
            <section id="market-depth-view" class="market-depth-view">
              <div class="market-best-prices"><span>卖一 <strong id="best-ask">--</strong></span><span>买一 <strong id="best-bid">--</strong></span></div>
              <div class="market-table-head"><span>档位</span><span>价格</span><span>数量</span></div>
              <div id="market-depth-asks" class="market-depth-levels asks"></div>
              <div class="market-depth-spread"><span>价差</span><strong id="market-depth-spread">--</strong></div>
              <div id="market-depth-bids" class="market-depth-levels bids"></div>
            </section>
            <section id="market-trades-view" class="market-trades-view" hidden>
              <div class="market-table-head"><span>时间</span><span>价格</span><span>数量</span></div>
              <div id="market-trades" class="market-trades"></div>
            </section>
            <section id="prediction-rules-view" class="prediction-rules-view" hidden>
              <div class="prediction-outcomes" aria-label="预测结果">
                <button id="prediction-yes" type="button">YES</button>
                <button id="prediction-no" type="button">NO</button>
              </div>
              <dl class="prediction-stats">
                <div><dt>当前概率</dt><dd id="prediction-current">--</dd></div>
                <div><dt>24 小时</dt><dd id="prediction-change">--</dd></div>
                <div><dt>截止时间</dt><dd id="prediction-end-date">--</dd></div>
                <div><dt>成交量</dt><dd id="prediction-volume">--</dd></div>
                <div><dt>流动性</dt><dd id="prediction-liquidity">--</dd></div>
              </dl>
              <h3>结算说明</h3>
              <p id="prediction-description">--</p>
              <a id="prediction-resolution-source" href="#" data-external-url hidden>查看官方结算来源</a>
            </section>
          </section>
          <section id="drawing-manager" class="drawing-manager" role="tabpanel" aria-labelledby="drawing-manager-toggle" hidden>
            <header><strong>对象树</strong><button id="close-drawing-manager" aria-label="关闭对象树">${icons.close}</button></header>
            <div id="drawing-manager-items" class="drawing-manager-items"></div>
            <p id="drawing-manager-empty">当前证券还没有绘图</p>
          </section>
          <section id="data-window-panel" class="data-window-panel" role="tabpanel" aria-labelledby="data-window-toggle" hidden>
            <header><strong>数据窗口</strong><span id="data-window-symbol">--</span></header>
            <dl class="data-window-values">
              <div><dt>时间</dt><dd id="data-window-time">--</dd></div>
              <div><dt>开盘</dt><dd id="data-window-open">--</dd></div>
              <div><dt>最高</dt><dd id="data-window-high">--</dd></div>
              <div><dt>最低</dt><dd id="data-window-low">--</dd></div>
              <div><dt>收盘</dt><dd id="data-window-close">--</dd></div>
              <div><dt>涨跌</dt><dd id="data-window-change">--</dd></div>
              <div><dt>涨跌幅</dt><dd id="data-window-change-percent">--</dd></div>
              <div><dt>成交量</dt><dd id="data-window-volume">--</dd></div>
            </dl>
          </section>
        </div>
        <nav class="widget-bar-tabs" role="tablist" aria-label="右侧栏">
          <button id="watchlist-toggle" class="widget-bar-tab" type="button" role="tab" aria-label="自选" aria-selected="false" aria-controls="watchlist-panel" title="自选">${watchlistWidgetIcon}</button>
          <button id="market-data-toggle" class="widget-bar-tab" type="button" role="tab" aria-label="盘口" aria-selected="false" aria-controls="market-data-panel" title="盘口">${marketDepthWidgetIcon}</button>
          <button id="drawing-manager-toggle" class="widget-bar-tab" type="button" role="tab" aria-label="对象树" aria-selected="false" aria-controls="drawing-manager" title="对象树">${objectTreeToolbarIcon}</button>
          <button id="data-window-toggle" class="widget-bar-tab" type="button" role="tab" aria-label="数据窗口" aria-selected="false" aria-controls="data-window-panel" title="数据窗口">${dataWindowWidgetIcon}</button>
          <button id="ai-toggle" class="widget-bar-tab ai-widget-tab" type="button" role="tab" aria-label="AI 工作台" aria-selected="false" aria-controls="ai-panel" title="AI 工作台">AI</button>
          <span class="widget-bar-spacer"></span>
        </nav>
      </aside>
    </div>
  </div>
`;
observeLocalizedUi(appRoot, appLocale);
installTfColorPickers(appRoot);

const initialThemePalette = appThemePalette(appTheme);
const chart = createChart(document.querySelector<HTMLDivElement>('#chart')!, {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: initialThemePalette.background },
    textColor: initialThemePalette.text,
    fontSize: 11,
    panes: { separatorColor: initialThemePalette.paneSeparator, separatorHoverColor: initialThemePalette.paneSeparatorHover, enableResize: true },
  },
  grid: {
    vertLines: { color: initialThemePalette.grid, visible: chartSettings.verticalGridVisible },
    horzLines: { color: initialThemePalette.grid, visible: chartSettings.horizontalGridVisible },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: initialThemePalette.crosshair, width: 1, style: 3, labelVisible: chartSettings.crosshairLabelsVisible, labelBackgroundColor: initialThemePalette.crosshairLabel },
    horzLine: { color: initialThemePalette.crosshair, width: 1, style: 3, labelVisible: chartSettings.crosshairLabelsVisible, labelBackgroundColor: initialThemePalette.crosshairLabel },
  },
  timeScale: { borderColor: initialThemePalette.border, timeVisible: false, rightOffset: 4, barSpacing: 3.5, minBarSpacing: 1.2 },
  rightPriceScale: { borderColor: initialThemePalette.border, minimumWidth: 58, mode: priceScaleModes[currentPriceScale], scaleMargins: { top: 0.08, bottom: 0.08 } },
  localization: {
    locale: appLocale,
    priceFormatter: (price: number) => price.toFixed(2),
    timeFormatter: (time: Time) => formatChartTime(time),
  },
  handleScroll: true,
  handleScale: true,
});

const candleSeries = chart.addSeries(CandlestickSeries, {
  ...candlestickColorOptions(chartSettings),
  visible: true,
  borderVisible: chartSettings.borderVisible,
  wickVisible: chartSettings.wickVisible,
  priceLineVisible: chartSettings.lastPriceLineVisible,
  priceLineColor: chartColorWithOpacity(chartSettings.upColor, chartSettings.upOpacity),
  lastValueVisible: chartSettings.lastPriceLineVisible,
}, 0);
const drawingAttachments = new DrawingAttachments(candleSeries);
const barSeries = chart.addSeries(BarSeries, {
  upColor: '#089981', downColor: '#f23645', thinBars: true,
  priceLineVisible: true, lastValueVisible: true, visible: false,
}, 0);
const closeLineSeries = chart.addSeries(LineSeries, {
  color: '#2962ff', lineWidth: 2, priceLineVisible: true, lastValueVisible: true, visible: false,
}, 0);
const areaSeries = chart.addSeries(AreaSeries, {
  lineColor: '#2962ff', lineWidth: 2, topColor: 'rgba(41, 98, 255, .32)', bottomColor: 'rgba(41, 98, 255, .03)',
  priceLineVisible: true, lastValueVisible: true, visible: false,
}, 0);
const baselineSeries = chart.addSeries(BaselineSeries, {
  baseValue: { type: 'price', price: 0 },
  topLineColor: '#089981', topFillColor1: 'rgba(8, 153, 129, .28)', topFillColor2: 'rgba(8, 153, 129, .03)',
  bottomLineColor: '#f23645', bottomFillColor1: 'rgba(242, 54, 69, .03)', bottomFillColor2: 'rgba(242, 54, 69, .28)',
  priceLineVisible: true, lastValueVisible: true, visible: false,
}, 0);
const volumeSeries = chart.addSeries(HistogramSeries, {
  priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false, visible: false,
}, 0);
chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
const seriesMarkerApis: Record<ChartType, ISeriesMarkersPluginApi<Time>> = {
  candles: createSeriesMarkers(candleSeries, [], { autoScale: true, zOrder: 'top' }),
  bars: createSeriesMarkers(barSeries, [], { autoScale: true, zOrder: 'top' }),
  line: createSeriesMarkers(closeLineSeries, [], { autoScale: true, zOrder: 'top' }),
  area: createSeriesMarkers(areaSeries, [], { autoScale: true, zOrder: 'top' }),
  baseline: createSeriesMarkers(baselineSeries, [], { autoScale: true, zOrder: 'top' }),
};

function currentPrimarySeries(): ISeriesApi<any, Time> {
  if (currentSeriesKind === 'probability' || currentChartType === 'line') return closeLineSeries;
  if (currentChartType === 'bars') return barSeries;
  if (currentChartType === 'area') return areaSeries;
  if (currentChartType === 'baseline') return baselineSeries;
  return candleSeries;
}

const indicatorRegistry = new IndicatorRegistry(builtinIndicators);
const indicatorDataRouter = new IndicatorDataRouter();
const indicatorMarketRouter = new IndicatorMarketRouter((kind) => indicatorRuntime.restartForMarketData(kind));
let indicatorSelectionKey = '';
let indicatorMainSeriesHost: IndicatorMainSeriesHost;
const indicatorChartHost = new IndicatorChartHost(
  chart,
  chart.panes()[0],
  currentPrimarySeries,
  () => appTheme,
  (instanceId, key, error) => console.error('indicator.canvas.draw_error', { instanceId, key, error }),
  document.querySelector<HTMLDivElement>('#chart')!,
);
indicatorMainSeriesHost = new IndicatorMainSeriesHost(
  () => currentChartType,
  (changedFrom) => {
    const startedAt = performance.now();
    const result = refreshIndicatorBarStyles({
      bars: currentBars,
      changedFrom,
      pointAt: candlePoint,
      setData: (points) => candleSeries.setData(points),
      update: (point, historical) => candleSeries.update(point, historical),
      getVisibleRange: () => chart.timeScale().getVisibleLogicalRange(),
      setVisibleRange: (range) => chart.timeScale().setVisibleLogicalRange(range),
    });
    if (result.mode === 'batch') {
      console.info('indicator.bar_styles.batch_refresh', {
        bars: currentBars.length,
        changedFrom: result.changedFrom,
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
      });
    }
  },
  () => renderSeriesMarkers(),
);
const indicatorRuntime = new IndicatorRuntime(indicatorRegistry, {
  chartHost: indicatorChartHost,
  mainSeries: (instanceId) => indicatorMainSeriesHost.beginBinding(instanceId),
  mainSeriesLifecycle: indicatorMainSeriesHost,
  market: indicatorMarketRouter,
  marketFor: (definition) => indicatorMarketRouter.forIndicator(definition),
  history: async (selection, request) => {
    const descriptor = marketProviderById.get(selection.providerId);
    if (descriptor && !descriptor.capabilities.resolutions.includes(request.resolution)) {
      throw new Error(`indicator source resolution ${request.resolution} is unsupported by ${selection.providerId}`);
    }
    const adjustment = request.adjustment === undefined || request.adjustment === 'current'
      ? selection.adjustment
      : request.adjustment;
    if (descriptor && !descriptor.capabilities.adjustments.includes(adjustment)) {
      throw new Error(`indicator source adjustment ${adjustment} is unsupported by ${selection.providerId}`);
    }
    const response = await requestHistory(
      selection.symbol,
      request.resolution,
      adjustment,
      request.count ?? deepHistoryBars(request.resolution),
      historyRequestGate.current(),
    );
    if (response.seriesKind !== 'ohlcv') throw new Error('indicator source requires OHLCV history');
    return response.bars;
  },
  events: {
    onCrosshairMove(callback) {
      const handler = (event: { time?: Time }) => callback({ time: typeof event.time === 'number' ? event.time : null });
      chart.subscribeCrosshairMove(handler);
      return { dispose: () => chart.unsubscribeCrosshairMove(handler) };
    },
    onClick(callback) {
      const handler = (event: { time?: Time; point?: { x: number; y: number } }) => callback({
        time: typeof event.time === 'number' ? event.time : null,
        x: event.point?.x ?? 0,
        y: event.point?.y ?? 0,
      });
      chart.subscribeClick(handler);
      return { dispose: () => chart.unsubscribeClick(handler) };
    },
    onVisibleRangeChange(callback) {
      const handler = (range: { from: Time; to: Time } | null) => callback({
        from: range && typeof range.from === 'number' ? range.from : null,
        to: range && typeof range.to === 'number' ? range.to : null,
      });
      chart.timeScale().subscribeVisibleTimeRangeChange(handler);
      return { dispose: () => chart.timeScale().unsubscribeVisibleTimeRangeChange(handler) };
    },
  },
  theme: () => appTheme,
  onError: ({ instanceId, indicatorId, phase, error }) => {
    console.error('indicator.runtime.error', { instanceId, indicatorId, phase, error });
    showChartToast(`${indicatorId} 指标运行失败`);
  },
});
const userIndicatorController = new UserIndicatorRuntimeController(indicatorChartHost, {
  mainSeriesHost: indicatorMainSeriesHost,
  onFailure: ({ instanceId, phase, code, message, logs }) => {
    console.error('user_indicator.runtime.error', { instanceId, phase, code, message });
    userIndicatorRuntimeFailures.set(instanceId, Object.freeze({
      phase,
      code,
      failureDetail: safeUserIndicatorFailureDetail(message),
      ...(logs?.length ? { logs: Object.freeze(logs.map(item => Object.freeze({ phase: item.phase, message: item.message }))) } : {}),
    }));
    showChartToast(`用户指标运行失败：${code}`);
    renderIndicatorLegends();
    if (!drawingManager.hidden) renderDrawingManager();
  },
});
const userIndicatorRuntime = new UserIndicatorRuntimeManager(userIndicatorController, {
  history: async (context, request) => {
    const requestedSymbol = request.symbol ?? context.selection.symbol;
    const symbol = marketSymbolById.get(marketProviderKey(context.selection.providerId, requestedSymbol))
      ?? (currentSymbol.providerId === context.selection.providerId && currentSymbol.symbol === requestedSymbol ? currentSymbol : null);
    if (!symbol) {
      const existsOnAnotherProvider = [...marketSymbolById.values()].some(candidate =>
        candidate.symbol === requestedSymbol && candidate.providerId !== context.selection.providerId);
      throw new UserIndicatorDataUnavailableError(existsOnAnotherProvider ? 'provider_mismatch' : 'symbol_unavailable');
    }
    if (request.kind !== undefined && symbol.kind !== request.kind) {
      throw new UserIndicatorDataUnavailableError('kind_mismatch');
    }
    if (symbol.kind === 'prediction') throw new UserIndicatorDataUnavailableError('series_kind_unavailable');
    const descriptor = marketProviderById.get(context.selection.providerId);
    if (descriptor && !descriptor.capabilities.resolutions.includes(request.resolution)) {
      throw new UserIndicatorDataUnavailableError('unsupported_resolution');
    }
    const adjustment = request.adjustment === undefined || request.adjustment === 'current'
      ? context.selection.adjustment
      : request.adjustment;
    if (descriptor && !descriptor.capabilities.adjustments.includes(adjustment)) {
      throw new UserIndicatorDataUnavailableError('unsupported_adjustment');
    }
    let response: HistoryResponse;
    try {
      response = await requestHistory(
        symbol,
        request.resolution,
        adjustment,
        request.count ?? deepHistoryBars(request.resolution),
        historyRequestGate.current(),
      );
    } catch {
      throw new UserIndicatorDataUnavailableError('history_unavailable');
    }
    if (response.seriesKind !== 'ohlcv') throw new UserIndicatorDataUnavailableError('series_kind_unavailable');
    return Object.freeze({
      bars: Object.freeze(response.bars.map((bar) => Object.freeze({ ...bar }))),
      symbol: symbol.symbol,
      kind: symbol.kind,
      coverage: 'provider-returned-window',
      finality: 'unknown',
      priceUnit: 'provider-native',
      volumeUnit: 'unknown',
    });
  },
});
indicatorMarketRouter.onDepth((depth) => userIndicatorRuntime.pushDepth(depth));
indicatorMarketRouter.onTrades((batch) => userIndicatorRuntime.pushTrades(batch));
indicatorMarketRouter.onStatus((marketStatus) => userIndicatorRuntime.pushMarketStatus(marketStatus));
let hoveredUserIndicatorHit: ReturnType<typeof userIndicatorController.hitTest> = null;
const userIndicatorPointerPrice = (y: number): number | null => {
  const value = currentPrimarySeries().coordinateToPrice(y);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
const dispatchUserIndicatorPointer = (
  type: 'click' | 'hover' | 'leave',
  hit: NonNullable<ReturnType<typeof userIndicatorController.hitTest>>,
  price: number | null,
) => userIndicatorRuntime.pointer(hit.instanceId, Object.freeze({
  type,
  id: hit.id,
  time: hit.time,
  price,
  pane: hit.pane,
}));
chart.subscribeCrosshairMove((event: { time?: Time; point?: { x: number; y: number } }) => {
  const point = event.point;
  const time = typeof event.time === 'number' ? event.time : null;
  const next = point ? userIndicatorController.hitTest(time, point.x, point.y) : null;
  if (hoveredUserIndicatorHit?.instanceId === next?.instanceId && hoveredUserIndicatorHit?.id === next?.id) return;
  if (hoveredUserIndicatorHit) dispatchUserIndicatorPointer('leave', hoveredUserIndicatorHit, null);
  hoveredUserIndicatorHit = next;
  if (next && point) dispatchUserIndicatorPointer('hover', next, userIndicatorPointerPrice(point.y));
});
chart.subscribeClick((event: { time?: Time; point?: { x: number; y: number } }) => {
  if (!event.point) return;
  const time = typeof event.time === 'number' ? event.time : null;
  const hit = userIndicatorController.hitTest(time, event.point.x, event.point.y);
  if (hit) dispatchUserIndicatorPointer('click', hit, userIndicatorPointerPrice(event.point.y));
});
let userIndicatorStore: MirroredUserIndicatorStore | null = null;
let userIndicatorLibrary: UserIndicatorLibrary | null = null;
const userIndicatorRecords = new Map<string, UserIndicatorLibraryRecord>();
let pendingUserIndicatorImport: PreparedUserIndicatorImport | null = null;
let pendingUserIndicatorDeleteId: string | null = null;
let pendingUserIndicatorDiagnostic: UserIndicatorAiDiagnosticInput | null = null;
const userIndicatorRuntimeFailures = new Map<string, UserIndicatorAiDiagnosticInput>();
let loadedIndicatorState: LoadedIndicatorState = {
  instances: [],
  unresolvedEntries: [],
  mainOverlayOrder: [{ type: 'volume' }],
};
let indicatorStateReady = false;
let aiIndicatorRevision = 0;
let aiIndicatorLibraryBusy = false;
let userIndicatorImportAbort: AbortController | null = null;
let indicatorInstanceOrder: string[] = [];

const lineTools = createLineToolsPlugin(chart, candleSeries);
lineTools.registerLineTool('TrendLine', LineToolTrendLine);
lineTools.registerLineTool('Ray', LineToolRay);
lineTools.registerLineTool('Arrow', LineToolArrow);
lineTools.registerLineTool('ExtendedLine', LineToolExtendedLine);
lineTools.registerLineTool('HorizontalLine', LineToolHorizontalLine);
lineTools.registerLineTool('HorizontalRay', LineToolHorizontalRay);
lineTools.registerLineTool('VerticalLine', LineToolVerticalLine);
lineTools.registerLineTool('CrossLine', LineToolCrossLine);
lineTools.registerLineTool('Callout', LineToolCallout);
lineTools.registerLineTool('Rectangle', LineToolRectangle);
lineTools.registerLineTool('Circle', LineToolCircle);
lineTools.registerLineTool('ParallelChannel', LineToolParallelChannel);
lineTools.registerLineTool('FibRetracement', LineToolFibRetracement);
lineTools.registerLineTool('Brush', LineToolBrush);
lineTools.registerLineTool('Highlighter', LineToolHighlighter);
lineTools.registerLineTool('Triangle', LineToolTriangle);
lineTools.registerLineTool('Path', LineToolPath);
lineTools.registerLineTool('Text', LineToolText);
lineTools.registerLineTool('PriceRange', LineToolPriceRange);
lineTools.registerLineTool('LongShortPosition', LineToolLongShortPosition);
lineTools.registerLineTool('UpArrow' as LineToolType, LineToolUpArrow as never);
lineTools.setTimeFormatter((time) => formatChartTime(time as Time));

const input = document.querySelector<HTMLInputElement>('#search')!;
const symbolDialogLayer = document.querySelector<HTMLDivElement>('#symbol-dialog-layer')!;
const symbolDialog = document.querySelector<HTMLElement>('#symbol-search-dialog')!;
const symbolDialogTitle = document.querySelector<HTMLElement>('#symbol-dialog-title')!;
const symbolDialogFooter = document.querySelector<HTMLElement>('#symbol-dialog-footer')!;
const symbolDialogInput = document.querySelector<HTMLInputElement>('#symbol-dialog-input')!;
const symbolResults = document.querySelector<HTMLDivElement>('#symbol-results')!;
const symbolSourceTrigger = document.querySelector<HTMLButtonElement>('#symbol-source-trigger')!;
const symbolSourceMenu = document.querySelector<HTMLDivElement>('#symbol-source-menu')!;
const symbolResultCount = document.querySelector<HTMLSpanElement>('#symbol-result-count')!;
const status = document.querySelector<HTMLButtonElement>('#status')!;
const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle')!;
const loadingLayer = document.querySelector<HTMLDivElement>('#loading-layer')!;
const errorLayer = document.querySelector<HTMLDivElement>('#chart-error')!;
const legendValues = document.querySelector<HTMLSpanElement>('#legend-values')!;
const volumeLegend = document.querySelector<HTMLDivElement>('#volume-legend span')!;
const drawingModeHint = document.querySelector<HTMLDivElement>('#drawing-mode-hint')!;
const drawingTextEditor = document.querySelector<HTMLDivElement>('#drawing-text-editor')!;
const drawingTextInput = document.querySelector<HTMLInputElement>('#drawing-text-input')!;
const drawingProperties = document.querySelector<HTMLDivElement>('#drawing-properties')!;
const drawingPropertiesName = document.querySelector<HTMLElement>('#drawing-properties-name')!;
const drawingColor = document.querySelector<HTMLInputElement>('#drawing-color')!;
const drawingSize = document.querySelector<HTMLInputElement>('#drawing-size')!;
const drawingSizeLabel = document.querySelector<HTMLSpanElement>('#drawing-size-label')!;
const drawingSizeValue = document.querySelector<HTMLOutputElement>('#drawing-size-value')!;
const drawingOpacity = document.querySelector<HTMLInputElement>('#drawing-opacity')!;
const drawingOpacityValue = document.querySelector<HTMLOutputElement>('#drawing-opacity-value')!;
const crosshairTool = document.querySelector<HTMLButtonElement>('#crosshair-tool')!;
const instrumentLogo = document.querySelector<HTMLSpanElement>('#instrument-logo')!;
const legendSymbol = document.querySelector<HTMLElement>('#legend-symbol')!;
const chartStage = document.querySelector<HTMLElement>('.chart-stage')!;
chartStage.addEventListener('pointerdown', () => { aiDrawingPointerDown = true; }, true);
window.addEventListener('pointerup', () => { aiDrawingPointerDown = false; }, true);
window.addEventListener('pointercancel', () => { aiDrawingPointerDown = false; }, true);
window.addEventListener('blur', () => { aiDrawingPointerDown = false; });
const indicatorLegendLayer = document.querySelector<HTMLDivElement>('#indicator-legend-layer')!;
const watchlistAdd = document.querySelector<HTMLButtonElement>('#watchlist-add')!;
const widgetBar = document.querySelector<HTMLElement>('#widget-bar')!;
const widgetBarResizer = document.querySelector<HTMLElement>('#widget-bar-resizer')!;
const widgetBarPages = widgetBar.querySelector<HTMLElement>('.widget-bar-pages')!;
const watchlistToggle = document.querySelector<HTMLButtonElement>('#watchlist-toggle')!;
const marketDataToggle = document.querySelector<HTMLButtonElement>('#market-data-toggle')!;
const drawingManagerToggle = document.querySelector<HTMLButtonElement>('#drawing-manager-toggle')!;
const dataWindowToggle = document.querySelector<HTMLButtonElement>('#data-window-toggle')!;
widgetBarPages.insertAdjacentHTML('beforeend', aiPageMarkup(icons.close));
const aiToggle = document.querySelector<HTMLButtonElement>('#ai-toggle')!;
const aiPanel = document.querySelector<HTMLElement>('#ai-panel')!;
const aiApiController = new AiApiController(aiPanel.querySelector<HTMLElement>('#ai-api-root')!, aiToggle, {
  context: readCurrentAiChartSelection, describe: describeAiChartTools, open: openAiChartSession, subscribeTools: subscribeAiChartTools,
}, undefined, new AiConversationHistoryStore(workspaceStorage.native));
const userDataController = new UserDataController(aiPanel.querySelector<HTMLElement>('#ai-api-root')!, {
  manager: getUserDataManager, appInstanceId: () => aiChartAppInstanceId, compose: text => aiApiController.draftMessage(text),
});
const userTaskController = new UserTaskController(aiPanel.querySelector<HTMLElement>('#ai-api-root')!, {
  manager: getUserTaskManager, library: getUserTaskLibrary, sources: readUserTaskSources, watchlist: readUserTaskWatchlist,
  appInstanceId: () => aiChartAppInstanceId, compose: text => aiApiController.draftMessage(text),
  prepareOpen: (symbol, execution) => prepareAiChartNavigation({ op: 'open', expected: readCurrentAiChartSelection(),
    providerId: symbol.providerId, symbol: symbol.symbol, kind: symbol.kind }, execution),
  prepareWatchlist: (symbols, execution) => {
    const tool = createAiWorkspaceActionTools().find(item => item.id === 'tf.watchlist.add')!;
    return tool.prepare!({ items: symbols.map(symbol => ({ providerId: symbol.providerId, symbol: symbol.symbol })) }, execution);
  },
});
const aiMcpController = new AiMcpController(aiPanel, aiToggle, {
  context: readCurrentAiChartSelection,
  describe: describeAiChartTools,
  open: openAiChartSession,
  subscribeTools: subscribeAiChartTools,
});
const watchlistPanel = document.querySelector<HTMLElement>('#watchlist-panel')!;
const watchlistRefresh = document.querySelector<HTMLButtonElement>('#watchlist-refresh')!;
const watchlistPanelAdd = document.querySelector<HTMLButtonElement>('#watchlist-panel-add')!;
const watchlistItems = document.querySelector<HTMLDivElement>('#watchlist-items')!;
const watchlistEmpty = document.querySelector<HTMLParagraphElement>('#watchlist-empty')!;
const marketDataPanel = document.querySelector<HTMLElement>('#market-data-panel')!;
const marketDataTitle = document.querySelector<HTMLElement>('#market-data-title')!;
const marketDataSymbol = document.querySelector<HTMLElement>('#market-data-symbol')!;
const marketDataUnavailable = document.querySelector<HTMLDivElement>('#market-data-unavailable')!;
const marketDepthView = document.querySelector<HTMLElement>('#market-depth-view')!;
const marketTradesView = document.querySelector<HTMLElement>('#market-trades-view')!;
const predictionRulesTab = document.querySelector<HTMLButtonElement>('#prediction-rules-tab')!;
const predictionRulesView = document.querySelector<HTMLElement>('#prediction-rules-view')!;
const predictionYes = document.querySelector<HTMLButtonElement>('#prediction-yes')!;
const predictionNo = document.querySelector<HTMLButtonElement>('#prediction-no')!;
const predictionEndDate = document.querySelector<HTMLElement>('#prediction-end-date')!;
const predictionCurrent = document.querySelector<HTMLElement>('#prediction-current')!;
const predictionChange = document.querySelector<HTMLElement>('#prediction-change')!;
const predictionVolume = document.querySelector<HTMLElement>('#prediction-volume')!;
const predictionLiquidity = document.querySelector<HTMLElement>('#prediction-liquidity')!;
const predictionDescription = document.querySelector<HTMLElement>('#prediction-description')!;
const predictionResolutionSource = document.querySelector<HTMLAnchorElement>('#prediction-resolution-source')!;
const marketDepthAsks = document.querySelector<HTMLDivElement>('#market-depth-asks')!;
const marketDepthBids = document.querySelector<HTMLDivElement>('#market-depth-bids')!;
const marketTrades = document.querySelector<HTMLDivElement>('#market-trades')!;
const bestAsk = document.querySelector<HTMLElement>('#best-ask')!;
const bestBid = document.querySelector<HTMLElement>('#best-bid')!;
const marketDepthSpread = document.querySelector<HTMLElement>('#market-depth-spread')!;
const undoDrawing = document.querySelector<HTMLButtonElement>('#undo-drawing')!;
const redoDrawing = document.querySelector<HTMLButtonElement>('#redo-drawing')!;
const drawingManager = document.querySelector<HTMLElement>('#drawing-manager')!;
const drawingManagerItems = document.querySelector<HTMLDivElement>('#drawing-manager-items')!;
const drawingManagerEmpty = document.querySelector<HTMLParagraphElement>('#drawing-manager-empty')!;
const dataWindowPanel = document.querySelector<HTMLElement>('#data-window-panel')!;
const dataWindowSymbol = document.querySelector<HTMLElement>('#data-window-symbol')!;
const dataWindowTime = document.querySelector<HTMLElement>('#data-window-time')!;
const dataWindowOpen = document.querySelector<HTMLElement>('#data-window-open')!;
const dataWindowHigh = document.querySelector<HTMLElement>('#data-window-high')!;
const dataWindowLow = document.querySelector<HTMLElement>('#data-window-low')!;
const dataWindowClose = document.querySelector<HTMLElement>('#data-window-close')!;
const dataWindowChange = document.querySelector<HTMLElement>('#data-window-change')!;
const dataWindowChangePercent = document.querySelector<HTMLElement>('#data-window-change-percent')!;
const dataWindowVolume = document.querySelector<HTMLElement>('#data-window-volume')!;
const chartTypeMenu = document.querySelector<HTMLDetailsElement>('#chart-type-menu')!;
const chartTypeSummary = chartTypeMenu.querySelector<HTMLElement>('summary')!;
const priceLineEditor = document.querySelector<HTMLDivElement>('#price-line-editor')!;
const priceLineEditorTitle = document.querySelector<HTMLElement>('#price-line-editor-title')!;
const priceLineInput = document.querySelector<HTMLInputElement>('#price-line-input')!;
const priceLineMessage = document.querySelector<HTMLParagraphElement>('#price-line-message')!;
const chartToast = document.querySelector<HTMLDivElement>('#chart-toast')!;
const markerTool = document.querySelector<HTMLButtonElement>('#marker-tool')!;
const markerEditor = document.querySelector<HTMLDivElement>('#marker-editor')!;
const markerEditorTitle = document.querySelector<HTMLElement>('#marker-editor-title')!;
const markerEditorTime = document.querySelector<HTMLElement>('#marker-editor-time')!;
const markerText = document.querySelector<HTMLInputElement>('#marker-text')!;
const markerShape = document.querySelector<HTMLSelectElement>('#marker-shape')!;
const markerPosition = document.querySelector<HTMLSelectElement>('#marker-position')!;
const markerColor = document.querySelector<HTMLInputElement>('#marker-color')!;
const markerSize = document.querySelector<HTMLInputElement>('#marker-size')!;
const markerMessage = document.querySelector<HTMLParagraphElement>('#marker-message')!;
const deleteMarkerButton = document.querySelector<HTMLButtonElement>('#delete-marker')!;
const priceScaleControls = document.querySelector<HTMLDetailsElement>('#price-scale-controls')!;
const resolutionFavorites = document.querySelector<HTMLDivElement>('#resolution-favorites')!;
const resolutionMenu = document.querySelector<HTMLDetailsElement>('#resolution-menu')!;
const tradingTimeMenu = document.querySelector<HTMLDetailsElement>('#trading-time-menu')!;
const tradingTimeTrigger = document.querySelector<HTMLElement>('#trading-time-trigger')!;
const priceRangeEditor = document.querySelector<HTMLDivElement>('#price-range-editor')!;
const priceRangeMin = document.querySelector<HTMLInputElement>('#price-range-min')!;
const priceRangeMax = document.querySelector<HTMLInputElement>('#price-range-max')!;
const priceRangeMessage = document.querySelector<HTMLParagraphElement>('#price-range-message')!;
const goToDateInput = document.querySelector<HTMLInputElement>('#go-to-date')!;
const goToDialogLayer = document.querySelector<HTMLDivElement>('#go-to-dialog-layer')!;
const goToCalendarGrid = document.querySelector<HTMLDivElement>('#go-to-calendar-grid')!;
const goToCalendarTitle = document.querySelector<HTMLElement>('#go-to-calendar-title')!;
const chartSettingsLayer = document.querySelector<HTMLDivElement>('#chart-settings-layer')!;
const chartSettingsDialog = document.querySelector<HTMLElement>('#chart-settings-dialog')!;
const openChartSettingsButton = document.querySelector<HTMLButtonElement>('#open-chart-settings')!;
const indicatorPickerLayer = document.querySelector<HTMLDivElement>('#indicator-picker-layer')!;
const indicatorPickerDialog = document.querySelector<HTMLElement>('#indicator-picker-dialog')!;
const indicatorPickerSearch = document.querySelector<HTMLInputElement>('#indicator-picker-search')!;
const indicatorPickerList = document.querySelector<HTMLDivElement>('#indicator-picker-list')!;
const indicatorPickerEmpty = document.querySelector<HTMLParagraphElement>('#indicator-picker-empty')!;
const importUserIndicatorButton = document.querySelector<HTMLButtonElement>('#import-user-indicator')!;
const userIndicatorFileInput = document.querySelector<HTMLInputElement>('#user-indicator-file')!;
const userIndicatorImportLayer = document.querySelector<HTMLDivElement>('#user-indicator-import-layer')!;
const userIndicatorImportPreview = document.querySelector<HTMLDivElement>('#user-indicator-import-preview')!;
const userIndicatorImportError = document.querySelector<HTMLParagraphElement>('#user-indicator-import-error')!;
const confirmUserIndicatorImportButton = document.querySelector<HTMLButtonElement>('#confirm-user-indicator-import')!;
const confirmUserIndicatorAddButton = document.querySelector<HTMLButtonElement>('#confirm-and-add-user-indicator')!;
const copyUserIndicatorAiDiagnosticButton = document.querySelector<HTMLButtonElement>('#copy-user-indicator-ai-diagnostic')!;
const indicatorMarkerTooltip = document.querySelector<HTMLDivElement>('#indicator-marker-tooltip')!;
const openIndicatorPickerButton = document.querySelector<HTMLButtonElement>('#open-indicator-picker')!;
const indicatorConfigLayer = document.querySelector<HTMLDivElement>('#indicator-config-layer')!;
const indicatorConfigDialog = document.querySelector<HTMLElement>('#indicator-config-form')!;
const indicatorConfigTitle = document.querySelector<HTMLElement>('#indicator-config-title')!;
const indicatorConfigFields = document.querySelector<HTMLDivElement>('#indicator-config-fields')!;
const indicatorConfigError = document.querySelector<HTMLParagraphElement>('#indicator-config-error')!;
const chartSettingsTimeZone = document.querySelector<HTMLSelectElement>('#chart-settings-time-zone')!;
const chartSettingsPreviousClose = document.querySelector<HTMLInputElement>('#chart-settings-previous-close')!;
const adjustmentSwitcher = document.querySelector<HTMLDivElement>('#adjustment-switcher')!;
const marketEditionLabel = document.querySelector<HTMLParagraphElement>('#market-edition-label')!;
const marketProviderSettings = document.querySelector<HTMLDivElement>('#market-provider-settings')!;
const marketEmptyState = document.querySelector<HTMLDivElement>('#market-empty-state')!;
const openMarketProviderSettingsButton = document.querySelector<HTMLButtonElement>('#open-market-provider-settings')!;
const chartSettingInputs = [...chartSettingsDialog.querySelectorAll<HTMLInputElement>('[data-chart-setting]')];
const chartSettingOpacityInputs = [...chartSettingsDialog.querySelectorAll<HTMLInputElement>('[data-chart-opacity-setting]')];
const chartAppearanceColorInputs = [...chartSettingsDialog.querySelectorAll<HTMLInputElement>('[data-chart-appearance-color]')];
const chartAppearanceOpacityInputs = [...chartSettingsDialog.querySelectorAll<HTMLInputElement>('[data-chart-appearance-opacity]')];
const chartSettingsTabs = [...chartSettingsDialog.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')];
const languageSelect = document.querySelector<HTMLSelectElement>('#language-select')!;
const confirmChartSettingsButton = document.querySelector<HTMLButtonElement>('#confirm-chart-settings')!;
let chartSettingsReturnFocus: HTMLElement | null = null;
let indicatorPickerReturnFocus: HTMLElement | null = null;
let indicatorConfigReturnFocus: HTMLElement | null = null;
let editingIndicatorInstanceId: string | null = null;
let editingIndicatorId: string | null = null;
let indicatorConfigReturnsToPicker = false;
const drawingButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-drawing-tool]')];
const drawingMenus = [...document.querySelectorAll<HTMLDetailsElement>('.drawing-tool-menu')];
const drawingPropertyControls = [...drawingProperties.querySelectorAll<HTMLDetailsElement>('.drawing-property-control')];
let pendingTextButton: HTMLButtonElement | null = null;
const SYMBOL_RESULT_PAGE_SIZE = 80;
const MARKET_CATALOG_PAGE_SIZE = 1_000;
const WIDGET_PANEL_WIDTH_STORAGE_KEY = 'tradeflow-lite.widget-panel-width.v1';
type MarketCatalogLoadState = {
  descriptor: MarketProviderDescriptor;
  venue: string;
  nextCursor: string | null;
  loading: boolean;
  pages: number;
  symbols: number;
};
const marketCatalogLoadStates = new Map<string, MarketCatalogLoadState>();
let matchingSymbolResults: MarketSymbol[] = [];
let visibleSymbolResults: MarketSymbol[] = [];
let activeSymbolResult = -1;
let activeSymbolCategory: MarketSearchCategory = 'all';
let activeSymbolSource: MarketSearchSource = 'all';
let symbolDialogMode: 'select' | 'watchlist' = 'select';
let symbolDialogReturnFocus: HTMLElement = input;
let renderedPriceLines: IPriceLine[] = [];
let chartToastTimer: number | undefined;
let priceLineEditorMode: 'cost' | 'custom' | null = null;

function marketEditionDisplayName(): string {
  if (marketEditionInfo.edition === 'cn') return 'CN';
  if (marketEditionInfo.edition === 'global') return 'Global';
  if (marketEditionInfo.edition === 'core') return 'Core';
  return 'Custom';
}

function providerDisplayName(descriptor: MarketProviderDescriptor): string {
  if (appLocale === 'zh-CN') return descriptor.displayName;
  const names: Record<string, string> = {
    tdx: 'TDX A-shares', binance_spot: 'Binance Spot', binance_usdm: 'Binance USD-M Perpetual',
    okx_spot: 'OKX Spot', okx_swap: 'OKX Perpetual', polymarket: 'Polymarket',
  };
  return names[descriptor.id] ?? descriptor.displayName;
}

function renderMarketProviderSettings() {
  marketEditionLabel.textContent = appLocale === 'zh-CN'
    ? `当前发行版：TradeFlow Lite ${marketEditionDisplayName()}`
    : `Edition: TradeFlow Lite ${marketEditionDisplayName()}`;
  marketProviderSettings.replaceChildren();
  for (const descriptor of initialMarketProviderDescriptors) {
    const available = providerIsAvailable(descriptor);
    const row = document.createElement('label');
    row.className = 'chart-settings-row market-provider-setting';
    const label = document.createElement('span');
    label.textContent = providerDisplayName(descriptor);
    if (!available) label.textContent += appLocale === 'zh-CN' ? '（当前构建未包含）' : ' (not compiled)';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.marketProvider = descriptor.id;
    input.checked = descriptor.enabled;
    input.disabled = !available;
    row.append(label, input);
    marketProviderSettings.append(row);
  }
}

function showNoMarketProviderState() {
  invalidateAiChartSessions();
  historyRequestGate.begin();
  stopRealtimeMarket();
  clearDeepHistoryTimer();
  if (latestPollTimer !== undefined) window.clearTimeout(latestPollTimer);
  latestPollTimer = undefined;
  defaultSymbol = emptyMarketSymbol;
  currentSymbol = emptyMarketSymbol;
  currentBars = [];
  currentQuote = null;
  currentSeriesKind = 'ohlcv';
  setPrimarySeriesData();
  volumeSeries.setData([]);
  input.value = '';
  document.querySelector<HTMLElement>('#legend-symbol')!.textContent = ui('未启用行情源');
  document.querySelector<HTMLElement>('#legend-values')!.textContent = '';
  document.querySelector<HTMLElement>('#instrument-logo')!.replaceChildren();
  errorLayer.hidden = true;
  loadingLayer.hidden = true;
  status.className = 'connection-status';
  status.disabled = true;
  setStatusLabel(status, ui('未启用行情源'));
  adjustmentSwitcher.hidden = true;
  marketEmptyState.hidden = false;
}

function hideNoMarketProviderState() {
  marketEmptyState.hidden = true;
  status.disabled = false;
}

function syncAdjustmentControls(symbol: MarketSymbol) {
  const descriptor = marketProviderById.get(symbol.providerId);
  const visible = showTdxAdjustmentControls(descriptor, symbol.providerId);
  adjustmentSwitcher.hidden = !visible;
}

async function applyMarketProviderSettings(): Promise<boolean> {
  const requested = new Set(
    [...marketProviderSettings.querySelectorAll<HTMLInputElement>('[data-market-provider]')]
      .filter((input) => input.checked && !input.disabled)
      .map((input) => input.dataset.marketProvider!),
  );
  if (!marketProviderSelectionChanged(requested, activeMarketProviderIds)) return false;
  const currentWillBeDisabled = currentSymbol.providerId !== 'none' && !requested.has(currentSymbol.providerId);
  if (currentWillBeDisabled) {
    invalidateAiChartSessions();
    historyRequestGate.begin();
    stopRealtimeMarket();
    clearDeepHistoryTimer();
    if (latestPollTimer !== undefined) window.clearTimeout(latestPollTimer);
    latestPollTimer = undefined;
  }
  for (const descriptor of initialMarketProviderDescriptors.filter(providerIsAvailable)) {
    const enabled = requested.has(descriptor.id);
    if (descriptor.enabled !== enabled) {
      await invoke('set_market_provider_enabled', { providerId: descriptor.id, enabled });
    }
  }
  await loadMarketCatalogs();
  if (!saveMarketProviderPreferences(workspaceStorage, marketEditionInfo.edition, activeMarketProviderIds)) {
    showChartToast('数据源设置未能保存');
  }
  if (!activeMarketProviderIds.has(currentSymbol.providerId)) {
    defaultSymbol = preferredInitialMarketSymbol();
    if (defaultSymbol.providerId === 'none') {
      showNoMarketProviderState();
    } else {
      hideNoMarketProviderState();
      const adjustment = defaultSymbol.kind === 'crypto' || defaultSymbol.kind === 'prediction' ? 'none' : currentAdjustment;
      await openHistory(defaultSymbol, currentResolution, adjustment);
    }
  } else {
    hideNoMarketProviderState();
  }
  renderMarketProviderSettings();
  renderSymbolSources();
  renderWatchlist();
  return true;
}

const symbolLogoObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const image = entry.target as HTMLImageElement;
    const source = image.dataset.logoSrc;
    if (source) image.src = source;
    symbolLogoObserver.unobserve(image);
  }
}, { root: symbolResults, rootMargin: '96px 0px' });

function persistChartPreferences() {
  chartPreferences.chartType = currentChartType;
  chartPreferences.priceScale = currentPriceScale;
  chartPreferences.priceScaleInverted = priceScaleInverted;
  chartPreferences.paneOrder = [...secondaryPaneOrder];
  chartPreferences.activeSeries = [
    ...(volumeVisible ? ['volume' as const] : []),
    ...activeIndicators,
  ];
  chartPreferences.hiddenSeries = [...hiddenSeries].filter((series) => chartPreferences.activeSeries.includes(series));
  chartPreferences.mainSeriesOrder = [...mainSeriesOrder];
  if (!saveChartPreferences(workspaceStorage, chartPreferences)) showChartToast('图表设置未能保存');
  persistIndicatorState();
}

function persistIndicatorState(strict = false) {
  if (!indicatorStateReady || (aiIndicatorLibraryBusy && !strict)) return;
  aiIndicatorRevision++;
  const instances = orderedIndicatorInstances().map((instance, menuOrder) => ({
    instanceId: instance.instanceId,
    indicatorId: instance.indicatorId,
    indicatorVersion: instance.indicatorVersion,
    ...(instance.runtimeKind === 'user'
      ? { runtimeKind: 'user' as const, sourceHash: instance.sourceHash! }
      : {}),
    visible: instance.visible,
    menuOrder,
    panes: indicatorChartHost.paneStates(instance.instanceId),
    inputs: instance.inputs,
  }));
  loadedIndicatorState = {
    instances,
    unresolvedEntries: loadedIndicatorState.unresolvedEntries,
    mainOverlayOrder: [
      { type: 'volume' },
      ...instances.flatMap((instance) => indicatorChartHost.series(instance.instanceId).length > 0
        ? [{ type: 'indicator' as const, instanceId: instance.instanceId }]
        : []),
    ],
  };
  if (!saveIndicatorState(workspaceStorage, loadedIndicatorState)) {
    if (strict) throw new CapabilityError('storage_failed');
    showChartToast('指标设置未能保存');
  }
}

function showChartToast(message: string) {
  if (chartToastTimer !== undefined) window.clearTimeout(chartToastTimer);
  chartToast.textContent = ui(message);
  chartToast.hidden = false;
  chartToastTimer = window.setTimeout(() => {
    chartToast.hidden = true;
    chartToastTimer = undefined;
  }, 2200);
}

function exchangeTimeZone(symbol = currentSymbol): string {
  return symbol.kind === 'crypto' || symbol.kind === 'prediction' ? 'UTC' : 'Asia/Shanghai';
}

function activeTradingTimeZone(symbol = currentSymbol): string {
  return resolveTradingTimeZone(tradingTimeChoice, exchangeTimeZone(symbol), systemTimeZone);
}

function renderResolutionControls() {
  resolutionFavorites.replaceChildren();
  for (const resolution of favoriteResolutions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toolbar-button';
    button.dataset.resolution = resolution;
    button.textContent = resolutionLabels[resolution];
    button.classList.toggle('active', resolution === currentResolution);
    button.addEventListener('click', () => void selectResolution(resolution));
    resolutionFavorites.append(button);
  }
  for (const row of document.querySelectorAll<HTMLElement>('[data-resolution-row]')) {
    row.classList.toggle('active', row.dataset.resolutionRow === currentResolution);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-favorite-resolution]')) {
    const resolution = button.dataset.favoriteResolution as Resolution;
    const selected = favoriteResolutions.includes(resolution);
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${selected ? '取消收藏' : '收藏'}${RESOLUTION_OPTIONS.find((option) => option.value === resolution)?.label ?? resolution}`);
  }
  resolutionMenu.classList.toggle('active', !favoriteResolutions.includes(currentResolution));
}

async function selectResolution(resolution: Resolution) {
  resolutionMenu.open = false;
  await openHistory(currentSymbol, resolution, currentAdjustment);
}

function formatTimeZoneClock(date: Date, timeZone = activeTradingTimeZone()): string {
  return new Intl.DateTimeFormat(appLocale, {
    timeZone,
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

function renderTradingTimeControls(date = new Date()) {
  const activeZone = activeTradingTimeZone();
  const clock = tradingTimeTrigger.querySelector<HTMLElement>('strong')!;
  clock.textContent = `${formatTimeZoneClock(date, activeZone)} ${formatUtcOffset(timeZoneOffsetMinutes(date, activeZone))}`;
  for (const button of tradingTimeMenu.querySelectorAll<HTMLButtonElement>('[data-trading-time]')) {
    const choice = button.dataset.tradingTime as TradingTimeChoice;
    const selected = choice === tradingTimeChoice;
    const displayZone = resolveTradingTimeZone(choice, exchangeTimeZone(), systemTimeZone);
    button.classList.toggle('active', selected);
    button.setAttribute('aria-checked', String(selected));
    button.querySelector('small')!.textContent = choice === 'exchange' || choice === 'system' || choice === 'UTC'
      ? ''
      : formatUtcOffset(timeZoneOffsetMinutes(date, displayZone));
  }
}

function applyTradingTimeChoice(choice: TradingTimeChoice, persist = true) {
  tradingTimeChoice = choice;
  chart.applyOptions({
    timeScale: { tickMarkFormatter: formatChartTick },
    localization: { timeFormatter: (time: Time) => formatChartTime(time) },
  });
  renderTradingTimeControls();
  tradingTimeMenu.open = false;
  if (persist && !saveTradingTimeChoice(workspaceStorage, tradingTimeChoice)) showChartToast('交易时间设置未能保存');
}

function applyAppTheme(nextTheme: AppTheme, persist = true) {
  appTheme = nextTheme;
  const isLight = appTheme === 'light';
  document.documentElement.classList.toggle('theme-light', isLight);
  document.documentElement.classList.toggle('theme-dark', !isLight);
  document.documentElement.style.colorScheme = appTheme;
  document.body.classList.toggle('theme-light', isLight);
  document.body.classList.toggle('theme-dark', !isLight);
  themeToggle.dataset.mode = appTheme;
  themeToggle.setAttribute('aria-pressed', String(isLight));
  const description = isLight
    ? '当前为亮色模式，点击切换到暗色模式'
    : '当前为暗色模式，点击切换到亮色模式';
  themeToggle.title = ui(description);
  themeToggle.setAttribute('aria-label', ui(description));

  applyChartAppearance(chartSettings);
  indicatorRuntime.setTheme(nextTheme);
  userIndicatorRuntime.setTheme(nextTheme);
  if (persist && !saveAppTheme(workspaceStorage, appTheme)) showChartToast('主题设置未能保存');
}

const appearanceColorKeys = [
  'backgroundColor', 'verticalGridColor', 'horizontalGridColor', 'paneSeparatorColor',
  'crosshairColor', 'axisTextColor', 'axisLineColor',
] as const;
const appearanceOpacityKeys = [
  'backgroundOpacity', 'verticalGridOpacity', 'horizontalGridOpacity', 'paneSeparatorOpacity',
  'crosshairOpacity', 'axisTextOpacity', 'axisLineOpacity',
] as const;
type AppearanceColorKey = typeof appearanceColorKeys[number];
type AppearanceOpacityKey = typeof appearanceOpacityKeys[number];

function chartAppearanceDefaults(theme: AppTheme): Record<AppearanceColorKey | AppearanceOpacityKey, string | number> {
  const palette = appThemePalette(theme);
  const light = theme === 'light';
  return {
    backgroundColor: palette.background,
    backgroundOpacity: 100,
    verticalGridColor: palette.grid,
    verticalGridOpacity: 100,
    horizontalGridColor: palette.grid,
    horizontalGridOpacity: 100,
    paneSeparatorColor: light ? '#0f172a' : '#94a3b8',
    paneSeparatorOpacity: 14,
    crosshairColor: palette.crosshair,
    crosshairOpacity: 100,
    axisTextColor: palette.text,
    axisTextOpacity: 100,
    axisLineColor: palette.border,
    axisLineOpacity: 100,
  };
}

function applyChartAppearance(settings: ChartSettings) {
  const defaults = chartAppearanceDefaults(appTheme);
  const appearance = settings.appearanceByTheme[appTheme];
  const color = (key: AppearanceColorKey) => (appearance[key] ?? defaults[key]) as string;
  const opacity = (key: AppearanceOpacityKey) => (appearance[key] ?? defaults[key]) as number;
  const resolved = (colorKey: AppearanceColorKey, opacityKey: AppearanceOpacityKey) => chartColorWithOpacity(color(colorKey), opacity(opacityKey));
  const palette = appThemePalette(appTheme);
  const separatorOpacity = opacity('paneSeparatorOpacity');
  chart.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: resolved('backgroundColor', 'backgroundOpacity') },
      textColor: resolved('axisTextColor', 'axisTextOpacity'),
      panes: {
        separatorColor: resolved('paneSeparatorColor', 'paneSeparatorOpacity'),
        separatorHoverColor: chartColorWithOpacity(color('paneSeparatorColor'), Math.min(100, separatorOpacity + 6)),
      },
    },
    grid: {
      vertLines: { color: resolved('verticalGridColor', 'verticalGridOpacity') },
      horzLines: { color: resolved('horizontalGridColor', 'horizontalGridOpacity') },
    },
    crosshair: {
      vertLine: { color: resolved('crosshairColor', 'crosshairOpacity'), labelBackgroundColor: palette.crosshairLabel },
      horzLine: { color: resolved('crosshairColor', 'crosshairOpacity'), labelBackgroundColor: palette.crosshairLabel },
    },
    timeScale: { borderColor: resolved('axisLineColor', 'axisLineOpacity') },
    rightPriceScale: { borderColor: resolved('axisLineColor', 'axisLineOpacity') },
  });
}

function applyChartSettings(settings: ChartSettings) {
  applyChartAppearance(settings);
  chart.applyOptions({
    grid: {
      vertLines: { visible: settings.verticalGridVisible },
      horzLines: { visible: settings.horizontalGridVisible },
    },
    crosshair: {
      vertLine: { labelVisible: settings.crosshairLabelsVisible },
      horzLine: { labelVisible: settings.crosshairLabelsVisible },
    },
  });
  const candlesVisible = currentSeriesKind !== 'probability' && primarySeriesVisible && currentChartType === 'candles';
  candleSeries.applyOptions({
    ...candlestickColorOptions(settings),
    visible: candlesVisible,
    borderVisible: settings.borderVisible,
    wickVisible: settings.wickVisible,
    priceLineColor: chartColorWithOpacity(settings.upColor, settings.upOpacity),
    priceLineVisible: settings.lastPriceLineVisible && candlesVisible,
    lastValueVisible: settings.lastPriceLineVisible && candlesVisible,
  });
  for (const series of [barSeries, closeLineSeries, areaSeries, baselineSeries]) {
    series.applyOptions({
      priceLineVisible: settings.lastPriceLineVisible,
      lastValueVisible: settings.lastPriceLineVisible,
    });
  }
  document.querySelector<HTMLElement>('#instrument-logo')!.hidden = !settings.legendSymbolVisible;
  document.querySelector<HTMLElement>('#legend-symbol')!.hidden = !settings.legendSymbolVisible;
  document.querySelector<HTMLElement>('#legend-values')!.hidden = !settings.legendValuesVisible;
  document.querySelector<HTMLElement>('#volume-legend')!.hidden = !volumeVisible || !settings.volumeLegendVisible;
  document.querySelector<HTMLElement>('#time-navigation')!.hidden = !settings.timeNavigationVisible;
  chartStage.classList.toggle('time-navigation-hidden', !settings.timeNavigationVisible);
}

function selectChartSettingsTab(tab: string) {
  for (const button of chartSettingsTabs) button.setAttribute('aria-selected', String(button.dataset.settingsTab === tab));
  for (const panel of chartSettingsDialog.querySelectorAll<HTMLElement>('[data-settings-panel]')) {
    panel.hidden = panel.dataset.settingsPanel !== tab;
  }
}

function openChartSettings() {
  closeToolbarMenus();
  chartSettingsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : openChartSettingsButton;
  for (const input of chartSettingInputs) {
    const key = input.dataset.chartSetting as keyof ChartSettings;
    if (input.type === 'checkbox') input.checked = chartSettings[key] as boolean;
    else {
      input.value = chartSettings[key] as string;
      refreshTfColorPicker(input);
    }
  }
  for (const input of chartSettingOpacityInputs) {
    const key = input.dataset.chartOpacitySetting as keyof ChartSettings;
    input.value = String(chartSettings[key]);
  }
  const appearanceDefaults = chartAppearanceDefaults(appTheme);
  const appearance = chartSettings.appearanceByTheme[appTheme];
  for (const input of chartAppearanceColorInputs) {
    const key = input.dataset.chartAppearanceColor as AppearanceColorKey;
    input.value = (appearance[key] ?? appearanceDefaults[key]) as string;
    refreshTfColorPicker(input);
  }
  for (const input of chartAppearanceOpacityInputs) {
    const key = input.dataset.chartAppearanceOpacity as AppearanceOpacityKey;
    input.value = String(appearance[key] ?? appearanceDefaults[key]);
  }
  const now = new Date();
  for (const option of TRADING_TIME_ZONE_OPTIONS) {
    const element = [...chartSettingsTimeZone.options].find((item) => item.value === option.value);
    if (!element) continue;
    const zone = resolveTradingTimeZone(option.value, exchangeTimeZone(), systemTimeZone);
    element.textContent = `(${formatUtcOffset(timeZoneOffsetMinutes(now, zone))}) ${option.label}`;
  }
  chartSettingsTimeZone.value = tradingTimeChoice;
  chartSettingsPreviousClose.checked = currentPriceLineSettings().previousClose;
  languageSelect.value = appLocale;
  renderMarketProviderSettings();
  selectChartSettingsTab('symbol');
  chartSettingsLayer.hidden = false;
  requestAnimationFrame(() => chartSettingsTabs[0]?.focus());
}

function closeChartSettings() {
  chartSettingsLayer.hidden = true;
  chartSettingsReturnFocus?.focus();
  chartSettingsReturnFocus = null;
}

async function confirmChartSettings() {
  const startedAt = performance.now();
  const previousButtonText = confirmChartSettingsButton.textContent ?? '';
  confirmChartSettingsButton.disabled = true;
  confirmChartSettingsButton.setAttribute('aria-busy', 'true');
  confirmChartSettingsButton.textContent = ui('正在应用');
  const next: ChartSettings = {
    ...chartSettings,
    appearanceByTheme: {
      dark: { ...chartSettings.appearanceByTheme.dark },
      light: { ...chartSettings.appearanceByTheme.light },
    },
  };
  for (const input of chartSettingInputs) {
    const key = input.dataset.chartSetting as keyof ChartSettings;
    (next as unknown as Record<string, string | boolean>)[key] = input.type === 'checkbox' ? input.checked : input.value;
  }
  for (const input of chartSettingOpacityInputs) {
    const key = input.dataset.chartOpacitySetting as keyof ChartSettings;
    (next as unknown as Record<string, number>)[key] = Number(input.value);
  }
  const appearanceDefaults = chartAppearanceDefaults(appTheme);
  const currentAppearance = chartSettings.appearanceByTheme[appTheme];
  const nextAppearance: ChartAppearanceSettings = { ...currentAppearance };
  for (const input of chartAppearanceColorInputs) {
    const key = input.dataset.chartAppearanceColor as AppearanceColorKey;
    const normalized = input.value.toLowerCase();
    (nextAppearance as Record<string, string | number | undefined>)[key] = currentAppearance[key] === undefined && normalized === appearanceDefaults[key]
      ? undefined
      : normalized;
  }
  for (const input of chartAppearanceOpacityInputs) {
    const key = input.dataset.chartAppearanceOpacity as AppearanceOpacityKey;
    const value = Number(input.value);
    (nextAppearance as Record<string, string | number | undefined>)[key] = currentAppearance[key] === undefined && value === appearanceDefaults[key]
      ? undefined
      : value;
  }
  next.appearanceByTheme[appTheme] = nextAppearance;
  chartSettings = next;
  applyChartSettings(chartSettings);
  const priceLineSettings = currentPriceLineSettings();
  if (priceLineSettings.previousClose !== chartSettingsPreviousClose.checked) {
    priceLineSettings.previousClose = chartSettingsPreviousClose.checked;
    persistChartPreferences();
    renderPriceLines();
    renderDrawingManager();
  }
  applyTradingTimeChoice(chartSettingsTimeZone.value as TradingTimeChoice);
  if (!saveChartSettings(workspaceStorage, chartSettings)) showChartToast('设置未能保存');
  let providerSettingsChanged = false;
  try {
    providerSettingsChanged = await applyMarketProviderSettings();
  } catch (error) {
    console.error('market.provider_settings_failed', error);
    showChartToast('数据源设置应用失败');
    confirmChartSettingsButton.disabled = false;
    confirmChartSettingsButton.removeAttribute('aria-busy');
    confirmChartSettingsButton.textContent = previousButtonText;
    return;
  }
  const nextLocale = APP_LOCALES.includes(languageSelect.value as AppLocale)
    ? languageSelect.value as AppLocale
    : appLocale;
  if (nextLocale !== appLocale) {
    if (!saveAppLocale(workspaceStorage, nextLocale)) {
      showChartToast('语言设置未能保存');
      confirmChartSettingsButton.disabled = false;
      confirmChartSettingsButton.removeAttribute('aria-busy');
      confirmChartSettingsButton.textContent = previousButtonText;
      return;
    }
    console.info('settings.confirm.completed', {
      localeChanged: true,
      providerSettingsChanged,
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
    window.location.reload();
    return;
  }
  console.info('settings.confirm.completed', {
    localeChanged: false,
    providerSettingsChanged,
    elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
  });
  confirmChartSettingsButton.disabled = false;
  confirmChartSettingsButton.removeAttribute('aria-busy');
  confirmChartSettingsButton.textContent = previousButtonText;
  closeChartSettings();
}

applyChartSettings(chartSettings);

function currentPriceLineSettings(): PriceLineSettings {
  const key = marketSymbolKey(currentSymbol);
  const legacyKey = legacyMarketSymbolKey(currentSymbol);
  const existing = chartPreferences.priceLines[key]
    ?? (legacyStateBelongsToProvider(currentSymbol) ? chartPreferences.priceLines[legacyKey] : undefined);
  if (existing) {
    if (key !== legacyKey && chartPreferences.priceLines[key] === undefined) {
      chartPreferences.priceLines[key] = existing;
    }
    return existing;
  }
  const created: PriceLineSettings = { previousClose: true, cost: null, custom: [] };
  chartPreferences.priceLines[key] = created;
  return created;
}

function clearRenderedPriceLines() {
  for (const line of renderedPriceLines) candleSeries.removePriceLine(line);
  renderedPriceLines = [];
}

function renderPriceLines() {
  clearRenderedPriceLines();
  const settings = currentPriceLineSettings();
  const previousClose = currentQuote?.previousClose
    ?? previousCloseFromBars(currentBars, currentResolution);
  if (settings.previousClose && previousClose !== null && previousClose > 0) {
    renderedPriceLines.push(candleSeries.createPriceLine({
      price: previousClose,
      color: '#787b86',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: ui('昨收'),
    }));
  }
  if (settings.cost !== null) {
    renderedPriceLines.push(candleSeries.createPriceLine({
      price: settings.cost,
      color: '#f6a623',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: ui('成本'),
    }));
  }
  for (const [index, price] of settings.custom.entries()) {
    renderedPriceLines.push(candleSeries.createPriceLine({
      price,
      color: '#2962ff',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: ui(`价位 ${index + 1}`),
    }));
  }
}

function syncPriceLineMenu() {
  const settings = currentPriceLineSettings();
  document.querySelector<HTMLButtonElement>('#edit-cost-price')!.classList.toggle('active', settings.cost !== null);
}

function openPriceLineEditor(mode: 'cost' | 'custom') {
  priceLineEditorMode = mode;
  const settings = currentPriceLineSettings();
  priceLineEditorTitle.textContent = mode === 'cost' ? '设置成本线' : '添加自定义价格线';
  priceLineInput.value = mode === 'cost' && settings.cost !== null ? String(settings.cost) : '';
  priceLineMessage.hidden = true;
  priceLineEditor.hidden = false;
  for (const menu of drawingMenus) menu.open = false;
  requestAnimationFrame(() => priceLineInput.focus());
}

function closePriceLineEditor() {
  priceLineEditorMode = null;
  priceLineEditor.hidden = true;
  priceLineMessage.hidden = true;
}

function commitPriceLineEditor() {
  if (!priceLineEditorMode) return;
  const value = Number(priceLineInput.value);
  if (!Number.isFinite(value) || value <= 0) {
    priceLineMessage.textContent = '请输入大于 0 的有效价格';
    priceLineMessage.hidden = false;
    priceLineInput.focus();
    return;
  }
  const settings = currentPriceLineSettings();
  if (priceLineEditorMode === 'cost') settings.cost = value;
  else if (!settings.custom.includes(value)) settings.custom.push(value);
  persistChartPreferences();
  renderPriceLines();
  syncPriceLineMenu();
  renderDrawingManager();
  closePriceLineEditor();
}

function setPrimarySeriesData() {
  candleSeries.setData(currentBars.map((bar, index) => candlePoint(bar, index)));
  const ohlc = currentBars.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp }));
  const closes = currentBars.map((bar) => ({ time: bar.time as UTCTimestamp, value: bar.close }));
  const isProbability = currentSeriesKind === 'probability';
  const candlesVisible = !isProbability && primarySeriesVisible && currentChartType === 'candles';
  candleSeries.applyOptions({
    ...candlestickColorOptions(chartSettings),
    visible: candlesVisible,
    borderVisible: chartSettings.borderVisible,
    wickVisible: chartSettings.wickVisible,
    priceLineVisible: candlesVisible && chartSettings.lastPriceLineVisible,
    lastValueVisible: candlesVisible && chartSettings.lastPriceLineVisible,
  });
  console.info('chart.candlestick_appearance.reapplied', {
    symbol: currentSymbol.symbol,
    resolution: currentResolution,
    visible: candlesVisible,
    bodyOpacity: chartSettings.bodyVisible ? [chartSettings.upOpacity, chartSettings.downOpacity] : [0, 0],
    borderOpacity: [chartSettings.borderUpOpacity, chartSettings.borderDownOpacity],
    wickOpacity: [chartSettings.wickUpOpacity, chartSettings.wickDownOpacity],
  });
  barSeries.applyOptions({ visible: !isProbability && primarySeriesVisible && currentChartType === 'bars' });
  closeLineSeries.applyOptions({
    visible: primarySeriesVisible && (isProbability || currentChartType === 'line'),
    priceFormat: isProbability
      ? { type: 'custom', minMove: 0.1, formatter: (value: number) => `${value.toFixed(1)}%` }
      : { type: 'price', precision: 2, minMove: 0.01 },
    autoscaleInfoProvider: isProbability
      ? () => ({ priceRange: { minValue: 0, maxValue: 100 } })
      : (baseImplementation: () => AutoscaleInfo | null) => baseImplementation(),
  });
  areaSeries.applyOptions({ visible: !isProbability && primarySeriesVisible && currentChartType === 'area' });
  baselineSeries.applyOptions({
    visible: !isProbability && primarySeriesVisible && currentChartType === 'baseline',
    baseValue: { type: 'price', price: currentBars[0]?.close ?? 0 },
  });
  barSeries.setData(!isProbability && currentChartType === 'bars' ? ohlc : []);
  closeLineSeries.setData(isProbability || currentChartType === 'line' ? closes : []);
  areaSeries.setData(!isProbability && currentChartType === 'area' ? closes : []);
  baselineSeries.setData(!isProbability && currentChartType === 'baseline' ? closes : []);
}

function updatePrimarySeries(bar: Bar, historicalUpdate = false) {
  candleSeries.update(candlePoint(bar), historicalUpdate);
  if (currentSeriesKind === 'probability') {
    closeLineSeries.update({ time: bar.time as UTCTimestamp, value: bar.close }, historicalUpdate);
    return;
  }
  if (currentChartType === 'bars') {
    barSeries.update({ ...bar, time: bar.time as UTCTimestamp }, historicalUpdate);
  }
  const close = { time: bar.time as UTCTimestamp, value: bar.close };
  if (currentChartType === 'line') closeLineSeries.update(close, historicalUpdate);
  if (currentChartType === 'area') areaSeries.update(close, historicalUpdate);
  if (currentChartType === 'baseline') baselineSeries.update(close, historicalUpdate);
}

function volumePoint(bar: Bar) {
  return {
    time: bar.time as UTCTimestamp,
    value: bar.volume,
    color: bar.close >= bar.open ? 'rgba(8, 153, 129, .48)' : 'rgba(242, 54, 69, .48)',
  };
}

function syncCurrentHistoryCacheBars() {
  const cacheKey = marketHistoryCacheKey(currentSymbol, currentResolution, currentAdjustment);
  const cached = getHistoryCache(currentSymbol, currentResolution, currentAdjustment);
  if (!cached) return;
  historyCache.set(cacheKey, { ...cached.value, bars: [...currentBars] }, cached.deep);
}

function commitBarReconciliation(
  reconciliation: BarReconciliation<Bar>,
  reason: IndicatorDataEvent['reason'] = 'reconciliation',
  realtimeUpdates: readonly IndicatorRealtimeBarUpdate[] = [],
  refreshIndicatorData = true,
) {
  const retention = retainRealtimeHistory(reconciliation.bars, currentResolution);
  const retentionTrimmed = retention.trimmed > 0;
  if (reconciliation.mutations.length > 0 || retentionTrimmed) {
    const previousDisplayedGeneration = aiDisplayedHistoryGeneration;
    aiDisplayedHistoryGeneration = -1;
    currentBars = retention.bars;
    if (reconciliation.requiresSeriesReset || retentionTrimmed) {
      setPrimarySeriesData();
      volumeSeries.setData(currentBars.map(volumePoint));
    } else {
      for (const mutation of reconciliation.mutations) {
        updatePrimarySeries(mutation.bar, mutation.historical);
        volumeSeries.update(volumePoint(mutation.bar), mutation.historical);
      }
    }
    syncCurrentHistoryCacheBars();
    aiChartDataRevision += 1;
    aiDisplayedHistoryGeneration = previousDisplayedGeneration;
    if (retentionTrimmed) {
      console.info('market.history.retention_trimmed', {
        providerId: currentSymbol.providerId,
        symbol: currentSymbol.symbol,
        resolution: currentResolution,
        trimmed: retention.trimmed,
        retained: currentBars.length,
        maxBars: retention.maxBars,
      });
    }
  }

  if (retentionTrimmed) {
    refreshIndicators(undefined, 'reconciliation', realtimeUpdates);
    return;
  }
  if (!refreshIndicatorData) return;
  const changedTimes = [...new Set([
    ...reconciliation.changedTimes,
    ...realtimeUpdates.map((update) => update.barTime),
  ])].sort((left, right) => left - right);
  if (changedTimes.length > 0) refreshIndicators(changedTimes, reason, realtimeUpdates);
}

function applyChartType(chartType: ChartType, preserveRange = true, persist = true) {
  if (currentSeriesKind === 'probability' && chartType !== 'line') {
    showChartToast('预测市场使用概率折线，不提供伪造 K 线');
    return;
  }
  const range = preserveRange ? chart.timeScale().getVisibleLogicalRange() : null;
  currentChartType = chartType;
  setPrimarySeriesData();
  indicatorChartHost.rebindCurrentMainSeries();
  refreshIndicators();
  renderSeriesMarkers();
  applyMainSeriesOrder();
  chartTypeSummary.innerHTML = `${chartTypeIcons[chartType]}<span id="chart-type-label" class="visually-hidden">${chartTypeLabels[chartType]}</span>`;
  chartTypeSummary.setAttribute('aria-label', chartTypeLabels[chartType]);
  chartTypeSummary.title = chartTypeLabels[chartType];
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-chart-type]')) {
    const active = button.dataset.chartType === chartType;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
  if (range) requestAnimationFrame(() => chart.timeScale().setVisibleLogicalRange(range));
  if (persist) persistChartPreferences();
}

function applyPriceScale(setting: PriceScaleSetting, persist = true) {
  currentPriceScale = setting;
  chart.priceScale('right').applyOptions({ mode: priceScaleModes[setting], invertScale: priceScaleInverted });
  chart.priceScale('right').setAutoScale(priceScaleAuto);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-price-scale]')) {
    const active = button.dataset.priceScale === setting;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const autoButton = document.querySelector<HTMLButtonElement>('#price-scale-auto')!;
  autoButton.classList.toggle('active', priceScaleAuto);
  autoButton.setAttribute('aria-pressed', String(priceScaleAuto));
  const invertButton = document.querySelector<HTMLButtonElement>('#price-scale-invert')!;
  invertButton.classList.toggle('active', priceScaleInverted);
  invertButton.setAttribute('aria-pressed', String(priceScaleInverted));
  if (persist) persistChartPreferences();
}

function openManualPriceRange() {
  if (currentBars.length === 0) { showChartToast('图表暂无可用价格'); return; }
  const range = chart.priceScale('right').getVisibleRange();
  const prices = currentBars.flatMap((bar) => [bar.low, bar.high]);
  priceRangeMin.value = formatPrice(range?.from ?? Math.min(...prices));
  priceRangeMax.value = formatPrice(range?.to ?? Math.max(...prices));
  priceRangeMessage.hidden = true;
  priceRangeEditor.hidden = false;
  priceScaleControls.open = false;
  requestAnimationFrame(() => priceRangeMin.focus());
}

function applyManualPriceRange() {
  const from = Number(priceRangeMin.value);
  const to = Number(priceRangeMax.value);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    priceRangeMessage.textContent = '最低价必须小于最高价';
    priceRangeMessage.hidden = false;
    return;
  }
  priceScaleAuto = false;
  chart.priceScale('right').setVisibleRange({ from, to });
  priceRangeEditor.hidden = true;
  applyPriceScale(currentPriceScale);
}

function renderSymbolLogo(container: HTMLSpanElement, item: MarketSymbol, eager: boolean) {
  const urls = symbolLogoUrls(item);
  const placeholder = document.createElement('span');
  placeholder.className = 'symbol-logo-placeholder';
  placeholder.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18V11h3v7H5Zm5 0V6h4v12h-4Zm6 0V9h3v9h-3Z"/></svg>';
  const image = document.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.addEventListener('load', () => container.classList.add('has-image'));
  image.addEventListener('error', () => {
    container.classList.remove('has-image');
    if (image.src !== urls.fallback) image.src = urls.fallback;
  });
  container.replaceChildren(placeholder, image);
  if (eager) image.src = urls.primary;
  else {
    image.dataset.logoSrc = urls.primary;
    symbolLogoObserver.observe(image);
  }
}

function createSymbolLogo(item: MarketSymbol) {
  const logo = document.createElement('span');
  logo.className = 'symbol-result-logo';
  renderSymbolLogo(logo, item, false);
  return logo;
}

function createWatchlistLogo(item: MarketSymbol) {
  const logo = document.createElement('span');
  logo.className = 'watchlist-logo';
  renderSymbolLogo(logo, item, true);
  return logo;
}

function createExchangeBadge(exchange: MarketSymbol['exchange']) {
  const badge = document.createElement('span');
  badge.className = 'symbol-result-exchange';
  const image = document.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.addEventListener('error', () => badge.classList.add('missing'));
  image.dataset.logoSrc = exchangeLogoUrl(exchange);
  const label = document.createElement('span');
    label.textContent = exchangeDisplayName(exchange);
  badge.append(image, label);
  symbolLogoObserver.observe(image);
  return badge;
}

function persistWatchlist() {
  aiWatchlistRevision++;
  const persisted = watchlistSymbols.map((symbolId) => {
    const item = marketSymbolById.get(symbolId);
    return item ? watchlistSymbolKey(item.providerId, item.symbol) : symbolId;
  });
  if (!saveWatchlist(workspaceStorage, persisted)) {
    errorLayer.hidden = false;
    errorLayer.textContent = '自选保存失败：本地存储当前不可用';
  }
}

function watchlistContains(item: MarketSymbol): boolean {
  const key = watchlistSymbolKey(item.providerId, item.symbol);
  return watchlistSymbols.includes(key)
    || (legacyStateBelongsToProvider(item) && watchlistSymbols.includes(item.symbol));
}

function addSymbolToWatchlist(item: MarketSymbol): boolean {
  if (watchlistContains(item)) return false;
  watchlistSymbols = [...watchlistSymbols, watchlistSymbolKey(item.providerId, item.symbol)];
  persistWatchlist();
  renderWatchlist();
  if (!watchlistPanel.hidden) void refreshWatchlistQuotes();
  return true;
}

function formatWatchlistPrice(item: MarketSymbol, value: number): string {
  if (item.kind === 'prediction') return `${value.toFixed(1)}%`;
  if (item.kind === 'etf') return value.toFixed(3).replace(/\.?0+$/, '');
  if (item.kind === 'stock' || item.kind === 'index') return value.toFixed(2);
  const digits = value >= 1_000 ? 2 : value >= 1 ? 4 : value >= 0.01 ? 6 : 8;
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

function watchlistQuoteFor(item: MarketSymbol): QuoteSnapshot | undefined {
  if (currentSymbol.providerId === item.providerId && currentSymbol.symbol === item.symbol && currentQuote) {
    return currentQuote;
  }
  return watchlistQuotes.get(marketSymbolKey(item));
}

function renderWatchlistQuoteCells(row: HTMLElement, item: MarketSymbol, quote = watchlistQuoteFor(item)): void {
  const lastCell = row.querySelector<HTMLElement>('.watchlist-last')!;
  const changeCell = row.querySelector<HTMLElement>('.watchlist-change')!;
  const percentCell = row.querySelector<HTMLElement>('.watchlist-change-percent')!;
  lastCell.className = 'watchlist-last';
  changeCell.className = 'watchlist-change';
  percentCell.className = 'watchlist-change-percent';
  if (!quote) {
    lastCell.textContent = '--';
    changeCell.textContent = '--';
    percentCell.textContent = '--';
    return;
  }
  const change = quote.last - quote.previousClose;
  const percent = quote.previousClose ? change / quote.previousClose * 100 : 0;
  const direction = change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral';
  const sign = change > 0 ? '+' : '';
  lastCell.textContent = formatWatchlistPrice(item, quote.last);
  changeCell.textContent = `${sign}${formatWatchlistPrice(item, change)}`;
  percentCell.textContent = `${sign}${percent.toFixed(2)}%`;
  lastCell.classList.add(direction);
  changeCell.classList.add(direction);
  percentCell.classList.add(direction);
}

function renderWatchlist() {
  watchlistItems.replaceChildren();
  watchlistEmpty.hidden = watchlistSymbols.length > 0;
  const currentWatchlistKey = watchlistSymbolKey(currentSymbol.providerId, currentSymbol.symbol);
  const containsCurrent = watchlistSymbols.includes(currentWatchlistKey)
    || (legacyStateBelongsToProvider(currentSymbol) && watchlistSymbols.includes(currentSymbol.symbol));
  watchlistAdd.classList.toggle('active', containsCurrent);
  watchlistAdd.title = containsCurrent ? '从自选移除' : '添加到自选';
  watchlistAdd.setAttribute('aria-label', containsCurrent ? '从自选移除当前证券' : '添加当前证券到自选');

  for (const [index, symbolId] of watchlistSymbols.entries()) {
    const item = marketSymbolById.get(symbolId);
    if (!item) continue;
    const row = document.createElement('div');
    row.className = `watchlist-row${symbolId === currentWatchlistKey
      || (legacyStateBelongsToProvider(currentSymbol) && symbolId === currentSymbol.symbol) ? ' current' : ''}`;
    row.dataset.watchlistQuoteKey = marketSymbolKey(item);
    row.setAttribute('role', 'row');
    row.tabIndex = 0;
    const openButton = document.createElement('button');
    openButton.className = 'watchlist-open';
    openButton.type = 'button';
    openButton.innerHTML = '<strong></strong>';
    openButton.prepend(createWatchlistLogo(item));
    openButton.querySelector('strong')!.textContent = item.name;
    openButton.title = `${item.name} · ${item.code} · ${item.exchange}`;
    const lastCell = document.createElement('span');
    lastCell.className = 'watchlist-last';
    const changeCell = document.createElement('span');
    changeCell.className = 'watchlist-change';
    const percentCell = document.createElement('span');
    percentCell.className = 'watchlist-change-percent';
    const actions = document.createElement('div');
    actions.className = 'watchlist-actions';
    row.append(openButton, lastCell, changeCell, percentCell, actions);
    renderWatchlistQuoteCells(row, item);
    row.addEventListener('click', (event) => {
      if (!(event.target as Element).closest('.watchlist-actions')) void selectSymbol(item);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void selectSymbol(item);
      }
    });

    for (const [label, direction, iconMarkup] of [['上移', -1, moveUpWidgetIcon], ['下移', 1, moveDownWidgetIcon]] as const) {
      const moveButton = document.createElement('button');
      moveButton.className = 'watchlist-action';
      moveButton.type = 'button';
      moveButton.innerHTML = iconMarkup;
      moveButton.title = label;
      moveButton.setAttribute('aria-label', label);
      moveButton.disabled = direction < 0 ? index === 0 : index === watchlistSymbols.length - 1;
      moveButton.addEventListener('click', () => {
        watchlistSymbols = moveWatchlistSymbol(watchlistSymbols, index, direction);
        persistWatchlist();
        renderWatchlist();
      });
      actions.append(moveButton);
    }
    const removeButton = document.createElement('button');
    removeButton.className = 'watchlist-action danger';
    removeButton.type = 'button';
    removeButton.innerHTML = removeSymbolWidgetIcon;
    removeButton.title = '删除';
    removeButton.setAttribute('aria-label', `从自选移除 ${item.name}`);
    removeButton.addEventListener('click', () => {
      watchlistSymbols = watchlistSymbols.filter((symbol) => symbol !== symbolId);
      watchlistQuotes.delete(marketSymbolKey(item));
      persistWatchlist();
      renderWatchlist();
    });
    actions.append(removeButton);
    watchlistItems.append(row);
  }
}

async function refreshWatchlistQuotes(): Promise<void> {
  const refreshId = ++watchlistQuoteRefreshId;
  const items = watchlistSymbols
    .map((symbolId) => marketSymbolById.get(symbolId))
    .filter((item): item is MarketSymbol => item !== undefined && providerSupportsQuote(item));
  watchlistRefresh.classList.add('loading');
  watchlistRefresh.disabled = true;
  let updated = 0;
  let failed = 0;
  for (let index = 0; index < items.length && refreshId === watchlistQuoteRefreshId; index += 4) {
    const results = await Promise.allSettled(items.slice(index, index + 4).map(async (item) => {
      const response = await invoke<QuoteResponse>('get_quote_snapshot', {
        providerId: item.providerId,
        symbol: item.symbol,
        kind: item.kind,
      });
      if (!matchesQuoteResponse(response, item.providerId, item.symbol) || !isUsableQuote(response.quote)) {
        throw new Error('invalid quote response');
      }
      return { item, quote: response.quote };
    }));
    if (refreshId !== watchlistQuoteRefreshId) break;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        watchlistQuotes.set(marketSymbolKey(result.value.item), result.value.quote);
        updated += 1;
      } else {
        failed += 1;
      }
    }
    for (const row of watchlistItems.querySelectorAll<HTMLElement>('.watchlist-row')) {
      const item = marketSymbolById.get(row.dataset.watchlistQuoteKey ?? '');
      if (item) renderWatchlistQuoteCells(row, item);
    }
  }
  if (refreshId !== watchlistQuoteRefreshId) return;
  watchlistRefresh.classList.remove('loading');
  watchlistRefresh.disabled = false;
  console.info('watchlist.quotes.refresh', { requested: items.length, updated, failed });
}

function formatMarketPrice(value: number): string {
  if (currentSeriesKind === 'probability') return `${value.toFixed(1)}%`;
  const digits = value >= 1_000 ? 2 : value >= 1 ? 4 : value >= 0.01 ? 6 : 8;
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

function formatMarketQuantity(value: number): string {
  return marketQuantityFormatter.format(value);
}

const marketQuantityFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });

function isRealtimeMarketDataSupported() {
  return currentSymbol.realtime === true;
}

function isPolledDepthSupported(symbol: MarketSymbol) {
  return symbol.providerId === 'tdx'
    && (symbol.kind === 'stock' || symbol.kind === 'etf')
    && providerSupportsQuote(symbol);
}

function isPolledTradesSupported(symbol: MarketSymbol) {
  return isPolledDepthSupported(symbol);
}

function realtimeProviderId(symbol: MarketSymbol): string {
  return symbol.providerId;
}

function acceptsRealtimeSequence(
  event: {
    requestId: number;
    providerId: string;
    symbol: string;
    resolution: string;
    sequence?: number | null;
    source?: unknown;
  },
  channel: 'bar' | 'point' | 'depth' | 'trade',
) {
  if (event.sequence == null) return true;
  const key = realtimeSequenceKey(event, channel);
  const previous = lastRealtimeSequenceByChannel.get(key);
  if (!isRealtimeSequenceFresh(event.sequence, previous)) return false;
  if (previous === undefined || event.sequence > previous) {
    lastRealtimeSequenceByChannel.set(key, event.sequence);
  }
  return true;
}

function ensureMarketRows(container: HTMLElement, count: number, baseClass: string) {
  if ([...container.children].some((child) => child.tagName !== 'DIV')) container.replaceChildren();
  while (container.children.length < count) {
    const row = document.createElement('div');
    row.className = baseClass;
    row.innerHTML = '<span></span><strong></strong><span></span>';
    container.append(row);
  }
  while (container.children.length > count) container.lastElementChild?.remove();
  return [...container.children] as HTMLElement[];
}

function updateDepthRows(
  container: HTMLElement,
  side: 'bid' | 'ask',
  levels: Array<{ price: number; quantity: number }>,
) {
  const rows = ensureMarketRows(container, levels.length, 'market-depth-row');
  for (const [index, level] of levels.entries()) {
    const row = rows[index];
    row.className = `market-depth-row ${side}`;
    row.children[0].textContent = side === 'ask' ? `卖${levels.length - index}` : `买${index + 1}`;
    row.children[1].textContent = formatMarketPrice(level.price);
    row.children[2].textContent = formatMarketQuantity(level.quantity);
  }
}

function renderMarketDepth() {
  const depth = latestDepth;
  if (!depth) {
    ensureMarketRows(marketDepthAsks, 0, 'market-depth-row');
    ensureMarketRows(marketDepthBids, 0, 'market-depth-row');
    bestAsk.textContent = '--';
    bestBid.textContent = '--';
    marketDepthSpread.textContent = '等待实时深度';
    return;
  }
  const ask = depth.asks[0];
  const bid = depth.bids[0];
  bestAsk.textContent = ask ? formatMarketPrice(ask.price) : '--';
  bestBid.textContent = bid ? formatMarketPrice(bid.price) : '--';
  marketDepthSpread.textContent = ask && bid ? formatMarketPrice(ask.price - bid.price) : '--';
  updateDepthRows(marketDepthAsks, 'ask', [...depth.asks].reverse());
  updateDepthRows(marketDepthBids, 'bid', depth.bids);
}

function applyQuoteDepth(quote: QuoteSnapshot, symbol: MarketSymbol, resolution: Resolution) {
  const book = quoteBookLevels(quote);
  if (!book) return;
  const firstSnapshot = latestDepth === null;
  const eventTimeMs = quote.receivedAt * 1_000;
  latestDepth = {
    requestId: activeRealtimeRequestId,
    providerId: symbol.providerId,
    symbol: symbol.symbol,
    resolution,
    eventTimeMs,
    bids: book.bids,
    asks: book.asks,
  };
  if (firstSnapshot) {
    console.info('market.depth.first_snapshot', {
      providerId: symbol.providerId,
      symbol: symbol.symbol,
      bids: book.bids.length,
      asks: book.asks.length,
      eventTimeMs,
    });
  }
  if (!marketDataPanel.hidden && activeMarketDataTab === 'depth') renderMarketDataPanel();
}

function renderMarketTrades() {
  if (!recentTrades.length) {
    if (marketTrades.children.length !== 1 || marketTrades.firstElementChild?.tagName !== 'P') {
      const empty = document.createElement('p');
      empty.textContent = '等待实时成交';
      marketTrades.replaceChildren(empty);
    }
    return;
  }
  const rows = ensureMarketRows(marketTrades, recentTrades.length, 'market-trade-row');
  for (const [index, trade] of recentTrades.entries()) {
    const row = rows[index];
    row.className = `market-trade-row ${trade.side === 'sell' ? 'sell' : trade.side === 'buy' ? 'buy' : ''}`;
    const formatter = trade.providerId === 'tdx' ? shanghaiTradeTimeFormatter : realtimeTimeFormatter;
    row.children[0].textContent = formatter.format(new Date(trade.tradeTimeMs));
    row.children[1].textContent = formatMarketPrice(trade.price);
    row.children[2].textContent = currentSeriesKind === 'probability' && trade.quantity === 0
      ? '--'
      : formatMarketQuantity(trade.quantity);
  }
}

const compactUsd = new Intl.NumberFormat(appLocale, {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
});

function opposingPredictionSymbol(symbol: MarketSymbol): MarketSymbol | null {
  const metadata = symbol.prediction;
  if (!metadata) return null;
  const nextOutcome = metadata.outcome.toUpperCase() === 'YES' ? 'NO' : 'YES';
  return {
    ...symbol,
    symbol: metadata.opposingSymbol,
    code: nextOutcome,
    aliases: [metadata.opposingSymbol.split(':')[1] ?? '', symbol.name, metadata.conditionId],
    prediction: {
      ...metadata,
      outcome: nextOutcome,
      opposingSymbol: symbol.symbol,
      probability: 100 - metadata.probability,
      change24h: -metadata.change24h,
    },
  };
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function openExternalUrl(value: string) {
  const url = safeExternalUrl(value);
  if (!url) {
    console.warn('app.external_link.rejected', { url: value });
    showChartToast('仅允许打开 HTTPS 链接');
    return;
  }
  void openUrl(url).catch((error: unknown) => {
    console.error('app.external_link.open_failed', { url, error: String(error) });
    showChartToast('链接打开失败');
  });
}

function renderPredictionRules() {
  const metadata = currentSymbol.prediction;
  if (!metadata) return;
  const outcome = metadata.outcome.toUpperCase();
  predictionYes.classList.toggle('active', outcome === 'YES');
  predictionNo.classList.toggle('active', outcome === 'NO');
  predictionCurrent.textContent = `${metadata.probability.toFixed(1)}%`;
  predictionChange.textContent = `${metadata.change24h > 0 ? '+' : ''}${metadata.change24h.toFixed(1)} 个百分点`;
  predictionChange.className = metadata.change24h >= 0 ? 'up' : 'down';
  const endDate = metadata.endDate ? new Date(metadata.endDate) : null;
  predictionEndDate.textContent = endDate && Number.isFinite(endDate.getTime())
    ? new Intl.DateTimeFormat(appLocale, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(endDate)
    : '--';
  predictionVolume.textContent = compactUsd.format(metadata.volume);
  predictionLiquidity.textContent = compactUsd.format(metadata.liquidity);
  predictionDescription.textContent = metadata.description || ui('以 Polymarket 公布的市场规则和结算来源为准。');
  const resolutionSource = safeExternalUrl(metadata.resolutionSource);
  predictionResolutionSource.hidden = resolutionSource === null;
  if (resolutionSource) predictionResolutionSource.href = resolutionSource;
  else predictionResolutionSource.removeAttribute('href');
}

function renderMarketDataPanel() {
  const realtimeSupported = isRealtimeMarketDataSupported();
  const depthSupported = realtimeSupported || isPolledDepthSupported(currentSymbol);
  const tradesSupported = realtimeSupported || isPolledTradesSupported(currentSymbol);
  const prediction = currentSymbol.kind === 'prediction' && currentSymbol.prediction !== undefined;
  if (!prediction && activeMarketDataTab === 'rules') activeMarketDataTab = 'depth';
  const activeTabSupported = activeMarketDataTab === 'depth'
    ? depthSupported
    : activeMarketDataTab === 'trades'
      ? tradesSupported
      : false;
  marketDataSymbol.textContent = currentSymbol.code;
  marketDataTitle.textContent = activeMarketDataTab === 'depth' ? '盘口' : activeMarketDataTab === 'trades' ? '成交' : '规则';
  predictionRulesTab.hidden = !prediction;
  marketDataUnavailable.textContent = activeMarketDataTab === 'trades'
    ? '当前品种暂未接入逐笔成交'
    : '当前品种暂未接入盘口';
  marketDataUnavailable.hidden = activeTabSupported || activeMarketDataTab === 'rules';
  marketDepthView.hidden = !depthSupported || activeMarketDataTab !== 'depth';
  marketTradesView.hidden = !tradesSupported || activeMarketDataTab !== 'trades';
  predictionRulesView.hidden = !prediction || activeMarketDataTab !== 'rules';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-market-data-tab]')) {
    button.setAttribute('aria-selected', String(button.dataset.marketDataTab === activeMarketDataTab));
  }
  if (prediction) renderPredictionRules();
  if (!activeTabSupported || activeMarketDataTab === 'rules') return;
  if (activeMarketDataTab === 'depth') renderMarketDepth();
  else renderMarketTrades();
}

function resetMarketData() {
  latestDepth = null;
  recentTrades = [];
  lastIndicatorAggregateTradeId = null;
  pendingRealtimeBars.clear();
  cancelRealtimeFrameSchedule();
  pendingRealtimeDepth = null;
  pendingRealtimeTrades = [];
  if (marketDataTimerId !== undefined) window.clearTimeout(marketDataTimerId);
  marketDataTimerId = undefined;
  lastMarketDataRenderAt = 0;
  if (realtimeIndicatorTimerId !== undefined) window.clearTimeout(realtimeIndicatorTimerId);
  realtimeIndicatorTimerId = undefined;
  pendingRealtimeIndicatorUpdates.clear();
  resetRealtimeHealthWindow(performance.now(), true);
  renderMarketDataPanel();
}

const drawingToolLabels: Record<string, string> = {
  TrendLine: '趋势线 · 在主图上点两次',
  Ray: '射线 · 点起点和方向点',
  Arrow: '箭头 · 点起点和终点',
  ExtendedLine: '延长线 · 点两个位置确定方向',
  HorizontalLine: '水平线 · 在目标价格点一下',
  HorizontalRay: '水平射线 · 点起点放置',
  VerticalLine: '垂直线 · 在目标时间点一下',
  CrossLine: '十字线 · 点交叉位置放置',
  Callout: '标注框 · 输入文字后点锚点和标注位置',
  Rectangle: '矩形 · 在主图上按住并拖动',
  Circle: '圆形 · 在主图上点圆心和边缘',
  ParallelChannel: '平行通道 · 依次点三个位置',
  FibRetracement: '斐波那契回撤 · 在主图上点两次',
  Brush: '笔刷 · 按住并拖动，松开完成',
  Highlighter: '荧光笔 · 按住并拖动，松开完成',
  Triangle: '三角形 · 依次点三个顶点',
  Path: '多段路径 · 依次点各节点，双击完成',
  Text: '文字 · 在主图上点一下放置',
  PriceRange: '价格区间 · 在主图上拖出测量范围',
  LongShortPosition: '多空仓位 · 设置入场、止损和目标',
  UpArrow: '向上箭头 · 在主图上点一下放置',
};

const drawingToolNames: Record<string, string> = {
  TrendLine: '趋势线', Ray: '射线', Arrow: '箭头', ExtendedLine: '延长线',
  HorizontalLine: '水平线', HorizontalRay: '水平射线', VerticalLine: '垂直线', CrossLine: '十字线',
  Callout: '标注框', Highlighter: '荧光笔', Triangle: '三角形', Path: '多段路径',
  Rectangle: '矩形', Circle: '圆形', ParallelChannel: '平行通道', UpArrow: '向上箭头',
  FibRetracement: '斐波那契回撤', Brush: '笔刷', Text: '文字', PriceRange: '价格区间',
  LongShortPosition: '多空仓位',
};

function currentDrawingScope() {
  return drawingScope(currentSymbol.symbol, currentAdjustment, currentSymbol.providerId);
}

function legacyDrawingScope() {
  return drawingScope(currentSymbol.symbol, currentAdjustment);
}

function currentDrawingSnapshot(): string | null {
  return validateDrawingSnapshot(JSON.stringify(drawingAttachments.export()), knownDrawingTypes);
}

function updateDrawingHistoryButtons() {
  undoDrawing.disabled = !drawingHistory.canUndo;
  redoDrawing.disabled = !drawingHistory.canRedo;
}

function currentDrawingExports(): DrawingExport[] {
  const snapshot = currentDrawingSnapshot();
  return snapshot ? JSON.parse(snapshot) as DrawingExport[] : [];
}

function currentMarkerScope() {
  return markerScope(currentSymbol.symbol, currentAdjustment, currentResolution, currentSymbol.providerId);
}

function legacyMarkerScope() {
  return markerScope(currentSymbol.symbol, currentAdjustment, currentResolution);
}

function currentMarkers() {
  return markerScopes.get(currentMarkerScope())
    ?? (legacyStateBelongsToProvider(currentSymbol) ? markerScopes.get(legacyMarkerScope()) : undefined)
    ?? [];
}

function persistMarkers(markers: ChartMarker[]) {
  markerScopes.set(currentMarkerScope(), markers);
  if (!saveMarkerScopes(workspaceStorage, markerScopes)) showChartToast('标记未能保存');
  renderSeriesMarkers();
  if (!drawingManager.hidden) renderDrawingManager();
}

function renderSeriesMarkers() {
  indicatorMarkerTooltip.hidden = true;
  const validTimes = new Set(currentBars.map((bar) => bar.time));
  const manual: SeriesMarker<Time>[] = currentMarkers()
    .filter((marker) => marker.visible && validTimes.has(marker.time))
    .map((marker) => ({
      id: marker.id,
      time: marker.time as UTCTimestamp,
      position: marker.position,
      shape: marker.shape,
      color: marker.color,
      text: marker.text || undefined,
      size: marker.size,
    }));
  const indicatorMarkers: SeriesMarker<Time>[] = indicatorMainSeriesHost.markerValues()
    .filter((marker: IndicatorMarker) => validTimes.has(marker.time))
    .flatMap((marker: IndicatorMarker) => {
      const positioned = marker.position.startsWith('atPrice')
        ? { position: marker.position, price: marker.price }
        : { position: marker.position };
      const shape: SeriesMarker<Time> = {
        id: marker.id,
        time: marker.time as UTCTimestamp,
        ...positioned,
        shape: marker.shape,
        color: marker.color,
        text: marker.textColor ? undefined : marker.text,
        size: marker.size,
      } as SeriesMarker<Time>;
      if (!marker.text || !marker.textColor) return [shape];
      return [shape, {
        id: marker.id ? `${marker.id}:text` : undefined,
        time: marker.time as UTCTimestamp,
        ...positioned,
        shape: 'circle',
        color: marker.textColor,
        text: marker.text,
        size: 0,
      } as SeriesMarker<Time>];
    });
  const combined = [...indicatorMarkers, ...manual]
    .sort((left, right) => Number(left.time) - Number(right.time));
  for (const [chartType, api] of Object.entries(seriesMarkerApis) as [ChartType, ISeriesMarkersPluginApi<Time>][]) {
    api.setMarkers(chartType === currentChartType && primarySeriesVisible ? combined : []);
  }
}

function closeMarkerEditor() {
  markerEditor.hidden = true;
  markerMessage.hidden = true;
  editingMarkerId = null;
  pendingMarkerTime = null;
}

function cancelMarkerPlacement() {
  markerPlacementActive = false;
  markerTool.classList.remove('active');
  markerTool.setAttribute('aria-pressed', 'false');
  if (!activeDrawingId) {
    drawingModeHint.hidden = true;
    chartStage.classList.remove('drawing-active');
  }
}

function openMarkerEditor(time: number, marker?: ChartMarker) {
  cancelMarkerPlacement();
  editingMarkerId = marker?.id ?? null;
  pendingMarkerTime = time;
  markerEditorTitle.textContent = marker ? '编辑标记' : '添加标记';
  markerEditorTime.textContent = formatChartTime(time as UTCTimestamp);
  markerText.value = marker?.text ?? '';
  markerShape.value = marker?.shape ?? 'arrowUp';
  markerPosition.value = marker?.position ?? 'belowBar';
  markerColor.value = marker?.color ?? '#2962ff';
  refreshTfColorPicker(markerColor);
  markerSize.value = String(marker?.size ?? 1);
  deleteMarkerButton.hidden = !marker;
  markerMessage.hidden = true;
  markerEditor.hidden = false;
  requestAnimationFrame(() => markerText.focus());
}

function commitMarkerEditor() {
  if (pendingMarkerTime === null || !currentBars.some((bar) => bar.time === pendingMarkerTime)) {
    markerMessage.textContent = '标记必须对应当前周期的一根 K 线';
    markerMessage.hidden = false;
    return;
  }
  const marker: ChartMarker = {
    id: editingMarkerId ?? crypto.randomUUID(),
    time: pendingMarkerTime,
    position: markerPosition.value as MarkerPosition,
    shape: markerShape.value as MarkerShape,
    color: markerColor.value,
    text: markerText.value.trim(),
    size: Number(markerSize.value),
    visible: true,
  };
  const markers = currentMarkers().filter((item) => item.id !== marker.id);
  persistMarkers([...markers, marker].sort((left, right) => left.time - right.time));
  closeMarkerEditor();
}

function deleteEditingMarker() {
  if (!editingMarkerId) return;
  persistMarkers(currentMarkers().filter((marker) => marker.id !== editingMarkerId));
  closeMarkerEditor();
}

function isManagedSeriesActive(series: ManagedSeries) {
  return series === 'volume' ? volumeVisible : activeIndicators.has(series);
}

function isManagedSeriesVisible(series: ManagedSeries) {
  return isManagedSeriesActive(series) && !hiddenSeries.has(series);
}

function applyMainSeriesOrder() {
  const groups: Record<MainOverlaySeries, ISeriesApi<any, Time>[]> = {
    volume: [volumeSeries],
    ma: indicatorChartHost.series('ma'),
    ema: indicatorChartHost.series('ema'),
    boll: indicatorChartHost.series('boll'),
  };
  let order = 6;
  for (const series of mainSeriesOrder) {
    for (const api of groups[series]) api.setSeriesOrder(order++);
  }
}

function applyManagedSeriesVisibility(series: ManagedSeries) {
  const visible = isManagedSeriesVisible(series);
  if (series === 'volume') {
    const marketVisible = visible && currentSeriesKind === 'ohlcv';
    volumeSeries.applyOptions({ visible: marketVisible });
    document.querySelector<HTMLDivElement>('#volume-legend')!.hidden = !marketVisible || !chartSettings.volumeLegendVisible;
  }
  if (series !== 'volume' && activeIndicators.has(series)) indicatorRuntime.setVisible(series, visible);
}

function localizedIndicatorText(value: string | { readonly 'zh-CN': string; readonly 'en-US': string }): string {
  return typeof value === 'string' ? value : value[appLocale];
}

type IndicatorInstanceView = Readonly<{
  runtimeKind: 'trusted' | 'user';
  instanceId: string;
  indicatorId: string;
  indicatorVersion: number;
  sourceHash?: string;
  visible: boolean;
  running: boolean;
  failed: boolean;
  failurePhase?: string;
  failureCode?: string;
  inputs: Readonly<Record<string, unknown>>;
}>;

function allIndicatorInstances(): IndicatorInstanceView[] {
  return [
    ...indicatorRuntime.list().map((instance) => ({
      runtimeKind: 'trusted' as const,
      ...instance,
      indicatorVersion: indicatorRegistry.get(instance.indicatorId)?.indicatorVersion ?? 1,
    })),
    ...userIndicatorRuntime.list().map((instance) => ({
      runtimeKind: 'user' as const,
      ...instance,
      ...(userIndicatorRuntimeFailures.get(instance.instanceId)
        ? { failurePhase: userIndicatorRuntimeFailures.get(instance.instanceId)!.phase,
            failureCode: userIndicatorRuntimeFailures.get(instance.instanceId)!.code,
            failureDetail: userIndicatorRuntimeFailures.get(instance.instanceId)!.failureDetail }
        : {}),
    })),
  ];
}

function indicatorDefinitionView(indicatorId: string) {
  const trusted = indicatorRegistry.get(indicatorId);
  if (trusted) return {
    runtimeKind: 'trusted' as const,
    id: trusted.id,
    indicatorVersion: trusted.indicatorVersion,
    name: trusted.name,
    description: trusted.description,
    author: trusted.author,
    inputs: trusted.inputs,
  };
  const user = userIndicatorRecords.get(indicatorId);
  if (!user) return null;
  return {
    runtimeKind: 'user' as const,
    id: user.id,
    indicatorVersion: user.indicatorVersion,
    name: user.manifest.name,
    description: user.manifest.description,
    author: user.manifest.author,
    inputs: user.manifest.inputs,
  };
}

function defaultIndicatorInstanceId(indicatorId: string): string {
  return indicatorId.startsWith('builtin.') ? indicatorId.slice('builtin.'.length) : `${indicatorId}:1`;
}

function nextIndicatorInstanceId(indicatorId: string): string {
  const running = new Set(allIndicatorInstances().map((instance) => instance.instanceId));
  const preferred = defaultIndicatorInstanceId(indicatorId);
  if (!running.has(preferred)) return preferred;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${indicatorId}:${suffix}`;
    if (!running.has(candidate)) return candidate;
  }
}

function orderedIndicatorInstances() {
  const instances = allIndicatorInstances();
  const byId = new Map(instances.map((instance) => [instance.instanceId, instance]));
  const ordered = indicatorInstanceOrder.flatMap((instanceId) => {
    const instance = byId.get(instanceId);
    if (!instance) return [];
    byId.delete(instanceId);
    return [instance];
  });
  ordered.push(...byId.values());
  indicatorInstanceOrder = ordered.map((instance) => instance.instanceId);
  return ordered;
}

let indicatorLegendLayoutFrame: number | undefined;

function indicatorLegendParameters(
  indicatorId: string,
  inputs: Readonly<Record<string, unknown>>,
): string {
  const definition = indicatorDefinitionView(indicatorId);
  if (!definition) return '';
  return Object.entries(definition.inputs).flatMap(([field, input]) => {
    if (input.type === 'color') return [];
    const value = inputs[field];
    if (value === undefined) return [];
    if (input.type === 'boolean') return [value ? '开' : '关'];
    return [String(value)];
  }).join(' ');
}

function scheduleIndicatorLegendLayout() {
  if (indicatorLegendLayoutFrame !== undefined) return;
  indicatorLegendLayoutFrame = requestAnimationFrame(layoutIndicatorLegends);
}

function layoutIndicatorLegends() {
  indicatorLegendLayoutFrame = undefined;
  const panes = chart.panes();
  const paneHeights = panes.map((pane) => pane.getHeight());
  const contentHeight = document.querySelector<HTMLDivElement>('#chart')!.clientHeight;
  const totalGap = Math.max(0, contentHeight - paneHeights.reduce((sum, height) => sum + height, 0));
  const gap = panes.length > 1 ? totalGap / (panes.length - 1) : 0;
  let top = 0;
  const paneTops = paneHeights.map((height, paneIndex) => {
    const paneTop = top;
    top += height + (paneIndex < paneHeights.length - 1 ? gap : 0);
    return paneTop;
  });
  for (const group of indicatorLegendLayer.querySelectorAll<HTMLElement>('[data-indicator-legend-pane]')) {
    const paneIndex = Number(group.dataset.indicatorLegendPane);
    if (!Number.isInteger(paneIndex) || paneIndex < 0 || paneIndex >= paneTops.length) {
      group.hidden = true;
      continue;
    }
    group.hidden = false;
    group.style.top = `${Math.round(paneTops[paneIndex] + (paneIndex === 0 ? 34 : 6))}px`;
    group.style.maxHeight = `${Math.max(0, Math.floor(paneHeights[paneIndex] - (paneIndex === 0 ? 40 : 12)))}px`;
  }
}

function renderIndicatorLegends() {
  const instances = orderedIndicatorInstances().filter((instance) => instance.running || instance.failed);
  const totals = new Map<string, number>();
  for (const instance of instances) totals.set(instance.indicatorId, (totals.get(instance.indicatorId) ?? 0) + 1);
  const seen = new Map<string, number>();
  const groups = new Map<number, HTMLDivElement>();

  for (const instance of instances) {
    const definition = indicatorDefinitionView(instance.indicatorId);
    if (!definition) continue;
    const count = (seen.get(instance.indicatorId) ?? 0) + 1;
    seen.set(instance.indicatorId, count);
    const suffix = (totals.get(instance.indicatorId) ?? 0) > 1 ? ` #${count}` : '';
    const parameters = indicatorLegendParameters(instance.indicatorId, instance.inputs);
    const targets = indicatorChartHost.visualPaneTargets(instance.instanceId);
    const paneTargets = targets.length > 0 ? targets : [{ key: 'main', paneIndex: 0 }];

    for (const target of paneTargets) {
      let group = groups.get(target.paneIndex);
      if (!group) {
        group = document.createElement('div');
        group.className = 'indicator-legend-pane';
        group.dataset.indicatorLegendPane = String(target.paneIndex);
        groups.set(target.paneIndex, group);
      }
      const row = document.createElement('div');
      row.className = `indicator-legend-row${instance.visible ? '' : ' is-hidden'}${instance.failed ? ' is-failed' : ''}`;
      row.dataset.indicatorLegendInstance = instance.instanceId;
      row.dataset.indicatorLegendPaneKey = target.key;

      const label = document.createElement('span');
      label.className = 'indicator-legend-label';
      label.textContent = `${localizedIndicatorText(definition.name)}${suffix}${parameters ? ` ${parameters}` : ''}${instance.failed ? ' · 运行失败' : ''}`;

      const actions = document.createElement('span');
      actions.className = 'indicator-legend-actions';
      const visibility = document.createElement('button');
      visibility.type = 'button';
      visibility.innerHTML = icons.eye;
      visibility.setAttribute('data-indicator-legend-action', 'visibility');
      visibility.title = instance.visible ? '隐藏指标' : '显示指标';
      visibility.setAttribute('aria-label', visibility.title);
      visibility.setAttribute('aria-pressed', String(instance.visible));
      visibility.classList.toggle('active', instance.visible);
      visibility.addEventListener('click', () => setIndicatorInstanceVisible(instance.instanceId, !instance.visible));

      const settings = document.createElement('button');
      settings.type = 'button';
      settings.innerHTML = instance.failed ? icons.refresh : settingsHexIcon;
      settings.setAttribute('data-indicator-legend-action', instance.failed ? 'retry' : 'settings');
      settings.title = instance.failed ? '重试指标' : '设置指标';
      settings.setAttribute('aria-label', settings.title);
      settings.addEventListener('click', () => {
        if (instance.failed) {
          if (instance.runtimeKind === 'user') userIndicatorRuntimeFailures.delete(instance.instanceId);
          if (instance.runtimeKind === 'user') userIndicatorRuntime.retry(instance.instanceId);
          else indicatorRuntime.retry(instance.instanceId);
          persistChartPreferences();
          renderIndicatorLegends();
          if (!drawingManager.hidden) renderDrawingManager();
        } else {
          openIndicatorConfig(instance.indicatorId, instance.instanceId);
        }
      });

      if (instance.failed && instance.runtimeKind === 'user') {
        const copyAi = document.createElement('button');
        copyAi.type = 'button';
        copyAi.textContent = 'AI';
        copyAi.setAttribute('data-indicator-legend-action', 'copy-ai-diagnostic');
        copyAi.title = '复制给 AI 修复';
        copyAi.setAttribute('aria-label', copyAi.title);
        copyAi.addEventListener('click', () => {
          const failure = userIndicatorRuntimeFailures.get(instance.instanceId);
          if (!failure) {
            showChartToast('当前没有可复制的运行错误');
            return;
          }
          void copyTextToClipboard(formatUserIndicatorAiDiagnostic({
            ...failure,
            indicatorId: instance.indicatorId,
            indicatorVersion: instance.indicatorVersion,
          }), 'AI 修复信息已复制');
        });
        actions.append(copyAi);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.innerHTML = icons.trash;
      remove.setAttribute('data-indicator-legend-action', 'remove');
      remove.title = '移除指标';
      remove.setAttribute('aria-label', remove.title);
      remove.className = 'danger';
      remove.addEventListener('click', () => removeIndicatorInstance(instance.instanceId));
      actions.append(visibility, settings, remove);
      row.append(label, actions);
      group.append(row);
    }
  }

  indicatorLegendLayer.replaceChildren(...[...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, group]) => group));
  scheduleIndicatorLegendLayout();
}

function applyIndicatorInstanceOrder(reorderPanes = true) {
  let seriesOrder = 7;
  const instances = orderedIndicatorInstances();
  for (const instance of instances) {
    for (const series of indicatorChartHost.series(instance.instanceId)) series.setSeriesOrder(seriesOrder++);
  }
  if (reorderPanes) indicatorChartHost.applyInstancePaneOrder(instances.map((instance) => instance.instanceId));
  indicatorChartHost.requestOverlayLayout();
  scheduleIndicatorLegendLayout();
}

function moveIndicatorInstance(instanceId: string, direction: -1 | 1) {
  if (aiIndicatorLibraryBusy) { showChartToast('正在更新指标，请稍后'); return; }
  orderedIndicatorInstances();
  const index = indicatorInstanceOrder.indexOf(instanceId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= indicatorInstanceOrder.length) return;
  indicatorInstanceOrder = [...indicatorInstanceOrder];
  [indicatorInstanceOrder[index], indicatorInstanceOrder[target]] = [indicatorInstanceOrder[target], indicatorInstanceOrder[index]];
  applyIndicatorInstanceOrder();
  renderIndicatorLegends();
  persistChartPreferences();
  renderDrawingManager();
}

function renderIndicatorPicker(query = indicatorPickerSearch.value) {
  const configuredCounts = new Map<string, number>();
  for (const instance of allIndicatorInstances()) {
    configuredCounts.set(instance.indicatorId, (configuredCounts.get(instance.indicatorId) ?? 0) + 1);
  }
  const normalizedQuery = query.trim().toLocaleLowerCase(appLocale);
  const definitions = [
    ...indicatorRegistry.list().map((definition) => ({
      runtimeKind: 'trusted' as const,
      id: definition.id,
      name: definition.name,
      description: definition.description,
      author: definition.author,
    })),
    ...[...userIndicatorRecords.values()].map((record) => ({
      runtimeKind: 'user' as const,
      id: record.id,
      name: record.manifest.name,
      description: record.manifest.description,
      author: record.manifest.author,
    })),
  ].filter((definition) => {
    if (!normalizedQuery) return true;
    return [
      localizedIndicatorText(definition.name),
      definition.description ? localizedIndicatorText(definition.description) : '',
      definition.author ?? '',
      definition.id,
    ].some((value) => value.toLocaleLowerCase(appLocale).includes(normalizedQuery));
  });
  const buttons: HTMLElement[] = [];
  if (!normalizedQuery || ['成交量', 'volume', 'vol'].some((value) => value.includes(normalizedQuery))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.managedIndicator = 'volume';
    button.setAttribute('aria-pressed', String(volumeVisible));
    button.classList.toggle('active', volumeVisible);
    button.disabled = currentSeriesKind === 'probability';
    const copy = document.createElement('span');
    copy.className = 'indicator-picker-copy';
    const title = document.createElement('strong');
    title.textContent = ui('成交量');
    copy.append(title);
    const status = document.createElement('span');
    status.className = 'indicator-picker-status';
    status.textContent = volumeVisible ? ui('已添加') : ui('添加');
    button.append(copy, status);
    buttons.push(button);
  }
  buttons.push(...definitions.map((definition) => {
    const legacyId = definition.id.startsWith('builtin.') ? definition.id.slice('builtin.'.length) : null;
    const instanceId = defaultIndicatorInstanceId(definition.id);
    const configuredCount = configuredCounts.get(definition.id) ?? 0;
    const active = configuredCount > 0;
    const userRecord = definition.runtimeKind === 'user' ? userIndicatorRecords.get(definition.id) ?? null : null;
    const supported = definition.runtimeKind === 'user'
      ? Boolean(userRecord && userIndicatorRuntime.isLibraryRecordApplicable(userRecord))
      : indicatorRuntime.isApplicable(definition.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.indicatorId = definition.id;
    button.dataset.instanceId = instanceId;
    if (legacyId) button.dataset.indicator = legacyId;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('active', active);
    button.disabled = currentSeriesKind === 'probability' || !supported;
    const copy = document.createElement('span');
    copy.className = 'indicator-picker-copy';
    const title = document.createElement('strong');
    title.textContent = localizedIndicatorText(definition.name);
    copy.append(title);
    const status = document.createElement('span');
    status.className = 'indicator-picker-status';
    status.textContent = !supported
      ? (active ? ui('已保存，当前品种不适用') : ui('当前品种不适用'))
      : active ? `${ui('已添加')} ${configuredCount}` : ui('添加');
    button.append(copy, status);
    if (definition.runtimeKind !== 'user') return button;
    const row = document.createElement('div');
    row.className = 'indicator-picker-user-row';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'indicator-picker-user-delete danger';
    remove.dataset.deleteUserIndicator = definition.id;
    remove.title = '删除已导入指标';
    remove.setAttribute('aria-label', `删除 ${localizedIndicatorText(definition.name)}`);
    remove.innerHTML = icons.trash;
    row.append(button, remove);
    return row;
  }));
  indicatorPickerEmpty.hidden = buttons.length > 0;
  indicatorPickerList.replaceChildren(...buttons);
}

function openIndicatorPicker() {
  closeToolbarMenus();
  indicatorPickerReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : openIndicatorPickerButton;
  indicatorPickerSearch.value = '';
  renderIndicatorPicker('');
  indicatorPickerLayer.hidden = false;
  requestAnimationFrame(() => indicatorPickerSearch.focus());
}

function closeIndicatorPicker() {
  indicatorPickerLayer.hidden = true;
  indicatorPickerReturnFocus?.focus();
  indicatorPickerReturnFocus = null;
}

function userIndicatorImportErrorText(error: unknown): string {
  if (error instanceof CapabilityError) return ({ busy: '正在更新指标，请稍后重试', storage_failed: '指标未能保存，请检查本地存储后重试',
    indicator_failed: '新指标启动失败，已有版本已尝试恢复；请复制诊断给 AI 修复', context_stale: '图表已变化，请在当前图表重新添加',
    cancelled: '操作已取消', rollback_failed: '恢复未能完成，请保留当前窗口并检查指标库', data_not_ready: '请等待图表加载后重试',
    state_conflict: '指标已经被其他操作修改，请重新导入', field_unavailable: '这个指标不适用于当前图表' } as Record<string, string>)[error.code] ?? error.message;
  if (error instanceof UserIndicatorLibraryError) return `${error.code}：${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function closeUserIndicatorImportPreview() {
  userIndicatorImportAbort?.abort();
  userIndicatorImportLayer.hidden = true;
  userIndicatorImportError.hidden = true;
  userIndicatorImportError.textContent = '';
  userIndicatorImportPreview.replaceChildren();
  pendingUserIndicatorImport = null;
  pendingUserIndicatorDeleteId = null;
  pendingUserIndicatorDiagnostic = null;
  copyUserIndicatorAiDiagnosticButton.hidden = true;
  confirmUserIndicatorImportButton.disabled = false;
  confirmUserIndicatorImportButton.hidden = false;
  indicatorPickerLayer.hidden = false;
  renderIndicatorPicker();
}

async function copyTextToClipboard(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    showChartToast(successMessage);
  } catch (error) {
    console.error('clipboard.write_failed', error);
    showChartToast('复制失败');
  }
}

function openUserIndicatorImportFailure(error: unknown) {
  confirmUserIndicatorAddButton.hidden = true;
  pendingUserIndicatorImport = null;
  pendingUserIndicatorDeleteId = null;
  userIndicatorImportPreview.replaceChildren();
  const title = document.createElement('p');
  title.className = 'user-indicator-import-warning';
  title.textContent = `导入失败：${userIndicatorImportErrorText(error)}`;
  userIndicatorImportPreview.append(title);
  pendingUserIndicatorDiagnostic = error instanceof UserIndicatorLibraryError
    ? Object.freeze({
        phase: 'validation',
        code: error.code,
        ...(error.line === undefined ? {} : { line: error.line }),
        ...(error.column === undefined ? {} : { column: error.column }),
      })
    : Object.freeze({
        phase: 'validation',
        code: 'runtime_exception',
      });
  copyUserIndicatorAiDiagnosticButton.hidden = false;
  confirmUserIndicatorImportButton.hidden = true;
  userIndicatorImportError.hidden = true;
  indicatorPickerLayer.hidden = true;
  userIndicatorImportLayer.hidden = false;
  requestAnimationFrame(() => copyUserIndicatorAiDiagnosticButton.focus());
}

function appendUserIndicatorPreviewRow(labelText: string, valueText: string) {
  const row = document.createElement('div');
  row.className = 'user-indicator-import-row';
  const label = document.createElement('span');
  label.textContent = labelText;
  const value = document.createElement('strong');
  value.textContent = valueText;
  row.append(label, value);
  userIndicatorImportPreview.append(row);
}

function openUserIndicatorImportPreview(prepared: PreparedUserIndicatorImport) {
  confirmUserIndicatorAddButton.hidden = prepared.disposition === 'replace';
  confirmUserIndicatorAddButton.disabled = currentSeriesKind !== 'ohlcv' || aiDisplayedHistoryGeneration !== historyRequestGate.current();
  confirmUserIndicatorAddButton.textContent = prepared.disposition === 'unchanged' ? '添加到图表' : '导入并添加';
  pendingUserIndicatorImport = prepared;
  pendingUserIndicatorDeleteId = null;
  pendingUserIndicatorDiagnostic = null;
  copyUserIndicatorAiDiagnosticButton.hidden = true;
  confirmUserIndicatorImportButton.hidden = false;
  userIndicatorImportPreview.replaceChildren();
  appendUserIndicatorPreviewRow('名称', localizedIndicatorText(prepared.manifest.name));
  appendUserIndicatorPreviewRow('ID', prepared.manifest.id);
  appendUserIndicatorPreviewRow('版本', String(prepared.manifest.indicatorVersion));
  appendUserIndicatorPreviewRow('文件', prepared.fileName);
  const notice = document.createElement('p');
  notice.className = prepared.disposition === 'replace' ? 'user-indicator-import-warning' : 'user-indicator-import-note';
  notice.textContent = prepared.disposition === 'replace'
    ? `确认后更新这个指标${prepared.downgrade ? '（这是版本降级）' : ''}，保留兼容参数和图层布局；新版本启动失败会恢复旧版本。`
    : '可以直接添加到图表，也可以仅保存到指标库，稍后再使用。';
  userIndicatorImportPreview.append(notice);
  confirmUserIndicatorImportButton.textContent = prepared.disposition === 'replace' ? '确认替换' : '仅保存';
  confirmUserIndicatorImportButton.classList.toggle('primary', prepared.disposition === 'replace');
  userIndicatorImportError.hidden = true;
  indicatorPickerLayer.hidden = true;
  userIndicatorImportLayer.hidden = false;
  requestAnimationFrame(() => confirmUserIndicatorImportButton.focus());
}

function savedUserIndicatorInstance(
  instance: IndicatorInstanceView,
  menuOrder: number,
): SavedUserIndicatorState {
  if (instance.runtimeKind !== 'user' || !instance.sourceHash) {
    throw new Error('expected a user indicator instance with sourceHash');
  }
  return {
    instanceId: instance.instanceId,
    indicatorId: instance.indicatorId,
    indicatorVersion: instance.indicatorVersion,
    runtimeKind: 'user',
    sourceHash: instance.sourceHash,
    visible: instance.visible,
    menuOrder,
    panes: indicatorChartHost.paneStates(instance.instanceId),
    inputs: instance.inputs,
  };
}

function captureUserIndicatorInstances(indicatorId: string, sourceHash?: string): SavedUserIndicatorState[] {
  const ordered = orderedIndicatorInstances();
  return ordered.flatMap((instance, menuOrder) => {
    if (instance.runtimeKind !== 'user'
      || instance.indicatorId !== indicatorId
      || (sourceHash !== undefined && instance.sourceHash !== sourceHash)) return [];
    return [savedUserIndicatorInstance(instance, menuOrder)];
  });
}

function preserveAndStopUserIndicatorInstances(
  indicatorId: string,
  sourceHash: string | undefined,
  preserved = captureUserIndicatorInstances(indicatorId, sourceHash),
) {
  if (preserved.length === 0) return;
  const preservedIds = new Set(preserved.map((entry) => entry.instanceId));
  loadedIndicatorState = {
    ...loadedIndicatorState,
    unresolvedEntries: [
      ...loadedIndicatorState.unresolvedEntries.filter((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
        const instanceId = (entry as { instanceId?: unknown }).instanceId;
        return typeof instanceId !== 'string' || !preservedIds.has(instanceId);
      }),
      ...preserved,
    ],
  };
  for (const entry of preserved) {
    userIndicatorRuntime.remove(entry.instanceId);
    userIndicatorRuntimeFailures.delete(entry.instanceId);
  }
  indicatorInstanceOrder = indicatorInstanceOrder.filter((instanceId) => !preservedIds.has(instanceId));
}

function openUserIndicatorDeletePreview(indicatorId: string) {
  confirmUserIndicatorAddButton.hidden = true;
  const record = userIndicatorRecords.get(indicatorId);
  if (!record) return;
  pendingUserIndicatorImport = null;
  pendingUserIndicatorDeleteId = indicatorId;
  pendingUserIndicatorDiagnostic = null;
  copyUserIndicatorAiDiagnosticButton.hidden = true;
  confirmUserIndicatorImportButton.hidden = false;
  userIndicatorImportPreview.replaceChildren();
  appendUserIndicatorPreviewRow('名称', localizedIndicatorText(record.manifest.name));
  appendUserIndicatorPreviewRow('ID', record.id);
  appendUserIndicatorPreviewRow('版本', String(record.indicatorVersion));
  const notice = document.createElement('p');
  notice.className = 'user-indicator-import-warning';
  notice.textContent = '删除只移除本地指标源码。当前使用该源码的图表实例会停止，但参数、Pane 布局和源码哈希会保留为未解析状态。';
  userIndicatorImportPreview.append(notice);
  confirmUserIndicatorImportButton.textContent = '确认删除';
  userIndicatorImportError.hidden = true;
  indicatorPickerLayer.hidden = true;
  userIndicatorImportLayer.hidden = false;
  requestAnimationFrame(() => confirmUserIndicatorImportButton.focus());
}

async function prepareUserIndicatorFile(file: File) {
  if (!userIndicatorLibrary) throw new Error('用户指标库尚未初始化');
  if (aiIndicatorLibraryBusy) throw new CapabilityError('busy');
  const bytes = await readUserIndicatorFile(file);
  const prepared = await userIndicatorLibrary.prepareImport(file.name, bytes);
  if (aiIndicatorLibraryBusy) throw new CapabilityError('busy');
  openUserIndicatorImportPreview(prepared);
}

async function confirmUserIndicatorLibraryChange(addToChart = false) {
  if (!userIndicatorLibrary) return;
  if (aiIndicatorLibraryBusy || userIndicatorImportAbort) { showChartToast('正在更新指标，请稍后'); return; }
  const abort = new AbortController(); userIndicatorImportAbort = abort;
  const selection = readCurrentAiChartSelection();
  let libraryCompleted = false;
  let transaction: AsyncToolTransaction | undefined;
  confirmUserIndicatorImportButton.disabled = true;
  confirmUserIndicatorAddButton.disabled = true;
  userIndicatorImportError.hidden = true;
  try {
    const deleting = pendingUserIndicatorDeleteId !== null;
    const prepared = deleting ? null : pendingUserIndicatorImport;
    const indicatorId = pendingUserIndicatorDeleteId ?? prepared?.manifest.id;
    if (!indicatorId) return;
    transaction = await prepareAiLibraryChange(prepared, indicatorId, true, {
      context: { scope: 'app', appInstanceId: aiChartAppInstanceId }, signal: abort.signal,
      session: { signal: abort.signal },
      checkpoint() { if (abort.signal.aborted) throw new CapabilityError('cancelled'); },
    });
    await transaction.commit();
    libraryCompleted = true; transaction.dispose?.(); transaction = undefined;
    if (addToChart && prepared) {
      const execution: ToolExecutionContext = { context: selection, signal: abort.signal, session: { signal: abort.signal },
        checkpoint() {
          if (abort.signal.aborted) throw new CapabilityError('cancelled');
          if (!sameSelection(selection, readCurrentAiChartSelection())) throw new CapabilityError('context_stale');
        } };
      const addition = prepareAiIndicatorChange({ op: 'add', indicatorId }, execution);
      try { addition.commit(); } catch (error) { addition.rollback(); throw error; } finally { addition.dispose?.(); }
    }
    closeUserIndicatorImportPreview();
    if (addToChart && prepared) closeIndicatorPicker();
    showChartToast(deleting ? '用户指标已删除' : prepared?.disposition === 'replace' ? '用户指标已替换' : addToChart ? '用户指标已导入并添加' : '用户指标已导入');
  } catch (error) {
    try { await transaction?.rollback(); } catch { error = new CapabilityError('rollback_failed'); }
    userIndicatorImportError.textContent = (libraryCompleted ? '指标已保存，但没有添加到图表：' : '') + userIndicatorImportErrorText(error);
    userIndicatorImportError.hidden = false;
    const prepared = pendingUserIndicatorImport;
    pendingUserIndicatorDiagnostic = error instanceof UserIndicatorLibraryError
      ? Object.freeze({
          indicatorId: prepared?.manifest.id,
          indicatorVersion: prepared?.manifest.indicatorVersion,
          phase: 'install',
          code: error.code,
          ...(error.line === undefined ? {} : { line: error.line }),
          ...(error.column === undefined ? {} : { column: error.column }),
        })
      : Object.freeze({
          indicatorId: prepared?.manifest.id,
          indicatorVersion: prepared?.manifest.indicatorVersion,
          phase: 'install',
          code: 'runtime_exception',
        });
    copyUserIndicatorAiDiagnosticButton.hidden = false;
  } finally {
    transaction?.dispose?.();
    if (userIndicatorImportAbort === abort) userIndicatorImportAbort = null;
    confirmUserIndicatorImportButton.disabled = false;
    confirmUserIndicatorAddButton.disabled = false;
  }
}

function openIndicatorConfig(indicatorId: string, instanceId: string | null = null) {
  const definition = indicatorDefinitionView(indicatorId);
  if (!definition) return;
  const instance = instanceId
    ? allIndicatorInstances().find((item) => item.instanceId === instanceId)
    : null;
  indicatorConfigReturnsToPicker = !indicatorPickerLayer.hidden;
  indicatorConfigReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : openIndicatorPickerButton;
  editingIndicatorId = indicatorId;
  editingIndicatorInstanceId = instanceId;
  indicatorConfigTitle.textContent = `${instanceId ? '编辑' : '添加'} ${localizedIndicatorText(definition.name)}`;
  indicatorConfigError.hidden = true;
  indicatorConfigError.textContent = '';
  indicatorConfigFields.replaceChildren();
  const form = renderIndicatorInputForm(
    indicatorConfigFields,
    definition.inputs,
    instance?.inputs ?? {},
    appLocale,
  );
  if (Object.keys(definition.inputs).length === 0) {
    const empty = document.createElement('p');
    empty.className = 'indicator-config-empty';
    empty.textContent = '这个指标没有可配置参数';
    form.append(empty);
  }
  indicatorPickerLayer.hidden = true;
  indicatorConfigLayer.hidden = false;
  requestAnimationFrame(() => {
    const firstField = form.querySelector<HTMLElement>('input, select');
    (firstField ?? document.querySelector<HTMLButtonElement>('#confirm-indicator-config')!).focus();
  });
}

function closeIndicatorConfig(returnToPicker = indicatorConfigReturnsToPicker) {
  indicatorConfigLayer.hidden = true;
  editingIndicatorId = null;
  editingIndicatorInstanceId = null;
  indicatorConfigError.hidden = true;
  if (returnToPicker) {
    indicatorPickerLayer.hidden = false;
    renderIndicatorPicker();
  }
  indicatorConfigReturnFocus?.focus();
  indicatorConfigReturnFocus = null;
  indicatorConfigReturnsToPicker = false;
}

function confirmIndicatorConfig() {
  if (aiIndicatorLibraryBusy) { showChartToast('正在更新指标，请稍后'); return; }
  if (!editingIndicatorId) return;
  const definition = indicatorDefinitionView(editingIndicatorId);
  if (!definition) return;
  try {
    const inputs = readIndicatorInputForm(indicatorConfigFields, definition.inputs);
    if (definition.runtimeKind === 'user') {
      const library = userIndicatorRecords.get(editingIndicatorId);
      if (!library) throw new Error('用户指标源码不存在或尚未加载');
      if (editingIndicatorInstanceId) {
        userIndicatorRuntime.updateInputs(editingIndicatorInstanceId, inputs);
      } else {
        const instanceId = nextIndicatorInstanceId(editingIndicatorId);
        userIndicatorRuntime.add({
          instanceId,
          indicatorId: editingIndicatorId,
          sourceHash: library.sourceHash,
          indicatorVersion: library.indicatorVersion,
          inputs,
          visible: true,
        }, library);
        indicatorInstanceOrder.push(instanceId);
      }
    } else if (editingIndicatorInstanceId) {
      indicatorRuntime.updateInputs(editingIndicatorInstanceId, inputs);
    } else {
      const instanceId = nextIndicatorInstanceId(editingIndicatorId);
      indicatorRuntime.add({ instanceId, indicatorId: editingIndicatorId, inputs, visible: true });
      indicatorInstanceOrder.push(instanceId);
      if (editingIndicatorId.startsWith('builtin.') && instanceId === defaultIndicatorInstanceId(editingIndicatorId)) {
        activeIndicators.add(editingIndicatorId.slice('builtin.'.length) as IndicatorName);
      }
    }
    applySecondaryPaneOrder();
    applyMainSeriesOrder();
    applyIndicatorInstanceOrder();
    renderIndicatorLegends();
    persistChartPreferences();
    renderIndicatorPicker();
    if (!drawingManager.hidden) renderDrawingManager();
    closeIndicatorConfig(false);
  } catch (error) {
    indicatorConfigError.textContent = error instanceof IndicatorInputFormValidationError
      ? error.message
      : `指标参数保存失败：${error instanceof Error ? error.message : String(error)}`;
    indicatorConfigError.hidden = false;
  }
}

function setRegisteredIndicatorActive(
  indicatorId: string,
  instanceId: string,
  active: boolean,
  persist = true,
) {
  if (aiIndicatorLibraryBusy && persist) { showChartToast('正在更新指标，请稍后'); return; }
  const legacyId = indicatorId.startsWith('builtin.')
    ? indicatorId.slice('builtin.'.length) as IndicatorName
    : null;
  if (active) {
    if (!indicatorRuntime.list().some((item) => item.instanceId === instanceId)) {
      indicatorRuntime.add({ instanceId, indicatorId, visible: true });
      indicatorInstanceOrder.push(instanceId);
    }
    if (legacyId) {
      activeIndicators.add(legacyId);
      if (persist) hiddenSeries.delete(legacyId);
      applyManagedSeriesVisibility(legacyId);
    }
  } else {
    indicatorRuntime.remove(instanceId);
    indicatorInstanceOrder = indicatorInstanceOrder.filter((item) => item !== instanceId);
    if (legacyId) {
      activeIndicators.delete(legacyId);
      hiddenSeries.delete(legacyId);
    }
  }
  renderIndicatorPicker();
  applySecondaryPaneOrder();
  applyMainSeriesOrder();
  applyIndicatorInstanceOrder();
  renderIndicatorLegends();
  if (persist) persistChartPreferences();
  if (!drawingManager.hidden) renderDrawingManager();
}

function setIndicatorActive(indicator: IndicatorName, active: boolean, persist = true) {
  setRegisteredIndicatorActive(`builtin.${indicator}`, indicator, active, persist);
}

function setVolumeActive(active: boolean, persist = true) {
  volumeVisible = active;
  if (active && persist) hiddenSeries.delete('volume');
  if (!active) hiddenSeries.delete('volume');
  applyManagedSeriesVisibility('volume');
  applyMainSeriesOrder();
  renderIndicatorPicker();
  if (persist) persistChartPreferences();
  if (!drawingManager.hidden) renderDrawingManager();
}

function moveActiveMainSeries(series: MainOverlaySeries, direction: -1 | 1) {
  const active = mainSeriesOrder.filter((item) => isManagedSeriesActive(item));
  const activeIndex = active.indexOf(series);
  const target = active[activeIndex + direction];
  if (!target) return;
  const seriesIndex = mainSeriesOrder.indexOf(series);
  const targetIndex = mainSeriesOrder.indexOf(target);
  mainSeriesOrder = [...mainSeriesOrder];
  [mainSeriesOrder[seriesIndex], mainSeriesOrder[targetIndex]] = [mainSeriesOrder[targetIndex], mainSeriesOrder[seriesIndex]];
  applyMainSeriesOrder();
  persistChartPreferences();
  renderDrawingManager();
}

function setIndicatorInstanceVisible(instanceId: string, visible: boolean, persist = true) {
  if (persist && aiIndicatorLibraryBusy) { showChartToast('正在更新指标，请稍后'); return; }
  const instance = allIndicatorInstances().find((item) => item.instanceId === instanceId);
  if (!instance) return;
  if (instance.runtimeKind === 'user') userIndicatorRuntime.setVisible(instanceId, visible);
  else indicatorRuntime.setVisible(instanceId, visible);
  if (instance.runtimeKind === 'trusted'
    && instance.indicatorId.startsWith('builtin.')
    && instanceId === defaultIndicatorInstanceId(instance.indicatorId)) {
    const legacyId = instance.indicatorId.slice('builtin.'.length) as IndicatorName;
    if (visible) hiddenSeries.delete(legacyId);
    else hiddenSeries.add(legacyId);
  }
  if (persist) persistChartPreferences();
  renderIndicatorPicker();
  renderIndicatorLegends();
  renderDrawingManager();
}

function removeIndicatorInstance(instanceId: string, persist = true) {
  if (persist && aiIndicatorLibraryBusy) { showChartToast('正在更新指标，请稍后'); return; }
  const instance = allIndicatorInstances().find((item) => item.instanceId === instanceId);
  if (!instance) return;
  if (instance.runtimeKind === 'user') {
    userIndicatorRuntime.remove(instanceId);
    userIndicatorRuntimeFailures.delete(instanceId);
  }
  else indicatorRuntime.remove(instanceId);
  indicatorInstanceOrder = indicatorInstanceOrder.filter((item) => item !== instanceId);
  if (instance.runtimeKind === 'trusted'
    && instance.indicatorId.startsWith('builtin.')
    && instanceId === defaultIndicatorInstanceId(instance.indicatorId)) {
    const legacyId = instance.indicatorId.slice('builtin.'.length) as IndicatorName;
    activeIndicators.delete(legacyId);
    hiddenSeries.delete(legacyId);
  }
  applyMainSeriesOrder();
  applyIndicatorInstanceOrder();
  if (persist) persistChartPreferences();
  renderIndicatorPicker();
  renderIndicatorLegends();
  renderDrawingManager();
}

function renderDrawingManager() {
  const drawings = currentDrawingExports();
  const markers = currentMarkers();
  const mainItems: MainOverlaySeries[] = volumeVisible ? ['volume'] : [];
  const indicatorInstances = orderedIndicatorInstances();
  const priceLines = currentPriceLineSettings();
  const previousClose = currentQuote?.previousClose ?? previousCloseFromBars(currentBars, currentResolution);
  const priceLineCount = (priceLines.previousClose && previousClose !== null ? 1 : 0)
    + (priceLines.cost !== null ? 1 : 0)
    + priceLines.custom.length;
  drawingManagerItems.replaceChildren();
  drawingManagerEmpty.hidden = true;

  const appendSection = (title: string) => {
    const heading = document.createElement('div');
    heading.className = 'drawing-manager-section';
    heading.textContent = title;
    drawingManagerItems.append(heading);
  };

  const visibilityButtonFor = (series: ManagedSeries) => {
    const visible = isManagedSeriesVisible(series);
    const button = document.createElement('button');
    button.innerHTML = icons.eye;
    button.className = visible ? 'active' : '';
    button.title = visible ? '隐藏序列' : '显示序列';
    button.setAttribute('aria-label', `${visible ? '隐藏' : '显示'}${series.toUpperCase()}`);
    button.addEventListener('click', () => {
      if (visible) hiddenSeries.add(series);
      else hiddenSeries.delete(series);
      applyManagedSeriesVisibility(series);
      persistChartPreferences();
      renderDrawingManager();
    });
    return button;
  };

  appendSection('主图');
  const primaryRow = document.createElement('div');
  primaryRow.className = 'drawing-manager-row managed-series-row';
  const primaryName = document.createElement('span');
  primaryName.textContent = `${chartTypeLabels[currentChartType]} · ${currentSymbol.code}`;
  const primaryVisibility = document.createElement('button');
  primaryVisibility.innerHTML = icons.eye;
  primaryVisibility.className = primarySeriesVisible ? 'active' : '';
  primaryVisibility.title = primarySeriesVisible ? '隐藏主图' : '显示主图';
  primaryVisibility.addEventListener('click', () => {
    primarySeriesVisible = !primarySeriesVisible;
    setPrimarySeriesData();
    renderSeriesMarkers();
    renderDrawingManager();
  });
  primaryRow.append(primaryName, primaryVisibility, document.createElement('i'), document.createElement('i'), document.createElement('i'));
  drawingManagerItems.append(primaryRow);

  if (mainItems.length > 0) {
    appendSection('主图指标');
    for (const [index, series] of mainItems.entries()) {
      const row = document.createElement('div');
      row.className = 'drawing-manager-row managed-series-row';
      const name = document.createElement('span');
      name.textContent = series === 'volume' ? '成交量' : series.toUpperCase();
      row.append(name, visibilityButtonFor(series));
      for (const [label, direction] of [['↑', -1], ['↓', 1]] as const) {
        const button = document.createElement('button');
        button.textContent = label;
        button.title = direction < 0 ? '上移序列' : '下移序列';
        button.disabled = direction < 0 ? index === 0 : index === mainItems.length - 1;
        button.addEventListener('click', () => moveActiveMainSeries(series, direction));
        row.append(button);
      }
      const removeButton = document.createElement('button');
      removeButton.innerHTML = icons.trash;
      removeButton.className = 'danger';
      removeButton.title = '移除序列';
      removeButton.addEventListener('click', () => {
        if (series === 'volume') setVolumeActive(false);
        else setIndicatorActive(series, false);
      });
      row.append(removeButton);
      drawingManagerItems.append(row);
    }
  }

  if (indicatorInstances.length > 0) {
    appendSection('指标');
    const totals = new Map<string, number>();
    for (const instance of indicatorInstances) totals.set(instance.indicatorId, (totals.get(instance.indicatorId) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const [index, instance] of indicatorInstances.entries()) {
      const row = document.createElement('div');
      row.className = 'drawing-manager-row indicator-instance-row';
      row.dataset.indicatorInstanceId = instance.instanceId;
      const name = document.createElement('span');
      const definition = indicatorDefinitionView(instance.indicatorId);
      const count = (seen.get(instance.indicatorId) ?? 0) + 1;
      seen.set(instance.indicatorId, count);
      name.textContent = `${definition ? localizedIndicatorText(definition.name) : instance.indicatorId}${(totals.get(instance.indicatorId) ?? 0) > 1 ? ` #${count}` : ''}${instance.failed ? ' · 运行失败' : ''}`;
      const visibility = document.createElement('button');
      visibility.innerHTML = icons.eye;
      visibility.className = instance.visible ? 'active' : '';
      visibility.title = instance.visible ? '隐藏指标' : '显示指标';
      visibility.dataset.indicatorInstanceAction = 'visibility';
      visibility.addEventListener('click', () => setIndicatorInstanceVisible(instance.instanceId, !instance.visible));
      const editButton = document.createElement('button');
      editButton.innerHTML = instance.failed ? icons.refresh : settingsHexIcon;
      editButton.title = instance.failed ? '重试指标' : '编辑参数';
      editButton.dataset.indicatorInstanceAction = instance.failed ? 'retry' : 'edit';
      editButton.addEventListener('click', () => {
        if (instance.failed) {
          if (instance.runtimeKind === 'user') userIndicatorRuntime.retry(instance.instanceId);
          else indicatorRuntime.retry(instance.instanceId);
          persistChartPreferences();
          renderDrawingManager();
        } else {
          openIndicatorConfig(instance.indicatorId, instance.instanceId);
        }
      });
      row.append(name, visibility, editButton);
      for (const [label, direction] of [['↑', -1], ['↓', 1]] as const) {
        const button = document.createElement('button');
        button.textContent = label;
        button.title = direction < 0 ? '上移指标' : '下移指标';
        button.dataset.indicatorInstanceAction = direction < 0 ? 'move-up' : 'move-down';
        button.disabled = direction < 0 ? index === 0 : index === indicatorInstances.length - 1;
        button.addEventListener('click', () => moveIndicatorInstance(instance.instanceId, direction));
        row.append(button);
      }
      const removeButton = document.createElement('button');
      removeButton.innerHTML = icons.trash;
      removeButton.className = 'danger';
      removeButton.title = '移除指标';
      removeButton.dataset.indicatorInstanceAction = 'remove';
      removeButton.addEventListener('click', () => removeIndicatorInstance(instance.instanceId));
      row.append(removeButton);
      drawingManagerItems.append(row);
    }
  }

  const appendPriceLine = (nameText: string, price: number, remove: () => void) => {
    const row = document.createElement('div');
    row.className = 'drawing-manager-row price-line-object-row';
    const name = document.createElement('span');
    name.textContent = nameText;
    const value = document.createElement('strong');
    value.textContent = formatPrice(price);
    const spacer = document.createElement('i');
    const removeButton = document.createElement('button');
    removeButton.innerHTML = icons.trash;
    removeButton.className = 'danger';
    removeButton.title = '删除';
    removeButton.setAttribute('aria-label', `删除${nameText}`);
    removeButton.addEventListener('click', remove);
    row.append(name, value, spacer, removeButton);
    drawingManagerItems.append(row);
  };
  if (priceLineCount > 0) {
    appendSection('价格线');
    if (priceLines.previousClose && previousClose !== null) appendPriceLine('昨收线', previousClose, () => {
      priceLines.previousClose = false;
      persistChartPreferences();
      renderPriceLines();
      syncPriceLineMenu();
      renderDrawingManager();
    });
    if (priceLines.cost !== null) appendPriceLine('成本线', priceLines.cost, () => {
      priceLines.cost = null;
      persistChartPreferences();
      renderPriceLines();
      syncPriceLineMenu();
      renderDrawingManager();
    });
    for (const [index, price] of priceLines.custom.entries()) appendPriceLine(`自定义价位 ${index + 1}`, price, () => {
      priceLines.custom.splice(index, 1);
      persistChartPreferences();
      renderPriceLines();
      renderDrawingManager();
    });
  }

  if (markers.length > 0) {
    appendSection('标记');
    for (const marker of markers) {
      const row = document.createElement('div');
      row.className = 'drawing-manager-row marker-object-row';
      const name = document.createElement('button');
      name.className = 'marker-object-name';
      name.textContent = marker.text || formatChartTime(marker.time as UTCTimestamp);
      name.title = '定位到标记';
      name.addEventListener('click', () => {
        const index = nearestBarIndex(currentBars, marker.time);
        if (index !== null) chart.timeScale().setVisibleLogicalRange(logicalRangeAround(index, currentBars.length));
      });
      const visibilityButton = document.createElement('button');
      visibilityButton.innerHTML = icons.eye;
      visibilityButton.className = marker.visible ? 'active' : '';
      visibilityButton.title = marker.visible ? '隐藏标记' : '显示标记';
      visibilityButton.addEventListener('click', () => persistMarkers(currentMarkers().map((item) => (
        item.id === marker.id ? { ...item, visible: !item.visible } : item
      ))));
      const editButton = document.createElement('button');
      editButton.textContent = '✎';
      editButton.title = '编辑标记';
      editButton.addEventListener('click', () => openMarkerEditor(marker.time, marker));
      const removeButton = document.createElement('button');
      removeButton.innerHTML = icons.trash;
      removeButton.className = 'danger';
      removeButton.title = '删除标记';
      removeButton.addEventListener('click', () => persistMarkers(currentMarkers().filter((item) => item.id !== marker.id)));
      row.append(name, visibilityButton, editButton, removeButton);
      drawingManagerItems.append(row);
    }
  }

  if (drawings.length > 0) appendSection('绘图');
  for (const drawing of drawings) {
    const row = document.createElement('div');
    row.className = 'drawing-manager-row';
    const name = document.createElement('span');
    name.textContent = drawingToolNames[drawing.toolType] ?? drawing.toolType;
    row.append(name);

    const visible = drawing.options.visible !== false;
    const visibilityButton = document.createElement('button');
    visibilityButton.innerHTML = icons.eye;
    visibilityButton.className = visible ? 'active' : '';
    visibilityButton.title = visible ? '隐藏' : '显示';
    visibilityButton.setAttribute('aria-label', `${visible ? '隐藏' : '显示'}${name.textContent}`);
    visibilityButton.addEventListener('click', () => {
      lineTools.applyLineToolOptions({
        id: drawing.id, toolType: drawing.toolType, options: { visible: !visible },
      } as never);
      commitDrawingState();
    });
    row.append(visibilityButton);

    const editable = drawing.options.editable !== false;
    const lockButton = document.createElement('button');
    lockButton.innerHTML = icons.lock;
    lockButton.className = editable ? '' : 'active';
    lockButton.title = editable ? '锁定' : '解锁';
    lockButton.setAttribute('aria-label', `${editable ? '锁定' : '解锁'}${name.textContent}`);
    lockButton.addEventListener('click', () => {
      lineTools.applyLineToolOptions({
        id: drawing.id, toolType: drawing.toolType, options: { editable: !editable },
      } as never);
      commitDrawingState();
    });
    row.append(lockButton);

    const removeButton = document.createElement('button');
    removeButton.innerHTML = icons.trash;
    removeButton.className = 'danger';
    removeButton.title = '删除';
    removeButton.setAttribute('aria-label', `删除${name.textContent}`);
    removeButton.addEventListener('click', () => {
      lineTools.removeLineToolsById([drawing.id]);
      commitDrawingState();
    });
    row.append(removeButton);
    drawingManagerItems.append(row);
  }
  updateDrawingHistoryButtons();
}

function persistDrawingSnapshot(snapshot: string, strict = false): boolean {
  const scope = currentDrawingScope();
  const next = new Map(drawingScopes);
  next.set(scope, snapshot);
  // Keep ordinary manual editing's in-memory recovery behavior. AI transactions
  // update that cache only after the atomic scene+journal write has succeeded.
  if (!strict) drawingScopes.set(scope, snapshot);
  if (!saveDrawingScopes(drawingJournalStorage, next)) {
    errorLayer.hidden = false;
    errorLayer.textContent = '绘图保存失败：本地存储空间不足或不可用';
    if (strict) throw new Error('drawing_save_failed');
    return false;
  }
  drawingScopes.set(scope, snapshot);
  return true;
}

function commitDrawingState(touchedId?: string) {
  if (restoringDrawings || aiNativeDrawingPort?.mutating) return;
  const snapshot = currentDrawingSnapshot();
  if (!snapshot) {
    errorLayer.hidden = false;
    errorLayer.textContent = '绘图状态校验失败，本次修改未保存';
    return;
  }
  drawingHistory.record(snapshot);
  try {
    drawingJournalStorage.observe(currentDrawingScope(), JSON.parse(snapshot), touchedId ? [touchedId] : []);
  } catch {
    errorLayer.hidden = false;
    errorLayer.textContent = '绘图记录不可用或已被其他窗口修改，本次修改未保存';
    renderDrawingManager();
    return;
  }
  persistDrawingSnapshot(snapshot);
  renderDrawingManager();
}

function applyDrawingSnapshot(snapshot: string, userAction = false): boolean {
  const validated = validateDrawingSnapshot(snapshot, knownDrawingTypes);
  const previous = currentDrawingSnapshot() ?? '[]';
  if (!validated) return false;
  restoringDrawings = true;
  lineTools.removeAllLineTools();
  const imported = validated === '[]' || lineTools.importLineTools(validated);
  if (!imported) {
    lineTools.removeAllLineTools();
    if (previous !== '[]') lineTools.importLineTools(previous);
  }
  restoringDrawings = false;
  if (imported && userAction) {
    try {
      const scene = JSON.parse(currentDrawingSnapshot() ?? '[]') as DrawingExport[];
      drawingJournalStorage.observe(currentDrawingScope(), scene, scene.map(item => item.id));
    } catch {
      errorLayer.hidden = false;
      errorLayer.textContent = '绘图记录不可用或已被其他窗口修改，本次修改未保存';
    }
  }
  hideDrawingProperties();
  renderDrawingManager();
  return imported;
}

function restoreDrawingScope() {
  const scope = currentDrawingScope();
  const legacyScope = legacyDrawingScope();
  const legacySnapshot = legacyStateBelongsToProvider(currentSymbol)
    ? drawingScopes.get(legacyScope)
    : undefined;
  let snapshot = drawingScopes.get(scope) ?? legacySnapshot ?? '[]';
  if (!drawingScopes.has(scope) && legacySnapshot !== undefined) drawingScopes.set(scope, snapshot);
  if (!applyDrawingSnapshot(snapshot)) {
    drawingScopes.delete(scope);
    snapshot = '[]';
    persistDrawingSnapshot(snapshot);
    errorLayer.hidden = false;
    errorLayer.textContent = '已忽略损坏的绘图状态';
  }
  drawingHistory = new DrawingHistory(snapshot);
  updateDrawingHistoryButtons();
}

function hideDrawingProperties() {
  selectedDrawing = null;
  drawingProperties.hidden = true;
  for (const control of drawingProperties.querySelectorAll<HTMLDetailsElement>('details')) control.open = false;
}

function positionDrawingProperties() {
  if (!selectedDrawing || drawingProperties.hidden) return;
  const points = selectedDrawing.points ?? [];
  const coordinates = points.flatMap((point) => {
    const x = chart.timeScale().timeToCoordinate(point.timestamp);
    const y = candleSeries.priceToCoordinate(point.price);
    return x === null || y === null ? [] : [{ x, y }];
  });
  const toolbarWidth = drawingProperties.offsetWidth;
  const toolbarHeight = drawingProperties.offsetHeight;
  const stageWidth = chartStage.clientWidth;
  const stageHeight = chartStage.clientHeight;
  const anchorX = coordinates.length
    ? coordinates.reduce((sum, point) => sum + point.x, 0) / coordinates.length
    : stageWidth / 2;
  const anchorY = coordinates.length
    ? Math.min(...coordinates.map((point) => point.y))
    : 176;
  const left = Math.max(12, Math.min(stageWidth - toolbarWidth - 12, anchorX - toolbarWidth / 2));
  const top = Math.max(58, Math.min(stageHeight - toolbarHeight - 12, anchorY - toolbarHeight - 18));
  drawingProperties.style.left = `${Math.round(left)}px`;
  drawingProperties.style.top = `${Math.round(top)}px`;
  drawingProperties.style.transform = 'none';
}

function leaveDrawingMode(removeIncomplete = false) {
  if (removeIncomplete && activeDrawingId) lineTools.removeLineToolsById([activeDrawingId]);
  activeDrawingId = null;
  pendingTextButton = null;
  drawingTextEditor.hidden = true;
  hideDrawingProperties();
  drawingModeHint.hidden = true;
  document.querySelector('.chart-stage')?.classList.remove('drawing-active');
  crosshairTool.classList.add('active');
  crosshairTool.setAttribute('aria-pressed', 'true');
  for (const button of drawingButtons) {
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
  }
  for (const menu of drawingMenus) {
    menu.open = false;
    menu.querySelector('summary')?.classList.remove('active');
  }
}

// The plugin's runtime supports partial option objects, but its published DeepPartial
// type recurses into primitive values. Keep the compatibility cast at this boundary.
function addInteractiveDrawing(toolType: DrawingToolType, options: Record<string, unknown>) {
  return lineTools.addLineTool(toolType as LineToolType, [], options as never);
}

function startDrawing(toolType: DrawingToolType, button: HTMLButtonElement, textValue?: string) {
  if (drawingsLocked) return;
  cancelMarkerPlacement();
  if ((toolType === 'Text' || toolType === 'Callout') && textValue === undefined) {
    leaveDrawingMode(true);
    pendingTextButton = button;
    drawingTextInput.value = '';
    drawingTextEditor.hidden = false;
    drawingTextInput.focus();
    return;
  }
  leaveDrawingMode(true);
  const options: Record<string, unknown> = toolType === 'Rectangle'
    ? { rectangle: { border: { color: '#2962ff', width: 1 }, background: { color: 'rgba(41, 98, 255, .12)' } } }
    : toolType === 'Circle'
      ? { circle: { border: { color: '#2962ff', width: 1 }, background: { color: 'rgba(41, 98, 255, .10)' } } }
      : toolType === 'FibRetracement'
        ? {
          line: { width: 1 }, extend: { left: false, right: false },
          levels: [
            { coeff: 0, color: '#787b86', opacity: 0 },
            { coeff: 0.236, color: '#787b86', opacity: 0 },
            { coeff: 0.382, color: '#787b86', opacity: 0 },
            { coeff: 0.5, color: '#787b86', opacity: 0 },
            { coeff: 0.618, color: '#f23645', opacity: 0 },
            { coeff: 0.786, color: '#787b86', opacity: 0 },
            { coeff: 1, color: '#089981', opacity: 0 },
          ],
        }
      : toolType === 'Brush'
          ? { line: { color: '#2962ff', width: 2 } }
          : toolType === 'Highlighter'
            ? { line: { color: 'rgba(255, 235, 59, .4)', width: 20 } }
          : toolType === 'Text' || toolType === 'Callout'
            ? { text: { value: textValue || ui('文字'), font: { color: '#d1d4dc', size: 12 } } }
            : toolType === 'Triangle'
              ? { triangle: { border: { color: '#2962ff', width: 1 }, background: { color: 'rgba(41, 98, 255, .12)' } } }
            : toolType === 'Path'
              ? { line: { color: '#2962ff', width: 2 } }
            : toolType === 'UpArrow'
              ? { arrow: { color: '#089981', opacity: 1, size: 34 } }
            : ['TrendLine', 'Ray', 'Arrow', 'ExtendedLine', 'HorizontalLine', 'HorizontalRay', 'VerticalLine', 'CrossLine'].includes(toolType)
              ? { line: { color: '#2962ff', width: toolType === 'HorizontalLine' ? 1 : 2 } }
              : {};
  activeDrawingId = addInteractiveDrawing(toolType, options);

  crosshairTool.classList.remove('active');
  crosshairTool.setAttribute('aria-pressed', 'false');
  button.classList.add('active');
  button.setAttribute('aria-pressed', 'true');
  const drawingMenu = button.closest<HTMLDetailsElement>('.drawing-tool-menu');
  drawingMenu?.querySelector('summary')?.classList.add('active');
  if (drawingMenu) drawingMenu.open = false;
  drawingModeHint.textContent = drawingToolLabels[toolType] ?? '在主图上绘制';
  drawingModeHint.hidden = false;
  document.querySelector('.chart-stage')?.classList.add('drawing-active');
}

lineTools.subscribeLineToolsAfterEdit(({ stage, selectedLineTool }) => {
  if (selectedDrawing?.id === selectedLineTool.id) {
    selectedDrawing = selectedLineTool as unknown as SelectedDrawing;
    positionDrawingProperties();
  }
  if (stage === 'lineToolFinished' || stage === 'pathFinished') leaveDrawingMode();
  commitDrawingState(selectedLineTool.id);
});

function colorToHex(color: unknown, fallback = '#2962ff'): string {
  if (typeof color !== 'string') return fallback;
  const hex = color.match(/^#([0-9a-f]{6})/i);
  if (hex) return `#${hex[1]}`;
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return fallback;
  return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
}

function colorOpacity(color: unknown, fallback = 1): number {
  if (typeof color !== 'string') return fallback;
  const rgba = color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/i);
  if (rgba) return Number(rgba[1]);
  if (/^#[0-9a-f]{8}$/i.test(color)) return parseInt(color.slice(7, 9), 16) / 255;
  return fallback;
}

function colorWithOpacity(color: string, opacity: number): string {
  const rgb = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!rgb) return color;
  return `rgba(${parseInt(rgb[1], 16)}, ${parseInt(rgb[2], 16)}, ${parseInt(rgb[3], 16)}, ${opacity.toFixed(2)})`;
}

function getSelectedStyle(drawing: SelectedDrawing) {
  const options = drawing.options;
  switch (drawing.toolType) {
    case 'UpArrow': return { color: options.arrow?.color, size: options.arrow?.size ?? 34, opacity: options.arrow?.opacity ?? 1, sizeLabel: '大小', min: 16, max: 64, step: 2 };
    case 'Rectangle': return { color: options.rectangle?.border?.color, size: options.rectangle?.border?.width ?? 1, opacity: colorOpacity(options.rectangle?.background?.color, .12) };
    case 'Circle': return { color: options.circle?.border?.color, size: options.circle?.border?.width ?? 1, opacity: colorOpacity(options.circle?.background?.color, .1) };
    case 'Triangle': return { color: options.triangle?.border?.color, size: options.triangle?.border?.width ?? 1, opacity: colorOpacity(options.triangle?.background?.color, .12) };
    case 'ParallelChannel': return { color: options.channelLine?.color, size: options.channelLine?.width ?? 1, opacity: colorOpacity(options.background?.color, .2) };
    case 'Brush': return { color: options.line?.color, size: options.line?.width ?? 2, opacity: colorOpacity(options.line?.color) };
    case 'Highlighter': return { color: options.line?.color, size: options.line?.width ?? 20, opacity: colorOpacity(options.line?.color, .4), min: 8, max: 40, step: 1 };
    case 'Text': case 'Callout': return { color: options.text?.font?.color, size: options.text?.font?.size ?? 12, opacity: colorOpacity(options.text?.font?.color), sizeLabel: '字号', min: 8, max: 40, step: 1 };
    case 'FibRetracement': return { color: options.levels?.[0]?.color, size: options.line?.width ?? 1, opacity: options.levels?.[0]?.opacity ?? 0 };
    case 'PriceRange': return { color: options.priceRange?.rectangle?.border?.color, size: options.priceRange?.rectangle?.border?.width ?? 1, opacity: colorOpacity(options.priceRange?.rectangle?.background?.color, .2) };
    case 'LongShortPosition': return { color: '#089981', size: options.entryPtRectangle?.border?.width ?? 1, opacity: colorOpacity(options.entryPtRectangle?.background?.color, .2), colorDisabled: true };
    default: return { color: options.line?.color, size: options.line?.width ?? 2, opacity: colorOpacity(options.line?.color) };
  }
}

function showDrawingProperties(drawing: SelectedDrawing) {
  selectedDrawing = drawing;
  const style = getSelectedStyle(drawing);
  drawingPropertiesName.textContent = drawingToolNames[drawing.toolType] ?? '绘图';
  drawingColor.value = colorToHex(style.color, drawing.toolType === 'UpArrow' ? '#089981' : '#2962ff');
  refreshTfColorPicker(drawingColor);
  drawingProperties.style.setProperty('--drawing-color', drawingColor.value);
  drawingColor.disabled = Boolean(style.colorDisabled);
  drawingColor.parentElement!.title = style.colorDisabled ? '多空仓位保留红绿双色' : '颜色';
  drawingSizeLabel.textContent = style.sizeLabel ?? '粗细';
  drawingSize.min = String(style.min ?? 1);
  drawingSize.max = String(style.max ?? 5);
  drawingSize.step = String(style.step ?? 1);
  drawingSize.value = String(style.size);
  drawingSizeValue.value = `${style.size}px`;
  drawingOpacity.value = String(Math.round(style.opacity * 100));
  drawingOpacityValue.value = `${Math.round(style.opacity * 100)}%`;
  drawingProperties.hidden = false;
  requestAnimationFrame(positionDrawingProperties);
}

function applySelectedDrawingStyle() {
  if (!selectedDrawing) return;
  const drawing = selectedDrawing;
  const color = drawingColor.value;
  drawingProperties.style.setProperty('--drawing-color', color);
  const opacity = Number(drawingOpacity.value) / 100;
  const size = Number(drawingSize.value);
  const paintedColor = colorWithOpacity(color, opacity);
  const options = drawing.options;
  let patch: Record<string, unknown>;
  switch (drawing.toolType) {
    case 'UpArrow': patch = { arrow: { color, opacity, size } }; break;
    case 'Rectangle': patch = { rectangle: { border: { color, width: size }, background: { color: paintedColor } } }; break;
    case 'Circle': patch = { circle: { border: { color, width: size }, background: { color: paintedColor } } }; break;
    case 'Triangle': patch = { triangle: { border: { color, width: size }, background: { color: paintedColor } } }; break;
    case 'ParallelChannel': patch = { channelLine: { color, width: size }, middleLine: { color, width: size }, background: { color: paintedColor } }; break;
    case 'Brush': case 'Highlighter': patch = { line: { color: paintedColor, width: size } }; break;
    case 'Text': case 'Callout': patch = { text: { font: { color: paintedColor, size } } }; break;
    case 'FibRetracement': patch = { line: { width: size }, levels: (options.levels ?? []).map((level: Record<string, unknown>) => ({ ...level, color, opacity })) }; break;
    case 'PriceRange': patch = { priceRange: { rectangle: { border: { color, width: size }, background: { color: paintedColor } }, horizontalLine: { color, width: size }, verticalLine: { color, width: size } } }; break;
    case 'LongShortPosition': {
      const stopColor = colorWithOpacity(colorToHex(options.entryStopLossRectangle?.background?.color, '#f23645'), opacity);
      const targetColor = colorWithOpacity(colorToHex(options.entryPtRectangle?.background?.color, '#089981'), opacity);
      patch = {
        entryStopLossRectangle: { background: { color: stopColor }, border: { width: size } },
        entryPtRectangle: { background: { color: targetColor }, border: { width: size } },
      };
      break;
    }
    default: patch = { line: { color: paintedColor, width: size } };
  }
  suppressDrawingDeselect = true;
  lineTools.applyLineToolOptions({ id: drawing.id, toolType: drawing.toolType, options: patch } as never);
  const refreshed = JSON.parse(lineTools.getLineToolByID(drawing.id)) as SelectedDrawing[];
  if (refreshed[0]) selectedDrawing = refreshed[0];
  positionDrawingProperties();
  commitDrawingState();
  queueMicrotask(() => { suppressDrawingDeselect = false; });
}

lineTools.subscribeLineToolsSingleClick(({ selectionState, selectedLineTool }) => {
  if (selectionState === 'selected' && selectedLineTool.options) {
    showDrawingProperties(selectedLineTool as unknown as SelectedDrawing);
  } else if (!suppressDrawingDeselect) {
    hideDrawingProperties();
  }
});

function formatChartTick(time: Time, tickMarkType: TickMarkType): string | null {
  if (typeof time !== 'number') return null;
  const timeZone = activeTradingTimeZone();
  const date = new Date(time * 1000);
  if (tickMarkType === TickMarkType.Year) {
    return new Intl.DateTimeFormat(appLocale, { timeZone, year: 'numeric' }).format(date);
  }
  if (tickMarkType === TickMarkType.Month) {
    return new Intl.DateTimeFormat(appLocale, { timeZone, month: 'short' }).format(date);
  }
  if (tickMarkType === TickMarkType.DayOfMonth) {
    return new Intl.DateTimeFormat(appLocale, { timeZone, month: '2-digit', day: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat(appLocale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: tickMarkType === TickMarkType.TimeWithSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(date);
}

function formatChartTime(time: Time): string {
  if (typeof time === 'number') {
    const showTime = resolutionShowsIntradayTime(currentResolution);
    return new Intl.DateTimeFormat(appLocale, {
      timeZone: activeTradingTimeZone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(showTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
    }).format(new Date(time * 1000));
  }
  return typeof time === 'string' ? time : `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

function formatCompactVolume(volume: number): string {
  if (appLocale === 'en-US') {
    return new Intl.NumberFormat(appLocale, { notation: 'compact', maximumFractionDigits: 2 }).format(volume);
  }
  if (volume >= 100_000_000) return `${(volume / 100_000_000).toFixed(2)}亿`;
  if (volume >= 10_000) return `${(volume / 10_000).toFixed(2)}万`;
  return volume.toFixed(0);
}

function formatPrice(value: number): string {
  if (currentSeriesKind === 'probability') return `${value.toFixed(1)}%`;
  return value.toFixed(currentSymbol.kind === 'etf' ? 3 : 2);
}

function renderDataWindow(bar = currentBars.at(-1), previous?: Bar): void {
  aiDataWindowTime = bar?.time ?? null;
  if (dataWindowPanel.hidden) return;
  dataWindowSymbol.textContent = `${currentSymbol.name} · ${currentSymbol.code}`;
  if (!bar) {
    for (const field of [dataWindowTime, dataWindowOpen, dataWindowHigh, dataWindowLow, dataWindowClose, dataWindowChange, dataWindowChangePercent, dataWindowVolume]) {
      field.textContent = '--';
      field.className = '';
    }
    return;
  }
  const index = currentBars.indexOf(bar);
  const prior = previous ?? (index > 0 ? currentBars[index - 1] : undefined);
  const change = prior ? bar.close - prior.close : null;
  const percentage = change !== null && prior?.close ? change / prior.close * 100 : null;
  const direction = change === null ? '' : change >= 0 ? 'up' : 'down';
  const sign = change !== null && change > 0 ? '+' : '';
  dataWindowTime.textContent = formatChartTime(bar.time as UTCTimestamp);
  dataWindowOpen.textContent = formatPrice(bar.open);
  dataWindowHigh.textContent = formatPrice(bar.high);
  dataWindowLow.textContent = formatPrice(bar.low);
  dataWindowClose.textContent = formatPrice(bar.close);
  dataWindowChange.textContent = change === null ? '--' : `${sign}${formatPrice(change)}`;
  dataWindowChangePercent.textContent = percentage === null ? '--' : `${sign}${percentage.toFixed(2)}%`;
  dataWindowVolume.textContent = currentSeriesKind === 'probability' ? '--' : formatCompactVolume(bar.volume);
  dataWindowChange.className = direction;
  dataWindowChangePercent.className = direction;
}

function showBar(bar: Bar, previous?: Bar) {
  renderDataWindow(bar, previous);
  const change = previous ? bar.close - previous.close : 0;
  if (currentSeriesKind === 'probability') {
    const sign = change > 0 ? '+' : '';
    legendValues.className = `legend-values ${change >= 0 ? 'up' : 'down'}`;
    legendValues.removeAttribute('title');
    legendValues.textContent = `${currentSymbol.prediction?.outcome ?? 'YES'} 概率 ${bar.close.toFixed(1)}% · ${sign}${change.toFixed(1)} 个百分点`;
    volumeLegend.hidden = true;
    return;
  }
  const percentage = previous && previous.close ? (change / previous.close) * 100 : 0;
  const sign = change > 0 ? '+' : '';
  const direction = change >= 0 ? 'up' : 'down';
  legendValues.className = `legend-values ${direction}`;
  legendValues.removeAttribute('title');
  legendValues.textContent = `开=${formatPrice(bar.open)} 高=${formatPrice(bar.high)} 低=${formatPrice(bar.low)} 收=${formatPrice(bar.close)} ${sign}${formatPrice(change)} (${sign}${percentage.toFixed(2)}%)`;
  volumeLegend.textContent = formatCompactVolume(bar.volume);
}

function showLatest(bars: Bar[]) {
  const latest = bars.at(-1);
  if (!latest) return;
  const previous = bars.at(-2);
  showBar(latest, previous);
}

function showQuote(quote: NonNullable<HistoryResponse['quote']>) {
  const change = quote.last - quote.previousClose;
  const percentage = quote.previousClose ? change / quote.previousClose * 100 : 0;
  const sign = change > 0 ? '+' : '';
  legendValues.className = `legend-values ${change >= 0 ? 'up' : 'down'}`;
  legendValues.textContent = `开=${formatPrice(quote.open)} 高=${formatPrice(quote.high)} 低=${formatPrice(quote.low)} 收=${formatPrice(quote.last)} ${sign}${formatPrice(change)} (${sign}${percentage.toFixed(2)}%)`;
  legendValues.title = `行情接收时间 ${new Intl.DateTimeFormat(appLocale, { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(quote.receivedAt * 1000))}`;
}

function showCurrentSnapshot() {
  if (currentQuote) {
    showQuote(currentQuote);
    renderDataWindow();
  }
  else showLatest(currentBars);
}

function candlePoint(
  bar: Bar,
  index = currentBars.findIndex((item) => item.time === bar.time),
): CandlestickData<UTCTimestamp> {
  const point: CandlestickData<UTCTimestamp> = {
    time: bar.time as UTCTimestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  };
  if (index >= 0) Object.assign(point, indicatorMainSeriesHost.styleFor(bar, index));
  return point;
}

function secondaryPaneById(id: SecondaryPane): IPaneApi<Time> | null {
  return indicatorChartHost.pane(id, id);
}

function activeSecondaryPanes() {
  return secondaryPaneOrder.flatMap((id) => {
    const pane = secondaryPaneById(id);
    return pane ? [{ id, pane }] : [];
  });
}

function applySecondaryPaneOrder() {
  const active = activeSecondaryPanes();
  for (const [offset, item] of active.entries()) {
    const targetIndex = offset + 1;
    const currentIndex = item.pane.paneIndex();
    if (currentIndex !== targetIndex) chart.swapPanes(currentIndex, targetIndex);
  }
  indicatorChartHost.applyRestoredPaneOrder();
  indicatorChartHost.requestOverlayLayout();
  renderSecondaryPaneOrder();
}

function renderSecondaryPaneOrder() {
  if (!drawingManager.hidden) renderDrawingManager();
}

function refreshIndicators(
  updatedTimes?: readonly number[],
  reason?: IndicatorDataEvent['reason'],
  realtimeUpdates?: readonly IndicatorRealtimeBarUpdate[],
) {
  if (currentBars.length === 0) return;
  const nextSelectionKey = [
    currentSymbol.providerId,
    currentSymbol.symbol,
    currentResolution,
    currentAdjustment,
    currentSeriesKind,
  ].join('|');
  const contextChanged = indicatorSelectionKey !== nextSelectionKey;
  if (contextChanged) {
    indicatorSelectionKey = nextSelectionKey;
    indicatorDataRouter.reset();
  }
  const changedIndexes = updatedTimes
    ?.map((time) => currentBars.findIndex((bar) => bar.time === time))
    .filter((index) => index >= 0);
  const changedFrom = changedIndexes && changedIndexes.length > 0
    ? Math.min(...changedIndexes)
    : 0;
  const event = indicatorDataRouter.event(
    currentBars,
    contextChanged ? 'initial' : (reason ?? (updatedTimes ? 'realtime' : 'reconciliation')),
    changedFrom,
    realtimeUpdates,
  );
  if (contextChanged) {
    indicatorMarketRouter.setSelection(currentSymbol.providerId, currentSymbol.symbol);
    const selection = {
      symbol: currentSymbol,
      resolution: currentResolution,
      adjustment: currentAdjustment,
      seriesKind: 'ohlcv',
      marketKind: currentSymbol.kind,
      providerId: currentSymbol.providerId,
    } as const;
    indicatorRuntime.setContext(selection, event);
    userIndicatorRuntime.setContext(Object.freeze({
      instrument: indicatorInstrumentMetadata(selection),
      selection: Object.freeze({
        symbol: currentSymbol.symbol,
        resolution: currentResolution,
        adjustment: currentAdjustment,
        seriesKind: 'ohlcv' as const,
        marketKind: currentSymbol.kind,
        providerId: currentSymbol.providerId,
      }),
      theme: appTheme,
    }), event);
  } else {
    indicatorRuntime.update(event);
    userIndicatorRuntime.update(event);
  }
  applySecondaryPaneOrder();
  applyMainSeriesOrder();
  if (contextChanged) renderIndicatorLegends();
}

function closeSymbolResults() {
  symbolDialogLayer.hidden = true;
  symbolSourceMenu.hidden = true;
  symbolSourceTrigger.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-expanded', 'false');
  watchlistPanelAdd.setAttribute('aria-expanded', 'false');
  activeSymbolResult = -1;
}

async function loadMarketCatalogs() {
  try {
    const descriptors = await invoke<MarketProviderDescriptor[]>('list_market_providers');
    initialMarketProviderDescriptors = descriptors;
    marketProviderById.clear();
    marketCatalogLoadStates.clear();
    for (const descriptor of descriptors) marketProviderById.set(descriptor.id, descriptor);
    activeMarketProviderIds = enabledProviderIds(descriptors);
    rebuildMarketSymbolsForProviderPolicy();
    for (const descriptor of descriptors) {
      if (!descriptor.enabled || !descriptor.capabilities.catalog) continue;
      for (const venue of descriptor.capabilities.venues) {
        const state: MarketCatalogLoadState = {
          descriptor,
          venue,
          nextCursor: null,
          loading: false,
          pages: 0,
          symbols: 0,
        };
        marketCatalogLoadStates.set(marketProviderKey(descriptor.id, venue), state);
        await loadNextMarketCatalogPage(state);
        if (descriptor.id !== 'polymarket' && state.nextCursor) {
          void loadRemainingMarketCatalogPages(state);
        }
      }
    }
  } catch (error) {
    console.warn('market.catalog.descriptors_unavailable', {
      error: error instanceof Error ? error.message : String(error),
      curated: binanceSpotSymbols.length + binanceUsdMarginedSymbols.length,
    });
  }
}

async function loadRemainingMarketCatalogPages(state: MarketCatalogLoadState) {
  while (state.nextCursor) {
    const loadedPages = state.pages;
    await loadNextMarketCatalogPage(state);
    if (state.pages === loadedPages) return;
  }
}

async function loadNextMarketCatalogPage(state: MarketCatalogLoadState) {
  if (state.loading || (state.pages > 0 && !state.nextCursor)) return;
  state.loading = true;
  const previousVisibleCount = visibleSymbolResults.length;
  const previousScrollTop = symbolResults.scrollTop;
  try {
    const page = await invoke<MarketCatalogPage>('list_market_catalog_page', {
      providerId: state.descriptor.id,
      venue: state.venue,
      cursor: state.nextCursor,
      limit: MARKET_CATALOG_PAGE_SIZE,
    });
    const dynamicSymbols = page.symbols
      .filter((row) => row.providerId === state.descriptor.id)
      .map((row) => marketSymbolFromCatalog(row, state.descriptor, state.venue));
    marketSymbols = mergeMarketCatalogPage(
      marketSymbols,
      dynamicSymbols,
      state.descriptor.id,
      state.venue,
      state.pages === 0,
      bundledMarketSymbolKeys,
    );
    state.pages += 1;
    state.symbols += dynamicSymbols.length;
    state.nextCursor = page.nextCursor ?? null;
    rebuildMarketSymbolIndex();
    renderWatchlist();
    if (!symbolDialogLayer.hidden) {
      renderSymbolResults(previousVisibleCount + SYMBOL_RESULT_PAGE_SIZE, previousScrollTop);
    }
    console.info('market.catalog.page', {
      providerId: state.descriptor.id,
      provider: state.descriptor.displayName,
      venue: state.venue,
      page: state.pages,
      pageSymbols: dynamicSymbols.length,
      symbols: state.symbols,
      hasMore: Boolean(state.nextCursor),
    });
    if (!state.nextCursor) {
      console.info('market.catalog.ready', {
        providerId: state.descriptor.id,
        provider: state.descriptor.displayName,
        venue: state.venue,
        pages: state.pages,
        symbols: state.symbols,
      });
    }
  } catch (error) {
    const message = typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : String(error);
    console.warn(state.pages === 0 ? 'market.catalog.fallback' : 'market.catalog.partial', {
      providerId: state.descriptor.id,
      provider: state.descriptor.displayName,
      venue: state.venue,
      pages: state.pages,
      symbols: state.symbols,
      error: message,
    });
  } finally {
    state.loading = false;
  }
}

function polymarketCatalogState(): MarketCatalogLoadState | undefined {
  return marketCatalogLoadStates.get(marketProviderKey('polymarket', 'POLYMARKET'));
}

function shouldLoadMorePolymarketSymbols(): boolean {
  return symbolDialogInput.value.trim() === ''
    && (activeSymbolCategory === 'prediction' || activeSymbolSource === 'polymarket')
    && Boolean(polymarketCatalogState()?.nextCursor);
}

function openSymbolDialog(mode: 'select' | 'watchlist' = 'select') {
  symbolDialogMode = mode;
  symbolDialogReturnFocus = mode === 'watchlist' ? watchlistPanelAdd : input;
  symbolDialogTitle.textContent = mode === 'watchlist' ? '添加商品代码' : '商品代码搜索';
  symbolDialogFooter.textContent = mode === 'watchlist'
    ? '输入代码、名称或拼音查找品种，点击结果添加到自选'
    : '输入代码、名称或拼音查找品种，点击结果即可切换图表';
  symbolDialogLayer.hidden = false;
  input.setAttribute('aria-expanded', String(mode === 'select'));
  watchlistPanelAdd.setAttribute('aria-expanded', String(mode === 'watchlist'));
  symbolDialogInput.value = '';
  renderSymbolSources();
  renderSymbolResults();
  window.requestAnimationFrame(() => symbolDialogInput.focus());
}

function activateSymbolResult(item: MarketSymbol): void {
  if (symbolDialogMode === 'watchlist') {
    if (addSymbolToWatchlist(item)) renderSymbolResults(visibleSymbolResults.length, symbolResults.scrollTop);
    return;
  }
  void selectSymbol(item);
}

function renderSymbolSources() {
  const sources = symbolSources[activeSymbolCategory].filter((source) => marketSourceEnabled(source.value));
  if (!sources.some((source) => source.value === activeSymbolSource)) activeSymbolSource = 'all';
  const selected = sources.find((source) => source.value === activeSymbolSource)!;
  symbolSourceTrigger.textContent = selected.label;
  symbolSourceMenu.replaceChildren();
  for (const source of sources) {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'menuitemradio';
    button.setAttribute('aria-checked', String(source.value === activeSymbolSource));
    button.textContent = source.label;
    button.addEventListener('click', () => {
      activeSymbolSource = source.value;
      symbolSourceMenu.hidden = true;
      symbolSourceTrigger.setAttribute('aria-expanded', 'false');
      renderSymbolSources();
      renderSymbolResults();
      symbolSourceTrigger.focus();
    });
    symbolSourceMenu.append(button);
  }
}

function setActiveSymbolResult(index: number) {
  if (index >= visibleSymbolResults.length && visibleSymbolResults.length < matchingSymbolResults.length) {
    appendNextSymbolResults();
  }
  if (!visibleSymbolResults.length) return;
  activeSymbolResult = (index + visibleSymbolResults.length) % visibleSymbolResults.length;
  for (const [buttonIndex, button] of [...symbolResults.querySelectorAll<HTMLButtonElement>('.symbol-result-row')].entries()) {
    const active = buttonIndex === activeSymbolResult;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    if (active) button.scrollIntoView({ block: 'nearest' });
  }
}

function appendNextSymbolResults() {
  const start = visibleSymbolResults.length;
  const next = matchingSymbolResults.slice(start, start + SYMBOL_RESULT_PAGE_SIZE);
  visibleSymbolResults.push(...next);
  for (const [offset, item] of next.entries()) {
    const index = start + offset;
    const button = document.createElement('button');
    button.type = 'button';
    const isWatchlistMode = symbolDialogMode === 'watchlist';
    const isAdded = isWatchlistMode && watchlistContains(item);
    button.className = `symbol-result-row${item.kind === 'crypto' || item.kind === 'prediction' ? ' wide' : ''}${item.kind === 'prediction' ? ' prediction' : ''}${isWatchlistMode ? ' watchlist-add-mode' : ''}${isAdded ? ' added' : ''}`;
    button.role = 'option';
    button.setAttribute('aria-selected', 'false');
    button.innerHTML = '<span class="symbol-result-code"></span><span class="symbol-result-name"><strong></strong></span><span class="symbol-result-kind"></span>';
    button.prepend(createSymbolLogo(item));
    button.querySelector('.symbol-result-code')!.textContent = item.code;
    button.querySelector('strong')!.textContent = item.name;
    const kind = button.querySelector('.symbol-result-kind')!;
    kind.replaceChildren(createExchangeBadge(item.exchange));
    if (isWatchlistMode) {
      const action = document.createElement('span');
      action.className = 'symbol-result-action';
      action.innerHTML = addSymbolWidgetIcon;
      action.setAttribute('aria-hidden', 'true');
      button.append(action);
      button.setAttribute('aria-label', isAdded ? `${item.name} 已在自选` : `添加 ${item.name} 到自选`);
      button.setAttribute('aria-disabled', String(isAdded));
    }
    button.title = `${item.code} ${item.name} ${kindLabels[item.kind]} ${item.exchange}`;
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      if (!isAdded) activateSymbolResult(item);
    });
    button.addEventListener('pointermove', () => setActiveSymbolResult(index));
    symbolResults.append(button);
  }
  const remoteHasMore = shouldLoadMorePolymarketSymbols();
  symbolResultCount.textContent = matchingSymbolResults.length
    ? visibleSymbolResults.length < matchingSymbolResults.length
      ? `已显示 ${visibleSymbolResults.length} / 共 ${matchingSymbolResults.length} 条`
      : remoteHasMore
        ? `已加载 ${matchingSymbolResults.length} 条 · 下滑继续加载`
        : `共 ${matchingSymbolResults.length} 条`
    : '';
}

function renderSymbolResults(minimumVisible = SYMBOL_RESULT_PAGE_SIZE, restoreScrollTop = 0) {
  matchingSymbolResults = listMarketSymbols(
    marketSymbols,
    symbolDialogInput.value,
    activeSymbolCategory,
    activeSymbolSource,
    marketSymbols.length,
  );
  visibleSymbolResults = [];
  symbolLogoObserver.disconnect();
  symbolResults.replaceChildren();
  if (!matchingSymbolResults.length) {
    const empty = document.createElement('p');
    empty.className = 'symbol-results-empty';
    empty.textContent = '没有找到符合条件的品种';
    symbolResults.append(empty);
    symbolResultCount.textContent = '';
    activeSymbolResult = -1;
    return;
  }
  while (visibleSymbolResults.length < minimumVisible && visibleSymbolResults.length < matchingSymbolResults.length) {
    appendNextSymbolResults();
  }
  symbolResults.scrollTop = restoreScrollTop;
  activeSymbolResult = -1;
}

function resolveInputSymbol(): MarketSymbol | undefined {
  const query = symbolDialogInput.value.trim();
  if ([currentSymbol.symbol, currentSymbol.code, currentSymbol.name].includes(query)) return currentSymbol;
  return listMarketSymbols(marketSymbols, query, activeSymbolCategory, activeSymbolSource, 1)[0];
}

function isCurrentQuoteRequest(symbol: MarketSymbol, generation: number): boolean {
  return historyRequestGate.isCurrent(generation)
    && currentSymbol.providerId === symbol.providerId
    && currentSymbol.symbol === symbol.symbol;
}

async function requestStandaloneQuote(
  symbol: MarketSymbol,
  generation: number,
): Promise<QuoteSnapshot | null> {
  if (!isCurrentQuoteRequest(symbol, generation)) return null;
  const response = await invoke<QuoteResponse>('get_quote_snapshot', {
    providerId: symbol.providerId,
    symbol: symbol.symbol,
    kind: symbol.kind,
  });
  if (!isCurrentQuoteRequest(symbol, generation)) {
    console.info('market.quote.stale', {
      providerId: response.providerId,
      symbol: response.symbol,
      expectedProviderId: symbol.providerId,
      expectedSymbol: symbol.symbol,
      generation,
    });
    return null;
  }
  if (!matchesQuoteResponse(response, symbol.providerId, symbol.symbol)) {
    console.warn('market.quote.identity_mismatch', {
      providerId: response.providerId,
      symbol: response.symbol,
      expectedProviderId: symbol.providerId,
      expectedSymbol: symbol.symbol,
      generation,
    });
    return null;
  }
  if (!isUsableQuote(response.quote)) {
    console.warn('market.quote.invalid', {
      providerId: symbol.providerId,
      symbol: symbol.symbol,
      generation,
    });
    return null;
  }
  return response.quote;
}

async function refreshMissingHistoryQuote(
  response: HistoryResponse,
  symbol: MarketSymbol,
  resolution: Resolution,
  adjustment: Adjustment,
  generation: number,
) {
  if (!shouldFetchStandaloneQuote(response.quote != null, providerSupportsQuote(symbol))) return;
  let quote: QuoteSnapshot | null = null;
  try {
    quote = await requestStandaloneQuote(symbol, generation);
  } catch (error) {
    if (!isCurrentQuoteRequest(symbol, generation)) return;
    console.warn('market.quote.fallback_failed', {
      providerId: symbol.providerId,
      symbol: symbol.symbol,
      generation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!isCurrentQuoteRequest(symbol, generation)) return;
  if (!quote) {
    status.className = 'connection-status ready';
    setStatusLabel(status, marketStatusText(symbol, '报价降级，保留 K 线'));
    return;
  }
  currentQuote = quote;
  applyQuoteDepth(quote, symbol, resolution);
  renderPriceLines();
  showCurrentSnapshot();
  const cacheKey = historyCacheKey(symbol.providerId, symbol.symbol, resolution, adjustment);
  const cached = historyCache.get(cacheKey);
  if (cached) historyCache.set(cacheKey, { ...cached.value, quote }, cached.deep);
}

async function refreshTdxRecentTrades(
  symbol: MarketSymbol,
  resolution: Resolution,
  adjustment: Adjustment,
  generation: number,
) {
  if (!isPolledTradesSupported(symbol)) return;
  try {
    const response = await invoke<TdxRecentTradesResponse>('get_tdx_recent_trades', {
      providerId: symbol.providerId,
      symbol: symbol.symbol,
      kind: symbol.kind,
      count: 800,
    });
    if (!historyRequestGate.isCurrent(generation)
      || !isCurrentMarketSelection(symbol, resolution, adjustment)) {
      console.info('market.trades.stale', {
        providerId: response.providerId,
        symbol: response.symbol,
        generation,
      });
      return;
    }
    if (!isUsableTdxRecentTrades(response, symbol.providerId, symbol.symbol)) {
      console.warn('market.trades.invalid', {
        providerId: response.providerId,
        symbol: response.symbol,
        generation,
      });
      return;
    }
    if (!response.trades.length) return;
    const firstSnapshot = recentTrades.length === 0;
    recentTrades = response.trades.slice(-100).map((trade) => ({
      requestId: activeRealtimeRequestId,
      providerId: response.providerId,
      symbol: response.symbol,
      resolution,
      eventTimeMs: response.receivedAt * 1_000,
      tradeId: trade.tradeId,
      tradeTimeMs: trade.tradeTimeMs,
      barTime: Math.floor(trade.tradeTimeMs / 1_000),
      price: trade.price,
      quantity: trade.quantity,
      side: trade.side,
    })).reverse();
    if (firstSnapshot) {
      console.info('market.trades.first_snapshot', {
        providerId: response.providerId,
        symbol: response.symbol,
        trades: response.trades.length,
        receivedAt: response.receivedAt,
      });
    }
    if (!marketDataPanel.hidden && activeMarketDataTab === 'trades') renderMarketDataPanel();
  } catch (error) {
    if (!historyRequestGate.isCurrent(generation)
      || !isCurrentMarketSelection(symbol, resolution, adjustment)) return;
    console.warn('market.trades.refresh_failed', {
      providerId: symbol.providerId,
      symbol: symbol.symbol,
      generation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function selectSymbol(symbol: MarketSymbol) {
  input.value = symbol.code;
  closeSymbolResults();
  await openHistory(symbol, currentResolution, symbol.kind === 'crypto' || symbol.kind === 'prediction' ? 'none' : currentAdjustment);
}

function marketHistoryCacheKey(symbol: MarketSymbol, resolution: Resolution, adjustment: Adjustment): string {
  return historyCacheKey(symbol.providerId, symbol.symbol, resolution, adjustment);
}

function historyRequestIncarnation(generation = historyRequestGate.current()) {
  return historyRequestIncarnationSeed + generation;
}

function legacyHistoryCacheKey(symbol: MarketSymbol, resolution: Resolution, adjustment: Adjustment): string {
  return historyCacheKey(symbol.symbol, resolution, adjustment);
}

function getHistoryCache(symbol: MarketSymbol, resolution: Resolution, adjustment: Adjustment) {
  const key = marketHistoryCacheKey(symbol, resolution, adjustment);
  const current = historyCache.get(key);
  if (current) return current;
  if (!legacyStateBelongsToProvider(symbol)) return undefined;
  const legacy = historyCache.get(legacyHistoryCacheKey(symbol, resolution, adjustment));
  if (legacy) historyCache.set(key, legacy.value, legacy.deep);
  return legacy;
}

function fetchHistoryResponse(
  symbol: MarketSymbol,
  resolution: Resolution,
  adjustment: Adjustment,
  count: number,
  includeQuote = false,
  generation = historyRequestGate.current(),
) {
  return invoke<HistoryResponse>('get_history_bars', {
    symbol: symbol.symbol,
    providerId: symbol.providerId,
    kind: symbol.kind,
    resolution,
    adjustment,
    count,
    includeQuote,
    requestIncarnation: historyRequestIncarnation(generation),
  }).then(normalizeProbabilityHistory);
}

function requestHistory(
  symbol: MarketSymbol,
  resolution: Resolution,
  adjustment: Adjustment,
  count: number,
  generation = historyRequestGate.current(),
) {
  const requestKey = `${marketHistoryCacheKey(symbol, resolution, adjustment)}|${count}|g${generation}`;
  const existing = historyRequests.get(requestKey);
  if (existing) return existing;
  const request = fetchHistoryResponse(symbol, resolution, adjustment, count, false, generation)
    .finally(() => historyRequests.delete(requestKey));
  historyRequests.set(requestKey, request);
  return request;
}

function createAiMarketQueryHost(): MarketQueryHost {
  return {
    providers: () => invoke<MarketProviderDescriptor[]>('list_market_providers'),
    watchlist: () => watchlistSymbols.map(key => ({ key, symbol: marketSymbolById.get(key) ?? null })),
    ...createNativeMarketQueryPort(invoke),
  };
}

/** Thin read ports over the same catalogs, watchlist and indicators used by the UI. */
function createAiWorkspaceReadTools(marketHost = createAiMarketQueryHost(), marketStore?: MarketResultStore) {
  const metadata = (definition: NonNullable<ReturnType<typeof indicatorDefinitionView>>) => ({
    id: definition.id, name: localizedIndicatorText(definition.name), runtimeKind: definition.runtimeKind,
    indicatorVersion: definition.indicatorVersion, inputs: definition.inputs,
    description: definition.description ? localizedIndicatorText(definition.description) : '', author: definition.author ?? '',
  });
  const userDefinitions = () => [...userIndicatorRecords.values()].map(record => metadata({
    ...record.manifest, runtimeKind: 'user', description: record.manifest.description, author: record.manifest.author,
  }));
  const catalogStatus = (providerId?: string, venue?: string) => {
    const providers = providerId
      ? [marketProviderById.get(providerId)].filter((value): value is MarketProviderDescriptor => Boolean(value))
      : [...marketProviderById.values()].filter(value => value.enabled);
    if (providerId && providers.length === 0) return { loaded: false, complete: false };
    let expected = 0; const states: MarketCatalogLoadState[] = [];
    for (const provider of providers) {
      if (!provider.enabled || !provider.capabilities.catalog) continue;
      for (const itemVenue of provider.capabilities.venues) {
        if (venue && itemVenue !== venue) continue;
        expected++;
        const state = marketCatalogLoadStates.get(marketProviderKey(provider.id, itemVenue));
        if (state) states.push(state);
      }
    }
    if (expected === 0) return { loaded: providers.length > 0, complete: providers.length > 0 };
    const dynamicLoaded = states.length === expected && states.every(state => state.pages > 0);
    const loaded = providerId ? dynamicLoaded : (venue ? marketSymbols.some(symbol => symbol.venue === venue) : marketSymbols.length > 0);
    return { loaded, complete: dynamicLoaded && states.every(state => !state.loading && !state.nextCursor) };
  };
  return [...createWorkspaceReadTools({
    providers: () => invoke<MarketProviderDescriptor[]>('list_market_providers'),
    symbols: () => marketSymbols,
    catalog: input => invoke<MarketCatalogPage>('list_market_catalog_page', { ...input, cursor: input.cursor ?? null }),
    catalogStatus,
    watchlist: () => watchlistSymbols.map(key => ({ key, symbol: marketSymbolById.get(key) ?? null })),
    definitions: () => [...indicatorRegistry.list().map(definition => metadata({
      ...definition, runtimeKind: 'trusted', description: definition.description, author: definition.author,
    })), ...userDefinitions()],
    instances: () => allIndicatorInstances(),
    library: () => ({ ready: indicatorStateReady && userIndicatorLibrary !== null, records: userDefinitions() }),
    indicatorsReady: () => indicatorStateReady,
  }), ...createMarketQueryTools(marketHost, { store: marketStore })];
}

function prepareAiWatchlistChange(change: WatchlistChange, execution: ToolExecutionContext): ToolTransaction {
  execution.checkpoint();
  const revision = aiWatchlistRevision;
  const before = [...watchlistSymbols];
  const saved = workspaceStorage.getItem(WATCHLIST_STORAGE_KEY);
  const canonical = (key: string) => {
    const symbol = marketSymbolById.get(key);
    return symbol ? watchlistSymbolKey(symbol.providerId, symbol.symbol) : key;
  };
  let next = before.map(canonical);
  if (change.op === 'add') next = [...new Set([...next, ...change.items.map(item => watchlistSymbolKey(item.providerId, item.symbol))])];
  else if (change.op === 'remove') {
    const remove = new Set(change.keys.map(canonical)); next = next.filter(key => !remove.has(key));
  } else {
    const at = next.indexOf(canonical(change.key));
    if (at < 0 || change.index >= next.length) throw new CapabilityError('invalid_request');
    const [key] = next.splice(at, 1); next.splice(change.index, 0, key);
  }
  const changed = JSON.stringify(before) !== JSON.stringify(next);
  let written = false;
  return {
    result: { changed, count: next.length },
    commit() {
      execution.checkpoint();
      if (aiWatchlistRevision !== revision || JSON.stringify(watchlistSymbols) !== JSON.stringify(before)
        || workspaceStorage.getItem(WATCHLIST_STORAGE_KEY) !== saved) throw new CapabilityError('state_conflict');
      if (!changed) return;
      if (!saveWatchlist(workspaceStorage, next)) throw new CapabilityError('storage_failed');
      written = true; aiWatchlistRevision++; watchlistSymbols = [...next]; renderWatchlist();
    },
    rollback() {
      if (!written) return;
      if (aiWatchlistRevision !== revision + 1) throw new CapabilityError('state_conflict');
      if (saved === null) workspaceStorage.removeItem(WATCHLIST_STORAGE_KEY); else workspaceStorage.setItem(WATCHLIST_STORAGE_KEY, saved);
      watchlistSymbols = before; aiWatchlistRevision++; written = false; renderWatchlist();
    },
  };
}

function prepareAiIndicatorChange(change: IndicatorChange, execution: ToolExecutionContext): ToolTransaction {
  execution.checkpoint();
  if (aiIndicatorLibraryBusy) throw new CapabilityError('busy');
  if (!indicatorStateReady || aiDisplayedHistoryGeneration !== historyRequestGate.current()) throw new CapabilityError('data_not_ready');
  const previous = change.op === 'add' ? undefined : structuredClone(allIndicatorInstances().find(item => item.instanceId === change.instanceId));
  if (change.op !== 'add' && !previous) throw new CapabilityError('field_unavailable');
  const indicatorId = change.op === 'add' ? change.indicatorId : previous!.indicatorId;
  const definition = indicatorDefinitionView(indicatorId);
  if (!definition) throw new CapabilityError('field_unavailable');
  if (definition.runtimeKind === 'trusted' && !indicatorRuntime.isApplicable(indicatorId) && change.op !== 'remove') throw new CapabilityError('field_unavailable');
  const library = userIndicatorRecords.get(indicatorId);
  if (definition.runtimeKind === 'user' && (!library || (change.op !== 'remove' && !library.manifest.supports.seriesKinds.includes(currentSeriesKind as 'ohlcv')))) throw new CapabilityError('field_unavailable');
  const instanceId = change.op === 'add' ? nextIndicatorInstanceId(indicatorId) : previous!.instanceId;
  const inputs = change.op === 'add' || change.op === 'inputs'
    ? parseIndicatorInputPatch(definition.inputs, change.inputsJson, previous?.inputs) : previous!.inputs;
  const revision = aiIndicatorRevision;
  const beforeOrder = [...indicatorInstanceOrder];
  const beforeActive = new Set(activeIndicators), beforeHidden = new Set(hiddenSeries);
  const beforeLoaded = structuredClone(loadedIndicatorState);
  const saved = workspaceStorage.getItem(INDICATOR_STATE_STORAGE_KEY);
  const panes = indicatorChartHost.paneStates(instanceId);
  const previousFailure = userIndicatorRuntimeFailures.get(instanceId);
  let attempted = false;
  const redraw = () => {
    applySecondaryPaneOrder(); applyMainSeriesOrder(); applyIndicatorInstanceOrder();
    renderIndicatorPicker(); renderIndicatorLegends(); if (!drawingManager.hidden) renderDrawingManager();
  };
  const add = (values: Readonly<Record<string, unknown>>, visible: boolean) => {
    if (definition.runtimeKind === 'user') userIndicatorRuntime.add({ instanceId, indicatorId, sourceHash: library!.sourceHash,
      indicatorVersion: library!.indicatorVersion, inputs: values, visible }, library!);
    else indicatorRuntime.add({ instanceId, indicatorId, inputs: values, visible });
  };
  return {
    result: { instanceId, indicatorId, state: change.op === 'remove' ? 'removed'
      : change.op === 'visibility' ? change.visible ? 'visible' : 'hidden' : 'configured' },
    commit() {
      execution.checkpoint();
      if (aiIndicatorLibraryBusy) throw new CapabilityError('busy');
      if (aiIndicatorRevision !== revision || workspaceStorage.getItem(INDICATOR_STATE_STORAGE_KEY) !== saved
        || (library && userIndicatorRecords.get(indicatorId)?.sourceHash !== library.sourceHash)) throw new CapabilityError('state_conflict');
      attempted = true;
      if (change.op === 'add') {
        add(inputs, change.visible ?? true); indicatorInstanceOrder.push(instanceId);
        if (definition.runtimeKind === 'trusted' && indicatorId.startsWith('builtin.') && instanceId === defaultIndicatorInstanceId(indicatorId)) activeIndicators.add(indicatorId.slice(8) as IndicatorName);
      } else if (change.op === 'remove') removeIndicatorInstance(instanceId, false);
      else if (change.op === 'visibility') setIndicatorInstanceVisible(instanceId, change.visible, false);
      else {
        indicatorChartHost.restorePaneStates(instanceId, panes);
        const runtime = definition.runtimeKind === 'user' ? userIndicatorRuntime : indicatorRuntime;
        if (change.op === 'retry') runtime.retry(instanceId); else runtime.updateInputs(instanceId, inputs);
      }
      const after = allIndicatorInstances().find(item => item.instanceId === instanceId);
      if (change.op !== 'remove' && (!after || after.failed)) throw new CapabilityError('indicator_failed');
      redraw(); persistIndicatorState(true);
    },
    rollback() {
      if (!attempted) return;
      // No await: restore only this instance, its parameters and saved pane layout.
      const runtime = definition.runtimeKind === 'user' ? userIndicatorRuntime : indicatorRuntime;
      runtime.remove(instanceId);
      if (previous) { indicatorChartHost.restorePaneStates(instanceId, panes); add(previous.inputs, previous.visible); }
      if (previousFailure) userIndicatorRuntimeFailures.set(instanceId, previousFailure); else userIndicatorRuntimeFailures.delete(instanceId);
      indicatorInstanceOrder = beforeOrder;
      activeIndicators.clear(); for (const id of beforeActive) activeIndicators.add(id);
      hiddenSeries.clear(); for (const id of beforeHidden) hiddenSeries.add(id);
      loadedIndicatorState = beforeLoaded;
      if (saved === null) workspaceStorage.removeItem(INDICATOR_STATE_STORAGE_KEY); else workspaceStorage.setItem(INDICATOR_STATE_STORAGE_KEY, saved);
      aiIndicatorRevision++; attempted = false; redraw();
    },
  };
}

function createAiWorkspaceActionTools() {
  return createWorkspaceActionTools({
    async prepareWatchlist(change, execution) {
      if (change.op === 'add') {
        const providers = await invoke<MarketProviderDescriptor[]>('list_market_providers'); execution.checkpoint();
        if (change.items.some(item => !providers.some(provider => provider.id === item.providerId
          && provider.enabled && provider.capabilities.venues.includes(item.symbol.split(':')[0])))) throw new CapabilityError('field_unavailable');
      }
      return prepareAiWatchlistChange(change, execution);
    },
    prepareIndicator: prepareAiIndicatorChange,
    indicatorInputs(instanceId) {
      const instance = allIndicatorInstances().find(item => item.instanceId === instanceId);
      if (!instance) throw new CapabilityError('field_unavailable');
      const definition = indicatorDefinitionView(instance.indicatorId);
      if (!definition) throw new CapabilityError('field_unavailable');
      return { instanceId, indicatorId: instance.indicatorId, inputsJson: JSON.stringify(instance.inputs), schemaJson: JSON.stringify(definition.inputs) };
    },
  });
}

async function prepareAiLibraryChange(
  prepared: PreparedUserIndicatorImport | null, indicatorId: string, applyToExisting: boolean, execution: ToolExecutionContext,
): Promise<AsyncToolTransaction> {
  const library = userIndicatorLibrary;
  if (!library || !indicatorStateReady) throw new CapabilityError('data_not_ready');
  if (aiIndicatorLibraryBusy) throw new CapabilityError('busy');
  const before = await library.get(indicatorId); execution.checkpoint();
  if (!prepared && !before) throw new CapabilityError('field_unavailable');
  if (prepared && (before?.sourceHash ?? null) !== prepared.existingSourceHash) throw new CapabilityError('state_conflict');
  let acquired = false, written = false, graphTouched = false;
  let after: UserIndicatorLibraryRecord | null = null;
  let preserved: SavedUserIndicatorState[] = [];
  let oldState: LoadedIndicatorState | undefined, oldOrder: string[] = [], oldSaved: string | null = null;
  const redraw = () => { applyIndicatorInstanceOrder(); renderIndicatorPicker(); renderIndicatorLegends(); if (!drawingManager.hidden) renderDrawingManager(); };
  const add = (record: UserIndicatorLibraryRecord, saved: SavedUserIndicatorState) => {
    indicatorChartHost.restorePaneStates(saved.instanceId, saved.panes);
    userIndicatorRuntime.add({ instanceId: saved.instanceId, indicatorId, sourceHash: record.sourceHash,
      indicatorVersion: record.indicatorVersion, inputs: normalizeUserIndicatorInputs(record, saved.inputs), visible: saved.visible }, record);
    userIndicatorRuntimeFailures.delete(saved.instanceId);
  };
  return {
    result: { indicatorId, indicatorVersion: prepared?.manifest.indicatorVersion ?? before!.indicatorVersion, state: prepared ? 'installed' : 'removed' },
    async commit() {
      execution.checkpoint();
      if (aiIndicatorLibraryBusy) throw new CapabilityError('busy');
      acquired = true; aiIndicatorLibraryBusy = true;
      if (prepared) {
        const installed = await library.install(prepared, { replace: prepared.disposition === 'replace' });
        after = installed.record; written = installed.status === 'installed';
      } else { await library.replaceExact(indicatorId, before!.sourceHash, null); written = true; }
      execution.checkpoint();
      // Capture current parameters after storage completes, immediately before runtime mutation.
      preserved = captureUserIndicatorInstances(indicatorId, before?.sourceHash);
      oldState = structuredClone(loadedIndicatorState); oldOrder = [...indicatorInstanceOrder];
      oldSaved = workspaceStorage.getItem(INDICATOR_STATE_STORAGE_KEY); graphTouched = true;
      if (after) userIndicatorRecords.set(indicatorId, after); else userIndicatorRecords.delete(indicatorId);
      if (before && after && applyToExisting) {
        for (const saved of preserved) { userIndicatorRuntime.remove(saved.instanceId); add(after, saved); }
      } else if (before) preserveAndStopUserIndicatorInstances(indicatorId, before.sourceHash, preserved);
      persistIndicatorState(true);
      if (after && applyToExisting) {
        // Explicitly reimported exact sources can recover their previously unresolved instances.
        const restored = resolveUserIndicatorStateEntries(loadedIndicatorState.unresolvedEntries, [after],
          new Set(allIndicatorInstances().map(instance => instance.instanceId)));
        for (const saved of restored.instances) {
          if (saved.runtimeKind !== 'user' || saved.indicatorId !== indicatorId || userIndicatorRuntime.get(saved.instanceId)) continue;
          add(after, saved); indicatorInstanceOrder.splice(Math.min(saved.menuOrder, indicatorInstanceOrder.length), 0, saved.instanceId);
        }
        loadedIndicatorState = { ...loadedIndicatorState, unresolvedEntries: restored.unresolvedEntries };
        await waitForAiUserIndicators(indicatorId, execution);
      }
      execution.checkpoint(); redraw(); persistIndicatorState(true);
    },
    async rollback() {
      if (written) await library.replaceExact(indicatorId, after?.sourceHash ?? null, before);
      if (graphTouched) {
        for (const instance of userIndicatorRuntime.list()) if (instance.indicatorId === indicatorId) userIndicatorRuntime.remove(instance.instanceId);
        if (before) userIndicatorRecords.set(indicatorId, before); else userIndicatorRecords.delete(indicatorId);
        if (before) for (const saved of preserved) add(before, saved);
        if (oldState) loadedIndicatorState = oldState;
        indicatorInstanceOrder = oldOrder;
        if (oldSaved === null) workspaceStorage.removeItem(INDICATOR_STATE_STORAGE_KEY); else workspaceStorage.setItem(INDICATOR_STATE_STORAGE_KEY, oldSaved);
        aiIndicatorRevision++; redraw();
      }
      written = false; graphTouched = false;
    },
    dispose() { if (acquired) { aiIndicatorLibraryBusy = false; acquired = false; } },
  };
}

async function waitForAiUserIndicators(indicatorId: string, execution: ToolExecutionContext): Promise<void> {
  const deadline = performance.now() + 5_000;
  for (;;) {
    execution.checkpoint();
    const instances = userIndicatorRuntime.list().filter(item => item.indicatorId === indicatorId);
    if (instances.some(item => item.failed)) throw new CapabilityError('indicator_failed');
    const states = userIndicatorController.list();
    if (instances.every(item => !item.applicable || states.some(state => state.instanceId === item.instanceId && state.ready))) return;
    if (performance.now() >= deadline) throw new CapabilityError('indicator_failed');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function createAiIndicatorLibraryTools() {
  return createIndicatorLibraryTools({ library: () => userIndicatorLibrary, test: testAiIndicatorDraft, prepareChange: prepareAiLibraryChange });
}

async function testAiIndicatorDraft(prepared: PreparedUserIndicatorImport, execution: ToolExecutionContext) {
  execution.checkpoint();
  const expected = requireChartSelection(execution.context), state = readCurrentAiChartState();
  if (!sameSelection(expected, state.context)) throw new CapabilityError('context_stale');
  if (state.seriesKind !== 'ohlcv' || !state.bars.length || currentSymbol.kind === 'prediction'
    || aiDisplayedHistoryGeneration !== expected.selectionGeneration) throw new CapabilityError('data_not_ready');
  const marketKinds = prepared.manifest.supports.marketKinds;
  if (marketKinds && !marketKinds.includes(currentSymbol.kind as Exclude<typeof currentSymbol.kind, 'prediction'>)) {
    throw new CapabilityError('field_unavailable');
  }
  const bars = state.bars.map(bar => Object.freeze({ ...bar }));
  const selection = {
    symbol: currentSymbol,
    resolution: currentResolution,
    adjustment: currentAdjustment,
    seriesKind: 'ohlcv' as const,
    marketKind: currentSymbol.kind,
    providerId: currentSymbol.providerId,
  } as const;
  const inputs = Object.freeze(Object.fromEntries(Object.entries(prepared.manifest.inputs).map(([key, definition]) => [key, definition.default])));
  const extraData: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const extraDataStatus: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, request] of Object.entries(prepared.manifest.data ?? {})) {
    const requestedSymbol = request.symbol ?? currentSymbol.symbol;
    const targetSymbol = marketSymbolById.get(marketProviderKey(currentSymbol.providerId, requestedSymbol))
      ?? (currentSymbol.symbol === requestedSymbol ? currentSymbol : null);
    if (!targetSymbol) {
      if (request.symbol !== undefined) {
        const existsOnAnotherProvider = [...marketSymbolById.values()].some(candidate =>
          candidate.symbol === requestedSymbol && candidate.providerId !== currentSymbol.providerId);
        extraDataStatus[key] = Object.freeze({
          state: 'unavailable',
          reason: existsOnAnotherProvider ? 'provider_mismatch' : 'symbol_unavailable',
        });
        continue;
      }
      throw new CapabilityError('field_unavailable');
    }
    if (targetSymbol.kind === 'prediction') {
      if (request.symbol !== undefined) {
        extraDataStatus[key] = Object.freeze({ state: 'unavailable', reason: 'series_kind_unavailable' });
        continue;
      }
      throw new CapabilityError('field_unavailable');
    }
    if (request.kind !== undefined && targetSymbol.kind !== request.kind) {
      if (request.symbol !== undefined) {
        extraDataStatus[key] = Object.freeze({ state: 'unavailable', reason: 'kind_mismatch' });
        continue;
      }
      throw new CapabilityError('field_unavailable');
    }
    const adjustment = request.adjustment === undefined || request.adjustment === 'current'
      ? currentAdjustment
      : request.adjustment;
    const requestedCount = request.count ?? deepHistoryBars(request.resolution);
    let response: HistoryResponse;
    try {
      response = await requestHistory(
        targetSymbol,
        request.resolution,
        adjustment,
        requestedCount,
        historyRequestGate.current(),
      );
    } catch (error) {
      if (request.symbol !== undefined) {
        extraDataStatus[key] = Object.freeze({ state: 'unavailable', reason: 'history_unavailable' });
        continue;
      }
      throw error;
    }
    execution.checkpoint();
    if (!sameSelection(expected, readCurrentAiChartSelection())) throw new CapabilityError('context_stale');
    if (response.seriesKind !== 'ohlcv') {
      if (request.symbol !== undefined) {
        extraDataStatus[key] = Object.freeze({ state: 'unavailable', reason: 'series_kind_unavailable' });
        continue;
      }
      throw new CapabilityError('field_unavailable');
    }
    const align = request.align ?? 'none';
    extraData[key] = Object.freeze({
      key,
      symbol: targetSymbol.symbol,
      kind: targetSymbol.kind,
      resolution: request.resolution,
      adjustment,
      aligned: align,
      requestedCount,
      rowCount: response.bars.length,
      shortfall: response.bars.length < requestedCount,
      coverage: 'provider-returned-window',
      finality: 'unknown',
      priceUnit: 'provider-native',
      volumeUnit: 'unknown',
      bars: alignUserIndicatorDataBars(response.bars, bars, align),
      capturedAtMs: Date.now(),
    });
    extraDataStatus[key] = Object.freeze({ state: 'ready' });
  }
  const result = await testUserIndicatorSourceIsolated(prepared.source, inputs, Object.freeze({
    instanceId: `ai-preflight-${prepared.manifest.id}`,
    instrument: indicatorInstrumentMetadata(selection),
    selection: Object.freeze({ symbol: currentSymbol.symbol, resolution: currentResolution, adjustment: currentAdjustment,
      seriesKind: 'ohlcv' as const, marketKind: currentSymbol.kind, providerId: currentSymbol.providerId }),
    theme: appTheme,
    data: Object.freeze(extraData),
    dataStatus: Object.freeze(extraDataStatus),
  }), bars, execution.signal, undefined, {
    depth: prepared.manifest.supports.requires?.depth === true,
    trades: prepared.manifest.supports.requires?.trades ?? [],
  });
  execution.checkpoint();
  return result;
}

async function prepareAiChartNavigation(change: ChartNavigation, execution: ToolExecutionContext): Promise<AsyncToolTransaction> {
  const from = Object.freeze({ ...change.expected });
  const checkExpected = () => {
    execution.checkpoint();
    if (!sameSelection(from, readCurrentAiChartSelection())) throw new CapabilityError('context_stale');
  };
  checkExpected();
  if (!currentHistoryDiagnostics || !currentBars.length || aiDisplayedHistoryGeneration !== from.selectionGeneration
    || aiDrawingPointerDown || activeDrawingId !== null) throw new CapabilityError('data_not_ready');
  const oldSymbol = currentSymbol, oldResolution = currentResolution, oldAdjustment = currentAdjustment;
  let oldResponse: HistoryResponse | undefined;
  const providerId = change.op === 'open' ? change.providerId : currentSymbol.providerId;
  const symbol = change.op === 'open' ? change.symbol : currentSymbol.symbol;
  const kind = change.op === 'open' ? change.kind : currentSymbol.kind;
  if (!isCanonicalMarketSymbol(symbol)) throw new CapabilityError('invalid_request');
  const providers = await invoke<MarketProviderDescriptor[]>('list_market_providers'); checkExpected();
  const provider = providers.find(item => item.id === providerId);
  if (!provider?.enabled || !provider.capabilities.history || !provider.capabilities.venues.includes(symbol.split(':')[0])
    || !provider.capabilities.kinds.includes(kind)) throw new CapabilityError('field_unavailable');
  const resolution = change.op === 'adjustment' ? currentResolution : change.resolution ?? currentResolution;
  const adjustment = change.op === 'resolution' ? currentAdjustment : change.adjustment
    ?? (provider.capabilities.adjustments.includes(currentAdjustment) ? currentAdjustment : 'none');
  if (!provider.capabilities.resolutions.includes(resolution) || !provider.capabilities.adjustments.includes(adjustment)) throw new CapabilityError('field_unavailable');
  const selected = marketSymbolById.get(marketProviderKey(providerId, symbol)) ?? marketSymbolFromCatalog(
    { providerId, symbol, kind, name: symbol }, provider, symbol.split(':')[0]);
  if (selected.kind !== kind) throw new CapabilityError('invalid_request');
  const query = { providerId, symbol, kind, resolution, adjustment, count: INITIAL_HISTORY_BARS };
  const raw = await createNativeMarketQueryPort(invoke).execute({ operation: 'history', ...query }, execution.signal);
  checkExpected(); copyHistory(raw, query);
  const response = normalizeProbabilityHistory(raw as HistoryResponse);
  const selection: SelectionRef = { ...from, provider: providerId, instrument: symbol, resolution, adjustment,
    selectionGeneration: from.selectionGeneration + 1 };
  let started = false;
  return {
    result: { from, selection, ready: true } as unknown as import('./ai-capabilities/contracts').JsonValue,
    async commit() {
      checkExpected();
      if (aiDrawingPointerDown || activeDrawingId !== null) throw new CapabilityError('data_not_ready');
      const snapshot = currentDrawingSnapshot();
      if (snapshot !== null) persistDrawingSnapshot(snapshot, true);
      // Capture the latest live state, not the older state from before network prefetch.
      oldResponse = { symbol: oldSymbol.symbol, seriesKind: currentSeriesKind,
        bars: currentBars.map(bar => ({ ...bar })), diagnostics: { ...currentHistoryDiagnostics! },
        ...(currentSeriesKind === 'probability' ? { points: currentBars.map(bar => ({ time: bar.time, value: bar.close })) } : {}),
        ...(currentQuote ? { quote: structuredClone(currentQuote) } : {}) };
      started = true;
      await openHistory(selected, resolution as Resolution, adjustment, { expected: from, signal: execution.signal, prepared: response });
      execution.checkpoint();
      if (!sameSelection(selection, readCurrentAiChartSelection()) || aiDisplayedHistoryGeneration !== selection.selectionGeneration) throw new CapabilityError('navigation_failed');
    },
    async rollback() {
      // Never undo an intervening user choice. Restore only our own failed transition.
      if (!started || !oldResponse || historyRequestGate.current() !== selection.selectionGeneration) return;
      await openHistory(oldSymbol, oldResolution, oldAdjustment, { prepared: oldResponse });
      if (currentSymbol !== oldSymbol || aiDisplayedHistoryGeneration !== historyRequestGate.current()) throw new CapabilityError('navigation_failed');
    },
  };
}

function createAiChartActionTools() {
  return createChartActionTools({
    current: () => ({ selection: readCurrentAiChartSelection(), ready: aiDisplayedHistoryGeneration === historyRequestGate.current(),
      seriesKind: currentSeriesKind, chartType: currentChartType }),
    prepareNavigation: prepareAiChartNavigation,
    visibleRange() {
      const range = chart.timeScale().getVisibleRange();
      return range && typeof range.from === 'number' && typeof range.to === 'number'
        ? { available: true, from: range.from, to: range.to } : { available: false };
    },
    dataWindow(): JsonValue {
      if (aiDisplayedHistoryGeneration !== historyRequestGate.current()) throw new CapabilityError('data_not_ready');
      const bar = currentBars.find(row => row.time === aiDataWindowTime) ?? currentBars.at(-1);
      if (!bar) return { available: false, seriesKind: currentSeriesKind };
      return currentSeriesKind === 'probability' ? { available: true, seriesKind: currentSeriesKind, time: bar.time, value: bar.close }
        : { available: true, seriesKind: currentSeriesKind, ...bar };
    },
  });
}

function getAiDrawingPort(): NativeDrawingPort {
  aiNativeDrawingPort ??= new NativeDrawingPort({
    context: readCurrentAiChartSelection,
    scope: currentDrawingScope,
    ready: () => drawingsInitialized && !restoringDrawings && !aiDrawingPointerDown && activeDrawingId === null
      && aiDisplayedHistoryGeneration === historyRequestGate.current(),
    locked: () => drawingsLocked,
    priceStep: () => {
      const format = candleSeries.options().priceFormat;
      return 'minMove' in format && typeof format.minMove === 'number' ? format.minMove : 0.01;
    },
    roundPrice: roundPriceToStep,
    attachments: drawingAttachments,
    journal: drawingJournalStorage,
    plugin: lineTools,
    save: snapshot => { persistDrawingSnapshot(snapshot, true); },
    captureUi: () => {
      const history = drawingHistory;
      const checkpoint = history.checkpoint();
      return () => {
        drawingHistory = history;
        history.restore(checkpoint);
        hideDrawingProperties();
        renderDrawingManager();
      };
    },
    changed: () => {
      const snapshot = currentDrawingSnapshot();
      if (snapshot === null) throw new Error('drawing_snapshot_failed');
      drawingHistory.record(snapshot);
      hideDrawingProperties();
      renderDrawingManager();
    },
  });
  return aiNativeDrawingPort;
}

/** Trusted in-process entry. No automatic session, global object, IPC or network. */
export function openAiChartSession(permissions: Readonly<Record<string, Permission>>): CapabilitySession {
  if (!aiChartWorkbenchBridge) {
    const marketHost = createAiMarketQueryHost();
    const marketResults = new MarketResultStore(marketHost);
    aiChartWorkbenchBridge = new ChartReadBridge({
      currentContext: readCurrentAiChartSelection, readState: readCurrentAiChartState, drawings: getAiDrawingPort(), marketResults,
      tools: [...createAiHelpTools(), ...createAiWorkspaceReadTools(marketHost, marketResults), ...createAiWorkspaceActionTools(), ...createAiChartActionTools(), ...createAiIndicatorLibraryTools(), ...createUserDataTools(getUserDataManager()), ...createUserTaskTools(getUserTaskToolHost()), ...createAiResultFileTools()],
    });
  }
  return aiChartWorkbenchBridge.openSession(permissions);
}

function invalidateAiChartSessions(): void {
  aiMcpController.invalidate();
  aiApiController.invalidate();
  aiChartReadBridge?.close();
  aiChartWorkbenchBridge?.invalidateChart();
  aiNativeDrawingPort?.resetTransient();
}

function describeAiChartTools() {
  if (!aiChartWorkbenchBridge) {
    const marketHost = createAiMarketQueryHost();
    const marketResults = new MarketResultStore(marketHost);
    aiChartWorkbenchBridge = new ChartReadBridge({
      currentContext: readCurrentAiChartSelection, readState: readCurrentAiChartState, drawings: getAiDrawingPort(), marketResults,
      tools: [...createAiHelpTools(), ...createAiWorkspaceReadTools(marketHost, marketResults), ...createAiWorkspaceActionTools(), ...createAiChartActionTools(), ...createAiIndicatorLibraryTools(), ...createUserDataTools(getUserDataManager()), ...createUserTaskTools(getUserTaskToolHost()), ...createAiResultFileTools()],
    });
  }
  return aiChartWorkbenchBridge.describe();
}

/** Host extension manager entry. Never exposed on window, as a Tool, or as arbitrary source execution. */
function getUserDataManager(): UserDataManager {
  userDataManager ??= new UserDataManager(createUserDataNative(invoke), id => createAiCapabilityOwner(id));
  return userDataManager;
}

function getUserTaskManager(): UserTaskManager {
  userTaskManager ??= new UserTaskManager(createTaskDataHost({
    providers: () => invoke<MarketProviderDescriptor[]>('list_market_providers'),
    catalog: input => invoke<MarketCatalogPage>('list_market_catalog_page', { ...input, cursor: input.cursor ?? null }),
    loadedSymbols: () => marketSymbols, market: createNativeMarketQueryPort(invoke), data: getUserDataManager,
  }));
  return userTaskManager;
}
function readUserTaskWatchlist(): TaskSymbol[] {
  return watchlistSymbols.flatMap(key => {
    const symbol = marketSymbolById.get(key); return symbol ? [{ providerId: symbol.providerId, symbol: symbol.symbol, kind: symbol.kind, name: symbol.name }] : [];
  });
}
function getUserTaskToolHost(): TaskToolHost {
  return { manager: getUserTaskManager(), library: getUserTaskLibrary, watchlist: readUserTaskWatchlist };
}
function safeResultFilenamePart(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned || 'TradeFlow-result';
}
function createAiResultFileTools() {
  return createResultFileTools({
    port: aiResultFilePort,
    taskArtifact(taskId: string, artifactId: string, requested: 'auto' | 'markdown' | 'csv' | 'json', owner: ToolSessionScope) {
      const manager = getUserTaskManager(), status = manager.status(taskId, owner);
      if (!status.complete) throw new CapabilityError('snapshot_unavailable');
      const artifact = status.artifacts.find(item => item.id === artifactId);
      if (!artifact) throw new CapabilityError('field_unavailable');
      const format: ResultFileFormat = requested === 'auto' ? (artifact.type === 'report' ? 'markdown' : 'csv') : requested;
      let content: string;
      try { content = manager.export(taskId, artifactId, format, owner); }
      catch { throw new CapabilityError('invalid_request'); }
      const extension = format === 'markdown' ? 'md' : format;
      return {
        content,
        format,
        filename: `${safeResultFilenamePart(status.title)}-${safeResultFilenamePart(artifact.title)}.${extension}`,
      };
    },
  });
}
function getUserTaskLibrary(): UserTaskLibrary {
  userTaskLibrary ??= new UserTaskLibrary(getUserTaskManager(),
    new MirroredUserTaskStore(new IndexedDbTaskStore(), workspaceStorage.native), id => createAiCapabilityOwner(id),
    (validated, id, lifetime) => createSavedTaskTool(getUserTaskToolHost(), validated, id, lifetime));
  return userTaskLibrary;
}
async function readUserTaskSources(): Promise<readonly TaskUiSource[]> {
  const providers = await invoke<MarketProviderDescriptor[]>('list_market_providers');
  const sources: TaskUiSource[] = providers.filter(p => p.enabled && p.capabilities.history).map(p => ({
    providerId: p.id, name: p.displayName, venues: p.capabilities.venues, kinds: p.capabilities.kinds,
    resolutions: p.capabilities.resolutions, adjustments: p.capabilities.adjustments, local: false,
    catalogScope: p.capabilities.catalog ? 'provider-catalog' : 'loaded-symbols',
  }));
  const data = getUserDataManager(); await data.initialize();
  for (const source of data.list()) if (source.status === 'connected' && source.manifest) sources.push({
    providerId: `user_data_${source.id}`, name: source.name, ...source.manifest.supports, local: true, catalogScope: 'connector-catalog',
  });
  return sources;
}

/** Trusted modules receive only their own namespace; no runtime code is evaluated here. */
export function createAiCapabilityOwner(id: string): import('./ai-capabilities/registry').CapabilityOwner {
  describeAiChartTools();
  return aiChartWorkbenchBridge!.createOwner(id);
}

function subscribeAiChartTools(listener: () => void): () => void {
  describeAiChartTools();
  return aiChartWorkbenchBridge!.subscribeTools(listener);
}

function readCurrentAiChartSelection(): SelectionRef {
  return {
    appInstanceId: aiChartAppInstanceId, chartId: 'main',
    provider: currentSymbol.providerId, instrument: currentSymbol.symbol,
    resolution: currentResolution, adjustment: currentAdjustment,
    selectionGeneration: historyRequestGate.current(),
  };
}

function readCurrentAiChartState(): ChartReadState {
  return {
    context: readCurrentAiChartSelection(), displayedGeneration: aiDisplayedHistoryGeneration,
    dataRevision: aiChartDataRevision, seriesKind: currentSeriesKind, bars: currentBars,
    timeZone: exchangeTimeZone(), displayTimeZone: activeTradingTimeZone(),
    baseAsset: currentSymbol.baseAsset, quoteAsset: currentSymbol.quoteAsset,
  };
}

/** Internal host port only. Future UI/MCP authentication owns session creation. */
export function openAiChartReadSession(permissions: Readonly<Record<string, Permission>>): CapabilitySession {
  aiChartReadBridge ??= new ChartReadBridge({
    currentContext: readCurrentAiChartSelection, readState: readCurrentAiChartState,
  });
  return aiChartReadBridge.openSession(permissions);
}

function replaceHistorySeries(bars: Bar[], preserveVisibleRange: boolean) {
  const visibleRange = preserveVisibleRange ? chart.timeScale().getVisibleRange() : null;
  deepHistoryNavigationReady = false;
  const previousDisplayedGeneration = aiDisplayedHistoryGeneration;
  aiDisplayedHistoryGeneration = -1;
  currentBars = bars;
  setPrimarySeriesData();
  volumeSeries.setData(bars.map((bar) => ({
    time: bar.time as UTCTimestamp,
    value: bar.volume,
    color: bar.close >= bar.open ? 'rgba(8, 153, 129, .48)' : 'rgba(242, 54, 69, .48)',
  })));
  volumeSeries.applyOptions({ visible: currentSeriesKind === 'ohlcv' && volumeVisible });
  refreshIndicators();
  renderPriceLines();
  renderSeriesMarkers();
  requestAnimationFrame(() => {
    if (visibleRange) chart.timeScale().setVisibleRange(visibleRange);
    else chart.timeScale().setVisibleLogicalRange(initialVisibleLogicalRange(bars.length));
    requestAnimationFrame(() => {
      deepHistoryNavigationReady = true;
    });
  });
  aiChartDataRevision += 1;
  aiDisplayedHistoryGeneration = previousDisplayedGeneration;
}

function showHistory(
  response: HistoryResponse,
  symbol: MarketSymbol,
  resolution: Resolution,
  adjustment: Adjustment,
  source: 'network' | 'memory',
) {
  const previousDrawingScope = currentDrawingScope();
  const nextDrawingScope = drawingScope(symbol.symbol, adjustment, symbol.providerId);
  const priceScopeChanged = currentSymbol.providerId !== symbol.providerId
    || currentSymbol.symbol !== symbol.symbol
    || currentResolution !== resolution
    || currentAdjustment !== adjustment;
  if (previousDrawingScope !== nextDrawingScope) commitDrawingState();
  currentSymbol = symbol;
  currentResolution = resolution;
  currentAdjustment = adjustment;
  syncAdjustmentControls(symbol);
  currentSeriesKind = response.seriesKind;
  chart.timeScale().applyOptions({
    timeVisible: resolutionShowsIntradayTime(currentResolution),
    secondsVisible: false,
  });
  chart.applyOptions({ timeScale: { tickMarkFormatter: formatChartTick } });
  renderTradingTimeControls();
  if (currentSeriesKind === 'probability') activeMarketDataTab = 'rules';
  else if (activeMarketDataTab === 'rules') activeMarketDataTab = 'depth';
  const requiredChartType = currentSeriesKind === 'probability' ? 'line' : chartPreferences.chartType;
  if (currentChartType !== requiredChartType) applyChartType(requiredChartType, false, false);
  currentQuote = response.quote && isUsableQuote(response.quote) ? response.quote : null;
  resetMarketData();
  if (currentQuote) applyQuoteDepth(currentQuote, symbol, resolution);
  if (priceScopeChanged && !priceScaleAuto) {
    priceScaleAuto = true;
    chart.priceScale('right').setAutoScale(true);
  }
  replaceHistorySeries(response.bars, false);
  if (currentPriceScale === 'logarithmic' && response.bars.some((bar) => bar.low <= 0)) {
    showChartToast('当前复权价格含非正数，已切换为常规坐标');
    applyPriceScale('normal');
  }
  if (!drawingsInitialized || previousDrawingScope !== nextDrawingScope) {
    restoreDrawingScope();
    drawingsInitialized = true;
  }
  renderSymbolLogo(instrumentLogo, symbol, true);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-resolution]')) {
    button.classList.toggle('active', button.dataset.resolution === currentResolution);
  }
  renderResolutionControls();
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-adjustment]')) {
    button.classList.toggle('active', button.dataset.adjustment === currentAdjustment);
    button.disabled = (symbol.kind === 'crypto' || symbol.kind === 'prediction') && button.dataset.adjustment === 'qfq';
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-chart-type]')) {
    button.disabled = currentSeriesKind === 'probability' && button.dataset.chartType !== 'line';
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-indicator-id]')) {
    button.disabled = currentSeriesKind === 'probability';
  }
  renderIndicatorPicker();
  const localizedResolution = ui(resolutionLabels[currentResolution]);
  legendSymbol.textContent = currentSeriesKind === 'probability'
    ? `${symbol.name} · ${symbol.prediction?.outcome ?? 'YES'} · ${localizedResolution}`
    : `${symbol.name} · ${localizedResolution} · ${symbol.exchange}${currentAdjustment === 'qfq' ? ` · ${ui('前复权')}` : ''}`;
  const dateInputFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: symbol.kind === 'crypto' || symbol.kind === 'prediction' ? 'UTC' : 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  goToDateInput.min = dateInputFormatter.format(new Date(response.bars[0].time * 1000));
  goToDateInput.max = dateInputFormatter.format(new Date(response.bars.at(-1)!.time * 1000));
  syncPriceLineMenu();
  renderPriceLines();
  renderWatchlist();
  document.querySelector<HTMLDivElement>('#chart')!.setAttribute(
    'aria-label',
    `${symbol.name} ${localizedResolution} ${ui(currentSeriesKind === 'probability' ? '概率走势图' : 'K线图')}`,
  );
  showLatest(response.bars);
  status.className = 'connection-status ready';
  const statusText = source === 'memory'
    ? marketStatusText(symbol, `缓存 · ${response.diagnostics.host}`)
    : marketStatusText(symbol, `${response.diagnostics.host} · ${response.diagnostics.latencyMs}ms`);
  setStatusLabel(status, statusText);
  currentHistoryDiagnostics = { ...response.diagnostics };
  aiDataWindowTime = null;
  aiDisplayedHistoryGeneration = historyRequestGate.current();
}

function clearDeepHistoryTimer() {
  if (deepHistoryTimer !== undefined) window.clearTimeout(deepHistoryTimer);
  deepHistoryTimer = undefined;
  deepHistoryTimerKey = '';
}

async function loadDeepHistory(
  symbol: MarketSymbol,
  resolution: Resolution,
  adjustment: Adjustment,
  generation = historyRequestGate.current(),
) {
  const cacheKey = marketHistoryCacheKey(symbol, resolution, adjustment);
  if (!historyRequestGate.isCurrent(generation)
    || !isCurrentMarketSelection(symbol, resolution, adjustment)) return;
  if (getHistoryCache(symbol, resolution, adjustment)?.deep
    || deepHistoryLoading.get(cacheKey) === generation) return;
  deepHistoryLoading.set(cacheKey, generation);
  try {
    const response = await requestHistory(
      symbol,
      resolution,
      adjustment,
      deepHistoryBars(resolution),
      generation,
    );
    if (!historyRequestGate.isCurrent(generation)
      || !isCurrentMarketSelection(symbol, resolution, adjustment)) return;
    const cached = getHistoryCache(symbol, resolution, adjustment);
    const cachedLastTime = cached?.value.bars.at(-1)?.time ?? 0;
    const responseLastTime = response.bars.at(-1)?.time ?? 0;
    if (responseLastTime < cachedLastTime) {
      console.warn('market.history.deep_stale', {
        symbol: symbol.symbol,
        resolution,
        adjustment,
        cachedLastTime,
        responseLastTime,
      });
      return;
    }
    const displayResponse = {
      ...response,
      bars: mergeDeepHistoryWithLiveTail(
        response.bars,
        currentBars,
        realtimeBarRequestId === activeRealtimeRequestId,
      ),
    };
    historyCache.set(cacheKey, displayResponse, true);
    replaceHistorySeries(displayResponse.bars, true);
    showLatest(displayResponse.bars);
    console.info('market.history.deep_ready', {
      symbol: symbol.symbol,
      providerId: symbol.providerId,
      resolution,
      adjustment,
      bars: response.bars.length,
      latencyMs: response.diagnostics.latencyMs,
    });
  } catch (error) {
    if (!historyRequestGate.isCurrent(generation)
      || !isCurrentMarketSelection(symbol, resolution, adjustment)) return;
    console.error('market.history.deep_error', {
      symbol: symbol.symbol,
      resolution,
      adjustment,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (deepHistoryLoading.get(cacheKey) === generation) deepHistoryLoading.delete(cacheKey);
    if (historyRequestGate.isCurrent(generation)
      && isCurrentMarketSelection(symbol, resolution, adjustment)) scheduleLatestPoll(0);
  }
}

function scheduleDeepHistory(
  symbol: MarketSymbol,
  resolution: Resolution,
  adjustment: Adjustment,
  delayMs = DEEP_HISTORY_DELAY_MS,
) {
  const cacheKey = marketHistoryCacheKey(symbol, resolution, adjustment);
  const generation = historyRequestGate.current();
  if (getHistoryCache(symbol, resolution, adjustment)?.deep
    || deepHistoryLoading.get(cacheKey) === generation) return;
  const timerKey = `${cacheKey}|g${generation}`;
  if (deepHistoryTimer !== undefined && deepHistoryTimerKey === timerKey) return;
  clearDeepHistoryTimer();
  deepHistoryTimerKey = timerKey;
  deepHistoryTimer = window.setTimeout(() => {
    deepHistoryTimer = undefined;
    deepHistoryTimerKey = '';
    void loadDeepHistory(symbol, resolution, adjustment, generation);
  }, delayMs);
}

async function openHistory(
  requestedSymbol = resolveInputSymbol(),
  requestedResolution: Resolution = currentResolution,
  requestedAdjustment: Adjustment = currentAdjustment,
  navigation?: { expected?: SelectionRef; signal?: AbortSignal; prepared: HistoryResponse },
) {
  if (navigation?.signal?.aborted) throw new CapabilityError('cancelled');
  if (navigation?.expected && !sameSelection(navigation.expected, readCurrentAiChartSelection())) throw new CapabilityError('context_stale');
  const match = requestedSymbol;
  if (!match) {
    errorLayer.hidden = false;
    errorLayer.textContent = '没有找到这个行情品种';
    return;
  }
  if (match.providerId === 'none') {
    showNoMarketProviderState();
    return;
  }
  if (!activeMarketProviderIds.has(match.providerId)) {
    errorLayer.hidden = false;
    errorLayer.textContent = `${match.providerDisplayName || match.providerId} 数据源未启用`;
    status.className = 'connection-status error';
    setStatusLabel(status, '数据源未启用');
    return;
  }
  hideNoMarketProviderState();
  if (match.kind === 'crypto' || match.kind === 'prediction') requestedAdjustment = 'none';
  const provider = marketProviderById.get(match.providerId);
  if (!provider?.capabilities.adjustments.includes(requestedAdjustment)) requestedAdjustment = 'none';
  invalidateAiChartSessions();
  const generation = historyRequestGate.begin();
  try {
    await invoke('activate_history_incarnation', {
      requestIncarnation: historyRequestIncarnation(generation),
    });
  } catch (error) {
    if (!historyRequestGate.isCurrent(generation)) return;
    console.error('market.history.incarnation_activate_error', {
      generation,
      error: error instanceof Error ? error.message : String(error),
    });
    if (navigation) throw new CapabilityError('navigation_failed');
    return;
  }
  if (navigation?.signal?.aborted) throw new CapabilityError('cancelled');
  if (!historyRequestGate.isCurrent(generation)) return;
  stopRealtimeMarket();
  clearDeepHistoryTimer();
  if (latestPollTimer !== undefined) window.clearTimeout(latestPollTimer);
  latestPollTimer = undefined;
  errorLayer.hidden = true;
  const cacheKey = marketHistoryCacheKey(match, requestedResolution, requestedAdjustment);
  const cached = navigation ? { value: navigation.prepared } : getHistoryCache(match, requestedResolution, requestedAdjustment);
  if (cached) {
    loadingLayer.hidden = true;
    if (navigation) historyCache.set(cacheKey, cached.value, false);
    showHistory(cached.value, match, requestedResolution, requestedAdjustment, 'memory');
    void refreshMissingHistoryQuote(
      cached.value,
      match,
      requestedResolution,
      requestedAdjustment,
      generation,
    );
    void refreshTdxRecentTrades(
      match,
      requestedResolution,
      requestedAdjustment,
      generation,
    );
    void startRealtimeMarket(match, requestedResolution, generation);
    console.info('market.history.display', {
      symbol: match.symbol,
      resolution: requestedResolution,
      adjustment: requestedAdjustment,
      source: 'memory',
      bars: cached.value.bars.length,
    });
    scheduleLatestPoll();
    return;
  }
  void startRealtimeMarket(match, requestedResolution, generation);
  loadingLayer.hidden = false;
  status.className = 'connection-status loading';
  setStatusLabel(status, match.providerId === 'tdx'
    ? `正在打开 ${match.code}`
    : `正在打开 ${match.providerDisplayName} · ${match.code}`);
  const startedAt = performance.now();
  let networkHistoryDisplayed = false;
  try {
    const response = await requestHistory(
      match,
      requestedResolution,
      requestedAdjustment,
      INITIAL_HISTORY_BARS,
      generation,
    );
    if (!historyRequestGate.isCurrent(generation)) return;
    historyCache.set(cacheKey, response, false);
    showHistory(response, match, requestedResolution, requestedAdjustment, 'network');
    networkHistoryDisplayed = true;
    void refreshMissingHistoryQuote(
      response,
      match,
      requestedResolution,
      requestedAdjustment,
      generation,
    );
    void refreshTdxRecentTrades(
      match,
      requestedResolution,
      requestedAdjustment,
      generation,
    );
    console.info('market.history.display', {
      symbol: match.symbol,
      resolution: requestedResolution,
      adjustment: requestedAdjustment,
      source: 'network',
      bars: response.bars.length,
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  } catch (error) {
    if (!historyRequestGate.isCurrent(generation)) return;
    stopRealtimeMarket();
    const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error);
    errorLayer.hidden = false;
    errorLayer.textContent = `${match.name} 加载失败，图表保留上一份有效数据 · ${message}`;
    status.className = 'connection-status error';
    setStatusLabel(status, marketStatusText(match, '连接异常'));
  } finally {
    if (historyRequestGate.isCurrent(generation)) {
      loadingLayer.hidden = true;
      scheduleLatestPoll(networkHistoryDisplayed && match.realtime ? 0 : undefined);
    }
  }
}

async function refreshCurrentHistory() {
  historyCache.delete(marketHistoryCacheKey(currentSymbol, currentResolution, currentAdjustment));
  console.info('market.history.manual_refresh', {
    providerId: currentSymbol.providerId,
    symbol: currentSymbol.symbol,
    resolution: currentResolution,
    adjustment: currentAdjustment,
  });
  await openHistory(currentSymbol, currentResolution, currentAdjustment);
}

async function recoverCurrentHistoryFrom(
  trustedBarTime: number,
  trigger: 'reconnect' | 'visibility',
  expectedRealtimeRequestId = activeRealtimeRequestId,
) {
  if (!Number.isFinite(trustedBarTime) || currentBars.length === 0) return false;
  const generation = historyRequestGate.current();
  const symbol = currentSymbol;
  const resolution = currentResolution;
  const adjustment = currentAdjustment;
  const recoveryCounts = realtimeRecoveryHistoryCounts(deepHistoryBars(resolution));
  const barrierToken = realtimePollBarrier.begin();
  const stillCurrent = () => historyRequestGate.isCurrent(generation)
    && isCurrentMarketSelection(symbol, resolution, adjustment)
    && activeRealtimeRequestId === expectedRealtimeRequestId;
  try {
    let response: HistoryResponse | null = null;
    let requestedCount = 0;
    let overlapsTrustedBar = false;
    for (const count of recoveryCounts) {
      requestedCount = count;
      response = await requestHistory(symbol, resolution, adjustment, count, generation);
      if (!stillCurrent()) return false;
      if (historyOverlapsTrustedBar(response.bars, trustedBarTime)) {
        overlapsTrustedBar = true;
        break;
      }
    }
    if (!response || !stillCurrent()) return false;
    if (!overlapsTrustedBar) {
      console.warn('market.history.recovery_incomplete', {
        providerId: symbol.providerId,
        symbol: symbol.symbol,
        resolution,
        adjustment,
        trigger,
        trustedBarTime,
        requestedCount,
        earliestReturnedTime: response.bars[0]?.time,
      });
      return false;
    }

    const recoveryBars = realtimePollBarrier.filter(barrierToken, response.bars);
    const reconciliation = reconcileBars(currentBars, recoveryBars);
    commitBarReconciliation(reconciliation, 'reconciliation');
    const cacheKey = marketHistoryCacheKey(symbol, resolution, adjustment);
    const cached = getHistoryCache(symbol, resolution, adjustment);
    historyCache.set(
      cacheKey,
      {
        ...response,
        bars: [...currentBars],
        quote: cached?.value.quote,
      },
      cached?.deep ?? false,
    );
    showCurrentSnapshot();
    console.info('market.history.recovered', {
      providerId: symbol.providerId,
      symbol: symbol.symbol,
      resolution,
      adjustment,
      trigger,
      trustedBarTime,
      requestedCount,
      recoveredBars: reconciliation.mutations.length,
      insertedHistoricalBars: reconciliation.mutations.filter((mutation) => mutation.kind === 'insert' && mutation.historical).length,
      correctedHistoricalBars: reconciliation.mutations.filter((mutation) => mutation.kind === 'replace' && mutation.historical).length,
    });
    return true;
  } catch (error) {
    if (stillCurrent()) {
      console.warn('market.history.recovery_failed', {
        providerId: symbol.providerId,
        symbol: symbol.symbol,
        resolution,
        adjustment,
        trigger,
        trustedBarTime,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  } finally {
    realtimePollBarrier.end(barrierToken);
  }
}

async function pollLatestBars() {
  if (currentSymbol.providerId === 'none' || !activeMarketProviderIds.has(currentSymbol.providerId)
    || document.hidden || latestPollInFlight || currentBars.length === 0) return;
  const generation = historyRequestGate.current();
  const symbol = currentSymbol;
  const resolution = currentResolution;
  const adjustment = currentAdjustment;
  const pollBarrierToken = realtimePollBarrier.begin();
  latestPollInFlight = true;
  try {
    const response = await fetchHistoryResponse(symbol, resolution, adjustment, 2, true, generation);
    if (!historyRequestGate.isCurrent(generation)
      || !isCurrentMarketSelection(symbol, resolution, adjustment)) return;
    const historyQuote = response.quote && isUsableQuote(response.quote) ? response.quote : null;
    let latestQuote = historyQuote;
    let quoteDegraded = false;
    if (shouldFetchStandaloneQuote(response.quote != null, providerSupportsQuote(symbol))) {
      try {
        latestQuote = await requestStandaloneQuote(symbol, generation);
      } catch (error) {
        if (!historyRequestGate.isCurrent(generation)
          || !isCurrentMarketSelection(symbol, resolution, adjustment)) return;
        quoteDegraded = true;
        console.warn('market.latest.quote_fallback_failed', {
          providerId: symbol.providerId,
          symbol: symbol.symbol,
          generation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (!historyRequestGate.isCurrent(generation)
        || !isCurrentMarketSelection(symbol, resolution, adjustment)) return;
      if (!latestQuote) quoteDegraded = true;
    } else if (response.quote != null && !historyQuote) {
      console.warn('market.latest.quote_invalid', {
        providerId: symbol.providerId,
        symbol: symbol.symbol,
        generation,
      });
    }
    const pollBars = realtimePollBarrier.filter(pollBarrierToken, response.bars);
    if (pollBars.length !== response.bars.length) {
      console.debug('market.latest.stale_poll_bar_skipped', {
        providerId: symbol.providerId,
        symbol: symbol.symbol,
        resolution,
        skipped: response.bars.length - pollBars.length,
      });
    }
    const previousLatestTime = currentBars.at(-1)?.time;
    const reconciliation = reconcileBars(currentBars, pollBars);
    const receivedAtMs = Date.now();
    const realtimeUpdates = new Map<number, IndicatorRealtimeBarUpdate>();
    const changedPollTimes = new Set(reconciliation.changedTimes);
    for (const bar of pollBars) {
      if (!changedPollTimes.has(bar.time)) continue;
      realtimeUpdates.set(bar.time, { barTime: bar.time, closed: false, eventTimeMs: receivedAtMs });
    }
    const latestTime = reconciliation.bars.at(-1)?.time;
    if (previousLatestTime !== undefined && latestTime !== undefined && latestTime > previousLatestTime) {
      realtimeUpdates.set(previousLatestTime, {
        barTime: previousLatestTime,
        closed: true,
        closedBy: 'newer-bar',
        eventTimeMs: receivedAtMs,
      });
    } else if (symbol.kind !== 'crypto'
      && latestTime !== undefined
      && marketPollPlan(new Date(), false, false).state === 'closed') {
      realtimeUpdates.set(latestTime, {
        barTime: latestTime,
        closed: true,
        closedBy: 'session-end',
        eventTimeMs: receivedAtMs,
      });
    }
    commitBarReconciliation(
      reconciliation,
      reconciliation.mutations.some((mutation) => !mutation.historical) ? 'realtime' : 'reconciliation',
      [...realtimeUpdates.values()].sort((left, right) => left.barTime - right.barTime),
    );
    const cacheKey = marketHistoryCacheKey(symbol, resolution, adjustment);
    const cached = getHistoryCache(symbol, resolution, adjustment);
    historyCache.set(
      cacheKey,
      { ...response, bars: [...currentBars], quote: latestQuote ?? undefined },
      cached?.deep ?? false,
    );
    if (latestQuote) {
      currentQuote = latestQuote;
      applyQuoteDepth(latestQuote, symbol, resolution);
      renderPriceLines();
    }
    await refreshTdxRecentTrades(symbol, resolution, adjustment, generation);
    showCurrentSnapshot();
    status.className = 'connection-status ready';
    const statusText = quoteDegraded
      ? marketStatusText(symbol, `${response.diagnostics.host} · 报价降级，保留 K 线`)
      : marketStatusText(symbol, `${response.diagnostics.host} · ${response.diagnostics.latencyMs}ms`);
    setStatusLabel(status, statusText);
  } catch (error) {
    if (historyRequestGate.isCurrent(generation)
      && isCurrentMarketSelection(symbol, resolution, adjustment)) {
      console.error('market.latest.error', {
        symbol: symbol.symbol,
        resolution,
        adjustment,
        error: error instanceof Error ? error.message : String(error),
      });
      status.className = 'connection-status error';
      setStatusLabel(status, marketStatusText(symbol, '实时更新暂停，保留最后数据'));
    }
  } finally {
    realtimePollBarrier.end(pollBarrierToken);
    latestPollInFlight = false;
  }
}

function stopRealtimeMarket() {
  const requestId = ++realtimeRequestSequence;
  activeRealtimeRequestId = requestId;
  activeRealtimeProviderId = '';
  activeRealtimeProviderDisplayName = '';
  lastRealtimeSequenceByChannel.clear();
  lastIndicatorAggregateTradeId = null;
  realtimeConnected = false;
  realtimeRecoveryAnchorTime = null;
  void invoke('stop_realtime_market', { requestId }).catch((error) => {
    console.error('market.realtime.stop_error', { requestId, error: String(error) });
  });
}

async function startRealtimeMarket(
  symbol: MarketSymbol,
  resolution: Resolution,
  historyGeneration: number,
) {
  if (!symbol.realtime) return;
  const requestId = ++realtimeRequestSequence;
  activeRealtimeRequestId = requestId;
  activeRealtimeProviderId = realtimeProviderId(symbol);
  activeRealtimeProviderDisplayName = symbol.providerDisplayName;
  lastRealtimeSequenceByChannel.clear();
  lastIndicatorAggregateTradeId = null;
  realtimeConnected = false;
  realtimeRecoveryAnchorTime = null;
  await realtimeListenersReady;
  if (!historyRequestGate.isCurrent(historyGeneration)) return;
  try {
    await invoke('start_realtime_market', {
      requestId,
      providerId: symbol.providerId,
      symbol: symbol.symbol,
      kind: symbol.kind,
      resolution,
    });
  } catch (error) {
    if (activeRealtimeRequestId !== requestId) return;
    console.error('market.realtime.start_error', {
      requestId,
      symbol: symbol.symbol,
      resolution,
      error: String(error),
    });
    status.className = 'connection-status error';
    setStatusLabel(status, marketStatusText(symbol, '实时连接失败，已使用轮询'));
    scheduleLatestPoll(0);
  }
}

function applyRealtimeBar(event: RealtimeBarEvent<Bar>): boolean {
  if (!matchesRealtimeSelection(
    event,
    activeRealtimeRequestId,
    currentSymbol.symbol,
    currentResolution,
    activeRealtimeProviderId,
  )) return false;
  const authoritativeClose = event.closed && event.source === 'kline';
  if (!canApplyRealtimeBar(currentBars, event.bar, authoritativeClose)) {
    console.warn('market.realtime.stale_bar', {
      symbol: event.symbol,
      resolution: event.resolution,
      incomingTime: event.bar.time,
      latestTime: currentBars.at(-1)?.time,
    });
    return false;
  }

  const latestTime = currentBars.at(-1)?.time;
  const historicalClose = authoritativeClose
    && latestTime !== undefined
    && event.bar.time < latestTime
    && currentBars.at(-2)?.time === event.bar.time;
  const reconciliation = reconcileBars(currentBars, [event.bar]);
  if (historicalClose) {
    console.debug('market.realtime.late_close_applied', {
      symbol: event.symbol,
      resolution: event.resolution,
      closedBarTime: event.bar.time,
      latestBarTime: latestTime,
    });
  }
  commitBarReconciliation(reconciliation, 'realtime', [], false);
  scheduleRealtimeIndicators(event);
  currentQuote = null;
  showLatest(currentBars);
  realtimeConnected = true;
  realtimeBarRequestId = event.requestId;
  const now = performance.now();
  if (now - lastRealtimeStatusRenderAt >= 1_000) {
    lastRealtimeStatusRenderAt = now;
    status.className = 'connection-status ready';
    const providerName = activeRealtimeProviderDisplayName || event.providerId;
    const statusText = `实时 · ${providerName} · ${event.source} · ${realtimeTimeFormatter.format(new Date(event.eventTimeMs))}`;
    setStatusLabel(status, statusText);
    status.title = `最后一次 ${providerName} ${event.source} 更新：${realtimeTimeFormatter.format(new Date(event.eventTimeMs))}`;
  }
  return true;
}

let pendingRealtimeBars = new Map<number, {
  event: RealtimeBarEvent<Bar>;
  queuedAt: number;
}>();
let realtimeFrameId: number | undefined;
let realtimeFrameFallbackTimerId: number | undefined;
let marketDataTimerId: number | undefined;
let lastMarketDataRenderAt = 0;
let lastRealtimeStatusRenderAt = 0;
let realtimeIndicatorTimerId: number | undefined;
const pendingRealtimeIndicatorUpdates = new Map<number, IndicatorRealtimeBarUpdate>();
let realtimeHealthStartedAt = performance.now();
let realtimeHealthBarsReceived = 0;
let realtimeHealthBarsApplied = 0;
let realtimeHealthBarsCoalesced = 0;
let realtimeHealthDepthReceived = 0;
let realtimeHealthTradesReceived = 0;
let realtimeHealthMarketRenders = 0;
let realtimeHealthMaxQueueMs = 0;
let realtimeHealthMaxEventAgeMs = 0;
let realtimeHealthMaxFrameMs = 0;
let realtimeHealthMaxArrivalGapMs = 0;
let realtimeHealthMaxApplyGapMs = 0;
let realtimeHealthLastArrivalAt = 0;
let realtimeHealthLastApplyAt = 0;
let realtimeHealthRequestId = 0;
let realtimeHealthFallbackFlushes = 0;

function resetRealtimeHealthWindow(now: number, resetContinuity = false) {
  realtimeHealthStartedAt = now;
  realtimeHealthBarsReceived = 0;
  realtimeHealthBarsApplied = 0;
  realtimeHealthBarsCoalesced = 0;
  realtimeHealthDepthReceived = 0;
  realtimeHealthTradesReceived = 0;
  realtimeHealthMarketRenders = 0;
  realtimeHealthMaxQueueMs = 0;
  realtimeHealthMaxEventAgeMs = 0;
  realtimeHealthMaxFrameMs = 0;
  realtimeHealthMaxArrivalGapMs = 0;
  realtimeHealthMaxApplyGapMs = 0;
  realtimeHealthFallbackFlushes = 0;
  if (resetContinuity) {
    realtimeHealthLastArrivalAt = 0;
    realtimeHealthLastApplyAt = 0;
    realtimeHealthRequestId = 0;
  }
}

function scheduleRealtimeIndicators(event: RealtimeBarEvent<Bar>) {
  if (!indicatorRuntime.list().some((instance) => instance.running)
    && !userIndicatorRuntime.list().some((instance) => instance.running)) return;
  const update: IndicatorRealtimeBarUpdate = event.closed && event.source === 'kline'
    ? { barTime: event.bar.time, closed: true, closedBy: 'exchange', eventTimeMs: event.eventTimeMs }
    : { barTime: event.bar.time, closed: false, eventTimeMs: event.eventTimeMs };
  const existing = pendingRealtimeIndicatorUpdates.get(event.bar.time);
  if (!existing?.closed || update.closed) pendingRealtimeIndicatorUpdates.set(event.bar.time, update);
  if (realtimeIndicatorTimerId !== undefined) return;
  realtimeIndicatorTimerId = window.setTimeout(() => {
    realtimeIndicatorTimerId = undefined;
    const pendingUpdates = [...pendingRealtimeIndicatorUpdates.values()]
      .sort((left, right) => left.barTime - right.barTime);
    pendingRealtimeIndicatorUpdates.clear();
    if (pendingUpdates.length > 0) {
      refreshIndicators(pendingUpdates.map((item) => item.barTime), 'realtime', pendingUpdates);
    }
  }, 250);
}

function reportRealtimeRenderHealth(now: number) {
  if (now - realtimeHealthStartedAt < 10_000) return;
  void invoke('report_realtime_render_health', {
    requestId: activeRealtimeRequestId,
    symbol: currentSymbol.symbol,
    resolution: currentResolution,
    barsReceived: realtimeHealthBarsReceived,
    barsApplied: realtimeHealthBarsApplied,
    barsCoalesced: realtimeHealthBarsCoalesced,
    depthReceived: realtimeHealthDepthReceived,
    tradesReceived: realtimeHealthTradesReceived,
    marketRenders: realtimeHealthMarketRenders,
    maxQueueMs: Math.round(realtimeHealthMaxQueueMs * 10) / 10,
    maxEventAgeMs: Math.round(realtimeHealthMaxEventAgeMs),
    maxFrameMs: Math.round(realtimeHealthMaxFrameMs * 10) / 10,
    maxArrivalGapMs: Math.round(realtimeHealthMaxArrivalGapMs),
    maxApplyGapMs: Math.round(realtimeHealthMaxApplyGapMs),
    fallbackFlushes: realtimeHealthFallbackFlushes,
  }).catch((error) => console.warn('market.realtime.render_health_error', { error: String(error) }));
  resetRealtimeHealthWindow(now);
}

function flushMarketDataEvents(now: number) {
  const depth = pendingRealtimeDepth;
  pendingRealtimeDepth = null;
  if (depth) latestDepth = depth;
  if (pendingRealtimeTrades.length) {
    const newestKnownId = recentTrades[0]?.tradeId ?? -1;
    const fresh = pendingRealtimeTrades.filter((trade) => trade.tradeId > newestKnownId);
    recentTrades = [...fresh.reverse(), ...recentTrades].slice(0, 100);
    pendingRealtimeTrades = [];
  }
  lastMarketDataRenderAt = now;
  if (!marketDataPanel.hidden) renderMarketDataPanel();
  realtimeHealthMarketRenders += 1;
}

function scheduleMarketDataTimer(delayMs: number) {
  if (marketDataTimerId !== undefined) return;
  marketDataTimerId = window.setTimeout(() => {
    marketDataTimerId = undefined;
    queueRealtimeFrame();
  }, delayMs);
}

function cancelRealtimeFrameSchedule() {
  if (realtimeFrameId !== undefined) window.cancelAnimationFrame(realtimeFrameId);
  if (realtimeFrameFallbackTimerId !== undefined) window.clearTimeout(realtimeFrameFallbackTimerId);
  realtimeFrameId = undefined;
  realtimeFrameFallbackTimerId = undefined;
}

function flushRealtimeFrame(now: number, fallback = false) {
  cancelRealtimeFrameSchedule();
  if (fallback) realtimeHealthFallbackFlushes += 1;
  const frameStartedAt = performance.now();
  const pendingBars = [...pendingRealtimeBars.values()]
    .sort((left, right) => left.event.bar.time - right.event.bar.time);
  pendingRealtimeBars = new Map();
  const appliedEvents: RealtimeBarEvent<Bar>[] = [];
  for (const { event: pendingBar, queuedAt } of pendingBars) {
    if (applyRealtimeBar(pendingBar)) {
      appliedEvents.push(pendingBar);
      if (realtimeHealthLastApplyAt > 0) {
        realtimeHealthMaxApplyGapMs = Math.max(
          realtimeHealthMaxApplyGapMs,
          frameStartedAt - realtimeHealthLastApplyAt,
        );
      }
      realtimeHealthLastApplyAt = frameStartedAt;
      realtimeHealthBarsApplied += 1;
      realtimeHealthMaxQueueMs = Math.max(realtimeHealthMaxQueueMs, frameStartedAt - queuedAt);
      realtimeHealthMaxEventAgeMs = Math.max(realtimeHealthMaxEventAgeMs, Date.now() - pendingBar.eventTimeMs);
    }
  }
  const lastAppliedEvent = appliedEvents.at(-1);
  const closedBoundary = lastAppliedEvent
    ? appliedEvents.find((event) => event.closed && event.bar.time < lastAppliedEvent.bar.time)
    : undefined;
  if (closedBoundary) {
    console.debug('market.realtime.bar_boundary_applied', {
      symbol: closedBoundary.symbol,
      resolution: closedBoundary.resolution,
      closedBarTime: closedBoundary.bar.time,
      nextBarTime: lastAppliedEvent?.bar.time,
      batchSize: appliedEvents.length,
    });
  }
  if (pendingRealtimeDepth || pendingRealtimeTrades.length) {
    const delay = marketDataRenderDelay(now, lastMarketDataRenderAt);
    if (delay === 0) flushMarketDataEvents(now);
    else scheduleMarketDataTimer(delay);
  }
  realtimeHealthMaxFrameMs = Math.max(realtimeHealthMaxFrameMs, performance.now() - frameStartedAt);
  reportRealtimeRenderHealth(now);
}

function queueRealtimeFrame() {
  if (realtimeFrameId !== undefined || realtimeFrameFallbackTimerId !== undefined) return;
  realtimeFrameId = window.requestAnimationFrame((now) => flushRealtimeFrame(now));
  realtimeFrameFallbackTimerId = window.setTimeout(() => {
    flushRealtimeFrame(performance.now(), true);
  }, REALTIME_FRAME_FALLBACK_MS);
}

function queueRealtimeBar(event: RealtimeBarEvent<Bar>) {
  if (!matchesRealtimeSelection(
    event,
    activeRealtimeRequestId,
    currentSymbol.symbol,
    currentResolution,
    activeRealtimeProviderId,
  )) return;
  if (!acceptsRealtimeSequence(event, 'bar')) return;
  realtimePollBarrier.markRealtime(event.bar.time);
  const receivedAt = performance.now();
  if (realtimeHealthRequestId !== event.requestId) {
    realtimeHealthRequestId = event.requestId;
    realtimeHealthLastArrivalAt = 0;
    realtimeHealthLastApplyAt = 0;
  }
  if (realtimeHealthLastArrivalAt > 0) {
    realtimeHealthMaxArrivalGapMs = Math.max(
      realtimeHealthMaxArrivalGapMs,
      receivedAt - realtimeHealthLastArrivalAt,
    );
  }
  realtimeHealthLastArrivalAt = receivedAt;
  realtimeHealthBarsReceived += 1;
  const existing = pendingRealtimeBars.get(event.bar.time);
  if (existing) realtimeHealthBarsCoalesced += 1;
  pendingRealtimeBars.set(event.bar.time, {
    event: existing && existing.event.closed && !event.closed
      ? existing.event
      : event,
    queuedAt: existing?.queuedAt ?? receivedAt,
  });
  queueRealtimeFrame();
}

function applyRealtimeStatus(event: RealtimeStatusEvent) {
  if (!matchesRealtimeSelection(
    event,
    activeRealtimeRequestId,
    currentSymbol.symbol,
    currentResolution,
    activeRealtimeProviderId,
  )) return;
  if (event.status === 'connected') {
    indicatorMarketRouter.updateConnection('available', event.message);
    realtimeConnected = true;
    status.className = 'connection-status ready';
    const providerName = activeRealtimeProviderDisplayName || event.providerId;
    const statusText = `实时 · ${providerName}${currentSymbol.kind === 'prediction' ? ' · 轮询' : ' WS'}`;
    setStatusLabel(status, statusText);
    status.title = event.message ?? `${providerName} 实时行情已连接`;
    const recoveryAnchor = realtimeRecoveryAnchorTime;
    if (recoveryAnchor !== null) {
      void recoverCurrentHistoryFrom(recoveryAnchor, 'reconnect', event.requestId).then((recovered) => {
        if (recovered
          && realtimeRecoveryAnchorTime === recoveryAnchor
          && activeRealtimeRequestId === event.requestId) {
          realtimeRecoveryAnchorTime = null;
        }
      });
    }
    scheduleLatestPoll(60_000);
    return;
  }
  realtimeConnected = false;
  lastIndicatorAggregateTradeId = null;
  indicatorMarketRouter.updateConnection(
    event.status === 'connecting' ? 'connecting' : 'degraded',
    event.message,
  );
  status.className = 'connection-status loading';
  const providerName = activeRealtimeProviderDisplayName || event.providerId;
  const prediction = currentSymbol.kind === 'prediction';
  const statusText = event.status === 'connecting'
    ? `正在连接 ${providerName}${prediction ? ' 公开行情' : ' WS'}`
    : `实时重连中 · ${providerName}${prediction ? ' · 轮询' : ' · 轮询保护'}`;
  setStatusLabel(status, statusText);
  status.title = event.message ?? `正在建立 ${providerName}${prediction ? ' 公开行情' : ' WebSocket 连接'}`;
  if (event.status === 'reconnecting') {
    realtimeRecoveryAnchorTime ??= currentBars.at(-1)?.time ?? null;
    scheduleLatestPoll(0);
  }
}

let pendingRealtimeDepth: RealtimeDepthEvent | null = null;
let pendingRealtimeTrades: RealtimeTradeEvent[] = [];

function queueRealtimeDepth(event: RealtimeDepthEvent) {
  if (!matchesRealtimeSelection(
    event,
    activeRealtimeRequestId,
    currentSymbol.symbol,
    currentResolution,
    activeRealtimeProviderId,
  )) return;
  if (!acceptsRealtimeSequence(event, 'depth')) return;
  realtimeHealthDepthReceived += 1;
  indicatorMarketRouter.pushDepth({
    providerId: event.providerId,
    symbol: event.symbol,
    ...(event.providerId.startsWith('binance') ? {} : { exchangeTimeMs: event.eventTimeMs }),
    receivedTimeMs: Date.now(),
    sequence: event.sequence,
    bids: event.bids,
    asks: event.asks,
  });
  pendingRealtimeDepth = event;
  const delay = marketDataRenderDelay(performance.now(), lastMarketDataRenderAt);
  if (delay === 0) queueRealtimeFrame();
  else scheduleMarketDataTimer(delay);
}

function queueRealtimeTrade(event: RealtimeTradeEvent) {
  if (!matchesRealtimeSelection(
    event,
    activeRealtimeRequestId,
    currentSymbol.symbol,
    currentResolution,
    activeRealtimeProviderId,
  )) return;
  if (!acceptsRealtimeSequence(event, 'trade')) return;
  realtimeHealthTradesReceived += 1;
  if (event.providerId === 'binance_spot' || event.providerId === 'binance_usdm') {
    const dropped = aggregateTradeGap(lastIndicatorAggregateTradeId, event.firstTradeId, event.lastTradeId);
    if (dropped !== null && dropped > 0) {
      indicatorMarketRouter.reportTradeGap({ restartAtKnown: true, dropped });
      console.warn('market.realtime.trade_gap', {
        providerId: event.providerId,
        symbol: event.symbol,
        previousLastTradeId: lastIndicatorAggregateTradeId,
        firstTradeId: event.firstTradeId,
        lastTradeId: event.lastTradeId,
        dropped,
      });
    }
    if (Number.isSafeInteger(event.lastTradeId) && event.lastTradeId! >= 0) {
      lastIndicatorAggregateTradeId = Math.max(lastIndicatorAggregateTradeId ?? -1, event.lastTradeId!);
    }
  }
  indicatorMarketRouter.pushTrade({
    providerId: event.providerId,
    symbol: event.symbol,
    eventKind: event.providerId.startsWith('binance') ? 'aggregate-trade' : 'trade',
    tradeId: event.tradeId,
    firstTradeId: event.firstTradeId ?? undefined,
    lastTradeId: event.lastTradeId ?? undefined,
    exchangeTimeMs: event.tradeTimeMs,
    receivedTimeMs: Date.now(),
    barTime: event.barTime,
    price: event.price,
    quantity: event.quantity,
    quantityKnown: true,
    aggressorSide: event.side === 'buy' || event.side === 'sell' ? event.side : null,
    flags: event.flags,
  });
  pendingRealtimeTrades.push(event);
  if (pendingRealtimeTrades.length > 100) pendingRealtimeTrades.splice(0, pendingRealtimeTrades.length - 100);
  const delay = marketDataRenderDelay(performance.now(), lastMarketDataRenderAt);
  if (delay === 0) queueRealtimeFrame();
  else scheduleMarketDataTimer(delay);
}

function applyRealtimePoint(event: RealtimePointEvent<ProbabilityPoint>) {
  if (currentSeriesKind !== 'probability' || !matchesRealtimeSelection(
    event,
    activeRealtimeRequestId,
    currentSymbol.symbol,
    currentResolution,
    activeRealtimeProviderId,
  )) return;
  if (!acceptsRealtimeSequence(event, 'point')) return;
  const point = event.point;
  if (!Number.isFinite(point.time) || !Number.isFinite(point.value)
    || point.value < 0 || point.value > 100
    || (currentBars.at(-1)?.time ?? -Infinity) > point.time) {
    console.warn('market.realtime.invalid_probability', { point, symbol: event.symbol });
    return;
  }
  const bar: Bar = {
    time: point.time,
    open: point.value,
    high: point.value,
    low: point.value,
    close: point.value,
    volume: 0,
  };
  commitBarReconciliation(reconcileBars(currentBars, [bar]), 'realtime', [], false);
  if (currentSymbol.prediction) currentSymbol.prediction.probability = point.value;
  showCurrentSnapshot();
  if (!marketDataPanel.hidden) renderPredictionRules();
  const cacheKey = marketHistoryCacheKey(currentSymbol, currentResolution, currentAdjustment);
  const cached = getHistoryCache(currentSymbol, currentResolution, currentAdjustment);
  if (cached) {
    const points = [...(cached.value.points ?? [])];
    if (points.at(-1)?.time === point.time) points[points.length - 1] = point;
    else points.push(point);
    const earliestRetainedTime = currentBars[0]?.time ?? point.time;
    historyCache.set(
      cacheKey,
      {
        ...cached.value,
        bars: [...currentBars],
        points: points.filter((candidate) => candidate.time >= earliestRetainedTime),
      },
      cached.deep,
    );
  }
  status.className = 'connection-status ready';
  setStatusLabel(status, `实时 · ${currentSymbol.providerDisplayName} · 概率 ${point.value.toFixed(1)}%`);
  status.title = `最后一次概率更新：${realtimeTimeFormatter.format(new Date(event.eventTimeMs))}`;
}

async function installRealtimeListeners() {
  await Promise.all([
    listen<RealtimeBarEvent<Bar>>('market-realtime-bar', (event) => queueRealtimeBar(event.payload)),
    listen<RealtimePointEvent<ProbabilityPoint>>('market-realtime-point', (event) => applyRealtimePoint(event.payload)),
    listen<RealtimeStatusEvent>('market-realtime-status', (event) => applyRealtimeStatus(event.payload)),
    listen<RealtimeDepthEvent>('market-realtime-depth', (event) => queueRealtimeDepth(event.payload)),
    listen<RealtimeTradeEvent>('market-realtime-trade', (event) => queueRealtimeTrade(event.payload)),
  ]);
}

function chartScreenshot() {
  return chart.takeScreenshot(true, true);
}

function downloadChartImage(canvas = chartScreenshot()) {
  canvas.toBlob((blob) => {
    if (!blob) {
      showChartToast('生成图片失败');
      return;
    }
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `TradeFlow-${currentSymbol.code}-${currentResolution}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showChartToast('PNG 已保存');
  }, 'image/png');
}

async function copyChartImage() {
  const canvas = chartScreenshot();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    showChartToast('生成图片失败');
    return;
  }
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('clipboard image unavailable');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showChartToast('图表已复制');
  } catch {
    downloadChartImage(canvas);
    showChartToast('系统未允许复制，已保存 PNG');
  }
}

chart.subscribeCrosshairMove((param) => {
  if (param.time === undefined) {
    indicatorMarkerTooltip.hidden = true;
    showCurrentSnapshot();
    return;
  }
  const bar = currentBars.find((item) => item.time === Number(param.time));
  if (!bar) {
    indicatorMarkerTooltip.hidden = true;
    return;
  }
  const index = currentBars.indexOf(bar);
  showBar(bar, index > 0 ? currentBars[index - 1] : undefined);
  const tooltipMarkers = indicatorMainSeriesHost.markerValues()
    .filter((marker) => marker.time === Number(param.time) && marker.tooltip);
  if (!param.point || tooltipMarkers.length === 0) {
    indicatorMarkerTooltip.hidden = true;
    return;
  }
  indicatorMarkerTooltip.textContent = tooltipMarkers.map((marker) => marker.tooltip).join('\n');
  indicatorMarkerTooltip.style.color = tooltipMarkers.find((marker) => marker.textColor)?.textColor ?? '';
  indicatorMarkerTooltip.style.left = `${Math.round(param.point.x + 12)}px`;
  indicatorMarkerTooltip.style.top = `${Math.round(param.point.y + 12)}px`;
  indicatorMarkerTooltip.hidden = false;
});
chart.subscribeClick((param) => {
  if (!markerPlacementActive || param.time === undefined) return;
  const time = Number(param.time);
  if (!currentBars.some((bar) => bar.time === time)) {
    showChartToast('请点在一根 K 线上');
    return;
  }
  openMarkerEditor(time);
});

document.querySelector<HTMLButtonElement>('#open')!.addEventListener('click', () => openSymbolDialog('select'));
watchlistAdd.addEventListener('click', () => {
  const currentKey = watchlistSymbolKey(currentSymbol.providerId, currentSymbol.symbol);
  const hasCurrent = watchlistSymbols.includes(currentKey)
    || (legacyStateBelongsToProvider(currentSymbol) && watchlistSymbols.includes(currentSymbol.symbol));
  if (hasCurrent) {
    watchlistSymbols = watchlistSymbols.filter((symbol) => symbol !== currentKey
      && (!legacyStateBelongsToProvider(currentSymbol) || symbol !== currentSymbol.symbol));
  } else {
    addSymbolToWatchlist(currentSymbol);
    return;
  }
  persistWatchlist();
  renderWatchlist();
  if (!watchlistPanel.hidden) void refreshWatchlistQuotes();
});
function setActiveWidgetPanel(panel: 'watchlist' | 'market-data' | 'drawing-manager' | 'data-window' | 'ai' | null): void {
  const isOpen = panel !== null;
  widgetBar.classList.toggle('open', isOpen);
  widgetBarPages.hidden = !isOpen;
  watchlistPanel.hidden = panel !== 'watchlist';
  marketDataPanel.hidden = panel !== 'market-data';
  drawingManager.hidden = panel !== 'drawing-manager';
  dataWindowPanel.hidden = panel !== 'data-window';
  aiPanel.hidden = panel !== 'ai';
  aiToggle.classList.toggle('active', panel === 'ai');
  aiToggle.setAttribute('aria-selected', String(panel === 'ai'));
  watchlistToggle.classList.toggle('active', panel === 'watchlist');
  marketDataToggle.classList.toggle('active', panel === 'market-data');
  drawingManagerToggle.classList.toggle('active', panel === 'drawing-manager');
  dataWindowToggle.classList.toggle('active', panel === 'data-window');
  watchlistToggle.setAttribute('aria-selected', String(panel === 'watchlist'));
  marketDataToggle.setAttribute('aria-selected', String(panel === 'market-data'));
  drawingManagerToggle.setAttribute('aria-selected', String(panel === 'drawing-manager'));
  dataWindowToggle.setAttribute('aria-selected', String(panel === 'data-window'));
  if (panel !== 'watchlist') {
    watchlistQuoteRefreshId += 1;
    watchlistRefresh.classList.remove('loading');
    watchlistRefresh.disabled = false;
  }
  if (panel === 'watchlist') {
    renderWatchlist();
    void refreshWatchlistQuotes();
  }
  if (panel === 'market-data') renderMarketDataPanel();
  if (panel === 'drawing-manager') renderDrawingManager();
  if (panel === 'data-window') renderDataWindow();
}

function widgetPanelWidthLimits(): { min: number; max: number } {
  const available = (widgetBar.parentElement?.clientWidth ?? window.innerWidth) - 52 - 45 - 420;
  return { min: 280, max: Math.max(280, Math.min(520, available)) };
}

function setWidgetPanelWidth(width: number, persist = false): void {
  const { min, max } = widgetPanelWidthLimits();
  const next = Math.round(Math.min(max, Math.max(min, width)));
  widgetBar.style.setProperty('--tf-widget-panel-width', `${next}px`);
  widgetBarResizer.setAttribute('aria-valuenow', String(next));
  widgetBarResizer.setAttribute('aria-valuemax', String(max));
  if (!persist) return;
  try {
    workspaceStorage.setItem(WIDGET_PANEL_WIDTH_STORAGE_KEY, String(next));
  } catch {
    showChartToast('侧栏宽度未能保存');
  }
}

setWidgetPanelWidth(320);
try {
  const savedWidgetPanelWidth = Number(workspaceStorage.getItem(WIDGET_PANEL_WIDTH_STORAGE_KEY));
  if (Number.isFinite(savedWidgetPanelWidth) && savedWidgetPanelWidth > 0) setWidgetPanelWidth(savedWidgetPanelWidth);
} catch {}

widgetBarResizer.addEventListener('pointerdown', (event) => {
  if (!widgetBar.classList.contains('open')) return;
  const startX = event.clientX;
  const startWidth = widgetBar.getBoundingClientRect().width
    - widgetBar.querySelector<HTMLElement>('.widget-bar-tabs')!.getBoundingClientRect().width;
  widgetBarResizer.setPointerCapture(event.pointerId);
  widgetBar.classList.add('resizing');
  document.body.classList.add('widget-bar-resizing');
  const resize = (moveEvent: PointerEvent) => setWidgetPanelWidth(startWidth + startX - moveEvent.clientX);
  const finish = (endEvent: PointerEvent) => {
    resize(endEvent);
    widgetBarResizer.releasePointerCapture(endEvent.pointerId);
    widgetBarResizer.removeEventListener('pointermove', resize);
    widgetBarResizer.removeEventListener('pointerup', finish);
    widgetBarResizer.removeEventListener('pointercancel', finish);
    widgetBar.classList.remove('resizing');
    document.body.classList.remove('widget-bar-resizing');
    const width = Number.parseFloat(getComputedStyle(widgetBar).getPropertyValue('--tf-widget-panel-width'));
    if (Number.isFinite(width)) setWidgetPanelWidth(width, true);
  };
  widgetBarResizer.addEventListener('pointermove', resize);
  widgetBarResizer.addEventListener('pointerup', finish);
  widgetBarResizer.addEventListener('pointercancel', finish);
});
widgetBarResizer.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const current = widgetBar.getBoundingClientRect().width
    - widgetBar.querySelector<HTMLElement>('.widget-bar-tabs')!.getBoundingClientRect().width;
  setWidgetPanelWidth(current + (event.key === 'ArrowLeft' ? 16 : -16), true);
});

watchlistToggle.addEventListener('click', () => {
  closeToolbarMenus();
  setActiveWidgetPanel(watchlistPanel.hidden ? 'watchlist' : null);
});
watchlistRefresh.addEventListener('click', () => void refreshWatchlistQuotes());
aiToggle.addEventListener('click', () => {
  closeToolbarMenus();
  setActiveWidgetPanel(aiPanel.hidden ? 'ai' : null);
});
document.querySelector<HTMLButtonElement>('#ai-close')!.addEventListener('click', () => {
  setActiveWidgetPanel(null); aiToggle.focus();
});
watchlistPanelAdd.addEventListener('click', () => openSymbolDialog('watchlist'));
marketDataToggle.addEventListener('click', () => {
  closeToolbarMenus();
  setActiveWidgetPanel(marketDataPanel.hidden ? 'market-data' : null);
});
document.querySelector<HTMLButtonElement>('#close-market-data')!.addEventListener('click', () => {
  setActiveWidgetPanel(null);
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-market-data-tab]')) {
  button.addEventListener('click', () => {
    activeMarketDataTab = button.dataset.marketDataTab as 'depth' | 'trades' | 'rules';
    renderMarketDataPanel();
  });
}
for (const [button, outcome] of [[predictionYes, 'YES'], [predictionNo, 'NO']] as const) {
  button.addEventListener('click', () => {
    if (currentSymbol.prediction?.outcome.toUpperCase() === outcome) return;
    const opposing = opposingPredictionSymbol(currentSymbol);
    if (!opposing) return;
    marketSymbolById.set(marketSymbolKey(opposing), opposing);
    void selectSymbol(opposing);
  });
}
document.querySelector<HTMLDivElement>('.symbol-control')!.addEventListener('click', () => openSymbolDialog('select'));
input.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
    openSymbolDialog('select');
});
symbolDialogInput.addEventListener('input', () => renderSymbolResults());
symbolResults.addEventListener('scroll', () => {
  if (symbolResults.scrollTop + symbolResults.clientHeight >= symbolResults.scrollHeight - 120) {
    appendNextSymbolResults();
    if (visibleSymbolResults.length >= matchingSymbolResults.length && shouldLoadMorePolymarketSymbols()) {
      const state = polymarketCatalogState();
      if (state) void loadNextMarketCatalogPage(state);
    }
  }
});
symbolDialogInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setActiveSymbolResult(activeSymbolResult + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    setActiveSymbolResult(activeSymbolResult - 1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const match = activeSymbolResult >= 0 ? visibleSymbolResults[activeSymbolResult] : resolveInputSymbol();
    if (match) activateSymbolResult(match);
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-symbol-category]')) {
  button.addEventListener('click', () => {
    activeSymbolCategory = button.dataset.symbolCategory as MarketSearchCategory;
    activeSymbolSource = 'all';
    symbolSourceMenu.hidden = true;
    symbolSourceTrigger.setAttribute('aria-expanded', 'false');
    for (const categoryButton of document.querySelectorAll<HTMLButtonElement>('[data-symbol-category]')) {
      categoryButton.setAttribute('aria-selected', String(categoryButton === button));
    }
    renderSymbolSources();
    renderSymbolResults();
    symbolDialogInput.focus();
  });
}
symbolSourceTrigger.addEventListener('click', () => {
  symbolSourceMenu.hidden = !symbolSourceMenu.hidden;
  symbolSourceTrigger.setAttribute('aria-expanded', String(!symbolSourceMenu.hidden));
});
document.querySelector<HTMLButtonElement>('#symbol-dialog-close')!.addEventListener('click', () => {
  closeSymbolResults();
  symbolDialogReturnFocus.focus();
});
symbolDialogLayer.addEventListener('pointerdown', (event) => {
  if (event.target === symbolDialogLayer) closeSymbolResults();
});
symbolDialog.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!symbolSourceMenu.hidden) {
    symbolSourceMenu.hidden = true;
    symbolSourceTrigger.setAttribute('aria-expanded', 'false');
    symbolSourceTrigger.focus();
    return;
  }
  closeSymbolResults();
  symbolDialogReturnFocus.focus();
});
document.querySelector<HTMLButtonElement>('#refresh')!.addEventListener('click', () => void refreshCurrentHistory());
themeToggle.addEventListener('click', () => {
  const nextTheme: AppTheme = appTheme === 'dark' ? 'light' : 'dark';
  applyAppTheme(nextTheme);
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-resolution]')) {
  button.addEventListener('click', () => void selectResolution(button.dataset.resolution as Resolution));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-favorite-resolution]')) {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    favoriteResolutions = toggleFavoriteResolution(
      favoriteResolutions,
      button.dataset.favoriteResolution as Resolution,
    );
    if (!saveFavoriteResolutions(workspaceStorage, favoriteResolutions)) showChartToast('周期收藏未能保存');
    renderResolutionControls();
  });
}
for (const button of tradingTimeMenu.querySelectorAll<HTMLButtonElement>('[data-trading-time]')) {
  button.addEventListener('click', () => applyTradingTimeChoice(button.dataset.tradingTime as TradingTimeChoice));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-adjustment]')) {
  button.addEventListener('click', () => void openHistory(currentSymbol, currentResolution, button.dataset.adjustment as Adjustment));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-chart-type]')) {
  button.addEventListener('click', () => {
    applyChartType(button.dataset.chartType as ChartType);
    chartTypeMenu.open = false;
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-price-scale]')) {
  button.addEventListener('click', () => {
    applyPriceScale(button.dataset.priceScale as PriceScaleSetting);
  });
}
priceScaleControls.addEventListener('toggle', () => {
  if (!priceScaleControls.open) return;
  priceScaleAuto = chart.priceScale('right').options().autoScale;
  applyPriceScale(currentPriceScale);
});
document.querySelector<HTMLButtonElement>('#price-scale-auto')!.addEventListener('click', () => {
  priceScaleAuto = !priceScaleAuto;
  applyPriceScale(currentPriceScale);
});
document.querySelector<HTMLButtonElement>('#price-scale-invert')!.addEventListener('click', () => {
  priceScaleInverted = !priceScaleInverted;
  applyPriceScale(currentPriceScale);
});
document.querySelector<HTMLButtonElement>('#price-scale-manual')!.addEventListener('click', openManualPriceRange);
document.querySelector<HTMLButtonElement>('#price-scale-reset')!.addEventListener('click', () => {
  priceScaleAuto = true;
  chart.priceScale('right').setAutoScale(true);
  applyPriceScale(currentPriceScale);
});
document.querySelector<HTMLButtonElement>('#confirm-price-range')!.addEventListener('click', applyManualPriceRange);
document.querySelector<HTMLButtonElement>('#cancel-price-range')!.addEventListener('click', () => { priceRangeEditor.hidden = true; });
for (const input of [priceRangeMin, priceRangeMax]) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyManualPriceRange();
    if (event.key === 'Escape') priceRangeEditor.hidden = true;
  });
}
document.querySelector<HTMLButtonElement>('#edit-cost-price')!.addEventListener('click', () => openPriceLineEditor('cost'));
document.querySelector<HTMLButtonElement>('#add-custom-price')!.addEventListener('click', () => openPriceLineEditor('custom'));
document.querySelector<HTMLButtonElement>('#confirm-price-line')!.addEventListener('click', commitPriceLineEditor);
document.querySelector<HTMLButtonElement>('#cancel-price-line')!.addEventListener('click', closePriceLineEditor);
priceLineInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') commitPriceLineEditor();
  if (event.key === 'Escape') closePriceLineEditor();
});
document.querySelector<HTMLButtonElement>('#copy-chart')!.addEventListener('click', () => {
  document.querySelector<HTMLDetailsElement>('#chart-capture-menu')!.open = false;
  void copyChartImage();
});
document.querySelector<HTMLButtonElement>('#save-chart')!.addEventListener('click', () => {
  document.querySelector<HTMLDetailsElement>('#chart-capture-menu')!.open = false;
  downloadChartImage();
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-time-range]')) {
  button.addEventListener('click', () => {
    const range = visibleRangeForPreset(currentBars, button.dataset.timeRange as TimeRangePreset);
    if (range) chart.timeScale().setVisibleRange({ from: range.from as UTCTimestamp, to: range.to as UTCTimestamp });
  });
}
function renderGoToCalendar() {
  goToCalendarTitle.textContent = appLocale === 'zh-CN'
    ? `${goToCalendarMonth + 1}月 ${goToCalendarYear}`
    : new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(goToCalendarYear, goToCalendarMonth, 1)));
  goToCalendarGrid.replaceChildren(...calendarMonthDays(goToCalendarYear, goToCalendarMonth).map((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(item.day);
    button.dataset.goToDate = item.iso;
    button.classList.toggle('outside', !item.inMonth);
    button.classList.toggle('selected', item.iso === goToDateInput.value);
    button.disabled = !item.inMonth
      || Boolean(goToDateInput.min && item.iso < goToDateInput.min)
      || Boolean(goToDateInput.max && item.iso > goToDateInput.max);
    button.setAttribute('aria-label', item.iso);
    return button;
  }));
}

function openGoToDialog() {
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(goToDateInput.value)
    ? goToDateInput.value
    : goToDateInput.max || new Date().toISOString().slice(0, 10);
  goToDateInput.value = selected;
  const [year, month] = selected.split('-').map(Number);
  goToCalendarYear = year;
  goToCalendarMonth = month - 1;
  renderGoToCalendar();
  goToDialogLayer.hidden = false;
  goToDateInput.focus();
  goToDateInput.select();
}

function closeGoToDialog() {
  goToDialogLayer.hidden = true;
}

function goToSelectedDate(): boolean {
  const timestamp = parseShanghaiDate(goToDateInput.value);
  const index = timestamp === null ? null : nearestBarIndex(currentBars, timestamp);
  if (index === null) { showChartToast('请选择有效日期'); return false; }
  chart.timeScale().setVisibleLogicalRange(logicalRangeAround(index, currentBars.length));
  return true;
}
document.querySelector<HTMLButtonElement>('#go-to-date-button')!.addEventListener('click', openGoToDialog);
document.querySelector<HTMLButtonElement>('#close-go-to-dialog')!.addEventListener('click', closeGoToDialog);
document.querySelector<HTMLButtonElement>('#cancel-go-to-date')!.addEventListener('click', closeGoToDialog);
document.querySelector<HTMLButtonElement>('#confirm-go-to-date')!.addEventListener('click', () => {
  if (goToSelectedDate()) closeGoToDialog();
});
document.querySelector<HTMLButtonElement>('#go-to-previous-month')!.addEventListener('click', () => {
  const month = new Date(Date.UTC(goToCalendarYear, goToCalendarMonth - 1, 1));
  goToCalendarYear = month.getUTCFullYear();
  goToCalendarMonth = month.getUTCMonth();
  renderGoToCalendar();
});
document.querySelector<HTMLButtonElement>('#go-to-next-month')!.addEventListener('click', () => {
  const month = new Date(Date.UTC(goToCalendarYear, goToCalendarMonth + 1, 1));
  goToCalendarYear = month.getUTCFullYear();
  goToCalendarMonth = month.getUTCMonth();
  renderGoToCalendar();
});
goToCalendarGrid.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-go-to-date]');
  if (!button || button.disabled) return;
  goToDateInput.value = button.dataset.goToDate!;
  renderGoToCalendar();
});
goToDateInput.addEventListener('input', () => {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(goToDateInput.value);
  if (!match) return;
  goToCalendarYear = Number(match[1]);
  goToCalendarMonth = Number(match[2]) - 1;
  renderGoToCalendar();
});
goToDateInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && goToSelectedDate()) closeGoToDialog();
  if (event.key === 'Escape') closeGoToDialog();
});
goToDialogLayer.addEventListener('pointerdown', (event) => {
  if (event.target === goToDialogLayer) closeGoToDialog();
});
openChartSettingsButton.addEventListener('click', openChartSettings);
openMarketProviderSettingsButton.addEventListener('click', () => {
  openChartSettings();
  selectChartSettingsTab('data');
});
openIndicatorPickerButton.addEventListener('click', openIndicatorPicker);
importUserIndicatorButton.addEventListener('click', () => {
  if (!userIndicatorLibrary) {
    showChartToast('用户指标库不可用');
    return;
  }
  userIndicatorFileInput.value = '';
  userIndicatorFileInput.click();
});
userIndicatorFileInput.addEventListener('change', () => {
  const file = userIndicatorFileInput.files?.[0];
  if (!file) return;
  void prepareUserIndicatorFile(file).catch((error) => {
    openUserIndicatorImportFailure(error);
  });
});
document.querySelector<HTMLButtonElement>('#close-indicator-picker')!.addEventListener('click', closeIndicatorPicker);
document.querySelector<HTMLButtonElement>('#close-indicator-config')!.addEventListener('click', () => closeIndicatorConfig());
document.querySelector<HTMLButtonElement>('#cancel-indicator-config')!.addEventListener('click', () => closeIndicatorConfig());
document.querySelector<HTMLButtonElement>('#confirm-indicator-config')!.addEventListener('click', confirmIndicatorConfig);
document.querySelector<HTMLButtonElement>('#close-user-indicator-import')!.addEventListener('click', closeUserIndicatorImportPreview);
document.querySelector<HTMLButtonElement>('#cancel-user-indicator-import')!.addEventListener('click', closeUserIndicatorImportPreview);
confirmUserIndicatorImportButton.addEventListener('click', () => void confirmUserIndicatorLibraryChange());
confirmUserIndicatorAddButton.addEventListener('click', () => void confirmUserIndicatorLibraryChange(true));
copyUserIndicatorAiDiagnosticButton.addEventListener('click', () => {
  if (!pendingUserIndicatorDiagnostic) return;
  void copyTextToClipboard(
    formatUserIndicatorAiDiagnostic(pendingUserIndicatorDiagnostic),
    'AI 修复信息已复制',
  );
});
userIndicatorImportLayer.addEventListener('pointerdown', (event) => {
  if (event.target === userIndicatorImportLayer) closeUserIndicatorImportPreview();
});
indicatorPickerSearch.addEventListener('input', () => renderIndicatorPicker());
indicatorPickerLayer.addEventListener('pointerdown', (event) => {
  if (event.target === indicatorPickerLayer) closeIndicatorPicker();
});
indicatorPickerDialog.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const focusable = [...indicatorPickerDialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
indicatorConfigLayer.addEventListener('pointerdown', (event) => {
  if (event.target === indicatorConfigLayer) closeIndicatorConfig();
});
indicatorConfigDialog.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') {
    event.preventDefault();
    confirmIndicatorConfig();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...indicatorConfigDialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
document.querySelector<HTMLButtonElement>('#close-chart-settings')!.addEventListener('click', closeChartSettings);
document.querySelector<HTMLButtonElement>('#cancel-chart-settings')!.addEventListener('click', closeChartSettings);
confirmChartSettingsButton.addEventListener('click', () => void confirmChartSettings());
for (const button of chartSettingsTabs) {
  button.addEventListener('click', () => selectChartSettingsTab(button.dataset.settingsTab!));
}
for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-external-url]')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    openExternalUrl(link.href);
  });
}
chartSettingsLayer.addEventListener('pointerdown', (event) => {
  if (event.target === chartSettingsLayer) closeChartSettings();
});
chartSettingsDialog.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const focusable = [...chartSettingsDialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')]
    .filter((element) => !element.closest('[hidden]'));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !userIndicatorImportLayer.hidden) {
    event.preventDefault();
    closeUserIndicatorImportPreview();
    return;
  }
  if (event.key === 'Escape' && !indicatorConfigLayer.hidden) {
    event.preventDefault();
    closeIndicatorConfig();
    return;
  }
  if (event.key === 'Escape' && !indicatorPickerLayer.hidden) {
    event.preventDefault();
    closeIndicatorPicker();
    return;
  }
  if (event.key === 'Escape' && !chartSettingsLayer.hidden) {
    event.preventDefault();
    closeChartSettings();
  }
});
const toolbarMenus = [...document.querySelectorAll<HTMLDetailsElement>('.chart-control-menu, .price-scale-controls, .trading-time-menu')];
function closeToolbarMenus() {
  for (const menu of toolbarMenus) menu.open = false;
}
for (const menu of toolbarMenus) {
  menu.addEventListener('toggle', () => {
    if (menu.open) for (const other of toolbarMenus) if (other !== menu) other.open = false;
  });
}
status.addEventListener('click', async () => {
  if (currentSymbol.providerId === 'none' || !activeMarketProviderIds.has(currentSymbol.providerId)) return;
  if (currentSymbol.providerId !== 'tdx') {
    await refreshCurrentHistory();
    return;
  }
  const historyGeneration = historyRequestGate.current();
  status.disabled = true;
  status.className = 'connection-status loading';
  setStatusLabel(status, '正在测试 19 台主站');
  try {
    const response = await invoke<HostBenchmarkResponse>('benchmark_hosts');
    if (!historyRequestGate.isCurrent(historyGeneration)) return;
    const healthy = response.probes.filter((probe) => probe.ok);
    const fastest = healthy[0];
    status.className = fastest ? 'connection-status ready' : 'connection-status error';
    const statusText = fastest
      ? `${fastest.host} · ${fastest.latencyMs}ms · ${healthy.length}/${response.probes.length}`
      : '主站均不可用';
    setStatusLabel(status, statusText);
    status.title = response.probes
      .map((probe) => `${probe.host} · ${probe.ok ? `${probe.latencyMs}ms` : probe.error ?? '失败'}`)
      .join('\n');
  } catch (error) {
    if (!historyRequestGate.isCurrent(historyGeneration)) return;
    status.className = 'connection-status error';
    setStatusLabel(status, '主站测速失败');
    status.title = String(error);
  } finally {
    status.disabled = false;
  }
});
document.querySelector<HTMLButtonElement>('#toggle-fullscreen')!.addEventListener('click', async () => {
  try {
    const nextFullscreen = !(await getCurrentWindow().isFullscreen());
    await getCurrentWindow().setFullscreen(nextFullscreen);
    console.info('window.fullscreen.changed', { fullscreen: nextFullscreen });
  } catch (error) {
    console.error('window.fullscreen.change_failed', { error: String(error) });
    showChartToast('全屏切换失败');
  }
});
crosshairTool.addEventListener('click', () => {
  cancelMarkerPlacement();
  closeMarkerEditor();
  leaveDrawingMode(true);
});
markerTool.setAttribute('aria-pressed', 'false');
markerTool.addEventListener('click', () => {
  closeToolbarMenus();
  closeMarkerEditor();
  leaveDrawingMode(true);
  markerPlacementActive = true;
  markerTool.classList.add('active');
  markerTool.setAttribute('aria-pressed', 'true');
  crosshairTool.classList.remove('active');
  crosshairTool.setAttribute('aria-pressed', 'false');
  drawingModeHint.textContent = '标记 · 点击要标记的 K 线';
  drawingModeHint.hidden = false;
  chartStage.classList.add('drawing-active');
});
document.querySelector<HTMLButtonElement>('#confirm-marker')!.addEventListener('click', commitMarkerEditor);
document.querySelector<HTMLButtonElement>('#cancel-marker')!.addEventListener('click', closeMarkerEditor);
deleteMarkerButton.addEventListener('click', deleteEditingMarker);
markerText.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') commitMarkerEditor();
  if (event.key === 'Escape') closeMarkerEditor();
});
for (const button of drawingButtons) {
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => startDrawing(button.dataset.drawingTool as DrawingToolType, button));
}
for (const menu of drawingMenus) {
  menu.addEventListener('toggle', () => {
    if (menu.open) for (const otherMenu of drawingMenus) if (otherMenu !== menu) otherMenu.open = false;
  });
}
for (const control of drawingPropertyControls) {
  control.addEventListener('toggle', () => {
    if (control.open) for (const otherControl of drawingPropertyControls) if (otherControl !== control) otherControl.open = false;
  });
}
function placeDrawingText() {
  const button = pendingTextButton;
  if (!button) return;
  const value = drawingTextInput.value.trim() || ui('文字');
  pendingTextButton = null;
  startDrawing(button.dataset.drawingTool as 'Text' | 'Callout', button, value);
}
document.querySelector<HTMLButtonElement>('#place-drawing-text')!.addEventListener('click', placeDrawingText);
drawingTextInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.stopPropagation();
    placeDrawingText();
  }
});
drawingColor.addEventListener('input', applySelectedDrawingStyle);
drawingSize.addEventListener('input', () => {
  drawingSizeValue.value = `${drawingSize.value}px`;
  applySelectedDrawingStyle();
});
drawingOpacity.addEventListener('input', () => {
  drawingOpacityValue.value = `${drawingOpacity.value}%`;
  applySelectedDrawingStyle();
});
document.querySelector<HTMLButtonElement>('#delete-selected-drawing')!.addEventListener('click', () => {
  if (!selectedDrawing) return;
  lineTools.removeLineToolsById([selectedDrawing.id]);
  hideDrawingProperties();
  commitDrawingState();
});
document.querySelector<HTMLButtonElement>('#close-drawing-properties')!.addEventListener('click', hideDrawingProperties);
const drawingPropertyGrip = drawingProperties.querySelector<HTMLElement>('.drawing-property-grip')!;
let propertyDrag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;
drawingPropertyGrip.addEventListener('pointerdown', (event) => {
  propertyDrag = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: drawingProperties.offsetLeft,
    top: drawingProperties.offsetTop,
  };
  drawingPropertyGrip.setPointerCapture(event.pointerId);
});
drawingPropertyGrip.addEventListener('pointermove', (event) => {
  if (!propertyDrag || propertyDrag.pointerId !== event.pointerId) return;
  const left = Math.max(8, Math.min(chartStage.clientWidth - drawingProperties.offsetWidth - 8, propertyDrag.left + event.clientX - propertyDrag.x));
  const top = Math.max(8, Math.min(chartStage.clientHeight - drawingProperties.offsetHeight - 8, propertyDrag.top + event.clientY - propertyDrag.y));
  drawingProperties.style.left = `${Math.round(left)}px`;
  drawingProperties.style.top = `${Math.round(top)}px`;
});
drawingPropertyGrip.addEventListener('pointerup', (event) => {
  if (propertyDrag?.pointerId === event.pointerId) propertyDrag = null;
});
document.addEventListener('pointerdown', (event) => {
  if (!symbolSourceMenu.hidden && !(event.target as Element).closest('.symbol-source-row')) {
    symbolSourceMenu.hidden = true;
    symbolSourceTrigger.setAttribute('aria-expanded', 'false');
  }
  if (!(event.target as Element).closest('.drawing-tool-menu')) {
    for (const menu of drawingMenus) menu.open = false;
  }
  if (!(event.target as Element).closest('.drawing-property-control')) {
    for (const control of drawingPropertyControls) control.open = false;
  }
});
document.querySelector<HTMLButtonElement>('#lock-drawings')!.addEventListener('click', (event) => {
  drawingsLocked = !drawingsLocked;
  if (drawingsLocked) leaveDrawingMode(true);
  lineTools.setLocked(drawingsLocked);
  const button = event.currentTarget as HTMLButtonElement;
  button.classList.toggle('active', drawingsLocked);
  button.setAttribute('aria-pressed', String(drawingsLocked));
  for (const drawingButton of drawingButtons) drawingButton.disabled = drawingsLocked;
});
document.querySelector<HTMLButtonElement>('#clear-drawings')!.addEventListener('click', () => {
  leaveDrawingMode(true);
  lineTools.removeAllLineTools();
  commitDrawingState();
});
undoDrawing.addEventListener('click', () => {
  const snapshot = drawingHistory.undo();
  if (snapshot && applyDrawingSnapshot(snapshot, true)) persistDrawingSnapshot(snapshot);
  updateDrawingHistoryButtons();
});
redoDrawing.addEventListener('click', () => {
  const snapshot = drawingHistory.redo();
  if (snapshot && applyDrawingSnapshot(snapshot, true)) persistDrawingSnapshot(snapshot);
  updateDrawingHistoryButtons();
});
drawingManagerToggle.addEventListener('click', () => {
  closeToolbarMenus();
  setActiveWidgetPanel(drawingManager.hidden ? 'drawing-manager' : null);
});
document.querySelector<HTMLButtonElement>('#close-drawing-manager')!.addEventListener('click', () => {
  setActiveWidgetPanel(null);
});
dataWindowToggle.addEventListener('click', () => {
  closeToolbarMenus();
  setActiveWidgetPanel(dataWindowPanel.hidden ? 'data-window' : null);
});
document.querySelector<HTMLButtonElement>('#zoom-tool')!.addEventListener('click', () => {
  const range = chart.timeScale().getVisibleLogicalRange();
  if (range) chart.timeScale().setVisibleLogicalRange({ from: range.from + 12, to: range.to - 12 });
});
document.querySelector<HTMLButtonElement>('#magnet-tool')!.addEventListener('click', (event) => {
  magnetEnabled = !magnetEnabled;
  chart.applyOptions({ crosshair: { mode: magnetEnabled ? CrosshairMode.Magnet : CrosshairMode.Normal } });
  lineTools.setMagnetThreshold(magnetEnabled ? 12 : 0);
  (event.currentTarget as HTMLButtonElement).classList.toggle('active', magnetEnabled);
});
indicatorPickerList.addEventListener('click', (event) => {
  const deleteButton = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-delete-user-indicator]');
  if (deleteButton) {
    openUserIndicatorDeletePreview(deleteButton.dataset.deleteUserIndicator!);
    return;
  }
  const volumeButton = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-managed-indicator="volume"]');
  if (volumeButton) {
    setVolumeActive(!volumeVisible);
    return;
  }
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-indicator-id]');
  if (!button) return;
  const indicatorId = button.dataset.indicatorId!;
  openIndicatorConfig(indicatorId);
});
chart.timeScale().subscribeVisibleLogicalRangeChange(positionDrawingProperties);
chart.timeScale().subscribeSizeChange(scheduleIndicatorLegendLayout);
const indicatorLegendResizeObserver = new ResizeObserver(scheduleIndicatorLegendLayout);
indicatorLegendResizeObserver.observe(document.querySelector<HTMLDivElement>('#chart')!);
document.querySelector<HTMLDivElement>('#chart')!.addEventListener('pointermove', scheduleIndicatorLegendLayout, { passive: true });
document.querySelector<HTMLDivElement>('#chart')!.addEventListener('pointerup', scheduleIndicatorLegendLayout, { passive: true });
chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
  if (!range || !deepHistoryNavigationReady) return;
  const cached = getHistoryCache(currentSymbol, currentResolution, currentAdjustment);
  if (shouldLoadDeepHistory(range.from, currentBars.length, cached?.deep ?? false)) {
    scheduleDeepHistory(
      currentSymbol,
      currentResolution,
      currentAdjustment,
      0,
    );
  }
});
window.addEventListener('resize', positionDrawingProperties);
document.querySelector<HTMLDivElement>('#chart')!.addEventListener('pointerup', () => persistIndicatorState());
window.addEventListener('beforeunload', () => {
  persistIndicatorState();
  void workspaceStorage.flush();
  userDataController.close();
  userTaskController.close();
  void (async () => { await userTaskLibrary?.close(); await userTaskManager?.close(); await userDataManager?.close(); })().catch(() => {});
  aiChartReadBridge?.close();
  aiChartWorkbenchBridge?.close();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    cancelMarkerPlacement();
    closeMarkerEditor();
    priceRangeEditor.hidden = true;
    leaveDrawingMode(true);
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedDrawing && !(event.target instanceof HTMLInputElement)) {
    lineTools.removeLineToolsById([selectedDrawing.id]);
    hideDrawingProperties();
    commitDrawingState();
  }
});
const realtimeListenersReady = installRealtimeListeners();

const USER_INDICATOR_DESKTOP_E2E = import.meta.env.VITE_TRADEFLOW_USER_INDICATOR_E2E === '1';
const USER_INDICATOR_DESKTOP_E2E_PHASE_KEY = 'tradeflow-lite.user-indicator-desktop-e2e.phase';
const USER_INDICATOR_DESKTOP_E2E_RUN_KEY = 'tradeflow-lite.user-indicator-desktop-e2e.run';
const USER_INDICATOR_DESKTOP_E2E_BEFORE_UNLOAD_KEY = 'tradeflow-lite.user-indicator-desktop-e2e.before-unload';
const USER_INDICATOR_DESKTOP_E2E_BOOTSTRAP_TRACE_KEY = 'tradeflow-lite.user-indicator-desktop-e2e.bootstrap-trace';
const USER_INDICATOR_DESKTOP_E2E_RUN_ID = '2026-09-18-graceful-restart-4';
const USER_INDICATOR_DESKTOP_E2E_FIXTURES = [
  { id: 'fixture.sma', fileName: '01-sma.tfi', source: userIndicatorE2eSma },
  { id: 'fixture.range-pane', fileName: '02-range-pane.tfi', source: userIndicatorE2eRange },
  { id: 'fixture.marker-style', fileName: '03-marker-style.tfi', source: userIndicatorE2eMarkerStyle },
  { id: 'fixture.canvas', fileName: '04-canvas.tfi', source: userIndicatorE2eCanvas },
  { id: 'fixture.panel', fileName: '05-panel.tfi', source: userIndicatorE2ePanel },
] as const;
const USER_INDICATOR_DESKTOP_E2E_IDS = new Set([
  ...USER_INDICATOR_DESKTOP_E2E_FIXTURES.map((fixture) => fixture.id),
  'fixture.loop',
]);

if (USER_INDICATOR_DESKTOP_E2E) {
  window.addEventListener('beforeunload', () => {
    const instanceId = defaultIndicatorInstanceId('fixture.range-pane');
    const saved = loadedIndicatorState.instances.find((entry) => entry.instanceId === instanceId);
    localStorage.setItem(USER_INDICATOR_DESKTOP_E2E_BEFORE_UNLOAD_KEY, JSON.stringify({
      chartPaneStates: indicatorChartHost.paneStates(instanceId),
      savedPanes: saved?.panes ?? null,
      runtime: userIndicatorRuntime.get(instanceId),
    }));
  });
}

function userIndicatorDesktopE2eStatus(message: string) {
  let statusNode = document.querySelector<HTMLDivElement>('#user-indicator-desktop-e2e-status');
  if (!statusNode) {
    statusNode = document.createElement('div');
    statusNode.id = 'user-indicator-desktop-e2e-status';
    statusNode.setAttribute('role', 'status');
    statusNode.style.cssText = 'position:fixed;z-index:99999;left:12px;top:72px;max-width:calc(100vw - 24px);padding:8px 10px;background:#111;color:#fff;border:1px solid #2962ff;font:12px/1.4 monospace;white-space:pre-wrap;';
    document.body.append(statusNode);
  }
  statusNode.textContent = message;
  console.info('user_indicator.desktop_e2e', message);
}

function userIndicatorDesktopE2eAssert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function userIndicatorDesktopE2eWait(
  label: string,
  predicate: () => boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
  }
  throw new Error(`timeout: ${label}`);
}

function userIndicatorDesktopE2eSavedId(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object' || !('indicatorId' in entry)) return null;
  const indicatorId = (entry as { indicatorId?: unknown }).indicatorId;
  return typeof indicatorId === 'string' ? indicatorId : null;
}

function userIndicatorDesktopE2eTraceBootstrap(step: string) {
  if (!USER_INDICATOR_DESKTOP_E2E) return;
  const instanceId = defaultIndicatorInstanceId('fixture.range-pane');
  const saved = loadedIndicatorState.instances.find((entry) => entry.instanceId === instanceId);
  const previous = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(USER_INDICATOR_DESKTOP_E2E_BOOTSTRAP_TRACE_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  localStorage.setItem(USER_INDICATOR_DESKTOP_E2E_BOOTSTRAP_TRACE_KEY, JSON.stringify([
    ...previous,
    { step, savedPanes: saved?.panes ?? null, livePanes: indicatorChartHost.paneStates(instanceId) },
  ]));
}

function userIndicatorDesktopE2ePruneSavedState() {
  loadedIndicatorState = {
    ...loadedIndicatorState,
    instances: loadedIndicatorState.instances.filter((entry) => !USER_INDICATOR_DESKTOP_E2E_IDS.has(entry.indicatorId)),
    unresolvedEntries: loadedIndicatorState.unresolvedEntries.filter((entry) => {
      const indicatorId = userIndicatorDesktopE2eSavedId(entry);
      return indicatorId === null || !USER_INDICATOR_DESKTOP_E2E_IDS.has(indicatorId);
    }),
  };
  indicatorInstanceOrder = indicatorInstanceOrder.filter((instanceId) => !instanceId.startsWith('fixture.'));
}

async function userIndicatorDesktopE2eCleanLibraryAndRuntime() {
  for (const instance of userIndicatorRuntime.list()) {
    if (USER_INDICATOR_DESKTOP_E2E_IDS.has(instance.indicatorId)) userIndicatorRuntime.remove(instance.instanceId);
  }
  for (const indicatorId of USER_INDICATOR_DESKTOP_E2E_IDS) {
    try {
      await userIndicatorLibrary?.delete(indicatorId);
    } catch {
      // Best-effort cleanup of test-only fixture ids.
    }
    userIndicatorRecords.delete(indicatorId);
  }
  userIndicatorDesktopE2ePruneSavedState();
  for (const indicatorId of USER_INDICATOR_DESKTOP_E2E_IDS) {
    userIndicatorRuntimeFailures.delete(defaultIndicatorInstanceId(indicatorId));
  }
  persistIndicatorState();
  renderIndicatorPicker();
  renderIndicatorLegends();
}

async function userIndicatorDesktopE2eImport(source: string, fileName: string, indicatorId: string) {
  userIndicatorDesktopE2eAssert(userIndicatorLibrary, 'user indicator library unavailable');
  await prepareUserIndicatorFile(new File([source], fileName, { type: 'text/plain' }));
  if (pendingUserIndicatorImport) await confirmUserIndicatorLibraryChange();
  const record = userIndicatorRecords.get(indicatorId);
  userIndicatorDesktopE2eAssert(record, `library record missing: ${indicatorId}`);
  return record;
}

async function userIndicatorDesktopE2eAddViaConfig(indicatorId: string): Promise<string> {
  const instanceId = nextIndicatorInstanceId(indicatorId);
  openIndicatorConfig(indicatorId);
  confirmIndicatorConfig();
  await userIndicatorDesktopE2eWait(`${indicatorId} running`, () => {
    const state = userIndicatorRuntime.get(instanceId);
    if (state?.failed) {
      const diagnostic = userIndicatorRuntimeFailures.get(instanceId);
      throw new Error(`${indicatorId} failed: ${diagnostic?.code ?? 'unknown'}`);
    }
    return state?.running === true;
  });
  return instanceId;
}

function userIndicatorDesktopE2ePanelHost(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('[data-indicator-overlay="summary"]')]
    .find((host) => host.shadowRoot?.textContent?.includes('Summary')) ?? null;
}

async function userIndicatorDesktopE2eVerifyRestored(
  instances: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [indicatorId, instanceId] of Object.entries(instances)) {
    await userIndicatorDesktopE2eWait(`${indicatorId} restored`, () => {
      const state = userIndicatorRuntime.get(instanceId);
      if (state?.failed) return false;
      return state?.running === true;
    }, 12_000);
  }
  await userIndicatorDesktopE2eWait('restored SMA series', () => indicatorChartHost.series(instances['fixture.sma']).length === 1, 12_000);
  await userIndicatorDesktopE2eWait('restored range series', () => indicatorChartHost.series(instances['fixture.range-pane']).length === 1, 12_000);
  await userIndicatorDesktopE2eWait('restored range pane', () => indicatorChartHost.pane(instances['fixture.range-pane'], 'range') !== null, 12_000);
  const rangePane = indicatorChartHost.pane(instances['fixture.range-pane'], 'range')!;
  // Pane creation/Worker readiness precedes Lightweight Charts' next layout frame.
  // Wait for measurement, not merely object existence; keep the exact saved-height assertion below.
  await userIndicatorDesktopE2eWait('restored range pane layout', () => rangePane.getHeight() > 0, 12_000);
  const savedRange = loadedIndicatorState.instances.find((entry) => entry.instanceId === instances['fixture.range-pane']);
  const savedRangeHeight = savedRange?.panes.find((pane) => pane.key === 'range')?.height;
  const beforeUnload = localStorage.getItem(USER_INDICATOR_DESKTOP_E2E_BEFORE_UNLOAD_KEY);
  const bootstrapTrace = localStorage.getItem(USER_INDICATOR_DESKTOP_E2E_BOOTSTRAP_TRACE_KEY);
  userIndicatorDesktopE2eAssert(
    typeof savedRangeHeight === 'number',
    `saved range pane height missing; beforeUnload=${beforeUnload ?? 'null'}; savedPanes=${JSON.stringify(savedRange?.panes ?? null)}; bootstrapTrace=${bootstrapTrace ?? 'null'}`,
  );
  userIndicatorDesktopE2eAssert(
    Math.abs(rangePane.getHeight() - savedRangeHeight) <= 2,
    `range pane height not restored: actual=${rangePane.getHeight()}, saved=${savedRangeHeight}`,
  );
  const sma = userIndicatorRuntime.get(instances['fixture.sma']);
  userIndicatorDesktopE2eAssert(sma?.inputs.period === 5, 'SMA period not restored');
  userIndicatorDesktopE2eAssert(sma?.visible === false, 'SMA visibility not restored');
  await userIndicatorDesktopE2eWait('panel restored', () => userIndicatorDesktopE2ePanelHost() !== null);
  await userIndicatorDesktopE2eWait('restored canvas host target', () => (
    indicatorChartHost.visualPaneTargets(instances['fixture.canvas']).some((target) => target.key === 'main')
  ), 12_000);
}

async function runUserIndicatorDesktopE2e(): Promise<void> {
  try {
    userIndicatorDesktopE2eAssert(userIndicatorLibrary, 'user indicator library unavailable');
    if (localStorage.getItem(USER_INDICATOR_DESKTOP_E2E_RUN_KEY) !== USER_INDICATOR_DESKTOP_E2E_RUN_ID) {
      localStorage.setItem(USER_INDICATOR_DESKTOP_E2E_RUN_KEY, USER_INDICATOR_DESKTOP_E2E_RUN_ID);
      localStorage.removeItem(USER_INDICATOR_DESKTOP_E2E_PHASE_KEY);
      await userIndicatorDesktopE2eCleanLibraryAndRuntime();
    }
    const phase = localStorage.getItem(USER_INDICATOR_DESKTOP_E2E_PHASE_KEY);
    const instances = Object.fromEntries(USER_INDICATOR_DESKTOP_E2E_FIXTURES.map((fixture) => [
      fixture.id,
      defaultIndicatorInstanceId(fixture.id),
    ])) as Record<string, string>;

    if (phase === 'restart-pending') {
      userIndicatorDesktopE2eStatus('USER_INDICATOR_E2E_PHASE2_RUNNING');
      await userIndicatorDesktopE2eVerifyRestored(instances);
      userIndicatorRuntime.setVisible(instances['fixture.sma'], true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      userIndicatorDesktopE2eAssert(chartScreenshot().toDataURL().length > 10_000, 'restored chart screenshot invalid');
      await userIndicatorDesktopE2eCleanLibraryAndRuntime();
      localStorage.removeItem(USER_INDICATOR_DESKTOP_E2E_PHASE_KEY);
      localStorage.removeItem(USER_INDICATOR_DESKTOP_E2E_RUN_KEY);
      localStorage.removeItem(USER_INDICATOR_DESKTOP_E2E_BEFORE_UNLOAD_KEY);
      localStorage.removeItem(USER_INDICATOR_DESKTOP_E2E_BOOTSTRAP_TRACE_KEY);
      userIndicatorDesktopE2eStatus('USER_INDICATOR_E2E_PASS\nrestart exact-hash restore=ok\ncleanup=ok');
      return;
    }

    userIndicatorDesktopE2eStatus('USER_INDICATOR_E2E_PHASE1_RUNNING');
    await userIndicatorDesktopE2eCleanLibraryAndRuntime();

    const fixtureMap = new Map(USER_INDICATOR_DESKTOP_E2E_FIXTURES.map((fixture) => [fixture.id, fixture]));
    for (const indicatorId of ['fixture.sma', 'fixture.range-pane', 'fixture.marker-style'] as const) {
      const fixture = fixtureMap.get(indicatorId)!;
      await userIndicatorDesktopE2eImport(fixture.source, fixture.fileName, indicatorId);
      instances[indicatorId] = await userIndicatorDesktopE2eAddViaConfig(indicatorId);
    }
    await userIndicatorDesktopE2eWait('SMA chart series', () => indicatorChartHost.series(instances['fixture.sma']).length === 1);
    await userIndicatorDesktopE2eWait('range chart series', () => indicatorChartHost.series(instances['fixture.range-pane']).length === 1);
    userIndicatorDesktopE2eAssert(indicatorChartHost.pane(instances['fixture.range-pane'], 'range'), 'range pane missing');
    const bullishIndex = currentBars.findIndex((bar, index) => index > 0 && bar.close > bar.open);
    userIndicatorDesktopE2eAssert(bullishIndex >= 0, 'no bullish bar available for BarStyle smoke');
    await userIndicatorDesktopE2eWait('BarStyle contribution', () => (
      indicatorMainSeriesHost.styleFor(currentBars[bullishIndex], bullishIndex).color === '#089981'
    ));

    const beforeCanvas = chartScreenshot().toDataURL();
    const canvasFixture = fixtureMap.get('fixture.canvas')!;
    await userIndicatorDesktopE2eImport(canvasFixture.source, canvasFixture.fileName, canvasFixture.id);
    instances[canvasFixture.id] = await userIndicatorDesktopE2eAddViaConfig(canvasFixture.id);
    await userIndicatorDesktopE2eWait('canvas target', () => (
      indicatorChartHost.visualPaneTargets(instances['fixture.canvas']).some((target) => target.key === 'main')
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const afterCanvas = chartScreenshot().toDataURL();
    userIndicatorDesktopE2eAssert(afterCanvas !== beforeCanvas, 'Canvas primitive did not change chart screenshot');

    const panelFixture = fixtureMap.get('fixture.panel')!;
    await userIndicatorDesktopE2eImport(panelFixture.source, panelFixture.fileName, panelFixture.id);
    instances[panelFixture.id] = await userIndicatorDesktopE2eAddViaConfig(panelFixture.id);
    await userIndicatorDesktopE2eWait('panel DOM', () => userIndicatorDesktopE2ePanelHost() !== null);
    const panelHost = userIndicatorDesktopE2ePanelHost()!;
    userIndicatorDesktopE2eAssert(panelHost.shadowRoot?.textContent?.includes('Close'), 'Panel content not rendered');
    userIndicatorRuntime.setVisible(instances['fixture.panel'], false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    userIndicatorDesktopE2eAssert(panelHost.hidden, 'Panel visibility off not applied');
    userIndicatorRuntime.setVisible(instances['fixture.panel'], true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    userIndicatorDesktopE2eAssert(!panelHost.hidden, 'Panel visibility on not applied');

    userIndicatorRuntime.updateInputs(instances['fixture.sma'], { period: 5 });
    await userIndicatorDesktopE2eWait('SMA input rebuild', () => (
      userIndicatorRuntime.get(instances['fixture.sma'])?.inputs.period === 5
      && indicatorChartHost.series(instances['fixture.sma']).length === 1
    ));

    const originalResolution = currentResolution;
    if (originalResolution !== '5') {
      await openHistory(currentSymbol, '5', currentAdjustment);
      for (const instanceId of Object.values(instances)) {
        await userIndicatorDesktopE2eWait(`selection rebuild ${instanceId}`, () => userIndicatorRuntime.get(instanceId)?.running === true, 12_000);
      }
      await openHistory(currentSymbol, originalResolution, currentAdjustment);
      for (const instanceId of Object.values(instances)) {
        await userIndicatorDesktopE2eWait(`selection restore ${instanceId}`, () => userIndicatorRuntime.get(instanceId)?.running === true, 12_000);
      }
    }

    const loopSource = `defineIndicator({\n  formatVersion:1, apiVersion:1, id:'fixture.loop', indicatorVersion:1, name:'Loop Fixture', inputs:{}, supports:{seriesKinds:['ohlcv']},\n  create(context){ const line=context.layers.createSeries({key:'loop',type:'line',pane:'main'}); return { update(){ while(true){} line.setValues([]); } }; }\n});`;
    await userIndicatorDesktopE2eImport(loopSource, 'loop.tfi', 'fixture.loop');
    const loopInstanceId = nextIndicatorInstanceId('fixture.loop');
    openIndicatorConfig('fixture.loop');
    confirmIndicatorConfig();
    await userIndicatorDesktopE2eWait('loop indicator failure', () => userIndicatorRuntime.get(loopInstanceId)?.failed === true, 5_000);
    userIndicatorDesktopE2eAssert(
      userIndicatorRuntimeFailures.get(loopInstanceId)?.code === 'execution_timeout',
      `unexpected loop failure code: ${userIndicatorRuntimeFailures.get(loopInstanceId)?.code ?? 'missing'}`,
    );
    userIndicatorDesktopE2eAssert(chartScreenshot().toDataURL().length > 10_000, 'main chart unusable after loop failure');
    userIndicatorDesktopE2eAssert(userIndicatorRuntime.get(instances['fixture.range-pane'])?.failed !== true, 'other user indicator failed with loop fixture');
    removeIndicatorInstance(loopInstanceId);
    openUserIndicatorDeletePreview('fixture.loop');
    await confirmUserIndicatorLibraryChange();

    const smaRecord = userIndicatorRecords.get('fixture.sma');
    userIndicatorDesktopE2eAssert(smaRecord, 'SMA library record missing before lifecycle loop');
    for (let index = 0; index < 50; index += 1) {
      const cycleInstanceId = `fixture.sma:e2e-cycle-${index}`;
      userIndicatorRuntime.add({
        instanceId: cycleInstanceId,
        indicatorId: smaRecord.id,
        sourceHash: smaRecord.sourceHash,
        indicatorVersion: smaRecord.indicatorVersion,
        inputs: { period: 3 },
        visible: true,
      }, smaRecord);
      await userIndicatorDesktopE2eWait(`cycle ${index} series`, () => indicatorChartHost.series(cycleInstanceId).length === 1, 5_000);
      userIndicatorRuntime.remove(cycleInstanceId);
      userIndicatorDesktopE2eAssert(indicatorChartHost.series(cycleInstanceId).length === 0, `cycle ${index} series leaked`);
      userIndicatorDesktopE2eAssert(indicatorChartHost.visualPaneTargets(cycleInstanceId).length === 0, `cycle ${index} visual target leaked`);
    }

    const rangePane = indicatorChartHost.pane(instances['fixture.range-pane'], 'range');
    userIndicatorDesktopE2eAssert(rangePane, 'range pane missing before restart staging');
    rangePane.setHeight(157);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    userIndicatorRuntime.setVisible(instances['fixture.sma'], false);
    persistIndicatorState();

    const assertRangePanePersisted = (label: string) => {
      const state = userIndicatorRuntime.get(instances['fixture.range-pane']);
      userIndicatorDesktopE2eAssert(state?.failed !== true, `range indicator failed before ${label}`);
      const currentPane = indicatorChartHost.pane(instances['fixture.range-pane'], 'range');
      userIndicatorDesktopE2eAssert(currentPane, `range pane missing before ${label}`);
      const saved = loadedIndicatorState.instances.find((entry) => entry.instanceId === instances['fixture.range-pane']);
      const savedPane = saved?.panes.find((pane) => pane.key === 'range');
      userIndicatorDesktopE2eAssert(
        savedPane,
        `range pane not persisted at ${label}; current=${currentPane.getHeight()}; saved=${JSON.stringify(saved?.panes ?? null)}`,
      );
      userIndicatorDesktopE2eAssert(
        Math.abs(savedPane.height - currentPane.getHeight()) <= 2,
        `range pane persisted height mismatch at ${label}: current=${currentPane.getHeight()}, saved=${savedPane.height}`,
      );
    };
    assertRangePanePersisted('initial-save');

    const originalSmaRecord = userIndicatorRecords.get('fixture.sma');
    userIndicatorDesktopE2eAssert(originalSmaRecord, 'original SMA record missing');
    const replacementSma = userIndicatorE2eSma
      .replace("indicatorVersion: 1", "indicatorVersion: 2")
      .replace("name: 'SMA Fixture'", "name: 'SMA Fixture V2'");
    await userIndicatorDesktopE2eImport(replacementSma, '01-sma-v2.tfi', 'fixture.sma');
    userIndicatorDesktopE2eAssert(userIndicatorRuntime.get(instances['fixture.sma'])?.indicatorVersion === 2, 'replacement did not update the same SMA instance');
    userIndicatorDesktopE2eAssert(userIndicatorRecords.get('fixture.sma')?.indicatorVersion === 2, 'SMA replacement not installed');
    userIndicatorDesktopE2eAssert(
      !loadedIndicatorState.unresolvedEntries.some((entry) => (
        userIndicatorDesktopE2eSavedId(entry) === 'fixture.sma'
        && (entry as { sourceHash?: unknown }).sourceHash === originalSmaRecord.sourceHash
      )),
      'successfully migrated SMA was incorrectly marked unresolved',
    );
    await userIndicatorDesktopE2eImport(userIndicatorE2eSma, '01-sma.tfi', 'fixture.sma');
    userIndicatorDesktopE2eAssert(userIndicatorRecords.get('fixture.sma')?.sourceHash === originalSmaRecord.sourceHash, 'original SMA hash not restored in library');
    assertRangePanePersisted('sma-reinstall');

    const originalPanelRecord = userIndicatorRecords.get('fixture.panel');
    userIndicatorDesktopE2eAssert(originalPanelRecord, 'panel record missing before delete');
    openUserIndicatorDeletePreview('fixture.panel');
    await confirmUserIndicatorLibraryChange();
    userIndicatorDesktopE2eAssert(userIndicatorRuntime.get(instances['fixture.panel']) === null, 'deleted panel instance still running');
    userIndicatorDesktopE2eAssert(!userIndicatorRecords.has('fixture.panel'), 'deleted panel library record still present');
    userIndicatorDesktopE2eAssert(
      loadedIndicatorState.unresolvedEntries.some((entry) => (
        userIndicatorDesktopE2eSavedId(entry) === 'fixture.panel'
        && (entry as { sourceHash?: unknown }).sourceHash === originalPanelRecord.sourceHash
      )),
      'deleted panel exact-hash state not preserved unresolved',
    );
    await userIndicatorDesktopE2eImport(userIndicatorE2ePanel, '05-panel.tfi', 'fixture.panel');
    userIndicatorDesktopE2eAssert(userIndicatorRecords.get('fixture.panel')?.sourceHash === originalPanelRecord.sourceHash, 'panel exact hash not reinstalled');
    assertRangePanePersisted('panel-reinstall');

    persistIndicatorState();
    assertRangePanePersisted('final-save');
    localStorage.setItem(USER_INDICATOR_DESKTOP_E2E_PHASE_KEY, 'restart-pending');
    userIndicatorDesktopE2eStatus(
      'USER_INDICATOR_E2E_PHASE1_PASS\nreal Worker/Validator=ok\nSeries/Pane/BarStyle/Canvas/Panel=ok\nselection rebuild=ok\ndead-loop isolation=ok\n50 create/remove cycles=ok\nreplace preserves instance; delete/reimport recovery=ok\nRESTART_REQUIRED',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('user_indicator.desktop_e2e_failed', error);
    userIndicatorDesktopE2eStatus(`USER_INDICATOR_E2E_FAIL\n${message}`);
  }
}

async function bootstrapApplication() {
  // Local restore is independent from foreground history and must not block it.
  void userDataController.initialize();
  void userTaskController.initialize();
  const failures = await registerExternalIndicators(indicatorRegistry);
  if (failures.length > 0) showChartToast(`${failures.length} 个用户指标加载失败`);
  loadedIndicatorState = loadIndicatorState(
    workspaceStorage,
    indicatorRegistry,
    [...activeIndicators],
    hiddenSeries,
  );
  userIndicatorDesktopE2eTraceBootstrap('after-load');
  try {
    userIndicatorStore = new MirroredUserIndicatorStore(new IndexedDbUserIndicatorStore(), workspaceStorage.native);
    userIndicatorLibrary = new UserIndicatorLibrary(userIndicatorStore, {
      trustedIndicatorIds: new Set(indicatorRegistry.list().map((definition) => definition.id)),
    });
    const scan = await userIndicatorLibrary.scan();
    userIndicatorRecords.clear();
    for (const record of scan.records) userIndicatorRecords.set(record.id, record);
    if (scan.corruptEntries.length > 0) {
      console.error('user_indicator.library.corrupt_entries', { count: scan.corruptEntries.length });
      showChartToast(`${scan.corruptEntries.length} 个用户指标记录已损坏，未加载`);
    }
    const resolved = resolveUserIndicatorStateEntries(
      loadedIndicatorState.unresolvedEntries,
      scan.records,
      new Set(loadedIndicatorState.instances.map((instance) => instance.instanceId)),
    );
    loadedIndicatorState = {
      ...loadedIndicatorState,
      instances: [...loadedIndicatorState.instances, ...resolved.instances]
        .sort((left, right) => left.menuOrder - right.menuOrder),
      unresolvedEntries: resolved.unresolvedEntries,
    };
  } catch (error) {
    userIndicatorStore = null;
    userIndicatorLibrary = null;
    userIndicatorRecords.clear();
    console.error('user_indicator.library.bootstrap_failed', error);
    showChartToast('用户指标库初始化失败');
  }
  const savedOverlayOrder = loadedIndicatorState.mainOverlayOrder.flatMap((entry) => entry.type === 'indicator' ? [entry.instanceId] : []);
  indicatorInstanceOrder = [
    ...savedOverlayOrder,
    ...loadedIndicatorState.instances.map((instance) => instance.instanceId).filter((instanceId) => !savedOverlayOrder.includes(instanceId)),
  ];
  indicatorStateReady = true;
  activeIndicators.clear();
  for (const legacyId of ['ma', 'ema', 'boll', 'macd', 'rsi'] as const) hiddenSeries.delete(legacyId);
  let restoreFailures = 0;
  for (const saved of loadedIndicatorState.instances) {
    try {
      indicatorChartHost.restorePaneStates(saved.instanceId, saved.panes);
      if (saved.runtimeKind === 'user') {
        const library = userIndicatorRecords.get(saved.indicatorId);
        if (!library
          || library.sourceHash !== saved.sourceHash
          || library.indicatorVersion !== saved.indicatorVersion) {
          throw new Error('user indicator source unavailable');
        }
        userIndicatorRuntime.add({
          instanceId: saved.instanceId,
          indicatorId: saved.indicatorId,
          sourceHash: saved.sourceHash,
          indicatorVersion: saved.indicatorVersion,
          inputs: saved.inputs,
          visible: saved.visible,
        }, library);
      } else {
        indicatorRuntime.add({
          instanceId: saved.instanceId,
          indicatorId: saved.indicatorId,
          indicatorVersion: saved.indicatorVersion,
          inputs: saved.inputs,
          visible: saved.visible,
        });
      }
      if (saved.runtimeKind !== 'user' && saved.indicatorId.startsWith('builtin.')) {
        const legacyId = saved.indicatorId.slice('builtin.'.length) as IndicatorName;
        activeIndicators.add(legacyId);
        if (!saved.visible) hiddenSeries.add(legacyId);
      }
    } catch {
      restoreFailures += 1;
      const runtime = saved.runtimeKind === 'user' ? userIndicatorRuntime : indicatorRuntime;
      try { runtime.remove(saved.instanceId); }
      catch { console.error('indicator.restore_cleanup_failed', { instanceId: saved.instanceId }); }
      loadedIndicatorState = {
        ...loadedIndicatorState,
        instances: loadedIndicatorState.instances.filter(item => item.instanceId !== saved.instanceId),
        unresolvedEntries: [...loadedIndicatorState.unresolvedEntries, saved],
      };
      indicatorInstanceOrder = indicatorInstanceOrder.filter(id => id !== saved.instanceId);
      console.warn('indicator.restore_failed', { instanceId: saved.instanceId });
    }
  }
  if (restoreFailures) showChartToast(`${restoreFailures} 个指标未能恢复，配置已保留；其他指标和行情可继续使用`);
  renderIndicatorPicker('');
  // The second flag is preserveRange, not persistence. Workers have not restored
  // their panes yet, so bootstrap must not overwrite the saved layout here.
  applyChartType(currentChartType, false, false);
  applyPriceScale(currentPriceScale, false);
  setVolumeActive(volumeVisible, false);
  applyMainSeriesOrder();
  applyIndicatorInstanceOrder(false);
  renderIndicatorLegends();
  renderSecondaryPaneOrder();
  renderWatchlist();
  renderResolutionControls();
  applyTradingTimeChoice(tradingTimeChoice, false);
  userIndicatorDesktopE2eTraceBootstrap('after-controls');
  window.setInterval(() => renderTradingTimeControls(), 1_000);
  const catalogLoad = loadMarketCatalogs();
  if (defaultSymbol.providerId === 'none') {
    await catalogLoad;
    defaultSymbol = preferredInitialMarketSymbol();
  }
  if (defaultSymbol.providerId === 'none') {
    showNoMarketProviderState();
  } else {
    await openHistory(defaultSymbol, currentResolution,
      defaultSymbol.kind === 'crypto' || defaultSymbol.kind === 'prediction' ? 'none' : currentAdjustment);
  }
  userIndicatorDesktopE2eTraceBootstrap('after-history');
  if (USER_INDICATOR_DESKTOP_E2E) await runUserIndicatorDesktopE2e();
}

void bootstrapApplication();

function scheduleLatestPoll(delayMs = currentSymbol.kind === 'crypto' && realtimeConnected
  ? 60_000
  : marketPollPlan(new Date(), document.hidden, currentSymbol.kind === 'crypto').delayMs) {
  if (latestPollTimer !== undefined) window.clearTimeout(latestPollTimer);
  if (currentSymbol.providerId === 'none' || !activeMarketProviderIds.has(currentSymbol.providerId)) {
    latestPollTimer = undefined;
    return;
  }
  latestPollTimer = window.setTimeout(async () => {
    const startedAt = performance.now();
    await pollLatestBars();
    const nextDelay = currentSymbol.kind === 'crypto' && realtimeConnected
      ? 60_000
      : marketPollPlan(new Date(), document.hidden, currentSymbol.kind === 'crypto').delayMs;
    scheduleLatestPoll(remainingPollDelay(nextDelay, performance.now() - startedAt));
  }, delayMs);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    const trustedBarTime = currentBars.at(-1)?.time;
    if (trustedBarTime !== undefined) {
      void recoverCurrentHistoryFrom(trustedBarTime, 'visibility', activeRealtimeRequestId);
    }
  }
  scheduleLatestPoll(document.hidden ? 60_000 : 0);
});
