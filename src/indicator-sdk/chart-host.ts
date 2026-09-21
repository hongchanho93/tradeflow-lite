import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type IPaneApi,
  type ISeriesApi,
  type SeriesDefinition,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type {
  IndicatorCanvasLayerDefinition,
  IndicatorDataEvent,
  IndicatorLayers,
  IndicatorPaneApi,
  IndicatorPaneDefinition,
  IndicatorPaneHandle,
  IndicatorSeriesDefinition,
  IndicatorSeriesHandle,
  IndicatorSeriesPoint,
  IndicatorSeriesType,
  IndicatorSeriesValuesOptions,
} from './contracts';
import { ManagedCanvasPrimitive } from './canvas-layer.ts';
import { ManagedOverlay, OverlayLayoutManager } from './overlay-layer.ts';
import { validateIndicatorPaneKey } from './registry.ts';

type AnySeries = ISeriesApi<SeriesType, Time>;

const seriesDefinitions: Record<IndicatorSeriesType, SeriesDefinition<SeriesType>> = {
  line: LineSeries,
  histogram: HistogramSeries,
  area: AreaSeries,
  baseline: BaselineSeries,
  bar: BarSeries,
};

type PaneSlot = {
  key: string;
  pane: IPaneApi<Time>;
};

type SeriesSlot = {
  key: string;
  type: IndicatorSeriesType;
  paneKey: string;
  series: AnySeries;
  knownTimes: Set<number>;
  desiredVisible: boolean;
};

type CanvasSlot = {
  key: string;
  targetKey: string;
  anchor: AnySeries | null;
  definition: IndicatorCanvasLayerDefinition;
  primitive: ManagedCanvasPrimitive;
  detach: () => void;
  desiredVisible: boolean;
};

type OverlaySlot = {
  key: string;
  paneKey: string;
  overlay: ManagedOverlay;
  desiredVisible: boolean;
};

type VisualSlot = {
  generation: number;
  visible: boolean;
  panes: Map<string, PaneSlot>;
  series: Map<string, SeriesSlot>;
  canvases: Map<string, CanvasSlot>;
  overlays: Map<string, OverlaySlot>;
  claimedPanes: Set<string>;
  claimedSeries: Set<string>;
  claimedCanvases: Set<string>;
  claimedOverlays: Set<string>;
  restoredPaneHeights: Map<string, number>;
  restoredPaneOrders: Map<string, number>;
  bindingSnapshot: {
    panes: Map<string, PaneSlot>;
    series: Map<string, SeriesSlot>;
    canvases: Map<string, CanvasSlot>;
    overlays: Map<string, OverlaySlot>;
  } | null;
};

function assertStableKey(key: string, resource: string): void {
  if (!key.trim()) throw new Error(`indicator ${resource} key must be non-empty`);
}

function toSeriesPoint(point: IndicatorSeriesPoint, type: IndicatorSeriesType): Record<string, unknown> {
  if (!Number.isFinite(point.time)) throw new Error('indicator series point time must be finite');
  if ('open' in point) {
    if (type !== 'bar') throw new Error(`indicator ${type} series does not accept OHLC points`);
    if (![point.open, point.high, point.low, point.close].every(Number.isFinite)) {
      throw new Error('indicator bar series OHLC values must be finite');
    }
    return {
      time: point.time as UTCTimestamp,
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close,
      ...(point.color === undefined ? {} : { color: point.color }),
    };
  }
  if (type === 'bar') throw new Error('indicator bar series requires OHLC points');
  if (point.value === undefined) return { time: point.time as UTCTimestamp };
  if (!Number.isFinite(point.value)) throw new Error('indicator series point value must be finite');
  return {
    time: point.time as UTCTimestamp,
    value: point.value,
    ...(point.color === undefined ? {} : { color: point.color }),
  };
}

class PaneHandle implements IndicatorPaneHandle {
  readonly key: string;
  private readonly pane: IPaneApi<Time>;

  constructor(
    key: string,
    pane: IPaneApi<Time>,
  ) {
    this.key = key;
    this.pane = pane;
  }

  getHeight(): number {
    return this.pane.getHeight();
  }
}

class SeriesHandle<T extends IndicatorSeriesType> implements IndicatorSeriesHandle<T> {
  readonly key: string;
  readonly type: T;
  readonly pane: string;

  private readonly slot: SeriesSlot;
  private readonly owner: VisualSlot;
  private readonly generation: number;

