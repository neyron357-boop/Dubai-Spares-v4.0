## Supabase SQL editor run order

### Fresh project (new Supabase instance / key change)

1. Copy `.env.example` → `.env` and fill in the **new** project URL and anon key.
   - The anon key must start with `eyJ…` (JWT). Keys starting with `sb_publishable_…` are **invalid** and will cause 401 errors.
2. Open the Supabase project SQL Editor.
3. Run **`supabase/migrations/20260409130000_master_idempotent_setup.sql`** — single, self-contained, safe for repeated runs.

### Updating an existing project

Run only the newest migration file you haven't applied yet (ordered by timestamp).
Fallback: run `supabase/idempotent_normalize_all_tables.sql` — it is always safe to re-run.

> **If public quotes are blank or suppliers don't sync to the server**, also run
> `supabase/migrations/20260410120000_fix_shops_columns_and_quote_rls.sql`.
> It adds missing `public.shops` columns and restores the correct `anon` UPDATE
> policy on `public.public_quote_snapshots`.

> **If Suppliers DB misses shops that exist in `public.shops` (inactive/status rows hidden)**, also run
> `supabase/migrations/20260626100000_normalize_shops_visibility_and_suppliers_view.sql`.
> It removes legacy status-based RLS filters and rebuilds `v_shops_enriched` to expose all shops rows.

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
| Public quote 404 / blank | Wrong anon key format in `.env` | Replace with new project's `eyJ…` JWT key (from Supabase dashboard → Project Settings → API) |
| Public quote shows "Not found" even for valid links | `quote_select_anon` / `quote_update_anon` policy missing or wrong role | Run `20260410120000_fix_shops_columns_and_quote_rls.sql` |
| Suppliers don't save to server | `public.shops` table missing new columns (`location`, `shop_type`, etc.) | Run `20260410120000_fix_shops_columns_and_quote_rls.sql` |
| Supplier cards show only part of shops list | Legacy shops RLS/view filters by `is_active`/status | Run `20260626100000_normalize_shops_visibility_and_suppliers_view.sql` |
| Photos stay `local://` | `isCloudConfigured = false` | Check URL + key in `.env` |
| Policy already exists error | Migration not idempotent | Use `20260409130000_master_idempotent_setup.sql` |
| storage.objects permission denied | Insufficient role | The DO block skips this — grant manually as project owner |
