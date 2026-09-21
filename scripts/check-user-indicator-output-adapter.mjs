import assert from 'node:assert/strict';
import { UserIndicatorOutputAdapter } from '../src/user-indicator-runtime/output-adapter.ts';

function bar(time, close = time) {
  return Object.freeze({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 });
}

function event(reason, bars, changedFrom) {
  return Object.freeze({ reason, bars: Object.freeze(bars), changedFrom });
}

class FakeSeries {
  constructor(key, calls) {
    this.key = key;
    this.type = 'line';
    this.pane = 'osc';
    this.calls = calls;
    this.throwOnValues = false;
  }

  setValues(runtimeEvent, values, options) {
    this.calls.push(['setValues', this.key, runtimeEvent.reason, [...values], { ...options }]);
    if (this.throwOnValues) throw new Error('expected-host-series-failure');
  }

  setData(points) { this.calls.push(['setData', this.key, points.map((point) => ({ ...point }))]); }
  update(point) { this.calls.push(['update', this.key, { ...point }]); }
  setVisible(visible) { this.calls.push(['setVisible', this.key, visible]); }
}

class FakeChartHost {
  constructor() {
    this.calls = [];
    this.series = new Map();
  }

  beginBinding(instanceId) {
    this.calls.push(['beginBinding', instanceId]);
    return {
      panes: {
        main: { key: 'main', getHeight: () => 0 },
        create: (definition) => {
          this.calls.push(['createPane', definition.key, definition.defaultHeight]);
          return { key: definition.key, getHeight: () => definition.defaultHeight };
        },
        get: () => null,
      },
      layers: {
        createSeries: (definition) => {
          this.calls.push(['createSeries', definition.key, definition.type, definition.pane, definition.options]);
          const series = new FakeSeries(definition.key, this.calls);
          series.type = definition.type;
          series.pane = definition.pane;
          this.series.set(definition.key, series);
          return series;
        },
        createCanvasLayer: () => { throw new Error('not expected'); },
        createOverlay: () => { throw new Error('not expected'); },
      },
    };
  }

  finishBinding(instanceId) { this.calls.push(['finishBinding', instanceId]); }
  abortBinding(instanceId) { this.calls.push(['abortBinding', instanceId]); }
  remove(instanceId) { this.calls.push(['remove', instanceId]); }
}

class FakeMainSeriesHost {
  constructor() {
    this.calls = [];
    this.markers = new Map();
    this.barStyles = new Map();
  }

  beginBinding(instanceId) {
    this.calls.push(['beginBinding', instanceId]);
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
        this.calls.push(['createMarker', definition.key, definition.priority, [...definition.chartKinds]]);
        const handle = {
          key: definition.key,
          set: (markers) => {
            const copied = markers.map((marker) => ({ ...marker }));
            this.calls.push(['setMarkers', definition.key, copied]);
            this.markers.set(definition.key, copied);
          },
        };
        return handle;
      },
    };
  }

  finishBinding(instanceId) { this.calls.push(['finishBinding', instanceId]); }
  abortBinding(instanceId) { this.calls.push(['abortBinding', instanceId]); }
  remove(instanceId) { this.calls.push(['remove', instanceId]); }
}

function createResponse() {
  return Object.freeze({
    protocolVersion: 1,
    type: 'success',
    phase: 'create',
    instanceId: 'instance-1',
    generation: 1,
    requestId: 1,
    output: Object.freeze({
      callbacks: Object.freeze([
        Object.freeze({
          phase: 'create',
          commands: Object.freeze([
            Object.freeze({ type: 'create-pane', key: 'osc', defaultHeight: 120 }),
            Object.freeze({
              type: 'create-series',
              key: 'signal',
              seriesType: 'line',
              pane: 'osc',
              options: Object.freeze({ color: '#2962ff', lineWidth: 2 }),
            }),
            Object.freeze({ type: 'series-set-visible', key: 'signal', visible: true }),
          ]),
        }),
        Object.freeze({
          phase: 'update',
          reason: 'initial',
          changedFrom: 0,
          barsLength: 3,
          commands: Object.freeze([
            Object.freeze({ type: 'series-set-values', key: 'signal', values: Object.freeze([1, 2, 3]), dirtyFrom: 0 }),
          ]),
        }),
      ]),
    }),
  });
}

const host = new FakeChartHost();
const adapter = new UserIndicatorOutputAdapter(host);
const initialEvent = event('initial', [bar(1), bar(2), bar(3)], 0);
adapter.apply(createResponse(), initialEvent);
assert.equal(adapter.has('instance-1', 1), true);
assert.deepEqual(host.calls.slice(0, 7), [
  ['beginBinding', 'instance-1'],
  ['createPane', 'osc', 120],
  ['createSeries', 'signal', 'line', 'osc', { color: '#2962ff', lineWidth: 2 }],
  ['setVisible', 'signal', true],
  ['setValues', 'signal', 'initial', [1, 2, 3], { dirtyFrom: 0 }],
  ['finishBinding', 'instance-1'],
]);

