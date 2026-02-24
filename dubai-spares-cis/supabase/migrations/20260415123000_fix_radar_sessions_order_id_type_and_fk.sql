-- Ensure RADAR sessions exists with a compatible order_id type and FK to public.orders(id text)
create extension if not exists pgcrypto;

-- 1) Guard: verify public.orders.id is text; stop migration if not
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

-- 2) If radar_sessions is missing (e.g., previous migration failed), create it with correct order_id type.
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

-- 3) Ensure order_id exists as text and FK is recreated safely
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

-- 4) Index for order timeline lookups
create index if not exists idx_radar_sessions_order_id_created
  on public.radar_sessions(order_id, created_at desc);
