import assert from 'node:assert/strict';

import {
  APP_LOCALES,
  DEFAULT_APP_LOCALE,
  loadAppLocale,
  saveAppLocale,
  translateUiText,
} from '../src/i18n.ts';

assert.deepEqual(APP_LOCALES, ['zh-CN', 'en-US']);
assert.equal(DEFAULT_APP_LOCALE, 'zh-CN');
assert.equal(loadAppLocale({ getItem: () => null }), 'zh-CN');
assert.equal(loadAppLocale({ getItem: () => 'en-US' }), 'en-US');
assert.equal(loadAppLocale({ getItem: () => 'fr-FR' }), 'zh-CN');
assert.equal(loadAppLocale({ getItem: () => { throw new Error('blocked'); } }), 'zh-CN');

const values = new Map();
assert.equal(saveAppLocale({ setItem: (key, value) => values.set(key, value) }, 'en-US'), true);
assert.equal(values.get('tradeflow-lite.locale.v1'), 'en-US');
assert.equal(saveAppLocale({ setItem: () => { throw new Error('quota'); } }, 'zh-CN'), false);

assert.equal(translateUiText('设置', 'zh-CN'), '设置');
assert.equal(translateUiText('设置', 'en-US'), 'Settings');
assert.equal(translateUiText('  \n', 'en-US'), '  \n');
assert.equal(translateUiText('已显示 5 / 共 9 条', 'en-US'), 'Showing 5 / 9');
assert.equal(translateUiText('浦发银行 · 1天 · SH', 'en-US'), '浦发银行 · 1D · SH');
assert.equal(translateUiText('取消收藏1 分钟', 'en-US'), 'Remove 1 minute from favorites');
assert.equal(translateUiText('(UTC+8) 上海', 'en-US'), '(UTC+8) Shanghai');

console.log('Chinese and English locale state and translations OK');
