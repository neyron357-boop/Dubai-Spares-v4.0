alter table orders drop column if exists updated_at;
alter table orders drop column if exists created_at;
alter table orders add column created_at timestamp with time zone default now();
alter table orders add column updated_at timestamp with time zone default now();
notify pgrst, 'reload schema';