  constructor(
    slot: SeriesSlot,
    owner: VisualSlot,
    generation: number,
  ) {
    this.slot = slot;
    this.owner = owner;
    this.generation = generation;
    this.key = slot.key;
    this.type = slot.type as T;
    this.pane = slot.paneKey;
  }

  setData(points: readonly IndicatorSeriesPoint[]): void {
    this.assertCurrent();
    this.slot.series.setData(points.map((point) => toSeriesPoint(point, this.type)) as never);
    this.slot.knownTimes = new Set(points.map((point) => point.time));
  }

  update(point: IndicatorSeriesPoint): void {
    this.assertCurrent();
    this.slot.series.update(toSeriesPoint(point, this.type) as never);
    this.slot.knownTimes.add(point.time);
  }

  setValues(
    event: IndicatorDataEvent,
    values: readonly (number | null)[],
    options: IndicatorSeriesValuesOptions<T> = {},
  ): void {
    this.assertCurrent();
    if (this.type === 'bar') {
      throw new Error(`indicator bar series ${this.key} does not support scalar setValues(); use setData() or update() with OHLC points`);
    }
    if (values.length !== event.bars.length) {
      throw new Error(`indicator series ${this.key} expected ${event.bars.length} values, received ${values.length}`);
    }
    const pointAt = (index: number): Record<string, unknown> => {
      const value = values[index];
      const time = event.bars[index].time as UTCTimestamp;
      if (value === null) return { time };
      if (!Number.isFinite(value)) {
        throw new Error(`indicator series ${this.key} produced a non-finite value at index ${index}`);
      }
      const pointOptions = options.pointOptions?.(value, index, event.bars[index]);
      return { time, value, ...(pointOptions ?? {}) };
    };
    if (event.reason !== 'realtime') {
      this.slot.series.setData(event.bars.map((_, index) => pointAt(index)) as never);
      this.slot.knownTimes = new Set(event.bars.map((bar) => bar.time));
      return;
    }
    const nextTimes = new Set(event.bars.map((bar) => bar.time));
    const removedRenderedTime = [...this.slot.knownTimes].some((time) => !nextTimes.has(time));
    let sawUnknownTime = false;
    let knownAfterUnknown = false;
    for (const bar of event.bars) {
      if (!this.slot.knownTimes.has(bar.time)) sawUnknownTime = true;
      else if (sawUnknownTime) knownAfterUnknown = true;
    }
    if (removedRenderedTime || knownAfterUnknown) {
      this.slot.series.setData(event.bars.map((_, index) => pointAt(index)) as never);
      this.slot.knownTimes = nextTimes;
      return;
    }
    const dirtyFrom = Math.max(
      0,
      Math.min(
        event.bars.length,
        Math.trunc(Math.min(event.changedFrom, options.dirtyFrom ?? event.changedFrom)),
      ),
    );
    for (let index = dirtyFrom; index < event.bars.length; index += 1) {
      const time = event.bars[index].time;
      const historical = this.slot.knownTimes.has(time);
      this.slot.series.update(pointAt(index) as never, historical);
      this.slot.knownTimes.add(time);
    }
  }

  setVisible(visible: boolean): void {
    this.assertCurrent();
    this.slot.desiredVisible = visible;
    this.slot.series.applyOptions({ visible: this.owner.visible && visible });
  }

  private assertCurrent(): void {
    if (this.owner.generation !== this.generation) {
      throw new Error(`indicator series ${this.key} belongs to a stale execution generation`);
    }
  }
}

export class IndicatorChartHost {
  private readonly slots = new Map<string, VisualSlot>();
  private readonly chart: IChartApi;
  private readonly mainPane: IPaneApi<Time>;
  private readonly currentMainSeries: () => AnySeries;
  private readonly theme: () => 'dark' | 'light';
  private readonly onCanvasError: (instanceId: string, key: string, error: unknown) => void;
  private runtimeCanvasError: ((instanceId: string, key: string, error: unknown) => void) | null = null;
  private readonly overlayManager: OverlayLayoutManager | null;

  constructor(
    chart: IChartApi,
    mainPane: IPaneApi<Time>,
    currentMainSeries: () => AnySeries = () => {
      const series = mainPane.getSeries()[0];
      if (!series) throw new Error('indicator current main series is unavailable');
      return series;
    },
    theme: () => 'dark' | 'light' = () => 'dark',
    onCanvasError: (instanceId: string, key: string, error: unknown) => void = () => {},
    overlayContainer?: HTMLElement,
  ) {
    this.chart = chart;
    this.mainPane = mainPane;
    this.currentMainSeries = currentMainSeries;
    this.theme = theme;
    this.onCanvasError = onCanvasError;
    this.overlayManager = overlayContainer && typeof ResizeObserver !== 'undefined'
      ? new OverlayLayoutManager(chart, overlayContainer, (instanceId, paneKey) => this.pane(instanceId, paneKey))
      : null;
  }

