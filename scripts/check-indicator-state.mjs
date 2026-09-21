import assert from 'node:assert/strict';

import {
  INDICATOR_STATE_STORAGE_KEY,
  isSavedUserIndicatorState,
  loadIndicatorState,
  legacyIndicatorInstanceId,
  resolveUserIndicatorStateEntries,
  saveIndicatorState,
} from '../src/indicator-sdk/state.ts';
import { defineIndicator } from '../src/indicator-sdk/define-indicator.ts';
import { IndicatorRegistry } from '../src/indicator-sdk/registry.ts';

const storageValues = new Map();
const storage = {
  getItem(key) {
    return storageValues.get(key) ?? null;
  },
  setItem(key, value) {
    storageValues.set(key, value);
  },
};

function indicator(id, indicatorVersion = 1) {
  return defineIndicator({
    id,
    apiVersion: 1,
    indicatorVersion,
    name: { 'zh-CN': id, 'en-US': id },
    supports: { seriesKinds: ['ohlcv'] },
    inputs: {
      period: { type: 'number', title: '周期', default: 20, min: 1, max: 500, step: 1 },
    },
    create() {
      return { update() {} };
    },
  });
}

const registry = new IndicatorRegistry([
  indicator('builtin.ma', 2),
  indicator('builtin.ema', 4),
  indicator('user.dynamic', 3),
]);

assert.equal(legacyIndicatorInstanceId('builtin.ma'), 'ma', 'legacy builtins keep stable instance IDs');
assert.equal(legacyIndicatorInstanceId('user.dynamic'), 'user.dynamic:1');

storageValues.set(INDICATOR_STATE_STORAGE_KEY, null);
const legacy = loadIndicatorState(storage, registry, ['ma', 'ema', 'not-installed'], new Set(['ema']));
assert.deepEqual(
  legacy.instances.map((instance) => ({
    instanceId: instance.instanceId,
    indicatorId: instance.indicatorId,
    indicatorVersion: instance.indicatorVersion,
    visible: instance.visible,
    menuOrder: instance.menuOrder,
    inputs: instance.inputs,
  })),
  [
    { instanceId: 'ma', indicatorId: 'builtin.ma', indicatorVersion: 2, visible: true, menuOrder: 0, inputs: {} },
    { instanceId: 'ema', indicatorId: 'builtin.ema', indicatorVersion: 4, visible: false, menuOrder: 1, inputs: {} },
  ],
  'legacy activeSeries/hiddenSeries state migrates to registered builtins',
);
assert.deepEqual(
  legacy.mainOverlayOrder,
  [
    { type: 'volume' },
    { type: 'indicator', instanceId: 'ma' },
    { type: 'indicator', instanceId: 'ema' },
  ],
  'legacy migration preserves volume and indicator overlay order',
);
assert.deepEqual(legacy.unresolvedEntries, [], 'uninstalled legacy indicators do not become active instances');

const validFirst = {
  instanceId: 'dynamic-period-20',
  indicatorId: 'user.dynamic',
  indicatorVersion: 3,
  visible: true,
  menuOrder: 2,
  panes: [{ key: 'dynamic-pane', renderOrder: 1, height: 140 }],
  inputs: { period: 20 },
};
const validSecond = {
  instanceId: 'dynamic-period-60',
  indicatorId: 'user.dynamic',
  indicatorVersion: 3,
  visible: false,
  menuOrder: 1,
  panes: [{ key: 'dynamic-pane', renderOrder: 1, height: 220 }],
  inputs: { period: 60 },
};
const unresolvedMissing = {
  instanceId: 'missing-plugin-instance',
  indicatorId: 'contributed.not-installed',
  indicatorVersion: 8,
  visible: true,
  menuOrder: 9,
  panes: [{ key: 'missing-pane', renderOrder: 0, height: 160 }],
  inputs: { period: 99, futureOption: 'keep-me' },
};
const unresolvedDamaged = {
  instanceId: 'damaged-instance',
  indicatorId: 'user.dynamic',
  indicatorVersion: 0,
  visible: true,
  menuOrder: 10,
  panes: [],
  inputs: { period: 20 },
};
const savedEnvelope = {
  schemaVersion: 1,
  instances: [validFirst, unresolvedMissing, unresolvedDamaged, validSecond],
  mainOverlayOrder: [
    { type: 'volume' },
    { type: 'indicator', instanceId: validFirst.instanceId },
    { type: 'indicator', instanceId: validSecond.instanceId },
    { type: 'indicator', instanceId: unresolvedMissing.instanceId },
  ],
};
storageValues.set(INDICATOR_STATE_STORAGE_KEY, JSON.stringify(savedEnvelope));

