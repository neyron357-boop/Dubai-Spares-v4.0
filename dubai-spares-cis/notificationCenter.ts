import { supabase } from './supabase';

export enum NotificationType {
  ORDER_NEW = 'ORDER_NEW',
  ORDER_STATUS_CHANGED = 'ORDER_STATUS_CHANGED',
  RADAR_RESULT = 'RADAR_RESULT',
  RADAR_ACTION = 'RADAR_ACTION',
  FOLLOWUP_DUE = 'FOLLOWUP_DUE',
  SYNC_ERROR = 'SYNC_ERROR',
  OFFLINE_QUEUE = 'OFFLINE_QUEUE',
  SYSTEM_TIPS = 'SYSTEM_TIPS',
  ACTION_LOG = 'ACTION_LOG'
}

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';
export type NotificationSource = 'app' | 'web_form' | 'radar' | 'sync';
export type NotificationTab = 'active' | 'archive';

export interface AppNotification {
  entityType?: 'order' | 'part' | 'supplier' | 'variant' | 'system';
  entityId?: string;
  partId?: string;
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
const MAX_ITEMS = 5000;

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
  if (type === NotificationType.ACTION_LOG) return 'info';
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
    partId: typeof item.partId === 'string' ? item.partId : undefined,
    entityType: item.entityType === 'order' || item.entityType === 'part' || item.entityType === 'supplier' || item.entityType === 'variant' ? item.entityType : 'system',
    entityId: typeof item.entityId === 'string' ? item.entityId : undefined,
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

// ── Server persistence helpers ────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const toUuidOrNull = (value?: string): string | null =>
  value && UUID_RE.test(value.trim()) ? value.trim() : null;

const notificationToRow = (item: AppNotification) => ({
  client_id: item.id,
  created_at: new Date(item.createdAt).toISOString(),
  type: item.type,
  title: item.title,
  message: item.message,
  severity: item.severity,
  source: item.source || null,
  order_id: toUuidOrNull(item.orderId),
  supplier_id: toUuidOrNull(item.supplierId),
  part_id: item.partId || null,
  route: item.route || null,
  payload: {},
  read_at: item.readAt ? new Date(item.readAt).toISOString() : null,
  archived_at: item.archivedAt ? new Date(item.archivedAt).toISOString() : null,
  signature: item.signature || null,
  snooze_until: item.snoozeUntil || null,
  follow_up_at: item.followUpAt || null,
  entity_type: item.entityType || null,
  entity_id: item.entityId || null,
  radar_session_id: item.radarSessionId || null,
  phone: item.phone || null,
  map_url: item.mapUrl || null,
  lat: item.lat ?? null,
  lng: item.lng ?? null,
  distance_m: item.distanceM ?? null,
  brand: item.brand || null,
  car_model: item.carModel || null,
  car_year: item.carYear || null,
  offline: item.offline || false
});

const rowToNotification = (row: Record<string, unknown>): AppNotification | null => {
  if (!row || typeof row !== 'object') return null;
  return normalizeNotification({
    id: row.client_id || row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    severity: row.severity,
    source: row.source,
    orderId: row.order_id,
    supplierId: row.supplier_id,
    partId: row.part_id,
    route: row.route,
    createdAt: row.created_at ? Date.parse(String(row.created_at)) : Date.now(),
    readAt: row.read_at ? Date.parse(String(row.read_at)) : undefined,
    archivedAt: row.archived_at ? Date.parse(String(row.archived_at)) : undefined,
    signature: row.signature,
    snoozeUntil: row.snooze_until ? Number(row.snooze_until) : undefined,
    followUpAt: row.follow_up_at ? Number(row.follow_up_at) : undefined,
    entityType: row.entity_type,
    entityId: row.entity_id,
    radarSessionId: row.radar_session_id,
    phone: row.phone,
    mapUrl: row.map_url,
    lat: row.lat != null ? Number(row.lat) : undefined,
    lng: row.lng != null ? Number(row.lng) : undefined,
    distanceM: row.distance_m != null ? Number(row.distance_m) : undefined,
    brand: row.brand,
    carModel: row.car_model,
    carYear: row.car_year != null ? Number(row.car_year) : undefined,
    offline: row.offline === true
  });
};

/** Fire-and-forget upsert of a single notification to the server. */
const syncNotificationToServer = (item: AppNotification): void => {
  if (!supabase) return;
  const row = notificationToRow(item);
  void supabase
    .from('activity_notifications')
    .upsert(row, { onConflict: 'client_id', ignoreDuplicates: false })
    .then(({ error }) => {
      if (error) console.warn('[notificationCenter] server upsert failed', error.message);
    });
};

/** Fire-and-forget update of read/archived state for a notification on the server. */
const syncNotificationStateToServer = (clientId: string, update: { read_at?: string | null; archived_at?: string | null; snooze_until?: number | null; follow_up_at?: number | null }): void => {
  if (!supabase) return;
  void supabase
    .from('activity_notifications')
    .update(update)
    .eq('client_id', clientId)
    .then(({ error }) => {
      if (error) console.warn('[notificationCenter] server update failed', error.message);
    });
};

/**
 * Load notifications from the server and merge them into localStorage.
 * Call this once on app startup to restore notifications that survived cache clearing.
 */
export const initNotificationsFromServer = async (): Promise<void> => {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('activity_notifications')
      .select('*')
      .not('client_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(MAX_ITEMS);

    if (error || !data) {
      console.warn('[notificationCenter] server load failed', error?.message);
      return;
    }

    const serverItems = (data as Array<Record<string, unknown>>)
      .map(rowToNotification)
      .filter(Boolean) as AppNotification[];

    if (serverItems.length === 0) return;

    // Merge: server items take precedence over local items for shared IDs
    const local = getNotifications();
    const localById = new Map(local.map((n) => [n.id, n]));
    serverItems.forEach((s) => {
      // Server read/archived state wins if more recent
      const l = localById.get(s.id);
      if (!l) {
        localById.set(s.id, s);
      } else {
        const merged: AppNotification = {
          ...l,
          readAt: s.readAt && (!l.readAt || s.readAt > l.readAt) ? s.readAt : l.readAt,
          archivedAt: s.archivedAt && (!l.archivedAt || s.archivedAt > l.archivedAt) ? s.archivedAt : l.archivedAt,
          snoozeUntil: s.snoozeUntil ?? l.snoozeUntil,
          followUpAt: s.followUpAt ?? l.followUpAt
        };
        localById.set(s.id, merged);
      }
    });

    const merged = Array.from(localById.values()).sort((a, b) => b.createdAt - a.createdAt);
    persist(merged);
  } catch (err) {
    console.warn('[notificationCenter] server load error', err);
  }
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
      window.location.hash = `#${normalizeNotificationRoute(options.route)}`;
    } else if (options.url) {
      window.open(options.url, '_blank');
    }
    notification.close();
  };
};

