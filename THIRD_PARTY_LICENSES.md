# Third-party licenses

[简体中文](THIRD_PARTY_LICENSES.zh-CN.md)

- TradingView Lightweight Charts 5.2.1 — Apache-2.0
- difurious Lightweight Charts Line Tools Core 1.1.2 — MPL-2.0
- difurious Lightweight Charts Line Tools: Lines, Rectangle, Circle, Fibonacci Retracement, Freehand, Parallel Channel, Price Range, Long/Short Position, and Text 1.1.0 — MPL-2.0
- chrono 0.4 — MIT OR Apache-2.0 (Rust crate, direct dependency)
- flate2 1.1 — MIT OR Apache-2.0 (Rust crate, direct dependency)

The independent [`tradeflow-tdx`](https://github.com/hongchanho93/tradeflow-tdx) market-data protocol client is original TradeFlow code. On 2026-09-22, the maintainer confirmed that it was independently authored and was not copied, translated or adapted from another TDX client implementation. No third-party TDX client is bundled or required. The crate is separately licensed under `MIT OR Apache-2.0`.

This inventory is incomplete. Distribution remains blocked on a complete license audit.

The maintainer confirmed on 2026-09-22 that the application UI was independently designed and drawn. The maintainer further confirmed that 14 production SVG files were independently drawn first and later copied into a local reference directory. Those 14 files comprise five chart-type icons, `drawing-tools/extended-line.svg`, and eight widget-bar icons, and are recorded as original TradeFlow assets. The separate 242-file reference directory is no longer tracked or distributed by this repository.

SQLite/Parquet native readers add the following direct dependencies, pinned or resolved in `src-tauri/Cargo.lock`: rusqlite 0.40.2 (bundled SQLite), sqlite-vfs 0.2.0, Apache parquet 58.1.0, bytes, snap, zstd, lz4_flex, and brotli. The existing flate2 dependency provides the Rust gzip backend. This records implementation provenance, not a completed distribution-license or vulnerability audit. Upstream package metadata and transitive codec/library notices must still be included in the installer audit; the root MPL-2.0 license does not replace those obligations or prove release readiness.
