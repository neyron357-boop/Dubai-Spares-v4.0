import { Order, Part } from './types';

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

export const buildPublicQuoteLink = (order: Pick<Order, 'id' | 'brand' | 'model' | 'year'> | string) => {
  const slug = typeof order === 'string' ? order : buildPublicQuoteSlug(order);
  return `${window.location.origin}/quote/${slug}`;
};

export const buildQuoteShareText = (order: Order) =>
  `Hello! We found the parts for your ${order.brand} ${order.model}. View details and prices here: ${buildPublicQuoteLink(order)}`;

export const shareQuoteLink = async (order: Order) => {
  const link = buildPublicQuoteLink(order);
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

  await shareMessage(buildQuoteShareText(order));
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
