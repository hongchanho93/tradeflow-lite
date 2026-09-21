import { UserIndicatorLibraryError, type UserIndicatorLibraryRecord, type UserIndicatorLibraryStore } from './user-indicator-runtime/library.ts';
import type { IndexedDbUserIndicatorStore } from './user-indicator-runtime/indexeddb-store.ts';
import { TASK_LIMITS, TaskError, taskJson } from './user-task/contracts.ts';
import type { IndexedDbTaskStore, TaskLibraryRecord, TaskLibraryStore } from './user-task/library-store.ts';

export type WorkspaceInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export const NATIVE_USER_INDICATORS_KEY = 'tradeflow-lite.native.user-indicators.v1';
export const NATIVE_USER_TASKS_KEY = 'tradeflow-lite.native.user-tasks.v1';
const NATIVE_WORKSPACE_READY_KEY = 'tradeflow-lite.native.workspace-ready.v1';

function isWorkspaceKey(key: string): boolean {
  return (key.startsWith('tradeflow-lite.') || key.startsWith('tradeflow_lite_'))
    && !key.includes('desktop-e2e');
}

function isBrowserWorkspaceKey(key: string): boolean {
  return isWorkspaceKey(key) && !key.startsWith('tradeflow-lite.native.');
}

function browserEntries(storage: Storage): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key || !isBrowserWorkspaceKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) result[key] = value;
  }
  return result;
}

export class NativeWorkspacePort {
  readonly #invoke: WorkspaceInvoke;
  readonly available: boolean;
  constructor(invoke: WorkspaceInvoke, available = true) { this.#invoke = invoke; this.available = available; }
  async entries(): Promise<Record<string, string>> {
    if (!this.available) return {};
    return this.#invoke<Record<string, string>>('workspace_state_load');
  }
  async get(key: string): Promise<string | null> {
    const entries = await this.entries();
    return Object.hasOwn(entries, key) ? entries[key] : null;
  }
  async set(key: string, value: string): Promise<void> {
    if (!this.available) return;
    await this.#invoke('workspace_state_set', { key, value });
  }
  async remove(key: string): Promise<void> {
    if (!this.available) return;
    await this.#invoke('workspace_state_remove', { key });
  }
  async compareExchange(key: string, expected: string | null, value: string | null): Promise<boolean> {
    if (!this.available) return false;
    return this.#invoke<boolean>('workspace_state_compare_exchange', { key, expected, value });
  }
}

/** Synchronous browser-compatible facade with a serialized native write-through
 * mirror. Existing localStorage remains the immediate fallback if the native
 * store is temporarily unavailable. */
export class WorkspaceStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  readonly #browser: Storage;
  readonly native: NativeWorkspacePort;
  #writes: Promise<void> = Promise.resolve();
  constructor(browser: Storage, native: NativeWorkspacePort) { this.#browser = browser; this.native = native; }
  getItem(key: string): string | null { return this.#browser.getItem(key); }
  setItem(key: string, value: string): void {
    this.#browser.setItem(key, value);
    if (!isBrowserWorkspaceKey(key) || !this.native.available) return;
    this.#writes = this.#writes.then(() => this.native.set(key, value)).catch(error => {
      console.error('workspace.native_write_failed', error);
    });
  }
  removeItem(key: string): void {
    this.#browser.removeItem(key);
    if (!isBrowserWorkspaceKey(key) || !this.native.available) return;
    this.#writes = this.#writes.then(() => this.native.remove(key)).catch(error => {
      console.error('workspace.native_remove_failed', error);
    });
  }
  async flush(): Promise<void> { await this.#writes; }
}

/** Load native values before the first chart/watchlist/indicator state read.
 * The first native launch migrates legacy browser-only state. After that,
 * native state is authoritative so a stale WebView origin cannot resurrect
 * deleted watchlists, drawings or settings. Internal native blobs never get
 * copied back into localStorage. */
export async function createWorkspaceStorage(invoke: WorkspaceInvoke, browser: Storage): Promise<WorkspaceStorage> {
  let native = new NativeWorkspacePort(invoke, true);
  let entries: Record<string, string> = {};
  try {
    entries = await native.entries();
    if (!Object.hasOwn(entries, NATIVE_WORKSPACE_READY_KEY)) {
      const legacy = browserEntries(browser);
      const nativeBrowserEntries = Object.entries(entries).filter(([key]) => isBrowserWorkspaceKey(key));
      // Do not let an empty, newly-created WebView profile permanently seal
      // migration before an older dev/preview origin containing real user
      // state has ever been opened. The first profile with actual workspace
      // values migrates them; an already-populated native store can seal itself.
      if (Object.keys(legacy).length || nativeBrowserEntries.length) {
        await invoke('workspace_state_merge', { entries: {
          ...legacy,
          [NATIVE_WORKSPACE_READY_KEY]: '1',
        } });
        entries = await native.entries();
      }
    }
    const existingBrowserKeys = Object.keys(browserEntries(browser));
    for (const key of existingBrowserKeys) {
      if (!Object.hasOwn(entries, key)) browser.removeItem(key);
    }
    for (const [key, value] of Object.entries(entries)) {
      if (isBrowserWorkspaceKey(key)) browser.setItem(key, value);
    }
  } catch (error) {
    console.error('workspace.native_restore_failed', error);
    native = new NativeWorkspacePort(invoke, false);
  }
  return new WorkspaceStorage(browser, native);
}

function parseArray(raw: string, code: string): unknown[] {
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) return value;
  } catch {}
  throw new Error(code);
}

