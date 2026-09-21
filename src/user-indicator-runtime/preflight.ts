import type { IndicatorBar, IndicatorDataEvent, TradeEventKind } from '../indicator-sdk/contracts.ts';
import type { UserIndicatorDataEvent } from './data-protocol.ts';
import { createUserIndicatorExecutionWorker } from './execution-worker-factory.ts';
import { UserIndicatorSupervisor, type UserIndicatorSupervisorFailure, type UserIndicatorWorkerFactory } from './supervisor.ts';
import { USER_INDICATOR_RUNTIME_LIMITS } from './limits.ts';
import type {
  UserIndicatorCanvasCommand,
  UserIndicatorOutputEnvelope,
  UserIndicatorSeriesPoint,
  UserIndicatorSeriesType,
} from './output-protocol.ts';

export type UserIndicatorSeriesDiagnostic = Readonly<{
  key: string;
  type: UserIndicatorSeriesType;
  points: number;
  ready: number;
  firstReadyTime?: number;
  lastReadyTime?: number;
  allEmpty: boolean;
}>;

export type UserIndicatorMarkerDiagnostic = Readonly<{
  key: string;
  points: number;
  firstTime?: number;
  lastTime?: number;
  allEmpty: boolean;
}>;

export type UserIndicatorBarStyleDiagnostic = Readonly<{
  key: string;
  points: number;
  firstTime?: number;
  lastTime?: number;
  allEmpty: boolean;
}>;

export type UserIndicatorLogDiagnostic = Readonly<{
  phase: 'create' | 'update' | 'pointer';
  message: string;
}>;

export type UserIndicatorCanvasDiagnostic = Readonly<{
  key: string;
  commands: number;
  allEmpty: boolean;
}>;

export type UserIndicatorPanelDiagnostic = Readonly<{
  key: string;
  columns: number;
  rows: number;
  cells: number;
  allEmpty: boolean;
}>;

export type UserIndicatorOutputDiagnostics = Readonly<{
  series: readonly UserIndicatorSeriesDiagnostic[];
  markers: readonly UserIndicatorMarkerDiagnostic[];
  barStyles: readonly UserIndicatorBarStyleDiagnostic[];
  canvases: readonly UserIndicatorCanvasDiagnostic[];
  panels: readonly UserIndicatorPanelDiagnostic[];
  logs: readonly UserIndicatorLogDiagnostic[];
  allSeriesEmpty: boolean;
  allOutputsEmpty: boolean;
}>;

