import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
for (const channel of ['bar', 'point', 'depth', 'trade']) {
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
assert.notEqual(realtimeSequenceKey(current, 'point'), realtimeSequenceKey(current, 'bar'));
assert.equal(
  realtimeSequenceKey({ ...current, source: 'midpoint' }, 'point'),
  `${current.requestId}:${current.providerId}:${current.symbol}:${current.resolution}:point`,
  'probability point sequences must use a dedicated bounded domain',
);
const klineSequenceEvent = { ...current, source: 'kline' };
const aggregateTradeSequenceEvent = { ...current, source: 'aggTrade' };
const okxTradeSequenceEvent = { ...current, source: 'trade' };
assert.notEqual(
  realtimeSequenceKey(klineSequenceEvent, 'bar'),
  realtimeSequenceKey(aggregateTradeSequenceEvent, 'bar'),
  'kline and aggregate-trade bar sequences must use separate source domains',
);
assert.equal(
  realtimeSequenceKey(okxTradeSequenceEvent, 'bar'),
  `${current.requestId}:${current.providerId}:${current.symbol}:${current.resolution}:bar:trade`,
  'OKX trade-derived bars must use their own sequence domain',
);
const sourceScopedSequences = new Map([
  [realtimeSequenceKey(klineSequenceEvent, 'bar'), 6_600_000_000],
]);
assert.equal(
  isRealtimeSequenceFresh(
    4_000_000_000,
    sourceScopedSequences.get(realtimeSequenceKey(aggregateTradeSequenceEvent, 'bar')),
  ),
  true,
  'a lower aggregate-trade sequence must remain fresh after a higher kline sequence',
);
assert.equal(
  realtimeSequenceKey({ ...current, source: 'untrusted-source-a' }, 'bar'),
  realtimeSequenceKey({ ...current, source: 'untrusted-source-b' }, 'bar'),
  'untrusted bar sources must collapse to a bounded sequence domain',
);
assert.equal(
  realtimeSequenceKey(current, 'depth'),
  `${current.requestId}:${current.providerId}:${current.symbol}:${current.resolution}:depth`,
  'depth sequence key must retain its existing shape',
);
assert.equal(
  realtimeSequenceKey(current, 'trade'),
  `${current.requestId}:${current.providerId}:${current.symbol}:${current.resolution}:trade`,
  'trade sequence key must retain its existing shape',
);

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

// Execute the actual main.ts queue -> frame flush -> apply functions with the
// browser/chart side effects replaced by test doubles. This catches a
// sequence gate being consumed twice: the first accepted bar must reach the
// chart and the health counter must agree with the successful apply.
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  assert.notEqual(start, -1, `main.ts must contain ${startMarker}`);
  const end = mainSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `main.ts must contain ${endMarker}`);
  return mainSource.slice(start, end);
}

function stripTypeScript(source) {
  return source
    .replace(/function applyRealtimeBar\([^)]*\)(?:\s*:\s*boolean)?/, 'function applyRealtimeBar(event)')
    .replace(/function queueRealtimeBar\([^)]*\)/, 'function queueRealtimeBar(event)')
    .replace(/function flushRealtimeFrame\(now: number, fallback = false\)/, 'function flushRealtimeFrame(now, fallback = false)')
    .replace(/\s+as\s+UTCTimestamp\b/g, '');
}

const applyRealtimeBarSource = stripTypeScript(
  sourceBetween('function applyRealtimeBar(', '\nlet pendingRealtimeBar'),
);
const flushRealtimeFrameSource = stripTypeScript(
  sourceBetween('function flushRealtimeFrame(', '\nfunction queueRealtimeFrame'),
);
const queueRealtimeBarSource = stripTypeScript(
  sourceBetween('function queueRealtimeBar(', '\nfunction applyRealtimeStatus'),
);

