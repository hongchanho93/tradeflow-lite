import type {
  IndicatorApplicability,
  IndicatorInputDefinition,
  IndicatorInputSchema,
  LocalizedText,
  Resolution,
} from '../indicator-sdk/contracts.ts';
import { isCanonicalMarketSymbol, type MarketSymbolKind } from '../market-universe.ts';
import { USER_INDICATOR_RUNTIME_LIMITS } from './limits.ts';

export const USER_INDICATOR_FORMAT_VERSION = 1 as const;
export const USER_INDICATOR_API_VERSION = 1 as const;

export type UserIndicatorValidationErrorCode =
  | 'source_too_large'
  | 'definition_missing'
  | 'definition_duplicate'
  | 'unsupported_format_version'
  | 'unsupported_user_api_version'
  | 'invalid_definition'
  | 'unsupported_user_runtime_capability'
  | 'async_not_supported'
  | 'execution_timeout'
  | 'memory_limit_exceeded'
  | 'stack_limit_exceeded'
  | 'runtime_exception';

export class UserIndicatorValidationError extends Error {
  readonly code: UserIndicatorValidationErrorCode;
  readonly field?: string;

  constructor(
    code: UserIndicatorValidationErrorCode,
    message: string,
    details: { field?: string } = {},
  ) {
    super(message);
    this.name = 'UserIndicatorValidationError';
    this.code = code;
    this.field = details.field;
  }
}

export interface UserIndicatorManifest {
  readonly formatVersion: typeof USER_INDICATOR_FORMAT_VERSION;
  readonly apiVersion: typeof USER_INDICATOR_API_VERSION;
  readonly id: string;
  readonly indicatorVersion: number;
  readonly name: LocalizedText;
  readonly description?: LocalizedText;
  readonly author?: string;
  readonly inputs: IndicatorInputSchema;
  readonly supports: IndicatorApplicability;
  readonly data?: Readonly<Record<string, Readonly<{
    resolution: Resolution;
    count?: number;
    adjustment?: 'current' | 'none' | 'qfq';
    symbol?: string;
    kind?: Exclude<MarketSymbolKind, 'prediction'>;
    align?: 'none' | 'main' | 'main-ffill';
  }>>>;
}

export interface CapturedUserIndicatorDefinition {
  readonly definitionKeys: readonly string[];
  readonly formatVersion?: unknown;
  readonly apiVersion?: unknown;
  readonly id?: unknown;
  readonly indicatorVersion?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly author?: unknown;
  readonly inputs?: unknown;
  readonly supports?: unknown;
  readonly data?: unknown;
  readonly hasCreate?: unknown;
}

type UnknownRecord = Record<string, unknown>;

const TOP_LEVEL_KEYS = new Set([
  'formatVersion',
  'apiVersion',
  'id',
  'indicatorVersion',
  'name',
  'description',
  'author',
  'inputs',
  'supports',
  'data',
  'create',
]);
const REQUIRED_TOP_LEVEL_KEYS = [
  'formatVersion',
  'apiVersion',
  'id',
  'indicatorVersion',
  'name',
  'inputs',
  'supports',
  'create',
] as const;
const PRESENTATION_KEYS = ['group', 'inline', 'tooltip', 'activeWhen'] as const;
const MARKET_KINDS = new Set(['stock', 'etf', 'index', 'crypto']);
const TRADE_KINDS = new Set(['trade', 'aggregate-trade']);
const RESOLUTIONS = new Set(['1', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M']);
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(
  code: UserIndicatorValidationErrorCode,
  message: string,
  field?: string,
): never {
  throw new UserIndicatorValidationError(code, message, { field });
}

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value: unknown, field: string): UnknownRecord {
  if (!isRecord(value)) fail('invalid_definition', `${field} must be an object`, field);
  return value;
}

function assertAllowedKeys(value: UnknownRecord, allowed: ReadonlySet<string>, field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('invalid_definition', `${field} contains unsupported field ${JSON.stringify(key)}`, `${field}.${key}`);
  }
}

