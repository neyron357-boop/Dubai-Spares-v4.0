import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudBuildGuardMessage, isCloudConfigured } from './cloudConfig';
import { supabase } from './supabase';
import { decodePayloadFromCompressedTransport } from './cloudCodec';
import { buildPublicQuoteSlug, QuoteRates } from './shareUtils';
import { Order } from './types';
import { logger } from './logging';
import { normalizeGroupItems, normalizePartQuantity } from './utils/groupItems';

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
    markupType?: string;
    markup_type?: string;
    markupFixedAed?: number;
    markup_fixed_aed?: number;
    markupPercent?: number;
    markup_percent?: number;
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
    part_kind?: 'single' | 'group';
    group_items?: Array<{ id: string; name: string; quantity: number }>;
    qty: number;
    supplier_price_aed: number;
    client_price_aed: number;
    photo_urls: string[];
    weight_kg?: number;
    places?: number;
    cargo_place_group?: string;
    is_oversized?: boolean;
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
  public_contact?: {
    whatsapp?: string | null;
    telegram?: string | null;
    instagram?: string | null;
  };
  public_settings?: {
    publicWhatsappNumber?: string;
    publicTelegramUrl?: string;
    publicInstagramUrl?: string;
    publicDeliveryTerms?: string;
    publicWorkTerms?: string;
    publicCompanyLogoUrl?: string;
    publicInvoiceSignatureUrl?: string;
    publicManagerName?: string;
    whatsapp_phone?: string | null;
  };
  logistics?: {
    deliveryType?: 'uae' | 'export';
    deliveryAed?: number;
    packingAed?: number;
    serviceFeeAed?: number;
    cargoDeliveryType?: 'air' | 'express_air' | 'container';
    cargoEtaDays?: string;
    cargoVolumeCbm?: number;
    cargoBaseCostUsd?: number;
    cargoTotalCostUsd?: number;
    additionalCostsUsd?: {
      packagingUsd?: number;
      insuranceUsd?: number;
      customsUsd?: number;
      cityDeliveryUsd?: number;
    };
  };
  items?: Array<{
    name: string;
    qty: number;
    unit_price: number;
    line_total: number;
    currency: string;
  }>;
  fees?: {
    logistics: number;
    packaging: number;
    commission: number;
  };
  contacts?: {
    whatsapp: string;
    telegram: string;
    instagram: string;
  };
  meta?: {
    oid: string;
    exp: number;
    created_at: string;
  };
  image_manifest?: unknown;
};

type SnapshotRow = {
  id: string;
  token: string;
  snapshot_id?: string | null;
  original_url?: string | null;
  short_url?: string | null;
  expires_at: string;
  payload?: unknown;
  payload_json?: unknown;
  payload_b64?: string | null;
  payload_codec?: string | null;
};

type SnapshotContactsSource = 'snapshot' | 'settings' | 'legacy';
type SnapshotPayloadSource = 'payload_json' | 'payload_b64' | 'payload' | 'none';

type AppStatePublicSettingsRow = {
  data?: {
    publicWhatsappNumber?: string;
    publicTelegramUrl?: string;
    publicInstagramUrl?: string;
    publicDeliveryTerms?: string;
    publicWorkTerms?: string;
    publicCompanyLogoUrl?: string;
    publicInvoiceSignatureUrl?: string;
    publicManagerName?: string;
  };
};

