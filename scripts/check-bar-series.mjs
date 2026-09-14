import assert from 'node:assert/strict';

import { barsForSeriesUpdate, initialVisibleLogicalRange, mergeLatestBars } from '../src/bar-series.ts';

const existing = [{ time: 1, close: 10 }, { time: 2, close: 11 }];
assert.deepEqual(
  mergeLatestBars(existing, [{ time: 2, close: 12 }, { time: 3, close: 13 }]),
  [{ time: 1, close: 10 }, { time: 2, close: 12 }, { time: 3, close: 13 }],
);
assert.deepEqual(existing, [{ time: 1, close: 10 }, { time: 2, close: 11 }]);
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
console.log('Latest bar merge OK');
