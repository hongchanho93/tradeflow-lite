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
  watermarkVisible: false,
};

assert.equal(saveChartSettings(storage, settings), true);
assert.equal(JSON.parse(values.get('tradeflow-lite.chart-settings.v1')).version, 1);
assert.deepEqual(loadChartSettings(storage), settings);

const legacySettings = { ...settings };
delete legacySettings.bodyVisible;
for (const key of [
  'upOpacity', 'downOpacity',
  'borderUpColor', 'borderDownColor', 'borderUpOpacity', 'borderDownOpacity',
  'wickUpColor', 'wickDownColor', 'wickUpOpacity', 'wickDownOpacity',
]) delete legacySettings[key];
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
}, 'legacy settings must keep their body colors and default new opacity controls to 100%');

values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({
  version: 1,
  ...settings,
  upColor: 'green',
  wickVisible: 'yes',
}));
assert.deepEqual(loadChartSettings(storage), DEFAULT_CHART_SETTINGS, 'invalid saved settings must fail closed');
values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({
  version: 1,
  ...settings,
  borderDownOpacity: 101,
}));
assert.deepEqual(loadChartSettings(storage), DEFAULT_CHART_SETTINGS, 'invalid opacity must fail closed');
values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({
  version: 1,
  ...settings,
  bodyVisible: 'yes',
}));
assert.deepEqual(loadChartSettings(storage), DEFAULT_CHART_SETTINGS, 'invalid body visibility must fail closed');
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
