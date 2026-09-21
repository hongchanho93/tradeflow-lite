import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CapabilityCore, CapabilityRegistry } from '../src/ai-capabilities/index.ts';
import { DrawingChangeManager } from '../src/ai-capabilities/drawing-changes.ts';
import { DrawingTypeRegistry, DEFAULT_DRAWING_TYPES, DRAWING_LIMITS } from '../src/ai-capabilities/drawing-contract.ts';
import { createDrawingTools } from '../src/ai-capabilities/drawing-tools.ts';
import { LineToolsCorePlugin } from '../node_modules/lightweight-charts-line-tools-core/dist/lightweight-charts-line-tools-core.js';

const tests = [];
const test = (name, run) => tests.push({ name, run });
const selection = () => ({
  appInstanceId: 'app-1', chartId: 'main', provider: 'tdx', instrument: 'SH:600000',
  resolution: '1D', adjustment: 'qfq', selectionGeneration: 1,
});
const horizontal = (price = 10) => ({ type: 'HorizontalLine', points: [{ time: 1_700_000_000, price }], style: { color: '#123456' } });
const create = drawing => ({ op: 'create', drawing });
const update = (id, version, drawing) => ({ op: 'update', id, version, drawing });
const remove = (id, version) => ({ op: 'delete', id, version });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

/** Reference port only, not a substitute for real line-tools/WebView acceptance. */
class DocumentPort {
  slots = new Map();
  version = 0;
  calls = 0;
  flushes = 0;
  saved = [];
  beforeWrite;
  afterWrite;
  onFlush;
  read(id) { return this.slots.get(id) ?? { id, version: 0, value: null }; }
  list() { return [...this.slots.values()].filter(slot => slot.value !== null); }
  write(id, version, value) {
    this.calls++;
    this.beforeWrite?.(id, version, value);
    assert.equal(this.read(id).version, version, 'reference adapter enforces CAS');
    this.slots.set(id, { id, version: ++this.version, value: structuredClone(value) });
    this.afterWrite?.(id, version, value);
  }
  flush() { this.flushes++; this.onFlush?.(); this.saved = this.content(); }
  manual(id, value) {
    this.slots.set(id, { id, version: ++this.version, value: structuredClone(value) });
    this.saved = this.content();
  }
  content() { return this.list().map(({ id, value }) => ({ id, value })).sort((a, b) => a.id.localeCompare(b.id)); }
}

class Clock {
  time = 0;
  next = 0;
  timers = new Map();
  now() { return this.time; }
  setTimer(callback, delay) { const id = ++this.next; this.timers.set(id, { callback, at: this.time + delay }); return id; }
  clearTimer(id) { this.timers.delete(id); }
  advance(ms) {
    this.time += ms;
    for (const [id, timer] of [...this.timers]) if (timer.at <= this.time) { this.timers.delete(id); timer.callback(); }
  }
}

function fixture(options = {}) {
  const port = new DocumentPort();
  let current = selection();
  const clock = new Clock();
  const manager = new DrawingChangeManager(port, () => current, { now: () => clock.now(), types: options.types });
  let tools = createDrawingTools(manager);
  if (options.mapTools) tools = tools.map(options.mapTools);
  const registry = new CapabilityRegistry(tools);
  const core = new CapabilityCore(registry, { clock, limits: options.limits });
  const grants = Object.fromEntries(tools.map(tool => [tool.id, tool.id === 'tf.drawings.apply_existing' ? 'ask' : 'allow']));
  const open = (permissions = grants) => core.openSession({ context: current, currentContext: () => current, permissions });
  const session = open();
  let nextId = 0;
  const body = (tool, input = {}, requestId = `r${++nextId}`, context = selection()) => JSON.stringify({
    protocolVersion: 1, requestId, toolId: `tf.drawings.${tool}`, context, input,
  });
  const invoke = (tool, input, requestId) => session.invoke(body(tool, input, requestId));
  const invokeAt = (tool, input, context, requestId) => session.invoke(body(tool, input, requestId, context));
  const ok = async (tool, input, requestId) => {
    const reply = await invoke(tool, input, requestId);
    assert.equal(reply.status, 'ok', JSON.stringify(reply));
    return reply.data;
  };
  return {
    port, clock, manager, core, registry, session, open, body, invoke, invokeAt, ok,
    setSelection: value => { current = value; },
    propose: operations => ok('propose', { operations }),
    apply: plan => ok('apply', { changeSetId: plan.changeSetId }),
    revert: plan => ok('revert', { changeSetId: plan.changeSetId }),
  };
}
async function error(promise, code) { const result = await promise; assert.equal(result.status, 'error'); assert.equal(result.code, code); return result; }
async function applyExisting(f, plan) {
  const waiting = await f.invoke('apply_existing', { changeSetId: plan.changeSetId });
  assert.equal(waiting.status, 'approval_required');
  assert.equal((await f.session.approve(waiting.requestId)).status, 'ok');
}

