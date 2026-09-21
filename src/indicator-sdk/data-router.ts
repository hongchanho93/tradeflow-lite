import type {
  IndicatorBar,
  IndicatorDataEvent,
  IndicatorRealtimeBarUpdate,
} from './contracts';

type SourceBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount?: number;
};

function sameBar(left: Readonly<IndicatorBar>, right: SourceBar): boolean {
  return left.time === right.time
    && left.open === right.open
    && left.high === right.high
    && left.low === right.low
    && left.close === right.close
    && left.volume === right.volume
    && left.amount === right.amount;
}

function freezeBar(bar: SourceBar): Readonly<IndicatorBar> {
  return Object.freeze({
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    ...(bar.amount === undefined ? {} : { amount: bar.amount }),
  });
}

function validateBars(bars: readonly SourceBar[]): void {
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (!Number.isFinite(bar.time)
      || !Number.isFinite(bar.open)
      || !Number.isFinite(bar.high)
      || !Number.isFinite(bar.low)
      || !Number.isFinite(bar.close)
      || !Number.isFinite(bar.volume)
      || (bar.amount !== undefined && !Number.isFinite(bar.amount))) {
      throw new Error(`indicator bars contain an invalid value at index ${index}`);
    }
    if (index > 0 && bars[index - 1].time >= bar.time) {
      throw new Error(`indicator bars must be strictly ascending at index ${index}`);
    }
  }
}

export class IndicatorDataRouter {
  private barsByTime = new Map<number, Readonly<IndicatorBar>>();

  reset(): void {
    this.barsByTime.clear();
  }

  event(
    bars: readonly SourceBar[],
    reason: IndicatorDataEvent['reason'],
    changedFrom: number,
    realtimeUpdates?: readonly IndicatorRealtimeBarUpdate[],
  ): Readonly<IndicatorDataEvent> {
    validateBars(bars);
    const nextByTime = new Map<number, Readonly<IndicatorBar>>();
    const snapshot = bars.map((bar) => {
      const cached = this.barsByTime.get(bar.time);
      const immutable = cached && sameBar(cached, bar) ? cached : freezeBar(bar);
      nextByTime.set(bar.time, immutable);
      return immutable;
    });
    this.barsByTime = nextByTime;
    const immutableBars = Object.freeze(snapshot);
    const normalizedChangedFrom = Math.max(0, Math.min(Math.trunc(changedFrom), immutableBars.length));
    const immutableUpdates = realtimeUpdates === undefined
      ? undefined
      : Object.freeze(realtimeUpdates.map((update) => Object.freeze({ ...update })));
    return Object.freeze({
      reason,
      bars: immutableBars,
      changedFrom: normalizedChangedFrom,
      ...(immutableUpdates === undefined ? {} : { realtimeUpdates: immutableUpdates }),
    });
  }
}
