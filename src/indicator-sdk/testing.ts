import type {
  IndicatorBar,
  IndicatorBarStyle,
  IndicatorCanvasLayerDefinition,
  IndicatorContext,
  IndicatorDataSnapshot,
  IndicatorDataEvent,
  IndicatorDefinition,
  IndicatorInputSchema,
  IndicatorMarketCapabilities,
  IndicatorMarketStatus,
  IndicatorMarker,
  IndicatorDepthSnapshot,
  IndicatorOverlayDefinition,
  IndicatorSeriesDefinition,
  IndicatorSeriesPoint,
  IndicatorTheme,
  IndicatorTradeBatch,
  InferIndicatorInputs,
} from './contracts.ts';
import { normalizeIndicatorInputs } from './runtime.ts';

type TestSeries = {
  readonly definition: IndicatorSeriesDefinition;
  visible: boolean;
  points: IndicatorSeriesPoint[];
};

type TestOverlay = {
  readonly definition: IndicatorOverlayDefinition;
  readonly root: HTMLElement;
  visible: boolean;
  styles: string;
};

export type IndicatorTestHarness<S extends IndicatorInputSchema> = {
  readonly context: IndicatorContext;
  readonly inputs: Readonly<InferIndicatorInputs<S>>;
  update(event: IndicatorDataEvent): void;
  series(key: string): Readonly<TestSeries> | undefined;
  markers(key: string): readonly IndicatorMarker[];
  overlay(key: string): Readonly<TestOverlay> | undefined;
  canvas(key: string): IndicatorCanvasLayerDefinition | undefined;
  barStyle(key: string, bar: IndicatorBar, index: number): IndicatorBarStyle | null;
  emitDepth(depth: IndicatorDepthSnapshot): void;
  emitTrades(batch: IndicatorTradeBatch): void;
  emitStatus(status: IndicatorMarketStatus): void;
  dispose(): void;
};

