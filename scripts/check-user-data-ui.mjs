import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { UserDataController } from '../src/user-data/controller.ts';
import { userDataPageMarkup } from '../src/user-data/page.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { UserDataManager } from '../src/user-data/manager.ts';
import { dataWorkerFactory, DATA_CONNECTOR_FIXTURE, dataInfo, fakeDataNative } from './user-data-fixtures.mjs';

class Element {
  children = []; events = new Map(); dataset = {}; attributes = {}; hidden = false; disabled = false; open = false; value = ''; textContent = ''; files = [];
  constructor(tagName = 'div', id = '') { this.tagName = tagName; this.id = id; }
  set innerHTML(_) { throw new Error('Untrusted data must not enter innerHTML'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.events.set(name, fn); }
  fire(name) { this.events.get(name)?.({ target: this, preventDefault() {}, stopPropagation() {} }); }
  click() { if (!this.disabled) this.fire('click'); }
  focus() { document.activeElement = this; }
  querySelector(selector) { return this.nodes?.get(selector.slice(1)) ?? null; }
  querySelectorAll(selector) { return flatten(this).filter(e => selector.split(',').includes(e.tagName)); }
}
function flatten(node) { return [...node.children.flatMap(child => [child, ...flatten(child)]), ...(node.nodes ? [...node.nodes.values()] : [])]; }
async function until(predicate) { const end = performance.now() + 6000; while (!predicate()) { if (performance.now() > end) throw new Error('UI operation timed out'); await new Promise(r => setTimeout(r, 2)); } }
async function fixture(installed = false) {
  const documentBefore = globalThis.document;
  globalThis.document = { activeElement: null, documentElement: { lang: 'zh-CN' }, createElement: tag => new Element(tag) };
  const root = new Element(); root.nodes = new Map();
  for (const match of userDataPageMarkup().matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1], match[2]); element.hidden = /\bhidden\b/.test(match[0]); root.nodes.set(element.id, element);
  }
  for (const id of ['api-chat-page', 'api-settings-page', 'api-settings-open', 'api-settings-back', 'api-prompt']) root.nodes.set(id, new Element('button', id));
  root.nodes.get('api-settings-back').addEventListener('click',()=>{root.nodes.get('api-settings-page').hidden=true;root.nodes.get('api-chat-page').hidden=false;});
  const native = fakeDataNative(installed ? DATA_CONNECTOR_FIXTURE : null); native.records.get(dataInfo.id).info.hasConnector = installed;
  const registry = new CapabilityRegistry([]); const manager = new UserDataManager(native, id => registry.createOwner(id), { workerFactory: dataWorkerFactory });
  const prompts = []; const controller = new UserDataController(root, { manager: () => manager, appInstanceId: () => 'data-ui-test', compose: text => prompts.push(text) });
  await controller.initialize();
  const get = id => root.nodes.get(id);
  const action = name => flatten(get('user-data-list')).find(node => node.dataset.action === name);
  const idle = () => until(() => get('user-data-page').dataset.busy !== 'true');
  return { native, registry, manager, controller, prompts, root, get, action, idle,
    async close() { controller.close(); await manager.close(); globalThis.document = documentBefore; } };
}
const sourceFile = source => ({ name: '我的数据.tfc', size: new TextEncoder().encode(source).length,
  async arrayBuffer() { return new TextEncoder().encode(source).buffer; } });
async function importFile(f, file) { f.action('import').click(); f.get('user-data-file').files = [file]; f.get('user-data-file').fire('change'); await f.idle(); }

