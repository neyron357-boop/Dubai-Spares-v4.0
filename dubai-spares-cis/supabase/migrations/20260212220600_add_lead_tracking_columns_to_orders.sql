alter table if exists public.orders
  add column if not exists lead_unread boolean not null default false,
  add column if not exists lead_source text not null default 'manual',
  add column if not exists lead_read_at timestamp with time zone;
