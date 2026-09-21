import assert from 'node:assert/strict';

import { boll, bollBreakouts, ema, macd, rsi, sma } from '../src/indicators.ts';

const rounded = (values) => values.map((value) => value === null ? null : Number(value.toFixed(6)));

assert.deepEqual(rounded(sma([1, 2, 3, 4, 5], 3)), [null, null, 2, 3, 4]);
assert.deepEqual(rounded(ema([1, 2, 3, 4, 5], 3)), [null, null, 2, 3, 4]);

const risingRsi = rsi(Array.from({ length: 16 }, (_, index) => index + 1), 14);
assert.equal(risingRsi[13], null);
assert.equal(risingRsi[14], 100);
assert.equal(risingRsi[15], 100);

const bands = boll([1, 2, 3], 3, 2);
assert.equal(Number(bands.middle[2].toFixed(6)), 2);
assert.equal(Number(bands.upper[2].toFixed(6)), 3.632993);
assert.equal(Number(bands.lower[2].toFixed(6)), 0.367007);

assert.deepEqual(
  bollBreakouts(
    [9, 11, 12, 8, 6],
    [10, 10, 11, 11, 10],
    [7, 7, 7, 7, 7],
  ),
  [null, 'upper', null, null, 'lower'],
  'BOLL signals should mark only the first close crossing outside each band',
);
assert.deepEqual(
  bollBreakouts([9, 11], [null, 10], [null, 7]),
  [null, null],
  'a signal requires valid bands on both the previous and current bar',
);

const flatMacd = macd(Array(40).fill(10));
assert.equal(flatMacd.dif[25], 0);
assert.equal(flatMacd.dea[33], 0);
assert.equal(flatMacd.histogram[33], 0);
console.log('Indicator calculations OK');
