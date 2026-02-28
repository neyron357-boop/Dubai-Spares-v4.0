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
  Image as ImageIcon,
  DollarSign,
  AlertTriangle,
  X,
  User,
  Smartphone,
  Star,
  Copy,
  MoreVertical,
  RefreshCw,
  Clock3,
  Undo2,
  Check,
  Mic,
  Square,
  Play,
  Pause,
  FileAudio,
  Rocket
} from 'lucide-react';
import EstimateModal from '../components/EstimateModal';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';
import { QuoteCurrency, QuoteRates, buildPartShareText, shareMessage, shareQuoteLink } from '../shareUtils';
import { supabase } from '../supabase';
import { fetchRadarShops } from '../radarShops';
import { logger } from '../logging';
import { syncPerf } from '../syncPerf';
import { optimizeImageForUpload } from '../storage/photos';
import { FEATURE_RADAR_V2 } from '../featureFlags';
import { ensureRadarSessionForOrder } from '../radarSessionService';

const SALES_STATUSES = ['Inquiry', 'Price Sent', 'Pending Approval', 'Paid', 'Completed'] as const;

const CUSTOMER_STATUSES = ['VIP', 'LEAD', 'INQUIRY'] as const;
const PRIORITY_HINT: Record<Priority, string> = {
  [Priority.LOW]: 'можно отвечать позже',
  [Priority.MEDIUM]: 'обычная срочность',
  [Priority.HIGH]: 'нужно ускорить'
};
const SLA_HOURS = 24;
const MESSAGE_TEMPLATES_BY_LANGUAGE: Record<'ru' | 'en' | 'ar', readonly string[]> = {
  ru: [
    'Принял заказ ✅ уточняю цены',
    'Нашёл варианты, отправляю смету',
    'Нужны уточнения (VIN/фото/комплектация)',
    'Подтвердите оплату / доставку',
    'Деталь закончилась — есть замена'
  ],
  en: [
    'Order received ✅ checking prices now',
    'Found options, sending quotation',
    'Need more details (VIN/photos/trim)',
    'Please confirm payment / delivery',
    'Part is unavailable — we have an alternative'
  ],
  ar: [
    'تم استلام الطلب ✅ وجاري التحقق من الأسعار',
    'تم العثور على الخيارات وسيتم إرسال العرض',
    'نحتاج تفاصيل إضافية (VIN/صور/الفئة)',
    'يرجى تأكيد الدفع / التوصيل',
    'القطعة غير متوفرة — لدينا بديل'
  ]
} as const;


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



