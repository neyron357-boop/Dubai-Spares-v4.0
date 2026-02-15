## Supabase SQL editor run order

1. Open Supabase project SQL Editor.
2. Run `supabase/migrations/20260315120000_cloud_actions_hardening.sql`.
3. Verify tables: `public_quote_snapshots`, `client_leads`, `backups`, `backups_meta`.
4. Verify storage buckets: `backups`, `public-quote`, `client-form`.
5. Smoke check with anon key:
   - Insert one row into `public_quote_snapshots`.
   - Insert one row into `client_leads`.
   - Upload one file into each bucket.
