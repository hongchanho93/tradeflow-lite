import {
  CapabilityError, SELECTION_SCHEMA, sameSelection, requireChartSelection,
  type JsonValue, type SelectionRef, type ToolExecutionContext, type ToolSessionScope, type ValueSchema,
} from './contracts.ts';
import { snapshotJson, validateValue } from './json.ts';

/** On-demand datasets, independent of (and never enlarging) market history retention. */
export const CHART_DATA_LIMITS = Object.freeze({
  maxRows: 15_000, maxPageRows: 1_000, defaultPageRows: 250,
  maxSnapshotBytes: 4 * 1024 * 1024, maxStoredBytes: 16 * 1024 * 1024,
  maxSnapshots: 8, maxSnapshotsPerSession: 2, ttlMs: 5 * 60_000,
});
type DataLimits = { readonly [K in keyof typeof CHART_DATA_LIMITS]: number };
type SnapshotLimits = Omit<DataLimits, 'maxPageRows' | 'defaultPageRows'>;

export interface ChartBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly amount?: number;
}

/** Synchronous view of the SAME committed state consumed by the visible chart. */
export interface ChartReadState {
  readonly context: SelectionRef;
  readonly displayedGeneration: number;
  readonly dataRevision: number;
  readonly seriesKind: 'ohlcv' | 'probability';
  readonly bars: readonly ChartBar[];
  readonly timeZone: string;
  readonly displayTimeZone: string;
  readonly baseAsset?: string;
  readonly quoteAsset?: string;
}

export const numberSchema: ValueSchema = { type: 'number' };
export const countSchema: ValueSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const textSchema: ValueSchema = { type: 'string', maxLength: 256 };
export const snapshotIdSchema: ValueSchema = { type: 'string', maxLength: 128 };
export const objectSchema = (
  properties: Readonly<Record<string, ValueSchema>>, required: readonly string[] = Object.keys(properties),
): ValueSchema => ({ type: 'object', properties, required, additionalProperties: false });

export const chartMetadataSchema: ValueSchema = objectSchema({
  timeUnit: { type: 'string', enum: ['unix-seconds'] },
  timeZone: textSchema, displayTimeZone: textSchema,
  barTimeMeaning: { type: 'string', enum: ['provider-defined'] },
  priceUnit: { type: 'string', enum: ['provider-native', 'percent'] },
  volumeUnit: { type: 'string', enum: ['unknown', 'not-applicable'] },
  amountUnit: { type: 'string', enum: ['unknown', 'not-applicable'] },
  finality: { type: 'string', enum: ['unknown'] },
  coverage: { type: 'string', enum: ['retained-chart-window'] },
  gapAssessment: { type: 'string', enum: ['not-assessed'] },
  amountCoverage: { type: 'string', enum: ['all', 'partial', 'none'] },
  baseAsset: textSchema, quoteAsset: textSchema,
}, ['timeUnit', 'timeZone', 'displayTimeZone', 'barTimeMeaning', 'priceUnit', 'volumeUnit',
  'amountUnit', 'finality', 'coverage', 'gapAssessment', 'amountCoverage']);

export const snapshotDescriptorSchema: ValueSchema = objectSchema({
  snapshotId: snapshotIdSchema, context: SELECTION_SCHEMA,
  seriesKind: { type: 'string', enum: ['ohlcv', 'probability'] },
  capturedAtMs: countSchema, dataRevision: countSchema, rowCount: countSchema,
  fromTime: numberSchema, toTime: numberSchema,
  fields: { type: 'array', items: textSchema, maxItems: 8 }, metadata: chartMetadataSchema,
});

export type ChartRow = Readonly<Record<string, number>>;
export interface ChartSnapshot {
  readonly descriptor: { readonly [key: string]: JsonValue };
  readonly context: SelectionRef;
  readonly seriesKind: 'ohlcv' | 'probability';
  readonly rows: readonly ChartRow[];
}
interface StoredSnapshot {
  readonly value: ChartSnapshot;
  readonly owner: ToolSessionScope;
  readonly bytes: number;
  readonly expiresAt: number;
  readonly taskSignal: AbortSignal;
  readonly onTaskAbort: () => void;
}
const barKeys = ['time', 'open', 'high', 'low', 'close', 'volume'] as const;
const encoder = new TextEncoder();

/** Session-owned resources, NOT an independently fetched market cache. */
export class ChartSnapshotStore {
  readonly #read: () => ChartReadState;
  readonly #now: () => number;
  readonly #wallNow: () => number;
  readonly #limits: DataLimits;
  readonly #entries = new Map<string, StoredSnapshot>();
  readonly #revokeListeners = new Map<ToolSessionScope, () => void>();
  #bytes = 0;
  #sequence = 0;

