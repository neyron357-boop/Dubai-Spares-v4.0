-- ============================================================
-- Add 'defect' as a valid waypoint result in the hunt pipeline
-- ============================================================
-- The original constraint only permitted: found | not_found | high_price | visited
-- This migration widens it to also accept 'defect' (Дефект) matching the
-- operator UI status options documented in the ТЗ.

alter table public.order_hunt_waypoints
  drop constraint if exists order_hunt_waypoints_result_check;

alter table public.order_hunt_waypoints
  add constraint order_hunt_waypoints_result_check
  check (result in ('found', 'not_found', 'high_price', 'visited', 'defect'));
