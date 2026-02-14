create table if not exists public.public_quote_snapshots (
  token text primary key,
  order_id text not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists logistics jsonb,
  add column if not exists fx_updated_at timestamptz,
  add column if not exists client_currency text,
  add column if not exists use_markup_as_default_for_new_parts boolean default false;

create index if not exists idx_public_quote_snapshots_order_id
  on public.public_quote_snapshots (order_id);

drop policy if exists "anon_all_public_quote_snapshots" on public.public_quote_snapshots;
create policy "anon_all_public_quote_snapshots"
  on public.public_quote_snapshots
  for all
  to anon
  using (true)
  with check (true);
