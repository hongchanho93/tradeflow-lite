export type TdxRecentTrade = {
  tradeId: number;
  tradeTimeMs: number;
  price: number;
  quantity: number;
  transactionCount: number;
  side?: 'buy' | 'sell' | null;
};

export type TdxRecentTradesResponse = {
  providerId: string;
  symbol: string;
  source: string;
  receivedAt: number;
  trades: TdxRecentTrade[];
};

export function isUsableTdxRecentTrades(
  response: TdxRecentTradesResponse,
  providerId: string,
  symbol: string,
): boolean {
  if (response.providerId !== providerId || response.symbol !== symbol) return false;
  if (response.source !== 'tradeflow-tdx-transactions' || !Number.isFinite(response.receivedAt) || response.receivedAt <= 0) return false;
  if (!Array.isArray(response.trades) || response.trades.length > 800) return false;
  return response.trades.every((trade, index) => Number.isSafeInteger(trade.tradeId)
    && Number.isFinite(trade.tradeTimeMs)
    && trade.tradeTimeMs > 0
    && Number.isFinite(trade.price)
    && trade.price > 0
    && Number.isFinite(trade.quantity)
    && trade.quantity >= 0
    && Number.isInteger(trade.transactionCount)
    && trade.transactionCount >= 0
    && (trade.side === 'buy' || trade.side === 'sell' || trade.side == null)
    && (index === 0 || response.trades[index - 1].tradeTimeMs <= trade.tradeTimeMs));
}
