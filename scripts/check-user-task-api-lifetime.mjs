import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiConversation } from '../src/ai-api/conversation.ts';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { UserTaskManager } from '../src/user-task/manager.ts';
import { createUserTaskTools } from '../src/user-task/tools.ts';
import { TASK_FIXTURE, TASK_SYMBOL, TASK_BATCH, taskWorkerFactory } from './user-task-fixtures.mjs';
const profile={settings:{protocol:'chat',endpoint:'https://fixture.invalid/v1',model:'fixture',stream:false,includeUsage:false,chatTokenField:'max_tokens',maxTokens:1024,timeoutSeconds:60,allowLocalHttp:false},revision:'1',hasKey:false,remembered:false};
const tick=()=>new Promise(r=>setTimeout(r,2));
test('manual chart change preserves the in-flight model turn and app task; new chat revokes the task',async()=>{
  let finishRead,finishModel,enteredRead=false,enteredModel=false,context={appInstanceId:'task-api',chartId:'main',provider:'test',instrument:'SH:600000',resolution:'1D',adjustment:'none',selectionGeneration:1};
  const manager=new UserTaskManager({async acquire(){return {providerId:'test',name:'test',revision:'1',signal:new AbortController().signal,
    async catalog(){return {symbols:[TASK_SYMBOL]};},async history(){enteredRead=true;return new Promise(r=>finishRead=r);},close(){}};}},{workerFactory:taskWorkerFactory});
  const registry=new CapabilityRegistry(createUserTaskTools({manager,library(){throw Error('not used');},watchlist:()=>[TASK_SYMBOL]})),core=new CapabilityCore(registry);
  const host={context:()=>context,describe:()=>registry.describe(),subscribeTools:fn=>registry.subscribe(fn),open:permissions=>core.openSession({context,currentContext:()=>context,permissions})};
  let turns=0;const conversation=new ApiConversation(host,{async turn(_profile,payload,signal){
    turns++;let name,input;
    if(turns===1){name='tf_task_validate';input={source:TASK_FIXTURE};}
    else if(turns===2){const reply=JSON.parse(payload.messages.findLast(m=>m.role==='tool').content);assert.equal(reply.status,'ok');name='tf_task_start';input={draftId:reply.data.draftId,providerId:'test',universe:'catalog'};}
    else {enteredModel=true;return new Promise((resolve,reject)=>{finishModel=()=>resolve({text:'研究继续',calls:[],usage:{inputTokens:1,outputTokens:1},replay:[{role:'assistant',content:'研究继续'}]});const abort=()=>reject(Error('cancelled'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
    const call={id:`call-${turns}`,name,arguments:JSON.stringify({input})};return {text:'',calls:[call],usage:{inputTokens:1,outputTokens:1},replay:[{role:'assistant',content:null,tool_calls:[{id:call.id,type:'function',function:{name,arguments:call.arguments}}]}]};
  }});
  conversation.reset(profile);const send=conversation.send('执行研究任务');
  try{
    const until=performance.now()+5000;while(!enteredRead||!enteredModel){assert.ok(performance.now()<until,'API start timed out');await tick();}
    const id=manager.list()[0].taskId;context={...context,selectionGeneration:2,instrument:'SH:600001'};conversation.invalidate();await tick();
    assert.equal(conversation.view().busy,true);assert.equal(conversation.view().failed,false);assert.equal(manager.list().length,1);assert.equal(manager.status(id).state,'running');
    finishModel();await send;assert.equal(conversation.view().status,'completed');assert.equal(conversation.view().failed,false);
    finishRead(TASK_BATCH.history.daily);await manager.wait(id);assert.equal(manager.status(id).state,'completed');
    conversation.reset(profile);assert.equal(manager.list().length,0);
  }finally{finishRead?.(TASK_BATCH.history.daily);conversation.reset();await manager.close();}
});
test('app close awaits a pending source acquisition and closes the eventual lease',async()=>{
  let acquire,entered=false,closed=0;const manager=new UserTaskManager({async acquire(){entered=true;return new Promise(r=>acquire=r);}},{workerFactory:taskWorkerFactory});
  const signal=new AbortController().signal,valid=await manager.validate(TASK_FIXTURE,signal);
  const prepared=manager.prepareStart(valid,{providerId:'test',universe:{type:'catalog'}},{signal});const rejected=assert.rejects(prepared);
  while(!entered)await tick();let drained=false;const close=manager.close().then(()=>{drained=true;});await tick();
  try{assert.equal(drained,false);}finally{acquire({providerId:'test',name:'test',revision:'1',signal,catalog:async()=>({symbols:[]}),history:async()=>null,close(){closed++;}});await rejected;await close;}
  assert.equal(closed,1);
});
