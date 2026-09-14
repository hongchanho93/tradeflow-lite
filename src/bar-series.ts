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
