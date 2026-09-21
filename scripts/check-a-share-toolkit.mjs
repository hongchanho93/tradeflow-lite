import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const [{ default: definition }, { createIndicatorTestHarness }, { IndicatorRegistry }] = await Promise.all([
    server.ssrLoadModule('/src/indicator-plugins/examples/a-share-toolkit.indicator.example.ts'),
    server.ssrLoadModule('/src/indicator-sdk/testing.ts'),
    server.ssrLoadModule('/src/indicator-sdk/registry.ts'),
  ]);
  const registry = new IndicatorRegistry([definition]);
  assert.equal(registry.get('user.a-share-toolkit'), definition, 'the user plugin passes the production registry contract');
  const pluginIndex = readFileSync(new URL('../src/indicator-plugins/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(pluginIndex, /examples/,
    'example indicators must not be discovered by the production plugin loader');
  assert.equal('priceTick' in definition.inputs, false, 'A-share plugins use SDK instrument tick metadata');
  const harness = createIndicatorTestHarness(definition, {
    inputs: { tablePosition: 'middle-left', showLimitLines: true },
  });
  const day = 86_400;
  const start = Math.floor(Date.now() / 1000 / day) * day - 3 * day;
  const bars = [
    { time: start, open: 10, high: 10, low: 10, close: 10, volume: 100 },
    { time: start + day, open: 11, high: 11, low: 11, close: 11, volume: 110 },
    { time: start + 2 * day, open: 12.1, high: 12.1, low: 12.1, close: 12.1, volume: 120 },
  ];
  harness.update({ bars, reason: 'initial', changedFrom: 0 });
  assert.deepEqual(harness.series('up-limit').points.map((point) => point.value), [undefined, 11, 12.1]);
  const markers = harness.markers('limit-events');
  assert.deepEqual(markers.map((marker) => marker.text), ['一字涨停', '一字涨停']);
  assert.ok(markers.every((marker) => marker.position === 'atPriceTop' && marker.price === bars.find((bar) => bar.time === marker.time).high));
  assert.ok(markers.every((marker) => marker.tooltip && marker.textColor), 'event markers expose tooltip and text color');
  assert.equal(harness.overlay('information').definition.position, 'middle-left');
  assert.match(harness.overlay('information').root.innerHTML, /12\.10/);
  assert.deepEqual(harness.barStyle('limit-bars', bars[2], 2), {
    color: '#FF9800', borderColor: '#FF9800', wickColor: '#FF9800',
  });
  harness.dispose();
  console.log('A-share toolkit SDK harness checks passed');
} finally {
  await server.close();
}
