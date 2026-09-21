import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_GAMMA_BASE = 'https://gamma-api.polymarket.com';
const DEFAULT_CLOB_BASE = 'https://clob.polymarket.com';
const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_CONCURRENT_UPSTREAM_REQUESTS = 32;

class GatewayUpstreamError extends Error {
  constructor(code, statusCode = 502) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const ROUTES = new Map([
  ['/v1/polymarket/gamma/markets', {
    upstreamPath: '/markets',
    source: 'gamma',
    cacheMs: 30_000,
    validate(searchParams) {
      return validateExactParameters(searchParams, {
        active: (value) => value === 'true',
        closed: (value) => value === 'false',
        limit: (value) => integerInRange(value, 1, 100),
        offset: (value) => integerInRange(value, 0, 9_900) && Number(value) % 100 === 0,
        order: (value) => value === 'volume24hr',
        ascending: (value) => value === 'false',
      });
    },
  }],
  ['/v1/polymarket/gamma/markets-keyset', {
    upstreamPath: '/markets/keyset',
    source: 'gamma',
    cacheMs: 30_000,
    validate(searchParams) {
      return validateParameters(searchParams, {
        closed: (value) => value === 'false',
        limit: (value) => integerInRange(value, 1, 100),
        order: (value) => value === 'volume24hr',
        ascending: (value) => value === 'false',
      }, {
        after_cursor: validCatalogCursor,
      });
    },
  }],
  ['/v1/polymarket/clob/prices-history', {
    upstreamPath: '/prices-history',
    source: 'clob',
    cacheMs: 60_000,
    validate(searchParams) {
      const common = {
        market: validTokenId,
        fidelity: (value) => integerInRange(value, 1, 43_200),
      };
      if (searchParams.has('interval')) {
        return validateExactParameters(searchParams, {
          ...common,
          interval: (value) => value === 'max',
        });
      }
      const error = validateExactParameters(searchParams, {
        ...common,
        startTs: validUnixSeconds,
        endTs: validUnixSeconds,
      });
      if (error) return error;
      if (Number(searchParams.get('startTs')) >= Number(searchParams.get('endTs'))) {
        return 'startTs 必须早于 endTs';
      }
      return null;
    },
  }],
  ...['midpoint', 'book', 'last-trade-price'].map((name) => [
    `/v1/polymarket/clob/${name}`,
    {
      upstreamPath: `/${name}`,
      source: 'clob',
      cacheMs: 1_000,
      validate(searchParams) {
        return validateExactParameters(searchParams, { token_id: validTokenId });
      },
    },
  ]),
]);

function integerInRange(value, minimum, maximum) {
  return /^\d+$/.test(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function validUnixSeconds(value) {
  return integerInRange(value, 1, 9_999_999_999);
}

function validTokenId(value) {
  return /^\d{1,96}$/.test(value);
}

function validCatalogCursor(value) {
  return /^[A-Za-z0-9._~+/=-]{1,512}$/.test(value);
}

function validateExactParameters(searchParams, validators) {
  return validateParameters(searchParams, validators);
}

function validateParameters(searchParams, required, optional = {}) {
  const expected = new Set([...Object.keys(required), ...Object.keys(optional)]);
  for (const key of searchParams.keys()) {
    if (!expected.has(key)) return `不支持参数 ${key}`;
  }
  for (const [key, validate] of Object.entries(required)) {
    const values = searchParams.getAll(key);
    if (values.length !== 1 || !validate(values[0])) return `参数 ${key} 无效`;
  }
  for (const [key, validate] of Object.entries(optional)) {
    const values = searchParams.getAll(key);
    if (values.length > 1 || (values.length === 1 && !validate(values[0]))) return `参数 ${key} 无效`;
  }
  return null;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  response.end(JSON.stringify(value));
}

function cleanBaseUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} 不是有效 URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} 必须是无凭据、无查询参数的 HTTP(S) URL`);
  }
  return url.href.replace(/\/$/, '');
}

async function readLimitedResponseBody(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new GatewayUpstreamError('upstream_response_too_large');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new GatewayUpstreamError('upstream_response_too_large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export function createPolymarketGateway({
  gammaBase = DEFAULT_GAMMA_BASE,
  clobBase = DEFAULT_CLOB_BASE,
  logger = console,
  fetchImpl = fetch,
  maxCacheEntries = 512,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  maxConcurrentRequests = MAX_CONCURRENT_UPSTREAM_REQUESTS,
} = {}) {
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1) {
    throw new Error('maxCacheEntries 必须是正整数');
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error('maxResponseBytes 必须是正整数');
  }
  if (!Number.isInteger(maxConcurrentRequests) || maxConcurrentRequests < 1) {
    throw new Error('maxConcurrentRequests 必须是正整数');
  }
  const bases = {
    gamma: cleanBaseUrl(gammaBase, 'POLYMARKET_GAMMA_BASE'),
    clob: cleanBaseUrl(clobBase, 'POLYMARKET_CLOB_BASE'),
  };
  const cache = new Map();
  const inFlight = new Map();
  let activeUpstreamRequests = 0;

  function storeCache(target, value, cacheMs) {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    while (cache.size >= maxCacheEntries) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(target, { value, expiresAt: now + cacheMs });
  }

  async function fetchUpstream(target, cacheMs) {
    const cached = cache.get(target);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cacheHit: true };
    if (cached) cache.delete(target);
    if (inFlight.has(target)) return inFlight.get(target);
    if (activeUpstreamRequests >= maxConcurrentRequests) {
      throw new GatewayUpstreamError('gateway_busy', 503);
    }
    activeUpstreamRequests += 1;

    const pending = (async () => {
      const upstream = await fetchImpl(target, {
        headers: { accept: 'application/json', 'user-agent': 'TradeFlow-Lite-Gateway/0.1' },
        redirect: 'manual',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const contentType = upstream.headers.get('content-type') || '';
      const body = await readLimitedResponseBody(upstream, maxResponseBytes);
      if (upstream.ok && !contentType.toLowerCase().includes('json')) {
        throw new GatewayUpstreamError('upstream_response_not_json');
      }
      const value = { status: upstream.status, contentType, body };
      if (upstream.ok) storeCache(target, value, cacheMs);
      return { ...value, cacheHit: false };
    })().finally(() => {
      activeUpstreamRequests -= 1;
      inFlight.delete(target);
    });
    inFlight.set(target, pending);
    return pending;
  }

  return createServer(async (request, response) => {
    const startedAt = Date.now();
    let requestUrl;
    try {
      requestUrl = new URL(request.url || '/', 'http://gateway.local');
    } catch {
      sendJson(response, 400, { error: 'invalid_request_target' });
      return;
    }
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    if (requestUrl.pathname === '/healthz') {
      sendJson(response, 200, { ok: true, service: 'tradeflow-polymarket-gateway' });
      return;
    }
    const route = ROUTES.get(requestUrl.pathname);
    if (!route) {
      sendJson(response, 404, { error: 'route_not_found' });
      return;
    }
    const validationError = route.validate(requestUrl.searchParams);
    if (validationError) {
      sendJson(response, 400, { error: 'invalid_request', message: validationError });
      return;
    }

    const target = `${bases[route.source]}${route.upstreamPath}?${requestUrl.searchParams}`;
    try {
      const upstream = await fetchUpstream(target, route.cacheMs);
      response.writeHead(upstream.status, {
        'content-type': upstream.contentType || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'x-tradeflow-source': 'polymarket',
      });
      response.end(upstream.body);
      logger.info(JSON.stringify({
        event: 'polymarket_gateway_request',
        route: requestUrl.pathname,
        status: upstream.status,
        cache_hit: upstream.cacheHit,
        latency_ms: Date.now() - startedAt,
      }));
    } catch (error) {
      const statusCode = error instanceof GatewayUpstreamError ? error.statusCode : 502;
      const errorCode = error instanceof GatewayUpstreamError ? error.code : 'upstream_unavailable';
      logger.error(JSON.stringify({
        event: 'polymarket_gateway_upstream_error',
        route: requestUrl.pathname,
        latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      }));
      sendJson(response, statusCode, {
        error: errorCode,
        message: statusCode === 503 ? 'Polymarket 网关繁忙，请稍后重试' : 'Polymarket 上游暂不可用',
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || '8787');
  const server = createPolymarketGateway({
    gammaBase: process.env.POLYMARKET_GAMMA_BASE || DEFAULT_GAMMA_BASE,
    clobBase: process.env.POLYMARKET_CLOB_BASE || DEFAULT_CLOB_BASE,
  });
  server.listen(port, host, () => {
    console.log(JSON.stringify({ event: 'polymarket_gateway_started', host, port }));
  });
}
