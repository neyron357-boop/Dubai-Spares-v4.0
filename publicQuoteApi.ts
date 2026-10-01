import { QuoteRates } from './shareUtils';
import type { ChatAttachment, Order } from './types';
import { normalizeGroupItems } from './utils/groupItems';
import { calculateOrderTotals } from './utils/quotePricing';
export type PublicQuotePayloadV1 = {
  version: 'public_quote_payload_v1';
  created_at: string;
  order: {
    id: string;
    brand: string;
    model: string;
    year: string;
    vin: string;
    client_name?: string;
    customerContact?: string;
    customer_contact?: string;
    socialNickname?: string;
    social_nickname?: string;
    carPhotoUrl?: string;
    car_photo_url?: string;
    carPhotos?: string[];
    car_photos?: string[];
    vinPhotoUrl?: string;
    vin_photo_url?: string;
    body_type?: string;
    photo_omitted_notice?: string;
    markupType?: string;
    markup_type?: string;
    markupFixedAed?: number;
    markup_fixed_aed?: number;
    markupPercent?: number;
    markup_percent?: number;
    discountType?: string;
    discount_type?: string;
    discountFixedAed?: number;
    discount_fixed_aed?: number;
    discountPercent?: number;
    discount_percent?: number;
    searchDepositAmount?: number;
    searchDepositCurrency?: string;
    searchDepositExchangeRate?: number;
    searchDepositAmountAed?: number;
    searchDepositPaidAt?: number | null;
    search_deposit_amount?: number;
    search_deposit_currency?: string;
    search_deposit_exchange_rate?: number;
    search_deposit_amount_aed?: number;
    search_deposit_paid_at?: number | null;
    googleDriveFolderUrl?: string;
    google_drive_folder_url?: string;
  };
  pricing: {
    currency: string;
    fx_rate: number;
    rates?: Record<string, number>;
  };
  totals: {
    parts_sum_aed: number;
    logistics_aed: number;
    packing_aed: number;
    commission_aed: number;
    discount_aed?: number;
    grand_total_aed: number;
    deposit_aed?: number;
    balance_due_aed?: number;
  };
  parts: Array<{
    id: string;
    name: string;
    part_kind?: 'single' | 'group';
    group_items?: Array<{ id: string; name: string; quantity: number }>;
    qty: number;
    supplier_price_aed: number;
    client_price_aed: number;
    client_line_total_aed?: number;
    gross_client_line_total_aed?: number;
    discount_share_aed?: number;
    photo_urls: string[];
    googleDriveVideoUrl?: string;
    google_drive_video_url?: string;
    weight_kg?: number;
    places?: number;
    cargo_place_group?: string;
    is_oversized?: boolean;
  }>;
  owner: {
    whatsapp_phone: string | null;
    display_name?: string | null;
  };
  manager_contact?: {
    whatsapp_phone: string | null;
    display_name?: string | null;
  };
  brand?: {
    name?: string | null;
  };
  customer_links?: {
    phone?: string | null;
    instagram_url?: string | null;
    tiktok_url?: string | null;
    facebook_url?: string | null;
    telegram_url?: string | null;
  };
  breakdown?: {
    parts_total: number;
    delivery: number;
    packaging: number;
    commission: number;
    discount?: number;
    total: number;
    deposit?: number;
    balance_due?: number;
    currency: string;
    fx_rate: number;
    rates?: Record<string, number>;
  };
  contact?: {
    whatsapp_phone: string | null;
    display_name?: string | null;
    phone?: string | null;
    instagram?: string | null;
    telegram?: string | null;
    tiktok?: string | null;
  };
  public_contact?: {
    whatsapp?: string | null;
    telegram?: string | null;
    instagram?: string | null;
    tiktok?: string | null;
  };
  public_settings?: {
    publicWhatsappNumber?: string;
    publicTelegramUrl?: string;
    publicInstagramUrl?: string;
    publicWebsiteUrl?: string;
    publicEmail?: string;
    publicDeliveryTerms?: string;
    publicWorkTerms?: string;
    publicCompanyLogoUrl?: string;
    publicInvoiceSignatureUrl?: string;
    publicManagerName?: string;
    invoicePaymentAccountNo?: string;
    invoicePaymentBeneficiary?: string;
    invoicePaymentBankAccount?: string;
    publicTermsFileUrl?: string;
    publicTermsFileName?: string;
    executorPhotoUrl?: string;
    executorRole?: string;
    whatsapp_phone?: string | null;
  };
  logistics?: {
    deliveryType?: 'uae' | 'export';
    deliveryAed?: number;
    packingAed?: number;
    serviceFeeAed?: number;
    cargoDeliveryType?: 'air' | 'express_air' | 'container';
    cargoCountry?: string;
    cargoEtaDays?: string;
    cargoTotalWeightKg?: number;
    cargoChargeableWeightKg?: number;
    cargoTotalPlaces?: number;
    cargoAirCostUsd?: number;
    cargoContainerCostUsd?: number;
    cargoAirEtaDays?: string;
    cargoContainerEtaDays?: string;
    cargoVolumeCbm?: number;
    cargoBaseCostUsd?: number;
    cargoTotalCostUsd?: number;
    additionalCostsUsd?: {
      packagingUsd?: number;
      insuranceUsd?: number;
      customsUsd?: number;
      cityDeliveryUsd?: number;
    };
  };
  items?: Array<{
    id?: string;
    name: string;
    part_kind?: 'single' | 'group';
    group_items?: Array<{ id: string; name: string; quantity: number }>;
    qty: number;
    unit_price: number;
    line_total: number;
    currency: string;
    photo_urls?: string[];
    googleDriveVideoUrl?: string;
    google_drive_video_url?: string;
  }>;
  fees?: {
    logistics: number;
    packaging: number;
    commission: number;
  };
  contacts?: {
    whatsapp: string;
    telegram: string;
    instagram: string;
    tiktok?: string;
  };
  meta?: {
    oid: string;
    exp: number;
    created_at: string;
  };
  image_manifest?: unknown;
  pre_sale_check?: {
    defect_photos: string[];
    inspection_media: string[];
    disclaimer: string;
    checked_at?: string;
  };
  proof_notes?: Array<{
    id: string;
    text: string;
    photos: string[];
    video_urls: string[];
    attachments?: Array<{
      id: string;
      kind: 'file' | 'location' | 'contact';
      name: string;
      value?: string;
      file_url?: string;
      fileUrl?: string;
      mime_type?: string;
      mimeType?: string;
      size?: number;
      latitude?: number;
      longitude?: number;
      address?: string;
      phone?: string;
      created_at: number;
      createdAt?: number;
    }>;
    audios: Array<{
      id: string;
      file_url: string;
      duration: number;
      created_at: number;
      author: string;
    }>;
    created_at: number;
  }>;
};

