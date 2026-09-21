import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { CapabilityError } from '../src/ai-capabilities/contracts.ts';
import { UserIndicatorLibrary, UserIndicatorLibraryError } from '../src/user-indicator-runtime/library.ts';
import { validateUserIndicatorSource } from '../src/user-indicator-runtime/validator-engine.ts';
import { normalizeUserIndicatorInputs } from '../src/user-indicator-runtime/runtime-manager.ts';
import { resolveUserIndicatorStateEntries } from '../src/indicator-sdk/state.ts';
const source=readFileSync(new URL('../fixtures/user-indicators/01-sma.tfi',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const start=main.indexOf('async function prepareAiLibraryChange('),end=main.indexOf('\nasync function waitForAiUserIndicators(',start);
assert.ok(start>=0&&end>start);
const body=stripTypeScriptTypes(main.slice(start,end));
class Store {
  rows=new Map();
  async get(id){return structuredClone(this.rows.get(id)??null);}
  async list(){return [...this.rows.values()].map(v=>structuredClone(v));}
  async put(v){this.rows.set(v.id,structuredClone(v));}
  async delete(id){this.rows.delete(id);}
  async compareAndSwap(id,hash,v){if((this.rows.get(id)?.sourceHash??null)!==hash)throw new UserIndicatorLibraryError('stale_import_preview','changed');if(v)this.rows.set(id,structuredClone(v));else this.rows.delete(id);}
}
async function fixture(){
  const library=new UserIndicatorLibrary(new Store(),{validator:validateUserIndicatorSource});
  const initial=(await library.install(await library.prepareImport('sma.tfi',new TextEncoder().encode(source)))).record;
  const h=new Function('deps',`const {CapabilityError,normalizeUserIndicatorInputs,resolveUserIndicatorStateEntries}=deps;
    const userIndicatorLibrary=deps.library;let indicatorStateReady=true,aiIndicatorLibraryBusy=false,aiIndicatorRevision=0;
    const initial=deps.initial,userIndicatorRecords=new Map([[initial.id,initial]]),userIndicatorRuntimeFailures=new Map();
    const original={runtimeKind:'user',instanceId:'saved-1',indicatorId:initial.id,indicatorVersion:1,sourceHash:initial.sourceHash,inputs:{period:17},visible:false,menuOrder:0,panes:[{key:'range',height:187,renderOrder:1}]};
    const rows=new Map([[original.instanceId,structuredClone(original)]]),paneState=new Map([[original.instanceId,structuredClone(original.panes)]]);
    let indicatorInstanceOrder=['saved-1'],loadedIndicatorState={instances:[structuredClone(original)],unresolvedEntries:[],mainOverlayOrder:[]};
    let stored=JSON.stringify(loadedIndicatorState),failSave=false,failRun=false,gate;
    const INDICATOR_STATE_STORAGE_KEY='indicator',localStorage={getItem:()=>stored,setItem:(_k,v)=>{stored=v;},removeItem:()=>{stored=null;}};
    const workspaceStorage=localStorage;
    const userIndicatorRuntime={list:()=>[...rows.values()],get:id=>rows.get(id),remove(id){rows.delete(id);paneState.delete(id);},add(config){rows.set(config.instanceId,{...config,runtimeKind:'user',panes:paneState.get(config.instanceId)||[],menuOrder:0});}};
    const allIndicatorInstances=()=>userIndicatorRuntime.list();
    const indicatorChartHost={restorePaneStates:(id,value)=>paneState.set(id,structuredClone(value))};
    const captureUserIndicatorInstances=(id,hash)=>[...rows.values()].filter(v=>v.indicatorId===id&&(!hash||v.sourceHash===hash)).map(v=>structuredClone(v));
    const preserveAndStopUserIndicatorInstances=(id,hash,preserved)=>{const ids=new Set(preserved.map(v=>v.instanceId));loadedIndicatorState={...loadedIndicatorState,instances:loadedIndicatorState.instances.filter(v=>!ids.has(v.instanceId)),unresolvedEntries:[...loadedIndicatorState.unresolvedEntries,...preserved]};for(const v of preserved)userIndicatorRuntime.remove(v.instanceId);indicatorInstanceOrder=indicatorInstanceOrder.filter(id=>!ids.has(id));};
    const persistIndicatorState=()=>{loadedIndicatorState={...loadedIndicatorState,instances:structuredClone([...rows.values()])};aiIndicatorRevision++;if(failSave){failSave=false;throw new CapabilityError('storage_failed');}stored=JSON.stringify(loadedIndicatorState);};
    const applyIndicatorInstanceOrder=()=>{},renderIndicatorPicker=()=>{},renderIndicatorLegends=()=>{},renderDrawingManager=()=>{},drawingManager={hidden:true};
    const waitForAiUserIndicators=async(_id,ctx)=>{if(gate)await gate;ctx.checkpoint();if(failRun){failRun=false;throw new CapabilityError('indicator_failed');}};
    ${body}
    return {prepare:prepareAiLibraryChange,view:()=>({rows:structuredClone([...rows.values()]),state:structuredClone(loadedIndicatorState),stored,busy:aiIndicatorLibraryBusy}),
      failStorage(){failSave=true;},failRuntime(){failRun=true;},stall(p){gate=p;}};
  `)({library,initial,CapabilityError,normalizeUserIndicatorInputs,resolveUserIndicatorStateEntries});
  const controller=new AbortController();const ctx={context:{scope:'app',appInstanceId:'test'},signal:controller.signal,session:{signal:controller.signal},checkpoint(){if(controller.signal.aborted)throw new CapabilityError('cancelled');}};
  return {...h,library,ctx,controller,initial,prepareVersion:v=>library.prepareImport('sma.tfi',new TextEncoder().encode(source.replace('indicatorVersion: 1',`indicatorVersion: ${v}`)))};
}
const run=async tx=>{try{await tx.commit();}catch(e){await tx.rollback();throw e;}finally{tx.dispose?.();}};
test('real host replacement preserves instance ids, compatible parameters, visibility and pane layout',async()=>{
  const f=await fixture();await run(await f.prepare(await f.prepareVersion(2),'fixture.sma',true,f.ctx));
  const view=f.view();assert.equal(view.rows[0].instanceId,'saved-1');assert.equal(view.rows[0].indicatorVersion,2);assert.equal(view.rows[0].inputs.period,17);assert.equal(view.rows[0].visible,false);assert.equal(view.rows[0].panes[0].height,187);assert.equal(view.busy,false);
});
for(const kind of ['storage','runtime'])test(`real host ${kind} failure restores prior source, parameters and saved state`,async()=>{
  const f=await fixture(),before=f.view();const tx=await f.prepare(await f.prepareVersion(2),'fixture.sma',true,f.ctx);
  if(kind==='storage')f.failStorage();else f.failRuntime();await assert.rejects(run(tx),new RegExp(kind==='storage'?'storage_failed':'indicator_failed'));
  assert.equal((await f.library.get('fixture.sma')).sourceHash,f.initial.sourceHash);assert.deepEqual(f.view(),before);
});
test('real host deleting then reimporting the exact source recovers saved instances without editing files',async()=>{
  const f=await fixture();await run(await f.prepare(null,'fixture.sma',false,f.ctx));assert.equal(f.view().rows.length,0);assert.equal(f.view().state.unresolvedEntries.length,1);
  await run(await f.prepare(await f.prepareVersion(1),'fixture.sma',true,f.ctx));assert.equal(f.view().rows[0].inputs.period,17);assert.equal(f.view().state.unresolvedEntries.length,0);
});
test('real host keeps the mutation lease through asynchronous execution and releases it after cancellation compensation',async()=>{
  const f=await fixture(),before=f.view();let done;f.stall(new Promise(r=>{done=r;}));const tx=await f.prepare(await f.prepareVersion(2),'fixture.sma',true,f.ctx);const pending=run(tx);
  for(let n=0;n<30;n++)await new Promise(r=>setTimeout(r,1));assert.equal(f.view().busy,true);f.controller.abort();done();await assert.rejects(pending,/cancelled/);assert.deepEqual(f.view(),before);
});

test('ordinary import-and-add returns to the chart while save-only keeps the picker available',async()=>{
  const from=main.indexOf('async function confirmUserIndicatorLibraryChange('),to=main.indexOf('\nfunction openIndicatorConfig(',from);
  const confirm=stripTypeScriptTypes(main.slice(from,to));
  for(const add of [false,true]){
    const run=new Function('deps',`const {CapabilityError,UserIndicatorLibraryError}=deps;
      const userIndicatorLibrary={},aiIndicatorLibraryBusy=false,aiChartAppInstanceId='test';let userIndicatorImportAbort=null;
      const confirmUserIndicatorImportButton={},confirmUserIndicatorAddButton={},userIndicatorImportError={},copyUserIndicatorAiDiagnosticButton={};
      const pendingUserIndicatorDeleteId=null,pendingUserIndicatorImport={manifest:{id:'fixture'},disposition:'new'};let pendingUserIndicatorDiagnostic;
      const readCurrentAiChartSelection=()=>({}),sameSelection=()=>true,showChartToast=()=>{},userIndicatorImportErrorText=String;
      let pickerHidden=true,installed=false,added=false;
      const prepareAiLibraryChange=async()=>({commit:async()=>{installed=true;},rollback:async()=>{},dispose(){}});
      const prepareAiIndicatorChange=()=>({commit(){added=true;},rollback(){},dispose(){}});
      const closeUserIndicatorImportPreview=()=>{pickerHidden=false;},closeIndicatorPicker=()=>{pickerHidden=true;};
      ${confirm}
      return async add=>{await confirmUserIndicatorLibraryChange(add);return {pickerHidden,installed,added};};
    `)({CapabilityError,UserIndicatorLibraryError});
    assert.deepEqual(await run(add),{pickerHidden:add,installed:true,added:add});
  }
});
