-- Idempotent: ensure snapshot_id is nullable in public_quote_snapshots.
-- Some deployments ended up with snapshot_id text NOT NULL (from a manual alter or
-- a schema version that pre-dates the ADD COLUMN IF NOT EXISTS nullable guard).
-- PostgreSQL silently ignores DROP NOT NULL on a column that is already nullable.

alter table public.public_quote_snapshots
  alter column snapshot_id drop not null;

-- Also ensure the column exists (in case this runs before 20260324110000)
alter table public.public_quote_snapshots
  add column if not exists snapshot_id text;

select public.refresh_schema_cache();