type SnapshotRow = {
  id: string;
  token: string;
  snapshot_id?: string | null;
  original_url?: string | null;
  short_url?: string | null;
  expires_at: string;
  payload?: unknown;
  payload_json?: unknown;
  payload_b64?: string | null;
  payload_codec?: string | null;
};

type SnapshotContactsSource = 'snapshot' | 'settings' | 'legacy';

export type PublicContactSettings = {
  publicWhatsappNumber: string;
  publicTelegramUrl: string;
  publicInstagramUrl: string;
  publicWebsiteUrl: string;
  publicEmail: string;
  publicDeliveryTerms: string;
  publicWorkTerms: string;
  publicCompanyLogoUrl: string;
  publicInvoiceSignatureUrl: string;
  publicManagerName: string;
  invoicePaymentAccountNo: string;
  invoicePaymentBeneficiary: string;
  invoicePaymentBankAccount: string;
  publicTermsFileUrl: string;
  publicTermsFileName: string;
};

const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const parseMoney = (...values: Array<unknown>) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
};

const normalizeWhatsappE164 = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return `+${digits}`;
};

const createToken = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const toDigits = (value: string | null | undefined) => (value || '').replace(/\D/g, '');

const pickNumeric = (...values: Array<unknown>) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const resolveClientUnitPriceAed = (
  variantLike: Record<string, unknown>,
  options?: { markupPercent?: number },
) => {
  const clientPrice = pickNumeric(
    variantLike.priceClientAed,
    variantLike.price_client_aed,
    variantLike.priceWithMarkupAed,
    variantLike.price_with_markup_aed,
    variantLike.finalPriceAed,
    variantLike.final_price_aed,
    variantLike.client_price_aed,
    variantLike.clientPriceAed,
    variantLike.unit_price_aed,
    variantLike.unitPriceAed,
    variantLike.unit_price,
    variantLike.unitPrice,
  );
  if (clientPrice !== null) return round2(clientPrice);

  const basePrice =
    pickNumeric(
      variantLike.salePriceAed,
      variantLike.sale_price_aed,
      variantLike.priceAed,
      variantLike.price_aed,
      variantLike.supplier_price_aed,
      variantLike.supplierPriceAed,
      variantLike.base_price_aed,
      variantLike.basePriceAed,
      variantLike.base_price,
      variantLike.basePrice,
      variantLike.price,
      variantLike.amount,
      variantLike.value,
    ) || 0;
  const markupPercent = Number(options?.markupPercent || 0);
  return round2(basePrice * (1 + markupPercent / 100));
};

const computeLineTotal = (item: Record<string, unknown>) => {
  const qty = pickNumeric(item.qty, item.quantity, 1) || 1;
  const unitPrice = pickNumeric(
    item.unit_price,
    item.unitPrice,
    item.client_price_aed,
    item.clientPriceAed,
  );
  const explicitLineTotal = pickNumeric(item.line_total, item.lineTotal);
  const fallbackPrice = pickNumeric(item.price, item.amount, item.value);
  return explicitLineTotal ?? (unitPrice !== null ? qty * unitPrice : (fallbackPrice ?? 0));
};

const computeTotalsFromItems = (
  items: Array<Record<string, unknown>>,
  fees: { logistics: number; packaging: number; commission: number },
) => {
  const partsTotal = items.reduce((sum, item) => sum + computeLineTotal(item), 0);
  return {
    partsTotal,
    grandTotal: partsTotal + fees.logistics + fees.packaging + fees.commission,
  };
};

const isStablePublicImageUrl = (photo: string) =>
  /^https?:\/\//i.test(photo) || /^data:image\//i.test(photo);

const dedupePhotoUrls = (photos: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  return photos
    .map((photo) => String(photo || '').trim())
    .filter((photo) => {
      if (!photo || seen.has(photo) || !isStablePublicImageUrl(photo)) return false;
      seen.add(photo);
      return true;
    });
};

const normalizeProofAttachmentKind = (kind: unknown): ChatAttachment['kind'] =>
  kind === 'location' || kind === 'contact' ? kind : 'file';

