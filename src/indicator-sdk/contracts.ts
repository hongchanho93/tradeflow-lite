import type { MarketSymbol, MarketSymbolKind } from '../market-universe';
import type { Resolution } from '../chart-time-controls';
import type { DeepPartial, SeriesOptionsMap } from 'lightweight-charts';

export type { MarketSymbolKind } from '../market-universe';
export type { Resolution } from '../chart-time-controls';

/** SDK contract version. Plugin versions are tracked separately below. */
export const INDICATOR_API_VERSION = 1 as const;
export const SUPPORTED_INDICATOR_API_VERSION = INDICATOR_API_VERSION;

export type LocalizedText =
  | string
  | { readonly 'zh-CN': string; readonly 'en-US': string };

export type IndicatorSymbol = MarketSymbol;
export type IndicatorTheme = 'dark' | 'light';

export interface IndicatorInstrumentMetadata {
  readonly priceTick: number | null;
  readonly timeZone: string;
  readonly tradingCalendar: 'XSHG' | 'XSHE' | 'XBSE' | '24/7' | null;
}

export interface Disposable {
  dispose(): void;
}

export type SelectOption<V extends string = string> = {
  readonly value: V;
  readonly label: LocalizedText;
};

export type IndicatorInputCondition = {
  readonly field: string;
  readonly equals: string | number | boolean;
};

type IndicatorInputPresentation = {
  readonly group?: LocalizedText;
  readonly inline?: string;
  readonly tooltip?: LocalizedText;
  readonly activeWhen?: IndicatorInputCondition;
};

export type IndicatorInputDefinition = (
  | {
      readonly type: 'number';
      readonly title: LocalizedText;
      readonly default: number;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
    }
  | {
      readonly type: 'boolean';
      readonly title: LocalizedText;
      readonly default: boolean;
    }
  | {
      readonly type: 'color';
      readonly title: LocalizedText;
      readonly default: string;
    }
  | {
      readonly type: 'text';
      readonly title: LocalizedText;
      readonly default: string;
      readonly maxLength?: number;
    }
  | {
      readonly type: 'select';
      readonly title: LocalizedText;
      readonly default: string;
      readonly options: readonly SelectOption[];
    }) & IndicatorInputPresentation;

export type IndicatorInputSchema = Readonly<Record<string, IndicatorInputDefinition>>;

export type InferIndicatorInputValue<D> =
  D extends { readonly type: 'number' } ? number :
  D extends { readonly type: 'boolean' } ? boolean :
  D extends { readonly type: 'select'; readonly options: readonly SelectOption<infer V>[] } ? V :
  D extends { readonly type: 'color' | 'text' } ? string :
  never;

export type InferIndicatorInputs<S extends IndicatorInputSchema> = {
  readonly [K in keyof S]: InferIndicatorInputValue<S[K]>;
};

export type IndicatorSeriesType = 'line' | 'histogram' | 'area' | 'baseline' | 'bar';
export type IndicatorPaneKey = string;

type LightweightSeriesType<T extends IndicatorSeriesType> =
  T extends 'line' ? 'Line' :
  T extends 'histogram' ? 'Histogram' :
  T extends 'area' ? 'Area' :
  T extends 'baseline' ? 'Baseline' :
  'Bar';

export type IndicatorSeriesOptions<T extends IndicatorSeriesType> =
  DeepPartial<SeriesOptionsMap[LightweightSeriesType<T>]>;

export interface IndicatorBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly amount?: number;
}

export interface IndicatorDataEvent {
  readonly reason: 'initial' | 'history' | 'realtime' | 'reconciliation';
  readonly bars: readonly IndicatorBar[];
  readonly changedFrom: number;
  readonly realtimeUpdates?: readonly IndicatorRealtimeBarUpdate[];
}

export interface IndicatorDataRequest {
  readonly key: string;
  readonly resolution: Resolution;
  readonly count?: number;
  readonly adjustment?: 'current' | 'none' | 'qfq';
}

export interface IndicatorDataSnapshot {
  readonly key: string;
  readonly resolution: Resolution;
  readonly adjustment: 'none' | 'qfq';
  readonly bars: readonly IndicatorBar[];
  readonly capturedAtMs: number;
}

export interface IndicatorDataApi {
  get(key: string): Readonly<IndicatorDataSnapshot> | null;
}

