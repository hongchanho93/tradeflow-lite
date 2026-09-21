import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import { UserIndicatorExecutionEngine } from '../src/user-indicator-runtime/execution-engine.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function bar(time, close = time) {
  return Object.freeze({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 + time });
}

function replaceAll(reason, bars, changedFrom = 0, realtimeUpdates) {
  return Object.freeze({
    reason,
    changedFrom,
    barsPatch: Object.freeze({ mode: 'replace-all', bars: Object.freeze(bars) }),
    ...(realtimeUpdates ? { realtimeUpdates: Object.freeze(realtimeUpdates) } : {}),
  });
}

function replaceFrom(reason, baseLength, from, bars, changedFrom = from, realtimeUpdates) {
  return Object.freeze({
    reason,
    changedFrom,
    barsPatch: Object.freeze({ mode: 'replace-from', baseLength, from, bars: Object.freeze(bars) }),
    ...(realtimeUpdates ? { realtimeUpdates: Object.freeze(realtimeUpdates) } : {}),
  });
}

function createRequest(source, initialEvent, overrides = {}) {
  return Object.freeze({
    protocolVersion: 1,
    type: 'create',
    instanceId: 'instance-1',
    generation: 1,
    requestId: 1,
    source,
    inputs: Object.freeze({ period: 2 }),
    context: Object.freeze({ symbol: 'A', nested: Object.freeze({ resolution: '1m' }) }),
    initialEvent,
    ...overrides,
  });
}

function updateRequest(event, requestId = 2) {
  return Object.freeze({
    protocolVersion: 1,
    type: 'update',
    instanceId: 'instance-1',
    generation: 1,
    requestId,
    event,
  });
}

const validSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.execution-test',
  indicatorVersion: 1,
  name: 'Execution Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context, inputs) {
    if (!Object.isFrozen(context) || !Object.isFrozen(context.nested)) throw new Error('context-not-frozen');
    if (!Object.isFrozen(inputs)) throw new Error('inputs-not-frozen');
    if (context.symbol !== 'A' || inputs.period !== 2) throw new Error('create-payload-mismatch');
    let calls = 0;
    return {
      update(event) {
        calls += 1;
        if (!Object.isFrozen(event) || !Object.isFrozen(event.bars)) throw new Error('event-not-frozen');
        for (let index = 0; index < event.bars.length; index += 1) {
          if (!Object.isFrozen(event.bars[index])) throw new Error('bar-not-frozen');
        }
        if (calls === 1) {
          if (event.reason !== 'initial' || event.bars.length !== 3 || event.bars[2].close !== 3) throw new Error('initial-mirror-mismatch');
        } else if (calls === 2) {
          if (event.reason !== 'history' || event.bars.length !== 3 || event.bars[2].close !== 3) {
            throw new Error('history-shape-mismatch');
          }
        } else if (calls === 3) {
          if (event.reason !== 'realtime' || event.bars.length !== 4) throw new Error('realtime-shape-mismatch');
          if (event.bars[0].close !== 1 || event.bars[1].close !== 2 || event.bars[2].close !== 30 || event.bars[3].close !== 40) {
            throw new Error('realtime-mirror-mismatch');
          }
          if (!event.realtimeUpdates || event.realtimeUpdates.length !== 2 || !Object.isFrozen(event.realtimeUpdates)) {
            throw new Error('realtime-updates-mismatch');
          }
        } else if (calls === 4) {
          if (event.reason !== 'reconciliation' || event.bars.length !== 2 || event.bars[1].close !== 22) {
            throw new Error('replace-all-mismatch');
          }
        }
      },
    };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const created = engine.createInstance(createRequest(validSource, replaceAll('initial', [bar(1), bar(2), bar(3)])));
  assert.equal(created.type, 'success');
  assert.equal(created.phase, 'create');
  assert.equal(created.timing.reason, 'initial');
  assert.equal(created.timing.budgetMs, 2000);

  const history = engine.updateInstance(updateRequest(replaceAll('history', [bar(1), bar(2), bar(3)])));
  assert.equal(history.type, 'success');
  assert.equal(history.timing.reason, 'history');
  assert.equal(history.timing.budgetMs, 1000);

  const updated = engine.updateInstance(updateRequest(replaceFrom(
    'realtime',
    3,
    2,
    [bar(3, 30), bar(4, 40)],
    2,
    [{ barTime: 3, closed: true, closedBy: 'newer-bar' }, { barTime: 4, closed: false }],
  ), 3));
  assert.equal(updated.type, 'success');
  assert.equal(updated.timing.reason, 'realtime');
  assert.equal(updated.timing.budgetMs, 100);

  const replaced = engine.updateInstance(updateRequest(replaceAll('reconciliation', [bar(1), bar(2, 22)]), 4));
  assert.equal(replaced.type, 'success');
  assert.equal(replaced.timing.reason, 'reconciliation');
  assert.equal(replaced.timing.budgetMs, 2000);
  engine.dispose();
}

const mtfDataSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.mtf-data-test',
  indicatorVersion: 1,
  name: 'MTF Data Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  data: { monthly: { resolution: '1M', count: 64 } },
  create(context) {
    const monthly = context.data.get('monthly');
    if (!monthly || monthly.resolution !== '1M' || monthly.bars.length !== 2) throw new Error('mtf-data-missing');
    if (context.data.status('monthly')?.state !== 'ready') throw new Error('mtf-status-not-ready');
    if (context.data.get('missing') !== null) throw new Error('mtf-missing-not-null');
    if (context.data.status('missing') !== null) throw new Error('mtf-undeclared-status-not-null');
    if (!Object.isFrozen(monthly) || !Object.isFrozen(monthly.bars) || !Object.isFrozen(monthly.bars[0])) throw new Error('mtf-data-not-frozen');
    return { update() {} };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const context = Object.freeze({
    symbol: 'A', nested: Object.freeze({ resolution: '1m' }),
    data: Object.freeze({ monthly: Object.freeze({
      key: 'monthly', resolution: '1M', adjustment: 'none', capturedAtMs: 1,
      bars: Object.freeze([bar(10, 100), bar(20, 110)]),
    }) }),
    dataStatus: Object.freeze({ monthly: Object.freeze({ state: 'ready' }) }),
  });
  const created = engine.createInstance(createRequest(
    mtfDataSource,
    replaceAll('initial', [bar(1), bar(2)]),
    { context },
  ));
  assert.equal(created.type, 'success', created.message);
  engine.dispose();
}

const crossSymbolDataSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.cross-symbol-data-test',
  indicatorVersion: 1,
  name: 'Cross Symbol Data Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  data: { benchmark: { symbol: 'SH:000001', kind: 'index', resolution: '1D', count: 3, align: 'main' } },
  create(context) {
    const benchmark = context.data.get('benchmark');
    if (!benchmark || benchmark.symbol !== 'SH:000001' || benchmark.kind !== 'index') throw new Error('cross-symbol-identity');
    if (benchmark.aligned !== 'main' || benchmark.coverage !== 'provider-returned-window') throw new Error('cross-symbol-metadata');
    if (benchmark.priceUnit !== 'provider-native' || benchmark.volumeUnit !== 'unknown') throw new Error('cross-symbol-units');
    if (benchmark.bars.length !== 2 || benchmark.bars[0].close !== 10 || benchmark.bars[1] !== null) throw new Error('cross-symbol-alignment');
    if (!Object.isFrozen(benchmark) || !Object.isFrozen(benchmark.bars) || !Object.isFrozen(benchmark.bars[0])) throw new Error('cross-symbol-not-frozen');
    if (context.data.status('benchmark')?.state !== 'ready') throw new Error('cross-symbol-status-not-ready');
    return { update() {} };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const context = Object.freeze({
    data: Object.freeze({ benchmark: Object.freeze({
      key: 'benchmark', symbol: 'SH:000001', kind: 'index', resolution: '1D', adjustment: 'none', aligned: 'main',
      requestedCount: 3, rowCount: 1, shortfall: true, coverage: 'provider-returned-window', finality: 'unknown',
      priceUnit: 'provider-native', volumeUnit: 'unknown', capturedAtMs: 1,
      bars: Object.freeze([bar(1, 10), null]),
    }) }),
    dataStatus: Object.freeze({ benchmark: Object.freeze({ state: 'ready' }) }),
  });
  const created = engine.createInstance(createRequest(
    crossSymbolDataSource,
    replaceAll('initial', [bar(1), bar(2)]),
    { context },
  ));
  assert.equal(created.type, 'success', created.message);
  engine.dispose();
}

const unavailableCrossSymbolSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.cross-symbol-unavailable-test',
  indicatorVersion: 1,
  name: 'Cross Symbol Unavailable Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  data: { benchmark: { symbol: 'OKX:BTCUSDT', kind: 'crypto', resolution: '1D', count: 3 } },
  create(context) {
    if (context.data.get('benchmark') !== null) throw new Error('unavailable-data-must-stay-null');
    const status = context.data.status('benchmark');
    if (!status || status.state !== 'unavailable' || status.reason !== 'provider_mismatch') throw new Error('unavailable-status-missing');
    if (!Object.isFrozen(status)) throw new Error('unavailable-status-not-frozen');
    return { update() {} };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const context = Object.freeze({
    data: Object.freeze({}),
    dataStatus: Object.freeze({
      benchmark: Object.freeze({ state: 'unavailable', reason: 'provider_mismatch' }),
    }),
  });
  const created = engine.createInstance(createRequest(
    unavailableCrossSymbolSource,
    replaceAll('initial', [bar(1), bar(2)]),
    { context },
  ));
  assert.equal(created.type, 'success', created.message);
  engine.dispose();
}

const realtimeMarketSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.realtime-market-test',
  indicatorVersion: 1,
  name: 'Realtime Market Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'], marketKinds: ['crypto'], requires: { depth: true, trades: ['aggregate-trade'] } },
  create(context) {
    return {
      update(event) {
        if (event.reason !== 'realtime') return;
        if (!event.depth || event.depth.coverage !== 'current-snapshot' || event.depth.bids.length !== 2) throw new Error('depth-missing');
        if (!Object.isFrozen(event.depth) || !Object.isFrozen(event.depth.bids) || !Object.isFrozen(event.depth.bids[0])) throw new Error('depth-not-frozen');
        if (!event.trades || event.trades.coverage !== 'since-last-callback' || event.trades.events.length !== 1) throw new Error('trades-missing');
        if (event.trades.events[0].eventKind !== 'aggregate-trade' || event.trades.events[0].aggressorSide !== 'buy') throw new Error('trade-content');
        if (!Object.isFrozen(event.trades) || !Object.isFrozen(event.trades.events) || !Object.isFrozen(event.trades.events[0])) throw new Error('trades-not-frozen');
      },
    };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  assert.equal(engine.createInstance(createRequest(realtimeMarketSource, replaceAll('initial', [bar(1)]))).type, 'success');
  const realtimeEvent = Object.freeze({
    ...replaceAll('realtime', [bar(1, 10)]),
    depth: Object.freeze({
      providerId: 'binance_spot', symbol: 'BINANCE:BTCUSDT', receivedTimeMs: 1, capturedAtMs: 1,
      coverage: 'current-snapshot',
      bids: Object.freeze([Object.freeze({price:10,quantity:2}),Object.freeze({price:9,quantity:3})]),
      asks: Object.freeze([Object.freeze({price:11,quantity:2})]),
    }),
    trades: Object.freeze({
      events: Object.freeze([Object.freeze({ providerId:'binance_spot', symbol:'BINANCE:BTCUSDT', eventKind:'aggregate-trade',
        receivedTimeMs:1, barTime:1, price:10, quantity:2, quantityKnown:true, aggressorSide:'buy' })]),
      capturedAtMs:1, coverage:'since-last-callback', streamEpoch:'epoch-1', subscriptionStartedAtMs:1,
      completeSinceSubscriptionStart:true, droppedSinceSubscriptionStart:0, droppedByCallbackBudget:0, truncated:false,
    }),
  });
  const updated = engine.updateInstance(updateRequest(realtimeEvent));
  assert.equal(updated.type, 'success', updated.message);
  engine.dispose();
}

const mtfLongSeriesAndLogSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.mtf-long-series-log-test',
  indicatorVersion: 1,
  name: 'MTF Long Series And Log Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  data: { monthly: { resolution: '1M', count: 64 } },
  create(context) {
    context.log('create ok');
    const line = context.layers.createSeries({ key: 'monthly', type: 'line', pane: 'main' });
    return {
      update(event) {
        const monthly = context.data.get('monthly');
        context.log('reason=' + event.reason + ', monthly=' + monthly.bars.length);
        line.setData(monthly.bars.map((item) => ({ time: item.time, value: item.close })));
      },
    };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const monthlyBars = Object.freeze([10,20,30,40,50].map(time => bar(time, time + 100)));
  const context = Object.freeze({
    symbol: 'A',
    data: Object.freeze({ monthly: Object.freeze({
      key: 'monthly', resolution: '1M', adjustment: 'none', capturedAtMs: 1, bars: monthlyBars,
    }) }),
  });
  const created = engine.createInstance(createRequest(
    mtfLongSeriesAndLogSource,
    replaceAll('initial', [bar(1), bar(2)]),
    { context },
  ));
  assert.equal(created.type, 'success', created.message);
  assert.deepEqual(created.output.callbacks[0].commands.map(command => command.type), ['debug-log','create-series']);
  assert.equal(created.output.callbacks[0].commands[0].message, 'create ok');
  assert.deepEqual(created.output.callbacks[1].commands.map(command => command.type), ['debug-log','series-set-data']);
  assert.equal(created.output.callbacks[1].commands[1].points.length, 5,
    'MTF setData may exceed current chart bars when still inside the independent point budget');
  engine.dispose();
}

