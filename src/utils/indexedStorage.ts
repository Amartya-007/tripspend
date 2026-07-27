const DB_NAME = 'tripspend_indexed_db';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;
let dbRef: IDBDatabase | null = null;

const resetDbCache = () => {
  dbPromise = null;
  dbRef = null;
};

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      dbRef = db;

      // Force callers to reopen after schema changes in another tab.
      db.onversionchange = () => {
        db.close();
        resetDbCache();
      };

      db.onclose = () => {
        if (dbRef === db) resetDbCache();
      };

      resolve(db);
    };

    req.onerror = () => {
      resetDbCache();
      reject(req.error || new Error('IndexedDB open failed'));
    };
    req.onblocked = () => {
      resetDbCache();
    };
  });

  return dbPromise;
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T> => {
  const db = await openDb();

  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = run(store);

    tx.onabort = () => reject(tx.error || req.error || new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error || req.error || new Error('IndexedDB transaction failed'));

    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error || tx.error || new Error('IndexedDB request failed'));
  });
};

export const indexedSet = async (key: string, value: unknown): Promise<void> => {
  await withStore<IDBValidKey>('readwrite', (store) => store.put(value, key));
};

export const indexedGet = async <T>(key: string): Promise<T | null> => {
  const result = await withStore<T | undefined>('readonly', (store) => store.get(key));
  return result ?? null;
};