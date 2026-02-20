import { supabase } from './supabaseClient';
import { isTableMissingError } from './utils/tableMissing';

const TABLE = 'app_state';
const ID = 'global';

export async function loadCloudState(): Promise<any | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(TABLE)
    .select('data')
    .eq('id', ID)
    .maybeSingle();

  if (error) {
    if (!isTableMissingError(error)) {
      console.error('loadCloudState error', error);
    }
    return null;
  }

  return data?.data ?? null;
}

export async function saveCloudState(json: any): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from(TABLE)
    .upsert({ id: ID, data: json }, { onConflict: 'id' });

  if (error && !isTableMissingError(error)) {
    console.error('saveCloudState error', error);
    throw error;
  }
}
