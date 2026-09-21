import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { userTaskAnswer } from './user-task-api-fixture.mjs';

const sourceId = 'a'.repeat(32), dynamic = 'user_task_fixture_run';
const tools = [{ function: { name: dynamic } }];
const row = { id: 'example.protocol_task', revision: 'revision-1', status: 'ready', toolName: dynamic };
const reply = (name, data) => ({ name, value: { status: 'ok', data } });
const repairedHash = 'b'.repeat(64);
const task = (id, state = 'completed') => ({ taskId: id, state, complete: state === 'completed', processed: 1, universeComplete: true,
  definitionId:'example.protocol_task',definitionVersion:1,definitionHash:repairedHash,sourceRevision:'source-r1',universeScope:'explicit-symbols' });
const input = answer => JSON.parse(answer.calls[0].arguments).input;
const built = () => [
  reply('tf_task_guide', { example: 'defineTask({})' }),
  reply('tf_task_validate', { valid:false,extensionType:'task',stage:'validate',sourceHash:'a'.repeat(64),errorCode:'task_unsupported_version' }),
  reply('tf_task_validate', { valid:true,extensionType:'task',stage:'validate',sourceHash:repairedHash,hash:repairedHash,draftId: 'draft-1' }),
  reply('tf_task_start', { taskId: 'task-1' }),
  reply('tf_task_status', { task: task('task-1') }),
  reply('tf_task_page', { artifactId: 'table', total: 1, rowsJson: JSON.stringify([[{symbol:'SH:600000'},2]]) }),
  reply('tf_task_save', { id: row.id, revision: row.revision, state: 'saved' }),
  reply('tf_task_library', { tasks: [row] }),
];

test('task model fixture distinguishes no-op validation, start, unfinished progress and actual result checking', () => {
  const user = `DESKTOP_USER_TASK_BUILD ${sourceId}`;
  assert.equal(userTaskAnswer('ordinary chat', [], []), null);
  assert.equal(userTaskAnswer(user, [], []).calls[0].name, 'tf_task_guide');
  const broken = input(userTaskAnswer(user, built().slice(0,1), [])); assert.match(broken.source, /example\.protocol_task/); assert.match(broken.source, /formatVersion:2/);
  const repaired = input(userTaskAnswer(user, built().slice(0,2), [])); assert.match(repaired.source, /formatVersion:1/); assert.doesNotMatch(repaired.source, /formatVersion:2/);
  const start = input(userTaskAnswer(user, built().slice(0,3), []));
  assert.equal(start.providerId, `user_data_${sourceId}`); assert.equal(start.universe, 'symbols'); assert.equal(start.symbols.length,1);
  const running = [...built().slice(0,4), reply('tf_task_status', {task:task('task-1','running')})];
  assert.equal(userTaskAnswer(user, running, []).calls[0].name, 'tf_task_status');
  assert.equal(userTaskAnswer(user, built(), tools).calls.length, 0);
  assert.throws(() => userTaskAnswer(user, [...built().slice(0,4), reply('tf_task_status', {task:task('task-1','failed')})], []));
});

test('same-chat reuse starts the discovered tool against previous SymbolList and waits for its own result before removal', () => {
  const user = `DESKTOP_USER_TASK_REUSE ${sourceId}`, outputs = built();
  assert.equal(userTaskAnswer(user, outputs, tools).calls[0].name, dynamic);
  assert.deepEqual(input(userTaskAnswer(user, outputs, tools)), { providerId:`user_data_${sourceId}`, universe:'result', resultTaskId:'task-1', artifactId:'symbols', parameters:{minimum:0} });
  outputs.push(reply(dynamic, {taskId:'task-2'}));
  assert.deepEqual(input(userTaskAnswer(user, outputs, tools)), {taskId:'task-2'});
  outputs.push(reply('tf_task_status', {task:task('task-2')}));
  assert.equal(input(userTaskAnswer(user, outputs, tools)).artifactId, 'report');
  outputs.push(reply('tf_task_page', {artifactId:'report', text:'仅为用户研究示例，不是交易建议。'}));
  assert.deepEqual(input(userTaskAnswer(user, outputs, tools)), {id:row.id, revision:row.revision});
  outputs.push(reply('tf_task_remove', {id:row.id, state:'removed'}));
  assert.throws(() => userTaskAnswer(user, outputs, tools), /removed|retired/);
  assert.equal(userTaskAnswer(user, outputs, []).calls.length, 0);
});

test('private API and native MCP desktop runners really invoke task workflows; production has no fixture dependency', async () => {
  const read = name => readFile(new URL(name, import.meta.url), 'utf8');
  assert.match(await read('ai-api-fixture-server.mjs'), /userTaskAnswer\(user, outputs, body\.tools/);
  const api = await read('run-ai-api-desktop-smoke.mjs');
  assert.match(api, /DESKTOP_USER_TASK_BUILD/); assert.match(api, /DESKTOP_USER_TASK_REUSE/);
  assert.match(await read('user-data-mcp-desktop-cases.mjs'), /await runUserTaskMcpDesktopCases\(/);
  assert.doesNotMatch(await read('../src/main.ts'), /user-task-api-fixture|user-task-mcp-desktop-cases/);
});

test('production built-in assistant requires exact-source repair and a completed sample before claiming success', async () => {
  const source = await readFile(new URL('../src/ai-api/conversation.ts', import.meta.url), 'utf8');
  assert.match(source, /sourceHash/); assert.match(source, /valid=false/); assert.match(source, /one explicit symbol/);
  assert.match(source, /Do not report an extension as fixed/);
  assert.doesNotMatch(source, /automatic task-repair loops are not built in yet/);
});
