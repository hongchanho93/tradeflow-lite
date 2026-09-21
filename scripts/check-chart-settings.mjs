import assert from 'node:assert/strict';

import {
  DEFAULT_CHART_SETTINGS,
  candlestickColorOptions,
  chartColorWithOpacity,
  loadChartSettings,
  saveChartSettings,
} from '../src/chart-settings.ts';

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
assert.equal('watermarkVisible' in DEFAULT_CHART_SETTINGS, false, 'Trade Flow watermark must not remain configurable');
assert.equal('watermarkColor' in DEFAULT_CHART_SETTINGS.appearanceByTheme.dark, false);
assert.equal('watermarkOpacity' in DEFAULT_CHART_SETTINGS.appearanceByTheme.dark, false);
const settings = {
  ...DEFAULT_CHART_SETTINGS,
  upColor: '#11aa88',
  bodyVisible: false,
  upOpacity: 35,
  borderUpColor: '#2962ff',
  borderUpOpacity: 60,
  wickDownColor: '#ff9800',
  wickDownOpacity: 20,
  borderVisible: true,
  legendValuesVisible: false,
  horizontalGridVisible: false,
  appearanceByTheme: {
    dark: {
      backgroundColor: '#000000',
      backgroundOpacity: 100,
      verticalGridColor: '#202530',
      verticalGridOpacity: 45,
      horizontalGridColor: '#303642',
      horizontalGridOpacity: 55,
      paneSeparatorColor: '#94a3b8',
      paneSeparatorOpacity: 14,
      crosshairColor: '#7c828d',
      crosshairOpacity: 70,
      axisTextColor: '#787b86',
      axisTextOpacity: 100,
      axisLineColor: '#2a2e39',
      axisLineOpacity: 100,
    },
    light: {
      backgroundColor: '#ffffff',
      backgroundOpacity: 100,
      verticalGridColor: '#e0e3eb',
      verticalGridOpacity: 100,
    },
  },
};

assert.equal(saveChartSettings(storage, settings), true);
assert.equal(JSON.parse(values.get('tradeflow-lite.chart-settings.v1')).version, 2);
assert.deepEqual(loadChartSettings(storage), settings);
assert.notEqual(
  loadChartSettings(storage).appearanceByTheme.dark.backgroundColor,
  loadChartSettings(storage).appearanceByTheme.light.backgroundColor,
  'dark and light appearance profiles must remain isolated',
);

const legacySettings = { ...settings };
delete legacySettings.bodyVisible;
for (const key of [
  'upOpacity', 'downOpacity',
  'borderUpColor', 'borderDownColor', 'borderUpOpacity', 'borderDownOpacity',
  'wickUpColor', 'wickDownColor', 'wickUpOpacity', 'wickDownOpacity',
]) delete legacySettings[key];
delete legacySettings.appearanceByTheme;
values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({ version: 1, ...legacySettings }));
assert.deepEqual(loadChartSettings(storage), {
  ...settings,
  bodyVisible: true,
  upOpacity: 100,
  downOpacity: 100,
  borderUpColor: settings.upColor,
  borderDownColor: settings.downColor,
  borderUpOpacity: 100,
  borderDownOpacity: 100,
  wickUpColor: settings.upColor,
  wickDownColor: settings.downColor,
  wickUpOpacity: 100,
  wickDownOpacity: 100,
  appearanceByTheme: { dark: {}, light: {} },
}, 'legacy settings must keep their body colors and default new opacity controls to 100%');

values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({
  version: 1,
  ...legacySettings,
  backgroundColor: '#000000',
  backgroundOpacity: 100,
}));
const migratedDarkSettings = loadChartSettings(storage, 'dark');
assert.deepEqual(migratedDarkSettings.appearanceByTheme.dark, { backgroundColor: '#000000', backgroundOpacity: 100 });
assert.deepEqual(migratedDarkSettings.appearanceByTheme.light, {}, 'legacy dark appearance must not leak into light mode');
assert.equal(saveChartSettings(storage, migratedDarkSettings), true);
assert.deepEqual(
  loadChartSettings(storage, 'light').appearanceByTheme,
  migratedDarkSettings.appearanceByTheme,
  'persisted migration must not move legacy colors when the app restarts in another theme',
);
values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({
  version: 1,
  ...legacySettings,
  backgroundColor: '#000000',
  backgroundOpacity: 100,
}));
const migratedLightSettings = loadChartSettings(storage, 'light');
assert.deepEqual(migratedLightSettings.appearanceByTheme.dark, {});
assert.deepEqual(migratedLightSettings.appearanceByTheme.light, { backgroundColor: '#000000', backgroundOpacity: 100 });

values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({
  version: 2,
  ...settings,
  upColor: 'green',
  wickVisible: 'yes',
}));
assert.deepEqual(loadChartSettings(storage), DEFAULT_CHART_SETTINGS, 'invalid saved settings must fail closed');
values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({
  version: 2,
  ...settings,
  borderDownOpacity: 101,
}));
assert.deepEqual(loadChartSettings(storage), DEFAULT_CHART_SETTINGS, 'invalid opacity must fail closed');
values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({
  version: 2,
  ...settings,
  bodyVisible: 'yes',
}));
assert.deepEqual(loadChartSettings(storage), DEFAULT_CHART_SETTINGS, 'invalid body visibility must fail closed');
values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({
  version: 2,
  ...settings,
  appearanceByTheme: { ...settings.appearanceByTheme, dark: { paneSeparatorColor: 'transparent' } },
}));
assert.deepEqual(loadChartSettings(storage), DEFAULT_CHART_SETTINGS, 'invalid layout colors must fail closed');
values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({
  version: 2,
  ...settings,
  appearanceByTheme: { ...settings.appearanceByTheme, dark: { axisLineOpacity: -1 } },
}));
assert.deepEqual(loadChartSettings(storage), DEFAULT_CHART_SETTINGS, 'invalid layout opacity must fail closed');
assert.equal(saveChartSettings({ ...storage, setItem: () => { throw new Error('quota'); } }, settings), false);

assert.equal(chartColorWithOpacity('#11aa88', 100), '#11aa88');
assert.equal(chartColorWithOpacity('#11aa88', 35), 'rgba(17, 170, 136, 0.35)');
assert.equal(chartColorWithOpacity('#11aa88', 0), 'rgba(17, 170, 136, 0)');

assert.deepEqual(candlestickColorOptions(settings), {
  upColor: 'rgba(17, 170, 136, 0)',
  downColor: 'rgba(242, 54, 69, 0)',
  borderUpColor: 'rgba(41, 98, 255, 0.6)',
  borderDownColor: '#f23645',
  wickUpColor: '#089981',
  wickDownColor: 'rgba(255, 152, 0, 0.2)',
}, 'every visible candle layer must retain its independent saved opacity');
assert.equal(candlestickColorOptions.length, 1, 'chart visibility must not be encoded by replacing saved candle colors');

console.log('Chart settings state OK');
