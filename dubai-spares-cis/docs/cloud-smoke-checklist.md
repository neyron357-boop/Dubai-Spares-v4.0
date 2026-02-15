# Cloud smoke checklist (manual)

1. Run `npm run build`.
2. Start app and create one local order.
3. Tap **Share quote link**.
   - Expect: request returns within timeout, no frozen UI.
   - Verify Supabase row in `public.public_quote_snapshots` and files in `public-quote` bucket.
4. Open `/request` and submit a client form with photos.
   - Verify row in `public.client_leads` and files in `client-form` bucket.
5. Open Settings → Local mode → **Backup now**.
   - Verify file/object in `backups` bucket and row in `public.backups` (and `backups_meta` if used).
6. Confirm `Supabase requests (dev check)` increments only for the three cloud actions.
