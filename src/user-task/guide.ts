export const TASK_EXAMPLE = String.raw`// Research example, not a built-in investment strategy.
defineTask({
  formatVersion:1,apiVersion:1,id:'example.window-change',version:1,name:'区间变化研究',
  description:'逐品种计算所返回窗口的价格变化，输出结果表和候选品种。',
  inputSchema:{type:'object',properties:{'最低变化百分比':{type:'number'}},required:['最低变化百分比'],additionalProperties:false},
  defaults:{'最低变化百分比':0},
  history:[{id:'daily',resolution:'1D',adjustment:'none',count:120}],
  outputs:[
    {id:'table',type:'table',title:'区间变化',columns:[
      {id:'symbol',title:'品种',type:'symbol'},{id:'bars',title:'实际行数',type:'number'},
      {id:'change',title:'区间变化(%)',type:'number'},{id:'shortfall',title:'少于请求行数',type:'boolean'}]},
    {id:'selected',type:'symbol_list',title:'符合条件的品种'},
    {id:'report',type:'report',title:'运行说明'}
  ],
  create(parameters){let processed=0,matched=0,empty=0,partial=0;
    return {
      onSymbol(batch){
        const window=batch.history.daily,rows=window.rows;processed++;
        if(window.shortfall)partial++;
        if(window.seriesKind!=='ohlcv'||rows.length<2||rows[0].close===0){empty++;return [];}
        const change=(rows[rows.length-1].close/rows[0].close-1)*100;
        const output=[{artifactId:'table',rows:[[batch.symbol,rows.length,change,window.shortfall]]}];
        if(change>=parameters['最低变化百分比']){matched++;output.push({artifactId:'selected',rows:[batch.symbol]});}
        return output;
      },
      finish(){return [{artifactId:'report',text:'已处理 '+processed+' 个品种，符合条件 '+matched+' 个，不适用或缺少数据 '+empty+' 个，短窗口 '+partial+' 个。\n这里计算的是数据源实际返回的窗口，不保证是最近 120 根、完整历史或最终收盘值。不是买卖建议，也没有进行交易或收益回测。'}];}
    };
  }
});`;

export const TASK_GUIDE = `TradeFlow User Task SDK v1 (.tft)
Use defineTask once with formatVersion/apiVersion=1, id, positive version, name, optional description,
inputSchema/defaults (the same strict JSON Schema subset as tools), history and outputs.
Use readable parameter keys in the user's language; the ordinary UI builds form labels from them.
Task id plus every history/output/table-column id must be a lowercase identifier matching ^[a-z][a-z0-9._-]*$.
Use snake_case such as last_close, not camelCase such as lastClose. Parameter keys are not subject to this identifier rule.
history is 1-8 named windows: {id,resolution,adjustment:'none'|'qfq',count:1..12000}.
The host prepares ONE symbol's windows at a time. create(parameters) returns synchronous onSymbol(batch) and optional finish().
batch={symbol:{providerId,symbol,kind,name},history:{[windowId]:{rows,seriesKind,requestedCount,shortfall,coverage,finality,...}}}.
OHLCV rows are {time,open,high,low,close,volume,amount?}; probability rows are {time,value} with value in percent.
time is Unix seconds. Volume units/finality may be unknown. Handle empty/short windows. A Connector may return its OLDEST page,
not latest bars; nextCursor means more source data exists. This runtime uses the returned window, not the entire historical file.
Do not claim a full-history backtest, recent scan or complete coverage without checking the actual timestamps/source behavior.
Callbacks return arrays of append batches: {artifactId,rows} or {artifactId,text}. Returning undefined means no output.
outputs declares table {id,title,type:'table',columns:[{id,title,type:'string'|'number'|'boolean'|'symbol'}]},
symbol_list {id,title,type:'symbol_list'}, series {id,title,type:'series'}, report {id,title,type:'report'}.
Table rows are arrays in column order, cells may be null; symbol cells and SymbolList rows use the full symbol identity.
Series rows {time,value} must have strictly increasing times ACROSS the entire artifact. Report is plain text, not executable HTML.
No DOM/native/filesystem/network/modules/system commands/source editing/trading APIs. User code only enters Worker+QuickJS/WASM.
AI workflow: read this guide and source capabilities; generate source; tf.task.validate -> draftId; tf.task.start -> taskId;
inspect status and artifacts, then bounded result pages. Do not spin polling or report success before state=completed.
When validate returns valid=false, use errorCode plus path/reason/expected to repair that exact field before retrying.
The ordinary task page shows live progress. Cancellation terminates VM and cancels I/O; slot release waits for real I/O completion.
Start is an approved write. Status/page and cancelling/releasing one's own ephemeral computation are read/resource operations.
Task ownership belongs to the app session, not the foreground chart. Changing charts is allowed. New chat/session revoke cancels its jobs and releases results.
The UI can explicitly share one result with the current AI using tf.task.claim and a one-use expiring token; this grants only read access.
Results may be partial when failed/cancelled. tf.task.page returns rowsJson for structured artifacts, not the entire dataset. Check pageUnit and complete on every page: Table/SymbolList/Series use pageUnit='rows'; Report uses pageUnit='characters', so limit=5 means five characters, not five lines. If complete=false, continue from nextOffset before calling the artifact complete.
Tables support sortBy/descending/filter. Symbol cells are searchable by code and their name/provider/kind metadata; filtering does not change the stored/exported row. Very large single rows must be inspected/exported locally rather than flooding the model context.
The local CSV/JSON export does not send a model request. Model-requested pages/source text go to the configured model service.
A completed run can be saved with tf.task.save (expectedRevision required when replacing). It persists only .tft definition, not data/results.
tf.task.library returns the dynamically registered toolName. Saved tools use the same providerId/universe plus typed parameters schema.
Call a saved dynamic Task tool to START a new run: pass providerId plus one universe selector (catalog/watchlist/symbols/result) and its typed parameters.
The dynamic Tool returns a new taskId; it does not return finished rows. Read that taskId with tf.task.wait/status/page exactly like a manually started task.
artifactId/resultTaskId are only used when universe='result' to START from a previous SymbolList; they are not generic dynamic-tool result-reading arguments.
Remove a saved Task definition with tf.task.remove{id,revision} using the exact id/revision from tf.task.library. A run taskId is not a saved definition id.
Restoring a saved task only validates/registers; it never auto-runs. Update/remove cancels and drains the old definition's active jobs.
Universe can be catalog, current watchlist, explicit symbols, or a completed SymbolList result handle. providerId is one data source;
different provider IDs are never silently substituted. Explicit symbol arrays are bounded by normal Tool transport, not total universe size.
Catalog and SymbolList tasks support 5000+ symbols without serializing all identities into the model prompt.
Static provider catalogs use currently loaded symbols, not necessarily a full exchange universe. status.universeScope states the actual scope;
shortfallSymbols/emptySymbols describe successfully processed inputs with missing windows. complete describes execution, not complete market history.
Budgets are host engineering protections. Busy/capacity means finish/cancel or release unused local results, not a paid permission tier.
This is a generic user computation runtime, not an official scanner, database, order executor or validated investment strategy.`;
