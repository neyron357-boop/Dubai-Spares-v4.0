-- Repair schema drift for order sync payload fields.
-- Safe to re-run.

alter table if exists public.orders
  add column if not exists customer_status text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by text;

alter table if exists public.parts
  add column if not exists comment text not null default '';
