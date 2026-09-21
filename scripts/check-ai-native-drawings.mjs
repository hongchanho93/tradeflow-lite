import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { CapabilityCore, CapabilityRegistry } from '../src/ai-capabilities/index.ts';
import { DrawingChangeManager } from '../src/ai-capabilities/drawing-changes.ts';
import { NativeDrawingPort } from '../src/ai-capabilities/drawing-native.ts';
import { DrawingAttachments } from '../src/ai-capabilities/drawing-attachments.ts';
import { DrawingJournalStorage } from '../src/ai-capabilities/drawing-journal.ts';
import { ChartReadBridge } from '../src/ai-capabilities/chart-host.ts';
import { UserDataManager } from '../src/user-data/manager.ts';
import { createUserDataNative } from '../src/user-data/native-client.ts';
import { createUserDataTools } from '../src/user-data/tools.ts';
import { UserTaskManager } from '../src/user-task/manager.ts';
import { UserTaskLibrary } from '../src/user-task/library.ts';
import { IndexedDbTaskStore } from '../src/user-task/library-store.ts';
import { createTaskDataHost } from '../src/user-task/sources.ts';
import { createUserTaskTools, createSavedTaskTool } from '../src/user-task/tools.ts';
import { createNativeMarketQueryPort } from '../src/ai-capabilities/market-query.ts';
import { createDrawingTools, createDrawingRecoveryTools } from '../src/ai-capabilities/drawing-tools.ts';
import { DrawingHistory, DRAWING_STORAGE_KEY, drawingScope, validateDrawingSnapshot, saveDrawingScopes, loadDrawingScopes } from '../src/drawing-state.ts';

// Vite uses these packages' ESM `module` entry; Node otherwise chooses their UMD
// `main`. Match the application resolution for installed vendor classes in tests.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (/^lightweight-charts-line-tools-[a-z-]+$/.test(specifier)) {
    const directory = new URL(`../node_modules/${specifier}/`, import.meta.url);
    const pkg = JSON.parse(readFileSync(new URL('package.json', directory), 'utf8'));
    return { url: new URL(pkg.module, directory).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { LineToolsCorePlugin, InteractionManager, roundPriceToStep } = await import('lightweight-charts-line-tools-core');
const { LineToolHorizontalLine, LineToolTrendLine } = await import('lightweight-charts-line-tools-lines');
const { LineToolRectangle } = await import('lightweight-charts-line-tools-rectangle');
const { LineToolText } = await import('lightweight-charts-line-tools-text');
const drawingClasses = {
  ...await import('lightweight-charts-line-tools-lines'),
  ...await import('lightweight-charts-line-tools-rectangle'), ...await import('lightweight-charts-line-tools-circle'),
  ...await import('lightweight-charts-line-tools-parallel-channel'), ...await import('lightweight-charts-line-tools-fib-retracement'),
  ...await import('lightweight-charts-line-tools-freehand'), ...await import('lightweight-charts-line-tools-triangle'),
  ...await import('lightweight-charts-line-tools-path'), ...await import('lightweight-charts-line-tools-text'),
  ...await import('lightweight-charts-line-tools-price-range'), ...await import('lightweight-charts-line-tools-long-short-position'),
  ...await import('../src/drawing-tools/up-arrow.ts'),
};
const fullTypeCounts = { TrendLine:2, Ray:2, Arrow:2, ExtendedLine:2, HorizontalLine:1, HorizontalRay:1,
  VerticalLine:1, CrossLine:1, Callout:2, Rectangle:2, Circle:2, ParallelChannel:3, FibRetracement:2,
  Brush:4, Highlighter:4, Triangle:3, Path:4, Text:1, PriceRange:2, LongShortPosition:3, UpArrow:1 };

const tests = [];
const test = (name, run) => tests.push({ name, run });
const copy = value => JSON.parse(JSON.stringify(value));
const context = () => ({ appInstanceId: 'app-native', chartId: 'main', provider: 'tdx', instrument: 'SH:600000', resolution: '1D', adjustment: 'qfq', selectionGeneration: 1 });
const horizontal = (price = 10.123) => ({ type: 'HorizontalLine', points: [{ time: 1_700_000_000, price }], style: { color: '#AbC' } });
const known = new Set(Object.keys(fullTypeCounts));
const scope = 'tdx|SH:600000|qfq';
class MemoryStorage {
  values = new Map(); writes = 0; beforeWrite;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.beforeWrite?.(key, value); this.values.set(key, value); this.writes++; }
}

/** Real installed tool constructors AND core CRUD methods. Only canvas/DOM I/O
 * is replaced by a headless chart. This is not a WebView visual acceptance test. */
