import { CLOUD_FEATURES } from './localMode';

const rawSupabaseUrl = ((import.meta as any).env?.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const rawSupabaseAnonKey = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

const parseHost = (value: string) => {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
};

export const SUPABASE_URL = rawSupabaseUrl;
export const SUPABASE_ANON_KEY = rawSupabaseAnonKey;
export const SUPABASE_HOST = parseHost(rawSupabaseUrl);
export const isSupabaseUrlValid = Boolean(SUPABASE_HOST && /^https:\/\//i.test(rawSupabaseUrl));
export const isCloudConfigured = isSupabaseUrlValid && Boolean(SUPABASE_ANON_KEY);

export const cloudFeatureFlags = {
  backup: Boolean(CLOUD_FEATURES.BACKUP),
  publicQuote: Boolean(CLOUD_FEATURES.PUBLIC_QUOTE),
  clientForm: Boolean(CLOUD_FEATURES.CLIENT_FORM)
};

export const cloudBuildGuardMessage = isCloudConfigured
  ? ''
  : 'Cloud is disabled: missing or invalid VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Rebuild with valid env vars.';

export type CloudCallStatus = {
  at: string;
  action: string;
  ok: boolean;
  code: string;
  message?: string;
};

let lastCloudCall: CloudCallStatus | null = null;

export const setLastCloudCall = (status: CloudCallStatus) => {
  lastCloudCall = status;
  window.dispatchEvent(new CustomEvent('cloud:last-call', { detail: status }));
};

export const getLastCloudCall = () => lastCloudCall;

export const cloudDiagnosticsText = () => JSON.stringify({
  host: SUPABASE_HOST || 'invalid',
  isCloudConfigured,
  cloudFeatureFlags,
  lastCloudCall
}, null, 2);
