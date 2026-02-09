import { useCallback, useEffect, useState } from 'react';
import { DbOrderGraphRow, Order, OrderStatus, Part, PriceVariant } from './types';
import { supabase, isCloudSyncConfigured } from './supabaseClient';
import { ensurePublicImageUrls } from './storage/photos';

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

const validateOrderForSave = (order: Order) => {
  if (!order) throw new Error('Order payload is missing');
  if (!order.brand?.trim()) throw new Error('Brand is required');
  if (!order.model?.trim()) throw new Error('Model is required');
  if (!order.priority) throw new Error('Priority is required');
  if (!Array.isArray(order.parts)) throw new Error('Parts must be an array');
};

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
  parts: Array.isArray(order.parts) ? order.parts : []
});

let state: OrderState = {
  orders: [],
  isLoading: false,
  isSyncing: false,
  isHydrated: false,
  error: null
};

const notify = () => {
  listeners.forEach((l) => l());
};

const setState = (patch: Partial<OrderState>) => {
  state = { ...state, ...patch };
  notify();
};

const mapDbOrder = (row: DbOrderGraphRow): Order => {
  const parts: Part[] = (row.parts || []).map((part) => ({
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
      createdAt: Date.parse(v.created_at || '') || Date.now()
    }))
  }));

  return normalizeOrder({
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
    parts,
    markupPercent: Number(row.markup_percent || 0),
    exchangeRate: Number(row.exchange_rate || 0),
    createdAt: Date.parse(row.created_at || '') || Date.now(),
    isArchived: !!row.is_archived,
    isSold: !!row.is_sold,
    soldProfitUsd: row.sold_profit_usd ?? undefined,
    isVip: !!row.is_vip,
    isPinned: !!row.is_pinned,
    isLead: !!row.is_lead,
    notes: row.notes || [],
    status: row.status || 'active'
  });
};

const withUploadedPhotos = async (order: Order): Promise<Order> => {
  const orderId = ensureUuid(order.id);
  const carPhotos = await ensurePublicImageUrls(order.carPhotos || [], `orders/${orderId}/car`);

  const parts = await Promise.all(
    (order.parts || []).map(async (part) => {
      const partId = ensureUuid(part.id);
      const partPhotos = await ensurePublicImageUrls(part.photos || [], `orders/${orderId}/parts/${partId}`);
      const variants = await Promise.all(
        (part.variants || []).map(async (variant) => {
          const variantId = ensureUuid(variant.id);
          const variantPhotos = await ensurePublicImageUrls(
            variant.photos || [],
            `orders/${orderId}/parts/${partId}/variants/${variantId}`
          );

          return {
            ...variant,
            id: variantId,
            partId,
            photos: variantPhotos,
            photoUrl: variantPhotos[0]
          };
        })
      );

      return {
        ...part,
        id: partId,
        orderId,
        photos: partPhotos,
        photoUrl: partPhotos[0],
        variants
      };
    })
  );

  return {
    ...order,
    id: orderId,
    carPhotos,
    carPhotoUrl: carPhotos[0],
    parts
  };
};

const persistOrderGraph = async (order: Order) => {
  if (!supabase) return;

  validateOrderForSave(order);
  const uploadedOrder = await withUploadedPhotos(order);

  const { error: orderError } = await supabase.from('orders').upsert({
    id: uploadedOrder.id,
    brand: uploadedOrder.brand,
    model: uploadedOrder.model,
    year: uploadedOrder.year,
    vin: uploadedOrder.vin,
    status: getStatus(uploadedOrder),
    priority: uploadedOrder.priority,
    client_name: uploadedOrder.clientName,
    source: uploadedOrder.source,
    car_photo_url: uploadedOrder.carPhotoUrl,
    car_photos: uploadedOrder.carPhotos || [],
    markup_percent: uploadedOrder.markupPercent,
    exchange_rate: uploadedOrder.exchangeRate,
    created_at: new Date(uploadedOrder.createdAt).toISOString(),
    is_archived: uploadedOrder.isArchived,
    is_sold: uploadedOrder.isSold,
    sold_profit_usd: uploadedOrder.soldProfitUsd,
    is_vip: !!uploadedOrder.isVip,
    is_pinned: !!uploadedOrder.isPinned,
    is_lead: !!uploadedOrder.isLead,
    notes: uploadedOrder.notes || []
  });

  if (orderError) {
    throw orderError;
  }

  await supabase.from('parts').delete().eq('order_id', uploadedOrder.id);

  for (const part of uploadedOrder.parts || []) {
    const { error: partError } = await supabase.from('parts').upsert({
      id: part.id,
      order_id: uploadedOrder.id,
      name: part.name,
      photo_url: part.photoUrl,
      photos: part.photos || [],
      is_found: !!part.isFound
    });

    if (partError) throw partError;

    for (const variant of part.variants || []) {
      const { error: variantError } = await supabase.from('price_variants').upsert({
        id: variant.id,
        part_id: part.id,
        price_aed: variant.priceAed,
        shop_name: variant.shopName,
        phone: variant.phone,
        location: variant.location,
        photo_url: variant.photoUrl,
        photos: variant.photos || [],
        created_at: new Date(variant.createdAt).toISOString()
      });

      if (variantError) throw variantError;
    }
  }

  return uploadedOrder;
};

export const subscribeOrderStore = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getOrderState = () => state;

