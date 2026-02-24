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
  created_at?: string;
  updated_at?: string;
}

const assertSupabase = () => {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase;
};

export const logRadarEvent = async (radarSessionId: string, eventType: string, payload?: Record<string, unknown>) => {
  const client = assertSupabase();
  const { error } = await client
    .from('radar_events')
    .insert({
      radar_session_id: radarSessionId,
      event_type: eventType,
      ...(payload ? { payload } : {})
    });

  if (error) throw error;
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
    .from('radar_targets')
    .select('id, radar_session_id, shop_id, score, status, created_at, updated_at')
    .eq('radar_session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(30)
    .returns<RadarTargetRow[]>();
  if (error) throw error;
  return data || [];
};

export const setRadarTargetStatus = async (target: RadarTargetRow, nextStatus: RadarTargetStatus, extraPayload?: Record<string, unknown>) => {
  const client = assertSupabase();
  const { error } = await client
    .from('radar_targets')
    .update({ status: nextStatus })
    .eq('id', target.id);

  if (error) throw error;

  await logRadarEvent(target.radar_session_id, 'status_change', {
    from: target.status,
    to: nextStatus,
    at: new Date().toISOString(),
    ...(extraPayload || {})
  });
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
