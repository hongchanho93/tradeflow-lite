import { DATA_BUDGET, DataError, dataJson, exact, object, type ConnectorManifest, type SourceInfo, type DataIoPort } from './contracts.ts';
import type { HistoryQuery, MarketQuery, MarketQueryPort } from '../ai-capabilities/market-query.ts';
import { runConnector, type ConnectorClientOptions } from './runtime-client.ts';
import type { JsonValue } from '../ai-capabilities/contracts.ts';
import { copyHistory, MARKET_RESULT_LIMITS } from '../ai-capabilities/market-data.ts';
import { isCanonicalMarketSymbol } from '../market-universe.ts';
export interface ConnectorCatalogQuery { limit:number;cursor?:string }
export type ConnectorHistoryQuery=HistoryQuery&{cursor?:string};
export class EmptyConnectorHistory extends DataError {
  readonly nextCursor?:string;
  constructor(nextCursor?:string){super('data_empty');this.nextCursor=nextCursor;}
}
export class UnsupportedConnectorHistory extends DataError {
  readonly reasonCode:string;
  constructor(reasonCode:string){
    super('data_history_unsupported',{path:'history.unsupported',reason:'unsupported_source_data',
      expected:'a supported history response or a lowercase reason code',failureDetail:reasonCode});
    this.reasonCode=reasonCode;
  }
}
const outputError=(path:string,reason:string,expected:string):never=>{throw new DataError('data_invalid_output',{path,reason,expected});};
function exactOutput(value:unknown,allowed:readonly string[],required:readonly string[],path:string):asserts value is Record<string,unknown>{
  if(!object(value))outputError(path,'type_mismatch','object');
  const record=value as Record<string,unknown>;
  const extra=Object.keys(record).find(key=>!allowed.includes(key));
  if(extra)outputError(`${path}.${extra}`,'unexpected_field',`one of: ${allowed.join(', ')}`);
  const missing=required.find(key=>!Object.hasOwn(record,key));
  if(missing)outputError(`${path}.${missing}`,'required_field_missing','required field');
}
function cursor(value:unknown):string|undefined {
  if(value===undefined||value===null)return undefined;
  if(typeof value!=='string'||!value||value.length>4096)throw new DataError('data_invalid_cursor');return value;
}
export class ConnectorProvider implements MarketQueryPort {
  readonly providerId:string;
  readonly #source:string;readonly #manifest:ConnectorManifest;readonly #io:DataIoPort;readonly #options:ConnectorClientOptions;
  readonly #lifetime=new AbortController();
  constructor(info:SourceInfo,source:string,manifest:ConnectorManifest,io:DataIoPort,options:ConnectorClientOptions={}) {
    this.providerId=`user_data_${info.id}`;this.#source=source;this.#manifest=manifest;this.#io=io;this.#options=options;
  }
  async #run(operation:'catalog'|'history',input:JsonValue,signal:AbortSignal):Promise<JsonValue>{
    const result=await runConnector({source:this.#source,operation,input,expectedManifest:this.#manifest},this.#io,
      AbortSignal.any([signal,this.#lifetime.signal]),this.#options);
    if(result.value===undefined)outputError('connector.result','required_value_missing','a Connector result value');return result.value as JsonValue;
  }
  async catalog(query:ConnectorCatalogQuery,signal:AbortSignal):Promise<JsonValue>{
    exact(query,['limit','cursor'],['limit']);
    if(!Number.isInteger(query.limit)||query.limit<1||query.limit>DATA_BUDGET.pageRows)throw new DataError('data_invalid_request');
    cursor(query.cursor);
    const raw=await this.#run('catalog',dataJson(query),signal);
    exactOutput(raw,['symbols','nextCursor'],['symbols'],'catalog');
    const rawSymbols=raw.symbols;
    if(!Array.isArray(rawSymbols))outputError('catalog.symbols','type_mismatch','array');
    const symbolItems=rawSymbols as readonly JsonValue[];
    if(symbolItems.length>query.limit)outputError('catalog.symbols','max_items_exceeded',`at most query.limit (${query.limit}) symbols`);
    const seen=new Set<string>();
    const symbols=symbolItems.map((item,index)=>{
      const path=`catalog.symbols[${index}]`;exactOutput(item,['symbol','name','kind'],['symbol','name','kind'],path);
      const symbol=item.symbol,name=item.name,kind=item.kind;
      if(typeof symbol!=='string')outputError(`${path}.symbol`,'type_mismatch','string');
      const symbolText=symbol as string;
      if(!isCanonicalMarketSymbol(symbolText))outputError(`${path}.symbol`,'invalid_symbol','canonical VENUE:CODE symbol');
      if(!this.#manifest.supports.venues.includes(symbolText.split(':')[0]))outputError(`${path}.symbol`,'unsupported_venue',`one of: ${this.#manifest.supports.venues.join(', ')}`);
      if(seen.has(symbolText))outputError(`${path}.symbol`,'duplicate_symbol','unique symbols per catalog page');
      if(typeof name!=='string'||!name||name.length>256)outputError(`${path}.name`,'invalid_text','non-empty text up to 256 characters');
      const nameText=name as string;
      if(typeof kind!=='string'||!this.#manifest.supports.kinds.includes(kind))outputError(`${path}.kind`,'unsupported_value',`one of: ${this.#manifest.supports.kinds.join(', ')}`);
      const kindText=kind as string;
      seen.add(symbolText);return {providerId:this.providerId,symbol:symbolText,name:nameText,kind:kindText};
    });
    const nextCursor=cursor(raw.nextCursor);
    if(nextCursor!==undefined&&nextCursor===query.cursor)throw new DataError('data_cursor_stalled');
    return {symbols,...(nextCursor===undefined?{}:{nextCursor})};
  }
  async execute(input:MarketQuery,signal:AbortSignal):Promise<unknown>{
    if(input.operation!=='history')throw new DataError('data_capability_not_implemented');
    const query=input as MarketQuery&ConnectorHistoryQuery;
    if(query.providerId!==this.providerId||!isCanonicalMarketSymbol(query.symbol)||!this.#manifest.supports.venues.includes(query.symbol.split(':')[0])
      ||!this.#manifest.supports.kinds.includes(query.kind)||!this.#manifest.supports.resolutions.includes(query.resolution)
      ||!this.#manifest.supports.adjustments.includes(query.adjustment)||!Number.isInteger(query.count)||query.count<1||query.count>MARKET_RESULT_LIMITS.rows)throw new DataError('data_invalid_request');
    cursor(query.cursor);
    const raw=await this.#run('history',{symbol:query.symbol,kind:query.kind,resolution:query.resolution,adjustment:query.adjustment,count:query.count,
      ...(query.cursor===undefined?{}:{cursor:query.cursor})},signal);
    if(object(raw)&&Object.hasOwn(raw,'unsupported')){
      exactOutput(raw,['unsupported'],['unsupported'],'history');
      if(typeof raw.unsupported!=='string'||!/^[a-z][a-z0-9._-]{0,95}$/.test(raw.unsupported))
        outputError('history.unsupported','invalid_reason_code','lowercase reason code matching ^[a-z][a-z0-9._-]{0,95}$');
      throw new UnsupportedConnectorHistory(raw.unsupported as string);
    }
    exactOutput(raw,['symbol','seriesKind','bars','points','nextCursor'],['seriesKind'],'history');
    if(raw.symbol!==undefined&&raw.symbol!==query.symbol)outputError('history.symbol','symbol_mismatch',query.symbol);
    const nextCursor=cursor(raw.nextCursor);
    if(nextCursor!==undefined&&nextCursor===query.cursor)throw new DataError('data_cursor_stalled');
    const probability=raw.seriesKind==='probability';
    if(!probability&&raw.seriesKind!=='ohlcv')outputError('history.seriesKind','unsupported_value','ohlcv or probability');
    if(probability&&query.kind!=='prediction')outputError('history.seriesKind','kind_mismatch','probability only for prediction symbols');
    const rows=probability?raw.points:raw.bars;
    const other=probability?raw.bars:raw.points;
    if(!Array.isArray(rows))outputError(probability?'history.points':'history.bars','type_mismatch','array');
    const rowItems=rows as JsonValue[];
    if(other!==undefined&&(!Array.isArray(other)||other.length))outputError(probability?'history.bars':'history.points','mutually_exclusive','omit the unused row array');
    if(!rowItems.length)throw new EmptyConnectorHistory(nextCursor);
    const history={symbol:query.symbol,seriesKind:raw.seriesKind,diagnostics:{source:this.providerId},
      ...(probability?{points:rowItems}:{bars:rowItems}),...(nextCursor===undefined?{}:{nextCursor})};
    // Reuse the same OHLCV/probability, ordering, units and row geometry contract
    // as native providers; guest-only extra fields never become Market Data.
    const copied=copyHistory(history,query);
    return {...history,...(probability?{points:copied.rows}:{bars:copied.rows})};
  }
  close():void{this.#lifetime.abort();}
  /** Trusted consumers may bind work to this exact mounted implementation. */
  get signal():AbortSignal{return this.#lifetime.signal;}
}
