import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { UserIndicatorLibrary, userIndicatorSourceHash } from '../src/user-indicator-runtime/library.ts';
import * as libraryApi from '../src/user-indicator-runtime/library.ts';
import { USER_INDICATOR_RUNTIME_LIMITS as limits } from '../src/user-indicator-runtime/limits.ts';

const good = { id: 'user.recovery', source: '// source', sourceHash: await userIndicatorSourceHash('// source'),
  indicatorVersion: 1, apiVersion: 1, importedAt: 1, updatedAt: 1, validatorVersion: 1,
  manifest: { formatVersion: 1, apiVersion: 1, id: 'user.recovery', indicatorVersion: 1,
    name: 'Recovery', inputs: {}, supports: { seriesKinds: ['ohlcv'] } } };

for (const [name, mutate] of [
  ['missing inputs', value => { delete value.manifest.inputs; }],
  ['missing supports', value => { delete value.manifest.supports; }],
  ['invalid input schema', value => { value.manifest.inputs = { length: { type: 'select', options: null } }; }],
  ['invalid applicability', value => { value.manifest.supports.marketKinds = 'stock'; }],
  ['unsupported API', value => { value.apiVersion = value.manifest.apiVersion = 999; }],
  ['unsupported format', value => { value.manifest.formatVersion = 999; }],
  ['unsafe key', value => { value.manifest.inputs = JSON.parse('{"__proto__":{"type":"number","title":"n","default":1}}'); }],
  ['unexpected field', value => { value.manifest.create = 'not a function'; }],
]) test(`stored manifest: ${name} is quarantined without losing valid records`, async () => {
  const bad = structuredClone(good); mutate(bad);
  const valid = structuredClone(good); valid.id = valid.manifest.id = 'user.valid';
  const records = [bad, valid];
  const library = new UserIndicatorLibrary({ async list() { return structuredClone(records); }, async get() { return structuredClone(bad); } });
  const scan = await library.scan();
  assert.deepEqual(scan.records.map(record => record.id), ['user.valid']);
  assert.equal(scan.corruptEntries.length, 1);
  await assert.rejects(() => library.get(bad.id), { code: 'storage_corrupt' });
  assert.equal(records.length, 2, 'validation must not erase user content');
});

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const bootstrap = stripTypeScriptTypes(main.slice(main.indexOf('async function bootstrapApplication()'), main.indexOf('\nvoid bootstrapApplication();')));

for (const finalHeight of [157, 90]) test(`desktop restart gate waits for asynchronous pane layout and still rejects a wrong height (${finalHeight})`, async () => {
  let height = 0;
  const source = main.slice(main.indexOf('async function userIndicatorDesktopE2eVerifyRestored('), main.indexOf('\nasync function runUserIndicatorDesktopE2e('));
  const globals = {
    userIndicatorRuntime: { get: () => ({ running: true, inputs: { period: 5 }, visible: false }) },
    indicatorChartHost: { series: () => [{}], pane: () => ({ getHeight: () => height }), visualPaneTargets: () => [{ key: 'main' }] },
    loadedIndicatorState: { instances: [{ instanceId: 'range', panes: [{ key: 'range', height: 157 }] }] },
    localStorage: { getItem: () => null }, USER_INDICATOR_DESKTOP_E2E_BEFORE_UNLOAD_KEY: 'before', USER_INDICATOR_DESKTOP_E2E_BOOTSTRAP_TRACE_KEY: 'trace',
    userIndicatorDesktopE2eAssert: (ok, message) => assert.ok(ok, message), userIndicatorDesktopE2ePanelHost: () => ({}),
    userIndicatorDesktopE2eWait: async (_label, predicate) => { if (!predicate()) height = finalHeight; assert.ok(predicate()); },
  };
  vm.createContext(globals); vm.runInContext(stripTypeScriptTypes(source), globals);
  const run = () => globals.userIndicatorDesktopE2eVerifyRestored({ 'fixture.sma': 'sma', 'fixture.range-pane': 'range', 'fixture.canvas': 'canvas' });
  if (finalHeight === 157) await assert.doesNotReject(run); else await assert.rejects(run, /height not restored/);
});

for (const [name, fileName, size, actual, expectedReads, errorCode] of [
  ['oversized metadata', 'huge.tfi', 1024 ** 3, 0, 0, 'source_too_large'],
  ['wrong extension', 'bad.bin', 1, 1, 0, 'invalid_extension'],
  ['actual oversized content', 'changed.tfi', 1, limits.sourceBytes + 1, 1, 'source_too_large'],
  ['valid boundary', 'valid.TFI', limits.sourceBytes, limits.sourceBytes, 1, null],
]) test(`file preflight: ${name}`, async () => {
  let reads = 0, validations = 0;
  const globals = { Uint8Array, aiIndicatorLibraryBusy: false, readUserIndicatorFile: libraryApi.readUserIndicatorFile,
    userIndicatorLibrary: { async prepareImport() { validations++; return { disposition: 'new' }; } },
    openUserIndicatorImportPreview() {},
  };
  const source = main.slice(main.indexOf('async function prepareUserIndicatorFile('), main.indexOf('\nasync function confirmUserIndicatorLibraryChange('));
  vm.createContext(globals); vm.runInContext(stripTypeScriptTypes(source), globals);
  const file = { name: fileName, size, async arrayBuffer() { reads++; return new ArrayBuffer(actual); } };
  if (errorCode) await assert.rejects(() => globals.prepareUserIndicatorFile(file), { code: errorCode });
  else await globals.prepareUserIndicatorFile(file);
  assert.equal(reads, expectedReads);
  assert.equal(validations, errorCode ? 0 : 1);
});

