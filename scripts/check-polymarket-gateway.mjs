import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';

import { createPolymarketGateway } from '../server/polymarket-gateway.mjs';

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address()));
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const rawHttpRequest = (port, request) => new Promise((resolve, reject) => {
  const socket = createConnection({ host: '127.0.0.1', port }, () => socket.end(request));
  let response = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => { response += chunk; });
  socket.on('end', () => resolve(response));
  socket.on('error', reject);
});

let upstreamRequests = 0;
let releaseHeldUpstream;
let heldUpstreamStarted;
const heldUpstreamReady = new Promise((resolve) => { heldUpstreamStarted = resolve; });
const upstream = createServer((request, response) => {
  upstreamRequests += 1;
  response.setHeader('content-type', 'application/json');
  if (request.url?.includes('token_id=777')) {
    response.write('{"padding":"');
    response.write('x'.repeat(512));
    response.end('"}');
    return;
  }
  if (request.url?.includes('token_id=888')) {
    heldUpstreamStarted();
    releaseHeldUpstream = () => response.end('{"mid":"0.5"}');
    return;
  }
  response.end(JSON.stringify({ path: request.url, upstreamRequests }));
});

const upstreamAddress = await listen(upstream);
const upstreamBase = `http://127.0.0.1:${upstreamAddress.port}`;
const gateway = createPolymarketGateway({
  gammaBase: upstreamBase,
  clobBase: upstreamBase,
  logger: { info() {}, error() {} },
  maxCacheEntries: 1,
  maxResponseBytes: 256,
  maxConcurrentRequests: 1,
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

  const malformed = await rawHttpRequest(
    gatewayAddress.port,
    'GET //% HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
  );
  assert.match(malformed, /^HTTP\/1\.1 400 /, 'a malformed request target must be rejected with HTTP 400');
  const healthAfterMalformedRequest = await fetch(`${gatewayBase}/healthz`);
  assert.equal(
    healthAfterMalformedRequest.status,
    200,
    'a malformed request target must not terminate the gateway process',
  );

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

  const oversized = await fetch(`${gatewayBase}/v1/polymarket/clob/midpoint?token_id=777`);
  assert.equal(oversized.status, 502);
  assert.equal(
    (await oversized.json()).error,
    'upstream_response_too_large',
    'chunked upstream responses must be rejected while streaming once the byte limit is crossed',
  );

  const held = fetch(`${gatewayBase}/v1/polymarket/clob/midpoint?token_id=888`);
  await heldUpstreamReady;
  const busy = await fetch(`${gatewayBase}/v1/polymarket/clob/midpoint?token_id=889`);
  assert.equal(busy.status, 503, 'a distinct upstream request beyond the global concurrency cap must be rejected');
  assert.equal((await busy.json()).error, 'gateway_busy');
  releaseHeldUpstream();
  assert.equal((await held).status, 200);
  const afterCapacityReturns = await fetch(`${gatewayBase}/v1/polymarket/clob/midpoint?token_id=889`);
  assert.equal(afterCapacityReturns.status, 200, 'capacity must be released after the in-flight request completes');

  const rustClient = readFileSync(new URL('../src-tauri/src/market_providers/polymarket.rs', import.meta.url), 'utf8');
  assert.match(rustClient, /const MAX_JSON_RESPONSE_BYTES: usize = 4 \* 1024 \* 1024;/);
  assert.match(
    rustClient,
    /fn decode_json_reader<[\s\S]*reader\.take\(\(max_bytes as u64\)\.saturating_add\(1\)\)[\s\S]*body\.len\(\) > max_bytes/,
    'Rust Polymarket JSON decoding must stop reading after the configured byte ceiling',
  );
  assert.doesNotMatch(
    rustClient,
    /\.json::<(?:GammaMarketPage|PriceHistoryResponse|MidpointResponse|BookResponse|LastTradeResponse)>\(\)/,
    'Polymarket endpoints must not bypass the bounded JSON response reader',
  );
  assert.ok(
    (rustClient.match(/decode_json_response::</g) ?? []).length >= 5,
    'catalog, history, midpoint, book, and last-trade responses must share the bounded decoder',
  );

  console.log('Polymarket gateway contract passed');
} finally {
  await close(gateway);
  await close(upstream);
}
