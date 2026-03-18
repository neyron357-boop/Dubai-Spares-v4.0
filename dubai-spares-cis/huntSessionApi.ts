import { supabase } from './supabase';
import { HuntGpsPingRow, HuntSessionRow, HuntWaypointResult, HuntWaypointRow } from './types';

const assertSupabase = () => {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase;
};

// ─── Sessions ────────────────────────────────────────────────────────────────

export const createHuntSession = async (orderId: string): Promise<HuntSessionRow> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('order_hunt_sessions')
    .insert({ order_id: orderId, status: 'active' })
    .select('id, order_id, status, started_at, ended_at')
    .single();
  if (error) throw error;
  return data as HuntSessionRow;
};

export const endHuntSession = async (sessionId: string): Promise<void> => {
  const client = assertSupabase();
  const { error } = await client
    .from('order_hunt_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) throw error;
};

export const getActiveHuntSession = async (orderId: string): Promise<HuntSessionRow | null> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('order_hunt_sessions')
    .select('id, order_id, status, started_at, ended_at')
    .eq('order_id', orderId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as HuntSessionRow | null);
};

export const getHuntSessionById = async (sessionId: string): Promise<HuntSessionRow | null> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('order_hunt_sessions')
    .select('id, order_id, status, started_at, ended_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return (data as HuntSessionRow | null);
};

export const getLatestHuntSession = async (orderId: string): Promise<HuntSessionRow | null> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('order_hunt_sessions')
    .select('id, order_id, status, started_at, ended_at')
    .eq('order_id', orderId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as HuntSessionRow | null);
};

// ─── GPS Pings ────────────────────────────────────────────────────────────────

export const sendGpsPing = async (
  sessionId: string,
  lat: number,
  lng: number,
  accuracyM?: number
): Promise<void> => {
  const client = assertSupabase();
  const { error } = await client
    .from('order_hunt_gps_pings')
    .insert({
      session_id: sessionId,
      lat,
      lng,
      accuracy_m: accuracyM ?? null,
      ts: new Date().toISOString()
    });
  if (error) throw error;
};

/** Returns the last N GPS pings for a session ordered by time ascending (for drawing a track). */
export const getGpsTrack = async (sessionId: string, limit = 500): Promise<HuntGpsPingRow[]> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('order_hunt_gps_pings')
    .select('id, session_id, lat, lng, accuracy_m, ts')
    .eq('session_id', sessionId)
    .order('ts', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as HuntGpsPingRow[];
};

/** Returns only the very latest GPS ping (for showing current position). */
export const getLatestGpsPing = async (sessionId: string): Promise<HuntGpsPingRow | null> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('order_hunt_gps_pings')
    .select('id, session_id, lat, lng, accuracy_m, ts')
    .eq('session_id', sessionId)
    .order('ts', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as HuntGpsPingRow | null);
};

// ─── Waypoints ────────────────────────────────────────────────────────────────

export interface AddWaypointPayload {
  sessionId: string;
  orderId: string;
  shopName: string;
  result: HuntWaypointResult;
  priceAed?: number | null;
  note?: string | null;
  photoUrls?: string[];
  lat?: number | null;
  lng?: number | null;
}

export const addHuntWaypoint = async (payload: AddWaypointPayload): Promise<HuntWaypointRow> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('order_hunt_waypoints')
    .insert({
      session_id: payload.sessionId,
      order_id: payload.orderId,
      shop_name: payload.shopName,
      result: payload.result,
      price_aed: payload.priceAed ?? null,
      note: payload.note ?? null,
      photo_urls: payload.photoUrls ?? [],
      lat: payload.lat ?? null,
      lng: payload.lng ?? null
    })
    .select('id, session_id, order_id, shop_name, result, price_aed, note, photo_urls, lat, lng, created_at')
    .single();
  if (error) throw error;
  return data as HuntWaypointRow;
};

export const getHuntWaypoints = async (sessionId: string): Promise<HuntWaypointRow[]> => {
  const client = assertSupabase();
  const { data, error } = await client
    .from('order_hunt_waypoints')
    .select('id, session_id, order_id, shop_name, result, price_aed, note, photo_urls, lat, lng, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as HuntWaypointRow[];
};

export const deleteHuntWaypoint = async (waypointId: string): Promise<void> => {
  const client = assertSupabase();
  const { error } = await client
    .from('order_hunt_waypoints')
    .delete()
    .eq('id', waypointId);
  if (error) throw error;
};

/** Public (anon-accessible) helper: fetch all hunt data for a client view. */
export const getPublicHuntData = async (orderId: string): Promise<{
  session: HuntSessionRow | null;
  waypoints: HuntWaypointRow[];
  latestPing: HuntGpsPingRow | null;
  track: HuntGpsPingRow[];
}> => {
  const client = assertSupabase();

  const { data: sessions } = await client
    .from('order_hunt_sessions')
    .select('id, order_id, status, started_at, ended_at')
    .eq('order_id', orderId)
    .order('started_at', { ascending: false })
    .limit(1);

  const session = (sessions?.[0] as HuntSessionRow | undefined) ?? null;

  if (!session) {
    return { session: null, waypoints: [], latestPing: null, track: [] };
  }

  const [wpResult, pingResult, trackResult] = await Promise.all([
    client
      .from('order_hunt_waypoints')
      .select('id, session_id, order_id, shop_name, result, price_aed, note, photo_urls, lat, lng, created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true }),
    client
      .from('order_hunt_gps_pings')
      .select('id, session_id, lat, lng, accuracy_m, ts')
      .eq('session_id', session.id)
      .order('ts', { ascending: false })
      .limit(1),
    client
      .from('order_hunt_gps_pings')
      .select('id, session_id, lat, lng, accuracy_m, ts')
      .eq('session_id', session.id)
      .order('ts', { ascending: true })
      .limit(300)
  ]);

  return {
    session,
    waypoints: (wpResult.data ?? []) as HuntWaypointRow[],
    latestPing: (pingResult.data?.[0] as HuntGpsPingRow | undefined) ?? null,
    track: (trackResult.data ?? []) as HuntGpsPingRow[]
  };
};
