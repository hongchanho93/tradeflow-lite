import assert from 'node:assert/strict';
import { UserIndicatorExecutionEngine } from '../src/user-indicator-runtime/execution-engine.ts';
import { UserIndicatorOutputAdapter } from '../src/user-indicator-runtime/output-adapter.ts';
import { UserIndicatorRuntimeController } from '../src/user-indicator-runtime/controller.ts';
import {
  UserIndicatorOutputError,
  createUserIndicatorOutputValidationState,
  validateUserIndicatorOutputEnvelope,
} from '../src/user-indicator-runtime/output-protocol.ts';
import {
  renderUserIndicatorPanel,
  USER_INDICATOR_PANEL_STYLES,
} from '../src/user-indicator-runtime/panel-renderer.ts';

function bar(time, close = time) {
  return Object.freeze({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 });
}

function createExpectation(barsLength = 2) {
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

const panelContent = Object.freeze({
  title: '<script>alert(1)</script>',
  columns: Object.freeze([
    Object.freeze({ key: 'name', title: '项目', align: 'left' }),
    Object.freeze({ key: 'value', title: '数值', align: 'right' }),
  ]),
  rows: Object.freeze([
    Object.freeze({ cells: Object.freeze([
      Object.freeze({ text: '<img src=x onerror=alert(1)>' }),
      Object.freeze({ text: '10.52', color: '#2962ff' }),
    ]) }),
  ]),
});

const initialState = createUserIndicatorOutputValidationState();
const validated = validateUserIndicatorOutputEnvelope({
  callbacks: [
    {
      phase: 'create',
      commands: [{ type: 'create-panel', key: 'summary', paneKey: 'main', position: 'top-right' }],
    },
    {
      phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 2,
      commands: [{ type: 'panel-set', key: 'summary', content: panelContent }],
    },
  ],
}, initialState, createExpectation());
assert.equal(validated.state.panels.get('summary')?.paneKey, 'main');
assert.equal(initialState.panels.has('summary'), false, 'panel validation must be transactional');

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [
      { phase: 'create', commands: [{ type: 'create-panel', key: 'bad', paneKey: 'missing', position: 'top-right' }] },
      { phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 2, commands: [] },
    ],
  }, initialState, createExpectation()),
  'invalid_output',
  /unknown pane/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope({
    callbacks: [
      {
        phase: 'create',
        commands: Array.from({ length: 9 }, (_, index) => ({
          type: 'create-panel', key: `panel-${index}`, paneKey: 'main', position: 'top-right',
        })),
      },
      { phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 2, commands: [] },
    ],
  }, initialState, createExpectation()),
  'output_limit_exceeded',
  /panel limit 8/,
);

const panelCreateOnly = validateUserIndicatorOutputEnvelope({
  callbacks: [
    { phase: 'create', commands: [{ type: 'create-panel', key: 'summary', paneKey: 'main', position: 'top-right' }] },
    { phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 2, commands: [] },
  ],
}, initialState, createExpectation());

function updateOutput(content) {
  return {
    callbacks: [{
      phase: 'update', reason: 'realtime', changedFrom: 1, barsLength: 2,
      commands: [{ type: 'panel-set', key: 'summary', content }],
    }],
  };
}

