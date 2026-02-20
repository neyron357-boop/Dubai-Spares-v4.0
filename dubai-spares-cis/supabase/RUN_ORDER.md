## Supabase SQL editor run order

### Fresh project (new Supabase instance / key change)

1. Copy `.env.example` → `.env` and fill in the **new** project URL and anon key.
   - The anon key must start with `eyJ…` (JWT). Keys starting with `sb_publishable_…` are **invalid** and will cause 401 errors.
2. Open the Supabase project SQL Editor.
3. Run **`supabase/migrations/20260409130000_master_idempotent_setup.sql`** — single, self-contained, safe for repeated runs.

### Updating an existing project

Run only the newest migration file you haven't applied yet (ordered by timestamp).
Fallback: run `supabase/idempotent_normalize_all_tables.sql` — it is always safe to re-run.

## Verify after migration

- Tables: `orders`, `parts`, `price_variants`, `shops`, `push_subscriptions`, `public_quote_snapshots`, `client_leads`, `backups`, `backups_meta`, `app_state`, `app_config`.
- RPC: `public.refresh_schema_cache()` is callable by `anon` and `authenticated`.
- Buckets: `images` (public), `backups`, `public-quote`, `client-form`.

## Smoke checks (anon key)

- Insert one row into `public_quote_snapshots`.
- Insert one row into `client_leads`.
- Fetch `orders` with `select=id,brand,model,created_at`.
- Open a generated public quote URL that uses hash route: `/#/q/<slug>?token=<token>`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Public quote 404 / blank | Old anon key in `.env` | Replace with new project's `eyJ…` key |
| Photos stay `local://` | `isCloudConfigured = false` | Check URL + key in `.env` |
| Policy already exists error | Migration not idempotent | Use `20260409130000_master_idempotent_setup.sql` |
| storage.objects permission denied | Insufficient role | The DO block skips this — grant manually as project owner |
