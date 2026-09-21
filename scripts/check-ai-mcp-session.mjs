import assert from 'node:assert/strict';
import { McpConnection, MCP_LIMITS } from '../src/ai-mcp/session.ts';
import { CapabilityCore, CapabilityRegistry } from '../src/ai-capabilities/index.ts';
import { CapabilityError } from '../src/ai-capabilities/contracts.ts';
import { ValueValidationError } from '../src/ai-capabilities/json.ts';
import { formatMcpConfiguration } from '../src/ai-mcp/transport.ts';
import { readFileSync } from 'node:fs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const empty = schema({});
const numeric = schema({ n: { type: 'number' } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rpc = (id, method, params = {}) => JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params });
function fixture(options = {}) {
  let context = { appInstanceId: 'app-mcp', chartId: 'main', provider: 'tdx', instrument: 'SH:600000',
    resolution: '1D', adjustment: 'none', selectionGeneration: 1 };
  let reads = 0; let writes = 0;
  const tools = [
    { id: 'tf.chart.snapshot', version: 1, description: 'Read a test value', effect: 'read', inputSchema: empty,
      outputSchema: numeric, run: async () => { reads++; await options.wait?.(); if (options.fail) throw Error('secret-token:/src/main.ts'); return { n: reads }; } },
    ...['tf.drawings.apply', 'tf.drawings.apply_existing', 'tf.drawings.revert', 'tf.drawings.revert_saved'].map(id => ({
      id, version: 1, description: 'Write test value through a transaction', effect: 'write', inputSchema: numeric,
      outputSchema: numeric, run: () => { throw Error('must never run raw write'); },
      prepare: input => ({ result: { n: input.n }, commit: () => { writes++; }, rollback: () => { writes--; } }),
    })),
    { id: 'tf.test.semantic_error', version: 1, description: 'Semantic diagnostic fixture', effect: 'read', inputSchema: empty,
      outputSchema: numeric, run: () => { throw new ValueValidationError('inputsJson.period', 'out_of_range', 'number <= 500'); } },
    { id: 'tf.test.capacity_error', version: 1, description: 'Capacity diagnostic fixture', effect: 'read', inputSchema: empty,
      outputSchema: numeric, run: () => { throw new CapabilityError('snapshot_capacity',
        { resource: 'indicator_drafts', limit: 8, inUse: 8, hint: 'install or release an unused indicator draft' }); } },
  ];
  const registry = new CapabilityRegistry(tools); const core = new CapabilityCore(registry);
  const host = { context: () => context, describe: () => registry.describe(),
    open: permissions => core.openSession({ context, currentContext: () => context, permissions }) };
  const connection = new McpConnection(host, () => {}, { approvalMs: options.approvalMs ?? 200 });
  const call = async (id, method, params) => {
    const result = await connection.receive(rpc(id, method, params)); return result === null ? null : JSON.parse(result);
  };
  const init = async (version = '2025-11-25') => {
    const response = await call('init', 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: options.name ?? 'test client', version: '1' } });
    await call(undefined, 'notifications/initialized'); return response;
  };
  const tool = (id, name = 'tf_chart_snapshot', input = {}, scope = context) =>
    call(id, 'tools/call', { name, arguments: name === 'tf_context_get' ? input : { context: scope, input } });
  const authorize = async (mode = 'assist') => { await init(); connection.authorize(mode); };
  return { connection, core, call, init, tool, authorize, context: () => context,
    switch: () => { context = { ...context, selectionGeneration: context.selectionGeneration + 1 }; },
    counts: () => ({ reads, writes }), close: () => connection.close() };
}
const data = response => response.result.structuredContent.reply;
const code = response => data(response).code;

