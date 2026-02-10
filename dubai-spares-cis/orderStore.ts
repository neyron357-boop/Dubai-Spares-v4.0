import { useCallback, useEffect, useState } from 'react';
import { DbOrderGraphRow, Order, OrderStatus, Part, PriceVariant } from './types';
import { supabase, isCloudSyncConfigured } from './supabase';
import { deleteOrderFolderFromStorage, ensurePublicImageUrls, optimizeImageForUpload } from './storage/photos';
import { offlineDb } from './storage/offlineDb';
import { logger } from './logging';
import { logDatabaseIntegrity } from './dbIntegrity';

type OrderState = {
  orders: Order[];
  isLoading: boolean;
  isSyncing: boolean;
  isHydrated: boolean;
  error: string | null;
};

const listeners = new Set<() => void>();

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const createUuid = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const ensureUuid = (value?: string) => (value && isUuid(value) ? value : createUuid());

const getStatus = (order: Pick<Order, 'isSold' | 'isArchived' | 'isVip' | 'isLead'>): OrderStatus => {
  if (order.isSold) return 'sold';
  if (order.isArchived) return 'archive';
  if (order.isVip) return 'vip';
  if (order.isLead) return 'lead';
  return 'active';
};

const normalizeOrder = (order: Order): Order => ({
  ...order,
  status: order.status ?? getStatus(order),
  isVip: !!order.isVip,
  isPinned: !!order.isPinned,
  isLead: !!order.isLead,
  notes: Array.isArray(order.notes) ? order.notes : [],
  parts: Array.isArray(order.parts) ? order.parts : [],
  salesStatus: order.salesStatus ?? 'Inquiry',
  updatedAt: order.updatedAt ?? order.createdAt ?? Date.now(),
  recommendedShopIds: Array.isArray(order.recommendedShopIds) ? order.recommendedShopIds : []
});


const parseTimestamp = (value: string | number | null | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate)) return asDate;
  }
  return Date.now();
};

const toIsoTimestamp = (value: string | number | null | undefined): string => {
  const timestamp = parseTimestamp(value);
  return new Date(timestamp).toISOString();
};


let state: OrderState = {
  orders: [],
  isLoading: false,
  isSyncing: false,
  isHydrated: false,
  error: null
};

let syncInProgress = false;

const notify = () => listeners.forEach((l) => l());

const setState = (patch: Partial<OrderState>) => {
  state = { ...state, ...patch };
  notify();
};


const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === 'object' && error) {
    return error;
  }
  return { value: String(error) };
};

const isMissingColumnError = (error: unknown, column: string) => {
  if (typeof error !== 'object' || !error) return false;
  const anyErr = error as { code?: unknown; message?: unknown };
  return (
    anyErr.code === 'PGRST204' &&
    typeof anyErr.message === 'string' &&
    anyErr.message.includes(`'${column}'`) &&
    anyErr.message.includes('Could not find')
  );
};

const isBigintTimestampInputError = (error: unknown) => {
  if (typeof error !== 'object' || !error) return false;
  const anyErr = error as { code?: unknown; message?: unknown };
  return (
    anyErr.code === '22P02' &&
    typeof anyErr.message === 'string' &&
    anyErr.message.includes('invalid input syntax for type bigint')
  );
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error) {
    const anyErr = error as { message?: unknown; code?: unknown; status?: unknown };
    const baseMessage = typeof anyErr.message === 'string' && anyErr.message ? anyErr.message : fallback;
    const code = typeof anyErr.code === 'string' ? anyErr.code : null;
    const status = typeof anyErr.status === 'number' || typeof anyErr.status === 'string' ? String(anyErr.status) : null;

    if (code || status) {
      return `${baseMessage}${status ? ` (status: ${status})` : ''}${code ? ` [code: ${code}]` : ''}`;
    }

    return baseMessage;
  }
  return fallback;
};

const broadcastSyncError = (error: unknown, fallback: string) => {
  const message = getErrorMessage(error, fallback);
  void logger.error('sync:error', message, { fallback, error: serializeError(error) });
  void logDatabaseIntegrity('sync:error', error, { fallback });
  setState({ error: message });
  window.dispatchEvent(new CustomEvent('cloud-sync-error', { detail: { message } }));
};

