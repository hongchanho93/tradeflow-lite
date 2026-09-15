import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createPolymarketGateway } from '../server/polymarket-gateway.mjs';

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address()));
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

let upstreamRequests = 0;
const upstream = createServer((request, response) => {
  upstreamRequests += 1;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ path: request.url, upstreamRequests }));
});

const upstreamAddress = await listen(upstream);
const upstreamBase = `http://127.0.0.1:${upstreamAddress.port}`;
const gateway = createPolymarketGateway({
  gammaBase: upstreamBase,
  clobBase: upstreamBase,
  logger: { info() {}, error() {} },
  maxCacheEntries: 1,
});
const gatewayAddress = await listen(gateway);
const gatewayBase = `http://127.0.0.1:${gatewayAddress.port}`;

try {
  const health = await fetch(`${gatewayBase}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: 'tradeflow-polymarket-gateway',
  });

  const catalogUrl = `${gatewayBase}/v1/polymarket/gamma/markets?active=true&closed=false&limit=100&offset=0&order=volume24hr&ascending=false`;
  const firstCatalog = await fetch(catalogUrl);
  assert.equal(firstCatalog.status, 200);
  assert.match((await firstCatalog.json()).path, /^\/markets\?/);
  const secondCatalog = await fetch(catalogUrl);
  assert.equal(secondCatalog.status, 200);
  assert.equal(upstreamRequests, 1, 'successful identical requests should use the gateway cache');

  const keysetPage = await fetch(`${gatewayBase}/v1/polymarket/gamma/markets-keyset?closed=false&limit=100&order=volume24hr&ascending=false&after_cursor=MTAwMA%3D%3D`);
  assert.equal(keysetPage.status, 200);
  assert.match((await keysetPage.json()).path, /^\/markets\/keyset\?/);

  const history = await fetch(`${gatewayBase}/v1/polymarket/clob/prices-history?market=123456&startTs=1&endTs=2&fidelity=60`);
  assert.equal(history.status, 200);
  assert.match((await history.json()).path, /^\/prices-history\?/);

  const fullHistory = await fetch(`${gatewayBase}/v1/polymarket/clob/prices-history?market=123456&interval=max&fidelity=60`);
  assert.equal(fullHistory.status, 200);
  assert.match((await fullHistory.json()).path, /^\/prices-history\?/);

  const invalidToken = await fetch(`${gatewayBase}/v1/polymarket/clob/midpoint?token_id=https%3A%2F%2Fexample.com`);
  assert.equal(invalidToken.status, 400);
  assert.equal(upstreamRequests, 4, 'invalid parameters must not reach an upstream');

  const arbitraryProxy = await fetch(`${gatewayBase}/v1/proxy?url=https%3A%2F%2Fexample.com`);
  assert.equal(arbitraryProxy.status, 404);
  assert.equal(upstreamRequests, 4, 'the gateway must not expose an arbitrary proxy');

  const catalogAfterEviction = await fetch(catalogUrl);
  assert.equal(catalogAfterEviction.status, 200);
  assert.equal(upstreamRequests, 5, 'the bounded cache should evict its oldest entry');

  const post = await fetch(catalogUrl, { method: 'POST' });
  assert.equal(post.status, 405);

  console.log('Polymarket gateway contract passed');
} finally {
  await close(gateway);
  await close(upstream);
}
