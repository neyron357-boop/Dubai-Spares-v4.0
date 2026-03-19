import { getPublicHuntData } from './huntSessionApi';
import { Order, TrackingProjection } from './types';
import { upsertTrackingProjection } from './trackingProjectionStore';

export const readTrackingProjection = async (order: Pick<Order, 'id' | 'huntStatus' | 'publicQuoteToken'>): Promise<TrackingProjection> => {
  const huntData = await getPublicHuntData(order.id);
  return upsertTrackingProjection({
    orderId: order.id,
    publicToken: order.publicQuoteToken || '',
    huntStatus: huntData.resolvedStatus || order.huntStatus || 'data_gathering',
    session: huntData.session,
    waypoints: huntData.waypoints,
    latestPing: huntData.latestPing,
    track: huntData.track,
    sourceUpdatedAt: huntData.latestPing?.ts || huntData.waypoints[huntData.waypoints.length - 1]?.created_at || huntData.session?.started_at || null
  })!;
};
