# 用户研究示例

[English](README.md) · [完整实操](../../docs/zh-CN/examples.md)

这里提供用于已明确选择的本地数据与窗口计算的可导入示例。输入为**合成**数据，不是真实历史，也不是官方选股器或交易系统。

| 文件 | 用途 |
| --- | --- |
| [csv-daily.tfc](csv-daily.tfc) | 读取 [data](data/) 中两份各五行的合成 CSV |
| [sqlite-daily.tfc](sqlite-daily.tfc) | 读取兼容的稳定 SQLite 快照 |
| [parquet-daily.tfc](parquet-daily.tfc) | 投影读取兼容的 Parquet 数据 |
| [window-breakout.tft](window-breakout.tft) | 比较末行收盘与此前收盘 |
| [sma-backtest.tft](sma-backtest.tft) | 前一根收盘判断、下一根开盘执行的教学例子 |

通过 **AI → 设置 → 我的数据**只选择 data 子目录，再导入连接器。任务通过完整 `.tft` 文本交给助手，按[实操](../../docs/zh-CN/examples.md)执行；业务 MCP 不能读取任意仓库文件。

两个 CSV 品种都是短窗口：请求 120 根，实际五根。回看 3 时，只有 SZ:000001 满足突破条件。费用和滑点均为零时，两个独立回测账户分别从 1000 变为 500（SH:600000）、1000（SZ:000001）。这些不是实际价格，也不是另一组 SQLite/Parquet 样本数据。

保存为工具只保留成功任务的定义，不保留内存结果；重要结果请明确导出。SQLite 要求非 WAL 快照，其他格式与历史边界见[本地数据与任务](../../docs/zh-CN/data-and-tasks.md)。

`npm run test:extension-examples` 检查这些随仓库文件；`npm run examples:format-data` 在新 target 目录生成另一组合成 SQLite/Parquet。两者都不验证任意用户策略。
