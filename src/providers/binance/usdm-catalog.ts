import type { MarketSymbol } from '../../market-universe';

export const binanceUsdMarginedSymbols: MarketSymbol[] = [
  { symbol: 'BINANCE_USDM:BTCUSDT', code: 'BTC/USDT 永续', name: 'Bitcoin / TetherUS Perpetual', exchange: 'BINANCE_USDM', providerId: 'binance_usdm', providerDisplayName: 'Binance USD-M 永续', venue: 'BINANCE_USDM', realtime: true, quote: true, kind: 'crypto', baseAsset: 'BTC', quoteAsset: 'USDT', aliases: ['BTCUSDT', 'BTC永续', '比特币永续'] },
  { symbol: 'BINANCE_USDM:ETHUSDT', code: 'ETH/USDT 永续', name: 'Ethereum / TetherUS Perpetual', exchange: 'BINANCE_USDM', providerId: 'binance_usdm', providerDisplayName: 'Binance USD-M 永续', venue: 'BINANCE_USDM', realtime: true, quote: true, kind: 'crypto', baseAsset: 'ETH', quoteAsset: 'USDT', aliases: ['ETHUSDT', 'ETH永续', '以太坊永续'] },
  { symbol: 'BINANCE_USDM:BNBUSDT', code: 'BNB/USDT 永续', name: 'BNB / TetherUS Perpetual', exchange: 'BINANCE_USDM', providerId: 'binance_usdm', providerDisplayName: 'Binance USD-M 永续', venue: 'BINANCE_USDM', realtime: true, quote: true, kind: 'crypto', baseAsset: 'BNB', quoteAsset: 'USDT', aliases: ['BNBUSDT', 'BNB永续'] },
  { symbol: 'BINANCE_USDM:SOLUSDT', code: 'SOL/USDT 永续', name: 'Solana / TetherUS Perpetual', exchange: 'BINANCE_USDM', providerId: 'binance_usdm', providerDisplayName: 'Binance USD-M 永续', venue: 'BINANCE_USDM', realtime: true, quote: true, kind: 'crypto', baseAsset: 'SOL', quoteAsset: 'USDT', aliases: ['SOLUSDT', 'SOL永续'] },
  { symbol: 'BINANCE_USDM:XRPUSDT', code: 'XRP/USDT 永续', name: 'XRP / TetherUS Perpetual', exchange: 'BINANCE_USDM', providerId: 'binance_usdm', providerDisplayName: 'Binance USD-M 永续', venue: 'BINANCE_USDM', realtime: true, quote: true, kind: 'crypto', baseAsset: 'XRP', quoteAsset: 'USDT', aliases: ['XRPUSDT', 'XRP永续'] },
];

export type BinanceUsdMarginedCatalogSymbol = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
};

export function buildBinanceUsdMarginedSymbols(
  rows: BinanceUsdMarginedCatalogSymbol[],
): MarketSymbol[] {
  const curated = new Map(binanceUsdMarginedSymbols.map((item) => [item.symbol, item]));
  return rows.map((row) => curated.get(`BINANCE_USDM:${row.symbol}`) ?? ({
    symbol: `BINANCE_USDM:${row.symbol}`,
    code: `${row.baseAsset}/${row.quoteAsset} 永续`,
    name: `${row.baseAsset} / ${row.quoteAsset} Perpetual`,
    exchange: 'BINANCE_USDM',
    providerId: 'binance_usdm',
    providerDisplayName: 'Binance USD-M 永续',
    venue: 'BINANCE_USDM',
    realtime: true,
    quote: true,
    kind: 'crypto',
    baseAsset: row.baseAsset,
    quoteAsset: row.quoteAsset,
    aliases: [row.symbol, `${row.baseAsset}永续`],
  }));
}
