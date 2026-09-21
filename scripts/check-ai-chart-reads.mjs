import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { CapabilityCore, CapabilityRegistry } from '../src/ai-capabilities/index.ts';
import { ChartSnapshotStore, CHART_DATA_LIMITS } from '../src/ai-capabilities/chart-data.ts';
import { createChartReadTools } from '../src/ai-capabilities/chart-tools.ts';
import { ChartReadBridge } from '../src/ai-capabilities/chart-host.ts';
import { reconcileBars } from '../src/bar-series.ts';
import { retainRealtimeHistory } from '../src/history-loader.ts';
import { LatestRequestGate } from '../src/latest-request.ts';
import { probabilityPointsToBars } from '../src/probability-series.ts';

const tests = [];
const test = (name, run) => tests.push({ name, run });
const scope = () => ({ appInstanceId: 'app-one', chartId: 'main', provider: 'tdx',
  instrument: 'SH:600000', resolution: '1', adjustment: 'qfq', selectionGeneration: 1 });
const bar = (index, close = index + 1) => ({ time: 1_700_000_000 + index * 60,
  open: close, high: close + 1, low: close - 1, close, volume: (index + 1) * 10 });
const plain = value => JSON.parse(JSON.stringify(value));
const ok = async promise => {
  const reply = await promise;
  assert.equal(reply.status, 'ok', JSON.stringify(reply));
  return reply.data;
};
const error = async (promise, code) => {
  const reply = await promise;
  assert.equal(reply.status, 'error', JSON.stringify(reply));
  assert.equal(reply.code, code);
  return reply;
};

function fixture(options = {}) {
  let current = scope();
  let mono = 0;
  let wall = 1_800_000_000_000;
  let next = 0;
  let reads = 0;
  const state = { context: current, displayedGeneration: 1, dataRevision: 1, seriesKind: 'ohlcv',
    bars: [bar(0, 10), bar(1, 20), bar(2, 30)], timeZone: 'Asia/Shanghai', displayTimeZone: 'Asia/Seoul',
    ...options.state };
  const store = new ChartSnapshotStore(() => { reads += 1; options.onRead?.(); return state; }, {
    now: () => mono, wallNow: () => wall, limits: options.limits,
  });
  const registry = new CapabilityRegistry(createChartReadTools(store));
  const core = new CapabilityCore(registry, { limits: options.coreLimits });
  const grants = Object.fromEntries(registry.describe().map(tool => [tool.id, 'allow']));
  const open = (permissions = grants) => core.openSession({ context: current, currentContext: () => current, permissions });
  const session = open(options.permissions);
  const invoke = (toolId, input = {}, target = session, requestId = `r-${++next}`) => target.invoke(JSON.stringify({
    protocolVersion: 1, requestId, toolId, context: current, input,
  }));
  return { state, store, registry, core, session, open, invoke,
    capture: target => ok(invoke('tf.chart.snapshot', {}, target)),
    advance: ms => { mono += ms; wall += ms; },
    select: value => { current = value; },
    get reads() { return reads; },
    close: () => session.close(),
  };
}

test('five model-independent read tools have strict schemas; no write/code/network tool', () => {
  const f = fixture();
  assert.deepEqual(f.registry.describe().map(tool => tool.id),
    ['tf.chart.snapshot', 'tf.dataset.page', 'tf.dataset.release', 'tf.compute.summary', 'tf.compute.sma']);
  assert.ok(f.registry.describe().every(tool => tool.effect === 'read' && !('run' in tool)));
  assert.equal(f.reads, 0, 'creating a bridge/session must not scan chart data');
  f.close();
});

test('snapshot describes real fields/units/range without inventing finality or freshness', async () => {
  const f = fixture();
  const d = await f.capture();
  assert.equal(d.rowCount, 3);
  assert.equal(d.capturedAtMs, 1_800_000_000_000);
  assert.equal(d.dataRevision, 1);
  assert.deepEqual(plain(d.context), scope());
  assert.equal(d.fromTime, bar(0).time);
  assert.equal(d.metadata.volumeUnit, 'unknown');
  assert.equal(d.metadata.finality, 'unknown');
  assert.equal(d.metadata.coverage, 'retained-chart-window');
  assert.equal(d.metadata.gapAssessment, 'not-assessed');
  assert.equal(d.metadata.timeZone, 'Asia/Shanghai');
  assert.equal(d.metadata.displayTimeZone, 'Asia/Seoul');
  assert.equal(d.bars, undefined);
  assert.equal(f.reads, 1);
  f.close();
});

