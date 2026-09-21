import { USER_INDICATOR_RUNTIME_LIMITS } from './limits.ts';
import { validateUserIndicatorManifest, UserIndicatorValidationError,
  type UserIndicatorManifest, type UserIndicatorValidationErrorCode } from './user-definition.ts';
import {
  validateUserIndicatorSourceIsolated,
  type UserIndicatorValidatorClientOptions,
} from './validator-client.ts';
import type { UserIndicatorValidationResult } from './validator-engine.ts';

export const USER_INDICATOR_VALIDATOR_VERSION = 1 as const;

export type UserIndicatorLibraryRecord = Readonly<{
  id: string;
  source: string;
  sourceHash: string;
  manifest: UserIndicatorManifest;
  apiVersion: number;
  indicatorVersion: number;
  importedAt: number;
  updatedAt: number;
  validatorVersion: typeof USER_INDICATOR_VALIDATOR_VERSION;
}>;

export interface UserIndicatorLibraryStore {
  list(): Promise<readonly unknown[]>;
  get(id: string): Promise<unknown | null>;
  put(record: UserIndicatorLibraryRecord): Promise<void>;
  delete(id: string): Promise<void>;
  /** Production IndexedDB checks and writes atomically; optional for simple test stores. */
  compareAndSwap?(id: string, expectedSourceHash: string | null, record: UserIndicatorLibraryRecord | null): Promise<void>;
}

export type UserIndicatorImportDisposition = 'new' | 'unchanged' | 'replace';

export type PreparedUserIndicatorImport = Readonly<{
  fileName: string;
  source: string;
  sourceHash: string;
  manifest: UserIndicatorManifest;
  disposition: UserIndicatorImportDisposition;
  existingSourceHash: string | null;
  downgrade: boolean;
}>;

export type UserIndicatorInstallResult = Readonly<{
  status: 'installed' | 'unchanged';
  record: UserIndicatorLibraryRecord;
}>;

export type UserIndicatorLibraryErrorCode =
  | UserIndicatorValidationErrorCode
  | 'invalid_extension'
  | 'invalid_utf8'
  | 'duplicate_indicator_id'
  | 'replacement_required'
  | 'stale_import_preview'
  | 'library_indicator_limit_exceeded'
  | 'library_source_limit_exceeded'
  | 'storage_corrupt';

export class UserIndicatorLibraryError extends Error {
  readonly code: UserIndicatorLibraryErrorCode;
  readonly field?: string;
  readonly reason?: string;
  readonly expected?: string;
  readonly failureDetail?: string;
  readonly line?: number;
  readonly column?: number;

  constructor(
    code: UserIndicatorLibraryErrorCode,
    message: string,
    field?: string,
    location: Readonly<{ line?: number; column?: number }> = {},
    diagnostic: Readonly<{ reason?: string; expected?: string; failureDetail?: string }> = {},
  ) {
    super(message);
    this.name = 'UserIndicatorLibraryError';
    this.code = code;
    this.field = field;
    this.reason = diagnostic.reason;
    this.expected = diagnostic.expected;
    this.failureDetail = diagnostic.failureDetail;
    this.line = location.line;
    this.column = location.column;
  }
}

export type UserIndicatorLibraryScan = Readonly<{
  records: readonly UserIndicatorLibraryRecord[];
  corruptEntries: readonly unknown[];
}>;

export type UserIndicatorLibraryOptions = Readonly<{
  trustedIndicatorIds?: ReadonlySet<string>;
  validator?: (source: string) => Promise<UserIndicatorValidationResult>;
  validatorOptions?: UserIndicatorValidatorClientOptions;
  now?: () => number;
  crypto?: Crypto;
}>;

const STORED_RECORD_KEYS = new Set([
  'id',
  'source',
  'sourceHash',
  'manifest',
  'apiVersion',
  'indicatorVersion',
  'importedAt',
  'updatedAt',
  'validatorVersion',
]);
const SHA256_HEX = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function copyManifest(manifest: UserIndicatorManifest): UserIndicatorManifest {
  return deepFreeze(structuredClone(manifest));
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function sourceByteLength(source: string): number {
  return utf8Bytes(source).byteLength;
}

function errorFromValidation(result: Extract<UserIndicatorValidationResult, { ok: false }>): UserIndicatorLibraryError {
  return new UserIndicatorLibraryError(
    result.error.code,
    result.error.message,
    result.error.field,
    { line: result.error.line, column: result.error.column },
    { reason: result.error.reason, expected: result.error.expected, failureDetail: result.error.failureDetail },
  );
}

function normalizedFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed.toLowerCase().endsWith('.tfi')) {
    throw new UserIndicatorLibraryError('invalid_extension', 'user indicator file must use the .tfi extension');
  }
  return trimmed;
}

