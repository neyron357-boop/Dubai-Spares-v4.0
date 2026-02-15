import { Order, Part } from './types';
import { supabase } from './supabase';
import { logSyncCategory, syncPerf } from './syncPerf';
import { markMissingColumn } from './syncSchema';

export type QuoteCurrency = 'AED' | 'USD' | 'RUB' | 'TJS';
export type QuoteRates = Record<QuoteCurrency, number>;

export const DEFAULT_QUOTE_RATES: QuoteRates = {
  AED: 1,
  USD: 3.67,
  RUB: 25,
  TJS: 2.98
};

const firstHttpPhoto = (images: string[]) => images.find((item) => item.startsWith('http'));

export const getShareText = (brand: string, partName: string, price: string, cloudLink: string) =>
  `Brand: ${brand} | Part: ${partName} | Price: ${price} | Photos: ${cloudLink}`;

const openShareFallback = (text: string) => {
  const encoded = encodeURIComponent(text);
  window.open(`https://wa.me/?text=${encoded}`, '_blank');
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

export const buildPublicQuoteSlug = (order: Pick<Order, 'id' | 'brand' | 'model' | 'year'>) => {
  const readable = slugify([order.brand, order.model, order.year].filter(Boolean).join(' '));
  return readable ? `${readable}--${order.id}` : order.id;
};

export const extractOrderIdFromQuoteSlug = (slugOrId: string) => {
  const trimmed = decodeURIComponent(slugOrId.trim().replace(/^\/+|\/+$/g, ''));
  const separated = trimmed.lastIndexOf('--');
  if (separated > -1) return trimmed.slice(separated + 2);

  const uuidAtEnd = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  if (uuidAtEnd) return uuidAtEnd[0];

  return trimmed;
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

const buildQuoteSnapshot = (order: Pick<Order,
  'id' | 'brand' | 'model' | 'year' | 'bodyType' | 'vin' | 'vinPhotoUrl' | 'carPhotoUrl' | 'carPhotos' |
  'markupType' | 'markupPercent' | 'markupFixedAed' | 'exchangeRate' | 'logistics' | 'pricingEvents' | 'parts'>) => ({
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
  logistics: order.logistics,
  pricingEvents: order.pricingEvents || [],
  parts: (order.parts || []).map((part) => ({
    id: part.id,
    name: part.name,
    isFound: !!part.isFound,
    photoUrl: part.photoUrl,
    photos: (part.photos || []).slice(0, 2),
    variants: (part.variants || []).map((variant) => ({
      id: variant.id,
      priceAed: Number(variant.priceAed || 0),
      condition: variant.condition,
      availability: variant.availability,
      shopName: variant.shopName,
      phone: variant.phone,
      location: variant.location,
      photoUrl: variant.photoUrl,
      photos: (variant.photos || []).slice(0, 2),
      createdAt: variant.createdAt
    }))
  }))
});

export const buildPublicQuoteLink = (order: Pick<Order, 'id' | 'brand' | 'model' | 'year'> | string, options?: BuildPublicQuoteLinkOptions) => {
  const slug = typeof order === 'string' ? order : buildPublicQuoteSlug(order);
  const url = new URL(`${window.location.origin}/quote/${slug}`);
  const canonicalOrderId = typeof order === 'string' ? extractOrderIdFromQuoteSlug(order) : order.id;
  url.searchParams.set('oid', canonicalOrderId);
  const expiresAt = Number(options?.expiresAt || (Date.now() + 72 * 60 * 60 * 1000));
  url.searchParams.set('token', createQuoteToken());
  url.searchParams.set('exp', String(expiresAt));

  if (options?.rates) {
    url.searchParams.set('rates', serializeQuoteRates(options.rates));
  }
  if (options?.currency) {
    url.searchParams.set('currency', options.currency);
  }

  if (options?.snapshotToken) {
    url.searchParams.set('snapshot', options.snapshotToken);
  }

  if (options?.embedSnapshotInUrl && options?.snapshot) {
    const encodedSnapshot = encodeSnapshot(options.snapshot);
    if (encodedSnapshot) url.searchParams.set('data', encodedSnapshot);
  } else if (options?.embedSnapshotInUrl && typeof order !== 'string') {
    const encodedSnapshot = encodeSnapshot(buildQuoteSnapshot(order as Order));
    if (encodedSnapshot) url.searchParams.set('data', encodedSnapshot);
  }

  return url.toString();
};

const saveQuoteSnapshot = async (order: Order, expiresAt: number, token: string) => {
  if (!supabase) return false;

  const snapshot = buildQuoteSnapshot(order);
  let payload: Record<string, unknown> = {
    token,
    order_id: order.id,
    expires_at: new Date(expiresAt).toISOString(),
    payload: snapshot
  };

  while (true) {
    const { error } = await supabase
      .from('public_quote_snapshots')
      .upsert(payload, { onConflict: 'token' });

    if (!error) return true;

    const message = String((error as { message?: unknown })?.message || '');
    const missingMatch = message.match(/Could not find the '([^']+)' column|column\s+public_quote_snapshots\.([a-zA-Z0-9_]+)/i);
    const missingColumn = missingMatch?.[1] || missingMatch?.[2];
    if (!missingColumn || !(missingColumn in payload)) {
      logSyncCategory('SUPABASE_REQ', 'public_quote_snapshot_failed', { message });
      return false;
    }

    const marked = markMissingColumn('public_quote_snapshots', missingColumn);
    if (marked) {
      syncPerf.addSchemaWarning(`public_quote_snapshots.${missingColumn}`);
      logSyncCategory('SCHEMA_MISMATCH', 'column_missing', { table: 'public_quote_snapshots', column: missingColumn });
    }

    const { [missingColumn]: _drop, ...rest } = payload;
    payload = rest;
    if (Object.keys(payload).length === 0) return false;
  }
};

export const shareQuoteLink = async (order: Order, options?: BuildPublicQuoteLinkOptions) => {
  const expiresAt = Number(options?.expiresAt || (Date.now() + 72 * 60 * 60 * 1000));
  const snapshotToken = createQuoteToken();
  const snapshotSaved = await saveQuoteSnapshot(order, expiresAt, snapshotToken);
  const link = buildPublicQuoteLink(order, {
    ...options,
    expiresAt,
    snapshotToken: snapshotSaved ? snapshotToken : undefined
  });
  const text = `Quote for ${order.brand} ${order.model} ${order.year}`;

  if (navigator.share) {
    await navigator.share({
      title: text,
      text,
      url: link
    });
    return { method: 'native' as const, link };
  }

  const copied = await copyToClipboard(link);
  if (copied) {
    return { method: 'clipboard' as const, link };
  }

  await shareMessage(`Hello! We found the parts for your ${order.brand} ${order.model}. View details and prices here: ${link}`);
  return { method: 'fallback' as const, link };
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