function assertNonEmptyString(
  value: unknown,
  field: string,
  maxChars: number = USER_INDICATOR_RUNTIME_LIMITS.metadataTextChars,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('invalid_definition', `${field} must be a non-empty string`, field);
  }
  if (value.length > maxChars) {
    fail('invalid_definition', `${field} exceeds ${maxChars} characters`, field);
  }
  return value;
}

function validateLocalizedText(
  value: unknown,
  field: string,
  maxChars: number = USER_INDICATOR_RUNTIME_LIMITS.metadataTextChars,
): LocalizedText {
  if (typeof value === 'string') return assertNonEmptyString(value, field, maxChars);
  const localized = assertRecord(value, field);
  assertAllowedKeys(localized, new Set(['zh-CN', 'en-US']), field);
  return {
    'zh-CN': assertNonEmptyString(localized['zh-CN'], `${field}.zh-CN`, maxChars),
    'en-US': assertNonEmptyString(localized['en-US'], `${field}.en-US`, maxChars),
  };
}

function validateFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('invalid_definition', `${field} must be a finite number`, field);
  }
  return value;
}

function validateActiveWhen(value: unknown, field: string): { field: string; equals: string | number | boolean } {
  const condition = assertRecord(value, field);
  assertAllowedKeys(condition, new Set(['field', 'equals']), field);
  const dependency = assertNonEmptyString(condition.field, `${field}.field`, USER_INDICATOR_RUNTIME_LIMITS.inputKeyChars);
  if (!['string', 'number', 'boolean'].includes(typeof condition.equals)) {
    fail('invalid_definition', `${field}.equals must be string, number, or boolean`, `${field}.equals`);
  }
  return { field: dependency, equals: condition.equals as string | number | boolean };
}

