export const WATCHLIST_STORAGE_KEY = 'tradeflow-lite.watchlist.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function normalizeWatchlist(symbols: unknown, knownSymbols: Set<string>): string[] {
  if (!Array.isArray(symbols)) return [];
  const unique = new Set<string>();
  for (const symbol of symbols) {
    if (typeof symbol === 'string' && knownSymbols.has(symbol)) unique.add(symbol);
    if (unique.size >= 100) break;
  }
  return [...unique];
}

export function loadWatchlist(storage: StorageLike, knownSymbols: Set<string>): string[] {
  try {
    const parsed = JSON.parse(storage.getItem(WATCHLIST_STORAGE_KEY) ?? 'null');
    return normalizeWatchlist(parsed?.symbols, knownSymbols);
  } catch {
    return [];
  }
}

export function saveWatchlist(storage: StorageLike, symbols: string[]): boolean {
  try {
    storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify({ version: 1, symbols }));
    return true;
  } catch {
    return false;
  }
}

export function moveWatchlistSymbol(symbols: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (index < 0 || index >= symbols.length || target < 0 || target >= symbols.length) return [...symbols];
  const next = [...symbols];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