test('actual installed plugin swallows a create exception; return value is not success evidence', () => {
  const errors = [];
  const original = console.error;
  console.error = message => errors.push(message);
  try {
    const returned = LineToolsCorePlugin.prototype.createOrUpdateLineTool.call({
      _tools: new Map(), _createAndAddTool() { throw new Error('controlled native creation failure'); },
    }, 'TrendLine', [], {}, 'test');
    assert.equal(returned, undefined);
    assert.deepEqual(errors, ['controlled native creation failure']);
  } finally { console.error = original; }
});

test('discovery is serializable and never exposes executable preparation/commit callbacks', () => {
  const f = fixture();
  const descriptors = f.registry.describe();
  assert.equal(descriptors.length, 7);
  for (const item of descriptors) { assert.equal(item.run, undefined); assert.equal(item.prepare, undefined); }
  assert.ok(JSON.stringify(descriptors).includes('tf.drawings.apply_existing'));
  f.session.close();
});

test('new trusted drawing types require no extra model-specific tool', async () => {
  const types = new DrawingTypeRegistry([...DEFAULT_DRAWING_TYPES, { type: 'CustomTriangle', points: 3,
    styleSchema: { type: 'object', properties: {}, additionalProperties: false } }]);
  const f = fixture({ types });
  assert.equal((await f.ok('types')).length, DEFAULT_DRAWING_TYPES.length + 1);
  const plan = await f.propose([create({ type: 'CustomTriangle', points: [0, 1, 2].map(time => ({ time, price: time })), style: {} })]);
  await f.apply(plan); assert.equal(f.port.list().length, 1); f.session.close();
});

test('all four reference types validate; negative adjusted prices and plain text remain usable', async () => {
  const f = fixture();
  const p = horizontal(-12).points;
  const plan = await f.propose([
    create(horizontal(-12)), create({ type: 'TrendLine', points: [p[0], { time: p[0].time + 60, price: -10 }], style: {} }),
    create({ type: 'Rectangle', points: [p[0], { time: p[0].time + 60, price: -10 }], style: { fill: '#abcdef22' } }),
    create({ type: 'Text', points: p, style: { text: '<img src=x onerror=evil()> 中文', fontSize: 12 } }),
  ]);
  assert.equal(f.port.calls, 0, 'preview must not write');
  await f.apply(plan); assert.equal(f.port.list().length, 4); await f.revert(plan);
  assert.deepEqual(f.port.content(), []); f.session.close();
});

test('proposal is frozen, non-mutating and cannot spoof IDs/ownership/system fields', async () => {
  const f = fixture();
  const plan = await f.propose([create(horizontal())]);
  assert.ok(Object.isFrozen(plan.operations[0].after.style));
  assert.throws(() => { plan.operations[0].after.style.color = '#fff'; });
  for (const extra of [{ id: 'manual' }, { owner: 'user' }, { approved: true }, { path: 'src/main.ts' }]) {
    await error(f.invoke('propose', { operations: [{ ...create(horizontal()), ...extra }] }), 'invalid_request');
  }
  assert.equal(f.port.calls, 0); f.session.close();
});

