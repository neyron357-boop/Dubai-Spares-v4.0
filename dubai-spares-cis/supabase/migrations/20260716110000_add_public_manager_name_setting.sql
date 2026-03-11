-- Ensure public manager full name is persisted in public settings payload
insert into public.app_state (id, data, updated_at)
values (
  'public_settings',
  jsonb_build_object('publicManagerName', ''),
  timezone('utc', now())
)
on conflict (id) do update
set
  data = case
    when coalesce(public.app_state.data, '{}'::jsonb) ? 'publicManagerName' then public.app_state.data
    else jsonb_set(coalesce(public.app_state.data, '{}'::jsonb), '{publicManagerName}', '""'::jsonb, true)
  end,
  updated_at = timezone('utc', now());
