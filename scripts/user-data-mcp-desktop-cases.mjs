import assert from 'node:assert/strict';
import { createUserDataDesktopCases } from './user-data-desktop-cases.mjs';
import { CSV_CONNECTOR_SOURCE } from '../src/user-data/csv-example.ts';
import { runUserTaskMcpDesktopCases } from './user-task-mcp-desktop-cases.mjs';

export async function runUserDataMcpDesktopCases({ root, output, title, command, test, client, result, timeout, capture }) {
  await command('start'); const configuration = await command('config'); const connection = client(configuration);
  let cases, failed = false;
  try {
    await connection.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: '本地数据验收客户端', version: '1' } }).promise;
    connection.notify('notifications/initialized');
    cases = await createUserDataDesktopCases({ root, output, title, command, test, capture });
    const source = await cases.setup(Number(configuration.env.TRADEFLOW_MCP_PORT), false);
    const raw = async (name, input = {}) => result(await connection.call(name, { input }).promise);
    const read = async (name, input = {}) => { const reply = await raw(name, input); assert.equal(reply.status, 'ok', JSON.stringify(reply)); assert.equal(reply.data.errorCode, undefined); return reply.data; };
    const tools = async () => (await connection.request('tools/list').promise).result.tools;
    const query = (await read('tf_data_list')).sources.find(row => row.sourceId === source.id).toolName;
    await test('data MCP: actual stdio discovers local sources and reads catalog/history pages without touching the chart', async () => {
      assert.ok((await tools()).some(tool => tool.name === query));
      assert.ok(connection.received.some(message => message.method === 'notifications/tools/list_changed'));
      const before = (await command('workspace-state')).context;
      assert.ok(before?.instrument, 'actual foreground context missing');
      const first = await read(query, { operation: 'catalog', limit: 1 }); assert.equal(first.symbols[0].symbol, 'SH:600000');
      const second = await read(query, { operation: 'catalog', limit: 1, cursor: first.nextCursor }); assert.equal(second.symbols[0].symbol, 'SZ:000001');
      const history = await read(query, { operation: 'history', symbol: 'SH:600000', kind: 'stock', resolution: '1D', count: 3 });
      const page = await read(query, { operation: 'page', datasetId: history.dataset.datasetId, limit: 2 }); assert.equal(page.rows[0].close, 2); assert.equal(page.nextOffset, 2);
      const next = await read(query, { operation: 'history', symbol: 'SH:600000', kind: 'stock', resolution: '1D', count: 3, cursor: history.dataset.nextCursor });
      assert.ok(next.dataset.fromTime > history.dataset.toTime);
      assert.deepEqual((await command('workspace-state')).context, before);
    });
    let draft;
    await test('data MCP: real native scope rejects an escaping link while the one authorization can install/manage the selected source', async () => {
      const escaped = await raw('tf_data_sample', { sourceId: source.id, path: 'z_outside.csv' });
      assert.ok(escaped.data?.errorCode); assert.equal(escaped.data.content, undefined);
      draft = await read('tf_data_validate', { sourceId: source.id, source: CSV_CONNECTOR_SOURCE }); assert.equal(draft.valid, true);
      assert.equal((await raw('tf_data_install', { draftId: draft.draftId })).status, 'ok');
      assert.equal((await raw('tf_data_manage', { sourceId: source.id, operation: 'disable' })).status, 'ok');
      assert.equal((await raw('tf_data_manage', { sourceId: source.id, operation: 'enable' })).status, 'ok');
    });
    await cases.probe('mcp-page');
    await test('data MCP: the same one-time grant installs a replacement and publishes a new implementation without another approval', async () => {
      const old = (await tools()).find(tool => tool.name === query)._meta['tradeflow/registrationRevision'];
      draft = await read('tf_data_validate', { sourceId: source.id, source: CSV_CONNECTOR_SOURCE });
      assert.equal((await raw('tf_data_install', { draftId: draft.draftId })).status, 'ok');
      const current = (await tools()).find(tool => tool.name === query)._meta['tradeflow/registrationRevision']; assert.ok(current > old);
    });
    await test('data MCP: ordinary disable removes the query and prevents subsequent stale calls', async () => {
      await cases.probe('manage', { sourceId: source.id, operation: 'disable' });
      assert.equal((await tools()).some(tool => tool.name === query), false);
      const answer = await connection.call(query, { input: { operation: 'catalog' } }).promise;
      assert.ok(answer.error || answer.result?.isError);
      await cases.probe('manage', { sourceId: source.id, operation: 'enable' });
      assert.ok((await tools()).some(tool => tool.name === query));
    });
    await cases.probe('mcp-page');
    await runUserTaskMcpDesktopCases({connection, command, test, raw, read, tools, sourceId:source.id});
    await cases.removeAll();
  } catch (error) { failed = true; throw error; }
  finally {
    try {
      if (cases) await cases.probe('mcp-page');
      connection.child.stdin.end(); await timeout(connection.exited, 6000, 'data helper EOF');
      await command('wait-connections', { count: 0 }); await command('stop');
    } catch (error) { if (!failed) throw error; console.error('Data MCP secondary cleanup failed; preserving the original test failure.'); }
  }
}
