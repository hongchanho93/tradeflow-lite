import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { createIndicatorLibraryTools } from '../src/ai-capabilities/indicator-library-tools.ts';
import { UserIndicatorLibrary, UserIndicatorLibraryError } from '../src/user-indicator-runtime/library.ts';
import { validateUserIndicatorSource } from '../src/user-indicator-runtime/validator-engine.ts';
import { USER_INDICATOR_PREFLIGHT_LIMITS } from '../src/user-indicator-runtime/preflight.ts';

const source=readFileSync(new URL('../fixtures/user-indicators/01-sma.tfi',import.meta.url),'utf8');
class Store {
  records=new Map();
  async list(){return [...this.records.values()].map(v=>structuredClone(v));}
  async get(id){return structuredClone(this.records.get(id)??null);}
  async put(record){this.records.set(record.id,structuredClone(record));}
  async delete(id){this.records.delete(id);}
  async compareAndSwap(id,expected,value){if((this.records.get(id)?.sourceHash??null)!==expected)throw new UserIndicatorLibraryError('stale_import_preview','changed');if(value)this.records.set(id,structuredClone(value));else this.records.delete(id);}
}
function fixture() {
  const store=new Store(),library=new UserIndicatorLibrary(store,{validator:validateUserIndicatorSource});let timestamp=0,sideEffects=0;
  const timings=[
    {reason:'initial',durationMs:1,budgetMs:2000},{reason:'history',durationMs:1,budgetMs:1000},
    {reason:'realtime',durationMs:1,budgetMs:100},{reason:'reconciliation',durationMs:1,budgetMs:2000},
  ];
  const tools=createIndicatorLibraryTools({library:()=>library,async test(prepared){
    return prepared.source.includes('RUNTIME_FAIL_LOGS')
      ? {valid:false,sampleRows:3,failurePhase:'update',errorCode:'runtime_exception',failureDetail:'later failure',
        coveredReasons:['initial','history'],coveredPointerTypes:[],timings:timings.slice(0,1),pointerTimings:[],limits:USER_INDICATOR_PREFLIGHT_LIMITS,
        logs:[{phase:'create',message:'before failure'},{phase:'update',message:'initial ok'}]}
      : prepared.source.includes('RUNTIME_FAIL')
      ? {valid:false,sampleRows:3,failurePhase:'create',errorCode:'execution_timeout',coveredReasons:['initial'],coveredPointerTypes:[],timings:[],pointerTimings:[],logs:[],limits:USER_INDICATOR_PREFLIGHT_LIMITS}
      : prepared.source.includes('MANY_LOGS')
        ? {valid:true,sampleRows:3,coveredReasons:['initial','history','realtime','reconciliation'],coveredPointerTypes:['hover','click','leave'],timings,pointerTimings:[
          {type:'hover',durationMs:1,budgetMs:100},{type:'click',durationMs:1,budgetMs:100},{type:'leave',durationMs:1,budgetMs:100},
        ],limits:USER_INDICATOR_PREFLIGHT_LIMITS,allSeriesEmpty:false,allOutputsEmpty:false,
          series:[],markers:[],barStyles:[],canvases:[],panels:[],
          logs:Array.from({length:256},(_,index)=>({phase:index===255?'pointer':'update',message:`log-${index}`}))}
      : prepared.source.includes('MANY_DIAGNOSTICS')
        ? {valid:true,sampleRows:3,coveredReasons:['initial','history','realtime','reconciliation'],coveredPointerTypes:[],timings,pointerTimings:[],limits:USER_INDICATOR_PREFLIGHT_LIMITS,allSeriesEmpty:false,allOutputsEmpty:false,
          series:[],markers:Array.from({length:17},(_,index)=>({key:`m${index}`,points:1,firstTime:1,lastTime:1,allEmpty:false})),
          barStyles:Array.from({length:17},(_,index)=>({key:`b${index}`,points:1,firstTime:1,lastTime:1,allEmpty:false})),
          canvases:[],panels:[],logs:[]}
      : {valid:true,sampleRows:3,coveredReasons:['initial','history','realtime','reconciliation'],coveredPointerTypes:[],timings,pointerTimings:[],limits:USER_INDICATOR_PREFLIGHT_LIMITS,allSeriesEmpty:false,allOutputsEmpty:false,series:[
          {key:'line',type:'line',points:3,ready:2,firstReadyTime:2,lastReadyTime:3,allEmpty:false},
        ],markers:[],barStyles:[{key:'colors',points:2,firstTime:2,lastTime:3,allEmpty:false}],canvases:[],panels:[],logs:[{phase:'update',message:'preflight ok'}]};
  },async prepareChange(prepared,id,_apply,ctx){
    const before=await library.get(id);let after,written=false;
    return {result:{indicatorId:id,indicatorVersion:prepared?.manifest.indicatorVersion??before.indicatorVersion,state:prepared?'installed':'removed'},
      async commit(){ctx.checkpoint();if(prepared)after=(await library.install(prepared,{replace:true})).record;else await library.replaceExact(id,before.sourceHash,null);written=true;sideEffects++;},
      async rollback(){if(written){await library.replaceExact(id,after?.sourceHash??null,before);sideEffects--;}}};
  }},()=>timestamp);
  const core=new CapabilityCore(new CapabilityRegistry(tools));
  const chartContext={appInstanceId:'library-test',chartId:'main',provider:'tdx',instrument:'SH:600000',resolution:'1D',adjustment:'none',selectionGeneration:1};
  const appContext={scope:'app',appInstanceId:'library-test'};
  const open=()=>core.openSession({context:chartContext,currentContext:()=>chartContext,permissions:Object.fromEntries(tools.map(t=>[t.id,'allow']))});
  const session=open();let n=0;
  const call=(name,input={},s=session)=>s.invoke(JSON.stringify({protocolVersion:1,requestId:String(++n),context:name==='test'?chartContext:appContext,toolId:`tf.indicator.${name}`,input}));
  return {store,library,core,session,call,open,sideEffects:()=>sideEffects,advance(){timestamp+=300001;}};
}
test('guide is executable and validate stages but neither installs nor executes host code',async()=>{
  const f=fixture(),guide=await f.call('guide');assert.equal(guide.status,'ok');assert.equal((await validateUserIndicatorSource(guide.data.template)).ok,true);
  const preview=await f.call('validate',{source});assert.equal(preview.status,'ok');assert.equal(preview.data.valid,true);
  assert.equal(preview.data.extensionType,'indicator');assert.equal(preview.data.stage,'validate');assert.match(preview.data.sourceHash,/^[a-f0-9]{64}$/);
  assert.equal(f.store.records.size,0);assert.equal(f.sideEffects(),0);f.session.close();
});
test('validated indicator installs, source can be read, replacement and deletion use the same library',async()=>{
  const f=fixture();let preview=await f.call('validate',{source});assert.equal((await f.call('install',{draftId:preview.data.draftId})).status,'ok');
  const record=await f.call('source',{indicatorId:'fixture.sma'});assert.equal(record.data.source,source);assert.equal(record.data.sourceHash,preview.data.sourceHash);
  const revised=source.replace('indicatorVersion: 1','indicatorVersion: 2');preview=await f.call('validate',{source:revised});
  assert.equal(preview.data.disposition,'replace');assert.equal((await f.call('install',{draftId:preview.data.draftId})).status,'ok');
  assert.equal((await f.library.get('fixture.sma')).indicatorVersion,2);
  assert.equal((await f.call('library_remove',{indicatorId:'fixture.sma'})).status,'ok');assert.equal(f.store.records.size,0);f.session.close();
});
test('invalid source yields a structured diagnostic with no persistent changes',async()=>{
  const f=fixture();const result=await f.call('validate',{source:'while(true){}'});assert.equal(result.status,'ok');assert.equal(result.data.valid,false);
  assert.equal(result.data.extensionType,'indicator');assert.equal(result.data.stage,'validate');assert.match(result.data.sourceHash,/^[a-f0-9]{64}$/);
  assert.equal(typeof result.data.errorCode,'string');assert.equal(result.data.draftId,undefined);assert.equal(f.store.records.size,0);f.session.close();
});
test('definition validation includes field, reason, expected contract and safe failure detail',async()=>{
  const f=fixture();
  const broken=source.replace("type: 'number'","type: 'string'");
  const result=await f.call('validate',{source:broken});assert.equal(result.status,'ok');assert.equal(result.data.valid,false);
  assert.equal(result.data.errorCode,'invalid_definition');assert.equal(result.data.field,'inputs.period.type');
  assert.equal(result.data.reason,'definition_contract_mismatch');assert.match(result.data.expected,/unsupported/);
  assert.match(result.data.failureDetail,/inputs\.period\.type.*unsupported/);f.session.close();
});
test('validated draft can be runtime-tested without installation and preserves exact candidate identity',async()=>{
  const f=fixture();const preview=await f.call('validate',{source});assert.equal(preview.status,'ok');assert.equal(preview.data.valid,true);
  const tested=await f.call('test',{draftId:preview.data.draftId});assert.equal(tested.status,'ok',JSON.stringify(tested));
  assert.equal(tested.data.valid,true);assert.equal(tested.data.extensionType,'indicator');assert.equal(tested.data.stage,'runtime');
  assert.equal(tested.data.sourceHash,preview.data.sourceHash);assert.equal(tested.data.sampleRows,3);assert.equal(tested.data.allSeriesEmpty,false);
  assert.deepEqual(tested.data.coveredReasons,['initial','history','realtime','reconciliation']);assert.equal(tested.data.limits.seriesDataPointsPerCallback,12000);
  assert.deepEqual(tested.data.timings.map(item=>[item.reason,item.budgetMs]),[['initial',2000],['history',1000],['realtime',100],['reconciliation',2000]]);
  assert.deepEqual(JSON.parse(JSON.stringify(tested.data.series)),[{key:'line',type:'line',points:3,ready:2,firstReadyTime:2,lastReadyTime:3,allEmpty:false}]);
  assert.deepEqual(JSON.parse(JSON.stringify(tested.data.barStyles)),[{key:'colors',points:2,firstTime:2,lastTime:3,allEmpty:false}]);
  assert.deepEqual(JSON.parse(JSON.stringify(tested.data.logs)),[{phase:'update',message:'preflight ok'}]);
  assert.equal(f.store.records.size,0);f.session.close();
});
test('preflight diagnostics do not invent a 16-item Marker or BarStyle contribution cap',async()=>{
  const f=fixture();const preview=await f.call('validate',{source:source+'\n// MANY_DIAGNOSTICS'});
  const tested=await f.call('test',{draftId:preview.data.draftId});assert.equal(tested.status,'ok',JSON.stringify(tested));
  assert.equal(tested.data.markers.length,17);assert.equal(tested.data.barStyles.length,17);f.session.close();
});
test('preflight tool preserves failed-run logs and accepts aggregate per-callback log budgets including pointer logs',async()=>{
  const f=fixture();
  let preview=await f.call('validate',{source:source+'\n// RUNTIME_FAIL_LOGS'});
  let tested=await f.call('test',{draftId:preview.data.draftId});assert.equal(tested.status,'ok',JSON.stringify(tested));
  assert.equal(tested.data.valid,false);assert.deepEqual(JSON.parse(JSON.stringify(tested.data.logs)),[
    {phase:'create',message:'before failure'},{phase:'update',message:'initial ok'},
  ]);
  await f.call('draft_release',{draftId:preview.data.draftId});
  preview=await f.call('validate',{source:source+'\n// MANY_LOGS'});
  tested=await f.call('test',{draftId:preview.data.draftId});assert.equal(tested.status,'ok',JSON.stringify(tested));
  assert.equal(tested.data.logs.length,256);assert.equal(tested.data.logs.at(-1).phase,'pointer');f.session.close();
});
test('runtime-failing candidate returns repair diagnostic and never replaces the installed library',async()=>{
  const f=fixture();let good=await f.call('validate',{source});assert.equal((await f.call('install',{draftId:good.data.draftId})).status,'ok');
  const before=await f.library.get('fixture.sma');const broken=source.replace('indicatorVersion: 1','indicatorVersion: 2')+'\n// RUNTIME_FAIL';
  const preview=await f.call('validate',{source:broken});assert.equal(preview.data.valid,true);
  const tested=await f.call('test',{draftId:preview.data.draftId});assert.equal(tested.status,'ok',JSON.stringify(tested));assert.equal(tested.data.valid,false);
  assert.equal(tested.data.stage,'runtime');assert.equal(tested.data.failurePhase,'create');assert.equal(tested.data.errorCode,'execution_timeout');
  assert.equal(tested.data.sourceHash,preview.data.sourceHash);assert.equal((await f.library.get('fixture.sma')).sourceHash,before.sourceHash);f.session.close();
});
test('draft ids cannot cross sessions, survive revocation or silently extend expiry',async()=>{
  const f=fixture();const other=f.open();let preview=await f.call('validate',{source});
  assert.equal((await f.call('install',{draftId:preview.data.draftId},other)).code,'snapshot_unavailable');
  f.advance();assert.equal((await f.call('install',{draftId:preview.data.draftId})).code,'snapshot_unavailable');
  preview=await f.call('validate',{source});f.session.close();assert.equal((await f.call('install',{draftId:preview.data.draftId},other)).code,'snapshot_unavailable');assert.equal(f.store.records.size,0);other.close();
});
test('missing and application source ids never become a filesystem read',async()=>{
  const f=fixture();assert.equal((await f.call('source',{indicatorId:'../src/main.ts'})).code,'field_unavailable');assert.equal((await f.call('source',{indicatorId:'builtin.ma'})).code,'field_unavailable');f.session.close();
});

