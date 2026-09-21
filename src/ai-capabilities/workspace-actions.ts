import { CapabilityError, type JsonValue, type ToolDefinition,
  type ToolExecutionContext, type ToolTransaction, type ValueSchema } from './contracts.ts';
import { objectSchema } from './chart-data.ts';
import { parseJson, ValueValidationError } from './json.ts';
import type { IndicatorInputSchema } from '../indicator-sdk/contracts.ts';
import { isCanonicalMarketSymbol } from '../market-universe.ts';

export type WatchlistChange =
  | { op: 'add'; items: readonly { providerId: string; symbol: string }[] }
  | { op: 'remove'; keys: readonly string[] }
  | { op: 'move'; key: string; index: number };
export type IndicatorChange =
  | { op: 'add'; indicatorId: string; inputsJson?: string; visible?: boolean }
  | { op: 'remove' | 'retry'; instanceId: string }
  | { op: 'inputs'; instanceId: string; inputsJson: string }
  | { op: 'visibility'; instanceId: string; visible: boolean };
export interface WorkspaceActionHost {
  prepareWatchlist(change: WatchlistChange, execution: ToolExecutionContext): ToolTransaction | Promise<ToolTransaction>;
  prepareIndicator(change: IndicatorChange, execution: ToolExecutionContext): ToolTransaction | Promise<ToolTransaction>;
  indicatorInputs(instanceId: string): { instanceId: string; indicatorId: string; inputsJson: string; schemaJson: string };
}

/** Strict patch validation; bad values never silently fall back to an unrelated default. */
export function parseIndicatorInputPatch(schema: IndicatorInputSchema, text = '{}', previous: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  const patch = parseJson(text, 32 * 1024).value;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValueValidationError('inputsJson', 'type_mismatch', 'JSON object of indicator input fields');
  }
  const unknown = Object.keys(patch).find(key => !Object.hasOwn(schema, key));
  if (unknown) {
    throw new ValueValidationError(`inputsJson.${unknown}`, 'unknown_field', `one of: ${Object.keys(schema).join(', ') || '(none)'}`);
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, definition] of Object.entries(schema)) {
    const value = Object.hasOwn(patch, key) ? (patch as Record<string, unknown>)[key] : previous[key] ?? definition.default;
    const path = `inputsJson.${key}`;
    switch (definition.type) {
      case 'number': {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new ValueValidationError(path, 'type_mismatch', 'finite number');
        }
        if ((definition.min !== undefined && value < definition.min)
          || (definition.max !== undefined && value > definition.max)) {
          throw new ValueValidationError(path, 'out_of_range', `number${definition.min === undefined ? '' : ` >= ${definition.min}`}${definition.max === undefined ? '' : ` <= ${definition.max}`}`);
        }
        if (definition.step !== undefined) {
          const quotient = ((value as number) - (definition.min ?? 0)) / definition.step;
          if (Math.abs(quotient - Math.round(quotient)) > 1e-8 * Math.max(1, Math.abs(quotient))) {
            throw new ValueValidationError(path, 'step_mismatch', `step ${definition.step}${definition.min === undefined ? '' : ` from ${definition.min}`}`);
          }
        }
        break;
      }
      case 'boolean':
        if (typeof value !== 'boolean') throw new ValueValidationError(path, 'type_mismatch', 'boolean');
        break;
      case 'text':
        if (typeof value !== 'string') throw new ValueValidationError(path, 'type_mismatch', 'string');
        if (value.length > (definition.maxLength ?? 8192)) {
          throw new ValueValidationError(path, 'max_length_exceeded', `string length <= ${definition.maxLength ?? 8192}`);
        }
        break;
      case 'color':
        if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) {
          throw new ValueValidationError(path, 'invalid_color', '#RGB, #RGBA, #RRGGBB, or #RRGGBBAA');
        }
        break;
      case 'select':
        if (typeof value !== 'string' || !definition.options.some(option => option.value === value)) {
          throw new ValueValidationError(path, 'invalid_option', `one of: ${definition.options.map(option => option.value).join(', ')}`);
        }
        break;
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

const text = (maxLength = 256): ValueSchema => ({ type: 'string', maxLength });
const index: ValueSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const watchlistChangeSchema = objectSchema({ changed: { type: 'boolean' }, count: index });
export const indicatorChangeSchema = objectSchema({ instanceId: text(), indicatorId: text(),
  state: { type: 'string', enum: ['configured', 'removed', 'hidden', 'visible'] } });

