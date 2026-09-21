import { CapabilityError, type JsonValue, type ToolDefinition, type ValueSchema } from '../ai-capabilities/contracts.ts';
import { objectSchema } from '../ai-capabilities/chart-data.ts';
import { MarketResultStore, MARKET_RESULT_LIMITS } from '../ai-capabilities/market-data.ts';
import { DataError, exact, type SourceInfo } from './contracts.ts';
import { ConnectorProvider, EmptyConnectorHistory, UnsupportedConnectorHistory } from './provider.ts';
import type { MarketSymbolKind } from '../market-universe.ts';

const text=(maxLength=256):ValueSchema=>({type:'string',maxLength});
const integer=(minimum=0,maximum=Number.MAX_SAFE_INTEGER):ValueSchema=>({type:'integer',minimum,maximum});
const number:ValueSchema={type:'number'},bool:ValueSchema={type:'boolean'};
const row=objectSchema({time:integer(-Number.MAX_SAFE_INTEGER),open:number,high:number,low:number,close:number,volume:number,amount:number,value:number},['time']);
const descriptor=objectSchema({datasetId:text(),providerId:text(),symbol:text(),kind:text(),resolution:text(),adjustment:text(),count:integer(),cursor:text(4096),
  requestedCount:integer(),rowCount:integer(),seriesKind:text(),source:text(),fromTime:integer(-Number.MAX_SAFE_INTEGER),toTime:integer(-Number.MAX_SAFE_INTEGER),
  capturedAtMs:integer(),coverage:text(),shortfall:bool,timeUnit:text(),priceUnit:text(),volumeUnit:text(),finality:text(),nextCursor:text(4096)},
  ['datasetId','providerId','symbol','kind','resolution','adjustment','count','requestedCount','rowCount','seriesKind','source','fromTime','toTime',
    'capturedAtMs','coverage','shortfall','timeUnit','priceUnit','volumeUnit','finality']);
export function createConnectorQueryTool(info:SourceInfo,provider:ConnectorProvider) {
  const results=new MarketResultStore(provider);
  const definition:ToolDefinition={
    id:`user.data_${info.id}.query`,version:1,title:`查询我的数据：${info.name.slice(0,80)}`,scope:'app',effect:'read',timeoutMs:120_000,
    description:'Query this explicitly selected local user data source. operation=catalog lists symbols with cursor pagination. history reads an independent standardized market window (provider defines ordering) and returns datasetId/nextCursor. page reads rows from that session-owned dataset; release frees it. History continuation cursor is distinct from dataset page offset. No official database, source-code directory or arbitrary file access.',
    inputSchema:objectSchema({operation:{type:'string',enum:['catalog','history','page','release']},limit:integer(1,1000),cursor:text(4096),symbol:text(130),
      kind:{type:'string',enum:['stock','etf','index','crypto','prediction']},resolution:text(64),adjustment:{type:'string',enum:['none','qfq']},count:integer(1,MARKET_RESULT_LIMITS.rows),datasetId:text(),offset:integer()},['operation']),
    outputSchema:objectSchema({operation:{type:'string',enum:['catalog','history','page','release']},
      symbols:{type:'array',maxItems:512,items:objectSchema({providerId:text(),symbol:text(),name:text(),kind:text()})},nextCursor:text(4096),
      dataset:descriptor,empty:bool,unsupported:bool,reasonCode:text(96),rowCount:integer(),datasetId:text(),seriesKind:text(),rows:{type:'array',maxItems:1000,items:row},offset:integer(),total:integer(),nextOffset:integer(),released:bool,
      errorCode:text(),path:text(256),reason:text(256),expected:text(512),failureDetail:text(512)},['operation']),
    async run(input,ctx):Promise<JsonValue>{
      const v=input as Record<string,JsonValue>;const operation=v.operation as string;
      try{
        ctx.checkpoint();
        if(operation==='catalog'){
          exact(v,['operation','cursor','limit'],['operation']);
          const result=await provider.catalog({limit:(v.limit as number|undefined)??100,...(v.cursor===undefined?{}:{cursor:v.cursor as string})},ctx.signal);
          ctx.checkpoint();return {operation,...result as Record<string,JsonValue>};
        }
        if(operation==='history'){
          exact(v,['operation','symbol','kind','resolution','adjustment','count','cursor'],['operation','symbol','kind','resolution']);
          const dataset=await results.capture({providerId:provider.providerId,symbol:v.symbol as string,kind:v.kind as MarketSymbolKind,
            resolution:v.resolution as string,adjustment:(v.adjustment as 'none'|'qfq'|undefined)??'none',count:(v.count as number|undefined)??500,
            ...(v.cursor===undefined?{}:{cursor:v.cursor as string})},ctx);
          return {operation,dataset};
        }
        if(operation==='page'){
          exact(v,['operation','datasetId','offset','limit'],['operation','datasetId']);
          return {operation,...results.page(v.datasetId as string,(v.offset as number|undefined)??0,(v.limit as number|undefined)??100,ctx) as Record<string,JsonValue>};
        }
        exact(v,['operation','datasetId']);
        return {operation,...results.release(v.datasetId as string,ctx) as Record<string,JsonValue>};
      }catch(error){
        ctx.checkpoint();
        if(error instanceof EmptyConnectorHistory)return {operation,empty:true,rowCount:0,...(error.nextCursor===undefined?{}:{nextCursor:error.nextCursor})};
        if(error instanceof UnsupportedConnectorHistory)return {operation,unsupported:true,errorCode:error.code,reasonCode:error.reasonCode};
        if(error instanceof CapabilityError)throw error;
        if(error instanceof DataError)return {operation,errorCode:error.code,...(error.path?{path:error.path}:{}),...(error.reason?{reason:error.reason}:{}),
          ...(error.expected?{expected:error.expected}:{}),...(error.failureDetail?{failureDetail:error.failureDetail}:{})};
        throw new CapabilityError('tool_failed');
      }
    },
  };
  return {definition,close(){provider.close();results.close();}};
}
