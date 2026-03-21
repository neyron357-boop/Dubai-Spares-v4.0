-- Add durable AI core API key field to shared app settings.
insert into public.app_state (id, data, updated_at)
values (
  'app_settings',
  jsonb_build_object('aiCoreApiKey', ''),
  now()
)
on conflict (id) do update
set
  data = case
    when coalesce(public.app_state.data, '{}'::jsonb) ? 'aiCoreApiKey' then public.app_state.data
    else jsonb_set(coalesce(public.app_state.data, '{}'::jsonb), '{aiCoreApiKey}', '""'::jsonb, true)
  end,
  updated_at = now();
