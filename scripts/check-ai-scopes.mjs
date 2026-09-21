import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { McpConnection } from '../src/ai-mcp/session.ts';

const chart = (generation = 1) => ({ appInstanceId: 'app', chartId: 'main', provider: 'tdx',
  instrument: 'SH:600000', resolution: '1D', adjustment: 'none', selectionGeneration: generation });
const app = { scope: 'app', appInstanceId: 'app' };
const empty = { type: 'object', properties: {}, additionalProperties: false };
const makeTool = (scope, run = () => 1) => ({ id: `tf.test.${scope}`, version: 1, description: `${scope} test`,
  scope, effect: 'read', inputSchema: empty, outputSchema: { type: 'number' }, run });
const request = (toolId, context, requestId = 'r') => JSON.stringify({ protocolVersion: 1, requestId, toolId, context, input: {} });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function fixture(run) {
  let context = chart();
  const registry = new CapabilityRegistry([makeTool('app', run), makeTool('chart')]);
  const core = new CapabilityCore(registry);
  const host = { context: () => context, describe: () => registry.describe(),
    open: permissions => core.openSession({ context, currentContext: () => context, permissions }) };
  const session = host.open({ 'tf.test.app': 'allow', 'tf.test.chart': 'allow' });
  return { registry, core, host, session, change: value => { context = value; } };
}

test('scope metadata is preserved; unsupported scopes are rejected', () => {
  const f = fixture();
  assert.deepEqual(f.registry.describe().map(t => t.scope), ['app', 'chart']);
  assert.throws(() => new CapabilityRegistry([makeTool('system')]), /invalid_contract/);
  f.session.close();
});
test('App-only sessions require no chart and cannot impersonate Chart scope', async () => {
  const core = new CapabilityCore(new CapabilityRegistry([makeTool('app'), makeTool('chart')]));
  const session = core.openSession({ context: app, currentContext: () => app,
    permissions: { 'tf.test.app': 'allow', 'tf.test.chart': 'allow' } });
  assert.equal((await session.invoke(request('tf.test.app', app))).status, 'ok');
  assert.equal((await session.invoke(request('tf.test.chart', chart(), 'chart'))).code, 'context_stale');
  session.close();
});
test('chart changes do not invalidate App queries but still invalidate Chart queries', async () => {
  const f = fixture(); f.change(chart(3));
  assert.equal((await f.session.invoke(request('tf.test.app', app))).status, 'ok');
  assert.equal((await f.session.invoke(request('tf.test.chart', chart(), 'chart'))).code, 'context_stale');
  assert.equal((await f.session.invoke(request('tf.test.chart', app, 'forged-app'))).code, 'context_stale');
  assert.equal((await f.session.invoke(request('tf.test.app', chart(), 'forged-chart'))).code, 'context_stale');
  assert.equal((await f.session.invoke(request('tf.test.app', { ...app, appInstanceId: 'other' }, 'other'))).code, 'context_stale');
  f.session.close();
});
test('in-flight App result survives chart invalidation, not application revocation', async () => {
  let finish, signal;
  const f = fixture((_input, ctx) => { signal = ctx.session.signal; return new Promise(r => { finish = r; }); });
  const pending = f.session.invoke(request('tf.test.app', app)); await flush();
  f.change(chart(2)); f.core.invalidateCharts();
  assert.equal(signal.aborted, false); finish(7);
  assert.equal((await pending).data, 7);
  assert.equal((await f.session.invoke(request('tf.test.chart', chart(), 'stale'))).code, 'context_stale');
  f.session.close(); assert.equal(signal.aborted, true);
  assert.equal((await f.session.invoke(request('tf.test.app', app, 'closed'))).code, 'session_closed');
});
test('chart invalidation releases chart-owned resources and cannot be undone by ABA', async () => {
  let chartSignal;
  const registry = new CapabilityRegistry([makeTool('chart', (_input, ctx) => { chartSignal = ctx.session.signal; return 1; })]);
  const core = new CapabilityCore(registry);
  const session = core.openSession({ context: chart(), currentContext: chart, permissions: { 'tf.test.chart': 'allow' } });
  await session.invoke(request('tf.test.chart', chart()));
  core.invalidateCharts(); assert.equal(chartSignal.aborted, true);
  assert.equal((await session.invoke(request('tf.test.chart', chart(), 'again'))).code, 'context_stale');
  session.close();
});
test('App query cancellation rejects late results and keeps the active slot until settled', async () => {
  let finish;
  const f = fixture(() => new Promise(r => { finish = r; }));
  const pending = f.session.invoke(request('tf.test.app', app)); await flush();
  f.session.cancel('r'); assert.equal((await pending).code, 'cancelled');
  assert.equal(f.core.activeTasks, 1); finish(1); await flush();
  assert.equal(f.core.activeTasks, 0); f.session.close();
});

