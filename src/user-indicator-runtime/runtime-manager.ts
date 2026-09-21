import type {
  IndicatorBar,
  IndicatorDataRequest,
  IndicatorDataSnapshot,
  IndicatorDataEvent,
  IndicatorDepthSnapshot,
  IndicatorInputDefinition,
  IndicatorInstrumentMetadata,
  IndicatorMarketStatus,
  IndicatorTradeBatch,
  IndicatorTheme,
  MarketSymbolKind,
  Resolution,
} from '../indicator-sdk/contracts.ts';
import {
  userIndicatorDepthPayload,
  userIndicatorTradesPayload,
  type UserIndicatorDataEvent,
} from './data-protocol.ts';
import type { UserIndicatorPointerEvent } from './supervisor-protocol.ts';
import type { UserIndicatorLibraryRecord } from './library.ts';
import type { UserIndicatorRuntimeController } from './controller.ts';

export type UserIndicatorRuntimeHostContext = Readonly<{
  instrument: IndicatorInstrumentMetadata;
  selection: Readonly<{
    symbol: string;
    resolution: Resolution;
    adjustment: 'none' | 'qfq';
    seriesKind: 'ohlcv';
    marketKind: MarketSymbolKind;
    providerId: string;
  }>;
  theme: IndicatorTheme;
}>;

export type UserIndicatorDataAlign = 'none' | 'main' | 'main-ffill';

export type UserIndicatorDataUnavailableReason =
  | 'provider_mismatch'
  | 'symbol_unavailable'
  | 'kind_mismatch'
  | 'unsupported_resolution'
  | 'unsupported_adjustment'
  | 'series_kind_unavailable'
  | 'history_unavailable';

export type UserIndicatorDataStatus = Readonly<
  | { state: 'ready' }
  | { state: 'unavailable'; reason: UserIndicatorDataUnavailableReason }
>;

export class UserIndicatorDataUnavailableError extends Error {
  readonly reason: UserIndicatorDataUnavailableReason;
  constructor(reason: UserIndicatorDataUnavailableReason) {
    super(reason);
    this.name = 'UserIndicatorDataUnavailableError';
    this.reason = reason;
  }
}

export type UserIndicatorDataRequest = Readonly<IndicatorDataRequest & {
  symbol?: string;
  kind?: Exclude<MarketSymbolKind, 'prediction'>;
  align?: UserIndicatorDataAlign;
}>;

export type UserIndicatorHistoryWindow = Readonly<{
  bars: readonly IndicatorBar[];
  symbol: string;
  kind: Exclude<MarketSymbolKind, 'prediction'>;
  coverage?: string;
  finality?: string;
  priceUnit?: string;
  volumeUnit?: string;
}>;

type UserIndicatorDataSnapshot = Readonly<Omit<IndicatorDataSnapshot, 'bars'> & {
  symbol: string;
  kind: Exclude<MarketSymbolKind, 'prediction'>;
  aligned: UserIndicatorDataAlign;
  requestedCount: number;
  rowCount: number;
  shortfall: boolean;
  coverage: string;
  finality: string;
  priceUnit: string;
  volumeUnit: string;
  bars: readonly (IndicatorBar | null)[];
}>;

export type UserIndicatorRuntimeInstanceConfig = Readonly<{
  instanceId: string;
  indicatorId: string;
  sourceHash: string;
  indicatorVersion: number;
  inputs?: Readonly<Record<string, unknown>>;
  visible?: boolean;
}>;

export type UserIndicatorRuntimeManagerOptions = Readonly<{
  history?: (
    context: UserIndicatorRuntimeHostContext,
    request: UserIndicatorDataRequest,
  ) => Promise<readonly IndicatorBar[] | UserIndicatorHistoryWindow>;
  now?: () => number;
}>;

export type UserIndicatorRuntimeManagerController = Pick<
  UserIndicatorRuntimeController,
  'create' | 'rebuild' | 'update' | 'pointer' | 'retry' | 'setVisible' | 'remove' | 'destroy' | 'list'
>;

