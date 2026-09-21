import assert from 'node:assert/strict';
import { alignUserIndicatorDataBars, UserIndicatorDataUnavailableError, UserIndicatorRuntimeManager } from '../src/user-indicator-runtime/runtime-manager.ts';

function bar(time, close = time) {
  return Object.freeze({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 });
}

function event(reason = 'initial', close = 2) {
  return Object.freeze({
    reason,
    bars: Object.freeze([bar(1), bar(2, close)]),
    changedFrom: reason === 'initial' ? 0 : 1,
  });
}

const alignMain = alignUserIndicatorDataBars(
  Object.freeze([bar(1, 10), bar(3, 30)]),
  Object.freeze([bar(1), bar(2), bar(3), bar(4)]),
  'main',
);
assert.deepEqual(alignMain.map(item => item?.close ?? null), [10, null, 30, null]);
const alignFfill = alignUserIndicatorDataBars(
  Object.freeze([bar(1, 10), bar(3, 30)]),
  Object.freeze([bar(1), bar(2), bar(3), bar(4)]),
  'main-ffill',
);
assert.deepEqual(alignFfill.map(item => item?.close ?? null), [10, 10, 30, 30]);

function libraryRecord(overrides = {}) {
  return Object.freeze({
    id: 'user.manager-test',
    source: 'defineIndicator({});',
    sourceHash: 'a'.repeat(64),
    manifest: Object.freeze({
      formatVersion: 1,
      apiVersion: 1,
      id: 'user.manager-test',
      indicatorVersion: 3,
      name: 'Manager Test',
      inputs: Object.freeze({
        period: Object.freeze({ type: 'number', title: '周期', default: 20, min: 1, max: 100, step: 1 }),
        enabled: Object.freeze({ type: 'boolean', title: '启用', default: true }),
        mode: Object.freeze({
          type: 'select',
          title: '模式',
          default: 'a',
          options: Object.freeze([
            Object.freeze({ value: 'a', label: 'A' }),
            Object.freeze({ value: 'b', label: 'B' }),
          ]),
        }),
      }),
      supports: Object.freeze({ seriesKinds: Object.freeze(['ohlcv']), marketKinds: Object.freeze(['stock']) }),
    }),
    apiVersion: 1,
    indicatorVersion: 3,
    importedAt: 1,
    updatedAt: 1,
    validatorVersion: 1,
    ...overrides,
  });
}

function context(marketKind = 'stock', symbol = 'SH:600000') {
  return Object.freeze({
    instrument: Object.freeze({ priceTick: 0.01, timeZone: 'Asia/Shanghai', tradingCalendar: 'XSHG' }),
    selection: Object.freeze({
      symbol,
      resolution: '1',
      adjustment: 'none',
      seriesKind: 'ohlcv',
      marketKind,
      providerId: marketKind === 'crypto' ? 'binance_spot' : 'tdx',
    }),
    theme: 'dark',
  });
}

class FakeController {
  constructor() {
    this.calls = [];
    this.executions = new Map();
    this.lastUpdateEvent = null;
  }
  create(instanceId, source, inputs, runtimeContext, runtimeEvent) {
    this.calls.push(['create', instanceId, source, { ...inputs }, runtimeContext, runtimeEvent.reason]);
    this.executions.set(instanceId, { instanceId, running: true, failed: false, inFlight: false, pending: false, generation: 1 });
  }
  rebuild(instanceId, source, inputs, runtimeContext, runtimeEvent) {
    this.calls.push(['rebuild', instanceId, source, { ...inputs }, runtimeContext, runtimeEvent.reason]);
    const previous = this.executions.get(instanceId);
    this.executions.set(instanceId, {
      instanceId,
      running: true,
      failed: false,
      inFlight: false,
      pending: false,
      generation: (previous?.generation ?? 0) + 1,
    });
  }
  update(instanceId, runtimeEvent) {
    this.lastUpdateEvent = runtimeEvent;
    this.calls.push(['update', instanceId, runtimeEvent.reason, runtimeEvent.bars.at(-1)?.close]);
  }
  setVisible(instanceId, visible) { this.calls.push(['visible', instanceId, visible]); }
  remove(instanceId) { this.calls.push(['remove', instanceId]); this.executions.delete(instanceId); }
  destroy() { this.calls.push(['destroy']); this.executions.clear(); }
  list() { return [...this.executions.values()]; }
}

const controller = new FakeController();
const manager = new UserIndicatorRuntimeManager(controller);
const library = libraryRecord();

