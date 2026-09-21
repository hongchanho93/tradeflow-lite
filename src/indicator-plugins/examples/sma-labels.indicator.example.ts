import { defineIndicator } from '../../indicator-sdk';

export default defineIndicator({
  id: 'example.sma-labels',
  apiVersion: 1,
  indicatorVersion: 1,
  name: { 'zh-CN': '均线标签示例', 'en-US': 'SMA labels example' },
  supports: { seriesKinds: ['ohlcv'] },
  inputs: {
    period: { type: 'number', title: '周期', default: 20, min: 1, max: 500, step: 1 },
    color: { type: 'color', title: '颜色', default: '#2962ff' },
  },
  create(context, inputs) {
    const line = context.layers.createSeries({
      key: 'sma',
      type: 'line',
      pane: 'main',
      options: { color: inputs.color, lineWidth: 1, priceLineVisible: false },
    });
    let values: Array<number | null> = [];
    const labels = context.layers.createCanvasLayer({
      key: 'labels',
      target: { type: 'series', series: line },
      draw(frame) {
        frame.context.fillStyle = inputs.color;
        frame.context.font = '11px sans-serif';
        for (let index = 0; index < values.length; index += 20) {
          const value = values[index];
          if (value === null) continue;
          const x = frame.coordinates.logicalToX(index);
          const y = frame.coordinates.priceToY?.(value) ?? null;
          if (x !== null && y !== null) frame.context.fillText(value.toFixed(2), x + 4, y - 5);
        }
      },
    });
    return {
      update(event) {
        let sum = 0;
        values = event.bars.map((bar, index) => {
          sum += bar.close;
          if (index >= inputs.period) sum -= event.bars[index - inputs.period].close;
          return index + 1 < inputs.period ? null : sum / inputs.period;
        });
        line.setValues(event, values);
        labels.requestUpdate();
      },
    };
  },
});
