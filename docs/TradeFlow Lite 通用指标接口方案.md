# TradeFlow Lite 通用指标接口方案

状态：方案稿，已吸收多轮代码/API 对照审查；指标 SDK 尚未实施，阶段 A 的 WebSocket 同帧与跨帧换根缺陷已在本分支修复并加入契约

日期：2026-09-16

审查修订：2026-09-16

适用项目：TradeFlow Lite

目标版本：指标 SDK v1

## 1. 目标

为 TradeFlow Lite 建立一套轻量、稳定、适合 AI 生成代码的通用指标接口。用户可以用自然语言描述指标，让 AI 生成一个 TypeScript 指标文件；文件放入约定目录并重新构建后，指标自动出现在 Lite 的指标菜单中。

本方案不复制 Pine Script，也不为平台持续枚举“标签、Table、三角形”等具体绘图元素。平台只维护：

- 指标注册和参数定义；
- K 线、盘口和逐笔成交数据分发；
- 指标加载、更新、隐藏、卸载和异常隔离；
- Series、Canvas、HTML Overlay 三种基础绘图出口；
- 坐标转换、主题、重绘、事件订阅和资源回收；
- 开发模板、文档和验证工具。

指标作者负责计算逻辑和具体视觉。标签、气泡、热力图、Table、卡片或其他图案均由指标作者通过 Canvas 或 HTML Overlay 自行实现。

## 2. 第一版边界

### 2.1 包含

- 源码级 TypeScript 指标插件；
- 通过目录约定自动发现指标；
- 主图和独立副图；
- Line、Histogram 等 Lightweight Charts Series；
- 可自由绘制的 Canvas 图层；
- 可自由创建内容的 HTML Overlay 图层；
- 数字、布尔、颜色、文本和单选参数；
- 历史 K 线和实时 K 线更新；
- 实时盘口快照和逐笔成交批次；
- 指标启用、隐藏、排序、删除、参数保存；
- 指标级错误隔离和结构化诊断；
- 暗色、亮色主题及缩放、滚动、尺寸变化；
- AI 可复制的最小模板和开发文档。

第一版明确分两批交付，避免“接口很多但没有一批真正可用”：

- M1（K 线指标基础）：Registry、Runtime、资源托管、Series、Canvas、K 线数据、主 K 线样式/标记贡献、五个内置指标迁移、设置迁移、K 线开发指南和最小/Canvas 示例；
- M2（订单流和富展示）：盘口/成交、HTML Overlay、订单流示例、真实数字货币 Tauri 验收。

### 2.2 不包含

- Pine Script 语法、编译器或 TradingView 兼容层；
- 策略回测、交易指令和提醒服务；
- 在线指标市场和远程代码下载；
- 在正式 App 中直接执行未经构建的任意 JavaScript；
- 插件权限沙箱、CPU 强制中断和代码签名体系；
- 平台预制的 `label()`、`table()`、`box()` 等不断扩张的图元 API；
- 历史盘口、历史逐笔成交或完整订单级 MBO 数据；
- 指标自行创建 Binance、OKX 或其他行情连接。
- 指标图例、在线编辑器和无需重新构建的热加载；
- HTML Overlay 自动进入 Lightweight Charts 自带截图。

若未来需要“导入一个文件后立即运行且不用重新构建”，必须另行设计 Worker/进程沙箱、权限、资源限制和兼容版本，不直接复用源码插件的信任边界。

## 3. 当前基础与设计缺口

当前 Lite 已有的底层能力：

- `chart.addSeries(...)` 创建主图和副图序列；
- `createSeriesMarkers(...)` 绘制基础标记；
- `ISeriesPrimitive` 和 `IPrimitivePaneRenderer` 支持 Canvas 自定义绘制；
- BOLL 色带已经通过 Primitive 绘制；
- `lightweight-charts-line-tools-*` 提供交互绘图基础；
- 自研 UpArrow 已证明可以注册自定义交互图形；
- 数字货币实时链路已经接收盘口和逐笔成交事件。

目前的缺口不是“没有画布”，而是这些能力分散在 `src/main.ts`、BOLL Primitive、Marker 和绘图插件中：

- 指标 ID 是固定联合类型；
- 指标菜单是硬编码按钮；
- 指标创建、更新和删除由条件分支管理；
- 新指标必须修改多处核心代码；
- 没有统一的指标生命周期；
- 没有统一的资源所有权和自动清理；
- 盘口和逐笔成交只提供给当前界面，尚未向指标暴露；
- Canvas 和 HTML 覆盖物没有开发者友好的封装；
- 没有供 AI 遵循的稳定接口文档。

## 4. 总体架构

```text
历史 K 线 / 实时 K 线 / 盘口 / 逐笔成交
                    │
                    ▼
             IndicatorRuntime
        ┌───────────┼───────────┐
        │           │           │
   Registry     DataRouter   ExecutionScope
        │           │           │
        └───────────┼───────────┘
                    ▼
            IndicatorContext
        ┌───────────┼────────────┐
        │           │            │
   SeriesLayer  CanvasLayer  OverlayLayer
        │           │            │
        ▼           ▼            ▼
   线/柱/副图    任意 Canvas    Table/卡片/DOM
```

职责划分：

| 模块 | 责任 |
|---|---|
| `IndicatorRegistry` | 自动发现、定义校验、ID 去重、菜单元数据 |
| `IndicatorRuntime` | 按图表上下文创建实例、分发数据、显示隐藏、错误隔离、卸载 |
| `IndicatorDataRouter` | 分发当前证券的 K 线、盘口和逐笔成交，不新增行情连接 |
| `IndicatorExecutionScope` | 每次执行实例的订阅、定时器和监听器，重建时释放 |
| `IndicatorVisualSlot` | 按 instanceId + stable key 保留 Pane、Series、Primitive、Overlay，重绑定或删除时清理 |
| `OverlayLayoutManager` | 在平台外层 OverlayHost 中用公开尺寸定位 HTML Overlay |
| `SeriesLayer` | 创建由运行时托管的图表序列和副图 |
| `CanvasLayer` | 提供受控 Canvas、坐标转换和重绘入口 |
| `OverlayLayer` | 提供受控 HTML 根节点和固定定位能力 |
| 指标插件 | 计算指标、更新自身输出、决定具体画什么 |

## 5. 目录设计

```text
src/
  indicator-sdk/
    contracts.ts
    define-indicator.ts
    registry.ts
    runtime.ts
    data-router.ts
    execution-scope.ts
    visual-slot.ts
    layers/
      series-layer.ts
      canvas-layer.ts
      overlay-layer.ts

  indicator-plugins/
    builtins/
      ma.indicator.ts
      ema.indicator.ts
      boll.indicator.ts
      macd.indicator.ts
      rsi.indicator.ts
    user/
      README.md
    contributed/
    index.ts

  indicator-plugin-examples/
    minimal-line.indicator.ts
    custom-canvas.indicator.ts
    realtime-order-flow.indicator.ts

docs/
  TradeFlow Lite 指标开发指南.md

scripts/
  check-indicator-sdk.mjs
  check-indicator-plugin.mjs
```

`src/indicators.ts` 在迁移期间继续作为纯计算函数模块使用，避免为了目录整齐顺带改写已经验证的公式。

自动发现代码放在 `src/indicator-plugins/index.ts`，使 glob 路径相对于插件目录解析。`user/` 用于本机源码插件，除 `README.md` 外默认加入 `.gitignore`；准备随项目发布的插件放在 `builtins/` 或 `contributed/`。示例放在 `src/` 下但不进入生产注册表，以便现有 TypeScript 构建或专用 `tsconfig.indicator-examples.json` 能真正检查它们。

## 6. 指标定义接口

```ts
export type LocalizedText =
  | string
  | { readonly 'zh-CN': string; readonly 'en-US': string };

export type InferIndicatorInputs<S extends IndicatorInputSchema> = {
  readonly [K in keyof S]: InferIndicatorInputValue<S[K]>;
};

export interface IndicatorDefinition<S extends IndicatorInputSchema> {
  apiVersion: 1;
  id: string;
  indicatorVersion: number;
  name: LocalizedText;
  description?: LocalizedText;
  author?: string;
  supports: IndicatorApplicability;
  inputs: S;
  migrateInputs?(
    previous: Readonly<Record<string, unknown>>,
    fromIndicatorVersion: number,
  ): Partial<InferIndicatorInputs<S>>;
  create(
    context: IndicatorContext,
    inputs: InferIndicatorInputs<S>,
  ): IndicatorInstance;
}

export declare function defineIndicator<const S extends IndicatorInputSchema>(
  definition: IndicatorDefinition<S>,
): IndicatorDefinition<S>;

export interface IndicatorInstance {
  update(event: IndicatorDataEvent): void;
  onVisibilityChange?(visible: boolean): void;
  onThemeChange?(theme: IndicatorTheme): void;
  destroy?(): void;
}

export interface IndicatorApplicability {
  seriesKinds: readonly ['ohlcv'];
  marketKinds?: readonly MarketSymbolKind[]; // 复用 src/market-universe.ts
  requires?: {
    depth?: boolean;
    trades?: readonly TradeEventKind[]; // any-of：Provider 支持其中任一种即可
  };
}

export interface IndicatorContext {
  readonly instanceId: string;
  readonly selection: Readonly<{
    symbol: IndicatorSymbol;
    resolution: Resolution; // 复用 src/chart-time-controls.ts 的现有类型
    adjustment: 'none' | 'qfq';
    seriesKind: 'ohlcv';
    marketKind: MarketSymbolKind;
    providerId: string;
  }>;
  readonly layers: IndicatorLayers;
  readonly panes: IndicatorPaneApi;
  readonly mainSeries: IndicatorMainSeriesApi;
  readonly market: IndicatorMarketData;
  readonly events: IndicatorEventApi;
  readonly resources: IndicatorResourceApi;
}
```