const serializeProofAttachment = (attachment: ChatAttachment, index: number) => {
  const kind = normalizeProofAttachmentKind(attachment.kind);
  const fileUrl = String(attachment.fileUrl || '').trim();
  const value = String(attachment.value || '').trim();
  const mimeType = String(attachment.mimeType || '').trim();
  const name = String(
    attachment.name ||
      (kind === 'location' ? attachment.address : kind === 'contact' ? attachment.phone : '') ||
      `Attachment ${index + 1}`,
  ).trim();
  const size = Number(attachment.size || 0);
  const latitude = Number(attachment.latitude);
  const longitude = Number(attachment.longitude);

  return {
    id: String(attachment.id || `proof-attachment-${index}`),
    kind,
    name,
    value: value || undefined,
    file_url: fileUrl || undefined,
    fileUrl: fileUrl || undefined,
    mime_type: mimeType || undefined,
    mimeType: mimeType || undefined,
    size: Number.isFinite(size) && size > 0 ? size : undefined,
    latitude: Number.isFinite(latitude) ? latitude : undefined,
    longitude: Number.isFinite(longitude) ? longitude : undefined,
    address: String(attachment.address || '').trim() || undefined,
    phone: String(attachment.phone || '').trim() || undefined,
    created_at: Number(attachment.createdAt || Date.now()),
    createdAt: Number(attachment.createdAt || Date.now()),
  };
};

const hasProofAttachmentContent = (attachment: ReturnType<typeof serializeProofAttachment>) =>
  Boolean(
    attachment.name ||
    attachment.value ||
    attachment.file_url ||
    attachment.address ||
    attachment.phone ||
    Number.isFinite(attachment.latitude) ||
    Number.isFinite(attachment.longitude),
  );

const resolveContactsSource = (payload: Record<string, unknown>): SnapshotContactsSource => {
  const contactsObj =
    payload.contacts && typeof payload.contacts === 'object'
      ? (payload.contacts as Record<string, unknown>)
      : {};
  const hasContacts = Boolean(String(contactsObj.whatsapp || '').trim());
  if (hasContacts) return 'snapshot';

  const settingsObj =
    payload.public_settings && typeof payload.public_settings === 'object'
      ? (payload.public_settings as Record<string, unknown>)
      : {};
  if (String(settingsObj.publicWhatsappNumber || '').trim()) return 'settings';

  return 'legacy';
};

const buildNormalizedPayloadJson = (payload: Record<string, unknown>) => {
  const markupPercent = Number(
    pickNumeric(
      payload.markupPercent,
      payload.markup_percent,
      (payload.order as any)?.markupPercent,
      (payload.order as any)?.markup_percent,
    ) || 0,
  );
  const legacyParts = Array.isArray(payload.parts)
    ? (payload.parts as Array<Record<string, unknown>>)
    : [];
  const items = legacyParts.map((part, index) => {
    const qty = pickNumeric(part.qty, part.quantity, 1) || 1;
    const unitPrice = parseMoney(
      part.client_price_aed,
      part.clientPriceAed,
      part.unit_price,
      part.unitPrice,
      resolveClientUnitPriceAed(part, { markupPercent }),
    );
    const lineTotal = round2(
      parseMoney(
        part.client_line_total_aed,
        part.clientLineTotalAed,
        part.line_total,
        part.lineTotal,
        unitPrice * qty,
      ),
    );

    return {
      id: String(part.id || `part-${index}`),
      name: String(part.name || 'Part'),
      part_kind: part.part_kind,
      group_items: Array.isArray(part.group_items) ? part.group_items : [],
      qty,
      unit_price: unitPrice,
      line_total: lineTotal,
      googleDriveVideoUrl: String(part.googleDriveVideoUrl || part.google_drive_video_url || ''),
      google_drive_video_url: String(part.google_drive_video_url || part.googleDriveVideoUrl || ''),
    };
  });

  const fallbackItems = Array.isArray(payload.items)
    ? (payload.items as Array<Record<string, unknown>>)
    : [];
  const normalizedItems =
    items.length > 0
      ? items
      : fallbackItems.map((item, index) => {
          const qty = pickNumeric(item.qty, item.quantity, 1) || 1;
          const unitPrice = parseMoney(
            item.unit_price,
            item.unitPrice,
            item.price,
            item.amount,
            item.value,
          );
          return {
            id: String(item.id || `item-${index}`),
            name: String(item.name || 'Part'),
            qty,
            unit_price: unitPrice,
            line_total: round2(parseMoney(item.line_total, item.lineTotal, unitPrice * qty)),
            googleDriveVideoUrl: String(
              item.googleDriveVideoUrl || item.google_drive_video_url || '',
            ),
            google_drive_video_url: String(
              item.google_drive_video_url || item.googleDriveVideoUrl || '',
            ),
          };
        });

  const partsTotal = round2(
    normalizedItems.reduce((sum, item) => sum + parseMoney(item.line_total), 0),
  );
  const logistics = parseMoney(
    (payload.logistics as any)?.deliveryAed,
    (payload.fees as any)?.logistics,
    (payload.totals as any)?.logistics_aed,
  );
  const commission = parseMoney(
    (payload.logistics as any)?.serviceFeeAed,
    (payload.fees as any)?.commission,
    (payload.totals as any)?.commission_aed,
  );
  const packaging = parseMoney(
    (payload.logistics as any)?.packingAed,
    (payload.fees as any)?.packaging,
    (payload.totals as any)?.packing_aed,
  );
  const discount = parseMoney(
    (payload.totals as any)?.discount_aed,
    (payload.breakdown as any)?.discount,
  );
  const declaredTotal = pickNumeric(
    (payload.breakdown as any)?.total,
    (payload.totals as any)?.grand_total_aed,
    (payload.totals as any)?.grand_total,
  );
  const grandTotal = round2(
    Math.max(0, declaredTotal ?? partsTotal + logistics + commission + packaging - discount),
  );

  const contacts =
    payload.contacts && typeof payload.contacts === 'object'
      ? (payload.contacts as Record<string, unknown>)
      : {};
  const managerSettings =
    payload.public_settings && typeof payload.public_settings === 'object'
      ? (payload.public_settings as Record<string, unknown>)
      : {};

  const normalizedWhatsapp = toDigits(
    String(
      contacts.whatsapp ||
        managerSettings.whatsapp ||
        managerSettings.publicWhatsappNumber ||
        (payload.public_contact as any)?.whatsapp ||
        (payload.contact as any)?.whatsapp_phone ||
        (payload.owner as any)?.whatsapp_phone ||
        '',
    ),
  );
  const normalizedTelegram = String(
    contacts.telegram ||
      managerSettings.telegram ||
      managerSettings.publicTelegramUrl ||
      (payload.public_contact as any)?.telegram ||
      (payload.contact as any)?.telegram ||
      '',
  );
  const normalizedInstagram = String(
    contacts.instagram ||
      managerSettings.instagram ||
      managerSettings.publicInstagramUrl ||
      (payload.public_contact as any)?.instagram ||
      (payload.contact as any)?.instagram ||
      '',
  );
  const normalizedTiktok = String(
    contacts.tiktok ||
      (payload.customer_links as any)?.tiktok_url ||
      (payload.customer_links as any)?.tiktokUrl ||
      (payload.public_contact as any)?.tiktok ||
      (payload.contact as any)?.tiktok ||
      '',
  );

  return {
    ...payload,
    items: normalizedItems,
    fees: {
      logistics,
      packaging,
      commission,
    },
    totals: {
      ...(payload.totals && typeof payload.totals === 'object'
        ? (payload.totals as Record<string, unknown>)
        : {}),
      parts_total: partsTotal,
      grand_total: grandTotal,
      parts_sum_aed: partsTotal,
      logistics_aed: logistics,
      packing_aed: packaging,
      commission_aed: commission,
      discount_aed: discount,
      grand_total_aed: grandTotal,
    },
    contacts: {
      whatsapp: normalizedWhatsapp || null,
      telegram: normalizedTelegram || null,
      instagram: normalizedInstagram || null,
      tiktok: normalizedTiktok || null,
    },
  };
};

