import assert from 'node:assert/strict';

import {
  TF_COLOR_PALETTE,
  normalizeHexColor,
} from '../src/color-picker.ts';

assert.equal(TF_COLOR_PALETTE.length, 8, 'TF palette must keep eight rows');
assert.ok(TF_COLOR_PALETTE.every((row) => row.length === 10), 'TF palette must keep ten columns');
assert.equal(new Set(TF_COLOR_PALETTE.flat()).size, 80, 'TF palette colors must be unique');
assert.ok(TF_COLOR_PALETTE.flat().every((color) => /^#[0-9a-f]{6}$/.test(color)));
assert.equal(normalizeHexColor('#F23645'), '#f23645');
assert.equal(normalizeHexColor('2962ff'), '#2962ff');
assert.equal(normalizeHexColor('red'), null);
assert.equal(normalizeHexColor('#12345'), null);

const pickerSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/color-picker.ts', import.meta.url), 'utf8'));
assert.ok(pickerSource.includes("opacityInput!.min = opacityTarget.min || '0'"));
assert.ok(pickerSource.includes("opacityInput!.max = opacityTarget.max || '100'"));
assert.ok(pickerSource.includes("opacityInput!.step = opacityTarget.step || '1'"));

console.log('TF color picker contract OK');