function nativeHarness({ actualDetach = true } = {}) {
  const primitives = [];
  const panePrimitives = [];
  const pane = { getSeries: () => [series], getHeight: () => 500,
    detachPrimitive(primitive) { const i = panePrimitives.indexOf(primitive); if (i >= 0) panePrimitives.splice(i, 1); } };
  const series = {
    options: () => ({ priceFormat: { minMove: 0.01 } }),
    priceScale: () => ({}), priceToCoordinate: price => price, coordinateToPrice: price => price,
    data: () => [], dataByIndex: () => null, getPane: () => pane,
    attachPrimitive(primitive) {
      primitives.push(primitive);
      primitive.attached?.({ chart, series, horzScaleBehavior: { key: value => value }, requestUpdate() {} });
    },
    detachPrimitive(primitive) { const i = primitives.indexOf(primitive); if (i >= 0) primitives.splice(i, 1); primitive.detached?.(); },
  };
  const chart = {
    applyOptions() {}, panes: () => [pane],
    options: () => ({ localization: {}, layout: { fontSize: 12, fontFamily: 'sans-serif' } }),
    timeScale: () => ({ timeToCoordinate: value => value, getVisibleLogicalRange: () => null,
      timeToIndex: () => null, coordinateToLogical: () => null, logicalToCoordinate: () => null,
      getVisibleRange: () => null, width: () => 800, options: () => ({}) }),
  };
  const types = new Map([['HorizontalLine', LineToolHorizontalLine], ['TrendLine', LineToolTrendLine], ['Rectangle', LineToolRectangle], ['Text', LineToolText]]);
  for (const type of Object.keys(fullTypeCounts)) types.set(type, drawingClasses[`LineTool${type}`]);
  const plugin = Object.create(LineToolsCorePlugin.prototype);
  Object.assign(plugin, {
    _tools: new Map(), _series: series, _chart: chart, _horzScaleBehavior: { key: value => value },
    _toolRegistry: { isRegistered: id => types.has(id), getToolClass: id => types.get(id) },
    _interactionManager: { detachTool: actualDetach ? InteractionManager.prototype.detachTool : tool => series.detachPrimitive(tool) },
    _priceAxisLabelStackingManager: { updateStacking() {}, registerLabel() {}, unregisterLabel() {} },
    requestUpdate() {}, getTimeFormatter: () => null, getMagnetThreshold: () => 0,
  });
  const attachments = new DrawingAttachments(series);
  return { plugin, attachments, primitives, panePrimitives, pane, series, chart, types };
}

function fixture({ storage = new MemoryStorage(), restart = false, mapTools, actualDetach = true } = {}) {
  const native = nativeHarness({ actualDetach });
  const journal = new DrawingJournalStorage(storage, known);
  const scopes = loadDrawingScopes(storage, known);
  if (restart) for (const raw of JSON.parse(scopes.get(scope) ?? '[]')) {
    native.plugin.createOrUpdateLineTool(raw.toolType, raw.points, raw.options, raw.id);
  }
  let current = context(); let ready = true; let locked = false;
  let history = new DrawingHistory(JSON.stringify(native.attachments.export()));
  let onChanged;
  const host = {
    context: () => current, scope: () => scope, ready: () => ready, locked: () => locked,
    priceStep: () => 0.01, roundPrice: roundPriceToStep, ...native, journal,
    save(snapshot) {
      const next = new Map(scopes); next.set(scope, snapshot);
      if (!saveDrawingScopes(journal, next)) throw new Error('save_failed');
      scopes.set(scope, snapshot);
    },
    captureUi: () => {
      const saved = history;
      const checkpoint = history.checkpoint();
      return () => { history = saved; history.restore(checkpoint); };
    },
    changed: () => { onChanged?.(); history.record(JSON.stringify(native.attachments.export())); },
  };
  const port = new NativeDrawingPort(host);
  const manager = new DrawingChangeManager(port, () => current);
  let tools = [...createDrawingTools(manager), ...createDrawingRecoveryTools(manager)];
  if (mapTools) tools = tools.map(mapTools);
  const registry = new CapabilityRegistry(tools);
  const core = new CapabilityCore(registry);
  const grants = Object.fromEntries(tools.map(tool => [tool.id,
    ['tf.drawings.apply_existing', 'tf.drawings.revert_saved'].includes(tool.id) ? 'ask' : 'allow']));
  const session = core.openSession({ context: current, currentContext: () => current, permissions: grants });
  let next = 0;
  const invoke = (tool, input = {}, id = `r${++next}`) => session.invoke(JSON.stringify({ protocolVersion: 1,
    requestId: id, toolId: `tf.drawings.${tool}`, input, context: current }));
  const ok = async (tool, input = {}, id) => { const reply = await invoke(tool, input, id); assert.equal(reply.status, 'ok', JSON.stringify(reply)); return reply.data; };
  const approve = async (tool, plan) => {
    const reply = await invoke(tool, { changeSetId: plan.changeSetId });
    assert.equal(reply.status, 'approval_required', JSON.stringify(reply));
    const result = await session.approve(reply.requestId); assert.equal(result.status, 'ok', JSON.stringify(result)); return result.data;
  };
  return { ...native, storage, journal, scopes, port, manager, core, session, invoke, ok, approve,
    propose: operations => ok('propose', { operations }),
    apply: plan => ok('apply', { changeSetId: plan.changeSetId }),
    revert: plan => ok('revert', { changeSetId: plan.changeSetId }),
    setContext: value => { current = value; }, setReady: value => { ready = value; }, setLocked: value => { locked = value; },
    onChanged: callback => { onChanged = callback; }, history: () => history.checkpoint(),
    manual(id, price = 12) {
      native.plugin.createOrUpdateLineTool('HorizontalLine', [{ timestamp: 1_700_000_000, price }], {
        line: { color: '#123456', width: 2 }, text: { value: '保留的手工注释', font: { bold: true, family: 'serif' } }, editable: true,
      }, id);
      port.observeManual([id]); host.save(JSON.stringify(native.attachments.export()));
    },
    saveManual: (ids = []) => { port.observeManual(ids); host.save(JSON.stringify(native.attachments.export())); },
  };
}
async function error(promise, code) { const reply = await promise; assert.equal(reply.status, 'error', JSON.stringify(reply)); assert.equal(reply.code, code); }
const update = (slot, drawing) => ({ op: 'update', id: slot.id, version: slot.version, drawing });
const remove = slot => ({ op: 'delete', id: slot.id, version: slot.version });

