import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { validateUserIndicatorSource } from '../src/user-indicator-runtime/validator-engine.ts';
import { UserIndicatorExecutionEngine } from '../src/user-indicator-runtime/execution-engine.ts';

const source = readFileSync(new URL('../fixtures/user-indicators/06-crypto-orderflow-cvd.tfi', import.meta.url), 'utf8');
const validation = await validateUserIndicatorSource(source);
assert.equal(validation.ok, true, validation.ok ? undefined : validation.error.message);
assert.equal(validation.manifest.id, 'user.crypto-orderflow-cvd');
assert.equal(validation.manifest.indicatorVersion, 2);
assert.deepEqual(validation.manifest.supports.marketKinds, ['crypto']);
assert.deepEqual(validation.manifest.supports.requires, { depth: true, trades: ['trade', 'aggregate-trade'] });

const bars = Object.freeze([
  Object.freeze({ time: 100000, open: 100, high: 110, low: 90, close: 105, volume: 200 }),
  Object.freeze({ time: 100060, open: 105, high: 110, low: 100, close: 100, volume: 100 }),
  Object.freeze({ time: 190000, open: 100, high: 120, low: 100, close: 120, volume: 50 }),
]);
const initialEvent = Object.freeze({
  reason: 'initial',
  changedFrom: 0,
  barsPatch: Object.freeze({ mode: 'replace-all', bars }),
});
const createRequest = Object.freeze({
  protocolVersion: 1,
  type: 'create',
  instanceId: 'cvd-user-runtime',
  generation: 1,
  requestId: 1,
  source,
  inputs: Object.freeze({
    resetMode: 'day', signalLength: 2, showSignal: true,
    buyColor: '#26A69A', sellColor: '#EF5350', signalColor: '#FFB74D',
    depthLevels: 2, panelPosition: 'middle-right',
  }),
  context: Object.freeze({
    instanceId: 'cvd-user-runtime',
    selection: Object.freeze({
      symbol: 'BINANCE:BTCUSDT', resolution: '1', adjustment: 'none',
      seriesKind: 'ohlcv', marketKind: 'crypto', providerId: 'binance_spot',
    }),
    instrument: Object.freeze({ priceTick: null, timeZone: 'UTC', tradingCalendar: '24/7' }),
    theme: 'dark',
    data: Object.freeze({}),
  }),
  initialEvent,
});

const engine = await UserIndicatorExecutionEngine.create();
const created = engine.createInstance(createRequest);
assert.equal(created.type, 'success', created.message);
const createCommands = created.output.callbacks[0].commands;
assert.equal(createCommands.filter(command => command.type === 'create-series').length, 3);
assert.ok(createCommands.some(command => command.type === 'create-panel' && command.key === 'live-orderflow'));
const initialCommands = created.output.callbacks[1].commands;
const delta = initialCommands.find(command => command.type === 'series-set-data' && command.key === 'delta');
const cvd = initialCommands.find(command => command.type === 'series-set-data' && command.key === 'cvd');
const signal = initialCommands.find(command => command.type === 'series-set-data' && command.key === 'signal');
assert.deepEqual(delta.points.map(point => point.value), [50, -50, 50]);
assert.deepEqual(cvd.points.map(point => point.value), [50, 0, 50], 'CVD resets on a new UTC day');
assert.deepEqual(signal.points.map(point => point.value), [50, 25, 50], 'signal smoothing resets with CVD');

