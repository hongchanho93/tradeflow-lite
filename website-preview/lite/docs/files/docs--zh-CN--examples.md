# 可核对的研究示例

[English](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/en/examples.md) · [首页](https://github.com/hongchanho93/tradeflow-lite/blob/main/README.zh-CN.md)

这些是小型**合成**示例，不是真实历史或投资策略。它们演示连接器、任务与结果处理，不修改应用源码。文件在 [examples/user-research](https://github.com/hongchanho93/tradeflow-lite/blob/main/examples/user-research/README.zh-CN.md)。

## 接入 CSV 样本

打开 **AI → 设置 → 我的数据 → 添加我的数据**，只选择 [examples/user-research/data](https://github.com/hongchanho93/tradeflow-lite/blob/main/examples/user-research/data) 子目录，不选整个仓库。通过数据卡片**更多 → 导入接入文件**导入 [csv-daily.tfc](https://github.com/hongchanho93/tradeflow-lite/blob/main/examples/user-research/csv-daily.tfc)，检查后安装。这个原生连接器导入步骤不需要模型。

使用对话任务流程时，把 [window-breakout.tft](https://github.com/hongchanho93/tradeflow-lite/blob/main/examples/user-research/window-breakout.tft) 的完整文本提供给助手，让它读取 `tf_task_guide`、验证源码，通过 `tf_data_list` 找到所选来源，再按该源目录运行，回看根数设为 **3**。不要假定业务 MCP 可以直接读取任意仓库文件。通过 `tf_task_wait` 等待，再检查状态和 `tf_task_page` 的相关分页。

两份 CSV 各五根，任务请求 120 根，因此两个品种都属于**短窗口**，但足够计算当前条件。只有 `SZ:000001` 符合：末行收盘 13 高于前三行最高收盘 9；`SH:600000` 末行 10 不高于比较区间最高值 12。

数据时间为 2024 年 1 月 1–5 日 UTC 零点（`1704067200` 至 `1704412800`），不是交易日历或真实价格。品种格式的文件名仅演示身份与路由。打开对应内置行情源图表，不会把合成 CSV 放到主图上。

## 核对教学回测

以相同方式提供 [sma-backtest.tft](https://github.com/hongchanho93/tradeflow-lite/blob/main/examples/user-research/sma-backtest.tft)。核对下表时，把**费用基点和滑点基点都设为零**，其余保持默认；正常默认值分别为 10、5。例子按前一根收盘判断，在**下一根开盘**执行。

| 零成本核对 | SH:600000 | SZ:000001 |
| --- | --- | --- |
| 各自独立初始资金 | 1000 | 1000 |
| 成交 | 第四行开盘 20 买入 50 份，第五行开盘 10 卖出 | 没有成交，末行信号之后没有下一根 |
| 期末估值 | 500 | 1000 |
| 窗口收益 | -50% | 0% |
| 最大收盘回撤 | 55% | 0% |

使用分数数量和各自独立的全仓/空仓账户，不是共享资金组合。不模拟整手、T+1、涨跌停、停牌、成交量约束或公司行动。期末持仓按末行收盘估值，不强制平仓，不能称为真实成交模拟器。

## SQLite 与 Parquet 示例

[sqlite-daily.tfc](https://github.com/hongchanho93/tradeflow-lite/blob/main/examples/user-research/sqlite-daily.tfc)、[parquet-daily.tfc](https://github.com/hongchanho93/tradeflow-lite/blob/main/examples/user-research/parquet-daily.tfc) 复用同一只读授权与任务机制。SQLite 要求稳定非 WAL 快照，Parquet 仅支持已处理的类型和编码，详见[本地数据与任务](https://github.com/hongchanho93/tradeflow-lite/blob/main/docs/zh-CN/data-and-tasks.md)。

具备源码环境时，`npm run examples:format-data` 会在新的 `src-tauri/target/format-examples-*` 目录生成合成 SQLite 和 Snappy/Zstd Parquet，不覆盖已有文件。每个品种五行，从 1700000000 开始，每天一行，收盘 10/11/12/13/14、成交量 100。这与 CSV 价格不同，不能套用 CSV 回测预期。Parquet 的纳秒时间含 123 ns 余数，由示例连接器明确转换为 K 线秒精度。用户真实数据不需要运行生成器。

## 保存与复用

结束会话前，让助手导出重要表格或报告。成功运行后，“**保存为工具**”通过 `tf_task_save` 保留定义，重启恢复但不自动运行，也不保留内存结果。通过 `tf_task_library` 发现保存后的实际工具名称。

CSV 连接器按最早到最新分页，任务使用返回窗口，不保证最近数据或完整历史。核对范围、短窗口数量和收盘状态；跑通示例不等于完成全市场扫描。`npm run test:extension-examples` 检查随仓库交付的例子，不验证任意用户策略。
