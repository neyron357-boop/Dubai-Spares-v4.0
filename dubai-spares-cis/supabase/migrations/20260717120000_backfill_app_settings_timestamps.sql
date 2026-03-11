-- Ensure app settings metadata stays durable in cloud app_state rows.
-- Safe to rerun.

insert into public.app_state (id, data, updated_at)
values (
  'app_settings',
  jsonb_build_object('appSettingsUpdatedAt', extract(epoch from now())::bigint * 1000),
  now()
)
on conflict (id) do update
set
  data = coalesce(public.app_state.data, '{}'::jsonb)
    || jsonb_build_object(
      'appSettingsUpdatedAt',
      coalesce(
        nullif(public.app_state.data ->> 'appSettingsUpdatedAt', '')::bigint,
        extract(epoch from now())::bigint * 1000
      )
    ),
  updated_at = now();

insert into public.app_state (id, data, updated_at)
values (
  'public_settings',
  jsonb_build_object(
    'publicContactsUpdatedAt', extract(epoch from now())::bigint * 1000,
    'appSettingsUpdatedAt', extract(epoch from now())::bigint * 1000
  ),
  now()
)
on conflict (id) do update
set
  data = coalesce(public.app_state.data, '{}'::jsonb)
    || jsonb_build_object(
      'publicContactsUpdatedAt',
      coalesce(
        nullif(public.app_state.data ->> 'publicContactsUpdatedAt', '')::bigint,
        extract(epoch from now())::bigint * 1000
      ),
      'appSettingsUpdatedAt',
      coalesce(
        nullif(public.app_state.data ->> 'appSettingsUpdatedAt', '')::bigint,
        extract(epoch from now())::bigint * 1000
      )
    ),
  updated_at = now();
