import { useMemo, useState, useEffect, useCallback } from 'react';
import { Supplier } from './types';
import { useOrderStore, subscribeOrderStore, getOrderState, restoreOrdersExternal, fetchOrderDetails } from './orderStore';
import { ensureUuid } from './id';
import { deleteSupplierFromShops } from './radarShops';

const SUPPLIERS_KEY = 'dubai_spares_suppliers';

let globalSuppliers: Supplier[] = [];
let listeners = new Set<() => void>();

const normalizeSupplier = (supplier: Supplier): Supplier => ({
  ...supplier,
  id: ensureUuid(supplier.id),
  type: supplier.type || 'new_parts',
  zone: typeof supplier.zone === 'string' ? supplier.zone : '',
  heatLevel: Number.isFinite(Number(supplier.heatLevel)) ? Number(supplier.heatLevel) : 0,
  brands: Array.isArray(supplier.brands) ? supplier.brands : [],
  mainBrands: Array.isArray(supplier.mainBrands) ? supplier.mainBrands : (Array.isArray(supplier.brands) ? supplier.brands : []),
  models: Array.isArray(supplier.models) ? supplier.models : [],
  years: Array.isArray(supplier.years) ? supplier.years.map((year) => Number(year)).filter((year) => Number.isFinite(year)) : [],
  bodyTypes: Array.isArray(supplier.bodyTypes) ? supplier.bodyTypes : [],
  primaryBrand: typeof supplier.primaryBrand === 'string' ? supplier.primaryBrand : (Array.isArray(supplier.mainBrands) && supplier.mainBrands[0]) || '',
  createdAt: Number.isFinite(Number(supplier.createdAt)) ? Number(supplier.createdAt) : Date.now(),
  updatedAt: Number.isFinite(Number(supplier.updatedAt)) ? Number(supplier.updatedAt) : Date.now()
});

try {
  const savedSuppliers = localStorage.getItem(SUPPLIERS_KEY);
  if (savedSuppliers) globalSuppliers = (JSON.parse(savedSuppliers) as Supplier[]).map(normalizeSupplier);
} catch {
  globalSuppliers = [];
}

const notifySupplierListeners = () => {
  try {
    localStorage.setItem(SUPPLIERS_KEY, JSON.stringify(globalSuppliers));
  } catch {
    // ignore localStorage quota errors
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
  if (!data || !Array.isArray(data.orders)) throw new Error('Неверный формат данных');
  restoreOrdersExternal(data.orders);
  globalSuppliers = Array.isArray(data.suppliers) ? data.suppliers.map((supplier: Supplier) => normalizeSupplier(supplier)) : [];
  notifySupplierListeners();
};

export const useStore = () => {
  const [version, setVersion] = useState(0);
  const { orders, isLoading, error, addOrder, updateOrder, deleteOrder, updatePart, updatePriceVariant, fetchOrders } = useOrderStore();

  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  const addSupplier = useCallback((supplier: Supplier) => {
    globalSuppliers = [normalizeSupplier(supplier), ...globalSuppliers];
    notifySupplierListeners();
  }, []);

  const updateSupplier = useCallback((updated: Supplier) => {
    const normalized = normalizeSupplier(updated);
    globalSuppliers = globalSuppliers.map((s) => (s.id === normalized.id ? normalized : s));
    notifySupplierListeners();
  }, []);

  const deleteSupplier = useCallback(async (id: string) => {
    const normalizedId = ensureUuid(id);
    globalSuppliers = globalSuppliers.filter((s) => s.id !== normalizedId);
    notifySupplierListeners();
    await deleteSupplierFromShops(normalizedId);
  }, []);

  const getBackupData = useCallback(() => exportData(), []);
  const restoreData = useCallback((data: any) => restoreDataExternal(data), []);

  return useMemo(() => ({
    orders,
    isLoading,
    error,
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
    fetchOrders,
    syncOrders: fetchOrders,
    fetchOrderDetails
  }), [version, orders, isLoading, error, addOrder, updateOrder, deleteOrder, updatePart, updatePriceVariant, addSupplier, updateSupplier, deleteSupplier, getBackupData, restoreData, fetchOrders]);
};
