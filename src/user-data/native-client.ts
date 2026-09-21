import { DATA_BUDGET, DataError, dataError, dataJson, exact, object, relativePath, validateIo, type SourceInfo, type DataIoPort, type DataIo } from './contracts.ts';
import type { JsonValue } from '../ai-capabilities/contracts.ts';

export type NativeInvoke = <T>(command:string,args?:Record<string,unknown>)=>Promise<T>;
export type SourceChange={kind:'connector';source:string|null}|{kind:'enabled';enabled:boolean}|{kind:'remove'};
export type ChangeReceipt={sourceId:string;revision:string;state:string};
export type ChangeTicket={ticketId:string;result:ChangeReceipt};
export interface UserDataNative {
  list():Promise<SourceInfo[]>;
  pick(replacementId?:string):Promise<SourceInfo|null>;
  source(info:SourceInfo):Promise<string|null>;
  io(info:SourceInfo):DataIoPort;
  prepare(info:SourceInfo,change:SourceChange):Promise<ChangeTicket>;
  commit(ticketId:string):Promise<ChangeReceipt>;
  rollback(ticketId:string):Promise<void>;
  finish(ticketId:string):Promise<void>;
}
const token=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{32}$/.test(value);
function info(value:unknown):SourceInfo {
  exact(value,['id','revision','name','state','hasConnector']);
  if(!token(value.id)||!token(value.revision)||typeof value.name!=='string'||!value.name||value.name.length>256
    ||!['ready','disabled','needs_directory'].includes(value.state as string)||typeof value.hasConnector!=='boolean')throw new DataError('data_invalid_output');
  return Object.freeze(value as unknown as SourceInfo);
}
function receipt(value:unknown):ChangeReceipt {
  exact(value,['sourceId','revision','state']);
  if(!token(value.sourceId)||!token(value.revision)||!['installed','connector_removed','enabled','disabled','removed'].includes(value.state as string))throw new DataError('data_invalid_output');
  return value as unknown as ChangeReceipt;
}
function ioOutput(value:unknown,request:DataIo):JsonValue {
  try{
    if(request.operation==='sqlite'||request.operation==='parquet'){
      exact(value,['columns','types','rows','revision','truncated',...(request.operation==='parquet'?['offset','totalRows','nextOffset']:[])],
        ['columns','types','rows','revision','truncated',...(request.operation==='parquet'?['offset','totalRows']:[])]);
      if(!Array.isArray(value.columns)||value.columns.length>128||value.columns.some(c=>typeof c!=='string'||c.length>256)
        ||!Array.isArray(value.types)||value.types.length!==value.columns.length||value.types.some(t=>typeof t!=='string'||t.length>2048)
        ||!Array.isArray(value.rows)||value.rows.length>request.limit||value.rows.some(r=>!Array.isArray(r)||r.length!==(value.columns as unknown[]).length)
        ||typeof value.truncated!=='boolean'||typeof value.revision!=='string'||!value.revision||value.revision.length>256
        ||(request.fileRevision!==undefined&&request.fileRevision!==value.revision))throw 0;
      const cell=(v:unknown):void=>{
        if(v===null||typeof v==='boolean'||typeof v==='string')return;
        if(typeof v==='number'){if(!Number.isFinite(v)||(Number.isInteger(v)&&!Number.isSafeInteger(v)))throw 0;return;}
        if(!object(v))throw 0;
        exact(v,['type','value']);
        if(!['integer','decimal','binary'].includes(v.type as string)||typeof v.value!=='string')throw 0;
        if(v.type==='integer'&&!/^-?\d+$/.test(v.value))throw 0;
        if(v.type==='binary'&&!/^(?:[0-9a-f]{2})*$/.test(v.value))throw 0;
      };
      for(const row of value.rows)for(const v of row)cell(v);
      if(request.operation==='parquet'){
        if(value.offset!==request.offset||!Number.isSafeInteger(value.totalRows)||(value.totalRows as number)<request.offset+value.rows.length)throw 0;
        const more=request.limit>0&&request.offset+value.rows.length<(value.totalRows as number);
        if(value.truncated!==more||(more?value.nextOffset!==request.offset+value.rows.length:value.nextOffset!==undefined))throw 0;
      }
      return dataJson(value);
    }
    if(request.operation==='list'){
      exact(value,['entries','next']);
      if(!Array.isArray(value.entries)||value.entries.length>request.limit||(value.next!==null&&typeof value.next!=='string'))throw 0;
      let previous=request.after??'';
      const entries=value.entries.map(entry=>{
        exact(entry,['name','kind']);const name=relativePath(entry.name);
        if(name.includes('/')||name<=previous||!['file','directory','link','other'].includes(entry.kind as string))throw 0;previous=name;
        return {name,kind:entry.kind as string};
      });
      if(value.next!==null&&(!entries.length||value.next!==entries.at(-1)!.name))throw 0;
      return {entries,next:value.next as string|null};
    }
    exact(value,['data','offset','size','revision']);
    if(!Array.isArray(value.data)||value.data.length>request.length||value.data.some(n=>!Number.isInteger(n)||n<0||n>255)
      ||value.offset!==request.offset||!Number.isSafeInteger(value.size)||(value.size as number)<request.offset+value.data.length
      ||typeof value.revision!=='string'||!value.revision||value.revision.length>256
      ||(request.fileRevision!==undefined&&request.fileRevision!==value.revision))throw 0;
    return {data:value.data.slice(),offset:value.offset as number,size:value.size as number,revision:value.revision};
  }catch{throw new DataError('data_invalid_output');}
}
export function createUserDataNative(invoke:NativeInvoke):UserDataNative {
  const call=async<T>(name:string,args:Record<string,unknown>={}):Promise<T>=>{
    try{return await invoke<T>(name,args);}catch(error){throw dataError(error);}
  };
  return {
    async list(){const value=await call<unknown>('user_data_list');if(!Array.isArray(value)||value.length>128)throw new DataError('data_invalid_output');
      const rows=value.map(info);if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new DataError('data_invalid_output');return rows;},
    async pick(replacementId){if(replacementId!==undefined&&!token(replacementId))throw new DataError('data_invalid_request');
      const value=await call('user_data_pick',replacementId?{replacementId}:{});return value===null?null:info(value);},
    async source(row){const value=await call<unknown>('user_data_source',{sourceId:row.id,revision:row.revision});
      if(value!==null&&(typeof value!=='string'||new TextEncoder().encode(value).length>DATA_BUDGET.sourceBytes))throw new DataError('data_invalid_output');return value as string|null;},
    io:row=>({async execute(input,signal){
      if(signal.aborted)throw new DataError('data_cancelled');
      const request=validateIo(input);if(request.operation==='read_text')throw new DataError('data_invalid_io');
      let cancel:(()=>void)|undefined;
      try{
        const requestId=await call('user_data_begin',{input:{sourceId:row.id,revision:row.revision,request}});
        if(!token(requestId))throw new DataError('data_invalid_output');let cancelled=false;
        cancel=()=>{if(cancelled)return;cancelled=true;void call('user_data_cancel',{requestId}).catch(()=>{});};
        signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();throw new DataError('data_cancelled');}
        const value=await call('user_data_execute',{requestId});if(signal.aborted)throw new DataError('data_cancelled');
        return ioOutput(value,request);
      }catch(error){cancel?.();throw dataError(error);}finally{if(cancel)signal.removeEventListener('abort',cancel);}
    }}),
    async prepare(row,change){const value=await call('user_data_prepare',{sourceId:row.id,revision:row.revision,change});
      exact(value,['ticketId','result']);if(!token(value.ticketId))throw new DataError('data_invalid_output');
      const result=receipt(value.result);if(result.sourceId!==row.id)throw new DataError('data_invalid_output');return {ticketId:value.ticketId,result};},
    async commit(ticketId){return receipt(await call('user_data_commit',{ticketId}));},
    async rollback(ticketId){await call('user_data_rollback',{ticketId});},
    async finish(ticketId){await call('user_data_finish',{ticketId});},
  };
}
