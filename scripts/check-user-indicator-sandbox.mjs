import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
} from 'quickjs-emscripten-core';
import { build } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quickJs = await newQuickJSWASMModuleFromVariant(variant);

function dumpError(context, result) {
  assert.ok('error' in result, 'expected QuickJS evaluation to fail');
  const dumped = context.dump(result.error);
  result.error.dispose();
  return String(dumped?.message ?? dumped);
}

function withRuntime(options, callback) {
  const runtime = quickJs.newRuntime();
  runtime.setMemoryLimit(options.memoryBytes ?? 32 * 1024 * 1024);
  runtime.setMaxStackSize(options.stackBytes ?? 512 * 1024);
  const context = runtime.newContext();
  try {
    return callback(runtime, context);
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

withRuntime({}, (runtime, context) => {
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 50));
  const started = performance.now();
  const result = context.evalCode('while (true) {}');
  const elapsed = performance.now() - started;
  runtime.removeInterruptHandler();
  assert.match(dumpError(context, result), /interrupted/i);
  assert.ok(elapsed < 500, `interrupt took ${elapsed.toFixed(1)}ms`);
});

withRuntime({ memoryBytes: 8 * 1024 * 1024 }, (_runtime, context) => {
  const result = context.evalCode('new Array(5_000_000).fill(123456)');
  assert.match(dumpError(context, result), /out of memory/i);
});

withRuntime({ stackBytes: 64 * 1024 }, (_runtime, context) => {
  const result = context.evalCode('(function recurse(){ return recurse(); })()');
  assert.match(dumpError(context, result), /stack overflow/i);
});

withRuntime({}, (_runtime, context) => {
  const result = context.evalCode(`({
    window: typeof window,
    document: typeof document,
    fetch: typeof fetch,
    WebSocket: typeof WebSocket,
    XMLHttpRequest: typeof XMLHttpRequest,
    indexedDB: typeof indexedDB,
    Worker: typeof Worker,
    SharedWorker: typeof SharedWorker,
    BroadcastChannel: typeof BroadcastChannel,
    localStorage: typeof localStorage,
    sessionStorage: typeof sessionStorage,
    __TAURI__: typeof __TAURI__
  })`);
  assert.ok('value' in result);
  const globals = context.dump(result.value);
  result.value.dispose();
  for (const [name, type] of Object.entries(globals)) {
    assert.equal(type, 'undefined', `${name} unexpectedly exists in QuickJS`);
  }
});

withRuntime({}, (_runtime, context) => {
  const result = context.evalCode("import x from 'not-allowed'; x");
  assert.match(dumpError(context, result), /could not load module|module/i);
});

await new Promise((resolve, reject) => {
  const worker = new NodeWorker('while (true) {}', { eval: true });
  const timer = setTimeout(async () => {
    try {
      const exitCode = await worker.terminate();
      assert.equal(exitCode, 1);
      resolve();
    } catch (error) {
      reject(error);
    }
  }, 50);
  worker.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

const buildResult = await build({
  configFile: false,
  root: projectRoot,
  logLevel: 'silent',
  build: {
    write: false,
    rollupOptions: {
      input: path.join(projectRoot, 'src/user-indicator-runtime/worker-factory.ts'),
    },
  },
});

const results = Array.isArray(buildResult) ? buildResult : [buildResult];
const output = results.flatMap((result) => result.output);
const workerOutput = output.find((item) => item.fileName.includes('runtime.worker'));
assert.ok(workerOutput, 'Vite did not emit the user-indicator worker bundle');
assert.ok(
  !output.some((item) => item.fileName.endsWith('.wasm')),
  'single-file QuickJS unexpectedly emitted a separate wasm asset',
);

console.log('user indicator sandbox contract: ok');
