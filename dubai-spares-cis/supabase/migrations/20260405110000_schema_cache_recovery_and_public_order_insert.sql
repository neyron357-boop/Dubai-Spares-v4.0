-- Ensure critical tables exist and expose a schema-cache refresh rpc for client retry flows.
create extension if not exists pgcrypto;

create table if not exists public.orders (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text not null default '',
  location text not null default '',
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.shops enable row level security;

drop policy if exists "Allow public insert orders" on public.orders;
create policy "Allow public insert orders"
on public.orders
for insert
to anon
with check (true);

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
