export enum NotificationType {
  ORDER_NEW = 'ORDER_NEW',
  ORDER_STATUS_CHANGED = 'ORDER_STATUS_CHANGED',
  RADAR_RESULT = 'RADAR_RESULT',
  RADAR_ACTION = 'RADAR_ACTION',
  FOLLOWUP_DUE = 'FOLLOWUP_DUE',
  SYNC_ERROR = 'SYNC_ERROR',
  OFFLINE_QUEUE = 'OFFLINE_QUEUE',
  SYSTEM_TIPS = 'SYSTEM_TIPS'
}

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';
export type NotificationSource = 'app' | 'web_form' | 'radar' | 'sync';
export type NotificationTab = 'active' | 'archive';

export interface AppNotification {
  id: string;
  type: NotificationType;
  createdAt: number;
  readAt?: number;
  severity: NotificationSeverity;
  orderId?: string;
  supplierId?: string;
  radarSessionId?: string;
  title: string;
  message: string;
  phone?: string;
  mapUrl?: string;
  lat?: number;
  lng?: number;
  distanceM?: number;
  brand?: string;
  carModel?: string;
  carYear?: number;
  followUpAt?: number;
  snoozeUntil?: number;
  offline?: boolean;
  source?: NotificationSource;
  archivedAt?: number;
  route?: string;
  signature?: string;
}

const STORAGE_KEY = 'dubai_spares_local_notifications_v2';
const LEGACY_STORAGE_KEY = 'dubai_spares_local_notifications';
const READ_SIGNATURES_KEY = 'dubai_spares_read_notification_signatures';
const MAX_ITEMS = 1000;

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const legacyTypeMap: Record<string, NotificationType> = {
  radar: NotificationType.RADAR_RESULT,
  sync: NotificationType.SYNC_ERROR,
  system: NotificationType.SYSTEM_TIPS,
  order: NotificationType.ORDER_NEW
};

const inferSeverity = (type: NotificationType, title: string, message: string): NotificationSeverity => {
  const text = `${title} ${message}`.toLowerCase();
  if (type === NotificationType.SYNC_ERROR || type === NotificationType.OFFLINE_QUEUE) return 'critical';
  if (type === NotificationType.ORDER_NEW && text.includes('vip')) return 'critical';
  if (type === NotificationType.FOLLOWUP_DUE && text.includes('просроч')) return 'critical';
  if (text.includes('error') || text.includes('ошиб')) return 'warning';
  if (text.includes('found') || text.includes('продан') || text.includes('успеш')) return 'success';
  return 'info';
};

const normalizeNotification = (item: any): AppNotification | null => {
  if (!item || typeof item !== 'object') return null;
  const createdAt = Number(item.createdAt) || Date.now();
  const type = (item.type in NotificationType ? item.type : legacyTypeMap[item.type]) || NotificationType.SYSTEM_TIPS;
  const title = typeof item.title === 'string' ? item.title : 'Уведомление';
  const message = typeof item.message === 'string' ? item.message : (typeof item.body === 'string' ? item.body : '');
  const notification: AppNotification = {
    id: typeof item.id === 'string' ? item.id : createId(),
    type,
    createdAt,
    readAt: Number(item.readAt) || (item.read ? Date.now() : undefined),
    severity: item.severity || inferSeverity(type, title, message),
    orderId: typeof item.orderId === 'string' ? item.orderId : undefined,
    supplierId: typeof item.supplierId === 'string' ? item.supplierId : (typeof item.shopId === 'string' ? item.shopId : undefined),
    radarSessionId: typeof item.radarSessionId === 'string' ? item.radarSessionId : undefined,
    title,
    message,
    phone: typeof item.phone === 'string' ? item.phone : undefined,
    mapUrl: typeof item.mapUrl === 'string' ? item.mapUrl : undefined,
    lat: Number.isFinite(Number(item.lat)) ? Number(item.lat) : undefined,
    lng: Number.isFinite(Number(item.lng)) ? Number(item.lng) : undefined,
    distanceM: Number.isFinite(Number(item.distanceM)) ? Number(item.distanceM) : undefined,
    brand: typeof item.brand === 'string' ? item.brand : undefined,
    carModel: typeof item.carModel === 'string' ? item.carModel : undefined,
    carYear: Number.isFinite(Number(item.carYear)) ? Number(item.carYear) : undefined,
    followUpAt: Number.isFinite(Number(item.followUpAt)) ? Number(item.followUpAt) : undefined,
    snoozeUntil: Number.isFinite(Number(item.snoozeUntil)) ? Number(item.snoozeUntil) : undefined,
    offline: item.offline === true,
    source: item.source,
    archivedAt: Number.isFinite(Number(item.archivedAt)) ? Number(item.archivedAt) : undefined,
    route: typeof item.route === 'string' ? item.route : undefined,
    signature: typeof item.signature === 'string' ? item.signature : undefined
  };
  return notification;
};

const readStorage = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const getNotifications = (): AppNotification[] => {
  const parsed = readStorage(STORAGE_KEY).map(normalizeNotification).filter(Boolean) as AppNotification[];
  if (parsed.length > 0) return parsed.sort((a, b) => b.createdAt - a.createdAt);

  const migrated = readStorage(LEGACY_STORAGE_KEY).map(normalizeNotification).filter(Boolean) as AppNotification[];
  if (migrated.length > 0) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated.slice(0, MAX_ITEMS)));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
  return migrated.sort((a, b) => b.createdAt - a.createdAt);
};

