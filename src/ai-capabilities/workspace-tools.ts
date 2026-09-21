import {
  CAPABILITY_LIMITS, CapabilityError, type JsonValue, type ToolDefinition, type ToolExecutionContext, type ValueSchema,
} from './contracts.ts';
import { objectSchema, countSchema } from './chart-data.ts';
import { snapshotJson } from './json.ts';
import {
  isCanonicalMarketSymbol, listMarketSymbols, type MarketCatalogPage, type MarketCatalogSymbol,
  type MarketProviderDescriptor, type MarketSymbol,
} from '../market-universe.ts';

export interface WorkspaceDefinition {
  readonly id: string;
  readonly name: string;
  readonly indicatorVersion: number;
  readonly runtimeKind: 'trusted' | 'user';
  readonly description?: string;
  readonly author?: string;
  readonly inputs: Readonly<Record<string, unknown>>;
}
export interface WorkspaceInstance {
  readonly instanceId: string;
  readonly indicatorId: string;
  readonly indicatorVersion: number;
  readonly sourceHash?: string;
  readonly runtimeKind: 'trusted' | 'user';
  readonly visible: boolean;
  readonly running: boolean;
  readonly failed: boolean;
  readonly failurePhase?: string;
  readonly failureCode?: string;
  readonly failureDetail?: string;
  readonly inputs: Readonly<Record<string, unknown>>;
}
/** Read ports over existing host data. No new cache, user code, credentials or current-chart mutation. */
export interface WorkspaceReadHost {
  providers(): Promise<readonly MarketProviderDescriptor[]>;
  symbols(): readonly MarketSymbol[];
  catalog(input: { providerId: string; venue: string; cursor?: string; limit: number }): Promise<MarketCatalogPage>;
  catalogStatus?(providerId?: string, venue?: string): { loaded: boolean; complete: boolean };
  watchlist(): readonly { key: string; symbol: MarketSymbol | null }[];
  definitions(): readonly WorkspaceDefinition[];
  instances(): readonly WorkspaceInstance[];
  library(): { ready: boolean; records: readonly WorkspaceDefinition[] };
  indicatorsReady?(): boolean;
}

// Page budget only, not a cap on the number of symbols/indicators a user may query.
const PAGE_SIZE = 100;
const text = (maxLength = 256): ValueSchema => ({ type: 'string', maxLength });
const strings: ValueSchema = { type: 'array', items: text() };
const pageInput = { offset: countSchema, limit: { type: 'integer', minimum: 1, maximum: PAGE_SIZE } as ValueSchema };
const kinds = ['stock', 'etf', 'index', 'crypto', 'prediction'] as const;
const symbolSchema = objectSchema({
  providerId: text(), symbol: text(), name: text(8192), venue: text(), kind: { type: 'string', enum: kinds },
  baseAsset: text(), quoteAsset: text(),
}, ['providerId', 'symbol', 'name', 'venue', 'kind']);
const providerSchema = objectSchema({
  id: text(), displayName: text(), version: text(), contractVersion: text(), enabled: { type: 'boolean' },
  capabilities: objectSchema({ catalog: { type: 'boolean' }, history: { type: 'boolean' }, quote: { type: 'boolean' },
    realtime: { type: 'boolean' }, venues: strings, kinds: strings, resolutions: strings, adjustments: strings }),
});
const definitionSchema = objectSchema({
  id: text(), name: text(8192), indicatorVersion: countSchema, runtimeKind: { type: 'string', enum: ['trusted', 'user'] },
  description: text(16384), author: text(512), inputsJson: text(128 * 1024),
});
const pageSchema = (item: ValueSchema): ValueSchema => objectSchema({
  items: { type: 'array', items: item, maxItems: PAGE_SIZE }, total: countSchema, offset: countSchema,
  nextOffset: countSchema, ready: { type: 'boolean' }, coverage: text(),
}, ['items', 'total', 'offset', 'ready', 'coverage']);
const searchPageSchema = objectSchema({
  items: { type: 'array', items: symbolSchema, maxItems: PAGE_SIZE }, total: countSchema, offset: countSchema,
  nextOffset: countSchema, ready: { type: 'boolean' }, coverage: text(), catalogLoaded: { type: 'boolean' }, catalogComplete: { type: 'boolean' },
}, ['items', 'total', 'offset', 'ready', 'coverage', 'catalogLoaded', 'catalogComplete']);
type Input = { providerId?: string; venue?: string; query?: string; offset?: number; limit?: number; cursor?: string };

