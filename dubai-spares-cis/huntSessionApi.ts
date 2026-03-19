import { publishDomainEvent } from './domainEvents';
import { supabase } from './supabase';
import { HuntGpsPingRow, HuntSessionRow, HuntStatus, HuntWaypointResult, HuntWaypointRow } from './types';

// ─── Local-storage helpers (fallback when DB tables are not yet created) ──────

const LS_SESSION = (orderId: string) => `ds_hunt_session_${orderId}`;
const LS_WAYPOINTS = (sessionId: string) => `ds_hunt_waypoints_${sessionId}`;

const genId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const readLocalSession = (orderId: string): HuntSessionRow | null => {
  try {
    const raw = localStorage.getItem(LS_SESSION(orderId));
    return raw ? (JSON.parse(raw) as HuntSessionRow) : null;
  } catch { return null; }
};

const writeLocalSession = (session: HuntSessionRow): void => {
  try { localStorage.setItem(LS_SESSION(session.order_id), JSON.stringify(session)); } catch { /* ignore */ }
};

const readLocalWaypoints = (sessionId: string): HuntWaypointRow[] => {
  try {
    const raw = localStorage.getItem(LS_WAYPOINTS(sessionId));
    return raw ? (JSON.parse(raw) as HuntWaypointRow[]) : [];
  } catch { return []; }
};

const writeLocalWaypoints = (sessionId: string, waypoints: HuntWaypointRow[]): void => {
  try { localStorage.setItem(LS_WAYPOINTS(sessionId), JSON.stringify(waypoints)); } catch { /* ignore */ }
};

// ─── Sessions ────────────────────────────────────────────────────────────────

export const createHuntSession = async (orderId: string): Promise<HuntSessionRow> => {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('order_hunt_sessions')
        .insert({ order_id: orderId, status: 'active' })
        .select('id, order_id, status, started_at, ended_at')
        .single();
      if (!error && data) {
        const session = data as HuntSessionRow;
        writeLocalSession(session);
        void publishDomainEvent('HUNT_SESSION_STARTED', {
          entityType: 'hunt_session',
          entityId: session.id,
          aggregateId: orderId,
          dedupeKey: `hunt-session-started:${session.id}`,
          idempotencyKey: `hunt-session-started:${session.id}`,
          replaySafe: true,
          source: 'cloud',
          payload: { orderId, session }
        });
        return session;
      }
      console.warn('[hunt] createHuntSession DB error, using local fallback:', error);
    } catch (err) {
      console.warn('[hunt] createHuntSession threw, using local fallback:', err);
    }
  }

  // Local fallback: generate session in localStorage
  const localSession: HuntSessionRow = {
    id: genId(),
    order_id: orderId,
    status: 'active',
    started_at: new Date().toISOString(),
    ended_at: null
  };
  writeLocalSession(localSession);
  void publishDomainEvent('HUNT_SESSION_STARTED', {
    entityType: 'hunt_session',
    entityId: localSession.id,
    aggregateId: orderId,
    dedupeKey: `hunt-session-started:${localSession.id}`,
    idempotencyKey: `hunt-session-started:${localSession.id}`,
    replaySafe: true,
    source: 'local_cache',
    payload: { orderId, session: localSession }
  });
  return localSession;
};

