import { defineIndicator, LineType } from '../../indicator-sdk';
import type {
  IndicatorBar,
  IndicatorCanvasFrame,
  IndicatorMarker,
} from '../../indicator-sdk';

type LimitRule = 'auto' | '5' | '10' | '20' | '30' | 'none';
type TablePosition = 'top-right' | 'top-left' | 'middle-right' | 'middle-left' | 'bottom-right' | 'bottom-left';

type LimitState = {
  upLimit: number | null;
  downLimit: number | null;
  upLocked: boolean;
  downLocked: boolean;
};

type Gap = {
  direction: 1 | -1;
  startTime: number;
  top: number;
  bottom: number;
};

type StreakBracket = {
  startTime: number;
  endTime: number;
  leftY: number;
  rightY: number;
  bridgeY: number;
  count: number;
};

const SHANGHAI_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const SHANGHAI_DATE_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const RULE_CHANGE_20260706 = Date.parse('2026-07-05T16:00:00Z') / 1000;

function dateKey(time: number): string {
  return SHANGHAI_DATE.format(new Date(time * 1000));
}

function shanghaiDayKey(time: number): number {
  return Math.floor((time + 8 * 60 * 60) / 86_400);
}

function roundToTick(value: number, tick: number): number {
  return Math.round(value / tick) * tick;
}

function atUp(value: number, limit: number | null, tick: number): boolean {
  return limit !== null && value >= limit - tick * 0.25;
}

function atDown(value: number, limit: number | null, tick: number): boolean {
  return limit !== null && value <= limit + tick * 0.25;
}

