import type { Entry } from './localStore';

/** What `KeyValue.modify` decides after it saw the stored value. */
export type Modification<T, R> = { write?: T; remove?: boolean; result: R };

export interface KeyValue<T> {
  get(key: string): Promise<T | undefined>;
  getAll(): Promise<T[]>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Read, decide, write as one step: no other tab can write in between (one IndexedDB transaction).
   * `decide` must be synchronous.
   */
  modify<R>(key: string, decide: (current: T | undefined) => Modification<T, R>): Promise<R>;
}

export interface LocalDb {
  entries: KeyValue<Entry>;
  meta: KeyValue<unknown>;
}

/** In-memory `KeyValue`, for tests. */
export function memoryKeyValue<T>(): KeyValue<T> {
  const map = new Map<string, T>();
  return {
    async get(key) {
      return map.get(key);
    },
    async getAll() {
      return [...map.values()];
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
    async modify(key, decide) {
      const m = decide(map.get(key));
      if (m.write !== undefined) map.set(key, m.write);
      else if (m.remove) map.delete(key);
      return m.result;
    },
  };
}

const request = <R>(req: IDBRequest<R>): Promise<R> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

function store<T>(db: IDBDatabase, name: string): KeyValue<T> {
  return {
    get: (key) => request<T | undefined>(db.transaction(name).objectStore(name).get(key)),
    getAll: () => request<T[]>(db.transaction(name).objectStore(name).getAll()),
    async put(key, value) {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).put(value, key);
      await done(tx);
    },
    async delete(key) {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).delete(key);
      await done(tx);
    },
    modify<R>(key: string, decide: (current: T | undefined) => Modification<T, R>): Promise<R> {
      return new Promise<R>((resolve, reject) => {
        const tx = db.transaction(name, 'readwrite');
        const os = tx.objectStore(name);
        let result: R;
        const get = os.get(key);
        get.onsuccess = () => {
          try {
            const m = decide(get.result as T | undefined);
            result = m.result;
            if (m.write !== undefined) os.put(m.write, key);
            else if (m.remove) os.delete(key);
          } catch (err) {
            tx.abort();
            reject(err);
          }
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      });
    },
  };
}

/** One database per local space: `konekton-<space>`, with the object stores `entries` and `meta`. */
export function openIndexedDb(dbName: string): Promise<LocalDb> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(dbName, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('entries');
      open.result.createObjectStore('meta');
    };
    open.onerror = () => reject(open.error ?? new Error('Cannot open the local storage of this browser.'));
    open.onsuccess = () => {
      const db = open.result;
      // Another tab asked to delete or upgrade the database: let go.
      db.onversionchange = () => db.close();
      resolve({ entries: store<Entry>(db, 'entries'), meta: store<unknown>(db, 'meta') });
    };
  });
}