test('captured rows and replies are detached and immutable across live updates', async () => {
  const f = fixture();
  const d = await f.capture();
  f.state.bars[0].close = 999;
  f.state.bars = [bar(0, 70), bar(1, 80), bar(2, 90), bar(3, 100)];
  f.state.dataRevision += 1;
  const page = await ok(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId }));
  assert.deepEqual(page.bars.map(row => row.close), [10, 20, 30]);
  assert.throws(() => { page.bars[0].close = 400; }, TypeError);
  assert.equal(page.dataRevision, 1);
  const newer = await f.capture();
  assert.equal(newer.dataRevision, 2);
  assert.equal(newer.rowCount, 4);
  assert.equal(f.reads, 2, 'paging never reads a newer feed');
  f.close();
});

test('pagination is chronological, bounded, stable and ends with an explicit empty page', async () => {
  const f = fixture(); const d = await f.capture();
  const p1 = await ok(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId, limit: 2 }));
  const p2 = await ok(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId, offset: p1.nextOffset, limit: 2 }));
  assert.deepEqual(p1.bars.concat(p2.bars).map(row => row.close), [10, 20, 30]);
  assert.equal(p1.hasMore, true); assert.equal(p2.hasMore, false);
  const end = await ok(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId, offset: 3 }));
  assert.deepEqual(end.bars, []); assert.equal(end.nextOffset, 3);
  for (const extra of [{ limit: 1001 }, { offset: -1 }, { offset: 1.5 }, { limit: 0 }, { offset: 4 }]) {
    await error(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId, ...extra }), 'invalid_request');
  }
  f.close();
});

test('data loading/failed selection never relabels old visible bars as a new generation', async () => {
  const f = fixture({ state: { displayedGeneration: -1 } });
  await error(f.invoke('tf.chart.snapshot'), 'data_not_ready');
  assert.equal(f.store.retainedSnapshots, 0);
  f.state.displayedGeneration = 1;
  assert.equal((await f.capture()).rowCount, 3);
  f.close();
});

test('empty retained window returns not ready rather than fabricated data', async () => {
  const f = fixture({ state: { bars: [] } });
  await error(f.invoke('tf.chart.snapshot'), 'data_not_ready'); f.close();
});

test('host data scope must match the authenticated session, even with equal generations', async () => {
  const f = fixture({ state: { context: { ...scope(), instrument: 'SH:600001' } } });
  await error(f.invoke('tf.chart.snapshot'), 'context_stale');
  assert.equal(f.store.retainedSnapshots, 0); f.close();
});

test('A to B to A cannot revive a previous session or dataset', async () => {
  const f = fixture(); const d = await f.capture();
  f.select({ ...scope(), instrument: 'SH:600001', selectionGeneration: 2 });
  await error(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId }), 'context_stale');
  f.select({ ...scope(), selectionGeneration: 3 });
  await error(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId }), 'context_stale');
  const newer = f.open();
  await error(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId }, newer), 'snapshot_unavailable');
  f.close(); newer.close();
});

test('dataset IDs are not bearer credentials, including sessions sharing the same chart', async () => {
  const f = fixture(); const d = await f.capture(); const other = f.open();
  for (const [tool, extra] of [['tf.dataset.page', {}], ['tf.dataset.release', {}],
    ['tf.compute.summary', { field: 'close' }], ['tf.compute.sma', { field: 'close', period: 2 }]]) {
    await error(f.invoke(tool, { snapshotId: d.snapshotId, ...extra }, other), 'snapshot_unavailable');
  }
  assert.equal(f.store.retainedSnapshots, 1);
  f.close(); other.close();
});

