export type MarketSymbolKind = 'stock' | 'etf' | 'index';
export type MarketSearchCategory = 'all' | MarketSymbolKind;
export type MarketSearchSource = 'all' | 'sh' | 'sz' | 'bj' | 'sh_main' | 'star' | 'sz_main' | 'chinext';

export type MarketSymbol = {
  symbol: string;
  code: string;
  name: string;
  exchange: 'SH' | 'SZ' | 'BJ';
  kind: MarketSymbolKind;
  aliases?: string[];
};

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN').replace(/[\s:._-]+/g, '');
}

function matchRank(item: MarketSymbol, query: string): number | null {
  const exactValues = [item.symbol, item.code, item.name];
  const allValues = [...exactValues, ...(item.aliases ?? [])].map(normalizeSearchText);
  const exact = exactValues.map(normalizeSearchText);
  if (exact.includes(query)) return 0;
  if (allValues.some((value) => value.startsWith(query))) return 1;
  if (allValues.some((value) => value.includes(query))) return 2;
  return null;
}

export function marketSymbolMatchesSource(
  item: MarketSymbol,
  category: MarketSearchCategory,
  source: MarketSearchSource,
): boolean {
  if (category !== 'all' && item.kind !== category) return false;
  if (source === 'all') return true;
  if (source === 'sh' || source === 'sz' || source === 'bj') return item.exchange === source.toUpperCase();
  if (item.kind !== 'stock') return false;
  if (source === 'star') return item.exchange === 'SH' && /^(688|689)/.test(item.code);
  if (source === 'sh_main') return item.exchange === 'SH' && !/^(688|689)/.test(item.code);
  if (source === 'chinext') return item.exchange === 'SZ' && /^(300|301|302)/.test(item.code);
  if (source === 'sz_main') return item.exchange === 'SZ' && !/^(300|301|302)/.test(item.code);
  return false;
}

export function listMarketSymbols(
  rows: MarketSymbol[],
  rawQuery: string,
  category: MarketSearchCategory = 'all',
  source: MarketSearchSource = 'all',
  limit = 60,
): MarketSymbol[] {
  if (limit <= 0) return [];
  const filtered = rows.filter((item) => marketSymbolMatchesSource(item, category, source));
  const query = normalizeSearchText(rawQuery);
  if (query) {
    return filtered
      .flatMap((item) => {
        const rank = matchRank(item, query);
        return rank === null ? [] : [{ item, rank }];
      })
      .sort((left, right) => left.rank - right.rank || left.item.code.localeCompare(right.item.code))
      .slice(0, limit)
      .map(({ item }) => item);
  }
  const kindOrder: Record<MarketSymbolKind, number> = { stock: 0, index: 1, etf: 2 };
  return filtered
    .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind]
      || left.code.localeCompare(right.code)
      || left.exchange.localeCompare(right.exchange))
    .slice(0, limit);
}

export function searchMarketSymbols(rows: MarketSymbol[], rawQuery: string, limit = 30): MarketSymbol[] {
  const query = normalizeSearchText(rawQuery);
  if (!query || limit <= 0) return [];
  const kindOrder: Record<MarketSymbolKind, number> = { stock: 0, etf: 1, index: 2 };
  return rows
    .flatMap((item) => {
      const rank = matchRank(item, query);
      return rank === null ? [] : [{ item, rank }];
    })
    .sort((left, right) => left.rank - right.rank
      || kindOrder[left.item.kind] - kindOrder[right.item.kind]
      || left.item.code.localeCompare(right.item.code))
    .slice(0, limit)
    .map(({ item }) => item);
}
