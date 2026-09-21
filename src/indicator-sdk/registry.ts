import type {
  IndicatorApplicability,
  IndicatorDefinition,
  IndicatorInputDefinition,
  IndicatorInputSchema,
  IndicatorPaneKey,
  LocalizedText,
  MarketSymbolKind,
  SelectOption,
  TradeEventKind,
} from './contracts.ts';
import {
  INDICATOR_API_VERSION,
  SUPPORTED_INDICATOR_API_VERSION,
} from './contracts.ts';

export {
  INDICATOR_API_VERSION,
  SUPPORTED_INDICATOR_API_VERSION,
} from './contracts.ts';

export const RESERVED_INDICATOR_PANE_KEY = 'main' as const;

export type IndicatorDefinitionValidationErrorCode =
  | 'invalid-definition'
  | 'invalid-id'
  | 'invalid-name'
  | 'unsupported-api-version'
  | 'invalid-indicator-version'
  | 'invalid-supports'
  | 'invalid-input-schema'
  | 'invalid-input-definition'
  | 'invalid-input-default'
  | 'invalid-input-range'
  | 'invalid-select-options'
  | 'duplicate-id'
  | 'reserved-pane-key';

export class IndicatorDefinitionValidationError extends Error {
  readonly code: IndicatorDefinitionValidationErrorCode;
  readonly indicatorId?: string;
  readonly field?: string;

  constructor(
    code: IndicatorDefinitionValidationErrorCode,
    message: string,
    details: { indicatorId?: string; field?: string } = {},
  ) {
    super(message);
    this.name = 'IndicatorDefinitionValidationError';
    this.code = code;
    this.indicatorId = details.indicatorId;
    this.field = details.field;
  }
}

type UnknownRecord = Record<string, unknown>;

const MARKET_SYMBOL_KINDS = new Set<MarketSymbolKind>([
  'stock',
  'etf',
  'index',
  'crypto',
]);
const TRADE_EVENT_KINDS = new Set<TradeEventKind>(['trade', 'aggregate-trade']);
const INPUT_TYPES = new Set<IndicatorInputDefinition['type']>([
  'number',
  'boolean',
  'color',
  'text',
  'select',
]);

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function display(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function fail(
  code: IndicatorDefinitionValidationErrorCode,
  message: string,
  details?: { indicatorId?: string; field?: string },
): never {
  throw new IndicatorDefinitionValidationError(code, message, details);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateLocalizedText(
  value: unknown,
  location: string,
  indicatorId?: string,
): LocalizedText {
  if (nonEmptyString(value)) return value;
  if (isRecord(value)
    && nonEmptyString(value['zh-CN'])
    && nonEmptyString(value['en-US'])) {
    return value as LocalizedText;
  }
  fail('invalid-name', `${location} must be a non-empty string or contain zh-CN and en-US text`, {
    indicatorId,
  });
}

function validateId(value: unknown): string {
  if (typeof value !== 'string'
    || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(value)) {
    fail(
      'invalid-id',
      `indicator id ${display(value)} must be lowercase, namespaced, and use only letters, numbers, ., _, or -`,
    );
  }
  return value;
}

function validateVersion(value: unknown, indicatorId: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fail(
      'invalid-indicator-version',
      `indicator ${indicatorId} indicatorVersion must be a positive integer`,
      { indicatorId, field: 'indicatorVersion' },
    );
  }
  return value;
}

function validateFiniteNumber(
  value: unknown,
  label: string,
  indicatorId: string,
  field: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(
      'invalid-input-definition',
      `indicator ${indicatorId} input ${field} ${label} must be a finite number`,
      { indicatorId, field },
    );
  }
  return value;
}

function validateSelectOptions(
  value: unknown,
  indicatorId: string,
  field: string,
): readonly SelectOption[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      'invalid-select-options',
      `indicator ${indicatorId} input ${field} select options must be a non-empty array`,
      { indicatorId, field },
    );
  }
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const option = value[index];
    if (!isRecord(option) || !nonEmptyString(option.value)) {
      fail(
        'invalid-select-options',
        `indicator ${indicatorId} input ${field} option ${index} must have a non-empty string value`,
        { indicatorId, field },
      );
    }
    if (seen.has(option.value)) {
      fail(
        'invalid-select-options',
        `indicator ${indicatorId} input ${field} has duplicate select option ${display(option.value)}`,
        { indicatorId, field },
      );
    }
    seen.add(option.value);
    validateLocalizedText(option.label, `indicator ${indicatorId} input ${field} option ${index} label`, indicatorId);
  }
  return value as readonly SelectOption[];
}

