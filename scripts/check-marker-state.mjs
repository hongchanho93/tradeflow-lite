import assert from 'node:assert/strict';
import { MARKER_STORAGE_KEY, loadMarkerScopes, markerScope, normalizeMarkers, saveMarkerScopes } from '../src/marker-state.ts';

const valid = [{ id: 'm1', time: 2, position: 'aboveBar', shape: 'arrowDown', color: '#f23645', text: '减仓', size: 2, visible: true }];
assert.deepEqual(normalizeMarkers(valid), valid);
assert.equal(normalizeMarkers([{ ...valid[0], color: 'red' }]), null);
assert.equal(normalizeMarkers([{ ...valid[0], time: Number.NaN }]), null);
assert.equal(normalizeMarkers([{ ...valid[0], size: 4 }]), null);
assert.equal(markerScope('SH:600000', 'none', '1D'), 'SH:600000|none|1D');

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const scopes = new Map([['SH:600000|none|1D', valid]]);
assert.equal(saveMarkerScopes(storage, scopes), true);
assert.equal(JSON.parse(values.get(MARKER_STORAGE_KEY)).version, 1);
assert.deepEqual(loadMarkerScopes(storage), scopes);
values.set(MARKER_STORAGE_KEY, '{broken');
assert.deepEqual(loadMarkerScopes(storage), new Map());
assert.equal(saveMarkerScopes({ setItem: () => { throw new Error('quota'); } }, scopes), false);
console.log('Marker persistence OK');
