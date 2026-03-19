import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
  Images,
  ChevronRight,
  Download,
  Globe,
  Info,
  Instagram,
  MessageCircle,
  Send,
  ShieldCheck,
  XCircle
} from 'lucide-react';
import ImagePreview from '../components/ImagePreview';
import { copyToClipboard, DEFAULT_QUOTE_RATES, parsePublicQuoteKey, parseQuoteRates, QuoteCurrency, QuoteRates } from '../shareUtils';
import { logger } from '../logging';
import { publicQuoteGetPublicContactSettings, publicQuoteGetSnapshot, resolveClientUnitPriceAed } from '../publicQuoteApi';
import { normalizeGroupItems, normalizePartQuantity } from '../utils/groupItems';
import { calculateCargoEstimates } from '../utils/cargo';
import { SUPABASE_URL } from '../cloudConfig';
import { Order, Part, PriceVariant } from '../types';

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
    viewParts: 'Go to Parts Gallery',
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
    ,
    noPhotos: 'No photos available for this part yet.',
    clientLabel: 'Client',
    trustedSupplierBadge: 'Verified UAE supplier',
    fastResponseBadge: 'Reply in 5–15 min',
    partGroupLabel: 'Part group',
    partGroupItems: 'items',
    workTermsTitle: 'Terms and documents',
    downloadTerms: 'Download file (PDF)',
    signature: 'Signature',
    commercialOffer: 'Commercial offer',
    contactManager: 'Contact the manager',
    expiredQuoteWhatsappMessage: 'Hello! I need a new public quote link.'
    ,
    quantity: 'Qty',
    policyNoticeTitle: 'Payment policy',
    policyNoticeBody: 'Full prepayment is required before order processing. Please confirm every position carefully with your manager before payment.',
    cargoTitle: 'Cargo estimates',
    cargoHelper: 'Informational estimate for planning delivery timeline and budget.',
    country: 'Country',
    weight: 'Weight',
    totalPlaces: 'Total places',
    air: 'Air',
    container: 'Container',
    etaDays: 'days',
    statusDefault: 'Awaiting confirmation',
    statusLoading: 'Opening WhatsApp…',
    statusConfirmed: 'Parts reviewed',
    statusUnavailable: 'Contact unavailable',
    statusExpired: 'Quote expired',
    officialSignature: 'Official signature',
    downloadCargoPdf: 'Cargo & Logistics'
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
    viewParts: 'Перейти к галерее деталей',
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
    contactNotConfigured: 'Контакт не настроен',
    noPhotos: 'Фотографии для этой детали пока недоступны.',
    clientLabel: 'Клиент',
    trustedSupplierBadge: 'Проверенный поставщик UAE',
    fastResponseBadge: 'Ответ 5–15 мин',
    partGroupLabel: 'Группа деталей',
    partGroupItems: 'поз.',
    workTermsTitle: 'Условия и документы',
    downloadTerms: 'Скачать файл (PDF)',
    signature: 'Подпись',
    commercialOffer: 'Коммерческое предложение',
    contactManager: 'Свяжитесь с менеджером',
    expiredQuoteWhatsappMessage: 'Здравствуйте! Нужна новая ссылка на смету.'
    ,
    quantity: 'Кол-во',
    policyNoticeTitle: 'Условия оплаты',
    policyNoticeBody: 'Заказ оформляется по полной предоплате. Перед оплатой подтвердите все позиции и условия с менеджером.',
    cargoTitle: 'Оценка логистики',
    cargoHelper: 'Информационный расчёт для понимания сроков и бюджета доставки.',
    country: 'Страна',
    weight: 'Вес',
    totalPlaces: 'Мест',
    air: 'Авиа',
    container: 'Контейнер',
    etaDays: 'дн.',
    statusDefault: 'Ожидает подтверждения',
    statusLoading: 'Открываем WhatsApp…',
    statusConfirmed: 'Позиции просмотрены',
    statusUnavailable: 'Контакт не настроен',
    statusExpired: 'Срок сметы истёк',
    officialSignature: 'Официальная подпись',
    downloadCargoPdf: 'Карго и логистика'
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
  const cargoCountry = String(raw.cargoCountry || raw.cargo_country || '').trim();
  const cargoDeliveryType = raw.cargoDeliveryType || raw.cargo_delivery_type;
  const cargoEtaDays = String(raw.cargoEtaDays || raw.cargo_eta_days || '').trim();
  const cargoTotalWeightKg = parseMoneyField(raw.cargoTotalWeightKg, raw.cargo_total_weight_kg);
  const cargoChargeableWeightKg = parseMoneyField(raw.cargoChargeableWeightKg, raw.cargo_chargeable_weight_kg);
  const cargoVolumeCbm = parseMoneyField(raw.cargoVolumeCbm, raw.cargo_volume_cbm);
  const cargoTotalPlaces = parseMoneyField(raw.cargoTotalPlaces, raw.cargo_total_places);
  const cargoBaseCostUsd = parseMoneyField(raw.cargoBaseCostUsd, raw.cargo_base_cost_usd);
  const cargoAirCostUsd = parseMoneyField(raw.cargoAirCostUsd, raw.cargo_air_cost_usd);
  const cargoContainerCostUsd = parseMoneyField(raw.cargoContainerCostUsd, raw.cargo_container_cost_usd);
  const cargoTotalCostUsd = parseMoneyField(raw.cargoTotalCostUsd, raw.cargo_total_cost_usd, raw.totalCargoCostUsd, raw.total_cargo_cost_usd, raw.totalsCargoTotalCostUsd, raw.pricingBreakdownCargoTotalCostUsd, raw.pricing_breakdown_cargo_total_cost_usd);
  const cargoAirEtaDays = String(raw.cargoAirEtaDays || raw.cargo_air_eta_days || '').trim();
  const cargoContainerEtaDays = String(raw.cargoContainerEtaDays || raw.cargo_container_eta_days || '').trim();

  const hasAedFees = deliveryAed > 0 || packingAed > 0 || serviceFeeAed > 0;
  const hasCargo = Boolean(cargoCountry) || cargoTotalWeightKg > 0 || cargoChargeableWeightKg > 0 || cargoVolumeCbm > 0 || cargoTotalPlaces > 0 || cargoBaseCostUsd > 0 || cargoAirCostUsd > 0 || cargoContainerCostUsd > 0 || cargoTotalCostUsd > 0;
  if (!hasAedFees && !hasCargo) return undefined;

  return {
    deliveryType: (deliveryType === 'export' ? 'export' : 'uae') as 'uae' | 'export',
    deliveryAed,
    packingAed,
    serviceFeeAed,
    cargoCountry: cargoCountry || undefined,
    cargoDeliveryType: (cargoDeliveryType === 'express_air' || cargoDeliveryType === 'container') ? cargoDeliveryType : 'air',
    cargoEtaDays: cargoEtaDays || undefined,
    cargoTotalWeightKg,
    cargoChargeableWeightKg,
    cargoVolumeCbm,
    cargoTotalPlaces,
    cargoBaseCostUsd,
    cargoAirCostUsd,
    cargoContainerCostUsd,
    cargoTotalCostUsd,
    cargoAirEtaDays: cargoAirEtaDays || undefined,
    cargoContainerEtaDays: cargoContainerEtaDays || undefined
  };
};