const createRealtimeHarness = new Function(
  'matchesRealtimeSelection',
  'canApplyRealtimeBar',
  'isRealtimeSequenceFresh',
  'realtimeSequenceKey',
  `return (() => {
    const activeRealtimeRequestId = 7;
    const activeRealtimeProviderId = 'binance_spot';
    const activeRealtimeProviderDisplayName = 'Binance Spot';
    const currentSymbol = { symbol: 'BINANCE:BTCUSDT' };
    const currentResolution = '1';
    const lastRealtimeSequenceByChannel = new Map();
    let sequenceCalls = 0;
    function acceptsRealtimeSequence(event, channel) {
      sequenceCalls += 1;
      if (event.sequence == null) return true;
      const key = realtimeSequenceKey(event, channel);
      const previous = lastRealtimeSequenceByChannel.get(key);
      if (!isRealtimeSequenceFresh(event.sequence, previous)) return false;
      if (previous === undefined || event.sequence > previous) {
        lastRealtimeSequenceByChannel.set(key, event.sequence);
      }
      return true;
    }

    let currentBars = [{ time: 100, close: 10 }, { time: 200, close: 11 }];
    const appliedBars = [];
    function updateLatestBarInPlace(bars, bar) {
      const latestTime = bars.at(-1)?.time;
      if (latestTime !== undefined && bar.time < latestTime) return 'rejected';
      if (latestTime === bar.time) {
        bars[bars.length - 1] = bar;
        return 'replaced';
      }
      bars.push(bar);
      return 'appended';
    }
    function updatePrimarySeries(bar) { appliedBars.push(bar); }
    const volumeSeries = { update() {} };
    const status = { className: '', title: '' };
    const realtimeTimeFormatter = { format: () => 'now' };
    function setStatusLabel() {}
    function scheduleRealtimeIndicators() {}
    function showLatest() {}

    let realtimeConnected = false;
    let realtimeBarRequestId = 0;
    let currentQuote = null;
    let lastRealtimeStatusRenderAt = 0;
    let pendingRealtimeBar = null;
    let pendingRealtimeBarQueuedAt = 0;
    let realtimeFrameId;
    let realtimeFrameFallbackTimerId;
    let pendingRealtimeDepth = null;
    let pendingRealtimeTrades = [];
    let lastMarketDataRenderAt = 0;
    let realtimeHealthBarsReceived = 0;
    let realtimeHealthBarsApplied = 0;
    let realtimeHealthRequestId = 0;
    let realtimeHealthLastArrivalAt = 0;
    let realtimeHealthMaxArrivalGapMs = 0;
    let realtimeHealthMaxQueueMs = 0;
    let realtimeHealthMaxEventAgeMs = 0;
    let realtimeHealthMaxFrameMs = 0;
    let realtimeHealthMaxApplyGapMs = 0;
    let realtimeHealthLastApplyAt = 0;
    let realtimeHealthFallbackFlushes = 0;
    function cancelRealtimeFrameSchedule() {}
    function queueRealtimeFrame() {}
    function marketDataRenderDelay() { return 0; }
    function reportRealtimeRenderHealth() {}

    ${applyRealtimeBarSource}
    ${flushRealtimeFrameSource}
    ${queueRealtimeBarSource}

    return {
      queueRealtimeBar,
      flushRealtimeFrame,
      state: () => ({
        currentBars,
        appliedBars,
        sequenceCalls,
        barsReceived: realtimeHealthBarsReceived,
        barsApplied: realtimeHealthBarsApplied,
        pendingBar: pendingRealtimeBar,
      }),
    };
  })();`,
);

const realtimeHarness = createRealtimeHarness(
  matchesRealtimeSelection,
  canApplyRealtimeBar,
  isRealtimeSequenceFresh,
  realtimeSequenceKey,
);
const firstBar = {
  requestId: current.requestId,
  providerId: current.providerId,
  symbol: current.symbol,
  resolution: current.resolution,
  sequence: 6_600_000_000,
  bar: { time: 200, open: 11, high: 12, low: 10, close: 12, volume: 5 },
  closed: false,
  eventTimeMs: 1_789_387_200_000,
  source: 'kline',
};

realtimeHarness.queueRealtimeBar(firstBar);
assert.equal(realtimeHarness.state().barsReceived, 1, 'queue must record an accepted bar');
assert.ok(realtimeHarness.state().pendingBar, 'queue must hold the accepted bar for the frame');
realtimeHarness.flushRealtimeFrame(1_000);
let realtimeState = realtimeHarness.state();
assert.equal(realtimeState.sequenceCalls, 1, 'queue -> flush -> apply must consume one bar sequence');
assert.equal(realtimeState.appliedBars.length, 1, 'the accepted bar must reach apply');
assert.equal(realtimeState.barsApplied, 1, 'barsApplied must count only a successful apply');

realtimeHarness.queueRealtimeBar({
  ...firstBar,
  sequence: 4_000_000_000,
  source: 'aggTrade',
  bar: { ...firstBar.bar, close: 13 },
});
realtimeHarness.flushRealtimeFrame(1_100);
realtimeHarness.queueRealtimeBar({
  ...firstBar,
  sequence: 4_000_000_000,
  source: 'aggTrade',
  bar: { ...firstBar.bar, close: 14 },
});
realtimeHarness.flushRealtimeFrame(1_200);
realtimeHarness.queueRealtimeBar({
  ...firstBar,
  sequence: 3_999_999_999,
  source: 'aggTrade',
  bar: { ...firstBar.bar, close: 14 },
});
realtimeHarness.flushRealtimeFrame(1_300);
realtimeHarness.queueRealtimeBar({ ...firstBar, requestId: 6, sequence: 6_600_000_001 });
realtimeHarness.flushRealtimeFrame(1_400);
realtimeHarness.queueRealtimeBar({
  ...firstBar,
  sequence: 4_000_000_001,
  source: 'aggTrade',
  bar: { ...firstBar.bar, time: 199, close: 15 },
});
realtimeHarness.flushRealtimeFrame(1_500);
realtimeState = realtimeHarness.state();
assert.equal(realtimeState.appliedBars.length, 2, 'the lower aggregate-trade sequence must apply after the kline sequence');
assert.equal(realtimeState.barsApplied, 2, 'rejected bars must not inflate barsApplied');
assert.equal(realtimeState.barsReceived, 3, 'only sequence-fresh, selection-matching bars reach the queue counter');
assert.equal(realtimeState.sequenceCalls, 5, 'each selection-matching bar must pass the sequence gate exactly once');
assert.equal(realtimeState.pendingBar, null, 'a rejected queue event must not remain pending');

console.log('Realtime market event contract OK');
