import { subscribeDomainEvent, publishDomainEvent } from './domainEvents';
import { getHuntSessionById, getHuntWaypoints, getLatestGpsPing, getGpsTrack } from './huntSessionApi';
import { HuntSessionRow, HuntWaypointRow } from './types';
import { scheduleLivePublicQuoteSync } from './publicQuoteSync';
import { getTrackingProjection, upsertTrackingProjection } from './trackingProjectionStore';

let installed = false;

const mapSessionToHuntStatus = (session: HuntSessionRow | null) => session?.status === 'completed' ? 'final_offer' : session?.status === 'active' || session?.status === 'paused' ? 'live_hunt' : 'data_gathering';

const mergeWaypoints = (existing: HuntWaypointRow[], incoming: HuntWaypointRow[]) => Array.from(new Map([...existing, ...incoming].filter(Boolean).map((waypoint) => [waypoint.id, waypoint])).values())
  .sort((a, b) => {
    const diff = Date.parse(a.created_at || '') - Date.parse(b.created_at || '');
    if (diff !== 0) return diff;
    return String(a.id).localeCompare(String(b.id));
  });

const refreshProjection = async (orderId: string, sessionId: string, reason: string, publicToken = '', optimisticWaypoint?: HuntWaypointRow, forcedSession?: HuntSessionRow | null) => {
  const existingProjection = getTrackingProjection(orderId);
  const [session, waypoints, latestPing, track] = await Promise.all([
    forcedSession === undefined ? getHuntSessionById(sessionId) : Promise.resolve(forcedSession),
    getHuntWaypoints(sessionId),
    getLatestGpsPing(sessionId),
    getGpsTrack(sessionId)
  ]);
  const huntStatus = mapSessionToHuntStatus(session);
  const mergedWaypoints = optimisticWaypoint ? mergeWaypoints(waypoints, [optimisticWaypoint]) : waypoints;
  const projection = upsertTrackingProjection({
    orderId,
    publicToken: publicToken || existingProjection?.public_token || '',
    huntStatus,
    session,
    waypoints: mergedWaypoints,
    latestPing,
    track,
    sourceUpdatedAt: latestPing?.ts || mergedWaypoints[mergedWaypoints.length - 1]?.created_at || session?.started_at || null
  });
  await publishDomainEvent('PUBLIC_QUOTE_REFRESH_REQUIRED', {
    entityType: 'public_quote',
    entityId: publicToken || orderId,
    aggregateId: orderId,
    dedupeKey: `tracking-projection:${orderId}:${projection?.projection_version}:${reason}`,
    idempotencyKey: `tracking-projection:${orderId}:${projection?.projection_version}:${reason}`,
    replaySafe: true,
    source: 'sync_coordinator',
    payload: {
      order: { id: orderId, publicQuoteToken: publicToken } as any,
      reason: `tracking_${reason}`,
      sourceOrderUpdatedAt: Date.now(),
      projectionVersion: projection?.projection_version || Date.now()
    }
  });
  return projection;
};

export const installHuntProjectionDispatcher = () => {
  if (installed) return;
  installed = true;

  subscribeDomainEvent('HUNT_SESSION_STARTED', async (event) => {
    await refreshProjection(event.payload.orderId, event.payload.session.id, 'started');
  });

  subscribeDomainEvent('HUNT_SESSION_ENDED', async (event) => {
    const projection = await refreshProjection(event.payload.orderId, event.payload.sessionId, 'ended');
    if (projection) scheduleLivePublicQuoteSync({ id: event.payload.orderId, publicQuoteToken: projection.public_token } as any, { reason: 'hunt_ended', sourceOrderUpdatedAt: Date.now() });
  });

  subscribeDomainEvent('HUNT_SESSION_STATUS_CHANGED', async (event) => {
    await refreshProjection(event.payload.orderId, event.payload.sessionId, `status_${event.payload.session?.status || 'updated'}`, '', undefined, event.payload.session || null);
  });

  subscribeDomainEvent('HUNT_WAYPOINT_ADDED', async (event) => {
    const projection = await refreshProjection(event.payload.orderId, event.payload.sessionId, 'waypoint_added', '', event.payload.waypoint);
    await publishDomainEvent('PUBLIC_QUOTE_REFRESHED', {
      entityType: 'public_quote',
      entityId: projection?.public_token || event.payload.orderId,
      aggregateId: event.payload.orderId,
      dedupeKey: `tracking-client-sync:${event.payload.waypoint.id}`,
      idempotencyKey: `tracking-client-sync:${event.payload.waypoint.id}`,
      replaySafe: true,
      source: 'sync_coordinator',
      payload: {
        orderId: event.payload.orderId,
        reason: 'hunt_waypoint_published',
        projectedAt: Date.now(),
        sourceOrderUpdatedAt: Date.now(),
        projectionVersion: projection?.projection_version || Date.now()
      }
    });
  });

  subscribeDomainEvent('HUNT_GPS_UPDATED', async (event) => {
    const projection = getTrackingProjection(event.payload.orderId || '');
    if (projection) {
      const session = await getHuntSessionById(event.payload.sessionId);
      upsertTrackingProjection({
        orderId: projection.order_id,
        publicToken: projection.public_token,
        huntStatus: mapSessionToHuntStatus(session) || projection.hunt_status,
        session: session || null,
        waypoints: projection.waypoint_rows,
        latestPing: event.payload.ping,
        track: [...projection.route_points, event.payload.ping],
        sourceUpdatedAt: event.payload.ping.ts
      });
    }
  });
};