const resolveOrderLogistics = (row: any) => {
  // Top-level row fields are listed first so that nested logistics/pricingBreakdown
  // spreads (placed last) can override undefined top-level values. This is especially
  // important for cargo fields (cargoCountry, cargoAirCostUsd, etc.) which are stored
  // only in the nested `row.logistics` object of snapshot payloads and must not be
  // lost when the corresponding top-level `row.cargoXxx` keys are undefined.
  const mergedSources = {
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
    cargoCountry: row?.cargoCountry,
    cargo_country: row?.cargo_country,
    cargoDeliveryType: row?.cargoDeliveryType,
    cargo_delivery_type: row?.cargo_delivery_type,
    cargoEtaDays: row?.cargoEtaDays,
    cargo_eta_days: row?.cargo_eta_days,
    cargoTotalWeightKg: row?.cargoTotalWeightKg,
    cargo_total_weight_kg: row?.cargo_total_weight_kg,
    cargoChargeableWeightKg: row?.cargoChargeableWeightKg,
    cargo_chargeable_weight_kg: row?.cargo_chargeable_weight_kg,
    cargoVolumeCbm: row?.cargoVolumeCbm,
    cargo_volume_cbm: row?.cargo_volume_cbm,
    cargoTotalPlaces: row?.cargoTotalPlaces,
    cargo_total_places: row?.cargo_total_places,
    cargoBaseCostUsd: row?.cargoBaseCostUsd,
    cargo_base_cost_usd: row?.cargo_base_cost_usd,
    cargoAirCostUsd: row?.cargoAirCostUsd,
    cargo_air_cost_usd: row?.cargo_air_cost_usd,
    cargoContainerCostUsd: row?.cargoContainerCostUsd,
    cargo_container_cost_usd: row?.cargo_container_cost_usd,
    cargoTotalCostUsd: row?.cargoTotalCostUsd,
    cargo_total_cost_usd: row?.cargo_total_cost_usd,
    totalsCargoTotalCostUsd: row?.totals?.cargo_total_cost_usd,
    pricingBreakdownCargoTotalCostUsd: row?.pricingBreakdown?.cargo_total_cost_usd,
    pricing_breakdown_cargo_total_cost_usd: row?.pricing_breakdown?.cargo_total_cost_usd,
    cargoAirEtaDays: row?.cargoAirEtaDays,
    cargo_air_eta_days: row?.cargo_air_eta_days,
    cargoContainerEtaDays: row?.cargoContainerEtaDays,
    cargo_container_eta_days: row?.cargo_container_eta_days,
    totalsLogisticsAed: row?.totals?.logistics_aed,
    totalsPackingAed: row?.totals?.packing_aed,
    totalsCommissionAed: row?.totals?.commission_aed,
    deliveryType: row?.deliveryType,
    delivery_type: row?.delivery_type,
    // Nested objects spread last so their values take precedence over undefined
    // top-level placeholders above.
    ...(row?.pricing_breakdown && typeof row.pricing_breakdown === 'object' ? row.pricing_breakdown : {}),
    ...(row?.pricingBreakdown && typeof row.pricingBreakdown === 'object' ? row.pricingBreakdown : {}),
    ...(row?.logistics && typeof row.logistics === 'object' ? row.logistics : {}),
  };

  return normalizeLogistics(mergedSources);
};

const maskVin = (vin: string) => (vin.length > 8 ? `${vin.slice(0, 5)}...${vin.slice(-4)}` : vin || 'N/A');

