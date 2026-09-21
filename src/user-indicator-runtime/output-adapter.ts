import type {
  ChartKind,
  IndicatorBarStyle,
  IndicatorBarStyleContribution,
  IndicatorCanvasLayerHandle,
  IndicatorDataEvent,
  IndicatorLayers,
  IndicatorMainSeriesApi,
  IndicatorMarker,
  IndicatorMarkerContribution,
  IndicatorOverlayHandle,
  IndicatorPaneApi,
  IndicatorSeriesHandle,
  IndicatorSeriesPoint,
  IndicatorSeriesType,
} from '../indicator-sdk/contracts.ts';
import type { IndicatorChartHost } from '../indicator-sdk/chart-host.ts';
import type { IndicatorMainSeriesHost } from '../indicator-sdk/main-series-host.ts';
import type {
  UserIndicatorCallbackOutput,
  UserIndicatorCanvasCommand,
  UserIndicatorMarker,
  UserIndicatorOutputCommand,
} from './output-protocol.ts';
import type { UserIndicatorExecutionSuccess } from './supervisor-protocol.ts';
import { drawUserIndicatorCanvasCommands, type UserIndicatorCanvasHitRegion } from './canvas-renderer.ts';
import { renderUserIndicatorPanel, USER_INDICATOR_PANEL_STYLES } from './panel-renderer.ts';

export type UserIndicatorChartHostLike = Pick<
  IndicatorChartHost,
  'beginBinding' | 'finishBinding' | 'abortBinding' | 'setVisible' | 'remove'
>;

export type UserIndicatorMainSeriesHostLike = Pick<
  IndicatorMainSeriesHost,
  'beginBinding' | 'finishBinding' | 'abortBinding' | 'setVisible' | 'remove'
>;

const USER_INDICATOR_MARKER_CHART_KINDS: readonly ChartKind[] = Object.freeze([
  'candles',
  'bars',
  'line',
  'area',
  'baseline',
]);

type AdapterRecord = {
  readonly generation: number;
  readonly panes: IndicatorPaneApi;
  readonly layers: IndicatorLayers;
  readonly mainSeries: IndicatorMainSeriesApi | null;
  readonly series: Map<string, IndicatorSeriesHandle>;
  readonly markers: Map<string, {
    contribution: IndicatorMarkerContribution;
    interactive: readonly UserIndicatorMarker[];
  }>;
  readonly barStyles: Map<string, {
    contribution: IndicatorBarStyleContribution;
    styles: Map<number, IndicatorBarStyle>;
  }>;
  readonly canvases: Map<string, {
    handle: IndicatorCanvasLayerHandle;
    buffer: { commands: readonly UserIndicatorCanvasCommand[]; hitRegions: readonly UserIndicatorCanvasHitRegion[] };
  }>;
  readonly panels: Map<string, IndicatorOverlayHandle>;
};