export const USER_INDICATOR_PREFLIGHT_LIMITS = Object.freeze({
  dataRequests: USER_INDICATOR_RUNTIME_LIMITS.dataRequests,
  crossSymbolDataRequests: USER_INDICATOR_RUNTIME_LIMITS.crossSymbolDataRequests,
  crossSymbolDataSymbols: USER_INDICATOR_RUNTIME_LIMITS.crossSymbolDataSymbols,
  dataBarsPerRequest: USER_INDICATOR_RUNTIME_LIMITS.dataBarsPerRequest,
  depthLevelsPerSide: USER_INDICATOR_RUNTIME_LIMITS.depthLevelsPerSide,
  tradesPerCallback: USER_INDICATOR_RUNTIME_LIMITS.tradesPerCallback,
  quickJsHeapBytes: USER_INDICATOR_RUNTIME_LIMITS.quickJsHeapBytes,
  quickJsStackBytes: USER_INDICATOR_RUNTIME_LIMITS.quickJsStackBytes,
  panes: USER_INDICATOR_RUNTIME_LIMITS.panes,
  paneMinHeight: USER_INDICATOR_RUNTIME_LIMITS.paneMinHeight,
  paneMaxHeight: USER_INDICATOR_RUNTIME_LIMITS.paneMaxHeight,
  series: USER_INDICATOR_RUNTIME_LIMITS.series,
  seriesDataPointsPerCallback: USER_INDICATOR_RUNTIME_LIMITS.seriesDataPointsPerCallback,
  canvasLayers: USER_INDICATOR_RUNTIME_LIMITS.canvasLayers,
  panels: USER_INDICATOR_RUNTIME_LIMITS.panels,
  outboxCommandsPerCallback: USER_INDICATOR_RUNTIME_LIMITS.outboxCommandsPerCallback,
  markersPerCallback: USER_INDICATOR_RUNTIME_LIMITS.markersPerCallback,
  canvasCommandsPerCallback: USER_INDICATOR_RUNTIME_LIMITS.canvasCommandsPerCallback,
  canvasPointsPerCommand: USER_INDICATOR_RUNTIME_LIMITS.canvasPointsPerCommand,
  panelRows: USER_INDICATOR_RUNTIME_LIMITS.panelRows,
  panelCells: USER_INDICATOR_RUNTIME_LIMITS.panelCells,
  textFieldChars: USER_INDICATOR_RUNTIME_LIMITS.textFieldChars,
  callbackTextBytes: USER_INDICATOR_RUNTIME_LIMITS.callbackTextBytes,
  logEntriesPerCallback: USER_INDICATOR_RUNTIME_LIMITS.consoleEntriesPerCallback,
  logBytesPerCallback: USER_INDICATOR_RUNTIME_LIMITS.consoleBytesPerCallback,
  bulkOutputBytes: USER_INDICATOR_RUNTIME_LIMITS.bulkOutputBytes,
  realtimeOutputBytes: USER_INDICATOR_RUNTIME_LIMITS.realtimeOutputBytes,
  createVmMs: USER_INDICATOR_RUNTIME_LIMITS.createVmMs,
  createHardMs: USER_INDICATOR_RUNTIME_LIMITS.createHardMs,
  bulkUpdateVmMs: USER_INDICATOR_RUNTIME_LIMITS.bulkUpdateVmMs,
  bulkUpdateHardMs: USER_INDICATOR_RUNTIME_LIMITS.bulkUpdateHardMs,
  initialUpdateVmMs: USER_INDICATOR_RUNTIME_LIMITS.initialUpdateVmMs,
  initialUpdateHardMs: USER_INDICATOR_RUNTIME_LIMITS.initialUpdateHardMs,
  historyUpdateVmMs: USER_INDICATOR_RUNTIME_LIMITS.historyUpdateVmMs,
  historyUpdateHardMs: USER_INDICATOR_RUNTIME_LIMITS.historyUpdateHardMs,
  realtimeUpdateVmMs: USER_INDICATOR_RUNTIME_LIMITS.realtimeUpdateVmMs,
  realtimeUpdateHardMs: USER_INDICATOR_RUNTIME_LIMITS.realtimeUpdateHardMs,
  reconciliationUpdateVmMs: USER_INDICATOR_RUNTIME_LIMITS.reconciliationUpdateVmMs,
  reconciliationUpdateHardMs: USER_INDICATOR_RUNTIME_LIMITS.reconciliationUpdateHardMs,
});

export type UserIndicatorPreflightTiming = Readonly<{
  reason: IndicatorDataEvent['reason'];
  durationMs: number;
  budgetMs: number;
}>;

export type UserIndicatorPreflightPointerTiming = Readonly<{
  type: 'hover' | 'click' | 'leave';
  durationMs: number;
  budgetMs: number;
}>;

export type UserIndicatorPreflightRealtimeOptions = Readonly<{
  depth?: boolean;
  trades?: readonly TradeEventKind[];
}>;

const PREFLIGHT_REASONS = Object.freeze(['initial', 'history', 'realtime', 'reconciliation'] as const);

export type UserIndicatorPreflightResult = Readonly<
  | ({ valid: true; sampleRows: number; coveredReasons: readonly IndicatorDataEvent['reason'][]; timings: readonly UserIndicatorPreflightTiming[];
      coveredPointerTypes: readonly ('hover' | 'click' | 'leave')[]; pointerTimings: readonly UserIndicatorPreflightPointerTiming[] }
      & UserIndicatorOutputDiagnostics & { limits: typeof USER_INDICATOR_PREFLIGHT_LIMITS })
  | { valid: false; sampleRows: number; failurePhase: UserIndicatorSupervisorFailure['phase']; errorCode: string; failureDetail?: string;
      coveredReasons: readonly IndicatorDataEvent['reason'][]; timings: readonly UserIndicatorPreflightTiming[];
      coveredPointerTypes: readonly ('hover' | 'click' | 'leave')[]; pointerTimings: readonly UserIndicatorPreflightPointerTiming[];
      logs: readonly UserIndicatorLogDiagnostic[]; limits: typeof USER_INDICATOR_PREFLIGHT_LIMITS }
