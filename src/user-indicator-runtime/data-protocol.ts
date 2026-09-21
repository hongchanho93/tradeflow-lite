import type {
  IndicatorBar,
  IndicatorDataEvent,
  IndicatorDepthSnapshot,
  IndicatorMarketStatus,
  IndicatorRealtimeBarUpdate,
  IndicatorTrade,
  IndicatorTradeBatch,
} from '../indicator-sdk/contracts.ts';
import { USER_INDICATOR_RUNTIME_LIMITS } from './limits.ts';

export type UserIndicatorDepthPayload = Readonly<{
  source: 'live' | 'preflight-synthetic';
  providerId: string;
  symbol: string;
  exchangeTimeMs?: number;
  receivedTimeMs: number;
  capturedAtMs: number;
  sequence?: number | null;
  coverage: 'current-snapshot';
  bids: readonly Readonly<{ price: number; quantity: number }>[];
  asks: readonly Readonly<{ price: number; quantity: number }>[];
}>;

export type UserIndicatorTradesPayload = Readonly<{
  source: 'live' | 'preflight-synthetic';
  events: readonly IndicatorTrade[];
  capturedAtMs: number;
  coverage: 'since-last-callback';
  streamEpoch: string;
  subscriptionStartedAtMs: number;
  completeSinceSubscriptionStart: boolean;
  droppedSinceSubscriptionStart: number;
  droppedByCallbackBudget: number;
  truncated: boolean;
  resetReason?: IndicatorTradeBatch['resetReason'];
}>;

export type UserIndicatorDataEvent = Readonly<IndicatorDataEvent & {
  depth?: UserIndicatorDepthPayload;
  trades?: UserIndicatorTradesPayload;
  marketStatus?: Readonly<IndicatorMarketStatus>;
}>;

export function userIndicatorDepthPayload(depth: Readonly<IndicatorDepthSnapshot>): UserIndicatorDepthPayload {
  const limit = USER_INDICATOR_RUNTIME_LIMITS.depthLevelsPerSide;
  return Object.freeze({
    source: 'live',
    providerId: depth.providerId,
    symbol: depth.symbol,
    ...(depth.exchangeTimeMs === undefined ? {} : { exchangeTimeMs: depth.exchangeTimeMs }),
    receivedTimeMs: depth.receivedTimeMs,
    capturedAtMs: Date.now(),
    ...(depth.sequence === undefined ? {} : { sequence: depth.sequence }),
    coverage: 'current-snapshot',
    bids: Object.freeze(depth.bids.slice(0, limit).map(level => Object.freeze({ price: level.price, quantity: level.quantity }))),
    asks: Object.freeze(depth.asks.slice(0, limit).map(level => Object.freeze({ price: level.price, quantity: level.quantity }))),
  });
}

export function userIndicatorTradesPayload(batch: Readonly<IndicatorTradeBatch>): UserIndicatorTradesPayload {
  const limit = USER_INDICATOR_RUNTIME_LIMITS.tradesPerCallback;
  const droppedByCallbackBudget = Math.max(0, batch.events.length - limit);
  const events = batch.events.slice(-limit).map(event => Object.freeze({ ...event }));
  return Object.freeze({
    source: 'live',
    events: Object.freeze(events),
    capturedAtMs: Date.now(),
    coverage: 'since-last-callback',
    streamEpoch: batch.streamEpoch,
    subscriptionStartedAtMs: batch.subscriptionStartedAtMs,
    completeSinceSubscriptionStart: batch.completeSinceSubscriptionStart && droppedByCallbackBudget === 0,
    droppedSinceSubscriptionStart: batch.droppedSinceSubscriptionStart + droppedByCallbackBudget,
    droppedByCallbackBudget,
    truncated: droppedByCallbackBudget > 0,
    ...(batch.resetReason === undefined ? {} : { resetReason: batch.resetReason }),
  });
}

function mergeUserIndicatorTrades(
  previous: UserIndicatorTradesPayload | undefined,
  next: UserIndicatorTradesPayload | undefined,
): UserIndicatorTradesPayload | undefined {
  if (!previous) return next;
  if (!next) return previous;
  if (previous.streamEpoch !== next.streamEpoch) return next;
  const limit = USER_INDICATOR_RUNTIME_LIMITS.tradesPerCallback;
  const combined = [...previous.events, ...next.events];
  const extraDropped = Math.max(0, combined.length - limit);
  const events = combined.slice(-limit).map(event => Object.freeze({ ...event }));
  return Object.freeze({
    source: next.source,
    events: Object.freeze(events),
    capturedAtMs: Math.max(previous.capturedAtMs, next.capturedAtMs),
    coverage: 'since-last-callback',
    streamEpoch: next.streamEpoch,
    subscriptionStartedAtMs: next.subscriptionStartedAtMs,
    completeSinceSubscriptionStart: previous.completeSinceSubscriptionStart
      && next.completeSinceSubscriptionStart
      && extraDropped === 0,
    droppedSinceSubscriptionStart: Math.max(previous.droppedSinceSubscriptionStart, next.droppedSinceSubscriptionStart)
      + extraDropped,
    droppedByCallbackBudget: previous.droppedByCallbackBudget + next.droppedByCallbackBudget + extraDropped,
    truncated: previous.truncated || next.truncated || extraDropped > 0,
    ...(next.resetReason === undefined ? {} : { resetReason: next.resetReason }),
  });
}

