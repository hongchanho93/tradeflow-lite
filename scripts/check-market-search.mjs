import { readFileSync } from 'node:fs';
import { listMarketSymbols, marketSymbolMatchesSource, searchMarketSymbols } from '../src/market-universe.ts';

const marketPackage = JSON.parse(readFileSync(new URL('../src/market-universe.json', import.meta.url), 'utf8'));
const rows = marketPackage.rows;

const stock = searchMarketSymbols(rows, '600000')[0];
if (stock?.symbol !== 'SH:600000' || stock.kind !== 'stock') throw new Error('stock code search failed');
if (searchMarketSymbols(rows, '浦发银行')[0]?.symbol !== 'SH:600000') throw new Error('Chinese name search failed');
if (searchMarketSymbols(rows, 'PAYH')[0]?.symbol !== 'SZ:000001') throw new Error('alias search failed');
const exactIndex = searchMarketSymbols(rows, 'SH:000001')[0];
if (exactIndex?.kind !== 'index') throw new Error('exchange-qualified index search failed');
const ambiguous = searchMarketSymbols(rows, '000001', 10);
if (!ambiguous.some((item) => item.symbol === 'SZ:000001' && item.kind === 'stock')) throw new Error('ambiguous stock result missing');
if (!ambiguous.some((item) => item.symbol === 'SH:000001' && item.kind === 'index')) throw new Error('ambiguous index result missing');
if (searchMarketSymbols(rows, '').length !== 0) throw new Error('empty search must have no results');

const fixtures = [
  { symbol: 'SH:600000', code: '600000', name: '浦发银行', exchange: 'SH', kind: 'stock' },
  { symbol: 'SH:688001', code: '688001', name: '科创样本', exchange: 'SH', kind: 'stock' },
  { symbol: 'SZ:000001', code: '000001', name: '平安银行', exchange: 'SZ', kind: 'stock' },
  { symbol: 'SZ:302132', code: '302132', name: '创业样本', exchange: 'SZ', kind: 'stock' },
  { symbol: 'BJ:920000', code: '920000', name: '北交样本', exchange: 'BJ', kind: 'stock' },
  { symbol: 'SH:000001', code: '000001', name: '上证指数', exchange: 'SH', kind: 'index' },
  { symbol: 'SZ:159915', code: '159915', name: '创业板ETF', exchange: 'SZ', kind: 'etf' },
];
if (!marketSymbolMatchesSource(fixtures[3], 'stock', 'chinext')) throw new Error('302 stock must be classified as ChiNext');
if (marketSymbolMatchesSource(fixtures[1], 'stock', 'sh_main')) throw new Error('STAR stock leaked into SH main board');
if (listMarketSymbols(fixtures, '', 'stock', 'star', 20)[0]?.symbol !== 'SH:688001') throw new Error('stock secondary filter failed');
if (listMarketSymbols(fixtures, '000001', 'index', 'all', 20)[0]?.kind !== 'index') throw new Error('primary category filter failed');
if (listMarketSymbols(fixtures, '', 'etf', 'sz', 20)[0]?.symbol !== 'SZ:159915') throw new Error('ETF exchange filter failed');
if (listMarketSymbols(rows, '899050', 'index', 'bj', rows.length)[0]?.symbol !== 'BJ:899050') throw new Error('BJ index missing from search');
if (listMarketSymbols(rows, '', 'stock', 'all', rows.length).length <= 80) throw new Error('full stock browse result was truncated');

console.log(`Market search OK (${rows.length} instruments)`);
