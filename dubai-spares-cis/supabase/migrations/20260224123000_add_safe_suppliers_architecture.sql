-- SUPPLIERS: Safe DB Architecture (Non-breaking)
-- 1) New normalized tables
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

create table if not exists public.shop_interactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  order_id uuid null,
  interaction_type text not null,
  status text null,
  notes text null,
  lat double precision null,
  lng double precision null,
  client_event_id uuid null,
  created_at timestamptz not null default now()
);

-- 2) Compatibility columns on shops
alter table if exists public.shops
  add column if not exists is_archived boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- 3) Indexes
create index if not exists idx_shop_specializations_shop_id on public.shop_specializations (shop_id);
create index if not exists idx_shop_specializations_brand on public.shop_specializations (brand);

create index if not exists idx_shop_interactions_shop_created_at
  on public.shop_interactions (shop_id, created_at desc);
create unique index if not exists idx_shop_interactions_client_event_id_unique
  on public.shop_interactions (client_event_id)
  where client_event_id is not null;

create index if not exists idx_shop_metrics_updated_at on public.shop_metrics (updated_at desc);

-- 4) RLS alignment (same open access pattern as shops)
alter table if exists public.shop_specializations enable row level security;
alter table if exists public.shop_metrics enable row level security;
alter table if exists public.shop_interactions enable row level security;

-- shop_specializations policies
drop policy if exists "anon_read_shop_specializations" on public.shop_specializations;
create policy "anon_read_shop_specializations"
  on public.shop_specializations
  for select
  using (true);

drop policy if exists "anon_write_shop_specializations" on public.shop_specializations;
create policy "anon_write_shop_specializations"
  on public.shop_specializations
  for all
  using (true)
  with check (true);

-- shop_metrics policies
drop policy if exists "anon_read_shop_metrics" on public.shop_metrics;
create policy "anon_read_shop_metrics"
  on public.shop_metrics
  for select
  using (true);

drop policy if exists "anon_write_shop_metrics" on public.shop_metrics;
create policy "anon_write_shop_metrics"
  on public.shop_metrics
  for all
  using (true)
  with check (true);

-- shop_interactions policies
drop policy if exists "anon_read_shop_interactions" on public.shop_interactions;
create policy "anon_read_shop_interactions"
  on public.shop_interactions
  for select
  using (true);

drop policy if exists "anon_write_shop_interactions" on public.shop_interactions;
create policy "anon_write_shop_interactions"
  on public.shop_interactions
  for all
  using (true)
  with check (true);

-- 5) Backfill
insert into public.shop_metrics (shop_id)
select s.id
from public.shops s
left join public.shop_metrics sm on sm.shop_id = s.id
where sm.shop_id is null;

insert into public.shop_specializations (shop_id, brand, is_primary)
select
  s.id,
  brand_item.brand,
  brand_item.ordinality = 1 as is_primary
from public.shops s
cross join lateral unnest(coalesce(s.main_brands, '{}'::text[])) with ordinality as brand_item(brand, ordinality)
left join public.shop_specializations ss
  on ss.shop_id = s.id
 and ss.brand = brand_item.brand
where coalesce(brand_item.brand, '') <> ''
  and ss.id is null;

-- 6) Enriched view for gradual adoption
create or replace view public.v_shops_enriched as
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
