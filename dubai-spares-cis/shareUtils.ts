import { Order, Part } from './types';

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

  if (!trimmed.includes('-')) return trimmed;
  const chunks = trimmed.split('-').filter(Boolean);
  return chunks[chunks.length - 1] || trimmed;
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

  return url.toString();
};

export const buildQuoteShareText = (order: Order, options?: BuildPublicQuoteLinkOptions) =>
  `Hello! We found the parts for your ${order.brand} ${order.model}. View details and prices here: ${buildPublicQuoteLink(order, options)}`;

export const shareQuoteLink = async (order: Order, options?: BuildPublicQuoteLinkOptions) => {
  const link = buildPublicQuoteLink(order, options);
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

  await shareMessage(buildQuoteShareText(order, options));
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
