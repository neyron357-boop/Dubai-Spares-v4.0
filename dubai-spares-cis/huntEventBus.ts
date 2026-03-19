import { publishDomainEvent, subscribeDomainEvent } from './domainEvents';
import { HuntGpsPingRow, HuntSessionRow, HuntWaypointRow } from './types';

export type HuntTrackingEventName =
  | 'HUNT_STARTED'
  | 'HUNT_RESUMED'
  | 'HUNT_PAUSED'
  | 'HUNT_ENDED'
  | 'HUNT_GPS_PING_CAPTURED'
  | 'HUNT_GPS_PING_SYNCED'
  | 'HUNT_WAYPOINT_CREATE_REQUESTED'
  | 'HUNT_WAYPOINT_CREATED'
  | 'HUNT_WAYPOINT_UPDATED'
  | 'HUNT_WAYPOINT_MEDIA_UPLOADED'
  | 'HUNT_RESULT_CAPTURED'
  | 'HUNT_RESULT_PUBLISHED_TO_TRACKING'
  | 'TRACKING_PROJECTION_INVALIDATED'
  | 'TRACKING_PROJECTION_REFRESHED'
  | 'TRACKING_CLIENT_STATE_SYNCED'
  | 'TRACKING_LIVE_CHANNEL_CONNECTED'
  | 'TRACKING_LIVE_CHANNEL_DEGRADED'
  | 'TRACKING_LIVE_CHANNEL_RESTORED';

export type HuntTrackingEventPayload = {
  orderId: string;
  session?: HuntSessionRow | null;
  waypoint?: HuntWaypointRow | null;
  ping?: HuntGpsPingRow | null;
  reason?: string;
  projectionVersion?: number;
};

export const emitHuntTrackingEvent = async (type: HuntTrackingEventName, payload: HuntTrackingEventPayload) => {
  await publishDomainEvent('CUSTOMER_ACTIVITY_RECORDED', {
    entityType: 'customer_activity',
    entityId: `${type}:${payload.orderId}:${payload.projectionVersion || Date.now()}`,
    aggregateId: payload.orderId,
    dedupeKey: `hunt-tracking:${type}:${payload.orderId}:${payload.projectionVersion || 'na'}`,
    idempotencyKey: `hunt-tracking:${type}:${payload.orderId}:${payload.projectionVersion || 'na'}`,
    replaySafe: true,
    source: 'sync_coordinator',
    payload: {
      orderId: payload.orderId,
      activity: {
        id: `${type}:${payload.orderId}:${payload.projectionVersion || Date.now()}`,
        type: 'system',
        createdAt: Date.now(),
        message: type,
        metadata: payload
      } as any,
      notificationType: undefined
    }
  });
};

export const subscribeHuntDomainEvents = (handler: ReturnType<typeof subscribeDomainEvent>) => handler;