  setCanvasErrorHandler(
    handler: ((instanceId: string, key: string, error: unknown) => void) | null,
  ): void {
    this.runtimeCanvasError = handler;
  }

  private slot(instanceId: string): VisualSlot {
    let slot = this.slots.get(instanceId);
    if (!slot) {
      slot = {
        generation: 0,
        visible: true,
        panes: new Map(),
        series: new Map(),
        canvases: new Map(),
        overlays: new Map(),
        claimedPanes: new Set(),
        claimedSeries: new Set(),
        claimedCanvases: new Set(),
        claimedOverlays: new Set(),
        restoredPaneHeights: new Map(),
        restoredPaneOrders: new Map(),
        bindingSnapshot: null,
      };
      this.slots.set(instanceId, slot);
    }
    return slot;
  }

  beginBinding(instanceId: string): { panes: IndicatorPaneApi; layers: IndicatorLayers } {
    const slot = this.slot(instanceId);
    slot.bindingSnapshot = {
      panes: new Map(slot.panes),
      series: new Map(slot.series),
      canvases: new Map(slot.canvases),
      overlays: new Map(slot.overlays),
    };
    slot.generation += 1;
    const generation = slot.generation;
    slot.claimedPanes.clear();
    slot.claimedSeries.clear();
    slot.claimedCanvases.clear();
    slot.claimedOverlays.clear();
    for (const resource of slot.series.values()) {
      resource.series.setData([]);
      resource.knownTimes.clear();
    }
    for (const resource of slot.canvases.values()) resource.primitive.clear();
    for (const resource of slot.overlays.values()) resource.overlay.renewContent();

    const resolvePane = (key: string): IPaneApi<Time> => {
      if (key === 'main') return this.mainPane;
      const pane = slot.panes.get(key);
      if (!pane) throw new Error(`indicator pane ${JSON.stringify(key)} must be created before its series`);
      return pane.pane;
    };
    const paneHandle = (key: string, pane: IPaneApi<Time>) => new PaneHandle(key, pane);
    const panes: IndicatorPaneApi = {
      main: paneHandle('main', this.mainPane),
      create: (definition: IndicatorPaneDefinition) => {
        const key = validateIndicatorPaneKey(definition.key);
        if (!Number.isFinite(definition.defaultHeight) || definition.defaultHeight <= 0) {
          throw new Error(`indicator pane ${JSON.stringify(key)} defaultHeight must be positive`);
        }
        let pane = slot.panes.get(key);
        if (!pane) {
          const api = this.chart.addPane(true);
          api.setHeight(slot.restoredPaneHeights.get(key) ?? definition.defaultHeight);
          pane = { key, pane: api };
          slot.panes.set(key, pane);
        }
        slot.claimedPanes.add(key);
        return paneHandle(key, pane.pane);
      },
      get: (key: string) => {
        if (key === 'main') return paneHandle('main', this.mainPane);
        const pane = slot.panes.get(key);
        return pane ? paneHandle(key, pane.pane) : null;
      },
    };
    const layers: IndicatorLayers = {
      createSeries: <T extends IndicatorSeriesType>(definition: IndicatorSeriesDefinition<T>) => {
        assertStableKey(definition.key, 'series');
        const paneKey = definition.pane;
        const pane = resolvePane(paneKey);
        slot.claimedPanes.add(paneKey);
        slot.claimedSeries.add(definition.key);
        let resource = slot.series.get(definition.key);
        if (resource && resource.type !== definition.type) {
          slot.series.delete(definition.key);
          resource = undefined;
        }
        if (!resource) {
          const created = this.chart.addSeries(
            seriesDefinitions[definition.type] as never,
            definition.options as never,
            pane.paneIndex(),
          ) as AnySeries;
          resource = {
            key: definition.key,
            type: definition.type,
            paneKey,
            series: created,
            knownTimes: new Set(),
            desiredVisible: true,
          };
          slot.series.set(definition.key, resource);
        } else {
          if (resource.paneKey !== paneKey) resource.series.moveToPane(pane.paneIndex());
          resource.paneKey = paneKey;
          if (definition.options) resource.series.applyOptions(definition.options as never);
        }
        resource.desiredVisible = true;
        resource.series.applyOptions({ visible: slot.visible && resource.desiredVisible });
        return new SeriesHandle<T>(resource, slot, generation);
      },
      createCanvasLayer: (definition: IndicatorCanvasLayerDefinition) => {
        assertStableKey(definition.key, 'canvas');
        slot.claimedCanvases.add(definition.key);
        const target = (() => {
          if (definition.target.type === 'pane') {
            const pane = resolvePane(definition.target.pane.key);
            return {
              targetKey: `pane:${definition.target.pane.key}`,
              anchor: null,
              attach: (primitive: ManagedCanvasPrimitive) => {
                pane.attachPrimitive(primitive);
                return () => pane.detachPrimitive(primitive);
              },
            };
          }
          const series = definition.target.type === 'current-main-series'
            ? this.currentMainSeries()
            : slot.series.get(definition.target.series.key)?.series;
          if (!series) throw new Error(`indicator canvas ${definition.key} target series is unavailable`);
          const targetKey = definition.target.type === 'current-main-series'
            ? 'series:current-main'
            : `series:${definition.target.series.key}`;
          return {
            targetKey,
            anchor: series,
            attach: (primitive: ManagedCanvasPrimitive) => {
              series.attachPrimitive(primitive);
              return () => series.detachPrimitive(primitive);
            },
          };
        })();
        let resource = slot.canvases.get(definition.key);
        if (resource && (resource.targetKey !== target.targetKey || resource.anchor !== target.anchor)) {
          slot.canvases.delete(definition.key);
          resource = undefined;
        }
        if (!resource) {
          const primitive = new ManagedCanvasPrimitive(
            definition,
            this.chart,
            target.anchor,
            this.theme,
            (error) => {
              this.onCanvasError(instanceId, definition.key, error);
              this.runtimeCanvasError?.(instanceId, definition.key, error);
            },
          );
          resource = {
            key: definition.key,
            targetKey: target.targetKey,
            anchor: target.anchor,
            definition,
            primitive,
            detach: target.attach(primitive),
            desiredVisible: true,
          };
          slot.canvases.set(definition.key, resource);
        } else {
          resource.definition = definition;
          resource.primitive.setDefinition(definition, target.anchor);
        }
        resource.desiredVisible = true;
        resource.primitive.setVisible(slot.visible && resource.desiredVisible);
        const primitive = resource.primitive;
        return {
          key: definition.key,
          requestUpdate: () => {
            if (slot.generation !== generation) {
              throw new Error(`indicator canvas ${definition.key} belongs to a stale execution generation`);
            }
            primitive.requestUpdate();
          },
          setVisible: (visible) => {
            if (slot.generation !== generation) {
              throw new Error(`indicator canvas ${definition.key} belongs to a stale execution generation`);
            }
            resource!.desiredVisible = visible;
            primitive.setVisible(slot.visible && visible);
          },
        };
      },
      createOverlay: (definition) => {
        if (!this.overlayManager) throw new Error('indicator Overlay layer requires a DOM overlay container');
        assertStableKey(definition.key, 'overlay');
        resolvePane(definition.paneKey);
        slot.claimedPanes.add(definition.paneKey);
        slot.claimedOverlays.add(definition.key);
        let resource = slot.overlays.get(definition.key);
        if (resource && resource.paneKey !== definition.paneKey) {
          slot.overlays.delete(definition.key);
          resource = undefined;
        }
        if (!resource) {
          resource = {
            key: definition.key,
            paneKey: definition.paneKey,
            overlay: this.overlayManager.create(instanceId, definition),
            desiredVisible: true,
          };
          slot.overlays.set(definition.key, resource);
        } else {
          resource.overlay.setDefinition(definition);
        }
        resource.desiredVisible = true;
        resource.overlay.setVisible(slot.visible && resource.desiredVisible);
        this.overlayManager.requestLayout();
        const overlay = resource.overlay;
        const root = overlay.root;
        return {
          key: definition.key,
          root,
          setStyles: (cssText) => {
            if (slot.generation !== generation) {
              throw new Error(`indicator overlay ${definition.key} belongs to a stale execution generation`);
            }
            overlay.setStyles(cssText);
          },
          setVisible: (visible) => {
            if (slot.generation !== generation) {
              throw new Error(`indicator overlay ${definition.key} belongs to a stale execution generation`);
            }
            resource!.desiredVisible = visible;
            overlay.setVisible(slot.visible && visible);
          },
        };
      },
    };
    return { panes, layers };
  }