test('real native create rounds in preview, persists full options, and reverts', async () => {
  const f = fixture();
  const plan = await f.propose([{ op: 'create', drawing: horizontal() }]);
  assert.equal(f.plugin._tools.size, 0);
  assert.equal(plan.operations[0].after.points[0].price, 10.12);
  assert.equal(plan.operations[0].after.style.color, '#aabbcc');
  await f.apply(plan);
  assert.equal(f.plugin._tools.size, 1);
  const root = JSON.parse(f.storage.getItem(DRAWING_STORAGE_KEY));
  assert.equal(root.scopes[scope].length, 1); assert.equal(root.aiDrawingJournal.receipts.length, 1);
  assert.equal(root.aiDrawingJournal.receipts[0].state, 'applied');
  await f.revert(plan); assert.equal(f.plugin._tools.size, 0);
  assert.equal(JSON.parse(f.storage.getItem(DRAWING_STORAGE_KEY)).aiDrawingJournal.receipts[0].state, 'reverted');
  f.session.close();
});

test('real native remove_owned deletes same-session drawings after an owned update without version drift', async () => {
  const f = fixture();
  const created = await f.propose([{ op: 'create', drawing: horizontal(10) }, { op: 'create', drawing: horizontal(20) }]);
  await f.apply(created);
  let owned = await f.ok('list');
  assert.equal(owned.length, 2); assert.ok(owned.every(item => item.ownership === 'session'));
  const changed = await f.propose([update(owned[1], horizontal(25))]); await f.apply(changed);
  owned = await f.ok('list');
  const versions = new Map(owned.map(item => [item.id, item.version]));
  const reply = await f.invoke('remove_owned', { ids: owned.map(item => item.id) });
  assert.equal(reply.status, 'ok', JSON.stringify(reply));
  const removed = reply.data;
  assert.deepEqual(removed.removed, owned.map(item => item.id));
  assert.deepEqual(await f.ok('list'), []);
  for (const [id, version] of versions) assert.ok(f.journal.image(scope, id).version > version);
  f.session.close();
});

test('updating native user drawing retains hidden-to-AI text, font, axis and extra options', async () => {
  const f = fixture(); f.manual('user');
  const original = copy(f.attachments.export()[0]);
  const slot = (await f.ok('list'))[0];
  const plan = await f.propose([update(slot, horizontal(25.555))]);
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'permission_denied');
  await f.approve('apply_existing', plan);
  const changed = f.attachments.export()[0];
  assert.deepEqual(changed.options.text, original.options.text);
  assert.equal(changed.points[0].price, 25.56);
  await f.revert(plan); assert.deepEqual(f.attachments.export()[0], original); f.session.close();
});

test('delete and undo restore drawing order without destroying unrelated primitive objects', async () => {
  const f = fixture();
  const marker = { marker: true }; f.series.attachPrimitive(marker);
  f.manual('u1'); const indicator = { indicator: true }; f.series.attachPrimitive(indicator);
  f.manual('u2'); f.manual('u3');
  const original = copy(f.attachments.export());
  const originalOrder = [...f.primitives];
  const plan = await f.propose([remove((await f.ok('list'))[1])]);
  await f.approve('apply_existing', plan);
  await f.revert(plan);
  assert.deepEqual(f.attachments.export(), original);
  assert.deepEqual(f.primitives.map(item => item.id?.() ?? item), originalOrder.map(item => item.id?.() ?? item));
  assert.ok(f.primitives.includes(indicator)); assert.ok(f.primitives.includes(marker)); f.session.close();
});

test('manual edits and Undo/Redo ABA revoke object versions rather than comparing only appearance', async () => {
  const f = fixture(); f.manual('u1');
  const slot = (await f.ok('list'))[0];
  const plan = await f.propose([update(slot, horizontal(20))]);
  f.manual('u1', 15); f.manual('u1', 12);
  const waiting = await f.invoke('apply_existing', { changeSetId: plan.changeSetId });
  await error(f.session.approve(waiting.requestId), 'drawing_conflict');
  assert.equal((await f.ok('list'))[0].value.points[0].price, 12); f.session.close();
});

test('storage failure restores original native scene and does not acknowledge or persist half a batch', async () => {
  const f = fixture(); f.manual('user');
  const original = copy(f.attachments.export());
  let once = true; f.storage.beforeWrite = () => { if (once) { once = false; throw new Error('quota'); } };
  const plan = await f.propose([{ op: 'create', drawing: horizontal() }, { op: 'create', drawing: horizontal(22) }]);
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'tool_failed');
  assert.deepEqual(f.attachments.export(), original);
  const root = JSON.parse(f.storage.getItem(DRAWING_STORAGE_KEY));
  assert.deepEqual(root.scopes[scope], original); assert.equal(root.aiDrawingJournal.receipts.length, 0); f.session.close();
});

test('restart restores receipts, but prior session ownership and permission are not restored', async () => {
  const f = fixture(); const plan = await f.propose([{ op: 'create', drawing: horizontal() }]); await f.apply(plan); f.session.close();
  const next = fixture({ storage: f.storage, restart: true });
  assert.equal((await next.ok('history'))[0].changeSetId, plan.changeSetId);
  assert.equal((await next.ok('list'))[0].ownership, 'user-or-other');
  await error(next.invoke('revert', { changeSetId: plan.changeSetId }), 'changeset_unavailable');
  await next.approve('revert_saved', plan); assert.equal(next.plugin._tools.size, 0); next.session.close();
});

test('post-restart manual ABA makes a persisted undo conflict too', async () => {
  const f = fixture(); const plan = await f.propose([{ op: 'create', drawing: horizontal() }]); await f.apply(plan); f.session.close();
  const next = fixture({ storage: f.storage, restart: true });
  const id = next.attachments.export()[0].id;
  const raw = copy(next.attachments.export()[0]);
  next.manual(id, 30);
  next.plugin.createOrUpdateLineTool(raw.toolType, raw.points, raw.options, id); next.saveManual([id]);
  const waiting = await next.invoke('revert_saved', { changeSetId: plan.changeSetId });
  await error(next.session.approve(waiting.requestId), 'drawing_conflict'); assert.equal(next.plugin._tools.size, 1); next.session.close();
});

