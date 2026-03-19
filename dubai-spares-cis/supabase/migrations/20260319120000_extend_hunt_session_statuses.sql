alter table public.order_hunt_sessions
  drop constraint if exists order_hunt_sessions_status_check;

alter table public.order_hunt_sessions
  add constraint order_hunt_sessions_status_check
  check (status in ('active', 'paused', 'completed', 'ended'));

update public.order_hunt_sessions
set status = 'completed'
where status = 'ended';
