import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';

export type BollBandPoint = { time: UTCTimestamp; upper: number; lower: number };
type ScreenPoint = { x: number; upper: number; lower: number };

class BollingerBandRenderer implements IPrimitivePaneRenderer {
  private segments: ScreenPoint[][] = [];

  update(segments: ScreenPoint[][]) {
    this.segments = segments;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      context.fillStyle = 'rgba(156, 106, 222, 0.12)';
      for (const segment of this.segments) {
        if (segment.length < 2) continue;
        context.beginPath();
        context.moveTo(segment[0].x, segment[0].upper);
        for (let index = 1; index < segment.length; index += 1) {
          context.lineTo(segment[index].x, segment[index].upper);
        }
        for (let index = segment.length - 1; index >= 0; index -= 1) {
          context.lineTo(segment[index].x, segment[index].lower);
        }
        context.closePath();
        context.fill();
      }
      context.restore();
    });
  }
}

class BollingerBandView implements IPrimitivePaneView {
  private readonly rendererValue = new BollingerBandRenderer();

  constructor(private readonly source: BollingerBandPrimitive) {}

  update() {
    this.rendererValue.update(this.source.screenSegments());
  }

  zOrder() { return 'bottom' as const; }

  renderer() { return this.rendererValue; }
}

export class BollingerBandPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick', Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private points: BollBandPoint[] = [];
  private visible = false;
  private readonly view = new BollingerBandView(this);

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<'Candlestick', Time>;
    this.requestUpdate = param.requestUpdate;
    this.view.update();
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setData(points: BollBandPoint[], visible: boolean) {
    this.points = points;
    this.visible = visible;
    this.view.update();
    this.requestUpdate?.();
  }

  updateAllViews() {
    this.view.update();
  }

  paneViews() { return [this.view]; }

  screenSegments(): ScreenPoint[][] {
    if (!this.visible || !this.chart || !this.series) return [];
    const segments: ScreenPoint[][] = [];
    let segment: ScreenPoint[] = [];
    for (const point of this.points) {
      const x = this.chart.timeScale().timeToCoordinate(point.time);
      const upper = this.series.priceToCoordinate(point.upper);
      const lower = this.series.priceToCoordinate(point.lower);
      if (x === null || upper === null || lower === null) {
        if (segment.length > 1) segments.push(segment);
        segment = [];
        continue;
      }
      segment.push({ x, upper, lower });
    }
    if (segment.length > 1) segments.push(segment);
    return segments;
  }
}
