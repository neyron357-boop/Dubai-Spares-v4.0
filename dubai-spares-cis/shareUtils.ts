import { Order, Part } from './types';
import { publicQuoteCreateSnapshot } from './publicQuoteApi';
import { loadAppSettings } from './appSettings';

export type QuoteCurrency = 'AED' | 'USD' | 'RUB' | 'TJS';
export type QuoteRates = Record<QuoteCurrency, number>;

export const DEFAULT_QUOTE_RATES: QuoteRates = {
  AED: 1,
  USD: 0.27,
  RUB: 21,
  TJS: 2.60
};

const firstHttpPhoto = (images: string[]) => images.find((item) => item.startsWith('http'));



export const getShareText = (brand: string, partName: string, price: string, cloudLink: string) =>
  `Brand: ${brand} | Part: ${partName} | Price: ${price} | Photos: ${cloudLink}`;

const openShareFallback = (text: string) => {
  const encoded = encodeURIComponent(text);
  window.open(`https://wa.me/?text=${encoded}`, '_blank');
};


const PUBLIC_FORM_BASE_URL = 'https://dubai-spares-cis-ay24a.ondigitalocean.app/public-order-form';

const createRefCode = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const buildPublicOrderFormLink = (refCode?: string) => {
  const ref = (refCode || createRefCode()).trim();
  return {
    refCode: ref,
    url: `${PUBLIC_FORM_BASE_URL}?ref=${encodeURIComponent(ref)}`
  };
};

export const sharePublicOrderForm = async () => {
  const payload = buildPublicOrderFormLink();
  const text = `Заполните форму заявки: ${payload.url}`;

  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(payload.url);
  } catch (error) {
    console.warn('[sharePublicOrderForm] Clipboard copy failed', error);
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: 'Поделиться формой', text, url: payload.url });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return payload;
      }
      throw error;
    }
  }

  return payload;
};

const buildPublicQuoteShareMessage = (order: Order, link: string) => {
  const carName = [order.brand, order.model, order.year].filter(Boolean).join(' ').trim() || `автомобиля ${order.id}`;
  const clientName = (order.clientName || '').trim();
  const intro = clientName ? `Здравствуйте, ${clientName}!` : 'Здравствуйте!';
  return [
    intro,
    `Подготовили для вас итоговую смету по автомобилю ${carName}.`,
    'По этой ссылке доступно финальное предложение с ценами, фотографиями и актуальными деталями по заказу.',
    'Открывайте ссылку в любое время, чтобы посмотреть смету:',
    link,
    'Если понадобится помощь или уточнение по позициям, пожалуйста, напишите нам — мы с удовольствием подскажем.'
  ].join('\n\n');
};

export const shareMessage = async (text: string) => {
  if (navigator.share) {
    await navigator.share({ text });
    return;
  }

  openShareFallback(text);
};

export const buildOrderShareText = (order: Order) => {
  const topPart = order.parts[0];
  const variant = topPart?.variants?.[0];
  const price = variant ? `${variant.priceAed} AED` : 'On request';
  const photos = [
    ...(topPart?.photos || []),
    ...(variant?.photos || []),
    topPart?.photoUrl || '',
    variant?.photoUrl || ''
  ].filter(Boolean) as string[];

  return getShareText(order.brand, topPart?.name || order.model, price, firstHttpPhoto(photos) || 'No cloud link yet');
};

