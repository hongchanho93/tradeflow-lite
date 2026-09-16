import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
  createTextWatermark,
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
import { createLineToolsPlugin, type LineToolType } from 'lightweight-charts-line-tools-core';
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
import priceScaleGearIcon from './assets/price-scale-gear.svg?raw';
import addSymbolWidgetIcon from './assets/widget-bar/add-symbol.svg?raw';
import dataWindowWidgetIcon from './assets/widget-bar/data-window.svg?raw';
import marketDepthWidgetIcon from './assets/widget-bar/market-depth.svg?raw';
import moveDownWidgetIcon from './assets/widget-bar/move-down.svg?raw';
import moveUpWidgetIcon from './assets/widget-bar/move-up.svg?raw';
import refreshWidgetIcon from './assets/widget-bar/refresh.svg?raw';
import removeSymbolWidgetIcon from './assets/widget-bar/remove-symbol.svg?raw';
import watchlistWidgetIcon from './assets/widget-bar/watchlist.svg?raw';
import { LineToolUpArrow } from './drawing-tools/up-arrow';
import {
  barsForSeriesUpdate,
  initialVisibleLogicalRange,
  mergeDeepHistoryWithLiveTail,
  mergeLatestBars,
  updateLatestBarInPlace,
} from './bar-series';
import { BollingerBandPrimitive } from './boll-band';
import { candlestickColorOptions, chartColorWithOpacity, loadChartSettings, saveChartSettings, type ChartSettings } from './chart-settings';
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
  shouldLoadDeepHistory,
} from './history-loader';
import { LatestRequestGate } from './latest-request';
import { boll, bollBreakouts, ema, macd, rsi, sma, type BollBreakout, type OptionalValue } from './indicators';
import { marketPollPlan } from './market-session';
import marketUniversePackage from './market-universe.json';
import { binanceSpotSymbols } from './providers/binance/catalog';
import { binanceUsdMarginedSymbols } from './providers/binance/usdm-catalog';
import {
  listMarketSymbols,
  marketProviderKey,
  marketSymbolFromCatalog,
  type MarketCatalogPage,
  type MarketProviderDescriptor,
  type MarketSearchCategory,
  type MarketSearchSource,
  type MarketSymbol,
} from './market-universe';
import { exchangeLogoUrl, symbolLogoUrls } from './symbol-logos';
import { setStatusLabel } from './status-label';
import {
  isUsableQuote,
  matchesQuoteResponse,
  shouldFetchStandaloneQuote,
  type QuoteResponse,
  type QuoteSnapshot,
} from './quote';
import {
  canApplyRealtimeBar,
  isRealtimeSequenceFresh,
  marketDataRenderDelay,
  matchesRealtimeSelection,
  REALTIME_FRAME_FALLBACK_MS,
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
} from './watchlist';
import './style.css';
import './color-picker.css';

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

const appLocale = loadAppLocale(localStorage);
let appTheme = loadAppTheme(localStorage);
document.documentElement.lang = appLocale;
document.documentElement.classList.toggle('theme-light', appTheme === 'light');
document.documentElement.classList.toggle('theme-dark', appTheme === 'dark');
document.body.classList.toggle('theme-light', appTheme === 'light');
document.body.classList.toggle('theme-dark', appTheme === 'dark');
const ui = (value: string): string => translateUiText(value, appLocale);

const tdxDisplayName = '通达信主站';
const staticTdxSymbols: MarketSymbol[] = (marketUniversePackage as { rows: LegacyMarketSymbol[] }).rows.map((item) => ({
  ...item,
  providerId: item.providerId ?? 'tdx',
  providerDisplayName: item.providerDisplayName ?? tdxDisplayName,
  venue: item.venue ?? item.exchange,
  realtime: item.realtime ?? false,
  quote: true,
  baseAsset: item.baseAsset,
}));

let marketSymbols: MarketSymbol[] = [
  ...staticTdxSymbols,
  ...binanceSpotSymbols,
  ...binanceUsdMarginedSymbols,
];
const marketProviderById = new Map<string, MarketProviderDescriptor>();
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

