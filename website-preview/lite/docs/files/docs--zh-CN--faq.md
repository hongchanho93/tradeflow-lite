# TradeFlow Lite 常见问题

[English](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/en/faq.md) · [首页](https://github.com/hongchanho93/tradeflow-lite/blob/main/README.zh-CN.md)

## TradeFlow Lite 是什么？

它是使用 Tauri、Rust、Lightweight Charts 构建的桌面行情图表与用户自有研究工作台。核心使用方式是把看图与 AI 生成指标、用户选择的本地数据、共用 MCP 工具结合起来，不是券商或托管行情数据库。

## 这是 TradingView，或者完整替代品吗？

不是。项目使用 TradingView 的 Lightweight Charts 库，但独立开发，不是 Advanced Charts，不包含 Pine Script 兼容、TradingView 账户、订阅或全部功能。应按具体看盘与研究需求比较，不能理解为完全等价。

## 可以看哪些市场？

内置参考源是 TDX A 股、Binance、OKX、Polymarket。品种、周期、复权、历史长度因来源不同；Polymarket 数值是概率。访问取决于网络、服务商与地区限制，不承诺全球不受限制地可用。

## 必须接入 AI 或懂编程吗？

普通看盘不需要 AI；兼容 `.tfi` 可以直接导入，不必重新构建。AI 可以帮助生成指标、接入已选择的数据和编写计算。源码开发是独立可选流程，生成代码仍需验证，并检查实际行为。

## 可以用自己的模型或消费订阅吗？

内置助手支持配置 Chat Completions、Responses、Anthropic Messages 地址，具体模型与工具能力取决于所选服务。外部 MCP 客户端可以使用应用生成的配置接入。消费订阅不会自动转换为 API Key 或集成登录。

## 所有数据都只留在本地吗？

不能这样一概而论。工作区与源文件在本地，但外部模型会收到提示词及任务实际读取的工具数据、源码，API 可能计费。凭证、配对和访问边界见 [AI 与 MCP](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/ai-guide.md)。

## MCP 每次重启都要重新配置吗？

正常重启不需要。启用状态与配对凭证保存，辅助程序发现当前本机端口。主动重置凭证才使旧配置失效；配对保留不代表恢复旧会话的任务或数据集句柄。

## AI 能修改文件或我已经画好的线吗？

它可以按要求操作已开放的应用工具，包括已有绘图，不再逐操作弹配对批准框。但业务接口不能编辑工程代码、执行 Shell 或读写任意文件；结果导出只在支持的用户结果目录创建新文件，已选择的数据目录只读。

## 支持 SQLite、Parquet 就代表任何数据库都能用吗？

不是。SQLite 需要稳定非 WAL 快照；Parquet 只支持已实现的扁平列类型、编码，不是任意结构。CSV 假设由连接器决定。不包含 Arrow IPC、任意解压或远程服务凭证，见[本地数据与任务](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/data-and-tasks.md)。

## 任务完成就代表全历史回测完成吗？

不是。任务使用实际返回窗口，可能较短、不完整，或者从最早数据开始。研究结果保存在内存，保存工具定义不保存结果。请导出结果，核对时间范围、数据质量和成交假设。[回测示例](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/examples.md)仅为教学合成数据。

## 源码公开就代表可以不受限制地使用吗？

TradeFlow Lite 原创源码采用 MPL-2.0，允许商业使用，但对外分发时，修改过的 MPL 覆盖源码文件仍需按 MPL-2.0 提供源码。单独的 `tradeflow-tdx` crate 采用 `MIT OR Apache-2.0`。第三方组件、品牌和行情数据不在这些授权范围内。请以根目录 [README](https://github.com/hongchanho93/tradeflow-lite/blob/main/README.zh-CN.md)、[商标政策](https://github.com/hongchanho93/tradeflow-lite/blob/main/TRADEMARKS.zh-CN.md)和[第三方声明](https://github.com/hongchanho93/tradeflow-lite/blob/main/THIRD_PARTY_LICENSES.zh-CN.md)为准。安装包、支持系统和签名状态依据实际发布，不依据开发截图。

## Lite 与 TradeFlow 是什么关系？

两者由同一开发者维护，分别发布。Lite 侧重可扩展图表、AI/MCP、`.tfi` 指标和用户自有数据研究；[TradeFlow（Trade Flow / 图迹）](https://tradeflow.cn/)是面向中国大陆用户的独立桌面看盘产品。

根据官网的[国内使用说明](https://tradeflow.cn/tradingview-users/)，TradeFlow 可直接访问行情，无需额外网络工具（无需梯子）。[A 股与国内期货说明](https://tradeflow.cn/a-share-futures/)介绍了沪深北股票、指数、ETF、板块和国内期货的覆盖范围，包括主力、主连与各月合约。

其 [Pine Script 兼容说明](https://tradeflow.cn/pine-script/)列出 V4、V5、V6 指标脚本支持，暂不支持 `strategy()`，数据依赖与语法例外以该页为准。上述 Pine 与国内期货服务不是 Lite 的功能；Lite 使用 `.tfi`，不是 Pine Script 引擎，使用 Lite 不要求订阅 TradeFlow。

## 怎样反馈问题？

在仓库 Issue 中提供应用版本或提交、操作系统、相关数据源和品种、复现步骤、预期与实际结果及脱敏诊断。不要公开 API Key、MCP 配对 token、私有数据集或个人目录路径。
