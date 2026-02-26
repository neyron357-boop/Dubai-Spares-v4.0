-- Ensure supplier base always reflects ALL rows from public.shops,
-- regardless of status/is_active and independent of role (anon/authenticated).

-- 0) Bring shops schema to a canonical shape first.
--    Every column here is added idempotently to avoid migration failures
--    on older environments with partial schema.
alter table public.shops
  add column if not exists whatsapp                  text,
  add column if not exists location                  text,
  add column if not exists shop_type                 text,
  add column if not exists zone                      text,
  add column if not exists main_brands               text[],
  add column if not exists specialization            text[],
  add column if not exists specialization_models     text[],
  add column if not exists specialization_years      integer[],
  add column if not exists specialization_body_types text[],
  add column if not exists heat_level                integer,
  add column if not exists updated_at                timestamptz;

-- 1) Normalize nullable/text-array fields in shops to canonical defaults.
update public.shops
set
  name = coalesce(nullif(trim(name), ''), 'Shop'),
  phone = coalesce(phone, ''),
  whatsapp = coalesce(whatsapp, ''),
  location = coalesce(location, ''),
  shop_type = coalesce(nullif(trim(shop_type), ''), 'new_parts'),
  zone = coalesce(zone, ''),
  main_brands = coalesce(main_brands, '{}'::text[]),
  specialization = coalesce(specialization, '{}'::text[]),
  specialization_models = coalesce(specialization_models, '{}'::text[]),
  specialization_years = coalesce(specialization_years, '{}'::integer[]),
  specialization_body_types = coalesce(specialization_body_types, '{}'::text[]),
  heat_level = coalesce(heat_level, 0),
  updated_at = coalesce(updated_at, now())
where true;

-- 2) Canonical RLS: read for anon/authenticated without filtering by status flags.
--    This guarantees app-side supplier list can include every shop row.
drop policy if exists "anon_read_shops" on public.shops;
create policy "anon_read_shops"
  on public.shops for select to anon
  using (true);

drop policy if exists "authenticated_read_shops" on public.shops;
create policy "authenticated_read_shops"
  on public.shops for select to authenticated
  using (true);

-- 3) Keep broad write access model already used by the app.
drop policy if exists "anon_write_shops" on public.shops;
create policy "anon_write_shops"
  on public.shops for all to anon
  using (true) with check (true);

drop policy if exists "authenticated_write_shops" on public.shops;
create policy "authenticated_write_shops"
  on public.shops for all to authenticated
  using (true) with check (true);

-- 4) Enriched view must remain a 1:1 superset over shops (no status/is_active filtering).
--    Drop first to avoid CREATE OR REPLACE column-position conflicts on legacy view shapes.
drop view if exists public.v_shops_enriched;
create view public.v_shops_enriched as
select
  s.*,
  m.total_interactions,
  m.total_found,
  m.total_not_found,
  m.total_wrong_info,
  m.total_follow_up,
  m.last_interaction_at,
  m.avg_response_time_min,
  m.has_delivery,
  m.fast_whatsapp,
  m.manual_trust_level,
  m.auto_trust_score,
  m.success_rate,
  m.heat_level as metrics_heat_level,
  m.updated_at as metrics_updated_at,
  coalesce(sp.brands, '{}'::text[]) as specialization_brands,
  coalesce(sp.categories, '{}'::text[]) as specialization_categories
from public.shops s
left join public.shop_metrics m on m.shop_id = s.id
left join lateral (
  select
    array_remove(array_agg(distinct ss.brand), null) as brands,
    array_remove(array_agg(distinct c.category), null) as categories
  from public.shop_specializations ss
  left join lateral unnest(ss.categories) as c(category) on true
  where ss.shop_id = s.id
) sp on true;

grant select on public.v_shops_enriched to anon, authenticated, service_role;

-- 5) Make sure API roles can read/update shops.
grant all on table public.shops to anon, authenticated;

select public.refresh_schema_cache();
