-- Ensure public form orders are tracked as unread until viewed in Active orders.
alter table if exists public.orders
  add column if not exists lead_unread boolean not null default false,
  add column if not exists lead_read_at bigint;

update public.orders
set lead_unread = true
where coalesce(lead_source, 'manual') = 'public_form'
  and coalesce(lead_unread, false) = false
  and lead_read_at is null;

update public.orders
set lead_read_at = floor(extract(epoch from now()) * 1000)::bigint
where coalesce(lead_source, 'manual') = 'public_form'
  and coalesce(lead_unread, false) = false
  and lead_read_at is null;
