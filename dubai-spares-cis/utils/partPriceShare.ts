import { Order, Part, PriceVariant } from '../types';

const COMPANY_LOGO_PATH = '/icon-192.png';
const formatPrice = (price: number) => `${new Intl.NumberFormat('ru-RU').format(Number(price || 0))} AED`;

type ShareablePart = {
  part: Part;
  variant: PriceVariant;
};

const loadCanvasImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  if (!src.startsWith('data:')) image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Image load failed'));
  image.src = src;
});

const getPartPhotos = (part: Part, variant?: PriceVariant) => {
  const merged = [
    ...(variant?.photos || []),
    variant?.photoUrl || '',
    ...(part.photos || []),
    part.photoUrl || ''
  ]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(merged));
};

export const resolveBestVariant = (part: Part) => {
  if (!Array.isArray(part.variants) || part.variants.length === 0) return null;
  if (part.bestOfferId) {
    const best = part.variants.find((variant) => variant.id === part.bestOfferId);
    if (best && Number(best.priceAed) > 0) return best;
  }
  const priced = part.variants.filter((variant) => Number(variant.priceAed) > 0);
  if (priced.length > 0) {
    return [...priced].sort((a, b) => Number(a.priceAed) - Number(b.priceAed))[0];
  }
  return part.variants[0] || null;
};

const drawCoverPhoto = async (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, sources: string[]) => {
  context.fillStyle = '#E9EEF6';
  context.fillRect(x, y, width, height);
  const firstPhoto = sources[0];
  if (!firstPhoto) {
    context.fillStyle = '#94A3B8';
    context.font = 'bold 28px Inter, Arial, sans-serif';
    context.fillText('Нет фото детали', x + 36, y + height / 2);
    return;
  }

  try {
    const photo = await loadCanvasImage(firstPhoto);
    const ratio = Math.max(width / photo.width, height / photo.height);
    const drawW = photo.width * ratio;
    const drawH = photo.height * ratio;
    const drawX = x + (width - drawW) / 2;
    const drawY = y + (height - drawH) / 2;
    context.drawImage(photo, drawX, drawY, drawW, drawH);
  } catch {
    context.fillStyle = '#94A3B8';
    context.font = 'bold 28px Inter, Arial, sans-serif';
    context.fillText('Фото недоступно', x + 24, y + height / 2);
  }
};

const drawLogo = async (context: CanvasRenderingContext2D) => {
  try {
    const logo = await loadCanvasImage(COMPANY_LOGO_PATH);
    context.drawImage(logo, 40, 34, 74, 74);
  } catch {
    context.fillStyle = '#2563EB';
    context.fillRect(40, 34, 74, 74);
    context.fillStyle = '#FFFFFF';
    context.font = 'bold 14px Inter, Arial, sans-serif';
    context.fillText('LOGO', 57, 77);
  }
};

const drawOrderHeader = async (context: CanvasRenderingContext2D, order: Order, title: string, subtitle: string) => {
  await drawLogo(context);
  context.fillStyle = '#0F1728';
  context.font = '700 30px Inter, Arial, sans-serif';
  context.fillText(title.slice(0, 42), 132, 64);
  context.fillStyle = '#475569';
  context.font = '500 18px Inter, Arial, sans-serif';
  context.fillText(subtitle.slice(0, 72), 132, 94);
  context.fillStyle = '#64748B';
  context.font = '500 16px Inter, Arial, sans-serif';
  const vinLabel = order.vin ? `VIN: ${order.vin}` : 'VIN: —';
  context.fillText(vinLabel.slice(0, 64), 40, 132);
};

const createCanvasBlob = async (canvas: HTMLCanvasElement) => await new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (!blob) {
      reject(new Error('Не удалось сформировать изображение'));
      return;
    }
    resolve(blob);
  }, 'image/png', 0.95);
});

export const generatePartPriceCard = async (order: Order, part: Part, variant: PriceVariant) => {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 720;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas недоступен');

  context.fillStyle = '#F3F6FB';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#FFFFFF';
  context.fillRect(20, 20, canvas.width - 40, canvas.height - 40);

  await drawOrderHeader(context, order, part.name || 'Деталь', `${order.brand} ${order.model} · ${order.year || '—'}`);
  await drawCoverPhoto(context, 40, 170, 460, 470, getPartPhotos(part, variant));

  const startX = 550;
  context.fillStyle = '#2563EB';
  context.font = '700 62px Inter, Arial, sans-serif';
  context.fillText(formatPrice(variant.priceAed), startX, 242);

  context.fillStyle = '#334155';
  context.font = '600 28px Inter, Arial, sans-serif';
  context.fillText(`Поставщик: ${(variant.shopName || '—').slice(0, 34)}`, startX, 320);
  context.fillText(`Наличие: ${variant.availability || '—'}`, startX, 370);
  context.fillText(`Состояние: ${variant.condition || '—'}`, startX, 420);

  context.fillStyle = '#64748B';
  context.font = '500 22px Inter, Arial, sans-serif';
  const locationLine = variant.locationText || variant.location || 'Локация не указана';
  context.fillText(`Локация: ${locationLine}`.slice(0, 48), startX, 484);
  if (part.comment?.trim()) context.fillText(`Комментарий: ${part.comment}`.slice(0, 48), startX, 528);

  return createCanvasBlob(canvas);
};

export const generatePartsPriceSheet = async (order: Order, entries: ShareablePart[]) => {
  const safeEntries = entries.slice(0, 6);
  const rowHeight = 220;
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 180 + safeEntries.length * rowHeight + 40;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas недоступен');

  context.fillStyle = '#F3F6FB';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#FFFFFF';
  context.fillRect(20, 20, canvas.width - 40, canvas.height - 40);

  await drawOrderHeader(context, order, 'Подбор деталей', `${order.brand} ${order.model} · ${safeEntries.length} поз.`);

  for (const [index, entry] of safeEntries.entries()) {
    const top = 160 + index * rowHeight;
    context.fillStyle = '#F8FAFC';
    context.fillRect(40, top, canvas.width - 80, rowHeight - 20);
    await drawCoverPhoto(context, 60, top + 20, 180, 150, getPartPhotos(entry.part, entry.variant));

    context.fillStyle = '#0F1728';
    context.font = '700 28px Inter, Arial, sans-serif';
    context.fillText((entry.part.name || 'Деталь').slice(0, 42), 270, top + 62);

    context.fillStyle = '#2563EB';
    context.font = '700 38px Inter, Arial, sans-serif';
    context.fillText(formatPrice(entry.variant.priceAed), 270, top + 116);

    context.fillStyle = '#475569';
    context.font = '500 20px Inter, Arial, sans-serif';
    context.fillText(`Поставщик: ${(entry.variant.shopName || '—').slice(0, 42)}`, 270, top + 154);
    const locationLine = entry.variant.locationText || entry.variant.location || 'Локация не указана';
    context.fillText(`Локация: ${locationLine}`.slice(0, 58), 270, top + 184);
  }

  return createCanvasBlob(canvas);
};

export const shareGeneratedPriceImage = async (blob: Blob, fileName: string, title: string, text: string) => {
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title, text, files: [file] });
    return 'shared';
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
};
