import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createWorkspaceReadTools } from '../src/ai-capabilities/workspace-tools.ts';
import { createMarketQueryTools } from '../src/ai-capabilities/market-tools.ts';
import { createNativeMarketQueryPort } from '../src/ai-capabilities/market-query.ts';
import { ChartReadBridge } from '../src/ai-capabilities/chart-host.ts';
import { McpConnection } from '../src/ai-mcp/session.ts';
import { ApiConversation } from '../src/ai-api/conversation.ts';

const chart = { appInstanceId: 'workspace-test', chartId: 'main', provider: 'tdx', instrument: 'SH:600000',
  resolution: '1D', adjustment: 'none', selectionGeneration: 1 };
const app = { scope: 'app', appInstanceId: chart.appInstanceId };
const symbol = (providerId, name, code = '600000') => ({ providerId, providerDisplayName: providerId, venue: 'SH', exchange: 'SH',
  symbol: `SH:${code}`, code, name, kind: 'stock', aliases: ['test alias'] });
const provider = (id, catalog = false) => ({ id, displayName: id, version: '1', contractVersion: '3', enabled: true,
  capabilities: { catalog, history: true, quote: true, realtime: false, venues: ['SH'], kinds: ['stock'], resolutions: ['1D'], adjustments: ['none'] } });
function fixture() {
  let context = { ...chart }; let registryReads = 0; let remoteReads = 0; let catalogState = { loaded: true, complete: false };
  const providers = [provider('tdx'), provider('other', true)];
  const symbols = [symbol('tdx', '甲'), symbol('other', '乙'), symbol('tdx', '丙', '600001')];
  const definitions = [{ id: 'user.example', name: '示例', indicatorVersion: 1, runtimeKind: 'user', inputs: {},
    description: '普通指标', source: 'SECRET SOURCE', create() { throw new Error('must not execute'); } }];
  const host = { async providers() { registryReads++; return providers; }, symbols: () => symbols,
    async catalog(input) { remoteReads++; return { symbols: [symbols[1]], nextCursor: input.cursor ? null : 'page-two' }; },
    catalogStatus(providerId) { return providerId === 'other' ? catalogState : { loaded: true, complete: true }; },
    watchlist: () => [{ key: 'other|SH:600000', symbol: symbols[1] }, { key: 'lost|SH:600999', symbol: null }],
    definitions: () => definitions, instances: () => [{ instanceId: 'i1', indicatorId: 'user.example', indicatorVersion: 1,
      runtimeKind: 'user', sourceHash: 'a'.repeat(64), visible: true, running: false, failed: true,
      failurePhase: 'realtime', failureCode: 'runtime_exception', failureDetail: 'realtime failure sentinel', inputs: { period: 20 } }],
    library: () => ({ ready: true, records: definitions }) };
  const tools = createWorkspaceReadTools(host);
  const bridge = new ChartReadBridge({ currentContext: () => context,
    readState() { throw new Error('metadata must not read current bars'); }, tools });
  const permissions = Object.fromEntries(bridge.describe().map(t => [t.id, 'allow']));
  const session = bridge.openSession(permissions); let sequence = 0;
  return { host, bridge, tools, definitions, providers, symbols, session,
    counts: () => ({ registryReads, remoteReads }), change() { context = { ...context, selectionGeneration: context.selectionGeneration + 1 }; bridge.invalidateChart(); },
    setCatalogState(value) { catalogState = value; },
    invoke: (toolId, input = {}, selected = app) => session.invoke(JSON.stringify({ protocolVersion: 1,
      requestId: `w-${++sequence}`, toolId, context: selected, input })) };
}

