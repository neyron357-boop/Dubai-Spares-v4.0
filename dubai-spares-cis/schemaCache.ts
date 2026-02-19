import { supabase } from './supabase';
import { logger } from './logging';

let refreshInFlight: Promise<void> | null = null;

export const refreshSupabaseSchemaCache = async (reason: string) => {
  if (!supabase) return false;
  if (refreshInFlight) {
    await refreshInFlight;
    return true;
  }

  refreshInFlight = (async () => {
    try {
      const { error } = await supabase.rpc('refresh_schema_cache');
      if (error) {
        await logger.warn('schema:refresh', 'Failed to execute refresh_schema_cache rpc', { reason, error: error.message });
        return;
      }
      await logger.warn('schema:refresh', 'Supabase schema cache refresh requested', { reason });
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    } catch (error) {
      await logger.warn('schema:refresh', 'Schema refresh threw exception', {
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  await refreshInFlight;
  return true;
};
