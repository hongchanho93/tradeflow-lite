import type {
  Disposable,
  IndicatorDefinition,
  IndicatorDepthSnapshot,
  IndicatorMarketCapabilities,
  IndicatorMarketData,
  IndicatorMarketStatus,
  IndicatorTrade,
  IndicatorTradeBatch,
  TradeEventKind,
} from './contracts';

type DepthInput = Omit<IndicatorDepthSnapshot, 'receivedTimeMs'> & { receivedTimeMs?: number };

type Listener<T> = (value: Readonly<T>) => void;

function disposable(remove: () => void): Disposable {
  let active = true;
  return { dispose() { if (active) { active = false; remove(); } } };
}

const aggregateTradeKinds: readonly TradeEventKind[] = Object.freeze(['aggregate-trade']);
const tradeKinds: readonly TradeEventKind[] = Object.freeze(['trade']);
const noTradeKinds: readonly TradeEventKind[] = Object.freeze([]);
const providerTradeKinds: Readonly<Record<string, readonly TradeEventKind[]>> = Object.freeze({
  binance_spot: aggregateTradeKinds,
  binance_usdm: aggregateTradeKinds,
  okx_spot: tradeKinds,
  okx_swap: tradeKinds,
});

function frozenCapabilities(providerId: string): Readonly<IndicatorMarketCapabilities> {
  const eventKinds = providerTradeKinds[providerId] ?? noTradeKinds;
  const supported = eventKinds.length > 0;
  return Object.freeze({
    depth: Object.freeze({ supported }),
    trades: Object.freeze({ supported, eventKinds: Object.freeze(eventKinds) }),
    historicalDepth: false,
    historicalTrades: false,
    orderByOrder: false,
  });
}

export class IndicatorMarketRouter implements IndicatorMarketData {
  private readonly onEpochReset: (kind: 'depth' | 'trades') => void;
  private providerId = '';
  private symbol = '';
  private currentCapabilities = frozenCapabilities('');
  private currentStatus: Readonly<IndicatorMarketStatus> = Object.freeze({ state: 'disconnected' });
  private depth: Readonly<IndicatorDepthSnapshot> | null = null;
  private readonly depthListeners = new Set<Listener<IndicatorDepthSnapshot>>();
  private readonly tradeListeners = new Set<Listener<IndicatorTradeBatch>>();
  private readonly statusListeners = new Set<Listener<IndicatorMarketStatus>>();
  private pendingTrades: Readonly<IndicatorTrade>[] = [];
  private flushScheduled = false;
  private epoch = 0;
  private epochReason: IndicatorTradeBatch['resetReason'] = 'initial';
  private subscriptionStartedAtMs = Date.now();
  private droppedSinceSubscriptionStart = 0;
  private completeSinceSubscriptionStart = true;
  private subscriptionSequence = 0;

  constructor(onEpochReset: (kind: 'depth' | 'trades') => void) {
    this.onEpochReset = onEpochReset;
  }

  setSelection(providerId: string, symbol: string): void {
    if (this.providerId === providerId && this.symbol === symbol) return;
    this.providerId = providerId;
    this.symbol = symbol;
    this.currentCapabilities = frozenCapabilities(providerId);
    this.depth = null;
    this.resetEpoch('initial');
    this.setStatus({ state: this.currentCapabilities.trades.supported ? 'connecting' : 'disconnected' });
  }

  capabilities(): Readonly<IndicatorMarketCapabilities> {
    return this.currentCapabilities;
  }

  status(): Readonly<IndicatorMarketStatus> {
    return this.currentStatus;
  }

  getDepth(): Readonly<IndicatorDepthSnapshot> | null {
    return this.depth;
  }

  onDepth(callback: Listener<IndicatorDepthSnapshot>): Disposable {
    this.depthListeners.add(callback);
    return disposable(() => this.depthListeners.delete(callback));
  }

  onTrades(callback: Listener<IndicatorTradeBatch>): Disposable {
    this.tradeListeners.add(callback);
    return disposable(() => this.tradeListeners.delete(callback));
  }

  onStatus(callback: Listener<IndicatorMarketStatus>): Disposable {
    this.statusListeners.add(callback);
    return disposable(() => this.statusListeners.delete(callback));
  }

