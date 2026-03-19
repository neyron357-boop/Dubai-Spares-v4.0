import { createHuntSession, endHuntSession, sendGpsPing, addHuntWaypoint, updateHuntSessionStatus, type AddWaypointPayload } from './huntSessionApi';
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

export const createWaypoint = async (payload: AddWaypointPayload) => addHuntWaypoint(payload);



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
