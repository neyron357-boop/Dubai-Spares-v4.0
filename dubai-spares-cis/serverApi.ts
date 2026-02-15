import { CLOUD_FEATURES, LOCAL_ONLY } from './localMode';
import { decodePayloadFromCompressedTransport, encodePayloadToCompressedTransport, getJsonBytes } from './cloudCodec';
import { preparePayloadWithImageManifest } from './cloudMedia';

const SUPABASE_URL = ((import.meta as any).env?.VITE_SUPABASE_URL as string | undefined)?.trim() || 'https://jntgicfiehdprwhtjbuf.supabase.co';
const SUPABASE_ANON_KEY = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || 'sb_publishable_ZwcvMV3ccFi0xVapLOorsw_6wLL_9SC';

const DEFAULT_TIMEOUT_MS = 20_000;
const BACKUP_TIMEOUT_MS = 30_000;
const RATE_LIMIT_MS = 700;
const MAX_LOG_META = 120;

const inFlight = new Map<string, Promise<any>>();
let chain: Promise<void> = Promise.resolve();
let nextAllowedAt = 0;

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const short = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= MAX_LOG_META ? text : `${text.slice(0, MAX_LOG_META)}…`;
};

const getPayloadBytes = (payload: unknown) => getJsonBytes(payload);

const hashPayload = (payload: unknown) => {
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
};


const prepareTransportRecord = async (
  action: 'backup' | 'quote' | 'lead',
  payload: unknown,
  options?: { signal?: AbortSignal; allowUploadLater?: boolean }
) => {
  const rootId = action === 'quote'
    ? `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : action === 'lead'
      ? `l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      : `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const mediaPrepared = await preparePayloadWithImageManifest(payload, action, rootId, {
    signal: options?.signal,
    allowUploadLater: options?.allowUploadLater
  });
  const encoded = await encodePayloadToCompressedTransport(mediaPrepared.payload);

  console.info('[serverApi] payloadPrepared', {
    action,
    rawBytes: encoded.rawBytes,
    compressedBytes: encoded.compressedBytes,
    imageCount: mediaPrepared.imageManifest.length,
    pendingUpload: mediaPrepared.pendingUpload
  });

  return {
    encoded,
    imageManifest: mediaPrepared.imageManifest,
    payloadForCompatibility: encoded.payloadJson ?? {},
    pendingUpload: mediaPrepared.pendingUpload
  };
};

const resolvePayloadFromRow = async <T extends { payload_b64?: string | null; payload_codec?: string | null; payload_json?: unknown | null; payload?: unknown | null }>(row: T): Promise<unknown> => {
  if (row?.payload_b64) {
    return decodePayloadFromCompressedTransport(row.payload_b64, row.payload_codec || 'gzip+pako+b64');
  }
  if (row?.payload_json) return row.payload_json;
  return row?.payload ?? null;
};

const ensureCloudEnabled = (featureEnabled: boolean) => {
  if (LOCAL_ONLY) throw new Error('Cloud disabled');
  if (!featureEnabled) throw new Error('Cloud feature disabled');
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Supabase configuration missing');
};

const scheduleRateLimited = async () => {
  const run = chain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, nextAllowedAt - now);
    if (wait > 0) await delay(wait);
    nextAllowedAt = Date.now() + RATE_LIMIT_MS;
  });
  chain = run.catch(() => undefined);
  return run;
};

const bumpRequestCounter = (endpoint: string, method: string) => {
  const key = '__serverApiRequestCount';
  const win = window as Window & { [key: string]: number };
  win[key] = (win[key] || 0) + 1;
  window.dispatchEvent(new CustomEvent('server-api:request', {
    detail: { endpoint, method, count: win[key] }
  }));
};

type JsonRequestOptions = {
  key: string;
  endpoint: string;
  method: 'GET' | 'POST';
  payload?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  retries?: number;
  retryTimeoutOnce?: boolean;
};

const requestJson = async <T>(options: JsonRequestOptions): Promise<T> => {
  if (inFlight.has(options.key)) {
    return inFlight.get(options.key) as Promise<T>;
  }

  const request = (async () => {
    let attempt = 0;
    let timeoutRetryUsed = false;
    const maxRetries = options.retries ?? 0;

    while (true) {
      await scheduleRateLimited();
      const controller = new AbortController();
      const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const onAbort = () => controller.abort(options.signal?.reason || 'caller-abort');
      if (options.signal) {
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener('abort', onAbort, { once: true });
      }

      const timeoutId = window.setTimeout(() => controller.abort('timeout'), timeout);
      const body = options.payload === undefined ? undefined : JSON.stringify(options.payload);

      try {
        bumpRequestCounter(options.endpoint, options.method);
        const response = await fetch(`${SUPABASE_URL}/rest/v1/${options.endpoint}`, {
          method: options.method,
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            Prefer: options.method === 'POST' ? 'return=representation' : 'return=minimal'
          },
          body,
          signal: controller.signal
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Supabase ${options.endpoint} failed ${response.status}: ${short(text)}`);
        }

        const text = await response.text();
        return (text ? JSON.parse(text) : null) as T;
      } catch (error) {
        const isTimeout = error instanceof DOMException && error.name === 'AbortError';

        if (options.method === 'GET' && attempt < maxRetries) {
          const backoff = [1000, 2000, 4000][attempt] || 4000;
          attempt += 1;
          await delay(backoff);
          continue;
        }

        if (options.retryTimeoutOnce && isTimeout && !timeoutRetryUsed) {
          timeoutRetryUsed = true;
          await delay(1000);
          continue;
        }

        throw error;
      } finally {
        window.clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
  })().finally(() => {
    inFlight.delete(options.key);
  });

  inFlight.set(options.key, request);
  return request;
};