function validateInputDefinition(
  value: unknown,
  indicatorId: string,
  field: string,
): IndicatorInputDefinition {
  if (!isRecord(value) || typeof value.type !== 'string' || !INPUT_TYPES.has(value.type as IndicatorInputDefinition['type'])) {
    fail(
      'invalid-input-definition',
      `indicator ${indicatorId} input ${field} has an unsupported definition`,
      { indicatorId, field },
    );
  }
  validateLocalizedText(value.title, `indicator ${indicatorId} input ${field} title`, indicatorId);
  if (value.group !== undefined) {
    validateLocalizedText(value.group, `indicator ${indicatorId} input ${field} group`, indicatorId);
  }
  if (value.tooltip !== undefined) {
    validateLocalizedText(value.tooltip, `indicator ${indicatorId} input ${field} tooltip`, indicatorId);
  }
  if (value.inline !== undefined && !nonEmptyString(value.inline)) {
    fail('invalid-input-definition', `indicator ${indicatorId} input ${field} inline must be a non-empty string`, {
      indicatorId,
      field,
    });
  }

  switch (value.type) {
    case 'number': {
      const defaultValue = validateFiniteNumber(value.default, 'default', indicatorId, field);
      const min = value.min === undefined
        ? undefined
        : validateFiniteNumber(value.min, 'min', indicatorId, field);
      const max = value.max === undefined
        ? undefined
        : validateFiniteNumber(value.max, 'max', indicatorId, field);
      const step = value.step === undefined
        ? undefined
        : validateFiniteNumber(value.step, 'step', indicatorId, field);
      if (min !== undefined && max !== undefined && min > max) {
        fail(
          'invalid-input-range',
          `indicator ${indicatorId} input ${field} min must not exceed max`,
          { indicatorId, field },
        );
      }
      if (step !== undefined && step <= 0) {
        fail(
          'invalid-input-range',
          `indicator ${indicatorId} input ${field} step must be greater than zero`,
          { indicatorId, field },
        );
      }
      if ((min !== undefined && defaultValue < min) || (max !== undefined && defaultValue > max)) {
        fail(
          'invalid-input-default',
          `indicator ${indicatorId} input ${field} default ${display(defaultValue)} is outside its range`,
          { indicatorId, field },
        );
      }
      return value as IndicatorInputDefinition;
    }
    case 'boolean':
      if (typeof value.default !== 'boolean') {
        fail(
          'invalid-input-default',
          `indicator ${indicatorId} input ${field} boolean default must be a boolean`,
          { indicatorId, field },
        );
      }
      return value as IndicatorInputDefinition;
    case 'color':
      if (!nonEmptyString(value.default)) {
        fail(
          'invalid-input-default',
          `indicator ${indicatorId} input ${field} color default must be a non-empty string`,
          { indicatorId, field },
        );
      }
      return value as IndicatorInputDefinition;
    case 'text': {
      if (typeof value.default !== 'string') {
        fail(
          'invalid-input-default',
          `indicator ${indicatorId} input ${field} text default must be a string`,
          { indicatorId, field },
        );
      }
      if (value.maxLength !== undefined) {
        if (typeof value.maxLength !== 'number' || !Number.isInteger(value.maxLength) || value.maxLength < 0) {
          fail(
            'invalid-input-range',
            `indicator ${indicatorId} input ${field} maxLength must be a non-negative integer`,
            { indicatorId, field },
          );
        }
        if (value.default.length > value.maxLength) {
          fail(
            'invalid-input-default',
            `indicator ${indicatorId} input ${field} text default exceeds maxLength`,
            { indicatorId, field },
          );
        }
      }
      return value as IndicatorInputDefinition;
    }
    case 'select': {
      const options = validateSelectOptions(value.options, indicatorId, field);
      if (typeof value.default !== 'string' || !options.some((option) => option.value === value.default)) {
        fail(
          'invalid-input-default',
          `indicator ${indicatorId} input ${field} select default ${display(value.default)} is not present in options`,
          { indicatorId, field },
        );
      }
      return value as IndicatorInputDefinition;
    }
    default:
      fail(
        'invalid-input-definition',
        `indicator ${indicatorId} input ${field} has an unsupported definition`,
        { indicatorId, field },
      );
  }
}

