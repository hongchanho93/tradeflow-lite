import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CHART_PREFERENCES_STORAGE_KEY,
  DEFAULT_CHART_PREFERENCES,
  loadChartPreferences,
  moveMainSeriesOrder,
  movePaneOrder,
  saveChartPreferences,
} from '../src/chart-controls.ts';
import { boll, bollBreakouts, ema, macd, rsi, sma } from '../src/indicators.ts';

const rounded = (values) => values.map((value) => value === null ? null : Number(value.toFixed(6)));
const assertRounded = (actual, expected, message) => assert.deepEqual(rounded(actual), expected, message);

// These expected values are hand-computed from the public indicator contract.
// They intentionally do not call another implementation as an oracle.
assertRounded(
  sma([10, 12, 11, 15, 14, 16], 3),
  [null, null, 11, 12.666667, 13.333333, 15],
  'MA uses a trailing simple average with a period-sized warm-up',
);
assertRounded(
  ema([10, 12, 11, 15, 14, 16], 3),
  [null, null, 11, 13, 13.5, 14.75],
  'EMA seeds from the first period SMA and then applies the recurrence',
);
assert.deepEqual(sma([1, 2], 0), [null, null], 'an invalid MA period produces no values');
assert.deepEqual(ema([1, 2], 3), [null, null], 'EMA stays empty until its full seed period exists');

const rsiFixture = [
  100, 101, 100, 101, 100, 101, 100, 101,
  100, 101, 100, 101, 100, 101, 100, 102, 100,
];
assertRounded(
  rsi(rsiFixture, 14),
  Array(14).fill(null).concat([50, 56.666667, 49.55157]),
  'RSI uses Wilder smoothing and starts after the initial change window',
);
assert.deepEqual(rsi([1, 2, 3], 0), [null, null, null], 'an invalid RSI period produces no values');

const bollFixture = boll([10, 12, 11, 15, 14], 3, 2);
assertRounded(bollFixture.middle, [null, null, 11, 12.666667, 13.333333], 'BOLL middle line is the SMA');
assertRounded(bollFixture.upper, [null, null, 12.632993, 16.066013, 16.73268], 'BOLL upper line uses population deviation');
assertRounded(bollFixture.lower, [null, null, 9.367007, 9.26732, 9.933987], 'BOLL lower line uses population deviation');

const compactMacd = macd([1, 2, 4, 3, 6, 5, 8], 2, 3, 2);
assertRounded(
  compactMacd.dif,
  [null, null, 0.833333, 0.388889, 0.685185, 0.339506, 0.668724],
  'MACD DIF is fast EMA minus slow EMA with independent warm-ups',
);
assertRounded(
  compactMacd.dea,
  [null, null, null, 0.611111, 0.660494, 0.446502, 0.59465],
  'MACD DEA starts after the signal period of valid DIF values',
);
assertRounded(
  compactMacd.histogram,
  [null, null, null, -0.444444, 0.049383, -0.213992, 0.148148],
  'MACD histogram is twice DIF minus DEA',
);

const defaultMacd = macd([
  10, 12, 11, 15, 14, 16, 18, 17, 20, 19, 21, 23, 22, 24, 26, 25, 27, 29, 28, 30,
  32, 31, 33, 35, 34, 36, 38, 37, 39, 41, 40, 42, 44, 43, 45,
]);
assert.equal(defaultMacd.dif.slice(0, 25).every((value) => value === null), true, 'default MACD DIF has a 26-bar slow warm-up');
assertRounded(defaultMacd.dif.slice(25, 27), [7.03781, 7.12097], 'default MACD DIF remains numerically stable');
assert.equal(defaultMacd.dea.slice(0, 33).every((value) => value === null), true, 'default MACD DEA has a signal warm-up');
assertRounded(defaultMacd.dea.slice(33, 35), [7.05299, 7.045047], 'default MACD DEA output is stable');
assertRounded(defaultMacd.histogram.slice(33, 35), [-0.088861, -0.063541], 'default MACD histogram output is stable');

const breakoutCloses = [9, 11, 12, 8, 6, 6, 12];
const breakoutUpper = [10, 10, 11, 11, 10, 10, 10];
const breakoutLower = [7, 7, 7, 7, 7, 7, 7];
const breakoutSignals = bollBreakouts(breakoutCloses, breakoutUpper, breakoutLower);
assert.deepEqual(
  breakoutSignals,
  [null, 'upper', null, null, 'lower', null, 'upper'],
  'BOLL emits only the first close crossing outside a band',
);
assert.deepEqual(
  bollBreakouts([9, 11], [null, 10], [null, 7]),
  [null, null],
  'BOLL does not signal until both previous and current bands are valid',
);

