import { Order, RadarInteraction, SystemLogEntry } from '../types';
import { logSyncCategory, syncPerf } from '../syncPerf';

type MutationType = 'upsert' | 'delete';

export interface OfflineMutation {
  id: string;
  type: MutationType;
  orderId: string;
  entity?: 'orders';
  entityId?: string;
  operation?: MutationType;
  payload?: Order;
  patch?: Partial<Order>;
  createdAt: number;
  retryCount?: number;
  lastError?: string | null;
  nextRetryAt?: number;
}

const DB_NAME = 'dubai-spares-offline';
const DB_VERSION = 4;
const ORDERS_STORE = 'orders';
const MUTATIONS_STORE = 'mutations';
const SYSTEM_LOGS_STORE = 'system_logs';
const RADAR_INTERACTIONS_STORE = 'radar_interactions';
const ORDER_PATCHES_STORE = 'order_patches';
const ALL_STORES = [ORDERS_STORE, ORDER_PATCHES_STORE, MUTATIONS_STORE, SYSTEM_LOGS_STORE, RADAR_INTERACTIONS_STORE] as const;
const MAX_MUTATIONS = 2000;
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
const IDB_RECOVERY_RETRY_LIMIT = 3;
const IDB_RECOVERY_WAIT_MIN_MS = 500;
const IDB_RECOVERY_WAIT_MAX_MS = 1500;
let openPromise: Promise<IDBDatabase> | null = null;
let activeDb: IDBDatabase | null = null;
let idbRecoveryFailures = 0;
let pendingOrdersClear = false;
const pendingOrderWrites = new Map<string, { type: 'put'; order: Order } | { type: 'delete' }>();
let pendingOrderFlushTimer: number | null = null;
let pendingOrderFlushPromise: Promise<void> | null = null;
const pendingOrderPatchWrites = new Map<string, Partial<Order>>();
let pendingOrderPatchFlushTimer: number | null = null;
let pendingOrderPatchFlushPromise: Promise<void> | null = null;

const pendingMutationWrites = new Map<string, OfflineMutation>();
let pendingMutationFlushTimer: number | null = null;
let pendingMutationFlushPromise: Promise<void> | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const getJitterMs = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

const closeActiveDb = () => {
  if (!activeDb) return;
  try {
    activeDb.close();
  } catch {
    // no-op
  }
  activeDb = null;
};

const isRecoverableOpenError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return ['VersionError', 'QuotaExceededError', 'UnknownError', 'InvalidStateError'].includes(error.name)
    || /blocked|lost|internal error|version/i.test(error.message);
};

const isConnectionLostError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return /IDB_CONNECTION_LOST|indexeddb.*(lost|unstable|closed)|InvalidStateError|AbortError/i.test(`${error.name}:${error.message}`);
};

const toError = (error: unknown, fallback: string) => error instanceof Error ? error : new Error(fallback);

const measureIdbTx = async <T>(fn: () => Promise<T>) => {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    return await fn();
  } finally {
    const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    syncPerf.recordIdbTransaction(Math.max(0, finishedAt - startedAt));
  }
};

const recoverConnectionOnce = async () => {
  closeActiveDb();
  const waitMs = getJitterMs(IDB_RECOVERY_WAIT_MIN_MS, IDB_RECOVERY_WAIT_MAX_MS);
  syncPerf.addIdbEvent('recovery_wait', { waitMs });
  await sleep(waitMs);
  await openDb();
};