const realtimeEvent = event('realtime', [bar(1), bar(2), bar(3, 30), bar(4, 40)], 2);
adapter.apply(Object.freeze({
  protocolVersion: 1,
  type: 'success',
  phase: 'update',
  instanceId: 'instance-1',
  generation: 1,
  requestId: 2,
  output: Object.freeze({
    callbacks: Object.freeze([Object.freeze({
      phase: 'update',
      reason: 'realtime',
      changedFrom: 2,
      barsLength: 4,
      commands: Object.freeze([
        Object.freeze({ type: 'series-set-values', key: 'signal', values: Object.freeze([1, 2, 30, 40]), dirtyFrom: 2 }),
        Object.freeze({ type: 'series-update', key: 'signal', point: Object.freeze({ time: 4, value: 41 }) }),
        Object.freeze({ type: 'series-set-visible', key: 'signal', visible: false }),
      ]),
    })]),
  }),
}), realtimeEvent);
assert.deepEqual(host.calls.slice(-3), [
  ['setValues', 'signal', 'realtime', [1, 2, 30, 40], { dirtyFrom: 2 }],
  ['update', 'signal', { time: 4, value: 41 }],
  ['setVisible', 'signal', false],
]);

host.series.get('signal').throwOnValues = true;
assert.throws(() => adapter.apply(Object.freeze({
  protocolVersion: 1,
  type: 'success',
  phase: 'update',
  instanceId: 'instance-1',
  generation: 1,
  requestId: 3,
  output: Object.freeze({
    callbacks: Object.freeze([Object.freeze({
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 4,
      commands: Object.freeze([Object.freeze({
        type: 'series-set-values', key: 'signal', values: Object.freeze([1, 2, 30, 40]), dirtyFrom: 2,
      })]),
    })]),
  }),
}), realtimeEvent), /expected-host-series-failure/);
assert.equal(adapter.has('instance-1'), false);
assert.deepEqual(host.calls.at(-1), ['remove', 'instance-1'], 'host failure must clear the whole user indicator visual slot');

const createFailureHost = new FakeChartHost();
const createFailureAdapter = new UserIndicatorOutputAdapter(createFailureHost);
createFailureHost.beginBinding = function beginBinding(instanceId) {
  const binding = FakeChartHost.prototype.beginBinding.call(this, instanceId);
  binding.layers.createSeries = () => { throw new Error('expected-create-failure'); };
  return binding;
};
assert.throws(() => createFailureAdapter.apply(createResponse(), initialEvent), /expected-create-failure/);
assert.deepEqual(createFailureHost.calls.slice(-2), [
  ['abortBinding', 'instance-1'],
  ['remove', 'instance-1'],
]);

const mainBeginFailureHost = new FakeChartHost();
const mainBeginFailureMainHost = new FakeMainSeriesHost();
mainBeginFailureMainHost.beginBinding = () => { throw new Error('expected-main-begin-failure'); };
const mainBeginFailureAdapter = new UserIndicatorOutputAdapter(mainBeginFailureHost, mainBeginFailureMainHost);
assert.throws(
  () => mainBeginFailureAdapter.apply(createResponse(), initialEvent),
  /expected-main-begin-failure/,
);
assert.deepEqual(mainBeginFailureHost.calls.slice(-3), [
  ['beginBinding', 'instance-1'],
  ['abortBinding', 'instance-1'],
  ['remove', 'instance-1'],
]);
assert.deepEqual(mainBeginFailureMainHost.calls.at(-1), ['remove', 'instance-1']);

const markerChartHost = new FakeChartHost();
const markerMainHost = new FakeMainSeriesHost();
const markerAdapter = new UserIndicatorOutputAdapter(markerChartHost, markerMainHost);
const markerCreateResponse = Object.freeze({
  protocolVersion: 1,
  type: 'success',
  phase: 'create',
  instanceId: 'marker-instance',
  generation: 1,
  requestId: 1,
  output: Object.freeze({
    callbacks: Object.freeze([
      Object.freeze({
        phase: 'create',
        commands: Object.freeze([
          Object.freeze({ type: 'create-marker-contribution', key: 'signals', priority: 100 }),
        ]),
      }),
      Object.freeze({
        phase: 'update',
        reason: 'initial',
        changedFrom: 0,
        barsLength: 3,
        commands: Object.freeze([
          Object.freeze({
            type: 'marker-set',
            key: 'signals',
            markers: Object.freeze([Object.freeze({
              time: 3,
              position: 'aboveBar',
              shape: 'circle',
              color: '#f23645',
              id: 'signal-3',
              hitTest: true,
              text: '信号',
            })]),
          }),
        ]),
      }),
    ]),
  }),
});
markerAdapter.apply(markerCreateResponse, initialEvent);
assert.deepEqual(markerMainHost.calls, [
  ['beginBinding', 'marker-instance'],
  ['createMarker', 'signals', 100, ['candles', 'bars', 'line', 'area', 'baseline']],
  ['setMarkers', 'signals', [{
    time: 3,
    position: 'aboveBar',
    shape: 'circle',
    color: '#f23645',
    id: 'signal-3',
    hitTest: true,
    text: '信号',
  }]],
  ['finishBinding', 'marker-instance'],
]);
assert.deepEqual(markerAdapter.hitTest(3, 0, 0), { instanceId: 'marker-instance', id: 'signal-3', pane: 'main', time: 3 });
assert.equal(markerAdapter.hitTest(2, 0, 0), null);

