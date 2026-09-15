export const TF_COLOR_PALETTE = [
  ['#ffffff', '#e0e3eb', '#d1d4dc', '#b2b5be', '#787b86', '#5d606b', '#434651', '#2a2e39', '#131722', '#000000'],
  ['#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63'],
  ['#fccbcd', '#ffe0b2', '#fff9c4', '#c8e6c9', '#ace5dc', '#b2ebf2', '#bbd9fb', '#d1c4e9', '#e1bee7', '#f8bbd0'],
  ['#faa1a4', '#ffcc80', '#fff59d', '#a5d6a7', '#70ccbd', '#80deea', '#90bff9', '#b39ddb', '#ce93d8', '#f48fb1'],
  ['#f77c80', '#ffb74d', '#fff176', '#81c784', '#42bda8', '#4dd0e1', '#5b9cf6', '#9575cd', '#ba68c8', '#f06292'],
  ['#f7525f', '#ffa726', '#ffee58', '#66bb6a', '#22ab94', '#26c6da', '#3179f5', '#7e57c2', '#ab47bc', '#ec407a'],
  ['#b22833', '#f57c00', '#fbc02d', '#388e3c', '#056656', '#0097a7', '#1848cc', '#512da8', '#7b1fa2', '#c2185b'],
  ['#991f29', '#ef6c00', '#f9a825', '#2e7d32', '#004d40', '#00838f', '#143eb2', '#4527a0', '#6a1b9a', '#ad1457'],
] as const;

type PickerBinding = {
  input: HTMLInputElement;
  trigger: HTMLButtonElement;
};

const bindings = new WeakMap<HTMLInputElement, PickerBinding>();
let activeBinding: PickerBinding | null = null;
let popover: HTMLDivElement | null = null;
let paletteButtons: HTMLButtonElement[] = [];
let customEditor: HTMLDivElement | null = null;
let customInput: HTMLInputElement | null = null;
let opacityRow: HTMLLabelElement | null = null;
let opacityInput: HTMLInputElement | null = null;
let opacityOutput: HTMLOutputElement | null = null;
let opacityTarget: HTMLInputElement | null = null;
let popoverHost: HTMLElement | null = null;

export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized;
  if (/^[0-9a-f]{6}$/.test(normalized)) return `#${normalized}`;
  return null;
}

function setTriggerColor(binding: PickerBinding): void {
  const color = normalizeHexColor(binding.input.value) ?? '#2962ff';
  binding.trigger.style.setProperty('--tf-selected-color', color);
  binding.trigger.disabled = binding.input.disabled;
  binding.trigger.setAttribute('aria-label', binding.input.getAttribute('aria-label') ?? '选择颜色');
}

function updateSelectedColor(): void {
  const selected = normalizeHexColor(activeBinding?.input.value ?? '');
  for (const button of paletteButtons) {
    button.setAttribute('aria-checked', String(button.dataset.color === selected));
  }
  if (popover && selected) popover.style.setProperty('--tf-picker-color', selected);
}

function applyColor(color: string): void {
  if (!activeBinding) return;
  activeBinding.input.value = color;
  setTriggerColor(activeBinding);
  updateSelectedColor();
  activeBinding.input.dispatchEvent(new Event('input', { bubbles: true }));
  activeBinding.input.dispatchEvent(new Event('change', { bubbles: true }));
}

function closePicker(returnFocus = false): void {
  if (!popover || popover.hidden) return;
  popover.hidden = true;
  customEditor!.hidden = true;
  activeBinding?.trigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) activeBinding?.trigger.focus();
  activeBinding = null;
  opacityTarget = null;
}

function positionPicker(trigger: HTMLButtonElement): void {
  if (!popover) return;
  const anchor = trigger.getBoundingClientRect();
  const popup = popover.getBoundingClientRect();
  const margin = 8;
  let left = anchor.right + 8;
  if (left + popup.width > window.innerWidth - margin) left = anchor.left - popup.width - 8;
  if (left < margin) left = Math.min(window.innerWidth - popup.width - margin, Math.max(margin, anchor.left));
  let top = anchor.top - 8;
  if (top + popup.height > window.innerHeight - margin) top = window.innerHeight - popup.height - margin;
  popover.style.left = `${Math.max(margin, left)}px`;
  popover.style.top = `${Math.max(margin, top)}px`;
}

function commitCustomColor(): void {
  const color = normalizeHexColor(customInput?.value ?? '');
  if (!color || !customInput) {
    customInput?.setAttribute('aria-invalid', 'true');
    return;
  }
  customInput.removeAttribute('aria-invalid');
  applyColor(color);
  customEditor!.hidden = true;
}