约束：

- `id` 使用稳定、带命名空间的形式，例如 `jim.limit-board`；
- `apiVersion` 表示 SDK 契约版本，`indicatorVersion` 表示插件自身及其参数版本，两者不能混用；
- `supports` 在创建实例前决定该指标是否适用于当前图表和数据源；SDK v1 只开放 `ohlcv`，预测市场继续禁止指标，`probability` 和 Polymarket 合成成交不进入 v1 指标接口；
- `requires.trades` 是 any-of：Provider 能提供数组中任一种事件即可创建；Runtime 只分发该实例声明接受的类型；
- `create()` 可以通过 `context.market` 订阅平台已验证的数据，但不得自行建立行情连接；
- `update()` 根据平台提供的数据更新指标；
- 订阅、定时器等执行资源由 `ExecutionScope` 兜底回收；带稳定 key 的图表资源由 `VisualSlot` 重绑定或在删除实例时回收；
- 指标不直接导入或修改 `src/main.ts`。

生命周期采用“执行实例重建、可视槽位保留”的规则。每个 `(instanceId, indicatorId, inputs, providerId, symbol, resolution, adjustment, streamEpoch)` 对应一个执行实例；参数、Provider、证券、周期、复权变化，或所依赖的订单流进入新 epoch 时，Runtime 先停止向旧实例分发，再销毁并重建执行实例。这样不会让 AI 生成的指标承担复杂 reset 状态机。

重建不等于删除并重加图表对象。Runtime 为每个 `instanceId` 维护持久的 `IndicatorVisualSlot`：

- 插件创建 Series、Pane、Canvas 时必须提供稳定 `key`；重建期间相同 `(instanceId, key)` 取回原有受控句柄并清空/替换数据，不移除再添加；
- 相同稳定 key 只有在资源种类和 Series 类型一致时才能复用；例如旧资源是 line、新定义改成 histogram，Runtime 在同一 VisualSlot 内替换该 Series，并在事务提交后重新应用保存的主图或 Pane 顺序；
- 副图按 `(instanceId, paneKey)` 由 Runtime 使用 `chart.addPane(true)` 持有，避免最后一个 Series 暂时移除时 Pane 被 Lightweight Charts 自动删除；
- 重绑定开始时立即清空 Series 数据、Overlay `root` 内容，并把 Canvas `draw` 替换成空回调；新实例认领后再安装新内容和绘制回调，切证券后的第一帧不得显示旧证券的 Table 或 Canvas；
- 重建完成后才清理新实例没有重新声明的旧 key；只有删除整个指标实例时才无条件移除其 Pane；
- 插件只能声明 `defaultHeight`。Pane 首次创建时使用默认高度，此后用户保存的高度优先，重建不得覆盖；
- 主图 Series 的叠放顺序由 Runtime 在重绑定事务结束时按保存状态重新应用，不能依赖新建顺序。

切到不适用的证券或当前 Provider 缺少 `requires` 能力时，不创建 Execution。为保持现有产品行为，VisualSlot 立即清空所有 Series、Overlay 和 Canvas，但保留空 Pane、保存的高度和顺序；用户删除指标实例时才移除 Pane。切回适用证券后复用原 VisualSlot 恢复执行，不能把“不适用”当成运行错误。

隐藏不等于停止计算。隐藏时由 Runtime 隐藏托管的 Series、Canvas、Overlay、样式和标记，但实例继续接收 K 线和订单流，重新显示时不会出现累计值断层。`onVisibilityChange` 只通知插件处理它自行维护的轻量状态，不允许插件接管托管资源的显隐。

推荐的最小指标：

```ts
export default defineIndicator({
  id: 'example.sma',
  apiVersion: 1,
  indicatorVersion: 1,
  name: { 'zh-CN': '示例均线', 'en-US': 'Example SMA' },
  supports: { seriesKinds: ['ohlcv'] },
  inputs: {
    period: {
      type: 'number',
      title: '周期',
      default: 20,
      min: 1,
      max: 500,
      step: 1,
    },
  },
  create(context, inputs) {
    const line = context.layers.createSeries({
      key: 'sma',
      type: 'line',
      pane: 'main',
      options: { color: '#2962ff', lineWidth: 1 },
    });
    return {
      update(event) {
        const values = calculateSmaValues(event.bars, inputs.period);
        line.setValues(event, values);
      },
    };
  },
});
```

## 7. 参数接口

第一版参数类型：

```ts
type SelectOption<V extends string = string> = {
  readonly value: V;
  readonly label: LocalizedText;
};

type IndicatorInputDefinition =
  | { type: 'number'; title: LocalizedText; default: number; min?: number; max?: number; step?: number }
  | { type: 'boolean'; title: LocalizedText; default: boolean }
  | { type: 'color'; title: LocalizedText; default: string }
  | { type: 'text'; title: LocalizedText; default: string; maxLength?: number }
  | { type: 'select'; title: LocalizedText; default: string; options: readonly SelectOption[] };

type IndicatorInputSchema = Readonly<Record<string, IndicatorInputDefinition>>;

type InferIndicatorInputValue<D> =
  D extends { type: 'number' } ? number :
  D extends { type: 'boolean' } ? boolean :
  D extends { type: 'select'; options: readonly SelectOption<infer V>[] } ? V :
  D extends { type: 'color' | 'text' } ? string :
  never;
```

`defineIndicator<const S>()` 以 Schema 本身作为泛型参数，因此 `create(context, inputs)` 能直接推导 `inputs.period: number` 和 select 的字面量联合，不要求 AI 到处写 `as`。无参数指标明确写 `inputs: {}`。`check-indicator-sdk` 必须包含编译期正反类型断言。

TypeScript 能约束 select 输入的使用类型，但不能只靠当前联合类型保证 `default` 一定存在于 `options`。Registry 注册时必须逐项验证 select 默认值；不在选项内的定义整项拒绝并报告指标 ID、字段名和非法默认值，不能等到设置界面打开才暴露。

平台根据 Schema 生成设置界面。参数按 `instanceId` 保存，并记录指标 ID 与指标版本；因此同一个指标可同时添加多个实例，例如 MA20 和 MA60。版本升级时：

- 定义提供 `migrateInputs()`，则先迁移旧参数，再按新 Schema 逐字段校验；
- 没有迁移函数时保留仍合法的同名字段，只对缺失或非法字段使用新版默认值；
- 不把格式未知的旧参数直接传给指标；
- 参数修改由 Runtime 销毁并重建 Execution，但复用 VisualSlot；第一版不增加复杂的局部参数热更新协议。

## 8. K 线数据接口

```ts
export interface IndicatorBar {
  readonly time: number; // Unix 秒
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly amount?: number;
}

export interface IndicatorDataEvent {
  readonly reason: 'initial' | 'history' | 'realtime' | 'reconciliation';
  readonly bars: readonly IndicatorBar[];
  readonly changedFrom: number;
  readonly realtimeUpdates?: readonly IndicatorRealtimeBarUpdate[];
}

export type IndicatorRealtimeBarUpdate =
  | {
      readonly barTime: number;
      readonly closed: false;
      readonly eventTimeMs?: number;
    }
  | {
      readonly barTime: number;
      readonly closed: true;
      readonly closedBy: 'exchange' | 'newer-bar' | 'session-end';
      readonly eventTimeMs?: number;
    };
```

规则：

