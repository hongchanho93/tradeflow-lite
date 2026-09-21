import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { setStatusLabel } from '../src/status-label.ts';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
assert.doesNotMatch(
  main,
  /status\.querySelector\('span'\)!\.textContent\s*=/,
  'status updates must not bypass visible/aria synchronization',
);
assert.doesNotMatch(
  main,
  /status\.setAttribute\('aria-label'/,
  'status aria-label updates must use the shared status helper',
);
assert.match(
  readFileSync(new URL('../src/status-label.ts', import.meta.url), 'utf8'),
  /status\.title = text/,
  'status helper must clear stale tooltip text as well',
);
assert.ok(
  (main.match(/setStatusLabel\(status,/g) ?? []).length >= 10,
  'all visible status update points must synchronize the aria-label',
);

const span = { textContent: '正在连接' };
const attributes = new Map();
const status = {
  title: '旧 Binance USD-M WebSocket 状态',
  querySelector(selector) {
    assert.equal(selector, 'span');
    return span;
  },
  setAttribute(name, value) {
    attributes.set(name, value);
  },
};

for (const text of [
  'Binance 现货 · data-api.binance.vision · 2ms',
  '实时 · Binance USD-M 永续 WS',
  '通达信主站 · 117.34.114.15:7709 · 2ms',
]) {
  setStatusLabel(status, text);
  assert.equal(span.textContent, text, 'visible status must follow the selected provider');
  assert.equal(attributes.get('aria-label'), text, 'aria-label must match visible status');
  assert.equal(status.title, text, 'title must follow the selected provider');
}

assert.equal(span.textContent, '通达信主站 · 117.34.114.15:7709 · 2ms');
assert.equal(attributes.get('aria-label'), span.textContent);
assert.equal(status.title, span.textContent);
assert.equal(span.textContent.includes('USD-M'), false, 'old USD-M text must not remain visible');
assert.equal(attributes.get('aria-label').includes('USD-M'), false, 'old USD-M aria text must not remain');
assert.equal(span.textContent.includes('WS'), false, 'old WebSocket state must not remain visible');
assert.equal(attributes.get('aria-label').includes('WS'), false, 'old WebSocket aria state must not remain');
assert.equal(status.title.includes('USD-M'), false, 'old USD-M tooltip state must not remain');
assert.equal(status.title.includes('WS'), false, 'old WebSocket tooltip state must not remain');

console.log('Status accessibility contract OK');