manager.add({
  instanceId: 'u1',
  indicatorId: library.id,
  sourceHash: library.sourceHash,
  indicatorVersion: library.indicatorVersion,
  inputs: { period: 999, enabled: false, mode: 'missing', ignored: 'drop-me' },
  visible: false,
}, library);
assert.equal(controller.calls.length, 0, 'adding before market context must not start a Worker');
assert.deepEqual({ ...manager.get('u1').inputs }, { period: 20, enabled: false, mode: 'a' });
assert.equal(manager.get('u1').visible, false);

manager.setContext(context('stock'), event('initial'));
assert.equal(controller.calls[0][0], 'create');
assert.equal(controller.calls[0][1], 'u1');
assert.equal(controller.calls[0][4].instanceId, 'u1');
assert.equal(controller.calls[0][4].selection.symbol, 'SH:600000');
assert.deepEqual(controller.calls[1], ['visible', 'u1', false]);
assert.equal(manager.get('u1').applicable, true);
assert.equal(manager.get('u1').running, true);

manager.update(event('realtime', 20));
assert.deepEqual(controller.calls.at(-1), ['update', 'u1', 'realtime', 20]);

manager.updateInputs('u1', { period: 55, enabled: true, mode: 'b' });
assert.equal(controller.calls.at(-2)[0], 'rebuild');
assert.deepEqual(controller.calls.at(-2)[3], { period: 55, enabled: true, mode: 'b' });
assert.deepEqual(controller.calls.at(-1), ['visible', 'u1', false]);

manager.setVisible('u1', true);
assert.deepEqual(controller.calls.at(-1), ['visible', 'u1', true]);
assert.equal(manager.get('u1').visible, true);

manager.setContext(context('crypto', 'BINANCE:BTCUSDT'), event('initial'));
assert.deepEqual(controller.calls.at(-1), ['remove', 'u1']);
assert.equal(manager.get('u1').applicable, false);
assert.equal(manager.get('u1').running, false);

manager.setContext(context('stock', 'SH:600519'), event('initial'));
assert.equal(controller.calls.at(-2)[0], 'create', 'returning to a supported market creates a fresh execution');
assert.equal(controller.calls.at(-2)[4].selection.symbol, 'SH:600519');
assert.deepEqual(controller.calls.at(-1), ['visible', 'u1', true]);

manager.setContext(context('stock', 'SZ:000001'), event('initial'));
assert.equal(controller.calls.at(-2)[0], 'rebuild', 'supported context changes rebuild the current generation');
assert.equal(controller.calls.at(-2)[4].selection.symbol, 'SZ:000001');

assert.equal(manager.isLibraryRecordApplicable(library), true);
assert.equal(manager.isLibraryRecordApplicable(libraryRecord({
  id: 'user.crypto-only',
  sourceHash: 'b'.repeat(64),
  indicatorVersion: 1,
  manifest: Object.freeze({
    ...library.manifest,
    id: 'user.crypto-only',
    indicatorVersion: 1,
    supports: Object.freeze({ seriesKinds: Object.freeze(['ohlcv']), marketKinds: Object.freeze(['crypto']) }),
  }),
})), false);

assert.throws(() => manager.add({
  instanceId: 'bad',
  indicatorId: library.id,
  sourceHash: 'c'.repeat(64),
  indicatorVersion: library.indicatorVersion,
}, library), /does not match/);
assert.throws(() => manager.add({
  instanceId: 'u1',
  indicatorId: library.id,
  sourceHash: library.sourceHash,
  indicatorVersion: library.indicatorVersion,
}, library), /already exists/);

manager.remove('u1');
assert.deepEqual(controller.calls.at(-1), ['remove', 'u1']);
assert.equal(manager.get('u1'), null);
manager.destroy();
assert.deepEqual(controller.calls.at(-1), ['destroy']);

