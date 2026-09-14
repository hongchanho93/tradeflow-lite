# TDX 协议能力盘点与扩展指南

最后更新：2026-09-14

本文记录三件事：TradeFlow Lite 为什么自写 TDX 协议客户端、TF 主项目实际用到了哪些 TDX 能力（即 Lite 以后可能扩展的范围），以及新增能力时应该怎么改代码。

## 1. 背景与原则

- Lite 的协议实现位于 `src-tauri/src/tdx/`，按协议格式（包头、命令号、字段排列）独立设计编写，不依赖、打包、复制或翻译任何第三方 TDX 客户端源码。
- 协议字段含义以真实主站实测为准；无法确认含义的字段原样保留并命名为 `unknown_*`，不猜测。
- 业务规则保持不变：只使用项目内已逐台验证的 19 台公共标准行情主站；一次请求固定在一台主站上完成，失败整次换站，不跨主站拼接数据。主站覆盖陕西、浙江、上海、北京、武汉、深圳和广州，并分散在电信、联通、华为云和腾讯云网络。

## 2. 代码结构

```
src-tauri/src/
├── tdx/                     协议层，与 Lite 业务无关
│   ├── wire.rs              字节读写；变长价格、f32 数量
│   ├── types.rs             证券代码、协议日期时间
│   ├── frame.rs             请求/响应包头、zlib 解压、序号与命令号校验
│   ├── request.rs           Dialect（方言）与 Request（命令）两个 trait
│   ├── client.rs            Client（TCP 连接）与 Session（可替换的会话抽象）
│   └── standard/            标准行情方言（7709），一类命令一个文件
│       ├── handshake.rs
│       ├── bars.rs          SecurityBars / IndexBars
│       ├── quotes.rs        SecurityQuotes
│       └── xdxr.rs          XdxrInfo
└── market_data/             Lite 业务层
    ├── hosts.rs             主站池、测速、冷却、run_with_failover
    ├── history.rs           分页、标准化、指数修复、前复权、周/月聚合
    ├── quote.rs             行情快照对外格式
    ├── clock.rs             北京时间（含 1986–1991 夏令时）
    └── real_market.rs       真实主站验收矩阵（默认忽略）
```

依赖方向只能是 `market_data → tdx`，`tdx` 不依赖任何 Lite 业务类型。

## 3. TF 主项目实际使用的 TDX 能力

盘点范围：`/Users/jim/Documents/TAURI+RUST` 的桌面端 `charting_library-master-main/`（排除内置 `python-runtime`）和服务端 `server/src/`，只统计生产代码里的真实调用，不含测试与 `test-indicators/` 快照。核对时 HEAD 为 `621447daf`。

### 3.1 标准行情（`TdxHq_API`，端口 7709，包头标记 `0x0c`）

| 能力 | 命令号 | TF 调用位置 | Lite 状态 |
|---|---|---|---|
| 个股/ETF K 线 | `0x052d` | 桌面行情源；服务端历史适配器 | 已实现 `SecurityBars` |
| 指数 K 线（含涨跌家数） | `0x052d` | 桌面行情源 | 已实现 `IndexBars` |
| 批量行情快照（五档） | `0x053e` | 桌面报价、集合竞价及服务端快照采集 | 已实现 `SecurityQuotes` |
| 除权除息 | `0x000f` | 桌面行情源 | 已实现 `XdxrInfo` |
| 财务数据 | `0x0010` | 桌面行情源 | 未实现 |
| F10 目录 | `0x02cf` | 桌面行情源 | 未实现 |
| F10 内容 | `0x02d0` | 桌面行情源 | 未实现 |
| 当日分笔成交 | `0x0fc5` | 桌面行情源及集合竞价接口 | 未实现 |
| 历史分笔成交 | `0x0fb5` | 桌面行情源及集合竞价接口 | 未实现 |
| 板块文件元信息 | `0x02c5` | 桌面板块源 | 未实现 |
| 板块文件分段下载 | `0x06b9` | `backend/data/tdx_block_source.py`（下载后再解析板块文件） | 未实现 |

连接方式上的差异：

- 标准行情连接统一只发送 `SetupStage::FIRST/SECOND` 两段握手，跳过旧客户端使用的第三段 `0x0fdb`；现有普通主站与新版双线/CDN 主站使用同一连接入口。
- Lite 在 `Client` 之上保留一条加锁的业务长连接：切股票、切周期、深历史和报价轮询复用当前主站及同一 TCP 会话；并发请求串行进入连接，防止响应串包。测速仍使用独立短连接，不污染业务会话；业务连接或整次请求失败后立即丢弃，并按主站排名完整换站重试。手动重新测速若选出不同的最快主站，会关闭旧业务连接，下一次行情请求连接新的首选主站。

TF 生产代码未使用：证券数量/列表、分时、历史分时、报告文件。Lite 的市场目录来自已验证的目录快照（`scripts/build_lite_market_universe.py`），不在运行时拉取。

### 3.2 扩展行情（`TdxExHq_API`，端口 7727，包头标记 `0x01`）

用于期货、扩展指数等品种。Lite 当前产品边界明确不包含这些品种，以下仅作为以后扩展的范围记录。

| 能力 | 命令号 | TF 调用位置 |
|---|---|---|
| 市场列表 | `0x23f4` | 服务端 `collectors/cffex_tdx_source.py` |
| 合约数量 | `0x23f0` | 服务端 `collectors/build_cn_futures_instrument_catalog.py` |
| 合约信息分页 | `0x23f5` | 服务端 `collectors/build_cn_futures_instrument_catalog.py` |
| 合约行情 | `0x23fa` | `backend/data/tdx_exhq_index_source.py`、`tdx_exhq_futures_details.py`；服务端 `cffex_tdx_source.py` |
| 合约 K 线 | `0x23ff` | `backend/data/tdx_exhq_index_source.py`；服务端 `collectors/futures_history_daily.py` |
| 合约分笔成交 | `0x23fc` | `backend/data/tdx_exhq_futures_details.py` |

