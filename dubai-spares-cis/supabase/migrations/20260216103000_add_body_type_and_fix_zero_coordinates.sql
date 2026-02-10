alter table if exists public.orders
  add column if not exists body_type text;

alter table if exists public.shops
  add column if not exists specialization_body_types text[] not null default '{}';

update public.shops
set latitude = null,
    longitude = null
where (latitude = 0 and longitude = 0)
   or latitude is null
   or longitude is null;
