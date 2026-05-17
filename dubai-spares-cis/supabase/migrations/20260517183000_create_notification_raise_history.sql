-- Хранение всех уведомлений (включая уведомления о повышении статуса/приоритета)
create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  type text not null,
  severity text not null default 'info',
  title text not null,
  message text not null,
  route text,
  order_id text,
  supplier_id text,
  phone text,
  brand text,
  car_model text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  archived_at timestamptz,
  follow_up_at timestamptz,
  snooze_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_events_created_at_idx
  on public.notification_events (created_at desc);

create index if not exists notification_events_unread_idx
  on public.notification_events (read_at)
  where archived_at is null;

create index if not exists notification_events_order_id_idx
  on public.notification_events (order_id);

create index if not exists notification_events_type_idx
  on public.notification_events (type);

create or replace function public.set_notification_events_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_notification_events_updated_at on public.notification_events;
create trigger trg_notification_events_updated_at
before update on public.notification_events
for each row execute function public.set_notification_events_updated_at();

alter table public.notification_events enable row level security;

create policy if not exists "notification_events_select_authenticated"
  on public.notification_events
  for select
  to authenticated
  using (true);

create policy if not exists "notification_events_insert_authenticated"
  on public.notification_events
  for insert
  to authenticated
  with check (true);

create policy if not exists "notification_events_update_authenticated"
  on public.notification_events
  for update
  to authenticated
  using (true)
  with check (true);
