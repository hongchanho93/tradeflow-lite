import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { CAPABILITY_LIMITS, CapabilityError } from '../src/ai-capabilities/contracts.ts';

const empty = { type: 'object', properties: {}, additionalProperties: false };
const app = { scope: 'app', appInstanceId: 'dynamic-test' };
const chart = { appInstanceId: 'dynamic-test', chartId: 'main', provider: 'tdx', instrument: 'SH:600000',
  resolution: '1D', adjustment: 'none', selectionGeneration: 1 };
const definition = (id = 'user.sample.value', patch = {}) => ({ id, version: 1, title: '用户测试工具',
  description: 'Host-owned fixture', scope: 'app', effect: 'read', inputSchema: empty,
  outputSchema: { type: 'number' }, run: () => 1, ...patch });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture(tool = definition()) {
  const registry = new CapabilityRegistry([definition('tf.test.stable')]), owner = registry.createOwner('sample');
  owner.register(tool); const core = new CapabilityCore(registry);
  const permissions = () => Object.fromEntries(registry.describe().map(t => [t.id, 'allow']));
  const session = core.openSession({ context: chart, currentContext: () => chart, permissions: permissions() });
  const request = (id = tool.id, requestId = 'r1') => JSON.stringify({ protocolVersion: 1, requestId, toolId: id,
    context: registry.resolve(id).scope === 'app' ? app : chart, input: {} });
  return { registry, owner, core, session, request, refresh: () => session.refreshTools(permissions()) };
}

