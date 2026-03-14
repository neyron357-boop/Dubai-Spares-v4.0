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
  isFavorite?: boolean;
  isPinned?: boolean;
  syncStatus?: OfferSyncStatus;
  note?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface Part {
  id: string;
  orderId?: string;
  name: string;
  quantity?: number;
  comment?: string;
  partKind?: 'single' | 'group';
  groupItems?: Array<string | { id?: string; name?: string; quantity?: number }>;
  photoUrl?: string;
  photos?: string[];
  variants: PriceVariant[];
  isFound: boolean;
  status?: 'searching' | 'found' | 'not_found' | 'ordered';
  priority?: 'normal' | 'urgent';
  bestOfferId?: string;
  partType?: string;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  places?: number;
  cargoPlaceGroup?: string;
  isOversized?: boolean;
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
  locationZone?: string;       // e.g. 'Area2', 'Area3', 'Area4', 'Area6', 'Area8', 'Dubai', 'Online'
  isUrgent?: boolean;
  nextStep?: string;
  offerSentAt?: number;        // timestamp (ms) when salesStatus became 'Price Sent'
  purchasePriceAed?: number;   // purchase cost AED
  clientPriceAed?: number;     // price offered to client AED
  paidStatus?: 'unpaid' | 'partial' | 'paid';
  isLead?: boolean;
  localOnlyPhotos?: boolean;
  notes?: OrderNote[];
  salesStatus?: SalesStatus;
  customerContact?: string;
  socialNickname?: string;
  contactLinks?: {
    phone?: string;
    instagramUrl?: string;
    tiktokUrl?: string;
    facebookUrl?: string;
    telegramUrl?: string;
  };
  whatsappTemplateLanguage?: 'ru' | 'en' | 'ar';
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
    cargoCountry?: string;
    cargoDeliveryType?: 'air' | 'express_air' | 'container';
    cargoEtaDays?: string;
    cargoTotalWeightKg?: number;
    cargoChargeableWeightKg?: number;
    cargoVolumeCbm?: number;
    cargoTotalPlaces?: number;
    cargoBaseCostUsd?: number;
    cargoTotalCostUsd?: number;
    cargoAirEtaDays?: string;
    cargoAirCostUsd?: number;
    cargoContainerEtaDays?: string;
    cargoContainerCostUsd?: number;
    additionalCostsUsd?: {
      packagingUsd?: number;
      insuranceUsd?: number;
      customsUsd?: number;
      cityDeliveryUsd?: number;
    };
  };
  pricingEvents?: OrderPricingEvent[];
  vendorContacts?: OrderVendorContact[];
  vendorChecklist?: VendorChecklistItem[];
  vehicleDetails?: VehicleDetails;
}

export interface VehicleDetails {
  engineType?: string;
  fuelType?: string;
  drivetrain?: 'fwd' | 'rwd' | 'awd' | '4wd';
  transmission?: 'automatic' | 'manual' | 'cvt' | 'dct' | 'other';
  transmissionCode?: string;
  engineDisplacement?: string;
  engineCode?: string;
  trimLevel?: string;
  marketRegion?: 'china' | 'japan' | 'usa' | 'europe' | 'gcc' | 'other';
  steeringSide?: 'left' | 'right';
  doors?: string;
  color?: string;
  additionalNotes?: string;
}

export interface OrderVendorContact {
  id: string;
  name: string;
  phone?: string;
  whatsapp?: string;
  mapUrl?: string;
  note?: string;
  orderStatus?: 'searching' | 'found' | 'not_found' | 'visit_required' | 'awaiting_reply' | 'ordered' | 'other';
  statusNote?: string;
  statusUpdatedAt?: number;
  lastWhatsappAt?: number;
  whatsappMessageCount?: number;
  createdAt: number;
  updatedAt?: number;
}

export interface VendorChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  source?: 'default' | 'order';
  updatedAt: number;
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
  | 'logistics.serviceFeeAed'
  | 'logistics.cargoCountry'
  | 'logistics.cargoDeliveryType'
  | 'logistics.cargoTotalCostUsd';

export interface OrderPricingEvent {
  id: string;
  field: PricingFieldKey;
  label: string;
  previousValue: string;
  nextValue: string;
  createdAt: number;
}

