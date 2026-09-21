import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import { defineIndicator } from '../src/indicator-sdk/define-indicator.ts';
import {
  IndicatorDefinitionValidationError,
  IndicatorRegistry,
  validateIndicatorDefinition,
  validateIndicatorPaneKey,
} from '../src/indicator-sdk/registry.ts';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const compiler = resolve(projectRoot, 'node_modules/typescript/bin/tsc');
const tempRoot = mkdtempSync(join(tmpdir(), 'tradeflow-indicator-sdk-'));

try {
  const contractsPath = resolve(projectRoot, 'src/indicator-sdk/define-indicator.ts').replaceAll('\\', '/');
  const goodFixture = `
    import { defineIndicator } from '${contractsPath}';
    import { IndicatorRegistry } from '${contractsPath.replace('/define-indicator.ts', '/registry.ts')}';

    const definition = defineIndicator({
      id: 'fixture.types',
      apiVersion: 1,
      indicatorVersion: 1,
      name: { 'zh-CN': '类型测试', 'en-US': 'Type fixture' },
      supports: { seriesKinds: ['ohlcv'] },
      inputs: {
        period: { type: 'number', title: '周期', default: 20 },
        mode: {
          type: 'select',
          title: '模式',
          default: 'fast',
          options: [
            { value: 'fast', label: 'Fast' },
            { value: 'slow', label: 'Slow' },
          ],
        },
        enabled: { type: 'boolean', title: '启用', default: true },
        color: { type: 'color', title: '颜色', default: '#2962ff' },
      },
      create(context, inputs) {
        const period: number = inputs.period;
        const mode: 'fast' | 'slow' = inputs.mode;
        const enabled: boolean = inputs.enabled;
        const color: string = inputs.color;
        const tick: number | null = context.instrument.priceTick;
        context.layers.createSeries({ key: 'line', type: 'line', pane: 'main', options: { lineWidth: 2 } });
        // @ts-expect-error line series options reject bar-only fields
        context.layers.createSeries({ key: 'wrong-line', type: 'line', pane: 'main', options: { upColor: '#fff' } });
        // @ts-expect-error number input must not widen to string
        const wrongPeriod: string = inputs.period;
        // @ts-expect-error select input must remain a literal union
        const wrongMode: 'other' = inputs.mode;
        // @ts-expect-error boolean input must not widen to string
        const wrongEnabled: string = inputs.enabled;
        // @ts-expect-error color input is a string, not a number
        const wrongColor: number = inputs.color;
        void period;
        void mode;
        void enabled;
        void color;
        void tick;
        void wrongPeriod;
        void wrongMode;
        void wrongEnabled;
        void wrongColor;
        return { update() {} };
      },
    });

    new IndicatorRegistry([definition]);
    void definition;
  `;
  const badFixture = `
    import { defineIndicator } from '${contractsPath}';

    defineIndicator({
      id: 'fixture.bad-types',
      apiVersion: 1,
      indicatorVersion: 1,
      name: { 'zh-CN': '类型测试', 'en-US': 'Type fixture' },
      supports: { seriesKinds: ['ohlcv'] },
      inputs: { period: { type: 'number', title: '周期', default: 20 } },
      create(_context, inputs) {
        inputs.period.toUpperCase();
        return { update() {} };
      },
    });
  `;
  const goodFixturePath = join(tempRoot, 'indicator-sdk-types.ts');
  const badFixturePath = join(tempRoot, 'indicator-sdk-bad-types.ts');
  writeFileSync(goodFixturePath, goodFixture);
  writeFileSync(badFixturePath, badFixture);

  execFileSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--noEmit', '--target', 'ES2022', '--module', 'ESNext',
    '--moduleResolution', 'Bundler', '--allowImportingTsExtensions', '--skipLibCheck', goodFixturePath], {
    cwd: projectRoot,
    stdio: 'pipe',
  });
  const badCompile = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--noEmit', '--target', 'ES2022', '--module',
    'ESNext', '--moduleResolution', 'Bundler', '--allowImportingTsExtensions', '--skipLibCheck', badFixturePath], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.notEqual(badCompile.status, 0, 'a wrong input usage must fail the type fixture');

  const validDefinition = defineIndicator({
    id: 'fixture.valid',
    apiVersion: 1,
    indicatorVersion: 3,
    name: { 'zh-CN': '有效指标', 'en-US': 'Valid indicator' },
    supports: { seriesKinds: ['ohlcv'] },
    inputs: {
      period: { type: 'number', title: '周期', default: 20, min: 1, max: 500, step: 1 },
      mode: {
        type: 'select',
        title: '模式',
        default: 'fast',
        options: [
          { value: 'fast', label: { 'zh-CN': '快', 'en-US': 'Fast' } },
          { value: 'slow', label: { 'zh-CN': '慢', 'en-US': 'Slow' } },
        ],
      },
      enabled: { type: 'boolean', title: '启用', default: true },
      color: { type: 'color', title: '颜色', default: '#2962ff' },
    },
    create() {
      return { update() {} };
    },
  });

  assert.equal(validateIndicatorDefinition(validDefinition), validDefinition);
  const registry = new IndicatorRegistry();
  assert.equal(registry.register(validDefinition), validDefinition);
  assert.equal(registry.get('fixture.valid'), validDefinition);
  assert.equal(registry.has('fixture.valid'), true);
  assert.equal(validDefinition.apiVersion, 1);
  assert.equal(validDefinition.indicatorVersion, 3);
  registry.register({ ...validDefinition, id: 'fixture.alpha' });
  assert.deepEqual(
    registry.list().map((definition) => definition.id),
    ['fixture.alpha', 'fixture.valid'],
    'registry listing must have deterministic ID ordering',
  );
  assert.throws(
    () => registry.register(validDefinition),
    (error) => error instanceof IndicatorDefinitionValidationError
      && error.code === 'duplicate-id'
      && /fixture\.valid/.test(error.message),
  );

  const invalidSelect = {
    ...validDefinition,
    id: 'fixture.invalid-select',
    inputs: {
      ...validDefinition.inputs,
      mode: {
        type: 'select',
        title: '模式',
        default: 'missing',
        options: [{ value: 'fast', label: 'Fast' }],
      },
    },
  };
  assert.throws(
    () => registry.register(invalidSelect),
    (error) => error instanceof IndicatorDefinitionValidationError
      && error.code === 'invalid-input-default'
      && /fixture\.invalid-select/.test(error.message)
      && /mode/.test(error.message)
      && /missing/.test(error.message),
  );

  assert.throws(
    () => registry.register({
      ...validDefinition,
      id: 'fixture.invalid-active-input',
      inputs: {
        ...validDefinition.inputs,
        color: { ...validDefinition.inputs.color, activeWhen: { field: 'missing', equals: true } },
      },
    }),
    (error) => error instanceof IndicatorDefinitionValidationError
      && error.code === 'invalid-input-definition'
      && /activeWhen/.test(error.message),
  );

  assert.throws(
    () => registry.register({
      ...validDefinition,
      id: 'fixture.self-active-input',
      inputs: {
        ...validDefinition.inputs,
        color: { ...validDefinition.inputs.color, activeWhen: { field: 'color', equals: '#2962ff' } },
      },
    }),
    (error) => error instanceof IndicatorDefinitionValidationError
      && error.code === 'invalid-input-definition'
      && /activeWhen/.test(error.message),
  );

  assert.throws(
    () => registry.register({
      ...validDefinition,
      id: 'fixture.invalid-active-type',
      inputs: {
        ...validDefinition.inputs,
        color: { ...validDefinition.inputs.color, activeWhen: { field: 'enabled', equals: 'true' } },
      },
    }),
    (error) => error instanceof IndicatorDefinitionValidationError
      && error.code === 'invalid-input-definition'
      && /referenced input type/.test(error.message),
  );

  assert.throws(
    () => registry.register({ ...validDefinition, id: 'fixture.unsupported-api', apiVersion: 2 }),
    (error) => error instanceof IndicatorDefinitionValidationError
      && error.code === 'unsupported-api-version'
      && /apiVersion/.test(error.message),
  );
  assert.throws(
    () => registry.register({ ...validDefinition, id: 'fixture.invalid-version', indicatorVersion: 0 }),
    (error) => error instanceof IndicatorDefinitionValidationError
      && error.code === 'invalid-indicator-version'
      && /indicatorVersion/.test(error.message),
  );
  assert.throws(
    () => registry.register({ ...validDefinition, id: 'fixture.invalid id' }),
    (error) => error instanceof IndicatorDefinitionValidationError
      && error.code === 'invalid-id',
  );

  assert.equal(validateIndicatorPaneKey('secondary'), 'secondary');
  assert.throws(
    () => validateIndicatorPaneKey('main'),
    (error) => error instanceof IndicatorDefinitionValidationError
      && error.code === 'reserved-pane-key'
      && /main/.test(error.message),
  );

assert.throws(
  () => new IndicatorRegistry([defineIndicator({
    id: 'test.prediction-not-supported',
    apiVersion: 1,
    indicatorVersion: 1,
    name: 'Prediction fixture',
    supports: { seriesKinds: ['ohlcv'], marketKinds: ['prediction'] },
    inputs: {},
    create() { return { update() {} }; },
  })]),
  /unsupported market kind/,
  'prediction markets stay outside the v1 indicator contract',
);

console.log('indicator SDK contracts, type inference, validation, and registry checks passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