test('legacy negotiation, modern discovery fallback and notification handshake', async () => {
  const f = fixture();
  assert.equal((await f.call(1, 'server/discover')).error.code, -32601);
  assert.equal((await f.call(2, 'tools/list')).error.code, -32002);
  assert.equal((await f.init('future')).result.protocolVersion, '2025-11-25');
  assert.equal(f.connection.view().ready, true);
  assert.equal((await f.call(3, 'initialize')).error.code, -32602);
  assert.equal(await f.call(undefined, 'notifications/unknown'), null); f.close();
});
test('supported old version is echoed, unsupported capabilities are not advertised', async () => {
  const f = fixture(); const response = await f.init('2025-06-18');
  assert.equal(response.result.protocolVersion, '2025-06-18');
  assert.deepEqual(Object.keys(response.result.capabilities), ['tools']); f.close();
});
test('tool table is static data with exact context and no approval/system tool', async () => {
  const f = fixture(); await f.init(); const list = (await f.call(1, 'tools/list')).result.tools;
  assert.equal(list[0].name, 'tf_context_get');
  assert.deepEqual(list[1].inputSchema.required, ['context', 'input']);
  assert.equal(list[1].inputSchema.additionalProperties, false);
  assert.ok(list.every(row => !/approve|shell|file|eval|source|invoke/.test(row.name)));
  assert.equal((await f.call(2, 'tools/list', { cursor: 'unknown' })).error.code, -32602); f.close();
});
test('pairing and initialization do not grant any chart metadata or data', async () => {
  const f = fixture(); await f.init();
  assert.equal(code(await f.tool(1)), 'authorization_required');
  assert.equal(code(await f.tool(2, 'tf_context_get')), 'authorization_required');
  assert.deepEqual(f.counts(), { reads: 0, writes: 0 }); f.close();
});
test('host-authorized exact chart reads and structured/text representations agree', async () => {
  const f = fixture(); await f.authorize();
  assert.deepEqual(data(await f.tool(1, 'tf_context_get')).context, f.context());
  const result = await f.tool(2); assert.equal(result.result.isError, false);
  assert.deepEqual(JSON.parse(result.result.content[0].text), result.result.structuredContent);
  assert.equal(data(result).data.n, 1); f.close();
});
test('one external authorization grants every exposed business tool without per-operation approval modes', async () => {
  for (const mode of ['analysis','assist','workbench']) {
    const f = fixture(); await f.authorize(mode);
    for (const [index,name] of ['tf_drawings_apply','tf_drawings_apply_existing','tf_drawings_revert','tf_drawings_revert_saved'].entries()) {
      const result=await f.tool(mode+'-'+index,name,{n:index+1});
      assert.equal(data(result).status,'ok');assert.equal(f.connection.view().approvals.length,0);
    }
    assert.equal(f.counts().writes,4);f.close();
  }
});
test('wire cannot self-authorize; approved metadata has no authority and no extra prompt is needed after the UI grant', async () => {
  const f = fixture(); await f.authorize();
  assert.equal((await f.call(1, 'approve', { approved: true })).error.code, -32601);
  const invalid = await f.tool(2, 'tf_drawings_apply', { n: 1, approved: true });
  assert.equal(invalid.error.code, -32602);
  assert.equal(invalid.error.data.path, 'arguments.input.approved');
  assert.equal(invalid.error.data.reason, 'unexpected_field');
  assert.match(invalid.error.data.expected, /n/);
  const result = await f.call(3, 'tools/call', { name: 'tf_drawings_apply', arguments: { context: f.context(), input: { n: 1 } }, _meta: { approved: true } });
  assert.equal(data(result).status,'ok');assert.equal(f.counts().writes,1);assert.equal(f.connection.view().approvals.length,0);f.close();
});
test('invalid MCP tool arguments identify the exact missing field and expected shape', async () => {
  const f = fixture(); await f.authorize();
  const missing = await f.call(1, 'tools/call', { name: 'tf_drawings_apply', arguments: { context: f.context(), input: {} } });
  assert.equal(missing.error.code, -32602);
  assert.equal(missing.error.data.path, 'arguments.input.n');
  assert.equal(missing.error.data.reason, 'required_field_missing');
  assert.match(missing.error.data.expected, /finite number/);
  f.close();
});
test('business semantic and capacity diagnostics survive the MCP relay', async () => {
  const f = fixture(); await f.authorize();
  const semantic = data(await f.tool(1, 'tf_test_semantic_error'));
  assert.equal(semantic.status, 'error'); assert.equal(semantic.code, 'invalid_request');
  assert.equal(semantic.path, 'inputsJson.period'); assert.equal(semantic.reason, 'out_of_range');
  assert.equal(semantic.expected, 'number <= 500');
  assert.deepEqual(semantic.details, {
    path: 'inputsJson.period', reason: 'out_of_range', expected: 'number <= 500',
  });
  const capacity = data(await f.tool(2, 'tf_test_capacity_error'));
  assert.equal(capacity.status, 'error'); assert.equal(capacity.code, 'snapshot_capacity');
  assert.deepEqual(capacity.details, { resource: 'indicator_drafts', limit: 8, inUse: 8,
    hint: 'install or release an unused indicator draft' });
  f.close();
});
test('duplicate request IDs never execute a write twice; changed input conflicts', async () => {
  const f = fixture(); await f.authorize('workbench');
  const first = await f.tool(1, 'tf_drawings_apply', { n: 1 });
  assert.deepEqual(await f.tool(1, 'tf_drawings_apply', { n: 1 }), first);
  assert.equal((await f.tool(1, 'tf_drawings_apply', { n: 2 })).error.code, -32600);
  assert.equal(f.counts().writes, 1); f.close();
});
test('duplicate write shares one result and one commit without any prompt', async () => {
  const f = fixture(); await f.authorize();
  const a = f.tool(1, 'tf_drawings_apply', { n: 1 }); const b = f.tool(1, 'tf_drawings_apply', { n: 1 });
  await sleep(0); assert.equal(f.connection.view().approvals.length, 0);
  assert.deepEqual(await a, await b);
  assert.equal(f.counts().writes, 1); f.close();
});
test('cancel during a slow read does not deliver data after cancellation', async () => {
  let resolve; const f = fixture({ wait: () => new Promise(r => { resolve = r; }) }); await f.authorize();
  const p = f.tool(1); await sleep(0); await f.call(undefined, 'notifications/cancelled', { requestId: 1 });
  resolve(); assert.equal(await p, null); f.close();
});
test('one authorization survives chart changes; old context is rejected and current context works without another UI grant', async () => {
  const f = fixture(); await f.authorize(); const original = f.context();
  f.switch();f.connection.invalidate();
  assert.equal(f.connection.view().access,'authorized');
  assert.equal(f.core.openSessions,1);
  const current=f.context();
  assert.deepEqual(data(await f.tool(1,'tf_context_get')).context,current);
  assert.equal(code(await f.tool(2,'tf_drawings_apply_existing',{n:1},original)),'context_stale');
  assert.equal(data(await f.tool(3,'tf_drawings_apply_existing',{n:2},current)).status,'ok');
  assert.equal(f.connection.view().approvals.length,0);assert.equal(f.counts().writes,1);f.close();
});
test('revocation forbids replaying cached data and reauthorization keeps old ID tombstones', async () => {
  const f = fixture(); await f.authorize(); await f.tool(1); f.connection.revoke();
  assert.equal(code(await f.tool(1)), 'context_stale'); assert.equal(f.core.openSessions, 0);
  f.connection.authorize('assist'); assert.equal(code(await f.tool(1)), 'context_stale');
  assert.equal(data(await f.tool(2)).status, 'ok'); f.close();
});
test('close destroys core session, pending work and retained data access', async () => {
  let resolve;const f=fixture({wait:()=>new Promise(r=>{resolve=r;})});await f.authorize();const p=f.tool(1);
  await sleep(0);f.close();resolve();assert.equal(await p,null);assert.equal(f.core.openSessions,0);
  assert.equal(await f.tool(2), null); assert.equal(f.connection.view().approvals.length, 0);
});
test('closed is terminal even when an already queued UI revoke arrives afterwards', async () => {
  const f = fixture(); await f.authorize(); f.close();
  f.connection.revoke(); f.connection.invalidate();
  assert.equal(f.connection.view().access, 'closed');
  assert.throws(() => f.connection.authorize('workbench'), /invalid MCP authorization/);
  assert.equal(f.core.openSessions, 0);
  assert.equal(await f.tool(1), null);
});
test('malformed JSON, unsafe IDs, prototype fields and unsupported batch are rejected', async () => {
  const f = fixture();
  for (const value of ['{', '[{}]', 'null', '{"jsonrpc":"2.0","id":{},"method":"ping"}',
    '{"jsonrpc":"2.0","id":1,"method":"ping","params":{"__proto__":{}}}',
    '{"jsonrpc":"2.0","id":9007199254740992,"method":"ping"}', ' '.repeat(65537)]) {
    const result = JSON.parse(await f.connection.receive(value)); assert.ok(result.error);
  }
  f.close();
});
test('host errors are sanitized, not paths or credentials', async () => {
  const f = fixture({ fail: true }); await f.authorize(); const r = await f.tool(1);
  assert.equal(code(r), 'tool_failed'); assert.doesNotMatch(JSON.stringify(r), /secret-token|main\.ts/); f.close();
});
test('client identity is a bounded untrusted label, not HTML or authority', async () => {
  const f = fixture({ name: '<img src=x onerror=alert(1)>' + 'x'.repeat(100) }); await f.init();
  assert.equal(f.connection.view().name.length, 80); assert.equal(f.connection.view().access, 'pending'); f.close();
});
test('bounded session history tells the client to reconnect instead of evicting idempotency', async () => {
  const f = fixture(); await f.authorize();
  for (let i = 0; i < MCP_LIMITS.requests; i++) assert.equal(data(await f.tool(i, 'tf_context_get')).mode, 'workbench');
  assert.equal(code(await f.tool(MCP_LIMITS.requests + 1, 'tf_context_get')), 'session_capacity'); f.close();
});
test('wire tool name collisions cannot replace a registered tool', () => {
  const descriptor = id => ({ id, version: 1, effect: 'read', description: 'read', inputSchema: empty, outputSchema: empty });
  assert.throws(() => new McpConnection({ describe: () => [descriptor('tf.a_b.c'), descriptor('tf.a.b_c')] }), /collision/);
});
test('config uses the native helper and exact run credential, without a source cwd', () => {
  const config = { serverId: 'run', port: 50123, token: 'a'.repeat(64), executable: '/Apps/Trade Flow "test"/binary', runtimeFile: '/Users/test/Library/Application Support/TradeFlow Lite/mcp-runtime-v1.json' };
  const json = JSON.parse(formatMcpConfiguration(config, 'json')).mcpServers.tradeflow_lite;
  assert.deepEqual(json.args, ['--mcp-stdio']); assert.equal(json.env.TRADEFLOW_MCP_PORT, '50123');
  assert.equal(json.env.TRADEFLOW_MCP_RUNTIME_FILE, config.runtimeFile);
  assert.equal(json.command, config.executable); assert.equal(json.cwd, undefined);
  assert.match(formatMcpConfiguration(config, 'codex'), /tool_timeout_sec = 150/);
  assert.throws(() => formatMcpConfiguration({ ...config, token: 'bad' }, 'json'));
  assert.throws(() => formatMcpConfiguration({ ...config, runtimeFile: '' }, 'json'));
});
test('built-in assistant grant executes current chart writes without extending external grants', async () => {
  const f=fixture();await f.init();f.connection.authorizeAssistant();
  for(const [index,name] of ['tf_drawings_apply','tf_drawings_apply_existing','tf_drawings_revert','tf_drawings_revert_saved'].entries()) {
    const reply=await f.tool(index,name,{n:index});assert.equal(data(reply).status,'ok');assert.equal(f.connection.view().approvals.length,0);
  }
  assert.equal(f.counts().writes,4);f.close();assert.throws(()=>f.connection.authorizeAssistant(),/invalid MCP authorization/);
});
test('external MCP wire cannot self-authorize before the one trusted UI authorization', async () => {
  const f=fixture();await f.authorize('analysis');
  assert.equal((await f.call(1,'authorizeAssistant')).error.code,-32601);
  const reply=await f.call(2,'tools/call',{name:'tf_drawings_apply_existing',arguments:{context:f.context(),input:{n:1}},_meta:{assistant:true,mode:'full'}});
  assert.equal(data(reply).status,'ok');assert.equal(f.counts().writes,1);f.close();
});
test('future registered business writes inherit the already-authorized external connection without a second prompt', async () => {
  let permissions;const f=fixture();
  const connection=new McpConnection({context:f.context,describe:()=>[{id:'tf.future.write',version:1,effect:'write',description:'future',inputSchema:empty,outputSchema:empty}],
    open:value=>{permissions=value;return {close(){}};}});
  await connection.receive(rpc(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}));
  await connection.receive(rpc(undefined,'notifications/initialized'));connection.authorize('assist');
  assert.equal(permissions['tf.future.write'],'allow');connection.close();f.close();
});
test('source boundaries keep host grants and account tokens out of wire dispatch', () => {
  const source = readFileSync(new URL('../src/ai-mcp/session.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /@tauri-apps|eval\(|new Function|process\.|API_KEY|MCP_TOKEN/);
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /function invalidateAiChartSessions\(\): void \{\s*aiMcpController\.invalidate\(\)/);
});

let failures = 0;
for (const [name, run] of tests) {
  try { await run(); } catch (e) { failures++; console.error(`FAIL ${name}`, e); }
}
if (failures) throw Error(`MCP session: ${failures}/${tests.length} failed`);
console.log(`MCP session: ${tests.length} scenarios passed`);