test('workspace discovery is lazy and every added read shares the registry', () => {
  const f = fixture(); assert.deepEqual(f.counts(), { registryReads: 0, remoteReads: 0 });
  assert.equal(f.tools.length, 8); assert.ok(f.tools.every(t => t.effect === 'read'));
  for (const tool of f.tools) assert.ok(f.bridge.describe().some(d => d.id === tool.id));
  f.bridge.close();
});
test('provider listing/description derives supported capabilities from the host', async () => {
  const f = fixture();
  const listed = await f.invoke('tf.market.providers'); assert.equal(listed.status, 'ok');
  assert.deepEqual(listed.data.items.map(p => p.id), ['tdx', 'other']);
  const detail = await f.invoke('tf.market.provider', { providerId: 'other' });
  assert.equal(detail.data.capabilities.catalog, true);
  assert.equal((await f.invoke('tf.market.provider', { providerId: 'missing' })).code, 'field_unavailable');
  f.bridge.close();
});
test('search pages all loaded matches, preserves provider identity and states its coverage', async () => {
  const f = fixture();
  const first = await f.invoke('tf.market.search', { query: '600000', limit: 1 });
  assert.equal(first.status, 'ok'); assert.equal(first.data.total, 2); assert.equal(first.data.nextOffset, 1);
  assert.equal(first.data.coverage, 'loaded-catalog'); assert.equal(first.data.catalogLoaded, true); assert.equal(first.data.catalogComplete, true);
  const next = await f.invoke('tf.market.search', { query: '600000', offset: 1, limit: 1 });
  assert.notEqual(first.data.items[0].providerId, next.data.items[0].providerId);
  assert.equal(next.data.nextOffset, undefined);
  const remote = await f.invoke('tf.market.search', { query: 'test alias', providerId: 'other' });
  assert.equal(remote.data.total, 1); assert.equal(remote.data.ready, true); assert.equal(remote.data.catalogLoaded, true); assert.equal(remote.data.catalogComplete, false);
  assert.deepEqual(f.counts(), { registryReads: 0, remoteReads: 0 }); f.bridge.close();
});
test('search distinguishes an unloaded provider catalog from an exhaustive zero-match result', async () => {
  const f = fixture(); f.setCatalogState({ loaded: false, complete: false });
  const result = await f.invoke('tf.market.search', { query: 'NOT-LOADED', providerId: 'other' });
  assert.equal(result.status, 'ok'); assert.equal(result.data.total, 0); assert.equal(result.data.ready, false);
  assert.equal(result.data.catalogLoaded, false); assert.equal(result.data.catalogComplete, false); assert.equal(result.data.coverage, 'loaded-catalog');
  f.bridge.close();
});
test('catalog uses static TDX rows or the existing provider cursor without switching charts', async () => {
  const f = fixture();
  const local = await f.invoke('tf.market.catalog', { providerId: 'tdx', venue: 'SH', limit: 1 });
  assert.equal(local.status, 'ok'); assert.equal(local.data.coverage, 'local-static'); assert.equal(local.data.nextCursor, '1');
  const next = await f.invoke('tf.market.catalog', { providerId: 'tdx', venue: 'SH', cursor: '1', limit: 1 });
  assert.equal(next.data.items.length, 1); assert.equal(next.data.nextCursor, undefined);
  const remote = await f.invoke('tf.market.catalog', { providerId: 'other', venue: 'SH' });
  assert.equal(remote.status, 'ok'); assert.equal(remote.data.coverage, 'provider-page'); assert.equal(remote.data.nextCursor, 'page-two');
  assert.equal(f.counts().remoteReads, 1);
  assert.equal((await f.invoke('tf.market.catalog', { providerId: 'tdx', venue: 'OTHER' })).code, 'field_unavailable');
  assert.equal((await f.invoke('tf.market.catalog', { providerId: 'tdx', venue: 'SH', cursor: '-1' })).code, 'invalid_request');
  f.bridge.close();
});
test('watchlist keeps its order and unresolved rows rather than quietly dropping them', async () => {
  const f = fixture(); const result = await f.invoke('tf.watchlist.list');
  assert.equal(result.status, 'ok'); assert.equal(result.data.total, 2);
  assert.deepEqual(result.data.items.map(item => [item.key, item.resolved]), [['other|SH:600000', true], ['lost|SH:600999', false]]);
  f.bridge.close();
});
test('indicator metadata is whitelisted, runtime code is never executed or returned', async () => {
  const f = fixture();
  for (const id of ['tf.indicator.definitions', 'tf.indicator.library']) {
    const result = await f.invoke(id); assert.equal(result.status, 'ok');
    assert.equal(result.data.items[0].name, '示例'); assert.equal(JSON.stringify(result).includes('SECRET SOURCE'), false);
    assert.equal(JSON.stringify(result).includes('create'), false);
  }
  const instances = await f.invoke('tf.indicator.instances', {}, chart);
  assert.equal(instances.status, 'ok'); assert.equal(instances.data.items[0].failed, true);
  assert.equal(instances.data.items[0].sourceHash, 'a'.repeat(64)); assert.equal(instances.data.items[0].failurePhase, 'realtime');
  assert.equal(instances.data.items[0].failureCode, 'runtime_exception');
  assert.equal(instances.data.items[0].failureDetail, 'realtime failure sentinel');
  assert.deepEqual(JSON.parse(instances.data.items[0].inputsJson), { period: 20 }); f.bridge.close();
});
test('metadata App reads survive chart switches; instances remain Chart-bound', async () => {
  const f = fixture(); f.change();
  assert.equal((await f.invoke('tf.watchlist.list')).status, 'ok');
  assert.equal((await f.invoke('tf.indicator.library')).status, 'ok');
  assert.equal((await f.invoke('tf.indicator.instances', {}, chart)).code, 'context_stale'); f.bridge.close();
});
test('invalid inputs fail before host calls; provider errors never expose raw messages', async () => {
  const f = fixture();
  for (const input of [{ limit: 0 }, { offset: -1 }, { approved: true }]) {
    assert.equal((await f.invoke('tf.market.search', input)).code, 'invalid_request');
  }
  assert.deepEqual(f.counts(), { registryReads: 0, remoteReads: 0 });
  f.host.catalog = async () => { throw new Error('SECRET CREDENTIAL /private/path'); };
  const result = await f.invoke('tf.market.catalog', { providerId: 'other', venue: 'SH' });
  assert.equal(result.code, 'tool_failed'); assert.equal(JSON.stringify(result).includes('SECRET'), false); f.bridge.close();
});
test('known remote catalog availability failures map to data_not_ready without leaking provider detail', async () => {
  const f = fixture();
  f.host.catalog = async () => { throw { code: 'market_data_unavailable', message: 'regional or upstream detail' }; };
  const result = await f.invoke('tf.market.catalog', { providerId: 'other', venue: 'SH' });
  assert.equal(result.code, 'data_not_ready'); assert.equal(JSON.stringify(result).includes('regional'), false); f.bridge.close();
});
test('MCP and the built-in assistant discover the same live host descriptors', async () => {
  const f = fixture(); const host = { context: () => chart, describe: () => f.bridge.describe(), open: p => f.bridge.openSession(p) };
  for (const assistant of [false, true]) {
    const connection = new McpConnection(host);
    await connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }));
    await connection.receive(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    assistant ? connection.authorizeAssistant() : connection.authorize('analysis');
    const list = JSON.parse(await connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))).result.tools;
    assert.deepEqual(list.filter(t => t.name !== 'tf_context_get').map(t => t.name), f.bridge.describe().map(t => t.id.replaceAll('.', '_')));
    const read = JSON.parse(await connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'tf_watchlist_list', arguments: { input: {} } } }))).result;
    assert.equal(read.structuredContent.reply.status, 'ok'); connection.close();
  }
  f.bridge.close();
});

