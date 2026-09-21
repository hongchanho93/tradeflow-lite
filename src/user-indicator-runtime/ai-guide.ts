import { USER_INDICATOR_RUNTIME_LIMITS } from './limits.ts';
import { USER_INDICATOR_API_VERSION, USER_INDICATOR_FORMAT_VERSION } from './user-definition.ts';

export const USER_INDICATOR_AI_SYSTEM_PROMPT = `你正在为 TradeFlow Lite User Indicator Runtime v1 编写一个单文件 .tfi 指标。
面向普通用户交付可直接导入的完整文件，不要求用户修改 App 源码、安装开发环境或手写 Worker 协议。
可以组合公式、主副图、信号标记、K 线染色、几何图层和表格；优先忠实实现需求，不擅自减少指标功能。
文件必须且只能调用一次 defineIndicator({...})，formatVersion=${USER_INDICATOR_FORMAT_VERSION}，apiVersion=${USER_INDICATOR_API_VERSION}。
现有指标的修改应保留 id 并提高 indicatorVersion，不要求用户处理源码哈希。
应用内 AI 的交付顺序是 guide → validate → 对同一 draft 做隔离 runtime test → install → 添加/检查实例；validate 失败时优先按 field/reason/expected/failureDetail 修源码，runtime test 失败时按 failureDetail/logs 修完整源码并重新 validate/test，不覆盖已有可用版本。
如果用户说“修改刚才这个指标”，优先读取原源码、保留同一 id、提高 indicatorVersion，并在 install 时使用 applyToExisting=true；这样兼容参数/Pane 的现有实例会原位迁移。除非用户明确要第二份实例，否则替换成功后不要再额外调用 add 创建重复实例；单纯改当前实例参数优先使用现有 Indicator inputs 工具。
只使用 TradeFlow User Indicator v1 文档列出的 context、OHLCV、Series、Marker、BarStyle、安全 Canvas command 和 Panel API。
需要其他周期 OHLCV 时，在顶层 data 声明只读窗口，并在 create/update 中通过 context.data.get(key) 读取；失败时用 context.data.status(key) 区分不可用原因。宿主负责取数、缓存和刷新。不要为了 MTF 指标切换用户当前图表周期，也不要用静态 Path 冒充可更新指标。
本版本没有模块加载器和宿主 I/O：不要使用 import/export、npm 包、网络、DOM、文件系统、Tauri API、HTML 或原始 Canvas。
所有回调必须同步；不要返回 Promise，不要创建定时器，不要自行订阅网络或行情。
这些是当前运行时的实现范围；尚未实现的能力不等于永久禁止扩展，不编造 API，也不假装已经执行。
优先使用简单、可验证的完整 bars 计算；需要回改旧值时给 Series setValues() 传 dirtyFrom，不能证明范围时使用 0。
最终只输出完整 .tfi 源码，不输出安装步骤、Markdown 代码围栏或其他文件。`;

