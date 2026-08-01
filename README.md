# Stark Motors

## Lead diagnostics and recovery

When debugging public lead creation (`client_leads`), use these built-in tools:

- `runCloudDiagnostics()` from `utils/cloudDiagnostics.ts` to check env/config/features and migration visibility.
- `window.testSupabaseConnection()` from `utils/testSupabaseConnection.ts` for a direct POST probe.
- **Settings → Local mode → Test Connection** to run a manual cloud check.
- Browser console logs with `[leadCreate]` prefix for full request/response flow.

### What is validated

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` presence and format.
- Feature flags (`cloudFeatureFlags.clientForm`).
- REST headers (`apikey`, `Authorization`, `Content-Type`).
- Supabase migration accessibility for `public.client_leads`.

### Offline fallback

If lead creation fails, the form stores the order locally with `leadSyncPending=true`, shows a warning notification, and queues lead payload for auto-retry on `online` event.


## Universal internal AI core

This project now uses one reusable frontend AI client in `utils/aiCore.ts` that sends every AI request directly to the Supabase Edge Function endpoint: `https://nbnfaxsvdlcdycnuzieu.supabase.co/functions/v1/super-service`.

Request contract:

```json
{
  "task": "analyze_text | transform_text | extract_structured_data",
  "payload": { "...": "..." }
}
```

Response contract:

```json
{
  "ok": true,
  "task": "analyze_text",
  "result": { "...": "..." },
  "error": null
}
```

Current frontend usage goes through `utils/aiCore.ts`, which is the single source of truth for AI requests and keeps the request/response contract stable for the app.

Supported tasks:

- `analyze_text`
- `transform_text`
- `extract_structured_data`
