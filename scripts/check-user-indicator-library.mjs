import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateUserIndicatorSource } from '../src/user-indicator-runtime/validator-engine.ts';
import {
  USER_INDICATOR_VALIDATOR_VERSION,
  UserIndicatorLibrary,
  UserIndicatorLibraryError,
  decodeUserIndicatorFile,
  userIndicatorSourceHash,
} from '../src/user-indicator-runtime/library.ts';
import { USER_INDICATOR_RUNTIME_LIMITS } from '../src/user-indicator-runtime/limits.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class MemoryStore {
  constructor(entries = []) {
    this.records = new Map(entries.map((record) => [record.id, structuredClone(record)]));
    this.putCount = 0;
    this.deleteCount = 0;
  }
  async list() { return [...this.records.values()].map((value) => structuredClone(value)); }
  async get(id) { return this.records.has(id) ? structuredClone(this.records.get(id)) : null; }
  async put(record) {
    this.putCount += 1;
    this.records.set(record.id, structuredClone(record));
  }
  async delete(id) {
    this.deleteCount += 1;
    this.records.delete(id);
  }
}

function sourceFor(id, version = 1, suffix = '') {
  return `defineIndicator({
    formatVersion: 1,
    apiVersion: 1,
    id: ${JSON.stringify(id)},
    indicatorVersion: ${version},
    name: ${JSON.stringify(id)},
    inputs: {},
    supports: { seriesKinds: ['ohlcv'] },
    create() { return { update() {} }; },
  });${suffix}`;
}

function manifest(id, version = 1) {
  return Object.freeze({
    formatVersion: 1,
    apiVersion: 1,
    id,
    indicatorVersion: version,
    name: id,
    inputs: Object.freeze({}),
    supports: Object.freeze({ seriesKinds: Object.freeze(['ohlcv']) }),
  });
}

