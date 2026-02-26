alter table if exists public.client_leads
  add column if not exists is_viewed boolean not null default false,
  add column if not exists converted_to_order_id text;

create index if not exists idx_client_leads_is_viewed
  on public.client_leads (is_viewed, created_at desc);

create index if not exists idx_client_leads_converted_to_order_id
  on public.client_leads (converted_to_order_id);
