/** Built-in and external MCP assistants share one explicit user grant model.
 * All services and data here are synthetic. */
import assert from 'node:assert/strict';
import { McpConnection } from '../src/ai-mcp/session.ts';
import { CapabilityCore, CapabilityRegistry } from '../src/ai-capabilities/index.ts';
import { AiApiController } from '../src/ai-api/controller.ts';
import { apiPageMarkup } from '../src/ai-api/page.ts';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate) {
  const end = performance.now() + 2000;
  while (!predicate()) {
    if (performance.now() >= end) throw Error('assistant access test timed out');
    await tick();
  }
}
const chartWrites = ['tf.drawings.apply', 'tf.drawings.apply_existing', 'tf.drawings.revert', 'tf.drawings.revert_saved'];
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const numeric = schema({ n: { type: 'number' } });
function fixture(extraWrite = false) {
  let context = { appInstanceId: 'assistant-access-test', chartId: 'main', provider: 'tdx', instrument: 'SH:600000',
    resolution: '1D', adjustment: 'none', selectionGeneration: 1 };
  const commits = []; let permissions;
  const registry = new CapabilityRegistry([
    { id: 'tf.chart.snapshot', version: 1, description: 'Synthetic chart', effect: 'read', inputSchema: schema({}),
      outputSchema: numeric, run: () => ({ n: 1 }) },
    ...[...chartWrites, ...(extraWrite ? ['tf.future.write'] : [])].map(id => ({
      id, version: 1, description: 'Synthetic transactional write', effect: 'write', inputSchema: numeric,
      outputSchema: numeric, run: () => { throw Error('raw writes are forbidden'); },
      prepare: input => ({ result: { n: input.n }, commit: () => { commits.push(id); }, rollback: () => { commits.pop(); } }),
    })),
  ]);
  const core = new CapabilityCore(registry);
  const host = { context: () => context, describe: () => registry.describe(), open: grant => {
    permissions = { ...grant }; return core.openSession({ context, currentContext: () => context, permissions: grant });
  } };
  const connection = new McpConnection(host, () => {}, { approvalMs: 1000 });
  const rpc = async (id, method, params = {}) => {
    const raw = await connection.receive(JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }));
    return raw === null ? null : JSON.parse(raw);
  };
  const initialize = async () => {
    await rpc('init', 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    await rpc(undefined, 'notifications/initialized');
  };
  const tool = (id, name, scope = context) => rpc(id, 'tools/call', {
    name: name.replaceAll('.', '_'), arguments: { context: scope, input: name === 'tf.chart.snapshot' ? {} : { n: 1 } },
  });
  return { host, core, connection, commits, rpc, initialize, tool, permissions: () => permissions,
    context: () => context, switch: () => { context = { ...context, selectionGeneration: context.selectionGeneration + 1 }; } };
}
const reply = result => result.result.structuredContent.reply;

test('full chart authorization remains a trusted, initialized, non-closed host operation', async () => {
  const f = fixture();
  assert.throws(() => f.connection.authorizeAssistant(), /authorization/);
  await f.initialize(); assert.equal(f.core.openSessions, 0);
  assert.equal(reply(await f.tool('before', 'tf.chart.snapshot')).code, 'authorization_required');
  f.connection.authorizeAssistant(); assert.equal(f.core.openSessions, 1);
  f.connection.close(); assert.equal(f.core.openSessions, 0);
  f.connection.revoke(); assert.equal(f.connection.view().access, 'closed');
  assert.throws(() => f.connection.authorizeAssistant(), /authorization/);
});

test('the assistant receives every current chart write, including existing drawings, without prompts', async () => {
  const f = fixture(); await f.initialize(); f.connection.authorizeAssistant();
  try {
    assert.equal(f.permissions()['tf.chart.snapshot'], 'allow');
    for (const name of chartWrites) {
      assert.equal(f.permissions()[name], 'allow');
      const result = await f.tool(name, name);
      assert.equal(reply(result).status, 'ok');
      assert.equal(f.connection.view().approvals.length, 0);
      assert.deepEqual(await f.tool(name, name), result);
    }
    assert.deepEqual(f.commits, chartWrites); // Duplicate IDs must not write twice.
  } finally { f.connection.close(); }
});

