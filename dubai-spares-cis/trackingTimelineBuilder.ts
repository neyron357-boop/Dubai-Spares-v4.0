import { HuntSessionRow, HuntWaypointRow, TrackingProjection, TrackingTimelineItem, HuntGpsPingRow, HuntStatus } from './types';

const iso = (value?: string | null) => value || new Date().toISOString();
const timestamp = (value?: string | null) => Date.parse(value || '') || Date.now();

const waypointTypeMap: Record<HuntWaypointRow['result'], TrackingTimelineItem['type']> = {
  found: 'item_found',
  not_found: 'item_not_found',
  high_price: 'item_price_too_high',
  visited: 'operator_arrived',
  defect: 'item_defect_found'
};

const waypointBadgeMap: Record<HuntWaypointRow['result'], string> = {
  found: 'Found',
  not_found: 'Not found',
  high_price: 'High price',
  visited: 'Visited',
  defect: 'Defect'
};

export const buildTrackingTimeline = (params: {
  session: HuntSessionRow | null;
  waypoints: HuntWaypointRow[];
  latestPing: HuntGpsPingRow | null;
  huntStatus: HuntStatus;
}): TrackingTimelineItem[] => {
  const items: TrackingTimelineItem[] = [];
  const { session, waypoints, latestPing, huntStatus } = params;

  if (session?.started_at) {
    items.push({
      id: `hunt-started:${session.id}`,
      type: 'hunt_started',
      timestamp: session.started_at,
      title: 'Hunt started',
      client_safe_description: 'Our specialist started the search route and is syncing updates live.',
      status_badge: 'Live',
      display_order: timestamp(session.started_at),
      delivery_state: 'published'
    });
  }

  if (latestPing?.ts) {
    items.push({
      id: `operator-way:${latestPing.id}`,
      type: 'operator_on_the_way',
      timestamp: latestPing.ts,
      title: 'Operator on the way',
      client_safe_description: 'Current location was refreshed from the live tracking route.',
      status_badge: 'Moving',
      display_order: timestamp(latestPing.ts),
      delivery_state: 'published'
    });
  }

  waypoints.forEach((waypoint, index) => {
    items.push({
      id: `waypoint:${waypoint.id}`,
      type: waypointTypeMap[waypoint.result],
      timestamp: waypoint.created_at,
      title: waypoint.shop_name || 'Shop update',
      client_safe_description: waypoint.note || `Inspection result: ${waypointBadgeMap[waypoint.result].toLowerCase()}.`,
      shop_label: waypoint.shop_name,
      price_optional: waypoint.price_aed ?? null,
      media_optional: waypoint.photo_urls,
      status_badge: waypointBadgeMap[waypoint.result],
      display_order: timestamp(waypoint.created_at) + index,
      delivery_state: 'published'
    });

    if ((waypoint.photo_urls || []).length > 0) {
      items.push({
        id: `waypoint-photos:${waypoint.id}`,
        type: 'photos_added',
        timestamp: waypoint.created_at,
        title: 'Photos added',
        client_safe_description: 'Fresh media from the inspection point is available.',
        shop_label: waypoint.shop_name,
        media_optional: waypoint.photo_urls,
        status_badge: 'Photos',
        display_order: timestamp(waypoint.created_at) + index + 0.1,
        delivery_state: 'published'
      });
    }
  });

  if (huntStatus === 'final_offer') {
    const finishedAt = session?.ended_at || waypoints[waypoints.length - 1]?.created_at || latestPing?.ts || new Date().toISOString();
    items.push({
      id: `hunt-finished:${session?.id || 'order'}`,
      type: 'hunt_finished',
      timestamp: iso(finishedAt),
      title: 'Hunt finished',
      client_safe_description: 'The search stage is complete and the final offer is being prepared.',
      status_badge: 'Finished',
      display_order: timestamp(finishedAt),
      delivery_state: 'published'
    });
    items.push({
      id: `final-offer:${session?.id || 'order'}`,
      type: 'final_offer_ready',
      timestamp: iso(finishedAt),
      title: 'Final offer ready',
      client_safe_description: 'Pricing and findings are ready for customer review.',
      status_badge: 'Offer',
      display_order: timestamp(finishedAt) + 1,
      delivery_state: 'published'
    });
  } else if (waypoints.length > 0) {
    const lastWaypoint = waypoints[waypoints.length - 1];
    items.push({
      id: `published:${lastWaypoint.id}`,
      type: 'published_to_client',
      timestamp: lastWaypoint.created_at,
      title: 'Published to client',
      client_safe_description: 'Tracking projection has been refreshed for the customer.',
      status_badge: 'Published',
      display_order: timestamp(lastWaypoint.created_at) + 2,
      delivery_state: 'published'
    });
  }

  return items.sort((a, b) => a.display_order - b.display_order);
};

export const buildTrackingPhase = (huntStatus: HuntStatus): TrackingProjection['tracking_phase'] => {
  if (huntStatus === 'live_hunt') return 'live_hunt';
  if (huntStatus === 'final_offer') return 'final_offer';
  return 'awaiting_hunt';
};
