-- Radar item-level tracking + safe per-shop metrics updates

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  part_name text not null,
  brand text,
  model text,
  year integer,
  quantity int default 1,
  created_at timestamptz default now()
);

create index if not exists idx_order_items_order_id on public.order_items (order_id);

alter table if exists public.order_items enable row level security;

drop policy if exists "anon_read_order_items" on public.order_items;
create policy "anon_read_order_items"
  on public.order_items
  for select
  using (true);

drop policy if exists "anon_write_order_items" on public.order_items;
create policy "anon_write_order_items"
  on public.order_items
  for all
  using (true)
  with check (true);

do $$
begin
  if to_regclass('public.radar_targets') is not null then
    create table if not exists public.radar_target_items (
      id uuid primary key default gen_random_uuid(),
      radar_target_id uuid not null references public.radar_targets(id) on delete cascade,
      order_item_id uuid not null,
      item_status text not null default 'pending',
      price_aed numeric(12,2),
      notes text,
      updated_at timestamptz default now(),
      constraint radar_target_items_status_check check (item_status in ('pending', 'found', 'not_found', 'partial'))
    );

    create unique index if not exists idx_radar_target_items_target_order_item
      on public.radar_target_items (radar_target_id, order_item_id);
    create index if not exists idx_radar_target_items_status
      on public.radar_target_items (item_status);

    alter table if exists public.radar_target_items enable row level security;

    drop policy if exists "anon_read_radar_target_items" on public.radar_target_items;
    create policy "anon_read_radar_target_items"
      on public.radar_target_items
      for select
      using (true);

    drop policy if exists "anon_write_radar_target_items" on public.radar_target_items;
    create policy "anon_write_radar_target_items"
      on public.radar_target_items
      for all
      using (true)
      with check (true);
  end if;
end $$;

create or replace function public.record_radar_item_event(
  p_target_item_id uuid,
  p_item_status text,
  p_price_aed numeric default null,
  p_notes text default null,
  p_wrong_info boolean default false
)
returns table (
  radar_target_item_id uuid,
  shop_id uuid,
  event_type text,
  total_interactions int,
  total_found int,
  total_not_found int,
  total_wrong_info int,
  success_rate numeric,
  auto_trust_score int,
  heat_level int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_item public.radar_target_items%rowtype;
  v_target public.radar_targets%rowtype;
  v_event_type text;
  v_total_interactions int;
  v_total_found int;
  v_total_not_found int;
  v_total_wrong_info int;
  v_success_rate numeric;
  v_auto_trust_score int;
  v_heat_level int;
begin
  if p_item_status not in ('found', 'not_found', 'partial') then
    raise exception 'Unsupported item status: %', p_item_status;
  end if;

  select * into v_target_item
  from public.radar_target_items
  where id = p_target_item_id
  for update;

  if not found then
    raise exception 'Radar target item not found: %', p_target_item_id;
  end if;

  select * into v_target
  from public.radar_targets
  where id = v_target_item.radar_target_id;

  if not found then
    raise exception 'Radar target not found for item: %', p_target_item_id;
  end if;

  update public.radar_target_items
  set
    item_status = p_item_status,
    price_aed = coalesce(p_price_aed, price_aed),
    notes = coalesce(p_notes, notes),
    updated_at = now()
  where id = p_target_item_id;

  v_event_type := case
    when p_item_status = 'found' then 'item_found'
    when p_item_status = 'not_found' then 'item_not_found'
    else 'item_partial'
  end;

  insert into public.radar_events (radar_session_id, event_type, payload)
  values (
    v_target.radar_session_id,
    v_event_type,
    jsonb_build_object(
      'target_item_id', p_target_item_id,
      'radar_target_id', v_target.id,
      'shop_id', v_target.shop_id,
      'order_item_id', v_target_item.order_item_id,
      'item_status', p_item_status,
      'price_aed', p_price_aed,
      'notes', p_notes,
      'wrong_info', p_wrong_info,
      'at', now()
    )
  );

  insert into public.shop_metrics (shop_id)
  values (v_target.shop_id)
  on conflict (shop_id) do nothing;

  update public.shop_metrics
  set
    total_interactions = total_interactions + 1,
    total_found = total_found + case when p_item_status = 'found' then 1 else 0 end,
    total_not_found = total_not_found + case when p_item_status = 'not_found' then 1 else 0 end,
    total_wrong_info = total_wrong_info + case when p_wrong_info then 1 else 0 end,
    last_interaction_at = now(),
    success_rate = case
      when p_item_status = 'found' then (total_found + 1)::numeric / greatest(total_found + total_not_found + 1, 1)
      when p_item_status = 'not_found' then total_found::numeric / greatest(total_found + total_not_found + 1, 1)
      else total_found::numeric / greatest(total_found + total_not_found, 1)
    end,
    updated_at = now()
  where shop_id = v_target.shop_id;

  update public.shop_metrics
  set
    auto_trust_score = greatest(
      least(
        100,
        (
          success_rate * 60
          + (case when fast_whatsapp then 10 else 0 end)
          + (case when has_delivery then 10 else 0 end)
        )::int
      ) - (case when p_wrong_info then 5 else 0 end),
      0
    ),
    heat_level = (total_found * 3) - (total_wrong_info * 2) + least(total_interactions, 20),
    updated_at = now()
  where shop_id = v_target.shop_id;

  select
    p_target_item_id,
    v_target.shop_id,
    v_event_type,
    sm.total_interactions,
    sm.total_found,
    sm.total_not_found,
    sm.total_wrong_info,
    sm.success_rate,
    sm.auto_trust_score,
    sm.heat_level
  into
    radar_target_item_id,
    shop_id,
    event_type,
    total_interactions,
    total_found,
    total_not_found,
    total_wrong_info,
    success_rate,
    auto_trust_score,
    heat_level
  from public.shop_metrics sm
  where sm.shop_id = v_target.shop_id;

  return next;
end;
$$;

grant execute on function public.record_radar_item_event(uuid, text, numeric, text, boolean) to anon, authenticated, service_role;
