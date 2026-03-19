import { createHuntSession, endHuntSession, sendGpsPing, addHuntWaypoint, getGpsTrack, getHuntWaypoints, getLatestGpsPing, getLatestHuntSession, updateHuntSessionStatus, type AddWaypointPayload } from './huntSessionApi';
import { publishDomainEvent } from './domainEvents';
import { getOrderState } from './orderStore';
import { createTrackingProjection, upsertTrackingProjection } from './trackingProjectionStore';
import type { HuntSessionStatus, Order, TrackingProjection } from './types';



const mapSessionStatusToOrderHuntStatus = (status: HuntSessionStatus | undefined): Order['huntStatus'] => {
  if (status === 'completed') return 'final_offer';
  if (status === 'active' || status === 'paused') return 'live_hunt';
  return 'data_gathering';
};

export const getOrder = async (orderId: string): Promise<Order> => {
  const order = getOrderState().orders.find((item) => item.id === orderId);
  if (!order) throw new Error(`Order not found: ${orderId}`);
  return order;
};

export const getHuntData = async (orderId: string) => {
  const session = await getLatestHuntSession(orderId);
  if (!session) {
    return {
      session: null,
      waypoints: [],
      latestPing: null,
      track: [],
      resolvedStatus: 'data_gathering' as const
    };
  }

  const [waypoints, latestPing, track] = await Promise.all([
    getHuntWaypoints(session.id),
    getLatestGpsPing(session.id),
    getGpsTrack(session.id)
  ]);

  return {
    session,
    waypoints,
    latestPing,
    track,
    resolvedStatus: mapSessionStatusToOrderHuntStatus(session.status)
  };
};

export const buildTrackingProjection = (order: Order, huntData: Awaited<ReturnType<typeof getHuntData>>): TrackingProjection => createTrackingProjection({
  orderId: order.id,
  publicToken: order.publicQuoteToken || '',
  huntStatus: huntData.resolvedStatus || order.huntStatus || 'data_gathering',
  session: huntData.session,
  waypoints: huntData.waypoints,
  latestPing: huntData.latestPing,
  track: huntData.track,
  sourceUpdatedAt: huntData.latestPing?.ts || huntData.waypoints[huntData.waypoints.length - 1]?.created_at || huntData.session?.started_at || null
});

export const upsertPublicTracking = async (orderId: string, projection: TrackingProjection) => {
  upsertTrackingProjection({
    orderId,
    publicToken: projection.public_token,
    huntStatus: projection.hunt_status,
    session: projection.operator_presence_state === 'idle' && projection.waypoint_rows.length === 0 ? null : {
      id: projection.timeline_items.find((item) => item.type === 'hunt_started')?.id || `projection:${orderId}`,
      order_id: orderId,
      status: projection.operator_presence_state === 'paused' ? 'paused' : projection.hunt_status === 'final_offer' ? 'completed' : projection.hunt_status === 'live_hunt' ? 'active' : 'idle',
      started_at: projection.source_updated_at || projection.projection_updated_at,
      ended_at: projection.hunt_status === 'final_offer' ? projection.source_updated_at || projection.projection_updated_at : null
    },
    waypoints: projection.waypoint_rows,
    latestPing: projection.latest_operator_position,
    track: projection.route_points,
    projectionVersion: projection.projection_version,
    sourceUpdatedAt: projection.source_updated_at
  });
  await publishDomainEvent('PUBLIC_QUOTE_REFRESH_REQUIRED', {
    entityType: 'public_quote',
    entityId: projection.public_token || orderId,
    aggregateId: orderId,
    dedupeKey: `tracking-update:${orderId}:${projection.projection_version}`,
    idempotencyKey: `tracking-update:${orderId}:${projection.projection_version}`,
    replaySafe: true,
    source: 'ui',
    payload: {
      order: { id: orderId, publicQuoteToken: projection.public_token } as any,
      reason: 'tracking_projection_refreshed',
      sourceOrderUpdatedAt: Date.now(),
      projectionVersion: projection.projection_version
    }
  });
};

export async function triggerTrackingUpdate(orderId: string) {
  const order = await getOrder(orderId);
  const huntData = await getHuntData(orderId);
  const projection = buildTrackingProjection(order, huntData);
  await upsertPublicTracking(orderId, projection);
}

export const updateHuntStatus = async (orderId: string, status: HuntSessionStatus) => {
  const nextOrderStatus = mapSessionStatusToOrderHuntStatus(status);
  await publishDomainEvent('ORDER_HUNT_STATUS_CHANGED', {
    entityType: 'order',
    entityId: orderId,
    aggregateId: orderId,
    dedupeKey: `hunt-status:${orderId}:${status}:${Date.now()}`,
    idempotencyKey: `hunt-status:${orderId}:${status}`,
    replaySafe: true,
    source: 'ui',
    payload: { order: { id: orderId, huntStatus: nextOrderStatus } as any, nextHuntStatus: nextOrderStatus }
  });
  return nextOrderStatus;
};

