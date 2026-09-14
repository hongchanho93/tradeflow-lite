import { readFileSync } from 'node:fs';
import { symbolLogoUrls } from '../src/symbol-logos.ts';

const marketPackage = JSON.parse(readFileSync(new URL('../src/market-universe.json', import.meta.url), 'utf8'));
const logos = JSON.parse(readFileSync(new URL('../src/symbol-logos.json', import.meta.url), 'utf8'));

if (logos.source !== 'tradingview-symbol-search-v3+10jqka-company-pages') throw new Error('unexpected logo manifest source');
if (!logos.logos['SH:600000:stock']) throw new Error('stock logo missing');
if (!logos.logos['SZ:159915:etf']) throw new Error('ETF logo missing');
if (!logos.logos['SZ:399001:index']) throw new Error('index logo missing');
if (!logos.logos['BJ:920000:stock']?.startsWith('https://basic.10jqka.com.cn/ai_data/logo/company/')) {
  throw new Error('Beijing stock company logo missing');
}
if (logos.logos['BJ:920000:stock'] === logos.logos['BJ:920001:stock']) {
  throw new Error('Beijing stock logos should be company-specific');
}

for (const item of marketPackage.rows) {
  const urls = symbolLogoUrls(item);
  if (item.exchange === 'BJ') {
    if (!urls.fallback.endsWith('/assets/bjse-logo.svg')) throw new Error(`invalid Beijing exchange fallback: ${item.symbol}`);
    if (item.kind === 'index' && urls.primary !== urls.fallback) throw new Error(`Beijing index should use its exchange fallback: ${item.symbol}`);
  } else if (!urls.fallback.startsWith('https://s3-symbol-logo.tradingview.com/source/')) {
    throw new Error(`invalid exchange fallback: ${item.symbol}`);
  }
  if (item.exchange !== 'BJ' && !urls.primary.startsWith('https://s3-symbol-logo.tradingview.com/')) {
    throw new Error(`invalid primary logo URL: ${item.symbol}`);
  }
}

const distinctLogos = new Set(Object.values(logos.logos));
if (distinctLogos.size < 500) throw new Error(`logo coverage unexpectedly low: ${distinctLogos.size}`);

const beijingStocks = marketPackage.rows.filter((item) => item.exchange === 'BJ' && item.kind === 'stock');
const beijingCompanyLogos = beijingStocks.filter((item) => symbolLogoUrls(item).hasIndividual);
if (beijingCompanyLogos.length < 340) throw new Error(`Beijing stock logo coverage unexpectedly low: ${beijingCompanyLogos.length}`);

console.log(`Symbol logos OK (${Object.keys(logos.logos).length}/${marketPackage.rows.length} individual, all with exchange fallback)`);