function recordId(value: unknown): string | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === 'string' ? (value as { id: string }).id : null;
}

/** Native workspace is authoritative after one-time IndexedDB migration.
 * IndexedDB is retained only as a legacy source so existing users do not lose
 * imported .tfi files when this version first starts. */
export class MirroredUserIndicatorStore implements UserIndicatorLibraryStore {
  readonly #legacy: IndexedDbUserIndicatorStore;
  readonly #native: NativeWorkspacePort;
  constructor(legacy: IndexedDbUserIndicatorStore, native: NativeWorkspacePort) { this.#legacy = legacy; this.#native = native; }

  async #raw(): Promise<string | null> {
    if (!this.#native.available) return null;
    let raw = await this.#native.get(NATIVE_USER_INDICATORS_KEY);
    if (raw !== null) return raw;
    const legacy = [...await this.#legacy.list()];
    const migrated = JSON.stringify(legacy);
    if (await this.#native.compareExchange(NATIVE_USER_INDICATORS_KEY, null, migrated)) return migrated;
    raw = await this.#native.get(NATIVE_USER_INDICATORS_KEY);
    return raw;
  }

  async list(): Promise<readonly unknown[]> {
    const raw = await this.#raw();
    return raw === null ? this.#legacy.list() : parseArray(raw, 'indicator native store is corrupt');
  }
  async get(id: string): Promise<unknown | null> {
    return (await this.list()).find(value => recordId(value) === id) ?? null;
  }
  async put(record: UserIndicatorLibraryRecord): Promise<void> {
    if (!this.#native.available) { await this.#legacy.put(record); return; }
    while (true) {
      const raw = await this.#raw() ?? '[]', rows = parseArray(raw, 'indicator native store is corrupt');
      const next = JSON.stringify([...rows.filter(value => recordId(value) !== record.id), record]);
      if (await this.#native.compareExchange(NATIVE_USER_INDICATORS_KEY, raw, next)) return;
    }
  }
  async delete(id: string): Promise<void> {
    if (!this.#native.available) { await this.#legacy.delete(id); return; }
    while (true) {
      const raw = await this.#raw() ?? '[]', rows = parseArray(raw, 'indicator native store is corrupt');
      const next = JSON.stringify(rows.filter(value => recordId(value) !== id));
      if (next === raw || await this.#native.compareExchange(NATIVE_USER_INDICATORS_KEY, raw, next)) return;
    }
  }
  async compareAndSwap(id: string, expectedSourceHash: string | null, record: UserIndicatorLibraryRecord | null): Promise<void> {
    if (!this.#native.available) { await this.#legacy.compareAndSwap(id, expectedSourceHash, record); return; }
    while (true) {
      const raw = await this.#raw() ?? '[]', rows = parseArray(raw, 'indicator native store is corrupt');
      const current = rows.find(value => recordId(value) === id) as { sourceHash?: unknown } | undefined;
      if ((typeof current?.sourceHash === 'string' ? current.sourceHash : null) !== expectedSourceHash) {
        throw new UserIndicatorLibraryError('stale_import_preview', 'indicator was changed by another operation');
      }
      const nextRows = rows.filter(value => recordId(value) !== id);
      if (record) nextRows.push(record);
      if (await this.#native.compareExchange(NATIVE_USER_INDICATORS_KEY, raw, JSON.stringify(nextRows))) return;
    }
  }
  async close(): Promise<void> { await this.#legacy.close(); }
}

/** Same migration pattern for saved .tft definitions. Runtime results remain
 * intentionally ephemeral; only user-authored reusable definitions persist. */
export class MirroredUserTaskStore implements TaskLibraryStore {
  readonly #legacy: IndexedDbTaskStore;
  readonly #native: NativeWorkspacePort;
  constructor(legacy: IndexedDbTaskStore, native: NativeWorkspacePort) { this.#legacy = legacy; this.#native = native; }

  async #raw(): Promise<string | null> {
    if (!this.#native.available) return null;
    let raw = await this.#native.get(NATIVE_USER_TASKS_KEY);
    if (raw !== null) return raw;
    const legacy = [...await this.#legacy.list()];
    const migrated = JSON.stringify(legacy);
    if (await this.#native.compareExchange(NATIVE_USER_TASKS_KEY, null, migrated)) return migrated;
    raw = await this.#native.get(NATIVE_USER_TASKS_KEY);
    return raw;
  }
  async list(): Promise<readonly unknown[]> {
    const raw = await this.#raw();
    return raw === null ? this.#legacy.list() : parseArray(raw, 'task native store is corrupt');
  }
  async compareAndSwap(id: string, expectedRevision: string | null, record: TaskLibraryRecord | null): Promise<void> {
    if (record && record.id !== id) throw new TaskError('task_invalid_request');
    if (!this.#native.available) { await this.#legacy.compareAndSwap(id, expectedRevision, record); return; }
    while (true) {
      const raw = await this.#raw() ?? '[]', rows = parseArray(raw, 'task native store is corrupt') as TaskLibraryRecord[];
      const current = rows.find(value => recordId(value) === id);
      if ((current?.revision ?? null) !== expectedRevision) throw new TaskError('task_conflict');
      const next = rows.filter(value => recordId(value) !== id);
      if (record) next.push(record);
      if (next.length > TASK_LIMITS.libraryItems) throw new TaskError('task_library_limit');
      taskJson(next, TASK_LIMITS.libraryBytes);
      if (await this.#native.compareExchange(NATIVE_USER_TASKS_KEY, raw, JSON.stringify(next))) return;
    }
  }
  async close(): Promise<void> { await this.#legacy.close(); }
}
