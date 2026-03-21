# Dubai Spares CIS

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

This project now uses one reusable internal AI gateway in the Express API server at `api/ai/*` and exposes a single internal endpoint at `POST /ai/tasks`.

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

Server environment variables:

- `OPENROUTER_API_KEY` (required)
- `OPENROUTER_MODEL` (optional, defaults to `openrouter/free`)

Future task changes should be made only in these files:

- `api/ai/constants.js` for the supported task list
- `api/ai/validation.js` for payload validation
- `api/ai/prompts.js` for prompt templates
- `api/ai/taskRouter.js` for output normalization

Current frontend usage goes through `utils/aiCore.ts`, which calls the internal gateway rather than talking to the provider directly.