export type UserIndicatorBarsPatch =
  | {
      readonly mode: 'replace-all';
      readonly bars: readonly IndicatorBar[];
    }
  | {
      readonly mode: 'replace-from';
      readonly baseLength: number;
      readonly from: number;
      readonly bars: readonly IndicatorBar[];
    };

export interface UserIndicatorRuntimeDataEvent {
  readonly reason: IndicatorDataEvent['reason'];
  readonly changedFrom: number;
  readonly barsPatch: UserIndicatorBarsPatch;
  readonly realtimeUpdates?: readonly IndicatorRealtimeBarUpdate[];
  readonly depth?: UserIndicatorDepthPayload;
  readonly trades?: UserIndicatorTradesPayload;
  readonly marketStatus?: Readonly<IndicatorMarketStatus>;
}

export interface CoalescedIndicatorDataEvent {
  readonly event: UserIndicatorDataEvent;
  readonly changedFrom: number;
  readonly realtimeUpdates?: readonly IndicatorRealtimeBarUpdate[];
  readonly depth?: UserIndicatorDepthPayload;
  readonly trades?: UserIndicatorTradesPayload;
  readonly marketStatus?: Readonly<IndicatorMarketStatus>;
}

function sameOptionalNumber(left: number | undefined, right: number | undefined): boolean {
  return left === right || (left === undefined && right === undefined);
}

export function sameIndicatorBar(left: IndicatorBar, right: IndicatorBar): boolean {
  return left.time === right.time
    && left.open === right.open
    && left.high === right.high
    && left.low === right.low
    && left.close === right.close
    && left.volume === right.volume
    && sameOptionalNumber(left.amount, right.amount);
}

function copyBar(bar: IndicatorBar): IndicatorBar {
  return Object.freeze({ ...bar });
}

function copyBars(bars: readonly IndicatorBar[]): readonly IndicatorBar[] {
  return Object.freeze(bars.map(copyBar));
}

function assertBars(bars: readonly IndicatorBar[]): void {
  let previousTime = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) {
      throw new Error(`user indicator bar ${index} contains a non-finite value`);
    }
    if (bar.amount !== undefined && !Number.isFinite(bar.amount)) {
      throw new Error(`user indicator bar ${index} amount must be finite when present`);
    }
    if (bar.time <= previousTime) {
      throw new Error(`user indicator bars must be strictly increasing by time at index ${index}`);
    }
    previousTime = bar.time;
  }
}

function normalizedChangedFrom(event: UserIndicatorDataEvent): number {
  return Math.max(0, Math.min(event.bars.length, Math.trunc(event.changedFrom)));
}

function firstUnexpectedDifference(
  previousBars: readonly IndicatorBar[],
  nextBars: readonly IndicatorBar[],
  claimedChangedFrom: number,
): number {
  const prefixEnd = Math.min(claimedChangedFrom, previousBars.length, nextBars.length);
  for (let index = 0; index < prefixEnd; index += 1) {
    if (!sameIndicatorBar(previousBars[index], nextBars[index])) return index;
  }
  if (claimedChangedFrom > previousBars.length || claimedChangedFrom > nextBars.length) {
    return Math.min(previousBars.length, nextBars.length);
  }
  return claimedChangedFrom;
}

/**
 * Build a patch against the last event acknowledged by the Worker. We verify
 * the supposedly unchanged prefix instead of trusting changedFrom blindly so
 * an upstream bookkeeping bug cannot leave the VM mirror silently stale.
 */
export function createUserIndicatorBarsPatch(
  previousBars: readonly IndicatorBar[] | null,
  event: UserIndicatorDataEvent,
  dirtyFromOverride?: number,
): UserIndicatorBarsPatch {
  assertBars(event.bars);
  if (previousBars === null) {
    return { mode: 'replace-all', bars: copyBars(event.bars) };
  }
  assertBars(previousBars);

  const requestedDirtyFrom = dirtyFromOverride === undefined
    ? normalizedChangedFrom(event)
    : Math.max(0, Math.min(event.bars.length, Math.trunc(dirtyFromOverride)));
  const from = firstUnexpectedDifference(previousBars, event.bars, requestedDirtyFrom);
  if (from === 0) return { mode: 'replace-all', bars: copyBars(event.bars) };
  return {
    mode: 'replace-from',
    baseLength: previousBars.length,
    from,
    bars: copyBars(event.bars.slice(from)),
  };
}

