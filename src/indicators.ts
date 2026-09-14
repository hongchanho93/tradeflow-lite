export type OptionalValue = number | null;

export function sma(values: number[], period: number): OptionalValue[] {
  const result = Array<OptionalValue>(values.length).fill(null);
  if (period < 1) return result;
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) sum -= values[index - period];
    if (index >= period - 1) result[index] = sum / period;
  }
  return result;
}

export function ema(values: number[], period: number): OptionalValue[] {
  const result = Array<OptionalValue>(values.length).fill(null);
  if (period < 1 || values.length < period) return result;
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = seed;
  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    result[index] = values[index] * multiplier + (result[index - 1] as number) * (1 - multiplier);
  }
  return result;
}

function emaOptional(values: OptionalValue[], period: number): OptionalValue[] {
  const result = Array<OptionalValue>(values.length).fill(null);
  const first = values.findIndex((value) => value !== null);
  if (first < 0) return result;
  const defined = values.slice(first) as number[];
  const calculated = ema(defined, period);
  for (let index = 0; index < calculated.length; index += 1) result[first + index] = calculated[index];
  return result;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const dif = values.map((_, index) => fastLine[index] !== null && slowLine[index] !== null
    ? (fastLine[index] as number) - (slowLine[index] as number)
    : null);
  const dea = emaOptional(dif, signal);
  const histogram = dif.map((value, index) => value !== null && dea[index] !== null
    ? 2 * (value - (dea[index] as number))
    : null);
  return { dif, dea, histogram };
}

export function rsi(values: number[], period = 14): OptionalValue[] {
  const result = Array<OptionalValue>(values.length).fill(null);
  if (period < 1 || values.length <= period) return result;
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }
  averageGain /= period;
  averageLoss /= period;
  const valueOf = () => averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  result[period] = valueOf();
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[index] = valueOf();
  }
  return result;
}

export function boll(values: number[], period = 20, multiplier = 2) {
  const middle = sma(values, period);
  const upper = Array<OptionalValue>(values.length).fill(null);
  const lower = Array<OptionalValue>(values.length).fill(null);
  for (let index = period - 1; index < values.length; index += 1) {
    const mean = middle[index] as number;
    const variance = values
      .slice(index - period + 1, index + 1)
      .reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const deviation = Math.sqrt(variance) * multiplier;
    upper[index] = mean + deviation;
    lower[index] = mean - deviation;
  }
  return { middle, upper, lower };
}

export type BollBreakout = 'upper' | 'lower' | null;

export function bollBreakouts(
  closes: number[],
  upper: OptionalValue[],
  lower: OptionalValue[],
): BollBreakout[] {
  return closes.map((close, index) => {
    if (index === 0
      || upper[index - 1] === null || upper[index] === null
      || lower[index - 1] === null || lower[index] === null) return null;
    if (closes[index - 1] <= (upper[index - 1] as number) && close > (upper[index] as number)) return 'upper';
    if (closes[index - 1] >= (lower[index - 1] as number) && close < (lower[index] as number)) return 'lower';
    return null;
  });
}