export const backupUpload = Object.assign(
  async (payload: unknown, options?: { signal?: AbortSignal }) => {
    ensureCloudEnabled(CLOUD_FEATURES.BACKUP);
    const transport = await prepareTransportRecord('backup', payload, { signal: options?.signal, allowUploadLater: true });
    const key = `backupUpload:${hashPayload(transport.encoded.payloadB64)}`;
    const data = await requestJson<Array<{ id: string; created_at: string }>>({
      key,
      endpoint: 'backups',
      method: 'POST',
      payload: [{ payload: transport.payloadForCompatibility, payload_b64: transport.encoded.payloadB64, payload_codec: transport.encoded.payloadCodec, payload_json: transport.encoded.payloadJson, image_manifest: transport.imageManifest }],
      timeoutMs: BACKUP_TIMEOUT_MS,
      signal: options?.signal,
      retryTimeoutOnce: true
    });

    const row = Array.isArray(data) ? data[0] : null;
    if (!row?.id) throw new Error('Backup upload returned empty id');
    console.info('[serverApi] backupUpload', { backupId: row.id, payloadBytes: getPayloadBytes(payload) });
    return { backupId: row.id, uploadedAt: row.created_at };
  },
  {
    restoreById: async (backupId: string, options?: { signal?: AbortSignal }) => {
      ensureCloudEnabled(CLOUD_FEATURES.BACKUP);
      const key = `backupRestore:${backupId}`;
      const query = `backups?id=eq.${encodeURIComponent(backupId)}&select=id,created_at,payload,payload_b64,payload_codec,payload_json,image_manifest&limit=1`;
      const data = await requestJson<Array<{ id: string; created_at: string; payload: unknown; payload_b64?: string | null; payload_codec?: string | null; payload_json?: unknown | null; image_manifest?: unknown }>>({
        key,
        endpoint: query,
        method: 'GET',
        signal: options?.signal,
        retries: 3
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) throw new Error('Backup not found');
      const payloadDecoded = await resolvePayloadFromRow(row);
      if (!payloadDecoded) throw new Error('Backup not found');
      console.info('[serverApi] backupRestore', { backupId: row.id, payloadBytes: getPayloadBytes(payloadDecoded) });
      return { ...row, payload: payloadDecoded };
    }
  }
);

export const publicQuoteCreate = async ({ token, payload, expiresAt }: { token: string; payload: unknown; expiresAt: string | number | Date }, options?: { signal?: AbortSignal }) => {
  ensureCloudEnabled(CLOUD_FEATURES.PUBLIC_QUOTE);
  const expiresIso = new Date(expiresAt).toISOString();
  const transport = await prepareTransportRecord('quote', payload, { signal: options?.signal, allowUploadLater: true });
  const key = `publicQuoteCreate:${token}:${hashPayload(transport.encoded.payloadB64)}`;
  const data = await requestJson<Array<{ token: string }>>({
    key,
    endpoint: 'public_quote_snapshots',
    method: 'POST',
    payload: [{ token, payload: transport.payloadForCompatibility, expires_at: expiresIso, payload_b64: transport.encoded.payloadB64, payload_codec: transport.encoded.payloadCodec, payload_json: transport.encoded.payloadJson, image_manifest: transport.imageManifest }],
    signal: options?.signal
  });
  const row = Array.isArray(data) ? data[0] : null;
  console.info('[serverApi] publicQuoteCreate', { token: short(token), payloadBytes: getPayloadBytes(payload), expiresAt: expiresIso });
  return { token: row?.token || token };
};

export const publicQuoteGet = async (token: string, options?: { signal?: AbortSignal }) => {
  ensureCloudEnabled(CLOUD_FEATURES.PUBLIC_QUOTE);
  const key = `publicQuoteGet:${token}`;
  const query = `public_quote_snapshots?token=eq.${encodeURIComponent(token)}&select=token,expires_at,payload,payload_b64,payload_codec,payload_json,image_manifest&limit=1`;
  const data = await requestJson<Array<{ token: string; expires_at: string; payload: unknown; payload_b64?: string | null; payload_codec?: string | null; payload_json?: unknown | null; image_manifest?: unknown }>>({
    key,
    endpoint: query,
    method: 'GET',
    signal: options?.signal,
    retries: 3
  });
  const row = Array.isArray(data) ? (data[0] || null) : null;
  if (!row) return null;
  return { ...row, payload: await resolvePayloadFromRow(row) };
};

export const leadCreate = async (payload: { name: string; phone: string; message?: string; orderId?: string | null; [key: string]: unknown }, options?: { signal?: AbortSignal }) => {
  ensureCloudEnabled(CLOUD_FEATURES.CLIENT_FORM);
  const transport = await prepareTransportRecord('lead', payload, { signal: options?.signal, allowUploadLater: true });
  const key = `leadCreate:${hashPayload(transport.encoded.payloadB64)}`;
  const requestPayload = [{
    name: payload.name,
    phone: payload.phone,
    message: payload.message || '',
    order_id: payload.orderId || null,
    payload: transport.payloadForCompatibility,
    payload_b64: transport.encoded.payloadB64,
    payload_codec: transport.encoded.payloadCodec,
    payload_json: transport.encoded.payloadJson,
    image_manifest: transport.imageManifest
  }];
  const data = await requestJson<Array<{ id: string }>>({
    key,
    endpoint: 'leads',
    method: 'POST',
    payload: requestPayload,
    signal: options?.signal
  });
  const row = Array.isArray(data) ? data[0] : null;
  console.info('[serverApi] leadCreate', { leadId: row?.id || null, hasOrderId: Boolean(payload.orderId) });
  return { leadId: row?.id || '' };
};

export const isServerApiAvailable = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) && !LOCAL_ONLY;
