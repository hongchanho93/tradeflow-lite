import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

import {
  IndicatorInputFormValidationError,
  readIndicatorInputForm,
  renderIndicatorInputForm,
} from '../src/indicator-sdk/input-form.ts';

class FakeElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = Object.create(null);
    this.textContent = '';
    this.value = '';
    this.type = '';
    this.name = '';
    this.id = '';
    this.checked = false;
    this.min = '';
    this.max = '';
    this.step = '';
    this.maxLength = -1;
    this.noValidate = false;
    this.disabled = false;
    this.listeners = new Map();
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      node.parentNode?.removeChild(node);
      node.parentNode = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  replaceChildren(...nodes) {
    for (const child of [...this.children]) this.removeChild(child);
    this.append(...nodes);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, character) => character.toUpperCase());
      this.dataset[key] = stringValue;
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    if (selector === 'form[data-indicator-input-form]') {
      return this.tagName === 'FORM' && this.getAttribute('data-indicator-input-form') === '';
    }
    if (selector === '[data-indicator-input-field]') {
      return this.getAttribute('data-indicator-input-field') !== null;
    }
    const inputMatch = selector.match(/^\[data-indicator-input="([^"]+)"\] (input|select)$/);
    if (inputMatch) {
      return this.getAttribute('data-indicator-input') === inputMatch[1]
        && this.tagName === inputMatch[2].toUpperCase();
    }
    if (/^(label|input|select|option|p|form|div|fieldset|legend)$/.test(selector)) return this.tagName === selector.toUpperCase();
    return false;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      if (node.matches(selector)) matches.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this);
    return matches;
  }
}

class FakeForm extends FakeElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'form');
  }

  get elements() {
    const controls = [];
    const visit = (node) => {
      if (node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA') controls.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this);
    return {
      namedItem: (name) => controls.filter((control) => control.name === name)[0] ?? null,
    };
  }
}

class FakeOption extends FakeElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'option');
    this.selected = false;
  }
}

class FakeSelect extends FakeElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'select');
    this.options = [];
  }

  append(...nodes) {
    super.append(...nodes);
    for (const node of nodes) if (node.tagName === 'OPTION') this.options.push(node);
  }

  get value() {
    return this.options?.find((option) => option.selected)?.value ?? '';
  }

  set value(value) {
    if (!this.options) return;
    for (const option of this.options) option.selected = option.value === String(value);
  }
}

class FakeDocument {
  constructor() {
    this.elements = [];
  }

  createElement(tagName) {
    let element;
    if (tagName === 'form') element = new FakeForm(this);
    else if (tagName === 'select') element = new FakeSelect(this);
    else if (tagName === 'option') element = new FakeOption(this);
    else element = new FakeElement(this, tagName);
    this.elements.push(element);
    return element;
  }

  getElementById(id) {
    return this.elements.find((element) => element.id === id) ?? null;
  }
}

const document = new FakeDocument();
const container = document.createElement('div');
const unrelated = document.createElement('p');
unrelated.textContent = '由宿主管理的内容';
container.append(unrelated);

