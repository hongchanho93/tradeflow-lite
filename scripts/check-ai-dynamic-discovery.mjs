import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { McpConnection } from '../src/ai-mcp/session.ts';
import { ApiConversation } from '../src/ai-api/conversation.ts';

const empty = { type: 'object', properties: {}, additionalProperties: false };
const chart = { appInstanceId: 'discovery', chartId: 'main', provider: 'tdx', instrument: 'SH:600000', resolution: '1D', adjustment: 'none', selectionGeneration: 1 };
const tool = (patch = {}) => ({ id: 'user.sample.value', version: 1, scope: 'app', effect: 'read', title: '我的工具',
  description: 'Host-owned fixture', inputSchema: empty, outputSchema: { type: 'number' }, run: () => 1, ...patch });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const registry = new CapabilityRegistry([tool({ id: 'tf.test.stable' })]), core = new CapabilityCore(registry), owner = registry.createOwner('sample');
  const host = { context: () => chart, describe: () => registry.describe(), subscribeTools: listener => registry.subscribe(listener),
    open: permissions => core.openSession({ context: chart, currentContext: () => chart, permissions }) };
  return { registry, owner, core, host };
}
async function connect(f, options = {}, version = '2025-11-25') {
  const c = new McpConnection(f.host, () => {}, { approvalMs: 250, ...options }); let n = 0;
  const rpc = async (method, params = {}, id = ++n) => JSON.parse(await c.receive(JSON.stringify({ jsonrpc: '2.0', id, method, params })));
  const init = await rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'fixture', version: '1' } });
  await c.receive(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  const list = async () => (await rpc('tools/list')).result.tools;
  const call = async (name, id) => (await rpc('tools/call', { name, arguments: { input: {} } }, id)).result.structuredContent.reply;
  return { c, rpc, list, call, init };
}
for (const version of ['2025-11-25', '2025-06-18']) test(`${version}: dynamic list notifications coalesce and disappear after close`, async () => {
  const f = fixture(), notifications = [], c = await connect(f, { toolsChanged: async () => { notifications.push('changed'); } }, version);
  assert.equal(c.init.result.capabilities.tools.listChanged, true);
  f.owner.register(tool()); f.owner.register(tool({ id: 'user.sample.second' })); await flush();
  assert.deepEqual(notifications, ['changed']); assert.equal((await c.list()).filter(t => t.name.startsWith('user_')).length, 2);
  c.c.close(); await f.owner.dispose(); await flush(); assert.equal(notifications.length, 1);
});
test('an existing connection discovers, invokes, replaces and removes a dynamic tool without reconnecting', async () => {
  const f = fixture(), c = await connect(f); c.c.authorize('analysis'); f.owner.register(tool());
  assert.equal((await c.call('user_sample_value')).code, 'tool_changed');
  const listed = (await c.list()).find(t => t.name === 'user_sample_value'); assert.equal(listed.title, '我的工具');
  assert.equal((await c.call('user_sample_value', 'old-call')).data, 1);
  await f.owner.update(tool({ run: () => 2 }));
  assert.equal((await c.call('user_sample_value', 'old-call')).code, 'tool_changed');
  assert.equal((await c.call('user_sample_value')).code, 'tool_changed');
  await c.list(); assert.equal((await c.call('user_sample_value')).data, 2);
  await f.owner.unregister('user.sample.value'); assert.equal((await c.call('user_sample_value')).code, 'tool_changed');
  assert.ok(!(await c.list()).some(t => t.name === 'user_sample_value'));
  assert.equal((await c.call('tf_test_stable')).data, 1); c.c.close(); await f.owner.dispose();
});
test('new or changed writes inherit the existing one-time external grant', async () => {
  const f = fixture(); f.owner.register(tool()); const c = await connect(f); c.c.authorize('analysis');
  assert.equal((await c.call('user_sample_value')).data, 1); let writes = 0;
  await f.owner.update(tool({ effect: 'write', prepare: () => ({ result: 2, commit() { writes++; }, rollback() { writes--; } }) }));
  await c.list(); assert.equal((await c.call('user_sample_value')).data, 2); assert.equal(writes, 1);
  assert.equal(c.c.view().approvals.length, 0);
  c.c.close(); await f.owner.dispose();
});
test('dynamic writes need no per-operation approval and replacement still invalidates old request identities', async () => {
  const f = fixture(); let writes = 0;
  const write = tool({ effect: 'write', prepare: () => ({ result: 1, commit() { writes++; }, rollback() { writes--; } }) });
  f.owner.register(write); const c = await connect(f); c.c.authorize('assist');
  const first = await c.call('user_sample_value', 'before-update'); assert.equal(first.data, 1); assert.equal(writes, 1);
  assert.equal(c.c.view().approvals.length, 0);
  await f.owner.update({ ...write, version: 2 }); await flush();
  assert.equal((await c.call('user_sample_value', 'before-update')).code, 'tool_changed');
  await c.list(); assert.equal((await c.call('user_sample_value', 'after-update')).data, 1);
  assert.equal(writes, 2); assert.equal(c.c.view().approvals.length, 0); c.c.close(); await f.owner.dispose();
});
test('slow notification transport retains only one send and one dirty marker', async () => {
  const f = fixture(), gate = deferred(); let active = 0, max = 0, calls = 0;
  const c = await connect(f, { toolsChanged: async () => { max = Math.max(max, ++active); calls++; await gate.promise; active--; } });
  f.owner.register(tool()); await flush();
  for (let i = 0; i < 50; i++) await f.owner.update(tool({ version: i + 2 }));
  assert.equal(calls, 1); gate.resolve(); await flush(); assert.equal(max, 1); assert.equal(calls, 2);
  c.c.close(); await f.owner.dispose();
});
const profile = protocol => ({ revision: 'fixture', hasKey: false, remembered: false, settings: {
  protocol, endpoint: 'https://example.invalid', model: 'fixture', stream: false, tools: true,
  includeUsage: false, chatTokenField: 'max_tokens', maxTokens: 1024, timeoutSeconds: 30, allowLocalHttp: false } });
