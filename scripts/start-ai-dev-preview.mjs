/** Launch the developer preview independently from the invoking terminal/tool.
 * The foreground preview process still owns its HTTP server and Tauri child,
 * but a caller timeout or closed MCP command no longer sends SIGTERM to it. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { desktopRuntimeEnvironment } from './ai-desktop-run-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, [path.join(root, 'scripts/run-ai-dev-preview.mjs')], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  env: desktopRuntimeEnvironment(),
});
child.unref();
process.stdout.write(String(child.pid));
