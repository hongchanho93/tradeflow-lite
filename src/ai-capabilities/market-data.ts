import { CapabilityError, type JsonValue, type ToolExecutionContext, type ToolSessionScope } from './contracts.ts';
import type { HistoryQuery, MarketQueryPort } from './market-query.ts';

// In-memory query results only, not a database or the foreground chart cache.
export const MARKET_RESULT_LIMITS = Object.freeze({ rows: 12_000, pageRows: 1_000, results: 8, perSession: 4,
  resultBytes: 4 * 1024 * 1024, totalBytes: 16 * 1024 * 1024, ttlMs: 5 * 60_000 });
type Row = Readonly<Record<string, number>>;
type ResultEntry = { owner: ToolSessionScope; appId: string; rows: readonly Row[]; descriptor: { readonly [key: string]: JsonValue };
  bytes: number; expires: number; taskSignal: AbortSignal; cleanup(): void };
export type MarketComputeDataset = Readonly<{
  descriptor: { readonly [key: string]: JsonValue };
  seriesKind: 'ohlcv' | 'probability';
  rows: readonly Row[];
}>;
export const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const invalid = (): never => { throw new CapabilityError('invalid_output'); };
const encoder = new TextEncoder();

export function copyHistory(value: unknown, query: HistoryQuery) {
  if (!object(value) || value.symbol !== query.symbol || !object(value.diagnostics)
    || typeof value.diagnostics.source !== 'string' || value.diagnostics.source.length > 256) return invalid();
  const probability = value.seriesKind === 'probability';
  if ((!probability && value.seriesKind !== 'ohlcv') || (probability && query.kind !== 'prediction')) return invalid();
  const raw = probability ? value.points : value.bars;
  const other = probability ? value.bars : value.points;
  if (!Array.isArray(raw) || !raw.length || raw.length > query.count || raw.length > MARKET_RESULT_LIMITS.rows
    || (other !== undefined && (!Array.isArray(other) || other.length))) return invalid();
  let previous = -Infinity, bytes = 0;
  const rows = raw.map(item => {
    if (!object(item) || !Number.isSafeInteger(item.time) || (item.time as number) <= previous) return invalid();
    previous = item.time as number;
    const keys = probability ? ['time', 'value'] : ['time', 'open', 'high', 'low', 'close', 'volume', ...(item.amount === undefined ? [] : ['amount'])];
    const row: Record<string, number> = {};
    for (const key of keys) { if (typeof item[key] !== 'number' || !Number.isFinite(item[key])) return invalid(); row[key] = item[key]; }
    if (probability ? row.value < 0 || row.value > 100 : row.high < Math.max(row.open, row.close, row.low)
      || row.low > Math.min(row.open, row.close) || row.volume < 0 || (row.amount !== undefined && row.amount < 0)) return invalid();
    bytes += encoder.encode(JSON.stringify(row)).length + 1;
    if (bytes > MARKET_RESULT_LIMITS.resultBytes) throw new CapabilityError('snapshot_capacity');
    return Object.freeze(row);
  });
  if (value.nextCursor !== undefined && value.nextCursor !== null
    && (typeof value.nextCursor !== 'string' || !value.nextCursor || value.nextCursor.length > 4096)) return invalid();
  return { rows: Object.freeze(rows), bytes, source: value.diagnostics.source, seriesKind: probability ? 'probability' : 'ohlcv',
    ...(typeof value.nextCursor === 'string' ? { nextCursor: value.nextCursor } : {}) };
}

