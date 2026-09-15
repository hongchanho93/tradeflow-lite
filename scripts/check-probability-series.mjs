import assert from 'node:assert/strict';

import { normalizeProbabilityHistory, probabilityPointsToBars } from '../src/probability-series.ts';

assert.deepEqual(probabilityPointsToBars([
  { time: 100, value: 42.5 },
  { time: 200, value: 61 },
]), [
  { time: 100, open: 42.5, high: 42.5, low: 42.5, close: 42.5, volume: 0 },
  { time: 200, open: 61, high: 61, low: 61, close: 61, volume: 0 },
]);

assert.throws(() => probabilityPointsToBars([{ time: 1, value: 101 }]));
assert.throws(() => probabilityPointsToBars([{ time: 2, value: 50 }, { time: 2, value: 51 }]));
assert.throws(() => normalizeProbabilityHistory({
  seriesKind: 'probability',
  bars: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 }],
  points: [{ time: 1, value: 1 }],
}));

console.log('Probability series contract: OK');
