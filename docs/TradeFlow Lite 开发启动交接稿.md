# TradeFlow Lite 开发启动交接稿

最后更新：2026-09-14

本文只记录当前可继续开发的事实，不保留已经被替换的早期行情方案。实现状态与验收记录以[《TradeFlow Lite 实施计划与进度》](TradeFlow%20Lite%20实施计划与进度.md)为准，产品边界以[《TradeFlow Lite 产品内容与总体架构》](TradeFlow%20Lite%20产品内容与总体架构.md)为准。

## 1. 当前结论

TradeFlow Lite 是独立的 Tauri 2 + Rust + TypeScript 桌面项目：

```text
搜索股票、ETF、标准指数
  → Tauri Command
  → Rust TDX 协议客户端
  → 公共标准行情主站
  → 统一 Symbol / Bar / Quote 合同
  → Lightweight Charts 5.2.1
```

行情运行不需要 Python runtime 或第三方 TDX 客户端。项目内的 Python 脚本只用于开发期生成市场目录和证券 Logo，不进入行情请求链路。

## 2. 工作区与边界

- 工作区：`/Users/jim/Documents/tradeflow lite`
- 主项目 `/Users/jim/Documents/TAURI+RUST` 只作为 UI、产品行为和已验证规则的参考，未经用户明确要求不得修改。
- 未经明确要求，不提交、推送、安装、打包或发布。
- `ui-design-extract/` 是 UI 权威参考快照，只读；运行素材复制到 `src/assets/` 后使用。
- Lite 不包含账户、Pine、私有连接、期货、扩展指数、板块指数或正式 Web 实时行情。

## 3. 当前行情架构

协议层位于 `src-tauri/src/tdx/`：

- `client.rs`：TCP 连接、序号、请求响应和损坏连接隔离；
- `frame.rs`：帧编码、响应校验及 zlib 解压；
- `wire.rs`：协议字节读写；
- `standard/`：两段握手、股票/ETF/指数 K 线、行情快照和除权资料。

业务层位于 `src-tauri/src/market_data/`：

- 19 台跨地区、跨网络公共主站启动测速并排序；
- 行情业务复用一条加锁 TCP 长连接；
- 切股票、切周期、深历史和报价轮询默认保持同一主站；
- 连接或整次请求失败后丢弃连接并完整换站；
- 历史分页始终固定在一台主站，禁止跨主站拼接；
- 支持 `1/5/15/30/60` 分钟、日、周、月，以及不复权和前复权。

## 4. 市场目录

- 市场目录是项目内置、经过验证的静态快照；运行时不从主站下载证券列表。
- 当前包含 A 股股票、ETF 和沪深北标准指数。
- 搜索支持代码、名称、简称和拼音别名。
- 新目录必须由生成脚本构建，并通过数量、交易所、分类、重复代码和代表品种合同。

## 5. 前端与图表

- 图表库固定为 `lightweight-charts@5.2.1`；使用 API 前以本地 typings 为准。
- 首屏先显示 300 根，稳定后再加载最多 8,000 根深历史；迟到请求不能覆盖最后一次选择。
- 主图、指标、画线、价格轴、时间导航和标记状态均使用独立合同验证。
- UI 修改先检查 `ui-design-extract/`，再参考主项目实际界面，最后使用用户截图确认差异。

## 6. 验证命令

```sh
npm run test:ui
npm run test:contracts
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:real-market
```

行情或协议修改必须运行真实行情矩阵，并核对代表股票、ETF、指数、全部支持周期、前复权、深历史、报价及主站失败恢复。自动测试不能替代最新开发版的实际用户路径检查。

## 7. 当前后续项

- 接通前端五档盘口展示；底层买卖五档已经解析。
- 在 A 股开市窗口继续验证报价和当前 K 线持续推进。
- 首次公开发布前完成根许可证、全部第三方依赖、UI 素材及绘图扩展的许可审计。
- Windows、安装包、签名和正式发布仍未执行。