test('invalid shapes, colors, text, counts, prices and unexpected fields reject entire proposal', async () => {
  const f = fixture();
  for (const drawing of [
    { ...horizontal(), type: 'Shell' }, { ...horizontal(), points: [] }, { ...horizontal(), style: { fill: '#abc' } },
    { ...horizontal(), style: { color: 'url(secret)' } }, { ...horizontal(), style: { text: 'wrong type' } },
    { ...horizontal(), style: { lineWidth: 65 } }, { ...horizontal(), arbitrary: 'x' },
    { type: 'Text', points: horizontal().points, style: {} },
    { type: 'Text', points: horizontal().points, style: { text: 'a'.repeat(2049) } },
    { ...horizontal(), points: [{ time: -0.5, price: 1 }] },
  ]) await error(f.invoke('propose', { operations: [create(horizontal()), create(drawing)] }), 'invalid_request');
  assert.equal(f.manager.retainedChanges, 0); assert.equal(f.port.calls, 0); f.session.close();
});

test('empty/oversized batches and duplicate update targets are rejected', async () => {
  const f = fixture(); f.port.manual('u', horizontal());
  for (const operations of [[], Array.from({ length: 33 }, () => create(horizontal())),
    [update('u', 1, horizontal(2)), remove('u', 1)]]) {
    await error(f.invoke('propose', { operations }), 'invalid_request');
  }
  assert.equal(f.port.calls, 0); f.session.close();
});

test('unregistered/ordinary write callbacks stay closed even when allow is granted', async () => {
  let called = 0;
  const f = fixture({ mapTools: tool => tool.id === 'tf.drawings.apply' ? { ...tool, prepare: undefined, run: () => ++called } : tool });
  await error(f.invoke('apply', { changeSetId: 'x' }), 'write_requires_changeset');
  assert.equal(called, 0); f.session.close();
});

test('apply creates only proposed objects and dedicated undo preserves later unrelated manual additions', async () => {
  const f = fixture(); f.port.manual('old-user', horizontal(5));
  const plan = await f.propose([create(horizontal(10)), create(horizontal(20))]);
  await f.apply(plan);
  f.port.manual('new-user', horizontal(30));
  await f.revert(plan);
  assert.deepEqual(f.port.content().map(item => item.id), ['new-user', 'old-user']);
  assert.deepEqual(f.port.saved, f.port.content()); f.session.close();
});

test('same request and different request IDs cannot apply or revert the same batch twice', async () => {
  const f = fixture(); const plan = await f.propose([create(horizontal())]);
  await f.ok('apply', { changeSetId: plan.changeSetId }, 'apply-once');
  const calls = f.port.calls;
  await f.ok('apply', { changeSetId: plan.changeSetId }, 'apply-once'); await f.apply(plan);
  assert.equal(f.port.calls, calls);
  await f.revert(plan); const undone = f.port.calls; await f.revert(plan); assert.equal(f.port.calls, undone);
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'changeset_state'); f.session.close();
});

test('a session can update and delete its unchanged AI objects without per-step approval', async () => {
  const f = fixture(); const first = await f.propose([create(horizontal())]); await f.apply(first);
  const [object] = await f.ok('list'); assert.equal(object.ownership, 'session');
  const change = await f.propose([update(object.id, object.version, horizontal(20))]);
  assert.equal(change.requiresExistingPermission, false); await f.apply(change);
  const row = f.port.read(object.id);
  const deletion = await f.propose([remove(row.id, row.version)]); await f.apply(deletion);
  assert.equal(f.port.list().length, 0); await f.revert(deletion); assert.equal(f.port.read(row.id).value.points[0].price, 20);
  f.session.close();
});

test('AI-owned drawings survive chart-scope rebind and can be removed by id without the old changeSet', async () => {
  const f = fixture(); const plan = await f.propose([create(horizontal())]); await f.apply(plan);
  const id = plan.operations[0].id;
  const next = { ...selection(), resolution: '1W', selectionGeneration: 2 };
  f.setSelection(next); f.session.rebindChart(next);
  await error(f.invokeAt('revert', { changeSetId: plan.changeSetId }, next), 'changeset_unavailable');
  const removed = await f.invokeAt('remove_owned', { ids: [id] }, next);
  assert.equal(removed.status, 'ok', JSON.stringify(removed)); assert.deepEqual(removed.data.removed, [id]);
  assert.equal(f.port.read(id).value, null); f.session.close();
});