const deleteRemoteOrderWithStorageCleanup = async (orderId: string) => {
  if (!supabase || !isUuid(orderId)) return;

  const { error } = await supabase.from('orders').delete().eq('id', orderId);
  if (error) throw error;

  try {
    await deleteOrderFolderFromStorage(orderId);
  } catch (storageError) {
    await logger.warn('storage:cleanup', `Storage cleanup warning for order ${orderId}`, {
      error: serializeError(storageError)
    });
  }
};

const mapDbOrder = (row: DbOrderGraphRow): Order => ({
  ...normalizeOrder({
    id: String(row.id),
    brand: row.brand,
    model: row.model,
    year: row.year || '',
    vin: row.vin || '',
    priority: row.priority,
    clientName: row.client_name || '',
    source: row.source || 'Другое',
    carPhotos: row.car_photos || [],
    carPhotoUrl: row.car_photo_url || row.car_photos?.[0],
    parts: (row.parts || []).map((part) => ({
      id: String(part.id),
      orderId: String(part.order_id),
      name: part.name,
      photos: part.photos || [],
      photoUrl: part.photo_url || part.photos?.[0],
      isFound: !!part.is_found,
      variants: (part.price_variants || []).map((v): PriceVariant => ({
        id: String(v.id),
        partId: String(v.part_id),
        priceAed: Number(v.price_aed || 0),
        shopName: v.shop_name || '',
        phone: v.phone || '',
        location: v.location || '',
        photos: v.photos || [],
        photoUrl: v.photo_url || v.photos?.[0],
        createdAt: parseTimestamp(v.created_at)
      }))
    })),
    markupPercent: Number(row.markup_percent || 0),
    exchangeRate: Number(row.exchange_rate || 0),
    createdAt: parseTimestamp(row.created_at),
    isArchived: !!row.is_archived,
    isSold: !!row.is_sold,
    soldProfitUsd: row.sold_profit_usd ?? undefined,
    isVip: !!row.is_vip,
    isPinned: !!row.is_pinned,
    isLead: !!row.is_lead,
    notes: row.notes || [],
    status: row.status || 'active',
    salesStatus: row.sales_status || 'Inquiry',
    customerContact: row.customer_contact || '',
    updatedAt: parseTimestamp(row.updated_at ?? row.created_at),
    recommendedShopIds: Array.isArray(row.recommended_shop_ids) ? row.recommended_shop_ids : []
  })
});

const withUploadedPhotos = async (order: Order): Promise<Order> => {
  const orderId = ensureUuid(order.id);
  const skipUpload = !!order.localOnlyPhotos;
  const carPhotos = await ensurePublicImageUrls(order.carPhotos || [], `orders/${orderId}/car`, { skipUpload });

  const parts: Part[] = await Promise.all(
    (order.parts || []).map(async (part) => {
      const partId = ensureUuid(part.id);
      const partPhotos = await ensurePublicImageUrls(part.photos || [], `orders/${orderId}/parts/${partId}`, { skipUpload });

      const variants = await Promise.all(
        (part.variants || []).map(async (variant) => {
          const variantId = ensureUuid(variant.id);
          const variantPhotos = await ensurePublicImageUrls(
            variant.photos || [],
            `orders/${orderId}/parts/${partId}/variants/${variantId}`,
            { skipUpload }
          );

          return { ...variant, id: variantId, partId, photos: variantPhotos, photoUrl: variantPhotos[0] };
        })
      );

      return { ...part, id: partId, orderId, photos: partPhotos, photoUrl: partPhotos[0], variants };
    })
  );

  return { ...order, id: orderId, carPhotos, carPhotoUrl: carPhotos[0], parts };
};

