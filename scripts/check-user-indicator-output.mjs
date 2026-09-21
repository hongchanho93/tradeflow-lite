import assert from 'node:assert/strict';
import {
  UserIndicatorOutputError,
  createUserIndicatorOutputValidationState,
  validateUserIndicatorOutputEnvelope,
} from '../src/user-indicator-runtime/output-protocol.ts';
import { USER_INDICATOR_RUNTIME_LIMITS } from '../src/user-indicator-runtime/limits.ts';

function createExpectation(barsLength = 3) {
  return Object.freeze({ type: 'create', reason: 'initial', changedFrom: 0, barsLength });
}

function updateExpectation(reason = 'realtime', changedFrom = 2, barsLength = 3) {
  return Object.freeze({ type: 'update', reason, changedFrom, barsLength });
}

const initialState = createUserIndicatorOutputValidationState();
const validCreate = {
  callbacks: [
    {
      phase: 'create',
      commands: [
        { type: 'create-pane', key: 'osc', defaultHeight: 120 },
        {
          type: 'create-series',
          key: 'signal',
          seriesType: 'line',
          pane: 'osc',
          options: { color: '#2962ff', lineWidth: 2, priceLineVisible: false, visible: true },
        },
        { type: 'series-set-visible', key: 'signal', visible: true },
        { type: 'create-marker-contribution', key: 'signals', priority: 100 },
        {
          type: 'create-bar-style-contribution',
          key: 'bar-colors',
          priority: 50,
          chartKinds: ['candles', 'bars'],
        },
      ],
    },
    {
      phase: 'update',
      reason: 'initial',
      changedFrom: 0,
      barsLength: 3,
      commands: [
        { type: 'series-set-values', key: 'signal', values: [null, 2, 3], dirtyFrom: 0 },
        {
          type: 'marker-set',
          key: 'signals',
          markers: [{
            time: 3,
            position: 'aboveBar',
            shape: 'circle',
            color: '#f23645',
            text: '突破',
            textColor: '#fff',
            tooltip: '中文提示',
            size: 1,
          }],
        },
        {
          type: 'bar-style-set',
          key: 'bar-colors',
          styles: [
            { time: 2, color: '#00ff00' },
            { time: 3, color: '#ff0000', borderColor: '#f00', wickColor: '#f00' },
          ],
        },
      ],
    },
  ],
};

const created = validateUserIndicatorOutputEnvelope(validCreate, initialState, createExpectation());
assert.equal(created.output.callbacks.length, 2);
assert.equal(created.state.panes.has('osc'), true);
assert.equal(created.state.series.get('signal')?.type, 'line');
assert.equal(created.state.markers.has('signals'), true);
assert.equal(created.state.barStyles.has('bar-colors'), true);
assert.equal(initialState.panes.has('osc'), false, 'validation must be transactional and not mutate the input state');

const validUpdate = validateUserIndicatorOutputEnvelope({
  callbacks: [{
    phase: 'update',
    reason: 'realtime',
    changedFrom: 2,
    barsLength: 3,
    commands: [
      {
        type: 'series-set-data',
        key: 'signal',
        points: [{ time: 1, value: 1 }, { time: 3, value: 3, color: '#fff' }],
      },
      { type: 'series-update', key: 'signal', point: { time: 3, value: 4 } },
      { type: 'series-set-visible', key: 'signal', visible: false },
      {
        type: 'marker-set',
        key: 'signals',
        markers: [{
          time: 3,
          position: 'atPriceTop',
          price: 4,
          shape: 'arrowUp',
          color: '#0f0',
          id: 'marker-3',
        }],
      },
      {
        type: 'bar-style-set',
        key: 'bar-colors',
        styles: [{ time: 3, color: '#123456' }],
      },
      { type: 'debug-log', message: 'realtime ok' },
    ],
  }],
}, created.state, updateExpectation());
assert.equal(validUpdate.output.callbacks[0].commands.length, 6);
assert.deepEqual(validUpdate.output.callbacks[0].commands.at(-1), { type: 'debug-log', message: 'realtime ok' });

const longerThanChart = validateUserIndicatorOutputEnvelope({
  callbacks: [{
    phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
    commands: [{
      type: 'series-set-data', key: 'signal',
      points: Array.from({ length: 10 }, (_, index) => ({ time: index + 1, value: index })),
    }],
  }],
}, created.state, updateExpectation());
assert.equal(longerThanChart.output.callbacks[0].commands[0].points.length, 10,
  'setData must use its independent resource budget rather than current chart bars length');