export function decodeUserIndicatorFile(fileName: string, bytes: Uint8Array): Readonly<{ fileName: string; source: string }> {
  const normalizedName = normalizedFileName(fileName);
  if (bytes.byteLength > USER_INDICATOR_RUNTIME_LIMITS.sourceBytes) {
    throw new UserIndicatorLibraryError(
      'source_too_large',
      `indicator source exceeds ${USER_INDICATOR_RUNTIME_LIMITS.sourceBytes} bytes`,
    );
  }
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return Object.freeze({ fileName: normalizedName, source });
  } catch {
    throw new UserIndicatorLibraryError('invalid_utf8', 'user indicator file must be valid UTF-8');
  }
}

/** Reject oversized files before allocating their full contents in the WebView. */
export async function readUserIndicatorFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<Uint8Array> {
  normalizedFileName(file.name);
  const limit = USER_INDICATOR_RUNTIME_LIMITS.sourceBytes;
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limit) {
    throw new UserIndicatorLibraryError('source_too_large', `indicator source exceeds ${limit} bytes`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > limit) {
    throw new UserIndicatorLibraryError('source_too_large', `indicator source exceeds ${limit} bytes`);
  }
  return bytes;
}

export async function userIndicatorSourceHash(source: string, cryptoValue: Crypto = globalThis.crypto): Promise<string> {
  if (!cryptoValue?.subtle) throw new UserIndicatorLibraryError('runtime_exception', 'SHA-256 is unavailable');
  const encoded = utf8Bytes(source);
  const input = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(input).set(encoded);
  const digest = await cryptoValue.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function normalizeStoredRecord(
  value: unknown,
  cryptoValue: Crypto,
): Promise<UserIndicatorLibraryRecord | null> {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !STORED_RECORD_KEYS.has(key))) return null;
  if (typeof value.id !== 'string' || !value.id.trim()) return null;
  if (typeof value.source !== 'string' || sourceByteLength(value.source) > USER_INDICATOR_RUNTIME_LIMITS.sourceBytes) return null;
  if (typeof value.sourceHash !== 'string' || !SHA256_HEX.test(value.sourceHash)) return null;
  if (!isRecord(value.manifest)) return null;
  if (value.manifest.id !== value.id) return null;
  if (typeof value.apiVersion !== 'number' || value.manifest.apiVersion !== value.apiVersion) return null;
  if (typeof value.indicatorVersion !== 'number'
    || !Number.isInteger(value.indicatorVersion)
    || value.indicatorVersion < 1
    || value.manifest.indicatorVersion !== value.indicatorVersion) return null;
  if (value.validatorVersion !== USER_INDICATOR_VALIDATOR_VERSION) return null;
  if (typeof value.importedAt !== 'number' || !Number.isFinite(value.importedAt) || value.importedAt < 0) return null;
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt < value.importedAt) return null;
  let manifest: UserIndicatorManifest;
  try { manifest = validateUserIndicatorManifest(value.manifest); }
  catch (error) {
    if (error instanceof UserIndicatorValidationError) return null;
    throw error;
  }
  if (await userIndicatorSourceHash(value.source, cryptoValue) !== value.sourceHash) return null;
  return deepFreeze({
    id: value.id,
    source: value.source,
    sourceHash: value.sourceHash,
    manifest,
    apiVersion: value.apiVersion,
    indicatorVersion: value.indicatorVersion,
    importedAt: value.importedAt,
    updatedAt: value.updatedAt,
    validatorVersion: USER_INDICATOR_VALIDATOR_VERSION,
  });
}

export class UserIndicatorLibrary {
  private readonly store: UserIndicatorLibraryStore;
  private readonly trustedIndicatorIds: ReadonlySet<string>;
  private readonly validator: (source: string) => Promise<UserIndicatorValidationResult>;
  private readonly now: () => number;
  private readonly cryptoValue: Crypto;

  constructor(store: UserIndicatorLibraryStore, options: UserIndicatorLibraryOptions = {}) {
    this.store = store;
    this.trustedIndicatorIds = options.trustedIndicatorIds ?? new Set<string>();
    this.validator = options.validator
      ?? ((source) => validateUserIndicatorSourceIsolated(source, options.validatorOptions));
    this.now = options.now ?? (() => Date.now());
    this.cryptoValue = options.crypto ?? globalThis.crypto;
  }

  async scan(): Promise<UserIndicatorLibraryScan> {
    const raw = await this.store.list();
    const records: UserIndicatorLibraryRecord[] = [];
    const corruptEntries: unknown[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
      const record = await normalizeStoredRecord(entry, this.cryptoValue);
      if (!record || seen.has(record.id)) {
        corruptEntries.push(entry);
        continue;
      }
      seen.add(record.id);
      records.push(record);
    }
    records.sort((left, right) => left.id.localeCompare(right.id));
    return Object.freeze({ records: Object.freeze(records), corruptEntries: Object.freeze(corruptEntries) });
  }

  async get(id: string): Promise<UserIndicatorLibraryRecord | null> {
    const value = await this.store.get(id);
    if (value === null) return null;
    const record = await normalizeStoredRecord(value, this.cryptoValue);
    if (!record) throw new UserIndicatorLibraryError('storage_corrupt', `stored user indicator ${JSON.stringify(id)} is corrupt`);
    return record;
  }