test('owner registers, updates and removes tool metadata without exposing host functions', async () => {
  const r = new CapabilityRegistry([]), events = []; const off = r.subscribe(e => events.push(e));
  const o = r.createOwner('sample'); const first = o.register(definition());
  assert.equal(first.source, 'extension'); assert.equal(first.ownerId, 'sample'); assert.ok(first.registrationRevision > 0);
  assert.equal(first.run, undefined); assert.equal(first.timeoutMs, undefined); assert.equal(first.title, '用户测试工具');
  await o.update(definition(undefined, { version: 2, run: () => 2 }));
  assert.equal(r.resolve('user.sample.value').version, 2);
  assert.ok(r.describe()[0].registrationRevision > first.registrationRevision);
  await o.unregister('user.sample.value'); assert.deepEqual(r.list(), []);
  assert.deepEqual(events.map(e => [e.added.length, e.updated.length, e.removed.length]), [[1,0,0],[0,1,0],[0,0,1]]);
  off(); await o.dispose();
});
test('duplicate owners, reserved namespaces, wire collisions and failed updates are atomic', async () => {
  const r = new CapabilityRegistry([definition('tf.test.stable')]), o = r.createOwner('a_b'), p = r.createOwner('a');
  o.register(definition('user.a_b.c')); const before = r.describe(), rev = r.revision;
  assert.throws(() => r.createOwner('a_b')); assert.throws(() => o.register(definition('tf.test.stable')));
  assert.throws(() => p.register(definition('user.a.b_c'))); assert.throws(() => o.register(definition('user.a_b.c')));
  assert.throws(() => o.update(definition('user.a_b.c', { inputSchema: { type: 'unsupported' } })));
  assert.throws(() => p.unregister('user.a_b.c')); assert.equal(r.revision, rev); assert.deepEqual(r.describe(), before);
  await o.dispose(); await p.dispose(); assert.equal(r.describe().length, 1);
});
test('reinstalling an owner cannot revive old handles or registration identity', async () => {
  const r = new CapabilityRegistry([]), old = r.createOwner('sample'); const a = old.register(definition());
  await old.dispose(); const next = r.createOwner('sample'); const b = next.register(definition());
  assert.ok(b.registrationRevision > a.registrationRevision); assert.throws(() => old.register(definition()));
  await old.dispose(); assert.equal(r.describe().length, 1); await next.dispose();
});
test('throwing observers cannot make a successful catalog change appear to fail', async () => {
  const r = new CapabilityRegistry([]), seen = []; r.subscribe(() => { throw Error('observer fixture'); });
  r.subscribe(e => seen.push(e.revision)); const o = r.createOwner('sample'); o.register(definition());
  assert.equal(r.describe().length, 1); assert.equal(seen.length, 1); await o.dispose(); assert.equal(seen.length, 2);
});
test('same-version replacement invalidates cached replies and revision-bound permissions', async () => {
  const f = fixture(), text = f.request(); assert.equal((await f.session.invoke(text)).data, 1);
  await f.owner.update(definition(undefined, { run: () => 2 }));
  assert.equal((await f.session.invoke(text)).code, 'tool_changed');
  assert.equal((await f.session.invoke(f.request(undefined, 'new'))).code, 'permission_denied');
  f.refresh(); assert.equal((await f.session.invoke(f.request(undefined, 'fresh'))).data, 2);
  assert.equal((await f.session.invoke(f.request('tf.test.stable', 'stable'))).data, 1);
  f.session.close(); await f.owner.dispose();
});
test('a retired handler is cancelled and its resources close, but unload waits for actual exit', async () => {
  const gate = deferred(); let signal, scope;
  const f = fixture(definition(undefined, { run: async (_i, ctx) => { signal = ctx.signal; scope = ctx.registration.signal; return gate.promise; } }));
  const pending = f.session.invoke(f.request()); await flush(); let drained = false;
  const unload = f.owner.dispose().then(() => { drained = true; }); await flush();
  assert.ok(signal.aborted); assert.ok(scope.aborted); assert.equal((await pending).code, 'tool_changed');
  assert.equal(f.core.activeTasks, 1); assert.equal(drained, false);
  assert.equal((await f.session.invoke(f.request('tf.test.stable', 'other'))).data, 1);
  gate.resolve(123); await unload; await flush(); assert.equal(f.core.activeTasks, 0); f.session.close();
});
test('changing a tool while approval is pending prevents both old approval and new implementation', async () => {
  let writes = 0; const tool = definition(undefined, { effect: 'write', prepare: () => ({ result: 1, commit() { writes++; }, rollback() { writes--; } }) });
  const f = fixture(tool); f.session.refreshTools({ [tool.id]: 'ask', 'tf.test.stable': 'allow' });
  assert.equal((await f.session.invoke(f.request())).status, 'approval_required'); await f.owner.update({ ...tool, version: 2 });
  assert.equal((await f.session.approve('r1')).status, 'error'); assert.equal(writes, 0);
  f.session.close(); await f.owner.dispose();
});
test('unload during commit retains the task until asynchronous rollback completes', async () => {
  const writing = deferred(), rollback = deferred(); let value = 0, replied = false, disposed = 0;
  const f = fixture(definition(undefined, { effect: 'write', prepareAsync: async () => ({ result: 1,
    async commit() { value = 1; await writing.promise; }, async rollback() { await rollback.promise; value = 0; }, dispose() { disposed++; } }) }));
  const pending = f.session.invoke(f.request()).then(r => { replied = true; return r; }); await flush();
  const unload = f.owner.dispose(); await flush(); assert.equal(replied, false); assert.equal(value, 1);
  writing.resolve(); await flush(); assert.equal(f.core.activeTasks, 1); assert.equal(replied, false);
  rollback.resolve(); assert.equal((await pending).code, 'tool_changed'); await unload;
  assert.equal(value, 0); assert.equal(disposed, 1); assert.equal(f.core.activeTasks, 0); f.session.close();
});
test('dynamic resource scope survives unrelated registration changes, not its own update or session close', async () => {
  const scopes = []; const f = fixture(definition(undefined, { run: (_i,c) => { scopes.push(c.registration.signal); return 1; } }));
  await f.session.invoke(f.request()); f.owner.register(definition('user.sample.other'));
  assert.equal(scopes[0].aborted, false); await f.owner.update(definition(undefined, { run: (_i,c) => { scopes.push(c.registration.signal); return 2; } }));
  assert.equal(scopes[0].aborted, true); f.refresh(); await f.session.invoke(f.request(undefined, 'new'));
  assert.equal(scopes[1].aborted, false); f.session.close(); assert.equal(scopes[1].aborted, true); await f.owner.dispose();
});
test('dynamic chart resource scope cannot survive chart invalidation', async () => {
  let scope; const f = fixture(definition(undefined, { scope: 'chart', run: (_i,c) => { scope = c.registration.signal; return 1; } }));
  await f.session.invoke(f.request()); f.core.invalidateCharts(); assert.ok(scope.aborted);
  assert.equal((await f.session.invoke(f.request(undefined, 'stale'))).code, 'context_stale');
  f.refresh(); assert.equal((await f.session.invoke(f.request(undefined, 'still-stale'))).code, 'context_stale');
  f.session.close(); await f.owner.dispose();
});

