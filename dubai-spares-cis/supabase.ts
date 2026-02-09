import { createClient } from '@supabase/supabase-js';
import { logger } from './logging';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isCloudSyncConfigured = Boolean(supabaseUrl && supabaseAnonKey);

void logger.info('supabase:init', 'Loading Supabase environment variables', {
  hasUrl: Boolean(supabaseUrl),
  hasAnonKey: Boolean(supabaseAnonKey),
  urlPreview: supabaseUrl ? `${supabaseUrl.slice(0, 28)}...` : null
});

if (!isCloudSyncConfigured) {
  console.warn('☁️ Cloud sync disabled: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  console.error('Supabase env vars are undefined', {
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey)
  });

  void logger.error('supabase:init', 'Cloud sync disabled due to missing env vars', {
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey)
  });
}

const instrumentedFetch: typeof fetch = async (input, init) => {
  const start = Date.now();
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET') ?? 'GET';

  const headers = new Headers(init?.headers ?? (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined));
  const hasApiKey = Boolean(headers.get('apikey') || headers.get('x-api-key'));
  const hasAuthorization = Boolean(headers.get('authorization'));

  await logger.info('supabase:request', `Attempt ${method} ${rawUrl}`, {
    hasApiKey,
    hasAuthorization
  });

  try {
    const response = await fetch(input, init);
    await logger.info('supabase:response', `${response.status} ${method} ${rawUrl}`, {
      ok: response.ok,
      durationMs: Date.now() - start
    });

    if (!response.ok) {
      const cloned = response.clone();
      let body: unknown = null;
      try {
        body = await cloned.text();
      } catch {
        body = null;
      }

      await logger.error('supabase:response', `Non-2xx response ${response.status} for ${method} ${rawUrl}`, {
        body,
        hasApiKey,
        hasAuthorization
      });
    }

    return response;
  } catch (error) {
    await logger.error('supabase:request', `Request failed ${method} ${rawUrl}`, {
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      hasApiKey,
      hasAuthorization
    });
    throw error;
  }
};

export const supabase = isCloudSyncConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      global: {
        headers: {
          apikey: supabaseAnonKey!,
          Authorization: `Bearer ${supabaseAnonKey!}`
        },
        fetch: instrumentedFetch
      }
    })
  : null;

if (supabase) {
  void logger.info('supabase:init', 'Supabase client initialized', {
    hasGlobalApiKeyHeader: true,
    hasGlobalAuthorizationHeader: true
  });
}
