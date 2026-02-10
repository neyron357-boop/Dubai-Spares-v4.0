alter table if exists public.shops enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'shops'
      and policyname = 'anon_read_shops'
  ) then
    create policy "anon_read_shops"
      on public.shops
      for select
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'shops'
      and policyname = 'anon_write_shops'
  ) then
    create policy "anon_write_shops"
      on public.shops
      for all
      using (true)
      with check (true);
  end if;
end
$$;

alter table if exists public.orders
  add column if not exists vin_photo_url text,
  add column if not exists social_nickname text not null default '';