export const fetchOrders = async () => {
  setState({ isLoading: true, error: null });

  if (!isCloudSyncConfigured || !supabase) {
    setState({ isLoading: false, isHydrated: true });
    return;
  }

  const { data, error } = await supabase
    .from('orders')
    .select('*, parts(*, price_variants(*))')
    .order('created_at', { ascending: false });

  if (error) {
    setState({ isLoading: false, isHydrated: true, error: error.message });
    return;
  }

  setState({ orders: (data || []).map(mapDbOrder), isLoading: false, isHydrated: true });
};

export const addOrderItem = async (order: Order) => {
  const prev = state.orders;
  setState({ isSyncing: true, error: null });

  if (!isCloudSyncConfigured || !supabase) {
    setState({ orders: [normalizeOrder(order), ...prev], isSyncing: false, error: null });
    return true;
  }

  try {
    const savedOrder = await persistOrderGraph(order);
    setState({ orders: [normalizeOrder(savedOrder), ...prev], isSyncing: false, error: null });
    return true;
  } catch (error: any) {
    setState({ orders: prev, isSyncing: false, error: error.message || 'Failed to save order' });
    return false;
  }
};

export const updateOrderItem = async (order: Order) => {
  const prev = state.orders;
  setState({ isSyncing: true, error: null });

  if (!isCloudSyncConfigured || !supabase) {
    const next = prev.map((o) => (o.id === order.id ? normalizeOrder(order) : o));
    setState({ orders: next, isSyncing: false, error: null });
    return true;
  }

  try {
    const savedOrder = await persistOrderGraph(order);
    const reconciled = prev.map((o) => (o.id === order.id ? normalizeOrder(savedOrder) : o));
    setState({ orders: reconciled, isSyncing: false, error: null });
    return true;
  } catch (error: any) {
    setState({ orders: prev, isSyncing: false, error: error.message || 'Failed to update order' });
    return false;
  }
};

export const deleteOrderItem = async (orderId: string) => {
  const withoutOrder = state.orders.filter((o) => o.id !== orderId);

  if (!isCloudSyncConfigured || !supabase) {
    setState({ orders: withoutOrder, error: null });
    return true;
  }

  setState({ orders: withoutOrder, error: null, isLoading: true, isSyncing: true });

  if (!isUuid(orderId)) {
    setState({ isLoading: false, isSyncing: false, error: 'Invalid order id for delete' });
    return false;
  }

  const { error } = await supabase.from('orders').delete().eq('id', orderId);

  if (error) {
    setState({ isLoading: false, isSyncing: false, error: error.message || 'Failed to delete order' });
    return false;
  }

  setState({ isLoading: false, isSyncing: false, error: null });
  return true;
};

export const updatePartItem = async (orderId: string, part: Part) => {
  const prev = state.orders;
  const optimistic = prev.map((order) => {
    if (order.id !== orderId) return order;

    const exists = order.parts.some((p) => p.id === part.id);
    const parts = exists ? order.parts.map((p) => (p.id === part.id ? part : p)) : [...order.parts, part];
    return { ...order, parts };
  });

  setState({ orders: optimistic, error: null });

  if (!isCloudSyncConfigured || !supabase) return;

  try {
    const photos = await ensurePublicImageUrls(part.photos || [], `orders/${orderId}/parts/${part.id}`);
    const payload = {
      id: part.id,
      order_id: orderId,
      name: part.name,
      photo_url: photos[0],
      photos,
      is_found: !!part.isFound
    };

    const { error } = await supabase.from('parts').upsert(payload);
    if (error) throw error;
  } catch (error: any) {
    setState({ orders: prev, error: error.message || 'Failed to update part' });
  }
};

export const updatePriceVariantItem = async (partId: string, variant: PriceVariant) => {
  const prev = state.orders;
  const optimistic = prev.map((o) => ({
    ...o,
    parts: o.parts.map((p) => {
      if (p.id !== partId) return p;
      const exists = p.variants.some((v) => v.id === variant.id);
      const variants = exists ? p.variants.map((v) => (v.id === variant.id ? variant : v)) : [...p.variants, variant];
      return { ...p, variants };
    })
  }));
  setState({ orders: optimistic, error: null });

  if (!isCloudSyncConfigured || !supabase) return;

  try {
    const photos = await ensurePublicImageUrls(variant.photos || [], `parts/${partId}/variants/${variant.id}`);
    const { error } = await supabase.from('price_variants').upsert({
      id: variant.id,
      part_id: partId,
      price_aed: variant.priceAed,
      shop_name: variant.shopName,
      phone: variant.phone,
      location: variant.location,
      photo_url: photos[0],
      photos,
      created_at: new Date(variant.createdAt).toISOString()
    });

    if (error) throw error;
  } catch (error: any) {
    setState({ orders: prev, error: error.message || 'Failed to update price variant' });
  }
};

export const restoreOrdersExternal = (orders: Order[]) => {
  setState({ orders: orders.map(normalizeOrder), isHydrated: true });
};

export const useOrderStore = () => {
  const [, setVersion] = useState(0);

  useEffect(() => subscribeOrderStore(() => setVersion((v) => v + 1)), []);

  const fetchOrdersCb = useCallback(fetchOrders, []);
  const addCb = useCallback(addOrderItem, []);
  const updateCb = useCallback(updateOrderItem, []);
  const deleteCb = useCallback(deleteOrderItem, []);
  const updatePartCb = useCallback(updatePartItem, []);
  const updateVariantCb = useCallback(updatePriceVariantItem, []);

  return {
    ...state,
    fetchOrders: fetchOrdersCb,
    addOrder: addCb,
    updateOrder: updateCb,
    deleteOrder: deleteCb,
    updatePart: updatePartCb,
    updatePriceVariant: updateVariantCb
  };
};
