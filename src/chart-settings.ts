export type ChartSettings = {
  upColor: string;
  downColor: string;
  borderVisible: boolean;
  wickVisible: boolean;
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
  borderVisible: false,
  wickVisible: true,
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
const settingKeys = Object.keys(DEFAULT_CHART_SETTINGS) as Array<keyof ChartSettings>;
const colorPattern = /^#[0-9a-f]{6}$/i;

function isChartSettings(value: unknown): value is ChartSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return settingKeys.every((key) => {
    const expected = DEFAULT_CHART_SETTINGS[key];
    return typeof expected === 'boolean'
      ? typeof settings[key] === 'boolean'
      : typeof settings[key] === 'string' && colorPattern.test(settings[key] as string);
  });
}

export function loadChartSettings(storage: Pick<StorageLike, 'getItem'>): ChartSettings {
  try {
    const raw = storage.getItem(CHART_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHART_SETTINGS };
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    if (envelope.version !== 1 || !isChartSettings(envelope)) return { ...DEFAULT_CHART_SETTINGS };
    return Object.fromEntries(settingKeys.map((key) => [key, envelope[key]])) as ChartSettings;
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
