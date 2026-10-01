/** Durable local documents. Kept separate from the existing orders database to preserve migrations. */
const database = 'dubai-spares-documents';
let opening: Promise<IDBDatabase> | undefined;
const open = () =>
  (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        opening = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      opening = undefined;
      reject(request.error);
    };
  }));
export const localDocuments = {
  async get<T>(key: string): Promise<T | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('documents').objectStore('documents').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async set<T>(key: string, value: T): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(tx.error || new Error('Локальное сохранение прервано'));
    });
  },
  async entries(): Promise<Array<[string, unknown]>> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('documents');
      const store = tx.objectStore('documents'),
        keys = store.getAllKeys(),
        values = store.getAll();
      tx.oncomplete = () =>
        resolve(keys.result.map((key, index) => [String(key), values.result[index]]));
      tx.onerror = () => reject(tx.error);
    });
  },
  async replace(entries: Array<[string, unknown]>): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite'),
        store = tx.objectStore('documents');
      store.clear();
      entries.forEach(([key, value]) => store.put(value, key));
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Восстановление прервано'));
    });
  },
};
