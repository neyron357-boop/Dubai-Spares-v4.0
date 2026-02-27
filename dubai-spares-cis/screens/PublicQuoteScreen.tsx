import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Images,
  ChevronRight,
  Download,
  Globe,
  Instagram,
  MessageCircle,
  RefreshCcw,
  Send
} from 'lucide-react';
import { Order, PriceVariant } from '../types';
import ImagePreview from '../components/ImagePreview';
import { DEFAULT_QUOTE_RATES, parsePublicQuoteKey, parseQuoteRates, QuoteCurrency, QuoteRates } from '../shareUtils';
import { getOptimizedImageUrl } from '../storage/photos';
import { logger } from '../logging';
import { publicQuoteGetPublicContactSettings, publicQuoteGetSnapshot, resolveClientUnitPriceAed } from '../publicQuoteApi';

type Language = 'en' | 'ru';

const CURRENCY_LABELS: Record<QuoteCurrency, string> = { AED: 'Dirham', USD: 'Dollar', RUB: 'Ruble', TJS: 'Somoni' };

enum EstimateErrorType {
  INVALID_LINK = 'INVALID_LINK',
  NOT_FOUND = 'NOT_FOUND',
  NO_ACCESS = 'NO_ACCESS',
  OFFLINE = 'OFFLINE',
  SERVER_ERROR = 'SERVER_ERROR',
  EXPIRED_LINK = 'EXPIRED_LINK'
}

const i18n = {
  en: {
    quoteUnavailable: 'Quote not available.',
    invalidTitle: 'Invalid link',
    invalidBody: 'This quote link is missing a token.',
    quoteExpired: 'Quote expired',
    quoteExpiredBody: 'This quote link is no longer active. Please contact us to refresh pricing and availability.',
    contactUs: 'Contact us',
    quoteNotFound: 'Quote not found.',
    noAccessTitle: 'No access to quote',
    noAccessBody: 'This quote belongs to another account or requires authorization.',
    offlineTitle: 'No internet connection',
    offlineBody: 'Check your connection and try again, or open the cached version.',
    serverErrorTitle: 'Server error',
    serverErrorBody: 'We are already working on it. Please try again in a moment.',
    notFoundTitle: 'Quote not found',
    notFoundBody: 'It may have been deleted or the link is outdated.',
    expiredTitle: 'Quote link expired',
    expiredBody: 'Request a fresh link to see current pricing and availability.',
    retry: 'Retry',
    backToOrders: 'Back to orders',
    openOffline: 'Open offline version',
    loading: 'Loading quotation…',
    currency: 'Currency',
    source: 'Source',
    refresh: 'Refresh',
    quoteTotal: 'Quote total',
    finalClientPrice: 'Final client price',
    confirmWhatsApp: 'Confirm & WhatsApp',
    viewParts: 'View Parts & Photos',
    whatIncluded: "What's included",
    partsGallery: 'Parts gallery',
    status: 'Status',
    inStock: 'In stock',
    onOrder: 'On order',
    premiumSupplier: 'Premium supplier',
    partsVerified: 'Parts verified',
    showBreakdown: 'Show breakdown',
    hideBreakdown: 'Hide breakdown',
    priceBreakdown: 'Price breakdown',
    partsSubtotal: 'Parts subtotal',
    serviceFee: 'Commission',
    markup: 'Markup',
    packing: 'Packing',
    logistics: 'Logistics',
    delivery: 'Delivery',
    total: 'Total',
    trust: 'Trust',
    validUntil: 'Price valid until',
    availabilityChange: 'Availability can change quickly due to live market demand.',
    trustedBy: 'Trusted by CIS customers',
    yards: 'We work with Dubai scrap yards & shops daily.',
    response: 'Response time: usually 5–15 min.',
    companyProfile: 'Company profile',
    downloadPdf: 'Download PDF Quote',
    noPositions: 'No positions',
    contactNotConfigured: 'Contact not configured'
  },
  ru: {
    quoteUnavailable: 'Предложение недоступно.',
    invalidTitle: 'Неверная ссылка',
    invalidBody: 'В ссылке отсутствует токен сметы.',
    quoteExpired: 'Срок предложения истёк',
    quoteExpiredBody: 'Ссылка на смету больше не активна. Напишите нам, чтобы обновить цену и наличие.',
    contactUs: 'Связаться с нами',
    quoteNotFound: 'Смета не найдена.',
    noAccessTitle: 'Нет доступа к смете',
    noAccessBody: 'Эта смета принадлежит другому аккаунту или требует авторизации.',
    offlineTitle: 'Нет подключения',
    offlineBody: 'Проверьте интернет и попробуйте снова или откройте кешированную версию.',
    serverErrorTitle: 'Ошибка сервера',
    serverErrorBody: 'Мы уже работаем над этим. Попробуйте снова через минуту.',
    notFoundTitle: 'Смета не найдена',
    notFoundBody: 'Возможно, она была удалена или ссылка устарела.',
    expiredTitle: 'Ссылка на смету истекла',
    expiredBody: 'Запросите новую ссылку, чтобы увидеть актуальную цену и наличие.',
    retry: 'Повторить',
    backToOrders: 'Вернуться к заказам',
    openOffline: 'Открыть офлайн-версию',
    loading: 'Загрузка сметы…',
    currency: 'Валюта',
    source: 'Источник',
    refresh: 'Обновить',
    quoteTotal: 'Итоговая цена',
    finalClientPrice: 'Финальная цена для клиента',
    confirmWhatsApp: 'Подтвердить в WhatsApp',
    viewParts: 'Смотреть детали и фото',
    whatIncluded: 'Что входит в цену',
    partsGallery: 'Галерея деталей',
    status: 'Статус',
    inStock: 'В наличии',
    onOrder: 'Под заказ',
    premiumSupplier: 'Премиум поставщик',
    partsVerified: 'Детали подтверждены',
    showBreakdown: 'Показать разбивку',
    hideBreakdown: 'Скрыть разбивку',
    priceBreakdown: 'Разбивка цены',
    partsSubtotal: 'Сумма деталей',
    serviceFee: 'Комиссия',
    markup: 'Наценка',
    packing: 'Упаковка',
    logistics: 'Логистика',
    delivery: 'Доставка',
    total: 'Итого',
    trust: 'Доверие',
    validUntil: 'Цена действует до',
    availabilityChange: 'Наличие может быстро меняться из-за живого рынка.',
    trustedBy: 'Нам доверяют клиенты из СНГ',
    yards: 'Мы ежедневно работаем с авторазборками и магазинами Дубая.',
    response: 'Скорость ответа: обычно 5–15 минут.',
    companyProfile: 'Профиль компании',
    downloadPdf: 'Скачать PDF смету',
    noPositions: 'Нет позиций',
    contactNotConfigured: 'Контакт не настроен'
  }
} as const;

const parseTimestamp = (value: string | number | null | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const d = Date.parse(value);
    if (!Number.isNaN(d)) return d;
  }
  return Date.now();
};

const parseMoneyValue = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseMoneyField = (...values: Array<unknown>) => {
  for (const value of values) {
    const parsed = parseMoneyValue(value);
    if (parsed !== null) return parsed;
  }
  return 0;
};



type QuoteBreakdown = {
  partsTotal: number;
  delivery: number;
  packaging: number;
  commission: number;
  total: number;
  currency: string;
  fxRate: number;
  rates?: Record<string, number>;
};

type QuoteContact = {
  whatsappPhone: string;
  displayName: string;
  phone: string;
  instagram: string;
  telegram: string;
};

type SnapshotDebugMeta = {
  snapshot: string;
  token: string;
  snapshotRowId: string;
  snapshotSource: 'payload_json' | 'payload_b64' | 'payload' | 'none';
  contactsSource: 'snapshot' | 'settings' | 'legacy';
};

type NormalizedPayloadItem = {
  title: string;
  qty: number;
  unitPrice: number;
  currency: QuoteCurrency | 'AED';
};

const toPhoneDigits = (value: string | null | undefined) => (value || '').replace(/\D/g, '');
const DEFAULT_PUBLIC_WHATSAPP = '971521574546';

const normalizeWhatsappPhone = (value: string | null | undefined) => {
  const digits = toPhoneDigits(value);
  if (!digits) return '';
  if (digits.startsWith('971')) return digits;
  if (digits.startsWith('00971')) return digits.slice(2);
  if (digits.startsWith('05') && digits.length === 10) return `971${digits.slice(1)}`;
  if (digits.startsWith('5') && digits.length === 9) return `971${digits}`;
  return digits;
};

const warnMissingField = (field: string) => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.warn(`[PUBLIC_QUOTE] missing field in payload: ${field}`);
  }
};

