alter table public.orders
  add column if not exists discount_type text not null default 'percent',
  add column if not exists discount_percent numeric not null default 0,
  add column if not exists discount_fixed_aed numeric not null default 0,
  add column if not exists search_deposit_amount numeric not null default 0,
  add column if not exists search_deposit_currency text,
  add column if not exists search_deposit_exchange_rate numeric not null default 0,
  add column if not exists search_deposit_amount_aed numeric not null default 0,
  add column if not exists search_deposit_paid_at timestamptz;

grant select on public.v_shops_enriched to anon, authenticated;
