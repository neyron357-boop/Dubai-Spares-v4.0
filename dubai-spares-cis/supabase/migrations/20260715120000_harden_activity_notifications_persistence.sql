create table if not exists public.activity_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor text,
  type text not null,
  title text not null,
  message text not null,
  severity text not null default 'info',
  source text,
  order_id uuid,
  supplier_id uuid,
  part_id text,
  route text,
  payload jsonb not null default '{}'::jsonb
);

alter table public.activity_notifications
  alter column created_at set default now(),
  alter column payload set default '{}'::jsonb;

create index if not exists activity_notifications_created_at_idx
  on public.activity_notifications (created_at desc);

create index if not exists activity_notifications_order_id_idx
  on public.activity_notifications (order_id);

create index if not exists activity_notifications_supplier_id_idx
  on public.activity_notifications (supplier_id);

alter table public.activity_notifications enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'activity_notifications'
      and policyname = 'activity_notifications_select_authenticated'
  ) then
    create policy activity_notifications_select_authenticated
      on public.activity_notifications
      for select
      to authenticated
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'activity_notifications'
      and policyname = 'activity_notifications_insert_authenticated'
  ) then
    create policy activity_notifications_insert_authenticated
      on public.activity_notifications
      for insert
      to authenticated
      with check (true);
  end if;
end $$;
