# User research examples

[简体中文](README.zh-CN.md) · [Full walkthrough](../../docs/en/examples.md)

Importable examples for explicitly selected local data and window-based research. These use **synthetic** input, not historical market prices. They do not constitute an official scanner or trading system.

| File | Purpose |
| --- | --- |
| [csv-daily.tfc](csv-daily.tfc) | Read the two synthetic five-row CSV files in [data](data/) |
| [sqlite-daily.tfc](sqlite-daily.tfc) | Read a compatible stable SQLite snapshot |
| [parquet-daily.tfc](parquet-daily.tfc) | Read a compatible projected Parquet dataset |
| [window-breakout.tft](window-breakout.tft) | Compare the final close with preceding closes |
| [sma-backtest.tft](sma-backtest.tft) | Educational previous-close signal / next bar open execution example |

Choose only the `data` subdirectory through **AI → Settings → My Data**, then import the connector. For tasks, provide the complete `.tft` text to the assistant and follow the [walkthrough](../../docs/en/examples.md); the business MCP cannot read arbitrary repository files.

Both CSV symbols are short windows: five rows against 120 requested. With lookback 3 only `SZ:000001` matches the breakout condition. At zero fees and zero slippage, the separate backtest accounts end at 500 (`SH:600000`) and 1000 (`SZ:000001`), starting from 1000 each. Do not confuse these with real prices or the distinct SQLite/Parquet sample data.

Save as tool preserves a successful task definition, not in-memory results. Export important results explicitly. SQLite requires a non-WAL snapshot; other format and history boundaries are in [Local data and tasks](../../docs/en/data-and-tasks.md).

`npm run test:extension-examples` tests these shipped files; `npm run examples:format-data` generates separate synthetic SQLite/Parquet files in a new target directory. Neither validates arbitrary user strategies.
