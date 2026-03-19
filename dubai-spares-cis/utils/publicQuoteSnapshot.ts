import { DEFAULT_QUOTE_RATES, parseQuoteRates, type QuoteCurrency, type QuoteRates } from '../shareUtils';
import { normalizeGroupItems, normalizePartQuantity } from './groupItems';
import { resolveClientUnitPriceAed } from '../publicQuoteApi';

export type QuoteContact = {
  whatsapp: string;
  telegram: string;
  instagram: string;
  managerName: string;
  logoUrl: string;
  signatureUrl: string;
  workTerms: string;
  deliveryTerms: string;
};

export type QuoteItem = {
  id: string;
  name: string;
  qty: number;
  unitPriceAed: number;
  totalAed: number;
  photos: string[];
  note?: string;
  status?: string;
};

export type QuoteDocument = {
  href: string;
  label: string;
  kind: 'invoice' | 'cargo' | 'pdf' | 'document';
};

export type NormalizedPublicQuoteSnapshot = {
  raw: Record<string, any>;
  order: {
    brand: string;
    model: string;
    year: string | number;
    vin: string;
    bodyType: string;
    carPhotoUrl: string;
  };
  rates: QuoteRates;
  currency: QuoteCurrency;
  items: QuoteItem[];
  deliveryAed: number;
  packingAed: number;
  commissionAed: number;
  grandTotalAed: number;
  subtotalAed: number;
  contact: QuoteContact;
  cargoInput: {
    logistics: Record<string, any>;
    parts: Array<Record<string, any>>;
  };
  pdfHref: string;
  documents: QuoteDocument[];
  hasRenderableContent: boolean;
};

const digits = (value: string | null | undefined) => (value || '').replace(/\D/g, '');
const firstString = (...values: unknown[]) => values.find((value) => typeof value === 'string' && value.trim()) as string | undefined;
const asObject = (value: unknown): Record<string, any> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {});
const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];
const firstNumber = (...values: unknown[]) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const pushDocument = (docs: QuoteDocument[], href: unknown, label: string, kind: QuoteDocument['kind']) => {
  if (typeof href !== 'string' || !href.trim()) return;
  docs.push({ href: href.trim(), label, kind });
};

const normalizeRates = (value: unknown): QuoteRates => {
  if (typeof value === 'string') return parseQuoteRates(value) || DEFAULT_QUOTE_RATES;
  const obj = asObject(value);
  const next: QuoteRates = { ...DEFAULT_QUOTE_RATES };
  (Object.keys(DEFAULT_QUOTE_RATES) as QuoteCurrency[]).forEach((code) => {
    const parsed = Number(obj[code]);
    if (Number.isFinite(parsed) && parsed > 0) next[code] = parsed;
  });
  return next;
};

const normalizeItemStatus = (part: { status?: unknown; part_status?: unknown; condition?: unknown; availability?: unknown }): string | undefined => {
  const raw = firstString(part.status, part.part_status, part.condition, part.availability);
  if (!raw) return undefined;
  const map: Record<string, string> = {
    in_stock: 'В наличии',
    by_order: 'Под заказ',
    '1d': 'Под заказ (1 д)',
    '2_3d': 'Под заказ (2–3 д)',
    new: 'Новая',
    used: 'Б/У',
    scrapyard: 'Б/У',
    found: 'Найдено',
    searching: 'Поиск',
    ordered: 'Заказана',
    not_found: 'Не найдено',
    original: 'Оригинал',
  };
  return map[raw.toLowerCase()] || raw;
};