for (const stage of ['pane', 'user', 'trusted']) test(`bootstrap isolates ${stage} restore failure and still opens market history`, async () => {
  const saved = id => ({ instanceId: id, indicatorId: good.id, runtimeKind: 'user', sourceHash: good.sourceHash,
    indicatorVersion: 1, panes: [{ key: 'custom', height: 140 }], inputs: { period: 12 }, visible: true, menuOrder: 0 });
  const broken = saved('broken'); if (stage === 'trusted') { broken.runtimeKind = 'trusted'; broken.indicatorId = 'builtin.ma'; }
  const restored = [], removed = [], calls = [];
  const runtime = {
    add(config) { if (config.instanceId === 'broken' && stage !== 'pane') throw new Error('synthetic restore failure'); restored.push(config.instanceId); },
    remove(id) { removed.push(id); },
  };
  const noop = () => {};
  const globals = {
    console: { error: noop, warn: noop }, localStorage: {},
    workspaceStorage: { native: {}, getItem: () => 'done', setItem: noop }, indicatorRegistry: { list: () => [] },
    // A deliberately unfinished local data restore must not block chart startup.
    userDataController: { initialize() { calls.push('data-restore-started'); return new Promise(() => {}); } },
    // A pending task-library restore is equally independent of foreground startup.
    userTaskController: { initialize() { calls.push('task-restore-started'); return new Promise(() => {}); } },
    registerExternalIndicators: async () => [], showChartToast: message => calls.push(message),
    activeIndicators: new Set(), hiddenSeries: new Set(),
    loadIndicatorState: () => ({ mainOverlayOrder: [], instances: [broken, saved('healthy')], unresolvedEntries: [] }),
    loadedIndicatorState: null, userIndicatorStore: null, userIndicatorLibrary: null, userIndicatorRecords: new Map(),
    IndexedDbUserIndicatorStore: class {}, MirroredUserIndicatorStore: class {},
    UserIndicatorLibrary: class { async scan() { return { records: [good], corruptEntries: [] }; } },
    resolveUserIndicatorStateEntries: () => ({ instances: [], unresolvedEntries: [] }),
    indicatorInstanceOrder: [], indicatorStateReady: false,
    indicatorChartHost: { restorePaneStates(id) { if (id === 'broken' && stage === 'pane') throw new Error('synthetic pane restore failure'); } },
    userIndicatorRuntime: runtime, indicatorRuntime: runtime,
    currentChartType: 'candles', currentPriceScale: {}, volumeVisible: true, tradingTimeChoice: 'local',
    defaultSymbol: {}, currentResolution: '1', currentAdjustment: 'none', window: { setInterval: noop },
    openHistory: async () => calls.push('history-opened'), USER_INDICATOR_DESKTOP_E2E: false,
  };
  for (const name of ['userIndicatorDesktopE2eTraceBootstrap', 'renderIndicatorPicker', 'applyChartType', 'applyPriceScale',
    'setVolumeActive', 'applyMainSeriesOrder', 'applyIndicatorInstanceOrder', 'renderIndicatorLegends',
    'renderSecondaryPaneOrder', 'renderWatchlist', 'renderResolutionControls', 'applyTradingTimeChoice', 'loadMarketCatalogs']) globals[name] = noop;
  globals.applyChartType = (_type, _range, persist = true) => calls.push(`chart-persist:${persist}`);
  vm.createContext(globals); vm.runInContext(bootstrap, globals);
  await assert.doesNotReject(() => globals.bootstrapApplication());
  assert.deepEqual(restored, ['healthy']);
  assert.equal(calls.includes('history-opened'), true);
  assert.equal(calls.filter(value => value === 'data-restore-started').length, 1);
  assert.equal(calls.filter(value => value === 'task-restore-started').length, 1);
  assert.equal(globals.loadedIndicatorState.unresolvedEntries.some(item => item.instanceId === 'broken'), true);
  assert.deepEqual(globals.loadedIndicatorState.unresolvedEntries.find(item => item.instanceId === 'broken'), broken);
  assert.equal(removed.includes('broken'), true);
  assert.ok(calls.includes('chart-persist:false'), 'bootstrap must not save empty live pane state before user Workers restore it');
});