>;

type PreflightPointerTarget = Readonly<{ id: string; time: number | null; price: number | null; pane: 'main' }>;

function interactivePoint(command: UserIndicatorCanvasCommand): Readonly<{ time: number | null; price: number | null }> {
  const point = command.type === 'line' || command.type === 'rect'
    ? command.from
    : command.type === 'polyline' || command.type === 'polygon'
      ? command.points[0]
      : command.at;
  if (!point) return Object.freeze({ time: null, price: null });
  if (point.space === 'time-price') return Object.freeze({ time: point.time, price: point.price });
  if (point.space === 'time-pixel') return Object.freeze({ time: point.time, price: null });
  return Object.freeze({ time: null, price: null });
}

function findPreflightPointerTarget(outputs: readonly UserIndicatorOutputEnvelope[]): PreflightPointerTarget | null {
  const markerTargets = new Map<string, PreflightPointerTarget | null>();
  const canvasTargets = new Map<string, PreflightPointerTarget | null>();
  for (const output of outputs) {
    for (const callback of output.callbacks) {
      for (const command of callback.commands) {
        if (command.type === 'marker-set') {
          const marker = command.markers.find(item => item.hitTest === true && item.id);
          markerTargets.set(command.key, marker?.id ? Object.freeze({
            id: marker.id,
            time: marker.time,
            price: marker.price ?? null,
            pane: 'main' as const,
          }) : null);
        }
        if (command.type === 'canvas-set-commands') {
          const item = command.commands.find(candidate => candidate.hitTest === true && candidate.id);
          if (!item?.id) canvasTargets.set(command.key, null);
          else {
            const point = interactivePoint(item);
            canvasTargets.set(command.key, Object.freeze({ id: item.id, time: point.time, price: point.price, pane: 'main' as const }));
          }
        }
      }
    }
  }
  return [...markerTargets.values(), ...canvasTargets.values()].find((value): value is PreflightPointerTarget => value !== null) ?? null;
}

type SeriesState = {
  type: UserIndicatorSeriesType;
  points: Map<number, boolean>;
};

function pointReady(point: UserIndicatorSeriesPoint, type: UserIndicatorSeriesType): boolean {
  if (type === 'bar') return true;
  return 'value' in point && typeof point.value === 'number';
}

export function analyzeUserIndicatorSeriesOutput(
  output: UserIndicatorOutputEnvelope,
  event: Readonly<IndicatorDataEvent>,
): readonly UserIndicatorSeriesDiagnostic[] {
  return analyzeUserIndicatorOutput(output, event).series;
}

