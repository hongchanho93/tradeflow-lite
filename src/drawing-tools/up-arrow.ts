import type { Coordinate, IChartApiBase, IHorzScaleBehavior, ISeriesApi, SeriesType } from 'lightweight-charts';
import { LineStyle } from 'lightweight-charts';
import {
  AnchorPoint,
  BaseLineTool,
  CompositeRenderer,
  HitTestResult,
  LineCap,
  LineEnd,
  LineJoin,
  LineToolPaneView,
  PaneCursorType,
  PolygonRenderer,
  deepCopy,
  merge,
  type DeepPartial,
  type LineToolHitTestData,
  type IPriceAxisView,
  type ITimeAxisView,
  type LineToolOptionsCommon,
  type LineToolOptionsInternal,
  type LineToolPoint,
  type LineToolType,
  type LineToolsCorePlugin,
  type PriceAxisLabelStackingManager,
} from 'lightweight-charts-line-tools-core';

export type UpArrowOptions = LineToolOptionsCommon & {
  arrow: {
    color: string;
    opacity: number;
    size: number;
  };
};

const upArrowDefaults: UpArrowOptions = {
  visible: true,
  editable: true,
  showPriceAxisLabels: false,
  showTimeAxisLabels: false,
  priceAxisLabelAlwaysVisible: false,
  timeAxisLabelAlwaysVisible: false,
  defaultHoverCursor: PaneCursorType.Pointer,
  defaultDragCursor: PaneCursorType.Grabbing,
  defaultAnchorHoverCursor: PaneCursorType.Move,
  defaultAnchorDragCursor: PaneCursorType.Grabbing,
  notEditableCursor: PaneCursorType.NotAllowed,
  arrow: { color: '#089981', opacity: 1, size: 34 },
};

function colorWithOpacity(color: string, opacity: number): string {
  const alpha = Math.round(Math.max(0.05, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0');
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

export class LineToolUpArrowPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
  private readonly arrowRenderer = new PolygonRenderer<HorzScaleItem>();

  protected override _updateImpl(_height: number, _width: number): void {
    this._renderer.clear();
    const options = this._tool.options() as unknown as UpArrowOptions;
    if (!options.visible || !this._updatePoints() || this._points.length < 1) return;

    const anchor = this._points[0];
    const size = Math.max(16, Math.min(64, options.arrow.size));
    const halfHead = size * 0.55;
    const halfStem = size * 0.18;
    const shoulderY = anchor.y + size * 0.48;
    const baseY = anchor.y + size;
    const color = colorWithOpacity(options.arrow.color, options.arrow.opacity);
    const polygon = [
      new AnchorPoint(anchor.x, anchor.y, 0),
      new AnchorPoint(anchor.x + halfHead, shoulderY, 0),
      new AnchorPoint(anchor.x + halfStem, shoulderY, 0),
      new AnchorPoint(anchor.x + halfStem, baseY, 0),
      new AnchorPoint(anchor.x - halfStem, baseY, 0),
      new AnchorPoint(anchor.x - halfStem, shoulderY, 0),
      new AnchorPoint(anchor.x - halfHead, shoulderY, 0),
    ];

    this.arrowRenderer.setData({
      points: polygon,
      line: {
        color,
        width: 1,
        style: LineStyle.Solid,
        join: LineJoin.Miter,
        cap: LineCap.Butt,
        end: { left: LineEnd.Normal, right: LineEnd.Normal },
        extend: { left: false, right: false },
      },
      background: { color },
      hitTestBackground: true,
      enclosePerimeterWithLine: true,
      toolDefaultHoverCursor: options.defaultHoverCursor,
      toolDefaultDragCursor: options.defaultDragCursor,
    });
    this._renderer.append(this.arrowRenderer);
    if (this.areAnchorsVisible()) this._addAnchors(this._renderer);
  }

  protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
    if (this._points.length < 1) return;
    renderer.append(this.createLineAnchor({ points: [this._points[0]], defaultAnchorHoverCursor: PaneCursorType.Move }, 0));
  }
}

export class LineToolUpArrow<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
  public override readonly toolType = 'UpArrow' as LineToolType;
  public override readonly pointsCount = 1;

  public constructor(
    coreApi: LineToolsCorePlugin<HorzScaleItem>,
    chart: IChartApiBase<HorzScaleItem>,
    series: ISeriesApi<SeriesType, HorzScaleItem>,
    horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>,
    options: DeepPartial<UpArrowOptions> = {},
    points: LineToolPoint[] = [],
    priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>,
  ) {
    const finalOptions = deepCopy(upArrowDefaults);
    merge(finalOptions, options);
    super(
      coreApi,
      chart,
      series,
      horzScaleBehavior,
      finalOptions as unknown as LineToolOptionsInternal<LineToolType>,
      points,
      'UpArrow' as LineToolType,
      1,
      priceAxisLabelStackingManager,
    );
    this._setPaneViews([new LineToolUpArrowPaneView(this, chart, series)]);
  }

  public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {
    const renderer = this._paneViews[0]?.renderer() as CompositeRenderer<HorzScaleItem> | null | undefined;
    return renderer?.hitTest?.(x, y) ?? null;
  }

  public override maxAnchorIndex(): number {
    return 0;
  }

  public override priceAxisViews(): readonly IPriceAxisView[] {
    return [];
  }

  public override timeAxisViews(): readonly ITimeAxisView[] {
    return [];
  }

  public override setPoint(index: number, point: LineToolPoint): void {
    if (index !== 0) return;
    this._points[0] = point;
    this._triggerChartUpdate();
  }
}
