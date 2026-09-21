import { CapabilityError } from './contracts.ts';
import type { MarketSymbolKind } from '../market-universe.ts';

export type QuoteQuery = Readonly<{ providerId: string; symbol: string; kind: MarketSymbolKind }>;
export type HistoryQuery = QuoteQuery & Readonly<{ resolution: string; adjustment: 'none' | 'qfq'; count: number }>;
export type MarketQuery = ({ operation: 'history' } & HistoryQuery) | ({ operation: 'quote' } & QuoteQuery);
export interface MarketQueryPort { execute(input: MarketQuery, signal: AbortSignal): Promise<unknown> }
type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export function marketQueryError(error: unknown): CapabilityError {
  if (error instanceof CapabilityError) return error;
  // Never expose provider messages, addresses, or paths via a model tool error.
  const code = typeof error === 'string' ? error : '';
  if (['busy', 'cancelled', 'timeout', 'invalid_output'].includes(code)) return new CapabilityError(code as 'busy' | 'cancelled' | 'timeout' | 'invalid_output');
  if (['invalid_request', 'invalid_symbol'].includes(code)) return new CapabilityError('invalid_request');
  if (['unsupported_resolution', 'unsupported_adjustment', 'market_data_source_unavailable', 'unsupported_provider'].includes(code)) return new CapabilityError('field_unavailable');
  return new CapabilityError('tool_failed');
}

/** Named Router commands only; reservation closes the cancel-before-start race. */
export function createNativeMarketQueryPort(invoke: Invoke): MarketQueryPort {
  return { async execute(input, signal) {
    if (signal.aborted) throw new CapabilityError('cancelled');
    let cancel: (() => void) | undefined;
    try {
      const queryId = await invoke<string>('market_query_begin', { input });
      if (typeof queryId !== 'string' || !/^[0-9a-f]{32}$/.test(queryId)) throw new CapabilityError('invalid_output');
      let cancelled = false;
      cancel = () => {
        if (cancelled) return; cancelled = true;
        void invoke('market_query_cancel', { queryId }).catch(() => {});
      };
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) { cancel(); throw new CapabilityError('cancelled'); }
      const value = await invoke<unknown>('market_query_execute', { queryId });
      if (signal.aborted) throw new CapabilityError('cancelled');
      return value;
    } catch (error) { cancel?.(); throw marketQueryError(error); }
    finally { if (cancel) signal.removeEventListener('abort', cancel); }
  } };
}
