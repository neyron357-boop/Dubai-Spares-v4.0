create extension if not exists pgcrypto;

create table if not exists public.public_quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  payload_json jsonb,
  payload_codec text,
  created_at timestamptz not null default now()
);

create index if not exists idx_public_quote_snapshots_token on public.public_quote_snapshots(token);

alter table public.public_quote_snapshots
  drop constraint if exists public_quote_snapshots_expires_after_create_chk;

alter table public.public_quote_snapshots
  add constraint public_quote_snapshots_expires_after_create_chk
  check (expires_at > created_at + interval '1 minute');

alter table public.public_quote_snapshots enable row level security;

alter table public.public_quote_snapshots force row level security;

drop policy if exists public_quote_snapshots_insert_anon on public.public_quote_snapshots;
create policy public_quote_snapshots_insert_anon
  on public.public_quote_snapshots
  for insert
  to anon
  with check (token is not null);

drop policy if exists public_quote_snapshots_select_anon on public.public_quote_snapshots;
create policy public_quote_snapshots_select_anon
  on public.public_quote_snapshots
  for select
  to anon
  using (expires_at > now());