const updateExpectation = Object.freeze({ type: 'update', reason: 'realtime', changedFrom: 1, barsLength: 2 });
const exactlyOneThousandCells = {
  columns: Array.from({ length: 5 }, (_, index) => ({ key: `c-${index}`, title: `C${index}` })),
  rows: Array.from({ length: 200 }, () => ({ cells: Array.from({ length: 5 }, () => ({ text: 'x' })) })),
};
const thousandValidated = validateUserIndicatorOutputEnvelope(
  updateOutput(exactlyOneThousandCells), panelCreateOnly.state, updateExpectation,
);
assert.equal(thousandValidated.output.callbacks[0].commands[0].content.rows.length, 200);
assert.equal(thousandValidated.output.callbacks[0].commands[0].content.rows.reduce((sum,row)=>sum+row.cells.length,0), 1000);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope(updateOutput({
    columns: [{ key: 'a', title: 'A' }],
    rows: Array.from({ length: 201 }, () => ({ cells: [{ text: 'x' }] })),
  }), panelCreateOnly.state, updateExpectation),
  'output_limit_exceeded',
  /rows exceeds 200/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope(updateOutput({
    columns: Array.from({ length: 1001 }, (_, index) => ({ key: `c-${index}`, title: 'x' })),
    rows: [{ cells: Array.from({ length: 1001 }, () => ({ text: 'x' })) }],
  }), panelCreateOnly.state, updateExpectation),
  'output_limit_exceeded',
  /1000 table cells/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope(updateOutput({
    columns: [{ key: 'a', title: 'A' }, { key: 'a', title: 'B' }],
    rows: [],
  }), panelCreateOnly.state, updateExpectation),
  'invalid_output',
  /duplicate key/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope(updateOutput({
    columns: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }],
    rows: [{ cells: [{ text: 'only-one' }] }],
  }), panelCreateOnly.state, updateExpectation),
  'invalid_output',
  /exactly 2/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope(updateOutput({
    columns: [{ key: 'a', title: 'A' }],
    rows: [{ cells: [{ text: 'x', color: 'red' }] }],
  }), panelCreateOnly.state, updateExpectation),
  'invalid_output',
  /hexadecimal color/,
);

assertOutputError(
  () => validateUserIndicatorOutputEnvelope(updateOutput({
    columns: [{ key: 'a', title: 'A' }],
    rows: [{ cells: [{ text: 'x'.repeat(513) }] }],
  }), panelCreateOnly.state, updateExpectation),
  'output_limit_exceeded',
  /512 characters/,
);

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.className = '';
    this.textContent = '';
    this.style = {};
    this.children = [];
    this.scope = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName, this); }
}

function collectText(node, output = []) {
  if (node.textContent) output.push(node.textContent);
  for (const child of node.children ?? []) collectText(child, output);
  return output;
}

const documentValue = new FakeDocument();
const root = new FakeElement('root', documentValue);
renderUserIndicatorPanel(root, panelContent);
const renderedText = collectText(root);
assert.ok(renderedText.includes('<script>alert(1)</script>'));
assert.ok(renderedText.includes('<img src=x onerror=alert(1)>'));
assert.equal(root.children.length, 1);
assert.match(USER_INDICATOR_PANEL_STYLES, /tf-user-panel/);
assert.doesNotMatch(renderUserIndicatorPanel.toString(), /innerHTML|insertAdjacentHTML|outerHTML/);

const panelSource = String.raw`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.panel-test',
  indicatorVersion: 1,
  name: 'Panel Test',
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const panel = context.layers.createPanel({ key: 'summary', paneKey: 'main', position: 'top-right' });
    return {
      update(event) {
        const last = event.bars[event.bars.length - 1];
        panel.set({
          title: '<script>alert(1)</script>',
          columns: [
            { key: 'name', title: '项目', align: 'left' },
            { key: 'value', title: '数值', align: 'right' },
          ],
          rows: [{ cells: [{ text: '<img src=x onerror=alert(1)>' }, { text: String(last.close), color: '#2962ff' }] }],
        });
      },
    };
  },
});
`;

