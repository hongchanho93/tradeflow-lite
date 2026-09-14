export type RealtimeBarEvent<TBar> = {
  requestId: number;
  symbol: string;
  resolution: string;
  bar: TBar;
  closed: boolean;
  eventTimeMs: number;
  source: 'aggTrade' | 'kline';
};

export type RealtimeStatusEvent = {
  requestId: number;
  symbol: string;
  resolution: string;
  status: 'connecting' | 'connected' | 'reconnecting';
  message?: string;
};

export type RealtimePriceLevel = { price: number; quantity: number };

export type RealtimeDepthEvent = {
  requestId: number;
  symbol: string;
  resolution: string;
  lastUpdateId: number;
  bids: RealtimePriceLevel[];
  asks: RealtimePriceLevel[];
};

export type RealtimeTradeEvent = {
  requestId: number;
  symbol: string;
  resolution: string;
  aggregateTradeId: number;
  tradeTimeMs: number;
  price: number;
  quantity: number;
  buyerIsMaker: boolean;
};

export function realtimeRequestSeed(nowMs: number) {
  return Math.trunc(nowMs) * 1_000;
}

export function matchesRealtimeSelection(
  event: { requestId: number; symbol: string; resolution: string },
  requestId: number,
  symbol: string,
  resolution: string,
) {
  return event.requestId === requestId
    && event.symbol === symbol
    && event.resolution === resolution;
}

export function canApplyRealtimeBar(
  currentBars: Array<{ time: number }>,
  incoming: { time: number },
) {
  const latestTime = currentBars.at(-1)?.time;
  return latestTime === undefined || incoming.time >= latestTime;
}

export const MARKET_DATA_RENDER_INTERVAL_MS = 100;
export const REALTIME_FRAME_FALLBACK_MS = 50;

export function marketDataRenderDelay(
  nowMs: number,
  lastRenderMs: number,
  intervalMs = MARKET_DATA_RENDER_INTERVAL_MS,
) {
  if (lastRenderMs <= 0) return 0;
  return Math.max(0, intervalMs - (nowMs - lastRenderMs));
}
