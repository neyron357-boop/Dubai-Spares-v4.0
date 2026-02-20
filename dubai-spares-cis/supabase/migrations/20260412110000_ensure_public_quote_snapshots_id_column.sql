-- Idempotent: ensure public_quote_snapshots has an id UUID column.
-- The original 20260226110000 migration created the table with `token text primary key`
-- (no `id` column). Later migrations add `id uuid default gen_random_uuid()` via
-- ADD COLUMN IF NOT EXISTS, but those may not have been applied to older deployments.
-- This migration is a targeted no-op fix that is safe to run on any project.

alter table public.public_quote_snapshots
  add column if not exists id uuid default gen_random_uuid();

-- Backfill any existing rows that were inserted before this column existed
update public.public_quote_snapshots
set id = gen_random_uuid()
where id is null;

select public.refresh_schema_cache();
