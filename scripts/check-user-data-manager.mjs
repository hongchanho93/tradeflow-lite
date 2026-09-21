import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { UserDataManager } from '../src/user-data/manager.ts';
import { dataWorkerFactory,DATA_CONNECTOR_FIXTURE,dataInfo,fakeDataNative } from './user-data-fixtures.mjs';
const active=()=>new AbortController().signal;
const context=()=>({context:{scope:'app',appInstanceId:'data-test'},signal:active(),session:{signal:active()},checkpoint(){}});
async function fixture(source){const registry=new CapabilityRegistry([]),native=fakeDataNative(source),manager=new UserDataManager(native,id=>registry.createOwner(id),{workerFactory:dataWorkerFactory});
  await manager.initialize();const core=new CapabilityCore(registry);return {manager,registry,native,core};}
function session(f){const chart={appInstanceId:'data-test',chartId:'main',provider:'tdx',instrument:'SH:600000',resolution:'1D',adjustment:'none',selectionGeneration:1};const s=f.core.openSession({context:chart,currentContext:()=>chart,
  permissions:Object.fromEntries(f.registry.describe().map(t=>[t.id,'allow']))});let sequence=0;
  return {s,call:(input,id='request-'+(++sequence))=>s.invoke(JSON.stringify({protocolVersion:1,requestId:id,toolId:f.registry.describe()[0]?.id??`user.data_${dataInfo.id}.query`,context:context().context,input}))};}
test('restored Connector registers into the shared Registry and speaks Market Data',async()=>{
  const f=await fixture();try{assert.equal(f.registry.describe().length,1);assert.equal(f.manager.list()[0].status,'connected');
    const client=session(f);const catalog=await client.call({operation:'catalog',limit:10});assert.equal(catalog.status,'ok');assert.equal(catalog.data.symbols[0].providerId,`user_data_${dataInfo.id}`);
    const history=await client.call({operation:'history',symbol:'SH:600000',kind:'stock',resolution:'1D',adjustment:'none',count:2});assert.equal(history.status,'ok');
    assert.equal(history.data.dataset.nextCursor,'next');const page=await client.call({operation:'page',datasetId:history.data.dataset.datasetId});assert.equal(page.status,'ok');assert.equal(page.data.rows[0].close,2);
    client.s.close();
  }finally{await f.manager.close();}
});
test('disabled records and invalid source never create executable tools',async()=>{
  const f=await fixture('while(true){}');try{assert.equal(f.registry.describe().length,0);assert.equal(f.manager.list()[0].status,'error');}finally{await f.manager.close();}
  const native=fakeDataNative();native.records.get(dataInfo.id).info.state='disabled';const registry=new CapabilityRegistry([]),manager=new UserDataManager(native,id=>registry.createOwner(id),{workerFactory:dataWorkerFactory});
  await manager.initialize();assert.equal(registry.describe().length,0);assert.equal(manager.list()[0].status,'disabled');await manager.close();
});
test('staged validation does not install code or change Registry state',async()=>{
  const f=await fixture();try{const before=f.registry.describe()[0].registrationRevision;
    const draft=await f.manager.validate(dataInfo.id,DATA_CONNECTOR_FIXTURE.replace("version:1,name", "version:2,name"),active());
    assert.equal(draft.manifest.version,2);assert.equal(f.registry.describe()[0].registrationRevision,before);assert.equal(f.native.tickets.size,0);
  }finally{await f.manager.close();}
});
test('disable retires old cached replies and reenabling creates a fresh implementation',async()=>{
  const f=await fixture();try{const client=session(f);await client.call({operation:'catalog'},'cached');const previous=f.registry.describe()[0].registrationRevision;
    const tx=await f.manager.prepareChange(dataInfo.id,dataInfo.revision,{kind:'enabled',enabled:false},context());await tx.commit();tx.dispose();await f.manager.idle();
    assert.equal(f.registry.describe().length,0);const old=await client.call({operation:'catalog'},'cached');assert.notEqual(old.status,'ok');
    const info=f.manager.list()[0];const enable=await f.manager.prepareChange(info.id,info.revision,{kind:'enabled',enabled:true},context());await enable.commit();enable.dispose();await f.manager.idle();
    assert.ok(f.registry.describe()[0].registrationRevision>previous);client.s.close();
  }finally{await f.manager.close();}
});
test('failed commit compensates without losing the previous Connector',async()=>{
  const f=await fixture();try{f.native.failCommit=true;const tx=await f.manager.prepareChange(dataInfo.id,dataInfo.revision,{kind:'remove'},context());
    await assert.rejects(tx.commit());await tx.rollback();tx.dispose();await f.manager.idle();
    assert.equal(f.manager.list()[0].status,'connected');assert.equal(f.registry.describe().length,1);assert.equal(f.native.records.size,1);
  }finally{await f.manager.close();}
});
test('real rollback failure leaves the source unavailable and is not reported as success',async()=>{
  const f=await fixture();try{const tx=await f.manager.prepareChange(dataInfo.id,dataInfo.revision,{kind:'remove'},context());await tx.commit();f.native.failRollback=true;
    await assert.rejects(tx.rollback());tx.dispose();await f.manager.idle();assert.equal(f.registry.describe().length,0);
  }finally{await f.manager.close();}
});
test('unvalidated source and stale drafts cannot bypass isolated installation',async()=>{
  const f=await fixture();try{await assert.rejects(f.manager.prepareChange(dataInfo.id,dataInfo.revision,{kind:'connector',source:'bad'},context()));
    const draft=await f.manager.validate(dataInfo.id,DATA_CONNECTOR_FIXTURE,active());
    const tx=await f.manager.prepareChange(dataInfo.id,dataInfo.revision,{kind:'enabled',enabled:false},context());await tx.commit();tx.dispose();await f.manager.idle();
    await assert.rejects(f.manager.prepareChange(dataInfo.id,draft.revision,{kind:'connector',source:draft.source},context(),draft));
  }finally{await f.manager.close();}
});
test('closing the manager retires all dynamic tools and prevents reuse',async()=>{
  const f=await fixture();await f.manager.close();assert.equal(f.registry.describe().length,0);await assert.rejects(f.manager.validate(dataInfo.id,DATA_CONNECTOR_FIXTURE,active()));
});
