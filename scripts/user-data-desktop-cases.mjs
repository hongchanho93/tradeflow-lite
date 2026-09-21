import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { singleListenerPid } from './ai-desktop-run-guard.mjs';
import { CSV_CONNECTOR_SOURCE } from '../src/user-data/csv-example.ts';

export async function createUserDataDesktopCases({ root, output, title, command, test, capture, requests = () => 0 }) {
  const fixtureRoot = path.join(output, 'user-data-fixtures');
  const csv = 'time,open,high,low,close,volume\n' + Array.from({ length: 8 }, (_, i) => `${1700000000 + i * 86400},1,3,1,2,${100 + i}`).join('\n') + '\n';
  const originalFiles = [];
  for (const directory of ['行情数据', 'disabled', 'replaced']) {
    await mkdir(path.join(fixtureRoot, directory), { recursive: true });
    for (const name of ['SH_600000.csv', 'SZ_000001.csv']) {
      const filename = path.join(fixtureRoot, directory, name); await writeFile(filename, csv); originalFiles.push(filename);
    }
  }
  await writeFile(path.join(fixtureRoot, 'outside.txt'), 'PRIVATE_FIXTURE_OUTSIDE_NOT_AUTHORIZED');
  await symlink('../outside.txt', path.join(fixtureRoot, '行情数据', 'z_outside.csv'));
  const hashes = new Map(await Promise.all(originalFiles.map(async filename => [filename, createHash('sha256').update(await readFile(filename)).digest('hex')])));
  const probe = (op, input = {}) => command('user-data', { op, ...input });
  const sources = async () => (await probe('state')).sources;
  const run = (executable, args) => new Promise((resolve, reject) => {
    const process = spawn(executable, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    process.stdout.on('data', value => { stdout += value; }); process.stderr.on('data', value => { stderr = (stderr + value).slice(-2500); });
    process.once('error', reject); process.once('exit', code => code === 0 ? resolve(stdout.trim()) : reject(Error(`private data helper failed (${code}): ${stderr}`)));
  });
  async function select(port, directory, mode = 'choose', replacementId) {
    const pid = singleListenerPid(await run('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']));
    const previous = await sources(); await probe('pick-start', replacementId ? { sourceId: replacementId } : {});
    try {
      await run('/usr/bin/swift', [path.join(root, 'scripts/user-data-picker.swift'), title, pid,
        path.join(root, 'src-tauri/target/ai-desktop-smoke-cargo'), fixtureRoot, mode, directory]);
    } catch (error) { await capture('user-data-picker-failure', port); throw error; }
    const result = await probe('pick-finished');
    if (mode === 'cancel') { assert.deepEqual(result.sources.map(row => row.id), previous.map(row => row.id)); return; }
    const selected = replacementId ? result.sources.find(row => row.id === replacementId) : result.sources.find(row => !previous.some(old => old.id === row.id));
    assert.ok(selected, `native picker did not authorize the fixture: ${result.status}`); assert.equal(selected.state, 'ready');
    return selected;
  }
  let main, disabled, replaced, revision;
  return {
    probe, sources, select, fixtureRoot,
    get main() { return main; },
    async setup(port, restartCases = true) {
      await test('data: native picker cancellation grants nothing', () => select(port, '行情数据', 'cancel'));
      await test('data: native directory choice creates an opaque grant, not a model-supplied path', async () => {
        const before = requests(); main = await select(port, '行情数据');
        assert.equal(main.status, 'needs_connector'); assert.equal(JSON.stringify(main).includes(fixtureRoot), false); assert.equal(requests(), before);
      });
      await test('data: ordinary file import validates in a real Worker then installs into the common registry', async () => {
        const imported = await probe('import', { sourceId: main.id, source: CSV_CONNECTOR_SOURCE });
        assert.equal(imported.previewClosed, true); assert.equal(imported.source.status, 'connected');
        const proof = await probe('verify', { sourceId: main.id }); assert.equal(proof.rowCount, 3); assert.ok(proof.nextCursor);
      });
      await test('data: AI handoff is an unsent message and creates no model request', async () => {
        const before = requests(); assert.equal((await probe('handoff', { sourceId: main.id })).drafted, true); assert.equal(requests(), before);
      });
      await test('data: real native reads reject an escaping symlink and an invented directory grant', async () => {
        const result = await probe('boundary', { sourceId: main.id }); assert.equal(result.escapeDenied, true); assert.equal(result.unknownDenied, true);
      });
      await test('data: minimum sidebar, wide sidebar and light theme remain bounded', async () => {
        await probe('layout', { width: 280 }); await capture('user-data-narrow', port);
        await probe('layout', { width: 520, toggleTheme: true }); await capture('user-data-light', port);
        await probe('layout', { width: 440, toggleTheme: true });
      });
      if (restartCases) {
        disabled = await select(port, 'disabled'); await probe('import', { sourceId: disabled.id, source: CSV_CONNECTOR_SOURCE });
        await probe('manage', { sourceId: disabled.id, operation: 'disable' });
        replaced = await select(port, 'replaced'); await probe('import', { sourceId: replaced.id, source: CSV_CONNECTOR_SOURCE });
      }
      // Leave ordinary chat selected for the existing API/MCP acceptance cases.
      await probe('handoff', { sourceId: main.id });
      return main;
    },
    async beforeRestart() {
      revision = (await sources()).find(row => row.id === main.id).revision;
      await rename(path.join(fixtureRoot, 'replaced'), path.join(fixtureRoot, 'replaced-original'));
      await mkdir(path.join(fixtureRoot, 'replaced')); await writeFile(path.join(fixtureRoot, 'replaced', 'SH_600000.csv'), csv.replaceAll(',2,', ',999,'));
    },
    async afterRestart() {
      await test('data: real restart restores the same selected directory with a fresh revision and query', async () => {
        const proof = await probe('verify', { sourceId: main.id }); assert.notEqual(proof.source.revision, revision); assert.equal(proof.rows[0].close, 2);
      });
      await test('data: disabled grants stay disabled; replaced directories cannot silently inherit authorization', async () => {
        const rows = await sources(); const off = rows.find(row => row.id === disabled.id), changed = rows.find(row => row.id === replaced.id);
        assert.equal(off.state, 'disabled'); assert.equal(off.toolName, undefined);
        assert.equal(changed.state, 'needs_directory'); assert.equal(changed.toolName, undefined);
      });
      await this.removeAll();
    },
    async removeAll() {
      await test('data: deleting connections removes tools and leaves every original data file unchanged', async () => {
        for (const row of await sources()) await probe('manage', { sourceId: row.id, operation: 'remove' });
        assert.equal((await sources()).length, 0);
        for (const [filename, hash] of hashes) {
          let actual = filename;
          if (revision && filename.startsWith(path.join(fixtureRoot, 'replaced') + path.sep)) actual = filename.replace(path.join(fixtureRoot, 'replaced') + path.sep, path.join(fixtureRoot, 'replaced-original') + path.sep);
          assert.equal(createHash('sha256').update(await readFile(actual)).digest('hex'), hash);
        }
      });
    },
    async afterDeletionRestart() {
      await test('data: deleted connections remain absent after another real process restart', async () => assert.equal((await sources()).length, 0));
    },
  };
}
