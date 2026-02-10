export type AppNotificationType = 'radar' | 'sync' | 'system' | 'order';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: AppNotificationType;
  createdAt: number;
  route?: string;
  shopId?: string;
  orderId?: string;
  read?: boolean;
  signature?: string;
}

const STORAGE_KEY = 'dubai_spares_local_notifications';
const READ_SIGNATURES_KEY = 'dubai_spares_read_notification_signatures';
const MAX_ITEMS = 300;

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const getNotifications = (): AppNotification[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
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

export const sendBrowserNotification = async (
  title: string,
  options: NotificationOptions & { route?: string; url?: string }
) => {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;

  const data = { ...(options.data || {}), route: options.route, url: options.url };

  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      ...options,
      data,
      vibrate: options.vibrate || [220, 120, 220],
      badge: '/icon-192.png'
    });
    return;
  }

  const notification = new Notification(title, { ...options, data, vibrate: options.vibrate || [220, 120, 220] });
  notification.onclick = () => {
    if (options.route) {
      window.location.hash = `#${options.route}`;
    } else if (options.url) {
      window.open(options.url, '_blank');
    }
    notification.close();
  };
};

export const pushNotification = (payload: Omit<AppNotification, 'id' | 'createdAt'>) => {
  const list = getNotifications();
  const signature = payload.signature || `${payload.type}:${payload.orderId || ''}:${payload.shopId || ''}:${payload.title}:${payload.body}`;
  const signatures = getReadSignatures();
  if (signatures[signature]) {
    return null;
  }

  const existing = list.find((item) => item.signature === signature);
  if (existing) return existing;

  const next: AppNotification = {
    ...payload,
    signature,
    id: createId(),
    createdAt: Date.now(),
    read: false
  };
  persist([next, ...list]);
  return next;
};

export const markNotificationRead = (id: string) => {
  const signatures = getReadSignatures();
  const list = getNotifications().map((item) => {
    if (item.id !== id) return item;
    if (item.signature) signatures[item.signature] = Date.now();
    return { ...item, read: true };
  });
  persistReadSignatures(signatures);
  persist(list);
};

export const markAllNotificationsRead = () => {
  const signatures = getReadSignatures();
  const list = getNotifications().map((item) => {
    if (item.signature) signatures[item.signature] = Date.now();
    return { ...item, read: true };
  });
  persistReadSignatures(signatures);
  persist(list);
};