test('metadata is paged before expensive schema serialization', async () => {
  const f = fixture();
  f.definitions.push({ ...f.definitions[0], id: 'user.large', inputs: { note: 'x'.repeat(140 * 1024) } });
  const first = await f.invoke('tf.indicator.definitions', { limit: 1 });
  assert.equal(first.status, 'ok'); assert.equal(first.data.total, 2); assert.equal(first.data.nextOffset, 1);
  const library = await f.invoke('tf.indicator.library', { limit: 1 });
  assert.equal(library.status, 'ok'); f.bridge.close();
});

test('actual main.ts workspace ports use existing state and only named catalog/provider commands', async () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf('function createAiMarketQueryHost()');
  const end = main.indexOf('\nfunction getAiDrawingPort()', start);
  assert.ok(start >= 0 && end > start);
  const f = fixture(); const invokes = [];
  const rows = [symbol('tdx', '已有目录')];
  const definition = { ...f.definitions[0], name: { 'zh-CN': '已有指标', 'en-US': 'Existing indicator' } };
  const deps = { createWorkspaceReadTools, createMarketQueryTools, createNativeMarketQueryPort, marketSymbols: rows,
    marketProviderKey: (providerId, venue) => `${providerId}|${venue}`,
    marketProviderById: new Map(f.providers.map(row => [row.id, row])),
    marketCatalogLoadStates: new Map([['other|SH', { descriptor: f.providers[1], venue: 'SH', nextCursor: 'next', loading: false, pages: 1, symbols: 1 }]]),
    marketSymbolById: new Map([['tdx|SH:600000', rows[0]]]), watchlistSymbols: ['tdx|SH:600000', 'unresolved'],
    indicatorRegistry: { list: () => [definition] }, userIndicatorRecords: new Map([['user.example', { manifest: definition }]]),
    userIndicatorLibrary: {}, indicatorStateReady: true, allIndicatorInstances: () => f.host.instances(),
    localizedIndicatorText: value => typeof value === 'string' ? value : value['zh-CN'],
    invoke: async (command, input) => { invokes.push([command, input]); return command === 'list_market_providers' ? f.providers : { symbols: [], nextCursor: null }; } };
  const body = stripTypeScriptTypes(main.slice(start, end));
  const tools = new Function('deps', `const { ${Object.keys(deps).join(', ')} } = deps; ${body}; return createAiWorkspaceReadTools();`)(deps);
  assert.deepEqual(invokes, []);
  const bridge = new ChartReadBridge({ currentContext: () => chart, readState() { throw Error('unexpected bars read'); }, tools });
  const session = bridge.openSession(Object.fromEntries(tools.map(t => [t.id, 'allow'])));
  let n = 0;
  const call = (toolId, input = {}) => session.invoke(JSON.stringify({ protocolVersion: 1, requestId: `actual-${++n}`, toolId, context: app, input }));
  const list = await call('tf.watchlist.list'); assert.equal(list.data.items[1].resolved, false);
  const definitions = await call('tf.indicator.definitions'); assert.equal(definitions.data.items[0].name, '已有指标');
  assert.equal((await call('tf.indicator.library')).data.ready, true);
  assert.equal((await call('tf.market.search', { query: '已有目录' })).data.total, 1);
  await call('tf.market.catalog', { providerId: 'other', venue: 'SH' });
  assert.deepEqual(invokes, [['list_market_providers', undefined], ['list_market_catalog_page', { providerId: 'other', venue: 'SH', limit: 50, cursor: null }]]);
  assert.deepEqual(deps.watchlistSymbols, ['tdx|SH:600000', 'unresolved']); assert.equal(rows.length, 1);
  const wiring = main.slice(main.indexOf('export function openAiChartSession'), main.indexOf('\nfunction readCurrentAiChartSelection'));
  assert.equal((wiring.match(/createAiWorkspaceReadTools\(marketHost, marketResults\)/g) ?? []).length, 2);
  assert.equal((wiring.match(/new MarketResultStore\(marketHost\)/g) ?? []).length, 2);
  assert.equal((wiring.match(/createAiWorkspaceActionTools\(\)/g) ?? []).length, 2);
  assert.match(wiring, /aiChartWorkbenchBridge\?\.invalidateChart\(\)/);
  assert.doesNotMatch(wiring, /aiChartWorkbenchBridge = undefined/);
  bridge.close(); f.bridge.close();
});