const loaded = loadIndicatorState(storage, registry);
assert.deepEqual(
  loaded.instances.map((instance) => instance.instanceId),
  [validSecond.instanceId, validFirst.instanceId],
  'multiple instances of one dynamic indicator remain distinct and menu-sorted',
);
assert.equal(loaded.instances[0].visible, false);
assert.equal(loaded.instances[0].inputs.period, 60);
assert.deepEqual(
  loaded.unresolvedEntries,
  [unresolvedMissing, unresolvedDamaged],
  'missing and damaged entries are isolated without discarding valid instances',
);
assert.deepEqual(loaded.mainOverlayOrder, savedEnvelope.mainOverlayOrder);

assert.equal(saveIndicatorState(storage, loaded), true);
const savedAfterRoundTrip = JSON.parse(storageValues.get(INDICATOR_STATE_STORAGE_KEY));
assert.deepEqual(
  savedAfterRoundTrip.instances,
  [validSecond, validFirst, unresolvedMissing, unresolvedDamaged],
  'unresolved JSON entries are preserved on the next save',
);
assert.deepEqual(savedAfterRoundTrip.mainOverlayOrder, savedEnvelope.mainOverlayOrder);

const reloaded = loadIndicatorState(storage, registry);
assert.deepEqual(reloaded.instances.map((instance) => instance.instanceId), [validSecond.instanceId, validFirst.instanceId]);
assert.deepEqual(reloaded.unresolvedEntries, [unresolvedMissing, unresolvedDamaged]);

const duplicateInstance = { ...validSecond, indicatorId: 'builtin.ma', menuOrder: 3 };
storageValues.set(INDICATOR_STATE_STORAGE_KEY, JSON.stringify({
  schemaVersion: 1,
  instances: [validSecond, duplicateInstance],
  mainOverlayOrder: [{ type: 'volume' }],
}));
const deduplicated = loadIndicatorState(storage, registry);
assert.deepEqual(deduplicated.instances, [validSecond], 'only the first saved instance ID may become active');
assert.deepEqual(deduplicated.unresolvedEntries, [duplicateInstance], 'duplicate entries stay preserved instead of crashing bootstrap');

storageValues.set(INDICATOR_STATE_STORAGE_KEY, '{not valid json');
const malformed = loadIndicatorState(storage, registry, ['ma'], new Set());
assert.deepEqual(malformed.instances.map((instance) => instance.instanceId), ['ma']);
assert.deepEqual(malformed.unresolvedEntries, []);

storageValues.set(INDICATOR_STATE_STORAGE_KEY, JSON.stringify({
  schemaVersion: 1,
  instances: [validFirst],
  mainOverlayOrder: [{ type: 'invalid-entry' }],
}));
const damagedEnvelope = loadIndicatorState(storage, registry, ['ma'], new Set());
assert.deepEqual(
  damagedEnvelope.instances.map((instance) => instance.instanceId),
  [validFirst.instanceId],
  'a damaged overlay order must not discard otherwise valid dynamic instances',
);
assert.deepEqual(damagedEnvelope.mainOverlayOrder, [
  { type: 'volume' },
  { type: 'indicator', instanceId: validFirst.instanceId },
]);

assert.equal(saveIndicatorState({ setItem() { throw new Error('quota'); } }, loaded), false);

const userSourceHash = 'a'.repeat(64);
const savedUserInstance = {
  instanceId: 'runtime-user-sma-1',
  indicatorId: 'user.runtime-sma',
  indicatorVersion: 7,
  runtimeKind: 'user',
  sourceHash: userSourceHash,
  visible: true,
  menuOrder: 4,
  panes: [{ key: 'runtime-pane', renderOrder: 2, height: 188 }],
  inputs: { period: 37, color: '#2962ff', futureOption: 'preserve-me' },
};
assert.equal(isSavedUserIndicatorState(savedUserInstance), true);
assert.equal(isSavedUserIndicatorState({ ...savedUserInstance, sourceHash: 'bad' }), false);