export function analyzeUserIndicatorOutput(
  output: UserIndicatorOutputEnvelope,
  event: Readonly<IndicatorDataEvent>,
): UserIndicatorOutputDiagnostics {
  const series = new Map<string, SeriesState>();
  const markers = new Map<string, readonly number[]>();
  const barStyles = new Map<string, readonly number[]>();
  const canvases = new Map<string, number>();
  const panels = new Map<string, Readonly<{ columns: number; rows: number; cells: number }>>();
  const logs: UserIndicatorLogDiagnostic[] = [];
  for (const callback of output.callbacks) {
    for (const command of callback.commands) {
      if (command.type === 'create-series') {
        series.set(command.key, { type: command.seriesType, points: new Map() });
        continue;
      }
      if (command.type === 'create-marker-contribution') {
        if (!markers.has(command.key)) markers.set(command.key, Object.freeze([]));
        continue;
      }
      if (command.type === 'create-bar-style-contribution') {
        if (!barStyles.has(command.key)) barStyles.set(command.key, Object.freeze([]));
        continue;
      }
      if (command.type === 'create-canvas-layer') {
        if (!canvases.has(command.key)) canvases.set(command.key, 0);
        continue;
      }
      if (command.type === 'create-panel') {
        if (!panels.has(command.key)) panels.set(command.key, Object.freeze({ columns: 0, rows: 0, cells: 0 }));
        continue;
      }
      if (command.type === 'marker-set') {
        markers.set(command.key, Object.freeze(command.markers.map(marker => marker.time).sort((a, b) => a - b)));
        continue;
      }
      if (command.type === 'bar-style-set') {
        barStyles.set(command.key, Object.freeze(command.styles.map(style => style.time)));
        continue;
      }
      if (command.type === 'debug-log') {
        logs.push(Object.freeze({ phase: callback.phase, message: command.message }));
        continue;
      }
      if (command.type === 'canvas-set-commands') {
        canvases.set(command.key, command.commands.length);
        continue;
      }
      if (command.type === 'panel-set') {
        panels.set(command.key, Object.freeze({
          columns: command.content.columns.length,
          rows: command.content.rows.length,
          cells: command.content.rows.reduce((sum, row) => sum + row.cells.length, 0),
        }));
        continue;
      }
      if (!('key' in command)) continue;
      const state = series.get(command.key);
      if (!state) continue;
      if (command.type === 'series-set-values') {
        state.points.clear();
        for (let index = 0; index < command.values.length && index < event.bars.length; index += 1) {
          state.points.set(event.bars[index].time, command.values[index] !== null);
        }
      } else if (command.type === 'series-set-data') {
        state.points.clear();
        for (const point of command.points) state.points.set(point.time, pointReady(point, state.type));
      } else if (command.type === 'series-update') {
        state.points.set(command.point.time, pointReady(command.point, state.type));
      }
    }
  }
  const seriesDiagnostics = Object.freeze([...series.entries()].map(([key, state]) => {
    const readyTimes = [...state.points.entries()].filter(([, ready]) => ready).map(([time]) => time).sort((a, b) => a - b);
    return Object.freeze({
      key,
      type: state.type,
      points: state.points.size,
      ready: readyTimes.length,
      ...(readyTimes.length ? { firstReadyTime: readyTimes[0], lastReadyTime: readyTimes.at(-1)! } : {}),
      allEmpty: state.points.size > 0 && readyTimes.length === 0,
    });
  }));
  const markerDiagnostics = Object.freeze([...markers.entries()].map(([key, times]) => Object.freeze({
    key,
    points: times.length,
    ...(times.length ? { firstTime: times[0], lastTime: times.at(-1)! } : {}),
    allEmpty: times.length === 0,
  })));
  const barStyleDiagnostics = Object.freeze([...barStyles.entries()].map(([key, times]) => Object.freeze({
    key,
    points: times.length,
    ...(times.length ? { firstTime: times[0], lastTime: times.at(-1)! } : {}),
    allEmpty: times.length === 0,
  })));
  const canvasDiagnostics = Object.freeze([...canvases.entries()].map(([key, commands]) => Object.freeze({
    key, commands, allEmpty: commands === 0,
  })));
  const panelDiagnostics = Object.freeze([...panels.entries()].map(([key, value]) => Object.freeze({
    key, ...value, allEmpty: value.columns === 0 && value.rows === 0 && value.cells === 0,
  })));
  const allSeriesEmpty = seriesDiagnostics.length > 0 && seriesDiagnostics.every(item => item.allEmpty);
  const allOutputsEmpty = !seriesDiagnostics.some(item => item.ready > 0)
    && !markerDiagnostics.some(item => item.points > 0)
    && !barStyleDiagnostics.some(item => item.points > 0)
    && !canvasDiagnostics.some(item => item.commands > 0)
    && !panelDiagnostics.some(item => item.columns > 0 || item.rows > 0 || item.cells > 0);
  return Object.freeze({
    series: seriesDiagnostics,
    markers: markerDiagnostics,
    barStyles: barStyleDiagnostics,
    canvases: canvasDiagnostics,
    panels: panelDiagnostics,
    logs: Object.freeze(logs),
    allSeriesEmpty,
    allOutputsEmpty,
  });
}

function collectUserIndicatorLogs(outputs: readonly UserIndicatorOutputEnvelope[]): readonly UserIndicatorLogDiagnostic[] {
  const logs: UserIndicatorLogDiagnostic[] = [];
  for (const output of outputs) {
    for (const callback of output.callbacks) {
      for (const command of callback.commands) {
        if (command.type === 'debug-log') {
          logs.push(Object.freeze({ phase: callback.phase, message: command.message }));
        }
      }
    }
  }
  return Object.freeze(logs);
}

