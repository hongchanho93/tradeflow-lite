# 可选的用户自有 Polymarket 网关

[English](README.md) · [首页](../README.zh-CN.md)

这个独立 Node.js 网关只转发白名单内的 Polymarket 公开行情，没有账户、钱包、充值、下单或任意 URL 代理能力。未明确配置网关时，Lite 直接访问官方上游，不承诺维护者提供公共网关服务。

使用的基础设施及用途必须符合上游规则与适用地区要求。网关不会让受限上游自动可用，也不会取消这些要求。

## 本地运行

使用 Node.js 22 或更新版本，服务本身不需要额外 npm 依赖。

```sh
HOST=127.0.0.1 PORT=8787 node server/polymarket-gateway.mjs
curl http://127.0.0.1:8787/healthz
```

例子适用于 POSIX Shell。健康响应只证明进程正在运行，目录和历史真实可达性需另行检查。远程部署时自行配置 HTTPS、访问控制、限流和进程管理；仓库提供 [Dockerfile](Dockerfile.polymarket-gateway)。

## 让源码版 Lite 使用它

```sh
TRADEFLOW_POLYMARKET_GATEWAY_URL=http://127.0.0.1:8787 npm run tauri dev
```

配置在进程启动时读取，不编译进前端。已配置网关失败时，不会悄悄切回另一条直连路径；删除配置恢复默认直连。已安装原生应用的环境设置取决于系统和启动方式。

可选 [Worker 实现](worker/)使用同样的公开只读方式。部署前按自己的基础设施检查并替换账户、域名和位置设置，仓库部署示例不代表可使用一个由维护者持续提供的服务。

GET 路由为 `/healthz` 与 `/v1/polymarket/{gamma/markets,gamma/markets-keyset,clob/prices-history,clob/midpoint,clob/book,clob/last-trade-price}`。测试命令为 `npm run test:polymarket-gateway`、`npm run test:polymarket-gateway-e2e`、`npm run test:polymarket-worker`；模拟上游测试不认证真实网络访问。