export const pushNotification = (payload: Omit<AppNotification, 'id' | 'createdAt' | 'severity'> & { severity?: NotificationSeverity; allowDuplicates?: boolean }) => {
  const list = getNotifications();
  const signature = payload.signature || `${payload.type}:${payload.orderId || ''}:${payload.supplierId || ''}:${payload.title}:${payload.message}`;
  const signatures = getReadSignatures();
  if (!payload.allowDuplicates && signatures[signature]) return null;

  const existing = payload.allowDuplicates ? null : list.find((item) => item.signature === signature && !item.archivedAt);
  if (existing) return existing;

  const next: AppNotification = {
    ...payload,
    signature,
    severity: payload.severity || inferSeverity(payload.type, payload.title, payload.message),
    id: createId(),
    createdAt: Date.now()
  };
  delete (next as any).allowDuplicates;
  persist([next, ...list]);
  syncNotificationToServer(next);
  return next;
};

export const markNotificationRead = (id: string) => {
  const signatures = getReadSignatures();
  const now = Date.now();
  const list = getNotifications().map((item) => {
    if (item.id !== id) return item;
    if (item.signature) signatures[item.signature] = now;
    return { ...item, readAt: now };
  });
  persistReadSignatures(signatures);
  persist(list);
  syncNotificationStateToServer(id, { read_at: new Date(now).toISOString() });
};

export const markNotificationsRead = (ids: string[]) => {
  const target = new Set(ids);
  const signatures = getReadSignatures();
  const now = Date.now();
  const readAtIso = new Date(now).toISOString();
  const list = getNotifications().map((item) => {
    if (!target.has(item.id)) return item;
    if (item.signature) signatures[item.signature] = now;
    return { ...item, readAt: now };
  });
  persistReadSignatures(signatures);
  persist(list);
  ids.forEach((id) => syncNotificationStateToServer(id, { read_at: readAtIso }));
};

export const markAllNotificationsRead = () => {
  const signatures = getReadSignatures();
  const now = Date.now();
  const readAtIso = new Date(now).toISOString();
  const list = getNotifications().map((item) => {
    if (item.signature) signatures[item.signature] = now;
    return { ...item, readAt: now };
  });
  persistReadSignatures(signatures);
  persist(list);
  list.forEach((item) => syncNotificationStateToServer(item.id, { read_at: readAtIso }));
};

export const restoreNotificationReadState = (snapshot: Array<{ id: string; readAt?: number }>) => {
  const map = new Map(snapshot.map((item) => [item.id, item.readAt]));
  const list = getNotifications().map((item) => ({ ...item, readAt: map.get(item.id) }));
  persist(list);
};

export const archiveNotification = (id: string) => {
  const archivedAt = Date.now();
  const list = getNotifications().map((item) => item.id === id ? { ...item, archivedAt } : item);
  persist(list);
  syncNotificationStateToServer(id, { archived_at: new Date(archivedAt).toISOString() });
};

export const restoreFromArchive = (id: string) => {
  const list = getNotifications().map((item) => item.id === id ? { ...item, archivedAt: undefined } : item);
  persist(list);
  syncNotificationStateToServer(id, { archived_at: null });
};

export const completeFollowupNotification = archiveNotification;


export const clearAllNotifications = (tab: NotificationTab = 'active') => {
  const list = getNotifications().filter((item) => (tab === 'archive' ? !item.archivedAt : !!item.archivedAt));
  persist(list);
};

export const snoozeNotification = (id: string, snoozeUntil: number) => {
  const list = getNotifications().map((item) => item.id === id ? { ...item, snoozeUntil, followUpAt: snoozeUntil, readAt: undefined } : item);
  persist(list);
  syncNotificationStateToServer(id, { snooze_until: snoozeUntil, follow_up_at: snoozeUntil });
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


export const pushActivityNotification = (payload: {
  title: string;
  message: string;
  orderId?: string;
  partId?: string;
  supplierId?: string;
  route?: string;
  entityType?: AppNotification['entityType'];
  entityId?: string;
  severity?: NotificationSeverity;
}) => pushNotification({
  type: NotificationType.ACTION_LOG,
  title: payload.title,
  message: payload.message,
  orderId: payload.orderId,
  partId: payload.partId,
  supplierId: payload.supplierId,
  route: payload.route,
  entityType: payload.entityType || 'system',
  entityId: payload.entityId,
  source: 'app',
  allowDuplicates: true,
  signature: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
  severity: payload.severity || 'info'
});

export const getUnreadNotificationsCount = () => getNotifications().filter((item) => !item.readAt && !item.archivedAt).length;