const defaultSymbol = marketSymbols.find((item) => item.symbol === 'SH:600000' && item.kind === 'stock')!;
const kindLabels: Record<MarketSymbol['kind'], string> = { stock: '股票', etf: 'ETF', index: '指数', crypto: '数字货币', prediction: '预测市场' };
const kindMetaLabels: Record<Exclude<MarketSymbol['kind'], 'crypto' | 'prediction'>, string> = { stock: 'stock', etf: 'fund', index: 'index' };
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
let favoriteResolutions = loadFavoriteResolutions(localStorage);
let tradingTimeChoice: TradingTimeChoice = loadTradingTimeChoice(localStorage);
const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const historyRequestGate = new LatestRequestGate();
const historyCache = new HistoryMemoryCache<HistoryResponse>();
const historyRequests = new Map<string, Promise<HistoryResponse>>();
let currentBars: Bar[] = [];
let currentQuote: QuoteSnapshot | null = null;
let magnetEnabled = false;
let drawingsLocked = false;
let activeDrawingId: string | null = null;
let selectedDrawing: SelectedDrawing | null = null;
let suppressDrawingDeselect = false;
let latestPollInFlight = false;
let latestPollTimer: number | undefined;
let realtimeRequestSequence = realtimeRequestSeed(Date.now());
let activeRealtimeRequestId = 0;
let activeRealtimeProviderId = '';
let activeRealtimeProviderDisplayName = '';
const lastRealtimeSequenceByChannel = new Map<string, number>();
let realtimeConnected = false;
let realtimeBarRequestId = 0;
let latestDepth: RealtimeDepthEvent | null = null;
let recentTrades: RealtimeTradeEvent[] = [];
let activeMarketDataTab: 'depth' | 'trades' | 'rules' = 'depth';
let deepHistoryTimer: number | undefined;
let deepHistoryTimerKey = '';
let deepHistoryNavigationReady = false;
const deepHistoryLoading = new Set<string>();
const chartPreferences = loadChartPreferences(localStorage);
let chartSettings = loadChartSettings(localStorage);
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
let watchlistSymbols = loadWatchlist(localStorage, new Set(marketSymbolById.keys()));
const watchlistQuotes = new Map<string, QuoteSnapshot>();
let watchlistQuoteRefreshId = 0;
const drawingScopes = loadDrawingScopes(localStorage, knownDrawingTypes);
const markerScopes = loadMarkerScopes(localStorage);
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
      <div class="adjustment-switcher" aria-label="复权方式">
        <button data-adjustment="none" class="toolbar-button active">不复权</button>
        <button data-adjustment="qfq" class="toolbar-button">前复权</button>
      </div>
      <button id="volume-toggle" class="toolbar-button" aria-label="显示或隐藏成交量">${icons.indicator}<span>成交量</span></button>
      <details class="indicator-menu">
        <summary class="toolbar-button" aria-label="技术指标">${icons.indicator}<span>指标</span></summary>
        <div class="indicator-menu-panel">
          <button data-indicator="ma" aria-pressed="false"><strong>MA</strong><span>移动平均线 · 20</span></button>
          <button data-indicator="ema" aria-pressed="false"><strong>EMA</strong><span>指数移动平均 · 20</span></button>
          <button data-indicator="boll" aria-pressed="false"><strong>BOLL</strong><span>布林带 · 20, 2</span></button>
          <button data-indicator="macd" aria-pressed="false"><strong>MACD</strong><span>12, 26, 9 · 独立副图</span></button>
          <button data-indicator="rsi" aria-pressed="false"><strong>RSI</strong><span>相对强弱 · 14</span></button>
        </div>
      </details>
      <div class="toolbar-spacer"></div>
      <button id="status" class="connection-status" aria-label="正在连接" title="点击重新测速"><i></i><span>正在连接</span></button>
      <button id="refresh" class="toolbar-button" aria-label="刷新K线">${icons.refresh}</button>
      <button id="theme-toggle" class="toolbar-button" type="button" data-mode="${appTheme}" aria-label="${appTheme === 'light' ? '当前为亮色模式，点击切换到暗色模式' : '当前为暗色模式，点击切换到亮色模式'}" aria-pressed="${appTheme === 'light'}">${themeButtonIcons}</button>
      <button id="fit-chart" class="toolbar-button" aria-label="适应全部数据">${icons.fullscreen}</button>
      <button id="open-chart-settings" class="toolbar-button icon-only" aria-label="设置" title="设置">${priceScaleGearIcon}</button>
      <details id="chart-capture-menu" class="chart-control-menu chart-capture-menu">
        <summary class="toolbar-button icon-only" aria-label="生成快照" title="生成快照">${icons.camera}</summary>
        <div class="chart-control-menu-panel" aria-label="生成快照">
          <button id="save-chart" type="button" aria-label="下载图片">${icons.download}<span>下载图片</span></button>
          <button id="copy-chart" type="button" aria-label="复制图片">${icons.copy}<span>复制图片</span></button>
        </div>
      </details>
    </div>

    <div id="chart-settings-layer" class="chart-settings-layer" hidden>
      <section id="chart-settings-dialog" class="chart-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="chart-settings-title">
        <header class="chart-settings-header">
          <h2 id="chart-settings-title">设置</h2>
          <button id="close-chart-settings" type="button" aria-label="关闭设置">${icons.close}</button>
        </header>
        <nav class="chart-settings-tabs" aria-label="设置分类">
          <button type="button" data-settings-tab="symbol" aria-selected="true">${icons.indicator}<span>商品代码</span></button>
          <button type="button" data-settings-tab="status" aria-selected="false">${icons.layers}<span>状态行</span></button>
          <button type="button" data-settings-tab="scales" aria-selected="false">${icons.priceLine}<span>坐标和线条</span></button>
          <button type="button" data-settings-tab="appearance" aria-selected="false">${icons.fullscreen}<span>版面</span></button>
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
          </div>
          <div class="chart-settings-panel" data-settings-panel="appearance" hidden>
            <h3>版面</h3>
            <label class="chart-settings-row"><span>Trade Flow 水印</span><input data-chart-setting="watermarkVisible" type="checkbox" /></label>
            <label class="chart-settings-row"><span>底部时间导航</span><input data-chart-setting="timeNavigationVisible" type="checkbox" /></label>
            <label class="chart-settings-row"><span>语言</span><select id="language-select" aria-label="语言">
              <option value="zh-CN">简体中文</option><option value="en-US">English</option>
            </select></label>
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
          <button type="button" data-symbol-category="stock" aria-selected="false">股票</button>
          <button type="button" data-symbol-category="index" aria-selected="false">指数</button>
          <button type="button" data-symbol-category="etf" aria-selected="false">ETF</button>
          <button type="button" data-symbol-category="crypto" aria-selected="false">数字货币</button>
          <button type="button" data-symbol-category="prediction" aria-selected="false">预测市场</button>
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
            <button id="previous-close-toggle" class="price-line-menu-item" type="button" aria-label="昨收线" aria-pressed="true">${icons.horizontal}<span>昨收线</span><i></i></button>
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
        <div class="chart-meta">
          <div class="ohlc-legend" id="ohlc-legend">
            <span id="instrument-logo" class="instrument-logo"></span>
            <strong id="legend-symbol">浦发银行 · 1天 · SH</strong>
            <span id="legend-values" class="legend-values">开=-- 高=-- 低=-- 收=--</span>
          </div>
        </div>
        <div id="chart" aria-label="浦发银行日线图"></div>
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
        <div class="chart-brand" aria-label="Trade Flow">TF</div>
        <details id="price-scale-controls" class="price-scale-controls">
          <summary class="price-scale-gear" aria-label="价格轴设置" title="价格轴设置">${priceScaleGearIcon}</summary>
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
              <a id="prediction-resolution-source" href="#" target="_blank" rel="noreferrer" hidden>查看官方结算来源</a>
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
const maSeries = chart.addSeries(LineSeries, {
  color: '#2962ff', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, visible: false,
}, 0);
const emaSeries = chart.addSeries(LineSeries, {
  color: '#f6a623', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, visible: false,
}, 0);
const bollUpperSeries = chart.addSeries(LineSeries, {
  color: '#9c6ade', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, visible: false,
}, 0);
const bollMiddleSeries = chart.addSeries(LineSeries, {
  color: '#b0bec5', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, visible: false,
}, 0);
const bollLowerSeries = chart.addSeries(LineSeries, {
  color: '#9c6ade', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, visible: false,
}, 0);
const bollBand = new BollingerBandPrimitive();
candleSeries.attachPrimitive(bollBand);
const seriesMarkerApis: Record<ChartType, ISeriesMarkersPluginApi<Time>> = {
  candles: createSeriesMarkers(candleSeries, [], { autoScale: true, zOrder: 'top' }),
  bars: createSeriesMarkers(barSeries, [], { autoScale: true, zOrder: 'top' }),
  line: createSeriesMarkers(closeLineSeries, [], { autoScale: true, zOrder: 'top' }),
  area: createSeriesMarkers(areaSeries, [], { autoScale: true, zOrder: 'top' }),
  baseline: createSeriesMarkers(baselineSeries, [], { autoScale: true, zOrder: 'top' }),
};
let bollSignalMarkers: SeriesMarker<Time>[] = [];
let macdPane: {
  pane: IPaneApi<Time>;
  dif: ISeriesApi<'Line', Time>;
  dea: ISeriesApi<'Line', Time>;
  histogram: ISeriesApi<'Histogram', Time>;
} | null = null;
let rsiPane: { pane: IPaneApi<Time>; line: ISeriesApi<'Line', Time> } | null = null;

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