test('concurrent storage writer is never overwritten by an old application instance', async () => {
  const f = fixture(); f.manual('user');
  const plan = await f.propose([{ op: 'create', drawing: horizontal() }]);
  const different = JSON.stringify({ version: 1, scopes: {} }); f.storage.setItem(DRAWING_STORAGE_KEY, different);
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'drawing_conflict');
  assert.equal(f.storage.getItem(DRAWING_STORAGE_KEY), different); f.session.close();
});

test('undo restores a deleted object BELOW an unrelated overlay that originally followed it', async () => {
  const f = fixture(); f.manual('u1'); f.manual('u2');
  const overlay = { overlay: true }; f.series.attachPrimitive(overlay); f.manual('u3');
  const plan = await f.propose([remove((await f.ok('list'))[1])]);
  await f.approve('apply_existing', plan); await f.revert(plan);
  assert.deepEqual(f.primitives.map(item => item.id?.() ?? item), ['u1', 'u2', overlay, 'u3']); f.session.close();
});

test('restart undo inserts a formerly last drawing before unrelated drawings added after deletion', async () => {
  const f = fixture(); f.manual('u1'); f.manual('u2');
  const plan = await f.propose([remove((await f.ok('list'))[1])]);
  await f.approve('apply_existing', plan); f.manual('later'); f.session.close();
  const next = fixture({ storage: f.storage, restart: true });
  await next.approve('revert_saved', plan);
  assert.deepEqual(next.attachments.export().map(item => item.id), ['u1', 'u2', 'later']); next.session.close();
});

test('all four real native drawing types complete create/update/delete/revert cycles', async () => {
  const f = fixture();
  const p = [{ time: 1_700_000_000, price: -3.123 }, { time: 1_700_000_060, price: 2.345 }];
  for (const drawing of [horizontal(), { type: 'TrendLine', points: p, style: {} },
    { type: 'Rectangle', points: p, style: { fill: '#12345633' } },
    { type: 'Text', points: p.slice(0, 1), style: { text: '<script>中文</script>', fontSize: 18 } }]) {
    const plan = await f.propose([{ op: 'create', drawing }]); await f.apply(plan);
    assert.equal(f.attachments.export()[0].toolType, drawing.type);
    await f.revert(plan); assert.equal(f.attachments.export().length, 0);
  }
  f.session.close();
});

test('native interactive fractional timestamps remain readable without changing their coordinates', async () => {
  const f = fixture(); f.manual('u');
  f.plugin.createOrUpdateLineTool('HorizontalLine', [{ timestamp: 1_700_000_000.5, price: 12 }], {}, 'u'); f.saveManual(['u']);
  const list = await f.ok('list');
  assert.equal(list.length, 1); assert.equal(list[0].value.points[0].time, 1_700_000_000.5); f.session.close();
});

test('native creation swallowed by vendor code rolls back the whole batch', async () => {
  const f = fixture(); f.manual('u'); const original = copy(f.attachments.export());
  const factory = f.plugin._createAndAddTool.bind(f.plugin); let called = 0;
  f.plugin._createAndAddTool = (...args) => { if (++called === 2) throw new Error('deliberate native failure'); return factory(...args); };
  const plan = await f.propose([{ op: 'create', drawing: horizontal() }, { op: 'create', drawing: horizontal(30) }]);
  const logs = []; const stderr = console.error; console.error = value => logs.push(String(value));
  try { await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'drawing_host_failed'); }
  finally { console.error = stderr; }
  assert.ok(logs.some(value => value.includes('deliberate native failure')));
  assert.deepEqual(f.attachments.export(), original); assert.equal((await f.ok('history')).length, 0); f.session.close();
});

test('partly mutated native update that throws restores the FULL original object', async () => {
  const f = fixture(); f.manual('u');
  const original = copy(f.attachments.export()[0]); const slot = (await f.ok('list'))[0];
  const tool = f.attachments.drawing('u'); const apply = tool.applyOptions.bind(tool); let once = true;
  tool.applyOptions = options => { apply(options); if (once) { once = false; throw new Error('after mutation'); } };
  const plan = await f.propose([update(slot, horizontal(35))]);
  const waiting = await f.invoke('apply_existing', { changeSetId: plan.changeSetId });
  await error(f.session.approve(waiting.requestId), 'tool_failed');
  assert.deepEqual(f.attachments.export()[0], original); f.session.close();
});

test('failed undo remains retryable with renewed persisted object versions', async () => {
  const f = fixture(); f.manual('u'); const original = copy(f.attachments.export()[0]);
  const plan = await f.propose([update((await f.ok('list'))[0], horizontal(40))]); await f.approve('apply_existing', plan);
  const changed = copy(f.attachments.export()[0]); let once = true;
  f.storage.beforeWrite = () => { if (once) { once = false; throw new Error('quota'); } };
  await error(f.invoke('revert', { changeSetId: plan.changeSetId }), 'tool_failed');
  assert.deepEqual(f.attachments.export()[0], changed); assert.equal((await f.ok('history'))[0].state, 'applied');
  await f.revert(plan); assert.deepEqual(f.attachments.export()[0], original); f.session.close();
});

test('undo after failed-undo rollback also survives an application restart', async () => {
  const f = fixture(); const plan = await f.propose([{ op: 'create', drawing: horizontal() }]); await f.apply(plan);
  let once = true; f.storage.beforeWrite = () => { if (once) { once = false; throw Error('quota'); } };
  await error(f.invoke('revert', { changeSetId: plan.changeSetId }), 'tool_failed'); f.session.close();
  const next = fixture({ storage: f.storage, restart: true });
  await next.approve('revert_saved', plan); assert.equal(next.plugin._tools.size, 0); next.session.close();
});

