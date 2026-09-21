import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
import { TASK_LIMITS, TaskError, taskJson, validateTaskManifest, exact } from './contracts.ts';
import type { JsonValue } from '../ai-capabilities/contracts.ts';

/** Worker-only module. Poisoned VM disposal is delegated to Worker termination. */
export async function createTaskEngine(source: string) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > TASK_LIMITS.sourceBytes) throw new TaskError('task_source_limit');
  const wasm = await newQuickJSWASMModuleFromVariant(variant), runtime = wasm.newRuntime();
  runtime.setMemoryLimit(TASK_LIMITS.heapBytes); runtime.setMaxStackSize(TASK_LIMITS.stackBytes);
  const context = runtime.newContext(), secret = crypto.randomUUID();
  const evaluate = (code: string, capture = false): unknown => {
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TASK_LIMITS.stepMs));
    try {
      const result = context.evalCode(code, 'user-task.tft', { type: 'global', strict: true });
      if (result.error) {
        const error = context.dump(result.error); result.error.dispose();
        const message = typeof error?.message === 'string' ? error.message : '';
        throw new TaskError(/interrupted/i.test(message) ? 'task_execution_timeout' : /out of memory/i.test(message) ? 'task_memory_limit'
          : /stack overflow/i.test(message) ? 'task_stack_limit' : /task_async_unsupported/.test(message) ? 'task_async_unsupported' : 'task_runtime_error');
      }
      const value = capture ? context.dump(result.value) : undefined; result.value.dispose();
      if (runtime.hasPendingJob()) throw new TaskError('task_async_unsupported');
      if (!capture) return;
      if (typeof value !== 'string' || new TextEncoder().encode(value).length > TASK_LIMITS.outputBytes) throw new TaskError('task_output_limit');
      return taskJson(JSON.parse(value));
    } finally { runtime.removeInterruptHandler(); }
  };
  evaluate(`(() => {
    'use strict';
    const secret=${JSON.stringify(secret)}, stringify=JSON.stringify, parse=JSON.parse, keys=Object.keys,
      define=Object.defineProperty, apply=Reflect.apply, finite=Number.isFinite;
    let definition, count=0, manifest, instance, onSymbol, finish, phase='declared';
    const encode=value=>stringify(value,(_key,v)=>{if(typeof v==='number'&&!finite(v))throw new Error('task_nonfinite');return v;});
    define(globalThis,'defineTask',{value:value=>{
      count++; if(count!==1)return;definition=value;
      manifest=encode({keys:keys(value),formatVersion:value.formatVersion,apiVersion:value.apiVersion,id:value.id,
        version:value.version,name:value.name,description:value.description,inputSchema:value.inputSchema,defaults:value.defaults,
        history:value.history,outputs:value.outputs,create:typeof value.create==='function'});
    },writable:false,configurable:false});
    define(globalThis,'__tfTaskDispatch',{value:(token,operation,json)=>{
      if(token!==secret)throw new Error('task_dispatch_denied');
      if(operation==='manifest')return encode({count,manifest});
      const input=parse(json);
      if(operation==='start'){
        if(phase!=='declared')throw new Error('task_phase');phase='started';
        instance=apply(definition.create,undefined,[input]);
        if(instance&&typeof instance.then==='function')throw new Error('task_async_unsupported');
        if(!instance||typeof instance.onSymbol!=='function'||(instance.finish!==undefined&&typeof instance.finish!=='function'))throw new Error('task_callbacks');
        onSymbol=instance.onSymbol;finish=instance.finish;return '[]';
      }
      if(phase!=='started')throw new Error('task_phase');
      const value=operation==='process'?apply(onSymbol,instance,[input]):finish?apply(finish,instance,[]):[];
      if(value&&typeof value.then==='function')throw new Error('task_async_unsupported');
      if(operation==='finish')phase='finished';
      return encode(value===undefined?[]:value);
    },writable:false,configurable:false});
  })();`);
  evaluate(source);
  const dispatch = (operation: string, input: JsonValue = null) => evaluate(`__tfTaskDispatch(${JSON.stringify(secret)},${JSON.stringify(operation)},${JSON.stringify(JSON.stringify(input))})`, true);
  const captured = dispatch('manifest'); exact(captured, ['count','manifest']);
  if (captured.count !== 1 || typeof captured.manifest !== 'string') throw new TaskError('task_invalid_manifest');
  const raw = JSON.parse(captured.manifest);
  if (!Array.isArray(raw.keys) || raw.keys.some((key: unknown) => !['formatVersion','apiVersion','id','version','name','description','inputSchema','defaults','history','outputs','create'].includes(key as string)) || raw.create !== true) throw new TaskError('task_invalid_manifest');
  const { keys: _keys, create: _create, ...fields } = raw;
  const manifest = validateTaskManifest(taskJson(fields, TASK_LIMITS.manifestBytes));
  return { manifest, call: (operation: 'start' | 'process' | 'finish', input: JsonValue) => dispatch(operation, input) };
}
