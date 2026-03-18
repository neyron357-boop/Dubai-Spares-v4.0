import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, OrderPricingEvent, Part, Priority, OrderNote, Shop, VoiceNoteAudio } from '../types';
import { buildShopMapLink, getShopOrderMatchScore, getShopRecommendationDiagnostics, getShopRecommendationLevel, isBrandMatch, isShopCompatibleWithOrder } from '../shopMatching';
import { SOURCES } from '../constants';
import { 
  ArrowLeft, 
  FileText, 
  ChevronRight, 
  ChevronDown,
  ChevronUp,
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
  Cloud,
  Undo2,
  Check,
  Mic,
  Square,
  Play,
  Pause,
  FileAudio,
  Rocket,
  Share2,
  Download
} from 'lucide-react';
import EstimateModal from '../components/EstimateModal';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';
import { QuoteCurrency, QuoteRates, shareQuoteLink } from '../shareUtils';
import { supabase } from '../supabase';
import { fetchRadarShops } from '../radarShops';
import { logger } from '../logging';
import { syncPerf } from '../syncPerf';
import { optimizeImageForUpload } from '../storage/photos';
import { FEATURE_RADAR_V2 } from '../featureFlags';
import { ensureRadarSessionForOrder } from '../radarSessionService';
import { getPartDisplayName, normalizeGroupItems, normalizePartQuantity } from '../utils/groupItems';
import { useAppSettings } from '../appSettings';
import { calculateCargo, calculateCargoEstimates, DEFAULT_CARGO_TARIFFS } from '../utils/cargo';

const SALES_STATUSES = ['Inquiry', 'Price Sent', 'Pending Approval', 'Paid', 'Completed'] as const;

const CUSTOMER_STATUSES = ['Lead', 'VIP', 'Inquiry'] as const;
const PIPELINE_STYLES: Record<(typeof CUSTOMER_STATUSES)[number], string> = {
  Lead: 'bg-[#3B6AF7] text-white shadow-[0_4px_12px_rgba(59,106,247,0.24)]',
  VIP: 'bg-[#3B6AF7] text-white shadow-[0_4px_12px_rgba(59,106,247,0.24)]',
  Inquiry: 'bg-[#3B6AF7] text-white shadow-[0_4px_12px_rgba(59,106,247,0.24)]'
};
const SALES_STATUS_STYLES: Record<(typeof SALES_STATUSES)[number], string> = {
  Inquiry: 'text-[#3B6AF7] border-blue-100 bg-blue-50',
  'Price Sent': 'text-[#3B6AF7] border-blue-100 bg-blue-50',
  'Pending Approval': 'text-amber-700 border-amber-200 bg-amber-50',
  Paid: 'text-[#3B6AF7] border-blue-100 bg-blue-50',
  Completed: 'text-emerald-700 border-emerald-200 bg-emerald-50'
};
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



const VEHICLE_DRIVETRAIN_OPTIONS: Array<{ value: NonNullable<Order['vehicleDetails']>['drivetrain']; label: string }> = [
  { value: 'fwd', label: 'Передний (FWD)' },
  { value: 'rwd', label: 'Задний (RWD)' },
  { value: 'awd', label: 'Полный (AWD)' },
  { value: '4wd', label: '4x4 (4WD)' }
];

const VEHICLE_TRANSMISSION_OPTIONS: Array<{ value: NonNullable<Order['vehicleDetails']>['transmission']; label: string }> = [
  { value: 'automatic', label: 'Автомат' },
  { value: 'manual', label: 'Механика' },
  { value: 'cvt', label: 'CVT' },
  { value: 'dct', label: 'DCT/DSG' },
  { value: 'other', label: 'Другое' }
];

const VEHICLE_MARKET_OPTIONS: Array<{ value: NonNullable<Order['vehicleDetails']>['marketRegion']; label: string }> = [
  { value: 'china', label: 'Китай' },
  { value: 'japan', label: 'Япония' },
  { value: 'usa', label: 'США' },
  { value: 'europe', label: 'Европа' },
  { value: 'gcc', label: 'GCC' },
  { value: 'other', label: 'Другое' }
];

const VEHICLE_STEERING_OPTIONS: Array<{ value: NonNullable<Order['vehicleDetails']>['steeringSide']; label: string }> = [
  { value: 'left', label: 'Левый руль' },
  { value: 'right', label: 'Правый руль' }
];

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

