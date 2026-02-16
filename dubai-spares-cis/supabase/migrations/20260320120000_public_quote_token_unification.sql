-- Public quote snapshot hardening: single token lookup + minimal anon policies.

create table if not exists public.public_quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  expires_at timestamptz not null,
  payload_json jsonb,
  payload_b64 text,
  payload_codec text,
  image_manifest jsonb not null default '[]'::jsonb,
  payload jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.public_quote_snapshots
  alter column token set not null,
  alter column expires_at set not null;

alter table public.public_quote_snapshots
  add column if not exists payload_json jsonb,
  add column if not exists payload_b64 text,
  add column if not exists payload_codec text,
  add column if not exists image_manifest jsonb not null default '[]'::jsonb;

create unique index if not exists idx_public_quote_snapshots_token_unique
  on public.public_quote_snapshots (token);

create index if not exists idx_public_quote_snapshots_expires_at
  on public.public_quote_snapshots (expires_at);

alter table public.public_quote_snapshots enable row level security;

drop policy if exists public_quote_snapshots_read_anon on public.public_quote_snapshots;
create policy public_quote_snapshots_read_anon
  on public.public_quote_snapshots
  for select
  to anon
  using (token is not null and expires_at > now());

drop policy if exists public_quote_snapshots_insert_anon on public.public_quote_snapshots;
create policy public_quote_snapshots_insert_anon
  on public.public_quote_snapshots
  for insert
  to anon
  with check (token is not null and expires_at > now());