export const endHuntSession = async (sessionId: string, orderId?: string): Promise<void> => {
  if (supabase) {
    try {
      const { error } = await supabase
        .from('order_hunt_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', sessionId);
      if (error) console.warn('[hunt] endHuntSession DB error, updating local only:', error);
    } catch (err) {
      console.warn('[hunt] endHuntSession threw, updating local only:', err);
    }
  }

  // Always update localStorage regardless of DB result
  try {
    // Update in all known order sessions (we look through all LS keys is not practical;
    // instead, search by iterating prefix — simple O(n) scan of localStorage keys)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('ds_hunt_session_')) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const session = JSON.parse(raw) as HuntSessionRow;
        if (session.id === sessionId) {
          session.status = 'ended';
          session.ended_at = new Date().toISOString();
          localStorage.setItem(key, JSON.stringify(session));
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  void publishDomainEvent('HUNT_SESSION_ENDED', {
    entityType: 'hunt_session',
    entityId: sessionId,
    aggregateId: orderId || sessionId,
    dedupeKey: `hunt-session-ended:${sessionId}:${Date.now()}`,
    idempotencyKey: `hunt-session-ended:${sessionId}`,
    replaySafe: true,
    source: 'system',
    payload: { orderId: orderId || sessionId, sessionId, endedAt: new Date().toISOString() }
  });
};

export const getActiveHuntSession = async (orderId: string): Promise<HuntSessionRow | null> => {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('order_hunt_sessions')
        .select('id, order_id, status, started_at, ended_at')
        .eq('order_id', orderId)
        .eq('status', 'active')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error) {
        const session = data as HuntSessionRow | null;
        if (session) writeLocalSession(session);
        return session;
      }
      console.warn('[hunt] getActiveHuntSession DB error, checking local:', error);
    } catch (err) {
      console.warn('[hunt] getActiveHuntSession threw, checking local:', err);
    }
  }

  // Local fallback
  const local = readLocalSession(orderId);
  return local?.status === 'active' ? local : null;
};

export const getHuntSessionById = async (sessionId: string): Promise<HuntSessionRow | null> => {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('order_hunt_sessions')
        .select('id, order_id, status, started_at, ended_at')
        .eq('id', sessionId)
        .maybeSingle();
      if (!error) return data as HuntSessionRow | null;
      console.warn('[hunt] getHuntSessionById DB error:', error);
    } catch (err) {
      console.warn('[hunt] getHuntSessionById threw:', err);
    }
  }
  return null;
};

export const getLatestHuntSession = async (orderId: string): Promise<HuntSessionRow | null> => {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('order_hunt_sessions')
        .select('id, order_id, status, started_at, ended_at')
        .eq('order_id', orderId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error) return data as HuntSessionRow | null;
      console.warn('[hunt] getLatestHuntSession DB error, checking local:', error);
    } catch (err) {
      console.warn('[hunt] getLatestHuntSession threw, checking local:', err);
    }
  }
  return readLocalSession(orderId);
};

// ─── GPS Pings ────────────────────────────────────────────────────────────────

export const sendGpsPing = async (
  sessionId: string,
  lat: number,
  lng: number,
  accuracyM?: number
): Promise<void> => {
  // GPS pings are fire-and-forget; dedupe near-identical samples to avoid noisy map jitter.
  if (!supabase) return;
  try {
    const previousPing = await getLatestGpsPing(sessionId).catch(() => null);
    if (previousPing) {
      const drift = Math.hypot(previousPing.lat - lat, previousPing.lng - lng);
      const ageMs = Date.now() - Date.parse(previousPing.ts);
      if (drift < 0.00005 && ageMs < 15_000) return;
    }
    const ping: HuntGpsPingRow = { id: `gps-${Date.now()}`, session_id: sessionId, lat, lng, accuracy_m: accuracyM ?? null, ts: new Date().toISOString() };
    await supabase
      .from('order_hunt_gps_pings')
      .insert({
        session_id: sessionId,
        lat,
        lng,
        accuracy_m: accuracyM ?? null,
        ts: ping.ts
      });
    void publishDomainEvent('HUNT_GPS_UPDATED', {
      entityType: 'gps_ping',
      entityId: ping.id,
      aggregateId: sessionId,
      dedupeKey: `hunt-gps:${sessionId}:${ping.ts}`,
      idempotencyKey: `hunt-gps:${sessionId}:${ping.ts}`,
      replaySafe: true,
      source: 'cloud',
      payload: { sessionId, ping }
    });
  } catch (err) {
    console.debug('[hunt] sendGpsPing failed (non-fatal):', err);
  }
};

/** Returns the last N GPS pings for a session ordered by time ascending (for drawing a track). */
export const getGpsTrack = async (sessionId: string, limit = 500): Promise<HuntGpsPingRow[]> => {
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from('order_hunt_gps_pings')
      .select('id, session_id, lat, lng, accuracy_m, ts')
      .eq('session_id', sessionId)
      .order('ts', { ascending: true })
      .limit(limit);
    return (data ?? []) as HuntGpsPingRow[];
  } catch { return []; }
};

