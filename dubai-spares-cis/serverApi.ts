import { cloudBuildGuardMessage, cloudFeatureFlags, isCloudConfigured, setLastCloudCall, SUPABASE_ANON_KEY, SUPABASE_URL } from './cloudConfig';
import { decodePayloadFromCompressedTransport, encodePayloadToCompressedTransport } from './cloudCodec';
import { preparePayloadWithImageManifest } from './cloudMedia';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

type RequestOptions = { signal?: AbortSignal; timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 20_000;
const BACKUP_TIMEOUT_MS = 45_000;
const inFlight = new Set<string>();
const endpointRateLimit = new Map<string, number>();
const singleFlight = new Map<string, Promise<Result<unknown>>>();
const MIN_ENDPOINT_INTERVAL_MS = 1000;

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
  if (!featureEnabled) return { ok: false, code: 'feature_disabled', error: 'Cloud feature disabled by local mode settings' };
  if (!isCloudConfigured) return { ok: false, code: 'cloud_not_configured', error: cloudBuildGuardMessage };
  return { ok: true, data: true };
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
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort('timeout'), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const abortByCaller = () => controller.abort(options.signal?.reason || 'caller-abort');
  if (options.signal) {
    if (options.signal.aborted) abortByCaller();
    else options.signal.addEventListener('abort', abortByCaller, { once: true });
  }

  try {
    bumpRequestCounter(endpoint, method);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
      method,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, code: `http_${response.status}`, error: text.slice(0, 220) || 'Cloud request failed' };
    }

    const text = await response.text();
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'AbortError' ? 'aborted_or_timeout' : 'network_error';
    return { ok: false, code, error: error instanceof Error ? error.message : 'Network error' };
  } finally {
    window.clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortByCaller);
  }
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
  const guard = assertCloudFeatureEnabled(cloudFeatureFlags.clientForm);
  if (!guard.ok) return recordCall('leadCreate', guard);
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

    const response = await withSingleFlight(`lead:create:${idempotencyKey}`,
      () => callRest<Array<{ id: string }>>('client_leads', 'POST', requestPayload, {
        ...(options || {}),
        timeoutMs: options?.timeoutMs || DEFAULT_TIMEOUT_MS
      }));
    if (!response.ok) return recordCall('leadCreate', response);
    return recordCall('leadCreate', { ok: true, data: { leadId: response.data?.[0]?.id || '' } });
  } catch (error) {
    return recordCall('leadCreate', { ok: false, code: 'unexpected_error', error: error instanceof Error ? error.message : 'Lead submit failed' });
  } finally {
    inFlight.delete(lockKey);
  }
};
