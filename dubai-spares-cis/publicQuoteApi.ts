import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudBuildGuardMessage, isCloudConfigured } from './cloudConfig';
import { decodePayloadFromCompressedTransport } from './cloudCodec';
import { buildPublicQuoteSlug, QuoteRates, serializeQuoteRates } from './shareUtils';
import { Order } from './types';
import { logger } from './logging';

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
    photo_omitted_notice?: string;
  };
  pricing: {
    currency: string;
    fx_rate: number;
    rates?: Record<string, number>;
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
  manager_contact?: {
    whatsapp_phone: string | null;
    display_name?: string | null;
  };
  brand?: {
    name?: string | null;
  };
  breakdown?: {
    parts_total: number;
    delivery: number;
    packaging: number;
    commission: number;
    total: number;
    currency: string;
    fx_rate: number;
    rates?: Record<string, number>;
  };
  contact?: {
    whatsapp_phone: string | null;
    display_name?: string | null;
    phone?: string | null;
    instagram?: string | null;
    telegram?: string | null;
  };
  public_settings?: {
    publicWhatsappNumber?: string;
    publicTelegramUrl?: string;
    publicInstagramUrl?: string;
    publicDeliveryTerms?: string;
    publicWorkTerms?: string;
    whatsapp_phone?: string | null;
  };
  logistics?: {
    deliveryAed?: number;
    packingAed?: number;
    serviceFeeAed?: number;
  };
  image_manifest?: unknown;
};

type SnapshotRow = {
  id: string;
  token: string;
  snapshot_id?: string | null;
  expires_at: string;
  payload?: unknown;
  payload_json?: unknown;
  payload_b64?: string | null;
  payload_codec?: string | null;
};

type AppStatePublicSettingsRow = {
  data?: {
    publicWhatsappNumber?: string;
    publicTelegramUrl?: string;
    publicInstagramUrl?: string;
    publicDeliveryTerms?: string;
    publicWorkTerms?: string;
  };
};

export type PublicContactSettings = {
  publicWhatsappNumber: string;
  publicTelegramUrl: string;
  publicInstagramUrl: string;
  publicDeliveryTerms: string;
  publicWorkTerms: string;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 700 * 1024;
const MAX_IMAGE_WIDTH = 1280;
const IMAGE_QUALITY = 0.72;

const isDevBuild = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

const createInFlight = new Map<string, Promise<{ id: string; token: string; snapshotId: string; expiresAt: string; url: string }>>();

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
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return `+${digits}`;
};

const createToken = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const toDigits = (value: string | null | undefined) => (value || '').replace(/\D/g, '');

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

const isDataImage = (value: unknown): value is string => typeof value === 'string' && value.startsWith('data:image');

const compressDataImage = async (dataUrl: string): Promise<string> => {
  if (typeof document === 'undefined') return dataUrl;
  const sourceBlob = await fetch(dataUrl).then((response) => response.blob());
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(sourceBlob);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image decode failed'));
    };
    image.src = objectUrl;
  });

  const scale = Math.min(1, MAX_IMAGE_WIDTH / Math.max(img.naturalWidth || img.width, 1));
  const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return dataUrl;
  context.drawImage(img, 0, 0, width, height);

  const compressed = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image encode failed'))), 'image/webp', IMAGE_QUALITY);
  });

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || dataUrl));
    reader.onerror = () => reject(new Error('Image read failed'));
    reader.readAsDataURL(compressed);
  });
};

const mapImagesInPayload = async (input: unknown): Promise<unknown> => {
  if (Array.isArray(input)) {
    return Promise.all(input.map((item) => mapImagesInPayload(item)));
  }
  if (input && typeof input === 'object') {
    const entries = await Promise.all(Object.entries(input as Record<string, unknown>).map(async ([key, value]) => [key, await mapImagesInPayload(value)] as const));
    return Object.fromEntries(entries);
  }
  if (!isDataImage(input)) return input;
  try {
    return await compressDataImage(input);
  } catch {
    return input;
  }
};

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