type RuntimeRecord = {
  readonly instanceId: string;
  readonly library: UserIndicatorLibraryRecord;
  inputs: Readonly<Record<string, unknown>>;
  visible: boolean;
  failed: boolean;
  dataSignature: string | null;
  dataSnapshots: ReadonlyMap<string, UserIndicatorDataSnapshot>;
  dataRawWindows: ReadonlyMap<string, UserIndicatorHistoryWindow>;
  dataMissingKeys: ReadonlySet<string>;
  dataStatuses: ReadonlyMap<string, UserIndicatorDataStatus>;
  dataAlignmentSignature: string | null;
  dataLoadGeneration: number;
  dataLoadingSignature: string | null;
  dataLastRefreshAt: number;
};

function validInput(definition: IndicatorInputDefinition, value: unknown): boolean {
  switch (definition.type) {
    case 'number':
      return typeof value === 'number'
        && Number.isFinite(value)
        && (definition.min === undefined || value >= definition.min)
        && (definition.max === undefined || value <= definition.max);
    case 'boolean': return typeof value === 'boolean';
    case 'color': return typeof value === 'string' && value.length > 0;
    case 'text':
      return typeof value === 'string'
        && (definition.maxLength === undefined || value.length <= definition.maxLength);
    case 'select':
      return typeof value === 'string' && definition.options.some((option) => option.value === value);
  }
}

export function normalizeUserIndicatorInputs(
  library: UserIndicatorLibraryRecord,
  saved: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const normalized: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, definition] of Object.entries(library.manifest.inputs)) {
    const candidate = saved[key];
    normalized[key] = validInput(definition, candidate) ? candidate : definition.default;
  }
  return Object.freeze(normalized);
}

function applicable(library: UserIndicatorLibraryRecord, context: UserIndicatorRuntimeHostContext | null): boolean {
  if (!context || context.selection.seriesKind !== 'ohlcv' || context.selection.marketKind === 'prediction') return false;
  const marketKinds = library.manifest.supports.marketKinds;
  return !marketKinds || marketKinds.includes(context.selection.marketKind as Exclude<MarketSymbolKind, 'prediction'>);
}

function normalizeHistoryWindow(
  value: readonly IndicatorBar[] | UserIndicatorHistoryWindow,
  context: UserIndicatorRuntimeHostContext,
  request: UserIndicatorDataRequest,
): UserIndicatorHistoryWindow {
  if (!Array.isArray(value)) return value as UserIndicatorHistoryWindow;
  return Object.freeze({
    bars: value,
    symbol: request.symbol ?? context.selection.symbol,
    kind: request.kind ?? context.selection.marketKind as Exclude<MarketSymbolKind, 'prediction'>,
    coverage: 'provider-returned-window',
    finality: 'unknown',
    priceUnit: 'provider-native',
    volumeUnit: 'unknown',
  });
}

export function alignUserIndicatorDataBars(
  rawBars: readonly IndicatorBar[],
  mainBars: readonly IndicatorBar[],
  align: UserIndicatorDataAlign,
): readonly (IndicatorBar | null)[] {
  if (align === 'none') return Object.freeze(rawBars.map((bar) => Object.freeze({ ...bar })));
  if (align === 'main') {
    const byTime = new Map(rawBars.map((bar) => [bar.time, bar] as const));
    return Object.freeze(mainBars.map((main) => {
      const bar = byTime.get(main.time);
      return bar ? Object.freeze({ ...bar, time: main.time }) : null;
    }));
  }
  const aligned: Array<IndicatorBar | null> = [];
  let cursor = 0;
  let latest: IndicatorBar | undefined;
  for (const main of mainBars) {
    while (cursor < rawBars.length && rawBars[cursor].time <= main.time) {
      latest = rawBars[cursor];
      cursor += 1;
    }
    aligned.push(latest ? Object.freeze({ ...latest, time: main.time }) : null);
  }
  return Object.freeze(aligned);
}

function mainTimelineSignature(bars: readonly IndicatorBar[]): string {
  if (!bars.length) return '0';
  return `${bars.length}:${bars[0].time}:${bars[bars.length - 1].time}`;
}

function instanceContext(
  instanceId: string,
  context: UserIndicatorRuntimeHostContext,
  snapshots: ReadonlyMap<string, UserIndicatorDataSnapshot>,
  statuses: ReadonlyMap<string, UserIndicatorDataStatus>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    instanceId,
    instrument: context.instrument,
    selection: context.selection,
    theme: context.theme,
    data: Object.freeze(Object.fromEntries(snapshots)),
    dataStatus: Object.freeze(Object.fromEntries(statuses)),
  });
}