export function applyUserIndicatorBarsPatch(
  previousBars: readonly IndicatorBar[] | null,
  patch: UserIndicatorBarsPatch,
): readonly IndicatorBar[] {
  if (patch.mode === 'replace-all') {
    assertBars(patch.bars);
    return copyBars(patch.bars);
  }
  if (previousBars === null) throw new Error('replace-from patch requires an existing user indicator bar mirror');
  if (previousBars.length !== patch.baseLength) {
    throw new Error(`user indicator bar mirror length mismatch: expected ${patch.baseLength}, received ${previousBars.length}`);
  }
  if (!Number.isInteger(patch.from) || patch.from < 0 || patch.from > previousBars.length) {
    throw new Error(`user indicator replace-from index ${patch.from} is invalid for ${previousBars.length} bars`);
  }
  const next = [...previousBars.slice(0, patch.from), ...patch.bars];
  assertBars(next);
  return copyBars(next);
}

function mergeRealtimeUpdate(
  previous: IndicatorRealtimeBarUpdate | undefined,
  next: IndicatorRealtimeBarUpdate,
): IndicatorRealtimeBarUpdate {
  if (!previous) return Object.freeze({ ...next });
  if (previous.closed && !next.closed) return previous;
  if (next.closed) return Object.freeze({ ...next });
  const previousEventTime = previous.eventTimeMs ?? Number.NEGATIVE_INFINITY;
  const nextEventTime = next.eventTimeMs ?? Number.NEGATIVE_INFINITY;
  return nextEventTime >= previousEventTime ? Object.freeze({ ...next }) : previous;
}

export function mergeUserIndicatorRealtimeUpdates(
  previous: readonly IndicatorRealtimeBarUpdate[] | undefined,
  next: readonly IndicatorRealtimeBarUpdate[] | undefined,
): readonly IndicatorRealtimeBarUpdate[] | undefined {
  if ((!previous || previous.length === 0) && (!next || next.length === 0)) return undefined;
  const byTime = new Map<number, IndicatorRealtimeBarUpdate>();
  for (const update of previous ?? []) byTime.set(update.barTime, mergeRealtimeUpdate(byTime.get(update.barTime), update));
  for (const update of next ?? []) byTime.set(update.barTime, mergeRealtimeUpdate(byTime.get(update.barTime), update));
  return Object.freeze([...byTime.values()].sort((left, right) => left.barTime - right.barTime));
}

export function coalesceUserIndicatorDataEvent(
  pending: CoalescedIndicatorDataEvent | null,
  next: UserIndicatorDataEvent,
): CoalescedIndicatorDataEvent {
  const changedFrom = pending === null
    ? normalizedChangedFrom(next)
    : Math.min(pending.changedFrom, normalizedChangedFrom(next));
  const trades = mergeUserIndicatorTrades(pending?.trades, next.trades);
  return Object.freeze({
    event: next,
    changedFrom,
    ...(mergeUserIndicatorRealtimeUpdates(pending?.realtimeUpdates, next.realtimeUpdates) === undefined
      ? {}
      : { realtimeUpdates: mergeUserIndicatorRealtimeUpdates(pending?.realtimeUpdates, next.realtimeUpdates) }),
    ...((next.depth ?? pending?.depth) === undefined ? {} : { depth: next.depth ?? pending?.depth }),
    ...(trades === undefined ? {} : { trades }),
    ...((next.marketStatus ?? pending?.marketStatus) === undefined
      ? {}
      : { marketStatus: Object.freeze({ ...(next.marketStatus ?? pending?.marketStatus)! }) }),
  });
}

export function toUserIndicatorRuntimeDataEvent(
  previousBars: readonly IndicatorBar[] | null,
  pending: CoalescedIndicatorDataEvent,
): UserIndicatorRuntimeDataEvent {
  const realtimeUpdates = pending.realtimeUpdates;
  return Object.freeze({
    reason: pending.event.reason,
    changedFrom: pending.changedFrom,
    barsPatch: createUserIndicatorBarsPatch(previousBars, pending.event, pending.changedFrom),
    ...(realtimeUpdates === undefined ? {} : { realtimeUpdates }),
    ...(pending.depth === undefined ? {} : { depth: pending.depth }),
    ...(pending.trades === undefined ? {} : { trades: pending.trades }),
    ...(pending.marketStatus === undefined ? {} : { marketStatus: pending.marketStatus }),
  });
}
