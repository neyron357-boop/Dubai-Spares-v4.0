import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudBuildGuardMessage, isCloudConfigured } from './cloudConfig';
import { decodePayloadFromCompressedTransport } from './cloudCodec';
import { Order } from './types';

export type PublicQuotePayloadV1 = {
  version: 'public_quote_payload_v1';
  created_at: string;
  order: {
    id: string;
    brand: string;
    model: string;
    year: string;
    vin: string;
    body_type?: string;
  };
  pricing: {
    currency: string;
    fx_rate: number;
  };
  totals: {
    parts_sum_aed: number;
    logistics_aed: number;
    packing_aed: number;
    commission_aed: number;
    grand_total_aed: number;
  };
  parts: Array<{
    id: string;
    name: string;
    qty: number;
    supplier_price_aed: number;
    client_price_aed: number;
    photo_urls: string[];
  }>;
  owner: {
    whatsapp_phone: string | null;
    display_name?: string | null;
  };
  image_manifest?: unknown;
};

type SnapshotRow = {
  id: string;
  token: string;
  expires_at: string;
  payload?: unknown;
  payload_json?: unknown;
  payload_b64?: string | null;
  payload_codec?: string | null;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const createInFlight = new Map<string, Promise<{ id: string; token: string; expiresAt: string; url: string }>>();

const parseMoney = (...values: Array<unknown>) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
};

const normalizeWhatsappE164 = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const plus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return `${plus ? '+' : '+'}${digits}`;
};

const createToken = (size = 24) => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const withTimeoutSignal = (timeoutMs: number, parentSignal?: AbortSignal) => {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Request timeout', 'AbortError'));
  }, timeoutMs);
  const parentAbort = () => controller.abort(parentSignal?.reason || new DOMException('Request aborted', 'AbortError'));

  if (parentSignal) {
    if (parentSignal.aborted) parentAbort();
    else parentSignal.addEventListener('abort', parentAbort, { once: true });
  }

  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', parentAbort);
    }
  };
};

const buildSnapshotPayload = (
  order: Order,
  currency: string,
  exchangeRate: number,
  owner: { whatsappPhone?: string | null; displayName?: string | null }
): PublicQuotePayloadV1 => {
  const deliveryAed = parseMoney(order.logistics?.deliveryAed, (order as any).logistics?.delivery, (order as any).deliveryAed, (order as any).delivery);
  const packingAed = parseMoney(order.logistics?.packingAed, (order as any).logistics?.packing, (order as any).packingAed, (order as any).packing);
  const commissionAed = parseMoney(order.logistics?.serviceFeeAed, (order as any).logistics?.commission, (order as any).commissionAed, (order as any).commission);

  const pricedParts = (order.parts || [])
    .filter((part) => part.isFound && part.variants.length > 0)
    .map((part) => {
      const variant = part.variants[0];
      const supplierAed = parseMoney(variant?.priceAed);
      const clientAed = (order.markupType || 'percent') === 'fixed'
        ? supplierAed
        : supplierAed * (1 + parseMoney(order.markupPercent) / 100);

      return {
        id: String(part.id),
        name: String(part.name || 'Part'),
        qty: 1,
        supplier_price_aed: supplierAed,
        client_price_aed: clientAed,
        photo_urls: [part.photoUrl || '', ...(part.photos || [])].filter(Boolean).slice(0, 2)
      };
    });

  const partsSumAed = pricedParts.reduce((sum, part) => sum + part.client_price_aed, 0);
  const grandTotalAed = partsSumAed + deliveryAed + packingAed + commissionAed;

  return {
    version: 'public_quote_payload_v1',
    created_at: new Date().toISOString(),
    order: {
      id: order.id,
      brand: order.brand,
      model: order.model,
      year: order.year,
      vin: order.vin,
      body_type: order.bodyType
    },
    pricing: {
      currency,
      fx_rate: exchangeRate
    },
    totals: {
      parts_sum_aed: partsSumAed,
      logistics_aed: deliveryAed,
      packing_aed: packingAed,
      commission_aed: commissionAed,
      grand_total_aed: grandTotalAed
    },
    parts: pricedParts,
    owner: {
      whatsapp_phone: normalizeWhatsappE164(owner.whatsappPhone),
      display_name: owner.displayName || null
    }
  };
};