const withIdbRecovery = async <T>(operation: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (!isConnectionLostError(error)) throw error;

    syncPerf.setLastIdbError(toError(error, 'IndexedDB operation failed').message);
    syncPerf.addIdbEvent('connection_lost', { operation, error: toError(error, 'IndexedDB operation failed').message });

    try {
      await recoverConnectionOnce();
      syncPerf.addIdbEvent('recovery_retry', { operation });
      const result = await fn();
      idbRecoveryFailures = 0;
      return result;
    } catch (recoveryError) {
      idbRecoveryFailures += 1;
      syncPerf.setLastIdbError(toError(recoveryError, 'IndexedDB recovery failed').message);
      syncPerf.addIdbEvent('recovery_failed', { operation, failures: idbRecoveryFailures });

      if (idbRecoveryFailures >= IDB_RECOVERY_RETRY_LIMIT) {
        syncPerf.addIdbEvent('rebuild_required', { failures: idbRecoveryFailures });
        window.dispatchEvent(new CustomEvent('idb-rebuild-required', { detail: { failures: idbRecoveryFailures } }));
      }

      throw recoveryError;
    }
  }
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
    syncPerf.recordIdbOpenAttempt(DB_VERSION);
    syncPerf.addIdbEvent('open_attempt', { dbVersion: DB_VERSION });
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const oldVersion = Number((event as IDBVersionChangeEvent).oldVersion || 0);
      syncPerf.addIdbEvent('onupgradeneeded', { oldVersion, requestedVersion: DB_VERSION });
      const db = request.result;
      if (!db.objectStoreNames.contains(ORDERS_STORE)) {
        db.createObjectStore(ORDERS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(MUTATIONS_STORE)) {
        const mutationsStore = db.createObjectStore(MUTATIONS_STORE, { keyPath: 'id' });
        mutationsStore.createIndex('by_order_id', 'orderId', { unique: false });
        mutationsStore.createIndex('by_next_retry_at', 'nextRetryAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(ORDER_PATCHES_STORE)) {
        db.createObjectStore(ORDER_PATCHES_STORE, { keyPath: 'id' });
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
      syncPerf.addIdbEvent('open_success', { dbVersion: db.version });
      db.onversionchange = () => {
        syncPerf.addIdbEvent('idb_close', { reason: 'versionchange' });
        db.close();
        if (activeDb === db) activeDb = null;
      };
      db.onclose = () => {
        syncPerf.addIdbEvent('idb_close', { reason: 'close_event' });
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

const flushOrderWrites = async () => {
  if (pendingOrderFlushTimer) {
    window.clearTimeout(pendingOrderFlushTimer);
    pendingOrderFlushTimer = null;
  }
  if (pendingOrderFlushPromise) return pendingOrderFlushPromise;

  pendingOrderFlushPromise = withIdbRecovery('flush_order_writes', async () => {
    await measureIdbTx(async () => {
      const db = await openDb();
      const tx = db.transaction([ORDERS_STORE, ORDER_PATCHES_STORE], 'readwrite');
      const store = tx.objectStore(ORDERS_STORE);
      const patchStore = tx.objectStore(ORDER_PATCHES_STORE);
      if (pendingOrdersClear) {
        await txRequest(store.clear());
        await txRequest(patchStore.clear());
        pendingOrdersClear = false;
      }

      const writes = Array.from(pendingOrderWrites.entries());
      pendingOrderWrites.clear();
      for (const [orderId, op] of writes) {
        if (op.type === 'delete') {
          await txRequest(store.delete(orderId));
          await txRequest(patchStore.delete(orderId));
        } else {
          await txRequest(store.put(op.order));
          await txRequest(patchStore.delete(orderId));
        }
      }
      if (writes.length) syncPerf.recordIdbWrite();
    });
  });

  try {
    await pendingOrderFlushPromise;
  } finally {
    pendingOrderFlushPromise = null;
  }
};


const flushOrderPatchWrites = async () => {
  if (pendingOrderPatchFlushTimer) {
    window.clearTimeout(pendingOrderPatchFlushTimer);
    pendingOrderPatchFlushTimer = null;
  }
  if (pendingOrderPatchFlushPromise) return pendingOrderPatchFlushPromise;

  pendingOrderPatchFlushPromise = withIdbRecovery('flush_order_patch_writes', async () => {
    await measureIdbTx(async () => {
      const patches = Array.from(pendingOrderPatchWrites.entries());
      if (!patches.length) return;
      pendingOrderPatchWrites.clear();
      const db = await openDb();
      const tx = db.transaction(ORDER_PATCHES_STORE, 'readwrite');
      const store = tx.objectStore(ORDER_PATCHES_STORE);
      for (const [orderId, patch] of patches) {
        await txRequest(store.put({ id: orderId, patch, updatedAt: Date.now() }));
      }
      syncPerf.recordIdbWrite();
    });
  });

  try {
    await pendingOrderPatchFlushPromise;
  } finally {
    pendingOrderPatchFlushPromise = null;
  }
};


const flushMutationWrites = async () => {
  if (pendingMutationFlushTimer) {
    window.clearTimeout(pendingMutationFlushTimer);
    pendingMutationFlushTimer = null;
  }
  if (pendingMutationFlushPromise) return pendingMutationFlushPromise;

  pendingMutationFlushPromise = withIdbRecovery('flush_mutation_writes', async () => {
    await measureIdbTx(async () => {
      const writes = Array.from(pendingMutationWrites.values());
      if (!writes.length) return;
      pendingMutationWrites.clear();
      const db = await openDb();
      const tx = db.transaction(MUTATIONS_STORE, 'readwrite');
      const store = tx.objectStore(MUTATIONS_STORE);
      const count = await txRequest(store.count());

      for (const normalized of writes) {
        const existing = await txRequest(store.get(normalized.id)) as OfflineMutation | undefined;
        if (!existing && count >= MAX_MUTATIONS) {
          throw new Error(`Mutation queue limit reached (${MAX_MUTATIONS}). Export backup and clear queue.`);
        }
        await txRequest(store.put({ ...existing, ...normalized, createdAt: existing?.createdAt || normalized.createdAt }));
      }
      syncPerf.recordIdbWrite();
    });
  });

  try {
    await pendingMutationFlushPromise;
  } finally {
    pendingMutationFlushPromise = null;
  }
};

const scheduleMutationFlush = () => {
  if (!pendingMutationFlushTimer) {
    pendingMutationFlushTimer = window.setTimeout(() => {
      void flushMutationWrites();
    }, getJitterMs(600, 900));
  }
};

const scheduleOrderFlush = () => {
  if (!pendingOrderFlushTimer) {
    pendingOrderFlushTimer = window.setTimeout(() => {
      void flushOrderWrites();
    }, getJitterMs(600, 900));
  }
};

const scheduleOrderPatchFlush = () => {
  if (!pendingOrderPatchFlushTimer) {
    pendingOrderPatchFlushTimer = window.setTimeout(() => {
      void flushOrderPatchWrites();
    }, getJitterMs(600, 900));
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => {
    void flushOrderWrites();
    void flushOrderPatchWrites();
    void flushMutationWrites();
  });
}

export const offlineDb = {
  async getOrders(): Promise<Order[]> {
    await flushOrderWrites();
    await flushOrderPatchWrites();
    return withIdbRecovery('get_orders', () => measureIdbTx(async () => {
      const db = await openDb();
      const tx = db.transaction([ORDERS_STORE, ORDER_PATCHES_STORE], 'readonly');
      const rows = await txRequest(tx.objectStore(ORDERS_STORE).getAll()) as Order[];
      const patchRows = await txRequest(tx.objectStore(ORDER_PATCHES_STORE).getAll()) as Array<{ id: string; patch?: Partial<Order> }>;
      const patchMap = new Map(patchRows.map((item) => [item.id, item.patch || {}]));
      return rows
        .map((order) => patchMap.has(order.id) ? ({ ...order, ...patchMap.get(order.id)! }) : order)
        .sort((a, b) => b.createdAt - a.createdAt);
    }));
  },

  async saveOrders(orders: Order[]): Promise<void> {
    pendingOrdersClear = true;
    pendingOrderWrites.clear();
    for (const order of orders) {
      pendingOrderWrites.set(order.id, { type: 'put', order });
    }
    scheduleOrderFlush();
  },

  async saveOrder(order: Order): Promise<void> {
    pendingOrderWrites.set(order.id, { type: 'put', order });
    scheduleOrderFlush();
    logSyncCategory('IDB_TX', 'save_order', { orderId: order.id });
  },

  async saveOrderPatch(orderId: string, patch: Partial<Order>): Promise<void> {
    if (!orderId || !patch || !Object.keys(patch).length) return;
    const existing = pendingOrderPatchWrites.get(orderId) || {};
    pendingOrderPatchWrites.set(orderId, { ...existing, ...patch });
    scheduleOrderPatchFlush();
    logSyncCategory('IDB_TX', 'save_order_patch', { orderId, fields: Object.keys(patch) });
  },

  async deleteOrder(orderId: string): Promise<void> {
    pendingOrderWrites.set(orderId, { type: 'delete' });
    scheduleOrderFlush();
  },

  async enqueueMutation(mutation: OfflineMutation): Promise<void> {
    const normalized: OfflineMutation = {
      ...mutation,
      entity: mutation.entity || 'orders',
      entityId: mutation.entityId || mutation.orderId,
      operation: mutation.operation || mutation.type,
      retryCount: Number(mutation.retryCount || 0),
      lastError: mutation.lastError || null,
      nextRetryAt: Number(mutation.nextRetryAt || 0)
    };

    pendingMutationWrites.set(normalized.id, normalized);
    scheduleMutationFlush();
    logSyncCategory('MUTATION_QUEUE', 'mutation_enqueued', { id: normalized.id, type: normalized.type, orderId: normalized.orderId });
  },

  async getMutations(): Promise<OfflineMutation[]> {
    await flushMutationWrites();
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, 'readonly');
    const rows = await txRequest(tx.objectStore(MUTATIONS_STORE).getAll());
    return (rows as OfflineMutation[]).sort((a, b) => a.createdAt - b.createdAt);
  },

  async getMutationCount(): Promise<number> {
    await flushMutationWrites();
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, 'readonly');
    return txRequest(tx.objectStore(MUTATIONS_STORE).count());
  },

  async removeMutation(mutationId: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, 'readwrite');
    await txRequest(tx.objectStore(MUTATIONS_STORE).delete(mutationId));
    syncPerf.recordIdbWrite();
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

  async rebuildLocalCacheSafely(): Promise<void> {
    await flushOrderWrites();
    await flushOrderPatchWrites();
    await flushMutationWrites();
    const snapshot = await this.exportAllData();
    await this.rebuildIndex();
    await this.importAllData(snapshot);
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
