import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  Download,
  Globe,
  MessageCircle,
  RefreshCcw
} from 'lucide-react';
import { supabase } from '../supabase';
import { Order, PriceVariant } from '../types';
import ImagePreview from '../components/ImagePreview';
import { DEFAULT_QUOTE_RATES, extractOrderIdFromQuoteSlug, parseQuoteRates, QuoteCurrency, QuoteRates } from '../shareUtils';
import { getOptimizedImageUrl } from '../storage/photos';
import { logger } from '../logging';
import { useAppSettings } from '../appSettings';

type Language = 'en' | 'ru';

const CURRENCY_LABELS: Record<QuoteCurrency, string> = { AED: 'Dirham', USD: 'Dollar', RUB: 'Ruble', TJS: 'Somoni' };

enum EstimateErrorType {
  NOT_FOUND = 'NOT_FOUND',
  NO_ACCESS = 'NO_ACCESS',
  OFFLINE = 'OFFLINE',
  SERVER_ERROR = 'SERVER_ERROR',
  EXPIRED_LINK = 'EXPIRED_LINK'
}

const i18n = {
  en: {
    quoteUnavailable: 'Quote not available.',
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
    serviceFee: 'Service fee',
    logistics: 'Logistics',
    total: 'Total',
    deliveryTerms: 'Delivery & terms',
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
    serviceFee: 'Сервисный сбор',
    logistics: 'Логистика',
    total: 'Итого',
    deliveryTerms: 'Доставка и условия',
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

const maskVin = (vin: string) => (vin.length > 8 ? `${vin.slice(0, 5)}...${vin.slice(-4)}` : vin || 'N/A');

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
  logistics: row.logistics || undefined,
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
  isSold: !!row.is_sold
});

const fetchLiveQuoteRates = async (): Promise<QuoteRates> => {
  const response = await fetch('https://open.er-api.com/v6/latest/AED');
  if (!response.ok) throw new Error(`Rate API error: ${response.status}`);
  const payload = await response.json();
  const rates = payload?.rates || {};
  return {
    AED: 1,
    USD: Number(rates.USD) > 0 ? Number(rates.USD) : DEFAULT_QUOTE_RATES.USD,
    RUB: Number(rates.RUB) > 0 ? Number(rates.RUB) : DEFAULT_QUOTE_RATES.RUB,
    TJS: Number(rates.TJS) > 0 ? Number(rates.TJS) : DEFAULT_QUOTE_RATES.TJS
  };
};

const isRelationQueryError = (error: unknown) => {
  if (typeof error !== 'object' || !error) return false;
  const anyErr = error as { code?: unknown; message?: unknown };
  const message = typeof anyErr.message === 'string' ? anyErr.message.toLowerCase() : '';
  return (anyErr.code === 'PGRST200' || anyErr.code === 'PGRST201')
    && (message.includes('relationship') || message.includes('embedded') || message.includes('not found'));
};

