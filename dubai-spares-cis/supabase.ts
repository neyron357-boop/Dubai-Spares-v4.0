import { createClient } from '@supabase/supabase-js';
import { logger } from './logging';
import { logDatabaseIntegrity } from './dbIntegrity';

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
  const upperMethod = method.toUpperCase();
  const requestTimeoutMs = upperMethod === 'GET' ? 15000 : 45000;

  const headers = new Headers(init?.headers ?? (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined));
  const hasApiKey = Boolean(headers.get('apikey') || headers.get('x-api-key'));
  const hasAuthorization = Boolean(headers.get('authorization'));

  await logger.info('supabase:request', `Attempt ${method} ${rawUrl}`, {
    hasApiKey,
    hasAuthorization
  });

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(`Timeout after ${requestTimeoutMs}ms`), requestTimeoutMs);
    const response = await fetch(input, {
      ...init,
      signal: init?.signal ?? controller.signal
    });
    window.clearTimeout(timeoutId);
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

      let parsedBody: unknown = body;
      if (typeof body === 'string' && body.trim().startsWith('{')) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          parsedBody = body;
        }
      }
      await logDatabaseIntegrity('supabase:response', parsedBody, { status: response.status, method, rawUrl });
    }

    return response;
  } catch (error) {
    const isTimeoutError = error instanceof DOMException && error.name === 'AbortError';
    await logger.error('supabase:request', `Request failed ${method} ${rawUrl}`, {
      durationMs: Date.now() - start,
      error: isTimeoutError ? `Request timeout (${requestTimeoutMs}ms)` : error instanceof Error ? error.message : String(error),
      isTimeoutError,
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
