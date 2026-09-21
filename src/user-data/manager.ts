import { CapabilityError, type AsyncToolTransaction, type ToolExecutionContext, type JsonValue } from '../ai-capabilities/contracts.ts';
import type { CapabilityOwner } from '../ai-capabilities/registry.ts';
import { DataError, DataValidationError, dataError, type ConnectorManifest, type SourceInfo, type DataIo, type DataValidationStage } from './contracts.ts';
import type { SourceChange, UserDataNative } from './native-client.ts';
import { runConnector, type ConnectorClientOptions } from './runtime-client.ts';
import { ConnectorProvider, EmptyConnectorHistory, UnsupportedConnectorHistory } from './provider.ts';
import { createConnectorQueryTool } from './query-tool.ts';
import type { MarketSymbolKind } from '../market-universe.ts';

export interface DataSourceView extends SourceInfo { readonly status:string;readonly errorCode?:string;readonly toolName?:string;readonly manifest?:ConnectorManifest }
export interface ValidatedConnector {readonly sourceId:string;readonly revision:string;readonly source:string;readonly manifest:ConnectorManifest;
  readonly preview:{readonly symbolCount:number;readonly rowCount:number;readonly stage:'sample_catalog'|'sample_history';
    readonly symbol?:string;readonly kind?:MarketSymbolKind;readonly resolution:string;readonly adjustment:string;readonly unsupportedReason?:string}}