export function createIndicatorTestHarness<const S extends IndicatorInputSchema>(
  definition: IndicatorDefinition<S>,
  options: {
    readonly inputs?: Readonly<Record<string, unknown>>;
    readonly selection?: Partial<IndicatorContext['selection']> & {
      readonly symbol?: Partial<IndicatorContext['selection']['symbol']>;
    };
    readonly instrument?: Partial<IndicatorContext['instrument']>;
    readonly theme?: IndicatorTheme;
    readonly data?: readonly IndicatorDataSnapshot[];
    readonly market?: {
      readonly capabilities?: IndicatorMarketCapabilities;
      readonly status?: IndicatorMarketStatus;
      readonly depth?: IndicatorDepthSnapshot | null;
    };
  } = {},
): IndicatorTestHarness<S> {
  const defaultSymbol: IndicatorContext['selection']['symbol'] = {
    symbol: 'SH:600000',
    code: '600000',
    name: '浦发银行',
    exchange: 'SH',
    providerId: 'tdx',
    providerDisplayName: 'TDX',
    venue: 'SH',
    kind: 'stock',
  };
  const selection: IndicatorContext['selection'] = Object.freeze({
    resolution: '1D',
    adjustment: 'none',
    seriesKind: 'ohlcv',
    marketKind: 'stock',
    providerId: 'tdx',
    ...options.selection,
    symbol: Object.freeze({ ...defaultSymbol, ...options.selection?.symbol }),
  }) as IndicatorContext['selection'];
  const instrument = Object.freeze({
    priceTick: 0.01,
    timeZone: 'Asia/Shanghai',
    tradingCalendar: 'XSHG' as const,
    ...options.instrument,
  });
  const inputs = normalizeIndicatorInputs(definition, options.inputs);
  const seriesValues = new Map<string, TestSeries>();
  const markerValues = new Map<string, readonly IndicatorMarker[]>();
  const overlays = new Map<string, TestOverlay>();
  const canvases = new Map<string, IndicatorCanvasLayerDefinition>();
  const barStyles = new Map<string, (bar: IndicatorBar, index: number) => IndicatorBarStyle | null>();
  const cleanups: Array<() => void> = [];
  const panes = new Map<string, { readonly key: string; getHeight(): number }>();
  const depthListeners = new Set<(depth: Readonly<IndicatorDepthSnapshot>) => void>();
  const tradeListeners = new Set<(batch: Readonly<IndicatorTradeBatch>) => void>();
  const statusListeners = new Set<(status: Readonly<IndicatorMarketStatus>) => void>();
  const marketCapabilities = options.market?.capabilities ?? {
    depth: { supported: false },
    trades: { supported: false, eventKinds: [] },
    historicalDepth: false as const,
    historicalTrades: false as const,
    orderByOrder: false as const,
  };
  let marketStatus = options.market?.status ?? { state: 'available' as const };
  let marketDepth = options.market?.depth ?? null;
  panes.set('main', { key: 'main', getHeight: () => 600 });

  const contextValue: IndicatorContext = {
    instanceId: 'test-instance',
    selection,
    instrument,
    data: {
      get: (key) => options.data?.find((snapshot) => snapshot.key === key) ?? null,
    },
    layers: {
      createSeries: (seriesDefinition) => {
        const output: TestSeries = { definition: seriesDefinition, visible: true, points: [] };
        seriesValues.set(seriesDefinition.key, output);
        return {
          key: seriesDefinition.key,
          type: seriesDefinition.type,
          pane: seriesDefinition.pane,
          setData(points) { output.points = [...points]; },
          update(point) {
            const existing = output.points.findIndex((candidate) => candidate.time === point.time);
            if (existing >= 0) output.points[existing] = point;
            else output.points.push(point);
          },
          setValues(event, values, valueOptions = {}) {
            output.points = values.map((value, index) => value === null
              ? { time: event.bars[index].time }
              : {
                  time: event.bars[index].time,
                  value,
                  ...(valueOptions.pointOptions?.(value, index, event.bars[index]) ?? {}),
                });
          },
          setVisible(visible) { output.visible = visible; },
        };
      },
      createCanvasLayer: (canvasDefinition) => {
        canvases.set(canvasDefinition.key, canvasDefinition);
        return {
          key: canvasDefinition.key,
          requestUpdate() {},
          setVisible() {},
        };
      },
      createOverlay: (overlayDefinition) => {
        const rootValue = {
          innerHTML: '',
          replaceChildren() { rootValue.innerHTML = ''; },
        };
        const root = rootValue as unknown as HTMLElement;
        const output: TestOverlay = {
          definition: overlayDefinition,
          root,
          visible: true,
          styles: '',
        };
        overlays.set(overlayDefinition.key, output);
        return {
          key: overlayDefinition.key,
          root,
          setStyles(styles) { output.styles = styles; },
          setVisible(visible) { output.visible = visible; },
        };
      },
    },
    panes: {
      main: panes.get('main')!,
      create(paneDefinition) {
        const pane = { key: paneDefinition.key, getHeight: () => paneDefinition.defaultHeight };
        panes.set(paneDefinition.key, pane);
        return pane;
      },
      get: (key) => panes.get(key) ?? null,
    },
    mainSeries: {
      createBarStyleContribution: (styleDefinition) => ({
        key: styleDefinition.key,
        setProvider(provider) { barStyles.set(styleDefinition.key, provider); },
        invalidateFrom() {},
      }),
      createMarkerContribution: (markerDefinition) => ({
        key: markerDefinition.key,
        set(markers) { markerValues.set(markerDefinition.key, [...markers]); },
      }),
    },
    market: {
      capabilities: () => marketCapabilities,
      status: () => marketStatus,
      getDepth: () => marketDepth,
      onDepth(callback) {
        depthListeners.add(callback);
        return { dispose: () => depthListeners.delete(callback) };
      },
      onTrades(callback) {
        tradeListeners.add(callback);
        return { dispose: () => tradeListeners.delete(callback) };
      },
      onStatus(callback) {
        statusListeners.add(callback);
        return { dispose: () => statusListeners.delete(callback) };
      },
    },
    events: {
      onCrosshairMove: () => ({ dispose() {} }),
      onClick: () => ({ dispose() {} }),
      onVisibleRangeChange: () => ({ dispose() {} }),
    },
    resources: {
      add(cleanup) {
        cleanups.push(cleanup);
        return { dispose: cleanup };
      },
      setTimeout(callback, delayMs) {
        const id = globalThis.setTimeout(callback, delayMs);
        const cleanup = () => globalThis.clearTimeout(id);
        cleanups.push(cleanup);
        return { dispose: cleanup };
      },
      setInterval(callback, delayMs) {
        const id = globalThis.setInterval(callback, delayMs);
        const cleanup = () => globalThis.clearInterval(id);
        cleanups.push(cleanup);
        return { dispose: cleanup };
      },
      requestAnimationFrame(callback) {
        const id = globalThis.setTimeout(() => callback(performance.now()), 0);
        const cleanup = () => globalThis.clearTimeout(id);
        cleanups.push(cleanup);
        return { dispose: cleanup };
      },
    },
  };
  const context = Object.freeze(contextValue);
  const instance = definition.create(context, inputs);

  return {
    context,
    inputs,
    update: (event) => instance.update(event),
    series: (key) => seriesValues.get(key),
    markers: (key) => markerValues.get(key) ?? [],
    overlay: (key) => overlays.get(key),
    canvas: (key) => canvases.get(key),
    barStyle: (key, bar, index) => barStyles.get(key)?.(bar, index) ?? null,
    emitDepth(depth) {
      marketDepth = depth;
      for (const listener of depthListeners) listener(depth);
    },
    emitTrades(batch) {
      for (const listener of tradeListeners) listener(batch);
    },
    emitStatus(status) {
      marketStatus = status;
      for (const listener of statusListeners) listener(status);
    },
    dispose() {
      instance.destroy?.();
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    },
  };
}
