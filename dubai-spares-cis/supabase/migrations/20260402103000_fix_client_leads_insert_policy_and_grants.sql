-- Ensure public form lead inserts work even when PostgREST uses non-representation mode
-- and when role mapping differs between anon/authenticated sessions.

alter table if exists public.client_leads enable row level security;

grant usage on schema public to anon, authenticated;
grant insert on table public.client_leads to anon, authenticated;

-- Keep explicit role policies for backward compatibility.
drop policy if exists client_leads_insert_anon on public.client_leads;
create policy client_leads_insert_anon on public.client_leads
for insert to anon with check (true);

drop policy if exists client_leads_insert_authenticated on public.client_leads;
create policy client_leads_insert_authenticated on public.client_leads
for insert to authenticated with check (true);

-- Add broad insert policy so requests routed through PUBLIC role still pass.
drop policy if exists client_leads_insert_public on public.client_leads;
create policy client_leads_insert_public on public.client_leads
for insert to public with check (true);