export type IndicatorRealtimeBarUpdate =
  | {
      readonly barTime: number;
      readonly closed: false;
      readonly eventTimeMs?: number;
    }
  | {
      readonly barTime: number;
      readonly closed: true;
      readonly closedBy: 'exchange' | 'newer-bar' | 'session-end';
      readonly eventTimeMs?: number;
    };

export type IndicatorSeriesPoint =
  | {
      readonly time: number;
      readonly value?: number;
      readonly color?: string;
    }
  | {
      readonly time: number;
      readonly open: number;
      readonly high: number;
      readonly low: number;
      readonly close: number;
      readonly color?: string;
    };

export type IndicatorSeriesPointOptions = {
  readonly color?: string;
};

export interface IndicatorSeriesValuesOptions<T extends IndicatorSeriesType = IndicatorSeriesType> {
  readonly dirtyFrom?: number;
  readonly pointOptions?: (
    value: number,
    index: number,
    bar: IndicatorBar,
  ) => IndicatorSeriesPointOptions | null | undefined;
  readonly seriesType?: T;
}

export interface IndicatorSeriesDefinition<T extends IndicatorSeriesType = IndicatorSeriesType> {
  readonly key: string;
  readonly type: T;
  readonly pane: 'main' | IndicatorPaneKey;
  readonly options?: Readonly<IndicatorSeriesOptions<T>>;
}

export interface IndicatorSeriesHandle<T extends IndicatorSeriesType = IndicatorSeriesType> {
  readonly key: string;
  readonly type: T;
  readonly pane: 'main' | IndicatorPaneKey;
  setData(points: readonly IndicatorSeriesPoint[]): void;
  update(point: IndicatorSeriesPoint): void;
  setValues(
    event: IndicatorDataEvent,
    values: readonly (number | null)[],
    options?: IndicatorSeriesValuesOptions<T>,
  ): void;
  setVisible(visible: boolean): void;
}

/** Backward-compatible name used by the design document. */
export type SeriesHandle<T extends IndicatorSeriesType = IndicatorSeriesType> = IndicatorSeriesHandle<T>;

export interface IndicatorCanvasCoordinates {
  timeToX(time: number): number | null;
  logicalToX(logical: number): number | null;
  xToLogical(x: number): number | null;
  priceToY?(price: number): number | null;
  yToPrice?(y: number): number | null;
}

export interface IndicatorCanvasFrame {
  readonly context: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly coordinates: IndicatorCanvasCoordinates;
  readonly visibleLogicalRange: Readonly<{ from: number; to: number }> | null;
  readonly theme: IndicatorTheme;
  requestUpdate(): void;
}

export type IndicatorCanvasTarget =
  | { readonly type: 'pane'; readonly pane: IndicatorPaneHandle }
  | { readonly type: 'series'; readonly series: IndicatorSeriesHandle }
  | { readonly type: 'current-main-series' };

export interface IndicatorCanvasLayerDefinition {
  readonly key: string;
  readonly target: IndicatorCanvasTarget;
  readonly zOrder?: 'bottom' | 'normal' | 'top';
  draw(frame: IndicatorCanvasFrame): void;
}

export interface IndicatorCanvasLayerHandle {
  readonly key: string;
  requestUpdate(): void;
  setVisible(visible: boolean): void;
}

export interface IndicatorOverlayDefinition {
  readonly key: string;
  readonly paneKey: IndicatorPaneKey;
  readonly position: 'top-left' | 'top-right' | 'middle-left' | 'middle-right' | 'bottom-left' | 'bottom-right';
  readonly interactive?: boolean;
}

export interface IndicatorOverlayHandle {
  readonly key: string;
  readonly root: HTMLElement;
  setStyles(cssText: string): void;
  setVisible(visible: boolean): void;
}

export interface IndicatorLayers {
  createSeries<T extends IndicatorSeriesType>(
    definition: IndicatorSeriesDefinition<T>,
  ): IndicatorSeriesHandle<T>;
  createCanvasLayer(definition: IndicatorCanvasLayerDefinition): IndicatorCanvasLayerHandle;
  createOverlay(definition: IndicatorOverlayDefinition): IndicatorOverlayHandle;
}

export interface IndicatorPaneHandle {
  readonly key: IndicatorPaneKey;
  getHeight(): number;
}

export interface IndicatorPaneDefinition {
  readonly key: IndicatorPaneKey;
  readonly defaultHeight: number;
}

export interface IndicatorPaneApi {
  readonly main: IndicatorPaneHandle;
  create(definition: IndicatorPaneDefinition): IndicatorPaneHandle;
  get(key: IndicatorPaneKey): IndicatorPaneHandle | null;
}

