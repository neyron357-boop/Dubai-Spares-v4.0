import { Order } from './types';
import { logger } from './logging';
import { pushActivityNotification } from './notificationCenter';

export type CustomerActivityType =
  | 'tracking_opened'
  | 'tracking_view_heartbeat'
  | 'telegram_subscription_created'
  | 'telegram_subscription_confirmed'
  | 'telegram_bot_interaction'
  | 'notification_event_received'
  | 'notification_sent'
  | 'relevance_prompt_shown'
  | 'relevance_confirmed'
  | 'relevance_declined'
  | 'search_paused';

export interface CustomerActivityLogEntry {
  id: string;
  orderId: string;
  type: CustomerActivityType;
  createdAt: number;
  actor: 'customer' | 'telegram_bot' | 'manager' | 'system';
  channel: 'tracking_page' | 'telegram' | 'admin' | 'system';
  summary: string;
  meta?: Record<string, unknown>;
}

export interface TelegramSubscriptionState {
  orderId: string;
  code: string;
  deepLink: string;
  botUrl: string;
  botUsername: string;
  createdAt: number;
  confirmedAt?: number;
  chatId?: string;
  lastNotificationAt?: number;
}

type NotificationEventType = 'hunt_history' | 'quote_updated' | 'status_changed' | 'logistics_updated' | 'shipment_updated' | 'order_paused';

interface NotificationEventRow {
  id: string;
  orderId: string;
  type: NotificationEventType;
  createdAt: number;
  summary: string;
  trackingUrl: string;
  deliveredAt?: number;
}

const CUSTOMER_LOGS_KEY = 'dubai_spares_customer_activity_logs_v1';
const TELEGRAM_LINKS_KEY = 'dubai_spares_order_telegram_links_v1';
const NOTIFICATION_EVENTS_KEY = 'dubai_spares_notification_events_v1';
const RELEVANCE_STATE_KEY = 'dubai_spares_relevance_state_v1';
const DEBOUNCE_MS = 45_000;

const uid = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  window.localStorage.setItem(key, JSON.stringify(value));
};

const normalizeBotUsername = (url: string) => {
  const match = String(url || '').match(/t\.me\/([A-Za-z0-9_]+)/i);
  return match?.[1] || 'DubaiSparesBot';
};

export const buildTrackingUrl = (orderId: string) => `${window.location.origin}/quote/${encodeURIComponent(orderId)}`;

export const getOrderCustomerLogs = (orderId: string) =>
  readJson<CustomerActivityLogEntry[]>(CUSTOMER_LOGS_KEY, []).filter((entry) => entry.orderId === orderId).sort((a, b) => b.createdAt - a.createdAt);

export const appendCustomerLog = (entry: Omit<CustomerActivityLogEntry, 'id' | 'createdAt'>) => {
  const nextEntry: CustomerActivityLogEntry = { ...entry, id: uid(), createdAt: Date.now() };
  const current = readJson<CustomerActivityLogEntry[]>(CUSTOMER_LOGS_KEY, []);
  const next = [nextEntry, ...current].slice(0, 5000);
  writeJson(CUSTOMER_LOGS_KEY, next);
  window.dispatchEvent(new CustomEvent('customer-logs:changed', { detail: { orderId: entry.orderId } }));
  void logger.info('customer-engagement', entry.summary, { orderId: entry.orderId, type: entry.type, channel: entry.channel, ...entry.meta });
  return nextEntry;
};

export const ensureTelegramSubscriptionState = (orderId: string, telegramUrl: string) => {
  const items = readJson<Record<string, TelegramSubscriptionState>>(TELEGRAM_LINKS_KEY, {});
  const existing = items[orderId];
  if (existing) return existing;
  const botUrl = String(telegramUrl || '').trim();
  const botUsername = normalizeBotUsername(botUrl);
  const code = `${orderId}:${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const deepLink = `https://t.me/${botUsername}?start=${encodeURIComponent(`track_${code}`)}`;
  const state: TelegramSubscriptionState = { orderId, code, deepLink, botUrl, botUsername, createdAt: Date.now() };
  items[orderId] = state;
  writeJson(TELEGRAM_LINKS_KEY, items);
  appendCustomerLog({
    orderId,
    type: 'telegram_subscription_created',
    actor: 'system',
    channel: 'tracking_page',
    summary: 'Подготовлена Telegram-подписка для клиента.',
    meta: { code, deepLink }
  });
  return state;
};

export const getTelegramSubscriptionState = (orderId: string) => readJson<Record<string, TelegramSubscriptionState>>(TELEGRAM_LINKS_KEY, {})[orderId] || null;

