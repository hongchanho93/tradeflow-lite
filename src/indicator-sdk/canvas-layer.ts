import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  PaneAttachedParameter,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type {
  IndicatorCanvasFrame,
  IndicatorCanvasLayerDefinition,
  IndicatorCanvasLayerHandle,
  IndicatorTheme,
} from './contracts';

type CanvasAnchor = ISeriesApi<SeriesType, Time> | null;

class CanvasRenderer implements IPrimitivePaneRenderer {
  private readonly owner: ManagedCanvasPrimitive;

  constructor(owner: ManagedCanvasPrimitive) {
    this.owner = owner;
  }

  draw(target: CanvasRenderingTarget2D): void {
    this.owner.draw(target);
  }
}

class CanvasView implements IPrimitivePaneView {
  private readonly rendererValue: CanvasRenderer;
  private order: PrimitivePaneViewZOrder;

  constructor(
    owner: ManagedCanvasPrimitive,
    order: PrimitivePaneViewZOrder,
  ) {
    this.order = order;
    this.rendererValue = new CanvasRenderer(owner);
  }

  zOrder(): PrimitivePaneViewZOrder {
    return this.order;
  }

  setOrder(order: PrimitivePaneViewZOrder): void {
    this.order = order;
  }

  renderer(): IPrimitivePaneRenderer {
    return this.rendererValue;
  }
}

export class ManagedCanvasPrimitive implements IndicatorCanvasLayerHandle {
  readonly key: string;
  private readonly chart: IChartApi;
  private readonly theme: () => IndicatorTheme;
  private readonly onError: (error: unknown) => void;
  private readonly view: CanvasView;
  private drawCallback: IndicatorCanvasLayerDefinition['draw'];
  private anchor: CanvasAnchor;
  private requestUpdateCallback: (() => void) | null = null;
  private visible = true;

  constructor(
    definition: IndicatorCanvasLayerDefinition,
    chart: IChartApi,
    anchor: CanvasAnchor,
    theme: () => IndicatorTheme,
    onError: (error: unknown) => void,
  ) {
    this.key = definition.key;
    this.chart = chart;
    this.anchor = anchor;
    this.theme = theme;
    this.onError = onError;
    this.drawCallback = definition.draw;
    this.view = new CanvasView(this, definition.zOrder ?? 'normal');
  }

  attached(parameters: PaneAttachedParameter<Time> | SeriesAttachedParameter<Time>): void {
    this.requestUpdateCallback = parameters.requestUpdate;
  }

  detached(): void {
    this.requestUpdateCallback = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  setDefinition(definition: IndicatorCanvasLayerDefinition, anchor: CanvasAnchor): void {
    this.drawCallback = definition.draw;
    this.anchor = anchor;
    this.view.setOrder(definition.zOrder ?? 'normal');
    this.requestUpdate();
  }

  clear(): void {
    this.drawCallback = () => {};
    this.requestUpdate();
  }

  requestUpdate(): void {
    this.requestUpdateCallback?.();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.requestUpdate();
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (!this.visible) return;
    let pixelRatio = 1;
    target.useBitmapCoordinateSpace((scope) => {
      pixelRatio = scope.horizontalPixelRatio;
    });
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const timeScale = this.chart.timeScale();
      const coordinates: IndicatorCanvasFrame['coordinates'] = {
        timeToX: (time) => timeScale.timeToCoordinate(time as UTCTimestamp),
        logicalToX: (logical) => timeScale.logicalToCoordinate(logical as never),
        xToLogical: (x) => timeScale.coordinateToLogical(x),
        ...(this.anchor ? {
          priceToY: (price: number) => this.anchor?.priceToCoordinate(price) ?? null,
          yToPrice: (y: number) => this.anchor?.coordinateToPrice(y) ?? null,
        } : {}),
      };
      const range = timeScale.getVisibleLogicalRange();
      const frame: IndicatorCanvasFrame = Object.freeze({
        context,
        width: mediaSize.width,
        height: mediaSize.height,
        pixelRatio,
        coordinates: Object.freeze(coordinates),
        visibleLogicalRange: range ? Object.freeze({ from: Number(range.from), to: Number(range.to) }) : null,
        theme: this.theme(),
        requestUpdate: () => this.requestUpdate(),
      });
      try {
        this.drawCallback(frame);
      } catch (error) {
        this.onError(error);
      }
    });
  }
}
