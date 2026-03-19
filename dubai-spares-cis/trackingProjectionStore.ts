import { HuntGpsPingRow, HuntSessionRow, HuntStatus, HuntWaypointRow, TrackingProjection } from './types';
import { buildTrackingPhase, buildTrackingTimeline } from './trackingTimelineBuilder';
import { describeTrackingFreshness, resolveTrackingFreshnessState } from './trackingSyncState';

type TrackingSeed = {
  orderId: string;
  publicToken?: string;
  huntStatus: HuntStatus;
  session: HuntSessionRow | null;
  waypoints: HuntWaypointRow[];
  latestPing: HuntGpsPingRow | null;
  track: HuntGpsPingRow[];
  liveChannelState?: TrackingProjection['live_channel_state'];
  projectionVersion?: number;
  sourceUpdatedAt?: string | null;
  pendingQueue?: boolean;
};

const listeners = new Set<() => void>();
const projections = new Map<string, TrackingProjection>();

const sortWaypoints = (waypoints: HuntWaypointRow[]) => waypoints.slice().sort((a, b) => {
  const diff = Date.parse(a.created_at || '') - Date.parse(b.created_at || '');
  if (diff !== 0) return diff;
  return String(a.id).localeCompare(String(b.id));
});

const dedupeWaypoints = (waypoints: HuntWaypointRow[]) => sortWaypoints(Array.from(new Map(waypoints.filter(Boolean).map((waypoint) => [waypoint.id, waypoint])).values()));

const dedupeTrack = (track: HuntGpsPingRow[]) => track
  .filter(Boolean)
  .sort((a, b) => Date.parse(a.ts || '') - Date.parse(b.ts || ''))
  .reduce<HuntGpsPingRow[]>((acc, ping) => {
    if (acc.some((existing) => existing.id === ping.id)) return acc;
    acc.push(ping);
    return acc;
  }, []);

const summarize = (waypoints: HuntWaypointRow[]) => ({
  total: waypoints.length,
  found: waypoints.filter((item) => item.result === 'found').length,
  not_found: waypoints.filter((item) => item.result === 'not_found').length,
  defect: waypoints.filter((item) => item.result === 'defect').length,
  high_price: waypoints.filter((item) => item.result === 'high_price').length,
  with_media: waypoints.filter((item) => (item.photo_urls || []).length > 0).length
});

export const createTrackingProjection = (seed: TrackingSeed): TrackingProjection => {
  const normalizedWaypoints = dedupeWaypoints(seed.waypoints);
  const normalizedTrack = dedupeTrack(seed.track);
  const projection_updated_at = new Date().toISOString();
  const source_updated_at = seed.sourceUpdatedAt || seed.latestPing?.ts || normalizedWaypoints[normalizedWaypoints.length - 1]?.created_at || seed.session?.started_at || null;
  const last_live_event_at = seed.latestPing?.ts || normalizedWaypoints[normalizedWaypoints.length - 1]?.created_at || seed.session?.started_at || null;
  const live_channel_state = seed.liveChannelState || 'connected';
  const live_freshness_state = resolveTrackingFreshnessState({
    projectionUpdatedAt: projection_updated_at,
    lastLiveEventAt: last_live_event_at,
    lastPositionAt: seed.latestPing?.ts || null,
    liveChannelState: live_channel_state,
    hasPendingQueue: seed.pendingQueue
  });
  const freshness = describeTrackingFreshness(live_freshness_state);
  const timeline_items = buildTrackingTimeline({
    session: seed.session,
    waypoints: normalizedWaypoints,
    latestPing: seed.latestPing,
    huntStatus: seed.huntStatus
  });

  return {
    order_id: seed.orderId,
    public_token: seed.publicToken || '',
    hunt_status: seed.huntStatus,
    tracking_phase: buildTrackingPhase(seed.huntStatus),
    operator_presence_state: seed.session?.status === 'paused' ? 'paused' : seed.latestPing ? 'moving' : seed.session?.status === 'active' ? 'active' : 'idle',
    latest_operator_position: seed.latestPing,
    route_points: normalizedTrack,
    timeline_items,
    waypoint_rows: normalizedWaypoints,
    waypoints_summary: summarize(normalizedWaypoints),
    last_client_safe_update_at: timeline_items[timeline_items.length - 1]?.timestamp || null,
    projection_version: seed.projectionVersion || Date.now(),
    source_updated_at,
    projection_updated_at,
    last_live_event_at,
    last_position_at: seed.latestPing?.ts || null,
    live_freshness_state,
    sync_state: live_freshness_state,
    live_channel_state,
    sync_badge: freshness.label
  };
};

export const upsertTrackingProjection = (seed: TrackingSeed) => {
  projections.set(seed.orderId, createTrackingProjection(seed));
  listeners.forEach((listener) => listener());
  return projections.get(seed.orderId) || null;
};

export const getTrackingProjection = (orderId: string) => projections.get(orderId) || null;
export const subscribeTrackingProjectionStore = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
