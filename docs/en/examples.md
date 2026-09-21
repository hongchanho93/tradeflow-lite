# Reproducible research examples

[简体中文](../zh-CN/examples.md) · [Home](../../README.md)

These are small **synthetic** examples, not market history or investment strategies. They demonstrate connectors, tasks and result handling without changing the application's source. Files live in [examples/user-research](../../examples/user-research/README.md).

## Connect the CSV sample

In **AI → Settings → My Data → Add My Data**, select only [examples/user-research/data](../../examples/user-research/data/), not the entire repository. Use the card's **More → Import connector file** to import [csv-daily.tfc](../../examples/user-research/csv-daily.tfc), inspect validation and install it. No model is needed for that native connector-import step.

For the chat-first task workflow, provide the complete text of [window-breakout.tft](../../examples/user-research/window-breakout.tft) to your assistant. Ask it to read `tf_task_guide`, validate the source, find the selected source with `tf_data_list`, and run the task on that source's catalog with lookback **3**. Do not assume the business MCP can read arbitrary repository files. Use `tf_task_wait`, then inspect status and all relevant pages with `tf_task_page`.

Both CSV files contain five bars while the task requests 120, so both are **short windows**. Five rows still suffice for this lookback. Only `SZ:000001` matches: final close 13 is above the preceding three closes' maximum of 9. `SH:600000` finishes at 10, not above its comparison maximum of 12.

The samples cover UTC midnight on January 1–5, 2024 (`1704067200` to `1704412800`). They are not exchange calendars or historical prices. Symbol-shaped filenames only demonstrate identity and routing. Opening a corresponding native-provider chart does not put this synthetic CSV on the main chart.

## Check the educational backtest

Provide [sma-backtest.tft](../../examples/user-research/sma-backtest.tft) in the same way. To reproduce this table, set **fee basis points and slippage basis points both to zero**, keeping the other defaults. Their normal defaults are 10 and 5 respectively. The example uses the previous close's signal and the **next bar open** for execution.

| Zero-cost check | SH:600000 | SZ:000001 |
| --- | --- | --- |
| Separate initial capital | 1000 | 1000 |
| Execution | Buy 50 units at row 4 open 20, sell at row 5 open 10 | No fill; the final signal has no next bar |
| Final equity | 500 | 1000 |
| Window return | -50% | 0% |
| Maximum closing drawdown | 55% | 0% |

This uses fractional quantities and separate all-in/all-out accounts, not a shared portfolio. It does not model round lots, T+1, price limits, halts, volume constraints or corporate actions. Remaining holdings are marked at the final close, not forcibly liquidated. The example must not be described as a real execution simulator.

## SQLite and Parquet examples

[sqlite-daily.tfc](../../examples/user-research/sqlite-daily.tfc) and [parquet-daily.tfc](../../examples/user-research/parquet-daily.tfc) use the same read-only authorization and task framework. SQLite requires a stable non-WAL snapshot; Parquet supports the explicitly handled types/encodings. See [Local data and tasks](data-and-tasks.md).

With a source environment, `npm run examples:format-data` produces new synthetic SQLite and Snappy/Zstd Parquet files under a fresh `src-tauri/target/format-examples-*` directory. It does not overwrite existing files. Each symbol has five rows starting at `1700000000`, one day apart, closes 10/11/12/13/14 and volume 100. These prices differ from the CSV example; do not reuse the CSV backtest expectations. The Parquet sample's nanosecond timestamps include a 123 ns remainder that the connector deliberately reduces to bar seconds. Real user data does not require running this generator.

## Keep and reuse the result

Ask the assistant to export an important table/report before the session ends. After a successful run, **Save as tool** uses `tf_task_save` to retain the definition; restart restores it without automatically running it. This does not preserve in-memory results. Use `tf_task_library` to discover the saved tool's actual name.

The CSV connector pages oldest-first and tasks use the returned window, not necessarily the latest rows or complete history. Verify range, short-window counts and finality. A completed example is not a complete-market scan. Test the shipped examples with `npm run test:extension-examples`; this does not validate arbitrary user strategies.
