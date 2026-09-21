import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acquireDesktopRunLease, desktopSourceFingerprint, singleListenerPid } from './ai-desktop-run-guard.mjs';
import * as guard from './ai-desktop-run-guard.mjs';

assert.equal(singleListenerPid('p80439\nf17\n'), '80439');
assert.equal(singleListenerPid('p123\nf17\nf18\np123\nf19\n'), '123');
assert.throws(() => singleListenerPid('p123\nf17\np456\nf18'), /exactly one owner/);
assert.throws(() => singleListenerPid('f17\n'), /exactly one owner/);

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const runner = read('scripts/run-ai-desktop-smoke.mjs');
const probe = read('scripts/ai-desktop-probe.txt');
const main = read('src/main.ts');

test('desktop environment uses the OS account, not the tool temporary HOME', () => {
  assert.equal(typeof guard.desktopRuntimeEnvironment, 'function');
  const original = { HOME: '/temporary/tool', PATH: '/bin' };
  const result = guard.desktopRuntimeEnvironment(original, '/Users/another-user');
  assert.equal(result.HOME, '/Users/another-user');
  assert.equal(result.CARGO_HOME, '/Users/another-user/.cargo');
  assert.equal(result.RUSTUP_HOME, '/Users/another-user/.rustup');
  assert.equal(result.PATH, original.PATH);
  assert.equal(original.HOME, '/temporary/tool');
  assert.equal(original.CARGO_HOME, undefined);
});
test('desktop environment preserves explicitly selected Rust dependency directories', () => {
  assert.equal(typeof guard.desktopRuntimeEnvironment, 'function');
  const result = guard.desktopRuntimeEnvironment({ CARGO_HOME: '/custom/cargo', RUSTUP_HOME: '/custom/rustup' }, '/home/other');
  assert.equal(result.CARGO_HOME, '/custom/cargo'); assert.equal(result.RUSTUP_HOME, '/custom/rustup');
});
for (const file of ['run-user-indicator-desktop-smoke.mjs', 'run-ai-dev-preview.mjs']) test(`${file} uses the portable environment`, () => {
  const source = read(`scripts/${file}`);
  assert.doesNotMatch(source, /\/Users\/jim/);
  assert.match(source, /\.\.\.desktopRuntimeEnvironment\(\)/);
});

test('MCP screenshot preparation shows only its own window and waits for visible paint', async () => {
  const source = read('scripts/ai-mcp-desktop-probe.txt');
  const start = source.indexOf('async function prepareTestCapture('), end = source.indexOf('\n  const click', start);
  assert.ok(start >= 0 && end > start, 'MCP capture preflight is missing');
  const calls = [], frames = [], document = { visibilityState: 'hidden' };
  const getCurrentWindow = () => ({ async show() { calls.push('show'); document.visibilityState = 'visible'; }, async setFocus() { calls.push('focus'); } });
  const wait = async (predicate) => { while (!predicate() && frames.length) frames.shift()(); assert.ok(predicate()); };
  const prepare = new Function('getCurrentWindow', 'document', 'requestAnimationFrame', 'wait',
    `${source.slice(start, end)};return prepareTestCapture;`)(getCurrentWindow, document, callback => frames.push(callback), wait);
  await prepare(); assert.deepEqual(calls, ['show', 'focus']); assert.equal(frames.length, 0);
  const captureRunner = read('scripts/run-ai-mcp-desktop-smoke.mjs');
  assert.match(captureRunner, /await command\('prepare-capture'\)/);
  assert.match(captureRunner, /singleListenerPid\(owner\)/);
  assert.match(read('scripts/ai-test-window.swift'), /kCGWindowOwnerPID/);
  assert.match(read('scripts/ai-test-window.swift'), />= 900/);
});

