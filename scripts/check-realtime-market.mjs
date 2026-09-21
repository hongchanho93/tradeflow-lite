import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  historyOverlapsTrustedBar,
  realtimeRecoveryHistoryCounts,
  reconcileBars,
} from '../src/bar-series.ts';
import { deepHistoryBars } from '../src/history-loader.ts';

import {
  aggregateTradeGap,
  canApplyRealtimeBar,
  isRealtimeSequenceFresh,
  matchesRealtimeSelection,
  marketDataRenderDelay,
  REALTIME_FRAME_FALLBACK_MS,
  RealtimePollBarrier,
  realtimeSequenceKey,
  realtimeRequestSeed,
} from '../src/realtime-market.ts';

assert.equal(aggregateTradeGap(null, 10, 12), 0, 'the first aggregate trade starts a continuity baseline');
assert.equal(aggregateTradeGap(12, 13, 15), 0, 'adjacent aggregate trade ranges are continuous');
assert.equal(aggregateTradeGap(12, 15, 16), 2, 'missing raw trade IDs report their exact bounded gap');
assert.equal(aggregateTradeGap(16, 15, 17), 0, 'overlapping aggregate ranges do not create a false gap');
assert.equal(aggregateTradeGap(16, null, null), null, 'missing source ranges cannot claim continuity');

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
  canApplyRealtimeBar([{ time: 100 }, { time: 200 }], { time: 100 }, true),
  true,
  'an authoritative close may update the exact penultimate bar',
);
assert.equal(
  canApplyRealtimeBar([{ time: 100 }, { time: 200 }], { time: 100 }, false),
  false,
  'a non-authoritative historical update must still be rejected',
);
assert.equal(
  canApplyRealtimeBar([{ time: 100 }, { time: 200 }], { time: 199 }),
  false,
  'realtime must replace the latest bar or append a new bar, never rewrite older history',
);

const pollBarrier = new RealtimePollBarrier();
const firstPollToken = pollBarrier.begin();
pollBarrier.markRealtime(200);
assert.deepEqual(
  pollBarrier.filter(firstPollToken, [
    { time: 100, close: 10 },
    { time: 200, close: 11 },
    { time: 300, close: 13 },
  ]),
  [
    { time: 100, close: 10 },
    { time: 300, close: 13 },
  ],
  'a REST poll started before a newer realtime update must not overwrite that realtime bar',
);
pollBarrier.end(firstPollToken);
const secondPollToken = pollBarrier.begin();
assert.deepEqual(
  pollBarrier.filter(secondPollToken, [{ time: 200, close: 12 }]),
  [{ time: 200, close: 12 }],
  'realtime touches from a completed poll must not leak into later reconciliation polls',
);
pollBarrier.end(secondPollToken);

const overlappingPollA = pollBarrier.begin();
const overlappingPollB = pollBarrier.begin();
pollBarrier.markRealtime(300);
assert.deepEqual(
  pollBarrier.filter(overlappingPollA, [{ time: 300, close: 13 }, { time: 301, close: 14 }]),
  [{ time: 301, close: 14 }],
  'all overlapping REST reconciliation requests must observe realtime touches that arrive after they begin',
);
assert.deepEqual(
  pollBarrier.filter(overlappingPollB, [{ time: 300, close: 13 }]),
  [],
  'a second overlapping reconciliation request must have its own realtime barrier token',
);
pollBarrier.end(overlappingPollA);
pollBarrier.end(overlappingPollB);

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
    .replace(/function applyRealtimeStatus\([^)]*\)/, 'function applyRealtimeStatus(event)')
    .replace(/function queueRealtimeBar\([^)]*\)/, 'function queueRealtimeBar(event)')
    .replace(/function flushRealtimeFrame\(now: number, fallback = false\)/, 'function flushRealtimeFrame(now, fallback = false)')
    .replace(/function scheduleRealtimeIndicators\([^)]*\)/, 'function scheduleRealtimeIndicators(event)')
    .replace(/function resetRealtimeHealthWindow\(now: number, resetContinuity = false\)/, 'function resetRealtimeHealthWindow(now, resetContinuity = false)')
    .replace(/const update: IndicatorRealtimeBarUpdate =/, 'const update =')
    .replace(/const appliedEvents: RealtimeBarEvent<Bar>\[\] = \[\];/, 'const appliedEvents = [];')
    .replace(/\s+as\s+UTCTimestamp\b/g, '');
}

