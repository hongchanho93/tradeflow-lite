export function mergeLatestBars<T extends { time: number }>(existing: T[], incoming: T[]): T[] {
  const byTime = new Map(existing.map((bar) => [bar.time, bar]));
  for (const bar of incoming) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

export function updateLatestBarInPlace<T extends { time: number }>(
  bars: T[],
  incoming: T,
): 'replaced' | 'appended' | 'rejected' {
  const latestTime = bars.at(-1)?.time;
  if (latestTime === undefined || incoming.time > latestTime) {
    bars.push(incoming);
    return 'appended';
  }
  if (incoming.time === latestTime) {
    bars[bars.length - 1] = incoming;
    return 'replaced';
  }
  return 'rejected';
}

export function barsForSeriesUpdate<T extends { time: number }>(existing: T[], incoming: T[]): T[] {
  const lastTime = existing.at(-1)?.time;
  return lastTime === undefined ? incoming : incoming.filter((bar) => bar.time >= lastTime);
}

export type BarMutation<T> = {
  bar: T;
  previous?: T;
  index: number;
  kind: 'insert' | 'replace';
  historical: boolean;
};

export type BarReconciliation<T> = {
  bars: T[];
  mutations: BarMutation<T>[];
  changedTimes: number[];
  requiresSeriesReset: boolean;
};

function shallowTimedValueEqual<T extends { time: number }>(left: T, right: T) {
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.is(leftRecord[key], rightRecord[key]));
}

export function reconcileBars<T extends { time: number }>(
  existing: T[],
  incoming: T[],
): BarReconciliation<T> {
  const previousByTime = new Map(existing.map((bar) => [bar.time, bar]));
  const byTime = new Map(previousByTime);
  const latestExistingTime = existing.at(-1)?.time;
  const incomingByTime = new Map(incoming.map((bar) => [bar.time, bar]));
  const mutations: BarMutation<T>[] = [];

  for (const bar of [...incomingByTime.values()].sort((left, right) => left.time - right.time)) {
    const previous = previousByTime.get(bar.time);
    if (previous && shallowTimedValueEqual(previous, bar)) continue;
    byTime.set(bar.time, bar);
    const historical = latestExistingTime !== undefined && bar.time < latestExistingTime;
    mutations.push({
      bar,
      previous,
      index: -1,
      kind: previous ? 'replace' : 'insert',
      historical,
    });
  }

  const bars = [...byTime.values()].sort((left, right) => left.time - right.time);
  const indexByTime = new Map(bars.map((bar, index) => [bar.time, index]));
  for (const mutation of mutations) mutation.index = indexByTime.get(mutation.bar.time) ?? -1;
  return {
    bars,
    mutations,
    changedTimes: mutations.map((mutation) => mutation.bar.time),
    requiresSeriesReset: mutations.some((mutation) => mutation.kind === 'insert' && mutation.historical),
  };
}

export function historyOverlapsTrustedBar<T extends { time: number }>(
  bars: T[],
  trustedBarTime: number,
) {
  const first = bars[0]?.time;
  const last = bars.at(-1)?.time;
  return first !== undefined
    && last !== undefined
    && first <= trustedBarTime
    && last >= trustedBarTime;
}

export function realtimeRecoveryHistoryCounts(maxCount: number, initialCount = 32) {
  const safeMax = Math.max(1, Math.trunc(maxCount));
  let count = Math.min(safeMax, Math.max(1, Math.trunc(initialCount)));
  const counts: number[] = [];
  while (count < safeMax) {
    counts.push(count);
    count = Math.min(safeMax, count * 4);
  }
  if (counts.at(-1) !== safeMax) counts.push(safeMax);
  return counts;
}

export function mergeDeepHistoryWithLiveTail<T extends { time: number }>(
  deepHistory: T[],
  currentBars: T[],
  preserveLiveTail: boolean,
): T[] {
  const boundary = deepHistory.at(-1)?.time;
  if (!preserveLiveTail || boundary === undefined) return deepHistory;
  return mergeLatestBars(
    deepHistory,
    currentBars.filter((bar) => bar.time >= boundary),
  );
}

export function initialVisibleLogicalRange(barCount: number, visibleBars = 160) {
  return {
    from: Math.max(0, barCount - visibleBars),
    to: barCount + 5,
  };
}
