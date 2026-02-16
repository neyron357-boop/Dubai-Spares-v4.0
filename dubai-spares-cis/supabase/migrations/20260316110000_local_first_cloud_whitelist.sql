-- Local-first cloud whitelist (backup/share/form) tables + policies.

create extension if not exists pgcrypto;

create table if not exists public.public_quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  expires_at timestamptz not null,
  payload jsonb,
  payload_json jsonb,
  payload_b64 text,
  payload_codec text,
  image_manifest jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  owner_key text,
  token text unique,
  payload jsonb,
  payload_json jsonb,
  payload_b64 text,
  payload_codec text,
  image_manifest jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.client_leads (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique,
  order_id text,
  name text,
  phone text,
  message text,
  payload jsonb,
  payload_json jsonb,
  payload_b64 text,
  payload_codec text,
  image_manifest jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_public_quote_snapshots_token on public.public_quote_snapshots(token);
create index if not exists idx_public_quote_snapshots_expires_at on public.public_quote_snapshots(expires_at);
create index if not exists idx_backups_owner_key on public.backups(owner_key);
create index if not exists idx_backups_token on public.backups(token);
create index if not exists idx_client_leads_idempotency_key on public.client_leads(idempotency_key);

alter table public.public_quote_snapshots enable row level security;
alter table public.backups enable row level security;
alter table public.client_leads enable row level security;

drop policy if exists public_quote_snapshots_read_anon on public.public_quote_snapshots;
create policy public_quote_snapshots_read_anon on public.public_quote_snapshots
for select to anon using (token is not null and expires_at > now());

drop policy if exists public_quote_snapshots_insert_anon on public.public_quote_snapshots;
create policy public_quote_snapshots_insert_anon on public.public_quote_snapshots
for insert to anon with check (token is not null);

drop policy if exists client_leads_insert_anon on public.client_leads;
create policy client_leads_insert_anon on public.client_leads
for insert to anon with check (true);

drop policy if exists backups_insert_anon on public.backups;
create policy backups_insert_anon on public.backups
for insert to anon with check (true);

drop policy if exists backups_select_anon on public.backups;
create policy backups_select_anon on public.backups
for select to anon using (true);
