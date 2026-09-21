import { CapabilityError, type JsonValue, type ToolDefinition, type ToolExecutionContext, type ValueSchema } from './contracts.ts';
import { objectSchema, countSchema } from './chart-data.ts';
import { MarketResultStore, MARKET_RESULT_LIMITS, object } from './market-data.ts';
import { marketQueryError, type HistoryQuery, type MarketQueryPort, type QuoteQuery } from './market-query.ts';
import { isCanonicalMarketSymbol, type MarketProviderDescriptor } from '../market-universe.ts';
import { isUsableQuote, type QuoteSnapshot } from '../quote.ts';
import { snapshotJson } from './json.ts';

const text: ValueSchema = {type:'string', maxLength:256};
const num: ValueSchema = {type:'number'};
const bool: ValueSchema = {type:'boolean'};
const kind: ValueSchema = {type:'string',enum:['stock','etf','index','crypto','prediction']};
const identity = {providerId:text,symbol:text,kind};
const quoteInput = objectSchema(identity);
const historyInput = objectSchema({...identity,resolution:text,adjustment:{type:'string',enum:['none','qfq']},count:{type:'integer',minimum:2,maximum:MARKET_RESULT_LIMITS.rows}});
const rowSchema = objectSchema({time:num,open:num,high:num,low:num,close:num,volume:num,amount:num,value:num},['time']);
const quoteFields = {last:num,previousClose:num,open:num,high:num,low:num,volume:num,amount:num,receivedAt:num};
const level = objectSchema({price:num,quantity:num});
const quoteSchema = objectSchema({providerId:text,symbol:text,source:text,
  quote:objectSchema({...quoteFields,bids:{type:'array',items:level,maxItems:5},asks:{type:'array',items:level,maxItems:5}},Object.keys(quoteFields)),
  timeUnit:text,priceUnit:text,volumeUnit:text,amountUnit:text,coverage:text});

export interface MarketQueryHost extends MarketQueryPort {
  providers(): Promise<readonly MarketProviderDescriptor[]>;
  watchlist?(): readonly { key: string; symbol: QuoteQuery | null }[];
}