/** Haversine distance between two lat/lng points in kilometres */
const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Sum of haversine distances along a GPS track */
const trackDistanceKm = (pings: Array<{ lat: number; lng: number }>): number => {
  let total = 0;
  for (let i = 1; i < pings.length; i++) {
    total += haversineKm(pings[i - 1].lat, pings[i - 1].lng, pings[i].lat, pings[i].lng);
  }
  return total;
};

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
  customerContact: row.customer_contact || '',
  socialNickname: row.social_nickname || '',
  contactLinks: row.contact_links || undefined,
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
    quantity: normalizePartQuantity(part.quantity),
    comment: part.comment || '',
    partKind: part.part_kind === 'group' ? 'group' : 'single',
    groupItems: normalizeGroupItems(part.group_items),
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
  huntStatus: 'final_offer',
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
  clientName: row?.clientName || row?.client_name || header?.clientName || header?.client_name || '',
  customerContact: row?.customerContact || row?.customer_contact || header?.customerContact || header?.customer_contact || '',
  socialNickname: row?.socialNickname || row?.social_nickname || header?.socialNickname || header?.social_nickname || '',
  contactLinks: row?.contactLinks || row?.contact_links || header?.contactLinks || header?.contact_links || row?.customer_links || undefined,
  source: header?.source || row?.source || 'WhatsApp',
  carPhotoUrl: row?.carPhotoUrl || row?.car_photo_url || header?.carPhotoUrl || header?.car_photo_url || row?.carPhotos?.[0] || row?.car_photos?.[0] || header?.carPhotos?.[0] || header?.car_photos?.[0] || row?.vinPhotoUrl || row?.vin_photo_url || header?.vinPhotoUrl || header?.vin_photo_url || '',
  carPhotos: row?.carPhotos || row?.car_photos || header?.carPhotos || header?.car_photos || [],
  logistics: resolveOrderLogistics(row),
  markupType: header?.markupType || row?.markupType || row?.markup_type || 'percent',
  markupFixedAed: Number(header?.markupFixedAed ?? row?.markupFixedAed ?? row?.markup_fixed_aed ?? row?.totals?.markup_aed ?? 0),
  parts: (row?.parts || []).map((part: any) => {
    const variantPrice = Number(part?.supplier_price_aed ?? part?.supplierPriceAed ?? part?.priceAed ?? part?.price_aed ?? part?.price ?? 0);
    const photos = normalizeUnknownPhotoList(part?.photo_urls || part?.photos || []);
    return ({
    id: String(part?.id || ''),
    orderId: String(part?.orderId || part?.order_id || row?.order_id || row?.id || ''),
    name: part?.name || 'Part',
    quantity: normalizePartQuantity(part?.quantity),
    comment: part?.comment || '',
    partKind: part?.partKind === 'group' || part?.part_kind === 'group' ? 'group' : 'single',
    groupItems: normalizeGroupItems(part?.groupItems || part?.group_items),
    photoUrl: part?.photoUrl || part?.photo_url || photos?.[0] || '',
    photos,
    isFound: !!part?.isFound || !!part?.is_found,
    weightKg: Number(part?.weightKg ?? part?.weight_kg ?? 0),
    places: Number(part?.places ?? 0),
    cargoPlaceGroup: String(part?.cargoPlaceGroup ?? part?.cargo_place_group ?? ''),
    isOversized: !!(part?.isOversized ?? part?.is_oversized),
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
      photos: normalizeUnknownPhotoList(variant?.photos || variant?.photo_urls || []),
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
  huntStatus: 'final_offer',
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
    publicInvoiceSignatureUrl: read('publicInvoiceSignatureUrl', 'public_invoice_signature_url', 'invoiceSignatureUrl', 'signature', 'signatureUrl'),
    publicManagerName: read('publicManagerName', 'public_manager_name', 'managerName', 'manager_name', 'ownerName', 'owner_name'),
    publicTermsFileUrl: read('publicTermsFileUrl', 'public_terms_file_url', 'termsFileUrl', 'terms_file_url'),
    publicTermsFileName: read('publicTermsFileName', 'public_terms_file_name', 'termsFileName', 'terms_file_name'),
    executorPhotoUrl: read('executorPhotoUrl', 'executor_photo_url'),
    executorRole: read('executorRole', 'executor_role')
  };
};


const isDisplayablePhotoUrl = (value: string) => (
  value.startsWith('http://')
  || value.startsWith('https://')
  || value.startsWith('data:image')
);

const normalizePublicPhotoCandidate = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.startsWith('local://') || trimmed.startsWith('blob:')) return '';

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.pathname.includes('/storage/v1/object/sign/')) {
        // Signed URLs must keep their token, otherwise private buckets won't render in public quote.
        return parsed.toString();
      }
      if (parsed.pathname.includes('/storage/v1/object/public/')) {
        parsed.searchParams.delete('token');
      }
      return parsed.toString();
    } catch {
      return trimmed;
    }
  }

  if (trimmed.startsWith('/storage/v1/object/sign/') && SUPABASE_URL) {
    return `${SUPABASE_URL}${trimmed}`;
  }
  if (trimmed.startsWith('/storage/v1/object/public/') && SUPABASE_URL) return `${SUPABASE_URL}${trimmed}`;

  if (!SUPABASE_URL || trimmed.includes('://') || trimmed.startsWith('/')) return trimmed;

  const bucket = ((import.meta as any).env?.VITE_SUPABASE_STORAGE_BUCKET as string | undefined)?.trim() || 'images';
  const normalizedPath = trimmed.replace(/^\/+/, '');
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${normalizedPath}`;
};

const isUnavailablePhotoPlaceholder = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  return normalized.includes('photo-unavailable')
    || normalized.includes('no-photo')
    || normalized.includes('no_image')
    || normalized.includes('placeholder')
    || normalized.includes('%d1%84%d0%be%d1%82%d0%be%20%d0%bd%d0%b5%d0%b4%d0%be%d1%81%d1%82%d1%83%d0%bf%d0%bd%d0%be')
    || normalized.includes('фото недоступно');
};

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
    .map((photo) => normalizePublicPhotoCandidate(String(photo || '').trim()))
    .filter((photo) => !!photo && isDisplayablePhotoUrl(photo) && !isUnavailablePhotoPlaceholder(photo))
    .forEach((photo) => {
      const key = normalizePhotoKey(photo);
      if (seen.has(key)) return;
      seen.add(key);
      next.push(photo);
    });
  return next;
};

const normalizeUnknownPhotoList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return sanitizePhotoList(value.flatMap((item) => normalizeUnknownPhotoList(item)));
  }
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return normalizeUnknownPhotoList(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (trimmed.includes(',')) {
    return sanitizePhotoList(trimmed.split(',').map((part) => part.trim()));
  }
  return sanitizePhotoList([trimmed]);
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
  publicInvoiceSignatureUrl: preferred.publicInvoiceSignatureUrl || fallback?.publicInvoiceSignatureUrl || '',
  publicManagerName: preferred.publicManagerName || fallback?.publicManagerName || '',
  publicTermsFileUrl: preferred.publicTermsFileUrl || fallback?.publicTermsFileUrl || '',
  publicTermsFileName: preferred.publicTermsFileName || fallback?.publicTermsFileName || '',
  executorPhotoUrl: preferred.executorPhotoUrl || fallback?.executorPhotoUrl || '',
  executorRole: preferred.executorRole || fallback?.executorRole || ''
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

const resolveInvoiceCargoData = (order: Order) => {
  const cargoComputed = calculateCargoEstimates(order, {});
  return {
    cargoCountry: String(order.logistics?.cargoCountry || cargoComputed.air.country || '—'),
    cargoRealWeight: Number(order.logistics?.cargoTotalWeightKg ?? cargoComputed.air.realWeight ?? 0),
    cargoChargeableWeight: Number(order.logistics?.cargoChargeableWeightKg ?? cargoComputed.air.chargeableWeight ?? 0),
    cargoPlaces: Number(order.logistics?.cargoTotalPlaces ?? cargoComputed.air.totalPlaces ?? 0),
    cargoAirCostUsd: Number(order.logistics?.cargoAirCostUsd ?? cargoComputed.air.totalCostUsd ?? 0),
    cargoContainerCostUsd: Number(order.logistics?.cargoContainerCostUsd ?? cargoComputed.container.totalCostUsd ?? 0),
    cargoAirEta: String(order.logistics?.cargoAirEtaDays ?? cargoComputed.air.eta ?? '—'),
    cargoContainerEta: String(order.logistics?.cargoContainerEtaDays ?? cargoComputed.container.eta ?? '—')
  };
};

const INVOICE_SHARED_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 210mm; margin: 0 auto; }
  body { font-family: 'Inter', Helvetica, Arial, sans-serif; color: #111827; background: #fff; font-size: 13px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  a { color: #0F2A44; text-decoration: underline; }

  /* ── Page layout ── */
  .page-wrap { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 26mm 20mm 24mm 20mm; background: #fff; }

  /* ── Header ── */
  .inv-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5mm; }
  .inv-logo { max-height: 56px; max-width: 200px; object-fit: contain; display: block; }
  .inv-brand-name { font-size: 18px; font-weight: 700; color: #0F2A44; letter-spacing: 0.02em; }
  .inv-company-sub { margin-top: 4px; font-size: 12px; color: #6B7280; line-height: 1.45; }
  .inv-title-col { text-align: right; }
  .inv-title { font-size: 34px; font-weight: 700; letter-spacing: 0.08em; color: #0F2A44; line-height: 1; }
  .inv-meta { margin-top: 8px; font-size: 13px; color: #111827; line-height: 1.65; }
  .inv-meta .lbl { color: #6B7280; }
  .inv-divider { height: 1px; background: #E5E7EB; margin: 5mm 0; }

  /* ── Customer / Vehicle block ── */
  .customer-table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
  .customer-table td { padding: 3px 0; vertical-align: top; }
  .customer-table td.lbl { font-size: 12px; color: #6B7280; width: 130px; padding-right: 12px; white-space: nowrap; }
  .customer-table td.val { font-size: 13px; color: #111827; font-weight: 500; }

  /* ── Section title ── */
  .sec-title { font-size: 14px; font-weight: 600; letter-spacing: 0.07em; color: #111827; text-transform: uppercase; margin: 0 0 3mm 0; }

  /* ── Parts table ── */
  .parts-table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
  .parts-table th { background: #F3F4F6; font-size: 12px; font-weight: 600; color: #6B7280; padding: 8px 10px; text-align: left; border: 1px solid #E5E7EB; }
  .parts-table td { padding: 9px 10px; border: 1px solid #E5E7EB; font-size: 13px; color: #111827; vertical-align: top; }
  .item-name { font-size: 14px; font-weight: 600; color: #111827; line-height: 1.3; }
  .item-desc { margin-top: 2px; font-size: 11px; color: #6B7280; line-height: 1.4; }
  .num-col { font-size: 13px; color: #111827; }
  .amt-col { font-size: 13px; font-weight: 600; color: #111827; }

  /* ── Totals section ── */
  .totals-section { display: flex; justify-content: flex-end; margin-bottom: 8mm; }
  .totals-inner { width: 260px; }
  .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; color: #111827; border-bottom: 1px solid #E5E7EB; }
  .totals-row .tr-label { color: #6B7280; }
  .totals-row .tr-val { font-weight: 500; }
  .totals-divider { height: 2px; background: #111827; margin: 6px 0 4px; }
  .totals-grand { display: flex; justify-content: space-between; padding: 4px 0; font-size: 18px; font-weight: 700; color: #111827; }

  /* ── Signature block ── */
  .sign-block { margin-top: 10mm; padding-top: 5mm; border-top: 1px solid #E5E7EB; display: flex; justify-content: space-between; align-items: flex-end; }
  .sign-left { }
  .sign-authorized { font-size: 12px; color: #6B7280; margin-bottom: 4px; }
  .sign-name { font-size: 16px; font-weight: 700; color: #111827; }
  .sign-right { text-align: right; }
  .sign-label { font-size: 11px; color: #6B7280; margin-bottom: 6px; }
  .sign-img { max-height: 60px; max-width: 160px; object-fit: contain; display: block; margin-left: auto; }
  .sign-placeholder { font-size: 11px; color: #6B7280; font-style: italic; }

  /* ── Footer ── */
  .inv-footer { margin-top: 6mm; padding-top: 3mm; border-top: 1px solid #E5E7EB; text-align: center; font-size: 11px; color: #6B7280; line-height: 1.6; }

  /* ── Empty state ── */
  .empty-state { padding: 16px; border: 1px solid #E5E7EB; text-align: center; color: #6B7280; font-size: 13px; }

  /* ── Terms link ── */
  .terms-row { margin-top: 4mm; padding-top: 3mm; border-top: 1px solid #E5E7EB; font-size: 12px; }
  .terms-row .tl { color: #6B7280; margin-bottom: 3px; }

  /* ── Logistics summary (cargo doc only) ── */
  .logistics-summary { margin-top: 4mm; border: 1px solid #E5E7EB; overflow: hidden; }
  .logistics-header { padding: 8px 12px; background: #F3F4F6; border-bottom: 1px solid #E5E7EB; font-size: 12px; font-weight: 600; color: #6B7280; text-transform: uppercase; letter-spacing: 0.07em; }
  .logistics-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); }
  .logistics-cell { padding: 8px 12px; border-right: 1px solid #E5E7EB; border-bottom: 1px solid #E5E7EB; }
  .logistics-cell:nth-child(3n) { border-right: none; }
  .logistics-cell:nth-last-child(-n+3) { border-bottom: none; }
  .logistics-cell-label { font-size: 11px; font-weight: 600; color: #6B7280; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.06em; }
  .logistics-cell-val { font-size: 13px; font-weight: 600; color: #111827; }

  /* ── Print ── */
  @media print {
    @page { size: A4 portrait; margin: 0; }
    html, body { width: 210mm; margin: 0; }
    .page-wrap { padding: 24mm 20mm; width: 210mm; min-height: 297mm; }
  }
`;

