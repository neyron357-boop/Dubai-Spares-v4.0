-- Run in Supabase SQL editor after project env is configured.
-- Safe to run multiple times.

create extension if not exists pgcrypto;

create table if not exists public.public_quote_snapshots (
  token text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  payload_b64 text null,
  payload_codec text null,
  payload_json jsonb null,
  image_manifest jsonb not null default '[]'::jsonb
);

create table if not exists public.client_leads (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  name text null,
  phone text null,
  message text null,
  order_id uuid null,
  payload_b64 text null,
  payload_codec text null,
  image_manifest jsonb not null default '[]'::jsonb
);

create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  payload_b64 text null,
  payload_codec text null,
  image_manifest jsonb not null default '[]'::jsonb
);

create table if not exists public.backups_meta (
  id text primary key,
  created_at timestamptz not null default now(),
  size_bytes bigint null,
  sha256 text null
);

alter table public.public_quote_snapshots enable row level security;
alter table public.client_leads enable row level security;
alter table public.backups enable row level security;
alter table public.backups_meta enable row level security;

drop policy if exists quote_insert_anon on public.public_quote_snapshots;
create policy quote_insert_anon on public.public_quote_snapshots for insert to anon with check (true);

drop policy if exists quote_select_anon on public.public_quote_snapshots;
create policy quote_select_anon on public.public_quote_snapshots for select to anon using (true);

drop policy if exists leads_insert_anon on public.client_leads;
create policy leads_insert_anon on public.client_leads for insert to anon with check (true);

drop policy if exists backups_insert_anon on public.backups;
create policy backups_insert_anon on public.backups for insert to anon with check (true);

drop policy if exists backups_select_anon on public.backups;
create policy backups_select_anon on public.backups for select to anon using (true);

drop policy if exists backups_meta_insert_anon on public.backups_meta;
create policy backups_meta_insert_anon on public.backups_meta for insert to anon with check (true);

drop policy if exists backups_meta_select_anon on public.backups_meta;
create policy backups_meta_select_anon on public.backups_meta for select to anon using (true);

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false), ('public-quote', 'public-quote', true), ('client-form', 'client-form', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists backups_write_anon on storage.objects;
create policy backups_write_anon on storage.objects for insert to anon with check (bucket_id = 'backups');

drop policy if exists public_quote_write_anon on storage.objects;
create policy public_quote_write_anon on storage.objects for insert to anon with check (bucket_id = 'public-quote');

drop policy if exists client_form_write_anon on storage.objects;
create policy client_form_write_anon on storage.objects for insert to anon with check (bucket_id = 'client-form');

drop policy if exists public_quote_read_any on storage.objects;
create policy public_quote_read_any on storage.objects for select to anon using (bucket_id = 'public-quote');
