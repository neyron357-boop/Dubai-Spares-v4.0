-- Idempotent: remove leftover NOT NULL constraints on public_quote_snapshots that
-- were set by the original 20260226110000_create_public_quote_snapshots migration
-- (order_id text not null, payload jsonb not null) and never dropped by later
-- ADD COLUMN IF NOT EXISTS guards.
-- PostgreSQL silently ignores DROP NOT NULL on a column that is already nullable.

alter table public.public_quote_snapshots
  alter column order_id     drop not null;

alter table public.public_quote_snapshots
  alter column payload      drop not null;

alter table public.public_quote_snapshots
  alter column payload      set  default '{}'::jsonb;

alter table public.public_quote_snapshots
  alter column image_manifest drop not null;

alter table public.public_quote_snapshots
  alter column image_manifest set  default '[]'::jsonb;

select public.refresh_schema_cache();
