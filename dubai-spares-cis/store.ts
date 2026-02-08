import { useState, useEffect, useCallback } from 'react';
import { Order, Supplier } from './types';

const ORDERS_KEY = 'dubai_spares_orders';
const SUPPLIERS_KEY = 'dubai_spares_suppliers';

const IDB_NAME = 'dubai_spares_local_db';
const IDB_STORE = 'app_state';
const IDB_KEY = 'global';

type PersistedState = {
  orders: Order[];
  suppliers: Supplier[];
  updatedAt: number;
};

// Global Memory State (Singleton Pattern)
let globalOrders: Order[] = [];
let globalSuppliers: Supplier[] = [];
let listeners = new Set<() => void>();

let idbWriteInFlight = false;
let idbWriteQueued = false;

const getCurrentState = (): PersistedState => ({
  orders: globalOrders,
  suppliers: globalSuppliers,
  updatedAt: Date.now()
});

const openDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const req = indexedDB.open(IDB_NAME, 1);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
};

const readFromIndexedDb = async (): Promise<PersistedState | null> => {
  try {
    const db = await openDb();
    const result = await new Promise<PersistedState | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);

      req.onsuccess = () => resolve((req.result as PersistedState | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('Failed to read IndexedDB'));
    });
    db.close();
    return result;
  } catch (e) {
    console.warn('IndexedDB read skipped:', e);
    return null;
  }
};

const writeToIndexedDb = async (state: PersistedState) => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(state, IDB_KEY);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Failed to write IndexedDB'));
  });
  db.close();
};

const requestPersistentStorage = async () => {
  if (typeof navigator === 'undefined' || !('storage' in navigator)) return;
  try {
    const storage = navigator.storage as StorageManager;
    const alreadyPersistent = await storage.persisted?.();
    if (!alreadyPersistent) {
      await storage.persist?.();
    }
  } catch (e) {
    console.warn('Persistent storage request failed:', e);
  }
};

const persistLocal = () => {
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(globalOrders));
    localStorage.setItem(SUPPLIERS_KEY, JSON.stringify(globalSuppliers));
  } catch (e) {
    console.error('Failed to persist data to localStorage:', e);
  }
};

const persistIndexedDb = async () => {
  if (idbWriteInFlight) {
    idbWriteQueued = true;
    return;
  }

  idbWriteInFlight = true;
  do {
    idbWriteQueued = false;
    try {
      await writeToIndexedDb(getCurrentState());
    } catch (e) {
      console.error('Failed to persist data to IndexedDB:', e);
      break;
    }
  } while (idbWriteQueued);

  idbWriteInFlight = false;
};

const notifyListeners = () => {
  persistLocal();
  void persistIndexedDb();
  listeners.forEach(listener => listener());
};

const initializeStore = async () => {
  // Fast sync bootstrap from localStorage
  try {
    const savedOrders = localStorage.getItem(ORDERS_KEY);
    if (savedOrders) globalOrders = JSON.parse(savedOrders);

    const savedSuppliers = localStorage.getItem(SUPPLIERS_KEY);
    if (savedSuppliers) globalSuppliers = JSON.parse(savedSuppliers);
  } catch (e) {
    console.error('Failed to load initial data from localStorage:', e);
  }

  // Stronger persistence layer (IndexedDB)
  const idbState = await readFromIndexedDb();
  if (idbState) {
    globalOrders = Array.isArray(idbState.orders) ? idbState.orders : globalOrders;
    globalSuppliers = Array.isArray(idbState.suppliers) ? idbState.suppliers : globalSuppliers;
    persistLocal();
    listeners.forEach(listener => listener());
  }

  await requestPersistentStorage();
};

void initializeStore();

/**
 * ✅ External subscribe for cloud sync
 */
export const subscribeStore = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * ✅ External export for cloud sync
 */
export const exportData = () => {
  return {
    orders: globalOrders,
    suppliers: globalSuppliers,
    version: '1.3',
    exportedAt: new Date().toISOString()
  };
};

/**
 * ✅ External restore for cloud sync (NO React hooks!)
 */
export const restoreDataExternal = (data: any) => {
  if (!data || !Array.isArray(data.orders)) {
    throw new Error('Неверный формат данных');
  }
  globalOrders = data.orders;
  globalSuppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
  notifyListeners();
};

export const useStore = () => {
  const [_, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion(v => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const addOrder = useCallback((order: Order) => {
    globalOrders = [order, ...globalOrders];
    notifyListeners();
  }, []);

  const updateOrder = useCallback((updatedOrder: Order) => {
    globalOrders = globalOrders.map(o => o.id === updatedOrder.id ? updatedOrder : o);
    notifyListeners();
  }, []);

  const deleteOrder = useCallback((id: string) => {
    globalOrders = globalOrders.filter(o => o.id !== id);
    notifyListeners();
  }, []);

  const addSupplier = useCallback((supplier: Supplier) => {
    globalSuppliers = [supplier, ...globalSuppliers];
    notifyListeners();
  }, []);

  const updateSupplier = useCallback((updated: Supplier) => {
    globalSuppliers = globalSuppliers.map(s => s.id === updated.id ? updated : s);
    notifyListeners();
  }, []);

  const deleteSupplier = useCallback((id: string) => {
    globalSuppliers = globalSuppliers.filter(s => s.id !== id);
    notifyListeners();
  }, []);

  const getBackupData = useCallback(() => {
    return exportData();
  }, []);

  const restoreData = useCallback((data: any) => {
    restoreDataExternal(data);
  }, []);

  return {
    orders: globalOrders,
    suppliers: globalSuppliers,
    addOrder,
    updateOrder,
    deleteOrder,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    getBackupData,
    exportData: getBackupData,
    restoreData
  };
};
