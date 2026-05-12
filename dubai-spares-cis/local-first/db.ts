import { LOCAL_DB_NAME, LOCAL_DB_VERSION, STORE_NAMES, StoreName } from './types';

let dbPromise: Promise<IDBDatabase> | null = null;

const txRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });

const waitForTransaction = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

export const openLocalDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAMES.orders)) {
        const store = db.createObjectStore(STORE_NAMES.orders, { keyPath: 'id' });
        store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
        store.createIndex('by_status', 'status', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_NAMES.parts)) {
        const store = db.createObjectStore(STORE_NAMES.parts, { keyPath: 'id' });
        store.createIndex('by_orderId', 'orderId', { unique: false });
        store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_NAMES.priceVariants)) {
        const store = db.createObjectStore(STORE_NAMES.priceVariants, { keyPath: 'id' });
        store.createIndex('by_partId', 'partId', { unique: false });
        store.createIndex('by_supplierId', 'supplierId', { unique: false });
        store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_NAMES.suppliers)) {
        const store = db.createObjectStore(STORE_NAMES.suppliers, { keyPath: 'id' });
        store.createIndex('by_name', 'name', { unique: false });
        store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_NAMES.photos)) {
        const store = db.createObjectStore(STORE_NAMES.photos, { keyPath: 'id' });
        store.createIndex('by_createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_NAMES.photoLinks)) {
        const store = db.createObjectStore(STORE_NAMES.photoLinks, { keyPath: 'id' });
        store.createIndex('by_photoId', 'photoId', { unique: false });
        store.createIndex('by_entity', ['entityType', 'entityId'], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_NAMES.meta)) {
        db.createObjectStore(STORE_NAMES.meta, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open local IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });

  return dbPromise;
};

export const withTransaction = async <T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  action: (ctx: {
    tx: IDBTransaction;
    store: (name: StoreName) => IDBObjectStore;
    request: typeof txRequest;
  }) => Promise<T>
): Promise<T> => {
  const db = await openLocalDb();
  const tx = db.transaction(stores, mode);
  const store = (name: StoreName) => tx.objectStore(name);
  const result = await action({ tx, store, request: txRequest });
  await waitForTransaction(tx);
  return result;
};

export const closeLocalDb = async (): Promise<void> => {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
};

export const clearAllStores = async (): Promise<void> => {
  await withTransaction(Object.values(STORE_NAMES), 'readwrite', async ({ store }) => {
    for (const storeName of Object.values(STORE_NAMES)) {
      store(storeName).clear();
    }
  });
};
