import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import { USER_INDICATOR_RUNTIME_LIMITS } from '../src/user-indicator-runtime/limits.ts';
import { USER_INDICATOR_PROTOCOL_VERSION } from '../src/user-indicator-runtime/protocol.ts';
import { validateUserIndicatorSourceIsolated } from '../src/user-indicator-runtime/validator-client.ts';
import { validateUserIndicatorSource } from '../src/user-indicator-runtime/validator-engine.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const validSource = `
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.sma',
  indicatorVersion: 1,
  name: { 'zh-CN': '用户均线', 'en-US': 'User SMA' },
  description: 'Simple moving average',
  author: 'test',
  inputs: {
    period: { type: 'number', title: 'Period', default: 20, min: 1, max: 500, step: 1 },
    color: { type: 'color', title: 'Color', default: '#2962ff' }
  },
  supports: { seriesKinds: ['ohlcv'] },
  create() { return { update() {} }; }
});
`;

async function expectError(source, code) {
  const result = await validateUserIndicatorSource(source);
  assert.equal(result.ok, false, `expected ${code}, got success`);
  assert.equal(result.error.code, code, result.error.message);
  return result.error;
}

const valid = await validateUserIndicatorSource(validSource);
assert.equal(valid.ok, true, valid.ok ? undefined : valid.error.message);
assert.equal(valid.manifest.id, 'user.sma');
assert.equal(valid.manifest.inputs.period.type, 'number');
assert.equal(Object.isFrozen(valid.manifest), true);

const mtfSource = validSource.replace(
  "supports: { seriesKinds: ['ohlcv'] },",
  "supports: { seriesKinds: ['ohlcv'] },\n  data: { monthly: { resolution: '1M', count: 8000, adjustment: 'current' } },",
);
const mtfValid = await validateUserIndicatorSource(mtfSource);
assert.equal(mtfValid.ok, true, mtfValid.ok ? undefined : mtfValid.error.message);
assert.deepEqual(mtfValid.manifest.data.monthly, { resolution: '1M', count: 8000, adjustment: 'current' });
await expectError(mtfSource.replace("resolution: '1M'", "resolution: '2M'"), 'invalid_definition');
await expectError(mtfSource.replace('count: 8000', `count: ${USER_INDICATOR_RUNTIME_LIMITS.dataBarsPerRequest + 1}`), 'invalid_definition');

const crossSymbolSource = validSource.replace(
  "supports: { seriesKinds: ['ohlcv'] },",
  "supports: { seriesKinds: ['ohlcv'] },\n  data: { benchmark: { symbol: 'SH:000001', kind: 'index', resolution: '1D', count: 500, align: 'main' } },",
);
const crossSymbolValid = await validateUserIndicatorSource(crossSymbolSource);
assert.equal(crossSymbolValid.ok, true, crossSymbolValid.ok ? undefined : crossSymbolValid.error.message);
assert.deepEqual(crossSymbolValid.manifest.data.benchmark, {
  resolution: '1D', count: 500, symbol: 'SH:000001', kind: 'index', align: 'main',
});
await expectError(crossSymbolSource.replace("symbol: 'SH:000001'", "symbol: 'not-canonical'"), 'invalid_definition');
await expectError(crossSymbolSource.replace("align: 'main'", "align: 'nearest'"), 'invalid_definition');
await expectError(mtfSource.replace(
  "monthly: { resolution: '1M', count: 8000, adjustment: 'current' }",
  "monthly: { resolution: '1M', count: 8000, adjustment: 'current', kind: 'index' }",
), 'invalid_definition');
const tooManyCross = validSource.replace(
  "supports: { seriesKinds: ['ohlcv'] },",
  "supports: { seriesKinds: ['ohlcv'] },\n  data: { a:{symbol:'SH:000001',resolution:'1D'}, b:{symbol:'SH:000002',resolution:'1D'}, c:{symbol:'SH:000003',resolution:'1D'}, d:{symbol:'SH:000001',resolution:'1W'}, e:{symbol:'SH:000002',resolution:'1W'} },",
);
await expectError(tooManyCross, 'invalid_definition');
const tooManyDistinctCross = validSource.replace(
  "supports: { seriesKinds: ['ohlcv'] },",
  "supports: { seriesKinds: ['ohlcv'] },\n  data: { a:{symbol:'SH:000001',resolution:'1D'}, b:{symbol:'SH:000002',resolution:'1D'}, c:{symbol:'SH:000003',resolution:'1D'}, d:{symbol:'SH:000004',resolution:'1D'} },",
);
await expectError(tooManyDistinctCross, 'invalid_definition');

await expectError('', 'definition_missing');
await expectError(`${validSource}\ndefineIndicator({});`, 'definition_duplicate');
await expectError(validSource.replace("id: 'user.sma',", "id: 'user.sma', permissions: ['network'],"), 'invalid_definition');
await expectError(validSource.replace('formatVersion: 1', 'formatVersion: 2'), 'unsupported_format_version');
await expectError(validSource.replace('apiVersion: 1', 'apiVersion: 2'), 'unsupported_user_api_version');
await expectError(validSource.replace("create() { return { update() {} }; }", 'create: 123'), 'invalid_definition');
const realtimeSource = validSource.replace(
  "supports: { seriesKinds: ['ohlcv'] }",
  "supports: { seriesKinds: ['ohlcv'], marketKinds: ['crypto'], requires: { depth: true, trades: ['trade', 'aggregate-trade'] } }",
);
const realtimeValid = await validateUserIndicatorSource(realtimeSource);
assert.equal(realtimeValid.ok, true, realtimeValid.ok ? undefined : realtimeValid.error.message);
assert.deepEqual(realtimeValid.manifest.supports.requires, { depth: true, trades: ['trade', 'aggregate-trade'] });
await expectError(realtimeSource.replace("'aggregate-trade'", "'book-tick'"), 'invalid_definition');
const prototypePollutionError = await expectError(`
const inputs = JSON.parse('{"__proto__":{"type":"boolean","title":"x","default":true},"period":{"type":"number","title":"Period","default":20}}');
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.prototype-test',
  indicatorVersion: 1,
  name: 'Prototype Test',
  inputs,
  supports: { seriesKinds: ['ohlcv'] },
  create() { return { update() {} }; }
});`, 'invalid_definition');
assert.equal(prototypePollutionError.field, 'inputs.__proto__');
const tamperedBuiltins = await validateUserIndicatorSource(
  validSource.replace(
    'defineIndicator({',
    "JSON.stringify = () => 'tampered'; Object.keys = () => ['bad'];\ndefineIndicator({",
  ),
);
assert.equal(tamperedBuiltins.ok, true, tamperedBuiltins.ok ? undefined : tamperedBuiltins.error.message);
await expectError("import x from 'not-allowed';\n" + validSource, 'runtime_exception');
await expectError('await Promise.resolve();\n' + validSource, 'runtime_exception');
await expectError(`Promise.resolve().then(() => { ${validSource} });`, 'async_not_supported');
await expectError(
  `Promise.resolve().then(function loop(){ Promise.resolve().then(loop); });`,
  'async_not_supported',
);

await expectError('new Array(8_000_000).fill(123456);', 'memory_limit_exceeded');
await expectError('(function recurse(){ return recurse(); })();', 'stack_limit_exceeded');

const timeoutStarted = performance.now();
await expectError('while (true) {}', 'execution_timeout');
assert.ok(performance.now() - timeoutStarted < 1_000, 'validator timeout did not interrupt promptly');

await expectError(' '.repeat(USER_INDICATOR_RUNTIME_LIMITS.sourceBytes + 1), 'source_too_large');

const largeDefinitionError = await expectError(`
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.large-definition',
  indicatorVersion: 1,
  name: 'Large',
  description: 'x'.repeat(${USER_INDICATOR_RUNTIME_LIMITS.definitionSnapshotBytes + 1024}),
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create() { return { update() {} }; }
});`, 'invalid_definition');
assert.match(largeDefinitionError.message, /snapshot exceeds/i);

class FakeValidatorWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  terminated = 0;
  posted = [];
  responder;

  constructor(responder) {
    this.responder = responder;
  }

  postMessage(message) {
    this.posted.push(message);
    this.responder?.(this, message);
  }

  terminate() {
    this.terminated += 1;
  }
}

let successWorker;
const isolatedSuccess = await validateUserIndicatorSourceIsolated(validSource, {
  hardTimeoutMs: 100,
  workerFactory: () => {
    successWorker = new FakeValidatorWorker((worker, request) => {
      queueMicrotask(() => worker.onmessage?.({
        data: {
          protocolVersion: USER_INDICATOR_PROTOCOL_VERSION,
          type: 'validate-source-result',
          requestId: request.requestId,
          result: valid,
        },
      }));
    });
    return successWorker;
  },
});
assert.equal(isolatedSuccess.ok, true);
assert.equal(successWorker.terminated, 1, 'validator Worker must terminate after success');

let staleWorker;
const staleThenSuccess = await validateUserIndicatorSourceIsolated(validSource, {
  hardTimeoutMs: 100,
  workerFactory: () => {
    staleWorker = new FakeValidatorWorker((worker, request) => {
      queueMicrotask(() => {
        worker.onmessage?.({
          data: {
            protocolVersion: USER_INDICATOR_PROTOCOL_VERSION,
            type: 'validate-source-result',
            requestId: 'stale-request',
            result: valid,
          },
        });
        worker.onmessage?.({
          data: {
            protocolVersion: USER_INDICATOR_PROTOCOL_VERSION,
            type: 'validate-source-result',
            requestId: request.requestId,
            result: valid,
          },
        });
      });
    });
    return staleWorker;
  },
});
assert.equal(staleThenSuccess.ok, true);
assert.equal(staleWorker.terminated, 1, 'stale response must not prevent final termination');

let timeoutWorker;
const hardTimeout = await validateUserIndicatorSourceIsolated(validSource, {
  hardTimeoutMs: 20,
  workerFactory: () => {
    timeoutWorker = new FakeValidatorWorker();
    return timeoutWorker;
  },
});
assert.equal(hardTimeout.ok, false);
assert.equal(hardTimeout.error.code, 'execution_timeout');
assert.equal(timeoutWorker.terminated, 1, 'validator Worker must hard terminate on timeout');

let errorWorker;
const workerFailure = await validateUserIndicatorSourceIsolated(validSource, {
  hardTimeoutMs: 100,
  workerFactory: () => {
    errorWorker = new FakeValidatorWorker((worker) => {
      queueMicrotask(() => worker.onerror?.({ message: 'boom', preventDefault() {} }));
    });
    return errorWorker;
  },
});
assert.equal(workerFailure.ok, false);
assert.equal(workerFailure.error.code, 'runtime_exception');
assert.equal(errorWorker.terminated, 1, 'validator Worker must terminate after worker error');

const buildResult = await build({
  configFile: false,
  root: projectRoot,
  logLevel: 'silent',
  build: {
    write: false,
    rollupOptions: {
      input: path.join(projectRoot, 'src/user-indicator-runtime/validator-worker-factory.ts'),
    },
  },
});
const results = Array.isArray(buildResult) ? buildResult : [buildResult];
const output = results.flatMap((result) => result.output);
assert.ok(output.some((item) => item.fileName.includes('validator.worker')), 'Vite did not emit validator worker');
assert.ok(!output.some((item) => item.fileName.endsWith('.wasm')), 'validator worker emitted separate wasm asset');

console.log('user indicator validator contract: ok');
