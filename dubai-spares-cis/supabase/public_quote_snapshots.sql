create extension if not exists pgcrypto;

create table if not exists public.public_quote_snapshots (
  id             uuid        primary key default gen_random_uuid(),
  token          text        not null unique,
  snapshot_id    text,
  order_id       text,
  payload        jsonb       not null default '{}'::jsonb,
  payload_json   jsonb,
  payload_b64    text,
  payload_codec  text,
  image_manifest jsonb       not null default '[]'::jsonb,
  expires_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- Idempotent column additions for projects using an older version of this script
-- NOT NULL constraints are omitted from ADD COLUMN (PostgreSQL sets the default for existing rows)
alter table public.public_quote_snapshots
  add column if not exists snapshot_id    text,
  add column if not exists order_id       text,
  add column if not exists payload        jsonb       default '{}'::jsonb,
  add column if not exists payload_json   jsonb,
  add column if not exists payload_b64    text,
  add column if not exists payload_codec  text,
  add column if not exists image_manifest jsonb       default '[]'::jsonb,
  add column if not exists expires_at     timestamptz;

create index if not exists idx_public_quote_snapshots_token
  on public.public_quote_snapshots (token);
create index if not exists idx_public_quote_snapshots_snapshot_id
  on public.public_quote_snapshots (snapshot_id);
create index if not exists idx_public_quote_snapshots_expires_at
  on public.public_quote_snapshots (expires_at);

alter table public.public_quote_snapshots enable row level security;

grant usage on schema public to anon, authenticated;
grant all on table public.public_quote_snapshots to anon, authenticated;

drop policy if exists quote_insert_anon on public.public_quote_snapshots;
create policy quote_insert_anon
  on public.public_quote_snapshots
  for insert
  to anon
  with check (token is not null);

drop policy if exists quote_select_anon on public.public_quote_snapshots;
create policy quote_select_anon
  on public.public_quote_snapshots
  for select
  to anon
  using (expires_at is null or expires_at > now());

drop policy if exists quote_update_anon on public.public_quote_snapshots;
create policy quote_update_anon
  on public.public_quote_snapshots
  for update
  to authenticated
  using (true)
  with check (true);