const quoteUrlForToken = (token: string) => `${window.location.origin}/#/q/${encodeURIComponent(token)}`;

export const publicQuoteCreateSnapshot = async (
  order: Order,
  options?: { currency?: string; exchangeRate?: number; owner?: { whatsappPhone?: string | null; displayName?: string | null }; signal?: AbortSignal; timeoutMs?: number }
) => {
  if (!isCloudConfigured) throw new Error(cloudBuildGuardMessage || 'Cloud is not configured');
  const key = order.id;
  const existing = createInFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const token = createToken();
    const expiresAt = new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString();
    const payload = buildSnapshotPayload(
      order,
      options?.currency || order.clientCurrency || 'USD',
      Number(options?.exchangeRate || order.exchangeRate || 3.67),
      options?.owner || {}
    );

    const request = withTimeoutSignal(options?.timeoutMs || DEFAULT_TIMEOUT_MS, options?.signal);

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/public_quote_snapshots?select=id,token,expires_at`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify([{ token, expires_at: expiresAt, payload }]),
        signal: request.signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Share quote failed (${response.status})`);
      }

      const rows = (await response.json()) as Array<{ id: string; token: string; expires_at: string }>;
      const created = rows[0];
      if (!created?.id || !created?.token || !created?.expires_at) {
        throw new Error('Share quote created, but response is missing id/token/expires_at');
      }

      return {
        id: created.id,
        token: created.token,
        expiresAt: created.expires_at,
        url: quoteUrlForToken(created.token)
      };
    } finally {
      request.cleanup();
    }
  })().finally(() => createInFlight.delete(key));

  createInFlight.set(key, promise);
  return promise;
};

const readPayloadWithFallback = async (row: SnapshotRow): Promise<unknown | null> => {
  if (row.payload && typeof row.payload === 'object') return row.payload;
  if (row.payload_json && typeof row.payload_json === 'object') return row.payload_json;
  if (row.payload_b64) {
    try {
      return await decodePayloadFromCompressedTransport(row.payload_b64, row.payload_codec || 'gzip+b64');
    } catch {
      return null;
    }
  }
  return null;
};

export const publicQuoteGetSnapshot = async (token: string, options?: { signal?: AbortSignal; timeoutMs?: number }) => {
  if (!isCloudConfigured) throw new Error(cloudBuildGuardMessage || 'Cloud is not configured');
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error('Snapshot token is required');

  const endpoint = `${SUPABASE_URL}/rest/v1/public_quote_snapshots?select=id,token,expires_at,payload,payload_json,payload_b64,payload_codec&token=eq.${encodeURIComponent(normalizedToken)}&limit=1`;

  const runSelect = async () => {
    const request = withTimeoutSignal(options?.timeoutMs || DEFAULT_TIMEOUT_MS, options?.signal);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Accept: 'application/json'
        },
        signal: request.signal
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Failed to load quote (${response.status})`);
      }
      const rows = (await response.json()) as SnapshotRow[];
      return { row: rows[0] || null, timedOut: false };
    } catch (error) {
      if (request.isTimedOut()) return { row: null, timedOut: true };
      throw error;
    } finally {
      request.cleanup();
    }
  };

  let attempt = await runSelect();
  if (attempt.timedOut) {
    attempt = await runSelect();
  }

  if (!attempt.row) return null;
  const payload = await readPayloadWithFallback(attempt.row);

  return {
    id: attempt.row.id,
    token: attempt.row.token,
    expires_at: attempt.row.expires_at,
    payload,
    isPayloadCorrupted: !payload
  };
};
