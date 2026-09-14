import assert from 'node:assert/strict';

import {
  DRAWING_STORAGE_KEY,
  DrawingHistory,
  drawingScope,
  loadDrawingScopes,
  saveDrawingScopes,
  validateDrawingSnapshot,
} from '../src/drawing-state.ts';

const known = new Set(['TrendLine', 'Rectangle']);
const valid = JSON.stringify([{
  id: 'line-1', toolType: 'TrendLine',
  points: [{ timestamp: 1_700_000_000, price: 10.5 }],
  options: { visible: true },
}]);
assert.equal(validateDrawingSnapshot(valid, known), valid);
assert.equal(validateDrawingSnapshot('{broken', known), null);
assert.equal(validateDrawingSnapshot(JSON.stringify([{ id: 'x', toolType: 'Unknown', points: [], options: {} }]), known), null);
assert.equal(validateDrawingSnapshot(JSON.stringify([{ id: 'x', toolType: 'TrendLine', points: [{ timestamp: 'bad', price: 1 }], options: {} }]), known), null);
assert.equal(drawingScope('SH:600000', 'qfq'), 'SH:600000|qfq');

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const scopes = new Map([['SH:600000|none', valid]]);
assert.equal(saveDrawingScopes(storage, scopes), true);
assert.equal(JSON.parse(values.get(DRAWING_STORAGE_KEY)).version, 1);
assert.deepEqual(loadDrawingScopes(storage, known), scopes);
values.set(DRAWING_STORAGE_KEY, '{broken');
assert.deepEqual(loadDrawingScopes(storage, known), new Map());

const history = new DrawingHistory('[]', 3);
history.record('[1]');
history.record('[2]');
history.record('[3]');
assert.equal(history.undo(), '[2]');
assert.equal(history.undo(), '[1]');
assert.equal(history.undo(), '[]');
assert.equal(history.undo(), null);
assert.equal(history.redo(), '[1]');
history.record('[4]');
assert.equal(history.canRedo, false, 'new edits invalidate redo');
console.log('Drawing persistence and history OK');
