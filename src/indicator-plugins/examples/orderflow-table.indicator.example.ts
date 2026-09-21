import { defineIndicator } from '../../indicator-sdk';

export default defineIndicator({
  id: 'example.orderflow-table',
  apiVersion: 1,
  indicatorVersion: 1,
  name: { 'zh-CN': '订单流 Table 示例', 'en-US': 'Order-flow table example' },
  supports: {
    seriesKinds: ['ohlcv'],
    marketKinds: ['crypto'],
    requires: { trades: ['trade', 'aggregate-trade'], depth: true },
  },
  inputs: {},
  create(context) {
    const overlay = context.layers.createOverlay({
      key: 'summary',
      paneKey: 'main',
      position: 'top-right',
    });
    overlay.setStyles(`
      :host { color: #d1d4dc; font: 12px/1.5 sans-serif; }
      table { border-collapse: collapse; min-width: 180px; background: rgba(19, 23, 34, .92); }
      th, td { padding: 4px 8px; border: 1px solid #363a45; text-align: right; }
      th:first-child { text-align: left; }
    `);
    let buy = 0;
    let sell = 0;
    const render = () => {
      const depth = context.market.getDepth();
      const bestBid = depth?.bids[0]?.price ?? 0;
      const bestAsk = depth?.asks[0]?.price ?? 0;
      overlay.root.innerHTML = `<table><tr><th>项目</th><th>值</th></tr>
        <tr><th>主动买</th><td>${buy.toFixed(4)}</td></tr>
        <tr><th>主动卖</th><td>${sell.toFixed(4)}</td></tr>
        <tr><th>最优买/卖</th><td>${bestBid} / ${bestAsk}</td></tr></table>`;
    };
    const trades = context.market.onTrades((batch) => {
      for (const trade of batch.events) {
        if (!trade.quantityKnown) continue;
        if (trade.aggressorSide === 'buy') buy += trade.quantity ?? 0;
        if (trade.aggressorSide === 'sell') sell += trade.quantity ?? 0;
      }
      render();
    });
    const depth = context.market.onDepth(render);
    render();
    return {
      update() {},
      destroy() {
        trades.dispose();
        depth.dispose();
      },
    };
  },
});
