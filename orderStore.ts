import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { pushActivityNotification } from './notificationCenter';
import { normalizeOrder } from './orderNormalization';
import { offlineDb } from './storage/offlineDb';
import { optimizeLocalImage } from './storage/photos';
import { Order, Part, PriceVariant } from './types';

type OrderState = {
  orders: Order[];
  isLoading: boolean;
  isSyncing: boolean;
  isHydrated: boolean;
  error: string | null;
};
let state: OrderState = {
  orders: [],
  isLoading: true,
  isSyncing: false,
  isHydrated: false,
  error: null,
};
const listeners = new Set<() => void>();
const setState = (patch: Partial<OrderState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
export const subscribeOrderStore = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getOrderState = () => state;
let hydration: Promise<void> | null = null;
let writes: Promise<unknown> = Promise.resolve();
const serializeWrite = <T>(action: () => Promise<T>): Promise<T> => {
  const next = writes.then(action, action);
  writes = next.catch(() => undefined);
  return next;
};
export const fetchOrders = async () => {
  if (hydration) return hydration;
  hydration = (async () => {
    await writes;
    try {
      const orders = await offlineDb.getOrders();
      setState({
        orders: orders.map(normalizeOrder),
        isHydrated: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState({
        isHydrated: true,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Не удалось открыть локальные данные',
      });
    }
  })().finally(() => {
    hydration = null;
  });
  return hydration;
};
export const fetchOrderDetails = async (_orderId: string) => {
  if (!state.isHydrated) await fetchOrders();
};
const reportStorageFailure = (error: unknown) => {
  const message =
    error instanceof Error && error.name === 'QuotaExceededError'
      ? 'Память устройства заполнена. Экспортируйте резервную копию и освободите место.'
      : 'Не удалось сохранить данные на устройстве. Повторите действие.';
  setState({ error: message });
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, tone: 'error' } }));
  return false;
};
const saved = () => window.dispatchEvent(new CustomEvent('local-save-success'));

const compressOrderImagesForAddFlow = async (order: Order): Promise<Order> => {
  const compressList = async (images: string[], labelPrefix: string) =>
    Promise.all(
      (images || []).map((image, index) => {
        if (!image.startsWith('data:image')) return Promise.resolve(image);
        return optimizeLocalImage(image, `${labelPrefix}[${index}]`);
      }),
    );

  const carPhotos = await compressList(order.carPhotos || [], `order:${order.id}:car`);
  const parts = await Promise.all(
    (order.parts || []).map(async (part) => {
      const partPhotos = await compressList(part.photos || [], `order:${order.id}:part:${part.id}`);
      const variants = await Promise.all(
        (part.variants || []).map(async (variant) => {
          const variantPhotos = await compressList(
            variant.photos || [],
            `order:${order.id}:part:${part.id}:variant:${variant.id}`,
          );
          return { ...variant, photos: variantPhotos, photoUrl: variantPhotos[0] };
        }),
      );

      return { ...part, photos: partPhotos, photoUrl: partPhotos[0], variants };
    }),
  );

  return { ...order, carPhotos, carPhotoUrl: carPhotos[0], parts };
};
export const addOrderItem = (order: Order) =>
  serializeWrite(async () => {
    try {
      if (!state.isHydrated) {
        const orders = await offlineDb.getOrders();
        setState({ orders: orders.map(normalizeOrder), isHydrated: true, isLoading: false });
      }
      const nextOrder = normalizeOrder(
        await compressOrderImagesForAddFlow({
          ...order,
          id: order.id || crypto.randomUUID(),
          updatedAt: Date.now(),
        }),
      );
      await offlineDb.saveOrder(nextOrder);
      setState({
        orders: [nextOrder, ...state.orders.filter((item) => item.id !== nextOrder.id)],
        error: null,
      });
      saved();
      return true;
    } catch (error) {
      return reportStorageFailure(error);
    }
  });
