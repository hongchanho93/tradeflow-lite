/** Opt-in real Tauri + native stdio client test. No accounts, model calls,
 * installed App, user clipboard, production profile or global process kills. */
import assert from 'node:assert/strict';
import { runBusinessDesktopCases } from './ai-business-desktop-cases.mjs';
import { runDynamicDesktopCases } from './ai-dynamic-desktop-cases.mjs';
import { runUserDataMcpDesktopCases } from './user-data-mcp-desktop-cases.mjs';
import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import { acquireDesktopRunLease, desktopSourceFingerprint, singleListenerPid, desktopRuntimeEnvironment } from './ai-desktop-run-guard.mjs';

assert.equal(process.platform, 'darwin');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = randomUUID(); const nonce = randomBytes(24).toString('hex');
const title = `TradeFlow Lite MCP Test ${runId.slice(0, 8)}`;
const output = path.join(root, 'src-tauri/target/mcp-desktop-smoke', runId);
const dist = path.join(output, 'dist');
const release = acquireDesktopRunLease(path.join(root, 'src-tauri/target/ai-desktop-smoke'), runId);
process.once('exit', release);
await mkdir(dist, { recursive: true });
const fingerprint = await desktopSourceFingerprint(root);
const config = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const policy = Object.entries(config.app.security.csp).map(([key, value]) => `${key} ${value}`).join('; ');
const originalMain = await readFile(path.join(root, 'src/main.ts'), 'utf8');
const probe = (await readFile(new URL('./user-data-desktop-probe.txt', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('./ai-dynamic-desktop-probe.txt', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('./ai-mcp-desktop-probe.txt', import.meta.url), 'utf8'))
  .replace('__TF_MCP_TEST__', JSON.stringify({ runId, nonce }));
await build({ root, configFile: false, logLevel: 'warn',
  define: { 'import.meta.env.VITE_TRADEFLOW_USER_INDICATOR_E2E': JSON.stringify('0') },
  plugins: [{ name: 'private-mcp-probe', enforce: 'pre', transform(source, id) {
    if (id.split('?')[0] !== path.join(root, 'src/main.ts')) return;
    assert.ok(source === originalMain, 'main changed during build'); return source + '\n' + probe;
  } }], build: { outDir: dist, emptyOutDir: true } });

let readyResolve; const ready = new Promise(r => { readyResolve = r; });
let fatal; let app; let commandSequence = 0; const queue = []; const waiting = new Map();
const results = []; const helpers = []; const screenshots = []; const screenshotFailures = [];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const host = `127.0.0.1:${server.address().port}`;
    assert.ok(req.headers.host === host && (!req.headers.origin || req.headers.origin === `http://${host}`));
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === `/__tf_mcp_test/${nonce}`) {
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(queue.shift() ?? null)); return; }
      assert.equal(req.method, 'POST'); assert.equal(req.headers['content-type'], 'application/json');
      let length = 0; const chunks = [];
      for await (const chunk of req) { length += chunk.length; assert.ok(length <= 1024 * 1024); chunks.push(chunk); }
      const message = JSON.parse(Buffer.concat(chunks).toString()); assert.equal(message.runId, runId);
      if (message.kind === 'ready') readyResolve();
      else if (message.kind === 'failure') { fatal = new Error(message.message); }
      else if (message.kind === 'answer') { waiting.get(message.id)?.(message); waiting.delete(message.id); }
      // The config answer contains pairing material. NEVER persist or log answers.
      res.writeHead(200); res.end('ok'); return;
    }
    assert.equal(req.method, 'GET');
    const filename = path.resolve(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1));
    assert.ok(filename.startsWith(dist + path.sep));
    const body = await readFile(filename); res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream',
      'Content-Security-Policy': policy, 'Cache-Control': 'no-store' }); res.end(body);
  } catch { if (!res.headersSent) res.writeHead(400); res.end('private test request rejected'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const timeout = (promise, ms, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error(`timeout: ${label}`)), ms);
  promise.then(value => { clearTimeout(timer); resolve(value); }, e => { clearTimeout(timer); reject(e); });
});
const command = async (action, input = {}) => {
  const id = ++commandSequence;
  const response = await timeout(new Promise(r => { waiting.set(id, r); queue.push({ id, action, ...input }); }), 70000, action);
  if (response.error) throw Error(response.error); if (fatal) throw fatal; return response.result;
};
const test = async (name, fn) => { await fn(); results.push(name); console.log(`MCP desktop PASS: ${name}`); };

