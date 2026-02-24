import { useMemo, useState, useEffect, useCallback } from 'react';
import { Supplier } from './types';
import { useOrderStore, subscribeOrderStore, getOrderState, restoreOrdersExternal, fetchOrderDetails } from './orderStore';
import { ensureUuid } from './id';
import { deleteSupplierFromShops, fetchSuppliersFromShops } from './radarShops';

const SUPPLIERS_KEY = 'dubai_spares_suppliers';

let globalSuppliers: Supplier[] = [];
let listeners = new Set<() => void>();

const normalizeSupplier = (supplier: Supplier): Supplier => ({
  ...supplier,
  id: ensureUuid(supplier.id),
  type: supplier.type || 'new_parts',
  types: Array.isArray(supplier.types) && supplier.types.length > 0
    ? supplier.types.filter(Boolean)
    : [supplier.type || 'new_parts'],
  zone: typeof supplier.zone === 'string' ? supplier.zone : '',
  heatLevel: Number.isFinite(Number(supplier.heatLevel)) ? Number(supplier.heatLevel) : 0,
  brands: Array.isArray(supplier.brands) ? supplier.brands : [],
  mainBrands: Array.isArray(supplier.mainBrands) ? supplier.mainBrands : (Array.isArray(supplier.brands) ? supplier.brands : []),
  models: Array.isArray(supplier.models) ? supplier.models : [],
  years: Array.isArray(supplier.years)
    ? supplier.years.map((year) => Number(year)).filter((year) => Number.isFinite(year))
    : [],
  bodyTypes: Array.isArray(supplier.bodyTypes) ? supplier.bodyTypes : [],
  primaryBrand: typeof supplier.primaryBrand === 'string' ? supplier.primaryBrand : (Array.isArray(supplier.mainBrands) && supplier.mainBrands[0]) || '',
  gpsAccuracyMeters: Number.isFinite(Number(supplier.gpsAccuracyMeters)) ? Number(supplier.gpsAccuracyMeters) : undefined,
  workingHours: typeof supplier.workingHours === 'string' ? supplier.workingHours : '',
  trustLevel: Number.isFinite(Number(supplier.trustLevel)) ? Number(supplier.trustLevel) : 3,
  hasDelivery: supplier.hasDelivery === true,
  hasWhatsapp: supplier.hasWhatsapp !== false,
  whatsappFast: supplier.whatsappFast === true,
  comment: typeof supplier.comment === 'string' ? supplier.comment : '',
  website: typeof supplier.website === 'string' ? supplier.website : '',
  foundCount: Number.isFinite(Number(supplier.foundCount)) ? Number(supplier.foundCount) : 0,
  notFoundCount: Number.isFinite(Number(supplier.notFoundCount)) ? Number(supplier.notFoundCount) : 0,
  wrongInfoCount: Number.isFinite(Number(supplier.wrongInfoCount)) ? Number(supplier.wrongInfoCount) : 0,
  successRate: Number.isFinite(Number(supplier.successRate)) ? Number(supplier.successRate) : 0,
  activityScore: Number.isFinite(Number(supplier.activityScore)) ? Number(supplier.activityScore) : 0,
  lastContactAt: Number.isFinite(Number(supplier.lastContactAt)) ? Number(supplier.lastContactAt) : 0,
  isFavorite: supplier.isFavorite === true,
  createdAt: Number.isFinite(Number(supplier.createdAt)) ? Number(supplier.createdAt) : Date.now(),
  updatedAt: Number.isFinite(Number(supplier.updatedAt)) ? Number(supplier.updatedAt) : Date.now(),
  syncStatus: supplier.syncStatus === 'pending_sync' || supplier.syncStatus === 'error' ? supplier.syncStatus : 'synced',
});

try {
  const savedSuppliers = localStorage.getItem(SUPPLIERS_KEY);
  if (savedSuppliers) globalSuppliers = (JSON.parse(savedSuppliers) as Supplier[]).map(normalizeSupplier);
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

let supplierSyncInFlight = false;

export const syncSuppliersFromServer = async () => {
  if (supplierSyncInFlight) return;
  supplierSyncInFlight = true;
  try {
    const serverSuppliers = await fetchSuppliersFromShops();
    if (serverSuppliers.length === 0) return;
    const merged = new Map<string, Supplier>();
    globalSuppliers.forEach((supplier) => merged.set(supplier.id, normalizeSupplier(supplier)));
    serverSuppliers.forEach((supplier) => merged.set(supplier.id, normalizeSupplier(supplier)));
    const nextSuppliers = Array.from(merged.values()).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    if (JSON.stringify(nextSuppliers) !== JSON.stringify(globalSuppliers)) {
      globalSuppliers = nextSuppliers;
      notifySupplierListeners();
    }
  } catch (e) {
    console.error('Failed to sync suppliers from server:', e);
  } finally {
    supplierSyncInFlight = false;
  }
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

    const ordersWithManualRecommendation = orders.filter((order) => (order.recommendedShopIds || []).includes(normalizedId) || (order.dismissedShopIds || []).includes(normalizedId));
    await Promise.all(
      ordersWithManualRecommendation.map((order) => {
        const nextRecommended = (order.recommendedShopIds || []).filter((shopId) => shopId !== normalizedId);
        const nextDismissed = (order.dismissedShopIds || []).filter((shopId) => shopId !== normalizedId);
        return updateOrder({ ...order, recommendedShopIds: nextRecommended, dismissedShopIds: nextDismissed });
      })
    );
  }, [orders, updateOrder]);

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
  }), [version, orders, isLoading, error, addOrder, updateOrder, deleteOrder, updatePart, updatePriceVariant, addSupplier, updateSupplier, deleteSupplier, getBackupData, restoreData, fetchOrders, fetchOrderDetails]);
};