export type PublicContactSettings = {
  publicWhatsappNumber: string;
  publicTelegramUrl: string;
  publicInstagramUrl: string;
  publicDeliveryTerms: string;
  publicWorkTerms: string;
  publicCompanyLogoUrl: string;
  publicInvoiceSignatureUrl: string;
  publicManagerName: string;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 700 * 1024;
const MAX_IMAGE_WIDTH = 1280;
const IMAGE_QUALITY = 0.72;

const isDevBuild = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

const createInFlight = new Map<string, Promise<{ id: string | null | undefined; token: string; snapshotId: string; expiresAt: string; url: string; originalUrl: string; shortUrl: string | null }>>();

const ISGD_API = 'https://is.gd/create.php';

const shortenPublicQuoteUrl = async (url: string, signal?: AbortSignal): Promise<string | null> => {
  const encodedUrl = encodeURIComponent(url);
  try {
    const response = await fetch(`${ISGD_API}?format=simple&url=${encodedUrl}`, {
      method: 'GET',
      signal
    });
    if (!response.ok) {
      void logger.warn('public-quote:shorten', 'is.gd request failed', { status: response.status, url });
      return null;
    }
    const shortUrl = String(await response.text()).trim();
    if (!shortUrl || !/^https?:\/\//i.test(shortUrl)) {
      void logger.warn('public-quote:shorten', 'is.gd returned invalid body', { shortUrl, url });
      return null;
    }
    return shortUrl;
  } catch (error) {
    void logger.warn('public-quote:shorten', 'is.gd request threw', {
      url,
      error: error instanceof Error ? error.message : 'unknown'
    });
    return null;
  }
};

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

const pickNumeric = (...values: Array<unknown>) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const resolveClientUnitPriceAed = (
  variantLike: Record<string, unknown>,
  options?: { markupPercent?: number }
) => {
  const clientPrice = pickNumeric(
    variantLike.priceClientAed,
    variantLike.price_client_aed,
    variantLike.priceWithMarkupAed,
    variantLike.price_with_markup_aed,
    variantLike.finalPriceAed,
    variantLike.final_price_aed,
    variantLike.client_price_aed,
    variantLike.clientPriceAed,
    variantLike.unit_price_aed,
    variantLike.unitPriceAed,
    variantLike.unit_price,
    variantLike.unitPrice
  );
  if (clientPrice !== null) return round2(clientPrice);

  const basePrice = pickNumeric(
    variantLike.salePriceAed,
    variantLike.sale_price_aed,
    variantLike.priceAed,
    variantLike.price_aed,
    variantLike.supplier_price_aed,
    variantLike.supplierPriceAed,
    variantLike.base_price_aed,
    variantLike.basePriceAed,
    variantLike.base_price,
    variantLike.basePrice,
    variantLike.price,
    variantLike.amount,
    variantLike.value
  ) || 0;
  const markupPercent = Number(options?.markupPercent || 0);
  return round2(basePrice * (1 + markupPercent / 100));
};

const computeLineTotal = (item: Record<string, unknown>) => {
  const qty = pickNumeric(item.qty, item.quantity, 1) || 1;
  const unitPrice = pickNumeric(item.unit_price, item.unitPrice, item.client_price_aed, item.clientPriceAed);
  const explicitLineTotal = pickNumeric(item.line_total, item.lineTotal);
  const fallbackPrice = pickNumeric(item.price, item.amount, item.value);
  return explicitLineTotal ?? (unitPrice !== null ? qty * unitPrice : fallbackPrice ?? 0);
};

const computeTotalsFromItems = (items: Array<Record<string, unknown>>, fees: { logistics: number; packaging: number; commission: number }) => {
  const partsTotal = items.reduce((sum, item) => sum + computeLineTotal(item), 0);
  return {
    partsTotal,
    grandTotal: partsTotal + fees.logistics + fees.packaging + fees.commission
  };
};

const dedupePhotoUrls = (photos: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  return photos
    .map((photo) => String(photo || '').trim())
    .filter((photo) => {
      if (!photo || seen.has(photo)) return false;
      seen.add(photo);
      return true;
    });
};


const resolveContactsSource = (payload: Record<string, unknown>): SnapshotContactsSource => {
  const contactsObj = payload.contacts && typeof payload.contacts === 'object' ? payload.contacts as Record<string, unknown> : {};
  const hasContacts = Boolean(String(contactsObj.whatsapp || '').trim());
  if (hasContacts) return 'snapshot';

  const settingsObj = payload.public_settings && typeof payload.public_settings === 'object' ? payload.public_settings as Record<string, unknown> : {};
  if (String(settingsObj.publicWhatsappNumber || '').trim()) return 'settings';

  return 'legacy';
};

const buildNormalizedPayloadJson = (payload: Record<string, unknown>) => {
  const markupPercent = Number(pickNumeric(
    payload.markupPercent,
    payload.markup_percent,
    (payload.order as any)?.markupPercent,
    (payload.order as any)?.markup_percent
  ) || 0);
  const legacyParts = Array.isArray(payload.parts) ? payload.parts as Array<Record<string, unknown>> : [];
  const items = legacyParts.map((part) => {
    const variants = Array.isArray(part.variants) ? part.variants as Array<Record<string, unknown>> : [];
    const variant = variants[0] || {};
    const qty = pickNumeric(part.qty, part.quantity, 1) || 1;
    const unitPrice = resolveClientUnitPriceAed({ ...part, ...variant }, { markupPercent });

    return {
      name: String(part.name || 'Part'),
      qty,
      unit_price: unitPrice,
      line_total: round2(unitPrice * qty)
    };
  });

  const fallbackItems = Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : [];
  const normalizedItems = items.length > 0
    ? items
    : fallbackItems.map((item) => {
      const qty = pickNumeric(item.qty, item.quantity, 1) || 1;
      const unitPrice = parseMoney(item.unit_price, item.unitPrice, item.price, item.amount, item.value);
      return {
        name: String(item.name || 'Part'),
        qty,
        unit_price: unitPrice,
        line_total: round2(parseMoney(item.line_total, item.lineTotal, unitPrice * qty))
      };
    });

  const partsTotal = round2(normalizedItems.reduce((sum, item) => sum + parseMoney(item.line_total), 0));
  const logistics = parseMoney((payload.logistics as any)?.deliveryAed, (payload.fees as any)?.logistics, (payload.totals as any)?.logistics_aed);
  const commission = parseMoney((payload.logistics as any)?.serviceFeeAed, (payload.fees as any)?.commission, (payload.totals as any)?.commission_aed);
  const packaging = parseMoney((payload.logistics as any)?.packingAed, (payload.fees as any)?.packaging, (payload.totals as any)?.packing_aed);
  const grandTotal = round2(partsTotal + logistics + commission + packaging);

  const contacts = payload.contacts && typeof payload.contacts === 'object'
    ? payload.contacts as Record<string, unknown>
    : {};
  const managerSettings = payload.public_settings && typeof payload.public_settings === 'object'
    ? payload.public_settings as Record<string, unknown>
    : {};

  const normalizedWhatsapp = toDigits(String(
    contacts.whatsapp
    || managerSettings.whatsapp
    || managerSettings.publicWhatsappNumber
    || (payload.public_contact as any)?.whatsapp
    || (payload.contact as any)?.whatsapp_phone
    || (payload.owner as any)?.whatsapp_phone
    || ''
  ));
  const normalizedTelegram = String(
    contacts.telegram
    || managerSettings.telegram
    || managerSettings.publicTelegramUrl
    || (payload.public_contact as any)?.telegram
    || (payload.contact as any)?.telegram
    || ''
  );
  const normalizedInstagram = String(
    contacts.instagram
    || managerSettings.instagram
    || managerSettings.publicInstagramUrl
    || (payload.public_contact as any)?.instagram
    || (payload.contact as any)?.instagram
    || ''
  );

  return {
    ...payload,
    items: normalizedItems,
    fees: {
      logistics,
      packaging,
      commission
    },
    totals: {
      ...(payload.totals && typeof payload.totals === 'object' ? payload.totals as Record<string, unknown> : {}),
      parts_total: partsTotal,
      grand_total: grandTotal,
      parts_sum_aed: partsTotal,
      logistics_aed: logistics,
      packing_aed: packaging,
      commission_aed: commission,
      grand_total_aed: grandTotal
    },
    contacts: {
      whatsapp: normalizedWhatsapp || null,
      telegram: normalizedTelegram || null,
      instagram: normalizedInstagram || null
    }
  };
};

const ensurePayloadReadModel = async (row: SnapshotRow, payload: unknown) => {
  if (!payload || typeof payload !== 'object') return { payload, contactsSource: 'legacy' as SnapshotContactsSource, wasPatched: false };
  const source = payload as Record<string, unknown>;
  const needsLegacyBackfill = !row.payload_json || typeof row.payload_json !== 'object';
  const basePayload = needsLegacyBackfill ? buildNormalizedPayloadJson(source) : source;
  const feesObj = basePayload.fees && typeof basePayload.fees === 'object' ? basePayload.fees as Record<string, unknown> : {};
  const logistics = parseMoney(feesObj.logistics, (basePayload.logistics as any)?.deliveryAed, (basePayload.totals as any)?.logistics_aed);
  const packaging = parseMoney(feesObj.packaging, (basePayload.logistics as any)?.packingAed, (basePayload.totals as any)?.packing_aed);
  const commission = parseMoney(feesObj.commission, (basePayload.logistics as any)?.serviceFeeAed, (basePayload.totals as any)?.commission_aed);

  const itemRows = Array.isArray(basePayload.items) ? basePayload.items as Array<Record<string, unknown>> : [];
  const partRows = Array.isArray(basePayload.parts) ? basePayload.parts as Array<Record<string, unknown>> : [];
  const markupPercent = Number(pickNumeric(
    basePayload.markupPercent,
    basePayload.markup_percent,
    (basePayload.order as any)?.markupPercent,
    (basePayload.order as any)?.markup_percent
  ) || 0);
  const normalizedItemsFromParts = partRows.map((part) => {
    const qty = pickNumeric(part.qty, part.quantity, 1) || 1;
    const unitPrice = resolveClientUnitPriceAed(part, { markupPercent });
    return {
      name: String(part.name || 'Part'),
      qty,
      unit_price: unitPrice,
      line_total: round2(unitPrice * qty),
      currency: 'AED'
    };
  });
  const normalizedItems = normalizedItemsFromParts.length > 0
    ? normalizedItemsFromParts
    : itemRows.map((item) => {
      const qty = pickNumeric(item.qty, item.quantity, 1) || 1;
      const unitPrice = resolveClientUnitPriceAed(item, { markupPercent });
      return {
        name: String(item.name || 'Part'),
        qty,
        unit_price: unitPrice,
        line_total: round2(unitPrice * qty),
        currency: 'AED'
      };
    });
  const computed = computeTotalsFromItems(normalizedItems as Array<Record<string, unknown>>, { logistics, packaging, commission });
  const existingTotals = basePayload.totals && typeof basePayload.totals === 'object' ? basePayload.totals as Record<string, unknown> : {};

  const nextContacts = basePayload.contacts && typeof basePayload.contacts === 'object'
    ? basePayload.contacts as Record<string, unknown>
    : {
      whatsapp: toDigits(String((basePayload.public_settings as any)?.publicWhatsappNumber || (basePayload.owner as any)?.whatsapp_phone || '')),
      telegram: String((basePayload.public_settings as any)?.publicTelegramUrl || ''),
      instagram: String((basePayload.public_settings as any)?.publicInstagramUrl || '')
    };

  const nextPayload: Record<string, unknown> = {
    ...basePayload,
    items: normalizedItems,
    totals: {
      ...existingTotals,
      parts_total: round2(computed.partsTotal),
      parts_sum_aed: round2(computed.partsTotal),
      logistics_aed: parseMoney(existingTotals.logistics_aed, logistics),
      packing_aed: parseMoney(existingTotals.packing_aed, packaging),
      commission_aed: parseMoney(existingTotals.commission_aed, commission),
      grand_total: round2(computed.grandTotal),
      grand_total_aed: round2(computed.grandTotal)
    },
    fees: {
      logistics,
      packaging,
      commission
    },
    contacts: nextContacts
  };

  const currentSnapshot = JSON.stringify(basePayload);
  const patchedSnapshot = JSON.stringify(nextPayload);
  const wasPatched = currentSnapshot !== patchedSnapshot;
  if (wasPatched) {
    try {
      if (supabase) {
        await supabase
          .from('public_quote_snapshots')
          .update({ payload_json: nextPayload })
          .eq('id', row.id);
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/public_quote_snapshots?id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ payload_json: nextPayload })
        });
      }
    } catch {
      // best effort backfill on read
    }
  }

  return { payload: nextPayload, contactsSource: resolveContactsSource(nextPayload), wasPatched };
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

  const withPhotoLimit = (maxPhotosPerPart: number): PublicQuotePayloadV1 => ({
    ...payload,
    order: {
      ...payload.order,
      photo_omitted_notice: 'Some photos were reduced to keep link fast'
    },
    parts: payload.parts.map((part) => ({
      ...part,
      photo_urls: dedupePhotoUrls(part.photo_urls || []).slice(0, Math.max(0, maxPhotosPerPart))
    }))
  });

  const payloadWithTwoPhotos = withPhotoLimit(2);
  if (jsonBytes(payloadWithTwoPhotos) <= MAX_PAYLOAD_BYTES) {
    return { payload: payloadWithTwoPhotos, photosOmitted: true };
  }

  const payloadWithOnePhoto = withPhotoLimit(1);
  if (jsonBytes(payloadWithOnePhoto) <= MAX_PAYLOAD_BYTES) {
    return { payload: payloadWithOnePhoto, photosOmitted: true };
  }

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
    publicCompanyLogoUrl?: string;
    publicInvoiceSignatureUrl?: string;
    publicManagerName?: string;
  },
  rates?: QuoteRates
): PublicQuotePayloadV1 => {
  const createdAtIso = new Date().toISOString();
  const expiresAtMs = Date.now() + SNAPSHOT_TTL_MS;
  const deliveryAed = parseMoney(order.logistics?.deliveryAed, (order as any).logistics?.delivery, (order as any).deliveryAed, (order as any).delivery);
  const packingAed = parseMoney(order.logistics?.packingAed, (order as any).logistics?.packing, (order as any).packingAed, (order as any).packing);
  const commissionAed = parseMoney(order.logistics?.serviceFeeAed, (order as any).logistics?.commission, (order as any).commissionAed, (order as any).commission);
  const cargoCountry = String(order.logistics?.cargoCountry || '').trim();
  const cargoDeliveryType = (order.logistics?.cargoDeliveryType || 'air') as 'air' | 'express_air' | 'container';
  const cargoEtaDays = String(order.logistics?.cargoEtaDays || '').trim();
  const cargoTotalWeightKg = parseMoney(order.logistics?.cargoTotalWeightKg);
  const cargoChargeableWeightKg = parseMoney(order.logistics?.cargoChargeableWeightKg);
  const cargoVolumeCbm = parseMoney(order.logistics?.cargoVolumeCbm);
  const cargoTotalPlaces = parseMoney(order.logistics?.cargoTotalPlaces);
  const cargoBaseCostUsd = parseMoney(order.logistics?.cargoBaseCostUsd);
  const cargoTotalCostUsd = parseMoney(order.logistics?.cargoTotalCostUsd);
  const cargoAirCostUsd = parseMoney(order.logistics?.cargoAirCostUsd);
  const cargoContainerCostUsd = parseMoney(order.logistics?.cargoContainerCostUsd);
  const cargoAirEtaDays = String(order.logistics?.cargoAirEtaDays || '').trim();
  const cargoContainerEtaDays = String(order.logistics?.cargoContainerEtaDays || '').trim();
  const additionalCostsUsd = order.logistics?.additionalCostsUsd || undefined;

  const isFixedMarkup = (order.markupType || 'percent') === 'fixed';
  const fixedMarkupTotal = parseMoney(order.markupFixedAed) || 0;
  const readyPartsForMarkup = (order.parts || []).filter((part) => part.isFound && part.variants.length > 0);
  const fixedMarkupPerPart = isFixedMarkup && readyPartsForMarkup.length > 0
    ? fixedMarkupTotal / readyPartsForMarkup.length
    : 0;

  const pricedParts = readyPartsForMarkup
    .map((part) => {
      const variant = part.variants[0];
      const supplierAed = parseMoney(variant?.salePriceAed ?? variant?.priceAed);
      const clientAed = isFixedMarkup
        ? round2(supplierAed + fixedMarkupPerPart)
        : resolveClientUnitPriceAed(variant as unknown as Record<string, unknown>, {
            markupPercent: parseMoney(order.markupPercent)
          });

      return {
        id: String(part.id),
        name: String(part.name || 'Part'),
        comment: String(part.comment || ''),
        part_kind: part.partKind === 'group' ? 'group' : 'single',
        group_items: normalizeGroupItems((part as any).groupItems).map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity
        })),
        qty: normalizePartQuantity((part as any).quantity),
        supplier_price_aed: supplierAed,
        client_price_aed: round2(clientAed),
        photo_urls: dedupePhotoUrls([part.photoUrl || '', ...(part.photos || []), variant?.photoUrl || '', ...(variant?.photos || [])]),
        weight_kg: parseMoney((part as any).weightKg),
        places: parseMoney((part as any).places),
        cargo_place_group: String((part as any).cargoPlaceGroup || '').trim() || undefined,
        is_oversized: !!(part as any).isOversized
      };
    });

  const snapshotItems = pricedParts.map((part) => ({
    name: part.name,
    qty: part.qty,
    unit_price: part.client_price_aed,
    line_total: round2(part.client_price_aed * part.qty),
    currency: 'AED'
  }));
  const computed = computeTotalsFromItems(snapshotItems as Array<Record<string, unknown>>, {
    logistics: deliveryAed,
    packaging: packingAed,
    commission: commissionAed
  });
  const partsSumAed = computed.partsTotal;
  const grandTotalAed = computed.grandTotal;
  const normalizedWhatsapp = toDigits(publicSettings?.publicWhatsappNumber) || toDigits(owner.whatsappPhone);
  const normalizedTelegram = publicSettings?.publicTelegramUrl || '';
  const normalizedInstagram = publicSettings?.publicInstagramUrl || '';

  return {
    version: 'public_quote_payload_v1',
    created_at: createdAtIso,
    order: {
      id: order.id,
      brand: order.brand,
      model: order.model,
      year: order.year,
      clientName: order.clientName || '',
      client_name: order.clientName || '',
      customerContact: order.customerContact || '',
      customer_contact: order.customerContact || '',
      socialNickname: order.socialNickname || '',
      social_nickname: order.socialNickname || '',
      vin: order.vin,
      body_type: order.bodyType,
      carPhotoUrl: order.carPhotoUrl || order.carPhotos?.[0] || order.vinPhotoUrl || '',
      car_photo_url: order.carPhotoUrl || order.carPhotos?.[0] || order.vinPhotoUrl || '',
      carPhotos: (order.carPhotos || []).slice(0, 3),
      car_photos: (order.carPhotos || []).slice(0, 3),
      vinPhotoUrl: order.vinPhotoUrl || '',
      vin_photo_url: order.vinPhotoUrl || '',
      markupType: order.markupType || 'percent',
      markup_type: order.markupType || 'percent',
      markupFixedAed: parseMoney(order.markupFixedAed) || 0,
      markup_fixed_aed: parseMoney(order.markupFixedAed) || 0,
      markupPercent: parseMoney(order.markupPercent) || 0,
      markup_percent: parseMoney(order.markupPercent) || 0
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
      deliveryType: (order.logistics?.deliveryType || 'uae') as 'uae' | 'export',
      deliveryAed,
      packingAed,
      serviceFeeAed: commissionAed,
      cargoCountry: cargoCountry || undefined,
      cargoDeliveryType,
      cargoEtaDays: cargoEtaDays || undefined,
      cargoTotalWeightKg,
      cargoChargeableWeightKg,
      cargoVolumeCbm,
      cargoTotalPlaces,
      cargoBaseCostUsd,
      cargoTotalCostUsd,
      cargoAirCostUsd,
      cargoContainerCostUsd,
      cargoAirEtaDays: cargoAirEtaDays || undefined,
      cargoContainerEtaDays: cargoContainerEtaDays || undefined,
      additionalCostsUsd
    },
    items: snapshotItems,
    fees: {
      logistics: deliveryAed,
      packaging: packingAed,
      commission: commissionAed
    },
    contacts: {
      whatsapp: normalizedWhatsapp,
      telegram: normalizedTelegram,
      instagram: normalizedInstagram
    },
    meta: {
      oid: order.id,
      exp: expiresAtMs,
      created_at: createdAtIso
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
    customer_links: {
      phone: order.contactLinks?.phone || order.customerContact || null,
      instagram_url: order.contactLinks?.instagramUrl || null,
      tiktok_url: order.contactLinks?.tiktokUrl || null,
      facebook_url: order.contactLinks?.facebookUrl || null,
      telegram_url: order.contactLinks?.telegramUrl || null
    },
    contact: {
      whatsapp_phone: normalizeWhatsappE164(owner.whatsappPhone) || normalizeWhatsappE164(publicSettings?.publicWhatsappNumber),
      display_name: owner.displayName || null,
      phone: normalizeWhatsappE164(publicSettings?.publicWhatsappNumber),
      instagram: publicSettings?.publicInstagramUrl || null,
      telegram: publicSettings?.publicTelegramUrl || null
    },
    public_contact: {
      whatsapp: normalizeWhatsappE164(publicSettings?.publicWhatsappNumber) || normalizeWhatsappE164(owner.whatsappPhone),
      telegram: publicSettings?.publicTelegramUrl || null,
      instagram: publicSettings?.publicInstagramUrl || null
    },
    public_settings: {
      publicWhatsappNumber: publicSettings?.publicWhatsappNumber || '',
      publicTelegramUrl: publicSettings?.publicTelegramUrl || '',
      publicInstagramUrl: publicSettings?.publicInstagramUrl || '',
      publicDeliveryTerms: publicSettings?.publicDeliveryTerms || '',
      publicWorkTerms: publicSettings?.publicWorkTerms || '',
      publicCompanyLogoUrl: publicSettings?.publicCompanyLogoUrl || '',
      publicInvoiceSignatureUrl: publicSettings?.publicInvoiceSignatureUrl || '',
      whatsapp_phone: normalizeWhatsappE164(owner.whatsappPhone)
    },
    hunt_status: order.huntStatus || 'data_gathering'
  };
};

