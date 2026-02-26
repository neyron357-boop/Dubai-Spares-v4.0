-- ============================================================
-- Supplier base normalization (single source of truth: public.shops)
-- Idempotent and safe for repeated runs.
--
-- Goals:
-- 1) Ensure every supplier record is stored in public.shops with stable defaults.
-- 2) Ensure price variants can reference suppliers via price_variants.shop_id.
-- 3) Recreate public.v_shops_enriched without legacy/non-existent columns.
-- ============================================================

-- 1) shops schema hardening
alter table if exists public.shops
  add column if not exists is_archived boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists specialization text[] not null default '{}',
  add column if not exists specialization_models text[] not null default '{}',
  add column if not exists specialization_years integer[] not null default '{}',
  add column if not exists updated_at timestamptz not null default now();

update public.shops
set is_archived = false
where is_archived is null;

alter table if exists public.shops
  alter column is_archived set default false,
  alter column is_active set default true,
  alter column specialization set default '{}',
  alter column specialization_models set default '{}',
  alter column specialization_years set default '{}';

-- 2) price_variants → shops reference
alter table if exists public.price_variants
  add column if not exists shop_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'price_variants_shop_id_fkey'
      and conrelid = 'public.price_variants'::regclass
  ) then
    alter table public.price_variants
      add constraint price_variants_shop_id_fkey
      foreign key (shop_id)
      references public.shops(id)
      on delete set null;
  end if;
end
$$;

create index if not exists idx_price_variants_shop_id
  on public.price_variants(shop_id);

create index if not exists idx_shops_is_archived
  on public.shops(is_archived);

create index if not exists idx_shops_is_active
  on public.shops(is_active);

create index if not exists idx_shops_specialization
  on public.shops using gin(specialization);

create index if not exists idx_shops_specialization_models
  on public.shops using gin(specialization_models);

create index if not exists idx_shops_specialization_years
  on public.shops using gin(specialization_years);

-- 3) Stable enriched view (no legacy status dependency)
create or replace view public.v_shops_enriched as
select
  s.id,
  s.name,
  s.phone,
  s.whatsapp,
  s.location,
  s.latitude,
  s.longitude,
  s.zone,
  s.shop_type,
  s.heat_level,
  s.auto_trust_score,
  s.main_brands,
  s.specialization,
  s.specialization_models,
  s.specialization_years,
  s.specialization_body_types,
  s.specialization_tag,
  s.is_active,
  s.is_archived,
  s.created_at,
  s.updated_at,
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
  m.auto_trust_score as metrics_auto_trust_score,
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

-- 4) schema cache refresh
select public.refresh_schema_cache();