const resolveBreakdownFromPayload = (payload: Record<string, unknown>): QuoteBreakdown => {
  const breakdownObj = payload.breakdown && typeof payload.breakdown === 'object' ? payload.breakdown as Record<string, unknown> : {};
  const totalsObj = payload.totals && typeof payload.totals === 'object' ? payload.totals as Record<string, unknown> : {};
  const pricingObj = payload.pricing && typeof payload.pricing === 'object' ? payload.pricing as Record<string, unknown> : {};
  const logisticsObj = payload.logistics && typeof payload.logistics === 'object' ? payload.logistics as Record<string, unknown> : {};

  const readWithFallback = (name: string, ...values: Array<unknown>) => {
    const parsed = parseMoneyValue(values.find((value) => parseMoneyValue(value) !== null));
    if (parsed === null) {
      warnMissingField(name);
      return 0;
    }
    return parsed;
  };

  const partsTotal = readWithFallback('breakdown.parts_total', breakdownObj.parts_total, breakdownObj.partsTotal, totalsObj.parts_sum_aed, payload.parts_total, payload.partsTotal);
  const delivery = readWithFallback('breakdown.delivery', breakdownObj.delivery, payload.delivery, payload.logistics, payload.shipping_fee, logisticsObj.deliveryAed, logisticsObj.delivery, totalsObj.logistics_aed);
  const packaging = readWithFallback('breakdown.packaging', breakdownObj.packaging, payload.packaging, payload.packing_fee, logisticsObj.packingAed, logisticsObj.packaging, totalsObj.packing_aed);
  const commission = readWithFallback('breakdown.commission', breakdownObj.commission, payload.commission, payload.service_fee, logisticsObj.serviceFeeAed, logisticsObj.commission, totalsObj.commission_aed);
  const total = readWithFallback('breakdown.total', breakdownObj.total, totalsObj.grand_total_aed, payload.total);
  const currency = String(breakdownObj.currency || pricingObj.currency || payload.currency || 'AED');
  const fxRate = parseMoneyField(breakdownObj.fx_rate, breakdownObj.fxRate, pricingObj.fx_rate, payload.exchange_rate, 1);
  const rates = (breakdownObj.rates && typeof breakdownObj.rates === 'object' ? breakdownObj.rates : pricingObj.rates) as Record<string, number> | undefined;

  return { partsTotal, delivery, packaging, commission, total, currency, fxRate, rates };
};

const resolveContactFromPayload = (payload: Record<string, unknown>, fallbackSettings?: ReturnType<typeof normalizePublicSettings>): QuoteContact => {
  const contactsObj = payload.contacts && typeof payload.contacts === 'object' ? payload.contacts as Record<string, unknown> : {};
  const managerContactObj = payload.manager_contact && typeof payload.manager_contact === 'object' ? payload.manager_contact as Record<string, unknown> : {};
  const contactObj = payload.contact && typeof payload.contact === 'object' ? payload.contact as Record<string, unknown> : {};
  const publicContactObj = payload.public_contact && typeof payload.public_contact === 'object' ? payload.public_contact as Record<string, unknown> : {};
  const ownerObj = payload.owner && typeof payload.owner === 'object' ? payload.owner as Record<string, unknown> : {};
  const settingsObj = normalizePublicSettings(payload.public_settings || payload.publicSettings || {});
  const merged = fallbackSettings || settingsObj;
  const snapshotWhatsapp = String(contactsObj.whatsapp || contactsObj.whatsapp_phone || contactsObj.whatsappPhone || contactsObj.phone || '');
  const settingsWhatsapp = String(merged.publicWhatsappNumber || '');
  const legacyWhatsapp = String(
    publicContactObj.whatsapp
    || publicContactObj.whatsapp_phone
    || publicContactObj.whatsappPhone
    || publicContactObj.phone
    || managerContactObj.whatsapp_phone
    || managerContactObj.whatsapp
    || managerContactObj.whatsappPhone
    || managerContactObj.phone
    || contactObj.whatsapp_phone
    || contactObj.whatsapp
    || contactObj.whatsappPhone
    || contactObj.phone
    || ownerObj.whatsapp_phone
    || ownerObj.whatsappPhone
    || ownerObj.phone
    || ''
  );
  const whatsapp = normalizeWhatsappPhone(snapshotWhatsapp || settingsWhatsapp || legacyWhatsapp);

  const snapshotTelegram = String(contactsObj.telegram || '');
  const legacyTelegram = String(publicContactObj.telegram || contactObj.telegram || '');
  const snapshotInstagram = String(contactsObj.instagram || '');
  const legacyInstagram = String(publicContactObj.instagram || contactObj.instagram || '');

  return {
    whatsappPhone: whatsapp,
    displayName: String(managerContactObj.display_name || contactObj.display_name || ownerObj.display_name || 'Dubai Spares UAE'),
    phone: normalizeWhatsappPhone(String(contactObj.phone || merged.publicWhatsappNumber || whatsapp || '')),
    instagram: String(snapshotInstagram || merged.publicInstagramUrl || legacyInstagram || ''),
    telegram: String(snapshotTelegram || merged.publicTelegramUrl || legacyTelegram || '')
  };
};

const getItemRowsFromPayload = (payload: Record<string, unknown>) => {
  const candidates = ['items', 'parts', 'lines', 'positions'].map((key) => payload[key]);
  const rows = candidates.find((value) => Array.isArray(value)) as Array<Record<string, unknown>> | undefined;
  return Array.isArray(rows) ? rows : [];
};

const normalizePayloadItems = (payload: Record<string, unknown>, managerCurrency: QuoteCurrency | 'AED'): NormalizedPayloadItem[] => {
  const rows = getItemRowsFromPayload(payload);
  const markupPercent = parseMoneyField(payload.markupPercent, payload.markup_percent, (payload.order as any)?.markupPercent, (payload.order as any)?.markup_percent, 0);
  return rows.map((row, index) => {
    const qty = parseMoneyField(row.qty, row.quantity, row.count, 1) || 1;
    const explicitUnitPrice = resolveClientUnitPriceAed(row, { markupPercent });
    const lineTotal = parseMoneyField(row.line_total, row.lineTotal, row.total, explicitUnitPrice * qty);
    const unitPrice = explicitUnitPrice > 0 ? explicitUnitPrice : (qty > 0 ? lineTotal / qty : lineTotal);
    const currency = normalizeCurrencyCode(row.currency || row.price_currency || managerCurrency);
    return {
      title: String(row.title || row.name || row.part_name || `Item ${index + 1}`),
      qty,
      unitPrice,
      currency
    };
  });
};

const normalizeCurrencyCode = (value: unknown): QuoteCurrency | 'AED' => {
  const raw = String(value || '').toUpperCase().trim();
  if (raw === 'USD' || raw === 'RUB' || raw === 'TJS' || raw === 'AED') return raw;
  return 'AED';
};

const convertFromSourceToAed = (amount: number, sourceCurrency: QuoteCurrency | 'AED', activeRates: QuoteRates) => {
  if (sourceCurrency === 'AED') return amount;
  const sourceRate = activeRates[sourceCurrency as QuoteCurrency];
  if (!sourceRate || sourceRate <= 0) return amount;
  return amount / sourceRate;
};

const resolveTotalsFromPayload = (payload: Record<string, unknown>, activeRates: QuoteRates) => {
  const breakdownObj = payload.breakdown && typeof payload.breakdown === 'object' ? payload.breakdown as Record<string, unknown> : {};
  const totalsObj = payload.totals && typeof payload.totals === 'object' ? payload.totals as Record<string, unknown> : {};
  const logisticsObj = payload.logistics && typeof payload.logistics === 'object' ? payload.logistics as Record<string, unknown> : {};
  const pricingObj = payload.pricing && typeof payload.pricing === 'object' ? payload.pricing as Record<string, unknown> : {};
  const feesObj = payload.fees && typeof payload.fees === 'object' ? payload.fees as Record<string, unknown> : {};

  const payloadRates = ((breakdownObj.rates && typeof breakdownObj.rates === 'object' ? breakdownObj.rates : pricingObj.rates) || {}) as Record<string, number>;
  const mergedRates: QuoteRates = {
    AED: Number(payloadRates.AED) > 0 ? Number(payloadRates.AED) : activeRates.AED,
    USD: Number(payloadRates.USD) > 0 ? Number(payloadRates.USD) : activeRates.USD,
    RUB: Number(payloadRates.RUB) > 0 ? Number(payloadRates.RUB) : activeRates.RUB,
    TJS: Number(payloadRates.TJS) > 0 ? Number(payloadRates.TJS) : activeRates.TJS
  };

  const managerCurrency = normalizeCurrencyCode(pricingObj.currency || payload.currency || breakdownObj.currency);
  const items = normalizePayloadItems(payload, managerCurrency);
  const itemsTotalAedFromLines = items.reduce((sum, item) => {
    const unitPriceAed = convertFromSourceToAed(item.unitPrice, item.currency, mergedRates);
    return sum + unitPriceAed * item.qty;
  }, 0);
  const partsTotalFromTotals = parseMoneyValue(totalsObj.parts_total) ?? parseMoneyValue(totalsObj.parts_sum_aed);
  const partsTotalAed = parseMoneyField(partsTotalFromTotals, totalsObj.parts_sum_aed, breakdownObj.parts_total, payload.parts_total, payload.partsTotal, itemsTotalAedFromLines);

  const deliveryAed = parseMoneyField(
    feesObj.logistics,
    logisticsObj.deliveryAed,
    logisticsObj.delivery,
    breakdownObj.delivery,
    totalsObj.logistics_aed,
    payload.delivery
  );
  const packingAed = parseMoneyField(
    feesObj.packaging,
    logisticsObj.packingAed,
    logisticsObj.packing,
    logisticsObj.packaging,
    breakdownObj.packaging,
    totalsObj.packing_aed,
    payload.packing
  );
  const commissionAed = parseMoneyField(
    feesObj.commission,
    logisticsObj.serviceFeeAed,
    logisticsObj.commission,
    breakdownObj.commission,
    totalsObj.commission_aed,
    payload.commission
  );
  const feesTotalAed = deliveryAed + packingAed + commissionAed;
  const computedGrandTotalAed = partsTotalAed + feesTotalAed;
  const grandTotalFromTotals = parseMoneyValue(totalsObj.grand_total) ?? parseMoneyValue(totalsObj.grand_total_aed);
  const grandTotalAed = parseMoneyField(
    totalsObj.grand_total,
    totalsObj.grand_total_aed,
    breakdownObj.total,
    payload.total,
    computedGrandTotalAed
  );
  const normalizedGrandTotalAed = grandTotalAed + 0.01 < computedGrandTotalAed
    ? computedGrandTotalAed
    : grandTotalAed;

  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.log('[PUBLIC_QUOTE] totals diagnostics:', {
      itemFieldResolved: items.length > 0 ? 'items/parts/lines/positions' : 'none',
      itemsCount: items.length,
      managerCurrency,
      deliveryAed,
      packingAed,
      commissionAed,
      itemsTotalAed: partsTotalAed,
      feesTotalAed,
      grandTotalAed: normalizedGrandTotalAed
    });
  }

  const computedFrom: 'totals' | 'recompute(items)' = partsTotalFromTotals !== null && grandTotalFromTotals !== null ? 'totals' : 'recompute(items)';
  return { items, itemsTotalAed: partsTotalAed, deliveryAed, packingAed, commissionAed, feesTotalAed, grandTotalAed: normalizedGrandTotalAed, computedFrom };
};

