export type ProbabilityPoint = { time: number; value: number };

export type ProbabilityBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function probabilityPointsToBars(points: ProbabilityPoint[]): ProbabilityBar[] {
  let previousTime = -Infinity;
  return points.map((point) => {
    if (!Number.isFinite(point.time) || point.time <= previousTime) {
      throw new Error('probability points must have unique ascending timestamps');
    }
    if (!Number.isFinite(point.value) || point.value < 0 || point.value > 100) {
      throw new Error('probability values must be between 0 and 100');
    }
    previousTime = point.time;
    return {
      time: point.time,
      open: point.value,
      high: point.value,
      low: point.value,
      close: point.value,
      volume: 0,
    };
  });
}

export function normalizeProbabilityHistory<T extends {
  seriesKind: 'ohlcv' | 'probability';
  bars: ProbabilityBar[];
  points?: ProbabilityPoint[];
}>(response: T): T {
  if (response.seriesKind === 'ohlcv') return response;
  const points = response.points ?? [];
  if (!points.length || response.bars.length) {
    throw new Error('probability history must contain points and no OHLCV bars');
  }
  return { ...response, bars: probabilityPointsToBars(points) };
}
