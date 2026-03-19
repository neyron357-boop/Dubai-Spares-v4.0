import { subscribeDomainEvent, publishDomainEvent } from './domainEvents';
import { getHuntSessionById, getHuntWaypoints, getLatestGpsPing, getGpsTrack } from './huntSessionApi';
import { scheduleLivePublicQuoteSync } from './publicQuoteSync';
import { getTrackingProjection, upsertTrackingProjection } from './trackingProjectionStore';

let installed = false;

const refreshProjection = async (orderId: string, sessionId: string, reason: string, publicToken = '') => {
  const [session, waypoints, latestPing, track] = await Promise.all([
    getHuntSessionById(sessionId),
    getHuntWaypoints(sessionId),
    getLatestGpsPing(sessionId),
    getGpsTrack(sessionId)
  ]);
  const huntStatus = session?.status === 'active' ? 'live_hunt' : 'final_offer';
  const projection = upsertTrackingProjection({
    orderId,
    publicToken,
    huntStatus,
    session,
    waypoints,
    latestPing,
    track,
    sourceUpdatedAt: latestPing?.ts || waypoints[waypoints.length - 1]?.created_at || session?.started_at || null
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

  subscribeDomainEvent('HUNT_WAYPOINT_ADDED', async (event) => {
    const projection = await refreshProjection(event.payload.orderId, event.payload.sessionId, 'waypoint_added');
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
      upsertTrackingProjection({
        orderId: projection.order_id,
        publicToken: projection.public_token,
        huntStatus: projection.hunt_status,
        session: null as any,
        waypoints: projection.waypoint_rows,
        latestPing: event.payload.ping,
        track: [...projection.route_points, event.payload.ping],
        sourceUpdatedAt: event.payload.ping.ts
      });
    }
  });
};