for (const protocol of ['chat', 'responses', 'anthropic']) test(`${protocol} built-in conversation can read the watchlist without a chart-context tool call`, async () => {
  const f = fixture(); let requests = 0;
  const host = { context: () => chart, describe: () => f.bridge.describe(), open: p => f.bridge.openSession(p) };
  const conversation = new ApiConversation(host, { async turn(_profile, payload) {
    requests++;
    const listed = payload.tools.find(t => (t.name ?? t.function?.name) === 'tf_watchlist_list');
    assert.ok(listed);
    assert.deepEqual((listed.input_schema ?? listed.parameters ?? listed.function.parameters).required, ['input']);
    if (requests === 1) {
      const call = { id: 'watchlist-call', name: 'tf_watchlist_list', arguments: '{"input":{}}' };
      const replay = protocol === 'chat' ? [{ role: 'assistant', content: null,
        tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] }]
        : protocol === 'responses' ? [{ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments }]
        : [{ role: 'assistant', content: [{ type: 'tool_use', id: call.id, name: call.name, input: { input: {} } }] }];
      return { text: '', calls: [call], replay, usage: { inputTokens: 1, outputTokens: 1 } };
    }
    assert.ok(JSON.stringify(payload).includes('local-watchlist'));
    return { text: '已读取自选', calls: [], replay: [{ role: 'assistant', content: '已读取自选' }], usage: { inputTokens: 1, outputTokens: 1 } };
  } });
  conversation.reset({ revision: 'test', hasKey: false, remembered: false, settings: { protocol, endpoint: 'https://example.invalid', model: 'test',
    stream: false, tools: true, includeUsage: false, chatTokenField: 'max_tokens', maxTokens: 2048, timeoutSeconds: 30, allowLocalHttp: false } });
  await conversation.send('读一下我的自选');
  assert.equal(conversation.view().failed, false); assert.equal(conversation.view().status, 'completed');
  assert.equal(requests, 2); assert.deepEqual(f.counts(), { registryReads: 0, remoteReads: 0 });
  conversation.reset(); f.bridge.close();
});

test('ordinary settings avoid duplicate permission layers while paired MCP auto-opens business access', () => {
  const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.doesNotMatch(read('src/ai-api/page.ts'), /api-consent|api-remember|连接管理与测试|权限与会话说明|允许 AI 读取/);
  assert.match(read('src/ai-api/controller.ts'), /remember:\s*true/);
  assert.match(read('src/ai-mcp/controller.ts'), /after\.ready && after\.access === 'pending'[^\n]*connection\.authorize\('workbench'\)/);
  assert.doesNotMatch(read('src/ai-mcp/controller.ts'), /授权此客户端|撤销授权|分析：仅读取和计算|辅助：修改前确认|确认图表修改/);
  assert.match(read('src/ai-api/page.ts'), /id="api-mcp-settings"/);
});
