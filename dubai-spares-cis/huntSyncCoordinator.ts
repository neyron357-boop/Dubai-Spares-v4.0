import { describeTrackingFreshness, resolveTrackingFreshnessState } from './trackingSyncState';
import { HuntOperatorSyncSnapshot, TrackingProjection } from './types';

export const deriveHuntSyncSnapshot = (projection: TrackingProjection | null, pendingWaypoints = 0): HuntOperatorSyncSnapshot => {
  const state = resolveTrackingFreshnessState({
    projectionUpdatedAt: projection?.projection_updated_at,
    lastLiveEventAt: projection?.last_live_event_at,
    lastPositionAt: projection?.last_position_at,
    liveChannelState: projection?.live_channel_state,
    hasPendingQueue: pendingWaypoints > 0
  });
  const description = describeTrackingFreshness(state);
  return {
    state,
    label: description.label,
    detail: description.detail,
    liveChannel: projection?.live_channel_state || (pendingWaypoints > 0 ? 'offline' : 'connected'),
    pendingWaypoints,
    lastSyncedAt: projection?.projection_updated_at || null,
    lastClientUpdateAt: projection?.last_client_safe_update_at || null
  };
};
