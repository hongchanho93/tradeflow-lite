import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { marketPollPlan, remainingPollDelay } from '../src/market-session.ts';

const atShanghai = (isoLocal) => new Date(`${isoLocal}+08:00`);

assert.deepEqual(marketPollPlan(atShanghai('2026-09-14T09:15:00')), { state: 'trading', delayMs: 2_000 });
assert.deepEqual(marketPollPlan(atShanghai('2026-09-14T11:31:00')), { state: 'lunch', delayMs: 30_000 });
assert.deepEqual(marketPollPlan(atShanghai('2026-09-14T13:00:00')), { state: 'trading', delayMs: 2_000 });
assert.deepEqual(marketPollPlan(atShanghai('2026-09-14T15:01:00')), { state: 'closed', delayMs: 60_000 });
assert.deepEqual(marketPollPlan(atShanghai('2026-09-13T10:00:00')), { state: 'closed', delayMs: 60_000 });
assert.deepEqual(marketPollPlan(atShanghai('2026-09-14T10:00:00'), true), { state: 'hidden', delayMs: 60_000 });
assert.equal(remainingPollDelay(2_000, 350), 1_650, 'request time is deducted from the next foreground wait');
assert.equal(remainingPollDelay(2_000, 2_500), 0, 'an overrun retries immediately without overlapping requests');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
assert.match(
  mainSource,
  /if \(cached\) \{[\s\S]*scheduleLatestPoll\(\);[\s\S]*return;/,
  'opening cached history must resume market polling',
);
assert.match(
  mainSource,
  /finally \{\s*if \(historyRequestGate\.isCurrent\(generation\)\) \{\s*loadingLayer\.hidden = true;\s*scheduleLatestPoll\(networkHistoryDisplayed && match\.realtime \? 0 : undefined\);/,
  'network history completion must immediately reconcile a parallel realtime start while preserving the default poll plan for other sources',
);
assert.deepEqual(marketPollPlan(atShanghai('2026-09-13T10:00:00'), false, true), { state: 'trading', delayMs: 5_000 });
console.log('China market poll schedule OK');
