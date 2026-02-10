export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH'
}

export enum Source {
  INSTAGRAM = 'Instagram',
  TIKTOK = 'TikTok',
  FACEBOOK = 'Facebook',
  TELEGRAM = 'Telegram',
  WHATSAPP = 'WhatsApp',
  OTHER = 'Другое'
}

export type OrderStatus = 'active' | 'archive' | 'sold' | 'vip' | 'lead' | 'new_inquiry' | 'in_progress';
export type SalesStatus = 'Inquiry' | 'Price Sent' | 'Pending Approval' | 'Paid' | 'Completed';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface PriceVariant {
  id: string;
  priceAed: number;
  shopName: string;
  phone: string;
  location: string;
  partId?: string;
  photoUrl?: string;
  photos?: string[];
  createdAt: number;
}

export interface Part {
  id: string;
  orderId?: string;
  name: string;
  photoUrl?: string;
  photos?: string[];
  variants: PriceVariant[];
  isFound: boolean;
}

export interface Order {
  id: string;
  brand: string;
  model: string;
  year: string;
  bodyType?: string;
  vin: string;
  vinPhotoUrl?: string;
  status?: OrderStatus;
  priority: Priority;
  clientName: string;
  source: Source;
  carPhotoUrl?: string;
  carPhotos?: string[];
  parts: Part[];
  markupPercent: number;
  exchangeRate: number;
  createdAt: number;
  isArchived: boolean;
  isSold: boolean;
  soldProfitUsd?: number;
  isVip?: boolean;
  isPinned?: boolean;
  isLead?: boolean;
  localOnlyPhotos?: boolean;
  notes?: OrderNote[];
  salesStatus?: SalesStatus;
  customerContact?: string;
  socialNickname?: string;
  updatedAt?: number;
  recommendedShopIds?: string[];
}

export interface OrderNote {
  id: string;
  text: string;
  photos?: string[];
  audios?: string[];
  createdAt: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  location: string;
  brands: string[];
  models?: string[];
  years?: number[];
  bodyTypes?: string[];
  photoUrl?: string;
  photos?: string[];
  coordinates?: Coordinates;
}

export interface Shop {
  id: string;
  name: string;
  phone?: string;
  location?: string;
  latitude: number;
  longitude: number;
  needsManualFix?: boolean;
  specialization: string[];
  specializationModels?: string[];
  specializationYears?: number[];
  specializationBodyTypes?: string[];
}

export interface DbPriceVariantRow {
  id: string;
  part_id: string;
  price_aed: number;
  shop_name: string;
  phone: string;
  location: string;
  photo_url: string | null;
  photos: string[];
  created_at: number | string;
}

export interface DbPartRow {
  id: string;
  order_id: string;
  name: string;
  photo_url: string | null;
  photos: string[];
  is_found: boolean;
  price_variants?: DbPriceVariantRow[];
}

export interface DbOrderRow {
  id: string;
  brand: string;
  model: string;
  year: string;
  body_type?: string | null;
  vin: string;
  vin_photo_url?: string | null;
  status: OrderStatus;
  priority: Priority;
  client_name: string;
  source: Source;
  car_photo_url: string | null;
  car_photos: string[];
  markup_percent: number;
  exchange_rate: number;
  created_at: number | string;
  is_archived: boolean;
  is_sold: boolean;
  sold_profit_usd: number | null;
  is_vip: boolean;
  is_pinned: boolean;
  is_lead: boolean;
  notes: OrderNote[];
  sales_status?: SalesStatus;
  customer_contact?: string;
  social_nickname?: string;
  updated_at?: number | string;
  recommended_shop_ids?: string[];
}

export interface DbOrderGraphRow extends DbOrderRow {
  parts?: DbPartRow[];
}

export type SystemLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SystemLogEntry {
  id: string;
  level: SystemLogLevel;
  scope: string;
  message: string;
  meta?: unknown;
  createdAt: number;
}
