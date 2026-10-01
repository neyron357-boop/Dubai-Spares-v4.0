import { calculateOrderTotals } from './utils/quotePricing';
import { Order, OrderStatus, SalesStatus, SearchDepositStatus } from './types';
import { normalizeGroupItems, normalizePartQuantity } from './utils/groupItems';
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const createUuid = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const ensureUuid = (value?: string) => (value && isUuid(value) ? value : createUuid());

const getStatus = (
  order: Pick<Order, 'isSold' | 'isArchived' | 'isVip' | 'isLead' | 'status'>,
): OrderStatus => {
  if (order.isSold) return 'sold';
  if (order.isArchived) return 'archive';
  if (order.isLead || order.status === 'lead') return 'lead';
  if (order.status === 'interest' || order.status === 'not_found') return order.status;
  if (order.isVip) return 'vip';
  if (
    order.status === 'new_inquiry' ||
    order.status === 'in_progress' ||
    order.status === 'waiting_deposit'
  )
    return order.status;
  return 'active';
};

const SALES_STATUS_ALIASES: Record<string, SalesStatus> = {
  inquiry: 'Inquiry',
  price_sent: 'Price Sent',
  pending_approval: 'Pending Approval',
  paid: 'Paid',
  completed: 'Completed',
};

const normalizeSalesStatus = (value: unknown): SalesStatus => {
  const raw = typeof value === 'string' ? value.trim() : '';
  const normalizedKey = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return SALES_STATUS_ALIASES[normalizedKey] || 'Inquiry';
};

const SEARCH_DEPOSIT_STATUSES: SearchDepositStatus[] = ['not_required', 'pending', 'paid'];

const normalizeSearchDepositStatus = (value: unknown): SearchDepositStatus =>
  SEARCH_DEPOSIT_STATUSES.includes(value as SearchDepositStatus)
    ? (value as SearchDepositStatus)
    : 'not_required';

const normalizeSupabaseStorageUrl = (url: string) => {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const publicMarker = '/storage/v1/object/public/';

    if (parsed.pathname.includes('/storage/v1/object/sign/')) {
      // Signed URLs may point to private buckets; never strip token or convert to public path.
      return parsed.toString();
    }

    if (parsed.pathname.includes(publicMarker)) {
      parsed.searchParams.delete('token');
      return parsed.toString();
    }

    return trimmed;
  } catch {
    return trimmed;
  }
};

const normalizePhotoKey = (url: string) => {
  const trimmed = normalizeSupabaseStorageUrl(url);
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.includes('/storage/v1/object/public/')) {
      parsed.searchParams.delete('width');
      parsed.searchParams.delete('quality');
      parsed.searchParams.delete('format');
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
};

const normalizePhotoList = (photos: string[] = []): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  photos.forEach((photo) => {
    const value = String(photo || '').trim();
    if (!value) return;
    const key = normalizePhotoKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    normalized.push(key);
  });
  return normalized;
};

const estimateOrderProfitUsd = (order: Order): number => {
  const totals = calculateOrderTotals(order);
  const purchaseAed = totals.lines.reduce(
    (sum, line) =>
      sum + Number(line.variant.purchasePriceAed ?? line.variant.priceAed ?? 0) * line.quantity,
    0,
  );
  return (
    (totals.partsTotalAed - totals.discountAed - purchaseAed) / (Number(order.exchangeRate) || 3.67)
  );
};

const normalizeContactLinks = (raw: unknown): Order['contactLinks'] | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const asText = (...values: unknown[]) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };

  const normalized: NonNullable<Order['contactLinks']> = {
    phone: asText(src.phone),
    instagramUrl: asText(src.instagramUrl, src.instagram_url),
    tiktokUrl: asText(src.tiktokUrl, src.tiktok_url),
    facebookUrl: asText(src.facebookUrl, src.facebook_url),
    telegramUrl: asText(src.telegramUrl, src.telegram_url),
  };

  if (!Object.values(normalized).some(Boolean)) return undefined;
  return normalized;
};

