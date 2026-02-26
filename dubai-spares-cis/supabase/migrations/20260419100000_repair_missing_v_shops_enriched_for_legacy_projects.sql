-- Repair migration for legacy Supabase projects where supplier migrations were skipped.
-- Ensures dependent tables/columns exist and recreates public.v_shops_enriched.

create table if not exists public.shop_metrics (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  total_interactions int not null default 0,
  total_found int not null default 0,
  total_not_found int not null default 0,
  total_wrong_info int not null default 0,
  total_follow_up int not null default 0,
  last_interaction_at timestamptz null,
  avg_response_time_min int null,
  has_delivery boolean not null default false,
  fast_whatsapp boolean not null default false,
  manual_trust_level int not null default 3,
  auto_trust_score int not null default 50,
  success_rate numeric(5,2) not null default 0,
  heat_level int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_specializations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  brand text not null,
  models text[] not null default '{}',
  years integer[] not null default '{}',
  categories text[] not null default '{}',
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

alter table if exists public.shops
  add column if not exists shop_type text,
  add column if not exists heat_level int not null default 0,
  add column if not exists auto_trust_score int not null default 50,
  add column if not exists main_brands text[] not null default '{}',
  add column if not exists specialization text[] not null default '{}',
  add column if not exists specialization_models text[] not null default '{}',
  add column if not exists specialization_years integer[] not null default '{}',
  add column if not exists specialization_body_types text[] not null default '{}',
  add column if not exists specialization_tag text,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_archived boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.shops
set
  heat_level = coalesce(heat_level, 0),
  auto_trust_score = coalesce(auto_trust_score, 50),
  main_brands = coalesce(main_brands, '{}'::text[]),
  specialization = coalesce(specialization, '{}'::text[]),
  specialization_models = coalesce(specialization_models, '{}'::text[]),
  specialization_years = coalesce(specialization_years, '{}'::integer[]),
  specialization_body_types = coalesce(specialization_body_types, '{}'::text[]),
  is_active = coalesce(is_active, true),
  is_archived = coalesce(is_archived, false),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

insert into public.shop_metrics (shop_id)
select s.id
from public.shops s
left join public.shop_metrics sm on sm.shop_id = s.id
where sm.shop_id is null;

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

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'refresh_schema_cache'
  ) then
    perform public.refresh_schema_cache();
  end if;
end
$$;
