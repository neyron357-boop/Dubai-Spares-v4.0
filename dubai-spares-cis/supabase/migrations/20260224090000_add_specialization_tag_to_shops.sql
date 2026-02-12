alter table public.shops
  add column if not exists specialization_tag text;

create index if not exists idx_shops_specialization_tag on public.shops (specialization_tag);