const engine = await UserIndicatorExecutionEngine.create();
const engineResponse = engine.createInstance({
  protocolVersion: 1,
  type: 'create',
  instanceId: 'panel-instance',
  generation: 1,
  requestId: 1,
  source: panelSource,
  inputs: Object.freeze({}),
  context: Object.freeze({ symbol: 'A' }),
  initialEvent: Object.freeze({
    reason: 'initial', changedFrom: 0,
    barsPatch: Object.freeze({ mode: 'replace-all', bars: Object.freeze([bar(1), bar(2)]) }),
  }),
});
assert.equal(engineResponse.type, 'success', engineResponse.message);
assert.deepEqual(engineResponse.output.callbacks[0].commands[0], {
  type: 'create-panel', key: 'summary', paneKey: 'main', position: 'top-right',
});
assert.equal(engineResponse.output.callbacks[1].commands[0].type, 'panel-set');
assert.equal(engineResponse.output.callbacks[1].commands[0].content.title, '<script>alert(1)</script>');
engine.dispose();

const exactPanelCellLimitSource = String.raw`
defineIndicator({
  formatVersion: 1, apiVersion: 1, id: 'user.panel-cell-limit-exact', indicatorVersion: 1,
  name: 'Panel Cell Limit Exact', inputs: {}, supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const panel = context.layers.createPanel({ key: 'summary', paneKey: 'main', position: 'top-right' });
    return {
      update() {
        const columns = [];
        for (let column = 0; column < 5; column += 1) columns[column] = { key: 'c-' + column, title: 'C' + column };
        const rows = [];
        for (let row = 0; row < 200; row += 1) {
          const cells = [];
          for (let column = 0; column < 5; column += 1) cells[column] = { text: 'x' };
          rows[row] = { cells };
        }
        panel.set({ columns, rows });
      },
    };
  },
});
`;
const exactLimitEngine = await UserIndicatorExecutionEngine.create();
const exactLimitResult = exactLimitEngine.createInstance({
  protocolVersion: 1, type: 'create', instanceId: 'panel-limit-exact', generation: 1, requestId: 1,
  source: exactPanelCellLimitSource, inputs: Object.freeze({}), context: Object.freeze({ symbol: 'A' }),
  initialEvent: Object.freeze({ reason: 'initial', changedFrom: 0,
    barsPatch: Object.freeze({ mode: 'replace-all', bars: Object.freeze([bar(1)]) }) }),
});
assert.equal(exactLimitResult.type, 'success', exactLimitResult.message);
assert.equal(exactLimitResult.output.callbacks[1].commands[0].content.rows.length, 200);
assert.equal(exactLimitResult.output.callbacks[1].commands[0].content.rows.reduce((sum,row)=>sum+row.cells.length,0), 1000);
exactLimitEngine.dispose();

for (const [source, expected] of [
  [String.raw`
defineIndicator({
  formatVersion: 1, apiVersion: 1, id: 'user.panel-limit', indicatorVersion: 1,
  name: 'Panel Limit', inputs: {}, supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    for (let index = 0; index < 9; index += 1) {
      context.layers.createPanel({ key: 'panel-' + index, paneKey: 'main', position: 'top-right' });
    }
    return { update() {} };
  },
});
`, /panel limit 8/],
  [String.raw`
defineIndicator({
  formatVersion: 1, apiVersion: 1, id: 'user.panel-rows', indicatorVersion: 1,
  name: 'Panel Rows', inputs: {}, supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const panel = context.layers.createPanel({ key: 'summary', paneKey: 'main', position: 'top-right' });
    return {
      update() {
        const rows = [];
        for (let index = 0; index < 201; index += 1) rows[index] = { cells: [{ text: 'x' }] };
        panel.set({ columns: [{ key: 'a', title: 'A' }], rows });
      },
    };
  },
});
`, /rows exceeds 200/],
  [String.raw`
defineIndicator({
  formatVersion: 1, apiVersion: 1, id: 'user.panel-cells', indicatorVersion: 1,
  name: 'Panel Cells', inputs: {}, supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const panel = context.layers.createPanel({ key: 'summary', paneKey: 'main', position: 'top-right' });
    return {
      update() {
        const columns = [], cells = [];
        for (let index = 0; index < 1001; index += 1) {
          columns[index] = { key: 'c-' + index, title: 'x' };
          cells[index] = { text: 'x' };
        }
        panel.set({ columns, rows: [{ cells }] });
      },
    };
  },
});
`, /1000 table cells/],
]) {
  const invalidEngine = await UserIndicatorExecutionEngine.create();
  const result = invalidEngine.createInstance({
    protocolVersion: 1,
    type: 'create',
    instanceId: 'invalid-panel',
    generation: 1,
    requestId: 1,
    source,
    inputs: Object.freeze({}),
    context: Object.freeze({ symbol: 'A' }),
    initialEvent: Object.freeze({
      reason: 'initial', changedFrom: 0,
      barsPatch: Object.freeze({ mode: 'replace-all', bars: Object.freeze([bar(1)]) }),
    }),
  });
  assert.equal(result.type, 'failure');
  assert.equal(result.code, 'output_limit_exceeded');
  assert.match(result.message, expected);
}