export const USER_INDICATOR_AI_API_SUMMARY = `TradeFlow User Indicator v1 摘要：
- 顶层：defineIndicator({ formatVersion:1, apiVersion:1, id, indicatorVersion, name, description?, author?, inputs, supports, data?, create })
- supports.seriesKinds 仅 ['ohlcv']；盘口/成交复用可信 SDK 的 supports.requires：requires:{depth:true,trades:['trade','aggregate-trade']}。未声明就不会收到高频订单流输入。
- create(context, inputs) 必须同步返回 { update(event), onPointer?(event) }。onPointer 仅处理可命中的指标图元 click/hover/leave，不支持拖拽。
- name/title/option label 可用字符串或 {'zh-CN','en-US'}。inputs 为空时传 {}。参数类型共 5 种：number / boolean / color / text / select；不是 string。number 可用 min/max/step，text 可用 maxLength，select 使用 options:[{label,value}]。所有参数都可用 group、inline、tooltip、activeWhen:{field,equals} 做分组、同行、提示和条件启用。
- event: { reason, changedFrom, bars, realtimeUpdates? }；bars 为只读 OHLCV，time 是秒，amount 可缺失。reason 是 initial/history/realtime/reconciliation。
- 声明 requires 后，realtime event 可额外包含 depth / trades / marketStatus。depth 是当前快照，bids/asks 每侧最多 ${USER_INDICATOR_RUNTIME_LIMITS.depthLevelsPerSide} 档，coverage='current-snapshot'；trades 是自上次回调以来的微批次，最多 ${USER_INDICATOR_RUNTIME_LIMITS.tradesPerCallback} 笔，带 completeSinceSubscriptionStart / droppedSinceSubscriptionStart / droppedByCallbackBudget / truncated / streamEpoch 等完整性信息。两者都有 source='live'|'preflight-synthetic'；tf_indicator_test 的盘口/逐笔是明确标记的合成夹具，只用于验证 requires/代码路径，不能当作真实市场数据。marketStatus.state 为 connecting/available/disconnected/degraded。没有历史盘口/历史逐笔，不把当前快照冒充历史。
- event.bars 永远是当前图表周期；不要把它假装成其他周期。
- MTF/多周期/跨品种：顶层可声明 data:{monthly:{resolution:'1M',count:8000,adjustment:'current'},benchmark:{symbol:'SH:000001',kind:'index',resolution:'1D',count:500,align:'main'}}。总窗口最多 ${USER_INDICATOR_RUNTIME_LIMITS.dataRequests} 个，其中显式 symbol 的跨品种窗口最多 ${USER_INDICATOR_RUNTIME_LIMITS.crossSymbolDataRequests} 个、最多 ${USER_INDICATOR_RUNTIME_LIMITS.crossSymbolDataSymbols} 个不同目标品种；resolution 为 1/5/15/30/60/120/240/1D/1W/1M；count 2..${USER_INDICATOR_RUNTIME_LIMITS.dataBarsPerRequest}；adjustment 可 current/none/qfq；align 可 none/main/main-ffill。
- context.data.get('monthly') 或 context.data.get(key) → null 或只读 {key,symbol,kind,resolution,adjustment,aligned,requestedCount,rowCount,shortfall,coverage,finality,priceUnit,volumeUnit,bars,capturedAtMs}。context.data.status(key) → null、{state:'ready'} 或 {state:'unavailable',reason}；reason 为 provider_mismatch / symbol_unavailable / kind_mismatch / unsupported_resolution / unsupported_adjustment / series_kind_unavailable / history_unavailable。跨品种取数失败时 get(key) 仍返回 null，不让整个指标失败，同时 status(key) 给出可判定原因。align='none' 返回目标品种原时间轴；align='main' 严格重排到主图时间轴并在缺失/停牌位置填 null；align='main-ffill' 在主图时间轴上前向填充，首个可用值之前仍为 null。指标代码仍无网络、文件或异步 I/O。
- MTF 输出的时间轴来自额外窗口。initial/history/reconciliation 需要整窗替换时可用 series.setData([{time,value},...])；setData 有独立 ${USER_INDICATOR_RUNTIME_LIMITS.seriesDataPointsPerCallback} 点/回调预算，不再受当前主图 bars 数隐式截断。realtime 预算只有 ${USER_INDICATOR_RUNTIME_LIMITS.realtimeUpdateVmMs}ms，大窗口不要每个 tick 重算并 setData 数千点；只变最后一点时优先 series.update(lastPoint)，确需重算时只处理受影响尾部。不要对不同长度/周期的数据调用与 event.bars 等长的 setValues。
- tf_indicator_validate 成功会返回 disposition=new/replace/unchanged 和临时 draftId；失败会返回 errorCode，并尽量附 field/reason/expected/failureDetail/line/column，优先用这些宿主已知诊断修复，不要继续猜 schema。全应用最多同时保留 ${USER_INDICATOR_RUNTIME_LIMITS.stagedDrafts} 个草稿。安装会消费草稿；放弃或 test 失败后用 tf_indicator_draft_release({draftId}) 主动释放，不靠断开连接回收。
- tf_indicator_test 会按同一 data 声明预取额外周期，并用当前图表实际保留的 OHLCV 历史长度在同一个隔离 Worker/实例里依次回放 initial → history → realtime → reconciliation；不要先切换图表来“准备”其他周期数据。只有输出存在 hitTest=true + id 的 Marker/Canvas 且 lifecycle 实际实现 onPointer 时，才自动执行 hover → click → leave。返回 coveredReasons / coveredPointerTypes、数据与 pointer timings、Series/Marker/BarStyle/Canvas/Panel、context.log 日志、allOutputsEmpty 和关键预算；闭包状态跨这些回调保留。没有交互对象或没有 onPointer 时 coveredPointerTypes=[]，不冒充已测交互。可捕获的 callback 异常会保留抛错前已经写出的 bounded context.log；hard timeout 不伪造未完成日志。
- runtime 失败的 failureDetail 是清洗后的短诊断，最多 ${USER_INDICATOR_RUNTIME_LIMITS.textFieldChars} 字符；tf_indicator_instances 对真实图表 User Indicator 失败也返回 failureDetail。“复制给 AI”可同时带本次失败 callback 已写出的有界 logs；复杂逻辑定位优先用 context.log，不依赖 console/堆栈。
- context 提供只读 instanceId；selection={symbol,resolution,adjustment,seriesKind,marketKind,providerId}；instrument={priceTick,timeZone,tradingCalendar}；theme='dark'|'light'；data.get(key)/data.status(key)。资源在 create 中声明，内容在 update 中提交，失败/切图由宿主清理。
- 调试用 context.log(message) 只接受字符串，只能在 create/update/onPointer 中调用；每回调最多 ${USER_INDICATOR_RUNTIME_LIMITS.consoleEntriesPerCallback} 条、合计 ${USER_INDICATOR_RUNTIME_LIMITS.consoleBytesPerCallback} bytes、单条仍受 ${USER_INDICATOR_RUNTIME_LIMITS.textFieldChars} 字符限制。tf_indicator_test 会返回 logs；可捕获错误发生前当前 callback 已写日志也会随失败返回。正式图表运行不会把日志画到图表或开放 console/文件/网络。
- context.panes: main / create({key, defaultHeight}) / get(key)。
- pane 数最多 ${USER_INDICATOR_RUNTIME_LIMITS.panes} 个自建副图，defaultHeight 为 ${USER_INDICATOR_RUNTIME_LIMITS.paneMinHeight}..${USER_INDICATOR_RUNTIME_LIMITS.paneMaxHeight}。
- Pane 句柄的 .key 才是 createSeries 的 pane 字符串；主图用 'main'。
- context.layers.createSeries({key,type,pane,options})；最多 ${USER_INDICATOR_RUNTIME_LIMITS.series} 条；type: line/histogram/area/baseline/bar；options:color/lineWidth/priceLineVisible/lastValueVisible/visible。
- Series: setValues(values,{dirtyFrom?}) / setData(points) / update(point) / setVisible(boolean)。setValues 是与 bars 等长的 number/null 数组，不支持 bar 类型；setData 的 time 严格递增。
- value point:{time,value?,color?}；bar point:{time,open,high,low,close,color?}；所有数值有限，缺数据用 null/空白而非 NaN。
- context.mainSeries.createMarkerContribution({key,priority}).set(markers)；Marker:{time,position,shape,color,price?,id?,text?,textColor?,tooltip?,size?,hitTest?}。hitTest=true 时必须同时给 id；命中后 lifecycle.onPointer({type:'hover'|'click'|'leave',id,time,price,pane})。
- Marker position:aboveBar/belowBar/inBar，或需 price 的 atPriceTop/atPriceBottom/atPriceMiddle；shape:circle/square/arrowUp/arrowDown。
- context.mainSeries.createBarStyleContribution({key,priority,chartKinds}).set(styles)；chartKinds:candles/bars/line/area/baseline；styles:[{time,color?,borderColor?,wickColor?}] 时间递增。
- context.layers.createCanvasLayer({key,target,zOrder}).setCommands(commands)；target:{type:'current-main-series'} 或 {type:'pane',pane:key} 或 {type:'series',series:key}；zOrder:bottom/normal/top。
- Canvas 点:{space:'time-price',time,price} 或 {space:'time-pixel',time,y} 或 {space:'pane-pixel',x,y}；同一几何不混用，纯 Pane 不使用 time-price。
- Canvas:line/polyline/polygon/rect/circle/text 均可选 id/hitTest；hitTest=true 时必须给 id，且当前只允许 target:{type:'current-main-series'} 的 Canvas 做命中。命中后同样进入 onPointer。指标图元是计算产物：可点/悬停但不可拖；需要用户可拖对象时使用 Drawing。
- context.layers.createPanel({key,paneKey,position}).set({title?,columns,rows})；position:top-left/top-right/middle-left/middle-right/bottom-left/bottom-right。
- Panel columns:[{key,title,align?}]；rows:[{cells:[{text,color?}]}]，行列数相同，text 必须字符串；align:left/center/right；不用 HTML/CSS。
- 当前颜色用 #RGB/#RGBA/#RRGGBB/#RRGGBBAA。几何填充需 fillColor 或 borderColor；dash:solid/dashed/dotted。资源保护：canvas layer≤${USER_INDICATOR_RUNTIME_LIMITS.canvasLayers}、panel≤${USER_INDICATOR_RUNTIME_LIMITS.panels}、marker≤${USER_INDICATOR_RUNTIME_LIMITS.markersPerCallback}/回调、canvas command≤${USER_INDICATOR_RUNTIME_LIMITS.canvasCommandsPerCallback}/回调、panel rows≤${USER_INDICATOR_RUNTIME_LIMITS.panelRows}、正文 table cells≤${USER_INDICATOR_RUNTIME_LIMITS.panelCells}；update VM 预算按相位为 initial≈${USER_INDICATOR_RUNTIME_LIMITS.initialUpdateVmMs}ms、history≈${USER_INDICATOR_RUNTIME_LIMITS.historyUpdateVmMs}ms、realtime≈${USER_INDICATOR_RUNTIME_LIMITS.realtimeUpdateVmMs}ms、reconciliation≈${USER_INDICATOR_RUNTIME_LIMITS.reconciliationUpdateVmMs}ms；onPointer VM≈${USER_INDICATOR_RUNTIME_LIMITS.pointerVmMs}ms。资源/输出有界不代表指标只能做几个固定用途。`;

