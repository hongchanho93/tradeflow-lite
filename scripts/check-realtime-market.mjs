import assert from 'node:assert/strict';

import {
  canApplyRealtimeBar,
  isRealtimeSequenceFresh,
  matchesRealtimeSelection,
  marketDataRenderDelay,
  REALTIME_FRAME_FALLBACK_MS,
  realtimeSequenceKey,
  realtimeRequestSeed,
} from '../src/realtime-market.ts';

assert.ok(
  realtimeRequestSeed(1_789_387_200_001) > realtimeRequestSeed(1_789_387_200_000),
  'a reloaded page must start above request IDs from the previous page lifetime',
);

const current = { requestId: 7, providerId: 'binance_spot', symbol: 'BINANCE:BTCUSDT', resolution: '1' };
assert.equal(matchesRealtimeSelection(current, 7, 'BINANCE:BTCUSDT', '1', 'binance_spot'), true);
assert.equal(
  matchesRealtimeSelection({ ...current, requestId: 6 }, 7, 'BINANCE:BTCUSDT', '1'),
  false,
  'a late event from the previous subscription must be ignored',
);
assert.equal(
  matchesRealtimeSelection({ ...current, providerId: 'binance_usdm' }, 7, 'BINANCE:BTCUSDT', '1', 'binance_spot'),
  false,
  'a different provider must never update the visible chart',
);
assert.equal(
  matchesRealtimeSelection({ ...current, symbol: 'BINANCE:ETHUSDT' }, 7, 'BINANCE:BTCUSDT', '1'),
  false,
  'a different symbol must never update the visible chart',
);
assert.equal(
  matchesRealtimeSelection({ ...current, symbol: 'BINANCE_USDM:BTCUSDT' }, 7, 'BINANCE:BTCUSDT', '1'),
  false,
  'Spot and USD-M perpetual events with the same code must remain isolated',
);
assert.equal(
  matchesRealtimeSelection({ ...current, resolution: '5' }, 7, 'BINANCE:BTCUSDT', '1'),
  false,
  'a different interval must never update the visible chart',
);
assert.equal(isRealtimeSequenceFresh(11, 10), true);
assert.equal(isRealtimeSequenceFresh(10, 10), false, 'duplicate sequence must be dropped');
assert.equal(isRealtimeSequenceFresh(9, 10), false);
assert.equal(isRealtimeSequenceFresh(null, 10), true);
const sequenceByChannel = new Map();
for (const channel of ['bar', 'depth', 'trade']) {
  const key = realtimeSequenceKey(current, channel);
  assert.equal(sequenceByChannel.has(key), false);
  sequenceByChannel.set(key, 10);
  assert.equal(
    isRealtimeSequenceFresh(10, sequenceByChannel.get(key)),
    false,
    `${channel} duplicate sequence must be dropped independently`,
  );
}
assert.notEqual(realtimeSequenceKey(current, 'bar'), realtimeSequenceKey(current, 'depth'));

assert.equal(canApplyRealtimeBar([{ time: 100 }, { time: 200 }], { time: 200 }), true);
assert.equal(canApplyRealtimeBar([{ time: 100 }, { time: 200 }], { time: 201 }), true);
assert.equal(
  canApplyRealtimeBar([{ time: 100 }, { time: 200 }], { time: 199 }),
  false,
  'realtime must replace the latest bar or append a new bar, never rewrite older history',
);

assert.equal(marketDataRenderDelay(1_000, 0), 0);
assert.equal(
  marketDataRenderDelay(1_050, 1_000),
  50,
  'depth and trade DOM rendering must be capped at ten frames per second',
);
assert.equal(marketDataRenderDelay(1_100, 1_000), 0);
assert.equal(
  REALTIME_FRAME_FALLBACK_MS,
  50,
  'a stalled animation frame must not hold a live candle update for more than 50ms',
);

console.log('Realtime market event contract OK');