function page<T>(items: readonly T[], input: Input, coverage: string, ready = true) {
  const offset = input.offset ?? 0, limit = input.limit ?? 50;
  const selected = items.slice(offset, offset + limit);
  return { items: selected, total: items.length, offset, ready, coverage,
    ...(offset + selected.length < items.length ? { nextOffset: offset + selected.length } : {}) };
}
function mappedPage<T>(items: readonly T[], input: Input, coverage: string, map: (item: T) => unknown, ready = true) {
  const selected = page(items, input, coverage, ready);
  return { ...selected, items: selected.items.map(map) };
}
function providerValue(p: MarketProviderDescriptor) {
  const c = p.capabilities;
  return { id: p.id, displayName: p.displayName, version: p.version, contractVersion: p.contractVersion, enabled: p.enabled,
    capabilities: { catalog: c.catalog, history: c.history, quote: c.quote, realtime: c.realtime,
      venues: [...c.venues], kinds: [...c.kinds], resolutions: [...c.resolutions], adjustments: [...c.adjustments] } };
}
function symbolValue(row: MarketCatalogSymbol | MarketSymbol) {
  if (!isCanonicalMarketSymbol(row.symbol)) throw new CapabilityError('invalid_output');
  return { providerId: row.providerId, symbol: row.symbol, name: row.name, kind: row.kind,
    venue: row.symbol.split(':')[0], ...(row.baseAsset == null ? {} : { baseAsset: row.baseAsset }),
    ...(row.quoteAsset == null ? {} : { quoteAsset: row.quoteAsset }) };
}
function definitionValue(row: WorkspaceDefinition) {
  return { id: row.id, name: row.name, indicatorVersion: row.indicatorVersion, runtimeKind: row.runtimeKind,
    description: row.description ?? '', author: row.author ?? '',
    // Preserve the existing SDK input schema, not function handles or arbitrary manifest fields.
    inputsJson: snapshotJson(row.inputs, 128 * 1024).text };
}

function mapCatalogFailure(error: unknown): never {
  const code = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code : '';
  if (['market_data_unavailable','market_data_source_unavailable','market_data_client_unavailable'].includes(code)) {
    throw new CapabilityError('data_not_ready');
  }
  if (['catalog_cursor_invalid','catalog_page_invalid'].includes(code)) throw new CapabilityError('invalid_request');
  if (['catalog_route_not_found','unsupported_capability'].includes(code)) throw new CapabilityError('field_unavailable');
  if (['provider_contract_violation','invalid_market_data'].includes(code)) throw new CapabilityError('invalid_output');
  if (error instanceof CapabilityError) throw error;
  throw new CapabilityError('tool_failed');
}