const schema = {
  period: { type: 'number', title: '周期', default: 20, min: 1, max: 500, step: 1, group: '计算', tooltip: '回看长度' },
  enabled: { type: 'boolean', title: '启用', default: true, group: '样式' },
  color: { type: 'color', title: '颜色', default: '#2962ff', group: '样式', inline: 'palette', activeWhen: { field: 'enabled', equals: true } },
  mode: {
    type: 'select',
    title: { 'zh-CN': '模式', 'en-US': 'Mode' },
    default: 'fast',
    options: [
      { value: 'fast', label: { 'zh-CN': '快速', 'en-US': 'Fast' } },
      { value: 'slow', label: { 'zh-CN': '慢速', 'en-US': 'Slow' } },
    ],
    group: '样式',
    inline: 'palette',
  },
  note: { type: 'text', title: '备注', default: '默认值', maxLength: 12 },
  hostile: {
    type: 'text',
    title: '<img src=x onerror=alert(1)>',
    default: '<script>alert(1)</script>',
    maxLength: 64,
  },
};

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const typeFixtureRoot = mkdtempSync(join(tmpdir(), 'tradeflow-indicator-input-form-'));
const inputFormPath = resolve(projectRoot, 'src/indicator-sdk/input-form.ts').replaceAll('\\', '/');
const contractsPath = resolve(projectRoot, 'src/indicator-sdk/contracts.ts').replaceAll('\\', '/');
const typeFixturePath = join(typeFixtureRoot, 'input-form-types.ts');
writeFileSync(typeFixturePath, `
  import type { IndicatorInputSchema } from '${contractsPath}';
  import { readIndicatorInputForm } from '${inputFormPath}';
  declare const container: HTMLElement;
  const schema = {
    period: { type: 'number', title: '周期', default: 20 },
    enabled: { type: 'boolean', title: '启用', default: true },
    color: { type: 'color', title: '颜色', default: '#2962ff' },
    mode: {
      type: 'select', title: '模式', default: 'fast',
      options: [{ value: 'fast', label: 'Fast' }, { value: 'slow', label: 'Slow' }],
    },
    note: { type: 'text', title: '备注', default: '' },
  } as const satisfies IndicatorInputSchema;
  const values = readIndicatorInputForm(container, schema);
  const period: number = values.period;
  const enabled: boolean = values.enabled;
  const color: string = values.color;
  const mode: 'fast' | 'slow' = values.mode;
  const note: string = values.note;
  // @ts-expect-error select values must remain the schema's literal union
  const invalidMode: 'other' = values.mode;
  void period; void enabled; void color; void mode; void note; void invalidMode;
`);
execFileSync(process.execPath, [resolve(projectRoot, 'node_modules/typescript/bin/tsc'), '--ignoreConfig', '--strict', '--noEmit', '--target', 'ES2022', '--module', 'ESNext',
  '--moduleResolution', 'Bundler', '--allowImportingTsExtensions', '--skipLibCheck', typeFixturePath], {
  cwd: projectRoot,
  stdio: 'pipe',
});
rmSync(typeFixtureRoot, { recursive: true, force: true });

const form = renderIndicatorInputForm(
  container,
  schema,
  { period: 42, enabled: false, color: '#abcdef', mode: 'slow', note: 'hello', hostile: 'safe' },
  'en-US',
);
assert.equal(form.tagName, 'FORM');
assert.equal(container.children.filter((child) => child.matches('form[data-indicator-input-form]')).length, 1);
assert.equal(container.children.includes(unrelated), true, 'rendering does not clear host-owned content');
assert.equal(form.noValidate, true);
assert.deepEqual(form.querySelectorAll('fieldset').map((group) => group.querySelector('legend').textContent), ['计算', '样式'],
  'inputs with the same group render under one labelled section');

const fields = Object.fromEntries(form.querySelectorAll('[data-indicator-input-field]').map((field) => [field.dataset.indicatorInputField, field]));
assert.equal(fields.mode.querySelector('label').textContent, 'Mode', 'localized titles use the requested locale');
assert.equal(fields.period.querySelector('label').getAttribute('title'), '回看长度', 'tooltips remain hoverable plain text');
assert.equal(fields.color.parentNode, fields.mode.parentNode, 'matching inline keys share one row');
assert.equal(fields.color.querySelector('input').disabled, true, 'activeWhen disables dependent controls initially');
fields.enabled.querySelector('input').checked = true;
form.dispatchEvent({ type: 'change' });
assert.equal(fields.color.querySelector('input').disabled, false, 'activeWhen reacts to dependency changes');
fields.enabled.querySelector('input').checked = false;
form.dispatchEvent({ type: 'change' });
assert.equal(fields.hostile.querySelector('label').textContent, '<img src=x onerror=alert(1)>', 'titles are text, not HTML');
assert.equal(fields.hostile.querySelector('input').value, 'safe');
assert.equal(fields.mode.querySelector('select').value, 'slow');
const colorInput = fields.color.querySelector('input');
const colorOpacity = document.getElementById(colorInput.dataset.tfColorOpacityTarget);
assert.equal(colorInput.value, '#abcdef', 'opaque indicator colors keep their base hex value');
assert.equal(colorOpacity.type, 'range');
assert.equal(colorOpacity.hidden, true, 'the shared picker owns the visible opacity control');
assert.deepEqual(
  { min: colorOpacity.min, max: colorOpacity.max, step: colorOpacity.step, value: colorOpacity.value },
  { min: '0', max: '100', step: '1', value: '100' },
  'indicator colors expose the same opacity range as chart settings',
);
assert.deepEqual(
  fields.mode.querySelector('select').options.map((option) => ({ value: option.value, text: option.textContent })),
  [{ value: 'fast', text: 'Fast' }, { value: 'slow', text: 'Slow' }],
  'select option values and labels are copied without stringifying an index or injecting markup',
);
assert.equal(readFileSync(new URL('../src/indicator-sdk/input-form.ts', import.meta.url), 'utf8').includes('.innerHTML'), false,
  'form renderer must not construct markup through innerHTML');