export const USER_INDICATOR_MINIMAL_TEMPLATE = `defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.example',
  indicatorVersion: 1,
  name: { 'zh-CN': '示例指标', 'en-US': 'Example Indicator' },
  inputs: {},
  supports: { seriesKinds: ['ohlcv'] },
  create(context) {
    const line = context.layers.createSeries({
      key: 'value',
      type: 'line',
      pane: 'main',
      options: { color: '#2962ff', lineWidth: 1 },
    });
    return {
      update(event) {
        const values = event.bars.map((bar) => bar.close);
        line.setValues(values, { dirtyFrom: event.changedFrom });
      },
    };
  },
});`;

export type UserIndicatorAiDiagnosticInput = Readonly<{
  indicatorId?: string;
  indicatorVersion?: number;
  phase: string;
  code: string;
  failureDetail?: string;
  logs?: readonly Readonly<{ phase: string; message: string }>[];
  line?: number;
  column?: number;
}>;

function safeText(value: string, max = 512): string {
  return value
    .replace(/file:\/\/[^\s)]+/gi, '[path]')
    .replace(/\/(?:Users|home|private|var|tmp)\/[^\s:)]+/g, '[path]')
    .replace(/[A-Za-z]:\\[^\s:)]+/g, '[path]')
    .slice(0, max);
}