export const publicQuoteCreateSnapshot = async (
  order: Order,
  options?: { currency?: string; exchangeRate?: number; rates?: QuoteRates; owner?: { whatsappPhone?: string | null; displayName?: string | null }; publicSettings?: { publicWhatsappNumber?: string; publicTelegramUrl?: string; publicInstagramUrl?: string; publicDeliveryTerms?: string; publicWorkTerms?: string; publicCompanyLogoUrl?: string; publicInvoiceSignatureUrl?: string }; signal?: AbortSignal; timeoutMs?: number; token?: string; snapshotId?: string }
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
    const hasPricedItems = Array.isArray(payload.items) && payload.items.some((item) => computeLineTotal(item as unknown as Record<string, unknown>) > 0);
    if (!hasPricedItems) {
      throw new Error('Нет цен по позициям');
    }
    const payloadWithCompressedImages = await mapImagesInPayload(payload) as PublicQuotePayloadV1;
    const trimmed = trimPayloadForSize(payloadWithCompressedImages);
    const normalizedPayloadJson = buildNormalizedPayloadJson(trimmed.payload as unknown as Record<string, unknown>);

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

      if (!supabase) throw new Error('Supabase client is not initialized');

      // Attempt 1: full schema (snapshot_id + payload columns present)
      let insertResult = await supabase
        .from('public_quote_snapshots')
        .insert({
          token: quoteToken,
          snapshot: snapshotToken,
          snapshot_id: snapshotToken,
          order_id: order.id,
          expires_at: expiresAt,
          payload: trimmed.payload,
          payload_json: normalizedPayloadJson
        })
        .select('id,token,snapshot_id,expires_at,payload_json')
        .single();

      // Attempt 2: schema may be missing id/payload_json columns — keep snapshot/snapshot_id to satisfy any NOT NULL constraint
      if (insertResult.error && (insertResult.error.code === 'PGRST204' || insertResult.error.code === '42703' || String(insertResult.error.message).includes('Could not find'))) {
        void logger.info('public-quote:create', 'Retrying insert with snapshot_id but without id/payload_json in select', { orderId: order.id, error: insertResult.error.message });
        insertResult = await supabase
          .from('public_quote_snapshots')
          .insert({
            token: quoteToken,
            snapshot: snapshotToken,
            snapshot_id: snapshotToken,
            order_id: order.id,
            expires_at: expiresAt,
            payload: trimmed.payload
          })
          .select('token,snapshot_id,expires_at')
          .single();
      }

      // Attempt 3: snapshot_id column also missing — absolute minimal insert
      if (insertResult.error && (insertResult.error.code === 'PGRST204' || insertResult.error.code === '42703' || String(insertResult.error.message).includes('Could not find'))) {
        void logger.info('public-quote:create', 'Retrying insert without snapshot_id', { orderId: order.id, error: insertResult.error.message });
        insertResult = await supabase
          .from('public_quote_snapshots')
          .insert({
            token: quoteToken,
            order_id: order.id,
            expires_at: expiresAt,
            payload: trimmed.payload
          })
          .select('token,expires_at')
          .single();
      }

      if (insertResult.error) {
        void logger.warn('public-quote:create', 'Snapshot insert failed', { orderId: order.id, code: insertResult.error.code, message: insertResult.error.message, quoteToken });
        throw new Error(insertResult.error.message || 'Server unavailable, try again');
      }

      const created = insertResult.data as { id?: string | null; token: string; snapshot_id?: string | null; original_url?: string | null; short_url?: string | null; expires_at: string; payload_json?: unknown };
      if (!created?.token || !created?.expires_at) {
        void logger.warn('public-quote:create', 'Snapshot insert returned incomplete data', { orderId: order.id, created });
        throw new Error('Share quote created, but response is missing token/expires_at');
      }
      if (isDevBuild && (!created.payload_json || typeof created.payload_json !== 'object')) {
        void logger.warn('public-quote:create', 'payload_json not echoed back from insert', { orderId: order.id });
      }
      const effectiveSnapshotId = (created.snapshot_id || created.id || '').trim();

      const quoteUrl = new URL(`${window.location.origin}/#/q/${encodeURIComponent(buildPublicQuoteSlug(order))}`);
      quoteUrl.searchParams.set('k', `${created.token}.${effectiveSnapshotId}`);

      const originalUrl = quoteUrl.toString();
      const shortUrl = await shortenPublicQuoteUrl(originalUrl, request.signal);
      const finalUrl = shortUrl || originalUrl;

      if (created.id) {
        const updatePayload = {
          original_url: originalUrl,
          short_url: shortUrl
        };
        let updateError = (await supabase
          .from('public_quote_snapshots')
          .update(updatePayload)
          .eq('id', created.id)).error;

        if (updateError && (updateError.code === 'PGRST204' || updateError.code === '42703' || String(updateError.message).includes('Could not find'))) {
          void logger.info('public-quote:create', 'Skipping short/original url persistence because columns are unavailable', {
            orderId: order.id,
            snapshotId: created.id,
            error: updateError.message
          });
          updateError = null;
        }

        if (updateError) {
          void logger.warn('public-quote:create', 'Unable to persist short/original url fields', {
            orderId: order.id,
            snapshotId: created.id,
            error: updateError.message
          });
        }
      }

      if (isDevBuild) {
        console.info('[public-quote] snapshot inserted', {
          urlToken: created.token,
          urlSnapshot: effectiveSnapshotId,
          dbRowId: created.id,
          dbSnapshotId: created.snapshot_id || null,
          dbRowToken: created.token,
          matches: {
            packedKeyMatches: quoteUrl.searchParams.get('k') === `${created.token}.${effectiveSnapshotId}`
          },
          originalUrl,
          shortUrl,
          finalUrl
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
        url: finalUrl,
        originalUrl,
        shortUrl
      };
    } finally {
      request.cleanup();
    }
  })().finally(() => createInFlight.delete(key));

  createInFlight.set(key, promise);
  return promise;
};

