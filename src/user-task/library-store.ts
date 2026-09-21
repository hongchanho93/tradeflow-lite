import { TASK_LIMITS, TaskError, taskJson, type TaskManifest } from './contracts.ts';

export interface TaskLibraryRecord {
  readonly formatVersion: 1; readonly id: string; readonly revision: string; readonly source: string; readonly hash: string;
  readonly manifest: TaskManifest; readonly updatedAt: number;
}
export interface TaskLibraryStore {
  list(): Promise<readonly unknown[]>;
  compareAndSwap(id: string, expectedRevision: string | null, record: TaskLibraryRecord | null): Promise<void>;
  close(): Promise<void>;
}
/** Separate from indicators, data connections and credentials. No arbitrary storage key API. */
export class IndexedDbTaskStore implements TaskLibraryStore {
  readonly #db: Promise<IDBDatabase>;
  constructor(factory: IDBFactory = globalThis.indexedDB) {
    this.#db = new Promise((resolve, reject) => {
      if (!factory) { reject(new TaskError('task_storage_unavailable')); return; }
      const request = factory.open('tradeflow-lite.user-tasks.v1', 1);
      let settled = false;
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('tasks')) request.result.createObjectStore('tasks', { keyPath: 'id' }); };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; } settled = true;
        request.result.onversionchange = () => request.result.close(); resolve(request.result);
      };
      request.onerror = request.onblocked = () => { if (!settled) { settled = true; reject(new TaskError('task_storage_unavailable')); } };
    });
    // Lazy consumers will receive the failure; construction must not cause an unhandled rejection.
    void this.#db.catch(() => {});
  }
  async list(): Promise<readonly unknown[]> {
    const db = await this.#db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tasks', 'readonly'), request = tx.objectStore('tasks').getAll(undefined, TASK_LIMITS.libraryItems + 1);
      let result: unknown[] = [];
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => result.length > TASK_LIMITS.libraryItems ? reject(new TaskError('task_library_limit')) : resolve(result);
      tx.onabort = tx.onerror = () => reject(new TaskError('task_storage_failed'));
    });
  }
  async compareAndSwap(id: string, expectedRevision: string | null, record: TaskLibraryRecord | null): Promise<void> {
    if (record && record.id !== id) throw new TaskError('task_invalid_request');
    const db = await this.#db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('tasks', 'readwrite'), store = tx.objectStore('tasks'), request = store.getAll(undefined, TASK_LIMITS.libraryItems + 1);
      let failure: TaskError | undefined;
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(failure ?? new TaskError('task_storage_failed'));
      request.onsuccess = () => {
        try {
          const rows = request.result as TaskLibraryRecord[], current = rows.find(r => r.id === id);
          if ((current?.revision ?? null) !== expectedRevision) throw new TaskError('task_conflict');
          const next = rows.filter(r => r.id !== id); if (record) next.push(record);
          if (next.length > TASK_LIMITS.libraryItems) throw new TaskError('task_library_limit');
          // Quotas are checked within this same write transaction, including other IDs.
          taskJson(next, TASK_LIMITS.libraryBytes);
          if (record) store.put(record); else store.delete(id);
        } catch (error) { failure = error instanceof TaskError ? error : new TaskError('task_storage_failed'); tx.abort(); }
      };
    });
  }
  async close(): Promise<void> { (await this.#db).close(); }
}
