-- Persist both original and TinyURL-shortened public quote links.

alter table if exists public.public_quote_snapshots
  add column if not exists original_url text,
  add column if not exists short_url text;
