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
  updated_at?: string;
  payload_json?: unknown;
  order_id?: string | null;
  payload_b64?: string;
  payload_codec?: string;
  payload?: unknown;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const BACKUP_TIMEOUT_MS = 45_000;
const inFlight = new Set<string>();
const endpointRateLimit = new Map<string, number>();
const singleFlight = new Map<string, Promise<Result<unknown>>>();
const MIN_ENDPOINT_INTERVAL_MS = 1000;
const RETRYABLE_CODES = new Set(['aborted_or_timeout', 'network_error']);
const SCHEMA_MISMATCH_CODES = new Set(['PGRST205', 'PGRST204', 'SCHEMA_MISMATCH']);


const LEADS_SYNC_VARIANT_STORAGE_KEY = 'server_api_leads_sync_variant_v3';
const LEADS_SYNC_VARIANTS = [
  // With updated_at (preferred, for DBs that have the column)
  'client_leads?order=created_at.desc&limit=50&select=id,name,phone,message,created_at,updated_at,payload_json,order_id,payload_b64,payload_codec,payload',
  'client_leads?order=created_at.desc&limit=50&select=id,name,phone,message,created_at,updated_at,payload_json,order_id,payload',
  'client_leads?order=created_at.desc&limit=50&select=id,name,phone,message,created_at,updated_at,order_id,payload',
  'client_leads?order=created_at.desc&limit=50&select=id,name,phone,message,created_at,updated_at',
  'client_leads?limit=50&select=id,name,phone,message,created_at,updated_at,payload_json,order_id,payload_b64,payload_codec,payload',
  'client_leads?limit=50&select=id,name,phone,message,created_at,updated_at,payload_json,order_id,payload',
  'client_leads?limit=50&select=id,name,phone,message,created_at,updated_at,order_id,payload',
  'client_leads?limit=50&select=id,name,phone,message,created_at,updated_at',
  // Without updated_at (fallback, for DBs that don't have the column)
  'client_leads?order=created_at.desc&limit=50&select=id,name,phone,message,created_at,payload_json,order_id,payload_b64,payload_codec,payload',
  'client_leads?order=created_at.desc&limit=50&select=id,name,phone,message,created_at,payload_json,order_id,payload',
  'client_leads?order=created_at.desc&limit=50&select=id,name,phone,message,created_at,order_id,payload',
  'client_leads?order=created_at.desc&limit=50&select=id,name,phone,message,created_at',
  'client_leads?limit=50&select=id,name,phone,message,created_at,payload_json,order_id,payload_b64,payload_codec,payload',
  'client_leads?limit=50&select=id,name,phone,message,created_at,payload_json,order_id,payload',
  'client_leads?limit=50&select=id,name,phone,message,created_at,order_id,payload',
  'client_leads?limit=50&select=id,name,phone,message,created_at'
] as const;

const loadLeadsSyncVariant = (): number => {
  try {
    const raw = window.localStorage.getItem(LEADS_SYNC_VARIANT_STORAGE_KEY);
    const parsed = raw ? Number(raw) : 0;
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < LEADS_SYNC_VARIANTS.length) {
      return parsed;
    }
  } catch (error) {
    console.warn('[leadsSync] Failed to load stored endpoint variant:', error);
  }
  return 0;
};

const saveLeadsSyncVariant = (variantIndex: number) => {
  try {
    window.localStorage.setItem(LEADS_SYNC_VARIANT_STORAGE_KEY, String(variantIndex));
  } catch (error) {
    console.warn('[leadsSync] Failed to persist endpoint variant:', error);
  }
};


const toErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isSchemaMismatchErrorText = (message: string) => {
  const probe = message.toLowerCase();
  return probe.includes('schema cache') || probe.includes('schema_mismatch') || probe.includes('pgrst205') || probe.includes('public.orders') || probe.includes('public.shops');
};

const isSchemaMismatchStatus = (status?: number) => status === 404 || status === 406;

const isSchemaMismatchResponse = (status?: number, text?: string) => {
  if (isSchemaMismatchStatus(status) && text && isSchemaMismatchErrorText(text)) return true;
  if (!text) return false;
  try {
    const parsed = JSON.parse(text);
    const code = String(parsed?.code || '').toUpperCase();
    const message = String(parsed?.message || '');
    return SCHEMA_MISMATCH_CODES.has(code) || isSchemaMismatchErrorText(message);
  } catch {
    return isSchemaMismatchErrorText(text);
  }
};

const normalizeForSupabaseJson = (input: unknown): unknown => {
  if (input === undefined) return null;
  if (input === null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'bigint') return input.toString();
  if (typeof input === 'string' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.map((value) => normalizeForSupabaseJson(value));
  if (typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, value]) => {
      if (value === undefined) return acc;
      acc[key] = normalizeForSupabaseJson(value);
      return acc;
    }, {});
  }
  return null;
};

