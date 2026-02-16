alter table if exists public.public_quote_snapshots
  add column if not exists snapshot_id text;

create index if not exists idx_public_quote_snapshots_snapshot_id
  on public.public_quote_snapshots (snapshot_id);
