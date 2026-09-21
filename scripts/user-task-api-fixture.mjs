import assert from 'node:assert/strict';
import { TASK_FIXTURE } from './user-task-fixtures.mjs';

let sequence = 0;
/** Deterministic protocol planning only. The real app performs every task and read. */
export function userTaskAnswer(user, outputs, tools) {
  if (!user.startsWith('DESKTOP_USER_TASK_')) return null;
  const [phase, sourceId] = user.split(' ');
  assert.match(sourceId, /^[a-f0-9]{32}$/);
  assert.ok(['DESKTOP_USER_TASK_BUILD', 'DESKTOP_USER_TASK_REUSE'].includes(phase));
  const providerId = `user_data_${sourceId}`;
  const matches = name => outputs.filter(item => item.name === name);
  const last = name => matches(name).at(-1)?.value;
  const ok = value => {
    assert.equal(value?.status, 'ok', JSON.stringify(value));
    return value.data;
  };
  const checked = value => {
    const data = ok(value);
    assert.equal(data.errorCode, undefined); return data;
  };
  const data = name => checked(last(name));
  const call = (name, input = {}) => ({ text:'', calls:[{ id:`task-${++sequence}`, name, arguments:JSON.stringify({input}) }] });
  const completed = (taskId, expectedHash) => {
    const value = matches('tf_task_status').map(item => checked(item.value).task).filter(task => task.taskId === taskId).at(-1);
    if (!value) return false;
    assert.ok(!['failed', 'cancelled'].includes(value.state), JSON.stringify(value));
    if (!value.complete) return false;
    assert.equal(value.state, 'completed'); assert.equal(value.processed, 1); assert.equal(value.universeComplete, true);
    assert.equal(value.universeScope, 'explicit-symbols'); if (expectedHash) assert.equal(value.definitionHash, expectedHash); return true;
  };
  const page = artifactId => matches('tf_task_page').map(item => checked(item.value)).find(item => item.artifactId === artifactId);
  if (phase === 'DESKTOP_USER_TASK_BUILD') {
    if (!last('tf_task_guide')) return call('tf_task_guide');
    assert.match(data('tf_task_guide').example, /defineTask/);
    const validations = matches('tf_task_validate').map(item => ok(item.value));
    const candidate = TASK_FIXTURE.replace("id:'example.scan'", "id:'example.protocol_task'");
    if (!validations.length) return call('tf_task_validate', {source:candidate.replace('formatVersion:1','formatVersion:2')});
    const broken = validations[0];
    assert.equal(broken.valid, false); assert.equal(broken.extensionType, 'task'); assert.equal(broken.stage, 'validate');
    assert.match(broken.sourceHash, /^[a-f0-9]{64}$/); assert.equal(typeof broken.errorCode, 'string');
    if (validations.length === 1) return call('tf_task_validate', {source:candidate});
    const draft = validations.at(-1); assert.equal(draft.valid, true); assert.equal(draft.extensionType, 'task'); assert.equal(draft.stage, 'validate');
    assert.match(draft.sourceHash, /^[a-f0-9]{64}$/); assert.notEqual(draft.sourceHash, broken.sourceHash); assert.equal(draft.hash, draft.sourceHash);
    if (!last('tf_task_start')) return call('tf_task_start', {draftId:draft.draftId, providerId, universe:'symbols',
      symbols:[{providerId,symbol:'SH:600000',kind:'stock',name:'样本品种'}]});
    const taskId = data('tf_task_start').taskId;
    if (!completed(taskId, draft.sourceHash)) return call('tf_task_status', {taskId});
    if (!page('table')) return call('tf_task_page', {taskId, artifactId:'table', limit:2});
    assert.equal(page('table').total, 1);
    assert.deepEqual(JSON.parse(page('table').rowsJson).map(row => row[0].symbol), ['SH:600000']);
    if (!last('tf_task_save')) return call('tf_task_save', {taskId});
    const saved = data('tf_task_save'); assert.equal(saved.state, 'saved');
    if (!last('tf_task_library')) return call('tf_task_library');
    const definition = data('tf_task_library').tasks.find(item => item.id === saved.id);
    assert.equal(definition?.status, 'ready'); assert.ok(tools.some(tool => (tool.function ?? tool).name === definition.toolName));
    return {text:'用户任务生成、运行和保存验证完成', calls:[]};
  }
  const saved = data('tf_task_save');
  const definition = data('tf_task_library').tasks.find(item => item.id === saved.id); assert.ok(definition?.toolName);
  const repaired = matches('tf_task_validate').map(item => ok(item.value)).findLast(item => item.valid === true);
  if (!last(definition.toolName)) {
    assert.ok(tools.some(tool => (tool.function ?? tool).name === definition.toolName));
    return call(definition.toolName, {providerId, universe:'result', resultTaskId:data('tf_task_start').taskId, artifactId:'symbols', parameters:{minimum:0}});
  }
  const taskId = data(definition.toolName).taskId;
  if (!completed(taskId, repaired?.sourceHash)) return call('tf_task_status', {taskId});
  if (!page('report')) return call('tf_task_page', {taskId, artifactId:'report'});
  assert.match(page('report').text, /研究示例/);
  if (!last('tf_task_remove')) return call('tf_task_remove', {id:saved.id, revision:saved.revision});
  assert.equal(data('tf_task_remove').state, 'removed');
  assert.ok(!tools.some(tool => (tool.function ?? tool).name === definition.toolName), 'removed tool was not retired from the model directory');
  return {text:'已保存任务复用和删除验证完成', calls:[]};
}