export const normalizeOrder = (order: Order): Order => {
  const salesStatus = normalizeSalesStatus(order.salesStatus);
  const isCompleted = salesStatus === 'Completed';
  const isSold = order.isSold || isCompleted;

  const carPhotos = normalizePhotoList(order.carPhotos || [order.carPhotoUrl || '']);
  const notes = Array.isArray(order.notes)
    ? order.notes.map((note) => ({ ...note, photos: normalizePhotoList(note.photos || []) }))
    : [];
  const parts = Array.isArray(order.parts)
    ? order.parts.map((part) => {
        const partPhotos = normalizePhotoList(part.photos || [part.photoUrl || '']);
        const variants = Array.isArray(part.variants)
          ? part.variants.map((variant) => {
              const variantPhotos = normalizePhotoList(variant.photos || [variant.photoUrl || '']);
              return {
                ...variant,
                purchasePriceAed: Number(variant.purchasePriceAed ?? variant.priceAed ?? 0),
                salePriceAed: Number(variant.salePriceAed ?? variant.priceAed ?? 0),
                priceAed: Number(variant.salePriceAed ?? variant.priceAed ?? 0),
                photos: variantPhotos,
                photoUrl: variantPhotos[0] || '',
              };
            })
          : [];
        const groupItems = Array.isArray((part as any).groupItems)
          ? normalizeGroupItems((part as any).groupItems)
          : [];
        const partKind: 'single' | 'group' =
          (part as any).partKind === 'group' ? 'group' : 'single';
        return {
          ...part,
          quantity: normalizePartQuantity((part as any).quantity),
          comment: String(part.comment || ''),
          googleDriveVideoUrl:
            typeof (part as any).googleDriveVideoUrl === 'string'
              ? (part as any).googleDriveVideoUrl.trim()
              : '',
          partKind,
          groupItems,
          photos: partPhotos,
          photoUrl: partPhotos[0] || '',
          variants,
        };
      })
    : [];

  return {
    ...order,
    status: getStatus({ ...order, isSold, isArchived: order.isArchived || isCompleted }),
    searchDepositStatus: normalizeSearchDepositStatus(order.searchDepositStatus),
    salesStatus,
    isSold,
    isArchived: order.isArchived || isCompleted,
    soldProfitUsd: isSold
      ? (order.soldProfitUsd ?? estimateOrderProfitUsd(order))
      : order.soldProfitUsd,
    isVip: !!order.isVip,
    isPinned: !!order.isPinned,
    isLead: !!order.isLead,
    notes,
    carPhotos,
    carPhotoUrl: carPhotos[0] || '',
    vinPhotoUrl: order.vinPhotoUrl || '',
    googleDriveFolderUrl:
      typeof order.googleDriveFolderUrl === 'string' ? order.googleDriveFolderUrl.trim() : '',
    bodyType: order.bodyType || '',
    parts,
    discountType: order.discountType === 'fixed' ? 'fixed' : 'percent',
    discountPercent: Number.isFinite(Number(order.discountPercent))
      ? Number(order.discountPercent)
      : 0,
    discountFixedAed: Number.isFinite(Number(order.discountFixedAed))
      ? Number(order.discountFixedAed)
      : 0,
    updatedAt: order.updatedAt ?? order.createdAt ?? Date.now(),
    recommendedShopIds: Array.isArray(order.recommendedShopIds) ? order.recommendedShopIds : [],
    dismissedShopIds: Array.isArray(order.dismissedShopIds) ? order.dismissedShopIds : [],
    leadUnread: order.leadUnread === true,
    leadSource: order.leadSource === 'public_form' ? 'public_form' : 'manual',
    leadReadAt: Number.isFinite(Number(order.leadReadAt)) ? Number(order.leadReadAt) : undefined,
    pricingEvents: Array.isArray(order.pricingEvents) ? order.pricingEvents : [],
    contactLinks: normalizeContactLinks(order.contactLinks),
    vendorContacts: Array.isArray(order.vendorContacts)
      ? order.vendorContacts
          .filter(
            (item): item is NonNullable<Order['vendorContacts']>[number] =>
              !!item && typeof item === 'object',
          )
          .map((item): NonNullable<Order['vendorContacts']>[number] => ({
            id: typeof item.id === 'string' && item.id.trim().length > 0 ? item.id : ensureUuid(),
            name: typeof item.name === 'string' ? item.name.trim() : '',
            phone: typeof item.phone === 'string' ? item.phone.trim() : '',
            whatsapp: typeof item.whatsapp === 'string' ? item.whatsapp.trim() : '',
            mapUrl: typeof item.mapUrl === 'string' ? item.mapUrl.trim() : '',
            note: typeof item.note === 'string' ? item.note.trim() : '',
            orderStatus:
              item.orderStatus === 'found' ||
              item.orderStatus === 'not_found' ||
              item.orderStatus === 'visit_required' ||
              item.orderStatus === 'awaiting_reply' ||
              item.orderStatus === 'ordered' ||
              item.orderStatus === 'other'
                ? item.orderStatus
                : 'searching',
            statusNote: typeof item.statusNote === 'string' ? item.statusNote.trim() : '',
            statusUpdatedAt: Number.isFinite(Number(item.statusUpdatedAt))
              ? Number(item.statusUpdatedAt)
              : undefined,
            createdAt: Number.isFinite(Number(item.createdAt))
              ? Number(item.createdAt)
              : Date.now(),
            updatedAt: Number.isFinite(Number(item.updatedAt))
              ? Number(item.updatedAt)
              : Date.now(),
          }))
          .filter((item) => item.name.length > 0)
      : [],
    vendorChecklist: Array.isArray(order.vendorChecklist)
      ? order.vendorChecklist
          .filter(
            (item): item is NonNullable<Order['vendorChecklist']>[number] =>
              !!item && typeof item === 'object',
          )
          .map((item): NonNullable<Order['vendorChecklist']>[number] => ({
            id: typeof item.id === 'string' && item.id.trim().length > 0 ? item.id : ensureUuid(),
            text: typeof item.text === 'string' ? item.text.trim() : '',
            completed: item.completed === true,
            source: item.source === 'order' ? 'order' : 'default',
            updatedAt: Number.isFinite(Number(item.updatedAt))
              ? Number(item.updatedAt)
              : Date.now(),
          }))
          .filter((item) => item.text.length > 0)
      : [],
    vehicleDetails:
      order.vehicleDetails && typeof order.vehicleDetails === 'object'
        ? {
            engineType:
              typeof order.vehicleDetails.engineType === 'string'
                ? order.vehicleDetails.engineType.trim()
                : '',
            fuelType:
              typeof order.vehicleDetails.fuelType === 'string'
                ? order.vehicleDetails.fuelType.trim()
                : '',
            drivetrain:
              order.vehicleDetails.drivetrain === 'fwd' ||
              order.vehicleDetails.drivetrain === 'rwd' ||
              order.vehicleDetails.drivetrain === 'awd' ||
              order.vehicleDetails.drivetrain === '4wd'
                ? order.vehicleDetails.drivetrain
                : undefined,
            transmission:
              order.vehicleDetails.transmission === 'automatic' ||
              order.vehicleDetails.transmission === 'manual' ||
              order.vehicleDetails.transmission === 'cvt' ||
              order.vehicleDetails.transmission === 'dct' ||
              order.vehicleDetails.transmission === 'other'
                ? order.vehicleDetails.transmission
                : undefined,
            transmissionCode:
              typeof order.vehicleDetails.transmissionCode === 'string'
                ? order.vehicleDetails.transmissionCode.trim()
                : '',
            engineDisplacement:
              typeof order.vehicleDetails.engineDisplacement === 'string'
                ? order.vehicleDetails.engineDisplacement.trim()
                : '',
            engineCode:
              typeof order.vehicleDetails.engineCode === 'string'
                ? order.vehicleDetails.engineCode.trim()
                : '',
            trimLevel:
              typeof order.vehicleDetails.trimLevel === 'string'
                ? order.vehicleDetails.trimLevel.trim()
                : '',
            marketRegion:
              order.vehicleDetails.marketRegion === 'china' ||
              order.vehicleDetails.marketRegion === 'japan' ||
              order.vehicleDetails.marketRegion === 'usa' ||
              order.vehicleDetails.marketRegion === 'europe' ||
              order.vehicleDetails.marketRegion === 'gcc' ||
              order.vehicleDetails.marketRegion === 'other'
                ? order.vehicleDetails.marketRegion
                : undefined,
            steeringSide:
              order.vehicleDetails.steeringSide === 'left' ||
              order.vehicleDetails.steeringSide === 'right'
                ? order.vehicleDetails.steeringSide
                : undefined,
            doors:
              typeof order.vehicleDetails.doors === 'string'
                ? order.vehicleDetails.doors.trim()
                : '',
            color:
              typeof order.vehicleDetails.color === 'string'
                ? order.vehicleDetails.color.trim()
                : '',
            additionalNotes:
              typeof order.vehicleDetails.additionalNotes === 'string'
                ? order.vehicleDetails.additionalNotes.trim()
                : '',
          }
        : undefined,
  };
};
