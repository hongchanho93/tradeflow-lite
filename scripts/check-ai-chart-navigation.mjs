import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { CapabilityError, sameSelection } from '../src/ai-capabilities/contracts.ts';
import { createChartActionTools } from '../src/ai-capabilities/chart-actions.ts';
import { McpConnection } from '../src/ai-mcp/session.ts';
import { ApiConversation } from '../src/ai-api/conversation.ts';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { copyHistory } from '../src/ai-capabilities/market-data.ts';
import { normalizeProbabilityHistory } from '../src/probability-series.ts';
import { isCanonicalMarketSymbol, marketProviderKey, marketSymbolFromCatalog } from '../src/market-universe.ts';
const initial={appInstanceId:'app',chartId:'main',provider:'tdx',instrument:'SH:600000',resolution:'1D',adjustment:'none',selectionGeneration:1};
const empty={type:'object',properties:{},additionalProperties:false};
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function fixture() {
  let current={...initial}, later, restore=0, invalidated=()=>{};
  const host={current:()=>({selection:current,ready:true,seriesKind:'ohlcv',chartType:'candles'}),visibleRange:()=>({available:false}),dataWindow:()=>({available:false,seriesKind:'ohlcv'}),
    async prepareNavigation(change,ctx){
      if(!sameSelection(change.expected,current))throw new CapabilityError('context_stale');
      const from={...current},next={...current,resolution:change.resolution??current.resolution,selectionGeneration:current.selectionGeneration+1};
      return {result:{from,selection:next,ready:true},async commit(){ctx.checkpoint();if(!sameSelection(from,current))throw new CapabilityError('context_stale');current=next;connection.invalidate();core.invalidateCharts();invalidated();if(later)await later;},
        async rollback(){if(sameSelection(current,next)){current={...from,selectionGeneration:next.selectionGeneration+1};restore++;}}};
    }};
  const tools=[...createChartActionTools(host),{id:'tf.chart.fixture',version:1,effect:'read',description:'chart fixture',inputSchema:empty,outputSchema:empty,run:()=>({})}];
  const core=new CapabilityCore(new CapabilityRegistry(tools));
  const mcpHost={context:()=>current,describe:()=>tools,open:p=>core.openSession({context:current,currentContext:()=>current,permissions:p})};
  const connection=new McpConnection(mcpHost,()=>{},{approvalMs:5});
  let seq=0;
  const request=(name,args={},id=++seq)=>connection.receive(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})).then(s=>s===null?null:JSON.parse(s).result.structuredContent.reply);
  return {connection,core,mcpHost,request,current:()=>current,restore:()=>restore,onInvalidation(callback){invalidated=callback;},manual(){current={...current,selectionGeneration:current.selectionGeneration+1};connection.invalidate();core.invalidateCharts();invalidated();},stall(p){later=p;},
    async init(){await connection.receive(JSON.stringify({jsonrpc:'2.0',id:'init',method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}}));await connection.receive(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}));connection.authorizeAssistant();}};
}
test('only a successful explicit navigation rebinds its own chart grant',async()=>{
  const f=fixture();await f.init();const before=f.current();
  const result=await f.request('tf_chart_resolution',{input:{expected:before,resolution:'1W'}});
  assert.equal(result.status,'ok');assert.equal(result.data.selection.resolution,'1W');
  assert.deepEqual((await f.request('tf_context_get')).context,f.current());
  assert.equal((await f.request('tf_chart_fixture',{context:before,input:{}})).code,'context_stale');
  assert.equal((await f.request('tf_chart_fixture',{context:f.current(),input:{}})).status,'ok');f.connection.close();
});
test('old MCP chart result IDs cannot become readable after navigation',async()=>{
  const f=fixture();await f.init();const args={context:f.current(),input:{}};
  assert.equal((await f.request('tf_chart_fixture',args,99)).status,'ok');
  await f.request('tf_chart_resolution',{input:{expected:f.current(),resolution:'1W'}});
  assert.equal((await f.request('tf_chart_fixture',args,99)).code,'context_stale');f.connection.close();
});
test('an unrelated manual selection cannot be adopted by a delayed navigation',async()=>{
  const f=fixture();await f.init();let done;f.stall(new Promise(r=>{done=r;}));
  const p=f.request('tf_chart_resolution',{input:{expected:f.current(),resolution:'1W'}});await flush();f.manual();const manual={...f.current()};done();await p;
  assert.deepEqual(f.current(),manual);assert.equal(f.connection.view().access,'authorized');
  assert.deepEqual((await f.request('tf_context_get')).context,manual);f.connection.close();
});
test('stale navigation input does not move the chart',async()=>{
  const f=fixture();await f.init();const old=f.current();f.manual();
  const current={...f.current()};assert.equal((await f.request('tf_chart_resolution',{input:{expected:old,resolution:'1W'}})).code,'context_stale');assert.deepEqual(f.current(),current);f.connection.close();
});
test('App-only sessions cannot acquire Chart permission through a host rebind',()=>{
  const core=new CapabilityCore(new CapabilityRegistry([]));const app={scope:'app',appInstanceId:'app'};
  const s=core.openSession({context:app,currentContext:()=>app,permissions:{}});assert.throws(()=>s.rebindChart(initial),/permission_denied/);s.close();
});