export class UserIndicatorRuntimeManager {
  private readonly controller: UserIndicatorRuntimeManagerController;
  private readonly options: UserIndicatorRuntimeManagerOptions;
  private readonly records = new Map<string, RuntimeRecord>();
  private context: UserIndicatorRuntimeHostContext | null = null;
  private latestEvent: IndicatorDataEvent | null = null;

  constructor(controller: UserIndicatorRuntimeManagerController, options: UserIndicatorRuntimeManagerOptions = {}) {
    this.controller = controller;
    this.options = options;
  }

  add(config: UserIndicatorRuntimeInstanceConfig, library: UserIndicatorLibraryRecord): void {
    if (!config.instanceId.trim()) throw new Error('user indicator instanceId must be non-empty');
    if (this.records.has(config.instanceId)) throw new Error(`user indicator instance ${config.instanceId} already exists`);
    if (config.indicatorId !== library.id
      || config.sourceHash !== library.sourceHash
      || config.indicatorVersion !== library.indicatorVersion) {
      throw new Error('user indicator instance does not match the imported library record');
    }
    const record: RuntimeRecord = {
      instanceId: config.instanceId,
      library,
      inputs: normalizeUserIndicatorInputs(library, config.inputs),
      visible: config.visible ?? true,
      failed: false,
      dataSignature: null,
      dataSnapshots: new Map(),
      dataRawWindows: new Map(),
      dataMissingKeys: new Set(),
      dataStatuses: new Map(),
      dataAlignmentSignature: null,
      dataLoadGeneration: 0,
      dataLoadingSignature: null,
      dataLastRefreshAt: 0,
    };
    this.records.set(config.instanceId, record);
    try {
      this.startIfApplicable(record, false);
    } catch (error) {
      try { this.controller.remove(config.instanceId); }
      finally { this.records.delete(config.instanceId); }
      throw error;
    }
  }

  updateInputs(instanceId: string, inputs: Readonly<Record<string, unknown>>): void {
    const record = this.require(instanceId);
    record.inputs = normalizeUserIndicatorInputs(record.library, inputs);
    this.runIsolated(record, () => this.startIfApplicable(record, true));
  }

  setVisible(instanceId: string, visible: boolean): void {
    const record = this.require(instanceId);
    record.visible = visible;
    this.controller.setVisible(instanceId, visible);
  }

  retry(instanceId: string): void {
    const record = this.require(instanceId);
    if (!this.latestEvent || !applicable(record.library, this.context)) return;
    if (record.failed) {
      this.runIsolated(record, () => this.startIfApplicable(record, true));
      return;
    }
    const execution = this.controller.list().find((item) => item.instanceId === instanceId);
    if (!execution?.failed) return;
    this.runIsolated(record, () => {
      this.controller.retry(instanceId, this.latestEvent!);
      this.controller.setVisible(instanceId, record.visible);
    });
  }

  remove(instanceId: string): void {
    if (!this.records.has(instanceId)) return;
    this.controller.remove(instanceId);
    this.records.delete(instanceId);
  }

  setContext(context: UserIndicatorRuntimeHostContext, event: IndicatorDataEvent): void {
    this.context = context;
    this.latestEvent = event;
    for (const record of this.records.values()) {
      record.dataLoadGeneration += 1;
      record.dataLoadingSignature = null;
      this.runIsolated(record, () => this.startIfApplicable(record, true));
    }
  }

  setTheme(theme: IndicatorTheme): void {
    if (!this.context || !this.latestEvent || this.context.theme === theme) return;
    this.context = Object.freeze({ ...this.context, theme });
    for (const record of this.records.values()) this.runIsolated(record, () => this.startIfApplicable(record, true));
  }

  update(event: IndicatorDataEvent): void {
    this.latestEvent = event;
    for (const record of this.records.values()) {
      if (record.failed || !applicable(record.library, this.context)) continue;
      this.runIsolated(record, () => {
        const running = this.controller.list().some((item) => item.instanceId === record.instanceId);
        const context = this.context;
        const hasAlignedData = this.dataRequests(record).some((request) => (request.align ?? 'none') !== 'none');
        const timelineChanged = hasAlignedData
          && record.dataRawWindows.size > 0
          && record.dataAlignmentSignature !== mainTimelineSignature(event.bars);
        if (running && context && timelineChanged) {
          this.materializeDataSnapshots(record, context, event);
          this.controller.rebuild(
            record.instanceId,
            record.library.source,
            record.inputs,
            instanceContext(record.instanceId, context, record.dataSnapshots, record.dataStatuses),
            event,
          );
          this.controller.setVisible(record.instanceId, record.visible);
        } else if (running) {
          this.controller.update(record.instanceId, event);
        } else {
          this.startIfApplicable(record, false);
        }
      });
      this.refreshDataIfNeeded(record, event);
    }
  }