test('cancelling during the native flush rolls back before returning cancelled', async () => {
  const f = fixture(); f.manual('u'); const original = copy(f.attachments.export());
  const plan = await f.propose([{ op: 'create', drawing: horizontal() }]);
  f.onChanged(() => f.session.cancel('cancel-native'));
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }, 'cancel-native'), 'cancelled');
  assert.deepEqual(f.attachments.export(), original); assert.equal((await f.ok('history')).length, 0); f.session.close();
});

test('persistent rollback failure is explicit and disables further mutations', async () => {
  const f = fixture(); f.manual('u'); const plan = await f.propose([{ op: 'create', drawing: horizontal() }]);
  f.storage.beforeWrite = () => { throw new Error('persistent quota'); };
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'rollback_failed');
  assert.equal(f.manager.poisoned, true); assert.equal(f.plugin._tools.size, 1);
  await error(f.invoke('propose', { operations: [{ op: 'create', drawing: horizontal() }] }), 'drawing_host_failed'); f.session.close();
});

test('invalid output is rejected before any native write or persistent record', async () => {
  const f = fixture({ mapTools: tool => tool.id === 'tf.drawings.apply' ? { ...tool, outputSchema: { type: 'null' } } : tool });
  const plan = await f.propose([{ op: 'create', drawing: horizontal() }]);
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'invalid_output');
  assert.equal(f.plugin._tools.size, 0); assert.equal(f.storage.writes, 0); f.session.close();
});

test('lock/loading changes while approval is pending prevent writes', async () => {
  for (const mode of ['locked', 'loading']) {
    const f = fixture(); f.manual('u');
    const plan = await f.propose([update((await f.ok('list'))[0], horizontal(50))]);
    const waiting = await f.invoke('apply_existing', { changeSetId: plan.changeSetId });
    if (mode === 'locked') f.setLocked(true); else f.setReady(false);
    await error(f.session.approve(waiting.requestId), mode === 'locked' ? 'permission_denied' : 'data_not_ready');
    assert.equal(f.attachments.export()[0].points[0].price, 12); f.session.close();
  }
});

test('closing a bridge cancels pending approval and does not resurrect grants on a new session', async () => {
  const f = fixture();
  const bridge = new ChartReadBridge({ currentContext: context, readState: () => { throw new Error('not read'); }, drawings: f.port });
  const session = bridge.openSession({ 'tf.drawings.propose': 'allow', 'tf.drawings.apply': 'ask' });
  const call = (toolId, input, requestId) => session.invoke(JSON.stringify({ protocolVersion: 1, requestId, toolId, context: context(), input }));
  const plan = await call('tf.drawings.propose', { operations: [{ op: 'create', drawing: horizontal() }] }, 'p');
  assert.equal((await call('tf.drawings.apply', { changeSetId: plan.data.changeSetId }, 'a')).status, 'approval_required');
  bridge.close(); await error(session.approve('a'), 'session_closed'); assert.equal(f.plugin._tools.size, 0); f.session.close();
});

test('unsupported existing native tools are preserved and counted, never converted or deleted', async () => {
  const f = fixture();
  class UnknownTool extends LineToolHorizontalLine {
    constructor(...args) { super(...args); this.toolType = 'UnmappedNative'; }
  }
  known.add('UnmappedNative'); f.types.set('UnmappedNative', UnknownTool);
  f.plugin.createOrUpdateLineTool('UnmappedNative', [{ timestamp: 1_700_000_000, price: 8 }], {}, 'other'); f.saveManual();
  const original = copy(f.attachments.export()[0]); const handle = f.attachments.drawing('other');
  const plan = await f.propose([{ op: 'create', drawing: horizontal() }]); await f.apply(plan); await f.revert(plan);
  assert.equal((await f.ok('list')).length, 0); assert.equal(f.port.count(), 1);
  assert.deepEqual(f.attachments.export()[0], original); assert.equal(f.attachments.drawing('other'), handle); f.session.close();
});

test('manual freehand-sized native records are not constrained by the AI per-object limit', () => {
  const storage = new MemoryStorage(); const journal = new DrawingJournalStorage(storage, known);
  const raw = { id: 'large-manual', toolType: 'TrendLine', points: Array.from({ length: 5000 }, (_, i) => ({ timestamp: i, price: i })), options: {} };
  const scopes = new Map([[scope, JSON.stringify([raw])]]);
  assert.equal(saveDrawingScopes(journal, scopes), true); raw.points[0].price = -1; scopes.set(scope, JSON.stringify([raw]));
  assert.equal(saveDrawingScopes(journal, scopes), true);
  assert.equal(loadDrawingScopes(storage, known).size, 1);
});

test('normal manual saves preserve other scopes and receipts in the same atomic value', async () => {
  const f = fixture(); const plan = await f.propose([{ op: 'create', drawing: horizontal() }]); await f.apply(plan);
  const otherScope = 'tdx|SZ:000001|none'; f.scopes.set(otherScope, '[]'); f.manual('u');
  const root = JSON.parse(f.storage.getItem(DRAWING_STORAGE_KEY));
  assert.deepEqual(root.scopes[otherScope], []); assert.equal(root.aiDrawingJournal.receipts[0].id, plan.changeSetId); f.session.close();
});

test('corrupted receipt metadata is rejected without writing or interpreting it', async () => {
  const f = fixture(); const plan = await f.propose([{ op: 'create', drawing: horizontal() }]); await f.apply(plan); f.session.close();
  const root = JSON.parse(f.storage.getItem(DRAWING_STORAGE_KEY));
  for (const corrupt of [r => { r.aiDrawingJournal.version = 999; }, r => { r.aiDrawingJournal.slots[0].version = -1; },
    r => { r.aiDrawingJournal.receipts[0].after[0].id = 'wrong'; },
    r => { r.aiDrawingJournal.receipts[0].context = { approved: true }; },
    r => { r.aiDrawingJournal.receipts[0].scope = 'tdx|SZ:000001|none'; }]) {
    const bad = copy(root); corrupt(bad); const text = JSON.stringify(bad); const storage = new MemoryStorage();
    storage.setItem(DRAWING_STORAGE_KEY, text);
    const journal = new DrawingJournalStorage(storage, known);
    assert.throws(() => journal.assertCurrent(), /drawing_host_failed/);
    assert.equal(storage.getItem(DRAWING_STORAGE_KEY), text);
  }
});

