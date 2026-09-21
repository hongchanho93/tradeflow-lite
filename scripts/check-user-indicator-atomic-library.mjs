import test from 'node:test';
import assert from 'node:assert/strict';
import { UserIndicatorLibrary, UserIndicatorLibraryError } from '../src/user-indicator-runtime/library.ts';
import { validateUserIndicatorSource } from '../src/user-indicator-runtime/validator-engine.ts';

class Store {
  records=new Map(); swaps=0;
  async list(){return [...this.records.values()].map(v=>structuredClone(v));}
  async get(id){return structuredClone(this.records.get(id)??null);}
  async put(record){this.records.set(record.id,structuredClone(record));}
  async delete(id){this.records.delete(id);}
  async compareAndSwap(id,expected,record){
    if((this.records.get(id)?.sourceHash??null)!==expected)throw new UserIndicatorLibraryError('stale_import_preview','concurrent update');
    this.swaps++;if(record)this.records.set(id,structuredClone(record));else this.records.delete(id);
  }
}
const source=v=>`defineIndicator({formatVersion:1,apiVersion:1,id:'user.atomic',indicatorVersion:${v},name:'Atomic',inputs:{},supports:{seriesKinds:['ohlcv']},create(){return {update(){}}}});`;
const setup=()=>{const store=new Store();return {store,library:new UserIndicatorLibrary(store,{validator:validateUserIndicatorSource})};};
const prepare=(library,v)=>library.prepareImport('atomic.tfi',new TextEncoder().encode(source(v)));
test('production-capable stores use atomic comparison for import instead of read-then-write',async()=>{
  const {store,library}=setup();const a=await prepare(library,1),b=await prepare(library,2);
  const results=await Promise.allSettled([library.install(a),library.install(b)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(store.swaps,1);assert.equal((await library.get('user.atomic')).indicatorVersion,1);
});
test('conditional restore returns the exact previous version and refuses to overwrite a newer import',async()=>{
  const {library}=setup();const before=(await library.install(await prepare(library,1))).record;
  const installed=(await library.install(await prepare(library,2),{replace:true})).record;
  await library.replaceExact(before.id,installed.sourceHash,before);assert.equal((await library.get(before.id)).source,before.source);
  const third=(await library.install(await prepare(library,3),{replace:true})).record;
  await assert.rejects(library.replaceExact(before.id,installed.sourceHash,before),error=>error.code==='stale_import_preview');
  assert.equal((await library.get(before.id)).sourceHash,third.sourceHash);
});
test('conditional deletion and import compensation never remove a changed record',async()=>{
  const {library}=setup();const first=(await library.install(await prepare(library,1))).record;
  await library.replaceExact(first.id,first.sourceHash,null);assert.equal(await library.get(first.id),null);
  await library.replaceExact(first.id,null,first);assert.equal((await library.get(first.id)).sourceHash,first.sourceHash);
  const second=(await library.install(await prepare(library,2),{replace:true})).record;
  await assert.rejects(library.replaceExact(first.id,first.sourceHash,null),error=>error.code==='stale_import_preview');
  assert.equal((await library.get(first.id)).sourceHash,second.sourceHash);
});