/** Returns only the very latest GPS ping (for showing current position). */
export const getLatestGpsPing = async (sessionId: string): Promise<HuntGpsPingRow | null> => {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from('order_hunt_gps_pings')
      .select('id, session_id, lat, lng, accuracy_m, ts')
      .eq('session_id', sessionId)
      .order('ts', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as HuntGpsPingRow | null);
  } catch { return null; }
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
  if (supabase) {
    try {
      const { data, error } = await supabase
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
      if (!error && data) {
        const row = data as HuntWaypointRow;
        // Mirror to localStorage so getHuntWaypoints fallback stays in sync
        const existing = readLocalWaypoints(payload.sessionId);
        writeLocalWaypoints(payload.sessionId, [...existing, row]);
        void publishDomainEvent('HUNT_WAYPOINT_ADDED', {
          entityType: 'hunt_waypoint',
          entityId: row.id,
          aggregateId: payload.orderId,
          dedupeKey: `hunt-waypoint:${row.id}`,
          idempotencyKey: `hunt-waypoint:${row.id}`,
          replaySafe: true,
          source: 'cloud',
          payload: { orderId: payload.orderId, sessionId: payload.sessionId, waypoint: row }
        });
        return row;
      }
      console.warn('[hunt] addHuntWaypoint DB error, using local fallback:', error);
    } catch (err) {
      console.warn('[hunt] addHuntWaypoint threw, using local fallback:', err);
    }
  }

  // Local fallback: generate waypoint in localStorage
  const localRow: HuntWaypointRow = {
    id: genId(),
    session_id: payload.sessionId,
    order_id: payload.orderId,
    shop_name: payload.shopName,
    result: payload.result,
    price_aed: payload.priceAed ?? null,
    note: payload.note ?? null,
    photo_urls: payload.photoUrls ?? [],
    lat: payload.lat ?? null,
    lng: payload.lng ?? null,
    created_at: new Date().toISOString()
  };
  const existing = readLocalWaypoints(payload.sessionId);
  writeLocalWaypoints(payload.sessionId, [...existing, localRow]);
  void publishDomainEvent('HUNT_WAYPOINT_ADDED', {
    entityType: 'hunt_waypoint',
    entityId: localRow.id,
    aggregateId: payload.orderId,
    dedupeKey: `hunt-waypoint:${localRow.id}`,
    idempotencyKey: `hunt-waypoint:${localRow.id}`,
    replaySafe: true,
    source: 'local_cache',
    payload: { orderId: payload.orderId, sessionId: payload.sessionId, waypoint: localRow }
  });
  return localRow;
};

export const getHuntWaypoints = async (sessionId: string): Promise<HuntWaypointRow[]> => {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('order_hunt_waypoints')
        .select('id, session_id, order_id, shop_name, result, price_aed, note, photo_urls, lat, lng, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      if (!error) {
        const rows = (data ?? []) as HuntWaypointRow[];
        // Keep localStorage in sync so offline reads work later
        if (rows.length > 0) writeLocalWaypoints(sessionId, rows);
        return rows;
      }
      console.warn('[hunt] getHuntWaypoints DB error, reading local:', error);
    } catch (err) {
      console.warn('[hunt] getHuntWaypoints threw, reading local:', err);
    }
  }
  return readLocalWaypoints(sessionId);
};

export const deleteHuntWaypoint = async (waypointId: string): Promise<void> => {
  if (supabase) {
    try {
      const { error } = await supabase
        .from('order_hunt_waypoints')
        .delete()
        .eq('id', waypointId);
      if (error) console.warn('[hunt] deleteHuntWaypoint DB error:', error);
    } catch (err) {
      console.warn('[hunt] deleteHuntWaypoint threw:', err);
    }
  }

  // Always remove from localStorage (covers both local and DB-backed sessions)
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('ds_hunt_waypoints_')) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const waypoints = JSON.parse(raw) as HuntWaypointRow[];
        const filtered = waypoints.filter((wp) => wp.id !== waypointId);
        if (filtered.length !== waypoints.length) {
          localStorage.setItem(key, JSON.stringify(filtered));
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
};