test('the full existing 256 KiB indicator file budget also works through the shared tool request',async()=>{
  const f=fixture();
  const limit=256*1024, padded=source+'\n/*'+'a'.repeat(limit-Buffer.byteLength(source)-5)+'*/';
  assert.equal(Buffer.byteLength(padded),limit);
  const started=performance.now();
  const result=await f.call('validate',{source:padded});
  assert.equal(result.status,'ok');assert.equal(result.data.valid,true);assert.equal(f.store.records.size,0);
  console.log(`256 KiB .tfi validation via CapabilityCore: ${(performance.now()-started).toFixed(1)}ms (Node fixture)`);
  assert.equal((await f.call('validate',{source:padded+'x'})).status,'error');f.session.close();
});

test('successful installs release draft capacity so normal iterative edits do not hit an artificial eight-edit limit',async()=>{
  const f=fixture();
  for(let version=1;version<=12;version++){
    const validation=await f.call('validate',{source:source.replace('indicatorVersion: 1',`indicatorVersion: ${version}`)});
    assert.equal(validation.status,'ok');assert.equal(validation.data.valid,true);
    assert.equal((await f.call('install',{draftId:validation.data.draftId})).status,'ok');
  }
  assert.equal((await f.library.get('fixture.sma')).indicatorVersion,12);f.session.close();
});

test('abandoned drafts can be explicitly released and capacity errors explain recovery',async()=>{
  const f=fixture(),drafts=[];
  for(let version=1;version<=8;version++){
    const result=await f.call('validate',{source:source.replace('indicatorVersion: 1',`indicatorVersion: ${version}`)});
    assert.equal(result.status,'ok');drafts.push(result.data.draftId);
  }
  const full=await f.call('validate',{source:source.replace('indicatorVersion: 1','indicatorVersion: 9')});
  assert.equal(full.status,'error');assert.equal(full.code,'snapshot_capacity');
  assert.deepEqual(full.details,{resource:'indicator_drafts',limit:8,inUse:8,hint:'install or release an unused indicator draft'});
  assert.deepEqual(JSON.parse(JSON.stringify((await f.call('draft_release',{draftId:drafts[3]})).data)),{released:true});
  assert.equal((await f.call('draft_release',{draftId:drafts[3]})).code,'snapshot_unavailable');
  const recovered=await f.call('validate',{source:source.replace('indicatorVersion: 1','indicatorVersion: 9')});
  assert.equal(recovered.status,'ok');assert.equal(recovered.data.valid,true);f.session.close();
});
