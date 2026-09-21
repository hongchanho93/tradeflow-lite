import { compileSchema, snapshotJson, validateValue } from '../ai-capabilities/json.ts';
import type { JsonValue, ValueSchema } from '../ai-capabilities/contracts.ts';
import { isCanonicalMarketSymbol, type MarketSymbolKind } from '../market-universe.ts';

export class TaskError extends Error {
  readonly code: string;
  readonly path?: string;
  readonly reason?: string;
  readonly expected?: string;
  constructor(code: string, diagnostic: Readonly<{ path?: string; reason?: string; expected?: string }> = {}) {
    super(code); this.name = 'TaskError'; this.code = code;
    const clean = (value: string | undefined, max: number) => typeof value === 'string' && value.length > 0
      ? value.slice(0, max) : undefined;
    this.path = clean(diagnostic.path, 256);
    this.reason = clean(diagnostic.reason, 256);
    this.expected = clean(diagnostic.expected, 512);
  }
}
/** Engineering budgets, not a permanent product/universe restriction. */
export const TASK_LIMITS = Object.freeze({ sourceBytes: 256 * 1024, heapBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024, stepMs: 1500, hardStepMs: 5000, inputBytes: 8 * 1024 * 1024,
  outputBytes: 4 * 1024 * 1024, parametersBytes: 64 * 1024, manifestBytes: 64 * 1024,
  resultBytes: 32 * 1024 * 1024, totalResultBytes: 64 * 1024 * 1024, resultRows: 100_000,
  pageRows: 250, catalogPage: 256, universe: 100_000, catalogPages: 10_000,
  runs: 16, activeRuns: 2, taskWallMs: 4 * 60 * 60_000, ioMs: 120_000,
  libraryItems: 4_096, libraryBytes: 16 * 1024 * 1024 });

export type TaskSymbol = Readonly<{ providerId: string; symbol: string; kind: MarketSymbolKind; name: string }>;
export type HistoryNeed = Readonly<{ id: string; resolution: string; adjustment: 'none' | 'qfq'; count: number }>;
export type ArtifactColumn = Readonly<{ id: string; title: string; type: 'string' | 'number' | 'boolean' | 'symbol' }>;
export type ArtifactDescriptor = Readonly<{ id: string; title: string; type: 'table' | 'symbol_list' | 'series' | 'report'; columns?: readonly ArtifactColumn[] }>;
export interface TaskManifest {
  readonly formatVersion: 1; readonly apiVersion: 1; readonly id: string; readonly version: number;
  readonly name: string; readonly description: string; readonly inputSchema: ValueSchema; readonly defaults: JsonValue;
  readonly history: readonly HistoryNeed[]; readonly outputs: readonly ArtifactDescriptor[];
}
export const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export function exact(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value, k))) throw new TaskError('task_invalid_contract');
}
export const text = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const identifier = (v: unknown): v is string => text(v, 96) && /^[a-z][a-z0-9._-]*$/.test(v) && !['constructor','prototype','__proto__'].includes(v);
const invalid = (): never => { throw new TaskError('task_invalid_output'); };
const manifestError = (path: string, reason: string, expected: string): never => {
  throw new TaskError('task_invalid_manifest', { path, reason, expected });
};
function manifestExact(value: unknown, allowed: readonly string[], required: readonly string[], path: string): asserts value is Record<string, unknown> {
  if (!object(value)) manifestError(path, 'not_object', 'an object with only the documented fields');
  const record = value as Record<string, unknown>;
  const unexpected = Object.keys(record).find(key => !allowed.includes(key));
  if (unexpected) manifestError(`${path}.${unexpected}`, 'unexpected_field', `one of: ${allowed.join(', ')}`);
  const missing = required.find(key => !Object.hasOwn(record, key));
  if (missing) manifestError(`${path}.${missing}`, 'required_field_missing', 'a required field');
}

/** Large task batches use an independent node budget; the normal Tool envelope stays unchanged.
 * Read data descriptors only, never getters/toJSON, and reject non-finite values before serialization. */
