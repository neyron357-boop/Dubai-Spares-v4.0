import { useState, useEffect, useCallback } from 'react';
import { Order, Supplier } from './types';

const ORDERS_KEY = 'dubai_spares_orders';
const SUPPLIERS_KEY = 'dubai_spares_suppliers';

// Global Memory State (Singleton Pattern)
// This ensures that state updates are immediate and shared across all components 
// without waiting for LocalStorage round-trips or React render cycles.
let globalOrders: Order[] = [];
let globalSuppliers: Supplier[] = [];
let listeners = new Set<() => void>();

// Initialize once on module load
try {
  const savedOrders = localStorage.getItem(ORDERS_KEY);
  if (savedOrders) globalOrders = JSON.parse(savedOrders);

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
    return {
      orders: globalOrders,
      suppliers: globalSuppliers,
      version: '1.3',
      exportedAt: new Date().toISOString()
    };
  }, []);

  const restoreData = useCallback((data: any) => {
    if (!data || !Array.isArray(data.orders)) {
      throw new Error('Неверный формат данных');
    }
    globalOrders = data.orders;
    globalSuppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
    notifyListeners();
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
    restoreData
  };
};