连接方式上的差异：服务端 `futures_history_daily.py` 替换了扩展行情的握手包，并开启心跳长连接。

## 4. 如何扩展

### 4.1 新增一个标准行情命令

以“当日分笔成交”为例，只需要新增文件，不修改 `client.rs`、`frame.rs`、`wire.rs`：

1. 新建 `src-tauri/src/tdx/standard/transactions.rs`，定义请求结构体和响应结构体，实现 `Request`：

   ```rust
   impl Request for Transactions {
       type Dialect = Standard;
       type Response = Vec<Transaction>;
       const COMMAND: u16 = 0x0fc5;

       fn encode(&self, body: &mut ByteWriter) -> Result<(), TdxError> { /* 写请求体 */ }
       fn decode(&self, body: &mut ByteReader<'_>) -> Result<Vec<Transaction>, TdxError> { /* 读响应体 */ }
   }
   ```

2. 在 `standard/mod.rs` 里 `mod transactions;` 并 `pub use`。
3. 在同一文件写单元测试：请求体字节布局、构造的响应字节能正确解码、截断输入返回错误而不是崩溃。
4. 业务侧在 `market_data/` 下新建模块，处理函数签名写成 `fn load<S: Session<Standard>>(session: &mut S, ...)`，这样可以用不走网络的假会话测试（参考 `history.rs` 测试里的 `FakeSession`）。
5. 对外调用统一经过 `hosts::run_with_failover` + `hosts::connect_and_run`，自动获得测速排序、冷却和整次换站。
6. 用真实主站对拍并把代表性检查加入 `real_market.rs`。

### 4.2 新增扩展行情方言

1. 新建 `src-tauri/src/tdx/extended/mod.rs`，定义 `pub struct Extended;` 并实现 `Dialect`：`MARKER = 0x01`，`handshake` 发送扩展行情的握手命令。
2. 扩展行情的合约代码长度与标准行情的 6 字节代码不同，应在该目录里定义自己的代码类型，不要放宽 `SecurityCode`。
3. 命令按 4.1 的方式逐个添加，`type Dialect = Extended`。类型系统会阻止把扩展行情命令发给标准行情连接。
4. 扩展行情主站池与标准行情主站池分开管理，不共用 `DEFAULT_HOSTS`。

## 5. 协议与主站的已知事实

- **成交量/成交额编码是 IEEE-754 单精度浮点。** Lite 直接按 `f32` 解码；旧实现对小数量存在错误，主要影响 1990 年代早期的指数日线，真实报文夹具已覆盖该边界。
- **行情快照价格单位。** 协议价格为整数：股票和指数除以 100；ETF 需除以 1000 才与其三位小数的 K 线一致。
- **K 线分页。** 单次最多 800 根，`offset` 为 `u16`，从最新一根往前数。
- **时间。** 分钟线日期是 `u16` 压缩格式（年份从 2004 起算），日线及以上是 `u32` 的 `YYYYMMDD`。转换 Unix 时间戳时必须考虑中国 1986–1991 年的夏令时。
- **除权除息类别。** 1 为分红送配（每 10 股口径），11/12 为扩缩股比例，13/14 为权证，其余为股本变动；前复权只使用类别 1 和 11/12。
- **响应校验。** 主站原样回显请求序号和命令号，客户端据此校验，防止读错响应。
- **59.36.5.11:7709 数据不稳定。** 同一请求连续两次，返回的深度分钟线根数可能不同（实测 1964/1972/1984 根），个别 K 线价格也有 0.01 级差异，像是背后多台数据不一致的服务器轮询。该地址继续永久排除；主项目确认的 7 台慢站/不稳定站也不进入 Lite。2026-09-14 新增 12 台异地运营商及双线/CDN 主站后，主站池共 19 台，不再依赖单一 `117.34.114.x` 网段。

## 6. 对拍记录（2026-09-14，北京时间凌晨休市）

- 请求集：8 个品种 × 8 个周期 × 不复权/前复权（每组 40 根），加上深度历史（4 个指数 12,000 根日线；4 只股票/ETF 的日/周/月 × 两种复权；4 个品种的 1/5/60 分钟 12,000 根），共 180 组。
- 在 `117.34.114.15:7709` 上将旧实现与 Rust 实现各跑一遍：312,714 根 K 线的时间与 OHLC 全部一致；指数修复计数、前复权非正价格计数、行情快照（除接收时间）全部一致；成交量/成交额的差异全部由第 5 节所述旧实现解码错误解释。
- 在 `59.36.5.11:7709` 上连续运行同一请求出现 1,162 处差异；只比较两次结果一致的 134 组请求后，剩余差异经单独重跑确认来自该主站每次返回的数据不同。
- 原 8 台主站在新客户端下测速全部可用；随后移出 `59.36.5.11`。完成两段握手兼容与异地扩容后，现有 19 台逐台通过股票日线、1 分钟线、指数日线、报价和除权资料请求。
- 业务请求改为单条加锁长连接后，真实行情矩阵在一次 TCP 建连中连续完成 8 个品种、8 个周期、两种复权及深历史共 128 条路线；连接失败会被丢弃，不改变“整次请求固定一台主站、失败整次换站”的数据边界。