export interface IndicatorBarStyle {
  readonly color?: string;
  readonly borderColor?: string;
  readonly wickColor?: string;
}

export interface IndicatorBarStyleContribution {
  readonly key: string;
  setProvider(provider: (bar: IndicatorBar, index: number) => IndicatorBarStyle | null): void;
  invalidateFrom(changedFrom: number): void;
}

export type IndicatorMarkerBarPosition = 'aboveBar' | 'belowBar' | 'inBar';
export type IndicatorMarkerPricePosition = 'atPriceTop' | 'atPriceBottom' | 'atPriceMiddle';
export type IndicatorMarkerPosition = IndicatorMarkerBarPosition | IndicatorMarkerPricePosition;
export type IndicatorMarkerShape = 'circle' | 'square' | 'arrowUp' | 'arrowDown';

type IndicatorMarkerBase = {
  readonly time: number;
  readonly shape: IndicatorMarkerShape;
  readonly color: string;
  readonly id?: string;
  readonly text?: string;
  readonly textColor?: string;
  readonly tooltip?: string;
  readonly size?: number;
};

export type IndicatorMarker = IndicatorMarkerBase & (
  | { readonly position: IndicatorMarkerBarPosition; readonly price?: number }
  | { readonly position: IndicatorMarkerPricePosition; readonly price: number }
);

export interface IndicatorMarkerContribution {
  readonly key: string;
  set(markers: readonly IndicatorMarker[]): void;
}

export interface IndicatorMainSeriesApi {
  createBarStyleContribution(definition: {
    readonly key: string;
    readonly priority: number;
    readonly chartKinds: readonly ChartKind[];
  }): IndicatorBarStyleContribution;
  createMarkerContribution(definition: {
    readonly key: string;
    readonly priority: number;
    readonly chartKinds: readonly ChartKind[];
  }): IndicatorMarkerContribution;
}

export type ChartKind = 'candles' | 'bars' | 'line' | 'area' | 'baseline';

export interface IndicatorCrosshairEvent {
  readonly time: number | null;
}

export interface IndicatorClickEvent {
  readonly time: number | null;
  readonly x: number;
  readonly y: number;
}

export interface IndicatorVisibleRangeEvent {
  readonly from: number | null;
  readonly to: number | null;
}

export type CrosshairCallback = (event: IndicatorCrosshairEvent) => void;
export type ChartClickCallback = (event: IndicatorClickEvent) => void;
export type VisibleRangeCallback = (event: IndicatorVisibleRangeEvent) => void;

export interface IndicatorEventApi {
  onCrosshairMove(callback: CrosshairCallback): Disposable;
  onClick(callback: ChartClickCallback): Disposable;
  onVisibleRangeChange(callback: VisibleRangeCallback): Disposable;
}

export interface IndicatorResourceApi {
  add(cleanup: () => void): Disposable;
  setTimeout(callback: () => void, delayMs: number): Disposable;
  setInterval(callback: () => void, delayMs: number): Disposable;
  requestAnimationFrame(callback: (time: number) => void): Disposable;
}

export interface IndicatorDepthLevel {
  readonly price: number;
  readonly quantity: number;
}

export interface IndicatorDepthSnapshot {
  readonly providerId: string;
  readonly symbol: string;
  readonly exchangeTimeMs?: number;
  readonly receivedTimeMs: number;
  readonly sequence?: number | null;
  readonly bids: readonly IndicatorDepthLevel[];
  readonly asks: readonly IndicatorDepthLevel[];
}

export type TradeEventKind = 'trade' | 'aggregate-trade';

export interface IndicatorTrade {
  readonly providerId: string;
  readonly symbol: string;
  readonly eventKind: TradeEventKind;
  readonly tradeId?: number;
  readonly firstTradeId?: number;
  readonly lastTradeId?: number;
  readonly exchangeTimeMs?: number;
  readonly receivedTimeMs: number;
  readonly barTime: number;
  readonly price: number;
  readonly quantity?: number;
  readonly quantityKnown: boolean;
  readonly aggressorSide?: 'buy' | 'sell' | null;
  readonly flags?: number | null;
}

export interface IndicatorTradeBatch {
  readonly events: readonly IndicatorTrade[];
  readonly streamEpoch: string;
  readonly subscriptionId: string;
  readonly subscriptionStartedAtMs: number;
  readonly completeSinceSubscriptionStart: boolean;
  readonly droppedSinceSubscriptionStart: number;
  readonly resetReason?: 'initial' | 'buffer-overflow' | 'sequence-gap' | 'source-reset';
}