  constructor(read: () => ChartReadState, options: {
    now?: () => number; wallNow?: () => number; limits?: Partial<SnapshotLimits>;
  } = {}) {
    this.#read = read;
    this.#now = options.now ?? (() => performance.now());
    this.#wallNow = options.wallNow ?? Date.now;
    const overridable = new Set(['maxRows', 'maxSnapshotBytes', 'maxStoredBytes',
      'maxSnapshots', 'maxSnapshotsPerSession', 'ttlMs']);
    if (Object.keys(options.limits ?? {}).some(key => !overridable.has(key))) {
      throw new CapabilityError('invalid_contract');
    }
    const limits = { ...CHART_DATA_LIMITS, ...options.limits };
    for (const [key, value] of Object.entries(limits)) {
      if (!Object.hasOwn(CHART_DATA_LIMITS, key) || !Number.isSafeInteger(value) || value <= 0
        || value > CHART_DATA_LIMITS[key as keyof DataLimits]) throw new CapabilityError('invalid_contract');
    }
    this.#limits = Object.freeze(limits);
  }

  capture(execution: ToolExecutionContext): ChartSnapshot {
    this.#check(execution);
    this.#prune();
    if (this.#entries.size >= this.#limits.maxSnapshots
      || [...this.#entries.values()].filter(entry => entry.owner === execution.session).length
        >= this.#limits.maxSnapshotsPerSession) throw new CapabilityError('snapshot_capacity');
    // No await inside the copy: realtime cannot change the source halfway through.
    const state = this.#read();
    this.#check(execution);
    if (!sameSelection(state.context, requireChartSelection(execution.context))) throw new CapabilityError('context_stale');
    if (!Array.isArray(state.bars)) throw new CapabilityError('invalid_chart_data');
    if (state.displayedGeneration !== state.context.selectionGeneration || state.bars.length === 0) {
      throw new CapabilityError('data_not_ready');
    }
    if (!['ohlcv', 'probability'].includes(state.seriesKind) || state.bars.length > this.#limits.maxRows
      || !Number.isSafeInteger(state.dataRevision) || state.dataRevision < 0) {
      throw new CapabilityError('invalid_chart_data');
    }
    const rows: ChartRow[] = [];
    let previousTime = -Infinity;
    let bytes = 2;
    let amountCount = 0;
    for (let index = 0; index < state.bars.length; index += 1) {
      if (index % 256 === 0) this.#check(execution);
      const bar = state.bars[index];
      if (!bar || !Number.isSafeInteger(bar.time) || bar.time <= previousTime) {
        throw new CapabilityError('invalid_chart_data');
      }
      previousTime = bar.time;
      const row: Record<string, number> = {};
      if (state.seriesKind === 'probability') {
        if (!Number.isFinite(bar.close) || bar.close < 0 || bar.close > 100) {
          throw new CapabilityError('invalid_chart_data');
        }
        // Synthetic rendering bars must not masquerade as traded OHLCV/zero volume.
        row.time = bar.time;
        row.value = bar.close;
      } else {
        for (const key of barKeys) {
          if (!Number.isFinite(bar[key])) throw new CapabilityError('invalid_chart_data');
          row[key] = bar[key];
        }
        if (bar.high < Math.max(bar.open, bar.close, bar.low)
          || bar.low > Math.min(bar.open, bar.close) || bar.volume < 0) {
          throw new CapabilityError('invalid_chart_data');
        }
        if (bar.amount !== undefined) {
          if (!Number.isFinite(bar.amount) || bar.amount < 0) throw new CapabilityError('invalid_chart_data');
          row.amount = bar.amount;
          amountCount += 1;
        }
      }
      bytes += encoder.encode(JSON.stringify(row)).byteLength + 1;
      if (bytes > this.#limits.maxSnapshotBytes || this.#bytes + bytes > this.#limits.maxStoredBytes) {
        throw new CapabilityError('snapshot_capacity');
      }
      rows.push(Object.freeze(row));
    }
    if (this.#sequence >= Number.MAX_SAFE_INTEGER) throw new CapabilityError('snapshot_capacity');
    const id = `chart-snapshot-${++this.#sequence}`;
    let descriptor: { readonly [key: string]: JsonValue };
    let descriptorBytes: number;
    try {
      const encoded = snapshotJson({
        snapshotId: id, context: execution.context, seriesKind: state.seriesKind,
        capturedAtMs: this.#wallNow(), dataRevision: state.dataRevision, rowCount: rows.length,
        fromTime: rows[0].time, toTime: rows.at(-1)!.time,
        fields: state.seriesKind === 'probability' ? ['time', 'value']
          : [...barKeys, ...(amountCount ? ['amount'] : [])],
        metadata: {
          timeUnit: 'unix-seconds', timeZone: state.timeZone, displayTimeZone: state.displayTimeZone,
          barTimeMeaning: 'provider-defined', priceUnit: state.seriesKind === 'probability' ? 'percent' : 'provider-native',
          volumeUnit: state.seriesKind === 'probability' ? 'not-applicable' : 'unknown',
          amountUnit: state.seriesKind === 'probability' ? 'not-applicable' : 'unknown',
          finality: 'unknown', coverage: 'retained-chart-window', gapAssessment: 'not-assessed',
          amountCoverage: amountCount === 0 ? 'none' : amountCount === rows.length ? 'all' : 'partial',
          ...(state.baseAsset ? { baseAsset: state.baseAsset } : {}),
          ...(state.quoteAsset ? { quoteAsset: state.quoteAsset } : {}),
        },
      }, 16 * 1024);
      validateValue(encoded.value, snapshotDescriptorSchema);
      descriptor = encoded.value as typeof descriptor;
      descriptorBytes = encoded.bytes;
    } catch {
      throw new CapabilityError('invalid_chart_data');
    }
    bytes += descriptorBytes;
    this.#check(execution);
    if (bytes > this.#limits.maxSnapshotBytes || this.#bytes + bytes > this.#limits.maxStoredBytes) {
      throw new CapabilityError('snapshot_capacity');
    }
    const value: ChartSnapshot = Object.freeze({
      descriptor, context: descriptor.context as unknown as SelectionRef,
      seriesKind: state.seriesKind, rows: Object.freeze(rows),
    });
    if (!this.#revokeListeners.has(execution.session)) {
      const owner = execution.session;
      const listener = () => this.#releaseOwner(owner);
      this.#revokeListeners.set(owner, listener);
      owner.signal.addEventListener('abort', listener, { once: true });
    }
    const taskSignal = execution.signal;
    const onTaskAbort = () => this.#remove(id);
    this.#entries.set(id, {
      value, bytes, owner: execution.session, expiresAt: this.#now() + this.#limits.ttlMs,
      taskSignal, onTaskAbort,
    });
    this.#bytes += bytes;
    // Capture can finish one microtask before the core delivers/validates its reply.
    taskSignal.addEventListener('abort', onTaskAbort, { once: true });
    return value;
  }

  get(id: string, execution: ToolExecutionContext): ChartSnapshot {
    this.#check(execution);
    this.#prune();
    const entry = this.#entries.get(id);
    // IDs are not credentials. Two sessions on the same chart still have different owners.
    if (!entry || entry.owner !== execution.session || !sameSelection(entry.value.context, requireChartSelection(execution.context))) {
      throw new CapabilityError('snapshot_unavailable');
    }
    return entry.value;
  }

  getForCompute(id: string, execution: ToolExecutionContext): ChartSnapshot {
    this.#check(execution);
    this.#prune();
    const entry = this.#entries.get(id);
    const owner = entry?.owner.sessionIdentity ?? entry?.owner;
    const requester = execution.session.sessionIdentity ?? execution.session;
    if (!entry || owner !== requester || entry.value.context.appInstanceId !== execution.context.appInstanceId) {
      throw new CapabilityError('snapshot_unavailable');
    }
    return entry.value;
  }

  release(id: string, execution: ToolExecutionContext): void {
    this.get(id, execution);
    this.#remove(id);
  }

  get retainedSnapshots(): number { this.#prune(); return this.#entries.size; }
  get retainedBytes(): number { this.#prune(); return this.#bytes; }

  #check(execution: ToolExecutionContext): void {
    execution.checkpoint();
    if (execution.session.signal.aborted) throw new CapabilityError('session_closed');
    if (execution.signal.aborted) throw new CapabilityError('cancelled');
  }

  #prune(): void {
    const now = this.#now();
    for (const [id, entry] of this.#entries) {
      if (now >= entry.expiresAt || entry.owner.signal.aborted) this.#remove(id);
    }
  }

  #remove(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#entries.delete(id);
    this.#bytes -= entry.bytes;
    entry.taskSignal.removeEventListener('abort', entry.onTaskAbort);
    if (![...this.#entries.values()].some(item => item.owner === entry.owner)) {
      const listener = this.#revokeListeners.get(entry.owner);
      if (listener) entry.owner.signal.removeEventListener('abort', listener);
      this.#revokeListeners.delete(entry.owner);
    }
  }

  #releaseOwner(owner: ToolSessionScope): void {
    for (const [id, entry] of this.#entries) if (entry.owner === owner) this.#remove(id);
  }
}
