import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Images,
  ChevronRight,
  Download,
  Globe,
  MessageCircle,
  RefreshCcw
} from 'lucide-react';
import { Order, PriceVariant } from '../types';
import ImagePreview from '../components/ImagePreview';
import { DEFAULT_QUOTE_RATES, parsePublicQuoteKey, parseQuoteRates, QuoteCurrency, QuoteRates } from '../shareUtils';
import { getOptimizedImageUrl } from '../storage/photos';
import { logger } from '../logging';
import { publicQuoteGetSnapshot } from '../publicQuoteApi';

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
    downloadPdf: 'Download PDF Quote'
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
    downloadPdf: 'Скачать PDF смету'
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
    raw.logistics
  );
  const packingAed = parseMoneyField(raw.packingAed, raw.packing_aed, raw.packing, raw.packagingAed, raw.packaging_aed, raw.packaging);
  const serviceFeeAed = parseMoneyField(
    raw.serviceFeeAed,
    raw.service_fee_aed,
    raw.serviceFee,
    raw.service_fee,
    raw.commissionAed,
    raw.commission_aed,
    raw.commission,
    raw.fee
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
    deliveryType: row?.deliveryType,
    delivery_type: row?.delivery_type
  };

  return normalizeLogistics(mergedSources);
};

const maskVin = (vin: string) => (vin.length > 8 ? `${vin.slice(0, 5)}...${vin.slice(-4)}` : vin || 'N/A');

const fetchPublicSnapshot = (token: string, signal?: AbortSignal) => publicQuoteGetSnapshot(token, { signal, timeoutMs: 20_000 });

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
  carPhotoUrl: row?.carPhotoUrl || row?.car_photo_url || row?.carPhotos?.[0] || row?.car_photos?.[0] || row?.vinPhotoUrl || row?.vin_photo_url || '',
  carPhotos: row?.carPhotos || row?.car_photos || [],
  logistics: resolveOrderLogistics(row),
  markupType: header?.markupType || row?.markupType || row?.markup_type || 'percent',
  markupFixedAed: Number(header?.markupFixedAed ?? row?.markupFixedAed ?? row?.markup_fixed_aed ?? row?.totals?.markup_aed ?? 0),
  parts: (row?.parts || []).map((part: any) => {
    const variantPrice = Number(part?.final_price_aed ?? part?.priceAed ?? part?.price_aed ?? 0);
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
      photoUrl: variant?.photoUrl || variant?.photo_url || variant?.photos?.[0] || '',
      photos: variant?.photos || [],
      createdAt: parseTimestamp(variant?.createdAt ?? variant?.created_at)
    }))
  });
  }),
  markupPercent: Number(header?.markupPercent ?? row?.markupPercent ?? row?.markup_percent ?? 0),
  exchangeRate: Number(header?.exchangeRate ?? row?.exchangeRate ?? row?.exchange_rate ?? row?.exchange_rate ?? 3.67),
  createdAt: parseTimestamp(row?.createdAt ?? row?.created_at),
  isArchived: !!row?.isArchived || !!row?.is_archived,
  isSold: !!row?.isSold || !!row?.is_sold,
  pricingEvents: Array.isArray(row?.pricingEvents || row?.pricing_events) ? (row?.pricingEvents || row?.pricing_events) : [],
  payloadOwner: row?.owner || null,
  public_settings: row?.public_settings || null
} as Order & { payloadOwner?: unknown; public_settings?: unknown });
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

