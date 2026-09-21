# tradeflow-binance-market-data

[简体中文](README.zh-CN.md)

A Rust client for public Binance Spot and USD-M futures market data, independent of Tauri and TDX. It provides `Client`, `RealtimeStream`, `RealtimeKlineState`, market-data types and `Error`. TradeFlow-specific conversion is in [the native adapter](../../src/market_providers/binance.rs).

No API key, account, balance, signature or order routes are provided. Spot uses the public data endpoints; futures uses the official USD-M endpoints. Actual access remains subject to upstream network and regional availability.

The realtime stream combines aggregate trades with official klines. Official kline values remain the volume authority; aggregate trades do not double-count volume. History requests retain a single source, and malformed ordering/overlaps/OHLC cause failure rather than silent repair.

Lite enables the `provider-binance` Cargo feature by default. Core tests without default features use `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features` from the repository root. See [source extension instructions](../../../docs/en/extensions.md) and the root licensing notice before redistribution; this README does not grant a separate software license.
