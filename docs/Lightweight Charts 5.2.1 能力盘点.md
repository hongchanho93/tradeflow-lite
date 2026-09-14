# Lightweight Charts 5.2.1 能力盘点

盘点日期：2026-09-12
对象：TradingView 官方 npm 包 `lightweight-charts@5.2.1`

## 下载与验证

- 官方包：`vendor/lightweight-charts-5.2.1.tgz`
- 展开目录：`vendor/lightweight-charts-5.2.1/`
- npm 版本：`5.2.1`
- 许可证：Apache-2.0
- 压缩包大小：616.6 kB；展开约 3.1 MB
- npm 完整性：`sha512-IVwoK1RLFiLPubaKIjNbtjWLnpPMqiABSrTay6whmNa8L1+19292VtHJ+BWyPUuLCwF0tcQlhEWd1CLB2a1nsQ==`
- 本地重新计算的 SHA-512 Base64 与 npm 完整性值一致。
- 在隔离临时目录执行正式 npm 安装和 ES Module 导入成功；实际依赖为 `fancy-canvas@2.1.0`。

展开目录用于审查包内容，不应作为正式应用的直接引用方式。正式项目应固定 npm 依赖版本并生成锁文件，让包管理器同时安装 `fancy-canvas`。

## 原生提供的能力

### 图表和序列

- K线图（Candlestick）
- 美国线/柱状 OHLC（Bar）
- 折线图（Line）
- 面积图（Area）
- 基准面积图（Baseline）
- 柱状图（Histogram），适合成交量和 MACD 柱
- 自定义 Series，可绘制库未内置的图形
- 收益率曲线图（Yield Curve），Lite 首版不需要

### 图表交互

- 鼠标滚轮缩放、双指缩放
- 鼠标和触摸拖动
- 时间轴和价格轴缩放
- Crosshair，支持普通和磁吸模式
- 单击、双击、Crosshair 移动事件
- 自动适应容器大小
- 自动缩放、手动价格范围、价格轴反转
- 普通、百分比、指数到 100、对数价格轴模式
- 滚动到实时位置、适配全部数据、指定可见范围
- 时间和坐标互相转换，适合图表联动

### 多 Pane 和指标显示

- 可创建、删除、排序 Pane
- Series 可以移动到其他 Pane
- Pane 支持拖动调整高度
- 支持左右价格轴和叠加价格轴
- 支持 Series 显示顺序控制
- 成交量可以直接使用 Histogram 放在独立 Pane
- MACD、RSI 等指标可以使用 Line/Histogram 组合显示

### 实时与历史加载接口

- `setData()`：设置或整体替换历史数据
- `update()`：增加最新数据，或更新当前未结束的 K 线
- `historicalUpdate`：允许修改旧数据，但官方标明其性能低于更新最新数据
- `barsInLogicalRange()`：判断左侧剩余 K 线数量，可用于拖动加载更早历史
- 可监听可见时间范围和逻辑范围变化
- 支持读取 Series 当前数据、最后值和指定位置的数据

这些只是图表消费数据的接口。库本身不连接行情主站，也不负责历史请求、重连、缓存或周期聚合。

### 标记、覆盖物和扩展

- Series Markers：圆点、方块、上箭头、下箭头及文字
- 自动涨跌更新标记
- 自定义价格线
- 文字水印和图片水印
- Series Primitive 和 Pane Primitive 插件接口
- Primitive 支持 Canvas 自定义绘制、分层和鼠标命中测试
- 自定义 Series 支持完全自定义一种数据图形
- 图表截图 API，可输出 Canvas

## Lite 需求对应情况

| Lite 需求 | 库是否直接提供 | 需要我们的工作 |
|---|---|---|
| K线、Bar、Line、Area | 是 | 样式和产品封装 |
| 缩放、拖动、价格轴、时间轴 | 是 | 统一配置 |
| Crosshair | 是 | 样式和数值面板 |
| Tooltip / OHLC 信息栏 | 否 | 监听 Crosshair 后自行做 HTML UI |
| 最新价格线 | 基础能力有 | 配色、涨跌和状态规则 |
| 涨跌显示 | 部分 | 自行计算并制作顶部行情信息 |
| 成交量独立 Pane | 是 | 成交量计算、颜色和 Pane 管理 |
| 实时更新当前 K 线 | 接口有 | Rust 行情源、聚合、纠错和轮询逻辑 |
| 拖动加载历史 | 接口有 | 历史分页、去重和请求调度 |
| 1/5/15/30/60 分、日周月 | 否 | 后端取数及周期聚合 |
| MA/EMA/BOLL/MACD/RSI 等指标 | 不内置 | Lite 自行实现公式；主项目相关模块是 Advanced Charts/PineJS 格式，不能直接搬用 |
| 指标参数面板 | 否 | 自行实现 UI 和本地存储 |
| 深色/浅色主题 | 样式 API 有 | 设计主题令牌和切换逻辑 |
| 品种搜索 | 否 | 本地品种目录和 UI |
| 自选列表 | 否 | 自行实现并本地保存 |
| 数据源/Data Provider | 否 | Lite 自己定义薄接口 |
| 画线工具 | 不内置成品 | 以后用 Primitive 实现；v0.1 不做 |
| 提醒、交易、订单 | 否 | Lite 不做 |