const parseEmbeddedSnapshot = (raw: string | null): any | null => {
  if (!raw) return null;
  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const decoded = decodeURIComponent(escape(atob(padded)));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

const normalizeLogistics = (raw: any) => {
  if (!raw || typeof raw !== 'object') return undefined;

  const deliveryAed = parseMoneyField(
    raw.deliveryAed,
    raw.delivery_aed,
    raw.delivery,
    raw.logisticsAed,
    raw.logistics_aed,
    raw.logistics,
    raw.totalsLogisticsAed
  );
  const packingAed = parseMoneyField(raw.packingAed, raw.packing_aed, raw.packing, raw.packagingAed, raw.packaging_aed, raw.packaging, raw.totalsPackingAed);
  const serviceFeeAed = parseMoneyField(
    raw.serviceFeeAed,
    raw.service_fee_aed,
    raw.serviceFee,
    raw.service_fee,
    raw.commissionAed,
    raw.commission_aed,
    raw.commission,
    raw.fee,
    raw.totalsCommissionAed
  );
  const deliveryType = raw.deliveryType || raw.delivery_type;

  if (deliveryAed <= 0 && packingAed <= 0 && serviceFeeAed <= 0) return undefined;

  return {
    deliveryType: (deliveryType === 'export' ? 'export' : 'uae') as 'uae' | 'export',
    deliveryAed,
    packingAed,
    serviceFeeAed
  };
};

const resolveOrderLogistics = (row: any) => {
  const mergedSources = {
    ...(row?.logistics && typeof row.logistics === 'object' ? row.logistics : {}),
    ...(row?.pricingBreakdown && typeof row.pricingBreakdown === 'object' ? row.pricingBreakdown : {}),
    ...(row?.pricing_breakdown && typeof row.pricing_breakdown === 'object' ? row.pricing_breakdown : {}),
    deliveryAed: row?.deliveryAed,
    delivery_aed: row?.delivery_aed,
    delivery: row?.delivery,
    logisticsAed: row?.logisticsAed,
    logistics_aed: row?.logistics_aed,
    logistics: row?.logistics_total,
    packingAed: row?.packingAed,
    packing_aed: row?.packing_aed,
    packing: row?.packing,
    serviceFeeAed: row?.serviceFeeAed,
    service_fee_aed: row?.service_fee_aed,
    serviceFee: row?.serviceFee,
    service_fee: row?.service_fee,
    commissionAed: row?.commissionAed,
    commission_aed: row?.commission_aed,
    commission: row?.commission,
    fee: row?.fee,
    totalsLogisticsAed: row?.totals?.logistics_aed,
    totalsPackingAed: row?.totals?.packing_aed,
    totalsCommissionAed: row?.totals?.commission_aed,
    deliveryType: row?.deliveryType,
    delivery_type: row?.delivery_type
  };

  return normalizeLogistics(mergedSources);
};

const maskVin = (vin: string) => (vin.length > 8 ? `${vin.slice(0, 5)}...${vin.slice(-4)}` : vin || 'N/A');

const APP_VERSION = (import.meta as any).env?.VITE_APP_VERSION || 'dev';
const GIT_SHA = (import.meta as any).env?.VITE_GIT_SHA || 'local';
const BUILD_TIME = (import.meta as any).env?.VITE_BUILD_TIME || 'unknown';

const fetchPublicSnapshot = (token: string, signal?: AbortSignal, snapshotId?: string | null) => publicQuoteGetSnapshot(token, { signal, timeoutMs: 20_000, snapshotId });

const mapDbOrder = (row: any): Order => ({
  id: String(row.id),
  brand: row.brand || '',
  model: row.model || '',
  year: row.year || '',
  bodyType: row.body_type || '',
  vin: row.vin || '',
  vinPhotoUrl: row.vin_photo_url || '',
  priority: row.priority || 'MEDIUM',
  status: row.status || 'in_progress',
  salesStatus: row.sales_status,
  clientName: row.client_name || '',
  source: row.source || 'WhatsApp',
  carPhotoUrl: row.car_photo_url || row.car_photos?.[0] || row.vin_photo_url || '',
  carPhotos: row.car_photos || [],
  logistics: resolveOrderLogistics(row),
  markupType: row.markup_type || 'percent',
  markupFixedAed: Number(row.markup_fixed_aed || 0),
  parts: (row.parts || []).map((part: any) => ({
    id: String(part.id),
    orderId: String(part.order_id || row.id),
    name: part.name || 'Part',
    photoUrl: part.photo_url || part.photos?.[0] || '',
    photos: part.photos || [],
    isFound: !!part.is_found,
    variants: (part.price_variants || []).map((variant: any): PriceVariant => ({
      id: String(variant.id),
      partId: String(variant.part_id || part.id),
      priceAed: Number(variant.price_aed || 0),
      condition: variant.condition,
      availability: variant.availability,
      shopName: variant.shop_name || '',
      phone: variant.phone || '',
      location: variant.location || '',
      photoUrl: variant.photo_url || variant.photos?.[0] || '',
      photos: variant.photos || [],
      createdAt: parseTimestamp(variant.created_at)
    }))
  })),
  markupPercent: Number(row.markup_percent || 0),
  exchangeRate: Number(row.exchange_rate || 3.67),
  createdAt: parseTimestamp(row.created_at),
  isArchived: !!row.is_archived,
  isSold: !!row.is_sold,
  pricingEvents: Array.isArray(row.pricing_events) ? row.pricing_events : []
});

const mapSnapshotOrder = (row: any): Order => {
  const header = row?.order && typeof row.order === 'object' ? row.order : row;
  const publicSettingsRaw = row?.public_settings || row?.publicSettings || row?.public_contact_settings || null;
  const payloadOwner = row?.owner || row?.payloadOwner || row?.payload_owner || null;
  return ({
  id: String(row?.order_id || header?.id || ''),
  brand: header?.brand || row?.brand || '',
  model: header?.model || row?.model || '',
  year: header?.year || row?.year || '',
  bodyType: row?.bodyType || row?.body_type || '',
  vin: header?.vin || row?.vin || '',
  vinPhotoUrl: row?.vinPhotoUrl || row?.vin_photo_url || '',
  priority: row?.priority || 'MEDIUM',
  status: row?.status || 'in_progress',
  salesStatus: row?.salesStatus || row?.sales_status,
  clientName: row?.clientName || row?.client_name || '',
  source: header?.source || row?.source || 'WhatsApp',
  carPhotoUrl: row?.carPhotoUrl || row?.car_photo_url || header?.carPhotoUrl || header?.car_photo_url || row?.carPhotos?.[0] || row?.car_photos?.[0] || header?.carPhotos?.[0] || header?.car_photos?.[0] || row?.vinPhotoUrl || row?.vin_photo_url || header?.vinPhotoUrl || header?.vin_photo_url || '',
  carPhotos: row?.carPhotos || row?.car_photos || header?.carPhotos || header?.car_photos || [],
  logistics: resolveOrderLogistics(row),
  markupType: header?.markupType || row?.markupType || row?.markup_type || 'percent',
  markupFixedAed: Number(header?.markupFixedAed ?? row?.markupFixedAed ?? row?.markup_fixed_aed ?? row?.totals?.markup_aed ?? 0),
  parts: (row?.parts || []).map((part: any) => {
    const variantPrice = Number(part?.supplier_price_aed ?? part?.supplierPriceAed ?? part?.priceAed ?? part?.price_aed ?? part?.price ?? 0);
    const photos = part?.photo_urls || part?.photos || [];
    return ({
    id: String(part?.id || ''),
    orderId: String(part?.orderId || part?.order_id || row?.order_id || row?.id || ''),
    name: part?.name || 'Part',
    photoUrl: part?.photoUrl || part?.photo_url || photos?.[0] || '',
    photos,
    isFound: !!part?.isFound || !!part?.is_found,
    variants: (part?.variants || part?.price_variants || [{ id: `${part?.id || 'variant'}-public`, priceAed: variantPrice, price_aed: variantPrice }]).map((variant: any): PriceVariant => ({
      id: String(variant?.id || ''),
      partId: String(variant?.partId || variant?.part_id || part?.id || ''),
      priceAed: Number(variant?.priceAed ?? variant?.price_aed ?? 0),
      condition: variant?.condition,
      availability: variant?.availability,
      shopName: variant?.shopName || variant?.shop_name || '',
      phone: variant?.phone || '',
      location: variant?.location || '',
      photoUrl: variant?.photoUrl || variant?.photo_url || variant?.photo_urls?.[0] || variant?.photos?.[0] || '',
      photos: variant?.photos || variant?.photo_urls || [],
      createdAt: parseTimestamp(variant?.createdAt ?? variant?.created_at),
      priceClientAed: variant?.priceClientAed ?? variant?.price_client_aed,
      priceWithMarkupAed: variant?.priceWithMarkupAed ?? variant?.price_with_markup_aed,
      finalPriceAed: variant?.finalPriceAed ?? variant?.final_price_aed,
      clientPriceAed: variant?.clientPriceAed ?? variant?.client_price_aed
    } as PriceVariant & Record<string, unknown>))
  });
  }),
  markupPercent: Number(header?.markupPercent ?? row?.markupPercent ?? row?.markup_percent ?? 0),
  exchangeRate: Number(header?.exchangeRate ?? row?.exchangeRate ?? row?.exchange_rate ?? row?.exchange_rate ?? 3.67),
  createdAt: parseTimestamp(row?.createdAt ?? row?.created_at),
  isArchived: !!row?.isArchived || !!row?.is_archived,
  isSold: !!row?.isSold || !!row?.is_sold,
  pricingEvents: Array.isArray(row?.pricingEvents || row?.pricing_events) ? (row?.pricingEvents || row?.pricing_events) : [],
  payloadOwner,
  public_settings: publicSettingsRaw
} as Order & { payloadOwner?: unknown; public_settings?: unknown });
};

const normalizePublicSettings = (raw: unknown) => {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const read = (...keys: string[]) => {
    for (const key of keys) {
      const value = src[key];
      if (typeof value === 'string') return value;
    }
    return '';
  };

  return {
    publicWhatsappNumber: read('publicWhatsappNumber', 'public_whatsapp_number', 'whatsapp_phone', 'phone', 'whatsappPhone'),
    publicTelegramUrl: read('publicTelegramUrl', 'public_telegram_url', 'telegram', 'telegramUrl'),
    publicInstagramUrl: read('publicInstagramUrl', 'public_instagram_url', 'instagram', 'instagramUrl'),
    publicDeliveryTerms: read('publicDeliveryTerms', 'public_delivery_terms', 'deliveryTerms', 'delivery_terms'),
    publicWorkTerms: read('publicWorkTerms', 'public_work_terms', 'workTerms', 'work_terms'),
    publicCompanyLogoUrl: read('publicCompanyLogoUrl', 'public_company_logo_url', 'companyLogoUrl', 'logo', 'logoUrl'),
    publicInvoiceSignatureUrl: read('publicInvoiceSignatureUrl', 'public_invoice_signature_url', 'invoiceSignatureUrl', 'signature', 'signatureUrl')
  };
};


const isDisplayablePhotoUrl = (value: string) => (
  value.startsWith('http://')
  || value.startsWith('https://')
  || value.startsWith('data:image')
);

const normalizePhotoKey = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/storage/v1/object/public/')) {
      parsed.searchParams.delete('width');
      parsed.searchParams.delete('quality');
      parsed.searchParams.delete('format');
    }
    return parsed.toString();
  } catch {
    return url;
  }
};