export const updateOrderItem = (order: Order) =>
  serializeWrite(async () => {
    try {
      const previous = state.orders.find((item) => item.id === order.id);
      if (!previous) return false;
      if (order.searchDepositStatus !== 'paid') {
        const count = (item: Order) =>
          item.parts.reduce((sum, part) => sum + part.variants.length, 0) +
          (item.vendorContacts?.length || 0);
        if (count(order) > count(previous)) {
          setState({ error: 'Сначала отметьте оплату депозита поиска.' });
          return false;
        }
      }
      const normalized = normalizeOrder({ ...order, updatedAt: Date.now() });
      await offlineDb.saveOrder(normalized);
      setState({
        orders: state.orders.map((item) => (item.id === order.id ? normalized : item)),
        error: null,
      });
      saved();
      return true;
    } catch (error) {
      return reportStorageFailure(error);
    }
  });
export const deleteOrderItem = (orderId: string) =>
  serializeWrite(async () => {
    try {
      await offlineDb.deleteOrder(orderId);
      setState({ orders: state.orders.filter((item) => item.id !== orderId), error: null });
      saved();
      return true;
    } catch (error) {
      return reportStorageFailure(error);
    }
  });
export const deleteOrderItems = (orderIds: string[]) =>
  serializeWrite(async () => {
    const ids = new Set(orderIds);
    try {
      const deleted = state.orders.filter((order) => ids.has(order.id)).length;
      await offlineDb.deleteOrders([...ids]);
      setState({ orders: state.orders.filter((order) => !ids.has(order.id)), error: null });
      saved();
      return { deleted, failed: 0 };
    } catch (error) {
      reportStorageFailure(error);
      return { deleted: 0, failed: ids.size };
    }
  });
export const updatePartItem = async (orderId: string, part: Part) => {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return false;
  const exists = order.parts.some((item) => item.id === part.id);
  const success = await updateOrderItem({
    ...order,
    parts: exists
      ? order.parts.map((item) => (item.id === part.id ? part : item))
      : [...order.parts, part],
  });
  if (success)
    pushActivityNotification({
      title: exists ? 'Обновлена деталь' : 'Добавлена деталь',
      message: `${part.name} · ${order.brand} ${order.model}`,
      orderId,
      partId: part.id,
      entityType: 'part',
      entityId: part.id,
      route: `/order/${orderId}/part/${part.id}`,
    });
  return success;
};
export const removePartItem = async (orderId: string, partId: string) => {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return false;
  return updateOrderItem({ ...order, parts: order.parts.filter((part) => part.id !== partId) });
};
export const updatePriceVariantItem = async (partId: string, variant: PriceVariant) => {
  const order = state.orders.find((item) => item.parts.some((part) => part.id === partId));
  if (!order) return false;
  return updateOrderItem({
    ...order,
    parts: order.parts.map((part) => {
      if (part.id !== partId) return part;
      const variants = part.variants.some((item) => item.id === variant.id)
        ? part.variants.map((item) => (item.id === variant.id ? variant : item))
        : [variant, ...part.variants];
      return {
        ...part,
        isFound: true,
        status: 'found',
        bestOfferId: variant.isBest
          ? variant.id
          : part.bestOfferId === variant.id
            ? undefined
            : part.bestOfferId,
        variants: variants.map((item) => ({
          ...item,
          isBest: variant.isBest ? item.id === variant.id : item.isBest && item.id !== variant.id,
        })),
      };
    }),
  });
};
export const restoreOrdersExternal = (orders: Order[]) =>
  serializeWrite(async () => {
    const normalized = orders.map(normalizeOrder);
    await offlineDb.saveOrders(normalized);
    setState({ orders: normalized, isLoading: false, isHydrated: true, error: null });
    saved();
  });
export const useOrderStore = () => {
  const snapshot = useSyncExternalStore(subscribeOrderStore, getOrderState, getOrderState);
  useEffect(() => {
    if (!state.isHydrated) void fetchOrders();
  }, []);
  return {
    ...snapshot,
    fetchOrders: useCallback(fetchOrders, []),
    addOrder: useCallback(addOrderItem, []),
    updateOrder: useCallback(updateOrderItem, []),
    deleteOrder: useCallback(deleteOrderItem, []),
    bulkDeleteOrders: useCallback(deleteOrderItems, []),
    updatePart: useCallback(updatePartItem, []),
    removePart: useCallback(removePartItem, []),
    updatePriceVariant: useCallback(updatePriceVariantItem, []),
  };
};