const readPayloadWithFallback = async (row: SnapshotRow): Promise<unknown | null> => {
  if (row.payload_json && typeof row.payload_json === 'object') return row.payload_json;
  if (row.payload && typeof row.payload === 'object') return row.payload;
  if (row.payload_b64) {
    try {
      return await decodePayloadFromCompressedTransport(row.payload_b64, row.payload_codec || 'gzip+b64');
    } catch {
      return null;
    }
  }
  return null;
};

const resolveSnapshotPayloadSource = (row: SnapshotRow): SnapshotPayloadSource => {
  if (row.payload_json && typeof row.payload_json === 'object') return 'payload_json';
  if (row.payload_b64) return 'payload_b64';
  if (row.payload && typeof row.payload === 'object') return 'payload';
  return 'none';
};

export const publicQuoteGetSnapshot = async (token: string, options?: { signal?: AbortSignal; timeoutMs?: number; snapshotId?: string | null }) => {
  if (!isCloudConfigured) throw new Error(cloudBuildGuardMessage || 'Cloud is not configured');
  if (!supabase) throw new Error('Supabase client is not initialized');
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error('Snapshot token is required');

  const snapshotFromUrl = (options?.snapshotId || '').trim();
  const COLS = 'id,token,snapshot_id,expires_at,payload,payload_json,payload_b64,payload_codec';
  const COLS_MINIMAL = 'token,expires_at,payload';

  // Helper: select by a specific column value, with column-missing fallback
  const selectBy = async (column: 'id' | 'token' | 'snapshot_id', value: string, silent = false): Promise<SnapshotRow | null> => {
    const q = supabase!
      .from('public_quote_snapshots')
      .select(COLS)
      .eq(column, value)
      .limit(1);
    const { data, error } = await (q as any);
    if (error) {
      if (error.code === 'PGRST204' || error.code === '42703' || String(error.message).includes('Could not find')) {
        // Missing column — retry with minimal columns (only for non-snapshot_id queries)
        if (column === 'snapshot_id') return null;
        const qMinimal = supabase!
          .from('public_quote_snapshots')
          .select(COLS_MINIMAL)
          .eq(column, value)
          .limit(1);
        const { data: d2, error: e2 } = await (qMinimal as any);
        if (e2) {
          if (silent) return null;
          throw new Error(`Failed to load quote (${e2.message})`);
        }
        const rows2 = Array.isArray(d2) ? d2 : (d2 ? [d2] : []);
        return (rows2[0] as SnapshotRow) || null;
      }
      if (silent) return null;
      void logger.warn('public-quote:fetch', 'Snapshot lookup failed', { token: normalizedToken, column, value, code: error.code, message: error.message });
      throw new Error(`Failed to load quote (${error.code || error.message})`);
    }
    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    return (rows[0] as SnapshotRow) || null;
  };

  let row: SnapshotRow | null = null;

  // Lookup order: by id (snapshotFromUrl) → by snapshot_id → by token → by token=snapshotFromUrl
  if (snapshotFromUrl) {
    row = await selectBy('id', snapshotFromUrl, true);
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
  }

  if (!row && snapshotFromUrl) {
    row = await selectBy('snapshot_id', snapshotFromUrl, true);
  }

  if (!row) {
    row = await selectBy('token', normalizedToken);
  }

  if (!row && snapshotFromUrl && snapshotFromUrl !== normalizedToken) {
    row = await selectBy('token', snapshotFromUrl, true);
  }

  if (!row) {
    void logger.info('public-quote:fetch', 'Snapshot not found', { token: normalizedToken, snapshotFromUrl: snapshotFromUrl || null });
    return null;
  }
  const payload = await readPayloadWithFallback(row);
  const normalizedPayload = await ensurePayloadReadModel(row, payload);
  const snapshotSource = resolveSnapshotPayloadSource(row);

  void logger.info('public-quote:fetch', 'Snapshot loaded', {
    token: normalizedToken,
    dbToken: row.token,
    rowId: row.id,
    snapshotId: row.snapshot_id || row.id,
    hasPayload: !!normalizedPayload.payload,
    isPayloadCorrupted: !normalizedPayload.payload,
    snapshotSource,
    contactsSource: normalizedPayload.contactsSource,
    wasPatched: normalizedPayload.wasPatched
  });

  return {
    id: row.id,
    token: row.token,
    snapshot_id: row.snapshot_id || row.id,
    expires_at: row.expires_at,
    payload: normalizedPayload.payload,
    isPayloadCorrupted: !normalizedPayload.payload,
    row_id: row.id,
    contacts_source: normalizedPayload.contactsSource,
    snapshot_source: snapshotSource
  };
};

