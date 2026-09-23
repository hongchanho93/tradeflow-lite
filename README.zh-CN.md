# TradeFlow Lite

**支持 AI 生成指标、本地数据研究和 MCP 工具的桌面行情图表工作台。**

[English](README.md) · 简体中文

TradeFlow Lite 将 A 股、数字货币和预测市场图表放进一个本地桌面工作台。你可以直接看图，也可以把想法告诉 AI：制作指标、比较不同周期、标注图表、研究自己的数据，再把结果保存为文件。普通指标与研究流程不要求修改应用源码。

项目使用 **Tauri、Rust、TypeScript 和 TradingView Lightweight Charts**。这是独立项目，不是 TradingView Advanced Charts、TradingView 客户端或 TradingView 官方产品。

## 界面预览

### CN 图表工作台

![TradeFlow Lite CN 图表工作台，包含 A 股图表、指标和自选列表](docs/assets/screenshots/cn-chart-workspace.png)

### 市场搜索

| CN — A 股目录 | Global — Binance 与 OKX 市场 |
| --- | --- |
| ![TradeFlow Lite CN 品种搜索与 A 股市场分类](docs/assets/screenshots/cn-symbol-search.png) | ![TradeFlow Lite Global 品种搜索、Binance 与 OKX 市场及订单簿](docs/assets/screenshots/global-symbol-search.png) |

### 可选 AI 工作台

![TradeFlow Lite AI 工作台与 A 股图表](docs/assets/screenshots/ai-workspace.png)

## 从这里开始

| 你的需求 | 文档 |
| --- | --- |
| 启动应用，打开第一张图表 | [快速开始](docs/zh-CN/quick-start.md) |
| 看图、画线、管理自选和指标 | [用户指南](docs/zh-CN/user-guide.md) |
| 连接模型 API 或外部 MCP 客户端 | [AI 与 MCP 指南](docs/zh-CN/ai-guide.md) |
| 让 AI 生成可导入的指标 | [指标接口说明](docs/zh-CN/indicators.md) |
| 使用 CSV、SQLite、Parquet 研究自己的数据 | [本地数据与任务](docs/zh-CN/data-and-tasks.md) |
| 运行可核对的小型示例 | [示例实操](docs/zh-CN/examples.md) |
| 查看修复与更新 | [更新日志](CHANGELOG.md) |
| 在 PC 本地打包并验收 Windows 两个发行版本 | [Windows 本地打包与验收](docs/zh-CN/windows-local-build.md) |
| 把仓库交给开发 AI | [AGENTS.zh-CN.md](AGENTS.zh-CN.md) · [AI 工具参考](docs/zh-CN/api-reference.md) |

## 发行版本

TradeFlow Lite 只有一套代码和一套适配器合同。官方发行包的区别在于是否把 TDX 适配器编译进应用：

| 版本 | 默认行情源 |
| --- | --- |
| **CN** | TDX A 股 + Binance 现货/U 本位永续 + OKX 现货/永续 + Polymarket；TDX 会编译进应用并默认启用 |
| **Global** | Binance、OKX、Polymarket；**不会编译或打包 TDX** |

适配器仍属于同一个 Lite 项目，用户之后可以在“设置 → 数据源”启用或关闭已经编译的适配器；但 Global 的二进制文件不含 TDX，不能在设置中重新开启。界面语言不会改变发行版本。

