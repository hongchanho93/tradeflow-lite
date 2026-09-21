# Charts, indicators and workspace

[简体中文](../zh-CN/user-guide.md) · [Home](../../README.md)

## Market and chart controls

Select the provider and symbol before choosing the timeframe. A-share stocks, ETFs and indices use the Rust TDX adapter. Binance and OKX provide their supported cryptocurrency markets. Polymarket uses probability series: do not interpret its values or chart coverage as ordinary stock OHLCV data.

The chart exposes only implemented controls. TDX-specific adjustment controls are visible only when the TDX A-share provider is compiled, enabled and selected; Global does not contain that provider or those controls. An adjusted price series is not the same input as unadjusted prices. Axis controls include normal, logarithmic, percentage and indexed displays, along with scale and range controls. A display change does not change the underlying source prices.

Use time-navigation controls to inspect earlier data or return to the latest view. History may arrive in stages. Connection recovery and a running indicator are not proof that every earlier bar has been recovered.

## Watchlists, drawings and markers

Search for a symbol and add it to the watchlist. Keep the provider identity when comparing similarly named symbols. A local-data research result opening a built-in-provider chart may show a different dataset from the research input.

Drawing tools include lines, shapes, annotations, Fibonacci and measurement tools. Supported drawings can be edited, hidden, locked, deleted and undone/redone. Drawings are isolated by their applicable symbol/adjustment context; do not expect every object to carry across every selection.

User markers have configurable text, color, shape and placement. They are distinct from indicator-generated markers. An indicator can regenerate its own output after a data update; use a drawing for an object you need to drag manually.

## Built-in and custom indicators

The built-in indicator set includes volume, MA, EMA, Bollinger Bands, MACD and RSI. Configure parameters through the normal indicator settings. MA/EMA support a separate source timeframe: for example, a monthly MA16 while the visible chart stays daily, subject to available source history.

Import a UTF-8 `.tfi` through the indicator picker. After validation, choose **Import and add** to display it, or **Save only** to keep it in the library. Compatible parameters and layouts are preserved during same-ID replacement; a failed replacement attempts recovery, but this is not a permanent version-history service.

You may create indicators yourself, ask AI to generate them or exchange files privately. No marketplace registration or maintainer review is required. Treat every third-party indicator as code requiring your own evaluation even though it runs in isolation. See [Indicator reference](indicators.md).

## AI conversations and result files

Use the right-sidebar **AI** button. The conversation is the main interface; model settings, **My Data** and external MCP are under **Settings**. Use **New conversation** and **History** to manage local conversation records.

Changing the displayed symbol, timeframe or adjustment does not by itself cancel an AI model's ongoing reasoning or an independent research task. Specific operations aimed at the old chart become stale and must be re-evaluated using fresh context. This prevents an old plan from being silently applied to the new chart.

Ask AI to save a report or table to Desktop, Documents or Downloads. The file tool creates a new Markdown, TXT, CSV or JSON file; it does not overwrite existing files. A saved task definition is different from a saved result file.

## What is saved

The local workspace retains supported watchlist, chart, drawing, indicator-library, connector and saved-task settings. Conversation history restores text, not live tool handles or pending actions; it does not replay past writes. Research results are temporary in-memory, session-owned data. Export important results before ending the relevant session or closing the app.

Application files and data directories are separate. Removing a data connection removes its registration and connector, not the original dataset. See [Local data and tasks](data-and-tasks.md) and the [FAQ](faq.md).
