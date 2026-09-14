# TradeFlow Lite AI 协作规则

本项目是独立开源的 TradeFlow Lite。全程用中文沟通；先核对实际代码、运行状态和错误证据，再修改。保护现有未提交改动，未经用户明确要求，不提交、推送、打包、安装或发布。

## 开发原则

- 只实现用户要求的范围，先读相关调用方、样式和测试，保持现有命名与结构。
- 遇到问题先确认根因；补能复现问题的契约或测试，再修复并验证相关旧能力。
- 区分代码完成、自动测试、开发版运行、已安装 App 和正式发布，不用其中一项代替另一项。
- UI 修改不得顺带改变行情、缓存、复权、指标、绘图或证券分类语义。

## UI 权威来源

UI 工作开始前按以下顺序取证：

1. 本项目根目录 [`ui-design-extract/`](ui-design-extract/) 中的原始 CSS、SVG、布局值和组件资料。
2. 主项目 `/Users/jim/Documents/TAURI+RUST` 的当前实现及 `~/Applications/Trade Flow.app` 的实际效果。
3. 用户提供的截图，仅用于识别差异和最终视觉确认。

必须优先复用 `ui-design-extract/` 中已有元素，不凭截图重画 SVG，不自行发明按钮、菜单或交互位置。使用原 SVG 时保留其 `viewBox` 和路径；显示尺寸、容器、间距、行高及颜色要按主项目实际 UI 单独测量，不能把素材原始尺寸直接当成界面尺寸。

Lite 保留自己的产品边界：只呈现已经实现的能力，不因视觉参考而加入主项目的账户、Pine、私有连接或其他专有功能。窗口使用操作系统默认标题栏，不照搬主项目的自定义窗口框架。

`ui-design-extract/` 是只读参考快照。运行时需要的素材应复制到 `src/assets/` 后引用；除非用户要求同步新版，否则不要直接修改参考快照。

## 技术与验证

- 当前图表库为 `lightweight-charts` 5.2.1；使用 API 前以本地 `node_modules/lightweight-charts/dist/typings.d.ts` 为准。
- 行情只使用项目内已验证的 19 台公共 TDX 主站和整次请求故障切换规则；不得跨主站拼接半截历史数据。
- TDX 协议由 `src-tauri/src/tdx/` 自行实现，业务在 `src-tauri/src/market_data/`；新增协议能力按 [`docs/TDX 协议能力盘点与扩展指南.md`](docs/TDX%20协议能力盘点与扩展指南.md) 以新文件实现 `Request`，联网统一走 `hosts::run_with_failover`。
- 不得复制、改写或逐行翻译未获得开源许可的第三方行情客户端源码，也不得将其重新引入为运行依赖。
- UI 修改至少运行 `npm run test:ui`、相关契约和 `npm run build`；Rust 或 Tauri 修改再运行 `cargo test --manifest-path src-tauri/Cargo.toml`。
- 行情协议或数据处理修改还要运行 `npm run test:real-market`，并对改动涉及的字段用真实主站对拍。
- 视觉任务需打开最新 Lite 开发版，按用户真实入口检查尺寸、状态和交互；自动测试不能代替用户的最终视觉确认。
