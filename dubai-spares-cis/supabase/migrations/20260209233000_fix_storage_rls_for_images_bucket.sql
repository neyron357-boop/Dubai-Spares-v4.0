-- Allow anonymous uploads for the public images bucket used by offline sync.
-- Without these policies, storage uploads fail with:
--   "new row violates row-level security policy"

insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do update
set public = excluded.public;

alter table storage.objects enable row level security;

drop policy if exists "anon_read_images" on storage.objects;
create policy "anon_read_images"
  on storage.objects
  for select
  to anon
  using (bucket_id = 'images');

drop policy if exists "anon_insert_images" on storage.objects;
create policy "anon_insert_images"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'images');

drop policy if exists "anon_update_images" on storage.objects;
create policy "anon_update_images"
  on storage.objects
  for update
  to anon
  using (bucket_id = 'images')
  with check (bucket_id = 'images');

drop policy if exists "anon_delete_images" on storage.objects;
create policy "anon_delete_images"
  on storage.objects
  for delete
  to anon
  using (bucket_id = 'images');
