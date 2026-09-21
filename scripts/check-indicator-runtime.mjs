import assert from 'node:assert/strict';

import { IndicatorDataRouter } from '../src/indicator-sdk/data-router.ts';
import { IndicatorExecutionScope } from '../src/indicator-sdk/execution-scope.ts';
import { IndicatorChartHost } from '../src/indicator-sdk/chart-host.ts';
import { defineIndicator } from '../src/indicator-sdk/define-indicator.ts';
import { IndicatorRegistry } from '../src/indicator-sdk/registry.ts';
import { IndicatorRuntime, normalizeIndicatorInputs } from '../src/indicator-sdk/runtime.ts';
import { IndicatorMainSeriesHost } from '../src/indicator-sdk/main-series-host.ts';
import { IndicatorMarketRouter } from '../src/indicator-sdk/market-router.ts';
import { createIndicatorTestHarness } from '../src/indicator-sdk/testing.ts';
import { refreshIndicatorBarStyles } from '../src/indicator-sdk/main-series-refresh.ts';

const sourceBars = [
  { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
  { time: 200, open: 1.5, high: 3, low: 1, close: 2.5, volume: 20 },
];
const refreshCalls = { setData: [], updates: [], ranges: [] };
const preservedRange = { from: 10, to: 20 };
const batchRefresh = refreshIndicatorBarStyles({
  bars: Array.from({ length: 100 }, (_, index) => index),
  changedFrom: 0,
  pointAt: (bar) => bar * 2,
  setData: (points) => refreshCalls.setData.push(points),
  update: (point, historical) => refreshCalls.updates.push({ point, historical }),
  getVisibleRange: () => preservedRange,
  setVisibleRange: (range) => refreshCalls.ranges.push(range),
});
assert.deepEqual(batchRefresh, { mode: 'batch', changedFrom: 0, dirtyCount: 100 });
assert.equal(refreshCalls.setData[0].length, 100, 'broad style invalidation uses one batch replacement');
assert.deepEqual(refreshCalls.updates, [], 'broad style invalidation never loops historical updates');
assert.deepEqual(refreshCalls.ranges, [preservedRange], 'batch style refresh preserves the visible range');
const tailRefresh = refreshIndicatorBarStyles({
  bars: [1, 2, 3],
  changedFrom: 2,
  pointAt: (bar) => bar * 2,
  setData: (points) => refreshCalls.setData.push(points),
  update: (point, historical) => refreshCalls.updates.push({ point, historical }),
  getVisibleRange: () => null,
  setVisibleRange: (range) => refreshCalls.ranges.push(range),
});
assert.deepEqual(tailRefresh, { mode: 'incremental', changedFrom: 2, dirtyCount: 1 });
assert.deepEqual(refreshCalls.updates, [{ point: 6, historical: true }], 'realtime tail styling remains incremental');
const router = new IndicatorDataRouter();
const initial = router.event(sourceBars, 'initial', 0);
assert.ok(Object.isFrozen(initial));
assert.ok(Object.isFrozen(initial.bars));
assert.ok(initial.bars.every(Object.isFrozen));
assert.notEqual(initial.bars, sourceBars, 'plugins must not receive the mutable chart array');
assert.equal(Object.isFrozen(sourceBars), false, 'routing must not freeze the chart-owned array');

const repeated = router.event(sourceBars, 'realtime', 1, [
  { barTime: 200, closed: false, eventTimeMs: 1_000 },
]);
assert.equal(repeated.bars[0], initial.bars[0], 'unchanged frozen bars should be reused');
assert.equal(repeated.bars[1], initial.bars[1], 'unchanged realtime tails should be reused');
assert.ok(Object.isFrozen(repeated.realtimeUpdates));
assert.ok(repeated.realtimeUpdates.every(Object.isFrozen));

const harnessDefinition = defineIndicator({
  id: 'fixture.harness', apiVersion: 1, indicatorVersion: 1, name: 'Harness',
  supports: { seriesKinds: ['ohlcv'], marketKinds: ['stock'] },
  inputs: { period: { type: 'number', title: 'Period', default: 2 } },
  create(context, inputs) {
    const line = context.layers.createSeries({ key: 'line', type: 'line', pane: 'main' });
    const marker = context.mainSeries.createMarkerContribution({ key: 'events', priority: 1, chartKinds: ['candles'] });
    const overlay = context.layers.createOverlay({ key: 'table', paneKey: 'main', position: 'middle-right' });
    context.layers.createCanvasLayer({ key: 'canvas', target: { type: 'current-main-series' }, draw() {} });
    const style = context.mainSeries.createBarStyleContribution({ key: 'style', priority: 1, chartKinds: ['candles'] });
    style.setProvider(() => ({ color: '#123456' }));
    return { update(event) {
      line.setValues(event, event.bars.map((bar) => bar.close * inputs.period));
      marker.set([{ time: event.bars[0].time, position: 'atPriceTop', price: event.bars[0].high, shape: 'arrowDown', color: '#f00', tooltip: 'event' }]);
      overlay.root.innerHTML = 'ready';
    } };
  },
});
const harness = createIndicatorTestHarness(harnessDefinition);
harness.update(initial);
assert.deepEqual(harness.series('line').points.map((point) => point.value), [3, 5], 'test harness captures series output');
assert.equal(harness.markers('events')[0].tooltip, 'event', 'test harness captures rich marker output');
assert.equal(harness.overlay('table').root.innerHTML, 'ready', 'test harness captures overlay output');
assert.equal(harness.overlay('table').definition.position, 'middle-right', 'test harness preserves middle overlay positions');
assert.ok(harness.canvas('canvas'), 'test harness exposes canvas callbacks');
assert.deepEqual(harness.barStyle('style', initial.bars[0], 0), { color: '#123456' }, 'test harness evaluates bar styles');
harness.dispose();

sourceBars[1].close = 2.75;
const replaced = router.event(sourceBars, 'realtime', 1);
assert.equal(replaced.bars[0], repeated.bars[0]);
assert.notEqual(replaced.bars[1], repeated.bars[1]);
assert.equal(replaced.bars[1].close, 2.75);
assert.equal(sourceBars[1].close, 2.75, 'the mutable main path must remain writable');

let marketEpochResets = 0;
const marketRouter = new IndicatorMarketRouter((kind) => {
  if (kind === 'trades') marketEpochResets += 1;
});
const unknownProviderRouter = new IndicatorMarketRouter(() => {});
unknownProviderRouter.setSelection('binance_custom', 'BTCUSDT');
assert.equal(
  unknownProviderRouter.capabilities().trades.supported,
  false,
  'order-flow capability must come from an explicit provider contract, not a provider ID prefix',
);
marketRouter.setSelection('binance_spot', 'BTCUSDT');
const marketDefinition = defineIndicator({
  id: 'fixture.orderflow', apiVersion: 1, indicatorVersion: 1, name: 'Order flow',
  supports: { seriesKinds: ['ohlcv'], requires: { depth: true, trades: ['aggregate-trade'] } },
  inputs: {}, create() { return { update() {} }; },
});
const scopedMarket = marketRouter.forIndicator(marketDefinition);
const tradeBatches = [];
scopedMarket.onTrades((batch) => tradeBatches.push(batch));
marketRouter.pushTrade({
  providerId: 'binance_spot', symbol: 'BTCUSDT', eventKind: 'aggregate-trade', tradeId: 1,
  firstTradeId: 11, lastTradeId: 13,
  exchangeTimeMs: 1_000, receivedTimeMs: 1_010, barTime: 960, price: 10, quantity: 2,
  quantityKnown: true, aggressorSide: 'buy', flags: null,
});
await Promise.resolve();
assert.equal(tradeBatches.length, 1);
assert.equal(tradeBatches[0].events[0].barTime, 960, 'trade events keep the Rust-computed chart bar time');
assert.equal(tradeBatches[0].events[0].firstTradeId, 11);
assert.equal(tradeBatches[0].events[0].lastTradeId, 13);
assert.equal(tradeBatches[0].completeSinceSubscriptionStart, true);
const firstSubscriptionId = tradeBatches[0].subscriptionId;
for (let tradeId = 2; tradeId <= 2_002; tradeId += 1) {
  marketRouter.pushTrade({
    providerId: 'binance_spot', symbol: 'BTCUSDT', eventKind: 'aggregate-trade', tradeId,
    exchangeTimeMs: 1_000 + tradeId, receivedTimeMs: 1_010 + tradeId, barTime: 960,
    price: 10, quantity: 1, quantityKnown: true, aggressorSide: 'buy', flags: null,
  });
}
await Promise.resolve();
assert.equal(marketEpochResets, 1, 'overflow must synchronously request an execution restart');
assert.equal(tradeBatches.at(-1).resetReason, 'buffer-overflow');
assert.equal(tradeBatches.at(-1).events.length, 1, 'a new epoch starts at the first retained trade');
assert.equal(tradeBatches.at(-1).completeSinceSubscriptionStart, true);
assert.notEqual(tradeBatches.at(-1).subscriptionId, firstSubscriptionId, 'epoch reset starts a new logical subscription');
const overflowSubscriptionId = tradeBatches.at(-1).subscriptionId;
marketRouter.reportTradeGap({ restartAtKnown: false, dropped: 3 });
marketRouter.pushTrade({
  providerId: 'binance_spot', symbol: 'BTCUSDT', eventKind: 'aggregate-trade', tradeId: 2_003,
  exchangeTimeMs: 4_000, receivedTimeMs: 4_010, barTime: 3_960, price: 10, quantity: 1,
  quantityKnown: true, aggressorSide: 'buy', flags: null,
});
await Promise.resolve();
assert.equal(tradeBatches.at(-1).completeSinceSubscriptionStart, false, 'an unbounded Provider gap stays incomplete');
assert.equal(tradeBatches.at(-1).droppedSinceSubscriptionStart, 3);
assert.equal(tradeBatches.at(-1).subscriptionId, overflowSubscriptionId, 'an unknown boundary cannot pretend to open a clean subscription');
marketRouter.reportTradeGap({ restartAtKnown: true });
marketRouter.pushTrade({
  providerId: 'binance_spot', symbol: 'BTCUSDT', eventKind: 'aggregate-trade', tradeId: 2_004,
  exchangeTimeMs: 5_000, receivedTimeMs: 5_010, barTime: 4_980, price: 10, quantity: 1,
  quantityKnown: true, aggressorSide: 'buy', flags: null,
});
await Promise.resolve();
assert.equal(marketEpochResets, 2);
assert.equal(tradeBatches.at(-1).resetReason, 'sequence-gap');
assert.equal(tradeBatches.at(-1).completeSinceSubscriptionStart, true, 'a known new boundary opens a clean subscription');
assert.notEqual(tradeBatches.at(-1).subscriptionId, overflowSubscriptionId);
const undeclaredMarket = marketRouter.forIndicator(defineIndicator({
  id: 'fixture.no-orderflow', apiVersion: 1, indicatorVersion: 1, name: 'No order flow',
  supports: { seriesKinds: ['ohlcv'] }, inputs: {}, create() { return { update() {} }; },
}));
assert.throws(() => undeclaredMarket.onTrades(() => {}), /must declare supports\.requires\.trades/);

assert.throws(
  () => router.event([sourceBars[1], sourceBars[0]], 'history', 0),
  /strictly ascending/,
);

let nextTimer = 1;
const callbacks = new Map();
const cleared = [];
const timerHost = {
  setTimeout(callback) {
    const id = nextTimer++;
    callbacks.set(id, callback);
    return id;
  },
  clearTimeout(id) {
    cleared.push(id);
    callbacks.delete(id);
  },
  setInterval(callback) {
    const id = nextTimer++;
    callbacks.set(id, callback);
    return id;
  },
  clearInterval(id) {
    cleared.push(id);
    callbacks.delete(id);
  },
};
const cleanupOrder = [];
const cleanupErrors = [];
const scope = new IndicatorExecutionScope(timerHost, (error) => cleanupErrors.push(error));
scope.add(() => cleanupOrder.push('first'));
scope.add(() => {
  cleanupOrder.push('second');
  throw new Error('cleanup failed');
});
scope.api().setInterval(() => {}, 100);
scope.dispose();
scope.dispose();
assert.deepEqual(cleanupOrder, ['second', 'first'], 'execution resources must unwind once in reverse order');
assert.equal(cleared.length, 1, 'owned timers must be cancelled');
assert.equal(cleanupErrors.length, 1, 'one cleanup failure must not skip remaining cleanup');

let lateCleanup = 0;
scope.add(() => { lateCleanup += 1; });
assert.equal(lateCleanup, 1, 'resources added after disposal must be released immediately');

const callbackErrors = [];
const callbackScope = new IndicatorExecutionScope(timerHost, () => {}, (error) => callbackErrors.push(error));
callbackScope.api().setTimeout(() => { throw new Error('timer failed'); }, 1);
callbacks.get(nextTimer - 1)();
callbackScope.api().requestAnimationFrame(() => { throw new Error('frame failed'); });
callbacks.get(nextTimer - 1)();
assert.deepEqual(callbackErrors.map((error) => error.message), ['timer failed', 'frame failed']);
let staleCallbackRuns = 0;
callbackScope.api().setTimeout(() => { staleCallbackRuns += 1; }, 1);
const staleCallback = callbacks.get(nextTimer - 1);
callbackScope.dispose();
staleCallback();
assert.equal(staleCallbackRuns, 0, 'a callback already queued before disposal cannot run in a later execution generation');

const createPane = (index) => ({
  height: 300,
  primitives: [],
  getHeight() { return this.height; },
  setHeight(height) { this.height = height; },
  paneIndex() { return index; },
  getSeries() { return []; },
  attachPrimitive(primitive) { this.primitives.push(primitive); },
  detachPrimitive(primitive) { this.primitives = this.primitives.filter((item) => item !== primitive); },
});
const mainPane = createPane(0);
const panes = [mainPane];
const createdSeries = [];
const removedSeries = [];
const removedPanes = [];
const fakeChart = {
  timeScale() {
    return {
      timeToCoordinate: () => 10,
      logicalToCoordinate: () => 10,
      coordinateToLogical: () => 1,
      getVisibleLogicalRange: () => ({ from: 0, to: 1 }),
    };
  },
  addPane() {
    const pane = createPane(panes.length);
    panes.push(pane);
    return pane;
  },
  panes() { return panes; },
  removePane(index) {
    removedPanes.push(index);
    panes.splice(index, 1);
  },
  addSeries(_definition, options, paneIndex) {
    const series = {
      options,
      paneIndex,
      data: [],
      knownTimes: new Set(),
      updates: [],
      visible: true,
      primitives: [],
      setData(data) {
        this.data = data;
        this.knownTimes = new Set(data.map((point) => point.time));
      },
      update(point, historical = false) {
        if (historical && !this.knownTimes.has(point.time)) {
          throw new Error('Cannot update non-existing data point when historicalUpdate is true');
        }
        this.updates.push({ point, historical });
        this.knownTimes.add(point.time);
      },
      applyOptions(patch) { if ('visible' in patch) this.visible = patch.visible; },
      moveToPane(next) { this.paneIndex = next; },
      attachPrimitive(primitive) { this.primitives.push(primitive); },
      detachPrimitive(primitive) { this.primitives = this.primitives.filter((item) => item !== primitive); },
    };
    createdSeries.push(series);
    return series;
  },
  removeSeries(series) { removedSeries.push(series); },
};
const chartHost = new IndicatorChartHost(fakeChart, mainPane);
let binding = chartHost.beginBinding('instance-1');
const oscillatorPane = binding.panes.create({ key: 'oscillator', defaultHeight: 120 });
const line = binding.layers.createSeries({
  key: 'value',
  type: 'line',
  pane: oscillatorPane.key,
  options: { color: '#2962ff' },
});
const canvas = binding.layers.createCanvasLayer({
  key: 'labels',
  target: { type: 'series', series: line },
  draw() {},
});
line.setValues(initial, [null, 2.5]);
chartHost.finishBinding('instance-1');
assert.equal(panes[1].height, 120);
assert.deepEqual(createdSeries[0].data, [{ time: 100 }, { time: 200, value: 2.5 }]);
assert.deepEqual(
  chartHost.visualPaneTargets('instance-1'),
  [{ key: 'oscillator', paneIndex: 1 }],
  'chart host exposes the public Pane target needed to place an indicator legend',
);

panes[1].height = 175;
binding = chartHost.beginBinding('instance-1');
const reboundPane = binding.panes.create({ key: 'oscillator', defaultHeight: 90 });
const reboundLine = binding.layers.createSeries({ key: 'value', type: 'line', pane: reboundPane.key });
const reboundCanvas = binding.layers.createCanvasLayer({
  key: 'labels',
  target: { type: 'series', series: reboundLine },
  zOrder: 'top',
  draw() {},
});
chartHost.finishBinding('instance-1');
assert.equal(createdSeries.length, 1, 'same-key same-type series must survive execution rebuilds');
assert.equal(panes[1].height, 175, 'saved/user pane height must win over a plugin default on rebuild');
assert.notEqual(reboundCanvas, canvas, 'each execution receives a generation-scoped Canvas handle');
assert.equal(createdSeries[0].primitives.length, 1, 'same-key Canvas primitives must survive execution rebuilds');
assert.equal(createdSeries[0].primitives[0].paneViews()[0].zOrder(), 'top', 'Canvas z-order updates on rebind');
assert.throws(() => canvas.requestUpdate(), /stale execution generation/);
assert.throws(() => line.setData([]), /stale execution generation/);
reboundLine.setValues(initial, [null, 2.5]);
createdSeries[0].updates = [];
reboundLine.setValues(replaced, [null, 3], { dirtyFrom: 0 });
assert.deepEqual(
  createdSeries[0].updates,
  [
    { point: { time: 100 }, historical: true },
    { point: { time: 200, value: 3 }, historical: true },
  ],
  'dirtyFrom may update an earlier historical point, including whitespace cleanup',
);
const appended = router.event([
  ...sourceBars,
  { time: 300, open: 2.75, high: 4, low: 2.5, close: 3.5, volume: 30 },
], 'realtime', 2);
reboundLine.setValues(appended, [null, 3, 3.5]);
assert.deepEqual(createdSeries[0].updates.at(-1), {
  point: { time: 300, value: 3.5 },
  historical: false,
}, 'a newly appended realtime point must use normal update semantics');
const shifted = router.event(appended.bars.slice(1), 'realtime', 0);
reboundLine.setValues(shifted, [3, 3.5]);
assert.deepEqual(createdSeries[0].data.map((point) => point.time), [200, 300], 'window trimming falls back to setData');

reboundLine.setVisible(false);
const reboundPrimitive = createdSeries[0].primitives[0];
reboundCanvas.setVisible(false);
chartHost.setVisible('instance-1', false);
reboundLine.setVisible(true);
reboundCanvas.setVisible(true);
assert.equal(createdSeries[0].visible, false, 'a resource cannot bypass instance-level hiding');
assert.equal(reboundPrimitive.visible, false, 'Canvas visibility remains gated by its instance');
reboundLine.setVisible(false);
reboundCanvas.setVisible(false);
chartHost.setVisible('instance-1', true);
assert.equal(createdSeries[0].visible, false, 'showing an instance preserves Series desired visibility');
assert.equal(reboundPrimitive.visible, false, 'showing an instance preserves Canvas desired visibility');

binding = chartHost.beginBinding('instance-1');
const replacementPane = binding.panes.create({ key: 'oscillator', defaultHeight: 90 });
const replacementHistogram = binding.layers.createSeries({ key: 'value', type: 'histogram', pane: replacementPane.key });
chartHost.finishBinding('instance-1');
assert.equal(createdSeries.length, 2, 'changing a stable key series type replaces the chart object');
assert.equal(removedSeries.length, 1);
assert.throws(
  () => replacementHistogram.setData([{ time: 100, open: 1, high: 2, low: 0.5, close: 1.5 }]),
  /does not accept OHLC points/,
);

binding = chartHost.beginBinding('instance-1');
const barPane = binding.panes.create({ key: 'oscillator', defaultHeight: 90 });
const replacementBar = binding.layers.createSeries({ key: 'value', type: 'bar', pane: barPane.key });
replacementBar.setData([{ time: 100, open: 1, high: 2, low: 0.5, close: 1.5 }]);
chartHost.finishBinding('instance-1');
assert.deepEqual(createdSeries.at(-1).data, [{ time: 100, open: 1, high: 2, low: 0.5, close: 1.5 }]);
assert.throws(() => replacementBar.setValues(initial, [1, 2]), /does not support scalar setValues/);

chartHost.setVisible('instance-1', false);
assert.equal(createdSeries.at(-1).visible, false);
chartHost.remove('instance-1');
assert.equal(removedSeries.length, 3);
assert.deepEqual(removedPanes, [1]);
assert.throws(() => replacementBar.setData([]), /stale execution generation/, 'removed instance handles become stale');

const lifecycle = { creates: 0, updates: [], destroys: 0, visibility: [], instruments: [] };
const runtimeDefinition = defineIndicator({
  id: 'fixture.runtime',
  apiVersion: 1,
  indicatorVersion: 2,
  name: 'Runtime fixture',
  supports: { seriesKinds: ['ohlcv'], marketKinds: ['crypto', 'stock'] },
  inputs: {
    period: { type: 'number', title: 'Period', default: 20, min: 1, max: 500 },
  },
  create(context, inputs) {
    lifecycle.creates += 1;
    lifecycle.instruments.push(context.instrument);
    const pane = context.panes.create({ key: 'runtime-pane', defaultHeight: 100 });
    const output = context.layers.createSeries({ key: 'runtime-line', type: 'line', pane: pane.key });
    return {
      update(event) {
        lifecycle.updates.push({ symbol: context.selection.symbol.symbol, period: inputs.period, reason: event.reason });
        output.setValues(event, event.bars.map((bar) => bar.close));
      },
      onVisibilityChange(visible) { lifecycle.visibility.push(visible); },
      destroy() { lifecycle.destroys += 1; },
    };
  },
});
assert.deepEqual(normalizeIndicatorInputs(runtimeDefinition, { period: 999 }), { period: 20 });
assert.deepEqual(normalizeIndicatorInputs(runtimeDefinition, { period: 55 }), { period: 55 });

const runtimeFailures = [];
const noOpContribution = { setProvider() {}, invalidateFrom() {}, set() {} };
const runtime = new IndicatorRuntime(
  new IndicatorRegistry([runtimeDefinition]),
  {
    chartHost,
    mainSeries: {
      createBarStyleContribution: () => noOpContribution,
      createMarkerContribution: () => noOpContribution,
    },
    market: {
      capabilities: () => ({
        depth: { supported: false },
        trades: { supported: false, eventKinds: [] },
        historicalDepth: false,
        historicalTrades: false,
        orderByOrder: false,
      }),
      status: () => ({ state: 'available' }),
      getDepth: () => null,
      onDepth: () => ({ dispose() {} }),
      onTrades: () => ({ dispose() {} }),
      onStatus: () => ({ dispose() {} }),
    },
    events: {
      onCrosshairMove: () => ({ dispose() {} }),
      onClick: () => ({ dispose() {} }),
      onVisibleRangeChange: () => ({ dispose() {} }),
    },
    theme: () => 'dark',
    onError: (failure) => runtimeFailures.push(failure),
  },
);
runtime.add({ instanceId: 'runtime-1', indicatorId: 'fixture.runtime', inputs: { period: 5 } });
assert.equal(lifecycle.creates, 0, 'an instance waits for a concrete chart selection and initial data');
const selection = {
  symbol: { symbol: 'BINANCE:BTCUSDT' },
  resolution: '1',
  adjustment: 'none',
  seriesKind: 'ohlcv',
  marketKind: 'crypto',
  providerId: 'binance_spot',
};
runtime.setContext(selection, initial);
assert.equal(lifecycle.creates, 1);
assert.equal(runtime.isApplicable('fixture.runtime'), true, 'runtime exposes current applicability to host UI');
assert.equal(runtime.isApplicable('fixture.missing'), false, 'unknown indicators are not applicable');
assert.deepEqual(lifecycle.instruments[0], {
  priceTick: null,
  timeZone: 'UTC',
  tradingCalendar: '24/7',
}, 'runtime gives plugins normalized instrument metadata');
assert.deepEqual(lifecycle.updates, [{ symbol: 'BINANCE:BTCUSDT', period: 5, reason: 'initial' }]);
const healthyUpdateCount = lifecycle.updates.length;
runtime.retry('runtime-1');
assert.equal(lifecycle.creates, 1, 'retrying a healthy instance is a no-op');
assert.equal(lifecycle.updates.length, healthyUpdateCount, 'a healthy retry does not replay the current event');
assert.equal(runtime.list()[0].running, true);
assert.equal(runtime.list()[0].failed, false);
const chartObjectsAfterFirstCreate = createdSeries.length;
runtime.setContext(
  { ...selection, symbol: { symbol: 'BINANCE:ETHUSDT' } },
  initial,
);
assert.equal(lifecycle.creates, 2, 'selection changes rebuild the execution instance');
assert.equal(lifecycle.destroys, 1);
assert.equal(createdSeries.length, chartObjectsAfterFirstCreate, 'selection rebuild reuses stable visual slots');
runtime.setVisible('runtime-1', false);
assert.deepEqual(lifecycle.visibility.slice(-1), [false]);
runtime.updateInputs('runtime-1', { period: 10 });
assert.equal(lifecycle.creates, 3, 'input changes rebuild execution without duplicating the instance');
assert.equal(runtime.list()[0].inputs.period, 10);

runtime.setContext(
  { ...selection, symbol: { symbol: 'POLYMARKET:TEST' }, marketKind: 'prediction', providerId: 'polymarket' },
  initial,
);
assert.equal(runtime.list()[0].running, false, 'prediction markets remain outside indicator SDK v1');
assert.equal(runtime.isApplicable('fixture.runtime'), false, 'host UI sees the same incompatible state as execution');
runtime.remove('runtime-1');
assert.equal(runtime.list().length, 0);
assert.deepEqual(runtimeFailures, []);

let partialCreateShouldFail = true;
let partialResourceCleanups = 0;
const partialFailure = defineIndicator({
  id: 'fixture.partial-failure', apiVersion: 1, indicatorVersion: 1, name: 'Partial failure',
  supports: { seriesKinds: ['ohlcv'] }, inputs: {},
  create(context) {
    const pane = context.panes.create({ key: 'partial-pane', defaultHeight: 90 });
    context.layers.createSeries({ key: 'partial-series', type: 'line', pane: pane.key });
    context.resources.add(() => { partialResourceCleanups += 1; });
    if (partialCreateShouldFail) throw new Error('partial create failed');
    return { update() {} };
  },
});
const partialFailures = [];
const partialRuntime = new IndicatorRuntime(
  new IndicatorRegistry([partialFailure]),
  {
    chartHost,
    mainSeries: { createBarStyleContribution: () => noOpContribution, createMarkerContribution: () => noOpContribution },
    market: marketRouter,
    events: {
      onCrosshairMove: () => ({ dispose() {} }), onClick: () => ({ dispose() {} }),
      onVisibleRangeChange: () => ({ dispose() {} }),
    },
    theme: () => 'dark',
    onError: (failure) => partialFailures.push(failure),
  },
);
const panesBeforePartialFailure = panes.length;
const removedSeriesBeforePartialFailure = removedSeries.length;
partialRuntime.add({ instanceId: 'partial-1', indicatorId: 'fixture.partial-failure' });
partialRuntime.setContext(selection, initial);
assert.equal(partialRuntime.list()[0].failed, true);
assert.equal(panes.length, panesBeforePartialFailure, 'create failure must remove a partially-created Pane');
assert.equal(removedSeries.length, removedSeriesBeforePartialFailure + 1, 'create failure must remove partial Series');
assert.equal(partialFailures.at(-1).phase, 'create');
assert.equal(partialResourceCleanups, 1, 'create failure must release resources owned before create threw');
partialCreateShouldFail = false;
partialRuntime.retry('partial-1');
assert.equal(partialRuntime.list()[0].failed, false, 'retry must clear the failed state after create succeeds');
assert.equal(partialRuntime.list()[0].running, true, 'retry must restore a running execution after create succeeds');
assert.equal(partialResourceCleanups, 1, 'retry must not dispose the newly-created execution immediately');
partialRuntime.remove('partial-1');
assert.equal(partialResourceCleanups, 2, 'removing the retried instance releases its new resources');

let retryUpdateShouldFail = false;
const retryLifecycle = { creates: 0, updates: [], destroys: 0, cleanups: 0 };
const retryUpdateFailure = defineIndicator({
  id: 'fixture.retry-update-failure', apiVersion: 1, indicatorVersion: 1, name: 'Retry update failure',
  supports: { seriesKinds: ['ohlcv'] }, inputs: {},
  create(context) {
    retryLifecycle.creates += 1;
    context.resources.add(() => { retryLifecycle.cleanups += 1; });
    return {
      update(event) {
        retryLifecycle.updates.push({ symbol: context.selection.symbol.symbol, reason: event.reason });
        if (retryUpdateShouldFail) throw new Error('retry update failed');
      },
      destroy() { retryLifecycle.destroys += 1; },
    };
  },
});
const retryUpdateFailures = [];
const retryUpdateRuntime = new IndicatorRuntime(
  new IndicatorRegistry([retryUpdateFailure]),
  {
    chartHost,
    mainSeries: { createBarStyleContribution: () => noOpContribution, createMarkerContribution: () => noOpContribution },
    market: marketRouter,
    events: {
      onCrosshairMove: () => ({ dispose() {} }), onClick: () => ({ dispose() {} }),
      onVisibleRangeChange: () => ({ dispose() {} }),
    },
    theme: () => 'dark',
    onError: (failure) => retryUpdateFailures.push(failure),
  },
);
retryUpdateRuntime.add({ instanceId: 'retry-update-1', indicatorId: 'fixture.retry-update-failure' });
retryUpdateRuntime.setContext(selection, initial);
assert.equal(retryLifecycle.creates, 1);
retryUpdateShouldFail = true;
retryUpdateRuntime.update(replaced);
assert.equal(retryUpdateRuntime.list()[0].failed, true, 'an update failure must mark the instance failed');
assert.equal(retryUpdateRuntime.list()[0].running, false, 'an update failure must stop the old execution');
assert.equal(retryLifecycle.destroys, 1, 'an update failure must destroy the old execution');
assert.equal(retryLifecycle.cleanups, 1, 'an update failure must release the old execution resources');
assert.equal(retryUpdateFailures.at(-1).phase, 'update');
retryUpdateShouldFail = false;
retryUpdateRuntime.retry('retry-update-1');
assert.equal(retryLifecycle.creates, 2, 'retry must create a fresh execution after an update failure');
assert.deepEqual(retryLifecycle.updates.at(-1), { symbol: 'BINANCE:BTCUSDT', reason: 'initial' });
assert.equal(retryUpdateRuntime.list()[0].failed, false, 'a successful update retry clears failed');
assert.equal(retryUpdateRuntime.list()[0].running, true, 'a successful update retry resumes execution');
assert.equal(retryLifecycle.destroys, 1, 'retry must not destroy the new execution');
assert.equal(retryLifecycle.cleanups, 1, 'retry must not release the new execution resources');
retryUpdateRuntime.remove('retry-update-1');
assert.equal(retryLifecycle.destroys, 2);
assert.equal(retryLifecycle.cleanups, 2);

let failRebuild = false;
const rollbackDefinition = defineIndicator({
  id: 'fixture.rollback', apiVersion: 1, indicatorVersion: 1, name: 'Rollback fixture',
  supports: { seriesKinds: ['ohlcv'] }, inputs: {},
  create(context) {
    const pane = context.panes.create({ key: 'stable-pane', defaultHeight: 95 });
    context.layers.createSeries({ key: 'stable-series', type: 'line', pane: pane.key });
    if (failRebuild) throw new Error('rebuild failed');
    return { update() {} };
  },
});
const rollbackRuntime = new IndicatorRuntime(
  new IndicatorRegistry([rollbackDefinition]),
  {
    chartHost,
    mainSeries: { createBarStyleContribution: () => noOpContribution, createMarkerContribution: () => noOpContribution },
    market: marketRouter,
    events: {
      onCrosshairMove: () => ({ dispose() {} }), onClick: () => ({ dispose() {} }),
      onVisibleRangeChange: () => ({ dispose() {} }),
    },
    theme: () => 'dark',
  },
);
rollbackRuntime.add({ instanceId: 'rollback-1', indicatorId: 'fixture.rollback' });
rollbackRuntime.setContext(selection, initial);
const stablePane = chartHost.pane('rollback-1', 'stable-pane');
stablePane.setHeight(177);
const removedSeriesBeforeRollback = removedSeries.length;
failRebuild = true;
rollbackRuntime.setContext({ ...selection, symbol: { symbol: 'BINANCE:SOLUSDT' } }, initial);
assert.equal(rollbackRuntime.list()[0].failed, true);
assert.equal(chartHost.pane('rollback-1', 'stable-pane'), stablePane, 'failed rebuild preserves the stable Pane object');
assert.equal(stablePane.getHeight(), 177, 'failed rebuild preserves the user Pane height');
assert.equal(removedSeries.length, removedSeriesBeforeRollback, 'failed rebuild keeps the prior stable Series slot');

const invalidatedBars = [];
let markerInvalidations = 0;
const mainSeriesHost = new IndicatorMainSeriesHost(
  () => 'candles',
  (changedFrom) => invalidatedBars.push(changedFrom),
  () => { markerInvalidations += 1; },
);
let mainApi = mainSeriesHost.beginBinding('style-a');
const lowPriority = mainApi.createBarStyleContribution({ key: 'bars', priority: 10, chartKinds: ['candles'] });
lowPriority.setProvider(() => ({ color: '#111111', wickColor: '#222222' }));
lowPriority.invalidateFrom(1);
const firstMarkers = mainApi.createMarkerContribution({ key: 'markers', priority: 10, chartKinds: ['candles'] });
firstMarkers.set([{ time: 200, position: 'aboveBar', shape: 'arrowUp', color: '#111111' }]);
mainSeriesHost.finishBinding('style-a');
mainApi = mainSeriesHost.beginBinding('style-b');
const highPriority = mainApi.createBarStyleContribution({ key: 'bars', priority: 20, chartKinds: ['candles'] });
highPriority.setProvider(() => ({ color: '#333333' }));
const secondMarkers = mainApi.createMarkerContribution({ key: 'markers', priority: 20, chartKinds: ['candles'] });
secondMarkers.set([{ time: 100, position: 'belowBar', shape: 'arrowDown', color: '#333333' }]);
mainSeriesHost.finishBinding('style-b');
assert.deepEqual(
  mainSeriesHost.styleFor(initial.bars[0], 0),
  { color: '#333333', wickColor: '#222222' },
  'higher-priority style fields override only the fields they contribute',
);
assert.deepEqual(mainSeriesHost.markerValues().map((marker) => marker.time), [100, 200]);
mainSeriesHost.setVisible('style-b', false);
assert.equal(mainSeriesHost.styleFor(initial.bars[0], 0).color, '#111111');
mainSeriesHost.clear('style-a');
assert.deepEqual(mainSeriesHost.markerValues(), []);
assert.ok(invalidatedBars.includes(1));
assert.ok(markerInvalidations > 0);

const throwingStyleDefinition = defineIndicator({
  id: 'fixture.throwing-style', apiVersion: 1, indicatorVersion: 1, name: 'Throwing style',
  supports: { seriesKinds: ['ohlcv'] }, inputs: {},
  create(context) {
    const contribution = context.mainSeries.createBarStyleContribution({
      key: 'throwing', priority: 30, chartKinds: ['candles'],
    });
    contribution.setProvider(() => { throw new Error('style render failed'); });
    return { update() {} };
  },
});
mainApi = mainSeriesHost.beginBinding('style-safe');
const safeStyle = mainApi.createBarStyleContribution({ key: 'safe', priority: 5, chartKinds: ['candles'] });
safeStyle.setProvider(() => ({ wickColor: '#abcdef' }));
mainSeriesHost.finishBinding('style-safe');
const styleRuntimeFailures = [];
const styleRuntime = new IndicatorRuntime(
  new IndicatorRegistry([throwingStyleDefinition]),
  {
    chartHost,
    mainSeries: (instanceId) => mainSeriesHost.beginBinding(instanceId),
    mainSeriesLifecycle: mainSeriesHost,
    market: marketRouter,
    events: {
      onCrosshairMove: () => ({ dispose() {} }), onClick: () => ({ dispose() {} }),
      onVisibleRangeChange: () => ({ dispose() {} }),
    },
    theme: () => 'dark',
    onError: (failure) => styleRuntimeFailures.push(failure),
  },
);
styleRuntime.add({ instanceId: 'throwing-style-1', indicatorId: 'fixture.throwing-style' });
styleRuntime.setContext(selection, initial);
assert.deepEqual(
  mainSeriesHost.styleFor(initial.bars[0], 0),
  { wickColor: '#abcdef' },
  'a failed style provider does not suppress other indicators or escape into main rendering',
);
assert.equal(styleRuntime.list()[0].failed, true, 'a deferred style callback failure stops only its indicator');
assert.equal(styleRuntimeFailures.at(-1).phase, 'render');

const throwingCanvasDefinition = defineIndicator({
  id: 'fixture.throwing-canvas', apiVersion: 1, indicatorVersion: 1, name: 'Throwing canvas',
  supports: { seriesKinds: ['ohlcv'] }, inputs: {},
  create(context) {
    context.layers.createCanvasLayer({
      key: 'throwing-canvas', target: { type: 'pane', pane: context.panes.main },
      draw() { throw new Error('canvas render failed'); },
    });
    return { update() {} };
  },
});
const canvasRuntimeFailures = [];
const canvasRuntime = new IndicatorRuntime(
  new IndicatorRegistry([throwingCanvasDefinition]),
  {
    chartHost,
    mainSeries: { createBarStyleContribution: () => noOpContribution, createMarkerContribution: () => noOpContribution },
    market: marketRouter,
    events: {
      onCrosshairMove: () => ({ dispose() {} }), onClick: () => ({ dispose() {} }),
      onVisibleRangeChange: () => ({ dispose() {} }),
    },
    theme: () => 'dark',
    onError: (failure) => canvasRuntimeFailures.push(failure),
  },
);
canvasRuntime.add({ instanceId: 'throwing-canvas-1', indicatorId: 'fixture.throwing-canvas' });
canvasRuntime.setContext(selection, initial);
const throwingPrimitive = mainPane.primitives.at(-1);
assert.doesNotThrow(() => throwingPrimitive.draw({
  useBitmapCoordinateSpace(callback) { callback({ horizontalPixelRatio: 2 }); },
  useMediaCoordinateSpace(callback) {
    callback({ context: {}, mediaSize: { width: 100, height: 50 } });
  },
}));
assert.equal(canvasRuntime.list()[0].failed, true, 'a deferred Canvas draw failure stops only its indicator');
assert.equal(canvasRuntimeFailures.at(-1).phase, 'render');

const orderedMainPane = {
  height: 300,
  getHeight() { return this.height; },
  setHeight(height) { this.height = height; },
  paneIndex() { return orderedPanes.indexOf(this); },
  getSeries() { return []; },
};
const orderedPanes = [orderedMainPane];
const orderedChart = {
  panes: () => orderedPanes,
  addPane() {
    const pane = {
      height: 100,
      getHeight() { return this.height; },
      setHeight(height) { this.height = height; },
      paneIndex() { return orderedPanes.indexOf(this); },
      getSeries() { return []; },
    };
    orderedPanes.push(pane);
    return pane;
  },
  swapPanes(left, right) {
    [orderedPanes[left], orderedPanes[right]] = [orderedPanes[right], orderedPanes[left]];
  },
};
const orderedChartHost = new IndicatorChartHost(orderedChart, orderedMainPane);
let orderBinding = orderedChartHost.beginBinding('first');
orderBinding.panes.create({ key: 'first-pane', defaultHeight: 100 });
orderedChartHost.finishBinding('first');
orderBinding = orderedChartHost.beginBinding('second');
orderBinding.panes.create({ key: 'second-pane', defaultHeight: 100 });
orderedChartHost.finishBinding('second');
const firstPane = orderedChartHost.pane('first', 'first-pane');
const secondPane = orderedChartHost.pane('second', 'second-pane');
orderedChartHost.applyInstancePaneOrder(['second', 'first']);
assert.deepEqual(
  orderedPanes.slice(1),
  [secondPane, firstPane],
  'instance order must also control the order of SDK-created secondary panes',
);

console.log('Indicator runtime foundations OK');
