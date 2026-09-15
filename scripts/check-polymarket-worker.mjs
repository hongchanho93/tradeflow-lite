import assert from 'node:assert/strict';

import { handleRequest } from '../server/worker/polymarket-gateway-worker.mjs';

const entries = new Map();
const cache = {
  async match(request) {
    const response = entries.get(request.url);
    return response?.clone() || null;
  },
  async put(request, response) {
    entries.set(request.url, response.clone());
  },
};
const pending = [];
const ctx = { waitUntil(promise) { pending.push(promise); } };
let upstreamRequests = 0;
const fetchImpl = async (target) => {
  upstreamRequests += 1;
  const url = new URL(target);
  if (url.searchParams.get('token_id') === '451') {
    return new Response('restricted', { status: 451, headers: { 'content-type': 'text/html', 'cf-ray': 'test-ICN' } });
  }
  return new Response(JSON.stringify({ path: `${url.pathname}${url.search}` }), {
    headers: { 'content-type': 'application/json', 'cf-ray': 'test-LHR' },
  });
};
const call = (path, init) => handleRequest(
  new Request(`https://poly-api.pan911.cn${path}`, init),
  {},
  ctx,
  { fetchImpl, cache },
);

const health = await call('/healthz');
assert.equal(health.status, 200);
assert.equal((await health.json()).service, 'tradeflow-polymarket-worker');

const catalogPath = '/v1/polymarket/gamma/markets?active=true&closed=false&limit=100&order=volume24hr&ascending=false';
const first = await call(catalogPath);
assert.equal(first.status, 200);
assert.equal(first.headers.get('x-tradeflow-cache'), 'MISS');
assert.match((await first.json()).path, /^\/markets\?/);
await Promise.all(pending.splice(0));
const second = await call(catalogPath);
assert.equal(second.status, 200);
assert.equal(second.headers.get('x-tradeflow-cache'), 'HIT');
assert.equal(upstreamRequests, 1);

const invalid = await call('/v1/polymarket/clob/midpoint?token_id=https%3A%2F%2Fexample.com');
assert.equal(invalid.status, 400);
assert.equal(upstreamRequests, 1);

const fullHistory = await call('/v1/polymarket/clob/prices-history?market=123&interval=max&fidelity=1440');
assert.equal(fullHistory.status, 200);
assert.match((await fullHistory.json()).path, /^\/prices-history\?/);
const mixedHistory = await call('/v1/polymarket/clob/prices-history?market=123&interval=max&startTs=1&endTs=2&fidelity=1440');
assert.equal(mixedHistory.status, 400);

const restricted = await call('/v1/polymarket/clob/midpoint?token_id=451');
assert.equal(restricted.status, 451);
assert.equal((await restricted.json()).status, 451);
assert.equal(restricted.headers.get('x-tradeflow-upstream-cf-ray'), 'test-ICN');

const arbitrary = await call('/v1/proxy?url=https%3A%2F%2Fexample.com');
assert.equal(arbitrary.status, 404);
const post = await call(catalogPath, { method: 'POST' });
assert.equal(post.status, 405);

console.log('Polymarket Cloudflare Worker contract passed');
