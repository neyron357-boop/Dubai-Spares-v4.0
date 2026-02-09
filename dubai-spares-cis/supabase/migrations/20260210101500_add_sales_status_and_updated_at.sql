alter table public.orders
  add column if not exists sales_status text not null default 'Inquiry',
  add column if not exists updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint;

update public.orders
set updated_at = coalesce(updated_at, created_at)
where updated_at is null;
