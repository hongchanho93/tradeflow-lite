export type QuoteBookLevel = {
  price: number;
  quantity: number;
};

export type QuoteSnapshot = {
  last: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  receivedAt: number;
  bids?: QuoteBookLevel[];
  asks?: QuoteBookLevel[];
};

export type QuoteResponse = {
  providerId: string;
  symbol: string;
  source: string;
  quote: QuoteSnapshot;
};

export function shouldFetchStandaloneQuote(
  hasHistoryQuote: boolean,
  providerSupportsQuote: boolean,
): boolean {
  return providerSupportsQuote && !hasHistoryQuote;
}

export function matchesQuoteResponse(
  response: Pick<QuoteResponse, 'providerId' | 'symbol'> | null | undefined,
  providerId: string,
  symbol: string,
): boolean {
  return response?.providerId === providerId && response.symbol === symbol;
}

export function isUsableQuote(quote: QuoteSnapshot): boolean {
  const values = [
    quote.last,
    quote.previousClose,
    quote.open,
    quote.high,
    quote.low,
    quote.volume,
    quote.amount,
    quote.receivedAt,
  ];
  if (!values.every(Number.isFinite)) return false;
  if (quote.last <= 0 || quote.previousClose <= 0 || quote.receivedAt <= 0) return false;
  if (quote.open < 0 || quote.high < 0 || quote.low < 0 || quote.volume < 0 || quote.amount < 0) return false;
  return (quote.high === 0 || quote.low === 0 || quote.high >= quote.low)
    && quoteBookLevels(quote) !== undefined;
}

export function quoteBookLevels(
  quote: Pick<QuoteSnapshot, 'bids' | 'asks'>,
): { bids: QuoteBookLevel[]; asks: QuoteBookLevel[] } | null | undefined {
  if (quote.bids === undefined && quote.asks === undefined) return null;
  if (!Array.isArray(quote.bids) || !Array.isArray(quote.asks)) return undefined;
  const validSide = (levels: QuoteBookLevel[], ascending: boolean) => levels.length <= 5
    && levels.every((level) => Number.isFinite(level.price)
      && Number.isFinite(level.quantity)
      && level.price > 0
      && level.quantity >= 0)
    && levels.every((level, index) => index === 0
      || (ascending ? levels[index - 1].price < level.price : levels[index - 1].price > level.price));
  if (!validSide(quote.bids, false) || !validSide(quote.asks, true)) return undefined;
  if (!quote.bids.length && !quote.asks.length) return null;
  return { bids: quote.bids, asks: quote.asks };
}
