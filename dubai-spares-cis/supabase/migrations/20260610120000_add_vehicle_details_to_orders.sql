alter table public.orders
  add column if not exists vehicle_details jsonb not null default '{}'::jsonb;
