import assert from 'node:assert/strict';

import { marketPollPlan } from '../src/market-session.ts';

const atShanghai = (isoLocal) => new Date(`${isoLocal}+08:00`);

assert.deepEqual(marketPollPlan(atShanghai('2026-09-14T09:15:00')), { state: 'trading', delayMs: 5_000 });
assert.deepEqual(marketPollPlan(atShanghai('2026-09-14T11:31:00')), { state: 'lunch', delayMs: 30_000 });
assert.deepEqual(marketPollPlan(atShanghai('2026-09-14T13:00:00')), { state: 'trading', delayMs: 5_000 });
assert.deepEqual(marketPollPlan(atShanghai('2026-09-14T15:01:00')), { state: 'closed', delayMs: 60_000 });
assert.deepEqual(marketPollPlan(atShanghai('2026-09-13T10:00:00')), { state: 'closed', delayMs: 60_000 });
assert.deepEqual(marketPollPlan(atShanghai('2026-09-14T10:00:00'), true), { state: 'hidden', delayMs: 60_000 });
assert.deepEqual(marketPollPlan(atShanghai('2026-09-13T10:00:00'), false, true), { state: 'trading', delayMs: 5_000 });
console.log('China market poll schedule OK');