test('permission denial prevents capture and calculation before accessing data', async () => {
  const f = fixture({ permissions: {} });
  await error(f.invoke('tf.chart.snapshot'), 'permission_denied');
  await error(f.invoke('tf.compute.summary', { snapshotId: 'guess', field: 'close' }), 'permission_denied');
  assert.equal(f.reads, 0); f.close();
});

test('capture approval uses the current committed data only after real host approval', async () => {
  const f = fixture({ permissions: { 'tf.chart.snapshot': 'ask' } });
  const reply = await f.invoke('tf.chart.snapshot', {}, f.session, 'ask-1');
  assert.equal(reply.status, 'approval_required'); assert.equal(f.reads, 0);
  f.state.bars = [bar(0, 99)];
  assert.equal((await ok(f.session.approve('ask-1'))).rowCount, 1);
  f.close();
});

test('approval after selection change does not read the new chart under old authorization', async () => {
  const f = fixture({ permissions: { 'tf.chart.snapshot': 'ask' } });
  await f.invoke('tf.chart.snapshot', {}, f.session, 'ask-1');
  f.select({ ...scope(), selectionGeneration: 2 });
  await error(f.session.approve('ask-1'), 'context_stale');
  assert.equal(f.reads, 0); f.close();
});

test('same request retries do not create duplicate snapshots', async () => {
  const f = fixture();
  const first = await ok(f.invoke('tf.chart.snapshot', {}, f.session, 'same'));
  const again = await ok(f.invoke('tf.chart.snapshot', {}, f.session, 'same'));
  assert.equal(first.snapshotId, again.snapshotId);
  assert.equal(f.store.retainedSnapshots, 1); assert.equal(f.reads, 1); f.close();
});

test('session close immediately frees all owned datasets, not other sessions', async () => {
  const f = fixture(); await f.capture(); await f.capture();
  const other = f.open(); const theirs = await f.capture(other);
  f.close();
  assert.equal(f.store.retainedSnapshots, 1);
  assert.equal((await ok(f.invoke('tf.dataset.page', { snapshotId: theirs.snapshotId }, other))).bars.length, 3);
  other.close(); assert.equal(f.store.retainedSnapshots, 0); assert.equal(f.store.retainedBytes, 0);
});

test('explicit release frees capacity without touching the chart or other snapshots', async () => {
  const f = fixture(); const first = await f.capture(); await f.capture();
  await error(f.invoke('tf.chart.snapshot'), 'snapshot_capacity');
  await ok(f.invoke('tf.dataset.release', { snapshotId: first.snapshotId }));
  await f.capture(); assert.equal(f.store.retainedSnapshots, 2);
  assert.equal(f.state.bars.length, 3);
  await error(f.invoke('tf.dataset.page', { snapshotId: first.snapshotId }), 'snapshot_unavailable'); f.close();
});

test('expiry is enforced without silently reusing IDs or refetching data', async () => {
  const f = fixture(); const old = await f.capture();
  f.advance(CHART_DATA_LIMITS.ttlMs);
  await error(f.invoke('tf.dataset.page', { snapshotId: old.snapshotId }), 'snapshot_unavailable');
  assert.equal(f.store.retainedSnapshots, 0); assert.equal(f.store.retainedBytes, 0);
  assert.notEqual((await f.capture()).snapshotId, old.snapshotId); f.close();
});

test('global snapshot capacity applies across session churn', async () => {
  const f = fixture({ limits: { maxSnapshots: 1 } }); await f.capture();
  const other = f.open();
  await error(f.invoke('tf.chart.snapshot', {}, other), 'snapshot_capacity');
  f.close(); await f.capture(other); other.close(); assert.equal(f.store.retainedBytes, 0);
});

test('row/byte budgets reject whole capture, never retain partial datasets', async () => {
  for (const limits of [{ maxRows: 2 }, { maxSnapshotBytes: 10 }, { maxStoredBytes: 10 }]) {
    const f = fixture({ limits });
    await error(f.invoke('tf.chart.snapshot'), limits.maxRows ? 'invalid_chart_data' : 'snapshot_capacity');
    assert.equal(f.store.retainedSnapshots, 0); assert.equal(f.store.retainedBytes, 0); f.close();
  }
});

