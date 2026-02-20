-- Full idempotent schema normalization.
-- Creates all tables / columns / indexes / policies / buckets if they do not exist.
-- Safe to re-run at any time. Refreshes PostgREST schema cache at the end.

create extension if not exists pgcrypto;

-- ─── app_state ───────────────────────────────────────────────────────────────
create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_state
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- ─── orders ──────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  brand text not null default '',
  model text not null default '',
  year text not null default '',
  body_type text,
  vin text not null default '',
  vin_photo_url text,
  priority text not null default 'MEDIUM',
  client_name text not null default '',
  source text not null default 'Другое',
  source_platform text,
  customer_contact text not null default '',
  social_nickname text not null default '',
  car_photo_url text,
  car_photos text[] not null default '{}',
  markup_percent numeric not null default 20,
  markup_type text not null default 'percent',
  markup_fixed_aed numeric not null default 0,
  use_markup_as_default_for_new_parts boolean not null default false,
  exchange_rate numeric not null default 3.67,
  client_currency text,
  fx_updated_at timestamptz,
  logistics jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_archived boolean not null default false,
  is_sold boolean not null default false,
  sold_profit_usd numeric,
  is_vip boolean not null default false,
  is_pinned boolean not null default false,
  is_lead boolean not null default false,
  notes jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  sales_status text not null default 'Inquiry',
  recommended_shop_ids text[] not null default '{}',
  dismissed_shop_ids text[] not null default '{}',
  lead_unread boolean not null default false,
  lead_source text not null default 'manual',
  lead_read_at timestamptz,
  pricing_events jsonb not null default '[]'::jsonb
);
alter table public.orders
  add column if not exists body_type text,
  add column if not exists vin_photo_url text,
  add column if not exists priority text not null default 'MEDIUM',
  add column if not exists source_platform text,
  add column if not exists customer_contact text not null default '',
  add column if not exists social_nickname text not null default '',
  add column if not exists car_photo_url text,
  add column if not exists car_photos text[] not null default '{}',
  add column if not exists markup_percent numeric not null default 20,
  add column if not exists markup_type text not null default 'percent',
  add column if not exists markup_fixed_aed numeric not null default 0,
  add column if not exists use_markup_as_default_for_new_parts boolean not null default false,
  add column if not exists exchange_rate numeric not null default 3.67,
  add column if not exists client_currency text,
  add column if not exists fx_updated_at timestamptz,
  add column if not exists logistics jsonb,
  add column if not exists is_archived boolean not null default false,
  add column if not exists is_sold boolean not null default false,
  add column if not exists sold_profit_usd numeric,
  add column if not exists is_vip boolean not null default false,
  add column if not exists is_pinned boolean not null default false,
  add column if not exists is_lead boolean not null default false,
  add column if not exists notes jsonb not null default '[]'::jsonb,
  add column if not exists status text not null default 'active',
  add column if not exists sales_status text not null default 'Inquiry',
  add column if not exists recommended_shop_ids text[] not null default '{}',
  add column if not exists dismissed_shop_ids text[] not null default '{}',
  add column if not exists lead_unread boolean not null default false,
  add column if not exists lead_source text not null default 'manual',
  add column if not exists lead_read_at timestamptz,
  add column if not exists pricing_events jsonb not null default '[]'::jsonb;

-- ─── parts ───────────────────────────────────────────────────────────────────
create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  name text not null,
  photo_url text,
  photos text[] not null default '{}',
  is_found boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.parts
  add column if not exists photo_url text,
  add column if not exists photos text[] not null default '{}',
  add column if not exists is_found boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- ─── price_variants ──────────────────────────────────────────────────────────
create table if not exists public.price_variants (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete cascade,
  price_aed numeric not null default 0,
  condition text,
  availability text,
  shop_name text not null default '',
  phone text not null default '',
  location text not null default '',
  photo_url text,
  photos text[] not null default '{}',
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at timestamptz not null default now()
);
alter table public.price_variants
  add column if not exists condition text,
  add column if not exists availability text,
  add column if not exists phone text not null default '',
  add column if not exists location text not null default '',
  add column if not exists photo_url text,
  add column if not exists photos text[] not null default '{}',
  add column if not exists updated_at timestamptz not null default now();

