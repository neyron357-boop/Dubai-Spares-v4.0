import { supabase } from './supabase';
import { Order } from './types';
import { readTrackingProjection } from './trackingProjectionReader';
import { upsertTrackingProjection } from './trackingProjectionStore';

export const createTrackingLiveCoordinator = (order: Pick<Order, 'id' | 'huntStatus' | 'publicQuoteToken'>, onRefresh?: () => void) => {
  let disposed = false;
  let pollId: number | null = null;
  let visibilityHandler: (() => void) | null = null;
  let channel: any = null;

  const refresh = async (liveChannelState: 'connected' | 'degraded' | 'reconnecting' | 'offline' = 'connected') => {
    const projection = await readTrackingProjection(order);
    upsertTrackingProjection({
      orderId: projection.order_id,
      publicToken: projection.public_token,
      huntStatus: projection.hunt_status,
      session: null as any,
      waypoints: projection.waypoint_rows,
      latestPing: projection.latest_operator_position,
      track: projection.route_points,
      liveChannelState,
      projectionVersion: projection.projection_version,
      sourceUpdatedAt: projection.source_updated_at
    });
    onRefresh?.();
  };

  void refresh();

  const interval = order.huntStatus === 'live_hunt' ? 12_000 : order.huntStatus === 'final_offer' ? 25_000 : 10_000;
  pollId = window.setInterval(() => {
    if (document.visibilityState === 'hidden' || disposed) return;
    void refresh('degraded');
  }, interval);

  visibilityHandler = () => {
    if (document.visibilityState === 'visible' && !disposed) void refresh();
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  if (supabase) {
    channel = supabase
      .channel(`tracking-live:${order.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${order.id}` }, () => void refresh('connected'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_hunt_sessions', filter: `order_id=eq.${order.id}` }, () => void refresh('connected'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_hunt_waypoints', filter: `order_id=eq.${order.id}` }, () => void refresh('connected'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_hunt_gps_pings' }, () => void refresh('connected'))
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') return;
        void refresh(status === 'CHANNEL_ERROR' ? 'offline' : 'reconnecting');
      });
  }

  return () => {
    disposed = true;
    if (pollId) window.clearInterval(pollId);
    if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
    if (channel && supabase) void supabase.removeChannel(channel);
  };
};
