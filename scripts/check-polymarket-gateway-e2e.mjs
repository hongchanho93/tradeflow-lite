import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPolymarketGateway } from '../server/polymarket-gateway.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const listen = (server) => new Promise((resolveAddress, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolveAddress(server.address()));
});
const close = (server) => new Promise((resolveClose, reject) => {
  server.close((error) => error ? reject(error) : resolveClose());
});

const upstream = createServer((request, response) => {
  const url = new URL(request.url, 'http://upstream.test');
  response.setHeader('content-type', 'application/json');
  if (url.pathname === '/markets') {
    response.end(JSON.stringify([{
      question: 'Will the gateway integration work?',
      conditionId: '0xtradeflow',
      description: 'Gateway integration contract',
      resolutionSource: 'https://example.test/rules',
      endDate: '2027-01-01T00:00:00Z',
      outcomes: '["Yes","No"]',
      clobTokenIds: '["111","222"]',
      outcomePrices: '["0.61","0.39"]',
      oneDayPriceChange: 0.01,
      volumeNum: 1000,
      liquidityNum: 500,
    }]));
    return;
  }
  if (url.pathname === '/prices-history' && url.searchParams.get('market') === '111') {
    if (url.searchParams.has('startTs')) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: 'window_starts_before_market' }));
      return;
    }
    if (url.searchParams.get('interval') !== 'max') {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: 'expected_lifetime_fallback' }));
      return;
    }
    response.end(JSON.stringify({ history: [{ t: 1_800_000_000, p: 0.60 }, { t: 1_800_003_600, p: 0.61 }] }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'not_found' }));
});

const upstreamAddress = await listen(upstream);
const upstreamBase = `http://127.0.0.1:${upstreamAddress.port}`;
const gateway = createPolymarketGateway({
  gammaBase: upstreamBase,
  clobBase: upstreamBase,
  logger: { info() {}, error() {} },
});
const gatewayAddress = await listen(gateway);
const gatewayBase = `http://127.0.0.1:${gatewayAddress.port}`;

try {
  const child = spawn('cargo', [
    'test',
    '--manifest-path', 'src-tauri/Cargo.toml',
    'market_providers::polymarket::tests::real_polymarket_catalog_and_probability_history',
    '--', '--ignored', '--exact', '--nocapture',
  ], {
    cwd: projectRoot,
    env: { ...process.env, TRADEFLOW_POLYMARKET_GATEWAY_URL: gatewayBase },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  if (exitCode !== 0) throw new Error(`gateway end-to-end contract failed\n${output}`);
  console.log('Lite -> gateway -> Polymarket upstream contract passed');
} finally {
  await close(gateway);
  await close(upstream);
}
