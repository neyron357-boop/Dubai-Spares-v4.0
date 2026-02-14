create table if not exists public.public_quote_snapshots (
  token text primary key,
  order_id text not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_public_quote_snapshots_order_id
  on public.public_quote_snapshots (order_id);

create index if not exists idx_public_quote_snapshots_expires_at
  on public.public_quote_snapshots (expires_at);

alter table public.public_quote_snapshots enable row level security;

drop policy if exists "anon_all_public_quote_snapshots" on public.public_quote_snapshots;
create policy "anon_all_public_quote_snapshots"
  on public.public_quote_snapshots
  for all
  to anon
  using (true)
  with check (true);
