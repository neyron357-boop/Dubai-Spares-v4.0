import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anon)

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Cloud sync is disabled; app will run in local-only mode.'
  )
}

const FALLBACK_URL = 'https://local-disabled-supabase.invalid'
const FALLBACK_KEY = 'local-disabled-supabase-key'

export const supabase = createClient(url ?? FALLBACK_URL, anon ?? FALLBACK_KEY)