const trimPayloadForSize = (payload: PublicQuotePayloadV1): { payload: PublicQuotePayloadV1; photosOmitted: boolean } => {
  if (jsonBytes(payload) <= MAX_PAYLOAD_BYTES) return { payload, photosOmitted: false };
  return {
    photosOmitted: true,
    payload: {
      ...payload,
      order: { ...payload.order, photo_omitted_notice: 'Photos omitted to keep link fast' },
      parts: payload.parts.map((part) => ({ ...part, photo_urls: [] }))
    }
  };
};

const buildSnapshotPayload = (
  order: Order,
  currency: string,
  exchangeRate: number,
  owner: { whatsappPhone?: string | null; displayName?: string | null },
  publicSettings?: {
    publicWhatsappNumber?: string;
    publicTelegramUrl?: string;
    publicInstagramUrl?: string;
    publicDeliveryTerms?: string;
    publicWorkTerms?: string;
  },
  rates?: QuoteRates
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
      fx_rate: exchangeRate,
      rates
    },
    totals: {
      parts_sum_aed: partsSumAed,
      logistics_aed: deliveryAed,
      packing_aed: packingAed,
      commission_aed: commissionAed,
      grand_total_aed: grandTotalAed
    },
    breakdown: {
      parts_total: partsSumAed,
      delivery: deliveryAed,
      packaging: packingAed,
      commission: commissionAed,
      total: grandTotalAed,
      currency,
      fx_rate: exchangeRate,
      rates
    },
    parts: pricedParts,
    logistics: {
      deliveryAed,
      packingAed,
      serviceFeeAed: commissionAed
    },
    owner: {
      whatsapp_phone: normalizeWhatsappE164(owner.whatsappPhone),
      display_name: owner.displayName || null
    },
    manager_contact: {
      whatsapp_phone: normalizeWhatsappE164(owner.whatsappPhone) || normalizeWhatsappE164(publicSettings?.publicWhatsappNumber),
      display_name: owner.displayName || null
    },
    brand: {
      name: order.brand || null
    },
    contact: {
      whatsapp_phone: normalizeWhatsappE164(owner.whatsappPhone) || normalizeWhatsappE164(publicSettings?.publicWhatsappNumber),
      display_name: owner.displayName || null,
      phone: normalizeWhatsappE164(publicSettings?.publicWhatsappNumber),
      instagram: publicSettings?.publicInstagramUrl || null,
      telegram: publicSettings?.publicTelegramUrl || null
    },
    public_settings: {
      publicWhatsappNumber: publicSettings?.publicWhatsappNumber || '',
      publicTelegramUrl: publicSettings?.publicTelegramUrl || '',
      publicInstagramUrl: publicSettings?.publicInstagramUrl || '',
      publicDeliveryTerms: publicSettings?.publicDeliveryTerms || '',
      publicWorkTerms: publicSettings?.publicWorkTerms || '',
      whatsapp_phone: normalizeWhatsappE164(owner.whatsappPhone)
    }
  };
};