function assertOutputError(callback, code, pattern) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof UserIndicatorOutputError);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{ phase: 'update', reason: 'history', changedFrom: 2, barsLength: 3, commands: [] }],
  }, created.state, updateExpectation()),
  'invalid_output',
  /reason/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{ type: 'series-set-values', key: 'signal', values: [1, Number.NaN, 3] }],
    }],
  }, created.state, updateExpectation()),
  'invalid_output',
  /finite/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{ type: 'series-set-values', key: 'signal', values: [1, 2] }],
    }],
  }, created.state, updateExpectation()),
  'invalid_output',
  /exactly 3/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{ type: 'series-update', key: 'missing', point: { time: 3, value: 1 } }],
    }],
  }, created.state, updateExpectation()),
  'invalid_output',
  /unknown series/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{ type: 'create-pane', key: 'late', defaultHeight: 100 }],
    }],
  }, created.state, updateExpectation()),
  'invalid_output',
  /only be created during create/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: Array.from({ length: 257 }, () => ({ type: 'series-set-visible', key: 'signal', visible: true })),
    }],
  }, created.state, updateExpectation()),
  'output_limit_exceeded',
  /256/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [
      {
        phase: 'create',
        commands: [
          { type: 'create-pane', key: 'temp', defaultHeight: 100 },
          { type: 'create-pane', key: 'temp', defaultHeight: 100 },
        ],
      },
      { phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3, commands: [] },
    ],
  }, initialState, createExpectation()),
  'invalid_output',
  /duplicate/,
);
assert.equal(initialState.panes.has('temp'), false, 'failed batch must not partially commit resource state');

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [
      {
        phase: 'create',
        commands: [{
          type: 'create-series', key: 'bad', seriesType: 'line', pane: 'main', options: { color: 'red' },
        }],
      },
      { phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3, commands: [] },
    ],
  }, initialState, createExpectation()),
  'invalid_output',
  /hexadecimal color/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{
        type: 'marker-set', key: 'signals', markers: [{
          time: 3, position: 'atPriceTop', shape: 'circle', color: '#fff',
        }],
      }],
    }],
  }, created.state, updateExpectation()),
  'invalid_output',
  /price is required/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{ type: 'marker-set', key: 'missing', markers: [] }],
    }],
  }, created.state, updateExpectation()),
  'invalid_output',
  /unknown marker contribution/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{
        type: 'marker-set',
        key: 'signals',
        markers: Array.from({ length: 2_001 }, (_, index) => ({
          time: index + 1,
          position: 'aboveBar',
          shape: 'circle',
          color: '#fff',
        })),
      }],
    }],
  }, created.state, updateExpectation()),
  'output_limit_exceeded',
  /2000/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{
        type: 'marker-set',
        key: 'signals',
        markers: [{
          time: 3,
          position: 'aboveBar',
          shape: 'circle',
          color: '#fff',
          text: 'x'.repeat(513),
        }],
      }],
    }],
  }, created.state, updateExpectation()),
  'output_limit_exceeded',
  /512 characters/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{
        type: 'marker-set',
        key: 'signals',
        markers: Array.from({ length: 43 }, (_, index) => ({
          time: index + 1,
          position: 'belowBar',
          shape: 'square',
          color: '#fff',
          tooltip: '界'.repeat(512),
        })),
      }],
    }],
  }, created.state, updateExpectation()),
  'output_limit_exceeded',
  /65536 bytes/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [
      {
        phase: 'create',
        commands: [{
          type: 'create-bar-style-contribution',
          key: 'styles',
          priority: 0,
          chartKinds: ['candles', 'candles'],
        }],
      },
      { phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3, commands: [] },
    ],
  }, initialState, createExpectation()),
  'invalid_output',
  /duplicate chart kind/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{
        type: 'bar-style-set',
        key: 'bar-colors',
        styles: [
          { time: 1, color: '#fff' },
          { time: 2, color: '#fff' },
          { time: 3, color: '#fff' },
          { time: 4, color: '#fff' },
        ],
      }],
    }],
  }, created.state, updateExpectation()),
  'output_limit_exceeded',
  /bars length 3/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{
        type: 'bar-style-set',
        key: 'bar-colors',
        styles: [{ time: 3, color: '#fff' }, { time: 2, color: '#fff' }],
      }],
    }],
  }, created.state, updateExpectation()),
  'invalid_output',
  /strictly increasing/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{
        type: 'bar-style-set',
        key: 'bar-colors',
        styles: [{ time: 3, wickColor: 'red' }],
      }],
    }],
  }, created.state, updateExpectation()),
  'invalid_output',
  /hexadecimal color/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 2, barsLength: 3,
      commands: [{
        type: 'series-set-data', key: 'signal',
        points: Array.from({ length: USER_INDICATOR_RUNTIME_LIMITS.seriesDataPointsPerCallback + 1 }, (_, index) => ({ time: index + 1, value: index })),
      }],
    }],
  }, created.state, updateExpectation()),
  'output_limit_exceeded',
  /12000/,
);

assert.throws(() => validateUserIndicatorOutputEnvelope({
  callbacks: [
    { phase: 'create', commands: [{ type: 'create-series', key: 'phase-test', seriesType: 'line', pane: 'main' }] },
    { phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3,
      commands: [{ type: 'series-set-values', key: 'phase-test', values: [1, Number.NaN, 3] }] },
  ],
}, initialState, createExpectation()), error => {
  assert.ok(error instanceof UserIndicatorOutputError);
  assert.equal(error.code, 'invalid_output');
  assert.equal(error.phase, 'update');
  return true;
});

console.log('user indicator output protocol: ok');
