alter table if exists public.orders
  add column if not exists vendor_checklist jsonb;

update public.orders
set vendor_checklist = '[]'::jsonb
where vendor_checklist is null;

alter table if exists public.orders
  alter column vendor_checklist set default '[]'::jsonb,
  alter column vendor_checklist set not null;