const mtfController = new FakeController();
let mtfNow = 0, historyCalls = 0;
const mtfLibrary = libraryRecord({
  id: 'user.manager-mtf',
  sourceHash: 'd'.repeat(64),
  indicatorVersion: 1,
  manifest: Object.freeze({
    ...library.manifest,
    id: 'user.manager-mtf',
    indicatorVersion: 1,
    data: Object.freeze({ monthly: Object.freeze({ resolution: '1M', count: 64, adjustment: 'current' }) }),
  }),
});
const mtfManager = new UserIndicatorRuntimeManager(mtfController, {
  now: () => mtfNow,
  async history(ctx, request) {
    historyCalls += 1;
    assert.equal(ctx.selection.symbol, 'SH:600000');
    assert.equal(request.resolution, '1M');
    assert.equal(request.count, 64);
    assert.equal(request.adjustment, 'none');
    return Object.freeze([bar(10, 100), bar(20, 110)]);
  },
});
mtfManager.add({ instanceId: 'mtf', indicatorId: mtfLibrary.id, sourceHash: mtfLibrary.sourceHash, indicatorVersion: 1 }, mtfLibrary);
mtfManager.setContext(context('stock'), event('initial'));
assert.equal(mtfController.calls.length, 0, 'MTF user indicator waits for host data before starting its Worker');
for (let i = 0; i < 10 && mtfController.calls.length === 0; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(historyCalls, 1);
assert.equal(mtfController.calls[0][0], 'create');
assert.equal(mtfController.calls[0][4].data.monthly.resolution, '1M');
assert.deepEqual(mtfController.calls[0][4].data.monthly.bars.map(item => item.close), [100, 110]);
mtfNow = 16_000;
mtfManager.update(event('realtime', 22));
for (let i = 0; i < 10 && historyCalls < 2; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
for (let i = 0; i < 10 && !mtfController.calls.some(call => call[0] === 'rebuild'); i += 1) await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(historyCalls, 2, 'MTF user data refreshes on a bounded cadence');
assert.ok(mtfController.calls.some(call => call[0] === 'rebuild'));
mtfManager.destroy();

const crossController = new FakeController();
let crossHistoryCalls = 0;
const crossLibrary = libraryRecord({
  id: 'user.manager-cross',
  sourceHash: 'e'.repeat(64),
  indicatorVersion: 1,
  manifest: Object.freeze({
    ...library.manifest,
    id: 'user.manager-cross',
    indicatorVersion: 1,
    data: Object.freeze({ benchmark: Object.freeze({
      symbol: 'SH:000001', kind: 'index', resolution: '1D', count: 3, align: 'main',
    }) }),
  }),
});
const crossManager = new UserIndicatorRuntimeManager(crossController, {
  async history(ctx, request) {
    crossHistoryCalls += 1;
    assert.equal(ctx.selection.symbol, 'SH:600000');
    assert.equal(request.symbol, 'SH:000001');
    assert.equal(request.kind, 'index');
    assert.equal(request.align, 'main');
    return Object.freeze({
      bars: Object.freeze([bar(1, 10)]), symbol: 'SH:000001', kind: 'index',
      coverage: 'provider-returned-window', finality: 'unknown', priceUnit: 'provider-native', volumeUnit: 'unknown',
    });
  },
});
crossManager.add({ instanceId: 'cross', indicatorId: crossLibrary.id, sourceHash: crossLibrary.sourceHash, indicatorVersion: 1 }, crossLibrary);
crossManager.setContext(context('stock'), event('initial'));
for (let i = 0; i < 10 && crossController.calls.length === 0; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(crossHistoryCalls, 1);
const crossCreate = crossController.calls.find(call => call[0] === 'create');
assert.equal(crossCreate[4].data.benchmark.symbol, 'SH:000001');
assert.equal(crossCreate[4].data.benchmark.kind, 'index');
assert.equal(crossCreate[4].data.benchmark.aligned, 'main');
assert.equal(crossCreate[4].data.benchmark.bars.length, 2);
assert.equal(crossCreate[4].data.benchmark.bars[0].close, 10);
assert.equal(crossCreate[4].data.benchmark.bars[1], null, 'suspended/missing timestamp stays null under align=main');
assert.equal(crossCreate[4].data.benchmark.shortfall, true);
assert.deepEqual(crossCreate[4].dataStatus.benchmark, { state: 'ready' });

const threeBars = Object.freeze({ reason: 'realtime', bars: Object.freeze([bar(1), bar(2), bar(3)]), changedFrom: 2 });
crossManager.update(threeBars);
const alignedRebuild = crossController.calls.filter(call => call[0] === 'rebuild').at(-1);
assert.ok(alignedRebuild, 'main timeline growth must rebuild the frozen aligned data context');
assert.equal(alignedRebuild[4].data.benchmark.bars.length, 3);
assert.deepEqual(alignedRebuild[4].data.benchmark.bars.map(item => item?.close ?? null), [10, null, null]);
crossManager.destroy();

const missingController = new FakeController();
const missingLibrary = libraryRecord({
  id: 'user.manager-cross-missing', sourceHash: 'f'.repeat(64), indicatorVersion: 1,
  manifest: Object.freeze({ ...library.manifest, id: 'user.manager-cross-missing', indicatorVersion: 1,
    data: Object.freeze({ missing: Object.freeze({ symbol: 'SH:999999', resolution: '1D', count: 3, align: 'main' }) }) }),
});
const missingManager = new UserIndicatorRuntimeManager(missingController, {
  async history() { throw new UserIndicatorDataUnavailableError('symbol_unavailable'); },
});
missingManager.add({ instanceId: 'missing', indicatorId: missingLibrary.id, sourceHash: missingLibrary.sourceHash, indicatorVersion: 1 }, missingLibrary);
missingManager.setContext(context('stock'), event('initial'));
for (let i = 0; i < 10 && missingController.calls.length === 0; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
const missingCreate = missingController.calls.find(call => call[0] === 'create');
assert.ok(missingCreate, 'cross-symbol fetch failure must not fail the whole indicator');
assert.equal(missingCreate[4].data.missing, undefined, 'missing snapshot is exposed as context.data.get(key) === null');
assert.deepEqual(missingCreate[4].dataStatus.missing, { state: 'unavailable', reason: 'symbol_unavailable' });
assert.equal(missingManager.get('missing').failed, false);
missingManager.destroy();

const flowController = new FakeController();
const flowLibrary = libraryRecord({
  id: 'user.manager-flow', sourceHash: '1'.repeat(64), indicatorVersion: 1,
  manifest: Object.freeze({ ...library.manifest, id: 'user.manager-flow', indicatorVersion: 1,
    supports: Object.freeze({ seriesKinds: Object.freeze(['ohlcv']), marketKinds: Object.freeze(['crypto']),
      requires: Object.freeze({ depth: true, trades: Object.freeze(['aggregate-trade']) }) }) }),
});
const plainCrypto = libraryRecord({
  id: 'user.manager-plain-crypto', sourceHash: '2'.repeat(64), indicatorVersion: 1,
  manifest: Object.freeze({ ...library.manifest, id: 'user.manager-plain-crypto', indicatorVersion: 1,
    supports: Object.freeze({ seriesKinds: Object.freeze(['ohlcv']), marketKinds: Object.freeze(['crypto']) }) }),
});
const flowManager = new UserIndicatorRuntimeManager(flowController);
flowManager.add({ instanceId: 'flow', indicatorId: flowLibrary.id, sourceHash: flowLibrary.sourceHash, indicatorVersion: 1 }, flowLibrary);
flowManager.add({ instanceId: 'plain', indicatorId: plainCrypto.id, sourceHash: plainCrypto.sourceHash, indicatorVersion: 1 }, plainCrypto);
flowManager.setContext(context('crypto', 'BINANCE:BTCUSDT'), event('initial'));
const beforeDepthUpdates = flowController.calls.filter(call => call[0] === 'update').length;
flowManager.pushDepth(Object.freeze({
  providerId: 'binance_spot', symbol: 'BINANCE:BTCUSDT', receivedTimeMs: 1,
  bids: Object.freeze(Array.from({ length: 60 }, (_, index) => Object.freeze({ price: 100 - index, quantity: 1 }))),
  asks: Object.freeze(Array.from({ length: 60 }, (_, index) => Object.freeze({ price: 101 + index, quantity: 1 }))),
}));
assert.equal(flowController.calls.filter(call => call[0] === 'update').length, beforeDepthUpdates + 1,
  'only the indicator declaring requires.depth receives a depth callback');
assert.equal(flowController.calls.at(-1)[1], 'flow');
assert.equal(flowController.lastUpdateEvent.depth.bids.length, 50);
assert.equal(flowController.lastUpdateEvent.depth.coverage, 'current-snapshot');

flowManager.pushTrades(Object.freeze({
  events: Object.freeze(Array.from({ length: 300 }, (_, index) => Object.freeze({
    providerId: 'binance_spot', symbol: 'BINANCE:BTCUSDT', eventKind: 'aggregate-trade', receivedTimeMs: index,
    barTime: 2, price: 100 + index, quantity: 1, quantityKnown: true, aggressorSide: 'buy',
  }))),
  streamEpoch: 'epoch-1', subscriptionId: 'sub-1', subscriptionStartedAtMs: 1,
  completeSinceSubscriptionStart: true, droppedSinceSubscriptionStart: 0,
}));
assert.equal(flowController.calls.at(-1)[1], 'flow');
assert.equal(flowController.lastUpdateEvent.trades.events.length, 256);
assert.equal(flowController.lastUpdateEvent.trades.truncated, true);
assert.equal(flowController.lastUpdateEvent.trades.droppedByCallbackBudget, 44);
assert.equal(flowController.lastUpdateEvent.trades.completeSinceSubscriptionStart, false);
flowManager.destroy();

console.log('user indicator runtime manager: ok');