const bollMarkerProjection = breakoutSignals.flatMap((signal, index) => {
  if (signal === 'upper') return [{ index, position: 'aboveBar', shape: 'arrowUp', color: '#f6c344', text: '突破上轨' }];
  if (signal === 'lower') return [{ index, position: 'belowBar', shape: 'arrowDown', color: '#2962ff', text: '跌破下轨' }];
  return [];
});
assert.deepEqual(
  bollMarkerProjection,
  [
    { index: 1, position: 'aboveBar', shape: 'arrowUp', color: '#f6c344', text: '突破上轨' },
    { index: 4, position: 'belowBar', shape: 'arrowDown', color: '#2962ff', text: '跌破下轨' },
    { index: 6, position: 'aboveBar', shape: 'arrowUp', color: '#f6c344', text: '突破上轨' },
  ],
  'BOLL marker projection preserves first-crossing direction, text, and colors',
);

const macdHistogramColors = compactMacd.histogram
  .filter((value) => value !== null)
  .map((value) => value >= 0 ? 'rgba(8, 153, 129, .6)' : 'rgba(242, 54, 69, .6)');
assert.deepEqual(
  macdHistogramColors,
  ['rgba(242, 54, 69, .6)', 'rgba(8, 153, 129, .6)', 'rgba(242, 54, 69, .6)', 'rgba(8, 153, 129, .6)'],
  'MACD histogram uses green for non-negative values and red for negative values',
);

const preferenceStorageValues = new Map();
const preferenceStorage = {
  getItem: (key) => preferenceStorageValues.get(key) ?? null,
  setItem: (key, value) => preferenceStorageValues.set(key, value),
};
const baselinePreferences = {
  chartType: 'candles',
  priceScale: 'normal',
  priceScaleInverted: false,
  paneOrder: ['rsi', 'macd'],
  activeSeries: ['volume', 'ma', 'ema', 'boll', 'macd', 'rsi'],
  hiddenSeries: ['ema'],
  mainSeriesOrder: ['ema', 'volume', 'ma', 'boll'],
  priceLines: {},
};
assert.equal(saveChartPreferences(preferenceStorage, baselinePreferences), true, 'indicator layout preferences save successfully');
assert.deepEqual(
  loadChartPreferences(preferenceStorage),
  baselinePreferences,
  'active, hidden, main-order, and pane-order state round-trips without loss',
);
assert.deepEqual(
  moveMainSeriesOrder(['volume', 'ma', 'ema', 'boll'], 'ema', -1),
  ['volume', 'ema', 'ma', 'boll'],
  'main chart order moves an indicator by one slot',
);
assert.deepEqual(
  moveMainSeriesOrder(['volume', 'ma', 'ema', 'boll'], 'volume', -1),
  ['volume', 'ma', 'ema', 'boll'],
  'main chart order does not move past its first slot',
);
assert.deepEqual(movePaneOrder(['macd', 'rsi'], 'rsi', -1), ['rsi', 'macd'], 'secondary panes move by one slot');
assert.deepEqual(movePaneOrder(['macd', 'rsi'], 'macd', -1), ['macd', 'rsi'], 'secondary panes do not move past their first slot');
preferenceStorageValues.set(CHART_PREFERENCES_STORAGE_KEY, JSON.stringify({
  version: 2,
  ...baselinePreferences,
  activeSeries: ['ma'],
  hiddenSeries: ['rsi'],
}));
assert.deepEqual(
  loadChartPreferences(preferenceStorage),
  DEFAULT_CHART_PREFERENCES,
  'hidden indicator state that is not active is rejected instead of being applied',
);

// The application entry point is a browser module with chart and DOM side effects,
// so importing main.ts in Node would not exercise its behavior. The following
// small source contracts are limited to the unexported wiring that cannot be
// reached through the existing pure modules. Formula and state semantics above
// remain runtime assertions against the real exported implementations.
const mainSource = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function skipQuotedOrCommented(source, index) {
  const quote = source[index];
  if (quote !== "'" && quote !== '"' && quote !== '`') return index;
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') { cursor += 1; continue; }
    if (source[cursor] === quote) return cursor;
  }
  return source.length - 1;
}