assert.deepEqual(
  readIndicatorInputForm(container, schema),
  { period: 42, enabled: false, color: '#abcdef', mode: 'slow', note: 'hello', hostile: 'safe' },
  'read returns typed number/boolean/string values and preserves the selected string option value',
);

colorOpacity.value = '45';
assert.equal(
  readIndicatorInputForm(container, schema).color,
  'rgba(171, 205, 239, 0.45)',
  'indicator colors include the selected opacity in the value passed to the indicator',
);
colorOpacity.value = '100';

fields.period.querySelector('input').value = '1.5';
assert.throws(
  () => readIndicatorInputForm(container, schema),
  (error) => error instanceof IndicatorInputFormValidationError
    && error.field === 'period'
    && error.code === 'invalid-step',
  'number values must satisfy the schema step',
);
fields.period.querySelector('input').value = '999';
assert.throws(
  () => readIndicatorInputForm(container, schema),
  (error) => error instanceof IndicatorInputFormValidationError
    && error.field === 'period'
    && error.code === 'out-of-range',
  'number values must satisfy the schema range',
);
fields.period.querySelector('input').value = '42';
fields.mode.querySelector('select').value = 'missing';
assert.throws(
  () => readIndicatorInputForm(container, schema),
  (error) => error instanceof IndicatorInputFormValidationError
    && error.field === 'mode'
    && error.code === 'invalid-select',
  'select values must be one of the schema option values',
);
fields.mode.querySelector('select').value = 'fast';
fields.note.querySelector('input').value = '1234567890123';
assert.throws(
  () => readIndicatorInputForm(container, schema),
  (error) => error instanceof IndicatorInputFormValidationError
    && error.field === 'note'
    && error.code === 'invalid-text',
  'text values must satisfy maxLength even when set programmatically',
);

renderIndicatorInputForm(container, schema, { period: 999, mode: 'missing' }, 'zh-CN');
const fallbackForm = container.querySelector('form[data-indicator-input-form]');
assert.equal(fallbackForm.querySelector('[data-indicator-input="period"] input').value, '20',
  'invalid initial number values fall back to the schema default');
assert.equal(fallbackForm.querySelector('[data-indicator-input="mode"] select').value, 'fast',
  'invalid initial select values fall back to the schema default without coercion');
assert.equal(container.children.filter((child) => child.matches('form[data-indicator-input-form]')).length, 1,
  'rerender replaces only the previous SDK form');

renderIndicatorInputForm(container, schema, { color: 'rgba(41, 98, 255, 0.32)' }, 'zh-CN');
const alphaForm = container.querySelector('form[data-indicator-input-form]');
const alphaColor = alphaForm.querySelector('[data-indicator-input="color"] input');
const alphaOpacity = document.getElementById(alphaColor.dataset.tfColorOpacityTarget);
assert.equal(alphaColor.value, '#2962ff', 'rgba indicator colors reopen with their base color');
assert.equal(alphaOpacity.value, '32', 'rgba indicator colors reopen with their saved opacity');

console.log('Indicator input form rendering, safe DOM, typed reading, and validation passed');