- 当前证券、周期、复权和数据源身份从创建时冻结的 `context.selection` 读取；它们变化时实例重建，不再要求每个指标正确实现 reset；
- `bars` 是平台已经校验、按时间升序和去重的只读快照；DataRouter 不得冻结仍由 `currentBars` 原地 `push`/替换的主链路数组或对象；
- DataRouter 维护独立的不可变 DTO 缓存。每个新增或被替换的 Bar 只创建并冻结一次，未变化的 Bar 对象跨事件复用；每次派发只浅拷贝并冻结外层数组。不能每 250ms 重新复制、递归冻结 12000 根 K 线；
- TypeScript `readonly` 之外，公开的 Bar、Depth、Trade、capabilities 包装和叶子对象都在 DTO 边界冻结，避免一个可信插件改写其他指标看到的数据；
- 时间统一使用 Unix 秒；逐笔成交时间保留毫秒字段；
- `changedFrom` 指向最早发生变化的位置；
- 初次加载和实例重建从 `0` 开始；
- 实时末端更新通常从最后一根或受影响的最早一根开始；
- 默认模板采用“全量计算 + `setValues`”：公式每次从完整只读 bars 重新计算，由 Runtime 只把变化尾部推给图表。本轮审查在当前公式实现和 12000 根样本上测得五个内置指标合计重算约 1.1ms，其中 BOLL 约 0.46ms；阶段 A 仍须用仓库内可复现基线脚本复测并保存环境与结果。优先保证 EMA 种子、RSI Wilder 状态和回看边界正确；只有性能剖析证明某个公式本身成为瓶颈时，才允许另写经过等价性测试的增量计算；
- SDK v1 的计算回调为同步接口，避免异步旧结果覆盖新证券；
- `realtimeUpdates` 保留合并窗口内每根受影响 K 线的收盘状态，按时间升序排列；同一 bar 的 `closed=true` 是粘性的，不能被随后较弱的未收盘事件覆盖；
- A 股没有 WebSocket。交易时段的 5 秒 `count: 2` 轮询是股票、ETF、指数的正常实时来源；加密货币 WebSocket 断开时的 5 秒轮询也是降级实时来源。这两类轮询只要改变 K 线，就使用 `reason='realtime'` 并填写 `realtimeUpdates`，不能降格成“纠错”；
- 轮询返回更新的 N+1 时，N 可确认收盘并标为 `closedBy='newer-bar'`；`market-session` 确认交易时段结束且最后一根已完成最终拉取时，标为 `closedBy='session-end'`；Provider 明确给出收盘事件时标为 `closedBy='exchange'`。只有 `closed=true` 才允许出现 `closedBy`，没有证据时保持 `closed=false`；
- 仅在加密货币 WebSocket 正常连接时保留 60 秒 `reason='reconciliation'` 轮询作纠错；它修正受影响 K 线并计算最小 `changedFrom`，但不凭轮询本身伪造交易所收盘；
- Runtime 内部仍使用 generation/selection token 拒绝迟到事件，但不把它作为插件必须处理的公开状态机；
- `SeriesHandle.setValues(event, values, options?)` 接收与 `event.bars` 等长的数值数组。Runtime 根据 `reason` 和 `min(event.changedFrom, options.dirtyFrom ?? event.changedFrom)` 选择全量 `setData()` 或尾部 `update()`，避免每个实时 tick 都向 Lightweight Charts 重建整条深历史序列；
- `values` 中的 `null` 由 Runtime 转换成只有 `{ time }` 的 Lightweight Charts whitespace point，绝不把 `null`、`undefined` 或 `NaN` 作为 `value` 传给 Series；
- `options.pointOptions(value, index, bar)` 可返回当前 Series 类型允许的逐点样式。Histogram 至少支持 `{ color }`，使 MACD 正负柱能走相同增量接口，而不是退回每次全量 `setData()`。
- ZigZag、枢轴、分形等会在新 K 线到来后修改更早结果的指标，必须传 `options.dirtyFrom` 指出自身最早变化位置；Runtime 从该位置起同时更新数值、逐点样式和 whitespace，避免旧点残留。开发模式把本次全量 values 与上一版缓存比较；若在有效起点之前发现变化，记录包含指标 ID、Series key、期望 dirtyFrom 的告警。

阶段 A 开始时的基线代码曾有两处缺陷：`pendingRealtimeBar = event` 会在同一帧内用 N+1 开盘覆盖 N 收盘，`pendingRealtimeIndicatorTime = time` 会在 250ms 窗口内丢掉较早受影响 K 线。本分支已先用失败契约复现，再改为按 time 保存 bar、按 Set 保存指标时间；SDK 迁移必须保留修复后的语义：

- bar 合并改为按 bar time 保存待应用事件；不同时间都保留，同一时间按已接受序列合并，`closed=true` 不丢失；
- DataRouter 在合并窗口内维护最小 `changedFrom`，一次事件可以携带 N 收盘与 N+1 开盘两个 `realtimeUpdates`；
- 已有契约覆盖“同一调度窗口连续输入 N closed、较弱同 time 更新、N+1 open”和 250ms 多时间批次；股票 5 秒轮询换根仍须在 M1 增加独立契约，不能用加密货币 WebSocket 测试代替。

## 9. 盘口与逐笔成交接口

### 9.1 当前可提供的数据

```ts
export interface IndicatorDepthLevel {
  readonly price: number;
  readonly quantity: number;
}

export interface IndicatorDepthSnapshot {
  readonly providerId: string;
  readonly symbol: string;
  readonly exchangeTimeMs?: number;
  readonly receivedTimeMs: number;
  readonly sequence?: number | null;
  readonly bids: readonly IndicatorDepthLevel[];
  readonly asks: readonly IndicatorDepthLevel[];
}

export type TradeEventKind =
  | 'trade'
  | 'aggregate-trade';

export interface IndicatorTrade {
  readonly providerId: string;
  readonly symbol: string;
  readonly eventKind: TradeEventKind;
  readonly tradeId?: number;
  readonly firstTradeId?: number;
  readonly lastTradeId?: number;
  readonly exchangeTimeMs?: number;
  readonly receivedTimeMs: number;
  readonly barTime: number; // 对应 IndicatorBar.time 的规范周期时间键（Unix 秒），由 Rust Provider 产生
  readonly price: number;
  readonly quantity?: number;
  readonly quantityKnown: boolean;
  readonly aggressorSide?: 'buy' | 'sell' | null;
  readonly flags?: number | null;
}

export interface IndicatorTradeBatch {
  readonly events: readonly IndicatorTrade[];
  readonly streamEpoch: string;
  readonly subscriptionId: string;
  readonly subscriptionStartedAtMs: number;
  readonly completeSinceSubscriptionStart: boolean;
  readonly droppedSinceSubscriptionStart: number;
  readonly resetReason?: 'initial' | 'buffer-overflow' | 'sequence-gap' | 'source-reset';
}
```

字段语义不能把不同数据源强行伪装成同一种“逐笔”：

- Binance 当前事件是 `aggregate-trade`，应保留聚合成交语义，并在可得时暴露首末原始成交 ID；
- OKX `trades-all` 当前事件是交易所逐笔，标为 `trade`；
- `aggressorSide` 统一表示主动成交方；不能确定时为 `null`，不得根据涨跌方向猜测；
- `exchangeTimeMs` 只在交易所时间真实存在时填写；本机接收时间放入 `receivedTimeMs`，不能把 `SystemTime::now()` 命名成交易所事件时间；
- Polymarket 在 SDK v1 禁止指标，因此其轮询合成成交不向指标分发。当前 Polymarket Depth 与合成成交使用的也是本机接收时间；未来若开放 prediction 指标，也只能填写 `receivedTimeMs`。

### 9.2 指标调用方式

```ts
export interface IndicatorMarketData {
  capabilities(): Readonly<IndicatorMarketCapabilities>;
  status(): Readonly<IndicatorMarketStatus>;

  getDepth(): Readonly<IndicatorDepthSnapshot> | null;

  onDepth(
    callback: (depth: Readonly<IndicatorDepthSnapshot>) => void,
  ): Disposable;

  onTrades(
    callback: (batch: Readonly<IndicatorTradeBatch>) => void,
  ): Disposable;

  onStatus(
    callback: (status: Readonly<IndicatorMarketStatus>) => void,
  ): Disposable;
}

export interface IndicatorMarketCapabilities {
  readonly depth: { readonly supported: boolean };
  readonly trades: {
    readonly supported: boolean;
    readonly eventKinds: readonly TradeEventKind[];
  };
  readonly historicalDepth: false;
  readonly historicalTrades: false;
  readonly orderByOrder: false;
}

export interface IndicatorMarketStatus {
  readonly state: 'connecting' | 'available' | 'disconnected' | 'degraded';
  readonly reason?: string;
}
```

`IndicatorMarketCapabilities` 是 Provider 对当前市场的静态能力声明，至少分别描述 `depth.supported`、`trades.supported`、允许的 `TradeEventKind`、`historicalDepth: false`、`historicalTrades: false` 和 `orderByOrder: false`。`IndicatorMarketStatus` 描述当前连接中、可用、断开或降级，不能用 `capabilities=false` 表示暂时断线。Provider 描述符必须从只有 `realtime` 扩展到独立的 `depth` 与 `trades` 能力；注册表用定义里的 `supports.requires` 在创建前判断适用性。

当前 Provider 映射必须写成显式适配表：

| Provider | 指标成交类型 | 时间字段 | 连续性依据与 v1 规则 |
|---|---|---|---|
| Binance Spot / USD-M | `aggregate-trade` | 成交使用交易所时间；当前 Depth 的 `SystemTime::now()` 只能作为 `receivedTimeMs` | aggregate trade ID 先用于去重和新旧判断；只有在交易所契约与 fixture 证明连续后，数值跳跃才可判 gap |
| OKX | `trade`（`trades-all`） | `ts` 为 `exchangeTimeMs`，另记本机 `receivedTimeMs` | `tradeId`、`seqId`/时间回退先只判断新旧；没有 `prevSeqId` 等证据时不从跳号猜漏单 |
| Polymarket | v1 不向指标暴露 | Depth 和合成成交当前均为本机轮询接收时间 | 本机 counter 只表示轮询事件顺序，不证明交易所成交连续 |

规则：

