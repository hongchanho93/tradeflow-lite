export type RealtimeBarSource = 'kline' | 'aggTrade';

export type RealtimeBarEvent<TBar> = {
  requestId: number;
  providerId: string;
  symbol: string;
  resolution: string;
  sequence?: number | null;
  bar: TBar;
  closed: boolean;
  eventTimeMs: number;
  source: RealtimeBarSource;
};

export type RealtimePointEvent<TPoint> = {
  requestId: number;
  providerId: string;
  symbol: string;
  resolution: string;
  sequence?: number | null;
  point: TPoint;
  eventTimeMs: number;
  source: string;
};

export type RealtimeStatusEvent = {
  requestId: number;
  providerId: string;
  symbol: string;
  resolution: string;
  sequence?: number | null;
  status: 'connecting' | 'connected' | 'reconnecting';
  message?: string;
};

export type RealtimePriceLevel = { price: number; quantity: number };

export type RealtimeDepthEvent = {
  requestId: number;
  providerId: string;
  symbol: string;
  resolution: string;
  sequence?: number | null;
  eventTimeMs: number;
  bids: RealtimePriceLevel[];
  asks: RealtimePriceLevel[];
};

export type RealtimeTradeEvent = {
  requestId: number;
  providerId: string;
  symbol: string;
  resolution: string;
  sequence?: number | null;
  tradeId: number;
  tradeTimeMs: number;
  price: number;
  quantity: number;
  side?: string | null;
  flags?: number | null;
};

export type RealtimeSequenceChannel = 'bar' | 'point' | 'depth' | 'trade';

type RealtimeSequenceIdentity = {
  requestId: number;
  providerId: string;
  symbol: string;
  resolution: string;
};

function normalizeRealtimeBarSource(source: unknown): RealtimeBarSource | 'unknown' {
  return source === 'kline' || source === 'aggTrade' ? source : 'unknown';
}

export function realtimeSequenceKey(
  event: RealtimeSequenceIdentity & { source?: unknown },
  channel: RealtimeSequenceChannel,
) {
  const channelKey = channel === 'bar'
    ? `${channel}:${normalizeRealtimeBarSource(event.source)}`
    : channel;
  return `${event.requestId}:${event.providerId}:${event.symbol}:${event.resolution}:${channelKey}`;
}

export function realtimeRequestSeed(nowMs: number) {
  return Math.trunc(nowMs) * 1_000;
}

export function matchesRealtimeSelection(
  event: { requestId: number; providerId?: string; symbol: string; resolution: string },
  requestId: number,
  symbol: string,
  resolution: string,
  providerId?: string,
) {
  return event.requestId === requestId
    && (providerId === undefined || event.providerId === providerId)
    && event.symbol === symbol
    && event.resolution === resolution;
}

export function isRealtimeSequenceFresh(
  sequence: number | null | undefined,
  previousSequence: number | null | undefined,
) {
  return sequence == null || previousSequence == null || sequence > previousSequence;
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