-- ─── shops ───────────────────────────────────────────────────────────────────
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  location text not null default '',
  latitude double precision,
  longitude double precision,
  shop_type text not null default 'new_parts',
  main_brands text[] not null default '{}',
  zone text not null default '',
  heat_level integer not null default 0,
  needs_manual_fix boolean not null default false,
  specialization text[] not null default '{}',
  specialization_models text[] not null default '{}',
  specialization_years integer[] not null default '{}',
  specialization_body_types text[] not null default '{}',
  specialization_tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.shops
  add column if not exists phone text not null default '',
  add column if not exists location text not null default '',
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists shop_type text not null default 'new_parts',
  add column if not exists main_brands text[] not null default '{}',
  add column if not exists zone text not null default '',
  add column if not exists heat_level integer not null default 0,
  add column if not exists needs_manual_fix boolean not null default false,
  add column if not exists specialization text[] not null default '{}',
  add column if not exists specialization_models text[] not null default '{}',
  add column if not exists specialization_years integer[] not null default '{}',
  add column if not exists specialization_body_types text[] not null default '{}',
  add column if not exists specialization_tag text,
  add column if not exists updated_at timestamptz not null default now();

-- ─── push_subscriptions ──────────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ─── public_quote_snapshots ──────────────────────────────────────────────────
-- Fix: old schema used token as PK with no id/snapshot_id/payload_json columns.
-- The frontend posts {token, snapshot_id, payload, payload_json} and selects
-- ?select=id,token,snapshot_id,expires_at,payload_json which requires all four.
create table if not exists public.public_quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  snapshot_id text,
  order_id text,
  payload jsonb not null default '{}'::jsonb,
  payload_json jsonb,
  payload_b64 text,
  payload_codec text,
  image_manifest jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
-- The ALTER TABLE block below handles existing databases that were created with
-- the old schema (token as primary key, no id / snapshot_id / payload_json).
-- On a fresh database the CREATE TABLE above already covers all columns.
alter table public.public_quote_snapshots
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists token text,
  add column if not exists snapshot_id text,
  add column if not exists order_id text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists payload_json jsonb,
  add column if not exists payload_b64 text,
  add column if not exists payload_codec text,
  add column if not exists image_manifest jsonb not null default '[]'::jsonb,
  add column if not exists expires_at timestamptz;