const LogisticsAmountInput = React.memo(({
  field,
  label,
  value,
  onChange
}: {
  field: 'deliveryAed' | 'packingAed' | 'serviceFeeAed';
  label: string;
  value: string;
  onChange: (field: 'deliveryAed' | 'packingAed' | 'serviceFeeAed', nextValue: string) => void;
}) => {
  return (
    <div>
      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{label} AED</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onFocus={() => {
          if (value === '0') onChange(field, '');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
        onChange={(e) => {
          onChange(field, sanitizeNumericInput(e.currentTarget.value));
        }}
        className="w-full h-10 mt-1 font-black bg-gray-50 rounded-xl px-3 border border-gray-100"
      />
    </div>
  );
});

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

const MAX_RETRY_ATTEMPTS = 3;

const OrderDetailsScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { orders, isLoading, updateOrder, removePart, suppliers, fetchOrderDetails } = useStore();
  const order = orders.find(o => o.id === id);
  
  // State for handling missing order
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const [isEstimateOpen, setIsEstimateOpen] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number; partId?: string } | null>(null);
  const [deletePartId, setDeletePartId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNotePhotos, setNewNotePhotos] = useState<string[]>([]);
  const [newNoteAudios, setNewNoteAudios] = useState<string[]>([]);
  const noteFileRef = useRef<HTMLInputElement>(null);
  const carFileRef = useRef<HTMLInputElement>(null);
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
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [shopsLoaded, setShopsLoaded] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [shopTagMap, setShopTagMap] = useState<Record<string, { models: string[]; years: string[] }>>({});

  const [newPartName, setNewPartName] = useState('');
  const [newPartComment, setNewPartComment] = useState('');
  // Multiple photos for new part
  const [newPartPhotos, setNewPartPhotos] = useState<string[]>([]);
  const partFileRef = useRef<HTMLInputElement>(null);
  const partInputRef = useRef<HTMLInputElement>(null);

  // Exchange Rate Input State (Controlled)
  const [rateInput, setRateInput] = useState(order ? order.exchangeRate.toString() : '3.67');
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [isLaunchingRadar, setIsLaunchingRadar] = useState(false);
  const [isEditMode] = useState(true);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [markupFixedInput, setMarkupFixedInput] = useState(order?.markupFixedAed?.toString() || '0');
  const [logisticsDraft, setLogisticsDraft] = useState<Record<'deliveryAed' | 'packingAed' | 'serviceFeeAed', string>>({
    deliveryAed: String(Number(order?.logistics?.deliveryAed || 0)),
    packingAed: String(Number(order?.logistics?.packingAed || 0)),
    serviceFeeAed: String(Number(order?.logistics?.serviceFeeAed || 0))
  });
  const pricingSaveDebounceRef = useRef<number | null>(null);
  const markupCommitTimerRef = useRef<number | null>(null);
  const exchangeRateCommitTimerRef = useRef<number | null>(null);
  const deferredFieldTimersRef = useRef<Partial<Record<keyof Order, number>>>({});
  const deferredFieldValuesRef = useRef<Partial<Record<keyof Order, any>>>({});
  const orderRef = useRef<Order | undefined>(order);
  const [draftFields, setDraftFields] = useState<Partial<Record<keyof Order, any>>>({});
  const lastKeystrokeAtRef = useRef<number>(0);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  // Sync local rate input if order changes
  useEffect(() => {
    if (order) setRateInput(order.exchangeRate.toString());
  }, [order?.id]);

  useEffect(() => {
    setMarkupFixedInput((order?.markupFixedAed || 0).toString());
  }, [order?.id, order?.markupFixedAed]);

  useEffect(() => {
    if (!order) return;
    setLogisticsDraft({
      deliveryAed: String(Number(order.logistics?.deliveryAed || 0)),
      packingAed: String(Number(order.logistics?.packingAed || 0)),
      serviceFeeAed: String(Number(order.logistics?.serviceFeeAed || 0))
    });
  }, [order?.id, order?.logistics?.deliveryAed, order?.logistics?.packingAed, order?.logistics?.serviceFeeAed]);


  useEffect(() => () => {
    if (pricingSaveDebounceRef.current) window.clearTimeout(pricingSaveDebounceRef.current);

    if (markupCommitTimerRef.current) {
      window.clearTimeout(markupCommitTimerRef.current);
      markupCommitTimerRef.current = null;
    }

    if (exchangeRateCommitTimerRef.current) {
      window.clearTimeout(exchangeRateCommitTimerRef.current);
      exchangeRateCommitTimerRef.current = null;
      const normalizedRate = parseFloat(String(rateInput).replace(',', '.'));
      const latestOrder = orderRef.current;
      if (latestOrder && Number.isFinite(normalizedRate) && normalizedRate > 0 && normalizedRate !== Number(latestOrder.exchangeRate || 0)) {
        void updateOrder({ ...latestOrder, exchangeRate: normalizedRate });
      }
    }

    Object.keys(deferredFieldTimersRef.current).forEach((field) => {
      const typedField = field as keyof Order;
      const timerId = deferredFieldTimersRef.current[typedField];
      if (timerId) window.clearTimeout(timerId);
      const pendingValue = deferredFieldValuesRef.current[typedField];
      const latestOrder = orderRef.current;
      if (pendingValue !== undefined && latestOrder) {
        void updateOrder({ ...latestOrder, [typedField]: pendingValue });
      }
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
    if (currentOrder && (currentOrder.isLead || (currentOrder.parts && currentOrder.parts.length > 0))) return;
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
  }, [order?.id, order?.model, order?.year]);

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

  // Auto-retry loading order if not found
  useEffect(() => {
    if (!id || order || isLoading || isRetrying || retryAttempts >= MAX_RETRY_ATTEMPTS) return;
    
    let cancelled = false;
    const retryTimer = window.setTimeout(() => {
      if (cancelled) return;
      console.log(`[OrderDetailsScreen] Order not found, retrying... (attempt ${retryAttempts + 1}/${MAX_RETRY_ATTEMPTS})`);
      setIsRetrying(true);
      setRetryAttempts(prev => prev + 1);
      
      fetchOrderDetails(id)
        .catch(err => console.error('[OrderDetailsScreen] Retry failed:', err))
        .finally(() => {
          if (!cancelled) setIsRetrying(false);
        });
    }, 1000); // Wait 1 second before retrying
    
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [id, order, isLoading, isRetrying, retryAttempts, fetchOrderDetails]);

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
    const quoteOrder = {
      ...order,
      logistics: {
        ...(order.logistics || {}),
        deliveryAed: Number(order.logistics?.deliveryAed || 0),
        packingAed: Number(order.logistics?.packingAed || 0),
        serviceFeeAed: Number(order.logistics?.serviceFeeAed || 0)
      },
      markupFixedAed: Number(markupFixedInput || order.markupFixedAed || 0)
    };
    await shareQuoteLink(quoteOrder, options);
  };

  if (!order) {
    return (
      <div className="p-4 flex flex-col items-center justify-center min-h-screen space-y-4">
        <div className="text-center space-y-3">
          <AlertTriangle size={48} className="mx-auto text-amber-500" />
          <h2 className="text-lg font-black text-gray-900">Заказ не найден</h2>
          <p className="text-sm text-gray-600">
            Заказ с ID <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{id}</span> не найден в системе.
          </p>
          {isRetrying && (
            <p className="text-xs text-blue-600 flex items-center justify-center gap-2">
              <RefreshCw size={14} className="animate-spin" />
              Попытка загрузки... ({retryAttempts}/{MAX_RETRY_ATTEMPTS})
            </p>
          )}
          {retryAttempts >= MAX_RETRY_ATTEMPTS && (
            <p className="text-xs text-amber-600">
              Не удалось загрузить заказ после {MAX_RETRY_ATTEMPTS} попыток
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-bold text-sm"
          >
            ← Назад к заказам
          </button>
          <button
            type="button"
            onClick={() => {
              setRetryAttempts(0);
              setIsRetrying(true);
              if (id) {
                fetchOrderDetails(id)
                  .catch(err => console.error('[OrderDetailsScreen] Manual retry failed:', err))
                  .finally(() => setIsRetrying(false));
              }
            }}
            disabled={isRetrying}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={isRetrying ? 'animate-spin' : ''} />
            Повторить попытку
          </button>
        </div>
      </div>
    );
  }


  const selectedOfferTotal = useMemo(() => order.parts.reduce((sum, p) => sum + (p.variants[0]?.priceAed || 0), 0), [order.parts]);
  const logistics = useMemo(() => ({
    deliveryType: order.logistics?.deliveryType || 'uae',
    deliveryAed: Number(order.logistics?.deliveryAed || 0),
    packingAed: Number(order.logistics?.packingAed || 0),
    serviceFeeAed: Number(order.logistics?.serviceFeeAed || 0)
  }), [order.logistics?.deliveryType, order.logistics?.deliveryAed, order.logistics?.packingAed, order.logistics?.serviceFeeAed]);
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
  const templateLanguage: 'ru' | 'en' | 'ar' = order.whatsappTemplateLanguage || 'ru';
  const messageTemplates = MESSAGE_TEMPLATES_BY_LANGUAGE[templateLanguage] || MESSAGE_TEMPLATES_BY_LANGUAGE.ru;


  const normalizedSelectedTemplate = messageTemplates.includes(selectedTemplate) ? selectedTemplate : (messageTemplates[0] || '');

  const applyTemplate = (template: string) => (template || normalizedSelectedTemplate || '')
    .replace('{client_name}', order.clientName || 'клиент')
    .replace('{car}', `${order.brand} ${order.model}`.trim())
    .replace('{vin}', order.vin || 'VIN не указан')
    .replace('{total}', formatMoney(sellTotalAed, clientCurrency))
    .replace('{currency}', clientCurrency)
    .replace('{eta}', '1-2 дня')
    .replace('{order_link}', window.location.href);

  const sourceLabel = String(draftFields.source ?? order.source ?? '').toLowerCase();
  const socialValue = String(draftFields.socialNickname ?? order.socialNickname ?? '').trim();

  const getClientChannelLink = () => {
    if (sourceLabel.includes('instagram')) {
      if (!socialValue) return '';
      if (socialValue.startsWith('http')) return socialValue;
      return `https://instagram.com/${socialValue.replace(/^@/, '')}`;
    }
    if (sourceLabel.includes('tiktok')) {
      if (!socialValue) return '';
      if (socialValue.startsWith('http')) return socialValue;
      return `https://www.tiktok.com/@${socialValue.replace(/^@/, '')}`;
    }
    if (sourceLabel.includes('telegram')) {
      if (!socialValue) return '';
      if (socialValue.startsWith('http')) return socialValue;
      const normalized = socialValue.replace(/^@/, '');
      return /^\+?\d{6,}$/.test(normalized)
        ? `https://t.me/${normalized.replace(/^\+/, '')}`
        : `https://t.me/${normalized}`;
    }
    return '';
  };

  const openWhatsappClient = () => {
    const phone = (order.customerContact || '').replace(/[^\d+]/g, '');
    if (!phone || phone.length < 8) return;
    const message = applyTemplate(normalizedSelectedTemplate);
    window.open(`https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const openClientChannel = () => {
    const socialLink = getClientChannelLink();
    if (socialLink) {
      window.open(socialLink, '_blank');
      return;
    }
    openWhatsappClient();
  };

  const contactActionLabel = sourceLabel.includes('instagram')
    ? 'Открыть Instagram'
    : sourceLabel.includes('tiktok')
      ? 'Открыть TikTok'
      : sourceLabel.includes('telegram')
        ? 'Открыть Telegram'
        : 'WhatsApp';

  const saveSocialNickname = () => {
    if (!isEditMode) return;
    const rawValue = window.prompt(
      sourceLabel.includes('telegram')
        ? 'Вставьте ссылку Telegram, @username или номер (+971...)'
        : 'Вставьте ссылку или username',
      String(draftFields.socialNickname ?? order.socialNickname ?? '')
    );
    if (rawValue === null) return;
    updateOrderField('socialNickname', rawValue.trim());
    flushDeferredOrderField('socialNickname');
  };

  const updateCustomerStatus = (nextStatus: 'VIP' | 'LEAD' | 'INQUIRY') => {
    if (!isEditMode) return;
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

  const carPhotoShareText = [
    [order.brand, order.model].filter(Boolean).join(' ').trim(),
    order.year ? `Year: ${order.year}` : '',
    order.bodyType ? `Body type: ${order.bodyType}` : '',
    order.vin ? `VIN: ${order.vin}` : ''
  ].filter(Boolean).join('\n');

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
    const currentOrder = orderRef.current;
    if (!currentOrder) return;
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
      ? createPricingEvent(field as OrderPricingEvent['field'], trackedLabel, currentOrder[field], value)
      : null;

    updateOrder({
      ...currentOrder,
      [field]: value,
      pricingEvents: event ? [event, ...(currentOrder.pricingEvents || [])] : currentOrder.pricingEvents
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
    if (!isEditMode) return;
    const keyStart = performance.now();
    const shouldDebounce = (typeof value === 'string' || typeof value === 'number')
      && !['markupType', 'clientCurrency', 'salesStatus', 'priority', 'deliveryType', 'customerContact', 'socialNickname'].includes(String(field));

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
      commitDeferredOrderField(field);
    }, 650);
    syncPerf.recordTypingSample(Math.round((performance.now() - keyStart) * 100) / 100);
  };


  const updatePriority = (nextPriority: Priority) => {
    if (!isEditMode) return;
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
    pricingSaveDebounceRef.current = window.setTimeout(() => {
      pricingSaveDebounceRef.current = null;
    }, 1000);
  }, []);

  const onLogisticsDraftChange = useCallback((field: 'deliveryAed' | 'packingAed' | 'serviceFeeAed', nextValue: string) => {
    setLogisticsDraft((prev) => ({ ...prev, [field]: nextValue }));
  }, []);

  const hasPendingPricingChanges = useMemo(() => {
    if (!order) return false;
    const hasLogisticsDiff = (['deliveryAed', 'packingAed', 'serviceFeeAed'] as const).some((field) => {
      const draftValue = Number(logisticsDraft[field] || 0);
      const savedValue = Number(order.logistics?.[field] || 0);
      return draftValue !== savedValue;
    });
    const hasMarkupDiff = (order.markupType || 'percent') === 'fixed'
      && (Number(markupFixedInput || 0) !== Number(order.markupFixedAed || 0));
    return hasLogisticsDiff || hasMarkupDiff;
  }, [logisticsDraft, markupFixedInput, order]);

  const saveLogisticsDraft = useCallback(() => {
    if (!isEditMode) return;
    if (!hasPendingPricingChanges) return

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

    const nextLogistics = {
      ...order.logistics,
      deliveryAed: Number(logisticsDraft.deliveryAed || 0),
      packingAed: Number(logisticsDraft.packingAed || 0),
      serviceFeeAed: Number(logisticsDraft.serviceFeeAed || 0)
    };

    const nextMarkupFixed = Number(markupFixedInput || 0);
    const previousMarkupFixed = Number(order.markupFixedAed || 0);
    const previousMarkupType = order.markupType || 'percent';
    const shouldPersistFixedMarkup = previousMarkupType === 'fixed';

    const nextEvents = (['deliveryAed', 'packingAed', 'serviceFeeAed'] as const)
      .map((field) => createPricingEvent(
        eventFieldMap[field],
        eventLabels[field],
        Number(order.logistics?.[field] || 0),
        Number(nextLogistics[field] || 0)
      ))
      .filter(Boolean) as OrderPricingEvent[];

    const markupAmountEvent = shouldPersistFixedMarkup
      ? createPricingEvent('markupFixedAed', 'Наценка (фикс AED)', previousMarkupFixed, nextMarkupFixed)
      : null;
    const mergedEvents = [markupAmountEvent, ...nextEvents].filter(Boolean) as OrderPricingEvent[];

    updateOrder({
      ...order,
      markupFixedAed: shouldPersistFixedMarkup ? nextMarkupFixed : order.markupFixedAed,
      markupType: previousMarkupType,
      logistics: nextLogistics,
      pricingEvents: mergedEvents.length ? [...mergedEvents, ...(order.pricingEvents || [])] : order.pricingEvents
    });
    scheduleDebouncedSaveLog();
    setToast({ message: 'Логистика сохранена' });
  }, [hasPendingPricingChanges, logisticsDraft.deliveryAed, logisticsDraft.packingAed, logisticsDraft.serviceFeeAed, order, scheduleDebouncedSaveLog, updateOrder, markupFixedInput]);

  const updateLogisticsField = (field: 'deliveryType', value: string) => {
    if (!isEditMode) return value;
    const event = createPricingEvent('logistics.deliveryType', 'Тип доставки', order.logistics?.deliveryType || 'uae', value);
    updateOrder({ ...order, logistics: { ...order.logistics, deliveryType: value }, pricingEvents: event ? [event, ...(order.pricingEvents || [])] : order.pricingEvents });
    return value;
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
    const nextValue = forcedValue ?? Number(markupFixedInput || 0);
    const previousValue = Number(order.markupFixedAed || 0);
    const previousType = order.markupType || 'percent';
    if (nextValue === previousValue && previousType === 'fixed') return;

    const amountEvent = createPricingEvent('markupFixedAed', 'Наценка (фикс AED)', previousValue, nextValue);
    const typeEvent = createPricingEvent('markupType', 'Тип наценки', previousType, 'fixed');
    const nextEvents = [amountEvent, typeEvent].filter(Boolean) as OrderPricingEvent[];
    updateOrder({ ...order, markupFixedAed: nextValue, markupType: 'fixed', pricingEvents: nextEvents.length ? [...nextEvents, ...(order.pricingEvents || [])] : order.pricingEvents });
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
    if (markupCommitTimerRef.current) {
      window.clearTimeout(markupCommitTimerRef.current);
      markupCommitTimerRef.current = null;
    }
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

  const updatePartComment = (partId: string, comment: string) => {
    const updatedParts = order.parts.map((part) => part.id === partId ? { ...part, comment } : part);
    updateOrder({ ...order, parts: updatedParts });
  };

  const confirmDeletePart = () => {
    if (deletePartId) {
      void removePart(order.id, deletePartId);
      setDeletePartId(null);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      void Promise.all(files.map(async (file) => {
        try {
          return await optimizeImageForUpload(file, `order-details:part:${file.name}`);
        } catch {
          const reader = new FileReader();
          const fallback = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(file as Blob);
          });
          return fallback;
        }
      })).then((photos) => {
        setNewPartPhotos((prev) => [...prev, ...photos.filter(Boolean)]);
      });
      e.target.value = '';
    }
  };

  const removeNewPhoto = (index: number) => {
    setNewPartPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const addNewPart = () => {
    if (!isEditMode) return;
    if (!newPartName.trim()) return;
    const newPart: Part = {
      id: Math.random().toString(36).substr(2, 9),
      name: newPartName.trim(),
      comment: newPartComment.trim(),
      photos: newPartPhotos,
      photoUrl: newPartPhotos[0], // Back-compat
      variants: [],
      isFound: false,
      status: 'searching',
      priority: 'normal'
    };
    updateOrder({ ...order, parts: [...order.parts, newPart] });
    setNewPartName('');
    setNewPartComment('');
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

  const getPartSamplePhotos = (part: Part) => {
    if (part.photos && part.photos.length > 0) return part.photos;
    if (part.photoUrl) return [part.photoUrl];
    return [];
  };

  const getPartVariantPhotos = (part: Part) => {
    const fromVariants = (part.variants || [])
      .flatMap((variant) => {
        if (variant.photos && variant.photos.length > 0) return variant.photos;
        if (variant.photoUrl) return [variant.photoUrl];
        return [];
      })
      .filter(Boolean);
    return Array.from(new Set(fromVariants));
  };

  const getPartPreviewPhotos = (part: Part) => {
    const variantPhotos = getPartVariantPhotos(part);
    if (variantPhotos.length > 0) return variantPhotos;
    return getPartSamplePhotos(part);
  };

  const openGallery = (e: React.MouseEvent, part: Part) => {
    e.stopPropagation();
    const images = getPartPreviewPhotos(part);
    if (images.length === 0) return;
    setGallery({ images, index: 0, partId: part.id });
  };

  const getCarPhotos = () => {
    if (order.carPhotos && order.carPhotos.length > 0) return order.carPhotos;
    if (order.carPhotoUrl) return [order.carPhotoUrl];
    return [];
  };


  const handleCarPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    void Promise.all(files.map(async (file) => {
      try {
        return await optimizeImageForUpload(file, `order-details:car:${file.name}`);
      } catch {
        const reader = new FileReader();
        const fallback = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file as Blob);
        });
        return fallback;
      }
    })).then((photos) => {
      const merged = Array.from(new Set([...(getCarPhotos() || []), ...photos.filter(Boolean)]));
      void updateOrder({ ...order, carPhotos: merged, carPhotoUrl: merged[0] || '' });
    });
    e.target.value = '';
  };

  const removeCarPhoto = (photoIndex: number) => {
    const next = getCarPhotos().filter((_, index) => index !== photoIndex);
    void updateOrder({ ...order, carPhotos: next, carPhotoUrl: next[0] || '' });
  };

  const handleNotePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      void Promise.all(files.map(async (file) => {
        try {
          return await optimizeImageForUpload(file, `order-details:note:${file.name}`);
        } catch {
          const reader = new FileReader();
          const fallback = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(file as Blob);
          });
          return fallback;
        }
      })).then((photos) => {
        setNewNotePhotos((prev) => [...prev, ...photos.filter(Boolean)]);
      });
      e.target.value = '';
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
    if (!isEditMode) return;
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


  const removeNoteById = (noteId: string) => {
    updateOrder({ ...order, notes: (order.notes || []).filter((note) => note.id !== noteId) });
  };

  const removeNotePhoto = (noteId: string, photoIndex: number) => {
    updateOrder({
      ...order,
      notes: (order.notes || []).map((note) => note.id === noteId ? { ...note, photos: (note.photos || []).filter((_, idx) => idx !== photoIndex) } : note)
    });
  };

  const removeNoteAudio = (noteId: string, audioIndex: number) => {
    updateOrder({
      ...order,
      notes: (order.notes || []).map((note) => note.id === noteId ? { ...note, audios: (note.audios || []).filter((_, idx) => idx !== audioIndex) } : note)
    });
  };

  const MARKUP_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

  const launchRadarSession = async () => {
    if (!FEATURE_RADAR_V2 || isLaunchingRadar) return;
    setIsLaunchingRadar(true);
    try {
      const availableShops = await fetchRadarShops(suppliers);
      const session = await ensureRadarSessionForOrder(order.id, availableShops);
      navigate(`/radar/${session.id}`);
    } catch (error) {
      logger.error('Failed to launch radar session', error);
      alert('Не удалось запустить Radar сессию.');
    } finally {
      setIsLaunchingRadar(false);
    }
  };

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
          <select value={order.salesStatus || 'Inquiry'} onChange={(e) => updateOrderField('salesStatus', e.target.value)} disabled={!isEditMode} className="text-[10px] font-black px-3 py-2 rounded-xl uppercase tracking-tight bg-white border border-gray-200 text-gray-700 shrink-0">
            {SALES_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={order.priority} title={PRIORITY_HINT[order.priority]} onChange={(e) => updatePriority(e.target.value as Priority)} disabled={!isEditMode} className="text-[10px] font-black px-3 py-2 rounded-xl uppercase tracking-tight bg-white border border-gray-200 text-gray-700 shrink-0">
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
                readOnly={!isEditMode}
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
                  readOnly={!isEditMode}
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
                disabled={!isEditMode}
                className="w-full h-10 text-sm font-bold bg-gray-50 rounded-xl px-2 outline-none border border-gray-100"
              >
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Шаблон</label>
              <select
                value={normalizedSelectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                disabled={!isEditMode}
                className="w-full h-10 text-sm font-bold bg-gray-50 rounded-xl px-2 outline-none border border-gray-100"
              >
                {messageTemplates.map(template => <option key={template} value={template}>{template}</option>)}
              </select>
            </div>
          </div>
          {(sourceLabel.includes('instagram') || sourceLabel.includes('tiktok') || sourceLabel.includes('telegram')) && (
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Ссылка клиента</label>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-2 flex flex-wrap items-center gap-2">
                {isEditMode && (
                  <button
                    type="button"
                    onClick={saveSocialNickname}
                    className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-xs font-bold text-gray-700"
                  >
                    {(draftFields.socialNickname ?? order.socialNickname ?? '') ? 'Изменить ссылку' : 'Вставить ссылку'}
                  </button>
                )}
                {isEditMode && (draftFields.socialNickname ?? order.socialNickname ?? '') && (
                  <button
                    type="button"
                    onClick={() => {
                      updateOrderField('socialNickname', '');
                      flushDeferredOrderField('socialNickname');
                    }}
                    className="h-9 px-3 rounded-lg border border-rose-200 bg-rose-50 text-xs font-bold text-rose-600"
                  >
                    Очистить
                  </button>
                )}
                <span className="text-xs font-semibold text-gray-500">
                  {(draftFields.socialNickname ?? order.socialNickname ?? '') ? 'Ссылка сохранена и скрыта' : 'Ссылка не добавлена'}
                </span>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={openClientChannel}
            disabled={!getClientChannelLink() && (!(order.customerContact || '').replace(/[^\d]/g, '').length || (order.customerContact || '').replace(/[^\d]/g, '').length < 8)}
            className="h-11 w-full rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase disabled:opacity-50"
          >
            {contactActionLabel}: открыть чат
          </button>
        </div>

        <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Модель</label>
            <input
              type="text"
              value={String(draftFields.model ?? order.model ?? '')}
              readOnly={!isEditMode}
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
              readOnly={!isEditMode}
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
              readOnly={!isEditMode}
              onChange={(e) => updateOrderField('bodyType', e.target.value)}
              onBlur={() => flushDeferredOrderField('bodyType')}
              placeholder="E39 / F10 / S-Class"
              className="w-full text-sm font-bold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
            />
          </div>
        </div>

        <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Фото авто</div>
            <>
              <input type="file" ref={carFileRef} onChange={handleCarPhotoChange} className="hidden" accept="image/*" multiple />
              <button type="button" onClick={() => carFileRef.current?.click()} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">Добавить фото</button>
            </>
          </div>
          {getCarPhotos().length > 0 ? (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {getCarPhotos().map((ph, i) => (
                <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-gray-100 shrink-0">
                  <button type="button" className="w-full h-full" onClick={(e) => { e.stopPropagation(); setGallery({ images: getCarPhotos(), index: i }); }}>
                    <img src={ph} className="w-full h-full object-cover" />
                  </button>
                  <button type="button" onClick={() => removeCarPhoto(i)} className="absolute right-1 top-1 rounded-full bg-black/60 px-1 text-[9px] text-white">✕</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Фотографии автомобиля не добавлены.</p>
          )}
        </div>

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
              <input type="text" inputMode="numeric" value={markupFixedInput} onFocus={() => { if (markupFixedInput === '0') setMarkupFixedInput(''); }} onBlur={() => { if (!markupFixedInput) setMarkupFixedInput('0'); }}  onChange={handleMarkupFixedChange} className="w-full h-10 font-black bg-gray-50 rounded-xl px-3 outline-none border border-gray-100" placeholder="AED" />
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
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Тип доставки</span>
              <select value={logistics.deliveryType} onChange={(e) => updateLogisticsField('deliveryType', e.target.value)} className="w-full h-10 mt-1 font-bold bg-gray-50 rounded-xl px-3 border border-gray-100">
                <option value="uae">Внутри UAE</option>
                <option value="export">Экспорт</option>
              </select>
            </div>
            {([
              { field: 'deliveryAed', label: 'Доставка' },
              { field: 'packingAed', label: 'Упаковка' },
              { field: 'serviceFeeAed', label: 'Комиссия' }
            ] as const).map(({ field, label }) => (
              <LogisticsAmountInput
                key={field}
                field={field}
                label={label}
                value={logisticsDraft[field]}
                onChange={onLogisticsDraftChange}
              />
            ))}
            <div className="col-span-2 pt-1">
              <button
                type="button"
                onClick={saveLogisticsDraft}
                disabled={!hasPendingPricingChanges}
                className={`h-10 w-full rounded-xl text-xs font-black uppercase tracking-wide transition ${hasPendingPricingChanges ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
              >
                Сохранить
              </button>
            </div>
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
              <button type="button" onClick={openClientChannel} className="h-11 rounded-2xl bg-emerald-50 text-emerald-700 text-[11px] font-black uppercase">{contactActionLabel}</button>
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
            <textarea
              value={newPartComment}
              onChange={(e) => setNewPartComment(e.target.value)}
              placeholder="Комментарий к детали (необязательно)"
              className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-semibold outline-none"
              rows={2}
            />

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
                  <div className="flex items-start justify-between gap-2">
                    {n.text && <p className="text-sm font-semibold text-gray-700">{n.text}</p>}
                    <button type="button" onClick={() => removeNoteById(n.id)} className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">Удалить заметку</button>
                  </div>
                  {n.photos && n.photos.length > 0 && <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar">{n.photos.map((ph, idx) => <div key={idx} className="relative w-12 h-12 rounded-lg overflow-hidden"><button type="button" onClick={() => setGallery({ images: n.photos || [], index: idx })} className="w-full h-full"><img src={ph} className="w-full h-full object-cover" /></button><button type="button" onClick={() => removeNotePhoto(n.id, idx)} className="absolute right-0.5 top-0.5 rounded-full bg-black/60 px-1 text-[9px] text-white">✕</button></div>)}</div>}
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
                        <button type="button" onClick={() => removeNoteAudio(n.id, idx)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">Удалить</button>
                      </div>
                    );
                  })}</div>}
                </div>
              ))}
            </div>
          )}
        </div>


        <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 space-y-2">
          <button
            type="button"
            onClick={() => setRecommendOpen((prev) => !prev)}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-black uppercase tracking-[0.2em] text-gray-600"
          >
            Recommended Shops
          </button>
          {recommendOpen && (
            <>
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
            </>
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
             const displayPhotos = getPartPreviewPhotos(part);
             return (
              <div key={part.id} onClick={() => navigate(`/order/${order.id}/part/${part.id}`)} className="bg-white p-3.5 rounded-2xl shadow-sm active:bg-gray-50 transition-colors border border-gray-50 space-y-2">
                <div className="flex items-center gap-3">
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
                      <div className="flex h-full w-full items-center justify-center"><Package size={20} className="text-gray-200" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-black text-sm text-gray-800 truncate leading-none mb-1 uppercase tracking-tight">{part.name}</h4>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">{part.variants.length} вариантов · {part.priority === 'urgent' ? 'urgent' : 'normal'}</p>
                    {part.comment?.trim() && (
                      <p className="mt-1 text-[11px] font-semibold text-slate-600">📝 {part.comment}</p>
                    )}
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
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700"
                    >
                      Удалить
                    </button>
                    <ChevronRight size={18} className="text-gray-200" />
                  </div>
                </div>
                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                  <textarea
                    value={part.comment || ''}
                    onChange={(e) => updatePartComment(part.id, e.target.value)}
                    placeholder="Комментарий к детали"
                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-slate-700 outline-none"
                    rows={2}
                  />
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
        <div className="grid gap-2 grid-cols-4">
          <button type="button" onClick={openClientChannel} className="h-10 rounded-xl bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase">{contactActionLabel}</button>
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
          shareTitle="Vehicle details"
          shareText={carPhotoShareText || 'Vehicle details'}
          onClose={() => setGallery(null)}
        />
      )}
    </div>
  );
};

export default OrderDetailsScreen;
