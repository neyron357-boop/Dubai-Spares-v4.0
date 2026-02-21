-- Idempotent: ensure the legacy `snapshot` column (distinct from `snapshot_id`) in
-- public_quote_snapshots is nullable.  Some early deployments were created with
-- `snapshot text NOT NULL` and the app never writes to that column, causing every
-- share-quote insert to fail with:
--   "null value in column 'snapshot' of relation 'public_quote_snapshots'
--    violates not-null constraint"
-- PostgreSQL silently ignores DROP NOT NULL on a column that is already nullable.

-- Ensure the column exists first (nullable by default when added with ADD COLUMN)
alter table public.public_quote_snapshots
  add column if not exists snapshot text;

-- Then drop the NOT NULL constraint in case it was applied on an older deployment
alter table public.public_quote_snapshots
  alter column snapshot drop not null;

select public.refresh_schema_cache();
