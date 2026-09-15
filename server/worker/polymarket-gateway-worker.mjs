const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const CLOB_BASE = 'https://clob.polymarket.com';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const ROUTES = new Map([
  ['/v1/polymarket/gamma/markets', {
    base: GAMMA_BASE,
    path: '/markets',
    cacheSeconds: 30,
    validate(params) {
      return validateExact(params, {
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
    base: GAMMA_BASE,
    path: '/markets/keyset',
    cacheSeconds: 30,
    validate(params) {
      return validateParameters(params, {
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
    base: CLOB_BASE,
    path: '/prices-history',
    cacheSeconds: 60,
    validate(params) {
      const common = {
        market: validTokenId,
        fidelity: (value) => integerInRange(value, 1, 43_200),
      };
      if (params.has('interval')) {
        return validateExact(params, {
          ...common,
          interval: (value) => value === 'max',
        });
      }
      const error = validateExact(params, {
        ...common,
        startTs: validUnixSeconds,
        endTs: validUnixSeconds,
      });
      if (error) return error;
      return Number(params.get('startTs')) < Number(params.get('endTs'))
        ? null
        : 'startTs 必须早于 endTs';
    },
  }],
  ...['midpoint', 'book', 'last-trade-price'].map((name) => [
    `/v1/polymarket/clob/${name}`,
    {
      base: CLOB_BASE,
      path: `/${name}`,
      cacheSeconds: 1,
      validate: (params) => validateExact(params, { token_id: validTokenId }),
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

function validateExact(params, validators) {
  return validateParameters(params, validators);
}

function validateParameters(params, required, optional = {}) {
  const allowed = new Set([...Object.keys(required), ...Object.keys(optional)]);
  for (const key of params.keys()) {
    if (!allowed.has(key)) return `不支持参数 ${key}`;
  }
  for (const [key, validate] of Object.entries(required)) {
    const values = params.getAll(key);
    if (values.length !== 1 || !validate(values[0])) return `参数 ${key} 无效`;
  }
  for (const [key, validate] of Object.entries(optional)) {
    const values = params.getAll(key);
    if (values.length > 1 || (values.length === 1 && !validate(values[0]))) return `参数 ${key} 无效`;
  }
  return null;
}

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      ...extraHeaders,
    },
  });
}

function responseHeaders(request, upstream, cacheHit) {
  const headers = {
    'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'x-tradeflow-source': 'polymarket',
    'x-tradeflow-cache': cacheHit ? 'HIT' : 'MISS',
    'x-tradeflow-worker-colo': request.cf?.colo || 'unknown',
  };
  const upstreamRay = upstream.headers.get('cf-ray');
  if (upstreamRay) headers['x-tradeflow-upstream-cf-ray'] = upstreamRay;
  return headers;
}

export async function handleRequest(request, env, ctx, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const cache = dependencies.cache === undefined ? globalThis.caches?.default : dependencies.cache;
  const url = new URL(request.url);
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  if (url.pathname === '/healthz') {
    return json(200, {
      ok: true,
      service: 'tradeflow-polymarket-worker',
      colo: request.cf?.colo || 'unknown',
    });
  }
  const route = ROUTES.get(url.pathname);
  if (!route) return json(404, { error: 'route_not_found' });
  const validationError = route.validate(url.searchParams);
  if (validationError) {
    return json(400, { error: 'invalid_request', message: validationError });
  }

  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) {
    return new Response(cached.body, {
      status: cached.status,
      headers: responseHeaders(request, cached, true),
    });
  }

  const target = `${route.base}${route.path}?${url.searchParams}`;
  try {
    const upstream = await fetchImpl(target, {
      headers: { accept: 'application/json', 'user-agent': 'TradeFlow-Lite-Worker/0.1' },
      redirect: 'manual',
    });
    if (!upstream.ok) {
      return json(upstream.status, { error: 'upstream_http_error', status: upstream.status }, responseHeaders(request, upstream, false));
    }
    if (!(upstream.headers.get('content-type') || '').toLowerCase().includes('json')) {
      return json(502, { error: 'upstream_response_not_json' });
    }
    const declaredLength = Number(upstream.headers.get('content-length') || '0');
    if (declaredLength > MAX_RESPONSE_BYTES) {
      return json(502, { error: 'upstream_response_too_large' });
    }
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_RESPONSE_BYTES) {
      return json(502, { error: 'upstream_response_too_large' });
    }
    const headers = responseHeaders(request, upstream, false);
    if (cache) {
      const cacheHeaders = new Headers(headers);
      cacheHeaders.set('cache-control', `public, max-age=${route.cacheSeconds}`);
      ctx.waitUntil(cache.put(cacheKey, new Response(body.slice(0), { status: 200, headers: cacheHeaders })));
    }
    return new Response(body, { status: 200, headers });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'polymarket_worker_upstream_error',
      route: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    }));
    return json(502, { error: 'upstream_unavailable', message: 'Polymarket 上游暂不可用' });
  }
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};
