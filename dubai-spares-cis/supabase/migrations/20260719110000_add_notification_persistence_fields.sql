-- Add server-side persistence fields to activity_notifications so that
-- notifications survive browser cache clears and app restarts.

alter table public.activity_notifications
  add column if not exists client_id text,
  add column if not exists read_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists signature text,
  add column if not exists snooze_until bigint,
  add column if not exists follow_up_at bigint,
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists radar_session_id text,
  add column if not exists phone text,
  add column if not exists map_url text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists distance_m double precision,
  add column if not exists brand text,
  add column if not exists car_model text,
  add column if not exists car_year integer,
  add column if not exists offline boolean default false;

-- Unique index on client_id for upsert support
create unique index if not exists activity_notifications_client_id_idx
  on public.activity_notifications (client_id)
  where client_id is not null;

-- Index for signature deduplication
create index if not exists activity_notifications_signature_idx
  on public.activity_notifications (signature)
  where signature is not null;

-- Index for unread lookups
create index if not exists activity_notifications_read_at_idx
  on public.activity_notifications (read_at)
  where read_at is null;

-- Index for archived lookups
create index if not exists activity_notifications_archived_at_idx
  on public.activity_notifications (archived_at)
  where archived_at is null;

-- Allow upsert (update) for authenticated users
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'activity_notifications'
      and policyname = 'activity_notifications_update_authenticated'
  ) then
    create policy activity_notifications_update_authenticated
      on public.activity_notifications
      for update
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'activity_notifications'
      and policyname = 'activity_notifications_delete_authenticated'
  ) then
    create policy activity_notifications_delete_authenticated
      on public.activity_notifications
      for delete
      to authenticated
      using (true);
  end if;
end $$;
