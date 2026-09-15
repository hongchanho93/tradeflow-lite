# TradeFlow Lite

Current implementation plan and verified progress: [docs/TradeFlow Lite 实施计划与进度.md](docs/TradeFlow%20Lite%20实施计划与进度.md)

TradeFlow Lite is a free, open-source desktop market chart. The current development version opens real A-share stock, ETF, and standard-index data through TradeFlow Lite's own Rust TDX protocol client and renders it with Lightweight Charts 5.2.1.

Implemented market features include full local symbol search, 19 public TDX hosts with protocol benchmarking, a reusable same-host connection and whole-request failover, up to 8,000 same-host paged historical bars for `1/5/15/30/60` minute plus daily/weekly/monthly periods, no-adjustment/front-adjustment switching, latest quotes, a local watchlist, and `VOL/MA/EMA/BOLL/MACD/RSI` indicators. Chart switches render an initial 300-bar window first, then load deep history without changing the visible time range; recently viewed symbol/period/adjustment combinations are reused from a bounded in-memory cache.

The chart also includes interactive trend, shape, annotation, Fibonacci, measurement, and position tools. Drawings support local persistence, undo/redo, per-object visibility and locking, deletion, and storage isolation by symbol and adjustment mode. Price-axis controls cover normal/log/percentage/indexed modes, autoscale, inversion, manual ranges, and reset. The object tree manages the main chart, overlays, and indicator panes; time navigation provides presets, viewport paging, exact-date location, and return-to-latest. User markers support bar-aligned placement, shape/position/color/size/text editing, visibility, deletion, navigation, and per-symbol/adjustment/period persistence. The interface intentionally exposes only implemented features.

## Development

Requirements: Node.js, Rust, and Tauri prerequisites. Market data needs no Python runtime.

```sh
npm install
npm run tauri dev
```

Run the deterministic contracts, Rust unit tests, and the live 128-route market matrix with:

```sh
npm run test:contracts
npm run test:ui
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:real-market
```

Packaging, signing, release publication, and Windows verification are outside the current delivery scope. Open-market continuous quote acceptance is tracked separately in the implementation progress document.

## Polymarket read-only gateway

Networks that cannot reach Polymarket directly can point the Polymarket adapter at the standalone read-only gateway in [`server/polymarket-gateway.mjs`](server/polymarket-gateway.mjs). Deployment and client configuration are documented in [`server/README.md`](server/README.md). The gateway exposes public market data only; it has no wallet, account, deposit, or order route.

The public release does not embed or default to the maintainer's Cloudflare test domain. Without an explicit developer/user-owned gateway configuration, Lite connects directly to the official Polymarket APIs.
