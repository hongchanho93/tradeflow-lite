export const INITIAL_HISTORY_BARS = 300;
export const DEEP_HISTORY_BARS = 8_000;
export const DEEP_DAILY_HISTORY_BARS = 12_000;
export const DEEP_HISTORY_DELAY_MS = 1_200;
export const DEEP_HISTORY_EDGE_BARS = 40;

type CacheEntry<T> = {
  value: T;
  deep: boolean;
  savedAt: number;
};

export class HistoryMemoryCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    maxEntries = 24,
    ttlMs = 5 * 60_000,
    now: () => number = Date.now,
  ) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string): CacheEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.savedAt > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, value: T, deep: boolean) {
    const previous = this.entries.get(key);
    if (previous?.deep && !deep) return;
    this.entries.delete(key);
    this.entries.set(key, { value, deep, savedAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}

export function historyCacheKey(symbol: string, resolution: string, adjustment: string) {
  return `${symbol}|${resolution}|${adjustment}`;
}

export function deepHistoryBars(resolution: string) {
  return resolution === '1D' ? DEEP_DAILY_HISTORY_BARS : DEEP_HISTORY_BARS;
}

export function shouldLoadDeepHistory(
  visibleFrom: number,
  currentBars: number,
  deepAlreadyLoaded: boolean,
) {
  return !deepAlreadyLoaded
    && currentBars >= INITIAL_HISTORY_BARS
    && currentBars < DEEP_HISTORY_BARS
    && visibleFrom <= DEEP_HISTORY_EDGE_BARS;
}
