import assert from 'node:assert/strict';

import {
  loadWatchlist,
  moveWatchlistSymbol,
  normalizeWatchlist,
  saveWatchlist,
  watchlistSymbolKey,
  WATCHLIST_STORAGE_KEY,
} from '../src/watchlist.ts';

const known = new Set(['SH:600000', 'SH:510050', 'SH:000001']);
assert.deepEqual(
  normalizeWatchlist(['SH:600000', 'bad', 'SH:600000', 'SH:510050', 'BINANCE:NEWUSDT', 'BINANCE_USDM:NEWUSDT'], known),
  ['SH:600000', 'SH:510050', 'BINANCE:NEWUSDT', 'BINANCE_USDM:NEWUSDT'],
);
assert.equal(watchlistSymbolKey('custom-feed', 'EXAMPLE:ABC'), 'custom-feed|EXAMPLE:ABC');
assert.deepEqual(
  normalizeWatchlist(['custom-feed|EXAMPLE:ABC', 'other-feed|EXAMPLE:ABC', 'custom|bad symbol'], known),
  ['custom-feed|EXAMPLE:ABC', 'other-feed|EXAMPLE:ABC'],
  'provider-qualified watchlist entries must preserve provider identity',
);
const many = Array.from({ length: 250 }, (_, index) => 'custom-feed|SH:' + String(index).padStart(6, '0'));
assert.equal(normalizeWatchlist(many, known).length, 250, 'watchlist must not truncate at the old 100-symbol UI quota');
assert.deepEqual(moveWatchlistSymbol(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
assert.deepEqual(moveWatchlistSymbol(['a', 'b'], 0, -1), ['a', 'b']);

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
assert.equal(saveWatchlist(storage, ['SH:600000', 'SH:510050']), true);
assert.deepEqual(JSON.parse(values.get(WATCHLIST_STORAGE_KEY)), { version: 1, symbols: ['SH:600000', 'SH:510050'] });
assert.deepEqual(loadWatchlist(storage, known), ['SH:600000', 'SH:510050']);
values.set(WATCHLIST_STORAGE_KEY, '{broken');
assert.deepEqual(loadWatchlist(storage, known), [], 'damaged local state must be ignored safely');
assert.equal(saveWatchlist({ ...storage, setItem: () => { throw new Error('quota'); } }, []), false);
console.log('Local watchlist persistence OK');
