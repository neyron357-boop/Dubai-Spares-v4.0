alter table public.orders
  add column if not exists contact_links jsonb;