test('external JSON-RPC cannot self-authorize, but one trusted UI authorization grants all exposed business writes', async () => {
  const f = fixture(); await f.initialize();
  try {
    for (const method of ['authorizeAssistant', 'authorize', 'assistant/authorize']) {
      assert.equal((await f.rpc(method, method, { mode: 'workbench', assistant: true })).error.code, -32601);
    }
    const forged = await f.rpc('forged', 'tools/call', { name: 'tf_drawings_apply_existing',
      arguments: { context: f.context(), input: { n: 1 } }, _meta: { assistant: true, approved: true } });
    assert.equal(reply(forged).code, 'authorization_required'); assert.equal(f.core.openSessions, 0);
    f.connection.authorize('analysis');
    assert.equal(f.permissions()['tf.drawings.apply_existing'], 'allow');
    assert.equal(reply(await f.tool('authorized', 'tf.drawings.apply_existing')).status, 'ok');
    assert.deepEqual(f.commits, ['tf.drawings.apply_existing']);
    assert.equal(f.connection.view().approvals.length, 0);
  } finally { f.connection.close(); }
});

test('external MCP has no per-operation approval after the one user authorization', async () => {
  const f = fixture(); await f.initialize(); f.connection.authorize('workbench');
  try {
    assert.equal(f.permissions()['tf.drawings.apply_existing'], 'allow');
    assert.equal(reply(await f.tool('existing', 'tf.drawings.apply_existing')).status, 'ok');
    assert.deepEqual(f.commits, ['tf.drawings.apply_existing']);
    assert.equal(f.connection.view().approvals.length, 0);
  } finally { f.connection.close(); }
});

test('future registered business writes inherit the existing one-time authorization', async () => {
  const f = fixture(true); await f.initialize(); f.connection.authorize('assist');
  assert.equal(f.permissions()['tf.future.write'], 'allow');
  f.connection.close();
});

test('full access still rejects ABA contexts and invalid arguments before modifying a drawing', async () => {
  const f = fixture(); await f.initialize(); f.connection.authorizeAssistant();
  try {
    const invalid = await f.rpc('invalid', 'tools/call', { name: 'tf_drawings_apply_existing',
      arguments: { context: f.context(), input: { n: 1, approved: true } } });
    assert.equal(invalid.error.code, -32602);
    const old = f.context(); f.switch(); f.switch(); f.connection.invalidate();
    assert.equal(reply(await f.tool('stale', 'tf.drawings.apply_existing', old)).code, 'context_stale');
    assert.deepEqual(f.commits, []); assert.equal(f.core.openSessions, 1);
    assert.equal(reply(await f.tool('current', 'tf.drawings.apply_existing', f.context())).status, 'ok');
  } finally { f.connection.close(); }
});

