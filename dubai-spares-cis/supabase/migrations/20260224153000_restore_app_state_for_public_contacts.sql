-- Restore app_state table used by appSettings public contacts sync.
-- This is required for Public Quote / Public Form links to resolve updated WhatsApp and contact fields.

create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- Keep existing policy names deterministic and idempotent.
drop policy if exists "anon_all_app_state" on public.app_state;
create policy "anon_all_app_state"
  on public.app_state
  for all
  to anon
  using (true)
  with check (true);

-- Allow logged-in users/service roles the same access pattern.
drop policy if exists "authenticated_all_app_state" on public.app_state;
create policy "authenticated_all_app_state"
  on public.app_state
  for all
  to authenticated
  using (true)
  with check (true);
