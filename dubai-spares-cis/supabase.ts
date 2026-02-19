import { createClient } from '@supabase/supabase-js';
import { isCloudConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from './cloudConfig';
import { logger } from './logging';

export const isCloudSyncConfigured = isCloudConfigured;

export const supabase = isCloudSyncConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  : null;

void logger.info('supabase:init', isCloudSyncConfigured ? 'Supabase client initialized' : 'Supabase client disabled: missing or invalid env vars', {
  isCloudSyncConfigured
});
