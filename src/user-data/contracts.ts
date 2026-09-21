import type { JsonValue } from '../ai-capabilities/contracts.ts';

export class DataError extends Error {
  readonly code: string;
  readonly path?: string;
  readonly reason?: string;
  readonly expected?: string;
  readonly failureDetail?: string;
  constructor(code: string, diagnostic: Readonly<{ path?: string; reason?: string; expected?: string; failureDetail?: string }> = {}) {
    super(code); this.name = 'DataError'; this.code = code;
    this.path = typeof diagnostic.path === 'string' && diagnostic.path ? diagnostic.path.slice(0,256) : undefined;
    this.reason = typeof diagnostic.reason === 'string' && diagnostic.reason ? diagnostic.reason.slice(0,256) : undefined;
    this.expected = typeof diagnostic.expected === 'string' && diagnostic.expected ? diagnostic.expected.slice(0,512) : undefined;
    this.failureDetail = typeof diagnostic.failureDetail === 'string' && diagnostic.failureDetail ? diagnostic.failureDetail.slice(0,512) : undefined;
  }
}
export type DataValidationStage = 'validate' | 'sample_catalog' | 'sample_history' | 'finalize';
export class DataValidationError extends DataError {
  readonly stage: DataValidationStage;
  constructor(code: string, stage: DataValidationStage, diagnostic: Readonly<{ path?: string; reason?: string; expected?: string; failureDetail?: string }> = {}) {
    super(code, diagnostic); this.name = 'DataValidationError'; this.stage = stage;
  }
}
export const DATA_BUDGET = Object.freeze({ sourceBytes: 256 * 1024, heapBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024, stepMs: 1500, wallMs: 120_000, outputBytes: 4 * 1024 * 1024,
  chunkBytes: 1024 * 1024, ioBytes: 128 * 1024 * 1024, ioCalls: 2048, pageRows: 512 });
export interface SourceInfo { readonly id: string; readonly name: string; readonly revision: string;
  readonly state: 'ready' | 'disabled' | 'needs_directory'; readonly hasConnector: boolean }
export interface ConnectorManifest { readonly formatVersion: 1; readonly apiVersion: 1; readonly id: string;
  readonly version: number; readonly name: string; readonly description: string;
  readonly supports: { readonly venues: readonly string[]; readonly kinds: readonly string[];
    readonly resolutions: readonly string[]; readonly adjustments: readonly string[] } }
export type DataIo = { operation: 'list'; path: string; after?: string; limit: number }
  | { operation: 'read' | 'read_text'; path: string; offset: number; length: number; fileRevision?: string; encoding?: string }
  | { operation: 'sqlite'; path: string; sql: string; parameters: readonly (string | number | null)[]; limit: number; fileRevision?: string }
  | { operation: 'parquet'; path: string; offset: number; limit: number; columns?: readonly string[]; fileRevision?: string };
export interface DataIoPort { execute(request: DataIo, signal: AbortSignal): Promise<JsonValue> }
export interface ConnectorInvocation { source: string; operation: 'validate' | 'catalog' | 'history'; input?: JsonValue;
  expectedManifest?: ConnectorManifest }
export interface ConnectorResult { manifest: ConnectorManifest; value?: JsonValue }