- 指标复用 Lite 当前行情连接，不得创建第二套 Binance/OKX 连接；
- 事件必须先通过当前 `requestId + providerId + symbol + resolution + sequence` 校验，再向指标分发；
- 当前成交链路存在 pending queue 100 条上限和 flush 阶段二次过滤/裁剪。实施时必须把指标分发点放在 `acceptsRealtimeSequence` 之后、第一次容量裁剪之前，不能复用已裁剪的 UI 数组；
- `onTrades()` 只有声明 `requires.trades` 的指标才能调用，`onDepth()` 只有声明 `requires.depth` 的指标才能调用；违反时在 `create()` 阶段立即抛出包含指标 ID 和缺失声明的错误，不能让订阅静默收不到数据。stream epoch 变化时也只重建声明依赖对应流的实例；
- 每个指标订阅拥有独立的 `subscriptionId` 和 `subscriptionStartedAtMs`。中途启用、改参数或切换上下文后，累计值只表示该订阅开始以来的数据，不能用整条流的 epoch 起点冒充指标起点；
- Runtime 使用独立的有界指标批次队列。容量必须依据实测基线确定；任何溢出或可证明的序列缺口都使当前订阅的 `completeSinceSubscriptionStart=false`，并累计 `droppedSinceSubscriptionStart`，绝不静默造成错误累计值；
- 本地队列溢出的边界可确定：记录被丢弃数量，终止当前订阅；以下一条已接受事件为新 `streamEpoch` 和新 `subscriptionStartedAtMs`，在分发该事件前重建依赖成交流的执行实例。新实例从零累计，界面固定显示“自 HH:MM:SS 起”。这里没有“可以重开或持续降级”的实现分支；
- 若 Provider 重连、source reset，或路由确认了新的连续起点，则生成新 `streamEpoch`，并按 §6 重建依赖该流的执行实例和订阅；新实例从新的 `subscriptionStartedAtMs` 累计，Overlay/状态面板必须显示“自该时间开始”，不能伪装成完整交易时段结果；
- 若知道存在缺口却无法确定新的连续起点，后续所有批次保持 `completeSinceSubscriptionStart=false`，累计指标停止更新精确值并显示“数据不完整/等待重置”；不能因为下一批正常到达就恢复为完整；
- 乱序和重复成交由数据路由按各 Provider 的真实序列语义处理，不能只用 `tradeId > newestKnownId` 假定所有数据源全局单调。每个 Provider 必须记录哪个字段能证明连续、哪个字段只能判断新旧；只能判断递增时，不得从数值跳跃推断丢事件；
- Depth 以当前可用的聚合档位快照分发；
- 不支持数据的证券通过 `capabilities` 明确声明，指标不得把“无数据”当作零；
- 切换证券时先停止向旧实例分发，再清空盘口/成交状态；
- 指标卸载时自动取消回调，但不关闭仍被主图或其他指标使用的行情连接。
- 成交所属 K 线的 `barTime` 由 Rust Provider 在生成标准化事件时直接填写，语义固定为与对应 `IndicatorBar.time` 完全相同的规范周期时间键。当前 Lite 的 OHLCV 契约使用规范化的周期结束边界（Binance 为 `close_time_ms + 1`，OKX 使用现有 `candle_close_time`），不是交易所原始开盘时间；本方案不另行迁移整套 K 线时间语义。实现应复用该 Provider 生成图表 Bar 的同一规则，TypeScript Runtime 和插件都不得再复制周线、自然月、交易时段等分桶算法。每个 Provider 用 Rust 生成的 fixture 断言 `trade.barTime === indicatorBar.time`，至少覆盖固定分钟、周线和自然月，防止整体错位一根或 Provider 规则漂移。

`streamEpoch` 只是底层实时连续区间标识，`subscriptionStartedAtMs` 才是单个指标累计结果的起点。用户手动删除再添加指标不会补回创建前数据；订单流示例必须显示订阅起点。只有 Provider 层报告缺口且无法定位新的连续起点时才持续降级，直到 Provider 重连、source reset 或其他可证明的新边界。逐 Provider 规则必须用协议字段和 fixture 证明，不能仅凭通用 `sequence > previous` 推导连续性。

当前边界是聚合盘口与成交事件，不是完整订单级 MBO。可实现：

- 数据源确实提供数量和主动方时的主动买卖量；
- 对 `quantityKnown=true`、`quantity` 存在且主动方已知事件计算的成交量 Delta 与累计 Delta；
- 大单标记；
- 成交速度；
- 盘口失衡和买卖盘压力；
- 实时订单流 Table；
- 简化 Footprint。

当前不能可靠实现：

- 启用指标之前的历史订单流还原；
- 历史盘口回放；
- 单笔挂单的完整新增、修改、撤单轨迹；
- 订单排队位置；
- 基于完整 MBO 的精确队列模型。

## 10. 绘图上下文

指标绘图层只提供三种基础出口，不持续增加具体图元。

### 10.1 Series Layer

适用于普通时间序列：

```ts
const series = context.layers.createSeries({
  key: 'primary-line',
  type: 'line',
  pane: 'main',
  options: { color: '#2962ff', lineWidth: 2 },
});

series.setData(points);
series.update(point);
```

支持 Lightweight Charts v5 已安装版本提供且由 SDK 明确适配的 Series 类型。SDK 返回受控句柄，不暴露删除其他指标或主图的能力。

对与 K 线逐根对齐的计算值优先使用：

```ts
series.setValues(event, values);

macdHistogram.setValues(event, histogramValues, {
  dirtyFrom: histogramDirtyFrom,
  pointOptions(value) {
    return { color: value >= 0 ? '#089981' : '#f23645' };
  },
});
```

Runtime 以 `min(event.changedFrom, options.dirtyFrom ?? event.changedFrom)` 决定全量替换还是只更新受影响尾部，并把 `pointOptions` 合并到每个输出点。`pointOptions` 的返回类型按 Series 类型收窄，Histogram 用它迁移 MACD 正负柱。`dirtyFrom` 用于 ZigZag、枢轴和分形等会回头修改历史点的公式；`setData()`/`update()` 仍保留给稀疏信号、非逐 K 对齐和插件自有时间序列。

### 10.2 Canvas Layer

适用于标签、气泡、区域、热力图和任何自定义图案：

```ts
const layer = context.layers.createCanvasLayer({
  key: 'signals',
  target: { type: 'current-main-series' },
  zOrder: 'top',
  draw(frame) {
    const x = frame.coordinates.timeToX(signal.time);
    const y = frame.coordinates.priceToY(signal.price);
    if (x === null || y === null) return;

    frame.context.fillStyle = '#f23645';
    frame.context.fillRect(x - 20, y - 12, 40, 24);
  },
});

layer.requestUpdate();
```

Canvas 目标必须显式区分三种目标、两类坐标能力：

```ts
type CanvasTarget =
  | { type: 'pane'; pane: IndicatorPaneHandle }
  | { type: 'series'; series: IndicatorSeriesHandle }
  | { type: 'current-main-series' };
```

- `pane` 目标只提供像素、时间和逻辑坐标，适合固定区域或纯屏幕绘制；
- `series` 目标通过该 Series 的公开 `priceToCoordinate()` / `coordinateToPrice()` 提供价格坐标；
- `current-main-series` 是由平台动态维护的主序列价格锚点，图表在蜡烛、线、面积等类型间切换时仍指向当前可见主序列；
- 独立 Pane 中需要价格坐标或自动缩放的 Canvas 指标，应先创建一个由自己拥有的锚定 Series，再创建 `series` 目标 Canvas。不能声称裸 Pane Primitive 自己具有价格轴转换能力。

对应的判别联合 `CanvasFrame` 提供：

- Canvas 2D context；
- CSS 像素宽高和设备像素比例；v1 的 `frame.context` 固定为 `useMediaCoordinateSpace()` 对应的 CSS/media 坐标，插件不得再自行乘 DPR；
- `timeToX()`、`logicalToX()`、`xToLogical()`；
- 仅 series 锚定帧提供 `priceToY()`、`yToPrice()`；
- 当前可见逻辑范围；
- 当前主题令牌；
- 受控的重绘请求。

开发者不需要直接访问图表内部 Canvas 或私有 API。底层使用 Lightweight Charts 5.2.1 的公开 Primitive 与 Series API；SDK 必须在自身 draw 入口捕获异常，因为库调用 Primitive 回调时不会替 Runtime 证明错误已隔离。

### 10.3 HTML Overlay Layer

适用于固定在图表角落的 Table、卡片和状态面板：

```ts
const overlay = context.layers.createOverlay({
  key: 'summary-table',
  paneKey: 'main',
  position: 'top-right',
  interactive: false,
});

overlay.setStyles(`
  :host { color: var(--indicator-text); font: 12px sans-serif; }
  .summary { background: var(--indicator-panel-bg); }
`);
overlay.root.replaceChildren(renderSummaryTable(state));
```

`pane.getHTMLElement()` 在 Lightweight Charts 5.2.1 实际返回包含左轴、Pane、右轴三个单元格的 `<tr>`，不能作为 Overlay 挂载点；往其中插入 div 会改变表格布局。SDK 不遍历它的子 `td`，也不依赖库的内部 DOM。

正确的挂载方式是：Runtime 在 Lite 自己拥有的图表外层容器中创建一个绝对定位的 `IndicatorOverlayHost`，与 Lightweight Charts 根节点并列。`OverlayLayoutManager` 只使用公开 API 和平台自己拥有的尺寸：

- 横向绘图区使用左价格轴 `width()`、`timeScale().width()` 和右价格轴 `width()`；
- 纵向按 `chart.panes()` 的当前顺序和各 Pane `getHeight()` 累加；图表容器高度减去 `timeScale().height()` 与各 Pane 高度后得到分隔区总高度，并按相邻 Pane 间隙计算偏移，不查询内部 row/td；
- 外层 `ResizeObserver`、Runtime 的 Pane 高度/顺序变化、图表容器上的分隔拖动 pointer 事件和价格轴宽度变化统一触发重新测量；
- 位置计算与真实 Lite 开发版做多 Pane、左右价格轴、窗口缩放和拖动分隔线对拍。公开尺寸不足以稳定对齐时，v1 应缩小 Overlay 支持范围，不能回退到私有 DOM 选择器。

