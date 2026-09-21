import { UserIndicatorLibraryError, type UserIndicatorLibraryRecord, type UserIndicatorLibraryStore } from './library.ts';

export const USER_INDICATOR_LIBRARY_DB_NAME = 'tradeflow-lite.user-indicators.v1';
export const USER_INDICATOR_LIBRARY_STORE_NAME = 'indicators';
export const USER_INDICATOR_LIBRARY_DB_VERSION = 1;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

export class IndexedDbUserIndicatorStore implements UserIndicatorLibraryStore {
  private readonly factory: IDBFactory;
  private readonly dbPromise: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = globalThis.indexedDB) {
    if (!factory) throw new Error('IndexedDB is unavailable');
    this.factory = factory;
    this.dbPromise = this.open();
  }

  async list(): Promise<readonly unknown[]> {
    const db = await this.dbPromise;
    const transaction = db.transaction(USER_INDICATOR_LIBRARY_STORE_NAME, 'readonly');
    const values = await requestResult(transaction.objectStore(USER_INDICATOR_LIBRARY_STORE_NAME).getAll());
    await transactionDone(transaction);
    return values;
  }

  async get(id: string): Promise<unknown | null> {
    const db = await this.dbPromise;
    const transaction = db.transaction(USER_INDICATOR_LIBRARY_STORE_NAME, 'readonly');
    const value = await requestResult(transaction.objectStore(USER_INDICATOR_LIBRARY_STORE_NAME).get(id));
    await transactionDone(transaction);
    return value === undefined ? null : value;
  }

  async put(record: UserIndicatorLibraryRecord): Promise<void> {
    const db = await this.dbPromise;
    const transaction = db.transaction(USER_INDICATOR_LIBRARY_STORE_NAME, 'readwrite');
    transaction.objectStore(USER_INDICATOR_LIBRARY_STORE_NAME).put(record);
    await transactionDone(transaction);
  }

  async delete(id: string): Promise<void> {
    const db = await this.dbPromise;
    const transaction = db.transaction(USER_INDICATOR_LIBRARY_STORE_NAME, 'readwrite');
    transaction.objectStore(USER_INDICATOR_LIBRARY_STORE_NAME).delete(id);
    await transactionDone(transaction);
  }

  async compareAndSwap(id: string, expectedSourceHash: string | null, record: UserIndicatorLibraryRecord | null): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(USER_INDICATOR_LIBRARY_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(USER_INDICATOR_LIBRARY_STORE_NAME);
      let failure: Error | undefined;
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('indicator transaction failed'));
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('indicator transaction aborted'));
      const request = store.get(id);
      request.onsuccess = () => {
        if ((request.result?.sourceHash ?? null) !== expectedSourceHash) {
          failure = new UserIndicatorLibraryError('stale_import_preview', 'indicator was changed by another operation');
          transaction.abort(); return;
        }
        if (record) store.put(record); else store.delete(id);
      };
    });
  }

  async close(): Promise<void> {
    (await this.dbPromise).close();
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(USER_INDICATOR_LIBRARY_DB_NAME, USER_INDICATOR_LIBRARY_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(USER_INDICATOR_LIBRARY_STORE_NAME)) {
          db.createObjectStore(USER_INDICATOR_LIBRARY_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('failed to open user indicator IndexedDB'));
      request.onblocked = () => reject(new Error('user indicator IndexedDB upgrade is blocked'));
    });
  }
}
