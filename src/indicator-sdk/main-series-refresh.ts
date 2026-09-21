export type IndicatorBarStyleRefreshResult = {
  readonly mode: 'batch' | 'incremental';
  readonly changedFrom: number;
  readonly dirtyCount: number;
};

export function refreshIndicatorBarStyles<TBar, TPoint, TRange>(options: {
  readonly bars: readonly TBar[];
  readonly changedFrom: number;
  readonly batchThreshold?: number;
  readonly pointAt: (bar: TBar, index: number) => TPoint;
  readonly setData: (points: TPoint[]) => void;
  readonly update: (point: TPoint, historical: true) => void;
  readonly getVisibleRange: () => TRange | null;
  readonly setVisibleRange: (range: TRange) => void;
}): IndicatorBarStyleRefreshResult {
  const changedFrom = Math.max(0, Math.min(options.bars.length, Math.trunc(options.changedFrom)));
  const dirtyCount = options.bars.length - changedFrom;
  if (dirtyCount > (options.batchThreshold ?? 32)) {
    const visibleRange = options.getVisibleRange();
    options.setData(options.bars.map(options.pointAt));
    if (visibleRange) options.setVisibleRange(visibleRange);
    return { mode: 'batch', changedFrom, dirtyCount };
  }
  for (let index = changedFrom; index < options.bars.length; index += 1) {
    options.update(options.pointAt(options.bars[index], index), true);
  }
  return { mode: 'incremental', changedFrom, dirtyCount };
}
