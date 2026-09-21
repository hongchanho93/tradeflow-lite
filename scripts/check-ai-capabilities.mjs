import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  CapabilityCore, CapabilityRegistry, CAPABILITY_LIMITS,
} from '../src/ai-capabilities/index.ts';
import { compileSchema, snapshotJson, validateValue } from '../src/ai-capabilities/json.ts';

const tests = [];
const test = (name, run) => tests.push({ name, run });
const scope = () => ({
  appInstanceId: 'app-1', chartId: 'chart-1', provider: 'tdx', instrument: 'SH:600000',
  resolution: '1m', adjustment: 'qfq', selectionGeneration: 1,
});
const empty = { type: 'object', properties: {}, additionalProperties: false };
const numbers = {
  type: 'object', properties: { values: { type: 'array', items: { type: 'number' }, maxItems: 20 } },
  required: ['values'], additionalProperties: false,
};
const sumTool = (overrides = {}) => ({
  id: 'tf.compute.sum', version: 1, description: 'Deterministic sum of provided test values.',
  effect: 'read', inputSchema: numbers, outputSchema: { type: 'number' },
  run: input => input.values.reduce((sum, value) => sum + value, 0), ...overrides,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

class Clock {
  time = 0;
  next = 0;
  timers = new Map();
  now() { return this.time; }
  setTimer(callback, delay) {
    const id = ++this.next;
    this.timers.set(id, { callback, at: this.time + delay });
    return id;
  }
  clearTimer(id) { this.timers.delete(id); }
  advance(ms) {
    this.time += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.time) { this.timers.delete(id); timer.callback(); }
    }
  }
}

function setup({ tools = [sumTool()], permissions, limits, clock = new Clock() } = {}) {
  let current = scope();
  const registry = new CapabilityRegistry(tools);
  const core = new CapabilityCore(registry, { limits, clock });
  const open = (grants = permissions ?? Object.fromEntries(tools.map(tool => [tool.id, 'allow']))) => core.openSession({
    context: current, currentContext: () => current, permissions: grants,
  });
  const session = open();
  const body = (id = 'r1', input = { values: [1, 2, 3] }, extra = {}) => ({
    protocolVersion: 1, requestId: id, toolId: tools[0].id, context: scope(), input, ...extra,
  });
  return {
    core, registry, session, open, clock, body,
    request: (...args) => JSON.stringify(body(...args)),
    setContext: value => { current = value; },
  };
}

async function error(result, code) {
  const reply = await result;
  assert.equal(reply.status, 'error');
  assert.equal(reply.code, code);
  return reply;
}

test('read and pure proposal run without model/provider dependencies', async () => {
  for (const effect of ['read', 'propose']) {
    const f = setup({ tools: [sumTool({ effect })] });
    const reply = await f.session.invoke(f.request());
    assert.deepEqual(reply, { status: 'ok', requestId: 'r1', data: 6 });
    assert.ok(Object.isFrozen(reply));
    f.session.close();
  }
});

test('metadata is frozen, serializable, and never includes the executable handler', () => {
  const original = sumTool();
  const registry = new CapabilityRegistry([original]);
  const descriptors = registry.describe();
  assert.equal(descriptors[0].run, undefined);
  assert.ok(Object.isFrozen(descriptors));
  assert.ok(Object.isFrozen(descriptors[0].inputSchema.properties));
  assert.throws(() => { descriptors[0].effect = 'write'; });
  original.effect = 'write';
  assert.equal(registry.resolve(original.id).effect, 'read');
  assert.equal(JSON.parse(JSON.stringify(descriptors))[0].id, original.id);
});

test('invalid/duplicate tool definitions and unsupported schema keywords are rejected', () => {
  const invalid = [
    { id: '../src/main.ts' }, { version: 0 }, { version: -1 }, { version: 1.5 }, { version: Infinity }, { effect: 'shell' }, { run: null },
    { inputSchema: { ...empty, additionalProperties: true } },
    { inputSchema: { type: 'string', pattern: '.*' } },
    { inputSchema: { ...empty, required: ['missing'] } },
    { inputSchema: { type: 'number', minimum: 5, maximum: 2 } },
    { inputSchema: { type: 'array', items: { type: 'number' }, maxItems: -1 } },
  ];
  for (const patch of invalid) assert.throws(() => new CapabilityRegistry([sumTool(patch)]), /invalid_contract/);
  assert.throws(() => new CapabilityRegistry([sumTool(), sumTool()]), /invalid_contract/);
});

