# SYNC_FIX_README.md — Dubai Spares CIS: Supabase Sync Repair Guide

## Problem summary

The app reports one or more of these errors when trying to sync with Supabase:

| Error code | Meaning |
|---|---|
| `PGRST205` | PostgREST schema cache is stale — it doesn't see the latest table/column changes |
| `PGRST204` | Table or column not found in schema cache |
| `SCHEMA_MISMATCH` | App columns don't match the live Supabase schema |
| `DATABASE_INTEGRITY` / `SYNC:FETCH` | Data cannot be loaded from Supabase |

Even when the tables appear to exist in the Supabase dashboard, PostgREST (the REST layer) caches the schema at start-up and must be explicitly told to reload it.

---

## Files in this directory

| File | Purpose |
|---|---|
| `fix_supabase_sync.sql` | **One-click full repair** — creates/updates all tables, indexes, RLS policies, storage buckets, grants, and reloads the PostgREST schema cache |
| `diagnose_supabase_schema.sql` | **Read-only diagnostic** — tells you exactly what is missing or misconfigured |
| `idempotent_normalize_all_tables.sql` | Legacy idempotent normalization (superseded by `fix_supabase_sync.sql`) |
| `schema_normalized.sql` | Canonical schema reference |
| `migrations/` | Ordered migration history |

---

## Step-by-step fix

### 1. (Optional) Run the diagnostic first

1. Open your [Supabase project](https://app.supabase.com).
2. Go to **SQL Editor** → **+ New query**.
3. Paste the contents of `diagnose_supabase_schema.sql`.
4. Click **Run**.
5. Review the output — the last query ("Summary") will tell you whether the schema is healthy or broken.

### 2. Apply the full fix

1. Open **SQL Editor** → **+ New query**.
2. Paste the full contents of `fix_supabase_sync.sql`.
3. Click **Run**.
4. Wait for the `NOTIFY pgrst, 'reload schema';` line at the bottom to execute — this is the critical step that reloads the PostgREST schema cache.
5. You should see output similar to:
   ```
   NOTIFY
   ```
   without errors.

> **The script is safe to run multiple times.** All DDL statements use `IF NOT EXISTS` or `IF EXISTS`, and all policy statements `DROP IF EXISTS` before `CREATE`.

### 3. Force-refresh the schema cache (if the NOTIFY doesn't help immediately)

If errors persist after running the script:

1. In the Supabase dashboard go to **Settings → Database**.
2. Click **Restart database** (the PostgREST process will reload the schema on restart).
3. Alternatively, wait 1–2 minutes — PostgREST auto-reloads the schema every ~60 seconds.

### 4. Verify in the app

1. Open Dubai Spares CIS.
2. Pull-to-refresh or navigate away and back to trigger a sync.
3. Check the diagnostic panel (if available) — the `PGRST205` / `SCHEMA_MISMATCH` errors should be gone.

---

## What the fix script does

| Section | Action |
|---|---|
| Extensions | `CREATE EXTENSION IF NOT EXISTS pgcrypto` |
| Schema grants | `GRANT USAGE ON SCHEMA public TO anon, authenticated` |
| Tables | Creates all 9 tables if they don't exist: `app_state`, `orders`, `parts`, `price_variants`, `shops`, `client_leads`, `backups`, `push_subscriptions`, `public_quote_snapshots` |
| Columns | `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for every column required by the app (including all `ORDER_GRAPH_COLUMNS` from `syncSchema.ts`) |
| Indexes | All performance indexes, safely re-created with `IF NOT EXISTS` |
| RLS | Enables RLS on all tables; recreates `anon` and `authenticated` policies |
| Table grants | Explicit `GRANT SELECT/INSERT/UPDATE/DELETE` to `anon` and `authenticated` |
| Storage | Upserts buckets: `images` (public), `backups`, `public-quote`, `client-form`; sets per-bucket RLS policies |
| Schema cache | `NOTIFY pgrst, 'reload schema'` — tells PostgREST to re-introspect the schema immediately |

---

## Tables covered

| Table | `anon` access |
|---|---|
| `app_state` | Full CRUD |
| `orders` | Full CRUD |
| `parts` | Full CRUD |
| `price_variants` | Full CRUD |
| `shops` | SELECT + write |
| `client_leads` | INSERT only |
| `backups` | SELECT + INSERT |
| `push_subscriptions` | Service role only |
| `public_quote_snapshots` | Full CRUD |

---

## Columns tracked by `syncSchema.ts`

The following columns are verified by `diagnose_supabase_schema.sql` and ensured by `fix_supabase_sync.sql`:

```
orders: id, brand, model, year, body_type, vin, vin_photo_url, priority,
        client_name, source, car_photo_url, car_photos, markup_percent,
        markup_type, markup_fixed_aed, use_markup_as_default_for_new_parts,
        client_currency, fx_updated_at, logistics, exchange_rate, created_at,
        is_archived, is_sold, sold_profit_usd, is_vip, is_pinned, is_lead,
        notes, status, sales_status, customer_contact, social_nickname,
        updated_at, recommended_shop_ids, dismissed_shop_ids, lead_unread,
        lead_source, lead_read_at, pricing_events

parts: id, order_id, name, photo_url, photos, is_found

price_variants: id, part_id, price_aed, condition, availability, shop_name,
                phone, location, photo_url, photos, created_at

public_quote_snapshots: token, order_id, payload, created_at, expires_at
```

---

## Troubleshooting

### "Skipping storage.objects policy changes (insufficient privileges)"

This notice is expected when running as a non-owner role. Storage policies can be set manually:

1. Go to **Storage** → **Policies** in the Supabase dashboard.
2. Add the policies listed in the script's storage section (section 22).

### Still getting PGRST205 after the fix

1. Check that the `NOTIFY pgrst, 'reload schema';` line ran without error.
2. Restart the database via **Settings → Database → Restart**.
3. If the issue recurs after restarts, check for pending conflicting migrations in `supabase/migrations/`.
