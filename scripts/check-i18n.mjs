import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
assert.equal(translateUiText('关于', 'en-US'), 'About');
assert.equal(translateUiText('官方网站', 'en-US'), 'Official website');
assert.equal(translateUiText('问题反馈', 'en-US'), 'Report an issue');
assert.equal(translateUiText('背景颜色', 'en-US'), 'Background color');
assert.equal(translateUiText('窗格分隔符颜色不透明度', 'en-US'), 'Pane separator opacity');
assert.equal(translateUiText('自定义颜色', 'en-US'), 'Custom color');
assert.equal(translateUiText('不透明度', 'en-US'), 'Opacity');
assert.equal(translateUiText('  \n', 'en-US'), '  \n');
assert.equal(translateUiText('已显示 5 / 共 9 条', 'en-US'), 'Showing 5 / 9');
assert.equal(translateUiText('浦发银行 · 1天 · SH', 'en-US'), '浦发银行 · 1D · SH');
assert.equal(translateUiText('取消收藏1 分钟', 'en-US'), 'Remove 1 minute from favorites');
assert.equal(translateUiText('(UTC+8) 上海', 'en-US'), '(UTC+8) Shanghai');

for (const value of [
  '正在应用',
  '导入 .tfi',
  '没有匹配的指标',
  '点击右上角 + 添加当前证券',
  '调整右侧栏宽度',
  '当前品种暂未接入逐笔成交',
  '趋势线 · 在主图上点两次',
  '圆形 · 在主图上点圆心和边缘',
  '新指标启动失败，已有版本已尝试恢复；请复制诊断给 AI 修复',
  '删除只移除本地指标源码。当前使用该源码的图表实例会停止，但参数、Pane 布局和源码哈希会保留为未解析状态。',
  '输入代码、名称或拼音查找品种，点击结果添加到自选',
  '给本机 Codex、Claude Code 等客户端使用。启用后复制一次配置到客户端即可。',
]) {
  const translated = translateUiText(value, 'en-US');
  assert.notEqual(translated, value, `missing English translation: ${value}`);
  assert.doesNotMatch(translated, /[\u3400-\u9fff]/u, `English translation still contains Chinese: ${value}`);
}

const staticUiSources = [
  '../src/main.ts',
  '../src/ai-api/page.ts',
  '../src/ai-mcp/page.ts',
  '../src/user-data/page.ts',
  '../src/user-task/page.ts',
  '../src/indicator-sdk/input-form.ts',
  '../src/color-picker.ts',
];
const allowedChineseUi = new Set([
  '简体中文',
  '浦发银行 · 1天 · SH',
]);
for (const sourcePath of staticUiSources) {
  const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
  const values = new Set();
  for (const match of source.matchAll(/>([^<>\n]*[\u3400-\u9fff][^<>\n]*)</gu)) {
    const value = match[1].replace(/\$\{[^}]*\}/g, '').trim();
    if (value) values.add(value);
  }
  for (const match of source.matchAll(/(?:aria-label|title|placeholder)=["']([^"'\n]*[\u3400-\u9fff][^"'\n]*)["']/gu)) {
    values.add(match[1].trim());
  }
  for (const value of values) {
    if (allowedChineseUi.has(value)) continue;
    const translated = translateUiText(value, 'en-US');
    assert.notEqual(translated, value, `${sourcePath} has untranslated static UI: ${value}`);
    assert.doesNotMatch(translated, /[\u3400-\u9fff]/u, `${sourcePath} has partial English UI: ${value}`);
  }
}

console.log('Chinese and English locale state and translations OK');
