import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';

const empty = { type: 'object', properties: {}, additionalProperties: false };
const context = { scope: 'app', appInstanceId: 'async-write-test' };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(prepareAsync, outputSchema = empty) {
  const registry = new CapabilityRegistry([{ id: 'tf.test.async', version: 1, scope: 'app', effect: 'write',
    description: 'Trusted asynchronous storage transaction', inputSchema: empty, outputSchema,
    run() { throw Error('read handler must not run'); }, prepareAsync }]);
  const core = new CapabilityCore(registry);
  const session = core.openSession({ context, currentContext: () => context, permissions: { 'tf.test.async': 'allow' } });
  const invoke = (requestId = 'r1') => session.invoke(JSON.stringify({ protocolVersion: 1, requestId, toolId: 'tf.test.async', context, input: {} }));
  return { registry, core, session, invoke };
}

test('asynchronous writes validate their result before mutation and are idempotent', async () => {
  let value = 0, disposed = 0;
  const f = fixture(async () => ({ result: {}, async commit() { value++; }, async rollback() { value--; }, dispose() { disposed++; } }));
  assert.equal(f.registry.describe()[0].prepareAsync, undefined);
  assert.equal((await f.invoke()).status, 'ok');
  assert.equal((await f.invoke()).status, 'ok'); assert.equal(value, 1); assert.equal(disposed, 1);
  f.session.close();
});
test('invalid async result releases preparation without any write', async () => {
  let writes = 0, disposed = 0;
  const f = fixture(async () => ({ result: { unexpected: true }, async commit() { writes++; }, async rollback() { writes--; }, dispose() { disposed++; } }));
  assert.equal((await f.invoke()).code, 'invalid_output'); assert.equal(writes, 0); assert.equal(disposed, 1); f.session.close();
});
test('cancellation during preparation cannot commit and disposes acquired resources', async () => {
  const gate = deferred(); let writes = 0, disposed = 0;
  const f = fixture(async () => { await gate.promise; return { result: {}, async commit() { writes++; }, async rollback() {}, dispose() { disposed++; } }; });
  const pending = f.invoke(); await flush(); f.session.cancel('r1');
  assert.equal((await pending).code, 'cancelled'); assert.equal(f.core.activeTasks, 1);
  gate.resolve(); await flush(); assert.equal(writes, 0); assert.equal(disposed, 1); assert.equal(f.core.activeTasks, 0); f.session.close();
});
test('cancel during commit awaits compensation before reply and before releasing the slot', async () => {
  const writing = deferred(), restoring = deferred(); let value = 0, replied = false;
  const f = fixture(async () => ({ result: {}, async commit() { value = 1; await writing.promise; }, async rollback() { await restoring.promise; value = 0; } }));
  const pending = f.invoke().then(r => { replied = true; return r; }); await flush(); assert.equal(value, 1);
  f.session.cancel('r1'); await flush(); assert.equal(replied, false); assert.equal(f.core.activeTasks, 1);
  writing.resolve(); await flush(); assert.equal(replied, false); assert.equal(value, 1);
  restoring.resolve(); assert.equal((await pending).code, 'cancelled'); assert.equal(value, 0); assert.equal(f.core.activeTasks, 0); f.session.close();
});
test('async storage failure rolls back and rollback failure is explicit', async () => {
  for (const brokenRollback of [false, true]) {
    let value = 0;
    const f = fixture(async () => ({ result: {}, async commit() { value = 1; throw Error('disk failure'); },
      async rollback() { if (brokenRollback) throw Error('disk still unavailable'); value = 0; } }));
    assert.equal((await f.invoke()).code, brokenRollback ? 'rollback_failed' : 'tool_failed');
    assert.equal(value, brokenRollback ? 1 : 0); assert.equal(f.core.activeTasks, 0); f.session.close();
  }
});
test('session close during async commit never returns before rollback has finished', async () => {
  const gate = deferred(); let value = 0, replied = false;
  const f = fixture(async () => ({ result: {}, async commit() { value = 1; await gate.promise; }, async rollback() { value = 0; } }));
  const pending = f.invoke().then(r => { replied = true; return r; }); await flush(); f.session.close(); await flush();
  assert.equal(replied, false); gate.resolve(); assert.equal((await pending).code, 'session_closed'); assert.equal(value, 0); assert.equal(f.core.activeTasks, 0);
});
test('async preparation cannot be attached to a read tool or coexist with sync prepare', () => {
  const base = { id: 'tf.test.invalid', version: 1, effect: 'read', description: 'invalid', inputSchema: empty, outputSchema: empty, run: () => ({}), prepareAsync: async () => ({}) };
  assert.throws(() => new CapabilityRegistry([base]), /invalid_contract/);
  assert.throws(() => new CapabilityRegistry([{ ...base, effect: 'write', prepare: () => ({}) }]), /invalid_contract/);
});