  pushDepth(depth: Readonly<IndicatorDepthSnapshot>): void {
    const latest = this.latestEvent;
    if (!latest || latest.reason === 'initial' && latest.bars.length === 0) return;
    const payload = userIndicatorDepthPayload(depth);
    for (const record of this.records.values()) {
      if (record.failed || !applicable(record.library, this.context) || record.library.manifest.supports.requires?.depth !== true) continue;
      if (!this.controller.list().some(item => item.instanceId === record.instanceId)) continue;
      const event: UserIndicatorDataEvent = Object.freeze({
        reason: 'realtime',
        bars: latest.bars,
        changedFrom: latest.bars.length,
        depth: payload,
      });
      this.runIsolated(record, () => this.controller.update(record.instanceId, event));
    }
  }

  pushTrades(batch: Readonly<IndicatorTradeBatch>): void {
    const latest = this.latestEvent;
    if (!latest || latest.bars.length === 0) return;
    for (const record of this.records.values()) {
      const requestedKinds = record.library.manifest.supports.requires?.trades;
      if (record.failed || !applicable(record.library, this.context) || !requestedKinds?.length) continue;
      if (!this.controller.list().some(item => item.instanceId === record.instanceId)) continue;
      const filtered = Object.freeze({
        ...batch,
        events: Object.freeze(batch.events.filter(event => requestedKinds.includes(event.eventKind))),
      });
      if (filtered.events.length === 0 && batch.resetReason === undefined && batch.droppedSinceSubscriptionStart === 0) continue;
      const event: UserIndicatorDataEvent = Object.freeze({
        reason: 'realtime',
        bars: latest.bars,
        changedFrom: latest.bars.length,
        trades: userIndicatorTradesPayload(filtered),
      });
      this.runIsolated(record, () => this.controller.update(record.instanceId, event));
    }
  }

  pushMarketStatus(status: Readonly<IndicatorMarketStatus>): void {
    const latest = this.latestEvent;
    if (!latest || latest.bars.length === 0) return;
    const snapshot = Object.freeze({ ...status });
    for (const record of this.records.values()) {
      const requires = record.library.manifest.supports.requires;
      if (record.failed || !applicable(record.library, this.context)
        || (requires?.depth !== true && !(requires?.trades?.length))) continue;
      if (!this.controller.list().some(item => item.instanceId === record.instanceId)) continue;
      const event: UserIndicatorDataEvent = Object.freeze({
        reason: 'realtime',
        bars: latest.bars,
        changedFrom: latest.bars.length,
        marketStatus: snapshot,
      });
      this.runIsolated(record, () => this.controller.update(record.instanceId, event));
    }
  }

  pointer(instanceId: string, event: UserIndicatorPointerEvent): void {
    const record = this.records.get(instanceId);
    if (!record || record.failed || !applicable(record.library, this.context)) return;
    if (!this.controller.list().some(item => item.instanceId === instanceId && item.ready && !item.failed)) return;
    this.runIsolated(record, () => this.controller.pointer(instanceId, event));
  }

  isApplicable(indicatorId: string): boolean {
    const record = [...this.records.values()].find((item) => item.library.id === indicatorId);
    return record ? applicable(record.library, this.context) : false;
  }

  isLibraryRecordApplicable(library: UserIndicatorLibraryRecord): boolean {
    return applicable(library, this.context);
  }