test('a replacement cannot run before the prior version has finished rolling back', async () => {
  const gate = deferred(); let value = 0;
  const old = definition(undefined, { effect: 'write', prepareAsync: async () => ({ result: 1,
    async commit() { value = 1; await gate.promise; }, async rollback() { value = 0; } }) });
  const f = fixture(old); const pending = f.session.invoke(f.request()); await flush();
  const updated = f.owner.update(definition(undefined, { effect: 'write', prepare: () => ({ result: 2,
    commit() { value = 2; }, rollback() { value = 0; } }) }));
  f.refresh(); assert.equal((await f.session.invoke(f.request(undefined, 'too-early'))).code, 'busy'); assert.equal(value, 1);
  gate.resolve(); await updated; assert.equal((await pending).code, 'tool_changed');
  assert.equal((await f.session.invoke(f.request(undefined, 'ready'))).data, 2); assert.equal(value, 2);
  f.session.close(); await f.owner.dispose();
});
test('unregister and reinstall the same name cannot overtake a still-running retired handler', async () => {
  const gate = deferred(); const f = fixture(definition(undefined, { run: () => gate.promise }));
  const pending = f.session.invoke(f.request()); await flush(); const retired = f.owner.dispose();
  const fresh = f.registry.createOwner('sample'); fresh.register(definition()); f.refresh();
  assert.equal((await f.session.invoke(f.request(undefined, 'early'))).code, 'busy');
  gate.resolve(123); await retired; await pending;
  assert.equal((await f.session.invoke(f.request(undefined, 'late'))).data, 1);
  f.session.close(); await fresh.dispose();
});

test('catalog capacity is checked before mutation and retired rows do not accumulate', async () => {
  const registry = new CapabilityRegistry([]), owner = registry.createOwner('sample'), start = performance.now();
  let changes = 0; registry.subscribe(() => changes++);
  for (let i = 0; i < CAPABILITY_LIMITS.maxTools; i++) owner.register(definition(`user.sample.item_${i}`));
  const snapshot = registry.describe(), revision = registry.revision;
  assert.throws(() => owner.register(definition('user.sample.overflow')), /registry_capacity/);
  assert.equal(registry.revision, revision); assert.equal(registry.describe(), snapshot);
  for (let i = 0; i < 250; i++) await owner.update(definition('user.sample.item_0', { version: i + 1 }));
  assert.equal(registry.describe().length, CAPABILITY_LIMITS.maxTools); assert.equal(changes, CAPABILITY_LIMITS.maxTools + 250);
  await owner.dispose(); assert.equal(registry.describe().length, 0);
  console.log(`${CAPABILITY_LIMITS.maxTools}-tool catalog / 250 updates / unload: ${(performance.now() - start).toFixed(1)}ms (Node fixture)`);
});
test('catalog byte budget rejects a valid but oversized registration without discarding existing tools', async () => {
  const registry = new CapabilityRegistry([]), owner = registry.createOwner('sample'); owner.register(definition());
  const schema = { type: 'string', enum: Array.from({ length: 72 }, (_, i) => `${i}:${'x'.repeat(120_000)}`) };
  owner.register(definition('user.sample.large_a', { inputSchema: schema }));
  const before = registry.describe();
  assert.throws(() => owner.register(definition('user.sample.large_b', { inputSchema: schema })), /registry_capacity/);
  assert.equal(registry.describe(), before); assert.equal(registry.resolve('user.sample.value').run(), 1); await owner.dispose();
});
test('related dynamic tools keep the same session identity without sharing implementation lifetimes', async () => {
  let shared, registration;
  const f = fixture(definition(undefined, { run: (_input, ctx) => { shared = ctx.session; registration = ctx.registration; return 1; } }));
  f.owner.register(definition('user.sample.second', { run: (_input, ctx) => {
    assert.equal(ctx.session, shared); assert.notEqual(ctx.registration, registration); return 2;
  } }));
  f.refresh(); await f.session.invoke(f.request());
  assert.equal((await f.session.invoke(f.request('user.sample.second', 'second'))).data, 2);
  await f.owner.unregister('user.sample.value'); assert.equal(shared.signal.aborted, false); assert.equal(registration.signal.aborted, true);
  f.session.close(); await f.owner.dispose();
});
for (const language of ['en', 'zh-CN']) test(`the ${language} AI source-extension example registers, updates and disposes through the real Core`, async () => {
  const guide = readFileSync(new URL(`../docs/${language}/extensions.md`, import.meta.url), 'utf8');
  const code = guide.match(/```ts\n([\s\S]*?)\n```/)[1].replace(/^import[^\n]*\n/gm, '').replace('export function', 'function');
  const mount = new Function('CapabilityError', `${stripTypeScriptTypes(code)}; return mountScaleTool;`)(CapabilityError);
  const registry = new CapabilityRegistry([]), owner = registry.createOwner('example'), module = mount(owner), core = new CapabilityCore(registry);
  const permissions = { 'user.example.scale': 'allow' }, s = core.openSession({ context: app, currentContext: () => app, permissions });
  const call = id => s.invoke(JSON.stringify({ protocolVersion: 1, requestId: id, toolId: 'user.example.scale', context: app, input: { value: 4 } }));
  assert.equal((await call('first')).data.value, 8); await module.updateFactor(3);
  s.refreshTools(permissions); assert.equal((await call('second')).data.value, 12);
  await module.close(); assert.equal(registry.describe().length, 0); s.close();
});