export const ensurePayloadReadModel = async (row: SnapshotRow, payload: unknown) => {
  if (!payload || typeof payload !== 'object')
    return { payload, contactsSource: 'legacy' as SnapshotContactsSource, wasPatched: false };
  const source = payload as Record<string, unknown>;
  const needsLegacyBackfill = !row.payload_json || typeof row.payload_json !== 'object';
  const basePayload = (needsLegacyBackfill ? buildNormalizedPayloadJson(source) : source) as Record<
    string,
    any
  >;
  const feesObj =
    basePayload.fees && typeof basePayload.fees === 'object'
      ? (basePayload.fees as Record<string, unknown>)
      : {};
  const logistics = parseMoney(
    feesObj.logistics,
    (basePayload.logistics as any)?.deliveryAed,
    (basePayload.totals as any)?.logistics_aed,
  );
  const packaging = parseMoney(
    feesObj.packaging,
    (basePayload.logistics as any)?.packingAed,
    (basePayload.totals as any)?.packing_aed,
  );
  const commission = parseMoney(
    feesObj.commission,
    (basePayload.logistics as any)?.serviceFeeAed,
    (basePayload.totals as any)?.commission_aed,
  );

  const itemRows = Array.isArray(basePayload.items)
    ? (basePayload.items as Array<Record<string, unknown>>)
    : [];
  const partRows = Array.isArray(basePayload.parts)
    ? (basePayload.parts as Array<Record<string, unknown>>)
    : [];
  const markupPercent = Number(
    pickNumeric(
      basePayload.markupPercent,
      basePayload.markup_percent,
      (basePayload.order as any)?.markupPercent,
      (basePayload.order as any)?.markup_percent,
    ) || 0,
  );
  const normalizedItemsFromParts = partRows.map((part, index) => {
    const qty = pickNumeric(part.qty, part.quantity, 1) || 1;
    const unitPrice = parseMoney(
      part.client_price_aed,
      part.clientPriceAed,
      part.unit_price,
      part.unitPrice,
      resolveClientUnitPriceAed(part, { markupPercent }),
    );
    const lineTotal = round2(
      parseMoney(
        part.client_line_total_aed,
        part.clientLineTotalAed,
        part.line_total,
        part.lineTotal,
        unitPrice * qty,
      ),
    );
    return {
      id: String(part.id || `part-${index}`),
      name: String(part.name || 'Part'),
      part_kind: part.part_kind,
      group_items: Array.isArray(part.group_items) ? part.group_items : [],
      qty,
      unit_price: unitPrice,
      line_total: lineTotal,
      currency: 'AED',
      googleDriveVideoUrl: String(part.googleDriveVideoUrl || part.google_drive_video_url || ''),
      google_drive_video_url: String(part.google_drive_video_url || part.googleDriveVideoUrl || ''),
    };
  });
  const normalizedItems =
    normalizedItemsFromParts.length > 0
      ? normalizedItemsFromParts
      : itemRows.map((item, index) => {
          const qty = pickNumeric(item.qty, item.quantity, 1) || 1;
          const unitPrice = resolveClientUnitPriceAed(item, { markupPercent });
          return {
            id: String(item.id || `item-${index}`),
            name: String(item.name || 'Part'),
            qty,
            unit_price: unitPrice,
            line_total: round2(unitPrice * qty),
            currency: 'AED',
            googleDriveVideoUrl: String(
              item.googleDriveVideoUrl || item.google_drive_video_url || '',
            ),
            google_drive_video_url: String(
              item.google_drive_video_url || item.googleDriveVideoUrl || '',
            ),
          };
        });
  const computed = computeTotalsFromItems(normalizedItems as Array<Record<string, unknown>>, {
    logistics,
    packaging,
    commission,
  });
  const existingTotals =
    basePayload.totals && typeof basePayload.totals === 'object'
      ? (basePayload.totals as Record<string, unknown>)
      : {};
  const existingBreakdown =
    basePayload.breakdown && typeof basePayload.breakdown === 'object'
      ? (basePayload.breakdown as Record<string, unknown>)
      : {};
  const discount = Math.max(0, parseMoney(existingTotals.discount_aed, existingBreakdown.discount));
  const declaredTotal = pickNumeric(
    existingBreakdown.total,
    existingTotals.grand_total_aed,
    existingTotals.grand_total,
  );
  const netTotal = round2(Math.max(0, declaredTotal ?? computed.grandTotal - discount));

  const nextContacts =
    basePayload.contacts && typeof basePayload.contacts === 'object'
      ? (basePayload.contacts as Record<string, unknown>)
      : {
          whatsapp: toDigits(
            String(
              (basePayload.public_settings as any)?.publicWhatsappNumber ||
                (basePayload.owner as any)?.whatsapp_phone ||
                '',
            ),
          ),
          telegram: String((basePayload.public_settings as any)?.publicTelegramUrl || ''),
          instagram: String((basePayload.public_settings as any)?.publicInstagramUrl || ''),
        };

  const nextPayload: Record<string, unknown> = {
    ...basePayload,
    items: normalizedItems,
    totals: {
      ...existingTotals,
      parts_total: round2(computed.partsTotal),
      parts_sum_aed: round2(computed.partsTotal),
      logistics_aed: parseMoney(existingTotals.logistics_aed, logistics),
      packing_aed: parseMoney(existingTotals.packing_aed, packaging),
      commission_aed: parseMoney(existingTotals.commission_aed, commission),
      discount_aed: discount,
      grand_total: netTotal,
      grand_total_aed: netTotal,
    },
    fees: {
      logistics,
      packaging,
      commission,
    },
    contacts: nextContacts,
  };

  const currentSnapshot = JSON.stringify(basePayload);
  const patchedSnapshot = JSON.stringify(nextPayload);
  const wasPatched = currentSnapshot !== patchedSnapshot;
  // Normalization is read-only. Opening a client link must never mutate the stored offer.

  return { payload: nextPayload, contactsSource: resolveContactsSource(nextPayload), wasPatched };
};

