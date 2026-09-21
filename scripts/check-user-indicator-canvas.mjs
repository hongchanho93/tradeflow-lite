import assert from 'node:assert/strict';
import {
  UserIndicatorOutputError,
  createUserIndicatorOutputValidationState,
  validateUserIndicatorOutputEnvelope,
} from '../src/user-indicator-runtime/output-protocol.ts';
import { UserIndicatorExecutionEngine } from '../src/user-indicator-runtime/execution-engine.ts';
import { UserIndicatorOutputAdapter } from '../src/user-indicator-runtime/output-adapter.ts';
import { drawUserIndicatorCanvasCommands } from '../src/user-indicator-runtime/canvas-renderer.ts';

function bar(time, close = time) {
  return Object.freeze({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 });
}

function initialEvent(bars) {
  return Object.freeze({ reason: 'initial', bars: Object.freeze(bars), changedFrom: 0 });
}

function createExpectation(barsLength = 3) {
  return Object.freeze({ type: 'create', reason: 'initial', changedFrom: 0, barsLength });
}

function assertOutputError(callback, code, pattern) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof UserIndicatorOutputError);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

const allCommands = Object.freeze([
  Object.freeze({
    type: 'line',
    id: 'trend-hit',
    hitTest: true,
    from: Object.freeze({ space: 'time-price', time: 1, price: 10 }),
    to: Object.freeze({ space: 'time-price', time: 2, price: 11 }),
    color: '#fff',
    lineWidth: 2,
    dash: 'dashed',
  }),
  Object.freeze({
    type: 'polyline',
    points: Object.freeze([
      Object.freeze({ space: 'time-pixel', time: 1, y: 20 }),
      Object.freeze({ space: 'time-pixel', time: 2, y: 30 }),
      Object.freeze({ space: 'time-pixel', time: 3, y: 25 }),
    ]),
    color: '#00ff00',
    dash: 'dotted',
  }),
  Object.freeze({
    type: 'polygon',
    points: Object.freeze([
      Object.freeze({ space: 'pane-pixel', x: 10, y: 10 }),
      Object.freeze({ space: 'pane-pixel', x: 30, y: 10 }),
      Object.freeze({ space: 'pane-pixel', x: 20, y: 30 }),
    ]),
    fillColor: '#ff000080',
    borderColor: '#ff0000',
  }),
  Object.freeze({
    type: 'rect',
    from: Object.freeze({ space: 'pane-pixel', x: 40, y: 20 }),
    to: Object.freeze({ space: 'pane-pixel', x: 60, y: 50 }),
    fillColor: '#12345680',
  }),
  Object.freeze({
    type: 'circle',
    at: Object.freeze({ space: 'time-price', time: 2, price: 12 }),
    radius: 6,
    borderColor: '#abcdef',
    lineWidth: 1.5,
  }),
  Object.freeze({
    type: 'text',
    at: Object.freeze({ space: 'time-pixel', time: 3, y: 40 }),
    text: '突破',
    color: '#f23645',
    fontSize: 12,
    align: 'center',
  }),
]);

const validEnvelope = {
  callbacks: [
    {
      phase: 'create',
      commands: [
        { type: 'create-pane', key: 'osc', defaultHeight: 120 },
        { type: 'create-series', key: 'signal', seriesType: 'line', pane: 'osc' },
        { type: 'create-canvas-layer', key: 'main-canvas', target: { type: 'current-main-series' }, zOrder: 'top' },
        { type: 'create-canvas-layer', key: 'pane-canvas', target: { type: 'pane', pane: 'osc' }, zOrder: 'normal' },
        { type: 'create-canvas-layer', key: 'series-canvas', target: { type: 'series', series: 'signal' }, zOrder: 'bottom' },
        { type: 'canvas-set-visible', key: 'main-canvas', visible: true },
      ],
    },
    {
      phase: 'update',
      reason: 'initial',
      changedFrom: 0,
      barsLength: 3,
      commands: [
        { type: 'canvas-set-commands', key: 'main-canvas', commands: allCommands },
        {
          type: 'canvas-set-commands',
          key: 'pane-canvas',
          commands: [{
            type: 'text',
            at: { space: 'pane-pixel', x: 10, y: 20 },
            text: '面板',
            color: '#fff',
            fontSize: 14,
          }],
        },
      ],
    },
  ],
};

const validated = validateUserIndicatorOutputEnvelope(
  validEnvelope,
  createUserIndicatorOutputValidationState(),
  createExpectation(),
);
assert.equal(validated.state.canvases.size, 3);
assert.equal(validated.output.callbacks[1].commands[0].commands.length, 6);

