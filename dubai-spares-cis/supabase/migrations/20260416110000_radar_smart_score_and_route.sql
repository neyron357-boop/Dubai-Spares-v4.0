-- Radar SMART score + auto targeting + route ordering (safe/light)

alter table if exists public.radar_targets
  add column if not exists score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists matched_brands text[] not null default '{}'::text[],
  add column if not exists matched_categories text[] not null default '{}'::text[],
  add column if not exists distance_km double precision,
  add column if not exists eta_min int,
  add column if not exists route_order int;

create index if not exists idx_radar_targets_session_score
  on public.radar_targets (radar_session_id, score desc);
create index if not exists idx_radar_targets_session_route
  on public.radar_targets (radar_session_id, route_order);
create index if not exists idx_shop_specializations_shop_brand
  on public.shop_specializations (shop_id, brand);
create index if not exists idx_order_items_order_id_brand
  on public.order_items (order_id, brand);

create or replace view public.v_radar_active_targets as
select
  rt.id,
  rt.radar_session_id,
  rt.shop_id,
  rt.score,
  rt.status,
  rt.distance_km,
  rt.eta_min,
  rt.route_order,
  rt.score_breakdown,
  rt.matched_brands,
  rt.matched_categories,
  rt.created_at,
  rt.updated_at,
  s.name as shop_name,
  s.phone as shop_phone,
  s.whatsapp as shop_whatsapp,
  s.location as shop_location
from public.radar_targets rt
left join public.shops s on s.id = rt.shop_id
order by rt.route_order nulls last, rt.score desc, rt.created_at asc;

grant select on public.v_radar_active_targets to anon, authenticated, service_role;

