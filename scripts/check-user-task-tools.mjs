import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { McpConnection } from '../src/ai-mcp/session.ts';
import { UserTaskManager } from '../src/user-task/manager.ts';
import { UserTaskLibrary } from '../src/user-task/library.ts';
import { createUserTaskTools, createSavedTaskTool } from '../src/user-task/tools.ts';
import { TASK_FIXTURE, TASK_SYMBOL, TASK_BATCH, taskWorkerFactory } from './user-task-fixtures.mjs';
async function fixture(mode='assistant') {
  const records=new Map();const store={async list(){return structuredClone([...records.values()]);},async close(){},async compareAndSwap(id,expected,record){
    if((records.get(id)?.revision??null)!==expected)throw Error('conflict');if(record)records.set(id,structuredClone(record));else records.delete(id);
  }};
  const data={async acquire(){return {providerId:'test',revision:'v1',name:'合成数据',signal:new AbortController().signal,
    async catalog(){return {symbols:[TASK_SYMBOL]};},async history(){return TASK_BATCH.history.daily;},close(){}};}};
  const manager=new UserTaskManager(data,{workerFactory:taskWorkerFactory});let library,registry;
  const taskHost={manager,library:()=>library,watchlist:()=>[TASK_SYMBOL]};
  registry=new CapabilityRegistry(createUserTaskTools(taskHost));
  library=new UserTaskLibrary(manager,store,id=>registry.createOwner(id),(v,id,s)=>createSavedTaskTool(taskHost,v,id,s));
  const core=new CapabilityCore(registry),context={appInstanceId:'task-tool-test',chartId:'main',provider:'test',instrument:'SH:600000',resolution:'1D',adjustment:'none',selectionGeneration:1};
  const host={context:()=>context,describe:()=>registry.describe(),subscribeTools:fn=>registry.subscribe(fn),open:permissions=>core.openSession({context,currentContext:()=>context,permissions})};
  const clients=[];
  async function connect(access=mode){
    const connection=new McpConnection(host,()=>{},{approvalMs:60});clients.push(connection);let sequence=0;
    const rpc=async(method,params={},id=`rpc-${++sequence}`)=>{
      const value=await connection.receive(JSON.stringify({jsonrpc:'2.0',...(id===null?{}:{id}),method,params}));return value===null?null:JSON.parse(value);
    };
    await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'task-test',version:'1'}});await rpc('notifications/initialized',{},null);
    access==='assistant'?connection.authorizeAssistant():connection.authorize(access);
    return {connection,rpc,async call(name,input={},id){const reply=await rpc('tools/call',{name:name.replaceAll('.','_'),arguments:{input}},id);return reply?.result?.structuredContent?.reply??reply;},
      async refresh(){return (await rpc('tools/list')).result.tools;}};
  }
  await library.initialize();const client=await connect();
  return {manager,library,registry,context,client,connect,records,async close(){clients.forEach(c=>c.close());await library.close();await manager.close();}};
}
async function draft(f,source=TASK_FIXTURE){const r=await f.client.call('tf.task.validate',{source});assert.equal(r.status,'ok',JSON.stringify(r));assert.equal(r.data.valid,true,JSON.stringify(r));return r.data.draftId;}
async function start(f){const id=await draft(f),r=await f.client.call('tf.task.start',{draftId:id,providerId:'test',universe:'catalog'});assert.equal(r.status,'ok',JSON.stringify(r));await f.manager.wait(r.data.taskId);return r.data.taskId;}
test('shared task tools expose their SDK but no native path, shell or source-edit operation',async()=>{
  const f=await fixture();try{const tools=await f.client.refresh();assert.equal(tools.length,15);assert.equal(tools.some(t=>/shell|terminal|grant_directory|write_file/.test(t.name)),false);
    const guide=await f.client.call('tf.task.guide');assert.equal(guide.status,'ok');assert.match(guide.data.example,/defineTask/);
  }finally{await f.close();}
});
test('built-in assistant starts, reads, saves and discovers the same new Tool without additional permission modes',async()=>{
  const f=await fixture();try{const validation=await f.client.call('tf.task.validate',{source:TASK_FIXTURE});assert.equal(validation.status,'ok');assert.equal(validation.data.valid,true);
    assert.equal(validation.data.extensionType,'task');assert.equal(validation.data.stage,'validate');assert.match(validation.data.sourceHash,/^[a-f0-9]{64}$/);
    const started=await f.client.call('tf.task.start',{draftId:validation.data.draftId,providerId:'test',universe:'catalog'});assert.equal(started.status,'ok');await f.manager.wait(started.data.taskId);const id=started.data.taskId;
    const status=await f.client.call('tf.task.status',{taskId:id});assert.equal(status.data.task.state,'completed');assert.equal(status.data.task.definitionHash,validation.data.sourceHash);
    const page=await f.client.call('tf.task.page',{taskId:id,artifactId:'table'});assert.equal(JSON.parse(page.data.rowsJson)[0][1],1);
    const saved=await f.client.call('tf.task.save',{taskId:id});assert.equal(saved.status,'ok',JSON.stringify(saved));assert.equal(f.client.connection.view().approvals.length,0);
    const tools=await f.client.refresh();const dynamic=tools.find(t=>t.name.startsWith('user_task_'));assert.ok(dynamic);assert.equal(tools.length,16);
    const run=await f.client.call(dynamic.name,{providerId:'test',universe:'watchlist',parameters:{minimum:2}});assert.equal(run.status,'ok',JSON.stringify(run));await f.manager.wait(run.data.taskId);
    const output=await f.client.call('tf.task.page',{taskId:run.data.taskId,artifactId:'table'});assert.equal(output.data.total,0);
  }finally{await f.close();}
});
test('legacy analysis mode name still receives the one-time full business grant',async()=>{
  const f=await fixture('analysis');try{const id=await draft(f);const started=await f.client.call('tf.task.start',{draftId:id,providerId:'test',universe:'catalog'});
    assert.equal(started.status,'ok');assert.equal(f.client.connection.view().approvals.length,0);await f.manager.wait(started.data.taskId);
    const saved=await f.client.call('tf.task.save',{taskId:started.data.taskId});assert.equal(saved.status,'ok');assert.equal(f.records.size,1);
  }finally{await f.close();}
});
test('Task validation failure returns an exact candidate hash and does not create a runnable draft',async()=>{
  const f=await fixture();try{const broken=TASK_FIXTURE.replace('formatVersion:1','formatVersion:2');const r=await f.client.call('tf.task.validate',{source:broken});
    assert.equal(r.status,'ok',JSON.stringify(r));assert.equal(r.data.valid,false);assert.equal(r.data.extensionType,'task');assert.equal(r.data.stage,'validate');
    assert.match(r.data.sourceHash,/^[a-f0-9]{64}$/);assert.equal(r.data.errorCode,'task_unsupported_version');
    assert.equal(r.data.path,'manifest.formatVersion');assert.equal(r.data.reason,'unsupported_version');assert.equal(r.data.expected,'1');
    assert.equal(r.data.draftId,undefined);assert.equal(f.manager.list().length,0);
  }finally{await f.close();}
});
test('Task validation pinpoints an invalid camelCase table column id without trial-and-error',async()=>{
  const f=await fixture();try{
    const broken=TASK_FIXTURE.replace("{id:'change',title:'变化',type:'number'}","{id:'lastClose',title:'变化',type:'number'}");
    const r=await f.client.call('tf.task.validate',{source:broken});
    assert.equal(r.status,'ok',JSON.stringify(r));assert.equal(r.data.valid,false);assert.equal(r.data.errorCode,'task_invalid_manifest');
    assert.match(r.data.path,/manifest\.outputs\[0\]\.columns\[1\]\.id/);assert.equal(r.data.reason,'invalid_identifier');
    assert.match(r.data.expected,/lowercase identifier/);assert.equal(r.data.draftId,undefined);
  }finally{await f.close();}
});
test('legacy workbench mode name also executes without per-task approval',async()=>{
  const f=await fixture('workbench');try{const id=await draft(f);const started=await f.client.call('tf.task.start',{draftId:id,providerId:'test',universe:'catalog'});
    assert.equal(started.status,'ok');assert.equal(f.client.connection.view().approvals.length,0);await f.manager.wait(started.data.taskId);assert.equal(f.manager.list().length,1);
  }finally{await f.close();}
});
test('drafts, job reads and resource operations cannot be borrowed by another session',async()=>{
  const f=await fixture();try{const draftId=await draft(f),other=await f.connect();assert.equal((await other.call('tf.task.start',{draftId,providerId:'test'})).code,'snapshot_unavailable');
    const r=await f.client.call('tf.task.start',{draftId,providerId:'test'});assert.equal(r.status,'ok',JSON.stringify(r));await f.manager.wait(r.data.taskId);
    for(const name of ['status','cancel','release']){const reply=await other.call('tf.task.'+name,{taskId:r.data.taskId});assert.equal(reply.data.errorCode,'task_unavailable');}
    assert.equal((await other.call('tf.task.list')).data.tasks.length,0);
  }finally{await f.close();}
});
test('duplicate start request IDs replay the same handle rather than launching a second job',async()=>{
  const f=await fixture();try{const draftId=await draft(f),input={draftId,providerId:'test',universe:'catalog'};
    const a=await f.client.call('tf.task.start',input,'same-start');assert.equal(a.status,'ok',JSON.stringify(a));const b=await f.client.call('tf.task.start',input,'same-start');
    assert.equal(a.data.taskId,b.data.taskId);await f.manager.wait(a.data.taskId);assert.equal(f.manager.list().length,1);
  }finally{await f.close();}
});
test('explicit UI sharing grants result reads, not cancellation, source authority or save rights',async()=>{
  const f=await fixture();try{const id=await start(f),other=await f.connect();const token=f.manager.createShare(id);
    const claimed=await other.call('tf.task.claim',{token});assert.equal(claimed.data.task.taskId,id);assert.equal((await other.call('tf.task.page',{taskId:id,artifactId:'table'})).data.total,1);
    assert.equal((await other.call('tf.task.cancel',{taskId:id})).data.errorCode,'task_unavailable');assert.equal((await other.call('tf.task.save',{taskId:id})).code,'snapshot_unavailable');
    const replay=await other.call('tf.task.claim',{token});assert.equal(replay.data.errorCode,'task_share_unavailable');
  }finally{await f.close();}
});
test('source updates/removal publish new tool revisions and stale saved revisions cannot overwrite',async()=>{
  const f=await fixture();try{const id=await start(f);const saved=await f.client.call('tf.task.save',{taskId:id});assert.equal(saved.status,'ok',JSON.stringify(saved));
    const duplicate=await f.client.call('tf.task.save',{taskId:id});assert.equal(duplicate.code,'state_conflict');
    const list=await f.client.call('tf.task.library');const row=list.data.tasks[0];const source=await f.client.call('tf.task.source',{id:row.id});assert.equal(source.data.source,TASK_FIXTURE);assert.match(source.data.sourceHash,/^[a-f0-9]{64}$/);
    const removed=await f.client.call('tf.task.remove',{id:row.id,revision:row.revision});assert.equal(removed.status,'ok');assert.equal((await f.client.refresh()).some(t=>t.name===row.toolName),false);
  }finally{await f.close();}
});
