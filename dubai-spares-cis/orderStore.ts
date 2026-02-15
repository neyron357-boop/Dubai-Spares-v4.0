import { useCallback, useEffect, useState } from 'react';
import { Order, OrderStatus, Part, PriceVariant, SalesStatus } from './types';
import { offlineDb } from './storage/offlineDb';

type OrderState = {
  orders: Order[];
  isLoading: boolean;
  isSyncing: boolean;
  isHydrated: boolean;
  error: string | null;
};

const listeners = new Set<() => void>();

const createUuid = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const getStatus = (order: Pick<Order, 'isSold' | 'isArchived' | 'isVip' | 'isLead'>): OrderStatus => {
  if (order.isSold) return 'sold';
  if (order.isArchived) return 'archive';
  if (order.isVip) return 'vip';
  if (order.isLead) return 'lead';
  return 'active';
};

const SALES_STATUS_ALIASES: Record<string, SalesStatus> = {
  inquiry: 'Inquiry',
  price_sent: 'Price Sent',
  pending_approval: 'Pending Approval',
  paid: 'Paid',
  completed: 'Completed'
};

const normalizeSalesStatus = (value: unknown): SalesStatus => {
  const raw = typeof value === 'string' ? value.trim() : '';
  const normalizedKey = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return SALES_STATUS_ALIASES[normalizedKey] || 'Inquiry';
};

const normalizeOrder = (order: Order): Order => {
  const salesStatus = normalizeSalesStatus(order.salesStatus);
  const isCompleted = salesStatus === 'Completed';
  const isSold = order.isSold || isCompleted;

  return {
    ...order,
    id: order.id || createUuid(),
    status: order.status ?? getStatus(order),
    salesStatus,
    isSold,
    isArchived: order.isArchived || isCompleted,
    isVip: !!order.isVip,
    isPinned: !!order.isPinned,
    isLead: !!order.isLead,
    notes: Array.isArray(order.notes) ? order.notes : [],
    vinPhotoUrl: order.vinPhotoUrl || '',
    bodyType: order.bodyType || '',
    parts: Array.isArray(order.parts) ? order.parts : [],
    updatedAt: order.updatedAt ?? order.createdAt ?? Date.now(),
    recommendedShopIds: Array.isArray(order.recommendedShopIds) ? order.recommendedShopIds : [],
    dismissedShopIds: Array.isArray(order.dismissedShopIds) ? order.dismissedShopIds : [],
    leadUnread: order.leadUnread === true,
    leadSource: order.leadSource === 'public_form' ? 'public_form' : 'manual',
    leadReadAt: Number.isFinite(Number(order.leadReadAt)) ? Number(order.leadReadAt) : undefined,
    pricingEvents: Array.isArray(order.pricingEvents) ? order.pricingEvents : []
  };
};

let state: OrderState = {
  orders: [],
  isLoading: false,
  isSyncing: false,
  isHydrated: false,
  error: null
};

const notify = () => listeners.forEach((l) => l());
const setState = (patch: Partial<OrderState>) => {
  state = { ...state, ...patch };
  notify();
};

export const subscribeOrderStore = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getOrderState = () => state;

export const fetchOrders = async () => {
  setState({ isLoading: true, error: null });
  try {
    const orders = (await offlineDb.getOrders()).map(normalizeOrder);
    setState({ orders, isHydrated: true, isLoading: false });
  } catch (error) {
    setState({ isLoading: false, error: error instanceof Error ? error.message : 'Failed to load orders' });
  }
};

export const fetchOrderDetails = async (_orderId: string) => {
  await fetchOrders();
};

export const addOrderItem = async (order: Order) => {
  const nextOrder = normalizeOrder({ ...order, id: order.id || createUuid() });
  const next = [nextOrder, ...state.orders.filter((o) => o.id !== nextOrder.id)];
  setState({ orders: next, error: null });
  await offlineDb.saveOrder(nextOrder);
  return true;
};

export const updateOrderItem = async (order: Order) => {
  const normalized = normalizeOrder({ ...order, updatedAt: Date.now() });
  const next = state.orders.map((o) => (o.id === normalized.id ? normalized : o));
  setState({ orders: next, error: null });
  await offlineDb.saveOrder(normalized);
  return true;
};

export const deleteOrderItem = async (orderId: string) => {
  const next = state.orders.filter((o) => o.id !== orderId);
  setState({ orders: next, error: null });
  await offlineDb.deleteOrder(orderId);
  return true;
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
  setState({ orders: normalized, isHydrated: true, error: null });
  void offlineDb.saveOrders(normalized);
};

export const useOrderStore = () => {
  const [, setVersion] = useState(0);

  useEffect(() => subscribeOrderStore(() => setVersion((v) => v + 1)), []);
  const fetchOrdersCb = useCallback(fetchOrders, []);

  return {
    ...state,
    fetchOrders: fetchOrdersCb,
    addOrder: useCallback(addOrderItem, []),
    updateOrder: useCallback(updateOrderItem, []),
    deleteOrder: useCallback(deleteOrderItem, []),
    updatePart: useCallback(updatePartItem, []),
    updatePriceVariant: useCallback(updatePriceVariantItem, [])
  };
};
