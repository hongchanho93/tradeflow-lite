# 编译期可信指标

[English](README.md)

本目录用于用户明确授权的源码贡献，随应用编译。普通用户应导入隔离的 [.tfi 指标](../../../docs/zh-CN/indicators.md)，不需要提交到这里或取得维护者批准。

源码插件使用 `*.indicator.ts` 和现有 [Indicator SDK](../../indicator-sdk/contracts.ts)，不把指标专用逻辑放进数据源或主入口。使用运行时托管资源，自行新增的资源须清理；不导入全局样式，不使用顶层 await。私有源码插件可放在同级 user 目录。

可信进程内路径不能执行任意导入代码。修改时遵守[源码扩展](../../../docs/zh-CN/extensions.md)，运行相关 SDK、runtime、plugin、UI 测试。本目录不代表指标市场、审核服务或必然接受提交。