  finishBinding(instanceId: string): void {
    const slot = this.slots.get(instanceId);
    if (!slot) return;
    const snapshot = slot.bindingSnapshot;
    for (const [key, resource] of slot.canvases) {
      if (slot.claimedCanvases.has(key)) continue;
      resource.detach();
      slot.canvases.delete(key);
    }
    for (const [key, resource] of slot.overlays) {
      if (slot.claimedOverlays.has(key)) continue;
      this.overlayManager?.remove(resource.overlay);
      slot.overlays.delete(key);
    }
    for (const [key, resource] of slot.series) {
      if (slot.claimedSeries.has(key)) continue;
      this.chart.removeSeries(resource.series);
      slot.series.delete(key);
    }
    for (const [key, resource] of slot.panes) {
      if (slot.claimedPanes.has(key)) continue;
      if (this.chart.panes().includes(resource.pane)) this.chart.removePane(resource.pane.paneIndex());
      slot.panes.delete(key);
    }
    if (snapshot) {
      for (const [key, resource] of snapshot.canvases) {
        if (slot.canvases.has(key) && slot.canvases.get(key) !== resource) resource.detach();
      }
      for (const [key, resource] of snapshot.overlays) {
        if (slot.overlays.has(key) && slot.overlays.get(key) !== resource) this.overlayManager?.remove(resource.overlay);
      }
      for (const [key, resource] of snapshot.series) {
        if (slot.series.has(key) && slot.series.get(key) !== resource) this.chart.removeSeries(resource.series);
      }
      for (const [key, resource] of snapshot.panes) {
        if (slot.panes.has(key) && slot.panes.get(key) !== resource && this.chart.panes().includes(resource.pane)) {
          this.chart.removePane(resource.pane.paneIndex());
        }
      }
    }
    slot.bindingSnapshot = null;
  }