每个 Overlay 内容位于独立 ShadowRoot。插件样式必须通过 `overlay.setStyles(cssText)` 注入该 ShadowRoot；`overlay.root` 是插件内容根节点。全局 CSS 不会进入 ShadowRoot，而插件 `import './x.css'` 会污染全局，因此插件静态检查禁止导入 CSS/SCSS/Less 等全局样式文件。默认 `pointer-events: none`，只有明确声明 `interactive: true` 才能接收鼠标事件，避免 Table 阻断图表缩放和拖动。

第一版明确：HTML Overlay 不进入 `chart.takeScreenshot()` 的输出。截图能力如需包含 Table，后续单独设计 DOM 合成流程；不能在 v1 验收中把“屏幕上看得到”误写成“图表截图会包含”。

## 11. Pane、坐标和事件

```ts
export interface IndicatorPaneHandle {
  readonly key: string;
  getHeight(): number;
}

export interface IndicatorEventApi {
  onCrosshairMove(callback: CrosshairCallback): Disposable;
  onClick(callback: ChartClickCallback): Disposable;
  onVisibleRangeChange(callback: VisibleRangeCallback): Disposable;
}
```

- `context.panes.main` 指向主图；
- 字符串 `'main'` 是 Runtime 保留的主图 key，插件创建副图时不得使用；Registry/Pane API 对冲突立即报错；
- 指标可以创建一个或多个自己拥有的副图；
- 插件以 `context.panes.create({ key, defaultHeight })` 声明副图；`defaultHeight` 只在首次创建时使用，SDK 不向插件暴露覆盖用户高度的 `setHeight()`；
- 副图进入对象树并参与排序、显隐和高度调整；
- 所有事件监听器登记在 `ExecutionScope`；
- 指标不能移动、删除或修改不属于自己的 Pane 和 Series；
- 不允许使用 `_private__chartWidget` 等 Lightweight Charts 私有对象。
- Pane 句柄不得缓存会随增删变化的数组索引；保存结构使用稳定 `paneKey`，再由 Runtime 解析当前对象；
- 执行实例重建时 Pane 由 `IndicatorVisualSlot` 保持，Series 以稳定 key 重绑定。只有删除指标或重建完成后确认某个 key 不再声明时才移除对应资源。

## 12. 主 K 线样式贡献

BOLL 当前会改变突破 K 线的颜色，这是必须保留的旧能力，但不能因此把完整主序列 API 暴露给用户指标。

提供一个受控接口：

```ts
const styleContribution = context.mainSeries.createBarStyleContribution({
  key: 'signal-bars',
  priority: 100,
  chartKinds: ['candles'],
});

styleContribution.setProvider((bar, index) => {
  if (!isSignal(bar)) return null;
  return { color: '#f6c344' };
});

styleContribution.invalidateFrom(changedFrom);
```

冲突规则：

- 基础 K 线主题先应用；
- 按 `priority`、稳定指标 ID 和 `instanceId` 顺序合并；
- 指标只覆盖自己明确返回的字段；
- 指标隐藏或卸载后立即撤销其贡献；
- 不允许指标直接替换主 K 线数据；
- Runtime 在 `setPrimarySeriesData()`、`updatePrimarySeries()` 和图表类型切换的同一入口合并贡献；插件声明不支持的图表类型时不应用样式。

主序列 Marker 作为 SeriesLayer 的受控子能力，而不是第四种无限图元接口：

```ts
const markers = context.mainSeries.createMarkerContribution({
  key: 'signals',
  priority: 100,
  chartKinds: ['candles', 'bars', 'line', 'area', 'baseline'],
});
markers.set(signalMarkers);
```

Runtime 合并 `marker-state.ts` 管理的手动 Marker 与各指标贡献，并在显隐、删除和图表类型切换后重建最终 Marker 集合。交互画线工具仍走自己的 Primitive/line-tools 路径，不混称为 Marker。迁移 BOLL 时必须保持首次突破、不重复提示、自动缩放影响和现有视觉，不得用独占 `createSeriesMarkers()` 覆盖其他来源。

`chartKinds` 直接复用项目当前 `ChartType = 'candles' | 'bars' | 'line' | 'area' | 'baseline'`，不另外引入 Lightweight Charts 内部的 `Candlestick`/`Bar` 命名，避免转换时漏掉 baseline。

## 13. 自动发现与注册

内置指标静态导入并同步注册；`user/` 与 `contributed/` 通过 Vite 的 `import.meta.glob()` 在构建时自动发现：

```ts
// 文件位置：src/indicator-plugins/index.ts
import ma from './builtins/ma.indicator.ts';
// 其余 builtins 同样静态导入
const userModules = import.meta.glob('./user/*.indicator.ts');
const contributedModules = import.meta.glob('./contributed/*.indicator.ts');
```

Runtime 对两组外部源码插件逐模块执行 lazy import，并对每个 Promise 单独捕获顶层求值错误；一个插件顶层 `throw` 不应让其余合法插件无法注册。必须如实保留两个边界：语法错误和 TypeScript 类型错误仍会使项目构建失败；源码插件并不是运行时热加载脚本。

启动顺序固定为：同步注册 builtins → 显示“正在加载用户指标”状态 → 等待所有 lazy 模块 settled → 生成最终 Registry → 恢复指标实例和布局。不能先恢复空注册表，再让指标和副图闪现。单个外部插件失败不阻止其他插件，但它的保存状态按 §14 保留。

注册阶段校验：

- 默认导出是否为合法指标定义；
- ID、名称和版本是否合法；
- ID 是否重复；
- 参数默认值是否符合 Schema；
- 是否使用 SDK 支持的版本；
- 同一个文件不得注册多个隐式指标；
- 顶层只允许定义与默认导出，禁止 top-level await 和 CSS/SCSS/Less 等全局样式 import；Overlay 样式必须走 `setStyles()`。

能成功构建但注册或求值失败的单个插件不阻止主图启动。开发模式显示文件名和具体错误；正式界面只显示简洁错误。

## 14. 状态保存

现有固定联合类型设置需要迁移为动态指标状态：

```ts
interface SavedIndicatorState {
  instanceId: string;
  indicatorId: string;
  indicatorVersion: number;
  visible: boolean;
  menuOrder: number;
  panes: readonly {
    key: string;
    renderOrder: number;
    height: number;
  }[];
  inputs: Record<string, unknown>;
}

type SavedMainOverlayOrderEntry =
  | { type: 'volume' }
  | { type: 'indicator'; instanceId: string };

interface SavedIndicatorEnvelope {
  schemaVersion: number;
  instances: readonly unknown[];
  mainOverlayOrder: readonly SavedMainOverlayOrderEntry[];
}
```

要求：

- 保留当前图表类型、价格轴、成交量、指标启用/隐藏/顺序和价格线设置；
- 旧设置迁移到新的版本化结构；
- 未安装、lazy 求值失败或暂时不兼容的实例状态进入 `unresolvedEntries`，运行时不激活，但下次保存必须将原始 JSON 值和相关排序引用原样写回；插件恢复后重新校验并恢复，不能因为用户改了另一个设置就抹掉失败插件的参数和 Pane 布局；
- 损坏输入只重置对应指标，不清空整个图表设置；
- 设置写入失败给用户明确提示，并保留当前内存状态；
- `menuOrder` 是对象树/菜单中的实例顺序，`renderOrder` 是 Pane 绘制顺序，两者不能复用一个模糊的 `order` 字段；
- `mainOverlayOrder` 单独保存主图内部叠放顺序，包含非指标的成交量和每个指标实例；一个指标的多条主图 Series 作为同一实例组保持内部稳定顺序；
- 同一个 `indicatorId` 可以保存多个不同 `instanceId`，迁移旧设置时为每个现有内置指标生成稳定实例 ID；
- 把当前固定参数迁移成可编辑参数本身会改变产品行为，实施时必须逐项记录默认值、允许范围和旧设置映射，不能只验证“界面有输入框”。

## 15. 资源所有权与错误隔离

| 资源 | 创建方 | 清理责任 |
|---|---|---|
| 指标实例 | Runtime | Runtime |
| Series | 指标通过 SDK | VisualSlot；同 key 同类型时复用，类型变化时替换，删除实例时释放 |
| Pane | Runtime 按 instanceId + paneKey | VisualSlot；`addPane(true)` 保留空 Pane |
| Canvas Primitive | 指标通过 SDK | VisualSlot；按稳定 key 重绑定 |
| HTML Overlay | 指标通过 SDK | VisualSlot；按稳定 key 重绑定 |
| 图表事件监听 | 指标通过 SDK | ExecutionScope；每次重建释放 |
| 指标自有非图表资源 | 指标 | `destroy()` |

`ExecutionScope` 提供受控的 timeout、interval 和 animation-frame 注册接口，避免 AI 指标留下无法回收的定时任务。重建顺序固定为：停止事件分发 → 调用实例 `destroy()` → 逆序释放 ExecutionScope → 开启 VisualSlot 重绑定事务并清空 Series/Overlay/Canvas 旧画面 → 创建新实例并认领稳定 key → 对类型变化的 Series 做槽内替换 → 提交事务、恢复顺序并清理未认领视觉资源。删除实例时再释放整个 VisualSlot。旧执行句柄后续调用必须给出明确诊断，不能静默操作新上下文。

Runtime 分别捕获：

- 注册失败；
- 参数校验失败；
- 创建失败；
- K 线更新失败；
- 盘口/成交回调失败；
- 绘图失败；
- 销毁失败。

一个指标失败时：