const persistOrderGraph = async (order: Order) => {
  if (!supabase) return normalizeOrder(order);
  const uploadedOrder = await withUploadedPhotos(order);
  const cloudOrder = uploadedOrder.localOnlyPhotos
    ? {
        ...uploadedOrder,
        carPhotoUrl: undefined,
        carPhotos: [],
        parts: (uploadedOrder.parts || []).map((part) => ({
          ...part,
          photoUrl: undefined,
          photos: [],
          variants: (part.variants || []).map((variant) => ({ ...variant, photoUrl: undefined, photos: [] }))
        }))
      }
    : uploadedOrder;

  await logger.info('sync:persist', `Step 1/3 upsert order ${uploadedOrder.id}`);

  const buildOrderPayload = () => ({
    id: uploadedOrder.id,
    brand: uploadedOrder.brand,
    model: uploadedOrder.model,
    year: uploadedOrder.year,
    vin: uploadedOrder.vin,
    status: getStatus(uploadedOrder),
    priority: uploadedOrder.priority,
    client_name: uploadedOrder.clientName,
    source: uploadedOrder.source,
    car_photo_url: cloudOrder.carPhotoUrl,
    car_photos: cloudOrder.carPhotos || [],
    markup_percent: uploadedOrder.markupPercent,
    exchange_rate: uploadedOrder.exchangeRate,
    created_at: toIsoTimestamp(uploadedOrder.createdAt),
    is_archived: uploadedOrder.isArchived,
    is_sold: uploadedOrder.isSold,
    sold_profit_usd: uploadedOrder.soldProfitUsd,
    is_vip: !!uploadedOrder.isVip,
    is_pinned: !!uploadedOrder.isPinned,
    is_lead: !!uploadedOrder.isLead,
    notes: uploadedOrder.notes || [],
    customer_contact: uploadedOrder.customerContact || '',
    recommended_shop_ids: uploadedOrder.recommendedShopIds || []
  });

  const upsertOrderWithSchemaFallbacks = async () => {
    const fallbackOrderPayload = {
      ...buildOrderPayload(),
      sales_status: uploadedOrder.salesStatus || 'Inquiry',
      updated_at: toIsoTimestamp(uploadedOrder.updatedAt || Date.now())
    };

    let { error: orderError } = await supabase.from('orders').upsert(fallbackOrderPayload);

    if (orderError && isMissingColumnError(orderError, 'sales_status')) {
      await logger.warn('sync:persist', 'orders.sales_status is missing in remote schema; retrying upsert without that column');
      await logDatabaseIntegrity('sync:persist', orderError, { column: 'sales_status' });
      const { sales_status: _salesStatus, ...payloadWithoutSalesStatus } = fallbackOrderPayload;
      ({ error: orderError } = await supabase.from('orders').upsert(payloadWithoutSalesStatus));
    }

    if (orderError && isMissingColumnError(orderError, 'customer_contact')) {
      await logger.warn('sync:persist', 'orders.customer_contact is missing in remote schema; retrying upsert without that column');
      await logDatabaseIntegrity('sync:persist', orderError, { column: 'customer_contact' });
      const { customer_contact: _customerContact, ...payloadWithoutCustomerContact } = fallbackOrderPayload;
      ({ error: orderError } = await supabase.from('orders').upsert(payloadWithoutCustomerContact));
    }

    if (orderError && isMissingColumnError(orderError, 'recommended_shop_ids')) {
      await logger.warn('sync:persist', 'orders.recommended_shop_ids is missing in remote schema; retrying upsert without that column');
      await logDatabaseIntegrity('sync:persist', orderError, { column: 'recommended_shop_ids' });
      const { recommended_shop_ids: _recommendedShopIds, ...payloadWithoutRecommendedShopIds } = fallbackOrderPayload;
      ({ error: orderError } = await supabase.from('orders').upsert(payloadWithoutRecommendedShopIds));
    }

    return orderError;
  };

  const orderError = await upsertOrderWithSchemaFallbacks();

  if (orderError) {
    await logger.error('sync:persist', `Step 1/3 failed for order ${uploadedOrder.id}`, { error: serializeError(orderError) });
    throw orderError;
  }

  await logger.info('sync:persist', `Step 1/3 success for order ${uploadedOrder.id}`);

  const { error: deletePartsError } = await supabase.from('parts').delete().eq('order_id', uploadedOrder.id);
  if (deletePartsError) {
    await logger.error('sync:persist', `Cleanup parts failed for order ${uploadedOrder.id}`, { error: serializeError(deletePartsError) });
    throw deletePartsError;
  }

  for (const part of cloudOrder.parts || []) {
    await logger.info('sync:persist', `Step 2/3 upsert part ${part.id} (order ${uploadedOrder.id})`);
    const { error: partError } = await supabase.from('parts').upsert({
      id: part.id,
      order_id: uploadedOrder.id,
      name: part.name,
      photo_url: part.photoUrl,
      photos: part.photos || [],
      is_found: !!part.isFound
    });
    if (partError) {
      await logger.error('sync:persist', `Step 2/3 failed for part ${part.id}`, { error: serializeError(partError) });
      throw partError;
    }

    await logger.info('sync:persist', `Step 2/3 success for part ${part.id}`);

    for (const variant of part.variants || []) {
      await logger.info('sync:persist', `Step 3/3 upsert variant ${variant.id} (part ${part.id})`);
      const variantPayload = {
        id: variant.id,
        part_id: part.id,
        price_aed: variant.priceAed,
        shop_name: variant.shopName,
        phone: variant.phone,
        location: variant.location,
        photo_url: variant.photoUrl,
        photos: variant.photos || [],
        created_at: toIsoTimestamp(variant.createdAt)
      };

      let { error: variantError } = await supabase.from('price_variants').upsert(variantPayload);

      if (variantError && isBigintTimestampInputError(variantError)) {
        await logger.warn(
          'sync:persist',
          'price_variants.created_at expects bigint in remote schema; retrying upsert with epoch milliseconds'
        );
        ({ error: variantError } = await supabase.from('price_variants').upsert({
          ...variantPayload,
          created_at: parseTimestamp(variant.createdAt)
        }));
      }

      if (variantError) {
        await logger.error('sync:persist', `Step 3/3 failed for variant ${variant.id}`, { error: serializeError(variantError) });
        throw variantError;
      }

      await logger.info('sync:persist', `Step 3/3 success for variant ${variant.id}`);
    }
  }

  await logger.info('sync:persist', `Order graph persisted ${uploadedOrder.id}`);
  return normalizeOrder(uploadedOrder);
};

