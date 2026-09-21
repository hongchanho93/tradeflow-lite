import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { aiPageMarkup } from '../src/ai-mcp/page.ts';
import { approvalOverview } from '../src/ai-mcp/approval.ts';
import { AiMcpController } from '../src/ai-mcp/controller.ts';
import { CapabilityCore, CapabilityRegistry } from '../src/ai-capabilities/index.ts';
import { translateUiText } from '../src/i18n.ts';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const page = aiPageMarkup('<svg viewBox="0 0 24 24"></svg>');
const css = readFileSync(new URL('../src/ai-mcp/page.css', import.meta.url), 'utf8');
let count = 0;
function test(name, fn) { fn(); count++; }
const tick = () => new Promise(r => setTimeout(r, 0));

class Element {
  children = []; dataset = {}; attributes = {}; events = {}; hidden = false; disabled = false;
  className = ''; id = ''; value = ''; textContent = ''; focused = false;
  constructor(tag = 'div') { this.tagName = tag; }
  classList = {
    toggle: (key, on) => {
      const classes = new Set(this.className.split(' ').filter(Boolean));
      if (on) classes.add(key); else classes.delete(key); this.className = [...classes].join(' ');
    },
    remove: key => this.classList.toggle(key, false),
    contains: key => this.className.split(' ').includes(key),
  };
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...nodes) { for (const n of nodes) { if (n.tagName === 'fragment') this.append(...n.children); else { this.children.push(n); n.parentElement = this; } } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(name, fn) { this.events[name] = fn; }
  click() { if (!this.disabled) this.events.click?.({}); }
  focus() { this.focused = true; }
  querySelector(selector) { return this.walk().find(n => selector.startsWith('#') ? n.id === selector.slice(1) : n.className.split(' ').includes(selector.slice(1))) ?? null; }
  walk() { return this.children.flatMap(n => [n, ...n.walk()]); }
}

test('WidgetBar owns the AI tab and panel, no popup or separate application', () => {
  assert.match(main, /id="ai-toggle" class="widget-bar-tab ai-widget-tab"[^>]*aria-controls="ai-panel"/);
  assert.match(page, /id="ai-panel"[^>]*role="tabpanel"[^>]*aria-labelledby="ai-toggle" hidden/);
  assert.match(main, /widgetBarPages\.insertAdjacentHTML\('beforeend', aiPageMarkup\(icons\.close\)\)/);
  assert.match(css, /\.ai-panel\[hidden\]/); assert.match(css, /overflow-y: auto/);
  assert.doesNotMatch(page, /iframe|onclick=/);
  assert.match(page, /id="ai-api-root"/); assert.doesNotMatch(page, /id="ai-external-page"/);
  assert.match(page, /id="api-mcp-settings"/);
});

const el = () => new Element();
const deps = Object.fromEntries(['widgetBar', 'widgetBarPages', 'watchlistPanel', 'marketDataPanel', 'drawingManager',
  'dataWindowPanel', 'aiPanel', 'watchlistToggle', 'marketDataToggle', 'drawingManagerToggle', 'dataWindowToggle',
  'aiToggle', 'watchlistRefresh'].map(key => [key, el()]));
const close = new Element('button');
const doc = { querySelector: id => id === '#ai-close' ? close : null };
Object.assign(deps, { document: doc, closeToolbarMenus() {}, renderWatchlist() {}, refreshWatchlistQuotes() {},
  renderMarketDataPanel() {}, renderDrawingManager() {}, renderDataWindow() {} });
const panelCode = main.slice(main.indexOf('function setActiveWidgetPanel('), main.indexOf('\nfunction widgetPanelWidthLimits('));
const clickCode = main.slice(main.indexOf("aiToggle.addEventListener('click'"), main.indexOf("watchlistPanelAdd.addEventListener('click'"));
const select = new Function(...Object.keys(deps), stripTypeScriptTypes(`let watchlistQuoteRefreshId = 0;\n${panelCode}\n${clickCode}`)
  + '\nreturn setActiveWidgetPanel;')(...Object.values(deps));
