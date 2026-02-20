-- ============================================================
-- FIX: public.shops missing columns + public_quote_snapshots RLS
-- Fully idempotent — safe to run on any project, any number of times.
--
-- Rules:
--   1. DROP POLICY IF EXISTS before every CREATE POLICY
--   2. Explicit public. schema on every table reference
--   3. ADD COLUMN only with IF NOT EXISTS
--   4. storage.objects not touched here
--   5. Script completes without error on every re-run
--
-- Fixes addressed:
--   A. public.shops was missing ADD COLUMN IF NOT EXISTS guards in the
--      master setup — databases created from older migrations (e.g.
--      20260407120000) lack columns required by upsertSupplierToShops
--      (location, shop_type, main_brands, zone, heat_level,
--       needs_manual_fix, specialization_*, is_active).
--
--   B. quote_update_anon policy was changed to "to authenticated" in
--      20260409130000_master_idempotent_setup.sql, blocking the anon
--      best-effort payload_json backfill in publicQuoteApi.ts.
--      Restored to "to anon".
--
--   C. Legacy orphaned RLS policies from pre-master migrations were
--      never cleaned up and create confusing duplicates.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. public.shops — add every column that may be absent
-- ────────────────────────────────────────────────────────────

alter table public.shops
  add column if not exists location                  text        not null default '',
  add column if not exists shop_type                 text        not null default 'new_parts',
  add column if not exists main_brands               text[]      not null default '{}',
  add column if not exists zone                      text        not null default '',
  add column if not exists heat_level                integer     not null default 0,
  add column if not exists needs_manual_fix          boolean     not null default false,
  add column if not exists specialization            text[]      not null default '{}',
  add column if not exists specialization_models     text[]      not null default '{}',
  add column if not exists specialization_years      integer[]   not null default '{}',
  add column if not exists specialization_body_types text[]      not null default '{}',
  add column if not exists specialization_tag        text,
  add column if not exists is_active                 boolean     not null default true,
  add column if not exists updated_at                timestamptz not null default now();

-- Indexes (IF NOT EXISTS so re-runs are safe)
create index if not exists idx_shops_specialization_tag
  on public.shops (specialization_tag);

create index if not exists idx_shops_geo
  on public.shops (latitude, longitude);

create index if not exists idx_shops_is_active
  on public.shops (is_active)
  where is_active = true;

-- ────────────────────────────────────────────────────────────
-- 2. public.shops — drop legacy conflicting policies,
--    then (re)create canonical set
-- ────────────────────────────────────────────────────────────

-- Drop old policies left behind by 20260407120000 and schema_full_setup.sql
drop policy if exists "Public shops are viewable by everyone" on public.shops;
drop policy if exists "Authenticated users can update shops"  on public.shops;
-- Drop old policy from schema_full_setup.sql / early migrations
drop policy if exists "Leads are viewable by authenticated users" on public.shops;

-- Canonical policies
drop policy if exists "anon_read_shops"  on public.shops;
create policy "anon_read_shops"
  on public.shops for select to anon
  using (true);

drop policy if exists "anon_write_shops" on public.shops;
create policy "anon_write_shops"
  on public.shops for all to anon
  using (true) with check (true);

-- ────────────────────────────────────────────────────────────
-- 3. public.public_quote_snapshots — drop legacy orphaned
--    policies, then (re)create canonical set
-- ────────────────────────────────────────────────────────────

-- Legacy policies created in 20260320120000 and 20260322110000
-- that were never removed by subsequent migrations:
drop policy if exists public_quote_snapshots_read_anon         on public.public_quote_snapshots;
drop policy if exists public_quote_snapshots_insert_anon       on public.public_quote_snapshots;
drop policy if exists public_quote_snapshots_select_anon_token on public.public_quote_snapshots;
drop policy if exists public_quote_snapshots_insert_anon_token on public.public_quote_snapshots;

-- INSERT: anon may insert any row that has a non-null token
drop policy if exists "quote_insert_anon" on public.public_quote_snapshots;
create policy "quote_insert_anon"
  on public.public_quote_snapshots for insert to anon
  with check (token is not null);

-- SELECT: anon may read non-expired rows
drop policy if exists "quote_select_anon" on public.public_quote_snapshots;
create policy "quote_select_anon"
  on public.public_quote_snapshots for select to anon
  using (expires_at is null or expires_at > now());

-- UPDATE: anon must be able to update for best-effort payload_json backfill
--   (20260409130000 incorrectly set this to "authenticated"; restored here)
drop policy if exists "quote_update_anon" on public.public_quote_snapshots;
create policy "quote_update_anon"
  on public.public_quote_snapshots for update to anon
  using (true) with check (true);

-- ────────────────────────────────────────────────────────────
-- 4. Re-confirm grants (idempotent)
-- ────────────────────────────────────────────────────────────

grant usage on schema public to anon, authenticated;
grant all on table public.shops                  to anon, authenticated;
grant all on table public.public_quote_snapshots to anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 5. Refresh PostgREST schema cache
-- ────────────────────────────────────────────────────────────

select public.refresh_schema_cache();
