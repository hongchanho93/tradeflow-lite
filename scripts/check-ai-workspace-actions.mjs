import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { API_ERRORS } from '../src/ai-api/strings.ts';
import './check-ai-platform-docs.mjs';
import { stripTypeScriptTypes } from 'node:module';
import { createWorkspaceActionTools, parseIndicatorInputPatch } from '../src/ai-capabilities/workspace-actions.ts';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { CapabilityError, sameSelection, requireChartSelection } from '../src/ai-capabilities/contracts.ts';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
function extract(name, next) {
  const a = main.indexOf(`function ${name}(`), b = main.indexOf(`\nfunction ${next}(`, a);
  assert.ok(a >= 0 && b > a, `missing real main.ts ${name}`);
  return stripTypeScriptTypes(main.slice(a, b));
}
const scope = { appInstanceId: 'app', chartId: 'main', provider: 'tdx', instrument: 'SH:600000', resolution: '1D', adjustment: 'none', selectionGeneration: 1 };
const schema = { period: { type: 'number', title: '周期', default: 20, min: 1, max: 500, step: 1 },
  enabled: { type: 'boolean', title: '启用', default: true }, color: { type: 'color', title: '颜色', default: '#2962ff' } };
test('parameter patches preserve unspecified values and reject unknown/invalid values', () => {
  assert.deepEqual({ ...parseIndicatorInputPatch(schema, '{"period":55}', { enabled: false }) }, { period: 55, enabled: false, color: '#2962ff' });
  for (const [patch,path,reason] of [
    ['{"period":0}','inputsJson.period','out_of_range'],
    ['{"period":1.5}','inputsJson.period','step_mismatch'],
    ['{"unknown":1}','inputsJson.unknown','unknown_field'],
    ['{"enabled":1}','inputsJson.enabled','type_mismatch'],
    ['[]','inputsJson','type_mismatch'],
  ]) assert.throws(() => parseIndicatorInputPatch(schema, patch), error => {
    assert.equal(error.code,'invalid_request');assert.equal(error.path,path);assert.equal(error.reason,reason);assert.equal(typeof error.expected,'string');return true;
  });
  assert.throws(() => parseIndicatorInputPatch(schema, '{"__proto__":{}}'), /invalid_request/,
    'prototype-pollution rejection remains a parser/security boundary and need not expose a semantic field path');
});