assertOutputError(() => validateUserIndicatorOutputEnvelope({
  callbacks: [
    {
      phase: 'create',
      commands: [
        { type: 'create-pane', key: 'osc', defaultHeight: 120 },
        { type: 'create-canvas-layer', key: 'pane-canvas', target: { type: 'pane', pane: 'osc' }, zOrder: 'normal' },
      ],
    },
    {
      phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3,
      commands: [{
        type: 'canvas-set-commands', key: 'pane-canvas', commands: [{
          type: 'text', at: { space: 'time-price', time: 1, price: 10 }, text: 'x', color: '#fff', fontSize: 12,
        }],
      }],
    },
  ],
}, createUserIndicatorOutputValidationState(), createExpectation()), 'invalid_output', /cannot use time-price/);

assertOutputError(() => validateUserIndicatorOutputEnvelope({
  callbacks: [
    {
      phase: 'create',
      commands: Array.from({ length: 9 }, (_, index) => ({
        type: 'create-canvas-layer', key: `c${index}`, target: { type: 'current-main-series' }, zOrder: 'normal',
      })),
    },
    { phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3, commands: [] },
  ],
}, createUserIndicatorOutputValidationState(), createExpectation()), 'output_limit_exceeded', /canvas layer limit 8/);

const oneLine = {
  type: 'line',
  from: { space: 'pane-pixel', x: 0, y: 0 },
  to: { space: 'pane-pixel', x: 1, y: 1 },
  color: '#fff',
};
assertOutputError(() => validateUserIndicatorOutputEnvelope({
  callbacks: [{
    phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3,
    commands: [{
      type: 'canvas-set-commands', key: 'main-canvas', commands: Array.from({ length: 5_001 }, () => oneLine),
    }],
  }],
}, validated.state, Object.freeze({ type: 'update', reason: 'initial', changedFrom: 0, barsLength: 3 })), 'output_limit_exceeded', /5000/);

assertOutputError(() => validateUserIndicatorOutputEnvelope({
  callbacks: [{
    phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3,
    commands: [{
      type: 'canvas-set-commands', key: 'main-canvas', commands: [{
        type: 'polyline',
        points: Array.from({ length: 2_001 }, (_, index) => ({ space: 'pane-pixel', x: index, y: 1 })),
        color: '#fff',
      }],
    }],
  }],
}, validated.state, Object.freeze({ type: 'update', reason: 'initial', changedFrom: 0, barsLength: 3 })), 'output_limit_exceeded', /2000/);

assertOutputError(() => validateUserIndicatorOutputEnvelope({
  callbacks: [{
    phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3,
    commands: [{
      type: 'canvas-set-commands', key: 'main-canvas', commands: [{
        type: 'line',
        from: { space: 'pane-pixel', x: 0, y: 0 },
        to: { space: 'time-pixel', time: 1, y: 1 },
        color: '#fff',
      }],
    }],
  }],
}, validated.state, Object.freeze({ type: 'update', reason: 'initial', changedFrom: 0, barsLength: 3 })), 'invalid_output', /one coordinate space/);

assertOutputError(() => validateUserIndicatorOutputEnvelope({
  callbacks: [{
    phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3,
    commands: [{
      type: 'canvas-set-commands', key: 'main-canvas', commands: [{
        type: 'text', at: { space: 'pane-pixel', x: 0, y: 0 }, text: 'x'.repeat(513), color: '#fff', fontSize: 12,
      }],
    }],
  }],
}, validated.state, Object.freeze({ type: 'update', reason: 'initial', changedFrom: 0, barsLength: 3 })), 'output_limit_exceeded', /512 characters/);