function validateInputDefinition(value: unknown, field: string): IndicatorInputDefinition {
  const definition = assertRecord(value, field);
  const type = definition.type;
  if (typeof type !== 'string' || !['number', 'boolean', 'color', 'text', 'select'].includes(type)) {
    fail('invalid_definition', `${field}.type is unsupported`, `${field}.type`);
  }

  const allowed = new Set(['type', 'title', 'default', ...PRESENTATION_KEYS]);
  if (type === 'number') ['min', 'max', 'step'].forEach((key) => allowed.add(key));
  if (type === 'text') allowed.add('maxLength');
  if (type === 'select') allowed.add('options');
  assertAllowedKeys(definition, allowed, field);

  const title = validateLocalizedText(definition.title, `${field}.title`);
  const presentation: Record<string, unknown> = {};
  if (definition.group !== undefined) presentation.group = validateLocalizedText(definition.group, `${field}.group`);
  if (definition.tooltip !== undefined) presentation.tooltip = validateLocalizedText(definition.tooltip, `${field}.tooltip`);
  if (definition.inline !== undefined) {
    presentation.inline = assertNonEmptyString(definition.inline, `${field}.inline`, USER_INDICATOR_RUNTIME_LIMITS.inputKeyChars);
  }
  if (definition.activeWhen !== undefined) presentation.activeWhen = validateActiveWhen(definition.activeWhen, `${field}.activeWhen`);

  if (type === 'number') {
    const defaultValue = validateFiniteNumber(definition.default, `${field}.default`);
    const min = definition.min === undefined ? undefined : validateFiniteNumber(definition.min, `${field}.min`);
    const max = definition.max === undefined ? undefined : validateFiniteNumber(definition.max, `${field}.max`);
    const step = definition.step === undefined ? undefined : validateFiniteNumber(definition.step, `${field}.step`);
    if (min !== undefined && max !== undefined && min > max) fail('invalid_definition', `${field}.min must not exceed max`, `${field}.min`);
    if (step !== undefined && step <= 0) fail('invalid_definition', `${field}.step must be greater than zero`, `${field}.step`);
    if ((min !== undefined && defaultValue < min) || (max !== undefined && defaultValue > max)) {
      fail('invalid_definition', `${field}.default is outside its range`, `${field}.default`);
    }
    return { type, title, default: defaultValue, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), ...(step === undefined ? {} : { step }), ...presentation } as IndicatorInputDefinition;
  }

  if (type === 'boolean') {
    if (typeof definition.default !== 'boolean') fail('invalid_definition', `${field}.default must be boolean`, `${field}.default`);
    return { type, title, default: definition.default, ...presentation } as IndicatorInputDefinition;
  }

  if (type === 'color') {
    const defaultValue = assertNonEmptyString(definition.default, `${field}.default`, 64);
    return { type, title, default: defaultValue, ...presentation } as IndicatorInputDefinition;
  }

  if (type === 'text') {
    if (typeof definition.default !== 'string') fail('invalid_definition', `${field}.default must be a string`, `${field}.default`);
    let maxLength: number | undefined;
    if (definition.maxLength !== undefined) {
      if (!Number.isInteger(definition.maxLength) || (definition.maxLength as number) < 0 || (definition.maxLength as number) > USER_INDICATOR_RUNTIME_LIMITS.textInputMaxLength) {
        fail('invalid_definition', `${field}.maxLength must be an integer from 0 to ${USER_INDICATOR_RUNTIME_LIMITS.textInputMaxLength}`, `${field}.maxLength`);
      }
      maxLength = definition.maxLength as number;
    }
    const effectiveMax = maxLength ?? USER_INDICATOR_RUNTIME_LIMITS.textInputMaxLength;
    if (definition.default.length > effectiveMax) fail('invalid_definition', `${field}.default exceeds maxLength`, `${field}.default`);
    return { type, title, default: definition.default, ...(maxLength === undefined ? {} : { maxLength }), ...presentation } as IndicatorInputDefinition;
  }

  const optionsValue = definition.options;
  if (!Array.isArray(optionsValue) || optionsValue.length === 0 || optionsValue.length > USER_INDICATOR_RUNTIME_LIMITS.selectOptionsPerInput) {
    fail('invalid_definition', `${field}.options must contain 1-${USER_INDICATOR_RUNTIME_LIMITS.selectOptionsPerInput} entries`, `${field}.options`);
  }
  const seen = new Set<string>();
  const options = optionsValue.map((optionValue, index) => {
    const optionField = `${field}.options[${index}]`;
    const option = assertRecord(optionValue, optionField);
    assertAllowedKeys(option, new Set(['value', 'label']), optionField);
    const optionValueString = assertNonEmptyString(option.value, `${optionField}.value`, USER_INDICATOR_RUNTIME_LIMITS.selectValueChars);
    if (seen.has(optionValueString)) fail('invalid_definition', `${field}.options contains duplicate value ${JSON.stringify(optionValueString)}`, `${optionField}.value`);
    seen.add(optionValueString);
    return { value: optionValueString, label: validateLocalizedText(option.label, `${optionField}.label`) };
  });
  if (typeof definition.default !== 'string' || !seen.has(definition.default)) {
    fail('invalid_definition', `${field}.default must match one select option`, `${field}.default`);
  }
  return { type: 'select', title, default: definition.default, options, ...presentation } as IndicatorInputDefinition;
}

