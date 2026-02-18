-- Allow lead submissions from both anonymous and authenticated sessions.
-- Some operators open the public form while logged in, which uses the
-- `authenticated` role and was blocked by anon-only insert policies.

alter table if exists public.client_leads enable row level security;

drop policy if exists client_leads_insert_anon on public.client_leads;
create policy client_leads_insert_anon on public.client_leads
for insert
to anon
with check (true);

drop policy if exists client_leads_insert_authenticated on public.client_leads;
create policy client_leads_insert_authenticated on public.client_leads
for insert
to authenticated
with check (true);
