-- Fix 401/404: Ensure all public tables are accessible to anon/authenticated roles
-- and force a PostgREST schema cache reload so all tables become visible via REST.

-- Guarantee schema usage grants
grant usage on schema public to anon, authenticated;

-- Full grants on every table used by the frontend
grant all on table public.app_state        to anon, authenticated;
grant all on table public.orders           to anon, authenticated;
grant all on table public.parts            to anon, authenticated;
grant all on table public.price_variants   to anon, authenticated;
grant all on table public.shops            to anon, authenticated;
grant all on table public.client_leads     to anon, authenticated;
grant all on table public.public_quote_snapshots to anon, authenticated;
grant all on table public.backups          to anon, authenticated;
grant all on table public.backups_meta     to anon, authenticated;
grant all on table public.push_subscriptions to anon, authenticated;

-- app_config (optional helper table)
create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
grant all on table public.app_config to anon, authenticated;

drop policy if exists "anon_all_app_config" on public.app_config;
create policy "anon_all_app_config"
  on public.app_config for all to anon
  using (true) with check (true);

drop policy if exists "authenticated_all_app_config" on public.app_config;
create policy "authenticated_all_app_config"
  on public.app_config for all to authenticated
  using (true) with check (true);

-- Refresh PostgREST schema cache so all tables are immediately visible via REST
create or replace function public.refresh_schema_cache()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

grant execute on function public.refresh_schema_cache() to anon, authenticated;

-- Trigger the reload right away
select public.refresh_schema_cache();
