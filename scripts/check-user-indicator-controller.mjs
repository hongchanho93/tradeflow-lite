import assert from 'node:assert/strict';
import { UserIndicatorRuntimeController } from '../src/user-indicator-runtime/controller.ts';
import { UserIndicatorExecutionEngine } from '../src/user-indicator-runtime/execution-engine.ts';

function bar(time, close = time) {
  return Object.freeze({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 });
}

function event(reason, bars, changedFrom) {
  return Object.freeze({ reason, bars: Object.freeze(bars), changedFrom });
}

class FakeWorker {
  constructor() {
    this.messages = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }

  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(message) { this.onmessage?.({ data: message }); }
}

class FakeSeries {
  constructor(key, calls) {
    this.key = key;
    this.type = 'line';
    this.pane = 'main';
    this.calls = calls;
    this.fail = false;
  }
  setData(points) { this.calls.push(['setData', this.key, points.length]); }
  update(point) { this.calls.push(['update', this.key, point.time]); }
  setVisible(visible) { this.calls.push(['setVisible', this.key, visible]); }
  setValues(runtimeEvent, values, options) {
    this.calls.push(['setValues', this.key, runtimeEvent.reason, values.at(-1), options.dirtyFrom]);
    if (this.fail) throw new Error('chart-series-failed');
  }
}

class FakeChartHost {
  constructor() {
    this.calls = [];
    this.series = new Map();
  }
  beginBinding(instanceId) {
    this.calls.push(['begin', instanceId]);
    return {
      panes: {
        main: { key: 'main', getHeight: () => 0 },
        create: (definition) => ({ key: definition.key, getHeight: () => definition.defaultHeight }),
        get: () => null,
      },
      layers: {
        createSeries: (definition) => {
          const series = new FakeSeries(definition.key, this.calls);
          this.series.set(definition.key, series);
          this.calls.push(['createSeries', definition.key]);
          return series;
        },
        createCanvasLayer: () => { throw new Error('not expected'); },
        createOverlay: () => { throw new Error('not expected'); },
      },
    };
  }
  finishBinding(instanceId) { this.calls.push(['finish', instanceId]); }
  abortBinding(instanceId) { this.calls.push(['abort', instanceId]); }
  remove(instanceId) { this.calls.push(['remove', instanceId]); }
}

function createOutput(request, barsLength) {
  return {
    protocolVersion: 1,
    type: 'success',
    phase: 'create',
    instanceId: request.instanceId,
    generation: request.generation,
    requestId: request.requestId,
    output: {
      callbacks: [
        {
          phase: 'create',
          commands: [{ type: 'create-series', key: 'line', seriesType: 'line', pane: 'main' }],
        },
        {
          phase: 'update', reason: 'initial', changedFrom: 0, barsLength,
          commands: [{ type: 'series-set-values', key: 'line', values: Array.from({ length: barsLength }, (_, i) => i + 1), dirtyFrom: 0 }],
        },
      ],
    },
  };
}

const workers = [];
const failures = [];
const host = new FakeChartHost();
const controller = new UserIndicatorRuntimeController(host, {
  workerFactory: () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  },
  onFailure: (failure) => failures.push(failure),
});

controller.create('instance-1', 'source', Object.freeze({}), Object.freeze({ symbol: 'A' }), event('initial', [bar(1), bar(2)], 0));
const worker = workers[0];
const createRequest = worker.messages[0];
worker.reply(createOutput(createRequest, 2));
assert.deepEqual(host.calls, [
  ['begin', 'instance-1'],
  ['createSeries', 'line'],
  ['setValues', 'line', 'initial', 2, 0],
  ['finish', 'instance-1'],
]);

controller.update('instance-1', event('realtime', [bar(1), bar(2, 20), bar(3, 30)], 1));
const updateRequest = worker.messages[1];
worker.reply({
  protocolVersion: 1,
  type: 'success',
  phase: 'update',
  instanceId: 'instance-1',
  generation: 1,
  requestId: updateRequest.requestId,
  output: {
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 1, barsLength: 3,
      commands: [{ type: 'series-set-values', key: 'line', values: [1, 20, 30], dirtyFrom: 1 }],
    }],
  },
});
assert.deepEqual(host.calls.at(-1), ['setValues', 'line', 'realtime', 30, 1]);

host.series.get('line').fail = true;
controller.update('instance-1', event('realtime', [bar(1), bar(2, 20), bar(3, 31)], 2));
const failingRequest = worker.messages[2];
worker.reply({
  protocolVersion: 1,
  type: 'success',
  phase: 'update',
  instanceId: 'instance-1',
  generation: 1,
  requestId: failingRequest.requestId,
  output: {
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{ type: 'series-set-values', key: 'line', values: [1, 20, 31], dirtyFrom: 2 }],
    }],
  },
});
assert.equal(worker.terminated, true, 'chart apply failure must terminate the execution Worker');
assert.equal(controller.list()[0].failed, true);
assert.equal(failures.at(-1).code, 'output_apply_failed');
assert.deepEqual(host.calls.at(-1), ['remove', 'instance-1']);

controller.remove('instance-1');
assert.equal(controller.list().length, 0);

class EngineBackedWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this.terminated = false;
    this.engine = null;
    this.queue = Promise.resolve();
  }

  postMessage(message) {
    this.queue = this.queue.then(async () => {
      if (this.terminated) return;
      if (message.type === 'create') {
        this.engine = await UserIndicatorExecutionEngine.create();
        const response = this.engine.createInstance(message);
        if (!this.terminated) this.onmessage?.({ data: response });
        return;
      }
      if (message.type === 'update' && this.engine) {
        const response = this.engine.updateInstance(message);
        if (!this.terminated) this.onmessage?.({ data: response });
      }
    });
  }

  terminate() {
    this.terminated = true;
    if (this.engine && !this.engine.isPoisoned()) this.engine.dispose();
  }

  async idle() { await this.queue; }
}

