import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { CapabilityError } from '../src/ai-capabilities/contracts.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { createMarketQueryTools } from '../src/ai-capabilities/market-tools.ts';
import { createNativeMarketQueryPort } from '../src/ai-capabilities/market-query.ts';

const request = { providerId:'tdx', symbol:'SH:600000', kind:'stock', resolution:'1D', adjustment:'none', count:3 };
const providers = [{id:'tdx',enabled:true,capabilities:{history:true,quote:true,venues:['SH'],kinds:['stock'],resolutions:['1D'],adjustments:['none','qfq']}}];
const history = () => ({symbol:request.symbol,seriesKind:'ohlcv',bars:[1,2,3].map(time=>({time,open:10,high:12,low:9,close:11,volume:100})),diagnostics:{source:'tradeflow-tdx',host:'/private/not-for-model'}});
const quote = () => ({providerId:'tdx',symbol:request.symbol,source:'tradeflow-tdx',quote:{last:11,previousClose:10,open:10,high:12,low:9,volume:100,amount:1100,receivedAt:100}});
const deferred = () => {let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve};};
function fixture(execute=async q=>q.operation==='history'?history():quote(),options={}) {
  const calls=[]; const tools=createMarketQueryTools({providers:async()=>options.providers??providers,execute:async(q,s)=>{calls.push(q);return execute(q,s);}},options);
  const core=new CapabilityCore(new CapabilityRegistry(tools));let current={scope:'app',appInstanceId:'app'};
  const open=()=>core.openSession({context:current,currentContext:()=>current,permissions:Object.fromEntries(tools.map(t=>[t.id,'allow']))});
  const session=open();let seq=0;
  const call=(name,input={},s=session)=>s.invoke(JSON.stringify({protocolVersion:1,requestId:`q${++seq}`,toolId:`tf.market.${name}`,context:current,input}));
  return {core,tools,session,open,call,calls,scope:value=>current=value};
}
test('history returns a small handle; pages preserve exact immutable rows and hide diagnostics',async t=>{
  const raw=history(), f=fixture(async()=>raw);t.after(()=>f.core.closeSessions());
  const result=await f.call('history',request);assert.equal(result.status,'ok');assert.equal(result.data.rowCount,3);assert.ok(result.data.datasetId);assert.equal(result.data.rows,undefined);
  raw.bars[0].close=999;
  const page=await f.call('page',{datasetId:result.data.datasetId,limit:2});assert.equal(page.status,'ok');assert.equal(page.data.rows[0].close,11);assert.equal(page.data.nextOffset,2);
  assert.ok(!JSON.stringify(result).includes('/private'));
  assert.equal((await f.call('release',{datasetId:result.data.datasetId})).status,'ok');
  assert.equal((await f.call('page',{datasetId:result.data.datasetId})).code,'snapshot_unavailable');
});
test('datasets are owned by a session and survive chart invalidation, not revocation',async t=>{
  const f=fixture();t.after(()=>f.core.closeSessions());const result=await f.call('history',request);const input={datasetId:result.data.datasetId};
  assert.equal((await f.call('page',input,f.open())).code,'snapshot_unavailable');f.core.invalidateCharts();assert.equal((await f.call('page',input)).status,'ok');
  f.session.close();assert.equal((await f.call('page',input)).code,'session_closed');
});
test('unsupported provider/capability and malformed requests never start native I/O',async t=>{
  const f=fixture();t.after(()=>f.core.closeSessions());
  for(const input of [{...request,count:12001},{...request,symbol:'bad'},{...request,resolution:'bad'},{...request,providerId:'unknown'},{...request,kind:'crypto'}]) assert.equal((await f.call('history',input)).status,'error');
  assert.equal(f.calls.length,0);
});
test('bad or mismatched history never gets a result handle',async t=>{
  for(const patch of [{symbol:'SH:600001'},{bars:[{time:1,open:1,high:0,low:2,close:1,volume:0}]},{bars:[]},{bars:[...history().bars,...history().bars]},{seriesKind:'probability',points:[{time:1,value:150}],bars:[]}]) {
    const f=fixture(async()=>({...history(),...patch}));t.after(()=>f.core.closeSessions());assert.equal((await f.call('history',request)).code,'invalid_output');
  }
});
test('quotes retain requested identity, source and observation time',async t=>{
  const f=fixture();t.after(()=>f.core.closeSessions());const r=await f.call('quote',{providerId:request.providerId,symbol:request.symbol,kind:'stock'});
  assert.equal(r.status,'ok');assert.equal(r.data.quote.last,11);assert.equal(r.data.quote.receivedAt,100);assert.equal(r.data.source,'tradeflow-tdx');
});
test('batch quotes preserve input order, duplicates and individual errors with bounded concurrency',async t=>{
  let active=0,max=0;const f=fixture(async q=>{max=Math.max(max,++active);await new Promise(r=>setTimeout(r,3));active--;if(q.symbol==='SH:600002')throw Error('secret detail');return {...quote(),symbol:q.symbol};});t.after(()=>f.core.closeSessions());
  const requests=['600000','600002','600001','600000','600003'].map(code=>({providerId:'tdx',symbol:`SH:${code}`,kind:'stock'}));
  const r=await f.call('quotes',{requests});assert.equal(r.status,'ok');assert.equal(max,2);assert.deepEqual(r.data.items.map(i=>i.symbol),requests.map(i=>i.symbol));
  assert.equal(r.data.items[1].status,'error');assert.ok(!JSON.stringify(r).includes('secret detail'));
});
test('native reservation cancellation before begin returns never runs execute',async()=>{
  const d=deferred(), calls=[],controller=new AbortController();const port=createNativeMarketQueryPort(async(name,args)=>{calls.push(name);if(name==='market_query_begin')return d.promise;return null;});
  const pending=port.execute({operation:'history',...request},controller.signal);controller.abort();d.resolve('a'.repeat(32));
  await assert.rejects(pending,/cancelled/);assert.deepEqual(calls,['market_query_begin','market_query_cancel']);
});
test('native cancellation suppresses late successful replies and unregisters listener',async()=>{
  const d=deferred(), calls=[],controller=new AbortController();const port=createNativeMarketQueryPort(async name=>{calls.push(name);if(name==='market_query_begin')return 'b'.repeat(32);if(name==='market_query_execute')return d.promise;return null;});
  const pending=port.execute({operation:'quote',providerId:'tdx',symbol:request.symbol,kind:'stock'},controller.signal);await Promise.resolve();controller.abort();d.resolve(quote());
  await assert.rejects(pending,/cancelled/);assert.equal(calls.filter(n=>n==='market_query_cancel').length,1);
});

