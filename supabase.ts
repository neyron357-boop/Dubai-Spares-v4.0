import { createClient } from '@supabase/supabase-js';
import { isCloudConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from './cloudConfig';
import { logger } from './logging';
import { wrapSupabaseFetch } from './egressDebug';
import { requiresStaffLogin, setSessionAccessToken } from './authSession';

export const isCloudSyncConfigured = isCloudConfigured;

export const supabase = isCloudSyncConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: requiresStaffLogin,
        autoRefreshToken: requiresStaffLogin,
        detectSessionInUrl: false
      },
      global: {
        fetch: wrapSupabaseFetch,
        headers: {
          apikey: SUPABASE_ANON_KEY,
        }
      }
    })
  : null;

void logger.info('supabase:init', isCloudSyncConfigured ? 'Supabase client initialized' : 'Supabase client disabled: missing or invalid env vars', {
  isCloudSyncConfigured
});

if (supabase && requiresStaffLogin) {
  supabase.auth.onAuthStateChange((_event, session) => setSessionAccessToken(session?.access_token || null));
}
