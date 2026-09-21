import assert from 'node:assert/strict';

import {
  DEFAULT_CHART_PREFERENCES,
  loadChartPreferences,
  moveMainSeriesOrder,
  movePaneOrder,
  previousCloseFromBars,
  saveChartPreferences,
} from '../src/chart-controls.ts';

assert.equal(
  previousCloseFromBars([
    { time: 1_725_500_000, close: 10 },
    { time: 1_725_586_400, close: 11 },
    { time: 1_725_590_000, close: 12 },
  ], '1'),
  10,
  'intraday previous close must come from the prior trading day, not the prior minute',
);
assert.equal(previousCloseFromBars([{ time: 1, close: 10 }, { time: 2, close: 11 }], '1D'), 10);
assert.equal(previousCloseFromBars([{ time: 1, close: 10 }], '1D'), null);

assert.deepEqual(movePaneOrder(['macd', 'rsi'], 'rsi', -1), ['rsi', 'macd']);
assert.deepEqual(movePaneOrder(['macd', 'rsi'], 'macd', -1), ['macd', 'rsi']);
assert.deepEqual(moveMainSeriesOrder(['volume', 'ma', 'ema', 'boll'], 'ema', -1), ['volume', 'ema', 'ma', 'boll']);

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
const preferences = {
  chartType: 'area',
  priceScale: 'percentage',
  priceScaleInverted: true,
  paneOrder: ['rsi', 'macd'],
  activeSeries: ['volume', 'ma', 'macd'],
  hiddenSeries: ['ma'],
  mainSeriesOrder: ['ma', 'volume', 'boll', 'ema'],
  priceLines: {
    'SH:600000': { previousClose: false, cost: 10.25, custom: [9.8, 12.4] },
  },
};
assert.equal(saveChartPreferences(storage, preferences), true);
assert.equal(JSON.parse(values.get('tradeflow-lite.chart-preferences.v1')).version, 2);
assert.deepEqual(loadChartPreferences(storage), preferences);
values.set('tradeflow-lite.chart-preferences.v1', JSON.stringify({
  version: 1,
  chartType: 'line',
  priceScale: 'logarithmic',
  paneOrder: ['macd', 'rsi'],
  priceLines: {},
}));
assert.deepEqual(loadChartPreferences(storage), {
  ...DEFAULT_CHART_PREFERENCES,
  chartType: 'line',
  priceScale: 'logarithmic',
}, 'v1 preferences must migrate without losing prior chart controls');
values.set('tradeflow-lite.chart-preferences.v1', JSON.stringify({
  version: 1,
  chartType: 'wrong',
  priceScale: 'wrong',
  paneOrder: ['macd', 'macd'],
  priceLines: { bad: { previousClose: 'yes', cost: -1, custom: [1, -2, '3'] } },
}));
assert.deepEqual(loadChartPreferences(storage), DEFAULT_CHART_PREFERENCES, 'invalid stored state must be ignored');
assert.equal(saveChartPreferences({ ...storage, setItem: () => { throw new Error('quota'); } }, preferences), false);
console.log('Chart controls state OK');
