-- =============================================================================
-- diagnose_supabase_schema.sql
-- Diagnostic script for Dubai Spares CIS Supabase project.
-- Run in Supabase SQL Editor to verify schema health before / after migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Check required tables exist in public schema
-- ---------------------------------------------------------------------------
select
  t.table_name,
  case when t.table_name is not null then '✓ exists' else '✗ MISSING' end as status
from (
  values
    ('app_state'),
    ('orders'),
    ('parts'),
    ('price_variants'),
    ('shops'),
    ('client_leads'),
    ('backups'),
    ('push_subscriptions'),
    ('public_quote_snapshots')
) as required(table_name)
left join information_schema.tables t
  on  t.table_schema = 'public'
  and t.table_name   = required.table_name
order by required.table_name;

-- ---------------------------------------------------------------------------
-- 2. Check required columns exist on the orders table
--    (matches ORDER_GRAPH_COLUMNS in syncSchema.ts)
-- ---------------------------------------------------------------------------
select
  required.col,
  case when c.column_name is not null then '✓ exists' else '✗ MISSING' end as status,
  c.data_type,
  c.is_nullable,
  c.column_default
from (
  values
    ('id'), ('brand'), ('model'), ('year'), ('body_type'), ('vin'),
    ('vin_photo_url'), ('priority'), ('client_name'), ('source'),
    ('car_photo_url'), ('car_photos'), ('markup_percent'), ('markup_type'),
    ('markup_fixed_aed'), ('use_markup_as_default_for_new_parts'),
    ('client_currency'), ('fx_updated_at'), ('logistics'), ('exchange_rate'),
    ('created_at'), ('is_archived'), ('is_sold'), ('sold_profit_usd'),
    ('is_vip'), ('is_pinned'), ('is_lead'), ('notes'), ('status'),
    ('sales_status'), ('customer_contact'), ('social_nickname'), ('updated_at'),
    ('recommended_shop_ids'), ('dismissed_shop_ids'), ('lead_unread'),
    ('lead_source'), ('lead_read_at'), ('pricing_events')
) as required(col)
left join information_schema.columns c
  on  c.table_schema = 'public'
  and c.table_name   = 'orders'
  and c.column_name  = required.col
order by required.col;

-- ---------------------------------------------------------------------------
-- 3. Check required columns on parts, price_variants, public_quote_snapshots
--    (matches COMPAT_TABLE_COLUMNS in syncSchema.ts)
-- ---------------------------------------------------------------------------
select
  required.tbl,
  required.col,
  case when c.column_name is not null then '✓ exists' else '✗ MISSING' end as status
from (
  values
    ('parts',                  'id'),
    ('parts',                  'order_id'),
    ('parts',                  'name'),
    ('parts',                  'photo_url'),
    ('parts',                  'photos'),
    ('parts',                  'is_found'),
    ('price_variants',         'id'),
    ('price_variants',         'part_id'),
    ('price_variants',         'price_aed'),
    ('price_variants',         'condition'),
    ('price_variants',         'availability'),
    ('price_variants',         'shop_name'),
    ('price_variants',         'phone'),
    ('price_variants',         'location'),
    ('price_variants',         'photo_url'),
    ('price_variants',         'photos'),
    ('price_variants',         'created_at'),
    ('public_quote_snapshots', 'token'),
    ('public_quote_snapshots', 'order_id'),
    ('public_quote_snapshots', 'payload'),
    ('public_quote_snapshots', 'created_at'),
    ('public_quote_snapshots', 'expires_at')
) as required(tbl, col)
left join information_schema.columns c
  on  c.table_schema = 'public'
  and c.table_name   = required.tbl
  and c.column_name  = required.col
order by required.tbl, required.col;

-- ---------------------------------------------------------------------------
-- 4. Check Row Level Security is enabled on all required tables
-- ---------------------------------------------------------------------------
select
  required.table_name,
  case when c.relrowsecurity then '✓ RLS enabled' else '✗ RLS DISABLED' end as rls_status
from (
  values
    ('app_state'),
    ('orders'),
    ('parts'),
    ('price_variants'),
    ('shops'),
    ('client_leads'),
    ('backups'),
    ('push_subscriptions'),
    ('public_quote_snapshots')
) as required(table_name)
left join pg_class c
  on  c.relname      = required.table_name
  and c.relnamespace = 'public'::regnamespace
order by required.table_name;

-- ---------------------------------------------------------------------------
-- 5. List all RLS policies on public tables
-- ---------------------------------------------------------------------------
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd        as "command",
  qual       as "using",
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- ---------------------------------------------------------------------------
-- 6. Check anon role has the required table privileges
-- ---------------------------------------------------------------------------
select
  table_name,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public'
order by table_name, privilege_type;

-- ---------------------------------------------------------------------------
-- 7. Verify storage buckets exist
-- ---------------------------------------------------------------------------
select
  required.bucket_id,
  case when b.id is not null then '✓ exists' else '✗ MISSING' end as status,
  b.public as is_public
from (
  values ('images'), ('backups'), ('public-quote'), ('client-form')
) as required(bucket_id)
left join storage.buckets b on b.id = required.bucket_id
order by required.bucket_id;

-- ---------------------------------------------------------------------------
-- 8. Summary: count missing tables and columns
-- ---------------------------------------------------------------------------
with missing_tables as (
  select count(*) as cnt
  from (
    values
      ('app_state'), ('orders'), ('parts'), ('price_variants'), ('shops'),
      ('client_leads'), ('backups'), ('push_subscriptions'),
      ('public_quote_snapshots')
  ) as required(table_name)
  where not exists (
    select 1 from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_name   = required.table_name
  )
),
missing_order_cols as (
  select count(*) as cnt
  from (
    values
      ('id'), ('brand'), ('model'), ('year'), ('body_type'), ('vin'),
      ('vin_photo_url'), ('priority'), ('client_name'), ('source'),
      ('car_photo_url'), ('car_photos'), ('markup_percent'), ('markup_type'),
      ('markup_fixed_aed'), ('use_markup_as_default_for_new_parts'),
      ('client_currency'), ('fx_updated_at'), ('logistics'), ('exchange_rate'),
      ('created_at'), ('is_archived'), ('is_sold'), ('sold_profit_usd'),
      ('is_vip'), ('is_pinned'), ('is_lead'), ('notes'), ('status'),
      ('sales_status'), ('customer_contact'), ('social_nickname'), ('updated_at'),
      ('recommended_shop_ids'), ('dismissed_shop_ids'), ('lead_unread'),
      ('lead_source'), ('lead_read_at'), ('pricing_events')
  ) as required(col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name   = 'orders'
      and c.column_name  = required.col
  )
)
select
  mt.cnt  as missing_tables,
  moc.cnt as missing_orders_columns,
  case
    when mt.cnt = 0 and moc.cnt = 0
    then '✓ Schema looks healthy — run fix_supabase_sync.sql if sync errors persist (forces schema cache reload)'
    else '✗ Schema issues found — run fix_supabase_sync.sql'
  end     as recommendation
from missing_tables mt, missing_order_cols moc;
