import type { Order } from '../types';
import { getOrderBucket, isArchivedOrder } from './orderCard';
import { getFinanceVariant } from './quotePricing';

export type OrderOverviewMissingInput = {
  id: 'vin' | 'photo' | 'contact' | 'delivery';
  label: string;
  action: 'vehicle' | 'photo' | 'client' | 'finance';
  description?: string;
};

export type OrderOverviewAction = {
  id: 'restore' | 'add_parts' | 'deposit' | 'search' | 'offers' | 'quote' | 'prepayment' | 'proof';
  label: string;
  title: string;
  description: string;
};

export type OrderOverviewView = {
  statusLabel: string;
  paymentLabel: string | null;
  archived: boolean;
  completed: boolean;
  depositPaid: boolean;
  fullPrepaymentPaid: boolean;
  quoteCreated: boolean;
  totalParts: number;
  sourcedParts: number;
  selectedParts: number;
  pricedParts: number;
  missingInputs: OrderOverviewMissingInput[];
  nextAction: OrderOverviewAction;
};

export type OrderOverviewOptions = {
  /** The existing supplier workflow requires a deposit unless explicitly configured otherwise. */
  depositRequired?: boolean;
  /** Override legacy status inference when the caller knows whether a quote actually exists. */
  quoteCreated?: boolean;
};

const hasText = (value?: string) => Boolean(value?.trim());

const getMissingInputs = (order: Order): OrderOverviewMissingInput[] => {
  const inputs: OrderOverviewMissingInput[] = [];
  if (!hasText(order.vin)) inputs.push({ id: 'vin', label: 'Добавить VIN', action: 'vehicle' });
  if (!hasText(order.carPhotoUrl) && !order.carPhotos?.some(hasText))
    inputs.push({ id: 'photo', label: 'Добавить фото автомобиля', action: 'photo' });
  const hasContact =
    hasText(order.customerContact) ||
    hasText(order.socialNickname) ||
    Object.values(order.contactLinks || {}).some(hasText);
  if (!hasContact)
    inputs.push({ id: 'contact', label: 'Указать контакт клиента', action: 'client' });
  if (order.logistics?.deliveryType === 'export' && !hasText(order.logistics.cargoCountry))
    inputs.push({
      id: 'delivery',
      label: 'Указать доставку',
      action: 'finance',
      description: 'Добавьте страну международной доставки.',
    });
  return inputs;
};

const getNextAction = (
  view: Omit<OrderOverviewView, 'nextAction'>,
  depositRequired: boolean,
): OrderOverviewAction => {
  if (view.archived)
    return {
      id: 'restore',
      label: 'Восстановить заказ',
      title: view.completed ? 'Заказ завершён' : 'Заказ в архиве',
      description: 'Восстановите заказ, чтобы продолжить работу. Материалы и платежи сохранятся.',
    };
  if (view.totalParts === 0)
    return {
      id: 'add_parts',
      label: 'Добавить детали',
      title: 'Какие детали нужны клиенту?',
      description: 'Добавьте позиции в заказ: название, количество и фотографии для подбора.',
    };
  if (depositRequired && !view.depositPaid)
    return {
      id: 'deposit',
      label: 'Подтвердить депозит',
      title: 'Депозит ещё не подтверждён',
      description: 'Отметьте полученный депозит, чтобы открыть работу с предложениями поставщиков.',
    };
  if (view.sourcedParts < view.totalParts)
    return {
      id: 'search',
      label: 'Продолжить подбор',
      title: 'Подбор деталей продолжается',
      description: `Подобрано ${view.sourcedParts} из ${view.totalParts} позиций. Откройте очередь деталей и добавьте предложения.`,
    };
  if (view.selectedParts < view.totalParts || view.pricedParts < view.totalParts)
    return {
      id: 'offers',
      label: 'Проверить предложения',
      title: 'Заполните цены выбранных предложений',
      description: `Цены указаны для ${view.pricedParts} из ${view.totalParts} позиций. Проверьте предложения перед созданием сметы.`,
    };
  if (!view.quoteCreated)
    return {
      id: 'quote',
      label: 'Создать смету',
      title: 'Подготовьте предложение клиенту',
      description: 'Выбранные предложения и цены будут включены в смету для клиента.',
    };
  if (!view.fullPrepaymentPaid)
    return {
      id: 'prepayment',
      label: 'Отметить предоплату',
      title: 'Получите предоплату перед закупкой',
      description: 'Смета создана. Отметьте получение полной предоплаты перед выкупом деталей.',
    };
  return {
    id: 'proof',
    label: 'Добавить материалы',
    title: 'Зафиксируйте закупку и состояние деталей',
    description: 'Полная предоплата отмечена. Добавьте фотографии, видео и документы по заказу.',
  };
};

export const getOrderOverview = (
  order: Order,
  options: OrderOverviewOptions = {},
): OrderOverviewView => {
  const archived = isArchivedOrder(order);
  const completed = Boolean(
    order.isSold || order.status === 'sold' || order.salesStatus === 'Completed',
  );
  const fullPrepaymentPaid =
    order.paymentStatus === 'full_prepayment_paid' || order.salesStatus === 'Paid';
  const depositPaid =
    fullPrepaymentPaid ||
    order.searchDepositStatus === 'paid' ||
    order.paymentStatus === 'search_deposit_paid';
  const quoteCreated =
    options.quoteCreated ??
    (hasText(order.publicQuoteToken) ||
      order.salesStatus === 'Price Sent' ||
      order.salesStatus === 'Pending Approval');
  const totalParts = order.parts.length;
  const sourcedParts = order.parts.filter(
    (part) => part.isFound || (part.variants || []).length > 0,
  ).length;
  const selectedVariants = order.parts.map(getFinanceVariant).filter(Boolean);
  const selectedParts = selectedVariants.length;
  const pricedParts = selectedVariants.filter((variant) => {
    const price = Number(variant?.salePriceAed ?? variant?.priceAed ?? 0);
    return Number.isFinite(price) && price > 0;
  }).length;
  const bucket = getOrderBucket(order);
  const statusLabel = completed
    ? 'Завершён'
    : archived
      ? 'В архиве'
      : bucket === 'interest'
        ? 'Интерес'
        : bucket === 'not_found'
          ? 'Не найдено'
          : quoteCreated
            ? order.salesStatus === 'Pending Approval'
              ? 'Ждём решение'
              : 'Смета создана'
            : !depositPaid &&
                (order.status === 'waiting_deposit' || order.searchDepositStatus === 'pending')
              ? 'Ожидаем депозит'
              : totalParts > 0 && sourcedParts === totalParts
                ? 'Детали подобраны'
                : 'В поиске';
  const view = {
    statusLabel,
    paymentLabel: fullPrepaymentPaid
      ? 'Предоплата получена'
      : depositPaid
        ? 'Депозит внесён'
        : null,
    archived,
    completed,
    depositPaid,
    fullPrepaymentPaid,
    quoteCreated,
    totalParts,
    sourcedParts,
    selectedParts,
    pricedParts,
    missingInputs: getMissingInputs(order),
  };
  return { ...view, nextAction: getNextAction(view, options.depositRequired ?? true) };
};