test('owned cleanup refuses user drawings, other sessions, and AI drawings edited after creation', async () => {
  const f = fixture(); f.port.manual('user', horizontal(5));
  await error(f.invoke('remove_owned', { ids: ['user'] }), 'permission_denied');
  const plan = await f.propose([create(horizontal())]); await f.apply(plan); const id = plan.operations[0].id;
  const other = f.open();
  const otherReply = await other.invoke(f.body('remove_owned', { ids: [id] }, 'other-remove'));
  assert.equal(otherReply.status, 'error'); assert.equal(otherReply.code, 'permission_denied');
  f.port.manual(id, horizontal(77));
  await error(f.invoke('remove_owned', { ids: [id] }), 'permission_denied');
  assert.equal(f.port.read(id).value.points[0].price, 77);
  other.close(); f.session.close();
});

test('existing user content needs a separate grant and exact stored approval', async () => {
  const f = fixture(); f.port.manual('u', horizontal(5));
  const plan = await f.propose([update('u', 1, horizontal(20))]);
  assert.equal(plan.requiresExistingPermission, true);
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'permission_denied');
  await error(f.invoke('apply_existing', { changeSetId: plan.changeSetId, approved: true }), 'invalid_request');
  assert.equal(f.port.calls, 0);
  await applyExisting(f, plan);
  assert.equal((await f.ok('list'))[0].ownership, 'user-or-other', 'approved edit must not steal user ownership');
  await f.revert(plan); assert.equal(f.port.read('u').value.points[0].price, 5); f.session.close();
});

test('unknown and cross-session change IDs never confer permission', async () => {
  const f = fixture(); const plan = await f.propose([create(horizontal())]); const other = f.open();
  await error(other.invoke(f.body('apply', { changeSetId: plan.changeSetId })), 'changeset_unavailable');
  await error(f.invoke('apply', { changeSetId: 'unknown' }), 'changeset_unavailable');
  other.close(); f.session.close();
});

test('manual edits before approval conflict instead of overwriting the user', async () => {
  const f = fixture(); f.port.manual('u', horizontal(1));
  const plan = await f.propose([update('u', 1, horizontal(10))]);
  const waiting = await f.invoke('apply_existing', { changeSetId: plan.changeSetId });
  f.port.manual('u', horizontal(50));
  await error(f.session.approve(waiting.requestId), 'drawing_conflict');
  assert.equal(f.port.read('u').value.points[0].price, 50); f.session.close();
});

test('same-content manual ABA and delete/recreate ABA both invalidate original versions', async () => {
  for (const middle of [horizontal(99), null]) {
    const f = fixture(); f.port.manual('u', horizontal(1));
    const plan = await f.propose([update('u', 1, horizontal(10))]);
    f.port.manual('u', middle); f.port.manual('u', horizontal(1));
    const waiting = await f.invoke('apply_existing', { changeSetId: plan.changeSetId });
    await error(f.session.approve(waiting.requestId), 'drawing_conflict');
    assert.equal(f.port.calls, 0); f.session.close();
  }
});

test('undo rejects user-modified AI drawings and they no longer qualify for auto-edit', async () => {
  const f = fixture(); const plan = await f.propose([create(horizontal())]); await f.apply(plan);
  const id = plan.operations[0].id; f.port.manual(id, horizontal(77));
  await error(f.invoke('revert', { changeSetId: plan.changeSetId }), 'drawing_conflict');
  assert.equal((await f.ok('list'))[0].ownership, 'user-or-other');
  const replacement = await f.propose([update(id, f.port.read(id).version, horizontal(88))]);
  await error(f.invoke('apply', { changeSetId: replacement.changeSetId }), 'permission_denied');
  assert.equal(f.port.read(id).value.points[0].price, 77); f.session.close();
});

test('tombstone versions stop undo from resurrecting an object after user create/delete ABA', async () => {
  const f = fixture(); f.port.manual('u', horizontal());
  const plan = await f.propose([remove('u', 1)]); await applyExisting(f, plan);
  f.port.manual('u', horizontal(99)); f.port.manual('u', null);
  await error(f.invoke('revert', { changeSetId: plan.changeSetId }), 'drawing_conflict');
  assert.equal(f.port.read('u').value, null); f.session.close();
});