test('schema checks required/unknown fields, ranges, enums and integer/array types', () => {
  const schema = compileSchema({
    type: 'object', additionalProperties: false,
    properties: {
      mode: { type: 'string', enum: ['x', 'y'] }, count: { type: 'integer', minimum: 1, maximum: 3 },
      ok: { type: 'boolean' }, absent: { type: 'null' }, values: { type: 'array', items: { type: 'number' }, maxItems: 2 },
    }, required: ['mode'],
  });
  validateValue(snapshotJson({ mode: 'x', count: 2, ok: true, absent: null, values: [1] }, 1000).value, schema);
  for (const value of [{}, { mode: 'z' }, { mode: 'x', approved: true }, { mode: 'x', count: 1.5 },
    { mode: 'x', count: 4 }, { mode: 'x', values: [1, 2, 3] }, { mode: 'x', ok: 1 }, { mode: 'x', absent: 0 }]) {
    assert.throws(() => validateValue(snapshotJson(value, 1000).value, schema), /invalid_request/);
  }
});

test('JSON Schema string length counts Unicode characters, not UTF-16 halves', () => {
  const schema = compileSchema({ type: 'string', maxLength: 1 });
  validateValue('汉', schema);
  validateValue('😀', schema);
  assert.throws(() => validateValue('😀😀', schema), /invalid_request/);
});

test('bounded JSON uses actual UTF-8 and does not mutate input', () => {
  assert.equal(snapshotJson('汉', 5).bytes, 5);
  assert.throws(() => snapshotJson('汉', 4), /invalid_request/);
  const value = { b: 2, a: [1, true, null] };
  const snapshot = snapshotJson(value, 100);
  assert.equal(snapshot.text, '{"a":[1,true,null],"b":2}');
  assert.ok(Object.isFrozen(snapshot.value.a));
  value.a.push(9);
  assert.equal(snapshot.value.a.length, 3);
});

