import assert from 'node:assert/strict';

import {
  DEFAULT_FAVORITE_RESOLUTIONS,
  RESOLUTION_OPTIONS,
  formatUtcOffset,
  loadFavoriteResolutions,
  loadTradingTimeChoice,
  resolveTradingTimeZone,
  timeZoneOffsetMinutes,
  toggleFavoriteResolution,
} from '../src/chart-time-controls.ts';

assert.deepEqual(
  RESOLUTION_OPTIONS.map(({ value }) => value),
  ['1', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M'],
  'the fixed period menu must include real 2-hour and 4-hour resolutions without custom periods',
);

const emptyStorage = { getItem: () => null };
assert.deepEqual(loadFavoriteResolutions(emptyStorage), DEFAULT_FAVORITE_RESOLUTIONS);
assert.deepEqual(toggleFavoriteResolution(['1', '60'], '120'), ['1', '60', '120']);
assert.deepEqual(toggleFavoriteResolution(['1', '60', '120'], '60'), ['1', '120']);

const corruptStorage = { getItem: () => '{' };
assert.deepEqual(loadFavoriteResolutions(corruptStorage), DEFAULT_FAVORITE_RESOLUTIONS);
assert.equal(loadTradingTimeChoice({ getItem: () => 'not/a-zone' }), 'exchange');
assert.equal(resolveTradingTimeZone('exchange', 'Asia/Shanghai', 'Asia/Seoul'), 'Asia/Shanghai');
assert.equal(resolveTradingTimeZone('system', 'Asia/Shanghai', 'Asia/Seoul'), 'Asia/Seoul');
assert.equal(resolveTradingTimeZone('America/New_York', 'Asia/Shanghai', 'Asia/Seoul'), 'America/New_York');

const winter = new Date('2026-01-15T12:00:00Z');
const summer = new Date('2026-07-15T12:00:00Z');
assert.equal(formatUtcOffset(timeZoneOffsetMinutes(winter, 'Asia/Shanghai')), 'UTC+8');
assert.equal(formatUtcOffset(timeZoneOffsetMinutes(winter, 'America/New_York')), 'UTC-5');
assert.equal(formatUtcOffset(timeZoneOffsetMinutes(summer, 'America/New_York')), 'UTC-4');

console.log('Chart period favorites and trading-time controls OK');
