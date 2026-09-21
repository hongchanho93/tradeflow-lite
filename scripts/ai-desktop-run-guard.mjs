/** Test-run coordination only. Never inspect, terminate or adopt another process. */
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { userInfo } from 'node:os';

/** Resolve defaults from the real account; preserve explicit toolchain choices. */
export function desktopRuntimeEnvironment(env = process.env, home = userInfo().homedir) {
  return { ...env, HOME: home,
    CARGO_HOME: env.CARGO_HOME || path.join(home, '.cargo'),
    RUSTUP_HOME: env.RUSTUP_HOME || path.join(home, '.rustup') };
}

/** lsof -Fp also emits file records. Accept exactly one listener process, never
 * fall back to a process name or select the first of several owners. */
export function singleListenerPid(output) {
  const owners = [...new Set(output.split(/\r?\n/).filter(line => /^p[1-9]\d*$/.test(line)))];
  if (owners.length !== 1) throw new Error('private test listener must have exactly one owner');
  return owners[0].slice(1);
}

export function acquireDesktopRunLease(directory, runId) {
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'active-run.json');
  const owner = JSON.stringify({ runId, pid: process.pid });
  let fd;
  try { fd = openSync(filename, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('A3 run already holds the private build directory. Do not run two A3 launchers together.');
    throw error;
  }
  try { writeFileSync(fd, owner); } finally { closeSync(fd); }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { if (readFileSync(filename, 'utf8') === owner) unlinkSync(filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}

/** Record local build inputs, not just main.ts. Parallel edits invalidate acceptance. */
export async function desktopSourceFingerprint(root) {
  const files = [];
  async function walk(relative) {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      if (['target', 'node_modules', '.git'].includes(entry.name)) continue;
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`A3 source snapshot does not follow symlinks: ${name}`);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) files.push(name);
    }
  }
  for (const directory of ['src', 'fixtures', 'src-tauri/src', 'src-tauri/crates', 'src-tauri/capabilities']) await walk(directory);
  files.push('package.json', 'package-lock.json', 'index.html', 'tsconfig.json',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/build.rs', 'src-tauri/tauri.conf.json');
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(file); hash.update('\0'); hash.update(await readFile(path.join(root, file))); hash.update('\0');
  }
  return { sha256: hash.digest('hex'), files: files.length };
}