export function createWorkspaceActionTools(host: WorkspaceActionHost): readonly ToolDefinition[] {
  const write = (id: string, description: string, inputSchema: ValueSchema,
    prepare: (input: JsonValue, ctx: ToolExecutionContext) => ToolTransaction | Promise<ToolTransaction>): ToolDefinition => ({
    id, version: 1, scope: 'app', effect: 'write', description, inputSchema, outputSchema: watchlistChangeSchema,
    run() { throw new CapabilityError('invalid_contract'); }, prepare,
  });
  const indicator = (id: string, description: string, inputSchema: ValueSchema,
    change: (input: any) => IndicatorChange): ToolDefinition => ({
    id, version: 1, scope: 'chart', effect: 'write', description, inputSchema, outputSchema: indicatorChangeSchema,
    run() { throw new CapabilityError('invalid_contract'); },
    prepare: (input, ctx) => host.prepareIndicator(change(input), ctx),
  });
  return [
    write('tf.watchlist.add', 'Add symbols to the existing watchlist without duplicates or changing the chart. Provider-qualified identities, not a new list.',
      objectSchema({ items: { type: 'array', maxItems: 100, items: objectSchema({ providerId: text(64), symbol: text(129) }) } }), (input, ctx) => {
        const { items } = input as unknown as Extract<WatchlistChange, { op: 'add' }>;
        if (!items.length || items.some(item => !/^[A-Za-z0-9._-]{1,64}$/.test(item.providerId) || !isCanonicalMarketSymbol(item.symbol))) throw new CapabilityError('invalid_request');
        return host.prepareWatchlist({ op: 'add', items }, ctx);
      }),
    write('tf.watchlist.remove', 'Remove only the selected watchlist keys, including unresolved entries. Read tf_watchlist_list for exact keys.',
      objectSchema({ keys: { type: 'array', maxItems: 100, items: text() } }), (input, ctx) => {
        const { keys } = input as unknown as Extract<WatchlistChange, { op: 'remove' }>;
        if (!keys.length) throw new CapabilityError('invalid_request'); return host.prepareWatchlist({ op: 'remove', keys }, ctx);
      }),
    write('tf.watchlist.move', 'Move an existing watchlist key to a zero-based index, preserving all other entries.',
      objectSchema({ key: text(), index }), (input, ctx) => host.prepareWatchlist({ ...(input as any), op: 'move' }, ctx)),
    indicator('tf.indicator.add', 'Add an installed indicator to this chart. Omitted inputs use its defaults; inputsJson is a JSON object of parameter values, never code.',
      objectSchema({ indicatorId: text(), inputsJson: text(32768), visible: { type: 'boolean' } }, ['indicatorId']), input => ({ ...input, op: 'add' })),
    indicator('tf.indicator.remove', 'Remove one indicator instance, leaving its installed definition and unrelated indicators unchanged.',
      objectSchema({ instanceId: text() }), input => ({ ...input, op: 'remove' })),
    indicator('tf.indicator.inputs_set', 'Update specified parameters of an existing indicator. Preserve its identity, other parameters, visibility and pane layout.',
      objectSchema({ instanceId: text(), inputsJson: text(32768) }), input => ({ ...input, op: 'inputs' })),
    indicator('tf.indicator.visibility', 'Show or hide one indicator without deleting its parameters or definition.',
      objectSchema({ instanceId: text(), visible: { type: 'boolean' } }), input => ({ ...input, op: 'visibility' })),
    indicator('tf.indicator.retry', 'Retry one failed installed indicator in its current chart context. No source modification.',
      objectSchema({ instanceId: text() }), input => ({ ...input, op: 'retry' })),
    { id: 'tf.indicator.inputs_get', version: 1, scope: 'chart', effect: 'read',
      description: 'Read current parameter values and the installed parameter schema for one chart indicator.',
      inputSchema: objectSchema({ instanceId: text() }),
      outputSchema: objectSchema({ instanceId: text(), indicatorId: text(), inputsJson: text(32768), schemaJson: text(128 * 1024) }),
      run: input => host.indicatorInputs((input as { instanceId: string }).instanceId) },
  ];
}