test('invalid budget overrides cannot disable protection', () => {
  for (const limits of [{ maxRows: 0 }, { ttlMs: Infinity }, { noLimit: 1 }, { maxRows: 15001 },
    { maxPageRows: 10 }, { defaultPageRows: 10 }]) {
    assert.throws(() => new ChartSnapshotStore(() => { throw new Error(); }, { limits }), /invalid_contract/);
  }
});

test('unusable bars fail rather than silently sorting, dropping or zero-filling rows', async () => {
  for (const bars of [[bar(0), bar(0)], [bar(1), bar(0)], [{ ...bar(0), close: NaN }],
    [{ ...bar(0), time: 1.5 }], [{ ...bar(0), high: -9 }], [{ ...bar(0), volume: -1 }],
    [{ ...bar(0), amount: Infinity }], [bar(0), undefined]]) {
    const f = fixture({ state: { bars } });
    await error(f.invoke('tf.chart.snapshot'), 'invalid_chart_data');
    assert.equal(f.store.retainedSnapshots, 0); f.close();
  }
});

test('negative adjusted prices and calendar/session time gaps remain intact', async () => {
  const f = fixture({ state: { bars: [bar(0, -10), bar(10000, -5)] } });
  const d = await f.capture();
  const page = await ok(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId }));
  assert.deepEqual(page.bars.map(row => row.close), [-10, -5]);
  assert.equal(page.bars.length, 2);
  assert.equal(d.metadata.gapAssessment, 'not-assessed'); f.close();
});

test('extra host fields, diagnostics, credentials and arbitrary properties never leave the adapter', async () => {
  const f = fixture({ state: { bars: [{ ...bar(0), secret: 'fake-secret' }], diagnostics: { path: '/private/fake' } } });
  const d = await f.capture();
  const page = await ok(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId }));
  assert.doesNotMatch(JSON.stringify([d, page]), /fake-secret|private|diagnostics/); f.close();
});

test('probability data returns actual points, never synthetic bars or zero volume', async () => {
  const points = [{ time: 10, value: 30 }, { time: 20, value: 50 }];
  const f = fixture({ state: { seriesKind: 'probability', bars: probabilityPointsToBars(points), timeZone: 'UTC' } });
  const d = await f.capture();
  const page = await ok(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId }));
  assert.equal(d.metadata.priceUnit, 'percent'); assert.equal(d.metadata.volumeUnit, 'not-applicable');
  assert.deepEqual(plain(page.points), points); assert.equal(page.bars, undefined);
  assert.deepEqual(d.fields, ['time', 'value']);
  const summary = await ok(f.invoke('tf.compute.summary', { snapshotId: d.snapshotId, field: 'value' }));
  assert.equal(summary.mean, 40);
  for (const field of ['volume', 'open', 'close']) {
    await error(f.invoke('tf.compute.summary', { snapshotId: d.snapshotId, field }), 'field_unavailable');
  }
  f.close();
});

test('out of range probability cannot pass through as a valid percentage', async () => {
  const f = fixture({ state: { seriesKind: 'probability', bars: [bar(0, 101)] } });
  await error(f.invoke('tf.chart.snapshot'), 'invalid_chart_data'); f.close();
});

test('summary computes deterministic full/range statistics with evidence timestamps', async () => {
  const f = fixture(); const d = await f.capture();
  const summary = await ok(f.invoke('tf.compute.summary', { snapshotId: d.snapshotId, field: 'close' }));
  assert.equal(summary.sum, 60); assert.equal(summary.mean, 20); assert.equal(summary.count, 3);
  assert.equal(summary.min, 10); assert.equal(summary.max, 30);
  assert.equal(summary.minTime, bar(0).time); assert.equal(summary.maxTime, bar(2).time);
  const range = await ok(f.invoke('tf.compute.summary', { snapshotId: d.snapshotId, field: 'close', offset: 1, count: 2 }));
  assert.equal(range.first, 20); assert.equal(range.last, 30); assert.equal(range.mean, 25);
  await error(f.invoke('tf.compute.summary', { snapshotId: d.snapshotId, field: 'close', offset: 2, count: 2 }), 'invalid_request');
  await error(f.invoke('tf.compute.summary', { snapshotId: d.snapshotId, field: 'value' }), 'field_unavailable'); f.close();
});

