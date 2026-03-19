import type { AppSettings } from './appSettings';
import type { CustomerActivityLogEntry, NotificationEventType, TelegramSubscriptionState } from './customerEngagement';
import type { HuntGpsPingRow, HuntSessionRow, HuntWaypointRow, Order, Part, PriceVariant } from './types';

export type DomainEventName =
  | 'LEAD_CREATED'
  | 'LEAD_SYNCED'
  | 'ORDER_CREATED'
  | 'ORDER_UPDATED'
  | 'ORDER_DELETED'
  | 'ORDER_STATUS_CHANGED'
  | 'ORDER_LOGISTICS_CHANGED'
  | 'ORDER_PRICING_CHANGED'
  | 'ORDER_HUNT_STATUS_CHANGED'
  | 'PART_CREATED'
  | 'PART_UPDATED'
  | 'PART_DELETED'
  | 'VARIANT_CREATED'
  | 'VARIANT_UPDATED'
  | 'VARIANT_DELETED'
  | 'PUBLIC_QUOTE_REFRESH_REQUIRED'
  | 'PUBLIC_QUOTE_REFRESHED'
  | 'HUNT_SESSION_STARTED'
  | 'HUNT_SESSION_ENDED'
  | 'HUNT_WAYPOINT_ADDED'
  | 'HUNT_GPS_UPDATED'
  | 'SETTINGS_PUBLIC_CHANGED'
  | 'TELEGRAM_SUBSCRIPTION_LINKED'
  | 'CUSTOMER_ACTIVITY_RECORDED';

export type DomainEntityType =
  | 'lead'
  | 'order'
  | 'part'
  | 'variant'
  | 'public_quote'
  | 'hunt_session'
  | 'hunt_waypoint'
  | 'gps_ping'
  | 'settings'
  | 'telegram_subscription'
  | 'customer_activity';

export interface DomainEventEnvelope<TName extends DomainEventName = DomainEventName, TPayload = unknown> {
  id: string;
  type: TName;
  entityType: DomainEntityType;
  entityId: string;
  aggregateId: string;
  occurredAt: number;
  version: number;
  dedupeKey: string;
  idempotencyKey: string;
  replaySafe: boolean;
  source: 'ui' | 'local_cache' | 'cloud' | 'realtime' | 'offline_queue' | 'sync_coordinator' | 'system';
  payload: TPayload;
}

type EventPayloadMap = {
  LEAD_CREATED: { order: Order };
  LEAD_SYNCED: { orderIds: string[]; total: number };
  ORDER_CREATED: { order: Order };
  ORDER_UPDATED: { order: Order; previousOrder?: Order; changedFields?: string[] };
  ORDER_DELETED: { orderId: string; previousOrder?: Order };
  ORDER_STATUS_CHANGED: { order: Order; previousStatus?: string; nextStatus?: string };
  ORDER_LOGISTICS_CHANGED: { order: Order; previousLogistics?: Order['logistics']; nextLogistics?: Order['logistics'] };
  ORDER_PRICING_CHANGED: { order: Order; previousPricingEvents?: Order['pricingEvents']; nextPricingEvents?: Order['pricingEvents'] };
  ORDER_HUNT_STATUS_CHANGED: { order: Order; previousHuntStatus?: Order['huntStatus']; nextHuntStatus?: Order['huntStatus'] };
  PART_CREATED: { order: Order; part: Part };
  PART_UPDATED: { order: Order; part: Part; previousPart?: Part };
  PART_DELETED: { orderId: string; partId: string; previousPart?: Part };
  VARIANT_CREATED: { order: Order; partId: string; variant: PriceVariant };
  VARIANT_UPDATED: { order: Order; partId: string; variant: PriceVariant; previousVariant?: PriceVariant };
  VARIANT_DELETED: { orderId: string; partId: string; variantId: string; previousVariant?: PriceVariant };
  PUBLIC_QUOTE_REFRESH_REQUIRED: { order: Order; reason: string; sourceOrderUpdatedAt: number; projectionVersion: number };
  PUBLIC_QUOTE_REFRESHED: { orderId: string; reason: string; projectedAt: number; sourceOrderUpdatedAt: number; projectionVersion: number };
  HUNT_SESSION_STARTED: { orderId: string; session: HuntSessionRow };
  HUNT_SESSION_ENDED: { orderId: string; sessionId: string; endedAt: string };
  HUNT_WAYPOINT_ADDED: { orderId: string; sessionId: string; waypoint: HuntWaypointRow };
  HUNT_GPS_UPDATED: { orderId?: string; sessionId: string; ping: HuntGpsPingRow };
  SETTINGS_PUBLIC_CHANGED: { settings: AppSettings; changedKeys: Array<keyof AppSettings> };
  TELEGRAM_SUBSCRIPTION_LINKED: { orderId: string; subscription: TelegramSubscriptionState };
  CUSTOMER_ACTIVITY_RECORDED: { orderId: string; activity: CustomerActivityLogEntry; notificationType?: NotificationEventType };
};

export type DomainEvent<TName extends DomainEventName> = DomainEventEnvelope<TName, EventPayloadMap[TName]>;
type DomainEventHandler<TName extends DomainEventName = DomainEventName> = (event: DomainEvent<TName>) => void | Promise<void>;

const listeners = new Map<DomainEventName | '*', Set<DomainEventHandler>>();
const eventVersions = new Map<string, number>();
const appliedEventIds = new Set<string>();
const uid = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const nextEventVersion = (aggregateId: string) => {
  const next = (eventVersions.get(aggregateId) || 0) + 1;
  eventVersions.set(aggregateId, next);
  return next;
};

export const publishDomainEvent = async <TName extends DomainEventName>(
  type: TName,
  config: Omit<DomainEvent<TName>, 'id' | 'type' | 'occurredAt' | 'version'> & { version?: number }
): Promise<DomainEvent<TName>> => {
  const version = config.version ?? nextEventVersion(config.aggregateId);
  const event: DomainEvent<TName> = {
    ...config,
    id: uid(),
    type,
    occurredAt: Date.now(),
    version
  };

  if (appliedEventIds.has(event.id)) return event;
  appliedEventIds.add(event.id);

  const handlers = [
    ...(listeners.get(type) || []),
    ...(listeners.get('*') || [])
  ];

  for (const handler of handlers) {
    await handler(event as DomainEvent<DomainEventName>);
  }

  window.dispatchEvent(new CustomEvent('domain-event', { detail: event }));
  return event;
};

export const subscribeDomainEvent = <TName extends DomainEventName>(type: TName | '*', handler: DomainEventHandler<TName>) => {
  const bucket = listeners.get(type) || new Set<DomainEventHandler>();
  bucket.add(handler as DomainEventHandler);
  listeners.set(type, bucket);
  return () => {
    bucket.delete(handler as DomainEventHandler);
    if (bucket.size === 0) listeners.delete(type);
  };
};