let schemaRefreshInFlight: Promise<void> | null = null;
const refreshSchemaCache = async () => {
  if (schemaRefreshInFlight) return schemaRefreshInFlight;

  schemaRefreshInFlight = (async () => {
    const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/refresh_schema_cache`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: '{}' 
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn('[schema] refresh_schema_cache rpc failed', { status: response.status, body: text.slice(0, 200) });
      } else {
        console.warn('[schema] refresh_schema_cache rpc executed before retry');
      }
    } catch (error) {
      console.warn('[schema] refresh_schema_cache rpc error', error);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  })().finally(() => {
    schemaRefreshInFlight = null;
  });

  return schemaRefreshInFlight;
};

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
  const win = window as Window & Record<string, unknown>;
  const current = typeof win[key] === 'number' ? win[key] as number : 0;
  win[key] = current + 1;
  window.dispatchEvent(new CustomEvent('server-api:request', {
    detail: { endpoint, method, count: win[key] as number }
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

const callRest = async <T>(endpoint: string, method: 'GET' | 'POST' | 'DELETE', payload: unknown, options: RequestOptions): Promise<Result<T>> => {
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
      const response = await fetch(requestUrl, {
        method,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal
      });

      const text = await response.text();

      if (!response.ok) {
        if (isSchemaMismatchResponse(response.status, text)) {
          await refreshSchemaCache();
          const retryResponse = await fetch(requestUrl, {
            method,
            headers,
            body: payload === undefined ? undefined : JSON.stringify(payload),
            signal: controller.signal
          });
          const retryText = await retryResponse.text();
          if (retryResponse.ok) {
            return { ok: true, data: (retryText ? JSON.parse(retryText) : null) as T };
          }
          lastResult = handleSupabaseError({ status: retryResponse.status, text: retryText.slice(0, 220), endpoint, method }) as Result<T>;
          console.error('[callRest] HTTP error after schema refresh retry', { endpoint, method, attempt, status: retryResponse.status, body: retryText.slice(0, 400) });
          return lastResult;
        }
        lastResult = handleSupabaseError({ status: response.status, text: text.slice(0, 220), endpoint, method }) as Result<T>;
        console.error('[callRest] HTTP error', { endpoint, method, attempt, status: response.status, body: text.slice(0, 400) });
        return lastResult;
      }

      return { ok: true, data: (text ? JSON.parse(text) : null) as T };
    } catch (error) {
      const code = error instanceof DOMException && error.name === 'AbortError' ? 'aborted_or_timeout' : 'network_error';
      lastResult = { ok: false, code, error: toErrorMessage(error, 'Network error') };
      console.error('[callRest] Request failed', { endpoint, method, attempt, code, error: lastResult.error });
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

    const normalizedPayload = normalizeForSupabaseJson(payload);
    console.log('[backupUpload] payload diagnostics', {
      type: typeof normalizedPayload,
      hasOrders: Array.isArray(asObject(normalizedPayload).orders),
      orderCount: Array.isArray(asObject(normalizedPayload).orders) ? (asObject(normalizedPayload).orders as unknown[]).length : 0
    });
    const prepared = await preparePayloadWithImageManifest(normalizedPayload, 'backup', `b-${Date.now()}`, { signal: options?.signal });
    const encoded = await encodePayloadToCompressedTransport(prepared.payload);

    const buildBackupPayload = (includeImageManifest: boolean) => [{
      payload: encoded.payloadJson ?? prepared.payload,
      payload_b64: encoded.payloadB64,
      payload_codec: encoded.payloadCodec,
      ...(includeImageManifest ? { image_manifest: prepared.imageManifest } : {})
    }];

    const uploadAttempt = async (includeImageManifest: boolean) => callRest<Array<{ id: string; created_at?: string }>>(
      'backups',
      'POST',
      buildBackupPayload(includeImageManifest),
      { ...options, timeoutMs: options?.timeoutMs || BACKUP_TIMEOUT_MS }
    );

    let response = await uploadAttempt(true);
    if (!response.ok && response.code === 'aborted_or_timeout') {
      response = await uploadAttempt(true);
    }

    if (!response.ok && response.code === 'supabase_400') {
      console.warn('[backupUpload] Falling back to legacy payload without image_manifest column', {
        recommendation: 'Apply latest Supabase migrations to restore backup image metadata support.'
      });
      response = await uploadAttempt(false);
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




export const clearServerBackups = async (options?: RequestOptions): Promise<Result<{ cleared: boolean }>> => {
  const guard = assertCloudFeatureEnabled(cloudFeatureFlags.backup);
  if (!guard.ok) return recordCall('clearServerBackups', guard);

  const lockKey = 'clearServerBackups';
  if (inFlight.has(lockKey)) return recordCall('clearServerBackups', denyDuplicate('Backups cleanup'));
  inFlight.add(lockKey);

  try {
    const endpoint = 'backups?id=not.is.null';
    const response = await callRest<null>(endpoint, 'DELETE', undefined, {
      ...(options || {}),
      preferRepresentation: false,
      timeoutMs: options?.timeoutMs || BACKUP_TIMEOUT_MS
    });

    if (!response.ok) return recordCall('clearServerBackups', response);
    return recordCall('clearServerBackups', { ok: true, data: { cleared: true } });
  } catch (error) {
    return recordCall('clearServerBackups', { ok: false, code: 'unexpected_error', error: toErrorMessage(error, 'Failed to clear backups') });
  } finally {
    inFlight.delete(lockKey);
  }
};

export const clearPublicQuoteSnapshots = async (options?: RequestOptions): Promise<Result<{ cleared: boolean }>> => {
  const guard = assertCloudFeatureEnabled(cloudFeatureFlags.publicQuote);
  if (!guard.ok) return recordCall('clearPublicQuoteSnapshots', guard);

  const lockKey = 'clearPublicQuoteSnapshots';
  if (inFlight.has(lockKey)) return recordCall('clearPublicQuoteSnapshots', denyDuplicate('Public snapshots cleanup'));
  inFlight.add(lockKey);

  try {
    // Try REST DELETE with a broad filter (all rows where id is not null)
    const endpoint = 'public_quote_snapshots?id=not.is.null';
    const response = await callRest<null>(endpoint, 'DELETE', undefined, {
      ...(options || {}),
      preferRepresentation: false,
      timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS
    });

    if (!response.ok) return recordCall('clearPublicQuoteSnapshots', response);
    return recordCall('clearPublicQuoteSnapshots', { ok: true, data: { cleared: true } });
  } catch (error) {
    return recordCall('clearPublicQuoteSnapshots', { ok: false, code: 'unexpected_error', error: toErrorMessage(error, 'Failed to clear quote snapshots') });
  } finally {
    inFlight.delete(lockKey);
  }
};

export const publicQuoteCreate = createPublicQuoteSnapshot;
export const publicQuoteGetByToken = getPublicQuoteSnapshot;

export const leadCreate = async (
  payload: { name: string; phone: string; message?: string; orderId?: string | null; [key: string]: unknown },
  options?: RequestOptions
): Promise<Result<{ leadId: string }>> => {
  const guard = assertCloudFeatureEnabled(cloudFeatureFlags.clientForm);
  if (!guard.ok) {
    return recordCall('leadCreate', guard);
  }
  const lockKey = 'leadCreate';
  if (inFlight.has(lockKey)) return recordCall('leadCreate', denyDuplicate('Lead submit'));
  inFlight.add(lockKey);
  try {
    const normalizedPayload = normalizeForSupabaseJson(payload) as Record<string, unknown>;
    if (!String(normalizedPayload.name || '').trim() || !String(normalizedPayload.phone || '').trim()) {
      return recordCall('leadCreate', { ok: false, code: 'validation_error', error: 'Поля имя и телефон обязательны для отправки заявки.' });
    }

    const prepared = await preparePayloadWithImageManifest(normalizedPayload, 'lead', `l-${Date.now()}`, { signal: options?.signal });
    const encoded = await encodePayloadToCompressedTransport(prepared.payload);
    const idempotencyKey = typeof payload.idempotency_key === 'string' && payload.idempotency_key.trim()
      ? payload.idempotency_key.trim()
      : (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `lead-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

    const requestPayload = [{
      payload: encoded.payloadJson ?? prepared.payload,
      payload_b64: encoded.payloadB64,
      payload_codec: encoded.payloadCodec,
      name: String(normalizedPayload.name || ''),
      phone: String(normalizedPayload.phone || ''),
      message: String(normalizedPayload.message || ''),
      order_id: normalizedPayload.orderId ? String(normalizedPayload.orderId) : null,
      idempotency_key: idempotencyKey,
      image_manifest: prepared.imageManifest
    }];

    let response = await withSingleFlight(`lead:create:${idempotencyKey}`,
      () => callRest<Array<{ id: string }>>('client_leads', 'POST', requestPayload, {
        ...(options || {}),
        timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS,
        preferRepresentation: false
      }));

    if (!response.ok && response.code === 'supabase_400') {
      const { image_manifest: _unusedManifest, ...rowWithoutManifest } = requestPayload[0];
      const fallbackPayload = [rowWithoutManifest];
      response = await withSingleFlight(`lead:create:${idempotencyKey}:fb`,
        () => callRest<Array<{ id: string }>>('client_leads', 'POST', fallbackPayload, {
          ...(options || {}),
          timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS,
          preferRepresentation: false
        }));
    }

    if (!response.ok) {
      return recordCall('leadCreate', response.code.startsWith('supabase_') ? response : handleSupabaseError({ status: Number(response.code.replace(/\D+/g, '')) || 0, details: response }));
    }
    return recordCall('leadCreate', { ok: true, data: { leadId: response.data?.[0]?.id || idempotencyKey } });
  } catch (error) {
    console.error('[leadCreate] Exception:', error);
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
    const preferredVariant = loadLeadsSyncVariant();
    const attempts = [
      ...LEADS_SYNC_VARIANTS.slice(preferredVariant),
      ...LEADS_SYNC_VARIANTS.slice(0, preferredVariant)
    ];

    let response: Result<CloudLeadRow[]> = { ok: false, code: 'unknown_error', error: 'Lead sync failed' };

    for (let index = 0; index < attempts.length; index += 1) {
      const endpoint = attempts[index];
      const variantIndex = LEADS_SYNC_VARIANTS.indexOf(endpoint);
      response = await withSingleFlight(`leads:sync:${variantIndex + 1}`,
        () => callRest<CloudLeadRow[]>(endpoint, 'GET', undefined, {
          ...(options || {}),
          timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS
        })
      );

      if (response.ok) {
        saveLeadsSyncVariant(variantIndex);
        break;
      }

      const isSchemaIssue = response.code === 'supabase_400' || response.code === 'supabase_404';
      if (!isSchemaIssue || index === attempts.length - 1) break;
    }

    if (!response.ok) return recordCall('leadsSync', response);
    return recordCall('leadsSync', { ok: true, data: response.data || [] });
  } catch (error) {
    console.error('[leadsSync] Exception:', error);
    return recordCall('leadsSync', {
      ok: false,
      code: 'unexpected_error',
      error: error instanceof Error ? error.message : 'Lead sync failed'
    });
  }
};

export const purgePublicLeadArtifacts = async (
  orderId: string,
  options?: RequestOptions
): Promise<Result<{ removedLeadRows: number; removedSnapshots: number }>> => {
  const guard = assertCloudFeatureEnabled(cloudFeatureFlags.clientForm);
  if (!guard.ok) return recordCall('purgePublicLeadArtifacts', guard);

  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) {
    return recordCall('purgePublicLeadArtifacts', { ok: false, code: 'validation_error', error: 'orderId is required' });
  }

  const lockKey = `lead:purge:${normalizedOrderId}`;
  if (inFlight.has(lockKey)) return recordCall('purgePublicLeadArtifacts', denyDuplicate('Lead purge'));
  inFlight.add(lockKey);

  try {
    let removedLeadRows = 0;
    let removedSnapshots = 0;

    const removeLeadByOrderId = await callRest<unknown[]>('client_leads?select=id&order_id=eq.' + encodeURIComponent(normalizedOrderId), 'DELETE', undefined, {
      ...(options || {}),
      timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS,
      preferRepresentation: true
    });
    if (!removeLeadByOrderId.ok) return recordCall('purgePublicLeadArtifacts', removeLeadByOrderId);
    removedLeadRows += Array.isArray(removeLeadByOrderId.data) ? removeLeadByOrderId.data.length : 0;

    if (isUuid(normalizedOrderId)) {
      const removeLeadById = await callRest<unknown[]>('client_leads?select=id&id=eq.' + encodeURIComponent(normalizedOrderId), 'DELETE', undefined, {
        ...(options || {}),
        timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS,
        preferRepresentation: true
      });
      if (!removeLeadById.ok) return recordCall('purgePublicLeadArtifacts', removeLeadById);
      removedLeadRows += Array.isArray(removeLeadById.data) ? removeLeadById.data.length : 0;
    }

    const removeSnapshotsByOrderId = await callRest<unknown[]>('public_quote_snapshots?select=token&order_id=eq.' + encodeURIComponent(normalizedOrderId), 'DELETE', undefined, {
      ...(options || {}),
      timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS,
      preferRepresentation: true
    });
    if (!removeSnapshotsByOrderId.ok) return recordCall('purgePublicLeadArtifacts', removeSnapshotsByOrderId);
    removedSnapshots += Array.isArray(removeSnapshotsByOrderId.data) ? removeSnapshotsByOrderId.data.length : 0;

    return recordCall('purgePublicLeadArtifacts', { ok: true, data: { removedLeadRows, removedSnapshots } });
  } catch (error) {
    return recordCall('purgePublicLeadArtifacts', {
      ok: false,
      code: 'unexpected_error',
      error: toErrorMessage(error, 'Failed to purge public lead artifacts')
    });
  } finally {
    inFlight.delete(lockKey);
  }
};
