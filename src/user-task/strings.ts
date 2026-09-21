import { TASK_TRANSLATIONS } from './translations.ts';
import { TaskError } from './contracts.ts';
export function taskText(text: string): string {
  return document.documentElement.lang === 'en-US' ? TASK_TRANSLATIONS[text] ?? text : text;
}
export const TASK_STATES: Readonly<Record<string, string>> = Object.freeze({ prepared:'等待启动',queued:'等待启动',running:'运行中',
  cancelling:'正在停止，等待读取结束',completed:'已完成',cancelled:'已停止，结果可能不完整',failed:'未完成，保留已有结果' });
const ERRORS: Readonly<Record<string, string>> = Object.freeze({
  task_file_type:'请选择 UTF-8 编码的 .tft 任务文件。',task_source_limit:'任务代码超过当前预算。请不要把整份行情数据写进源码。',
  task_invalid_manifest:'任务声明不完整或不受支持。请让 AI 按任务编写说明修正。',task_invalid_contract:'任务文件或参数格式不正确。',
  task_runtime_error:'任务代码执行失败，已保留此前有效结果。可让 AI 检查任务代码和数据格式。',
  task_execution_timeout:'单次计算超过安全时限。请检查死循环，或把计算分解到每个品种。',task_memory_limit:'任务超过隔离内存预算。请减少运行中保留的数据。',
  task_async_unsupported:'任务回调应同步返回结果；读取数据由应用负责，不要在任务中使用 async 或 Promise。',
  task_invalid_output:'任务输出不符合结果格式，未写入这一批数据。请让 AI 检查列类型和时间顺序。',
  task_invalid_parameters:'参数与任务要求不符，请检查必填项、数值范围和格式。',task_invalid_source:'所选数据源或市场范围不可用。',
  task_source_unavailable:'数据源未启用或尚未接入，请先检查“我的数据”或行情源。',task_history_unsupported:'数据源不支持任务要求的周期或复权方式。',
  task_source_changed:'数据连接已经停用、移除或替换。旧任务已停止，未改用其他数据。',task_definition_changed:'已保存的任务被更新或删除，旧版本已停止。',
  task_data_failed:'读取该品种的数据失败。请检查数据连接与实际可用历史。',task_data_timeout:'读取超时，正在停止相关读取。已有结果不会冒充完整结果。',
  task_wall_timeout:'任务已达到本次运行时限，保留已有结果。请拆分处理范围。',task_invalid_symbol:'结果中的品种标识不完整，或不属于所选数据源。',
  task_capacity:'同时运行的任务或保留结果已满。请停止任务或移除不需要的结果后再试。',task_universe_limit:'品种范围为空或超过当前批处理预算。请检查自选和数据源。',
  task_duplicate_symbol:'数据源目录重复返回了同一品种，任务已停止，避免重复计算。',task_cursor_stalled:'数据源分页没有前进，任务已停止。',
  task_result_limit:'结果超过当前存储预算。已有结果保留，请减少逐行输出或分批运行。',
  task_cancelled:'操作已停止。',task_unavailable:'结果已释放或不属于该会话。',task_not_completed:'该任务尚未成功结束，不能把它当作完整模板保存。',
  task_conflict:'已保存任务被其他操作更新，请重新读取后再保存或删除。',task_library_limit:'任务库达到当前存储预算。请删除不用的任务工具。',
  task_library_unavailable:'这份任务暂不可用，请刷新任务库或检查保存记录。',task_storage_failed:'任务保存失败，请检查本机存储状态。',
  task_storage_corrupt:'保存记录校验失败，未运行或覆盖原记录。',task_share_unavailable:'分享凭证已使用或过期，请重新点击“交给 AI 分析”。',
  task_share_limit:'未使用的结果分享过多，请处理现有消息后再试。',task_chart_unavailable:'该品种没有明确的对应行情源，请查看单行结果或导出。',
  data_composer_full:'对话输入区已满，请先处理未发送的消息。',rollback_failed:'操作失败且恢复未完整完成，请检查当前状态，不要当作已撤销。',
  state_conflict:'相关内容已改变，操作未继续。请刷新后重试。',field_unavailable:'所选行情源不支持这个品种、周期或操作。',
  session_capacity:'自选容量不足，未添加本批内容。请减少本页数量或整理已有自选。',
});
export function taskUserError(error: unknown): string {
  const code = error instanceof TaskError ? error.code : error instanceof Error ? (error as Error & { code?: string }).code ?? error.message : 'task_failed';
  const known = Object.hasOwn(ERRORS, code);
  if (document.documentElement.lang === 'en-US') return known ? `Operation did not complete (${code}). Check the task, data source or available storage before retrying.` : 'The operation did not complete. Check the task and data source.';
  return known ? ERRORS[code] : '操作未完成，请检查任务和数据连接后重试。';
}
