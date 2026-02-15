alter table if exists public.backups
  add column if not exists payload_b64 text,
  add column if not exists payload_codec text default 'gzip+pako+b64',
  add column if not exists image_manifest jsonb,
  add column if not exists payload_json jsonb;

alter table if exists public.public_quote_snapshots
  add column if not exists payload_b64 text,
  add column if not exists payload_codec text default 'gzip+pako+b64',
  add column if not exists image_manifest jsonb,
  add column if not exists payload_json jsonb;

alter table if exists public.leads
  add column if not exists payload_b64 text,
  add column if not exists payload_codec text default 'gzip+pako+b64',
  add column if not exists image_manifest jsonb,
  add column if not exists payload_json jsonb;
