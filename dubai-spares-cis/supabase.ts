import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isCloudSyncConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isCloudSyncConfigured) {
  console.warn('☁️ Cloud sync disabled: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  console.error('Supabase env vars are undefined', {
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey)
  });
}

export const supabase = isCloudSyncConfigured ? createClient(supabaseUrl!, supabaseAnonKey!) : null;
