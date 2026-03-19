# Hunt / Tracking reactive architecture

## Source of truth

- **Hunt operator live state**: active hunt session + synced waypoint/GPS events, with local waypoint mirror as fallback.
- **Client tracking live state**: normalized `TrackingProjection` assembled once and consumed by the public screen.
- **Freshness state**: derived from `projection_updated_at`, `last_live_event_at`, `last_position_at`, and live channel status.

## Event flow

1. Operator action emits a hunt domain mutation.
2. Hunt API persists session / waypoint / GPS data.
3. Domain events fan into `huntProjectionDispatcher.ts`.
4. Dispatcher rebuilds tracking projection and invalidates downstream public quote sync.
5. Tracking UI consumes the normalized projection through `trackingLiveCoordinator.ts` + `trackingProjectionStore.ts`.

## Projection flow

- `trackingProjectionReader.ts` reads hunt data once.
- `trackingTimelineBuilder.ts` converts normalized hunt entities into client-safe premium timeline items.
- `trackingProjectionStore.ts` keeps the latest projection version, route, waypoint summary, and freshness state.

## Sync strategy

- Prefer realtime channel updates.
- Fall back to visibility-aware polling.
- Deduplicate noisy GPS samples before insert.
- Surface sync health as `live`, `syncing`, `projection_pending`, `delayed`, `degraded_live`, or `offline_buffering`.