const sanitizePhotoList = (photos: string[]) => {
  const seen = new Set<string>();
  const next: string[] = [];
  photos
    .map((photo) => String(photo || '').trim())
    .filter((photo) => !!photo && !photo.startsWith('local://') && !photo.startsWith('blob:') && isDisplayablePhotoUrl(photo))
    .forEach((photo) => {
      const key = normalizePhotoKey(photo);
      if (seen.has(key)) return;
      seen.add(key);
      next.push(photo);
    });
  return next;
};

const isPlaceholderWhatsapp = (value: string | null | undefined) => {
  const digits = toPhoneDigits(value);
  return digits === '971000000000';
};

const mergePublicSettings = (
  preferred: ReturnType<typeof normalizePublicSettings>,
  fallback: ReturnType<typeof normalizePublicSettings> | null
) => ({
  publicWhatsappNumber: (() => {
    const preferredWhatsapp = normalizeWhatsappPhone(preferred.publicWhatsappNumber || '');
    const fallbackWhatsapp = normalizeWhatsappPhone(fallback?.publicWhatsappNumber || '');
    if (preferredWhatsapp && !isPlaceholderWhatsapp(preferredWhatsapp)) return preferredWhatsapp;
    if (fallbackWhatsapp && !isPlaceholderWhatsapp(fallbackWhatsapp)) return fallbackWhatsapp;
    return DEFAULT_PUBLIC_WHATSAPP;
  })(),
  publicTelegramUrl: preferred.publicTelegramUrl || fallback?.publicTelegramUrl || '',
  publicInstagramUrl: preferred.publicInstagramUrl || fallback?.publicInstagramUrl || '',
  publicDeliveryTerms: preferred.publicDeliveryTerms || fallback?.publicDeliveryTerms || '',
  publicWorkTerms: preferred.publicWorkTerms || fallback?.publicWorkTerms || '',
  publicCompanyLogoUrl: preferred.publicCompanyLogoUrl || fallback?.publicCompanyLogoUrl || '',
  publicInvoiceSignatureUrl: preferred.publicInvoiceSignatureUrl || fallback?.publicInvoiceSignatureUrl || ''
});

