export type MarketSymbolKind = 'stock' | 'etf' | 'index' | 'crypto' | 'prediction';
export type MarketSearchCategory = 'all' | MarketSymbolKind;
export type MarketSearchSource = 'all' | 'sh' | 'sz' | 'bj' | 'sh_main' | 'star' | 'sz_main' | 'chinext'
  | 'binance_spot' | 'binance_usdt' | 'binance_usdc' | 'binance_fdusd' | 'binance_btc' | 'binance_other'
  | 'binance_usdm' | 'binance_usdm_usdt' | 'binance_usdm_usdc'
  | 'okx_spot' | 'okx_spot_usdt' | 'okx_spot_usdc' | 'okx_spot_other'
  | 'okx_swap' | 'okx_swap_usdt' | 'okx_swap_usdc' | 'okx_swap_usd' | 'polymarket';

export type PredictionMarketMetadata = {
  conditionId: string;
  outcome: string;
  opposingSymbol: string;
  description: string;
  resolutionSource: string;
  endDate: string;
  volume: number;
  liquidity: number;
  probability: number;
  change24h: number;
};

export type MarketSymbol = {
  symbol: string;
  code: string;
  name: string;
  /** Legacy display/routing alias. New callers should use providerId + venue. */
  exchange: string;
  providerId: string;
  providerDisplayName: string;
  venue: string;
  kind: MarketSymbolKind;
  realtime?: boolean;
  /** Provider capability snapshot used when history omits a quote. */
  quote?: boolean;
  baseAsset?: string;
  quoteAsset?: string;
  aliases?: string[];
  prediction?: PredictionMarketMetadata;
};

const MARKET_SYMBOL_COMPONENT = /^[A-Z0-9._-]+$/;

export function isCanonicalMarketSymbol(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 2
    && parts[0].length >= 1
    && parts[0].length <= 32
    && parts[1].length >= 1
    && parts[1].length <= 96
    && MARKET_SYMBOL_COMPONENT.test(parts[0])
    && MARKET_SYMBOL_COMPONENT.test(parts[1])
    && value === `${parts[0].toUpperCase()}:${parts[1].toUpperCase()}`;
}

export function marketProviderKey(providerId: string, symbol: string): string {
  return `${providerId}|${symbol}`;
}

export type MarketProviderCapabilities = {
  catalog: boolean;
  history: boolean;
  quote: boolean;
  realtime: boolean;
  venues: string[];
  kinds: MarketSymbolKind[];
  resolutions: string[];
  adjustments: string[];
};

export type MarketProviderDescriptor = {
  id: string;
  displayName: string;
  version: string;
  contractVersion: string;
  enabled: boolean;
  capabilities: MarketProviderCapabilities;
};

export type MarketCatalogSymbol = {
  providerId: string;
  symbol: string;
  name: string;
  kind: MarketSymbolKind;
  baseAsset?: string | null;
  quoteAsset?: string | null;
  prediction?: PredictionMarketMetadata | null;
};

export type MarketCatalogPage = {
  symbols: MarketCatalogSymbol[];
  nextCursor?: string | null;
};

export function marketSymbolFromCatalog(
  row: MarketCatalogSymbol,
  descriptor: MarketProviderDescriptor,
  venue: string,
): MarketSymbol {
  const [, rawCode = row.symbol] = row.symbol.split(':', 2);
  const code = row.prediction
    ? `${row.prediction.outcome} ${row.prediction.probability.toFixed(1)}%`
    : (row.baseAsset && row.quoteAsset ? `${row.baseAsset}/${row.quoteAsset}` : rawCode);
  return {
    symbol: row.symbol,
    code,
    name: row.name,
    exchange: venue,
    providerId: row.providerId,
    providerDisplayName: descriptor.displayName,
    venue,
    kind: row.kind,
    realtime: descriptor.enabled && descriptor.capabilities.realtime,
    quote: descriptor.enabled && descriptor.capabilities.quote,
    baseAsset: row.baseAsset ?? undefined,
    quoteAsset: row.quoteAsset ?? undefined,
    aliases: [rawCode, row.name, row.prediction?.conditionId ?? ''].filter(Boolean),
    prediction: row.prediction ?? undefined,
  };
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN').replace(/[\s/:._-]+/g, '');
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
  if (source === 'polymarket') return item.kind === 'prediction' && item.exchange === 'POLYMARKET';
  if (source === 'okx_spot') return item.kind === 'crypto' && item.exchange === 'OKX';
  if (source === 'okx_swap') return item.kind === 'crypto' && item.exchange === 'OKX_SWAP';
  if (source.startsWith('okx_spot_')) {
    if (item.kind !== 'crypto' || item.exchange !== 'OKX') return false;
    const quote = item.quoteAsset?.toUpperCase();
    if (source === 'okx_spot_other') return !['USDT', 'USDC'].includes(quote ?? '');
    return quote === source.slice('okx_spot_'.length).toUpperCase();
  }
  if (source.startsWith('okx_swap_')) {
    return item.kind === 'crypto'
      && item.exchange === 'OKX_SWAP'
      && item.quoteAsset?.toUpperCase() === source.slice('okx_swap_'.length).toUpperCase();
  }
  if (source === 'binance_spot') return item.kind === 'crypto' && item.exchange === 'BINANCE';
  if (source === 'binance_usdm') return item.kind === 'crypto' && item.exchange === 'BINANCE_USDM';
  if (source.startsWith('binance_usdm_')) {
    return item.kind === 'crypto'
      && item.exchange === 'BINANCE_USDM'
      && item.quoteAsset?.toUpperCase() === source.slice('binance_usdm_'.length).toUpperCase();
  }
  if (source.startsWith('binance_')) {
    if (item.kind !== 'crypto' || item.exchange !== 'BINANCE') return false;
    const quote = item.quoteAsset?.toUpperCase();
    if (source === 'binance_other') return !['USDT', 'USDC', 'FDUSD', 'BTC'].includes(quote ?? '');
    return quote === source.slice('binance_'.length).toUpperCase();
  }
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
  const kindOrder: Record<MarketSymbolKind, number> = { stock: 0, index: 1, etf: 2, crypto: 3, prediction: 4 };
  return filtered
    .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind]
      || left.code.localeCompare(right.code)
      || left.exchange.localeCompare(right.exchange))
    .slice(0, limit);
}

export function searchMarketSymbols(rows: MarketSymbol[], rawQuery: string, limit = 30): MarketSymbol[] {
  const query = normalizeSearchText(rawQuery);
  if (!query || limit <= 0) return [];
  const kindOrder: Record<MarketSymbolKind, number> = { stock: 0, etf: 1, index: 2, crypto: 3, prediction: 4 };
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