export class MarketResultStore {
  readonly #port: MarketQueryPort;
  readonly #now: () => number;
  readonly #entries = new Map<string, ResultEntry>();
  readonly #pending = new Map<ToolSessionScope, number>();
  #bytes = 0;
  #closed = false;
  constructor(port: MarketQueryPort, now = () => performance.now()) { this.#port = port; this.#now = now; }
  async capture(query: HistoryQuery, ctx: ToolExecutionContext): Promise<JsonValue> {
    if (this.#closed) throw new CapabilityError('snapshot_unavailable');
    ctx.checkpoint(); this.#prune();
    const pending = [...this.#pending.values()].reduce((sum, n) => sum + n, 0);
    const own = [...this.#entries.values()].filter(e => e.owner === ctx.session).length;
    if (this.#entries.size + pending >= MARKET_RESULT_LIMITS.results || own + (this.#pending.get(ctx.session) ?? 0) >= MARKET_RESULT_LIMITS.perSession) {
      throw new CapabilityError('snapshot_capacity');
    }
    this.#pending.set(ctx.session, (this.#pending.get(ctx.session) ?? 0) + 1);
    try {
      const value = await this.#port.execute({ operation: 'history', ...query }, ctx.signal);
      ctx.checkpoint();
      if (this.#closed) throw new CapabilityError('snapshot_unavailable');
      const copied = copyHistory(value, query);
      const datasetId = `market-${crypto.randomUUID()}`;
      const descriptor = Object.freeze({ datasetId, ...query, requestedCount: query.count, rowCount: copied.rows.length,
        seriesKind: copied.seriesKind, source: copied.source, fromTime: copied.rows[0].time, toTime: copied.rows.at(-1)!.time,
        capturedAtMs: Date.now(), coverage: 'provider-returned-window', shortfall: copied.rows.length < query.count,
        timeUnit: 'unix-seconds', priceUnit: copied.seriesKind === 'probability' ? 'percent' : 'provider-native',
        volumeUnit: copied.seriesKind === 'probability' ? 'not-applicable' : 'unknown', finality: 'unknown',
        ...(copied.nextCursor === undefined ? {} : { nextCursor: copied.nextCursor }) });
      const bytes = copied.bytes + encoder.encode(JSON.stringify(descriptor)).length;
      this.#prune();
      if (bytes > MARKET_RESULT_LIMITS.resultBytes || this.#bytes + bytes > MARKET_RESULT_LIMITS.totalBytes) throw new CapabilityError('snapshot_capacity');
      ctx.checkpoint();
      const cleanup = () => this.#remove(datasetId);
      const entry: ResultEntry = { owner: ctx.session, appId: ctx.context.appInstanceId, rows: copied.rows, descriptor,
        bytes, expires: this.#now() + MARKET_RESULT_LIMITS.ttlMs, taskSignal: ctx.signal, cleanup };
      this.#entries.set(datasetId, entry); this.#bytes += bytes;
      ctx.session.signal.addEventListener('abort', cleanup, { once: true });
      ctx.signal.addEventListener('abort', cleanup, { once: true });
      return descriptor;
    } finally {
      const n = (this.#pending.get(ctx.session) ?? 1) - 1;
      if (n) this.#pending.set(ctx.session, n); else this.#pending.delete(ctx.session);
    }
  }
  page(id: string, offset: number, limit: number, ctx: ToolExecutionContext): JsonValue {
    const entry = this.#get(id, ctx), rows = entry.rows.slice(offset, offset + limit);
    return { datasetId: id, seriesKind: entry.descriptor.seriesKind, rows, offset, total: entry.rows.length,
      ...(offset + rows.length < entry.rows.length ? { nextOffset: offset + rows.length } : {}) };
  }
  getForCompute(id: string, ctx: ToolExecutionContext): MarketComputeDataset {
    const entry = this.#get(id, ctx);
    const seriesKind = entry.descriptor.seriesKind;
    if (seriesKind !== 'ohlcv' && seriesKind !== 'probability') throw new CapabilityError('invalid_output');
    return Object.freeze({ descriptor: entry.descriptor, seriesKind, rows: entry.rows });
  }
  release(id: string, ctx: ToolExecutionContext): JsonValue { this.#get(id, ctx); this.#remove(id); return { released: true }; }
  /** Retire an entire dynamic source implementation, including session-owned pages. */
  close(): void { this.#closed = true; for (const id of this.#entries.keys()) this.#remove(id); }
  #get(id: string, ctx: ToolExecutionContext): ResultEntry {
    if (this.#closed) throw new CapabilityError('snapshot_unavailable');
    ctx.checkpoint(); this.#prune();
    const entry = this.#entries.get(id);
    const owner = entry?.owner.sessionIdentity ?? entry?.owner;
    const requester = ctx.session.sessionIdentity ?? ctx.session;
    if (!entry || owner !== requester || entry.appId !== ctx.context.appInstanceId) throw new CapabilityError('snapshot_unavailable');
    return entry;
  }
  #prune(): void { for (const [id, entry] of this.#entries) if (entry.expires <= this.#now() || entry.owner.signal.aborted) this.#remove(id); }
  #remove(id: string): void {
    const entry = this.#entries.get(id); if (!entry) return;
    this.#entries.delete(id); this.#bytes -= entry.bytes;
    entry.owner.signal.removeEventListener('abort', entry.cleanup);
    entry.taskSignal.removeEventListener('abort', entry.cleanup);
  }
}
