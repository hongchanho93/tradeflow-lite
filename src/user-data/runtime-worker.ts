import { createConnectorEngine } from './runtime-engine.ts';
import { DataError, dataError, dataJson, exact, validateIo, type ConnectorInvocation } from './contracts.ts';
import type { JsonValue } from '../ai-capabilities/contracts.ts';

export interface ConnectorWorkerPort { onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void; close(): void }
export function attachConnectorWorker(port: ConnectorWorkerPort): void {
  let id: string|undefined, engine: Awaited<ReturnType<typeof createConnectorEngine>>|undefined;
  let phase:'idle'|'starting'|'waiting'|'busy'|'done'='idle', sequence=0;
  const fail=(error:unknown)=>{
    if(phase==='done')return;phase='done';const failure=dataError(error);
    port.postMessage({protocol:1,id,type:'error',code:failure.code,
      ...(failure.path?{path:failure.path}:{}),...(failure.reason?{reason:failure.reason}:{}),...(failure.expected?{expected:failure.expected}:{}),
      ...(failure.failureDetail?{failureDetail:failure.failureDetail}:{})});
    port.close();
  };
  const deliver=(result:{done:boolean;value:JsonValue})=>{
    if(result.done){phase='done';port.postMessage({protocol:1,id,type:'result',manifest:engine!.manifest,value:result.value});port.close();}
    else {const request=validateIo(result.value);phase='waiting';port.postMessage({protocol:1,id,type:'io',sequence:++sequence,request});}
  };
  port.onmessage=event=>{
    void (async()=>{
      const message=event.data;
      if(phase==='idle'){
        exact(message,['protocol','id','type','invocation']);
        if(message.protocol!==1||typeof message.id!=='string'||message.type!=='start')throw new DataError('data_invalid_protocol');
        id=message.id;phase='starting';
        const invocation=message.invocation as ConnectorInvocation;
        exact(invocation,['source','operation','input','expectedManifest'],['source','operation']);
        if(typeof invocation.source!=='string'||!['validate','catalog','history'].includes(invocation.operation))throw new DataError('data_invalid_protocol');
        engine=await createConnectorEngine(invocation.source);
        if(invocation.expectedManifest&&JSON.stringify(engine.manifest)!==JSON.stringify(invocation.expectedManifest))throw new DataError('data_connector_changed');
        if(invocation.operation==='validate'){
          phase='done';port.postMessage({protocol:1,id,type:'result',manifest:engine.manifest});port.close();
        } else {phase='busy';deliver(engine.start(invocation.operation,dataJson(invocation.input??{},64*1024)));}
      } else {
        exact(message,['protocol','id','type','sequence','value']);
        if(phase!=='waiting'||message.protocol!==1||message.id!==id||message.type!=='io_result'||message.sequence!==sequence)throw new DataError('data_invalid_protocol');
        phase='busy';deliver(engine!.next(dataJson(message.value,6*1024*1024,1024*1024+8192)));
      }
    })().catch(fail);
  };
}
