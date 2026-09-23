# Windows 本地打包与验收

[English](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/en/windows-local-build.md) · [首页](https://github.com/hongchanho93/tradeflow-lite/blob/main/README.zh-CN.md) · [快速开始](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/quick-start.md)

本文供 Windows 电脑上的打包和验收人员直接执行。流程不依赖云端自动打包，目标是从同一份候选源码分别生成 CN、Global 两套 Windows x64 安装包，并验证平台能力和版本边界。

Windows 与 macOS 使用相同的前端、业务逻辑、Rust 核心和行情适配器。Windows 只有少量平台适配，包括 WebView2、系统凭证库、应用数据目录、文件身份与路径规则、安装和卸载。因此 macOS 通过可以作为公共核心的参考，但不能代替 Windows 真机验收。

## 1. 验收负责人提供候选版本

开始前必须取得：

- 候选代码及其完整 commit SHA；
- 本次应包含的功能或修复说明；
- 已知未验证项，例如 Windows 安装包尚未代码签名。

PC 不得在验收过程中自行修改源码、升级依赖或混用不同 commit。自动生成的源码压缩包也不能当作安装包。

在项目目录打开 PowerShell，记录当前版本：

```powershell
git rev-parse HEAD
git status --short
```

`git rev-parse HEAD` 必须与候选 SHA 完全一致。正式候选应保持 `git status --short` 为空；若不为空，先停止并反馈，不要带着未知修改继续打包。

## 2. Windows 打包环境

当前验收目标是 Windows 10/11 x64。Windows ARM64 不在本流程范围内。

安装以下环境：

1. Git for Windows。
2. Node.js 22.18 或更新的 22.x 版本。
3. Rustup 和当前 stable MSVC 工具链。
4. Visual Studio 2022 Build Tools，并选择 **Desktop development with C++**，包含 MSVC 编译工具和 Windows SDK。
5. Microsoft Edge WebView2 Runtime。多数 Windows 10/11 已经自带，缺失时按 [Tauri 2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/) 安装。

在 PowerShell 中核对：

```powershell
git --version
node --version
npm --version
rustc --version
cargo --version
rustup default stable-msvc
```

内置行情适配器不要求 Python。依赖中包含固定到 Git commit 的图表工具，因此首次 `npm ci` 需要访问 npm 和 GitHub。

## 3. 安装锁定依赖并运行打包前检查

在候选代码根目录执行：

```powershell
npm ci
npm run test:market-edition
npm run test:ui
npm run test:contracts
npm run build
$env:TRADEFLOW_LITE_EDITION = "global"
cargo test --manifest-path src-tauri/Cargo.toml --locked
$env:TRADEFLOW_LITE_EDITION = "cn"
cargo test --manifest-path src-tauri/Cargo.toml --locked --features provider-tdx
$env:TRADEFLOW_LITE_EDITION = $null
```

所有命令都应以退出码 0 结束。`npm ci` 只使用锁定依赖；不要为了让失败消失而改用 `npm install --force`、删除锁文件或升级包。失败时保留完整命令、末尾错误和候选 SHA，先反馈根因。

这些检查证明代码和合同在 Windows 构建环境中通过，但不等于安装包已经可用。

## 4. 分别打包 CN、Global

两个 Edition 使用同一个产品名、安装标识和输出目录。必须一次打一个，并在打下一个之前保存本次产物。

先建立验收产物目录：

```powershell
$acceptanceRoot = Join-Path (Split-Path $PWD -Parent) "tradeflow-lite-windows-acceptance"
New-Item -ItemType Directory -Force $acceptanceRoot | Out-Null
```

### CN

```powershell
npm run tauri:build:cn
New-Item -ItemType Directory -Force "$acceptanceRoot\cn" | Out-Null
Copy-Item ".\src-tauri\target\release\bundle\*" "$acceptanceRoot\cn" -Recurse -Force
```

### Global

```powershell
npm run tauri:build:global
New-Item -ItemType Directory -Force "$acceptanceRoot\global" | Out-Null
Copy-Item ".\src-tauri\target\release\bundle\*" "$acceptanceRoot\global" -Recurse -Force
```

列出最终文件并计算安装包哈希：

```powershell
Get-ChildItem $acceptanceRoot -Recurse -File
Get-ChildItem $acceptanceRoot -Recurse -File | Get-FileHash -Algorithm SHA256
```

保留两个目录、实际安装包文件名、SHA-256 和候选 commit SHA。构建日志里出现成功不等于产物已经复制成功；必须实际看到两个目录中的文件。

`npm run dev` 只启动网页前端，不能生成安装包，也不能代替 Tauri 桌面验收。

## 5. 两套安装包逐个隔离验收

两个 Edition 不能作为两个独立应用并排安装。后安装的版本可能替换前一个版本；卸载应用也不保证自动清除用户工作区。

最可靠的方式是为每个 Edition 使用新的 Windows 测试账号，或每次还原同一个干净虚拟机快照。若只能使用一台普通电脑，则按以下顺序逐个测试：

1. CN：安装、验收、卸载。
2. Global：安装、验收、卸载。

不要删除个人目录来伪造干净状态。无法取得干净状态时，应把“首次默认值”标记为未验证。

本地构建的安装包可能尚未进行 Windows 代码签名。出现“未知发布者”或 SmartScreen 时，记录提示并按内部测试安全规则处理；不能把未签名内部包写成正式发布已通过。

## 6. Edition 默认值验收

每套包首次启动后打开 **设置 → 数据源**：

| 安装包 | 应显示的发行版 | 首次默认启用的数据源 |
| --- | --- | --- |
| CN | TradeFlow Lite CN | TDX、Binance、OKX、Polymarket |
| Global | TradeFlow Lite Global | Binance、OKX、Polymarket；不存在 TDX 数据源或 TDX 搜索分类 |

界面语言不会改变 Edition。用户之后手动启用或关闭已编译适配器，也不代表安装包版本发生变化。Global 的“设置 → 数据源”、搜索分类和搜索结果中都不应出现 TDX。

## 7. Windows 平台专项验收

每套包至少检查安装、启动和版本默认值；以下平台能力在 CN 完整检查一次，并在其他 Edition 抽查：

- **安装与窗口：**开始菜单启动、新 Logo、窗口缩放、最大化、全屏和高 DPI 显示正常。
- **语言：**在设置中切换中英文并点“确定”，按钮应立即出现处理中反馈，不应长时间无反应；重启后语言保持。英文设置、指标、自选、AI 和错误说明不能残留中文解释，证券专名除外。
- **工作区：**修改主题、周期、自选、设置和一个绘图对象，重启后应恢复，并且不能串到另一个 Windows 用户。
- **系统凭证：**保存测试 AI API Key，重启后配置仍可使用；界面和日志不得显示完整 Key。测试后按既定测试账号流程处理凭证。
- **本地文件：**通过系统选择器选择专用测试目录，验证支持的 CSV、SQLite 快照或 Parquet；应用不得读取未选择的目录。
- **结果文件：**保存一个测试结果到用户选择的位置，确认文件存在且能打开。
- **MCP：**启用外部 MCP，重启后再次核对状态；如出现 Windows 防火墙或安全软件提示，记录实际结果，被拦截不能算通过。
- **路径：**使用带空格和中文名称的普通测试目录，不能使用真实敏感数据。
- **卸载：**卸载程序可以完成；残留的用户数据是否保留要单独记录，不能用手工删除代替卸载成功。

## 8. 公共核心功能验收

CN 完整执行一次，Global 至少抽查版本相关路径：

1. 搜索并打开一个品种，核对名称、市场、数据源和周期。
2. 切换两个周期，确认历史 K 线加载，并且旧请求不会覆盖新图表。
3. 在有实时数据的时段观察真实报价或 K 线变化；无法观察时写“实时未验证”，不能拿静态历史代替。
4. 添加、删除并排序自选，重启后核对顺序。
5. 添加内置指标和测试 `.tfi` 指标，修改参数并重启核对。
6. 创建绘图，执行撤销、重做，并检查重启恢复。
7. 如本轮包含 AI，发送一次真实请求，并确认有真正的工具调用记录，而不只是模型文字。
8. 断开并恢复网络，确认界面能报告失败并恢复，不发生卡死或串品种。

行情源专项：

- CN：验证 TDX A 股历史、报价和支持的复权；实时更新需要在相应市场时段验证。
- Global：分别验证本次计划交付的 Binance、OKX、Polymarket 能力，并确认所有 TDX 相关界面均不存在；区域或网络限制单独记录。

## 9. 通过标准与记录模板

只有以下条件同时满足，才能写“Windows 验收通过”：

- 两个安装包来自同一个候选 commit；
- Windows 打包前检查通过；
- 两套包均可安装、启动、重启和卸载；
- Edition 名称和首次默认数据源正确；
- Windows 平台专项和公共核心没有阻断性回归；
- 未验证项、签名状态和真实行情时段限制已经明确记录。

构建成功、安装成功、功能验收通过和正式发布是四种不同证据。

```text
候选 commit SHA：
Windows 版本与架构：
Node / Rust 版本：

Edition：CN / Global
安装包文件名：
安装包 SHA-256：
打包前检查：通过 / 失败
安装、启动、重启：通过 / 失败
发行版名称和默认数据源：通过 / 失败 / 未验证
语言切换和英文覆盖：通过 / 失败 / 未验证
工作区恢复：通过 / 失败 / 未验证
系统凭证：通过 / 失败 / 未验证
本地文件和结果文件：通过 / 失败 / 未验证
MCP：通过 / 失败 / 未验证
行情历史：通过 / 失败 / 未验证
行情实时：通过 / 失败 / 未验证
卸载：通过 / 失败
签名或安全提示：
问题复现步骤和截图位置：
其他未验证项：
```

遇到失败时，至少保留 Edition、候选 SHA、安装包哈希、Windows 版本、操作步骤、预期、实际结果和完整错误。不要因为稍后重试成功就省略首次失败。
