import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isUsableQuote, matchesQuoteResponse, quoteBookLevels, shouldFetchStandaloneQuote } from '../src/quote.ts';
import { isUsableTdxRecentTrades } from '../src/tdx-trades.ts';

const quote = {
  last: 10.2,
  previousClose: 10,
  open: 10.1,
  high: 10.3,
  low: 9.9,
  volume: 100,
  amount: 1_000,
  receivedAt: 1_789_196_400,
};
assert.equal(isUsableQuote(quote), true);
assert.equal(isUsableQuote({ ...quote, last: 0 }), false);
assert.equal(isUsableQuote({ ...quote, high: 9.8, low: 9.9 }), false);
assert.equal(isUsableQuote({ ...quote, amount: Number.NaN }), false);
assert.equal(isUsableQuote({ ...quote, open: 0, high: 0, low: 0 }), true, 'pre-open zero OHLC remains usable');
const depthQuote = {
  ...quote,
  bids: [{ price: 10.19, quantity: 12 }, { price: 10.18, quantity: 24 }],
  asks: [{ price: 10.21, quantity: 16 }, { price: 10.22, quantity: 32 }],
};
assert.deepEqual(quoteBookLevels(depthQuote), { bids: depthQuote.bids, asks: depthQuote.asks });
assert.equal(isUsableQuote(depthQuote), true, 'valid five-level quote remains usable');
assert.equal(quoteBookLevels(quote), null, 'providers without snapshot depth remain supported');
assert.equal(isUsableQuote({ ...depthQuote, bids: [...depthQuote.bids].reverse() }), false, 'reversed bids are rejected');
assert.equal(isUsableQuote({ ...depthQuote, asks: [{ price: 10.21, quantity: -1 }] }), false, 'negative depth size is rejected');
assert.equal(shouldFetchStandaloneQuote(false, true), true, 'missing history quote fetches standalone quote');
assert.equal(shouldFetchStandaloneQuote(true, true), false, 'history quote must not trigger another request');
assert.equal(shouldFetchStandaloneQuote(false, false), false, 'provider without quote capability must not fetch');
const response = { providerId: 'tdx', symbol: 'SH:600000' };
assert.equal(matchesQuoteResponse(response, 'tdx', 'SH:600000'), true);
assert.equal(matchesQuoteResponse({ ...response, providerId: 'other' }, 'tdx', 'SH:600000'), false, 'old provider response is stale');
assert.equal(matchesQuoteResponse({ ...response, symbol: 'SZ:000001' }, 'tdx', 'SH:600000'), false, 'old symbol response is stale');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
assert.match(mainSource, /symbol\.providerId === 'tdx'[\s\S]*symbol\.kind === 'stock'[\s\S]*symbol\.kind === 'etf'[\s\S]*providerSupportsQuote\(symbol\)/, 'TDX stock and ETF quote capability exposes polled depth');
assert.match(mainSource, /applyQuoteDepth\(latestQuote, symbol, resolution\)/, 'latest quote refreshes the visible depth');
assert.match(mainSource, /if \(currentQuote\) applyQuoteDepth\(currentQuote, symbol, resolution\)/, 'history quote hydrates initial depth');
const tradesResponse = {
  providerId: 'tdx',
  symbol: 'SH:600000',
  source: 'tradeflow-tdx-transactions',
  receivedAt: 1_789_528_800,
  trades: [
    { tradeId: 1_789_528_720_000_000, tradeTimeMs: 1_789_528_720_000, price: 9.02, quantity: 16, transactionCount: 3, side: 'sell' },
    { tradeId: 1_789_528_720_000_001, tradeTimeMs: 1_789_528_720_000, price: 9.03, quantity: 40, transactionCount: 1, side: 'buy' },
  ],
};
assert.equal(isUsableTdxRecentTrades(tradesResponse, 'tdx', 'SH:600000'), true);
assert.equal(isUsableTdxRecentTrades({ ...tradesResponse, symbol: 'SZ:000001' }, 'tdx', 'SH:600000'), false, 'stale symbol trades are rejected');
assert.equal(isUsableTdxRecentTrades({ ...tradesResponse, trades: [...tradesResponse.trades].reverse() }, 'tdx', 'SH:600000'), true, 'same-minute trades preserve source order');
assert.equal(isUsableTdxRecentTrades({ ...tradesResponse, trades: [{ ...tradesResponse.trades[0], price: 0 }] }, 'tdx', 'SH:600000'), false, 'invalid trade prices are rejected');
assert.match(mainSource, /invoke<TdxRecentTradesResponse>\('get_tdx_recent_trades'/, 'TDX trade snapshots use the dedicated protocol command');
assert.match(mainSource, /await refreshTdxRecentTrades\(symbol, resolution, adjustment, generation\)/, 'market polling refreshes TDX trades');
assert.match(mainSource, /count: 800/, 'TDX trade polling keeps enough overlap for active symbols');
assert.match(mainSource, /response\.trades\.slice\(-100\)/, 'the UI remains bounded to the latest 100 trades');
assert.match(mainSource, /trade\.providerId === 'tdx' \? shanghaiTradeTimeFormatter/, 'TDX trades render in exchange time instead of the computer time zone');
console.log('Quote validation OK');
