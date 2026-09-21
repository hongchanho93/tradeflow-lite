import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEEP_HISTORY_BARS,
  DEEP_DAILY_HISTORY_BARS,
  HistoryMemoryCache,
  INITIAL_HISTORY_BARS,
  historyCacheKey,
  retainRealtimeHistory,
  shouldLoadDeepHistory,
  deepHistoryBars,
} from '../src/history-loader.ts';

assert.equal(INITIAL_HISTORY_BARS, 300);
assert.equal(DEEP_HISTORY_BARS, 8_000);
assert.equal(DEEP_DAILY_HISTORY_BARS, 12_000);
assert.equal(deepHistoryBars('1D'), 12_000);
assert.equal(deepHistoryBars('1W'), 8_000);
assert.equal(historyCacheKey('SH:600000', '1D', 'none'), 'SH:600000|1D|none');
assert.equal(historyCacheKey('tdx', 'SH:600000', '1D', 'none'), 'tdx|SH:600000|1D|none');
assert.notEqual(
  historyCacheKey('tdx', 'EXAMPLE:ABC', '1D', 'none'),
  historyCacheKey('custom', 'EXAMPLE:ABC', '1D', 'none'),
  'provider-qualified history keys must isolate providers',
);
assert.equal(shouldLoadDeepHistory(40, 300, false), true);
assert.equal(shouldLoadDeepHistory(41, 300, false), false);
assert.equal(shouldLoadDeepHistory(0, 8_000, false), false);
assert.equal(shouldLoadDeepHistory(0, 300, true), false);

