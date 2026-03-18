-- Idempotent normalization for Dubai Spares schema (safe for reruns)
create extension if not exists pgcrypto;

create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_state add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.app_state add column if not exists updated_at timestamptz not null default now();

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  brand text not null default '',
  model text not null default '',
  year text not null default '',
  vin text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orders add column if not exists body_type text;
alter table public.orders add column if not exists vin_photo_url text;
alter table public.orders add column if not exists status text not null default 'active';
alter table public.orders add column if not exists priority text not null default 'MEDIUM';
alter table public.orders add column if not exists client_name text not null default '';
alter table public.orders add column if not exists source text not null default 'Другое';
alter table public.orders add column if not exists source_platform text;
alter table public.orders add column if not exists customer_contact text not null default '';
alter table public.orders add column if not exists social_nickname text not null default '';
alter table public.orders add column if not exists contact_links jsonb;
alter table public.orders add column if not exists car_photo_url text;
alter table public.orders add column if not exists car_photos text[] not null default '{}';
alter table public.orders add column if not exists sales_status text not null default 'Inquiry';
alter table public.orders add column if not exists markup_percent numeric not null default 20;
alter table public.orders add column if not exists markup_type text not null default 'percent';
alter table public.orders add column if not exists markup_fixed_aed numeric not null default 0;
alter table public.orders add column if not exists use_markup_as_default_for_new_parts boolean not null default false;
alter table public.orders add column if not exists exchange_rate numeric not null default 3.67;
alter table public.orders add column if not exists client_currency text;
alter table public.orders add column if not exists fx_updated_at timestamptz;
alter table public.orders add column if not exists logistics jsonb;
alter table public.orders add column if not exists is_archived boolean not null default false;
alter table public.orders add column if not exists is_sold boolean not null default false;
alter table public.orders add column if not exists sold_profit_usd numeric;
alter table public.orders add column if not exists is_vip boolean not null default false;
alter table public.orders add column if not exists is_pinned boolean not null default false;
alter table public.orders add column if not exists is_lead boolean not null default false;
alter table public.orders add column if not exists notes jsonb not null default '[]'::jsonb;
alter table public.orders add column if not exists recommended_shop_ids text[] not null default '{}';
alter table public.orders add column if not exists dismissed_shop_ids text[] not null default '{}';
alter table public.orders add column if not exists lead_unread boolean not null default false;
alter table public.orders add column if not exists lead_source text not null default 'manual';
alter table public.orders add column if not exists lead_read_at timestamptz;
alter table public.orders add column if not exists pricing_events jsonb not null default '[]'::jsonb;

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
alter table public.parts add column if not exists photo_url text;
alter table public.parts add column if not exists photos text[] not null default '{}';
alter table public.parts add column if not exists is_found boolean not null default false;

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
alter table public.price_variants add column if not exists condition text;
alter table public.price_variants add column if not exists availability text;
alter table public.price_variants add column if not exists phone text not null default '';
alter table public.price_variants add column if not exists location text not null default '';
alter table public.price_variants add column if not exists photo_url text;
alter table public.price_variants add column if not exists photos text[] not null default '{}';

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

create table if not exists public.public_quote_snapshots (
  token text primary key,
  order_id text not null,
  payload jsonb not null,
  original_url text,
  short_url text,
  created_at timestamptz not null default now()
);
alter table public.public_quote_snapshots add column if not exists expires_at timestamptz;
alter table public.public_quote_snapshots add column if not exists original_url text;
alter table public.public_quote_snapshots add column if not exists short_url text;

create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_parts_order_id on public.parts (order_id);
create index if not exists idx_price_variants_part_id on public.price_variants (part_id);
create index if not exists idx_shops_geo on public.shops (latitude, longitude);
create index if not exists idx_shops_specialization_tag on public.shops (specialization_tag);
create index if not exists idx_push_subscriptions_active on public.push_subscriptions (is_active) where is_active = true;
create index if not exists idx_public_quote_snapshots_order_id on public.public_quote_snapshots (order_id);
create index if not exists idx_public_quote_snapshots_expires_at on public.public_quote_snapshots (expires_at);

alter table public.app_state enable row level security;
alter table public.orders enable row level security;
alter table public.parts enable row level security;
alter table public.price_variants enable row level security;
alter table public.shops enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.public_quote_snapshots enable row level security;

drop policy if exists "anon_all_app_state" on public.app_state;
create policy "anon_all_app_state" on public.app_state for all to anon using (true) with check (true);
drop policy if exists "authenticated_all_app_state" on public.app_state;
create policy "authenticated_all_app_state" on public.app_state for all to authenticated using (true) with check (true);

