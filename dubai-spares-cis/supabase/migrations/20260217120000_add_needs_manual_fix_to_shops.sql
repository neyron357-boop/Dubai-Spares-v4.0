alter table if exists public.shops
  add column if not exists needs_manual_fix boolean not null default false;