export interface IndicatorMarketCapabilities {
  readonly depth: { readonly supported: boolean };
  readonly trades: {
    readonly supported: boolean;
    readonly eventKinds: readonly TradeEventKind[];
  };
  readonly historicalDepth: false;
  readonly historicalTrades: false;
  readonly orderByOrder: false;
}

export interface IndicatorMarketStatus {
  readonly state: 'connecting' | 'available' | 'disconnected' | 'degraded';
  readonly reason?: string;
}

export interface IndicatorMarketData {
  capabilities(): Readonly<IndicatorMarketCapabilities>;
  status(): Readonly<IndicatorMarketStatus>;
  getDepth(): Readonly<IndicatorDepthSnapshot> | null;
  onDepth(callback: (depth: Readonly<IndicatorDepthSnapshot>) => void): Disposable;
  onTrades(callback: (batch: Readonly<IndicatorTradeBatch>) => void): Disposable;
  onStatus(callback: (status: Readonly<IndicatorMarketStatus>) => void): Disposable;
}

export interface IndicatorApplicability {
  readonly seriesKinds: readonly ['ohlcv'];
  readonly marketKinds?: readonly Exclude<MarketSymbolKind, 'prediction'>[];
  readonly requires?: {
    readonly depth?: boolean;
    readonly trades?: readonly TradeEventKind[];
  };
}

export interface IndicatorContext {
  readonly instanceId: string;
  readonly instrument: IndicatorInstrumentMetadata;
  readonly selection: Readonly<{
    readonly symbol: IndicatorSymbol;
    readonly resolution: Resolution;
    readonly adjustment: 'none' | 'qfq';
    readonly seriesKind: 'ohlcv';
    readonly marketKind: MarketSymbolKind;
    readonly providerId: string;
  }>;
  readonly layers: IndicatorLayers;
  readonly panes: IndicatorPaneApi;
  readonly mainSeries: IndicatorMainSeriesApi;
  readonly data: IndicatorDataApi;
  readonly market: IndicatorMarketData;
  readonly events: IndicatorEventApi;
  readonly resources: IndicatorResourceApi;
}

export interface IndicatorInstance {
  update(event: IndicatorDataEvent): void;
  onVisibilityChange?(visible: boolean): void;
  onThemeChange?(theme: IndicatorTheme): void;
  destroy?(): void;
}

export interface IndicatorDefinition<S extends IndicatorInputSchema = IndicatorInputSchema> {
  readonly apiVersion: typeof INDICATOR_API_VERSION;
  readonly id: string;
  readonly indicatorVersion: number;
  readonly name: LocalizedText;
  readonly description?: LocalizedText;
  readonly author?: string;
  readonly supports: IndicatorApplicability;
  readonly inputs: S;
  dataRequests?(
    inputs: InferIndicatorInputs<S>,
    selection: IndicatorContext['selection'],
  ): readonly IndicatorDataRequest[];
  migrateInputs?(
    previous: Readonly<Record<string, unknown>>,
    fromIndicatorVersion: number,
  ): Partial<InferIndicatorInputs<S>>;
  create(
    context: IndicatorContext,
    inputs: InferIndicatorInputs<S>,
  ): IndicatorInstance;
}

export interface SavedIndicatorState {
  readonly instanceId: string;
  readonly indicatorId: string;
  readonly indicatorVersion: number;
  /** Missing means legacy/trusted. Runtime user indicators must persist `user`. */
  readonly runtimeKind?: 'trusted' | 'user';
  /** Required only when runtimeKind is `user`; identifies the exact imported source. */
  readonly sourceHash?: string;
  readonly visible: boolean;
  readonly menuOrder: number;
  readonly panes: readonly {
    readonly key: string;
    readonly renderOrder: number;
    readonly height: number;
  }[];
  readonly inputs: Readonly<Record<string, unknown>>;
}

export type SavedUserIndicatorState = SavedIndicatorState & Readonly<{
  runtimeKind: 'user';
  sourceHash: string;
}>;

export type SavedMainOverlayOrderEntry =
  | { readonly type: 'volume' }
  | { readonly type: 'indicator'; readonly instanceId: string };

export interface SavedIndicatorEnvelope {
  readonly schemaVersion: number;
  readonly instances: readonly unknown[];
  readonly mainOverlayOrder: readonly SavedMainOverlayOrderEntry[];
}