function safeFailureDetail(message: string): string {
  return message
    .replace(/file:\/\/[^\s)]+/gi, '[path]')
    .replace(/\/(?:Users|home|private|var|tmp)\/[^\s:)]+/g, '[path]')
    .replace(/[A-Za-z]:\\[^\s:)]+/g, '[path]')
    .slice(0, 512);
}

export async function testUserIndicatorSourceIsolated(
  source: string,
  inputs: Readonly<Record<string, unknown>>,
  context: Readonly<Record<string, unknown>>,
  bars: readonly IndicatorBar[],
  signal: AbortSignal,
  workerFactory: UserIndicatorWorkerFactory = createUserIndicatorExecutionWorker,
  realtimeOptions: UserIndicatorPreflightRealtimeOptions = {},
): Promise<UserIndicatorPreflightResult> {
  if (signal.aborted) throw new Error('user_indicator_preflight_cancelled');
  const sample = Object.freeze(bars.map(bar => Object.freeze({ ...bar })));
  const selection = context.selection && typeof context.selection === 'object'
    ? context.selection as { providerId?: unknown; symbol?: unknown }
    : {};
  const providerId = typeof selection.providerId === 'string' ? selection.providerId : 'preflight';
  const symbol = typeof selection.symbol === 'string' ? selection.symbol : 'TEST:SYMBOL';
  const makeEvent = (reason: IndicatorDataEvent['reason']): UserIndicatorDataEvent => {
    const last = sample.at(-1);
    const capturedAtMs = last ? last.time * 1_000 : Date.now();
    const depth = reason === 'realtime' && realtimeOptions.depth && last ? Object.freeze({
      source: 'preflight-synthetic' as const,
      providerId,
      symbol,
      receivedTimeMs: capturedAtMs,
      capturedAtMs,
      coverage: 'current-snapshot' as const,
      bids: Object.freeze([Object.freeze({ price: last.close, quantity: 1 })]),
      asks: Object.freeze([Object.freeze({ price: last.close, quantity: 1 })]),
    }) : undefined;
    const tradeKind = realtimeOptions.trades?.[0];
    const trades = reason === 'realtime' && tradeKind && last ? Object.freeze({
      source: 'preflight-synthetic' as const,
      events: Object.freeze([Object.freeze({
        providerId,
        symbol,
        eventKind: tradeKind,
        receivedTimeMs: capturedAtMs,
        barTime: last.time,
        price: last.close,
        quantity: 1,
        quantityKnown: true,
        aggressorSide: 'buy' as const,
      })]),
      capturedAtMs,
      coverage: 'since-last-callback' as const,
      streamEpoch: 'preflight',
      subscriptionStartedAtMs: capturedAtMs,
      completeSinceSubscriptionStart: true,
      droppedSinceSubscriptionStart: 0,
      droppedByCallbackBudget: 0,
      truncated: false,
    }) : undefined;
    const marketStatus = reason === 'realtime' && (realtimeOptions.depth || tradeKind)
      ? Object.freeze({ state: 'available' as const })
      : undefined;
    return Object.freeze({
      reason,
      bars: sample,
      changedFrom: reason === 'realtime' ? Math.max(0, sample.length - 1) : 0,
      ...(reason === 'realtime' && last ? {
        realtimeUpdates: Object.freeze([Object.freeze({
          barTime: last.time,
          closed: false as const,
          eventTimeMs: capturedAtMs,
        })]),
      } : {}),
      ...(depth === undefined ? {} : { depth }),
      ...(trades === undefined ? {} : { trades }),
      ...(marketStatus === undefined ? {} : { marketStatus }),
    });
  };
  const event = makeEvent('initial');
  const instanceId = `ai-preflight-${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    let supervisor!: UserIndicatorSupervisor;
    const attempted: IndicatorDataEvent['reason'][] = ['initial'];
    const outputs: UserIndicatorOutputEnvelope[] = [];
    const timings: UserIndicatorPreflightTiming[] = [];
    const pointerTypes = Object.freeze(['hover', 'click', 'leave'] as const);
    const coveredPointerTypes: ('hover' | 'click' | 'leave')[] = [];
    const pointerTimings: UserIndicatorPreflightPointerTiming[] = [];
    let pointerTarget: PreflightPointerTarget | null = null;
    let pointerIndex = 0;
    let pointerEnabled = false;
    const cleanup = () => { signal.removeEventListener('abort', onAbort); supervisor.destroy(); };
    const finish = (result: UserIndicatorPreflightResult) => {
      if (settled) return; settled = true; cleanup(); resolve(result);
    };
    const onAbort = () => {
      if (settled) return; settled = true; cleanup(); reject(new Error('user_indicator_preflight_cancelled'));
    };
    const finishSuccess = (outputEvent: Readonly<UserIndicatorDataEvent>) => {
      const combined = Object.freeze({ callbacks: Object.freeze(outputs.flatMap(item => item.callbacks)) });
      const diagnostics = analyzeUserIndicatorOutput(combined, outputEvent);
      finish({ valid: true, sampleRows: sample.length, coveredReasons: Object.freeze([...attempted]),
        timings: Object.freeze([...timings]), coveredPointerTypes: Object.freeze([...coveredPointerTypes]),
        pointerTimings: Object.freeze([...pointerTimings]), ...diagnostics, limits: USER_INDICATOR_PREFLIGHT_LIMITS });
    };
    supervisor = new UserIndicatorSupervisor({
      workerFactory,
      onOutput: (response, outputEvent) => {
        outputs.push(response.output);
        if (response.phase === 'pointer') {
          const callback = response.output.callbacks[0];
          if (callback?.phase === 'pointer') coveredPointerTypes.push(callback.pointerType);
          if (response.timing?.reason === 'pointer' && callback?.phase === 'pointer') {
            pointerTimings.push(Object.freeze({
              type: callback.pointerType,
              durationMs: response.timing.durationMs,
              budgetMs: response.timing.budgetMs,
            }));
          }
          pointerIndex += 1;
          if (pointerTarget && pointerIndex < pointerTypes.length) {
            const type = pointerTypes[pointerIndex];
            queueMicrotask(() => { if (!settled && pointerTarget) supervisor.pointer(instanceId, Object.freeze({ type, ...pointerTarget })); });
            return;
          }
          finishSuccess(outputEvent);
          return;
        }
        if (response.phase === 'create') pointerEnabled = response.pointerEnabled === true;
        if (response.timing) {
          timings.push(Object.freeze({
            reason: response.timing.reason as IndicatorDataEvent['reason'],
            durationMs: response.timing.durationMs,
            budgetMs: response.timing.budgetMs,
          }));
        }
        const index = PREFLIGHT_REASONS.indexOf(outputEvent.reason);
        if (index >= 0 && index < PREFLIGHT_REASONS.length - 1) {
          const nextReason = PREFLIGHT_REASONS[index + 1];
          attempted.push(nextReason);
          queueMicrotask(() => { if (!settled) supervisor.update(instanceId, makeEvent(nextReason)); });
          return;
        }
        pointerTarget = findPreflightPointerTarget(outputs);
        if (pointerTarget && pointerEnabled) {
          const type = pointerTypes[0];
          queueMicrotask(() => { if (!settled && pointerTarget) supervisor.pointer(instanceId, Object.freeze({ type, ...pointerTarget })); });
          return;
        }
        finishSuccess(outputEvent);
      },
      onFailure: failure => finish({ valid: false, sampleRows: sample.length,
        failurePhase: failure.phase, errorCode: failure.code,
        failureDetail: safeFailureDetail(failure.message), coveredReasons: Object.freeze([...attempted]),
        timings: Object.freeze([...timings]),
        coveredPointerTypes: Object.freeze([...coveredPointerTypes]),
        pointerTimings: Object.freeze([...pointerTimings]),
        logs: Object.freeze([
          ...collectUserIndicatorLogs(outputs),
          ...(failure.logs ?? []).map(item => Object.freeze({ phase: item.phase, message: item.message })),
        ]),
        limits: USER_INDICATOR_PREFLIGHT_LIMITS }),
    });
    signal.addEventListener('abort', onAbort, { once: true });
    try { supervisor.create(instanceId, source, inputs, context, event); }
    catch (error) { if (!settled) { settled = true; cleanup(); reject(error); } }
  });
}
