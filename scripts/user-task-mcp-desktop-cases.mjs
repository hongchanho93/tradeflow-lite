import assert from 'node:assert/strict';
import { TASK_FIXTURE } from './user-task-fixtures.mjs';

/** Uses only real stdio business tools under the connection's one-time grant. */
export async function runUserTaskMcpDesktopCases({ connection, command, test, raw, read, tools, sourceId }) {
  const providerId = `user_data_${sourceId}`;
  const source = TASK_FIXTURE.replace("id:'example.scan'", "id:'example.mcp_task'");
  const write = async (name, input) => {
    const result = await raw(name, input); assert.equal(result.status, 'ok', JSON.stringify(result)); return result.data;
  };
  const settled = async taskId => {
    const deadline = performance.now() + 25000;
    while (performance.now() < deadline) {
      const status = (await read('tf_task_status', {taskId})).task;
      if (['completed','failed','cancelled'].includes(status.state)) return status;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw Error('actual stdio task did not finish within acceptance deadline');
  };
  let taskId, saved, definition;
  await test('task MCP: the one authorized connection can validate and start tasks without a second grant', async () => {
    const draft = await read('tf_task_validate', {source}); assert.equal(draft.valid, true);
    const started = await write('tf_task_start', {draftId:draft.draftId, providerId, universe:'catalog'});
    const status = await settled(started.taskId); assert.equal(status.state,'completed');
    await read('tf_task_release', {taskId:started.taskId});
    assert.equal((await read('tf_task_list')).tasks.length, 0);
  });
  const foreground = (await command('workspace-state')).context;
  await test('task MCP: native start reads the chosen CSV source in a real Worker without navigating the chart or prompting again', async () => {
    const draft = await read('tf_task_validate', {source});
    const started = await write('tf_task_start', {draftId:draft.draftId, providerId, universe:'catalog'}); taskId = started.taskId;
    const status = await settled(taskId);
    assert.equal(status.state, 'completed', JSON.stringify(status)); assert.equal(status.processed, 2);
    assert.equal(status.universeScope, 'connector-catalog'); assert.equal(status.complete, true);
    assert.deepEqual((await command('workspace-state')).context, foreground);
  });
  await test('task MCP: actual artifact paging preserves typed symbols, ordering, Series and plain Report', async () => {
    const first = await read('tf_task_page', {taskId, artifactId:'table', limit:1});
    assert.equal(first.total, 2); assert.equal(first.nextOffset, 1); assert.equal(JSON.parse(first.rowsJson)[0][0].symbol, 'SH:600000');
    const next = await read('tf_task_page', {taskId, artifactId:'table', offset:first.nextOffset, limit:1});
    assert.equal(JSON.parse(next.rowsJson)[0][0].symbol, 'SZ:000001');
    assert.equal((await read('tf_task_page', {taskId, artifactId:'symbols'})).total, 2);
    assert.equal(JSON.parse((await read('tf_task_page', {taskId, artifactId:'series'})).rowsJson)[0].value, 2);
    assert.match((await read('tf_task_page', {taskId, artifactId:'report'})).text, /研究示例/);
  });
  await test('task MCP: saving publishes a discoverable native tool and reuses the earlier SymbolList', async () => {
    const notices = connection.received.filter(item => item.method === 'notifications/tools/list_changed').length;
    saved = await write('tf_task_save', {taskId});
    definition = (await read('tf_task_library')).tasks.find(item => item.id === saved.id);
    assert.equal(definition.status, 'ready'); assert.ok((await tools()).some(item => item.name === definition.toolName));
    assert.ok(connection.received.filter(item => item.method === 'notifications/tools/list_changed').length > notices);
    const run = await write(definition.toolName, {providerId, universe:'result', resultTaskId:taskId, artifactId:'symbols', parameters:{minimum:0}});
    const status = await settled(run.taskId); assert.equal(status.state, 'completed', JSON.stringify(status)); assert.equal(status.processed, 2);
    assert.equal((await read('tf_task_page', {taskId:run.taskId, artifactId:'table'})).total, 2);
    await read('tf_task_release', {taskId:run.taskId});
  });
  await test('task MCP: exact-revision removal retires the tool while preserving the source and unrelated result', async () => {
    await write('tf_task_remove', {id:saved.id, revision:saved.revision});
    assert.equal((await tools()).some(item => item.name === definition.toolName), false);
    const stale = await connection.call(definition.toolName, {input:{providerId, universe:'catalog'}}).promise;
    assert.ok(stale.error || stale.result?.isError);
    assert.equal((await read('tf_task_status', {taskId})).task.complete, true);
    assert.ok((await read('tf_data_list')).sources.some(item => item.sourceId === sourceId));
    assert.deepEqual((await command('workspace-state')).context, foreground);
    await read('tf_task_release', {taskId}); assert.equal((await read('tf_task_list')).tasks.length, 0);
  });
}