  forIndicator(definition: IndicatorDefinition): IndicatorMarketData {
    const requires = definition.supports.requires;
    return {
      capabilities: () => this.capabilities(),
      status: () => this.status(),
      getDepth: () => this.getDepth(),
      onDepth: (callback) => {
        if (!requires?.depth) throw new Error(`indicator ${definition.id} must declare supports.requires.depth before calling onDepth()`);
        return this.onDepth(callback);
      },
      onTrades: (callback) => {
        if (!requires?.trades?.length) throw new Error(`indicator ${definition.id} must declare supports.requires.trades before calling onTrades()`);
        let subscriptionStartedAtMs = Date.now();
        let subscriptionId = `${definition.id}:${++this.subscriptionSequence}:${subscriptionStartedAtMs}`;
        let epoch = '';
        return this.onTrades((batch) => {
          if (epoch !== batch.streamEpoch) {
            epoch = batch.streamEpoch;
            subscriptionStartedAtMs = Math.max(subscriptionStartedAtMs, batch.subscriptionStartedAtMs);
            subscriptionId = `${definition.id}:${++this.subscriptionSequence}:${subscriptionStartedAtMs}`;
          }
          callback(Object.freeze({
            ...batch,
            subscriptionId,
            subscriptionStartedAtMs,
            completeSinceSubscriptionStart: batch.completeSinceSubscriptionStart,
          }));
        });
      },
      onStatus: (callback) => this.onStatus(callback),
    };
  }

  pushDepth(input: DepthInput): void {
    if (input.providerId !== this.providerId || input.symbol !== this.symbol) return;
    this.depth = Object.freeze({
      ...input,
      receivedTimeMs: input.receivedTimeMs ?? Date.now(),
      bids: Object.freeze(input.bids.map((level) => Object.freeze({ ...level }))),
      asks: Object.freeze(input.asks.map((level) => Object.freeze({ ...level }))),
    });
    for (const listener of this.depthListeners) listener(this.depth);
  }

  pushTrade(trade: IndicatorTrade): void {
    if (trade.providerId !== this.providerId || trade.symbol !== this.symbol) return;
    this.pendingTrades.push(Object.freeze({ ...trade }));
    if (this.pendingTrades.length > 2_000) {
      const restartAt = this.pendingTrades.at(-1)!;
      this.resetEpoch('buffer-overflow');
      this.pendingTrades = [restartAt];
      this.onEpochReset('trades');
    }
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flushTrades());
  }

  updateConnection(status: IndicatorMarketStatus['state'], reason?: string): void {
    if (status === 'connecting' || status === 'disconnected' || status === 'degraded') {
      this.resetEpoch('source-reset');
      this.onEpochReset('trades');
      this.onEpochReset('depth');
    }
    this.setStatus({ state: status, ...(reason ? { reason } : {}) });
  }

  reportTradeGap(options: Readonly<{ restartAtKnown: boolean; dropped?: number }>): void {
    const dropped = options.dropped ?? 0;
    if (!Number.isInteger(dropped) || dropped < 0) {
      throw new Error('indicator trade gap dropped count must be a non-negative integer');
    }
    if (options.restartAtKnown) {
      this.resetEpoch('sequence-gap');
      this.onEpochReset('trades');
      return;
    }
    this.completeSinceSubscriptionStart = false;
    this.droppedSinceSubscriptionStart += dropped;
    this.epochReason = 'sequence-gap';
    this.setStatus({ state: 'degraded', reason: 'trade-sequence-gap' });
  }

  private resetEpoch(reason: NonNullable<IndicatorTradeBatch['resetReason']>): void {
    this.epoch += 1;
    this.epochReason = reason;
    this.subscriptionStartedAtMs = Date.now();
    this.droppedSinceSubscriptionStart = 0;
    this.completeSinceSubscriptionStart = true;
    this.pendingTrades = [];
  }

  private flushTrades(): void {
    this.flushScheduled = false;
    if (this.pendingTrades.length === 0) return;
    const events = Object.freeze(this.pendingTrades);
    this.pendingTrades = [];
    const batch: Readonly<IndicatorTradeBatch> = Object.freeze({
      events,
      streamEpoch: `${this.providerId}:${this.symbol}:${this.epoch}`,
      subscriptionId: `${this.providerId}:${this.symbol}:${this.subscriptionStartedAtMs}`,
      subscriptionStartedAtMs: this.subscriptionStartedAtMs,
      completeSinceSubscriptionStart: this.completeSinceSubscriptionStart,
      droppedSinceSubscriptionStart: this.droppedSinceSubscriptionStart,
      resetReason: this.epochReason,
    });
    this.epochReason = undefined;
    for (const listener of this.tradeListeners) listener(batch);
  }

  private setStatus(status: IndicatorMarketStatus): void {
    this.currentStatus = Object.freeze(status);
    for (const listener of this.statusListeners) listener(this.currentStatus);
  }
}
