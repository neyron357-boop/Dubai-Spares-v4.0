import { useMemo, useState, useEffect, useCallback } from 'react';
import { Supplier } from './types';
import { useOrderStore, subscribeOrderStore, getOrderState, restoreOrdersExternal } from './orderStore';

const SUPPLIERS_KEY = 'dubai_spares_suppliers';

let globalSuppliers: Supplier[] = [];
let listeners = new Set<() => void>();

try {
  const savedSuppliers = localStorage.getItem(SUPPLIERS_KEY);
  if (savedSuppliers) globalSuppliers = JSON.parse(savedSuppliers);
} catch (e) {
  console.error('Failed to load suppliers:', e);
}

const notifySupplierListeners = () => {
  try {
    localStorage.setItem(SUPPLIERS_KEY, JSON.stringify(globalSuppliers));
  } catch (e) {
    console.error('Failed to persist suppliers:', e);
  }
  listeners.forEach((listener) => listener());
};

export const subscribeStore = (listener: () => void) => {
  const unsubscribeOrders = subscribeOrderStore(listener);
  listeners.add(listener);
  return () => {
    unsubscribeOrders();
    listeners.delete(listener);
  };
};

export const exportData = () => ({
  orders: getOrderState().orders,
  suppliers: globalSuppliers,
  version: '2.0',
  exportedAt: new Date().toISOString()
});

export const restoreDataExternal = (data: any) => {
  if (!data || !Array.isArray(data.orders)) {
    throw new Error('Неверный формат данных');
  }

  restoreOrdersExternal(data.orders);
  globalSuppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
  notifySupplierListeners();
};

export const useStore = () => {
  const [_, setVersion] = useState(0);

  const { orders, addOrder, updateOrder, deleteOrder, updatePart, updatePriceVariant, fetchOrders } = useOrderStore();

  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  const addSupplier = useCallback((supplier: Supplier) => {
    globalSuppliers = [supplier, ...globalSuppliers];
    notifySupplierListeners();
  }, []);

  const updateSupplier = useCallback((updated: Supplier) => {
    globalSuppliers = globalSuppliers.map((s) => (s.id === updated.id ? updated : s));
    notifySupplierListeners();
  }, []);

  const deleteSupplier = useCallback((id: string) => {
    globalSuppliers = globalSuppliers.filter((s) => s.id !== id);
    notifySupplierListeners();
  }, []);

  const getBackupData = useCallback(() => exportData(), []);
  const restoreData = useCallback((data: any) => restoreDataExternal(data), []);

  return useMemo(() => ({
    orders,
    suppliers: globalSuppliers,
    addOrder,
    updateOrder,
    deleteOrder,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    getBackupData,
    exportData: getBackupData,
    restoreData,
    updatePart,
    updatePriceVariant,
    fetchOrders
  }), [orders, addOrder, updateOrder, deleteOrder, updatePart, updatePriceVariant, addSupplier, updateSupplier, deleteSupplier, getBackupData, restoreData, fetchOrders]);
};
