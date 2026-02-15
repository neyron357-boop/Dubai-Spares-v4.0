import { Order, RadarInteraction, SystemLogEntry } from '../types';

type MutationType = 'upsert' | 'delete';

export interface OfflineMutation {
  id: string;
  type: MutationType;
  orderId: string;
  entity?: 'orders';
  entityId?: string;
  operation?: MutationType;
  payload?: Order;
  createdAt: number;
  retryCount?: number;
  lastError?: string | null;
}

const DB_NAME = 'dubai-spares-offline';
const DB_VERSION = 3;
const ORDERS_STORE = 'orders';
const MUTATIONS_STORE = 'mutations';
const SYSTEM_LOGS_STORE = 'system_logs';
const RADAR_INTERACTIONS_STORE = 'radar_interactions';
const ALL_STORES = [ORDERS_STORE, MUTATIONS_STORE, SYSTEM_LOGS_STORE, RADAR_INTERACTIONS_STORE] as const;
const MAX_MUTATIONS = 2000;
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
let openPromise: Promise<IDBDatabase> | null = null;
let activeDb: IDBDatabase | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRecoverableOpenError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return ['VersionError', 'QuotaExceededError', 'UnknownError', 'InvalidStateError'].includes(error.name)
    || /blocked|lost|internal error|version/i.test(error.message);
};

const runWithDbLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const lockApi = (navigator as Navigator & { locks?: { request: <R>(name: string, callback: () => Promise<R>) => Promise<R> } }).locks;
  if (lockApi?.request) {
    return lockApi.request('dubai-spares-offline-db-open', fn);
  }
  return fn();
};

const unsafeOpenDb = (): Promise<IDBDatabase> =>
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
      if (!db.objectStoreNames.contains(RADAR_INTERACTIONS_STORE)) {
        db.createObjectStore(RADAR_INTERACTIONS_STORE, { keyPath: 'id' });
      }
    };

    request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (activeDb === db) activeDb = null;
      };
      db.onclose = () => {
        if (activeDb === db) activeDb = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });

