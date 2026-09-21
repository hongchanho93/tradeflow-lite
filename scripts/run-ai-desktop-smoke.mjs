/** macOS-only opt-in integration test. Never runs against an installed/soak App.
 * Builds a private frontend with a test-only probe, then launches the existing
 * Tauri source using a unique app identifier and an OS-assigned loopback origin.
 * LocalStorage/IndexedDB isolation is origin-based; restarts reuse only this test
 * origin. Tauri 2.11.5 codegen currently cannot compile dataStoreIdentifier.
 * No model account, production source edit, bundle, install or global process kill.
 */
import assert from 'node:assert/strict';
import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acquireDesktopRunLease, desktopSourceFingerprint } from './ai-desktop-run-guard.mjs';

assert.equal(process.platform, 'darwin', 'This test requires a real macOS Tauri WebView.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = randomUUID();
const nonce = randomBytes(24).toString('hex');
const output = path.join(root, 'src-tauri/target/ai-desktop-smoke', runId);
const dist = path.join(output, 'dist');
const releaseLease = acquireDesktopRunLease(path.join(root, 'src-tauri/target/ai-desktop-smoke'), runId);
process.once('exit', releaseLease);
await mkdir(output, { recursive: true });
const sourceFingerprint = await desktopSourceFingerprint(root);
const originalMain = await readFile(path.join(root, 'src/main.ts'), 'utf8');
const config = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const policy = Object.entries(config.app.security.csp).map(([key, value]) => `${key} ${value}`).join('; ');
const fixtures = await Promise.all(['01-sma', '02-range-pane', '03-marker-style', '04-canvas', '05-panel']
  .map(async name => ({ name, source: await readFile(path.join(root, `fixtures/user-indicators/${name}.tfi`), 'utf8') })));
const probe = (await readFile(new URL('./ai-desktop-probe.txt', import.meta.url), 'utf8'))
  .replace('__TF_A3_SETTINGS__', JSON.stringify({ runId, nonce, fixtures, policy }));
await build({
  root, configFile: false, logLevel: 'warn',
  define: { 'import.meta.env.VITE_TRADEFLOW_USER_INDICATOR_E2E': JSON.stringify('0') },
  plugins: [{ name: 'tradeflow-ai-a3-private-probe', enforce: 'pre', transform(source, id) {
    if (id.split('?')[0] !== path.join(root, 'src/main.ts')) return;
    assert.ok(source === originalMain, 'main.ts changed during test preparation; restart on a stable baseline.');
    return `${source}\n${probe}`;
  } }],
  build: { outDir: dist, emptyOutDir: true },
});
assert.ok(await readFile(path.join(root, 'src/main.ts'), 'utf8') === originalMain, 'Test must not edit main.ts.');
const results = [];
const launcherExits = [];
let phase = 'initial';
let reportResolve;
let fatal;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const address = server.address();
    const host = `127.0.0.1:${address.port}`;
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      res.writeHead(403); res.end(); return;
    }
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === `/__tf_a3/${nonce}`) {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ phase })); return;
      }
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') {
        res.writeHead(405); res.end(); return;
      }
      let bytes = 0; const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) throw Error('test report exceeds byte budget');
        chunks.push(chunk);
      }
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(message.runId, runId); assert.equal(message.phase, phase);
      if (message.kind === 'screenshot') {
        assert.match(message.name, /^[a-z0-9-]{1,64}$/);
        assert.match(message.png, /^data:image\/png;base64,/);
        await writeFile(path.join(output, `${phase}-${message.name}.png`), Buffer.from(message.png.split(',')[1], 'base64'));
        console.log(`A3 screenshot: ${phase}-${message.name}.png`);
      } else {
        results.push(message);
        console.log(`A3 ${phase}: ${JSON.stringify(message)}`);
        await writeFile(path.join(output, 'results.json'), JSON.stringify({ runId, results }, null, 2));
      }
      res.writeHead(200); res.end('ok');
      if (message.kind === 'complete' || message.kind === 'failure') reportResolve?.(message);
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    const filename = path.resolve(dist, relative);
    if (!filename.startsWith(`${dist}${path.sep}`)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(filename);
    res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream',
      'Content-Security-Policy': policy, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (error) {
    if (!res.headersSent) res.writeHead(400);
    res.end('test request rejected');
    console.error('A3 server:', error.message);
  }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const merged = {
  identifier: `com.tradeflow.lite.a3-${runId}`, productName: 'TradeFlow Lite AI A3 Test',
  build: { beforeDevCommand: '', beforeBuildCommand: '', devUrl: origin },
  app: {
    windows: [{ ...config.app.windows[0], label: 'main', title: `TradeFlow Lite AI A3 · ${runId.slice(0, 8)}`,
      width: 1200, height: 760 }],
    security: { devCsp: config.app.security.csp, capabilities: ['default', {
      identifier: 'ai-a3-test-close', description: 'Close only the isolated A3 test window after reporting.',
      windows: ['main'], permissions: ['core:window:allow-close'],
    }] },
  },
};
console.log(`A3 isolated run: ${runId}\nA3 origin: ${origin}\nA3 artifacts: ${output}`);
let child;
async function stopOwnChild() {
  if (!child) return;
  const owned = child; child = undefined;
  if (owned.exitCode !== null || owned.signalCode !== null) return { forced: false, code: owned.exitCode, signal: owned.signalCode };
  const exited = new Promise(resolve => owned.once('exit', resolve));
  // The probe closes its own window through a test-only Tauri capability. Wait
  // for normal shutdown before considering termination of our launcher group.
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2500))]);
  if (owned.exitCode !== null || owned.signalCode !== null) return { forced: false, code: owned.exitCode, signal: owned.signalCode };
  try { process.kill(-owned.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2500))]);
  assert.ok(owned.exitCode !== null || owned.signalCode !== null, 'private test launcher did not stop');
  return { forced: true, code: owned.exitCode, signal: owned.signalCode };
}
const shutdown = async () => { await stopOwnChild(); server.close(); };
process.once('SIGINT', () => void shutdown().finally(() => process.exit(130)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(143)));
try {
  for (phase of ['initial', 'restart']) {
    const report = new Promise(resolve => { reportResolve = resolve; });
    child = spawn(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'),
      'dev', '--no-watch', '--config', JSON.stringify(merged)], {
      cwd: root, env: { ...process.env, TRADEFLOW_WORKSPACE_ROOT: path.join(output, 'workspace-state'),
        CARGO_TERM_COLOR: 'never', CARGO_TERM_PROGRESS_WHEN: 'never',
        CARGO_BUILD_JOBS: '2', CARGO_TARGET_DIR: path.join(root, 'src-tauri/target/ai-desktop-smoke-cargo') },
      stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => process.stderr.write(data));
    child.once('exit', (code, signal) => console.log(`A3 launcher exit (${phase}): code=${code} signal=${signal}`));
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ kind: 'failure', reason: `test App exited: ${code}/${signal}` }));
    });
    let timeout;
    const result = await Promise.race([report, exited, new Promise(resolve => {
      timeout = setTimeout(() => resolve({ kind: 'failure', reason: 'test App/probe timed out' }), 300_000);
    })]);
    clearTimeout(timeout);
    const exit = await stopOwnChild();
    launcherExits.push({ phase, ...exit });
    assert.equal(result.kind, 'complete', JSON.stringify(result));
    assert.ok(exit && !exit.forced && exit.code === 0 && exit.signal === null,
      'Normal-close acceptance cannot use a forcibly terminated launcher.');
  }
} catch (error) { fatal = error; console.error('A3 runner failure:', error.message); }
finally { await shutdown(); }
const finalFingerprint = await desktopSourceFingerprint(root);
const stableSource = sourceFingerprint.sha256 === finalFingerprint.sha256;
await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({
  runId, origin, sourceFingerprint, finalFingerprint, stableSource, launcherExits,
  passed: !fatal && stableSource, failure: fatal?.message ?? null,
}, null, 2));
if (!stableSource) {
  console.error('A3 local build inputs changed concurrently; output is diagnostic, not stable-source acceptance.');
  fatal ??= new Error('A3 local source fingerprint changed during the run.');
}
if (fatal) throw fatal;
releaseLease();
console.log(`A3 real Tauri WebView: both process launches passed. Evidence: ${output}`);
