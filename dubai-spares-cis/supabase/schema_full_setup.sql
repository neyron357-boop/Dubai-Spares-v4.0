-- ============================================
-- ПОЛНАЯ СХЕМА БАЗЫ ДАННЫХ DUBAI SPARES APP
-- ============================================

create extension if not exists pgcrypto;
create extension if not exists cube;
create extension if not exists earthdistance;

-- 1. ТАБЛИЦА: leads (лиды/заявки)
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  status text not null check (status in ('new', 'active', 'completed', 'cancelled')),
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

-- 2. ТАБЛИЦА: shops (магазины)
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

-- 3. ТАБЛИЦА: orders (заказы)
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  lead_id uuid references public.leads(id) on delete set null,
  shop_id uuid references public.shops(id) on delete set null,
  status text not null check (status in ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  total_amount decimal(10,2),
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_created_at on public.leads(created_at desc);
create index if not exists idx_leads_is_read on public.leads(is_read);
create index if not exists idx_shops_location on public.shops using gist(ll_to_earth(latitude, longitude));
create index if not exists idx_shops_active on public.shops(is_active);
create index if not exists idx_shops_brand on public.shops(brand);
create index if not exists idx_orders_lead_id on public.orders(lead_id);

alter table public.leads enable row level security;
alter table public.shops enable row level security;
alter table public.orders enable row level security;

drop policy if exists "Leads are viewable by authenticated users" on public.leads;
create policy "Leads are viewable by authenticated users"
  on public.leads for select
  using (auth.role() = 'authenticated');

drop policy if exists "Public shops are viewable by everyone" on public.shops;
create policy "Public shops are viewable by everyone"
  on public.shops for select
  using (is_active = true);

drop policy if exists "Authenticated users can update shops" on public.shops;
create policy "Authenticated users can update shops"
  on public.shops for update
  using (auth.role() = 'authenticated');

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_leads_updated_at on public.leads;
create trigger update_leads_updated_at before update on public.leads
for each row execute function public.update_updated_at_column();

drop trigger if exists update_shops_updated_at on public.shops;
create trigger update_shops_updated_at before update on public.shops
for each row execute function public.update_updated_at_column();

-- Тестовые магазины в Dubai
insert into public.shops (name, brand, latitude, longitude, address, phone, is_open_now, is_active, parts_categories, vehicle_brands)
values
  ('Auto Parts Center Dubai', 'General', 25.2048, 55.2708, 'Al Quoz Industrial Area 3, Dubai', '+971-4-XXX-XXXX', true, true,
   array['engine', 'transmission', 'suspension'],
   array['Toyota', 'Honda', 'Nissan']),
  ('Premium Auto Spares', 'Luxury', 25.1972, 55.2744, 'Sheikh Zayed Road, Dubai', '+971-4-XXX-XXXX', true, true,
   array['body_parts', 'electronics', 'interior'],
   array['BMW', 'Mercedes', 'Audi']),
  ('Dubai Spare Parts Trading', 'General', 25.2854, 55.3672, 'Deira, Dubai', '+971-4-XXX-XXXX', false, true,
   array['filters', 'oils', 'batteries'],
   array['Toyota', 'Nissan', 'Mitsubishi'])
on conflict do nothing;
