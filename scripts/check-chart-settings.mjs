import assert from 'node:assert/strict';

import {
  DEFAULT_CHART_SETTINGS,
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
  borderVisible: true,
  legendValuesVisible: false,
  horizontalGridVisible: false,
  watermarkVisible: false,
};

assert.equal(saveChartSettings(storage, settings), true);
assert.equal(JSON.parse(values.get('tradeflow-lite.chart-settings.v1')).version, 1);
assert.deepEqual(loadChartSettings(storage), settings);

values.set('tradeflow-lite.chart-settings.v1', JSON.stringify({
  version: 1,
  ...settings,
  upColor: 'green',
  wickVisible: 'yes',
}));
assert.deepEqual(loadChartSettings(storage), DEFAULT_CHART_SETTINGS, 'invalid saved settings must fail closed');
assert.equal(saveChartSettings({ ...storage, setItem: () => { throw new Error('quota'); } }, settings), false);

console.log('Chart settings state OK');