test('probability history remains time/value, without synthetic OHLCV',async t=>{
  const p={id:'prediction',enabled:true,capabilities:{history:true,quote:false,venues:['POLYMARKET'],kinds:['prediction'],resolutions:['1D'],adjustments:['none']}};
  const f=fixture(async()=>({symbol:'POLYMARKET:123',seriesKind:'probability',bars:[],points:[{time:1,value:35},{time:2,value:40}],diagnostics:{source:'prediction'}}),{providers:[p]});t.after(()=>f.core.closeSessions());
  const r=await f.call('history',{...request,providerId:p.id,symbol:'POLYMARKET:123',kind:'prediction'});assert.equal(r.status,'ok');assert.equal(r.data.shortfall,true);assert.equal(r.data.priceUnit,'percent');
  const page=await f.call('page',{datasetId:r.data.datasetId});assert.deepEqual(JSON.parse(JSON.stringify(page.data.rows)),[{time:1,value:35},{time:2,value:40}]);
});
test('12000 rows can be retained without overflowing model output and negative QFQ is preserved',async t=>{
  const raw=history();raw.bars=Array.from({length:12000},(_,i)=>({time:i,open:-2,high:0,low:-3,close:-1,volume:10}));
  const f=fixture(async()=>raw);t.after(()=>f.core.closeSessions());const r=await f.call('history',{...request,count:12000,adjustment:'qfq'});
  assert.equal(r.status,'ok');assert.equal(r.data.rowCount,12000);assert.ok(JSON.stringify(r).length<2000);
  const page=await f.call('page',{datasetId:r.data.datasetId,offset:11000,limit:1000});assert.equal(page.data.rows.length,1000);assert.equal(page.data.rows[0].close,-1);assert.equal(page.data.nextOffset,undefined);
});
test('expiry and explicit release reclaim capacity rather than evicting active user results',async t=>{
  let now=0;const f=fixture(undefined,{now:()=>now});t.after(()=>f.core.closeSessions());const ids=[];
  for(let i=0;i<4;i++)ids.push((await f.call('history',request)).data.datasetId);
  assert.equal((await f.call('history',request)).code,'snapshot_capacity');assert.equal(f.calls.length,4);
  assert.equal((await f.call('release',{datasetId:ids[0]})).status,'ok');
  assert.equal((await f.call('release',{datasetId:ids[0]})).code,'snapshot_unavailable');
  assert.equal((await f.call('page',{datasetId:ids[0]})).code,'snapshot_unavailable');
  assert.equal((await f.call('history',request)).status,'ok');
  now=300001;assert.equal((await f.call('page',{datasetId:ids[1]})).code,'snapshot_unavailable');assert.equal((await f.call('history',request)).status,'ok');
});
test('revocation cancels pending native work and later data cannot be adopted by a new session',async t=>{
  const d=deferred();let signal;const f=fixture(async(q,s)=>{signal=s;return d.promise;});t.after(()=>f.core.closeSessions());
  const pending=f.call('history',request);for(let i=0;i<20&&!signal;i++)await Promise.resolve();assert.ok(signal);
  f.session.close();assert.ok(signal.aborted);d.resolve(history());assert.equal((await pending).code,'session_closed');
  const fresh=f.open();assert.equal((await f.call('history',request,fresh)).status,'ok');
});
test('quote provider/symbol mismatch and invalid values are errors, not invented prices',async t=>{
  for(const patch of [{symbol:'SH:000000'},{providerId:'other'},{quote:{...quote().quote,last:0}},{quote:{...quote().quote,volume:NaN}}]){
    const f=fixture(async()=>({...quote(),...patch}));t.after(()=>f.core.closeSessions());assert.equal((await f.call('quote',{providerId:'tdx',symbol:request.symbol,kind:'stock'})).code,'invalid_output');
  }
});
test('host I/O timeout is bounded registration metadata, not model-supplied privilege',async()=>{
  let recordedDelay;const d=deferred(),tool={id:'tf.test.io',version:1,effect:'read',scope:'app',description:'test',timeoutMs:30000,
    inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'number'},run:()=>d.promise};
  const registry=new CapabilityRegistry([tool]);assert.equal(registry.describe()[0].timeoutMs,undefined);
  for(const timeoutMs of [0,-1,120001,Infinity])assert.throws(()=>new CapabilityRegistry([{...tool,timeoutMs}]),/invalid_contract/);
  const core=new CapabilityCore(registry,{clock:{now:()=>0,setTimer:(_fn,delay)=>{recordedDelay=delay;return 1;},clearTimer(){}}});
  const context={scope:'app',appInstanceId:'test'},s=core.openSession({context,currentContext:()=>context,permissions:{'tf.test.io':'allow'}});
  const pending=s.invoke(JSON.stringify({protocolVersion:1,requestId:'1',toolId:tool.id,context,input:{}}));
  await Promise.resolve();assert.equal(recordedDelay,30000);d.resolve(1);assert.equal((await pending).status,'ok');core.closeSessions();
});
test('a cancelled batch waits for both running I/O calls before releasing its handler',async()=>{
  const a=deferred(),b=deferred(),controller=new AbortController();let calls=0,settled=false;
  const tool=createMarketQueryTools({providers:async()=>providers,execute:async()=>++calls===1?a.promise:b.promise}).find(t=>t.id==='tf.market.quotes');
  const ctx={context:{scope:'app',appInstanceId:'test'},signal:controller.signal,session:{signal:controller.signal},checkpoint(){if(controller.signal.aborted)throw new CapabilityError('cancelled');}};
  const pending=tool.run({requests:Array.from({length:3},()=>({providerId:'tdx',symbol:request.symbol,kind:'stock'}))},ctx).finally(()=>settled=true);
  const rejected=assert.rejects(pending,/cancelled/);for(let i=0;i<20&&calls<2;i++)await Promise.resolve();assert.equal(calls,2);
  controller.abort();a.resolve(quote());for(let i=0;i<20;i++)await Promise.resolve();assert.equal(settled,false);
  b.resolve(quote());await rejected;assert.equal(calls,2);
});