test('conflict in the last object prevents all earlier writes', async () => {
  const f = fixture(); f.port.manual('a', horizontal()); f.port.manual('b', horizontal());
  const plan = await f.propose([update('a', 1, horizontal(2)), update('b', 2, horizontal(3))]);
  f.port.manual('b', horizontal(4));
  const waiting = await f.invoke('apply_existing', { changeSetId: plan.changeSetId });
  await error(f.session.approve(waiting.requestId), 'drawing_conflict');
  assert.equal(f.port.calls, 0); f.session.close();
});

test('failure before and after the second mutation rolls back the whole attempted batch', async () => {
  for (const phase of ['beforeWrite', 'afterWrite']) {
    const f = fixture(); f.port.manual('user', horizontal()); const before = f.port.content();
    const plan = await f.propose([create(horizontal(2)), create(horizontal(3)), create(horizontal(4))]);
    f.port[phase] = () => { if (f.port.calls === 2) throw new Error('fake private exception'); };
    const reply = await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'tool_failed');
    assert.equal(JSON.stringify(reply).includes('private'), false);
    assert.deepEqual(f.port.content(), before); assert.deepEqual(f.port.saved, before);
    assert.equal(f.manager.poisoned, false); assert.equal(f.core.activeTasks, 0); f.session.close();
  }
});

test('silently ignored host write is detected by version/content readback', async () => {
  const f = fixture(); const plan = await f.propose([create(horizontal())]);
  f.port.write = () => {};
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'drawing_host_failed');
  assert.deepEqual(f.port.content(), []); f.session.close();
});

test('persistence failure restores objects and the previously saved document', async () => {
  const f = fixture(); f.port.manual('u', horizontal()); const before = f.port.content();
  const plan = await f.propose([create(horizontal(5))]);
  f.port.onFlush = () => { if (f.port.flushes === 1) throw new Error('quota'); };
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'tool_failed');
  assert.deepEqual(f.port.content(), before); assert.deepEqual(f.port.saved, before);
  assert.equal(f.manager.poisoned, false); f.session.close();
});

test('rollback failure is explicit, attempts remaining restores and disables further writes', async () => {
  const f = fixture(); const plan = await f.propose([create(horizontal(1)), create(horizontal(2))]);
  f.port.afterWrite = () => { if (f.port.calls === 2) throw new Error('forward'); };
  f.port.beforeWrite = () => { if (f.port.calls === 3) throw new Error('rollback'); };
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'rollback_failed');
  assert.equal(f.port.calls, 4, 'best effort continues after first restore failure');
  assert.equal(f.manager.poisoned, true);
  await error(f.invoke('propose', { operations: [create(horizontal())] }), 'drawing_host_failed');
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'drawing_host_failed'); f.session.close();
});

test('rollback will not overwrite a later edit made by a reentrant host callback', async () => {
  const f = fixture(); const plan = await f.propose([create(horizontal())]); const id = plan.operations[0].id;
  f.port.afterWrite = () => { f.port.manual(id, horizontal(100)); throw new Error('reentrant edit'); };
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'rollback_failed');
  assert.equal(f.port.read(id).value.points[0].price, 100); f.session.close();
});

test('failed undo restores the applied state and can retry against refreshed object versions', async () => {
  const f = fixture(); const plan = await f.propose([create(horizontal(1)), create(horizontal(2))]); await f.apply(plan);
  const beforeUndo = f.port.content(); const at = f.port.calls;
  f.port.afterWrite = () => { if (f.port.calls === at + 2) throw new Error('undo fault'); };
  await error(f.invoke('revert', { changeSetId: plan.changeSetId }), 'tool_failed');
  assert.deepEqual(f.port.content(), beforeUndo);
  f.port.afterWrite = undefined; await f.revert(plan); assert.deepEqual(f.port.content(), []); f.session.close();
});

test('selection A to B to A and foreign app/chart contexts reject old proposals', async () => {
  for (const patch of [{ selectionGeneration: 3 }, { chartId: 'other' }, { appInstanceId: 'other' }]) {
    const f = fixture(); const plan = await f.propose([create(horizontal())]);
    f.setSelection({ ...selection(), ...patch });
    await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'context_stale');
    assert.equal(f.port.calls, 0); f.session.close();
  }
});

