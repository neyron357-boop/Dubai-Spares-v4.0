-- Public form + leads/shops normalization baseline.
create extension if not exists pgcrypto;
create extension if not exists cube;
create extension if not exists earthdistance;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  status text not null default 'new' check (status in ('new', 'active', 'completed', 'cancelled')),
  is_read boolean default false,
  source text default 'manual' check (source in ('manual', 'public_form', 'import')),
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  delivery_address text,
  preferred_contact_time text,
  vehicle_brand text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_vin text,
  vehicle_notes text,
  parts_requested jsonb default '[]'::jsonb,
  ref_code text unique,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  brand text,
  description text,
  latitude double precision not null,
  longitude double precision not null,
  address text,
  city text default 'Dubai',
  country text default 'UAE',
  phone text,
  email text,
  website text,
  working_hours jsonb,
  is_open_now boolean default false,
  parts_categories text[],
  vehicle_brands text[],
  is_active boolean default true,
  is_verified boolean default false,
  rating decimal(2,1) default 0,
  total_orders integer default 0,
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_shops_location on public.shops using gist(ll_to_earth(latitude, longitude));
create index if not exists idx_shops_active on public.shops(is_active);
create index if not exists idx_shops_brand on public.shops(brand);

alter table public.leads enable row level security;
alter table public.shops enable row level security;

drop policy if exists "Public shops are viewable by everyone" on public.shops;
create policy "Public shops are viewable by everyone" on public.shops for select using (is_active = true);

drop policy if exists "Authenticated users can update shops" on public.shops;
create policy "Authenticated users can update shops" on public.shops for update using (auth.role() = 'authenticated');

insert into public.shops (name, brand, latitude, longitude, address, phone, is_open_now, is_active, parts_categories, vehicle_brands)
values
  ('Auto Parts Center Dubai', 'General', 25.2048, 55.2708, 'Al Quoz Industrial Area 3, Dubai', '+971-4-XXX-XXXX', true, true, array['engine','transmission','suspension'], array['Toyota','Honda','Nissan']),
  ('Premium Auto Spares', 'Luxury', 25.1972, 55.2744, 'Sheikh Zayed Road, Dubai', '+971-4-XXX-XXXX', true, true, array['body_parts','electronics','interior'], array['BMW','Mercedes','Audi']),
  ('Dubai Spare Parts Trading', 'General', 25.2854, 55.3672, 'Deira, Dubai', '+971-4-XXX-XXXX', false, true, array['filters','oils','batteries'], array['Toyota','Nissan','Mitsubishi'])
on conflict do nothing;
