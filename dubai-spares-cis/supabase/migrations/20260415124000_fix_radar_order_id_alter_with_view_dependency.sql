-- Fix: ALTER COLUMN order_id can fail if v_radar_active_targets depends on radar_sessions.order_id
-- This patch temporarily drops the view (if exists), applies type/FK correction, then recreates the view.

create extension if not exists pgcrypto;

-- 1) Guard: orders.id must be text
DO $$
DECLARE
  v_orders_id_type text;
BEGIN
  SELECT c.data_type
    INTO v_orders_id_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'orders'
    AND c.column_name = 'id';

  IF v_orders_id_type IS NULL THEN
    RAISE EXCEPTION 'public.orders.id column not found';
  END IF;

  IF v_orders_id_type <> 'text' THEN
    RAISE EXCEPTION 'Expected public.orders.id to be text, got %', v_orders_id_type;
  END IF;
END
$$;

-- 2) Ensure radar_sessions exists in partially-applied environments
create table if not exists public.radar_sessions (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
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

-- 3) Drop dependent view before ALTER TYPE (prevents 0A000)
drop view if exists public.v_radar_active_targets;

-- 4) Repair order_id column + FK
alter table if exists public.radar_sessions
  add column if not exists order_id text;

alter table if exists public.radar_sessions
  drop constraint if exists radar_sessions_order_id_fkey;

alter table if exists public.radar_sessions
  alter column order_id type text using order_id::text;

DO $$
DECLARE
  v_radar_sessions oid;
BEGIN
  v_radar_sessions := to_regclass('public.radar_sessions');

  IF v_radar_sessions IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'radar_sessions_order_id_fkey'
         AND conrelid = v_radar_sessions
     )
  THEN
    ALTER TABLE public.radar_sessions
      ADD CONSTRAINT radar_sessions_order_id_fkey
      FOREIGN KEY (order_id)
      REFERENCES public.orders(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

create index if not exists idx_radar_sessions_order_id_created
  on public.radar_sessions(order_id, created_at desc);

-- 5) Recreate view after type/FK fix
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

grant select on public.v_radar_active_targets to anon, authenticated;
