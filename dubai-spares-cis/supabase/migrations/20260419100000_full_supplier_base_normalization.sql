-- ============================================================
-- FULL SUPPLIER BASE NORMALIZATION (idempotent, safe, no-crash)
-- ============================================================

DO $$
DECLARE
  v_has_radar_targets boolean := to_regclass('public.radar_targets') is not null;
  v_has_radar_events boolean := to_regclass('public.radar_events') is not null;
  v_has_radar_target_items boolean := to_regclass('public.radar_target_items') is not null;
  v_has_shop_metrics boolean := to_regclass('public.shop_metrics') is not null;
BEGIN
  -- ------------------------------------------------------------
  -- AUDIT: current object availability
  -- ------------------------------------------------------------
  RAISE NOTICE 'AUDIT shops=%', to_regclass('public.shops');
  RAISE NOTICE 'AUDIT price_variants=%', to_regclass('public.price_variants');
  RAISE NOTICE 'AUDIT shop_specializations=%', to_regclass('public.shop_specializations');
  RAISE NOTICE 'AUDIT shop_metrics=%', to_regclass('public.shop_metrics');
  RAISE NOTICE 'AUDIT shop_interactions=%', to_regclass('public.shop_interactions');
  RAISE NOTICE 'AUDIT v_shops_enriched=%', to_regclass('public.v_shops_enriched');
  RAISE NOTICE 'AUDIT radar_targets=%', to_regclass('public.radar_targets');
  RAISE NOTICE 'AUDIT radar_events=%', to_regclass('public.radar_events');
  RAISE NOTICE 'AUDIT radar_target_items=%', to_regclass('public.radar_target_items');

  -- ------------------------------------------------------------
  -- Core supplier tables and compatible schema
  -- ------------------------------------------------------------
  BEGIN
    EXECUTE '
      CREATE TABLE IF NOT EXISTS public.shops (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        phone text NOT NULL DEFAULT '''',
        whatsapp text,
        location text NOT NULL DEFAULT '''',
        latitude double precision,
        longitude double precision,
        zone text NOT NULL DEFAULT '''',
        shop_type text NOT NULL DEFAULT ''new_parts'',
        main_brands text[] NOT NULL DEFAULT ''{}'',
        specialization text[] NOT NULL DEFAULT ''{}'',
        specialization_models text[] NOT NULL DEFAULT ''{}'',
        specialization_years integer[] NOT NULL DEFAULT ''{}'',
        specialization_body_types text[] NOT NULL DEFAULT ''{}'',
        specialization_tag text,
        is_active boolean NOT NULL DEFAULT true,
        is_archived boolean NOT NULL DEFAULT false,
        heat_level integer NOT NULL DEFAULT 0,
        auto_trust_score integer NOT NULL DEFAULT 0,
        needs_manual_fix boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )';

    EXECUTE 'ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS whatsapp text';
    EXECUTE 'ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false';
    EXECUTE 'ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true';
    EXECUTE 'ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS specialization text[] NOT NULL DEFAULT ''{}''';
    EXECUTE 'ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS specialization_models text[] NOT NULL DEFAULT ''{}''';
    EXECUTE 'ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS specialization_years integer[] NOT NULL DEFAULT ''{}''';
    EXECUTE 'ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS specialization_body_types text[] NOT NULL DEFAULT ''{}''';
    EXECUTE 'ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()';
    EXECUTE 'ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()';

    EXECUTE 'ALTER TABLE public.shops ALTER COLUMN specialization TYPE text[] USING COALESCE(specialization, ''{}''::text[])';
    EXECUTE 'ALTER TABLE public.shops ALTER COLUMN specialization_models TYPE text[] USING COALESCE(specialization_models, ''{}''::text[])';
    EXECUTE 'ALTER TABLE public.shops ALTER COLUMN specialization_years TYPE integer[] USING COALESCE(specialization_years, ''{}''::integer[])';

    EXECUTE 'UPDATE public.shops SET is_archived = false WHERE is_archived IS NULL';
    EXECUTE 'UPDATE public.shops SET is_active = true WHERE is_active IS NULL';
    EXECUTE 'UPDATE public.shops SET specialization = ''{}''::text[] WHERE specialization IS NULL';
    EXECUTE 'UPDATE public.shops SET specialization_models = ''{}''::text[] WHERE specialization_models IS NULL';
    EXECUTE 'UPDATE public.shops SET specialization_years = ''{}''::integer[] WHERE specialization_years IS NULL';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Error(core shops): %', SQLERRM;
  END;

  BEGIN
    EXECUTE '
      CREATE TABLE IF NOT EXISTS public.shop_specializations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        brand text NOT NULL,
        models text[] NOT NULL DEFAULT ''{}'',
        years integer[] NOT NULL DEFAULT ''{}'',
        categories text[] NOT NULL DEFAULT ''{}'',
        is_primary boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      )';

    EXECUTE '
      CREATE TABLE IF NOT EXISTS public.shop_metrics (
        shop_id uuid PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
        total_interactions int NOT NULL DEFAULT 0,
        total_found int NOT NULL DEFAULT 0,
        total_not_found int NOT NULL DEFAULT 0,
        total_wrong_info int NOT NULL DEFAULT 0,
        total_follow_up int NOT NULL DEFAULT 0,
        last_interaction_at timestamptz,
        avg_response_time_min int,
        has_delivery boolean NOT NULL DEFAULT false,
        fast_whatsapp boolean NOT NULL DEFAULT false,
        manual_trust_level int NOT NULL DEFAULT 3,
        auto_trust_score int NOT NULL DEFAULT 50,
        success_rate numeric(5,2) NOT NULL DEFAULT 0,
        heat_level int NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )';

    EXECUTE '
      CREATE TABLE IF NOT EXISTS public.shop_interactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        order_id uuid,
        interaction_type text NOT NULL,
        status text,
        notes text,
        lat double precision,
        lng double precision,
        client_event_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      )';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Error(related supplier tables): %', SQLERRM;
  END;

  -- ------------------------------------------------------------
  -- price_variants linkage and auto-sync from variants -> shops
  -- ------------------------------------------------------------
  BEGIN
    EXECUTE 'ALTER TABLE IF EXISTS public.price_variants ADD COLUMN IF NOT EXISTS shop_id uuid';

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'price_variants_shop_id_fkey'
        AND conrelid = 'public.price_variants'::regclass
    ) THEN
      EXECUTE '
        ALTER TABLE public.price_variants
        ADD CONSTRAINT price_variants_shop_id_fkey
        FOREIGN KEY (shop_id)
        REFERENCES public.shops(id)
        ON DELETE SET NULL';
    END IF;

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_price_variants_shop_id ON public.price_variants(shop_id)';

    EXECUTE '
      CREATE OR REPLACE FUNCTION public.fn_sync_variant_shop_to_shops()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $fn$
      DECLARE
        v_shop_id uuid;
      BEGIN
        IF NEW.shop_id IS NOT NULL THEN
          RETURN NEW;
        END IF;

        IF COALESCE(NEW.shop_name, '''') = '''' AND COALESCE(NEW.phone, '''') = '''' AND COALESCE(NEW.location, '''') = '''' THEN
          RETURN NEW;
        END IF;

        SELECT s.id
        INTO v_shop_id
        FROM public.shops s
        WHERE lower(trim(s.name)) = lower(trim(COALESCE(NEW.shop_name, '''')))
          AND lower(trim(COALESCE(s.phone, ''''))) = lower(trim(COALESCE(NEW.phone, '''')))
          AND lower(trim(COALESCE(s.location, ''''))) = lower(trim(COALESCE(NEW.location, '''')))
        ORDER BY s.created_at ASC
        LIMIT 1;

        IF v_shop_id IS NULL THEN
          INSERT INTO public.shops (
            name,
            phone,
            whatsapp,
            location,
            is_active,
            is_archived,
            created_at,
            updated_at
          ) VALUES (
            COALESCE(NULLIF(trim(NEW.shop_name), ''''), ''Unknown supplier''),
            COALESCE(NEW.phone, ''''),
            NULLIF(NEW.phone, ''''),
            COALESCE(NEW.location, ''''),
            true,
            false,
            now(),
            now()
          ) RETURNING id INTO v_shop_id;
        END IF;

        NEW.shop_id := v_shop_id;
        RETURN NEW;
      END
      $fn$';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_sync_variant_shop_to_shops ON public.price_variants';
    EXECUTE '
      CREATE TRIGGER trg_sync_variant_shop_to_shops
      BEFORE INSERT OR UPDATE OF shop_name, phone, location, shop_id
      ON public.price_variants
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_sync_variant_shop_to_shops()';

    EXECUTE '
      UPDATE public.price_variants pv
      SET shop_id = s.id
      FROM public.shops s
      WHERE pv.shop_id IS NULL
        AND lower(trim(COALESCE(pv.shop_name, ''''))) = lower(trim(COALESCE(s.name, '''')))
        AND lower(trim(COALESCE(pv.phone, ''''))) = lower(trim(COALESCE(s.phone, '''')))
        AND lower(trim(COALESCE(pv.location, ''''))) = lower(trim(COALESCE(s.location, '''')))';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Error(price_variants link): %', SQLERRM;
  END;

  -- ------------------------------------------------------------
  -- Backfill supplier metrics/specializations and cleanup old links
  -- ------------------------------------------------------------
  BEGIN
    EXECUTE '
      INSERT INTO public.shop_metrics (shop_id)
      SELECT s.id
      FROM public.shops s
      LEFT JOIN public.shop_metrics sm ON sm.shop_id = s.id
      WHERE sm.shop_id IS NULL';

    EXECUTE '
      INSERT INTO public.shop_specializations (shop_id, brand, is_primary)
      SELECT s.id, b.brand, (b.ordinality = 1)
      FROM public.shops s
      CROSS JOIN LATERAL unnest(COALESCE(s.main_brands, ''{}''::text[])) WITH ORDINALITY AS b(brand, ordinality)
      LEFT JOIN public.shop_specializations ss
        ON ss.shop_id = s.id
       AND ss.brand = b.brand
      WHERE COALESCE(b.brand, '''') <> ''''
        AND ss.id IS NULL';

    -- Drop deprecated columns if they still exist.
    EXECUTE 'ALTER TABLE IF EXISTS public.shops DROP COLUMN IF EXISTS brand';
    EXECUTE 'ALTER TABLE IF EXISTS public.shops DROP COLUMN IF EXISTS vehicle_brands';
    EXECUTE 'ALTER TABLE IF EXISTS public.shops DROP COLUMN IF EXISTS parts_categories';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Error(backfill/cleanup): %', SQLERRM;
  END;

  -- ------------------------------------------------------------
  -- Indexes for filtering/sorting and array search
  -- ------------------------------------------------------------
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shops_is_archived ON public.shops(is_archived)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shops_is_active ON public.shops(is_active)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shops_created_at_desc ON public.shops(created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shops_updated_at_desc ON public.shops(updated_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shops_shop_type ON public.shops(shop_type)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shops_zone ON public.shops(zone)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shops_specialization_gin ON public.shops USING gin(specialization)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shops_specialization_models_gin ON public.shops USING gin(specialization_models)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shops_specialization_years_gin ON public.shops USING gin(specialization_years)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shop_metrics_updated_at ON public.shop_metrics(updated_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shop_interactions_shop_created_at ON public.shop_interactions(shop_id, created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shop_specializations_shop_id ON public.shop_specializations(shop_id)';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Error(indexes): %', SQLERRM;
  END;

  -- ------------------------------------------------------------
  -- Remove broken radar dependencies only when radar tables are absent
  -- ------------------------------------------------------------
  BEGIN
    IF NOT v_has_radar_targets OR NOT v_has_radar_events OR NOT v_has_radar_target_items THEN
      EXECUTE 'DROP FUNCTION IF EXISTS public.record_radar_item_event(uuid, text, numeric, text, boolean)';
      EXECUTE 'DROP FUNCTION IF EXISTS public.radar_apply_event(jsonb, uuid)';
    END IF;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Error(radar cleanup): %', SQLERRM;
  END;

  -- ------------------------------------------------------------
  -- Recreate normalized, dependency-safe view
  -- ------------------------------------------------------------
  BEGIN
    EXECUTE 'DROP VIEW IF EXISTS public.v_shops_enriched';

    IF v_has_shop_metrics THEN
      EXECUTE '
        CREATE VIEW public.v_shops_enriched AS
        SELECT
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
          m.auto_trust_score AS metrics_auto_trust_score,
          m.success_rate,
          m.heat_level AS metrics_heat_level,
          m.updated_at AS metrics_updated_at,
          COALESCE(sp.brands, ''{}''::text[]) AS specialization_brands,
          COALESCE(sp.categories, ''{}''::text[]) AS specialization_categories
        FROM public.shops s
        LEFT JOIN public.shop_metrics m ON m.shop_id = s.id
        LEFT JOIN LATERAL (
          SELECT
            array_remove(array_agg(DISTINCT ss.brand), NULL) AS brands,
            array_remove(array_agg(DISTINCT c.category), NULL) AS categories
          FROM public.shop_specializations ss
          LEFT JOIN LATERAL unnest(ss.categories) AS c(category) ON true
          WHERE ss.shop_id = s.id
        ) sp ON true';
    ELSE
      EXECUTE '
        CREATE VIEW public.v_shops_enriched AS
        SELECT
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
          0::int AS total_interactions,
          0::int AS total_found,
          0::int AS total_not_found,
          0::int AS total_wrong_info,
          0::int AS total_follow_up,
          NULL::timestamptz AS last_interaction_at,
          NULL::int AS avg_response_time_min,
          false AS has_delivery,
          false AS fast_whatsapp,
          3::int AS manual_trust_level,
          s.auto_trust_score AS metrics_auto_trust_score,
          0::numeric AS success_rate,
          s.heat_level AS metrics_heat_level,
          s.updated_at AS metrics_updated_at,
          ''{}''::text[] AS specialization_brands,
          ''{}''::text[] AS specialization_categories
        FROM public.shops s';
    END IF;

    EXECUTE 'GRANT SELECT ON public.v_shops_enriched TO anon, authenticated, service_role';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Error(view rebuild): %', SQLERRM;
  END;

  -- ------------------------------------------------------------
  -- Final schema cache refresh (safe)
  -- ------------------------------------------------------------
  BEGIN
    IF to_regprocedure('public.refresh_schema_cache()') IS NOT NULL THEN
      EXECUTE 'SELECT public.refresh_schema_cache()';
    END IF;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Error(refresh schema cache): %', SQLERRM;
  END;

EXCEPTION WHEN others THEN
  RAISE NOTICE 'Error: %', SQLERRM;
END $$;
