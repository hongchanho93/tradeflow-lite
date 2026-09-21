import type {
  IndicatorBar,
  IndicatorContext,
  IndicatorDataApi,
  IndicatorDataEvent,
  IndicatorDataRequest,
  IndicatorDataSnapshot,
  IndicatorDefinition,
  IndicatorEventApi,
  IndicatorInputDefinition,
  IndicatorInputSchema,
  IndicatorInstance,
  IndicatorMainSeriesApi,
  IndicatorMarketData,
  IndicatorTheme,
  InferIndicatorInputs,
} from './contracts';
import { IndicatorChartHost } from './chart-host.ts';
import { IndicatorExecutionScope } from './execution-scope.ts';
import { IndicatorRegistry } from './registry.ts';

export type IndicatorSelection = IndicatorContext['selection'];

export type IndicatorInstanceConfig = {
  readonly instanceId: string;
  readonly indicatorId: string;
  readonly indicatorVersion?: number;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly visible?: boolean;
};

export type IndicatorRuntimeError = {
  readonly instanceId: string;
  readonly indicatorId: string;
  readonly phase: 'create' | 'data' | 'update' | 'market' | 'event' | 'resource' | 'render' | 'visibility' | 'theme' | 'destroy' | 'cleanup';
  readonly error: unknown;
};

type RuntimeRecord = {
  config: IndicatorInstanceConfig;
  definition: IndicatorDefinition;
  inputs: Readonly<Record<string, unknown>>;
  execution: IndicatorInstance | null;
  scope: IndicatorExecutionScope | null;
  failed: boolean;
  dataSignature: string | null;
  dataSnapshots: ReadonlyMap<string, Readonly<IndicatorDataSnapshot>>;
  dataLoadGeneration: number;
  dataLoadingSignature: string | null;
  dataLastRefreshAt: number;
};

