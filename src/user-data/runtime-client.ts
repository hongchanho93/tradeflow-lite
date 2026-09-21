import { DATA_BUDGET, DataError, dataError, dataJson, exact, object, validateIo, validateManifest,
  type ConnectorInvocation, type ConnectorResult, type DataIoPort } from './contracts.ts';

export interface ConnectorWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}
export interface ConnectorClientOptions { workerFactory?: () => ConnectorWorker; hardTimeoutMs?: number }
export async function runConnector(invocation: ConnectorInvocation, io: DataIoPort | null, signal: AbortSignal,
  options: ConnectorClientOptions = {}): Promise<ConnectorResult> {
  if(signal.aborted)throw new DataError('data_cancelled');
  if(new TextEncoder().encode(invocation.source).length>DATA_BUDGET.sourceBytes)throw new DataError('data_source_too_large');
  const worker:ConnectorWorker=(options.workerFactory??(()=>new Worker(new URL('./runtime.worker.ts',import.meta.url),{type:'module',name:'tradeflow-user-data'})))();
  const id=crypto.randomUUID();const ioAbort=new AbortController();let sequence=0,ioBytes=0,busy=false;
  // Streaming decoders belong to the trusted request, not the guest. A file
  // version/offset mismatch cannot silently glue unrelated byte ranges together.
  const decoders=new Map<string,{decoder:TextDecoder;offset:number;revision:string}>();
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(result?:ConnectorResult,error?:unknown)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
      ioAbort.abort();worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();decoders.clear();
      if(error)reject(dataError(error));else resolve(result!);
    };
    const abort=()=>finish(undefined,new DataError('data_cancelled'));
    const timer=setTimeout(()=>finish(undefined,new DataError('data_execution_timeout')),options.hardTimeoutMs??DATA_BUDGET.wallMs);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
    worker.onerror=event=>{event.preventDefault?.();finish(undefined,new DataError('data_worker_failed'));};
    worker.onmessageerror=()=>finish(undefined,new DataError('data_invalid_protocol'));
    worker.onmessage=event=>{
      void (async()=>{
        const message=event.data;
        if(!object(message)||message.protocol!==1||message.id!==id)throw new DataError('data_invalid_protocol');
        if(message.type==='error'){
          exact(message,['protocol','id','type','code','path','reason','expected','failureDetail'],['protocol','id','type','code']);
          if(typeof message.code!=='string'||(message.path!==undefined&&typeof message.path!=='string')
            ||(message.reason!==undefined&&typeof message.reason!=='string')||(message.expected!==undefined&&typeof message.expected!=='string')
            ||(message.failureDetail!==undefined&&typeof message.failureDetail!=='string'))throw new DataError('data_invalid_protocol');
          throw new DataError(message.code,{path:message.path as string|undefined,reason:message.reason as string|undefined,
            expected:message.expected as string|undefined,failureDetail:message.failureDetail as string|undefined});
        }
        if(message.type==='result'){
          exact(message,['protocol','id','type','manifest','value'],['protocol','id','type','manifest']);
          if(busy)throw new DataError('data_invalid_protocol');
          const manifest=validateManifest(message.manifest);
          if(invocation.expectedManifest&&JSON.stringify(manifest)!==JSON.stringify(invocation.expectedManifest))throw new DataError('data_connector_changed');
          finish({manifest,...(message.value===undefined?{}:{value:dataJson(message.value)})});return;
        }
        exact(message,['protocol','id','type','sequence','request']);
        if(message.type!=='io'||invocation.operation==='validate'||!io||busy||message.sequence!==sequence+1)throw new DataError('data_invalid_protocol');
        if(++sequence>DATA_BUDGET.ioCalls)throw new DataError('data_io_budget');
        const request=validateIo(message.request);busy=true;
        const input=request.operation==='read_text'?{...request,operation:'read' as const}:request;
        if('encoding' in input)delete input.encoding;
        let value=await io.execute(input,ioAbort.signal);if(settled||signal.aborted)return;
        value=dataJson(value,6*1024*1024,DATA_BUDGET.chunkBytes+8192);
        ioBytes+=request.operation!=='list'&&object(value)&&Array.isArray(value.data)?value.data.length:new TextEncoder().encode(JSON.stringify(value)).length;
        if(ioBytes>DATA_BUDGET.ioBytes)throw new DataError('data_io_budget');
        if(request.operation==='read_text'){
          exact(value,['data','offset','size','revision']);
          if(!Array.isArray(value.data)||value.data.length>request.length||value.data.some(n=>!Number.isInteger(n)||(n as number)<0||(n as number)>255)
            ||value.offset!==request.offset||!Number.isSafeInteger(value.size)||(value.size as number)<request.offset+value.data.length||typeof value.revision!=='string')throw new DataError('data_invalid_output');
          const key=`${request.path}\0${request.encoding??'utf-8'}`;
          let stream=decoders.get(key);
          if(request.offset===0||!stream){stream={decoder:new TextDecoder(request.encoding??'utf-8',{fatal:true}),offset:request.offset,revision:value.revision};decoders.set(key,stream);}
          if(stream.offset!==request.offset||stream.revision!==value.revision)throw new DataError('data_file_changed');
          stream.offset+=value.data.length;const eof=stream.offset===value.size;
          const text=stream.decoder.decode(new Uint8Array(value.data as number[]),{stream:!eof});
          if(eof)decoders.delete(key);if(decoders.size>16)throw new DataError('data_io_budget');
          value={text,offset:request.offset,bytesRead:value.data.length,size:value.size as number,revision:value.revision,eof};
        }
        busy=false;worker.postMessage({protocol:1,id,type:'io_result',sequence,value});
      })().catch(error=>finish(undefined,error));
    };
    try{worker.postMessage({protocol:1,id,type:'start',invocation});}catch(error){finish(undefined,error);}
  });
}