test('missing amount is explicit; real zero is a value and never treated as missing', async () => {
  const f = fixture({ state: { bars: [{ ...bar(0), amount: 0 }, bar(1)] } });
  const d = await f.capture(); assert.equal(d.metadata.amountCoverage, 'partial');
  await error(f.invoke('tf.compute.summary', { snapshotId: d.snapshotId, field: 'amount' }), 'field_unavailable');
  const one = await ok(f.invoke('tf.compute.summary', { snapshotId: d.snapshotId, field: 'amount', count: 1 }));
  assert.equal(one.sum, 0); assert.equal(one.count, 1); f.close();
});

test('SMA matches built-in warm-up and is unchanged across page boundaries', async () => {
  const f = fixture(); const d = await f.capture();
  const input = { snapshotId: d.snapshotId, field: 'close', period: 3 };
  const first = await ok(f.invoke('tf.compute.sma', { ...input, limit: 2 }));
  assert.deepEqual(first.points.map(row => row.ready), [false, false]);
  assert.ok(first.points.every(row => !('value' in row)));
  const second = await ok(f.invoke('tf.compute.sma', { ...input, offset: 2, limit: 1 }));
  assert.equal(second.points[0].value, 20); assert.equal(second.points[0].ready, true);
  assert.equal(second.hasMore, false);
  const longer = await ok(f.invoke('tf.compute.sma', { ...input, period: 4 }));
  assert.ok(longer.points.every(row => row.ready === false));
  await error(f.invoke('tf.compute.sma', { ...input, period: 0 }), 'invalid_request'); f.close();
});

test('summary/SMA numeric overflow returns an explicit error, never Infinity/null/zero', async () => {
  const f = fixture({ state: { bars: [bar(0, 1e308), bar(1, 1e308)] } }); const d = await f.capture();
  await error(f.invoke('tf.compute.summary', { snapshotId: d.snapshotId, field: 'close' }), 'numeric_overflow');
  await error(f.invoke('tf.compute.sma', { snapshotId: d.snapshotId, field: 'close', period: 2 }), 'numeric_overflow'); f.close();
});

test('cancel before invocation does no snapshot work and cannot later return success', async () => {
  const f = fixture(); const pending = f.invoke('tf.chart.snapshot', {}, f.session, 'cancel-me');
  assert.equal(f.session.cancel('cancel-me'), true);
  await error(pending, 'cancelled');
  assert.equal(f.reads, 0); assert.equal(f.store.retainedSnapshots, 0); f.close();
});

test('revocation during a host read rejects the result and retains no data', async () => {
  let f; f = fixture({ onRead: () => f.close() });
  await error(f.invoke('tf.chart.snapshot'), 'session_closed');
  assert.equal(f.store.retainedSnapshots, 0); assert.equal(f.store.retainedBytes, 0);
});

test('cancellation after capture but before reply releases the undisclosed dataset', async () => {
  const f = fixture();
  const pending = f.invoke('tf.chart.snapshot', {}, f.session, 'cancel-after-capture');
  await Promise.resolve();
  assert.equal(f.store.retainedSnapshots, 1, 'handler has captured, reply not yet delivered');
  assert.equal(f.session.cancel('cancel-after-capture'), true);
  await error(pending, 'cancelled');
  assert.equal(f.store.retainedSnapshots, 0, 'caller cannot release a snapshot ID it never received');
  assert.equal(f.store.retainedBytes, 0);
  f.close();
});

test('rejected output also releases snapshots whose IDs were never delivered', async () => {
  const f = fixture({ coreLimits: { maxOutputBytes: 64 } });
  await error(f.invoke('tf.chart.snapshot'), 'invalid_output');
  assert.equal(f.store.retainedSnapshots, 0); assert.equal(f.store.retainedBytes, 0);
  f.close();
});

