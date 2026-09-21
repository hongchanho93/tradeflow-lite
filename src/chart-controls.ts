export type ChartType = 'candles' | 'bars' | 'line' | 'area' | 'baseline';
export type PriceScaleSetting = 'normal' | 'logarithmic' | 'percentage' | 'indexed';
export type SecondaryPane = 'macd' | 'rsi';
export type ManagedSeries = 'volume' | 'ma' | 'ema' | 'boll' | 'macd' | 'rsi';
export type MainOverlaySeries = 'volume' | 'ma' | 'ema' | 'boll';

export type PriceLineSettings = {
  previousClose: boolean;
  cost: number | null;
  custom: number[];
};

export type ChartPreferences = {
  chartType: ChartType;
  priceScale: PriceScaleSetting;
  priceScaleInverted: boolean;
  paneOrder: SecondaryPane[];
  activeSeries: ManagedSeries[];
  hiddenSeries: ManagedSeries[];
  mainSeriesOrder: MainOverlaySeries[];
  priceLines: Record<string, PriceLineSettings>;
};

export const CHART_PREFERENCES_STORAGE_KEY = 'tradeflow-lite.chart-preferences.v1';
export const DEFAULT_CHART_PREFERENCES: ChartPreferences = {
  chartType: 'candles',
  priceScale: 'normal',
  priceScaleInverted: false,
  paneOrder: ['macd', 'rsi'],
  activeSeries: [],
  hiddenSeries: [],
  mainSeriesOrder: ['volume', 'ma', 'ema', 'boll'],
  priceLines: {},
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const chartTypes = new Set<ChartType>(['candles', 'bars', 'line', 'area', 'baseline']);
const priceScales = new Set<PriceScaleSetting>(['normal', 'logarithmic', 'percentage', 'indexed']);
const managedSeries = new Set<ManagedSeries>(['volume', 'ma', 'ema', 'boll', 'macd', 'rsi']);
const mainOverlaySeries = new Set<MainOverlaySeries>(['volume', 'ma', 'ema', 'boll']);

function normalizeUniqueList<T extends string>(value: unknown, allowed: Set<T>): T[] | null {
  if (!Array.isArray(value) || value.some((item) => !allowed.has(item as T))) return null;
  const normalized = value as T[];
  return new Set(normalized).size === normalized.length ? [...normalized] : null;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizePreferences(value: unknown, version: 1 | 2): ChartPreferences | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!chartTypes.has(data.chartType as ChartType) || !priceScales.has(data.priceScale as PriceScaleSetting)) return null;
  if (!Array.isArray(data.paneOrder)
    || data.paneOrder.length !== 2
    || data.paneOrder.some((item) => item !== 'macd' && item !== 'rsi')
    || new Set(data.paneOrder).size !== 2) return null;
  if (!data.priceLines || typeof data.priceLines !== 'object' || Array.isArray(data.priceLines)) return null;

  const activeSeries = version === 1 ? [] : normalizeUniqueList(data.activeSeries, managedSeries);
  const hiddenSeries = version === 1 ? [] : normalizeUniqueList(data.hiddenSeries, managedSeries);
  const mainSeriesOrder = version === 1
    ? [...DEFAULT_CHART_PREFERENCES.mainSeriesOrder]
    : normalizeUniqueList(data.mainSeriesOrder, mainOverlaySeries);
  if (!activeSeries || !hiddenSeries || !mainSeriesOrder
    || mainSeriesOrder.length !== DEFAULT_CHART_PREFERENCES.mainSeriesOrder.length
    || hiddenSeries.some((item) => !activeSeries.includes(item))) return null;

  const priceLines: Record<string, PriceLineSettings> = {};
  for (const [symbol, raw] of Object.entries(data.priceLines as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const line = raw as Record<string, unknown>;
    if (typeof line.previousClose !== 'boolean') return null;
    if (line.cost !== null && !isPositiveNumber(line.cost)) return null;
    if (!Array.isArray(line.custom) || line.custom.some((price) => !isPositiveNumber(price))) return null;
    priceLines[symbol] = { previousClose: line.previousClose, cost: line.cost as number | null, custom: [...line.custom] as number[] };
  }
  return {
    chartType: data.chartType as ChartType,
    priceScale: data.priceScale as PriceScaleSetting,
    priceScaleInverted: version === 1 ? false : data.priceScaleInverted as boolean,
    paneOrder: [...data.paneOrder] as SecondaryPane[],
    activeSeries,
    hiddenSeries,
    mainSeriesOrder,
    priceLines,
  };
}

export function loadChartPreferences(storage: Pick<StorageLike, 'getItem'>): ChartPreferences {
  try {
    const raw = storage.getItem(CHART_PREFERENCES_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CHART_PREFERENCES);
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    if (envelope.version !== 1 && envelope.version !== 2) return structuredClone(DEFAULT_CHART_PREFERENCES);
    if (envelope.version === 2 && typeof envelope.priceScaleInverted !== 'boolean') {
      return structuredClone(DEFAULT_CHART_PREFERENCES);
    }
    return normalizePreferences(envelope, envelope.version) ?? structuredClone(DEFAULT_CHART_PREFERENCES);
  } catch {
    return structuredClone(DEFAULT_CHART_PREFERENCES);
  }
}

export function saveChartPreferences(storage: Pick<StorageLike, 'setItem'>, preferences: ChartPreferences): boolean {
  try {
    storage.setItem(CHART_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 2, ...preferences }));
    return true;
  } catch {
    return false;
  }
}

export function movePaneOrder(order: SecondaryPane[], pane: SecondaryPane, direction: -1 | 1): SecondaryPane[] {
  const index = order.indexOf(pane);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function moveMainSeriesOrder(
  order: MainOverlaySeries[],
  series: MainOverlaySeries,
  direction: -1 | 1,
): MainOverlaySeries[] {
  const index = order.indexOf(series);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const shanghaiDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function previousCloseFromBars(
  bars: Array<{ time: number; close: number }>,
  resolution: string,
): number | null {
  if (bars.length < 2) return null;
  if (resolution === '1D' || resolution === '1W' || resolution === '1M') return bars.at(-2)!.close;
  const latestDay = shanghaiDay.format(new Date(bars.at(-1)!.time * 1000));
  for (let index = bars.length - 2; index >= 0; index -= 1) {
    if (shanghaiDay.format(new Date(bars[index].time * 1000)) !== latestDay) return bars[index].close;
  }
  return null;
}
