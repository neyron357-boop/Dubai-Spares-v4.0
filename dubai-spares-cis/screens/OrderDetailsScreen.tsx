import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, OrderPricingEvent, Part, Priority, Source, OrderNote, Shop, VoiceNoteAudio } from '../types';
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
  Undo2,
  Check,
  Mic,
  Square,
  Play,
  Pause,
  FileAudio,
  Rocket,
  Share2,
  Download,
  History,
  Video,
  FolderOpen,
  ExternalLink,
  Search,
  ShieldCheck,
  Wallet,
  MessageCircle,
  Camera,
  Send,
  Minus,
  Upload,
  MapPin,
  Phone,
  ReceiptText
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
import { getOrderCustomerLogs } from '../customerEngagement';
import { analyzeAutoPartText, inferCargoPlacesFromAnalysis, isOversizedFromAnalysis } from '../utils/autoPartAi';
import { isLikelyGoogleDriveUrl, normalizeExternalMediaUrl, openExternalMediaUrl } from '../utils/externalMedia';
import { deriveSafetySalesSummary } from '../utils/safetySales';

type OrderDetailsTab = 'overview' | 'search' | 'proof' | 'finance' | 'notes';

const ORDER_DETAILS_TABS: Array<{ id: OrderDetailsTab; label: string; helper: string }> = [
  { id: 'overview', label: 'Overview', helper: 'Клиент, авто, статус' },
  { id: 'search', label: 'Search', helper: 'Детали и варианты' },
  { id: 'proof', label: 'Proof Pack', helper: 'Материалы и проверки' },
  { id: 'finance', label: 'Finance', helper: 'Маржа и логистика' },
  { id: 'notes', label: 'Notes', helper: 'Заметки и voice' }
];

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
const PAYMENT_STATUS_LABELS: Record<Order['paymentStatus'] extends infer T ? Extract<T, string> : never, string> = {
  none: 'Не оплачен',
  search_deposit_paid: 'Внесен депозит',
  full_prepayment_paid: 'Полная предоплата'
};
const LEAD_QUALITY_STYLES: Record<string, string> = {
  cold: 'border-slate-200 bg-slate-50 text-slate-700',
  warm: 'border-sky-200 bg-sky-50 text-sky-700',
  hot: 'border-orange-200 bg-orange-50 text-orange-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  risky: 'border-rose-200 bg-rose-50 text-rose-700'
};
const DEAL_RISK_STYLES: Record<string, string> = {
  safe: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  caution: 'border-amber-200 bg-amber-50 text-amber-700',
  high: 'border-orange-200 bg-orange-50 text-orange-700',
  refuse: 'border-rose-200 bg-rose-50 text-rose-700'
};
const STAGE_STATE_STYLES: Record<string, string> = {
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  current: 'border-blue-500 bg-blue-600 text-white',
  locked: 'border-slate-200 bg-slate-100 text-slate-400',
  upcoming: 'border-slate-200 bg-white text-slate-500'
};

const HERO_RISK_ACCENTS: Record<string, string> = {
  safe: 'text-emerald-700',
  caution: 'text-amber-700',
  high: 'text-orange-700',
  refuse: 'text-rose-700'
};

const PAYMENT_STATUS_SHORT: Record<Order['paymentStatus'] extends infer T ? Extract<T, string> : never, { label: string; tone: string }> = {
  none: { label: 'No payment', tone: 'bg-white/[0.14] text-white/[0.78] ring-white/[0.12]' },
  search_deposit_paid: { label: 'Deposit paid', tone: 'bg-amber-300/16 text-amber-100 ring-amber-200/24' },
  full_prepayment_paid: { label: 'Fully prepaid', tone: 'bg-emerald-300/16 text-emerald-100 ring-emerald-200/24' }
};

const STAGE_COPY: Record<string, { label: string; helper: string }> = {
  inquiry: { label: 'Intake', helper: 'Capture the request and keep the client warm.' },
  data_collection: { label: 'Data capture', helper: 'Lock VIN, vehicle media, delivery, and exact parts.' },
  preliminary_estimate: { label: 'Estimate', helper: 'Give a light range before committing market time.' },
  deposit_gate: { label: 'Deposit gate', helper: 'Ask for search deposit before active supplier work.' },
  active_search: { label: 'Live search', helper: 'Move through suppliers, media, prices, and variants.' },
  final_quote: { label: 'Final quote', helper: 'Send the clean offer and conditions.' },
  full_prepayment: { label: 'Prepayment', helper: 'Protect the deal before purchase.' },
  purchase: { label: 'Purchase', helper: 'Buy only after terms are protected.' },
  inspection: { label: 'Inspection', helper: 'Capture condition, markings, defects, and proof.' },
  packing: { label: 'Packing', helper: 'Record packing before cargo handover.' },
  cargo_handover: { label: 'Cargo handover', helper: 'Attach receipt and release risk cleanly.' },
  completed: { label: 'Closed', helper: 'The transaction is complete.' }
};

const READINESS_COPY: Record<string, string> = {
  vin: 'VIN',
  car_photo: 'Vehicle photo',
  part: 'Exact part',
  delivery: 'Delivery place',
  price: 'Confirmed price',
  terms: 'Terms sent',
  prepayment: 'Deposit/payment',
  cargo_risk: 'Cargo risk',
  proof_pack: 'Proof started'
};

const PROOF_COPY: Record<string, string> = {
  supplier_photos: 'Supplier photos',
  serial_marking: 'Serial / marking',
  defects: 'Defects',
  inspection_video: 'Inspection video',
  before_purchase: 'Before purchase',
  after_purchase: 'After purchase',
  packing: 'Packing',
  cargo_handover: 'Cargo receipt',
  condition_comment: 'Condition note'
};

