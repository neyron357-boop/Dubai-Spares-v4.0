import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, OrderPricingEvent, Part, Priority, OrderNote, Shop } from '../types';
import { buildShopMapLink, getShopOrderMatchScore, getShopRecommendationDiagnostics, getShopRecommendationLevel, isBrandMatch, isShopCompatibleWithOrder } from '../shopMatching';
import { SOURCES } from '../constants';
import { 
  ArrowLeft, 
  FileText, 
  Share2,
  ChevronRight, 
  Package, 
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  Image as ImageIcon,
  DollarSign,
  AlertTriangle,
  X,
  User,
  Smartphone,
  Star,
  Copy,
  MoreVertical,
  Clock3,
  Undo2,
  Check,
  Mic,
  Square,
  Play,
  Pause,
  FileAudio
} from 'lucide-react';
import EstimateModal from '../components/EstimateModal';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';
import { QuoteCurrency, QuoteRates, buildPartShareText, shareMessage, shareQuoteLink } from '../shareUtils';
import { supabase } from '../supabase';
import { fetchRadarShops } from '../radarShops';
import { logger } from '../logging';
import { syncPerf } from '../syncPerf';

const SALES_STATUSES = ['Inquiry', 'Price Sent', 'Pending Approval', 'Paid', 'Completed'] as const;

const CUSTOMER_STATUSES = ['VIP', 'LEAD', 'INQUIRY'] as const;
const PRIORITY_HINT: Record<Priority, string> = {
  [Priority.LOW]: 'можно отвечать позже',
  [Priority.MEDIUM]: 'обычная срочность',
  [Priority.HIGH]: 'нужно ускорить'
};
const SLA_HOURS = 24;
const MESSAGE_TEMPLATES = [
  'Принял заказ ✅ уточняю цены',
  'Нашёл варианты, отправляю смету',
  'Нужны уточнения (VIN/фото/комплектация)',
  'Подтвердите оплату / доставку',
  'Деталь закончилась — есть замена'
] as const;


const toRad = (v: number) => (v * Math.PI) / 180;
const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const calc =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
};



const sanitizeNumericInput = (raw: string) => {
  const cleaned = raw.replace(/[^\d]/g, '');
  if (!cleaned) return '';
  const withoutLeading = cleaned.replace(/^0+(?=\d)/, '');
  return withoutLeading || '0';
};


const formatPricingEventValue = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
};

const createPricingEvent = (field: OrderPricingEvent['field'], label: string, previousValue: unknown, nextValue: unknown): OrderPricingEvent | null => {
  const prev = formatPricingEventValue(previousValue);
  const next = formatPricingEventValue(nextValue);
  if (prev === next) return null;
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    field,
    label,
    previousValue: prev,
    nextValue: next,
    createdAt: Date.now()
  };
};

const OrderDetailsScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { orders, isLoading, updateOrder, suppliers, fetchOrderDetails } = useStore();
  const order = orders.find(o => o.id === id);

  const [isEstimateOpen, setIsEstimateOpen] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [deletePartId, setDeletePartId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNotePhotos, setNewNotePhotos] = useState<string[]>([]);
  const [newNoteAudios, setNewNoteAudios] = useState<string[]>([]);
  const noteFileRef = useRef<HTMLInputElement>(null);
  const noteAudioFileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  // Sell Flow State
  const [showSellConfirm, setShowSellConfirm] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTick, setRecordingTick] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<Record<string, number>>({});
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopsLoaded, setShopsLoaded] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [shopTagMap, setShopTagMap] = useState<Record<string, { models: string[]; years: string[] }>>({});

  const [newPartName, setNewPartName] = useState('');
  // Multiple photos for new part
  const [newPartPhotos, setNewPartPhotos] = useState<string[]>([]);
  const partFileRef = useRef<HTMLInputElement>(null);
  const partInputRef = useRef<HTMLInputElement>(null);

  // Exchange Rate Input State (Controlled)
  const [rateInput, setRateInput] = useState(order ? order.exchangeRate.toString() : '3.67');
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState(MESSAGE_TEMPLATES[0]);
  const [markupFixedInput, setMarkupFixedInput] = useState(order?.markupFixedAed?.toString() || '0');
  const [logisticsInputs, setLogisticsInputs] = useState({
    deliveryAed: String(Number(order?.logistics?.deliveryAed || 0)),
    packingAed: String(Number(order?.logistics?.packingAed || 0)),
    serviceFeeAed: String(Number(order?.logistics?.serviceFeeAed || 0))
  });
  const pricingSaveDebounceRef = useRef<number | null>(null);
  const logisticsCommitTimersRef = useRef<Partial<Record<'deliveryAed' | 'packingAed' | 'serviceFeeAed', number>>>({});
  const markupCommitTimerRef = useRef<number | null>(null);
  const exchangeRateCommitTimerRef = useRef<number | null>(null);
  const deferredFieldTimersRef = useRef<Partial<Record<keyof Order, number>>>({});
  const deferredFieldValuesRef = useRef<Partial<Record<keyof Order, any>>>({});
  const [draftFields, setDraftFields] = useState<Partial<Record<keyof Order, any>>>({});
  const lastKeystrokeAtRef = useRef<number>(0);
  const renderPerfStart = performance.now();

  // Sync local rate input if order changes
  useEffect(() => {
    if (order) setRateInput(order.exchangeRate.toString());
  }, [order?.id]);

  useEffect(() => {
    setMarkupFixedInput((order?.markupFixedAed || 0).toString());
  }, [order?.id, order?.markupFixedAed]);

  useEffect(() => {
    setLogisticsInputs({
      deliveryAed: String(Number(order?.logistics?.deliveryAed || 0)),
      packingAed: String(Number(order?.logistics?.packingAed || 0)),
      serviceFeeAed: String(Number(order?.logistics?.serviceFeeAed || 0))
    });
  }, [order?.id, order?.logistics?.deliveryAed, order?.logistics?.packingAed, order?.logistics?.serviceFeeAed]);

  useEffect(() => {
    const renderMs = Math.round((performance.now() - renderPerfStart) * 100) / 100;
    void logger.debug('PRICING_PERF', 'render_ms', { orderId: order?.id, renderMs });
  });

  useEffect(() => () => {
    if (pricingSaveDebounceRef.current) window.clearTimeout(pricingSaveDebounceRef.current);
    if (markupCommitTimerRef.current) window.clearTimeout(markupCommitTimerRef.current);
    if (exchangeRateCommitTimerRef.current) window.clearTimeout(exchangeRateCommitTimerRef.current);
    Object.values(deferredFieldTimersRef.current).forEach((timerId) => { if (timerId) window.clearTimeout(timerId); });
    (Object.values(logisticsCommitTimersRef.current) as number[]).forEach((timerId) => {
      if (timerId) window.clearTimeout(timerId);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);


  useEffect(() => {
    if (!id) return;
    const currentOrder = orders.find((item) => item.id === id);
    if (currentOrder && currentOrder.parts && currentOrder.parts.length > 0) return;
    void fetchOrderDetails(id);
  }, [id, orders, fetchOrderDetails]);
  useEffect(() => {
    if (!order) return;
    if (order.leadSource === 'public_form' && order.leadUnread) {
      updateOrder({ ...order, leadUnread: false, leadReadAt: Date.now(), isLead: false, status: 'active' });
    }
  }, [order?.id]);


  useEffect(() => {
    let active = true;

    const loadShops = async () => {
      const loadedShops = await fetchRadarShops(suppliers);
      if (!active) return;
      setShops(loadedShops);
      setShopsLoaded(true);
    };

    const shopsChannel = supabase
      ?.channel('order-details-radar-shops')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shops' }, () => {
        void loadShops();
      })
      .subscribe();

    void loadShops();
    return () => {
      active = false;
      if (shopsChannel) {
        void supabase?.removeChannel(shopsChannel);
      }
    };
  }, [suppliers]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setCurrentPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    });
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('shop_order_tags');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') setShopTagMap(parsed);
    } catch {
      setShopTagMap({});
    }
  }, [order.id, order.model, order.year]);

  useEffect(() => {
    if (!order || !shopsLoaded) return;

    const diagnostics = shops.map((shop) => ({ shop, diagnostics: getShopRecommendationDiagnostics(shop, order) }));
    const includedCount = diagnostics.filter(({ diagnostics: d }) => d.level !== 'none').length;
    const excludedCount = diagnostics.length - includedCount;

    void logger.debug('RECOMMENDATIONS', 'Input criteria', {
      orderId: order.id,
      brand: order.brand,
      model: order.model,
      year: order.year
    });

    void logger.info('RECOMMENDATIONS', 'Recommendation scan completed', {
      totalShops: diagnostics.length,
      includedCount,
      excludedCount
    });

    diagnostics
      .filter(({ diagnostics: d }) => d.level === 'none')
      .forEach(({ shop, diagnostics: d }) => {
        void logger.debug('RECOMMENDATIONS', `Shop '${shop.name}' excluded`, {
          shopId: shop.id,
          reason: d.reason || 'No tier criteria matched',
          brands: shop.specialization || [],
          models: shop.specializationModels || [],
          years: shop.specializationYears || []
        });
      });
  }, [order, shops, shopsLoaded]);

  if (!order && isLoading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-10 bg-gray-200 rounded-2xl" />
        <div className="h-24 bg-gray-200 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  const shareQuote = async (options?: { rates: QuoteRates; currency: QuoteCurrency }) => {
    if (!order) return;
    await shareQuoteLink(order, options);
  };

  if (!order) return <div className="p-10 text-center text-gray-400 font-bold">ЗАКАЗ НЕ НАЙДЕН</div>;


  const selectedOfferTotal = useMemo(() => order.parts.reduce((sum, p) => sum + (p.variants[0]?.priceAed || 0), 0), [order.parts]);
  const logistics = useMemo(() => ({
    deliveryType: order.logistics?.deliveryType || 'uae',
    deliveryAed: Number(logisticsInputs.deliveryAed || 0),
    packingAed: Number(logisticsInputs.packingAed || 0),
    serviceFeeAed: Number(logisticsInputs.serviceFeeAed || 0)
  }), [order.logistics?.deliveryType, logisticsInputs.deliveryAed, logisticsInputs.packingAed, logisticsInputs.serviceFeeAed]);
  const logisticsTotal = useMemo(() => logistics.deliveryAed + logistics.packingAed + logistics.serviceFeeAed, [logistics.deliveryAed, logistics.packingAed, logistics.serviceFeeAed]);
  const markupType = order.markupType || 'percent';
  const markupAed = useMemo(() => (markupType === 'fixed'
    ? Number(markupFixedInput || 0)
    : selectedOfferTotal * (order.markupPercent / 100)), [markupType, markupFixedInput, selectedOfferTotal, order.markupPercent]);
  const sellTotalAed = selectedOfferTotal + logisticsTotal + markupAed;
  const canComputeProfit = selectedOfferTotal > 0;
  const netProfitAed = canComputeProfit ? sellTotalAed - selectedOfferTotal - logisticsTotal : null;
  const lowMargin = canComputeProfit && selectedOfferTotal > 0 && markupAed / selectedOfferTotal < 0.03;
  const isLoss = canComputeProfit && sellTotalAed < selectedOfferTotal + logisticsTotal;

  const rateByCurrency: Record<string, number> = {
    AED: 1,
    USD: order.exchangeRate || 3.67,
    RUB: 0.04,
    TJS: 0.34
  };
  const clientCurrency = order.clientCurrency || 'USD';
  const clientRate = rateByCurrency[clientCurrency] || order.exchangeRate || 3.67;
  const formatMoney = (value: number, currency = 'AED') => {
    const amount = currency === 'AED' ? value : value / clientRate;
    return `${amount.toFixed(currency === 'AED' ? 0 : 2)} ${currency}`;
  };

  const calculateCurrentProfit = () => {
    if (!canComputeProfit || netProfitAed === null) return 0;
    return netProfitAed / (order.exchangeRate || 3.67);
  };

  const profitUsd = order.isSold && order.soldProfitUsd !== undefined
    ? order.soldProfitUsd.toFixed(2)
    : calculateCurrentProfit().toFixed(2);

  const dismissedShopIds = new Set(order.dismissedShopIds || []);
  const orderAgeHours = Math.floor((Date.now() - order.createdAt) / (1000 * 60 * 60));
  const isSlaBreached = orderAgeHours >= SLA_HOURS;
  const vinIsValid = /^[A-HJ-NPR-Z0-9]{17}$/.test((order.vin || '').toUpperCase());
  const vinIsIncomplete = !!order.vin && !vinIsValid;

  const applyTemplate = (template: string) => template
    .replace('{client_name}', order.clientName || 'клиент')
    .replace('{car}', `${order.brand} ${order.model}`.trim())
    .replace('{vin}', order.vin || 'VIN не указан')
    .replace('{total}', formatMoney(sellTotalAed, clientCurrency))
    .replace('{currency}', clientCurrency)
    .replace('{eta}', '1-2 дня')
    .replace('{order_link}', window.location.href);

  const openWhatsappClient = () => {
    const phone = (order.customerContact || '').replace(/[^\d+]/g, '');
    if (!phone || phone.length < 8) return;
    const message = applyTemplate(selectedTemplate);
    window.open(`https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const updateCustomerStatus = (nextStatus: 'VIP' | 'LEAD' | 'INQUIRY') => {
    const prevStatus = order.customerStatus || (order.isVip ? 'VIP' : order.isLead ? 'LEAD' : 'INQUIRY');
    if (prevStatus === nextStatus) return;
    updateOrder({
      ...order,
      customerStatus: nextStatus,
      isVip: nextStatus === 'VIP',
      isLead: nextStatus === 'LEAD',
      statusChangedAt: Date.now(),
      statusChangedBy: 'current-user'
    });
    setToast({
      message: 'Статус обновлён ✅',
      undo: () => updateOrder({
        ...order,
        customerStatus: prevStatus,
        isVip: prevStatus === 'VIP',
        isLead: prevStatus === 'LEAD'
      })
    });
  };

  const isStrictBrandShop = (shop: Shop) => {
    const shopBrands = Array.from(new Set([...(shop.specialization || []), ...(shop.mainBrands || [])]));
    return shopBrands.some((brand) => isBrandMatch(order.brand, brand));
  };

  const strictBrandShops = shops.filter((shop) => isStrictBrandShop(shop));
  const manuallyRecommendedShops = strictBrandShops.filter((shop) => (order.recommendedShopIds || []).includes(shop.id) && !dismissedShopIds.has(shop.id));

  const autoRecommendedShops = strictBrandShops.filter((shop) => !dismissedShopIds.has(shop.id) && (isShopCompatibleWithOrder(shop, order) || getShopOrderMatchScore(shop, order) >= 2));

  const mergedRecommendations = Array.from(new Map([...manuallyRecommendedShops, ...autoRecommendedShops].map((shop) => [shop.id, shop])).values());
  const fallbackNearest = strictBrandShops
    .map((shop) => ({
      ...shop,
      score: getShopOrderMatchScore(shop, order),
      distance: currentPosition ? distanceMeters(currentPosition, { lat: shop.latitude, lng: shop.longitude }) : Number.MAX_SAFE_INTEGER
    }))
    .filter((shop) => !mergedRecommendations.some((selected) => selected.id === shop.id))
    .sort((a, b) => (b.score - a.score) || (a.distance - b.distance))
    .slice(0, 4);

  const recommendedShops = [...mergedRecommendations.map((shop) => ({
    ...shop,
    distance: currentPosition ? distanceMeters(currentPosition, { lat: shop.latitude, lng: shop.longitude }) : Number.MAX_SAFE_INTEGER
  })), ...(mergedRecommendations.length > 0 ? [] : fallbackNearest)]
    .sort((a, b) => a.distance - b.distance);

  const groupedRecommendations = {
    high: recommendedShops.filter((shop) => getShopRecommendationLevel(shop, order) === 'high'),
    medium: recommendedShops.filter((shop) => getShopRecommendationLevel(shop, order) === 'medium'),
    low: recommendedShops.filter((shop) => getShopRecommendationLevel(shop, order) === 'low'),
    none: recommendedShops.filter((shop) => getShopRecommendationLevel(shop, order) === 'none')
  };

  const navigateToShop = (shop: Shop) => {
    window.open(buildShopMapLink(shop), '_blank');
  };

  const contactAllRecommendedShops = () => {
    const firstPart = order.parts.find((part) => part.name.trim());
    const partName = firstPart?.name || 'part';
    const message = `Hi, do you have ${partName} for ${order.vin}?`;

    recommendedShops.forEach((shop) => {
      const rawPhone = (shop.phone || '').replace(/[^\d+]/g, '');
      if (!rawPhone) return;
      const whatsappUrl = `https://wa.me/${rawPhone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`;
      window.open(whatsappUrl, '_blank');
    });
  };


  const addManualRecommendation = (shopId: string) => {
    if (!shopId) return;
    const current = new Set(order.recommendedShopIds || []);
    current.add(shopId);
    const nextDismissed = (order.dismissedShopIds || []).filter((id) => id !== shopId);
    updateOrder({ ...order, recommendedShopIds: Array.from(current), dismissedShopIds: nextDismissed });

    try {
      const raw = localStorage.getItem('shop_order_tags');
      const map = raw ? JSON.parse(raw) : {};
      const entry = map[shopId] || { models: [], years: [] };
      const models = Array.from(new Set([...(entry.models || []), order.model].filter(Boolean)));
      const years = Array.from(new Set([...(entry.years || []), order.year].filter(Boolean)));
      map[shopId] = { models, years };
      localStorage.setItem('shop_order_tags', JSON.stringify(map));
    } catch {
      // no-op for private mode
    }
  };

  const removeManualRecommendation = (shopId: string) => {
    const next = (order.recommendedShopIds || []).filter((id) => id !== shopId);
    updateOrder({ ...order, recommendedShopIds: next });
  };

  const dismissShopRecommendation = (shopId: string) => {
    const nextDismissed = Array.from(new Set([...(order.dismissedShopIds || []), shopId]));
    const nextRecommended = (order.recommendedShopIds || []).filter((id) => id !== shopId);
    updateOrder({ ...order, recommendedShopIds: nextRecommended, dismissedShopIds: nextDismissed });
  };

  const restoreDismissedRecommendations = () => {
    updateOrder({ ...order, dismissedShopIds: [] });
  };

  const commitDeferredOrderField = (field: keyof Order, rawValue?: any) => {
    const value = rawValue ?? deferredFieldValuesRef.current[field];
    const trackedFieldLabels: Partial<Record<keyof Order, string>> = {
      markupPercent: 'Наценка %',
      markupType: 'Тип наценки',
      markupFixedAed: 'Наценка (фикс AED)',
      exchangeRate: 'Курс валюты',
      clientCurrency: 'Валюта клиента'
    };

    const trackedLabel = trackedFieldLabels[field];
    const event = trackedLabel
      ? createPricingEvent(field as OrderPricingEvent['field'], trackedLabel, order[field], value)
      : null;

    updateOrder({
      ...order,
      [field]: value,
      pricingEvents: event ? [event, ...(order.pricingEvents || [])] : order.pricingEvents
    });

    setDraftFields((prev) => {
      const { [field]: _unused, ...rest } = prev;
      return rest;
    });
    deferredFieldValuesRef.current[field] = undefined;
    deferredFieldTimersRef.current[field] = undefined;
  };

  const flushDeferredOrderField = (field: keyof Order) => {
    const timer = deferredFieldTimersRef.current[field];
    if (timer) window.clearTimeout(timer);
    if (deferredFieldValuesRef.current[field] !== undefined) {
      commitDeferredOrderField(field);
    }
  };

  const updateOrderField = (field: keyof Order, value: any) => {
    const keyStart = performance.now();
    const shouldDebounce = (typeof value === 'string' || typeof value === 'number')
      && !['markupType', 'clientCurrency', 'salesStatus', 'priority', 'deliveryType'].includes(String(field));

    if (!shouldDebounce) {
      commitDeferredOrderField(field, value);
      syncPerf.recordTypingSample(Math.round((performance.now() - keyStart) * 100) / 100);
      return;
    }

    lastKeystrokeAtRef.current = performance.now();
    setDraftFields((prev) => ({ ...prev, [field]: value }));
    deferredFieldValuesRef.current[field] = value;
    const existingTimer = deferredFieldTimersRef.current[field];
    if (existingTimer) window.clearTimeout(existingTimer);
    deferredFieldTimersRef.current[field] = window.setTimeout(() => {
      const elapsed = Math.round((performance.now() - lastKeystrokeAtRef.current) * 100) / 100;
      void logger.debug('PRICING_PERF', 'typing_commit_latency', { orderId: order.id, field, elapsedMs: elapsed });
      commitDeferredOrderField(field);
    }, 650);
    syncPerf.recordTypingSample(Math.round((performance.now() - keyStart) * 100) / 100);
  };


  const updatePriority = (nextPriority: Priority) => {
    updateOrder({ ...order, priority: nextPriority, priorityChangedAt: Date.now() });
  };

  const copyText = async (value: string, success = 'Скопировано') => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setToast({ message: success });
    } catch {
      setToast({ message: 'Не удалось скопировать' });
    }
  };

  const pasteVinFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      updateOrderField('vin', text.toUpperCase().replace(/\s+/g, ''));
    } catch {
      setToast({ message: 'Буфер недоступен' });
    }
  };

  const scheduleDebouncedSaveLog = useCallback(() => {
    if (pricingSaveDebounceRef.current) window.clearTimeout(pricingSaveDebounceRef.current);
    void logger.debug('PRICING_PERF', 'save_debounced_scheduled', { orderId: order.id, delayMs: 1000 });
    pricingSaveDebounceRef.current = window.setTimeout(() => {
      void logger.debug('PRICING_PERF', 'save_debounced_flush', { orderId: order.id });
      pricingSaveDebounceRef.current = null;
    }, 1000);
  }, [order.id]);

  const commitLogisticsField = useCallback((field: 'deliveryAed' | 'packingAed' | 'serviceFeeAed', forcedValue?: number) => {
    const commitStart = performance.now();
    const nextValue = forcedValue ?? Number(logisticsInputs[field] || 0);
    const prevValue = Number(order.logistics?.[field] || 0);
    if (prevValue === nextValue) return;

    const eventLabels: Record<'deliveryAed' | 'packingAed' | 'serviceFeeAed', string> = {
      deliveryAed: 'Логистика AED',
      packingAed: 'Упаковка AED',
      serviceFeeAed: 'Комиссия AED'
    };
    const eventFieldMap: Record<'deliveryAed' | 'packingAed' | 'serviceFeeAed', OrderPricingEvent['field']> = {
      deliveryAed: 'logistics.deliveryAed',
      packingAed: 'logistics.packingAed',
      serviceFeeAed: 'logistics.serviceFeeAed'
    };
    void logger.debug('PRICING_PERF', 'pricing_commit_start', { orderId: order.id, field: eventFieldMap[field], oldValue: prevValue, newValue: nextValue, source: 'ui_commit' });
    const event = createPricingEvent(eventFieldMap[field], eventLabels[field], prevValue, nextValue);
    if (event) {
      void logger.debug('PRICING_PERF', 'pricing_event_appended', { orderId: order.id, field: event.field, oldValue: event.previousValue, newValue: event.nextValue });
    }

    updateOrder({
      ...order,
      logistics: {
        ...order.logistics,
        [field]: nextValue
      },
      pricingEvents: event ? [event, ...(order.pricingEvents || [])] : order.pricingEvents
    });
    const commitMs = Math.round((performance.now() - commitStart) * 100) / 100;
    void logger.debug('PRICING_PERF', 'pricing_commit_end', { orderId: order.id, field: eventFieldMap[field], commitMs });
    scheduleDebouncedSaveLog();
  }, [logisticsInputs, order, scheduleDebouncedSaveLog, updateOrder]);

  const flushLogisticsFieldCommit = useCallback((field: 'deliveryAed' | 'packingAed' | 'serviceFeeAed') => {
    const timerId = logisticsCommitTimersRef.current[field];
    if (timerId) window.clearTimeout(timerId);
    commitLogisticsField(field);
    logisticsCommitTimersRef.current[field] = undefined;
  }, [commitLogisticsField]);

  const updateLogisticsField = (field: 'deliveryType' | 'deliveryAed' | 'packingAed' | 'serviceFeeAed', value: string) => {
    if (field === 'deliveryType') {
      const event = createPricingEvent('logistics.deliveryType', 'Тип доставки', order.logistics?.deliveryType || 'uae', value);
      updateOrder({ ...order, logistics: { ...order.logistics, deliveryType: value }, pricingEvents: event ? [event, ...(order.pricingEvents || [])] : order.pricingEvents });
      return;
    }

    const keyStart = performance.now();
    const sanitized = sanitizeNumericInput(value);
    setLogisticsInputs((prev) => ({ ...prev, [field]: sanitized }));
    const timerId = logisticsCommitTimersRef.current[field];
    if (timerId) window.clearTimeout(timerId);
    logisticsCommitTimersRef.current[field] = window.setTimeout(() => {
      commitLogisticsField(field, Number(sanitized || 0));
      logisticsCommitTimersRef.current[field] = undefined;
    }, 700);
    syncPerf.recordTypingSample(Math.round((performance.now() - keyStart) * 100) / 100);
  };

  const handleRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const startedAt = performance.now();
    const rawVal = e.target.value;
    if (!/^[\d]*[.,]?[\d]*$/.test(rawVal)) return;

    setRateInput(rawVal);

    const normalized = rawVal.replace(',', '.');
    const num = parseFloat(normalized);

    if (!isNaN(num) && num > 0) {
      if (exchangeRateCommitTimerRef.current) window.clearTimeout(exchangeRateCommitTimerRef.current);
      exchangeRateCommitTimerRef.current = window.setTimeout(() => {
        updateOrderField('exchangeRate', num);
        exchangeRateCommitTimerRef.current = null;
      }, 600);
      syncPerf.recordTypingSample(Math.round((performance.now() - startedAt) * 100) / 100);
    }
  };

  const commitMarkupFixed = useCallback((forcedValue?: number) => {
    const commitStart = performance.now();
    const nextValue = forcedValue ?? Number(markupFixedInput || 0);
    const previousValue = Number(order.markupFixedAed || 0);
    const previousType = order.markupType || 'percent';
    if (nextValue === previousValue && previousType === 'fixed') return;

    void logger.debug('PRICING_PERF', 'pricing_commit_start', { orderId: order.id, field: 'markupFixedAed', oldValue: previousValue, newValue: nextValue, source: 'ui_commit' });
    const amountEvent = createPricingEvent('markupFixedAed', 'Наценка (фикс AED)', previousValue, nextValue);
    const typeEvent = createPricingEvent('markupType', 'Тип наценки', previousType, 'fixed');
    const nextEvents = [amountEvent, typeEvent].filter(Boolean) as OrderPricingEvent[];
    if (nextEvents.length) {
      void logger.debug('PRICING_PERF', 'pricing_event_appended', { orderId: order.id, count: nextEvents.length, fields: nextEvents.map((event) => event.field) });
    }
    updateOrder({ ...order, markupFixedAed: nextValue, markupType: 'fixed', pricingEvents: nextEvents.length ? [...nextEvents, ...(order.pricingEvents || [])] : order.pricingEvents });
    const commitMs = Math.round((performance.now() - commitStart) * 100) / 100;
    void logger.debug('PRICING_PERF', 'pricing_commit_end', { orderId: order.id, field: 'markupFixedAed', commitMs });
    scheduleDebouncedSaveLog();
  }, [markupFixedInput, order, scheduleDebouncedSaveLog, updateOrder]);

  const flushMarkupCommit = useCallback(() => {
    if (markupCommitTimerRef.current) window.clearTimeout(markupCommitTimerRef.current);
    commitMarkupFixed();
    markupCommitTimerRef.current = null;
  }, [commitMarkupFixed]);

  const handleMarkupFixedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const startedAt = performance.now();
    const rawVal = e.target.value;
    const sanitized = sanitizeNumericInput(rawVal);
    setMarkupFixedInput(sanitized);
    if (markupCommitTimerRef.current) window.clearTimeout(markupCommitTimerRef.current);
    markupCommitTimerRef.current = window.setTimeout(() => {
      commitMarkupFixed(Number(sanitized || 0));
      markupCommitTimerRef.current = null;
    }, 1000);
    syncPerf.recordTypingSample(Math.round((performance.now() - startedAt) * 100) / 100);
  };

  const togglePartFound = (partId: string) => {
    const updatedParts = order.parts.map(p => {
      if (p.id !== partId) return p;
      const nextFound = !p.isFound;
      return { ...p, isFound: nextFound, status: nextFound ? 'found' : 'searching' };
    });
    updateOrder({ ...order, parts: updatedParts });
  };

  const confirmDeletePart = () => {
    if (deletePartId) {
      const updatedParts = order.parts.filter(p => p.id !== deletePartId);
      updateOrder({ ...order, parts: updatedParts });
      setDeletePartId(null);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setNewPartPhotos(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file as Blob);
      });
    }
  };

  const removeNewPhoto = (index: number) => {
    setNewPartPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const addNewPart = () => {
    if (!newPartName.trim()) return;
    const newPart: Part = {
      id: Math.random().toString(36).substr(2, 9),
      name: newPartName.trim(),
      photos: newPartPhotos,
      photoUrl: newPartPhotos[0], // Back-compat
      variants: [],
      isFound: false,
      status: 'searching',
      priority: 'normal'
    };
    updateOrder({ ...order, parts: [...order.parts, newPart] });
    setNewPartName('');
    setNewPartPhotos([]);
    partInputRef.current?.focus();
  };

  const handleSellClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSellError(null);

    if (order.isSold) {
      setShowSellConfirm(true);
      return;
    }

    const hasPricedItems = order.parts.some(p => p.isFound && p.variants.length > 0);
    if (!hasPricedItems) {
      setSellError("Нельзя продать: нет оцененных деталей");
      setTimeout(() => setSellError(null), 3000);
      return;
    }

    setShowSellConfirm(true);
  };

  const confirmSellOrder = async () => {
    if (order.isSold) {
      await updateOrder({ ...order, isSold: false, isArchived: false, soldProfitUsd: undefined });
      setShowSellConfirm(false);
    } else {
      const finalProfit = calculateCurrentProfit();
      const ok = await updateOrder({ 
        ...order, 
        isSold: true, 
        isArchived: true, 
        soldProfitUsd: finalProfit 
      });
      setShowSellConfirm(false);
      if (ok) navigate('/');
    }
  };

  const getPartPhotos = (part: Part) => {
      if (part.photos && part.photos.length > 0) return part.photos;
      if (part.photoUrl) return [part.photoUrl];
      return [];
  };

  const openGallery = (e: React.MouseEvent, part: Part) => {
    e.stopPropagation();
    const images = getPartPhotos(part);
    if (images.length === 0) return;
    setGallery({ images, index: 0 });
  };

  const getCarPhotos = () => {
    if (order.carPhotos && order.carPhotos.length > 0) return order.carPhotos;
    if (order.carPhotoUrl) return [order.carPhotoUrl];
    return [];
  };

  const handleNotePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => setNewNotePhotos(prev => [...prev, reader.result as string]);
        reader.readAsDataURL(file as Blob);
      });
    }
  };

  const handleNoteAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const files = Array.from(e.target.files);
    files.forEach((file) => {
      if (!file.type.startsWith('audio/')) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewNoteAudios((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const getWaveBars = (seed: string) => {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }

    return Array.from({ length: 28 }, (_, index) => {
      const noise = Math.abs(Math.sin((hash + index * 17) * 0.19));
      return 28 + Math.round(noise * 70);
    });
  };

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setRecordingTick((prev) => prev + 1), 260);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  const toggleRecording = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Запись аудио не поддерживается на этом устройстве');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        setIsRecording(false);
        recorderRef.current = null;
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          setNewNoteAudios(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
    } catch (e) {
      console.error('Audio recording failed', e);
      alert('Не удалось начать запись');
    }
  };

  const toggleAudioPlayback = (id: string) => {
    const audioEl = document.getElementById(id) as HTMLAudioElement | null;
    if (!audioEl) return;

    if (playingAudioId === id) {
      audioEl.pause();
      setPlayingAudioId(null);
      return;
    }

    if (playingAudioId) {
      const prev = document.getElementById(playingAudioId) as HTMLAudioElement | null;
      prev?.pause();
      if (playingAudioId !== id) {
        setAudioProgress(prevState => ({ ...prevState, [playingAudioId]: 0 }));
      }
    }

    audioEl.play().catch(() => setPlayingAudioId(null));
    setPlayingAudioId(id);
    audioEl.ontimeupdate = () => {
      const progress = audioEl.duration ? Math.min(100, (audioEl.currentTime / audioEl.duration) * 100) : 0;
      setAudioProgress(prev => ({ ...prev, [id]: progress }));
    };
    audioEl.onended = () => {
      setPlayingAudioId(null);
      setAudioProgress(prev => ({ ...prev, [id]: 0 }));
    };
  };


  const addNote = () => {
    if (!newNoteText.trim() && newNotePhotos.length === 0 && newNoteAudios.length === 0) return;
    const note: OrderNote = {
      id: Math.random().toString(36).slice(2, 9),
      text: newNoteText.trim(),
      photos: newNotePhotos,
      audios: newNoteAudios,
      createdAt: Date.now()
    };
    updateOrder({ ...order, notes: [note, ...(order.notes || [])] });
    setNewNoteText('');
    setNewNotePhotos([]);
    setNewNoteAudios([]);
  };

  const MARKUP_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

  return (
    <div className="flex flex-col min-h-full overflow-x-hidden bg-gray-50 pb-20">
      <div className="p-4 sticky top-0 z-20 shadow-sm backdrop-blur bg-white/95 border-b border-gray-100 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => navigate('/')} className="p-3 -ml-2 rounded-full transition-colors text-gray-600 active:bg-gray-100">
            <ArrowLeft size={24} />
          </button>
          <div className="text-center flex-1 mx-2 min-w-0">
            <h1 className="font-black text-lg leading-tight truncate uppercase">{order.brand} {order.model} {order.year}</h1>
            <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-500">
              <span className="font-bold">VIN:</span>
              <span className="font-mono uppercase">{order.vin || 'не указан'}</span>
              {!!order.vin && <button type="button" onClick={() => void copyText(order.vin, 'VIN скопирован')} className="text-blue-600"><Copy size={12} /></button>}
            </div>
            {vinIsIncomplete && <p className="text-[10px] mt-1 text-amber-600 font-bold">VIN неполный</p>}
          </div>
          <div className="relative">
            <button type="button" onClick={() => setShowActionsMenu(v => !v)} className="p-3 rounded-full text-gray-600 active:bg-gray-100">
              <MoreVertical size={20} />
            </button>
            {showActionsMenu && (
              <div className="absolute right-0 mt-1 w-56 rounded-xl border border-gray-100 bg-white shadow-lg p-1 text-xs font-semibold z-30">
                <button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50" onClick={() => updateOrder({ ...order, id: `${order.id}-copy-${Date.now()}` })}>Дублировать заказ</button>
                <button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50" onClick={() => updateOrderField('isArchived', !order.isArchived)}>{order.isArchived ? 'Восстановить' : 'Архивировать'}</button>
                <button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50" onClick={() => void copyText(JSON.stringify(order, null, 2), 'JSON заказа скопирован')}>Экспорт JSON</button>
                <button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 text-red-600" onClick={() => setShowActionsMenu(false)}>Удалить (с подтверждением)</button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-gray-50 px-3 py-2">
          <div className="inline-flex rounded-xl bg-white border border-gray-200 p-1">
            {CUSTOMER_STATUSES.map(status => (
              <button
                key={status}
                type="button"
                onClick={() => updateCustomerStatus(status)}
                className={`h-8 min-w-[72px] px-3 rounded-lg text-[11px] font-black ${((order.customerStatus || (order.isVip ? 'VIP' : order.isLead ? 'LEAD' : 'INQUIRY')) === status) ? 'bg-blue-600 text-white' : 'text-gray-500'}`}
              >
                {status}
              </button>
            ))}
          </div>
          <div className={`inline-flex items-center gap-1 text-xs font-bold ${isSlaBreached ? 'text-amber-700' : 'text-gray-500'}`}>
            <Clock3 size={14} /> В работе: {orderAgeHours}ч
          </div>
        </div>
        <div className="flex gap-2 items-center overflow-x-auto no-scrollbar">
          <select value={order.salesStatus || 'Inquiry'} onChange={(e) => updateOrderField('salesStatus', e.target.value)} className="text-[10px] font-black px-3 py-2 rounded-xl uppercase tracking-tight bg-white border border-gray-200 text-gray-700 shrink-0">
            {SALES_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={order.priority} title={PRIORITY_HINT[order.priority]} onChange={(e) => updatePriority(e.target.value as Priority)} className="text-[10px] font-black px-3 py-2 rounded-xl uppercase tracking-tight bg-white border border-gray-200 text-gray-700 shrink-0">
            <option value={Priority.HIGH}>HIGH</option>
            <option value={Priority.MEDIUM}>MEDIUM</option>
            <option value={Priority.LOW}>LOW</option>
          </select>
          <button type="button" onClick={() => void pasteVinFromClipboard()} className="text-[10px] font-black px-3 py-2 rounded-xl uppercase tracking-tight bg-white border border-gray-200 text-gray-700 shrink-0">Вставить VIN</button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 bg-gray-900 text-white text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-2 shadow-lg">
          <Check size={14} /> {toast.message}
          {toast.undo && (
            <button type="button" onClick={() => { toast.undo?.(); setToast(null); }} className="inline-flex items-center gap-1 text-blue-300">
              <Undo2 size={12} /> Undo
            </button>
          )}
        </div>
      )}

      <div className="p-4 space-y-4">
        
        {/* Client & Source Block */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1 mb-1"><User size={10} /> Клиент</label>
              <input
                type="text"
                value={String(draftFields.clientName ?? order.clientName ?? '')}
                onChange={(e) => updateOrderField('clientName', e.target.value)}
                onBlur={() => flushDeferredOrderField('clientName')}
                placeholder="Имя клиента..."
                className="w-full text-sm font-bold bg-gray-50 rounded-xl px-3 py-2 outline-none border border-gray-100"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1 mb-1"><Smartphone size={10} /> Телефон</label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={String(draftFields.customerContact ?? order.customerContact ?? '')}
                  onChange={(e) => updateOrderField('customerContact', e.target.value)}
                  onBlur={() => flushDeferredOrderField('customerContact')}
                  placeholder="+971..."
                  className="flex-1 text-sm font-bold bg-gray-50 rounded-xl px-3 py-2 outline-none border border-gray-100"
                />
                <button type="button" onClick={() => void copyText(order.customerContact || '', 'Телефон скопирован')} disabled={!order.customerContact} className="h-10 px-3 rounded-xl border border-gray-200 text-gray-600 disabled:opacity-40"><Copy size={14} /></button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Источник</label>
              <select
                value={String(draftFields.source ?? order.source)}
                onChange={(e) => updateOrderField('source', e.target.value)}
                className="w-full h-10 text-sm font-bold bg-gray-50 rounded-xl px-2 outline-none border border-gray-100"
              >
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Шаблон</label>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                className="w-full h-10 text-sm font-bold bg-gray-50 rounded-xl px-2 outline-none border border-gray-100"
              >
                {MESSAGE_TEMPLATES.map(template => <option key={template} value={template}>{template}</option>)}
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={openWhatsappClient}
            disabled={!(order.customerContact || '').replace(/[^\d]/g, '').length || (order.customerContact || '').replace(/[^\d]/g, '').length < 8}
            className="h-11 w-full rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase disabled:opacity-50"
          >
            WhatsApp: открыть чат
          </button>
        </div>

        <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Модель</label>
            <input
              type="text"
              value={String(draftFields.model ?? order.model ?? '')}
              onChange={(e) => updateOrderField('model', e.target.value)}
              onBlur={() => flushDeferredOrderField('model')}
              className="w-full text-sm font-bold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Год</label>
            <input
              type="text"
              value={String(draftFields.year ?? order.year ?? '')}
              onChange={(e) => updateOrderField('year', e.target.value)}
              onBlur={() => flushDeferredOrderField('year')}
              className="w-full text-sm font-bold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Тип кузова</label>
            <input
              type="text"
              value={String(draftFields.bodyType ?? order.bodyType ?? '')}
              onChange={(e) => updateOrderField('bodyType', e.target.value)}
              onBlur={() => flushDeferredOrderField('bodyType')}
              placeholder="E39 / F10 / S-Class"
              className="w-full text-sm font-bold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
            />
          </div>
        </div>

        {getCarPhotos().length > 0 && (
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Фото авто</div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {getCarPhotos().map((ph, i) => (
                <button key={i} type="button" className="w-20 h-20 rounded-xl overflow-hidden border border-gray-100 shrink-0" onClick={(e) => { e.stopPropagation(); setGallery({ images: getCarPhotos(), index: i }); }}>
                  <img src={ph} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3">
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Наценка</span>
              <div className="inline-flex rounded-xl border border-gray-200 p-1">
                <button type="button" onClick={() => updateOrderField('markupType', 'percent')} className={`px-3 py-1 text-xs font-bold rounded-lg ${(order.markupType || 'percent') === 'percent' ? 'bg-blue-600 text-white' : 'text-gray-500'}`}>%</button>
                <button type="button" onClick={() => updateOrderField('markupType', 'fixed')} className={`px-3 py-1 text-xs font-bold rounded-lg ${(order.markupType || 'percent') === 'fixed' ? 'bg-blue-600 text-white' : 'text-gray-500'}`}>фикс</button>
              </div>
            </div>
            {(order.markupType || 'percent') === 'percent' ? (
              <select
                value={Number(draftFields.markupPercent ?? order.markupPercent)}
                onChange={(e) => updateOrderField('markupPercent', Number(e.target.value))}
                onBlur={() => flushDeferredOrderField('markupPercent')}
                className="w-full h-10 font-black bg-gray-50 rounded-xl px-3 outline-none border border-gray-100"
              >
                {MARKUP_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}%</option>)}
              </select>
            ) : (
              <input type="text" inputMode="numeric" value={markupFixedInput} onFocus={() => { if (markupFixedInput === '0') setMarkupFixedInput(''); }} onBlur={() => { if (!markupFixedInput) setMarkupFixedInput('0'); flushMarkupCommit(); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }} onChange={handleMarkupFixedChange} className="w-full h-10 font-black bg-gray-50 rounded-xl px-3 outline-none border border-gray-100" placeholder="AED" />
            )}
            <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-gray-500">
              <input type="checkbox" checked={!!order.useMarkupAsDefaultForNewParts} onChange={(e) => updateOrderField('useMarkupAsDefaultForNewParts', e.target.checked)} />
              По умолчанию для новых деталей
            </label>
          </div>

          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Валюта клиента</span>
              <select value={order.clientCurrency || 'USD'} onChange={(e) => updateOrderField('clientCurrency', e.target.value)} className="w-full h-10 mt-1 font-bold bg-gray-50 rounded-xl px-3 border border-gray-100">
                <option value="AED">AED</option><option value="USD">USD</option><option value="RUB">RUB</option><option value="TJS">TJS</option>
              </select>
            </div>
            <div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Курс $</span>
              <input type="text" inputMode="decimal" value={rateInput} onChange={handleRateChange} onBlur={() => setRateInput(order.exchangeRate.toString())} className="w-full h-10 mt-1 font-black bg-gray-50 rounded-xl px-3 border border-gray-100" />
            </div>
            <div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Тип доставки</span>
              <select value={logistics.deliveryType} onChange={(e) => updateLogisticsField('deliveryType', e.target.value)} className="w-full h-10 mt-1 font-bold bg-gray-50 rounded-xl px-3 border border-gray-100">
                <option value="uae">Внутри UAE</option>
                <option value="export">Экспорт</option>
              </select>
            </div>
            {(['deliveryAed', 'packingAed', 'serviceFeeAed'] as const).map((field) => (
              <div key={field}>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{field === 'deliveryAed' ? 'Доставка' : field === 'packingAed' ? 'Упаковка' : 'Комиссия'} AED</span>
                <input type="text" inputMode="numeric" value={logisticsInputs[field]} onFocus={() => { if (logisticsInputs[field] === '0') setLogisticsInputs((prev) => ({ ...prev, [field]: '' })); }} onBlur={() => { if (!logisticsInputs[field]) setLogisticsInputs((prev) => ({ ...prev, [field]: '0' })); flushLogisticsFieldCommit(field); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }} onChange={(e) => updateLogisticsField(field, e.target.value)} className="w-full h-10 mt-1 font-black bg-gray-50 rounded-xl px-3 border border-gray-100" />
              </div>
            ))}
          </div>

          <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-gray-50 px-3 py-2"><p className="text-gray-400">Закупка</p><p className="font-black text-gray-800">{formatMoney(selectedOfferTotal)}</p></div>
              <div className="rounded-xl bg-gray-50 px-3 py-2"><p className="text-gray-400">Логистика</p><p className="font-black text-gray-800">{formatMoney(logisticsTotal)}</p></div>
              <div className="rounded-xl bg-blue-50 px-3 py-2"><p className="text-blue-500">Наценка</p><p className="font-black text-blue-700">{formatMoney(markupAed)}</p></div>
              <div className="rounded-xl bg-emerald-50 px-3 py-2"><p className="text-emerald-500">Итого клиенту</p><p className="font-black text-emerald-700">{formatMoney(sellTotalAed, clientCurrency)}</p></div>
            </div>
            <div className="rounded-xl bg-emerald-100 px-3 py-2 text-sm font-black text-emerald-800">Чистая прибыль: {canComputeProfit && netProfitAed !== null ? `${formatMoney(netProfitAed)} / ${formatMoney(netProfitAed, clientCurrency)}` : '—'}</div>
            {!canComputeProfit && <div className="text-xs font-semibold text-gray-500">Добавьте варианты цен.</div>}
            {isLoss && <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">Вы уходите в минус ⚠️</div>}
            {lowMargin && <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">Маржа низкая — проверьте</div>}
          </div>

          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => setIsEstimateOpen(true)}
              className="h-12 rounded-2xl bg-gray-900 text-white text-xs font-black uppercase tracking-wide"
            >
              {order.parts.some((p) => p.variants.length > 0) ? 'Обновить и отправить смету' : 'Сформировать смету'}
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={openWhatsappClient} className="h-11 rounded-2xl bg-emerald-50 text-emerald-700 text-[11px] font-black uppercase">WhatsApp</button>
              <button type="button" onClick={() => partInputRef.current?.focus()} className="h-11 rounded-2xl bg-blue-50 text-blue-700 text-[11px] font-black uppercase">Деталь +</button>
              <button type="button" onClick={() => navigate('/database')} className="h-11 rounded-2xl bg-slate-100 text-slate-700 text-[11px] font-black uppercase">Магазин +</button>
            </div>
          </div>
        </div>


        {sellError && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-2">
            <AlertTriangle size={16} />
            {sellError}
          </div>
        )}


        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="font-black text-gray-400 text-[10px] uppercase tracking-[0.2em] mb-3">Добавить деталь</h2>
          <form 
            onSubmit={(e) => { e.preventDefault(); addNewPart(); }}
            className="flex flex-col gap-3"
          >
            <div className="flex gap-2">
              <div className="flex-1 flex gap-2 items-center bg-gray-50 border border-gray-100 p-2 rounded-xl">
                <input 
                  type="text" 
                  ref={partInputRef} value={newPartName} 
                  onChange={(e) => setNewPartName(e.target.value)}
                  placeholder="Что ищем?.."
                  className="flex-1 bg-transparent outline-none p-1 text-base font-bold"
                />
              </div>
              <button type="submit" className="p-3 bg-blue-600 text-white rounded-xl active:bg-blue-700 shadow-md">
                <Plus size={24} />
              </button>
            </div>
            
            <div className="flex gap-2 items-center overflow-x-auto no-scrollbar">
                <button 
                  type="button" 
                  onClick={() => partFileRef.current?.click()}
                  className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center border-2 border-dashed border-gray-200 transition-colors ${newPartPhotos.length > 0 ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-300'}`}
                >
                  <ImageIcon size={20} />
                </button>
                {newPartPhotos.map((p, i) => (
                    <div key={i} className="relative w-12 h-12 shrink-0 rounded-xl overflow-hidden border border-gray-100">
                        <img src={p} className="w-full h-full object-cover" />
                        <button 
                            type="button"
                            onClick={() => removeNewPhoto(i)}
                            className="absolute inset-0 bg-black/40 flex items-center justify-center text-white opacity-0 hover:opacity-100 transition-opacity"
                        >
                            <X size={12} />
                        </button>
                    </div>
                ))}
                <input type="file" ref={partFileRef} onChange={handlePhotoChange} className="hidden" accept="image/*" multiple />
            </div>
          </form>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <h2 className="font-black text-gray-400 text-[10px] uppercase tracking-[0.2em]">Заметки</h2>
          <textarea value={newNoteText} onChange={(e) => setNewNoteText(e.target.value)} placeholder="Текст заметки..." className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold outline-none" rows={3} />
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            <button type="button" onClick={() => noteFileRef.current?.click()} className="w-12 h-12 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 flex items-center justify-center"><ImageIcon size={18} /></button>
            <button type="button" onClick={() => noteAudioFileRef.current?.click()} className="w-12 h-12 rounded-xl border-2 border-dashed border-gray-200 text-gray-500 flex items-center justify-center"><FileAudio size={18} /></button>
            <button type="button" onClick={toggleRecording} className={`w-12 h-12 rounded-xl border-2 ${isRecording ? 'border-red-300 bg-red-50 text-red-600' : 'border-gray-200 text-gray-500'} flex items-center justify-center`}>{isRecording ? <Square size={16} /> : <Mic size={16} />}</button>
            {isRecording && <div className="h-12 px-2 rounded-xl border border-rose-200 bg-rose-50 flex items-end gap-1">{Array.from({ length: 16 }).map((_, idx) => <span key={`record-wave-${idx}`} className="w-1 rounded-full bg-rose-400" style={{ height: `${30 + Math.abs(Math.sin((recordingTick + idx) * 0.9)) * 70}%` }} />)}</div>}
            {newNotePhotos.map((p, i) => <img key={i} src={p} className="w-12 h-12 rounded-xl object-cover border border-gray-100" />)}
            {newNoteAudios.map((_, i) => <div key={`na-${i}`} className="px-3 h-12 rounded-xl bg-blue-50 border border-blue-100 text-[10px] font-bold text-blue-600 flex items-center">Audio {i + 1}</div>)}
            <input type="file" ref={noteFileRef} onChange={handleNotePhotoChange} className="hidden" accept="image/*" multiple />
            <input type="file" ref={noteAudioFileRef} onChange={handleNoteAudioFileChange} className="hidden" accept="audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.webm" multiple />
          </div>
          <button type="button" onClick={addNote} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-wide">Добавить заметку</button>
          {(order.notes || []).length > 0 && (
            <div className="space-y-2">
              {(order.notes || []).map(n => (
                <div key={n.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                  {n.text && <p className="text-sm font-semibold text-gray-700">{n.text}</p>}
                  {n.photos && n.photos.length > 0 && <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar">{n.photos.map((ph, idx) => <button key={idx} type="button" onClick={() => setGallery({ images: n.photos || [], index: idx })} className="w-12 h-12 rounded-lg overflow-hidden"><img src={ph} className="w-full h-full object-cover" /></button>)}</div>}
                  {n.audios && n.audios.length > 0 && <div className="space-y-2 mt-2">{n.audios.map((audioSrc, idx) => {
                    const audioId = `note-${n.id}-${idx}`;
                    const isPlaying = playingAudioId === audioId;
                    const progress = audioProgress[audioId] || 0;
                    const bars = getWaveBars(audioSrc.slice(0, 120));

                    return (
                      <div key={audioId} className="flex items-center gap-2 bg-white border border-gray-200 rounded-2xl px-3 py-2">
                        <button type="button" onClick={() => toggleAudioPlayback(audioId)} className="w-7 h-7 rounded-full bg-green-600 text-white flex items-center justify-center shrink-0">{isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}</button>
                        <div className="flex-1 h-8 flex items-center gap-0.5">
                          {bars.map((height, barIndex) => {
                            const threshold = ((barIndex + 1) / bars.length) * 100;
                            const isPassed = progress >= threshold;

                            return (
                              <span
                                key={`${audioId}-bar-${barIndex}`}
                                className={`block flex-1 rounded-full transition-colors ${isPassed ? 'bg-green-500' : 'bg-gray-300'} ${isPlaying ? 'animate-pulse' : ''}`}
                                style={{ height: `${height}%`, animationDelay: `${barIndex * 0.03}s` }}
                              />
                            );
                          })}
                        </div>
                        <audio id={audioId} src={audioSrc} preload="metadata" playsInline />
                      </div>
                    );
                  })}</div>}
                </div>
              ))}
            </div>
          )}
        </div>


        <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 space-y-2">
          <h2 className="font-black text-gray-400 text-[10px] uppercase tracking-[0.2em]">Recommend shop · nearest first</h2>
          <div className="flex items-center gap-2">
            <select
              onChange={(e) => { addManualRecommendation(e.target.value); e.currentTarget.value = ''; }}
              className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-semibold"
              defaultValue=""
            >
              <option value="" disabled>Добавить магазин вручную…</option>
              {strictBrandShops
                .filter((shop) => !(order.recommendedShopIds || []).includes(shop.id))
                .map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={contactAllRecommendedShops} className="rounded-lg border border-green-200 bg-green-50 px-2 py-1 text-[10px] font-bold text-green-700">
            Contact all Recommended Shops
          </button>
          {(order.dismissedShopIds || []).length > 0 && (
            <button type="button" onClick={restoreDismissedRecommendations} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
              Вернуть скрытые рекомендации ({(order.dismissedShopIds || []).length})
            </button>
          )}
          {recommendedShops.length === 0 ? (
            <p className="text-xs text-gray-400">Пока нет магазинов с координатами. Добавьте локации в справочник поставщиков.</p>
          ) : (
            <div className="space-y-3">
              {([
                { key: 'high', title: 'Высокая рекомендация', tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
                { key: 'medium', title: 'Средняя рекомендация', tone: 'text-amber-700 bg-amber-50 border-amber-100' },
                { key: 'low', title: 'Низкая рекомендация', tone: 'text-blue-700 bg-blue-50 border-blue-100' },
                { key: 'none', title: 'Резервные магазины', tone: 'text-slate-700 bg-slate-50 border-slate-100' }
              ] as const).map((section) => {
                const items = groupedRecommendations[section.key];
                if (items.length === 0) return null;

                return (
                  <div key={section.key} className="space-y-2">
                    <p className={`inline-flex rounded-md border px-2 py-1 text-[10px] font-black uppercase ${section.tone}`}>{section.title}</p>
                    {items.slice(0, 6).map((shop) => (
                      <div key={shop.id} id={`shop-${shop.id}`} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-800 truncate">{shop.name}</p>
                          <p className="text-[11px] text-gray-500 truncate">{Number.isFinite(shop.distance) ? `${Math.round(shop.distance)}m` : 'distance unavailable'}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {Array.from(new Set([...(shop.specializationModels || []), ...((shopTagMap[shop.id]?.models) || [])])).slice(0, 6).map((modelTag) => (
                              <span key={`${shop.id}-${modelTag}`} className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-700">{modelTag}</span>
                            ))}
                            {Array.from(new Set([...(shop.specializationYears || []).map(String), ...((shopTagMap[shop.id]?.years) || [])])).slice(0, 6).map((yearTag) => (
                              <span key={`${shop.id}-year-${yearTag}`} className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-700">{yearTag}</span>
                            ))}
                            {(shop.specializationBodyTypes || []).slice(0, 4).map((bodyTypeTag) => (
                              <span key={`${shop.id}-body-${bodyTypeTag}`} className="rounded-md bg-fuchsia-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-fuchsia-700">{bodyTypeTag}</span>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {(order.recommendedShopIds || []).includes(shop.id) && (
                            <button type="button" onClick={() => removeManualRecommendation(shop.id)} className="rounded-lg bg-rose-50 px-2 py-1.5 text-[10px] font-bold text-rose-600">
                              Убрать ручную
                            </button>
                          )}
                          <button type="button" onClick={() => window.open(`https://wa.me/${(shop.phone || '').replace(/\D/g, '')}`, '_blank')} className="rounded-lg bg-emerald-50 px-2 py-1.5 text-[10px] font-bold text-emerald-700">
                            WhatsApp
                          </button>
                          <button type="button" onClick={() => dismissShopRecommendation(shop.id)} className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] font-bold text-amber-700">
                            Hide
                          </button>
                          <button type="button" onClick={() => navigateToShop(shop)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white">
                            Navigate
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="font-black text-gray-400 px-1 text-[10px] uppercase tracking-[0.2em] mb-1">Список запчастей</h2>
          {order.parts.length === 0 && (
            <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-4 text-center">
              <p className="text-sm font-bold text-gray-500">Добавьте детали, чтобы начать поиск</p>
              <button type="button" onClick={() => partInputRef.current?.focus()} className="mt-2 px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold">Добавить</button>
            </div>
          )}
          {order.parts.map(part => {
             const displayPhotos = getPartPhotos(part);
             return (
              <div key={part.id} onClick={() => navigate(`/order/${order.id}/part/${part.id}`)} className="bg-white p-3.5 rounded-2xl shadow-sm flex items-center gap-3 active:bg-gray-50 transition-colors border border-gray-50">
                <button 
                  type="button"
                  onClick={(e) => { e.stopPropagation(); togglePartFound(part.id); }} 
                  className={`flex-shrink-0 p-1 rounded-full transition-colors ${part.isFound ? 'text-green-500 bg-green-50' : 'text-gray-200'}`}
                >
                  {part.isFound ? <CheckCircle2 size={28} /> : <Circle size={28} />}
                </button>
                <div 
                  className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center overflow-hidden shrink-0 border border-gray-100 relative"
                >
                  {displayPhotos.length > 0 ? (
                    <>
                      <img 
                        src={displayPhotos[0]} 
                        className="w-full h-full object-cover cursor-pointer" 
                        onClick={(e) => openGallery(e, part)}
                      />
                      {displayPhotos.length > 1 && (
                          <div className="absolute bottom-0 right-0 bg-black/60 text-white text-[8px] font-bold px-1 rounded-tl-md">
                              +{displayPhotos.length - 1}
                          </div>
                      )}
                    </>
                  ) : (
                    <Package size={20} className="text-gray-200" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-black text-sm text-gray-800 truncate leading-none mb-1 uppercase tracking-tight">{part.name}</h4>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">{part.variants.length} вариантов · {part.priority === 'urgent' ? 'urgent' : 'normal'}</p>
                  {part.variants[0] && (
                    <p className="text-[10px] text-emerald-700 font-bold">Лучший: {part.variants[0].priceAed} AED · {part.variants[0].shopName || 'магазин не указан'}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void shareMessage(buildPartShareText(order, part)); }}
                    className="p-4 -m-2 text-gray-200 hover:text-emerald-600 transition-all"
                  >
                    <Share2 size={18} />
                  </button>
                  <button 
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDeletePartId(part.id); }}
                    className="p-4 -m-2 text-gray-100 hover:text-red-500 transition-all relative z-20"
                  >
                    <Trash2 size={20} />
                  </button>
                  <ChevronRight size={18} className="text-gray-200" />
                </div>
              </div>
             );
          })}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-200 bg-white/95 backdrop-blur p-3 space-y-2">
        <div className="grid grid-cols-5 gap-1 text-[10px] font-bold">
          <div><p className="text-gray-400">Закупка</p><p>{formatMoney(selectedOfferTotal)}</p></div>
          <div><p className="text-gray-400">Наценка</p><p>{formatMoney(markupAed)}</p></div>
          <div><p className="text-gray-400">Логистика</p><p>{formatMoney(logisticsTotal)}</p></div>
          <div><p className="text-gray-400">Итого</p><p>{formatMoney(sellTotalAed, clientCurrency)}</p></div>
          <div><p className="text-gray-400">Профит</p><p>{netProfitAed === null ? '—' : formatMoney(netProfitAed)}</p></div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button type="button" onClick={openWhatsappClient} className="h-10 rounded-xl bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase">WhatsApp</button>
          <button type="button" onClick={() => partInputRef.current?.focus()} className="h-10 rounded-xl bg-blue-50 text-blue-700 text-[10px] font-black uppercase">Деталь +</button>
          <button type="button" onClick={() => setIsEstimateOpen(true)} className="h-10 rounded-xl bg-gray-900 text-white text-[10px] font-black uppercase">Смета</button>
          <button type="button" onClick={handleSellClick} className={`h-10 rounded-xl text-[10px] font-black uppercase ${order.isSold ? 'bg-white border border-green-600 text-green-700' : 'bg-green-600 text-white'}`}>{order.isSold ? 'Продано' : 'Продать'}</button>
        </div>
      </div>

      <ConfirmModal 
        isOpen={!!deletePartId} 
        message="Вы уверены, что хотите удалить эту деталь?" 
        onConfirm={confirmDeletePart} 
        onCancel={() => setDeletePartId(null)} 
      />

      <ConfirmModal
        isOpen={showSellConfirm}
        message={order.isSold ? "Вернуть заказ в активные?" : "Отметить заказ как проданный?"}
        confirmLabel={order.isSold ? "Да, вернуть" : "Да, продано"}
        confirmClass={order.isSold ? "bg-blue-600 active:bg-blue-700" : "bg-green-600 active:bg-green-700"}
        onConfirm={confirmSellOrder}
        onCancel={() => setShowSellConfirm(false)}
      />

      {isEstimateOpen && <EstimateModal order={order} onClose={() => setIsEstimateOpen(false)} onShare={shareQuote} />}
      {gallery && (
        <ImagePreview 
          images={gallery.images} 
          initialIndex={gallery.index} 
          onClose={() => setGallery(null)} 
        />
      )}
    </div>
  );
};

export default OrderDetailsScreen;
