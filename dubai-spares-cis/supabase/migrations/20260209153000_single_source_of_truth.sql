-- Single Source of Truth migration
-- 1) normalize order graph
-- 2) remove legacy JSONB payload shape
-- 3) provision storage bucket for image URLs

create extension if not exists pgcrypto;

-- Legacy cleanup (safe / idempotent)
alter table if exists public.orders drop column if exists data;
drop table if exists public.app_state;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  year text not null default '',
  vin text not null default '',
  status text not null default 'active' check (status in ('active','archive','sold','vip','lead','new_inquiry')),
  priority text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH')),
  client_name text not null default '',
  source text not null default 'Другое',
  customer_contact text not null default '',
  car_photo_url text,
  car_photos text[] not null default '{}',
  markup_percent numeric not null default 20,
  exchange_rate numeric not null default 3.67,
  is_archived boolean not null default false,
  is_sold boolean not null default false,
  sold_profit_usd numeric,
  is_vip boolean not null default false,
  is_pinned boolean not null default false,
  is_lead boolean not null default false,
  notes jsonb not null default '[]'::jsonb,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_parts_order_id on public.parts (order_id);
create index if not exists idx_variants_part_id on public.price_variants (part_id);

-- Supabase Storage bucket for uploaded image files.
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;
