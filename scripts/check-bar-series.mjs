import assert from 'node:assert/strict';

import {
  barsForSeriesUpdate,
  historyOverlapsTrustedBar,
  initialVisibleLogicalRange,
  mergeDeepHistoryWithLiveTail,
  mergeLatestBars,
  realtimeRecoveryHistoryCounts,
  reconcileBars,
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

const tenMissingBars = Array.from({ length: 10 }, (_, index) => ({
  time: 3 + index,
  close: 12 + index,
}));
const recovered = reconcileBars(
  [{ time: 1, close: 10 }, { time: 2, close: 11 }, { time: 13, close: 22 }],
  [{ time: 2, close: 11 }, ...tenMissingBars, { time: 13, close: 23 }],
);
assert.deepEqual(
  recovered.bars.map((bar) => bar.time),
  Array.from({ length: 13 }, (_, index) => index + 1),
  'reconciliation must fill every missing bar from an overlapping recovery window without duplicates',
);
assert.equal(recovered.bars.at(-1)?.close, 23, 'recovery must also accept a correction to the latest bar');
assert.equal(
  recovered.requiresSeriesReset,
  true,
  'inserting historical bars requires a full chart-series reset so the visual series cannot miss them',
);

const historicalCorrection = reconcileBars(
  [
    { time: 100, open: 1, high: 2, low: 1, close: 1.5, volume: 10 },
    { time: 200, open: 2, high: 3, low: 2, close: 2.5, volume: 20 },
    { time: 300, open: 3, high: 4, low: 3, close: 3.5, volume: 30 },
  ],
  [{ time: 200, open: 2, high: 3.2, low: 1.9, close: 2.8, volume: 25 }],
);
assert.deepEqual(historicalCorrection.changedTimes, [200]);
assert.equal(historicalCorrection.mutations[0]?.historical, true);
assert.equal(historicalCorrection.mutations[0]?.kind, 'replace');
assert.equal(
  historicalCorrection.requiresSeriesReset,
  false,
  'correcting an existing historical bar can use the historical update path without resetting the whole series',
);

assert.deepEqual(
  realtimeRecoveryHistoryCounts(8_000),
  [32, 128, 512, 2_048, 8_000],
  'reconnect recovery should expand bounded history windows until the trusted bar overlaps',
);
assert.equal(
  historyOverlapsTrustedBar(
    [
      { time: 11 * 3_600 + 29 * 60 },
      { time: 11 * 3_600 + 30 * 60 },
      { time: 13 * 3_600 },
      { time: 13 * 3_600 + 60 },
    ],
    11 * 3_600 + 30 * 60,
  ),
  true,
  'the A-share lunch break is not a missing-bar signal when real history overlaps the last trusted bar',
);
assert.equal(
  historyOverlapsTrustedBar(
    [
      { time: 15 * 3_600 },
      { time: 24 * 3_600 + 9 * 3_600 + 30 * 60 },
    ],
    15 * 3_600,
  ),
  true,
  'an overnight/session-close wall-clock gap is not treated as missing bars when history overlaps the trusted close',
);
assert.equal(
  historyOverlapsTrustedBar([{ time: 13 * 3_600 }, { time: 13 * 3_600 + 60 }], 11 * 3_600 + 30 * 60),
  false,
  'a recovery window that starts after the trusted bar must expand before reconciliation',
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