async function initialized(f) {
  const connection = new McpConnection(f.host);
  await connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }));
  await connection.receive(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  return connection;
}
const call = (c, name, args = { input: {} }, id = 'call') => c.receive(JSON.stringify({ jsonrpc: '2.0', id,
  method: 'tools/call', params: { name, arguments: args } })).then(JSON.parse);
test('MCP App tools use input only; authorization is still required and wire scope cannot widen it', async () => {
  const f = fixture(); const c = await initialized(f);
  const listed = JSON.parse(await c.receive(JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }))).result.tools;
  assert.deepEqual(listed.find(t => t.name === 'tf_test_app').inputSchema.required, ['input']);
  assert.deepEqual(listed.find(t => t.name === 'tf_test_chart').inputSchema.required, ['context', 'input']);
  assert.equal((await call(c, 'tf_test_app')).result.structuredContent.reply.code, 'authorization_required');
  c.authorizeAssistant();
  assert.equal((await call(c, 'tf_test_app', { input: {} }, 'valid')).result.structuredContent.reply.status, 'ok');
  assert.equal((await call(c, 'tf_test_app', { context: chart(), input: {} }, 'forged')).error.code, -32602);
  c.close(); f.session.close();
});
test('MCP keeps authorized App reads after chart change; old chart requests and revoked reads stay denied', async () => {
  const f = fixture(); const c = await initialized(f); c.authorizeAssistant();
  f.change(chart(2)); c.invalidate(); f.core.invalidateCharts();
  assert.equal((await call(c, 'tf_test_app')).result.structuredContent.reply.status, 'ok');
  assert.equal((await call(c, 'tf_test_chart', { context: chart(), input: {} }, 'stale')).result.structuredContent.reply.code, 'context_stale');
  c.revoke();
  assert.equal((await call(c, 'tf_test_app', { input: {} }, 'revoked')).result.structuredContent.reply.code, 'authorization_required');
  c.close(); f.session.close();
});

test('cached MCP App results cannot be replayed after the app identity changes', async () => {
  const f = fixture(); const c = await initialized(f); c.authorizeAssistant();
  assert.equal((await call(c, 'tf_test_app')).result.structuredContent.reply.status, 'ok');
  f.change({ ...chart(), appInstanceId: 'replacement-app' });
  assert.equal((await call(c, 'tf_test_app')).result.structuredContent.reply.code, 'context_stale');
  c.close(); f.session.close();
});

test('chart invalidation does not revoke the one-time authorization for App writes', async () => {
  let current = chart(); let writes = 0;
  const tool = { ...makeTool('app'), effect: 'write', prepare: () => ({ result: 1,
    commit: () => { writes++; }, rollback: () => { writes--; } }) };
  const registry = new CapabilityRegistry([tool]); const core = new CapabilityCore(registry);
  const host = { context: () => current, describe: () => registry.describe(),
    open: permissions => core.openSession({ context: current, currentContext: () => current, permissions }) };
  const c = await initialized({ host }); c.authorize('assist');
  assert.equal((await call(c, 'tf_test_app', { input: {} }, 'write-1')).result.structuredContent.reply.status, 'ok'); assert.equal(writes, 1);
  assert.equal(c.view().approvals.length, 0);
  current = chart(2); c.invalidate();
  assert.equal(c.view().access, 'authorized');
  assert.equal((await call(c, 'tf_test_app', { input: {} }, 'write-2')).result.structuredContent.reply.status, 'ok'); assert.equal(writes, 2);
  assert.equal(c.view().approvals.length, 0);
  c.close(); core.closeSessions();
});
