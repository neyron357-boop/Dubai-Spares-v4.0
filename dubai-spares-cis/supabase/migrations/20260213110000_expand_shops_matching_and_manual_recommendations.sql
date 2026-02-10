alter table if exists public.shops
  add column if not exists specialization_models text[] not null default '{}',
  add column if not exists specialization_years integer[] not null default '{}';

alter table if exists public.orders
  add column if not exists recommended_shop_ids text[] not null default '{}';
