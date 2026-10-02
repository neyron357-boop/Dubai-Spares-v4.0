import type { Order } from '../types';
import { isLeadOrder } from './orderClassification';

export type OrderCardBucket = 'active' | 'interest' | 'not_found' | 'archive';
export type OrderCardTone = 'blue' | 'neutral' | 'green' | 'amber';

export type OrderCardView = {
  title: string;
  vehicleLabel: string;
  clientLabel: string;
  ageLabel: string;
  statusLabel: string;
  tone: OrderCardTone;
  foundParts: number;
  totalParts: number;
  progress: number;
  paymentLabel: string | null;
  attention: string | null;
};

const isCompletedOrder = (order: Order) =>
  order.isSold || order.status === 'sold' || order.salesStatus === 'Completed';

export const isArchivedOrder = (order: Order) =>
  order.isArchived || order.status === 'archive' || isCompletedOrder(order);

export const getOrderBucket = (order: Order): OrderCardBucket => {
  if (isArchivedOrder(order)) return 'archive';
  if (order.status === 'not_found') return 'not_found';
  if (order.status === 'interest' || isLeadOrder(order)) return 'interest';
  return 'active';
};

const hasFullPrepayment = (order: Order) =>
  order.paymentStatus === 'full_prepayment_paid' || order.salesStatus === 'Paid';

const hasSearchDeposit = (order: Order) =>
  order.searchDepositStatus === 'paid' || order.paymentStatus === 'search_deposit_paid';

const formatOrderAge = (createdAt: number, now: number) => {
  if (!Number.isFinite(createdAt) || !Number.isFinite(now)) return '—';
  const hours = Math.floor(Math.max(0, now - createdAt) / 3_600_000);
  if (hours < 1) return 'Новый';
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} дн.`;
};

const getWorkflow = (
  order: Order,
  totalParts: number,
  foundParts: number,
): Pick<OrderCardView, 'statusLabel' | 'tone'> => {
  if (isCompletedOrder(order)) return { statusLabel: 'Завершён', tone: 'neutral' };
  if (isArchivedOrder(order)) return { statusLabel: 'В архиве', tone: 'neutral' };
  const bucket = getOrderBucket(order);
  if (bucket === 'interest') return { statusLabel: 'Интерес', tone: 'neutral' };
  if (bucket === 'not_found') return { statusLabel: 'Не найдено', tone: 'amber' };
  if (order.salesStatus === 'Pending Approval') return { statusLabel: 'Ждём ответ', tone: 'blue' };
  if (order.salesStatus === 'Price Sent') return { statusLabel: 'Цена отправлена', tone: 'blue' };
  if (
    (order.status === 'waiting_deposit' || order.searchDepositStatus === 'pending') &&
    !hasSearchDeposit(order) &&
    !hasFullPrepayment(order)
  )
    return { statusLabel: 'Ожидаем депозит', tone: 'amber' };
  if (totalParts > 0 && foundParts === totalParts)
    return { statusLabel: 'Детали подобраны', tone: 'green' };
  return { statusLabel: 'В поиске', tone: 'blue' };
};

export const getOrderCardView = (order: Order, now = Date.now()): OrderCardView => {
  const title = [order.brand?.trim(), order.model?.trim()].filter(Boolean).join(' ');
  const totalParts = order.parts.length;
  const foundParts = order.parts.filter(
    (part) => part.isFound || (part.variants || []).length > 0,
  ).length;
  const fullPrepayment = hasFullPrepayment(order);
  return {
    title: title || 'Автомобиль не указан',
    vehicleLabel: [title || 'Автомобиль не указан', order.year?.trim()].filter(Boolean).join(' '),
    clientLabel:
      order.clientName?.trim() ||
      order.customerContact?.trim() ||
      order.socialNickname?.trim() ||
      'Клиент не указан',
    ageLabel: formatOrderAge(order.createdAt, now),
    ...getWorkflow(order, totalParts, foundParts),
    foundParts,
    totalParts,
    progress: totalParts > 0 ? Math.round((foundParts / totalParts) * 100) : 0,
    paymentLabel: fullPrepayment
      ? 'Предоплата получена'
      : hasSearchDeposit(order)
        ? 'Депозит внесён'
        : null,
    attention:
      !isArchivedOrder(order) &&
      !fullPrepayment &&
      order.parts.some((part) => part.status === 'ordered')
        ? 'Закупка без полной предоплаты'
        : null,
  };
};

export const buildArchivedOrder = (order: Order, now = Date.now()): Order => ({
  ...order,
  isLead: isLeadOrder(order) ? true : order.isLead,
  isArchived: true,
  status: 'archive',
  statusChangedAt: now,
  statusChangedBy: 'current-user',
});

export const buildOrderBucketUpdate = (
  order: Order,
  bucket: OrderCardBucket,
  now = Date.now(),
): Order => {
  if (bucket === 'archive') return buildArchivedOrder(order, now);
  const keepLead = bucket === 'interest' && isLeadOrder(order);
  return {
    ...order,
    isArchived: false,
    isSold: false,
    status: bucket,
    salesStatus:
      order.salesStatus === 'Completed'
        ? order.paymentStatus === 'full_prepayment_paid'
          ? 'Paid'
          : 'Inquiry'
        : order.salesStatus,
    isLead: keepLead ? order.isLead : false,
    customerStatus: !keepLead && order.customerStatus === 'LEAD' ? 'INQUIRY' : order.customerStatus,
    leadUnread: keepLead ? order.leadUnread : false,
    leadReadAt: keepLead ? order.leadReadAt : now,
    statusChangedAt: now,
    statusChangedBy: 'current-user',
  };
};

export const buildRestoredOrder = (order: Order, now = Date.now()): Order =>
  buildOrderBucketUpdate(order, isLeadOrder(order) ? 'interest' : 'active', now);
