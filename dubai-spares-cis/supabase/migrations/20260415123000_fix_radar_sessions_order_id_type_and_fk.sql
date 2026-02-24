-- Fix RADAR sessions order FK/type mismatch (orders.id is expected to be text)

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

-- 2) Ensure order_id exists as text, then recreate FK safely
ALTER TABLE IF EXISTS public.radar_sessions
  ADD COLUMN IF NOT EXISTS order_id text;

ALTER TABLE IF EXISTS public.radar_sessions
  DROP CONSTRAINT IF EXISTS radar_sessions_order_id_fkey;

ALTER TABLE IF EXISTS public.radar_sessions
  ALTER COLUMN order_id TYPE text USING order_id::text;

DO $$
BEGIN
  IF to_regclass('public.radar_sessions') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'radar_sessions_order_id_fkey'
         AND conrelid = 'public.radar_sessions'::regclass
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

-- 3) Required index for lookup/order timeline
CREATE INDEX IF NOT EXISTS idx_radar_sessions_order_id_created
  ON public.radar_sessions(order_id, created_at DESC);
