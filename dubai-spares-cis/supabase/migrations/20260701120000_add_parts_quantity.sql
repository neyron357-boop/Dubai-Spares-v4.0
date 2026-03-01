-- Add quantity support for parts while preserving legacy rows.
alter table public.parts
  add column if not exists quantity integer;

update public.parts
set quantity = 1
where quantity is null or quantity <= 0;

alter table public.parts
  alter column quantity set default 1;