markerAdapter.apply(Object.freeze({
  protocolVersion: 1,
  type: 'success',
  phase: 'update',
  instanceId: 'marker-instance',
  generation: 1,
  requestId: 2,
  output: Object.freeze({
    callbacks: Object.freeze([Object.freeze({
      phase: 'update',
      reason: 'realtime',
      changedFrom: 2,
      barsLength: 4,
      commands: Object.freeze([Object.freeze({
        type: 'marker-set',
        key: 'signals',
        markers: Object.freeze([Object.freeze({
          time: 4,
          position: 'atPriceTop',
          price: 41,
          shape: 'arrowUp',
          color: '#0f0',
        })]),
      })]),
    })]),
  }),
}), realtimeEvent);
assert.deepEqual(markerMainHost.calls.at(-1), ['setMarkers', 'signals', [{
  time: 4,
  position: 'atPriceTop',
  price: 41,
  shape: 'arrowUp',
  color: '#0f0',
}]]);
assert.equal(markerAdapter.hitTest(4, 0, 0), null, 'marker-set without hitTest clears previous interaction targets');
markerAdapter.remove('marker-instance');
assert.deepEqual(markerMainHost.calls.at(-1), ['remove', 'marker-instance']);

const styleChartHost = new FakeChartHost();
const styleMainHost = new FakeMainSeriesHost();
const styleAdapter = new UserIndicatorOutputAdapter(styleChartHost, styleMainHost);
styleAdapter.apply(Object.freeze({
  protocolVersion: 1,
  type: 'success',
  phase: 'create',
  instanceId: 'style-instance',
  generation: 1,
  requestId: 1,
  output: Object.freeze({
    callbacks: Object.freeze([
      Object.freeze({
        phase: 'create',
        commands: Object.freeze([Object.freeze({
          type: 'create-bar-style-contribution',
          key: 'bar-colors',
          priority: 50,
          chartKinds: Object.freeze(['candles', 'bars']),
        })]),
      }),
      Object.freeze({
        phase: 'update',
        reason: 'initial',
        changedFrom: 0,
        barsLength: 3,
        commands: Object.freeze([Object.freeze({
          type: 'bar-style-set',
          key: 'bar-colors',
          styles: Object.freeze([
            Object.freeze({ time: 1, color: '#00ff00' }),
            Object.freeze({ time: 3, color: '#ff0000', wickColor: '#f00' }),
          ]),
        })]),
      }),
    ]),
  }),
}), initialEvent);
assert.deepEqual(styleMainHost.calls.slice(0, 5), [
  ['beginBinding', 'style-instance'],
  ['createBarStyle', 'bar-colors', 50, ['candles', 'bars']],
  ['setProvider', 'bar-colors'],
  ['invalidateFrom', 'bar-colors', 0],
  ['finishBinding', 'style-instance'],
]);
const styleResource = styleMainHost.barStyles.get('bar-colors');
assert.deepEqual(styleResource.provider({ time: 1 }, 0), { color: '#00ff00' });
assert.equal(styleResource.provider({ time: 2 }, 1), null);
assert.deepEqual(styleResource.provider({ time: 3 }, 2), { color: '#ff0000', wickColor: '#f00' });

styleAdapter.apply(Object.freeze({
  protocolVersion: 1,
  type: 'success',
  phase: 'update',
  instanceId: 'style-instance',
  generation: 1,
  requestId: 2,
  output: Object.freeze({
    callbacks: Object.freeze([Object.freeze({
      phase: 'update',
      reason: 'realtime',
      changedFrom: 2,
      barsLength: 4,
      commands: Object.freeze([Object.freeze({
        type: 'bar-style-set',
        key: 'bar-colors',
        styles: Object.freeze([Object.freeze({ time: 4, borderColor: '#123456' })]),
      })]),
    })]),
  }),
}), realtimeEvent);
assert.equal(styleResource.provider({ time: 1 }, 0), null, 'bar style set must replace the previous snapshot');
assert.deepEqual(styleResource.provider({ time: 4 }, 3), { borderColor: '#123456' });
assert.deepEqual(styleMainHost.calls.at(-1), ['invalidateFrom', 'bar-colors', 2]);
styleAdapter.remove('style-instance');
assert.deepEqual(styleMainHost.calls.at(-1), ['remove', 'style-instance']);

console.log('user indicator output adapter: ok');