export function safeUserIndicatorFailureDetail(value: string): string {
  return safeText(value, USER_INDICATOR_RUNTIME_LIMITS.textFieldChars);
}

export function buildUserIndicatorAiPrompt(requirement: string): string {
  return `${USER_INDICATOR_AI_SYSTEM_PROMPT}\n\n${USER_INDICATOR_AI_API_SUMMARY}\n\n完整最小文件（按用户需求修改）：\n${USER_INDICATOR_MINIMAL_TEMPLATE}\n\n用户需求：\n${requirement.trim()}`;
}

export function formatUserIndicatorAiDiagnostic(input: UserIndicatorAiDiagnosticInput): string {
  const lines = [
    '请修复一个 TradeFlow Lite User Indicator Runtime v1 的 .tfi 指标。',
    `User API version: ${USER_INDICATOR_API_VERSION}`,
    `Indicator: ${safeText(input.indicatorId ?? 'unknown', 128)}${input.indicatorVersion ? ` v${input.indicatorVersion}` : ''}`,
    `Phase: ${safeText(input.phase, 64)}`,
    `Error code: ${safeText(input.code, 128)}`,
  ];
  if (input.failureDetail) lines.push(`Failure detail: ${safeUserIndicatorFailureDetail(input.failureDetail)}`);
  if (input.logs?.length) {
    lines.push('Failure callback logs:');
    for (const item of input.logs.slice(0, USER_INDICATOR_RUNTIME_LIMITS.consoleEntriesPerCallback)) {
      lines.push(`- [${safeText(item.phase, 32)}] ${safeText(item.message, USER_INDICATOR_RUNTIME_LIMITS.textFieldChars)}`);
    }
  }
  if (input.line !== undefined) lines.push(`Source line: ${input.line}${input.column === undefined ? '' : `, column: ${input.column}`}`);
  lines.push(
    'Runtime limits:',
    `- source: ${USER_INDICATOR_RUNTIME_LIMITS.sourceBytes} bytes`,
    `- QuickJS heap: ${USER_INDICATOR_RUNTIME_LIMITS.quickJsHeapBytes} bytes`,
    `- QuickJS stack: ${USER_INDICATOR_RUNTIME_LIMITS.quickJsStackBytes} bytes`,
    `- initial VM deadline: ${USER_INDICATOR_RUNTIME_LIMITS.initialUpdateVmMs} ms`,
    `- history VM deadline: ${USER_INDICATOR_RUNTIME_LIMITS.historyUpdateVmMs} ms`,
    `- realtime VM deadline: ${USER_INDICATOR_RUNTIME_LIMITS.realtimeUpdateVmMs} ms`,
    `- reconciliation VM deadline: ${USER_INDICATOR_RUNTIME_LIMITS.reconciliationUpdateVmMs} ms`,
    `- callback commands: ${USER_INDICATOR_RUNTIME_LIMITS.outboxCommandsPerCallback}`,
    `- realtime output: ${USER_INDICATOR_RUNTIME_LIMITS.realtimeOutputBytes} bytes`,
    `- bulk output: ${USER_INDICATOR_RUNTIME_LIMITS.bulkOutputBytes} bytes`,
    '',
    USER_INDICATOR_AI_API_SUMMARY,
    '',
    '不要改变指标意图；不要使用未开放能力。最终只输出完整修复后的 .tfi 源码。',
  );
  return lines.join('\n');
}