const parseCargoNumber = (value: unknown) => {
  const normalized = String(value ?? '').replace(',', '.').trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

type PartCargoDraft = {
  weightKg: string;
  places: string;
  cargoPlaceGroup: string;
  isOversized: boolean;
};

type CargoPartCompletion = 'ready' | 'partial' | 'missing';

const getCargoPartCompletion = (weight: number, places: number): CargoPartCompletion => {
  const hasWeight = weight > 0;
  const hasPlaces = places >= 1;
  if (hasWeight && hasPlaces) return 'ready';
  if (hasWeight || hasPlaces) return 'partial';
  return 'missing';
};



const LogisticsAmountInput = React.memo(({
  field,
  label,
  value,
  onChange,
  onBlur
}: {
  field: 'deliveryAed' | 'packingAed' | 'serviceFeeAed';
  label: string;
  value: string;
  onChange: (field: 'deliveryAed' | 'packingAed' | 'serviceFeeAed', nextValue: string) => void;
  onBlur?: () => void;
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
        onBlur={onBlur}
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
const MAX_VOICE_RECORD_SECONDS = 5 * 60;
const MAX_VOICE_FILE_SIZE_MB = 10;
const WAVEFORM_SAMPLE_MS = 50;

type GroupItemDraft = {
  id: string;
  name: string;
  quantity: string;
};

const createGroupItemDraft = (suffix = ''): GroupItemDraft => ({
  id: `group-item-${Date.now()}${suffix ? `-${suffix}` : ''}`,
  name: '',
  quantity: '1'
});

const OrderDetailsScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backTo = typeof (location.state as { backTo?: unknown } | null)?.backTo === 'string'
    ? String((location.state as { backTo?: unknown }).backTo)
    : '/orders';
  const { orders, isLoading, updateOrder, removePart, suppliers, fetchOrderDetails } = useStore();
  const { settings } = useAppSettings();
  const order = orders.find(o => o.id === id);
  
  // State for handling missing order
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const [isEstimateOpen, setIsEstimateOpen] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number; partId?: string } | null>(null);
  const [deletePartId, setDeletePartId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNotePhotos, setNewNotePhotos] = useState<string[]>([]);
  const [newNoteAudios, setNewNoteAudios] = useState<Array<string | VoiceNoteAudio>>([]);
  const [isBottomSummaryExpanded, setIsBottomSummaryExpanded] = useState(false);
  const noteFileRef = useRef<HTMLInputElement>(null);
  const carFileRef = useRef<HTMLInputElement>(null);
  const noteAudioFileRef = useRef<HTMLInputElement>(null);

  const resolvedCustomerStatus = order?.customerStatus === 'VIP'
    ? 'VIP'
    : order?.customerStatus === 'LEAD'
      ? 'Lead'
      : order?.customerStatus === 'INQUIRY'
        ? 'Inquiry'
        : (order?.isVip ? 'VIP' : order?.isLead ? 'Lead' : 'Inquiry');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const waveformTimerRef = useRef<number | null>(null);
  const [recordingWaveform, setRecordingWaveform] = useState<number[]>(Array.from({ length: 40 }, () => 10));
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingSavedLocally, setRecordingSavedLocally] = useState(false);

  // Sell Flow State
  const [showSellConfirm, setShowSellConfirm] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [voiceUploadProgress, setVoiceUploadProgress] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<Record<string, number>>({});
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopsLoaded, setShopsLoaded] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [shopTagMap, setShopTagMap] = useState<Record<string, { models: string[]; years: string[] }>>({});

  const [newPartName, setNewPartName] = useState('');
  const [newPartQuantity, setNewPartQuantity] = useState('1');
  const [newPartKind, setNewPartKind] = useState<'single' | 'group'>('single');
  const [newPartGroupItems, setNewPartGroupItems] = useState<Array<GroupItemDraft>>([createGroupItemDraft()]);
  const [newPartComment, setNewPartComment] = useState('');
  const [partCargoDrafts, setPartCargoDrafts] = useState<Record<string, PartCargoDraft>>({});
  const [partCommentDrafts, setPartCommentDrafts] = useState<Record<string, string>>({});
  const [partCommentExpanded, setPartCommentExpanded] = useState<Record<string, boolean>>({});
  // Multiple photos for new part
  const [newPartPhotos, setNewPartPhotos] = useState<string[]>([]);
  const partFileRef = useRef<HTMLInputElement>(null);
  const partInputRef = useRef<HTMLInputElement>(null);
  const partsListRef = useRef<HTMLDivElement>(null);
  const [showOnlyOpenParts, setShowOnlyOpenParts] = useState(false);

  // Exchange Rate Input State (Controlled)
  const [rateInput, setRateInput] = useState(order ? order.exchangeRate.toString() : '3.67');
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [isLaunchingRadar, setIsLaunchingRadar] = useState(false);
  const [isEditMode] = useState(true);
  const [isClientBlockExpanded, setIsClientBlockExpanded] = useState(false);
  const [isVehicleBlockExpanded, setIsVehicleBlockExpanded] = useState(false);
  const [isVehicleDetailsExpanded, setIsVehicleDetailsExpanded] = useState(false);
  const [isPricingCargoExpanded, setIsPricingCargoExpanded] = useState(true);
  const [isSupplierIntelligenceExpanded, setIsSupplierIntelligenceExpanded] = useState(true);
  const [expandedCargoPartIds, setExpandedCargoPartIds] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [markupFixedInput, setMarkupFixedInput] = useState(order?.markupFixedAed?.toString() || '0');
  const [logisticsDraft, setLogisticsDraft] = useState<Record<'deliveryAed' | 'packingAed' | 'serviceFeeAed', string>>({
    deliveryAed: String(Number(order?.logistics?.deliveryAed || 0)),
    packingAed: String(Number(order?.logistics?.packingAed || 0)),
    serviceFeeAed: String(Number(order?.logistics?.serviceFeeAed || 0))
  });
  const pricingSaveDebounceRef = useRef<number | null>(null);
  const pricingAutoSaveTimerRef = useRef<number | null>(null);
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
  }, [order?.id, order?.exchangeRate]);

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

  useEffect(() => {
    const nextDrafts = (order.parts || []).reduce((acc, part) => {
      acc[part.id] = part.comment || '';
      return acc;
    }, {} as Record<string, string>);
    setPartCommentDrafts(nextDrafts);
  }, [order.id, order.parts]);

  useEffect(() => {
    const nextCargoDrafts = (order.parts || []).reduce((acc, part) => {
      acc[part.id] = {
        weightKg: Number((part as any).weightKg || 0) > 0 ? String(Number((part as any).weightKg || 0)) : '',
        places: Number((part as any).places || 0) > 0 ? String(Number((part as any).places || 0)) : '',
        cargoPlaceGroup: String((part as any).cargoPlaceGroup || ''),
        isOversized: Boolean((part as any).isOversized)
      };
      return acc;
    }, {} as Record<string, PartCargoDraft>);
    setPartCargoDrafts(nextCargoDrafts);
  }, [order.id, order.parts]);

  useEffect(() => {
    setPartCommentExpanded({});
  }, [order.id]);

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

    if (pricingAutoSaveTimerRef.current) {
      window.clearTimeout(pricingAutoSaveTimerRef.current);
      pricingAutoSaveTimerRef.current = null;
    }

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
    const parsedRateInput = parseFloat(String(rateInput || '').replace(',', '.'));
    const quoteExchangeRate = Number.isFinite(parsedRateInput) && parsedRateInput > 0
      ? parsedRateInput
      : Number(order.exchangeRate || 3.67);
    const nextParts = applyPartCargoDrafts(order.parts || []);
    const draftLogistics = {
      ...(order.logistics || {}),
      deliveryAed: Number(logisticsDraft.deliveryAed || 0),
      packingAed: Number(logisticsDraft.packingAed || 0),
      serviceFeeAed: Number(logisticsDraft.serviceFeeAed || 0)
    };
    const draftCargo = calculateCargo({ ...order, parts: nextParts, logistics: draftLogistics }, settings);
    const draftEstimates = calculateCargoEstimates({ ...order, parts: nextParts, logistics: draftLogistics }, settings);
    // Only override saved cargo values with freshly-computed values when parts actually have cargo data.
    // This prevents zeroing out previously-saved logistics when cargo fields on individual parts haven't been filled yet.
    const hasPartCargoData = nextParts.some((p) => Number((p as any).weightKg || 0) > 0 || Number((p as any).places || 0) > 0);
    const quoteOrder = {
      ...order,
      parts: nextParts,
      logistics: {
        ...draftLogistics,
        cargoEtaDays: hasPartCargoData ? draftCargo.eta : (draftLogistics.cargoEtaDays || draftCargo.eta),
        cargoTotalWeightKg: hasPartCargoData ? draftCargo.realWeight : (draftLogistics.cargoTotalWeightKg ?? draftCargo.realWeight),
        cargoChargeableWeightKg: hasPartCargoData ? draftCargo.chargeableWeight : (draftLogistics.cargoChargeableWeightKg ?? draftCargo.chargeableWeight),
        cargoTotalPlaces: hasPartCargoData ? draftCargo.totalPlaces : (draftLogistics.cargoTotalPlaces ?? draftCargo.totalPlaces),
        cargoBaseCostUsd: hasPartCargoData ? draftCargo.baseCostUsd : (draftLogistics.cargoBaseCostUsd ?? draftCargo.baseCostUsd),
        cargoTotalCostUsd: hasPartCargoData ? draftCargo.totalCostUsd : (draftLogistics.cargoTotalCostUsd ?? draftCargo.totalCostUsd),
        cargoAirEtaDays: hasPartCargoData ? draftEstimates.air.eta : (draftLogistics.cargoAirEtaDays || draftEstimates.air.eta),
        cargoAirCostUsd: hasPartCargoData ? draftEstimates.air.totalCostUsd : (draftLogistics.cargoAirCostUsd ?? draftEstimates.air.totalCostUsd),
        cargoContainerEtaDays: hasPartCargoData ? draftEstimates.container.eta : (draftLogistics.cargoContainerEtaDays || draftEstimates.container.eta),
        cargoContainerCostUsd: hasPartCargoData ? draftEstimates.container.totalCostUsd : (draftLogistics.cargoContainerCostUsd ?? draftEstimates.container.totalCostUsd)
      },
      markupFixedAed: Number(markupFixedInput || order.markupFixedAed || 0),
      exchangeRate: quoteExchangeRate
    };

    if (hasPendingPricingChanges) {
      await updateOrder(quoteOrder);
    }
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
            onClick={handleBackNavigation}
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


  const selectedOfferTotals = useMemo(() => order.parts.reduce((sum, part) => {
    const pricedVariants = (part.variants || []).filter((variant) => Number(variant.salePriceAed ?? variant.priceAed) > 0);
    const quantity = Math.max(1, Number(part.quantity || 1));
    if (pricedVariants.length === 0) return sum;
    const bestSale = Math.min(...pricedVariants.map((variant) => Number(variant.salePriceAed ?? variant.priceAed) || 0));
    const matchingVariant = pricedVariants.find((variant) => Number(variant.salePriceAed ?? variant.priceAed) === bestSale) || pricedVariants[0];
    const bestPurchase = Number(matchingVariant.purchasePriceAed ?? matchingVariant.priceAed ?? 0);
    return {
      sale: sum.sale + (bestSale * quantity),
      purchase: sum.purchase + (bestPurchase * quantity)
    };
  }, { sale: 0, purchase: 0 }), [order.parts]);
  const selectedOfferTotal = selectedOfferTotals.sale;
  const logistics = useMemo(() => ({
    deliveryType: order.logistics?.deliveryType || 'uae',
    deliveryAed: Number(logisticsDraft.deliveryAed || 0),
    packingAed: Number(logisticsDraft.packingAed || 0),
    serviceFeeAed: Number(logisticsDraft.serviceFeeAed || 0)
  }), [order.logistics?.deliveryType, logisticsDraft.deliveryAed, logisticsDraft.packingAed, logisticsDraft.serviceFeeAed]);
  const logisticsTotal = useMemo(() => logistics.deliveryAed + logistics.packingAed + logistics.serviceFeeAed, [logistics.deliveryAed, logistics.packingAed, logistics.serviceFeeAed]);
  const cargoCalc = useMemo(() => calculateCargo(order, settings), [order, settings]);
  const cargoTotalUsd = Number(order.logistics?.cargoTotalCostUsd ?? 0);
  const cargoTotalAed = cargoTotalUsd * (order.exchangeRate || 3.67);
  const logisticsWithCargoTotal = logisticsTotal + cargoTotalAed;
  const cargoEstimates = useMemo(() => calculateCargoEstimates(order, settings), [order, settings]);
  const cargoTariffOptions = (settings.cargoTariffs?.length ? settings.cargoTariffs : DEFAULT_CARGO_TARIFFS);
  const markupType = order.markupType || 'percent';
  const markupAed = useMemo(() => (markupType === 'fixed'
    ? Number(markupFixedInput || 0)
    : selectedOfferTotal * (order.markupPercent / 100)), [markupType, markupFixedInput, selectedOfferTotal, order.markupPercent]);
  const sellTotalAed = selectedOfferTotal + logisticsWithCargoTotal + markupAed;
  const canComputeProfit = selectedOfferTotal > 0;
  const baseMarginAed = canComputeProfit ? selectedOfferTotals.sale - selectedOfferTotals.purchase : 0;
  const netProfitAed = canComputeProfit ? baseMarginAed + markupAed : null;
  const isMarkupMissing = canComputeProfit && markupAed <= 0;
  const lowMargin = canComputeProfit && selectedOfferTotal > 0 && markupAed > 0 && markupAed / selectedOfferTotal < 0.03;
  const isLoss = canComputeProfit && sellTotalAed < selectedOfferTotal + logisticsWithCargoTotal;

  const rateByCurrency: Record<string, number> = {
    AED: 1,
    USD: order.exchangeRate || 3.67,
    RUB: 0.04,
    TJS: 0.34
  };
  const clientCurrency = order.clientCurrency || 'AED';
  const clientRate = rateByCurrency[clientCurrency] || order.exchangeRate || 3.67;
  const formatMoney = (value: number, currency = 'AED') => {
    const amount = currency === 'AED' ? value : value / clientRate;
    return `${amount.toFixed(currency === 'AED' ? 0 : 2)} ${currency}`;
  };
  const formatDualMoney = (value: number) => {
    if (clientCurrency === 'AED') return formatMoney(value);
    return `${formatMoney(value)} / ${formatMoney(value, clientCurrency)}`;
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
  const orderAgeDays = Math.max(1, Math.floor(orderAgeHours / 24));
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
  const contactLinks = order.contactLinks || {};

  const getClientChannelLink = () => {
    if (sourceLabel.includes('instagram')) {
      const resolved = socialValue || contactLinks.instagramUrl || '';
      if (!resolved) return '';
      if (resolved.startsWith('http')) return resolved;
      return `https://instagram.com/${resolved.replace(/^@/, '')}`;
    }
    if (sourceLabel.includes('tiktok')) {
      const resolved = socialValue || contactLinks.tiktokUrl || '';
      if (!resolved) return '';
      if (resolved.startsWith('http')) return resolved;
      return `https://www.tiktok.com/@${resolved.replace(/^@/, '')}`;
    }
    if (sourceLabel.includes('telegram')) {
      const resolved = socialValue || contactLinks.telegramUrl || '';
      if (!resolved) return '';
      if (resolved.startsWith('http')) return resolved;
      const normalized = resolved.replace(/^@/, '');
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

  const openSupplierCard = (supplierName: string) => {
    const matched = suppliers.find((item) => item.name.trim().toLowerCase() === supplierName.trim().toLowerCase());
    if (matched?.id) {
      navigate(`/database?supplier=${encodeURIComponent(matched.id)}`);
      return;
    }
    navigate('/database');
  };

  const openSupplierMap = (supplierName: string) => {
    const matched = suppliers.find((item) => item.name.trim().toLowerCase() === supplierName.trim().toLowerCase());
    const target = matched?.coordinates
      ? `https://maps.google.com/?q=${matched.coordinates.lat},${matched.coordinates.lng}`
      : matched?.location
        ? `https://maps.google.com/?q=${encodeURIComponent(matched.location)}`
        : `https://maps.google.com/?q=${encodeURIComponent(supplierName)}`;
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const contactSupplier = (supplierName: string) => {
    const matched = suppliers.find((item) => item.name.trim().toLowerCase() === supplierName.trim().toLowerCase());
    const rawPhone = String(matched?.whatsapp || matched?.phone || '').replace(/[^\d]/g, '');
    if (rawPhone.length >= 8) {
      window.open(`https://wa.me/${rawPhone}`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (matched?.id) {
      navigate(`/database?supplier=${encodeURIComponent(matched.id)}`);
      return;
    }
    navigate('/database');
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

  const updateCustomerStatus = (nextStatus: 'Lead' | 'VIP' | 'Inquiry') => {
    if (!isEditMode) return;
    const prevStatus = resolvedCustomerStatus;
    if (prevStatus === nextStatus) return;
    updateOrder({
      ...order,
      customerStatus: nextStatus === 'Lead' ? 'LEAD' : nextStatus === 'Inquiry' ? 'INQUIRY' : 'VIP',
      isVip: nextStatus === 'VIP',
      isLead: nextStatus === 'Lead',
      statusChangedAt: Date.now(),
      statusChangedBy: 'current-user'
    });
    setToast({
      message: 'Статус обновлён ✅',
      undo: () => updateOrder({
        ...order,
        customerStatus: prevStatus === 'Lead' ? 'LEAD' : prevStatus === 'Inquiry' ? 'INQUIRY' : 'VIP',
        isVip: prevStatus === 'VIP',
        isLead: prevStatus === 'Lead'
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
      markupPercent: 'Margin %',
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



  const handleBackNavigation = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(backTo);
  }, [backTo, navigate]);

  const updateOrderZones = useCallback((zones: string[]) => {
    if (!isEditMode) return;
    const currentOrder = orderRef.current;
    if (!currentOrder) return;

    const nextZones = Array.from(new Set(zones.map((zone) => zone.trim()).filter(Boolean)));
    updateOrder({
      ...currentOrder,
      zones: nextZones.length > 0 ? nextZones : undefined,
      zone: nextZones[0] || undefined
    });
  }, [isEditMode, updateOrder]);

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


  const applyPartCargoDrafts = useCallback((parts: Part[]) => {
    return parts.map((part) => {
      const draft = partCargoDrafts[part.id];
      if (!draft) return part;
      return {
        ...part,
        weightKg: parseCargoNumber(draft.weightKg),
        places: parseCargoNumber(draft.places),
        cargoPlaceGroup: String(draft.cargoPlaceGroup || '').trim(),
        isOversized: !!draft.isOversized
      } as Part;
    });
  }, [partCargoDrafts]);

  const onPartCargoDraftChange = useCallback((partId: string, field: keyof PartCargoDraft, value: string | boolean) => {
    setPartCargoDrafts((prev) => {
      const current = prev[partId] || {
        weightKg: '',
        places: '',
        cargoPlaceGroup: '',
        isOversized: false
      };
      return {
        ...prev,
        [partId]: {
          ...current,
          [field]: value
        }
      };
    });
  }, []);

  const toggleCargoPartDraft = useCallback((partId: string) => {
    setExpandedCargoPartIds((prev) => ({ ...prev, [partId]: !prev[partId] }));
  }, []);

  const hasPartCargoDiff = useMemo(() => {
    return (order.parts || []).some((part) => {
      const draft = partCargoDrafts[part.id];
      if (!draft) return false;
      return (
        Number((part as any).weightKg || 0) !== parseCargoNumber(draft.weightKg)
        || Number((part as any).places || 0) !== parseCargoNumber(draft.places)
        || String((part as any).cargoPlaceGroup || '').trim() !== String(draft.cargoPlaceGroup || '').trim()
        || Boolean((part as any).isOversized) !== Boolean(draft.isOversized)
      );
    });
  }, [order.parts, partCargoDrafts]);

  const hasPendingPricingChanges = useMemo(() => {
    if (!order) return false;
    const hasLogisticsDiff = (['deliveryAed', 'packingAed', 'serviceFeeAed'] as const).some((field) => {
      const draftValue = Number(logisticsDraft[field] || 0);
      const savedValue = Number(order.logistics?.[field] || 0);
      return draftValue !== savedValue;
    });
    const hasMarkupDiff = (order.markupType || 'percent') === 'fixed'
      && (Number(markupFixedInput || 0) !== Number(order.markupFixedAed || 0));
    return hasLogisticsDiff || hasMarkupDiff || hasPartCargoDiff;
  }, [hasPartCargoDiff, logisticsDraft, markupFixedInput, order]);

  const saveLogisticsDraft = useCallback(() => {
    if (!isEditMode) return;
    if (!hasPendingPricingChanges) return

    const eventLabels: Record<'deliveryAed' | 'packingAed' | 'serviceFeeAed', string> = {
      deliveryAed: 'Cargo AED',
      packingAed: 'Упаковка AED',
      serviceFeeAed: 'Комиссия AED'
    };
    const eventFieldMap: Record<'deliveryAed' | 'packingAed' | 'serviceFeeAed', OrderPricingEvent['field']> = {
      deliveryAed: 'logistics.deliveryAed',
      packingAed: 'logistics.packingAed',
      serviceFeeAed: 'logistics.serviceFeeAed'
    };

    const baseLogistics = {
      ...order.logistics,
      deliveryAed: Number(logisticsDraft.deliveryAed || 0),
      packingAed: Number(logisticsDraft.packingAed || 0),
      serviceFeeAed: Number(logisticsDraft.serviceFeeAed || 0)
    };

    const nextParts = applyPartCargoDrafts(order.parts || []);
    const nextCargo = calculateCargo({ ...order, parts: nextParts, logistics: baseLogistics }, settings);
    const nextEstimates = calculateCargoEstimates({ ...order, parts: nextParts, logistics: baseLogistics }, settings);
    const nextLogistics = {
      ...baseLogistics,
      cargoEtaDays: nextCargo.eta,
      cargoTotalWeightKg: nextCargo.realWeight,
      cargoChargeableWeightKg: nextCargo.chargeableWeight,
      cargoTotalPlaces: nextCargo.totalPlaces,
      cargoBaseCostUsd: nextCargo.baseCostUsd,
      cargoTotalCostUsd: nextCargo.totalCostUsd,
      cargoAirEtaDays: nextEstimates.air.eta,
      cargoAirCostUsd: nextEstimates.air.totalCostUsd,
      cargoContainerEtaDays: nextEstimates.container.eta,
      cargoContainerCostUsd: nextEstimates.container.totalCostUsd
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
      parts: nextParts,
      markupFixedAed: shouldPersistFixedMarkup ? nextMarkupFixed : order.markupFixedAed,
      markupType: previousMarkupType,
      logistics: nextLogistics,
      pricingEvents: mergedEvents.length ? [...mergedEvents, ...(order.pricingEvents || [])] : order.pricingEvents
    });
    scheduleDebouncedSaveLog();
    setToast({ message: 'Логистика сохранена' });
  }, [applyPartCargoDrafts, hasPendingPricingChanges, logisticsDraft.deliveryAed, logisticsDraft.packingAed, logisticsDraft.serviceFeeAed, markupFixedInput, order, scheduleDebouncedSaveLog, settings, updateOrder]);

  useEffect(() => {
    if (!isEditMode || !hasPendingPricingChanges) return;
    if (pricingAutoSaveTimerRef.current) window.clearTimeout(pricingAutoSaveTimerRef.current);
    pricingAutoSaveTimerRef.current = window.setTimeout(() => {
      pricingAutoSaveTimerRef.current = null;
      saveLogisticsDraft();
    }, 900);

    return () => {
      if (pricingAutoSaveTimerRef.current) {
        window.clearTimeout(pricingAutoSaveTimerRef.current);
        pricingAutoSaveTimerRef.current = null;
      }
    };
  }, [hasPendingPricingChanges, isEditMode, saveLogisticsDraft]);

  const updateLogisticsField = (field: 'deliveryType', value: string) => {
    if (!isEditMode) return value;
    const event = createPricingEvent('logistics.deliveryType', 'Тип доставки', order.logistics?.deliveryType || 'uae', value);
    updateOrder({ ...order, logistics: { ...order.logistics, deliveryType: value }, pricingEvents: event ? [event, ...(order.pricingEvents || [])] : order.pricingEvents });
    return value;
  };


  const updateCargoField = (patch: Record<string, unknown>) => {
    if (!isEditMode) return;
    const next = calculateCargo({ ...order, logistics: { ...order.logistics, ...patch } }, settings);
    const estimates = calculateCargoEstimates({ ...order, logistics: { ...order.logistics, ...patch } }, settings);
    updateOrder({
      ...order,
      logistics: {
        ...order.logistics,
        ...patch,
        cargoEtaDays: next.eta,
        cargoTotalWeightKg: next.realWeight,
        cargoChargeableWeightKg: next.chargeableWeight,
        cargoTotalPlaces: next.totalPlaces,
        cargoBaseCostUsd: next.baseCostUsd,
        cargoTotalCostUsd: next.totalCostUsd,
        cargoAirEtaDays: estimates.air.eta,
        cargoAirCostUsd: estimates.air.totalCostUsd,
        cargoContainerEtaDays: estimates.container.eta,
        cargoContainerCostUsd: estimates.container.totalCostUsd
      }
    });
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


  const flushExchangeRateCommit = useCallback(() => {
    const normalized = String(rateInput || '').replace(',', '.');
    const num = parseFloat(normalized);
    if (!Number.isFinite(num) || num <= 0) return;
    if (exchangeRateCommitTimerRef.current) {
      window.clearTimeout(exchangeRateCommitTimerRef.current);
      exchangeRateCommitTimerRef.current = null;
    }
    if (num !== Number(order.exchangeRate || 0)) {
      updateOrderField('exchangeRate', num);
    }
  }, [order.exchangeRate, rateInput]);

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

  const updatePartCommentDraft = useCallback((partId: string, comment: string) => {
    setPartCommentDrafts((prev) => ({ ...prev, [partId]: comment }));
  }, []);

  const savePartComment = useCallback((partId: string) => {
    const draft = partCommentDrafts[partId] ?? '';
    const current = order.parts.find((part) => part.id === partId)?.comment ?? '';
    if (draft !== current) {
      updatePartComment(partId, draft);
      setToast({ message: 'Описание сохранено' });
    }
    setPartCommentExpanded((prev) => ({ ...prev, [partId]: false }));
  }, [order.parts, partCommentDrafts]);

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

  const addGroupItemRow = () => {
    setNewPartGroupItems((prev) => [...prev, createGroupItemDraft(String(prev.length))]);
  };

  const updateGroupItemRow = (id: string, key: 'name' | 'quantity', value: string) => {
    setNewPartGroupItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      if (key === 'name') return { ...item, name: value };
      return { ...item, quantity: value.replace(/[^\d]/g, '') };
    }));
  };

  const removeGroupItemRow = (id: string) => {
    setNewPartGroupItems((prev) => {
      const filtered = prev.filter((item) => item.id !== id);
      return filtered.length > 0 ? filtered : [createGroupItemDraft()];
    });
  };

  const addNewPart = () => {
    if (!isEditMode) return;
    if (!newPartName.trim()) return;
    const parsedGroupItems = newPartKind === 'group' ? normalizeGroupItems(newPartGroupItems) : [];
    const newPart: Part = {
      id: Math.random().toString(36).substr(2, 9),
      name: newPartName.trim(),
      quantity: normalizePartQuantity(newPartQuantity),
      comment: newPartComment.trim(),
      partKind: newPartKind,
      groupItems: parsedGroupItems,
      photos: newPartPhotos,
      photoUrl: newPartPhotos[0], // Back-compat
      variants: [],
      isFound: false,
      status: 'searching',
      priority: 'normal'
    };
    updateOrder({ ...order, parts: [...order.parts, newPart] });
    setNewPartName('');
    setNewPartQuantity('1');
    setNewPartKind('single');
    setNewPartGroupItems([createGroupItemDraft()]);
    setNewPartComment('');
    setNewPartPhotos([]);
    partInputRef.current?.focus();
    window.setTimeout(() => partsListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
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
      if (ok) navigate('/orders');
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
      if (file.size > MAX_VOICE_FILE_SIZE_MB * 1024 * 1024) {
        setRecordingError(`Voice note must be smaller than ${MAX_VOICE_FILE_SIZE_MB}MB`);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const audio: VoiceNoteAudio = {
          id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `voice-${Date.now()}`,
          fileUrl: String(reader.result || ''),
          duration: 0,
          createdAt: Date.now(),
          author: settings.managerName || 'Manager'
        };
        setNewNoteAudios((prev) => [...prev, audio]);
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

  const formatSeconds = (seconds: number) => {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
    const min = Math.floor(safeSeconds / 60)
      .toString()
      .padStart(2, '0');
    const sec = (safeSeconds % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  };

  const toVoiceNoteAudio = (audio: string | VoiceNoteAudio): VoiceNoteAudio => {
    if (typeof audio === 'string') {
      return {
        id: `legacy-${audio.slice(0, 12)}`,
        fileUrl: audio,
        duration: 0,
        createdAt: Date.now(),
        author: settings.managerName || 'Manager'
      };
    }
    return audio;
  };

  const stopVoiceTimers = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (waveformTimerRef.current) {
      window.clearInterval(waveformTimerRef.current);
      waveformTimerRef.current = null;
    }
  };

  const stopStreamTracks = () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  };

  const resetVoiceRecordingState = () => {
    stopVoiceTimers();
    stopStreamTracks();
    recorderRef.current = null;
    audioChunksRef.current = [];
    setIsRecording(false);
    setIsRecordingPaused(false);
    setRecordingStartedAt(null);
    setRecordingElapsedSeconds(0);
    setRecordingWaveform(Array.from({ length: 40 }, () => 10));
  };

  useEffect(() => {
    if (!isRecording) return;
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingElapsedSeconds((prev) => {
        if (prev >= MAX_VOICE_RECORD_SECONDS) {
          setRecordingError('Recording limit reached');
          recorderRef.current?.stop();
          return MAX_VOICE_RECORD_SECONDS;
        }
        return prev + 1;
      });
    }, 1000);

    waveformTimerRef.current = window.setInterval(() => {
      setRecordingWaveform((prev) => [...prev.slice(1), 8 + Math.round(Math.random() * 92)]);
    }, WAVEFORM_SAMPLE_MS);

    return () => stopVoiceTimers();
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording) return;
    const key = `voice-note-draft-${order.id}`;
    localStorage.setItem(key, JSON.stringify({ startedAt: recordingStartedAt || Date.now(), elapsed: recordingElapsedSeconds }));
    return () => {
      localStorage.removeItem(key);
    };
  }, [isRecording, order.id, recordingElapsedSeconds, recordingStartedAt]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isRecording) return;
      event.preventDefault();
      event.returnValue = 'Discard recording?';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isRecording]);

  useEffect(() => {
    document.body.style.overflow = isRecording ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording) return;
    const canvas = document.getElementById('voice-recorder-wave') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 56;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    const barWidth = Math.max(2, Math.floor(width / recordingWaveform.length) - 1);

    recordingWaveform.forEach((value, index) => {
      const barHeight = Math.max(3, (value / 100) * (height - 4));
      const x = index * (barWidth + 1);
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
    });
  }, [isRecording, recordingWaveform]);

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecordingError('Voice recording not supported');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const supportedMimeType = mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      const recorder = new MediaRecorder(stream, supportedMimeType ? { mimeType: supportedMimeType } : undefined);
      recorderRef.current = recorder;
      audioChunksRef.current = [];
      setRecordingError(null);
      setRecordingElapsedSeconds(0);
      setRecordingSavedLocally(false);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onpause = () => setIsRecordingPaused(true);
      recorder.onresume = () => setIsRecordingPaused(false);

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        resetVoiceRecordingState();

        if (blob.size > MAX_VOICE_FILE_SIZE_MB * 1024 * 1024) {
          setRecordingError(`Voice note must be smaller than ${MAX_VOICE_FILE_SIZE_MB}MB`);
          return;
        }

        setIsUploadingVoice(true);
        setVoiceUploadProgress(0);
        let progress = 0;
        const timer = window.setInterval(() => {
          progress += 10;
          setVoiceUploadProgress(Math.min(progress, 95));
        }, 120);

        const reader = new FileReader();
        reader.onloadend = () => {
          window.clearInterval(timer);
          setVoiceUploadProgress(100);
          const voice: VoiceNoteAudio = {
            id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `voice-${Date.now()}`,
            fileUrl: String(reader.result || ''),
            duration: recordingElapsedSeconds,
            createdAt: Date.now(),
            author: settings.managerName || 'Manager'
          };
          setNewNoteAudios((prev) => [...prev, voice]);
          setTimeout(() => {
            setIsUploadingVoice(false);
            setVoiceUploadProgress(0);
            const audioEl = document.getElementById(`draft-audio-${voice.id}`) as HTMLAudioElement | null;
            audioEl?.play().catch(() => undefined);
          }, 200);
        };
        reader.onerror = () => {
          window.clearInterval(timer);
          setIsUploadingVoice(false);
          setRecordingError('Recording saved locally');
          setRecordingSavedLocally(true);
        };
        reader.readAsDataURL(blob);
      };

      recorder.start(200);
      setIsRecording(true);
      setIsRecordingPaused(false);
      setRecordingStartedAt(Date.now());
    } catch (e) {
      console.error('Audio recording failed', e);
      setRecordingError('Microphone access required');
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    await startRecording();
  };

  const toggleRecordingPause = () => {
    if (!recorderRef.current) return;
    if (recorderRef.current.state === 'recording') {
      recorderRef.current.pause();
      return;
    }
    if (recorderRef.current.state === 'paused') {
      recorderRef.current.resume();
    }
  };

  const requestCancelRecording = () => {
    if (!isRecording) return;
    setIsDiscardConfirmOpen(true);
  };

  const confirmDiscardRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    resetVoiceRecordingState();
    setIsDiscardConfirmOpen(false);
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

  const removeNewAudio = (index: number) => {
    setNewNoteAudios((prev) => prev.filter((_, audioIndex) => audioIndex !== index));
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

  const orderWorkspaceSuppliers = useMemo(() => {
    const byName = new Map<string, {
      name: string;
      offers: number[];
      lastOfferAt: number;
      supplier?: typeof suppliers[number];
    }>();

    (order.parts || []).forEach((part) => {
      (part.variants || []).forEach((variant) => {
        const name = (variant.shopName || 'Unknown supplier').trim();
        const key = name.toLowerCase();
        if (!byName.has(key)) {
          const matchedSupplier = suppliers.find((supplier) => supplier.name.trim().toLowerCase() === key);
          byName.set(key, {
            name,
            offers: [],
            lastOfferAt: 0,
            supplier: matchedSupplier
          });
        }
        const current = byName.get(key);
        if (!current) return;
        if (Number.isFinite(Number(variant.priceAed)) && Number(variant.priceAed) > 0) {
          current.offers.push(Number(variant.priceAed));
        }
        current.lastOfferAt = Math.max(current.lastOfferAt, Number(variant.updatedAt || variant.createdAt || 0));
      });
    });

    return Array.from(byName.values())
      .map((entry) => {
        const avgPrice = entry.offers.length
          ? Math.round(entry.offers.reduce((sum, item) => sum + item, 0) / entry.offers.length)
          : null;
        const score = Number(entry.supplier?.supplierScore ?? entry.supplier?.successRate ?? entry.supplier?.trustLevel ?? 0);
        const dealsCompleted = Number(entry.supplier?.ordersCompleted ?? entry.supplier?.foundCount ?? 0);
        const responseWindowMs = Number(entry.supplier?.lastRespondedAt || 0) - Number(entry.supplier?.lastContactAt || 0);
        const responseHours = responseWindowMs > 0 ? Math.round(responseWindowMs / (1000 * 60 * 60)) : null;
        return {
          ...entry,
          avgPrice,
          score,
          dealsCompleted,
          responseHours
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if ((a.avgPrice ?? Number.MAX_SAFE_INTEGER) !== (b.avgPrice ?? Number.MAX_SAFE_INTEGER)) {
          return (a.avgPrice ?? Number.MAX_SAFE_INTEGER) - (b.avgPrice ?? Number.MAX_SAFE_INTEGER);
        }
        return b.lastOfferAt - a.lastOfferAt;
      });
  }, [order.parts, suppliers]);

  const bestSuppliersForBrand = useMemo(() => {
    const normalizedBrand = order.brand.trim().toLowerCase();
    if (!normalizedBrand) return [] as typeof suppliers;

    return suppliers
      .filter((supplier) => (supplier.mainBrands || supplier.brands || []).some((brand) => brand.trim().toLowerCase() === normalizedBrand))
      .sort((a, b) => Number(b.supplierScore ?? b.successRate ?? 0) - Number(a.supplierScore ?? a.successRate ?? 0))
      .slice(0, 3);
  }, [order.brand, suppliers]);

  const partsGraphInsights = useMemo(() => {
    const allVariants = orders.flatMap((item) =>
      (item.parts || []).flatMap((part) =>
        (part.variants || []).map((variant) => ({
          partName: part.name,
          priceAed: Number(variant.priceAed),
          shopName: variant.shopName,
          createdAt: Number(variant.updatedAt || variant.createdAt || 0)
        }))
      )
    );

    return (order.parts || []).map((part) => {
      const partKey = part.name.trim().toLowerCase();
      const history = allVariants
        .filter((variant) => variant.partName.trim().toLowerCase() === partKey && Number.isFinite(variant.priceAed) && variant.priceAed > 0)
        .sort((a, b) => b.createdAt - a.createdAt);

      const lastPrice = history[0]?.priceAed ?? null;
      const suppliersForPart = Array.from(new Set(history.map((item) => item.shopName).filter(Boolean))).slice(0, 2);

      return {
        partId: part.id,
        partName: part.name,
        lastPrice,
        suppliersForPart
      };
    });
  }, [order.parts, orders]);

  const bestOfferTotal = useMemo(() => {
    const value = (order.parts || []).reduce((sum, part) => {
      const prices = (part.variants || [])
        .map((variant) => Number(variant.priceAed))
        .filter((price) => Number.isFinite(price) && price > 0);
      if (!prices.length) return sum;
      return sum + Math.min(...prices);
    }, 0);
    return value > 0 ? value : null;
  }, [order.parts]);

  const partsCount = order.parts.length;
  const foundPartsCount = useMemo(
    () => order.parts.filter((part) => part.isFound || (part.variants || []).length > 0).length,
    [order.parts]
  );

  useEffect(() => {
    const restoreScrollTop = (location.state as { restoreScrollTop?: unknown } | null)?.restoreScrollTop;
    if (typeof restoreScrollTop !== 'number' || restoreScrollTop < 0) return;
    const mainScroller = document.querySelector('main');
    if (!(mainScroller instanceof HTMLElement)) return;
    window.requestAnimationFrame(() => {
      mainScroller.scrollTop = restoreScrollTop;
    });
  }, [location.state]);

  return (
    <div className="flex flex-col min-h-full overflow-x-hidden bg-[#F6F7FB] pb-[calc(6.5rem+env(safe-area-inset-bottom))] text-[#1E1F23]">
      <div className="p-4 sticky top-0 z-20 backdrop-blur bg-white/95 border-b border-gray-100 space-y-2 shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={handleBackNavigation} className="p-3 -ml-2 rounded-full transition-colors text-gray-600 active:bg-gray-100">
            <ArrowLeft size={22} />
          </button>
          <div className="text-left flex-1 mx-2 min-w-0">
            <h1 className="text-[18px] font-semibold leading-tight truncate text-[#1E1F23]">{order.brand} {order.model} <span className="text-slate-500">{order.year}</span></h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-[#667085]">ID <span className="font-mono font-bold text-gray-700">#{order.id.slice(0, 8).toUpperCase()}</span></span>
              <button type="button" onClick={() => void copyText(order.id, 'ID скопирован')} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600"><Copy size={11} />Копировать</button>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700"><Cloud size={11} />Синхронизировано</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-[#667085]">VIN: <span className="font-mono uppercase text-gray-700">{order.vin || 'Не добавлен'}</span></span>
              <button type="button" onClick={() => void copyText(order.vin || '', 'VIN скопирован')} disabled={!order.vin} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600 disabled:opacity-40"><Copy size={11} />VIN</button>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">Возраст: {orderAgeDays} дн</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">Найдено: {foundPartsCount}/{partsCount}</span>
            </div>
            {vinIsIncomplete && <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-bold text-orange-700">⚠ VIN неполный</span>}
          </div>
          <div className="relative">
            <button type="button" onClick={() => setShowActionsMenu(v => !v)} className="p-3 rounded-full text-gray-600 active:bg-gray-100">
              <MoreVertical size={20} />
            </button>
            {showActionsMenu && (
              <div className="absolute right-0 mt-1 w-56 rounded-xl border border-gray-100 bg-white shadow-lg p-1 text-xs font-semibold z-30">
                <button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50" onClick={() => setIsEditMode((prev) => !prev)}>Edit order</button>
                <button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50" onClick={() => updateOrder({ ...order, id: `${order.id}-copy-${Date.now()}` })}>Duplicate order</button>
                <button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50" onClick={() => updateOrderField('isArchived', !order.isArchived)}>{order.isArchived ? 'Unarchive' : 'Archive'}</button>
                <button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50" onClick={() => void copyText('Синхронизация активна', 'Синхронизация')}>Состояние синхронизации</button>
                <button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50" onClick={() => setIsEstimateOpen(true)}>Export</button>
                <button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 text-red-600" onClick={() => setShowActionsMenu(false)}>Delete</button>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-2 rounded-[14px] bg-white px-4 py-4 shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
          <p className="text-[14px] font-semibold uppercase tracking-[0.04em] text-[#8B8F98]">Pipeline</p>
          <div className="flex items-center justify-between gap-3">
          <div className="inline-flex rounded-[12px] bg-[#F6F7FB] border border-[#E7EAF3] p-1">
            {CUSTOMER_STATUSES.map(status => (
              <button
                key={status}
                type="button"
                onClick={() => updateCustomerStatus(status)}
                className={`h-10 min-w-[84px] px-3 rounded-[10px] text-[13px] font-medium transition-all duration-150 active:scale-[0.97] ${resolvedCustomerStatus === status ? PIPELINE_STYLES[status] : 'text-gray-500'}`}
              >
                {status}
              </button>
            ))}
          </div>
          <div className={`inline-flex items-center gap-1 text-xs font-bold ${isSlaBreached ? 'text-amber-700' : 'text-gray-500'}`}>
            <Clock3 size={14} /> {orderAgeDays} дней
          </div>
        </div>
        </div>
        <div className="flex gap-2 items-center overflow-x-auto no-scrollbar">
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium ${(SALES_STATUS_STYLES[(order.salesStatus || 'Inquiry') as typeof SALES_STATUSES[number]] || 'text-[#1E1F23] border-gray-200 bg-white')}`}>
            <span className="tracking-[0.04em]">Status</span>
            <select value={order.salesStatus || 'Inquiry'} onChange={(e) => updateOrderField('salesStatus', e.target.value)} disabled={!isEditMode} className="bg-transparent text-[12px] font-medium text-current outline-none">
            {SALES_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <select value={order.priority} title={PRIORITY_HINT[order.priority]} onChange={(e) => updatePriority(e.target.value as Priority)} disabled={!isEditMode} className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 shrink-0">
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

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Зона заказа</p>
          <div className="flex flex-wrap gap-1 min-h-[28px]">
            {(order.zones && order.zones.length > 0 ? order.zones : order.zone ? [order.zone] : []).map((z, index) => (
              <span key={`${z}-${index}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-700">
                {z}
                <button
                  type="button"
                  aria-label={`Удалить зону ${z}`}
                  onClick={() => {
                    const current = order.zones && order.zones.length > 0 ? order.zones : (order.zone ? [order.zone] : []);
                    const targetIndex = current.findIndex((_, currentIndex) => currentIndex === index);
                    if (targetIndex < 0) return;
                    const next = current.filter((_, currentIndex) => currentIndex !== targetIndex);
                    updateOrderZones(next);
                  }}
                  className="text-blue-400 hover:text-red-500 leading-none"
                >×</button>
              </span>
            ))}
          </div>
          <select
            value=""
            onChange={(e) => {
              const selected = e.target.value;
              if (!selected) return;
              const current = order.zones && order.zones.length > 0 ? order.zones : (order.zone ? [order.zone] : []);
              if (current.includes(selected)) return;
              const next = [...current, selected];
              updateOrderZones(next);
            }}
            className="w-full text-sm font-bold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
          >
            <option value="">+ Добавить зону</option>
            {(settings.orderZones || []).map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>

        {/* Client & Source Block */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <button type="button" onClick={() => setIsClientBlockExpanded((prev) => !prev)} className="flex w-full items-center justify-between text-left">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Клиент</p>
              <p className="text-sm font-bold text-gray-800">{String(draftFields.clientName ?? order.clientName ?? 'Без имени')}</p>
            </div>
            {isClientBlockExpanded ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
          </button>
          {isClientBlockExpanded && (
            <>
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
            </>
          )}
        </div>

        <div className="bg-white p-4 rounded-[14px] border border-[#E7EAF3] shadow-[0_4px_12px_rgba(0,0,0,0.06)] space-y-5 transition-all duration-200 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] hover:scale-[1.01]">
          <p className="text-[14px] font-semibold uppercase tracking-[0.04em] text-[#8B8F98]">Order Workspace</p>
          <div className="grid grid-cols-1 gap-5 text-xs">
            <div className="rounded-[14px] border border-[#E7EAF3] bg-white p-4 space-y-2">
              <p className="text-[14px] font-semibold uppercase tracking-[0.04em] text-[#8B8F98]">Main</p>
              <p className="text-[20px] font-semibold text-[#1E1F23]">{order.brand} {order.model} {order.year}</p>
              <p className="text-[20px] font-bold text-[#1E1F23]">{formatMoney(sellTotalAed, clientCurrency)}</p>
              <p className="text-[13px] font-normal text-[#8B8F98]">Supplier: {orderWorkspaceSuppliers[0]?.name || 'Not selected'}</p>
              <p className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-[12px] font-medium ${(SALES_STATUS_STYLES[(order.salesStatus || 'Inquiry') as typeof SALES_STATUSES[number]] || 'text-[#1E1F23] border-gray-200 bg-white border')}`}>
                {order.salesStatus || 'Inquiry'}
              </p>
            </div>
            <div className="rounded-[14px] border border-[#E7EAF3] bg-white p-4 space-y-3">
              <button
                type="button"
                onClick={() => setIsSupplierIntelligenceExpanded((prev) => !prev)}
                className="flex w-full items-center justify-between text-left"
              >
                <p className="text-[14px] font-semibold uppercase tracking-[0.04em] text-[#8B8F98]">Supplier intelligence</p>
                {isSupplierIntelligenceExpanded ? <ChevronUp size={14} className="text-[#8B8F98]" /> : <ChevronDown size={14} className="text-[#8B8F98]" />}
              </button>
              {isSupplierIntelligenceExpanded && (
                <>
              {orderWorkspaceSuppliers.slice(0, 3).map((supplier) => (
                <div key={supplier.name} className="rounded-[12px] bg-[#F6F7FB] p-3 space-y-2">
                  <p className="text-[16px] font-medium text-[#1E1F23]">{supplier.name}</p>
                  <div className="grid grid-cols-3 gap-3 text-[#8B8F98]">
                    <div className="flex flex-col"><span className="text-[11px] uppercase">Score</span><span className="text-[15px] font-bold text-[#1E1F23]">{supplier.score || 0}</span></div>
                    <div className="flex flex-col"><span className="text-[11px] uppercase">Deals</span><span className="text-[15px] font-bold text-[#1E1F23]">{supplier.dealsCompleted || 0}</span></div>
                    <div className="flex flex-col"><span className="text-[11px] uppercase">Avg price</span><span className="text-[15px] font-bold text-[#1E1F23]">{supplier.avgPrice ? `${supplier.avgPrice} AED` : '—'}</span></div>
                  </div>
                  <p className="text-[12px] text-[#8B8F98]">Response: {supplier.responseHours ? `${supplier.responseHours}h avg` : 'No data'}</p>
                  <div className="mt-1 flex gap-2 text-[12px] font-medium">
                    <button type="button" onClick={() => openSupplierCard(supplier.name)} className="rounded-[10px] border border-[#E7EAF3] bg-white px-2 py-1 active:scale-[0.98]">👁 View</button>
                    <button type="button" onClick={() => openSupplierMap(supplier.name)} className="rounded-[10px] border border-[#E7EAF3] bg-white px-2 py-1 active:scale-[0.98]">📍 Map</button>
                    <button type="button" onClick={() => contactSupplier(supplier.name)} className="rounded-[10px] border border-[#E7EAF3] bg-white px-2 py-1 active:scale-[0.98]">💬 Contact</button>
                  </div>
                </div>
              ))}
              {!orderWorkspaceSuppliers.length && <p className="text-[12px] text-[#8B8F98]">Добавьте офферы, чтобы увидеть аналитику поставщиков.</p>}
                </>
              )}
            </div>
            <div className="rounded-[16px] bg-gradient-to-r from-[#5A6CF8] to-[#6C7CFF] p-4 text-white space-y-2 shadow-[0_4px_12px_rgba(0,0,0,0.12)]">
              <p className="text-[14px] font-semibold uppercase tracking-[0.04em] text-white/90">Quote клиенту</p>
              <div className="space-y-1 text-[13px] leading-[20px]">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <p>Purchase</p><p className="text-right text-[16px] font-medium">{formatMoney(selectedOfferTotal)}</p>
                <p>Margin</p><p className="text-right text-[16px] font-medium">{formatMoney(markupAed)}</p>
                <p>Logistics</p><p className="text-right text-[16px] font-medium">{formatMoney(logisticsWithCargoTotal)}</p>
              </div>
                <p className="flex items-center justify-between border-t border-white/30 pt-2"><span>Client price</span><span className="text-[20px] font-bold">{formatMoney(sellTotalAed, clientCurrency)}</span></p>
              </div>
              <button type="button" onClick={() => setIsEstimateOpen(true)} className="mt-2 h-12 w-full rounded-[12px] bg-white text-[#3B6AF7] text-[13px] font-semibold active:scale-[0.97] transition-transform duration-200">Отправить клиенту</button>
            </div>
            <div className="rounded-[14px] border border-[#E7EAF3] bg-white p-4 space-y-2">
              <p className="text-[14px] font-semibold uppercase tracking-[0.04em] text-[#8B8F98]">Панель деталей</p>
              {partsGraphInsights.map((insight) => (
                <p key={insight.partId} className="text-[13px] text-[#8B8F98]">
                  <span className="font-medium text-[#1E1F23]">{insight.partName}:</span> {insight.suppliersForPart.join(', ') || 'без истории'} {insight.lastPrice ? `· last ${insight.lastPrice} AED` : ''}
                </p>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <button type="button" onClick={() => setIsVehicleBlockExpanded((prev) => !prev)} className="flex w-full items-center justify-between text-left">
            <div>
              <p className="text-[14px] font-semibold uppercase tracking-[0.04em] text-[#8B8F98]">Данные автомобиля</p>
            </div>
            {isVehicleBlockExpanded ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
          </button>
          {isVehicleBlockExpanded && <div className="grid grid-cols-2 gap-3">
          <div className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">Model: {String(draftFields.model ?? order.model ?? '—')}</div>
          <div className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">Year: {String(draftFields.year ?? order.year ?? '—')}</div>
          <div className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">Generation: {String(draftFields.bodyType ?? order.bodyType ?? '—')}</div>
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
          }
        </div>


        <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <button type="button" onClick={() => setIsVehicleDetailsExpanded((prev) => !prev)} className="flex w-full items-center justify-between text-left">
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Подробные данные автомобиля</p>
              <p className="text-[11px] text-gray-500 mt-1">Двигатель, привод, коробка, рынок/спецификация и другие важные параметры для точного подбора деталей.</p>
            </div>
            {isVehicleDetailsExpanded ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
          </button>

          {isVehicleDetailsExpanded && (
            <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Тип двигателя</label>
              <input
                type="text"
                value={String((draftFields.vehicleDetails?.engineType) ?? (order.vehicleDetails?.engineType ?? ''))}
                readOnly={!isEditMode}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), engineType: e.target.value })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                placeholder="V6 / Hybrid / Electric"
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Топливо</label>
              <input
                type="text"
                value={String((draftFields.vehicleDetails?.fuelType) ?? (order.vehicleDetails?.fuelType ?? ''))}
                readOnly={!isEditMode}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), fuelType: e.target.value })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                placeholder="Бензин / Дизель"
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Привод</label>
              <select
                value={String((draftFields.vehicleDetails?.drivetrain) ?? (order.vehicleDetails?.drivetrain ?? ''))}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), drivetrain: (e.target.value || undefined) })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                disabled={!isEditMode}
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              >
                <option value="">Не указано</option>
                {VEHICLE_DRIVETRAIN_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Коробка</label>
              <select
                value={String((draftFields.vehicleDetails?.transmission) ?? (order.vehicleDetails?.transmission ?? ''))}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), transmission: (e.target.value || undefined) })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                disabled={!isEditMode}
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              >
                <option value="">Не указано</option>
                {VEHICLE_TRANSMISSION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Код коробки</label>
              <input
                type="text"
                value={String((draftFields.vehicleDetails?.transmissionCode) ?? (order.vehicleDetails?.transmissionCode ?? ''))}
                readOnly={!isEditMode}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), transmissionCode: e.target.value })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                placeholder="ZF8HP / Aisin"
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Объём двигателя</label>
              <input
                type="text"
                value={String((draftFields.vehicleDetails?.engineDisplacement) ?? (order.vehicleDetails?.engineDisplacement ?? ''))}
                readOnly={!isEditMode}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), engineDisplacement: e.target.value })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                placeholder="2.0 / 3.5"
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Код двигателя</label>
              <input
                type="text"
                value={String((draftFields.vehicleDetails?.engineCode) ?? (order.vehicleDetails?.engineCode ?? ''))}
                readOnly={!isEditMode}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), engineCode: e.target.value })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                placeholder="N52 / 2GR"
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Комплектация / Trim</label>
              <input
                type="text"
                value={String((draftFields.vehicleDetails?.trimLevel) ?? (order.vehicleDetails?.trimLevel ?? ''))}
                readOnly={!isEditMode}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), trimLevel: e.target.value })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                placeholder="SE / Limited"
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Рынок / спецификация</label>
              <select
                value={String((draftFields.vehicleDetails?.marketRegion) ?? (order.vehicleDetails?.marketRegion ?? ''))}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), marketRegion: (e.target.value || undefined) })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                disabled={!isEditMode}
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              >
                <option value="">Не указано</option>
                {VEHICLE_MARKET_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Руль</label>
              <select
                value={String((draftFields.vehicleDetails?.steeringSide) ?? (order.vehicleDetails?.steeringSide ?? ''))}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), steeringSide: (e.target.value || undefined) })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                disabled={!isEditMode}
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              >
                <option value="">Не указано</option>
                {VEHICLE_STEERING_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Дверей</label>
              <input
                type="text"
                value={String((draftFields.vehicleDetails?.doors) ?? (order.vehicleDetails?.doors ?? ''))}
                readOnly={!isEditMode}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), doors: e.target.value })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                placeholder="2 / 4 / 5"
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Цвет</label>
              <input
                type="text"
                value={String((draftFields.vehicleDetails?.color) ?? (order.vehicleDetails?.color ?? ''))}
                readOnly={!isEditMode}
                onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), color: e.target.value })}
                onBlur={() => flushDeferredOrderField('vehicleDetails')}
                placeholder="White / Black"
                className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-2 py-2 outline-none border border-gray-100"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Дополнительные примечания</label>
            <textarea
              value={String((draftFields.vehicleDetails?.additionalNotes) ?? (order.vehicleDetails?.additionalNotes ?? ''))}
              readOnly={!isEditMode}
              onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), additionalNotes: e.target.value })}
              onBlur={() => flushDeferredOrderField('vehicleDetails')}
              rows={2}
              placeholder="Особенности по двигателю, редуктору, версии и т.п."
              className="w-full text-xs font-semibold bg-gray-50 rounded-xl px-3 py-2 outline-none border border-gray-100"
            />
          </div>
            </>
          )}
        </div>

        <div className="bg-white p-4 rounded-[14px] border border-[#E7EAF3] shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all duration-200 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] hover:scale-[1.01]">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[14px] font-semibold text-[#8B8F98] uppercase tracking-[0.04em]">Фото автомобиля</div>
            <>
              <input type="file" ref={carFileRef} onChange={handleCarPhotoChange} className="hidden" accept="image/*" multiple />
              <button type="button" onClick={() => carFileRef.current?.click()} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">Добавить фото</button>
            </>
          </div>
          {getCarPhotos().length > 0 ? (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {getCarPhotos().map((ph, i) => (
                <div key={i} className="relative w-[180px] h-[120px] rounded-[12px] overflow-hidden border border-gray-100 shrink-0">
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

        <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <button type="button" onClick={() => setIsPricingCargoExpanded((prev) => !prev)} className="flex w-full items-center justify-between text-left">
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Наценка и карго</p>
              <p className="text-xs font-semibold text-gray-600">{formatMoney(markupAed)} · {order.logistics?.cargoCountry || cargoCalc.country}</p>
            </div>
            {isPricingCargoExpanded ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
          </button>
          {isPricingCargoExpanded && (
            <>
        <div className="grid grid-cols-1 gap-3">
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Margin</span>
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
              Apply margin to new parts
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Валюта клиента</span>
                <select
                  value={order.clientCurrency || 'USD'}
                  onChange={(e) => updateOrderField('clientCurrency', e.target.value)}
                  disabled={!isEditMode}
                  className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-800 outline-none"
                >
                  {(['AED', 'USD', 'RUB', 'TJS'] as const).map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Курс USD→AED</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={rateInput}
                  onChange={handleRateChange}
                  onBlur={flushExchangeRateCommit}
                  className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-800 outline-none"
                  placeholder="3.67"
                />
              </label>
            </div>
          </div>

          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <span className="text-sm font-semibold text-slate-600">Страна карго</span>
              <select
                value={order.logistics?.cargoCountry || cargoCalc.country}
                onChange={(e) => updateCargoField({ cargoCountry: e.target.value })}
                className="mt-2 h-14 w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 text-lg font-bold text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {cargoTariffOptions.map((item) => <option key={item.country} value={item.country}>{item.country}</option>)}
              </select>
              <p className="mt-2 text-xs text-slate-500">Страна влияет на расчёт доставки и отображение логистики в invoice.</p>
            </div>
            <div className="col-span-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
              <p className="text-sm font-semibold text-slate-700">Параметры cargo по деталям</p>
              <p className="mt-1 text-xs text-slate-500">Эти параметры используются для расчёта логистики и отображения в invoice.</p>
              {(order.parts || []).length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">Добавьте детали, чтобы рассчитать карго.</p>
              ) : (
                <>
                  {(() => {
                    const completion = (order.parts || []).reduce((acc, part) => {
                      const cargoDraft = partCargoDrafts[part.id] || {
                        weightKg: Number((part as any).weightKg || 0) > 0 ? String(Number((part as any).weightKg || 0)) : '',
                        places: Number((part as any).places || 0) > 0 ? String(Number((part as any).places || 0)) : '',
                        cargoPlaceGroup: String((part as any).cargoPlaceGroup || ''),
                        isOversized: Boolean((part as any).isOversized)
                      };
                      const status = getCargoPartCompletion(parseCargoNumber(cargoDraft.weightKg), parseCargoNumber(cargoDraft.places));
                      if (status === 'ready') acc.ready += 1;
                      if (status === 'missing') acc.missing += 1;
                      return acc;
                    }, { ready: 0, missing: 0 });
                    return (
                      <p className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                        {completion.missing > 0 ? `Для ${completion.missing} деталей не хватает cargo-параметров` : `Заполнено ${completion.ready} из ${(order.parts || []).length} деталей`}
                      </p>
                    );
                  })()}
                  <div className="mt-2 space-y-1.5">
                    {(() => {
                      const existingGroups = Array.from(new Set(
                        (order.parts || []).flatMap((p) => {
                          const draft = partCargoDrafts[p.id];
                          const group = draft ? draft.cargoPlaceGroup : String((p as any).cargoPlaceGroup || '');
                          return group.trim() ? [group.trim()] : [];
                        })
                      ));
                      const groupOptions = Array.from(new Set([...existingGroups, 'BOX-1', 'BOX-2', 'BOX-3', 'BOX-4', 'BOX-5', 'PAL-1', 'PAL-2']));
                      return (order.parts || []).map((part) => {
                      const cargoDraft = partCargoDrafts[part.id] || {
                        weightKg: Number((part as any).weightKg || 0) > 0 ? String(Number((part as any).weightKg || 0)) : '',
                        places: Number((part as any).places || 0) > 0 ? String(Number((part as any).places || 0)) : '',
                        cargoPlaceGroup: String((part as any).cargoPlaceGroup || ''),
                        isOversized: Boolean((part as any).isOversized)
                      };
                      const isExpanded = !!expandedCargoPartIds[part.id];
                      const weightValue = parseCargoNumber(cargoDraft.weightKg);
                      const placesValue = parseCargoNumber(cargoDraft.places);
                      const status = getCargoPartCompletion(weightValue, placesValue);
                      const statusColor = status === 'ready' ? 'text-emerald-600' : status === 'partial' ? 'text-amber-600' : 'text-rose-500';
                      const summaryText = status === 'ready'
                        ? `${weightValue} кг · ${placesValue} м${cargoDraft.cargoPlaceGroup ? ` · ${cargoDraft.cargoPlaceGroup}` : ''}${cargoDraft.isOversized ? ' · КГ' : ''}`
                        : status === 'partial'
                          ? `${weightValue > 0 ? `${weightValue} кг` : '—'} · ${placesValue > 0 ? `${placesValue} м` : '—'}`
                          : '—';
                      return (
                        <div key={part.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                          <button type="button" onClick={() => toggleCargoPartDraft(part.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 transition-colors">
                            <span className="flex-1 truncate text-xs font-semibold text-slate-800">{part.name}</span>
                            <span className={`shrink-0 text-[11px] font-medium ${statusColor}`}>{summaryText}</span>
                            {isExpanded ? <ChevronUp size={12} className="shrink-0 text-slate-400" /> : <ChevronDown size={12} className="shrink-0 text-slate-400" />}
                          </button>
                          {isExpanded && (
                            <div className="border-t border-slate-100 px-3 pb-2 pt-2 space-y-2">
                              <div className="grid grid-cols-2 gap-1.5">
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Вес, кг</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={cargoDraft.weightKg}
                                    onChange={(e) => onPartCargoDraftChange(part.id, 'weightKg', e.target.value.replace(',', '.'))}
                                    className={`h-7 rounded-lg border px-2 text-xs font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${cargoDraft.weightKg && weightValue <= 0 ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200 bg-white'}`}
                                    placeholder="0.0"
                                  />
                                  {cargoDraft.weightKg && weightValue <= 0 && <span className="text-[10px] text-rose-600">{'Должен быть > 0'}</span>}
                                </label>
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Мест</span>
                                  <select
                                    value={cargoDraft.places}
                                    onChange={(e) => onPartCargoDraftChange(part.id, 'places', e.target.value)}
                                    className={`h-7 rounded-lg border px-2 text-xs font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${cargoDraft.places && placesValue < 1 ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200 bg-white'}`}
                                  >
                                    <option value="">—</option>
                                    {[1,2,3,4,5,6,7,8,9,10,12,15,20].map((n) => (
                                      <option key={n} value={String(n)}>{n}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                              <div className="grid grid-cols-2 gap-1.5 items-center">
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Группа мест</span>
                                  <select
                                    value={cargoDraft.cargoPlaceGroup}
                                    onChange={(e) => onPartCargoDraftChange(part.id, 'cargoPlaceGroup', e.target.value)}
                                    className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                  >
                                    <option value="">—</option>
                                    {groupOptions.map((g) => (
                                      <option key={g} value={g}>{g}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2 h-7 cursor-pointer">
                                  <span className="text-[10px] font-semibold text-slate-600">КГ</span>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={cargoDraft.isOversized}
                                    onClick={() => onPartCargoDraftChange(part.id, 'isOversized', !cargoDraft.isOversized)}
                                    className={`relative inline-flex h-4 w-8 items-center rounded-full transition ${cargoDraft.isOversized ? 'bg-blue-600' : 'bg-slate-300'}`}
                                  >
                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition ${cargoDraft.isOversized ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                  </button>
                                </label>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                      });
                    })()}
                  </div>
                </>
              )}
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
              <div className="rounded-xl bg-gray-50 px-3 py-2"><p className="text-gray-400">Purchase</p><p className="font-black text-gray-800">{formatMoney(selectedOfferTotal)}</p></div>
              <div className="rounded-xl bg-gray-50 px-3 py-2"><p className="text-gray-400">Cargo</p><p className="font-black text-gray-800">{formatDualMoney(cargoTotalAed)}</p></div>
              <div className="rounded-xl bg-blue-50 px-3 py-2"><p className="text-blue-500">Margin</p><p className="font-black text-blue-700">{formatDualMoney(markupAed)}</p></div>
              <div className="rounded-xl bg-emerald-50 px-3 py-2"><p className="text-emerald-500">Client price</p><p className="font-black text-emerald-700">{formatMoney(sellTotalAed, clientCurrency)}</p></div>
            </div>
            <div className="rounded-xl bg-emerald-100 px-3 py-2 text-sm font-black text-emerald-800">Чистая прибыль: {canComputeProfit && netProfitAed !== null ? formatDualMoney(netProfitAed) : '—'}</div>
            {!canComputeProfit && <div className="text-xs font-semibold text-gray-500">Добавьте варианты цен.</div>}
            {isLoss && <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">Вы уходите в минус ⚠️</div>}
            {isMarkupMissing && <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">Наценка отсутствует. Прибыль = 0.</div>}
            {lowMargin && <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">Рекомендуемая маржа: 10-20%</div>}
          </div>

          <div className="grid grid-cols-1 gap-2">
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={openClientChannel} className="h-11 rounded-2xl bg-emerald-50 text-emerald-700 text-[11px] font-black uppercase">{contactActionLabel}</button>
              <button type="button" onClick={() => partInputRef.current?.focus()} className="h-11 rounded-2xl bg-blue-50 px-2 text-blue-700 text-[11px] font-black">Добавить деталь</button>
              <button type="button" onClick={() => navigate('/database')} className="h-11 rounded-2xl bg-slate-100 px-2 text-slate-700 text-[11px] font-black">Добавить поставщика</button>
            </div>
          </div>
        </div>
            </>
          )}
        </div>


        {sellError && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-2">
            <AlertTriangle size={16} />
            {sellError}
          </div>
        )}


        <div className="bg-white p-4 rounded-[14px] border border-[#E7EAF3] shadow-[0_4px_12px_rgba(0,0,0,0.06)] space-y-4 transition-all duration-200 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] hover:scale-[1.01]">
          <h2 className="text-[14px] font-semibold text-[#8B8F98] uppercase tracking-[0.04em]">Add part</h2>
          <form 
            onSubmit={(e) => { e.preventDefault(); addNewPart(); }}
            className="flex flex-col gap-3"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_118px] gap-2">
              <div className="flex-1 flex gap-2 items-center bg-[#F6F7FB] border border-[#E7EAF3] px-3 rounded-[12px] h-12">
                <input 
                  type="text" 
                  ref={partInputRef} value={newPartName} 
                  onChange={(e) => setNewPartName(e.target.value)}
                  placeholder="Search part..."
                  className="flex-1 bg-transparent outline-none p-1 text-[16px] font-medium text-[#1E1F23]"
                />
              </div>
              <div className="flex w-[118px] shrink-0 items-center rounded-[12px] border border-[#E7EAF3] bg-white h-12 overflow-hidden">
                <button type="button" className="h-12 w-9 text-lg font-semibold text-[#1E1F23]" onClick={() => setNewPartQuantity(String(Math.max(1, Number(newPartQuantity || 1) - 1)))}>-</button>
                <input
                  type="number"
                  min={1}
                  value={newPartQuantity}
                  onChange={(e) => setNewPartQuantity(e.target.value)}
                  className="w-full min-w-0 bg-transparent text-center text-[16px] font-medium outline-none"
                  placeholder="1"
                />
                <button type="button" className="h-12 w-9 text-lg font-semibold text-[#1E1F23]" onClick={() => setNewPartQuantity(String(Math.max(1, Number(newPartQuantity || 1) + 1)))}>+</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewPartKind('single')}
                className={`rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-wide ${newPartKind === 'single' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-500'}`}
              >
                Обычная деталь
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewPartKind('group');
                  setNewPartGroupItems((prev) => prev.length > 0 ? prev : [createGroupItemDraft()]);
                }}
                className={`rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-wide ${newPartKind === 'group' ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-gray-200 bg-white text-gray-500'}`}
              >
                Группа деталей
              </button>
            </div>
            {newPartKind === 'group' && (
              <div className="space-y-2 rounded-xl border border-violet-100 bg-violet-50/60 p-3">
                <p className="text-[11px] font-black uppercase tracking-wide text-violet-700">Состав группы</p>
                {newPartGroupItems.map((item, index) => (
                  <div key={item.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => updateGroupItemRow(item.id, 'name', e.target.value)}
                      placeholder={`Деталь #${index + 1}`}
                      className="w-full flex-1 rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm font-semibold outline-none"
                    />
                    <div className="flex items-center gap-2 sm:shrink-0">
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateGroupItemRow(item.id, 'quantity', e.target.value)}
                        className="w-20 rounded-lg border border-violet-100 bg-white px-2 py-2 text-center text-sm font-bold"
                      />
                      <button
                        type="button"
                        onClick={() => removeGroupItemRow(item.id)}
                        className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-rose-600"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={addGroupItemRow} className="w-full rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-black uppercase tracking-wide text-violet-700 sm:w-auto">
                  + Добавить деталь в группу
                </button>
              </div>
            )}
            <textarea
              value={newPartComment}
              onChange={(e) => setNewPartComment(e.target.value)}
              placeholder={newPartKind === 'group' ? 'Описание к группе (необязательно)' : 'Описание к детали (необязательно)'}
              className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-semibold outline-none"
              rows={2}
            />

            <div className="flex items-end justify-between gap-3">
              <div className="flex flex-1 gap-2 items-center overflow-x-auto no-scrollbar">
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
              <button
                type="submit"
                className="h-12 w-full sm:w-auto shrink-0 rounded-[12px] bg-[#3B6AF7] px-6 text-[13px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_12px_rgba(59,106,247,0.35)] active:scale-[0.97] transition-transform duration-200"
              >
                ADD
              </button>
            </div>
          </form>
          <p className="mt-3 text-xs font-semibold text-gray-600">
            Добавлено деталей: <span className="font-black text-gray-800">{order.parts.length}</span>
            {order.parts.length > 0 ? <span className="text-gray-500"> · Последняя: {order.parts[order.parts.length - 1]?.name || '—'}</span> : null}
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <h2 className="font-black text-gray-400 text-[10px] uppercase tracking-[0.2em]">Заметки</h2>
          <textarea value={newNoteText} onChange={(e) => setNewNoteText(e.target.value)} placeholder="Текст заметки..." className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold outline-none" rows={3} />

          {recordingError && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{recordingError}</p>}
          {recordingSavedLocally && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">Recording saved locally</p>}

          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            <button type="button" onClick={() => noteFileRef.current?.click()} aria-label="Attach photo" className="h-11 rounded-xl border border-gray-200 bg-gray-50 px-4 text-gray-700 inline-flex items-center gap-2"><ImageIcon size={18} /> Фото</button>
            <button type="button" onClick={() => noteAudioFileRef.current?.click()} aria-label="Attach audio file" className="h-11 rounded-xl border border-gray-200 bg-gray-50 px-4 text-gray-700 inline-flex items-center gap-2"><FileAudio size={18} /> Файл</button>
            <button type="button" onClick={() => void toggleRecording()} aria-label="Voice" className={`h-11 rounded-xl px-4 inline-flex items-center gap-2 transition-all ${isRecording ? 'border border-red-300 bg-red-50 text-red-700' : 'border border-gray-200 bg-gray-100 text-gray-700'}`}><Mic size={16} className={isRecording ? 'scale-110' : ''} /> Voice</button>
            {newNotePhotos.map((p, i) => <img key={i} src={p} className="w-12 h-12 rounded-xl object-cover border border-gray-100" />)}
            {newNoteAudios.map((audioItem, i) => {
              const voice = toVoiceNoteAudio(audioItem);
              const audioId = `draft-audio-${voice.id}`;
              const isPlaying = playingAudioId === audioId;
              const progress = audioProgress[audioId] || 0;
              const bars = getWaveBars(voice.fileUrl.slice(0, 120));

              return (
                <div key={`na-${voice.id}`} className="flex h-12 items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-2 py-1 min-w-[250px]">
                  <button type="button" onClick={() => toggleAudioPlayback(audioId)} aria-label="Play voice note" className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white shrink-0">{isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}</button>
                  <div className="flex h-8 flex-1 items-end gap-[2px] rounded-md bg-white/80 px-1">
                    {bars.slice(0, 18).map((bar, barIndex) => {
                      const completion = (barIndex + 1) / 18;
                      const isActive = completion <= progress / 100;
                      return <span key={`${audioId}-bar-${barIndex}`} className={`w-[3px] rounded-full ${isActive ? 'bg-blue-600' : 'bg-blue-200'}`} style={{ height: `${Math.max(30, bar * 0.8)}%` }} />;
                    })}
                  </div>
                  <span className="text-[10px] font-bold text-slate-600">{formatSeconds(voice.duration)}</span>
                  <button type="button" onClick={() => removeNewAudio(i)} aria-label="Delete voice note" className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[10px] font-bold text-rose-600">Удалить</button>
                  <audio id={audioId} src={voice.fileUrl} preload="metadata" playsInline />
                </div>
              );
            })}
            <input type="file" ref={noteFileRef} onChange={handleNotePhotoChange} className="hidden" accept="image/*" multiple />
            <input type="file" ref={noteAudioFileRef} onChange={handleNoteAudioFileChange} className="hidden" accept="audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.webm" multiple />
          </div>

          {isUploadingVoice && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-600">Uploading voice note...</p>
              <div className="h-2 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{ width: `${voiceUploadProgress}%` }} /></div>
            </div>
          )}

          <button type="button" onClick={addNote} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-wide">Добавить заметку</button>
          {(order.notes || []).length > 0 && (
            <div className="space-y-2">
              {(order.notes || []).map(n => (
                <div key={n.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    {n.text && <p className="text-sm font-semibold text-gray-700">{n.text}</p>}
                    <button type="button" onClick={() => removeNoteById(n.id)} className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">Delete заметку</button>
                  </div>
                  {n.photos && n.photos.length > 0 && <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar">{n.photos.map((ph, idx) => <div key={idx} className="relative w-12 h-12 rounded-lg overflow-hidden"><button type="button" onClick={() => setGallery({ images: n.photos || [], index: idx })} className="w-full h-full"><img src={ph} className="w-full h-full object-cover" /></button><button type="button" onClick={() => removeNotePhoto(n.id, idx)} className="absolute right-0.5 top-0.5 rounded-full bg-black/60 px-1 text-[9px] text-white">✕</button></div>)}</div>}
                  {n.audios && n.audios.length > 0 && <div className="space-y-2 mt-2">{n.audios.map((audioItem, idx) => {
                    const voice = toVoiceNoteAudio(audioItem);
                    const audioId = `note-${n.id}-${voice.id}-${idx}`;
                    const isPlaying = playingAudioId === audioId;
                    const progress = audioProgress[audioId] || 0;
                    const bars = getWaveBars(voice.fileUrl.slice(0, 120));

                    return (
                      <div key={audioId} className="space-y-2 rounded-2xl border border-gray-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500">
                          <p className="inline-flex items-center gap-1"><Mic size={12} /> Voice note</p>
                          <p>{new Date(voice.createdAt).toLocaleString()}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => toggleAudioPlayback(audioId)} aria-label="Play" className="w-7 h-7 rounded-full bg-green-600 text-white flex items-center justify-center shrink-0">{isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}</button>
                          <div className="flex-1 h-8 flex items-center gap-0.5">
                            {bars.map((height, barIndex) => {
                              const threshold = ((barIndex + 1) / bars.length) * 100;
                              const isPassed = progress >= threshold;
                              return <span key={`${audioId}-bar-${barIndex}`} className={`block flex-1 rounded-full transition-colors ${isPassed ? 'bg-green-500' : 'bg-gray-300'} ${isPlaying ? 'animate-pulse' : ''}`} style={{ height: `${height}%`, animationDelay: `${barIndex * 0.03}s` }} />;
                            })}
                          </div>
                          <span className="text-xs font-semibold text-slate-600">{formatSeconds(voice.duration)}</span>
                        </div>
                        <audio id={audioId} src={voice.fileUrl} preload="metadata" playsInline />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => removeNoteAudio(n.id, idx)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">Delete</button>
                          <a href={voice.fileUrl} download={`voice-note-${voice.id}.webm`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-700 inline-flex items-center gap-1"><Download size={11} />Download</a>
                          <button type="button" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent('Voice note')}`, '_blank')} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 inline-flex items-center gap-1"><Share2 size={11} />Share</button>
                        </div>
                      </div>
                    );
                  })}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {isRecording && (
          <div className="fixed inset-0 z-50 bg-slate-900/70 p-4">
            <div className="mx-auto mt-16 w-full max-w-md rounded-2xl border border-rose-100 bg-white p-4 shadow-xl space-y-3">
              <p className="text-sm font-bold text-slate-800">Recording...</p>
              <div className="flex items-center justify-between text-sm font-semibold text-rose-700">
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />●</span>
                <span>{formatSeconds(recordingElapsedSeconds)}</span>
              </div>
              <div className="h-14 rounded-xl border border-rose-100 bg-rose-50/40 px-2">
                <canvas id="voice-recorder-wave" className="h-full w-full" aria-label="Recording waveform" />
                <div className="-mt-14 flex h-14 items-end gap-0.5">
                  {recordingWaveform.map((height, index) => <span key={`live-wave-${index}`} className="block flex-1 rounded-full bg-rose-400 transition-all" style={{ height: `${height}%` }} />)}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={toggleRecordingPause} className="h-11 rounded-xl border border-amber-200 bg-amber-50 text-xs font-bold text-amber-700">{isRecordingPaused ? 'Resume' : 'Pause'}</button>
                <button type="button" onClick={() => void toggleRecording()} className="h-11 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700">Stop</button>
                <button type="button" onClick={requestCancelRecording} className="h-11 rounded-xl border border-rose-200 bg-rose-50 text-xs font-bold text-rose-700">Cancel</button>
              </div>
              <p className="text-[11px] font-semibold text-slate-500">Max length: 05:00 • Max size: 10MB</p>
            </div>
          </div>
        )}

        {isDiscardConfirmOpen && (
          <div className="fixed inset-0 z-[60] bg-black/50 p-4">
            <div className="mx-auto mt-28 w-full max-w-sm rounded-2xl bg-white p-4 space-y-3">
              <p className="text-sm font-bold text-slate-800">Discard recording?</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={confirmDiscardRecording} className="h-10 rounded-xl border border-rose-200 bg-rose-50 text-xs font-bold text-rose-700">Discard</button>
                <button type="button" onClick={() => setIsDiscardConfirmOpen(false)} className="h-10 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700">Continue recording</button>
              </div>
            </div>
          </div>
        )}

        <div ref={partsListRef} className="space-y-3">
          <div className="rounded-[20px] border border-[#E7EAF3] bg-white p-4 shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-black text-gray-900 text-sm uppercase tracking-[0.16em]">Экран деталей заказа</h2>
                <p className="mt-2 text-[12px] font-semibold text-slate-500">Вынесли список деталей в отдельный экран: там удобнее открывать каждую деталь, выбирать несколько позиций и формировать общую картинку с ценами.</p>
              </div>
              <div className="rounded-2xl bg-blue-50 px-3 py-2 text-right">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-700">Детали</p>
                <p className="text-lg font-black text-blue-900">{order.parts.length}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowOnlyOpenParts((v) => !v)}
                className={`rounded-xl border px-3 py-2 text-[11px] font-bold transition-colors ${showOnlyOpenParts ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-500'}`}
              >
                {showOnlyOpenParts ? 'Только в поиске' : 'Все детали'}
              </button>
              <button
                type="button"
                onClick={() => navigate(`/order/${order.id}/parts`)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-[11px] font-black text-white"
              >
                Открыть экран деталей <ChevronRight size={14} />
              </button>
            </div>
            {order.parts.length > 0 && (
              <div className="mt-4 space-y-2">
                {order.parts.filter((part) => !showOnlyOpenParts || (!part.isFound && (part.variants || []).length === 0)).slice(0, 3).map((part) => {
                  const partDisplayName = getPartDisplayName(part);
                  const groupItems = normalizeGroupItems(part.groupItems);
                  const partQuantity = normalizePartQuantity(part.quantity);
                  return (
                    <button
                      key={part.id}
                      type="button"
                      onClick={() => navigate(`/order/${order.id}/part/${part.id}`)}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-left"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-900">{partDisplayName}</p>
                        <p className="mt-1 text-[11px] font-semibold text-slate-500">Qty: {partQuantity}{groupItems.length > 0 ? ` · ${groupItems.length} в группе` : ''}</p>
                      </div>
                      <ChevronRight size={16} className="shrink-0 text-slate-300" />
                    </button>
                  );
                })}
                {order.parts.length > 3 && <p className="px-1 text-[11px] font-semibold text-slate-400">И ещё {order.parts.length - 3} деталей на отдельном экране.</p>}
              </div>
            )}
            {order.parts.length === 0 && (
              <div className="mt-4 rounded-2xl border border-dashed border-gray-200 p-4 text-center">
                <p className="text-[16px] font-medium text-[#1E1F23]">No parts yet</p>
                <button type="button" onClick={() => partInputRef.current?.focus()} className="mt-2 px-3 py-2 rounded-[12px] bg-[#3B6AF7] text-white text-[13px] font-semibold active:scale-[0.97] transition-transform duration-200">Add first part</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-200 bg-white/95 backdrop-blur p-2.5 shadow-[0_-6px_16px_rgba(0,0,0,0.08)]">
        <button type="button" onClick={() => setIsBottomSummaryExpanded((prev) => !prev)} className="w-full rounded-xl bg-slate-50 px-3 py-2 text-left">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
            <span>Purchase {formatMoney(selectedOfferTotal)} · Margin {formatDualMoney(markupAed)} · Cargo {formatDualMoney(cargoTotalAed)} · Profit {netProfitAed === null ? '—' : formatDualMoney(netProfitAed)}</span>
            <ChevronUp size={14} className={`transition-transform ${isBottomSummaryExpanded ? '' : 'rotate-180'}`} />
          </div>
        </button>
        {isBottomSummaryExpanded && (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <div><p className="text-[10px] text-gray-400">Client price</p><p className="text-[13px] font-bold">{formatMoney(sellTotalAed, clientCurrency)}</p></div>
            <div><p className="text-[10px] text-gray-400">Profit</p><p className="text-[13px] font-bold text-emerald-600">{netProfitAed === null ? '—' : formatDualMoney(netProfitAed)}</p></div>
          </div>
        )}
        <div className="mt-2 grid gap-2 grid-cols-3">
          <button type="button" onClick={openClientChannel} className="h-10 rounded-xl bg-emerald-50 text-emerald-700 text-[10px] font-black">{contactActionLabel}</button>
          <button type="button" onClick={() => partInputRef.current?.focus()} className="h-10 rounded-xl bg-blue-600 text-white text-[10px] font-black">Добавить деталь</button>
          <button type="button" onClick={() => setIsEstimateOpen(true)} className="h-10 rounded-xl bg-gray-900 text-white text-[10px] font-black">Сформировать quote</button>
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
