alter table if exists public.orders
  add column if not exists dismissed_shop_ids text[] not null default '{}';
