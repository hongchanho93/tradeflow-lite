import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskDataHost } from '../src/user-task/sources.ts';
import { UserDataManager } from '../src/user-data/manager.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { dataInfo, fakeDataNative, dataWorkerFactory } from './user-data-fixtures.mjs';
import { TASK_SYMBOL } from './user-task-fixtures.mjs';
const needs=[{id:'daily',resolution:'1D',adjustment:'none',count:3}];
const alive=()=>new AbortController().signal;
function builtin(overrides={}) {
  const calls=[];const host={providers:async()=>[{id:'test',displayName:'test',enabled:true,version:'1',capabilities:{history:true,catalog:false,venues:['SH'],kinds:['stock'],resolutions:['1D'],adjustments:['none']}}],
    loadedSymbols:()=>[TASK_SYMBOL],catalog:async()=>{throw Error('static catalog must reuse loaded symbols');},data(){throw Error('no user directories');},
    market:{async execute(input){calls.push(input);return {symbol:input.symbol,seriesKind:'ohlcv',diagnostics:{source:'test'},bars:[{time:1,open:1,high:2,low:1,close:2,volume:1}]};}},...overrides};
  return {host,calls,data:createTaskDataHost(host)};
}
test('builtin task queries use independent MarketQueryPort and preserve real coverage metadata',async()=>{
  const f=builtin(),lease=await f.data.acquire('test',undefined,needs,alive());try{
    assert.equal((await lease.catalog(undefined,100,alive())).symbols[0].symbol,TASK_SYMBOL.symbol);
    const history=await lease.history(TASK_SYMBOL,needs[0],alive());assert.equal(history.rows.length,1);assert.equal(history.shortfall,true);assert.equal(history.finality,'unknown');
    assert.deepEqual(f.calls[0],{operation:'history',providerId:'test',symbol:'SH:600000',kind:'stock',resolution:'1D',adjustment:'none',count:3});
  }finally{lease.close();}
});
test('unsupported source, venue or history cannot fall back to another provider',async()=>{
  const f=builtin();for(const [id,venue,history] of [['bad',undefined,needs],['test','SZ',needs],['test','SH',[{...needs[0],resolution:'9Q'}]]])await assert.rejects(f.data.acquire(id,venue,history,alive()));assert.equal(f.calls.length,0);
});
test('local task source borrows the installed Connector and loses access on disable',async()=>{
  const native=fakeDataNative(),registry=new CapabilityRegistry([]),manager=new UserDataManager(native,id=>registry.createOwner(id),{workerFactory:dataWorkerFactory});
  const f=builtin({data:()=>manager});try{const lease=await f.data.acquire(`user_data_${dataInfo.id}`,undefined,needs,alive());
    const catalog=await lease.catalog(undefined,10,alive());const history=await lease.history(catalog.symbols[0],needs[0],alive());assert.equal(history.rows[0].close,2);assert.equal(history.nextCursor,'next');
    const signal=alive(),ctx={signal,session:{signal},context:{scope:'app',appInstanceId:'test'},checkpoint(){}};
    const tx=await manager.prepareChange(dataInfo.id,manager.info(dataInfo.id).revision,{kind:'enabled',enabled:false},ctx);await tx.commit();tx.dispose();await manager.idle();
    assert.equal(lease.signal.aborted,true);await assert.rejects(lease.history(catalog.symbols[0],needs[0],alive()));assert.equal(manager.list()[0].state,'disabled');
  }finally{await manager.close();}
});
test('local catalog venue selection filters valid other venues instead of failing the entire source',async()=>{
  const source=`defineConnector({formatVersion:1,apiVersion:1,id:'test.multi',version:1,name:'多市场',supports:{venues:['SH','SZ'],kinds:['stock'],resolutions:['1D'],adjustments:['none']},
    *listSymbols(){return {symbols:[{symbol:'SH:600000',name:'沪',kind:'stock'},{symbol:'SZ:000001',name:'深',kind:'stock'}]};},
    *getHistory(){return {seriesKind:'ohlcv',bars:[]};}});`;
  const registry=new CapabilityRegistry([]);const manager=new UserDataManager(fakeDataNative(source),id=>registry.createOwner(id),{workerFactory:dataWorkerFactory});
  try{const lease=await builtin({data:()=>manager}).data.acquire(`user_data_${dataInfo.id}`,'SH',needs,alive());assert.equal((await lease.catalog(undefined,10,alive())).symbols.length,1);lease.close();}
  finally{await manager.close();}
});
test('malformed or mismatched native history cannot become a task batch',async()=>{
  const f=builtin({market:{async execute(){return {symbol:'SZ:000001',seriesKind:'ohlcv',diagnostics:{source:'test'},bars:[]};}}});
  const lease=await f.data.acquire('test',undefined,needs,alive());try{await assert.rejects(lease.history(TASK_SYMBOL,needs[0],alive()));}finally{lease.close();}
});
