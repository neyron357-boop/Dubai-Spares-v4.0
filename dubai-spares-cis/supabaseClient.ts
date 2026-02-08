import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isCloudSyncConfigured = Boolean(url && anon)

if (!isCloudSyncConfigured) {
  console.warn('☁️ Cloud sync disabled: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = isCloudSyncConfigured ? createClient(url!, anon!) : null
