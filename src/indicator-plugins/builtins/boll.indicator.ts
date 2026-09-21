import { boll, bollBreakouts } from '../../indicators';
import { defineIndicator } from '../../indicator-sdk/define-indicator';
import type { IndicatorMarker } from '../../indicator-sdk/contracts';

const upperColor = '#f6c344';
const lowerColor = '#2962ff';

export default defineIndicator({
  id: 'builtin.boll',
  apiVersion: 1,
  indicatorVersion: 1,
  name: 'BOLL',
  description: { 'zh-CN': '布林带', 'en-US': 'Bollinger Bands' },
  supports: { seriesKinds: ['ohlcv'] },
  inputs: {
    period: { type: 'number', title: '周期', default: 20, min: 1, max: 500, step: 1 },
    multiplier: { type: 'number', title: '标准差倍数', default: 2, min: 0.1, max: 20, step: 0.1 },
  },
  create(context, inputs) {
    const upper = context.layers.createSeries({ key: 'upper', type: 'line', pane: 'main', options: { color: '#9c6ade', lineWidth: 1, priceLineVisible: false, lastValueVisible: false } });
    const middle = context.layers.createSeries({ key: 'middle', type: 'line', pane: 'main', options: { color: '#787b86', lineWidth: 1, priceLineVisible: false, lastValueVisible: false } });
    const lower = context.layers.createSeries({ key: 'lower', type: 'line', pane: 'main', options: { color: '#9c6ade', lineWidth: 1, priceLineVisible: false, lastValueVisible: false } });
    let bandPoints: Array<{ time: number; upper: number; lower: number }> = [];
    const band = context.layers.createCanvasLayer({
      key: 'band',
      target: { type: 'current-main-series' },
      zOrder: 'bottom',
      draw(frame) {
        const segments: Array<Array<{ x: number; upper: number; lower: number }>> = [];
        let segment: Array<{ x: number; upper: number; lower: number }> = [];
        for (const point of bandPoints) {
          const x = frame.coordinates.timeToX(point.time);
          const top = frame.coordinates.priceToY?.(point.upper) ?? null;
          const bottom = frame.coordinates.priceToY?.(point.lower) ?? null;
          if (x === null || top === null || bottom === null) {
            if (segment.length > 1) segments.push(segment);
            segment = [];
          } else {
            segment.push({ x, upper: top, lower: bottom });
          }
        }
        if (segment.length > 1) segments.push(segment);
        frame.context.save();
        frame.context.fillStyle = 'rgba(156, 106, 222, 0.12)';
        for (const points of segments) {
          frame.context.beginPath();
          frame.context.moveTo(points[0].x, points[0].upper);
          for (const point of points.slice(1)) frame.context.lineTo(point.x, point.upper);
          for (const point of [...points].reverse()) frame.context.lineTo(point.x, point.lower);
          frame.context.closePath();
          frame.context.fill();
        }
        frame.context.restore();
      },
    });
    const styles = context.mainSeries.createBarStyleContribution({
      key: 'breakout-bars',
      priority: 100,
      chartKinds: ['candles'],
    });
    const markers = context.mainSeries.createMarkerContribution({
      key: 'breakout-markers',
      priority: 100,
      chartKinds: ['candles', 'bars', 'line', 'area', 'baseline'],
    });
    let signals: ReturnType<typeof bollBreakouts> = [];
    styles.setProvider((_bar, index) => signals[index] === 'upper'
      ? { color: upperColor }
      : signals[index] === 'lower' ? { color: lowerColor } : null);
    return {
      update(event) {
        const closes = event.bars.map((bar) => bar.close);
        const values = boll(closes, inputs.period, inputs.multiplier);
        upper.setValues(event, values.upper);
        middle.setValues(event, values.middle);
        lower.setValues(event, values.lower);
        signals = bollBreakouts(closes, values.upper, values.lower);
        bandPoints = event.bars.flatMap((bar, index) => {
          const high = values.upper[index];
          const low = values.lower[index];
          return high === null || low === null ? [] : [{ time: bar.time, upper: high, lower: low }];
        });
        band.requestUpdate();
        styles.invalidateFrom(event.changedFrom);
        const nextMarkers: IndicatorMarker[] = [];
        for (const [index, signal] of signals.entries()) {
          if (signal === 'upper') nextMarkers.push({
            time: event.bars[index].time,
            position: 'aboveBar',
            shape: 'arrowUp',
            color: upperColor,
            text: '突破上轨',
            size: 1,
          });
          if (signal === 'lower') nextMarkers.push({
            time: event.bars[index].time,
            position: 'belowBar',
            shape: 'arrowDown',
            color: lowerColor,
            text: '跌破下轨',
            size: 1,
          });
        }
        markers.set(nextMarkers);
      },
    };
  },
});
