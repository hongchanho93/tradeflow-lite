# Local data and research tasks

[简体中文](../zh-CN/data-and-tasks.md) · [Home](../../README.md) · [Examples](examples.md)

## Select your own data

Open **AI → Settings → My Data → Add My Data** and choose the smallest relevant directory in the system picker. A path typed into chat does not authorize access. Avoid selecting a source checkout, your entire home directory or a folder containing unrelated credentials.

A `.tfc` connector translates files in that selected directory into the application's symbol/history contract. Use the data card's **More → Import connector file**, validate the candidate and install it when its small-sample check succeeds. Alternatively use **Let AI connect**; the button prepares a message, but you still decide when to send it.

The files stay where they are and are read-only to this connector. Disable stops the connection's work and removes its dynamic query tools. Delete removes the registration/connector, not the original files. Moving or replacing the directory requires a new explicit selection; the app does not silently trust a new folder at the old path.

## CSV, SQLite and Parquet

CSV can be read through the connector's bounded byte/text IO. The shipped CSV example uses `time,open,high,low,close,volume`, Unix seconds, daily unadjusted bars and filenames such as `SH_600000.csv`. Those are example assumptions, not mandatory names or formats for your dataset. Adapt the parser to actual columns, timestamps and price/volume units; never invent missing prices or fill unknown volume with zero.

SQLite uses the native read-only interface and requires a stable **non-WAL snapshot**. A live database with an active WAL is not a supported consistent input; prepare a proper snapshot using your database workflow. Parquet uses native schema inspection and projected reads of supported flat, non-repeated columns. Type/encoding support must be verified on real samples; nested/repeated layouts are not universally supported. Preserve exact integers/timestamp units and handle lossy conversion explicitly.

Arrow IPC, arbitrary decompression, remote-service credential management and a universal database importer are not implemented. CSV, SQLite and Parquet support does not imply those features. Ask `tf_data_guide` for the running API and use `tf_data_sample` with the desired format before writing the connector.

Validation checks syntax/manifest and a small catalog/history sample, not the quality of an entire dataset. Errors use `stage`, `errorCode` and, when available, `path/reason/expected` plus a sanitized `failureDetail`. `listSymbols` must honor `query.limit`. A known unsupported history format can return exactly `{unsupported:'lowercase_reason_code'}`; it is reported as `data_history_unsupported`, not a misleading empty history. Crashes or invalid output still fail validation.

## Ask for a calculation

Use the AI conversation to describe the source, universe, timeframe, price adjustment, data window, calculation and desired output. For an existing `.tft`, provide its complete text to the assistant; do not assume the business MCP can read files from the application repository. See the [shipped examples](../../examples/user-research/README.md).

The assistant reads `tf_task_guide`, creates a complete `.tft`, calls `tf_task_validate` and starts a small test using `tf_task_start`. Validation alone does not execute calculations. Use `tf_task_wait` instead of rapidly polling through model calls. After success, inspect `tf_task_status` and `tf_task_page` before expanding the scope or saving a reusable definition.

Tasks process one explicit data source and the windows actually returned for each symbol. Universes can come from a catalog, watchlist, explicit symbols or a previous result's symbol list. User-data connectors can supply tasks, but they do not automatically become built-in market providers or replace the visible chart. Opening a corresponding built-in-provider chart may display a different dataset.

Task IDs and table column IDs must follow the guide's lowercase identifier rules: use `last_close`, not `lastClose`. Correct errors from `path/reason/expected` rather than changing unrelated fields.

## Interpret results honestly

Results may be tables, symbol lists, series or reports. Check processed, skipped, failed and short-window counts, timestamps, coverage and finality. A completed calculation is not proof of recent data, complete history, every market symbol or an executable trading strategy.

CSV reference data is paged oldest-first. The first returned window can therefore be the oldest rows, not the latest N bars. The current task does not automatically consume all historical pages. A complete historical backtest needs a separately verified input range and execution assumptions.

For `tf_task_page`, Table/SymbolList/Series use `pageUnit='rows'`; Report uses `pageUnit='characters'`. Always inspect `complete` and `nextOffset`. Five report characters are not five lines. Parsed `rowsJson` preserves structured table cells; a partial page must not be described as the whole result.

## Save, reuse and stop

Ask AI to save results to Desktop, Documents or Downloads. Tables normally use CSV and reports Markdown; TXT and JSON are also available. `tf_result_save_file` can export a complete task artifact without sending every row through the model. It creates a new file, including a collision-safe name, and never overwrites originals. Report success only after the tool receipt.

“Save as tool” stores a validated, successfully run `.tft` definition, not the computed results. It appears in the shared AI/MCP tool catalog. Startup restores definitions without automatically running them. The library's current dynamic name and revision are authoritative when reusing/updating/removing a saved tool.

Results live in application memory and belong to a session. Restart or session release can remove them. Use explicit export for permanent results; a saved definition is not a permanent result database. The AI can send the pages it reads to your selected service, so local computation alone does not guarantee an external AI sees no data.

Manual chart switching does not cancel an independent task. Ask AI to stop it; cancellation can remain pending until a native read actually exits. Disabling, replacing or deleting a connector cancels work attached to the retired connection. Cancellation cannot retract data already sent to a model or undo already saved files.

This is a user-owned research runtime, not an official stock screener, full-history trading simulator or broker. Unlimited history streaming, live task subscriptions and permanent results are not built in. Runtime budgets protect responsiveness; they are not paid usage tiers or proof of a strategy's validity.