  get(instanceId: string): Readonly<{
    instanceId: string;
    indicatorId: string;
    sourceHash: string;
    indicatorVersion: number;
    inputs: Readonly<Record<string, unknown>>;
    visible: boolean;
    running: boolean;
    failed: boolean;
    applicable: boolean;
  }> | null {
    const record = this.records.get(instanceId);
    if (!record) return null;
    const execution = this.controller.list().find((item) => item.instanceId === instanceId);
    return Object.freeze({
      instanceId,
      indicatorId: record.library.id,
      sourceHash: record.library.sourceHash,
      indicatorVersion: record.library.indicatorVersion,
      inputs: record.inputs,
      visible: record.visible,
      running: execution?.running ?? false,
      failed: record.failed || (execution?.failed ?? false),
      applicable: applicable(record.library, this.context),
    });
  }

  list(): readonly NonNullable<ReturnType<UserIndicatorRuntimeManager['get']>>[] {
    return [...this.records.keys()].flatMap((instanceId) => {
      const value = this.get(instanceId);
      return value ? [value] : [];
    });
  }

  destroy(): void {
    this.controller.destroy();
    this.records.clear();
    this.context = null;
    this.latestEvent = null;
  }

  private require(instanceId: string): RuntimeRecord {
    const record = this.records.get(instanceId);
    if (!record) throw new Error(`user indicator instance ${instanceId} does not exist`);
    return record;
  }

  private runIsolated(record: RuntimeRecord, action: () => void): void {
    try { action(); }
    catch {
      record.failed = true;
      try { this.controller.remove(record.instanceId); }
      catch { console.error('user_indicator.cleanup_failed', { instanceId: record.instanceId }); }
      // Keep the user's settings for explicit retry, but do not retry on ticks.
    }
  }

  private dataRequests(record: RuntimeRecord): readonly UserIndicatorDataRequest[] {
    const data = record.library.manifest.data;
    if (!data) return [];
    return Object.freeze(Object.entries(data).map(([key, request]) => Object.freeze({
      key,
      resolution: request.resolution,
      count: request.count ?? (request.resolution === '1D' ? 12_000 : 8_000),
      adjustment: request.adjustment ?? 'current',
      ...(request.symbol === undefined ? {} : { symbol: request.symbol }),
      ...(request.kind === undefined ? {} : { kind: request.kind }),
      align: request.align ?? 'none',
    })));
  }

  private dataSignature(record: RuntimeRecord, context: UserIndicatorRuntimeHostContext): string {
    return JSON.stringify({
      providerId: context.selection.providerId,
      symbol: context.selection.symbol,
      adjustment: context.selection.adjustment,
      requests: this.dataRequests(record),
    });
  }

  private materializeDataSnapshots(
    record: RuntimeRecord,
    context: UserIndicatorRuntimeHostContext,
    event: IndicatorDataEvent,
  ): void {
    const snapshots = new Map<string, UserIndicatorDataSnapshot>();
    const statuses = new Map(record.dataStatuses);
    for (const request of this.dataRequests(record)) {
      const raw = record.dataRawWindows.get(request.key);
      if (!raw) continue;
      const adjustment = request.adjustment === undefined || request.adjustment === 'current'
        ? context.selection.adjustment
        : request.adjustment;
      const align = request.align ?? 'none';
      const requestedCount = request.count ?? (request.resolution === '1D' ? 12_000 : 8_000);
      snapshots.set(request.key, Object.freeze({
        key: request.key,
        symbol: raw.symbol,
        kind: raw.kind,
        resolution: request.resolution,
        adjustment,
        aligned: align,
        requestedCount,
        rowCount: raw.bars.length,
        shortfall: raw.bars.length < requestedCount,
        coverage: raw.coverage ?? 'provider-returned-window',
        finality: raw.finality ?? 'unknown',
        priceUnit: raw.priceUnit ?? 'provider-native',
        volumeUnit: raw.volumeUnit ?? 'unknown',
        bars: alignUserIndicatorDataBars(raw.bars, event.bars, align),
        capturedAtMs: this.options.now?.() ?? Date.now(),
      }));
      statuses.set(request.key, Object.freeze({ state: 'ready' }));
    }
    record.dataSnapshots = snapshots;
    record.dataStatuses = statuses;
    record.dataAlignmentSignature = mainTimelineSignature(event.bars);
  }