export type UserIndicatorPointerHit = Readonly<{
  instanceId: string;
  id: string;
  pane: 'main';
  time: number | null;
}>;

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export class UserIndicatorOutputAdapter {
  private readonly host: UserIndicatorChartHostLike;
  private readonly mainSeriesHost: UserIndicatorMainSeriesHostLike | null;
  private readonly records = new Map<string, AdapterRecord>();

  constructor(
    host: UserIndicatorChartHostLike,
    mainSeriesHost: UserIndicatorMainSeriesHostLike | null = null,
  ) {
    this.host = host;
    this.mainSeriesHost = mainSeriesHost;
  }

  apply(
    response: Readonly<UserIndicatorExecutionSuccess>,
    event: Readonly<IndicatorDataEvent>,
  ): void {
    if (response.phase === 'create') {
      try {
        this.applyCreate(response, event);
      } catch (error) {
        throw new Error(`user indicator chart output apply failed: ${errorMessage(error)}`);
      }
      return;
    }

    try {
      if (response.phase !== 'update' && response.phase !== 'pointer') {
        throw new Error(`unsupported user indicator output phase ${response.phase}`);
      }
      const record = this.records.get(response.instanceId);
      if (!record || record.generation !== response.generation) {
        throw new Error('user indicator output targets a stale or missing chart binding');
      }
      if (response.output.callbacks.length !== 1 || response.output.callbacks[0]?.phase !== response.phase) {
        throw new Error(`user indicator ${response.phase} output must contain exactly one matching callback`);
      }
      if (response.phase === 'update') this.assertEventMatches(response.output.callbacks[0], event);
      this.applyUpdateCommands(record, response.output.callbacks[0].commands, event);
    } catch (error) {
      this.remove(response.instanceId);
      throw new Error(`user indicator chart output apply failed: ${errorMessage(error)}`);
    }
  }

  remove(instanceId: string): void {
    this.records.delete(instanceId);
    this.host.remove(instanceId);
    this.mainSeriesHost?.remove(instanceId);
  }

  setVisible(instanceId: string, visible: boolean): void {
    if (!this.records.has(instanceId)) return;
    this.host.setVisible(instanceId, visible);
    this.mainSeriesHost?.setVisible(instanceId, visible);
  }

  destroy(): void {
    for (const instanceId of [...this.records.keys()]) this.remove(instanceId);
  }

  has(instanceId: string, generation?: number): boolean {
    const record = this.records.get(instanceId);
    return Boolean(record && (generation === undefined || record.generation === generation));
  }

  hitTest(time: number | null, x: number, y: number): UserIndicatorPointerHit | null {
    const records = [...this.records.entries()].reverse();
    for (const [instanceId, record] of records) {
      if (time !== null) {
        for (const binding of [...record.markers.values()].reverse()) {
          for (let index = binding.interactive.length - 1; index >= 0; index -= 1) {
            const marker = binding.interactive[index];
            if (marker.hitTest === true && marker.id && marker.time === time) {
              return Object.freeze({ instanceId, id: marker.id, pane: 'main', time });
            }
          }
        }
      }
      for (const binding of [...record.canvases.values()].reverse()) {
        for (let index = binding.buffer.hitRegions.length - 1; index >= 0; index -= 1) {
          const region = binding.buffer.hitRegions[index];
          if (x >= region.left && x <= region.right && y >= region.top && y <= region.bottom) {
            return Object.freeze({ instanceId, id: region.id, pane: 'main', time });
          }
        }
      }
    }
    return null;
  }

  private applyCreate(
    response: Readonly<UserIndicatorExecutionSuccess>,
    event: Readonly<IndicatorDataEvent>,
  ): void {
    if (response.output.callbacks.length !== 2
      || response.output.callbacks[0]?.phase !== 'create'
      || response.output.callbacks[1]?.phase !== 'update') {
      throw new Error('user indicator create output must contain create + initial update callbacks');
    }

    const binding = this.host.beginBinding(response.instanceId);
    let mainSeries: IndicatorMainSeriesApi | null = null;
    let chartBindingOpen = true;
    let mainSeriesBindingOpen = false;
    try {
      mainSeries = this.mainSeriesHost?.beginBinding(response.instanceId) ?? null;
      mainSeriesBindingOpen = mainSeries !== null;
      const record: AdapterRecord = {
        generation: response.generation,
        panes: binding.panes,
        layers: binding.layers,
        mainSeries,
        series: new Map(),
        markers: new Map(),
        barStyles: new Map(),
        canvases: new Map(),
        panels: new Map(),
      };
      this.applyCreateCommands(record, response.output.callbacks[0].commands);
      this.assertEventMatches(response.output.callbacks[1], event);
      this.applyUpdateCommands(record, response.output.callbacks[1].commands, event);
      this.host.finishBinding(response.instanceId);
      chartBindingOpen = false;
      this.mainSeriesHost?.finishBinding(response.instanceId);
      mainSeriesBindingOpen = false;
      this.records.set(response.instanceId, record);
    } catch (error) {
      if (chartBindingOpen) {
        try {
          this.host.abortBinding(response.instanceId);
        } catch {
          // The instance is removed below even if rollback itself fails.
        }
      }
      if (mainSeriesBindingOpen) {
        try {
          this.mainSeriesHost?.abortBinding(response.instanceId);
        } catch {
          // The instance is removed below even if rollback itself fails.
        }
      }
      this.records.delete(response.instanceId);
      this.host.remove(response.instanceId);
      this.mainSeriesHost?.remove(response.instanceId);
      throw error;
    }
  }

  private applyCreateCommands(record: AdapterRecord, commands: readonly UserIndicatorOutputCommand[]): void {
    for (const command of commands) {
      if (command.type === 'create-pane') {
        record.panes.create({ key: command.key, defaultHeight: command.defaultHeight });
        continue;
      }
      if (command.type === 'create-series') {
        const handle = record.layers.createSeries({
          key: command.key,
          type: command.seriesType,
          pane: command.pane,
          ...(command.options === undefined ? {} : { options: command.options as never }),
        });
        record.series.set(command.key, handle);
        continue;
      }
      if (command.type === 'series-set-visible') {
        this.series(record, command.key).setVisible(command.visible);
        continue;
      }
      if (command.type === 'create-marker-contribution') {
        if (!record.mainSeries) throw new Error('user indicator marker host is unavailable');
        const contribution = record.mainSeries.createMarkerContribution({
          key: command.key,
          priority: command.priority,
          chartKinds: USER_INDICATOR_MARKER_CHART_KINDS,
        });
        record.markers.set(command.key, { contribution, interactive: Object.freeze([]) });
        continue;
      }
      if (command.type === 'create-bar-style-contribution') {
        if (!record.mainSeries) throw new Error('user indicator main-series host is unavailable');
        const styles = new Map<number, IndicatorBarStyle>();
        const contribution = record.mainSeries.createBarStyleContribution({
          key: command.key,
          priority: command.priority,
          chartKinds: command.chartKinds,
        });
        contribution.setProvider((bar) => styles.get(bar.time) ?? null);
        record.barStyles.set(command.key, { contribution, styles });
        continue;
      }
      if (command.type === 'create-canvas-layer') {
        const buffer: { commands: readonly UserIndicatorCanvasCommand[]; hitRegions: readonly UserIndicatorCanvasHitRegion[] } = {
          commands: Object.freeze([]), hitRegions: Object.freeze([]),
        };
        const target = command.target.type === 'current-main-series'
          ? { type: 'current-main-series' as const }
          : command.target.type === 'pane'
            ? { type: 'pane' as const, pane: this.pane(record, command.target.pane) }
            : { type: 'series' as const, series: this.series(record, command.target.series) };
        const handle = record.layers.createCanvasLayer({
          key: command.key,
          target,
          zOrder: command.zOrder,
          draw: (frame) => { buffer.hitRegions = drawUserIndicatorCanvasCommands(frame, buffer.commands); },
        });
        record.canvases.set(command.key, { handle, buffer });
        continue;
      }
      if (command.type === 'canvas-set-visible') {
        this.canvas(record, command.key).handle.setVisible(command.visible);
        continue;
      }
      if (command.type === 'debug-log') continue;
      if (command.type === 'create-panel') {
        const panel = record.layers.createOverlay({
          key: command.key,
          paneKey: command.paneKey,
          position: command.position,
          interactive: false,
        });
        panel.setStyles(USER_INDICATOR_PANEL_STYLES);
        record.panels.set(command.key, panel);
        continue;
      }
      throw new Error(`command ${command.type} is not allowed in create output`);
    }
  }

  private applyUpdateCommands(
    record: AdapterRecord,
    commands: readonly UserIndicatorOutputCommand[],
    event: Readonly<IndicatorDataEvent>,
  ): void {
    for (const command of commands) {
      if (command.type === 'series-set-values') {
        this.series(record, command.key).setValues(
          event,
          command.values,
          command.dirtyFrom === undefined ? {} : { dirtyFrom: command.dirtyFrom },
        );
        continue;
      }
      if (command.type === 'series-set-data') {
        this.series(record, command.key).setData(command.points as readonly IndicatorSeriesPoint[]);
        continue;
      }
      if (command.type === 'series-update') {
        this.series(record, command.key).update(command.point as IndicatorSeriesPoint);
        continue;
      }
      if (command.type === 'series-set-visible') {
        this.series(record, command.key).setVisible(command.visible);
        continue;
      }
      if (command.type === 'marker-set') {
        const binding = this.marker(record, command.key);
        binding.contribution.set(command.markers as readonly IndicatorMarker[]);
        binding.interactive = Object.freeze(command.markers.filter((marker) => marker.hitTest === true));
        continue;
      }
      if (command.type === 'bar-style-set') {
        const binding = this.barStyle(record, command.key);
        binding.styles.clear();
        for (const style of command.styles) {
          const { time, ...colors } = style;
          binding.styles.set(time, Object.freeze(colors));
        }
        binding.contribution.invalidateFrom(event.changedFrom);
        continue;
      }
      if (command.type === 'canvas-set-commands') {
        const binding = this.canvas(record, command.key);
        binding.buffer.commands = command.commands;
        binding.handle.requestUpdate();
        continue;
      }
      if (command.type === 'canvas-set-visible') {
        this.canvas(record, command.key).handle.setVisible(command.visible);
        continue;
      }
      if (command.type === 'panel-set') {
        renderUserIndicatorPanel(this.panel(record, command.key).root, command.content);
        continue;
      }
      if (command.type === 'debug-log') continue;
      throw new Error(`command ${command.type} is not allowed in update output`);
    }
  }

  private series(record: AdapterRecord, key: string): IndicatorSeriesHandle<IndicatorSeriesType> {
    const series = record.series.get(key);
    if (!series) throw new Error(`user indicator series ${JSON.stringify(key)} is not bound`);
    return series;
  }

  private pane(record: AdapterRecord, key: string): ReturnType<IndicatorPaneApi['get']> extends infer T ? Exclude<T, null> : never {
    const pane = key === 'main' ? record.panes.main : record.panes.get(key);
    if (!pane) throw new Error(`user indicator pane ${JSON.stringify(key)} is not bound`);
    return pane as never;
  }

  private marker(record: AdapterRecord, key: string): {
    contribution: IndicatorMarkerContribution;
    interactive: readonly UserIndicatorMarker[];
  } {
    const marker = record.markers.get(key);
    if (!marker) throw new Error(`user indicator marker contribution ${JSON.stringify(key)} is not bound`);
    return marker;
  }

  private barStyle(record: AdapterRecord, key: string): {
    contribution: IndicatorBarStyleContribution;
    styles: Map<number, IndicatorBarStyle>;
  } {
    const barStyle = record.barStyles.get(key);
    if (!barStyle) throw new Error(`user indicator bar style contribution ${JSON.stringify(key)} is not bound`);
    return barStyle;
  }


  private canvas(record: AdapterRecord, key: string): {
    handle: IndicatorCanvasLayerHandle;
    buffer: { commands: readonly UserIndicatorCanvasCommand[] };
  } {
    const canvas = record.canvases.get(key);
    if (!canvas) throw new Error(`user indicator canvas layer ${JSON.stringify(key)} is not bound`);
    return canvas;
  }

  private panel(record: AdapterRecord, key: string): IndicatorOverlayHandle {
    const panel = record.panels.get(key);
    if (!panel) throw new Error(`user indicator panel ${JSON.stringify(key)} is not bound`);
    return panel;
  }

  private assertEventMatches(callback: UserIndicatorCallbackOutput, event: Readonly<IndicatorDataEvent>): void {
    if (callback.phase !== 'update') throw new Error('expected update callback metadata');
    if (callback.reason !== event.reason
      || callback.changedFrom !== event.changedFrom
      || callback.barsLength !== event.bars.length) {
      throw new Error('user indicator output event metadata does not match the host event');
    }
  }
}
