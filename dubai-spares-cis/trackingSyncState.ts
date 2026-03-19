import { TrackingFreshnessState } from './types';

const asMs = (value: string | number | null | undefined) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
};

export const resolveTrackingFreshnessState = (input: {
  projectionUpdatedAt?: string | null;
  lastLiveEventAt?: string | null;
  lastPositionAt?: string | null;
  liveChannelState?: 'connected' | 'degraded' | 'reconnecting' | 'offline';
  hasPendingQueue?: boolean;
}): TrackingFreshnessState => {
  const now = Date.now();
  const lastProjection = asMs(input.projectionUpdatedAt);
  const lastEvent = Math.max(lastProjection, asMs(input.lastLiveEventAt));
  const lastPosition = asMs(input.lastPositionAt);
  const lag = now - Math.max(lastEvent, lastPosition || 0);

  if (input.hasPendingQueue) return 'offline_buffering';
  if (input.liveChannelState === 'reconnecting') return 'reconnecting';
  if (input.liveChannelState === 'offline') return 'degraded_live';
  if (input.liveChannelState === 'degraded') return lag > 90_000 ? 'delayed' : 'degraded_live';
  if (lag <= 20_000) return 'live';
  if (lag <= 45_000) return 'syncing';
  if (lag <= 90_000) return 'projection_pending';
  if (lag <= 180_000) return 'delayed';
  return 'stale';
};

export const describeTrackingFreshness = (state: TrackingFreshnessState) => {
  switch (state) {
    case 'live': return { label: 'Live connected', detail: 'Realtime pipeline is healthy.' };
    case 'syncing': return { label: 'Syncing', detail: 'New hunt events are being applied.' };
    case 'projection_pending': return { label: 'Projection updating', detail: 'Client projection is refreshing.' };
    case 'delayed': return { label: 'Delayed', detail: 'Updates are still flowing, but slower than expected.' };
    case 'offline_buffering': return { label: 'Offline buffering', detail: 'Events are queued locally and will publish when the network returns.' };
    case 'degraded_live': return { label: 'Degraded live mode', detail: 'Fallback transport is active.' };
    case 'reconnecting': return { label: 'Reconnecting', detail: 'Live channel is reconnecting.' };
    case 'restored': return { label: 'Restored', detail: 'Live updates have recovered.' };
    case 'stale':
    default:
      return { label: 'Delayed', detail: 'Waiting for a fresh live update.' };
  }
};
