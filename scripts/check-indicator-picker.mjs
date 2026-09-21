import { readFileSync } from 'node:fs';

const markup = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

const requiredMarkup = [
  'id="open-indicator-picker"',
  'id="indicator-picker-layer"',
  'id="indicator-picker-dialog"',
  'id="indicator-picker-search"',
  'id="indicator-picker-list"',
  'id="indicator-config-layer"',
  'id="indicator-config-form"',
  'id="indicator-config-fields"',
  'id="indicator-legend-layer"',
  '全部指标',
  'function renderIndicatorPicker',
  'indicatorRegistry.list()',
  'function openIndicatorPicker',
  'function closeIndicatorPicker',
  'openIndicatorConfig(indicatorId)',
  "event.key === 'Escape' && !indicatorPickerLayer.hidden",
  'if (event.target === indicatorPickerLayer) closeIndicatorPicker()',
  'indicatorPickerReturnFocus?.focus()',
  'function nextIndicatorInstanceId',
  'function openIndicatorConfig',
  'indicatorRuntime.updateInputs',
  'indicatorRuntime.list()',
  'function moveIndicatorInstance',
  'indicatorInstanceAction',
  'function renderIndicatorLegends',
  'function layoutIndicatorLegends',
  'indicatorChartHost.visualPaneTargets',
  'data-indicator-legend-action',
];

for (const fragment of requiredMarkup) {
  if (!markup.includes(fragment)) throw new Error(`indicator picker is missing markup or behavior: ${fragment}`);
}

if (markup.includes('<details class="indicator-menu">')) {
  throw new Error('indicator picker must open from a toolbar button instead of the legacy details popup');
}

const requiredStyles = [
  '.indicator-picker-layer',
  '.indicator-picker-dialog',
  '.indicator-picker-search',
  '.indicator-picker-list',
  'overflow-y: auto',
  'body.theme-light .indicator-picker-dialog',
  '.indicator-legend-layer',
  '.indicator-legend-row',
  '.indicator-legend-actions',
  'body.theme-light .indicator-legend-row',
];

for (const fragment of requiredStyles) {
  if (!styles.includes(fragment)) throw new Error(`indicator picker is missing style contract: ${fragment}`);
}

console.log('indicator picker contract passed');