function validateInputs(value: unknown): IndicatorInputSchema {
  const inputs = assertRecord(value, 'inputs');
  const entries = Object.entries(inputs);
  if (entries.length > USER_INDICATOR_RUNTIME_LIMITS.inputDefinitions) {
    fail('invalid_definition', `inputs exceeds ${USER_INDICATOR_RUNTIME_LIMITS.inputDefinitions} definitions`, 'inputs');
  }
  const validated: Record<string, IndicatorInputDefinition> = Object.create(null) as Record<string, IndicatorInputDefinition>;
  for (const [key, definition] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) || key.length > USER_INDICATOR_RUNTIME_LIMITS.inputKeyChars) {
      fail('invalid_definition', `input key ${JSON.stringify(key)} is invalid`, `inputs.${key}`);
    }
    if (RESERVED_OBJECT_KEYS.has(key)) {
      fail('invalid_definition', `input key ${JSON.stringify(key)} is reserved`, `inputs.${key}`);
    }
    validated[key] = validateInputDefinition(definition, `inputs.${key}`);
  }

  for (const [key, definition] of Object.entries(validated)) {
    const activeWhen = definition.activeWhen;
    if (!activeWhen) continue;
    if (activeWhen.field === key || !Object.prototype.hasOwnProperty.call(validated, activeWhen.field)) {
      fail('invalid_definition', `inputs.${key}.activeWhen must reference another input`, `inputs.${key}.activeWhen.field`);
    }
    const dependency = validated[activeWhen.field];
    const matches = (dependency.type === 'number' && typeof activeWhen.equals === 'number')
      || (dependency.type === 'boolean' && typeof activeWhen.equals === 'boolean')
      || ((dependency.type === 'color' || dependency.type === 'text') && typeof activeWhen.equals === 'string')
      || (dependency.type === 'select' && typeof activeWhen.equals === 'string' && dependency.options.some((option) => option.value === activeWhen.equals));
    if (!matches) fail('invalid_definition', `inputs.${key}.activeWhen value does not match the referenced input`, `inputs.${key}.activeWhen.equals`);
  }
  return validated;
}

function validateData(value: unknown): UserIndicatorManifest['data'] {
  if (value === undefined) return undefined;
  const data = assertRecord(value, 'data');
  const entries = Object.entries(data);
  if (entries.length > USER_INDICATOR_RUNTIME_LIMITS.dataRequests) {
    fail('invalid_definition', `data exceeds ${USER_INDICATOR_RUNTIME_LIMITS.dataRequests} requests`, 'data');
  }
  const validated: Record<string, {
    resolution: Resolution;
    count?: number;
    adjustment?: 'current' | 'none' | 'qfq';
    symbol?: string;
    kind?: Exclude<MarketSymbolKind, 'prediction'>;
    align?: 'none' | 'main' | 'main-ffill';
  }> = Object.create(null);
  let crossSymbolRequests = 0;
  const crossSymbols = new Set<string>();
  for (const [key, raw] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)
      || key.length > USER_INDICATOR_RUNTIME_LIMITS.inputKeyChars
      || RESERVED_OBJECT_KEYS.has(key)) {
      fail('invalid_definition', `data key ${JSON.stringify(key)} is invalid`, `data.${key}`);
    }
    const request = assertRecord(raw, `data.${key}`);
    assertAllowedKeys(request, new Set(['resolution', 'count', 'adjustment', 'symbol', 'kind', 'align']), `data.${key}`);
    if (typeof request.resolution !== 'string' || !RESOLUTIONS.has(request.resolution)) {
      fail('invalid_definition', `data.${key}.resolution is unsupported`, `data.${key}.resolution`);
    }
    let count: number | undefined;
    if (request.count !== undefined) {
      if (!Number.isInteger(request.count)
        || (request.count as number) < 2
        || (request.count as number) > USER_INDICATOR_RUNTIME_LIMITS.dataBarsPerRequest) {
        fail(
          'invalid_definition',
          `data.${key}.count must be an integer from 2 to ${USER_INDICATOR_RUNTIME_LIMITS.dataBarsPerRequest}`,
          `data.${key}.count`,
        );
      }
      count = request.count as number;
    }
    let adjustment: 'current' | 'none' | 'qfq' | undefined;
    if (request.adjustment !== undefined) {
      if (request.adjustment !== 'current' && request.adjustment !== 'none' && request.adjustment !== 'qfq') {
        fail('invalid_definition', `data.${key}.adjustment is unsupported`, `data.${key}.adjustment`);
      }
      adjustment = request.adjustment;
    }
    let symbol: string | undefined;
    if (request.symbol !== undefined) {
      if (typeof request.symbol !== 'string' || !isCanonicalMarketSymbol(request.symbol)) {
        fail('invalid_definition', `data.${key}.symbol must be a canonical market symbol`, `data.${key}.symbol`);
      }
      symbol = request.symbol;
      crossSymbolRequests += 1;
      crossSymbols.add(symbol);
    }
    let kind: Exclude<MarketSymbolKind, 'prediction'> | undefined;
    if (request.kind !== undefined) {
      if (symbol === undefined) {
        fail('invalid_definition', `data.${key}.kind requires symbol`, `data.${key}.kind`);
      }
      if (!['stock', 'etf', 'index', 'crypto'].includes(String(request.kind))) {
        fail('invalid_definition', `data.${key}.kind is unsupported`, `data.${key}.kind`);
      }
      kind = request.kind as Exclude<MarketSymbolKind, 'prediction'>;
    }
    let align: 'none' | 'main' | 'main-ffill' | undefined;
    if (request.align !== undefined) {
      if (request.align !== 'none' && request.align !== 'main' && request.align !== 'main-ffill') {
        fail('invalid_definition', `data.${key}.align is unsupported`, `data.${key}.align`);
      }
      align = request.align;
    }
    validated[key] = {
      resolution: request.resolution as Resolution,
      ...(count === undefined ? {} : { count }),
      ...(adjustment === undefined ? {} : { adjustment }),
      ...(symbol === undefined ? {} : { symbol }),
      ...(kind === undefined ? {} : { kind }),
      ...(align === undefined ? {} : { align }),
    };
  }
  if (crossSymbolRequests > USER_INDICATOR_RUNTIME_LIMITS.crossSymbolDataRequests) {
    fail(
      'invalid_definition',
      `data exceeds ${USER_INDICATOR_RUNTIME_LIMITS.crossSymbolDataRequests} cross-symbol requests`,
      'data',
    );
  }
  if (crossSymbols.size > USER_INDICATOR_RUNTIME_LIMITS.crossSymbolDataSymbols) {
    fail(
      'invalid_definition',
      `data exceeds ${USER_INDICATOR_RUNTIME_LIMITS.crossSymbolDataSymbols} distinct cross-symbol targets`,
      'data',
    );
  }
  return validated;
}