test('watchlist quote convenience uses the saved list, fresh bounded queries and explicit unresolved rows',async()=>{
  const calls=[];
  const rows=[{key:'tdx|SH:600000',symbol:{providerId:'tdx',symbol:'SH:600000',kind:'stock',name:'UI catalog label',venue:'SH'}},
    {key:'missing|ITEM',symbol:null},{key:'tdx|SH:600001',symbol:{providerId:'tdx',symbol:'SH:600001',kind:'stock'}}];
  const tools=createMarketQueryTools({providers:async()=>providers,watchlist:()=>rows,
    execute:async q=>{assert.deepEqual(Object.keys(q).sort(),['kind','operation','providerId','symbol']);calls.push(q);return {...quote(),symbol:q.symbol};}});
  const tool=tools.find(t=>t.id==='tf.watchlist.quotes');assert.ok(tool);
  const controller=new AbortController(),ctx={context:{scope:'app',appInstanceId:'test'},signal:controller.signal,session:{signal:controller.signal},checkpoint(){}};
  const result=await tool.run({limit:2},ctx);assert.equal(result.total,3);assert.equal(result.nextOffset,2);
  assert.equal(result.items[0].data.quote.receivedAt,100);assert.equal(result.items[1].key,'missing|ITEM');
  assert.equal(result.items[1].code,'field_unavailable');assert.equal(calls.length,1);
  assert.equal((await tool.run({offset:2},ctx)).items[0].key,'tdx|SH:600001');assert.equal(calls.length,2);
});
