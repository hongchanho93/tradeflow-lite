import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const fetchHistoryStart = mainSource.indexOf('function fetchHistoryResponse(');
const requestHistoryStart = mainSource.indexOf('\nfunction requestHistory(', fetchHistoryStart);
assert.notEqual(fetchHistoryStart, -1, 'main.ts must expose one normalized history fetch entry point');
assert.notEqual(requestHistoryStart, -1, 'main.ts must retain the cached history request wrapper');
const fetchHistorySource = mainSource.slice(fetchHistoryStart, requestHistoryStart);
assert.match(
  fetchHistorySource,
  /invoke<HistoryResponse>\('get_history_bars',[\s\S]*\.then\(normalizeProbabilityHistory\)/,
  'every raw HistoryResponse must pass through probability normalization at the fetch boundary',
);
const pollStart = mainSource.indexOf('async function pollLatestBars()');
const pollEnd = mainSource.indexOf('\nfunction stopRealtimeMarket', pollStart);
const pollSource = mainSource.slice(pollStart, pollEnd);
assert.match(
  pollSource,
  /fetchHistoryResponse\(symbol, resolution, adjustment, 2, true, generation\)/,
  'the latest REST fallback/poll must use the same normalized history entry point',
);
assert.doesNotMatch(
  pollSource,
  /invoke<HistoryResponse>\('get_history_bars'/,
  'the REST fallback must not bypass probability history normalization',
);

console.log('Probability series contract: OK');