test('My Data lives inline in AI settings and native chooser cancellation adds no source', async () => {
  const f = await fixture(); try {
    let picks = 0; f.native.pick = async replacement => { assert.equal(replacement, undefined); picks++; return null; };
    f.get('user-data-settings').open=true;f.get('user-data-settings').fire('toggle');
    assert.equal(f.get('user-data-page').hidden,false);
    f.get('user-data-add').click(); await f.idle(); assert.equal(picks, 1); assert.equal(f.manager.list().length, 1);
    assert.equal(f.prompts.length,0);
  } finally { await f.close(); }
});
test('AI handoff is an unsent prompt with an opaque source ID, not filesystem permission or model execution', async () => {
  const f = await fixture(); try {
    f.action('ai').click(); assert.equal(f.prompts.length, 1); assert.match(f.prompts[0], new RegExp(dataInfo.id));
    assert.match(f.prompts[0], /tf\.data\.guide/); assert.equal(f.native.ioCalls.length, 0); assert.equal(f.native.tickets.size, 0);
  } finally { await f.close(); }
});
test('file import uses isolated validation and a preview; explicit installation creates the same dynamic query', async () => {
  const f = await fixture(); try {
    await importFile(f, sourceFile(DATA_CONNECTOR_FIXTURE));
    assert.equal(f.get('user-data-preview').hidden, false); assert.equal(f.registry.describe().length, 0); assert.equal(f.native.tickets.size, 0);
    assert.match(f.get('user-data-preview-text').textContent, /1/);
    f.get('user-data-install').click(); await f.idle();
    assert.equal(f.manager.list()[0].status, 'connected'); assert.equal(f.registry.describe().length, 1);
    assert.equal(f.get('user-data-preview').hidden, true); assert.equal(f.native.tickets.size, 0);
  } finally { await f.close(); }
});
test('oversized or failing user code does not install, and cancellation terminates validation', async () => {
  const f = await fixture(); try {
    let reads = 0; await importFile(f, { name: 'big.tfc', size: 262145, async arrayBuffer() { reads++; return new ArrayBuffer(0); } });
    assert.equal(reads, 0); assert.match(f.get('user-data-status').textContent, /过大|预算/);
    f.action('import').click(); f.get('user-data-file').files = [sourceFile('while(true){}')]; f.get('user-data-file').fire('change');
    await until(() => f.get('user-data-page').dataset.busy === 'true'); f.get('user-data-stop').click(); await f.idle();
    assert.equal(f.registry.describe().length, 0); assert.equal(f.native.tickets.size, 0); assert.equal(f.get('user-data-preview').hidden, true);
  } finally { await f.close(); }
});
test('UI disable/enable/delete share transaction lifecycle and do not change user files', async () => {
  const f = await fixture(true); try {
    f.action('disable').click(); await f.idle(); assert.equal(f.registry.describe().length, 0); assert.equal(f.manager.list()[0].state, 'disabled');
    f.action('enable').click(); await f.idle(); assert.equal(f.registry.describe().length, 1);
    f.action('remove').click(); await f.idle(); assert.equal(f.registry.describe().length, 0); assert.equal(f.native.records.size, 0);
    assert.equal(f.get('user-data-empty').hidden, false); assert.equal(f.native.tickets.size, 0);
  } finally { await f.close(); }
});
test('stale previews cannot replace newer data state, and source names stay plain text', async () => {
  const f = await fixture(); try {
    await importFile(f, sourceFile(DATA_CONNECTOR_FIXTURE));
    const original = f.native.records.get(dataInfo.id); original.info = { ...original.info, name: '<img src=x onerror=alert(1)>', revision: '9'.repeat(32) };
    f.native.pick = async () => ({ ...original.info }); f.action('reselect').click(); await f.idle();
    f.get('user-data-install').click(); await f.idle();
    assert.equal(f.native.records.get(dataInfo.id).source, null); assert.equal(f.registry.describe().length, 0);
    assert.ok(flatten(f.get('user-data-list')).some(node => node.textContent === original.info.name));
  } finally { await f.close(); }
});
test('main mounts one manager and shared data tools, and closes them without invalidating other scopes on chart changes', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /new UserDataController/); assert.match(main, /new UserDataManager/);
  assert.equal((main.match(/createUserDataTools\(getUserDataManager\(\)\)/g) ?? []).length, 2);
  assert.match(main, /userDataController\.initialize\(\)/); assert.match(main, /userDataController\.close\(\)/);
  assert.match(main, /userDataManager\?\.close\(\)/);
  const invalidate = main.slice(main.indexOf('function invalidateAiChartSessions'), main.indexOf('function describeAiChartTools'));
  assert.doesNotMatch(invalidate, /userDataManager.*close/);
});
test('data-specific page states what may leave the machine without reintroducing a global AI permission layer', async () => {
  assert.doesNotMatch(userDataPageMarkup(), /不上传整份数据库/);
  assert.match(userDataPageMarkup(), /不会自动上传整个目录/);
  assert.match(userDataPageMarkup(), /查询结果、所需样本/);
  const settings = await readFile(new URL('../src/ai-api/page.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /允许 AI 读取|api-consent|权限与会话说明/);
});
test('desktop data probe opens inline settings sections without a standalone My Data page route', async () => {
  const probe = await readFile(new URL('./user-data-desktop-probe.txt', import.meta.url), 'utf8');
  const branch = probe.slice(probe.indexOf("case 'mcp-page':"), probe.indexOf("case 'pick-start':"));
  assert.match(branch, /if \(aiPanel\.hidden/);
  assert.match(branch, /api-settings-open/); assert.match(branch, /api-mcp-settings/);
  const settings = await readFile(new URL('../src/ai-api/page.ts', import.meta.url), 'utf8');
  const dataMarkup = await readFile(new URL('../src/user-data/page.ts', import.meta.url), 'utf8');
  const page = await readFile(new URL('../src/ai-mcp/page.ts', import.meta.url), 'utf8');
  assert.match(settings, /id="api-mcp-settings"/);
  assert.match(settings, /\$\{userDataPageMarkup\(\)\}/);
  assert.match(dataMarkup, /id="user-data-settings"/);
  assert.doesNotMatch(settings, /id="api-data-open"/);
  assert.doesNotMatch(page, /ai-external-page/);
});
test('native chooser driver is restricted to its exact private PID, native file URL and test-owned directory', async () => {
  const driver = await readFile(new URL('./user-data-picker.swift', import.meta.url), 'utf8');
  for (const required of ['executable.hasPrefix(executableRoot)', 'current.launchDate == launched', 'matches.count == 1',
    'directory.hasPrefix(fixtureRoot + "/")', 'fixtureAncestor(selected) == directory', 'CFEqual(current, panel)']) assert.ok(driver.includes(required), required);
  assert.doesNotMatch(driver, /CGEvent\(|postToPid|AXUIElementPostKeyboardEvent|NSPasteboard|System Events/);
  assert.match(driver, /AXPress/); assert.match(driver, /AXSelected/);
});
test('MCP layout acceptance shows and paints its own window before the initial sidebar transition', async () => {
  const probe = await readFile(new URL('./ai-mcp-desktop-probe.txt', import.meta.url), 'utf8');
  const open = probe.slice(probe.indexOf("case 'open':"), probe.indexOf("case 'start':"));
  assert.ok(open.indexOf('await prepareTestCapture()') >= 0);
  assert.ok(open.indexOf('await prepareTestCapture()') < open.indexOf("click('#ai-toggle')"));
});