-- ─── client_leads ────────────────────────────────────────────────────────────
create table if not exists public.client_leads (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text,
  order_id text,
  name text,
  phone text,
  message text,
  payload jsonb not null default '{}'::jsonb,
  payload_json jsonb,
  payload_b64 text,
  payload_codec text,
  image_manifest jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.client_leads
  add column if not exists idempotency_key text,
  add column if not exists order_id text,
  add column if not exists name text,
  add column if not exists phone text,
  add column if not exists message text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists payload_json jsonb,
  add column if not exists payload_b64 text,
  add column if not exists payload_codec text,
  add column if not exists image_manifest jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- ─── backups ─────────────────────────────────────────────────────────────────
create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null default '{}'::jsonb,
  payload_b64 text,
  payload_codec text,
  image_manifest jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.backups
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists payload_b64 text,
  add column if not exists payload_codec text,
  add column if not exists image_manifest jsonb not null default '[]'::jsonb,
  add column if not exists created_at timestamptz not null default now();

-- ─── backups_meta ────────────────────────────────────────────────────────────
create table if not exists public.backups_meta (
  id text primary key,
  created_at timestamptz not null default now(),
  size_bytes bigint,
  sha256 text
);

-- ─── app_config ──────────────────────────────────────────────────────────────
create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- ─── indexes ─────────────────────────────────────────────────────────────────
create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_parts_order_id on public.parts (order_id);
create index if not exists idx_price_variants_part_id on public.price_variants (part_id);
create index if not exists idx_shops_geo on public.shops (latitude, longitude);
create index if not exists idx_shops_specialization_tag on public.shops (specialization_tag);
create index if not exists idx_push_subscriptions_active on public.push_subscriptions (is_active) where is_active = true;
create unique index if not exists idx_client_leads_idempotency_key on public.client_leads (idempotency_key);
create index if not exists idx_client_leads_created_at on public.client_leads (created_at desc);
create index if not exists idx_public_quote_snapshots_token on public.public_quote_snapshots (token);
create index if not exists idx_public_quote_snapshots_snapshot_id on public.public_quote_snapshots (snapshot_id);
create index if not exists idx_public_quote_snapshots_expires_at on public.public_quote_snapshots (expires_at);

-- ─── enable RLS ──────────────────────────────────────────────────────────────
alter table public.app_state enable row level security;
alter table public.orders enable row level security;
alter table public.parts enable row level security;
alter table public.price_variants enable row level security;
alter table public.shops enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.public_quote_snapshots enable row level security;
alter table public.client_leads enable row level security;
alter table public.backups enable row level security;
alter table public.backups_meta enable row level security;
alter table public.app_config enable row level security;

-- ─── grants ──────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant all on table public.app_state to anon, authenticated;
grant all on table public.orders to anon, authenticated;
grant all on table public.parts to anon, authenticated;
grant all on table public.price_variants to anon, authenticated;
grant all on table public.shops to anon, authenticated;
grant all on table public.push_subscriptions to anon, authenticated;
grant all on table public.public_quote_snapshots to anon, authenticated;
grant all on table public.client_leads to anon, authenticated;
grant all on table public.backups to anon, authenticated;
grant all on table public.backups_meta to anon, authenticated;
grant all on table public.app_config to anon, authenticated;

-- ─── RLS policies ────────────────────────────────────────────────────────────
drop policy if exists "anon_all_app_state" on public.app_state;
create policy "anon_all_app_state" on public.app_state for all to anon using (true) with check (true);
drop policy if exists "authenticated_all_app_state" on public.app_state;
create policy "authenticated_all_app_state" on public.app_state for all to authenticated using (true) with check (true);

drop policy if exists "anon_all_orders" on public.orders;
create policy "anon_all_orders" on public.orders for all to anon using (true) with check (true);
drop policy if exists "authenticated_all_orders" on public.orders;
create policy "authenticated_all_orders" on public.orders for all to authenticated using (true) with check (true);

drop policy if exists "anon_all_parts" on public.parts;
create policy "anon_all_parts" on public.parts for all to anon using (true) with check (true);
drop policy if exists "authenticated_all_parts" on public.parts;
create policy "authenticated_all_parts" on public.parts for all to authenticated using (true) with check (true);

drop policy if exists "anon_all_price_variants" on public.price_variants;
create policy "anon_all_price_variants" on public.price_variants for all to anon using (true) with check (true);
drop policy if exists "authenticated_all_price_variants" on public.price_variants;
create policy "authenticated_all_price_variants" on public.price_variants for all to authenticated using (true) with check (true);

-- shops: allow anon/authenticated full access for supplier sync
drop policy if exists "anon_read_shops" on public.shops;
drop policy if exists "anon_write_shops" on public.shops;
drop policy if exists "Public shops are viewable by everyone" on public.shops;
drop policy if exists "Authenticated users can update shops" on public.shops;
create policy "anon_all_shops" on public.shops for all to anon using (true) with check (true);
create policy "authenticated_all_shops" on public.shops for all to authenticated using (true) with check (true);

drop policy if exists "Service role can manage push subscriptions" on public.push_subscriptions;
create policy "Service role can manage push subscriptions" on public.push_subscriptions for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "quote_insert_anon" on public.public_quote_snapshots;
create policy "quote_insert_anon" on public.public_quote_snapshots for insert to anon with check (true);
drop policy if exists "quote_select_anon" on public.public_quote_snapshots;
create policy "quote_select_anon" on public.public_quote_snapshots for select to anon using (true);
drop policy if exists "quote_update_anon" on public.public_quote_snapshots;
drop policy if exists "public_quote_snapshots_update_anon" on public.public_quote_snapshots;
create policy "quote_update_anon" on public.public_quote_snapshots for update to anon
  using (token is not null) with check (token is not null);
drop policy if exists "quote_all_authenticated" on public.public_quote_snapshots;
create policy "quote_all_authenticated" on public.public_quote_snapshots for all to authenticated using (true) with check (true);

drop policy if exists "client_leads_insert_anon" on public.client_leads;
create policy "client_leads_insert_anon" on public.client_leads for insert to anon with check (true);
drop policy if exists "client_leads_insert_authenticated" on public.client_leads;
create policy "client_leads_insert_authenticated" on public.client_leads for insert to authenticated with check (true);
drop policy if exists "client_leads_select_anon" on public.client_leads;
create policy "client_leads_select_anon" on public.client_leads for select to anon using (true);
drop policy if exists "client_leads_select_authenticated" on public.client_leads;
create policy "client_leads_select_authenticated" on public.client_leads for select to authenticated using (true);

drop policy if exists "backups_insert_anon" on public.backups;
create policy "backups_insert_anon" on public.backups for insert to anon with check (true);
drop policy if exists "backups_select_anon" on public.backups;
create policy "backups_select_anon" on public.backups for select to anon using (true);
drop policy if exists "backups_all_authenticated" on public.backups;
create policy "backups_all_authenticated" on public.backups for all to authenticated using (true) with check (true);

drop policy if exists "backups_meta_insert_anon" on public.backups_meta;
create policy "backups_meta_insert_anon" on public.backups_meta for insert to anon with check (true);
drop policy if exists "backups_meta_select_anon" on public.backups_meta;
create policy "backups_meta_select_anon" on public.backups_meta for select to anon using (true);

drop policy if exists "anon_all_app_config" on public.app_config;
create policy "anon_all_app_config" on public.app_config for all to anon using (true) with check (true);
drop policy if exists "authenticated_all_app_config" on public.app_config;
create policy "authenticated_all_app_config" on public.app_config for all to authenticated using (true) with check (true);

-- ─── storage buckets ─────────────────────────────────────────────────────────
-- images  : public  – used by legacy photo uploads
-- backups : private – used by cloudMedia.ts (scope=backup)
-- public-quote : public – used by cloudMedia.ts (scope=quote) and publicQuoteApi.ts
-- client-form  : private – used by cloudMedia.ts (scope=lead)
insert into storage.buckets (id, name, public)
values
  ('images',       'images',       true),
  ('backups',      'backups',      false),
  ('public-quote', 'public-quote', true),
  ('client-form',  'client-form',  false)
on conflict (id) do update set public = excluded.public;

alter table storage.objects enable row level security;

-- images bucket
drop policy if exists "anon_read_images" on storage.objects;
create policy "anon_read_images" on storage.objects
  for select to anon using (bucket_id = 'images');
drop policy if exists "anon_insert_images" on storage.objects;
create policy "anon_insert_images" on storage.objects
  for insert to anon with check (bucket_id = 'images');
drop policy if exists "anon_update_images" on storage.objects;
create policy "anon_update_images" on storage.objects
  for update to anon using (bucket_id = 'images') with check (bucket_id = 'images');
drop policy if exists "anon_delete_images" on storage.objects;
create policy "anon_delete_images" on storage.objects
  for delete to anon using (bucket_id = 'images');

-- backups bucket (compressed backup uploads)
drop policy if exists "anon_insert_backups" on storage.objects;
create policy "anon_insert_backups" on storage.objects
  for insert to anon with check (bucket_id = 'backups');
drop policy if exists "anon_select_backups" on storage.objects;
create policy "anon_select_backups" on storage.objects
  for select to anon using (bucket_id = 'backups');
drop policy if exists "authenticated_all_backups" on storage.objects;
create policy "authenticated_all_backups" on storage.objects
  for all to authenticated using (bucket_id = 'backups') with check (bucket_id = 'backups');

-- public-quote bucket (compressed quote photo uploads – publicly readable)
drop policy if exists "anon_insert_public_quote" on storage.objects;
create policy "anon_insert_public_quote" on storage.objects
  for insert to anon with check (bucket_id = 'public-quote');
drop policy if exists "anon_select_public_quote" on storage.objects;
create policy "anon_select_public_quote" on storage.objects
  for select to anon using (bucket_id = 'public-quote');
drop policy if exists "authenticated_all_public_quote" on storage.objects;
create policy "authenticated_all_public_quote" on storage.objects
  for all to authenticated using (bucket_id = 'public-quote') with check (bucket_id = 'public-quote');

-- client-form bucket (compressed lead photo uploads)
drop policy if exists "anon_insert_client_form" on storage.objects;
create policy "anon_insert_client_form" on storage.objects
  for insert to anon with check (bucket_id = 'client-form');
drop policy if exists "anon_select_client_form" on storage.objects;
create policy "anon_select_client_form" on storage.objects
  for select to anon using (bucket_id = 'client-form');
drop policy if exists "authenticated_all_client_form" on storage.objects;
create policy "authenticated_all_client_form" on storage.objects
  for all to authenticated using (bucket_id = 'client-form') with check (bucket_id = 'client-form');

-- ─── schema cache refresh ─────────────────────────────────────────────────────
create or replace function public.refresh_schema_cache()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

grant execute on function public.refresh_schema_cache() to anon, authenticated;

select public.refresh_schema_cache();
