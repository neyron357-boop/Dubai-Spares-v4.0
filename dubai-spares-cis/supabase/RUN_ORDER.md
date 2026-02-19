## Supabase SQL editor run order

1. Open Supabase project SQL Editor.
2. Run `supabase/migrations/20260315120000_cloud_actions_hardening.sql`.
3. Run `supabase/migrations/20260316110000_local_first_cloud_whitelist.sql`.
4. Run `supabase/migrations/20260406120000_normalize_all_app_tables_and_public_links.sql`.
5. Optional fallback for partially migrated projects: run `supabase/idempotent_normalize_all_tables.sql`.

## Verify after migration

- Tables: `orders`, `parts`, `price_variants`, `shops`, `push_subscriptions`, `public_quote_snapshots`, `client_leads`, `backups`, `backups_meta`, `app_state`.
- RPC: `public.refresh_schema_cache()` is callable by `anon` and `authenticated`.
- Buckets: `images`, `backups`, `public-quote`, `client-form`.

## Smoke checks (anon key)

- Insert one row into `public_quote_snapshots`.
- Insert one row into `client_leads`.
- Fetch `orders` with `select=id,brand,model,created_at`.
- Open a generated public quote URL that uses hash route: `/#/q/<slug>?token=<token>`.