export const publicQuoteGetPublicContactSettings = async (options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<PublicContactSettings | null> => {
  if (!isCloudConfigured) return null;
  const request = withTimeoutSignal(options?.timeoutMs || DEFAULT_TIMEOUT_MS, options?.signal);
  const readPublicContactSettings = (raw: Record<string, any> | null | undefined): PublicContactSettings => {
    const container = raw || {};
    const nested = [
      container,
      container.data,
      container.public_settings,
      container.publicSettings,
      container.contacts,
      container.publicContacts,
      container.settings,
      container.appSettings
    ].filter((item): item is Record<string, any> => !!item && typeof item === 'object');

    const first = (...keys: string[]) => {
      for (const key of keys) {
        for (const scope of nested) {
          const value = scope[key];
          if (typeof value === 'string' && value.trim()) return value;
        }
      }
      return '';
    };

    return {
      publicWhatsappNumber: toDigits(first('publicWhatsappNumber', 'public_whatsapp_number', 'whatsapp_phone', 'whatsappPhone', 'whatsapp', 'phone')),
      publicTelegramUrl: first('publicTelegramUrl', 'public_telegram_url', 'telegram', 'telegramUrl'),
      publicInstagramUrl: first('publicInstagramUrl', 'public_instagram_url', 'instagram', 'instagramUrl'),
      publicDeliveryTerms: first('publicDeliveryTerms', 'public_delivery_terms', 'deliveryTerms', 'delivery_terms'),
      publicWorkTerms: first('publicWorkTerms', 'public_work_terms', 'workTerms', 'work_terms'),
      publicCompanyLogoUrl: first('publicCompanyLogoUrl', 'public_company_logo_url', 'companyLogoUrl', 'logo', 'logoUrl'),
      publicInvoiceSignatureUrl: first('publicInvoiceSignatureUrl', 'public_invoice_signature_url', 'invoiceSignatureUrl', 'signature', 'signatureUrl'),
      publicManagerName: first('publicManagerName', 'public_manager_name', 'managerName', 'manager_name', 'ownerName', 'owner_name')
    };
  };

  const mergeSettings = (preferred: PublicContactSettings, fallback?: PublicContactSettings | null): PublicContactSettings => ({
    publicWhatsappNumber: preferred.publicWhatsappNumber || fallback?.publicWhatsappNumber || '',
    publicTelegramUrl: preferred.publicTelegramUrl || fallback?.publicTelegramUrl || '',
    publicInstagramUrl: preferred.publicInstagramUrl || fallback?.publicInstagramUrl || '',
    publicDeliveryTerms: preferred.publicDeliveryTerms || fallback?.publicDeliveryTerms || '',
    publicWorkTerms: preferred.publicWorkTerms || fallback?.publicWorkTerms || '',
    publicCompanyLogoUrl: preferred.publicCompanyLogoUrl || fallback?.publicCompanyLogoUrl || '',
    publicInvoiceSignatureUrl: preferred.publicInvoiceSignatureUrl || fallback?.publicInvoiceSignatureUrl || '',
    publicManagerName: preferred.publicManagerName || fallback?.publicManagerName || ''
  });

  try {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('app_state')
      .select('id,data')
      .in('id', ['public_settings', 'global'])
      .limit(2);
    if (error || !Array.isArray(data)) return null;
    const rows = data as AppStatePublicSettingsRow[];
    const byId = new Map(rows.map((row) => [String((row as any)?.id || ''), row]));
    const fromPublicSettings = readPublicContactSettings((byId.get('public_settings')?.data || null) as Record<string, any> | null);
    const fromGlobal = readPublicContactSettings((byId.get('global')?.data || null) as Record<string, any> | null);
    const merged = mergeSettings(fromPublicSettings, fromGlobal);
    if (merged.publicWhatsappNumber || merged.publicTelegramUrl || merged.publicInstagramUrl || merged.publicDeliveryTerms || merged.publicWorkTerms || merged.publicCompanyLogoUrl || merged.publicInvoiceSignatureUrl || merged.publicManagerName) {
      return merged;
    }
    return null;
  } catch {
    return null;
  } finally {
    request.cleanup();
  }
};