// Minimal DOM for exercising the actual controller's events, not its source text.
class Element {
  children = []; events = new Map(); dataset = {}; style = {}; attributes = {};
  value = ''; textContent = ''; checked = false; disabled = false; hidden = false; open = false;
  scrollHeight = 100; scrollTop = 0; clientHeight = 100;
  constructor(tag = 'div', id = '') { this.tagName = tag; this.id = id; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { this.events.set(name, listener); }
  fire(name, extra = {}) { this.events.get(name)?.({ target: this, preventDefault() {}, ...extra }); }
  click() { if (!this.disabled) this.fire('click'); }
  focus() {}
  querySelector(selector) { return this.nodes?.get(selector.slice(1)) ?? null; }
  querySelectorAll() { return this.controls ?? []; }
}
function controllerFixture(savedTools = true, options = {}) {
  const root = new Element(); const nodes = new Map(); root.nodes = nodes;
  const markup = apiPageMarkup();
  for (const match of markup.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = new Element(match[1], match[2]);
    node.checked = /\bchecked\b/.test(match[0]); node.hidden = /\bhidden\b/.test(match[0]);
    node.value = /\bvalue="([^"]*)"/.exec(match[0])?.[1] ?? '';
    nodes.set(node.id, node);
  }
  nodes.get('api-preset').value = 'deepseek';
  const form = markup.slice(markup.indexOf('<form'), markup.indexOf('</form>'));
  nodes.get('api-config-form').controls = [...form.matchAll(/<(?:input|select|button)\b[^>]*\bid="([^"]+)"/g)].map(match => nodes.get(match[1]));
  const saved = { revision: 'saved-fixture', hasKey: true, remembered: true, settings: {
    protocol: 'chat', endpoint: 'https://fixture.invalid/api', model: 'fixture', tools: savedTools, stream: true,
    includeUsage: true, chatTokenField: 'max_tokens', maxTokens: 2048, timeoutSeconds: 60, allowLocalHttp: false,
  } };
  const requests = [], configurations = []; let loads = 0;
  const f = fixture();
  const transport = {
    load: async () => { loads++; if (options.load) return options.load(saved); return options.empty ? null : saved; },
    configure: async value => { configurations.push(value); return { ...saved, revision: 'configured', settings: { ...value.settings } }; },
    turn: async (_profile, payload, _signal, partial) => {
      requests.push(payload);
      if (options.turn) return options.turn({ payload, partial, index: requests.length - 1 });
      return { text: 'fixture OK', calls: [], replay: [{ role: 'assistant', content: 'fixture OK' }], usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  const controller = new AiApiController(root, new Element(), f.host, transport, options.history);
  const get = id => nodes.get(id);
  return { controller, root, get, requests, configurations, saved, core: f.core, loads: () => loads,
    input(text) { get('api-prompt').value = text; get('api-prompt').fire('input'); } };
}

test('ordinary settings remove permission, persistence and management layers while keeping MCP inline', () => {
  const markup = apiPageMarkup();
  assert.doesNotMatch(markup, /id="api-mode(?:-hint)?"|id="api-tools"/);
  assert.doesNotMatch(markup, /api-remember|api-consent|连接管理与测试|权限与会话说明|管理外部 AI 连接/);
  assert.match(markup, /id="api-mcp-settings"/);
});
test('startup restores only the saved profile without sending messages or granting tools',async()=>{
  const oldDocument=globalThis.document;globalThis.document={documentElement:{lang:'zh-CN'},createElement:tag=>new Element(tag)};
  let f;
  try{
    f=controllerFixture();await until(()=>f.loads()===1&&!f.get('api-save').disabled);
    assert.equal(f.get('api-model').value,'fixture');assert.equal(f.get('api-key').value,'');
    assert.equal(f.requests.length,0);assert.equal(f.core.openSessions,0);assert.equal(f.configurations.length,0);
    f.get('api-settings-open').click();f.get('api-settings-back').click();assert.equal(f.loads(),1);
  }finally{f?.controller.invalidate();await new Promise(r=>setTimeout(r,60));globalThis.document=oldDocument;}
});
test('completed chats are archived locally, new chat does not erase them, and history can reopen the transcript',async()=>{
  const oldDocument=globalThis.document;globalThis.document={documentElement:{lang:'zh-CN'},createElement:tag=>new Element(tag)};
  const rows=new Map();
  const history={
    async list(){return [...rows.values()].map(({snapshot,...row})=>row).sort((a,b)=>b.updatedAt-a.updatedAt);},
    async save(row){rows.set(row.id,structuredClone(row));},
    async load(id){return rows.get(id)??null;},
  };
  let f;
  try{
    f=controllerFixture(true,{history});await until(()=>f.loads()===1&&!f.get('api-save').disabled);
    f.input('第一段历史问题');f.get('api-send').click();
    await until(()=>f.requests.length===1&&rows.size===1);
    f.get('api-new-chat').click();await until(()=>f.get('api-messages').children.length===0);
    f.get('api-history-open').click();await until(()=>f.get('api-history-page').hidden===false&&f.get('api-history-list').children.length===1);
    f.get('api-history-list').children[0].click();
    await until(()=>f.get('api-chat-page').hidden===false&&f.get('api-messages').children.length>=2);
    assert.equal(f.get('api-messages').children[0].textContent,'第一段历史问题');
  }finally{f?.controller.invalidate();await new Promise(r=>setTimeout(r,60));globalThis.document=oldDocument;}
});
test('an in-flight turn is checkpointed locally before the provider finishes, with partial assistant text marked incomplete',async()=>{
  const oldDocument=globalThis.document;globalThis.document={documentElement:{lang:'zh-CN'},createElement:tag=>new Element(tag)};
  const rows=new Map();let release;
  const history={async list(){return[];},async save(row){rows.set(row.id,structuredClone(row));},async load(){return null;}};
  let f;
  try{
    f=controllerFixture(true,{history,turn:({partial})=>new Promise(resolve=>{
      partial('正在处理但尚未完成');
      release=()=>resolve({text:'最终完成',calls:[],replay:[{role:'assistant',content:'最终完成'}],usage:{inputTokens:1,outputTokens:1}});
    })});
    await until(()=>f.loads()===1&&!f.get('api-save').disabled);f.input('请处理这个长任务');f.get('api-send').click();await until(()=>release);
    await new Promise(r=>setTimeout(r,1150));assert.equal(rows.size,1);
    const record=[...rows.values()][0],messages=record.snapshot.messages;
    assert.equal(messages[0].role,'user');assert.equal(messages[0].text,'请处理这个长任务');
    assert.equal(messages.at(-1).role,'assistant');assert.equal(messages.at(-1).text,'正在处理但尚未完成');assert.equal(messages.at(-1).incomplete,true);
    release();await until(()=>f.requests.length===1&&f.root.dataset.runState==='completed');
  }finally{release?.();f?.controller.invalidate();await new Promise(r=>setTimeout(r,60));globalThis.document=oldDocument;}
});
test('provider overload offers explicit resume in the same chat and does not send the user to Settings',async()=>{
  const oldDocument=globalThis.document;globalThis.document={documentElement:{lang:'zh-CN'},createElement:tag=>new Element(tag)};
  let f;
  try{
    f=controllerFixture(true,{turn:({index})=>{if(index===0)throw Error('provider_overloaded');return {text:'恢复完成',calls:[],replay:[{role:'assistant',content:'恢复完成'}],usage:{inputTokens:1,outputTokens:1}};}});
    await until(()=>f.loads()===1&&!f.get('api-save').disabled);f.input('继续当前任务');f.get('api-send').click();
    await until(()=>f.root.dataset.runState==='provider_overloaded');
    assert.equal(f.get('api-resume').hidden,false);assert.equal(f.get('api-error-settings').hidden,true);
    assert.match(f.get('api-run-status').textContent,/503\/529|繁忙|过载/);
    f.get('api-resume').click();await until(()=>f.root.dataset.runState==='completed');assert.equal(f.requests.length,2);
  }finally{f?.controller.invalidate();await new Promise(r=>setTimeout(r,60));globalThis.document=oldDocument;}
});
test('pending automatic restore prevents late stored data from overwriting user configuration',async()=>{
  const oldDocument=globalThis.document;globalThis.document={documentElement:{lang:'zh-CN'},createElement:tag=>new Element(tag)};
  let f,release;
  try{
    f=controllerFixture(true,{load:()=>new Promise(r=>{release=r;})});await until(()=>release);
    assert.equal(f.get('api-key').disabled,true);assert.equal(f.get('api-save').disabled,true);assert.equal(f.requests.length,0);
    release(null);await until(()=>!f.get('api-save').disabled);
    assert.equal(f.get('api-model').value,'deepseek-flash');
  }finally{release?.(null);f?.controller.invalidate();await new Promise(r=>setTimeout(r,60));globalThis.document=oldDocument;}
});
test('automatic restoration failures stay visible and do not silently save plaintext or send requests',async()=>{
  const oldDocument=globalThis.document;globalThis.document={documentElement:{lang:'zh-CN'},createElement:tag=>new Element(tag)};
  let f;
  try{
    f=controllerFixture(true,{load:async()=>{throw Error('secure_storage_unavailable');}});await until(()=>f.loads()===1&&!f.get('api-save').disabled);
    assert.ok(f.get('api-config-status').textContent.includes('系统凭证库'));assert.equal(f.get('api-key').disabled,false);
    assert.equal(f.requests.length,0);assert.equal(f.configurations.length,0);assert.equal(f.core.openSessions,0);
  }finally{f?.controller.invalidate();await new Promise(r=>setTimeout(r,60));globalThis.document=oldDocument;}
});

test('restored connection is immediately usable without another consent or connect click', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: 'zh-CN' }, createElement: tag => new Element(tag) };
  let f;
  try {
    f = controllerFixture();
    await until(() => f.loads()===1&&!f.get('api-save').disabled);
    assert.equal(f.get('api-model').value, 'fixture');
    assert.equal(f.get('api-endpoint').value, 'https://fixture.invalid/api');
    assert.equal(f.get('api-connect').hidden, true);
    assert.match(f.get('api-empty-hint').textContent,/直接提问/);
    assert.equal(f.get('api-key').value, '');
    assert.equal(f.configurations.length, 0);
    assert.equal(f.requests.length, 0); assert.equal(f.core.openSessions, 0);
    f.input('继续分析'); f.get('api-send').click();
    await until(() => f.root.dataset.runState === 'completed');
    assert.equal(f.requests.length, 1); assert.equal(f.configurations.length, 0);
  } finally {
    f?.controller.invalidate(); await new Promise(resolve => setTimeout(resolve, 60)); globalThis.document = oldDocument;
  }
});