create or replace function public.radar_generate_targets(
  p_session_id uuid,
  p_max_targets int default 30,
  p_user_lat double precision default null,
  p_user_lng double precision default null
)
returns table (radar_session_id uuid, generated_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_order_id text;
  v_filters jsonb := '{}'::jsonb;
  v_has_filters boolean := false;
  v_order_json jsonb := '{}'::jsonb;
  v_order_brand text;
  v_order_model text;
  v_order_year int;
  v_user_lat double precision := coalesce(p_user_lat, 25.2048);
  v_user_lng double precision := coalesce(p_user_lng, 55.2708);
  v_limit int := greatest(1, least(coalesce(p_max_targets, 30), 100));
  v_has_order_items boolean := false;
  v_inserted int := 0;
  v_current_lat double precision;
  v_current_lng double precision;
  v_next_id uuid;
  v_next_lat double precision;
  v_next_lng double precision;
  v_route int := 1;
begin
  select * into v_session
  from public.radar_sessions rs
  where rs.id = p_session_id;

  if not found then
    raise exception 'Radar session not found: %', p_session_id;
  end if;

  v_order_id := v_session.order_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'radar_sessions'
      and column_name = 'filters_json'
  ) into v_has_filters;

  if v_has_filters then
    execute 'select coalesce(filters_json, ''{}''::jsonb) from public.radar_sessions where id = $1'
    into v_filters using p_session_id;
  end if;

  if v_order_id is not null then
    select to_jsonb(o) into v_order_json
    from public.orders o
    where o.id::text = v_order_id
    limit 1;
  end if;

  v_order_brand := nullif(lower(trim(coalesce(v_order_json->>'brand', ''))), '');
  v_order_model := nullif(lower(trim(coalesce(v_order_json->>'model', ''))), '');
  v_order_year := nullif(v_order_json->>'year', '')::int;

  if to_regclass('public.order_items') is not null and v_order_id is not null then
    select exists(select 1 from public.order_items oi where oi.order_id = v_order_id)
    into v_has_order_items;
  end if;

  create temporary table if not exists tmp_radar_candidates (
    shop_id uuid primary key,
    lat double precision,
    lng double precision,
    distance_km double precision,
    eta_min int,
    score int,
    score_breakdown jsonb,
    matched_brands text[],
    matched_categories text[]
  ) on commit drop;

  truncate table tmp_radar_candidates;

  with order_item_agg as (
    select
      array_remove(array_agg(distinct nullif(lower(trim(coalesce(oi.brand, ''))), '')), null) as brands,
      array_remove(array_agg(distinct nullif(lower(trim(coalesce(to_jsonb(oi)->>'category', ''))), '')), null) as categories,
      array_remove(array_agg(distinct nullif(lower(trim(coalesce(oi.model, ''))), '')), null) as models,
      array_remove(array_agg(distinct oi.year), null) as years
    from public.order_items oi
    where v_has_order_items
      and oi.order_id = v_order_id
  ),
  candidates as (
    select
      s.id as shop_id,
      s.latitude as lat,
      s.longitude as lng,
      coalesce(sm.auto_trust_score, 50) as auto_trust_score,
      coalesce(sm.heat_level, 0) as heat_level,
      coalesce(sm.has_delivery, false) as has_delivery,
      coalesce(sm.fast_whatsapp, false) as fast_whatsapp,
      coalesce(sm.manual_trust_level, 3) as manual_trust_level,
      coalesce(array_remove(array_agg(distinct lower(ss.brand)), null), '{}'::text[]) as spec_brands,
      coalesce(array_remove(array_agg(distinct lower(c.category)), null), '{}'::text[]) as spec_categories,
      coalesce(array_remove(array_agg(distinct lower(m.model)), null), '{}'::text[]) as spec_models,
      coalesce(array_remove(array_agg(distinct y.year), null), '{}'::int[]) as spec_years,
      coalesce(array_remove(array_agg(distinct lower(mb.brand)), null), '{}'::text[]) as main_brands,
      lower(coalesce(s.shop_type, '')) as shop_type
    from public.shops s
    left join public.shop_metrics sm on sm.shop_id = s.id
    left join public.shop_specializations ss on ss.shop_id = s.id
    left join lateral unnest(ss.categories) as c(category) on true
    left join lateral unnest(ss.models) as m(model) on true
    left join lateral unnest(ss.years) as y(year) on true
    left join lateral unnest(coalesce(s.main_brands, '{}'::text[])) as mb(brand) on true
    where coalesce(s.is_archived, false) = false
      and (
        (to_jsonb(s) ? 'is_active' and coalesce((to_jsonb(s)->>'is_active')::boolean, true) = true)
        or not (to_jsonb(s) ? 'is_active')
      )
      and (
        (v_filters ? 'zone') is false
        or coalesce(s.zone, '') = coalesce(v_filters->>'zone', '')
      )
      and (
        (v_filters ? 'shop_type') is false
        or lower(coalesce(s.shop_type, '')) = lower(coalesce(v_filters->>'shop_type', ''))
      )
    group by s.id, s.latitude, s.longitude, sm.auto_trust_score, sm.heat_level, sm.has_delivery, sm.fast_whatsapp, sm.manual_trust_level, s.shop_type
  )
  insert into tmp_radar_candidates (shop_id, lat, lng, distance_km, eta_min, score, score_breakdown, matched_brands, matched_categories)
  select
    c.shop_id,
    c.lat,
    c.lng,
    round((6371 * acos(least(1, greatest(-1,
      cos(radians(v_user_lat)) * cos(radians(c.lat)) * cos(radians(c.lng) - radians(v_user_lng))
      + sin(radians(v_user_lat)) * sin(radians(c.lat))
    ))))::numeric, 2)::double precision as distance_km,
    greatest(1, round(((6371 * acos(least(1, greatest(-1,
      cos(radians(v_user_lat)) * cos(radians(c.lat)) * cos(radians(c.lng) - radians(v_user_lng))
      + sin(radians(v_user_lat)) * sin(radians(c.lat))
    )))) / 40.0 * 60.0))::int) as eta_min,
    least(100, greatest(0, match_points + trust_points + heat_points + distance_points + extras_points)) as total_score,
    jsonb_build_object(
      'match', match_points,
      'trust', trust_points,
      'heat', heat_points,
      'distance', distance_points,
      'extras', extras_points,
      'total', least(100, greatest(0, match_points + trust_points + heat_points + distance_points + extras_points))
    ) as score_breakdown,
    matched_brands,
    matched_categories
  from (
    select
      c.*,
      coalesce(oi.brands, '{}'::text[]) as order_brands,
      coalesce(oi.categories, '{}'::text[]) as order_categories,
      coalesce(oi.models, '{}'::text[]) as order_models,
      coalesce(oi.years, '{}'::int[]) as order_years,
      coalesce((select array_agg(distinct b) from unnest(c.spec_brands || c.main_brands) b where b <> ''), '{}'::text[]) as all_shop_brands,
      (select coalesce(array_remove(array_agg(distinct b), null), '{}'::text[]) from unnest(coalesce(oi.brands, '{}'::text[])) b where b = any(c.spec_brands || c.main_brands)) as matched_brands,
      (select coalesce(array_remove(array_agg(distinct cat), null), '{}'::text[]) from unnest(coalesce(oi.categories, '{}'::text[])) cat where cat = any(c.spec_categories)) as matched_categories,
      case
        when v_has_order_items then
          (case when exists (select 1 from unnest(coalesce(oi.brands, '{}'::text[])) b where b = any(c.spec_brands || c.main_brands)) then 20 else 0 end)
          + (case when exists (select 1 from unnest(coalesce(oi.categories, '{}'::text[])) cat where cat = any(c.spec_categories)) then 10 else 0 end)
          + (case when exists (select 1 from unnest(coalesce(oi.years, '{}'::int[])) yy where yy = any(c.spec_years)) then 5 else 0 end)
          + (case when exists (select 1 from unnest(coalesce(oi.models, '{}'::text[])) md where md = any(c.spec_models)) then 5 else 0 end)
        else
          (case when v_order_brand is not null and v_order_brand = any(c.spec_brands || c.main_brands) then 25 else 0 end)
          + (case when (v_order_json ? 'shop_type') and lower(coalesce(v_order_json->>'shop_type','')) = c.shop_type and c.shop_type <> '' then 15 else 0 end)
      end as match_points,
      round(coalesce(c.auto_trust_score, 50) * 0.25)::int as trust_points,
      least(15, round(coalesce(c.heat_level, 0) / 10.0)::int) as heat_points,
      case
        when d.distance_km <= 2 then 15
        when d.distance_km <= 5 then 12
        when d.distance_km <= 10 then 9
        when d.distance_km <= 20 then 6
        when d.distance_km <= 50 then 3
        else 0
      end as distance_points,
      (
        (case when c.has_delivery then 2 else 0 end)
        + (case when c.fast_whatsapp then 2 else 0 end)
        + (case when c.manual_trust_level >= 4 then 1 else 0 end)
      ) as extras_points
    from candidates c
    cross join lateral (
      select round((6371 * acos(least(1, greatest(-1,
        cos(radians(v_user_lat)) * cos(radians(c.lat)) * cos(radians(c.lng) - radians(v_user_lng))
        + sin(radians(v_user_lat)) * sin(radians(c.lat))
      ))))::numeric, 2)::double precision as distance_km
    ) d
    left join order_item_agg oi on true
  ) scored
  order by total_score desc, distance_km asc
  limit v_limit;

  insert into public.radar_targets (
    radar_session_id,
    shop_id,
    score,
    status,
    distance_km,
    eta_min,
    route_order,
    score_breakdown,
    matched_brands,
    matched_categories,
    updated_at
  )
  select
    p_session_id,
    t.shop_id,
    t.score,
    'planned',
    t.distance_km,
    t.eta_min,
    null,
    t.score_breakdown,
    t.matched_brands,
    t.matched_categories,
    now()
  from tmp_radar_candidates t
  on conflict (radar_session_id, shop_id)
  do update set
    score = excluded.score,
    status = case when public.radar_targets.status in ('done', 'at_shop') then public.radar_targets.status else 'planned' end,
    distance_km = excluded.distance_km,
    eta_min = excluded.eta_min,
    route_order = null,
    score_breakdown = excluded.score_breakdown,
    matched_brands = excluded.matched_brands,
    matched_categories = excluded.matched_categories,
    updated_at = now();

  get diagnostics v_inserted = row_count;

  v_current_lat := v_user_lat;
  v_current_lng := v_user_lng;

  loop
    select t.shop_id, t.lat, t.lng
    into v_next_id, v_next_lat, v_next_lng
    from tmp_radar_candidates t
    where not exists (
      select 1
      from public.radar_targets rt
      where rt.radar_session_id = p_session_id
        and rt.shop_id = t.shop_id
        and rt.route_order is not null
    )
    order by (6371 * acos(least(1, greatest(-1,
      cos(radians(v_current_lat)) * cos(radians(t.lat)) * cos(radians(t.lng) - radians(v_current_lng))
      + sin(radians(v_current_lat)) * sin(radians(t.lat))
    )))) asc
    limit 1;

    exit when v_next_id is null;

    update public.radar_targets
    set route_order = v_route,
        updated_at = now()
    where radar_session_id = p_session_id
      and shop_id = v_next_id;

    v_route := v_route + 1;
    v_current_lat := v_next_lat;
    v_current_lng := v_next_lng;
    v_next_id := null;
  end loop;

  insert into public.radar_events (radar_session_id, event_type, payload)
  values (
    p_session_id,
    'generated_targets',
    jsonb_build_object(
      'count', (select count(*) from tmp_radar_candidates),
      'max_targets', v_limit,
      'user_lat', v_user_lat,
      'user_lng', v_user_lng,
      'at', now()
    )
  );

  insert into public.radar_events (radar_session_id, event_type, payload)
  values (
    p_session_id,
    'route_computed',
    jsonb_build_object(
      'count', (select count(*) from tmp_radar_candidates),
      'at', now()
    )
  );

  return query
  select p_session_id, (select count(*)::int from tmp_radar_candidates);
end;
$$;

grant execute on function public.radar_generate_targets(uuid, int, double precision, double precision)
  to anon, authenticated, service_role;
