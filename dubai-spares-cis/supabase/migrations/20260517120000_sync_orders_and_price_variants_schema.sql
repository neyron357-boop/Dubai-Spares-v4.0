-- Sync production schema with current app contract.
-- Fixes missing columns and expands orders.status allowed values.

-- orders: app expects these columns to exist in all environments.
alter table if exists public.orders
  add column if not exists payment_status text not null default 'none',
  add column if not exists public_quote_token text,
  add column if not exists search_deposit_status text not null default 'not_required';

-- Keep payment/search deposit enums aligned with app types.
alter table if exists public.orders
  drop constraint if exists orders_payment_status_check;

alter table if exists public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('none', 'search_deposit_paid', 'full_prepayment_paid'));

alter table if exists public.orders
  drop constraint if exists orders_search_deposit_status_check;

alter table if exists public.orders
  add constraint orders_search_deposit_status_check
  check (search_deposit_status in ('not_required', 'pending', 'paid'));

-- orders.status: include statuses used by the app.
alter table if exists public.orders
  drop constraint if exists orders_status_check;

alter table if exists public.orders
  add constraint orders_status_check
  check (status in (
    'active',
    'archive',
    'sold',
    'vip',
    'lead',
    'new_inquiry',
    'in_progress',
    'waiting_deposit'
  ));

-- price_variants: app reads/writes these fields.
alter table if exists public.price_variants
  add column if not exists order_id text,
  add column if not exists currency text,
  add column if not exists delivery_eta text,
  add column if not exists location_text text,
  add column if not exists maps_url text,
  add column if not exists is_best boolean not null default false,
  add column if not exists note text;

create index if not exists idx_price_variants_order_id on public.price_variants (order_id);
