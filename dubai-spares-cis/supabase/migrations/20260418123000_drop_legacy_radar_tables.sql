-- Cleanup: remove deprecated radar tables that are no longer used by the app.
-- Safe to run multiple times.

drop table if exists public.radar_target_items cascade;
drop table if exists public.radar_events cascade;
drop table if exists public.radar_sessions cascade;