test('tf_indicator_inputs_set preserves semantic field diagnostics after schema validation', async () => {
  const tx={result:{instanceId:'i',indicatorId:'test',state:'configured'},commit(){},rollback(){}};
  const tools=createWorkspaceActionTools({prepareWatchlist(){throw Error();},prepareIndicator(change){
    if(change.op==='inputs')parseIndicatorInputPatch(schema,change.inputsJson,{period:20,enabled:true,color:'#2962ff'});return tx;
  },indicatorInputs(){throw Error();}});
  const core=new CapabilityCore(new CapabilityRegistry(tools));
  const s=core.openSession({context:scope,currentContext:()=>scope,permissions:{'tf.indicator.inputs_set':'allow'}});
  const result=await s.invoke(JSON.stringify({protocolVersion:1,requestId:'input-diag',toolId:'tf.indicator.inputs_set',context:scope,input:{instanceId:'i',inputsJson:'{"period":9999}'}}));
  assert.equal(result.status,'error');assert.equal(result.code,'invalid_request');assert.equal(result.path,'inputsJson.period');
  assert.equal(result.reason,'out_of_range');assert.match(result.expected,/500/);s.close();
});
function watchlistHarness() {
  const source = extract('prepareAiWatchlistChange', 'prepareAiIndicatorChange');
  return new Function('deps', `const { CapabilityError } = deps;
    let watchlistSymbols = ['tdx|SH:600000','missing|X:A']; let aiWatchlistRevision = 0;
    const marketSymbolById = new Map(); let stored = 'original', storageFails = false, renderFails = false;
    const WATCHLIST_STORAGE_KEY = 'watchlist';
    const localStorage = { getItem:()=>stored, setItem:(_k,v)=>{if(storageFails)throw Error('disk');stored=v;}, removeItem:()=>{stored=null;} };
    const workspaceStorage = localStorage;
    const saveWatchlist = (s,keys)=>{try{s.setItem('watchlist',JSON.stringify({version:1,symbols:keys}));return true;}catch{return false;}};
    const renderWatchlist = ()=>{if(renderFails){renderFails=false;throw Error('render');}};
    const watchlistQuotes = new Map(), marketProviderKey = (p,s)=>p+'|'+s;
    const watchlistSymbolKey = marketProviderKey;
    ${source}
    return { prepare: prepareAiWatchlistChange, read:()=>({keys:watchlistSymbols.slice(),stored}),
      failStorage(v){storageFails=v;}, failRender(){renderFails=true;}, manual(){watchlistSymbols.push('tdx|SZ:000001');aiWatchlistRevision++;} };
  `)({ CapabilityError });
}
const execution = { checkpoint() {}, signal: new AbortController().signal, session: { signal: new AbortController().signal }, context: scope };
test('real watchlist mutation preserves order/unresolved keys, deduplicates and moves/removes exact keys', () => {
  const h = watchlistHarness(); const tx = h.prepare({ op: 'add', items: [{providerId:'tdx',symbol:'SZ:000001'},{providerId:'tdx',symbol:'SZ:000001'}] }, execution);
  tx.commit(); assert.deepEqual(h.read().keys, ['tdx|SH:600000','missing|X:A','tdx|SZ:000001']);
  h.prepare({ op:'move', key:'tdx|SZ:000001',index:0 },execution).commit();
  h.prepare({ op:'remove', keys:['missing|X:A'] },execution).commit();
  assert.deepEqual(h.read().keys, ['tdx|SZ:000001','tdx|SH:600000']);
});
test('real watchlist persistence failure does not mutate memory; render failure rolls back storage and memory', () => {
  for (const kind of ['storage','render']) {
    const h=watchlistHarness(), before=h.read(); const tx=h.prepare({op:'remove',keys:['tdx|SH:600000']},execution);
    if(kind==='storage')h.failStorage(true);else h.failRender();
    assert.throws(()=>tx.commit()); if(kind==='storage')h.failStorage(false); tx.rollback(); assert.deepEqual(h.read(),before);
  }
});
test('real watchlist prepared operation cannot overwrite a later manual edit', () => {
  const h=watchlistHarness();const tx=h.prepare({op:'remove',keys:['tdx|SH:600000']},execution);h.manual();
  assert.throws(()=>tx.commit(),/state_conflict/);tx.rollback();assert.equal(h.read().keys.length,3);
});
test('action registry scopes and deny/ask behavior keep read-only connections read-only', async () => {
  let commits=0;
  const tx={result:{changed:true,count:1},commit(){commits++;},rollback(){commits--;}};
  const tools=createWorkspaceActionTools({prepareWatchlist:()=>tx,prepareIndicator(){throw Error();},indicatorInputs(){throw Error();}});
  const core=new CapabilityCore(new CapabilityRegistry(tools));
  const request=JSON.stringify({protocolVersion:1,requestId:'r',toolId:'tf.watchlist.add',context:{scope:'app',appInstanceId:'app'},input:{items:[{providerId:'tdx',symbol:'SH:600000'}]}});
  for(const permission of ['deny','ask','allow']){
    const s=core.openSession({context:scope,currentContext:()=>scope,permissions:{'tf.watchlist.add':permission}});
    assert.equal((await s.invoke(request)).status,permission==='deny'?'error':permission==='ask'?'approval_required':'ok');s.close();
  }
  assert.equal(commits,1);assert.equal(tools.find(t=>t.id==='tf.indicator.add').scope,'chart');
});

