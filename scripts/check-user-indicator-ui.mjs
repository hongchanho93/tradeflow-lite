import { readFileSync } from 'node:fs';
import './check-user-indicator-recovery.mjs';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

if (!main.includes('function applyPriceScale(setting: PriceScaleSetting, persist = true)')) {
  throw new Error('price-scale restore must support a no-persist bootstrap path');
}
if (!main.includes('applyPriceScale(currentPriceScale, false);')) {
  throw new Error('bootstrap must not persist indicator state before user indicator panes are recreated');
}

const requiredMainFragments = [
  'id="import-user-indicator"',
  'id="user-indicator-file" type="file" accept=".tfi"',
  'id="user-indicator-import-layer"',
  'id="user-indicator-import-preview"',
  'id="confirm-user-indicator-import"',
  'id="copy-user-indicator-ai-diagnostic"',
  'function openUserIndicatorImportPreview',
  'function openUserIndicatorDeletePreview',
  'function prepareUserIndicatorFile',
  'userIndicatorLibrary.prepareImport(file.name, bytes)',
  "replace: prepared.disposition === 'replace'",
  'prepareAiLibraryChange(prepared, indicatorId, true',
  'captureUserIndicatorInstances(indicatorId, before?.sourceHash)',
  'library.replaceExact(indicatorId, before!.sourceHash, null)',
  'preserveAndStopUserIndicatorInstances(indicatorId, before.sourceHash, preserved)',
  'runtimeKind: \'user\'',
  'sourceHash: instance.sourceHash',
  'new IndexedDbUserIndicatorStore()',
  'new UserIndicatorLibrary(userIndicatorStore',
  'resolveUserIndicatorStateEntries(',
  'userIndicatorRuntime.add({',
  'library.sourceHash !== saved.sourceHash',
  'userIndicatorRecords.set(record.id, record)',
  '...userIndicatorRecords.values()',
  'userIndicatorRuntime.isLibraryRecordApplicable(userRecord)',
  'data-delete-user-indicator',
  'formatUserIndicatorAiDiagnostic(',
  "data-indicator-legend-action', 'copy-ai-diagnostic'",
];

for (const fragment of requiredMainFragments) {
  if (!main.includes(fragment)) throw new Error(`user indicator E3 UI is missing contract fragment: ${fragment}`);
}

const registerExternalIndex = main.indexOf('await registerExternalIndicators(indicatorRegistry)');
const createLibraryIndex = main.indexOf('new UserIndicatorLibrary(userIndicatorStore');
if (registerExternalIndex < 0 || createLibraryIndex < 0 || registerExternalIndex >= createLibraryIndex) {
  throw new Error('UserIndicatorLibrary trusted ID snapshot must be created after external trusted indicators register');
}

const mutation = main.slice(main.indexOf('async function prepareAiLibraryChange('), main.indexOf('\nasync function waitForAiUserIndicators('));
const writeIndex = mutation.indexOf('await library.install(prepared');
const captureIndex = mutation.indexOf('captureUserIndicatorInstances(indicatorId, before?.sourceHash)');
const runtimeIndex = mutation.indexOf('userIndicatorRuntime.remove(saved.instanceId)');
if (writeIndex < 0 || captureIndex <= writeIndex || runtimeIndex <= captureIndex
  || !mutation.includes('await library.replaceExact(indicatorId, after?.sourceHash ?? null, before)')
  || !mutation.includes('await waitForAiUserIndicators')) {
  throw new Error('shared UI/AI library mutation must save first, capture latest parameters, verify startup and compensate failures');
}
// Behavioral coverage (including store/Worker failure and cancellation) lives in
// check-ai-library-host.mjs and the opt-in real IndexedDB/Worker desktop tests.

const forbiddenMainFragments = [
  'eval(pendingUserIndicatorImport',
  'new Function(pendingUserIndicatorImport',
  'innerHTML = pendingUserIndicatorImport',
  'copy-user-indicator-ai-template',
  'indicator-picker-user-badge',
  "badge.textContent = '我的'",
];
for (const fragment of forbiddenMainFragments) {
  if (main.includes(fragment)) throw new Error(`user indicator E3 UI must not execute or inject imported source: ${fragment}`);
}

const requiredStyleFragments = [
  '.indicator-picker-header-actions',
  '#import-user-indicator',
  '.indicator-picker-user-row',
  '.indicator-picker-user-delete',
  '.user-indicator-import-dialog',
  '.user-indicator-import-preview',
  '.user-indicator-import-warning',
];
for (const fragment of requiredStyleFragments) {
  if (!styles.includes(fragment)) throw new Error(`user indicator E3 UI is missing style contract: ${fragment}`);
}

console.log('user indicator import/manage UI contract: ok');