  private startDataLoad(
    record: RuntimeRecord,
    context: UserIndicatorRuntimeHostContext,
    signature: string,
  ): void {
    if (!this.options.history || record.dataLoadingSignature === signature) return;
    const requests = this.dataRequests(record);
    if (!requests.length) return;
    const generation = ++record.dataLoadGeneration;
    record.dataLoadingSignature = signature;
    Promise.all(requests.map(async (request) => {
      const adjustment = request.adjustment === undefined || request.adjustment === 'current'
        ? context.selection.adjustment
        : request.adjustment;
      try {
        const result = await this.options.history!(context, Object.freeze({ ...request, adjustment }));
        const window = normalizeHistoryWindow(result, context, request);
        return Object.freeze({ key: request.key, window: Object.freeze({
          ...window,
          bars: Object.freeze(window.bars.map((bar) => Object.freeze({ ...bar }))),
        }) });
      } catch (error) {
        if (request.symbol !== undefined) {
          const reason = error instanceof UserIndicatorDataUnavailableError ? error.reason : 'history_unavailable';
          return Object.freeze({
            key: request.key,
            missing: Object.freeze({ state: 'unavailable' as const, reason }),
          });
        }
        throw error;
      }
    })).then((results) => {
      if (this.records.get(record.instanceId) !== record || record.dataLoadGeneration !== generation) return;
      record.dataRawWindows = new Map(results.flatMap((result) => 'window' in result ? [[result.key, result.window] as const] : []));
      record.dataMissingKeys = new Set(results.flatMap((result) => 'missing' in result ? [result.key] : []));
      record.dataStatuses = new Map(results.map((result) => [
        result.key,
        'window' in result
          ? Object.freeze({ state: 'ready' as const })
          : result.missing,
      ] as const));
      const event = this.latestEvent;
      if (!event) return;
      this.materializeDataSnapshots(record, context, event);
      record.dataSignature = signature;
      record.dataLoadingSignature = null;
      record.dataLastRefreshAt = this.options.now?.() ?? Date.now();
      this.runIsolated(record, () => this.startIfApplicable(record, true));
    }).catch(() => {
      if (this.records.get(record.instanceId) !== record || record.dataLoadGeneration !== generation) return;
      record.dataLoadingSignature = null;
      record.failed = true;
      try { this.controller.remove(record.instanceId); } catch {}
    });
  }

  private refreshDataIfNeeded(record: RuntimeRecord, event: IndicatorDataEvent): void {
    const context = this.context;
    if (!context || !this.options.history || !record.library.manifest.data || record.failed) return;
    if (event.reason !== 'realtime' && event.reason !== 'reconciliation') return;
    const now = this.options.now?.() ?? Date.now();
    if (now - record.dataLastRefreshAt < 15_000) return;
    const signature = this.dataSignature(record, context);
    if (record.dataSignature !== signature || record.dataLoadingSignature === signature) return;
    this.startDataLoad(record, context, signature);
  }

  private startIfApplicable(record: RuntimeRecord, rebuild: boolean): void {
    record.failed = false;
    const context = this.context;
    const event = this.latestEvent;
    const execution = this.controller.list().find((item) => item.instanceId === record.instanceId);
    if (!context || !event || !applicable(record.library, context)) {
      if (execution) this.controller.remove(record.instanceId);
      return;
    }
    const requests = this.dataRequests(record);
    if (requests.length) {
      if (!this.options.history) {
        record.failed = true;
        if (execution) this.controller.remove(record.instanceId);
        return;
      }
      const signature = this.dataSignature(record, context);
      const ready = record.dataSignature === signature
        && requests.every((request) => record.dataSnapshots.has(request.key) || record.dataMissingKeys.has(request.key));
      if (!ready) {
        if (execution) this.controller.remove(record.instanceId);
        this.startDataLoad(record, context, signature);
        return;
      }
    } else {
      record.dataSnapshots = new Map();
      record.dataRawWindows = new Map();
      record.dataMissingKeys = new Set();
      record.dataStatuses = new Map();
      record.dataAlignmentSignature = null;
      record.dataSignature = this.dataSignature(record, context);
      record.dataLoadingSignature = null;
    }
    const runtimeContext = instanceContext(record.instanceId, context, record.dataSnapshots, record.dataStatuses);
    if (execution && rebuild) {
      this.controller.rebuild(
        record.instanceId,
        record.library.source,
        record.inputs,
        runtimeContext,
        event,
      );
    } else if (!execution) {
      this.controller.create(
        record.instanceId,
        record.library.source,
        record.inputs,
        runtimeContext,
        event,
      );
    }
    this.controller.setVisible(record.instanceId, record.visible);
  }
}