  async prepareImport(fileName: string, bytes: Uint8Array): Promise<PreparedUserIndicatorImport> {
    const decoded = decodeUserIndicatorFile(fileName, bytes);
    const sourceHash = await userIndicatorSourceHash(decoded.source, this.cryptoValue);
    const validation = await this.validator(decoded.source);
    if (!validation.ok) throw errorFromValidation(validation);
    const manifest = copyManifest(validation.manifest);
    if (this.trustedIndicatorIds.has(manifest.id)) {
      throw new UserIndicatorLibraryError(
        'duplicate_indicator_id',
        `indicator id ${JSON.stringify(manifest.id)} conflicts with a trusted indicator`,
        'id',
      );
    }
    const existing = await this.get(manifest.id);
    const disposition: UserIndicatorImportDisposition = existing === null
      ? 'new'
      : existing.sourceHash === sourceHash
        ? 'unchanged'
        : 'replace';
    return deepFreeze({
      fileName: decoded.fileName,
      source: decoded.source,
      sourceHash,
      manifest,
      disposition,
      existingSourceHash: existing?.sourceHash ?? null,
      downgrade: Boolean(existing && manifest.indicatorVersion < existing.indicatorVersion),
    });
  }

  async install(
    prepared: PreparedUserIndicatorImport,
    options: Readonly<{ replace?: boolean }> = {},
  ): Promise<UserIndicatorInstallResult> {
    if (this.trustedIndicatorIds.has(prepared.manifest.id)) {
      throw new UserIndicatorLibraryError('duplicate_indicator_id', 'indicator id conflicts with a trusted indicator', 'id');
    }
    const current = await this.get(prepared.manifest.id);
    if ((current?.sourceHash ?? null) !== prepared.existingSourceHash) {
      throw new UserIndicatorLibraryError('stale_import_preview', 'user indicator library changed after import preview');
    }
    if (current?.sourceHash === prepared.sourceHash) return Object.freeze({ status: 'unchanged', record: current });
    if (current && options.replace !== true) {
      throw new UserIndicatorLibraryError('replacement_required', 'replacing an existing user indicator requires explicit confirmation');
    }

    const snapshot = await this.scan();
    if (snapshot.corruptEntries.length > 0) {
      throw new UserIndicatorLibraryError('storage_corrupt', 'user indicator library contains corrupt entries');
    }
    if (!current && snapshot.records.length >= USER_INDICATOR_RUNTIME_LIMITS.importedIndicators) {
      throw new UserIndicatorLibraryError(
        'library_indicator_limit_exceeded',
        `user indicator library limit ${USER_INDICATOR_RUNTIME_LIMITS.importedIndicators} reached`,
      );
    }
    const totalSourceBytes = snapshot.records.reduce((sum, record) => sum + sourceByteLength(record.source), 0)
      - (current ? sourceByteLength(current.source) : 0)
      + sourceByteLength(prepared.source);
    if (totalSourceBytes > USER_INDICATOR_RUNTIME_LIMITS.storedSourceBytes) {
      throw new UserIndicatorLibraryError(
        'library_source_limit_exceeded',
        `user indicator source storage exceeds ${USER_INDICATOR_RUNTIME_LIMITS.storedSourceBytes} bytes`,
      );
    }

    const now = this.now();
    if (!Number.isFinite(now) || now < 0) throw new UserIndicatorLibraryError('runtime_exception', 'invalid library clock');
    const record = deepFreeze({
      id: prepared.manifest.id,
      source: prepared.source,
      sourceHash: prepared.sourceHash,
      manifest: copyManifest(prepared.manifest),
      apiVersion: prepared.manifest.apiVersion,
      indicatorVersion: prepared.manifest.indicatorVersion,
      importedAt: current?.importedAt ?? now,
      updatedAt: now,
      validatorVersion: USER_INDICATOR_VALIDATOR_VERSION,
    } satisfies UserIndicatorLibraryRecord);
    await this.replaceExact(record.id, current?.sourceHash ?? null, record);
    return Object.freeze({ status: 'installed', record });
  }

  /** Host-owned compensation. Does not execute the stored source. */
  async replaceExact(id: string, expectedSourceHash: string | null, record: UserIndicatorLibraryRecord | null): Promise<void> {
    if (record && (record.id !== id || !await normalizeStoredRecord(record, this.cryptoValue))) {
      throw new UserIndicatorLibraryError('storage_corrupt', 'replacement record is invalid');
    }
    if (this.store.compareAndSwap) {
      await this.store.compareAndSwap(id, expectedSourceHash, record);
      return;
    }
    const current = await this.get(id);
    if ((current?.sourceHash ?? null) !== expectedSourceHash) throw new UserIndicatorLibraryError('stale_import_preview', 'indicator changed during mutation');
    if (record) await this.store.put(record); else await this.store.delete(id);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }
}
