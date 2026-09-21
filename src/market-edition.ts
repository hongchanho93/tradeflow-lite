import type { MarketProviderDescriptor, MarketSearchSource } from './market-universe';

export type MarketEdition = 'cn' | 'global' | 'core' | 'custom';

export type MarketEditionInfo = {
  edition: MarketEdition;
  defaultEnabledProviderIds: string[];
};

export const MARKET_PROVIDER_PREFERENCES_PREFIX = 'tradeflow-lite.market-providers';

export function marketProviderPreferencesKey(edition: MarketEdition): string {
  return `${MARKET_PROVIDER_PREFERENCES_PREFIX}.${edition}.v1`;
}

export function providerIsAvailable(descriptor: MarketProviderDescriptor): boolean {
  const capabilities = descriptor.capabilities;
  return capabilities.catalog || capabilities.history || capabilities.quote || capabilities.realtime;
}

export function showTdxAdjustmentControls(
  descriptor: MarketProviderDescriptor | undefined,
  providerId: string,
): boolean {
  return providerId === 'tdx'
    && descriptor?.enabled === true
    && descriptor.capabilities.adjustments.includes('qfq');
}

export function loadMarketProviderPreferences(
  storage: Pick<Storage, 'getItem'>,
  edition: MarketEdition,
  descriptors: readonly MarketProviderDescriptor[],
): Set<string> | null {
  const raw = storage.getItem(marketProviderPreferencesKey(edition));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) return null;
    const available = new Set(descriptors.filter(providerIsAvailable).map((descriptor) => descriptor.id));
    return new Set(parsed.filter((providerId) => available.has(providerId)));
  } catch {
    return null;
  }
}

export function saveMarketProviderPreferences(
  storage: Pick<Storage, 'setItem'>,
  edition: MarketEdition,
  providerIds: Iterable<string>,
): boolean {
  try {
    storage.setItem(marketProviderPreferencesKey(edition), JSON.stringify([...new Set(providerIds)].sort()));
    return true;
  } catch {
    return false;
  }
}

export function enabledProviderIds(descriptors: readonly MarketProviderDescriptor[]): Set<string> {
  return new Set(descriptors.filter((descriptor) => descriptor.enabled).map((descriptor) => descriptor.id));
}

export function marketProviderSelectionChanged(
  requested: ReadonlySet<string>,
  active: ReadonlySet<string>,
): boolean {
  return requested.size !== active.size || [...requested].some((providerId) => !active.has(providerId));
}

export function providerForMarketSource(source: MarketSearchSource): string | null {
  if (source === 'all') return null;
  if (source === 'sh' || source === 'sz' || source === 'bj'
    || source === 'sh_main' || source === 'star' || source === 'sz_main' || source === 'chinext') return 'tdx';
  if (source === 'polymarket') return 'polymarket';
  if (source.startsWith('binance_usdm')) return 'binance_usdm';
  if (source.startsWith('binance_')) return 'binance_spot';
  if (source.startsWith('okx_swap')) return 'okx_swap';
  if (source.startsWith('okx_spot')) return 'okx_spot';
  return null;
}