const queueMutation = async (type: 'upsert' | 'delete', order: Order | undefined, orderId: string) => {
  await logger.warn('sync:queue', `Queueing ${type} for order ${orderId}`);
  await offlineDb.enqueueMutation({
    id: createUuid(),
    type,
    orderId,
    payload: order,
    createdAt: Date.now()
  });

  const queueCount = await offlineDb.getMutationCount();
  await logger.info('sync:queue', `Queue size is now ${queueCount}`);

  if (navigator.onLine) {
    void flushOfflineMutations();
  }

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      if ('sync' in registration) {
        await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register('orders-background-sync');
      }
    } catch (error) {
      await logger.warn('sync:queue', 'Background sync registration failed', { error: serializeError(error) });
    }
  }
};

const flushOfflineMutations = async () => {
  if (syncInProgress || !navigator.onLine || !isCloudSyncConfigured || !supabase) return;
  syncInProgress = true;
  setState({ isSyncing: true });

  try {
    const pending = await offlineDb.getMutations();
    await logger.info('sync:flush', `Flush started with ${pending.length} pending mutations`);
    for (const mutation of pending) {
      await logger.info('sync:flush', `Processing mutation ${mutation.id}`, { type: mutation.type, orderId: mutation.orderId });
      if (mutation.type === 'delete') {
        await logger.info('sync:flush', `Delete order ${mutation.orderId}`);
        if (isUuid(mutation.orderId)) {
          try {
            await deleteRemoteOrderWithStorageCleanup(mutation.orderId);
          } catch (error) {
            await logger.error('sync:flush', `Delete failed for order ${mutation.orderId}`, { error: serializeError(error) });
            throw error;
          }
        }
      } else if (mutation.payload) {
        const saved = await persistOrderGraph(mutation.payload);
        await offlineDb.saveOrder(saved);
      }

      await logger.info('sync:flush', `Mutation ${mutation.id} synced`);

      if (import.meta.env.DEV) {
        console.log(`☁️ Synced offline mutation ${mutation.id} for order ${mutation.orderId} to Supabase`);
      }

      await offlineDb.removeMutation(mutation.id);
      const queueCount = await offlineDb.getMutationCount();
      await logger.info('sync:flush', `Mutation ${mutation.id} removed from queue`, { queueCount });
    }

    await logger.info('sync:flush', 'Flush completed');
  } catch (error: unknown) {
    broadcastSyncError(error, 'Offline sync failed');
  } finally {
    syncInProgress = false;
    setState({ isSyncing: false });
  }
};