const openDb = async (): Promise<IDBDatabase> => {
  if (activeDb) return activeDb;
  if (openPromise) return openPromise;
  openPromise = runWithDbLock(async () => {
    let lastError: unknown;
    for (let index = 0; index < RETRY_DELAYS_MS.length; index += 1) {
      try {
        return await unsafeOpenDb();
      } catch (error) {
        lastError = error;
        if (!isRecoverableOpenError(error) || index === RETRY_DELAYS_MS.length - 1) {
          throw error;
        }
        await sleep(RETRY_DELAYS_MS[index]);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Unable to open IndexedDB');
  });

  try {
    const db = await openPromise;
    activeDb = db;
    return db;
  } finally {
    openPromise = null;
  }
};

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
    const store = tx.objectStore(MUTATIONS_STORE);
    const rows = (await txRequest(store.getAll())) as OfflineMutation[];
    const normalized: OfflineMutation = {
      ...mutation,
      entity: mutation.entity || 'orders',
      entityId: mutation.entityId || mutation.orderId,
      operation: mutation.operation || mutation.type,
      retryCount: Number(mutation.retryCount || 0),
      lastError: mutation.lastError || null
    };

    const duplicate = rows.find((item) => item.entity === normalized.entity && item.entityId === normalized.entityId && (item.operation || item.type) === (normalized.operation || normalized.type));
    if (duplicate) {
      await txRequest(store.put({ ...duplicate, ...normalized, id: duplicate.id, createdAt: duplicate.createdAt }));
      return;
    }

    if (rows.length >= MAX_MUTATIONS) {
      throw new Error(`Mutation queue limit reached (${MAX_MUTATIONS}). Export backup and clear queue.`);
    }

    await txRequest(store.put(normalized));
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

  async addSystemLog(entry: SystemLogEntry, maxEntries = 2000, maxAgeMs = 14 * 24 * 60 * 60 * 1000): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(SYSTEM_LOGS_STORE, 'readwrite');
    const store = tx.objectStore(SYSTEM_LOGS_STORE);
    await txRequest(store.put(entry));

    const rows = (await txRequest(store.getAll())) as SystemLogEntry[];
    const now = Date.now();
    const tooOld = rows.filter((item) => now - item.createdAt > maxAgeMs);
    for (const item of tooOld) {
      await txRequest(store.delete(item.id));
    }

    const freshRows = rows.filter((item) => now - item.createdAt <= maxAgeMs);
    if (freshRows.length > maxEntries) {
      const oldest = freshRows
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, freshRows.length - maxEntries);

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
  },

  async getDiagnosticsSnapshot(): Promise<Record<string, { count: number; approxBytes: number }>> {
    const db = await openDb();
    const tx = db.transaction([...ALL_STORES], 'readonly');
    const result: Record<string, { count: number; approxBytes: number }> = {};

    for (const storeName of ALL_STORES) {
      const rows = await txRequest(tx.objectStore(storeName).getAll());
      const approxBytes = new Blob([JSON.stringify(rows)]).size;
      result[storeName] = { count: Array.isArray(rows) ? rows.length : 0, approxBytes };
    }

    return result;
  },

  async exportAllData(): Promise<Record<string, unknown[]>> {
    const db = await openDb();
    const tx = db.transaction([...ALL_STORES], 'readonly');
    const dump: Record<string, unknown[]> = {};
    for (const storeName of ALL_STORES) {
      const rows = await txRequest(tx.objectStore(storeName).getAll());
      dump[storeName] = Array.isArray(rows) ? rows : [];
    }
    return dump;
  },

  async importAllData(payload: Record<string, unknown[]>): Promise<void> {
    const db = await openDb();
    const tx = db.transaction([...ALL_STORES], 'readwrite');
    for (const storeName of ALL_STORES) {
      const store = tx.objectStore(storeName);
      await txRequest(store.clear());
      const rows = Array.isArray(payload[storeName]) ? payload[storeName] : [];
      for (const row of rows) {
        await txRequest(store.put(row));
      }
    }
  },

  async clearAllOfflineData(): Promise<void> {
    const db = await openDb();
    const tx = db.transaction([...ALL_STORES], 'readwrite');
    for (const storeName of ALL_STORES) {
      await txRequest(tx.objectStore(storeName).clear());
    }
  },

  async rebuildIndex(): Promise<void> {
    if (activeDb) {
      activeDb.close();
      activeDb = null;
    }

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onblocked = () => reject(new Error('Cannot rebuild index while another tab is open'));
      request.onerror = () => reject(request.error ?? new Error('Failed to rebuild IndexedDB'));
    });
  },

  async saveRadarInteraction(interaction: RadarInteraction): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(RADAR_INTERACTIONS_STORE, 'readwrite');
    await txRequest(tx.objectStore(RADAR_INTERACTIONS_STORE).put(interaction));
  },

  async getRadarInteractions(): Promise<RadarInteraction[]> {
    const db = await openDb();
    const tx = db.transaction(RADAR_INTERACTIONS_STORE, 'readonly');
    const rows = await txRequest(tx.objectStore(RADAR_INTERACTIONS_STORE).getAll());
    return (rows as RadarInteraction[]).sort((a, b) => b.createdAt - a.createdAt);
  },

  async getPendingRadarInteractions(): Promise<RadarInteraction[]> {
    const all = await this.getRadarInteractions();
    return all.filter((item) => !item.syncedAt);
  },

  async markRadarInteractionSynced(id: string, syncedAt = Date.now()): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(RADAR_INTERACTIONS_STORE, 'readwrite');
    const store = tx.objectStore(RADAR_INTERACTIONS_STORE);
    const current = await txRequest(store.get(id)) as RadarInteraction | undefined;
    if (!current) return;
    await txRequest(store.put({ ...current, syncedAt }));
  }
};
