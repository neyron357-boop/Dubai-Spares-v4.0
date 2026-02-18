-- Ensure public lead intake schema is complete and stable for web form submissions.

create extension if not exists pgcrypto;

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

alter table public.client_leads
  add column if not exists idempotency_key text,
  add column if not exists order_id text,
  add column if not exists name text,
  add column if not exists phone text,
  add column if not exists message text,
  add column if not exists payload jsonb,
  add column if not exists payload_json jsonb,
  add column if not exists payload_b64 text,
  add column if not exists payload_codec text,
  add column if not exists image_manifest jsonb,
  add column if not exists created_at timestamptz;

update public.client_leads
set image_manifest = '[]'::jsonb
where image_manifest is null;

update public.client_leads
set created_at = now()
where created_at is null;

alter table public.client_leads
  alter column image_manifest set default '[]'::jsonb,
  alter column image_manifest set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

create unique index if not exists idx_client_leads_idempotency_key on public.client_leads(idempotency_key);
create index if not exists idx_client_leads_created_at on public.client_leads(created_at desc);

alter table public.client_leads enable row level security;

drop policy if exists client_leads_insert_anon on public.client_leads;
create policy client_leads_insert_anon on public.client_leads
for insert to anon with check (true);

drop policy if exists client_leads_insert_authenticated on public.client_leads;
create policy client_leads_insert_authenticated on public.client_leads
for insert to authenticated with check (true);
