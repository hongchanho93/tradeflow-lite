# 用户指标接口：.tfi

[English](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/en/indicators.md) · [首页](https://github.com/hongchanho93/tradeflow-lite/blob/main/README.zh-CN.md) · [AI 工具](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/api-reference.md)

## 交付可以直接导入的文件

`.tfi` 是 UTF-8 JavaScript，只调用一次 `defineIndicator`，在隔离的 QuickJS/WASM Worker 中执行，不在主页面执行。普通用户从指标入口导入，或让助手安装；使用兼容文件不需要源码仓库、构建工具或维护者批准。

必填字段为 `formatVersion:1`、`apiVersion:1`、小写命名空间 `id`、正整数 `indicatorVersion`、`name`、`inputs`、`supports`、`create`。可选 `description`、`author`。名称和说明可使用字符串或支持的中英文本对象。修改时保留 ID、提高版本，保留用户参数与原有规则。

生成前读 `tf_indicator_guide`；修改旧指标先用 `tf_indicator_source`，再按 `tf_indicator_validate` → `tf_indicator_test` → `tf_indicator_install` 执行。验证返回 `disposition=new/replace/unchanged`；错误可能包含 `field/reason/expected/failureDetail/line/column`。核对 `sourceHash` 与 `stage`，确保诊断对应实际测试的候选。放弃的 draft 用 `tf_indicator_draft_release` 释放。

同 ID 替换使用 `applyToExisting=true`，随后通过 `tf_indicator_instances` 核对实例，不在迁移成功后额外添加重复实例。新定义可用 `tf_indicator_add` 添加。保存成功不等于实例正在运行；失败更新会尝试恢复，但指标库不是永久版本控制系统。

## 生命周期与输入

`create(context, inputs)` 声明资源，返回 `{update(event), onPointer?(event)}`。回调为同步协议，没有 import/export、async/await、Promise、定时器、网络、DOM、文件系统或 Tauri API。普通 JavaScript 计算、数组、闭包可用。context、inputs、数据只读，计算状态放在闭包内，实例重建后重新初始化。

`supports:{seriesKinds:['ohlcv']}` 表示支持 OHLCV，可选 `marketKinds` 为 `stock/etf/index/crypto`，没有业务理由不要额外限制。`.tfi` 当前不支持概率序列。

`event.bars` 是主图当前周期保留的完整、有序 OHLCV 数组，包含 `time/open/high/low/close/volume`、可选 `amount`。`time` 使用 Unix 秒，`eventTimeMs` 使用毫秒。保留原始 K 线身份和单位；缺失金额不等于零，最后一根也不自动代表收盘。

`event.reason` 为 `initial/history/realtime/reconciliation`；`changedFrom` 为可能受影响的最早下标。可选 `realtimeUpdates` 包含 `barTime/closed/closedBy/eventTimeMs`。不仅处理新 K 线，还要处理补历史、历史修正和保留窗口滚动。

Context 包含 `instanceId`、`selection={symbol,resolution,adjustment,seriesKind,marketKind,providerId}`、`instrument={priceTick,timeZone,tradingCalendar}`、`theme`、`data`。未知时 `priceTick`、`tradingCalendar` 可以为 null；主题为 `dark/light`。

输入类型为 `number/boolean/color/text/select`，均需 `title/default`。数字支持 `min/max/step`，文本支持 `maxLength`，选择项需 `options:[{value,label}]`，展示字段支持 `group/inline/tooltip/activeWhen`。整数公式参数应主动归一化，不把 step 当作数学保证。

## 一个完整例子

下面的完整文件由指标文档回归实际执行。它重新计算保留窗口，因此能处理历史修正；预热不足时输出 null，不伪造零值。

```tfi
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.simple-sma',
  indicatorVersion: 1,
  name: '简单移动均线',
  inputs: {
    period: { type: 'number', title: '周期', default: 20, min: 1, max: 500, step: 1 },
  },
  supports: { seriesKinds: ['ohlcv'] },
  create(context, inputs) {
    const line = context.layers.createSeries({
      key: 'sma', type: 'line', pane: 'main',
      options: { color: '#2962ff', lineWidth: 2 },
    });
    const period = Math.max(1, Math.floor(inputs.period));
    return {
      update(event) {
        let sum = 0;
        const values = event.bars.map((bar, index) => {
          sum += bar.close;
          if (index >= period) sum -= event.bars[index - period].close;
          return index + 1 < period ? null : sum / period;
        });
        line.setValues(values, { dirtyFrom: 0 });
      },
    };
  },
});
```

## 多周期与跨品种数据

在顶层 `data` 声明宿主取数窗口，例如：

```js
data: {
  monthly: { resolution: '1M', count: 8000, adjustment: 'current' },
  benchmark: { symbol: 'SH:000001', kind: 'index', resolution: '1D', count: 500, align: 'main' },
}
```

回调内通过 `context.data.get(key)` 同步读取。快照包含 `symbol/kind/resolution/adjustment/aligned/requestedCount/rowCount/shortfall/coverage/finality/priceUnit/volumeUnit/bars/capturedAtMs`。跨品种窗口失败时返回 null，主指标可以继续；`context.data.status(key)` 返回 `ready` 或 `unavailable`，并提供 `provider_mismatch/symbol_unavailable/kind_mismatch/unsupported_resolution/unsupported_adjustment/series_kind_unavailable/history_unavailable` 等原因。未声明 key 的状态为 null。

当前最多八个窗口，其中显式跨品种窗口最多四个，同一数据源内最多三个不同目标品种。`count` 为 2–12000；周期为 `1/5/15/30/60/120/240/1D/1W/1M`，仍受数据源支持范围约束；复权为 `current/none/qfq`。`align=none` 保留目标时间轴，`main` 按主图对齐并在缺失处填 null，`main-ffill` 从过去的数据向前填充，但目标首根之前仍为空。时间对齐不等于收盘确认，不得使用未来信息。

`event.bars` 始终是主图周期。不同时间轴使用 `setData`，不要把月线值硬塞进日线等长数组。宿主在沙箱外取数，不切用户图表。内置 MA/EMA 也通过 `sourceResolution` 提供 MTF 能力。

## 输出接口

| 资源 | 声明与更新 |
| --- | --- |
| Pane | `context.panes.main` 返回 `{key:'main'}`；`create({key,defaultHeight})` 新建，`get(key)` 查找。最多四个自建副图，高度 40–2000。 |
| Series | `context.layers.createSeries({key,type,pane,options?})`；pane 是字符串 key，type 为 line/histogram/area/baseline/bar。 |
| 数组 | `series.setValues(values,{dirtyFrom?})` 传与 bars 等长的有限数/null 数组；dirtyFrom 不代表可以只传尾部。仅用于非 bar Series。 |
| 数据点 | `series.setData(points)` 全量替换有序点；`series.update(point)` 单点更新；`series.setVisible(boolean)` 控制显示。 |
| 标记 | `context.mainSeries.createMarkerContribution({key,priority})`，`.set(markers)` 替换本指标贡献。 |
| K 线样式 | `context.mainSeries.createBarStyleContribution({key,priority,chartKinds})`，`.set(styles)` 只改显示，不修改价格。 |
| Canvas | `context.layers.createCanvasLayer({key,target,zOrder?})`，使用 `.setCommands(commands)`、`.setVisible(boolean)`。 |
| Panel | `context.layers.createPanel({key,paneKey,position})`，使用 `.set({title?,columns,rows})`。 |

Series options 为 `color/lineWidth/priceLineVisible/lastValueVisible/visible`。普通点是 `{time,value?,color?}`，缺 value 表示空白；bar 点是 `{time,open,high,low,close,color?}`。颜色支持 hex `#RGB/#RGBA/#RRGGBB/#RRGGBBAA`，原生 Drawing 的颜色能力是另一套接口。

Marker 必填 `time/position/shape/color`，可选 `price/id/text/textColor/tooltip/size/hitTest`。形状为 `circle/square/arrowUp/arrowDown`；位置为 `aboveBar/belowBar/inBar`，或必须带 price 的 `atPriceTop/atPriceBottom/atPriceMiddle`。K 线样式为有序的 `{time,color?,borderColor?,wickColor?}`，`chartKinds` 为 `candles/bars/line/area/baseline` 的非空子集。

Canvas target 为 `{type:'current-main-series'}`、`{type:'pane',pane:'key'}` 或 `{type:'series',series:'key'}`。坐标使用带 time/price 的 `time-price`、带 time/y 的 `time-pixel`、带 x/y 的 `pane-pixel`，同一几何对象不混用空间。命令为 line(from,to,color)、polyline(points,color)、polygon(points)、rect(from,to)、circle(at,radius)、text(at,text,color,fontSize)。填充图形需 fillColor 或 borderColor；可选 lineWidth、dash `solid/dashed/dotted`、文字 align `left/center/right`。它是经验证的命令缓冲，不是原始 Canvas 或 DOM 句柄。

Panel 列为 `[{key,title,align?}]`，行为 `[{cells:[{text,color?}]}]`，每行与列数一致，文字必须为字符串，不是 HTML。位置为 `top-left/top-right/middle-left/middle-right/bottom-left/bottom-right`。

## 交互与订单流

Marker 与 Canvas 命令可声明 `id` 和 `hitTest:true`，可交互 Canvas 必须绑定 `current-main-series`。实现 `onPointer({type,id,time,price,pane})` 接收 `hover/click/leave`，输出仍经过验证。指标图元可以点击、悬停，但**不可拖动**；用户可编辑位置使用 Drawing。

需要时才声明 `supports.requires.depth:true` 或 `trades:['trade','aggregate-trade']`。实时回调可能收到 `depth/trades/marketStatus`。盘口只是当前快照，每侧最多 50 档；逐笔是最多 256 条的微批次，带 streamEpoch、完整性、截断和丢弃信息，不能当作完整历史逐笔。行情状态可能为 connecting、available、disconnected、degraded。

真实数据标为 `source:'live'`，预运行订单流样本明确标为 `source:'preflight-synthetic'`，不是真实当前行情。不提供历史盘口、历史逐笔或完整 MBO。未声明 requires 的指标不会接收不需要的高频订单流回调。

## 测试、诊断与资源控制

`tf_indicator_test` 使用主图实际保留历史，在同一实例依次执行 `initial/history/realtime/reconciliation`。只有同时存在可命中目标和 `onPointer` 才测交互。检查 `coveredReasons/coveredPointerTypes`、耗时和 Series/Marker/BarStyle/Canvas/Panel 统计。纯面板指标的 series 数组为空可以正常，应看 `allOutputsEmpty`，不要直接判失败。

使用 `context.log(string)`，不是 console.log：每回调最多 64 条、16 KiB，文本字段最多 512 字符。可捕获错误保留抛错前已写日志和清洗后的 failureDetail；硬超时不能保证取回未完成 VM 日志。不要在诊断中放凭证或隐私数据。

主要预算：源码 256 KiB，每实例 heap 32 MiB，最多 16 个运行实例、八个临时 draft；四个 Pane、32 个 Series、各八个 Canvas/Panel。每回调 setData 最多 12000 点、Marker 2000、Canvas 命令 5000。Panel 最多 200 行、**正文 1000 单元格**，不计表头。VM 预算为 initial/reconciliation 2000 ms、history 1000 ms、realtime 100 ms、pointer 100 ms，另有 Worker 硬超时。

点数上限不等于 CPU 许可：不要每个 tick 都重写数千个未变化点，优先 `series.update` 与实际受影响区间的有界重算，不要反复重启故障指标。当前权威数值见 [limits.ts](https://github.com/hongchanho93/tradeflow-lite/blob/main/src/user-indicator-runtime/limits.ts)，这些是工程保护，不是订阅配额。

更多完整例子：[副图](https://github.com/hongchanho93/tradeflow-lite/blob/main/fixtures/user-indicators/02-range-pane.tfi)、[标记](https://github.com/hongchanho93/tradeflow-lite/blob/main/fixtures/user-indicators/03-marker-style.tfi)、[Canvas](https://github.com/hongchanho93/tradeflow-lite/blob/main/fixtures/user-indicators/04-canvas.tfi)、[Panel](https://github.com/hongchanho93/tradeflow-lite/blob/main/fixtures/user-indicators/05-panel.tfi)。超出运行时的需求，通过另行授权的[源码扩展](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/extensions.md)实现，不编造 `.tfi` API。
