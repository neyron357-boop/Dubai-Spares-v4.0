import { supabase } from './supabaseClient'

export async function loadJsonState(): Promise<any> {
  if (!supabase) return {}

  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 'global')
    .maybeSingle()

  if (error) throw error
  return data?.data ?? {}
}

export async function saveJsonState(json: any): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('app_state')
    .upsert(
      {
        id: 'global',
        data: json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )

  if (error) throw error
}
