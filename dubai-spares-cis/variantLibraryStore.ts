import { Order, PriceVariant } from './types';

const STANDALONE_VARIANTS_KEY = 'dubai_spares_standalone_variants';

export interface VariantLibraryItem extends PriceVariant {
  origin: 'order' | 'standalone';
  sourceOrderId?: string;
  sourcePartId?: string;
  sourcePartName?: string;
  sourceOrderLabel?: string;
  vehicleInfo?: string;
  customerOrderRef?: string;
}

let standaloneVariants: VariantLibraryItem[] = [];
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

const safeParse = (value: string | null): VariantLibraryItem[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeStandaloneVariant = (item: VariantLibraryItem): VariantLibraryItem => ({
  ...item,
  origin: 'standalone',
  sourceOrderId: undefined,
  sourcePartId: undefined,
  sourceOrderLabel: undefined,
  sourcePartName: typeof item.sourcePartName === 'string' ? item.sourcePartName.trim() : '',
  priceAed: Number.isFinite(Number(item.priceAed)) ? Number(item.priceAed) : 0,
  shopName: typeof item.shopName === 'string' ? item.shopName.trim() : '',
  phone: typeof item.phone === 'string' ? item.phone.trim() : '',
  location: typeof item.location === 'string' ? item.location.trim() : '',
  locationText: typeof item.locationText === 'string' ? item.locationText.trim() : '',
  mapsUrl: typeof item.mapsUrl === 'string' ? item.mapsUrl.trim() : '',
  vehicleInfo: typeof item.vehicleInfo === 'string' ? item.vehicleInfo.trim() : '',
  customerOrderRef: typeof item.customerOrderRef === 'string' ? item.customerOrderRef.trim() : '',
  photos: Array.isArray(item.photos) ? item.photos.filter(Boolean) : [],
  createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now(),
  updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : Date.now()
});

const persistStandaloneVariants = () => {
  localStorage.setItem(STANDALONE_VARIANTS_KEY, JSON.stringify(standaloneVariants));
  notify();
};

export const loadStandaloneVariants = () => {
  standaloneVariants = safeParse(localStorage.getItem(STANDALONE_VARIANTS_KEY)).map(normalizeStandaloneVariant);
  notify();
};

export const subscribeStandaloneVariants = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getStandaloneVariants = () => standaloneVariants;

export const upsertStandaloneVariant = (variant: VariantLibraryItem) => {
  const normalized = normalizeStandaloneVariant(variant);
  const exists = standaloneVariants.some((item) => item.id === normalized.id);
  standaloneVariants = exists
    ? standaloneVariants.map((item) => (item.id === normalized.id ? normalized : item))
    : [normalized, ...standaloneVariants];
  persistStandaloneVariants();
};

export const deleteStandaloneVariant = (variantId: string) => {
  standaloneVariants = standaloneVariants.filter((item) => item.id !== variantId);
  persistStandaloneVariants();
};

export const getVariantLibraryItems = (orders: Order[]): VariantLibraryItem[] => {
  const orderVariants: VariantLibraryItem[] = orders.flatMap((order) =>
    order.parts.flatMap((part) =>
      (part.variants || []).map((variant) => ({
        ...variant,
        origin: 'order' as const,
        sourceOrderId: order.id,
        sourcePartId: part.id,
        sourcePartName: part.name,
        sourceOrderLabel: `${order.brand} ${order.model} • ${order.vin}`,
        vehicleInfo: `${order.brand} ${order.model} • ${order.vin}`,
        customerOrderRef: order.id
      }))
    )
  );

  const combined = [...standaloneVariants, ...orderVariants];
  return combined.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
};

export const cloneVariantForPart = (variant: PriceVariant, partId: string): PriceVariant => ({
  ...variant,
  id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  partId,
  isBest: false,
  createdAt: Date.now(),
  updatedAt: Date.now()
});
