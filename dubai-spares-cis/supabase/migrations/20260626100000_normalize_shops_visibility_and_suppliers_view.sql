-- =====================================================================
-- Normalize supplier visibility: every row from public.shops must be
-- visible in app supplier database, regardless of status/is_active flags.
-- Idempotent and safe for repeated execution.
-- =====================================================================

-- 1) Ensure key shops columns exist (for mixed historical schemas)
alter table public.shops
  add column if not exists status text,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_archived boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- 2) Remove legacy policies that could hide rows by status/is_active.
drop policy if exists "Public shops are viewable by everyone" on public.shops;
drop policy if exists "Authenticated users can update shops" on public.shops;
drop policy if exists "Leads are viewable by authenticated users" on public.shops;
drop policy if exists "anon_read_shops" on public.shops;
drop policy if exists "anon_write_shops" on public.shops;
drop policy if exists "authenticated_read_shops" on public.shops;
drop policy if exists "authenticated_write_shops" on public.shops;

-- 3) Canonical RLS: no row filtering for suppliers directory.
create policy "anon_read_shops"
  on public.shops
  for select
  to anon
  using (true);

create policy "authenticated_read_shops"
  on public.shops
  for select
  to authenticated
  using (true);

create policy "anon_write_shops"
  on public.shops
  for all
  to anon
  using (true)
  with check (true);

create policy "authenticated_write_shops"
  on public.shops
  for all
  to authenticated
  using (true)
  with check (true);

-- 4) Rebuild enriched suppliers view to guarantee no status/is_active filter.
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

-- 5) Re-apply grants needed by client reads.
grant usage on schema public to anon, authenticated;
grant select on public.shops to anon, authenticated;
grant select on public.v_shops_enriched to anon, authenticated;
grant all on public.shops to anon, authenticated;

-- 6) Refresh schema cache for PostgREST.
select public.refresh_schema_cache();