for (const savedTools of [true, false]) {
  test(`restored tools=${savedTools} profile needs no permission UI and still exposes the common tool catalog`, async () => {
    const oldDocument = globalThis.document;
    globalThis.document = { documentElement: { lang: 'zh-CN' }, createElement: tag => new Element(tag) };
    let f;
    try {
      f = controllerFixture(savedTools);
      assert.equal(f.requests.length, 0); assert.equal(f.core.openSessions, 0);
      await until(() => f.loads()===1&&!f.get('api-save').disabled);
      f.input('普通问题');
      if (!savedTools) {
        assert.equal(f.saved.settings.tools,false);
      }
      f.get('api-send').click(); await until(() => f.root.dataset.runState === 'completed');
      assert.equal(f.requests.length, 1); assert.equal(f.core.openSessions, 1);
      assert.ok(f.requests[0].tools.some(t => t.function.name === 'tf_drawings_apply_existing'));
      f.get('api-new-chat').click(); assert.equal(f.core.openSessions, 0); assert.equal(f.requests.length, 1);
    } finally {
      f?.controller.invalidate();
      // Flush the controller's bounded render timer before removing its DOM.
      await new Promise(resolve => setTimeout(resolve, 60)); globalThis.document = oldDocument;
    }
  });
}

let failed = 0;
for (const [name, run] of tests) {
  try { await run(); } catch (error) { failed++; console.error(`FAIL ${name}`, error); }
}
assert.equal(failed, 0, `Assistant access: ${failed}/${tests.length} failed`);
console.log(`AI single-assistant simplified settings: ${tests.length} scenarios passed`);