test('unknown fields and code/path/approval injection are rejected before business handlers', async () => {
  const f = fixture();
  for (const input of [{ approved: true }, { code: 'while(true){}' }, { path: 'src/main.ts' }]) {
    await error(f.invoke('tf.chart.snapshot', input), 'invalid_request');
  }
  assert.equal(f.reads, 0); f.close();
});

test('12000 bars can be paged and computed without enlarging wire JSON limits', async () => {
  const f = fixture({ state: { bars: Array.from({ length: 12_000 }, (_, index) => bar(index)) } });
  const started = performance.now(); const d = await f.capture(); const elapsed = performance.now() - started;
  let rows = 0;
  for (let offset = 0; offset < 12_000; offset += 1000) {
    const page = await ok(f.invoke('tf.dataset.page', { snapshotId: d.snapshotId, offset, limit: 1000 }));
    assert.equal(page.bars[0].time, bar(offset).time); rows += page.bars.length;
  }
  assert.equal(rows, 12_000);
  const summary = await ok(f.invoke('tf.compute.summary', { snapshotId: d.snapshotId, field: 'close' }));
  assert.equal(summary.mean, 6000.5);
  const tail = await ok(f.invoke('tf.compute.sma', { snapshotId: d.snapshotId, field: 'close', period: 20, offset: 11_999 }));
  assert.equal(tail.points[0].value, 11990.5);
  assert.ok(f.store.retainedBytes < CHART_DATA_LIMITS.maxSnapshotBytes);
  console.log(`AI chart 12000-row capture: ${elapsed.toFixed(2)}ms; retained JSON ${f.store.retainedBytes} bytes`);
  f.close(); assert.equal(f.store.retainedBytes, 0);
});

