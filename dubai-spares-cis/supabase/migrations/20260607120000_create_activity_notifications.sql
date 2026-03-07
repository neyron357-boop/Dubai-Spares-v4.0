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

create index if not exists activity_notifications_created_at_idx
  on public.activity_notifications (created_at desc);

create index if not exists activity_notifications_order_id_idx
  on public.activity_notifications (order_id);

create index if not exists activity_notifications_supplier_id_idx
  on public.activity_notifications (supplier_id);
