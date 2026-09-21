import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const requirePattern = (source, pattern, message) => {
  assert.match(source, pattern, message);
};
const requireAnyPattern = (source, patterns, message) => {
  assert.ok(patterns.some((pattern) => pattern.test(source)), message);
};

const frontend = read('src/main.ts');
const chartTimeControls = read('src/chart-time-controls.ts');
const timeNavigation = read('src/time-navigation.ts');
const markerState = read('src/marker-state.ts');
const contracts = read('src-tauri/src/contracts.rs');
const tdxHistory = read('src-tauri/src/market_data/history.rs');
const adapter = read('src-tauri/src/market_adapter.rs');
const realMarket = read('src-tauri/src/market_data/real_market.rs');
const realAdapters = read('src-tauri/src/market_data/real_adapters.rs');
const binance = read('src-tauri/src/market_providers/binance.rs');
const binanceClient = read('src-tauri/crates/binance-market-data/src/lib.rs');
const okx = read('src-tauri/src/market_providers/okx.rs');
const polymarket = read('src-tauri/src/market_providers/polymarket.rs');

// TradingView's stable wire values for fixed hour periods are minute counts.
// Keep this list deliberately narrow: 2h and 4h are required by the feature;
// 3h/6h/8h/12h remain an explicit follow-up decision until their market-session
// and provider evidence is available.
const requiredIntervals = [
  ['1', '1分'],
  ['5', '5分'],
  ['15', '15分'],
  ['30', '30分'],
  ['60', '1小时'],
  ['120', '2小时'],
  ['240', '4小时'],
  ['1D', '日'],
  ['1W', '周'],
  ['1M', '月'],
];

for (const [wire, label] of requiredIntervals) {
  requirePattern(
    chartTimeControls,
    new RegExp(`value: '${wire}'[\\s\\S]*?shortLabel: '${label.replace(' 分钟', '分').replace(' 小时', '小时')}'`),
    `fixed resolution option ${wire} (${label}) is missing`,
  );
}
requirePattern(frontend, /from ['"]\.\/chart-time-controls['"]/, 'frontend must consume the shared resolution contract');
requirePattern(chartTimeControls, /export type Resolution = [^;]*['"]120['"]/, 'frontend Resolution must include 120');
requirePattern(chartTimeControls, /export type Resolution = [^;]*['"]240['"]/, 'frontend Resolution must include 240');
requirePattern(frontend, /data-resolution/, 'frontend must keep a selectable resolution entry point');
assert.doesNotMatch(frontend, /添加自定义周期|自定义周期/, 'Lite must not expose custom-period UI');

requirePattern(timeNavigation, /['"]120['"]/, 'time navigation must treat 120 minutes as intraday');
requirePattern(timeNavigation, /['"]240['"]/, 'time navigation must treat 240 minutes as intraday');
requirePattern(markerState, /120/, 'marker scopes must accept the 120-minute resolution');
requirePattern(markerState, /240/, 'marker scopes must accept the 240-minute resolution');

for (const [variant, wire] of [['Minute120', '120'], ['Minute240', '240']]) {
  requireAnyPattern(
    contracts,
    [
      new RegExp(`\\#\\[serde\\(rename = "${wire}"\\)\\]\\s*${variant}`),
      new RegExp(`\\#\\[serde\\(rename = "${wire}"\\)\\]\\s*Hour${wire === '120' ? '2' : '4'}`),
    ],
    `Rust Resolution must serialize the ${wire}-minute wire value`,
  );
  requireAnyPattern(
    contracts,
    [
      new RegExp(`Self::${variant}\\s*=>\\s*"${wire}"`),
      new RegExp(`Self::Hour${wire === '120' ? '2' : '4'}\\s*=>\\s*"${wire}"`),
    ],
    `Rust Resolution::as_str must preserve ${wire}`,
  );
}

// TDX has no 120m/240m wire period. The history layer must explicitly derive
// both periods from one fixed 60m request; adding only enum/capability tokens is
// not sufficient and could silently issue an unsupported protocol request.
requirePattern(tdxHistory, /BarPeriod::Minute60/, 'TDX history must retain the 60-minute source period');
requireAnyPattern(
  tdxHistory,
  [/Minute120/, /Hour2/],
  'TDX history must handle the 120-minute derived period',
);
requireAnyPattern(
  tdxHistory,
  [/Minute240/, /Hour4/],
  'TDX history must handle the 240-minute derived period',
);
requirePattern(
  tdxHistory,
  /MAX_INTRADAY_AGGREGATION_SOURCE_BARS:\s*usize\s*=\s*u16::MAX as usize/,
  'TDX derived intraday history must allow enough 60-minute source bars for deep 120m/240m history',
);
requirePattern(
  tdxHistory,
  /fn intraday_source_count[\s\S]*Minute120\s*=>\s*2[\s\S]*Minute240\s*=>\s*4[\s\S]*saturating_mul\(source_bars_per_bar\)[\s\S]*saturating_add\(16\)/,
  'TDX 120m/240m source history sizing must scale from the requested target-bar count',
);
assert.doesNotMatch(
  tdxHistory,
  /MAX_PERIOD_AGGREGATION_SOURCE_BARS\.min\(query\.count\.saturating_mul\(source_bars_per_bar\)/,
  'TDX derived intraday history must not reuse the 8k week/month source cap',
);

// Every enabled provider is part of the public resolution contract. Their
// native/derived mapping is checked in their own source instead of relying on
// a frontend button that can produce a router-level unsupported_resolution.
for (const [name, source] of [
  ['TDX/provider descriptors', adapter],
  ['real TDX matrix', realMarket],
  ['real adapter matrix', realAdapters],
  ['Binance provider', binance],
  ['Binance client', binanceClient],
  ['OKX provider', okx],
  ['Polymarket provider', polymarket],
]) {
  requireAnyPattern(source, [/Resolution::Minute120/, /Resolution::Hour2/, /Interval::Hour2/, /"2H"/, /"120"/], `${name} must cover 120`);
  requireAnyPattern(source, [/Resolution::Minute240/, /Resolution::Hour4/, /Interval::Hour4/, /"4H"/, /"240"/], `${name} must cover 240`);
}

requirePattern(
  polymarket,
  /fn bucket_time\(timestamp: i64, resolution: Resolution\)[\s\S]*Resolution::Week[\s\S]*monday_offset[\s\S]*Resolution::Month[\s\S]*with_day\(1\)/,
  'Polymarket weekly/monthly probability buckets must use UTC calendar week/month boundaries',
);
requirePattern(
  polymarket,
  /unique\.insert\(bucket_time\(point\.t, request\.resolution\)/,
  'Polymarket historical probability points must use the resolution-aware calendar bucket helper',
);
requirePattern(
  polymarket,
  /bucket_time\(received_at, request\.resolution\)/,
  'Polymarket realtime probability points must use the same resolution-aware calendar bucket helper',
);

console.log('2h/4h fixed interval contract: OK');
