-- =====================================================================
-- Dubai Spares: idempotent schema audit + normalization (single-run safe)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1) Audit snapshot (tables, views, columns, indexes, triggers, funcs)
-- ---------------------------------------------------------------------
do $$
begin
  create temporary table if not exists _schema_audit_log (
    section text,
    object_name text,
    details text
  ) on commit drop;

  delete from _schema_audit_log;

  insert into _schema_audit_log(section, object_name, details)
  select 'table', t.table_name, 'exists'
  from information_schema.tables t
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE';

  insert into _schema_audit_log(section, object_name, details)
  select 'view', v.table_name, 'exists'
  from information_schema.views v
  where v.table_schema = 'public';

  insert into _schema_audit_log(section, object_name, details)
  select 'column', c.table_name || '.' || c.column_name, c.data_type
  from information_schema.columns c
  where c.table_schema = 'public';

  insert into _schema_audit_log(section, object_name, details)
  select 'index', i.indexname, i.indexdef
  from pg_indexes i
  where i.schemaname = 'public';

  insert into _schema_audit_log(section, object_name, details)
  select 'trigger', tg.tgname, cls.relname
  from pg_trigger tg
  join pg_class cls on cls.oid = tg.tgrelid
  join pg_namespace nsp on nsp.oid = cls.relnamespace
  where nsp.nspname = 'public' and not tg.tgisinternal;

  insert into _schema_audit_log(section, object_name, details)
  select 'function', p.proname, pg_get_function_identity_arguments(p.oid)
  from pg_proc p
  join pg_namespace nsp on nsp.oid = p.pronamespace
  where nsp.nspname = 'public';

  raise notice 'Schema audit completed. Objects collected: %', (select count(*) from _schema_audit_log);
exception
  when others then
    raise notice 'Audit block skipped safely: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 2) Ensure core app tables used by frontend/backend exist
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  brand text not null default '',
  model text not null default '',
  year text not null default '',
  vin text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.orders
  add column if not exists status text not null default 'active',
  add column if not exists sales_status text not null default 'Inquiry',
  add column if not exists client_name text not null default '',
  add column if not exists customer_contact text not null default '',
  add column if not exists social_nickname text not null default '',
  add column if not exists source text not null default 'Другое',
  add column if not exists source_platform text,
  add column if not exists vin_photo_url text,
  add column if not exists car_photo_url text,
  add column if not exists car_photos text[] not null default '{}',
  add column if not exists notes jsonb not null default '[]'::jsonb,
  add column if not exists dismissed_shop_ids text[] not null default '{}',
  add column if not exists recommended_shop_ids text[] not null default '{}',
  add column if not exists is_lead boolean not null default false,
  add column if not exists is_archived boolean not null default false,
  add column if not exists is_sold boolean not null default false,
  add column if not exists priority text not null default 'MEDIUM';

create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  name text not null,
  photo_url text,
  photos text[] not null default '{}',
  is_found boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.price_variants (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete cascade,
  price_aed numeric not null default 0,
  condition text,
  availability text,
  shop_name text not null default '',
  phone text not null default '',
  location text not null default '',
  photo_url text,
  photos text[] not null default '{}',
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at timestamptz not null default now()
);

alter table if exists public.price_variants
  add column if not exists payload jsonb,
  add column if not exists payload_b64 text,
  add column if not exists payload_codec text;

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  location text not null default '',
  latitude double precision,
  longitude double precision,
  shop_type text not null default 'new_parts',
  main_brands text[] not null default '{}',
  specialization_tag text,
  is_verified boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_leads (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text,
  order_id text,
  name text,
  phone text,
  message text,
  payload jsonb not null default '{}'::jsonb,
  payload_json jsonb,
  payload_b64 text,
  payload_codec text,
  image_manifest jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.public_quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  token text unique,
  snapshot_id text,
  order_id text,
  payload jsonb not null default '{}'::jsonb,
  payload_json jsonb,
  payload_b64 text,
  payload_codec text,
  image_manifest jsonb not null default '[]'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) Type and constraint normalization for conflict prevention
