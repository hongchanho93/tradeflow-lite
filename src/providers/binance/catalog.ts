import type { MarketSymbol } from '../../market-universe';

export const binanceSpotSymbols: MarketSymbol[] = [
  { symbol: 'BINANCE:BTCUSDT', code: 'BTC/USDT', name: 'Bitcoin / TetherUS', exchange: 'BINANCE', providerId: 'binance_spot', providerDisplayName: 'Binance 现货', venue: 'BINANCE', realtime: true, quote: true, kind: 'crypto', baseAsset: 'BTC', quoteAsset: 'USDT', aliases: ['BTCUSDT', '比特币'] },
  { symbol: 'BINANCE:ETHUSDT', code: 'ETH/USDT', name: 'Ethereum / TetherUS', exchange: 'BINANCE', providerId: 'binance_spot', providerDisplayName: 'Binance 现货', venue: 'BINANCE', realtime: true, quote: true, kind: 'crypto', baseAsset: 'ETH', quoteAsset: 'USDT', aliases: ['ETHUSDT', '以太坊'] },
  { symbol: 'BINANCE:BNBUSDT', code: 'BNB/USDT', name: 'BNB / TetherUS', exchange: 'BINANCE', providerId: 'binance_spot', providerDisplayName: 'Binance 现货', venue: 'BINANCE', realtime: true, quote: true, kind: 'crypto', baseAsset: 'BNB', quoteAsset: 'USDT', aliases: ['BNBUSDT'] },
  { symbol: 'BINANCE:SOLUSDT', code: 'SOL/USDT', name: 'Solana / TetherUS', exchange: 'BINANCE', providerId: 'binance_spot', providerDisplayName: 'Binance 现货', venue: 'BINANCE', realtime: true, quote: true, kind: 'crypto', baseAsset: 'SOL', quoteAsset: 'USDT', aliases: ['SOLUSDT'] },
  { symbol: 'BINANCE:XRPUSDT', code: 'XRP/USDT', name: 'XRP / TetherUS', exchange: 'BINANCE', providerId: 'binance_spot', providerDisplayName: 'Binance 现货', venue: 'BINANCE', realtime: true, quote: true, kind: 'crypto', baseAsset: 'XRP', quoteAsset: 'USDT', aliases: ['XRPUSDT'] },
  { symbol: 'BINANCE:DOGEUSDT', code: 'DOGE/USDT', name: 'Dogecoin / TetherUS', exchange: 'BINANCE', providerId: 'binance_spot', providerDisplayName: 'Binance 现货', venue: 'BINANCE', realtime: true, quote: true, kind: 'crypto', baseAsset: 'DOGE', quoteAsset: 'USDT', aliases: ['DOGEUSDT', '狗狗币'] },
  { symbol: 'BINANCE:ADAUSDT', code: 'ADA/USDT', name: 'Cardano / TetherUS', exchange: 'BINANCE', providerId: 'binance_spot', providerDisplayName: 'Binance 现货', venue: 'BINANCE', realtime: true, quote: true, kind: 'crypto', baseAsset: 'ADA', quoteAsset: 'USDT', aliases: ['ADAUSDT'] },
  { symbol: 'BINANCE:TRXUSDT', code: 'TRX/USDT', name: 'TRON / TetherUS', exchange: 'BINANCE', providerId: 'binance_spot', providerDisplayName: 'Binance 现货', venue: 'BINANCE', realtime: true, quote: true, kind: 'crypto', baseAsset: 'TRX', quoteAsset: 'USDT', aliases: ['TRXUSDT'] },
  { symbol: 'BINANCE:AVAXUSDT', code: 'AVAX/USDT', name: 'Avalanche / TetherUS', exchange: 'BINANCE', providerId: 'binance_spot', providerDisplayName: 'Binance 现货', venue: 'BINANCE', realtime: true, quote: true, kind: 'crypto', baseAsset: 'AVAX', quoteAsset: 'USDT', aliases: ['AVAXUSDT'] },
  { symbol: 'BINANCE:LINKUSDT', code: 'LINK/USDT', name: 'Chainlink / TetherUS', exchange: 'BINANCE', providerId: 'binance_spot', providerDisplayName: 'Binance 现货', venue: 'BINANCE', realtime: true, quote: true, kind: 'crypto', baseAsset: 'LINK', quoteAsset: 'USDT', aliases: ['LINKUSDT'] },
];

export type BinanceSpotCatalogSymbol = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
};

export function buildBinanceSpotSymbols(rows: BinanceSpotCatalogSymbol[]): MarketSymbol[] {
  const curated = new Map(binanceSpotSymbols.map((item) => [item.symbol, item]));
  return rows.map((row) => curated.get(`BINANCE:${row.symbol}`) ?? ({
    symbol: `BINANCE:${row.symbol}`,
    code: `${row.baseAsset}/${row.quoteAsset}`,
    name: `${row.baseAsset} / ${row.quoteAsset}`,
    exchange: 'BINANCE',
    providerId: 'binance_spot',
    providerDisplayName: 'Binance 现货',
    venue: 'BINANCE',
    realtime: true,
    quote: true,
    kind: 'crypto',
    baseAsset: row.baseAsset,
    quoteAsset: row.quoteAsset,
    aliases: [row.symbol],
  }));
}