- 停止更新该指标；
- 清理该指标拥有的资源；
- 保留主图、行情和其他指标；
- 界面显示“指标运行失败”；
- 控制台记录指标 ID、阶段、当前代次和错误；
- 不吞掉错误，也不把错误伪装成“暂无数据”。

同一上下文中失败后不自动循环重试，用户可点“重试指标”。当参数、Provider、证券、周期、复权或所需 stream epoch 变化时，Runtime 对失败实例自动尝试一次新建；若仍失败则保持错误状态，不因每个行情事件反复创建。重建失败时保留 Pane 和用户布局，但清空旧证券的视觉数据，避免把旧结果显示成当前结果。

这里的隔离是“SDK 不提供其他指标和主图的可变句柄”，不是安全沙箱。源码可信插件仍运行在同一个前端上下文，理论上可以导入全局模块、访问 DOM 或消耗 CPU；Overlay 的 ShadowRoot、冻结的数据快照和受控句柄只能降低误伤，不能对恶意代码作安全承诺。

建议诊断事件：

```text
indicator.registered
indicator.activated
indicator.data_applied
indicator.update_failed
indicator.render_failed
indicator.disposed
```

高频事件不得逐笔无条件打印。`data_applied` 采用周期汇总或开发诊断开关，避免日志本身拖慢订单流。

## 16. 性能和调度

- 当前约 250ms 的指标刷新间隔可以作为初始性能参数，但覆盖式的单一 `pendingRealtimeIndicatorTime` 不是要保留的语义。先完成 §8 的换根丢更新修复，再迁入 Runtime；
- Runtime 在调度窗口内合并所有已接受变更，保存最小 `changedFrom` 和全部收盘边界；节流只能减少回调次数，不能跳过已收盘 bar 的最终状态；
- 盘口可只传最新已接受快照；
- 逐笔成交以批次传递，不能先裁剪为 UI 最近 100 条；
- 一个批次内保持事件顺序；
- 隐藏指标继续接收数据；只有删除或上下文重建才停止分发；
- 指标回调按启用顺序运行，但一个指标报错不停止后续指标；
- SDK v1 不擅自跳过正确数据，也不设置没有基线依据的固定耗时阈值；
- 实施前记录当前五个指标和盘口渲染基线，实施后使用相同场景比较；
- 开发模式记录慢指标耗时和资源数量，正式模式默认不产生高频日志；
- 后续若同步指标确实阻塞 UI，再以实际剖析证据设计 Worker 计算接口。

## 17. AI 开发文档

新增 `docs/TradeFlow Lite 指标开发指南.md`，内容必须包括：

1. 复制最小模板；
2. 指标文件命名和 ID 规则；
3. K 线字段和时间单位；
4. 参数 Schema；
5. 主图 Series 示例；
6. 副图 Series 示例；
7. Canvas 任意绘图示例；
8. HTML Overlay 示例；
9. 盘口和逐笔成交示例；
10. 主题、坐标、缩放和实时更新；
11. 默认使用全量公式计算和 `setValues`，以及 ZigZag/枢轴/分形何时必须填写 `dirtyFrom`；只有剖析和等价性测试通过后才写增量公式；
12. `trade`、`aggregate-trade`、主动方、数量是否可信、Rust 提供的 `barTime` 及丢批次处理；同时说明 prediction/Polymarket 在 v1 不开放；
13. 累计订单流发生缺口后的统一表现：本地队列溢出确定性重开并显示累计起点，Provider 未知边界缺口持续显示不完整；
14. 禁止直接操作 `main.ts`、全局 DOM 和行情连接；
15. 调试和验证命令；
16. AI 生成指标时的提示词模板；
17. 发布前自检清单。

建议用户提示词：

> 请阅读 `docs/TradeFlow Lite 指标开发指南.md`，在 `src/indicator-plugins/user/` 新增一个指标。不要修改行情源和 `src/main.ts`。使用 SDK 获取当前 K 线和逐笔成交，在 K 线上通过 Canvas 绘制信号，并通过 HTML Overlay 在右上角显示统计信息。完成后运行指标插件契约、UI 契约和构建。

## 18. 旧能力保留清单

| 当前能力 | 新方案责任位置 | 必须验证 |
|---|---|---|
| MA20 主图线 | SeriesLayer + MA 插件 | 数值、颜色、启停、实时末端 |
| EMA20 主图线 | SeriesLayer + EMA 插件 | 种子、数值、启停、实时末端 |
| BOLL 三线 | SeriesLayer + BOLL 插件 | 上中下轨数值和显示 |
| BOLL 色带 | CanvasLayer + BOLL 插件 | 填充范围、层级、显隐 |
| BOLL 突破标记 | SeriesLayer MarkerContribution | 首次突破语义、不重复提示、与其他 Marker 合并 |
| BOLL K 线变色 | 主序列样式贡献 | 启用生效、关闭恢复基础颜色 |
| MACD 双线与柱 | 多 Series + 副图 | 有效起点、正负色、移除副图 |
| RSI14 | SeriesLayer + 副图 | Wilder 数值、启停、移除副图 |
| 切证券时保留副图 | VisualSlot + addPane(true) | Pane 不删重建、用户高度不跳、无闪烁 |
| 指标对象树 | Runtime 元数据 | 显隐、排序、删除 |
| 主图成交量/指标顺序 | mainOverlayOrder + stable Series key | 调整后切证券、改参数、重启仍一致 |
| 设置恢复 | 新状态存储与迁移 | 旧版设置、损坏状态、缺失插件 |
| 深历史替换 | DataRouter | 不跳回最新、不残留旧结果 |
| 实时指标更新 | DataRouter + Runtime | 同窗 N 收盘/N+1 开盘都正确；股票 5 秒轮询能确认换根；加密连接态 60 秒 reconciliation 可纠错 |
| 无效行情保留旧图 | 行情层保持原责任 | 指标接口不得清空有效主图 |
| 预测市场禁用指标 | Registry applicability | 现有禁用规则不被动态菜单绕过 |
| 当前固定参数默认值 | 输入 Schema 与迁移 | 数值、种子和默认视觉不因开放编辑而漂移 |

## 19. 系统风险枚举

| 位置/状态 | 可能故障与用户影响 | 处理责任 | 验证 |
|---|---|---|---|
| 指标注册 | 重复 ID 或坏定义导致启动失败 | Registry 拒绝单项，主图继续启动 | 重复 ID、空 ID、错误版本 fixture |
| 初次加载 | `create()` 与首批数据顺序错误导致空图 | Runtime 先建资源，再统一派发 initial | 冷启动启用指标 |
| 快速切换证券 | 旧指标结果覆盖新证券 | 先停分发，销毁 Execution，内部 selection token 拒绝迟到事件 | 延迟旧更新后快速切换 |
| 切周期/复权 | 指标保留旧计算，或删 Pane 导致闪烁/高度跳变 | 重建 Execution，保留 VisualSlot 与 `addPane(true)` Pane | 多次往返切换并对比 Pane DOM 数量、高度和主图叠放顺序 |
| 深历史补齐 | 数据前插后增量缓存失效 | `changedFrom` 指向最早变化 | 300 根到深历史替换 |
| 实时 K 线 | N 收盘被 N+1 开盘覆盖或跨帧晚到后被拒绝，指标缺最终值 | 按 time 合并；closed 粘性；只允许 closed 更新精确倒数第二根 | 同帧及跨帧分别输入 N closed + N+1 open |
| Binance 聚合换根 | 晚到 N 收盘把 Rust 当前状态从临时 N+1 退回 N，导致 N+1 开高低丢失 | 仍发出 N 收盘，但只允许同周期或更新周期 K 线替换 current | t1、t2、晚到 N close、t3 顺序单测 |
| 股票轮询换根 | 把 5 秒轮询误当纠错，股票指标永远无收盘确认 | 轮询更新走 realtime；以 newer-bar/session-end 标记收盘依据 | A 股交易时段 5 秒轮询跨根及收盘 |
| 回看确认指标 | ZigZag/枢轴/分形修改 changedFrom 以前的点，图上残留旧值 | `dirtyFrom` 下调更新起点；开发态比较旧值告警 | 新 K 线确认旧拐点并撤销旧 whitespace/marker |
| 盘口与成交 | pending/flush 两次裁剪或错误 tradeId 假设导致漏成交 | 校验后、首次裁剪前分流；按 Provider 语义去重 | 超过 100 条、乱序和聚合成交仍有正确完整性标记 |
| 指标批次队列 | 高峰溢出后下一批又假装累计完整，或整天停在降级 | 本地溢出后以下一条事件确定性重开订阅；只有 Provider 未知边界缺口持续降级 | 分别模拟本地溢出和 Provider 未知缺口 |
| 成交语义 | 聚合成交被当成逐笔，或 prediction 数据绕过禁用 | Provider 映射、eventKind、quantityKnown、aggressorSide | Binance/OKX 映射与 Polymarket 不分发 fixture |
| 时间语义 | 本机接收时间冒充交易所时间 | exchangeTimeMs/receivedTimeMs 分离 | Provider 字段对拍 |
| 成交时间分桶 | TypeScript 复制 Rust 周线/月线规则后漂移 | Rust 标准事件直接携带 `barTime` | 各 Provider Rust fixture 与 K 线时间对拍 |
| 高频事件 | 指标计算阻塞界面 | 统一调度批次、耗时观测 | 持续成交与缩放同时发生 |
| Overlay 定位 | 把 div 插入 Pane `<tr>` 撑乱布局，或多 Pane 偏移 | 外层 OverlayHost + 公开尺寸测量 | 主/副图、左右价格轴、分隔拖动与窗口缩放 |
| Overlay 样式 | ShadowRoot 内样式失效或插件 CSS 污染全局 | `setStyles(cssText)`；静态禁止全局 CSS import | 同名 class 隔离 fixture |
| Canvas | 高 DPI 模糊或坐标漂移 | v1 固定 CSS/media 坐标，插件不乘 DPR | 不同缩放倍率和 Retina |
| Canvas 价格坐标 | 裸 Pane 没有 Series 价格转换却暴露 priceToY | 判别 Canvas target，价格坐标必须锚定 Series | 主序列切换与独立 Pane |
| 资源销毁 | 重建误删视觉资源，或删除后残留监听/Pane/DOM | ExecutionScope 逆序回收；VisualSlot 事务重绑定/删除 | 反复切换上下文及启用/删除 50 次 |
| 资源重绑定 | 同 key 的 Series 类型变化无法复用，或首帧残留旧 Overlay/Canvas | 类型不同时槽内替换；重建开始先清空全部旧视觉回调和内容 | line→histogram、快速切证券首帧 |
| 指标异常 | 一个指标让主图空白 | 指标级捕获、停用和清理 | create/update/draw/destroy 分别抛错 |
| 状态迁移 | 加载失败插件在下一次保存时被抹掉 | unresolvedEntries 原样回写 | 插件求值失败后修改其他设置再恢复插件 |
| 主题变化 | 用户图层不可读 | theme 事件和 CSS 变量 | 暗色/亮色往返 |
| 主 K 线样式 | 多指标颜色互相覆盖且不能恢复 | 稳定优先级和贡献撤销 | 两个贡献交错启停 |
| 主图叠放顺序 | 重建 Series 打乱成交量/MA/EMA/BOLL 顺序 | VisualSlot 复用 + mainOverlayOrder | 调整顺序后切证券、改参数、重启 |
| 缺少数据源能力 | 把无盘口当作零盘口 | capabilities 明确不可用 | 支持/不支持的证券切换 |
| 未声明数据依赖 | 插件调用 onTrades/onDepth 却永远收不到数据 | create 阶段立即报错；epoch 只重建声明依赖者 | 缺失 requires 的错误 fixture |
| 插件可信边界 | AI 代码访问任意前端权限 | v1 明确为源码可信插件 | 文档、评审和构建门；不声称沙箱 |
| 插件加载 | eager 顶层异常导致全应用白屏 | lazy glob + 每模块捕获；构建错误仍明确失败 | 顶层 throw fixture 与语法错误构建 fixture |
| 启动恢复 | lazy Registry 未完成就恢复导致指标闪现或状态丢失 | builtins 同步、外部模块 settled 后一次恢复 | 慢模块、失败模块与正常模块并存 fixture |
| 共享数据 | 冻结 currentBars 破坏主链路，或全量深冻拖慢实时 | 独立 DTO 缓存；只冻结新增/替换 Bar 与新外层数组 | 原地 push 回归、12000 根实时更新与 mutate fixture |
| 市场分类 | SDK 自建联合类型漏掉 ETF/指数 | 复用 MarketSymbolKind | stock、etf、index、crypto、prediction 菜单适用性 |
| Overlay 截图 | 用户误以为 Table 会进入图表截图 | v1 明确不包含并在文档提示 | takeScreenshot 对照 |

