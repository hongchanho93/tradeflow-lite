import type {
  IndicatorInputDefinition,
  IndicatorInputSchema,
  InferIndicatorInputs,
  LocalizedText,
} from './contracts.ts';

export type IndicatorInputFormLocale = 'zh-CN' | 'en-US';

export type IndicatorInputFormValidationErrorCode =
  | 'missing-form'
  | 'missing-control'
  | 'invalid-number'
  | 'out-of-range'
  | 'invalid-step'
  | 'invalid-boolean'
  | 'invalid-color'
  | 'invalid-text'
  | 'invalid-select';

export class IndicatorInputFormValidationError extends Error {
  readonly code: IndicatorInputFormValidationErrorCode;
  readonly field: string;
  readonly value: unknown;

  constructor(
    code: IndicatorInputFormValidationErrorCode,
    field: string,
    message: string,
    value?: unknown,
  ) {
    super(message);
    this.name = 'IndicatorInputFormValidationError';
    this.code = code;
    this.field = field;
    this.value = value;
  }
}

type InputFormValues = Readonly<Record<string, unknown>>;
type InputFormControl = HTMLInputElement | HTMLSelectElement;

let nextFormId = 0;

function localizedText(value: LocalizedText, locale: IndicatorInputFormLocale): string {
  if (typeof value === 'string') return value;
  return locale === 'en-US' ? value['en-US'] : value['zh-CN'];
}

function isStepAligned(value: number, definition: Extract<IndicatorInputDefinition, { type: 'number' }>): boolean {
  if (definition.step === undefined) return true;
  const base = definition.min ?? 0;
  const quotient = (value - base) / definition.step;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(base), Math.abs(definition.step)) * 16;
  return Math.abs(quotient - Math.round(quotient)) <= tolerance;
}

function validInputValue(definition: IndicatorInputDefinition, value: unknown): boolean {
  switch (definition.type) {
    case 'number':
      return typeof value === 'number'
        && Number.isFinite(value)
        && (definition.min === undefined || value >= definition.min)
        && (definition.max === undefined || value <= definition.max)
        && isStepAligned(value, definition);
    case 'boolean':
      return typeof value === 'boolean';
    case 'color':
      return typeof value === 'string' && value.trim().length > 0;
    case 'text':
      return typeof value === 'string'
        && (definition.maxLength === undefined || value.length <= definition.maxLength);
    case 'select':
      return typeof value === 'string' && definition.options.some((option) => option.value === value);
  }
}

function initialValue(
  definition: IndicatorInputDefinition,
  values: InputFormValues,
  field: string,
): unknown {
  const candidate = values[field];
  return validInputValue(definition, candidate) ? candidate : definition.default;
}

type EditableColor = {
  readonly color: string;
  readonly opacity: number;
};

function editableColor(value: string): EditableColor {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) return { color: normalized, opacity: 100 };
  if (/^#[0-9a-f]{8}$/.test(normalized)) {
    return {
      color: normalized.slice(0, 7),
      opacity: Math.round((Number.parseInt(normalized.slice(7), 16) / 255) * 100),
    };
  }
  const rgba = normalized.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/);
  if (rgba) {
    const channels = rgba.slice(1, 4).map(Number);
    if (channels.every((channel) => channel >= 0 && channel <= 255)) {
      return {
        color: `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`,
        opacity: Math.round(Number(rgba[4] ?? 1) * 100),
      };
    }
  }
  return { color: '#2962ff', opacity: 100 };
}

