import { supabase } from './supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './cloudConfig';
import { logger } from './logging';

const RPC_SETTLE_DELAY_MS = 500;
// HEAD probe needs a slightly longer settle window because it only pings the
// REST gateway rather than executing the actual schema-reload function.
const HEAD_PROBE_SETTLE_DELAY_MS = 800;

let refreshInFlight: Promise<void> | null = null;

export const refreshSupabaseSchemaCache = async (reason: string) => {
  if (!supabase) return false;
  if (refreshInFlight) {
    await refreshInFlight;
    return true;
  }

  refreshInFlight = (async () => {
    try {
      // First try the custom RPC (may not exist in all deployments)
      const { error: rpcError } = await supabase.rpc('refresh_schema_cache');
      if (!rpcError) {
        await logger.info('schema:refresh', 'Supabase schema cache refresh requested via rpc', { reason });
        await new Promise((resolve) => window.setTimeout(resolve, RPC_SETTLE_DELAY_MS));
        return;
      }
      // If RPC doesn't exist, fall back to a lightweight REST probe which triggers
      // PostgREST to reload its schema cache on the next request cycle
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        await fetch(`${SUPABASE_URL}/rest/v1/`, {
          method: 'HEAD',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`
          }
        }).catch(() => undefined);
      }
      await new Promise((resolve) => window.setTimeout(resolve, HEAD_PROBE_SETTLE_DELAY_MS));
      await logger.info('schema:refresh', 'Supabase schema cache refresh via HEAD probe', { reason });
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