## 20. 实施顺序

### 阶段 A：记录基线并先修实时换根缺陷

- 记录当前 Git 基线和未提交状态；
- 为五个指标的计算、显示、隐藏、排序和实时更新补齐行为契约；
- 记录当前盘口/逐笔成交接收、序列过滤和 UI 批次行为；
- 先增加并修复两种换根顺序：同一调度窗口内 N 收盘后 N+1 开盘，以及第一帧先应用 N+1、第二帧才收到 N 收盘；后者只允许 Provider 标准化为 `source='kline'` 且 `closed=true` 的权威收盘事件替换精确倒数第二根，并要求 Rust 不回退已推进到 N+1 的聚合状态。这是 SDK M1 的前置任务，不纳入旧行为保护；
- 为 A 股 5 秒轮询补“出现 N+1 即确认 N 收盘”和 session-end 最后一根确认契约，区分 `closedBy`；
- 不先删除当前 `refreshIndicators()`。

### 阶段 B：M1 建立 K 线 SDK 骨架

- 完成 contracts、definition validation、registry 和 resource scope；
- 完成 Series、Canvas 两个基础出口、主序列样式/Marker 贡献；
- 完成 K 线开发指南、最小 Series 示例和 Canvas 示例；
- 使用测试插件验证生命周期和 Schema 类型推导，不改变正式指标菜单。

### 阶段 C：M1 接入 K 线数据路由

- 接入历史、WebSocket 实时、股票/降级 5 秒轮询实时和连接态 reconciliation 事件；
- 切换证券、周期、复权时按确定顺序销毁重建；
- 加入图表种类和市场种类适用性声明。

### 阶段 D：M1 迁移内置指标

迁移顺序：

1. MA、EMA：验证最简单主图 Series；
2. RSI：验证独立副图；
3. MACD：验证多 Series 和柱图；
4. BOLL：验证多 Series、Canvas、标记和主 K 线样式贡献。

每迁移一组即运行已有指标契约，不等到全部改完才发现回退。

### 阶段 E：M1 动态菜单和状态迁移

- 指标菜单改由 Registry 生成；
- 对象树改读 Runtime 元数据；
- 固定联合类型改为动态稳定 ID；
- 完成现有本地设置向新结构迁移。

M1 到这里必须独立达到可用状态：五个内置指标和一个按开发指南新增的 K 线指标均经新接口工作。不能等待订单流或完整指南完成后才第一次验收基础架构。

### 阶段 F：M2 接入订单流与 Overlay

- 扩展 Provider 静态能力声明与运行状态；
- 在序列校验后、UI 首次裁剪前建立独立指标批次；
- 接入盘口快照、成交语义、完整性标记，以及 Rust 标准事件直接提供的 `barTime`；
- 为每个 Provider 记录“可证明连续”与“只能判断新旧”的字段规则；
- 完成 HTML Overlay 与样式作用域；
- 以真实 Binance/OKX 链路验证，不新增连接。

### 阶段 G：M2 扩展开发文档

- 提供 HTML Overlay 示例；
- 提供实时订单流示例；
- 补充 Provider 映射、订阅完整性与累计起点说明；
- 验证用户只新增一个 `*.indicator.ts` 文件即可被发现。

### 阶段 H：完整验收

- 自动测试和构建；
- 最新 Lite Tauri 开发版真实交互；
- 股票与数字货币分别验证；
- 盘口和逐笔成交必须在真实行情中持续变化；
- 不提交、推送、打包、安装或发布，除非用户另行明确要求。

## 21. 验收标准

### 21.1 接口验收

- 一个新指标只需要新增一个 `*.indicator.ts` 文件；
- 不修改 `src/main.ts` 即可进入指标菜单；
- 同一指标能添加多个实例并分别保存参数、顺序和 Pane 布局；
- 重复 ID、非法参数、不兼容 SDK 版本和单模块顶层异常能明确失败；
- select 默认值不在 options、插件副图使用保留 key `'main'` 时，注册或创建明确失败；
- `defineIndicator()` 能从 `inputs` Schema 推导 `inputs.period` 等精确类型；类型 fixture 对正确代码通过、错误字段和错误值类型编译失败；
- Series、Canvas 和 Overlay 都能由测试插件创建、更新和销毁；
- SDK 不向指标暴露删除或修改其他图表资源的句柄；文档不宣称这是安全沙箱；
- 插件示例和契约类型由专用 TypeScript 检查覆盖，不存在“示例未进入 tsconfig 却声称已通过”的空验收。
- builtins 在恢复前同步可用，user/contributed lazy 模块 settled 后只执行一次布局恢复；加载失败插件的原始状态在后续保存中仍保留。
- DataRouter 不冻结或替换 `currentBars` 的可变主链路；同一快照内叶子 DTO 不可修改，未变化 Bar 的 DTO 身份跨实时事件复用。

### 21.2 生命周期验收

- 启用、隐藏、显示、删除和重启恢复正确；
- 切证券、周期、复权后不残留旧结果；
- 上述变化均停止旧分发、销毁旧 Execution 并创建新 Execution；VisualSlot、Pane 对象、用户高度和主图叠放顺序保持不变，不发生删 Pane 闪烁；
- 切到 prediction 或缺少指标所需成交/盘口能力的证券时不创建 Execution，旧视觉立即清空、空 Pane 和用户高度保留；切回适用证券后恢复；
- 同 key Series 类型由 line 改为 histogram 时正确替换并恢复顺序；重建后的第一帧不出现旧 Overlay DOM 或旧 Canvas draw；
- 深历史加载后指标重算且可见范围不被破坏；
- 实时当前 K 线与新 K 线都能推进指标；
- 同一调度窗口依次收到 N `closed=true` 与 N+1 `closed=false` 时，两根都进入 `realtimeUpdates`，N 的最终 MA/BOLL/样式/Marker 不丢失；
- 第一帧先应用 N+1、第二帧才收到 N `closed=true` 时，N 精确替换倒数第二根并刷新指标；普通未收盘旧根或早于倒数第二根的事件仍拒绝；
- A 股交易时段 5 秒 `count: 2` 轮询通过 `reason='realtime'` 推进指标；出现 N+1 时 N 带 `closedBy='newer-bar'`，收市最终拉取可带 `closedBy='session-end'`；
- 加密货币 WebSocket 正常连接时的 60 秒 `count: 2` 轮询通过 `reason='reconciliation'` 修正两根 K 线、给出最小 `changedFrom`，且不伪造交易所收盘；
- ZigZag/枢轴/分形 fixture 使用 `dirtyFrom` 更新 `changedFrom` 以前的值，开发模式对遗漏的 dirtyFrom 给出明确告警；
- 反复启用/删除后 Series、Pane、Primitive、Overlay 和监听数量回到基线；
- 单个指标抛错时主图和其他指标继续工作；
- 同一上下文不循环重试失败指标；切换 Provider/证券/周期/复权后只自动重试一次，重试期间保留布局但不显示旧证券数据；
- 隐藏订单流指标期间继续累计，重新显示后与未隐藏对照一致；
- 销毁后所有 SDK 句柄失效，定时器、帧回调和监听器回到基线。