export const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function exact(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value,k))) throw new DataError('data_invalid_contract');
}
const text = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const manifestError=(path:string,reason:string,expected:string):never=>{
  throw new DataError('data_invalid_manifest',{path,reason,expected});
};
const strings = (v: unknown, path: string, allowed?: readonly string[]): readonly string[] => {
  if (!Array.isArray(v) || !v.length || v.length > 128 || new Set(v).size !== v.length
    || v.some(s => !text(s,64) || (allowed && !allowed.includes(s)))) {
    manifestError(path,'invalid_string_list',allowed ? `1 to 128 unique values from: ${allowed.join(', ')}` : '1 to 128 unique non-empty strings up to 64 characters');
  }
  return Object.freeze([...(v as string[])]);
};
export function validateManifest(value: unknown): ConnectorManifest {
  exact(value,['formatVersion','apiVersion','id','version','name','description','supports'],['formatVersion','apiVersion','id','version','name','supports']);
  if (value.formatVersion !== 1) throw new DataError('data_unsupported_version',{path:'manifest.formatVersion',reason:'unsupported_version',expected:'1'});
  if (value.apiVersion !== 1) throw new DataError('data_unsupported_version',{path:'manifest.apiVersion',reason:'unsupported_version',expected:'1'});
  if (!text(value.id,96) || !/^[a-z][a-z0-9._-]*$/.test(value.id)) manifestError('manifest.id','invalid_identifier','lowercase identifier matching ^[a-z][a-z0-9._-]*$');
  if (!text(value.name,128)) manifestError('manifest.name','invalid_text','non-empty text up to 128 characters');
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) manifestError('manifest.version','invalid_version','a positive safe integer');
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 2048)) {
    manifestError('manifest.description','invalid_text','text up to 2048 characters');
  }
  exact(value.supports,['venues','kinds','resolutions','adjustments']);
  const venues = strings(value.supports.venues,'manifest.supports.venues');
  if (venues.some(s => !/^[A-Z0-9._-]{1,32}$/.test(s))) manifestError('manifest.supports.venues','invalid_venue','uppercase venue identifiers matching ^[A-Z0-9._-]{1,32}$');
  return Object.freeze({formatVersion:1,apiVersion:1,id:value.id as string,version:value.version as number,name:value.name as string,description:value.description as string ?? '',
    supports:Object.freeze({venues,kinds:strings(value.supports.kinds,'manifest.supports.kinds',['stock','etf','index','crypto','prediction']),
      resolutions:strings(value.supports.resolutions,'manifest.supports.resolutions'),
      adjustments:strings(value.supports.adjustments,'manifest.supports.adjustments',['none','qfq'])})});
}
export function relativePath(path: unknown, allowRoot = false): string {
  if (path === '' && allowRoot) return '';
  if (!text(path,4096) || path.startsWith('/') || /[\\:\0]/.test(path) || path.split('/').some(s => !s || s==='.' || s==='..' || /[. ]$/.test(s)
    || /^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(s))) throw new DataError('data_path_denied');
  return path;
}
export function validateIo(value: unknown): DataIo {
  if (!object(value)) throw new DataError('data_invalid_io');
  if (value.operation === 'sqlite' || value.operation === 'parquet') {
    const sqlite = value.operation === 'sqlite';
    exact(value, ['operation','path','limit','fileRevision',...(sqlite?['sql','parameters']:['offset','columns'])],
      ['operation','path','limit',...(sqlite?['sql','parameters']:['offset'])]);
    const path = relativePath(value.path);
    if (!Number.isInteger(value.limit) || (value.limit as number) < (sqlite ? 1 : 0) || (value.limit as number) > 12000
      || (value.fileRevision !== undefined && !text(value.fileRevision,256))) throw new DataError('data_budget_exceeded');
    const common = {path,limit:value.limit as number,...(value.fileRevision===undefined?{}:{fileRevision:value.fileRevision as string})};
    if (sqlite) {
      if (!text(value.sql,32768) || value.sql.includes('\0') || !Array.isArray(value.parameters) || value.parameters.length>128
        || value.parameters.some(p=>p!==null && !(typeof p==='string'&&p.length<=16384)
          && !(typeof p==='number'&&Number.isFinite(p)&&(!Number.isInteger(p)||Number.isSafeInteger(p))))) throw new DataError('data_invalid_io');
      return {operation:'sqlite',...common,sql:value.sql,parameters:[...value.parameters]};
    }
    if (!Number.isSafeInteger(value.offset) || (value.offset as number)<0
      || (value.columns!==undefined && (!Array.isArray(value.columns) || !value.columns.length || value.columns.length>128
        || new Set(value.columns).size!==value.columns.length || value.columns.some(c=>!text(c,256))))) throw new DataError('data_invalid_io');
    return {operation:'parquet',...common,offset:value.offset as number,...(value.columns===undefined?{}:{columns:[...value.columns as string[]]})};
  }
  if (value.operation === 'list') {
    exact(value,['operation','path','after','limit'],['operation','path','limit']);
    if (!Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > DATA_BUDGET.pageRows
      || (value.after !== undefined && !text(value.after,4096))) throw new DataError('data_budget_exceeded');
    return {operation:'list',path:relativePath(value.path,true),limit:value.limit as number,...(value.after===undefined?{}:{after:value.after as string})};
  }
  if (value.operation !== 'read' && value.operation !== 'read_text') throw new DataError('data_invalid_io');
  exact(value,['operation','path','offset','length','fileRevision',...(value.operation==='read_text'?['encoding']:[])],['operation','path','offset','length']);
  if (!Number.isSafeInteger(value.offset) || (value.offset as number) < 0 || !Number.isInteger(value.length)
    || (value.length as number) < 1 || (value.length as number) > DATA_BUDGET.chunkBytes
    || (value.fileRevision !== undefined && !text(value.fileRevision,256)) || (value.encoding!==undefined && !text(value.encoding,64))) throw new DataError('data_budget_exceeded');
  return {operation:value.operation,path:relativePath(value.path),offset:value.offset as number,length:value.length as number,
    ...(value.fileRevision===undefined?{}:{fileRevision:value.fileRevision as string}),...(value.encoding===undefined?{}:{encoding:value.encoding as string})};
}
/** Clone data, not executable host objects. Limits apply before crossing the VM boundary. */
export function dataJson(value: unknown, maxBytes = DATA_BUDGET.outputBytes, maxNodes = 160_000): JsonValue {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).length > maxBytes) throw new DataError('data_output_limit');
  const copy = JSON.parse(encoded) as JsonValue;
  let nodes = 0;
  const inspect = (v: JsonValue, depth: number) => {
    if (++nodes > maxNodes || depth > 32) throw new DataError('data_output_limit');
    if (Array.isArray(v)) for (const item of v) inspect(item,depth+1);
    else if (v !== null && typeof v === 'object') for (const item of Object.values(v)) inspect(item,depth+1);
  };
  inspect(copy,0); return copy;
}
export function dataError(error: unknown): DataError {
  if (error instanceof DataError) return error;
  // Never propagate provider/native paths, source contents or stack traces.
  if (typeof error === 'string' && /^data_[a-z_]{1,64}$/.test(error)) return new DataError(error);
  return new DataError('data_failed');
}
