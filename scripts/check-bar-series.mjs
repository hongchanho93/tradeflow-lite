import assert from 'node:assert/strict';

import {
  barsForSeriesUpdate,
  initialVisibleLogicalRange,
  mergeDeepHistoryWithLiveTail,
  mergeLatestBars,
  updateLatestBarInPlace,
} from '../src/bar-series.ts';

const existing = [{ time: 1, close: 10 }, { time: 2, close: 11 }];
assert.deepEqual(
  mergeLatestBars(existing, [{ time: 2, close: 12 }, { time: 3, close: 13 }]),
  [{ time: 1, close: 10 }, { time: 2, close: 12 }, { time: 3, close: 13 }],
);
assert.deepEqual(existing, [{ time: 1, close: 10 }, { time: 2, close: 11 }]);

const realtimeBars = Array.from({ length: 8_000 }, (_, index) => ({ time: index + 1, close: index + 10 }));
const realtimeReference = realtimeBars;
assert.equal(
  updateLatestBarInPlace(realtimeBars, { time: 8_000, close: 99_999 }),
  'replaced',
  'a realtime update for the forming bar must replace only the array tail',
);
assert.equal(realtimeBars, realtimeReference, 'a forming-bar update must preserve the history array');
assert.deepEqual(realtimeBars.at(-1), { time: 8_000, close: 99_999 });
assert.equal(updateLatestBarInPlace(realtimeBars, { time: 8_001, close: 100_000 }), 'appended');
assert.deepEqual(realtimeBars.at(-1), { time: 8_001, close: 100_000 });
assert.equal(updateLatestBarInPlace(realtimeBars, { time: 7_999, close: 1 }), 'rejected');
assert.equal(realtimeBars.length, 8_001, 'a stale realtime update must not mutate history');
assert.deepEqual(
  barsForSeriesUpdate(existing, [{ time: 1, close: 9 }, { time: 2, close: 12 }]),
  [{ time: 2, close: 12 }],
  'the chart series must not receive an update older than its latest bar',
);
assert.deepEqual(
  barsForSeriesUpdate(existing, [{ time: 3, close: 13 }, { time: 4, close: 14 }]),
  [{ time: 3, close: 13 }, { time: 4, close: 14 }],
  'all genuinely new bars remain eligible for incremental updates',
);
assert.deepEqual(
  initialVisibleLogicalRange(6_388),
  { from: 6_228, to: 6_393 },
  'deep history should open on a readable recent window instead of compressing every bar',
);
assert.deepEqual(initialVisibleLogicalRange(80), { from: 0, to: 85 });
assert.deepEqual(
  mergeDeepHistoryWithLiveTail(
    [{ time: 1, close: 10 }, { time: 2, close: 11 }],
    [{ time: 2, close: 12 }],
    true,
  ),
  [{ time: 1, close: 10 }, { time: 2, close: 12 }],
  'a completed deep-history request must not roll back a newer realtime last bar',
);
console.log('Latest bar merge OK');