test('cancel while waiting for approval has zero side effects', async () => {
  const f = fixture(); f.port.manual('u', horizontal()); const plan = await f.propose([remove('u', 1)]);
  const waiting = await f.invoke('apply_existing', { changeSetId: plan.changeSetId });
  assert.equal(f.session.cancel(waiting.requestId), true);
  await error(f.session.approve(waiting.requestId), 'not_awaiting_approval'); assert.equal(f.port.calls, 0); f.session.close();
});

test('cancel between prepare and commit cannot mutate', async () => {
  let cancel;
  const f = fixture({ mapTools: tool => tool.id === 'tf.drawings.apply' ? { ...tool, prepare: (...args) => {
    const transaction = tool.prepare(...args); queueMicrotask(() => cancel()); return transaction;
  } } : tool });
  const plan = await f.propose([create(horizontal())]); cancel = () => f.session.cancel('apply');
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }, 'apply'), 'cancelled');
  assert.equal(f.port.calls, 0); f.session.close();
});

test('cancel, revoke and timeout during synchronous host mutation complete rollback before reply', async () => {
  for (const kind of ['cancel', 'revoke', 'timeout']) {
    const f = fixture(); const plan = await f.propose([create(horizontal()), create(horizontal(2))]);
    f.port.afterWrite = () => {
      if (f.port.calls !== 1) return;
      if (kind === 'cancel') f.session.cancel('apply');
      if (kind === 'revoke') f.session.close();
      if (kind === 'timeout') f.clock.advance(10_001);
    };
    await error(f.invoke('apply', { changeSetId: plan.changeSetId }, 'apply'),
      kind === 'revoke' ? 'session_closed' : kind === 'cancel' ? 'cancelled' : 'timeout');
    assert.deepEqual(f.port.content(), []); assert.deepEqual(f.port.saved, []);
    assert.equal(f.core.activeTasks, 0); f.session.close();
  }
});

test('cancellation cannot mask rollback failure with an ordinary cancelled reply', async () => {
  const f = fixture(); const plan = await f.propose([create(horizontal())]);
  f.port.afterWrite = () => { if (f.port.calls === 1) f.session.cancel('apply'); };
  f.port.beforeWrite = () => { if (f.port.calls === 2) throw new Error('cannot restore'); };
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }, 'apply'), 'rollback_failed');
  assert.equal(f.manager.poisoned, true); f.session.close();
});

test('queued cancellation after the commit boundary cannot convert successful edits into cancelled status', async () => {
  const f = fixture(); const plan = await f.propose([create(horizontal())]); let cancelled;
  f.port.onFlush = () => queueMicrotask(() => { cancelled = f.session.cancel('apply'); });
  assert.equal((await f.invoke('apply', { changeSetId: plan.changeSetId }, 'apply')).status, 'ok');
  await tick(); assert.equal(cancelled, false); assert.equal(f.port.list().length, 1); f.session.close();
});

test('invalid receipt schema and undersized reply budget reject BEFORE committing', async () => {
  for (const variant of ['schema', 'bytes']) {
    const f = fixture({ mapTools: tool => tool.id === 'tf.drawings.apply' ? { ...tool,
      ...(variant === 'schema' ? { outputSchema: { type: 'number' } } : {}),
      prepare: (...args) => { const tx = tool.prepare(...args); return variant === 'bytes' ? { ...tx, result: 'x'.repeat(1024 * 1024 + 1) } : tx; },
    } : tool });
    const plan = await f.propose([create(horizontal())]);
    await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'invalid_output');
    assert.equal(f.port.calls, 0); f.session.close();
  }
});

