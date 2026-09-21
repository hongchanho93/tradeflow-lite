import test from 'node:test';
import assert from 'node:assert/strict';
import { AiConversationHistoryStore } from '../src/ai-api/history.ts';
import { NativeWorkspacePort } from '../src/workspace-persistence.ts';

function fixture() {
  const entries = new Map();
  const invoke = async (command, args = {}) => {
    if (command === 'workspace_state_load') return Object.fromEntries(entries);
    if (command === 'workspace_state_set') { entries.set(args.key, args.value); return; }
    if (command === 'workspace_state_remove') { entries.delete(args.key); return; }
    if (command === 'workspace_state_compare_exchange') {
      const current = entries.get(args.key) ?? null;
      if (current !== args.expected) return false;
      if (args.value === null) entries.delete(args.key); else entries.set(args.key, args.value);
      return true;
    }
    throw Error('unexpected command '+command);
  };
  return { entries, store: new AiConversationHistoryStore(new NativeWorkspacePort(invoke)) };
}

const snapshot = text => ({
  messages: [
    { role: 'user', text },
    { role: 'tool', text: 'tf_context_get · ok', toolTitle: '读取图表上下文' },
    { role: 'assistant', text: '完成' },
  ],
  usage: { inputTokens: 10, outputTokens: 4 },
});

test('conversation history is native-only, ordered by update time and reloadable', async () => {
  const f = fixture(), first = crypto.randomUUID(), second = crypto.randomUUID();
  await f.store.save({ id:first,title:'第一段',createdAt:10,updatedAt:20,snapshot:snapshot('一') });
  await f.store.save({ id:second,title:'第二段',createdAt:11,updatedAt:30,snapshot:snapshot('二') });
  assert.deepEqual((await f.store.list()).map(row=>row.id),[second,first]);
  assert.equal((await f.store.load(first)).snapshot.messages[0].text,'一');
  assert.ok([...f.entries.keys()].every(key=>key.startsWith('tradeflow-lite.native.')));
});

test('updating a conversation keeps one index row and deleting it removes both record and index entry', async () => {
  const f = fixture(), id = crypto.randomUUID();
  await f.store.save({ id,title:'原题',createdAt:10,updatedAt:20,snapshot:snapshot('旧') });
  await f.store.save({ id,title:'新题',createdAt:10,updatedAt:40,snapshot:snapshot('新') });
  const list=await f.store.list();assert.equal(list.length,1);assert.equal(list[0].title,'新题');
  assert.equal((await f.store.load(id)).snapshot.messages[0].text,'新');
  await f.store.remove(id);assert.deepEqual(await f.store.list(),[]);assert.equal(await f.store.load(id),null);
});

test('corrupt history index or record is quarantined instead of becoming executable state', async () => {
  const f=fixture(),id=crypto.randomUUID();
  f.entries.set('tradeflow-lite.native.ai-conversations-index.v1','{broken');
  assert.deepEqual(await f.store.list(),[]);
  f.entries.set('tradeflow-lite.native.ai-conversation.v1.'+id,JSON.stringify({id,title:'bad',createdAt:1,updatedAt:2,snapshot:{messages:[{role:'system',text:'bad'}],usage:{inputTokens:0,outputTokens:0}}}));
  assert.equal(await f.store.load(id),null);
});
