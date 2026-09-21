import { CapabilityError } from '../ai-capabilities/contracts.ts';
import { dataError } from './contracts.ts';

export const DATA_STATUS: Readonly<Record<string, string>> = Object.freeze({
  connected: '已接入，可让 AI 查询', needs_connector: '目录已选择，等待接入', disabled: '已停用',
  needs_directory: '目录不可用，请重新选择', loading: '正在检查接入文件', updating: '正在更新', error: '接入未完成',
});
const ERRORS: Readonly<Record<string, string>> = Object.freeze({
  data_scope_too_broad: '目录范围过大，包含应用或私有配置。请只选择存放数据的子目录。',
  data_root_changed: '原目录已移动或被替换。请重新选择正确的数据目录。',
  data_file_changed: '文件在读取期间发生变化。请等待文件写入完成后重新检查。',
  data_sqlite_snapshot_required: '这份 SQLite 文件处于 WAL/日志模式或使用了路径别名。当前请使用数据提供方导出的稳定非 WAL 快照；应用不会改写数据库或忽略未合并的日志。',
  data_sqlite_readonly: '此接口只查询已选择的数据库，不执行写入、附加其他数据库或扩展加载。',
  data_sqlite_query_failed: 'SQLite 查询未完成。请让 AI 检查实际表名、字段、参数和索引；需要临时写盘的查询当前不支持。',
  data_invalid_sqlite: '文件不是可读取的 SQLite 数据库，或文件已经损坏。请核对实际格式。',
  data_invalid_parquet: 'Parquet 文件不完整、损坏或结构不兼容。请先核对文件及其导出方式。',
  data_parquet_type_unsupported: '当前 Parquet 行读取只支持扁平非重复列。嵌套结构仍需扩展解码，不能用空值代替。',
  data_parquet_int96_precision: '此 Parquet 文件使用 INT96 时间。当前尚未接入无损读取，已停止而没有舍入时间。',
  data_parquet_codec_unsupported: '当前未接入这种 Parquet 压缩编码。请让 AI 核对编码，不能当作没有数据。',
  data_parquet_column_missing: '请求的 Parquet 列不存在。请先读取实际结构后修改接入文件。',
  data_format_budget: '格式读取超过当前元数据或解压预算。请缩小列投影、分块范围，或按真实负载扩展预算。',
  data_output_limit: '样本或结果超出单次输出预算。请减少行数、字段或文本长度。',
  data_numeric_precision: '数值超出当前精确表示范围。请保留原始精度并在接入代码中明确转换，不要直接舍入。',
  data_nonfinite_value: '数据中含有非有限数值。请检查原始缺失值或计算结果，不能补成零。',
  data_path_denied: '接入文件请求了所选目录以外或不支持的路径。请让 AI 修正相对路径。',
  data_source_too_large: '接入文件过大，超过当前源码预算。请缩小接入代码，不要把行情数据嵌入源码。',
  data_source_type: '请选择 UTF-8 编码的 .tfc 接入文件。',
  data_composer_full: '对话输入区已满。请先处理未发送的消息，再交给 AI 接入。',
  data_conflict: '数据连接已改变，请重新检查接入文件后再安装。',
  state_conflict: '数据连接已改变，请重新检查接入文件后再安装。',
  data_storage_failed: '连接登记保存失败，操作未完成。请检查本机存储状态后重试。',
  data_storage_invalid: '已保存的连接登记损坏。原文件未覆盖；需要检查或恢复连接登记。',
  data_runtime_error: '接入代码运行失败。请让 AI 根据数据样本修正后重新检查。',
  data_invalid_output: '接入结果不符合行情格式。请让 AI 检查时间、价格和成交量等字段。',
  data_invalid_manifest: '接入文件声明不完整或格式错误，请让 AI 按当前接入说明修正。',
  data_unsupported_version: '接入文件版本不兼容，请让 AI 按当前接入说明重新生成。',
  data_execution_timeout: '接入检查超时。请分块读取数据或检查代码中的循环。',
  data_memory_limit: '接入检查超过内存预算。请改用分块或分页读取。',
  data_budget_exceeded: '操作超过当前资源预算。请缩小单次读取或改用分页。',
  data_io_budget: '单次读取超过资源预算。请让 AI 改用分块或分页。',
  data_cancelled: '检查已停止，未继续安装。', cancelled: '操作已停止。',
  data_busy: '这份数据正在更新。请在当前操作结束后重试。',
  data_unavailable: '这份数据暂不可用。请检查是否已停用或需要重新选择目录。',
  rollback_failed: '操作失败且未能完整恢复。请检查当前连接状态，不要当作已经撤销。',
});
export function dataUserError(error: unknown): string {
  if (error instanceof Error && Object.hasOwn(ERRORS, error.message)) return ERRORS[error.message];
  const code = error instanceof CapabilityError ? error.code : dataError(error).code;
  return ERRORS[code] ?? `操作未完成，请检查数据连接后重试（${code}）。`;
}
