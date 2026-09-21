# AI tool reference

[简体中文](../zh-CN/api-reference.md) · [Home](../../README.md) · [Connection guide](ai-guide.md)

This is a navigation reference, not a replacement for runtime schemas. The default registry contains **74 business tools**; external MCP also supplies `tf_context_get`. Installed connectors and saved tasks add dynamic tools. The documentation test checks this inventory against the actual registered code.

## Discover before calling

An MCP client initializes, reads `tools/list`, and invokes the returned names with the supplied input schema. Internal dot-separated IDs and external wire names are not interchangeable in arbitrary contexts. Refresh after `notifications/tools/list_changed`; long dynamic names can be aliases with exact IDs and registration revisions in metadata.

Begin an unfamiliar workflow with `tf_ai_help`, then the relevant format guide. Do not copy cached schema assumptions from another build. Preserve returned opaque handles, cursors, object versions and `expected` selections exactly. Some fields such as `inputsJson`, `parametersJson` and `rowsJson` contain serialized JSON strings; follow the actual schema instead of replacing them with guessed objects.

## Default tool inventory

| Area | Tools |
| --- | --- |
| Help and context | `tf_ai_help`, `tf_context_get` |
| Chart snapshots | `tf_chart_snapshot`, `tf_dataset_page`, `tf_dataset_release` |
| Calculations | `tf_compute_summary`, `tf_compute_sma` |
| Provider discovery | `tf_market_providers`, `tf_market_provider`, `tf_market_search`, `tf_market_catalog` |
| Independent market data | `tf_market_history`, `tf_market_page`, `tf_market_release`, `tf_market_quote`, `tf_market_quotes` |
| Watchlist | `tf_watchlist_list`, `tf_watchlist_add`, `tf_watchlist_remove`, `tf_watchlist_move`, `tf_watchlist_quotes` |
| Chart selection | `tf_chart_current`, `tf_chart_open`, `tf_chart_resolution`, `tf_chart_adjustment`, `tf_chart_visible_range`, `tf_chart_data_window` |
| Indicator state and parameters | `tf_indicator_definitions`, `tf_indicator_instances`, `tf_indicator_add`, `tf_indicator_remove`, `tf_indicator_inputs_get`, `tf_indicator_inputs_set`, `tf_indicator_visibility`, `tf_indicator_retry` |
| User indicator library | `tf_indicator_library`, `tf_indicator_guide`, `tf_indicator_source`, `tf_indicator_validate`, `tf_indicator_draft_release`, `tf_indicator_test`, `tf_indicator_install`, `tf_indicator_library_remove` |
| Drawing transactions | `tf_drawings_types`, `tf_drawings_list`, `tf_drawings_propose`, `tf_drawings_apply`, `tf_drawings_apply_existing`, `tf_drawings_revert`, `tf_drawings_remove_owned`, `tf_drawings_history`, `tf_drawings_revert_saved` |
| Local connectors | `tf_data_guide`, `tf_data_list`, `tf_data_files`, `tf_data_sample`, `tf_data_source`, `tf_data_validate`, `tf_data_install`, `tf_data_manage` |
| Running tasks | `tf_task_guide`, `tf_task_validate`, `tf_task_start`, `tf_task_list`, `tf_task_status`, `tf_task_wait`, `tf_task_page`, `tf_task_cancel`, `tf_task_release`, `tf_task_claim` |
| Saved tasks | `tf_task_library`, `tf_task_source`, `tf_task_save`, `tf_task_remove` |
| File output | `tf_result_save_file` |

## Data and lifetime contracts

Capture the chart only when the request concerns that chart. For independent queries, use a provider-qualified symbol and supported timeframe/adjustment with `tf_market_history`. The result is an immutable `datasetId`, not every row. Read `tf_market_page`, compute locally as appropriate, then release it. Chart snapshots use `snapshotId`; summary/SMA require exactly one of the two reference types.