class FakeMainSeriesHost {
  constructor() {
    this.calls = [];
    this.barStyles = new Map();
  }
  beginBinding(instanceId) {
    this.calls.push(['begin', instanceId]);
    return {
      createBarStyleContribution: (definition) => {
        this.calls.push(['createBarStyle', definition.key, definition.priority, [...definition.chartKinds]]);
        const resource = { provider: null };
        this.barStyles.set(definition.key, resource);
        return {
          key: definition.key,
          setProvider: (provider) => {
            resource.provider = provider;
            this.calls.push(['setProvider', definition.key]);
          },
          invalidateFrom: (changedFrom) => this.calls.push(['invalidateFrom', definition.key, changedFrom]),
        };
      },
      createMarkerContribution: (definition) => {
        this.calls.push(['createMarker', definition.key, definition.priority]);
        return {
          key: definition.key,
          set: (markers) => this.calls.push(['setMarkers', definition.key, markers.map((marker) => ({ ...marker }))]),
        };
      },
    };
  }
  finishBinding(instanceId) { this.calls.push(['finish', instanceId]); }
  abortBinding(instanceId) { this.calls.push(['abort', instanceId]); }
  remove(instanceId) { this.calls.push(['remove', instanceId]); }
}

const endToEndSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.controller-e2e',
  indicatorVersion: 1,
  name: 'Controller E2E',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const pane = context.panes.create({ key: 'osc', defaultHeight: 120 });
    const line = context.layers.createSeries({ key: 'signal', type: 'line', pane: pane.key, options: { color: '#2962ff' } });
    const markers = context.mainSeries.createMarkerContribution({ key: 'signals', priority: 100 });
    const styles = context.mainSeries.createBarStyleContribution({
      key: 'bar-colors', priority: 50, chartKinds: ['candles'],
    });
    return {
      update(runtimeEvent) {
        const values = [];
        const barStyles = [];
        for (let index = 0; index < runtimeEvent.bars.length; index += 1) values[index] = runtimeEvent.bars[index].close;
        for (let index = 0; index < runtimeEvent.bars.length; index += 1) {
          const bar = runtimeEvent.bars[index];
          barStyles[index] = { time: bar.time, color: bar.close >= bar.open ? '#00ff00' : '#ff0000' };
        }
        line.setValues(values, { dirtyFrom: runtimeEvent.changedFrom });
        const last = runtimeEvent.bars[runtimeEvent.bars.length - 1];
        markers.set([{
          time: last.time,
          position: 'aboveBar',
          shape: 'circle',
          color: '#f23645',
          text: '信号',
        }]);
        styles.set(barStyles);
      },
    };
  },
});
`;

const engineWorkers = [];
const engineHost = new FakeChartHost();
const engineMainSeriesHost = new FakeMainSeriesHost();
const engineController = new UserIndicatorRuntimeController(engineHost, {
  mainSeriesHost: engineMainSeriesHost,
  workerFactory: () => {
    const worker = new EngineBackedWorker();
    engineWorkers.push(worker);
    return worker;
  },
});
engineController.create(
  'engine-instance',
  endToEndSource,
  Object.freeze({}),
  Object.freeze({ symbol: 'A' }),
  event('initial', [bar(1), bar(2)], 0),
);
await engineWorkers[0].idle();
assert.deepEqual(engineHost.calls.slice(0, 4), [
  ['begin', 'engine-instance'],
  ['createSeries', 'signal'],
  ['setValues', 'signal', 'initial', 2, 0],
  ['finish', 'engine-instance'],
]);
assert.deepEqual(engineMainSeriesHost.calls.slice(0, 4), [
  ['begin', 'engine-instance'],
  ['createMarker', 'signals', 100],
  ['createBarStyle', 'bar-colors', 50, ['candles']],
  ['setProvider', 'bar-colors'],
]);
assert.ok(engineMainSeriesHost.calls.some((call) => call[0] === 'setMarkers' && call[1] === 'signals'));
assert.ok(engineMainSeriesHost.calls.some((call) => call[0] === 'invalidateFrom' && call[1] === 'bar-colors' && call[2] === 0));
assert.deepEqual(engineMainSeriesHost.barStyles.get('bar-colors').provider({ time: 2 }, 1), { color: '#00ff00' });
engineController.update('engine-instance', event('realtime', [bar(1), bar(2, 20), bar(3, 30)], 1));
await engineWorkers[0].idle();
assert.deepEqual(engineHost.calls.at(-1), ['setValues', 'signal', 'realtime', 30, 1]);
assert.ok(engineMainSeriesHost.calls.some((call) => call[0] === 'setMarkers'
  && call[1] === 'signals'
  && call[2]?.[0]?.time === 3));
assert.deepEqual(engineMainSeriesHost.calls.at(-1), ['invalidateFrom', 'bar-colors', 1]);
assert.deepEqual(engineMainSeriesHost.barStyles.get('bar-colors').provider({ time: 3 }, 2), { color: '#00ff00' });
engineController.remove('engine-instance');
assert.equal(engineWorkers[0].terminated, true);
assert.deepEqual(engineMainSeriesHost.calls.at(-1), ['remove', 'engine-instance']);

console.log('user indicator runtime controller: ok');
