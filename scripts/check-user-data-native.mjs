import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserDataNative } from '../src/user-data/native-client.ts';
import { MarketResultStore } from '../src/ai-capabilities/market-data.ts';
const info={id:'1'.repeat(32),revision:'2'.repeat(32),name:'我的数据',state:'ready',hasConnector:false};
const id='a'.repeat(32), active=()=>new AbortController().signal;
test('directory authorization uses a picker with no path argument',async()=>{
  const calls=[];const native=createUserDataNative(async(command,args)=>{calls.push([command,args]);return info;});
  assert.deepEqual(await native.pick(),info);assert.deepEqual(calls,[['user_data_pick',{}]]);
  assert.deepEqual(await native.pick(info.id),info);assert.deepEqual(calls[1][1],{replacementId:info.id});
});
test('native reads carry only source identity and relative request, never grant paths',async()=>{
  const calls=[];const native=createUserDataNative(async(command,args)=>{calls.push([command,args]);return command==='user_data_begin'?id:{data:[42],offset:0,size:1,revision:'file1'};});
  const result=await native.io(info).execute({operation:'read',path:'sub/a.csv',offset:0,length:12},active());
  assert.equal(result.data[0],42);assert.deepEqual(calls[0],['user_data_begin',{input:{sourceId:info.id,revision:info.revision,request:{operation:'read',path:'sub/a.csv',offset:0,length:12}}}]);
  assert.equal(calls[1][0],'user_data_execute');
});
test('aborting while native reservation is pending cancels the eventual ID before execution',async()=>{
  const calls=[];let ready;const reserved=new Promise(r=>{ready=r;});const native=createUserDataNative(async(command,args)=>{calls.push(command);return command==='user_data_begin'?reserved:undefined;});
  const abort=new AbortController();const work=native.io(info).execute({operation:'read',path:'a',offset:0,length:12},abort.signal);
  abort.abort();ready(id);await assert.rejects(work,e=>e.code==='data_cancelled');assert.deepEqual(calls,['user_data_begin','user_data_cancel']);
});
test('aborted native response and malformed output cannot be returned to the guest',async()=>{
  let complete;const reply=new Promise(r=>{complete=r;});let executing;const ready=new Promise(r=>{executing=r;});const calls=[];
  const native=createUserDataNative(async(command)=>{calls.push(command);if(command==='user_data_begin')return id;if(command==='user_data_execute'){executing();return reply;}});
  const abort=new AbortController();const work=native.io(info).execute({operation:'read',path:'a',offset:0,length:12},abort.signal);
  await ready;abort.abort();complete({data:[42],offset:0,size:1,revision:'x'});await assert.rejects(work,e=>e.code==='data_cancelled');assert.equal(calls.filter(x=>x==='user_data_cancel').length,1);
  for(const bad of [{data:[-1],offset:0,size:1,revision:'x'},{data:[1,2],offset:0,size:1,revision:'x'},{data:[1],offset:2,size:3,revision:'x'}]){
    const n=createUserDataNative(async command=>command==='user_data_begin'?id:bad);
    await assert.rejects(n.io(info).execute({operation:'read',path:'a',offset:0,length:12},active()),e=>e.code==='data_invalid_output');
  }
});
test('native records and directory listings never leak extra native fields',async()=>{
  const native=createUserDataNative(async()=>[{...info,locator:'/secret/host'}]);await assert.rejects(native.list());
  const n=createUserDataNative(async command=>command==='user_data_begin'?id:{entries:[{name:'../escape',kind:'file'}],next:null});
  await assert.rejects(n.io(info).execute({operation:'list',path:'',limit:2},active()));
});
test('native transaction tickets are opaque and mutation results are schema checked',async()=>{
  const calls=[];const ticket={ticketId:id,result:{sourceId:info.id,revision:'3'.repeat(32),state:'installed'}};
  const n=createUserDataNative(async(command,args)=>{calls.push([command,args]);return command==='user_data_prepare'?ticket:command==='user_data_commit'?ticket.result:null;});
  assert.deepEqual(await n.prepare(info,{kind:'connector',source:'test'}),ticket);
  assert.deepEqual(await n.commit(ticket.ticketId),ticket.result);await n.rollback(id);await n.finish(id);
  assert.equal(calls.some(([,a])=>JSON.stringify(a).includes('locator')),false);
});
test('shared market result store closes on source retirement and preserves history continuation',async()=>{
  const query={providerId:'user_data',symbol:'SH:600000',kind:'stock',resolution:'1D',adjustment:'none',count:2};
  const session={signal:active()},ctx={context:{scope:'app',appInstanceId:'test'},signal:active(),session,checkpoint(){}};
  const store=new MarketResultStore({async execute(){return {symbol:query.symbol,seriesKind:'ohlcv',diagnostics:{source:'fixture'},bars:[{time:1,open:1,high:2,low:1,close:2,volume:1}],nextCursor:'page-2'};}});
  const descriptor=await store.capture(query,ctx);assert.equal(descriptor.nextCursor,'page-2');
  assert.equal(store.page(descriptor.datasetId,0,10,ctx).rows.length,1);
  store.close();assert.throws(()=>store.page(descriptor.datasetId,0,10,ctx));await assert.rejects(store.capture(query,ctx));
});
test('a result completing after source-store closure is discarded',async()=>{
  let resolve;const reply=new Promise(r=>{resolve=r;});const store=new MarketResultStore({execute:()=>reply});
  const query={providerId:'user_data',symbol:'SH:600000',kind:'stock',resolution:'1D',adjustment:'none',count:2};
  const work=store.capture(query,{context:{scope:'app',appInstanceId:'test'},signal:active(),session:{signal:active()},checkpoint(){}});
  store.close();resolve({symbol:query.symbol,seriesKind:'ohlcv',diagnostics:{source:'fixture'},bars:[{time:1,open:1,high:2,low:1,close:2,volume:1}]});await assert.rejects(work);
});