drop policy if exists "anon_all_orders" on public.orders;
create policy "anon_all_orders" on public.orders for all to anon using (true) with check (true);
drop policy if exists "anon_all_parts" on public.parts;
create policy "anon_all_parts" on public.parts for all to anon using (true) with check (true);
drop policy if exists "anon_all_price_variants" on public.price_variants;
create policy "anon_all_price_variants" on public.price_variants for all to anon using (true) with check (true);

drop policy if exists "anon_read_shops" on public.shops;
create policy "anon_read_shops" on public.shops for select to anon using (true);
drop policy if exists "anon_write_shops" on public.shops;
create policy "anon_write_shops" on public.shops for all to anon using (true) with check (true);

drop policy if exists "Service role can manage push subscriptions" on public.push_subscriptions;
create policy "Service role can manage push subscriptions" on public.push_subscriptions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "anon_all_public_quote_snapshots" on public.public_quote_snapshots;
create policy "anon_all_public_quote_snapshots" on public.public_quote_snapshots for all to anon using (true) with check (true);

-- Optional storage policies (skip safely when role lacks ownership):
do $$
begin
  begin
    alter table storage.objects enable row level security;
    drop policy if exists "anon_read_images" on storage.objects;
    create policy "anon_read_images" on storage.objects for select to anon using (bucket_id = 'images');
    drop policy if exists "anon_insert_images" on storage.objects;
    create policy "anon_insert_images" on storage.objects for insert to anon with check (bucket_id = 'images');
    drop policy if exists "anon_update_images" on storage.objects;
    create policy "anon_update_images" on storage.objects for update to anon using (bucket_id = 'images') with check (bucket_id = 'images');
    drop policy if exists "anon_delete_images" on storage.objects;
    create policy "anon_delete_images" on storage.objects for delete to anon using (bucket_id = 'images');
  exception
    when insufficient_privilege then
      raise notice 'Skipping storage.objects policy changes (insufficient privileges)';
  end;
end $$;

-- Additional cloud tables used by public form / quote / backups.
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
alter table public.client_leads add column if not exists idempotency_key text;
alter table public.client_leads add column if not exists order_id text;
alter table public.client_leads add column if not exists payload_json jsonb;
alter table public.client_leads add column if not exists payload_b64 text;
alter table public.client_leads add column if not exists payload_codec text;
alter table public.client_leads add column if not exists image_manifest jsonb not null default '[]'::jsonb;
alter table public.client_leads add column if not exists updated_at timestamptz not null default now();

create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null default '{}'::jsonb,
  payload_b64 text,
  payload_codec text,
  image_manifest jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.backups_meta (
  id text primary key,
  created_at timestamptz not null default now(),
  size_bytes bigint,
  sha256 text
);

create unique index if not exists idx_client_leads_idempotency_key on public.client_leads (idempotency_key);
create index if not exists idx_client_leads_created_at on public.client_leads (created_at desc);

alter table public.client_leads enable row level security;
alter table public.backups enable row level security;
alter table public.backups_meta enable row level security;

drop policy if exists "client_leads_insert_anon" on public.client_leads;
create policy "client_leads_insert_anon" on public.client_leads for insert to anon with check (true);
drop policy if exists "client_leads_insert_authenticated" on public.client_leads;
create policy "client_leads_insert_authenticated" on public.client_leads for insert to authenticated with check (true);
drop policy if exists "client_leads_select_anon" on public.client_leads;
create policy "client_leads_select_anon" on public.client_leads for select to anon using (true);
drop policy if exists "client_leads_select_authenticated" on public.client_leads;
create policy "client_leads_select_authenticated" on public.client_leads for select to authenticated using (true);
drop policy if exists "client_leads_delete_anon" on public.client_leads;
create policy "client_leads_delete_anon" on public.client_leads for delete to anon using (true);
drop policy if exists "client_leads_delete_authenticated" on public.client_leads;
create policy "client_leads_delete_authenticated" on public.client_leads for delete to authenticated using (true);

drop policy if exists "backups_insert_anon" on public.backups;
create policy "backups_insert_anon" on public.backups for insert to anon with check (true);
drop policy if exists "backups_select_anon" on public.backups;
create policy "backups_select_anon" on public.backups for select to anon using (true);

drop policy if exists "backups_meta_insert_anon" on public.backups_meta;
create policy "backups_meta_insert_anon" on public.backups_meta for insert to anon with check (true);
drop policy if exists "backups_meta_select_anon" on public.backups_meta;
create policy "backups_meta_select_anon" on public.backups_meta for select to anon using (true);

create or replace function public.refresh_schema_cache()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when undefined_function then
    null;
end;
$$;

grant execute on function public.refresh_schema_cache() to anon, authenticated;
