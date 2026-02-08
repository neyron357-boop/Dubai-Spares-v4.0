import { useState, useEffect, useCallback } from 'react';
import { Order, Supplier, Priority, Source, OrderNote } from './types';

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

let globalOrders: Order[] = [];
let globalSuppliers: Supplier[] = [];
let listeners = new Set<() => void>();
let hydrateListeners = new Set<(ready: boolean) => void>();
let isHydrated = false;

let idbWriteInFlight = false;
let idbWriteQueued = false;

const normalizeOrder = (order: any): Order => ({
  id: String(order?.id ?? Date.now()),
  brand: order?.brand ?? '',
  model: order?.model ?? '',
  year: order?.year ?? '',
  vin: order?.vin ?? '',
  priority: (Object.values(Priority).includes(order?.priority) ? order.priority : Priority.MEDIUM) as Priority,
  clientName: order?.clientName ?? '',
  source: (Object.values(Source).includes(order?.source) ? order.source : Source.OTHER) as Source,
  carPhotoUrl: order?.carPhotoUrl,
  carPhotos: Array.isArray(order?.carPhotos) ? order.carPhotos : (order?.carPhotoUrl ? [order.carPhotoUrl] : []),
  parts: Array.isArray(order?.parts) ? order.parts : [],
  notes: Array.isArray(order?.notes) ? order.notes : [],
  isPinned: Boolean(order?.isPinned),
  isVip: Boolean(order?.isVip),
  markupPercent: Number(order?.markupPercent ?? 25),
  exchangeRate: Number(order?.exchangeRate ?? 3.67),
  createdAt: Number(order?.createdAt ?? Date.now()),
  isArchived: Boolean(order?.isArchived),
  isSold: Boolean(order?.isSold),
  soldProfitUsd: typeof order?.soldProfitUsd === 'number' ? order.soldProfitUsd : undefined
});

const normalizeState = (state: PersistedState | null): PersistedState | null => {
  if (!state) return null;
  return {
    orders: Array.isArray(state.orders) ? state.orders.map(normalizeOrder) : [],
    suppliers: Array.isArray(state.suppliers) ? state.suppliers : [],
    updatedAt: Number(state.updatedAt ?? Date.now())
  };
};

const getCurrentState = (): PersistedState => ({
  orders: globalOrders,
  suppliers: globalSuppliers,
  updatedAt: Date.now()
});

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB is not available'));
    return;
  }

  const req = indexedDB.open(IDB_NAME, 1);

  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
  };

  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
});

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
    return normalizeState(result);
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
    if (!alreadyPersistent) await storage.persist?.();
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

const setHydrated = (ready: boolean) => {
  isHydrated = ready;
  hydrateListeners.forEach(listener => listener(ready));
};

const initializeStore = async () => {
  try {
    const savedOrders = localStorage.getItem(ORDERS_KEY);
    if (savedOrders) globalOrders = JSON.parse(savedOrders).map(normalizeOrder);

    const savedSuppliers = localStorage.getItem(SUPPLIERS_KEY);
    if (savedSuppliers) globalSuppliers = JSON.parse(savedSuppliers);
  } catch (e) {
    console.error('Failed to load initial data from localStorage:', e);
  }

  const idbState = await readFromIndexedDb();
  if (idbState) {
    globalOrders = idbState.orders;
    globalSuppliers = idbState.suppliers;
    persistLocal();
    listeners.forEach(listener => listener());
  }

  await requestPersistentStorage();
  setHydrated(true);
};

void initializeStore();

export const subscribeStore = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const subscribeHydration = (listener: (ready: boolean) => void) => {
  hydrateListeners.add(listener);
  listener(isHydrated);
  return () => hydrateListeners.delete(listener);
};

export const exportData = () => ({
  orders: globalOrders,
  suppliers: globalSuppliers,
  version: '1.4',
  exportedAt: new Date().toISOString()
});

export const restoreDataExternal = (data: any) => {
  if (!data || !Array.isArray(data.orders)) {
    throw new Error('Неверный формат данных');
  }

  globalOrders = data.orders.map(normalizeOrder);
  globalSuppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
  notifyListeners();
};

export const useStore = () => {
  const [, setVersion] = useState(0);
  const [hydrated, setHydratedState] = useState(isHydrated);

  useEffect(() => {
    const listener = () => setVersion(v => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => subscribeHydration(setHydratedState), []);

  const addOrder = useCallback((order: Order) => {
    globalOrders = [normalizeOrder(order), ...globalOrders];
    notifyListeners();
  }, []);

  const updateOrder = useCallback((updatedOrder: Order) => {
    const normalized = normalizeOrder(updatedOrder);
    globalOrders = globalOrders.map(o => (o.id === normalized.id ? normalized : o));
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
    globalSuppliers = globalSuppliers.map(s => (s.id === updated.id ? updated : s));
    notifyListeners();
  }, []);

  const deleteSupplier = useCallback((id: string) => {
    globalSuppliers = globalSuppliers.filter(s => s.id !== id);
    notifyListeners();
  }, []);

  const getBackupData = useCallback(() => exportData(), []);
  const restoreData = useCallback((data: any) => restoreDataExternal(data), []);
  const addNote = useCallback((orderId: string, note: OrderNote) => {
    globalOrders = globalOrders.map(o => o.id === orderId ? { ...o, notes: [note, ...(o.notes ?? [])] } : o);
    notifyListeners();
  }, []);

  return {
    orders: globalOrders,
    suppliers: globalSuppliers,
    isHydrated: hydrated,
    addOrder,
    updateOrder,
    deleteOrder,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    getBackupData,
    exportData: getBackupData,
    restoreData,
    addNote
  };
};
