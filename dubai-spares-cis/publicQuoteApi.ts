import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudBuildGuardMessage, isCloudConfigured } from './cloudConfig';
import { Order } from './types';

type PublicSnapshotPayload = {
  order_id: string;
  currency: string;
  exchange_rate: number;
  parts: Array<{
    id: string;
    name: string;
    qty: number;
    final_price_aed: number;
    photo_urls: string[];
  }>;
  totals: {
    parts_subtotal_aed: number;
    markup_aed: number;
    logistics_total_aed: number;
    grand_total_aed: number;
  };
  logistics: {
    delivery_aed: number;
    packing_aed: number;
    commission_aed: number;
    logistics_total_aed: number;
    delivery?: number;
    packing?: number;
    commission?: number;
  };
  order: Record<string, unknown>;
};

type SnapshotRow = {
  id: string;
  token: string;
  payload_json: PublicSnapshotPayload;
  expires_at: string;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type PublicQuoteLookupKey = { mode: 'id' | 'token'; value: string };

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

const createToken = (size = 18) => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const withTimeoutSignal = (timeoutMs: number, parentSignal?: AbortSignal) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(new DOMException('Request timeout', 'AbortError')), timeoutMs);
  const parentAbort = () => controller.abort(parentSignal?.reason || new DOMException('Request aborted', 'AbortError'));

  if (parentSignal) {
    if (parentSignal.aborted) parentAbort();
    else parentSignal.addEventListener('abort', parentAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', parentAbort);
    }
  };
};

const buildSnapshotPayload = (order: Order, currency: string, exchangeRate: number): PublicSnapshotPayload => {
  const deliveryAed = parseMoney(order.logistics?.deliveryAed, (order as any).logistics?.delivery, (order as any).deliveryAed, (order as any).delivery);
  const packingAed = parseMoney(order.logistics?.packingAed, (order as any).logistics?.packing, (order as any).packingAed, (order as any).packing);
  const commissionAed = parseMoney(order.logistics?.serviceFeeAed, (order as any).logistics?.commission, (order as any).commissionAed, (order as any).commission);
  const logisticsTotalAed = deliveryAed + packingAed + commissionAed;

  const pricedParts = (order.parts || [])
    .filter((part) => part.isFound && part.variants.length > 0)
    .map((part) => {
      const variant = part.variants[0];
      const supplierAed = parseMoney(variant?.priceAed);
      const finalPriceAed = (order.markupType || 'percent') === 'fixed'
        ? supplierAed
        : supplierAed * (1 + parseMoney(order.markupPercent) / 100);

      return {
        id: String(part.id),
        name: String(part.name || 'Part'),
        qty: 1,
        final_price_aed: finalPriceAed,
        photo_urls: [part.photoUrl || '', ...(part.photos || [])].filter(Boolean).slice(0, 2)
      };
    });

  const partsSubtotalAed = pricedParts.reduce((sum, part) => sum + part.final_price_aed, 0);
  const markupAed = parseMoney(order.markupType === 'fixed' ? order.markupFixedAed : 0);

  return {
    order_id: order.id,
    currency,
    exchange_rate: exchangeRate,
    parts: pricedParts,
    totals: {
      parts_subtotal_aed: partsSubtotalAed,
      markup_aed: markupAed,
      logistics_total_aed: logisticsTotalAed,
      grand_total_aed: partsSubtotalAed + logisticsTotalAed + markupAed
    },
    logistics: {
      delivery_aed: deliveryAed,
      packing_aed: packingAed,
      commission_aed: commissionAed,
      logistics_total_aed: logisticsTotalAed,
      delivery: deliveryAed,
      packing: packingAed,
      commission: commissionAed
    },
    order: {
      id: order.id,
      brand: order.brand,
      model: order.model,
      year: order.year,
      vin: order.vin,
      clientCurrency: order.clientCurrency,
      markupType: order.markupType,
      markupPercent: order.markupPercent,
      markupFixedAed: order.markupFixedAed,
      exchangeRate: order.exchangeRate
    }
  };
};

const quoteUrlForToken = (order: Pick<Order, 'id' | 'brand' | 'model' | 'year'>, token: string, snapshotId?: string) => {
  const slugBase = [order.brand, order.model, order.year].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
  const slug = slugBase ? `${slugBase}--${order.id}` : order.id;
  const url = new URL(`${window.location.origin}/quote/${slug}`);
  url.searchParams.set('token', token);
  url.searchParams.set('oid', order.id);
  if (snapshotId) url.searchParams.set('id', snapshotId);
  return url.toString();
};

export const publicQuoteCreateSnapshot = async (
  order: Order,
  options?: { currency?: string; exchangeRate?: number; signal?: AbortSignal; timeoutMs?: number }
) => {
  if (!isCloudConfigured) throw new Error(cloudBuildGuardMessage || 'Cloud is not configured');
  const key = order.id;
  const existing = createInFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const token = createToken();
    const expiresAtMs = Date.now() + SNAPSHOT_TTL_MS;
    const expiresAt = new Date(expiresAtMs).toISOString();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      throw new Error('Invalid snapshot expiration timestamp');
    }
    const payload_json = buildSnapshotPayload(order, options?.currency || order.clientCurrency || 'USD', Number(options?.exchangeRate || order.exchangeRate || 3.67));

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
        body: JSON.stringify([{ token, expires_at: expiresAt, payload_json, payload_codec: 'json' }]),
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
        url: quoteUrlForToken(order, created.token, created.id)
      };
    } finally {
      request.cleanup();
    }
  })().finally(() => createInFlight.delete(key));

  createInFlight.set(key, promise);
  return promise;
};

export const publicQuoteGetSnapshotByKey = async (key: PublicQuoteLookupKey, options?: { signal?: AbortSignal; timeoutMs?: number }) => {
  if (!isCloudConfigured) throw new Error(cloudBuildGuardMessage || 'Cloud is not configured');
  const normalizedValue = key.value.trim();
  if (!normalizedValue) throw new Error(`Snapshot ${key.mode} is required`);

  const filterField = key.mode === 'id' ? 'id' : 'token';
  const endpoint = `${SUPABASE_URL}/rest/v1/public_quote_snapshots?select=id,token,payload_json,expires_at&${filterField}=eq.${encodeURIComponent(normalizedValue)}`;

  const request = withTimeoutSignal(options?.timeoutMs || DEFAULT_TIMEOUT_MS, options?.signal);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/vnd.pgrst.object+json',
        Prefer: 'count=exact'
      },
      signal: request.signal
    });
    if (response.status === 406) {
      if (import.meta.env.DEV) {
        console.debug('[public-quote] lookup', { mode: key.mode, value: normalizedValue, rowCount: 0 });
      }
      return null;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Failed to load quote (${response.status})`);
    }
    const row = (await response.json()) as SnapshotRow;
    if (import.meta.env.DEV) {
      console.debug('[public-quote] lookup', { mode: key.mode, value: normalizedValue, rowCount: row ? 1 : 0 });
    }
    return row || null;
  } finally {
    request.cleanup();
  }
};

export const publicQuoteGetSnapshot = async (token: string, options?: { signal?: AbortSignal; timeoutMs?: number }) => (
  publicQuoteGetSnapshotByKey({ mode: 'token', value: token }, options)
);
