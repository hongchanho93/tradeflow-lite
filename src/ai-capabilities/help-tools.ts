import type { ToolDefinition, ValueSchema } from './contracts.ts';
import { objectSchema } from './chart-data.ts';

const TOPICS = ['overview','chart','market','indicator','drawing','data','task','files'] as const;
type HelpTopic = typeof TOPICS[number];

const guides: Readonly<Record<HelpTopic, string>> = Object.freeze({
  overview: `TradeFlow Lite current AI capability map:
- Current chart/context: tf_context_get, chart snapshot/dataset pages, chart navigation and adjustment tools.
- Independent market data: provider/catalog/search/history/page/release/quote/quotes. Use these instead of changing the visible chart just to calculate another symbol or timeframe.
- Indicators: built-in definitions/instances plus isolated .tfi user indicators. Read tf_indicator_guide before generating .tfi.
- Drawings: read tf_drawings_types before creating/editing native drawings.
- Local user data: read tf_data_guide and tf_data_list; new directories are selected by the user in Settings > My Data.
- Batch research: read tf_task_guide; tasks run independently from the foreground chart.
- Result delivery: tf_result_save_file writes generated results to Desktop/Documents/Downloads.
Do not guess missing APIs. Read the relevant guide/tool schema first. Application source, arbitrary files, shell, credentials and trading are not business tools.`,
  chart: `Chart rules:
- tf_context_get returns the current chart context. Pass the exact context to chart-scoped tools.
- A manual symbol/resolution/adjustment change does not cancel the model's whole task. Old chart operations become context_stale; refresh context and continue inside the same task.
- Do not navigate the visible chart merely to fetch another timeframe or symbol for research. Prefer tf_market_history or MTF indicator data.
- Chart snapshot is the displayed committed chart data; independent history is separate and may contain a much deeper window.`,
  market: `Market data rules:
- Use tf_market_providers/provider to inspect actual provider capabilities, resolutions and adjustments.
- tf_market_history returns an immutable dataset handle; page it with tf_market_page and release when finished.
- tf_compute_summary and tf_compute_sma accept that market datasetId directly, so calculations on another timeframe do not require chart navigation. Pass exactly one of datasetId/snapshotId.
- requestedCount is a request, not a guarantee. Check rowCount, timestamps, shortfall, coverage/finality metadata.
- Search/catalog coverage can be partial; do not call it a full exchange universe unless metadata proves that.
- For another timeframe, query that resolution directly; do not change the user's chart as a calculator.`,
  indicator: `Indicator rules:
- Inspect tf_indicator_definitions/library/instances before editing. Built-in MA and EMA support a sourceResolution input: current/1/5/15/30/60/120/240/1D/1W/1M. This enables a monthly MA on a daily chart without changing display resolution. Do not change the user's visible chart just to calculate another timeframe.
- For generated .tfi, first call tf_indicator_guide. MTF/cross-symbol .tfi declares top-level data windows, e.g. data:{monthly:{resolution:'1M',count:8000,adjustment:'current'},benchmark:{symbol:'SH:000001',kind:'index',resolution:'1D',align:'main'}}, then reads context.data.get(key). Cross-symbol windows are limited to 4 requests / 3 target symbols within the normal 8-window total.
- event.bars is always the current chart timeframe. Extra MTF/cross-symbol bars come only from context.data.get(). align=main keeps the returned bars array exactly on the main timeline and uses null for suspended/missing timestamps; main-ffill forward-fills instead. A failed cross-symbol fetch yields null for that key rather than failing the whole indicator; use context.data.status(key) to distinguish provider_mismatch, symbol_unavailable, kind_mismatch, unsupported resolution/adjustment, series-kind and history failures.
- Extra data is fetched/cached by the host outside QuickJS; user code remains synchronous and has no network/filesystem access. series.setData has its own bounded point budget and may legitimately be longer than the foreground chart bars when align=none.
- Order flow uses supports.requires.depth/trades and arrives as bounded realtime event.depth/event.trades/event.marketStatus from the existing host stream. There is no historical depth/tape and no user-code network subscription.
- Interactive indicator graphics use Marker/Canvas id + hitTest=true and optional lifecycle.onPointer({type:'hover'|'click'|'leave',...}). Indicator graphics are not draggable; use Drawing for user-movable objects.
- Workflow: guide -> validate -> tf_indicator_test -> install -> add/configure -> inspect instance state. validate returns disposition=new/replace/unchanged. tf_indicator_test runs against the current chart's retained history, uses the same declared MTF windows, and replays initial -> history -> realtime -> reconciliation in one persistent runtime instance. If an interactive target exists it also replays hover -> click -> leave. Check coveredReasons, coveredPointerTypes, timings, Series/Marker/BarStyle/Canvas/Panel and bounded context.log diagnostics. A pure non-Series indicator may legitimately have series=[]; use allOutputsEmpty and its diagnostics instead of treating series=[] as failure. Never switch the chart just to prepare test data.
- A validated draft is temporary. Install consumes it; after a failed test or abandoned edit call tf_indicator_draft_release before validating another revision so staged capacity is reclaimed immediately.`,
  drawing: `Drawing rules:
- Call tf_drawings_types before constructing a native drawing; use its point/style schema instead of guessing.
- Use propose then the indicated apply tool. Existing object versions and current chart context must match.
- tf_drawings_apply_existing can modify/delete user or old-session drawings. Under the current paired-MCP/built-in-assistant authorization model it does NOT show a second per-operation confirmation; only use it when the user's request clearly authorizes changing existing content. Context + object version/CAS still protect against stale writes.
- If you need to clean up objects that this same AI session created, use tf_drawings_remove_owned with their ids. It survives timeframe/chart-context changes and refuses user/other objects or objects edited since creation; do not depend on an old changeSet just to remove your own object.
- Prefer an indicator series for data-driven values that should update with market data. Drawings are annotations, not a substitute for a dynamic MTF indicator.
- Never claim success until apply returns success.`,
  data: `User data rules:
- First call tf_data_guide and tf_data_list. If no matching selected source exists, ask the user to choose Settings > My Data > Add My Data.
- Inspect real files/sample/schema before generating a Connector; adapt the Connector to user files rather than inventing a format.
- CSV, read-only SQLite and Parquet are supported through the same selected-directory boundary. Follow tf_data_guide for precision and pagination rules.
- Validate -> install -> use the dynamically registered source query tool.`,
  task: `Task rules:
- Read tf_task_guide before generating .tft. Tasks are background local computations, not todo/reminder items.
- Validate -> start -> tf_task_wait -> status/page. Do not busy-poll.
- Tasks are independent of foreground chart changes and can produce Table/SymbolList/Series/Report.
- Save a completed task as a reusable Tool only when the user asks. A saved dynamic Tool starts a NEW run and returns taskId; read the result through tf_task_wait/status/page. Remove a saved definition with the exact id+revision from tf_task_library, not a run taskId.
- A Task start uses one providerId; explicit symbols must belong to that provider. Use tf_result_save_file for file delivery.`,
  files: `Result file rules:
- When the user asks to save/export an analysis or result, call tf_result_save_file; do not invent a saved path in prose.
- Narrative output defaults to Markdown; tables default to CSV. Full task artifacts can be written host-side without copying every row through the model.
- Destinations are Desktop/Documents/Downloads plus relative subfolders. This is not arbitrary filesystem access and cannot read/delete/execute files.`,
});

const topicSchema: ValueSchema = { type: 'string', enum: [...TOPICS] };

export function createAiHelpTools(): readonly ToolDefinition[] {
  return [{
    id: 'tf.ai.help',
    version: 1,
    title: '读取 AI 能力说明',
    scope: 'app',
    effect: 'read',
    description: 'Read a concise current TradeFlow Lite capability/playbook topic before guessing a multi-step workflow. Use topic=indicator for MTF indicators, chart for context/navigation, market for independent history, drawing/data/task/files for those workflows.',
    inputSchema: objectSchema({ topic: topicSchema }, ['topic']),
    outputSchema: objectSchema({ topic: topicSchema, guide: { type: 'string', maxLength: 8192 } }, ['topic','guide']),
    run(input) {
      const topic = (input as { topic: HelpTopic }).topic;
      return { topic, guide: guides[topic] };
    },
  }];
}

