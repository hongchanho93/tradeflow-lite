import logoManifest from './symbol-logos.json' with { type: 'json' };
import type { MarketSymbol } from './market-universe';

const LOGO_CDN = 'https://s3-symbol-logo.tradingview.com';
// Official source: https://www.bse.cn/uploads/6/file/public/202509/20250916143055_4sxt0kkec4.pdf
// Keeping this crop local avoids the ambiguous TradingView `source/BSE` asset.
const BJSE_LOGO = new URL('./assets/bjse-logo.svg', import.meta.url).href;
const CRYPTO_MARKET_LOGO = new URL('./assets/crypto-market.svg', import.meta.url).href;
type ExchangeProvider = Exclude<MarketSymbol['exchange'], 'BINANCE' | 'BINANCE_USDM'>;
const manifest = logoManifest as {
  providers: Record<ExchangeProvider, string>;
  logos: Record<string, string>;
};

export type SymbolLogoUrls = {
  primary: string;
  fallback: string;
  hasIndividual: boolean;
};

export function exchangeLogoUrl(exchange: MarketSymbol['exchange']): string {
  if (exchange === 'BINANCE' || exchange === 'BINANCE_USDM') return CRYPTO_MARKET_LOGO;
  return exchange === 'BJ'
    ? BJSE_LOGO
    : `${LOGO_CDN}/${manifest.providers[exchange]}.svg`;
}

export function symbolLogoUrls(item: MarketSymbol): SymbolLogoUrls {
  const fallback = exchangeLogoUrl(item.exchange);
  const logoid = manifest.logos[`${item.symbol}:${item.kind}`];
  return {
    primary: logoid?.startsWith('https://') ? logoid : logoid ? `${LOGO_CDN}/${logoid}--big.svg` : fallback,
    fallback,
    hasIndividual: Boolean(logoid),
  };
}
