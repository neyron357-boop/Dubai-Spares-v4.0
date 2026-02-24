import { Shop } from './types';
import { supabase } from './supabase';

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

const assertSupabase = () => {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase;
};

export const logRadarEvent = async (radarSessionId: string, eventType: string, payload?: Record<string, unknown>, clientEventId?: string) => {
  const client = assertSupabase();
  const { error } = await client
    .from('radar_events')
    .insert({
      radar_session_id: radarSessionId,
      event_type: eventType,
      ...(clientEventId ? { client_event_id: clientEventId } : {}),
      ...(payload ? { payload } : {})
    });

  if (error && error.code !== '23505') throw error;
};

export const applyRadarEventAtomic = async (eventPayload: RadarApplyEventPayload) => {
  const client = assertSupabase();
  const { data, error } = await client.rpc('radar_apply_event', {
    p_event_payload: eventPayload,
    p_client_event_id: eventPayload.client_event_id
  });

  if (error) throw error;
  return data;
};

export const findActiveRadarSessionByOrder = async (orderId: string): Promise<RadarSessionRow | null> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('radar_sessions')
    .select('id, order_id, radius_km, mode, is_active, ended_at')
    .eq('order_id', orderId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<RadarSessionRow>();

  if (error) throw error;
  return data || null;
};

export const createRadarSession = async (orderId: string, radiusKm = 10, mode = 'smart'): Promise<RadarSessionRow> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('radar_sessions')
    .insert({ order_id: orderId, radius_km: radiusKm, mode })
    .select('id, order_id, radius_km, mode, is_active, ended_at')
    .single<RadarSessionRow>();

  if (error || !data) throw error || new Error('Failed to create radar session');
  await logRadarEvent(data.id, 'created_session');
  return data;
};

export const ensureRadarSessionForOrder = async (orderId: string, shops: Shop[]): Promise<RadarSessionRow> => {
  const existing = await findActiveRadarSessionByOrder(orderId);
  if (existing) return existing;

  const created = await createRadarSession(orderId);
  await upsertRadarTargets(created.id, shops.slice(0, 20));
  return created;
};

export const upsertRadarTargets = async (radarSessionId: string, shops: Shop[]) => {
  if (!shops.length) return;
  const client = assertSupabase();
  const rows = shops.slice(0, 30).map((shop) => ({
    radar_session_id: radarSessionId,
    shop_id: shop.id,
    score: Number.isFinite(Number(shop.heatLevel)) ? Number(shop.heatLevel) : 0,
    status: 'planned'
  }));

  const { error } = await client
    .from('radar_targets')
    .upsert(rows, { onConflict: 'radar_session_id,shop_id' });

  if (error) throw error;
};

export const getRadarSession = async (sessionId: string): Promise<RadarSessionRow | null> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('radar_sessions')
    .select('id, order_id, radius_km, mode, is_active, ended_at')
    .eq('id', sessionId)
    .maybeSingle<RadarSessionRow>();
  if (error) throw error;
  return data || null;
};

export const getRadarTargets = async (sessionId: string): Promise<RadarTargetRow[]> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('v_radar_active_targets')
    .select('id, radar_session_id, shop_id, score, status, distance_km, eta_min, route_order, score_breakdown, matched_brands, matched_categories, created_at, updated_at')
    .eq('radar_session_id', sessionId)
    .order('route_order', { ascending: true, nullsFirst: false })
    .order('score', { ascending: false })
    .limit(30)
    .returns<RadarTargetRow[]>();
  if (error) throw error;
  return data || [];
};

export const regenerateRadarTargets = async (sessionId: string, maxTargets = 30) => {
  const client = assertSupabase();

  const geo = navigator.geolocation
    ? await new Promise<{ lat?: number; lng?: number }>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve({}),
          { timeout: 2000 }
        );
      })
    : {};

  const { data, error } = await client.rpc('radar_generate_targets', {
    p_session_id: sessionId,
    p_max_targets: maxTargets,
    p_user_lat: geo.lat ?? null,
    p_user_lng: geo.lng ?? null
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const setRadarTargetStatus = async (target: RadarTargetRow, nextStatus: RadarTargetStatus, extraPayload?: Record<string, unknown>) => {
  throw new Error(`Deprecated: use applyRadarEventAtomic with client_event_id (${target.id}:${nextStatus}:${JSON.stringify(extraPayload || {})})`);
};

export const getRadarEvents = async (sessionId: string) => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('radar_events')
    .select('id, event_type, payload, created_at')
    .eq('radar_session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw error;
  return data || [];
};

export const closeRadarSession = async (sessionId: string) => {
  const client = assertSupabase();
  const { error } = await client
    .from('radar_sessions')
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) throw error;
  await logRadarEvent(sessionId, 'session_closed');
};

export const getOrderItemsByOrder = async (orderId: string): Promise<OrderItemRow[]> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('order_items')
    .select('id, order_id, part_name, brand, model, year, quantity')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .returns<OrderItemRow[]>();

  if (error) throw error;
  return data || [];
};

export const ensureRadarTargetItems = async (targets: RadarTargetRow[], orderItems: OrderItemRow[]) => {
  if (!targets.length || !orderItems.length) return;
  const client = assertSupabase();
  const rows = targets.flatMap((target) =>
    orderItems.map((orderItem) => ({
      radar_target_id: target.id,
      order_item_id: orderItem.id
    }))
  );

  const { error } = await client
    .from('radar_target_items')
    .upsert(rows, { onConflict: 'radar_target_id,order_item_id', ignoreDuplicates: true });

  if (error) throw error;
};

export const getRadarTargetItems = async (targetIds: string[]): Promise<RadarTargetItemRow[]> => {
  if (!targetIds.length) return [];
  const client = assertSupabase();
  const { data, error } = await client
    .from('radar_target_items')
    .select('id, radar_target_id, order_item_id, item_status, price_aed, notes, updated_at')
    .in('radar_target_id', targetIds)
    .returns<RadarTargetItemRow[]>();

  if (error) throw error;
  return data || [];
};

export const markRadarTargetItemStatus = async (
  targetItemId: string,
  status: Exclude<RadarTargetItemStatus, 'pending'>,
  _clientEventId?: string
) => {
  throw new Error(`Deprecated: use applyRadarEventAtomic with client_event_id (${targetItemId}:${status})`);
};