async function orderedQuoteBatch<T>(rows: readonly T[], ctx: ToolExecutionContext,
  run: (row: T) => Promise<JsonValue>): Promise<JsonValue[]> {
  const items: JsonValue[] = new Array(rows.length); let next = 0;
  const worker = async () => {
    while (next < rows.length) { ctx.checkpoint(); const index = next++; items[index] = await run(rows[index]); }
  };
  const completed = await Promise.allSettled([worker(), worker()]);
  ctx.checkpoint();
  for (const result of completed) if (result.status === 'rejected') throw result.reason;
  return items;
}
export function createMarketQueryTools(host: MarketQueryHost, options: { now?: () => number; store?: MarketResultStore } = {}): readonly ToolDefinition[] {
  const store = options.store ?? new MarketResultStore(host, options.now);
  const validate = async (query: QuoteQuery | HistoryQuery, ctx: ToolExecutionContext, history = false) => {
    ctx.checkpoint();
    if (!isCanonicalMarketSymbol(query.symbol)) throw new CapabilityError('invalid_request');
    const providers = await host.providers(); ctx.checkpoint();
    const p = providers.find(p => p.id === query.providerId), c = p?.capabilities;
    if (!p?.enabled || !c || !(history ? c.history : c.quote) || !c.venues.includes(query.symbol.split(':')[0]) || !c.kinds.includes(query.kind)) throw new CapabilityError('field_unavailable');
    if (history && (!c.resolutions.includes((query as HistoryQuery).resolution) || !c.adjustments.includes((query as HistoryQuery).adjustment))) throw new CapabilityError('field_unavailable');
  };
  const fetchQuote = async (query: QuoteQuery, ctx: ToolExecutionContext): Promise<JsonValue> => {
    await validate(query, ctx);
    // UI catalog rows carry display metadata; native requests accept identity only.
    const value = await host.execute({operation:'quote',providerId:query.providerId,symbol:query.symbol,kind:query.kind},ctx.signal); ctx.checkpoint();
    if (!object(value) || value.providerId !== query.providerId || value.symbol !== query.symbol || typeof value.source !== 'string'
      || !object(value.quote) || !isUsableQuote(value.quote as QuoteSnapshot)) throw new CapabilityError('invalid_output');
    const q = value.quote, fields: Record<string, unknown> = {};
    for (const key of Object.keys(quoteFields)) fields[key] = q[key];
    for (const side of ['bids','asks']) if (Array.isArray(q[side])) fields[side] = (q[side] as {price:number;quantity:number}[]).map(v=>({price:v.price,quantity:v.quantity}));
    return snapshotJson({providerId:query.providerId,symbol:query.symbol,source:value.source,quote:fields,
      timeUnit:'unix-seconds',priceUnit:'provider-native',volumeUnit:'unknown',amountUnit:'unknown',coverage:'provider-quote'},64*1024).value;
  };
  const read = <Input,>(id: string, description: string, inputSchema: ValueSchema, outputSchema: ValueSchema,
    run: (input: Input, ctx: ToolExecutionContext) => JsonValue | Promise<JsonValue>, timeoutMs?: number): ToolDefinition => ({
    id:id.startsWith('tf.') ? id : `tf.market.${id}`,version:1,scope:'app',effect:'read',description,inputSchema,outputSchema,...(timeoutMs ? {timeoutMs}:{}),
    async run(input,ctx) { try {ctx.checkpoint();const result=await run(input as Input,ctx);ctx.checkpoint();return result;} catch(error) {throw marketQueryError(error);} },
  });
  return [
    read('history','Query recent history for any supported provider/symbol without changing the chart. Returns an immutable dataset handle, not all rows. Read market.page, then market.release. count is requested, not guaranteed; source coverage and finality are not assumed complete.',historyInput,
      objectSchema({datasetId:text,...identity,resolution:text,adjustment:text,count:countSchema,requestedCount:countSchema,rowCount:countSchema,seriesKind:text,source:text,fromTime:num,toTime:num,capturedAtMs:num,coverage:text,shortfall:bool,timeUnit:text,priceUnit:text,volumeUnit:text,finality:text}),
      async (input:HistoryQuery,ctx)=>{await validate(input,ctx,true);return store.capture(input,ctx);},120_000),
    read('page','Read a page of this session’s independent market dataset. rows contain OHLCV or time/value probability points, never fabricated volume. Does not access the current chart.',
      objectSchema({datasetId:text,offset:countSchema,limit:{type:'integer',minimum:1,maximum:MARKET_RESULT_LIMITS.pageRows}},['datasetId']),
      objectSchema({datasetId:text,seriesKind:text,rows:{type:'array',items:rowSchema,maxItems:MARKET_RESULT_LIMITS.pageRows},offset:countSchema,total:countSchema,nextOffset:countSchema},['datasetId','seriesKind','rows','offset','total']),
      (input:{datasetId:string;offset?:number;limit?:number},ctx)=>store.page(input.datasetId,input.offset??0,input.limit??250,ctx)),
    read('release','Release this session’s independent market dataset when no longer needed. A successful release consumes the temporary handle; repeating release/page for that same id returns snapshot_unavailable. This is expected one-use resource semantics and does not remove user files, charts or saved data.',objectSchema({datasetId:text}),objectSchema({released:bool}),
      (input:{datasetId:string},ctx)=>store.release(input.datasetId,ctx)),
    read('quote','Fetch a current provider quote for one symbol without switching charts. Observation timestamp and source are retained; volume/amount units are not guessed.',quoteInput,quoteSchema,fetchQuote,120_000),
    read('quotes','Fetch an ordered batch of provider quotes using two concurrent queries. Retains duplicate inputs and per-item errors. Request additional batches for more symbols; this is not a total-universe limit.',
      objectSchema({requests:{type:'array',items:quoteInput,maxItems:100}}),
      objectSchema({items:{type:'array',maxItems:100,items:objectSchema({...identity,status:{type:'string',enum:['ok','error']},data:quoteSchema,code:text},['providerId','symbol','kind','status'])}}),
      async (input:{requests:QuoteQuery[]},ctx)=>{
        const items = await orderedQuoteBatch(input.requests, ctx, async q => {
          try { return {...q,status:'ok',data:await fetchQuote(q,ctx)}; }
          catch(error) { ctx.checkpoint(); return {...q,status:'error',code:marketQueryError(error).code}; }
        });
        return {items};
      },120_000),
    ...(host.watchlist ? [read('tf.watchlist.quotes',
      'Fetch fresh quotes for a page of the existing watchlist without switching charts. Preserves order and unresolved entries as explicit errors. Does not present cached prices as fresh data.',
      objectSchema({offset:countSchema,limit:{type:'integer',minimum:1,maximum:100}},[]),
      objectSchema({items:{type:'array',maxItems:100,items:objectSchema({key:text,status:{type:'string',enum:['ok','error']},data:quoteSchema,code:text},['key','status'])},
        total:countSchema,offset:countSchema,nextOffset:countSchema},['items','total','offset']),
      async (input:{offset?:number;limit?:number},ctx) => {
        const rows = host.watchlist!(), offset = input.offset ?? 0, selected = rows.slice(offset, offset + (input.limit ?? 50));
        const items = await orderedQuoteBatch(selected, ctx, async (row): Promise<JsonValue> => {
          if (!row.symbol) return {key:row.key,status:'error',code:'field_unavailable'};
          try { return {key:row.key,status:'ok',data:await fetchQuote(row.symbol,ctx)}; }
          catch(error) { ctx.checkpoint(); return {key:row.key,status:'error',code:marketQueryError(error).code}; }
        });
        return {items,total:rows.length,offset,...(offset + selected.length < rows.length ? {nextOffset:offset + selected.length} : {})};
      },120_000)] : []),
  ];
}
