alter table if exists public.orders
  add column if not exists vin_photo_url text,
  add column if not exists social_nickname text not null default '',
  add column if not exists body_type text;