function turn(protocol,name,args,id='call') {
  const call={id,name,arguments:JSON.stringify(args)};
  const replay=protocol==='chat'?[{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:call.arguments}}]}]
    :protocol==='responses'?[{type:'function_call',call_id:id,name,arguments:call.arguments}]
    :[{role:'assistant',content:[{type:'tool_use',id,name,input:args}]}];
  return {text:'',calls:[call],replay,usage:{inputTokens:1,outputTokens:1}};
}
for(const protocol of ['chat','responses','anthropic']) test(`${protocol} navigation continues in the same conversation with the verified new chart`,async()=>{
  const f=fixture();let calls=0;
  const conversation=new ApiConversation(f.mcpHost,{async turn(_p,payload){
    const index=calls++;
    if(index===0)return turn(protocol,'tf_chart_resolution',{input:{expected:f.current(),resolution:'1W'}},'nav');
    if(index===1){assert.ok(JSON.stringify(payload).includes('1W'));return turn(protocol,'tf_context_get',{},'ctx');}
    if(index===2)return turn(protocol,'tf_chart_fixture',{context:f.current(),input:{}},'read');
    return {text:'已切换并读取',calls:[],replay:[{role:'assistant',content:'已切换并读取'}],usage:{inputTokens:1,outputTokens:1}};
  }});
  f.onInvalidation(()=>conversation.invalidate());
  conversation.reset({revision:'fixture',hasKey:false,remembered:false,settings:{protocol,endpoint:'https://fixture.invalid',model:'fixture',stream:false,tools:true,includeUsage:false,chatTokenField:'max_tokens',maxTokens:2048,timeoutSeconds:30,allowLocalHttp:false}});
  await conversation.send('切到周线并读取');assert.equal(conversation.view().failed,false);assert.equal(conversation.view().status,'completed');assert.equal(calls,4);
  assert.equal(conversation.view().context.resolution,'1W');conversation.reset();f.connection.close();
});