function cnUnit(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(2).replace(/\.00$/, '')}亿`;
  if (absolute >= 10_000) return `${(value / 10_000).toFixed(2).replace(/\.00$/, '')}万`;
  return value.toFixed(2).replace(/\.00$/, '');
}

function price(value: number | null, tick: number): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(tick))));
  return value.toFixed(decimals);
}

function sameMarkers(left: readonly IndicatorMarker[], right: readonly IndicatorMarker[]): boolean {
  return left.length === right.length && left.every((marker, index) => {
    const candidate = right[index];
    return marker.time === candidate.time
      && marker.position === candidate.position
      && marker.shape === candidate.shape
      && marker.color === candidate.color
      && marker.id === candidate.id
      && marker.text === candidate.text
      && marker.textColor === candidate.textColor
      && marker.tooltip === candidate.tooltip
      && marker.price === candidate.price
      && marker.size === candidate.size;
  });
}

function sameGaps(left: readonly Gap[], right: readonly Gap[]): boolean {
  return left.length === right.length && left.every((gap, index) => {
    const candidate = right[index];
    return gap.direction === candidate.direction
      && gap.startTime === candidate.startTime
      && gap.top === candidate.top
      && gap.bottom === candidate.bottom;
  });
}

function sameBrackets(left: readonly StreakBracket[], right: readonly StreakBracket[]): boolean {
  return left.length === right.length && left.every((bracket, index) => {
    const candidate = right[index];
    return bracket.startTime === candidate.startTime
      && bracket.endTime === candidate.endTime
      && bracket.leftY === candidate.leftY
      && bracket.rightY === candidate.rightY
      && bracket.bridgeY === candidate.bridgeY
      && bracket.count === candidate.count;
  });
}

export default defineIndicator({
  id: 'user.a-share-toolkit',
  apiVersion: 1,
  indicatorVersion: 1,
  name: { 'zh-CN': 'A股看盘增强（接口试验）', 'en-US': 'A-share Toolkit (API trial)' },
  description: {
    'zh-CN': '由 Pine 版 A股信息增强移植：涨跌停、连板、缺口和行情面板。',
    'en-US': 'Port of the Pine A-share toolkit: limits, streaks, gaps, and quote table.',
  },
  supports: { seriesKinds: ['ohlcv'], marketKinds: ['stock'] },
  inputs: {
    lookbackDays: { type: 'number', title: '历史范围（自然日）', default: 365, min: 30, max: 730, step: 1, group: '基础规则', tooltip: '只在该自然日范围内生成事件标签、连板线和缺口。' },
    limitRule: {
      type: 'select',
      title: '涨跌幅规则',
      default: 'auto',
      group: '基础规则',
      tooltip: '自动模式按交易所和证券代码选择主板、科创板、创业板或北交所规则。',
      options: [
        { value: 'auto', label: '自动' },
        { value: '5', label: '5%' },
        { value: '10', label: '10%' },
        { value: '20', label: '20%' },
        { value: '30', label: '30%' },
        { value: 'none', label: '无限制' },
      ],
    },
    showLimitBody: { type: 'boolean', title: 'K线染色', default: true, group: '涨跌停样式' },
    upBodyColor: { type: 'color', title: '涨停K线', default: '#FF9800', group: '涨跌停样式', inline: 'body-colors', activeWhen: { field: 'showLimitBody', equals: true } },
    downBodyColor: { type: 'color', title: '跌停K线', default: '#5B9CF6', group: '涨跌停样式', inline: 'body-colors', activeWhen: { field: 'showLimitBody', equals: true } },
    showEventLabels: { type: 'boolean', title: '事件标签', default: true, group: '涨跌停样式' },
    upLabelColor: { type: 'color', title: '涨停标签', default: '#F23645', group: '涨跌停样式', inline: 'label-colors', activeWhen: { field: 'showEventLabels', equals: true } },
    downLabelColor: { type: 'color', title: '跌停标签', default: '#089981', group: '涨跌停样式', inline: 'label-colors', activeWhen: { field: 'showEventLabels', equals: true } },
    eventWarnColor: { type: 'color', title: '炸板/翘板', default: '#F59E0B', group: '涨跌停样式', inline: 'label-colors', activeWhen: { field: 'showEventLabels', equals: true } },
    showLimitLines: { type: 'boolean', title: '涨跌停价线', default: false, group: '涨跌停样式' },
    showStreakLines: { type: 'boolean', title: '连板连接线（仅日线）', default: true, group: '连板' },
    streakLineColor: { type: 'color', title: '连板线', default: '#F23645', group: '连板', activeWhen: { field: 'showStreakLines', equals: true } },
    maxGapCount: { type: 'number', title: '最多保留缺口', default: 5, min: 1, max: 150, step: 1, group: '缺口' },
    gapColor: { type: 'color', title: '缺口颜色', default: '#F59E0B', group: '缺口' },
    showTable: { type: 'boolean', title: '显示信息面板', default: true, group: '信息面板' },
    tablePosition: {
      type: 'select',
      title: '面板位置',
      default: 'top-right',
      group: '信息面板',
      activeWhen: { field: 'showTable', equals: true },
      options: [
        { value: 'top-right', label: '右上' },
        { value: 'top-left', label: '左上' },
        { value: 'middle-right', label: '右中' },
        { value: 'middle-left', label: '左中' },
        { value: 'bottom-right', label: '右下' },
        { value: 'bottom-left', label: '左下' },
      ],
    },
  },
  create(context, inputs) {
    const isDaily = context.selection.resolution === '1D';
    const limitSupported = isDaily || /^\d+$/.test(context.selection.resolution);
    const symbol = context.selection.symbol;
    const code = symbol.code;
    const exchange = symbol.exchange.toUpperCase();
    const currentSt = symbol.name.startsWith('ST') || symbol.name.startsWith('*ST');
    const rule = inputs.limitRule as LimitRule;
    const tick = context.instrument.priceTick ?? 0.01;
    const tablePosition = inputs.tablePosition as TablePosition;

    const limitPercent = (time: number): number | null => {
      if (rule !== 'auto') return rule === 'none' ? null : Number(rule) / 100;
      if (exchange === 'BJ' || /^(4|8|92)/.test(code)) return 0.30;
      if ((exchange === 'SH' && /^(688|689)/.test(code))
        || (exchange === 'SZ' && /^(300|301)/.test(code))) return 0.20;
      if ((exchange === 'SH' && code.startsWith('60'))
        || (exchange === 'SZ' && code.startsWith('00'))) {
        return time < RULE_CHANGE_20260706 && currentSt ? 0.05 : 0.10;
      }
      return null;
    };

    const upper = context.layers.createSeries({
      key: 'up-limit',
      type: 'line',
      pane: 'main',
      options: {
        color: inputs.upLabelColor,
        lineWidth: 1,
        lineType: LineType.WithSteps,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: inputs.showLimitLines,
      },
    });
    const lower = context.layers.createSeries({
      key: 'down-limit',
      type: 'line',
      pane: 'main',
      options: {
        color: inputs.downLabelColor,
        lineWidth: 1,
        lineType: LineType.WithSteps,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: inputs.showLimitLines,
      },
    });
    const barStyles = context.mainSeries.createBarStyleContribution({
      key: 'limit-bars',
      priority: 100,
      chartKinds: ['candles'],
    });
    const markers = context.mainSeries.createMarkerContribution({
      key: 'limit-events',
      priority: 100,
      chartKinds: ['candles', 'bars', 'line', 'area', 'baseline'],
    });
    const overlay = context.layers.createOverlay({
      key: 'information',
      paneKey: 'main',
      position: tablePosition,
    });
    overlay.setStyles(`
      :host { color: #d1d4dc; font: 12px/1.45 -apple-system, BlinkMacSystemFont, sans-serif; }
      table { border-collapse: collapse; min-width: 164px; background: rgba(17, 24, 39, .88); }
      th, td { padding: 3px 7px; border: 1px solid rgba(120, 123, 134, .55); }
      th { color: #aab2c0; text-align: left; font-weight: 400; }
      td { text-align: right; }
      tr:nth-child(even) { background: rgba(31, 41, 55, .72); }
      .up { color: #f23645; } .down { color: #089981; }
    `);

    let bars: readonly IndicatorBar[] = [];
    let states: LimitState[] = [];
    let gaps: Gap[] = [];
    let brackets: StreakBracket[] = [];
    let lastTime = 0;
    let renderedMarkers: readonly IndicatorMarker[] = [];
    let renderedOverlay = '';
    let overlayVisible = true;
    let lastSlowWarning = 0;
    const drawings = context.layers.createCanvasLayer({
      key: 'gap-and-streak',
      target: { type: 'current-main-series' },
      zOrder: 'top',
      draw(frame) {
        const { context: canvas } = frame;
        canvas.save();
        canvas.fillStyle = `${inputs.gapColor}24`;
        for (const gap of gaps) {
          const left = frame.coordinates.timeToX(gap.startTime);
          const top = frame.coordinates.priceToY?.(gap.top) ?? null;
          const bottom = frame.coordinates.priceToY?.(gap.bottom) ?? null;
          if (left === null || top === null || bottom === null) continue;
          canvas.fillRect(left, Math.min(top, bottom), Math.max(0, frame.width - left), Math.abs(bottom - top));
        }
        if (inputs.showStreakLines) {
          canvas.strokeStyle = inputs.streakLineColor;
          canvas.fillStyle = inputs.streakLineColor;
          canvas.lineWidth = 1;
          canvas.setLineDash([5, 4]);
          canvas.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
          canvas.textAlign = 'center';
          canvas.textBaseline = 'bottom';
          for (const bracket of brackets) {
            const left = frame.coordinates.timeToX(bracket.startTime);
            const right = frame.coordinates.timeToX(bracket.endTime);
            const leftY = frame.coordinates.priceToY?.(bracket.leftY) ?? null;
            const rightY = frame.coordinates.priceToY?.(bracket.rightY) ?? null;
            const bridgeY = frame.coordinates.priceToY?.(bracket.bridgeY) ?? null;
            if (left === null || right === null || leftY === null || rightY === null || bridgeY === null) continue;
            canvas.beginPath();
            canvas.moveTo(left, leftY);
            canvas.lineTo(left, bridgeY);
            canvas.lineTo(right, bridgeY);
            canvas.lineTo(right, rightY);
            canvas.stroke();
            canvas.fillText(`${bracket.count}板`, (left + right) / 2, bridgeY - 3);
          }
        }
        canvas.restore();
      },
    });

    barStyles.setProvider((_bar, index) => {
      if (!inputs.showLimitBody) return null;
      const state = states[index];
      if (state?.upLocked) return {
        color: inputs.upBodyColor,
        borderColor: inputs.upBodyColor,
        wickColor: inputs.upBodyColor,
      };
      if (state?.downLocked) return {
        color: inputs.downBodyColor,
        borderColor: inputs.downBodyColor,
        wickColor: inputs.downBodyColor,
      };
      return null;
    });

    return {
      update(event) {
        const updateStarted = performance.now();
        bars = event.bars;
        const previousGaps = gaps;
        const previousBrackets = brackets;
        states = [];
        gaps = [];
        brackets = [];
        const nextMarkers: IndicatorMarker[] = [];
        const upValues: Array<number | null> = [];
        const downValues: Array<number | null> = [];
        const ranges = isDaily ? new Array<number>(bars.length) : null;
        let atrSum = 0;
        const cutoff = Date.now() / 1000 - inputs.lookbackDays * 86_400;
        let activeDate = Number.NaN;
        let dayHigh = 0;
        let dayLow = 0;
        let previousHigh: number | null = null;
        let previousLow: number | null = null;
        let previousClose: number | null = null;
        let previousDayUpLocked = false;
        let completedStreak = 0;
        let streakStart = 0;
        let streakStartY = 0;
        let streakMaxY = 0;
        let intradayUpMarked = false;
        let intradayDownMarked = false;

        for (let index = 0; index < bars.length; index += 1) {
          const bar = bars[index];
          let dailyAtr = 0;
          if (isDaily) {
            const previousBar = bars[index - 1];
            const trueRange = previousBar
              ? Math.max(
                bar.high - bar.low,
                Math.abs(bar.high - previousBar.close),
                Math.abs(bar.low - previousBar.close),
              )
              : bar.high - bar.low;
            ranges![index] = trueRange;
            atrSum += trueRange;
            if (index >= 14) atrSum -= ranges![index - 14];
            dailyAtr = atrSum / Math.min(index + 1, 14);
          }
          const nextDate = shanghaiDayKey(bar.time);
          const newDay = nextDate !== activeDate;
          if (newDay) {
            if (Number.isFinite(activeDate)) {
              previousHigh = dayHigh;
              previousLow = dayLow;
              previousClose = bars[index - 1].close;
              completedStreak = previousDayUpLocked ? completedStreak + 1 : 0;
            }
            activeDate = nextDate;
            dayHigh = bar.high;
            dayLow = bar.low;
            previousDayUpLocked = false;
            intradayUpMarked = false;
            intradayDownMarked = false;
            if (bar.time >= cutoff && previousHigh !== null && previousLow !== null) {
              if (bar.open > previousHigh + tick * 0.25) {
                gaps.push({ direction: 1, startTime: bar.time, top: bar.open, bottom: previousHigh });
              }
              if (bar.open < previousLow - tick * 0.25) {
                gaps.push({ direction: -1, startTime: bar.time, top: previousLow, bottom: bar.open });
              }
              while (gaps.length > inputs.maxGapCount) gaps.shift();
            }
          } else {
            dayHigh = Math.max(dayHigh, bar.high);
            dayLow = Math.min(dayLow, bar.low);
          }

          const pct = limitSupported ? limitPercent(bar.time) : null;
          const upLimit = pct !== null && previousClose !== null
            ? roundToTick(previousClose * (1 + pct), tick)
            : null;
          const downLimit = pct !== null && previousClose !== null
            ? roundToTick(previousClose * (1 - pct), tick)
            : null;
          const upLocked = atUp(roundToTick(bar.close, tick), upLimit, tick);
          const downLocked = atDown(roundToTick(bar.close, tick), downLimit, tick);
          const upTouched = atUp(roundToTick(dayHigh, tick), upLimit, tick);
          const downTouched = atDown(roundToTick(dayLow, tick), downLimit, tick);
          previousDayUpLocked = upLocked;
          states.push({ upLimit, downLimit, upLocked, downLocked });
          if (inputs.showLimitLines) {
            upValues.push(upLimit);
            downValues.push(downLimit);
          }

          if (inputs.showEventLabels && bar.time >= cutoff) {
            if (isDaily && upTouched) {
              const text = bar.high === bar.low && upLocked ? '一字涨停' : upLocked ? '涨停' : '炸板';
              nextMarkers.push({
                time: bar.time,
                position: 'atPriceTop',
                price: bar.high,
                shape: 'arrowDown',
                color: text === '炸板' ? inputs.eventWarnColor : inputs.upLabelColor,
                text,
                textColor: '#ffffff',
                tooltip: `${text}｜最高 ${price(bar.high, tick)}｜收盘 ${price(bar.close, tick)}｜涨停价 ${price(upLimit, tick)}`,
              });
            } else if (!isDaily && upLocked && !intradayUpMarked) {
              nextMarkers.push({
                time: bar.time,
                position: 'atPriceTop',
                price: bar.high,
                shape: 'arrowDown',
                color: inputs.upLabelColor,
                text: '涨停',
                textColor: '#ffffff',
                tooltip: `涨停｜最高 ${price(bar.high, tick)}｜收盘 ${price(bar.close, tick)}｜涨停价 ${price(upLimit, tick)}`,
              });
              intradayUpMarked = true;
            }
            if (isDaily && downTouched) {
              const text = bar.high === bar.low && downLocked ? '一字跌停' : downLocked ? '跌停' : '翘板';
              nextMarkers.push({
                time: bar.time,
                position: 'atPriceBottom',
                price: bar.low,
                shape: 'arrowUp',
                color: text === '翘板' ? inputs.eventWarnColor : inputs.downLabelColor,
                text,
                textColor: '#ffffff',
                tooltip: `${text}｜最低 ${price(bar.low, tick)}｜收盘 ${price(bar.close, tick)}｜跌停价 ${price(downLimit, tick)}`,
              });
            } else if (!isDaily && downLocked && !intradayDownMarked) {
              nextMarkers.push({
                time: bar.time,
                position: 'atPriceBottom',
                price: bar.low,
                shape: 'arrowUp',
                color: inputs.downLabelColor,
                text: '跌停',
                textColor: '#ffffff',
                tooltip: `跌停｜最低 ${price(bar.low, tick)}｜收盘 ${price(bar.close, tick)}｜跌停价 ${price(downLimit, tick)}`,
              });
              intradayDownMarked = true;
            }
          }

          if (isDaily && bar.time >= cutoff) {
            const visualRange = Math.max(dailyAtr, bar.high - bar.low, tick * 10);
            const labelY = bar.high + Math.max(visualRange * 0.15, Math.abs(bar.high) * 0.006, tick * 8);
            if (upLocked) {
              const streak = completedStreak + 1;
              if (streak === 1 || streakStart === 0) {
                streakStart = bar.time;
                streakStartY = labelY;
                streakMaxY = labelY;
              } else {
                streakMaxY = Math.max(streakMaxY, labelY);
              }
              if (streak >= 2) {
                const clearance = Math.max(visualRange * 0.75, Math.abs(bar.high) * 0.03, tick * 30);
                const height = Math.max(visualRange * 0.35, Math.abs(bar.high) * 0.012, tick * 12);
                const leftY = streakStartY + clearance;
                const rightY = labelY + clearance;
                const bridgeY = Math.max(streakMaxY + clearance, leftY, rightY) + height;
                const bracket = { startTime: streakStart, endTime: bar.time, leftY, rightY, bridgeY, count: streak };
                if (brackets.at(-1)?.startTime === streakStart) brackets[brackets.length - 1] = bracket;
                else brackets.push(bracket);
              }
            } else {
              streakStart = 0;
              streakStartY = 0;
              streakMaxY = 0;
            }
          }

          for (let gapIndex = gaps.length - 1; gapIndex >= 0; gapIndex -= 1) {
            const gap = gaps[gapIndex];
            if (gap.direction === 1) {
              if (bar.low <= gap.bottom + tick * 0.25) gaps.splice(gapIndex, 1);
              else if (bar.low < gap.top - tick * 0.25) gap.top = Math.max(gap.bottom, bar.low);
            } else if (bar.high >= gap.top - tick * 0.25) {
              gaps.splice(gapIndex, 1);
            } else if (bar.high > gap.bottom + tick * 0.25) {
              gap.bottom = Math.min(gap.top, bar.high);
            }
          }
        }
        const calculationFinished = performance.now();

        if (inputs.showLimitLines) {
          upper.setValues(event, upValues);
          lower.setValues(event, downValues);
        }
        const seriesFinished = performance.now();
        if (!sameMarkers(renderedMarkers, nextMarkers)) {
          markers.set(nextMarkers);
          renderedMarkers = nextMarkers;
        }
        const markersFinished = performance.now();
        barStyles.invalidateFrom(event.changedFrom);
        const stylesFinished = performance.now();
        if (!sameGaps(previousGaps, gaps) || !sameBrackets(previousBrackets, brackets)) drawings.requestUpdate();
        const canvasFinished = performance.now();
        lastTime = bars.at(-1)?.time ?? 0;

        const latest = bars.at(-1);
        const latestState = states.at(-1);
        if (!latest || !inputs.showTable) {
          if (renderedOverlay) {
            overlay.root.replaceChildren();
            renderedOverlay = '';
          }
          if (overlayVisible) {
            overlay.setVisible(false);
            overlayVisible = false;
          }
          return;
        }
        if (!overlayVisible) {
          overlay.setVisible(true);
          overlayVisible = true;
        }
        const previous = bars.at(-2);
        const change = previous && previous.close !== 0 ? (latest.close / previous.close - 1) * 100 : null;
        const amplitude = previous && previous.close !== 0 ? (latest.high - latest.low) / previous.close * 100 : null;
        const direction = change === null ? '' : change >= 0 ? 'up' : 'down';
        const estimatedAmount = latest.amount ?? latest.volume * (latest.high + latest.low + latest.close) / 3;
        const nextOverlay = `<table>
          <tr><th>周期</th><td>${context.selection.resolution}</td></tr>
          <tr><th>时间</th><td>${isDaily ? dateKey(lastTime) : SHANGHAI_DATE_TIME.format(new Date(lastTime * 1000))}</td></tr>
          <tr><th>开盘</th><td>${price(latest.open, tick)}</td></tr>
          <tr><th>收盘</th><td class="${direction}">${price(latest.close, tick)}</td></tr>
          <tr><th>最高</th><td class="${direction}">${price(latest.high, tick)}</td></tr>
          <tr><th>最低</th><td class="down">${price(latest.low, tick)}</td></tr>
          <tr><th>涨幅</th><td class="${direction}">${change === null ? '—' : `${change.toFixed(2)}%`}</td></tr>
          <tr><th>振幅</th><td>${amplitude === null ? '—' : `${amplitude.toFixed(2)}%`}</td></tr>
          <tr><th>成交量</th><td>${cnUnit(latest.volume)}</td></tr>
          <tr><th>成交额</th><td>${cnUnit(estimatedAmount)}</td></tr>
          <tr><th>涨/跌停价</th><td>${price(latestState?.upLimit ?? null, tick)} / ${price(latestState?.downLimit ?? null, tick)}</td></tr>
        </table>`;
        if (nextOverlay !== renderedOverlay) {
          overlay.root.innerHTML = nextOverlay;
          renderedOverlay = nextOverlay;
        }
        const elapsed = performance.now() - updateStarted;
        if (elapsed > 16 && Date.now() - lastSlowWarning > 30_000) {
          lastSlowWarning = Date.now();
          console.warn('indicator.update.slow', {
            indicatorId: 'user.a-share-toolkit',
            bars: bars.length,
            changedFrom: event.changedFrom,
            reason: event.reason,
            elapsedMs: Number(elapsed.toFixed(1)),
            phasesMs: {
              calculation: Number((calculationFinished - updateStarted).toFixed(1)),
              series: Number((seriesFinished - calculationFinished).toFixed(1)),
              markers: Number((markersFinished - seriesFinished).toFixed(1)),
              styles: Number((stylesFinished - markersFinished).toFixed(1)),
              canvas: Number((canvasFinished - stylesFinished).toFixed(1)),
              overlay: Number((performance.now() - canvasFinished).toFixed(1)),
            },
          });
        }
      },
    };
  },
});
