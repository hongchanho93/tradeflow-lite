import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UserTaskController } from '../src/user-task/controller.ts';
import { userTaskPageMarkup } from '../src/user-task/page.ts';
import { UserTaskManager } from '../src/user-task/manager.ts';
import { UserTaskLibrary } from '../src/user-task/library.ts';
import { createSavedTaskTool } from '../src/user-task/tools.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { renderTaskResult } from '../src/user-task/viewer.ts';
import { TASK_FIXTURE, TASK_SYMBOL, TASK_BATCH, taskWorkerFactory } from './user-task-fixtures.mjs';

class Element {
  children=[];events=new Map();dataset={};attributes={};hidden=false;disabled=false;value='';textContent='';files=[];checked=false;style={};
  classList={add(){},remove(){},toggle(){}};
  constructor(tagName='div',id=''){this.tagName=tagName;this.id=id;}
  set innerHTML(_){throw Error('Untrusted data must not be rendered as HTML');}
  append(...nodes){for(const n of nodes){n.parentNode=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
  setAttribute(k,v){this.attributes[k]=v;} removeAttribute(k){delete this.attributes[k];}
  addEventListener(k,fn){this.events.set(k,fn);}
  fire(k){this.events.get(k)?.({target:this,preventDefault(){},stopPropagation(){}});}
  click(){if(!this.disabled)this.fire('click');} focus(){document.activeElement=this;}
  querySelector(s){return this.nodes?.get(s.slice(1))??null;}
  querySelectorAll(s){return flatten(this).filter(n=>s.split(',').includes(n.tagName));}
}
const flatten=node=>node.children.flatMap(n=>[n,...flatten(n)]);
async function until(predicate){const deadline=performance.now()+6000;while(!predicate()){if(performance.now()>deadline)throw Error('task UI timed out');await new Promise(r=>setTimeout(r,2));}}
async function fixture(overrides={}){
  const previous=globalThis.document;globalThis.document={documentElement:{lang:'zh-CN'},activeElement:null,createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag),body:new Element('body')};
  const root=new Element();root.nodes=new Map();
  for(const match of userTaskPageMarkup().matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){const e=new Element(match[1],match[2]);e.hidden=/\bhidden\b/.test(match[0]);root.nodes.set(e.id,e);}
  for(const id of ['api-task-open','api-chat-page','api-settings-page','user-data-page','api-prompt','api-data-open'])root.nodes.set(id,new Element('button',id));
  root.nodes.get('user-task-universe').value='catalog';
  const records=new Map(),registry=new CapabilityRegistry([]);let calls=0;
  const source={providerId:'test',name:'合成数据',revision:'1',signal:new AbortController().signal,catalogScope:'loaded-symbols',
    async catalog(){return {symbols:[TASK_SYMBOL,{...TASK_SYMBOL,symbol:'SH:600001'},{...TASK_SYMBOL,symbol:'SH:600002'}]};},
    async history(){calls++;return TASK_BATCH.history.daily;},close(){},...overrides};
  const manager=new UserTaskManager({async acquire(){return source;}},{workerFactory:taskWorkerFactory});
  let library;const toolHost={manager,library:()=>library,watchlist:()=>[TASK_SYMBOL]};
  library=new UserTaskLibrary(manager,{async list(){return structuredClone([...records.values()]);},async close(){},async compareAndSwap(id,expected,record){
    if((records.get(id)?.revision??null)!==expected)throw Error('conflict');if(record)records.set(id,structuredClone(record));else records.delete(id);
  }},id=>registry.createOwner(id),(v,id,s)=>createSavedTaskTool(toolHost,v,id,s));
  const prompts=[],opened=[],added=[],downloads=[];
  const host={manager:()=>manager,library:()=>library,appInstanceId:()=> 'task-ui-test',compose:text=>prompts.push(text),watchlist:()=>[TASK_SYMBOL],
    async sources(){return [{providerId:'test',name:'测试行情',venues:['SH'],kinds:['stock'],resolutions:['1D'],adjustments:['none'],local:false,catalogScope:'loaded-symbols'}];},
    async prepareOpen(symbol){return {result:{},async commit(){opened.push(symbol);},async rollback(){opened.pop();},dispose(){}};},
    async prepareWatchlist(symbols){return {result:{},async commit(){added.push(...symbols);},async rollback(){added.splice(-symbols.length);},dispose(){}};},
    download:(filename,text)=>downloads.push({filename,text})};
  const controller=new UserTaskController(root,host);await controller.initialize();
  const get=id=>root.nodes.get(id),action=(container,name)=>flatten(get(container)).find(n=>n.dataset.action===name);
  return {root,get,action,manager,library,registry,records,prompts,opened,added,downloads,controller,host,get calls(){return calls;},
    idle:()=>until(()=>get('user-task-page').dataset.busy!=='true'),
    async close(){controller.close();await library.close();await manager.close();globalThis.document=previous;}};
}
const file=source=>({name:'研究任务.tft',size:new TextEncoder().encode(source).length,async arrayBuffer(){return new TextEncoder().encode(source).buffer;}});
test('private desktop task definition identity cannot replace the acceptance RPC correlation ID',()=>{
  const cases=readFileSync(new URL('./user-task-desktop-cases.mjs',import.meta.url),'utf8'),probe=readFileSync(new URL('./user-task-desktop-probe.txt',import.meta.url),'utf8');
  const runner=readFileSync(new URL('./run-ai-api-desktop-smoke.mjs',import.meta.url),'utf8');
  assert.match(cases,/taskDefinitionId:saved.id/);assert.match(probe,/r.id === command.taskDefinitionId/);
  assert.doesNotMatch(probe,/r.id === command.id\b/);assert.match(runner,/queue.push\(\{\.\.\.input,id,action\}\)/);
});
async function importTask(f,source=TASK_FIXTURE){f.get('user-task-file').files=[file(source)];f.get('user-task-file').fire('change');await f.idle();}
async function runTask(f){await importTask(f);f.get('user-task-start').click();await f.idle();const id=f.manager.list().at(-1)?.taskId;assert.ok(id,f.get('user-task-status').textContent);await f.manager.wait(id);return id;}
test('task page is separate from chat/settings and file validation does not start data reads',async()=>{
  const f=await fixture();try{f.get('api-task-open').click();await f.idle();assert.equal(f.get('user-task-page').hidden,false);assert.equal(f.get('api-chat-page').hidden,true);
    await importTask(f);assert.equal(f.get('user-task-setup').hidden,false);assert.equal(f.calls,0);assert.equal(f.manager.list().length,0);
    assert.ok(flatten(f.get('user-task-parameters')).some(n=>n.dataset.parameter==='minimum'));
    f.get('user-task-back').click();assert.equal(f.get('api-chat-page').hidden,false);
  }finally{await f.close();}
});
test('ordinary run renders real results and distinguishes short windows from execution success',async()=>{
  const f=await fixture();try{const id=await runTask(f);assert.equal(f.manager.status(id).state,'completed');assert.equal(f.manager.status(id).shortfallSymbols,3);
    assert.equal(f.get('user-task-result').hidden,false);assert.equal(f.get('user-task-result-body').children[0].tagName,'table');
    assert.match(f.get('user-task-result-state').textContent,/3/);assert.match(f.get('user-task-result-state').textContent,/已加载|loaded/);
  }finally{await f.close();}
});
test('oversized imports are rejected before reading bytes and hung validation can be cancelled',async()=>{
  const f=await fixture();try{let read=0;f.get('user-task-file').files=[{name:'big.tft',size:262145,async arrayBuffer(){read++;}}];f.get('user-task-file').fire('change');await f.idle();assert.equal(read,0);
    f.get('user-task-file').files=[file('while(true){}')];f.get('user-task-file').fire('change');await until(()=>f.get('user-task-page').dataset.busy==='true');f.get('user-task-abort').click();await f.idle();
    assert.equal(f.get('user-task-setup').hidden,true);assert.equal(f.calls,0);await runTask(f);
  }finally{await f.close();}
});
test('save, restore for rerun, and remove reuse the same dynamic task library',async()=>{
  const f=await fixture();try{await runTask(f);f.action('user-task-runs','save').click();await f.idle();assert.equal(f.registry.describe().length,1);
    f.action('user-task-library','run').click();await f.idle();assert.equal(f.get('user-task-setup').hidden,false);assert.equal(f.calls,3);
    f.action('user-task-library','remove').click();await f.idle();assert.equal(f.registry.describe().length,0);assert.equal(f.records.size,0);
  }finally{await f.close();}
});
test('explicit AI handoff drafts one-use result access, never sends the full table or a model request',async()=>{
  const f=await fixture();try{const id=await runTask(f);f.get('user-task-share').click();assert.equal(f.prompts.length,1);assert.match(f.prompts[0],/tf\.task\.claim/);assert.doesNotMatch(f.prompts[0],/600000|close|volume/);
    assert.equal(f.get('api-chat-page').hidden,false);assert.equal(f.manager.status(id).state,'completed');
  }finally{await f.close();}
});
test('exports stay local and symbol actions explicitly use the corresponding business ports',async()=>{
  const f=await fixture();try{await runTask(f);f.get('user-task-json').click();assert.equal(f.downloads.length,1);assert.equal(JSON.parse(f.downloads[0].text).rows.length,3);assert.equal(f.prompts.length,0);
    f.action('user-task-result-body','open-symbol').click();await f.idle();assert.equal(f.opened[0].providerId,'test');
    f.get('user-task-watchlist').click();await f.idle();assert.equal(f.added.length,3);assert.equal(f.manager.list().length,1);
  }finally{await f.close();}
});
test('result filter/sort and report rendering never interpret HTML or script content',async()=>{
  const f=await fixture();try{await runTask(f);f.get('user-task-filter').value='does-not-exist';f.get('user-task-apply-filter').click();assert.match(f.get('user-task-result-body').children[0].textContent,/暂无/);
    const target=new Element();renderTaskResult(target,{artifactId:'r',type:'report',title:'r',total:1,matched:1,offset:0,rows:[],text:'<script>alert(1)</script>'},{routes:()=>[],open(){},watchlist(){}});
    assert.equal(target.children[0].tagName,'pre');assert.equal(target.children[0].textContent,'<script>alert(1)</script>');
    renderTaskResult(target,{artifactId:'s',type:'series',title:'s',total:1,matched:1,offset:0,rows:[{time:1,value:1e308}]},{routes:()=>[],open(){},watchlist(){}});
    assert.ok(flatten(target).some(n=>n.tagName==='circle'));assert.ok(flatten(target).every(n=>!Object.values(n.attributes).some(v=>/NaN|Infinity/.test(v))));
  }finally{await f.close();}
});
test('UI cancellation stays visible until pending I/O really exits, then preserves partial status',async()=>{
  let settle,notify;const entered=new Promise(r=>notify=r);
  const f=await fixture({history(){notify();return new Promise(r=>settle=r);}});try{await importTask(f);f.get('user-task-start').click();await f.idle();await entered;const id=f.manager.list()[0].taskId;
    f.action('user-task-runs','cancel').click();assert.equal(f.manager.status(id).state,'cancelling');settle(TASK_BATCH.history.daily);await f.manager.wait(id);assert.equal(f.manager.status(id).state,'cancelled');
    assert.match(f.get('user-task-result-state').textContent,/不完整|未完成|已停止/);
  }finally{settle?.(TASK_BATCH.history.daily);await f.close();}
});
test('task runtime stays wired but the ordinary chat header hides the standalone task page entry',()=>{
  const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),page=readFileSync(new URL('../src/ai-api/page.ts',import.meta.url),'utf8');
  assert.match(main,/new UserTaskController/);assert.equal((main.match(/createUserTaskTools\(getUserTaskToolHost\(\)\)/g)??[]).length,2);
  assert.match(page,/id="api-task-open"[^>]*hidden/);assert.match(page,/userTaskPageMarkup\(\)/);assert.match(main,/userTaskController\.close\(\)/);
  const invalidate=main.slice(main.indexOf('function invalidateAiChartSessions'),main.indexOf('function describeAiChartTools'));assert.doesNotMatch(invalidate,/userTaskManager.*close/);
});
for (const [filename, artifactId] of [['window-breakout.tft', 'table'], ['sma-backtest.tft', 'summary']]) {
  test(`P6 shipped ${filename} imports through ordinary UI, renders symbols, opens a routed chart and saves`, async () => {
    const source = readFileSync(new URL(`../examples/user-research/${filename}`, import.meta.url), 'utf8');
    const rows = [10, 11, 12, 13, 14].map((close, i) => ({ time: 1704067200 + i * 86400,
      open: close, high: close, low: close, close, volume: 100 }));
    const f = await fixture({ async history() { return { rows, seriesKind: 'ohlcv', requestedCount: 120,
      shortfall: true, coverage: 'provider-returned-window', finality: 'unknown' }; } });
    try {
      await importTask(f, source);
      assert.equal(f.get('user-task-setup').hidden, false);
      assert.ok(flatten(f.get('user-task-parameters')).some(n => /根数/.test(n.dataset.parameter ?? '')));
      f.get('user-task-start').click(); await f.idle();
      const id = f.manager.list().at(-1)?.taskId; assert.ok(id, f.get('user-task-status').textContent);
      await f.manager.wait(id); assert.equal(f.manager.status(id).state, 'completed');
      assert.equal(f.manager.page(id, artifactId).total, 3);
      assert.equal(f.get('user-task-result-body').children[0].tagName, 'table');
      f.action('user-task-result-body', 'open-symbol').click(); await f.idle();
      assert.equal(f.opened[0].providerId, 'test'); assert.equal(f.opened[0].symbol, TASK_SYMBOL.symbol);
      f.get('user-task-json').click(); assert.equal(JSON.parse(f.downloads[0].text).rows.length, 3);
      f.action('user-task-runs', 'save').click(); await f.idle(); assert.equal(f.registry.describe().length, 1);
      assert.equal(f.prompts.length, 0);
    } finally { await f.close(); }
  });
}
