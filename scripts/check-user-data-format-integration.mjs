import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { startFormatBridge } from './user-data-format-bridge.mjs';
import { dataWorkerFactory } from './user-data-fixtures.mjs';
import { taskWorkerFactory, TASK_FIXTURE } from './user-task-fixtures.mjs';
import { createUserDataNative } from '../src/user-data/native-client.ts';
import { UserDataManager } from '../src/user-data/manager.ts';
import { createUserDataTools } from '../src/user-data/tools.ts';
import { UserTaskManager } from '../src/user-task/manager.ts';
import { UserTaskLibrary } from '../src/user-task/library.ts';
import { createTaskDataHost } from '../src/user-task/sources.ts';
import { createUserTaskTools, createSavedTaskTool } from '../src/user-task/tools.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { McpConnection } from '../src/ai-mcp/session.ts';
import { SQLITE_CONNECTOR_SOURCE, PARQUET_CONNECTOR_SOURCE } from '../src/user-data/format-examples.ts';
const active=()=>new AbortController().signal;
const digest=files=>createHash('sha256').update(JSON.stringify(files)).digest('hex');
async function fixture(){
  const bridge=await startFormatBridge(),native=createUserDataNative(bridge.invoke);
  let registry,library;
  const data=new UserDataManager(native,id=>registry.createOwner(id),{workerFactory:dataWorkerFactory});
  const task=new UserTaskManager(createTaskDataHost({providers:async()=>[],loadedSymbols:()=>[],catalog:async()=>{throw Error('no network catalog');},
    market:{execute:async()=>{throw Error('no network market');}},data:()=>data}),{workerFactory:taskWorkerFactory});
  const host={manager:task,library:()=>library,watchlist:()=>[]};
  registry=new CapabilityRegistry([...createUserDataTools(data),...createUserTaskTools(host)]);
  const records=new Map(),store={list:async()=>structuredClone([...records.values()]),close:async()=>{},async compareAndSwap(id,expected,record){
    if((records.get(id)?.revision??null)!==expected)throw Error('conflict');if(record)records.set(id,structuredClone(record));else records.delete(id);
  }};
  library=new UserTaskLibrary(task,store,id=>registry.createOwner(id),(v,id,s)=>createSavedTaskTool(host,v,id,s));
  const core=new CapabilityCore(registry),context={appInstanceId:'format-integration',chartId:'main',provider:'tdx',instrument:'SH:600000',resolution:'1D',adjustment:'none',selectionGeneration:1};
  const connection=new McpConnection({context:()=>context,describe:()=>registry.describe(),subscribeTools:fn=>registry.subscribe(fn),
    open:permissions=>core.openSession({context,currentContext:()=>context,permissions})},()=>{});
  let sequence=0;
  const rpc=async(method,params={},id=++sequence)=>{const reply=await connection.receive(JSON.stringify({jsonrpc:'2.0',...(id===null?{}:{id}),method,params}));return reply===null?null:JSON.parse(reply);};
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'format-integration',version:'1'}});
  await rpc('notifications/initialized',{},null);connection.authorizeAssistant();await data.initialize();await library.initialize();
  return {bridge,native,data,task,library,registry,rpc,sourceId:bridge.info.id,
    async call(name,input={}){const raw=await rpc('tools/call',{name:name.replaceAll('.','_'),arguments:{input}});const reply=raw.result?.structuredContent?.reply;
      assert.equal(reply?.status,'ok',JSON.stringify(raw));assert.equal(reply.data?.errorCode,undefined,JSON.stringify(reply));return reply.data;},
    async close(){connection.close();await library.close();await task.close();await data.close();await bridge.close();},
  };
}
for(const [format,source,path] of [['sqlite',SQLITE_CONNECTOR_SOURCE,'market.db'],['parquet',PARQUET_CONNECTOR_SOURCE,'SH_600000.parquet']]){
  test(`${format}: actual binary -> authorized native I/O -> Worker -> Task -> shared MCP save/reuse`,{timeout:600000},async()=>{
    const f=await fixture();try{
      const before=digest(await f.bridge.invoke('test_fixtures'));
      const sample=await f.call('tf.data.sample',{sourceId:f.sourceId,path,format,limit:format==='sqlite'?5:0});
      assert.ok(sample.columns.length);if(format==='sqlite')assert.equal(JSON.parse(sample.rowsJson)[0][0],'daily_bars');else assert.equal(sample.totalRows,5);
      const validation=await f.call('tf.data.validate',{sourceId:f.sourceId,source});assert.equal(validation.valid,true,JSON.stringify(validation));assert.equal(validation.sampleRows,2);
      await f.call('tf.data.install',{draftId:validation.draftId});await f.data.idle();
      const mounted=f.data.list()[0],provider=f.data.connector(f.sourceId).provider;
      const c1=await provider.catalog({limit:1},active()),c2=await provider.catalog({limit:1,cursor:c1.nextCursor},active());
      assert.equal(c1.symbols[0].symbol,'SH:600000');assert.equal(c2.symbols[0].symbol,'SZ:000001');
      let cursor;const bars=[];
      do{const h=await provider.execute({operation:'history',providerId:provider.providerId,symbol:'SH:600000',kind:'stock',resolution:'1D',adjustment:'none',count:2,...(cursor?{cursor}:{})},active());
        bars.push(...h.bars);cursor=h.nextCursor;}while(cursor);
      assert.deepEqual(bars.map(b=>b.time),[1700000000,1700086400,1700172800,1700259200,1700345600]);assert.deepEqual(bars.map(b=>b.close),[10,11,12,13,14]);
      const taskDraft=await f.call('tf.task.validate',{source:TASK_FIXTURE});assert.equal(taskDraft.valid,true);
      const started=await f.call('tf.task.start',{draftId:taskDraft.draftId,providerId:provider.providerId,universe:'catalog'});await f.task.wait(started.taskId);
      const status=await f.call('tf.task.status',{taskId:started.taskId});assert.equal(status.task.state,'completed',JSON.stringify(status));assert.equal(status.task.processed,2);
      const table=await f.call('tf.task.page',{taskId:started.taskId,artifactId:'table'});assert.equal(JSON.parse(table.rowsJson).length,2);
      await f.call('tf.task.save',{taskId:started.taskId});const saved=(await f.call('tf.task.library')).tasks[0];
      assert.ok((await f.rpc('tools/list')).result.tools.some(t=>t.name===saved.toolName));
      const again=await f.call(saved.toolName,{providerId:provider.providerId,universe:'catalog',parameters:{minimum:1}});await f.task.wait(again.taskId);
      assert.equal(f.task.status(again.taskId).state,'completed');
      await f.call('tf.task.remove',{id:saved.id,revision:saved.revision});
      assert.ok(!(await f.rpc('tools/list')).result.tools.some(t=>t.name===saved.toolName));
      const old=f.native.io(f.data.info(f.sourceId));
      const restored=await f.bridge.invoke('test_restart');assert.equal(restored[0].hasConnector,true);assert.notEqual(restored[0].revision,mounted.revision);
      await assert.rejects(old.execute({operation:'read',path,offset:0,length:1},active()));
      assert.equal(await f.native.source(restored[0]),source);
      assert.equal(digest(await f.bridge.invoke('test_fixtures')),before);
    }finally{await f.close();}
  });
}

test('format example distribution is exact and supported by the common AI guide',()=>{
  for(const [name,source] of [['sqlite-daily.tfc',SQLITE_CONNECTOR_SOURCE],['parquet-daily.tfc',PARQUET_CONNECTOR_SOURCE]])
    assert.equal(readFileSync(new URL('../examples/user-research/'+name,import.meta.url),'utf8').trimEnd(),source);
});
