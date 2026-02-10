alter table if exists public.orders
  drop constraint if exists orders_status_check;

alter table if exists public.orders
  add constraint orders_status_check
  check (status in ('active','archive','sold','vip','lead','new_inquiry','in_progress'));

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  location text not null default '',
  latitude double precision,
  longitude double precision,
  specialization text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.shops
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists specialization text[] not null default '{}';

create index if not exists idx_shops_geo on public.shops (latitude, longitude);