function findFunctionSource(name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(mainSource);
  assert.ok(declaration, `main.ts must retain ${name} for the baseline contract`);
  let bodyStart = -1;
  let parenDepth = 0;
  for (let index = declaration.index; index < mainSource.length; index += 1) {
    const character = mainSource[index];
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuotedOrCommented(mainSource, index);
      continue;
    }
    if (character === '/' && mainSource[index + 1] === '/') {
      const lineEnd = mainSource.indexOf('\n', index + 2);
      index = lineEnd < 0 ? mainSource.length : lineEnd;
      continue;
    }
    if (character === '/' && mainSource[index + 1] === '*') {
      const commentEnd = mainSource.indexOf('*/', index + 2);
      index = commentEnd < 0 ? mainSource.length : commentEnd + 1;
      continue;
    }
    if (character === '(') parenDepth += 1;
    if (character === ')') parenDepth -= 1;
    if (character === '{' && parenDepth === 0) { bodyStart = index; break; }
  }
  assert.notEqual(bodyStart, -1, `${name} must have a function body`);

  let depth = 0;
  for (let index = bodyStart; index < mainSource.length; index += 1) {
    const character = mainSource[index];
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuotedOrCommented(mainSource, index);
      continue;
    }
    if (character === '/' && mainSource[index + 1] === '/') {
      const lineEnd = mainSource.indexOf('\n', index + 2);
      index = lineEnd < 0 ? mainSource.length : lineEnd;
      continue;
    }
    if (character === '/' && mainSource[index + 1] === '*') {
      const commentEnd = mainSource.indexOf('*/', index + 2);
      index = commentEnd < 0 ? mainSource.length : commentEnd + 1;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return mainSource.slice(declaration.index, index + 1);
    }
  }
  assert.fail(`${name} function body is not balanced`);
}

function findFunction(name) {
  return findFunctionSource(name);
}

function functionText(name) {
  return findFunction(name);
}

function normalizedFunctionText(name) {
  return functionText(name).replace(/\s+/g, ' ');
}

const builtinSources = new Map();
for (const file of ['ma', 'ema', 'boll', 'macd', 'rsi']) {
  const source = fs.readFileSync(new URL(`../src/indicator-plugins/builtins/${file}.indicator.ts`, import.meta.url), 'utf8');
  builtinSources.set(file, source);
  assert.match(source, new RegExp(`id: 'builtin\\.${file}'`));
  assert.match(source, /\.setValues\(/, `${file.toUpperCase()} renders through the SDK series layer`);
}
assert.match(builtinSources.get('ma'), /period: \{[^}]*default: 20/);
assert.match(builtinSources.get('ema'), /period: \{[^}]*default: 20/);
assert.match(builtinSources.get('boll'), /period: \{[^}]*default: 20/);
assert.match(builtinSources.get('boll'), /multiplier: \{[^}]*default: 2/);
assert.match(builtinSources.get('macd'), /fast: \{[^}]*default: 12/);
assert.match(builtinSources.get('macd'), /slow: \{[^}]*default: 26/);
assert.match(builtinSources.get('macd'), /signal: \{[^}]*default: 9/);
assert.match(builtinSources.get('rsi'), /period: \{[^}]*default: 14/);
const macdSource = builtinSources.get('macd');
assert.match(
  macdSource,
  /value >= 0 \? 'rgba\(8, 153, 129, \.6\)' : 'rgba\(242, 54, 69, \.6\)'/,
  'MACD preserves its per-point histogram sign colors',
);
assert.match(mainSource, /new IndicatorRegistry\(builtinIndicators\)/, 'built-ins register through the public registry');
assert.match(functionText('renderIndicatorPicker'), /indicatorRegistry\.list\(\)/, 'the picker is registry-driven');
assert.match(functionText('renderIndicatorPicker'), /indicatorRuntime\.isApplicable/, 'the picker explains incompatible indicators');
assert.match(mainSource, /indicator\.bar_styles\.batch_refresh/, 'large bar-style invalidations use an observable batch refresh');
assert.match(functionText('renderDrawingManager'), /orderedIndicatorInstances\(\)/, 'the object tree is instance-driven');
assert.match(functionText('applyIndicatorInstanceOrder'), /applyInstancePaneOrder/, 'instance ordering also reorders SDK panes');

console.log('Indicator SDK baseline OK');
