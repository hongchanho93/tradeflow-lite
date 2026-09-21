/** macOS-only private P3-1 acceptance. Never launches or controls the installed/soak App. */
import assert from 'node:assert/strict';
import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acquireDesktopRunLease, desktopSourceFingerprint, desktopRuntimeEnvironment } from './ai-desktop-run-guard.mjs';

assert.equal(process.platform, 'darwin', 'This test requires a real macOS Tauri WebView.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = randomUUID();
const nonce = randomBytes(24).toString('hex');
const base = path.join(root, 'src-tauri/target/user-indicator-desktop-smoke');
const output = path.join(base, runId);
const dist = path.join(output, 'dist');
const releaseLease = acquireDesktopRunLease(base, runId);
process.once('exit', releaseLease);
await mkdir(output, { recursive: true });
const sourceFingerprint = await desktopSourceFingerprint(root);
const originalMain = await readFile(path.join(root, 'src/main.ts'), 'utf8');
const config = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const policy = Object.entries(config.app.security.csp).map(([key, value]) => `${key} ${value}`).join('; ');

let phase = 'initial';
let reportResolve;
const reporter = `
(() => {
  const endpoint = ${JSON.stringify(`/__tf_user_indicator/${nonce}`)};
  let sent = false;
  const send = async (kind, detail) => {
    if (sent) return;
    sent = true;
    try {
      const screenshot = kind === 'complete' ? chartScreenshot().toDataURL() : null;
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: ${JSON.stringify(runId)}, phase: ${JSON.stringify('PHASE_PLACEHOLDER')}, kind, detail, screenshot }),
      });
    } finally {
      await getCurrentWindow().close();
    }
  };
  const timer = window.setInterval(() => {
    const text = document.querySelector('#user-indicator-desktop-e2e-status')?.textContent ?? '';
    if (text.includes('USER_INDICATOR_E2E_FAIL')) {
      window.clearInterval(timer); void send('failure', text); return;
    }
    const expected = ${JSON.stringify('EXPECTED_PLACEHOLDER')};
    if (text.includes(expected)) {
      window.clearInterval(timer); void send('complete', text);
    }
  }, 100);
})();`;

const results = [];
let fatal;
let child;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const address = server.address();
    const host = `127.0.0.1:${address.port}`;
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      res.writeHead(403); res.end(); return;
    }
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === `/__tf_user_indicator/${nonce}`) {
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') {
        res.writeHead(405); res.end(); return;
      }
      let bytes = 0; const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) throw new Error('test report exceeds byte budget');
        chunks.push(chunk);
      }
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(message.runId, runId);
      assert.equal(message.phase, phase);
      if (typeof message.screenshot === 'string') {
        assert.match(message.screenshot, /^data:image\/png;base64,/);
        await writeFile(path.join(output, `${phase}.png`), Buffer.from(message.screenshot.split(',')[1], 'base64'));
      }
      results.push(message);
      await writeFile(path.join(output, 'results.json'), JSON.stringify({ runId, results }, null, 2));
      console.log(`P3-1 desktop ${phase}: ${message.kind} · ${String(message.detail).replace(/\n/g, ' | ')}`);
      res.writeHead(200); res.end('ok');
      reportResolve?.(message);
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    const filename = path.resolve(dist, relative);
    if (!filename.startsWith(`${dist}${path.sep}`)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(filename);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream',
      'Content-Security-Policy': policy,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    if (!res.headersSent) res.writeHead(400);
    res.end('test request rejected');
    console.error('P3-1 desktop server:', error.message);
  }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;

