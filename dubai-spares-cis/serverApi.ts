import { CLOUD_FEATURES } from './localMode';

type RequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  retryOnTimeout?: boolean;
};

type PublicQuoteResult = { token: string; link: string };

const API_BASE = (import.meta.env.VITE_SERVER_API_BASE_URL as string | undefined)?.trim() || '';
const API_KEY = (import.meta.env.VITE_SERVER_API_KEY as string | undefined)?.trim() || '';
const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_REQUEST_GAP_MS = 750;

const inFlight = new Map<string, Promise<any>>();
const lastStartedAt = new Map<string, number>();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withRateLimit = async (key: string) => {
  const last = lastStartedAt.get(key) || 0;
  const waitFor = MIN_REQUEST_GAP_MS - (Date.now() - last);
  if (waitFor > 0) await delay(waitFor);
  lastStartedAt.set(key, Date.now());
};

const requestJson = async <T>(key: string, path: string, payload: unknown, options?: RequestOptions): Promise<T> => {
  if (!API_BASE) throw new Error('Server API is not configured');

  if (inFlight.has(key)) {
    return inFlight.get(key) as Promise<T>;
  }

  const promise = (async () => {
    await withRateLimit(key);

    const timeoutMs = Math.min(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    const controller = new AbortController();
    const onAbort = () => controller.abort(options?.signal?.reason || 'Aborted by caller');
    if (options?.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    const timeoutId = window.setTimeout(() => controller.abort(`timeout:${timeoutMs}`), timeoutMs);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { 'x-api-key': API_KEY } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed: ${response.status}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === 'AbortError';
      if (isTimeout && options?.retryOnTimeout) {
        await delay(2_000);
        return requestJson<T>(`${key}:retry`, path, payload, { ...options, retryOnTimeout: false });
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      options?.signal?.removeEventListener('abort', onAbort);
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
};

export const backupUpload = async (payload: unknown, options?: RequestOptions) => {
  if (!CLOUD_FEATURES.BACKUP) throw new Error('Backup cloud feature is disabled');
  return requestJson<{ backupId: string; uploadedAt: string }>('backupUpload', '/backup/upload', payload, {
    ...options,
    retryOnTimeout: true
  });
};

export const publicQuoteCreate = async (orderId: string, payload: unknown, ttlHours = 72, options?: RequestOptions): Promise<PublicQuoteResult> => {
  if (!CLOUD_FEATURES.PUBLIC_QUOTE) throw new Error('Public quote feature is disabled');
  return requestJson<PublicQuoteResult>('publicQuoteCreate', '/public-quote/create', {
    orderId,
    payload,
    ttlHours
  }, options);
};

export const leadCreate = async (payload: unknown, options?: RequestOptions) => {
  if (!CLOUD_FEATURES.CLIENT_FORM) throw new Error('Client form feature is disabled');
  return requestJson<{ leadId: string }>('leadCreate', '/lead/create', payload, options);
};

export const isServerApiAvailable = () => Boolean(API_BASE);
