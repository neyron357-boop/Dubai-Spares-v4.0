alter table if exists public.orders
  add column if not exists payment_status text not null default 'none';

alter table if exists public.orders
  drop constraint if exists orders_payment_status_check;

alter table if exists public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('none', 'search_deposit_paid', 'full_prepayment_paid'));
