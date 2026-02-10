create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_push_subscriptions_active
  on public.push_subscriptions (is_active)
  where is_active = true;

alter table public.push_subscriptions enable row level security;

create policy "Service role can manage push subscriptions"
  on public.push_subscriptions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
