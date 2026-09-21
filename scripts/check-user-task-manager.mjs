import test from 'node:test';
import assert from 'node:assert/strict';
import { UserTaskManager } from '../src/user-task/manager.ts';
import { TASK_FIXTURE, TASK_SYMBOL, TASK_BATCH, taskWorkerFactory } from './user-task-fixtures.mjs';
function fixture(total=3, overrides={}) {
  const lifetime=new AbortController(), calls=[];let closed=0;
  const source={providerId:'test',name:'test data',revision:'v1',signal:lifetime.signal,
    async catalog(cursor,limit){const offset=Number(cursor??0);return {symbols:Array.from({length:Math.min(limit,total-offset)},(_,i)=>({...TASK_SYMBOL,symbol:'SH:'+String(offset+i).padStart(6,'0')})),...(offset+limit<total?{nextCursor:String(offset+limit)}:{})};},
    async history(symbol,need,signal){calls.push(symbol.symbol);if(signal.aborted)throw new Error();return TASK_BATCH.history.daily;},
    close(){closed++;},...overrides};
  const host={async acquire(){return source;}};
  const manager=new UserTaskManager(host,{workerFactory:taskWorkerFactory});const owner={signal:new AbortController().signal};
  return {manager,owner,source,lifetime,calls,get closed(){return closed;},async start(options={}){
    const valid=await manager.validate(TASK_FIXTURE,new AbortController().signal);
    const tx=await manager.prepareStart(valid,{providerId:'test',universe:{type:'catalog'},parameters:{minimum:0},...options},owner);
    await tx.commit();tx.dispose?.();return tx.result.taskId;
  }};
}
test('start is a prepared write; no data read or code execution before commit',async()=>{
  const f=fixture();try{const valid=await f.manager.validate(TASK_FIXTURE,f.owner.signal);const tx=await f.manager.prepareStart(valid,{providerId:'test',universe:{type:'catalog'}},f.owner);
    assert.equal(f.calls.length,0);tx.dispose();assert.equal(f.manager.list(f.owner).length,0);assert.equal(f.closed,1);
  }finally{await f.manager.close();}
});
test('multiple symbols execute in one VM and results are paged under the same task handle',async()=>{
  const f=fixture();try{const id=await f.start();await f.manager.wait(id,f.owner);const s=f.manager.status(id,f.owner);
    assert.equal(s.state,'completed');assert.equal(s.processed,3);assert.equal(s.discovered,3);assert.equal(f.manager.page(id,'table',{},f.owner).total,3);assert.equal(f.closed,1);
  }finally{await f.manager.close();}
});
test('cancelling a pending I/O retains its execution slot until the actual I/O settles',async()=>{
  let finish,notify;const ready=new Promise(r=>notify=r);let dataSignal;
  const f=fixture(1,{history:(_s,_n,signal)=>{dataSignal=signal;notify();return new Promise(r=>finish=r);}});
  try{const id=await f.start();await ready;f.manager.cancel(id,f.owner);assert.equal(dataSignal.aborted,true);assert.equal(f.manager.status(id,f.owner).state,'cancelling');
    assert.equal(f.manager.activeCount,1);finish(TASK_BATCH.history.daily);await f.manager.wait(id,f.owner);assert.equal(f.manager.status(id,f.owner).state,'cancelled');
    assert.equal(f.manager.activeCount,0);assert.equal(f.manager.page(id,'table',{},f.owner).total,0);
  }finally{await f.manager.close();}
});
test('source retirement rejects late data and does not auto-switch the task to the new revision',async()=>{
  let finish,notify;const ready=new Promise(r=>notify=r);const f=fixture(1,{history:()=>{notify();return new Promise(r=>finish=r);}});
  try{const id=await f.start();await ready;f.lifetime.abort();finish(TASK_BATCH.history.daily);await f.manager.wait(id,f.owner);
    assert.equal(f.manager.status(id,f.owner).state,'failed');assert.equal(f.manager.status(id,f.owner).errorCode,'task_source_changed');assert.equal(f.manager.page(id,'table',{},f.owner).total,0);
  }finally{await f.manager.close();}
});
test('other AI sessions cannot read, cancel, reuse, or release this session’s task',async()=>{
  const f=fixture();try{const id=await f.start();await f.manager.wait(id,f.owner);const other={signal:new AbortController().signal};
    for(const run of [()=>f.manager.status(id,other),()=>f.manager.page(id,'table',{},other),()=>f.manager.cancel(id,other),()=>f.manager.release(id,other)])assert.throws(run,e=>e.code==='task_unavailable');
  }finally{await f.manager.close();}
});
test('session revocation drains active work and releases retained results',async()=>{
  const f=fixture();const abort=new AbortController();f.owner.signal=abort.signal;
  try{const id=await f.start();await f.manager.wait(id,f.owner);abort.abort();assert.equal(f.manager.list().length,0);
  }finally{await f.manager.close();}
});
test('catalog cursor cycles and duplicate symbols fail explicitly rather than running forever',async()=>{
  const f=fixture(3,{async catalog(cursor){return {symbols:[TASK_SYMBOL],nextCursor:cursor?'b':'a'};}});
  try{const id=await f.start();await f.manager.wait(id,f.owner);assert.equal(f.manager.status(id,f.owner).state,'failed');assert.equal(f.manager.status(id,f.owner).errorCode,'task_duplicate_symbol');assert.equal(f.calls.length,1);
  }finally{await f.manager.close();}
});
test('an invalid output preserves earlier valid rows and labels the task partial/failed',async()=>{
  const f=fixture();try{const valid=await f.manager.validate(TASK_FIXTURE.replace('count++;const bars=',"count++;if(count===2)return [{artifactId:'missing',rows:[]}];const bars="),f.owner.signal);
    const tx=await f.manager.prepareStart(valid,{providerId:'test',universe:{type:'catalog'}},f.owner);await tx.commit();tx.dispose();const id=tx.result.taskId;await f.manager.wait(id,f.owner);
    assert.equal(f.manager.status(id,f.owner).state,'failed');assert.equal(f.manager.page(id,'table',{},f.owner).total,1);assert.equal(f.manager.status(id,f.owner).complete,false);
  }finally{await f.manager.close();}
});
test('completed SymbolList can be the next task universe without sending all symbols to the model',async()=>{
  const f=fixture();try{const first=await f.start();await f.manager.wait(first,f.owner);const second=await f.start({universe:{type:'result',taskId:first,artifactId:'symbols'}});await f.manager.wait(second,f.owner);assert.equal(f.manager.status(second,f.owner).processed,3);
  }finally{await f.manager.close();}
});
test('5127 symbols remain bounded, report progress and do not freeze host timers',async()=>{
  const f=fixture(5127);let ticks=0,changes=0;const timer=setInterval(()=>ticks++,5);const unsubscribe=f.manager.subscribe(()=>changes++);
  try{const id=await f.start();await f.manager.wait(id,f.owner);const status=f.manager.status(id,f.owner);assert.equal(status.state,'completed',JSON.stringify(status));assert.equal(status.processed,5127);assert.ok(ticks>3);assert.ok(changes>3);assert.equal(f.manager.page(id,'symbols',{offset:5000,limit:127},f.owner).rows.length,127);
  }finally{clearInterval(timer);unsubscribe();await f.manager.close();}
});
