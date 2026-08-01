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

const maskSecret = (value: string, visible = 16) => {
  if (!value) return 'empty';
  const prefix = value.slice(0, visible);
  return `${prefix}… (len=${value.length})`;
};

const isJwtLike = (value: string) => /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/.test(value);
const isPublishableKeyLike = (value: string) => /^sb_publishable_[A-Za-z0-9_-]+$/.test(value);

const supabaseAnonKeyFormat = !rawSupabaseAnonKey
  ? 'empty'
  : isJwtLike(rawSupabaseAnonKey)
    ? 'jwt'
    : isPublishableKeyLike(rawSupabaseAnonKey)
      ? 'sb_publishable'
      : 'unknown';

export const SUPABASE_URL = rawSupabaseUrl;
export const SUPABASE_ANON_KEY = rawSupabaseAnonKey;
export const SUPABASE_HOST = parseHost(rawSupabaseUrl);
export const isSupabaseUrlValid = Boolean(SUPABASE_HOST && /^https:\/\//i.test(rawSupabaseUrl));
export const isSupabaseAnonKeyJwt = isJwtLike(rawSupabaseAnonKey);
export const isSupabaseAnonKeyPublishable = isPublishableKeyLike(rawSupabaseAnonKey);
export const isSupabaseAnonKeyAccepted = isSupabaseAnonKeyJwt || isSupabaseAnonKeyPublishable;
export const isCloudConfigured = isSupabaseUrlValid && isSupabaseAnonKeyAccepted;

export const cloudFeatureFlags = {
  backup: Boolean(CLOUD_FEATURES.BACKUP),
  publicQuote: Boolean(CLOUD_FEATURES.PUBLIC_QUOTE),
  clientForm: Boolean(CLOUD_FEATURES.CLIENT_FORM)
};

const cloudConfigFailureReasons = [
  !rawSupabaseUrl ? 'VITE_SUPABASE_URL is empty in the frontend build' : '',
  rawSupabaseUrl && !isSupabaseUrlValid ? 'VITE_SUPABASE_URL is not a valid https URL' : '',
  !rawSupabaseAnonKey ? 'VITE_SUPABASE_ANON_KEY is empty in the frontend build' : '',
  rawSupabaseAnonKey && !isSupabaseAnonKeyAccepted
    ? 'VITE_SUPABASE_ANON_KEY format is not recognized (expected Supabase JWT `eyJ...` or publishable key `sb_publishable_...`)'
    : ''
].filter(Boolean);

const buildTimeHint = !rawSupabaseUrl || !rawSupabaseAnonKey
  ? 'The current frontend bundle is missing one or both VITE_ values, so a rebuild/redeploy is required after fixing env.'
  : '';

export const cloudBuildGuardMessage = isCloudConfigured
  ? ''
  : `Cloud is disabled: ${cloudConfigFailureReasons.join('; ') || 'missing or invalid VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'}. ${buildTimeHint || 'Check the diagnostics below to see which validation step failed.'}`.trim();

export type CloudCallStatus = {
  at: string;
  action: string;
  ok: boolean;
  code: string;
  message?: string;
};

export type CloudConfigDiagnostics = {
  rawSupabaseUrl: string;
  rawSupabaseUrlState: 'present' | 'empty';
  isSupabaseUrlValid: boolean;
  rawSupabaseAnonKey: string;
  rawSupabaseAnonKeyState: 'present' | 'empty';
  isSupabaseAnonKeyJwt: boolean;
  isSupabaseAnonKeyPublishable: boolean;
  acceptedSupabaseAnonKeyFormat: 'jwt' | 'sb_publishable' | 'unknown' | 'empty';
  isCloudConfigured: boolean;
  buildTimeEnvSummary: string;
};

export const getCloudConfigDiagnostics = (): CloudConfigDiagnostics => ({
  rawSupabaseUrl: rawSupabaseUrl || 'empty',
  rawSupabaseUrlState: rawSupabaseUrl ? 'present' : 'empty',
  isSupabaseUrlValid,
  rawSupabaseAnonKey: maskSecret(rawSupabaseAnonKey),
  rawSupabaseAnonKeyState: rawSupabaseAnonKey ? 'present' : 'empty',
  isSupabaseAnonKeyJwt,
  isSupabaseAnonKeyPublishable,
  acceptedSupabaseAnonKeyFormat: supabaseAnonKeyFormat,
  isCloudConfigured,
  buildTimeEnvSummary: !rawSupabaseUrl || !rawSupabaseAnonKey
    ? 'Frontend build is missing required VITE_ env values. Rebuild/redeploy after updating env.'
    : 'Frontend build received both VITE_ env values.'
});

let lastCloudCall: CloudCallStatus | null = null;

export const setLastCloudCall = (status: CloudCallStatus) => {
  lastCloudCall = status;
  window.dispatchEvent(new CustomEvent('cloud:last-call', { detail: status }));
};

export const getLastCloudCall = () => lastCloudCall;

export const cloudDiagnosticsText = () => JSON.stringify({
  host: SUPABASE_HOST || 'invalid',
  ...getCloudConfigDiagnostics(),
  cloudFeatureFlags,
  lastCloudCall
}, null, 2);
