export type ChartSettings = {
  upColor: string;
  downColor: string;
  upOpacity: number;
  downOpacity: number;
  bodyVisible: boolean;
  borderVisible: boolean;
  borderUpColor: string;
  borderDownColor: string;
  borderUpOpacity: number;
  borderDownOpacity: number;
  wickVisible: boolean;
  wickUpColor: string;
  wickDownColor: string;
  wickUpOpacity: number;
  wickDownOpacity: number;
  legendSymbolVisible: boolean;
  legendValuesVisible: boolean;
  volumeLegendVisible: boolean;
  verticalGridVisible: boolean;
  horizontalGridVisible: boolean;
  crosshairLabelsVisible: boolean;
  lastPriceLineVisible: boolean;
  watermarkVisible: boolean;
  timeNavigationVisible: boolean;
};

export const CHART_SETTINGS_STORAGE_KEY = 'tradeflow-lite.chart-settings.v1';
export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  upColor: '#089981',
  downColor: '#f23645',
  upOpacity: 100,
  downOpacity: 100,
  bodyVisible: true,
  borderVisible: false,
  borderUpColor: '#089981',
  borderDownColor: '#f23645',
  borderUpOpacity: 100,
  borderDownOpacity: 100,
  wickVisible: true,
  wickUpColor: '#089981',
  wickDownColor: '#f23645',
  wickUpOpacity: 100,
  wickDownOpacity: 100,
  legendSymbolVisible: true,
  legendValuesVisible: true,
  volumeLegendVisible: true,
  verticalGridVisible: true,
  horizontalGridVisible: true,
  crosshairLabelsVisible: true,
  lastPriceLineVisible: true,
  watermarkVisible: true,
  timeNavigationVisible: true,
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const colorKeys = ['upColor', 'downColor'] as const;
const booleanKeys = [
  'borderVisible', 'wickVisible', 'legendSymbolVisible', 'legendValuesVisible',
  'volumeLegendVisible', 'verticalGridVisible', 'horizontalGridVisible',
  'crosshairLabelsVisible', 'lastPriceLineVisible', 'watermarkVisible',
  'timeNavigationVisible',
] as const;
const optionalColorKeys = ['borderUpColor', 'borderDownColor', 'wickUpColor', 'wickDownColor'] as const;
const optionalBooleanKeys = ['bodyVisible'] as const;
const optionalOpacityKeys = [
  'upOpacity', 'downOpacity', 'borderUpOpacity', 'borderDownOpacity',
  'wickUpOpacity', 'wickDownOpacity',
] as const;
const colorPattern = /^#[0-9a-f]{6}$/i;

function normalizeChartSettings(value: unknown): ChartSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const settings = value as Record<string, unknown>;
  if (!colorKeys.every((key) => typeof settings[key] === 'string' && colorPattern.test(settings[key] as string))) return null;
  if (!booleanKeys.every((key) => typeof settings[key] === 'boolean')) return null;
  if (!optionalColorKeys.every((key) => settings[key] === undefined
    || (typeof settings[key] === 'string' && colorPattern.test(settings[key] as string)))) return null;
  if (!optionalBooleanKeys.every((key) => settings[key] === undefined || typeof settings[key] === 'boolean')) return null;
  if (!optionalOpacityKeys.every((key) => settings[key] === undefined
    || (Number.isInteger(settings[key]) && (settings[key] as number) >= 0 && (settings[key] as number) <= 100))) return null;

  const upColor = settings.upColor as string;
  const downColor = settings.downColor as string;
  return {
    ...Object.fromEntries(booleanKeys.map((key) => [key, settings[key]])),
    upColor,
    downColor,
    bodyVisible: (settings.bodyVisible as boolean | undefined) ?? true,
    upOpacity: (settings.upOpacity as number | undefined) ?? 100,
    downOpacity: (settings.downOpacity as number | undefined) ?? 100,
    borderUpColor: (settings.borderUpColor as string | undefined) ?? upColor,
    borderDownColor: (settings.borderDownColor as string | undefined) ?? downColor,
    borderUpOpacity: (settings.borderUpOpacity as number | undefined) ?? 100,
    borderDownOpacity: (settings.borderDownOpacity as number | undefined) ?? 100,
    wickUpColor: (settings.wickUpColor as string | undefined) ?? upColor,
    wickDownColor: (settings.wickDownColor as string | undefined) ?? downColor,
    wickUpOpacity: (settings.wickUpOpacity as number | undefined) ?? 100,
    wickDownOpacity: (settings.wickDownOpacity as number | undefined) ?? 100,
  } as ChartSettings;
}

export function chartColorWithOpacity(color: string, opacity: number): string {
  if (opacity === 100) return color;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity / 100})`;
}

export function candlestickColorOptions(settings: ChartSettings) {
  return {
    upColor: chartColorWithOpacity(settings.upColor, settings.bodyVisible ? settings.upOpacity : 0),
    downColor: chartColorWithOpacity(settings.downColor, settings.bodyVisible ? settings.downOpacity : 0),
    borderUpColor: chartColorWithOpacity(settings.borderUpColor, settings.borderUpOpacity),
    borderDownColor: chartColorWithOpacity(settings.borderDownColor, settings.borderDownOpacity),
    wickUpColor: chartColorWithOpacity(settings.wickUpColor, settings.wickUpOpacity),
    wickDownColor: chartColorWithOpacity(settings.wickDownColor, settings.wickDownOpacity),
  };
}

export function loadChartSettings(storage: Pick<StorageLike, 'getItem'>): ChartSettings {
  try {
    const raw = storage.getItem(CHART_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHART_SETTINGS };
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    if (envelope.version !== 1) return { ...DEFAULT_CHART_SETTINGS };
    return normalizeChartSettings(envelope) ?? { ...DEFAULT_CHART_SETTINGS };
  } catch {
    return { ...DEFAULT_CHART_SETTINGS };
  }
}

export function saveChartSettings(storage: Pick<StorageLike, 'setItem'>, settings: ChartSettings): boolean {
  try {
    storage.setItem(CHART_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, ...settings }));
    return true;
  } catch {
    return false;
  }
}
