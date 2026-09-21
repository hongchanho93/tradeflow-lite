import type { MarketCatalogPage, MarketCatalogSymbol, MarketProviderDescriptor } from '../market-universe.ts';
import type { MarketQueryPort } from '../ai-capabilities/market-query.ts';
import { copyHistory } from '../ai-capabilities/market-data.ts';
import type { JsonValue } from '../ai-capabilities/contracts.ts';
import type { UserDataManager } from '../user-data/manager.ts';
import { EmptyConnectorHistory } from '../user-data/provider.ts';
import { TASK_LIMITS, TaskError, exact, taskJson, taskSymbol, text, type TaskSymbol, type HistoryNeed } from './contracts.ts';

export interface TaskCatalogPage { symbols: readonly TaskSymbol[]; nextCursor?: string }
export interface TaskSourceLease {
  readonly providerId: string; readonly revision: string; readonly name: string; readonly signal: AbortSignal;
  readonly catalogScope?: 'loaded-symbols' | 'provider-catalog' | 'connector-catalog';
  catalog(cursor: string | undefined, limit: number, signal: AbortSignal): Promise<TaskCatalogPage>;
  history(symbol: TaskSymbol, need: HistoryNeed, signal: AbortSignal): Promise<JsonValue>;
  close(): void;
}
export interface TaskDataHost { acquire(providerId: string, venue: string | undefined, history: readonly HistoryNeed[], signal: AbortSignal): Promise<TaskSourceLease> }
export interface TaskSourceHost {
  providers(): Promise<readonly MarketProviderDescriptor[]>;
  catalog(input: { providerId: string; venue: string; cursor?: string; limit: number }): Promise<MarketCatalogPage>;
  loadedSymbols(): readonly MarketCatalogSymbol[];
  market: MarketQueryPort;
  data(): UserDataManager;
}
export function createTaskDataHost(host: TaskSourceHost): TaskDataHost {
  return { async acquire(providerId, venue, needs, signal) {
    if (!text(providerId, 128) || (venue !== undefined && !/^[A-Z0-9._-]{1,32}$/.test(venue))) throw new TaskError('task_invalid_source');
    const local = new AbortController(); let sourceSignal: AbortSignal = local.signal;
    const check = () => { if (signal.aborted || sourceSignal.aborted || local.signal.aborted) throw new TaskError('task_source_changed'); };
    let name: string, revision: string, venues: readonly string[], kinds: readonly string[], catalogScope: TaskSourceLease['catalogScope'];
    let catalog: (cursor: string | undefined, limit: number, signal: AbortSignal) => Promise<unknown>;
    let market: MarketQueryPort;
    if (providerId.startsWith('user_data_')) {
      const manager = host.data(); await manager.initialize(); check();
      let mounted;
      try { mounted = manager.connector(providerId.slice('user_data_'.length)); } catch { throw new TaskError('task_source_unavailable'); }
      const c = mounted.manifest.supports;
      if (needs.some(n => !c.resolutions.includes(n.resolution) || !c.adjustments.includes(n.adjustment))) throw new TaskError('task_history_unsupported');
      name = mounted.name; revision = mounted.revision; venues = c.venues; kinds = c.kinds; catalogScope = 'connector-catalog';
      sourceSignal = AbortSignal.any([mounted.provider.signal, local.signal]); market = mounted.provider;
      catalog = (cursor, limit, active) => mounted.provider.catalog({ limit, ...(cursor === undefined ? {} : { cursor }) }, active);
    } else {
      const providers = await host.providers(); check(); const p = providers.find(p => p.id === providerId);
      if (!p?.enabled || !p.capabilities.history) throw new TaskError('task_source_unavailable');
      const c = p.capabilities;
      if (needs.some(n => !c.resolutions.includes(n.resolution) || !c.adjustments.includes(n.adjustment))) throw new TaskError('task_history_unsupported');
      name = p.displayName; revision = p.version; venues = c.venues; kinds = c.kinds; market = host.market; catalogScope = c.catalog ? 'provider-catalog' : 'loaded-symbols';
      // Static catalogs already loaded by the app (such as TDX) remain the same data source.
      const loaded = c.catalog ? undefined : host.loadedSymbols().filter(s => s.providerId === providerId && (!venue || s.symbol.startsWith(`${venue}:`)));
      catalog = async (cursor, limit, active) => {
        if (active.aborted) throw new TaskError('task_cancelled');
        if (loaded) {
          if (cursor !== undefined && !/^\d+$/.test(cursor)) throw new TaskError('task_invalid_cursor');
          const offset = Number(cursor ?? 0); if (!Number.isSafeInteger(offset) || offset > loaded.length) throw new TaskError('task_invalid_cursor');
          return { symbols: loaded.slice(offset, offset + limit), ...(offset + limit < loaded.length ? { nextCursor: String(offset + limit) } : {}) };
        }
        if (!venue) throw new TaskError('task_venue_required');
        return host.catalog({ providerId, venue, ...(cursor === undefined ? {} : { cursor }), limit });
      };
    }
    if (venue && !venues.includes(venue)) throw new TaskError('task_invalid_source'); check();
    const allowed = (value: unknown, selectedVenue = true) => {
      if (value === null || typeof value !== 'object') throw new TaskError('task_invalid_symbol');
      const v = value as TaskSymbol;
      const symbol = taskSymbol({ providerId: v.providerId, symbol: v.symbol, kind: v.kind, ...(v.name === undefined ? {} : { name: v.name }) });
      if (symbol.providerId !== providerId || !venues.includes(symbol.symbol.split(':')[0]) || !kinds.includes(symbol.kind)
        || (selectedVenue && venue && !symbol.symbol.startsWith(`${venue}:`))) throw new TaskError('task_invalid_symbol');
      return symbol;
    };
    return { providerId, name, revision, catalogScope, signal: sourceSignal,
      async catalog(cursor, limit, active) {
        check(); if (!Number.isInteger(limit) || limit < 1 || limit > TASK_LIMITS.catalogPage) throw new TaskError('task_invalid_request');
        const scope = AbortSignal.any([signal, sourceSignal, active]);
        const raw = await catalog(cursor, limit, scope); check(); if (scope.aborted) throw new TaskError('task_cancelled');
        exact(raw, ['symbols','nextCursor'], ['symbols']);
        if (!Array.isArray(raw.symbols) || raw.symbols.length > limit
          || (raw.nextCursor != null && !text(raw.nextCursor, 4096))) throw new TaskError('task_invalid_output');
        const symbols = raw.symbols.map(value => allowed(value, false)).filter(s => !venue || s.symbol.startsWith(`${venue}:`));
        return { symbols, ...(typeof raw.nextCursor === 'string' ? { nextCursor: raw.nextCursor } : {}) };
      },
      async history(symbol, need, active) {
        check(); const selected = allowed(symbol);
        const query = { providerId, symbol: selected.symbol, kind: selected.kind, resolution: need.resolution, adjustment: need.adjustment, count: need.count };
        const scope = AbortSignal.any([signal, sourceSignal, active]);
        let value;
        try { value = await market.execute({ operation: 'history', ...query }, scope); }
        catch (error) {
          check(); if (scope.aborted) throw new TaskError('task_cancelled');
          if (error instanceof EmptyConnectorHistory) return { rows: [], seriesKind: selected.kind === 'prediction' ? 'probability' : 'ohlcv',
            requestedCount: need.count, shortfall: true, coverage: 'provider-returned-window', finality: 'unknown',
            ...(error.nextCursor ? { nextCursor: error.nextCursor } : {}) };
          throw new TaskError('task_data_failed');
        }
        check(); if (scope.aborted) throw new TaskError('task_cancelled');
        const copied = copyHistory(value, query);
        return taskJson({ rows: copied.rows, seriesKind: copied.seriesKind, source: copied.source, requestedCount: need.count,
          shortfall: copied.rows.length < need.count, coverage: 'provider-returned-window', finality: 'unknown',
          timeUnit: 'unix-seconds', priceUnit: copied.seriesKind === 'probability' ? 'percent' : 'provider-native',
          volumeUnit: copied.seriesKind === 'probability' ? 'not-applicable' : 'unknown',
          ...(copied.nextCursor ? { nextCursor: copied.nextCursor } : {}) });
      },
      close() { local.abort(); },
    };
  } };
}