  abortBinding(instanceId: string): void {
    const slot = this.slots.get(instanceId);
    if (!slot) return;
    slot.generation += 1;
    const snapshot = slot.bindingSnapshot;
    if (!snapshot) return;
    for (const [key, resource] of slot.canvases) {
      if (snapshot.canvases.get(key) !== resource) resource.detach();
    }
    for (const [key, resource] of slot.overlays) {
      if (snapshot.overlays.get(key) !== resource) this.overlayManager?.remove(resource.overlay);
    }
    for (const [key, resource] of slot.series) {
      if (snapshot.series.get(key) !== resource) this.chart.removeSeries(resource.series);
    }
    for (const [key, resource] of slot.panes) {
      if (snapshot.panes.get(key) === resource) continue;
      if (this.chart.panes().includes(resource.pane)) this.chart.removePane(resource.pane.paneIndex());
    }
    slot.canvases = new Map(snapshot.canvases);
    slot.overlays = new Map(snapshot.overlays);
    slot.series = new Map(snapshot.series);
    slot.panes = new Map(snapshot.panes);
    slot.bindingSnapshot = null;
    slot.claimedCanvases.clear();
    slot.claimedOverlays.clear();
    slot.claimedSeries.clear();
    slot.claimedPanes.clear();
  }

  setVisible(instanceId: string, visible: boolean): void {
    const slot = this.slots.get(instanceId);
    if (!slot) return;
    slot.visible = visible;
    for (const resource of slot.series.values()) {
      resource.series.applyOptions({ visible: visible && resource.desiredVisible });
    }
    for (const resource of slot.canvases.values()) {
      resource.primitive.setVisible(visible && resource.desiredVisible);
    }
    for (const resource of slot.overlays.values()) {
      resource.overlay.setVisible(visible && resource.desiredVisible);
    }
  }

  clear(instanceId: string): void {
    const slot = this.slots.get(instanceId);
    if (!slot) return;
    for (const resource of slot.series.values()) {
      resource.series.setData([]);
      resource.knownTimes.clear();
    }
    for (const resource of slot.canvases.values()) resource.primitive.clear();
    for (const resource of slot.overlays.values()) resource.overlay.clear();
  }

  series(instanceId: string): AnySeries[] {
    return [...(this.slots.get(instanceId)?.series.values() ?? [])].map((resource) => resource.series);
  }

  pane(instanceId: string, key: string): IPaneApi<Time> | null {
    return this.slots.get(instanceId)?.panes.get(key)?.pane ?? null;
  }

