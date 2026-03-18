-- ============================================================
-- Order Lifecycle "Transparent Pipeline" tables
-- ============================================================

-- 1. Add hunt_status column to orders
alter table public.orders
  add column if not exists hunt_status text not null default 'data_gathering'
  check (hunt_status in ('data_gathering', 'live_hunt', 'final_offer'));

-- 2. Hunt sessions – one active session per order during the hunt phase
create table if not exists public.order_hunt_sessions (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null,
  status      text not null default 'active'
              check (status in ('active', 'ended')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);

create index if not exists order_hunt_sessions_order_id_idx
  on public.order_hunt_sessions (order_id);

-- 3. Hunt waypoints – shop visit pins recorded during the hunt
create table if not exists public.order_hunt_waypoints (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.order_hunt_sessions(id) on delete cascade,
  order_id    uuid not null,
  shop_name   text not null default '',
  result      text not null default 'visited'
              check (result in ('found', 'not_found', 'high_price', 'visited')),
  price_aed   numeric,
  note        text,
  photo_urls  jsonb not null default '[]'::jsonb,
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now()
);

create index if not exists order_hunt_waypoints_session_id_idx
  on public.order_hunt_waypoints (session_id);

create index if not exists order_hunt_waypoints_order_id_idx
  on public.order_hunt_waypoints (order_id);

-- 4. GPS pings – periodic location updates during the hunt
create table if not exists public.order_hunt_gps_pings (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.order_hunt_sessions(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  double precision,
  ts          timestamptz not null default now()
);

create index if not exists order_hunt_gps_pings_session_id_ts_idx
  on public.order_hunt_gps_pings (session_id, ts desc);

-- 5. RLS: allow anon users to read hunt data (needed for public client page)
alter table public.order_hunt_sessions   enable row level security;
alter table public.order_hunt_waypoints  enable row level security;
alter table public.order_hunt_gps_pings  enable row level security;

-- Anon can read all sessions / waypoints / pings (data is non-sensitive operational info)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'order_hunt_sessions' and policyname = 'hunt_sessions_anon_read'
  ) then
    create policy hunt_sessions_anon_read on public.order_hunt_sessions
      for select to anon using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'order_hunt_sessions' and policyname = 'hunt_sessions_auth_all'
  ) then
    create policy hunt_sessions_auth_all on public.order_hunt_sessions
      for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'order_hunt_waypoints' and policyname = 'hunt_waypoints_anon_read'
  ) then
    create policy hunt_waypoints_anon_read on public.order_hunt_waypoints
      for select to anon using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'order_hunt_waypoints' and policyname = 'hunt_waypoints_auth_all'
  ) then
    create policy hunt_waypoints_auth_all on public.order_hunt_waypoints
      for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'order_hunt_gps_pings' and policyname = 'hunt_gps_pings_anon_read'
  ) then
    create policy hunt_gps_pings_anon_read on public.order_hunt_gps_pings
      for select to anon using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'order_hunt_gps_pings' and policyname = 'hunt_gps_pings_auth_all'
  ) then
    create policy hunt_gps_pings_auth_all on public.order_hunt_gps_pings
      for all to authenticated using (true) with check (true);
  end if;
end $$;
