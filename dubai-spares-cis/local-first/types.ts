export const LOCAL_DB_NAME = 'dubai-spares-local';
export const LOCAL_DB_VERSION = 1;

export const STORE_NAMES = {
  orders: 'orders',
  parts: 'parts',
  priceVariants: 'priceVariants',
  suppliers: 'suppliers',
  photos: 'photos',
  photoLinks: 'photoLinks',
  meta: 'meta'
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

export type OrderStatus = 'new' | 'in_progress' | 'done' | 'canceled';
export type Currency = 'AED' | 'USD' | 'EUR';
export type PriceCondition = 'new' | 'used';
export type PhotoMimeType = 'image/jpeg' | 'image/webp';
export type PhotoEntityType = 'order' | 'part';

export interface LocalOrder {
  id: string;
  createdAt: string;
  updatedAt: string;
  customerName?: string;
  customerPhone?: string;
  carBrand?: string;
  carModel?: string;
  vin?: string;
  status: OrderStatus;
  note?: string;
}

export interface LocalPart {
  id: string;
  orderId: string;
  name: string;
  oemNumber?: string;
  qty: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalPriceVariant {
  id: string;
  partId: string;
  supplierId?: string;
  price: number;
  currency: Currency;
  deliveryDays?: number;
  condition?: PriceCondition;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalSupplier {
  id: string;
  name: string;
  phone?: string;
  whatsapp?: string;
  city?: string;
  rating?: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalPhoto {
  id: string;
  mimeType: PhotoMimeType;
  blob: Blob;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: string;
}

export interface LocalPhotoLink {
  id: string;
  photoId: string;
  entityType: PhotoEntityType;
  entityId: string;
  label?: string;
  createdAt: string;
}

export interface LocalMetaRecord {
  key: string;
  value: unknown;
}

export interface LocalFirstBackupPhoto {
  id: string;
  mimeType: PhotoMimeType;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: string;
  base64: string;
}

export interface LocalFirstBackupData {
  orders: LocalOrder[];
  parts: LocalPart[];
  priceVariants: LocalPriceVariant[];
  suppliers: LocalSupplier[];
  photos: LocalFirstBackupPhoto[];
  photoLinks: LocalPhotoLink[];
  meta: LocalMetaRecord[];
}

export interface LocalFirstBackupFile {
  backupVersion: 1;
  app: 'dubai-spares-local';
  createdAt: string;
  schemaVersion: number;
  data: LocalFirstBackupData;
}

export interface LocalStoreStatistics {
  orders: number;
  parts: number;
  priceVariants: number;
  suppliers: number;
  photos: number;
  photoLinks: number;
  meta: number;
}

export const REQUIRED_BACKUP_STORES: Array<keyof LocalFirstBackupData> = [
  'orders',
  'parts',
  'priceVariants',
  'suppliers',
  'photos',
  'photoLinks',
  'meta'
];