  visualPaneTargets(instanceId: string): readonly { key: string; paneIndex: number }[] {
    const slot = this.slots.get(instanceId);
    if (!slot) return [];
    const keys = new Set<string>();
    for (const resource of slot.series.values()) keys.add(resource.paneKey);
    for (const resource of slot.overlays.values()) keys.add(resource.paneKey);
    for (const resource of slot.canvases.values()) {
      if (resource.targetKey === 'series:current-main') {
        keys.add('main');
      } else if (resource.targetKey.startsWith('pane:')) {
        keys.add(resource.targetKey.slice('pane:'.length));
      } else if (resource.targetKey.startsWith('series:')) {
        const series = slot.series.get(resource.targetKey.slice('series:'.length));
        if (series) keys.add(series.paneKey);
      }
    }
    return [...keys].flatMap((key) => {
      const pane = key === 'main' ? this.mainPane : slot.panes.get(key)?.pane;
      return pane && this.chart.panes().includes(pane)
        ? [{ key, paneIndex: pane.paneIndex() }]
        : [];
    }).sort((left, right) => left.paneIndex - right.paneIndex || left.key.localeCompare(right.key));
  }

  paneStates(instanceId: string): readonly { key: string; renderOrder: number; height: number }[] {
    const slot = this.slots.get(instanceId);
    if (!slot) return [];
    return [...slot.panes.values()].map((resource) => ({
      key: resource.key,
      renderOrder: resource.pane.paneIndex(),
      height: resource.pane.getHeight(),
    }));
  }

  restorePaneStates(
    instanceId: string,
    states: readonly { key: string; height: number; renderOrder?: number }[],
  ): void {
    const slot = this.slot(instanceId);
    for (const state of states) {
      if (!state.key.trim() || state.key === 'main' || !Number.isFinite(state.height) || state.height <= 0) continue;
      slot.restoredPaneHeights.set(state.key, state.height);
      if (Number.isInteger(state.renderOrder) && state.renderOrder! > 0) {
        slot.restoredPaneOrders.set(state.key, state.renderOrder!);
      }
      slot.panes.get(state.key)?.pane.setHeight(state.height);
    }
  }

  applyRestoredPaneOrder(): void {
    const entries = [...this.slots.values()].flatMap((slot) => [...slot.panes.values()].flatMap((resource) => {
      const order = slot.restoredPaneOrders.get(resource.key);
      return order === undefined ? [] : [{ pane: resource.pane, order }];
    })).sort((left, right) => left.order - right.order);
    for (const entry of entries) {
      const panes = this.chart.panes();
      const target = Math.min(Math.max(1, entry.order), panes.length - 1);
      const current = entry.pane.paneIndex();
      if (current !== target) this.chart.swapPanes(current, target);
    }
  }

  applyInstancePaneOrder(instanceIds: readonly string[]): void {
    const panes = instanceIds.flatMap((instanceId) => {
      const slot = this.slots.get(instanceId);
      return slot ? [...slot.panes.values()].map((resource) => resource.pane) : [];
    });
    for (const [offset, pane] of panes.entries()) {
      const target = offset + 1;
      const current = pane.paneIndex();
      if (current !== target) this.chart.swapPanes(current, target);
    }
    this.requestOverlayLayout();
  }

  requestOverlayLayout(): void {
    this.overlayManager?.requestLayout();
  }

  rebindCurrentMainSeries(): void {
    const next = this.currentMainSeries();
    for (const slot of this.slots.values()) {
      for (const resource of slot.canvases.values()) {
        if (resource.targetKey !== 'series:current-main' || resource.anchor === next) continue;
        resource.detach();
        resource.anchor = next;
        resource.primitive.setDefinition(resource.definition, next);
        next.attachPrimitive(resource.primitive);
        resource.detach = () => next.detachPrimitive(resource.primitive);
      }
    }
  }

  remove(instanceId: string): void {
    const slot = this.slots.get(instanceId);
    if (!slot) return;
    slot.generation += 1;
    for (const resource of slot.canvases.values()) resource.detach();
    for (const resource of slot.overlays.values()) this.overlayManager?.remove(resource.overlay);
    for (const resource of slot.series.values()) this.chart.removeSeries(resource.series);
    for (const resource of slot.panes.values()) {
      if (this.chart.panes().includes(resource.pane)) this.chart.removePane(resource.pane.paneIndex());
    }
    this.slots.delete(instanceId);
  }

  dispose(): void {
    for (const instanceId of [...this.slots.keys()]) this.remove(instanceId);
    this.overlayManager?.dispose();
  }
}
