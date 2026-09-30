import { SUPABASE_URL } from '../cloudConfig';
import { getSupabaseAuthHeaders } from '../authSession';

/** A connection probe must never insert fictitious leads into a real database. */
export const testSupabaseConnection = async () => {
  if (!SUPABASE_URL) return { success: false, error: 'Cloud is not configured' };
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/client_leads?select=id&limit=0`, {
      headers: getSupabaseAuthHeaders(), signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { success: true, data: [] } : { success: false, error: `Server returned ${response.status}` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
};