Every interpretation must consider actual timestamps, `coverage`, `finality`, `shortfall`, `priceUnit` and `volumeUnit`. Capture time is not an exchange freshness guarantee. Probability points must not acquire invented OHLC or volume. Catalog fields `ready`, `catalogLoaded` and `catalogComplete` distinguish availability from complete discovery.

Tools and their results are session-owned. Normal pairing survives restarts, but temporary chart datasets, market datasets, drafts and tasks do not become cross-session resources. Refresh state after a reconnect. Releasing an already consumed independent market handle returns `snapshot_unavailable`; it does not remove saved user content.

## Chart and drawing writes

Read the current selection before intentional navigation and pass its exact `expected` value. A stale request must not mutate a newly selected chart. Old context operations return `context_stale`; reread and re-evaluate rather than changing the request's target silently.

Discover drawing schemas with `tf_drawings_types`, then use time/price coordinates, not pixels. The native types currently are:

`HorizontalLine`, `TrendLine`, `Rectangle`, `Text`, `Ray`, `Arrow`, `ExtendedLine`, `HorizontalRay`, `VerticalLine`, `CrossLine`, `Callout`, `Circle`, `Triangle`, `PriceRange`, `ParallelChannel`, `FibRetracement`, `Brush`, `Highlighter`, `Path`, `LongShortPosition`, `UpArrow`.

Read current object IDs/versions, propose a frozen batch, then apply it. `tf_drawings_apply` is limited to new or unchanged session-owned objects. `tf_drawings_apply_existing` can modify existing user/old-session content after pairing without a second per-operation dialog, but must follow the user's explicit request and pass context/version checks. For undo, use the relevant current-session or saved receipt and reject intervening edits. Saved history is not restored authorization.

`tf_drawings_remove_owned` is for explicit cleanup of still-owned objects using their IDs when an older change set is unavailable. It refuses unrelated objects and objects edited since creation. Do not broadly delete objects to simulate undo.

## Generated extensions

Indicator workflow: source/guide → validate → test → install → inspect. `tf_indicator_test` returns Series, Marker, BarStyle, Canvas, Panel and `allOutputsEmpty` diagnostics, not just line data. Match `sourceHash` and `stage`, inspect `coveredReasons` and pointer coverage, and use `context.log` for bounded diagnostic text. A `preflight-synthetic` fixture is not evidence of live data. A `setData` limit of 12000 points does not override callback time budgets. For MTF use `context.data.get`, not chart navigation. Update with `applyToExisting=true`; use `disposition` to distinguish new/replaced/unchanged code. Release unused indicator drafts.

Connector workflow: list authorized sources → sample → guide/source → validate → install → use the discovered query tool. The user must select a directory in the native UI; `tf_data_files` and `tf_data_sample` cannot grant access. Query output and source code can be sent to the chosen model. Connector queries are distinct from built-in-provider chart history.

Task workflow: guide/source → validate → small run → local wait → status/page → explicit save/reuse. For paging, `pageUnit` is rows except reports, where it is characters. Check `complete/nextOffset` and partial-result flags. `tf_task_claim` consumes an explicit one-use result-sharing token; it does not grant general task ownership or directory permission. Saved task definitions are restored but never auto-run.

## Errors and successful receipts

Use `path/reason/expected`, `field`, `stage`, `errorCode` and sanitized `failureDetail` when provided. Validation success does not prove execution, complete data or successful installation. Do not retry writes blindly after an uncertain response; reread current state and versions.

`tf_result_save_file` creates new Markdown/TXT/CSV/JSON under Desktop, Documents or Downloads. For complete task output, use its task-artifact source rather than reproducing every row in a prompt. It cannot overwrite/read/delete/execute arbitrary files. Only a successful tool receipt supports saying a file was saved.

Source contracts: [common tools](../../src/ai-capabilities/contracts.ts), [indicator guide](../../src/user-indicator-runtime/ai-guide.ts), [connector guide](../../src/user-data/guide.ts), [task guide](../../src/user-task/guide.ts). Authorized source-level extension instructions are in [Source extensions](extensions.md).