export const resetHuntSession = async (orderId: string) => {
  upsertTrackingProjection({
    orderId,
    publicToken: getOrderState().orders.find((item) => item.id === orderId)?.publicQuoteToken || '',
    huntStatus: 'data_gathering',
    session: null,
    waypoints: [],
    latestPing: null,
    track: [],
    sourceUpdatedAt: null
  });
};

export const startHunt = async (orderId: string) => {
  const session = await createHuntSession(orderId);
  await publishDomainEvent('ORDER_HUNT_STATUS_CHANGED', {
    entityType: 'order',
    entityId: orderId,
    aggregateId: orderId,
    dedupeKey: `hunt-start:${orderId}:${session.id}`,
    idempotencyKey: `hunt-start:${orderId}:${session.id}`,
    replaySafe: true,
    source: 'ui',
    payload: { order: { id: orderId, huntStatus: 'live_hunt' } as any, previousHuntStatus: 'data_gathering', nextHuntStatus: 'live_hunt' }
  });
  return session;
};

export const finishHunt = async (orderId: string, sessionId: string) => {
  await endHuntSession(sessionId, orderId);
  await publishDomainEvent('ORDER_HUNT_STATUS_CHANGED', {
    entityType: 'order',
    entityId: orderId,
    aggregateId: orderId,
    dedupeKey: `hunt-end:${orderId}:${sessionId}`,
    idempotencyKey: `hunt-end:${orderId}:${sessionId}`,
    replaySafe: true,
    source: 'ui',
    payload: { order: { id: orderId, huntStatus: 'final_offer' } as any, previousHuntStatus: 'live_hunt', nextHuntStatus: 'final_offer' }
  });
};

export const syncGpsPing = async (orderId: string, sessionId: string, lat: number, lng: number, accuracyM?: number) => {
  await publishDomainEvent('HUNT_GPS_UPDATED', {
    entityType: 'gps_ping',
    entityId: `${sessionId}:${Date.now()}`,
    aggregateId: orderId,
    dedupeKey: `gps-captured:${sessionId}:${Date.now()}`,
    idempotencyKey: `gps-captured:${sessionId}:${Date.now()}`,
    replaySafe: true,
    source: 'ui',
    payload: { orderId, sessionId, ping: { id: `gps-local-${Date.now()}`, session_id: sessionId, lat, lng, accuracy_m: accuracyM ?? null, ts: new Date().toISOString() } }
  });
  await sendGpsPing(sessionId, lat, lng, accuracyM);
};

export const createWaypoint = async (payload: AddWaypointPayload) => {
  const waypoint = await addHuntWaypoint(payload);
  await triggerTrackingUpdate(payload.orderId);
  return waypoint;
};



export const pauseHunt = async (orderId: string, sessionId: string) => {
  const session = await updateHuntSessionStatus(sessionId, orderId, 'paused');
  await publishDomainEvent('ORDER_HUNT_STATUS_CHANGED', {
    entityType: 'order',
    entityId: orderId,
    aggregateId: orderId,
    dedupeKey: `hunt-paused:${orderId}:${sessionId}`,
    idempotencyKey: `hunt-paused:${orderId}:${sessionId}`,
    replaySafe: true,
    source: 'ui',
    payload: { order: { id: orderId, huntStatus: 'live_hunt' } as any, previousHuntStatus: 'live_hunt', nextHuntStatus: 'live_hunt' }
  });
  await publishDomainEvent('HUNT_SESSION_STATUS_CHANGED', {
    entityType: 'hunt_session',
    entityId: sessionId,
    aggregateId: orderId,
    dedupeKey: `hunt-session-paused:${sessionId}`,
    idempotencyKey: `hunt-session-paused:${sessionId}`,
    replaySafe: true,
    source: 'ui',
    payload: { orderId, sessionId, session }
  });
  return session;
};

export const resumeHunt = async (orderId: string, sessionId: string) => {
  const session = await updateHuntSessionStatus(sessionId, orderId, 'active');
  await publishDomainEvent('ORDER_HUNT_STATUS_CHANGED', {
    entityType: 'order',
    entityId: orderId,
    aggregateId: orderId,
    dedupeKey: `hunt-resumed:${orderId}:${sessionId}`,
    idempotencyKey: `hunt-resumed:${orderId}:${sessionId}`,
    replaySafe: true,
    source: 'ui',
    payload: { order: { id: orderId, huntStatus: 'live_hunt' } as any, previousHuntStatus: 'live_hunt', nextHuntStatus: 'live_hunt' }
  });
  await publishDomainEvent('HUNT_SESSION_STATUS_CHANGED', {
    entityType: 'hunt_session',
    entityId: sessionId,
    aggregateId: orderId,
    dedupeKey: `hunt-session-resumed:${sessionId}`,
    idempotencyKey: `hunt-session-resumed:${sessionId}`,
    replaySafe: true,
    source: 'ui',
    payload: { orderId, sessionId, session }
  });
  return session;
};