-- ---------------------------------------------------------------------
do $$
begin
  begin
    alter table if exists public.public_quote_snapshots alter column order_id drop not null;
    alter table if exists public.public_quote_snapshots alter column payload drop not null;
    alter table if exists public.public_quote_snapshots alter column image_manifest drop not null;
  exception when others then
    raise notice 'Nullable normalization skipped for public_quote_snapshots: %', sqlerrm;
  end;

  begin
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='price_variants' and column_name='created_at'
        and data_type <> 'bigint'
    ) then
      alter table public.price_variants
        alter column created_at type bigint
        using coalesce(
          case
            when pg_typeof(created_at)::text in ('timestamp with time zone','timestamp without time zone') then (extract(epoch from created_at) * 1000)::bigint
            else created_at::bigint
          end,
          (extract(epoch from now()) * 1000)::bigint
        );
    end if;
  exception when others then
    raise notice 'Type normalization skipped for price_variants.created_at: %', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------
-- 4) Compatibility view for variants naming consistency
-- ---------------------------------------------------------------------
create or replace view public.variants as
select * from public.price_variants;

-- ---------------------------------------------------------------------
-- 5) Index normalization for active application paths
-- ---------------------------------------------------------------------
create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_parts_order_id on public.parts (order_id);
create index if not exists idx_price_variants_part_id on public.price_variants (part_id);
create index if not exists idx_price_variants_shop_name on public.price_variants (shop_name);
create index if not exists idx_shops_geo on public.shops (latitude, longitude);
create index if not exists idx_shops_specialization_tag on public.shops (specialization_tag);
create unique index if not exists idx_public_quote_snapshots_token_unique on public.public_quote_snapshots (token);
create index if not exists idx_public_quote_snapshots_snapshot_id on public.public_quote_snapshots (snapshot_id);
create index if not exists idx_public_quote_snapshots_order_id on public.public_quote_snapshots (order_id);
create index if not exists idx_public_quote_snapshots_expires_at on public.public_quote_snapshots (expires_at);
create unique index if not exists idx_client_leads_idempotency_key on public.client_leads (idempotency_key);
create index if not exists idx_client_leads_created_at on public.client_leads (created_at desc);

-- ---------------------------------------------------------------------
-- 6) Trigger/function normalization for updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_set_updated_at on public.orders;
create trigger trg_orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists trg_parts_set_updated_at on public.parts;
create trigger trg_parts_set_updated_at
before update on public.parts
for each row execute function public.set_updated_at();

drop trigger if exists trg_price_variants_set_updated_at on public.price_variants;
create trigger trg_price_variants_set_updated_at
before update on public.price_variants
for each row execute function public.set_updated_at();

drop trigger if exists trg_shops_set_updated_at on public.shops;
create trigger trg_shops_set_updated_at
before update on public.shops
for each row execute function public.set_updated_at();

drop trigger if exists trg_client_leads_set_updated_at on public.client_leads;
create trigger trg_client_leads_set_updated_at
before update on public.client_leads
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 7) Safe cleanup: only known legacy duplicate tables/views/columns
-- ---------------------------------------------------------------------
drop view if exists public.v_variants cascade;
drop table if exists public.leads cascade;

alter table if exists public.orders drop column if exists data;
alter table if exists public.client_leads drop column if exists lead_payload;
alter table if exists public.public_quote_snapshots drop column if exists quote_payload;

-- ---------------------------------------------------------------------
-- 8) Images storage safety (non-fatal if role lacks storage permissions)
-- ---------------------------------------------------------------------
do $$
begin
  begin
    insert into storage.buckets (id, name, public)
    values ('images', 'images', true)
    on conflict (id) do nothing;

    alter table storage.objects enable row level security;

    drop policy if exists "anon_read_images" on storage.objects;
    create policy "anon_read_images" on storage.objects for select to anon using (bucket_id = 'images');

    drop policy if exists "anon_insert_images" on storage.objects;
    create policy "anon_insert_images" on storage.objects for insert to anon with check (bucket_id = 'images');

    drop policy if exists "anon_update_images" on storage.objects;
    create policy "anon_update_images" on storage.objects for update to anon using (bucket_id = 'images') with check (bucket_id = 'images');

    drop policy if exists "anon_delete_images" on storage.objects;
    create policy "anon_delete_images" on storage.objects for delete to anon using (bucket_id = 'images');
  exception
    when undefined_table or insufficient_privilege then
      raise notice 'Storage normalization skipped safely: %', sqlerrm;
    when others then
      raise notice 'Storage normalization partially skipped: %', sqlerrm;
  end;
end $$;
