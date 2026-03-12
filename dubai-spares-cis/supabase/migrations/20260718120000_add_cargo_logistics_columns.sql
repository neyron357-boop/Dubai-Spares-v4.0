-- Add cargo_place_group to parts table (missing column used in app code)
alter table public.parts
  add column if not exists cargo_place_group text not null default '';

-- Add dedicated top-level logistics columns to orders for reliable persistence.
-- These mirror the same fields stored in the logistics JSONB and serve as a
-- backup / source of truth when the JSONB is null or incomplete.
alter table public.orders
  add column if not exists cargo_country text not null default '',
  add column if not exists delivery_aed  numeric not null default 0,
  add column if not exists packing_aed   numeric not null default 0,
  add column if not exists service_fee_aed numeric not null default 0;

-- Back-fill the new dedicated columns from existing logistics JSONB so that
-- already-saved orders do not lose their data.
update public.orders
set
  cargo_country    = coalesce(nullif(trim(logistics ->> 'cargoCountry'), ''), ''),
  delivery_aed     = coalesce((logistics ->> 'deliveryAed')::numeric,  0),
  packing_aed      = coalesce((logistics ->> 'packingAed')::numeric,   0),
  service_fee_aed  = coalesce((logistics ->> 'serviceFeeAed')::numeric, 0)
where logistics is not null;
