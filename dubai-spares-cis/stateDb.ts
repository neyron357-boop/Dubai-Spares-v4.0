import { isSupabaseConfigured, supabase } from './supabaseClient'

export async function loadJsonState(): Promise<any> {
  if (!isSupabaseConfigured) return {}

  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 'global')
    .single()

  if (error) throw error
  return data?.data ?? {}
}

export async function saveJsonState(json: any): Promise<void> {
  if (!isSupabaseConfigured) return

  const { error } = await supabase
    .from('app_state')
    .update({ data: json, updated_at: new Date().toISOString() })
    .eq('id', 'global')

  if (error) throw error
}