export const buildPartShareText = (order: Order, part: Part) => {
  const bestVariant = [...part.variants].sort((a, b) => a.priceAed - b.priceAed)[0];
  const price = bestVariant ? `${bestVariant.priceAed} AED` : 'On request';
  const photos = [...(part.photos || []), ...(bestVariant?.photos || []), part.photoUrl || '', bestVariant?.photoUrl || ''].filter(Boolean) as string[];
  return getShareText(order.brand, part.name, price, firstHttpPhoto(photos) || 'No cloud link yet');
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

export const buildPublicQuoteSlug = (order: Pick<Order, 'id' | 'brand' | 'model' | 'year'>) => order.id;

export const extractOrderIdFromQuoteSlug = (slugOrId: string) => {
  const trimmed = decodeURIComponent(slugOrId.trim().replace(/^\/+|\/+$/g, ''));
  const separated = trimmed.lastIndexOf('--');
  if (separated > -1) return trimmed.slice(separated + 2);

  const uuidAtEnd = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  if (uuidAtEnd) return uuidAtEnd[0];

  return trimmed;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicQuoteKey = {
  value: string;
  source: 'token';
  urlToken: string | null;
  urlSnapshot: string | null;
};

export const parsePublicQuoteKey = (params: URLSearchParams, _pathParam: string): PublicQuoteKey | null => {
  const packedKey = (params.get('k') || '').trim();
  if (packedKey) {
    const [token, snapshot] = packedKey.split('.');
    if (token) {
      return {
        value: token,
        source: 'token',
        urlToken: token,
        urlSnapshot: (snapshot || '').trim() || null
      };
    }
  }

  const tokenFromQuery = (params.get('token') || '').trim();
  const snapshotFromQuery = (params.get('snapshot') || '').trim();
  if (tokenFromQuery) {
    return {
      value: tokenFromQuery,
      source: 'token',
      urlToken: tokenFromQuery || null,
      urlSnapshot: snapshotFromQuery || null
    };
  }

  const pathParam = decodeURIComponent(String(_pathParam || '').trim());
  if (!pathParam) return null;

  if (pathParam.includes('.')) {
    const [pathToken, pathSnapshot] = pathParam.split('.');
    if (pathToken) {
      return {
        value: pathToken,
        source: 'token',
        urlToken: pathToken,
        urlSnapshot: (pathSnapshot || '').trim() || null
      };
    }
  }

  const looksLikeToken = /^[a-f0-9]{32}$/i.test(pathParam);
  if (!looksLikeToken) return null;

  return {
    value: pathParam,
    source: 'token',
    urlToken: pathParam,
    urlSnapshot: null
  };
};

export const serializeQuoteRates = (rates: QuoteRates) => (
  (Object.keys(DEFAULT_QUOTE_RATES) as QuoteCurrency[])
    .map((code) => `${code}:${Number(rates[code]).toFixed(6)}`)
    .join(',')
);

export const parseQuoteRates = (raw: string | null | undefined): QuoteRates | null => {
  if (!raw) return null;
  const parsed = raw.split(',').reduce<Partial<QuoteRates>>((acc, pair) => {
    const [codeRaw, valueRaw] = pair.split(':');
    const code = (codeRaw || '').trim().toUpperCase() as QuoteCurrency;
    const value = Number(valueRaw);
    if (!(code in DEFAULT_QUOTE_RATES) || !Number.isFinite(value) || value <= 0) return acc;
    acc[code] = value;
    return acc;
  }, {});

  const required = Object.keys(DEFAULT_QUOTE_RATES) as QuoteCurrency[];
  if (required.some((code) => !parsed[code])) return null;

  return parsed as QuoteRates;
};

interface BuildPublicQuoteLinkOptions {
  rates?: QuoteRates;
  currency?: QuoteCurrency;
  expiresAt?: number;
  snapshot?: Record<string, unknown>;
  snapshotToken?: string;
  embedSnapshotInUrl?: boolean;
}

const QUOTE_TOKEN_LENGTH = 32;

const createQuoteToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(QUOTE_TOKEN_LENGTH / 2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(0, QUOTE_TOKEN_LENGTH);
};

const encodeSnapshot = (snapshot: Record<string, unknown>) => {
  try {
    const raw = JSON.stringify(snapshot);
    return btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch {
    return '';
  }
};

const uniquePhotos = (photos: string[]) => {
  const seen = new Set<string>();
  return photos.filter((photo) => {
    const normalized = String(photo || '').trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const buildQuoteSnapshot = (order: Pick<Order,
  'id' | 'brand' | 'model' | 'year' | 'bodyType' | 'vin' | 'vinPhotoUrl' | 'carPhotoUrl' | 'carPhotos' |
  'markupType' | 'markupPercent' | 'markupFixedAed' | 'exchangeRate' | 'clientCurrency' | 'logistics' | 'pricingEvents' | 'parts'>) => {
  const pricedParts = (order.parts || []).filter((part) => part.isFound && part.variants.length > 0);
  const partsSumAed = pricedParts.reduce((sum, part) => sum + Number(part.variants[0]?.priceAed || 0), 0);
  const cargoTotalCostUsd = Number(order.logistics?.cargoTotalCostUsd || 0);
  const deliveryAed = Number(order.logistics?.deliveryAed || 0);
  const packingAed = Number(order.logistics?.packingAed || 0);
  const commissionAed = Number(order.logistics?.serviceFeeAed || 0);
  const markupAed = (order.markupType || 'percent') === 'fixed'
    ? Number(order.markupFixedAed || 0)
    : partsSumAed * (Number(order.markupPercent || 0) / 100);
  const grandTotalAed = partsSumAed + markupAed + deliveryAed + packingAed + commissionAed;

  return ({
  id: order.id,
  brand: order.brand,
  model: order.model,
  year: order.year,
  bodyType: order.bodyType,
  vin: order.vin,
  vinPhotoUrl: order.vinPhotoUrl,
  carPhotoUrl: order.carPhotoUrl,
  carPhotos: (order.carPhotos || []).slice(0, 3),
  markupType: order.markupType,
  markupPercent: order.markupPercent,
  markupFixedAed: order.markupFixedAed,
  exchangeRate: order.exchangeRate,
  clientCurrency: order.clientCurrency || 'USD',
  logistics: {
    ...(order.logistics || {}),
    deliveryAed,
    packingAed,
    serviceFeeAed: commissionAed,
    delivery_aed: deliveryAed,
    packing_aed: packingAed,
    commission_aed: commissionAed,
    logistics_total: deliveryAed + packingAed + commissionAed
  },
  pricingBreakdown: {
    parts_sum: partsSumAed,
    delivery_aed: deliveryAed,
    packing_aed: packingAed,
    commission_aed: commissionAed,
    markup_aed: markupAed,
    grand_total: grandTotalAed,
    cargo_total_cost_usd: cargoTotalCostUsd,
    exchange_rate: Number(order.exchangeRate || 3.67),
    client_currency: order.clientCurrency || 'USD',
    created_at: new Date().toISOString()
  },
  pricingEvents: order.pricingEvents || [],
  parts: (order.parts || []).map((part) => ({
    id: part.id,
    name: part.name,
    isFound: !!part.isFound,
    partType: String((part as any).partType || 'regular'),
    weightKg: Number((part as any).weightKg || 0),
    lengthCm: Number((part as any).lengthCm || 0),
    widthCm: Number((part as any).widthCm || 0),
    heightCm: Number((part as any).heightCm || 0),
    places: Number((part as any).places || 0),
    cargoPlaceGroup: String((part as any).cargoPlaceGroup || '').trim(),
    isOversized: !!(part as any).isOversized,
    photoUrl: part.photoUrl,
    photos: uniquePhotos(part.photos || []),
    variants: (part.variants || []).map((variant) => ({
      id: variant.id,
      priceAed: Number(variant.priceAed || 0),
      condition: variant.condition,
      availability: variant.availability,
      shopName: variant.shopName,
      phone: variant.phone,
      location: variant.location,
      photoUrl: variant.photoUrl,
      photos: uniquePhotos(variant.photos || []),
      createdAt: variant.createdAt
    }))
  }))
  });
};

export const buildPublicQuoteLink = (order: Pick<Order, 'id' | 'brand' | 'model' | 'year'> | string, options?: BuildPublicQuoteLinkOptions) => {
  const slug = typeof order === 'string' ? encodeURIComponent(order) : encodeURIComponent(buildPublicQuoteSlug(order));
  const token = options?.snapshotToken || createQuoteToken();
  const url = new URL(window.location.origin);
  const params = new URLSearchParams();
  params.set('token', token);
  const expiresAt = Number(options?.expiresAt || (Date.now() + 72 * 60 * 60 * 1000));
  params.set('exp', String(expiresAt));
  if (typeof order !== 'string') {
    params.set('oid', order.id);
  }

  if (options?.rates) {
    params.set('rates', serializeQuoteRates(options.rates));
  }
  if (options?.currency) {
    params.set('currency', options.currency);
  }

  if (options?.embedSnapshotInUrl && options?.snapshot) {
    const encodedSnapshot = encodeSnapshot(options.snapshot);
    if (encodedSnapshot) params.set('data', encodedSnapshot);
  } else if (options?.embedSnapshotInUrl && typeof order !== 'string') {
    const encodedSnapshot = encodeSnapshot(buildQuoteSnapshot(order as Order));
    if (encodedSnapshot) params.set('data', encodedSnapshot);
  }

  url.hash = `#/q/${slug}?${params.toString()}`;
  return url.toString();
};

export const shareQuoteLink = async (order: Order, options?: BuildPublicQuoteLinkOptions) => {
  const settings = loadAppSettings();
  const persistentToken = (order.publicQuoteToken || '').trim() || undefined;
  const snapshot = await publicQuoteCreateSnapshot(order, {
    currency: options?.currency,
    exchangeRate: options?.rates?.[options?.currency || 'USD'],
    owner: {
      whatsappPhone: settings.publicWhatsappNumber,
      displayName: 'Dubai Spares CIS'
    },
    publicSettings: {
      publicWhatsappNumber: settings.publicWhatsappNumber,
      publicTelegramUrl: settings.publicTelegramUrl,
      publicInstagramUrl: settings.publicInstagramUrl,
      publicDeliveryTerms: settings.publicDeliveryTerms,
      publicWorkTerms: settings.publicWorkTerms,
      publicCompanyLogoUrl: settings.publicCompanyLogoUrl,
      publicInvoiceSignatureUrl: settings.publicInvoiceSignatureUrl,
      publicTermsFileUrl: settings.publicTermsFileUrl,
      publicTermsFileName: settings.publicTermsFileName,
      executorPhotoUrl: settings.executorPhotoUrl,
      executorRole: settings.executorRole
    },
    rates: options?.rates,
    ...(persistentToken ? { token: persistentToken, upsertByToken: true } : {})
  });
  const link = snapshot.url;
  const shareText = buildPublicQuoteShareMessage(order, link);

  if (navigator.share) {
    await navigator.share({
      title: `Смета для ${order.brand} ${order.model} ${order.year}`.trim(),
      text: shareText,
      url: link
    });
    return { method: 'native' as const, link, shareText, token: snapshot.token };
  }

  const copied = await copyToClipboard(shareText);
  if (copied) {
    return { method: 'clipboard' as const, link, shareText, token: snapshot.token };
  }

  await shareMessage(shareText);
  return { method: 'fallback' as const, link, shareText, token: snapshot.token };
};

export const copyToClipboard = async (text: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  const temp = document.createElement('textarea');
  temp.value = text;
  temp.setAttribute('readonly', '');
  temp.style.position = 'absolute';
  temp.style.left = '-9999px';
  document.body.appendChild(temp);
  temp.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(temp);
  return copied;
};
