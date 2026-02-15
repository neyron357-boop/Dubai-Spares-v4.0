import { logger } from './logging';

export const isCloudSyncConfigured = false;
export const supabase = null;

void logger.info('supabase:init', 'Legacy Supabase client disabled. Use serverApi.ts explicit actions only.', {
  isCloudSyncConfigured,
  supabase: 'null'
});
