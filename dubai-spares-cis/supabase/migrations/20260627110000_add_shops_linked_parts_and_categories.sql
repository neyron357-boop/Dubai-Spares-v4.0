alter table if exists public.shops
  add column if not exists specialization_categories text[] not null default '{}',
  add column if not exists linked_parts jsonb not null default '[]'::jsonb;