const initialUpdateFailureSource = String.raw`
defineIndicator({
  formatVersion: 1, apiVersion: 1, id: 'user.initial-update-phase', indicatorVersion: 1,
  name: 'Initial Update Phase', inputs: {}, supports: { seriesKinds: ['ohlcv'] },
  create() { return { update() { throw new Error('initial-update-failed'); } }; },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const failed = engine.createInstance(createRequest(initialUpdateFailureSource, replaceAll('initial', [bar(1)])));
  assert.equal(failed.type, 'failure');
  assert.equal(failed.phase, 'update');
  assert.match(failed.message, /initial-update-failed/);
  engine.dispose();
}

const seriesSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.series-test',
  indicatorVersion: 1,
  name: 'Series Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const pane = context.panes.create({ key: 'osc', defaultHeight: 120 });
    if (context.panes.main.key !== 'main' || context.panes.get('osc') !== pane) throw new Error('pane-api-mismatch');
    const line = context.layers.createSeries({
      key: 'signal',
      type: 'line',
      pane: pane.key,
      options: { color: '#2962ff', lineWidth: 2, priceLineVisible: false, lastValueVisible: false },
    });
    line.setVisible(true);
    return {
      update(event) {
        const values = [];
        for (let index = 0; index < event.bars.length; index += 1) values[index] = event.bars[index].close;
        line.setValues(values, { dirtyFrom: event.changedFrom });
      },
    };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const created = engine.createInstance(createRequest(seriesSource, replaceAll('initial', [bar(1), bar(2), bar(3)])));
  assert.equal(created.type, 'success', created.message);
  assert.deepEqual(created.output.callbacks[0].commands.map((command) => command.type), [
    'create-pane',
    'create-series',
    'series-set-visible',
  ]);
  assert.deepEqual(created.output.callbacks[1], {
    phase: 'update',
    reason: 'initial',
    changedFrom: 0,
    barsLength: 3,
    commands: [{ type: 'series-set-values', key: 'signal', values: [1, 2, 3], dirtyFrom: 0 }],
  });

  const updated = engine.updateInstance(updateRequest(replaceFrom('realtime', 3, 2, [bar(3, 30), bar(4, 40)], 2)));
  assert.equal(updated.type, 'success', updated.message);
  assert.deepEqual(updated.output.callbacks[0], {
    phase: 'update',
    reason: 'realtime',
    changedFrom: 2,
    barsLength: 4,
    commands: [{ type: 'series-set-values', key: 'signal', values: [1, 2, 30, 40], dirtyFrom: 2 }],
  });
  engine.dispose();
}

const badColorSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.bad-color-test',
  indicatorVersion: 1,
  name: 'Bad Color Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    context.layers.createSeries({ key: 'bad', type: 'line', pane: 'main', options: { color: 'red' } });
    return { update() {} };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const failed = engine.createInstance(createRequest(badColorSource, replaceAll('initial', [bar(1)])));
  assert.equal(failed.type, 'failure');
  assert.equal(failed.code, 'invalid_output');
}

const tooManySeriesSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.series-limit-test',
  indicatorVersion: 1,
  name: 'Series Limit Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    for (let index = 0; index < 33; index += 1) {
      context.layers.createSeries({ key: 'series-' + index, type: 'line', pane: 'main' });
    }
    return { update() {} };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const failed = engine.createInstance(createRequest(tooManySeriesSource, replaceAll('initial', [bar(1)])));
  assert.equal(failed.type, 'failure');
  assert.equal(failed.code, 'output_limit_exceeded');
}

const lateSeriesSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.late-series-test',
  indicatorVersion: 1,
  name: 'Late Series Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    return {
      update(event) {
        if (event.reason === 'realtime') context.layers.createSeries({ key: 'late', type: 'line', pane: 'main' });
      },
    };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  assert.equal(engine.createInstance(createRequest(lateSeriesSource, replaceAll('initial', [bar(1)]))).type, 'success');
  const failed = engine.updateInstance(updateRequest(replaceAll('realtime', [bar(1, 10)])));
  assert.equal(failed.type, 'failure');
  assert.equal(failed.code, 'invalid_output');
}

const nanOutputSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.nan-output-test',
  indicatorVersion: 1,
  name: 'NaN Output Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const line = context.layers.createSeries({ key: 'line', type: 'line', pane: 'main' });
    return {
      update(event) {
        const values = [];
        for (let index = 0; index < event.bars.length; index += 1) values[index] = event.bars[index].close;
        if (event.reason === 'realtime') values[values.length - 1] = NaN;
        line.setValues(values);
      },
    };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  assert.equal(engine.createInstance(createRequest(nanOutputSource, replaceAll('initial', [bar(1)]))).type, 'success');
  const failed = engine.updateInstance(updateRequest(replaceAll('realtime', [bar(1, 10)])));
  assert.equal(failed.type, 'failure');
  assert.equal(failed.code, 'invalid_output');
}

const pointerSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.pointer-test',
  indicatorVersion: 1,
  name: 'Pointer Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const markers = context.mainSeries.createMarkerContribution({ key: 'signals', priority: 1 });
    const panel = context.layers.createPanel({ key: 'state', paneKey: 'main', position: 'top-right' });
    let clicks = 0;
    return {
      update(event) {
        markers.set([{ time: event.bars[event.bars.length - 1].time, position: 'aboveBar', shape: 'circle', color: '#fff', id: 'signal-1', hitTest: true }]);
      },
      onPointer(event) {
        if (event.type === 'click') clicks += 1;
        panel.set({
          columns: [{ key: 'v', title: 'V' }],
          rows: [{ cells: [{ text: event.type + ':' + event.id + ':' + clicks }] }],
        });
      },
    };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const created = engine.createInstance(createRequest(pointerSource, replaceAll('initial', [bar(1), bar(2)])));
  assert.equal(created.type, 'success', created.message);
  const clicked = engine.pointerInstance(Object.freeze({
    protocolVersion: 1, type: 'pointer', instanceId: 'instance-1', generation: 1, requestId: 2,
    event: Object.freeze({ type: 'click', id: 'signal-1', time: 2, price: 10, pane: 'main' }),
  }));
  assert.equal(clicked.type, 'success', clicked.message);
  assert.equal(clicked.phase, 'pointer');
  assert.equal(clicked.timing.reason, 'pointer');
  assert.equal(clicked.timing.budgetMs, 100);
  const clickedPanel = clicked.output.callbacks[0].commands.find(command => command.type === 'panel-set');
  assert.equal(clickedPanel.content.rows[0].cells[0].text, 'click:signal-1:1');
  const hovered = engine.pointerInstance(Object.freeze({
    protocolVersion: 1, type: 'pointer', instanceId: 'instance-1', generation: 1, requestId: 3,
    event: Object.freeze({ type: 'hover', id: 'signal-1', time: 2, price: 11, pane: 'main' }),
  }));
  assert.equal(hovered.type, 'success', hovered.message);
  const hoveredPanel = hovered.output.callbacks[0].commands.find(command => command.type === 'panel-set');
  assert.equal(hoveredPanel.content.rows[0].cells[0].text, 'hover:signal-1:1', 'pointer callbacks keep closure state');
  engine.dispose();
}

const markerSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.marker-test',
  indicatorVersion: 1,
  name: 'Marker Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const markers = context.mainSeries.createMarkerContribution({ key: 'signals', priority: 100 });
    return {
      update(event) {
        markers.set([{
          time: event.bars[event.bars.length - 1].time,
          position: event.reason === 'realtime' ? 'atPriceTop' : 'aboveBar',
          ...(event.reason === 'realtime' ? { price: event.bars[event.bars.length - 1].high } : {}),
          shape: event.reason === 'realtime' ? 'arrowUp' : 'circle',
          color: '#f23645',
          text: '信号',
          tooltip: '中文提示',
          size: 1,
        }]);
      },
    };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const created = engine.createInstance(createRequest(markerSource, replaceAll('initial', [bar(1), bar(2)])));
  assert.equal(created.type, 'success', created.message);
  assert.deepEqual(created.output.callbacks[0].commands, [
    { type: 'create-marker-contribution', key: 'signals', priority: 100 },
  ]);
  assert.deepEqual(created.output.callbacks[1].commands, [{
    type: 'marker-set',
    key: 'signals',
    markers: [{
      time: 2,
      position: 'aboveBar',
      shape: 'circle',
      color: '#f23645',
      text: '信号',
      tooltip: '中文提示',
      size: 1,
    }],
  }]);

  const updated = engine.updateInstance(updateRequest(replaceAll('realtime', [bar(1), bar(2, 20)])));
  assert.equal(updated.type, 'success', updated.message);
  assert.deepEqual(updated.output.callbacks[0].commands[0], {
    type: 'marker-set',
    key: 'signals',
    markers: [{
      time: 2,
      position: 'atPriceTop',
      price: 21,
      shape: 'arrowUp',
      color: '#f23645',
      text: '信号',
      tooltip: '中文提示',
      size: 1,
    }],
  });
  engine.dispose();
}

const markerLimitSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.marker-limit-test',
  indicatorVersion: 1,
  name: 'Marker Limit Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const markers = context.mainSeries.createMarkerContribution({ key: 'signals', priority: 0 });
    return {
      update() {
        const values = [];
        for (let index = 0; index < 2001; index += 1) {
          values[index] = { time: index + 1, position: 'aboveBar', shape: 'circle', color: '#fff' };
        }
        markers.set(values);
      },
    };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const failed = engine.createInstance(createRequest(markerLimitSource, replaceAll('initial', [bar(1)])));
  assert.equal(failed.type, 'failure');
  assert.equal(failed.code, 'output_limit_exceeded');
}

const markerTextBudgetSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.marker-text-budget-test',
  indicatorVersion: 1,
  name: 'Marker Text Budget Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const markers = context.mainSeries.createMarkerContribution({ key: 'signals', priority: 0 });
    return {
      update() {
        const values = [];
        for (let index = 0; index < 43; index += 1) {
          values[index] = {
            time: index + 1,
            position: 'belowBar',
            shape: 'square',
            color: '#fff',
            tooltip: '界'.repeat(512),
          };
        }
        markers.set(values);
      },
    };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const failed = engine.createInstance(createRequest(markerTextBudgetSource, replaceAll('initial', [bar(1)])));
  assert.equal(failed.type, 'failure');
  assert.equal(failed.code, 'output_limit_exceeded');
}

const barStyleSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.bar-style-test',
  indicatorVersion: 1,
  name: 'Bar Style Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const styles = context.mainSeries.createBarStyleContribution({
      key: 'bar-colors',
      priority: 50,
      chartKinds: ['candles', 'bars'],
    });
    return {
      update(event) {
        const values = [];
        for (let index = 0; index < event.bars.length; index += 1) {
          const bar = event.bars[index];
          values[index] = {
            time: bar.time,
            color: bar.close >= bar.open ? '#00ff00' : '#ff0000',
            borderColor: '#111111',
            wickColor: '#222222',
          };
        }
        styles.set(values);
      },
    };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const created = engine.createInstance(createRequest(barStyleSource, replaceAll('initial', [bar(1), bar(2)])));
  assert.equal(created.type, 'success', created.message);
  assert.deepEqual(created.output.callbacks[0].commands, [{
    type: 'create-bar-style-contribution',
    key: 'bar-colors',
    priority: 50,
    chartKinds: ['candles', 'bars'],
  }]);
  assert.deepEqual(created.output.callbacks[1].commands[0], {
    type: 'bar-style-set',
    key: 'bar-colors',
    styles: [
      { time: 1, color: '#00ff00', borderColor: '#111111', wickColor: '#222222' },
      { time: 2, color: '#00ff00', borderColor: '#111111', wickColor: '#222222' },
    ],
  });
  const updated = engine.updateInstance(updateRequest(replaceAll('realtime', [
    bar(1),
    Object.freeze({ time: 2, open: 3, high: 4, low: 1, close: 2, volume: 102 }),
  ])));
  assert.equal(updated.type, 'success', updated.message);
  assert.equal(updated.output.callbacks[0].commands[0].styles[1].color, '#ff0000');
  engine.dispose();
}

const badBarStyleKindsSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.bad-bar-style-kinds',
  indicatorVersion: 1,
  name: 'Bad Bar Style Kinds',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    context.mainSeries.createBarStyleContribution({
      key: 'bad', priority: 0, chartKinds: ['candles', 'candles'],
    });
    return { update() {} };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const failed = engine.createInstance(createRequest(badBarStyleKindsSource, replaceAll('initial', [bar(1)])));
  assert.equal(failed.type, 'failure');
  assert.equal(failed.code, 'invalid_output');
}

const tooManyBarStylesSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.too-many-bar-styles',
  indicatorVersion: 1,
  name: 'Too Many Bar Styles',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const styles = context.mainSeries.createBarStyleContribution({ key: 'styles', priority: 0, chartKinds: ['candles'] });
    return { update() { styles.set([{ time: 1, color: '#fff' }, { time: 2, color: '#fff' }]); } };
  },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const failed = engine.createInstance(createRequest(tooManyBarStylesSource, replaceAll('initial', [bar(1)])));
  assert.equal(failed.type, 'failure');
  assert.equal(failed.code, 'output_limit_exceeded');
}

const hardenedSource = String.raw`
let bridgeDenied = false;
try { __tradeflowRuntimeBridge('not-the-secret', 'status', 'null'); } catch (_error) { bridgeDenied = true; }
if (!bridgeDenied) throw new Error('bridge-secret-bypass');
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.hardened-test',
  indicatorVersion: 1,
  name: 'Hardened Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create() {
    return { update(event) { if (event.bars[event.bars.length - 1].close !== 5) throw new Error('captured-builtins-broken'); } };
  },
});
JSON.parse = () => { throw new Error('poisoned-json-parse'); };
JSON.stringify = () => { throw new Error('poisoned-json-stringify'); };
Object.freeze = () => { throw new Error('poisoned-freeze'); };
Object.keys = () => { throw new Error('poisoned-keys'); };
Reflect.apply = () => { throw new Error('poisoned-apply'); };
Array.isArray = () => false;
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  const created = engine.createInstance(createRequest(
    hardenedSource,
    replaceAll('initial', [bar(5, 5)]),
    { inputs: Object.freeze({ period: 2 }), context: Object.freeze({ symbol: 'A' }) },
  ));
  assert.equal(created.type, 'success', created.message);
  engine.dispose();
}