function realHost() {
  const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
  const begin=main.indexOf('async function prepareAiChartNavigation('),end=main.indexOf('\nfunction createAiChartActionTools(',begin);
  assert.ok(begin>=0&&end>begin);const source=stripTypeScriptTypes(main.slice(begin,end));
  return new Function('deps',`const {CapabilityError,sameSelection,copyHistory,normalizeProbabilityHistory,isCanonicalMarketSymbol,marketProviderKey,marketSymbolFromCatalog}=deps;
    let generation=1, aiDisplayedHistoryGeneration=1, currentResolution='1D', currentAdjustment='none',currentSeriesKind='ohlcv';
    let currentSymbol={providerId:'tdx',symbol:'SH:600000',kind:'stock',name:'first'},currentQuote=null;
    let currentBars=[{time:1,open:10,high:12,low:9,close:11,volume:100}], currentHistoryDiagnostics={source:'tradeflow-tdx',host:'fixture',latencyMs:1};
    let aiDrawingPointerDown=false,activeDrawingId=null,fail=false,io=0,gate;
    const historyRequestGate={current:()=>generation}, INITIAL_HISTORY_BARS=300, marketSymbolById=new Map();
    const readCurrentAiChartSelection=()=>({...deps.initial,provider:currentSymbol.providerId,instrument:currentSymbol.symbol,resolution:currentResolution,adjustment:currentAdjustment,selectionGeneration:generation});
    const invoke=async()=>[{id:'tdx',enabled:true,displayName:'TDX',capabilities:{history:true,quote:true,venues:['SH','SZ'],kinds:['stock'],resolutions:['1D','1W'],adjustments:['none','qfq']}}];
    const createNativeMarketQueryPort=()=>({async execute(query){io++;if(gate)await gate;return {symbol:query.symbol,seriesKind:'ohlcv',bars:[{time:1,open:20,high:22,low:19,close:21,volume:100}],diagnostics:{source:'tradeflow-tdx',host:'fixture',latencyMs:1}};}});
    const currentDrawingSnapshot=()=>null,persistDrawingSnapshot=()=>{};
    const openHistory=async(symbol,resolution,adjustment,options)=>{generation++;if(fail){fail=false;throw new CapabilityError('navigation_failed');}currentSymbol=symbol;currentResolution=resolution;currentAdjustment=adjustment;currentBars=options.prepared.bars;aiDisplayedHistoryGeneration=generation;};
    ${source}
    return {prepare:prepareAiChartNavigation,current:readCurrentAiChartSelection,bars:()=>currentBars,io:()=>io,
      stall(p){gate=p;},tick(){currentBars=[{time:1,open:10,high:14,low:9,close:13,volume:120}];},fail(){fail=true;},manual(){generation++;aiDisplayedHistoryGeneration=generation;}};
  `)({CapabilityError,sameSelection,copyHistory,normalizeProbabilityHistory,isCanonicalMarketSymbol,marketProviderKey,marketSymbolFromCatalog,initial});
}
const ctx=()=>{const abort=new AbortController();return {abort,context:{scope:'app',appInstanceId:'app'},signal:abort.signal,session:{signal:new AbortController().signal},checkpoint(){if(abort.signal.aborted)throw new CapabilityError('cancelled');}};};
test('real navigation prefetch does not switch the chart; commit applies the prepared validated history',async()=>{
  const h=realHost(),c=ctx();const before=h.current();const tx=await h.prepare({op:'open',expected:before,providerId:'tdx',symbol:'SZ:000001',kind:'stock'},c);
  assert.deepEqual(h.current(),before);assert.equal(h.bars()[0].close,11);await tx.commit();
  assert.equal(h.current().instrument,'SZ:000001');assert.equal(h.bars()[0].close,21);assert.deepEqual(h.current(),tx.result.selection);
});
test('real navigation preserves the latest pre-commit live bar if transition fails',async()=>{
  const h=realHost(),c=ctx();const tx=await h.prepare({op:'resolution',expected:h.current(),resolution:'1W'},c);
  h.tick();h.fail();await assert.rejects(tx.commit(),/navigation_failed/);await tx.rollback();
  assert.equal(h.current().resolution,'1D');assert.equal(h.bars()[0].close,13);
});
test('real navigation refuses unsupported requests before I/O and stale replies never switch charts',async()=>{
  const h=realHost(),c=ctx();await assert.rejects(h.prepare({op:'resolution',expected:h.current(),resolution:'invalid'},c),/field_unavailable/);assert.equal(h.io(),0);
  let done;h.stall(new Promise(r=>{done=r;}));const pending=h.prepare({op:'resolution',expected:h.current(),resolution:'1W'},c);await flush();h.manual();done();await assert.rejects(pending,/context_stale/);assert.equal(h.current().resolution,'1D');
});
test('real navigation cancellation before commit makes no chart change; compensation cannot undo manual navigation',async()=>{
  const h=realHost(),c=ctx();const tx=await h.prepare({op:'resolution',expected:h.current(),resolution:'1W'},c);c.abort.abort();await assert.rejects(tx.commit(),/cancelled/);await tx.rollback();assert.equal(h.current().selectionGeneration,1);
  const tx2=await h.prepare({op:'resolution',expected:h.current(),resolution:'1W'},ctx());h.fail();await assert.rejects(tx2.commit());h.manual();const manual=h.current();await tx2.rollback();assert.deepEqual(h.current(),manual);
});