test('failed commit UI checkpoint preserves the user Undo and Redo stacks', () => {
  const history = new DrawingHistory('[]'); history.record('[1]'); history.record('[2]'); history.undo();
  const saved = history.checkpoint(); history.record('[ai]'); history.restore(saved);
  assert.equal(history.canRedo, true); assert.equal(history.redo(), '[2]');
  assert.equal(history.undo(), '[1]'); assert.equal(history.undo(), '[]');
  assert.throws(() => history.restore({ past: [], future: [] }));
});

test('a primitive reattachment exception cannot lose unrelated drawings during rollback', async () => {
  const f = fixture(); f.manual('u1'); f.manual('u2');
  const overlay = { overlay: true, attached() {}, detached() {} }; f.series.attachPrimitive(overlay); f.manual('u3');
  const plan = await f.propose([remove((await f.ok('list'))[1])]); await f.approve('apply_existing', plan);
  const before = copy(f.attachments.export());
  let once = true; overlay.attached = () => { if (once) { once = false; throw Error('reattach failed'); } };
  await error(f.invoke('revert', { changeSetId: plan.changeSetId }), 'tool_failed');
  assert.deepEqual(f.attachments.export(), before);
  assert.deepEqual(f.primitives.map(item => item.id?.() ?? item), ['u1', overlay, 'u3']);
  await f.revert(plan); assert.deepEqual(f.attachments.export().map(item => item.id), ['u1', 'u2', 'u3']); f.session.close();
});