export interface VoiceNoteAudio {
  id: string;
  fileUrl: string;
  duration: number;
  createdAt: number;
  author: string;
}

export interface OrderNote {
  id: string;
  text: string;
  photos?: string[];
  audios?: Array<string | VoiceNoteAudio>;
  createdAt: number;
}

export type SupplierType = 'new_parts' | 'scrapyard' | 'engine_specialist' | 'body_parts' | 'electrical' | 'mixed' | 'dealer' | 'warehouse';
export type SupplierSyncStatus = 'synced' | 'pending_sync' | 'error';
export type SupplierLinkedPartStatus = 'searching' | 'found' | 'not_found' | 'follow_up';
export type SupplierStatus = 'new' | 'contacted' | 'responded' | 'visited' | 'verified' | 'trusted' | 'blacklist';
export type SupplierInteractionType = 'whatsapp' | 'whatsapp_reply' | 'call' | 'visit' | 'price_request' | 'order' | 'problem';

export interface SupplierInteraction {
  id: string;
  supplierId: string;
  type: SupplierInteractionType;
  date: number;
  note: string;
  createdAt: number;
}

export interface SupplierLinkedPartEntry {
  id: string;
  orderId: string;
  orderLabel: string;
  partId: string;
  partName: string;
  status: SupplierLinkedPartStatus;
  priceAed?: number;
  source?: 'manual' | 'variant';
  updatedAt: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  location: string;
  type?: SupplierType;
  types?: SupplierType[];
  zone?: string;
  heatLevel?: number;
  brands: string[];
  mainBrands?: string[];
  primaryBrand?: string;
  models?: string[];
  years?: number[];
  bodyTypes?: string[];
  mainPartCategories?: string[];
  photoUrl?: string;
  photos?: string[];
  coordinates?: Coordinates;
  gpsAccuracyMeters?: number;
  workingHours?: string;
  trustLevel?: number;
  autoTrustScore?: number;
  hasDelivery?: boolean;
  hasWhatsapp?: boolean;
  whatsappFast?: boolean;
  whatsapp?: string;
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
  radarCount?: number;
  activeOrderIds?: string[];
  linkedParts?: SupplierLinkedPartEntry[];
  supplierStatus?: SupplierStatus;
  interactions?: SupplierInteraction[];
  shopPhotos?: string[];
  supplierScore?: number;
  internalNotes?: string;
  lastVisitedAt?: number;
  lastRespondedAt?: number;
  ordersCompleted?: number;
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
  shop_id?: string | null;
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
  quantity?: number | null;
  comment?: string | null;
  photo_url: string | null;
  photos: string[];
  is_found: boolean;
  weight_kg?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  places?: number | null;
  is_oversized?: boolean | null;
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
    cargoCountry?: string;
    cargoDeliveryType?: 'air' | 'express_air' | 'container';
    cargoEtaDays?: string;
    cargoTotalWeightKg?: number;
    cargoChargeableWeightKg?: number;
    cargoVolumeCbm?: number;
    cargoTotalPlaces?: number;
    cargoBaseCostUsd?: number;
    cargoTotalCostUsd?: number;
    cargoAirEtaDays?: string;
    cargoAirCostUsd?: number;
    cargoContainerEtaDays?: string;
    cargoContainerCostUsd?: number;
    additionalCostsUsd?: {
      packagingUsd?: number;
      insuranceUsd?: number;
      customsUsd?: number;
      cityDeliveryUsd?: number;
    };
  };
  pricing_events?: OrderPricingEvent[];
  vendor_contacts?: OrderVendorContact[];
  vendor_checklist?: VendorChecklistItem[];
  vehicle_details?: VehicleDetails;
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
  customer_status?: 'VIP' | 'LEAD' | 'INQUIRY' | null;
  customer_contact?: string;
  social_nickname?: string;
  contact_links?: {
    phone?: string;
    instagram_url?: string;
    tiktok_url?: string;
    facebook_url?: string;
    telegram_url?: string;
  };
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
  mode?: 'regular' | 'absolute';
  source?: 'app' | 'browser-console' | 'browser-runtime' | 'server-event';
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
