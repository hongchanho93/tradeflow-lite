import { rsi } from '../../indicators';
import { defineIndicator } from '../../indicator-sdk/define-indicator';

export default defineIndicator({
  id: 'builtin.rsi',
  apiVersion: 1,
  indicatorVersion: 1,
  name: 'RSI',
  description: { 'zh-CN': '相对强弱指标', 'en-US': 'Relative Strength Index' },
  supports: { seriesKinds: ['ohlcv'] },
  inputs: {
    period: { type: 'number', title: '周期', default: 14, min: 1, max: 500, step: 1 },
    color: { type: 'color', title: '颜色', default: '#9c6ade' },
  },
  create(context, inputs) {
    const pane = context.panes.create({ key: 'rsi', defaultHeight: 110 });
    const line = context.layers.createSeries({
      key: 'rsi',
      type: 'line',
      pane: pane.key,
      options: { color: inputs.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true },
    });
    return {
      update(event) {
        line.setValues(event, rsi(event.bars.map((bar) => bar.close), inputs.period));
      },
    };
  },
});