const MARKET_REGION_LABELS: Record<string, string> = {
  china: 'Китай',
  japan: 'Япония',
  usa: 'США',
  europe: 'Европа',
  gcc: 'GCC',
  other: 'Другое'
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
  const { orders, isLoading, updateOrder, deleteOrder, removePart, suppliers, fetchOrderDetails } = useStore();
  const { settings } = useAppSettings();
  const foundOrder = orders.find(o => o.id === id);
  const orderMissing = !foundOrder;
  const order = foundOrder ?? ({
    id: id || '',
    brand: '',
    model: '',
    year: '',
    vin: '',
    priority: Priority.MEDIUM,
    clientName: '',
    source: Source.OTHER,
    parts: [],
    markupPercent: 0,
    exchangeRate: 3.67,
    createdAt: Date.now(),
    isArchived: false,
    isSold: false
  } satisfies Order);
  
  // State for handling missing order
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const [activeTab, setActiveTab] = useState<OrderDetailsTab>('overview');
  const [isEstimateOpen, setIsEstimateOpen] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number; partId?: string } | null>(null);
  const [deletePartId, setDeletePartId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNotePhotos, setNewNotePhotos] = useState<string[]>([]);
  const [newNoteAudios, setNewNoteAudios] = useState<Array<string | VoiceNoteAudio>>([]);
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
  const [partMediaLinkDrafts, setPartMediaLinkDrafts] = useState<Record<string, string>>({});
  const [partCommentExpanded, setPartCommentExpanded] = useState<Record<string, boolean>>({});
  const [isAiFillingCargo, setIsAiFillingCargo] = useState(false);
  const [aiCargoNotice, setAiCargoNotice] = useState<string | null>(null);
  // Multiple photos for new part
  const [newPartPhotos, setNewPartPhotos] = useState<string[]>([]);
  const partFileRef = useRef<HTMLInputElement>(null);
  const partInputRef = useRef<HTMLInputElement>(null);
  const partsListRef = useRef<HTMLDivElement>(null);
  const vehicleSectionRef = useRef<HTMLDivElement>(null);
  const markupSectionRef = useRef<HTMLDivElement>(null);
  const addPartSectionRef = useRef<HTMLDivElement>(null);
  const notesSectionRef = useRef<HTMLDivElement>(null);
  const detailsScreenSectionRef = useRef<HTMLDivElement>(null);
  const [showOnlyOpenParts, setShowOnlyOpenParts] = useState(false);

  // Exchange Rate Input State (Controlled)
  const [rateInput, setRateInput] = useState(order ? order.exchangeRate.toString() : '3.67');
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [isLaunchingRadar, setIsLaunchingRadar] = useState(false);
  const [isEditMode, setIsEditMode] = useState(true);
  const [isClientBlockExpanded, setIsClientBlockExpanded] = useState(false);
  const [isVehicleBlockExpanded, setIsVehicleBlockExpanded] = useState(false);
  const [isVehicleDetailsExpanded, setIsVehicleDetailsExpanded] = useState(false);
  const [isPricingCargoExpanded, setIsPricingCargoExpanded] = useState(true);
  const [expandedCargoPartIds, setExpandedCargoPartIds] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [deleteOrderConfirmOpen, setDeleteOrderConfirmOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [markupFixedInput, setMarkupFixedInput] = useState(order?.markupFixedAed?.toString() || '0');
  const [orderMediaFolderDraft, setOrderMediaFolderDraft] = useState(order?.googleDriveFolderUrl || '');
  const [showCustomerLogs, setShowCustomerLogs] = useState(false);
  const [customerLogs, setCustomerLogs] = useState(() => getOrderCustomerLogs(order?.id || ''));

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
    if (orderMissing) return;
    setLogisticsDraft({
      deliveryAed: String(Number(order.logistics?.deliveryAed || 0)),
      packingAed: String(Number(order.logistics?.packingAed || 0)),
      serviceFeeAed: String(Number(order.logistics?.serviceFeeAed || 0))
    });
  }, [orderMissing, order.id, order.logistics?.deliveryAed, order.logistics?.packingAed, order.logistics?.serviceFeeAed]);
  useEffect(() => {
    if (orderMissing || !order.id) return;
    setCustomerLogs(getOrderCustomerLogs(order.id));
    const handleLogsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ orderId?: string }>).detail;
      if (!detail?.orderId || detail.orderId === order.id) setCustomerLogs(getOrderCustomerLogs(order.id));
    };
    window.addEventListener('customer-logs:changed', handleLogsChanged);
    return () => window.removeEventListener('customer-logs:changed', handleLogsChanged);
  }, [orderMissing, order.id]);


  useEffect(() => {
    if (orderMissing) return;
    const nextDrafts = (order.parts || []).reduce((acc, part) => {
      acc[part.id] = part.comment || '';
      return acc;
    }, {} as Record<string, string>);
    setPartCommentDrafts(nextDrafts);
  }, [orderMissing, order.id, order.parts]);

  useEffect(() => {
    if (orderMissing) return;
    const nextDrafts = (order.parts || []).reduce((acc, part) => {
      acc[part.id] = String((part as any).googleDriveVideoUrl || '');
      return acc;
    }, {} as Record<string, string>);
    setPartMediaLinkDrafts(nextDrafts);
  }, [orderMissing, order.id, order.parts]);

  useEffect(() => {
    if (orderMissing) return;
    setOrderMediaFolderDraft(order.googleDriveFolderUrl || '');
  }, [orderMissing, order.id, order.googleDriveFolderUrl]);

  useEffect(() => {
    if (orderMissing) return;
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
  }, [orderMissing, order.id, order.parts]);

  useEffect(() => {
    if (orderMissing) return;
    setPartCommentExpanded({});
  }, [orderMissing, order.id]);

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
    if (orderMissing) return;
    if (order.leadSource === 'public_form' && order.leadUnread) {
      updateOrder({ ...order, leadUnread: false, leadReadAt: Date.now() });
    }
  }, [orderMissing, order.id, order.leadSource, order.leadUnread]);


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
    if (!id || !orderMissing || isLoading || isRetrying || retryAttempts >= MAX_RETRY_ATTEMPTS) return;
    
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
  }, [id, orderMissing, isLoading, isRetrying, retryAttempts, fetchOrderDetails]);

  if (orderMissing && isLoading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-10 bg-gray-200 rounded-2xl" />
        <div className="h-24 bg-gray-200 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  const shareQuote = async (options?: { rates: QuoteRates; currency: QuoteCurrency; sendPublicQuote?: boolean }) => {
    if (orderMissing) return;
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
    if (options?.sendPublicQuote === false) {
      return;
    }
    await shareQuoteLink(quoteOrder, options);
  };

  if (orderMissing) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center space-y-4 p-4">
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
            onClick={() => navigate(backTo)}
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
  const effectiveMarkupPercent = Number(draftFields.markupPercent ?? order.markupPercent ?? 0);
  const markupAed = useMemo(() => (markupType === 'fixed'
    ? Number(markupFixedInput || 0)
    : selectedOfferTotal * (effectiveMarkupPercent / 100)), [markupType, markupFixedInput, selectedOfferTotal, effectiveMarkupPercent]);
  const sellTotalAed = selectedOfferTotal + logisticsWithCargoTotal + markupAed;
  const canComputeProfit = selectedOfferTotal > 0;
  const baseMarginAed = canComputeProfit ? selectedOfferTotals.sale - selectedOfferTotals.purchase : 0;
  const netProfitAed = canComputeProfit ? baseMarginAed + markupAed : null;
  const marginPercent = canComputeProfit && netProfitAed !== null && sellTotalAed > 0 ? (netProfitAed / sellTotalAed) * 100 : null;
  const isMarkupMissing = canComputeProfit && markupAed <= 0;
  const lowMargin = canComputeProfit && selectedOfferTotal > 0 && markupAed > 0 && markupAed / selectedOfferTotal < 0.03;
  const isLoss = canComputeProfit && sellTotalAed < selectedOfferTotal + logisticsWithCargoTotal;
  const safetySummary = useMemo(() => deriveSafetySalesSummary({
    ...order,
    logistics: {
      ...order.logistics,
      deliveryAed: logistics.deliveryAed,
      packingAed: logistics.packingAed,
      serviceFeeAed: logistics.serviceFeeAed
    },
    markupFixedAed: (order.markupType || 'percent') === 'fixed' ? Number(markupFixedInput || 0) : order.markupFixedAed
  }), [logistics.deliveryAed, logistics.packingAed, logistics.serviceFeeAed, markupFixedInput, order]);
  const depositPaid = order.searchDepositStatus === 'paid' || order.paymentStatus === 'search_deposit_paid' || order.paymentStatus === 'full_prepayment_paid';
  const fullPrepaymentPaid = order.paymentStatus === 'full_prepayment_paid' || order.salesStatus === 'Paid';
  const safetyProgressText = `${safetySummary.readiness.completed}/${safetySummary.readiness.total}`;

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
    const previousOrderStatus = order.status;
    updateOrder({
      ...order,
      customerStatus: nextStatus === 'Lead' ? 'LEAD' : nextStatus === 'Inquiry' ? 'INQUIRY' : 'VIP',
      isVip: nextStatus === 'VIP',
      isLead: nextStatus === 'Lead',
      status: nextStatus === 'Lead' ? 'lead' : (order.status === 'lead' ? 'active' : order.status),
      leadUnread: nextStatus === 'Lead' ? order.leadUnread : false,
      leadReadAt: nextStatus === 'Lead' ? order.leadReadAt : Date.now(),
      statusChangedAt: Date.now(),
      statusChangedBy: 'current-user'
    });
    setToast({
      message: 'Статус обновлён ✅',
      undo: () => updateOrder({
        ...order,
        customerStatus: prevStatus === 'Lead' ? 'LEAD' : prevStatus === 'Inquiry' ? 'INQUIRY' : 'VIP',
        isVip: prevStatus === 'VIP',
        isLead: prevStatus === 'Lead',
        status: previousOrderStatus,
        leadUnread: order.leadUnread,
        leadReadAt: order.leadReadAt
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
      && !['markupPercent', 'markupType', 'markupFixedAed', 'clientCurrency', 'salesStatus', 'priority', 'deliveryType', 'socialNickname'].includes(String(field));

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

  const checkGoogleDriveLink = useCallback((rawUrl: string, emptyMessage: string) => {
    const url = normalizeExternalMediaUrl(rawUrl);
    if (!url) {
      setToast({ message: emptyMessage });
      return false;
    }
    if (!isLikelyGoogleDriveUrl(url)) {
      setToast({ message: 'Нужна ссылка Google Drive: drive.google.com или docs.google.com' });
      return false;
    }
    openExternalMediaUrl(url);
    setToast({ message: 'Ссылка открыта. Проверьте доступ: Anyone with the link can view' });
    return true;
  }, []);

  const saveOrderMediaFolder = useCallback((rawValue = orderMediaFolderDraft, options?: { showToast?: boolean }) => {
    if (!isEditMode) return String(rawValue || '').trim();
    const currentOrder = orderRef.current;
    if (!currentOrder) return String(rawValue || '').trim();
    const nextValue = String(rawValue || '').trim();
    const currentValue = String(currentOrder.googleDriveFolderUrl || '').trim();
    if (nextValue !== currentValue) {
      void updateOrder({ ...currentOrder, googleDriveFolderUrl: nextValue });
      if (options?.showToast) setToast({ message: nextValue ? 'Папка заказа сохранена' : 'Папка заказа очищена' });
    }
    return nextValue;
  }, [isEditMode, orderMediaFolderDraft, updateOrder]);

  const savePartMediaLink = useCallback((partId: string, rawValue?: string, options?: { showToast?: boolean }) => {
    const nextValue = String(rawValue ?? partMediaLinkDrafts[partId] ?? '').trim();
    if (!isEditMode) return nextValue;
    const currentOrder = orderRef.current;
    if (!currentOrder) return nextValue;
    const currentPart = (currentOrder.parts || []).find((item) => item.id === partId);
    const currentValue = String((currentPart as any)?.googleDriveVideoUrl || '').trim();
    if (currentPart && nextValue !== currentValue) {
      const updatedParts = currentOrder.parts.map((item) => (
        item.id === partId ? { ...item, googleDriveVideoUrl: nextValue } : item
      ));
      void updateOrder({ ...currentOrder, parts: updatedParts });
      if (options?.showToast) setToast({ message: nextValue ? 'Media link сохранён' : 'Media link очищен' });
    }
    return nextValue;
  }, [isEditMode, partMediaLinkDrafts, updateOrder]);

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

  const runAiCargoAssist = useCallback(async () => {
    if (!isEditMode || !order.parts.length || isAiFillingCargo) return;
    setIsAiFillingCargo(true);
    setAiCargoNotice(null);
    try {
      const analyses = await Promise.all(order.parts.map(async (part) => ({
        part,
        analysis: await analyzeAutoPartText(part.name),
      })));

      let updatedCount = 0;
      const nextDrafts: Record<string, PartCargoDraft> = {};
      const nextParts = order.parts.map((part) => {
        const analysis = analyses.find((item) => item.part.id === part.id)?.analysis;
        if (!analysis) return part;

        const nextWeight = Number(part.weightKg || 0) > 0 ? Number(part.weightKg || 0) : Number(analysis.estimatedWeightKg || 0);
        const nextPlaces = Number(part.places || 0) >= 1 ? Number(part.places || 0) : inferCargoPlacesFromAnalysis(analysis);
        const nextOversized = Boolean(part.isOversized) || isOversizedFromAnalysis(analysis);
        const nextCategory = String(part.partType || analysis.category || '').trim();
        const translatedName = analysis.translated || part.translatedName || '';
        const translatedNameRu = analysis.translatedRu || part.translatedNameRu || '';

        nextDrafts[part.id] = {
          weightKg: nextWeight > 0 ? String(nextWeight) : '',
          places: nextPlaces >= 1 ? String(nextPlaces) : '',
          cargoPlaceGroup: String(part.cargoPlaceGroup || ''),
          isOversized: nextOversized,
        };

        const hasChanges = (
          nextWeight !== Number(part.weightKg || 0)
          || nextPlaces !== Number(part.places || 0)
          || nextOversized !== Boolean(part.isOversized)
          || nextCategory !== String(part.partType || '')
          || translatedName !== String(part.translatedName || '')
          || translatedNameRu !== String(part.translatedNameRu || '')
        );

        if (hasChanges) updatedCount += 1;

        return {
          ...part,
          weightKg: nextWeight > 0 ? nextWeight : part.weightKg,
          places: nextPlaces >= 1 ? nextPlaces : part.places,
          isOversized: nextOversized,
          partType: nextCategory || part.partType,
          translatedName: translatedName || part.translatedName,
          translatedNameRu: translatedNameRu || part.translatedNameRu,
        };
      });

      setPartCargoDrafts((prev) => ({ ...prev, ...nextDrafts }));

      if (updatedCount > 0) {
        const nextCargo = calculateCargo({ ...order, parts: nextParts }, settings);
        const nextEstimates = calculateCargoEstimates({ ...order, parts: nextParts }, settings);
        updateOrder({
          ...order,
          parts: nextParts,
          logistics: {
            ...order.logistics,
            cargoEtaDays: nextCargo.eta,
            cargoTotalWeightKg: nextCargo.realWeight,
            cargoChargeableWeightKg: nextCargo.chargeableWeight,
            cargoTotalPlaces: nextCargo.totalPlaces,
            cargoBaseCostUsd: nextCargo.baseCostUsd,
            cargoTotalCostUsd: nextCargo.totalCostUsd,
            cargoAirEtaDays: nextEstimates.air.eta,
            cargoAirCostUsd: nextEstimates.air.totalCostUsd,
            cargoContainerEtaDays: nextEstimates.container.eta,
            cargoContainerCostUsd: nextEstimates.container.totalCostUsd,
          }
        });
      }

      setAiCargoNotice(updatedCount > 0 ? `AI заполнил параметры для ${updatedCount} деталей.` : 'AI не нашёл новых данных, оставили текущие значения.');
    } catch (error) {
      console.error(error);
      setAiCargoNotice('AI-помощник сейчас недоступен. Текущие значения сохранены.');
    } finally {
      setIsAiFillingCargo(false);
    }
  }, [isAiFillingCargo, isEditMode, order, settings, updateOrder]);

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

  const confirmDeleteOrder = async () => {
    const ok = await deleteOrder(order.id);
    if (ok) {
      setDeleteOrderConfirmOpen(false);
      navigate('/orders');
      return;
    }
    setToast({ message: 'Не удалось удалить заказ' });
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
    const capturedPartName = newPartName.trim();
    const parsedGroupItems = newPartKind === 'group' ? normalizeGroupItems(newPartGroupItems) : [];
    const newPart: Part = {
      id: Math.random().toString(36).substr(2, 9),
      name: capturedPartName,
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
    setToast({ message: `Added ${capturedPartName}` });
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

  const quickNavItems: Array<{ label: string; ref: React.RefObject<HTMLDivElement | null> }> = [
    { label: 'Клиент', ref: detailsScreenSectionRef },
    { label: 'Автомобиль', ref: vehicleSectionRef },
    { label: 'Запчасти', ref: partsListRef },
    { label: 'Добавить деталь', ref: addPartSectionRef },
    { label: 'Расчёт', ref: markupSectionRef },
    { label: 'Заметки', ref: notesSectionRef }
  ];

  const scrollToSection = (targetRef: React.RefObject<HTMLDivElement | null>) => {
    targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const heroPhoto = (order.carPhotos && order.carPhotos[0]) || order.carPhotoUrl || '';
  const heroCarName = [order.brand, order.model, order.year].filter(Boolean).join(' ') || 'Автомобиль не указан';
  const heroMarketRegion = order.vehicleDetails?.marketRegion
    ? (MARKET_REGION_LABELS[order.vehicleDetails.marketRegion] || order.vehicleDetails.marketRegion.toUpperCase())
    : 'Market не указан';
  const heroCurrentStage = safetySummary.stages.find((stage) => stage.state === 'current') || safetySummary.stages[0];
  const heroRiskAccent = HERO_RISK_ACCENTS[safetySummary.dealRisk.level] || 'text-slate-800';
  const heroPrimaryAction = (() => {
    if (!order.vin || !heroPhoto) {
      return {
        label: 'Заполнить данные',
        helper: 'VIN и фото авто',
        onClick: () => {
          setActiveTab('overview');
          scrollToSection(vehicleSectionRef);
        }
      };
    }

    if (!depositPaid) {
      return {
        label: 'Запросить депозит',
        helper: 'Безопасный старт поиска',
        onClick: () => void copyText(safetySummary.paymentExplanation, 'Текст для депозита скопирован')
      };
    }

    if (selectedOfferTotal <= 0) {
      return {
        label: 'Начать поиск',
        helper: `${foundPartsCount}/${partsCount || 0} деталей найдено`,
        onClick: () => setActiveTab('search')
      };
    }

    if (!fullPrepaymentPaid) {
      return {
        label: 'Отправить смету',
        helper: 'Зафиксировать условия',
        onClick: () => setIsEstimateOpen(true)
      };
    }

    return {
      label: 'Собрать proof pack',
      helper: `${safetySummary.proofPack.completed}/${safetySummary.proofPack.total} готово`,
      onClick: () => setActiveTab('proof')
    };
  })();

  const stageIndex = Math.max(0, safetySummary.stages.findIndex((stage) => stage.id === heroCurrentStage?.id));
  const stageProgress = Math.round(((stageIndex + 1) / Math.max(1, safetySummary.stages.length)) * 100);
  const stageCopy = STAGE_COPY[heroCurrentStage?.id || safetySummary.currentStage] || STAGE_COPY.inquiry;
  const paymentCopy = PAYMENT_STATUS_SHORT[order.paymentStatus || 'none'] || PAYMENT_STATUS_SHORT.none;
  const openPartsCount = order.parts.filter((part) => !(part.isFound || (part.variants || []).length > 0)).length;
  const pricedPartsCount = order.parts.filter((part) => (part.variants || []).some((variant) => Number(variant.salePriceAed ?? variant.priceAed) > 0)).length;
  const readinessMissing = safetySummary.readiness.items.filter((item) => !item.done).slice(0, 5);
  const criticalReadinessMissing = safetySummary.readiness.items.filter((item) => item.critical && !item.done).slice(0, 4);
  const proofMissing = safetySummary.proofPack.items.filter((item) => !item.done).slice(0, 5);
  const criticalProofMissing = safetySummary.proofPack.items.filter((item) => item.critical && !item.done).slice(0, 4);
  const evidencePhotos = Array.from(new Set([
    ...getCarPhotos(),
    ...order.parts.flatMap((part) => [
      part.photoUrl || '',
      ...(part.photos || []),
      ...(part.variants || []).flatMap((variant) => [variant.photoUrl || '', ...(variant.photos || [])])
    ]),
    ...(order.notes || []).flatMap((note) => note.photos || [])
  ].filter(Boolean))) as string[];
  const partQueue = showOnlyOpenParts
    ? order.parts.filter((part) => !(part.isFound || (part.variants || []).length > 0))
    : order.parts;
  const nextActionCopy = (() => {
    if (!order.vin || !heroPhoto) return { label: 'Complete identity', helper: 'VIN and vehicle photo unlock the flow.' };
    if (!depositPaid) return { label: 'Подтверждение депозита', helper: 'До подтверждения депозита поиск и варианты недоступны.' };
    if (selectedOfferTotal <= 0) return { label: 'Start sourcing', helper: `${openPartsCount}/${partsCount || 0} parts still open.` };
    if (!fullPrepaymentPaid) return { label: 'Send quote', helper: 'Move from sourcing to client decision.' };
    return { label: 'Capture proof', helper: `${safetySummary.proofPack.completed}/${safetySummary.proofPack.total} proof points ready.` };
  })();
  const riskCopy: Record<string, { label: string; tone: string; line: string }> = {
    safe: { label: 'Calm', tone: 'text-emerald-700 bg-emerald-50', line: 'Normal transaction rhythm.' },
    caution: { label: 'Watch', tone: 'text-amber-700 bg-amber-50', line: 'Proceed, but keep terms written.' },
    high: { label: 'Hold', tone: 'text-orange-700 bg-orange-50', line: 'Do not buy without payment protection.' },
    refuse: { label: 'Decline', tone: 'text-rose-700 bg-rose-50', line: 'Terms are not worth the risk.' }
  };
  const currentRiskCopy = riskCopy[safetySummary.dealRisk.level] || riskCopy.safe;
  const profitTone = safetySummary.profit.level === 'healthy'
    ? 'text-emerald-700 bg-emerald-50'
    : safetySummary.profit.level === 'unknown'
      ? 'text-stone-600 bg-stone-100'
      : 'text-rose-700 bg-rose-50';
  const shownNetProfit = canComputeProfit && netProfitAed !== null ? netProfitAed : safetySummary.profit.netProfitAed;
  const heroPhotoCount = getCarPhotos().length;
  const latestNote = (order.notes || [])[0];
  const firstRecommendedShop = recommendedShops[0];

  return (
      <div className="min-h-full bg-[#07080A] pb-0 pt-[58px] text-white">
        <div className="fixed left-1/2 top-0 z-40 w-full max-w-md -translate-x-1/2 border-b border-white/10 bg-[#08090B]/92 px-3 py-2 backdrop-blur-xl">
          <div className="flex h-10 items-center justify-between gap-2">
            <button type="button" onClick={handleBackNavigation} className="ds-press flex h-10 w-10 items-center justify-center rounded-full text-white/[0.78] active:bg-white/10" aria-label="Back">
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-[13px] font-black text-white">{heroCarName}</p>
              <p className="truncate text-[10px] font-semibold tracking-[0.08em] text-white/[0.42]">{stageCopy.label} · {order.id.slice(0, 8)}</p>
            </div>
            <div className="relative flex h-10 w-10 items-center justify-center">
              <button type="button" onClick={() => setShowActionsMenu((value) => !value)} className="ds-press flex h-10 w-10 items-center justify-center rounded-full text-white/[0.72] active:bg-white/10" aria-label="Actions">
                <MoreVertical size={18} />
              </button>
              {showActionsMenu && (
                <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#15171D] p-1 text-xs font-bold text-white shadow-2xl">
                  <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/10" onClick={() => setIsEditMode((prev) => !prev)}><FileText size={14} /> {isEditMode ? 'Завершить редактирование' : 'Редактировать заказ'}</button>
                  <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/10" onClick={() => setIsEstimateOpen(true)}><Share2 size={14} /> Смета / экспорт</button>
                  <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/10" onClick={() => updateOrderField('isArchived', !order.isArchived)}><Package size={14} /> {order.isArchived ? 'Unarchive' : 'Archive'}</button>
                  <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-rose-200 hover:bg-rose-500/10" onClick={() => { setShowActionsMenu(false); setDeleteOrderConfirmOpen(true); }}><X size={14} /> Delete</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <section ref={detailsScreenSectionRef} className="px-3 pb-4 pt-3">
          <div className="ds-deep-surface relative overflow-hidden rounded-[32px] bg-[#111318]">
            <div className="absolute inset-x-10 top-8 h-32 rounded-full bg-amber-300/10 blur-3xl" />
            <div className="relative min-h-[300px]">
              {heroPhoto ? (
                <button
                  type="button"
                  onClick={() => {
                    const photos = getCarPhotos();
                    if (photos.length) setGallery({ images: photos, index: 0 });
                  }}
                  className="absolute inset-0 h-full w-full"
                  aria-label="Open vehicle gallery"
                >
                  <img src={heroPhoto} alt={heroCarName} className="h-full w-full object-cover opacity-88 transition duration-500" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => carFileRef.current?.click()}
                  className="absolute inset-0 h-full w-full overflow-hidden bg-[#101217]"
                  aria-label="Add vehicle photo"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(245,158,11,0.15),transparent_36%)]" />
                  <div className="absolute bottom-11 left-7 h-20 w-[80%] rounded-[999px] border border-white/10 bg-white/[0.025] shadow-[inset_0_0_34px_rgba(255,255,255,0.04)]" />
                  <div className="absolute bottom-[88px] left-12 h-px w-[62%] bg-gradient-to-r from-transparent via-white/[0.18] to-transparent" />
                  <div className="absolute right-8 top-24 flex h-36 w-36 items-center justify-center rounded-full border border-white/10 bg-white/[0.02] text-7xl font-black text-white/[0.075]">
                    {order.brand?.[0] || '?'}
                  </div>
                </button>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#08090B] via-[#08090B]/[0.42] to-black/[0.12]" />
              <div className="relative flex min-h-[300px] flex-col justify-between p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="inline-flex items-center gap-2 rounded-full bg-black/[0.28] px-3 py-2 text-[11px] font-semibold text-white/70 ring-1 ring-white/10 backdrop-blur">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.8)]" />
                    Live order
                  </div>
                  <button type="button" onClick={() => carFileRef.current?.click()} className="ds-press inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-3 text-[11px] font-black text-white ring-1 ring-white/[0.12] backdrop-blur">
                    {heroPhoto ? <Camera size={14} /> : <Upload size={14} />}
                    {heroPhoto ? `${heroPhotoCount} photo${heroPhotoCount === 1 ? '' : 's'}` : 'Add photo'}
                  </button>
                  <input type="file" ref={carFileRef} onChange={handleCarPhotoChange} className="hidden" accept="image/*" multiple />
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-black text-white ring-1 ring-white/10">{stageCopy.label}</span>
                      <span className={`rounded-full px-3 py-1.5 text-[11px] font-black ring-1 ${paymentCopy.tone}`}>{paymentCopy.label}</span>
                    </div>
                    <h1 className="max-w-[16rem] text-[30px] font-black leading-[0.94] tracking-normal text-white">{heroCarName}</h1>
                    <p className="mt-3 max-w-[18rem] truncate text-[12px] font-semibold tracking-[0.08em] text-white/[0.62]">VIN {order.vin || 'not set'}</p>
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-black/[0.28] p-3 backdrop-blur-xl">
                    <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/[0.12]">
                      <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-white to-emerald-300 transition-all duration-500" style={{ width: `${stageProgress}%` }} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold leading-5 text-white/[0.62]">{nextActionCopy.helper}</p>
                      </div>
                      <button type="button" onClick={heroPrimaryAction.onClick} className="ds-press inline-flex h-12 shrink-0 items-center gap-2 rounded-[20px] bg-[#F7F3EA] px-4 text-[12px] font-black text-[#101114] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_14px_28px_rgba(0,0,0,0.26)]">
                        {nextActionCopy.label}
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {toast && (
          <div className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-[#111318] px-4 py-3 text-xs font-black text-white shadow-2xl">
            <Check size={14} /> {toast.message}
            {toast.undo && (
              <button type="button" onClick={() => { toast.undo?.(); setToast(null); }} className="inline-flex items-center gap-1 text-amber-200">
                <Undo2 size={12} /> Undo
              </button>
            )}
          </div>
        )}

        <nav className="sticky top-[58px] z-30 bg-[#08090B]/92 px-3 py-2 backdrop-blur-xl" aria-label="Order details sections">
          <div className="grid grid-cols-5 gap-1 rounded-[28px] border border-white/10 bg-white/[0.045] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            {ORDER_DETAILS_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.id === 'overview' ? FileText : tab.id === 'search' ? Search : tab.id === 'proof' ? ShieldCheck : tab.id === 'finance' ? Wallet : MessageCircle;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`ds-press flex h-11 flex-col items-center justify-center gap-1 rounded-[24px] text-[10px] font-black ${isActive ? 'bg-[#F4F1EA] text-[#111318] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_5px_14px_rgba(0,0,0,0.2)]' : 'text-white/[0.48]'}`}
                  aria-pressed={isActive}
                >
                  <Icon size={15} />
                  <span className="max-w-full truncate px-1">{tab.label === 'Proof Pack' ? 'Proof' : tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-h-[52dvh] rounded-t-[30px] bg-[#F4F1EA] px-4 pb-8 pt-6 text-[#171717] shadow-[0_-18px_60px_rgba(0,0,0,0.28)]">
          {activeTab === 'overview' && (
            <div className="ds-mode-enter space-y-7">
              <section className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[26px] font-black leading-tight tracking-normal text-stone-950">{stageCopy.label}</h2>
                    <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">{stageCopy.helper}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-2 text-[11px] font-black ${currentRiskCopy.tone}`}>{currentRiskCopy.label}</span>
                </div>

                <div className="ds-deep-surface rounded-[26px] bg-[#171717] p-4 text-white">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-lg font-black leading-tight">{nextActionCopy.label}</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-white/[0.58]">{nextActionCopy.helper}</p>
                    </div>
                    <button type="button" onClick={heroPrimaryAction.onClick} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] bg-amber-300 text-stone-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_12px_24px_rgba(245,158,11,0.22)]" aria-label={nextActionCopy.label}>
                      <ChevronRight size={21} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="ds-surface rounded-[22px] p-4">
                    <p className="text-2xl font-black text-stone-950">{criticalReadinessMissing.length}</p>
                    <p className="mt-0.5 text-[11px] font-black text-stone-400">missing</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-stone-500">{criticalReadinessMissing[0] ? `${READINESS_COPY[criticalReadinessMissing[0].id] || 'Step'} is next` : 'Core data is ready'}</p>
                  </div>
                  <div className="ds-surface rounded-[22px] p-4">
                    <p className="text-lg font-black text-stone-950">{shownNetProfit !== null ? formatDualMoney(shownNetProfit) : 'Unknown'}</p>
                    <p className="mt-1 text-[11px] font-black text-stone-400">profit</p>
                    <p className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${profitTone}`}>{safetySummary.profit.level === 'healthy' ? 'Protected' : safetySummary.profit.level === 'unknown' ? 'Needs price' : 'Needs work'}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] font-black text-stone-600">Needs attention</p>
                    <span className="text-[11px] font-black text-stone-500">{safetySummary.readiness.percent}% ready</span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {(readinessMissing.length ? readinessMissing : safetySummary.readiness.items.slice(0, 3)).map((item) => (
                      <span key={item.id} className={`shrink-0 rounded-full px-3 py-2 text-[11px] font-black ${item.done ? 'bg-emerald-50 text-emerald-700' : item.critical ? 'bg-stone-950 text-white' : 'bg-white/[0.72] text-stone-500'}`}>
                        {item.done ? <Check size={12} className="mr-1 inline" /> : null}{READINESS_COPY[item.id] || item.id}
                      </span>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <button type="button" onClick={() => setIsClientBlockExpanded((prev) => !prev)} className="ds-press flex w-full items-center justify-between gap-3 py-2 text-left">
                  <span>
                    <span className="block text-[12px] font-black text-stone-500">Client</span>
                    <span className="mt-1 block text-base font-black text-stone-950">{String(draftFields.clientName ?? order.clientName ?? 'Unnamed client')}</span>
                  </span>
                  {isClientBlockExpanded ? <ChevronUp size={17} className="text-stone-500" /> : <ChevronDown size={17} className="text-stone-500" />}
                </button>
                {isClientBlockExpanded && (
                  <div className="ds-surface space-y-3 rounded-[24px] p-4">
                    <div className="grid grid-cols-1 gap-3">
                      <label className="space-y-1">
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-stone-400"><User size={12} /> Client</span>
                        <input type="text" value={String(draftFields.clientName ?? order.clientName ?? '')} readOnly={!isEditMode} onChange={(e) => updateOrderField('clientName', e.target.value)} onBlur={() => flushDeferredOrderField('clientName')} placeholder="Client name" className="ds-input h-12 w-full rounded-2xl border-0 px-4 text-sm font-black text-stone-950 outline-none" />
                      </label>
                      <label className="space-y-1">
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-stone-400"><Smartphone size={12} /> Phone</span>
                        <div className="flex gap-2">
                          <input type="tel" value={String(draftFields.customerContact ?? order.customerContact ?? '')} readOnly={!isEditMode} onChange={(e) => updateOrderField('customerContact', e.target.value)} onBlur={() => flushDeferredOrderField('customerContact')} placeholder="+971..." className="ds-input h-12 min-w-0 flex-1 rounded-2xl border-0 px-4 text-sm font-black text-stone-950 outline-none" />
                          <button type="button" onClick={() => void copyText(order.customerContact || '', 'Phone copied')} disabled={!order.customerContact} className="ds-press flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-950 text-white disabled:opacity-35" aria-label="Copy phone"><Copy size={16} /></button>
                        </div>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select value={String(draftFields.source ?? order.source)} onChange={(e) => updateOrderField('source', e.target.value)} disabled={!isEditMode} className="ds-input h-12 rounded-2xl border-0 px-3 text-xs font-black text-stone-800 outline-none">
                        {SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
                      </select>
                      <select value={normalizedSelectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)} disabled={!isEditMode} className="ds-input h-12 rounded-2xl border-0 px-3 text-xs font-black text-stone-800 outline-none">
                        {messageTemplates.map((template) => <option key={template} value={template}>{template}</option>)}
                      </select>
                    </div>
                    {(sourceLabel.includes('instagram') || sourceLabel.includes('tiktok') || sourceLabel.includes('telegram')) && (
                      <div className="ds-input flex items-center justify-between gap-2 rounded-2xl px-3 py-2">
                        <span className="min-w-0 truncate text-xs font-bold text-stone-500">{(draftFields.socialNickname ?? order.socialNickname ?? '') ? 'Social link saved' : 'No social link'}</span>
                        <button type="button" onClick={saveSocialNickname} className="rounded-full bg-white px-3 py-2 text-[11px] font-black text-stone-800">{(draftFields.socialNickname ?? order.socialNickname ?? '') ? 'Change' : 'Add'}</button>
                      </div>
                    )}
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <button type="button" onClick={openClientChannel} disabled={!getClientChannelLink() && (!(order.customerContact || '').replace(/[^\d]/g, '').length || (order.customerContact || '').replace(/[^\d]/g, '').length < 8)} className="ds-press inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-xs font-black uppercase tracking-[0.08em] text-white disabled:opacity-40">
                        <MessageCircle size={16} /> {contactActionLabel}
                      </button>
                      <button type="button" onClick={() => setShowCustomerLogs(true)} className="ds-press inline-flex h-12 items-center justify-center rounded-2xl bg-stone-100 px-4 text-stone-700" aria-label="Customer logs"><History size={17} /></button>
                    </div>
                  </div>
                )}
              </section>

              <section ref={vehicleSectionRef} className="space-y-3">
                <button type="button" onClick={() => setIsVehicleDetailsExpanded((prev) => !prev)} className="ds-press flex w-full items-center justify-between gap-3 py-2 text-left">
                  <span>
                    <span className="block text-[12px] font-black text-stone-500">Vehicle</span>
                    <span className="mt-1 block text-base font-black text-stone-950">{order.brand || 'Brand'} {order.model || 'Model'} {order.year || ''}</span>
                  </span>
                  {isVehicleDetailsExpanded ? <ChevronUp size={17} className="text-stone-500" /> : <ChevronDown size={17} className="text-stone-500" />}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['VIN', order.vin || 'Not set', vinIsValid ? 'Ready' : vinIsIncomplete ? 'Check' : 'Missing'],
                    ['Market', heroMarketRegion, order.vehicleDetails?.marketRegion ? 'Set' : 'Open'],
                    ['Engine', order.vehicleDetails?.engineType || order.vehicleDetails?.engineCode || 'Not set', 'Spec'],
                    ['Body', order.bodyType || 'Not set', 'Body']
                  ].map(([label, value, meta]) => (
                    <div key={label} className="ds-surface rounded-[20px] px-4 py-3">
                      <p className="text-[10px] font-black text-stone-400">{label}</p>
                      <p className="mt-1 truncate text-sm font-black text-stone-950">{value}</p>
                      <p className="mt-1 text-[10px] font-bold text-stone-400">{meta}</p>
                    </div>
                  ))}
                </div>
                {isVehicleDetailsExpanded && (
                  <div className="ds-surface space-y-3 rounded-[24px] p-4">
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={String(draftFields.vin ?? order.vin ?? '')} readOnly={!isEditMode} onChange={(e) => updateOrderField('vin', e.target.value.toUpperCase().slice(0, 17))} onBlur={() => flushDeferredOrderField('vin')} placeholder="VIN" className="ds-input col-span-2 h-12 rounded-2xl border-0 px-4 text-sm font-black uppercase text-stone-950 outline-none" />
                      <button type="button" onClick={pasteVinFromClipboard} className="ds-press h-11 rounded-2xl bg-stone-950 px-3 text-xs font-black text-white">Paste VIN</button>
                      <button type="button" onClick={() => carFileRef.current?.click()} className="ds-press h-11 rounded-2xl bg-stone-100 px-3 text-xs font-black text-stone-800">Add media</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select value={String((draftFields.vehicleDetails?.marketRegion) ?? (order.vehicleDetails?.marketRegion ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), marketRegion: (e.target.value || undefined) })} onBlur={() => flushDeferredOrderField('vehicleDetails')} disabled={!isEditMode} className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none">
                        <option value="">Market</option>
                        {VEHICLE_MARKET_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                      <select value={String((draftFields.vehicleDetails?.transmission) ?? (order.vehicleDetails?.transmission ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), transmission: (e.target.value || undefined) })} onBlur={() => flushDeferredOrderField('vehicleDetails')} disabled={!isEditMode} className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none">
                        <option value="">Transmission</option>
                        {VEHICLE_TRANSMISSION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                      <input type="text" value={String((draftFields.vehicleDetails?.engineType) ?? (order.vehicleDetails?.engineType ?? ''))} readOnly={!isEditMode} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), engineType: e.target.value })} onBlur={() => flushDeferredOrderField('vehicleDetails')} placeholder="Engine" className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none" />
                      <input type="text" value={String((draftFields.vehicleDetails?.color) ?? (order.vehicleDetails?.color ?? ''))} readOnly={!isEditMode} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), color: e.target.value })} onBlur={() => flushDeferredOrderField('vehicleDetails')} placeholder="Color" className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none" />
                    </div>
                    {getCarPhotos().length > 0 && (
                      <div className="flex gap-2 overflow-x-auto no-scrollbar">
                        {getCarPhotos().map((photo, index) => (
                          <div key={`${photo}-${index}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-stone-200">
                            <button type="button" onClick={() => setGallery({ images: getCarPhotos(), index })} className="h-full w-full"><img src={photo} alt="Vehicle" className="h-full w-full object-cover" /></button>
                            {isEditMode && <button type="button" onClick={() => removeCarPhoto(index)} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white" aria-label="Remove photo"><X size={11} /></button>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {settings.orderZones && settings.orderZones.length > 0 && (
                <section className="space-y-2">
                  <p className="text-[12px] font-black text-stone-600">Service zone</p>
                  <div className="flex flex-wrap gap-2">
                    {(order.zones && order.zones.length > 0 ? order.zones : order.zone ? [order.zone] : []).map((zone, index) => (
                      <button key={`${zone}-${index}`} type="button" onClick={() => {
                        const current = order.zones && order.zones.length > 0 ? order.zones : (order.zone ? [order.zone] : []);
                        updateOrderZones(current.filter((_, currentIndex) => currentIndex !== index));
                      }} className="ds-press inline-flex items-center gap-2 rounded-full bg-stone-950 px-3 py-2 text-[11px] font-black text-white">
                        {zone}<X size={12} />
                      </button>
                    ))}
                    <select value="" onChange={(event) => {
                      const selected = event.target.value;
                      if (!selected) return;
                      const current = order.zones && order.zones.length > 0 ? order.zones : (order.zone ? [order.zone] : []);
                      if (!current.includes(selected)) updateOrderZones([...current, selected]);
                    }} className="ds-input h-9 rounded-full border-0 px-3 text-[11px] font-black text-stone-700 outline-none">
                      <option value="">Add zone</option>
                      {settings.orderZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                    </select>
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === 'search' && (
            <div className="ds-mode-enter space-y-6">
              <section className="ds-deep-surface rounded-[28px] bg-[#16181D] p-4 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold text-white/[0.42]">Field sourcing</p>
                    <h2 className="mt-1 text-[27px] font-black leading-tight tracking-normal">Move fast</h2>
                    <p className="mt-1 text-xs font-semibold leading-5 text-white/[0.58]">{openPartsCount} open parts · {recommendedShops.length} supplier leads</p>
                  </div>
                  <button type="button" onClick={() => setShowOnlyOpenParts((prev) => !prev)} className={`ds-press rounded-full px-3 py-2 text-[11px] font-black ${showOnlyOpenParts ? 'bg-amber-300 text-stone-950' : 'bg-white/10 text-white'}`}>
                    {showOnlyOpenParts ? 'Open only' : 'All parts'}
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => void copyText(safetySummary.supplierBroadcast, 'Supplier request copied')} className="ds-press inline-flex h-11 items-center justify-center gap-1 rounded-2xl bg-[#F7F3EA] px-2 text-[10px] font-black text-stone-950"><Send size={13} /> Request</button>
                  <button type="button" onClick={contactAllRecommendedShops} disabled={recommendedShops.length === 0} className="ds-press inline-flex h-11 items-center justify-center gap-1 rounded-2xl bg-white/10 px-2 text-[10px] font-black text-white disabled:opacity-35"><Phone size={13} /> Chats</button>
                  <button type="button" onClick={() => FEATURE_RADAR_V2 ? void launchRadarSession() : navigate('/database')} className="ds-press inline-flex h-11 items-center justify-center gap-1 rounded-2xl bg-white/10 px-2 text-[10px] font-black text-white"><Rocket size={13} /> {isLaunchingRadar ? 'Opening' : 'Radar'}</button>
                </div>
              </section>

              <section ref={addPartSectionRef} className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-black text-stone-600">Add part</p>
                  <span className="text-[11px] font-black text-stone-500">{order.parts.length} total</span>
                </div>
                <form onSubmit={(event) => { event.preventDefault(); addNewPart(); }} className="ds-surface rounded-[28px] p-3">
                  <div className="flex items-center gap-2">
                    <div className="ds-input flex h-14 min-w-0 flex-1 items-center gap-2 rounded-2xl px-3">
                      <Search size={18} className="shrink-0 text-stone-400" />
                      <input ref={partInputRef} type="text" value={newPartName} onChange={(event) => setNewPartName(event.target.value)} placeholder="Type part name..." className="h-full min-w-0 flex-1 border-0 bg-transparent text-base font-black text-stone-950 outline-none placeholder:text-stone-400" />
                    </div>
                    <div className="ds-input flex h-14 w-[112px] shrink-0 items-center rounded-2xl p-1">
                      <button type="button" onClick={() => setNewPartQuantity(String(Math.max(1, Number(newPartQuantity || 1) - 1)))} className="ds-press flex h-12 w-9 items-center justify-center rounded-xl text-stone-700 active:bg-white" aria-label="Decrease quantity"><Minus size={16} /></button>
                      <input type="number" min={1} value={newPartQuantity} onChange={(event) => setNewPartQuantity(event.target.value)} className="h-12 min-w-0 flex-1 border-0 bg-transparent text-center text-base font-black text-stone-950 outline-none" />
                      <button type="button" onClick={() => setNewPartQuantity(String(Math.max(1, Number(newPartQuantity || 1) + 1)))} className="ds-press flex h-12 w-9 items-center justify-center rounded-xl text-stone-700 active:bg-white" aria-label="Increase quantity"><Plus size={16} /></button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setNewPartKind('single')} className={`ds-press h-10 rounded-2xl text-[11px] font-black ${newPartKind === 'single' ? 'bg-stone-950 text-white' : 'bg-stone-100/80 text-stone-500'}`}>Single</button>
                    <button type="button" onClick={() => { setNewPartKind('group'); setNewPartGroupItems((prev) => prev.length > 0 ? prev : [createGroupItemDraft()]); }} className={`ds-press h-10 rounded-2xl text-[11px] font-black ${newPartKind === 'group' ? 'bg-stone-950 text-white' : 'bg-stone-100/80 text-stone-500'}`}>Group</button>
                  </div>
                  {newPartKind === 'group' && (
                    <div className="mt-3 space-y-2 rounded-[22px] bg-stone-100/70 p-3">
                      {newPartGroupItems.map((item, index) => (
                        <div key={item.id} className="flex items-center gap-2">
                          <input type="text" value={item.name} onChange={(event) => updateGroupItemRow(item.id, 'name', event.target.value)} placeholder={`Part ${index + 1}`} className="ds-input h-10 min-w-0 flex-1 rounded-xl border-0 px-3 text-xs font-black outline-none" />
                          <select value={item.quantity} onChange={(event) => updateGroupItemRow(item.id, 'quantity', event.target.value)} className="ds-input h-10 w-16 rounded-xl border-0 text-center text-xs font-black outline-none">
                            {Array.from({ length: 20 }, (_, qtyIdx) => String(qtyIdx + 1)).map((qty) => <option key={qty} value={qty}>{qty}</option>)}
                          </select>
                          <button type="button" onClick={() => removeGroupItemRow(item.id)} className="ds-press flex h-10 w-10 items-center justify-center rounded-xl bg-white text-rose-600" aria-label="Remove group item"><X size={14} /></button>
                        </div>
                      ))}
                      <button type="button" onClick={addGroupItemRow} className="ds-press h-9 rounded-xl bg-white px-3 text-[11px] font-black text-stone-700">Add row</button>
                    </div>
                  )}
                  <textarea value={newPartComment} onChange={(event) => setNewPartComment(event.target.value)} placeholder="Notes, side, trim, OEM number..." rows={2} className="ds-input mt-3 w-full rounded-2xl border-0 px-3 py-3 text-sm font-bold text-stone-800 outline-none placeholder:text-stone-400" />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto no-scrollbar">
                      <button type="button" onClick={() => partFileRef.current?.click()} className={`ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${newPartPhotos.length > 0 ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-stone-100/80 text-stone-400'}`} aria-label="Attach part photos">
                        <ImageIcon size={18} />
                      </button>
                      {newPartPhotos.map((photo, index) => (
                        <div key={`${photo}-${index}`} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-stone-200">
                          <img src={photo} alt="Part preview" className="h-full w-full object-cover" />
                          <button type="button" onClick={() => removeNewPhoto(index)} className="absolute inset-0 flex items-center justify-center bg-black/[0.42] text-white opacity-0 transition hover:opacity-100" aria-label="Remove photo"><X size={13} /></button>
                        </div>
                      ))}
                      <input type="file" ref={partFileRef} onChange={handlePhotoChange} className="hidden" accept="image/*" multiple />
                    </div>
                    <button type="submit" disabled={!depositPaid} className="ds-press inline-flex h-12 shrink-0 items-center gap-2 rounded-[20px] bg-stone-950 px-5 text-xs font-black uppercase tracking-[0.1em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_12px_26px_rgba(23,23,23,0.22)] disabled:opacity-35">
                      <Plus size={16} /> Add
                    </button>
                  </div>
                </form>
              </section>

              {recommendedShops.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-black text-stone-600">Supplier lane</p>
                    {firstRecommendedShop && <span className="text-[11px] font-black text-stone-500">{firstRecommendedShop.name}</span>}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {recommendedShops.slice(0, 8).map((shop) => (
                      <div key={shop.id} className="ds-surface w-[220px] shrink-0 rounded-[22px] p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-stone-950">{shop.name}</p>
                            <p className="mt-1 truncate text-[11px] font-bold text-stone-500">{shop.location || shop.category || 'Supplier'}</p>
                          </div>
                          <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-black text-stone-600">{getShopRecommendationLevel(shop, order)}</span>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-1.5">
                          <button type="button" onClick={() => contactSupplier(shop.name)} className="ds-press flex h-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700" aria-label="Contact supplier"><Phone size={14} /></button>
                          <button type="button" onClick={() => navigateToShop(shop)} className="ds-press flex h-9 items-center justify-center rounded-xl bg-stone-100 text-stone-700" aria-label="Map"><MapPin size={14} /></button>
                          <button type="button" onClick={() => (order.recommendedShopIds || []).includes(shop.id) ? removeManualRecommendation(shop.id) : addManualRecommendation(shop.id)} className="ds-press flex h-9 items-center justify-center rounded-xl bg-stone-100 text-stone-700" aria-label="Pin supplier"><Star size={14} className={(order.recommendedShopIds || []).includes(shop.id) ? 'fill-amber-300 text-amber-500' : ''} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {(order.dismissedShopIds || []).length > 0 && (
                    <button type="button" onClick={restoreDismissedRecommendations} className="ds-press ds-surface rounded-full px-3 py-2 text-[11px] font-black text-stone-600">Restore dismissed suppliers</button>
                  )}
                </section>
              )}

              <section ref={partsListRef} className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-black text-stone-600">Part queue</p>
                  <span className="text-[11px] font-black text-stone-500">{foundPartsCount}/{partsCount} sourced</span>
                </div>
                {partQueue.length === 0 ? (
                  <button type="button" onClick={() => partInputRef.current?.focus()} className="ds-press ds-soft-empty flex min-h-[118px] w-full flex-col items-center justify-center rounded-[26px] text-center">
                    <Package size={24} className="text-stone-400" />
                    <span className="mt-2 text-sm font-black text-stone-700">{showOnlyOpenParts ? 'All parts have options' : 'No parts yet'}</span>
                    <span className="mt-1 text-xs font-semibold text-stone-400">Tap to capture the next item.</span>
                  </button>
                ) : (
                  <div className="space-y-2">
                    {partQueue.map((part) => {
                      const partDisplayName = getPartDisplayName(part);
                      const groupItems = normalizeGroupItems(part.groupItems);
                      const partQuantity = normalizePartQuantity(part.quantity);
                      const variants = Array.isArray(part.variants) ? part.variants : [];
                      const bestVariant = variants.find((variant) => variant.id === part.bestOfferId || variant.isBest) || variants[0];
                      const partPhotos = getPartPreviewPhotos(part);
                      const salePrice = Number((bestVariant?.salePriceAed ?? bestVariant?.priceAed) || 0);
                      const purchasePrice = Number((bestVariant?.purchasePriceAed ?? bestVariant?.priceAed) || 0);
                      const partReady = Boolean(part.isFound || variants.length > 0);
                      const openPartDetails = () => {
                        const mainScroller = document.querySelector('main');
                        const restoreScrollTop = mainScroller instanceof HTMLElement ? mainScroller.scrollTop : undefined;
                        navigate(`/order/${order.id}/part/${part.id}`, { state: { backTo: `/order/${order.id}`, ...(typeof restoreScrollTop === 'number' ? { orderScrollTop: restoreScrollTop } : {}) } });
                      };
                      return (
                        <article key={part.id} className="ds-surface rounded-[26px] p-3 cursor-pointer" onClick={openPartDetails} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPartDetails(); } }}>
                          <div className="flex gap-3">
                            <button type="button" onClick={(event) => { event.stopPropagation(); openGallery(event, part); }} className="ds-press flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-stone-100" aria-label="Open part media">
                              {partPhotos[0] ? <img src={partPhotos[0]} alt={partDisplayName} className="h-full w-full object-cover" /> : <Package size={20} className="text-stone-300" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-base font-black text-stone-950">{partDisplayName}</p>
                                  <p className="mt-1 truncate text-[11px] font-bold text-stone-500">Qty {partQuantity}{groupItems.length > 0 ? ` · ${groupItems.length} grouped` : ''}</p>
                                </div>
                                <button type="button" onClick={(event) => { event.stopPropagation(); togglePartFound(part.id); }} className={`ds-press shrink-0 rounded-full px-3 py-1.5 text-[10px] font-black ${partReady ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                                  {partReady ? 'Found' : 'Open'}
                                </button>
                              </div>
                              {bestVariant ? (
                                <button type="button" onClick={(event) => { event.stopPropagation(); openPartDetails(); }} className="mt-3 flex w-full items-center justify-between gap-3 rounded-2xl bg-stone-950/[0.04] px-3 py-2 text-left">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-black text-stone-800">{bestVariant.shopName || 'Supplier'}</p>
                                    <p className="mt-0.5 text-[10px] font-bold text-stone-500">{purchasePrice.toFixed(0)} AED buy · {bestVariant.condition || 'condition'}</p>
                                  </div>
                                  <p className="shrink-0 text-sm font-black text-stone-950">{salePrice.toFixed(0)} AED</p>
                                </button>
                              ) : (
                                <p className="ds-soft-empty mt-3 rounded-2xl px-3 py-2 text-xs font-bold text-stone-500">No supplier option yet.</p>
                              )}
                              {partCommentExpanded[part.id] ? (
                                <div className="mt-3 space-y-2">
                                  <textarea value={partCommentDrafts[part.id] ?? ''} onChange={(event) => updatePartCommentDraft(part.id, event.target.value)} rows={2} className="ds-input w-full rounded-2xl border-0 px-3 py-2 text-xs font-bold text-stone-700 outline-none" />
                                  <button type="button" onClick={() => savePartComment(part.id)} className="ds-press h-9 rounded-xl bg-stone-950 px-3 text-[11px] font-black text-white">Save note</button>
                                </div>
                              ) : part.comment ? <p className="mt-2 line-clamp-2 text-xs font-semibold text-stone-600">{part.comment}</p> : null}
                              <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
                                <button type="button" disabled={!depositPaid} onClick={(event) => { event.stopPropagation(); openPartDetails(); }} className="ds-press inline-flex h-9 shrink-0 items-center gap-1 rounded-xl bg-stone-950 px-3 text-[11px] font-black text-white disabled:opacity-35">
                                  <Plus size={13} /> Variant
                                </button>
                                <button type="button" onClick={(event) => { event.stopPropagation(); setPartCommentExpanded((prev) => ({ ...prev, [part.id]: !prev[part.id] })); }} className="ds-press h-9 shrink-0 rounded-xl bg-stone-100 px-3 text-[11px] font-black text-stone-600">Note</button>
                                <button type="button" onClick={(event) => { event.stopPropagation(); setDeletePartId(part.id); }} className="ds-press flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600" aria-label="Delete part"><X size={14} /></button>
                              </div>
                              <div className="mt-2 flex gap-2">
                                <input type="url" value={partMediaLinkDrafts[part.id] ?? ''} readOnly={!isEditMode} onChange={(event) => setPartMediaLinkDrafts((prev) => ({ ...prev, [part.id]: event.target.value }))} onBlur={(event) => savePartMediaLink(part.id, event.target.value)} placeholder="Drive media link" className="ds-input h-10 min-w-0 flex-1 rounded-xl border-0 px-3 text-xs font-bold text-stone-700 outline-none" />
                                <button type="button" onClick={(event) => {
                                  event.stopPropagation();
                                  const savedUrl = savePartMediaLink(part.id, partMediaLinkDrafts[part.id], { showToast: true });
                                  checkGoogleDriveLink(savedUrl, 'Add Drive media link');
                                }} className="ds-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-700" aria-label="Open media"><ExternalLink size={14} /></button>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'proof' && (
            <div className="ds-mode-enter space-y-5">
              <section className="ds-deep-surface rounded-[28px] bg-[#141619] p-4 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold text-white/[0.42]">Invisible safety</p>
                    <h2 className="mt-1 text-2xl font-black tracking-normal">Proof is quietly running</h2>
                    <p className="mt-1 text-xs font-semibold leading-5 text-white/[0.58]">{safetySummary.proofPack.completed}/{safetySummary.proofPack.total} captured · {criticalProofMissing.length} critical open</p>
                  </div>
                  <span className="rounded-full bg-white/10 px-3 py-2 text-[11px] font-black text-white">{Math.round((safetySummary.proofPack.completed / Math.max(1, safetySummary.proofPack.total)) * 100)}%</span>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 via-amber-200 to-white transition-all" style={{ width: `${Math.round((safetySummary.proofPack.completed / Math.max(1, safetySummary.proofPack.total)) * 100)}%` }} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setIsEstimateOpen(true)} className="ds-press inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-white text-xs font-black text-stone-950"><Share2 size={14} /> Send quote</button>
                  <button type="button" onClick={() => void copyText(safetySummary.supplierBroadcast, 'Supplier request copied')} className="ds-press inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-white/10 text-xs font-black text-white"><Copy size={14} /> Supplier</button>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-black text-stone-600">Evidence gallery</p>
                  <span className="text-[11px] font-black text-stone-500">{evidencePhotos.length} files</span>
                </div>
                {evidencePhotos.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2">
                    {evidencePhotos.slice(0, 12).map((photo, index) => (
                      <button key={`${photo}-${index}`} type="button" onClick={() => setGallery({ images: evidencePhotos, index })} className="ds-press aspect-square overflow-hidden rounded-2xl bg-stone-200">
                        <img src={photo} alt="Evidence" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="ds-soft-empty rounded-[26px] p-5 text-center">
                    <Camera size={24} className="mx-auto text-stone-400" />
                    <p className="mt-2 text-sm font-black text-stone-700">No proof media yet</p>
                    <p className="mt-1 text-xs font-semibold text-stone-400">Add part photos, notes, or Drive links while sourcing.</p>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <p className="text-[12px] font-black text-stone-600">Missing proof</p>
                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {(proofMissing.length ? proofMissing : safetySummary.proofPack.items.slice(0, 5)).map((item) => (
                    <span key={item.id} className={`shrink-0 rounded-full px-3 py-2 text-[11px] font-black ${item.done ? 'bg-emerald-50 text-emerald-700' : item.critical ? 'bg-stone-950 text-white' : 'bg-white text-stone-500'}`}>
                      {item.done ? <Check size={12} className="mr-1 inline" /> : null}{PROOF_COPY[item.id] || item.id}
                    </span>
                  ))}
                </div>
              </section>

              <section className="ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Order media folder</p>
                    <p className="mt-1 text-xs font-semibold text-stone-500">Attach a Drive folder for quote visibility.</p>
                  </div>
                  <FolderOpen size={19} className="text-stone-400" />
                </div>
                <div className="flex gap-2">
                  <input type="url" value={orderMediaFolderDraft} readOnly={!isEditMode} onChange={(event) => setOrderMediaFolderDraft(event.target.value)} onBlur={(event) => saveOrderMediaFolder(event.target.value)} placeholder="https://drive.google.com/drive/folders/..." className="ds-input h-12 min-w-0 flex-1 rounded-2xl border-0 px-3 text-xs font-bold text-stone-800 outline-none" />
                  <button type="button" onClick={() => {
                    const savedUrl = saveOrderMediaFolder(orderMediaFolderDraft, { showToast: true });
                    checkGoogleDriveLink(savedUrl, 'Add order Drive folder');
                  }} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white" aria-label="Open folder"><ExternalLink size={15} /></button>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void copyText(safetySummary.paymentExplanation, 'Payment terms copied')} className="ds-press ds-surface inline-flex h-12 items-center justify-center gap-2 rounded-2xl text-xs font-black text-stone-800"><DollarSign size={14} /> Terms</button>
                <button type="button" onClick={() => setIsEstimateOpen(true)} className="ds-press ds-surface inline-flex h-12 items-center justify-center gap-2 rounded-2xl text-xs font-black text-stone-800"><ReceiptText size={14} /> Public quote</button>
                <button type="button" onClick={() => updateOrderField('isArchived', !order.isArchived)} className="ds-press ds-surface inline-flex h-12 items-center justify-center gap-2 rounded-2xl text-xs font-black text-stone-800"><Package size={14} /> {order.isArchived ? 'Unarchive' : 'Archive'}</button>
                <button type="button" onClick={() => setDeleteOrderConfirmOpen(true)} className="ds-press inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-rose-50 text-xs font-black text-rose-700"><X size={14} /> Delete</button>
              </section>
            </div>
          )}

          {activeTab === 'finance' && (
            <div className="ds-mode-enter space-y-5">
              <section ref={markupSectionRef} className="ds-deep-surface rounded-[30px] bg-[#121418] p-5 text-white">
                <p className="text-[11px] font-semibold text-white/[0.42]">Profitability cockpit</p>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-semibold text-white/[0.52]">Net profit</p>
                    <h2 className="mt-1 text-[34px] font-black leading-none tracking-normal">{shownNetProfit !== null ? formatDualMoney(shownNetProfit) : 'Unknown'}</h2>
                  </div>
                  <span className={`rounded-full px-3 py-2 text-[11px] font-black ${profitTone}`}>{safetySummary.profit.level === 'healthy' ? 'Worth doing' : safetySummary.profit.level === 'unknown' ? 'Need prices' : 'Rework'}</span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <div className="rounded-2xl bg-white/[0.075] px-3 py-2">
                    <p className="text-[10px] font-black text-white/[0.38]">Client</p>
                    <p className="mt-1 truncate text-sm font-black">{formatMoney(sellTotalAed, clientCurrency)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/[0.075] px-3 py-2">
                    <p className="text-[10px] font-black text-white/[0.38]">Buy</p>
                    <p className="mt-1 truncate text-sm font-black">{formatMoney(selectedOfferTotal)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/[0.075] px-3 py-2">
                    <p className="text-[10px] font-black text-white/[0.38]">Margin</p>
                    <p className="mt-1 truncate text-sm font-black">{marginPercent !== null ? `${marginPercent.toFixed(0)}%` : 'Open'}</p>
                  </div>
                </div>
              </section>

              <section className="ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Margin control</p>
                    <p className="mt-1 text-xs font-semibold text-stone-500">{formatDualMoney(markupAed)} markup</p>
                  </div>
                  <div className="inline-flex rounded-full bg-stone-100 p-1">
                    <button type="button" onClick={() => updateOrderField('markupType', 'percent')} className={`ds-press h-9 rounded-full px-4 text-xs font-black ${(order.markupType || 'percent') === 'percent' ? 'bg-stone-950 text-white' : 'text-stone-500'}`}>%</button>
                    <button type="button" onClick={() => updateOrderField('markupType', 'fixed')} className={`ds-press h-9 rounded-full px-4 text-xs font-black ${(order.markupType || 'percent') === 'fixed' ? 'bg-stone-950 text-white' : 'text-stone-500'}`}>AED</button>
                  </div>
                </div>
                {(order.markupType || 'percent') === 'percent' ? (
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {MARKUP_OPTIONS.map((option) => (
                      <button key={option} type="button" onClick={() => updateOrderField('markupPercent', Number(option))} className={`ds-press h-11 shrink-0 rounded-2xl px-4 text-xs font-black ${Number(draftFields.markupPercent ?? order.markupPercent) === option ? 'bg-stone-950 text-white' : 'bg-stone-100 text-stone-500'}`}>{option}%</button>
                    ))}
                  </div>
                ) : (
                  <input type="text" inputMode="numeric" value={markupFixedInput} onFocus={() => { if (markupFixedInput === '0') setMarkupFixedInput(''); }} onBlur={() => { if (!markupFixedInput) setMarkupFixedInput('0'); flushMarkupCommit(); }} onChange={handleMarkupFixedChange} placeholder="Markup AED" className="ds-input h-12 w-full rounded-2xl border-0 px-4 text-sm font-black text-stone-950 outline-none" />
                )}
                <label className="flex items-center gap-2 text-xs font-bold text-stone-500">
                  <input type="checkbox" checked={!!order.useMarkupAsDefaultForNewParts} onChange={(event) => updateOrderField('useMarkupAsDefaultForNewParts', event.target.checked)} />
                  Use this margin for new parts
                </label>
              </section>

              <section className="ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-black text-stone-600">Logistics</p>
                  <span className="text-[11px] font-black text-stone-500">{formatDualMoney(logisticsWithCargoTotal)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { field: 'deliveryAed', label: 'Delivery' },
                    { field: 'packingAed', label: 'Packing' },
                    { field: 'serviceFeeAed', label: 'Service' }
                  ] as const).map(({ field, label }) => (
                    <label key={field} className="space-y-1">
                      <span className="text-[10px] font-black text-stone-400">{label}</span>
                      <input type="text" inputMode="numeric" value={logisticsDraft[field]} onChange={(event) => onLogisticsDraftChange(field, sanitizeNumericInput(event.target.value))} className="ds-input h-12 w-full rounded-2xl border-0 px-2 text-center text-sm font-black text-stone-950 outline-none" />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={order.logistics?.deliveryType || 'uae'} onChange={(event) => updateLogisticsField('deliveryType', event.target.value)} className="ds-input h-12 rounded-2xl border-0 px-3 text-xs font-black outline-none">
                    <option value="uae">UAE delivery</option>
                    <option value="export">Export cargo</option>
                  </select>
                  <select value={order.logistics?.cargoCountry || cargoCalc.country} onChange={(event) => updateCargoField({ cargoCountry: event.target.value })} className="ds-input h-12 rounded-2xl border-0 px-3 text-xs font-black outline-none">
                    {cargoTariffOptions.map((tariff) => <option key={tariff.country} value={tariff.country}>{tariff.country}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-[22px] bg-stone-950/[0.04] p-3">
                  <div>
                    <p className="text-[10px] font-black text-stone-400">Weight</p>
                    <p className="mt-1 text-sm font-black text-stone-950">{cargoCalc.chargeableWeight.toFixed(1)} kg</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-stone-400">Places</p>
                    <p className="mt-1 text-sm font-black text-stone-950">{cargoCalc.totalPlaces}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-stone-400">ETA</p>
                    <p className="mt-1 text-sm font-black text-stone-950">{cargoCalc.eta || '—'}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={saveLogisticsDraft} disabled={!hasPendingPricingChanges} className={`ds-press h-11 flex-1 rounded-2xl px-3 text-xs font-black ${hasPendingPricingChanges ? 'bg-stone-950 text-white' : 'bg-stone-100 text-stone-400'}`}>Сохранить</button>
                </div>
                {aiCargoNotice && <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{aiCargoNotice}</p>}
              </section>

              <section className="grid grid-cols-3 gap-2">
                <button type="button" onClick={openClientChannel} className="ds-press h-12 rounded-2xl bg-emerald-50 px-2 text-[11px] font-black text-emerald-700">{contactActionLabel}</button>
                <button type="button" onClick={() => setIsEstimateOpen(true)} className="ds-press h-12 rounded-2xl bg-stone-950 px-2 text-[11px] font-black text-white">Quote</button>
                <button type="button" onClick={handleSellClick} className="ds-press ds-surface h-12 rounded-2xl px-2 text-[11px] font-black text-stone-800">{order.isSold ? 'Reopen' : 'Sold'}</button>
              </section>
              {sellError && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-xs font-black text-rose-700">{sellError}</div>}
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="ds-mode-enter space-y-5">
              <section ref={notesSectionRef} className="ds-surface space-y-3 rounded-[28px] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Transaction memory</p>
                    <h2 className="mt-1 text-xl font-black text-stone-950">Notes and voice</h2>
                  </div>
                  {latestNote && <span className="rounded-full bg-stone-100 px-3 py-2 text-[10px] font-black text-stone-500">{new Date(latestNote.createdAt).toLocaleDateString()}</span>}
                </div>
                <textarea value={newNoteText} onChange={(event) => setNewNoteText(event.target.value)} placeholder="Add what happened, what client said, supplier details..." className="ds-input w-full rounded-2xl border-0 p-3 text-sm font-bold text-stone-800 outline-none placeholder:text-stone-400" rows={3} />
                {recordingError && <p className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{recordingError}</p>}
                {recordingSavedLocally && <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">Recording saved locally</p>}
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  <button type="button" onClick={() => noteFileRef.current?.click()} aria-label="Attach photo" className="ds-press inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-stone-100 px-4 text-xs font-black text-stone-700"><ImageIcon size={17} /> Photo</button>
                  <button type="button" onClick={() => noteAudioFileRef.current?.click()} aria-label="Attach audio file" className="ds-press inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-stone-100 px-4 text-xs font-black text-stone-700"><FileAudio size={17} /> File</button>
                  <button type="button" onClick={() => void toggleRecording()} aria-label="Voice" className={`ds-press inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl px-4 text-xs font-black ${isRecording ? 'bg-rose-50 text-rose-700' : 'bg-stone-950 text-white'}`}><Mic size={16} /> Voice</button>
                  {newNotePhotos.map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt="New note" className="h-12 w-12 shrink-0 rounded-2xl object-cover" />)}
                  {newNoteAudios.map((audioItem, index) => {
                    const voice = toVoiceNoteAudio(audioItem);
                    const audioId = `draft-audio-${voice.id}`;
                    const isPlaying = playingAudioId === audioId;
                    const progress = audioProgress[audioId] || 0;
                    const bars = getWaveBars(voice.fileUrl.slice(0, 120));
                    return (
                      <div key={`draft-${voice.id}`} className="flex h-12 min-w-[240px] items-center gap-2 rounded-2xl bg-emerald-50 px-2">
                        <button type="button" onClick={() => toggleAudioPlayback(audioId)} className="ds-press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white" aria-label="Play audio">{isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}</button>
                        <div className="flex h-8 flex-1 items-end gap-[2px]">
                          {bars.slice(0, 18).map((bar, barIndex) => {
                            const active = (barIndex + 1) / 18 <= progress / 100;
                            return <span key={`${audioId}-${barIndex}`} className={`w-[3px] rounded-full ${active ? 'bg-emerald-600' : 'bg-emerald-200'}`} style={{ height: `${Math.max(30, bar * 0.8)}%` }} />;
                          })}
                        </div>
                        <button type="button" onClick={() => removeNewAudio(index)} className="ds-press rounded-lg px-2 py-1 text-[10px] font-black text-rose-600">Remove</button>
                        <audio id={audioId} src={voice.fileUrl} preload="metadata" playsInline />
                      </div>
                    );
                  })}
                  <input type="file" ref={noteFileRef} onChange={handleNotePhotoChange} className="hidden" accept="image/*" multiple />
                  <input type="file" ref={noteAudioFileRef} onChange={handleNoteAudioFileChange} className="hidden" accept="audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.webm" multiple />
                </div>
                {isUploadingVoice && (
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-stone-500">Uploading voice note...</p>
                    <div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${voiceUploadProgress}%` }} /></div>
                  </div>
                )}
                <button type="button" onClick={addNote} className="ds-press h-12 w-full rounded-2xl bg-stone-950 text-xs font-black uppercase tracking-[0.12em] text-white">Add memory</button>
              </section>

              {(order.notes || []).length > 0 && (
                <section className="space-y-2">
                  {(order.notes || []).map((note) => (
                    <article key={note.id} className="ds-surface rounded-[24px] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {note.text && <p className="text-sm font-semibold leading-6 text-stone-800">{note.text}</p>}
                          <p className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-stone-400">{new Date(note.createdAt).toLocaleString()}</p>
                        </div>
                        <button type="button" onClick={() => removeNoteById(note.id)} className="ds-press flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600" aria-label="Delete note"><X size={14} /></button>
                      </div>
                      {note.photos && note.photos.length > 0 && (
                        <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
                          {note.photos.map((photo, index) => (
                            <div key={`${photo}-${index}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl">
                              <button type="button" onClick={() => setGallery({ images: note.photos || [], index })} className="ds-press h-full w-full"><img src={photo} alt="Note" className="h-full w-full object-cover" /></button>
                              <button type="button" onClick={() => removeNotePhoto(note.id, index)} className="ds-press absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white" aria-label="Remove photo"><X size={11} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      {note.audios && note.audios.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {note.audios.map((audioItem, index) => {
                            const voice = toVoiceNoteAudio(audioItem);
                            const audioId = `note-${note.id}-${voice.id}-${index}`;
                            const isPlaying = playingAudioId === audioId;
                            const progress = audioProgress[audioId] || 0;
                            const bars = getWaveBars(voice.fileUrl.slice(0, 120));
                            return (
                              <div key={audioId} className="rounded-2xl bg-stone-950/[0.04] p-3">
                                <div className="flex items-center gap-2">
                                  <button type="button" onClick={() => toggleAudioPlayback(audioId)} className="ds-press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-950 text-white" aria-label="Play note">{isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}</button>
                                  <div className="flex h-8 flex-1 items-center gap-0.5">
                                    {bars.map((height, barIndex) => {
                                      const threshold = ((barIndex + 1) / bars.length) * 100;
                                      const passed = progress >= threshold;
                                      return <span key={`${audioId}-bar-${barIndex}`} className={`block flex-1 rounded-full ${passed ? 'bg-stone-950' : 'bg-stone-300'}`} style={{ height: `${height}%` }} />;
                                    })}
                                  </div>
                                  <span className="text-xs font-black text-stone-500">{formatSeconds(voice.duration)}</span>
                                </div>
                                <audio id={audioId} src={voice.fileUrl} preload="metadata" playsInline />
                                <div className="mt-2 flex gap-2">
                                  <button type="button" onClick={() => removeNoteAudio(note.id, index)} className="ds-press rounded-xl bg-white px-3 py-1.5 text-[10px] font-black text-rose-600">Delete</button>
                                  <a href={voice.fileUrl} download={`voice-note-${voice.id}.webm`} className="ds-press inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-[10px] font-black text-stone-700"><Download size={11} /> Download</a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </article>
                  ))}
                </section>
              )}
            </div>
          )}
        </div>

        {isRecording && (
          <div className="fixed inset-0 z-50 bg-slate-950/76 p-4 backdrop-blur-sm">
            <div className="ds-mode-enter ds-surface mx-auto mt-16 w-full max-w-md space-y-3 rounded-[28px] p-4 text-stone-950 shadow-2xl">
              <div className="flex items-center justify-between">
                <p className="text-sm font-black">Recording</p>
                <span className="font-mono text-sm font-black text-rose-700">{formatSeconds(recordingElapsedSeconds)}</span>
              </div>
              <div className="h-16 rounded-2xl bg-rose-50 px-2">
                <canvas id="voice-recorder-wave" className="h-full w-full" aria-label="Recording waveform" />
                <div className="-mt-16 flex h-16 items-end gap-0.5">
                  {recordingWaveform.map((height, index) => <span key={`live-wave-${index}`} className="block flex-1 rounded-full bg-rose-400 transition-all" style={{ height: `${height}%` }} />)}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={toggleRecordingPause} className="ds-press h-12 rounded-2xl bg-amber-50 text-xs font-black text-amber-700">{isRecordingPaused ? 'Resume' : 'Pause'}</button>
                <button type="button" onClick={() => void toggleRecording()} className="ds-press h-12 rounded-2xl bg-emerald-50 text-xs font-black text-emerald-700">Stop</button>
                <button type="button" onClick={requestCancelRecording} className="ds-press h-12 rounded-2xl bg-rose-50 text-xs font-black text-rose-700">Cancel</button>
              </div>
              <p className="text-[11px] font-semibold text-stone-500">Max length: 05:00 · Max size: 10MB</p>
            </div>
          </div>
        )}

        {isDiscardConfirmOpen && (
          <div className="fixed inset-0 z-[60] bg-black/50 p-4">
            <div className="ds-mode-enter ds-surface mx-auto mt-28 w-full max-w-sm space-y-3 rounded-[24px] p-4 text-stone-950">
              <p className="text-sm font-black">Discard recording?</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={confirmDiscardRecording} className="ds-press h-11 rounded-2xl bg-rose-50 text-xs font-black text-rose-700">Discard</button>
                <button type="button" onClick={() => setIsDiscardConfirmOpen(false)} className="ds-press h-11 rounded-2xl bg-stone-100 text-xs font-black text-stone-700">Continue</button>
              </div>
            </div>
          </div>
        )}

        <ConfirmModal isOpen={!!deletePartId} message="Вы уверены, что хотите удалить эту деталь?" onConfirm={confirmDeletePart} onCancel={() => setDeletePartId(null)} />
        <ConfirmModal isOpen={deleteOrderConfirmOpen} message="Удалить заказ? Это действие удалит заказ и связанные детали." confirmLabel="Удалить" confirmClass="bg-red-600 active:bg-red-700" onConfirm={() => void confirmDeleteOrder()} onCancel={() => setDeleteOrderConfirmOpen(false)} />
        <ConfirmModal isOpen={showSellConfirm} message={order.isSold ? "Вернуть заказ в активные?" : "Отметить заказ как проданный?"} confirmLabel={order.isSold ? "Да, вернуть" : "Да, продано"} confirmClass={order.isSold ? "bg-blue-600 active:bg-blue-700" : "bg-green-600 active:bg-green-700"} onConfirm={confirmSellOrder} onCancel={() => setShowSellConfirm(false)} />

        {isEstimateOpen && <EstimateModal order={order} onClose={() => setIsEstimateOpen(false)} onShare={shareQuote} />}
        {gallery && (
          <ImagePreview images={gallery.images} initialIndex={gallery.index} shareTitle="Vehicle details" shareText={carPhotoShareText || 'Vehicle details'} onClose={() => setGallery(null)} />
        )}
        {showCustomerLogs && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-3" onClick={(event) => { if (event.target === event.currentTarget) setShowCustomerLogs(false); }}>
            <div className="ds-mode-enter ds-surface w-full max-w-lg rounded-[28px] p-4 text-stone-950 shadow-2xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] font-black text-stone-600">Customer activity</p>
                  <h3 className="text-lg font-black text-stone-950">Client log</h3>
                </div>
                <button type="button" onClick={() => setShowCustomerLogs(false)} className="ds-press rounded-2xl bg-stone-100 px-3 py-2 text-xs font-black text-stone-600">Close</button>
              </div>
              <div className="mt-4 max-h-[70dvh] space-y-2 overflow-y-auto">
                {customerLogs.length === 0 ? (
                  <div className="ds-soft-empty rounded-2xl p-4 text-sm font-semibold text-stone-500">No client activity yet.</div>
                ) : customerLogs.map((entry) => (
                  <div key={entry.id} className="rounded-2xl bg-stone-950/[0.04] px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-black uppercase tracking-wide text-stone-500">{entry.channel}</span>
                      <span className="text-[11px] text-stone-400">{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-stone-800">{entry.summary}</p>
                    <p className="mt-1 text-[11px] text-stone-500">Type: {entry.type} · Actor: {entry.actor}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
};

export default OrderDetailsScreen;
