import { cloudBuildGuardMessage, cloudFeatureFlags, isCloudConfigured, setLastCloudCall, SUPABASE_ANON_KEY, SUPABASE_URL } from './cloudConfig';
import { decodePayloadFromCompressedTransport, encodePayloadToCompressedTransport } from './cloudCodec';
import { preparePayloadWithImageManifest } from './cloudMedia';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

type RequestOptions = { signal?: AbortSignal; timeoutMs?: number; preferRepresentation?: boolean };

export type CloudLeadRow = {
  id: string;
  name: string;
  phone: string;
  message?: string;
  created_at: string;
  updated_at: string;
  payload_json?: unknown;
  order_id?: string | null;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const BACKUP_TIMEOUT_MS = 45_000;
const inFlight = new Set<string>();
const endpointRateLimit = new Map<string, number>();
const singleFlight = new Map<string, Promise<Result<unknown>>>();
const MIN_ENDPOINT_INTERVAL_MS = 1000;
const RETRYABLE_CODES = new Set(['aborted_or_timeout', 'network_error']);

const toErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const maskSupabaseUrl = (value: string) => {
  if (!value) return '❌ MISSING';
  try {
    return `✅ SET (${new URL(value).hostname})`;
  } catch {
    return '⚠️ INVALID URL';
  }
};

const maskAnonKey = (value: string) => {
  if (!value) return '❌ MISSING';
  return `✅ SET (${value.slice(0, 16)}...)`;
};

const bumpRequestCounter = (endpoint: string, method: string) => {
  const key = '__serverApiRequestCount';
  const win = window as Window & { [key: string]: number };
  win[key] = (win[key] || 0) + 1;
  window.dispatchEvent(new CustomEvent('server-api:request', {
    detail: { endpoint, method, count: win[key] }
  }));
};

const denyDuplicate = <T>(action: string): Result<T> => ({ ok: false, code: 'duplicate_in_flight', error: `${action} already in progress` });

export const assertCloudFeatureEnabled = (featureEnabled: boolean): Result<true> => {
  if (!featureEnabled) {
    console.error('[leadCreate] Guard blocked: cloud feature disabled by local settings');
    return { ok: false, code: 'feature_disabled', error: 'Cloud feature disabled by local mode settings' };
  }
  if (!isCloudConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[leadCreate] Guard blocked: cloud configuration invalid', {
      isCloudConfigured,
      SUPABASE_URL: maskSupabaseUrl(SUPABASE_URL),
      SUPABASE_ANON_KEY: maskAnonKey(SUPABASE_ANON_KEY)
    });
    return {
      ok: false,
      code: 'cloud_disabled',
      error: 'Cloud features are disabled. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
    };
  }
  return { ok: true, data: true };
};

const handleSupabaseError = (response: { status?: number; details?: unknown; text?: string; endpoint?: string; method?: string }): Result<never> => {
  const errorMap: Record<number, string> = {
    400: 'Неверный формат данных. Проверьте payload.',
    401: 'Ошибка аутентификации. Проверьте VITE_SUPABASE_ANON_KEY.',
    403: 'Доступ запрещен. Проверьте RLS политики в Supabase.',
    404: 'Таблица client_leads не найдена. Выполните миграцию.',
    409: 'Конфликт данных. Возможно дублирующийся idempotency_key.',
    500: 'Внутренняя ошибка сервера Supabase.',
    503: 'Supabase временно недоступен.'
  };

  const statusCode = response.status || 0;
  const defaultMessage = 'Неизвестная ошибка при сохранении лида';
  return {
    ok: false,
    code: `supabase_${statusCode}`,
    error: errorMap[statusCode] || response.text || defaultMessage
  };
};

const waitForRateLimit = async (endpoint: string) => {
  const now = Date.now();
  const nextAllowedAt = endpointRateLimit.get(endpoint) || 0;
  if (nextAllowedAt > now) {
    await new Promise((resolve) => window.setTimeout(resolve, nextAllowedAt - now));
  }
  endpointRateLimit.set(endpoint, Date.now() + MIN_ENDPOINT_INTERVAL_MS);
};

const withSingleFlight = async <T>(key: string, factory: () => Promise<Result<T>>): Promise<Result<T>> => {
  const existing = singleFlight.get(key) as Promise<Result<T>> | undefined;
  if (existing) return existing;
  const promise = factory().finally(() => singleFlight.delete(key));
  singleFlight.set(key, promise as Promise<Result<unknown>>);
  return promise;
};

