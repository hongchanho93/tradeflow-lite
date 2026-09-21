import test from 'node:test';
import assert from 'node:assert/strict';
import { UserTaskManager } from '../src/user-task/manager.ts';
import { TASK_FIXTURE, TASK_SYMBOL, TASK_BATCH, taskWorkerFactory } from './user-task-fixtures.mjs';
test('the completed start-request signal must not keep owning the long task data lease',async()=>{
  let acquiredSignal,finish,notify;const ready=new Promise(r=>notify=r);
  const lifetime=new AbortController();const host={async acquire(_id,_venue,_history,signal){acquiredSignal=signal;return {providerId:'test',name:'test',revision:'v1',signal:lifetime.signal,
    async catalog(){return {symbols:[TASK_SYMBOL]};},history(){notify();return new Promise(r=>finish=r);},close(){}};}};
  const manager=new UserTaskManager(host,{workerFactory:taskWorkerFactory});const owner={signal:new AbortController().signal},request=new AbortController();
  try{const valid=await manager.validate(TASK_FIXTURE,owner.signal);const tx=await manager.prepareStart(valid,{providerId:'test',universe:{type:'catalog'}},owner,request.signal);
    await tx.commit();tx.dispose();await ready;request.abort();assert.equal(acquiredSignal.aborted,false);finish(TASK_BATCH.history.daily);await manager.wait(tx.result.taskId,owner);
    assert.equal(manager.status(tx.result.taskId,owner).state,'completed');
  }finally{finish?.(TASK_BATCH.history.daily);await manager.close();}
});
test('an I/O timeout cancels the read but still waits for its real completion',async()=>{
  let finish,notify;const ready=new Promise(r=>notify=r);
  const host={async acquire(){return {providerId:'test',name:'test',revision:'v1',signal:new AbortController().signal,async catalog(){return {symbols:[TASK_SYMBOL]};},
    history(){notify();return new Promise(r=>finish=r);},close(){}};}};
  const manager=new UserTaskManager(host,{workerFactory:taskWorkerFactory,ioTimeoutMs:15}),owner={signal:new AbortController().signal};
  try{const valid=await manager.validate(TASK_FIXTURE,owner.signal);const tx=await manager.prepareStart(valid,{providerId:'test',universe:{type:'catalog'}},owner);await tx.commit();tx.dispose();await ready;
    await new Promise(r=>setTimeout(r,40));assert.equal(manager.status(tx.result.taskId,owner).state,'cancelling');assert.equal(manager.activeCount,1);
    finish(TASK_BATCH.history.daily);await manager.wait(tx.result.taskId,owner);assert.equal(manager.status(tx.result.taskId,owner).errorCode,'task_data_timeout');
  }finally{finish?.(TASK_BATCH.history.daily);await manager.close();}
});
