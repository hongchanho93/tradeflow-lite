import test from 'node:test';
import assert from 'node:assert/strict';
import { UserTaskLibrary } from '../src/user-task/library.ts';
import { UserTaskManager } from '../src/user-task/manager.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { TASK_FIXTURE, taskWorkerFactory } from './user-task-fixtures.mjs';
class Store {
  records=new Map();fail=false;failRollback=false;
  async list(){return structuredClone([...this.records.values()]);}
  async compareAndSwap(id,expected,record){
    if(this.fail||this.failRollback&&!record)throw Error('storage');
    if((this.records.get(id)?.revision??null)!==expected)throw Error('conflict');
    if(record)this.records.set(id,structuredClone(record));else this.records.delete(id);
  }
  async close(){}
}
const context=()=>{const signal=new AbortController().signal;return {context:{scope:'app',appInstanceId:'library-test'},signal,session:{signal},checkpoint(){}};};
function fixture(store=new Store()) {
  const registry=new CapabilityRegistry([]),manager=new UserTaskManager({async acquire(){throw Error('restore must not run data');}},{workerFactory:taskWorkerFactory});
  const define=(prepared,id,signal)=>({id,version:prepared.manifest.version,title:prepared.manifest.name,description:'Task fixture',effect:'read',scope:'app',
    inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{},additionalProperties:false},run(){assert.equal(signal.aborted,false);return{};}});
  const library=new UserTaskLibrary(manager,store,id=>registry.createOwner(id),define);
  return {registry,manager,library,store,async valid(source=TASK_FIXTURE){return manager.validate(source,new AbortController().signal);},async close(){await library.close();await manager.close();}};
}
async function save(f,valid,expected=null){const tx=await f.library.prepareSave(valid,expected,context());await tx.commit();tx.dispose();return tx.result;}
test('saving is transactional and registers one dynamic tool only after commit',async()=>{
  const f=fixture();try{await f.library.initialize();const valid=await f.valid();const tx=await f.library.prepareSave(valid,null,context());assert.equal(f.registry.describe().length,0);assert.equal(f.store.records.size,0);
    await tx.commit();tx.dispose();assert.equal(f.registry.describe().length,1);assert.equal(f.store.records.size,1);assert.equal(f.library.list()[0].status,'ready');
  }finally{await f.close();}
});
test('saved tasks restore by hash and isolated validation without reading market data or auto-running',async()=>{
  const store=new Store();const first=fixture(store);await save(first,await first.valid());await first.close();
  const second=fixture(store);try{await second.library.initialize();assert.equal(second.registry.describe().length,1);assert.equal(second.manager.list().length,0);assert.equal(second.library.list()[0].name,'收盘变化研究');}
  finally{await second.close();}
});
test('update and remove retire the old tool and never reuse its execution lifetime',async()=>{
  const f=fixture();try{await save(f,await f.valid());const old=f.library.get('example.scan');const valid=await f.valid(TASK_FIXTURE.replace('version:1,name','version:2,name'));
    await save(f,valid,old.record.revision);assert.equal(old.signal.aborted,true);assert.equal(f.library.get('example.scan').validated.manifest.version,2);
    const current=f.library.get('example.scan');const tx=await f.library.prepareRemove('example.scan',current.record.revision,context());await tx.commit();tx.dispose();assert.equal(current.signal.aborted,true);assert.equal(f.registry.describe().length,0);assert.equal(f.store.records.size,0);
  }finally{await f.close();}
});
test('stale revisions and fabricated validation objects cannot overwrite a saved task',async()=>{
  const f=fixture();try{const valid=await f.valid();await save(f,valid);await assert.rejects(f.library.prepareSave(valid,null,context()));
    await assert.rejects(f.library.prepareSave({...valid},f.library.get('example.scan').record.revision,context()));assert.equal(f.store.records.size,1);
  }finally{await f.close();}
});
test('failed storage commit restores the previous mounted tool',async()=>{
  const f=fixture();try{await save(f,await f.valid());const previous=f.library.get('example.scan');const valid=await f.valid(TASK_FIXTURE.replace('version:1,name','version:2,name'));
    const tx=await f.library.prepareSave(valid,previous.record.revision,context());f.store.fail=true;await assert.rejects(tx.commit());f.store.fail=false;await tx.rollback();tx.dispose();
    assert.equal(f.library.get('example.scan').validated.manifest.version,1);assert.equal(f.registry.describe().length,1);
  }finally{await f.close();}
});
test('compensation refuses to replace a record modified by another writer',async()=>{
  const f=fixture();try{const valid=await f.valid();const tx=await f.library.prepareSave(valid,null,context());await tx.commit();
    const row=f.store.records.get(valid.manifest.id);f.store.records.set(row.id,{...row,revision:crypto.randomUUID()});await assert.rejects(tx.rollback());tx.dispose();assert.equal(f.store.records.size,1);
  }finally{await f.close();}
});
test('corrupt saved task records are isolated and not executed or silently deleted',async()=>{
  const store=new Store(),f=fixture(store);try{await save(f,await f.valid());}finally{await f.close();}
  const old=store.records.get('example.scan');store.records.set(old.id,{...old,source:'while(true){}'});
  const next=fixture(store);try{await next.library.initialize();assert.equal(next.registry.describe().length,0);assert.equal(next.library.list()[0].status,'error');assert.equal(store.records.size,1);}
  finally{await next.close();}
});
