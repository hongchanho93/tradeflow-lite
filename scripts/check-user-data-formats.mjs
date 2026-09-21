import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIo } from '../src/user-data/contracts.ts';
import { runConnector } from '../src/user-data/runtime-client.ts';
import { dataWorkerFactory } from './user-data-fixtures.mjs';
import { createUserDataNative } from '../src/user-data/native-client.ts';
import { readFileSync } from 'node:fs';
import { USER_DATA_GUIDE } from '../src/user-data/guide.ts';
const active = () => new AbortController().signal;
test('Parquet reference rejects missing or boolean times rather than inventing an epoch',async()=>{
  for(const time of [null,true,false,'','   ']){
    const io={async execute(){return {columns:['time','open','high','low','close','volume'],types:['INT64','DOUBLE','DOUBLE','DOUBLE','DOUBLE','INT64'],
      rows:[[time,1,2,1,2,10]],revision:'f1',offset:0,totalRows:1,truncated:false};}};
    await assert.rejects(runConnector({source:USER_DATA_GUIDE.parquetExample,operation:'history',input:{symbol:'SH:600000',count:1}},
      io,active(),{workerFactory:dataWorkerFactory}),`invalid time ${JSON.stringify(time)} must not turn into a bar`);
  }
});
test('SQLite and Parquet requests use the existing relative-path I/O contract', () => {
  assert.deepEqual(validateIo({operation:'sqlite',path:'a.db',sql:'SELECT ?1',parameters:[2],limit:10}),
    {operation:'sqlite',path:'a.db',sql:'SELECT ?1',parameters:[2],limit:10});
  assert.deepEqual(validateIo({operation:'parquet',path:'sub/a.parquet',offset:0,limit:10,columns:['time','close']}),
    {operation:'parquet',path:'sub/a.parquet',offset:0,limit:10,columns:['time','close']});
});
test('Parquet reference preserves legitimate zero, negative and exact tagged nanosecond timestamps',async()=>{
  for(const [time,type,expected] of [[0,'INT64',0],['1700000000','BYTE_ARRAY',1700000000],
    [{type:'integer',value:'1700000000000000123'},'Timestamp(NANOS)',1700000000],
    [{type:'integer',value:'-1'},'Timestamp(NANOS)',-1]]){
    const io={async execute(){return {columns:['time','open','high','low','close','volume'],types:[type,'DOUBLE','DOUBLE','DOUBLE','DOUBLE','INT64'],
      rows:[[time,1,2,1,2,10]],revision:'f1',offset:0,totalRows:1,truncated:false};}};
    const result=await runConnector({source:USER_DATA_GUIDE.parquetExample,operation:'history',input:{symbol:'SH:600000',count:1}},
      io,active(),{workerFactory:dataWorkerFactory});
    assert.equal(result.value.bars[0].time,expected);
  }
});
test('format requests reject path authority, malformed parameters and unbounded windows', () => {
  for (const value of [
    {operation:'sqlite',path:'../a.db',sql:'SELECT 1',parameters:[],limit:1},
    {operation:'sqlite',path:'a.db',sql:'SELECT 1',parameters:[{}],limit:1},
    {operation:'sqlite',path:'a.db',sql:'SELECT 1',parameters:[],limit:12001},
    {operation:'parquet',path:'a.parquet',offset:-1,limit:10},
    {operation:'parquet',path:'a.parquet',offset:0,limit:10,columns:['a','a']},
    {operation:'parquet',path:'a.parquet',offset:0,limit:10,grant:'/tmp'}
  ]) assert.throws(()=>validateIo(value));
});
for (const format of ['sqlite','parquet']) test(`${format} host requests cross the original isolated Worker without filesystem globals`, async()=>{
  const calls=[];
  const source=`defineConnector({formatVersion:1,apiVersion:1,id:'example.formats',version:1,name:'格式检查',
    supports:{venues:['SH'],kinds:['stock'],resolutions:['1D'],adjustments:['none']},
    *listSymbols(q,io){if(typeof fetch!=='undefined'||typeof window!=='undefined')throw Error('ambient');
      return yield io.${format}('data.${format}',${format==='sqlite'?"{sql:'SELECT ?1',parameters:[42],limit:1}":"{offset:0,limit:1,columns:['close']}"});},*getHistory(){return {};}});`;
  const result=await runConnector({source,operation:'catalog',input:{}},{async execute(request){calls.push(request);return {columns:['close'],rows:[[42]],revision:'v1'};}},active(),{workerFactory:dataWorkerFactory});
  assert.equal(calls.length,1);assert.equal(calls[0].operation,format);assert.deepEqual(result.value.rows,[[42]]);
});
const info={id:'1'.repeat(32),revision:'2'.repeat(32),name:'数据',state:'ready',hasConnector:false};
test('native format replies retain exact integer tags and reject malformed or rounded values',async()=>{
  const request={operation:'parquet',path:'a.parquet',offset:0,limit:1};
  const valid={columns:['time'],types:['timestamp(nanos)'],rows:[[{type:'integer',value:'1700000000000000123'}]],revision:'f1',offset:0,totalRows:2,truncated:true,nextOffset:1};
  const port=value=>createUserDataNative(async command=>command==='user_data_begin'?'a'.repeat(32):value).io(info);
  assert.deepEqual((await port(valid).execute(request,active())).rows,valid.rows);
  for(const bad of [{...valid,nextOffset:2},{...valid,rows:[[9007199254740992]]},{...valid,rows:[[{type:'integer',value:'1.2'}]]},
    {...valid,rows:[[1,2]]},{...valid,types:[]},{...valid,locator:'/private'},
    {...valid,rows:[[NaN]]},{...valid,rows:[[{type:'binary',value:'x'}]]}]){
    await assert.rejects(port(bad).execute(request,active()),e=>e.code==='data_invalid_output');
  }
  await assert.rejects(port(valid).execute({...request,fileRevision:'stale'},active()),e=>e.code==='data_invalid_output');
});
test('format SDK, shipped examples, production AI instructions and private desktop entry agree',()=>{
  for(const [name,key] of [['sqlite-daily.tfc','sqliteExample'],['parquet-daily.tfc','parquetExample']])
    assert.equal(readFileSync(new URL('../examples/user-research/'+name,import.meta.url),'utf8').trimEnd(),USER_DATA_GUIDE[key]);
  const system=readFileSync(new URL('../src/ai-api/conversation.ts',import.meta.url),'utf8');
  assert.match(system,/tf_data_sample format=sqlite/);assert.doesNotMatch(system,/SQLite and Parquet decoders[^\n]*not built in yet/);
  for(const term of ['fileRevision','INT96','WAL','BigInt','format="parquet"'])assert.ok(JSON.stringify(USER_DATA_GUIDE).includes(term.replaceAll('"','\\"')));
  const runner=readFileSync(new URL('./run-ai-api-desktop-smoke.mjs',import.meta.url),'utf8');
  assert.match(runner,/createFormatDesktopCases/);assert.match(runner,/formatCases\?\.afterRestart/);
  assert.doesNotMatch(readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),/format_bridge|TF_FORMAT_READY|writeFormatFixtures/);
});
test('SQLite resource limits and cancellation precede even trusted bootstrap SQL',()=>{
  const source=readFileSync(new URL('../src-tauri/src/user_data/formats/sqlite.rs',import.meta.url),'utf8');
  const sql=source.indexOf('connection.execute_batch('),limits=source.indexOf('connection.set_limit('),progress=source.indexOf('connection.progress_handler(');
  assert.ok(sql>=0&&limits>=0&&progress>=0);assert.ok(limits<sql&&progress<sql,'bootstrap SQL must not parse an unbudgeted schema');
});
