alter table if exists public.public_quote_snapshots enable row level security;

drop policy if exists "anon_all_public_quote_snapshots" on public.public_quote_snapshots;
drop policy if exists public_quote_snapshots_read_anon on public.public_quote_snapshots;
drop policy if exists public_quote_snapshots_select_anon_token on public.public_quote_snapshots;
drop policy if exists public_quote_snapshots_insert_anon_token on public.public_quote_snapshots;

create policy public_quote_snapshots_select_anon_token
  on public.public_quote_snapshots
  for select
  to anon
  using (token is not null and expires_at > now());

create policy public_quote_snapshots_insert_anon_token
  on public.public_quote_snapshots
  for insert
  to anon
  with check (token is not null and expires_at is not null);

update public.public_quote_snapshots
set expires_at = now() + interval '7 days'
where expires_at is null;