export const subscribeOrderStore = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getOrderState = () => state;

export const fetchOrders = async () => {
  setState({ isLoading: true, error: null });
  await logger.info('sync:fetch', 'Starting order hydration');

  const localOrders = await offlineDb.getOrders();
  await logger.info('sync:fetch', `Loaded ${localOrders.length} local orders`);
  setState({ orders: localOrders.map(normalizeOrder), isHydrated: true });

  if (!navigator.onLine || !isCloudSyncConfigured || !supabase) {
    await logger.warn('sync:fetch', 'Skipping cloud fetch (offline or missing supabase config)');
    setState({ isLoading: false, isHydrated: true });
    return;
  }

  const { data, error } = await supabase
    .from('orders')
    .select('*, parts(*, price_variants(*))')
    .order('created_at', { ascending: false });

  if (error) {
    await logger.error('sync:fetch', 'Cloud orders fetch failed', { error: serializeError(error) });
    broadcastSyncError(error, error.message || 'Failed to load orders from Supabase');
    setState({ isLoading: false, isHydrated: true });
    return;
  }

  const orders = (data || []).map(mapDbOrder);
  await logger.info('sync:fetch', `Loaded ${orders.length} cloud orders`);
  const pendingMutations = await offlineDb.getMutations();
  await logger.info('sync:fetch', `Queue currently has ${pendingMutations.length} mutations`);

  if (orders.length === 0 && localOrders.length > 0 && pendingMutations.length > 0) {
    setState({ orders: localOrders.map(normalizeOrder), isLoading: false, isHydrated: true, error: null });
    void flushOfflineMutations();
    return;
  }

  await offlineDb.saveOrders(orders);
  setState({ orders, isLoading: false, isHydrated: true, error: null });

  if (pendingMutations.length > 0) {
    void flushOfflineMutations();
  }
};


const compressOrderImagesForAddFlow = async (order: Order): Promise<Order> => {
  const compressList = async (images: string[], labelPrefix: string) =>
    Promise.all(
      (images || []).map((image, index) => {
        if (!image.startsWith('data:image')) return Promise.resolve(image);
        return optimizeImageForUpload(image, `${labelPrefix}[${index}]`);
      })
    );

  const carPhotos = await compressList(order.carPhotos || [], `order:${order.id}:car`);
  const parts = await Promise.all(
    (order.parts || []).map(async (part) => {
      const partPhotos = await compressList(part.photos || [], `order:${order.id}:part:${part.id}`);
      const variants = await Promise.all(
        (part.variants || []).map(async (variant) => {
          const variantPhotos = await compressList(
            variant.photos || [],
            `order:${order.id}:part:${part.id}:variant:${variant.id}`
          );
          return { ...variant, photos: variantPhotos, photoUrl: variantPhotos[0] };
        })
      );

      return { ...part, photos: partPhotos, photoUrl: partPhotos[0], variants };
    })
  );

  return { ...order, carPhotos, carPhotoUrl: carPhotos[0], parts };
};

export const addOrderItem = async (order: Order) => {
  const compressedOrder = await compressOrderImagesForAddFlow(order);
  const localOrder = normalizeOrder({ ...compressedOrder, id: ensureUuid(compressedOrder.id) });
  const next = [localOrder, ...state.orders.filter((o) => o.id !== localOrder.id)];
  setState({ orders: next, error: null });
  await offlineDb.saveOrder(localOrder);
  window.dispatchEvent(new CustomEvent('cloud-save-success'));

  const directWriteMode = import.meta.env.VITE_DIRECT_SUPABASE_WRITE === 'true';

  if (!navigator.onLine || !isCloudSyncConfigured || !supabase) {
    await queueMutation('upsert', localOrder, localOrder.id);
    return true;
  }

  try {
    const saved = await persistOrderGraph(localOrder);
    const merged = [saved, ...state.orders.filter((o) => o.id !== localOrder.id && o.id !== saved.id)];
    setState({ orders: merged, error: null });
    await offlineDb.saveOrders(merged);
    return true;
  } catch (error: unknown) {
    if (directWriteMode) {
      broadcastSyncError(error, 'Direct Supabase write failed');
      return false;
    }

    broadcastSyncError(error, 'Supabase write failed, queued for retry');
    await queueMutation('upsert', localOrder, localOrder.id);
    return true;
  }
};