const chartWatermark = createTextWatermark(chart.panes()[0], {
  visible: chartSettings.watermarkVisible,
  horzAlign: 'left', vertAlign: 'bottom',
  lines: [{ text: 'TF', color: initialThemePalette.watermark, fontSize: 24 }],
});

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
const watchlistAdd = document.querySelector<HTMLButtonElement>('#watchlist-add')!;
const widgetBar = document.querySelector<HTMLElement>('#widget-bar')!;
const widgetBarResizer = document.querySelector<HTMLElement>('#widget-bar-resizer')!;
const widgetBarPages = widgetBar.querySelector<HTMLElement>('.widget-bar-pages')!;
const watchlistToggle = document.querySelector<HTMLButtonElement>('#watchlist-toggle')!;
const marketDataToggle = document.querySelector<HTMLButtonElement>('#market-data-toggle')!;
const drawingManagerToggle = document.querySelector<HTMLButtonElement>('#drawing-manager-toggle')!;
const dataWindowToggle = document.querySelector<HTMLButtonElement>('#data-window-toggle')!;
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
const previousCloseToggle = document.querySelector<HTMLButtonElement>('#previous-close-toggle')!;
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
const chartSettingsTimeZone = document.querySelector<HTMLSelectElement>('#chart-settings-time-zone')!;
const chartSettingInputs = [...chartSettingsDialog.querySelectorAll<HTMLInputElement>('[data-chart-setting]')];
const chartSettingOpacityInputs = [...chartSettingsDialog.querySelectorAll<HTMLInputElement>('[data-chart-opacity-setting]')];
const chartSettingsTabs = [...chartSettingsDialog.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')];
const languageSelect = document.querySelector<HTMLSelectElement>('#language-select')!;
let chartSettingsReturnFocus: HTMLElement | null = null;
const drawingButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-drawing-tool]')];
const drawingMenus = [...document.querySelectorAll<HTMLDetailsElement>('.drawing-tool-menu')];
const drawingPropertyControls = [...drawingProperties.querySelectorAll<HTMLDetailsElement>('.drawing-property-control')];
let pendingTextButton: HTMLButtonElement | null = null;
const SYMBOL_RESULT_PAGE_SIZE = 80;
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
  if (!saveChartPreferences(localStorage, chartPreferences)) showChartToast('图表设置未能保存');
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
  if (persist && !saveTradingTimeChoice(localStorage, tradingTimeChoice)) showChartToast('交易时间设置未能保存');
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

  const palette = appThemePalette(appTheme);
  chart.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: palette.background },
      textColor: palette.text,
      panes: { separatorColor: palette.paneSeparator, separatorHoverColor: palette.paneSeparatorHover },
    },
    grid: {
      vertLines: { color: palette.grid },
      horzLines: { color: palette.grid },
    },
    crosshair: {
      vertLine: { color: palette.crosshair, labelBackgroundColor: palette.crosshairLabel },
      horzLine: { color: palette.crosshair, labelBackgroundColor: palette.crosshairLabel },
    },
    timeScale: { borderColor: palette.border },
    rightPriceScale: { borderColor: palette.border },
  });
  chartWatermark.applyOptions({ lines: [{ text: 'TF', color: palette.watermark, fontSize: 24 }] });
  if (persist && !saveAppTheme(localStorage, appTheme)) showChartToast('主题设置未能保存');
}

function applyChartSettings(settings: ChartSettings) {
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
  document.querySelector<HTMLElement>('.chart-brand')!.hidden = !settings.watermarkVisible;
  chartWatermark.applyOptions({ visible: settings.watermarkVisible });
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
  const now = new Date();
  for (const option of TRADING_TIME_ZONE_OPTIONS) {
    const element = [...chartSettingsTimeZone.options].find((item) => item.value === option.value);
    if (!element) continue;
    const zone = resolveTradingTimeZone(option.value, exchangeTimeZone(), systemTimeZone);
    element.textContent = `(${formatUtcOffset(timeZoneOffsetMinutes(now, zone))}) ${option.label}`;
  }
  chartSettingsTimeZone.value = tradingTimeChoice;
  languageSelect.value = appLocale;
  selectChartSettingsTab('symbol');
  chartSettingsLayer.hidden = false;
  requestAnimationFrame(() => chartSettingsTabs[0]?.focus());
}

function closeChartSettings() {
  chartSettingsLayer.hidden = true;
  chartSettingsReturnFocus?.focus();
  chartSettingsReturnFocus = null;
}