function colorWithOpacity(color: string, opacity: number): string {
  if (opacity === 100) return color;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity / 100})`;
}

function fail(
  code: IndicatorInputFormValidationErrorCode,
  field: string,
  message: string,
  value?: unknown,
): never {
  throw new IndicatorInputFormValidationError(code, field, message, value);
}

function isGeneratedForm(element: Element): boolean {
  return element.tagName.toLowerCase() === 'form'
    && element.getAttribute('data-indicator-input-form') === '';
}

function documentFor(container: HTMLElement, documentOverride?: Document): Document {
  if (documentOverride) return documentOverride;
  if (container.ownerDocument) return container.ownerDocument;
  if (typeof document !== 'undefined') return document;
  throw new Error('indicator input form requires a DOM Document');
}

function removePreviousForms(container: HTMLElement): void {
  if (isGeneratedForm(container)) return;
  for (const form of Array.from(container.querySelectorAll('form[data-indicator-input-form]'))) {
    form.remove();
  }
}

function setAttributeValue(element: Element, name: string, value: string): void {
  element.setAttribute(name, value);
}

function numberAttribute(
  input: HTMLInputElement,
  name: 'min' | 'max' | 'step',
  value: number | undefined,
): void {
  if (value === undefined) return;
  const text = String(value);
  input[name] = text;
  setAttributeValue(input, name, text);
}

function controlFor(form: HTMLFormElement, field: string): InputFormControl {
  const candidate = form.elements.namedItem(field);
  if (!candidate || typeof candidate !== 'object' || !('tagName' in candidate)) {
    return fail(
      'missing-control',
      field,
      `indicator input ${JSON.stringify(field)} has no form control`,
    );
  }
  const tagName = String((candidate as Element).tagName).toLowerCase();
  if (tagName !== 'input' && tagName !== 'select') {
    return fail(
      'missing-control',
      field,
      `indicator input ${JSON.stringify(field)} has an unsupported form control`,
    );
  }
  return candidate as InputFormControl;
}

function readNumber(
  control: InputFormControl,
  definition: Extract<IndicatorInputDefinition, { type: 'number' }>,
  field: string,
): number {
  const raw = control.value;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fail('invalid-number', field, `indicator input ${JSON.stringify(field)} must be a number`, raw);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fail('invalid-number', field, `indicator input ${JSON.stringify(field)} must be a finite number`, raw);
  }
  if ((definition.min !== undefined && value < definition.min)
    || (definition.max !== undefined && value > definition.max)) {
    return fail(
      'out-of-range',
      field,
      `indicator input ${JSON.stringify(field)} is outside its allowed range`,
      value,
    );
  }
  if (!isStepAligned(value, definition)) {
    return fail(
      'invalid-step',
      field,
      `indicator input ${JSON.stringify(field)} does not match its step`,
      value,
    );
  }
  return value;
}

function readValue(
  control: InputFormControl,
  definition: IndicatorInputDefinition,
  field: string,
): unknown {
  switch (definition.type) {
    case 'number':
      return readNumber(control, definition, field);
    case 'boolean':
      if (String(control.tagName).toLowerCase() !== 'input' || control.type !== 'checkbox') {
        return fail('invalid-boolean', field, `indicator input ${JSON.stringify(field)} is not a checkbox`);
      }
      return Boolean(control.checked);
    case 'color': {
      const value = control.value;
      if (typeof value !== 'string' || value.trim().length === 0) {
        return fail('invalid-color', field, `indicator input ${JSON.stringify(field)} must be a non-empty color`, value);
      }
      const opacityTargetId = control.getAttribute('data-tf-color-opacity-target');
      const opacityTarget = opacityTargetId
        ? control.ownerDocument.getElementById(opacityTargetId) as HTMLInputElement | null
        : null;
      const opacity = Number(opacityTarget?.value ?? 100);
      if (!Number.isInteger(opacity) || opacity < 0 || opacity > 100) {
        return fail('invalid-color', field, `indicator input ${JSON.stringify(field)} has an invalid opacity`, opacityTarget?.value);
      }
      return colorWithOpacity(value, opacity);
    }
    case 'text': {
      const value = control.value;
      if (typeof value !== 'string'
        || (definition.maxLength !== undefined && value.length > definition.maxLength)) {
        return fail('invalid-text', field, `indicator input ${JSON.stringify(field)} exceeds its allowed length`, value);
      }
      return value;
    }
    case 'select': {
      const value = control.value;
      const option = definition.options.find((candidate) => candidate.value === value);
      if (!option) {
        return fail(
          'invalid-select',
          field,
          `indicator input ${JSON.stringify(field)} must match one of its options`,
          value,
        );
      }
      return option.value;
    }
  }
}

function formFor(container: HTMLElement): HTMLFormElement {
  if (isGeneratedForm(container)) return container as HTMLFormElement;
  const form = container.querySelector('form[data-indicator-input-form]');
  if (!form || !isGeneratedForm(form)) {
    return fail('missing-form', '', 'indicator input form was not rendered in this container');
  }
  return form as HTMLFormElement;
}

export function renderIndicatorInputForm<const S extends IndicatorInputSchema>(
  container: HTMLElement,
  schema: S,
  values: InputFormValues = {},
  locale: IndicatorInputFormLocale = 'zh-CN',
  documentOverride?: Document,
): HTMLFormElement {
  const ownerDocument = documentFor(container, documentOverride);
  removePreviousForms(container);

  const form = isGeneratedForm(container)
    ? container as HTMLFormElement
    : ownerDocument.createElement('form');
  form.replaceChildren();
  form.noValidate = true;
  setAttributeValue(form, 'data-indicator-input-form', '');

  const formId = ++nextFormId;
  const groups = new Map<string, HTMLElement>();
  const inlineRows = new Map<string, HTMLElement>();
  const renderedFields = new Map<string, {
    wrapper: HTMLElement;
    control: InputFormControl;
    auxiliaryControl: HTMLInputElement | null;
    definition: IndicatorInputDefinition;
  }>();
  let index = 0;
  for (const [field, definition] of Object.entries(schema)) {
    const wrapper = ownerDocument.createElement('div');
    wrapper.className = 'indicator-input-field';
    setAttributeValue(wrapper, 'data-indicator-input-field', field);

    const label = ownerDocument.createElement('label');
    const inputId = `indicator-input-${formId}-${index}`;
    label.htmlFor = inputId;
    label.textContent = localizedText(definition.title, locale);
    if (definition.tooltip) {
      const tooltip = localizedText(definition.tooltip, locale);
      label.title = tooltip;
      setAttributeValue(label, 'title', tooltip);
      setAttributeValue(wrapper, 'data-indicator-input-tooltip', tooltip);
    }
    wrapper.append(label);

    let control: InputFormControl;
    let auxiliaryControl: HTMLInputElement | null = null;
    const value = initialValue(definition, values, field);
    if (definition.type === 'select') {
      const select = ownerDocument.createElement('select');
      control = select;
      for (const definitionOption of definition.options) {
        const option = ownerDocument.createElement('option');
        option.value = definitionOption.value;
        setAttributeValue(option, 'value', definitionOption.value);
        option.textContent = localizedText(definitionOption.label, locale);
        select.append(option);
      }
      select.value = value as string;
    } else {
      const input = ownerDocument.createElement('input');
      control = input;
      input.type = definition.type === 'boolean' ? 'checkbox' : definition.type;
      if (definition.type === 'number') {
        numberAttribute(input, 'min', definition.min);
        numberAttribute(input, 'max', definition.max);
        numberAttribute(input, 'step', definition.step);
        input.value = String(value);
      } else if (definition.type === 'boolean') {
        input.checked = value as boolean;
      } else {
        if (definition.type === 'text' && definition.maxLength !== undefined) {
          input.maxLength = definition.maxLength;
          setAttributeValue(input, 'maxlength', String(definition.maxLength));
        }
        if (definition.type === 'color') {
          const parsed = editableColor(value as string);
          const opacity = ownerDocument.createElement('input');
          const opacityId = `${inputId}-opacity`;
          opacity.type = 'range';
          opacity.id = opacityId;
          opacity.min = '0';
          opacity.max = '100';
          opacity.step = '1';
          opacity.value = String(parsed.opacity);
          opacity.hidden = true;
          opacity.className = 'indicator-input-opacity-source';
          opacity.setAttribute('id', opacityId);
          opacity.setAttribute('aria-label', `${localizedText(definition.title, locale)}不透明度`);
          input.setAttribute('data-tf-color-opacity-target', opacityId);
          input.value = parsed.color;
          auxiliaryControl = opacity;
        } else {
          input.value = value as string;
        }
      }
    }
    control.id = inputId;
    control.name = field;
    setAttributeValue(control, 'id', inputId);
    setAttributeValue(control, 'name', field);
    setAttributeValue(control, 'data-indicator-input', field);
    wrapper.append(control);
    if (auxiliaryControl) wrapper.append(auxiliaryControl);
    let parent: HTMLElement = form;
    if (definition.group) {
      const groupTitle = localizedText(definition.group, locale);
      let group = groups.get(groupTitle);
      if (!group) {
        group = ownerDocument.createElement('fieldset');
        group.className = 'indicator-input-group';
        setAttributeValue(group, 'data-indicator-input-group', groupTitle);
        const legend = ownerDocument.createElement('legend');
        legend.textContent = groupTitle;
        group.append(legend);
        groups.set(groupTitle, group);
        form.append(group);
      }
      parent = group;
    }
    if (definition.inline) {
      const groupKey = definition.group ? localizedText(definition.group, locale) : '';
      const inlineKey = `${groupKey}\u0000${definition.inline}`;
      let inline = inlineRows.get(inlineKey);
      if (!inline) {
        inline = ownerDocument.createElement('div');
        inline.className = 'indicator-input-inline';
        setAttributeValue(inline, 'data-indicator-input-inline', definition.inline);
        inlineRows.set(inlineKey, inline);
        parent.append(inline);
      }
      parent = inline;
    }
    parent.append(wrapper);
    renderedFields.set(field, { wrapper, control, auxiliaryControl, definition });
    index += 1;
  }

  const syncActiveStates = () => {
    for (const { wrapper, control, auxiliaryControl, definition } of renderedFields.values()) {
      const condition = definition.activeWhen;
      let active = true;
      if (condition) {
        const dependency = renderedFields.get(condition.field);
        if (dependency) {
          const source = dependency.definition.type === 'boolean'
            ? (dependency.control as HTMLInputElement).checked
            : dependency.definition.type === 'number'
              ? Number(dependency.control.value)
              : dependency.control.value;
          active = source === condition.equals;
        }
      }
      control.disabled = !active;
      if (auxiliaryControl) auxiliaryControl.disabled = !active;
      setAttributeValue(wrapper, 'data-indicator-input-active', String(active));
    }
  };
  syncActiveStates();
  if ('addEventListener' in form && typeof form.addEventListener === 'function') {
    form.addEventListener('input', syncActiveStates);
    form.addEventListener('change', syncActiveStates);
  }

  if (form !== container) container.append(form);
  return form;
}

export function readIndicatorInputForm<const S extends IndicatorInputSchema>(
  container: HTMLElement,
  schema: S,
): InferIndicatorInputs<S> {
  const form = formFor(container);
  const entries: Array<[string, unknown]> = [];
  for (const [field, definition] of Object.entries(schema)) {
    const control = controlFor(form, field);
    entries.push([field, readValue(control, definition, field)]);
  }
  return Object.fromEntries(entries) as InferIndicatorInputs<S>;
}
