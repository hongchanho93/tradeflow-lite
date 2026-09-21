# Optional user-owned Polymarket gateway

[简体中文](README.zh-CN.md) · [Home](../README.md)

This standalone Node.js gateway forwards an allowlisted subset of public Polymarket market data. It has no account, wallet, deposit or order functionality and is not an arbitrary URL proxy. Lite uses the official upstream APIs directly unless a gateway is explicitly configured. No maintainer-hosted public gateway is promised.

Use only infrastructure where your access and intended use comply with the upstream service's rules and applicable regional requirements. A gateway does not make a restricted upstream available or remove those requirements.

## Run a local instance

Use Node.js 22 or newer. No additional npm dependencies are required for this server.

```sh
HOST=127.0.0.1 PORT=8787 node server/polymarket-gateway.mjs
curl http://127.0.0.1:8787/healthz
```

These shell examples assume a POSIX shell. A health response proves only that the process is running; validate actual catalog/history access separately. For a remote deployment, provide your own HTTPS termination, access controls, rate limits and process supervision. A [Dockerfile](Dockerfile.polymarket-gateway) is included.

## Point a source-run Lite at it

```sh
TRADEFLOW_POLYMARKET_GATEWAY_URL=http://127.0.0.1:8787 npm run tauri dev
```

The setting is read at process startup, not compiled into the frontend. A configured gateway failure does not silently fall back to a different direct route. Remove the setting to return to default upstream access. Native installed-app environment setup depends on the platform and launch method.

The optional [Worker implementation](worker/) uses the same public read-only approach. Review and replace deployment-account, domain and placement configuration for your own infrastructure before deploying; checked-in deployment examples are not an entitlement to a maintained service.

Supported GET routes are `/healthz` and `/v1/polymarket/{gamma/markets,gamma/markets-keyset,clob/prices-history,clob/midpoint,clob/book,clob/last-trade-price}`. Tests: `npm run test:polymarket-gateway`, `npm run test:polymarket-gateway-e2e`, `npm run test:polymarket-worker`. Mocked upstream tests do not certify live network access.
