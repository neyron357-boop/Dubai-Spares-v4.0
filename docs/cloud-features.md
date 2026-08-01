# Cloud features (local-first whitelist)

Cloud calls are allowed only for:

- `backupUpload` / `backupRestore`
- `publicQuoteCreate` / `publicQuoteGetByToken`
- `leadCreate`

Flags are in `localMode.ts`:

- `CLOUD_FEATURES.BACKUP`
- `CLOUD_FEATURES.PUBLIC_QUOTE`
- `CLOUD_FEATURES.CLIENT_FORM`

Set any of them to `false` to hard-disable that action. The API returns:

`Cloud feature disabled by local mode settings`

## Env used by Vite

Set and rebuild app:

```env
VITE_SUPABASE_URL=https://jntgicfiehdprwhtjbuf.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_ZwcvMV3ccFi0xVapLOorsw_6wLL_9SC
```

`cloudConfig.ts` reads exactly these vars and `serverApi.ts` uses them for all network calls.

## Where to verify in Supabase

- Backups: `public.backups`
- Public quote snapshots: `public.public_quote_snapshots`
- Leads: `public.client_leads`
- Storage buckets: `backups`, `quotes`, `leads`