## 关键边界

Lightweight Charts 是渲染引擎，不是 TradingView 完整图表产品。它不会提供：

- 行情数据源或 Datafeed；
- 品种搜索、自选和市场列表；
- 技术指标计算引擎；
- 成品 Tooltip、图例或指标参数窗口；
- TradingView 完整画线工具；
- 布局云同步、提醒、交易或账户系统；
- 数据正确性、断线恢复和高可用。

以上能力需要 Lite 自己实现，或者从 TradeFlow 已有实现中抽取。

对本地 5.2.1 发布包的类型定义和导出内容检索后，没有发现 MA、SMA、EMA、MACD、RSI 或 BOLL 计算 API。这里的“支持显示 MACD/RSI”仅表示它能用 Line、Histogram 和独立 Pane 把我们算好的数值画出来，不表示图库会计算指标。

## v0.1 指标与图库能力映射

| 内置指标 | Lite 计算 | Lightweight Charts 渲染 |
|---|---|---|
| VOL | 每根 Bar 的成交量和涨跌色 | 独立 Pane 的 Histogram |
| MA | 指定窗口的简单移动平均 | 主图 Line Series，可多条 |
| EMA | 指定窗口的指数移动平均 | 主图 Line Series，可多条 |
| BOLL | 中轨与上下轨 | 主图三条 Line Series |
| MACD | DIF、DEA、柱值 | 独立 Pane 的两条 Line + Histogram |
| RSI | 指定窗口 RSI | 独立 Pane 的 Line + 水平价格线 |

这组六个指标都不需要修改图库源码或使用 Primitive，足以覆盖首版常见主图线、副图线和副图柱。产品范围上先保证 `VOL/MA`，再从其余四个中选择少量随 v0.1 交付。指标参数面板、计算、增量更新、缓存和测试均由 Lite 实现。

## 对 Lite v0.1 的建议

直接采用原生能力：

- Candlestick 为默认主图，保留 Bar、Line、Area 切换；
- Histogram 独立 Pane 显示成交量；
- 使用多 Pane 显示已有的基础指标；
- 使用 `update()` 更新当前 K 线；
- 使用 `barsInLogicalRange()` 触发加载更早历史；
- 使用 Crosshair 事件制作顶部 OHLC/涨跌信息；
- 使用官方价格线、Marker 和水印，不重复造轮子；
- 开启自动尺寸、鼠标/触摸缩放和 Pane 调整。

暂不开发：

- 自定义 Series；
- 通用 Primitive 插件平台；
- 完整画线工具；
- Yield Curve；
- 用户导入指标源码或第三方指标源；
- 库内不存在、TradeFlow 主项目也没有的图表能力。

## 工程注意事项

1. 使用 v5 API：通过 `chart.addSeries(CandlestickSeries, options)` 创建 Series，不能照抄 v4 的 `addCandlestickSeries()` 示例。
2. 时间必须严格升序；实时更新只能自然追加或覆盖最后一根。修订旧 K 线可以使用 `historicalUpdate`，但应控制频率。
3. 分钟线时间、交易时段、周月聚合和空档处理必须由 TradeFlow/Lite 数据层统一负责，不能交给图表库猜测。
4. 图表库只渲染传入内容，所以“页面在动”不能证明行情正确或实时链路完整。
5. Apache-2.0 允许开源使用，但官方要求保留许可、NOTICE 归属信息，并在用户可见页面提供 TradingView 链接；可以保留默认 attribution logo 满足链接要求。
6. 当前下载的是官方发布包，不是 GitHub `master` 开发快照。后续升级必须先核对迁移说明和回归现有图表行为。

## 当前结论

`lightweight-charts@5.2.1` 足以承担 TradeFlow Lite v0.1 的图表渲染层，而且原生多 Pane、Pane 调整、实时 `update()`、历史范围监听和插件接口已经覆盖了首版所需的底座。

它不能替代 TradeFlow 已有的数据、指标和产品 UI。Lite 保留官方库原生渲染能力，由 Rust 行情层提供数据，并复用已验证的周期、时间和复权规则；基础指标使用独立的小型 TypeScript 计算模块。Lite 不复制 Advanced Charts/PineJS 指标格式。