const normalizePayloadOwner = (raw: unknown) => {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const read = (...keys: string[]) => {
    for (const key of keys) {
      const value = src[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
  };
  return {
    whatsappPhone: read('whatsapp_phone', 'whatsappPhone', 'phone', 'publicWhatsappNumber')
  };
};

const isRelationQueryError = (error: unknown) => {
  if (typeof error !== 'object' || !error) return false;
  const anyErr = error as { code?: unknown; message?: unknown };
  const message = typeof anyErr.message === 'string' ? anyErr.message.toLowerCase() : '';
  return (anyErr.code === 'PGRST200' || anyErr.code === 'PGRST201')
    && (message.includes('relationship') || message.includes('embedded') || message.includes('not found'));
};

const isMissingColumnError = (error: unknown) => {
  if (typeof error !== 'object' || !error) return false;
  const anyErr = error as { code?: unknown; message?: unknown };
  if (typeof anyErr.message !== 'string') return false;
  if (anyErr.code === 'PGRST204') return anyErr.message.includes('Could not find the');
  if (anyErr.code === '42703') return anyErr.message.toLowerCase().includes('does not exist');
  return false;
};


const ORDER_BASE_COLUMNS = [
  'id',
  'brand',
  'model',
  'year',
  'body_type',
  'vin',
  'status',
  'sales_status',
  'vin_photo_url',
  'priority',
  'client_name',
  'source',
  'car_photo_url',
  'car_photos',
  'markup_percent',
  'markup_type',
  'markup_fixed_aed',
  'use_markup_as_default_for_new_parts',
  'logistics',
  'delivery_aed',
  'delivery',
  'packing_aed',
  'packing',
  'service_fee_aed',
  'service_fee',
  'commission_aed',
  'commission',
  'logistics_aed',
  'logistics_total',
  'delivery_type',
  'exchange_rate',
  'created_at',
  'is_archived',
  'is_sold',
  'pricing_events'
];

const PART_BASE_COLUMNS = ['id', 'order_id', 'name', 'photo_url', 'photos', 'is_found'];

const PRICE_VARIANT_BASE_COLUMNS = ['id', 'part_id', 'price_aed', 'condition', 'availability', 'shop_name', 'phone', 'location', 'photo_url', 'photos', 'created_at'];

const normalizeCandidateOrderId = (rawId: string) => {
  const normalizedDashes = rawId.replace(/[‐‑‒–—―]/g, '-');
  const cleaned = decodeURIComponent(normalizedDashes.trim().replace(/^['\"]+|['\"]+$/g, ''));
  const uuidMatch = cleaned.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return uuidMatch ? uuidMatch[0].toLowerCase() : cleaned;
};

const getMissingTableColumn = (error: unknown, table: string): string | null => {
  if (typeof error !== 'object' || !error) return null;
  const anyErr = error as { code?: unknown; message?: unknown };
  const message = typeof anyErr.message === 'string' ? anyErr.message : '';
  if (!message) return null;

  const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (anyErr.code === 'PGRST204') {
    const match = message.match(new RegExp(`Could not find the '([^']+)' column of '${escapedTable}'`));
    return match?.[1] || null;
  }

  if (anyErr.code === '42703') {
    const postgresMatch = message.match(new RegExp(`column\\s+${escapedTable}\\.([a-zA-Z0-9_]+)\\s+does not exist`, 'i'));
    const quotedMatch = message.match(new RegExp(`column\\s+["']?${escapedTable}["']?\\.["']?([a-zA-Z0-9_]+)["']?\\s+does not exist`, 'i'));
    return postgresMatch?.[1] || quotedMatch?.[1] || null;
  }

  return null;
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const openInvoicePrintWindow = ({
  order,
  lineItems,
  totals,
  logoUrl,
  signatureUrl
}: {
  order: Order;
  lineItems: Array<{ name: string; price: number }>;
  totals: { delivery: number; packing: number; serviceFee: number; totalAed: number };
  logoUrl?: string;
  signatureUrl?: string;
}) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  const rows = lineItems.map((item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(item.name)}</td>
      <td style="text-align:center">1</td>
      <td style="text-align:right">${item.price.toFixed(2)} AED</td>
      <td style="text-align:right">${item.price.toFixed(2)} AED</td>
    </tr>
  `).join('');

  const issueDate = new Date();
  const invoiceId = order.id.slice(0, 8).toUpperCase();
  const billToName = String((order as any).clientName || (order as any).client_name || (order as any).customerName || '').trim() || 'Customer';

  printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${order.id.slice(0, 8).toUpperCase()}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Inter, Arial, sans-serif; margin: 0; padding: 24px; color: #0f172a; background: #f8fafc; }
    .card { position: relative; max-width: 920px; margin: 0 auto; border: 1px solid #dbe2ea; border-radius: 18px; padding: 24px; background: #fff; }
    .header { display: grid; grid-template-columns: 1fr auto; align-items: start; gap: 20px; margin-bottom: 16px; }
    .logo { max-height: 78px; max-width: 280px; object-fit: contain; }
    .muted { color: #64748b; font-size: 12px; }
    .line { height: 1px; background: #e2e8f0; margin: 14px 0; }
    .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; font-size: 13px; }
    .meta-grid p { margin: 0; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; border: 1px solid #dbe2ea; }
    th, td { border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; padding: 10px 8px; font-size: 13px; vertical-align: top; }
    th:last-child, td:last-child { border-right: none; }
    tr:last-child td { border-bottom: none; }
    th { text-align: left; background: #f1f5f9; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #475569; }
    .totals { margin-top: 14px; margin-left: auto; width: 100%; max-width: 360px; border: 1px solid #dbe2ea; border-radius: 12px; overflow: hidden; }
    .totals p { display: flex; justify-content: space-between; margin: 0; padding: 9px 12px; font-size: 13px; border-bottom: 1px solid #e2e8f0; }
    .totals p:last-child { border-bottom: none; }
    .total { font-size: 18px !important; font-weight: 800; background: #f8fafc; }
    .signature { margin-top: 22px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    @media print { body { padding: 0; background: #fff; } .card { border: none; border-radius: 0; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div>
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" class="logo" alt="Company logo" />` : '<h2 style="margin:0">DUBAI SPARES UAE</h2>'}
        <p class="muted" style="margin:8px 0 0">Professional Automotive Parts Invoice</p>
      </div>
      <div style="text-align:right">
        <h1 style="margin:0;font-size:34px;letter-spacing:.08em">INVOICE</h1>
        <p class="muted" style="margin:8px 0 0">Invoice ID: ${invoiceId}</p>
        <p class="muted" style="margin:4px 0 0">Issue date: ${issueDate.toLocaleDateString()}</p>
      </div>
    </div>
    <div class="line"></div>

    <div class="meta-grid">
      <p><strong>Bill to:</strong> ${escapeHtml(billToName)}</p>
      <p><strong>Contact:</strong> ${escapeHtml(order.customerContact || 'N/A')}</p>
      <p><strong>Vehicle:</strong> ${escapeHtml(`${order.brand} ${order.model} ${order.year || ''}`.trim())}</p>
      <p><strong>VIN:</strong> ${escapeHtml(order.vin || '-')}</p>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:52px">#</th>
          <th>Part name</th>
          <th style="width:84px;text-align:center">Qty</th>
          <th style="width:170px;text-align:right">Unit price</th>
          <th style="width:170px;text-align:right">Line total</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">No line items available</td></tr>'}
      </tbody>
    </table>

    <div class="totals">
      <p><span>Delivery</span><span>${totals.delivery.toFixed(2)} AED</span></p>
      <p><span>Packing</span><span>${totals.packing.toFixed(2)} AED</span></p>
      <p><span>Service fee</span><span>${totals.serviceFee.toFixed(2)} AED</span></p>
      <p class="total"><span>Total</span><span>${totals.totalAed.toFixed(2)} AED</span></p>
    </div>

    <div class="signature">
      <p class="muted" style="margin:0 0 8px">Owner signature</p>
      ${signatureUrl ? `<img src="${escapeHtml(signatureUrl)}" style="max-height:72px;max-width:220px;object-fit:contain" alt="Signature" />` : '<p class="muted" style="margin:0">Configured in public settings</p>'}
    </div>
  </div>
  <script>
    window.addEventListener('load', () => {
      window.focus();
      window.print();
    });
  </script>
</body>
</html>`);

  printWindow.document.close();
  return true;
};

const PublicQuoteScreen: React.FC<{ orderId: string }> = ({ orderId }) => {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorType, setErrorType] = useState<EstimateErrorType | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [currency, setCurrency] = useState<QuoteCurrency>('USD');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [rates, setRates] = useState<QuoteRates>(DEFAULT_QUOTE_RATES);
  const [rateSource, setRateSource] = useState('Default rates');
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [lang, setLang] = useState<Language>('en');
  const [partsVerified, setPartsVerified] = useState(false);
  const [quoteBreakdown, setQuoteBreakdown] = useState<QuoteBreakdown | null>(null);
  const [quoteContact, setQuoteContact] = useState<QuoteContact | null>(null);
  const [snapshotPayload, setSnapshotPayload] = useState<Record<string, unknown> | null>(null);
  const [snapshotDebugMeta, setSnapshotDebugMeta] = useState<SnapshotDebugMeta>({
    snapshot: '-',
    token: '-',
    snapshotRowId: '-',
    snapshotSource: 'none',
    contactsSource: 'legacy'
  });
  const [resolvedSettings, setResolvedSettings] = useState(() => normalizePublicSettings({}));
  const detailRef = useRef<HTMLDivElement | null>(null);
  const errorCardRef = useRef<HTMLDivElement | null>(null);
  const errorIconRef = useRef<HTMLDivElement | null>(null);

  const t = i18n[lang];
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const embeddedSnapshot = useMemo(() => parseEmbeddedSnapshot(params.get('data')), [params]);
  const publicQuoteKey = useMemo(() => parsePublicQuoteKey(params, orderId), [params, orderId]);
  const hasSecurityToken = (publicQuoteKey?.value || '').length === 32;

  const logEvent = (event: string, meta?: Record<string, unknown>) => {
    void logger.info('public-quote-analytics', event, { event, orderId, ...meta });
  };

  useEffect(() => {
    setLang((navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en');
  }, []);



  useEffect(() => {
    const sharedRates = parseQuoteRates(params.get('rates'));
    const sharedCurrency = (params.get('currency') || '').toUpperCase() as QuoteCurrency;
    if (sharedCurrency in DEFAULT_QUOTE_RATES) setCurrency(sharedCurrency);

    if (sharedRates) {
      setRates(sharedRates);
      setRateSource('Manager custom rates');
      return;
    }

    setRates(DEFAULT_QUOTE_RATES);
    setRateSource('Default rates');
  }, [params]);

  useEffect(() => {
    logEvent('view', { hasSecurityToken });
  }, []);

  useEffect(() => {
    const marks = [25, 50, 75, 100];
    const seen = new Set<number>();
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      const pct = Math.round((window.scrollY / max) * 100);
      marks.forEach((mark) => {
        if (pct >= mark && !seen.has(mark)) {
          seen.add(mark);
          logEvent('scroll_depth', { depth: mark });
        }
      });
      if (detailRef.current && !partsVerified) {
        const top = detailRef.current.getBoundingClientRect().top;
        if (top < window.innerHeight * 0.85) setPartsVerified(true);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [partsVerified]);

  const detectErrorType = (loadError: unknown, hasData: boolean): EstimateErrorType => {
    if (!navigator.onLine) return EstimateErrorType.OFFLINE;
    if (!hasData && !loadError) return EstimateErrorType.NOT_FOUND;
    const status = Number((loadError as { status?: number } | null)?.status || 0);
    const message = String((loadError as { message?: string } | null)?.message || '').toLowerCase();
    if (status === 401 || status === 403 || message.includes('permission') || message.includes('not authorized')) return EstimateErrorType.NO_ACCESS;
    if (isMissingColumnError(loadError) || isRelationQueryError(loadError)) return EstimateErrorType.SERVER_ERROR;
    if (message.includes('token') || message.includes('jwt')) return EstimateErrorType.EXPIRED_LINK;
    if (status >= 500) return EstimateErrorType.SERVER_ERROR;
    return EstimateErrorType.NOT_FOUND;
  };

  const [expiresAtIso, setExpiresAtIso] = useState<string>('');
  const [isPayloadCorrupted, setIsPayloadCorrupted] = useState(false);
  const loadControllerRef = useRef<AbortController | null>(null);

  const loadQuoteFromSharedSnapshot = useCallback(async (): Promise<{ order: Order | null; expired: boolean; notFound: boolean; corrupted: boolean }> => {
    const token = publicQuoteKey?.value?.trim();
    if (!token) {
      void logger.warn('public-quote:view', 'Missing public token in URL', { orderId, source: publicQuoteKey?.source || null });
      return { order: null, expired: false, notFound: true, corrupted: false };
    }

    try {
      loadControllerRef.current?.abort();
      const controller = new AbortController();
      loadControllerRef.current = controller;
      if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        console.info('[public-quote] lookup token', { lookupToken: token, source: publicQuoteKey?.source, urlToken: publicQuoteKey?.urlToken, urlSnapshot: publicQuoteKey?.urlSnapshot });
      }
      const data = await fetchPublicSnapshot(token, controller.signal, publicQuoteKey?.urlSnapshot || null);
      if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        console.info('[public-quote] lookup result', {
          urlToken: publicQuoteKey?.urlToken || token,
          snapshot: publicQuoteKey?.urlSnapshot || null,
          dbTokenFound: data?.token || null,
          dbSnapshotFound: data?.id || null,
          matches: {
            snapshotMatchesRowId: !!data?.id && data.id === (publicQuoteKey?.urlSnapshot || null),
            tokenMatchesRowToken: !!data?.token && data.token === (publicQuoteKey?.urlToken || token)
          }
        });
      }
      if (!data) {
        void logger.warn('public-quote:view', 'Snapshot lookup returned empty result', { orderId, token, snapshot: publicQuoteKey?.urlSnapshot || null });
        return { order: null, expired: false, notFound: true, corrupted: false };
      }

      const expiresAt = typeof data.expires_at === 'string' ? Date.parse(data.expires_at) : NaN;
      const expired = !Number.isNaN(expiresAt) && expiresAt <= Date.now();
      setExpiresAtIso(typeof data.expires_at === 'string' ? data.expires_at : '');
      const payloadObj = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : null;
      if (!payloadObj) {
        void logger.warn('public-quote:view', 'Snapshot payload is missing/corrupted', { orderId, token, snapshot: data.snapshot_id || data.id || null });
        return { order: null, expired, notFound: false, corrupted: true };
      }

      const snapshotOrder = mapSnapshotOrder(payloadObj);
      const diagnosticsLogistics = resolveOrderLogistics(payloadObj);
      const snapshotSettings = normalizePublicSettings((snapshotOrder as any)?.public_settings || payloadObj.public_settings || payloadObj.publicSettings || {});
      const dbFallbackSettingsRaw = await publicQuoteGetPublicContactSettings({ signal: controller.signal });
      const dbFallbackSettings = dbFallbackSettingsRaw ? normalizePublicSettings(dbFallbackSettingsRaw) : null;
      const diagnosticsSettings = mergePublicSettings(snapshotSettings, dbFallbackSettings);
      const diagnosticsOwner = normalizePayloadOwner((snapshotOrder as any)?.payloadOwner || payloadObj.owner);
      const resolvedBreakdown = resolveBreakdownFromPayload(payloadObj);
      const resolvedContact = resolveContactFromPayload(payloadObj, diagnosticsSettings);
      if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        console.log('[PUBLIC_QUOTE] payload keys:', Object.keys(payloadObj));
        console.log('[PUBLIC_QUOTE] breakdown:', resolvedBreakdown);
        console.log('[PUBLIC_QUOTE] contact:', resolvedContact);
      }
      setSnapshotPayload(payloadObj);
      setSnapshotDebugMeta({
        snapshot: publicQuoteKey?.urlSnapshot || data.snapshot_id || '-',
        token: publicQuoteKey?.urlToken || data.token || token,
        snapshotRowId: (data as any).row_id || data.id || '-',
        snapshotSource: ((data as any).snapshot_source || 'none') as SnapshotDebugMeta['snapshotSource'],
        contactsSource: ((data as any).contacts_source || 'legacy') as SnapshotDebugMeta['contactsSource']
      });
      setQuoteBreakdown(resolvedBreakdown);
      setQuoteContact(resolvedContact);
      setResolvedSettings(diagnosticsSettings);
      void logger.info('public-quote:view', 'Snapshot mapped to public order', {
        orderId: snapshotOrder.id || orderId,
        token,
        expired,
        hasLogistics: !!diagnosticsLogistics,
        logistics: diagnosticsLogistics || null,
        hasPublicTerms: !!(diagnosticsSettings.publicDeliveryTerms.trim() || diagnosticsSettings.publicWorkTerms.trim()),
        hasContacts: !!(resolvedContact.whatsappPhone || diagnosticsOwner.whatsappPhone),
        hasPayloadCorruptionFlag: !!data.isPayloadCorrupted
      });
      void logger.info('public-quote:diagnostics', 'Snapshot diagnostics', {
        orderId: snapshotOrder.id || orderId,
        totals: {
          parts: resolvedBreakdown.partsTotal,
          delivery: resolvedBreakdown.delivery,
          packing: resolvedBreakdown.packaging,
          commission: resolvedBreakdown.commission,
          total: resolvedBreakdown.total
        },
        contacts: {
          whatsapp: resolvedContact.whatsappPhone,
          telegram: resolvedContact.telegram,
          instagram: resolvedContact.instagram
        },
        settingsSource: {
          snapshotHasWhatsapp: Boolean(snapshotSettings.publicWhatsappNumber),
          dbHasWhatsapp: Boolean(dbFallbackSettings?.publicWhatsappNumber)
        }
      });
      return { order: snapshotOrder.id ? snapshotOrder : null, expired, notFound: false, corrupted: !!data.isPayloadCorrupted };
    } catch (error) {
      await logger.warn('quote-shared-snapshot-miss', 'Unable to load shared public quote snapshot', { quoteId: orderId, lookupToken: publicQuoteKey?.value, urlToken: publicQuoteKey?.urlToken, urlSnapshot: publicQuoteKey?.urlSnapshot, error: error instanceof Error ? error.message : 'unknown' });
      return { order: null, expired: false, notFound: true, corrupted: false };
    }
  }, [orderId, publicQuoteKey]);

  const readQuoteFromCache = useCallback(() => {
    const raw = window.localStorage.getItem(`public-quote-cache:${orderId}`);
    if (!raw) return false;
    try {
      setOrder(mapDbOrder(JSON.parse(raw)));
      setErrorType(null);
      return true;
    } catch {
      return false;
    }
  }, [orderId]);


  const loadQuote = useCallback(async () => {
    setQuoteBreakdown(null);
    setQuoteContact(null);
    setSnapshotPayload(null);
    setSnapshotDebugMeta({
      snapshot: publicQuoteKey?.urlSnapshot || '-',
      token: publicQuoteKey?.urlToken || publicQuoteKey?.value || '-',
      snapshotRowId: '-',
      snapshotSource: 'none',
      contactsSource: 'legacy'
    });
    setResolvedSettings(normalizePublicSettings({}));
    if (!publicQuoteKey?.value) {
      setOrder(null);
      setErrorType(EstimateErrorType.INVALID_LINK);
      setLoading(false);
      return false;
    }

    const sharedSnapshot = await loadQuoteFromSharedSnapshot();
    if (sharedSnapshot.order) {
      if (sharedSnapshot.expired) {
        setOrder(null);
        setErrorType(EstimateErrorType.EXPIRED_LINK);
        setLoading(false);
        return false;
      }
      setOrder(sharedSnapshot.order);
      setIsPayloadCorrupted(sharedSnapshot.corrupted);
      setErrorType(null);
      setLoading(false);
      return true;
    }

    if (sharedSnapshot.expired) {
      setOrder(null);
      setErrorType(EstimateErrorType.EXPIRED_LINK);
      setLoading(false);
      return false;
    }

    if (sharedSnapshot.corrupted) {
      setOrder(null);
      setIsPayloadCorrupted(true);
      setErrorType(EstimateErrorType.SERVER_ERROR);
      setLoading(false);
      return false;
    }

    setOrder(null);
    setErrorType(EstimateErrorType.NOT_FOUND);
    setLoading(false);
    return false;
  }, [loadQuoteFromSharedSnapshot, publicQuoteKey]);

  useEffect(() => {
    void loadQuote();
    return () => loadControllerRef.current?.abort();
  }, [loadQuote]);

  useEffect(() => {
    if (!errorType) return;
    errorCardRef.current?.animate(
      [{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 150, easing: 'ease-out', fill: 'both' }
    );
    errorIconRef.current?.animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)' }, { transform: 'translateY(0)' }],
      { duration: 700, easing: 'ease-in-out' }
    );
  }, [errorType]);

  const shakeErrorCard = () => {
    errorCardRef.current?.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-8px)' },
        { transform: 'translateX(8px)' },
        { transform: 'translateX(-5px)' },
        { transform: 'translateX(0)' }
      ],
      { duration: 320, easing: 'ease-in-out' }
    );
  };

  const onRetry = async () => {
    setIsRetrying(true);
    try {
      const ok = await loadQuote();
      if (!ok) shakeErrorCard();
    } finally {
      setIsRetrying(false);
    }
  };

  const heroPhoto = useMemo(() => {
    if (!order) return '';
    const photo = sanitizePhotoList([order.carPhotoUrl || '', ...(order.carPhotos || []), order.vinPhotoUrl || ''])[0] || '';
    return getOptimizedImageUrl(photo, { width: 1600, quality: 74 });
  }, [order]);

  const partCards = useMemo(() => {
    if (!order) return [];
    const fallbackCarPhotos = sanitizePhotoList([order.carPhotoUrl || '', ...(order.carPhotos || []), order.vinPhotoUrl || '']);
    const isFixedMarkup = (order.markupType || 'percent') === 'fixed';
    const fixedMarkupTotal = Number(order.markupFixedAed || 0);
    const partsWithPriceCount = order.parts.filter((part) => {
      const best = [...part.variants].sort((a, b) => a.priceAed - b.priceAed)[0];
      return !!best;
    }).length;
    const fixedMarkupPerPart = isFixedMarkup && partsWithPriceCount > 0 ? fixedMarkupTotal / partsWithPriceCount : 0;

    return order.parts.map((part) => {
      const sortedVariants = [...part.variants].sort((a, b) => a.priceAed - b.priceAed);
      const best = sortedVariants[0];
      const supplierAed = best?.priceAed || 0;
      const hasPrice = !!best;
      const isReady = !!best && part.isFound;
      const clientAed = isFixedMarkup
        ? (hasPrice
          ? supplierAed + fixedMarkupPerPart
          : supplierAed)
        : resolveClientUnitPriceAed(best as unknown as Record<string, unknown>, { markupPercent: order.markupPercent });
      const converted = clientAed * rates[currency];
      const bestVariantPhotos = sanitizePhotoList([best?.photoUrl || '', ...(best?.photos || [])]);
      const anyVariantPhotos = sanitizePhotoList(sortedVariants.flatMap((variant) => [variant.photoUrl || '', ...(variant.photos || [])]));
      const variantPhotos = bestVariantPhotos.length > 0 ? bestVariantPhotos : anyVariantPhotos;
      const basePartPhotos = sanitizePhotoList([part.photoUrl || '', ...(part.photos || [])]);
      const photoSource = variantPhotos.length > 0
        ? variantPhotos
        : (basePartPhotos.length > 0 ? basePartPhotos : fallbackCarPhotos);
      const uniquePhotos = sanitizePhotoList(photoSource);
      const previewPhotos = uniquePhotos.map((photo) => getOptimizedImageUrl(photo, { width: 480, quality: 64 }));
      const galleryPhotos = uniquePhotos.map((photo) => getOptimizedImageUrl(photo, { width: 1600, quality: 74 }));
      return { part, best, previewPhotos, galleryPhotos, converted, clientAed, isReady, availability: isReady ? t.inStock : t.onOrder };
    });
  }, [order, currency, rates, t.inStock, t.onOrder]);

  const foundParts = partCards.filter((item) => item.isReady);

  const payloadTotals = useMemo(
    () => (snapshotPayload ? resolveTotalsFromPayload(snapshotPayload, rates) : null),
    [snapshotPayload, rates]
  );

  const totals = useMemo(() => {
    const fallbackSubtotal = foundParts.reduce((sum, item) => sum + item.clientAed, 0);
    const subtotalFromPayload = payloadTotals?.itemsTotalAed ?? 0;
    const shouldUseFallbackSubtotal = fallbackSubtotal > 0 && subtotalFromPayload <= 0;
    const subtotal = shouldUseFallbackSubtotal ? fallbackSubtotal : subtotalFromPayload;
    const serviceFee = payloadTotals?.commissionAed ?? 0;
    const delivery = payloadTotals?.deliveryAed ?? 0;
    const packing = payloadTotals?.packingAed ?? 0;
    const logistics = delivery + packing;
    const subtotalWithoutExtras = subtotal;
    const payloadTotalAed = payloadTotals?.grandTotalAed ?? 0;
    const recomputedTotalAed = subtotalWithoutExtras + serviceFee + logistics;
    const totalAed = payloadTotalAed > 0
      ? Math.max(payloadTotalAed, recomputedTotalAed)
      : recomputedTotalAed;
    return {
      subtotal,
      subtotalWithoutExtras,
      serviceFee,
      delivery,
      packing,
      logistics,
      feesTotalAed: serviceFee + logistics,
      totalAed,
      totalConverted: totalAed * rates[currency],
      computedFrom: payloadTotals?.computedFrom || 'recompute(items)',
      hasPositions: (payloadTotals?.items.length ?? partCards.length) > 0
    };
  }, [currency, foundParts, partCards.length, payloadTotals, rates]);

  const invoiceLineItems = useMemo(() => {
    const fromPayload = (payloadTotals?.items || [])
      .map((item) => {
        const convertedUnitAed = convertFromSourceToAed(item.unitPrice, item.currency, rates);
        const qty = Number.isFinite(Number(item.qty)) && Number(item.qty) > 0 ? Number(item.qty) : 1;
        return {
          name: item.title,
          price: convertedUnitAed * qty
        };
      })
      .filter((item) => item.price > 0);

    if (fromPayload.length > 0) return fromPayload;

    return partCards
      .map(({ part, clientAed }) => ({ name: part.name, price: clientAed }))
      .filter((item) => item.price > 0);
  }, [partCards, payloadTotals, rates]);
  const confirmMessage = `Здравствуйте! Подтверждаю смету по ${order?.brand || ''} ${order?.model || ''} ${order?.year || ''}. ID: ${order?.id || ''}`;
  const payloadOwner = (order as any)?.payloadOwner || (order as any)?.owner || {};
  const payloadSettings = (order as any)?.public_settings || {};
  const settingsFromPayload = normalizePublicSettings(payloadSettings);
  const settings = mergePublicSettings(settingsFromPayload, resolvedSettings);
  const logoUrl = settings.publicCompanyLogoUrl;
  const signatureUrl = settings.publicInvoiceSignatureUrl;
  const normalizedOwner = normalizePayloadOwner(payloadOwner);
  const whatsappPhoneRaw = quoteContact?.whatsappPhone
    || settings.publicWhatsappNumber
    || (isPlaceholderWhatsapp(normalizedOwner.whatsappPhone) ? '' : normalizedOwner.whatsappPhone)
    || DEFAULT_PUBLIC_WHATSAPP;
  const whatsappPhoneDigits = normalizeWhatsappPhone(whatsappPhoneRaw);
  const canOpenWhatsapp = Boolean(whatsappPhoneDigits);
  const showDebug = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('debug') === '1';
    } catch {
      return false;
    }
  }, []);

  const whatsappConfirmUrl = useMemo(() => {
    if (!canOpenWhatsapp) return '';
    const encoded = encodeURIComponent(confirmMessage);
    return `https://wa.me/${whatsappPhoneDigits}?text=${encoded}`;
  }, [canOpenWhatsapp, confirmMessage, whatsappPhoneDigits]);

  const openWhatsappChat = useCallback((placement: 'hero' | 'sticky') => {
    if (!whatsappConfirmUrl) return;
    logEvent('confirm_click', { placement });
    window.location.href = whatsappConfirmUrl;
  }, [whatsappConfirmUrl]);

  const downloadPdf = async () => {
    if (!order) return;
    const opened = openInvoicePrintWindow({
      order,
      lineItems: invoiceLineItems,
      totals: {
        delivery: totals.delivery,
        packing: totals.packing,
        serviceFee: totals.serviceFee,
        totalAed: totals.totalAed
      },
      logoUrl,
      signatureUrl
    });
    if (opened) logEvent('pdf_download');
  };

  if (loading) return <div className="min-h-screen bg-[#f5f5f7] text-slate-900 grid place-items-center">{t.loading}</div>;

  if (errorType || !order) {
    const errorMeta: Record<EstimateErrorType, { title: string; body: string; tone: string; canRetry: boolean; canGoHome: boolean; canOpenOffline: boolean }> = {
      [EstimateErrorType.INVALID_LINK]: { title: t.invalidTitle, body: t.invalidBody, tone: 'text-amber-500', canRetry: false, canGoHome: true, canOpenOffline: false },
      [EstimateErrorType.NOT_FOUND]: { title: t.notFoundTitle, body: t.notFoundBody, tone: 'text-rose-500', canRetry: true, canGoHome: true, canOpenOffline: false },
      [EstimateErrorType.NO_ACCESS]: { title: t.noAccessTitle, body: t.noAccessBody, tone: 'text-violet-500', canRetry: false, canGoHome: true, canOpenOffline: false },
      [EstimateErrorType.OFFLINE]: { title: t.offlineTitle, body: t.offlineBody, tone: 'text-amber-500', canRetry: true, canGoHome: false, canOpenOffline: true },
      [EstimateErrorType.SERVER_ERROR]: { title: t.serverErrorTitle, body: t.serverErrorBody, tone: 'text-orange-500', canRetry: true, canGoHome: false, canOpenOffline: false },
      [EstimateErrorType.EXPIRED_LINK]: { title: t.expiredTitle, body: t.expiredBody, tone: 'text-slate-500', canRetry: false, canGoHome: true, canOpenOffline: false }
    };
    const current = errorMeta[errorType || EstimateErrorType.SERVER_ERROR];
    const lookupHint = publicQuoteKey ? `${publicQuoteKey.source}: ${publicQuoteKey.value}` : `path: ${orderId}`;
    return (
      <div className="min-h-screen bg-[#f5f5f7] text-slate-900 flex items-center justify-center px-4 text-center">
        <div ref={errorCardRef} className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
          <div ref={errorIconRef}><AlertCircle className={`mx-auto mb-3 ${current.tone}`} /></div>
          <h1 className="text-xl font-semibold">{current.title}</h1>
          <p className="mt-2 text-sm text-slate-600">{isPayloadCorrupted ? 'Смета повреждена. Запросите новую ссылку.' : current.body}</p>
          <p className="mt-2 text-xs text-slate-400">ID: <code>{orderId}</code></p>
          <p className="mt-1 text-xs text-slate-400">Lookup key: <code>{lookupHint}</code></p>
          <p className="mt-1 text-xs text-slate-400">URL token/snapshot: <code>{`${publicQuoteKey?.urlToken || '-'} / ${publicQuoteKey?.urlSnapshot || '-'}`}</code></p>
          <div className="mt-5 flex flex-col gap-2">
            {current.canRetry && (
              <button type="button" disabled={isRetrying} onClick={() => void onRetry()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                <RefreshCcw size={15} className={isRetrying ? 'animate-spin' : ''} /> {t.retry}
              </button>
            )}
            {current.canOpenOffline && (
              <button type="button" onClick={() => { if (!readQuoteFromCache()) shakeErrorCard(); }} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">
                {t.openOffline}
              </button>
            )}
            {current.canGoHome && (
              <button
                type="button"
                onClick={() => {
                  window.location.href = '/order-form';
                }}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                {t.backToOrders}
              </button>
            )}
            {errorType === EstimateErrorType.EXPIRED_LINK && (
              whatsappPhoneDigits ? (
                <button
                  type="button"
                  onClick={() => {
                    const url = `https://wa.me/${whatsappPhoneDigits}?text=${encodeURIComponent('Здравствуйте! Нужна новая ссылка на смету.')}`;
                    window.location.href = url;
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white"
                >
                  <MessageCircle size={15} /> {t.contactUs}
                </button>
              ) : (
                <div className="text-sm text-slate-500">Свяжитесь с менеджером</div>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-1.5">
            <Globe size={14} className="text-slate-400" />
            <button type="button" onClick={() => setLang('en')} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${lang === 'en' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>EN</button>
            <button type="button" onClick={() => setLang('ru')} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${lang === 'ru' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>RU</button>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 shrink-0">{t.currency}</span>
            {(Object.keys(DEFAULT_QUOTE_RATES) as QuoteCurrency[]).map((code) => (
              <button key={code} type="button" onClick={() => { setCurrency(code); logEvent('currency_switch', { currency: code }); }} className={`min-h-8 min-w-[50px] rounded-full px-3 text-[11px] font-bold ${currency === code ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{code}</button>
            ))}
          </div>
        </div>
      </div>

      <header className="mx-auto mt-4 w-full max-w-4xl px-4 sm:px-6">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {heroPhoto ? <img src={heroPhoto} alt={`${order.brand} ${order.model}`} className="h-44 w-full object-cover sm:h-52" /> : null}
          <div className="space-y-4 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Dubai Spares UAE</div>
              {logoUrl && <img src={logoUrl} alt="Company logo" className="h-24 w-auto max-w-[420px] object-contain" />}
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{order.brand} {order.model} {order.year}</h1>
              <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">VIN: {maskVin(order.vin)}</p>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.quoteTotal}</p>
                <p className="mt-1 text-3xl font-black text-slate-900 sm:text-4xl">{totals.totalConverted.toFixed(2)} <span className="text-lg font-bold text-slate-500">{currency}</span></p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canOpenWhatsapp && (
                  <button type="button" onClick={() => openWhatsappChat('hero')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white">
                    <MessageCircle size={16} /> {t.confirmWhatsApp}
                  </button>
                )}
                <button type="button" onClick={() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">📄 {t.viewParts}</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Проверенный поставщик UAE</span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Ответ 5–15 мин</span>
              {expiresAtIso && <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">{t.validUntil}: {new Date(expiresAtIso).toLocaleDateString()}</span>}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 pb-32 sm:px-6">

        <section ref={detailRef} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{t.partsGallery} — {partCards.length} {lang === 'ru' ? 'позиц.' : 'items'}</h2>
          </div>
          {partCards.map(({ part, best, converted, previewPhotos, galleryPhotos, availability }) => {
            const partMessage = `Hello! I confirm ${part.name} for ${order.brand} ${order.model} ${order.year}.\nVIN: ${maskVin(order.vin || '')}.\nPrice: ${converted.toFixed(2)} ${currency}.`;
            const partWhatsappUrl = whatsappPhoneDigits ? `https://wa.me/${whatsappPhoneDigits}?text=${encodeURIComponent(partMessage)}` : '';

            return (
            <article key={part.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-4 p-4 sm:p-5">
                {/* Photo — left */}
                <button
                  type="button"
                  onClick={() => {
                    if (galleryPhotos.length === 0) return;
                    setGallery({ images: galleryPhotos, index: 0 });
                    logEvent('gallery_open', { partId: part.id });
                  }}
                  className="relative shrink-0 inline-flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-slate-400"
                  disabled={galleryPhotos.length === 0}
                  title={galleryPhotos.length > 1 ? `Фото: ${galleryPhotos.length}` : 'Фото детали'}
                >
                  {previewPhotos[0] ? <img src={previewPhotos[0]} alt={part.name} className="h-full w-full object-cover" /> : <Images size={22} />}
                  {galleryPhotos.length > 1 && (
                    <span aria-label={`${galleryPhotos.length} photos`} className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 py-0.5 text-[8px] font-bold text-white leading-none">{galleryPhotos.length}</span>
                  )}
                </button>

                {/* Name + status — center */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold leading-snug text-slate-900 text-sm sm:text-base">{part.name}</h3>
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>{availability}
                  </span>
                </div>

                {/* Price — right */}
                <div className="shrink-0 text-right pl-2">
                  <p className="text-2xl font-black text-slate-900 sm:text-3xl leading-none">{converted.toFixed(2)}</p>
                  <p className="text-xs font-semibold text-slate-400 mt-0.5">{currency}</p>
                </div>
              </div>

              {partWhatsappUrl && (
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 sm:px-5">
                  <button type="button" onClick={() => { window.location.href = partWhatsappUrl; }} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-white">
                    <MessageCircle size={13} /> {t.confirmWhatsApp}
                  </button>
                </div>
              )}
            </article>
            );
          })}

          {!totals.hasPositions && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">{t.noPositions}</div>
          )}
        </section>


        {(settings.publicDeliveryTerms.trim() || settings.publicWorkTerms.trim()) && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm p-5 text-sm text-slate-700">
            {settings.publicDeliveryTerms.trim() && <p className="whitespace-pre-line">{settings.publicDeliveryTerms.trim()}</p>}
            {settings.publicWorkTerms.trim() && <p className="whitespace-pre-line mt-2">{settings.publicWorkTerms.trim()}</p>}
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{t.priceBreakdown}</h2>
          </div>
          <div className="divide-y divide-slate-100 px-5">
            <div className="flex items-center justify-between py-3 text-sm">
              <span className="text-slate-600">{t.partsSubtotal}</span>
              <strong className="text-slate-900">{(totals.subtotal * rates[currency]).toFixed(2)} {currency}</strong>
            </div>
            {totals.delivery > 0 && (
              <div className="flex items-center justify-between py-3 text-sm">
                <span className="text-slate-600">{t.delivery}</span>
                <strong className="text-slate-900">{(totals.delivery * rates[currency]).toFixed(2)} {currency}</strong>
              </div>
            )}
            {totals.packing > 0 && (
              <div className="flex items-center justify-between py-3 text-sm">
                <span className="text-slate-600">{t.packing}</span>
                <strong className="text-slate-900">{(totals.packing * rates[currency]).toFixed(2)} {currency}</strong>
              </div>
            )}
            {totals.serviceFee > 0 && (
              <div className="flex items-center justify-between py-3 text-sm">
                <span className="text-slate-600">{t.serviceFee}</span>
                <strong className="text-slate-900">{(totals.serviceFee * rates[currency]).toFixed(2)} {currency}</strong>
              </div>
            )}
            <div className="flex items-center justify-between py-4">
              <span className="font-bold text-slate-900">{t.total}</span>
              <strong className="text-2xl font-black text-slate-900">{totals.totalConverted.toFixed(2)} <span className="text-base text-slate-500">{currency}</span></strong>
            </div>
          </div>
        </section>

        {showDebug && (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
            <p className="break-all">buildStamp={APP_VERSION}/{GIT_SHA}/{BUILD_TIME} | snapshotSource={snapshotDebugMeta.snapshotSource} | hasContactsInSnapshot={Boolean((snapshotPayload as any)?.contacts?.whatsapp)} | contactsResolvedFrom={snapshotDebugMeta.contactsSource} | partsTotal={totals.subtotal.toFixed(2)} | feesTotal={totals.feesTotalAed.toFixed(2)} | grandTotal={totals.totalAed.toFixed(2)} | computedFrom={totals.computedFrom}</p>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{t.trust}</h2>
          </div>
          <div className="p-5 space-y-4">
            <ul className="space-y-1.5 text-sm text-slate-600">
              <li className="flex items-start gap-2"><span className="mt-0.5 text-emerald-500">✓</span> {t.trustedBy}</li>
              <li className="flex items-start gap-2"><span className="mt-0.5 text-emerald-500">✓</span> {t.yards}</li>
              <li className="flex items-start gap-2"><span className="mt-0.5 text-emerald-500">✓</span> {t.response}</li>
            </ul>
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold text-slate-800">{t.companyProfile}: Dubai Spares UAE</p>
                {logoUrl && <img src={logoUrl} alt="Company logo" className="h-20 w-auto max-w-[360px] object-contain" />}
              </div>
              <div className="flex flex-wrap gap-2">
                {whatsappPhoneDigits && (
                  <a href={`https://wa.me/${whatsappPhoneDigits}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white">
                    <MessageCircle size={15} /> WhatsApp
                  </a>
                )}
                {settings.publicTelegramUrl && (
                  <a href={settings.publicTelegramUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white">
                    <Send size={15} /> Telegram
                  </a>
                )}
                {settings.publicInstagramUrl && (
                  <a href={settings.publicInstagramUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 px-4 py-2 text-sm font-bold text-white">
                    <Instagram size={15} /> Instagram
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>

        <button type="button" onClick={downloadPdf} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-sm">
          <Download size={15} /> {t.downloadPdf}
        </button>

        {signatureUrl && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Подпись</p>
            <div className="mt-2 border-t border-slate-100 pt-3">
              <img src={signatureUrl} alt="Owner signature" className="h-20 w-auto object-contain" />
            </div>
          </section>
        )}

        {/* Footer branding */}
        <div className="py-4 text-center">
          <p className="text-[10px] text-slate-400">Dubai Spares UAE · Коммерческое предложение</p>
          <p className="text-[9px] text-slate-300 mt-0.5">ID: {orderId}</p>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/98 p-3 pb-[calc(env(safe-area-inset-bottom)+10px)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t.quoteTotal}</p>
            <p className="text-xl font-black text-slate-900 leading-tight">{totals.totalConverted.toFixed(2)} <span className="text-sm text-slate-400">{currency}</span></p>
            {partsVerified && <p className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600"><CheckCircle2 size={10} /> {t.partsVerified}</p>}
          </div>
          <button type="button" disabled={!canOpenWhatsapp} onClick={() => openWhatsappChat('sticky')} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-bold text-white shadow-[0_8px_24px_rgba(16,185,129,0.35)] disabled:cursor-not-allowed disabled:opacity-50">
            <MessageCircle size={16} /> {canOpenWhatsapp ? t.confirmWhatsApp : t.contactNotConfigured} <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

export default PublicQuoteScreen;