const normalizeItems = (payload: Record<string, any>): QuoteItem[] => {
  const rawParts = asArray(payload.parts);
  const rawItems = asArray(payload.items);
  const partItems = rawParts.map((part: any, index: number) => {
    const qty = normalizePartQuantity(part.qty ?? part.quantity ?? 1);
    const groupItems = normalizeGroupItems(part.group_items || part.groupItems || []);
    const displayName = part.part_kind === 'group' && groupItems.length
      ? `${part.name || 'Group'}: ${groupItems.map((item) => `${item.name} ×${item.quantity}`).join(', ')}`
      : (part.name || `Part ${index + 1}`);
    const unitPriceAed = resolveClientUnitPriceAed(part, { markupPercent: 0 });
    return {
      id: String(part.id || `part-${index}`),
      name: displayName,
      qty,
      unitPriceAed,
      totalAed: unitPriceAed * qty,
      photos: asArray(part.photo_urls).filter(Boolean).length ? asArray(part.photo_urls).filter(Boolean) : asArray(part.photos).filter(Boolean),
      note: firstString(part.note, part.comment),
      status: normalizeItemStatus(part),
    };
  }).filter((item) => item.totalAed > 0 || item.photos.length > 0 || item.name);

  if (partItems.length > 0) return partItems;

  return rawItems.map((item: any, index: number) => {
    const qty = normalizePartQuantity(item.qty ?? item.quantity ?? 1);
    const unitPriceAed = firstNumber(item.unit_price, item.unitPrice, item.price, item.amount, item.value);
    return {
      id: String(item.id || `item-${index}`),
      name: firstString(item.name, item.title, item.label) || `Part ${index + 1}`,
      qty,
      unitPriceAed,
      totalAed: firstNumber(item.line_total, item.lineTotal, unitPriceAed * qty),
      photos: asArray(item.photo_urls).filter(Boolean).length ? asArray(item.photo_urls).filter(Boolean) : asArray(item.photos).filter(Boolean),
      note: firstString(item.note, item.comment),
      status: normalizeItemStatus(item),
    };
  }).filter((item) => item.totalAed > 0 || item.photos.length > 0 || item.name);
};