export const markTelegramSubscriptionConfirmed = (orderId: string, chatId?: string) => {
  const items = readJson<Record<string, TelegramSubscriptionState>>(TELEGRAM_LINKS_KEY, {});
  const current = items[orderId];
  if (!current) return null;
  const next = { ...current, confirmedAt: Date.now(), chatId: chatId || current.chatId };
  items[orderId] = next;
  writeJson(TELEGRAM_LINKS_KEY, items);
  appendCustomerLog({ orderId, type: 'telegram_subscription_confirmed', actor: 'telegram_bot', channel: 'telegram', summary: 'Telegram-бот связал chat_id с заказом.', meta: { chatId: chatId || null } });
  return next;
};

const flushDebouncedNotifications = (orderId: string) => {
  const items = readJson<NotificationEventRow[]>(NOTIFICATION_EVENTS_KEY, []);
  const pending = items.filter((item) => item.orderId === orderId && !item.deliveredAt);
  if (!pending.length) return;
  const summary = pending.map((item) => item.summary).slice(0, 3).join(' · ');
  const deliveredAt = Date.now();
  const next = items.map((item) => item.orderId === orderId && !item.deliveredAt ? { ...item, deliveredAt } : item);
  writeJson(NOTIFICATION_EVENTS_KEY, next);
  appendCustomerLog({ orderId, type: 'notification_sent', actor: 'system', channel: 'telegram', summary: `Сформировано Telegram-уведомление: ${summary}`, meta: { events: pending.length, trackingUrl: pending[0].trackingUrl } });
  pushActivityNotification({ title: 'Telegram-уведомление клиенту', message: summary, orderId, entityType: 'order', entityId: orderId, route: `/order/${orderId}` });
};

const debounceTimers = new Map<string, number>();

export const enqueueCustomerNotificationEvent = (order: Order, type: NotificationEventType, summary: string) => {
  const trackingUrl = buildTrackingUrl(order.id);
  const current = readJson<NotificationEventRow[]>(NOTIFICATION_EVENTS_KEY, []);
  current.unshift({ id: uid(), orderId: order.id, type, createdAt: Date.now(), summary, trackingUrl });
  writeJson(NOTIFICATION_EVENTS_KEY, current.slice(0, 1000));
  appendCustomerLog({ orderId: order.id, type: 'notification_event_received', actor: 'system', channel: 'system', summary, meta: { eventType: type, trackingUrl } });
  const timer = debounceTimers.get(order.id);
  if (timer) window.clearTimeout(timer);
  debounceTimers.set(order.id, window.setTimeout(() => flushDebouncedNotifications(order.id), DEBOUNCE_MS));
};

export const maybeOpenRelevancePrompt = (orderId: string) => {
  const state = readJson<Record<string, { lastShownAt?: number; pausedAt?: number }>>(RELEVANCE_STATE_KEY, {});
  const item = state[orderId] || {};
  if (item.pausedAt) return false;
  return !item.lastShownAt || Date.now() - item.lastShownAt >= 24 * 60 * 60 * 1000;
};

export const markRelevancePromptShown = (orderId: string) => {
  const state = readJson<Record<string, { lastShownAt?: number; pausedAt?: number }>>(RELEVANCE_STATE_KEY, {});
  state[orderId] = { ...(state[orderId] || {}), lastShownAt: Date.now() };
  writeJson(RELEVANCE_STATE_KEY, state);
  appendCustomerLog({ orderId, type: 'relevance_prompt_shown', actor: 'system', channel: 'tracking_page', summary: 'Клиенту показан модальный вопрос об актуальности поиска.' });
};

export const confirmRelevance = (orderId: string, isRelevant: boolean) => {
  appendCustomerLog({ orderId, type: isRelevant ? 'relevance_confirmed' : 'relevance_declined', actor: 'customer', channel: 'tracking_page', summary: isRelevant ? 'Клиент подтвердил, что поиск ещё актуален.' : 'Клиент указал, что поиск уже не актуален.' });
};

export const pauseOrderSearchFromTracking = (order: Order) => {
  const state = readJson<Record<string, { lastShownAt?: number; pausedAt?: number }>>(RELEVANCE_STATE_KEY, {});
  state[order.id] = { ...(state[order.id] || {}), pausedAt: Date.now(), lastShownAt: Date.now() };
  writeJson(RELEVANCE_STATE_KEY, state);
  appendCustomerLog({ orderId: order.id, type: 'search_paused', actor: 'customer', channel: 'tracking_page', summary: 'Клиент приостановил поиск по заказу.' });
  enqueueCustomerNotificationEvent(order, 'order_paused', `Заказ ${order.brand} ${order.model} приостановлен клиентом`);
};