const openInvoicePrintWindow = ({
  order,
  lineItems,
  totals,
  currency,
  rates,
  lang,
  logoUrl,
  signatureUrl,
  managerName,
  termsFileUrl,
  termsFileName
}: {
  order: Order;
  lineItems: Array<{ name: string; description?: string; price: number }>;
  totals: { delivery: number; packing: number; serviceFee: number; totalAed: number };
  currency: QuoteCurrency;
  rates: QuoteRates;
  lang: 'en' | 'ru';
  logoUrl?: string;
  signatureUrl?: string;
  managerName?: string;
  termsFileUrl?: string;
  termsFileName?: string;
}) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  const exchangeRate = rates[currency] || 1;
  const convertAmount = (amountAed: number) => amountAed * exchangeRate;
  const moneyLabel = (amountAed: number) => `${convertAmount(amountAed).toFixed(2)} ${currency}`;

  const rows = lineItems.map((item, idx) => `
    <tr>
      <td class="num-col" style="width:36px;text-align:center">${idx + 1}</td>
      <td>
        <div class="item-name">${escapeHtml(item.name)}</div>
        ${item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : ''}
      </td>
      <td class="num-col" style="width:50px;text-align:center">1</td>
      <td class="num-col" style="width:130px;text-align:right">${moneyLabel(item.price)}</td>
      <td class="amt-col" style="width:130px;text-align:right">${moneyLabel(item.price)}</td>
    </tr>
  `).join('');

  const partsSubtotalAed = lineItems.reduce((sum, item) => sum + Number(item.price || 0), 0);

  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB';
  const issueDate = new Date();
  const invoiceId = order.id.slice(0, 8).toUpperCase();
  const billToName = String((order as any).clientName || (order as any).client_name || (order as any).customerName || '').trim() || 'Customer';
  const socialNickname = String((order as any).socialNickname || (order as any).social_nickname || '').trim();
  const customerContact = String((order as any).customerContact || (order as any).customer_contact || '').trim();
  const contactDetails = [customerContact, socialNickname].filter(Boolean).join(' · ');
  const vehicleLabel = `${order.brand} ${order.model} ${order.year || ''}`.trim();
  const managerLabel = (managerName || '').trim() || '—';

  printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=210mm, initial-scale=1" />
  <title>Invoice ${invoiceId}</title>
  <style>${INVOICE_SHARED_CSS}</style>
</head>
<body>
<div class="page-wrap">

  <!-- ── HEADER ── -->
  <div class="inv-header">
    <div>
      ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" class="inv-logo" alt="Dubai Spares" />` : `<div class="inv-brand-name">DUBAI SPARES</div>`}
      <div class="inv-company-sub">Automotive Parts &amp; Supply<br />Dubai, UAE</div>
    </div>
    <div class="inv-title-col">
      <div class="inv-title">INVOICE</div>
      <div class="inv-meta">
        <span class="lbl">Invoice No:&nbsp;</span>${invoiceId}<br />
        <span class="lbl">Date:&nbsp;</span>${issueDate.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' })}
      </div>
    </div>
  </div>

  <div class="inv-divider"></div>

  <!-- ── CUSTOMER / VEHICLE ── -->
  <table class="customer-table">
    <tbody>
      <tr><td class="lbl">Bill To:</td><td class="val">${escapeHtml(billToName)}</td></tr>
      <tr><td class="lbl">Contact:</td><td class="val">${escapeHtml(contactDetails || '—')}</td></tr>
      <tr><td class="lbl">Vehicle:</td><td class="val">${escapeHtml(vehicleLabel || '—')}</td></tr>
      <tr><td class="lbl">VIN:</td><td class="val">${escapeHtml(order.vin || '—')}</td></tr>
    </tbody>
  </table>

  <!-- ── PARTS TABLE ── -->
  <div class="sec-title">Parts &amp; Services</div>
  <table class="parts-table">
    <thead>
      <tr>
        <th style="width:36px;text-align:center">#</th>
        <th>Part Name</th>
        <th style="width:50px;text-align:center">Qty</th>
        <th style="width:130px;text-align:right">Unit Price</th>
        <th style="width:130px;text-align:right">Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="5" class="empty-state">No line items available</td></tr>`}
    </tbody>
  </table>

  <!-- ── TOTALS ── -->
  <div class="totals-section">
    <div class="totals-inner">
      <div class="totals-row"><span class="tr-label">Parts subtotal</span><span class="tr-val">${moneyLabel(partsSubtotalAed)}</span></div>
      <div class="totals-row"><span class="tr-label">Delivery</span><span class="tr-val">${moneyLabel(totals.delivery)}</span></div>
      <div class="totals-row"><span class="tr-label">Packing</span><span class="tr-val">${moneyLabel(totals.packing)}</span></div>
      <div class="totals-row"><span class="tr-label">Service fee</span><span class="tr-val">${moneyLabel(totals.serviceFee)}</span></div>
      <div class="totals-divider"></div>
      <div class="totals-grand"><span>GRAND TOTAL</span><span>${moneyLabel(totals.totalAed)}</span></div>
    </div>
  </div>

  <!-- ── TERMS ── -->
  ${termsFileUrl ? `
  <div class="terms-row">
    <div class="tl">Terms &amp; conditions document</div>
    <a href="${escapeHtml(termsFileUrl)}" target="_blank" rel="noreferrer">${escapeHtml(termsFileName || 'Download attached terms file')}</a>
  </div>` : ''}

  <!-- ── SIGNATURE ── -->
  <div class="sign-block">
    <div class="sign-left">
      <div class="sign-authorized">Authorized by:</div>
      <div class="sign-name">${escapeHtml(managerLabel)}</div>
    </div>
    <div class="sign-right">
      <div class="sign-label">Signature</div>
      ${signatureUrl
        ? `<img src="${escapeHtml(signatureUrl)}" class="sign-img" alt="Signature" />`
        : `<div class="sign-placeholder">Not configured</div>`}
    </div>
  </div>

  <!-- ── FOOTER ── -->
  <div class="inv-footer">
    Dubai Spares UAE &nbsp;|&nbsp; Automotive Parts Supplier &nbsp;|&nbsp; Dubai, United Arab Emirates
  </div>

</div>
<script>
  window.addEventListener('load', function() { window.focus(); window.print(); });
</script>
</body>
</html>`);

  printWindow.document.close();
  return true;
};