/** Public (anon-accessible) helper: fetch all hunt data for a client view. */
export const getPublicHuntData = async (orderId: string): Promise<{
  session: HuntSessionRow | null;
  waypoints: HuntWaypointRow[];
  latestPing: HuntGpsPingRow | null;
  track: HuntGpsPingRow[];
  resolvedStatus: HuntStatus;
}> => {
  if (!supabase) {
    const session = readLocalSession(orderId);
    const waypoints = session ? readLocalWaypoints(session.id) : [];
    return {
      session,
      waypoints,
      latestPing: null,
      track: [],
      resolvedStatus: session ? (session.status === 'active' ? 'live_hunt' : 'final_offer') : 'data_gathering'
    };
  }

  try {
    const [sessionResult, orderResult] = await Promise.all([
      supabase
        .from('order_hunt_sessions')
        .select('id, order_id, status, started_at, ended_at')
        .eq('order_id', orderId)
        .order('started_at', { ascending: false })
        .limit(1),
      supabase
        .from('orders')
        .select('hunt_status')
        .eq('id', orderId)
        .maybeSingle()
    ]);

    const session = (sessionResult.data?.[0] as HuntSessionRow | undefined) ?? null;
    const orderStatus = (['data_gathering', 'live_hunt', 'final_offer'] as const).includes((orderResult.data as any)?.hunt_status)
      ? ((orderResult.data as any).hunt_status as HuntStatus)
      : 'data_gathering';

    if (!session) {
      // Fall back to localStorage if DB returned nothing (tables may not exist yet)
      const localSession = readLocalSession(orderId);
      const localWaypoints = localSession ? readLocalWaypoints(localSession.id) : [];
      const localStatus: HuntStatus = localSession
        ? (localSession.status === 'active' ? 'live_hunt' : 'final_offer')
        : 'data_gathering';
      return {
        session: localSession,
        waypoints: localWaypoints,
        latestPing: null,
        track: [],
        resolvedStatus: orderStatus === 'data_gathering' ? localStatus : orderStatus
      };
    }

    const [wpResult, pingResult, trackResult] = await Promise.all([
      supabase
        .from('order_hunt_waypoints')
        .select('id, session_id, order_id, shop_name, result, price_aed, note, photo_urls, lat, lng, created_at')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('order_hunt_gps_pings')
        .select('id, session_id, lat, lng, accuracy_m, ts')
        .eq('session_id', session.id)
        .order('ts', { ascending: false })
        .limit(1),
      supabase
        .from('order_hunt_gps_pings')
        .select('id, session_id, lat, lng, accuracy_m, ts')
        .eq('session_id', session.id)
        .order('ts', { ascending: true })
        .limit(300)
    ]);

    const dbWaypoints = (wpResult.data ?? []) as HuntWaypointRow[];
    const localWaypoints = readLocalWaypoints(session.id);
    const mergedWaypoints = [...dbWaypoints];
    for (const localWaypoint of localWaypoints) {
      if (!mergedWaypoints.some((item) => item.id === localWaypoint.id)) {
        mergedWaypoints.push(localWaypoint);
      }
    }
    mergedWaypoints.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (mergedWaypoints.length > 0) writeLocalWaypoints(session.id, mergedWaypoints);

    return {
      session,
      waypoints: mergedWaypoints,
      latestPing: (pingResult.data?.[0] as HuntGpsPingRow | undefined) ?? null,
      track: (trackResult.data ?? []) as HuntGpsPingRow[],
      resolvedStatus: session.status === 'active' ? 'live_hunt' : 'final_offer'
    };
  } catch (err) {
    console.warn('[hunt] getPublicHuntData failed, reading local:', err);
    const localSession = readLocalSession(orderId);
    const localWaypoints = localSession ? readLocalWaypoints(localSession.id) : [];
    return {
      session: localSession,
      waypoints: localWaypoints,
      latestPing: null,
      track: [],
      resolvedStatus: localSession ? (localSession.status === 'active' ? 'live_hunt' : 'final_offer') : 'data_gathering'
    };
  }
};
