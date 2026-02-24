create extension if not exists pgcrypto;

-- RADAR core session anchor
create table if not exists public.radar_sessions (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  is_active boolean not null default true,
  is_archived boolean not null default false,
  mode text not null default 'smart' check (mode in ('smart', 'chain', 'manual')),
  radius_km integer not null default 10,
  filters_json jsonb not null default '{}'::jsonb,
  notes text
);

create index if not exists idx_radar_sessions_order_created
  on public.radar_sessions (order_id, created_at desc);

create index if not exists idx_radar_sessions_active
  on public.radar_sessions (is_active)
  where is_active = true and is_archived = false;

-- RADAR session targets (shop candidates)
create table if not exists public.radar_targets (
  id uuid primary key default gen_random_uuid(),
  radar_session_id uuid not null references public.radar_sessions(id) on delete cascade,
  shop_id uuid not null references public.shops(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_archived boolean not null default false,
  status text not null default 'planned' check (status in ('planned', 'in_route', 'at_shop', 'done', 'hidden')),
  score integer not null default 0,
  distance_km numeric(6,2),
  eta_min integer,
  route_order integer
);

create unique index if not exists uq_radar_targets_session_shop
  on public.radar_targets (radar_session_id, shop_id);

create index if not exists idx_radar_targets_session_status
  on public.radar_targets (radar_session_id, status);

create index if not exists idx_radar_targets_shop_updated
  on public.radar_targets (shop_id, updated_at desc);

-- RADAR event log (immutable journal, idempotent by client_event_id)
create table if not exists public.radar_events (
  id uuid primary key default gen_random_uuid(),
  radar_session_id uuid not null references public.radar_sessions(id) on delete cascade,
  radar_target_id uuid references public.radar_targets(id) on delete set null,
  shop_id uuid references public.shops(id) on delete set null,
  event_type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  client_event_id uuid,
  created_at timestamptz not null default now(),
  is_archived boolean not null default false
);

create index if not exists idx_radar_events_session_created
  on public.radar_events (radar_session_id, created_at desc);

create index if not exists idx_radar_events_shop_created
  on public.radar_events (shop_id, created_at desc);

create unique index if not exists uq_radar_events_client_event_id_not_null
  on public.radar_events (client_event_id)
  where client_event_id is not null;

-- Optional read model for UI: latest active session targets by order
create or replace view public.v_radar_active_targets as
with latest_active_session as (
  select distinct on (rs.order_id)
    rs.id,
    rs.order_id,
    rs.mode,
    rs.radius_km,
    rs.filters_json,
    rs.created_at
  from public.radar_sessions rs
  where rs.is_active = true
    and rs.is_archived = false
    and rs.ended_at is null
  order by rs.order_id, rs.created_at desc
)
select
  las.order_id,
  las.id as radar_session_id,
  rt.id as radar_target_id,
  rt.shop_id,
  rt.status,
  rt.score,
  rt.distance_km,
  rt.eta_min,
  rt.route_order,
  rt.updated_at,
  s.name as shop_name,
  s.phone as shop_phone,
  s.location as shop_location,
  s.latitude,
  s.longitude
from latest_active_session las
join public.radar_targets rt
  on rt.radar_session_id = las.id
 and rt.is_archived = false
join public.shops s
  on s.id = rt.shop_id;

-- Minimal RPC helper: create session + event
create or replace function public.radar_create_session(
  p_order_id text,
  p_radius_km integer default 10,
  p_mode text default 'smart',
  p_filters_json jsonb default '{}'::jsonb,
  p_notes text default null,
  p_client_event_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  insert into public.radar_sessions (
    order_id,
    radius_km,
    mode,
    filters_json,
    notes
  )
  values (
    p_order_id,
    coalesce(p_radius_km, 10),
    coalesce(p_mode, 'smart'),
    coalesce(p_filters_json, '{}'::jsonb),
    p_notes
  )
  returning id into v_session_id;

  if p_client_event_id is not null then
    insert into public.radar_events (
      radar_session_id,
      event_type,
      payload_json,
      client_event_id
    )
    values (
      v_session_id,
      'created_session',
      jsonb_build_object('order_id', p_order_id),
      p_client_event_id
    )
    on conflict (client_event_id) where client_event_id is not null do nothing;
  else
    insert into public.radar_events (
      radar_session_id,
      event_type,
      payload_json
    )
    values (
      v_session_id,
      'created_session',
      jsonb_build_object('order_id', p_order_id)
    );
  end if;

  return v_session_id;
end;
$$;

-- Minimal RPC helper: upsert target + event
create or replace function public.radar_add_target(
  p_session_id uuid,
  p_shop_id uuid,
  p_score integer default 0,
  p_distance_km numeric default null,
  p_eta_min integer default null,
  p_route_order integer default null,
  p_client_event_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_id uuid;
begin
  insert into public.radar_targets (
    radar_session_id,
    shop_id,
    score,
    distance_km,
    eta_min,
    route_order,
    updated_at
  )
  values (
    p_session_id,
    p_shop_id,
    coalesce(p_score, 0),
    p_distance_km,
    p_eta_min,
    p_route_order,
    now()
  )
  on conflict (radar_session_id, shop_id)
  do update set
    score = excluded.score,
    distance_km = excluded.distance_km,
    eta_min = excluded.eta_min,
    route_order = excluded.route_order,
    updated_at = now(),
    is_archived = false
  returning id into v_target_id;

  if p_client_event_id is not null then
    insert into public.radar_events (
      radar_session_id,
      radar_target_id,
      shop_id,
      event_type,
      payload_json,
      client_event_id
    )
    values (
      p_session_id,
      v_target_id,
      p_shop_id,
      'add_target',
      jsonb_build_object(
        'score', coalesce(p_score, 0),
        'distance_km', p_distance_km,
        'eta_min', p_eta_min,
        'route_order', p_route_order
      ),
      p_client_event_id
    )
    on conflict (client_event_id) where client_event_id is not null do nothing;
  else
    insert into public.radar_events (
      radar_session_id,
      radar_target_id,
      shop_id,
      event_type,
      payload_json
    )
    values (
      p_session_id,
      v_target_id,
      p_shop_id,
      'add_target',
      jsonb_build_object(
        'score', coalesce(p_score, 0),
        'distance_km', p_distance_km,
        'eta_min', p_eta_min,
        'route_order', p_route_order
      )
    );
  end if;

  return v_target_id;
end;
$$;

grant select on public.v_radar_active_targets to anon, authenticated;
grant execute on function public.radar_create_session(text, integer, text, jsonb, text, uuid) to anon, authenticated;
grant execute on function public.radar_add_target(uuid, uuid, integer, numeric, integer, integer, uuid) to anon, authenticated;