const withinRealtimeRetention = Array.from({ length: 10_000 }, (_, index) => index);
assert.equal(retainRealtimeHistory(withinRealtimeRetention, '1').trimmed, 0);
const overRealtimeRetention = Array.from({ length: 10_001 }, (_, index) => index);
const trimmedRealtimeRetention = retainRealtimeHistory(overRealtimeRetention, '1');
assert.equal(trimmedRealtimeRetention.bars.length, 8_000);
assert.equal(trimmedRealtimeRetention.trimmed, 2_001);
assert.equal(trimmedRealtimeRetention.bars[0], 2_001);
assert.equal(retainRealtimeHistory(Array.from({ length: 15_001 }), '1D').bars.length, 12_000);

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
cache.delete('c');
assert.equal(cache.get('c'), undefined, 'manual chart refresh must be able to evict the current history entry');
now = 1_101;
assert.equal(cache.get('a'), undefined, 'expired history must not be reused');

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const tauriLib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const tdxMarketData = readFileSync(new URL('../src-tauri/src/market_data/mod.rs', import.meta.url), 'utf8');
const tdxHistory = readFileSync(new URL('../src-tauri/src/market_data/history.rs', import.meta.url), 'utf8');
assert.match(
  mainSource,
  /const deepHistoryLoading = new Map<string, number>\(\)/,
  'deep-history loading state must track request incarnation instead of only the selection cache key',
);
const requestHistoryStart = mainSource.indexOf('function requestHistory(');
const replaceHistoryStart = mainSource.indexOf('\nfunction replaceHistorySeries', requestHistoryStart);
const requestHistorySource = mainSource.slice(requestHistoryStart, replaceHistoryStart);
assert.match(
  requestHistorySource,
  /generation = historyRequestGate\.current\(\)[\s\S]*\|g\$\{generation\}/,
  'in-flight history deduplication must include the selection generation so A -> B -> A cannot reuse the first A promise',
);
const deepStart = mainSource.indexOf('async function loadDeepHistory(');
const scheduleStart = mainSource.indexOf('\nfunction scheduleDeepHistory(', deepStart);
const deepSource = mainSource.slice(deepStart, scheduleStart);
assert.match(
  deepSource,
  /generation = historyRequestGate\.current\(\)[\s\S]*historyRequestGate\.isCurrent\(generation\)[\s\S]*await requestHistory\([\s\S]*generation[\s\S]*historyRequestGate\.isCurrent\(generation\)/,
  'deep history must validate the same incarnation before starting and again after the asynchronous fetch',
);
assert.match(
  deepSource,
  /deepHistoryLoading\.get\(cacheKey\) === generation[\s\S]*deepHistoryLoading\.delete\(cacheKey\)/,
  'an old deep-history task must not clear a newer incarnation loading the same A selection',
);
const scheduleEnd = mainSource.indexOf('\nasync function openHistory(', scheduleStart);
const scheduleSource = mainSource.slice(scheduleStart, scheduleEnd);
assert.match(
  scheduleSource,
  /const generation = historyRequestGate\.current\(\)[\s\S]*timerKey = `\$\{cacheKey\}\|g\$\{generation\}`[\s\S]*loadDeepHistory\(symbol, resolution, adjustment, generation\)/,
  'scheduled deep-history work must carry the incarnation captured when it was scheduled',
);
assert.match(
  mainSource,
  /historyRequestIncarnationSeed = realtimeRequestSeed\(Date\.now\(\)\)[\s\S]*requestIncarnation: historyRequestIncarnation\(generation\)/,
  'frontend history requests must carry a reload-safe monotonic incarnation to Tauri',
);
const openHistoryStart = mainSource.indexOf('async function openHistory(');
const refreshHistoryStart = mainSource.indexOf('\nasync function refreshCurrentHistory(', openHistoryStart);
const openHistorySource = mainSource.slice(openHistoryStart, refreshHistoryStart);
assert.match(
  openHistorySource,
  /historyRequestGate\.begin\(\)[\s\S]*activate_history_incarnation[\s\S]*historyRequestIncarnation\(generation\)/,
  'every selection switch, including a cache hit, must activate the new backend history incarnation',
);
const networkRealtimeStart = openHistorySource.lastIndexOf('void startRealtimeMarket(');
const networkHistoryAwait = openHistorySource.indexOf('const response = await requestHistory(');
assert.ok(
  networkRealtimeStart !== -1 && networkRealtimeStart < networkHistoryAwait,
  'an uncached selection must start realtime connection work before waiting for REST history',
);
assert.match(
  openHistorySource,
  /networkHistoryDisplayed = true[\s\S]*catch \(error\) \{[\s\S]*stopRealtimeMarket\(\)[\s\S]*scheduleLatestPoll\(networkHistoryDisplayed && match\.realtime \? 0 : undefined\)/,
  'parallel realtime startup must stop on history failure and immediately reconcile bars after history becomes visible',
);
assert.match(
  tauriLib,
  /fn activate_history_incarnation\(request_incarnation: u64\)[\s\S]*market_data::activate_history_incarnation\(request_incarnation\)/,
  'Tauri must expose an explicit history-incarnation activation command',
);
assert.match(
  tauriLib,
  /async fn get_history_bars\([\s\S]*request_incarnation: u64[\s\S]*with_history_incarnation\(request_incarnation/,
  'blocking history work must retain the frontend incarnation while the provider executes',
);
assert.match(
  tdxMarketData,
  /ACTIVE_HISTORY_INCARNATION[\s\S]*fn history_request_is_active\(\)[\s\S]*history_request_cancelled/,
  'TDX history routing must expose a shared active-incarnation cancellation check',
);
assert.match(
  tdxHistory,
  /while rows\.len\(\) < count \{[\s\S]*history_request_is_active\(\)[\s\S]*history_request_cancelled[\s\S]*MAX_BARS_PER_REQUEST/,
  'TDX deep-history pagination must check cancellation before requesting each page',
);
const reconciliationStart = mainSource.indexOf('function commitBarReconciliation(');
const chartTypeStart = mainSource.indexOf('\nfunction applyChartType(', reconciliationStart);
const reconciliationSource = mainSource.slice(reconciliationStart, chartTypeStart);
assert.match(
  reconciliationSource,
  /retainRealtimeHistory\(reconciliation\.bars, currentResolution\)[\s\S]*retentionTrimmed[\s\S]*setPrimarySeriesData\(\)[\s\S]*volumeSeries\.setData/,
  'rolling retention must reset primary and volume series from the same bounded currentBars window',
);
assert.match(
  reconciliationSource,
  /retentionTrimmed[\s\S]*refreshIndicators\(undefined, 'reconciliation', realtimeUpdates\)/,
  'rolling retention must fully reconcile indicators when the front of currentBars is trimmed',
);
const realtimePointStart = mainSource.indexOf('function applyRealtimePoint(');
const realtimeDepthStart = mainSource.indexOf('\nfunction applyRealtimeDepth(', realtimePointStart);
const realtimePointSource = mainSource.slice(realtimePointStart, realtimeDepthStart);
assert.match(
  realtimePointSource,
  /commitBarReconciliation\(reconcileBars\(currentBars, \[bar\]\), 'realtime', \[\], false\)/,
  'probability realtime points must share the bounded currentBars reconciliation path',
);
assert.match(
  realtimePointSource,
  /points\.filter\(\(candidate\) => candidate\.time >= earliestRetainedTime\)/,
  'probability point cache must trim alongside retained synthetic bars',
);

console.log('History loading policy OK');