function confirmChartSettings() {
  const next = { ...chartSettings };
  for (const input of chartSettingInputs) {
    const key = input.dataset.chartSetting as keyof ChartSettings;
    (next as unknown as Record<string, string | boolean>)[key] = input.type === 'checkbox' ? input.checked : input.value;
  }
  for (const input of chartSettingOpacityInputs) {
    const key = input.dataset.chartOpacitySetting as keyof ChartSettings;
    (next as unknown as Record<string, number>)[key] = Number(input.value);
  }
  chartSettings = next;
  applyChartSettings(chartSettings);
  applyTradingTimeChoice(chartSettingsTimeZone.value as TradingTimeChoice);
  if (!saveChartSettings(localStorage, chartSettings)) showChartToast('设置未能保存');
  const nextLocale = APP_LOCALES.includes(languageSelect.value as AppLocale)
    ? languageSelect.value as AppLocale
    : appLocale;
  if (nextLocale !== appLocale) {
    if (!saveAppLocale(localStorage, nextLocale)) {
      showChartToast('语言设置未能保存');
      return;
    }
    window.location.reload();
    return;
  }
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
  previousCloseToggle.classList.toggle('active', settings.previousClose);
  previousCloseToggle.setAttribute('aria-pressed', String(settings.previousClose));
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
  candleSeries.setData(currentBars.map((bar) => candlePoint(bar)));
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

function applyChartType(chartType: ChartType, preserveRange = true, persist = true) {
  if (currentSeriesKind === 'probability' && chartType !== 'line') {
    showChartToast('预测市场使用概率折线，不提供伪造 K 线');
    return;
  }
  const range = preserveRange ? chart.timeScale().getVisibleLogicalRange() : null;
  currentChartType = chartType;
  setPrimarySeriesData();
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

function applyPriceScale(setting: PriceScaleSetting) {
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
  persistChartPreferences();
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
  label.textContent = exchange;
  badge.append(image, label);
  symbolLogoObserver.observe(image);
  return badge;
}

function persistWatchlist() {
  const persisted = watchlistSymbols.map((symbolId) => {
    const item = marketSymbolById.get(symbolId);
    return item ? watchlistSymbolKey(item.providerId, item.symbol) : symbolId;
  });
  if (!saveWatchlist(localStorage, persisted)) {
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
  if (watchlistSymbols.length >= 100) {
    errorLayer.hidden = false;
    errorLayer.textContent = '自选最多保存 100 个证券';
    return false;
  }
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
    row.children[0].textContent = realtimeTimeFormatter.format(new Date(trade.tradeTimeMs));
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
  try {
    const url = new URL(metadata.resolutionSource);
    const safe = url.protocol === 'https:' || url.protocol === 'http:';
    predictionResolutionSource.hidden = !safe;
    if (safe) predictionResolutionSource.href = url.href;
  } catch {
    predictionResolutionSource.hidden = true;
    predictionResolutionSource.removeAttribute('href');
  }
}

function renderMarketDataPanel() {
  const supported = isRealtimeMarketDataSupported();
  const prediction = currentSymbol.kind === 'prediction' && currentSymbol.prediction !== undefined;
  if (!prediction && activeMarketDataTab === 'rules') activeMarketDataTab = 'depth';
  marketDataSymbol.textContent = currentSymbol.code;
  marketDataTitle.textContent = activeMarketDataTab === 'depth' ? '盘口' : activeMarketDataTab === 'trades' ? '成交' : '规则';
  predictionRulesTab.hidden = !prediction;
  marketDataUnavailable.hidden = supported;
  marketDepthView.hidden = !supported || activeMarketDataTab !== 'depth';
  marketTradesView.hidden = !supported || activeMarketDataTab !== 'trades';
  predictionRulesView.hidden = !prediction || activeMarketDataTab !== 'rules';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-market-data-tab]')) {
    button.setAttribute('aria-selected', String(button.dataset.marketDataTab === activeMarketDataTab));
  }
  if (prediction) renderPredictionRules();
  if (!supported || activeMarketDataTab === 'rules') return;
  if (activeMarketDataTab === 'depth') renderMarketDepth();
  else renderMarketTrades();
}

function resetMarketData() {
  latestDepth = null;
  recentTrades = [];
  pendingRealtimeBars.clear();
  cancelRealtimeFrameSchedule();
  pendingRealtimeDepth = null;
  pendingRealtimeTrades = [];
  if (marketDataTimerId !== undefined) window.clearTimeout(marketDataTimerId);
  marketDataTimerId = undefined;
  lastMarketDataRenderAt = 0;
  if (realtimeIndicatorTimerId !== undefined) window.clearTimeout(realtimeIndicatorTimerId);
  realtimeIndicatorTimerId = undefined;
  pendingRealtimeIndicatorTimes.clear();
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
  return validateDrawingSnapshot(lineTools.exportLineTools(), knownDrawingTypes);
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
  if (!saveMarkerScopes(localStorage, markerScopes)) showChartToast('标记未能保存');
  renderSeriesMarkers();
  if (!drawingManager.hidden) renderDrawingManager();
}

function renderSeriesMarkers() {
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
  const combined = [...bollSignalMarkers, ...manual]
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
    volume: [volumeSeries], ma: [maSeries], ema: [emaSeries],
    boll: [bollUpperSeries, bollMiddleSeries, bollLowerSeries],
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
  if (series === 'ma') maSeries.applyOptions({ visible });
  if (series === 'ema') emaSeries.applyOptions({ visible });
  if (series === 'boll') {
    bollUpperSeries.applyOptions({ visible });
    bollMiddleSeries.applyOptions({ visible });
    bollLowerSeries.applyOptions({ visible });
    if (visible) refreshIndicators();
    else clearBollPresentation();
  }
  if (series === 'macd' && macdPane) {
    macdPane.dif.applyOptions({ visible });
    macdPane.dea.applyOptions({ visible });
    macdPane.histogram.applyOptions({ visible });
  }
  if (series === 'rsi' && rsiPane) rsiPane.line.applyOptions({ visible });
}

function setIndicatorActive(indicator: IndicatorName, active: boolean, persist = true) {
  if (active) {
    activeIndicators.add(indicator);
    if (persist) hiddenSeries.delete(indicator);
    if (indicator === 'macd') ensureMacdPane();
    if (indicator === 'rsi') ensureRsiPane();
    refreshIndicators();
  } else {
    activeIndicators.delete(indicator);
    hiddenSeries.delete(indicator);
    if (indicator === 'ma') maSeries.applyOptions({ visible: false });
    if (indicator === 'ema') emaSeries.applyOptions({ visible: false });
    if (indicator === 'boll') clearBollPresentation();
    if (indicator === 'macd') removeMacdPane();
    if (indicator === 'rsi') removeRsiPane();
  }
  const button = document.querySelector<HTMLButtonElement>(`[data-indicator="${indicator}"]`)!;
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
  applyManagedSeriesVisibility(indicator);
  applyMainSeriesOrder();
  if (persist) persistChartPreferences();
  if (!drawingManager.hidden) renderDrawingManager();
}

function setVolumeActive(active: boolean, persist = true) {
  volumeVisible = active;
  if (active && persist) hiddenSeries.delete('volume');
  if (!active) hiddenSeries.delete('volume');
  const button = document.querySelector<HTMLButtonElement>('#volume-toggle')!;
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
  applyManagedSeriesVisibility('volume');
  applyMainSeriesOrder();
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

function renderDrawingManager() {
  const drawings = currentDrawingExports();
  const paneItems = activeSecondaryPanes();
  const markers = currentMarkers();
  const mainItems = mainSeriesOrder.filter((series) => isManagedSeriesActive(series));
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

  if (paneItems.length > 0) {
    appendSection('副图');
    for (const [index, item] of paneItems.entries()) {
      const row = document.createElement('div');
      row.className = 'drawing-manager-row managed-series-row object-tree-pane-order';
      const name = document.createElement('span');
      name.textContent = item.id.toUpperCase();
      row.append(name, visibilityButtonFor(item.id));
      for (const [label, direction] of [['↑', -1], ['↓', 1]] as const) {
        const button = document.createElement('button');
        button.textContent = label;
        button.title = direction < 0 ? '上移副图' : '下移副图';
        button.disabled = direction < 0 ? index === 0 : index === paneItems.length - 1;
        button.addEventListener('click', () => {
          secondaryPaneOrder = movePaneOrder(secondaryPaneOrder, item.id, direction);
          applySecondaryPaneOrder();
          persistChartPreferences();
        });
        row.append(button);
      }
      const removeButton = document.createElement('button');
      removeButton.innerHTML = icons.trash;
      removeButton.className = 'danger';
      removeButton.title = '移除副图';
      removeButton.addEventListener('click', () => setIndicatorActive(item.id, false));
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

function persistDrawingSnapshot(snapshot: string) {
  drawingScopes.set(currentDrawingScope(), snapshot);
  if (!saveDrawingScopes(localStorage, drawingScopes)) {
    errorLayer.hidden = false;
    errorLayer.textContent = '绘图保存失败：本地存储空间不足或不可用';
  }
}

function commitDrawingState() {
  if (restoringDrawings) return;
  const snapshot = currentDrawingSnapshot();
  if (!snapshot) {
    errorLayer.hidden = false;
    errorLayer.textContent = '绘图状态校验失败，本次修改未保存';
    return;
  }
  drawingHistory.record(snapshot);
  persistDrawingSnapshot(snapshot);
  renderDrawingManager();
}

function applyDrawingSnapshot(snapshot: string): boolean {
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
  commitDrawingState();
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

function indicatorPoints(values: OptionalValue[]) {
  return values.flatMap((value, index) => value === null ? [] : [{
    time: currentBars[index].time as UTCTimestamp,
    value,
  }]);
}

function updateIndicatorSeries(
  series: typeof maSeries,
  values: OptionalValue[],
  updatedTimes?: number[],
) {
  if (!updatedTimes) {
    series.setData(indicatorPoints(values));
    return;
  }
  for (const time of updatedTimes) {
    const index = currentBars.findIndex((bar) => bar.time === time);
    const value = index < 0 ? null : values[index];
    if (value !== null) series.update({ time: time as UTCTimestamp, value }, true);
  }
}

const bollUpperBreakoutColor = '#f6c344';
const bollLowerBreakoutColor = '#2962ff';

function candlePoint(bar: Bar, signal: BollBreakout = null): CandlestickData<UTCTimestamp> {
  const point: CandlestickData<UTCTimestamp> = {
    time: bar.time as UTCTimestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  };
  if (primarySeriesVisible && currentChartType === 'candles' && signal === 'upper') point.color = bollUpperBreakoutColor;
  if (primarySeriesVisible && currentChartType === 'candles' && signal === 'lower') point.color = bollLowerBreakoutColor;
  return point;
}

function updateBollPresentation(
  bands: ReturnType<typeof boll>,
  updatedTimes?: number[],
) {
  const signals = bollBreakouts(currentBars.map((bar) => bar.close), bands.upper, bands.lower);
  if (!updatedTimes) {
    candleSeries.setData(currentBars.map((bar, index) => candlePoint(bar, signals[index])));
  } else {
    for (const time of updatedTimes) {
      const index = currentBars.findIndex((bar) => bar.time === time);
      if (index >= 0) candleSeries.update(candlePoint(currentBars[index], signals[index]), true);
    }
  }
  bollBand.setData(currentBars.flatMap((bar, index) => {
    const upper = bands.upper[index];
    const lower = bands.lower[index];
    return upper === null || lower === null ? [] : [{
      time: bar.time as UTCTimestamp,
      upper,
      lower,
    }];
  }), true);
  const markers: SeriesMarker<Time>[] = [];
  for (const [index, signal] of signals.entries()) {
    if (signal === 'upper') markers.push({
      time: currentBars[index].time as UTCTimestamp,
      position: 'aboveBar',
      shape: 'arrowUp',
      color: bollUpperBreakoutColor,
      text: ui('突破上轨'),
      size: 1,
    });
    if (signal === 'lower') markers.push({
      time: currentBars[index].time as UTCTimestamp,
      position: 'belowBar',
      shape: 'arrowDown',
      color: bollLowerBreakoutColor,
      text: ui('跌破下轨'),
      size: 1,
    });
  }
  bollSignalMarkers = hiddenSeries.has('boll') ? [] : markers;
  renderSeriesMarkers();
}

function clearBollPresentation() {
  bollBand.setData([], false);
  bollSignalMarkers = [];
  renderSeriesMarkers();
  candleSeries.setData(currentBars.map((bar) => candlePoint(bar)));
}

function ensureMacdPane() {
  if (macdPane) return;
  const pane = chart.addPane(false);
  const paneIndex = pane.paneIndex();
  macdPane = {
    pane,
    dif: chart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIndex),
    dea: chart.addSeries(LineSeries, { color: '#f6a623', lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIndex),
    histogram: chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex),
  };
  pane.setHeight(130);
  applySecondaryPaneOrder();
}

function ensureRsiPane() {
  if (rsiPane) return;
  const pane = chart.addPane(false);
  const paneIndex = pane.paneIndex();
  rsiPane = {
    pane,
    line: chart.addSeries(LineSeries, { color: '#9c6ade', lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, paneIndex),
  };
  pane.setHeight(110);
  applySecondaryPaneOrder();
}

function removeMacdPane() {
  if (!macdPane) return;
  const { pane, dif, dea, histogram } = macdPane;
  const paneIndex = pane.paneIndex();
  chart.removeSeries(dif);
  chart.removeSeries(dea);
  chart.removeSeries(histogram);
  if (chart.panes().includes(pane)) chart.removePane(paneIndex);
  macdPane = null;
  renderSecondaryPaneOrder();
}

function removeRsiPane() {
  if (!rsiPane) return;
  const { pane, line } = rsiPane;
  const paneIndex = pane.paneIndex();
  chart.removeSeries(line);
  if (chart.panes().includes(pane)) chart.removePane(paneIndex);
  rsiPane = null;
  renderSecondaryPaneOrder();
}

function secondaryPaneById(id: SecondaryPane): IPaneApi<Time> | null {
  return id === 'macd' ? macdPane?.pane ?? null : rsiPane?.pane ?? null;
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
  renderSecondaryPaneOrder();
}

function renderSecondaryPaneOrder() {
  if (!drawingManager.hidden) renderDrawingManager();
}

function refreshIndicators(updatedTimes?: number[]) {
  if (currentSeriesKind === 'probability') {
    maSeries.setData([]);
    emaSeries.setData([]);
    bollUpperSeries.setData([]);
    bollMiddleSeries.setData([]);
    bollLowerSeries.setData([]);
    clearBollPresentation();
    if (macdPane) {
      macdPane.dif.setData([]);
      macdPane.dea.setData([]);
      macdPane.histogram.setData([]);
    }
    if (rsiPane) rsiPane.line.setData([]);
    return;
  }
  if (activeIndicators.size === 0 || currentBars.length === 0) return;
  const closes = currentBars.map((bar) => bar.close);
  if (activeIndicators.has('ma')) updateIndicatorSeries(maSeries, sma(closes, 20), updatedTimes);
  if (activeIndicators.has('ema')) updateIndicatorSeries(emaSeries, ema(closes, 20), updatedTimes);
  if (activeIndicators.has('boll')) {
    const bands = boll(closes, 20, 2);
    updateIndicatorSeries(bollUpperSeries, bands.upper, updatedTimes);
    updateIndicatorSeries(bollMiddleSeries, bands.middle, updatedTimes);
    updateIndicatorSeries(bollLowerSeries, bands.lower, updatedTimes);
    if (hiddenSeries.has('boll')) clearBollPresentation();
    else updateBollPresentation(bands, updatedTimes);
  }
  if (activeIndicators.has('macd') && macdPane) {
    const values = macd(closes);
    updateIndicatorSeries(macdPane.dif, values.dif, updatedTimes);
    updateIndicatorSeries(macdPane.dea, values.dea, updatedTimes);
    const histogramPoints = values.histogram.flatMap((value, index) => value === null ? [] : [{
      time: currentBars[index].time as UTCTimestamp,
      value,
      color: value >= 0 ? 'rgba(8, 153, 129, .6)' : 'rgba(242, 54, 69, .6)',
    }]);
    if (!updatedTimes) macdPane.histogram.setData(histogramPoints);
    else {
      for (const time of updatedTimes) {
        const point = histogramPoints.find((item) => Number(item.time) === time);
        if (point) macdPane.histogram.update(point, true);
      }
    }
  }
  if (activeIndicators.has('rsi') && rsiPane) {
    updateIndicatorSeries(rsiPane.line, rsi(closes, 14), updatedTimes);
  }
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
    marketProviderById.clear();
    marketCatalogLoadStates.clear();
    for (const descriptor of descriptors) marketProviderById.set(descriptor.id, descriptor);
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
      }
    }
  } catch (error) {
    console.warn('market.catalog.descriptors_unavailable', {
      error: error instanceof Error ? error.message : String(error),
      curated: binanceSpotSymbols.length + binanceUsdMarginedSymbols.length,
    });
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
      limit: 100,
    });
    const dynamicSymbols = page.symbols
      .filter((row) => row.providerId === state.descriptor.id)
      .map((row) => marketSymbolFromCatalog(row, state.descriptor, state.venue));
    const incoming = new Set(dynamicSymbols.map((item) => marketProviderKey(item.providerId, item.symbol)));
    marketSymbols = [
      ...marketSymbols.filter((item) => {
        if (state.pages === 0 && item.providerId === state.descriptor.id && item.venue === state.venue) return false;
        return !incoming.has(marketProviderKey(item.providerId, item.symbol));
      }),
      ...dynamicSymbols,
    ];
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
  const sources = symbolSources[activeSymbolCategory];
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
    const marketType = item.kind === 'crypto' || item.kind === 'prediction'
      ? item.providerDisplayName
      : kindMetaLabels[item.kind];
    kind.append(document.createTextNode(marketType), createExchangeBadge(item.exchange));
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
    setStatusLabel(status, `${symbol.providerDisplayName} · 报价降级，保留 K 线`);
    return;
  }
  currentQuote = quote;
  renderPriceLines();
  showCurrentSnapshot();
  const cacheKey = historyCacheKey(symbol.providerId, symbol.symbol, resolution, adjustment);
  const cached = historyCache.get(cacheKey);
  if (cached) historyCache.set(cacheKey, { ...cached.value, quote }, cached.deep);
}

async function selectSymbol(symbol: MarketSymbol) {
  input.value = symbol.code;
  closeSymbolResults();
  await openHistory(symbol, currentResolution, symbol.kind === 'crypto' || symbol.kind === 'prediction' ? 'none' : currentAdjustment);
}

function marketHistoryCacheKey(symbol: MarketSymbol, resolution: Resolution, adjustment: Adjustment): string {
  return historyCacheKey(symbol.providerId, symbol.symbol, resolution, adjustment);
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

function requestHistory(
  symbol: MarketSymbol,
  resolution: Resolution,
  adjustment: Adjustment,
  count: number,
) {
  const requestKey = `${marketHistoryCacheKey(symbol, resolution, adjustment)}|${count}`;
  const existing = historyRequests.get(requestKey);
  if (existing) return existing;
  const request = invoke<HistoryResponse>('get_history_bars', {
    symbol: symbol.symbol,
    providerId: symbol.providerId,
    kind: symbol.kind,
    resolution,
    adjustment,
    count,
    includeQuote: false,
  }).then(normalizeProbabilityHistory).finally(() => historyRequests.delete(requestKey));
  historyRequests.set(requestKey, request);
  return request;
}

function replaceHistorySeries(bars: Bar[], preserveVisibleRange: boolean) {
  const visibleRange = preserveVisibleRange ? chart.timeScale().getVisibleRange() : null;
  deepHistoryNavigationReady = false;
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
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-indicator]')) {
    button.disabled = currentSeriesKind === 'probability';
  }
  document.querySelector<HTMLButtonElement>('#volume-toggle')!.disabled = currentSeriesKind === 'probability';
  legendSymbol.textContent = currentSeriesKind === 'probability'
    ? `${symbol.name} · ${symbol.prediction?.outcome ?? 'YES'} · ${resolutionLabels[currentResolution]}`
    : `${symbol.name} · ${resolutionLabels[currentResolution]} · ${symbol.exchange}${currentAdjustment === 'qfq' ? ' · 前复权' : ''}`;
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
    `${symbol.name}${resolutionLabels[currentResolution]}${currentSeriesKind === 'probability' ? '概率走势图' : 'K线图'}`,
  );
  showLatest(response.bars);
  status.className = 'connection-status ready';
  const statusText = source === 'memory'
    ? `${symbol.providerDisplayName} · 缓存 · ${response.diagnostics.host}`
    : `${symbol.providerDisplayName} · ${response.diagnostics.host} · ${response.diagnostics.latencyMs}ms`;
  setStatusLabel(status, statusText);
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
) {
  const cacheKey = marketHistoryCacheKey(symbol, resolution, adjustment);
  if (getHistoryCache(symbol, resolution, adjustment)?.deep || deepHistoryLoading.has(cacheKey)) return;
  deepHistoryLoading.add(cacheKey);
  try {
    const response = await requestHistory(symbol, resolution, adjustment, deepHistoryBars(resolution));
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
    const isCurrentRequest = isCurrentMarketSelection(symbol, resolution, adjustment);
    const displayResponse = isCurrentRequest
      ? {
          ...response,
          bars: mergeDeepHistoryWithLiveTail(
            response.bars,
            currentBars,
            realtimeBarRequestId === activeRealtimeRequestId,
          ),
        }
      : response;
    historyCache.set(cacheKey, displayResponse, true);
    if (!isCurrentRequest) return;
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
    console.error('market.history.deep_error', {
      symbol: symbol.symbol,
      resolution,
      adjustment,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    deepHistoryLoading.delete(cacheKey);
    if (isCurrentMarketSelection(symbol, resolution, adjustment)) scheduleLatestPoll(0);
  }
}

function scheduleDeepHistory(
  symbol: MarketSymbol,
  resolution: Resolution,
  adjustment: Adjustment,
  delayMs = DEEP_HISTORY_DELAY_MS,
) {
  const cacheKey = marketHistoryCacheKey(symbol, resolution, adjustment);
  if (getHistoryCache(symbol, resolution, adjustment)?.deep || deepHistoryLoading.has(cacheKey)) return;
  if (deepHistoryTimer !== undefined && deepHistoryTimerKey === cacheKey) return;
  clearDeepHistoryTimer();
  deepHistoryTimerKey = cacheKey;
  deepHistoryTimer = window.setTimeout(() => {
    deepHistoryTimer = undefined;
    deepHistoryTimerKey = '';
    void loadDeepHistory(symbol, resolution, adjustment);
  }, delayMs);
}

async function openHistory(
  requestedSymbol = resolveInputSymbol(),
  requestedResolution: Resolution = currentResolution,
  requestedAdjustment: Adjustment = currentAdjustment,
) {
  const match = requestedSymbol;
  if (!match) {
    errorLayer.hidden = false;
    errorLayer.textContent = '没有找到这个行情品种';
    return;
  }
  if (match.kind === 'crypto' || match.kind === 'prediction') requestedAdjustment = 'none';
  const generation = historyRequestGate.begin();
  stopRealtimeMarket();
  clearDeepHistoryTimer();
  if (latestPollTimer !== undefined) window.clearTimeout(latestPollTimer);
  latestPollTimer = undefined;
  errorLayer.hidden = true;
  const cacheKey = marketHistoryCacheKey(match, requestedResolution, requestedAdjustment);
  const cached = getHistoryCache(match, requestedResolution, requestedAdjustment);
  if (cached) {
    loadingLayer.hidden = true;
    showHistory(cached.value, match, requestedResolution, requestedAdjustment, 'memory');
    void refreshMissingHistoryQuote(
      cached.value,
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
    if (cached.deep) scheduleLatestPoll(0);
    return;
  }
  loadingLayer.hidden = false;
  status.className = 'connection-status loading';
  setStatusLabel(status, `正在打开 ${match.providerDisplayName} · ${match.code}`);
  const startedAt = performance.now();
  try {
    const response = await requestHistory(match, requestedResolution, requestedAdjustment, INITIAL_HISTORY_BARS);
    historyCache.set(cacheKey, response, false);
    if (!historyRequestGate.isCurrent(generation)) return;
    showHistory(response, match, requestedResolution, requestedAdjustment, 'network');
    void refreshMissingHistoryQuote(
      response,
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
      source: 'network',
      bars: response.bars.length,
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  } catch (error) {
    if (!historyRequestGate.isCurrent(generation)) return;
    const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error);
    errorLayer.hidden = false;
    errorLayer.textContent = `${match.name} 加载失败，图表保留上一份有效数据 · ${message}`;
    status.className = 'connection-status error';
    setStatusLabel(status, `${match.providerDisplayName} 连接异常`);
  } finally {
    if (historyRequestGate.isCurrent(generation)) loadingLayer.hidden = true;
  }
}

async function pollLatestBars() {
  if (document.hidden || latestPollInFlight || currentBars.length === 0) return;
  const generation = historyRequestGate.current();
  const symbol = currentSymbol;
  const resolution = currentResolution;
  const adjustment = currentAdjustment;
  latestPollInFlight = true;
  try {
    const response = await invoke<HistoryResponse>('get_history_bars', {
      providerId: symbol.providerId,
      symbol: symbol.symbol,
      kind: symbol.kind,
      resolution,
      adjustment,
      count: 2,
      includeQuote: true,
    });
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
    const seriesUpdates = barsForSeriesUpdate(currentBars, response.bars);
    currentBars = mergeLatestBars(currentBars, response.bars);
    const cacheKey = marketHistoryCacheKey(symbol, resolution, adjustment);
    const cached = getHistoryCache(symbol, resolution, adjustment);
    historyCache.set(cacheKey, { ...response, bars: currentBars, quote: latestQuote ?? undefined }, cached?.deep ?? false);
    for (const bar of seriesUpdates) {
      updatePrimarySeries(bar);
      volumeSeries.update({
        time: bar.time as UTCTimestamp,
        value: bar.volume,
        color: bar.close >= bar.open ? 'rgba(8, 153, 129, .48)' : 'rgba(242, 54, 69, .48)',
      });
    }
    refreshIndicators(response.bars.map((bar) => bar.time));
    if (latestQuote) {
      currentQuote = latestQuote;
      renderPriceLines();
    }
    showCurrentSnapshot();
    status.className = 'connection-status ready';
    const statusText = quoteDegraded
      ? `${symbol.providerDisplayName} · ${response.diagnostics.host} · 报价降级，保留 K 线`
      : `${symbol.providerDisplayName} · ${response.diagnostics.host} · ${response.diagnostics.latencyMs}ms`;
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
      setStatusLabel(status, `${symbol.providerDisplayName} 实时更新暂停，保留最后数据`);
    }
  } finally {
    latestPollInFlight = false;
  }
}

function stopRealtimeMarket() {
  const requestId = ++realtimeRequestSequence;
  activeRealtimeRequestId = requestId;
  activeRealtimeProviderId = '';
  activeRealtimeProviderDisplayName = '';
  lastRealtimeSequenceByChannel.clear();
  realtimeConnected = false;
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
  realtimeConnected = false;
  await realtimeListenersReady;
  if (!historyRequestGate.isCurrent(historyGeneration)
    || currentSymbol.providerId !== symbol.providerId
    || currentSymbol.symbol !== symbol.symbol
    || currentResolution !== resolution) return;
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
    setStatusLabel(status, `${symbol.providerDisplayName} 实时连接失败，已使用轮询`);
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
  if (historicalClose) {
    currentBars[currentBars.length - 2] = event.bar;
    console.debug('market.realtime.late_close_applied', {
      symbol: event.symbol,
      resolution: event.resolution,
      closedBarTime: event.bar.time,
      latestBarTime: latestTime,
    });
  } else if (updateLatestBarInPlace(currentBars, event.bar) === 'rejected') {
    return false;
  }
  updatePrimarySeries(event.bar, historicalClose);
  volumeSeries.update({
    time: event.bar.time as UTCTimestamp,
    value: event.bar.volume,
    color: event.bar.close >= event.bar.open ? 'rgba(8, 153, 129, .48)' : 'rgba(242, 54, 69, .48)',
  }, historicalClose);
  scheduleRealtimeIndicators(event.bar.time);
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
const pendingRealtimeIndicatorTimes = new Set<number>();
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

function scheduleRealtimeIndicators(time: number) {
  if (activeIndicators.size === 0) return;
  pendingRealtimeIndicatorTimes.add(time);
  if (realtimeIndicatorTimerId !== undefined) return;
  realtimeIndicatorTimerId = window.setTimeout(() => {
    realtimeIndicatorTimerId = undefined;
    const pendingTimes = [...pendingRealtimeIndicatorTimes].sort((left, right) => left - right);
    pendingRealtimeIndicatorTimes.clear();
    if (pendingTimes.length > 0) refreshIndicators(pendingTimes);
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
    realtimeConnected = true;
    status.className = 'connection-status ready';
    const providerName = activeRealtimeProviderDisplayName || event.providerId;
    const statusText = `实时 · ${providerName}${currentSymbol.kind === 'prediction' ? ' · 轮询' : ' WS'}`;
    setStatusLabel(status, statusText);
    status.title = event.message ?? `${providerName} 实时行情已连接`;
    scheduleLatestPoll(60_000);
    return;
  }
  realtimeConnected = false;
  status.className = 'connection-status loading';
  const providerName = activeRealtimeProviderDisplayName || event.providerId;
  const prediction = currentSymbol.kind === 'prediction';
  const statusText = event.status === 'connecting'
    ? `正在连接 ${providerName}${prediction ? ' 公开行情' : ' WS'}`
    : `实时重连中 · ${providerName}${prediction ? ' · 轮询' : ' · 轮询保护'}`;
  setStatusLabel(status, statusText);
  status.title = event.message ?? `正在建立 ${providerName}${prediction ? ' 公开行情' : ' WebSocket 连接'}`;
  if (event.status === 'reconnecting') scheduleLatestPoll(0);
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
  if (currentBars.at(-1)?.time === point.time) currentBars[currentBars.length - 1] = bar;
  else currentBars.push(bar);
  if (currentSymbol.prediction) currentSymbol.prediction.probability = point.value;
  updatePrimarySeries(bar);
  showCurrentSnapshot();
  if (!marketDataPanel.hidden) renderPredictionRules();
  const cacheKey = marketHistoryCacheKey(currentSymbol, currentResolution, currentAdjustment);
  const cached = getHistoryCache(currentSymbol, currentResolution, currentAdjustment);
  if (cached) {
    const points = [...(cached.value.points ?? [])];
    if (points.at(-1)?.time === point.time) points[points.length - 1] = point;
    else points.push(point);
    historyCache.set(cacheKey, { ...cached.value, bars: [...currentBars], points }, cached.deep);
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
  if (param.time === undefined) { showCurrentSnapshot(); return; }
  const bar = currentBars.find((item) => item.time === Number(param.time));
  if (!bar) return;
  const index = currentBars.indexOf(bar);
  showBar(bar, index > 0 ? currentBars[index - 1] : undefined);
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
function setActiveWidgetPanel(panel: 'watchlist' | 'market-data' | 'drawing-manager' | 'data-window' | null): void {
  const isOpen = panel !== null;
  widgetBar.classList.toggle('open', isOpen);
  widgetBarPages.hidden = !isOpen;
  watchlistPanel.hidden = panel !== 'watchlist';
  marketDataPanel.hidden = panel !== 'market-data';
  drawingManager.hidden = panel !== 'drawing-manager';
  dataWindowPanel.hidden = panel !== 'data-window';
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
    localStorage.setItem(WIDGET_PANEL_WIDTH_STORAGE_KEY, String(next));
  } catch {
    showChartToast('侧栏宽度未能保存');
  }
}

setWidgetPanelWidth(320);
try {
  const savedWidgetPanelWidth = Number(localStorage.getItem(WIDGET_PANEL_WIDTH_STORAGE_KEY));
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
document.querySelector<HTMLButtonElement>('#refresh')!.addEventListener('click', () => void openHistory(currentSymbol, currentResolution, currentAdjustment));
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
    if (!saveFavoriteResolutions(localStorage, favoriteResolutions)) showChartToast('周期收藏未能保存');
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
previousCloseToggle.addEventListener('click', () => {
  const settings = currentPriceLineSettings();
  settings.previousClose = !settings.previousClose;
  persistChartPreferences();
  renderPriceLines();
  syncPriceLineMenu();
  renderDrawingManager();
});
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
document.querySelector<HTMLButtonElement>('#close-chart-settings')!.addEventListener('click', closeChartSettings);
document.querySelector<HTMLButtonElement>('#cancel-chart-settings')!.addEventListener('click', closeChartSettings);
document.querySelector<HTMLButtonElement>('#confirm-chart-settings')!.addEventListener('click', confirmChartSettings);
for (const button of chartSettingsTabs) {
  button.addEventListener('click', () => selectChartSettingsTab(button.dataset.settingsTab!));
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
  if (event.key === 'Escape' && !chartSettingsLayer.hidden) {
    event.preventDefault();
    closeChartSettings();
  }
});
const toolbarMenus = [...document.querySelectorAll<HTMLDetailsElement>('.chart-control-menu, .indicator-menu, .price-scale-controls, .trading-time-menu')];
function closeToolbarMenus() {
  for (const menu of toolbarMenus) menu.open = false;
}
for (const menu of toolbarMenus) {
  menu.addEventListener('toggle', () => {
    if (menu.open) for (const other of toolbarMenus) if (other !== menu) other.open = false;
  });
}
status.addEventListener('click', async () => {
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
document.querySelector<HTMLButtonElement>('#fit-chart')!.addEventListener('click', () => chart.timeScale().fitContent());
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
  if (snapshot && applyDrawingSnapshot(snapshot)) persistDrawingSnapshot(snapshot);
  updateDrawingHistoryButtons();
});
redoDrawing.addEventListener('click', () => {
  const snapshot = drawingHistory.redo();
  if (snapshot && applyDrawingSnapshot(snapshot)) persistDrawingSnapshot(snapshot);
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
document.querySelector<HTMLButtonElement>('#volume-toggle')!.addEventListener('click', (event) => {
  setVolumeActive(!(event.currentTarget as HTMLButtonElement).classList.contains('active'));
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-indicator]')) {
  button.addEventListener('click', () => {
    const indicator = button.dataset.indicator as IndicatorName;
    setIndicatorActive(indicator, !activeIndicators.has(indicator));
  });
}
chart.timeScale().subscribeVisibleLogicalRangeChange(positionDrawingProperties);
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
applyChartType(currentChartType, false);
applyPriceScale(currentPriceScale);
for (const indicator of [...activeIndicators]) setIndicatorActive(indicator, true, false);
setVolumeActive(volumeVisible, false);
applyMainSeriesOrder();
renderSecondaryPaneOrder();
renderWatchlist();
renderResolutionControls();
applyTradingTimeChoice(tradingTimeChoice, false);
window.setInterval(() => renderTradingTimeControls(), 1_000);
void loadMarketCatalogs();
const realtimeListenersReady = installRealtimeListeners();
void openHistory(defaultSymbol, currentResolution, currentAdjustment);

function scheduleLatestPoll(delayMs = currentSymbol.kind === 'crypto' && realtimeConnected
  ? 60_000
  : marketPollPlan(new Date(), document.hidden, currentSymbol.kind === 'crypto').delayMs) {
  if (latestPollTimer !== undefined) window.clearTimeout(latestPollTimer);
  latestPollTimer = window.setTimeout(async () => {
    await pollLatestBars();
    scheduleLatestPoll();
  }, delayMs);
}

document.addEventListener('visibilitychange', () => scheduleLatestPoll(document.hidden ? 60_000 : 0));
scheduleLatestPoll();
