-- Backfill public quote snapshots with deterministic totals/contacts and allow safe anon remap updates.

alter table if exists public.public_quote_snapshots
  add column if not exists payload_json jsonb;

update public.public_quote_snapshots
set payload_json = coalesce(payload_json, payload)
where payload_json is null
  and payload is not null;

with recomputed as (
  select
    id,
    coalesce(
      (
        select sum(
          coalesce(
            nullif(item ->> 'line_total', '')::numeric,
            (coalesce(nullif(item ->> 'qty', '')::numeric, 1) * coalesce(nullif(item ->> 'unit_price', '')::numeric, 0)),
            nullif(item ->> 'price', '')::numeric,
            0
          )
        )
        from jsonb_array_elements(coalesce(payload_json -> 'items', '[]'::jsonb)) as item
      ),
      coalesce(nullif(payload_json #>> '{totals,parts_total}', '')::numeric, nullif(payload_json #>> '{totals,parts_sum_aed}', '')::numeric, 0)
    ) as parts_total,
    coalesce(nullif(payload_json #>> '{fees,logistics}', '')::numeric, nullif(payload_json #>> '{totals,logistics_aed}', '')::numeric, 0) as logistics,
    coalesce(nullif(payload_json #>> '{fees,packaging}', '')::numeric, nullif(payload_json #>> '{totals,packing_aed}', '')::numeric, 0) as packaging,
    coalesce(nullif(payload_json #>> '{fees,commission}', '')::numeric, nullif(payload_json #>> '{totals,commission_aed}', '')::numeric, 0) as commission,
    payload_json
  from public.public_quote_snapshots
  where payload_json is not null
)
update public.public_quote_snapshots p
set payload_json = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                coalesce(p.payload_json, '{}'::jsonb),
                '{totals,parts_total}',
                to_jsonb(round(r.parts_total::numeric, 2)),
                true
              ),
              '{totals,parts_sum_aed}',
              to_jsonb(round(r.parts_total::numeric, 2)),
              true
            ),
            '{totals,logistics_aed}',
            to_jsonb(round(r.logistics::numeric, 2)),
            true
          ),
          '{totals,packing_aed}',
          to_jsonb(round(r.packaging::numeric, 2)),
          true
        ),
        '{totals,commission_aed}',
        to_jsonb(round(r.commission::numeric, 2)),
        true
      ),
      '{totals,grand_total}',
      to_jsonb(round((r.parts_total + r.logistics + r.packaging + r.commission)::numeric, 2)),
      true
    ),
    '{totals,grand_total_aed}',
    to_jsonb(round((r.parts_total + r.logistics + r.packaging + r.commission)::numeric, 2)),
    true
  ),
  '{contacts}',
  coalesce(
    p.payload_json -> 'contacts',
    jsonb_build_object(
      'whatsapp', regexp_replace(coalesce(p.payload_json #>> '{public_settings,publicWhatsappNumber}', p.payload_json #>> '{owner,whatsapp_phone}', ''), '\\D', '', 'g'),
      'telegram', coalesce(p.payload_json #>> '{public_settings,publicTelegramUrl}', ''),
      'instagram', coalesce(p.payload_json #>> '{public_settings,publicInstagramUrl}', '')
    )
  ),
  true
)
from recomputed r
where p.id = r.id;

drop policy if exists public_quote_snapshots_update_anon on public.public_quote_snapshots;
create policy public_quote_snapshots_update_anon
  on public.public_quote_snapshots
  for update
  to anon
  using (token is not null and expires_at > now())
  with check (token is not null and expires_at > now());