// QuickJS compiles only its bundled WASM. This is not permission for JS eval,
// remote scripts, blob workers, unrestricted connections or unknown modules.
for (const policy of [config.app.security.csp, config.app.security.devCsp]) {
  assert.equal(policy['script-src'], "'self' 'wasm-unsafe-eval'", 'WASM must be enabled without enabling JavaScript eval');
  assert.equal(policy['worker-src'], "'self'", 'user indicator Workers must come from bundled code');
  assert.doesNotMatch(policy['script-src'], /(?:^|\s)'unsafe-eval'(?:\s|$)|https:|data:|blob:/);
}
assert.equal(config.app.security.csp['connect-src'], "'self' ipc: http://ipc.localhost");
assert.equal(config.app.security.csp['frame-src'], "'none'");
assert.ok(config.app.windows.every(window => !window.title.includes('A3')), 'test window must not leak to normal configuration');
assert.doesNotMatch(main, /__TF_A3_SETTINGS__|\/__tf_a3\/|ai-desktop-probe/);
assert.match(runner, /configFile: false/);
assert.match(runner, /enforce: 'pre'/);
assert.match(runner, /server\.listen\(0, '127\.0\.0\.1'/);
assert.match(runner, /req\.headers\.host !== host/);
assert.match(runner, /req\.headers\.origin !== `http:\/\/\$\{host\}`/);
assert.match(runner, /randomBytes\(24\)/);
assert.match(runner, /Content-Security-Policy': policy/);
assert.match(runner, /300_000/);
assert.match(runner, /CARGO_TARGET_DIR: path\.join\(root, 'src-tauri\/target\/ai-desktop-smoke-cargo'\)/);
assert.match(runner, /'--no-watch'/);
assert.doesNotMatch(runner, /killall|pkill|SIGKILL|\.app\//);
assert.match(runner, /process\.kill\(-owned\.pid, 'SIGTERM'\)/);
assert.match(runner, /owned\.exitCode !== null \|\| owned\.signalCode !== null/);
assert.match(probe, /getCurrentWindow\(\)\.close\(\)/);
assert.match(probe, /__TAURI_INTERNALS__/);
assert.match(probe, /real WebView receives the current production CSP/);
assert.match(probe, /phase === 'restart'/);
assert.match(probe, /snapshot\/host mismatch/);
assert.match(probe, /drawingAttachments\.checkpoint\(\)\.length/);
assert.match(runner, /!exit\.forced && exit\.code === 0/);
assert.match(runner, /sourceFingerprint\.sha256 === finalFingerprint\.sha256/);
assert.match(runner, /'acceptance\.json'/);
assert.match(probe, /frame wait timed out; visibility=/);

// Generated fixtures only: exercise locking and source-change detection, not just regexes.
const temporaryParent = fileURLToPath(new URL('../src-tauri/target/', import.meta.url));
mkdirSync(temporaryParent, { recursive: true });
const temporary = mkdtempSync(path.join(temporaryParent, 'ai-desktop-guard-test-'));
try {
  const release = acquireDesktopRunLease(temporary, 'first');
  assert.throws(() => acquireDesktopRunLease(temporary, 'second'), /already holds/);
  release(); release();
  const releaseNext = acquireDesktopRunLease(temporary, 'second');
  writeFileSync(path.join(temporary, 'active-run.json'), 'another owner');
  releaseNext();
  assert.equal(readFileSync(path.join(temporary, 'active-run.json'), 'utf8'), 'another owner');

  for (const directory of ['src', 'fixtures', 'src-tauri/src', 'src-tauri/crates', 'src-tauri/capabilities']) {
    mkdirSync(path.join(temporary, directory), { recursive: true });
  }
  for (const file of ['package.json', 'package-lock.json', 'index.html', 'tsconfig.json',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/build.rs', 'src-tauri/tauri.conf.json']) {
    writeFileSync(path.join(temporary, file), 'fixture');
  }
  writeFileSync(path.join(temporary, 'src/main.ts'), 'same main');
  const first = await desktopSourceFingerprint(temporary);
  assert.deepEqual(await desktopSourceFingerprint(temporary), first);
  writeFileSync(path.join(temporary, 'src/another-module.ts'), 'changed dependency');
  assert.notEqual((await desktopSourceFingerprint(temporary)).sha256, first.sha256,
    'a dependency change must invalidate acceptance even if main.ts is unchanged');
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log('AI desktop opt-in harness and WASM-only CSP contract: OK');
