# 授权开发 AI 的源码扩展入口

[English](../en/extensions.md) · [AI 使用说明](../../AGENTS.zh-CN.md)

只有用户明确授权修改自己的源码副本时，才使用本页。普通用户优先使用 [.tfi 指标](indicators.md)或 [.tfc/.tft 研究](data-and-tasks.md)。应用业务 MCP 不能编辑本仓库；源码扩展需要重新构建，本地文件改变不会更新已安装应用。

## 找到对应合同

| 需求 | 现有入口 |
| --- | --- |
| 不可信用户指标 | [运行时](../../src/user-indicator-runtime/)与[示例](../../fixtures/user-indicators/) |
| 编译期可信指标 | [Indicator SDK](../../src/indicator-sdk/contracts.ts)、[用户插件](../../src/indicator-plugins/user/)、[贡献插件](../../src/indicator-plugins/contributed/) |
| 用户本地数据 | [Connector 运行时](../../src/user-data/)及 [src-tauri/src](../../src-tauri/src/) 下的原生实现 |
| 用户计算与结果 | [Task 运行时](../../src/user-task/) |
| 共用 AI 能力 | [contracts](../../src/ai-capabilities/contracts.ts)、[registry](../../src/ai-capabilities/registry.ts)、[core](../../src/ai-capabilities/core.ts) |
| 行情源 | [前端 provider](../../src/providers/)、[原生 provider](../../src-tauri/src/market_providers/)、[market data](../../src-tauri/src/market_data/) |
| TDX 协议 | [独立的 `tradeflow-tdx` Rust crate](https://github.com/hongchanho93/tradeflow-tdx) |

扩展前检查实现及调用方。数据源转换与图表、历史生命周期逻辑分离，保持稳定品种/K 线身份、明确单位与权威、有界订阅和取消。不要为每家模型重复实现业务逻辑。

## 一个共用能力例子

下面是**编译期可信宿主模块**，不是可导入 `.tfi`，也不是任意代码加载器。import 路径按本页所在目录给出，放入实际源码模块时需按位置调整。它演示注册本地计算、更新实现与释放资源；中英两个例子都由文档回归通过真实 Registry 执行。

```ts
import { CapabilityError, type ToolDefinition } from '../../src/ai-capabilities/contracts.ts';
import type { CapabilityOwner } from '../../src/ai-capabilities/registry.ts';

export function mountScaleTool(owner: CapabilityOwner) {
  let version = 1;
  const definition = (factor: number): ToolDefinition => ({
    id: `user.${owner.id}.scale`, version, title: '数字缩放',
    description: `将输入数字乘以 ${factor}，只做本地计算。`,
    effect: 'read', scope: 'app',
    inputSchema: {
      type: 'object', properties: { value: { type: 'number' } },
      required: ['value'], additionalProperties: false,
    },
    outputSchema: {
      type: 'object', properties: { value: { type: 'number' } },
      required: ['value'], additionalProperties: false,
    },
    run(input, execution) {
      execution.checkpoint();
      const value = (input as { value: number }).value * factor;
      if (!Number.isFinite(value)) throw new CapabilityError('numeric_overflow');
      return { value };
    },
  });
  owner.register(definition(2));
  return {
    async updateFactor(factor: number) {
      if (!Number.isFinite(factor)) throw new CapabilityError('invalid_request');
      version++;
      await owner.update(definition(factor));
    },
    async close() { await owner.dispose(); },
  };
}
```

通过应用能力注册入口取得 owner，保存模块句柄，移除时等待 close()。直接使用 Registry 时，可用 `registry.createOwner('example')` 创建 owner。本例不接触文件、行情或凭证；包装不可信代码时，必须调用隔离运行时，不能在主页面执行未知代码。

## 注册与写入

Tool definition 必需 `id/version/description/effect/inputSchema/outputSchema/run`，应提供易读 title。scope 当前为 app/chart，effect 为 read/propose/write，不把修改状态的操作冒充只读。

写操作复用 prepare 或 prepareAsync 事务，两者互斥，保留提交、失败补偿和租约清理。source/ownerId/registrationRevision/wireName 由 Registry 生成，传入字段不能冒充内置工具。业务 version 与 protocolVersion 不同。

Owner 提供 register/update/unregister/describe/dispose。更新产生新注册身份，取消旧实现的工作；等待 update/unregister/dispose，直到 handler 和补偿真正结束。仍在原生 IO 中的取消请求不等于已释放容量。使用 signal/checkpoint，会话身份共享结果，注册生命周期管理实现资源。

内置助手在模型请求前刷新工具，外部 MCP 接收目录变更通知。动态名称和版本来自发现接口，不需要逐模型添加硬编码业务分支。

## 验证源码改动

先读 [AGENTS.zh-CN.md](../../AGENTS.zh-CN.md)，检查 Git 状态，保护无关改动。为生命周期、取消、坏输入和相关旧能力补针对性回归。任一语言文档修改运行文档测试；TypeScript 修改运行相关合同与前端构建，Rust 修改运行 Cargo 测试。真实网络、桌面验证与确定性测试分别说明。

不要在修通用合同的过程中，顺带新增官方托管数据库、市场审核条件或无关数据源。用户扩展仅保留必要安全和资源边界。再分发衍生构建前，核对许可证与第三方来源。