const latestPollSource = sourceBetween('async function pollLatestBars()', '\nfunction stopRealtimeMarket');
assert.match(
  latestPollSource,
  /const pollBarrierToken = realtimePollBarrier\.begin\(\)[\s\S]*realtimePollBarrier\.filter\(pollBarrierToken, response\.bars\)/,
  'latest REST polling must filter bars touched by realtime after that poll started',
);
assert.match(
  latestPollSource,
  /finally \{[\s\S]*realtimePollBarrier\.end\(pollBarrierToken\)/,
  'latest REST polling must always release its realtime barrier',
);
assert.match(
  latestPollSource,
  /const reconciliation = reconcileBars\(currentBars, pollBars\)[\s\S]*commitBarReconciliation\(/,
  'latest REST polling must use the shared bar reconciliation path instead of mutating chart state separately',
);
assert.match(
  latestPollSource,
  /const changedPollTimes = new Set\(reconciliation\.changedTimes\);[\s\S]*for \(const bar of pollBars\) \{\s*if \(!changedPollTimes\.has\(bar\.time\)\) continue;\s*realtimeUpdates\.set\(bar\.time,/,
  'unchanged REST poll bars must not fabricate realtime updates or wake every indicator',
);

const commitReconciliationSource = sourceBetween(
  'function commitBarReconciliation(',
  '\nfunction applyChartType',
);
assert.match(
  commitReconciliationSource,
  /retainRealtimeHistory\(reconciliation\.bars, currentResolution\)[\s\S]*currentBars = retention\.bars/,
  'a reconciliation result must become the single bounded in-memory bar state',
);
assert.match(
  commitReconciliationSource,
  /reconciliation\.requiresSeriesReset[\s\S]*setPrimarySeriesData\(\)[\s\S]*volumeSeries\.setData\(currentBars\.map\(volumePoint\)\)/,
  'historical insertion must reset both the primary chart series and volume from the same reconciled bars',
);
assert.match(
  commitReconciliationSource,
  /updatePrimarySeries\(mutation\.bar, mutation\.historical\)[\s\S]*volumeSeries\.update\(volumePoint\(mutation\.bar\), mutation\.historical\)/,
  'historical correction must update primary and volume series with the same historical flag',
);
assert.match(
  commitReconciliationSource,
  /syncCurrentHistoryCacheBars\(\)/,
  'the history cache must consume the same reconciled in-memory bars',
);
assert.match(
  commitReconciliationSource,
  /refreshIndicators\(changedTimes, reason, realtimeUpdates\)/,
  'indicators must be refreshed from the changed times produced by the same reconciliation result',
);

const recoverySource = sourceBetween(
  'async function recoverCurrentHistoryFrom(',
  '\nasync function pollLatestBars',
);
assert.match(
  recoverySource,
  /realtimeRecoveryHistoryCounts\(deepHistoryBars\(resolution\)\)[\s\S]*for \(const count of recoveryCounts\)[\s\S]*requestHistory\(symbol, resolution, adjustment, count, generation\)/,
  'gap recovery must expand bounded history windows instead of relying on the two-bar poll',
);
assert.match(
  recoverySource,
  /historyOverlapsTrustedBar\(response\.bars, trustedBarTime\)/,
  'gap recovery must stop only after returned history overlaps the last trusted bar',
);
assert.match(
  recoverySource,
  /realtimePollBarrier\.filter\(barrierToken, response\.bars\)[\s\S]*reconcileBars\(currentBars, recoveryBars\)[\s\S]*commitBarReconciliation\(reconciliation, 'reconciliation'\)/,
  'gap recovery must preserve newer realtime bars and reconcile missing history through the shared mutation path',
);

const realtimeStatusSource = sourceBetween('function applyRealtimeStatus(', '\nlet pendingRealtimeDepth');
assert.match(
  realtimeStatusSource,
  /event\.status === 'reconnecting'[\s\S]*realtimeRecoveryAnchorTime \?\?= currentBars\.at\(-1\)\?\.time/,
  'reconnecting must capture the last trusted bar before later polls can advance the visible tail',
);
assert.match(
  realtimeStatusSource,
  /event\.status === 'connected'[\s\S]*recoverCurrentHistoryFrom\(recoveryAnchor, 'reconnect', event\.requestId\)/,
  'a reconnected realtime stream must trigger overlap recovery from the captured trusted bar',
);
assert.match(
  mainSource,
  /visibilitychange[\s\S]*recoverCurrentHistoryFrom\(trustedBarTime, 'visibility', activeRealtimeRequestId\)/,
  'returning from background must reconcile history even when the websocket itself never emitted reconnecting',
);

const createRealtimeStatusHarness = new Function(
  'matchesRealtimeSelection',
  `return (() => {
    const activeRealtimeRequestId = 7;
    const activeRealtimeProviderId = 'okx_spot';
    const activeRealtimeProviderDisplayName = 'OKX';
    const currentSymbol = { symbol: 'OKX:BTC-USDT', kind: 'crypto', providerDisplayName: 'OKX' };
    const currentResolution = '1';
    let currentBars = [{ time: 100 }, { time: 200 }];
    let realtimeRecoveryAnchorTime = null;
    let realtimeConnected = true;
    let lastIndicatorAggregateTradeId = 123;
    const status = { className: '', title: '' };
    const connectionUpdates = [];
    const pollDelays = [];
    const recoveryCalls = [];
    const indicatorMarketRouter = {
      updateConnection(state, message) { connectionUpdates.push([state, message]); },
    };
    function setStatusLabel() {}
    function marketStatusText(_symbol, text) { return text; }
    function scheduleLatestPoll(delay) { pollDelays.push(delay); }
    function recoverCurrentHistoryFrom(anchor, trigger, requestId) {
      recoveryCalls.push({ anchor, trigger, requestId });
      return Promise.resolve(true);
    }

    ${stripTypeScript(realtimeStatusSource)}

    return {
      applyRealtimeStatus,
      advanceTail(time) { currentBars.push({ time }); },
      state() {
        return {
          recoveryAnchor: realtimeRecoveryAnchorTime,
          realtimeConnected,
          lastIndicatorAggregateTradeId,
          connectionUpdates: [...connectionUpdates],
          pollDelays: [...pollDelays],
          recoveryCalls: [...recoveryCalls],
        };
      },
    };
  })();`,
)(matchesRealtimeSelection);

createRealtimeStatusHarness.applyRealtimeStatus({
  requestId: 7,
  providerId: 'okx_spot',
  symbol: 'OKX:BTC-USDT',
  resolution: '1',
  status: 'reconnecting',
  message: 'forced transport drop',
});
assert.equal(
  createRealtimeStatusHarness.state().recoveryAnchor,
  200,
  'desktop status handling must capture the visible tail at the moment reconnecting begins',
);
createRealtimeStatusHarness.advanceTail(210);
createRealtimeStatusHarness.applyRealtimeStatus({
  requestId: 7,
  providerId: 'okx_spot',
  symbol: 'OKX:BTC-USDT',
  resolution: '1',
  status: 'connected',
  message: null,
});
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(
  createRealtimeStatusHarness.state().recoveryCalls,
  [{ anchor: 200, trigger: 'reconnect', requestId: 7 }],
  'a real provider reconnect must recover from the pre-disconnect trusted bar even if polling advanced the tail',
);
assert.equal(
  createRealtimeStatusHarness.state().recoveryAnchor,
  null,
  'a successful reconnect reconciliation must clear the saved recovery anchor',
);
assert.deepEqual(
  createRealtimeStatusHarness.state().pollDelays,
  [0, 60_000],
  'reconnecting must start polling protection immediately and connected must restore the slow reconciliation poll',
);

const executableRecoverySource = recoverySource
  .replace(
    /async function recoverCurrentHistoryFrom\([^)]*\)/,
    'async function recoverCurrentHistoryFrom(trustedBarTime, trigger, expectedRealtimeRequestId = activeRealtimeRequestId)',
  )
  .replace(/let response: HistoryResponse \| null = null;/, 'let response = null;');

const createGapRecoveryHarness = new Function(
  'matchesRealtimeSelection',
  'realtimeRecoveryHistoryCounts',
  'deepHistoryBars',
  'historyOverlapsTrustedBar',
  'RealtimePollBarrier',
  'reconcileBars',
  `return (() => {
    const activeRealtimeRequestId = 7;
    const activeRealtimeProviderId = 'okx_spot';
    const activeRealtimeProviderDisplayName = 'OKX';
    const currentSymbol = {
      providerId: 'okx_spot',
      providerDisplayName: 'OKX',
      symbol: 'OKX:BTC-USDT',
      kind: 'crypto',
    };
    const currentResolution = '1';
    const currentAdjustment = 'none';
    const historyRequestGate = { current: () => 1, isCurrent: (generation) => generation === 1 };
    const realtimePollBarrier = new RealtimePollBarrier();
    let currentBars = [{ time: 1, close: 1 }, { time: 2, close: 2 }];
    let realtimeRecoveryAnchorTime = null;
    let realtimeConnected = true;
    let lastIndicatorAggregateTradeId = null;
    const status = { className: '', title: '' };
    const indicatorMarketRouter = { updateConnection() {} };
    const pollDelays = [];
    const requestedCounts = [];
    const cacheWrites = [];
    const recoveredHistory = {
      symbol: 'OKX:BTC-USDT',
      seriesKind: 'ohlcv',
      bars: Array.from({ length: 12 }, (_, index) => ({ time: index + 2, close: index + 2 })),
      diagnostics: { source: 'okx_spot', host: 'real.test', latencyMs: 1 },
    };
    function isCurrentMarketSelection() { return true; }
    async function requestHistory(_symbol, _resolution, _adjustment, count) {
      requestedCounts.push(count);
      return recoveredHistory;
    }
    function commitBarReconciliation(reconciliation) { currentBars = reconciliation.bars; }
    function marketHistoryCacheKey() { return 'okx|btc|1|none'; }
    function getHistoryCache() {
      return { value: { quote: undefined }, deep: false };
    }
    const historyCache = { set(key, value, deep) { cacheWrites.push({ key, value, deep }); } };
    function showCurrentSnapshot() {}
    function setStatusLabel() {}
    function marketStatusText(_symbol, text) { return text; }
    function scheduleLatestPoll(delay) { pollDelays.push(delay); }

    ${executableRecoverySource}
    ${stripTypeScript(realtimeStatusSource)}

    return {
      applyRealtimeStatus,
      simulatePollTail() {
        currentBars = [...currentBars, { time: 13, close: 13 }];
      },
      state() {
        return {
          times: currentBars.map((bar) => bar.time),
          recoveryAnchor: realtimeRecoveryAnchorTime,
          requestedCounts: [...requestedCounts],
          pollDelays: [...pollDelays],
          cacheWrites: cacheWrites.length,
        };
      },
    };
  })();`,
)(
  matchesRealtimeSelection,
  realtimeRecoveryHistoryCounts,
  deepHistoryBars,
  historyOverlapsTrustedBar,
  RealtimePollBarrier,
  reconcileBars,
);

createGapRecoveryHarness.applyRealtimeStatus({
  requestId: 7,
  providerId: 'okx_spot',
  symbol: 'OKX:BTC-USDT',
  resolution: '1',
  status: 'reconnecting',
  message: 'real transport interrupted',
});
createGapRecoveryHarness.simulatePollTail();
assert.deepEqual(
  createGapRecoveryHarness.state().times,
  [1, 2, 13],
  'polling protection may advance the tail while leaving a multi-bar reconnect gap',
);
createGapRecoveryHarness.applyRealtimeStatus({
  requestId: 7,
  providerId: 'okx_spot',
  symbol: 'OKX:BTC-USDT',
  resolution: '1',
  status: 'connected',
  message: null,
});
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(
  createGapRecoveryHarness.state().times,
  Array.from({ length: 13 }, (_, index) => index + 1),
  'connected after a real transport interruption must reconcile every missing bar without duplicates',
);
assert.deepEqual(
  createGapRecoveryHarness.state().requestedCounts,
  [32],
  'reconnect recovery should stop at the first bounded history window that overlaps the trusted anchor',
);
assert.equal(createGapRecoveryHarness.state().recoveryAnchor, null);
assert.equal(createGapRecoveryHarness.state().cacheWrites, 1);

const applyRealtimeBarSource = stripTypeScript(
  sourceBetween('function applyRealtimeBar(', '\nlet pendingRealtimeBars'),
);
assert.match(
  applyRealtimeBarSource,
  /reconcileBars\(currentBars, \[event\.bar\]\)[\s\S]*commitBarReconciliation\(reconciliation, 'realtime', \[\], false\)/,
  'realtime bars must use the same reconciliation result as REST corrections while keeping indicator batching',
);
const flushRealtimeFrameSource = stripTypeScript(
  sourceBetween('function flushRealtimeFrame(', '\nfunction queueRealtimeFrame'),
);
const queueRealtimeBarSource = stripTypeScript(
  sourceBetween('function queueRealtimeBar(', '\nfunction applyRealtimeStatus'),
);
assert.match(
  queueRealtimeBarSource,
  /realtimePollBarrier\.markRealtime\(event\.bar\.time\)/,
  'accepted realtime bars must invalidate the same bar in an older in-flight REST poll',
);
const scheduleRealtimeIndicatorsSource = stripTypeScript(
  sourceBetween('function scheduleRealtimeIndicators(', '\nfunction reportRealtimeRenderHealth'),
);
const resetRealtimeHealthWindowSource = stripTypeScript(
  sourceBetween('function resetRealtimeHealthWindow(', '\nfunction scheduleRealtimeIndicators'),
);
assert.match(
  sourceBetween('function resetMarketData()', '\nconst drawingToolLabels'),
  /resetRealtimeHealthWindow\(performance\.now\(\), true\)/,
  'market reset must clear the realtime health window and request continuity',
);
assert.match(
  sourceBetween('function queueRealtimeDepth(', '\nfunction queueRealtimeTrade'),
  /event\.providerId\.startsWith\('binance'\) \? \{\} : \{ exchangeTimeMs: event\.eventTimeMs \}/,
  'Binance depth receive time must not be exposed to indicators as an exchange timestamp',
);
assert.match(
  sourceBetween('function queueRealtimeTrade(', '\nfunction applyRealtimePoint'),
  /firstTradeId: event\.firstTradeId \?\? undefined[\s\S]*lastTradeId: event\.lastTradeId \?\? undefined/,
  'Binance aggregate-trade source IDs must reach indicator plugins for deduplication and gap analysis',
);
assert.match(
  sourceBetween('function queueRealtimeTrade(', '\nfunction applyRealtimePoint'),
  /aggregateTradeGap\([\s\S]*indicatorMarketRouter\.reportTradeGap\(\{ restartAtKnown: true, dropped \}\)/,
  'a bounded Binance raw-trade gap must start a new complete indicator subscription',
);

const createRealtimeHarness = new Function(
  'matchesRealtimeSelection',
  'canApplyRealtimeBar',
  'isRealtimeSequenceFresh',
  'realtimeSequenceKey',
  'reconcileBars',
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
    const historicalPrimaryUpdates = [];
    const historicalVolumeUpdates = [];
    function commitBarReconciliation(reconciliation) {
      currentBars = reconciliation.bars;
      for (const mutation of reconciliation.mutations) {
        appliedBars.push(mutation.bar);
        historicalPrimaryUpdates.push(mutation.historical);
        historicalVolumeUpdates.push(mutation.historical);
      }
    }
    const status = { className: '', title: '' };
    const realtimeTimeFormatter = { format: () => 'now' };
    function setStatusLabel() {}
    const scheduledIndicatorTimes = [];
    const indicatorRuntime = { list: () => [{ running: true }] };
    function scheduleRealtimeIndicators(event) { scheduledIndicatorTimes.push(event.bar.time); }
    function showLatest() {}

    let realtimeConnected = false;
    let realtimeBarRequestId = 0;
    let currentQuote = null;
    let lastRealtimeStatusRenderAt = 0;
    let pendingRealtimeBars = new Map();
    let realtimeFrameId;
    let realtimeFrameFallbackTimerId;
    let pendingRealtimeDepth = null;
    let pendingRealtimeTrades = [];
    let lastMarketDataRenderAt = 0;
    let realtimeHealthBarsReceived = 0;
    let realtimeHealthBarsApplied = 0;
    let realtimeHealthBarsCoalesced = 0;
    let realtimeHealthRequestId = 0;
    let realtimeHealthLastArrivalAt = 0;
    let realtimeHealthMaxArrivalGapMs = 0;
    let realtimeHealthMaxQueueMs = 0;
    let realtimeHealthMaxEventAgeMs = 0;
    let realtimeHealthMaxFrameMs = 0;
    let realtimeHealthMaxApplyGapMs = 0;
    let realtimeHealthLastApplyAt = 0;
    let realtimeHealthFallbackFlushes = 0;
    const realtimePollBarrier = { markRealtime() {} };
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
        barsCoalesced: realtimeHealthBarsCoalesced,
        pendingBars: [...pendingRealtimeBars.values()].map(({ event }) => event),
        scheduledIndicatorTimes,
        historicalPrimaryUpdates,
        historicalVolumeUpdates,
      }),
    };
  })();`,
);

const realtimeHarness = createRealtimeHarness(
  matchesRealtimeSelection,
  canApplyRealtimeBar,
  isRealtimeSequenceFresh,
  realtimeSequenceKey,
  reconcileBars,
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
assert.deepEqual(
  realtimeHarness.state().pendingBars.map((event) => event.bar.time),
  [200],
  'queue must hold the accepted bar for the frame',
);
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
assert.equal(realtimeState.barsCoalesced, 0, 'a stale bar rejected during apply is not a coalesced bar');
assert.equal(realtimeState.sequenceCalls, 5, 'each selection-matching bar must pass the sequence gate exactly once');
assert.deepEqual(realtimeState.pendingBars, [], 'a rejected queue event must not remain pending');

const boundaryHarness = createRealtimeHarness(
  matchesRealtimeSelection,
  canApplyRealtimeBar,
  isRealtimeSequenceFresh,
  realtimeSequenceKey,
  reconcileBars,
);
boundaryHarness.queueRealtimeBar({
  ...firstBar,
  sequence: 6_600_000_001,
  closed: true,
  bar: { ...firstBar.bar, time: 200, close: 12.5 },
});
boundaryHarness.queueRealtimeBar({
  ...firstBar,
  source: 'aggTrade',
  sequence: 4_000_000_001,
  closed: false,
  bar: { ...firstBar.bar, time: 200, close: 12.55 },
});
boundaryHarness.queueRealtimeBar({
  ...firstBar,
  sequence: 6_600_000_002,
  closed: false,
  bar: { ...firstBar.bar, time: 201, close: 12.6 },
});
assert.equal(
  boundaryHarness.state().pendingBars.find((event) => event.bar.time === 200)?.closed,
  true,
  'a weaker same-time update must not erase an accepted close confirmation',
);
boundaryHarness.flushRealtimeFrame(1_600);
const boundaryState = boundaryHarness.state();
assert.equal(boundaryState.barsCoalesced, 1, 'only the repeated same-time bar counts as coalesced');
assert.deepEqual(
  boundaryState.appliedBars.map((bar) => bar.time),
  [200, 201],
  'one frame must apply the closing bar before the next bar opens',
);
assert.deepEqual(
  boundaryState.appliedBars.map((bar) => bar.close),
  [12.5, 12.6],
  'a weaker same-time update must not replace the accepted closing bar payload',
);
assert.deepEqual(
  boundaryState.scheduledIndicatorTimes,
  [200, 201],
  'indicator refresh must retain every changed bar across a realtime boundary',
);

const crossFrameHarness = createRealtimeHarness(
  matchesRealtimeSelection,
  canApplyRealtimeBar,
  isRealtimeSequenceFresh,
  realtimeSequenceKey,
  reconcileBars,
);
crossFrameHarness.queueRealtimeBar({
  ...firstBar,
  source: 'aggTrade',
  sequence: 4_000_000_001,
  closed: false,
  bar: { ...firstBar.bar, time: 201, close: 12.6 },
});
crossFrameHarness.flushRealtimeFrame(1_700);
crossFrameHarness.queueRealtimeBar({
  ...firstBar,
  source: 'kline',
  sequence: 6_600_000_001,
  closed: true,
  bar: { ...firstBar.bar, time: 200, close: 12.9, volume: 9 },
});
crossFrameHarness.flushRealtimeFrame(1_800);
const crossFrameState = crossFrameHarness.state();
assert.deepEqual(
  crossFrameState.currentBars.map((bar) => [bar.time, bar.close]),
  [[100, 10], [200, 12.9], [201, 12.6]],
  'a closing kline that arrives after the next bar must replace only the penultimate bar',
);
assert.deepEqual(
  crossFrameState.scheduledIndicatorTimes,
  [201, 200],
  'a cross-frame late close must still refresh indicators for the closed bar',
);
assert.deepEqual(
  crossFrameState.historicalPrimaryUpdates,
  [false, true],
  'only the late penultimate close may use Lightweight Charts historical update',
);
assert.deepEqual(
  crossFrameState.historicalVolumeUpdates,
  [false, true],
  'the late penultimate volume must use the same historical update path',
);

const nonAuthoritativeCloseHarness = createRealtimeHarness(
  matchesRealtimeSelection,
  canApplyRealtimeBar,
  isRealtimeSequenceFresh,
  realtimeSequenceKey,
  reconcileBars,
);
nonAuthoritativeCloseHarness.queueRealtimeBar({
  ...firstBar,
  source: 'aggTrade',
  sequence: 4_000_000_001,
  closed: false,
  bar: { ...firstBar.bar, time: 201, close: 12.6 },
});
nonAuthoritativeCloseHarness.flushRealtimeFrame(1_900);
nonAuthoritativeCloseHarness.queueRealtimeBar({
  ...firstBar,
  source: 'aggTrade',
  sequence: 4_000_000_002,
  closed: true,
  bar: { ...firstBar.bar, time: 200, close: 13 },
});
nonAuthoritativeCloseHarness.flushRealtimeFrame(2_000);
assert.deepEqual(
  nonAuthoritativeCloseHarness.state().currentBars.map((bar) => [bar.time, bar.close]),
  [[100, 10], [200, 11], [201, 12.6]],
  'a non-kline source must not authorize a historical rewrite even if it claims closed=true',
);

const createIndicatorScheduleHarness = new Function(
  'trustedRunning = true', 'userRunning = false',
  `return (() => {
    const indicatorRuntime = { list: () => [{ indicatorId: 'builtin.ma', running: trustedRunning }] };
    const userIndicatorRuntime = { list: () => [{ indicatorId: 'user.custom', running: userRunning }] };
    const pendingRealtimeIndicatorUpdates = new Map();
    const refreshCalls = [];
    let pendingTimer;
    let realtimeIndicatorTimerId;
    const window = {
      setTimeout(callback) {
        pendingTimer = callback;
        return 1;
      },
    };
    function refreshIndicators(times, reason, updates) { refreshCalls.push({ times, reason, updates }); }
    ${scheduleRealtimeIndicatorsSource}
    return {
      scheduleRealtimeIndicators,
      flush: () => pendingTimer?.(),
      refreshCalls,
    };
  })();`,
);
const indicatorScheduleHarness = createIndicatorScheduleHarness();
indicatorScheduleHarness.scheduleRealtimeIndicators({ bar: { time: 201 }, closed: false, source: 'aggTrade', eventTimeMs: 3 });
indicatorScheduleHarness.scheduleRealtimeIndicators({ bar: { time: 200 }, closed: true, source: 'kline', eventTimeMs: 1 });
indicatorScheduleHarness.scheduleRealtimeIndicators({ bar: { time: 201 }, closed: false, source: 'kline', eventTimeMs: 2 });
indicatorScheduleHarness.flush();
assert.deepEqual(
  indicatorScheduleHarness.refreshCalls.map((call) => call.times),
  [[200, 201]],
  'the 250ms indicator batch must retain, sort, and deduplicate every changed bar time',
);
assert.deepEqual(
  indicatorScheduleHarness.refreshCalls[0].updates.map((update) => [update.barTime, update.closed]),
  [[200, true], [201, false]],
  'the indicator batch must preserve a confirmed close while coalescing realtime updates',
);

for (const [trustedRunning, userRunning] of [[false, true], [true, false], [true, true], [false, false]]) {
  const harness = createIndicatorScheduleHarness(trustedRunning, userRunning);
  harness.scheduleRealtimeIndicators({ bar: { time: 200 }, closed: true, source: 'kline', eventTimeMs: 1 });
  harness.scheduleRealtimeIndicators({ bar: { time: 200 }, closed: false, source: 'aggTrade', eventTimeMs: 2 });
  harness.scheduleRealtimeIndicators({ bar: { time: 201 }, closed: false, source: 'kline', eventTimeMs: 3 });
  harness.flush();
  assert.equal(harness.refreshCalls.length, trustedRunning || userRunning ? 1 : 0,
    `realtime dispatch must include .tfi-only charts (trusted=${trustedRunning}, user=${userRunning})`);
  if (harness.refreshCalls.length) {
    assert.deepEqual(harness.refreshCalls[0].updates.map(update => [update.barTime, update.closed]), [[200, true], [201, false]]);
  }
}

const createHealthResetHarness = new Function(
  `return (() => {
    let realtimeHealthStartedAt = 1;
    let realtimeHealthBarsReceived = 3;
    let realtimeHealthBarsApplied = 2;
    let realtimeHealthBarsCoalesced = 1;
    let realtimeHealthDepthReceived = 4;
    let realtimeHealthTradesReceived = 5;
    let realtimeHealthMarketRenders = 6;
    let realtimeHealthMaxQueueMs = 7;
    let realtimeHealthMaxEventAgeMs = 8;
    let realtimeHealthMaxFrameMs = 9;
    let realtimeHealthMaxArrivalGapMs = 10;
    let realtimeHealthMaxApplyGapMs = 11;
    let realtimeHealthLastArrivalAt = 12;
    let realtimeHealthLastApplyAt = 13;
    let realtimeHealthRequestId = 14;
    let realtimeHealthFallbackFlushes = 15;
    ${resetRealtimeHealthWindowSource}
    resetRealtimeHealthWindow(20, true);
    return {
      startedAt: realtimeHealthStartedAt,
      barsReceived: realtimeHealthBarsReceived,
      barsApplied: realtimeHealthBarsApplied,
      barsCoalesced: realtimeHealthBarsCoalesced,
      lastArrivalAt: realtimeHealthLastArrivalAt,
      lastApplyAt: realtimeHealthLastApplyAt,
      requestId: realtimeHealthRequestId,
    };
  })();`,
);
assert.deepEqual(
  createHealthResetHarness(),
  {
    startedAt: 20,
    barsReceived: 0,
    barsApplied: 0,
    barsCoalesced: 0,
    lastArrivalAt: 0,
    lastApplyAt: 0,
    requestId: 0,
  },
  'selection reset must not carry realtime health counters into the next request',
);

console.log('Realtime market event contract OK');
