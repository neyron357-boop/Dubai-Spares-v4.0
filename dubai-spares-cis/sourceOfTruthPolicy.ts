export interface SourceOfTruthPolicy {
  entity: string;
  primarySourceOfTruth: string;
  localCachePolicy: string;
  cloudSyncPolicy: string;
  publicProjectionPolicy: string;
  conflictResolutionPolicy: string;
}

export const SOURCE_OF_TRUTH_POLICIES: SourceOfTruthPolicy[] = [
  {
    entity: 'orders',
    primarySourceOfTruth: 'Normalized order graph in local order state with Supabase graph as remote replica.',
    localCachePolicy: 'Persist full order graph in IndexedDB for offline-first reads and optimistic writes.',
    cloudSyncPolicy: 'Mutation queue upserts/deletes, realtime or polling refreshes, and force refresh on reconnect.',
    publicProjectionPolicy: 'Feeds public quote snapshot, tracking payload, notifications, and settings-derived quote details.',
    conflictResolutionPolicy: 'Last updatedAt wins, with domain event versioning and queue dedupe keys preventing double-apply.'
  },
  {
    entity: 'parts',
    primarySourceOfTruth: 'Embedded inside the owning order aggregate.',
    localCachePolicy: 'Cached only through the parent order graph.',
    cloudSyncPolicy: 'Synced by order upsert patches instead of a separate transport path.',
    publicProjectionPolicy: 'Recomputes quote totals, media galleries, and tracking part cards.',
    conflictResolutionPolicy: 'Parent order version gates part merges; part IDs remain stable for replay safety.'
  },
  {
    entity: 'variants',
    primarySourceOfTruth: 'Embedded inside the owning part in the order aggregate.',
    localCachePolicy: 'Stored with order graph snapshots and hot-field patches.',
    cloudSyncPolicy: 'Batched through order mutation queue to avoid cross-module side effects.',
    publicProjectionPolicy: 'Updates public quote pricing, hunt result context, and customer notification decisions.',
    conflictResolutionPolicy: 'Variant ID + order aggregate version dedupe duplicate updates.'
  },
  {
    entity: 'hunt sessions',
    primarySourceOfTruth: 'Supabase session row when available, with localStorage fallback mirroring active state.',
    localCachePolicy: 'Persist latest known session locally for offline/public tracking fallback.',
    cloudSyncPolicy: 'Coordinator selects realtime/polling/fallback and writes through hunt event producers.',
    publicProjectionPolicy: 'Feeds tracking page live hunt state and telemetry diagnostics.',
    conflictResolutionPolicy: 'Latest started_at/status wins, session IDs are immutable.'
  },
  {
    entity: 'hunt waypoints',
    primarySourceOfTruth: 'Supabase waypoints table mirrored to localStorage.',
    localCachePolicy: 'Append-only local mirror keyed by session.',
    cloudSyncPolicy: 'Created once and merged idempotently from local and cloud sources.',
    publicProjectionPolicy: 'Tracking history and hunt public state derive from normalized waypoints.',
    conflictResolutionPolicy: 'Waypoint ID dedupe with append-only semantics.'
  },
  {
    entity: 'gps pings',
    primarySourceOfTruth: 'Supabase ping stream, best-effort only.',
    localCachePolicy: 'No heavy local history, just transient diagnostics.',
    cloudSyncPolicy: 'Fire-and-forget writes with coordinator fallback to pending state.',
    publicProjectionPolicy: 'Latest ping and track path drive live tracking projection.',
    conflictResolutionPolicy: 'Timestamp ordering; replay-safe because pings are immutable.'
  },
  {
    entity: 'public quote snapshots',
    primarySourceOfTruth: 'Projection model derived from orders + public settings.',
    localCachePolicy: 'No authoritative local snapshot; metadata kept in projection diagnostics.',
    cloudSyncPolicy: 'Projection dispatcher debounces refresh and upserts snapshot by token.',
    publicProjectionPolicy: 'Serves quote/tracking public pages directly.',
    conflictResolutionPolicy: 'projection_version + source_order_updated_at prevent stale refresh wins.'
  },
  {
    entity: 'app settings',
    primarySourceOfTruth: 'Local settings object mirrored to app_state cloud documents.',
    localCachePolicy: 'LocalStorage holds the active settings payload.',
    cloudSyncPolicy: 'Public and app settings documents are saved together and merged by updated timestamps.',
    publicProjectionPolicy: 'Dispatcher recomputes quote branding, CTAs, PDFs, and deep-link payloads.',
    conflictResolutionPolicy: 'Newest appSettingsUpdatedAt/publicContactsUpdatedAt wins.'
  },
  {
    entity: 'customer activity',
    primarySourceOfTruth: 'Normalized local domain log ready for future cloud projection.',
    localCachePolicy: 'Append-only localStorage log with order-scoped reads.',
    cloudSyncPolicy: 'Currently local-first, but events already carry stable IDs and sync-safe payloads.',
    publicProjectionPolicy: 'Feeds activity timeline, notification queue, and Telegram consumer state.',
    conflictResolutionPolicy: 'Activity IDs are immutable and deduped per append.'
  },
  {
    entity: 'telegram subscriptions',
    primarySourceOfTruth: 'Local subscription state keyed by order, later sync-capable via event stream.',
    localCachePolicy: 'Stored in localStorage and exposed through domain events.',
    cloudSyncPolicy: 'Consumers read from event queue instead of direct polling-only coupling.',
    publicProjectionPolicy: 'Deep links and notification queue payloads derive from normalized subscription state.',
    conflictResolutionPolicy: 'Order ID key with confirmedAt monotonic updates.'
  }
];