const createSimplePdf = (lines: string[]): Blob => {
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const contentLines = lines.map((line, idx) => `BT /F1 12 Tf 50 ${780 - idx * 18} Td (${escape(line)}) Tj ET`).join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${contentLines.length} >> stream\n${contentLines}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj) => {
    offsets.push(pdf.length);
    pdf += `${obj}\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
};

const PublicQuoteScreen: React.FC<{ orderId: string }> = ({ orderId }) => {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorType, setErrorType] = useState<EstimateErrorType | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [currency, setCurrency] = useState<QuoteCurrency>('AED');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [rates, setRates] = useState<QuoteRates>(DEFAULT_QUOTE_RATES);
  const [rateSource, setRateSource] = useState('Default rates');
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [lang, setLang] = useState<Language>('en');
  const [partsVerified, setPartsVerified] = useState(false);
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
    if (!token) return { order: null, expired: false, notFound: true, corrupted: false };

    try {
      loadControllerRef.current?.abort();
      const controller = new AbortController();
      loadControllerRef.current = controller;
      if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        console.info('[public-quote] lookup token', { lookupToken: token, source: publicQuoteKey?.source, urlToken: publicQuoteKey?.urlToken, urlSnapshot: publicQuoteKey?.urlSnapshot });
      }
      const data = await fetchPublicSnapshot(token, controller.signal);
      if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        console.info('[public-quote] lookup result', {
          urlToken: publicQuoteKey?.urlToken || token,
          snapshot: publicQuoteKey?.urlSnapshot || null,
          dbTokenFound: data?.token || null
        });
      }
      if (!data) return { order: null, expired: false, notFound: true, corrupted: false };

      const expiresAt = typeof data.expires_at === 'string' ? Date.parse(data.expires_at) : NaN;
      const expired = !Number.isNaN(expiresAt) && expiresAt <= Date.now();
      setExpiresAtIso(typeof data.expires_at === 'string' ? data.expires_at : '');
      const payloadObj = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : null;
      if (!payloadObj) return { order: null, expired, notFound: false, corrupted: true };

      const snapshotOrder = mapSnapshotOrder(payloadObj);
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
    const photo = order.carPhotoUrl || order.carPhotos?.[0] || order.vinPhotoUrl || '';
    return getOptimizedImageUrl(photo, { width: 1600, quality: 74 });
  }, [order]);

  const partCards = useMemo(() => {
    if (!order) return [];
    const isFixedMarkup = (order.markupType || 'percent') === 'fixed';
    const fixedMarkupTotal = Number(order.markupFixedAed || 0);
    const readyPartsCount = order.parts.filter((part) => {
      const best = [...part.variants].sort((a, b) => a.priceAed - b.priceAed)[0];
      return !!best && part.isFound;
    }).length;
    const fixedMarkupPerPart = isFixedMarkup && readyPartsCount > 0 ? fixedMarkupTotal / readyPartsCount : 0;

    return order.parts.map((part) => {
      const best = [...part.variants].sort((a, b) => a.priceAed - b.priceAed)[0];
      const supplierAed = best?.priceAed || 0;
      const isReady = !!best && part.isFound;
      const clientAed = isFixedMarkup
        ? supplierAed + (isReady ? fixedMarkupPerPart : 0)
        : supplierAed * (1 + order.markupPercent / 100);
      const converted = clientAed * rates[currency];
      const variantPhotos = [best?.photoUrl || '', ...(best?.photos || [])].filter(Boolean) as string[];
      const basePartPhotos = [part.photoUrl || '', ...(part.photos || [])].filter(Boolean) as string[];
      const photoSource = variantPhotos.length > 0 ? variantPhotos : basePartPhotos;
      const uniquePhotos = Array.from(new Set(photoSource));
      const previewPhotos = uniquePhotos.map((photo) => getOptimizedImageUrl(photo, { width: 480, quality: 64 }));
      const galleryPhotos = uniquePhotos.map((photo) => getOptimizedImageUrl(photo, { width: 1600, quality: 74 }));
      return { part, best, previewPhotos, galleryPhotos, converted, clientAed, isReady, availability: isReady ? t.inStock : t.onOrder };
    });
  }, [order, currency, rates, t.inStock, t.onOrder]);

  const foundParts = partCards.filter((item) => item.isReady);
  const pendingParts = partCards.filter((item) => !item.isReady);

  const totals = useMemo(() => {
    const subtotal = foundParts.reduce((sum, item) => sum + item.clientAed, 0);
    const markup = 0;
    const serviceFee = parseMoneyField(order?.logistics?.serviceFeeAed);
    const delivery = parseMoneyField(order?.logistics?.deliveryAed);
    const packing = parseMoneyField(order?.logistics?.packingAed);
    const logistics = delivery + packing;
    const subtotalWithoutExtras = subtotal;
    const totalAed = subtotalWithoutExtras + serviceFee + logistics;
    return { subtotal, markup, subtotalWithoutExtras, serviceFee, delivery, packing, logistics, totalAed, totalConverted: totalAed * rates[currency] };
  }, [foundParts, currency, rates, order]);

  const partsLine = foundParts.map(({ part }) => `${part.name} (${t.inStock})`).join(', ') || 'Selected parts';
  const confirmMessage = lang === 'ru'
    ? `Здравствуйте! Подтверждаю смету по ${order?.brand || ''} ${order?.model || ''} ${order?.year || ''}.\nVIN: ${maskVin(order?.vin || '')}\nИтого: ${totals.totalAed.toFixed(2)} AED.\nДетали: ${partsLine}.\nГотов(а) оформить. Подскажите срок и способ доставки.`
    : `Hello! I confirm the quote for ${order?.brand || ''} ${order?.model || ''} ${order?.year || ''}.\nVIN: ${maskVin(order?.vin || '')}\nTotal: ${totals.totalAed.toFixed(2)} AED.\nPart: ${partsLine}.\nPlease confirm delivery time and shipping options.`;
  const payloadOwner = (order as any)?.payloadOwner || (order as any)?.owner || {};
  const payloadSettings = (order as any)?.public_settings || {};
  const whatsappPhoneRaw = typeof payloadOwner.whatsapp_phone === 'string' && payloadOwner.whatsapp_phone.trim()
    ? payloadOwner.whatsapp_phone
    : (typeof payloadSettings.whatsapp_phone === 'string' ? payloadSettings.whatsapp_phone : '');
  const whatsappPhoneDigits = whatsappPhoneRaw.replace(/\D/g, '');
  const whatsappUrl = whatsappPhoneDigits ? `https://wa.me/${whatsappPhoneDigits}?text=${encodeURIComponent(confirmMessage)}` : '';


  const downloadPdf = () => {
    if (!order) return;
    const lines = [
      'Dubai Spares UAE - Quote',
      `${order.brand} ${order.model} ${order.year}`,
      `VIN: ${maskVin(order.vin)}`,
      `Total: ${totals.totalAed.toFixed(2)} AED`,
      `Valid until: ${expiresAtIso ? new Date(expiresAtIso).toLocaleString() : '-'}`,
      '--- Parts ---',
      ...foundParts.map(({ part, clientAed }) => `${part.name}: ${clientAed.toFixed(2)} AED`),
      `Contact: ${whatsappPhoneDigits ? `+${whatsappPhoneDigits}` : 'Not configured'}`
    ];
    const blob = createSimplePdf(lines);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `quote-${order.id}.pdf`;
    link.click();
    URL.revokeObjectURL(link.href);
    logEvent('pdf_download');
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
                  window.location.href = '/request';
                }}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                {t.backToOrders}
              </button>
            )}
            {errorType === EstimateErrorType.EXPIRED_LINK && (
              whatsappPhoneDigits ? (
                <a href={`https://wa.me/${whatsappPhoneDigits}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white">
                  <MessageCircle size={15} /> {t.contactUs}
                </a>
              ) : (
                <div className="text-sm text-slate-500">Контакт не настроен</div>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-900">
      <div className="sticky top-0 z-40 border-b border-black/5 bg-white/90 px-3 py-2 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe size={15} className="text-slate-500" />
            <button type="button" onClick={() => setLang('en')} className={`rounded-full px-2 py-1 text-xs font-semibold ${lang === 'en' ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>EN</button>
            <button type="button" onClick={() => setLang('ru')} className={`rounded-full px-2 py-1 text-xs font-semibold ${lang === 'ru' ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>RU</button>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.currency}</span>
            {(Object.keys(DEFAULT_QUOTE_RATES) as QuoteCurrency[]).map((code) => (
              <button key={code} type="button" onClick={() => { setCurrency(code); logEvent('currency_switch', { currency: code }); }} className={`min-h-9 min-w-[58px] rounded-full px-3 text-sm font-semibold ${currency === code ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{code}</button>
            ))}
          </div>
        </div>
        <div className="mx-auto mt-2 flex w-full max-w-5xl items-center justify-between text-[11px] text-slate-500">
          <span>{t.source}: {rateSource}</span>
          <button type="button" className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-slate-700" onClick={() => {
            setIsRefreshingRates(true);
            window.setTimeout(() => {
              setRates(DEFAULT_QUOTE_RATES);
              setRateSource('Default rates');
              setIsRefreshingRates(false);
            }, 80);
          }}><RefreshCcw size={12} className={isRefreshingRates ? 'animate-spin' : ''} /> {t.refresh}</button>
        </div>
      </div>

      <header className="relative min-h-[50vh] overflow-hidden">
        {heroPhoto ? <img src={heroPhoto} alt={`${order.brand} ${order.model}`} className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-br from-slate-300 to-slate-500" />}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/45 to-black/70" />
        <div className="relative mx-auto flex h-full w-full max-w-5xl flex-col justify-between px-4 pb-8 pt-8 text-white">
          <div className="w-fit rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold backdrop-blur">VIN: {maskVin(order.vin)}</div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{order.brand} {order.model} {order.year}</h1>
            <p className="mt-4 text-4xl font-bold sm:text-5xl">{totals.totalConverted.toFixed(2)} {currency}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-emerald-500/90 px-3 py-1.5">✅ Verified UAE supplier</span>
              <span className="rounded-full bg-indigo-500/90 px-3 py-1.5">⚡ Fast response (5–15 min)</span>
              <span className="rounded-full bg-amber-500/90 px-3 py-1.5">🧾 {t.validUntil}: {expiresAtIso ? new Date(expiresAtIso).toLocaleString() : '-'}</span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {whatsappUrl ? (
              <a href={whatsappUrl} target="_blank" rel="noreferrer" onClick={() => logEvent('confirm_click', { placement: 'hero' })} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white">
                <MessageCircle size={16} /> {t.confirmWhatsApp}
              </a>
            ) : (
              <div className="inline-flex items-center rounded-xl bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-500">Контакт не настроен</div>
            )}
              <button type="button" onClick={() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold text-white backdrop-blur">📄 {t.viewParts}</button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-6 w-full max-w-5xl space-y-4 px-3 pb-28 sm:px-5">

        <section ref={detailRef} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.partsGallery} ({foundParts.length})</h2>
          {foundParts.map(({ part, best, converted, previewPhotos, galleryPhotos, availability }) => {
            const partMessage = `Hello! I confirm ${part.name} for ${order.brand} ${order.model} ${order.year}.\nVIN: ${maskVin(order.vin || '')}.\nPrice: ${converted.toFixed(2)} ${currency}.`;
            const partWhatsappUrl = whatsappPhoneDigits ? `https://wa.me/${whatsappPhoneDigits}?text=${encodeURIComponent(partMessage)}` : '';

            return (
            <article key={part.id} className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (galleryPhotos.length === 0) return;
                      setGallery({ images: galleryPhotos, index: 0 });
                      logEvent('gallery_open', { partId: part.id });
                    }}
                    className="mt-0.5 inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-600 disabled:opacity-40"
                    disabled={galleryPhotos.length === 0}
                    title={galleryPhotos.length > 1 ? `Фото: ${galleryPhotos.length}` : 'Фото детали'}
                  >
                    {previewPhotos[0] ? <img src={previewPhotos[0]} alt={part.name} className="h-full w-full object-cover" /> : <Images size={18} />}
                  </button>
                  <div className="min-w-0">
                    <h3 className="truncate text-xl font-semibold">{part.name}</h3>
                    <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{t.status}: {availability}</span>
                  </div>
                </div>
                <p className="text-right text-2xl font-semibold">{converted.toFixed(2)} {currency}</p>
              </div>

              {partWhatsappUrl ? (
              <a href={partWhatsappUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white">
                <MessageCircle size={14} /> {t.confirmWhatsApp}
              </a>
            ) : (
              <div className="mt-4 text-xs text-slate-500">Контакт не настроен</div>
            )}
            </article>
            );
          })}

          {pendingParts.length > 0 && (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap gap-2">
                {pendingParts.map(({ part }) => <span key={part.id} className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">{part.name}</span>)}
              </div>
            </div>
          )}
        </section>


        {(settings.publicDeliveryTerms.trim() || settings.publicWorkTerms.trim()) && (
          <section className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-5 text-sm text-slate-700">
            {settings.publicDeliveryTerms.trim() && <p className="whitespace-pre-line">{settings.publicDeliveryTerms.trim()}</p>}
            {settings.publicWorkTerms.trim() && <p className="whitespace-pre-line mt-2">{settings.publicWorkTerms.trim()}</p>}
          </section>
        )}

        <section className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-5 text-sm text-slate-700">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.priceBreakdown}</h2>
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between"><span>{t.partsSubtotal}</span><strong>{(totals.subtotal * rates[currency]).toFixed(2)} {currency}</strong></div>
            {totals.markup > 0 && <div className="flex items-center justify-between"><span>{t.markup}</span><strong>{(totals.markup * rates[currency]).toFixed(2)} {currency}</strong></div>}
            <div className="flex items-center justify-between"><span>{t.whatIncluded} ({t.partsSubtotal})</span><strong>{(totals.subtotalWithoutExtras * rates[currency]).toFixed(2)} {currency}</strong></div>
            <div className="flex items-center justify-between"><span>{t.logistics}</span><strong>{(totals.delivery * rates[currency]).toFixed(2)} {currency}</strong></div>
            <div className="flex items-center justify-between"><span>{t.packing}</span><strong>{(totals.packing * rates[currency]).toFixed(2)} {currency}</strong></div>
            <div className="flex items-center justify-between"><span>{t.serviceFee}</span><strong>{(totals.serviceFee * rates[currency]).toFixed(2)} {currency}</strong></div>
            <div className="mt-2 border-t border-dashed border-slate-200 pt-2 flex items-center justify-between text-base"><span className="font-semibold">{t.total}</span><strong>{totals.totalConverted.toFixed(2)} {currency}</strong></div>
          </div>
        </section>

        <section className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-5 text-sm text-slate-700">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.trust}</h2>
          <ul className="mt-2 space-y-1">
            <li>• {t.trustedBy}</li>
            <li>• {t.yards}</li>
            <li>• {t.response}</li>
          </ul>
          <div className="mt-3 rounded-2xl bg-slate-50 p-3">
            <p className="font-semibold text-slate-800">{t.companyProfile}: Dubai Spares UAE</p>
            <p>WhatsApp: {whatsappPhoneDigits ? `+${whatsappPhoneDigits}` : 'Not configured'}</p>
            {settings.publicTelegramUrl && <p>Telegram: {settings.publicTelegramUrl}</p>}
            {settings.publicInstagramUrl && <p>Instagram: {settings.publicInstagramUrl}</p>}
          </div>
        </section>

        <button type="button" onClick={downloadPdf} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm">
          <Download size={16} /> {t.downloadPdf}
        </button>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-black/5 bg-white/95 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-slate-500">{t.quoteTotal}</p>
            <p className="text-lg font-bold text-slate-900">{totals.totalConverted.toFixed(2)} {currency}</p>
            {partsVerified && <p className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 size={12} /> {t.partsVerified}</p>}
          </div>
          <a href={whatsappUrl} target="_blank" rel="noreferrer" onClick={() => logEvent('confirm_click', { placement: 'sticky' })} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-500 px-3 text-xs font-bold text-white shadow-[0_14px_42px_rgba(16,185,129,0.42)]">
            <MessageCircle size={16} /> {t.confirmWhatsApp} <ChevronRight size={16} />
          </a>
        </div>
      </div>

      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

export default PublicQuoteScreen;
