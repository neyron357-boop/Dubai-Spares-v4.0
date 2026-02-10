export type AppNotificationType = 'radar' | 'sync' | 'system';

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
}

const STORAGE_KEY = 'dubai_spares_local_notifications';
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

export const pushNotification = (payload: Omit<AppNotification, 'id' | 'createdAt'>) => {
  const list = getNotifications();
  const next: AppNotification = {
    ...payload,
    id: createId(),
    createdAt: Date.now(),
    read: false
  };
  persist([next, ...list]);
  return next;
};

export const markNotificationRead = (id: string) => {
  const list = getNotifications().map((item) => (item.id === id ? { ...item, read: true } : item));
  persist(list);
};

export const markAllNotificationsRead = () => {
  const list = getNotifications().map((item) => ({ ...item, read: true }));
  persist(list);
};
