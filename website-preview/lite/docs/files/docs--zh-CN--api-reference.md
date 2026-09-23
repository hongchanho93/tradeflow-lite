# AI 工具参考

[English](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/en/api-reference.md) · [首页](https://github.com/hongchanho93/tradeflow-lite/blob/main/README.zh-CN.md) · [连接指南](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/ai-guide.md)

本文用于定位能力，不替代运行时参数结构。默认 Registry 中有 **74 项业务工具**，外部 MCP 另提供 `tf_context_get`。已安装连接器和保存的任务会增加动态工具。文档测试会把清单与实际注册代码核对。

## 先发现，再调用

MCP 客户端初始化后读取 `tools/list`，按返回名称和输入结构调用。内部点分隔 ID 与外部名称不能随意混用。收到 `notifications/tools/list_changed` 后刷新；较长动态名称可能使用别名，完整 ID 和注册版本由元数据提供。

陌生工作流先读 `tf_ai_help`，再读格式专用指南，不沿用其他版本的参数记忆。原样保留宿主返回的不透明句柄、游标、对象版本和 expected 选择。`inputsJson`、`parametersJson`、`rowsJson` 等字段可能是序列化 JSON 字符串，按实际 schema 使用，不猜成对象。

## 默认工具清单

| 范围 | 工具 |
| --- | --- |
| 帮助与上下文 | `tf_ai_help`, `tf_context_get` |
| 图表快照 | `tf_chart_snapshot`, `tf_dataset_page`, `tf_dataset_release` |
| 计算 | `tf_compute_summary`, `tf_compute_sma` |
| 数据源发现 | `tf_market_providers`, `tf_market_provider`, `tf_market_search`, `tf_market_catalog` |
| 独立行情 | `tf_market_history`, `tf_market_page`, `tf_market_release`, `tf_market_quote`, `tf_market_quotes` |
| 自选 | `tf_watchlist_list`, `tf_watchlist_add`, `tf_watchlist_remove`, `tf_watchlist_move`, `tf_watchlist_quotes` |
| 图表选择 | `tf_chart_current`, `tf_chart_open`, `tf_chart_resolution`, `tf_chart_adjustment`, `tf_chart_visible_range`, `tf_chart_data_window` |
| 指标状态与参数 | `tf_indicator_definitions`, `tf_indicator_instances`, `tf_indicator_add`, `tf_indicator_remove`, `tf_indicator_inputs_get`, `tf_indicator_inputs_set`, `tf_indicator_visibility`, `tf_indicator_retry` |
| 用户指标库 | `tf_indicator_library`, `tf_indicator_guide`, `tf_indicator_source`, `tf_indicator_validate`, `tf_indicator_draft_release`, `tf_indicator_test`, `tf_indicator_install`, `tf_indicator_library_remove` |
| 绘图事务 | `tf_drawings_types`, `tf_drawings_list`, `tf_drawings_propose`, `tf_drawings_apply`, `tf_drawings_apply_existing`, `tf_drawings_revert`, `tf_drawings_remove_owned`, `tf_drawings_history`, `tf_drawings_revert_saved` |
| 本地连接器 | `tf_data_guide`, `tf_data_list`, `tf_data_files`, `tf_data_sample`, `tf_data_source`, `tf_data_validate`, `tf_data_install`, `tf_data_manage` |
| 运行任务 | `tf_task_guide`, `tf_task_validate`, `tf_task_start`, `tf_task_list`, `tf_task_status`, `tf_task_wait`, `tf_task_page`, `tf_task_cancel`, `tf_task_release`, `tf_task_claim` |
| 保存的任务 | `tf_task_library`, `tf_task_source`, `tf_task_save`, `tf_task_remove` |
| 文件输出 | `tf_result_save_file` |

## 数据与生命周期

用户询问当前图表时才捕获图表快照。独立查询使用带数据源身份的品种及支持的周期、复权调用 `tf_market_history`，返回不可变 datasetId，而不是全部行。读取 `tf_market_page`，按需本地计算，用完释放。图表快照使用 snapshotId；统计和 SMA 必须在两类引用中二选一。

解释结果必须考虑实际时间、`coverage/finality/shortfall/priceUnit/volumeUnit`。捕获时间不保证交易所行情新鲜度；概率点不能被补造成 OHLC 或成交量。目录字段 `ready/catalogLoaded/catalogComplete` 区分服务可用与目录完整。

工具和结果归属会话。正常配对可以跨重启复用，但临时图表、行情数据集、draft 和任务不能因此跨会话共享。重连后重新读取状态。再次释放已消费的独立行情句柄会返回 snapshot_unavailable，不会删除保存的用户内容。

## 图表与绘图写入

主动导航前读取当前选择，原样传入 expected。旧请求不能修改新选择的图表；旧上下文返回 context_stale，重新读取并判断，而不是悄悄改目标。

先通过 `tf_drawings_types` 发现结构，坐标使用时间/价格，不是像素。当前原生类型为：

`HorizontalLine`, `TrendLine`, `Rectangle`, `Text`, `Ray`, `Arrow`, `ExtendedLine`, `HorizontalRay`, `VerticalLine`, `CrossLine`, `Callout`, `Circle`, `Triangle`, `PriceRange`, `ParallelChannel`, `FibRetracement`, `Brush`, `Highlighter`, `Path`, `LongShortPosition`, `UpArrow`。

读取对象 ID、版本，准备冻结方案，再提交。`tf_drawings_apply` 仅处理新对象或未被改动的本会话对象。`tf_drawings_apply_existing` 在配对后可修改用户/旧会话对象，不再逐次弹第二个批准框，但仍须遵守用户明确要求及上下文、版本检查。撤销使用对应会话或保存回执，拒绝覆盖后续编辑；保存的历史不是自动恢复的授权。

旧 changeSet 不可用时，`tf_drawings_remove_owned` 可按 ID 清理由本会话仍然拥有的对象，拒绝无关对象和创建后被编辑的对象。不能用大范围删除来模拟撤销。

## 生成扩展

指标流程：源码/指南 → 验证 → 测试 → 安装 → 核对。`tf_indicator_test` 返回 Series、Marker、BarStyle、Canvas、Panel 和 allOutputsEmpty，不只统计线条。核对 sourceHash、stage、coveredReasons、交互覆盖，并用 context.log 提供有界诊断。preflight-synthetic 样本不代表真实行情。setData 12000 点上限不能覆盖回调耗时限制。MTF 使用 context.data.get，不切换图表。更新使用 applyToExisting=true，根据 disposition 区分新建、替换和未变化，并释放不用的 draft。

连接器流程：已授权来源 → 样本 → 指南/源码 → 验证 → 安装 → 使用实际发现的查询工具。用户必须在原生窗口选择目录；tf_data_files 和 tf_data_sample 不能产生授权。实际查询结果和源码可能发送给所选模型。连接器查询与内置 Provider 图表历史相互独立。

任务流程：指南/源码 → 验证 → 小范围运行 → 本地等待 → 状态/分页 → 明确保存或复用。pageUnit 通常为行，报告为字符；检查 complete/nextOffset 和部分结果标记。tf_task_claim 消费用户明确分享结果时产生的一次性 token，不授予通用任务所有权或目录权限。保存的任务定义重启恢复，但不自动执行。

## 错误与成功回执

有结构化信息时使用 path/reason/expected、field、stage、errorCode、清洗后的 failureDetail。验证成功不证明代码执行、数据完整或安装成功。结果不确定时不要盲目重试写入，先重新核对状态与版本。

tf_result_save_file 在桌面、文档、下载创建新的 Markdown/TXT/CSV/JSON。完整任务结果使用 task-artifact 输入，不必在提示词中复制每行。该工具不能覆盖、读取、删除或执行任意文件，只有成功回执才能支持“已保存”的结论。

源码合同：[公共工具](https://github.com/hongchanho93/tradeflow-lite/blob/main/src/ai-capabilities/contracts.ts)、[指标指南](https://github.com/hongchanho93/tradeflow-lite/blob/main/src/user-indicator-runtime/ai-guide.ts)、[连接器指南](https://github.com/hongchanho93/tradeflow-lite/blob/main/src/user-data/guide.ts)、[任务指南](https://github.com/hongchanho93/tradeflow-lite/blob/main/src/user-task/guide.ts)。用户另行授权的源码开发见[源码扩展](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/extensions.md)。
