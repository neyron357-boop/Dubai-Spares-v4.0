import { supabase } from './supabaseClient';

const TABLE = 'app_state';
const ID = 'global';

export async function loadCloudState(): Promise<any | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('data')
    .eq('id', ID)
    .single();

  if (error) {
    console.error('loadCloudState error', error);
    return null;
  }

  return data?.data ?? null;
}

export async function saveCloudState(json: any): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ id: ID, data: json }, { onConflict: 'id' });

  if (error) {
    console.error('saveCloudState error', error);
    throw error;
  }
}