export function taskJson(value: unknown, maxBytes: number = TASK_LIMITS.outputBytes): JsonValue {
  let nodes = 0, measured = 0;
  const ancestors = new Set<object>(), encoder = new TextEncoder();
  const account = (s: string) => { measured += encoder.encode(s).length; if (measured > maxBytes) throw new TaskError('task_output_limit'); };
  const visit = (v: unknown, depth: number): JsonValue => {
    if (++nodes > 300_000 || depth > 32) throw new TaskError('task_output_limit');
    if (v === null || typeof v === 'boolean') { account(String(v)); return v; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) return invalid(); account(String(v)); return v === 0 ? 0 : v; }
    if (typeof v === 'string') { if (v.length > maxBytes) throw new TaskError('task_output_limit'); account(JSON.stringify(v)); return v; }
    if (typeof v !== 'object' || ancestors.has(v)) return invalid();
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if ((!array && proto !== Object.prototype && proto !== null) || Object.getOwnPropertySymbols(v).length) return invalid();
    const keys = Object.getOwnPropertyNames(v);
    if (array && keys.length !== v.length + 1) return invalid();
    ancestors.add(v); account(array ? '[]' : '{}');
    const read = (key: string) => {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !('value' in d) || !d.enumerable || ['__proto__','constructor','prototype'].includes(key)) return invalid();
      return visit(d.value, depth + 1);
    };
    let result: JsonValue;
    if (array) {
      const list: JsonValue[] = []; for (let i = 0; i < v.length; i++) { account(','); list.push(read(String(i))); }
      result = Object.freeze(list);
    } else {
      const copy: Record<string, JsonValue> = Object.create(null);
      for (const key of keys) { account(`${JSON.stringify(key)}:,`); copy[key] = read(key); }
      result = Object.freeze(copy);
    }
    ancestors.delete(v); return result;
  };
  return visit(value, 0);
}
export function taskSymbol(value: unknown): TaskSymbol {
  exact(value, ['providerId','symbol','kind','name'], ['providerId','symbol','kind']);
  if (!text(value.providerId, 128) || !text(value.symbol, 160) || !isCanonicalMarketSymbol(value.symbol)
    || !['stock','etf','index','crypto','prediction'].includes(value.kind as string)
    || (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 256))) return invalid();
  return Object.freeze({ providerId: value.providerId, symbol: value.symbol, kind: value.kind as MarketSymbolKind, name: value.name as string ?? value.symbol });
}
export function validateTaskManifest(value: unknown): TaskManifest {
  manifestExact(value, ['formatVersion','apiVersion','id','version','name','description','inputSchema','defaults','history','outputs'],
    ['formatVersion','apiVersion','id','version','name','history','outputs'], 'manifest');
  if (value.formatVersion !== 1) throw new TaskError('task_unsupported_version', { path: 'manifest.formatVersion', reason: 'unsupported_version', expected: '1' });
  if (value.apiVersion !== 1) throw new TaskError('task_unsupported_version', { path: 'manifest.apiVersion', reason: 'unsupported_version', expected: '1' });
  if (!identifier(value.id)) manifestError('manifest.id', 'invalid_identifier', 'lowercase identifier matching ^[a-z][a-z0-9._-]*$');
  if (!text(value.name, 128)) manifestError('manifest.name', 'invalid_text', 'non-empty text up to 128 characters');
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) manifestError('manifest.version', 'invalid_version', 'a positive safe integer');
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 2048)) {
    manifestError('manifest.description', 'invalid_text', 'text up to 2048 characters');
  }
  if (!Array.isArray(value.history) || !value.history.length || value.history.length > 8) {
    manifestError('manifest.history', 'invalid_array_length', '1 to 8 history window declarations');
  }
  if (!Array.isArray(value.outputs) || !value.outputs.length || value.outputs.length > 16) {
    manifestError('manifest.outputs', 'invalid_array_length', '1 to 16 output declarations');
  }
  const historyValues = value.history as unknown[];
  const outputValues = value.outputs as unknown[];
  const history = historyValues.map((v, index) => {
    const path = `manifest.history[${index}]`;
    manifestExact(v, ['id','resolution','count','adjustment'], ['id','resolution','count','adjustment'], path);
    if (!identifier(v.id)) manifestError(`${path}.id`, 'invalid_identifier', 'lowercase identifier matching ^[a-z][a-z0-9._-]*$');
    if (!text(v.resolution, 32)) manifestError(`${path}.resolution`, 'invalid_text', 'a non-empty resolution string up to 32 characters');
    if (!['none','qfq'].includes(v.adjustment as string)) manifestError(`${path}.adjustment`, 'unsupported_value', 'none or qfq');
    if (!Number.isInteger(v.count) || (v.count as number) < 1 || (v.count as number) > 12_000) {
      manifestError(`${path}.count`, 'out_of_range', 'an integer from 1 to 12000');
    }
    return Object.freeze({ id: v.id as string, resolution: v.resolution as string, count: v.count as number, adjustment: v.adjustment as 'none' | 'qfq' });
  });
  const outputs: ArtifactDescriptor[] = outputValues.map((v, index) => {
    const path = `manifest.outputs[${index}]`;
    manifestExact(v, ['id','type','title','columns'], ['id','type','title'], path);
    if (!identifier(v.id)) manifestError(`${path}.id`, 'invalid_identifier', 'lowercase identifier matching ^[a-z][a-z0-9._-]*$');
    if (!text(v.title, 128)) manifestError(`${path}.title`, 'invalid_text', 'non-empty text up to 128 characters');
    if (!['table','symbol_list','series','report'].includes(v.type as string)) {
      manifestError(`${path}.type`, 'unsupported_value', 'table, symbol_list, series, or report');
    }
    if (v.type !== 'table' && v.columns !== undefined) manifestError(`${path}.columns`, 'unexpected_field', 'columns is only valid for table outputs');
    let columns: readonly ArtifactColumn[] | undefined;
    if (v.type === 'table') {
      if (!Array.isArray(v.columns) || !v.columns.length || v.columns.length > 32) {
        manifestError(`${path}.columns`, 'invalid_array_length', '1 to 32 table column declarations');
      }
      const columnValues = v.columns as unknown[];
      const validatedColumns = Object.freeze(columnValues.map((c, columnIndex) => {
        const columnPath = `${path}.columns[${columnIndex}]`;
        manifestExact(c, ['id','title','type'], ['id','title','type'], columnPath);
        if (!identifier(c.id)) manifestError(`${columnPath}.id`, 'invalid_identifier', 'lowercase identifier matching ^[a-z][a-z0-9._-]*$');
        if (!text(c.title, 128)) manifestError(`${columnPath}.title`, 'invalid_text', 'non-empty text up to 128 characters');
        if (!['string','number','boolean','symbol'].includes(c.type as string)) {
          manifestError(`${columnPath}.type`, 'unsupported_value', 'string, number, boolean, or symbol');
        }
        return Object.freeze({ id: c.id as string, title: c.title as string, type: c.type as ArtifactColumn['type'] });
      }));
      if (new Set(validatedColumns.map(c => c.id)).size !== validatedColumns.length) {
        manifestError(`${path}.columns`, 'duplicate_identifier', 'unique column ids');
      }
      columns = validatedColumns;
    }
    return Object.freeze({ id: v.id as string, title: v.title as string, type: v.type as ArtifactDescriptor['type'], ...(columns ? { columns } : {}) });
  });
  if (new Set(history.map(h => h.id)).size !== history.length) manifestError('manifest.history', 'duplicate_identifier', 'unique history ids');
  if (new Set(outputs.map(o => o.id)).size !== outputs.length) manifestError('manifest.outputs', 'duplicate_identifier', 'unique output ids');
  let inputSchema: ValueSchema;
  try { inputSchema = compileSchema(value.inputSchema as ValueSchema ?? { type: 'object', properties: {}, additionalProperties: false }); }
  catch { return manifestError('manifest.inputSchema', 'invalid_schema', 'the supported strict object JSON Schema subset'); }
  if (inputSchema.type !== 'object') manifestError('manifest.inputSchema.type', 'unsupported_value', 'object');
  let defaults: JsonValue;
  try {
    defaults = snapshotJson(value.defaults ?? {}, TASK_LIMITS.parametersBytes).value;
    validateValue(defaults, inputSchema);
  } catch { return manifestError('manifest.defaults', 'schema_mismatch', 'a value matching manifest.inputSchema'); }
  return Object.freeze({ formatVersion: 1, apiVersion: 1, id: value.id as string, version: value.version as number, name: value.name as string,
    description: value.description as string ?? '', inputSchema, defaults, history: Object.freeze(history), outputs: Object.freeze(outputs) });
}
export function taskParameters(value: unknown, manifest: TaskManifest): JsonValue {
  try { const copy = snapshotJson(value ?? manifest.defaults, TASK_LIMITS.parametersBytes).value; validateValue(copy, manifest.inputSchema); return copy; }
  catch { throw new TaskError('task_invalid_parameters'); }
}
export function taskError(error: unknown): TaskError {
  if (error instanceof TaskError) return error;
  if (typeof error === 'string' && /^task_[a-z_]{1,64}$/.test(error)) return new TaskError(error);
  return new TaskError('task_failed');
}
