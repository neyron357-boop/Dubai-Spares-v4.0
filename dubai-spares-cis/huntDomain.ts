import { createHuntSession, endHuntSession, sendGpsPing, addHuntWaypoint, type AddWaypointPayload } from './huntSessionApi';
import { publishDomainEvent } from './domainEvents';

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
  await publishDomainEvent('HUNT_WAYPOINT_ADDED', {
    entityType: 'hunt_waypoint',
    entityId: `pending:${Date.now()}`,
    aggregateId: payload.orderId,
    dedupeKey: `waypoint-request:${payload.orderId}:${Date.now()}`,
    idempotencyKey: `waypoint-request:${payload.orderId}:${Date.now()}`,
    replaySafe: true,
    source: 'ui',
    payload: {
      orderId: payload.orderId,
      sessionId: payload.sessionId,
      waypoint: {
        id: `pending:${Date.now()}`,
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
      }
    }
  });
  return addHuntWaypoint(payload);
};