test('getters, toJSON, cycles, nonfinite values, sparse arrays and prototype keys cannot cross the boundary', () => {
  let called = 0;
  const getter = { get value() { called += 1; return 1; } };
  const toJSON = { toJSON() { called += 1; return 1; } };
  const cycle = {}; cycle.self = cycle;
  for (const value of [getter, toJSON, cycle, NaN, Infinity, 1n, undefined, new Date(), Array(2),
    { [Symbol('hidden')]: 1 }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
    assert.throws(() => snapshotJson(value, 1024), /invalid_request/);
  }
  assert.equal(called, 0);
  assert.equal({}.polluted, undefined);
});

test('requests reject malformed JSON, unsupported protocol and forged approval/session fields', async () => {
  const f = setup();
  for (const raw of ['{', '[]', '{}', f.request('x', {}, { input: undefined }),
    f.request('x', { values: [] }, { approved: true }),
    f.request('x', { values: [] }, { sessionId: 'admin' }),
    f.request('x', { values: [], approved: true })]) await error(f.session.invoke(raw), 'invalid_request');
  await error(f.session.invoke(f.request('x', { values: [] }, { protocolVersion: 2 })), 'unsupported_version');
  f.session.close();
});

test('request size, depth and node budgets reject oversized inputs before handlers', async () => {
  const f = setup();
  await error(f.session.invoke(f.request('large', { values: ['汉'.repeat(30_000)] })), 'invalid_request');
  let deep = null;
  for (let i = 0; i < 35; i += 1) deep = [deep];
  await error(f.session.invoke(f.request('deep', deep)), 'invalid_request');
  assert.throws(() => snapshotJson(Array(30_001).fill(0), 100_000), /invalid_request/);
  f.session.close();
});

test('no permission defaults to deny; no system/source tool is implicitly available', async () => {
  const f = setup({ permissions: {} });
  await error(f.session.invoke(f.request()), 'permission_denied');
  for (const id of ['tf.source.write', 'tf.shell.exec', 'tf.tauri.invoke', 'tf.auth.read']) {
    await error(f.session.invoke(f.request('forbidden', {}, { toolId: id })), 'unknown_tool');
  }
  f.session.close();
});

test('host permission configuration is copied, not a mutable caller-owned authority', async () => {
  const permissions = { 'tf.compute.sum': 'deny' };
  const f = setup({ permissions });
  permissions['tf.compute.sum'] = 'allow';
  await error(f.session.invoke(f.request()), 'permission_denied');
  assert.throws(() => f.open({ 'tf.compute.sum': 'anything' }), /invalid_contract/);
  f.session.close();
});

test('confirmation executes only the stored immutable request, once', async () => {
  let called = 0;
  const f = setup({ permissions: { 'tf.compute.sum': 'ask' }, tools: [sumTool({
    run: input => { called += 1; assert.ok(Object.isFrozen(input.values)); return input.values[0]; },
  })] });
  const body = f.body('approve', { values: [7] });
  assert.equal((await f.session.invoke(JSON.stringify(body))).status, 'approval_required');
  body.input.values[0] = 999;
  assert.equal(called, 0);
  await error(f.session.invoke(JSON.stringify(body)), 'request_conflict');
  assert.equal((await f.session.approve('approve')).data, 7);
  await error(f.session.approve('approve'), 'not_awaiting_approval');
  assert.equal(called, 1);
  assert.equal((await f.session.invoke(f.request('second'))).status, 'approval_required');
  assert.equal(called, 1);
  f.session.close();
});

test('cancel pending confirmation, then approve, never executes', async () => {
  let called = 0;
  const f = setup({ permissions: { 'tf.compute.sum': 'ask' }, tools: [sumTool({ run: () => ++called })] });
  await f.session.invoke(f.request());
  assert.equal(f.session.cancel('r1'), true);
  await error(f.session.approve('r1'), 'not_awaiting_approval');
  await error(f.session.invoke(f.request()), 'cancelled');
  assert.equal(called, 0);
  f.session.close();
});

test('write declarations cannot bypass the not-yet-implemented changeset boundary', async () => {
  let called = 0;
  for (const permission of ['allow', 'ask']) {
    const f = setup({ tools: [sumTool({ effect: 'write', run: () => ++called })], permissions: { 'tf.compute.sum': permission } });
    await error(f.session.invoke(f.request()), 'write_requires_changeset');
    f.session.close();
  }
  assert.equal(called, 0);
});

test('all selection fields bind authority, including instance/chart and generation', async () => {
  const f = setup();
  for (const [key, value] of Object.entries(scope())) {
    const changed = { ...scope(), [key]: typeof value === 'number' ? value + 1 : `${value}-other` };
    await error(f.session.invoke(f.request(key, { values: [] }, { context: changed })), 'context_stale');
  }
  f.session.close();
});

test('A → B → A rejects late first-A result even when instrument name matches again', async () => {
  const pending = deferred();
  const f = setup({ tools: [sumTool({ run: () => pending.promise })] });
  const result = f.session.invoke(f.request());
  await flush();
  f.setContext({ ...scope(), instrument: 'SH:600001', selectionGeneration: 2 });
  f.setContext({ ...scope(), selectionGeneration: 3 });
  pending.resolve(5);
  await error(result, 'context_stale');
  await flush();
  assert.equal(f.core.activeTasks, 0);
  f.session.close();
});

test('normal data ticks with unchanged selection do not invalidate a task', async () => {
  const pending = deferred();
  const f = setup({ tools: [sumTool({ run: () => pending.promise })] });
  const result = f.session.invoke(f.request());
  await flush();
  f.setContext({ ...scope() });
  pending.resolve(8);
  assert.equal((await result).data, 8);
  f.session.close();
});

test('confirmation rechecks context after user switches chart', async () => {
  let called = 0;
  const f = setup({ tools: [sumTool({ run: () => ++called })], permissions: { 'tf.compute.sum': 'ask' } });
  await f.session.invoke(f.request());
  f.setContext({ ...scope(), selectionGeneration: 2 });
  await error(f.session.approve('r1'), 'context_stale');
  assert.equal(called, 0);
  f.session.close();
});

test('canonical idempotency reuses pending and completed work despite key order/whitespace', async () => {
  let called = 0;
  const pending = deferred();
  const f = setup({ tools: [sumTool({ run: () => { called += 1; return pending.promise; } })] });
  const first = f.session.invoke(f.request());
  const shuffled = Object.fromEntries(Object.entries(f.body()).reverse());
  const second = f.session.invoke(JSON.stringify(shuffled, null, 2));
  assert.equal(first, second);
  await flush();
  pending.resolve(17);
  assert.equal((await first).data, 17);
  assert.equal((await f.session.invoke(f.request())).data, 17);
  assert.equal(called, 1);
  await error(f.session.invoke(f.request('r1', { values: [99] })), 'request_conflict');
  f.session.close();
});

test('request IDs are scoped per host session, not usable for cross-session access', async () => {
  let called = 0;
  const f = setup({ tools: [sumTool({ run: () => ++called })] });
  const denied = f.open({});
  assert.equal((await f.session.invoke(f.request())).data, 1);
  await error(denied.invoke(f.request()), 'permission_denied');
  const allowed = f.open();
  assert.equal((await allowed.invoke(f.request())).data, 2);
  f.session.close(); denied.close(); allowed.close();
});

test('cancellation before dispatch prevents handler invocation', async () => {
  let called = 0;
  const f = setup({ tools: [sumTool({ run: () => ++called })] });
  const result = f.session.invoke(f.request());
  f.session.cancel('r1');
  await error(result, 'cancelled');
  await flush();
  assert.equal(called, 0);
  assert.equal(f.core.activeTasks, 0);
  assert.equal(f.clock.timers.size, 0);
  f.session.close();
});

test('cancellation returns promptly but retains actual in-flight capacity until settlement', async () => {
  const pending = deferred();
  let execution;
  const f = setup({ tools: [sumTool({ run: (_input, context) => { execution = context; return pending.promise; } })],
    limits: { maxActiveGlobal: 1, maxActivePerSession: 1 } });
  const result = f.session.invoke(f.request());
  await flush();
  f.session.cancel('r1');
  await error(result, 'cancelled');
  assert.equal(execution.signal.aborted, true);
  assert.throws(() => execution.checkpoint(), /cancelled/);
  assert.equal(f.core.activeTasks, 1);
  await error(f.session.invoke(f.request('blocked')), 'busy');
  pending.resolve(10);
  await flush();
  assert.equal(f.core.activeTasks, 0);
  await error(f.session.invoke(f.request()), 'cancelled');
  f.session.close();
});

test('host revocation closes pending approvals and discards late results', async () => {
  const pending = deferred();
  const f = setup({ tools: [sumTool({ run: () => pending.promise })] });
  const running = f.session.invoke(f.request());
  await flush();
  const asking = f.open({ 'tf.compute.sum': 'ask' });
  await asking.invoke(f.request());
  f.session.close(); asking.close();
  await error(running, 'session_closed');
  await error(asking.approve('r1'), 'session_closed');
  await error(f.session.invoke(f.request()), 'session_closed');
  assert.equal(f.core.openSessions, 0);
  assert.equal(f.core.activeTasks, 1);
  pending.resolve(42);
  await flush();
  assert.equal(f.core.activeTasks, 0);
});

test('deterministic timeout aborts and never frees an unresolved task slot prematurely', async () => {
  const pending = deferred();
  let signal;
  const f = setup({ tools: [sumTool({ run: (_input, context) => { signal = context.signal; return pending.promise; } })],
    limits: { timeoutMs: 10 } });
  const result = f.session.invoke(f.request());
  await flush();
  f.clock.advance(10);
  await error(result, 'timeout');
  assert.equal(signal.aborted, true);
  assert.equal(f.core.activeTasks, 1);
  pending.reject(new Error('late private error'));
  await flush();
  assert.equal(f.core.activeTasks, 0);
  assert.equal(f.clock.timers.size, 0);
  f.session.close();
});

test('post-handler deadline check catches expiry even before timer callback runs', async () => {
  const clock = new Clock();
  const f = setup({ clock, limits: { timeoutMs: 10 }, tools: [sumTool({ run: () => { clock.time = 10; return 1; } })] });
  await error(f.session.invoke(f.request()), 'timeout');
  await flush();
  assert.equal(f.clock.timers.size, 0);
  f.session.close();
});

test('global concurrency remains bounded across sessions', async () => {
  const pending = deferred();
  const f = setup({ tools: [sumTool({ run: () => pending.promise })], limits: { maxActiveGlobal: 1 } });
  const other = f.open();
  const result = f.session.invoke(f.request());
  await flush();
  await error(other.invoke(f.request()), 'busy');
  assert.equal(f.core.activeTasks, 1);
  pending.resolve(1);
  await result; await flush();
  f.session.close(); other.close();
});

test('completed handlers release slots before delivering success to the next tool call', async () => {
  const f = setup({ limits: { maxActiveGlobal: 1, maxActivePerSession: 1 } });
  assert.equal((await f.session.invoke(f.request())).status, 'ok');
  assert.equal((await f.session.invoke(f.request('next'))).status, 'ok');
  f.session.close();
});

test('session/request limits are explicit; recorded requests are never evicted then reexecuted', async () => {
  const f = setup({ limits: { maxSessions: 1, maxRequestsPerSession: 1 } });
  assert.throws(() => f.open(), /session_capacity/);
  assert.equal((await f.session.invoke(f.request())).status, 'ok');
  await error(f.session.invoke(f.request('next')), 'session_capacity');
  assert.equal((await f.session.invoke(f.request())).status, 'ok');
  f.session.close();
  const next = f.open(); next.close();
});

test('retained result budget reserves space before invoking a handler', async () => {
  let called = 0;
  const f = setup({ tools: [sumTool({ run: () => ++called })], limits: { maxStoredBytesPerSession: 256 } });
  await error(f.session.invoke(f.request()), 'session_capacity');
  assert.equal(called, 0);
  f.session.close();
});

test('unsupported or invalid host limit overrides fail instead of silently weakening enforcement', () => {
  const registry = new CapabilityRegistry([sumTool()]);
  for (const limits of [{ timeoutMs: 0 }, { maxSessions: Infinity }, { maxOutputBytes: -1 },
    { maxActiveGlobal: 1.5 }, { maxJsonDepth: 1 }, { imaginary: 1 },
    { maxOutputBytes: CAPABILITY_LIMITS.maxOutputBytes + 1 }]) {
    assert.throws(() => new CapabilityCore(registry, { limits }), /invalid_contract/);
  }
});

test('invalid output schema, output bytes and exception text never leak unchecked values', async () => {
  let getterCalls = 0;
  for (const run of [() => NaN, () => Infinity, () => ({ secret: 'fake-key' }),
    () => ({ get data() { getterCalls += 1; return 1; } })]) {
    const f = setup({ tools: [sumTool({ run })] });
    const reply = await error(f.session.invoke(f.request()), 'invalid_output');
    assert.equal(JSON.stringify(reply).includes('fake-key'), false);
    f.session.close();
  }
  assert.equal(getterCalls, 0);
  const oversized = setup({ tools: [sumTool({ run: () => '汉'.repeat(20), outputSchema: { type: 'string' } })],
    limits: { maxOutputBytes: 32 } });
  await error(oversized.session.invoke(oversized.request()), 'invalid_output'); oversized.session.close();
  const failed = setup({ tools: [sumTool({ run: () => { throw new Error('fake-key /private/path'); } })] });
  const reply = await error(failed.session.invoke(failed.request()), 'tool_failed');
  assert.equal(JSON.stringify(reply).includes('private'), false); failed.session.close();
});

test('capability modules have no OS, network, Tauri, credential or eval API', () => {
  const directory = new URL('../src/ai-capabilities/', import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith('.ts'))) {
    const source = readFileSync(new URL(name, directory), 'utf8');
    assert.doesNotMatch(source, /from\s+['"](?:node:|@tauri|https?:)/);
    // RegExp.exec is text parsing, not a process execution API. Keep checking
    // host/network calls without treating the regular-expression method as Shell.
    assert.doesNotMatch(source, /\b(?:fetch|eval|spawn)\s*\(|(?<![.\w])exec\s*\(/);
    assert.doesNotMatch(source, /new\s+(?:Function|WebSocket)\s*\(/);
  }
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /export function openAiChartReadSession\(/);
  assert.doesNotMatch(main, /(?:window|globalThis)\.[\w$]+\s*=\s*(?:aiChartReadBridge|openAiChartReadSession)/);
});

let failures = 0;
for (const { name, run } of tests) {
  try { await run(); }
  catch (failure) { failures += 1; console.error(`FAIL ${name}\n${failure.stack}`); }
}
if (failures) throw new Error(`AI capability core: ${failures}/${tests.length} scenarios failed`);
console.log(`AI capability core: ${tests.length} scenarios passed`);
