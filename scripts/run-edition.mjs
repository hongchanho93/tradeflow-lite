import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [edition, command = 'dev', ...extra] = process.argv.slice(2);
if (!['cn','global'].includes(edition) || !['dev','build'].includes(command)) {
  console.error('usage: node scripts/run-edition.mjs <cn|global> <dev|build> [tauri args...]');
  process.exit(2);
}

const isWindows = process.platform === 'win32';
const executable = isWindows ? process.execPath : 'npx';
const tauriCommand = isWindows
  ? [fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url))]
  : ['tauri'];
const releaseConfig = command === 'build' ? ['--config', 'src-tauri/tauri.release.conf.json'] : [];
if (command === 'build' && isWindows) releaseConfig[1] = 'src-tauri/tauri.windows.release.conf.json';
const editionFeatures = edition === 'cn' ? ['--features', 'provider-tdx'] : [];
const child = spawn(executable, [...tauriCommand, command, ...releaseConfig, ...editionFeatures, ...extra], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    TRADEFLOW_LITE_EDITION: edition,
    VITE_TRADEFLOW_LITE_EDITION: edition,
  },
  stdio: 'inherit',
  shell: false,
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`tauri ${command} stopped by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
