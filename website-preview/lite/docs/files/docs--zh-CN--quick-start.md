# TradeFlow Lite 快速开始

[English](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/en/quick-start.md) · [首页](https://github.com/hongchanho93/tradeflow-lite/blob/main/README.zh-CN.md)

## 选择安装方式

先查看 [GitHub Releases](https://github.com/hongchanho93/tradeflow-lite/releases)，选择与你的系统和处理器匹配的安装包，并按照该版本的安装、签名说明操作。如果没有对应安装包，目前可用的方式是从源码构建；自动生成的“Source code”压缩包不是桌面安装包。

版本和界面语言是两件事。国内普通用户优先选择 **CN**：TDX A 股会编译进应用并默认启用；**Global** 完全不编译、不打包 TDX。两者使用同一套 Adapter 接口，安装后仍可在 **设置 → 数据源**启用或关闭已经编译进应用的适配器。

基础开发配置使用开发应用标识并关闭安装包打包。`tauri:build:cn`、`tauri:build:global` 会合并正式发行配置，切换到正式 identifier 并开启 bundle；这仍不代表已经发布了签名后的 macOS 或 Windows 安装包。Linux 兼容性和各平台凭证保存能力需要单独验证，不能从 Tauri 支持哪些系统直接推断。

需要在 PC 上自行生成并逐项验收两套 Windows 安装包时，按 [Windows 本地打包与验收](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/windows-local-build.md) 执行。两个 Edition 使用同一个应用标识，不能作为两个独立应用并排安装。

## 从源码启动

需要 Git、Node.js 与 npm、Rust 工具链，以及对应系统的 [Tauri 2 必要环境](https://v2.tauri.app/start/prerequisites/)。仓库测试脚本会直接运行 TypeScript，使用 Node.js 22.18 或更新版本。锁定的 Vite 依赖要求 `^20.19.0 || >=22.12.0`，但只达到 Vite 最低要求，不一定能运行仓库全部测试。

macOS 需要相应的 Xcode 命令行工具；Windows 按 Tauri 文档安装 C++ 构建工具和 WebView2；Linux 按发行版安装 WebKit 与原生构建依赖。没有更严格的仓库工具链要求时，使用当前稳定版 Rust。行情读取不需要 Python 服务。

```sh
git clone https://github.com/hongchanho93/tradeflow-lite.git
cd tradeflow-lite
npm ci
npm run tauri:dev:cn
```

Global 使用 `npm run tauri:dev:global`。直接执行 `npm run tauri dev` 不会启用 TDX Cargo feature，因此按 Global 的编译边界启动；需要可复现的版本时应使用具名脚本。对应构建命令为 `npm run tauri:build:cn`、`:global`，会合并 `src-tauri/tauri.release.conf.json` 开启打包。Git tag 触发的 GitHub 工作流可以一次构建两种 Edition 的 macOS / Windows 包，并先创建 **Draft Release**；代码签名与 macOS notarization 仍需发布者配置平台凭证。

仓库公开前，需要有私有仓库访问权限。命令在项目目录执行。`npm ci` 按锁定文件安装，不会主动升级依赖；部分固定版本的图表工具从 GitHub 获取，因此安装依赖也需要能访问 GitHub。

`npm run dev` 只启动 Vite 前端。原生行情、系统凭证和本地目录访问需要在 Tauri 桌面应用中使用。前端构建成功不等于生成了签名安装包，也不会自动更新已经安装的应用。

## 打开第一张图表

选择市场或数据源，再搜索品种。选择周期后，先核对品种、数据来源和连接状态。**不复权 / 前复权只在 CN 版启用并选中 TDX A 股时显示**；Global 不包含 TDX 数据源、分类或相关控件。等待初始历史加载；加载到更多 K 线不代表拥有完整历史。

从指标入口添加一个内置指标，画一条线，再将品种加入自选。工作区偏好和支持的图表对象会保存在本地。需要自定义指标时，使用可导入的 `.tfi`，不必修改应用源码。

## 需要时再连接 AI

点击右侧 **AI → 设置**，选择服务商和模型、输入 API Key，然后保存。保存不会发起模型请求，发送消息才会。外部 MCP 客户端是同一设置页中的另一种接入方式；分享配对配置前先读 [AI 与 MCP](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/ai-guide.md)。

可以先问：“读取当前图表，告诉我品种、周期、实际数据范围和限制。”确认对话里有真正的工具执行记录，而不只是 AI 生成的文字。

## 遇到问题

图表为空时，先核对数据源、网络和目录加载状态，不要直接认定品种不存在。AI 报错时，核对协议、完整请求地址、模型可用性和凭证状态；服务商错误不等于图表应用故障。本地文件无法读取时，通过 **AI → 设置 → 我的数据**在系统窗口中选择目录。

反馈时提供应用版本或源码提交、系统、数据源、复现步骤和可见错误。截图或日志中移除 API Key、MCP token 和个人路径。常见能力边界见[常见问题](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/faq.md)。
