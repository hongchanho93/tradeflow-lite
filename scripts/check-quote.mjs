import assert from 'node:assert/strict';

import { isUsableQuote } from '../src/quote.ts';

const quote = {
  last: 10.2,
  previousClose: 10,
  open: 10.1,
  high: 10.3,
  low: 9.9,
  volume: 100,
  amount: 1_000,
  receivedAt: 1_789_196_400,
};
assert.equal(isUsableQuote(quote), true);
assert.equal(isUsableQuote({ ...quote, last: 0 }), false);
assert.equal(isUsableQuote({ ...quote, high: 9.8, low: 9.9 }), false);
assert.equal(isUsableQuote({ ...quote, amount: Number.NaN }), false);
assert.equal(isUsableQuote({ ...quote, open: 0, high: 0, low: 0 }), true, 'pre-open zero OHLC remains usable');
console.log('Quote validation OK');
