alter table public.price_variants
  add column if not exists purchase_price_aed numeric,
  add column if not exists sale_price_aed numeric;

update public.price_variants
set
  purchase_price_aed = coalesce(purchase_price_aed, price_aed),
  sale_price_aed = coalesce(sale_price_aed, price_aed)
where purchase_price_aed is null or sale_price_aed is null;