test('actual main handlers make AI mutually exclusive with every other page', () => {
  for (const previous of ['watchlist', 'market-data', 'drawing-manager', 'data-window', null]) {
    select(previous); deps.aiToggle.click();
    assert.equal(deps.aiPanel.hidden, false); assert.equal(deps.widgetBarPages.hidden, false);
    for (const key of ['watchlistPanel', 'marketDataPanel', 'drawingManager', 'dataWindowPanel']) assert.equal(deps[key].hidden, true);
    assert.equal(deps.aiToggle.attributes['aria-selected'], 'true');
    assert.equal(deps.watchlistToggle.attributes['aria-selected'], 'false');
  }
});
test('actual same-tab and close-button handlers collapse, restore focus and clear aria', () => {
  deps.aiToggle.click(); assert.equal(deps.aiPanel.hidden, true);
  deps.aiToggle.click(); close.click();
  assert.equal(deps.widgetBarPages.hidden, true); assert.equal(deps.aiToggle.focused, true);
  assert.equal(deps.aiToggle.attributes['aria-selected'], 'false');
});
test('switching away from AI closes it without changing chart or stopping MCP', () => {
  select('ai'); select('watchlist'); assert.equal(deps.aiPanel.hidden, true);
  assert.doesNotMatch(panelCode + clickCode, /openHistory|stop\(|authorize\(|\.start\(|currentBars\s*=/);
});
test('AI UI strings translate, raw tool data is excluded from automatic translation', () => {
  for (const text of ['AI 工作台', '连接外部 AI（MCP）', '启用本地 MCP', '复制连接配置', '暂无客户端连接']) {
    assert.notEqual(translateUiText(text, 'en-US'), text);
  }
  const i18n = readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8');
  assert.match(i18n, /mutation\.target\.parentElement\)\?\.closest\('\.ai-external-text'\)/);
});

const previousDocument = globalThis.document;
test('confirmation describes normalized prices and preserves literal text instead of model prose', () => {
  const approval = { toolId: 'tf.drawings.apply', proposal: { operations: [{ op: 'create', after: {
    type: 'HorizontalLine', points: [{ time: 1700000000, price: 10.13 }], style: { color: '#2962ff' },
  } }, { op: 'create', after: { type: 'Text', points: [{ time: 1700000000, price: 11 }], style: { text: '<script>x</script>' } } }] } };
  const text = approvalOverview(approval).join('\n');
  assert.match(text, /新建 水平线/); assert.match(text, /10\.13 @ 2023-11-14T22:13:20Z/);
  assert.ok(text.includes('<script>x</script>')); // controller renders textContent, not HTML
  assert.match(approvalOverview(approval, true)[0], /Create HorizontalLine/);
});
test('undo summary describes the inverse action and never labels it as another create', () => {
  const text = approvalOverview({ toolId: 'tf.drawings.revert', proposal: { operations: [{ op: 'create' }] } }).join('');
  assert.match(text, /只撤销/); assert.doesNotMatch(text, /新建 水平线/);
  assert.match(approvalOverview({ toolId: 'tf.drawings.apply' })[0], /核对/);
  assert.ok(approvalOverview({ toolId: 'tf.drawings.apply', proposal: { operations: Array(33).fill(null) } }).length <= 32);
});
globalThis.document = { createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment') };
try {
  const panel = new Element();
  for (const id of ['ai-mcp-start', 'ai-mcp-stop', 'ai-mcp-reset', 'ai-mcp-copy', 'ai-mcp-client-format', 'ai-mcp-status',
    'ai-mcp-configuration', 'ai-mcp-empty', 'ai-mcp-connections']) { const e = el(); e.id = id; panel.append(e); }
  const toggle = el(); let starts = 0; let stops = 0; let resets = 0; let enabled = false; let receiver; const replies = []; const remembered = []; const disabled = [];
  const config = { serverId: 'run', port: 50000, token: 'a'.repeat(64), executable: '/test/binary', runtimeFile: '/test/mcp-runtime-v1.json' };
  const transport = { enabled: async () => enabled,
    start: async (fn, remember = true) => { starts++; remembered.push(remember); if (remember) enabled = true; receiver = fn; return config; },
    stop: async (_serverId, disable = false) => { stops++; disabled.push(disable); if (disable) enabled = false; },
    resetCredentials: async () => { resets++; },
    finish: async (event, response) => replies.push({ ...event, response }), disconnect: async () => {} };
  let context = { appInstanceId: 'app', chartId: 'main', provider: 'tdx', instrument: 'SH:600000', resolution: '1D', adjustment: 'none', selectionGeneration: 1 };
  const registry = new CapabilityRegistry([]); const core = new CapabilityCore(registry);
  const controller = new AiMcpController(panel, toggle, { describe: () => [], context: () => context,
    open: permissions => core.openSession({ context, currentContext: () => context, permissions }) }, transport);
  await tick();
  test('an unused MCP setting does not auto-start before the user enables it once', () => assert.equal(starts, 0));
  panel.querySelector('#ai-mcp-start').click(); panel.querySelector('#ai-mcp-start').click(); await tick();
  test('double Start produces one listener and hides disabled configuration state', () => {
    assert.equal(starts, 1); assert.equal(panel.querySelector('#ai-mcp-configuration').hidden, false);
    assert.deepEqual(remembered, [true]); assert.equal(enabled, true);
    assert.equal(panel.querySelector('#ai-mcp-start').hidden, true);
    assert.doesNotMatch(panel.walk().map(n => n.textContent).join(' '), /aaaaaaa/);
  });
  const event = (kind, sequence = 0, message = null, serverId = 'run') => receiver({ serverId, connectionId: '1', kind, sequence, message });
  event('opened'); await tick();
  event('message', 1, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: '<script>not HTML</script>', version: '1' },
  } }));
  event('message', 2, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })); await tick();
  test('authenticated local MCP initialization automatically opens business access without a second authorization click', () => {
    assert.equal(core.openSessions, 1); assert.equal(toggle.dataset.pending, 'false');
    assert.ok(panel.walk().some(n => n.textContent === '<script>not HTML</script>' && n.className === 'ai-external-text'));
    assert.equal(panel.walk().filter(n=>n.dataset.action==='authorize').length,0);
    assert.ok(!panel.walk().some(n=>n.tagName==='select'&&String(n.id).startsWith('ai-mode-')));
    assert.ok(!panel.walk().some(n=>['确认应用','拒绝'].includes(n.textContent)));
  });
  context = { ...context, instrument:'SZ:000001', selectionGeneration:2 }; controller.invalidate(); await tick();
  test('chart invalidation preserves the same authorization and never asks the user again', () => {
    assert.equal(core.openSessions,1);assert.equal(toggle.dataset.pending,'false');
    assert.equal(panel.walk().filter(n=>n.dataset.action==='authorize').length,0);
    assert.ok(panel.walk().some(n=>n.textContent==='已连接'));
  });
  event('opened', 0, null, 'old-run'); await tick();
  test('old server events do not create or authorize a new connection', () => assert.equal(panel.walk().filter(n => n.className === 'ai-connection').length, 1));
  panel.querySelector('#ai-mcp-stop').click(); await tick();
  test('explicit Stop clears cards, configuration and all business grants', () => {
    assert.equal(stops, 1); assert.equal(core.openSessions, 0);
    assert.deepEqual(disabled, [true]); assert.equal(enabled, false);
    assert.equal(panel.querySelector('#ai-mcp-configuration').hidden, true);
    assert.equal(panel.querySelector('#ai-mcp-start').hidden, false);
    assert.equal(panel.walk().filter(n => n.className === 'ai-connection').length, 0);
  });

  enabled = true;
  const panel2 = new Element();
  for (const id of ['ai-mcp-start', 'ai-mcp-stop', 'ai-mcp-reset', 'ai-mcp-copy', 'ai-mcp-client-format', 'ai-mcp-status',
    'ai-mcp-configuration', 'ai-mcp-empty', 'ai-mcp-connections']) { const e = el(); e.id = id; panel2.append(e); }
  const controller2 = new AiMcpController(panel2, el(), { describe: () => [], context: () => context,
    open: permissions => core.openSession({ context, currentContext: () => context, permissions }) }, transport);
  await tick();
  test('a previously enabled MCP setting auto-starts on the next controller/app load without rotating credentials', () => {
    assert.equal(starts, 2); assert.equal(remembered.at(-1), false); assert.equal(panel2.querySelector('#ai-mcp-start').hidden, true);
  });
  panel2.querySelector('#ai-mcp-reset').click(); await tick(); await tick();
  test('credential reset stops without disabling, rotates explicitly, then auto-restarts under the saved enable preference', () => {
    assert.equal(resets, 1); assert.equal(disabled.at(-1), false); assert.equal(remembered.at(-1), false); assert.equal(enabled, true);
  });
  void controller2;
} finally { globalThis.document = previousDocument; }
console.log(`AI WidgetBar and controller: ${count} scenarios passed`);
