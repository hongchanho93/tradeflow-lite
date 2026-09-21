import assert from 'node:assert/strict';
import {
  applyUserIndicatorBarsPatch,
  coalesceUserIndicatorDataEvent,
  createUserIndicatorBarsPatch,
  mergeUserIndicatorRealtimeUpdates,
  toUserIndicatorRuntimeDataEvent,
  userIndicatorDepthPayload,
  userIndicatorTradesPayload,
} from '../src/user-indicator-runtime/data-protocol.ts';
import { USER_INDICATOR_RUNTIME_LIMITS } from '../src/user-indicator-runtime/limits.ts';

function bar(time, close = time) {
  return Object.freeze({
    time,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 100 + time,
  });
}

const initialBars = Object.freeze([bar(1), bar(2), bar(3)]);
const initialEvent = Object.freeze({ reason: 'initial', bars: initialBars, changedFrom: 0 });
const initialPatch = createUserIndicatorBarsPatch(null, initialEvent);
assert.equal(initialPatch.mode, 'replace-all');
const initialMirror = applyUserIndicatorBarsPatch(null, initialPatch);
assert.deepEqual(initialMirror, initialBars);
assert.notEqual(initialMirror, initialBars, 'Worker mirror must not alias host bars');

const correctedBars = Object.freeze([bar(1), bar(2), bar(3, 30)]);
const correctedEvent = Object.freeze({ reason: 'realtime', bars: correctedBars, changedFrom: 2 });
const correctedPatch = createUserIndicatorBarsPatch(initialMirror, correctedEvent);
assert.deepEqual(correctedPatch, {
  mode: 'replace-from',
  baseLength: 3,
  from: 2,
  bars: [bar(3, 30)],
});
assert.deepEqual(applyUserIndicatorBarsPatch(initialMirror, correctedPatch), correctedBars);

const appendedBars = Object.freeze([...correctedBars, bar(4, 40)]);
const appendPatch = createUserIndicatorBarsPatch(correctedBars, {
  reason: 'realtime',
  bars: appendedBars,
  changedFrom: 3,
});
assert.equal(appendPatch.mode, 'replace-from');
assert.equal(appendPatch.from, 3);
assert.equal(appendPatch.bars.length, 1);
assert.deepEqual(applyUserIndicatorBarsPatch(correctedBars, appendPatch), appendedBars);

const lyingChangedFrom = createUserIndicatorBarsPatch(appendedBars, {
  reason: 'reconciliation',
  bars: Object.freeze([bar(1), bar(2, 22), bar(3, 30), bar(4, 40)]),
  changedFrom: 3,
});
assert.equal(lyingChangedFrom.mode, 'replace-from');
assert.equal(lyingChangedFrom.from, 1, 'unexpected prefix mutation must override a stale changedFrom');

const shortened = Object.freeze([bar(1), bar(2, 22), bar(3, 30)]);
const shortenPatch = createUserIndicatorBarsPatch(
  Object.freeze([bar(1), bar(2, 22), bar(3, 30), bar(4, 40)]),
  { reason: 'reconciliation', bars: shortened, changedFrom: 3 },
);
assert.equal(shortenPatch.mode, 'replace-from');
assert.equal(shortenPatch.from, 3);
assert.deepEqual(applyUserIndicatorBarsPatch(Object.freeze([bar(1), bar(2, 22), bar(3, 30), bar(4, 40)]), shortenPatch), shortened);

assert.throws(
  () => applyUserIndicatorBarsPatch([bar(1)], { mode: 'replace-from', baseLength: 2, from: 1, bars: [] }),
  /length mismatch/,
);

const closedAndNextOpen = mergeUserIndicatorRealtimeUpdates(
  [{ barTime: 3, closed: false, eventTimeMs: 10 }],
  [
    { barTime: 3, closed: true, closedBy: 'newer-bar', eventTimeMs: 11 },
    { barTime: 4, closed: false, eventTimeMs: 11 },
  ],
);
assert.deepEqual(closedAndNextOpen, [
  { barTime: 3, closed: true, closedBy: 'newer-bar', eventTimeMs: 11 },
  { barTime: 4, closed: false, eventTimeMs: 11 },
]);

