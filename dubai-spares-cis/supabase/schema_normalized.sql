-- Normalized schema for orders -> parts -> price_variants (+ app settings/public links helpers)
create extension if not exists pgcrypto;

-- Legacy cleanup (safe / idempotent)
alter table if exists public.orders drop column if exists data;
drop table if exists public.app_state;

create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "anon_all_app_state" on public.app_state;
create policy "anon_all_app_state"
  on public.app_state
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "authenticated_all_app_state" on public.app_state;
create policy "authenticated_all_app_state"
  on public.app_state
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  year text not null default '',
  vin text not null default '',
  vin_photo_url text,
  body_type text,
  status text not null default 'active' check (status in ('active','archive','sold','vip','lead','new_inquiry','in_progress')),
  priority text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH')),
  sales_status text not null default 'Inquiry',
  client_name text not null default '',
  source text not null default 'Другое',
  source_platform text,
  customer_contact text not null default '',
  social_nickname text not null default '',
  contact_links jsonb,
  car_photo_url text,
  car_photos text[] not null default '{}',
  markup_percent numeric not null default 20,
  markup_type text not null default 'percent' check (markup_type in ('percent','fixed')),
  markup_fixed_aed numeric not null default 0,
  use_markup_as_default_for_new_parts boolean not null default false,
  exchange_rate numeric not null default 3.67,
  client_currency text,
  fx_updated_at timestamptz,
  logistics jsonb,
  is_archived boolean not null default false,
  is_sold boolean not null default false,
  sold_profit_usd numeric,
  is_vip boolean not null default false,
  is_pinned boolean not null default false,
  is_lead boolean not null default false,
  notes jsonb not null default '[]'::jsonb,
  pricing_events jsonb not null default '[]'::jsonb,
  recommended_shop_ids text[] not null default '{}',
  dismissed_shop_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.price_variants (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete cascade,
  price_aed numeric not null,
  shop_name text not null,
  phone text not null default '',
  location text not null default '',
  photo_url text,
  photos text[] not null default '{}',
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_parts_order_id on public.parts (order_id);
create index if not exists idx_price_variants_part_id on public.price_variants (part_id);

alter table public.orders enable row level security;
alter table public.parts enable row level security;
alter table public.price_variants enable row level security;

drop policy if exists "anon_all_orders" on public.orders;
create policy "anon_all_orders"
  on public.orders
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "anon_all_parts" on public.parts;
create policy "anon_all_parts"
  on public.parts
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "anon_all_price_variants" on public.price_variants;
create policy "anon_all_price_variants"
  on public.price_variants
  for all
  to anon
  using (true)
  with check (true);

insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do update
set public = excluded.public;

alter table storage.objects enable row level security;

drop policy if exists "anon_read_images" on storage.objects;
create policy "anon_read_images"
  on storage.objects
  for select
  to anon
  using (bucket_id = 'images');

drop policy if exists "anon_insert_images" on storage.objects;
create policy "anon_insert_images"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'images');

drop policy if exists "anon_update_images" on storage.objects;
create policy "anon_update_images"
  on storage.objects
  for update
  to anon
  using (bucket_id = 'images')
  with check (bucket_id = 'images');

drop policy if exists "anon_delete_images" on storage.objects;
create policy "anon_delete_images"
  on storage.objects
  for delete
  to anon
  using (bucket_id = 'images');

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

create index if not exists idx_shops_geo on public.shops (latitude, longitude);
create index if not exists idx_shops_specialization_tag on public.shops (specialization_tag);

alter table if exists public.shops enable row level security;

drop policy if exists "anon_read_shops" on public.shops;
create policy "anon_read_shops"
  on public.shops
  for select
  using (true);

drop policy if exists "anon_write_shops" on public.shops;
create policy "anon_write_shops"
  on public.shops
  for all
  using (true)
  with check (true);

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

create index if not exists idx_push_subscriptions_active
  on public.push_subscriptions (is_active)
  where is_active = true;

alter table public.push_subscriptions enable row level security;

drop policy if exists "Service role can manage push subscriptions" on public.push_subscriptions;
create policy "Service role can manage push subscriptions"
  on public.push_subscriptions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.public_quote_snapshots (
  token text primary key,
  order_id text not null,
  payload jsonb not null,
  original_url text,
  short_url text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.public_quote_snapshots add column if not exists original_url text;
alter table public.public_quote_snapshots add column if not exists short_url text;

create index if not exists idx_public_quote_snapshots_order_id
  on public.public_quote_snapshots (order_id);
create index if not exists idx_public_quote_snapshots_expires_at
  on public.public_quote_snapshots (expires_at);

alter table public.public_quote_snapshots enable row level security;

drop policy if exists "anon_all_public_quote_snapshots" on public.public_quote_snapshots;
create policy "anon_all_public_quote_snapshots"
  on public.public_quote_snapshots
  for all
  to anon
  using (true)
  with check (true);
