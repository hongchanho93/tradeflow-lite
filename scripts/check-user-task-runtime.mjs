import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openTaskRuntime } from '../src/user-task/runtime-client.ts';
import { TaskResultStore } from '../src/user-task/results.ts';
import { TASK_EXAMPLE } from '../src/user-task/guide.ts';
import { TASK_FIXTURE, TASK_BATCH, taskWorkerFactory, taskWorkers } from './user-task-fixtures.mjs';
const open = (source = TASK_FIXTURE, options = {}) => openTaskRuntime(source, new AbortController().signal, { workerFactory:taskWorkerFactory, ...options });
test('ordinary editable reference task accepts readable Chinese parameter names and reports actual window coverage',async()=>{
  const runtime=await open(TASK_EXAMPLE);const results=new TaskResultStore(runtime.manifest.outputs);
  try{await runtime.start(runtime.manifest.defaults);results.append(await runtime.process(TASK_BATCH));results.append(await runtime.finish());
    assert.equal(runtime.manifest.defaults['最低变化百分比'],0);assert.equal(results.page('table').rows[0][3],true);assert.match(results.page('report').text,/短窗口 1/);
  }finally{runtime.close();}
});
test('validation captures the manifest without running create or fetching data', async () => {
  const runtime = await open(TASK_FIXTURE.replace('create(parameters){', 'create(parameters){throw new Error("not during validation");'));
  try { assert.equal(runtime.manifest.id,'example.scan'); assert.equal(runtime.manifest.outputs.length,4); }
  finally { runtime.close(); }
  assert.equal(taskWorkers.at(-1).terminated,1);
});
test('real persistent VM computes multiple symbols and four validated artifact types', async () => {
  const runtime = await open(); const results = new TaskResultStore(runtime.manifest.outputs);
  try {
    await runtime.start({minimum:0}); results.append(await runtime.process(TASK_BATCH)); results.append(await runtime.process(TASK_BATCH));
    results.append(await runtime.finish());
    assert.equal(results.page('table',{}).total,2); assert.equal(results.page('series',{}).rows[0].value,2);
    assert.match(results.page('report',{}).text,/研究示例/);
  } finally { runtime.close(); }
});
test('guest browser, filesystem, native and network APIs remain unavailable', async () => {
  const source = TASK_FIXTURE.replace("text:'仅为用户研究示例，不是交易建议。'", "text:JSON.stringify([typeof window,typeof document,typeof fetch,typeof WebSocket,typeof Worker,typeof process,typeof require,typeof __TAURI_INTERNALS__])");
  const runtime = await open(source); try { await runtime.start({minimum:0}); const out = await runtime.finish(); assert.deepEqual(JSON.parse(out[1].text),Array(8).fill('undefined')); } finally { runtime.close(); }
});
test('malformed declarations, duplicate definitions and unexpected permissions are rejected', async () => {
  for (const source of ['',TASK_FIXTURE+'defineTask({});',TASK_FIXTURE.replace('formatVersion:1','formatVersion:4'),TASK_FIXTURE.replace('version:1,name',"permissions:['shell'],version:1,name")]) {
    await assert.rejects(open(source)); assert.equal(taskWorkers.at(-1).terminated,1);
  }
});
test('infinite loops, OOM, stack exhaustion and pending jobs terminate their Worker', async () => {
  for (const source of ['while(true){}','new Array(30000000).fill(1);','(function f(){f()})()','Promise.resolve().then(()=>1);'+TASK_FIXTURE]) {
    await assert.rejects(open(source),error=>/^task_/.test(error.code)); assert.equal(taskWorkers.at(-1).terminated,1);
  }
  const runtime=await open(TASK_FIXTURE.replace('count++;const bars=', 'while(true){} count++;const bars='));
  await runtime.start({minimum:0}); await assert.rejects(runtime.process(TASK_BATCH),e=>e.code==='task_execution_timeout');
  assert.equal(taskWorkers.at(-1).terminated,1);
});
test('async callbacks and invalid parameters cannot silently become empty success', async () => {
  const runtime=await open(TASK_FIXTURE.replace('onSymbol(batch){','async onSymbol(batch){'));
  try { await assert.rejects(runtime.start({minimum:'bad'})); } finally { runtime.close(); }
  const second=await open(TASK_FIXTURE.replace('onSymbol(batch){','async onSymbol(batch){'));
  try { await second.start({minimum:0}); await assert.rejects(second.process(TASK_BATCH),e=>e.code==='task_async_unsupported'); } finally { second.close(); }
});
test('captured serialization survives guest builtin tampering', async () => {
  const runtime=await open("JSON.stringify=()=>'{bad}';Object.keys=()=>[];"+TASK_FIXTURE);
  try { assert.equal(runtime.manifest.id,'example.scan'); await runtime.start({minimum:0}); assert.equal((await runtime.process(TASK_BATCH)).length,2); } finally { runtime.close(); }
});
test('hard deadline terminates an unresponsive Worker and ignores late responses', async () => {
  let terminated=0;const worker={onmessage:null,onerror:null,onmessageerror:null,postMessage(){},terminate(){terminated++;}};
  await assert.rejects(openTaskRuntime(TASK_FIXTURE,new AbortController().signal,{workerFactory:()=>worker,hardTimeoutMs:15}),e=>e.code==='task_execution_timeout');
  assert.equal(terminated,1);assert.equal(worker.onmessage,null);
});
test('abort terminates active VM; a new task starts cleanly', async () => {
  const abort=new AbortController();const runtime=await openTaskRuntime(TASK_FIXTURE,abort.signal,{workerFactory:taskWorkerFactory});
  abort.abort();await assert.rejects(runtime.start({minimum:0}),e=>e.code==='task_cancelled');
  assert.equal(taskWorkers.at(-1).terminated,1); const fresh=await open();fresh.close();
});
test('host client never imports an engine or evaluates user code in the main context',()=>{
  const source=readFileSync(new URL('../src/user-task/runtime-client.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/evalCode|new Function|eval\(|from ['"].*engine/);assert.match(source,/terminate\(/);
});
