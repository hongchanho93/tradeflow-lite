# TradeFlow Lite FAQ

[简体中文](../zh-CN/faq.md) · [Home](../../README.md)

## What is TradeFlow Lite?

TradeFlow Lite is a desktop market-charting and user-owned research workspace built with Tauri, Rust and Lightweight Charts. Its distinctive workflow is combining charts with AI-generated indicators, selected local data and shared MCP tools. It is not a broker or a hosted market database.

## Is this TradingView or a complete TradingView replacement?

No. It uses TradingView's Lightweight Charts library but is independently developed. It is not Advanced Charts and does not include Pine Script compatibility, TradingView accounts, subscriptions or their entire feature set. The relevant comparison is specific charting/research needs, not a claim of complete parity.

## Which markets can it show?

The built-in references are TDX A-shares, Binance, OKX and Polymarket. Supported instruments, periods, adjustments and history vary by provider. Polymarket values are probabilities. Access depends on the network, provider and regional restrictions; no unrestricted global availability is promised.

## Do I need AI or programming knowledge?

No AI is required for ordinary charting. Compatible `.tfi` indicators can be imported without rebuilding. AI can help generate them, connect selected data and write calculations. Source development is a separate optional workflow; generated code still needs validation and a check of its actual behavior.

## Can I use my own model or a consumer subscription?

The built-in assistant supports configured Chat Completions, Responses and Anthropic Messages endpoints; actual model/tool compatibility depends on the chosen service. External MCP clients can connect using the app's generated configuration. A consumer subscription is not automatically converted into an API key or integrated login.

## Does all my data stay local?

No blanket claim is made. Workspace settings and source data are local, but external models receive prompts and tool data/source actually read for a task. API calls can cost money. See [AI and MCP](ai-guide.md) for credentials, pairing and access boundaries.

## Does MCP need to be configured after every restart?

Not after normal restarts. Enabled state and pairing credentials persist, and the helper discovers the current local port. Resetting credentials invalidates old configurations. Pairing persistence does not restore old session-owned tasks or dataset handles.

## Can AI modify my files or existing chart drawings?

It can operate exposed application tools, including existing drawings when requested, without another per-action pairing approval. It cannot use the business interface to edit project code, execute shell commands or read/write arbitrary files. Result export creates new files only in the supported user result directories. Selected data directories are read-only.

## Does SQLite/Parquet support mean any database works?

No. SQLite needs a stable non-WAL snapshot. Parquet supports the implemented flat-column types and encodings, not every layout. CSV assumptions are connector-specific. Arrow IPC, arbitrary decompression and remote-service credentials are not included. See [Data and tasks](data-and-tasks.md).

## Is a completed task a full-history backtest?

No. Tasks calculate on returned windows, which may be short, incomplete or oldest-first. Research results live in memory; saved tool definitions do not preserve them. Export results and check time ranges, data quality and execution assumptions. The [backtest example](examples.md) is educational and synthetic.

## Is the public source licensed for unrestricted reuse?

Original TradeFlow Lite source files use MPL-2.0, which permits commercial use but requires distributed modifications to covered source files to remain available under MPL-2.0. The separate `tradeflow-tdx` crate uses `MIT OR Apache-2.0`. Third-party components, trademarks and market data remain outside those grants. Consult the root [README](../../README.md), [trademark policy](../../TRADEMARKS.md) and [third-party notices](../../THIRD_PARTY_LICENSES.md). Published installers, supported platforms and signing status are determined by actual releases, not development screenshots.

## How is Lite related to TradeFlow?

TradeFlow Lite and TradeFlow are separately maintained projects in the same product family. This repository documents Lite. For the related TradeFlow product, see [tradeflow.cn](https://tradeflow.cn/).

## How should I report a problem?

Use the repository's issue tracker with your app version or commit, operating system, provider and symbol where relevant, exact steps, expected/actual behavior and sanitized diagnostics. Do not post API keys, MCP configuration tokens, private datasets or personal directory paths.
