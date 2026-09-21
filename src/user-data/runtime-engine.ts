import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
import { DATA_BUDGET, DataError, dataJson, exact, validateManifest, type ConnectorManifest } from './contracts.ts';
import type { JsonValue } from '../ai-capabilities/contracts.ts';

const BOOTSTRAP = String.raw`(() => {
  'use strict';
  const stringify=JSON.stringify, keys=Object.keys, define=Object.defineProperty, freeze=Object.freeze;
  let definition, count=0, manifest, iterator;
  const install=(name,value)=>define(globalThis,name,{value,writable:false,configurable:false});
  const io=freeze({
    list:(path='',after,limit=256)=>({operation:'list',path,limit,...(after==null?{}:{after})}),
    read:(path,offset=0,length=65536,fileRevision)=>({operation:'read',path,offset,length,...(fileRevision==null?{}:{fileRevision})}),
    readText:(path,offset=0,length=65536,fileRevision,encoding='utf-8')=>({operation:'read_text',path,offset,length,encoding,...(fileRevision==null?{}:{fileRevision})}),
    sqlite:(path,options)=>({...options,operation:'sqlite',path,parameters:options.parameters??[],limit:options.limit??512}),
    parquet:(path,options={})=>({...options,operation:'parquet',path,offset:options.offset??0,limit:options.limit??512})
  });
  install('defineConnector',value=>{
    count++; if(count!==1)return;
    definition=value;
    manifest=stringify({keys:keys(value),formatVersion:value.formatVersion,apiVersion:value.apiVersion,
      id:value.id,version:value.version,name:value.name,description:value.description,supports:value.supports,
      catalog:typeof value.listSymbols==='function',history:typeof value.getHistory==='function'});
  });
  install('__tfConnectorManifest',()=>stringify({count,manifest}));
  const step=value=>{
    const result=iterator.next(value);
    if(!result || typeof result.done!=='boolean') throw new Error('connector_requires_sync_generator');
    return stringify({done:result.done,value:result.value===undefined?null:result.value});
  };
  install('__tfConnectorStart',(operation,input)=>{
    if(iterator)throw new Error('connector_already_started');
    iterator=(operation==='catalog'?definition.listSymbols:definition.getHistory)(input,io);
    if(!iterator || typeof iterator.next!=='function')throw new Error('connector_requires_sync_generator');
    return step(undefined);
  });
  install('__tfConnectorNext',step);
})();`;

function safeGuestFailureDetail(message: string): string {
  return message.replace(/[\u0000-\u001f\u007f]+/g,' ')
    .replace(/file:\/\/[^\s)]+/gi,'[path]')
    .replace(/\/(?:Users|home|private|var|tmp)\/[^\s:)]+/g,'[path]')
    .replace(/[A-Za-z]:\\[^\s:)]+/g,'[path]')
    .replace(/\s+/g,' ').trim().slice(0,512);
}

/** This module is only imported in one-shot Workers, never by the main WebView.
 * Even poisoned/pending-job QuickJS runtimes are reclaimed by Worker termination
 * rather than JS_FreeRuntime (the indicator runtime documents that ABI hazard). */
export async function createConnectorEngine(source: string) {
  if (new TextEncoder().encode(source).length > DATA_BUDGET.sourceBytes) throw new DataError('data_source_too_large');
  const wasm = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = wasm.newRuntime(); runtime.setMemoryLimit(DATA_BUDGET.heapBytes); runtime.setMaxStackSize(DATA_BUDGET.stackBytes);
  const context = runtime.newContext();
  const evaluate = (code: string, filename = 'connector.tfc', json = false): unknown => {
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now()+DATA_BUDGET.stepMs));
    try {
      const result=context.evalCode(code,filename,{type:'global',strict:true});
      if(result.error) {
        const error=context.dump(result.error); result.error.dispose();
        const message=typeof error?.message==='string'?error.message:'';
        if(/interrupted/i.test(message))throw new DataError('data_execution_timeout');
        if(/out of memory/i.test(message))throw new DataError('data_memory_limit');
        if(/stack overflow/i.test(message))throw new DataError('data_stack_limit');
        throw new DataError('data_runtime_error',{failureDetail:safeGuestFailureDetail(message)||'guest_runtime_error'});
      }
      // Capture only string primitives. No uncontrolled guest object traversal.
      const value=json?context.dump(result.value):undefined; result.value.dispose();
      if(runtime.hasPendingJob())throw new DataError('data_async_unsupported');
      if(!json)return undefined;
      if(typeof value!=='string'||new TextEncoder().encode(value).length>DATA_BUDGET.outputBytes)throw new DataError('data_output_limit');
      return dataJson(JSON.parse(value));
    } finally { runtime.removeInterruptHandler(); }
  };
  evaluate(BOOTSTRAP,'connector-host.js'); evaluate(source);
  const capture=evaluate('__tfConnectorManifest()','connector-host.js',true);
  exact(capture,['count','manifest']);
  if(capture.count!==1||typeof capture.manifest!=='string')throw new DataError('data_invalid_manifest');
  const raw=JSON.parse(capture.manifest);
  exact(raw,['keys','formatVersion','apiVersion','id','version','name','description','supports','catalog','history'],['keys','formatVersion','apiVersion','id','version','name','supports','catalog','history']);
  if(!Array.isArray(raw.keys)||raw.keys.some((k:unknown)=>typeof k!=='string'||!['formatVersion','apiVersion','id','version','name','description','supports','listSymbols','getHistory'].includes(k))
    ||raw.catalog!==true||raw.history!==true)throw new DataError('data_invalid_manifest');
  const {keys:_,catalog:__,history:___,...fields}=raw;
  const manifest:ConnectorManifest=validateManifest(fields);
  const response=(value:unknown):{done:boolean;value:JsonValue}=>{
    exact(value,['done','value']);if(typeof value.done!=='boolean')throw new DataError('data_invalid_output');
    return {done:value.done,value:dataJson(value.value)};
  };
  return {manifest,
    start:(operation:'catalog'|'history',input:JsonValue)=>response(evaluate(`__tfConnectorStart(${JSON.stringify(operation)},${JSON.stringify(input)})`,'connector-host.js',true)),
    next:(input:JsonValue)=>response(evaluate(`__tfConnectorNext(${JSON.stringify(input)})`,'connector-host.js',true))};
}
