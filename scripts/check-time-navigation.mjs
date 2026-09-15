import assert from 'node:assert/strict';
import { logicalRangeAround, nearestBarIndex, panLogicalRange, parseShanghaiDate, resolutionShowsIntradayTime, visibleRangeForPreset } from '../src/time-navigation.ts';

const day = 86_400;
const bars = Array.from({ length: 400 }, (_, index) => ({ time: 1_700_000_000 + index * day }));
assert.deepEqual(visibleRangeForPreset(bars, 'all'), { from: bars[0].time, to: bars.at(-1).time });
assert.ok(visibleRangeForPreset(bars, '1m').from > bars.at(-40).time);
assert.equal(nearestBarIndex(bars, bars[20].time + day / 3), 20);
assert.equal(nearestBarIndex([], 1), null);
assert.deepEqual(logicalRangeAround(200, 400, 100), { from: 150, to: 250 });
assert.deepEqual(panLogicalRange({ from: 10, to: 110 }, -1), { from: -70, to: 30 });
assert.equal(parseShanghaiDate('2026-09-13'), 1_789_228_800);
assert.equal(parseShanghaiDate('bad'), null);
assert.equal(resolutionShowsIntradayTime('1'), true);
assert.equal(resolutionShowsIntradayTime('60'), true);
assert.equal(resolutionShowsIntradayTime('120'), true);
assert.equal(resolutionShowsIntradayTime('240'), true);
assert.equal(resolutionShowsIntradayTime('1D'), false);
console.log('Time navigation OK');
