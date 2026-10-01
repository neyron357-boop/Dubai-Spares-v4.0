import { fetchRadarShops, getSuppliersEnriched } from './radarShops';
import { localDocuments } from './storage/localDocuments';
import { offlineDb } from './storage/offlineDb';
import { Shop } from './types';

export type RadarTargetStatus = 'planned' | 'in_route' | 'at_shop' | 'done';

export interface RadarSessionRow {
  id: string;
  order_id: string;
  radius_km: number;
  mode: string;
  is_active: boolean;
  ended_at?: string | null;
}

export interface RadarTargetRow {
  id: string;
  radar_session_id: string;
  shop_id: string;
  score: number | null;
  status: RadarTargetStatus;
  distance_km?: number | null;
  eta_min?: number | null;
  route_order?: number | null;
  score_breakdown?: Record<string, number>;
  matched_brands?: string[];
  matched_categories?: string[];
  created_at?: string;
  updated_at?: string;
}

export type RadarTargetItemStatus = 'pending' | 'found' | 'not_found' | 'partial';

export interface OrderItemRow {
  id: string;
  order_id: string;
  part_name: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  quantity: number | null;
}

export interface RadarTargetItemRow {
  id: string;
  radar_target_id: string;
  order_item_id: string;
  item_status: RadarTargetItemStatus;
  price_aed: number | null;
  notes: string | null;
  updated_at?: string;
}

export interface RadarApplyEventPayload {
  radar_session_id: string;
  event_type: string;
  client_event_id: string;
  target_id?: string;
  target_item_id?: string;
  shop_id?: string;
  status?: RadarTargetStatus;
  item_status?: Exclude<RadarTargetItemStatus, 'pending'>;
  payload?: Record<string, unknown>;
}

type RadarEvent = {
  id: string;
  event_type: string;
  payload?: Record<string, unknown>;
  created_at: string;
};
type RadarData = {
  sessions: RadarSessionRow[];
  targets: RadarTargetRow[];
  items: RadarTargetItemRow[];
  events: Array<RadarEvent & { session_id: string }>;
};
const load = async (): Promise<RadarData> =>
  (await localDocuments.get<RadarData>('radar')) || {
    sessions: [],
    targets: [],
    items: [],
    events: [],
  };
let writes: Promise<unknown> = Promise.resolve();
const mutate = <T>(change: (data: RadarData) => T): Promise<T> => {
  const task = writes.then(async () => {
    const data = await load();
    const result = change(data);
    await localDocuments.set('radar', data);
    return result;
  });
  writes = task.catch(() => undefined);
  return task;
};
export const logRadarEvent = async (
  session_id: string,
  event_type: string,
  payload?: Record<string, unknown>,
  id = crypto.randomUUID(),
) =>
  mutate((data) => {
    if (!data.events.some((event) => event.id === id))
      data.events.unshift({
        id,
        session_id,
        event_type,
        payload,
        created_at: new Date().toISOString(),
      });
  });
export const applyRadarEventAtomic = async (event: RadarApplyEventPayload) =>
  mutate((data) => {
    if (data.events.some((item) => item.id === event.client_event_id)) return;
    const now = new Date().toISOString();
    const target = data.targets.find((item) => item.id === event.target_id);
    if (target && event.status) {
      target.status = event.status;
      target.updated_at = now;
    }
    const item = data.items.find((item) => item.id === event.target_item_id);
    if (item && event.item_status) {
      item.item_status = event.item_status;
      item.updated_at = now;
      if (typeof event.payload?.price_aed === 'number') item.price_aed = event.payload.price_aed;
      if (typeof event.payload?.notes === 'string') item.notes = event.payload.notes;
    }
    data.events.unshift({
      id: event.client_event_id,
      session_id: event.radar_session_id,
      event_type: event.event_type,
      payload: event.payload,
      created_at: now,
    });
  });
export const findActiveRadarSessionByOrder = async (orderId: string) =>
  (await load()).sessions.find((session) => session.order_id === orderId && session.is_active) ||
  null;
export const findActiveRadarSession = async () =>
  (await load()).sessions.find((session) => session.is_active) || null;
export const createRadarSession = async (order_id: string, radius_km = 10, mode = 'smart') =>
  mutate((data) => {
    const session: RadarSessionRow = {
      id: crypto.randomUUID(),
      order_id,
      radius_km,
      mode,
      is_active: true,
    };
    data.sessions.unshift(session);
    return session;
  });
export const ensureRadarSessionForOrder = async (orderId: string, shops: Shop[]) => {
  const session =
    (await findActiveRadarSessionByOrder(orderId)) || (await createRadarSession(orderId));
  await upsertRadarTargets(session.id, shops);
  return session;
};
export const upsertRadarTargets = async (sessionId: string, shops: Shop[]) =>
  mutate((data) => {
    shops.slice(0, 30).forEach((shop, index) => {
      if (
        !data.targets.some(
          (target) => target.radar_session_id === sessionId && target.shop_id === shop.id,
        )
      )
        data.targets.push({
          id: crypto.randomUUID(),
          radar_session_id: sessionId,
          shop_id: shop.id,
          score: Number(shop.heatLevel || 0),
          status: 'planned',
          route_order: index,
        });
    });
  });
export const getRadarSession = async (id: string) =>
  (await load()).sessions.find((session) => session.id === id) || null;
export const getRadarTargets = async (id: string) =>
  (await load()).targets
    .filter((target) => target.radar_session_id === id)
    .sort((a, b) => (a.route_order || 0) - (b.route_order || 0));
export const regenerateRadarTargets = async (id: string, maxTargets = 30) => {
  await upsertRadarTargets(
    id,
    (await fetchRadarShops(await getSuppliersEnriched())).slice(0, maxTargets),
  );
  return getRadarTargets(id);
};
export const getRadarEvents = async (id: string) =>
  (await load()).events.filter((event) => event.session_id === id).slice(0, 30);
export const closeRadarSession = async (id: string) =>
  mutate((data) => {
    const session = data.sessions.find((session) => session.id === id);
    if (session) {
      session.is_active = false;
      session.ended_at = new Date().toISOString();
    }
  });
export const getOrderItemsByOrder = async (id: string): Promise<OrderItemRow[]> => {
  const order = (await offlineDb.getOrders()).find((order) => order.id === id);
  return order
    ? order.parts.map((part) => ({
        id: part.id,
        order_id: id,
        part_name: part.name,
        brand: order.brand,
        model: order.model,
        year: Number(order.year) || null,
        quantity: part.quantity || 1,
      }))
    : [];
};
export const ensureRadarTargetItems = async (targets: RadarTargetRow[], parts: OrderItemRow[]) =>
  mutate((data) => {
    targets.forEach((target) =>
      parts.forEach((part) => {
        if (
          !data.items.some(
            (item) => item.radar_target_id === target.id && item.order_item_id === part.id,
          )
        )
          data.items.push({
            id: crypto.randomUUID(),
            radar_target_id: target.id,
            order_item_id: part.id,
            item_status: 'pending',
            price_aed: null,
            notes: null,
          });
      }),
    );
  });
export const getRadarTargetItems = async (ids: string[]) =>
  (await load()).items.filter((item) => ids.includes(item.radar_target_id));