{
  const duplicateSource = `${validSource}\n${validSource.replace("id: 'user.execution-test'", "id: 'user.execution-test-2'")}`;
  const engine = await UserIndicatorExecutionEngine.create();
  const response = engine.createInstance(createRequest(duplicateSource, replaceAll('initial', [bar(1)])));
  assert.equal(response.type, 'failure');
  assert.equal(response.code, 'definition_duplicate');
}

const throwingSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.throwing-test',
  indicatorVersion: 1,
  name: 'Throwing Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create() { return { update(event) { if (event.reason === 'realtime') throw new Error('expected-update-failure'); } }; },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  assert.equal(engine.createInstance(createRequest(throwingSource, replaceAll('initial', [bar(1)]))).type, 'success');
  const failed = engine.updateInstance(updateRequest(replaceFrom('realtime', 1, 0, [bar(1, 10)], 0)));
  assert.equal(failed.type, 'failure');
  assert.equal(failed.code, 'runtime_exception');
  assert.match(failed.message, /expected-update-failure/);
  assert.equal(engine.isPoisoned(), true);
  assert.equal(engine.updateInstance(updateRequest(replaceAll('realtime', [bar(2)]), 3)).type, 'failure');
}

const asyncSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.async-test',
  indicatorVersion: 1,
  name: 'Async Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create() { return { update(event) { if (event.reason === 'realtime') return Promise.resolve('not-allowed'); } }; },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  assert.equal(engine.createInstance(createRequest(asyncSource, replaceAll('initial', [bar(1)]))).type, 'success');
  const failed = engine.updateInstance(updateRequest(replaceAll('realtime', [bar(1, 10)])));
  assert.equal(failed.type, 'failure');
  assert.equal(failed.code, 'async_not_supported');
}

const timeoutSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.timeout-test',
  indicatorVersion: 1,
  name: 'Timeout Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create() { return { update(event) { if (event.reason === 'realtime') while (true) {} } }; },
});
`;

{
  const engine = await UserIndicatorExecutionEngine.create();
  assert.equal(engine.createInstance(createRequest(timeoutSource, replaceAll('initial', [bar(1)]))).type, 'success');
  const started = performance.now();
  const failed = engine.updateInstance(updateRequest(replaceAll('realtime', [bar(1, 10)])));
  const elapsed = performance.now() - started;
  assert.equal(failed.type, 'failure');
  assert.equal(failed.code, 'execution_timeout');
  assert.match(failed.message, /update\(realtime\) exceeded 100ms budget/);
  assert.ok(elapsed < 1_000, `QuickJS realtime timeout took ${elapsed.toFixed(1)}ms`);
}

const buildResult = await build({
  configFile: false,
  root: projectRoot,
  logLevel: 'silent',
  build: {
    write: false,
    rollupOptions: { input: path.join(projectRoot, 'src/user-indicator-runtime/execution-worker-factory.ts') },
  },
});
const results = Array.isArray(buildResult) ? buildResult : [buildResult];
const output = results.flatMap((result) => result.output);
assert.ok(output.some((item) => item.fileName.includes('execution.worker')), 'Vite did not emit the execution Worker bundle');
assert.ok(!output.some((item) => item.fileName.endsWith('.wasm')), 'execution Worker unexpectedly emitted a separate wasm asset');

console.log('user indicator execution engine: ok');
