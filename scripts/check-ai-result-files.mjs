import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityCore, CapabilityRegistry } from '../src/ai-capabilities/index.ts';
import { createResultFileTools } from '../src/ai-capabilities/result-files.ts';

const app = { scope: 'app', appInstanceId: 'result-file-test' };

function fixture(options = {}) {
  const prepared = [], committed = [], rolledBack = [];
  let sequence = 0;
  const port = {
    async prepare(input) {
      prepared.push(structuredClone(input));
      const ticket = 'ticket-' + (++sequence);
      return { ticket, destination: input.destination, displayPath: input.destination + '/' + (input.folder ? input.folder + '/' : '') + input.filename,
        filename: input.filename, bytes: new TextEncoder().encode(input.content).length };
    },
    async commit(ticket) {
      if (options.failCommit) throw Error('fixture commit failed');
      committed.push(ticket);
    },
    async rollback(ticket) { rolledBack.push(ticket); },
  };
  const tools = createResultFileTools({ port, taskArtifact: options.taskArtifact });
  const registry = new CapabilityRegistry(tools), core = new CapabilityCore(registry);
  const session = core.openSession({ context: app, currentContext: () => app, permissions: { 'tf.result.save_file': 'allow' } });
  let id = 0;
  const call = async input => session.invoke(JSON.stringify({
    protocolVersion: 1, requestId: 'r-' + (++id), toolId: 'tf.result.save_file', context: app, input,
  }));
  return { session, call, prepared, committed, rolledBack };
}

test('natural-language result export can save a generated document without any UI export action', async () => {
  const f = fixture();
  const reply = await f.call({ source: 'text', destination: 'desktop', folder: '研究结果', filename: '复盘报告', format: 'markdown', content: '# 复盘\n内容' });
  assert.equal(reply.status, 'ok'); assert.equal(reply.data.saved, true);
  assert.equal(reply.data.filename, '复盘报告.md');
  assert.equal(f.prepared[0].folder, '研究结果');
  assert.equal(f.committed.length, 1); assert.equal(f.rolledBack.length, 0);
  f.session.close();
});

test('full task artifacts are saved by the host without copying all rows through the model', async () => {
  let seenOwner;
  const f = fixture({ taskArtifact(taskId, artifactId, format, owner) {
    seenOwner = owner;
    assert.deepEqual({ taskId, artifactId, format }, { taskId: 'task-1', artifactId: 'table', format: 'auto' });
    return { content: '代码,数值\n600000,1', filename: '全市场扫描.csv', format: 'csv' };
  } });
  const reply = await f.call({ source: 'task', destination: 'documents', folder: 'TradeFlow', taskId: 'task-1', artifactId: 'table', format: 'auto' });
  assert.equal(reply.status, 'ok'); assert.equal(reply.data.filename, '全市场扫描.csv');
  assert.equal(f.prepared[0].content, '代码,数值\n600000,1');
  assert.ok(seenOwner); f.session.close();
});

test('former 1 MiB request ceiling no longer blocks ordinary large result documents', async () => {
  const f = fixture(), content = 'x'.repeat(2 * 1024 * 1024);
  const reply = await f.call({ source: 'text', destination: 'downloads', filename: 'large.txt', format: 'text', content });
  assert.equal(reply.status, 'ok'); assert.equal(reply.data.bytes, content.length);
  f.session.close();
});

test('failed final commit rolls back the prepared file and never reports success', async () => {
  const f = fixture({ failCommit: true });
  const reply = await f.call({ source: 'text', destination: 'desktop', filename: '失败.md', content: 'x' });
  assert.equal(reply.status, 'error'); assert.equal(reply.code, 'storage_failed');
  assert.equal(f.committed.length, 0); assert.deepEqual(f.rolledBack, ['ticket-1']);
  f.session.close();
});