const realtime = Object.freeze({
  reason: 'realtime',
  changedFrom: bars.length,
  barsPatch: Object.freeze({ mode: 'replace-from', baseLength: bars.length, from: bars.length, bars: Object.freeze([]) }),
  marketStatus: Object.freeze({ state: 'available' }),
  depth: Object.freeze({
    providerId: 'binance_spot', symbol: 'BINANCE:BTCUSDT',
    receivedTimeMs: 1000, capturedAtMs: 1000, coverage: 'current-snapshot',
    bids: Object.freeze([Object.freeze({ price: 100, quantity: 2 }), Object.freeze({ price: 99, quantity: 1 })]),
    asks: Object.freeze([Object.freeze({ price: 101, quantity: 1 }), Object.freeze({ price: 102, quantity: 0 })]),
  }),
  trades: Object.freeze({
    events: Object.freeze([
      Object.freeze({ providerId: 'binance_spot', symbol: 'BINANCE:BTCUSDT', eventKind: 'aggregate-trade', receivedTimeMs: 1010, barTime: 190000, price: 101, quantity: 2, quantityKnown: true, aggressorSide: 'buy' }),
      Object.freeze({ providerId: 'binance_spot', symbol: 'BINANCE:BTCUSDT', eventKind: 'aggregate-trade', receivedTimeMs: 1011, barTime: 190000, price: 100, quantity: 0.5, quantityKnown: true, aggressorSide: 'sell' }),
      Object.freeze({ providerId: 'binance_spot', symbol: 'BINANCE:BTCUSDT', eventKind: 'aggregate-trade', receivedTimeMs: 1012, barTime: 190000, price: 100, quantityKnown: false, aggressorSide: null }),
    ]),
    capturedAtMs: 1012,
    coverage: 'since-last-callback',
    streamEpoch: 'binance_spot:BTCUSDT:1',
    subscriptionStartedAtMs: 900,
    completeSinceSubscriptionStart: true,
    droppedSinceSubscriptionStart: 0,
    droppedByCallbackBudget: 0,
    truncated: false,
    resetReason: 'initial',
  }),
});
const live = engine.updateInstance(Object.freeze({
  protocolVersion: 1, type: 'update', instanceId: 'cvd-user-runtime', generation: 1, requestId: 2, event: realtime,
}));
assert.equal(live.type, 'success', live.message);
assert.equal(live.timing.reason, 'realtime');
assert.equal(live.timing.budgetMs, 100);
assert.equal(live.output.callbacks[0].commands.some(command => command.type === 'series-set-data'), false,
  'order-flow-only callback must not recompute the historical CVD');
const panel = live.output.callbacks[0].commands.find(command => command.type === 'panel-set' && command.key === 'live-orderflow');
assert.ok(panel);
const panelText = panel.content.rows.map(row => row.cells.map(cell => cell.text).join(' | ')).join('\n');
assert.match(panelText, /available/);
assert.match(panelText, /2\.000 \/ 0\.500/);
assert.match(panelText, /1\.500/);
assert.match(panelText, /50\.0%/);
assert.match(panelText, /3 笔 · 1 未分类/);
assert.match(panelText, /连续/);

const degraded = engine.updateInstance(Object.freeze({
  protocolVersion: 1, type: 'update', instanceId: 'cvd-user-runtime', generation: 1, requestId: 3,
  event: Object.freeze({
    reason: 'realtime', changedFrom: bars.length,
    barsPatch: Object.freeze({ mode: 'replace-from', baseLength: bars.length, from: bars.length, bars: Object.freeze([]) }),
    marketStatus: Object.freeze({ state: 'degraded', reason: 'trade-sequence-gap' }),
    trades: Object.freeze({
      events: Object.freeze([]), capturedAtMs: 1020, coverage: 'since-last-callback',
      streamEpoch: 'binance_spot:BTCUSDT:1', subscriptionStartedAtMs: 900,
      completeSinceSubscriptionStart: false, droppedSinceSubscriptionStart: 4,
      droppedByCallbackBudget: 0, truncated: false, resetReason: 'sequence-gap',
    }),
  }),
}));
assert.equal(degraded.type, 'success', degraded.message);
const degradedPanel = degraded.output.callbacks[0].commands.find(command => command.type === 'panel-set');
const degradedText = degradedPanel.content.rows.map(row => row.cells.map(cell => cell.text).join(' | ')).join('\n');
assert.match(degradedText, /degraded/);
assert.match(degradedText, /不完整 · 丢失 4/);
engine.dispose();

const pluginIndex = readFileSync(new URL('../src/indicator-plugins/index.ts', import.meta.url), 'utf8');
assert.doesNotMatch(pluginIndex, /crypto-orderflow-cvd\.indicator\.ts/);
assert.equal(existsSync(new URL('../src/indicator-plugins/user/crypto-orderflow-cvd.indicator.ts', import.meta.url)), false,
  'trusted CVD source must be removed after migration to .tfi');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
assert.doesNotMatch(main, /06-crypto-orderflow-cvd\.tfi\?raw/,
  'the CVD fixture must not be bundled into the production application');
assert.doesNotMatch(main, /BUNDLED_CVD_BOOTSTRAP_KEY|bundled_cvd_bootstrap/,
  'production startup must not auto-install the CVD test indicator');

console.log('Crypto order-flow CVD user-runtime checks passed');
