-- Orders / Parts / Price Variants schema for Dubai Spares offline sync

create table if not exists public.orders (
  id text primary key,
  brand text not null,
  model text not null,
  year text not null,
  vin text not null,
  status text not null,
  priority text not null,
  client_name text not null,
  source text not null,
  car_photo_url text,
  car_photos text[] not null default '{}',
  markup_percent decimal(10,2) not null default 0,
  exchange_rate decimal(10,4) not null default 0,
  created_at bigint not null,
  is_archived boolean not null default false,
  is_sold boolean not null default false,
  sold_profit_usd decimal(12,2),
  is_vip boolean not null default false,
  is_pinned boolean not null default false,
  is_lead boolean not null default false,
  notes jsonb not null default '[]'::jsonb
);

create table if not exists public.parts (
  id text primary key,
  order_id text not null references public.orders(id) on delete cascade,
  name text not null,
  photo_url text,
  photos text[] not null default '{}',
  is_found boolean not null default false
);

create table if not exists public.price_variants (
  id text primary key,
  part_id text not null references public.parts(id) on delete cascade,
  price_aed decimal(12,2) not null default 0,
  shop_name text not null,
  phone text not null,
  location text not null,
  photo_url text,
  photos text[] not null default '{}',
  created_at bigint not null
);

create index if not exists idx_parts_order_id on public.parts(order_id);
create index if not exists idx_price_variants_part_id on public.price_variants(part_id);

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