const callRest = async <T>(endpoint: string, method: 'GET' | 'POST', payload: unknown, options: RequestOptions): Promise<Result<T>> => {
  await waitForRateLimit(endpoint);
  const maxAttempts = 2;
  let lastResult: Result<T> = { ok: false, code: 'unknown_error', error: 'Unknown cloud error' };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort('timeout'), options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const abortByCaller = () => controller.abort(options.signal?.reason || 'caller-abort');
    if (options.signal) {
      if (options.signal.aborted) abortByCaller();
      else options.signal.addEventListener('abort', abortByCaller, { once: true });
    }

    const requestUrl = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.preferRepresentation === false ? 'return=minimal' : 'return=representation'
    };

    try {
      bumpRequestCounter(endpoint, method);
      console.log('[leadCreate] [callRest] Request', {
        endpoint,
        method,
        attempt,
        url: requestUrl,
        headers: {
          apikey: headers.apikey ? '✅ SET' : '❌ MISSING',
          Authorization: headers.Authorization ? '✅ SET' : '❌ MISSING',
          'Content-Type': headers['Content-Type']
        }
      });
      const response = await fetch(requestUrl, {
        method,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal
      });

      const text = await response.text();
      console.log('[leadCreate] [callRest] Response', {
        endpoint,
        method,
        attempt,
        status: response.status,
        ok: response.ok
      });

      if (!response.ok) {
        lastResult = handleSupabaseError({ status: response.status, text: text.slice(0, 220), endpoint, method }) as Result<T>;
        console.error('[leadCreate] [callRest] HTTP error', { endpoint, method, attempt, status: response.status, body: text.slice(0, 400) });
        return lastResult;
      }

      return { ok: true, data: (text ? JSON.parse(text) : null) as T };
    } catch (error) {
      const code = error instanceof DOMException && error.name === 'AbortError' ? 'aborted_or_timeout' : 'network_error';
      lastResult = { ok: false, code, error: toErrorMessage(error, 'Network error') };
      console.error('[leadCreate] [callRest] Request failed', { endpoint, method, attempt, code, error: lastResult.error });
      if (!RETRYABLE_CODES.has(code) || attempt === maxAttempts) return lastResult;
      await new Promise((resolve) => window.setTimeout(resolve, 400 * attempt));
    } finally {
      window.clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', abortByCaller);
    }
  }

  return lastResult;
};

const recordCall = <T>(action: string, result: Result<T>) => {
  setLastCloudCall({
    at: new Date().toISOString(),
    action,
    ok: result.ok,
    code: result.ok ? 'ok' : result.code,
    message: result.ok ? undefined : result.error
  });
  return result;
};

export const backupUpload = async (
  payload: unknown,
  options?: RequestOptions & { mode?: 'upload' | 'restore'; backupId?: string }
): Promise<Result<{ backupId: string; uploadedAt?: string; payload?: unknown }>> => {
  const guard = assertCloudFeatureEnabled(cloudFeatureFlags.backup);
  if (!guard.ok) return recordCall('backupUpload', guard);

  const mode = options?.mode || 'upload';
  const lockKey = `backup:${mode}`;
  if (inFlight.has(lockKey)) return recordCall('backupUpload', denyDuplicate('Backup'));
  inFlight.add(lockKey);

  try {
    if (mode === 'restore') {
      const backupId = options?.backupId?.trim();
      if (!backupId) return recordCall('backupRestore', { ok: false, code: 'invalid_backup_id', error: 'Backup ID is required' });
      const result = await callRest<Array<{ id: string; payload: unknown; payload_b64?: string | null; payload_codec?: string | null }>>(
        `backups?id=eq.${encodeURIComponent(backupId)}&select=id,payload,payload_b64,payload_codec&limit=1`,
        'GET',
        undefined,
        { ...options, timeoutMs: options?.timeoutMs || BACKUP_TIMEOUT_MS }
      );
      if (!result.ok) return recordCall('backupRestore', result);
      const row = result.data?.[0];
      if (!row) return recordCall('backupRestore', { ok: false, code: 'not_found', error: 'Backup not found' });
      const decoded = row.payload_b64 ? await decodePayloadFromCompressedTransport(row.payload_b64, row.payload_codec || 'gzip+b64') : row.payload;
      return recordCall('backupRestore', { ok: true, data: { backupId: row.id, payload: decoded } });
    }

    const prepared = await preparePayloadWithImageManifest(payload, 'backup', `b-${Date.now()}`, { signal: options?.signal });
    const encoded = await encodePayloadToCompressedTransport(prepared.payload);

    const uploadAttempt = async () => callRest<Array<{ id: string; created_at?: string }>>(
      'backups',
      'POST',
      [{ payload: encoded.payloadJson ?? prepared.payload, payload_b64: encoded.payloadB64, payload_codec: encoded.payloadCodec, image_manifest: prepared.imageManifest }],
      { ...options, timeoutMs: options?.timeoutMs || BACKUP_TIMEOUT_MS }
    );

    let response = await uploadAttempt();
    if (!response.ok && response.code === 'aborted_or_timeout') {
      response = await uploadAttempt();
    }

    if (!response.ok) return recordCall('backupUpload', response);
    const row = response.data?.[0];
    if (!row?.id) return recordCall('backupUpload', { ok: false, code: 'empty_response', error: 'Backup created but no ID returned' });
    return recordCall('backupUpload', { ok: true, data: { backupId: row.id, uploadedAt: row.created_at } });
  } catch (error) {
    return recordCall('backupUpload', { ok: false, code: 'unexpected_error', error: error instanceof Error ? error.message : 'Backup failed' });
  } finally {
    inFlight.delete(lockKey);
  }
};