const explicitTrusted = {
  ...validFirst,
  runtimeKind: 'trusted',
};
const trustedWithHash = {
  ...validSecond,
  runtimeKind: 'trusted',
  sourceHash: userSourceHash,
};
storageValues.set(INDICATOR_STATE_STORAGE_KEY, JSON.stringify({
  schemaVersion: 1,
  instances: [explicitTrusted, savedUserInstance, trustedWithHash, unresolvedMissing],
  mainOverlayOrder: [
    { type: 'volume' },
    { type: 'indicator', instanceId: explicitTrusted.instanceId },
    { type: 'indicator', instanceId: savedUserInstance.instanceId },
  ],
}));
const mixedFirstPass = loadIndicatorState(storage, registry);
assert.deepEqual(
  mixedFirstPass.instances.map((instance) => instance.instanceId),
  [explicitTrusted.instanceId],
  'the synchronous first pass activates trusted entries only',
);
assert.deepEqual(
  mixedFirstPass.unresolvedEntries,
  [savedUserInstance, trustedWithHash, unresolvedMissing],
  'runtime user state stays unresolved until IndexedDB library records are available',
);

const resolvedUser = resolveUserIndicatorStateEntries(
  mixedFirstPass.unresolvedEntries,
  [{ id: savedUserInstance.indicatorId, sourceHash: userSourceHash, indicatorVersion: 7 }],
  new Set(mixedFirstPass.instances.map((instance) => instance.instanceId)),
);
assert.deepEqual(resolvedUser.instances, [savedUserInstance]);
assert.deepEqual(
  resolvedUser.unresolvedEntries,
  [trustedWithHash, unresolvedMissing],
  'non-user unresolved entries remain untouched',
);
assert.deepEqual(resolvedUser.instances[0].inputs, savedUserInstance.inputs);
assert.deepEqual(resolvedUser.instances[0].panes, savedUserInstance.panes);

for (const records of [
  [],
  [{ id: savedUserInstance.indicatorId, sourceHash: 'b'.repeat(64), indicatorVersion: 7 }],
  [{ id: savedUserInstance.indicatorId, sourceHash: userSourceHash, indicatorVersion: 8 }],
]) {
  const unresolvedUser = resolveUserIndicatorStateEntries([savedUserInstance], records);
  assert.deepEqual(unresolvedUser.instances, []);
  assert.deepEqual(unresolvedUser.unresolvedEntries, [savedUserInstance]);
}

const occupiedUser = resolveUserIndicatorStateEntries(
  [savedUserInstance],
  [{ id: savedUserInstance.indicatorId, sourceHash: userSourceHash, indicatorVersion: 7 }],
  new Set([savedUserInstance.instanceId]),
);
assert.deepEqual(occupiedUser.instances, []);
assert.deepEqual(occupiedUser.unresolvedEntries, [savedUserInstance]);

const duplicateLibrary = resolveUserIndicatorStateEntries(
  [savedUserInstance],
  [
    { id: savedUserInstance.indicatorId, sourceHash: userSourceHash, indicatorVersion: 7 },
    { id: savedUserInstance.indicatorId, sourceHash: userSourceHash, indicatorVersion: 7 },
  ],
);
assert.deepEqual(duplicateLibrary.instances, [], 'ambiguous duplicate library records must not activate state');
assert.deepEqual(duplicateLibrary.unresolvedEntries, [savedUserInstance]);

const stateWithResolvedUser = {
  instances: [...mixedFirstPass.instances, ...resolvedUser.instances],
  unresolvedEntries: resolvedUser.unresolvedEntries,
  mainOverlayOrder: mixedFirstPass.mainOverlayOrder,
};
assert.equal(saveIndicatorState(storage, stateWithResolvedUser), true);
const savedMixedRoundTrip = JSON.parse(storageValues.get(INDICATOR_STATE_STORAGE_KEY));
const persistedUser = savedMixedRoundTrip.instances.find((entry) => entry.instanceId === savedUserInstance.instanceId);
assert.deepEqual(
  persistedUser,
  savedUserInstance,
  'runtimeKind/sourceHash plus original inputs and pane layout survive persistence unchanged',
);

const reloadedMixed = loadIndicatorState(storage, registry);
assert.deepEqual(
  reloadedMixed.unresolvedEntries.filter((entry) => entry?.instanceId === savedUserInstance.instanceId),
  [savedUserInstance],
  'after restart the user instance returns to unresolved until the async library scan resolves it again',
);
const resolvedAfterRestart = resolveUserIndicatorStateEntries(
  reloadedMixed.unresolvedEntries,
  [{ id: savedUserInstance.indicatorId, sourceHash: userSourceHash, indicatorVersion: 7 }],
  new Set(reloadedMixed.instances.map((instance) => instance.instanceId)),
);
assert.deepEqual(resolvedAfterRestart.instances, [savedUserInstance]);

console.log('Indicator state migration, dynamic instances, unresolved preservation, and corruption checks passed');
