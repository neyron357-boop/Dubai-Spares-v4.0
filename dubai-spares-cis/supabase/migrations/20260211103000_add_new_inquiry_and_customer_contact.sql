alter table if exists public.orders
  add column if not exists customer_contact text not null default '';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'orders_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders drop constraint orders_status_check;
  end if;
end $$;

alter table if exists public.orders
  add constraint orders_status_check
  check (status in ('active','archive','sold','vip','lead','new_inquiry'));
