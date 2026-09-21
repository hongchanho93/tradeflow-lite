import { macd } from '../../indicators';
import { defineIndicator } from '../../indicator-sdk/define-indicator';

export default defineIndicator({
  id: 'builtin.macd',
  apiVersion: 1,
  indicatorVersion: 1,
  name: 'MACD',
  description: { 'zh-CN': '指数平滑异同移动平均线', 'en-US': 'Moving Average Convergence Divergence' },
  supports: { seriesKinds: ['ohlcv'] },
  inputs: {
    fast: { type: 'number', title: '快线', default: 12, min: 1, max: 500, step: 1 },
    slow: { type: 'number', title: '慢线', default: 26, min: 1, max: 500, step: 1 },
    signal: { type: 'number', title: '信号线', default: 9, min: 1, max: 500, step: 1 },
  },
  create(context, inputs) {
    const pane = context.panes.create({ key: 'macd', defaultHeight: 130 });
    const dif = context.layers.createSeries({
      key: 'dif',
      type: 'line',
      pane: pane.key,
      options: { color: '#2962ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
    });
    const dea = context.layers.createSeries({
      key: 'dea',
      type: 'line',
      pane: pane.key,
      options: { color: '#f6a623', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
    });
    const histogram = context.layers.createSeries({
      key: 'histogram',
      type: 'histogram',
      pane: pane.key,
      options: { priceLineVisible: false, lastValueVisible: false },
    });
    return {
      update(event) {
        const values = macd(event.bars.map((bar) => bar.close), inputs.fast, inputs.slow, inputs.signal);
        dif.setValues(event, values.dif);
        dea.setValues(event, values.dea);
        histogram.setValues(event, values.histogram, {
          pointOptions(value) {
            return { color: value >= 0 ? 'rgba(8, 153, 129, .6)' : 'rgba(242, 54, 69, .6)' };
          },
        });
      },
    };
  },
});
