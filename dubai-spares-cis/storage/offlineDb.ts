import { Order, SystemLogEntry } from '../types';

type MutationType = 'upsert' | 'delete';

export interface OfflineMutation {
  id: string;
  type: MutationType;
  orderId: string;
  payload?: Order;
  createdAt: number;
}

const DB_NAME = 'dubai-spares-offline';
const DB_VERSION = 2;
const ORDERS_STORE = 'orders';
const MUTATIONS_STORE = 'mutations';
const SYSTEM_LOGS_STORE = 'system_logs';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ORDERS_STORE)) {
        db.createObjectStore(ORDERS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(MUTATIONS_STORE)) {
        db.createObjectStore(MUTATIONS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SYSTEM_LOGS_STORE)) {
        db.createObjectStore(SYSTEM_LOGS_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });

const txRequest = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });

export const offlineDb = {
  async getOrders(): Promise<Order[]> {
    const db = await openDb();
    const tx = db.transaction(ORDERS_STORE, 'readonly');
    const rows = await txRequest(tx.objectStore(ORDERS_STORE).getAll());
    return (rows as Order[]).sort((a, b) => b.createdAt - a.createdAt);
  },

  async saveOrders(orders: Order[]): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(ORDERS_STORE, 'readwrite');
    const store = tx.objectStore(ORDERS_STORE);
    await txRequest(store.clear());
    for (const order of orders) {
      await txRequest(store.put(order));
    }
  },

  async saveOrder(order: Order): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(ORDERS_STORE, 'readwrite');
    await txRequest(tx.objectStore(ORDERS_STORE).put(order));
  },

  async deleteOrder(orderId: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(ORDERS_STORE, 'readwrite');
    await txRequest(tx.objectStore(ORDERS_STORE).delete(orderId));
  },

  async enqueueMutation(mutation: OfflineMutation): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, 'readwrite');
    await txRequest(tx.objectStore(MUTATIONS_STORE).put(mutation));
  },

  async getMutations(): Promise<OfflineMutation[]> {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, 'readonly');
    const rows = await txRequest(tx.objectStore(MUTATIONS_STORE).getAll());
    return (rows as OfflineMutation[]).sort((a, b) => a.createdAt - b.createdAt);
  },

  async getMutationCount(): Promise<number> {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, 'readonly');
    return txRequest(tx.objectStore(MUTATIONS_STORE).count());
  },

  async removeMutation(mutationId: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, 'readwrite');
    await txRequest(tx.objectStore(MUTATIONS_STORE).delete(mutationId));
  },

  async clearMutations(): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, 'readwrite');
    await txRequest(tx.objectStore(MUTATIONS_STORE).clear());
  },

  async addSystemLog(entry: SystemLogEntry, maxEntries = 200): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(SYSTEM_LOGS_STORE, 'readwrite');
    const store = tx.objectStore(SYSTEM_LOGS_STORE);
    await txRequest(store.put(entry));

    const rows = (await txRequest(store.getAll())) as SystemLogEntry[];
    if (rows.length > maxEntries) {
      const oldest = rows
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, rows.length - maxEntries);

      for (const item of oldest) {
        await txRequest(store.delete(item.id));
      }
    }
  },

  async getSystemLogs(limit = 100): Promise<SystemLogEntry[]> {
    const db = await openDb();
    const tx = db.transaction(SYSTEM_LOGS_STORE, 'readonly');
    const rows = await txRequest(tx.objectStore(SYSTEM_LOGS_STORE).getAll());
    return (rows as SystemLogEntry[])
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  async getSystemLogCount(): Promise<number> {
    const db = await openDb();
    const tx = db.transaction(SYSTEM_LOGS_STORE, 'readonly');
    return txRequest(tx.objectStore(SYSTEM_LOGS_STORE).count());
  },

  async clearSystemLogs(): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(SYSTEM_LOGS_STORE, 'readwrite');
    await txRequest(tx.objectStore(SYSTEM_LOGS_STORE).clear());
  }
};