const turn = (protocol, name, id = 'call') => {
  const args = JSON.stringify({ input: {} });
  return { text: '', calls: [{ id, name, arguments: args }], usage: { inputTokens: 1, outputTokens: 1 },
    replay: protocol === 'chat' ? [{ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: args } }] }]
      : protocol === 'responses' ? [{ type: 'function_call', call_id: id, name, arguments: args }]
      : [{ role: 'assistant', content: [{ type: 'tool_use', id, name, input: { input: {} } }] }] };
};
const done = () => ({ text: '完成', calls: [], usage: { inputTokens: 1, outputTokens: 1 }, replay: [] });
for (const protocol of ['chat', 'responses', 'anthropic']) test(`${protocol}: next model turn refreshes tools without losing conversation`, async () => {
  const f = fixture(); let requests = 0;
  const convo = new ApiConversation(f.host, { async turn(_profile, request) {
    const names = request.tools.map(t => (t.function ?? t).name); requests++;
    if (requests === 1) { assert.ok(!names.includes('user_sample_value')); return done(); }
    assert.ok(names.includes('user_sample_value'));
    if (requests === 2) return turn(protocol, 'user_sample_value');
    return done();
  } });
  convo.reset(profile(protocol)); await convo.send('先正常聊天'); f.owner.register(tool()); await convo.send('使用新工具');
  assert.equal(convo.view().failed, false); assert.equal(requests, 3); assert.equal(convo.view().messages.filter(m => m.role === 'user').length, 2);
  convo.reset(); await f.owner.dispose();
});
for (const protocol of ['chat', 'responses', 'anthropic']) test(`${protocol}: an in-flight model response cannot call a replaced implementation`, async () => {
  const f = fixture(); let requests = 0, newRuns = 0; f.owner.register(tool());
  const convo = new ApiConversation(f.host, { async turn(_profile, request) {
    requests++;
    if (requests === 1) { await f.owner.update(tool({ run: () => { newRuns++; return 2; } })); return turn(protocol, 'user_sample_value', 'old'); }
    if (requests === 2) { assert.ok(JSON.stringify(request).includes('tool_changed')); return turn(protocol, 'user_sample_value', 'new'); }
    return done();
  } });
  convo.reset(profile(protocol)); await convo.send('使用当前工具');
  assert.equal(convo.view().failed, false); assert.equal(requests, 3); assert.equal(newRuns, 1);
  convo.reset(); await f.owner.dispose();
});
test('long internal identities get a stable protocol-compatible name instead of an arbitrary identity ban', async () => {
  const f = fixture(), id = `user.sample.${'long_identity_'.repeat(7)}`;
  f.owner.register(tool({ id })); const c = await connect(f); c.c.authorize('analysis');
  const descriptor = (await c.list()).find(t => t._meta?.['tradeflow/id'] === id);
  assert.ok(descriptor); assert.match(descriptor.name, /^[a-zA-Z0-9_-]{1,64}$/);
  const wireName = descriptor.name; assert.equal((await c.call(wireName)).data, 1);
  await f.owner.update(tool({ id, version: 2, run: () => 2 }));
  assert.equal((await c.list()).find(t => t._meta?.['tradeflow/id'] === id).name, wireName);
  assert.equal((await c.call(wireName)).data, 2); c.c.close(); await f.owner.dispose();
});
test('notification failure closes its own session and subscriptions without changing other clients', async () => {
  const f = fixture(); let callbacks = 0;
  const bad = await connect(f, { toolsChanged: async () => { callbacks++; throw Error('fixture offline'); } });
  const good = await connect(f); bad.c.authorize('analysis'); good.c.authorize('analysis');
  f.owner.register(tool()); await flush(); assert.equal(bad.c.view().access, 'closed');
  await good.list(); assert.equal((await good.call('user_sample_value')).data, 1);
  await f.owner.update(tool({ version: 2 })); await flush(); assert.equal(callbacks, 1);
  good.c.close(); await f.owner.dispose();
});

for (const action of ['update', 'unregister']) test(`a failed compensation during dynamic ${action} is not hidden behind tool_changed`, async () => {
  const f = fixture(), gate = deferred(); let value = 0;
  f.owner.register(tool({ effect: 'write', prepareAsync: async () => ({ result: 1,
    async commit() { value = 1; await gate.promise; },
    async rollback() { throw new Error('fixture compensation could not restore state'); },
  }) }));
  const c = await connect(f); c.c.authorizeAssistant();
  const pending = c.call('user_sample_value'); await flush(); assert.equal(value, 1);
  const retirement = action === 'update' ? f.owner.update(tool({ version: 2 })) : f.owner.unregister('user.sample.value');
  gate.resolve();
  const result = await pending; await retirement;
  assert.equal(result.status, 'error'); assert.equal(result.code, 'rollback_failed');
  assert.equal(JSON.stringify(result).includes('fixture compensation'), false, 'transport only exposes the structured error');
  assert.equal(value, 1, 'failure must not imply that the old state was recovered');
  c.c.close(); await f.owner.dispose();
});
