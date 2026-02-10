alter table if exists public.orders
  add column if not exists vin_photo_url text,
  add column if not exists body_type text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'price_variants'
      and column_name = 'created_at'
      and data_type <> 'bigint'
  ) then
    alter table public.price_variants
      alter column created_at type bigint
      using (extract(epoch from created_at) * 1000)::bigint;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'price_variants'
      and column_name = 'created_at'
  ) then
    alter table public.price_variants
      add column created_at bigint;
  end if;
end $$;

alter table if exists public.price_variants
  alter column created_at set default (extract(epoch from now()) * 1000)::bigint,
  alter column created_at set not null;
