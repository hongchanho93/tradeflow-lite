# Polymarket 只读数据网关

这个独立 Node.js 服务让 TradeFlow Lite 通过自有域名读取 Polymarket 公开数据。它只转发代码中列出的 Gamma 市场目录及 CLOB 概率历史、中间价、盘口和最新成交，不提供任意 URL 代理，也不包含账户、钱包、充值或下单能力。

## 运行位置

网关必须部署在能够合法访问 Polymarket API 的网络区域；同时，网关自己的 HTTPS 域名需要能被目标用户访问。当前 Polymarket 官方说明其主要服务器位于 `eu-west-2`，最近的非限制区域为 `eu-west-1`。部署前仍需按照 Polymarket 最新地区规则及服务所在地法律核对使用边界。

## 本地启动

要求 Node.js 22 或更新版本，无需安装额外 npm 依赖。

```sh
HOST=127.0.0.1 PORT=8787 node server/polymarket-gateway.mjs
curl http://127.0.0.1:8787/healthz
```

健康检查只证明进程正常。实际可用验收还必须请求市场目录和概率历史；在 Polymarket 被限制的网络中，本地启动的网关仍然无法访问上游。

## Docker

```sh
docker build -f server/Dockerfile.polymarket-gateway -t tradeflow-polymarket-gateway .
docker run --rm -p 8787:8787 tradeflow-polymarket-gateway
```

正式环境应在服务前配置 HTTPS、访问日志、请求速率限制和进程重启策略。网关自身只监听 HTTP，由部署环境的反向代理或负载均衡器终止 TLS。

## Cloudflare Worker 测试部署

仓库同时提供 `server/worker/` 下的 Worker 版本。它与 Node 网关使用相同的只读路由和参数白名单，并通过 Smart Placement 把 Polymarket 上游请求放到 `aws:eu-west-1` 邻近区域执行。

```sh
cd server/worker
npx wrangler deploy
```

当前测试实例为 `https://poly-api.pan911.cn`。健康检查：

```sh
curl https://poly-api.pan911.cn/healthz
```

该实例使用 Cloudflare 免费 Workers 配额，只适合连通性和小规模产品验证。它不是 Cloudflare 中国网络，也不能保证每个中国大陆网络节点都成功；达到免费请求上限后服务会受限。

## 配置 Lite

开发时可以用运行时环境变量：

```sh
TRADEFLOW_POLYMARKET_GATEWAY_URL=http://127.0.0.1:8787 npm run tauri dev
```

正式构建时把 HTTPS 网关地址写入编译环境：

```sh
TRADEFLOW_POLYMARKET_GATEWAY_URL=https://你的只读数据域名 npm run tauri build
```

配置网关后，Lite 不会在网关故障时偷偷回退到 Polymarket 直连。这样可以避免不同用户得到不一致路由，并让故障明确显示为行情不可用。未配置时仍保持原来的 Polymarket 官方 API 直连行为。

## 接口与缓存

- `GET /healthz`
- `GET /v1/polymarket/gamma/markets`
- `GET /v1/polymarket/clob/prices-history`
- `GET /v1/polymarket/clob/midpoint`
- `GET /v1/polymarket/clob/book`
- `GET /v1/polymarket/clob/last-trade-price`

目录成功响应缓存 30 秒，概率历史缓存 60 秒，实时轮询接口缓存 1 秒，缓存最多保留 512 项。只有成功且为 JSON 的响应会进入缓存；上游超时、非 JSON 或网络失败返回 `502 upstream_unavailable`。日志包含路由、HTTP 状态、是否命中缓存和耗时，不记录任意请求正文或凭据。

## 验证

```sh
npm run test:polymarket-gateway
npm run test:polymarket-gateway-e2e
npm run test:polymarket-worker
```

第一项验证 Node 网关的路由白名单、输入限制和缓存；第二项验证包含“时间窗口被上游拒绝后改取市场完整生命周期”的 `Lite Rust 适配器 → 网关 → 模拟 Polymarket` 链路；第三项验证 Worker 的路由、缓存、上游状态和任意代理隔离合同。