export const createPublicQuoteSnapshot = async (
  input: { token: string; payload: unknown; expiresAt: string | number | Date },
  options?: RequestOptions
): Promise<Result<{ id: string; token: string; expires_at: string }>> => {
  const guard = assertCloudFeatureEnabled(cloudFeatureFlags.publicQuote);
  if (!guard.ok) return recordCall('createPublicQuoteSnapshot', guard);
  const lockKey = 'createPublicQuoteSnapshot';
  if (inFlight.has(lockKey)) return recordCall('createPublicQuoteSnapshot', denyDuplicate('Quote share'));
  inFlight.add(lockKey);

  try {
    const prepared = await preparePayloadWithImageManifest(input.payload, 'quote', `q-${Date.now()}`, { signal: options?.signal });
    const encoded = await encodePayloadToCompressedTransport(prepared.payload);
    const requestPayload = [{
      token: input.token,
      expires_at: new Date(input.expiresAt).toISOString(),
      payload: encoded.payloadJson ?? prepared.payload,
      payload_b64: encoded.payloadB64,
      payload_codec: encoded.payloadCodec,
      image_manifest: prepared.imageManifest
    }];
    const response = await withSingleFlight(`quote:create:${JSON.stringify(requestPayload)}`,
      () => callRest<Array<{ id: string; token: string; expires_at: string }>>('public_quote_snapshots?select=id,token,expires_at', 'POST', requestPayload, {
        ...(options || {}),
        timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS
      }));
    if (!response.ok) return recordCall('createPublicQuoteSnapshot', response);
    const row = response.data?.[0];
    if (!row?.id || !row?.token || !row?.expires_at) {
      return recordCall('createPublicQuoteSnapshot', { ok: false, code: 'empty_response', error: 'Quote created but id/token/expires_at was not returned' });
    }
    return recordCall('createPublicQuoteSnapshot', { ok: true, data: row });
  } catch (error) {
    return recordCall('createPublicQuoteSnapshot', { ok: false, code: 'unexpected_error', error: error instanceof Error ? error.message : 'Share quote failed' });
  } finally {
    inFlight.delete(lockKey);
  }
};

export const getPublicQuoteSnapshot = async (
  token: string,
  options?: RequestOptions
): Promise<Result<{ token: string; expires_at: string; payload: unknown; payload_b64?: string | null; payload_codec?: string | null; payload_json?: unknown }>> => {
  const guard = assertCloudFeatureEnabled(cloudFeatureFlags.publicQuote);
  if (!guard.ok) return recordCall('getPublicQuoteSnapshot', guard);
  const normalizedToken = token.trim();
  if (!normalizedToken) return recordCall('getPublicQuoteSnapshot', { ok: false, code: 'invalid_token', error: 'Snapshot token is required' });

  const endpoint = `public_quote_snapshots?token=eq.${encodeURIComponent(normalizedToken)}&select=token,expires_at,payload,payload_b64,payload_codec,payload_json,image_manifest&limit=1`;
  let response = await withSingleFlight(`quote:get:${normalizedToken}:1`,
    () => callRest<Array<{ token: string; expires_at: string; payload: unknown; payload_b64?: string | null; payload_codec?: string | null; payload_json?: unknown }>>(endpoint, 'GET', undefined, {
      ...(options || {}),
      timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS
    }));

  if (!response.ok && (response.code === 'aborted_or_timeout' || response.code === 'network_error')) {
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    response = await withSingleFlight(`quote:get:${normalizedToken}:2`,
      () => callRest<Array<{ token: string; expires_at: string; payload: unknown; payload_b64?: string | null; payload_codec?: string | null; payload_json?: unknown }>>(endpoint, 'GET', undefined, {
        ...(options || {}),
        timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS
      }));
  }

  if (!response.ok) return recordCall('getPublicQuoteSnapshot', response);
  const row = response.data?.[0];
  if (!row) return recordCall('getPublicQuoteSnapshot', { ok: false, code: 'not_found', error: 'Quote snapshot not found' });
  return recordCall('getPublicQuoteSnapshot', { ok: true, data: row });
};