const closedSticky = mergeUserIndicatorRealtimeUpdates(
  [{ barTime: 3, closed: true, closedBy: 'exchange', eventTimeMs: 12 }],
  [{ barTime: 3, closed: false, eventTimeMs: 13 }],
);
assert.deepEqual(closedSticky, [{ barTime: 3, closed: true, closedBy: 'exchange', eventTimeMs: 12 }]);

const depth = userIndicatorDepthPayload(Object.freeze({
  providerId: 'binance_spot', symbol: 'BINANCE:BTCUSDT', receivedTimeMs: 1,
  bids: Object.freeze(Array.from({ length: 60 }, (_, index) => Object.freeze({ price: 100 - index, quantity: index + 1 }))),
  asks: Object.freeze(Array.from({ length: 60 }, (_, index) => Object.freeze({ price: 101 + index, quantity: index + 1 }))),
}));
assert.equal(depth.coverage, 'current-snapshot');
assert.equal(depth.source, 'live');
assert.equal(depth.bids.length, USER_INDICATOR_RUNTIME_LIMITS.depthLevelsPerSide);
assert.equal(depth.asks.length, USER_INDICATOR_RUNTIME_LIMITS.depthLevelsPerSide);

const tradeBatch = Object.freeze({
  events: Object.freeze(Array.from({ length: USER_INDICATOR_RUNTIME_LIMITS.tradesPerCallback + 5 }, (_, index) => Object.freeze({
    providerId: 'binance_spot', symbol: 'BINANCE:BTCUSDT', eventKind: 'aggregate-trade',
    receivedTimeMs: index, barTime: 1, price: 100 + index, quantity: 1, quantityKnown: true, aggressorSide: 'buy',
  }))),
  streamEpoch: 'epoch-1', subscriptionId: 'sub-1', subscriptionStartedAtMs: 1,
  completeSinceSubscriptionStart: true, droppedSinceSubscriptionStart: 0, resetReason: 'initial',
});
const tradePayload = userIndicatorTradesPayload(tradeBatch);
assert.equal(tradePayload.source, 'live');
assert.equal(tradePayload.events.length, USER_INDICATOR_RUNTIME_LIMITS.tradesPerCallback);
assert.equal(tradePayload.truncated, true);
assert.equal(tradePayload.droppedByCallbackBudget, 5);
assert.equal(tradePayload.completeSinceSubscriptionStart, false);

let pending = coalesceUserIndicatorDataEvent(null, {
  reason: 'realtime',
  bars: correctedBars,
  changedFrom: 2,
  realtimeUpdates: [{ barTime: 3, closed: true, closedBy: 'newer-bar' }],
});
pending = coalesceUserIndicatorDataEvent(pending, {
  reason: 'realtime',
  bars: appendedBars,
  changedFrom: 3,
  realtimeUpdates: [{ barTime: 4, closed: false }],
  depth,
  trades: tradePayload,
});
assert.equal(pending.changedFrom, 2);
assert.equal(pending.event, pending.event, 'coalescing keeps the newest full event');
assert.deepEqual(pending.realtimeUpdates, [
  { barTime: 3, closed: true, closedBy: 'newer-bar' },
  { barTime: 4, closed: false },
]);
assert.equal(pending.depth, depth);
assert.equal(pending.trades.events.length, USER_INDICATOR_RUNTIME_LIMITS.tradesPerCallback);

const runtimeEvent = toUserIndicatorRuntimeDataEvent(correctedBars, pending);
assert.equal(runtimeEvent.barsPatch.mode, 'replace-from');
assert.equal(runtimeEvent.barsPatch.from, 2);
assert.equal(runtimeEvent.barsPatch.bars.length, 2);
assert.equal(runtimeEvent.depth, depth);
assert.equal(runtimeEvent.trades.events.length, USER_INDICATOR_RUNTIME_LIMITS.tradesPerCallback);

assert.throws(
  () => createUserIndicatorBarsPatch(null, {
    reason: 'initial',
    bars: [bar(2), bar(1)],
    changedFrom: 0,
  }),
  /strictly increasing/,
);

console.log('user indicator data protocol: ok');
