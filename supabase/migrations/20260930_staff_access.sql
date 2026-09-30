-- Reviewed rollout required: provision staff in auth.users and app_members, then
-- deploy with VITE_REQUIRE_AUTH=true. Run in a maintenance window after a backup.
-- No application records are deleted or replaced.
begin;

create table if not exists public.app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_members enable row level security;
revoke all on public.app_members from anon, authenticated;
grant select on public.app_members to authenticated;
drop policy if exists members_read_self on public.app_members;
create policy members_read_self on public.app_members for select to authenticated using (user_id = auth.uid());

create or replace function public.app_is_member()
returns boolean language sql stable security definer set search_path = pg_catalog
as $$ select exists (select 1 from public.app_members where user_id = auth.uid()) $$;
revoke all on function public.app_is_member() from public;
grant execute on function public.app_is_member() to authenticated;

do $$
declare target text; existing record;
begin
  foreach target in array array['app_state','orders','parts','price_variants','shops',
    'public_quote_snapshots','client_leads','backups','activity_notifications',
    'radar_sessions','radar_targets','order_items','radar_target_items','radar_events','push_subscriptions']
  loop
    if to_regclass('public.' || target) is null then continue; end if;
    execute format('alter table public.%I enable row level security', target);
    -- Remove permissive legacy policies so they cannot bypass the membership rule.
    for existing in select policyname from pg_policies where schemaname = 'public' and tablename = target loop
      execute format('drop policy %I on public.%I', existing.policyname, target);
    end loop;
    execute format('revoke all on public.%I from anon', target);
    execute format('grant select, insert, update, delete on public.%I to authenticated', target);
    execute format('create policy staff_access on public.%I for all to authenticated using (public.app_is_member()) with check (public.app_is_member())', target);
  end loop;
  foreach target in array array['v_shops_enriched','v_radar_active_targets'] loop
    if to_regclass('public.' || target) is not null then
      execute format('alter view public.%I set (security_invoker = true)', target);
      execute format('revoke all on public.%I from anon', target);
      execute format('grant select on public.%I to authenticated', target);
    end if;
  end loop;
end $$;

-- Only this explicitly curated row can be read by public forms.
grant select on public.app_state to anon;
create policy public_contact_settings on public.app_state for select to anon using (id = 'public_settings');

create or replace function public.public_quote_by_token(p_token text)
returns table (id text, token text, snapshot_id text, expires_at timestamptz, payload jsonb, payload_json jsonb, payload_b64 text, payload_codec text)
language sql stable security definer set search_path = pg_catalog
as $$
  select q.id, q.token, q.snapshot_id, q.expires_at, q.payload, q.payload_json, q.payload_b64, q.payload_codec
  from public.public_quote_snapshots q
  where q.token = p_token and length(p_token) >= 32 and q.expires_at > now()
  limit 1
$$;
revoke all on function public.public_quote_by_token(text) from public;
grant execute on function public.public_quote_by_token(text) to anon, authenticated;

create or replace function public.public_lead_create(p_lead jsonb)
returns table (id text)
language plpgsql security definer set search_path = pg_catalog
as $$
declare created_id text; request_key text;
begin
  request_key := p_lead->>'idempotency_key';
  if length(coalesce(p_lead->>'name','')) not between 1 and 200
     or length(coalesce(p_lead->>'phone','')) not between 1 and 100
     or length(coalesce(request_key,'')) not between 16 and 128
     or octet_length(p_lead::text) > 1048576 then
    raise exception 'Invalid lead payload' using errcode = '22023';
  end if;
  insert into public.client_leads(name, phone, message, order_id, payload, payload_b64, payload_codec, image_manifest, idempotency_key)
  values(p_lead->>'name', p_lead->>'phone', coalesce(p_lead->>'message',''), p_lead->>'order_id',
    coalesce(p_lead->'payload','{}'::jsonb), p_lead->>'payload_b64', p_lead->>'payload_codec',
    coalesce(p_lead->'image_manifest','[]'::jsonb), request_key)
  on conflict (idempotency_key) do nothing returning client_leads.id into created_id;
  if created_id is null then
    select l.id into created_id from public.client_leads l where l.idempotency_key = request_key;
  end if;
  return query select created_id;
end $$;
revoke all on function public.public_lead_create(jsonb) from public;
grant execute on function public.public_lead_create(jsonb) to anon, authenticated;

-- Public clients may add lead photos, but cannot overwrite/delete other uploads.
-- Storage buckets enforce allowed image MIME types and a 10 MiB file limit.
do $$
declare existing record;
begin
  if to_regclass('storage.objects') is null then return; end if;
  for existing in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('images_public_select','images_anon_insert','images_anon_update','images_anon_delete','staff_images','public_lead_images') loop
    execute format('drop policy %I on storage.objects', existing.policyname);
  end loop;
  create policy staff_images on storage.objects for all to authenticated
    using (bucket_id in ('images','order-images') and public.app_is_member())
    with check (bucket_id in ('images','order-images') and public.app_is_member());
  create policy public_lead_images on storage.objects for insert to anon
    with check (bucket_id in ('images','order-images') and (storage.foldername(name))[1] = 'orders');
end $$;

commit;