function client(configuration) {
  const child = spawn(configuration.command, configuration.args, { env: { ...process.env, ...configuration.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  helpers.push(child); let sequence = 0; let buffer = ''; const pending = new Map(); const received = [];
  const decoder = new StringDecoder('utf8');
  child.stdin.on('error', () => {});
  child.stdout.on('data', chunk => {
    buffer += decoder.write(chunk);
    if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { child.stdin.end(); return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let response;
      try { response = JSON.parse(line); } catch { fatal = Error('helper stdout is not MCP JSON'); child.stdin.end(); return; }
      received.push(response); pending.get(response.id)?.resolve(response); pending.delete(response.id);
    }
  });
  child.stderr.on('data', () => {}); // no credentials or inherited diagnostics in reports
  const exited = new Promise(r => child.once('exit', (code, signal) => {
    for (const item of pending.values()) item.reject(Error('native helper disconnected')); pending.clear(); r({ code, signal });
  }));
  const request = (method, params = {}) => {
    const id = ++sequence;
    let timer;
    const promise = new Promise((resolve, reject) => {
      timer = setTimeout(() => { pending.delete(id); reject(Error(`timeout: MCP ${method}`)); }, 150000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    promise.catch(() => {});
    return { id, promise, forget: () => { clearTimeout(timer); pending.delete(id); } };
  };
  return { child, request, exited, received,
    call: (name, args = {}) => request('tools/call', { name, arguments: args }),
    notify: (method, params = {}) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n') };
}
async function capture(name, port) {
  await command('prepare-capture');
  const run = (cmd, args) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; let stderr = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { stderr = (stderr + d).slice(-1500); });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve(out.trim())
      : reject(Error(`test-window capture unavailable: ${path.basename(cmd)} exit ${code}: ${stderr}`)));
  });
  assert.match(String(port), /^\d+$/);
  const owner = await run('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
  const id = await run('/usr/bin/swift', [path.join(root, 'scripts/ai-test-window.swift'), title, singleListenerPid(owner)]);
  assert.match(id, /^\d+$/);
  try {
    await run('/usr/sbin/screencapture', ['-x', '-o', '-l', id, path.join(output, `${name}.png`)]);
    screenshots.push(`${name}.png`);
  } catch (error) {
    // Screen-recording availability is separate from the real WebView business
    // gates. Never fall back to capturing the whole desktop or another window.
    screenshotFailures.push({ name, reason: error.message });
    console.log(`MCP desktop visual evidence unavailable: ${name}`);
  }
}

try {
  const merged = { identifier: `com.tradeflow.lite.mcp-test-${runId}`, productName: 'TradeFlow Lite MCP Test',
    build: { beforeDevCommand: '', beforeBuildCommand: '', devUrl: origin },
    app: { windows: [{ ...config.app.windows[0], label: 'main', title }], security: { devCsp: config.app.security.csp,
      capabilities: ['default', { identifier: 'mcp-test-close', windows: ['main'], permissions: ['core:window:allow-close', 'core:window:allow-show', 'core:window:allow-set-focus'] }] } } };
  app = spawn(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev', '--no-watch', '--config', JSON.stringify(merged)], {
    cwd: root, detached: true, env: { ...desktopRuntimeEnvironment(), TRADEFLOW_WORKSPACE_ROOT: path.join(output, 'workspace-state'),
      CARGO_BUILD_JOBS: '2', CARGO_TARGET_DIR: path.join(root, 'src-tauri/target/ai-desktop-smoke-cargo') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', () => {}); app.stderr.on('data', d => process.stderr.write(d));
  const appExit = new Promise((resolve, reject) => { app.once('error', reject); app.once('exit', (code, signal) => resolve({ code, signal })); });
  await timeout(Promise.race([ready, appExit.then(() => { throw Error('private App exited before readiness'); })]), 300000, 'private App boot');
  await test('actual WidgetBar entry, mutually exclusive pages and layout', () => command('open'));
  await test('explicit local listener start and native configuration copy', () => command('start'));
  const configuration = await command('config');
  assert.deepEqual(configuration.args, ['--mcp-stdio']);
  const c = client(configuration);
  const result = r => {
    assert.ok(r.result?.structuredContent, `unexpected MCP envelope: ${JSON.stringify(r.error ?? null)}`);
    return r.result.structuredContent.reply;
  };
  await test('actual native helper stdio initialize and discover tool schemas', async () => {
    const init = await c.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'MCP 验收客户端', version: '1' } }).promise;
    assert.equal(init.result.protocolVersion, '2025-11-25'); c.notify('notifications/initialized');
    const list = await c.request('tools/list').promise;
    const expected = (await command('workspace-state')).tools;
    assert.deepEqual(list.result.tools.map(tool => tool.name), ['tf_context_get', ...expected]);
    assert.deepEqual(list.result.tools.find(tool => tool.name === 'tf_watchlist_list').inputSchema.required, ['input']);
  });
  await test('paired client is immediately usable after authenticated MCP initialization', async () => {
    assert.ok(result(await c.call('tf_context_get').promise).context);
    assert.equal(result(await c.call('tf_watchlist_list', { input: {} }).promise).status, 'ok');
  });
  let context = result(await c.call('tf_context_get').promise).context;
  let snapshot; let summary; let plan; let independentHistory;
  const tool = (name, input = {}) => c.call(name, { context, input });
  const appRead = async (name, input = {}) => {
    const reply = result(await c.call(name, { input }).promise); assert.equal(reply.status, 'ok'); return reply.data;
  };
  await test('actual providers, static catalog and symbol search work without chart context parameters', async () => {
    const before = (await command('workspace-state')).context;
    const providers = await appRead('tf_market_providers'); assert.ok(providers.items.some(p => p.id === 'tdx'));
    const tdx = await appRead('tf_market_provider', { providerId: 'tdx' }); assert.equal(tdx.capabilities.history, true);
    const catalog = await appRead('tf_market_catalog', { providerId: 'tdx', venue: 'SH', limit: 2 });
    assert.equal(catalog.items.length, 2); assert.equal(catalog.coverage, 'local-static'); assert.ok(catalog.nextCursor);
    const search = await appRead('tf_market_search', { query: '600000', providerId: 'tdx' });
    assert.ok(search.items.some(item => item.symbol === 'SH:600000')); assert.equal(search.coverage, 'loaded-catalog');
    assert.deepEqual((await command('workspace-state')).context, before);
  });
  await test('actual watchlist and indicator reads match the live UI state without returning source', async () => {
    const expected = await command('workspace-state');
    const watchlist = await appRead('tf_watchlist_list'); assert.deepEqual(watchlist.items.map(item => item.key), expected.watchlist);
    const definitions = await appRead('tf_indicator_definitions'); assert.equal(definitions.ready, true);
    assert.ok(definitions.items.some(item => item.id === 'builtin.ma'));
    assert.ok(definitions.items.every(item => !Object.hasOwn(item, 'source') && !Object.hasOwn(item, 'create')));
    const library = await appRead('tf_indicator_library'); assert.equal(library.ready, true);
    assert.deepEqual(library.items.map(item => item.id), expected.userLibraryIds);
    const instances = result(await tool('tf_indicator_instances').promise);
    assert.equal(instances.status, 'ok'); assert.deepEqual(instances.data.items.map(item => item.instanceId), expected.indicatorIds);
  });
  await test('independent native history and quotes do not change the foreground chart', async () => {
    const before = (await command('workspace-state')).context;
    const query = { providerId: 'tdx', symbol: 'SZ:000001', kind: 'stock' };
    independentHistory = await appRead('tf_market_history', { ...query, resolution: '1D', adjustment: 'none', count: 350 });
    assert.equal(independentHistory.symbol, query.symbol); assert.equal(independentHistory.seriesKind, 'ohlcv');
    assert.equal(independentHistory.rowCount, 350); assert.equal(independentHistory.rows, undefined);
    const page = await appRead('tf_market_page', { datasetId: independentHistory.datasetId, offset: 0, limit: 7 });
    assert.equal(page.rows.length, 7); assert.equal(page.nextOffset, 7);
    const quote = await appRead('tf_market_quote', query); assert.equal(quote.symbol, query.symbol); assert.ok(quote.quote.last > 0);
    const batch = await appRead('tf_market_quotes', { requests: [query, { ...query, providerId: 'unknown-fixture' }, query] });
    assert.deepEqual(batch.items.map(item => item.status), ['ok', 'error', 'ok']);
    assert.deepEqual((await command('workspace-state')).context, before);
  });
  await test('native ticket cancelled before execution cannot issue a background query', async () => {
    assert.equal((await command('cancel-query-before-execute')).rejected, true);
  });
  await test('real chart snapshot, page and deterministic calculation over MCP', async () => {
    snapshot = result(await tool('tf_chart_snapshot').promise).data; assert.ok(snapshot.snapshotId);
    const page = result(await tool('tf_dataset_page', { snapshotId: snapshot.snapshotId, limit: 1000 }).promise).data;
    summary = result(await tool('tf_compute_summary', { snapshotId: snapshot.snapshotId, field: 'close' }).promise).data;
    assert.ok(page.bars.length > 20); assert.equal(summary.count, page.bars.length);
    assert.ok(Math.abs(summary.mean - page.bars.reduce((s, b) => s + b.close, 0) / page.bars.length) < 1e-8);
  });
  await test('drawing proposal has no side effects; the one client authorization applies it without another prompt', async () => {
    plan = result(await tool('tf_drawings_propose', { operations: [{ op: 'create', drawing: {
      type: 'HorizontalLine', points: [{ time: summary.toTime, price: summary.mean }], style: { color: '#2962ff' },
    } }] }).promise).data;
    assert.ok(plan.changeSetId);
    assert.equal(result(await tool('tf_drawings_apply', { changeSetId: plan.changeSetId }).promise).status, 'ok');
    assert.equal((await command('status')).approvals, 0);
    assert.equal((await command('status')).drawings, 1);
  });
  await test('MCP undo uses the same one-time authorization and the native receipt', async () => {
    assert.equal(result(await tool('tf_drawings_revert', { changeSetId: plan.changeSetId }).promise).status, 'ok');
    assert.equal((await command('status')).approvals, 0); assert.equal((await command('status')).drawings, 0);
  });
  await test('authorized MCP page contains no per-operation approval UI', async () => {
    const status = await command('status');
    assert.equal(status.approvals, 0);
  });
  await test('closing AI page does not stop the paired client', async () => {
    await command('close-page'); assert.deepEqual((await c.request('ping').promise).result, {}); await command('open');
  });
  await test('actual A-B-A selection keeps the same authorization, auto-rebinds current context and rejects only the old request context', async () => {
    const old = context; await command('switch-aba');
    const retained = await appRead('tf_market_page', { datasetId: independentHistory.datasetId, offset: 7, limit: 5 });
    assert.equal(retained.rows.length, 5); assert.equal(retained.total, independentHistory.rowCount);
    assert.equal((await appRead('tf_market_release', { datasetId: independentHistory.datasetId })).released, true);
    assert.equal((await appRead('tf_watchlist_list')).coverage, 'local-watchlist');
    context = result(await c.call('tf_context_get').promise).context;
    assert.notEqual(context.selectionGeneration, old.selectionGeneration);
    assert.equal(result(await c.call('tf_chart_snapshot', { context: old, input: {} }).promise).code, 'context_stale');
    assert.equal(result(await c.call('tf_chart_snapshot', { context, input: {} }).promise).status, 'ok');
    assert.equal((await command('status')).approvals, 0);
  });
  await test('second paired native client is also immediately usable but cannot borrow the first connection\'s retained result', async () => {
    const second = client(configuration);
    await second.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Isolated second client', version: '1' } }).promise;
    second.notify('notifications/initialized');
    await command('wait-connections', { count: 2 });
    assert.ok(result(await second.call('tf_context_get').promise).context);
    assert.equal(result(await second.call('tf_watchlist_list', { input: {} }).promise).status, 'ok');
    assert.equal(result(await second.call('tf_market_page', { input: { datasetId: independentHistory.datasetId, offset: 0, limit: 1 } }).promise).code, 'snapshot_unavailable');
    assert.ok(result(await c.call('tf_context_get').promise).context);
    second.child.stdin.end();
    const exit = await timeout(second.exited, 5000, 'second helper EOF'); assert.equal(exit.signal, null);
    await command('wait-connections', { count: 1 });
  });
  await test('the original one-time grant continues to permit native create and undo without repeated prompts', async () => {
    const p = result(await tool('tf_drawings_propose', { operations: [{ op: 'create', drawing: {
      type: 'HorizontalLine', points: [{ time: summary.toTime, price: summary.mean }], style: {},
    } }] }).promise).data;
    assert.equal(result(await tool('tf_drawings_apply', { changeSetId: p.changeSetId }).promise).status, 'ok');
    assert.equal((await command('status')).approvals, 0);
    assert.equal(result(await tool('tf_drawings_revert', { changeSetId: p.changeSetId }).promise).status, 'ok');
    assert.equal((await command('status')).drawings, 0);
  });
  await test('AI page remains bounded at minimum and maximum sidebar width', async () => {
    assert.equal((await command('layout', { width: 280 })).width, 280); await capture('ai-widgetbar-min', configuration.env.TRADEFLOW_MCP_PORT);
    await command('layout', { width: 520 }); await capture('ai-widgetbar-wide', configuration.env.TRADEFLOW_MCP_PORT);
  });
  await test('AI page uses the real light theme without changing access or overflowing', async () => {
    assert.equal((await command('theme', { theme: 'light' })).background, 'rgb(255, 255, 255)');
    await capture('ai-widgetbar-light', configuration.env.TRADEFLOW_MCP_PORT);
    await command('theme', { theme: 'dark' });
  });
  await test('page/app reload automatically restores MCP and the already-copied configuration reconnects unchanged', async () => {
    await command('reload'); await timeout(c.exited, 5000, 'helper closed during page reload');
    await command('wait-mcp-running'); const restored = await command('config');
    assert.equal(restored.env.TRADEFLOW_MCP_TOKEN, configuration.env.TRADEFLOW_MCP_TOKEN);
    assert.equal(restored.env.TRADEFLOW_MCP_RUNTIME_FILE, configuration.env.TRADEFLOW_MCP_RUNTIME_FILE);
    const oldConfig = client(configuration);
    await oldConfig.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Persisted client', version: '1' } }).promise;
    oldConfig.notify('notifications/initialized'); assert.ok(result(await oldConfig.call('tf_context_get').promise).context);
    oldConfig.child.stdin.end(); await timeout(oldConfig.exited, 5000, 'persisted helper EOF'); await command('wait-connections', { count: 0 });
  });
  await test('manual disable/re-enable keeps the same credential; explicit reset is the only rotation path', async () => {
    await command('stop'); assert.equal((await command('status')).connections, 0);
    await command('start'); const renewed = await command('config');
    assert.equal(renewed.env.TRADEFLOW_MCP_TOKEN, configuration.env.TRADEFLOW_MCP_TOKEN);
    assert.equal(renewed.env.TRADEFLOW_MCP_RUNTIME_FILE, configuration.env.TRADEFLOW_MCP_RUNTIME_FILE);
    await command('reset-mcp'); const reset = await command('config');
    assert.notEqual(reset.env.TRADEFLOW_MCP_TOKEN, configuration.env.TRADEFLOW_MCP_TOKEN);
    assert.equal(reset.env.TRADEFLOW_MCP_RUNTIME_FILE, configuration.env.TRADEFLOW_MCP_RUNTIME_FILE);
    const stale = client(configuration); const badExit = await timeout(stale.exited, 5000, 'old pairing rejected after explicit reset'); assert.equal(badExit.code, 1);
    const fresh = client(reset);
    await fresh.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Reset client', version: '1' } }).promise;
    fresh.notify('notifications/initialized'); assert.ok(result(await fresh.call('tf_context_get').promise).context);
    await command('stop'); await timeout(fresh.exited, 5000, 'reset helper stopped');
  });
  await runBusinessDesktopCases({ command, test, client, result, timeout, capture });
  await runDynamicDesktopCases({ command, test, client, result, timeout });
  await runUserDataMcpDesktopCases({ root, output, title, command, test, client, result, timeout, capture });
  await command('finish'); const exit = await timeout(appExit, 6000, 'App normal exit'); assert.equal(exit.code, 0);
} catch (e) { fatal = e; console.error('MCP desktop failed:', e.message); }
finally {
  for (const helper of helpers) helper.stdin.end();
  if (app && app.exitCode === null && app.signalCode === null) {
    try { process.kill(-app.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
  server.close();
  const finalFingerprint = await desktopSourceFingerprint(root);
  if (fingerprint.sha256 !== finalFingerprint.sha256) fatal ??= Error('source changed during MCP desktop test');
  await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ runId, passed: !fatal, scenarios: results,
    fingerprint, finalFingerprint, screenshots, screenshotFailures,
    nativeWindowScreenshotAvailable: screenshots.length > 0,
    failure: fatal?.message ?? null }, null, 2));
  release();
}
if (fatal) throw fatal;
console.log(`MCP desktop: ${results.length} scenarios passed. Evidence: ${output}`);
