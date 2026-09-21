import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkspaceStorage, NativeWorkspacePort, MirroredUserIndicatorStore } from '../src/workspace-persistence.ts';

const read = name => readFile(new URL(name, import.meta.url), 'utf8');

test('core workspace state has an origin-independent native persistence bridge', async () => {
  const main = await read('../src/main.ts');
  const rust = await read('../src-tauri/src/lib.rs');
  assert.match(main, /createWorkspaceStorage/);
  assert.match(main, /workspaceStorage/);
  assert.doesNotMatch(main, /loadWatchlist\(localStorage/);
  assert.doesNotMatch(main, /loadIndicatorState\(\s*localStorage/);
  assert.match(rust, /workspace_state::workspace_state_load/);
  assert.match(rust, /workspace_state::workspace_state_set/);
});

test('user indicator and saved-task libraries have native mirrors instead of depending only on IndexedDB origin', async () => {
  const main = await read('../src/main.ts');
  assert.match(main, /MirroredUserIndicatorStore/);
  assert.match(main, /MirroredUserTaskStore/);
});

test('private desktop runners isolate native workspace state from the user workspace', async () => {
  for (const file of ['run-ai-api-desktop-smoke.mjs','run-ai-mcp-desktop-smoke.mjs','run-ai-desktop-smoke.mjs','run-user-indicator-desktop-smoke.mjs']) {
    const source = await read('./'+file);
    assert.match(source, /TRADEFLOW_WORKSPACE_ROOT/, file);
  }
});

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function nativeFixture(initial = {}) {
  const entries = new Map(Object.entries(initial));
  const invoke = async (command, args = {}) => {
    if (command === 'workspace_state_load') return Object.fromEntries(entries);
    if (command === 'workspace_state_merge') {
      for (const [key,value] of Object.entries(args.entries)) if (!entries.has(key)) entries.set(key,value);
      return;
    }
    if (command === 'workspace_state_set') { entries.set(args.key,args.value); return; }
    if (command === 'workspace_state_remove') { entries.delete(args.key); return; }
    if (command === 'workspace_state_compare_exchange') {
      const current=entries.get(args.key)??null;if(current!==args.expected)return false;
      if(args.value===null)entries.delete(args.key);else entries.set(args.key,args.value);return true;
    }
    throw Error('unexpected command '+command);
  };
  return {entries,invoke};
}

test('first native launch migrates legacy browser state, then native state is authoritative across WebView origins', async () => {
  const browser=new MemoryStorage();browser.setItem('tradeflow-lite.watchlist.v1','browser-watchlist');
  const native=nativeFixture({'tradeflow-lite.indicators.v1':'native-indicators'});
  const storage=await createWorkspaceStorage(native.invoke,browser);
  assert.equal(storage.getItem('tradeflow-lite.indicators.v1'),'native-indicators');
  assert.equal(native.entries.get('tradeflow-lite.watchlist.v1'),'browser-watchlist');
  assert.equal(native.entries.get('tradeflow-lite.native.workspace-ready.v1'),'1');
  storage.setItem('tradeflow-lite.watchlist.v1','changed');await storage.flush();
  assert.equal(native.entries.get('tradeflow-lite.watchlist.v1'),'changed');
  storage.removeItem('tradeflow-lite.watchlist.v1');await storage.flush();
  assert.equal(native.entries.has('tradeflow-lite.watchlist.v1'),false);
  const staleBrowser=new MemoryStorage();staleBrowser.setItem('tradeflow-lite.watchlist.v1','stale-value');
  staleBrowser.setItem('tradeflow-lite.theme.v1','light');
  native.entries.set('tradeflow-lite.theme.v1','dark');
  await createWorkspaceStorage(native.invoke,staleBrowser);
  assert.equal(staleBrowser.getItem('tradeflow-lite.watchlist.v1'),null,'deleted native value must not be resurrected by a stale origin');
  assert.equal(staleBrowser.getItem('tradeflow-lite.theme.v1'),'dark','native value must replace stale origin state');
});
test('native-only indicator/task blobs never spill into localStorage', async () => {
  const browser=new MemoryStorage();
  const native=nativeFixture({
    'tradeflow-lite.native.workspace-ready.v1':'1',
    'tradeflow-lite.native.user-indicators.v1':'[{"id":"large"}]',
    'tradeflow-lite.native.user-tasks.v1':'[{"id":"task"}]',
    'tradeflow-lite.watchlist.v1':'{"version":1,"symbols":[]}',
  });
  await createWorkspaceStorage(native.invoke,browser);
  assert.equal(browser.getItem('tradeflow-lite.native.user-indicators.v1'),null);
  assert.equal(browser.getItem('tradeflow-lite.native.user-tasks.v1'),null);
  assert.ok(browser.getItem('tradeflow-lite.watchlist.v1'));
});
test('an empty fresh WebView does not seal migration before an older origin with real workspace data opens', async () => {
  const native=nativeFixture();
  await createWorkspaceStorage(native.invoke,new MemoryStorage());
  assert.equal(native.entries.has('tradeflow-lite.native.workspace-ready.v1'),false);
  const legacy=new MemoryStorage();
  legacy.setItem('tradeflow-lite.watchlist.v1','legacy-real-watchlist');
  await createWorkspaceStorage(native.invoke,legacy);
  assert.equal(native.entries.get('tradeflow-lite.watchlist.v1'),'legacy-real-watchlist');
  assert.equal(native.entries.get('tradeflow-lite.native.workspace-ready.v1'),'1');
});

test('user indicator library migrates once from legacy IndexedDB and then uses native CAS state', async () => {
  const legacyRecord={id:'fixture',source:'x',sourceHash:'a'.repeat(64),manifest:{},apiVersion:1,indicatorVersion:1,importedAt:1,updatedAt:1,validatorVersion:1};
  let legacy=[legacyRecord];
  const legacyStore={async list(){return legacy;},async get(id){return legacy.find(v=>v.id===id)??null;},async put(record){legacy=[record];},
    async delete(){legacy=[];},async compareAndSwap(){throw Error('native path should be used');},async close(){}};
  const native=nativeFixture(),port=new NativeWorkspacePort(native.invoke);
  const store=new MirroredUserIndicatorStore(legacyStore,port);
  assert.equal((await store.list())[0].id,'fixture');
  legacy=[];
  assert.equal((await store.list())[0].id,'fixture','native copy must survive loss of the origin-scoped legacy store');
  await store.delete('fixture');assert.deepEqual(await store.list(),[]);
});
