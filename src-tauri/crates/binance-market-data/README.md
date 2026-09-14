# tradeflow-binance-market-data

独立的 Rust Binance Spot 与 USDⓈ-M Futures 公共行情客户端。它不依赖 TradeFlow Lite、Tauri、TDX 或任何账户能力，可作为单独 crate 复制到其他开源项目。

## 边界

- 只访问无需 API Key 的 Binance Spot 与 U 本位合约公共行情；
- Spot 固定使用 `https://data-api.binance.vision` 与 `wss://data-stream.binance.vision`；U 本位合约固定使用 `https://fapi.binance.com` 与 `wss://fstream.binance.com`；
- 实现 K 线、跨页历史、24 小时行情，以及 `aggTrade + kline` 组合实时流；
- `aggTrade` 在官方 K 线基线后只更新当前 K 线的高、低、收价格；成交量始终采用官方 K 线值，跨流交错不会重复累计，重复成交会被隔离，固定周期的新柱可由第一笔真实成交即时开启并等待官方 K 线校准；
- 不包含账户、资产、API Key、签名、交易或下单；
- 每次历史请求只使用一个固定来源，分页重叠、乱序或异常 OHLC 会让整次请求失败。

公开 API 只有 `Client`、`RealtimeStream`、`RealtimeKlineState` 及对应的行情类型和 `Error`。Lite 专属的数据合同转换位于外部的 `src-tauri/src/market_providers/binance.rs`。

## 在 Lite 中启用或移除

Lite 默认启用 Cargo feature `provider-binance`。使用下面的命令可以证明核心在不编译 Binance crate 时仍能工作：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
```

若另一个发行版不需要 Binance，可关闭该 feature，并移除前端 `src/providers/binance/` 中的目录数据；TDX 和统一图表合同不需要修改。

## 上游合同

- [Binance Spot REST API](https://developers.binance.com/en/docs/products/spot/rest-api)
- [Binance Spot WebSocket Market Streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams)
- [Binance USDⓈ-M Futures API](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures)
- `GET /api/v3/klines`
- `GET /api/v3/ticker/24hr`