export function validateIndicatorInputSchema(
  value: unknown,
  indicatorId = '<unknown>',
): IndicatorInputSchema {
  if (!isRecord(value)) {
    fail('invalid-input-schema', `indicator ${indicatorId} inputs must be an object`, {
      indicatorId,
      field: 'inputs',
    });
  }
  for (const [field, definition] of Object.entries(value)) {
    if (!nonEmptyString(field)) {
      fail('invalid-input-schema', `indicator ${indicatorId} input names must be non-empty`, {
        indicatorId,
        field,
      });
    }
    validateInputDefinition(definition, indicatorId, field);
  }
  for (const [field, definition] of Object.entries(value)) {
    if (!isRecord(definition) || definition.activeWhen === undefined) continue;
    if (!isRecord(definition.activeWhen)
      || !nonEmptyString(definition.activeWhen.field)
      || definition.activeWhen.field === field
      || !Object.prototype.hasOwnProperty.call(value, definition.activeWhen.field)
      || !['string', 'number', 'boolean'].includes(typeof definition.activeWhen.equals)) {
      fail(
        'invalid-input-definition',
        `indicator ${indicatorId} input ${field} activeWhen must reference another input and a scalar value`,
        { indicatorId, field },
      );
    }
    const activeWhen = definition.activeWhen as UnknownRecord & {
      field: string;
      equals: string | number | boolean;
    };
    const dependency = value[activeWhen.field];
    const matchesDependency = isRecord(dependency) && (
      (dependency.type === 'number' && typeof activeWhen.equals === 'number')
      || (dependency.type === 'boolean' && typeof activeWhen.equals === 'boolean')
      || ((dependency.type === 'color' || dependency.type === 'text') && typeof activeWhen.equals === 'string')
      || (dependency.type === 'select'
        && typeof activeWhen.equals === 'string'
        && Array.isArray(dependency.options)
        && dependency.options.some((option) => isRecord(option) && option.value === activeWhen.equals))
    );
    if (!matchesDependency) {
      fail(
        'invalid-input-definition',
        `indicator ${indicatorId} input ${field} activeWhen value must match the referenced input type`,
        { indicatorId, field },
      );
    }
  }
  return value as IndicatorInputSchema;
}

function validateSupports(value: unknown, indicatorId: string): IndicatorApplicability {
  if (!isRecord(value)
    || !Array.isArray(value.seriesKinds)
    || value.seriesKinds.length !== 1
    || value.seriesKinds[0] !== 'ohlcv') {
    fail(
      'invalid-supports',
      `indicator ${indicatorId} supports.seriesKinds must be exactly ['ohlcv']`,
      { indicatorId, field: 'supports' },
    );
  }

  if (value.marketKinds !== undefined) {
    if (!Array.isArray(value.marketKinds)
      || value.marketKinds.some((kind) => typeof kind !== 'string' || !MARKET_SYMBOL_KINDS.has(kind as MarketSymbolKind))) {
      fail(
        'invalid-supports',
        `indicator ${indicatorId} supports.marketKinds contains an unsupported market kind`,
        { indicatorId, field: 'supports.marketKinds' },
      );
    }
  }

  if (value.requires !== undefined) {
    if (!isRecord(value.requires)) {
      fail('invalid-supports', `indicator ${indicatorId} supports.requires must be an object`, {
        indicatorId,
        field: 'supports.requires',
      });
    }
    if (value.requires.depth !== undefined && typeof value.requires.depth !== 'boolean') {
      fail('invalid-supports', `indicator ${indicatorId} supports.requires.depth must be boolean`, {
        indicatorId,
        field: 'supports.requires.depth',
      });
    }
    if (value.requires.trades !== undefined) {
      if (!Array.isArray(value.requires.trades)
        || value.requires.trades.length === 0
        || value.requires.trades.some((kind) => typeof kind !== 'string' || !TRADE_EVENT_KINDS.has(kind as TradeEventKind))) {
        fail(
          'invalid-supports',
          `indicator ${indicatorId} supports.requires.trades must contain supported trade event kinds`,
          { indicatorId, field: 'supports.requires.trades' },
        );
      }
      if (new Set(value.requires.trades).size !== value.requires.trades.length) {
        fail(
          'invalid-supports',
          `indicator ${indicatorId} supports.requires.trades must not contain duplicates`,
          { indicatorId, field: 'supports.requires.trades' },
        );
      }
    }
  }
  return value as unknown as IndicatorApplicability;
}

