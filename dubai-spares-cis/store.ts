import { useMemo, useState, useEffect, useCallback } from 'react';
import { Supplier } from './types';
import { useOrderStore, subscribeOrderStore, getOrderState, restoreOrdersExternal, fetchOrderDetails } from './orderStore';
import { ensureUuid } from './id';
import { deleteSupplierFromShops, fetchSuppliersFromShops } from './radarShops';

const SUPPLIERS_KEY = 'dubai_spares_suppliers';

const normalizeSupplierId = (value: unknown) => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return ensureUuid();
};

let globalSuppliers: Supplier[] = [];
let listeners = new Set<() => void>();

const normalizeSupplier = (supplier: Supplier): Supplier => ({
  ...supplier,
  id: normalizeSupplierId(supplier.id),
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
  autoTrustScore: Number.isFinite(Number(supplier.autoTrustScore)) ? Number(supplier.autoTrustScore) : undefined,
  hasDelivery: supplier.hasDelivery === true,
  hasWhatsapp: supplier.hasWhatsapp !== false,
  whatsapp: typeof supplier.whatsapp === 'string' ? supplier.whatsapp : '',
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
  radarCount: Number.isFinite(Number(supplier.radarCount)) ? Number(supplier.radarCount) : 0,
  activeOrderIds: Array.isArray(supplier.activeOrderIds)
    ? supplier.activeOrderIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [],
  linkedParts: Array.isArray(supplier.linkedParts)
    ? supplier.linkedParts
      .filter((item): item is NonNullable<Supplier['linkedParts']>[number] => !!item && typeof item === 'object')
      .map((item) => ({
        ...item,
        id: typeof item.id === 'string' ? item.id : ensureUuid(),
        orderId: typeof item.orderId === 'string' ? item.orderId : '',
        orderLabel: typeof item.orderLabel === 'string' ? item.orderLabel : '',
        partId: typeof item.partId === 'string' ? item.partId : '',
        partName: typeof item.partName === 'string' ? item.partName : '',
        status: item.status === 'found' || item.status === 'not_found' || item.status === 'follow_up' ? item.status : 'searching',
        priceAed: Number.isFinite(Number(item.priceAed)) ? Number(item.priceAed) : undefined,
        source: item.source === 'variant' ? 'variant' : 'manual',
        updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : Date.now()
      }))
      .filter((item) => item.orderId && item.partId)
    : [],
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

const appendUniqueTextValue = (values: string[] | undefined, nextValue: string | undefined): string[] => {
  const cleanedValues = Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const normalizedNextValue = typeof nextValue === 'string' ? nextValue.trim() : '';
  if (!normalizedNextValue) return cleanedValues;
  if (cleanedValues.some((value) => value.toLowerCase() === normalizedNextValue.toLowerCase())) {
    return cleanedValues;
  }
  return [...cleanedValues, normalizedNextValue];
};

const syncSuppliersFromOrderVariants = (orders: ReturnType<typeof getOrderState>['orders']) => {
  if (!Array.isArray(orders) || orders.length === 0) return;

  let hasUpdates = false;
  const byName = new Map<string, Supplier>();
  const byId = new Map<string, Supplier>();
  globalSuppliers.forEach((supplier) => {
    const key = supplier.name.trim().toLowerCase();
    if (key) byName.set(key, supplier);
    if (supplier.id) byId.set(supplier.id, supplier);
  });

  const collected: Supplier[] = [];
  orders.forEach((order) => {
    order.parts.forEach((part) => {
      part.variants.forEach((variant) => {
        const rawName = typeof variant.shopName === 'string' ? variant.shopName.trim() : '';
        if (!rawName) return;
        const key = rawName.toLowerCase();
        const now = Date.now();
        const linkedPart = {
          id: ensureUuid(),
          orderId: order.id,
          orderLabel: `${order.brand} ${order.model} • ${order.vin}`,
          partId: part.id,
          partName: part.name,
          status: part.isFound ? 'found' : 'searching',
          priceAed: Number.isFinite(Number(variant.priceAed)) ? Number(variant.priceAed) : undefined,
          source: 'variant' as const,
          updatedAt: now
        };

        const existingSupplier = (variant.shopId && byId.get(String(variant.shopId))) || byName.get(key);
        if (existingSupplier) {
          const existingLinkedParts = Array.isArray(existingSupplier.linkedParts) ? existingSupplier.linkedParts : [];
          const hasLinkedPart = existingLinkedParts.some((item) => item.orderId === order.id && item.partId === part.id);
          const nextLinkedParts = hasLinkedPart
            ? existingLinkedParts
            : [linkedPart, ...existingLinkedParts];

          const nextOrderIds = Array.from(new Set([...(existingSupplier.activeOrderIds || []), order.id]));
          const nextPhone = existingSupplier.phone || (typeof variant.phone === 'string' ? variant.phone : '');
          const nextLocation = existingSupplier.location || (typeof variant.location === 'string' ? variant.location : '');
          const nextBrands = appendUniqueTextValue(existingSupplier.brands, order.brand);
          const nextMainBrands = appendUniqueTextValue(existingSupplier.mainBrands, order.brand);
          const nextModels = appendUniqueTextValue(existingSupplier.models, order.model);
          const nextYears = Number.isFinite(Number(order.year))
            ? Array.from(new Set([...(existingSupplier.years || []), Number(order.year)])).sort((a, b) => a - b)
            : (existingSupplier.years || []);
          const nextPrimaryBrand = existingSupplier.primaryBrand || nextMainBrands[0] || '';

          const shouldUpdate = !hasLinkedPart
            || nextOrderIds.length !== (existingSupplier.activeOrderIds || []).length
            || nextPhone !== existingSupplier.phone
            || nextLocation !== existingSupplier.location
            || nextBrands.length !== (existingSupplier.brands || []).length
            || nextMainBrands.length !== (existingSupplier.mainBrands || []).length
            || nextModels.length !== (existingSupplier.models || []).length
            || nextYears.length !== (existingSupplier.years || []).length
            || nextPrimaryBrand !== (existingSupplier.primaryBrand || '');

          if (!shouldUpdate) return;

          const updatedSupplier = normalizeSupplier({
            ...existingSupplier,
            phone: nextPhone,
            location: nextLocation,
            brands: nextBrands,
            mainBrands: nextMainBrands,
            primaryBrand: nextPrimaryBrand,
            models: nextModels,
            years: nextYears,
            linkedParts: nextLinkedParts,
            activeOrderIds: nextOrderIds,
            updatedAt: now,
            syncStatus: existingSupplier.syncStatus === 'synced' ? 'pending_sync' : existingSupplier.syncStatus
          });

          globalSuppliers = globalSuppliers.map((supplier) => supplier.id === updatedSupplier.id ? updatedSupplier : supplier);
          byName.set(key, updatedSupplier);
          byId.set(updatedSupplier.id, updatedSupplier);
          hasUpdates = true;
          return;
        }

        const supplierFromVariant: Supplier = normalizeSupplier({
          id: ensureUuid(),
          name: rawName,
          phone: typeof variant.phone === 'string' ? variant.phone : '',
          location: typeof variant.location === 'string' ? variant.location : '',
          brands: order.brand ? [order.brand] : [],
          mainBrands: order.brand ? [order.brand] : [],
          primaryBrand: order.brand || '',
          models: order.model ? [order.model] : [],
          years: Number.isFinite(Number(order.year)) ? [Number(order.year)] : [],
          type: 'new_parts',
          types: ['new_parts'],
          photoUrl: variant.photoUrl || '',
          photos: Array.isArray(variant.photos) ? variant.photos.filter((url): url is string => typeof url === 'string' && url.trim().length > 0) : [],
          linkedParts: [linkedPart],
          activeOrderIds: [order.id],
          createdAt: now,
          updatedAt: now,
          syncStatus: 'pending_sync'
        });

        byName.set(key, supplierFromVariant);
        byId.set(supplierFromVariant.id, supplierFromVariant);
        collected.push(supplierFromVariant);
      });
    });
  });

  if (!hasUpdates && collected.length === 0) return;
  if (collected.length > 0) {
    globalSuppliers = [...collected, ...globalSuppliers];
  }
  notifySupplierListeners();
};

let supplierSyncInFlight = false;
let supplierLastSyncedAt = 0;
const SUPPLIER_SYNC_TTL_MS = 3 * 60 * 1000;

export const syncSuppliersFromServer = async (force = false) => {
  if (supplierSyncInFlight) return;
  if (!force && Date.now() - supplierLastSyncedAt < SUPPLIER_SYNC_TTL_MS) return;
  supplierSyncInFlight = true;
  try {
    const serverSuppliers = await fetchSuppliersFromShops();
    supplierLastSyncedAt = Date.now();
    const dedupedById = new Map<string, Supplier>();
    serverSuppliers.forEach((supplier) => {
      const normalizedServer = normalizeSupplier(supplier);
      dedupedById.set(normalizedServer.id, normalizedServer);
    });

    // Защитный merge: если сервер временно возвращает усечённый список,
    // не теряем уже известные карточки (например, подтянутые из заказов).
    // Серверные записи остаются приоритетными по id и имени.
    const mergedByName = new Map<string, Supplier>();
    globalSuppliers.forEach((supplier) => {
      mergedByName.set(supplier.name.trim().toLowerCase(), normalizeSupplier(supplier));
    });
    dedupedById.forEach((supplier) => {
      mergedByName.set(supplier.name.trim().toLowerCase(), supplier);
    });

    const nextSuppliers = Array.from(mergedByName.values()).sort((a, b) => {
      const updatedAtDiff = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      if (updatedAtDiff !== 0) return updatedAtDiff;
      return a.name.localeCompare(b.name);
    });

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

  useEffect(() => {
    void syncSuppliersFromServer();
  }, []);

  useEffect(() => {
    syncSuppliersFromOrderVariants(orders);
  }, [orders]);

  const addSupplier = useCallback((supplier: Supplier) => {
    globalSuppliers = [normalizeSupplier(supplier), ...globalSuppliers];
    notifySupplierListeners();
  }, []);

  const updateSupplier = useCallback((updated: Supplier) => {
    const normalized = normalizeSupplier(updated);
    const existingIndex = globalSuppliers.findIndex((s) => s.id === normalized.id);
    if (existingIndex === -1) {
      globalSuppliers = [normalized, ...globalSuppliers];
    } else {
      globalSuppliers = globalSuppliers.map((s) => (s.id === normalized.id ? normalized : s));
    }
    notifySupplierListeners();
  }, []);

  const deleteSupplier = useCallback(async (id: string) => {
    const normalizedId = normalizeSupplierId(id);
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
