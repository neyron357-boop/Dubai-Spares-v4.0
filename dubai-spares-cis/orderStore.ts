import { useCallback, useEffect, useState } from 'react';
import { Order, OrderStatus, Part, PriceVariant } from './types';
import { supabase, isCloudSyncConfigured } from './supabaseClient';

const ORDERS_KEY = 'dubai_spares_orders';

type OrderState = {
  orders: Order[];
  isLoading: boolean;
  isHydrated: boolean;
  error: string | null;
};

const listeners = new Set<() => void>();

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

const safeLocalOrders = (): Order[] => {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw).map(normalizeOrder);
  } catch {
    return [];
  }
};

let state: OrderState = {
  orders: safeLocalOrders(),
  isLoading: false,
  isHydrated: false,
  error: null
};

const notify = () => {
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(state.orders));
  } catch (e) {
    console.error('persist order local failed', e);
  }
  listeners.forEach((l) => l());
};

const setState = (patch: Partial<OrderState>) => {
  state = { ...state, ...patch };
  notify();
};

const mapDbOrder = (row: any): Order => {
  const parts: Part[] = (row.parts || []).map((part: any) => ({
    id: String(part.id),
    name: part.name,
    photos: part.photos || [],
    photoUrl: part.photo_url || part.photos?.[0],
    isFound: !!part.is_found,
    variants: (part.price_variants || []).map((v: any): PriceVariant => ({
      id: String(v.id),
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
  const optimistic = [normalizeOrder(order), ...state.orders];
  setState({ orders: optimistic });

  if (!isCloudSyncConfigured || !supabase) return;

  const { error } = await supabase.from('orders').upsert({
    id: order.id,
    brand: order.brand,
    model: order.model,
    year: order.year,
    vin: order.vin,
    status: getStatus(order),
    priority: order.priority,
    client_name: order.clientName,
    source: order.source,
    car_photo_url: order.carPhotoUrl,
    car_photos: order.carPhotos || [],
    markup_percent: order.markupPercent,
    exchange_rate: order.exchangeRate,
    created_at: new Date(order.createdAt).toISOString(),
    is_archived: order.isArchived,
    is_sold: order.isSold,
    sold_profit_usd: order.soldProfitUsd,
    is_vip: !!order.isVip,
    is_pinned: !!order.isPinned,
    is_lead: !!order.isLead,
    notes: order.notes || []
  });

  if (error) setState({ error: error.message });
};

export const updateOrderItem = async (order: Order) => {
  const prev = state.orders;
  const optimistic = prev.map((o) => (o.id === order.id ? normalizeOrder(order) : o));
  setState({ orders: optimistic });

  if (!isCloudSyncConfigured || !supabase) return;

  const { error } = await supabase.from('orders').update({
    brand: order.brand,
    model: order.model,
    year: order.year,
    vin: order.vin,
    status: getStatus(order),
    priority: order.priority,
    client_name: order.clientName,
    source: order.source,
    car_photo_url: order.carPhotoUrl,
    car_photos: order.carPhotos || [],
    markup_percent: order.markupPercent,
    exchange_rate: order.exchangeRate,
    is_archived: order.isArchived,
    is_sold: order.isSold,
    sold_profit_usd: order.soldProfitUsd,
    is_vip: !!order.isVip,
    is_pinned: !!order.isPinned,
    is_lead: !!order.isLead,
    notes: order.notes || []
  }).eq('id', order.id);

  if (error) {
    setState({ orders: prev, error: error.message });
  }
};

export const deleteOrderItem = async (id: string) => {
  const prev = state.orders;
  const optimistic = prev.filter((o) => o.id !== id);
  setState({ orders: optimistic });

  if (!isCloudSyncConfigured || !supabase) return;

  const { error } = await supabase.from('orders').delete().eq('id', id);
  if (error) {
    setState({ orders: prev, error: error.message });
  }
};

export const updatePriceVariantItem = async (partId: string, variant: PriceVariant) => {
  const prev = state.orders;
  const optimistic = prev.map((o) => ({
    ...o,
    parts: o.parts.map((p) => p.id !== partId ? p : {
      ...p,
      variants: p.variants.map((v) => v.id === variant.id ? variant : v)
    })
  }));
  setState({ orders: optimistic });

  if (!isCloudSyncConfigured || !supabase) return;

  const { error } = await supabase.from('price_variants').update({
    price_aed: variant.priceAed,
    shop_name: variant.shopName,
    phone: variant.phone,
    location: variant.location,
    photo_url: variant.photoUrl,
    photos: variant.photos || []
  }).eq('id', variant.id).eq('part_id', partId);

  if (error) {
    setState({ orders: prev, error: error.message });
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
  const updateVariantCb = useCallback(updatePriceVariantItem, []);

  return {
    ...state,
    fetchOrders: fetchOrdersCb,
    addOrder: addCb,
    updateOrder: updateCb,
    deleteOrder: deleteCb,
    updatePriceVariant: updateVariantCb
  };
};
