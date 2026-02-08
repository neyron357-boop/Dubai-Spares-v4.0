import { useState, useEffect, useCallback } from 'react';
import { Order, Supplier } from './types';

const ORDERS_KEY = 'dubai_spares_orders';
const SUPPLIERS_KEY = 'dubai_spares_suppliers';

// Global Memory State (Singleton Pattern)
let globalOrders: Order[] = [];
let globalSuppliers: Supplier[] = [];
let listeners = new Set<() => void>();

const normalizeOrder = (order: Order): Order => ({
  ...order,
  isVip: !!order.isVip,
  isPinned: !!order.isPinned,
  notes: Array.isArray(order.notes) ? order.notes : []
});

// Initialize once on module load
try {
  const savedOrders = localStorage.getItem(ORDERS_KEY);
  if (savedOrders) globalOrders = JSON.parse(savedOrders).map(normalizeOrder);

  const savedSuppliers = localStorage.getItem(SUPPLIERS_KEY);
  if (savedSuppliers) globalSuppliers = JSON.parse(savedSuppliers);
} catch (e) {
  console.error('Failed to load initial data:', e);
}

const notifyListeners = () => {
  // Persist to storage
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(globalOrders));
    localStorage.setItem(SUPPLIERS_KEY, JSON.stringify(globalSuppliers));
  } catch (e) {
    console.error('Failed to persist data:', e);
  }
  // Update all subscribed components
  listeners.forEach(listener => listener());
};

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
  globalOrders = data.orders.map(normalizeOrder);
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
    globalOrders = [normalizeOrder(order), ...globalOrders];
    notifyListeners();
  }, []);

  const updateOrder = useCallback((updatedOrder: Order) => {
    globalOrders = globalOrders.map(o => o.id === updatedOrder.id ? normalizeOrder(updatedOrder) : o);
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
