# tradeflow-binance-market-data

[English](README.md)

读取 Binance Spot 与 U 本位合约公开行情的 Rust 客户端，不依赖 Tauri 或 TDX。提供 Client、RealtimeStream、RealtimeKlineState、行情类型和 Error；TradeFlow 合同转换位于[原生适配器](../../src/market_providers/binance.rs)。

不提供 API Key、账户、余额、签名或下单接口。现货使用公共行情地址，合约使用官方 U 本位地址；实际访问仍受上游网络和地区可用性约束。

实时流结合聚合成交与官方 K 线，成交量始终以官方 K 线为权威，不重复累加聚合成交量。历史请求保持单一来源，乱序、重叠、异常 OHLC 明确失败，不静默修补。

Lite 默认启用 provider-binance Cargo feature。在仓库根目录运行 `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features` 可以检查不启用默认 feature 的核心。再分发前阅读[源码扩展](../../../docs/zh-CN/extensions.md)和根目录许可证说明；本 README 不另外授予软件许可。
