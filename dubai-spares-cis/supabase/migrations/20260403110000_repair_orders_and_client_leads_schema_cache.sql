-- Repair migration for cloud projects where PostgREST schema cache is stale
-- or base tables were not created due to partial migration history.

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id text primary key,
  brand text not null default '',
  model text not null default '',
  year text not null default '',
  vin text not null default '',
  status text not null default 'active',
  priority text not null default 'medium',
  client_name text not null default '',
  source text not null default 'manual',
  car_photo_url text,
  car_photos text[] not null default '{}',
  markup_percent numeric not null default 0,
  exchange_rate numeric not null default 0,
  is_archived boolean not null default false,
  is_sold boolean not null default false,
  sold_profit_usd numeric,
  is_vip boolean not null default false,
  is_pinned boolean not null default false,
  is_lead boolean not null default false,
  notes jsonb not null default '[]'::jsonb,
  customer_contact text,
  sales_status text default 'new_inquiry',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  recommended_shop_ids text[] not null default '{}',
  body_type text,
  vin_photo_url text,
  social_nickname text,
  source_platform text,
  dismissed_shop_ids text[] not null default '{}',
  lead_unread boolean not null default false,
  lead_source text not null default 'manual',
  lead_read_at timestamptz,
  logistics text,
  fx_updated_at timestamptz,
  client_currency text,
  use_markup_as_default_for_new_parts boolean default false,
  markup_type text not null default 'percent',
  markup_fixed_aed numeric not null default 0,
  pricing_events jsonb not null default '[]'::jsonb
);

alter table public.orders add column if not exists status text not null default 'active';
alter table public.orders add column if not exists priority text not null default 'medium';
alter table public.orders add column if not exists client_name text not null default '';
alter table public.orders add column if not exists source text not null default 'manual';
alter table public.orders add column if not exists customer_contact text;
alter table public.orders add column if not exists created_at timestamptz default now();
alter table public.orders add column if not exists updated_at timestamptz default now();

create table if not exists public.client_leads (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  name text,
  phone text,
  message text,
  order_id text,
  payload_b64 text,
  payload_codec text,
  image_manifest jsonb not null default '[]'::jsonb,
  idempotency_key text,
  payload_json jsonb
);

alter table public.client_leads add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.client_leads add column if not exists created_at timestamptz not null default now();
alter table public.client_leads add column if not exists name text;
alter table public.client_leads add column if not exists phone text;
alter table public.client_leads add column if not exists message text;
alter table public.client_leads add column if not exists order_id text;
alter table public.client_leads add column if not exists payload_b64 text;
alter table public.client_leads add column if not exists payload_codec text;
alter table public.client_leads add column if not exists image_manifest jsonb not null default '[]'::jsonb;
alter table public.client_leads add column if not exists idempotency_key text;
alter table public.client_leads add column if not exists payload_json jsonb;

create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_client_leads_created_at on public.client_leads (created_at desc);
create unique index if not exists idx_client_leads_idempotency_key_not_null
  on public.client_leads (idempotency_key)
  where idempotency_key is not null;

alter table public.orders enable row level security;
alter table public.client_leads enable row level security;

drop policy if exists "anon_all_orders" on public.orders;
create policy "anon_all_orders" on public.orders for all to anon using (true) with check (true);
drop policy if exists "authenticated_all_orders" on public.orders;
create policy "authenticated_all_orders" on public.orders for all to authenticated using (true) with check (true);

drop policy if exists "anon_read_client_leads" on public.client_leads;
create policy "anon_read_client_leads" on public.client_leads for select to anon using (true);
drop policy if exists "anon_insert_client_leads" on public.client_leads;
create policy "anon_insert_client_leads" on public.client_leads for insert to anon with check (true);
drop policy if exists "authenticated_all_client_leads" on public.client_leads;
create policy "authenticated_all_client_leads" on public.client_leads for all to authenticated using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant all on table public.orders to anon, authenticated;
grant all on table public.client_leads to anon, authenticated;

-- Force PostgREST/Supabase to rebuild schema cache after DDL changes.
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when undefined_function then
    null;
end $$;