export const normalizePublicQuoteSnapshotPayload = (payload: unknown, settings?: Record<string, any> | null): NormalizedPublicQuoteSnapshot | null => {
  if (!payload || typeof payload !== 'object') return null;

  const raw = asObject(payload);
  const order = asObject(raw.order);
  const pricing = asObject(raw.pricing);
  const breakdown = asObject(raw.breakdown);
  const totals = asObject(raw.totals);
  const fees = asObject(raw.fees);
  const logistics = asObject(raw.logistics);
  const payloadSettings = asObject(raw.public_settings);
  const mergedSettings = { ...payloadSettings, ...asObject(settings) };
  const items = normalizeItems({ ...raw, public_settings: mergedSettings });
  const subtotalAed = items.reduce((sum, item) => sum + item.totalAed, 0);
  const deliveryAed = firstNumber(breakdown.delivery, fees.logistics, logistics.deliveryAed, totals.logistics_aed);
  const packingAed = firstNumber(breakdown.packaging, fees.packaging, logistics.packingAed, totals.packing_aed);
  const commissionAed = firstNumber(breakdown.commission, fees.commission, logistics.serviceFeeAed, totals.commission_aed);
  const totalsGrand = firstNumber(breakdown.total, totals.grand_total_aed, totals.grand_total);
  const grandTotalAed = totalsGrand > 0 ? totalsGrand : subtotalAed + deliveryAed + packingAed + commissionAed;
  const rates = normalizeRates(pricing.rates || breakdown.rates);
  const rawCurrency = String(pricing.currency || breakdown.currency || 'USD').toUpperCase();
  const currency = (['AED', 'USD', 'RUB', 'TJS', 'KZT'].includes(rawCurrency) ? rawCurrency : 'USD') as QuoteCurrency;

  const documentsRaw = asObject(raw.documents);
  const documents: QuoteDocument[] = [];
  pushDocument(documents, raw.pdf_url, 'PDF invoice', 'invoice');
  pushDocument(documents, raw.invoice_url, 'PDF invoice', 'invoice');
  pushDocument(documents, documentsRaw.pdf, 'PDF invoice', 'invoice');
  pushDocument(documents, documentsRaw.invoice, 'PDF invoice', 'invoice');
  pushDocument(documents, raw.cargo_pdf_url, 'Cargo & Logistics', 'cargo');
  pushDocument(documents, raw.cargo_url, 'Cargo & Logistics', 'cargo');
  pushDocument(documents, raw.logistics_url, 'Cargo & Logistics', 'cargo');
  pushDocument(documents, raw.logistics_pdf_url, 'Cargo & Logistics', 'cargo');
  pushDocument(documents, documentsRaw.cargo, 'Cargo & Logistics', 'cargo');
  pushDocument(documents, documentsRaw.cargo_pdf, 'Cargo & Logistics', 'cargo');
  pushDocument(documents, documentsRaw.logistics, 'Cargo & Logistics', 'cargo');
  pushDocument(documents, documentsRaw.logistics_pdf, 'Cargo & Logistics', 'cargo');
  asArray(documentsRaw.files).forEach((file: any, index: number) => {
    const fileObj = asObject(file);
    const href = firstString(fileObj.url, fileObj.href, fileObj.link, typeof file === 'string' ? file : '');
    const label = firstString(fileObj.label, fileObj.title, fileObj.name) || `Document ${index + 1}`;
    const kind = /cargo|logistic|delivery|shipment|transport/i.test(label) ? 'cargo' : /invoice|pdf/i.test(label) ? 'invoice' : 'document';
    pushDocument(documents, href, label, kind as QuoteDocument['kind']);
  });

  const contact: QuoteContact = {
    whatsapp: digits(firstString(raw.contact?.whatsapp_phone, raw.contacts?.whatsapp, raw.public_contact?.whatsapp, mergedSettings.publicWhatsappNumber)),
    telegram: firstString(raw.contact?.telegram, raw.contacts?.telegram, raw.public_contact?.telegram, mergedSettings.publicTelegramUrl) || '',
    instagram: firstString(raw.contact?.instagram, raw.contacts?.instagram, raw.public_contact?.instagram, mergedSettings.publicInstagramUrl) || '',
    managerName: firstString(mergedSettings.publicManagerName, raw.contact?.display_name, raw.owner?.display_name) || 'Dubai Spares UAE',
    logoUrl: firstString(mergedSettings.publicCompanyLogoUrl) || '',
    signatureUrl: firstString(mergedSettings.publicInvoiceSignatureUrl) || '',
    workTerms: firstString(mergedSettings.publicWorkTerms) || '',
    deliveryTerms: firstString(mergedSettings.publicDeliveryTerms) || '',
  };

  return {
    raw: { ...raw, public_settings: mergedSettings },
    order: {
      brand: firstString(order.brand, raw.brand?.name) || '—',
      model: firstString(order.model) || '',
      year: order.year || '',
      vin: firstString(order.vin) || '—',
      bodyType: firstString(order.body_type, order.bodyType) || '',
      carPhotoUrl: firstString(
        order.carPhotos?.[0],
        order.carPhotoUrl,
        order.car_photos?.[0],
        order.car_photo_url,
        raw.carPhotos?.[0],
        raw.carPhotoUrl,
        raw.car_photos?.[0],
        raw.car_photo_url,
      ) || '',
    },
    rates,
    currency,
    items,
    deliveryAed,
    packingAed,
    commissionAed,
    grandTotalAed,
    subtotalAed,
    contact,
    cargoInput: {
      logistics,
      parts: asArray(raw.parts).map((part: any) => ({
        quantity: Number(part.qty || part.quantity || 1),
        weightKg: Number(part.weight_kg || part.weightKg || 0),
        places: Number(part.places || 0),
        cargoPlaceGroup: part.cargo_place_group || part.cargoPlaceGroup,
        isOversized: Boolean(part.is_oversized || part.isOversized),
      })),
    },
    pdfHref: firstString(raw.pdf_url, raw.invoice_url, raw.documents?.pdf, raw.documents?.invoice) || '',
    documents,
    hasRenderableContent: Boolean(
      items.length
      || firstString(order.brand, order.model, order.vin, raw.brand?.name)
      || grandTotalAed > 0
      || contact.whatsapp
      || contact.telegram
      || contact.instagram
      || contact.workTerms
      || contact.deliveryTerms
    ),
  };
};