async function buildPhase(expected) {
  const injected = reporter
    .replace(JSON.stringify('PHASE_PLACEHOLDER'), JSON.stringify(phase))
    .replace(JSON.stringify('EXPECTED_PLACEHOLDER'), JSON.stringify(expected));
  await build({
    root, configFile: false, logLevel: 'warn',
    define: { 'import.meta.env.VITE_TRADEFLOW_USER_INDICATOR_E2E': JSON.stringify('1') },
    plugins: [{ name: 'tradeflow-user-indicator-private-reporter', enforce: 'pre', transform(source, id) {
      if (id.split('?')[0] !== path.join(root, 'src/main.ts')) return;
      assert.equal(source, originalMain, 'main.ts changed during private desktop preparation');
      return `${source}\n${injected}`;
    } }],
    build: { outDir: dist, emptyOutDir: true },
  });
}

const merged = {
  identifier: `com.tradeflow.lite.user-indicator-${runId}`,
  productName: 'TradeFlow Lite User Indicator Test',
  build: { beforeDevCommand: '', beforeBuildCommand: '', devUrl: origin },
  app: {
    windows: [{ ...config.app.windows[0], label: 'main', title: `TradeFlow Lite User Indicator · ${runId.slice(0, 8)}`,
      width: 1200, height: 760, focus: true, alwaysOnTop: true }],
    security: { devCsp: config.app.security.csp, capabilities: ['default', {
      identifier: 'user-indicator-test-close',
      description: 'Close only the isolated P3-1 test window after reporting.',
      windows: ['main'], permissions: ['core:window:allow-close'],
    }] },
  },
};

async function stopOwnChild() {
  if (!child) return;
  const owned = child; child = undefined;
  if (owned.exitCode !== null || owned.signalCode !== null) return;
  const exited = new Promise(resolve => owned.once('exit', resolve));
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
  if (owned.exitCode === null && owned.signalCode === null) {
    try { process.kill(-owned.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2500))]);
  }
  assert.ok(owned.exitCode !== null || owned.signalCode !== null, 'private P3-1 launcher did not stop');
}

try {
  console.log(`P3-1 isolated run: ${runId}\nP3-1 origin: ${origin}\nP3-1 artifacts: ${output}`);
  for (const item of [
    { name: 'initial', expected: 'USER_INDICATOR_E2E_PHASE1_PASS' },
    { name: 'restart', expected: 'USER_INDICATOR_E2E_PASS' },
  ]) {
    phase = item.name;
    await buildPhase(item.expected);
    const report = new Promise(resolve => { reportResolve = resolve; });
    child = spawn(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev', '--no-watch', '--config', JSON.stringify(merged)], {
      cwd: root,
      env: { ...desktopRuntimeEnvironment(), TRADEFLOW_WORKSPACE_ROOT: path.join(output, 'workspace-state'),
        CARGO_TERM_COLOR: 'never', CARGO_TERM_PROGRESS_WHEN: 'never', CARGO_BUILD_JOBS: '2',
        CARGO_TARGET_DIR: path.join(root, 'src-tauri/target/user-indicator-desktop-smoke-cargo') },
      stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => process.stderr.write(data));
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ kind: 'failure', detail: `test App exited: ${code}/${signal}` }));
    });
    let timeout;
    const result = await Promise.race([report, exited, new Promise(resolve => {
      timeout = setTimeout(() => resolve({ kind: 'failure', detail: 'test App/probe timed out' }), 300_000);
    })]);
    clearTimeout(timeout);
    await stopOwnChild();
    assert.equal(result.kind, 'complete', JSON.stringify(result));
  }
} catch (error) {
  fatal = error;
  console.error('P3-1 desktop runner failure:', error.message);
} finally {
  await stopOwnChild();
  server.close();
}

const finalFingerprint = await desktopSourceFingerprint(root);
const stableSource = sourceFingerprint.sha256 === finalFingerprint.sha256;
await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({
  runId, origin, sourceFingerprint, finalFingerprint, stableSource,
  passed: !fatal && stableSource,
  failure: fatal?.message ?? null,
}, null, 2));
if (!stableSource) fatal ??= new Error('P3-1 local source fingerprint changed during the run');
if (fatal) throw fatal;
releaseLease();
console.log(`P3-1 real Tauri WebView: initial + restart passed. Evidence: ${output}`);