function ensurePopover(): HTMLDivElement {
  if (popover) return popover;
  popover = document.createElement('div');
  popover.className = 'tf-color-popover';
  popover.hidden = true;
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', '颜色选择器');
  popover.innerHTML = `
    <div class="tf-color-grid" role="radiogroup" aria-label="TF 颜色色板"></div>
    <button class="tf-color-custom-toggle" type="button" aria-expanded="false"><span aria-hidden="true">＋</span><span>自定义颜色</span></button>
    <div class="tf-color-custom-editor" hidden>
      <span>#</span><input type="text" inputmode="text" maxlength="7" spellcheck="false" aria-label="十六进制颜色" placeholder="2962ff" />
      <button type="button">添加</button>
    </div>
    <label class="tf-color-opacity"><span>不透明度</span><span class="tf-color-opacity-control"><input type="range" min="5" max="100" step="5" /><output>100%</output></span></label>
  `;
  const grid = popover.querySelector<HTMLDivElement>('.tf-color-grid')!;
  for (const color of TF_COLOR_PALETTE.flat()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tf-color-cell';
    button.dataset.color = color;
    button.style.setProperty('--tf-cell-color', color);
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', color);
    button.setAttribute('aria-checked', 'false');
    button.addEventListener('click', () => applyColor(color));
    grid.append(button);
  }
  paletteButtons = [...grid.querySelectorAll<HTMLButtonElement>('.tf-color-cell')];
  customEditor = popover.querySelector<HTMLDivElement>('.tf-color-custom-editor')!;
  customInput = customEditor.querySelector<HTMLInputElement>('input')!;
  const customToggle = popover.querySelector<HTMLButtonElement>('.tf-color-custom-toggle')!;
  customToggle.addEventListener('click', () => {
    customEditor!.hidden = !customEditor!.hidden;
    customToggle.setAttribute('aria-expanded', String(!customEditor!.hidden));
    if (!customEditor!.hidden) {
      customInput!.value = (activeBinding?.input.value ?? '').replace(/^#/, '');
      customInput!.focus();
      customInput!.select();
    }
    if (activeBinding) requestAnimationFrame(() => positionPicker(activeBinding!.trigger));
  });
  customInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commitCustomColor();
  });
  customEditor.querySelector<HTMLButtonElement>('button')!.addEventListener('click', commitCustomColor);
  opacityRow = popover.querySelector<HTMLLabelElement>('.tf-color-opacity')!;
  opacityInput = opacityRow.querySelector<HTMLInputElement>('input')!;
  opacityOutput = opacityRow.querySelector<HTMLOutputElement>('output')!;
  opacityInput.addEventListener('input', () => {
    if (!opacityTarget || !opacityOutput) return;
    opacityTarget.value = opacityInput!.value;
    opacityOutput.value = `${opacityInput!.value}%`;
    opacityTarget.dispatchEvent(new Event('input', { bubbles: true }));
  });
  (popoverHost ?? document.body).append(popover);
  return popover;
}

function openPicker(binding: PickerBinding): void {
  if (binding.input.disabled) return;
  const picker = ensurePopover();
  if (activeBinding && activeBinding !== binding) activeBinding.trigger.setAttribute('aria-expanded', 'false');
  activeBinding = binding;
  setTriggerColor(binding);
  updateSelectedColor();
  customEditor!.hidden = true;
  picker.querySelector<HTMLButtonElement>('.tf-color-custom-toggle')!.setAttribute('aria-expanded', 'false');
  opacityTarget = binding.input.dataset.tfColorOpacityTarget
    ? document.getElementById(binding.input.dataset.tfColorOpacityTarget) as HTMLInputElement | null
    : null;
  opacityRow!.hidden = !opacityTarget;
  if (opacityTarget) {
    opacityInput!.min = opacityTarget.min || '0';
    opacityInput!.max = opacityTarget.max || '100';
    opacityInput!.step = opacityTarget.step || '1';
    opacityInput!.value = opacityTarget.value;
    opacityOutput!.value = `${opacityTarget.value}%`;
  }
  picker.hidden = false;
  binding.trigger.setAttribute('aria-expanded', 'true');
  positionPicker(binding.trigger);
}

function enhanceColorInput(input: HTMLInputElement): void {
  if (bindings.has(input)) return;
  input.type = 'text';
  input.readOnly = true;
  input.tabIndex = -1;
  input.classList.add('tf-color-input');
  input.setAttribute('aria-hidden', 'true');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'tf-color-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = '<span class="tf-color-trigger-swatch" aria-hidden="true"></span>';
  input.insertAdjacentElement('afterend', trigger);
  const binding = { input, trigger };
  bindings.set(input, binding);
  setTriggerColor(binding);
  const wrappingLabel = input.closest('label');
  if (wrappingLabel) wrappingLabel.addEventListener('click', (event) => event.preventDefault());
  trigger.addEventListener('click', () => {
    if (activeBinding === binding && !ensurePopover().hidden) closePicker();
    else openPicker(binding);
  });
}

export function refreshTfColorPicker(input: HTMLInputElement): void {
  const binding = bindings.get(input);
  if (binding) setTriggerColor(binding);
}

export function installTfColorPickers(root: ParentNode = document): () => void {
  if (root instanceof HTMLElement) popoverHost = root;
  const enhanceWithin = (node: ParentNode) => {
    if (node instanceof HTMLInputElement && node.matches('input[type="color"]')) enhanceColorInput(node);
    for (const input of node.querySelectorAll<HTMLInputElement>('input[type="color"]')) enhanceColorInput(input);
  };
  enhanceWithin(root);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) if (node instanceof Element) enhanceWithin(node);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  document.addEventListener('pointerdown', (event) => {
    if (!activeBinding || popover?.contains(event.target as Node) || activeBinding.trigger.contains(event.target as Node)) return;
    closePicker();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeBinding) {
      event.preventDefault();
      event.stopPropagation();
      closePicker(true);
    }
  }, true);
  window.addEventListener('resize', () => activeBinding && positionPicker(activeBinding.trigger));
  return () => observer.disconnect();
}