export const publicQuoteCreateSnapshot = async (
  order: Order,
  options?: { currency?: string; exchangeRate?: number; rates?: QuoteRates; owner?: { whatsappPhone?: string | null; displayName?: string | null }; publicSettings?: { publicWhatsappNumber?: string; publicTelegramUrl?: string; publicInstagramUrl?: string; publicDeliveryTerms?: string; publicWorkTerms?: string }; signal?: AbortSignal; timeoutMs?: number; token?: string; snapshotId?: string }
) => {
  if (!isCloudConfigured) throw new Error(cloudBuildGuardMessage || 'Cloud is not configured');
  const key = order.id;
  const existing = createInFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const quoteToken = (options?.token || createToken()).trim();
    const snapshotToken = (options?.snapshotId || createToken()).trim();
    const expiresAt = new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString();
    const payload = buildSnapshotPayload(
      order,
      options?.currency || order.clientCurrency || 'USD',
      Number(options?.exchangeRate || order.exchangeRate || 3.67),
      options?.owner || {},
      options?.publicSettings,
      options?.rates
    );
    const payloadWithCompressedImages = await mapImagesInPayload(payload) as PublicQuotePayloadV1;
    const trimmed = trimPayloadForSize(payloadWithCompressedImages);

    void logger.info('public-quote:create', 'Prepared snapshot payload', {
      orderId: order.id,
      quoteToken,
      snapshotToken,
      currency: options?.currency || order.clientCurrency || 'USD',
      totals: trimmed.payload.totals,
      hasPublicSettings: !!trimmed.payload.public_settings,
      hasOwner: !!trimmed.payload.owner,
      photosOmitted: trimmed.photosOmitted
    });

    if (isDevBuild) {
      console.info('[public-quote] generated share token', { quoteToken, orderId: order.id });
    }

    const request = withTimeoutSignal(options?.timeoutMs || DEFAULT_TIMEOUT_MS, options?.signal);

    try {
      if (isDevBuild) {
        console.info('[public-quote] inserting snapshot', { token: quoteToken, expiresAt });
      }

      const response = await fetch(`${SUPABASE_URL}/rest/v1/public_quote_snapshots?select=id,token,snapshot_id,expires_at`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify([{ token: quoteToken, snapshot_id: snapshotToken, expires_at: expiresAt, payload: trimmed.payload }]),
        signal: request.signal
      });

      if (!response.ok) {
        void logger.warn('public-quote:create', 'Snapshot insert failed', { orderId: order.id, status: response.status, quoteToken });
        throw new Error('Server unavailable, try again');
      }

      const rows = (await response.json()) as Array<{ id: string; token: string; snapshot_id?: string | null; expires_at: string }>;
      const created = rows[0];
      if (!created?.id || !created?.token || !created?.expires_at) {
        void logger.warn('public-quote:create', 'Snapshot insert returned incomplete data', { orderId: order.id, created });
        throw new Error('Share quote created, but response is missing id/token/expires_at');
      }
      const effectiveSnapshotId = (created.snapshot_id || created.id || '').trim();

      const quoteUrl = new URL(`${window.location.origin}/quote/${encodeURIComponent(buildPublicQuoteSlug(order))}`);
      quoteUrl.searchParams.set('token', created.token);
      quoteUrl.searchParams.set('snapshot', effectiveSnapshotId);
      quoteUrl.searchParams.set('exp', String(Date.parse(created.expires_at)));
      quoteUrl.searchParams.set('oid', order.id);
      quoteUrl.searchParams.set('currency', options?.currency || order.clientCurrency || 'USD');
      if (options?.rates) quoteUrl.searchParams.set('rates', serializeQuoteRates(options.rates));
      if (trimmed.photosOmitted) quoteUrl.searchParams.set('photos', 'omitted');

      if (isDevBuild) {
        console.info('[public-quote] snapshot inserted', {
          urlToken: created.token,
          urlSnapshot: effectiveSnapshotId,
          dbRowId: created.id,
          dbSnapshotId: created.snapshot_id || null,
          dbRowToken: created.token,
          matches: {
            snapshotMatchesRowId: created.id === quoteUrl.searchParams.get('snapshot'),
            snapshotMatchesSnapshotId: (created.snapshot_id || null) === quoteUrl.searchParams.get('snapshot'),
            tokenMatchesRowToken: created.token === quoteUrl.searchParams.get('token')
          }
        });
      }

      void logger.info('public-quote:create', 'Snapshot insert success', {
        orderId: order.id,
        token: created.token,
        snapshotId: effectiveSnapshotId,
        expiresAt: created.expires_at
      });

      return {
        id: created.id,
        token: created.token,
        snapshotId: effectiveSnapshotId,
        expiresAt: created.expires_at,
        url: quoteUrl.toString()
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

export const publicQuoteGetSnapshot = async (token: string, options?: { signal?: AbortSignal; timeoutMs?: number; snapshotId?: string | null }) => {
  if (!isCloudConfigured) throw new Error(cloudBuildGuardMessage || 'Cloud is not configured');
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error('Snapshot token is required');

  const snapshotFromUrl = (options?.snapshotId || '').trim();
  const endpointByToken = `${SUPABASE_URL}/rest/v1/public_quote_snapshots?select=id,token,snapshot_id,expires_at,payload,payload_json,payload_b64,payload_codec&token=eq.${encodeURIComponent(normalizedToken)}&limit=1`;
  const endpointBySnapshotToken = snapshotFromUrl && snapshotFromUrl !== normalizedToken
    ? `${SUPABASE_URL}/rest/v1/public_quote_snapshots?select=id,token,snapshot_id,expires_at,payload,payload_json,payload_b64,payload_codec&token=eq.${encodeURIComponent(snapshotFromUrl)}&limit=1`
    : null;
  const endpointBySnapshotAlt = snapshotFromUrl
    ? `${SUPABASE_URL}/rest/v1/public_quote_snapshots?select=id,token,snapshot_id,expires_at,payload,payload_json,payload_b64,payload_codec&snapshot_id=eq.${encodeURIComponent(snapshotFromUrl)}&limit=1`
    : null;
  const endpointBySnapshot = snapshotFromUrl
    ? `${SUPABASE_URL}/rest/v1/public_quote_snapshots?select=id,token,snapshot_id,expires_at,payload,payload_json,payload_b64,payload_codec&id=eq.${encodeURIComponent(snapshotFromUrl)}&limit=1`
    : null;

  const runSelect = async (queryEndpoint: string, silent = false) => {
    const request = withTimeoutSignal(options?.timeoutMs || DEFAULT_TIMEOUT_MS, options?.signal);
    try {
      const response = await fetch(queryEndpoint, {
        method: 'GET',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Accept: 'application/json'
        },
        signal: request.signal
      });
      if (!response.ok) {
        if (silent) return null;
        void logger.warn('public-quote:fetch', 'Snapshot lookup failed', { token: normalizedToken, status: response.status, endpoint: queryEndpoint });
        throw new Error(`Failed to load quote (${response.status})`);
      }
      const rows = (await response.json()) as SnapshotRow[];
      return rows[0] || null;
    } finally {
      request.cleanup();
    }
  };

  let row = endpointBySnapshot ? await runSelect(endpointBySnapshot, true) : null;
  if (row && row.token !== normalizedToken && row.snapshot_id !== normalizedToken) {
    if (isDevBuild) {
      console.info('[public-quote] snapshot/token mismatch', {
        urlSnapshot: snapshotFromUrl,
        urlToken: normalizedToken,
        dbRowId: row.id,
        dbRowToken: row.token
      });
    }
    row = null;
  }

  if (!row) {
    row = endpointBySnapshotAlt ? await runSelect(endpointBySnapshotAlt, true) : null;
  }

  if (!row) {
    row = await runSelect(endpointByToken);
  }

  if (!row && endpointBySnapshotToken) {
    row = await runSelect(endpointBySnapshotToken, true);
  }

  if (!row) {
    void logger.info('public-quote:fetch', 'Snapshot not found', { token: normalizedToken, snapshotFromUrl: snapshotFromUrl || null });
    return null;
  }
  const payload = await readPayloadWithFallback(row);

  void logger.info('public-quote:fetch', 'Snapshot loaded', {
    token: normalizedToken,
    dbToken: row.token,
    rowId: row.id,
    snapshotId: row.snapshot_id || row.id,
    hasPayload: !!payload,
    isPayloadCorrupted: !payload
  });

  return {
    id: row.id,
    token: row.token,
    snapshot_id: row.snapshot_id || row.id,
    expires_at: row.expires_at,
    payload,
    isPayloadCorrupted: !payload
  };
};

export const publicQuoteGetPublicContactSettings = async (options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<PublicContactSettings | null> => {
  if (!isCloudConfigured) return null;
  const request = withTimeoutSignal(options?.timeoutMs || DEFAULT_TIMEOUT_MS, options?.signal);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/app_state?select=data&id=eq.public_settings&limit=1`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json'
      },
      signal: request.signal
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as AppStatePublicSettingsRow[];
    const raw = rows?.[0]?.data || {};
    return {
      publicWhatsappNumber: toDigits(raw.publicWhatsappNumber),
      publicTelegramUrl: raw.publicTelegramUrl || '',
      publicInstagramUrl: raw.publicInstagramUrl || '',
      publicDeliveryTerms: raw.publicDeliveryTerms || '',
      publicWorkTerms: raw.publicWorkTerms || ''
    };
  } catch {
    return null;
  } finally {
    request.cleanup();
  }
};
