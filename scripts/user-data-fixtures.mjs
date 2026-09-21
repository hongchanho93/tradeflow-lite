import { Worker } from 'node:worker_threads';
import { validateIo } from '../src/user-data/contracts.ts';
export function dataWorkerFactory(){
  const node=new Worker(new URL('./user-data-node-worker.mjs',import.meta.url));
  const worker={onmessage:null,onerror:null,onmessageerror:null,postMessage:m=>node.postMessage(m),terminate:()=>{void node.terminate();}};
  node.on('message',data=>worker.onmessage?.({data}));node.on('error',e=>worker.onerror?.({message:e.message,preventDefault(){}}));
  node.on('messageerror',()=>worker.onmessageerror?.({}));return worker;
}
export const DATA_CONNECTOR_FIXTURE=`defineConnector({formatVersion:1,apiVersion:1,id:'test.market',version:1,name:'我的行情',
supports:{venues:['SH'],kinds:['stock'],resolutions:['1D'],adjustments:['none']},
*listSymbols(q,io){const r=yield io.list('',q.cursor,q.limit);return {symbols:r.entries.map(e=>({symbol:'SH:600000',name:e.name,kind:'stock'})),nextCursor:r.next};},
*getHistory(q,io){yield io.read('data.csv',0,1);return {seriesKind:'ohlcv',bars:[{time:1,open:1,high:2,low:1,close:2,volume:1}],nextCursor:q.cursor?null:'next'};}});`;
export const dataInfo={id:'1'.repeat(32),revision:'2'.repeat(32),name:'股票数据',state:'ready',hasConnector:true};
export function fakeDataNative(source=DATA_CONNECTOR_FIXTURE){
  let counter=3;const revision=()=>String(counter++).padStart(32,'0');const records=new Map([[dataInfo.id,{info:{...dataInfo},source}]]),tickets=new Map();
  const native={records,tickets,failCommit:false,failRollback:false,ioCalls:[],
    async list(){return [...records.values()].map(r=>({...r.info}));},
    async pick(){return null;},async source(info){const r=records.get(info.id);if(r?.info.revision!==info.revision)throw 'data_conflict';return r.source;},
    io(info){return {async execute(input,signal){const request=validateIo(input);native.ioCalls.push(request);if(signal.aborted)throw 'data_cancelled';
      if(records.get(info.id)?.info.revision!==info.revision)throw 'data_conflict';
      return request.operation==='list'?{entries:[{name:'data.csv',kind:'file'}],next:null}:{data:[1],offset:0,size:1,revision:'file1'};}};},
    async prepare(info,change){const old=records.get(info.id);if(old?.info.revision!==info.revision)throw 'data_conflict';
      if([...tickets.values()].some(t=>t.previous.info.id===info.id))throw 'data_busy';
      const state=change.kind==='connector'?'installed':change.kind==='remove'?'removed':change.enabled?'enabled':'disabled';
      const ticket={ticketId:revision(),result:{sourceId:info.id,revision:revision(),state},previous:structuredClone(old),change,committed:false};tickets.set(ticket.ticketId,ticket);return {ticketId:ticket.ticketId,result:ticket.result};},
    async commit(id){if(native.failCommit)throw 'data_storage_failed';const t=tickets.get(id);if(!t)throw 'data_change_closed';
      if(t.change.kind==='remove')records.delete(t.previous.info.id);
      else{const row=structuredClone(t.previous);row.info.revision=t.result.revision;if(t.change.kind==='enabled')row.info.state=t.change.enabled?'ready':'disabled';
        else{row.source=t.change.source;row.info.hasConnector=!!row.source;}records.set(row.info.id,row);}t.committed=true;return t.result;},
    async rollback(id){if(native.failRollback)throw 'data_storage_failed';const t=tickets.get(id);if(!t)throw 'data_change_closed';
      if(t.committed){const row=structuredClone(t.previous);row.info.revision=revision();records.set(row.info.id,row);}},
    async finish(id){tickets.delete(id);}
  };return native;
}
