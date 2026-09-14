import assert from 'node:assert/strict';

import {
  DEEP_HISTORY_BARS,
  DEEP_DAILY_HISTORY_BARS,
  HistoryMemoryCache,
  INITIAL_HISTORY_BARS,
  historyCacheKey,
  shouldLoadDeepHistory,
  deepHistoryBars,
} from '../src/history-loader.ts';

assert.equal(INITIAL_HISTORY_BARS, 300);
assert.equal(DEEP_HISTORY_BARS, 8_000);
assert.equal(DEEP_DAILY_HISTORY_BARS, 12_000);
assert.equal(deepHistoryBars('1D'), 12_000);
assert.equal(deepHistoryBars('1W'), 8_000);
assert.equal(historyCacheKey('SH:600000', '1D', 'none'), 'SH:600000|1D|none');
assert.equal(shouldLoadDeepHistory(40, 300, false), true);
assert.equal(shouldLoadDeepHistory(41, 300, false), false);
assert.equal(shouldLoadDeepHistory(0, 8_000, false), false);
assert.equal(shouldLoadDeepHistory(0, 300, true), false);

let now = 1_000;
const cache = new HistoryMemoryCache(2, 100, () => now);
cache.set('a', { bars: 300 }, false);
cache.set('a', { bars: 8_000 }, true);
cache.set('a', { bars: 300 }, false);
assert.deepEqual(cache.get('a'), { value: { bars: 8_000 }, deep: true, savedAt: 1_000 });
cache.set('b', { bars: 300 }, false);
cache.get('a');
cache.set('c', { bars: 300 }, false);
assert.equal(cache.get('b'), undefined, 'least recently used history should be evicted');
now = 1_101;
assert.equal(cache.get('a'), undefined, 'expired history must not be reused');

console.log('History loading policy OK');
