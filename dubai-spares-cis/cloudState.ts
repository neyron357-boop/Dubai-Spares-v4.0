import { supabase } from './supabaseClient'

export async function loadCloudState(): Promise<any> {
  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 'global')
    .single()

  if (error) throw error
  return data?.data ?? {}
}

export async function saveCloudState(json: any): Promise<void> {
  const { error } = await supabase
    .from('app_state')
    .update({ data: json, updated_at: new Date().toISOString() })
    .eq('id', 'global')

  if (error) throw error
}