export type IndicatorRuntimeServices = {
  readonly chartHost: IndicatorChartHost;
  readonly mainSeries: IndicatorMainSeriesApi | ((instanceId: string) => IndicatorMainSeriesApi);
  readonly mainSeriesLifecycle?: {
    finishBinding(instanceId: string): void;
    abortBinding(instanceId: string): void;
    clear(instanceId: string): void;
    setVisible(instanceId: string, visible: boolean): void;
    remove(instanceId: string): void;
  };
  readonly market: IndicatorMarketData;
  readonly marketFor?: (definition: IndicatorDefinition) => IndicatorMarketData;
  readonly history?: (
    selection: IndicatorSelection,
    request: IndicatorDataRequest,
  ) => Promise<readonly IndicatorBar[]>;
  readonly events: IndicatorEventApi;
  readonly theme: () => IndicatorTheme;
  readonly now?: () => number;
  readonly onError?: (failure: IndicatorRuntimeError) => void;
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

export function normalizeIndicatorInputs<S extends IndicatorInputSchema>(
  definition: IndicatorDefinition<S>,
  saved: Readonly<Record<string, unknown>> = {},
  savedIndicatorVersion = definition.indicatorVersion,
): Readonly<InferIndicatorInputs<S>> {
  const migrated = savedIndicatorVersion < definition.indicatorVersion && definition.migrateInputs
    ? definition.migrateInputs(saved, savedIndicatorVersion)
    : saved;
  const normalized: Record<string, unknown> = {};
  for (const [key, input] of Object.entries(definition.inputs)) {
    const candidate = migrated[key];
    normalized[key] = validInput(input, candidate) ? candidate : input.default;
  }
  return Object.freeze(normalized) as InferIndicatorInputs<S>;
}

function applicable(definition: IndicatorDefinition, selection: IndicatorSelection, market: IndicatorMarketData): boolean {
  if (selection.seriesKind !== 'ohlcv' || selection.marketKind === 'prediction') return false;
  if (definition.supports.marketKinds && !definition.supports.marketKinds.includes(selection.marketKind)) return false;
  const requirements = definition.supports.requires;
  if (!requirements) return true;
  const capabilities = market.capabilities();
  if (requirements.depth && !capabilities.depth.supported) return false;
  if (requirements.trades && !requirements.trades.some((kind) => capabilities.trades.eventKinds.includes(kind))) {
    return false;
  }
  return true;
}

export function indicatorInstrumentMetadata(selection: IndicatorSelection): IndicatorContext['instrument'] {
  const { symbol, marketKind } = selection;
  if (marketKind === 'crypto' || marketKind === 'prediction') {
    return Object.freeze({ priceTick: null, timeZone: 'UTC', tradingCalendar: '24/7' });
  }
  const venue = (symbol.venue || symbol.exchange).toUpperCase();
  const tradingCalendar = venue.includes('BJ')
    ? 'XBSE'
    : venue.includes('SZ')
      ? 'XSHE'
      : venue.includes('SH')
        ? 'XSHG'
        : null;
  const priceTick = marketKind === 'etf' ? 0.001 : 0.01;
  return Object.freeze({ priceTick, timeZone: 'Asia/Shanghai', tradingCalendar });
}

export class IndicatorRuntime {
  private readonly records = new Map<string, RuntimeRecord>();
  private selection: IndicatorSelection | null = null;
  private latestEvent: Readonly<IndicatorDataEvent> | null = null;
  private readonly registry: IndicatorRegistry;
  private readonly services: IndicatorRuntimeServices;

  constructor(
    registry: IndicatorRegistry,
    services: IndicatorRuntimeServices,
  ) {
    if (typeof services.mainSeries === 'function' && !services.mainSeriesLifecycle) {
      throw new Error('functional mainSeries service requires mainSeriesLifecycle cleanup hooks');
    }
    this.registry = registry;
    this.services = services;
    this.services.chartHost.setCanvasErrorHandler((instanceId, _key, error) => {
      const record = this.records.get(instanceId);
      if (record?.execution && !record.failed) this.fail(record, 'render', error);
    });
  }

  setContext(selection: IndicatorSelection, initialEvent: Readonly<IndicatorDataEvent>): void {
    this.selection = Object.freeze({ ...selection });
    this.latestEvent = initialEvent;
    for (const record of this.records.values()) this.rebuild(record);
  }

  add(config: IndicatorInstanceConfig): void {
    if (!config.instanceId.trim()) throw new Error('indicator instanceId must be non-empty');
    if (this.records.has(config.instanceId)) throw new Error(`indicator instance ${config.instanceId} already exists`);
    const definition = this.registry.get(config.indicatorId);
    if (!definition) throw new Error(`indicator ${config.indicatorId} is not registered`);
    const inputs = normalizeIndicatorInputs(
      definition,
      config.inputs,
      config.indicatorVersion ?? definition.indicatorVersion,
    );
    const record: RuntimeRecord = {
      config: { ...config, visible: config.visible ?? true },
      definition,
      inputs,
      execution: null,
      scope: null,
      failed: false,
      dataSignature: null,
      dataSnapshots: new Map(),
      dataLoadGeneration: 0,
      dataLoadingSignature: null,
      dataLastRefreshAt: 0,
    };
    this.records.set(config.instanceId, record);
    this.rebuild(record);
  }

  updateInputs(instanceId: string, inputs: Readonly<Record<string, unknown>>): void {
    const record = this.require(instanceId);
    const normalized = normalizeIndicatorInputs(record.definition, inputs);
    record.config = { ...record.config, inputs, indicatorVersion: record.definition.indicatorVersion };
    record.inputs = normalized;
    this.rebuild(record);
  }

  setVisible(instanceId: string, visible: boolean): void {
    const record = this.require(instanceId);
    record.config = { ...record.config, visible };
    this.services.chartHost.setVisible(instanceId, visible);
    this.services.mainSeriesLifecycle?.setVisible(instanceId, visible);
    if (!record.execution?.onVisibilityChange) return;
    try {
      record.execution.onVisibilityChange(visible);
    } catch (error) {
      this.fail(record, 'visibility', error);
    }
  }

  update(event: Readonly<IndicatorDataEvent>): void {
    this.latestEvent = event;
    for (const record of this.records.values()) {
      if (!record.execution || record.failed) continue;
      try {
        record.execution.update(event);
      } catch (error) {
        this.fail(record, 'update', error);
        continue;
      }
      this.refreshDataIfNeeded(record, event);
    }
  }

  retry(instanceId: string): void {
    const record = this.require(instanceId);
    if (!record.failed) return;
    this.rebuild(record);
  }

  setTheme(theme: IndicatorTheme): void {
    for (const record of this.records.values()) {
      if (!record.execution?.onThemeChange || record.failed) continue;
      try {
        record.execution.onThemeChange(theme);
      } catch (error) {
        this.fail(record, 'theme', error);
      }
    }
  }

  restartForMarketData(kind: 'depth' | 'trades'): void {
    for (const record of this.records.values()) {
      const requires = record.definition.supports.requires;
      if ((kind === 'depth' && requires?.depth) || (kind === 'trades' && requires?.trades?.length)) {
        this.rebuild(record);
      }
    }
  }

  remove(instanceId: string): void {
    const record = this.records.get(instanceId);
    if (!record) return;
    this.stop(record);
    this.services.chartHost.remove(instanceId);
    this.services.mainSeriesLifecycle?.remove(instanceId);
    this.records.delete(instanceId);
  }

  destroy(): void {
    for (const instanceId of [...this.records.keys()]) this.remove(instanceId);
    this.services.chartHost.setCanvasErrorHandler(null);
  }

  list(): readonly Readonly<{
    instanceId: string;
    indicatorId: string;
    visible: boolean;
    running: boolean;
    failed: boolean;
    inputs: Readonly<Record<string, unknown>>;
  }>[] {
    return [...this.records.values()].map((record) => Object.freeze({
      instanceId: record.config.instanceId,
      indicatorId: record.config.indicatorId,
      visible: record.config.visible ?? true,
      running: record.execution !== null,
      failed: record.failed,
      inputs: record.inputs,
    }));
  }

  isApplicable(indicatorId: string): boolean {
    const definition = this.registry.get(indicatorId);
    if (!definition || !this.selection) return false;
    try {
      const market = this.services.marketFor?.(definition) ?? this.services.market;
      return applicable(definition, this.selection, market);
    } catch {
      return false;
    }
  }

  private require(instanceId: string): RuntimeRecord {
    const record = this.records.get(instanceId);
    if (!record) throw new Error(`indicator instance ${instanceId} does not exist`);
    return record;
  }

  private dataRequests(record: RuntimeRecord): readonly IndicatorDataRequest[] {
    if (!this.selection || !record.definition.dataRequests) return [];
    const raw = record.definition.dataRequests(record.inputs as never, this.selection);
    if (!Array.isArray(raw)) throw new Error('indicator dataRequests must return an array');
    const seen = new Set<string>();
    return Object.freeze(raw.map((request) => {
      if (!request || typeof request !== 'object' || typeof request.key !== 'string'
        || !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(request.key) || seen.has(request.key)) {
        throw new Error('indicator data request key is invalid or duplicated');
      }
      seen.add(request.key);
      const count = request.count ?? 8_000;
      if (!Number.isInteger(count) || count < 2 || count > 12_000) {
        throw new Error('indicator data request count must be an integer from 2 to 12000');
      }
      if (!['current', 'none', 'qfq', undefined].includes(request.adjustment)) {
        throw new Error('indicator data request adjustment is invalid');
      }
      return Object.freeze({ ...request, count });
    }));
  }

  private dataSignatureFor(requests: readonly IndicatorDataRequest[]): string {
    if (!this.selection) return '';
    return JSON.stringify({
      providerId: this.selection.providerId,
      symbol: this.selection.symbol.symbol,
      adjustment: this.selection.adjustment,
      requests: requests.map((request) => ({
        key: request.key,
        resolution: request.resolution,
        count: request.count ?? 8_000,
        adjustment: request.adjustment ?? 'current',
      })),
    });
  }

  private startDataLoad(
    record: RuntimeRecord,
    requests: readonly IndicatorDataRequest[],
    signature: string,
  ): void {
    if (!this.selection || !this.services.history || record.dataLoadingSignature === signature) return;
    const selection = this.selection;
    const generation = ++record.dataLoadGeneration;
    record.dataLoadingSignature = signature;
    Promise.all(requests.map(async (request) => {
      const adjustment = request.adjustment === undefined || request.adjustment === 'current'
        ? selection.adjustment
        : request.adjustment;
      const bars = await this.services.history!(selection, Object.freeze({ ...request, adjustment }));
      return Object.freeze<IndicatorDataSnapshot>({
        key: request.key,
        resolution: request.resolution,
        adjustment,
        bars: Object.freeze(bars.map((bar) => Object.freeze({ ...bar }))),
        capturedAtMs: this.services.now?.() ?? Date.now(),
      });
    })).then((snapshots) => {
      if (this.records.get(record.config.instanceId) !== record || record.dataLoadGeneration !== generation) return;
      record.dataSnapshots = new Map(snapshots.map((snapshot) => [snapshot.key, snapshot]));
      record.dataSignature = signature;
      record.dataLoadingSignature = null;
      record.dataLastRefreshAt = this.services.now?.() ?? Date.now();
      this.rebuild(record);
    }).catch((error) => {
      if (this.records.get(record.config.instanceId) !== record || record.dataLoadGeneration !== generation) return;
      record.dataLoadingSignature = null;
      this.fail(record, 'data', error);
    });
  }

  private refreshDataIfNeeded(record: RuntimeRecord, event: Readonly<IndicatorDataEvent>): void {
    if (!this.selection || !this.services.history || !record.definition.dataRequests || record.failed) return;
    if (event.reason !== 'realtime' && event.reason !== 'reconciliation') return;
    const now = this.services.now?.() ?? Date.now();
    if (now - record.dataLastRefreshAt < 15_000) return;
    let requests: readonly IndicatorDataRequest[];
    try { requests = this.dataRequests(record); }
    catch (error) { this.fail(record, 'data', error); return; }
    if (!requests.length) return;
    const signature = this.dataSignatureFor(requests);
    if (record.dataSignature !== signature || record.dataLoadingSignature === signature) return;
    this.startDataLoad(record, requests, signature);
  }

  private rebuild(record: RuntimeRecord): void {
    this.stop(record);
    record.dataLoadGeneration += 1;
    record.dataLoadingSignature = null;
    record.failed = false;
    if (!this.selection || !this.latestEvent) return;
    let baseMarket: IndicatorMarketData;
    try {
      baseMarket = this.services.marketFor?.(record.definition) ?? this.services.market;
      if (!applicable(record.definition, this.selection, baseMarket)) {
        this.services.chartHost.clear(record.config.instanceId);
        this.services.mainSeriesLifecycle?.clear(record.config.instanceId);
        return;
      }
    } catch (error) {
      this.fail(record, 'create', error);
      return;
    }
    let requests: readonly IndicatorDataRequest[];
    try { requests = this.dataRequests(record); }
    catch (error) { this.fail(record, 'data', error); return; }
    if (!requests.length) {
      record.dataSignature = this.dataSignatureFor(requests);
      record.dataSnapshots = new Map();
      record.dataLoadingSignature = null;
    } else {
      if (!this.services.history) {
        this.fail(record, 'data', new Error('indicator historical data service is unavailable'));
        return;
      }
      const signature = this.dataSignatureFor(requests);
      const ready = record.dataSignature === signature
        && requests.every((request) => record.dataSnapshots.has(request.key));
      if (!ready) {
        this.services.chartHost.clear(record.config.instanceId);
        this.services.mainSeriesLifecycle?.clear(record.config.instanceId);
        this.startDataLoad(record, requests, signature);
        return;
      }
    }
    const scope = new IndicatorExecutionScope(globalThis, (error) => {
      this.report(record, 'cleanup', error);
    }, (error) => {
      this.fail(record, 'resource', error);
    });
    record.scope = scope;
    let chartBindingStarted = false;
    let mainBindingStarted = false;
    let bindingFinished = false;
    try {
      chartBindingStarted = true;
      const binding = this.services.chartHost.beginBinding(record.config.instanceId);
      const own = (disposable: { dispose(): void }) => {
        scope.add(() => disposable.dispose());
        return disposable;
      };
      const guard = <T extends readonly unknown[]>(phase: 'market' | 'event', callback: (...args: T) => void) => (
        ...args: T
      ) => {
        if (scope.isDisposed() || record.failed || !record.execution) return;
        try {
          callback(...args);
        } catch (error) {
          this.fail(record, phase, error);
        }
      };
      const scopedMarket: IndicatorMarketData = {
        capabilities: () => baseMarket.capabilities(),
        status: () => baseMarket.status(),
        getDepth: () => baseMarket.getDepth(),
        onDepth: (callback) => own(baseMarket.onDepth(guard('market', callback))),
        onTrades: (callback) => own(baseMarket.onTrades(guard('market', callback))),
        onStatus: (callback) => own(baseMarket.onStatus(guard('market', callback))),
      };
      const scopedEvents: IndicatorEventApi = {
        onCrosshairMove: (callback) => own(this.services.events.onCrosshairMove(guard('event', callback))),
        onClick: (callback) => own(this.services.events.onClick(guard('event', callback))),
        onVisibleRangeChange: (callback) => own(this.services.events.onVisibleRangeChange(guard('event', callback))),
      };
      mainBindingStarted = this.services.mainSeriesLifecycle !== undefined;
      const rawMainSeries = typeof this.services.mainSeries === 'function'
        ? this.services.mainSeries(record.config.instanceId)
        : this.services.mainSeries;
      const guardedMainSeries: IndicatorMainSeriesApi = {
        createBarStyleContribution: (definition) => {
          const contribution = rawMainSeries.createBarStyleContribution(definition);
          return {
            key: contribution.key,
            setProvider: (provider) => contribution.setProvider((bar, index) => {
              if (record.failed || !record.execution) return null;
              try {
                return provider(bar, index);
              } catch (error) {
                this.fail(record, 'render', error);
                return null;
              }
            }),
            invalidateFrom: (changedFrom) => contribution.invalidateFrom(changedFrom),
          };
        },
        createMarkerContribution: (definition) => rawMainSeries.createMarkerContribution(definition),
      };
      const context: IndicatorContext = Object.freeze({
        instanceId: record.config.instanceId,
        instrument: indicatorInstrumentMetadata(this.selection),
        selection: this.selection,
        layers: binding.layers,
        panes: binding.panes,
        mainSeries: guardedMainSeries,
        data: Object.freeze<IndicatorDataApi>({
          get: (key) => record.dataSnapshots.get(key) ?? null,
        }),
        market: scopedMarket,
        events: scopedEvents,
        resources: scope.api(),
      });
      record.execution = record.definition.create(context, record.inputs as never);
      this.services.chartHost.finishBinding(record.config.instanceId);
      this.services.mainSeriesLifecycle?.finishBinding(record.config.instanceId);
      bindingFinished = true;
      this.services.chartHost.setVisible(record.config.instanceId, record.config.visible ?? true);
    } catch (error) {
      if (!bindingFinished) {
        if (chartBindingStarted) {
          try {
            this.services.chartHost.abortBinding(record.config.instanceId);
          } catch (cleanupError) {
            this.report(record, 'cleanup', cleanupError);
          }
        }
        if (mainBindingStarted) {
          try {
            this.services.mainSeriesLifecycle?.abortBinding(record.config.instanceId);
          } catch (cleanupError) {
            this.report(record, 'cleanup', cleanupError);
          }
        }
      }
      this.fail(record, 'create', error);
      return;
    }
    try {
      record.execution?.update(Object.freeze({
        ...this.latestEvent,
        reason: 'initial',
        changedFrom: 0,
      }));
    } catch (error) {
      this.fail(record, 'update', error);
      return;
    }
    try {
      record.execution?.onThemeChange?.(this.services.theme());
    } catch (error) {
      this.fail(record, 'theme', error);
      return;
    }
    try {
      record.execution?.onVisibilityChange?.(record.config.visible ?? true);
    } catch (error) {
      this.fail(record, 'visibility', error);
    }
  }

  private stop(record: RuntimeRecord): void {
    const execution = record.execution;
    record.execution = null;
    if (execution?.destroy) {
      try {
        execution.destroy();
      } catch (error) {
        this.report(record, 'destroy', error);
      }
    }
    record.scope?.dispose();
    record.scope = null;
  }

  private fail(record: RuntimeRecord, phase: IndicatorRuntimeError['phase'], error: unknown): void {
    record.failed = true;
    this.report(record, phase, error);
    this.stop(record);
    try {
      this.services.chartHost.clear(record.config.instanceId);
    } catch (cleanupError) {
      this.report(record, 'cleanup', cleanupError);
    }
    try {
      this.services.mainSeriesLifecycle?.clear(record.config.instanceId);
    } catch (cleanupError) {
      this.report(record, 'cleanup', cleanupError);
    }
  }

  private report(record: RuntimeRecord, phase: IndicatorRuntimeError['phase'], error: unknown): void {
    this.services.onError?.({
      instanceId: record.config.instanceId,
      indicatorId: record.config.indicatorId,
      phase,
      error,
    });
  }
}
