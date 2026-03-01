-- Support grouped parts without breaking existing records.
alter table public.parts
  add column if not exists part_kind text;

alter table public.parts
  add column if not exists group_items jsonb;

update public.parts
set
  part_kind = coalesce(nullif(part_kind, ''), 'single'),
  group_items = coalesce(group_items, '[]'::jsonb)
where part_kind is null
   or part_kind = ''
   or group_items is null;

alter table public.parts
  alter column part_kind set default 'single';

alter table public.parts
  alter column group_items set default '[]'::jsonb;
