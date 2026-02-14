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

export type OfferCondition = 'new' | 'used' | 'scrapyard';
export type OfferAvailability = 'in_stock' | '1d' | '2_3d' | 'by_order';
export type OfferDeliveryEta = 'today' | 'tomorrow' | '2_3_days' | 'week';
export type OfferSyncStatus = 'synced' | 'pending' | 'error';

export interface PriceVariant {
  id: string;
  partId?: string;
  priceAed: number;
  currency?: 'AED';
  condition?: OfferCondition;
  availability?: OfferAvailability;
  deliveryEta?: OfferDeliveryEta;
  shopName: string;
  shopId?: string;
  shopNameManual?: string;
  phone: string;
  location: string;
  locationText?: string;
  mapsUrl?: string;
  lat?: number;
  lng?: number;
  photoUrl?: string;
  photos?: string[];
  isBest?: boolean;
  syncStatus?: OfferSyncStatus;
  createdAt: number;
  updatedAt?: number;
}

export interface Part {
  id: string;
  orderId?: string;
  name: string;
  photoUrl?: string;
  photos?: string[];
  variants: PriceVariant[];
  isFound: boolean;
  status?: 'searching' | 'found' | 'not_found' | 'ordered';
  priority?: 'normal' | 'urgent';
  bestOfferId?: string;
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
  dismissedShopIds?: string[];
  leadUnread?: boolean;
  leadSource?: 'public_form' | 'manual';
  leadReadAt?: number;
  customerStatus?: 'VIP' | 'LEAD' | 'INQUIRY';
  statusChangedAt?: number;
  statusChangedBy?: string;
  priorityChangedAt?: number;
  markupType?: 'percent' | 'fixed';
  markupFixedAed?: number;
  useMarkupAsDefaultForNewParts?: boolean;
  clientCurrency?: 'AED' | 'USD' | 'RUB' | 'TJS';
  fxUpdatedAt?: number;
  logistics?: {
    deliveryType?: 'uae' | 'export';
    deliveryAed?: number;
    packingAed?: number;
    serviceFeeAed?: number;
  };
  pricingEvents?: OrderPricingEvent[];
}

export type PricingFieldKey =
  | 'markupType'
  | 'markupPercent'
  | 'markupFixedAed'
  | 'exchangeRate'
  | 'clientCurrency'
  | 'logistics.deliveryType'
  | 'logistics.deliveryAed'
  | 'logistics.packingAed'
  | 'logistics.serviceFeeAed';

export interface OrderPricingEvent {
  id: string;
  field: PricingFieldKey;
  label: string;
  previousValue: string;
  nextValue: string;
  createdAt: number;
}

export interface OrderNote {
  id: string;
  text: string;
  photos?: string[];
  audios?: string[];
  createdAt: number;
}

export type SupplierType = 'new_parts' | 'scrapyard' | 'engine_specialist' | 'body_parts' | 'electrical' | 'mixed' | 'dealer' | 'warehouse';
export type SupplierSyncStatus = 'synced' | 'pending_sync' | 'error';

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  location: string;
  type?: SupplierType;
  zone?: string;
  heatLevel?: number;
  brands: string[];
  mainBrands?: string[];
  primaryBrand?: string;
  models?: string[];
  years?: number[];
  bodyTypes?: string[];
  photoUrl?: string;
  photos?: string[];
  coordinates?: Coordinates;
  gpsAccuracyMeters?: number;
  workingHours?: string;
  trustLevel?: number;
  hasDelivery?: boolean;
  hasWhatsapp?: boolean;
  whatsappFast?: boolean;
  comment?: string;
  website?: string;
  foundCount?: number;
  notFoundCount?: number;
  wrongInfoCount?: number;
  successRate?: number;
  activityScore?: number;
  lastContactAt?: number;
  isFavorite?: boolean;
  createdAt?: number;
  updatedAt?: number;
  syncStatus?: SupplierSyncStatus;
  priority?: 'high' | 'medium' | 'low';
  status?: 'active' | 'dormant' | 'visited' | 'unknown';
}

export interface Shop {
  id: string;
  name: string;
  phone?: string;
  location?: string;
  latitude: number;
  longitude: number;
  type?: SupplierType;
  zone?: string;
  heatLevel?: number;
  needsManualFix?: boolean;
  mainBrands?: string[];
  specialization: string[];
  specializationTag?: string;
  specializationModels?: string[];
  specializationYears?: number[];
  specializationBodyTypes?: string[];
  businessHours?: Record<string, unknown>;
  businessHoursTimezone?: string;
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
  markup_type?: 'percent' | 'fixed';
  markup_fixed_aed?: number;
  use_markup_as_default_for_new_parts?: boolean;
  client_currency?: 'AED' | 'USD' | 'RUB' | 'TJS';
  fx_updated_at?: number | string | null;
  logistics?: {
    deliveryType?: 'uae' | 'export';
    deliveryAed?: number;
    packingAed?: number;
    serviceFeeAed?: number;
  };
  pricing_events?: OrderPricingEvent[];
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
  dismissed_shop_ids?: string[];
  lead_unread?: boolean;
  lead_source?: "public_form" | "manual";
  lead_read_at?: number | string | null;
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
  category?: 'errors' | 'warn' | 'info' | 'sync' | 'ui' | 'network';
  sessionId?: string;
  requestId?: string;
  orderId?: string;
}

export type RadarInteractionResult =
  | 'found'
  | 'not_found'
  | 'follow_up'
  | 'wrong_info'
  | 'message_sent'
  | 'visited'
  | 'route_opened'
  | 'called'
  | 'hidden';

export interface RadarInteraction {
  id: string;
  shopId: string;
  orderId: string;
  partId?: string;
  result: RadarInteractionResult;
  priceAed?: number;
  availability?: 'in_stock' | 'order';
  photoUrl?: string;
  comment?: string;
  createdAt: number;
  syncedAt?: number;
}