// Execute actual main.ts reader/commit functions, not a copied mock implementation.
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
function section(start, end) {
  const from = main.indexOf(start); const to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing main.ts section ${start}`);
  return stripTypeScriptTypes(main.slice(from, to).replace('export function ', 'function '));
}
const readers = section('function readCurrentAiChartSelection(', '\nfunction replaceHistorySeries(');
const replace = section('function replaceHistorySeries(', '\nfunction showHistory(');
const commit = section('function commitBarReconciliation(', '\nfunction applyChartType(');
function mainHarness() {
  return new Function('ChartReadBridge', 'LatestRequestGate', 'retainRealtimeHistory', `
    const aiChartAppInstanceId = 'actual-main-source';
    let currentSymbol = { providerId: 'tdx', symbol: 'SH:600000' };
    let currentResolution = '1', currentAdjustment = 'qfq', currentSeriesKind = 'ohlcv';
    let currentBars = [], aiDisplayedHistoryGeneration = -1, aiChartDataRevision = 0, aiChartReadBridge;
    const historyRequestGate = new LatestRequestGate(); historyRequestGate.begin();
    const exchangeTimeZone = () => 'Asia/Shanghai', activeTradingTimeZone = () => 'Asia/Seoul';
    let displayed = [], failRender = false, deepHistoryNavigationReady = false;
    const volumeVisible = true;
    const chart = { timeScale: () => ({ getVisibleRange: () => null, setVisibleRange() {}, setVisibleLogicalRange() {} }) };
    const volumeSeries = { setData() {}, applyOptions() {}, update() {} };
    function setPrimarySeriesData() { if (failRender) throw Error('render failed'); displayed = currentBars.slice(); }
    function updatePrimarySeries() { setPrimarySeriesData(); }
    const refreshIndicators = () => {}, renderPriceLines = () => {}, renderSeriesMarkers = () => {};
    const syncCurrentHistoryCacheBars = () => {}, volumePoint = value => value;
    const requestAnimationFrame = callback => callback();
    const initialVisibleLogicalRange = () => ({from:0, to:1});
    ${readers}
    ${replace}
    ${commit}
    return {
      context: readCurrentAiChartSelection,
      open: openAiChartReadSession,
      state: readCurrentAiChartState,
      replace: bars => replaceHistorySeries(bars, false),
      markDisplayed: () => { aiDisplayedHistoryGeneration = historyRequestGate.current(); },
      beginSelection: () => historyRequestGate.begin(),
      commit: commitBarReconciliation,
      fail: () => { failRender = true; },
      displayed: () => displayed,
    };
  `)(ChartReadBridge, LatestRequestGate, retainRealtimeHistory);
}

test('actual main.ts read port consumes the committed chart, including history corrections', async () => {
  const host = mainHarness();
  const session = host.open({ 'tf.chart.snapshot': 'allow', 'tf.dataset.page': 'allow', 'tf.compute.summary': 'allow' });
  let sequence = 0;
  const call = (toolId, input = {}) => session.invoke(JSON.stringify({
    protocolVersion: 1, requestId: `main-${++sequence}`, toolId, input, context: host.context(),
  }));
  await error(call('tf.chart.snapshot'), 'data_not_ready');
  host.replace([bar(0, 10), bar(1, 20)]); host.markDisplayed();
  const before = await ok(call('tf.chart.snapshot'));
  assert.equal(before.dataRevision, 1);
  host.commit(reconcileBars(host.state().bars, [bar(0, 15), bar(2, 30)]));
  assert.equal(host.state().dataRevision, 2);
  assert.deepEqual(host.displayed().map(row => row.close), [15, 20, 30]);
  const after = await ok(call('tf.chart.snapshot'));
  const oldPage = await ok(call('tf.dataset.page', { snapshotId: before.snapshotId }));
  const newPage = await ok(call('tf.dataset.page', { snapshotId: after.snapshotId }));
  assert.deepEqual(oldPage.bars.map(row => row.close), [10, 20]);
  assert.deepEqual(newPage.bars.map(row => row.close), [15, 20, 30]);
  host.beginSelection();
  await error(call('tf.chart.snapshot'), 'context_stale'); session.close();
  const pending = host.open({ 'tf.chart.snapshot': 'allow' });
  await error(pending.invoke(JSON.stringify({ protocolVersion: 1, requestId: 'new-session',
    toolId: 'tf.chart.snapshot', context: host.context(), input: {} })), 'data_not_ready'); pending.close();
});

test('actual main.ts renderer failure leaves new captures unavailable, not falsely committed', async () => {
  const host = mainHarness(); host.replace([bar(0)]); host.markDisplayed(); host.fail();
  assert.throws(() => host.replace([bar(0, 9)]), /render failed/);
  assert.equal(host.state().displayedGeneration, -1);
  const session = host.open({ 'tf.chart.snapshot': 'allow' });
  await error(session.invoke(JSON.stringify({ protocolVersion: 1, requestId: 'failed-render',
    toolId: 'tf.chart.snapshot', context: host.context(), input: {} })), 'data_not_ready'); session.close();
});

test('production wiring is lazy, has no new query/IPC/global, and marks successful history display only', () => {
  assert.doesNotMatch(readers, /\b(?:invoke|fetch|requestHistory|openHistory|getHistoryCache)\s*\(/);
  assert.match(readers, /bars: currentBars/);
  assert.match(readers, /aiChartReadBridge \?\?= new ChartReadBridge/);
  assert.equal((main.match(/openAiChartReadSession\(/g) ?? []).length, 1, 'do not open an automatic session');
  assert.doesNotMatch(main, /(?:window|globalThis)\.\w+\s*=\s*(?:aiChartReadBridge|openAiChartReadSession)/);
  const display = section('function showHistory(', '\nfunction clearDeepHistoryTimer(');
  assert.match(display, /setStatusLabel\(status, statusText\);\s*currentHistoryDiagnostics = \{ \.\.\.response.diagnostics \};\s*aiDataWindowTime = null;\s*aiDisplayedHistoryGeneration = historyRequestGate.current\(\)/);
});

let failures = 0;
for (const { name, run } of tests) {
  try { await run(); }
  catch (failure) { failures += 1; console.error(`FAIL ${name}\n${failure.stack}`); }
}
if (failures) throw new Error(`AI chart reads: ${failures}/${tests.length} scenarios failed`);
console.log(`AI chart reads: ${tests.length} scenarios passed`);
