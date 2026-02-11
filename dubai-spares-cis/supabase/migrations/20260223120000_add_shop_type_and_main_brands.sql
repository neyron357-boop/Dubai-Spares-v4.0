alter table if exists public.shops
  add column if not exists shop_type text not null default 'new_parts',
  add column if not exists main_brands text[] not null default '{}',
  add column if not exists zone text not null default '',
  add column if not exists heat_level integer not null default 0;

update public.shops
set main_brands = specialization
where coalesce(array_length(main_brands, 1), 0) = 0
  and coalesce(array_length(specialization, 1), 0) > 0;