**分发状态：**本目录提供应用源码。已发布的安装包及对应平台说明以 [GitHub Releases](https://github.com/hongchanho93/tradeflow-lite/releases) 为准；GitHub 自动生成的源码压缩包不是安装包。基础开发配置仍关闭 bundle，两个 `tauri:build:*` 命令会合并正式发行配置并开启打包；具备打包能力不等于已经发布或签名。源码许可和分发边界见下方“许可证”。

## 可以做什么

| 能力 | 已提供的内容 |
| --- | --- |
| 行情图表 | TDX A 股股票、ETF、指数；Binance 现货与 U 本位永续；OKX 现货与永续；Polymarket 概率市场，实际可用性取决于来源和所在地区 |
| 看盘工作台 | 多周期、支持的复权方式、自选股、内置指标、画线工具、标记，以及本地保存的工作区设置 |
| 用户指标 | 可导入的 `.tfi` JavaScript 指标，隔离运行；支持线条、副图、标记、K 线染色、安全绘图命令和文字面板 |
| AI 辅助看盘 | 读取数据、计算、导航、标注与管理指标；内置 AI 和外部 MCP 使用同一套应用能力 |
| 用户自有数据 | `.tfc` 连接器只读访问用户明确选择的本地目录，支持 CSV、SQLite 快照及已支持的 Parquet 文件 |
| 研究任务 | `.tft` 窗口计算，输出表格、品种列表、序列和报告；保存可复用任务定义，生成新的 Markdown、TXT、CSV 或 JSON 结果文件 |

支持某个数据源不代表拥有完整历史、不间断访问或数据再分发授权。使用结果前，核对来源、时间范围、覆盖情况与收盘状态；空数据或暂时不可用都不是交易信号。

## 把需求告诉 AI

> 保持我的日线图不变，在图上显示 16 周期的月线均线。

> 按我描述的条件生成一个指标，并说明这些标记在 K 线收盘前会不会变化。

> 读取我已选择的数据目录，先用小样本验证这个计算，再把结果表保存到下载目录。

入口在右侧栏的 **AI**。服务商、模型、API Key、**我的数据**和**外部 AI / MCP**都放在 **AI → 设置**中。研究任务在对话里执行，普通流程不需要另外学习一个任务页面。

普通看盘不要求接入 AI。模型请求使用你配置的服务，可能产生该服务的费用；AI 任务中实际读取的数据或指标源码可能发送给该服务。具体见 [AI 数据访问与权限](docs/zh-CN/ai-guide.md)。

## 明确边界

TradeFlow Lite **不提供**证券账户、下单、投资建议、托管全市场数据库、Pine Script 引擎或完整历史回测成交模拟器。预测市场的概率序列不等于 OHLCV K 线。使用自己兼容的 `.tfi` 文件，不要求注册指标市场或取得维护者批准。

应用内置助手和业务 MCP 接口不能修改工程源码、运行 Shell 或访问任意文件。另行授权的开发 AI 可以修改你自己的源码副本；这是独立的开发流程，见[源码扩展](docs/zh-CN/extensions.md)。

## 从源码运行

先按[快速开始](docs/zh-CN/quick-start.md)安装必要环境，再运行：

```sh
git clone https://github.com/hongchanho93/tradeflow-lite.git
cd tradeflow-lite
npm ci
npm run tauri:dev:cn
```

Global 使用 `npm run tauri:dev:global`。直接执行 `npm run tauri dev` 不带 TDX feature，因此按 Global 的编译边界启动；需要可复现的版本时应使用具名脚本。仓库仍为私有时，需要有相应访问权限。单独执行 `npm run dev` 只启动前端，不会启动原生行情和本地文件服务。内置行情适配器不要求 Python 环境。

## 帮助与项目信息

[常见问题](docs/zh-CN/faq.md) · [反馈问题](https://github.com/hongchanho93/tradeflow-lite/issues) · [面向 AI 的文档索引](llms.zh-CN.txt)

TradeFlow Lite 是 TradeFlow 系列中可独立扩展的项目。同系列的 [TradeFlow（图迹）](https://tradeflow.cn/)是独立维护的桌面看盘产品，面向中国大陆用户提供无需额外网络工具的看盘服务，覆盖 A 股与国内期货，支持 Pine Script 指标。Lite 使用自己的 `.tfi` 指标格式，不包含另一产品的 Pine 引擎与国内期货服务；具体区别及官网资料见[项目关系说明](docs/zh-CN/faq.md#lite-与-tradeflow-是什么关系)。

## 许可证

除非文件或目录另有说明，TradeFlow Lite 原创源码采用 [MPL-2.0](LICENSE)。独立仓库中的 [`tradeflow-tdx`](https://github.com/hongchanho93/tradeflow-tdx) crate 单独采用 `MIT OR Apache-2.0` 双许可证。第三方组件保留各自许可证与声明，详见[第三方清单](THIRD_PARTY_LICENSES.zh-CN.md)。

软件许可证不授予 TradeFlow / 图迹名称、Logo 或 App 图标的品牌使用权，详见[商标政策](TRADEMARKS.zh-CN.md)；也不授予任何行情服务或第三方数据的访问、使用或再分发权。外部贡献应遵循[贡献说明](CONTRIBUTING.zh-CN.md)并接受[贡献者许可协议](CLA.zh-CN.md)。第三方清单仍是分发审计记录；源码已经许可，不等于签名安装包已经完成发布验收。