test('accidentally async commit is rejected before invocation, not rolled back while its continuation is still running', async () => {
  let entered = 0;
  let lateMutation = 0;
  const f = fixture({ mapTools: tool => tool.id === 'tf.drawings.apply' ? { ...tool, prepare: () => ({
    result: { changeSetId: 'test', state: 'applied' },
    commit: async () => { entered++; await Promise.resolve(); lateMutation++; },
    rollback: () => { lateMutation = 0; },
  }) } : tool });
  await error(f.invoke('apply', { changeSetId: 'test' }), 'invalid_contract');
  await tick();
  assert.equal(entered, 0, 'do not invoke an async write callback');
  assert.equal(lateMutation, 0, 'no writes may appear after a failed transaction reply');
  f.session.close();
});

test('cancelled or rejected proposal delivery releases the unseen proposal ID', async () => {
  let cancel;
  const f = fixture({ mapTools: tool => tool.id === 'tf.drawings.propose' ? { ...tool, run: (...args) => {
    const result = tool.run(...args); queueMicrotask(() => cancel()); return result;
  } } : tool });
  cancel = () => f.session.cancel('preview');
  await error(f.invoke('propose', { operations: [create(horizontal())] }, 'preview'), 'cancelled');
  assert.equal(f.manager.retainedChanges, 0); assert.equal(f.manager.retainedBytes, 0); f.session.close();
  const bad = fixture({ mapTools: tool => tool.id === 'tf.drawings.propose' ? { ...tool, outputSchema: { type: 'number' } } : tool });
  await error(bad.invoke('propose', { operations: [create(horizontal())] }), 'invalid_output');
  assert.equal(bad.manager.retainedChanges, 0); bad.session.close();
});

test('proposal TTL applies at commit too; applied receipts remain undoable after TTL', async () => {
  const f = fixture(); const old = await f.propose([create(horizontal())]);
  f.clock.advance(DRAWING_LIMITS.proposalTtlMs + 1);
  await error(f.invoke('apply', { changeSetId: old.changeSetId }), 'changeset_unavailable');
  assert.equal(f.manager.retainedChanges, 0);
  const fresh = await f.propose([create(horizontal())]); await f.apply(fresh);
  f.clock.advance(DRAWING_LIMITS.proposalTtlMs + 1); await f.revert(fresh); f.session.close();
});

test('session close releases journals/ownership but does not delete already committed user-visible content', async () => {
  const f = fixture(); const plan = await f.propose([create(horizontal())]); await f.apply(plan);
  f.session.close(); assert.equal(f.manager.retainedChanges, 0); assert.equal(f.manager.retainedBytes, 0);
  assert.equal(f.port.list().length, 1);
  const other = f.open(); const list = await other.invoke(f.body('list'));
  assert.equal(list.data[0].ownership, 'user-or-other');
  await error(other.invoke(f.body('revert', { changeSetId: plan.changeSetId })), 'changeset_unavailable'); other.close();
});

test('object capacity is checked again at commit after unrelated user additions', async () => {
  const f = fixture(); for (let i = 0; i < 499; i++) f.port.manual(`u-${i}`, horizontal());
  const plan = await f.propose([create(horizontal())]); f.port.manual('u-last', horizontal());
  await error(f.invoke('apply', { changeSetId: plan.changeSetId }), 'drawing_capacity');
  assert.equal(f.port.calls, 0); f.session.close();
});

test('change record capacity is bounded and rejects rather than evicting idempotence history', async () => {
  const f = fixture();
  for (let i = 0; i < DRAWING_LIMITS.maxChanges; i++) await f.propose([create(horizontal(i))]);
  await error(f.invoke('propose', { operations: [create(horizontal())] }), 'drawing_capacity');
  assert.equal(f.manager.retainedChanges, DRAWING_LIMITS.maxChanges); f.session.close();
});

test('new transaction modules do not wire a native write port into the running application', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /createDrawingTools|DrawingChangeManager/);
  const source = readFileSync(new URL('../src/ai-capabilities/drawing-changes.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /removeAllLineTools|importLineTools|drawingHistory|\b(?:fetch|eval|invoke)\s*\(/);
});

let failures = 0;
for (const { name, run } of tests) {
  try { await run(); }
  catch (failure) { failures++; console.error(`FAIL ${name}\n${failure.stack}`); }
}
if (failures) throw new Error(`AI drawing changes: ${failures}/${tests.length} scenarios failed`);
console.log(`AI drawing changes: ${tests.length} scenarios passed`);