function assertLibraryError(callback, code, pattern) {
  return assert.rejects(callback, (error) => {
    assert.ok(error instanceof UserIndicatorLibraryError);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

const decoded = decodeUserIndicatorFile('SMA.TFI', new TextEncoder().encode('hello'));
assert.equal(decoded.fileName, 'SMA.TFI');
assert.equal(decoded.source, 'hello');
assert.throws(
  () => decodeUserIndicatorFile('bad.js', new TextEncoder().encode('hello')),
  (error) => error instanceof UserIndicatorLibraryError && error.code === 'invalid_extension',
);
assert.throws(
  () => decodeUserIndicatorFile('bad.tfi', new Uint8Array([0xc3, 0x28])),
  (error) => error instanceof UserIndicatorLibraryError && error.code === 'invalid_utf8',
);
assert.throws(
  () => decodeUserIndicatorFile(
    'huge.tfi',
    new Uint8Array(USER_INDICATOR_RUNTIME_LIMITS.sourceBytes + 1),
  ),
  (error) => error instanceof UserIndicatorLibraryError && error.code === 'source_too_large',
);

assert.equal(
  await userIndicatorSourceHash('abc'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
);

const store = new MemoryStore();
let now = 1000;
const library = new UserIndicatorLibrary(store, {
  validator: validateUserIndicatorSource,
  now: () => now,
});
const sourceV1 = sourceFor('user.library-test', 1);
const preparedV1 = await library.prepareImport('library.tfi', new TextEncoder().encode(sourceV1));
assert.equal(preparedV1.disposition, 'new');
assert.equal(preparedV1.downgrade, false);
assert.equal(preparedV1.existingSourceHash, null);
const installedV1 = await library.install(preparedV1);
assert.equal(installedV1.status, 'installed');
assert.equal(installedV1.record.importedAt, 1000);
assert.equal(installedV1.record.updatedAt, 1000);
assert.equal(installedV1.record.validatorVersion, USER_INDICATOR_VALIDATOR_VERSION);
assert.equal(store.putCount, 1);

const unchangedPreview = await library.prepareImport('library.tfi', new TextEncoder().encode(sourceV1));
assert.equal(unchangedPreview.disposition, 'unchanged');
const unchanged = await library.install(unchangedPreview);
assert.equal(unchanged.status, 'unchanged');
assert.equal(store.putCount, 1, 'unchanged import must not rewrite IndexedDB');

now = 2000;
const sourceV2 = sourceFor('user.library-test', 2, '\n// replacement');
const replacement = await library.prepareImport('library.tfi', new TextEncoder().encode(sourceV2));
assert.equal(replacement.disposition, 'replace');
assert.equal(replacement.downgrade, false);
await assertLibraryError(
  () => library.install(replacement),
  'replacement_required',
  /explicit confirmation/,
);
const replaced = await library.install(replacement, { replace: true });
assert.equal(replaced.status, 'installed');
assert.equal(replaced.record.indicatorVersion, 2);
assert.equal(replaced.record.importedAt, 1000, 'replacement must preserve original import time');
assert.equal(replaced.record.updatedAt, 2000);

const downgrade = await library.prepareImport(
  'library.tfi',
  new TextEncoder().encode(sourceFor('user.library-test', 1, '\n// downgrade')),
);
assert.equal(downgrade.disposition, 'replace');
assert.equal(downgrade.downgrade, true);

const stale = await library.prepareImport(
  'library.tfi',
  new TextEncoder().encode(sourceFor('user.library-test', 3, '\n// stale-preview')),
);
const concurrentSource = sourceFor('user.library-test', 4, '\n// concurrent-change');
const concurrentHash = await userIndicatorSourceHash(concurrentSource);
store.records.set('user.library-test', {
  ...structuredClone(replaced.record),
  source: concurrentSource,
  sourceHash: concurrentHash,
  indicatorVersion: 4,
  manifest: structuredClone(manifest('user.library-test', 4)),
  updatedAt: 2500,
});
await assertLibraryError(
  () => library.install(stale, { replace: true }),
  'stale_import_preview',
  /changed after import preview/,
);

const trustedStore = new MemoryStore();
const trustedLibrary = new UserIndicatorLibrary(trustedStore, {
  trustedIndicatorIds: new Set(['user.reserved']),
  validator: async () => ({ ok: true, manifest: manifest('user.reserved', 1) }),
});
await assertLibraryError(
  () => trustedLibrary.prepareImport('trusted.tfi', new TextEncoder().encode('// trusted-conflict')),
  'duplicate_indicator_id',
  /trusted indicator/,
);

const badValidationLibrary = new UserIndicatorLibrary(new MemoryStore(), {
  validator: async () => ({
    ok: false,
    error: { code: 'invalid_definition', message: 'expected validation failure', field: 'id' },
  }),
});
await assertLibraryError(
  () => badValidationLibrary.prepareImport('bad.tfi', new TextEncoder().encode('// bad')),
  'invalid_definition',
  /expected validation failure/,
);

async function storedRecord(id, source, version = 1, importedAt = 1) {
  return {
    id,
    source,
    sourceHash: await userIndicatorSourceHash(source),
    manifest: structuredClone(manifest(id, version)),
    apiVersion: 1,
    indicatorVersion: version,
    importedAt,
    updatedAt: importedAt,
    validatorVersion: USER_INDICATOR_VALIDATOR_VERSION,
  };
}

const corruptGood = await storedRecord('user.good', '// good');
const corruptBad = { ...(await storedRecord('user.bad', '// bad')), sourceHash: '0'.repeat(64) };
const corruptStore = new MemoryStore([corruptGood, corruptBad]);
const corruptLibrary = new UserIndicatorLibrary(corruptStore, {
  validator: async () => ({ ok: true, manifest: manifest('user.new', 1) }),
});
const scan = await corruptLibrary.scan();
assert.deepEqual(scan.records.map((record) => record.id), ['user.good']);
assert.equal(scan.corruptEntries.length, 1);
await assertLibraryError(() => corruptLibrary.get('user.bad'), 'storage_corrupt', /corrupt/);
await assertLibraryError(
  async () => {
    const prepared = await corruptLibrary.prepareImport('new.tfi', new TextEncoder().encode('// new'));
    await corruptLibrary.install(prepared);
  },
  'storage_corrupt',
  /corrupt entries/,
);

const indicatorLimitEntries = [];
for (let index = 0; index < USER_INDICATOR_RUNTIME_LIMITS.importedIndicators; index += 1) {
  indicatorLimitEntries.push(await storedRecord(`user.limit-${index}`, `// source-${index}`));
}
const indicatorLimitLibrary = new UserIndicatorLibrary(new MemoryStore(indicatorLimitEntries), {
  validator: async () => ({ ok: true, manifest: manifest('user.limit-new', 1) }),
});
const indicatorLimitPrepared = await indicatorLimitLibrary.prepareImport(
  'limit.tfi',
  new TextEncoder().encode('// one-more'),
);
await assertLibraryError(
  () => indicatorLimitLibrary.install(indicatorLimitPrepared),
  'library_indicator_limit_exceeded',
  new RegExp(String(USER_INDICATOR_RUNTIME_LIMITS.importedIndicators)),
);

const sourceLimitEntries = [];
const fullSource = 'x'.repeat(USER_INDICATOR_RUNTIME_LIMITS.sourceBytes);
for (let index = 0; index < USER_INDICATOR_RUNTIME_LIMITS.storedSourceBytes / USER_INDICATOR_RUNTIME_LIMITS.sourceBytes; index += 1) {
  sourceLimitEntries.push(await storedRecord(`user.bytes-${index}`, fullSource));
}
const sourceLimitLibrary = new UserIndicatorLibrary(new MemoryStore(sourceLimitEntries), {
  validator: async () => ({ ok: true, manifest: manifest('user.bytes-new', 1) }),
});
const sourceLimitPrepared = await sourceLimitLibrary.prepareImport(
  'bytes.tfi',
  new TextEncoder().encode('// exceeds-total'),
);
await assertLibraryError(
  () => sourceLimitLibrary.install(sourceLimitPrepared),
  'library_source_limit_exceeded',
  /16777216/,
);

const deleteStore = new MemoryStore([await storedRecord('user.delete', '// delete')]);
const deleteLibrary = new UserIndicatorLibrary(deleteStore, { validator: validateUserIndicatorSource });
await deleteLibrary.delete('user.delete');
assert.equal(await deleteStore.get('user.delete'), null);
assert.equal(deleteStore.deleteCount, 1);

const indexedDbSource = await readFile(
  path.join(projectRoot, 'src/user-indicator-runtime/indexeddb-store.ts'),
  'utf8',
);
assert.match(indexedDbSource, /createObjectStore\(USER_INDICATOR_LIBRARY_STORE_NAME, \{ keyPath: 'id' \}\)/);
assert.match(indexedDbSource, /transaction\(USER_INDICATOR_LIBRARY_STORE_NAME, 'readwrite'\)/);
assert.doesNotMatch(indexedDbSource, /localStorage|sessionStorage|__TAURI__|invoke\(|node:fs|Deno|process\./);

console.log('user indicator library: ok');
