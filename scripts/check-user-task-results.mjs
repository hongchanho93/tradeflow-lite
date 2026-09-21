import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskResultStore } from '../src/user-task/results.ts';
import { taskJson, validateTaskManifest, TASK_LIMITS } from '../src/user-task/contracts.ts';
import { TASK_SYMBOL } from './user-task-fixtures.mjs';
const outputs=[{id:'table',title:'结果',type:'table',columns:[{id:'symbol',title:'品种',type:'symbol'},{id:'n',title:'值',type:'number'},{id:'note',title:'说明',type:'string'}]},
  {id:'symbols',title:'品种',type:'symbol_list'},{id:'series',title:'序列',type:'series'},{id:'report',title:'说明',type:'report'}];
const store=()=>new TaskResultStore(validateTaskManifest({formatVersion:1,apiVersion:1,id:'test.result',version:1,name:'test',history:[{id:'d',resolution:'1D',count:2,adjustment:'none'}],outputs}).outputs);
test('a mixed invalid batch cannot partially append to any artifact',()=>{
  const s=store();assert.throws(()=>s.append([{artifactId:'symbols',rows:[TASK_SYMBOL]},{artifactId:'table',rows:[[TASK_SYMBOL,'not number','']]}]));
  assert.equal(s.page('symbols').total,0);assert.equal(s.bytes,0);
});
test('series ordering is checked across batches and within repeated artifact contributions',()=>{
  const s=store();s.append([{artifactId:'series',rows:[{time:10,value:1}]}]);
  assert.throws(()=>s.append([{artifactId:'series',rows:[{time:11,value:2}]},{artifactId:'series',rows:[{time:10,value:3}]}]));
  assert.equal(s.page('series').total,1);assert.throws(()=>s.append([{artifactId:'series',rows:[{time:12,value:NaN}]}]));
});
test('paging sorting and filtering never reorder stored results or leak mutable references',()=>{
  const s=store();const original=[{artifactId:'table',rows:[[TASK_SYMBOL,2,'second'],[TASK_SYMBOL,1,'first'],[TASK_SYMBOL,3,'third']]}];s.append(original);original[0].rows[0][1]=99;
  const page=s.page('table',{sortBy:'n',descending:true,limit:1});assert.equal(page.rows[0][1],3);assert.equal(page.nextOffset,1);
  assert.equal(page.pageUnit,'rows');assert.equal(page.complete,false);
  assert.equal(s.page('table').rows[0][1],2);assert.equal(s.page('table',{filter:'first'}).matched,1);
  assert.equal(s.page('table',{filter:'测试品种'}).matched,3);
  assert.throws(()=>{page.rows[0][1]=0;});assert.throws(()=>s.page('table',{limit:10000}));assert.throws(()=>s.page('table',{sortBy:'bad'}));
});
test('report paging is bounded without concatenating the whole report on every read',()=>{
  const s=store();s.append([{artifactId:'report',text:'中文abcd'},{artifactId:'report',text:'EFGH'}]);
  const p=s.page('report',{offset:3,limit:4});assert.equal(p.text,'bcdE');assert.equal(p.nextOffset,7);assert.equal(p.total,10);
  assert.equal(p.pageUnit,'characters');assert.equal(p.complete,false);
  assert.equal(s.page('report',{offset:7,limit:10}).complete,true);
});
test('result byte budget rejects the whole new batch and keeps earlier data',()=>{
  const s=store();s.append([{artifactId:'report',text:'first'}]);const before=s.bytes;
  assert.throws(()=>s.append([{artifactId:'report',text:'long new data'}],before+1),e=>e.code==='task_result_limit');assert.equal(s.page('report').text,'first');
});
test('CSV output escapes quotes, newlines and spreadsheet formulas; JSON stays data',()=>{
  const s=store();s.append([{artifactId:'table',rows:[[TASK_SYMBOL,-2,' =HYPERLINK("bad")'],[TASK_SYMBOL,1,'<script>bad</script>\n中文']]}]);
  const csv=s.export('table','csv');assert.match(csv,/' =HYPERLINK\(""bad""\)/);assert.match(csv,/"-2"/);
  const json=JSON.parse(s.export('table','json'));assert.equal(json.rows[1][2],'<script>bad</script>\n中文');
});
test('plain-data cloning rejects getters, nonfinite values, cycles and prototype keys',()=>{
  let called=false;assert.throws(()=>taskJson({get data(){called=true;return 1;}}));assert.equal(called,false);
  for(const value of [{n:Infinity},JSON.parse('{"__proto__":{}}'),{toJSON(){called=true;return{};}}])assert.throws(()=>taskJson(value));assert.equal(called,false);
  const cycle={};cycle.self=cycle;assert.throws(()=>taskJson(cycle));
  assert.throws(()=>taskJson('中文'.repeat(10),20),e=>e.code==='task_output_limit');
});
test('release invalidates all artifact handles',()=>{
  const s=store();s.append([{artifactId:'symbols',rows:[TASK_SYMBOL]}]);s.close();assert.equal(s.bytes,0);assert.throws(()=>s.page('symbols'));assert.throws(()=>s.append([]));
});
test('at least 5000 result rows are supported without expanding ordinary tool messages',()=>{
  const s=store();for(let offset=0;offset<5127;offset+=100)s.append([{artifactId:'symbols',rows:Array.from({length:Math.min(100,5127-offset)},(_,i)=>({...TASK_SYMBOL,symbol:'SH:'+String(offset+i).padStart(6,'0')}))}]);
  const p=s.page('symbols',{offset:5000,limit:127});assert.equal(p.total,5127);assert.equal(p.rows.length,127);assert.ok(s.bytes<TASK_LIMITS.resultBytes);
});
