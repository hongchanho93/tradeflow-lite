import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { runConnector } from '../src/user-data/runtime-client.ts';
import { DATA_BUDGET, validateIo } from '../src/user-data/contracts.ts';

const definition = `defineConnector({formatVersion:1,apiVersion:1,id:'test.data',version:1,name:'测试数据',
  supports:{venues:['SH'],kinds:['stock'],resolutions:['1D'],adjustments:['none']},
  *listSymbols(q,io) { const page=yield io.list('',q.cursor,2); return {symbols:page.entries.map(e=>({symbol:'SH:'+e.name.slice(0,6),name:e.name,kind:'stock'})),nextCursor:page.next}; },
  *getHistory(q,io) { const first=yield io.read('600000.csv',0,3); const last=yield io.read('600000.csv',3,100,first.revision); return {bytes:first.data.concat(last.data)}; }
});`;
const active = () => new AbortController().signal;
const made = [];
function workerFactory() {
  const node = new Worker(new URL('./user-data-node-worker.mjs', import.meta.url));
  const worker = { onmessage:null,onerror:null,onmessageerror:null,terminated:0,
    postMessage: message=>node.postMessage(message), terminate(){ this.terminated++; void node.terminate(); } };
  node.on('message',data=>worker.onmessage?.({data})); node.on('messageerror',()=>worker.onmessageerror?.({}));
  node.on('error',e=>worker.onerror?.({message:e.message,preventDefault(){}})); made.push(worker); return worker;
}
const invoke = (source=definition,operation='validate',io=null,input={},options={}) =>
  runConnector({source,operation,input},io,active(),{workerFactory,...options});
test('manifest validates without running catalog/history and terminates its Worker', async()=>{
  const result=await invoke(); assert.equal(result.manifest.name,'测试数据'); assert.equal(result.value,undefined);
  assert.equal(made.at(-1).terminated,1); assert.equal(Object.isFrozen(result.manifest),true);
});
test('connector generator performs only host-mediated paged directory I/O',async()=>{
  const calls=[]; const result=await invoke(definition,'catalog',{async execute(request){calls.push(request); return {entries:[{name:'600000.csv',kind:'file'}],next:null};}},{limit:2});
  assert.equal(calls.length,1); assert.deepEqual(calls[0],{operation:'list',path:'',limit:2});
  assert.equal(result.value.symbols[0].symbol,'SH:600000'); assert.equal(made.at(-1).terminated,1);
});
test('binary range reads preserve raw bytes and carry file revisions',async()=>{
  const calls=[]; const result=await invoke(definition,'history',{async execute(request){calls.push(request);return {data:request.offset===0?[1,2,3]:[4,5],offset:request.offset,size:5,revision:'v1'};}},{symbol:'SH:600000'});
  assert.deepEqual(result.value,{bytes:[1,2,3,4,5]}); assert.equal(calls[1].fileRevision,'v1');
});
test('guest has no browser, native, network, process or module loader capabilities',async()=>{
  const source=definition.replace("const page=yield io.list('',q.cursor,2); return {symbols:page.entries.map(e=>({symbol:'SH:'+e.name.slice(0,6),name:e.name,kind:'stock'})),nextCursor:page.next};",
    "return [typeof window,typeof document,typeof fetch,typeof WebSocket,typeof Worker,typeof __TAURI_INTERNALS__,typeof process,typeof require];");
  const r=await invoke(source,'catalog'); assert.deepEqual(r.value,Array(8).fill('undefined'));
});
test('invalid, duplicate and unsupported declarations do not become connectors',async()=>{
  for(const source of ['',definition+'defineConnector({});',definition.replace('formatVersion:1','formatVersion:9'),definition.replace("id:'test.data'","id:'../escape'"),definition.replace('supports:{','permissions:["shell"],supports:{')]) {
    await assert.rejects(invoke(source),e=>e.code?.startsWith('data_')); assert.equal(made.at(-1).terminated,1);
  }
});
test('definition and generator-step infinite loops are interrupted and reclaimed',async()=>{
  await assert.rejects(invoke('while(true){}'),e=>e.code==='data_execution_timeout');
  await assert.rejects(invoke(definition.replace("const page=yield io.list('',q.cursor,2);","while(true){} const page=yield io.list('',q.cursor,2);"),'catalog'),e=>e.code==='data_execution_timeout');
  assert.equal(made.at(-1).terminated,1);
});
test('guest Promise jobs, stack overflow and memory exhaustion cannot poison the host',async()=>{
  for(const source of ['Promise.resolve().then(()=>1);'+definition,'(function f(){f()})()', 'new Array(30000000).fill(4);']) {
    await assert.rejects(invoke(source),e=>['data_async_unsupported','data_stack_limit','data_memory_limit'].includes(e.code)); assert.equal(made.at(-1).terminated,1);
  }
  assert.equal((await invoke()).manifest.id,'test.data');
});
test('captured builtins resist guest JSON/prototype tampering',async()=>{
  const result=await invoke("JSON.stringify=()=>'{bad}'; Object.keys=()=>[];"+definition);
  assert.equal(result.manifest.id,'test.data');
});
test('mismatched invocation manifest is rejected before any data I/O',async()=>{
  const valid=await invoke();let read=0;
  await assert.rejects(runConnector({source:definition.replace("name:'测试数据'","name:'改名'"),operation:'catalog',input:{},expectedManifest:valid.manifest},
    {async execute(){read++;return{};}},active(),{workerFactory}),e=>e.code==='data_connector_changed'); assert.equal(read,0);
});
test('abort kills the worker and cancels pending native I/O, never delivers late output',async()=>{
  const abort=new AbortController();let started;const ready=new Promise(r=>{started=r;});let nativeSignal;let finish;
  const promise=runConnector({source:definition,operation:'catalog',input:{}},{execute(_r,s){nativeSignal=s;started();return new Promise(r=>{finish=r;});}},abort.signal,{workerFactory});
  await Promise.race([ready,promise]);abort.abort();await assert.rejects(promise,e=>e.code==='data_cancelled');assert.equal(nativeSignal.aborted,true);assert.equal(made.at(-1).terminated,1);
  finish({entries:[],next:null});await new Promise(r=>setTimeout(r,10));
});
test('filesystem request validation rejects absolute, parent, streams and invented grants',()=>{
  for(const path of ['/secret','../secret','C:/secret','a\\b','file:stream','NUL.txt']) assert.throws(()=>validateIo({operation:'read',path,offset:0,length:2}));
  assert.throws(()=>validateIo({operation:'read',path:'a',offset:0,length:2,grant:'/tmp'}));
  assert.deepEqual(validateIo({operation:'read',path:'中文/a.csv',offset:0,length:2}),{operation:'read',path:'中文/a.csv',offset:0,length:2});
});
test('source and output budgets fail explicitly rather than silently truncate',async()=>{
  await assert.rejects(invoke(' '.repeat(DATA_BUDGET.sourceBytes+1)),e=>e.code==='data_source_too_large');
  const source=definition.replace("const page=yield io.list('',q.cursor,2); return {symbols:page.entries.map(e=>({symbol:'SH:'+e.name.slice(0,6),name:e.name,kind:'stock'})),nextCursor:page.next};","return 'x'.repeat(5000000);");
  await assert.rejects(invoke(source,'catalog'),e=>e.code==='data_output_limit');
});
test('production main imports only the host client, never evaluates Connector source',()=>{
  const text=readFileSync(new URL('../src/user-data/runtime-client.ts',import.meta.url),'utf8');
  assert.doesNotMatch(text,/evalCode|new Function|eval\(|import\(.*source/);
  assert.match(text,/terminate\(/);
});
