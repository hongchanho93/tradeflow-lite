import test from 'node:test';
import assert from 'node:assert/strict';
import { CSV_CONNECTOR_SOURCE } from '../src/user-data/csv-example.ts';
import { runConnector } from '../src/user-data/runtime-client.ts';
import { ConnectorProvider } from '../src/user-data/provider.ts';
import { dataWorkerFactory,dataInfo } from './user-data-fixtures.mjs';
const signal=()=>new AbortController().signal;
function filesIo(files,maxChunk=65536){const calls=[];return {calls,async execute(q,s){if(s.aborted)throw 'data_cancelled';calls.push(q);
  if(q.operation==='list'){const names=Object.keys(files).sort().filter(n=>!q.after||n>q.after),slice=names.slice(0,q.limit);return {entries:slice.map(name=>({name,kind:'file'})),next:names.length>slice.length?slice.at(-1):null};}
  const bytes=new TextEncoder().encode(files[q.path]);if(q.fileRevision&&q.fileRevision!=='f1')throw 'data_file_changed';const data=[...bytes.slice(q.offset,q.offset+Math.min(q.length,maxChunk))];
  return {data,offset:q.offset,size:bytes.length,revision:'f1'};
}};}
async function provider(io){const {manifest}=await runConnector({source:CSV_CONNECTOR_SOURCE,operation:'validate'},null,signal(),{workerFactory:dataWorkerFactory});
 return new ConnectorProvider(dataInfo,CSV_CONNECTOR_SOURCE,manifest,io,{workerFactory:dataWorkerFactory});}
const header='time,open,high,low,close,volume,name\r\n';
test('CSV reference reads quoted multiline Unicode across byte-chunk boundaries',async()=>{
  const io=filesIo({'SH_600000.csv':'\uFEFF'+header+'1,1,3,1,2,100,"中文\n换行"\r\n2,2,4,1,3,200,"引号""内容"\r\n'},2),p=await provider(io);
  try{const c=await p.catalog({limit:10},signal());assert.equal(c.symbols[0].symbol,'SH:600000');
    const h=await p.execute({operation:'history',providerId:p.providerId,symbol:'SH:600000',kind:'stock',resolution:'1D',adjustment:'none',count:2},signal());
    assert.equal(h.bars.length,2);assert.equal(h.bars[1].volume,200);assert.equal(io.calls.filter(q=>q.operation==='read').every(q=>q.length<=65536),true);
  }finally{p.close();}
});
test('symbol catalog and history use separate continuation cursors without modifying files',async()=>{
  const body=header+Array.from({length:7},(_,i)=>`${i+1},1,3,1,2,10,test`).join('\n');
  const files={'SH_600000.csv':body,'SZ_000001.csv':body,'README.txt':'not market data'},before=JSON.stringify(files),p=await provider(filesIo(files));
  try{let cursor;const symbols=[];do{const c=await p.catalog({limit:1,...(cursor?{cursor}:{})},signal());symbols.push(...c.symbols);cursor=c.nextCursor;}while(cursor);
    assert.equal(symbols.length,2);const rows=[];cursor=undefined;
    do{const h=await p.execute({operation:'history',providerId:p.providerId,symbol:'SH:600000',kind:'stock',resolution:'1D',adjustment:'none',count:2,...(cursor?{cursor}:{})},signal());rows.push(...h.bars);cursor=h.nextCursor;}while(cursor);
    assert.deepEqual(rows.map(r=>r.time),[1,2,3,4,5,6,7]);assert.equal(JSON.stringify(files),before);
  }finally{p.close();}
});
test('unsupported CSV shape is rejected, not filled with invented prices or volume',async()=>{
  for(const body of ['time,close\n1,10','time,open,high,low,close,volume\n1,1,0,1,2,1',header+'1,1,3,1,2,,name']){
    const p=await provider(filesIo({'SH_600000.csv':body}));try{await assert.rejects(p.execute({operation:'history',providerId:p.providerId,symbol:'SH:600000',kind:'stock',resolution:'1D',adjustment:'none',count:2},signal()));}finally{p.close();}
  }
});
test('range TextDecoder exposes raw bytesRead rather than counting Unicode characters',async()=>{
  const source=`defineConnector({formatVersion:1,apiVersion:1,id:'test.text',version:1,name:'文本',supports:{venues:['SH'],kinds:['stock'],resolutions:['1D'],adjustments:['none']},
  *listSymbols(q,io){let offset=0,text='';while(true){const part=yield io.readText('a',offset,2);text+=part.text;offset+=part.bytesRead;if(part.eof)return {text,offset};}},*getHistory(){return {};}});`;
  const result=await runConnector({source,operation:'catalog',input:{}},filesIo({a:'中文🙂'},2),signal(),{workerFactory:dataWorkerFactory});
  assert.deepEqual(result.value,{text:'中文🙂',offset:10});
});