class FakeChartHost {
  constructor() {
    this.calls = [];
    this.document = new FakeDocument();
    this.panelRoot = null;
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
        createSeries: () => { throw new Error('not expected'); },
        createCanvasLayer: () => { throw new Error('not expected'); },
        createOverlay: (definition) => {
          this.calls.push(['createOverlay', definition.key, definition.paneKey, definition.position, definition.interactive]);
          const overlayRoot = new FakeElement('root', this.document);
          this.panelRoot = overlayRoot;
          return {
            key: definition.key,
            root: overlayRoot,
            setStyles: (styles) => this.calls.push(['setStyles', styles === USER_INDICATOR_PANEL_STYLES]),
            setVisible: (visible) => this.calls.push(['setVisible', visible]),
          };
        },
      },
    };
  }
  finishBinding(instanceId) { this.calls.push(['finish', instanceId]); }
  abortBinding(instanceId) { this.calls.push(['abort', instanceId]); }
  remove(instanceId) { this.calls.push(['remove', instanceId]); }
}

const host = new FakeChartHost();
const adapter = new UserIndicatorOutputAdapter(host);
adapter.apply({
  protocolVersion: 1,
  type: 'success',
  phase: 'create',
  instanceId: 'panel-instance',
  generation: 1,
  requestId: 1,
  output: validated.output,
}, Object.freeze({ reason: 'initial', bars: Object.freeze([bar(1), bar(2)]), changedFrom: 0 }));
assert.deepEqual(host.calls.slice(0, 4), [
  ['begin', 'panel-instance'],
  ['createOverlay', 'summary', 'main', 'top-right', false],
  ['setStyles', true],
  ['finish', 'panel-instance'],
]);
assert.ok(collectText(host.panelRoot).includes('<img src=x onerror=alert(1)>'));
adapter.remove('panel-instance');
assert.deepEqual(host.calls.at(-1), ['remove', 'panel-instance']);

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

const e2eHost = new FakeChartHost();
const e2eWorkers = [];
const controller = new UserIndicatorRuntimeController(e2eHost, {
  workerFactory: () => {
    const worker = new EngineBackedWorker();
    e2eWorkers.push(worker);
    return worker;
  },
});
controller.create(
  'panel-e2e',
  panelSource,
  Object.freeze({}),
  Object.freeze({ symbol: 'A' }),
  Object.freeze({ reason: 'initial', bars: Object.freeze([bar(1), bar(2)]), changedFrom: 0 }),
);
await e2eWorkers[0].idle();
assert.ok(collectText(e2eHost.panelRoot).includes('<script>alert(1)</script>'));
assert.ok(collectText(e2eHost.panelRoot).includes('2'));
controller.update(
  'panel-e2e',
  Object.freeze({ reason: 'realtime', bars: Object.freeze([bar(1), bar(2), bar(3, 30)]), changedFrom: 2 }),
);
await e2eWorkers[0].idle();
assert.ok(collectText(e2eHost.panelRoot).includes('30'));
controller.remove('panel-e2e');
assert.equal(e2eWorkers[0].terminated, true);

console.log('user indicator safe panel: ok');