function validateSupports(value: unknown): IndicatorApplicability {
  const supports = assertRecord(value, 'supports');
  assertAllowedKeys(supports, new Set(['seriesKinds', 'marketKinds', 'requires']), 'supports');
  if (!Array.isArray(supports.seriesKinds) || supports.seriesKinds.length !== 1 || supports.seriesKinds[0] !== 'ohlcv') {
    fail('invalid_definition', `supports.seriesKinds must be exactly ['ohlcv']`, 'supports.seriesKinds');
  }

  let marketKinds: string[] | undefined;
  if (supports.marketKinds !== undefined) {
    if (!Array.isArray(supports.marketKinds) || supports.marketKinds.some((kind) => typeof kind !== 'string' || !MARKET_KINDS.has(kind))) {
      fail('invalid_definition', 'supports.marketKinds contains an unsupported market kind', 'supports.marketKinds');
    }
    marketKinds = [...new Set(supports.marketKinds as string[])];
    if (marketKinds.length !== supports.marketKinds.length) fail('invalid_definition', 'supports.marketKinds must not contain duplicates', 'supports.marketKinds');
  }

  let requires: { depth?: boolean; trades?: ('trade' | 'aggregate-trade')[] } | undefined;
  if (supports.requires !== undefined) {
    const rawRequires = assertRecord(supports.requires, 'supports.requires');
    assertAllowedKeys(rawRequires, new Set(['depth', 'trades']), 'supports.requires');
    if (rawRequires.depth !== undefined && typeof rawRequires.depth !== 'boolean') {
      fail('invalid_definition', 'supports.requires.depth must be boolean', 'supports.requires.depth');
    }
    let trades: ('trade' | 'aggregate-trade')[] | undefined;
    if (rawRequires.trades !== undefined) {
      if (!Array.isArray(rawRequires.trades) || rawRequires.trades.length === 0 || rawRequires.trades.some((kind) => typeof kind !== 'string' || !TRADE_KINDS.has(kind))) {
        fail('invalid_definition', 'supports.requires.trades contains unsupported trade event kinds', 'supports.requires.trades');
      }
      trades = [...rawRequires.trades] as ('trade' | 'aggregate-trade')[];
      if (new Set(trades).size !== trades.length) fail('invalid_definition', 'supports.requires.trades must not contain duplicates', 'supports.requires.trades');
    }
    requires = { ...(rawRequires.depth === undefined ? {} : { depth: rawRequires.depth }), ...(trades === undefined ? {} : { trades }) };
  }

  return {
    seriesKinds: ['ohlcv'],
    ...(marketKinds === undefined ? {} : { marketKinds: marketKinds as IndicatorApplicability['marketKinds'] }),
    ...(requires === undefined ? {} : { requires }),
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function validateCapturedUserIndicatorDefinition(value: unknown): UserIndicatorManifest {
  const captured = assertRecord(value, 'definition capture') as CapturedUserIndicatorDefinition & UnknownRecord;
  if (!Array.isArray(captured.definitionKeys) || captured.definitionKeys.some((key) => typeof key !== 'string')) {
    fail('invalid_definition', 'definition capture is missing own keys');
  }
  for (const key of captured.definitionKeys) {
    if (!TOP_LEVEL_KEYS.has(key)) fail('invalid_definition', `indicator definition contains unsupported field ${JSON.stringify(key)}`, key);
  }
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!captured.definitionKeys.includes(key)) fail('invalid_definition', `indicator definition is missing required field ${key}`, key);
  }

  if (captured.formatVersion !== USER_INDICATOR_FORMAT_VERSION) {
    fail('unsupported_format_version', `unsupported .tfi formatVersion ${JSON.stringify(captured.formatVersion)}; expected ${USER_INDICATOR_FORMAT_VERSION}`, 'formatVersion');
  }
  if (captured.apiVersion !== USER_INDICATOR_API_VERSION) {
    fail('unsupported_user_api_version', `unsupported user indicator apiVersion ${JSON.stringify(captured.apiVersion)}; expected ${USER_INDICATOR_API_VERSION}`, 'apiVersion');
  }
  if (captured.hasCreate !== true) fail('invalid_definition', 'create must be a function', 'create');

  const id = assertNonEmptyString(captured.id, 'id', USER_INDICATOR_RUNTIME_LIMITS.indicatorIdChars);
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(id)) {
    fail('invalid_definition', 'id must be lowercase, namespaced, and use only letters, numbers, ., _, or -', 'id');
  }
  if (typeof captured.indicatorVersion !== 'number' || !Number.isInteger(captured.indicatorVersion) || captured.indicatorVersion < 1) {
    fail('invalid_definition', 'indicatorVersion must be a positive integer', 'indicatorVersion');
  }

  const manifest: UserIndicatorManifest = {
    formatVersion: USER_INDICATOR_FORMAT_VERSION,
    apiVersion: USER_INDICATOR_API_VERSION,
    id,
    indicatorVersion: captured.indicatorVersion,
    name: validateLocalizedText(captured.name, 'name'),
    ...(captured.description === undefined ? {} : { description: validateLocalizedText(captured.description, 'description', USER_INDICATOR_RUNTIME_LIMITS.descriptionChars) }),
    ...(captured.author === undefined ? {} : { author: assertNonEmptyString(captured.author, 'author', USER_INDICATOR_RUNTIME_LIMITS.metadataTextChars) }),
    inputs: validateInputs(captured.inputs),
    supports: validateSupports(captured.supports),
    ...(captured.data === undefined ? {} : { data: validateData(captured.data) }),
  };
  return deepFreeze(manifest);
}

/** Recheck persisted metadata with the same schema, without executing source. */
export function validateUserIndicatorManifest(value: unknown): UserIndicatorManifest {
  const manifest = assertRecord(value, 'manifest');
  assertAllowedKeys(manifest, new Set([...TOP_LEVEL_KEYS].filter(key => key !== 'create')), 'manifest');
  return validateCapturedUserIndicatorDefinition({
    ...manifest,
    definitionKeys: [...Object.keys(manifest), 'create'],
    hasCreate: true,
  });
}