export function createWorkspaceReadTools(host: WorkspaceReadHost): readonly ToolDefinition[] {
  const read = (id: string, description: string, inputSchema: ValueSchema, outputSchema: ValueSchema,
    run: (input: Input, execution: ToolExecutionContext) => unknown | Promise<unknown>, scope: 'app' | 'chart' = 'app'): ToolDefinition => ({
    id, version: 1, effect: 'read', scope, description, inputSchema, outputSchema,
    async run(input: JsonValue, execution) {
      execution.checkpoint();
      const value = await run(input as Input, execution);
      execution.checkpoint();
      return snapshotJson(value, CAPABILITY_LIMITS.maxOutputBytes).value;
    },
  });
  const getProvider = async (providerId: string, execution: ToolExecutionContext) => {
    const providers = await host.providers(); execution.checkpoint();
    const provider = providers.find(p => p.id === providerId);
    if (!provider) throw new CapabilityError('field_unavailable');
    return provider;
  };
  return [
    read('tf.market.providers', 'List installed market providers and their actual supported capabilities. App query; no chart context required.',
      objectSchema(pageInput, []), pageSchema(providerSchema), async input => mappedPage(await host.providers(), input, 'installed-providers', providerValue)),
    read('tf.market.provider', 'Describe a provider by its exact id, including supported venues, periods and adjustments.',
      objectSchema({ providerId: text() }), providerSchema, async (input, ctx) => providerValue(await getProvider(input.providerId!, ctx))),
    read('tf.market.search', 'Search names, codes and aliases only in the symbol catalog already loaded into the app. ready=false means the selected provider/venue has not loaded any catalog page yet; catalogComplete=false means matches are partial and total=0 is NOT proof that the symbol does not exist. Does not change the chart.',
      objectSchema({ query: text(512), providerId: text(), venue: text(), ...pageInput }, []), searchPageSchema, input => {
        const rows = host.symbols().filter(row => (!input.providerId || row.providerId === input.providerId) && (!input.venue || row.venue === input.venue));
        const found = listMarketSymbols([...rows], input.query ?? '', 'all', 'all', rows.length);
        const status = host.catalogStatus?.(input.providerId, input.venue) ?? { loaded: true, complete: true };
        const selected = page(found, input, 'loaded-catalog', status.loaded);
        return { ...selected, catalogLoaded: status.loaded, catalogComplete: status.complete,
          items: (selected.items as MarketSymbol[]).map(symbolValue) };
      }),
    read('tf.market.catalog', 'Read one provider catalog page without changing the chart. TDX uses its local static catalog; other enabled providers use their existing catalog API. Pass nextCursor unchanged.',
      objectSchema({ providerId: text(), venue: text(), cursor: text(4096), limit: pageInput.limit }, ['providerId', 'venue']),
      objectSchema({ items: { type: 'array', items: symbolSchema, maxItems: PAGE_SIZE }, nextCursor: text(4096), coverage: text() }, ['items', 'coverage']),
      async (input, ctx) => {
        const p = await getProvider(input.providerId!, ctx);
        if (!p.enabled || !p.capabilities.venues.includes(input.venue!)) throw new CapabilityError('field_unavailable');
        if (!p.capabilities.catalog) {
          if (p.id !== 'tdx') throw new CapabilityError('field_unavailable');
          if (input.cursor !== undefined && (!/^(0|[1-9]\d*)$/.test(input.cursor) || !Number.isSafeInteger(Number(input.cursor)))) throw new CapabilityError('invalid_request');
          const rows = host.symbols().filter(row => row.providerId === p.id && row.venue === input.venue);
          const selected = page(rows, { offset: Number(input.cursor ?? 0), limit: input.limit }, 'local-static');
          return { items: (selected.items as MarketSymbol[]).map(symbolValue), coverage: 'local-static',
            ...(selected.nextOffset === undefined ? {} : { nextCursor: String(selected.nextOffset) }) };
        }
        let result: MarketCatalogPage;
        try { result = await host.catalog({ providerId: p.id, venue: input.venue!, cursor: input.cursor, limit: input.limit ?? 50 }); }
        catch (error) { return mapCatalogFailure(error); }
        ctx.checkpoint();
        if (result.symbols.some(row => row.providerId !== p.id || !row.symbol.startsWith(`${input.venue}:`) || !p.capabilities.kinds.includes(row.kind))) {
          throw new CapabilityError('invalid_output');
        }
        return { items: result.symbols.map(symbolValue), coverage: 'provider-page',
          ...(result.nextCursor == null ? {} : { nextCursor: result.nextCursor }) };
      }),
    read('tf.watchlist.list', 'Read the single local watchlist in its saved order, retaining unresolved entries. This is not a current quote request.',
      objectSchema(pageInput, []), pageSchema(objectSchema({ key: text(), resolved: { type: 'boolean' }, symbol: symbolSchema }, ['key', 'resolved'])), input => {
        const rows = host.watchlist().map(row => ({ key: row.key, resolved: row.symbol !== null,
          ...(row.symbol === null ? {} : { symbol: symbolValue(row.symbol) }) }));
        return page(rows, input, 'local-watchlist');
      }),
    read('tf.indicator.definitions', 'List available built-in and imported indicator definitions and their input schemas (inputsJson). Does not return or execute source code.',
      objectSchema(pageInput, []), pageSchema(definitionSchema), input => mappedPage(host.definitions(), input, 'installed-definitions', definitionValue, host.indicatorsReady?.() ?? true)),
    read('tf.indicator.instances', 'Read current chart indicator instances, visibility, failure state and input values (inputsJson). Requires the exact chart context.',
      objectSchema(pageInput, []), pageSchema(objectSchema({ instanceId: text(), indicatorId: text(), indicatorVersion: countSchema,
        sourceHash: text(64), runtimeKind: { type: 'string', enum: ['trusted', 'user'] }, visible: { type: 'boolean' }, running: { type: 'boolean' },
        failed: { type: 'boolean' }, failurePhase: text(64), failureCode: text(128), failureDetail: text(512), inputsJson: text(128 * 1024) },
        ['instanceId','indicatorId','indicatorVersion','runtimeKind','visible','running','failed','inputsJson'])),
      input => mappedPage(host.instances(), input, 'current-chart-instances', row => ({ instanceId: row.instanceId, indicatorId: row.indicatorId, indicatorVersion: row.indicatorVersion,
        ...(row.sourceHash ? { sourceHash: row.sourceHash } : {}), runtimeKind: row.runtimeKind, visible: row.visible, running: row.running, failed: row.failed,
        ...(row.failurePhase ? { failurePhase: row.failurePhase } : {}), ...(row.failureCode ? { failureCode: row.failureCode } : {}),
        ...(row.failureDetail ? { failureDetail: row.failureDetail } : {}),
        inputsJson: snapshotJson(row.inputs, 128 * 1024).text }), host.indicatorsReady?.() ?? true), 'chart'),
    read('tf.indicator.library', 'Read imported user indicator library metadata only. ready=false means initialization is incomplete/unavailable, not an empty user library.',
      objectSchema(pageInput, []), pageSchema(definitionSchema), input => {
        const library = host.library(); return mappedPage(library.records, input, 'user-library', definitionValue, library.ready);
      }),
  ];
}
