alter table public.public_quote_snapshots
  alter column created_at set default now(),
  alter column token set not null,
  alter column expires_at set not null,
  alter column expires_at set default (now() + interval '7 days');

update public.public_quote_snapshots
set created_at = coalesce(created_at, now());

update public.public_quote_snapshots
set expires_at = coalesce(expires_at, created_at + interval '7 days')
where expires_at is null
   or expires_at <= created_at;

alter table public.public_quote_snapshots
  drop constraint if exists public_quote_snapshots_expires_after_create_chk;

alter table public.public_quote_snapshots
  add constraint public_quote_snapshots_expires_after_create_chk
  check (expires_at > created_at + interval '1 minute');

alter table public.public_quote_snapshots enable row level security;

drop policy if exists public_quote_snapshots_read_anon on public.public_quote_snapshots;
create policy public_quote_snapshots_read_anon on public.public_quote_snapshots
for select to anon using (expires_at > now());