const isSchemaColumnError = (error: unknown) => {
  if (typeof error !== 'object' || !error) return false;
  const anyErr = error as { code?: unknown; message?: unknown };
  return anyErr.code === 'PGRST204' && typeof anyErr.message === 'string' && anyErr.message.includes('Could not find the');
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
  const [rateSource, setRateSource] = useState('Live market rates');
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [lang, setLang] = useState<Language>('en');
  const [partsVerified, setPartsVerified] = useState(false);
  const { settings } = useAppSettings();
  const detailRef = useRef<HTMLDivElement | null>(null);
  const errorCardRef = useRef<HTMLDivElement | null>(null);
  const errorIconRef = useRef<HTMLDivElement | null>(null);

  const t = i18n[lang];
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const expiresAt = Number(params.get('exp') || 0);
  const fallbackOrderId = extractOrderIdFromQuoteSlug(params.get('oid') || params.get('orderId') || '');
  const rawOid = (params.get('oid') || params.get('orderId') || '').trim();
  const candidateOrderIds = Array.from(new Set([orderId, fallbackOrderId, rawOid].filter(Boolean)));
  const token = params.get('token') || '';
  const hasSecurityToken = token.length >= 32;
  const isExpired = hasSecurityToken && Number.isFinite(expiresAt) && expiresAt <= Date.now();

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

    void (async () => {
      setIsRefreshingRates(true);
      try {
        setRates(await fetchLiveQuoteRates());
        setRateSource('Live market rates');
      } catch {
        setRates(DEFAULT_QUOTE_RATES);
        setRateSource('Default rates');
      } finally {
        setIsRefreshingRates(false);
      }
    })();
  }, [params]);

  useEffect(() => {
    logEvent('view', { isExpired, hasSecurityToken });
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
    if (isSchemaColumnError(loadError) || isRelationQueryError(loadError)) return EstimateErrorType.SERVER_ERROR;
    if (message.includes('token') || message.includes('jwt')) return EstimateErrorType.EXPIRED_LINK;
    if (status >= 500) return EstimateErrorType.SERVER_ERROR;
    return EstimateErrorType.NOT_FOUND;
  };

  const loadQuoteWithoutJoin = useCallback(async (candidateId: string) => {
    if (!supabase) return { data: null, error: new Error('Supabase not configured') };

    const orderResponse = await supabase
      .from('orders')
      .select('id,brand,model,year,body_type,vin,status,sales_status,vin_photo_url,priority,client_name,source,car_photo_url,car_photos,markup_percent,exchange_rate,created_at,is_archived,is_sold')
      .eq('id', candidateId)
      .maybeSingle();

    if (orderResponse.error || !orderResponse.data) {
      return { data: null, error: orderResponse.error };
    }

    const partsResponse = await supabase
      .from('parts')
      .select('id,order_id,name,photo_url,photos,is_found')
      .eq('order_id', candidateId);

    if (partsResponse.error) {
      return { data: null, error: partsResponse.error };
    }

    const parts = Array.isArray(partsResponse.data) ? partsResponse.data : [];
    const partIds = parts.map((item) => String(item.id));
    const variantsResponse = partIds.length === 0
      ? { data: [], error: null }
      : await supabase
        .from('price_variants')
        .select('id,part_id,price_aed,condition,availability,shop_name,phone,location,photo_url,photos,created_at')
        .in('part_id', partIds);

    if (variantsResponse.error) {
      return { data: null, error: variantsResponse.error };
    }

    const variantsByPart = new Map<string, any[]>();
    (variantsResponse.data || []).forEach((variant: any) => {
      const key = String(variant.part_id || '');
      if (!variantsByPart.has(key)) variantsByPart.set(key, []);
      variantsByPart.get(key)!.push(variant);
    });

    const stitched = {
      ...orderResponse.data,
      parts: parts.map((part: any) => ({ ...part, price_variants: variantsByPart.get(String(part.id)) || [] }))
    };

    return { data: stitched, error: null };
  }, []);

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

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const loadQuote = useCallback(async () => {
    if (!navigator.onLine && readQuoteFromCache()) {
      setLoading(false);
      return true;
    }
    if (!supabase) {
      setErrorType(EstimateErrorType.SERVER_ERROR);
      setLoading(false);
      return false;
    }

    const attempts = [0, 350, 900];
    for (let attempt = 0; attempt < attempts.length; attempt += 1) {
      if (attempts[attempt] > 0) await sleep(attempts[attempt]);

      for (const candidateId of candidateOrderIds) {
        let { data, error: loadError } = await supabase
          .from('orders')
          .select('id,brand,model,year,body_type,vin,status,sales_status,vin_photo_url,priority,client_name,source,car_photo_url,car_photos,markup_percent,exchange_rate,created_at,is_archived,is_sold,parts(*,price_variants(*))')
          .eq('id', candidateId)
          .maybeSingle();

        if (loadError && isRelationQueryError(loadError)) {
          const fallback = await loadQuoteWithoutJoin(candidateId);
          data = fallback.data;
          loadError = fallback.error as any;
        }

        if (data && !loadError) {
          window.localStorage.setItem(`public-quote-cache:${orderId}`, JSON.stringify(data));
          setOrder(mapDbOrder(data));
          setErrorType(null);
          setLoading(false);
          return true;
        }

        if (attempt === attempts.length - 1) {
          await logger.warn('quote-not-found', 'Quote lookup failed', { quoteId: orderId, candidateId, attempt, loadError });
          setOrder(null);
          setErrorType(detectErrorType(loadError, !!data));
        }
      }
    }

    setLoading(false);
    return false;
  }, [orderId, readQuoteFromCache, candidateOrderIds, loadQuoteWithoutJoin]);

  useEffect(() => {
    void loadQuote();
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
      await supabase?.auth.refreshSession();
      const ok = await loadQuote();
      if (!ok) shakeErrorCard();
    } finally {
      setIsRetrying(false);
    }
  };

  const heroPhoto = useMemo(() => {
    if (!order) return '';
    const photo = order.carPhotoUrl || order.carPhotos?.[0] || order.vinPhotoUrl || order.parts.find((part) => (part.photos || []).length > 0)?.photos?.[0] || '';
    return getOptimizedImageUrl(photo, { width: 1600, quality: 74 });
  }, [order]);

  const partCards = useMemo(() => {
    if (!order) return [];
    return order.parts.map((part) => {
      const best = [...part.variants].sort((a, b) => a.priceAed - b.priceAed)[0];
      const supplierAed = best?.priceAed || 0;
      const clientAed = supplierAed * (1 + order.markupPercent / 100);
      const converted = clientAed * rates[currency];
      const photos = [...(part.photos || []), ...(best?.photos || []), part.photoUrl || '', best?.photoUrl || ''].filter(Boolean) as string[];
      const isReady = !!best && part.isFound;
      const previewPhotos = photos.map((photo) => getOptimizedImageUrl(photo, { width: 480, quality: 64 }));
      const galleryPhotos = photos.map((photo) => getOptimizedImageUrl(photo, { width: 1600, quality: 74 }));
      return { part, best, previewPhotos, galleryPhotos, converted, clientAed, isReady, availability: isReady ? t.inStock : t.onOrder };
    });
  }, [order, currency, rates, t.inStock, t.onOrder]);

  const foundParts = partCards.filter((item) => item.isReady);
  const pendingParts = partCards.filter((item) => !item.isReady);

  const totals = useMemo(() => {
    const subtotal = foundParts.reduce((sum, item) => sum + item.clientAed, 0);
    const serviceFee = (order?.logistics?.serviceFeeAed || 0);
    const logistics = (order?.logistics?.deliveryAed || 0) + (order?.logistics?.packingAed || 0);
    const totalAed = subtotal + serviceFee + logistics;
    return { subtotal, serviceFee, logistics, totalAed, totalConverted: totalAed * rates[currency] };
  }, [foundParts, currency, rates, order]);

  const partsLine = foundParts.map(({ part }) => `${part.name} (${t.inStock})`).join(', ') || 'Selected parts';
  const confirmMessage = lang === 'ru'
    ? `Здравствуйте! Подтверждаю смету по ${order?.brand || ''} ${order?.model || ''} ${order?.year || ''}.\nVIN: ${maskVin(order?.vin || '')}\nИтого: ${totals.totalAed.toFixed(2)} AED.\nДетали: ${partsLine}.\nГотов(а) оформить. Подскажите срок и способ доставки.`
    : `Hello! I confirm the quote for ${order?.brand || ''} ${order?.model || ''} ${order?.year || ''}.\nVIN: ${maskVin(order?.vin || '')}\nTotal: ${totals.totalAed.toFixed(2)} AED.\nPart: ${partsLine}.\nPlease confirm delivery time and shipping options.`;
  const whatsappPhone = settings.publicWhatsappNumber || '971000000000';
  const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(confirmMessage)}`;

  const downloadPdf = () => {
    if (!order) return;
    const lines = [
      'Dubai Spares UAE - Quote',
      `${order.brand} ${order.model} ${order.year}`,
      `VIN: ${maskVin(order.vin)}`,
      `Total: ${totals.totalAed.toFixed(2)} AED`,
      `Valid until: ${new Date(expiresAt).toLocaleString()}`,
      '--- Parts ---',
      ...foundParts.map(({ part, clientAed }) => `${part.name}: ${clientAed.toFixed(2)} AED`),
      `Contact: +${whatsappPhone}`
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
      [EstimateErrorType.NOT_FOUND]: { title: t.notFoundTitle, body: t.notFoundBody, tone: 'text-rose-500', canRetry: true, canGoHome: true, canOpenOffline: false },
      [EstimateErrorType.NO_ACCESS]: { title: t.noAccessTitle, body: t.noAccessBody, tone: 'text-violet-500', canRetry: false, canGoHome: true, canOpenOffline: false },
      [EstimateErrorType.OFFLINE]: { title: t.offlineTitle, body: t.offlineBody, tone: 'text-amber-500', canRetry: true, canGoHome: false, canOpenOffline: true },
      [EstimateErrorType.SERVER_ERROR]: { title: t.serverErrorTitle, body: t.serverErrorBody, tone: 'text-orange-500', canRetry: true, canGoHome: false, canOpenOffline: false },
      [EstimateErrorType.EXPIRED_LINK]: { title: t.expiredTitle, body: t.expiredBody, tone: 'text-slate-500', canRetry: false, canGoHome: true, canOpenOffline: false }
    };
    const current = errorMeta[errorType || EstimateErrorType.SERVER_ERROR];
    return (
      <div className="min-h-screen bg-[#f5f5f7] text-slate-900 flex items-center justify-center px-4 text-center">
        <div ref={errorCardRef} className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
          <div ref={errorIconRef}><AlertCircle className={`mx-auto mb-3 ${current.tone}`} /></div>
          <h1 className="text-xl font-semibold">{current.title}</h1>
          <p className="mt-2 text-sm text-slate-600">{current.body}</p>
          <p className="mt-2 text-xs text-slate-400">ID: <code>{orderId}</code></p>
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
              <a href="/" className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">{t.backToOrders}</a>
            )}
            {errorType === EstimateErrorType.EXPIRED_LINK && (
              <a href={`https://wa.me/${whatsappPhone}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white">
                <MessageCircle size={15} /> {t.contactUs}
              </a>
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
            void (async () => {
              setIsRefreshingRates(true);
              try {
                setRates(await fetchLiveQuoteRates());
                setRateSource('Live market rates');
              } catch {
                setRateSource('Default rates');
              } finally {
                setIsRefreshingRates(false);
              }
            })();
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
              <span className="rounded-full bg-amber-500/90 px-3 py-1.5">🧾 {t.validUntil}: {new Date(expiresAt).toLocaleString()}</span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <a href={whatsappUrl} target="_blank" rel="noreferrer" onClick={() => logEvent('confirm_click', { placement: 'hero' })} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white">
                <MessageCircle size={16} /> {t.confirmWhatsApp}
              </a>
              <button type="button" onClick={() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold text-white backdrop-blur">📄 {t.viewParts}</button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-6 w-full max-w-5xl space-y-4 px-3 pb-28 sm:px-5">
        <section className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.whatIncluded}</h2>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-3">🔍 Sourcing in UAE</div>
            <div className="rounded-2xl bg-slate-50 p-3">📦 Packaging & handling</div>
            <div className="rounded-2xl bg-slate-50 p-3">🚚 Export support (optional)</div>
            <div className="rounded-2xl bg-slate-50 p-3">🛡️ Basic verification (photo/video)</div>
          </div>
        </section>

        <section ref={detailRef} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.partsGallery} ({foundParts.length})</h2>
          {foundParts.map(({ part, best, converted, previewPhotos, galleryPhotos, availability }) => {
            const partMessage = `Hello! I confirm ${part.name} for ${order.brand} ${order.model} ${order.year}.\nVIN: ${maskVin(order.vin || '')}.\nPrice: ${converted.toFixed(2)} ${currency}.`;
            const partWhatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(partMessage)}`;

            return (
            <article key={part.id} className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold">{part.name} <span className="text-sm text-slate-500">· {best?.condition || 'used'}</span></h3>
                  <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{t.status}: {availability}</span>
                </div>
                <p className="text-2xl font-semibold">{converted.toFixed(2)} {currency}</p>
              </div>

              {previewPhotos.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {previewPhotos.slice(0, 8).map((photo, idx) => (
                    <button key={`${part.id}-${idx}`} type="button" onClick={() => { setGallery({ images: galleryPhotos, index: idx }); logEvent('gallery_open', { partId: part.id }); }} className="min-h-20 overflow-hidden rounded-2xl border border-slate-200">
                      <img src={photo} alt={`${part.name} ${idx + 1}`} className="h-24 w-full object-cover" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              )}

              <a href={partWhatsappUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white">
                <MessageCircle size={14} /> {t.confirmWhatsApp}
              </a>
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

        <section className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-5 text-sm text-slate-700">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.deliveryTerms}</h2>
          <ul className="mt-2 space-y-1">
            <li>• Estimated delivery: 3–8 working days (subject to destination).</li>
            <li>• Warranty / return follows supplier terms.</li>
            <li>• {t.validUntil}: {new Date(expiresAt).toLocaleString()}.</li>
            <li>• {t.availabilityChange}</li>
          </ul>
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
            <p>WhatsApp: +{whatsappPhone}</p>
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
