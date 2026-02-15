import { createClient } from '@supabase/supabase-js';
import { logger } from './logging';
import { logDatabaseIntegrity } from './dbIntegrity';
import { logSyncCategory, syncPerf } from './syncPerf';

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

const SUPABASE_GET_TIMEOUT_MS = 45000;
const SUPABASE_WRITE_TIMEOUT_MS = 90000;
const SUPABASE_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
const RETRYABLE_HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetrySupabaseRequest = (error: unknown, method: string) => {
  if (!RETRYABLE_HTTP_METHODS.has(method)) return false;
  if (!(error instanceof Error)) return false;
  const message = `${error.name}:${error.message}`.toLowerCase();
  return message.includes('aborterror') || message.includes('timeout') || message.includes('failed to fetch') || message.includes('network');
};

const instrumentedFetch: typeof fetch = async (input, init) => {
  const start = Date.now();
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET') ?? 'GET';
  const upperMethod = method.toUpperCase();
  const requestTimeoutMs = upperMethod === 'GET' ? SUPABASE_GET_TIMEOUT_MS : SUPABASE_WRITE_TIMEOUT_MS;
  const shouldUseClientTimeout = upperMethod === 'GET';

  const headers = new Headers(init?.headers ?? (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined));
  const hasApiKey = Boolean(headers.get('apikey') || headers.get('x-api-key'));
  const hasAuthorization = Boolean(headers.get('authorization'));

  syncPerf.recordNetworkRequest();
  logSyncCategory('SUPABASE_REQ', 'request_started', { method: upperMethod, rawUrl });
  await logger.info('supabase:request', `Attempt ${method} ${rawUrl}`, {
    hasApiKey,
    hasAuthorization
  });

  for (let attempt = 0; attempt <= SUPABASE_RETRY_DELAYS_MS.length; attempt += 1) {
    const controller = new AbortController();
    const externalSignal = init?.signal;
    const abortFromExternalSignal = () => controller.abort(externalSignal?.reason ?? 'Upstream request aborted');
    if (externalSignal) {
      if (externalSignal.aborted) {
        abortFromExternalSignal();
      } else {
        externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true });
      }
    }

    const timeoutId = shouldUseClientTimeout
      ? window.setTimeout(() => controller.abort(`Timeout after ${requestTimeoutMs}ms`), requestTimeoutMs)
      : null;

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal
      });
      await logger.info('supabase:response', `${response.status} ${method} ${rawUrl}`, {
        ok: response.ok,
        durationMs: Date.now() - start,
        attempt
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
      const canRetry = shouldRetrySupabaseRequest(error, upperMethod) && attempt < SUPABASE_RETRY_DELAYS_MS.length;
      await logger.error('supabase:request', `Request failed ${method} ${rawUrl}`, {
        durationMs: Date.now() - start,
        error: isTimeoutError ? `Request timeout (${requestTimeoutMs}ms)` : error instanceof Error ? error.message : String(error),
        isTimeoutError,
        hasApiKey,
        hasAuthorization,
        attempt,
        canRetry
      });

      if (!canRetry) {
        throw error;
      }

      await sleep(SUPABASE_RETRY_DELAYS_MS[attempt]);
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromExternalSignal);
    }
  }

  throw new Error('Supabase request retry limit reached');
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