export const updateOrderItem = async (order: Order) => {
  const normalized = normalizeOrder({ ...order, updatedAt: Date.now() });
  const next = state.orders.map((o) => (o.id === normalized.id ? normalized : o));
  setState({ orders: next, error: null });
  await offlineDb.saveOrder(normalized);
  window.dispatchEvent(new CustomEvent('cloud-save-success'));

  if (!navigator.onLine || !isCloudSyncConfigured || !supabase) {
    await queueMutation('upsert', normalized, normalized.id);
    return true;
  }

  try {
    await persistOrderGraph(normalized);
    return true;
  } catch (error: unknown) {
    broadcastSyncError(error, 'Supabase update failed, queued for retry');
    await queueMutation('upsert', normalized, normalized.id);
    return true;
  }
};

export const deleteOrderItem = async (orderId: string) => {
  const next = state.orders.filter((o) => o.id !== orderId);
  setState({ orders: next, error: null });
  await offlineDb.deleteOrder(orderId);
  window.dispatchEvent(new CustomEvent('cloud-save-success'));

  if (!navigator.onLine || !isCloudSyncConfigured || !supabase) {
    await queueMutation('delete', undefined, orderId);
    return true;
  }

  try {
    await deleteRemoteOrderWithStorageCleanup(orderId);
    return true;
  } catch (error: unknown) {
    broadcastSyncError(error, 'Supabase delete failed, queued for retry');
    await queueMutation('delete', undefined, orderId);
    return true;
  }
};

export const updatePartItem = async (orderId: string, part: Part) => {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;

  const exists = order.parts.some((p) => p.id === part.id);
  const parts = exists ? order.parts.map((p) => (p.id === part.id ? part : p)) : [...order.parts, part];
  await updateOrderItem({ ...order, parts });
};

export const updatePriceVariantItem = async (partId: string, variant: PriceVariant) => {
  const order = state.orders.find((o) => o.parts.some((p) => p.id === partId));
  if (!order) return;

  const parts = order.parts.map((p) => {
    if (p.id !== partId) return p;
    const exists = p.variants.some((v) => v.id === variant.id);
    const variants = exists ? p.variants.map((v) => (v.id === variant.id ? variant : v)) : [...p.variants, variant];
    return { ...p, variants };
  });

  await updateOrderItem({ ...order, parts });
};

export const restoreOrdersExternal = (orders: Order[]) => {
  const normalized = orders.map(normalizeOrder);
  setState({ orders: normalized, isHydrated: true });
  void offlineDb.saveOrders(normalized);
};

export const useOrderStore = () => {
  const [, setVersion] = useState(0);

  useEffect(() => subscribeOrderStore(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    const onOnline = () => {
      void flushOfflineMutations();
      void fetchOrders();
    };

    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'flush-offline-mutations') {
        void flushOfflineMutations();
      }
    };

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void fetchOrders();
      }, 350);
    };

    const ordersChannel = supabase
      ?.channel('orders-live-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'price_variants' }, scheduleRefresh)
      .subscribe();

    if (navigator.onLine) {
      void flushOfflineMutations();
    }

    window.addEventListener('online', onOnline);
    navigator.serviceWorker?.addEventListener?.('message', onSwMessage);
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      window.removeEventListener('online', onOnline);
      navigator.serviceWorker?.removeEventListener?.('message', onSwMessage);
      if (ordersChannel) {
        void supabase?.removeChannel(ordersChannel);
      }
    };
  }, []);

  const fetchOrdersCb = useCallback(fetchOrders, []);

  return {
    ...state,
    fetchOrders: fetchOrdersCb,
    addOrder: useCallback(addOrderItem, []),
    updateOrder: useCallback(updateOrderItem, []),
    deleteOrder: useCallback(deleteOrderItem, []),
    updatePart: useCallback(updatePartItem, []),
    updatePriceVariant: useCallback(updatePriceVariantItem, []),
    flushOfflineMutations: useCallback(flushOfflineMutations, [])
  };
};
