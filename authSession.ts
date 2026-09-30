import { SUPABASE_ANON_KEY } from './cloudConfig';

export const requiresStaffLogin = import.meta.env?.VITE_REQUIRE_AUTH === 'true';
let accessToken: string | null = null;
export const setSessionAccessToken = (token: string | null) => { accessToken = token; };
export const getSupabaseAuthHeaders = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
});
