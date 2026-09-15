export type QuoteSnapshot = {
  last: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  receivedAt: number;
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
  return quote.high === 0 || quote.low === 0 || quote.high >= quote.low;
}
