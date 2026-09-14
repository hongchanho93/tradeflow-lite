export function mergeLatestBars<T extends { time: number }>(existing: T[], incoming: T[]): T[] {
  const byTime = new Map(existing.map((bar) => [bar.time, bar]));
  for (const bar of incoming) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

export function barsForSeriesUpdate<T extends { time: number }>(existing: T[], incoming: T[]): T[] {
  const lastTime = existing.at(-1)?.time;
  return lastTime === undefined ? incoming : incoming.filter((bar) => bar.time >= lastTime);
}

export function initialVisibleLogicalRange(barCount: number, visibleBars = 160) {
  return {
    from: Math.max(0, barCount - visibleBars),
    to: barCount + 5,
  };
}
