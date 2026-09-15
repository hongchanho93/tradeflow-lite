export type AppTheme = 'dark' | 'light';

export const APP_THEME_STORAGE_KEY = 'tradeflow-lite.theme.v1';

const palettes = {
  dark: {
    background: '#131722',
    text: '#787b86',
    grid: '#242834',
    crosshair: '#666b74',
    crosshairLabel: '#363a40',
    border: '#2a2e39',
    paneSeparator: 'rgba(148, 163, 184, .14)',
    paneSeparatorHover: 'rgba(148, 163, 184, .18)',
    watermark: 'rgba(235, 238, 245, 0.13)',
  },
  light: {
    background: '#ffffff',
    text: '#6a6d78',
    grid: '#e0e3eb',
    crosshair: '#9598a1',
    crosshairLabel: '#d1d4dc',
    border: '#d1d4dc',
    paneSeparator: 'rgba(15, 23, 42, .14)',
    paneSeparatorHover: 'rgba(15, 23, 42, .2)',
    watermark: 'rgba(19, 23, 34, 0.1)',
  },
} as const;

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

export function loadAppTheme(storage: StorageReader): AppTheme {
  try {
    return storage.getItem(APP_THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function saveAppTheme(storage: StorageWriter, theme: AppTheme): boolean {
  try {
    storage.setItem(APP_THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export function appThemePalette(theme: AppTheme) {
  return palettes[theme];
}