for (const [type, count] of Object.entries(fullTypeCounts)) test(`all-native ${type}: create, edit, hide, delete and exact native undo`, async () => {
  const f=fixture(); f.manual('unrelated');
  const drawing={type,points:Array.from({length:count},(_,i)=>({time:1700000000+i*86400,price:[10,12,9,11][i]})),style:
    type==='Text'||type==='Callout'?{text:'标注'}:type==='FibRetracement'?{levels:[{coeff:0,color:'#112233'},{coeff:0.618,color:'#334455'},{coeff:1,color:'#556677'}]}:{}};
  const creation=await f.propose([{op:'create',drawing}]);await f.apply(creation);
  const slot=(await f.ok('list')).find(row=>row.id!=='unrelated');assert.equal(slot.value.type,type);
  const before=copy(f.attachments.export());
  const edit=await f.propose([update(slot,{...slot.value,points:slot.value.points.map(p=>({...p,price:p.price+0.5})),style:{...slot.value.style,visible:false}})]);
  await f.apply(edit);assert.equal(f.attachments.export().find(row=>row.id===slot.id).options.visible,false);
  await f.revert(edit);assert.deepEqual(f.attachments.export(),before);
  const removal=await f.propose([remove((await f.ok('list')).find(row=>row.id===slot.id))]);await f.apply(removal);assert.equal(f.attachments.export().length,1);
  await f.revert(removal);assert.deepEqual(f.attachments.export(),before);
  // Old receipt versions stay stale even when later edits were undone (ABA protection).
  await error(f.invoke('revert',{changeSetId:creation.changeSetId}),'drawing_conflict');
  const fresh=await f.propose([{op:'create',drawing}]);await f.apply(fresh);await f.revert(fresh);
  assert.deepEqual(f.attachments.export(),before);f.session.close();
});
test('all native type descriptions match the actual registered classes; variable point bounds are explicit',async()=>{
  const f=fixture();const types=await f.ok('types');assert.deepEqual(types.map(t=>t.type).sort(),Object.keys(fullTypeCounts).sort());
  for(const type of ['Brush','Highlighter','Path']){const t=types.find(t=>t.type===type);assert.equal(t.points,2);assert.equal(t.maxPoints,64);}
  f.session.close();
});

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
function mainSection(start, end) {
  const from = mainSource.indexOf(start), to = mainSource.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing main section ${start}`);
  return stripTypeScriptTypes(mainSource.slice(from, to).replaceAll('export function ', 'function '));
}
function mainHarness(storage = new MemoryStorage()) {
  const native = nativeHarness();
  const scopes = mainSection('function currentDrawingScope()', '\nfunction currentMarkerScope(');
  const saves = mainSection('function persistDrawingSnapshot(', '\nfunction restoreDrawingScope(');
  const ports = mainSection('function getAiDrawingPort()', '\nfunction replaceHistorySeries(');
  const undo = mainSection("undoDrawing.addEventListener('click'", '\ndrawingManagerToggle.addEventListener(');
  return new Function('native', 'storage', 'known', 'deps', `
    const { DrawingHistory, drawingScope, validateDrawingSnapshot, saveDrawingScopes, loadDrawingScopes,
      DrawingJournalStorage, NativeDrawingPort, ChartReadBridge, roundPriceToStep, UserDataManager, createUserDataNative, createUserDataTools,
      UserTaskManager, UserTaskLibrary, IndexedDbTaskStore, createTaskDataHost, createUserTaskTools, createSavedTaskTool, createNativeMarketQueryPort } = deps;
    const lineTools = native.plugin, drawingAttachments = native.attachments, candleSeries = native.series;
    const localStorage = storage, knownDrawingTypes = known, aiChartAppInstanceId = 'main-harness';
    let currentSymbol = { providerId: 'tdx', symbol: 'SH:600000' }, currentResolution = '1D', currentAdjustment = 'qfq';
    let currentSeriesKind = 'ohlcv', generation = 1, aiDisplayedHistoryGeneration = 1, aiChartDataRevision = 1;
    const currentBars = [1, 2, 3].map(n => ({ time: 1700000000 + n * 60, open: n, high: n + 1, low: n - 1, close: n, volume: n * 10 }));
    const historyRequestGate = { current: () => generation }, exchangeTimeZone = () => 'Asia/Shanghai', activeTradingTimeZone = () => 'UTC';
    let aiChartReadBridge, aiChartWorkbenchBridge, aiNativeDrawingPort, userDataManager, userTaskManager, userTaskLibrary, aiDrawingPointerDown = false;
    const invoke = () => { throw Error('drawing-only harness must not issue native data requests'); };
    // This harness isolates chart transactions; workspace ports have their own actual-main tests.
    const createAiWorkspaceReadTools = () => [], createAiWorkspaceActionTools = () => [], createAiChartActionTools = () => [], createAiIndicatorLibraryTools = () => [];
    const createAiMarketQueryHost = () => ({}), createAiHelpTools = () => [];
    class MarketResultStore { constructor(_host) {} }
    const aiResultFilePort = {}, createResultFileTools = () => [];
    let mcpInvalidations = 0;
    const aiMcpController = { invalidate() { mcpInvalidations++; } }, aiApiController = { invalidate() {} };
    let drawingsLocked = false, drawingsInitialized = true, restoringDrawings = false, activeDrawingId = null;
    const drawingJournalStorage = new DrawingJournalStorage(localStorage, knownDrawingTypes);
    const drawingScopes = loadDrawingScopes(localStorage, knownDrawingTypes);
    let drawingHistory = new DrawingHistory('[]');
    const errorLayer = { hidden: true, textContent: '' };
    const undoDrawing = { addEventListener(_name, handler) { this.click = handler; } };
    const redoDrawing = { addEventListener(_name, handler) { this.click = handler; } };
    let failRender = false;
    function renderDrawingManager() { if (failRender) { failRender = false; throw Error('render failure'); } updateDrawingHistoryButtons(); }
    const hideDrawingProperties = () => {};
    ${scopes}
    ${saves}
    ${ports}
    ${undo}
    return {
      open: openAiChartSession, context: readCurrentAiChartSelection, snapshot: currentDrawingSnapshot,
      mcpInvalidations: () => mcpInvalidations,
      manual: commitDrawingState, save: persistDrawingSnapshot, undo: () => undoDrawing.click(), redo: () => redoDrawing.click(),
      history: () => drawingHistory.checkpoint(), error: errorLayer,
      blockGesture(value) { aiDrawingPointerDown = value; }, blockCreation(value) { activeDrawingId = value ? 'drawing-in-progress' : null; },
      failRender() { failRender = true; },
      changeSelection() { invalidateAiChartSessions(); generation++; },
      close() { invalidateAiChartSessions(); }, native, storage,
    };
  `)(native, storage, known, { UserDataManager, createUserDataNative, createUserDataTools, UserTaskManager, UserTaskLibrary, IndexedDbTaskStore,
    createTaskDataHost, createUserTaskTools, createSavedTaskTool, createNativeMarketQueryPort, DrawingHistory, drawingScope, validateDrawingSnapshot, saveDrawingScopes, loadDrawingScopes,
    DrawingJournalStorage, NativeDrawingPort, ChartReadBridge, roundPriceToStep });
}

test('actual main.ts reads data, computes a level, proposes, draws and undoes via one authorized session', async () => {
  const host = mainHarness();
  const session = host.open(Object.fromEntries(['tf.chart.snapshot', 'tf.compute.summary', 'tf.drawings.propose', 'tf.drawings.apply', 'tf.drawings.revert', 'tf.drawings.list'].map(id => [id, 'allow'])));
  let sequence = 0;
  const call = async (toolId, input = {}) => {
    const reply = await session.invoke(JSON.stringify({ protocolVersion: 1, requestId: `main-${++sequence}`, context: host.context(), toolId, input }));
    assert.equal(reply.status, 'ok', JSON.stringify(reply)); return reply.data;
  };
  const snapshot = await call('tf.chart.snapshot');
  const summary = await call('tf.compute.summary', { snapshotId: snapshot.snapshotId, field: 'close' });
  assert.equal(summary.mean, 2);
  const plan = await call('tf.drawings.propose', { operations: [{ op: 'create', drawing: horizontal(summary.mean) }] });
  assert.equal(JSON.parse(host.snapshot()).length, 0);
  await call('tf.drawings.apply', { changeSetId: plan.changeSetId });
  assert.equal(JSON.parse(host.snapshot())[0].points[0].price, 2);
  assert.equal(host.history().past.length, 2);
  await call('tf.drawings.revert', { changeSetId: plan.changeSetId }); assert.equal(host.snapshot(), '[]'); host.close();
});

test('actual main.ts manual Undo/Redo invalidates old AI object versions without deleting receipts', async () => {
  const host = mainHarness(); const session = host.open({ 'tf.drawings.propose': 'allow', 'tf.drawings.apply': 'allow', 'tf.drawings.revert': 'allow' });
  const call = (name, input, requestId) => session.invoke(JSON.stringify({ protocolVersion: 1, requestId, context: host.context(), toolId: `tf.drawings.${name}`, input }));
  const proposal = await call('propose', { operations: [{ op: 'create', drawing: horizontal() }] }, 'p');
  const id = proposal.data.changeSetId; assert.equal((await call('apply', { changeSetId: id }, 'a')).status, 'ok');
  host.undo(); assert.equal(host.snapshot(), '[]'); host.redo(); assert.equal(JSON.parse(host.snapshot()).length, 1);
  await error(call('revert', { changeSetId: id }, 'r'), 'drawing_conflict');
  assert.equal(JSON.parse(host.storage.getItem(DRAWING_STORAGE_KEY)).aiDrawingJournal.receipts.length, 1); host.close();
});

test('actual main.ts rollback restores both prior Undo and Redo after a late renderer exception', async () => {
  const host = mainHarness();
  host.native.plugin.createOrUpdateLineTool('HorizontalLine', [{ timestamp: 1700000000, price: 4 }], {}, 'manual'); host.manual('manual');
  host.native.plugin.createOrUpdateLineTool('HorizontalLine', [{ timestamp: 1700000000, price: 5 }], {}, 'manual'); host.manual('manual'); host.undo();
  const savedHistory = host.history(), scene = host.snapshot();
  const session = host.open({ 'tf.drawings.propose': 'allow', 'tf.drawings.apply': 'allow' });
  const call = (name, input, requestId) => session.invoke(JSON.stringify({ protocolVersion: 1, requestId, context: host.context(), toolId: `tf.drawings.${name}`, input }));
  const plan = await call('propose', { operations: [{ op: 'create', drawing: horizontal() }] }, 'p');
  host.failRender(); await error(call('apply', { changeSetId: plan.data.changeSetId }, 'a'), 'tool_failed');
  assert.equal(host.snapshot(), scene); assert.deepEqual(host.history(), savedHistory); host.redo();
  assert.equal(JSON.parse(host.snapshot())[0].points[0].price, 5); host.close();
});

test('actual main.ts refuses writes during pointer gestures, incomplete drawing and selection replacement', async () => {
  for (const block of ['blockGesture', 'blockCreation', 'changeSelection']) {
    const host = mainHarness(); const session = host.open({ 'tf.drawings.propose': 'allow', 'tf.drawings.apply': 'allow' });
    const body = (toolId, input, requestId) => JSON.stringify({ protocolVersion: 1, requestId, context: host.context(), toolId, input });
    const plan = await session.invoke(body('tf.drawings.propose', { operations: [{ op: 'create', drawing: horizontal() }] }, 'p'));
    host[block](true);
    await error(session.invoke(body('tf.drawings.apply', { changeSetId: plan.data.changeSetId }, 'a')), block === 'changeSelection' ? 'context_stale' : 'data_not_ready');
    assert.equal(host.snapshot(), '[]'); host.close();
  }
});

test('main integration observes before markers, hooks manual edits and never starts a model/session automatically', () => {
  assert.ok(mainSource.indexOf('new DrawingAttachments(candleSeries)') < mainSource.indexOf('candles: createSeriesMarkers'));
  assert.match(mainSource, /commitDrawingState\(selectedLineTool.id\)/);
  assert.match(mainSource, /invalidateAiChartSessions\(\);\s+const generation = historyRequestGate.begin\(\)/);
  assert.equal((mainSource.match(/openAiChartSession\(/g) ?? []).length, 1);
  assert.doesNotMatch(mainSource, /(?:globalThis|window)\.\w+\s*=\s*(?:aiNativeDrawingPort|openAiChartSession)/);
  const nativeSource = readFileSync(new URL('../src/ai-capabilities/drawing-native.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(nativeSource, /\._tools\b|removeAllLineTools|importLineTools|\beval\(/);
});

test('a 32-operation batch over 468 existing objects does not repeatedly copy the entire drawing document', async () => {
  const f = fixture();
  for (let i = 0; i < 468; i++) f.plugin.createOrUpdateLineTool('HorizontalLine', [{ timestamp: 1700000000, price: i }], {}, `manual-${i}`);
  f.saveManual();
  const original = f.attachments.export.bind(f.attachments); let exports = 0;
  f.attachments.export = () => { exports++; return original(); };
  const start = performance.now();
  const plan = await f.propose(Array.from({ length: 32 }, (_, i) => ({ op: 'create', drawing: horizontal(i) })));
  await f.apply(plan);
  const elapsed = performance.now() - start;
  console.log(`Native 468+32 drawing batch: ${elapsed.toFixed(2)}ms; whole-document reads=${exports}`);
  assert.equal(f.plugin._tools.size, 500); assert.ok(exports <= 12, 'use per-object native readback, not O(batch * document) full copies');
  f.session.close();
});

test('an accepted identical native update advances its CAS version just like every other write', async () => {
  const f = fixture(); const first = await f.propose([{ op: 'create', drawing: horizontal() }]); await f.apply(first);
  const slot = (await f.ok('list'))[0]; const plan = await f.propose([update(slot, slot.value)]);
  await f.apply(plan);
  assert.ok((await f.ok('list'))[0].version > slot.version);
  await f.revert(plan); f.session.close();
});

test('actual vendor InteractionManager must detach series drawings, not only pane primitives', async () => {
  const f = fixture({ actualDetach: true });
  const paneOnly = {}; f.panePrimitives.push(paneOnly);
  const marker = {}; f.series.attachPrimitive(marker);
  const plan = await f.propose([{ op: 'create', drawing: horizontal() }]);
  await f.ok('apply', { changeSetId: plan.changeSetId });
  await f.ok('revert', { changeSetId: plan.changeSetId });
  assert.deepEqual(f.primitives, [marker], 'remove only series-owned drawings, not marker overlays');
  assert.equal(f.attachments.export().length, 0, 'destroyed drawing remains in ownership roster');
  f.pane.detachPrimitive(paneOnly);
  assert.equal(f.panePrimitives.length, 0, 'ordinary pane removal must still delegate normally');
  f.session.close();
});

let failures = 0;
for (const { name, run } of tests) {
  try { await run(); } catch (failure) { failures++; console.error(`FAIL ${name}\n${failure.stack}`); }
}
if (failures) throw new Error(`AI native drawings: ${failures}/${tests.length} scenarios failed`);
console.log(`AI native drawings: ${tests.length} scenarios passed (installed native classes; headless chart)`);