const persist = (list: AppNotification[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
  window.dispatchEvent(new CustomEvent('notifications:changed'));
};

const getReadSignatures = () => {
  try {
    const raw = localStorage.getItem(READ_SIGNATURES_KEY);
    if (!raw) return {} as Record<string, number>;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {};
  } catch {
    return {} as Record<string, number>;
  }
};

const persistReadSignatures = (map: Record<string, number>) => {
  localStorage.setItem(READ_SIGNATURES_KEY, JSON.stringify(map));
};


const normalizeNotificationRoute = (route?: string) => {
  if (!route) return '/';
  const trimmed = route.trim();
  if (!trimmed) return '/';
  const normalized = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (normalized.startsWith('/orders/')) return normalized.replace('/orders/', '/order/');
  if (normalized.startsWith('/')) return normalized;
  return `/${normalized}`;
};

export const sendBrowserNotification = async (
  title: string,
  options: NotificationOptions & { route?: string; url?: string }
) => {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;

  const data = { ...(options.data || {}), route: options.route, url: options.url };

  const notification = new Notification(title, { ...options, data, vibrate: options.vibrate || [220, 120, 220] });
  notification.onclick = () => {
    if (options.route) {
      window.location.hash = `#${normalizeNotificationRoute(options.route)}`;
    } else if (options.url) {
      window.open(options.url, '_blank');
    }
    notification.close();
  };
};

export const pushNotification = (payload: Omit<AppNotification, 'id' | 'createdAt' | 'severity'> & { severity?: NotificationSeverity }) => {
  const list = getNotifications();
  const signature = payload.signature || `${payload.type}:${payload.orderId || ''}:${payload.supplierId || ''}:${payload.title}:${payload.message}`;
  const signatures = getReadSignatures();
  if (signatures[signature]) return null;

  const existing = list.find((item) => item.signature === signature && !item.archivedAt);
  if (existing) return existing;

  const next: AppNotification = {
    ...payload,
    signature,
    severity: payload.severity || inferSeverity(payload.type, payload.title, payload.message),
    id: createId(),
    createdAt: Date.now()
  };
  persist([next, ...list]);
  return next;
};

export const markNotificationRead = (id: string) => {
  const signatures = getReadSignatures();
  const list = getNotifications().map((item) => {
    if (item.id !== id) return item;
    if (item.signature) signatures[item.signature] = Date.now();
    return { ...item, readAt: Date.now() };
  });
  persistReadSignatures(signatures);
  persist(list);
};

export const markNotificationsRead = (ids: string[]) => {
  const target = new Set(ids);
  const signatures = getReadSignatures();
  const now = Date.now();
  const list = getNotifications().map((item) => {
    if (!target.has(item.id)) return item;
    if (item.signature) signatures[item.signature] = now;
    return { ...item, readAt: now };
  });
  persistReadSignatures(signatures);
  persist(list);
};

export const markAllNotificationsRead = () => {
  const signatures = getReadSignatures();
  const now = Date.now();
  const list = getNotifications().map((item) => {
    if (item.signature) signatures[item.signature] = now;
    return { ...item, readAt: now };
  });
  persistReadSignatures(signatures);
  persist(list);
};

export const restoreNotificationReadState = (snapshot: Array<{ id: string; readAt?: number }>) => {
  const map = new Map(snapshot.map((item) => [item.id, item.readAt]));
  const list = getNotifications().map((item) => ({ ...item, readAt: map.get(item.id) }));
  persist(list);
};

export const archiveNotification = (id: string) => {
  const list = getNotifications().map((item) => item.id === id ? { ...item, archivedAt: Date.now() } : item);
  persist(list);
};

export const restoreFromArchive = (id: string) => {
  const list = getNotifications().map((item) => item.id === id ? { ...item, archivedAt: undefined } : item);
  persist(list);
};

export const completeFollowupNotification = archiveNotification;


export const clearAllNotifications = (tab: NotificationTab = 'active') => {
  const list = getNotifications().filter((item) => (tab === 'archive' ? !item.archivedAt : !!item.archivedAt));
  persist(list);
};

export const snoozeNotification = (id: string, snoozeUntil: number) => {
  const list = getNotifications().map((item) => item.id === id ? { ...item, snoozeUntil, followUpAt: snoozeUntil, readAt: undefined } : item);
  persist(list);
};

export const createFollowupFromAction = (payload: {
  orderId?: string;
  supplierId?: string;
  phone?: string;
  brand?: string;
  carModel?: string;
  carYear?: number;
  route?: string;
  minutes?: number;
  source?: NotificationSource;
}) => pushNotification({
  type: NotificationType.FOLLOWUP_DUE,
  title: 'Ожидаем ответ',
  message: `⏰ Follow-up через ${payload.minutes || 30} мин`,
  followUpAt: Date.now() + (payload.minutes || 30) * 60_000,
  orderId: payload.orderId,
  supplierId: payload.supplierId,
  phone: payload.phone,
  brand: payload.brand,
  carModel: payload.carModel,
  carYear: payload.carYear,
  source: payload.source || 'radar',
  route: payload.route,
  severity: 'warning'
});

export const getUnreadNotificationsCount = () => getNotifications().filter((item) => !item.readAt && !item.archivedAt).length;