export const publicQuoteCreate = createPublicQuoteSnapshot;
export const publicQuoteGetByToken = getPublicQuoteSnapshot;

export const leadCreate = async (
  payload: { name: string; phone: string; message?: string; orderId?: string | null; [key: string]: unknown },
  options?: RequestOptions
): Promise<Result<{ leadId: string }>> => {
  console.log('[leadCreate] START - Feature flag:', cloudFeatureFlags.clientForm);
  console.log('[leadCreate] Config - URL:', maskSupabaseUrl(SUPABASE_URL));
  console.log('[leadCreate] Config - ANON_KEY:', maskAnonKey(SUPABASE_ANON_KEY));
  const guard = assertCloudFeatureEnabled(cloudFeatureFlags.clientForm);
  if (!guard.ok) {
    console.error('[leadCreate] Guard failed:', guard);
    return recordCall('leadCreate', guard);
  }
  const lockKey = 'leadCreate';
  if (inFlight.has(lockKey)) return recordCall('leadCreate', denyDuplicate('Lead submit'));
  inFlight.add(lockKey);
  try {
    const prepared = await preparePayloadWithImageManifest(payload, 'lead', `l-${Date.now()}`, { signal: options?.signal });
    const encoded = await encodePayloadToCompressedTransport(prepared.payload);
    const idempotencyKey = typeof payload.idempotency_key === 'string' && payload.idempotency_key.trim()
      ? payload.idempotency_key.trim()
      : (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `lead-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

    const requestPayload = [{
      payload: encoded.payloadJson ?? prepared.payload,
      payload_b64: encoded.payloadB64,
      payload_codec: encoded.payloadCodec,
      name: payload.name,
      phone: payload.phone,
      message: payload.message || '',
      order_id: payload.orderId || null,
      idempotency_key: idempotencyKey,
      image_manifest: prepared.imageManifest
    }];

    console.log('[leadCreate] Payload:', { name: payload.name, phone: payload.phone, orderId: payload.orderId || null, idempotencyKey });

    const response = await withSingleFlight(`lead:create:${idempotencyKey}`,
      () => callRest<Array<{ id: string }>>('client_leads', 'POST', requestPayload, {
        ...(options || {}),
        timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS,
        preferRepresentation: false
      }));
    console.log('[leadCreate] Response status:', response.ok ? '✅ SUCCESS' : '❌ FAILED', response);
    if (!response.ok) {
      console.error('[leadCreate] Error details:', { code: response.code, error: response.error });
      return recordCall('leadCreate', response.code.startsWith('supabase_') ? response : handleSupabaseError({ status: Number(response.code.replace(/\D+/g, '')) || 0, details: response }));
    }
    return recordCall('leadCreate', { ok: true, data: { leadId: response.data?.[0]?.id || idempotencyKey } });
  } catch (error) {
    console.error('[leadCreate] Exception:', {
      error,
      payload: { name: payload.name, phone: payload.phone, orderId: payload.orderId || null }
    });
    return recordCall('leadCreate', { ok: false, code: 'unexpected_error', error: toErrorMessage(error, 'Lead submit failed') });
  } finally {
    inFlight.delete(lockKey);
  }
};

export const leadsSync = async (
  options?: RequestOptions
): Promise<Result<CloudLeadRow[]>> => {
  const guard = assertCloudFeatureEnabled(cloudFeatureFlags.clientForm);
  if (!guard.ok) return recordCall('leadsSync', guard);

  try {
    const endpoint = 'client_leads?order=created_at.desc&limit=50&select=id,name,phone,message,created_at,updated_at,payload_json,order_id';
    const response = await withSingleFlight('leads:sync:1',
      () => callRest<CloudLeadRow[]>(endpoint, 'GET', undefined, {
        ...(options || {}),
        timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS
      })
    );

    if (!response.ok) return recordCall('leadsSync', response);
    return recordCall('leadsSync', { ok: true, data: response.data || [] });
  } catch (error) {
    return recordCall('leadsSync', {
      ok: false,
      code: 'unexpected_error',
      error: error instanceof Error ? error.message : 'Lead sync failed'
    });
  }
};
