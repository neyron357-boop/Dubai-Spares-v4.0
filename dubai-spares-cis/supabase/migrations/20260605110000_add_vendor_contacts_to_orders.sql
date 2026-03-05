alter table if exists public.orders
  add column if not exists vendor_contacts jsonb not null default '[]'::jsonb;
