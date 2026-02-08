import { supabase } from './supabaseClient';

const TABLE = 'app_state';
const ID = 'global';

export async function loadCloudState(): Promise<any | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('data')
    .eq('id', ID)
    .single();
    .maybeSingle();

  if (error) {
    console.error('loadCloudState error', error);
    console.error('loadCloudState error', {
      message: error.message,
      code: (error as any).code,
      details: (error as any).details,
      hint: (error as any).hint,
    });
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
    console.error('saveCloudState error', {
      message: error.message,
      code: (error as any).code,
      details: (error as any).details,
      hint: (error as any).hint,
    });
    throw error;
  }
}