export function validateIndicatorDefinition<S extends IndicatorInputSchema>(
  value: IndicatorDefinition<S>,
): IndicatorDefinition<S>;
export function validateIndicatorDefinition(value: unknown): IndicatorDefinition;
export function validateIndicatorDefinition(value: unknown): IndicatorDefinition {
  if (!isRecord(value)) fail('invalid-definition', 'indicator definition must be an object');
  const indicatorId = validateId(value.id);
  if (value.apiVersion !== SUPPORTED_INDICATOR_API_VERSION) {
    fail(
      'unsupported-api-version',
      `indicator ${indicatorId} apiVersion ${display(value.apiVersion)} is not supported; expected ${SUPPORTED_INDICATOR_API_VERSION}`,
      { indicatorId, field: 'apiVersion' },
    );
  }
  validateVersion(value.indicatorVersion, indicatorId);
  validateLocalizedText(value.name, `indicator ${indicatorId} name`, indicatorId);
  if (value.description !== undefined) {
    validateLocalizedText(value.description, `indicator ${indicatorId} description`, indicatorId);
  }
  if (value.author !== undefined && !nonEmptyString(value.author)) {
    fail('invalid-definition', `indicator ${indicatorId} author must be a non-empty string`, {
      indicatorId,
      field: 'author',
    });
  }
  validateSupports(value.supports, indicatorId);
  validateIndicatorInputSchema(value.inputs, indicatorId);
  if (typeof value.create !== 'function') {
    fail('invalid-definition', `indicator ${indicatorId} create must be a function`, {
      indicatorId,
      field: 'create',
    });
  }
  if (value.migrateInputs !== undefined && typeof value.migrateInputs !== 'function') {
    fail('invalid-definition', `indicator ${indicatorId} migrateInputs must be a function`, {
      indicatorId,
      field: 'migrateInputs',
    });
  }
  return value as unknown as IndicatorDefinition;
}

export function isReservedIndicatorPaneKey(key: string): boolean {
  return key === RESERVED_INDICATOR_PANE_KEY;
}

export function validateIndicatorPaneKey(key: unknown): IndicatorPaneKey {
  if (typeof key !== 'string' || key.trim().length === 0) {
    fail('invalid-definition', 'indicator pane key must be a non-empty string', { field: 'paneKey' });
  }
  if (isReservedIndicatorPaneKey(key)) {
    fail('reserved-pane-key', `indicator pane key ${JSON.stringify(key)} is reserved for the main pane`, {
      field: 'paneKey',
    });
  }
  return key;
}

export interface IndicatorRegistryMetadata {
  readonly id: string;
  readonly apiVersion: typeof INDICATOR_API_VERSION;
  readonly indicatorVersion: number;
  readonly name: LocalizedText;
  readonly description?: LocalizedText;
  readonly supports: IndicatorApplicability;
}

// Registry storage is intentionally type-erased: each definition keeps its own
// input schema, while the runtime selects the schema after it has looked up the ID.
type RegisteredIndicatorDefinition = IndicatorDefinition;

export class IndicatorRegistry {
  private readonly definitions = new Map<string, RegisteredIndicatorDefinition>();

  constructor(definitions: readonly RegisteredIndicatorDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register<S extends IndicatorInputSchema>(definition: IndicatorDefinition<S>): IndicatorDefinition<S> {
    const validated = validateIndicatorDefinition(definition);
    if (this.definitions.has(validated.id)) {
      fail(
        'duplicate-id',
        `indicator id ${JSON.stringify(validated.id)} is already registered`,
        { indicatorId: validated.id, field: 'id' },
      );
    }
    this.definitions.set(validated.id, validated);
    return definition;
  }

  registerAll(definitions: readonly RegisteredIndicatorDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  get(id: string): RegisteredIndicatorDefinition | undefined {
    return this.definitions.get(id);
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  unregister(id: string): boolean {
    return this.definitions.delete(id);
  }

  list(): readonly RegisteredIndicatorDefinition[] {
    return [...this.definitions.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  }

  listMetadata(): readonly IndicatorRegistryMetadata[] {
    return this.list().map((definition) => ({
      id: definition.id,
      apiVersion: definition.apiVersion,
      indicatorVersion: definition.indicatorVersion,
      name: definition.name,
      ...(definition.description === undefined ? {} : { description: definition.description }),
      supports: definition.supports,
    }));
  }
}