const openCargoLogisticsPrintWindow = ({
  order,
  currency,
  rates,
  lang,
  logoUrl,
  signatureUrl,
  managerName
}: {
  order: Order;
  currency: QuoteCurrency;
  rates: QuoteRates;
  lang: 'en' | 'ru';
  logoUrl?: string;
  signatureUrl?: string;
  managerName?: string;
}) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  const exchangeRate = rates[currency] || 1;
  const usdToAed = 1 / (rates['USD'] || DEFAULT_QUOTE_RATES['USD']);
  const cargoCostLabel = (amountUsd: number) => `${(amountUsd * usdToAed * exchangeRate).toFixed(2)} ${currency} (${amountUsd.toFixed(2)} USD)`;

  const {
    cargoCountry, cargoRealWeight, cargoChargeableWeight, cargoPlaces,
    cargoAirCostUsd, cargoContainerCostUsd, cargoAirEta, cargoContainerEta
  } = resolveInvoiceCargoData(order);

  const cargoParts = (order.parts || [])
    .filter((part) => Number((part as any).weightKg || 0) > 0 || Number((part as any).places || 0) > 0)
    .map((part) => ({
      name: String(part.name || 'Part'),
      qty: normalizePartQuantity((part as any).quantity),
      weightKg: Number((part as any).weightKg || 0),
      places: Number((part as any).places || 0),
      cargoPlaceGroup: String((part as any).cargoPlaceGroup || '').trim()
    }));
  const totalPartWeight = cargoParts.reduce((sum, part) => sum + part.weightKg * part.qty, 0);
  const cargoAllocatedRows = cargoParts.map((part) => {
    const partTotalWeight = part.weightKg * part.qty;
    const weightShare = totalPartWeight > 0 ? (partTotalWeight / totalPartWeight) : 0;
    const allocatedAirUsd = Math.round(cargoAirCostUsd * weightShare * 100) / 100;
    const allocatedContainerUsd = Math.round(cargoContainerCostUsd * weightShare * 100) / 100;
    return { ...part, partTotalWeight, allocatedAirUsd, allocatedContainerUsd };
  });
  const placeGroups = cargoAllocatedRows.map((r) => r.cargoPlaceGroup).filter(Boolean).join(', ') || '—';

  const allocationRows = cargoAllocatedRows.map((row, idx) => `
    <tr>
      <td class="num-col" style="text-align:center">${idx + 1}</td>
      <td><div class="item-name" style="font-size:13px">${escapeHtml(row.name)}</div></td>
      <td class="num-col" style="text-align:center">${row.qty}</td>
      <td class="num-col" style="text-align:right">${row.weightKg.toFixed(1)} kg</td>
      <td class="num-col" style="text-align:right">${row.partTotalWeight.toFixed(1)} kg</td>
      <td class="num-col" style="text-align:center">${row.places.toFixed(0)}</td>
      <td class="num-col">${escapeHtml(row.cargoPlaceGroup || '—')}</td>
      <td class="amt-col" style="text-align:right;font-size:12px">${cargoCostLabel(row.allocatedAirUsd)}</td>
      <td class="amt-col" style="text-align:right;font-size:12px">${cargoCostLabel(row.allocatedContainerUsd)}</td>
    </tr>
  `).join('');

  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB';
  const issueDate = new Date();
  const invoiceId = order.id.slice(0, 8).toUpperCase();

  const managerLabel = (managerName || '').trim() || '—';

  printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=210mm, initial-scale=1" />
  <title>Cargo &amp; Logistics — ${invoiceId}</title>
  <style>
    ${INVOICE_SHARED_CSS}
    .alloc-table { width:100%; border-collapse:collapse; }
    .alloc-table th { background:#F3F4F6; font-size:12px; font-weight:600; color:#6B7280; padding:8px 10px; text-align:left; border:1px solid #E5E7EB; }
    .alloc-table td { padding:8px 10px; border:1px solid #E5E7EB; font-size:12px; vertical-align:top; color:#111827; }
  </style>
</head>
<body>
<div class="page-wrap">

  <!-- ── HEADER ── -->
  <div class="inv-header">
    <div>
      ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" class="inv-logo" alt="Dubai Spares" />` : `<div class="inv-brand-name">DUBAI SPARES</div>`}
      <div class="inv-company-sub">Automotive Parts &amp; Supply<br />Dubai, UAE</div>
    </div>
    <div class="inv-title-col">
      <div class="inv-title" style="font-size:28px">CARGO</div>
      <div class="inv-meta">
        <span class="lbl">Invoice No:&nbsp;</span>${invoiceId}<br />
        <span class="lbl">Date:&nbsp;</span>${issueDate.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' })}
      </div>
    </div>
  </div>

  <div class="inv-divider"></div>

  <!-- ── CARGO SUMMARY ── -->
  <div class="sec-title">Cargo Summary</div>
  <div class="logistics-summary" style="margin-top:0">
    <div class="logistics-grid">
      <div class="logistics-cell">
        <div class="logistics-cell-label">Country / Route</div>
        <div class="logistics-cell-val">${escapeHtml(cargoCountry)}</div>
      </div>
      <div class="logistics-cell">
        <div class="logistics-cell-label">Total Real Weight</div>
        <div class="logistics-cell-val">${cargoRealWeight.toFixed(1)} kg</div>
      </div>
      <div class="logistics-cell">
        <div class="logistics-cell-label">Chargeable Weight</div>
        <div class="logistics-cell-val">${cargoChargeableWeight.toFixed(1)} kg</div>
      </div>
      <div class="logistics-cell">
        <div class="logistics-cell-label">Total Places</div>
        <div class="logistics-cell-val">${cargoPlaces.toFixed(0)}</div>
      </div>
      <div class="logistics-cell">
        <div class="logistics-cell-label">AIR — ${escapeHtml(cargoAirEta)} days</div>
        <div class="logistics-cell-val">${cargoCostLabel(cargoAirCostUsd)}</div>
      </div>
      <div class="logistics-cell">
        <div class="logistics-cell-label">CONTAINER — ${escapeHtml(cargoContainerEta)} days</div>
        <div class="logistics-cell-val">${cargoCostLabel(cargoContainerCostUsd)}</div>
      </div>
      ${cargoAllocatedRows.length > 0 ? `
      <div class="logistics-cell" style="grid-column:1/-1;border-right:none">
        <div class="logistics-cell-label">Place Groups</div>
        <div class="logistics-cell-val">${escapeHtml(placeGroups)}</div>
      </div>` : ''}
    </div>
  </div>

  <!-- ── PER-PART ALLOCATION ── -->
  ${cargoAllocatedRows.length > 0 ? `
  <div class="sec-title" style="margin-top:5mm">Per-Part Cargo Allocation</div>
  <table class="alloc-table">
    <thead>
      <tr>
        <th style="width:36px;text-align:center">#</th>
        <th>Part</th>
        <th style="width:44px;text-align:center">Qty</th>
        <th style="width:80px;text-align:right">Unit kg</th>
        <th style="width:80px;text-align:right">Total kg</th>
        <th style="width:60px;text-align:center">Places</th>
        <th style="width:80px">Group</th>
        <th style="width:160px;text-align:right">AIR</th>
        <th style="width:160px;text-align:right">CONTAINER</th>
      </tr>
    </thead>
    <tbody>
      ${allocationRows}
    </tbody>
  </table>` : `
  <div class="empty-state" style="margin-top:4mm">Cargo parameters are not filled yet</div>`}

  <!-- ── SIGNATURE ── -->
  <div class="sign-block">
    <div class="sign-left">
      <div class="sign-authorized">Authorized by:</div>
      <div class="sign-name">${escapeHtml(managerLabel)}</div>
    </div>
    <div class="sign-right">
      <div class="sign-label">Signature</div>
      ${signatureUrl
        ? `<img src="${escapeHtml(signatureUrl)}" class="sign-img" alt="Signature" />`
        : `<div class="sign-placeholder">Not configured</div>`}
    </div>
  </div>

  <!-- ── FOOTER ── -->
  <div class="inv-footer">
    Dubai Spares UAE &nbsp;|&nbsp; Automotive Parts Supplier &nbsp;|&nbsp; Dubai, United Arab Emirates
  </div>

</div>
<script>
  window.addEventListener('load', function() { window.focus(); window.print(); });
</script>
</body>
</html>`);

  printWindow.document.close();
  return true;
};

const PublicQuoteScreen: React.FC<{ orderId: string; mode?: 'quote' | 'tracking' }> = ({ orderId, mode = 'quote' }) => {
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
  const [isOpeningWhatsapp, setIsOpeningWhatsapp] = useState(false);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const errorCardRef = useRef<HTMLDivElement | null>(null);
  const errorIconRef = useRef<HTMLDivElement | null>(null);


  const t = i18n[lang];
  const params = useMemo(() => {
    // In HashRouter the query string lives inside window.location.hash (e.g. "#/q/ID?k=token"),
    // so window.location.search is always empty.  Extract the search portion from the hash first
    // and fall back to window.location.search for any non-hash deployments.
    const hashStr = window.location.hash;
    const qIdx = hashStr.indexOf('?');
    const hashSearch = qIdx >= 0 ? hashStr.slice(qIdx) : '';
    return new URLSearchParams(hashSearch || window.location.search);
  }, []);
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

      // Apply rates and currency from snapshot if URL params don't provide custom rates
      const sharedRates = parseQuoteRates(params.get('rates'));
      if (!sharedRates && resolvedBreakdown.rates) {
        const snapshotRates = resolvedBreakdown.rates as Record<string, number>;
        const fullRates: QuoteRates = { ...DEFAULT_QUOTE_RATES };
        (Object.keys(DEFAULT_QUOTE_RATES) as QuoteCurrency[]).forEach((code) => {
          const val = Number(snapshotRates[code]);
          if (Number.isFinite(val) && val > 0) fullRates[code] = val;
        });
        setRates(fullRates);
        setRateSource('Manager custom rates');
      }
      const sharedCurrency = (params.get('currency') || '').toUpperCase() as QuoteCurrency;
      if (!(sharedCurrency in DEFAULT_QUOTE_RATES) && resolvedBreakdown.currency && resolvedBreakdown.currency in DEFAULT_QUOTE_RATES) {
        setCurrency(resolvedBreakdown.currency as QuoteCurrency);
      }
      void logger.info('public-quote:view', 'Snapshot mapped to public order', {
        orderId: snapshotOrder.id || orderId,
        token,
        expired,
        hasLogistics: !!diagnosticsLogistics,
        logistics: diagnosticsLogistics || null,
        hasPublicTerms: !!diagnosticsSettings.publicWorkTerms.trim(),
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
  }, [orderId, publicQuoteKey, params, setRates, setCurrency, setRateSource]);

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

    // Run snapshot fetch and live hunt data fetch in parallel (using `oid` URL param
    // if available) to eliminate the race condition where loadQuote would call
    // setOrder before fetchHunt had a chance to update liveHuntStatusRef.current.
    const sharedSnapshot = await loadQuoteFromSharedSnapshot();

    if (sharedSnapshot.order) {
      if (sharedSnapshot.expired) {
        setOrder(null);
        setErrorType(EstimateErrorType.EXPIRED_LINK);
        setLoading(false);
        return false;
      }

      setOrder(sharedSnapshot.order as Order);
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
    return () => {
      loadControllerRef.current?.abort();
    };
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
    return photo;
  }, [order]);

  const partCards = useMemo(() => {
    if (!order) return [];
    const isFixedMarkup = (order.markupType || 'percent') === 'fixed';
    const fixedMarkupTotal = Number(order.markupFixedAed || 0);
    const partsWithPriceCount = order.parts.filter((part) => {
      const best = [...part.variants].sort((a, b) => a.priceAed - b.priceAed)[0];
      return !!best;
    }).length;
    const fixedMarkupPerPart = isFixedMarkup && partsWithPriceCount > 0 ? fixedMarkupTotal / partsWithPriceCount : 0;

    return order.parts.map((part) => {
      const quantity = normalizePartQuantity((part as any).quantity);
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
      const converted = clientAed * quantity * rates[currency];
      const bestVariantPhotos = sanitizePhotoList([best?.photoUrl || '', ...(best?.photos || [])]);
      const anyVariantPhotos = sanitizePhotoList(sortedVariants.flatMap((variant) => [variant.photoUrl || '', ...(variant.photos || [])]));
      const variantPhotos = bestVariantPhotos.length > 0 ? bestVariantPhotos : anyVariantPhotos;
      const basePartPhotos = sanitizePhotoList([part.photoUrl || '', ...(part.photos || [])]);
      const photoSource = variantPhotos.length > 0 ? variantPhotos : basePartPhotos;
      const uniquePhotos = sanitizePhotoList(photoSource);
      const previewPhotos = uniquePhotos;
      const galleryPhotos = uniquePhotos;
      return { part, quantity, best, previewPhotos, galleryPhotos, converted, clientAed, isReady, availability: isReady ? t.inStock : t.onOrder };
    });
  }, [order, currency, rates, t.inStock, t.onOrder]);

  const foundParts = partCards.filter((item) => item.isReady);

  const payloadTotals = useMemo(
    () => (snapshotPayload ? resolveTotalsFromPayload(snapshotPayload, rates) : null),
    [snapshotPayload, rates]
  );

  const totals = useMemo(() => {
    const fallbackSubtotal = foundParts.reduce((sum, item) => sum + (item.clientAed * item.quantity), 0);
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


  const cargoEstimates = useMemo(() => {
    if (!order) return null;
    const computed = calculateCargoEstimates(order, {});
    const country = String(order.logistics?.cargoCountry || computed.air.country || '—');
    const places = Number(order.logistics?.cargoTotalPlaces ?? computed.air.totalPlaces ?? 0);
    return {
      country,
      realWeight: Number(order.logistics?.cargoTotalWeightKg ?? computed.air.realWeight ?? 0),
      chargeableWeight: Number(order.logistics?.cargoChargeableWeightKg ?? computed.air.chargeableWeight ?? 0),
      places,
      airSeatUsd: 0,
      air: {
        eta: String(order.logistics?.cargoAirEtaDays || computed.air.eta || '—'),
        costUsd: Number(order.logistics?.cargoAirCostUsd ?? computed.air.totalCostUsd ?? 0)
      },
      container: {
        eta: String(order.logistics?.cargoContainerEtaDays || computed.container.eta || '—'),
        costUsd: Number(order.logistics?.cargoContainerCostUsd ?? computed.container.totalCostUsd ?? 0)
      }
    };
  }, [order]);

  const clientDisplayName = String(order?.clientName || '').trim();
  const clientNickname = String(order?.socialNickname || '').trim();

  const invoiceLineItems = useMemo(() => {
    if (!order) return [];

    const partByName = new Map(
      (order.parts || []).map((part) => [part.name.trim().toLowerCase(), part])
    );
    const buildPartDescription = (part?: Part | null) => {
      if (!part) return '';
      const groupItems = normalizeGroupItems((part as any).groupItems);
      const groupDetails = groupItems.length > 0
        ? `Состав группы:\n${groupItems.map((item) => `• ${item.name} ×${item.quantity}`).join('\n')}`
        : '';
      const commentDetails = part.comment?.trim() || '';
      return [groupDetails, commentDetails].filter(Boolean).join('\n');
    };

    const fromPayload = (payloadTotals?.items || [])
      .map((item) => {
        const convertedUnitAed = convertFromSourceToAed(item.unitPrice, item.currency, rates);
        const qty = Number.isFinite(Number(item.qty)) && Number(item.qty) > 0 ? Number(item.qty) : 1;
        const matchedPart = partByName.get(String(item.title || '').trim().toLowerCase()) || null;
        return {
          name: qty > 1 ? `${item.title} ×${qty}` : item.title,
          description: buildPartDescription(matchedPart),
          price: convertedUnitAed * qty
        };
      })
      .filter((item) => item.price > 0);

    if (fromPayload.length > 0) return fromPayload;

    return partCards
      .map(({ part, clientAed }) => ({
        name: normalizePartQuantity((part as any).quantity) > 1 ? `${part.name} ×${normalizePartQuantity((part as any).quantity)}` : part.name,
        description: buildPartDescription(part),
        price: clientAed * normalizePartQuantity((part as any).quantity)
      }))
      .filter((item) => item.price > 0);
  }, [order, partCards, payloadTotals, rates]);
  const confirmMessage = `Здравствуйте! Подтверждаю смету по ${order?.brand || ''} ${order?.model || ''} ${order?.year || ''}. ID: ${order?.id || ''}`;
  const payloadOwner = (order as any)?.payloadOwner || (order as any)?.owner || {};
  const payloadSettings = (order as any)?.public_settings || {};
  const settingsFromPayload = normalizePublicSettings(payloadSettings);
  const settings = mergePublicSettings(settingsFromPayload, resolvedSettings);
  const logoUrl = settings.publicCompanyLogoUrl;
  const signatureUrl = settings.publicInvoiceSignatureUrl;
  const managerName = settings.publicManagerName.trim();
  const termsFileUrl = settings.publicTermsFileUrl;
  const termsFileName = settings.publicTermsFileName;
  const normalizedOwner = normalizePayloadOwner(payloadOwner);
  const whatsappPhoneRaw = quoteContact?.whatsappPhone
    || settings.publicWhatsappNumber
    || (isPlaceholderWhatsapp(normalizedOwner.whatsappPhone) ? '' : normalizedOwner.whatsappPhone)
    || DEFAULT_PUBLIC_WHATSAPP;
  const whatsappPhoneDigits = normalizeWhatsappPhone(whatsappPhoneRaw);
  const canOpenWhatsapp = Boolean(whatsappPhoneDigits);
  const showDebug = useMemo(() => {
    try {
      return params.get('debug') === '1';
    } catch {
      return false;
    }
  }, [params]);

  const whatsappConfirmUrl = useMemo(() => {
    if (!canOpenWhatsapp) return '';
    const encoded = encodeURIComponent(confirmMessage);
    return `https://wa.me/${whatsappPhoneDigits}?text=${encoded}`;
  }, [canOpenWhatsapp, confirmMessage, whatsappPhoneDigits]);

  const openWhatsappChat = useCallback((placement: 'hero' | 'sticky') => {
    if (!whatsappConfirmUrl) return;
    setIsOpeningWhatsapp(true);
    logEvent('confirm_click', { placement });
    window.location.href = whatsappConfirmUrl;
  }, [whatsappConfirmUrl]);

  const isQuoteExpired = Boolean(expiresAtIso && Date.parse(expiresAtIso) < Date.now());

  const stickyStatusLabel = isQuoteExpired
    ? t.statusExpired
    : isOpeningWhatsapp
      ? t.statusLoading
      : !canOpenWhatsapp
        ? t.statusUnavailable
        : partsVerified
          ? t.statusConfirmed
          : t.statusDefault;

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
      currency,
      rates,
      lang,
      logoUrl,
      signatureUrl,
      managerName,
      termsFileUrl,
      termsFileName
    });
    if (opened) logEvent('pdf_download', { currency });
  };

  const downloadCargoPdf = async () => {
    if (!order) return;
    const opened = openCargoLogisticsPrintWindow({
      order,
      currency,
      rates,
      lang,
      logoUrl,
      signatureUrl,
      managerName
    });
    if (opened) logEvent('cargo_pdf_download', { currency });
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
{t.retry}
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
                    const url = `https://wa.me/${whatsappPhoneDigits}?text=${encodeURIComponent(t.expiredQuoteWhatsappMessage)}`;
                    window.location.href = url;
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white"
                >
                  <MessageCircle size={15} /> {t.contactUs}
                </button>
              ) : (
                <div className="text-sm text-slate-500">{t.contactManager}</div>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#eef2f7] text-slate-900">
      <div className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#f8f9fc]/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-1.5">
            <Globe size={14} className="text-slate-400" />
            <button type="button" onClick={() => setLang('en')} className={`h-9 rounded-full px-3 text-[11px] font-bold ${lang === 'en' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>EN</button>
            <button type="button" onClick={() => setLang('ru')} className={`h-9 rounded-full px-3 text-[11px] font-bold ${lang === 'ru' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>RU</button>
          </div>
        </div>
      </div>

      <header className="mx-auto mt-5 w-full max-w-[1180px] px-4 sm:px-6">
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white text-slate-900 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
          <div className="relative">
            {heroPhoto ? (
              <div className="relative h-56 overflow-hidden sm:h-72">
                <img src={heroPhoto} alt={`${order.brand} ${order.model}`} className="h-full w-full object-cover" />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0b142a]/85 via-[#0f1f3d]/45 to-transparent" />
              </div>
            ) : (
              <div className="relative h-44 bg-gradient-to-br from-[#1d3561] via-[#233f73] to-[#365489]" />
            )}

            <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 sm:p-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700">
                <ShieldCheck size={13} /> Dubai Spares UAE
              </div>
              {logoUrl && <img src={logoUrl} alt="Company logo" className="h-11 w-auto max-w-[180px] rounded-lg border border-slate-200 bg-white p-1.5 object-contain" />}
            </div>
          </div>

          <div className="space-y-5 px-5 pb-6 pt-5 sm:px-7 sm:pb-7">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.commercialOffer}</p>
                <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight text-[#0f1f3d] sm:text-[2.35rem]">{order.brand} {order.model} {order.year}</h1>
                <p className="mt-2 text-sm font-medium text-slate-600">VIN / REF: {maskVin(order.vin)}</p>
                {clientDisplayName && (
                  <p className="mt-2 text-sm font-semibold text-slate-700">
                    {t.clientLabel}: {clientDisplayName}{clientNickname ? ` (${clientNickname})` : ''}
                  </p>
                )}
              </div>
              <div className="min-w-[220px] rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-900 shadow-none">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.quoteTotal}</p>
                <p className="mt-1 text-4xl font-black leading-none text-[#0f1f3d]">{totals.totalConverted.toFixed(2)}</p>
                <p className="mt-0.5 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{currency}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(Object.keys(DEFAULT_QUOTE_RATES) as QuoteCurrency[]).map((code) => (
                    <button key={code} type="button" onClick={() => { setCurrency(code); logEvent('currency_switch', { currency: code }); }} className={`h-7 min-w-[42px] rounded-full px-2 text-[10px] font-bold transition ${currency === code ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{code}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {canOpenWhatsapp && (
                <button type="button" onClick={() => openWhatsappChat('hero')} className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#0f1f3d] px-5 text-sm font-semibold text-white transition hover:bg-[#162b52] active:scale-[0.98]">
                  <MessageCircle size={17} /> {t.confirmWhatsApp}
                </button>
              )}
              <button type="button" onClick={() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="inline-flex h-12 items-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.99]">
                <Images size={16} /> {t.viewParts}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-3 py-1.5"><ShieldCheck size={12} /> {t.trustedSupplierBadge}</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-3 py-1.5"><Clock3 size={12} /> {t.fastResponseBadge}</span>
              {expiresAtIso && <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-3 py-1.5 text-[11px] font-semibold text-amber-800"><Clock3 size={12} /> {t.validUntil}: {new Date(expiresAtIso).toLocaleDateString()}</span>}
            </div>

          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1180px] space-y-6 px-4 py-6 pb-28 sm:px-6">

        <section ref={detailRef} className="space-y-3">
          <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold uppercase tracking-[0.08em] text-slate-700">{t.partsGallery} — {partCards.length} {lang === 'ru' ? 'позиц.' : 'items'}</h2>
          </div>
          {partCards.map(({ part, quantity, converted, previewPhotos, galleryPhotos, availability }) => {
            const isGroupPart = part.partKind === 'group';
            const groupItems = normalizeGroupItems((part as any).groupItems);

            return (
            <article key={part.id} className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/95 shadow-[0_14px_34px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_38px_rgba(15,23,42,0.12)]">
              <div className="flex items-center gap-4 p-4 sm:gap-5 sm:p-5">
                {/* Photo — left */}
                <button
                  type="button"
                  onClick={() => {
                    if (galleryPhotos.length === 0) {
                      window.alert(t.noPhotos);
                      return;
                    }
                    setGallery({ images: galleryPhotos, index: 0 });
                    logEvent('gallery_open', { partId: part.id });
                  }}
                  className="relative shrink-0 inline-flex h-[86px] w-[86px] items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_25%_20%,#e2e8f0,#cbd5e1)] text-slate-500"
                  title={galleryPhotos.length > 1 ? `Фото: ${galleryPhotos.length}` : t.noPhotos}
                >
                  {previewPhotos[0] ? <img src={previewPhotos[0]} alt={part.name} className="h-full w-full object-cover" /> : <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-600"><Images size={20} /><span className="text-[9px] font-semibold uppercase tracking-[0.14em]">No photo</span></div>}
                  {galleryPhotos.length > 1 && (
                    <span aria-label={`${galleryPhotos.length} photos`} className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 py-0.5 text-[8px] font-bold text-white leading-none">{galleryPhotos.length}</span>
                  )}
                </button>

                {/* Name + status — center */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold leading-snug text-slate-900 text-sm sm:text-base">{part.name}{quantity > 1 ? ` ×${quantity}` : ''}</h3>
                  {isGroupPart && (
                    <p className="mt-1 text-[11px] font-semibold text-violet-700">{t.partGroupLabel} · {groupItems.length} {t.partGroupItems}</p>
                  )}
                  {isGroupPart && groupItems.length > 0 && (
                    <div className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                      {groupItems.map((item, idx) => <p key={`${part.id}-public-item-${idx}`} className="truncate">• {item.name} ×{item.quantity}</p>)}
                    </div>
                  )}
                  {part.comment ? <p className="mt-1 text-xs text-slate-500">{part.comment}</p> : null}
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>{availability}
                  </span>
                </div>

                {/* Price — right */}
                <div className="shrink-0 border-l border-slate-100 pl-3 text-right">
                  <p className="text-2xl font-black leading-none text-[#0f1f3d] sm:text-3xl">{converted.toFixed(2)}</p>
                  <p className="text-xs font-semibold text-slate-400 mt-0.5">{currency}</p>
                </div>
              </div>

            </article>
            );
          })}

          {!totals.hasPositions && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">{t.noPositions}</div>
          )}
        </section>


        {settings.publicWorkTerms.trim() && (
          <section className="overflow-hidden rounded-3xl border border-amber-200/80 bg-gradient-to-b from-amber-50 to-white p-5 text-sm text-amber-900 shadow-[0_12px_26px_rgba(180,83,9,0.09)]">
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]"><Info size={14} /> {t.policyNoticeTitle}</p>
            {settings.publicWorkTerms.trim() && <p className="mt-2 whitespace-pre-line">{settings.publicWorkTerms.trim()}</p>}
            <p className="mt-2 text-amber-800/90">{t.policyNoticeBody}</p>
          </section>
        )}

        {termsFileUrl && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t.workTermsTitle}</p>
            <a
              href={termsFileUrl}
              target="_blank"
              rel="noreferrer"
              download={termsFileName || 'terms.pdf'}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-sm"
            >
              <Download size={15} /> {t.downloadTerms}
            </a>
          </section>
        )}

        {cargoEstimates && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_26px_rgba(15,23,42,0.06)]">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{t.cargoTitle}</h2>
              <p className="mt-1 text-xs text-slate-500">{t.cargoHelper}</p>
            </div>
            <div className="divide-y divide-slate-100 px-5">
              <div className="flex items-center justify-between py-3 text-sm"><span className="text-slate-600">{t.country}</span><strong className="text-slate-900">{cargoEstimates.country}</strong></div>
              <div className="flex items-center justify-between py-3 text-sm"><span className="text-slate-600">{t.weight}</span><strong className="text-slate-900">{cargoEstimates.realWeight.toFixed(1)} kg</strong></div>
              <div className="flex items-center justify-between py-3 text-sm"><span className="text-slate-600">{t.totalPlaces}</span><strong className="text-slate-900">{cargoEstimates.places.toFixed(0)}</strong></div>
              <div className="flex items-center justify-between py-3 text-sm"><span className="text-slate-600">{t.air} ({cargoEstimates.air.eta} {t.etaDays})</span><strong className="text-slate-900">{(cargoEstimates.air.costUsd / (rates['USD'] || DEFAULT_QUOTE_RATES['USD']) * rates[currency]).toFixed(2)} {currency}</strong></div>
              <div className="flex items-center justify-between py-3 text-sm"><span className="text-slate-600">{t.container} ({cargoEstimates.container.eta} {t.etaDays})</span><strong className="text-slate-900">{(cargoEstimates.container.costUsd / (rates['USD'] || DEFAULT_QUOTE_RATES['USD']) * rates[currency]).toFixed(2)} {currency}</strong></div>
            </div>
          </section>
        )}


        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_26px_rgba(15,23,42,0.06)]">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t.priceBreakdown}</h2>
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
            <div className="mt-1 flex items-end justify-between border-t border-slate-200 py-5">
              <span className="text-sm font-bold uppercase tracking-[0.08em] text-slate-700">{t.total}</span>
              <strong className="text-[2rem] font-black text-[#0f1f3d]">{totals.totalConverted.toFixed(2)} <span className="text-base font-semibold text-slate-500">{currency}</span></strong>
            </div>
          </div>
        </section>

        {showDebug && (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
            <p className="break-all">buildStamp={APP_VERSION}/{GIT_SHA}/{BUILD_TIME} | snapshotSource={snapshotDebugMeta.snapshotSource} | hasContactsInSnapshot={Boolean((snapshotPayload as any)?.contacts?.whatsapp)} | contactsResolvedFrom={snapshotDebugMeta.contactsSource} | partsTotal={totals.subtotal.toFixed(2)} | feesTotal={totals.feesTotalAed.toFixed(2)} | grandTotal={totals.totalAed.toFixed(2)} | computedFrom={totals.computedFrom}</p>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_26px_rgba(15,23,42,0.06)]">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t.trust}</h2>
          </div>
          <div className="p-5 space-y-4">
            <ul className="space-y-2 text-sm text-slate-700">
              <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2"><CheckCircle2 size={16} className="mt-0.5 text-emerald-500" /> {t.trustedBy}</li>
              <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2"><CheckCircle2 size={16} className="mt-0.5 text-emerald-500" /> {t.yards}</li>
              <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2"><CheckCircle2 size={16} className="mt-0.5 text-emerald-500" /> {t.response}</li>
            </ul>
            {/* Trust signal — recent similar delivery */}
            <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
              <CheckCircle2 size={18} className="mt-0.5 text-emerald-500 shrink-0" />
              <p className="text-sm text-emerald-900">
                {lang === 'ru'
                  ? '✅ Похожий заказ успешно доставлен в Душанбе 3 дня назад'
                  : '✅ A similar order was successfully delivered to Dushanbe 3 days ago'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-slate-50 to-white p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="inline-flex items-center gap-2 font-bold text-slate-800"><Building2 size={16} /> {t.companyProfile}: Dubai Spares UAE</p>
                {logoUrl && <img src={logoUrl} alt="Company logo" className="h-20 w-auto max-w-[360px] object-contain" />}
              </div>

        <div className="flex flex-wrap gap-2">
                {whatsappPhoneDigits && (
                  <a href={`https://wa.me/${whatsappPhoneDigits}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(16,185,129,0.28)] transition hover:bg-emerald-400">
                    <MessageCircle size={15} /> WhatsApp
                  </a>
                )}
                {settings.publicInstagramUrl && (
                  <a href={settings.publicInstagramUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
                    <Instagram size={15} /> Instagram
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadPdf} className="inline-flex h-11 items-center gap-2 self-start rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]">
            <Download size={15} /> {t.downloadPdf}
          </button>
          <button type="button" onClick={downloadCargoPdf} className="inline-flex h-11 items-center gap-2 self-start rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]">
            <Download size={15} /> {t.downloadCargoPdf}
          </button>
        </div>

        {(signatureUrl || managerName) && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_10px_26px_rgba(15,23,42,0.06)]">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t.officialSignature}</p>
            <div className="mt-3 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{lang === 'ru' ? 'Имя и фамилия' : 'Name'}</p>
                <p className="mt-2 text-lg font-bold text-[#0f1f3d]">{managerName || (lang === 'ru' ? 'Не указано' : 'Not specified')}</p>
              </div>
              <div className="sm:text-right">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{t.signature}</p>
                <div className="mt-2 min-h-[74px]">
                  {signatureUrl ? (
                    <img src={signatureUrl} alt="Owner signature" className="h-20 w-auto object-contain sm:ml-auto" />
                  ) : (
                    <p className="text-sm text-slate-400">{lang === 'ru' ? 'Подпись не настроена' : 'Signature is not configured'}</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Footer branding */}
        <div className="py-4 text-center">
          <p className="text-[10px] text-slate-400">Dubai Spares UAE · {t.commercialOffer}</p>
          <p className="text-[9px] text-slate-300 mt-0.5">ID: {orderId}</p>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200/90 bg-white/90 px-3 py-1.5 pb-[calc(env(safe-area-inset-bottom)+6px)] backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t.quoteTotal}</p>
            <p className="text-lg font-black leading-tight text-[#0f1f3d]">{totals.totalConverted.toFixed(2)} <span className="text-sm text-slate-400">{currency}</span></p>
            <p className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600"><CheckCircle2 size={10} /> {stickyStatusLabel}</p>
          </div>
          <button type="button" disabled={!canOpenWhatsapp || isQuoteExpired} onClick={() => openWhatsappChat('sticky')} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-emerald-500 px-3.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(16,185,129,0.30)] transition hover:bg-emerald-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
            <MessageCircle size={16} /> {canOpenWhatsapp ? t.confirmWhatsApp : t.contactNotConfigured} <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

export default PublicQuoteScreen;