const source = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.canvas-test',
  indicatorVersion: 1,
  name: 'Canvas Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const layer = context.layers.createCanvasLayer({
      key: 'labels',
      target: { type: 'current-main-series' },
      zOrder: 'top',
    });
    layer.setVisible(true);
    return {
      update(event) {
        const last = event.bars[event.bars.length - 1];
        layer.setCommands([
          {
            type: 'line',
            from: { space: 'time-price', time: last.time, price: last.low },
            to: { space: 'time-price', time: last.time, price: last.high },
            color: '#00ff00',
            lineWidth: 2,
          },
          {
            type: 'text',
            at: { space: 'time-price', time: last.time, price: last.high },
            text: '信号',
            color: '#f23645',
            fontSize: 12,
            align: 'center',
          },
        ]);
      },
    };
  },
});
`;

const engine = await UserIndicatorExecutionEngine.create();
const created = engine.createInstance(Object.freeze({
  protocolVersion: 1,
  type: 'create',
  instanceId: 'canvas-instance',
  generation: 1,
  requestId: 1,
  source,
  inputs: Object.freeze({}),
  context: Object.freeze({ symbol: 'A' }),
  initialEvent: Object.freeze({
    reason: 'initial',
    changedFrom: 0,
    barsPatch: Object.freeze({ mode: 'replace-all', bars: Object.freeze([bar(1), bar(2)]) }),
  }),
}));
assert.equal(created.type, 'success', created.message);
assert.deepEqual(created.output.callbacks[0].commands, [
  { type: 'create-canvas-layer', key: 'labels', target: { type: 'current-main-series' }, zOrder: 'top' },
  { type: 'canvas-set-visible', key: 'labels', visible: true },
]);
assert.equal(created.output.callbacks[1].commands[0].commands.length, 2);
engine.dispose();

const contextCalls = [];
const fakeContext = {
  strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
  save: () => contextCalls.push(['save']),
  restore: () => contextCalls.push(['restore']),
  beginPath: () => contextCalls.push(['beginPath']),
  rect: (...args) => contextCalls.push(['rect', ...args]),
  clip: () => contextCalls.push(['clip']),
  moveTo: (...args) => contextCalls.push(['moveTo', ...args]),
  lineTo: (...args) => contextCalls.push(['lineTo', ...args]),
  stroke: () => contextCalls.push(['stroke']),
  fill: () => contextCalls.push(['fill']),
  closePath: () => contextCalls.push(['closePath']),
  arc: (...args) => contextCalls.push(['arc', ...args]),
  setLineDash: (value) => contextCalls.push(['dash', [...value]]),
  fillText: (...args) => contextCalls.push(['fillText', ...args]),
};
const frame = Object.freeze({
  context: fakeContext,
  width: 200,
  height: 100,
  pixelRatio: 2,
  coordinates: Object.freeze({
    timeToX: (time) => time === 999 ? null : time * 10,
    logicalToX: () => null,
    xToLogical: () => null,
    priceToY: (price) => 100 - price,
    yToPrice: (y) => 100 - y,
  }),
  visibleLogicalRange: null,
  theme: Object.freeze({}),
  requestUpdate: () => {},
});
const hitRegions = drawUserIndicatorCanvasCommands(frame, allCommands);
assert.deepEqual(contextCalls.slice(0, 4), [['save'], ['beginPath'], ['rect', 0, 0, 200, 100], ['clip']]);
assert.ok(contextCalls.some((call) => call[0] === 'moveTo' && call[1] === 10 && call[2] === 90));
assert.ok(contextCalls.some((call) => call[0] === 'arc' && call[1] === 20 && call[2] === 88 && call[3] === 6));
assert.ok(contextCalls.some((call) => call[0] === 'fillText' && call[1] === '突破' && call[2] === 30 && call[3] === 40));
assert.deepEqual(contextCalls.at(-1), ['restore']);
assert.deepEqual(hitRegions, [{ id: 'trend-hit', left: 4, top: 83, right: 26, bottom: 96 }]);

class FakeCanvasHandle {
  constructor(key) {
    this.key = key;
    this.updates = 0;
    this.visible = true;
  }
  requestUpdate() { this.updates += 1; }
  setVisible(visible) { this.visible = visible; }
}

class FakeChartHost {
  constructor() {
    this.canvasDefinitions = new Map();
    this.canvasHandles = new Map();
  }
  beginBinding() {
    return {
      panes: {
        main: { key: 'main', getHeight: () => 100 },
        create: (definition) => ({ key: definition.key, getHeight: () => definition.defaultHeight }),
        get: () => null,
      },
      layers: {
        createSeries: () => { throw new Error('not expected'); },
        createCanvasLayer: (definition) => {
          this.canvasDefinitions.set(definition.key, definition);
          const handle = new FakeCanvasHandle(definition.key);
          this.canvasHandles.set(definition.key, handle);
          return handle;
        },
        createOverlay: () => { throw new Error('not expected'); },
      },
    };
  }
  finishBinding() {}
  abortBinding() {}
  remove() {}
}

const host = new FakeChartHost();
const adapter = new UserIndicatorOutputAdapter(host);
adapter.apply(Object.freeze({
  protocolVersion: 1,
  type: 'success',
  phase: 'create',
  instanceId: 'adapter-canvas',
  generation: 1,
  requestId: 1,
  output: Object.freeze({
    callbacks: Object.freeze([
      Object.freeze({
        phase: 'create',
        commands: Object.freeze([
          Object.freeze({ type: 'create-canvas-layer', key: 'labels', target: Object.freeze({ type: 'current-main-series' }), zOrder: 'top' }),
        ]),
      }),
      Object.freeze({
        phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3,
        commands: Object.freeze([
          Object.freeze({ type: 'canvas-set-commands', key: 'labels', commands: allCommands }),
        ]),
      }),
    ]),
  }),
}), initialEvent([bar(1), bar(2), bar(3)]));
assert.equal(host.canvasHandles.get('labels').updates, 1);
const adapterCalls = [];
host.canvasDefinitions.get('labels').draw({
  ...frame,
  context: {
    ...fakeContext,
    save: () => adapterCalls.push(['save']),
    restore: () => adapterCalls.push(['restore']),
    beginPath: () => {}, rect: () => {}, clip: () => {}, moveTo: () => {}, lineTo: () => {},
    stroke: () => {}, fill: () => {}, closePath: () => {}, arc: () => {}, setLineDash: () => {}, fillText: () => {},
  },
});
assert.deepEqual(adapterCalls, [['save'], ['restore']]);

console.log('user indicator safe canvas: ok');