const buildSnapshotPayload = (
  order: Order,
  currency: string,
  exchangeRate: number,
  owner: { whatsappPhone?: string | null; displayName?: string | null },
  publicSettings?: {
    publicWhatsappNumber?: string;
    publicTelegramUrl?: string;
    publicInstagramUrl?: string;
    publicWebsiteUrl?: string;
    publicEmail?: string;
    publicDeliveryTerms?: string;
    publicWorkTerms?: string;
    publicCompanyLogoUrl?: string;
    publicInvoiceSignatureUrl?: string;
    publicManagerName?: string;
    invoicePaymentAccountNo?: string;
    invoicePaymentBeneficiary?: string;
    invoicePaymentBankAccount?: string;
    publicTermsFileUrl?: string;
    publicTermsFileName?: string;
    executorPhotoUrl?: string;
    executorRole?: string;
  },
  rates?: QuoteRates,
): PublicQuotePayloadV1 => {
  const quoteTotals = calculateOrderTotals(order);
  const createdAtIso = new Date().toISOString();
  const expiresAtMs = Date.now() + SNAPSHOT_TTL_MS;
  const deliveryAed = quoteTotals.deliveryAed + quoteTotals.cargoAed;
  const packingAed = quoteTotals.packingAed;
  const commissionAed = quoteTotals.commissionAed;
  const cargoCountry = String(order.logistics?.cargoCountry || '').trim();
  const cargoDeliveryType = (order.logistics?.cargoDeliveryType || 'air') as
    'air' | 'express_air' | 'container';
  const cargoEtaDays = String(order.logistics?.cargoEtaDays || '').trim();
  const cargoTotalWeightKg = parseMoney(order.logistics?.cargoTotalWeightKg);
  const cargoChargeableWeightKg = parseMoney(order.logistics?.cargoChargeableWeightKg);
  const cargoVolumeCbm = parseMoney(order.logistics?.cargoVolumeCbm);
  const cargoTotalPlaces = parseMoney(order.logistics?.cargoTotalPlaces);
  const cargoBaseCostUsd = parseMoney(order.logistics?.cargoBaseCostUsd);
  const cargoTotalCostUsd = parseMoney(order.logistics?.cargoTotalCostUsd);
  const cargoAirCostUsd = parseMoney(order.logistics?.cargoAirCostUsd);
  const cargoContainerCostUsd = parseMoney(order.logistics?.cargoContainerCostUsd);
  const cargoAirEtaDays = String(order.logistics?.cargoAirEtaDays || '').trim();
  const cargoContainerEtaDays = String(order.logistics?.cargoContainerEtaDays || '').trim();
  const additionalCostsUsd = order.logistics?.additionalCostsUsd || undefined;

  const pricedPartLines = quoteTotals.lines;
  const discountAed = quoteTotals.discountAed;
  const pricedParts = pricedPartLines.map(
    ({
      part,
      variant,
      quantity,
      baseUnitAed,
      clientUnitAed,
      clientLineTotalAed,
      grossClientLineTotalAed,
      discountShareAed,
    }) => ({
      id: String(part.id),
      name: String(part.name || 'Part'),
      comment: String(part.comment || ''),
      part_kind: (part.partKind === 'group' ? 'group' : 'single') as 'single' | 'group',
      group_items: normalizeGroupItems((part as any).groupItems).map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
      })),
      qty: quantity,
      supplier_price_aed: baseUnitAed,
      client_price_aed: round2(clientUnitAed),
      client_line_total_aed: round2(clientLineTotalAed),
      gross_client_line_total_aed: round2(grossClientLineTotalAed),
      discount_share_aed: round2(discountShareAed),
      photo_urls: dedupePhotoUrls([variant?.photoUrl || '', ...(variant?.photos || [])]),
      googleDriveVideoUrl: String((part as any).googleDriveVideoUrl || '').trim(),
      google_drive_video_url: String((part as any).googleDriveVideoUrl || '').trim(),
      weight_kg: parseMoney((part as any).weightKg),
      places: parseMoney((part as any).places),
      cargo_place_group: String((part as any).cargoPlaceGroup || '').trim() || undefined,
      is_oversized: !!(part as any).isOversized,
    }),
  );

  const snapshotItems = pricedParts.map((part) => ({
    id: part.id,
    name: part.name,
    part_kind: part.part_kind,
    group_items: part.group_items,
    qty: part.qty,
    unit_price: part.client_price_aed,
    line_total: part.client_line_total_aed,
    currency: 'AED',
    googleDriveVideoUrl: part.googleDriveVideoUrl,
    google_drive_video_url: part.google_drive_video_url,
  }));
  const computed = computeTotalsFromItems(snapshotItems as Array<Record<string, unknown>>, {
    logistics: deliveryAed,
    packaging: packingAed,
    commission: commissionAed,
  });
  const partsSumAed = computed.partsTotal;
  const grandTotalAed = quoteTotals.totalAed;
  const searchDepositAmountAed = Math.max(0, parseMoney((order as any).searchDepositAmountAed));
  const balanceDueAed = Math.max(0, round2(grandTotalAed - searchDepositAmountAed));
  const normalizedWhatsapp =
    toDigits(publicSettings?.publicWhatsappNumber) || toDigits(owner.whatsappPhone);
  const normalizedTelegram = publicSettings?.publicTelegramUrl || '';
  const normalizedInstagram = publicSettings?.publicInstagramUrl || '';
  const preSaleCheck = order.preSaleCheck || { defectPhotos: [], inspectionMedia: [] };
  const proofNotes = (order.notes || [])
    .filter(
      (note) =>
        note.visibility !== 'internal' && (note.visibility === 'client' || note.kind === 'proof'),
    )
    .map((note) => {
      const attachments = (note.attachments || [])
        .map((attachment, index) => serializeProofAttachment(attachment, index))
        .filter(hasProofAttachmentContent);

      return {
        id: String(note.id || `proof-${Date.now()}`),
        text: String(note.text || '').trim(),
        photos: dedupePhotoUrls(note.photos || []),
        video_urls: (note.videoUrls || []).map((url) => String(url || '').trim()).filter(Boolean),
        attachments,
        audios: (note.audios || [])
          .map((audio, index) => {
            if (typeof audio === 'string') {
              return {
                id: `audio-${index}`,
                file_url: audio,
                duration: 0,
                created_at: note.createdAt || Date.now(),
                author: owner.displayName || 'Stark Motors',
              };
            }
            return {
              id: String(audio.id || `audio-${index}`),
              file_url: String(audio.fileUrl || ''),
              duration: Number(audio.duration || 0),
              created_at: Number(audio.createdAt || note.createdAt || Date.now()),
              author: String(audio.author || owner.displayName || 'Stark Motors'),
            };
          })
          .filter((audio) => audio.file_url),
        created_at: Number(note.createdAt || Date.now()),
      };
    })
    .filter(
      (note) =>
        note.text ||
        note.photos.length > 0 ||
        note.video_urls.length > 0 ||
        note.audios.length > 0 ||
        note.attachments.length > 0,
    );

  return {
    version: 'public_quote_payload_v1',
    created_at: createdAtIso,
    order: {
      id: order.id,
      brand: order.brand,
      model: order.model,
      year: order.year,
      client_name: order.clientName || '',
      customerContact: order.customerContact || '',
      customer_contact: order.customerContact || '',
      socialNickname: order.socialNickname || '',
      social_nickname: order.socialNickname || '',
      vin: order.vin,
      body_type: order.bodyType,
      carPhotoUrl: order.carPhotoUrl || order.carPhotos?.[0] || order.vinPhotoUrl || '',
      car_photo_url: order.carPhotoUrl || order.carPhotos?.[0] || order.vinPhotoUrl || '',
      carPhotos: (order.carPhotos || []).slice(0, 3),
      car_photos: (order.carPhotos || []).slice(0, 3),
      vinPhotoUrl: order.vinPhotoUrl || '',
      vin_photo_url: order.vinPhotoUrl || '',
      markupType: order.markupType || 'percent',
      markup_type: order.markupType || 'percent',
      markupFixedAed: parseMoney(order.markupFixedAed) || 0,
      markup_fixed_aed: parseMoney(order.markupFixedAed) || 0,
      markupPercent: parseMoney(order.markupPercent) || 0,
      markup_percent: parseMoney(order.markupPercent) || 0,
      discountType: order.discountType || 'percent',
      discount_type: order.discountType || 'percent',
      discountFixedAed: parseMoney(order.discountFixedAed) || 0,
      discount_fixed_aed: parseMoney(order.discountFixedAed) || 0,
      discountPercent: parseMoney(order.discountPercent) || 0,
      discount_percent: parseMoney(order.discountPercent) || 0,
      searchDepositAmount: parseMoney((order as any).searchDepositAmount),
      searchDepositCurrency: String((order as any).searchDepositCurrency || ''),
      searchDepositExchangeRate: parseMoney((order as any).searchDepositExchangeRate),
      searchDepositAmountAed,
      searchDepositPaidAt: (order as any).searchDepositPaidAt || null,
      search_deposit_amount: parseMoney((order as any).searchDepositAmount),
      search_deposit_currency: String((order as any).searchDepositCurrency || ''),
      search_deposit_exchange_rate: parseMoney((order as any).searchDepositExchangeRate),
      search_deposit_amount_aed: searchDepositAmountAed,
      search_deposit_paid_at: (order as any).searchDepositPaidAt || null,
      googleDriveFolderUrl: String((order as any).googleDriveFolderUrl || '').trim(),
      google_drive_folder_url: String((order as any).googleDriveFolderUrl || '').trim(),
    },
    pricing: {
      currency,
      fx_rate: exchangeRate,
      rates,
    },
    totals: {
      parts_sum_aed: partsSumAed,
      logistics_aed: deliveryAed,
      packing_aed: packingAed,
      commission_aed: commissionAed,
      discount_aed: discountAed,
      grand_total_aed: grandTotalAed,
      deposit_aed: searchDepositAmountAed,
      balance_due_aed: balanceDueAed,
    },
    breakdown: {
      parts_total: partsSumAed,
      delivery: deliveryAed,
      packaging: packingAed,
      commission: commissionAed,
      discount: discountAed,
      total: grandTotalAed,
      deposit: searchDepositAmountAed,
      balance_due: balanceDueAed,
      currency,
      fx_rate: exchangeRate,
      rates,
    },
    parts: pricedParts,
    logistics: {
      deliveryType: (order.logistics?.deliveryType || 'uae') as 'uae' | 'export',
      deliveryAed,
      packingAed,
      serviceFeeAed: commissionAed,
      cargoCountry: cargoCountry || undefined,
      cargoDeliveryType,
      cargoEtaDays: cargoEtaDays || undefined,
      cargoTotalWeightKg,
      cargoChargeableWeightKg,
      cargoVolumeCbm,
      cargoTotalPlaces,
      cargoBaseCostUsd,
      cargoTotalCostUsd,
      cargoAirCostUsd,
      cargoContainerCostUsd,
      cargoAirEtaDays: cargoAirEtaDays || undefined,
      cargoContainerEtaDays: cargoContainerEtaDays || undefined,
      additionalCostsUsd,
    },
    items: snapshotItems,
    fees: {
      logistics: deliveryAed,
      packaging: packingAed,
      commission: commissionAed,
    },
    contacts: {
      whatsapp: normalizedWhatsapp,
      telegram: normalizedTelegram,
      instagram: normalizedInstagram,
    },
    pre_sale_check: {
      defect_photos: (preSaleCheck.defectPhotos || []).filter(Boolean),
      inspection_media: (preSaleCheck.inspectionMedia || []).filter(Boolean),
      disclaimer: 'Товар проверен. После передачи в карго претензии не принимаются',
      checked_at: preSaleCheck.checkedAt
        ? new Date(preSaleCheck.checkedAt).toISOString()
        : undefined,
    },
    proof_notes: proofNotes,
    meta: {
      oid: order.id,
      exp: expiresAtMs,
      created_at: createdAtIso,
    },
    owner: {
      whatsapp_phone: normalizeWhatsappE164(owner.whatsappPhone),
      display_name: owner.displayName || null,
    },
    manager_contact: {
      whatsapp_phone:
        normalizeWhatsappE164(owner.whatsappPhone) ||
        normalizeWhatsappE164(publicSettings?.publicWhatsappNumber),
      display_name: owner.displayName || null,
    },
    brand: {
      name: order.brand || null,
    },
    customer_links: {
      phone: order.contactLinks?.phone || order.customerContact || null,
      instagram_url: order.contactLinks?.instagramUrl || null,
      tiktok_url: order.contactLinks?.tiktokUrl || null,
      facebook_url: order.contactLinks?.facebookUrl || null,
      telegram_url: order.contactLinks?.telegramUrl || null,
    },
    contact: {
      whatsapp_phone:
        normalizeWhatsappE164(owner.whatsappPhone) ||
        normalizeWhatsappE164(publicSettings?.publicWhatsappNumber),
      display_name: owner.displayName || null,
      phone: normalizeWhatsappE164(publicSettings?.publicWhatsappNumber),
      instagram: publicSettings?.publicInstagramUrl || null,
      telegram: publicSettings?.publicTelegramUrl || null,
      tiktok: order.contactLinks?.tiktokUrl || null,
    },
    public_contact: {
      whatsapp:
        normalizeWhatsappE164(publicSettings?.publicWhatsappNumber) ||
        normalizeWhatsappE164(owner.whatsappPhone),
      telegram: publicSettings?.publicTelegramUrl || null,
      instagram: publicSettings?.publicInstagramUrl || null,
      tiktok: order.contactLinks?.tiktokUrl || null,
    },
    public_settings: {
      publicWhatsappNumber: publicSettings?.publicWhatsappNumber || '',
      publicTelegramUrl: publicSettings?.publicTelegramUrl || '',
      publicInstagramUrl: publicSettings?.publicInstagramUrl || '',
      publicWebsiteUrl: publicSettings?.publicWebsiteUrl || '',
      publicEmail: publicSettings?.publicEmail || '',
      publicDeliveryTerms: publicSettings?.publicDeliveryTerms || '',
      publicWorkTerms: publicSettings?.publicWorkTerms || '',
      publicCompanyLogoUrl: publicSettings?.publicCompanyLogoUrl || '',
      publicInvoiceSignatureUrl: publicSettings?.publicInvoiceSignatureUrl || '',
      publicManagerName: publicSettings?.publicManagerName || '',
      invoicePaymentAccountNo: publicSettings?.invoicePaymentAccountNo || '',
      invoicePaymentBeneficiary: publicSettings?.invoicePaymentBeneficiary || '',
      invoicePaymentBankAccount: publicSettings?.invoicePaymentBankAccount || '',
      publicTermsFileUrl: publicSettings?.publicTermsFileUrl || '',
      publicTermsFileName: publicSettings?.publicTermsFileName || '',
      executorPhotoUrl: publicSettings?.executorPhotoUrl || '',
      executorRole: publicSettings?.executorRole || '',
      whatsapp_phone: normalizeWhatsappE164(owner.whatsappPhone),
    },
  };
};

