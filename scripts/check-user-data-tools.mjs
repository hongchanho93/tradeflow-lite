import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { McpConnection } from '../src/ai-mcp/session.ts';
import { UserDataManager } from '../src/user-data/manager.ts';
import { createUserDataTools } from '../src/user-data/tools.ts';
import { dataWorkerFactory, DATA_CONNECTOR_FIXTURE, dataInfo, fakeDataNative } from './user-data-fixtures.mjs';

async function fixture(mode = 'assistant', installed = false) {
  const native = fakeDataNative(installed ? DATA_CONNECTOR_FIXTURE : null);
  native.records.get(dataInfo.id).info.hasConnector = installed;
  let registry;
  const manager = new UserDataManager(native, id => registry.createOwner(id), { workerFactory: dataWorkerFactory });
  registry = new CapabilityRegistry(createUserDataTools(manager));
  const core = new CapabilityCore(registry);
  const context = { appInstanceId: 'data-tool-test', chartId: 'main', provider: 'tdx', instrument: 'SH:600000', resolution: '1D', adjustment: 'none', selectionGeneration: 1 };
  const host = { context: () => context, describe: () => registry.describe(), subscribeTools: fn => registry.subscribe(fn),
    open: permissions => core.openSession({ context, currentContext: () => context, permissions }) };
  const clients = [];
  async function connect(access = mode) {
    const connection = new McpConnection(host, () => {}, { approvalMs: 60 }); clients.push(connection); let sequence = 0;
    const rpc = async (method, params = {}, id = `rpc-${++sequence}`) => {
      const raw = await connection.receive(JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }));
      return raw === null ? null : JSON.parse(raw);
    };
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'data-test', version: '1' } });
    await rpc('notifications/initialized', {}, null);
    access === 'assistant' ? connection.authorizeAssistant() : connection.authorize(access);
    return { connection, rpc, async call(name, input = {}, id) {
      const response = await rpc('tools/call', { name: name.replaceAll('.', '_'), arguments: { input } }, id);
      return response?.result?.structuredContent?.reply ?? response;
    }, async refresh() { return (await rpc('tools/list')).result.tools; } };
  }
  await manager.initialize(); const client = await connect();
  return { native, registry, manager, client, connect, async close() { clients.forEach(c => c.close()); await manager.close(); } };
}
async function draft(f, client = f.client, version = 1) {
  const reply = await client.call('tf.data.validate', { sourceId: dataInfo.id, source: DATA_CONNECTOR_FIXTURE.replace('version:1,name', `version:${version},name`) });
  assert.equal(reply.status, 'ok', JSON.stringify(reply)); assert.equal(reply.data.valid, true, JSON.stringify(reply));
  assert.equal(reply.data.extensionType, 'connector'); assert.equal(reply.data.stage, 'sample_history'); assert.match(reply.data.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(reply.data.sourceRevision, dataInfo.revision); assert.equal(reply.data.sampleSymbol, 'SH:600000'); assert.equal(reply.data.sampleResolution, '1D');
  return reply.data.draftId;
}
test('SQLite and Parquet samples describe actual structure through the existing authorized sample tool',async()=>{
  const f=await fixture();try{
    const requests=[];
    f.native.io=()=>({async execute(request){requests.push(request);return {columns:['close'],types:['DOUBLE'],rows:[[12]],revision:'file1',truncated:false,
      ...(request.operation==='parquet'?{offset:0,totalRows:1}:{})};}});
    const sqlite=await f.client.call('tf.data.sample',{sourceId:dataInfo.id,path:'market.db',format:'sqlite',sql:'SELECT ?1 AS close',parametersJson:'[12]',limit:1});
    assert.equal(sqlite.status,'ok',JSON.stringify(sqlite));assert.deepEqual(JSON.parse(sqlite.data.rowsJson),[[12]]);assert.equal(requests[0].operation,'sqlite');
    assert.deepEqual(requests[0].parameters,[12]);
    const parquet=await f.client.call('tf.data.sample',{sourceId:dataInfo.id,path:'a.parquet',format:'parquet',columns:['close'],limit:1});
    assert.equal(parquet.status,'ok',JSON.stringify(parquet));assert.equal(parquet.data.totalRows,1);assert.equal(requests[1].operation,'parquet');
    assert.equal(f.registry.describe().length,8);assert.equal(f.native.records.get(dataInfo.id).source,null);
  }finally{await f.close();}
});
test('common data tools expose the guide and selected samples, never a path-grant or picker tool', async () => {
  const f = await fixture(); try {
    const tools = await f.client.refresh();
    assert.equal(tools.some(t => /pick|shell|grant|terminal/.test(t.name)), false);
    const guide = await f.client.call('tf.data.guide'); assert.equal(guide.status, 'ok'); assert.match(guide.data.example, /defineConnector/);
    const list = await f.client.call('tf.data.list'); assert.equal(list.data.sources[0].status, 'needs_connector');
    assert.equal((await f.client.call('tf.data.files', { sourceId: dataInfo.id })).data.entries[0].name, 'data.csv');
    assert.equal((await f.client.call('tf.data.sample', { sourceId: dataInfo.id, path: 'data.csv' })).data.bytesRead, 1);
    assert.equal((await f.client.call('tf.data.sample', { sourceId: dataInfo.id, path: '../private/key' })).data.errorCode, 'data_path_denied');
    const forged = await f.client.call('tf.data.files', { sourceId: dataInfo.id, root: '/tmp/private' }); assert.ok(forged.error || forged.status === 'error');
  } finally { await f.close(); }
});
test('built-in assistant installs a validated Connector without another permission prompt and discovers its query', async () => {
  const f = await fixture(); try {
    const preview = await f.client.call('tf.data.validate', { sourceId: dataInfo.id, source: DATA_CONNECTOR_FIXTURE });
    assert.equal(preview.status, 'ok'); assert.equal(preview.data.valid, true); const id = preview.data.draftId; assert.equal(f.registry.describe().length, 8);
    const installed = await f.client.call('tf.data.install', { draftId: id });
    assert.equal(installed.status, 'ok', JSON.stringify(installed)); await f.manager.idle();
    const installedSource = await f.client.call('tf.data.source', { sourceId: dataInfo.id }); assert.equal(installedSource.data.sourceHash, preview.data.sourceHash);
    assert.equal(f.client.connection.view().approvals.length, 0); assert.equal(f.registry.describe().length, 9);
    const list = await f.client.refresh(); const query = list.find(t => t.name.startsWith('user_data_')); assert.ok(query);
    const catalog = await f.client.call(query.name, { operation: 'catalog' }); assert.equal(catalog.data.symbols[0].symbol, 'SH:600000');
    const history = await f.client.call(query.name, { operation: 'history', symbol: 'SH:600000', kind: 'stock', resolution: '1D' });
    assert.equal(history.status, 'ok'); const page = await f.client.call(query.name, { operation: 'page', datasetId: history.data.dataset.datasetId });
    assert.equal(page.data.rows[0].close, 2); assert.equal(f.native.tickets.size, 0);
    assert.notEqual((await f.client.call('tf.data.install', { draftId: id })).status, 'ok');
  } finally { await f.close(); }
});
test('a draft belongs to its validating session and stale source revisions cannot install', async () => {
  const f = await fixture(); try {
    const id = await draft(f); const other = await f.connect();
    assert.equal((await other.call('tf.data.install', { draftId: id })).code, 'snapshot_unavailable');
    const changed = await f.client.call('tf.data.manage', { sourceId: dataInfo.id, operation: 'disable' }); assert.equal(changed.status, 'ok'); await f.manager.idle();
    assert.equal((await f.client.call('tf.data.install', { draftId: id })).code, 'state_conflict');
    assert.equal(f.native.records.get(dataInfo.id).source, null);
  } finally { await f.close(); }
});
test('Connector validation failure returns the exact candidate hash and failure stage without changing the installed source', async () => {
  const f = await fixture('assistant', true); try {
    const before = f.native.records.get(dataInfo.id).source;
    const broken = DATA_CONNECTOR_FIXTURE.replace('formatVersion:1', 'formatVersion:2');
    const result = await f.client.call('tf.data.validate', { sourceId: dataInfo.id, source: broken });
    assert.equal(result.status, 'ok', JSON.stringify(result)); assert.equal(result.data.valid, false);
    assert.equal(result.data.extensionType, 'connector'); assert.equal(result.data.stage, 'validate'); assert.match(result.data.sourceHash, /^[a-f0-9]{64}$/);
    assert.equal(result.data.sourceRevision, dataInfo.revision); assert.equal(result.data.errorCode, 'data_unsupported_version');
    assert.equal(result.data.path, 'manifest.formatVersion'); assert.equal(result.data.reason, 'unsupported_version'); assert.equal(result.data.expected, '1');
    assert.equal(f.native.records.get(dataInfo.id).source, before);
  } finally { await f.close(); }
});
test('Connector history sample failure is attributed to sample_history and preserves the installed source', async () => {
  const f = await fixture('assistant', true); try {
    const before = f.native.records.get(dataInfo.id).source;
    const broken = DATA_CONNECTOR_FIXTURE.replace(
      "*getHistory(q,io){yield io.read('data.csv',0,1);return",
      "*getHistory(q,io){throw new Error('/Users/jim/private sample failure');return",
    );
    const result = await f.client.call('tf.data.validate', { sourceId: dataInfo.id, source: broken });
    assert.equal(result.status, 'ok', JSON.stringify(result)); assert.equal(result.data.valid, false);
    assert.equal(result.data.extensionType, 'connector'); assert.equal(result.data.stage, 'sample_history');
    assert.match(result.data.sourceHash, /^[a-f0-9]{64}$/); assert.equal(result.data.errorCode, 'data_runtime_error');
    assert.equal(result.data.failureDetail, '[path] sample failure'); assert.equal(result.data.failureDetail.includes('/Users/'), false);
    assert.equal(f.native.records.get(dataInfo.id).source, before);
  } finally { await f.close(); }
});
test('Connector catalog output failure pinpoints symbols exceeding query.limit', async () => {
  const f = await fixture('assistant', true); try {
    const broken = DATA_CONNECTOR_FIXTURE.replace(
      "*listSymbols(q,io){const r=yield io.list('',q.cursor,q.limit);return {symbols:r.entries.map(e=>({symbol:'SH:600000',name:e.name,kind:'stock'})),nextCursor:r.next};}",
      "*listSymbols(q,io){yield io.list('',q.cursor,q.limit);return {symbols:Array.from({length:8},(_,i)=>({symbol:'SH:'+String(600000+i),name:'n'+i,kind:'stock'}))};}",
    );
    const result = await f.client.call('tf.data.validate', { sourceId: dataInfo.id, source: broken });
    assert.equal(result.status, 'ok', JSON.stringify(result)); assert.equal(result.data.valid, false);
    assert.equal(result.data.stage, 'sample_catalog'); assert.equal(result.data.errorCode, 'data_invalid_output');
    assert.equal(result.data.path, 'catalog.symbols'); assert.equal(result.data.reason, 'max_items_exceeded');
    assert.match(result.data.expected, /query\.limit \(5\)/);
  } finally { await f.close(); }
});
test('Connector can explicitly report unsupported sample history without pretending it is empty or invalid', async () => {
  const f = await fixture('assistant', true); try {
    const source = DATA_CONNECTOR_FIXTURE.replace(
      "*getHistory(q,io){yield io.read('data.csv',0,1);return {seriesKind:'ohlcv',bars:[{time:1,open:1,high:2,low:1,close:2,volume:1}],nextCursor:q.cursor?null:'next'};}",
      "*getHistory(q,io){return {unsupported:'arrow_zstd'};}",
    );
    const validation = await f.client.call('tf.data.validate', { sourceId: dataInfo.id, source });
    assert.equal(validation.status, 'ok', JSON.stringify(validation)); assert.equal(validation.data.valid, true, JSON.stringify(validation));
    assert.equal(validation.data.stage, 'sample_history'); assert.equal(validation.data.sampleRows, 0);
    assert.equal(validation.data.sampleUnsupportedReason, 'arrow_zstd');
    assert.equal((await f.client.call('tf.data.install', { draftId: validation.data.draftId })).status, 'ok'); await f.manager.idle();
    const query = f.manager.list()[0].toolName; const tools = await f.client.refresh(); assert.ok(tools.some(t => t.name === query));
    const reply = await f.client.call(query, { operation:'history', symbol:'SH:600000', kind:'stock', resolution:'1D', adjustment:'none', count:2 });
    assert.equal(reply.status, 'ok', JSON.stringify(reply)); assert.equal(reply.data.unsupported, true);
    assert.equal(reply.data.errorCode, 'data_history_unsupported'); assert.equal(reply.data.reasonCode, 'arrow_zstd'); assert.equal(reply.data.empty, undefined);
  } finally { await f.close(); }
});
test('an unavailable source remains a source-state error instead of being mislabeled as candidate validation failure', async () => {
  const f = await fixture('assistant', true); try {
    assert.equal((await f.client.call('tf.data.manage', { sourceId: dataInfo.id, operation: 'disable' })).status, 'ok'); await f.manager.idle();
    const result = await f.client.call('tf.data.validate', { sourceId: dataInfo.id, source: DATA_CONNECTOR_FIXTURE });
    assert.equal(result.status, 'error', JSON.stringify(result)); assert.equal(result.code, 'data_not_ready');
    assert.equal(result.data, undefined);
  } finally { await f.close(); }
});
test('legacy external mode names do not restrict the one-time grant or add mutation approvals', async () => {
  const f = await fixture('analysis'); try {
    const id = await draft(f);
    assert.equal((await f.client.call('tf.data.install', { draftId: id })).status, 'ok');
    assert.equal(f.client.connection.view().approvals.length, 0);
    assert.equal((await f.client.call('tf.data.manage', { sourceId: dataInfo.id, operation: 'disable' })).status, 'ok');
    await f.manager.idle(); assert.equal(f.native.records.size, 1);
  } finally { await f.close(); }
});
test('disable and delete revoke queries; reenabling receives a new dynamic implementation', async () => {
  const f = await fixture('assistant', true); try {
    const query = f.manager.list()[0].toolName; const tools = await f.client.refresh();
    const previous = tools.find(t => t.name === query)._meta['tradeflow/registrationRevision'];
    const cached = await f.client.call(query, { operation: 'catalog' }, 'cached'); assert.equal(cached.status, 'ok');
    assert.equal((await f.client.call('tf.data.manage', { sourceId: dataInfo.id, operation: 'disable' })).status, 'ok'); await f.manager.idle();
    assert.equal((await f.client.call(query, { operation: 'catalog' }, 'cached')).code, 'tool_changed');
    assert.equal((await f.client.call('tf.data.manage', { sourceId: dataInfo.id, operation: 'enable' })).status, 'ok'); await f.manager.idle();
    const updated = (await f.client.refresh()).find(t => t.name === query)._meta['tradeflow/registrationRevision']; assert.ok(updated > previous);
    assert.equal((await f.client.call('tf.data.manage', { sourceId: dataInfo.id, operation: 'remove' })).status, 'ok'); await f.manager.idle();
    assert.equal(f.manager.list().length, 0); assert.equal(f.native.records.size, 0);
  } finally { await f.close(); }
});
test('failed installation compensates; failed compensation is not converted into a harmless data error', async () => {
  const f = await fixture(); try {
    const id = await draft(f); f.native.failCommit = true;
    assert.notEqual((await f.client.call('tf.data.install', { draftId: id })).status, 'ok'); await f.manager.idle();
    assert.equal(f.manager.list()[0].status, 'needs_connector'); assert.equal(f.native.records.get(dataInfo.id).source, null);
    f.native.failRollback = true;
    assert.equal((await f.client.call('tf.data.install', { draftId: id })).code, 'rollback_failed');
  } finally { await f.close(); }
});
