-- Add missing markup columns used by the client app projection.
alter table public.orders
  add column if not exists markup_type text not null default 'percent'
  check (markup_type in ('percent', 'fixed'));

alter table public.orders
  add column if not exists markup_fixed_aed numeric not null default 0;