### 21.3 订单流验收

- 能力声明与当前证券实际数据源一致；
- 未声明 `requires.trades`/`requires.depth` 却订阅对应数据时在 create 阶段明确失败；
- 指标接收的数据已经通过当前选择和序列校验；
- 超过 UI 最近 100 条限制时，测试指标累计值仍覆盖全部已接受成交；
- 中途启用或改参数后的累计起点等于该实例的 `subscriptionStartedAtMs`，不会冒充 stream epoch 或交易时段起点；
- 本地队列溢出后，当前订阅先收到不完整状态，下一条已接受事件建立新订阅并触发依赖实例重建；新结果显示“自 HH:MM:SS 起”，不得整天停留在降级状态；
- Provider 层报告无法定位新起点的缺口时持续降级；随后即使正常批次持续到达，也不恢复完整，直到重连、source reset 或其他可证明的新边界；
- Binance 聚合成交标为 `aggregate-trade`，OKX `trades-all` 标为 `trade`，Polymarket 在 v1 不向指标分发；
- 交易所时间与本机接收时间字段符合各 Provider 原始事件；
- 每条成交携带 Rust 生成的当前周期 `barTime`，值与对应图表 `IndicatorBar.time` 完全相同；固定分钟、周线、月线及 Provider 特殊周期 fixture 均一致，TypeScript 不存在第二套分桶实现；
- 切换证券后旧成交不进入新指标；
- 关闭订单流指标不关闭主图仍使用的实时连接；
- Binance/OKX 实际可用市场中盘口、成交和指标输出持续更新；
- 明确标注当前没有历史订单流和完整 MBO。

### 21.4 回归门

至少运行：

```sh
npm run test:ui
npm run test:contracts
npm run build
git diff --check
```

并增加：

```sh
node scripts/check-indicator-sdk.mjs
npx tsc -p tsconfig.indicator-examples.json --noEmit
node scripts/check-indicator-plugin.mjs src/indicator-plugin-examples/
```

`check-indicator-plugin` 分成两层：静态定义/Schema 检查可在 Node 运行；需要 DOM 和 Lightweight Charts 的生命周期、资源回收和绘制检查使用受控浏览器 fake host，不能让 Node `import` 成功代替真实宿主。

当前五个指标、图表设置、对象树、Marker、实时市场和时间导航的既有契约必须继续通过。若实施触及 Rust Provider 描述符或事件字段，再运行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

若实施触及行情数据处理，再按项目规范运行：

```sh
npm run test:real-market
npm run test:real-binance-ws
npm run test:real-binance-usdm-ws
npm run test:real-okx-ws
```

这些命令已存在于当前 `package.json`。M2 订单流接口仍必须在真实数字货币 Tauri 数据流中观察盘口、成交和指标输出持续变化；实盘测试脚本不能代替桌面数据路由验收。

### 21.5 视觉验收

在最新 Lite Tauri 开发版中检查：

- 新指标自动出现在菜单；
- 主图和副图缩放、滚动、排序、显隐正常；
- Canvas 元素跟随时间和价格移动；
- 蜡烛、线、面积等主图类型切换后 Canvas 价格锚点和样式适用性正确；
- Overlay 在窗口缩放和 Pane 调整后位置正确；
- Overlay 默认不阻挡图表拖动和缩放；
- 暗色与亮色主题可读；
- 图表截图不包含 HTML Overlay，界面和文档对此表现一致；
- OverlayHost 不向 Lightweight Charts 返回的 `<tr>` 插入节点；多 Pane、左右轴、分隔线拖动后 Table 仍与目标绘图区对齐；
- Overlay 的 `setStyles()` 只影响自身 ShadowRoot，插件全局 CSS import 被检查器拒绝；
- 数字货币订单流示例持续变化；
- 最终视觉仍由用户确认，自动测试不替代视觉接受。

## 22. 完成定义

M1 完成后可以称为“通用 K 线指标接口可用”；只有 M1 与 M2 都满足以下条件，才能称为“通用指标接口完成”：

1. SDK、Runtime、三种绘图出口和市场数据接口已实现，其中 Canvas 的 Pane 与 Series 坐标能力边界真实；
2. 当前五个内置指标通过新接口运行，旧行为没有丢失；
3. 用户只新增一个指标文件即可注册，无需修改核心入口；
4. AI 开发文档和可复制示例已完成；
5. 生命周期、错误隔离、资源回收和状态迁移测试通过；
6. `npm run test:ui`、相关契约、`npm run build` 和 `git diff --check` 通过；
7. 最新 Lite Tauri 开发版完成真实交互检查；
8. 订单流接口完成真实数字货币盘口和逐笔成交验证；
9. 代码完成、测试通过、桌面可用、提交、推送和发布分别报告，不互相替代。

## 23. 审查问题处理结论

本方案已经处理五轮审查中影响架构的意见：

- 生命周期统一为上下文变化即重建 Execution、保留 VisualSlot，取消让插件自行 reset 的隐含责任，也避免副图和主图顺序跳动；
- 同一指标允许多个 `instanceId`，并区分 SDK 版本与指标版本；
- 对齐 K 线的 Series 增加 `setValues(event, values)`，避免实时逐 tick 全量 `setData()`；
- 订单流在首次 UI 裁剪前分流，保留 Provider 真实事件种类、时间和完整性；
- 订单流完整性按订阅者计算，并明确 Binance/OKX/Polymarket 的 v1 映射；
- Canvas 不再承诺裸 Pane 的价格坐标，价格转换必须锚定 Series；
- BOLL 的 Marker 与主 K 线变色都有受控贡献接口和旧行为回归项；
- 插件改为 lazy glob 单模块求值隔离，同时明确语法/类型错误仍会阻止构建；
- “不能修改其他指标”改为 SDK 句柄边界，不再把源码可信插件描述成沙箱；
- 示例纳入 TypeScript 检查，DOM/LWC 生命周期使用浏览器 fake host；
- Overlay 改挂平台外层 OverlayHost，不再误用实际为 `<tr>` 的 `pane.getHTMLElement()`，样式只通过 ShadowRoot `setStyles()` 注入；
- 先修复 N 收盘被 N+1 开盘覆盖的现有实时缺陷，换根正确性成为 M1 前置门；
- `setValues` 支持按 Series 类型推导的逐点样式，MACD 正负柱不退回全量更新；
- 未识别插件状态原样保留，builtins 同步注册、lazy 插件 settled 后一次恢复；
- 主图成交量与各指标实例的叠放顺序使用独立 `mainOverlayOrder` 保存；
- 股票和加密断线时的 5 秒轮询被定义为正式实时来源，并用 `closedBy` 区分交易所、新根和收市确认；
- 默认示例恢复为“全量公式计算 + `setValues`”，会回改历史点的公式通过 `dirtyFrom` 下调绘图更新起点；
- 本地订单流队列溢出固定从下一条事件建立新订阅并显示起点，只有 Provider 无法定位边界的缺口持续降级；
- 成交所属 `barTime` 由 Rust Provider 产生并以 fixture 对拍，不在 TypeScript 再复制分桶算法；
- 不适用证券保留空 Pane 和用户高度；Series 类型变化时槽内替换，Overlay/Canvas 在重绑定首帧前清空；
- 未声明数据依赖却订阅、select 默认值非法和副图占用保留 key `'main'` 都要求明确失败；
- 换根前置修复同时覆盖同帧与跨帧到达：前端只让晚到的权威 K 线收盘更新精确倒数第二根，Rust 不让旧周期 K 线回退临时新周期状态；
- 订单流 `barTime` 明确复用对应图表 `IndicatorBar.time` 的规范时间键；当前 Lite 使用周期结束边界，本方案不暗中改成开盘时间；
- 交付拆成 M1 与 M2，各自有独立可用性与验收门。

## 24. 最终原则

TradeFlow Lite 负责提供稳定的指标生命周期、受控数据和通用渲染基础；指标作者负责公式和具体视觉。平台不追逐无限图元清单，也不把完整图表控制权交给用户指标。

因此，SDK v1 的稳定核心是：

```text
通用指标接口
= 指标定义与参数
+ K线/盘口/成交数据输入
+ Series/Canvas/Overlay 绘图出口
+ 生命周期与资源回收
+ 状态保存与错误隔离
+ AI 开发文档和验证工具
```

这套基础完成后，标签、Table、订单流面板和未来未知图形都由用户或 AI 在指标插件中实现，不再要求 Lite 核心为每一种视觉元素单独开发接口。
