/** Local developer preview. Stable app identity preserves its own OS-stored
 * connection; no account migration, model call, test probe or installed bundle. */
import assert from 'node:assert/strict';
import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acquireDesktopRunLease, desktopSourceFingerprint, desktopRuntimeEnvironment } from './ai-desktop-run-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = `assistant-preview-${randomUUID()}`;
const title = 'TradeFlow Lite AI — 单模式预览';
const identifier = 'com.tradeflow.lite.ai-preview';
const port = 5189;
const origin = `http://127.0.0.1:${port}`;
const directory = path.join(root, 'src-tauri/target/ai-dev-preview');
const output = path.join(directory, runId);
const dist = path.join(output, 'dist');
const release = acquireDesktopRunLease(path.join(root, 'src-tauri/target/ai-desktop-smoke'), runId);
process.once('exit', release);
await mkdir(output, { recursive: true });
const fingerprint = await desktopSourceFingerprint(root);
const config = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const csp = Object.entries(config.app.security.csp).map(([key, value]) => `${key} ${value}`).join('; ');
const state = { runId, title, identifier, port, launcherPid: process.pid, appLauncherPid: null,
  status: 'building', windowLoaded: false, fingerprint };
const report = async () => writeFile(path.join(directory, 'latest.json'), JSON.stringify(state, null, 2));
await report();
let app, server, log;
const stop = () => {
  if (app && app.exitCode === null && app.signalCode === null) {
    try { process.kill(-app.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
};
process.once('SIGTERM', stop); process.once('SIGINT', stop);
try {
  await build({ root, configFile: false, logLevel: 'warn',
    define: { 'import.meta.env.VITE_TRADEFLOW_USER_INDICATOR_E2E': JSON.stringify('0') },
    build: { outDir: dist, emptyOutDir: true } });
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'GET'); assert.equal(request.headers.host, `127.0.0.1:${port}`);
      const url = new URL(request.url, origin);
      const filename = path.resolve(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1));
      assert.ok(filename.startsWith(`${dist}${path.sep}`));
      const body = await readFile(filename);
      response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream',
        'Content-Security-Policy': csp, 'Cache-Control': 'no-store' }); response.end(body);
      if (url.pathname === '/' && !state.windowLoaded) { state.windowLoaded = true; await report(); }
    } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  log = await open(path.join(output, 'application.log'), 'a', 0o600);
  const merged = { identifier, productName: 'TradeFlow Lite AI Preview',
    build: { beforeDevCommand: '', beforeBuildCommand: '', devUrl: origin },
    app: { windows: [{ ...config.app.windows[0], label: 'main', title }], security: { devCsp: config.app.security.csp } } };
  app = spawn(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev', '--no-watch', '--config', JSON.stringify(merged)], {
    cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd],
    env: { ...desktopRuntimeEnvironment(),
      CARGO_BUILD_JOBS: '2', CARGO_TARGET_DIR: path.join(root, 'src-tauri/target/ai-desktop-smoke-cargo') },
  });
  state.appLauncherPid = app.pid; state.status = 'running'; await report();
  const result = await new Promise((resolve, reject) => { app.once('error', reject); app.once('exit', (code, signal) => resolve({ code, signal })); });
  state.status = 'closed'; state.exit = result; await report();
} catch (error) {
  state.status = 'failed'; state.error = error.message; await report(); throw error;
} finally {
  stop(); server?.closeAllConnections(); server?.close(); await log?.close(); release();
}