function indicatorHarness(kind='trusted') {
  const source=extract('prepareAiIndicatorChange','createAiWorkspaceActionTools');
  return new Function('deps', `const { CapabilityError, parseIndicatorInputPatch, schema }=deps;
    let aiIndicatorRevision=0, indicatorInstanceOrder=['other'], indicatorStateReady=true,aiIndicatorLibraryBusy=false;
    const aiDisplayedHistoryGeneration=1,historyRequestGate={current:()=>1},currentSeriesKind='ohlcv';
    let loadedIndicatorState={instances:[],unresolvedEntries:[{keep:true}]}, stored='original',failSave=false,failNext=false;
    const INDICATOR_STATE_STORAGE_KEY='indicators',localStorage={getItem:()=>stored,setItem:(_k,v)=>{stored=v;},removeItem:()=>{stored=null;}};
    const workspaceStorage=localStorage;
    const rows=new Map([['other',{instanceId:'other',indicatorId:'other',inputs:{period:9},visible:true,runtimeKind:'trusted'}]]);
    const panes=new Map(),indicatorChartHost={paneStates:id=>panes.get(id)||[],restorePaneStates:(id,v)=>panes.set(id,v)};
    const definition={id:'test',runtimeKind:deps.kind,inputs:schema};
    const userIndicatorRecords=new Map([['test',{sourceHash:'hash',indicatorVersion:1,manifest:{supports:{seriesKinds:['ohlcv']}}}]]);
    const userIndicatorRuntimeFailures=new Map(),activeIndicators=new Set(),hiddenSeries=new Set();
    const allIndicatorInstances=()=>[...rows.values()],indicatorDefinitionView=id=>id==='test'?definition:null;
    const nextIndicatorInstanceId=()=> 'created',defaultIndicatorInstanceId=id=>id;
    const runtime={isApplicable:()=>true,add(config){rows.set(config.instanceId,{...config,runtimeKind:deps.kind,failed:failNext});failNext=false;},
      updateInputs(id,inputs){rows.get(id).inputs=inputs;},remove(id){rows.delete(id);panes.delete(id);},retry(){}};
    const indicatorRuntime=runtime,userIndicatorRuntime=runtime;
    const removeIndicatorInstance=id=>{rows.delete(id);panes.delete(id);indicatorInstanceOrder=indicatorInstanceOrder.filter(x=>x!==id);};
    const setIndicatorInstanceVisible=(id,v)=>{rows.get(id).visible=v;};
    const applySecondaryPaneOrder=()=>{},applyMainSeriesOrder=()=>{},applyIndicatorInstanceOrder=()=>{},renderIndicatorPicker=()=>{},renderIndicatorLegends=()=>{},renderDrawingManager=()=>{},drawingManager={hidden:true};
    const persistIndicatorState=()=>{aiIndicatorRevision++;if(failSave){failSave=false;throw new CapabilityError('storage_failed');}stored=JSON.stringify([...rows.values()]);};
    ${source}
    return {prepare:prepareAiIndicatorChange,read:()=>structuredClone([...rows.values()]),storage:()=>stored,
      layout:(id,p)=>panes.set(id,p),pane:id=>panes.get(id),failStorage(){failSave=true;},failRuntime(){failNext=true;},manual(){aiIndicatorRevision++;}};
  `)({CapabilityError,parseIndicatorInputPatch,schema,kind});
}
for(const kind of ['trusted','user']) test(`actual ${kind} indicator add/inputs/visibility/remove preserve unrelated instances and layouts`,()=>{
  const h=indicatorHarness(kind);h.prepare({op:'add',indicatorId:'test',inputsJson:'{"period":55}'},execution).commit();
  const panes=[{key:'pane',height:187,renderOrder:1}];h.layout('created',panes);
  h.prepare({op:'inputs',instanceId:'created',inputsJson:'{"period":21}'},execution).commit();
  assert.equal(h.read()[1].inputs.period,21);assert.deepEqual(h.pane('created'),panes);
  h.prepare({op:'visibility',instanceId:'created',visible:false},execution).commit();assert.equal(h.read()[1].visible,false);
  h.prepare({op:'remove',instanceId:'created'},execution).commit();assert.equal(h.read().length,1);assert.equal(h.read()[0].inputs.period,9);
});
for(const kind of ['trusted','user']) test(`actual ${kind} indicator failed add and failed edit roll back without losing user configuration`,()=>{
  const h=indicatorHarness(kind);const initial=h.read();h.failRuntime();let tx=h.prepare({op:'add',indicatorId:'test'},execution);
  assert.throws(()=>tx.commit(),/indicator_failed/);tx.rollback();assert.deepEqual(h.read(),initial);assert.equal(h.storage(),'original');
  h.prepare({op:'add',indicatorId:'test'},execution).commit();const before=h.read(),saved=h.storage();h.layout('created',[{key:'pane',height:211}]);
  tx=h.prepare({op:'inputs',instanceId:'created',inputsJson:'{"period":55}'},execution);h.failStorage();
  assert.throws(()=>tx.commit(),/storage_failed/);tx.rollback();
  assert.deepEqual(h.read(),before);assert.equal(h.storage(),saved);assert.equal(h.pane('created')[0].height,211);
});
test('actual indicator prepare does not supersede a manual change',()=>{
  const h=indicatorHarness();const tx=h.prepare({op:'add',indicatorId:'test'},execution);h.manual();
  assert.throws(()=>tx.commit(),/state_conflict/);tx.rollback();assert.equal(h.read().length,1);
});

test('business writes remain available without a separate permission disclosure panel',()=>{
  const page=readFileSync(new URL('../src/ai-api/page.ts',import.meta.url),'utf8');
  assert.doesNotMatch(page,/api-consent|权限与会话说明/);
  for(const code of ['state_conflict','storage_failed','indicator_failed','navigation_failed','rollback_failed'])assert.ok(API_ERRORS[code]);
});
