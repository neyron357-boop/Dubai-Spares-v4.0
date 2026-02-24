-- Stability pack: idempotency, atomic event apply, and performance indexes.

alter table if exists public.radar_events
  add column if not exists client_event_id uuid;

create unique index if not exists uq_radar_events_client_event_id
  on public.radar_events (client_event_id)
  where client_event_id is not null;

create index if not exists idx_radar_targets_session_status
  on public.radar_targets (radar_session_id, status);

create index if not exists idx_radar_targets_session_score
  on public.radar_targets (radar_session_id, score desc);

create index if not exists idx_radar_target_items_target_status
  on public.radar_target_items (radar_target_id, item_status);

create index if not exists idx_radar_events_session_created
  on public.radar_events (radar_session_id, created_at desc);

create index if not exists idx_shop_metrics_shop_id
  on public.shop_metrics (shop_id);

create or replace function public.radar_apply_event(
  p_event_payload jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_event_type text;
  v_target_id uuid;
  v_target_item_id uuid;
  v_shop_id uuid;
  v_status text;
  v_item_status text;
  v_payload jsonb;
  v_inserted_id uuid;
begin
  if p_client_event_id is null then
    raise exception 'client_event_id is required';
  end if;

  v_session_id := nullif(p_event_payload->>'radar_session_id', '')::uuid;
  v_event_type := coalesce(nullif(p_event_payload->>'event_type', ''), 'unknown');
  v_target_id := nullif(p_event_payload->>'target_id', '')::uuid;
  v_target_item_id := nullif(p_event_payload->>'target_item_id', '')::uuid;
  v_shop_id := nullif(p_event_payload->>'shop_id', '')::uuid;
  v_status := nullif(p_event_payload->>'status', '');
  v_item_status := nullif(p_event_payload->>'item_status', '');
  v_payload := coalesce(p_event_payload->'payload', '{}'::jsonb);

  insert into public.radar_events (radar_session_id, event_type, payload, client_event_id)
  values (v_session_id, v_event_type, v_payload, p_client_event_id)
  on conflict (client_event_id) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return jsonb_build_object('status', 'duplicate', 'client_event_id', p_client_event_id);
  end if;

  if v_status is not null and v_target_id is not null then
    update public.radar_targets
    set status = v_status,
        updated_at = now()
    where id = v_target_id;
  end if;

  if v_item_status is not null and v_target_item_id is not null then
    update public.radar_target_items
    set item_status = v_item_status,
        updated_at = now()
    where id = v_target_item_id;
  end if;

  if v_shop_id is not null and v_event_type in ('item_found', 'item_not_found', 'wrong_info', 'call', 'whatsapp', 'visited', 'status_change') then
    insert into public.shop_metrics (shop_id)
    values (v_shop_id)
    on conflict (shop_id) do nothing;

    update public.shop_metrics
    set
      total_interactions = total_interactions + 1,
      total_found = total_found + case when v_event_type = 'item_found' then 1 else 0 end,
      total_not_found = total_not_found + case when v_event_type = 'item_not_found' then 1 else 0 end,
      total_wrong_info = total_wrong_info + case when v_event_type = 'wrong_info' then 1 else 0 end,
      last_interaction_at = now(),
      updated_at = now()
    where shop_id = v_shop_id;
  end if;

  return jsonb_build_object('status', 'applied', 'client_event_id', p_client_event_id, 'event_id', v_inserted_id);
end;
$$;

grant execute on function public.radar_apply_event(jsonb, uuid) to anon, authenticated, service_role;