type Mounted={info:SourceInfo;view:DataSourceView;source?:string;owner?:CapabilityOwner;provider?:ConnectorProvider;query?:ReturnType<typeof createConnectorQueryTool>};
export class UserDataManager {
  readonly #native:UserDataNative;readonly #createOwner:(id:string)=>CapabilityOwner;readonly #options:ConnectorClientOptions;
  readonly #records=new Map<string,Mounted>();readonly #listeners=new Set<()=>void>();readonly #validated=new WeakSet<ValidatedConnector>();
  readonly #busy=new Set<string>();readonly #lifetime=new AbortController();readonly #finishes=new Set<Promise<void>>();
  #initialization:Promise<void>|undefined;#closed=false;#picking=false;
  constructor(native:UserDataNative,createOwner:(id:string)=>CapabilityOwner,options:ConnectorClientOptions={}){this.#native=native;this.#createOwner=createOwner;this.#options=options;}
  #check():void{if(this.#closed)throw new DataError('data_closed');}
  async initialize():Promise<void>{
    this.#check();
    this.#initialization??=(async()=>{for(const info of await this.#native.list()){this.#check();await this.#mount(info);}})();
    try{await this.#initialization;this.#check();}catch(error){this.#initialization=undefined;throw dataError(error);}
  }
  list():readonly DataSourceView[]{return Object.freeze([...this.#records.values()].map(r=>r.view));}
  info(sourceId:string):SourceInfo{this.#check();const r=this.#records.get(sourceId);if(!r)throw new DataError('data_unavailable');return r.info;}
  subscribe(listener:()=>void):()=>void{this.#listeners.add(listener);return()=>{this.#listeners.delete(listener);};}
  #emit():void{for(const listener of this.#listeners){try{listener();}catch{/* Observer code cannot roll back committed native state. */}}}
  async #retire(id:string):Promise<void>{
    const record=this.#records.get(id);if(!record)return;
    record.query?.close();record.query=undefined;record.provider=undefined;const owner=record.owner;record.owner=undefined;
    record.view=Object.freeze({...record.info,status:'updating'});this.#emit();
    if(owner)await owner.dispose();
  }
  async #mount(info:SourceInfo,prepared?:ValidatedConnector,strict=false):Promise<void>{
    this.#check();
    await this.#retire(info.id);this.#check();
    const record:Mounted={info,view:Object.freeze({...info,status:info.state==='ready'?(info.hasConnector?'loading':'needs_connector'):info.state})};
    this.#records.set(info.id,record);this.#emit();
    if(info.state!=='ready'||!info.hasConnector)return;
    try{
      const source=await this.#native.source(info);this.#check();if(source===null)throw new DataError('data_connector_missing');
      const manifest=prepared&&this.#validated.has(prepared)&&prepared.source===source?prepared.manifest:
        (await runConnector({source,operation:'validate'},null,this.#lifetime.signal,this.#options)).manifest;
      this.#check();
      const provider=new ConnectorProvider(info,source,manifest,this.#native.io(info),this.#options);
      const query=createConnectorQueryTool(info,provider);record.query=query;record.provider=provider;
      const owner=this.#createOwner(`data_${info.id}`);record.owner=owner;
      const descriptor=owner.register(query.definition);
      record.source=source;record.view=Object.freeze({...info,status:'connected',manifest,toolName:descriptor.wireName});this.#emit();
    }catch(error){
      record.query?.close();record.query=undefined;record.provider=undefined;
      if(record.owner){const owner=record.owner;record.owner=undefined;await owner.dispose();}
      record.view=Object.freeze({...info,status:'error',errorCode:error instanceof CapabilityError?error.code:dataError(error).code});this.#emit();
      if(strict||this.#closed)throw error;
    }
  }
  async #reload(id:string,prepared?:ValidatedConnector,strict=false):Promise<void>{
    this.#check();const all=await this.#native.list();this.#check();const info=all.find(r=>r.id===id);
    if(info)await this.#mount(info,prepared,strict);else{await this.#retire(id);this.#records.delete(id);this.#emit();}
  }
  async pick(replacementId?:string):Promise<SourceInfo|null>{
    await this.initialize();await this.idle();this.#check();if(this.#picking||replacementId&&this.#busy.has(replacementId))throw new DataError('data_busy');
    this.#picking=true;if(replacementId)this.#busy.add(replacementId);
    try{
      // Retire before an existing grant can be replaced inside the native picker
      // callback. Otherwise a cached tool reply could escape during IPC delivery.
      if(replacementId)await this.#retire(replacementId);
      const result=await this.#native.pick(replacementId);this.#check();
      if(result)await this.#mount(result);else if(replacementId)await this.#reload(replacementId);
      return result;
    }catch(error){if(replacementId&&!this.#closed)await this.#reload(replacementId);throw dataError(error);}
    finally{this.#picking=false;if(replacementId)this.#busy.delete(replacementId);}
  }
  async read(sourceId:string,request:DataIo,signal:AbortSignal):Promise<JsonValue>{
    await this.initialize();const info=this.info(sourceId);if(info.state!=='ready'||this.#busy.has(sourceId))throw new DataError('data_unavailable');
    return this.#native.io(info).execute(request,AbortSignal.any([signal,this.#lifetime.signal]));
  }
  async source(sourceId:string):Promise<string|null>{await this.initialize();return this.#native.source(this.info(sourceId));}
  /** Host-only borrowed read port. It cannot authorize a path or survive source retirement. */
  connector(sourceId:string):{provider:ConnectorProvider;manifest:ConnectorManifest;revision:string;name:string}{
    this.#check();const record=this.#records.get(sourceId);
    if(!record?.provider||!record.view.manifest||record.view.status!=='connected'||this.#busy.has(sourceId)||record.provider.signal.aborted)throw new DataError('data_unavailable');
    return {provider:record.provider,manifest:record.view.manifest,revision:record.info.revision,name:record.info.name};
  }
  async validate(sourceId:string,source:string,signal:AbortSignal):Promise<ValidatedConnector>{
    await this.initialize();const info=this.info(sourceId);if(info.state!=='ready'||this.#busy.has(sourceId))throw new DataError('data_unavailable');
    const scope=AbortSignal.any([signal,this.#lifetime.signal]);
    const staged=(stage:DataValidationStage,error:unknown):never=>{
      const value=dataError(error);
      throw new DataValidationError(value.code,stage,{path:value.path,reason:value.reason,expected:value.expected,failureDetail:value.failureDetail});
    };
    const manifest:ConnectorManifest=await (async()=>{try{return (await runConnector({source,operation:'validate'},null,scope,this.#options)).manifest;}
      catch(error){return staged('validate',error);}})();
    const provider=new ConnectorProvider(info,source,manifest,this.#native.io(info),this.#options);
    let symbolCount=0,rowCount=0,unsupportedReason:string|undefined,first:{symbol:string;kind:MarketSymbolKind}|undefined;
    const resolution=manifest.supports.resolutions[0],adjustment=manifest.supports.adjustments[0];
    try{
      const catalog:{symbols:{symbol:string;kind:MarketSymbolKind}[]}=await (async()=>{try{return await provider.catalog({limit:5},scope) as {symbols:{symbol:string;kind:MarketSymbolKind}[]};}
        catch(error){return staged('sample_catalog',error);}})();
      symbolCount=catalog.symbols.length;first=catalog.symbols[0];
      if(first){try{const history=await provider.execute({operation:'history',providerId:provider.providerId,symbol:first.symbol,kind:first.kind,
        resolution,adjustment:adjustment as 'none'|'qfq',count:2},scope) as {bars?:unknown[];points?:unknown[]};
        rowCount=(history.bars??history.points??[]).length;}catch(error){
          if(error instanceof UnsupportedConnectorHistory)unsupportedReason=error.reasonCode;
          else if(!(error instanceof EmptyConnectorHistory))staged('sample_history',error);
        }}
    }finally{provider.close();}
    this.#check();if(scope.aborted)staged('finalize',new DataError('data_cancelled'));if(this.info(sourceId).revision!==info.revision)staged('finalize',new DataError('data_conflict'));
    const prepared=Object.freeze({sourceId,revision:info.revision,source,manifest,preview:Object.freeze({symbolCount,rowCount,
      stage:first?'sample_history' as const:'sample_catalog' as const,...(first?{symbol:first.symbol,kind:first.kind}:{}),resolution,adjustment,
      ...(unsupportedReason?{unsupportedReason}:{})})});
    this.#validated.add(prepared);return prepared;
  }
  async prepareChange(sourceId:string,revision:string,change:SourceChange,context:ToolExecutionContext,validated?:ValidatedConnector):Promise<AsyncToolTransaction>{
    await this.initialize();await this.idle();context.checkpoint();
    const info=this.info(sourceId);if(this.#busy.has(sourceId))throw new DataError('data_busy');if(info.revision!==revision)throw new DataError('data_conflict');
    if(change.kind==='connector'&&change.source!==null&&(!validated||!this.#validated.has(validated)||validated.sourceId!==sourceId||validated.revision!==revision||validated.source!==change.source))throw new DataError('data_validation_required');
    this.#busy.add(sourceId);
    let ticket;
    try{ticket=await this.#native.prepare(info,change);context.checkpoint();this.#check();}
    catch(error){this.#busy.delete(sourceId);if(ticket){try{await this.#native.rollback(ticket.ticketId);}finally{await this.#native.finish(ticket.ticketId);}}throw dataError(error);}
    const prepared=ticket;let disposed=false;
    return {
      result:{...prepared.result},
      commit:async()=>{
        context.checkpoint();this.#check();await this.#retire(sourceId);context.checkpoint();
        const result=await this.#native.commit(prepared.ticketId);
        if(JSON.stringify(result)!==JSON.stringify(prepared.result))throw new DataError('data_invalid_output');
        await this.#reload(sourceId,validated,true);context.checkpoint();return undefined;
      },
      rollback:async()=>{
        await this.#retire(sourceId);
        // Real native recovery errors deliberately propagate to the common
        // transaction core as rollback_failed, not success/tool_changed.
        await this.#native.rollback(prepared.ticketId);if(!this.#closed)await this.#reload(sourceId,undefined,true);return undefined;
      },
      dispose:()=>{
        if(disposed)return;disposed=true;
        const finish=this.#native.finish(prepared.ticketId).catch(error=>{
          const record=this.#records.get(sourceId);if(record){record.view=Object.freeze({...record.view,errorCode:dataError(error).code});this.#emit();}
        }).finally(()=>{this.#busy.delete(sourceId);this.#finishes.delete(finish);});this.#finishes.add(finish);
      },
    };
  }
  async idle():Promise<void>{await Promise.all([...this.#finishes]);}
  async close():Promise<void>{
    if(this.#closed)return;this.#closed=true;this.#lifetime.abort();
    await Promise.all([...this.#records.keys()].map(id=>this.#retire(id)));await this.idle();this.#listeners.clear();
  }
}
