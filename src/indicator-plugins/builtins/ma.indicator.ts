import { sma } from '../../indicators';
import { defineIndicator } from '../../indicator-sdk/define-indicator';
import { SOURCE_RESOLUTION_OPTIONS, sourceDataRequests } from './mtf.ts';

export default defineIndicator({
  id: 'builtin.ma',
  apiVersion: 1,
  indicatorVersion: 2,
  name: 'MA',
  description: { 'zh-CN': '移动平均线', 'en-US': 'Moving Average' },
  supports: { seriesKinds: ['ohlcv'] },
  inputs: {
    period: { type: 'number', title: '周期', default: 20, min: 1, max: 500, step: 1 },
    sourceResolution: { type: 'select', title: '数据周期', default: 'current', options: SOURCE_RESOLUTION_OPTIONS },
    color: { type: 'color', title: '颜色', default: '#2962ff' },
  },
  dataRequests(inputs, selection) {
    return sourceDataRequests(inputs.sourceResolution, selection);
  },
  create(context, inputs) {
    const line = context.layers.createSeries({
      key: 'ma',
      type: 'line',
      pane: 'main',
      options: { color: inputs.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
    });
    return {
      update(event) {
        const external = context.data.get('source');
        if (!external) {
          line.setValues(event, sma(event.bars.map((bar) => bar.close), inputs.period));
          return;
        }
        const values = sma(external.bars.map((bar) => bar.close), inputs.period);
        line.setData(external.bars.flatMap((bar, index) => {
          const value = values[index];
          return value === null || value === undefined ? [] : [{ time: bar.time, value }];
        }));
      },
    };
  },
});