import { loadAppSettings } from './appSettings';
import {
  decodePayloadFromCompressedTransport,
  encodePayloadToCompressedTransport,
} from './payloadCodec';
import { localDocuments } from './storage/localDocuments';

type SnapshotOptions = {
  currency?: string;
  exchangeRate?: number;
  rates?: QuoteRates;
  owner?: { whatsappPhone?: string | null; displayName?: string | null };
  publicSettings?: Partial<ReturnType<typeof loadAppSettings>>;
  signal?: AbortSignal;
  timeoutMs?: number;
  token?: string;
  snapshotId?: string;
  upsertByToken?: boolean;
};
export const publicQuoteCreateSnapshot = async (order: Order, options: SnapshotOptions = {}) => {
  if (options.signal?.aborted) throw new DOMException('Сохранение отменено', 'AbortError');
  const token = options.token || createToken(),
    id = options.snapshotId || createToken();
  const payload = buildSnapshotPayload(
    order,
    options.currency || order.clientCurrency || 'USD',
    Number(options.exchangeRate || order.exchangeRate || 3.67),
    options.owner || {},
    options.publicSettings,
    options.rates,
  );
  if (!(payload.items || []).some((item) => Number(item.line_total) > 0))
    throw new Error('Нет цен по позициям');
  const expires_at = new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString();
  const snapshot = {
    id,
    token,
    snapshot_id: id,
    expires_at,
    payload,
    isPayloadCorrupted: false,
    row_id: id,
    contacts_source: 'snapshot',
    snapshot_source: 'local',
  };
  await localDocuments.set(`quote:${token}`, snapshot);
  const base = new URL(import.meta.env?.BASE_URL || './', window.location.href);
  let requiresFile = false;
  const params = new URLSearchParams({ token, exp: String(Date.parse(expires_at)) });
  try {
    const encoded = await encodePayloadToCompressedTransport(payload);
    params.set('data', encoded.payloadB64);
    params.set('codec', encoded.payloadCodec);
  } catch {
    requiresFile = true;
  }
  base.hash = `#/q/${encodeURIComponent(order.id)}?${params}`;
  return {
    ...snapshot,
    url: base.toString(),
    shortUrl: base.toString(),
    photosOmitted: false,
    requiresFile,
  };
};
export const publicQuoteGetSnapshot = async (
  token: string,
  _options?: { signal?: AbortSignal; timeoutMs?: number; snapshotId?: string | null },
) => {
  const query = window.location.hash.split('?')[1] || window.location.search.slice(1);
  const params = new URLSearchParams(query),
    data = params.get('data');
  if (data) {
    const payload = await decodePayloadFromCompressedTransport<PublicQuotePayloadV1>(
      data,
      params.get('codec') || 'identity+b64',
    );
    const expires_at = params.get('exp') ? new Date(Number(params.get('exp'))).toISOString() : '';
    return {
      id: token,
      token,
      snapshot_id: token,
      expires_at,
      payload,
      isPayloadCorrupted: !payload,
      row_id: token,
      contacts_source: 'snapshot',
      snapshot_source: 'link',
    };
  }
  return (
    (await localDocuments.get<{
      id: string;
      token: string;
      snapshot_id: string;
      expires_at: string;
      payload: PublicQuotePayloadV1;
      isPayloadCorrupted: boolean;
      row_id: string;
      contacts_source: string;
      snapshot_source: string;
    }>(`quote:${token}`)) || null
  );
};
export const publicQuoteGetPublicContactSettings = async (): Promise<PublicContactSettings> =>
  loadAppSettings();
