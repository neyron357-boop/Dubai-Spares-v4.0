import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, OrderPricingEvent, Part, Priority, Source, OrderNote, Shop, VoiceNoteAudio, ChatAttachment } from '../types';
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
  Trash2,
  Paperclip,
  Lock
} from 'lucide-react';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';
import { DEFAULT_QUOTE_RATES, QuoteCurrency, QuoteRates, shareQuoteLink } from '../shareUtils';
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
import { isLikelyGoogleDriveUrl, normalizeExternalMediaUrl, openExternalMediaUrl } from '../utils/externalMedia';
import { deriveSafetySalesSummary } from '../utils/safetySales';
import { calculateOrderDiscountAed, getFinanceVariant as resolveFinanceVariant, getPricedPartLines } from '../utils/quotePricing';
import { publicQuoteCreateSnapshot } from '../publicQuoteApi';
import SafeImage from '../components/SafeImage';

type OrderDetailsTab = 'overview' | 'search' | 'proof' | 'finance' | 'notes';
type WorkflowStepState = 'completed' | 'current' | 'locked' | 'upcoming';

const ORDER_DETAILS_TABS: Array<{ id: OrderDetailsTab; label: string; helper: string }> = [
  { id: 'overview', label: 'Обзор', helper: 'Клиент, авто, статус' },
  { id: 'search', label: 'Поиск', helper: 'Детали и варианты' },
  { id: 'proof', label: 'Пруфы', helper: 'Материалы и проверки' },
  { id: 'finance', label: 'Финансы', helper: 'Маржа и услуги' },
  { id: 'notes', label: 'Заметки', helper: 'Заметки и голос' }
];

const resolveOrderDetailsTab = (value: unknown): OrderDetailsTab | null => (
  ORDER_DETAILS_TABS.some((tab) => tab.id === value) ? value as OrderDetailsTab : null
);

const QUOTE_RATE_FIELDS: Array<{ code: Exclude<QuoteCurrency, 'AED'>; label: string; helper: string; decimals: number }> = [
  { code: 'USD', label: 'USD', helper: '1 USD = AED', decimals: 4 },
  { code: 'TJS', label: 'TJS', helper: '1 AED = сомони', decimals: 3 },
  { code: 'KZT', label: 'Tenge', helper: '1 AED = тенге', decimals: 2 },
  { code: 'RUB', label: 'RUB', helper: '1 AED = рубль', decimals: 2 },
  { code: 'UZS', label: 'UZB', helper: '1 AED = сум', decimals: 0 }
];

const normalizeQuoteRates = (raw: Partial<QuoteRates> | undefined, usdToAed?: number): QuoteRates => {
  const next: QuoteRates = { ...DEFAULT_QUOTE_RATES, ...(raw || {}), AED: 1 };
  (Object.keys(DEFAULT_QUOTE_RATES) as QuoteCurrency[]).forEach((code) => {
    const parsed = Number(next[code]);
    next[code] = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_QUOTE_RATES[code];
  });
  if ((!raw?.USD || !Number.isFinite(Number(raw.USD))) && Number.isFinite(Number(usdToAed)) && Number(usdToAed) > 0) {
    next.USD = 1 / Number(usdToAed);
  }
  next.AED = 1;
  return next;
};

const usdToAedFromQuoteRates = (rates: QuoteRates) => {
  const usdPerAed = Number(rates.USD || 0);
  return usdPerAed > 0 ? 1 / usdPerAed : 3.67;
};

const quoteCurrencyDecimals = (currency: string) => (
  currency === 'AED' || currency === 'RUB' || currency === 'KZT' || currency === 'UZS' ? 0 : 2
);

const buildQuoteRateInputs = (rates: QuoteRates) => ({
  TJS: String(Number(rates.TJS || DEFAULT_QUOTE_RATES.TJS)),
  KZT: String(Number(rates.KZT || DEFAULT_QUOTE_RATES.KZT)),
  RUB: String(Number(rates.RUB || DEFAULT_QUOTE_RATES.RUB)),
  UZS: String(Number(rates.UZS || DEFAULT_QUOTE_RATES.UZS))
});

const sanitizeDecimalInput = (raw: string) => {
  const normalized = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const [head = '', ...tail] = normalized.split('.');
  return tail.length > 0 ? `${head}.${tail.join('')}` : head;
};


const ORDER_DETAILS_SAFE_BOTTOM = 'env(safe-area-inset-bottom)';
const ORDER_DETAILS_DOCK_SAFE_PADDING = `calc(10px + ${ORDER_DETAILS_SAFE_BOTTOM})`;
const ORDER_DETAILS_SCROLL_PADDING = `calc(4.75rem + ${ORDER_DETAILS_SAFE_BOTTOM} + 8px)`;

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
  none: { label: 'Без оплаты', tone: 'bg-white/[0.14] text-white/[0.78] ring-white/[0.12]' },
  search_deposit_paid: { label: 'Депозит подтверждён', tone: 'bg-amber-300/16 text-amber-100 ring-amber-200/24' },
  full_prepayment_paid: { label: 'Полная предоплата', tone: 'bg-emerald-300/16 text-emerald-100 ring-emerald-200/24' }
};

const STAGE_COPY: Record<string, { label: string; helper: string }> = {
  inquiry: { label: 'Заявка', helper: 'Принять запрос и удержать клиента в диалоге.' },
  data_collection: { label: 'Данные', helper: 'VIN, фото авто, доставка и точные детали.' },
  preliminary_estimate: { label: 'Оценка', helper: 'Дать ориентир без активного поиска.' },
  deposit_gate: { label: 'Депозит', helper: 'Активный поиск начинается после депозита.' },
  active_search: { label: 'Поиск', helper: 'Поставщики, медиа, цены и варианты.' },
  final_quote: { label: 'Смета', helper: 'Отправить финальное предложение и условия.' },
  full_prepayment: { label: 'Предоплата', helper: 'Защитить сделку перед закупкой.' },
  purchase: { label: 'Закупка', helper: 'Покупать только после защищённых условий.' },
  inspection: { label: 'Проверка', helper: 'Зафиксировать состояние, маркировки и дефекты.' },
  packing: { label: 'Упаковка', helper: 'Зафиксировать упаковку перед передачей в карго.' },
  cargo_handover: { label: 'Карго', helper: 'Только для export/cargo: фото упаковки или накладная перевозчика.' },
  completed: { label: 'Закрыто', helper: 'Сделка завершена.' }
};

const READINESS_COPY: Record<string, string> = {
  vin: 'VIN',
  car_photo: 'Фото авто',
  part: 'Точная деталь',
  delivery: 'Место доставки',
  price: 'Цена подтверждена',
  terms: 'Условия отправлены',
  prepayment: 'Депозит/оплата',
  cargo_risk: 'Риск карго',
  proof_pack: 'Пруфы начаты'
};

const PROOF_COPY: Record<string, string> = {
  car_photo: 'Фото авто',
  requested_parts: 'Список деталей',
  supplier_offer: 'Оффер поставщика',
  condition_media: 'Состояние детали',
  supplier_photos: 'Фото поставщика',
  serial_marking: 'Номер / маркировка',
  defects: 'Дефекты',
  inspection_video: 'Видео проверки',
  before_purchase: 'До покупки',
  after_purchase: 'После покупки',
  packing: 'Упаковка',
  cargo_handover: 'Передача в cargo',
  condition_comment: 'Комментарий состояния'
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
const MAX_CHAT_ATTACHMENT_FILE_SIZE_MB = 12;
const WAVEFORM_SAMPLE_MS = 80;
const VOICE_HOLD_START_MS = 120;
const VOICE_CANCEL_SWIPE_PX = 72;
const VOICE_LOCK_SWIPE_PX = 64;
const VOICE_GESTURE_DEAD_ZONE_PX = 10;
const VOICE_MIN_DURATION_SECONDS = 1;

type VoiceGestureAxis = 'x' | 'y' | null;
type VoiceGestureVisual = {
  axis: VoiceGestureAxis;
  cancelProgress: number;
  lockProgress: number;
  offsetX: number;
  offsetY: number;
};

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
  const restoredTab = resolveOrderDetailsTab((location.state as { restoreActiveTab?: unknown; orderActiveTab?: unknown } | null)?.restoreActiveTab)
    || resolveOrderDetailsTab((location.state as { restoreActiveTab?: unknown; orderActiveTab?: unknown } | null)?.orderActiveTab)
    || 'overview';
  const { orders, isLoading, updateOrder, deleteOrder, removePart, suppliers, fetchOrderDetails } = useStore();
  const { settings, updateSettings } = useAppSettings();
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
  const savedQuoteRates = useMemo(() => normalizeQuoteRates(settings.defaultQuoteRates, settings.defaultExchangeRate || order.exchangeRate || 3.67), [order.exchangeRate, settings.defaultExchangeRate, settings.defaultQuoteRates]);
  const preferredExchangeRate = Number(settings.defaultExchangeRate || usdToAedFromQuoteRates(savedQuoteRates) || order.exchangeRate || 3.67);
  
  // State for handling missing order
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const [activeTab, setActiveTab] = useState<OrderDetailsTab>(restoredTab);
  const [gallery, setGallery] = useState<{ images: string[]; index: number; partId?: string } | null>(null);
  const [videoPreview, setVideoPreview] = useState<{ videos: string[]; index: number } | null>(null);
  const [deletePartId, setDeletePartId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNotePhotos, setNewNotePhotos] = useState<string[]>([]);
  const [newNoteAudios, setNewNoteAudios] = useState<Array<string | VoiceNoteAudio>>([]);
  const [newNoteAttachments, setNewNoteAttachments] = useState<ChatAttachment[]>([]);
  const [newProofText, setNewProofText] = useState('');
  const [newProofVideoUrl, setNewProofVideoUrl] = useState('');
  const [newProofPhotos, setNewProofPhotos] = useState<string[]>([]);
  const [newProofAudios, setNewProofAudios] = useState<Array<string | VoiceNoteAudio>>([]);
  const [newProofAttachments, setNewProofAttachments] = useState<ChatAttachment[]>([]);
  const [proofComposerMode, setProofComposerMode] = useState<'message' | 'video'>('message');
  const noteFileRef = useRef<HTMLInputElement>(null);
  const carFileRef = useRef<HTMLInputElement>(null);
  const noteAudioFileRef = useRef<HTMLInputElement>(null);
  const proofFileRef = useRef<HTMLInputElement>(null);
  const chatMediaInputRef = useRef<HTMLInputElement>(null);
  const chatCameraInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const attachmentTargetRef = useRef<'note' | 'proof'>('proof');
  const proofSnapshotSignatureRef = useRef('');

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
  const recordingTargetRef = useRef<'note' | 'proof'>('note');
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingActiveSinceRef = useRef<number | null>(null);
  const recordingElapsedMsRef = useRef(0);
  const recordingElapsedSecondsRef = useRef(0);
  const recordingStopRequestedRef = useRef(false);
  const voiceHoldTimerRef = useRef<number | null>(null);
  const voicePointerRef = useRef<{ target: 'note' | 'proof'; pointerId: number; startX: number; startY: number; active: boolean } | null>(null);
  const voiceAutoSendOnReadyRef = useRef(false);
  const voiceCancelAfterStartRef = useRef(false);
  const voiceGestureAxisRef = useRef<VoiceGestureAxis>(null);
  const voiceCancelReadyRef = useRef(false);
  const voiceLockReadyRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const smoothedAmplitudeRef = useRef(0.12);
  const recordingWaveformRef = useRef<number[]>(Array.from({ length: 56 }, () => 12));
  const [recordingWaveform, setRecordingWaveform] = useState<number[]>(Array.from({ length: 40 }, () => 10));
  const [voiceGestureVisual, setVoiceGestureVisual] = useState<VoiceGestureVisual>({ axis: null, cancelProgress: 0, lockProgress: 0, offsetX: 0, offsetY: 0 });
  const [voicePausePreview, setVoicePausePreview] = useState<VoiceNoteAudio | null>(null);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingSavedLocally, setRecordingSavedLocally] = useState(false);
  const [isAttachmentSheetOpen, setIsAttachmentSheetOpen] = useState(false);
  const [isVoiceLocked, setIsVoiceLocked] = useState(false);
  const [isVoicePressing, setIsVoicePressing] = useState(false);
  const [deleteNoteConfirmId, setDeleteNoteConfirmId] = useState<string | null>(null);
  const [tabMotionDirection, setTabMotionDirection] = useState<'forward' | 'back'>('forward');

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
  const [partCommentDrafts, setPartCommentDrafts] = useState<Record<string, string>>({});
  const [partMediaLinkDrafts, setPartMediaLinkDrafts] = useState<Record<string, string>>({});
  const [partMediaLinkEditing, setPartMediaLinkEditing] = useState<Record<string, boolean>>({});
  const [partCommentExpanded, setPartCommentExpanded] = useState<Record<string, boolean>>({});
  const [partGroupExpanded, setPartGroupExpanded] = useState<Record<string, boolean>>({});
  const [partSwipeOffsets, setPartSwipeOffsets] = useState<Record<string, number>>({});
  // Multiple photos for new part
  const [newPartPhotos, setNewPartPhotos] = useState<string[]>([]);
  const partFileRef = useRef<HTMLInputElement>(null);
  const partInputRef = useRef<HTMLInputElement>(null);
  const partsListRef = useRef<HTMLDivElement>(null);
  const partSwipeRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const vehicleSectionRef = useRef<HTMLDivElement>(null);
  const markupSectionRef = useRef<HTMLDivElement>(null);
  const addPartSectionRef = useRef<HTMLDivElement>(null);
  const notesSectionRef = useRef<HTMLDivElement>(null);
  const detailsScreenSectionRef = useRef<HTMLDivElement>(null);
  const [showOnlyOpenParts, setShowOnlyOpenParts] = useState(false);

  // Exchange Rate Input State (Controlled)
  const [rateInput, setRateInput] = useState(order ? preferredExchangeRate.toString() : '3.67');
  const [quoteRateInputs, setQuoteRateInputs] = useState<Record<string, string>>(() => buildQuoteRateInputs(savedQuoteRates));
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [isLaunchingRadar, setIsLaunchingRadar] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingOverviewBlock, setEditingOverviewBlock] = useState<'client' | 'vehicle' | null>(null);
  const [isQuoteRatesExpanded, setIsQuoteRatesExpanded] = useState(false);
  const [isClientBlockExpanded, setIsClientBlockExpanded] = useState(false);
  const [isVehicleBlockExpanded, setIsVehicleBlockExpanded] = useState(false);
  const [isVehicleDetailsExpanded, setIsVehicleDetailsExpanded] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [manualCopyValue, setManualCopyValue] = useState('');
  const [deleteOrderConfirmOpen, setDeleteOrderConfirmOpen] = useState(false);
  const [isDepositDialogOpen, setIsDepositDialogOpen] = useState(false);
  const [depositAmountInput, setDepositAmountInput] = useState('');
  const [depositCurrencyInput, setDepositCurrencyInput] = useState<NonNullable<Order['searchDepositCurrency']>>('AED');
  const [depositRateInput, setDepositRateInput] = useState('1');
  const [markupFixedInput, setMarkupFixedInput] = useState(order?.markupFixedAed?.toString() || '0');
  const [discountFixedInput, setDiscountFixedInput] = useState(order?.discountFixedAed?.toString() || '0');
  const [orderMediaFolderDraft, setOrderMediaFolderDraft] = useState(order?.googleDriveFolderUrl || '');
  const [isOrderMediaFolderEditing, setIsOrderMediaFolderEditing] = useState(false);
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
  const discountCommitTimerRef = useRef<number | null>(null);
  const exchangeRateCommitTimerRef = useRef<number | null>(null);
  const deferredFieldTimersRef = useRef<Partial<Record<keyof Order, number>>>({});
  const deferredFieldValuesRef = useRef<Partial<Record<keyof Order, any>>>({});
  const orderRef = useRef<Order | undefined>(order);
  const manualCopyInputRef = useRef<HTMLInputElement>(null);
  const [draftFields, setDraftFields] = useState<Partial<Record<keyof Order, any>>>({});
  const lastKeystrokeAtRef = useRef<number>(0);
  const isClientEditMode = editingOverviewBlock === 'client' || isEditMode;
  const isVehicleEditMode = editingOverviewBlock === 'vehicle' || isEditMode;

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  // Sync local rate input if order changes
  useEffect(() => {
    if (order) setRateInput(preferredExchangeRate.toString());
    setQuoteRateInputs(buildQuoteRateInputs(savedQuoteRates));
  }, [order?.id, order?.exchangeRate, preferredExchangeRate, savedQuoteRates]);

  useEffect(() => {
    setMarkupFixedInput((order?.markupFixedAed || 0).toString());
  }, [order?.id, order?.markupFixedAed]);

  useEffect(() => {
    setDiscountFixedInput((order?.discountFixedAed || 0).toString());
  }, [order?.id, order?.discountFixedAed]);

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
    setPartCommentExpanded({});
  }, [orderMissing, order.id]);

  useEffect(() => () => {
    if (pricingSaveDebounceRef.current) window.clearTimeout(pricingSaveDebounceRef.current);

    if (markupCommitTimerRef.current) {
      window.clearTimeout(markupCommitTimerRef.current);
      markupCommitTimerRef.current = null;
    }

    if (discountCommitTimerRef.current) {
      window.clearTimeout(discountCommitTimerRef.current);
      discountCommitTimerRef.current = null;
    }

    if (exchangeRateCommitTimerRef.current) {
      window.clearTimeout(exchangeRateCommitTimerRef.current);
      exchangeRateCommitTimerRef.current = null;
      const normalizedRate = parseFloat(String(rateInput).replace(',', '.'));
      const latestOrder = orderRef.current;
      if (latestOrder && Number.isFinite(normalizedRate) && normalizedRate > 0 && normalizedRate !== Number(latestOrder.exchangeRate || 0)) {
        void updateOrder({ ...latestOrder, exchangeRate: normalizedRate });
        updateSettings({ defaultExchangeRate: normalizedRate, defaultQuoteRates: { ...currentQuoteRates, USD: 1 / normalizedRate } });
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
    if (!manualCopyValue) return;
    const timer = window.setTimeout(() => {
      manualCopyInputRef.current?.focus();
      manualCopyInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [manualCopyValue]);


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

  const currentQuoteRates = useMemo(() => {
    const next = normalizeQuoteRates(savedQuoteRates, preferredExchangeRate);
    const usdToAed = Number(sanitizeDecimalInput(rateInput));
    if (Number.isFinite(usdToAed) && usdToAed > 0) next.USD = 1 / usdToAed;
    QUOTE_RATE_FIELDS.forEach(({ code }) => {
      if (code === 'USD') return;
      const parsed = Number(sanitizeDecimalInput(quoteRateInputs[code] || ''));
      if (Number.isFinite(parsed) && parsed > 0) next[code] = parsed;
    });
    next.AED = 1;
    return next;
  }, [preferredExchangeRate, quoteRateInputs, rateInput, savedQuoteRates]);

  const shareQuote = async (options?: { rates: QuoteRates; currency: QuoteCurrency; sendPublicQuote?: boolean }) => {
    if (orderMissing) return;
    try {
      setToast({ message: 'Создаю ссылку на смету...' });
      const parsedRateInput = parseFloat(sanitizeDecimalInput(String(rateInput || '')));
      const quoteExchangeRate = Number.isFinite(parsedRateInput) && parsedRateInput > 0
        ? parsedRateInput
        : preferredExchangeRate;
      updateSettings({ defaultExchangeRate: quoteExchangeRate, defaultQuoteRates: currentQuoteRates });
      const nextParts = order.parts || [];
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
      const quoteOrder: Order = {
        ...order,
        parts: nextParts,
        salesStatus: 'Price Sent',
        status: order.status === 'lead' || order.status === 'waiting_deposit' ? 'in_progress' : order.status,
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
        discountType,
        discountPercent: effectiveDiscountPercent,
        discountFixedAed: Number(discountFixedInput || order.discountFixedAed || 0),
        exchangeRate: quoteExchangeRate
      };

      const saveOrderPromise = updateOrder(quoteOrder);
      if (options?.sendPublicQuote === false) {
        const saved = await saveOrderPromise;
        if (saved === false) throw new Error('Не удалось сохранить заказ перед отправкой');
        setToast({ message: 'Смета обновлена' });
        return;
      }
      const shareQuotePromise = shareQuoteLink(quoteOrder, {
        ...options,
        rates: options?.rates || currentQuoteRates,
        snapshotToken: order.publicQuoteToken || undefined,
        upsertByToken: !!order.publicQuoteToken
      });
      const saved = await saveOrderPromise;
      if (saved === false) throw new Error('Не удалось сохранить заказ перед отправкой');
      const shareResult = await shareQuotePromise;
      if (shareResult.token && shareResult.token !== order.publicQuoteToken) {
        await updateOrder({ ...quoteOrder, publicQuoteToken: shareResult.token });
      }
      setToast({ message: shareResult.method === 'native' ? 'Смета готова к отправке' : 'Ссылка скопирована и открыта для отправки' });
      return shareResult;
    } catch (error) {
      console.error('[shareQuote] failed', error);
      setToast({ message: error instanceof Error ? `Смета не отправлена: ${error.message}` : 'Смета не отправлена' });
    }
  };

  const refreshPublicQuoteSnapshot = async (nextOrder: Order) => {
    if (!nextOrder.publicQuoteToken) return;
    try {
      await publicQuoteCreateSnapshot(nextOrder, {
        currency: nextOrder.clientCurrency || 'USD',
        exchangeRate: Number(nextOrder.exchangeRate || preferredExchangeRate || 3.67),
        token: nextOrder.publicQuoteToken,
        upsertByToken: true,
        owner: {
          whatsappPhone: settings.publicWhatsappNumber,
          displayName: 'Stark Motors'
        },
        publicSettings: {
          publicWhatsappNumber: settings.publicWhatsappNumber,
          publicTelegramUrl: settings.publicTelegramUrl,
          publicInstagramUrl: settings.publicInstagramUrl,
          publicWebsiteUrl: settings.publicWebsiteUrl,
          publicEmail: settings.publicEmail,
          publicDeliveryTerms: settings.publicDeliveryTerms,
          publicWorkTerms: settings.publicWorkTerms,
          publicCompanyLogoUrl: settings.publicCompanyLogoUrl,
          publicInvoiceSignatureUrl: settings.publicInvoiceSignatureUrl,
          publicManagerName: settings.publicManagerName,
          invoicePaymentAccountNo: settings.invoicePaymentAccountNo,
          invoicePaymentBeneficiary: settings.invoicePaymentBeneficiary,
          invoicePaymentBankAccount: settings.invoicePaymentBankAccount,
          publicTermsFileUrl: settings.publicTermsFileUrl,
          publicTermsFileName: settings.publicTermsFileName,
          executorPhotoUrl: settings.executorPhotoUrl,
          executorRole: settings.executorRole
        },
        rates: currentQuoteRates
      });
    } catch (error) {
      void logger.warn('order-details:proof-public-quote-refresh', 'Unable to refresh public quote after proof update', {
        orderId: nextOrder.id,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  };

  useEffect(() => {
    if (activeTab !== 'proof' || !order.publicQuoteToken) return;
    const clientProofNotes = (order.notes || []).filter((note) => note.visibility === 'client' || note.kind === 'proof');
    if (clientProofNotes.length === 0) return;

    const signature = JSON.stringify(clientProofNotes.map((note) => ({
      id: note.id,
      text: note.text,
      createdAt: note.createdAt,
      photos: note.photos || [],
      videoUrls: note.videoUrls || [],
      audios: (note.audios || []).map((audio) => typeof audio === 'string' ? audio : {
        id: audio.id,
        fileUrl: audio.fileUrl,
        duration: audio.duration,
        waveform: audio.waveform,
        createdAt: audio.createdAt
      }),
      attachments: (note.attachments || []).map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        name: attachment.name,
        value: attachment.value,
        fileUrl: attachment.fileUrl,
        mimeType: attachment.mimeType,
        size: attachment.size,
        latitude: attachment.latitude,
        longitude: attachment.longitude,
        address: attachment.address,
        phone: attachment.phone,
        createdAt: attachment.createdAt
      }))
    })));

    if (proofSnapshotSignatureRef.current === signature) return;
    proofSnapshotSignatureRef.current = signature;
    void refreshPublicQuoteSnapshot(order);
  }, [activeTab, order, order.publicQuoteToken, order.notes]);

  const getFinanceVariant = (part: Part) => {
    return resolveFinanceVariant(part);
  };

  const selectedOfferTotals = useMemo(() => order.parts.reduce((sum, part) => {
    const matchingVariant = getFinanceVariant(part);
    const quantity = Math.max(1, Number(part.quantity || 1));
    if (!matchingVariant) return sum;
    const bestSale = Number(matchingVariant.salePriceAed ?? matchingVariant.priceAed ?? 0);
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
  const effectiveExchangeRate = usdToAedFromQuoteRates(currentQuoteRates) || preferredExchangeRate;
  const cargoTotalUsd = Number(order.logistics?.cargoTotalCostUsd ?? 0);
  const cargoTotalAed = cargoTotalUsd * effectiveExchangeRate;
  const logisticsWithCargoTotal = logisticsTotal + cargoTotalAed;
  const cargoEstimates = useMemo(() => calculateCargoEstimates(order, settings), [order, settings]);
  const cargoTariffOptions = (settings.cargoTariffs?.length ? settings.cargoTariffs : DEFAULT_CARGO_TARIFFS);
  const markupType = order.markupType || 'percent';
  const effectiveMarkupPercent = Number(draftFields.markupPercent ?? order.markupPercent ?? 0);
  const discountType = order.discountType || 'percent';
  const effectiveDiscountPercent = Number(draftFields.discountPercent ?? order.discountPercent ?? 0);
  const pricingPreviewOrder = useMemo(() => ({
    ...order,
    markupPercent: effectiveMarkupPercent,
    markupFixedAed: markupType === 'fixed' ? Number(markupFixedInput || 0) : order.markupFixedAed,
    discountPercent: effectiveDiscountPercent,
    discountFixedAed: discountType === 'fixed' ? Number(discountFixedInput || 0) : order.discountFixedAed
  }), [order, effectiveMarkupPercent, markupType, markupFixedInput, effectiveDiscountPercent, discountType, discountFixedInput]);
  const pricedPartLines = useMemo(() => getPricedPartLines(pricingPreviewOrder), [pricingPreviewOrder]);
  const markupAed = useMemo(() => pricedPartLines.reduce((sum, line) => sum + line.markupShareAed, 0), [pricedPartLines]);
  const sellPartsTotalAed = useMemo(() => pricedPartLines.reduce((sum, line) => sum + line.clientLineTotalAed, 0), [pricedPartLines]);
  const discountAed = useMemo(() => calculateOrderDiscountAed(sellPartsTotalAed + logisticsWithCargoTotal, pricingPreviewOrder), [logisticsWithCargoTotal, pricingPreviewOrder, sellPartsTotalAed]);
  const sellTotalAed = sellPartsTotalAed + logisticsWithCargoTotal;
  const depositAmountAed = Math.max(0, Number(order.searchDepositAmountAed || 0));
  const balanceDueAed = Math.max(0, sellTotalAed - depositAmountAed);
  const canComputeProfit = selectedOfferTotal > 0;
  const baseMarginAed = canComputeProfit ? selectedOfferTotals.sale - selectedOfferTotals.purchase : 0;
  const netProfitAed = canComputeProfit ? baseMarginAed + markupAed - discountAed : null;
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
    markupFixedAed: (order.markupType || 'percent') === 'fixed' ? Number(markupFixedInput || 0) : order.markupFixedAed,
    discountFixedAed: (order.discountType || 'percent') === 'fixed' ? Number(discountFixedInput || 0) : order.discountFixedAed
  }), [discountFixedInput, logistics.deliveryAed, logistics.packingAed, logistics.serviceFeeAed, markupFixedInput, order]);
  const fullPrepaymentPaid = order.paymentStatus === 'full_prepayment_paid' || order.salesStatus === 'Paid';
  const safetyProgressText = `${safetySummary.readiness.completed}/${safetySummary.readiness.total}`;

  const rateByCurrency: Record<string, number> = currentQuoteRates;
  const clientCurrency = order.clientCurrency || 'AED';
  const clientRate = rateByCurrency[clientCurrency] || 1;
  const formatMoney = (value: number, currency = 'AED') => {
    const targetRate = currency === 'AED' ? 1 : (rateByCurrency[currency] || clientRate || 1);
    const amount = currency === 'AED' ? value : value * targetRate;
    return `${amount.toFixed(quoteCurrencyDecimals(currency))} ${currency}`;
  };
  const formatDualMoney = (value: number) => {
    if (clientCurrency === 'AED') return formatMoney(value);
    return `${formatMoney(value)} / ${formatMoney(value, clientCurrency)}`;
  };

  const calculateCurrentProfit = () => {
    if (!canComputeProfit || netProfitAed === null) return 0;
    return netProfitAed / effectiveExchangeRate;
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


  const normalizedSelectedTemplate = messageTemplates[0] || '';

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
    if (!isClientEditMode) return;
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
    if (!isClientEditMode) return;
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
    order.bodyType ? `Кузов: ${order.bodyType}` : '',
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
      markupPercent: 'Маржа %',
      markupType: 'Тип наценки',
      markupFixedAed: 'Наценка (фикс AED)',
      exchangeRate: 'Курс валюты',
      clientCurrency: 'Валюта клиента'
    };

    trackedFieldLabels.discountPercent = 'Скидка %';
    trackedFieldLabels.discountType = 'Тип скидки';
    trackedFieldLabels.discountFixedAed = 'Скидка (фикс AED)';

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
    const keyStart = performance.now();
    const shouldDebounce = (typeof value === 'string' || typeof value === 'number')
      && !['markupPercent', 'markupType', 'markupFixedAed', 'discountPercent', 'discountType', 'discountFixedAed', 'clientCurrency', 'salesStatus', 'priority', 'deliveryType', 'socialNickname'].includes(String(field));

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
    const currentOrder = orderRef.current;
    if (!currentOrder) return;

    const nextZones = Array.from(new Set(zones.map((zone) => zone.trim()).filter(Boolean)));
    updateOrder({
      ...currentOrder,
      zones: nextZones.length > 0 ? nextZones : undefined,
      zone: nextZones[0] || undefined
    });
  }, [updateOrder]);

  const updatePriority = (nextPriority: Priority) => {
    updateOrder({ ...order, priority: nextPriority, priorityChangedAt: Date.now() });
  };

  const depositPaid = order.searchDepositStatus === 'paid'
    || order.paymentStatus === 'search_deposit_paid'
    || order.paymentStatus === 'full_prepayment_paid';
  const sourcingLocked = !depositPaid;

  const copyText = async (value: string, success = 'Скопировано') => {
    if (!value) return;
    const copyWithFallback = () => {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.left = '0';
      textarea.style.top = '0';
      textarea.style.width = '1px';
      textarea.style.height = '1px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, value.length);
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    };

    try {
      if (copyWithFallback()) {
        setManualCopyValue('');
        setToast({ message: success });
        return;
      }
    } catch {
      // Try the async Clipboard API below.
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        setManualCopyValue('');
        setToast({ message: success });
        return;
      }
    } catch {
      // Fall through to manual copy UI.
    }
    setToast(null);
    setManualCopyValue(value);
  };

  const getDepositRate = useCallback((currency: NonNullable<Order['searchDepositCurrency']>) => (
    currency === 'AED' ? 1 : 1 / Number(rateByCurrency[currency] || 1)
  ), [rateByCurrency]);

  useEffect(() => {
    if (orderMissing) return;
    const currency = order.searchDepositCurrency || order.clientCurrency || 'AED';
    setDepositCurrencyInput(currency);
    setDepositAmountInput(order.searchDepositAmount ? String(order.searchDepositAmount) : '');
    setDepositRateInput(String(order.searchDepositExchangeRate || getDepositRate(currency)));
  }, [getDepositRate, order.clientCurrency, order.id, order.searchDepositAmount, order.searchDepositCurrency, order.searchDepositExchangeRate, order.searchDepositPaidAt, orderMissing]);

  const confirmDeposit = useCallback(() => {
    const currency = order.searchDepositCurrency || order.clientCurrency || 'AED';
    setDepositCurrencyInput(currency);
    setDepositAmountInput(order.searchDepositAmount ? String(order.searchDepositAmount) : '');
    setDepositRateInput(String(getDepositRate(currency)));
    setIsDepositDialogOpen(true);
  }, [getDepositRate, order.clientCurrency, order.searchDepositAmount, order.searchDepositCurrency]);

  const submitDeposit = useCallback(() => {
    const amount = Number(sanitizeDecimalInput(String(depositAmountInput || '0')));
    const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
    const rate = depositCurrencyInput === 'AED'
      ? 1
      : Number(sanitizeDecimalInput(String(depositRateInput || ''))) || getDepositRate(depositCurrencyInput);
    const safeRate = Number.isFinite(rate) && rate > 0 ? rate : getDepositRate(depositCurrencyInput);
    const amountAed = depositCurrencyInput === 'AED' ? safeAmount : safeAmount * safeRate;
    const paidAt = Date.now();
    const noteText = safeAmount > 0
      ? [
          `Депозит: ${safeAmount.toFixed(depositCurrencyInput === 'AED' ? 0 : 2)} ${depositCurrencyInput}`,
          depositCurrencyInput !== 'AED' ? `В AED: ${amountAed.toFixed(0)} AED, курс ${safeRate}` : '',
          `Время: ${new Date(paidAt).toLocaleString('ru-RU')}`
        ].filter(Boolean).join('\n')
      : `Депозит подтверждён: 0\nВремя: ${new Date(paidAt).toLocaleString('ru-RU')}`;
    const depositNote: OrderNote = {
      id: `deposit-${paidAt}`,
      text: noteText,
      photos: [],
      audios: [],
      kind: 'note',
      createdAt: paidAt
    };
    void updateOrder({
      ...order,
      searchDepositStatus: 'paid',
      searchDepositAmount: safeAmount,
      searchDepositCurrency: depositCurrencyInput,
      searchDepositExchangeRate: safeRate,
      searchDepositAmountAed: Math.round(amountAed * 100) / 100,
      searchDepositPaidAt: paidAt,
      paymentStatus: 'search_deposit_paid',
      status: order.status === 'lead' || order.status === 'waiting_deposit' ? 'in_progress' : order.status,
      customerStatus: order.customerStatus === 'LEAD' ? 'INQUIRY' : order.customerStatus,
      notes: [depositNote, ...(order.notes || [])]
    });
    setIsDepositDialogOpen(false);
    setToast({ message: safeAmount > 0 ? `Депозит сохранён: ${formatMoney(amountAed)}` : 'Депозит подтверждён без суммы.' });
  }, [depositAmountInput, depositCurrencyInput, depositRateInput, formatMoney, getDepositRate, order, updateOrder]);

  const confirmFullPrepayment = useCallback(() => {
    if (fullPrepaymentPaid) return;
    void updateOrder({
      ...order,
      searchDepositStatus: 'paid',
      paymentStatus: 'full_prepayment_paid',
      salesStatus: 'Paid',
      status: order.status === 'lead' || order.status === 'waiting_deposit' ? 'in_progress' : order.status,
      customerStatus: order.customerStatus === 'LEAD' ? 'INQUIRY' : order.customerStatus
    });
    setToast({ message: 'Предоплата подтверждена. Можно готовить закупку.' });
  }, [fullPrepaymentPaid, order, updateOrder]);

  const completeOrder = useCallback(() => {
    if (order.isSold || order.salesStatus === 'Completed') return;
    void updateOrder({
      ...order,
      isSold: true,
      salesStatus: 'Completed',
      status: 'sold'
    });
    setToast({ message: 'Заказ закрыт.' });
  }, [order, updateOrder]);

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
    setToast({ message: 'Ссылка открыта. Проверьте доступ: любой по ссылке может просматривать.' });
    return true;
  }, []);

  const saveOrderMediaFolder = useCallback((rawValue = orderMediaFolderDraft, options?: { showToast?: boolean }) => {
    const currentOrder = orderRef.current;
    if (!currentOrder) return String(rawValue || '').trim();
    const nextValue = String(rawValue || '').trim();
    const currentValue = String(currentOrder.googleDriveFolderUrl || '').trim();
    if (nextValue !== currentValue) {
      void updateOrder({ ...currentOrder, googleDriveFolderUrl: nextValue });
      if (options?.showToast) setToast({ message: nextValue ? 'Папка заказа сохранена' : 'Папка заказа очищена' });
    }
    if (nextValue) setIsOrderMediaFolderEditing(false);
    return nextValue;
  }, [orderMediaFolderDraft, updateOrder]);

  const savePartMediaLink = useCallback((partId: string, rawValue?: string, options?: { showToast?: boolean }) => {
    const nextValue = String(rawValue ?? partMediaLinkDrafts[partId] ?? '').trim();
    const currentOrder = orderRef.current;
    if (!currentOrder) return nextValue;
    const currentPart = (currentOrder.parts || []).find((item) => item.id === partId);
    const currentValue = String((currentPart as any)?.googleDriveVideoUrl || '').trim();
    if (currentPart && nextValue !== currentValue) {
      const updatedParts = currentOrder.parts.map((item) => (
        item.id === partId ? { ...item, googleDriveVideoUrl: nextValue } : item
      ));
      void updateOrder({ ...currentOrder, parts: updatedParts });
      if (options?.showToast) setToast({ message: nextValue ? 'Медиа-ссылка сохранена' : 'Медиа-ссылка очищена' });
    }
    if (nextValue) setPartMediaLinkEditing((prev) => ({ ...prev, [partId]: false }));
    return nextValue;
  }, [partMediaLinkDrafts, updateOrder]);

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

  const updatePartSalePrice = useCallback((partId: string, rawValue: string) => {
    const nextSalePrice = Number(sanitizeNumericInput(rawValue) || 0);
    const currentOrder = orderRef.current;
    if (!currentOrder) return;
    const nextParts = (currentOrder.parts || []).map((part) => {
      if (part.id !== partId) return part;
      const variants = Array.isArray(part.variants) ? part.variants : [];
      const targetVariant = variants.find((variant) => variant.id === part.bestOfferId || variant.isBest) || variants[0];
      if (!targetVariant) return part;
      return {
        ...part,
        variants: variants.map((variant) => variant.id === targetVariant.id
          ? {
              ...variant,
              salePriceAed: nextSalePrice,
              priceAed: nextSalePrice,
              updatedAt: Date.now()
            }
          : variant)
      };
    });
    void updateOrder({ ...currentOrder, parts: nextParts });
  }, [updateOrder]);

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

    const nextParts = order.parts || [];
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
    setToast({ message: 'Услуги сохранены' });
  }, [hasPendingPricingChanges, logisticsDraft.deliveryAed, logisticsDraft.packingAed, logisticsDraft.serviceFeeAed, markupFixedInput, order, scheduleDebouncedSaveLog, settings, updateOrder]);

  useEffect(() => {
    if (!hasPendingPricingChanges) return;
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
  }, [hasPendingPricingChanges, saveLogisticsDraft]);

  const updateLogisticsField = (field: 'deliveryType', value: string) => {
    const event = createPricingEvent('logistics.deliveryType', 'Тип доставки', order.logistics?.deliveryType || 'uae', value);
    updateOrder({ ...order, logistics: { ...order.logistics, deliveryType: value as 'uae' | 'export' }, pricingEvents: event ? [event, ...(order.pricingEvents || [])] : order.pricingEvents });
    return value;
  };


  const updateCargoField = (patch: Record<string, unknown>) => {
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

  const saveQuoteRates = useCallback((rates = currentQuoteRates, usdToAed = usdToAedFromQuoteRates(rates)) => {
    const nextUsdToAed = Number.isFinite(usdToAed) && usdToAed > 0 ? usdToAed : preferredExchangeRate;
    updateSettings({ defaultExchangeRate: nextUsdToAed, defaultQuoteRates: rates });
    if (nextUsdToAed !== Number(order.exchangeRate || 0)) {
      updateOrderField('exchangeRate', nextUsdToAed);
    }
  }, [currentQuoteRates, order.exchangeRate, preferredExchangeRate, updateSettings]);

  const handleRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const startedAt = performance.now();
    const rawVal = e.target.value;
    if (!/^[\d]*[.,]?[\d]*$/.test(rawVal)) return;

    setRateInput(rawVal);

    const normalized = sanitizeDecimalInput(rawVal);
    const isCompleteDecimal = normalized !== '' && normalized !== '.' && !normalized.endsWith('.');
    const num = parseFloat(normalized);

    if (isCompleteDecimal && !isNaN(num) && num > 0) {
      if (exchangeRateCommitTimerRef.current) window.clearTimeout(exchangeRateCommitTimerRef.current);
      exchangeRateCommitTimerRef.current = window.setTimeout(() => {
        saveQuoteRates({ ...currentQuoteRates, USD: 1 / num }, num);
        exchangeRateCommitTimerRef.current = null;
      }, 600);
      syncPerf.recordTypingSample(Math.round((performance.now() - startedAt) * 100) / 100);
    }
  };

  const handleQuoteRateInputChange = (code: Exclude<QuoteCurrency, 'AED' | 'USD'>, rawValue: string) => {
    const sanitized = sanitizeDecimalInput(rawValue);
    if (!/^[\d]*[.]?[\d]*$/.test(sanitized)) return;
    setQuoteRateInputs((prev) => ({ ...prev, [code]: sanitized }));
  };


  const flushExchangeRateCommit = useCallback(() => {
    const normalized = String(rateInput || '').replace(',', '.');
    const num = parseFloat(normalized);
    if (!Number.isFinite(num) || num <= 0) return;
    if (exchangeRateCommitTimerRef.current) {
      window.clearTimeout(exchangeRateCommitTimerRef.current);
      exchangeRateCommitTimerRef.current = null;
    }
    saveQuoteRates({ ...currentQuoteRates, USD: 1 / num }, num);
  }, [currentQuoteRates, rateInput, saveQuoteRates]);

  const flushQuoteRateCommit = useCallback(() => {
    saveQuoteRates(currentQuoteRates);
  }, [currentQuoteRates, saveQuoteRates]);

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

  const commitDiscountFixed = useCallback((forcedValue?: number) => {
    const nextValue = forcedValue ?? Number(discountFixedInput || 0);
    const previousValue = Number(order.discountFixedAed || 0);
    const previousType = order.discountType || 'percent';
    if (nextValue === previousValue && previousType === 'fixed') return;

    const amountEvent = createPricingEvent('discountFixedAed', 'Скидка (фикс AED)', previousValue, nextValue);
    const typeEvent = createPricingEvent('discountType', 'Тип скидки', previousType, 'fixed');
    const nextEvents = [amountEvent, typeEvent].filter(Boolean) as OrderPricingEvent[];
    updateOrder({ ...order, discountFixedAed: nextValue, discountType: 'fixed', pricingEvents: nextEvents.length ? [...nextEvents, ...(order.pricingEvents || [])] : order.pricingEvents });
    scheduleDebouncedSaveLog();
  }, [discountFixedInput, order, scheduleDebouncedSaveLog, updateOrder]);

  const flushDiscountCommit = useCallback(() => {
    if (discountCommitTimerRef.current) window.clearTimeout(discountCommitTimerRef.current);
    commitDiscountFixed();
    discountCommitTimerRef.current = null;
  }, [commitDiscountFixed]);

  const handleDiscountFixedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const startedAt = performance.now();
    setDiscountFixedInput(sanitizeNumericInput(e.target.value));
    if (discountCommitTimerRef.current) {
      window.clearTimeout(discountCommitTimerRef.current);
      discountCommitTimerRef.current = null;
    }
    syncPerf.recordTypingSample(Math.round((performance.now() - startedAt) * 100) / 100);
  };

  const togglePartFound = (partId: string) => {
    const updatedParts = order.parts.map(p => {
      if (p.id !== partId) return p;
      const nextFound = !p.isFound;
      return { ...p, isFound: nextFound, status: (nextFound ? 'found' : 'searching') as 'found' | 'searching' };
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

  const getOrderScrollState = () => {
    const mainScroller = document.querySelector('main');
    const restoreScrollTop = mainScroller instanceof HTMLElement ? mainScroller.scrollTop : undefined;
    return typeof restoreScrollTop === 'number' ? { orderScrollTop: restoreScrollTop } : {};
  };

  const openPartDetails = (partId: string, variantId?: string) => {
    navigate(`/order/${order.id}/part/${partId}`, {
      state: {
        backTo: `/order/${order.id}`,
        ...getOrderScrollState(),
        orderActiveTab: activeTab,
        ...(variantId ? { openVariantId: variantId } : {})
      }
    });
  };

  const handlePartSwipeStart = (partId: string, event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    partSwipeRef.current = { id: partId, startX: touch.clientX, startY: touch.clientY };
  };

  const handlePartSwipeMove = (partId: string, event: React.TouchEvent) => {
    const start = partSwipeRef.current;
    const touch = event.touches[0];
    if (!start || start.id !== partId || !touch) return;
    const deltaX = touch.clientX - start.startX;
    const deltaY = touch.clientY - start.startY;
    if (Math.abs(deltaY) > Math.abs(deltaX) + 10) return;
    if (deltaX < 0) {
      setPartSwipeOffsets((prev) => ({ ...prev, [partId]: Math.max(-88, deltaX) }));
    } else if ((partSwipeOffsets[partId] || 0) < 0) {
      setPartSwipeOffsets((prev) => ({ ...prev, [partId]: Math.min(0, deltaX - 88) }));
    }
  };

  const handlePartSwipeEnd = (partId: string) => {
    const offset = partSwipeOffsets[partId] || 0;
    partSwipeRef.current = null;
    if (offset <= -70) {
      setDeletePartId(partId);
    }
    setPartSwipeOffsets((prev) => ({ ...prev, [partId]: 0 }));
  };

  const addNewPart = () => {
    if (sourcingLocked) {
      setToast({ message: 'Сначала подтвердите депозит.' });
      return;
    }
    const parsedGroupItems = newPartKind === 'group' ? normalizeGroupItems(newPartGroupItems) : [];
    if (!newPartName.trim() && parsedGroupItems.length === 0) return;
    const capturedPartName = newPartName.trim() || 'Группа деталей';
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
    setToast({ message: `Добавлено: ${capturedPartName}` });
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

  const haptic = (pattern: number | number[] = 12) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Haptics are best-effort.
      }
    }
  };

  const createChatAttachmentId = () => (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  const formatAttachmentSize = (size?: number) => {
    if (!Number.isFinite(Number(size)) || Number(size) <= 0) return '';
    const bytes = Number(size);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 100 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  };

  const addAttachmentDrafts = (target: 'note' | 'proof', attachments: ChatAttachment[]) => {
    const cleanAttachments = attachments.filter((attachment) => attachment && attachment.name);
    if (cleanAttachments.length === 0) return;
    if (target === 'proof') {
      setNewProofAttachments((prev) => [...prev, ...cleanAttachments]);
      return;
    }
    setNewNoteAttachments((prev) => [...prev, ...cleanAttachments]);
  };

  const readFileAttachmentDrafts = async (files: File[], target: 'note' | 'proof') => {
    const attachments = await Promise.all(files.map(async (file) => {
      if (file.size > MAX_CHAT_ATTACHMENT_FILE_SIZE_MB * 1024 * 1024) {
        setToast({ message: `${file.name} is larger than ${MAX_CHAT_ATTACHMENT_FILE_SIZE_MB}MB` });
        return null;
      }
      const reader = new FileReader();
      const fileUrl = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
      if (!fileUrl) return null;
      return {
        id: createChatAttachmentId(),
        kind: 'file' as const,
        name: file.name || 'File',
        fileUrl,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        createdAt: Date.now()
      };
    }));
    addAttachmentDrafts(target, attachments.filter((item): item is NonNullable<typeof item> => Boolean(item)));
    setIsAttachmentSheetOpen(false);
  };

  const addLocationAttachment = (target: 'note' | 'proof') => {
    setIsAttachmentSheetOpen(false);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setToast({ message: 'Location is not available on this device' });
      return;
    }
    setToast({ message: 'Allow location access to attach location' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));
        addAttachmentDrafts(target, [{
          id: createChatAttachmentId(),
          kind: 'location',
          name: 'Current location',
          value: `https://maps.google.com/?q=${latitude},${longitude}`,
          address: `${latitude}, ${longitude}`,
          latitude,
          longitude,
          createdAt: Date.now()
        }]);
        haptic(10);
      },
      () => {
        setToast({ message: 'Location permission was not granted' });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  };

  const addContactAttachment = (target: 'note' | 'proof') => {
    const contactName = String(order.clientName || settings.publicManagerName || settings.userName || 'Contact').trim();
    const phone = String(order.customerContact || order.contactLinks?.phone || settings.publicWhatsappNumber || '').trim();
    if (!contactName && !phone) {
      setToast({ message: 'В заказе нет контакта' });
      setIsAttachmentSheetOpen(false);
      return;
    }
    addAttachmentDrafts(target, [{
      id: createChatAttachmentId(),
      kind: 'contact',
      name: contactName || 'Contact',
      phone,
      value: [contactName, phone].filter(Boolean).join(' · '),
      createdAt: Date.now()
    }]);
    setIsAttachmentSheetOpen(false);
    haptic(10);
  };

  const addMediaDrafts = (target: 'note' | 'proof', media: string[]) => {
    const cleanMedia = media.filter(Boolean);
    if (cleanMedia.length === 0) return;
    if (target === 'proof') {
      setNewProofPhotos((prev) => [...prev, ...cleanMedia]);
      return;
    }
    setNewNotePhotos((prev) => [...prev, ...cleanMedia]);
  };

  const readMediaDrafts = async (files: File[], target: 'note' | 'proof') => {
    const media = await Promise.all(files.map(async (file) => {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return '';
      if (file.type.startsWith('image/')) {
        try {
          return await optimizeImageForUpload(file, `order-details:${target}:${file.name}`);
        } catch {
          // Fall through to data URL preview.
        }
      }
      const reader = new FileReader();
      return await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file as Blob);
      });
    }));
    addMediaDrafts(target, media);
    setIsAttachmentSheetOpen(false);
  };

  const handleNotePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void readMediaDrafts(Array.from(e.target.files), 'note');
      e.target.value = '';
    }
  };

  const handleProofPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const files = Array.from(e.target.files);
    void Promise.all(files.map(async (file) => {
      try {
        return await optimizeImageForUpload(file, `order-details:proof:${file.name}`);
      } catch {
        const reader = new FileReader();
        const fallback = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file as Blob);
        });
        return fallback;
      }
    })).then((photos) => {
      const cleanPhotos = photos.filter(Boolean);
      if (cleanPhotos.length === 0) return;
      setNewProofPhotos((prev) => [...prev, ...cleanPhotos]);
      setToast({ message: cleanPhotos.length > 1 ? 'Фото добавлены в proof pack' : 'Фото добавлено в proof pack' });
    });
    e.target.value = '';
  };

  const handleChatMediaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    void readMediaDrafts(Array.from(e.target.files), attachmentTargetRef.current);
    e.target.value = '';
  };

  const handleChatFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    const mediaFiles = files.filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'));
    const audioFiles = files.filter((file) => file.type.startsWith('audio/'));
    const documentFiles = files.filter((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/') && !file.type.startsWith('audio/'));
    if (mediaFiles.length > 0) {
      void readMediaDrafts(mediaFiles, attachmentTargetRef.current);
    }
    if (audioFiles.length > 0) {
      const dataTransfer = new DataTransfer();
      audioFiles.forEach((file) => dataTransfer.items.add(file));
      const audioEvent = { ...e, target: { ...e.target, files: dataTransfer.files, value: '' } } as React.ChangeEvent<HTMLInputElement>;
      handleNoteAudioFileChange(audioEvent);
    }
    if (documentFiles.length > 0) {
      void readFileAttachmentDrafts(documentFiles, attachmentTargetRef.current);
    } else {
      setIsAttachmentSheetOpen(false);
    }
    e.target.value = '';
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
          author: settings.publicManagerName || 'Manager'
        };
        if (attachmentTargetRef.current === 'proof') {
          setNewProofAudios((prev) => [...prev, audio]);
        } else {
          setNewNoteAudios((prev) => [...prev, audio]);
        }
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
    setIsAttachmentSheetOpen(false);
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
        waveform: getWaveBars(audio.slice(0, 120)),
        createdAt: Date.now(),
        author: settings.publicManagerName || 'Manager'
      };
    }
    return { ...audio, waveform: audio.waveform && audio.waveform.length > 0 ? audio.waveform : getWaveBars(audio.fileUrl.slice(0, 120)) };
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

  const resetVoiceGestureVisual = () => {
    voiceGestureAxisRef.current = null;
    voiceCancelReadyRef.current = false;
    voiceLockReadyRef.current = false;
    setVoiceGestureVisual({ axis: null, cancelProgress: 0, lockProgress: 0, offsetX: 0, offsetY: 0 });
  };

  const stopVoiceAnalyser = () => {
    analyserRef.current = null;
    analyserDataRef.current = null;
    smoothedAmplitudeRef.current = 0.12;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') {
      context.close().catch(() => undefined);
    }
  };

  const setupVoiceAnalyser = (stream: MediaStream) => {
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const context = new AudioContextCtor();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      audioContextRef.current = context;
      analyserRef.current = analyser;
      analyserDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      stopVoiceAnalyser();
    }
  };

  const sampleVoiceAmplitude = () => {
    const analyser = analyserRef.current;
    const buffer = analyserDataRef.current;
    let amplitude = 0.1;
    if (analyser && buffer) {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let index = 0; index < buffer.length; index += 1) {
        const centered = (buffer[index] - 128) / 128;
        sum += centered * centered;
      }
      amplitude = Math.min(1, Math.sqrt(sum / buffer.length) * 5.2);
    }
    const smoothed = smoothedAmplitudeRef.current * 0.65 + amplitude * 0.35;
    smoothedAmplitudeRef.current = smoothed;
    return 8 + Math.round(Math.max(0.04, smoothed) * 92);
  };

  const stopStreamTracks = (...streams: Array<MediaStream | null | undefined>) => {
    const uniqueTracks = new Set<MediaStreamTrack>();
    [recordingStreamRef.current, recorderRef.current?.stream, ...streams].forEach((stream) => {
      stream?.getTracks().forEach((track) => uniqueTracks.add(track));
    });
    uniqueTracks.forEach((track) => {
      try {
        track.onended = null;
        track.enabled = false;
        track.stop();
      } catch {
        // Mobile browsers can throw when the track is already stopped.
      }
    });
    recordingStreamRef.current = null;
  };

  const resetVoiceRecordingState = () => {
    stopVoiceTimers();
    stopStreamTracks();
    stopVoiceAnalyser();
    recorderRef.current = null;
    audioChunksRef.current = [];
    recordingStartedAtRef.current = null;
    recordingActiveSinceRef.current = null;
    recordingElapsedMsRef.current = 0;
    recordingElapsedSecondsRef.current = 0;
    recordingStopRequestedRef.current = false;
    voiceAutoSendOnReadyRef.current = false;
    voiceCancelAfterStartRef.current = false;
    resetVoiceGestureVisual();
    setIsVoiceLocked(false);
    setIsVoicePressing(false);
    setIsRecording(false);
    setIsRecordingPaused(false);
    setVoicePausePreview(null);
    setRecordingStartedAt(null);
    setRecordingElapsedSeconds(0);
    recordingWaveformRef.current = Array.from({ length: 56 }, () => 12);
    setRecordingWaveform(Array.from({ length: 56 }, () => 12));
  };

  const stopActiveRecording = () => {
    const recorder = recorderRef.current;
    const stream = recordingStreamRef.current || recorder?.stream || null;
    recordingStopRequestedRef.current = true;
    stopVoiceTimers();
    setIsRecording(false);
    setIsRecordingPaused(false);
    if (!recorder || recorder.state === 'inactive') {
      stopStreamTracks(stream);
      resetVoiceRecordingState();
      return;
    }
    try {
      recorder.requestData();
    } catch {
      // Some mobile browsers throw when there is no buffered chunk yet.
    }
    stopStreamTracks(stream);
    try {
      recorder.stop();
    } catch {
      resetVoiceRecordingState();
    }
    window.setTimeout(() => stopStreamTracks(stream), 250);
  };

  useEffect(() => {
    if (!isRecording || isRecordingPaused) return;
    recordingTimerRef.current = window.setInterval(() => {
      const now = Date.now();
      const activeMs = recordingActiveSinceRef.current ? now - recordingActiveSinceRef.current : 0;
      const nextSeconds = Math.floor((recordingElapsedMsRef.current + activeMs) / 1000);
      if (nextSeconds >= MAX_VOICE_RECORD_SECONDS) {
        setRecordingError('Recording limit reached');
        stopActiveRecording();
        setRecordingElapsedSeconds(MAX_VOICE_RECORD_SECONDS);
        recordingElapsedSecondsRef.current = MAX_VOICE_RECORD_SECONDS;
        return;
      }
      recordingElapsedSecondsRef.current = nextSeconds;
      setRecordingElapsedSeconds(nextSeconds);
    }, 250);

    waveformTimerRef.current = window.setInterval(() => {
      const nextBar = sampleVoiceAmplitude();
      recordingWaveformRef.current = [...recordingWaveformRef.current.slice(-79), nextBar];
      setRecordingWaveform(recordingWaveformRef.current);
    }, WAVEFORM_SAMPLE_MS);

    return () => stopVoiceTimers();
  }, [isRecording, isRecordingPaused]);

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
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.onstop = null;
        stopStreamTracks(recorderRef.current.stream);
        try {
          recorderRef.current.stop();
        } catch {
          // no-op
        }
      }
      stopVoiceTimers();
      stopStreamTracks();
    };
  }, []);

  const getFinalRecordingDurationSeconds = () => {
    if (recordingActiveSinceRef.current) {
      recordingElapsedMsRef.current += Date.now() - recordingActiveSinceRef.current;
      recordingActiveSinceRef.current = null;
    }
    const seconds = Math.ceil(recordingElapsedMsRef.current / 1000);
    recordingElapsedSecondsRef.current = seconds;
    return seconds;
  };

  const createVoiceAudioFromBlob = (durationSeconds: number, createdAt = Date.now()) => ({
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `voice-${createdAt}`,
    fileUrl: '',
    duration: durationSeconds,
    waveform: recordingWaveformRef.current.slice(-64),
    createdAt,
    author: settings.publicManagerName || 'Manager'
  });

  const readBlobAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read voice blob'));
    reader.readAsDataURL(blob);
  });

  const updatePausedVoicePreview = async () => {
    const recorder = recorderRef.current;
    if (!recorder || audioChunksRef.current.length === 0) return;
    const mimeType = recorder.mimeType || 'audio/webm';
    const blob = new Blob(audioChunksRef.current, { type: mimeType });
    if (blob.size <= 0) return;
    try {
      const durationSeconds = Math.max(VOICE_MIN_DURATION_SECONDS, recordingElapsedSecondsRef.current);
      const fileUrl = await readBlobAsDataUrl(blob);
      setVoicePausePreview({ ...createVoiceAudioFromBlob(durationSeconds), fileUrl });
    } catch {
      setVoicePausePreview(null);
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecordingError('Voice recording not supported');
      return;
    }

    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        stopActiveRecording();
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (recordingStopRequestedRef.current) return;
          stopActiveRecording();
        };
      });
      recordingStreamRef.current = stream;
      setupVoiceAnalyser(stream);
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const supportedMimeType = mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      const recorder = new MediaRecorder(stream, supportedMimeType ? { mimeType: supportedMimeType } : undefined);
      recorderRef.current = recorder;
      audioChunksRef.current = [];
      recordingStopRequestedRef.current = false;
      setRecordingError(null);
      setRecordingElapsedSeconds(0);
      recordingElapsedMsRef.current = 0;
      recordingElapsedSecondsRef.current = 0;
      recordingWaveformRef.current = Array.from({ length: 56 }, () => 12);
      setRecordingWaveform(recordingWaveformRef.current);
      setVoicePausePreview(null);
      setRecordingSavedLocally(false);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onpause = () => {
        if (recordingActiveSinceRef.current) {
          recordingElapsedMsRef.current += Date.now() - recordingActiveSinceRef.current;
          recordingActiveSinceRef.current = null;
        }
        setIsRecordingPaused(true);
        window.setTimeout(() => void updatePausedVoicePreview(), 120);
      };
      recorder.onresume = () => {
        recordingActiveSinceRef.current = Date.now();
        setVoicePausePreview(null);
        setIsRecordingPaused(false);
      };

      recorder.onstop = () => {
        stopStreamTracks(stream);
        stopVoiceAnalyser();
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const durationSeconds = getFinalRecordingDurationSeconds();
        const target = recordingTargetRef.current;
        const shouldAutoSend = voiceAutoSendOnReadyRef.current;
        const waveform = recordingWaveformRef.current.slice(-64);
        voiceAutoSendOnReadyRef.current = false;
        resetVoiceRecordingState();

        if (blob.size <= 0) {
          setRecordingError('Запись пустая. Попробуйте ещё раз.');
          return;
        }

        if (durationSeconds < VOICE_MIN_DURATION_SECONDS) {
          setToast({ message: 'Голосовое сообщение слишком короткое' });
          return;
        }

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
            duration: durationSeconds,
            waveform,
            createdAt: Date.now(),
            author: settings.publicManagerName || 'Manager'
          };
          if (shouldAutoSend) {
            const directNote: OrderNote = {
              id: Math.random().toString(36).slice(2, 9),
              text: target === 'proof' ? newProofText.trim() : newNoteText.trim(),
              photos: target === 'proof' ? newProofPhotos : newNotePhotos,
              audios: [voice],
              attachments: target === 'proof' ? newProofAttachments : newNoteAttachments,
              visibility: target === 'proof' ? 'client' : undefined,
              kind: target === 'proof' ? 'proof' : 'note',
              createdAt: Date.now()
            };
            const nextOrder = { ...order, notes: [directNote, ...(order.notes || [])] };
            updateOrder(nextOrder);
            if (target === 'proof' && nextOrder.publicQuoteToken) {
              void refreshPublicQuoteSnapshot(nextOrder);
            }
            if (target === 'proof') {
              setNewProofText('');
              setNewProofPhotos([]);
              setNewProofAudios([]);
              setNewProofAttachments([]);
            } else {
              setNewNoteText('');
              setNewNotePhotos([]);
              setNewNoteAudios([]);
              setNewNoteAttachments([]);
            }
            setIsUploadingVoice(false);
            setVoiceUploadProgress(0);
            haptic([12, 24, 12]);
            return;
          }
          if (target === 'proof') {
            setNewProofAudios((prev) => [...prev, voice]);
          } else {
            setNewNoteAudios((prev) => [...prev, voice]);
          }
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
      recordingStartedAtRef.current = Date.now();
      recordingActiveSinceRef.current = recordingStartedAtRef.current;
      setIsVoicePressing(false);
      setIsRecording(true);
      setIsRecordingPaused(false);
      setRecordingStartedAt(recordingStartedAtRef.current);
      haptic(16);
    } catch (e) {
      console.error('Audio recording failed', e);
      setIsVoicePressing(false);
      setRecordingError('Microphone access required');
    }
  };

  const toggleRecording = async (target: 'note' | 'proof' = 'note') => {
    if (isRecording) {
      stopActiveRecording();
      return;
    }
    recordingTargetRef.current = target;
    await startRecording();
  };

  const openAttachmentMenu = (target: 'note' | 'proof') => {
    attachmentTargetRef.current = target;
    setIsAttachmentSheetOpen(true);
    haptic(8);
  };

  const openMediaPicker = (target: 'note' | 'proof') => {
    attachmentTargetRef.current = target;
    setIsAttachmentSheetOpen(false);
    chatMediaInputRef.current?.click();
  };

  const openCameraPicker = (target: 'note' | 'proof') => {
    attachmentTargetRef.current = target;
    setIsAttachmentSheetOpen(false);
    chatCameraInputRef.current?.click();
  };

  const openFilePicker = (target: 'note' | 'proof') => {
    attachmentTargetRef.current = target;
    setIsAttachmentSheetOpen(false);
    chatFileInputRef.current?.click();
  };

  const openAudioPicker = (target: 'note' | 'proof') => {
    attachmentTargetRef.current = target;
    setIsAttachmentSheetOpen(false);
    noteAudioFileRef.current?.click();
  };

  const startVoicePress = (target: 'note' | 'proof', event: React.PointerEvent<HTMLButtonElement>) => {
    if (isRecording || recorderRef.current) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    voicePointerRef.current = { target, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: true };
    voiceCancelAfterStartRef.current = false;
    voiceAutoSendOnReadyRef.current = false;
    resetVoiceGestureVisual();
    attachmentTargetRef.current = target;
    setIsVoicePressing(true);
    if (voiceHoldTimerRef.current) window.clearTimeout(voiceHoldTimerRef.current);
    voiceHoldTimerRef.current = window.setTimeout(() => {
      voiceHoldTimerRef.current = null;
      recordingTargetRef.current = target;
      setIsVoiceLocked(false);
      void (async () => {
        await startRecording();
        if (voiceCancelAfterStartRef.current) {
          confirmDiscardRecording();
          voiceCancelAfterStartRef.current = false;
          return;
        }
        if (!voicePointerRef.current) {
          stopActiveRecording();
        }
      })();
    }, VOICE_HOLD_START_MS);
  };

  const lockVoiceRecordingFromGesture = (target: 'note' | 'proof') => {
    setIsVoiceLocked(true);
    voiceLockReadyRef.current = true;
    haptic([8, 24, 8]);
    if (voiceHoldTimerRef.current) {
      window.clearTimeout(voiceHoldTimerRef.current);
      voiceHoldTimerRef.current = null;
    }
    if (!recorderRef.current) {
      recordingTargetRef.current = target;
      void startRecording();
    }
  };

  const handleVoicePointerMove = (clientX: number, clientY: number, pointerId: number) => {
    const start = voicePointerRef.current;
    if (!start || !start.active || start.pointerId !== pointerId) return;
    const dx = clientX - start.startX;
    const dy = clientY - start.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!voiceGestureAxisRef.current && Math.max(absX, absY) > VOICE_GESTURE_DEAD_ZONE_PX) {
      voiceGestureAxisRef.current = absX > absY ? 'x' : 'y';
    }

    if (voiceGestureAxisRef.current === 'x') {
      const cancelProgress = Math.min(1, Math.max(0, Math.abs(Math.min(0, dx)) / VOICE_CANCEL_SWIPE_PX));
      const cancelReady = cancelProgress >= 1;
      if (cancelReady && !voiceCancelReadyRef.current) haptic([18, 26, 18]);
      voiceCancelReadyRef.current = cancelReady;
      setVoiceGestureVisual({
        axis: 'x',
        cancelProgress,
        lockProgress: 0,
        offsetX: Math.max(-VOICE_CANCEL_SWIPE_PX, Math.min(0, dx)),
        offsetY: 0
      });
      return;
    }

    if (voiceGestureAxisRef.current === 'y') {
      const lockProgress = Math.min(1, Math.max(0, Math.abs(Math.min(0, dy)) / VOICE_LOCK_SWIPE_PX));
      setVoiceGestureVisual({
        axis: 'y',
        cancelProgress: 0,
        lockProgress,
        offsetX: 0,
        offsetY: Math.max(-VOICE_LOCK_SWIPE_PX, Math.min(0, dy))
      });
      if (lockProgress >= 1) {
        voicePointerRef.current = { ...start, active: false };
        lockVoiceRecordingFromGesture(start.target);
      }
    }
  };

  const moveVoicePress = (event: React.PointerEvent<HTMLButtonElement>) => {
    handleVoicePointerMove(event.clientX, event.clientY, event.pointerId);
  };

  const finishVoicePress = (event?: React.PointerEvent<HTMLButtonElement>) => {
    setIsVoicePressing(false);
    if (voiceHoldTimerRef.current) {
      window.clearTimeout(voiceHoldTimerRef.current);
      voiceHoldTimerRef.current = null;
      voicePointerRef.current = null;
      voiceCancelAfterStartRef.current = false;
      resetVoiceGestureVisual();
      setToast({ message: 'Удерживайте для записи' });
      return;
    }

    const start = voicePointerRef.current;
    voicePointerRef.current = null;
    if (!start || !start.active || (event && start.pointerId !== event.pointerId)) return;
    if (voiceCancelReadyRef.current) {
      voiceCancelAfterStartRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        confirmDiscardRecording();
      } else {
        stopVoiceTimers();
        stopStreamTracks();
        stopVoiceAnalyser();
        setIsVoiceLocked(false);
        setIsRecording(false);
        setIsRecordingPaused(false);
        setVoicePausePreview(null);
        resetVoiceGestureVisual();
      }
      setToast({ message: 'Запись удалена' });
      haptic([24, 32, 24]);
      return;
    }
    resetVoiceGestureVisual();
    if (isVoiceLocked) return;
    voiceAutoSendOnReadyRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      stopActiveRecording();
    }
  };

  useEffect(() => {
    if (!voicePointerRef.current) return undefined;
    const handlePointerMove = (event: PointerEvent) => handleVoicePointerMove(event.clientX, event.clientY, event.pointerId);
    const handlePointerUp = (event: PointerEvent) => {
      const pointer = voicePointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      finishVoicePress();
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    window.addEventListener('pointercancel', handlePointerUp, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  });

  const sendActiveVoiceRecording = () => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return;
    voiceAutoSendOnReadyRef.current = true;
    haptic([12, 18, 12]);
    stopActiveRecording();
  };

  const toggleRecordingPause = () => {
    if (!recorderRef.current) return;
    if (recorderRef.current.state === 'recording') {
      try {
        recorderRef.current.requestData();
      } catch {
        // Some browsers do not allow requestData while the encoder is starting.
      }
      recorderRef.current.pause();
      haptic(10);
      return;
    }
    if (recorderRef.current.state === 'paused') {
      recorderRef.current.resume();
      haptic(10);
    }
  };

  const requestCancelRecording = () => {
    if (!isRecording) return;
    haptic([18, 24, 18]);
    confirmDiscardRecording();
  };

  const confirmDiscardRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      stopStreamTracks(recorderRef.current.stream);
      try {
        recorderRef.current.stop();
      } catch {
        // Recorder may already be inactive on mobile Safari.
      }
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


  const addClientProofNote = () => {
    const videoUrl = normalizeExternalMediaUrl(newProofVideoUrl);
    if (proofComposerMode === 'video' && newProofVideoUrl.trim() && !videoUrl) {
      setToast({ message: 'Проверьте ссылку на видео.' });
      return;
    }
    if (!newProofText.trim() && newProofPhotos.length === 0 && newProofAudios.length === 0 && newProofAttachments.length === 0 && !videoUrl) return;

    const note: OrderNote = {
      id: Math.random().toString(36).slice(2, 9),
      text: newProofText.trim() || (videoUrl ? 'Видео-пруф' : newProofPhotos.length > 0 ? 'Фото-пруф' : newProofAudios.length > 0 ? 'Голосовой пруф' : ''),
      photos: newProofPhotos,
      audios: newProofAudios,
      videoUrls: videoUrl ? [videoUrl] : [],
      attachments: newProofAttachments,
      visibility: 'client',
      kind: 'proof',
      createdAt: Date.now()
    };
    const nextOrder = { ...order, notes: [note, ...(order.notes || [])] };
    updateOrder(nextOrder);
    if (nextOrder.publicQuoteToken) {
      void refreshPublicQuoteSnapshot(nextOrder);
    }
    setNewProofText('');
    setNewProofVideoUrl('');
    setNewProofPhotos([]);
    setNewProofAudios([]);
    setNewProofAttachments([]);
    setProofComposerMode('message');
    setToast({ message: nextOrder.publicQuoteToken ? 'Пруф добавлен, публичная смета обновляется' : 'Пруф добавлен в публичную смету' });
  };

  const removeNewProofPhoto = (index: number) => {
    setNewProofPhotos((prev) => prev.filter((_, photoIndex) => photoIndex !== index));
  };

  const removeNewProofAudio = (index: number) => {
    setNewProofAudios((prev) => prev.filter((_, audioIndex) => audioIndex !== index));
  };

  const removeNewProofAttachment = (index: number) => {
    setNewProofAttachments((prev) => prev.filter((_, attachmentIndex) => attachmentIndex !== index));
  };


  const addNote = () => {
    if (!newNoteText.trim() && newNotePhotos.length === 0 && newNoteAudios.length === 0 && newNoteAttachments.length === 0) return;
    const note: OrderNote = {
      id: Math.random().toString(36).slice(2, 9),
      text: newNoteText.trim() || (newNoteAttachments.length > 0 ? 'Attachment' : ''),
      photos: newNotePhotos,
      audios: newNoteAudios,
      attachments: newNoteAttachments,
      createdAt: Date.now()
    };
    updateOrder({ ...order, notes: [note, ...(order.notes || [])] });
    setNewNoteText('');
    setNewNotePhotos([]);
    setNewNoteAudios([]);
    setNewNoteAttachments([]);
  };

  const removeNewAudio = (index: number) => {
    setNewNoteAudios((prev) => prev.filter((_, audioIndex) => audioIndex !== index));
  };

  const removeNewNoteAttachment = (index: number) => {
    setNewNoteAttachments((prev) => prev.filter((_, attachmentIndex) => attachmentIndex !== index));
  };


  const removeNoteById = (noteId: string) => {
    updateOrder({ ...order, notes: (order.notes || []).filter((note) => note.id !== noteId) });
  };

  const confirmDeleteNote = () => {
    if (!deleteNoteConfirmId) return;
    removeNoteById(deleteNoteConfirmId);
    setDeleteNoteConfirmId(null);
  };

  const removeNoteAudio = (noteId: string, audioIndex: number) => {
    updateOrder({
      ...order,
      notes: (order.notes || []).map((note) => note.id === noteId ? { ...note, audios: (note.audios || []).filter((_, idx) => idx !== audioIndex) } : note)
    });
  };

  const MARKUP_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
  const DISCOUNT_OPTIONS = [0, 3, 5, 7, 10, 15, 20];

  const tabSwipeRef = useRef<{ x: number; y: number; ignore: boolean } | null>(null);
  const activeTabIndex = Math.max(0, ORDER_DETAILS_TABS.findIndex((tab) => tab.id === activeTab));
  const tabPanelClassName = `ds-tab-panel ${tabMotionDirection === 'back' ? 'ds-tab-panel-back' : 'ds-tab-panel-forward'}`;

  const changeActiveTab = useCallback((tab: OrderDetailsTab) => {
    setShowActionsMenu(false);
    if (tab === activeTab) return;
    const currentIndex = ORDER_DETAILS_TABS.findIndex((item) => item.id === activeTab);
    const nextIndex = ORDER_DETAILS_TABS.findIndex((item) => item.id === tab);
    if (currentIndex >= 0 && nextIndex >= 0 && currentIndex !== nextIndex) {
      setTabMotionDirection(nextIndex > currentIndex ? 'forward' : 'back');
    }
    setActiveTab(tab);
  }, [activeTab]);

  const handleTabSwipeStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    const target = event.target instanceof Element ? event.target : null;
    const horizontalScroller = target?.closest('[data-horizontal-scroll="true"], .overflow-x-auto');
    tabSwipeRef.current = { x: touch.clientX, y: touch.clientY, ignore: Boolean(horizontalScroller) };
  };

  const handleTabSwipeEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = tabSwipeRef.current;
    tabSwipeRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || start.ignore) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
    const index = ORDER_DETAILS_TABS.findIndex((tab) => tab.id === activeTab);
    if (index < 0) return;
    const nextIndex = dx < 0 ? Math.min(ORDER_DETAILS_TABS.length - 1, index + 1) : Math.max(0, index - 1);
    if (nextIndex !== index) changeActiveTab(ORDER_DETAILS_TABS[nextIndex].id);
  };

  const launchRadarSession = async () => {
    if (!FEATURE_RADAR_V2 || isLaunchingRadar) return;
    setIsLaunchingRadar(true);
    try {
      const availableShops = await fetchRadarShops(suppliers);
      const session = await ensureRadarSessionForOrder(order.id, availableShops);
      navigate(`/radar/${session.id}`);
    } catch (error) {
      logger.error('order-details:radar', 'Failed to launch radar session', { error: error instanceof Error ? error.message : String(error) });
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
    const nextTab = resolveOrderDetailsTab((location.state as { restoreActiveTab?: unknown; orderActiveTab?: unknown } | null)?.restoreActiveTab)
      || resolveOrderDetailsTab((location.state as { restoreActiveTab?: unknown; orderActiveTab?: unknown } | null)?.orderActiveTab);
    if (nextTab) changeActiveTab(nextTab);
    const restoreScrollTop = (location.state as { restoreScrollTop?: unknown } | null)?.restoreScrollTop;
    if (typeof restoreScrollTop !== 'number' || restoreScrollTop < 0) return;
    const mainScroller = document.querySelector('main');
    if (!(mainScroller instanceof HTMLElement)) return;
    window.setTimeout(() => {
      mainScroller.scrollTop = restoreScrollTop;
    }, 80);
  }, [changeActiveTab, location.state]);

  useEffect(() => {
    setShowActionsMenu(false);
  }, [activeTab, id, location.pathname]);

  useEffect(() => {
    if (!showActionsMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && actionsMenuRef.current?.contains(target)) return;
      setShowActionsMenu(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [showActionsMenu]);

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
    : 'Рынок не указан';
  const heroCurrentStage = safetySummary.stages.find((stage) => stage.state === 'current') || safetySummary.stages[0];
  const heroRiskAccent = HERO_RISK_ACCENTS[safetySummary.dealRisk.level] || 'text-slate-800';
  const quoteWasSent = order.salesStatus === 'Price Sent' || order.salesStatus === 'Pending Approval' || Boolean(order.publicQuoteToken);
  const proofReady = safetySummary.proofPack.total > 0 && safetySummary.proofPack.completed >= safetySummary.proofPack.total;
  const heroPrimaryAction = (() => {
    if (!order.vin || !heroPhoto) {
      return {
        label: 'Заполнить данные',
        helper: 'VIN и фото авто',
        onClick: () => {
          changeActiveTab('overview');
          scrollToSection(vehicleSectionRef);
        }
      };
    }

    if (!depositPaid) {
      return {
        label: 'Подтвердить депозит',
        helper: 'После подтверждения откроются поиск и варианты',
        onClick: confirmDeposit
      };
    }

    if (selectedOfferTotal <= 0) {
      return {
        label: 'Начать поиск',
        helper: `${foundPartsCount}/${partsCount || 0} деталей найдено`,
        onClick: () => changeActiveTab('search')
      };
    }

    if (!fullPrepaymentPaid) {
      if (quoteWasSent) {
        return {
          label: 'Подтвердить предоплату',
          helper: 'Закрыть оплату перед закупкой',
          onClick: confirmFullPrepayment
        };
      }
      return {
        label: 'Отправить смету',
        helper: 'Зафиксировать условия',
        onClick: () => void shareQuote()
      };
    }

    if (!proofReady) {
      return {
        label: 'Собрать пруфы',
        helper: `${safetySummary.proofPack.completed}/${safetySummary.proofPack.total} готово`,
        onClick: () => changeActiveTab('proof')
      };
    }

    if (order.isSold || order.salesStatus === 'Completed') {
      return {
        label: 'Заказ закрыт',
        helper: 'Пруфы собраны, сделка завершена',
        onClick: () => changeActiveTab('proof')
      };
    }

    return {
      label: 'Завершить заказ',
      helper: 'Пруфы собраны. Осталось закрыть статус заказа',
      onClick: completeOrder
    };
  })();

  const stageIndex = Math.max(0, safetySummary.stages.findIndex((stage) => stage.id === heroCurrentStage?.id));
  const stageProgress = Math.round(((stageIndex + 1) / Math.max(1, safetySummary.stages.length)) * 100);
  const stageCopy = STAGE_COPY[heroCurrentStage?.id || safetySummary.currentStage] || STAGE_COPY.inquiry;
  const paymentCopy = PAYMENT_STATUS_SHORT[order.paymentStatus || 'none'] || PAYMENT_STATUS_SHORT.none;
  const openPartsCount = order.parts.filter((part) => !(part.isFound || (part.variants || []).length > 0)).length;
  const pricedPartsCount = order.parts.filter((part) => Number(getFinanceVariant(part)?.salePriceAed ?? getFinanceVariant(part)?.priceAed ?? 0) > 0).length;
  const readinessMissing = safetySummary.readiness.items.filter((item) => !item.done).slice(0, 5);
  const criticalReadinessMissing = safetySummary.readiness.items.filter((item) => item.critical && !item.done).slice(0, 4);
  const proofMissing = safetySummary.proofPack.items.filter((item) => !item.done).slice(0, 5);
  const criticalProofMissing = safetySummary.proofPack.items.filter((item) => item.critical && !item.done).slice(0, 4);
  const proofPercent = Math.round((safetySummary.proofPack.completed / Math.max(1, safetySummary.proofPack.total)) * 100);
  const firstMissingProof = proofMissing[0];
  const evidencePhotos = Array.from(new Set([
    ...getCarPhotos(),
    ...order.parts.flatMap((part) => [
      part.photoUrl || '',
      ...(part.photos || []),
      ...(part.variants || []).flatMap((variant) => [variant.photoUrl || '', ...(variant.photos || [])])
    ]),
    ...(order.notes || []).flatMap((note) => note.photos || [])
  ].filter(Boolean))) as string[];
  const clientProofNotes = (order.notes || []).filter((note) => note.visibility === 'client' || note.kind === 'proof');
  const partQueue = showOnlyOpenParts
    ? order.parts.filter((part) => !(part.isFound || (part.variants || []).length > 0))
    : order.parts;
  const nextActionCopy = (() => {
    if (!order.vin || !heroPhoto) return { label: 'Заполнить данные', helper: 'VIN и фото авто открывают рабочий поток.' };
    if (!depositPaid) return { label: 'Подтвердить депозит', helper: 'Поиск и варианты закрыты до депозита.' };
    if (selectedOfferTotal <= 0) return { label: 'Начать поиск', helper: `${openPartsCount}/${partsCount || 0} деталей ещё открыто.` };
    if (quoteWasSent && !fullPrepaymentPaid) return { label: 'Подтвердить предоплату', helper: 'Смета отправлена. Следующий шаг — полная оплата.' };
    if (!fullPrepaymentPaid) return { label: 'Отправить смету', helper: 'Перевести поиск в решение клиента.' };
    if (!proofReady) return { label: 'Собрать пруфы', helper: `${safetySummary.proofPack.completed}/${safetySummary.proofPack.total} пунктов готово.` };
    if (order.isSold || order.salesStatus === 'Completed') return { label: 'Заказ закрыт', helper: 'Пруфы собраны, сделка завершена.' };
    return { label: 'Завершить заказ', helper: 'Пруфы собраны. Осталось закрыть статус заказа.' };
  })();
  const riskCopy: Record<string, { label: string; tone: string; line: string }> = {
    safe: { label: 'Спокойно', tone: 'text-emerald-700 bg-emerald-50', line: 'Нормальный ритм сделки.' },
    caution: { label: 'Следить', tone: 'text-amber-700 bg-amber-50', line: 'Можно продолжать, но держать условия письменно.' },
    high: { label: 'Стоп', tone: 'text-orange-700 bg-orange-50', line: 'Не покупать без защиты оплаты.' },
    refuse: { label: 'Отказать', tone: 'text-rose-700 bg-rose-50', line: 'Условия не стоят риска.' }
  };
  const currentRiskCopy = riskCopy[safetySummary.dealRisk.level] || riskCopy.safe;
  const basicRequestReady = Boolean(order.vin || heroPhoto || partsCount > 0);
  const allPartsResolved = partsCount > 0 && openPartsCount === 0;
  const offerReady = selectedOfferTotal > 0;
  const quoteReady = quoteWasSent;
  const orderCompleted = Boolean(order.isSold || order.salesStatus === 'Completed');
  const procurementSteps: Array<{
    id: string;
    label: string;
    helper: string;
    state: WorkflowStepState;
    icon: typeof FileText;
    onClick: () => void;
  }> = [
    {
      id: 'request',
      label: 'Заявка',
      helper: basicRequestReady ? 'Клиент и авто заведены' : 'Нужны VIN, фото или деталь',
      state: basicRequestReady ? 'completed' : 'current',
      icon: FileText,
      onClick: () => {
        changeActiveTab('overview');
        scrollToSection(detailsScreenSectionRef);
      }
    },
    {
      id: 'deposit',
      label: 'Депозит',
      helper: depositPaid ? `Учтён ${formatMoney(depositAmountAed)}` : 'Без него поиск закрыт',
      state: depositPaid ? 'completed' : basicRequestReady ? 'current' : 'locked',
      icon: Wallet,
      onClick: confirmDeposit
    },
    {
      id: 'search',
      label: 'Поиск',
      helper: depositPaid ? `${openPartsCount} открыто · ${recommendedShops.length} поставщиков` : 'Откроется после депозита',
      state: allPartsResolved ? 'completed' : depositPaid ? 'current' : 'locked',
      icon: Search,
      onClick: () => changeActiveTab('search')
    },
    {
      id: 'offer',
      label: 'Вариант',
      helper: offerReady ? `${foundPartsCount}/${partsCount || 0} деталей с ценой` : 'Нужны цена и поставщик',
      state: offerReady ? 'completed' : depositPaid ? 'upcoming' : 'locked',
      icon: Package,
      onClick: () => changeActiveTab('search')
    },
    {
      id: 'quote',
      label: 'Смета',
      helper: quoteReady ? 'Условия отправлены' : 'Зафиксировать продажу и маржу',
      state: quoteReady ? 'completed' : offerReady ? 'current' : 'locked',
      icon: Share2,
      onClick: () => void shareQuote()
    },
    {
      id: 'prepay',
      label: 'Предоплата',
      helper: fullPrepaymentPaid ? 'Можно выкупать' : 'Получить деньги до закупки',
      state: fullPrepaymentPaid ? 'completed' : quoteReady ? 'current' : 'locked',
      icon: ShieldCheck,
      onClick: confirmFullPrepayment
    },
    {
      id: 'purchase',
      label: 'Выкуп',
      helper: orderCompleted ? 'Заказ закрыт' : fullPrepaymentPaid ? 'Покупка, проверка, упаковка' : 'Только после предоплаты',
      state: orderCompleted ? 'completed' : fullPrepaymentPaid ? 'current' : 'locked',
      icon: CheckCircle2,
      onClick: () => changeActiveTab(fullPrepaymentPaid ? 'proof' : 'finance')
    }
  ];
  const activeProcurementStep = procurementSteps.find((step) => step.state === 'current')
    || procurementSteps.find((step) => step.state === 'upcoming')
    || procurementSteps[procurementSteps.length - 1];
  const profitTone = safetySummary.profit.level === 'healthy'
    ? 'text-emerald-700 bg-emerald-50'
    : safetySummary.profit.level === 'unknown'
      ? 'text-stone-600 bg-stone-100'
      : 'text-rose-700 bg-rose-50';
  const shownNetProfit = canComputeProfit && netProfitAed !== null ? netProfitAed : safetySummary.profit.netProfitAed;
  const heroPhotoCount = getCarPhotos().length;
  const latestNote = (order.notes || [])[0];
  const firstRecommendedShop = recommendedShops[0];
  const supplierShareText = (() => {
    const stripLinks = (value: unknown) => String(value || '')
      .replace(/https?:\/\/\S+|www\.\S+|(?:drive|docs)\.google\.com\/\S+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const partLines = (order.parts || []).flatMap((part, index) => {
      const quantity = normalizePartQuantity(part.quantity);
      const groupItems = normalizeGroupItems(part.groupItems);
      const comment = stripLinks(part.comment);
      const baseLine = `${index + 1}. ${quantity > 1 ? `${quantity}x ` : ''}${stripLinks(getPartDisplayName(part) || part.name)}${comment ? ` - ${comment}` : ''}`;
      const childLines = groupItems.map((item) => `   - ${item.quantity}x ${stripLinks(item.name)}`);
      return [baseLine, ...childLines];
    });
    const vehicleDetails = [
      heroCarName,
      order.vin ? `VIN: ${order.vin}` : '',
      order.bodyType ? `Body: ${order.bodyType}` : '',
      heroMarketRegion !== 'Рынок не указан' ? `Market: ${heroMarketRegion}` : ''
    ].filter(Boolean);

    return [
      'Need spare parts:',
      ...vehicleDetails,
      '',
      'Parts:',
      ...(partLines.length > 0 ? partLines : ['1. Please check requested parts']),
      '',
      'Please send price, real photos, condition, availability and shop location.'
    ].join('\n').trim();
  })();

  const createShareImageFile = async (url: string) => {
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return null;
    const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
    return new File([blob], `car-${order.id.slice(0, 8)}.${extension}`, { type: blob.type || 'image/jpeg' });
  };

  const shareSupplierRequest = async () => {
    const firstCarPhoto = getCarPhotos()[0] || '';
    let photoFile: File | null = null;
    try {
      photoFile = await createShareImageFile(firstCarPhoto);
    } catch {
      photoFile = null;
    }

    try {
      if (navigator.share) {
        const baseShare: ShareData = { title: `Запрос ${heroCarName}`, text: supplierShareText };
        if (photoFile) {
          const shareWithPhoto: ShareData = { ...baseShare, files: [photoFile] };
          if (!navigator.canShare || navigator.canShare(shareWithPhoto)) {
            await navigator.share(shareWithPhoto);
            setToast({ message: 'Запрос отправлен с фото авто' });
            return;
          }
        }
        await navigator.share(baseShare);
        setToast({ message: photoFile ? 'Запрос отправлен без фото: браузер не поддержал файл' : 'Запрос отправлен' });
        return;
      }

      await copyText(supplierShareText, firstCarPhoto ? 'Текст запроса скопирован. Фото приложите вручную.' : 'Запрос поставщику скопирован');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      await copyText(supplierShareText, 'Запрос поставщику скопирован');
    }
  };

  const buildShortQuoteText = () => {
    const pricedLines = pricedPartLines
      .flatMap((line, index) => {
        const groupItems = normalizeGroupItems(line.part.groupItems);
        const title = `${index + 1}. ${getPartDisplayName(line.part)} x${line.quantity}: ${formatMoney(line.clientLineTotalAed, clientCurrency)}`;
        const children = groupItems.map((item) => `   - ${item.name} x${item.quantity}`);
        return [title, ...children];
      });
    const serviceLines = [
      logistics.deliveryAed > 0 ? `- Доставка: ${formatMoney(logistics.deliveryAed, clientCurrency)}` : '',
      logistics.packingAed > 0 ? `- Упаковка: ${formatMoney(logistics.packingAed, clientCurrency)}` : '',
      logistics.serviceFeeAed > 0 ? `- Сервис: ${formatMoney(logistics.serviceFeeAed, clientCurrency)}` : '',
      cargoTotalAed > 0 ? `- Cargo: ${formatMoney(cargoTotalAed, clientCurrency)}` : ''
    ].filter(Boolean);
    return [
      [order.brand, order.model, order.year].filter(Boolean).join(' ').trim(),
      order.vin ? `VIN: ${order.vin}` : '',
      ...pricedLines,
      discountAed > 0 ? `Скидка учтена в ценах: -${formatMoney(discountAed, clientCurrency)}` : '',
      ...(serviceLines.length > 0 ? ['Услуги:', ...serviceLines] : []),
      `Итого: ${formatMoney(sellTotalAed, clientCurrency)}`,
      depositAmountAed > 0 ? `Депозит: -${formatMoney(depositAmountAed, clientCurrency)}` : '',
      depositAmountAed > 0 ? `К оплате: ${formatMoney(balanceDueAed, clientCurrency)}` : ''
    ].filter(Boolean).join('\n');
  };

  const sendFinanceTextQuote = async () => {
    const text = buildShortQuoteText();
    const digits = String(order.customerContact || '').replace(/\D/g, '');
    const href = digits.length >= 8
      ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const removeNewNotePhoto = (index: number) => {
    setNewNotePhotos((prev) => prev.filter((_, photoIndex) => photoIndex !== index));
  };

  const getComposerDraft = (target: 'note' | 'proof') => ({
    text: target === 'proof' ? newProofText : newNoteText,
    setText: target === 'proof' ? setNewProofText : setNewNoteText,
    media: target === 'proof' ? newProofPhotos : newNotePhotos,
    audios: target === 'proof' ? newProofAudios : newNoteAudios,
    attachments: target === 'proof' ? newProofAttachments : newNoteAttachments,
    removeMedia: target === 'proof' ? removeNewProofPhoto : removeNewNotePhoto,
    removeAudio: target === 'proof' ? removeNewProofAudio : removeNewAudio,
    removeAttachment: target === 'proof' ? removeNewProofAttachment : removeNewNoteAttachment,
    submit: target === 'proof' ? addClientProofNote : addNote
  });

  const isVideoMedia = (src: string) => {
    const value = String(src || '').trim();
    return value.startsWith('data:video/')
      || value.startsWith('blob:')
      || /\.(mp4|webm|mov|m4v|ogv|ogg)(?:[?#].*)?$/i.test(value);
  };

  const getNoteDisplayText = (note: OrderNote) => {
    const text = String(note.text || '').trim();
    if (!text) return '';
    const hasMediaOnlyLabel = (note.photos || []).length > 0 || (note.videoUrls || []).length > 0 || (note.audios || []).length > 0;
    if (!hasMediaOnlyLabel) return text;
    const normalized = text.toLowerCase();
    const generatedLabels = new Set([
      'фото-пруф',
      'видео-пруф',
      'голосовой пруф',
      'пруф заказа',
      'фото',
      'видео'
    ]);
    return generatedLabels.has(normalized) ? '' : text;
  };

  const openMediaPreview = (media: string[] = [], index: number) => {
    const selected = media[index] || '';
    if (!selected) return;

    if (isVideoMedia(selected)) {
      const videos = media.filter(isVideoMedia);
      const videoIndex = Math.max(0, videos.findIndex((item) => item === selected));
      setGallery(null);
      setVideoPreview({ videos, index: videoIndex });
      return;
    }

    const images = media.filter((item) => !isVideoMedia(item));
    const imageIndex = Math.max(0, images.findIndex((item) => item === selected));
    setVideoPreview(null);
    setGallery({ images, index: imageIndex });
  };

  const renderMediaThumb = (src: string, index: number, onRemove: (index: number) => void) => {
    const isVideo = isVideoMedia(src);
    return (
      <div key={`${src.slice(0, 28)}-${index}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-white shadow-[0_8px_20px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80">
        {isVideo ? (
          <button type="button" onClick={() => setVideoPreview({ videos: [src], index: 0 })} className="h-full w-full">
            <video src={src} className="pointer-events-none h-full w-full object-cover" muted playsInline preload="metadata" />
            <span className="absolute inset-0 grid place-items-center bg-black/20 text-[10px] font-black text-white">Видео</span>
          </button>
        ) : (
          <SafeImage src={src} alt="Attachment preview" className="h-full w-full object-cover" />
        )}
        <button type="button" onClick={(event) => { event.stopPropagation(); onRemove(index); }} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-slate-950/75 text-white shadow-sm" aria-label="Удалить вложение">
          <X size={11} />
        </button>
      </div>
    );
  };

  const renderAttachmentCard = (attachment: ChatAttachment, index: number, onRemove?: (index: number) => void) => {
    const isFile = attachment.kind === 'file';
    const isLocation = attachment.kind === 'location';
    const isContact = attachment.kind === 'contact';
    const icon = isLocation ? <MapPin size={18} /> : isContact ? <User size={18} /> : <Paperclip size={18} />;
    const actionHref = isLocation
      ? attachment.value
      : isContact && attachment.phone
        ? `tel:${attachment.phone}`
        : isFile
          ? attachment.fileUrl
          : undefined;
    const actionLabel = isLocation ? 'Открыть карту' : isContact ? 'Звонок' : 'Открыть';
    const subtitle = isLocation
      ? (attachment.address || 'Геолокация')
      : isContact
        ? (attachment.phone || attachment.value || 'Контакт')
        : [attachment.mimeType || 'File', formatAttachmentSize(attachment.size)].filter(Boolean).join(' · ');

    return (
      <div key={`${attachment.id}-${index}`} className="flex items-center gap-2 rounded-[22px] bg-white p-2 shadow-[0_8px_24px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${isLocation ? 'bg-emerald-50 text-emerald-600' : isContact ? 'bg-amber-50 text-amber-600' : 'bg-violet-50 text-violet-600'}`}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-black text-slate-950">{attachment.name}</p>
          {subtitle && <p className="mt-0.5 truncate text-[11px] font-bold text-slate-500">{subtitle}</p>}
        </div>
        {actionHref && (
          <a href={actionHref} target={isLocation || isFile ? '_blank' : undefined} rel={isLocation || isFile ? 'noopener noreferrer' : undefined} download={isFile ? attachment.name : undefined} className="ds-press grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600" aria-label={actionLabel}>
            <ExternalLink size={15} />
          </a>
        )}
        {onRemove && (
          <button type="button" onClick={() => { haptic(10); onRemove(index); }} className="ds-press grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500" aria-label="Удалить вложение">
            <X size={15} />
          </button>
        )}
      </div>
    );
  };

  const renderDraftVoice = (target: 'note' | 'proof', audioItem: string | VoiceNoteAudio, index: number, removeAudio: (index: number) => void) => {
    const voice = toVoiceNoteAudio(audioItem);
    const audioId = `draft-audio-${voice.id}`;
    const isPlaying = playingAudioId === audioId;
    const progress = audioProgress[audioId] || 0;
    const bars = voice.waveform && voice.waveform.length > 0 ? voice.waveform.slice(-40) : getWaveBars(voice.fileUrl.slice(0, 120));
    return (
      <div key={`${target}-draft-voice-${voice.id}-${index}`} className="flex items-center gap-2 rounded-[26px] bg-white p-2 shadow-[0_8px_24px_rgba(16,185,129,0.08)] ring-1 ring-emerald-100">
        <button type="button" onClick={() => toggleAudioPlayback(audioId)} className="ds-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_8px_18px_rgba(16,185,129,0.22)]" aria-label="Play voice preview">
          {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex h-7 items-center gap-0.5">
            {bars.map((height, barIndex) => {
              const passed = progress >= ((barIndex + 1) / bars.length) * 100;
              return <span key={`${audioId}-preview-${barIndex}`} className={`block flex-1 rounded-full ${passed ? 'bg-emerald-600' : 'bg-emerald-200'}`} style={{ height: `${Math.max(20, height * 0.62)}%` }} />;
            })}
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[11px] font-black text-emerald-900/55">
            <span>{formatSeconds(voice.duration)}</span>
            <span>Preview</span>
          </div>
        </div>
        <button type="button" onClick={() => { haptic(10); removeAudio(index); }} className="ds-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500" aria-label="Delete voice preview">
          <Trash2 size={16} />
        </button>
        <audio id={audioId} src={voice.fileUrl} preload="metadata" playsInline />
      </div>
    );
  };

  const renderRecordingComposer = () => {
    const bars = recordingWaveform.slice(-44);
    const preview = voicePausePreview;
    const previewAudioId = preview ? `recording-preview-${preview.id}` : '';
    const previewProgress = previewAudioId ? audioProgress[previewAudioId] || 0 : 0;
    const cancelReady = voiceGestureVisual.cancelProgress >= 1;
    const lockedLayout = isVoiceLocked || isRecordingPaused;

    if (isRecordingPaused) {
      const previewBars = (preview?.waveform && preview.waveform.length > 0 ? preview.waveform : bars).slice(-44);
      return (
        <div className="rounded-[30px] border border-slate-200/80 bg-white/96 p-2 text-slate-950 shadow-[0_-16px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-all duration-200">
          <div className="flex min-h-[72px] items-center gap-2">
            <button type="button" onClick={requestCancelRecording} className="ds-press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600 transition active:scale-110" aria-label="Удалить запись">
              <Trash2 size={19} />
            </button>
            <button type="button" disabled={!preview} onClick={() => previewAudioId && toggleAudioPlayback(previewAudioId)} className="ds-press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-950 text-white disabled:bg-slate-200 disabled:text-slate-400" aria-label="Прослушать запись">
              {playingAudioId === previewAudioId ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
            </button>
            <div className="min-w-0 flex-1 rounded-[24px] bg-[#F3F6FA] px-3 py-2 ring-1 ring-slate-200/70">
              <div className="flex h-8 items-center gap-0.5">
                {previewBars.map((height, index) => {
                  const passed = previewProgress >= ((index + 1) / previewBars.length) * 100;
                  return <span key={`paused-wave-${index}`} className={`block flex-1 rounded-full transition-colors ${passed ? 'bg-emerald-600' : 'bg-slate-300'}`} style={{ height: `${Math.max(16, height * 0.72)}%` }} />;
                })}
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[11px] font-black text-slate-500">
                <span className="font-mono tabular-nums">{formatSeconds(recordingElapsedSeconds)}</span>
                <span>Preview</span>
              </div>
              {preview && <audio id={previewAudioId} src={preview.fileUrl} preload="metadata" playsInline />}
            </div>
            <button type="button" onClick={toggleRecordingPause} className="ds-press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700" aria-label="Продолжить запись">
              <Mic size={18} />
            </button>
            <button type="button" onClick={sendActiveVoiceRecording} className="ds-press grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_12px_28px_rgba(16,185,129,0.24)]" aria-label="Отправить голосовое сообщение">
              <Send size={19} />
            </button>
          </div>
        </div>
      );
    }

    if (lockedLayout) {
      return (
        <div className="rounded-[30px] border border-slate-200/80 bg-white/96 p-2 text-slate-950 shadow-[0_-16px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-all duration-200">
          <div className="flex min-h-[72px] items-center gap-2">
            <button type="button" onClick={requestCancelRecording} className="ds-press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600 transition active:scale-110" aria-label="Удалить запись">
              <Trash2 size={19} />
            </button>
            <div className="flex min-w-[74px] items-center gap-2 rounded-full bg-rose-50 px-3 py-2 text-rose-700">
              <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
              <span className="font-mono text-[13px] font-black tabular-nums">{formatSeconds(recordingElapsedSeconds)}</span>
            </div>
            <div className="min-w-0 flex-1 rounded-[24px] bg-[#F3F6FA] px-3 py-2 ring-1 ring-slate-200/70">
              <div className="flex h-9 items-center gap-0.5">
                {bars.map((height, index) => (
                  <span key={`locked-wave-${index}`} className="block flex-1 rounded-full bg-rose-400 transition-all duration-100" style={{ height: `${Math.max(16, height * 0.72)}%` }} />
                ))}
              </div>
            </div>
            <button type="button" onClick={toggleRecordingPause} className="ds-press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-rose-500 text-white shadow-[0_10px_28px_rgba(244,63,94,0.24)]" aria-label="Поставить запись на паузу">
              <Pause size={17} />
            </button>
            <button type="button" onClick={sendActiveVoiceRecording} className="ds-press grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_12px_28px_rgba(16,185,129,0.24)]" aria-label="Отправить голосовое сообщение">
              <Send size={19} />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="relative rounded-[30px] border border-slate-200/80 bg-white/96 p-2 text-slate-950 shadow-[0_-16px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-all duration-200">
        <div className="pointer-events-none absolute -top-24 right-3 flex flex-col items-center gap-1 rounded-full bg-white/92 px-2 py-2 text-slate-500 shadow-[0_14px_36px_rgba(15,23,42,0.16)] ring-1 ring-slate-200/70 transition-all duration-150" style={{ opacity: 0.32 + voiceGestureVisual.lockProgress * 0.68, transform: `translateY(${voiceGestureVisual.offsetY * 0.28}px) scale(${1 + voiceGestureVisual.lockProgress * 0.08})` }}>
          <Lock size={15} className={voiceGestureVisual.lockProgress >= 1 ? 'text-emerald-600' : 'text-slate-500'} />
          <ChevronUp size={18} className={voiceGestureVisual.lockProgress >= 1 ? 'text-emerald-600' : 'text-slate-400'} />
        </div>
        <div className="flex min-h-[72px] items-center gap-2">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full transition-colors duration-150" style={{ backgroundColor: `rgba(244,63,94,${0.08 + voiceGestureVisual.cancelProgress * 0.18})`, color: voiceGestureVisual.cancelProgress > 0.55 ? '#e11d48' : '#94a3b8', transform: `scale(${1 + voiceGestureVisual.cancelProgress * 0.12})` }}>
            <Trash2 size={19} />
          </div>
          <div className="flex min-w-[74px] items-center gap-2 rounded-full bg-rose-50 px-3 py-2 text-rose-700" style={{ transform: `translateX(${voiceGestureVisual.offsetX * 0.16}px)` }}>
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
            <span className="font-mono text-[13px] font-black tabular-nums">{formatSeconds(recordingElapsedSeconds)}</span>
          </div>
          <div className="min-w-0 flex-1 rounded-[24px] bg-[#F3F6FA] px-3 py-2 ring-1 ring-slate-200/70" style={{ transform: `translateX(${voiceGestureVisual.offsetX * 0.28}px)`, opacity: 1 - voiceGestureVisual.cancelProgress * 0.34 }}>
            <div className="flex items-center justify-between gap-2 text-[11px] font-black text-slate-500">
              <span>{cancelReady ? 'Отпустите — удалить' : 'Свайп влево'}</span>
              <span className="inline-flex items-center gap-1 text-slate-400"><Lock size={11} /> вверх</span>
            </div>
            <div className="mt-1.5 flex h-8 items-center gap-0.5">
              {bars.map((height, index) => (
                <span key={`held-wave-${index}`} className="block flex-1 rounded-full bg-rose-400 transition-all duration-100" style={{ height: `${Math.max(16, height * 0.72)}%` }} />
              ))}
            </div>
          </div>
          <div className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_12px_28px_rgba(16,185,129,0.24)] transition-transform duration-75" style={{ transform: `translate(${voiceGestureVisual.offsetX * 0.42}px, ${voiceGestureVisual.offsetY * 0.18}px) scale(${cancelReady ? 0.92 : 1})` }}>
            <Mic size={20} />
          </div>
        </div>
      </div>
    );
  };

  const renderChatComposer = (target: 'note' | 'proof') => {
    const draft = getComposerDraft(target);
    const hasText = draft.text.trim().length > 0;
    const hasMedia = draft.media.length > 0;
    const hasVoice = draft.audios.length > 0;
    const hasAttachments = draft.attachments.length > 0;
    const canSend = hasText || hasMedia || hasVoice || hasAttachments;
    const showRecording = isRecording && recordingTargetRef.current === target;
    const composerPlaceholder = target === 'proof'
      ? 'Пруф клиенту: фото, цена, состояние...'
      : 'Внутренняя заметка: что сказал клиент или поставщик...';
    const sendLabel = target === 'proof' ? 'Отправить пруф' : 'Отправить заметку';

    if (showRecording) return renderRecordingComposer();

    return (
      <form onSubmit={(event) => { event.preventDefault(); draft.submit(); haptic([8, 16, 8]); }} className="space-y-2">
        {(hasMedia || hasVoice || hasAttachments) && (
          <div className="space-y-2 rounded-[28px] bg-white/95 p-2 shadow-[0_-12px_32px_rgba(15,23,42,0.10)] ring-1 ring-slate-200/70 backdrop-blur-xl">
            {hasMedia && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {draft.media.map((src, index) => renderMediaThumb(src, index, draft.removeMedia))}
              </div>
            )}
            {hasAttachments && (
              <div className="space-y-2">
                {draft.attachments.map((attachment, index) => renderAttachmentCard(attachment, index, draft.removeAttachment))}
              </div>
            )}
            {hasVoice && (
              <div className="space-y-2">
                {draft.audios.map((audioItem, index) => renderDraftVoice(target, audioItem, index, draft.removeAudio))}
              </div>
            )}
          </div>
        )}
        <div className="rounded-[30px] bg-white/96 px-2 py-2 text-slate-950 shadow-[0_-16px_40px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/80 backdrop-blur-xl">
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => openAttachmentMenu(target)} className="ds-press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F3F5F7] text-slate-600 ring-1 ring-slate-200/70" aria-label="Открыть вложения">
              <Plus size={22} />
            </button>
            <div className="flex min-w-0 flex-1 items-end gap-2 rounded-[26px] bg-[#F3F5F7] px-3 py-2 ring-1 ring-slate-200/70">
              <textarea
                value={draft.text}
                onChange={(event) => draft.setText(event.target.value)}
                placeholder={composerPlaceholder}
                rows={1}
                className="no-scrollbar max-h-[96px] min-h-7 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent text-[15px] font-semibold leading-6 text-slate-950 outline-none placeholder:text-slate-400"
              />
            </div>
            {canSend ? (
              <button type="submit" className="ds-press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-blue-600 text-white shadow-[0_10px_26px_rgba(37,99,235,0.24)] transition duration-200" aria-label={sendLabel}>
                <Send size={19} />
              </button>
            ) : (
              <>
                <button type="button" onClick={() => openCameraPicker(target)} className="ds-press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F3F5F7] text-slate-600 ring-1 ring-slate-200/70" aria-label="Открыть камеру">
                  <Camera size={20} />
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => startVoicePress(target, event)}
                  onPointerMove={moveVoicePress}
                  onPointerUp={finishVoicePress}
                  onPointerCancel={finishVoicePress}
                  onContextMenu={(event) => event.preventDefault()}
                  className={`ds-press relative grid h-12 w-12 shrink-0 touch-none place-items-center rounded-full bg-emerald-500 text-white shadow-[0_12px_28px_rgba(16,185,129,0.26)] ${isVoicePressing ? 'scale-110 ring-4 ring-emerald-200' : ''}`}
                  aria-label="Записать голос"
                >
                  {isVoicePressing && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/45" />}
                  <Mic size={20} />
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    );
  };

  if (orderMissing && (isLoading || isRetrying || retryAttempts < MAX_RETRY_ATTEMPTS)) {
    return (
      <div className="p-4 space-y-4 animate-pulse" role="status" aria-live="polite">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">Загрузка заказа...</p>
        <div className="h-10 bg-gray-200 rounded-2xl" />
        <div className="h-24 bg-gray-200 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

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
            Назад к заказам
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

  return (
      <div className="min-h-full bg-[linear-gradient(to_bottom,#07080A_0,#07080A_260px,#F4F1EA_260px,#F4F1EA_100%)] pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[58px] text-white">
        <div className="fixed left-1/2 top-0 z-40 w-full max-w-md -translate-x-1/2 border-b border-white/10 bg-[#08090B]/92 px-3 py-2 backdrop-blur-xl">
          <div className="flex h-10 items-center justify-between gap-2">
            <button type="button" onClick={handleBackNavigation} className="ds-press flex h-10 w-10 items-center justify-center rounded-full text-white/[0.78] active:bg-white/10" aria-label="Назад">
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="line-clamp-2 text-[12px] font-black leading-tight text-white">{heroCarName}</p>
              <p className="truncate text-[10px] font-semibold tracking-[0.08em] text-white/[0.42]">{stageCopy.label} · {order.id.slice(0, 8)}</p>
            </div>
            <div className="flex h-10 items-center justify-end gap-1">
              <button type="button" onClick={() => void shareSupplierRequest()} className="ds-press flex h-10 w-10 items-center justify-center rounded-full text-white/[0.78] active:bg-white/10" aria-label="Поделиться запросом поставщику">
                <Send size={17} />
              </button>
              <div ref={actionsMenuRef} className="relative flex h-10 w-10 items-center justify-center">
                <button type="button" onClick={() => setShowActionsMenu((value) => !value)} className="ds-press flex h-10 w-10 items-center justify-center rounded-full text-white/[0.72] active:bg-white/10" aria-label="Действия">
                  <MoreVertical size={18} />
                </button>
                {showActionsMenu && (
                  <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#15171D] p-1 text-xs font-bold text-white shadow-2xl">
                    <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/10" onClick={() => { setShowActionsMenu(false); updateOrderField('isArchived', !order.isArchived); }}><Package size={14} /> {order.isArchived ? 'Вернуть из архива' : 'В архив'}</button>
                    <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-rose-200 hover:bg-rose-500/10" onClick={() => { setShowActionsMenu(false); setDeleteOrderConfirmOpen(true); }}><X size={14} /> Удалить</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <section ref={detailsScreenSectionRef} className="px-3 pb-3 pt-2">
          <div className="ds-deep-surface relative overflow-hidden rounded-[24px] bg-[#111318]">
            <div className="absolute inset-x-10 top-5 h-20 rounded-full bg-amber-300/10 blur-3xl" />
            <div className="relative min-h-[118px]">
              {heroPhoto ? (
                <button
                  type="button"
                  onClick={() => {
                    const photos = getCarPhotos();
                    if (photos.length) setGallery({ images: photos, index: 0 });
                  }}
                  className="absolute inset-0 h-full w-full"
                  aria-label="Открыть галерею автомобиля"
                >
                  <SafeImage src={heroPhoto} alt={heroCarName} className="h-full w-full object-cover opacity-88 transition duration-500" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => carFileRef.current?.click()}
                  className="absolute inset-0 h-full w-full overflow-hidden bg-[#101217]"
                  aria-label="Добавить фото автомобиля"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(245,158,11,0.15),transparent_36%)]" />
                  <div className="absolute bottom-5 left-7 h-12 w-[76%] rounded-[999px] border border-white/10 bg-white/[0.025] shadow-[inset_0_0_26px_rgba(255,255,255,0.04)]" />
                  <div className="absolute bottom-[72px] left-12 h-px w-[62%] bg-gradient-to-r from-transparent via-white/[0.18] to-transparent" />
                  <div className="absolute right-6 top-7 flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/[0.02] text-4xl font-black text-white/[0.075]">
                    {order.brand?.[0] || '?'}
                  </div>
                </button>
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#08090B]/90 via-[#08090B]/[0.28] to-transparent" />
              <div
                className="relative flex min-h-[118px] flex-col justify-between p-3"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button,input,textarea,select,a')) return;
                  const photos = getCarPhotos();
                  if (photos.length) setGallery({ images: photos, index: 0 });
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.16] px-2 py-1 text-[9px] font-semibold text-white/55 ring-1 ring-white/[0.06] backdrop-blur-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80 shadow-[0_0_10px_rgba(252,211,77,0.55)]" />
                    Живой заказ
                  </div>
                  <button type="button" onClick={() => carFileRef.current?.click()} className="ds-press inline-flex h-7 items-center gap-1 rounded-full bg-black/[0.16] px-2 text-[9px] font-bold text-white/65 ring-1 ring-white/[0.06] backdrop-blur-sm">
                    {heroPhoto ? <Camera size={12} /> : <Upload size={12} />}
                    {heroPhoto ? `${heroPhotoCount} фото` : 'Добавить фото'}
                  </button>
                  <input type="file" ref={carFileRef} onChange={handleCarPhotoChange} className="hidden" accept="image/*" multiple />
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-1">
                      <span className="rounded-full bg-black/[0.14] px-2 py-0.5 text-[9px] font-bold text-white/60 ring-1 ring-white/[0.06]">{stageCopy.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold opacity-75 ring-1 ${paymentCopy.tone}`}>{paymentCopy.label}</span>
                    </div>
                    <h1 className="max-w-[calc(100%-1rem)] break-words text-[clamp(18px,5vw,24px)] font-black leading-[1.02] tracking-normal text-white line-clamp-2">{heroCarName}</h1>
                    <button
                      type="button"
                      onClick={() => void copyText(order.vin || '', 'VIN скопирован')}
                      disabled={!order.vin}
                      className="ds-press mt-1 inline-flex max-w-[18rem] items-center gap-1.5 rounded-full py-0.5 pr-2 text-[11px] font-semibold tracking-[0.08em] text-white/[0.62] transition hover:text-white disabled:cursor-default disabled:hover:text-white/[0.62]"
                      aria-label="Скопировать VIN"
                    >
                      <span className="truncate">VIN {order.vin || 'not set'}</span>
                      {order.vin && <Copy size={12} className="shrink-0 opacity-70" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {manualCopyValue && (
          <div className="fixed bottom-[calc(7.25rem+env(safe-area-inset-bottom))] left-1/2 z-[60] w-[calc(100%-32px)] max-w-sm -translate-x-1/2 rounded-2xl border border-white/10 bg-[#111318] p-3 text-white shadow-2xl">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-white/55">Скопируйте вручную</p>
              <button type="button" onClick={() => setManualCopyValue('')} className="ds-press flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70" aria-label="Закрыть копирование">
                <X size={14} />
              </button>
            </div>
            <input
              ref={manualCopyInputRef}
              value={manualCopyValue}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 font-mono text-sm font-black text-white outline-none selection:bg-blue-500/80"
            />
          </div>
        )}

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
          <div className="relative grid grid-cols-5 gap-1 rounded-[28px] border border-white/10 bg-white/[0.045] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <span
              className="pointer-events-none absolute bottom-1 top-1 rounded-[24px] bg-[#F4F1EA] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_5px_14px_rgba(0,0,0,0.2)]"
              style={{
                left: '0.25rem',
                width: 'calc(20% - 0.3rem)',
                transform: `translate3d(calc(${activeTabIndex * 100}% + ${activeTabIndex * 0.25}rem),0,0)`,
                transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1), width 420ms cubic-bezier(0.22, 1, 0.36, 1)'
              }}
            />
            {ORDER_DETAILS_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.id === 'overview' ? FileText : tab.id === 'search' ? Search : tab.id === 'proof' ? ShieldCheck : tab.id === 'finance' ? Wallet : MessageCircle;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => changeActiveTab(tab.id)}
                  className={`ds-press relative z-10 flex h-11 flex-col items-center justify-center gap-1 rounded-[24px] text-[10px] font-black transition-colors duration-300 ${isActive ? 'text-[#111318]' : 'text-white/[0.48]'}`}
                  aria-pressed={isActive}
                >
                  <Icon size={15} />
                  <span className="max-w-full truncate px-1">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-h-[52dvh] rounded-t-[30px] bg-[#F4F1EA] px-4 pt-6 text-[#171717] shadow-[0_-18px_60px_rgba(0,0,0,0.28)]" style={{ paddingBottom: ORDER_DETAILS_SCROLL_PADDING }} onTouchStart={handleTabSwipeStart} onTouchEnd={handleTabSwipeEnd}>
          {activeTab === 'overview' && (
            <div className={`${tabPanelClassName} space-y-7`}>
              <section className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="ds-surface rounded-[22px] p-4">
                    <p className="text-2xl font-black text-stone-950">{criticalReadinessMissing.length}</p>
                    <p className="mt-0.5 text-[11px] font-black text-stone-400">не хватает</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-stone-500">{criticalReadinessMissing[0] ? `Дальше: ${READINESS_COPY[criticalReadinessMissing[0].id] || 'шаг'}` : 'Основные данные готовы'}</p>
                  </div>
                  <div className="ds-surface rounded-[22px] p-4">
                    <p className="text-lg font-black text-stone-950">{shownNetProfit !== null ? formatDualMoney(shownNetProfit) : 'Нет данных'}</p>
                    <p className="mt-1 text-[11px] font-black text-stone-400">прибыль</p>
                    <p className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${profitTone}`}>{safetySummary.profit.level === 'healthy' ? 'Защищено' : safetySummary.profit.level === 'unknown' ? 'Нужна цена' : 'Доработать'}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] font-black text-stone-600">Нужно внимание</p>
                    <span className="text-[11px] font-black text-stone-500">{safetySummary.readiness.percent}% готово</span>
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

              <section className="ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-stone-400">Маршрут закупки</p>
                    <h2 className="mt-1 text-xl font-black leading-tight text-stone-950">{activeProcurementStep.label}</h2>
                    <p className="mt-1 text-xs font-semibold leading-5 text-stone-500">{activeProcurementStep.helper}</p>
                  </div>
                  <button type="button" onClick={activeProcurementStep.onClick} className="ds-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-stone-950 px-3 text-[11px] font-black text-white">
                    Действие <ChevronRight size={14} />
                  </button>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-stone-950 transition-all" style={{ width: `${stageProgress}%` }} />
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar" data-horizontal-scroll="true">
                  {procurementSteps.map((step) => {
                    const StepIcon = step.icon;
                    const isLocked = step.state === 'locked';
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={step.onClick}
                        disabled={isLocked}
                        className={`ds-press flex w-[132px] shrink-0 flex-col items-start gap-2 rounded-[18px] border px-3 py-3 text-left disabled:cursor-not-allowed ${STAGE_STATE_STYLES[step.state] || STAGE_STATE_STYLES.upcoming}`}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/55 text-current">
                          <StepIcon size={15} />
                        </span>
                        <span className="text-[12px] font-black leading-tight">{step.label}</span>
                        <span className="line-clamp-2 min-h-[30px] text-[10px] font-semibold leading-[15px] opacity-75">{step.helper}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="grid gap-3">
                  <div className="ds-surface rounded-[24px] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-stone-400">Клиент</p>
                        <p className="mt-1 truncate text-lg font-black text-stone-950">{order.clientName || 'Без имени'}</p>
                        <p className="mt-1 truncate text-sm font-bold text-stone-500">{order.customerContact || 'Телефон не указан'}</p>
                      </div>
                    <button type="button" onClick={() => { setIsEditMode(false); setEditingOverviewBlock((prev) => prev === 'client' ? null : 'client'); }} className="ds-press flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white" aria-label={isClientEditMode ? 'Закрыть редактирование' : 'Редактировать клиента'}>{isClientEditMode ? <Check size={15} /> : <FileText size={15} />}</button>
                  </div>
                    {isClientEditMode && (
                      <div className="mt-3 space-y-2">
                        <input type="text" value={String(draftFields.clientName ?? order.clientName ?? '')} onChange={(e) => updateOrderField('clientName', e.target.value)} onBlur={() => flushDeferredOrderField('clientName')} placeholder="Имя клиента" className="ds-input h-12 w-full rounded-2xl border-0 px-4 text-sm font-black text-stone-950 outline-none" />
                        <div className="flex gap-2">
                          <input type="tel" value={String(draftFields.customerContact ?? order.customerContact ?? '')} onChange={(e) => updateOrderField('customerContact', e.target.value)} onBlur={() => flushDeferredOrderField('customerContact')} placeholder="+971..." className="ds-input h-12 min-w-0 flex-1 rounded-2xl border-0 px-4 text-sm font-black text-stone-950 outline-none" />
                          <button type="button" onClick={() => void copyText(order.customerContact || '', 'Телефон скопирован')} disabled={!order.customerContact} className="ds-press flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-950 text-white disabled:opacity-35" aria-label="Скопировать телефон"><Copy size={16} /></button>
                        </div>
                        <select value={String(draftFields.source ?? order.source)} onChange={(e) => updateOrderField('source', e.target.value)} className="ds-input h-11 w-full rounded-2xl border-0 px-3 text-xs font-black text-stone-800 outline-none">
                          {SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
                        </select>
                        {(sourceLabel.includes('instagram') || sourceLabel.includes('tiktok') || sourceLabel.includes('telegram')) && (
                          <button type="button" onClick={saveSocialNickname} className="ds-press h-11 w-full rounded-2xl bg-stone-100 px-3 text-xs font-black text-stone-800">{(draftFields.socialNickname ?? order.socialNickname ?? '') ? 'Изменить соцсеть' : 'Добавить соцсеть'}</button>
                        )}
                      </div>
                    )}
                    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                      <button type="button" onClick={openClientChannel} disabled={!getClientChannelLink() && (!(order.customerContact || '').replace(/[^\d]/g, '').length || (order.customerContact || '').replace(/[^\d]/g, '').length < 8)} className="ds-press inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-xs font-black text-white disabled:opacity-35"><MessageCircle size={15} /> {contactActionLabel}</button>
                      <button type="button" onClick={() => setShowCustomerLogs(true)} className="ds-press flex h-11 w-11 items-center justify-center rounded-2xl bg-stone-100 text-stone-700" aria-label="История клиента"><History size={16} /></button>
                    </div>
                  </div>

                  <div ref={vehicleSectionRef} className="ds-surface rounded-[24px] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-stone-400">Доп. информация</p>
                        <p className="mt-1 break-all font-mono text-sm font-black text-stone-950">{order.vin || 'VIN не указан'}</p>
                        <p className="mt-1 text-xs font-bold text-stone-500">Технические данные автомобиля</p>
                      </div>
                      <button type="button" onClick={() => { setIsEditMode(false); setEditingOverviewBlock((prev) => prev === 'vehicle' ? null : 'vehicle'); }} className="ds-press flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white" aria-label={isVehicleEditMode ? 'Закрыть редактирование' : 'Редактировать авто'}>{isVehicleEditMode ? <Check size={15} /> : <FileText size={15} />}</button>
                    </div>
                    {!isVehicleEditMode && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div className="rounded-2xl bg-stone-100 px-3 py-2">
                          <p className="text-[9px] font-black text-stone-400">Рынок</p>
                          <p className="mt-0.5 truncate text-xs font-black text-stone-800">{heroMarketRegion}</p>
                        </div>
                        <div className="rounded-2xl bg-stone-100 px-3 py-2">
                          <p className="text-[9px] font-black text-stone-400">Двигатель</p>
                          <p className="mt-0.5 truncate text-xs font-black text-stone-800">{order.vehicleDetails?.engineType || order.vehicleDetails?.engineCode || 'Нет'}</p>
                        </div>
                        <div className="rounded-2xl bg-stone-100 px-3 py-2">
                          <p className="text-[9px] font-black text-stone-400">Кузов</p>
                          <p className="mt-0.5 truncate text-xs font-black text-stone-800">{order.bodyType || 'Нет'}</p>
                        </div>
                      </div>
                    )}
                    {isVehicleEditMode && (
                      <div className="mt-2 rounded-[16px] bg-stone-50/90 p-1.5 ring-1 ring-stone-200/70">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1">
                          <input type="text" value={String(draftFields.vin ?? order.vin ?? '')} onChange={(e) => updateOrderField('vin', e.target.value.toUpperCase().slice(0, 17))} onBlur={() => flushDeferredOrderField('vin')} placeholder="VIN" className="ds-input h-8 min-w-0 rounded-lg border-0 px-2 text-[10px] font-black uppercase text-stone-950 outline-none" />
                          <button type="button" onClick={pasteVinFromClipboard} className="ds-press h-8 rounded-lg bg-stone-950 px-2 text-[9px] font-black text-white">VIN</button>
                          <button type="button" onClick={() => carFileRef.current?.click()} className="ds-press h-8 rounded-lg bg-white px-2 text-[9px] font-black text-stone-700 ring-1 ring-stone-200">Медиа</button>
                        </div>
                        <div className="mt-1 grid grid-cols-3 gap-1">
                          <select value={String((draftFields.vehicleDetails?.marketRegion) ?? (order.vehicleDetails?.marketRegion ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), marketRegion: (e.target.value || undefined) })} onBlur={() => flushDeferredOrderField('vehicleDetails')} className="ds-input h-8 rounded-lg border-0 px-2 text-[10px] font-black outline-none">
                            <option value="">Рынок</option>
                            {VEHICLE_MARKET_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                          </select>
                          <select value={String((draftFields.vehicleDetails?.transmission) ?? (order.vehicleDetails?.transmission ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), transmission: (e.target.value || undefined) })} onBlur={() => flushDeferredOrderField('vehicleDetails')} className="ds-input h-8 rounded-lg border-0 px-2 text-[10px] font-black outline-none">
                            <option value="">КПП</option>
                            {VEHICLE_TRANSMISSION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                          </select>
                          <input type="text" value={String((draftFields.vehicleDetails?.engineType) ?? (order.vehicleDetails?.engineType ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), engineType: e.target.value })} onBlur={() => flushDeferredOrderField('vehicleDetails')} placeholder="Двигатель" className="ds-input h-8 rounded-lg border-0 px-2 text-[10px] font-black outline-none" />
                          <input type="text" value={String((draftFields.vehicleDetails?.color) ?? (order.vehicleDetails?.color ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), color: e.target.value })} onBlur={() => flushDeferredOrderField('vehicleDetails')} placeholder="Цвет" className="ds-input h-8 rounded-lg border-0 px-2 text-[10px] font-black outline-none" />
                          <input type="text" value={String(draftFields.bodyType ?? order.bodyType ?? '')} onChange={(e) => updateOrderField('bodyType', e.target.value)} onBlur={() => flushDeferredOrderField('bodyType')} placeholder="Кузов" className="ds-input col-span-2 h-8 rounded-lg border-0 px-2 text-[10px] font-black outline-none" />
                        </div>
                      </div>
                    )}
                    {getCarPhotos().length > 0 && (
                      <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
                        {getCarPhotos().slice(0, 6).map((photo, index) => (
                          <div key={`${photo}-${index}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-stone-200">
                            <button type="button" onClick={() => setGallery({ images: getCarPhotos(), index })} className="ds-press h-full w-full">
                              <SafeImage src={photo} alt="Автомобиль" className="h-full w-full object-cover" />
                            </button>
                            {isVehicleEditMode && <button type="button" onClick={() => removeCarPhoto(index)} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white" aria-label="Удалить фото"><X size={11} /></button>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

              {settings.orderZones && settings.orderZones.length > 0 && (
                <section className="space-y-2">
                  <p className="text-[12px] font-black text-stone-600">Зона сервиса</p>
                  <div className="flex flex-wrap gap-2">
                    {((order.zones ?? []).length > 0 ? (order.zones ?? []) : order.zone ? [order.zone] : []).map((zone, index) => (
                      <button key={`${zone}-${index}`} type="button" onClick={() => {
                        const current = (order.zones ?? []).length > 0 ? (order.zones ?? []) : (order.zone ? [order.zone] : []);
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
                      <option value="">Добавить зону</option>
                      {settings.orderZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                    </select>
                  </div>
                </section>
              )}

              {false && isEditMode && (
              <section className="space-y-3">
                <button type="button" onClick={() => setIsClientBlockExpanded((prev) => !prev)} className="ds-press flex w-full items-center justify-between gap-3 py-2 text-left">
                  <span>
                    <span className="block text-[12px] font-black text-stone-500">Клиент</span>
                    <span className="mt-1 block text-base font-black text-stone-950">{String(draftFields.clientName ?? order.clientName ?? 'Без имени')}</span>
                  </span>
                  {isClientBlockExpanded ? <ChevronUp size={17} className="text-stone-500" /> : <ChevronDown size={17} className="text-stone-500" />}
                </button>
                {isClientBlockExpanded && (
                  <div className="ds-surface space-y-3 rounded-[24px] p-4">
                    <div className="grid grid-cols-1 gap-3">
                      <label className="space-y-1">
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-stone-400"><User size={12} /> Клиент</span>
                        <input type="text" value={String(draftFields.clientName ?? order.clientName ?? '')} readOnly={!isEditMode} onChange={(e) => updateOrderField('clientName', e.target.value)} onBlur={() => flushDeferredOrderField('clientName')} placeholder="Имя клиента" className="ds-input h-12 w-full rounded-2xl border-0 px-4 text-sm font-black text-stone-950 outline-none" />
                      </label>
                      <label className="space-y-1">
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-stone-400"><Smartphone size={12} /> Телефон</span>
                        <div className="flex gap-2">
                          <input type="tel" value={String(draftFields.customerContact ?? order.customerContact ?? '')} readOnly={!isEditMode} onChange={(e) => updateOrderField('customerContact', e.target.value)} onBlur={() => flushDeferredOrderField('customerContact')} placeholder="+971..." className="ds-input h-12 min-w-0 flex-1 rounded-2xl border-0 px-4 text-sm font-black text-stone-950 outline-none" />
                          <button type="button" onClick={() => void copyText(order.customerContact || '', 'Телефон скопирован')} disabled={!order.customerContact} className="ds-press flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-950 text-white disabled:opacity-35" aria-label="Скопировать телефон"><Copy size={16} /></button>
                        </div>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <select value={String(draftFields.source ?? order.source)} onChange={(e) => updateOrderField('source', e.target.value)} disabled={!isEditMode} className="ds-input h-12 rounded-2xl border-0 px-3 text-xs font-black text-stone-800 outline-none">
                        {SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
                      </select>
                    </div>
                    {(sourceLabel.includes('instagram') || sourceLabel.includes('tiktok') || sourceLabel.includes('telegram')) && (
                      <div className="ds-input flex items-center justify-between gap-2 rounded-2xl px-3 py-2">
                        <span className="min-w-0 truncate text-xs font-bold text-stone-500">{(draftFields.socialNickname ?? order.socialNickname ?? '') ? 'Соцсеть сохранена' : 'Нет соцсети'}</span>
                        <button type="button" onClick={saveSocialNickname} className="rounded-full bg-white px-3 py-2 text-[11px] font-black text-stone-800">{(draftFields.socialNickname ?? order.socialNickname ?? '') ? 'Изменить' : 'Добавить'}</button>
                      </div>
                    )}
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <button type="button" onClick={openClientChannel} disabled={!getClientChannelLink() && (!(order.customerContact || '').replace(/[^\d]/g, '').length || (order.customerContact || '').replace(/[^\d]/g, '').length < 8)} className="ds-press inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-xs font-black uppercase tracking-[0.08em] text-white disabled:opacity-40">
                        <MessageCircle size={16} /> {contactActionLabel}
                      </button>
                      <button type="button" onClick={() => setShowCustomerLogs(true)} className="ds-press inline-flex h-12 items-center justify-center rounded-2xl bg-stone-100 px-4 text-stone-700" aria-label="История клиента"><History size={17} /></button>
                    </div>
                  </div>
                )}
              </section>
              )}

              {false && isEditMode && (
              <section ref={vehicleSectionRef} className="space-y-3">
                <button type="button" onClick={() => setIsVehicleDetailsExpanded((prev) => !prev)} className="ds-press flex w-full items-center justify-between gap-3 py-2 text-left">
                  <span>
                    <span className="block text-[12px] font-black text-stone-500">Автомобиль</span>
                    <span className="mt-1 block text-base font-black text-stone-950">{order.brand || 'Марка'} {order.model || 'Модель'} {order.year || ''}</span>
                  </span>
                  {isVehicleDetailsExpanded ? <ChevronUp size={17} className="text-stone-500" /> : <ChevronDown size={17} className="text-stone-500" />}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['VIN', order.vin || 'Не указан', vinIsValid ? 'Готово' : vinIsIncomplete ? 'Проверить' : 'Нет'],
                    ['Рынок', heroMarketRegion, order.vehicleDetails?.marketRegion ? 'Указан' : 'Открыто'],
                    ['Двигатель', order.vehicleDetails?.engineType || order.vehicleDetails?.engineCode || 'Не указан', 'Спецификация'],
                    ['Кузов', order.bodyType || 'Не указан', 'Кузов']
                  ].map(([label, value, meta]) => (
                    <div key={label} className={`ds-surface rounded-[20px] px-4 py-3 ${label === 'VIN' ? 'col-span-2' : ''}`}>
                      <p className="text-[10px] font-black text-stone-400">{label}</p>
                      <p className={`mt-1 text-sm font-black text-stone-950 ${label === 'VIN' ? 'break-all font-mono text-[13px] leading-5' : 'truncate'}`}>{value}</p>
                      <p className="mt-1 text-[10px] font-bold text-stone-400">{meta}</p>
                    </div>
                  ))}
                </div>
                {isVehicleDetailsExpanded && (
                  <div className="ds-surface space-y-3 rounded-[24px] p-4">
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={String(draftFields.vin ?? order.vin ?? '')} readOnly={!isEditMode} onChange={(e) => updateOrderField('vin', e.target.value.toUpperCase().slice(0, 17))} onBlur={() => flushDeferredOrderField('vin')} placeholder="VIN" className="ds-input col-span-2 h-12 rounded-2xl border-0 px-4 text-sm font-black uppercase text-stone-950 outline-none" />
                      <button type="button" onClick={pasteVinFromClipboard} className="ds-press h-11 rounded-2xl bg-stone-950 px-3 text-xs font-black text-white">Вставить VIN</button>
                      <button type="button" onClick={() => carFileRef.current?.click()} className="ds-press h-11 rounded-2xl bg-stone-100 px-3 text-xs font-black text-stone-800">Добавить медиа</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select value={String((draftFields.vehicleDetails?.marketRegion) ?? (order.vehicleDetails?.marketRegion ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), marketRegion: (e.target.value || undefined) })} onBlur={() => flushDeferredOrderField('vehicleDetails')} disabled={!isEditMode} className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none">
                        <option value="">Рынок</option>
                        {VEHICLE_MARKET_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                      <select value={String((draftFields.vehicleDetails?.transmission) ?? (order.vehicleDetails?.transmission ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), transmission: (e.target.value || undefined) })} onBlur={() => flushDeferredOrderField('vehicleDetails')} disabled={!isEditMode} className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none">
                        <option value="">КПП</option>
                        {VEHICLE_TRANSMISSION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                      <input type="text" value={String((draftFields.vehicleDetails?.engineType) ?? (order.vehicleDetails?.engineType ?? ''))} readOnly={!isEditMode} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), engineType: e.target.value })} onBlur={() => flushDeferredOrderField('vehicleDetails')} placeholder="Двигатель" className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none" />
                      <input type="text" value={String((draftFields.vehicleDetails?.color) ?? (order.vehicleDetails?.color ?? ''))} readOnly={!isEditMode} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), color: e.target.value })} onBlur={() => flushDeferredOrderField('vehicleDetails')} placeholder="Цвет" className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none" />
                      <input type="text" value={String(draftFields.bodyType ?? order.bodyType ?? '')} readOnly={!isEditMode} onChange={(e) => updateOrderField('bodyType', e.target.value)} onBlur={() => flushDeferredOrderField('bodyType')} placeholder="Кузов" className="ds-input col-span-2 h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none" />
                    </div>
                    {getCarPhotos().length > 0 && (
                      <div className="flex gap-2 overflow-x-auto no-scrollbar">
                        {getCarPhotos().map((photo, index) => (
                          <div key={`${photo}-${index}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-stone-200">
                            <button type="button" onClick={() => setGallery({ images: getCarPhotos(), index })} className="h-full w-full"><SafeImage src={photo} alt="Автомобиль" className="h-full w-full object-cover" /></button>
                            {isEditMode && <button type="button" onClick={() => removeCarPhoto(index)} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white" aria-label="Удалить фото"><X size={11} /></button>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
              )}

              <section className="ds-surface rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setIsQuoteRatesExpanded((prev) => !prev)} className="ds-press flex min-w-0 flex-1 items-center justify-between gap-3 text-left" aria-expanded={isQuoteRatesExpanded}>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-black text-stone-600">Смета и курс</span>
                      <span className="mt-1 block truncate text-xs font-semibold text-stone-500">
                        {formatMoney(balanceDueAed, clientCurrency)} · USD {rateInput || preferredExchangeRate}
                      </span>
                    </span>
                    {isQuoteRatesExpanded ? <ChevronUp size={17} className="shrink-0 text-stone-500" /> : <ChevronDown size={17} className="shrink-0 text-stone-500" />}
                  </button>
                  <button type="button" onClick={() => void shareQuote()} className="ds-press flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white" aria-label="Отправить смету"><Share2 size={16} /></button>
                </div>
                {isQuoteRatesExpanded && (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {QUOTE_RATE_FIELDS.map((field) => (
                        <label key={field.code} className="space-y-1">
                          <span className="text-[10px] font-black text-stone-400">{field.helper}</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={field.code === 'USD' ? rateInput : (quoteRateInputs[field.code] ?? '')}
                            onChange={(event) => field.code === 'USD'
                              ? handleRateChange(event)
                              : handleQuoteRateInputChange(field.code as Exclude<QuoteCurrency, 'AED' | 'USD'>, event.target.value)}
                            onBlur={field.code === 'USD' ? flushExchangeRateCommit : flushQuoteRateCommit}
                            placeholder={field.decimals === 0 ? '0' : '0.00'}
                            className="ds-input h-12 w-full rounded-2xl border-0 px-3 text-sm font-black text-stone-950 outline-none"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="rounded-2xl bg-stone-100 px-3 py-2 text-right">
                      <p className="text-[10px] font-black text-stone-400">К оплате</p>
                      <p className="mt-1 text-sm font-black text-stone-950">{formatMoney(balanceDueAed, clientCurrency)}</p>
                    </div>
                    {depositAmountAed > 0 && <p className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">Депозит учтён: -{formatMoney(depositAmountAed)}</p>}
                  </div>
                )}
              </section>

              

              <section className="ds-surface space-y-2 rounded-[22px] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black text-stone-600">Медиа по деталям</p>
                    <p className="mt-0.5 text-[11px] font-semibold text-stone-500">Drive-ссылки по деталям.</p>
                  </div>
                  <Video size={16} className="text-stone-400" />
                </div>
                {(order.parts || []).length > 0 ? (
                  <div className="space-y-1.5">
                    {order.parts.map((part) => {
                      const mediaUrl = String(partMediaLinkDrafts[part.id] ?? (part as any).googleDriveVideoUrl ?? '').trim();
                      const showEditor = partMediaLinkEditing[part.id] || !mediaUrl;
                      return (
                        <div key={`overview-media-${part.id}`} className="rounded-2xl bg-stone-950/[0.035] p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-xs font-black text-stone-950">{getPartDisplayName(part)}</p>
                            {!showEditor && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">Ссылка добавлена</span>}
                          </div>
                          {showEditor ? (
                            <div className="mt-1.5 flex gap-1.5">
                              <input
                                type="url"
                                value={partMediaLinkDrafts[part.id] ?? ''}
                                onChange={(event) => setPartMediaLinkDrafts((prev) => ({ ...prev, [part.id]: event.target.value }))}
                                onBlur={(event) => savePartMediaLink(part.id, event.target.value)}
                                placeholder="Drive-ссылка"
                                className="ds-input h-9 min-w-0 flex-1 rounded-xl border-0 px-2.5 text-[11px] font-bold text-stone-800 outline-none"
                              />
                              <button type="button" onClick={() => {
                                const savedUrl = savePartMediaLink(part.id, partMediaLinkDrafts[part.id], { showToast: true });
                                checkGoogleDriveLink(savedUrl, 'Добавьте ссылку на медиа');
                              }} className="ds-press flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-950 text-white" aria-label="Открыть медиа"><ExternalLink size={14} /></button>
                            </div>
                          ) : (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <button type="button" onClick={() => checkGoogleDriveLink(mediaUrl, 'Добавьте ссылку на медиа')} className="ds-press inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-stone-950 text-[11px] font-black text-white"><ExternalLink size={13} /> Открыть</button>
                              <button type="button" onClick={() => setPartMediaLinkEditing((prev) => ({ ...prev, [part.id]: true }))} className="ds-press h-8 rounded-xl bg-white px-3 text-[11px] font-black text-stone-700 ring-1 ring-stone-200">Изм.</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="ds-soft-empty rounded-2xl p-3 text-center text-[11px] font-bold text-stone-500">Сначала добавьте детали.</div>
                )}
              </section>

              <section className="ds-surface space-y-2 rounded-[22px] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black text-stone-600">Папка медиа заказа</p>
                    <p className="mt-0.5 text-[11px] font-semibold text-stone-500">Общая Drive-папка заказа.</p>
                  </div>
                  <FolderOpen size={17} className="text-stone-400" />
                </div>
                {(() => {
                  const folderUrl = String(orderMediaFolderDraft || order.googleDriveFolderUrl || '').trim();
                  const showEditor = isOrderMediaFolderEditing || !folderUrl;
                  return showEditor ? (
                    <div className="flex gap-1.5">
                      <input type="url" value={orderMediaFolderDraft} onChange={(event) => setOrderMediaFolderDraft(event.target.value)} onBlur={(event) => saveOrderMediaFolder(event.target.value)} placeholder="Drive-папка" className="ds-input h-9 min-w-0 flex-1 rounded-xl border-0 px-2.5 text-[11px] font-bold text-stone-800 outline-none" />
                      <button type="button" onClick={() => {
                        const savedUrl = saveOrderMediaFolder(orderMediaFolderDraft, { showToast: true });
                        checkGoogleDriveLink(savedUrl, 'Добавьте Drive-папку заказа');
                      }} className="ds-press flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-950 text-white" aria-label="Открыть папку"><ExternalLink size={14} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-2xl bg-stone-950/[0.035] p-2">
                      <span className="min-w-0 flex-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">Папка добавлена</span>
                      <button type="button" onClick={() => checkGoogleDriveLink(folderUrl, 'Добавьте Drive-папку заказа')} className="ds-press inline-flex h-8 items-center justify-center gap-1.5 rounded-xl bg-stone-950 px-3 text-[11px] font-black text-white"><ExternalLink size={13} /> Открыть</button>
                      <button type="button" onClick={() => setIsOrderMediaFolderEditing(true)} className="ds-press h-8 rounded-xl bg-white px-3 text-[11px] font-black text-stone-700 ring-1 ring-stone-200">Изм.</button>
                    </div>
                  );
                })()}
              </section>

              {false && settings.orderZones && settings.orderZones.length > 0 && (
                <section className="space-y-2">
                  <p className="text-[12px] font-black text-stone-600">Зона сервиса</p>
                  <div className="flex flex-wrap gap-2">
                    {((order.zones ?? []).length > 0 ? (order.zones ?? []) : order.zone ? [order.zone] : []).map((zone, index) => (
                      <button key={`${zone}-${index}`} type="button" onClick={() => {
                        const current = (order.zones ?? []).length > 0 ? (order.zones ?? []) : (order.zone ? [order.zone] : []);
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
                      <option value="">Добавить зону</option>
                      {settings.orderZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                    </select>
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === 'search' && (
            <div className={`${tabPanelClassName} flex flex-col gap-6`}>
              {recommendedShops.length > 0 && (
                <section className="order-2 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-black text-stone-600">Поставщики</p>
                    {firstRecommendedShop && <span className="text-[11px] font-black text-stone-500">{firstRecommendedShop.name}</span>}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {recommendedShops.slice(0, 8).map((shop) => (
                      <div key={shop.id} className="ds-surface w-[220px] shrink-0 rounded-[22px] p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-stone-950">{shop.name}</p>
                            <p className="mt-1 truncate text-[11px] font-bold text-stone-500">{shop.location || 'Поставщик'}</p>
                          </div>
                          <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-black text-stone-600">
                            {getShopRecommendationLevel(shop, order) === 'high' ? 'высокий' : getShopRecommendationLevel(shop, order) === 'medium' ? 'средний' : 'низкий'}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-1.5">
                          <button type="button" onClick={() => contactSupplier(shop.name)} className="ds-press flex h-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700" aria-label="Связаться с поставщиком"><Phone size={14} /></button>
                          <button type="button" onClick={() => navigateToShop(shop)} className="ds-press flex h-9 items-center justify-center rounded-xl bg-stone-100 text-stone-700" aria-label="Открыть карту"><MapPin size={14} /></button>
                          <button type="button" onClick={() => (order.recommendedShopIds || []).includes(shop.id) ? removeManualRecommendation(shop.id) : addManualRecommendation(shop.id)} className="ds-press flex h-9 items-center justify-center rounded-xl bg-stone-100 text-stone-700" aria-label="Закрепить поставщика"><Star size={14} className={(order.recommendedShopIds || []).includes(shop.id) ? 'fill-amber-300 text-amber-500' : ''} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {(order.dismissedShopIds || []).length > 0 && (
                    <button type="button" onClick={restoreDismissedRecommendations} className="ds-press ds-surface rounded-full px-3 py-2 text-[11px] font-black text-stone-600">Вернуть скрытых поставщиков</button>
                  )}
                </section>
              )}

              <section ref={partsListRef} className="order-1 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-black text-stone-600">Очередь деталей</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setShowOnlyOpenParts((prev) => !prev)} className={`ds-press rounded-full px-3 py-2 text-[11px] font-black ${showOnlyOpenParts ? 'bg-stone-950 text-white' : 'bg-white text-stone-500'}`}>
                      {showOnlyOpenParts ? 'Открытые' : 'Все'}
                    </button>
                    <span className="text-[11px] font-black text-stone-500">{foundPartsCount}/{partsCount} найдено</span>
                  </div>
                </div>
                {partQueue.length === 0 ? (
                  <button type="button" onClick={() => partInputRef.current?.focus()} className="ds-press ds-soft-empty flex min-h-[118px] w-full flex-col items-center justify-center rounded-[26px] text-center">
                    <Package size={24} className="text-stone-400" />
                    <span className="mt-2 text-sm font-black text-stone-700">{showOnlyOpenParts ? 'У всех деталей есть варианты' : 'Деталей пока нет'}</span>
                    <span className="mt-1 text-xs font-semibold text-stone-400">Нажмите, чтобы добавить следующую позицию.</span>
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
                      const swipeOffset = partSwipeOffsets[part.id] || 0;
                      return (
                        <div key={part.id} className="relative overflow-hidden rounded-[18px]">
                          <button type="button" onClick={() => setDeletePartId(part.id)} className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-rose-600 text-white transition-opacity duration-150" style={{ opacity: swipeOffset < -8 ? 1 : 0, pointerEvents: swipeOffset < -8 ? 'auto' : 'none' }} aria-label="Удалить деталь"><X size={18} /></button>
                        <article
                          role="button"
                          tabIndex={0}
                          onTouchStart={(event) => handlePartSwipeStart(part.id, event)}
                          onTouchMove={(event) => handlePartSwipeMove(part.id, event)}
                          onTouchEnd={() => handlePartSwipeEnd(part.id)}
                          onClick={(event) => {
                            if ((event.target as HTMLElement).closest('button,input,textarea,select,a')) return;
                            openPartDetails(part.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openPartDetails(part.id);
                            }
                          }}
                          className="ds-press ds-surface cursor-pointer rounded-[18px] px-2.5 py-2 outline-none focus:ring-2 focus:ring-stone-950/10"
                          style={{ transform: `translateX(${swipeOffset}px)`, transition: partSwipeRef.current?.id === part.id ? 'none' : 'transform 160ms ease' }}
                        >
                          <div className="flex min-h-[56px] items-center gap-2">
                            <button type="button" onClick={(event) => openGallery(event, part)} className="ds-press flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-stone-100" aria-label="Открыть медиа детали">
                              {partPhotos[0] ? <SafeImage src={partPhotos[0]} alt={partDisplayName} className="h-full w-full object-cover" /> : <Package size={17} className="text-stone-300" />}
                            </button>
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex items-center gap-2">
                                <p className="min-w-0 flex-1 truncate text-sm font-black leading-tight text-stone-950">{partDisplayName}</p>
                                <button type="button" onClick={() => togglePartFound(part.id)} className={`ds-press flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${partReady ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-400'}`} aria-label={partReady ? 'Найдено' : 'Открыто'}>
                                  {partReady ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                                </button>
                              </div>
                              <p className="mt-1 truncate text-[10px] font-bold text-stone-500">
                                {partQuantity} шт{groupItems.length > 0 ? ` · группа ${groupItems.length}` : ''}{bestVariant ? ` · ${salePrice.toFixed(0)} AED` : ' · без варианта'}
                              </p>
                              {groupItems.length > 0 && (
                                <div className="mt-1.5 rounded-xl bg-stone-950/[0.035] px-2 py-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setPartGroupExpanded((prev) => ({ ...prev, [part.id]: !prev[part.id] }))}
                                    className="flex w-full items-center justify-between gap-2 text-left text-[10px] font-black text-stone-600"
                                    aria-expanded={!!partGroupExpanded[part.id]}
                                  >
                                    <span className="truncate">Состав группы · {groupItems.length}</span>
                                    <ChevronDown size={12} className={`shrink-0 transition-transform ${partGroupExpanded[part.id] ? 'rotate-180' : ''}`} />
                                  </button>
                                  {partGroupExpanded[part.id] && (
                                    <div className="mt-1 grid gap-1">
                                      {groupItems.map((item, itemIndex) => (
                                        <div key={`${part.id}-group-preview-${item.id || itemIndex}`} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-stone-600">
                                          <span className="min-w-0 truncate">{item.name}</span>
                                          <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-stone-500">×{item.quantity}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                              {bestVariant ? (
                                <button type="button" onClick={() => openPartDetails(part.id, bestVariant.id)} className="ds-press mt-1 max-w-full truncate rounded-lg bg-stone-950/[0.04] px-2 py-1 text-left text-[10px] font-bold text-stone-500" aria-label="Открыть вариант">
                                  {bestVariant.shopName || 'Поставщик'} · закуп {purchasePrice.toFixed(0)}
                                </button>
                              ) : (
                                <p className="mt-1 truncate text-[10px] font-bold text-stone-400">Вариант ещё не добавлен</p>
                              )}
                              {partCommentExpanded[part.id] ? (
                                <div className="mt-3 space-y-2">
                                  <textarea value={partCommentDrafts[part.id] ?? ''} onChange={(event) => updatePartCommentDraft(part.id, event.target.value)} rows={2} className="ds-input w-full rounded-2xl border-0 px-3 py-2 text-xs font-bold text-stone-700 outline-none" />
                                  <button type="button" onClick={() => savePartComment(part.id)} className="ds-press h-9 rounded-xl bg-stone-950 px-3 text-[11px] font-black text-white">Сохранить</button>
                                </div>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button type="button" onClick={() => setPartCommentExpanded((prev) => ({ ...prev, [part.id]: !prev[part.id] }))} className="ds-press flex h-9 w-9 items-center justify-center rounded-xl bg-stone-100 text-stone-600" aria-label="Заметка">
                                <FileText size={14} />
                              </button>
                              <button type="button" onClick={() => checkGoogleDriveLink(String((part as any).googleDriveVideoUrl || ''), 'Медиа-ссылка добавляется в Пруфах')} className="ds-press flex h-9 w-9 items-center justify-center rounded-xl bg-stone-100 text-stone-600" aria-label="Открыть медиа">
                                <ExternalLink size={14} />
                              </button>
                            </div>
                          </div>
                        </article>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <form
                onSubmit={(event) => { event.preventDefault(); addNewPart(); }}
                className="order-3 hidden"
                aria-hidden="true"
              >
                {newPartKind === 'group' && (
                  <div className="mb-2 max-h-32 space-y-1 overflow-y-auto rounded-2xl bg-white/80 p-2">
                    {newPartGroupItems.map((item, index) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <input type="text" value={item.name} onChange={(event) => updateGroupItemRow(item.id, 'name', event.target.value)} placeholder={`Деталь ${index + 1}`} className="h-9 min-w-0 flex-1 rounded-xl border-0 bg-stone-100 px-3 text-xs font-black text-stone-950 outline-none placeholder:text-stone-400" />
                        <select value={item.quantity} onChange={(event) => updateGroupItemRow(item.id, 'quantity', event.target.value)} className="h-9 w-14 rounded-xl border-0 bg-stone-100 text-center text-xs font-black text-stone-950 outline-none">
                          {Array.from({ length: 20 }, (_, qtyIdx) => String(qtyIdx + 1)).map((qty) => <option key={qty} value={qty}>{qty}</option>)}
                        </select>
                        <button type="button" onClick={() => removeGroupItemRow(item.id)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-rose-600" aria-label="Удалить строку"><X size={13} /></button>
                      </div>
                    ))}
                    <button type="button" onClick={addGroupItemRow} className="h-8 rounded-xl bg-white px-3 text-[11px] font-black text-stone-700">Добавить строку</button>
                  </div>
                )}
                {newPartPhotos.length > 0 && (
                  <div className="mb-2 flex gap-2 overflow-x-auto no-scrollbar">
                    {newPartPhotos.map((photo, index) => (
                      <div key={`${photo}-${index}`} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-stone-200">
                        <SafeImage src={photo} alt="Превью детали" className="h-full w-full object-cover" />
                        <button type="button" onClick={() => removeNewPhoto(index)} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white" aria-label="Удалить фото"><X size={11} /></button>
                      </div>
                    ))}
                  </div>
                )}
                {sourcingLocked ? (
                  <button type="button" onClick={confirmDeposit} className="ds-press h-12 w-full rounded-2xl bg-amber-300 text-xs font-black text-stone-950">Подтвердить депозит</button>
                ) : (
                  <div className="flex items-end gap-2">
                    <button type="button" onClick={() => partFileRef.current?.click()} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-700" aria-label="Фото детали"><ImageIcon size={18} /></button>
                    <button type="button" onClick={() => { setNewPartKind((value) => value === 'group' ? 'single' : 'group'); setNewPartGroupItems((prev) => prev.length > 0 ? prev : [createGroupItemDraft()]); }} className={`ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${newPartKind === 'group' ? 'bg-stone-950 text-white' : 'bg-white text-stone-700'}`} aria-label="Группа деталей"><Package size={17} /></button>
                    <div className="flex min-w-0 flex-1 items-center rounded-2xl bg-white px-3">
                      <input ref={partInputRef} type="text" value={newPartName} onChange={(event) => setNewPartName(event.target.value)} placeholder="Добавить деталь..." className="h-12 min-w-0 flex-1 border-0 bg-transparent text-sm font-black text-stone-950 outline-none placeholder:text-stone-400" />
                      <button type="button" onClick={() => setNewPartQuantity(String(Math.max(1, Number(newPartQuantity || 1) - 1)))} className="flex h-9 w-8 items-center justify-center rounded-xl text-stone-500" aria-label="Уменьшить"><Minus size={14} /></button>
                      <span className="w-6 text-center text-xs font-black text-stone-700">{newPartQuantity || 1}</span>
                      <button type="button" onClick={() => setNewPartQuantity(String(Math.max(1, Number(newPartQuantity || 1) + 1)))} className="flex h-9 w-8 items-center justify-center rounded-xl text-stone-500" aria-label="Увеличить"><Plus size={14} /></button>
                    </div>
                    <button type="submit" className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white" aria-label="Добавить деталь"><Send size={17} /></button>
                  </div>
                )}
              </form>
            </div>
          )}

          {activeTab === 'proof' && (
            <div className={`${tabPanelClassName} space-y-3`}>
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-black text-stone-600">Лента для клиента</p>
                  <span className="text-[11px] font-black text-stone-500">публично в смете</span>
                </div>
                {clientProofNotes.length > 0 ? (
                  <div className="space-y-3">
                    {clientProofNotes.map((note) => {
                      const noteDisplayText = getNoteDisplayText(note);
                      return (
                      <article key={note.id} className={`${(note.audios || []).length > 0 ? 'space-y-2' : 'ds-surface rounded-[24px] p-3'}`}>
                        {(note.audios || []).length === 0 && (
                          <div className="flex items-start justify-between gap-3">
                          {noteDisplayText ? <p className="min-w-0 whitespace-pre-line text-sm font-bold leading-5 text-stone-800">{noteDisplayText}</p> : <p className="min-w-0 text-[10px] font-black text-stone-400">{new Date(note.createdAt).toLocaleString('ru-RU')}</p>}
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">client</span>
                          </div>
                        )}
                        {(note.audios || []).length === 0 && noteDisplayText && <p className="mt-2 text-[10px] font-black text-stone-400">{new Date(note.createdAt).toLocaleString('ru-RU')}</p>}
                        {(note.photos || []).length > 0 && (
                          <div className="mt-3 grid grid-cols-4 gap-2">
                            {(note.photos || []).slice(0, 8).map((photo, index) => (
                              isVideoMedia(photo) ? (
                                <button
                                  key={`${note.id}-${photo}-${index}`}
                                  type="button"
                                  onClick={() => openMediaPreview(note.photos || [], index)}
                                  className="ds-press relative aspect-square overflow-hidden rounded-2xl bg-stone-950 text-white"
                                  aria-label="Открыть видео"
                                >
                                  <video src={photo} className="pointer-events-none h-full w-full object-cover opacity-85" muted playsInline preload="metadata" />
                                  <span className="absolute inset-0 grid place-items-center bg-black/20 text-[10px] font-black">Видео</span>
                                </button>
                              ) : (
                                <button key={`${note.id}-${photo}-${index}`} type="button" onClick={() => openMediaPreview(note.photos || [], index)} className="ds-press aspect-square overflow-hidden rounded-2xl bg-stone-200">
                                  <SafeImage src={photo} alt="Proof" className="h-full w-full object-cover" />
                                </button>
                              )
                            ))}
                          </div>
                        )}
                        {(note.videoUrls || []).length > 0 && (
                          <div className="mt-3 space-y-2">
                            {(note.videoUrls || []).map((url, index) => (
                              <a key={`${note.id}-video-${index}`} href={url} target="_blank" rel="noreferrer" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-sky-50 text-xs font-black text-sky-800"><Video size={14} /> Видео {index + 1}<ExternalLink size={12} /></a>
                            ))}
                          </div>
                        )}
                        {(note.attachments || []).length > 0 && (
                          <div className="mt-3 space-y-2">
                            {(note.attachments || []).map((attachment, index) => renderAttachmentCard(attachment, index))}
                          </div>
                        )}
                        {(note.audios || []).length > 0 && (
                          <div className="space-y-2">
                            {(note.audios || []).map((audioItem, index) => {
                              const voice = toVoiceNoteAudio(audioItem);
                              const audioId = `proof-${note.id}-${voice.id}-${index}`;
                              const isPlaying = playingAudioId === audioId;
                              const progress = audioProgress[audioId] || 0;
                              const bars = voice.waveform && voice.waveform.length > 0 ? voice.waveform.slice(-40) : getWaveBars(voice.fileUrl.slice(0, 120));
                              return (
                                <div key={audioId} className="ml-auto max-w-[92%] rounded-[24px] rounded-tr-md bg-[#D8F4E5] p-2.5 shadow-[0_8px_22px_rgba(16,185,129,0.14),inset_0_0_0_1px_rgba(16,185,129,0.08)]">
                                  <div className="flex items-center gap-3">
                                    <button type="button" onClick={() => toggleAudioPlayback(audioId)} className="ds-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-emerald-700 shadow-[0_8px_18px_rgba(15,23,42,0.12)]" aria-label="Прослушать голосовой пруф">
                                      {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex h-9 items-center gap-0.5">
                                        {bars.map((height, barIndex) => {
                                          const threshold = ((barIndex + 1) / bars.length) * 100;
                                          const passed = progress >= threshold;
                                          return <span key={`${audioId}-bar-${barIndex}`} className={`block flex-1 rounded-full transition-colors ${passed ? 'bg-emerald-700' : 'bg-emerald-300/80'}`} style={{ height: `${Math.max(22, height * 0.82)}%` }} />;
                                        })}
                                      </div>
                                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] font-black text-emerald-900/60">
                                        <span>{formatSeconds(voice.duration)}</span>
                                        <span className="inline-flex items-center gap-1">
                                          {new Date(note.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                                          <Check size={12} className="text-emerald-600" />
                                          <Check size={12} className="-ml-2 text-emerald-600" />
                                        </span>
                                      </div>
                                    </div>
                                    <audio id={audioId} src={voice.fileUrl} preload="metadata" playsInline />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </article>
                    );
                    })}
                  </div>
                ) : (
                  <div className="ds-soft-empty rounded-[26px] p-5 text-center">
                    <Camera size={24} className="mx-auto text-stone-400" />
                    <p className="mt-2 text-sm font-black text-stone-700">Публичных пруфов пока нет</p>
                    <p className="mt-1 text-xs font-semibold text-stone-400">Добавьте фото, видео-ссылку, текст или голос через нижний блок.</p>
                  </div>
                )}
              </section>

              <section className="hidden ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Медиа по деталям</p>
                    <p className="mt-1 text-xs font-semibold text-stone-500">Все ссылки редактируются только здесь.</p>
                  </div>
                  <Video size={18} className="text-stone-400" />
                </div>
                {(order.parts || []).length > 0 ? (
                  <div className="space-y-2">
                    {order.parts.map((part) => (
                      <div key={`proof-media-${part.id}`} className="rounded-2xl bg-stone-950/[0.04] p-3">
                        <p className="truncate text-sm font-black text-stone-950">{getPartDisplayName(part)}</p>
                        <div className="mt-2 flex gap-2">
                          <input
                            type="url"
                            value={partMediaLinkDrafts[part.id] ?? ''}
                            readOnly={!isEditMode}
                            onChange={(event) => setPartMediaLinkDrafts((prev) => ({ ...prev, [part.id]: event.target.value }))}
                            onBlur={(event) => savePartMediaLink(part.id, event.target.value)}
                            placeholder="Ссылка Google Drive"
                            className="ds-input h-11 min-w-0 flex-1 rounded-2xl border-0 px-3 text-xs font-bold text-stone-800 outline-none"
                          />
                          <button type="button" onClick={() => {
                            const savedUrl = savePartMediaLink(part.id, partMediaLinkDrafts[part.id], { showToast: true });
                            checkGoogleDriveLink(savedUrl, 'Добавьте ссылку на медиа');
                          }} className="ds-press flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white" aria-label="Открыть медиа"><ExternalLink size={15} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ds-soft-empty rounded-2xl p-4 text-center text-xs font-bold text-stone-500">Сначала добавьте детали в заказ.</div>
                )}
              </section>

              <section className="hidden ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Папка медиа заказа</p>
                    <p className="mt-1 text-xs font-semibold text-stone-500">Добавьте Drive-папку для просмотра материалов.</p>
                  </div>
                  <FolderOpen size={19} className="text-stone-400" />
                </div>
                <div className="flex gap-2">
                  <input type="url" value={orderMediaFolderDraft} readOnly={!isEditMode} onChange={(event) => setOrderMediaFolderDraft(event.target.value)} onBlur={(event) => saveOrderMediaFolder(event.target.value)} placeholder="https://drive.google.com/drive/folders/..." className="ds-input h-12 min-w-0 flex-1 rounded-2xl border-0 px-3 text-xs font-bold text-stone-800 outline-none" />
                  <button type="button" onClick={() => {
                    const savedUrl = saveOrderMediaFolder(orderMediaFolderDraft, { showToast: true });
                    checkGoogleDriveLink(savedUrl, 'Добавьте Drive-папку заказа');
                  }} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white" aria-label="Открыть папку"><ExternalLink size={15} /></button>
                </div>
              </section>

            </div>
          )}

          {activeTab === 'finance' && (
            <div className={`${tabPanelClassName} space-y-5`}>
              <section className="ds-surface space-y-3 rounded-[24px] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-black text-stone-600">Оплата</p>
                  <span className={`shrink-0 rounded-full px-3 py-2 text-[10px] font-black ${fullPrepaymentPaid ? 'bg-emerald-50 text-emerald-700' : depositPaid ? 'bg-amber-50 text-amber-700' : 'bg-stone-100 text-stone-500'}`}>
                    {PAYMENT_STATUS_LABELS[order.paymentStatus || 'none']}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={confirmDeposit} className={`ds-press h-11 rounded-2xl px-3 text-[11px] font-black ${depositPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-950 text-white'}`}>
                    {depositPaid ? 'Депозит получен' : 'Получен депозит'}
                  </button>
                  <button type="button" onClick={confirmFullPrepayment} disabled={fullPrepaymentPaid || selectedOfferTotal <= 0} className={`ds-press h-11 rounded-2xl px-3 text-[11px] font-black disabled:opacity-45 ${fullPrepaymentPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-600 text-white'}`}>
                    {fullPrepaymentPaid ? 'Предоплата получена' : 'Полная предоплата'}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl bg-stone-100 px-2 py-2">
                    <p className="text-[9px] font-black text-stone-400">Депозит</p>
                    <p className="mt-0.5 truncate text-xs font-black text-stone-950">{formatMoney(depositAmountAed)}</p>
                  </div>
                  <div className="rounded-2xl bg-stone-100 px-2 py-2">
                    <p className="text-[9px] font-black text-stone-400">К оплате</p>
                    <p className="mt-0.5 truncate text-xs font-black text-stone-950">{formatMoney(balanceDueAed, clientCurrency)}</p>
                  </div>
                  <div className="rounded-2xl bg-stone-100 px-2 py-2">
                    <p className="text-[9px] font-black text-stone-400">Закуп</p>
                    <p className="mt-0.5 truncate text-xs font-black text-stone-950">{formatMoney(selectedOfferTotal)}</p>
                  </div>
                </div>
                <button type="button" onClick={() => void shareQuote()} className="ds-press flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-stone-100 text-[11px] font-black text-stone-800">
                  <Share2 size={14} /> Запросить оплату / отправить смету
                </button>
              </section>

              <section className="ds-surface space-y-2 rounded-[22px] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-black text-stone-600">Цены продажи</p>
                  <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-black text-stone-600">{pricedPartsCount}/{partsCount || 0}</span>
                </div>
                {(order.parts || []).length > 0 ? (
                  <div className="space-y-2">
                    {(order.parts || []).map((part) => {
                      const variant = getFinanceVariant(part);
                      const quantity = normalizePartQuantity(part.quantity);
                      const purchasePrice = Number(variant?.purchasePriceAed ?? variant?.priceAed ?? 0);
                      const salePrice = Number(variant?.salePriceAed ?? variant?.priceAed ?? 0);
                      return (
                        <div key={`finance-sale-${part.id}`} className="rounded-xl bg-stone-950/[0.04] p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-black text-stone-950">{getPartDisplayName(part)}</p>
                              {variant && <p className="mt-0.5 truncate text-[10px] font-bold text-stone-500">{`${variant.shopName || 'Поставщик'} · ${purchasePrice.toFixed(0)} AED · ${quantity} шт`}</p>}
                            </div>
                            <button type="button" onClick={() => openPartDetails(part.id, variant?.id)} className="ds-press flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-stone-700" aria-label="Открыть деталь"><ChevronRight size={13} /></button>
                          </div>
                          <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoComplete="off"
                              value={variant && salePrice > 0 ? String(salePrice) : ''}
                              disabled={!variant}
                              onChange={(event) => updatePartSalePrice(part.id, event.target.value)}
                              placeholder="Продажа AED"
                              className="ds-input h-9 min-w-0 rounded-xl border-0 px-3 text-xs font-black text-stone-950 outline-none disabled:opacity-45"
                            />
                            <div className={`flex h-9 min-w-[68px] items-center justify-center rounded-xl px-2 text-[11px] font-black ${salePrice >= purchasePrice && salePrice > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                              {variant ? `${(salePrice - purchasePrice).toFixed(0)} AED` : '—'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="ds-soft-empty rounded-2xl p-4 text-center text-xs font-bold text-stone-500">Деталей пока нет.</div>
                )}
              </section>

              <section ref={markupSectionRef} className="ds-surface space-y-2 rounded-[22px] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-black text-stone-600">Управление маржой</p>
                  <div className="inline-flex rounded-full bg-stone-100 p-0.5">
                    <button type="button" onClick={() => updateOrderField('markupType', 'percent')} className={`ds-press h-8 rounded-full px-3 text-[11px] font-black ${(order.markupType || 'percent') === 'percent' ? 'bg-stone-950 text-white' : 'text-stone-500'}`}>%</button>
                    <button type="button" onClick={() => updateOrderField('markupType', 'fixed')} className={`ds-press h-8 rounded-full px-3 text-[11px] font-black ${(order.markupType || 'percent') === 'fixed' ? 'bg-stone-950 text-white' : 'text-stone-500'}`}>AED</button>
                  </div>
                </div>
                {(order.markupType || 'percent') === 'percent' ? (
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {MARKUP_OPTIONS.map((option) => (
                      <button key={option} type="button" onClick={() => updateOrderField('markupPercent', Number(option))} className={`ds-press h-9 shrink-0 rounded-xl px-3 text-[11px] font-black ${Number(draftFields.markupPercent ?? order.markupPercent) === option ? 'bg-stone-950 text-white' : 'bg-stone-100 text-stone-500'}`}>{option}%</button>
                    ))}
                  </div>
                ) : (
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={markupFixedInput} onFocus={() => { if (markupFixedInput === '0') setMarkupFixedInput(''); }} onBlur={() => { if (!markupFixedInput) setMarkupFixedInput('0'); flushMarkupCommit(); }} onChange={handleMarkupFixedChange} placeholder="Markup AED" className="ds-input h-9 w-full rounded-xl border-0 px-3 text-xs font-black text-stone-950 outline-none" />
                )}
                <label className="flex items-center gap-2 text-[11px] font-bold text-stone-500">
                  <input type="checkbox" checked={!!order.useMarkupAsDefaultForNewParts} onChange={(event) => updateOrderField('useMarkupAsDefaultForNewParts', event.target.checked)} />
                  По умолчанию для новых деталей
                </label>
              </section>

              <section className="ds-surface rounded-[22px] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-black text-stone-600">Валюта клиента</p>
                  <select
                    value={clientCurrency}
                    onChange={(event) => updateOrderField('clientCurrency', event.target.value as Order['clientCurrency'])}
                    className="ds-input h-9 rounded-xl border-0 px-3 text-xs font-black text-stone-950 outline-none"
                  >
                    {(['AED', 'USD', 'RUB', 'TJS', 'KZT', 'UZS'] as const).map((currency) => <option key={`finance-currency-${currency}`} value={currency}>{currency}</option>)}
                  </select>
                </div>
              </section>

              <section className="ds-surface space-y-2 rounded-[22px] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-black text-stone-600">Скидка</p>
                  <div className="inline-flex rounded-full bg-stone-100 p-0.5">
                    <button type="button" onClick={() => updateOrderField('discountType', 'percent')} className={`ds-press h-8 rounded-full px-3 text-[11px] font-black ${discountType === 'percent' ? 'bg-stone-950 text-white' : 'text-stone-500'}`}>%</button>
                    <button type="button" onClick={() => updateOrderField('discountType', 'fixed')} className={`ds-press h-8 rounded-full px-3 text-[11px] font-black ${discountType === 'fixed' ? 'bg-stone-950 text-white' : 'text-stone-500'}`}>AED</button>
                  </div>
                </div>
                {discountType === 'percent' ? (
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {DISCOUNT_OPTIONS.map((option) => (
                      <button key={`finance-discount-${option}`} type="button" onClick={() => updateOrderField('discountPercent', Number(option))} className={`ds-press h-9 shrink-0 rounded-xl px-3 text-[11px] font-black ${Number(draftFields.discountPercent ?? order.discountPercent ?? 0) === option ? 'bg-stone-950 text-white' : 'bg-stone-100 text-stone-500'}`}>{option}%</button>
                    ))}
                  </div>
                ) : (
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={discountFixedInput} onFocus={() => { if (discountFixedInput === '0') setDiscountFixedInput(''); }} onBlur={() => { if (!discountFixedInput) setDiscountFixedInput('0'); flushDiscountCommit(); }} onChange={handleDiscountFixedChange} placeholder="Discount AED" className="ds-input h-9 w-full rounded-xl border-0 px-3 text-xs font-black text-stone-950 outline-none" />
                )}
              </section>

              <section className="ds-surface space-y-2 rounded-[22px] p-3">
                <div className="flex items-center justify-between">
                    <p className="text-[12px] font-black text-stone-600">Услуги</p>
                  <span className="text-[11px] font-black text-stone-500">{formatDualMoney(logisticsWithCargoTotal)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { field: 'deliveryAed', label: 'Доставка' },
                    { field: 'packingAed', label: 'Упаковка' },
                    { field: 'serviceFeeAed', label: 'Сервис' }
                  ] as const).map(({ field, label }) => (
                    <label key={field} className="space-y-1">
                      <span className="text-[10px] font-black text-stone-400">{label}</span>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={logisticsDraft[field]} onFocus={() => { if (logisticsDraft[field] === '0') onLogisticsDraftChange(field, ''); }} onBlur={() => { if (!logisticsDraft[field]) onLogisticsDraftChange(field, '0'); }} onChange={(event) => onLogisticsDraftChange(field, sanitizeNumericInput(event.target.value))} className="ds-input h-9 w-full rounded-xl border-0 px-2 text-center text-xs font-black text-stone-950 outline-none" />
                    </label>
                  ))}
                </div>
                <button type="button" onClick={saveLogisticsDraft} disabled={!hasPendingPricingChanges} className={`ds-press h-9 w-full rounded-xl px-3 text-[11px] font-black ${hasPendingPricingChanges ? 'bg-stone-950 text-white' : 'bg-stone-100 text-stone-400'}`}>Сохранить услуги</button>
              </section>

              <section className="ds-surface space-y-2 rounded-[22px] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-black text-stone-600">Депозит</p>
                  <div className="text-right">
                    <p className="text-xs font-black text-emerald-700">-{formatMoney(depositAmountAed)}</p>
                    <p className="mt-0.5 text-[10px] font-black text-stone-950">К оплате {formatMoney(balanceDueAed, clientCurrency)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(92px,112px)] gap-2">
                  <label className="min-w-0 space-y-1">
                    <span className="text-[10px] font-black text-stone-400">Сумма</span>
                    <input type="text" inputMode="decimal" value={depositAmountInput} onChange={(event) => setDepositAmountInput(sanitizeDecimalInput(event.target.value))} placeholder="0" className="ds-input h-9 w-full rounded-xl border-0 px-3 text-xs font-black text-stone-950 outline-none" />
                  </label>
                  <label className="min-w-0 space-y-1">
                    <span className="text-[10px] font-black text-stone-400">Валюта</span>
                    <select value={depositCurrencyInput} onChange={(event) => {
                      const currency = event.target.value as NonNullable<Order['searchDepositCurrency']>;
                      setDepositCurrencyInput(currency);
                      setDepositRateInput(String(getDepositRate(currency)));
                    }} className="ds-input h-9 w-full rounded-xl border-0 px-2 text-xs font-black text-stone-950 outline-none">
                      {(['AED', 'USD', 'RUB', 'TJS', 'KZT', 'UZS'] as const).map((currency) => <option key={`finance-deposit-${currency}`} value={currency}>{currency}</option>)}
                    </select>
                  </label>
                </div>
                {depositCurrencyInput !== 'AED' && (
                  <label className="block space-y-1">
                    <span className="text-[10px] font-black text-stone-400">1 {depositCurrencyInput} = AED</span>
                    <input type="text" inputMode="decimal" value={depositRateInput} onChange={(event) => setDepositRateInput(sanitizeDecimalInput(event.target.value))} placeholder="0.00" className="ds-input h-9 w-full rounded-xl border-0 px-3 text-xs font-black text-stone-950 outline-none" />
                  </label>
                )}
                <button type="button" onClick={submitDeposit} className="ds-press h-9 w-full rounded-xl bg-stone-950 px-3 text-[11px] font-black text-white">Сохранить депозит</button>
              </section>

              {depositAmountAed > 0 && (
                <section className="ds-surface rounded-[22px] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[12px] font-black text-stone-600">Депозит</p>
                      <p className="mt-0.5 text-[10px] font-semibold text-stone-500">{order.searchDepositAmount} {order.searchDepositCurrency || 'AED'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-emerald-700">-{formatMoney(depositAmountAed)}</p>
                      <p className="mt-0.5 text-[10px] font-black text-stone-950">К оплате {formatMoney(balanceDueAed, clientCurrency)}</p>
                    </div>
                  </div>
                </section>
              )}

              {sellError && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-xs font-black text-rose-700">{sellError}</div>}

              <section className="space-y-1.5 rounded-[22px] border border-stone-200/70 bg-[#F4F1EA]/96 p-2 shadow-[0_10px_30px_rgba(23,23,23,0.08)]">
                <div className="grid grid-cols-4 gap-1.5">
                  <div className="rounded-xl bg-stone-950 px-2 py-1.5 text-white">
                    <p className="text-[8px] font-black text-white/45">Прибыль</p>
                    <p className="mt-0.5 truncate text-[11px] font-black">{shownNetProfit !== null ? formatMoney(shownNetProfit) : '—'}</p>
                  </div>
                  <div className="rounded-xl bg-white px-2 py-1.5">
                    <p className="text-[8px] font-black text-stone-400">К оплате</p>
                    <p className="mt-0.5 truncate text-[11px] font-black text-stone-950">{formatMoney(balanceDueAed, clientCurrency)}</p>
                  </div>
                  <div className="rounded-xl bg-white px-2 py-1.5">
                    <p className="text-[8px] font-black text-stone-400">Закуп</p>
                    <p className="mt-0.5 truncate text-[11px] font-black text-stone-950">{formatMoney(selectedOfferTotal)}</p>
                  </div>
                  <div className="rounded-xl bg-white px-2 py-1.5">
                    <p className="text-[8px] font-black text-stone-400">Маржа</p>
                    <p className="mt-0.5 truncate text-[11px] font-black text-stone-950">{marginPercent !== null ? `${marginPercent.toFixed(0)}%` : '—'}</p>
                  </div>
                </div>
                <button type="button" onClick={() => void sendFinanceTextQuote()} className="ds-press flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-[11px] font-black uppercase tracking-[0.06em] text-white"><MessageCircle size={14} /> Текстовая смета</button>
              </section>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className={`${tabPanelClassName} space-y-5`}>
              <section ref={notesSectionRef} className="hidden">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Transaction memory</p>
                    <h2 className="mt-1 text-xl font-black text-stone-950">Заметки и голос</h2>
                  </div>
                  {latestNote && <span className="rounded-full bg-stone-100 px-3 py-2 text-[10px] font-black text-stone-500">{new Date(latestNote.createdAt).toLocaleDateString()}</span>}
                </div>
                <textarea value={newNoteText} onChange={(event) => setNewNoteText(event.target.value)} placeholder="Что произошло, что сказал клиент, детали поставщика..." className="ds-input w-full rounded-2xl border-0 p-3 text-sm font-bold text-stone-800 outline-none placeholder:text-stone-400" rows={3} />
                {recordingError && <p className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{recordingError}</p>}
                {recordingSavedLocally && <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">Recording saved locally</p>}
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  <button type="button" onClick={() => noteFileRef.current?.click()} aria-label="Прикрепить фото" className="ds-press inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-stone-100 px-4 text-xs font-black text-stone-700"><ImageIcon size={17} /> Фото</button>
                  <button type="button" onClick={() => noteAudioFileRef.current?.click()} aria-label="Attach audio file" className="ds-press inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-stone-100 px-4 text-xs font-black text-stone-700"><FileAudio size={17} /> File</button>
                  <button type="button" onClick={() => void toggleRecording()} aria-label="Voice" className={`ds-press inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl px-4 text-xs font-black ${isRecording ? 'bg-rose-50 text-rose-700' : 'bg-stone-950 text-white'}`}><Mic size={16} /> Voice</button>
                  {newNotePhotos.map((photo, index) => <SafeImage key={`${photo}-${index}`} src={photo} alt="Новая заметка" className="h-12 w-12 shrink-0 rounded-2xl object-cover" />)}
                  {newNoteAudios.map((audioItem, index) => {
                    const voice = toVoiceNoteAudio(audioItem);
                    const audioId = `draft-audio-${voice.id}`;
                    const isPlaying = playingAudioId === audioId;
                    const progress = audioProgress[audioId] || 0;
                    const bars = voice.waveform && voice.waveform.length > 0 ? voice.waveform.slice(-40) : getWaveBars(voice.fileUrl.slice(0, 120));
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
                <button type="button" onClick={addNote} className="ds-press h-12 w-full rounded-2xl bg-stone-950 text-xs font-black uppercase tracking-[0.12em] text-white">Добавить запись</button>
              </section>

              {(order.notes || []).length === 0 && (
                <button type="button" onClick={() => {
                  notesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  window.setTimeout(() => noteFileRef.current?.focus(), 180);
                }} className="ds-press ds-soft-empty flex min-h-[128px] w-full flex-col items-center justify-center rounded-[26px] px-5 text-center">
                  <MessageCircle size={24} className="text-stone-400" />
                  <span className="mt-2 text-sm font-black text-stone-700">Заметок пока нет</span>
                  <span className="mt-1 text-xs font-semibold leading-5 text-stone-400">Пишите как в чате: текст, фото и голос остаются в истории сделки.</span>
                </button>
              )}

              {(order.notes || []).length > 0 && (
                <section className="space-y-2">
                  {(order.notes || []).map((note) => {
                    const noteDisplayText = getNoteDisplayText(note);
                    return (
                    <article key={note.id} className="ds-surface rounded-[24px] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {noteDisplayText && <p className="text-sm font-semibold leading-6 text-stone-800">{noteDisplayText}</p>}
                          <p className={`${noteDisplayText ? 'mt-2' : ''} text-[10px] font-black uppercase tracking-[0.16em] text-stone-400`}>{new Date(note.createdAt).toLocaleString()}</p>
                        </div>
                        <button type="button" onClick={() => setDeleteNoteConfirmId(note.id)} className="ds-press flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600" aria-label="Удалить заметку"><X size={14} /></button>
                      </div>
                      {note.photos && note.photos.length > 0 && (
                        <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
                          {note.photos.map((photo, index) => (
                            <div key={`${photo}-${index}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl">
                              {isVideoMedia(photo) ? (
                                <button type="button" onClick={() => openMediaPreview(note.photos || [], index)} className="ds-press relative h-full w-full bg-stone-950 text-white" aria-label="Открыть видео">
                                  <video src={photo} className="pointer-events-none h-full w-full object-cover opacity-85" muted playsInline preload="metadata" />
                                  <span className="absolute inset-0 grid place-items-center bg-black/20 text-[9px] font-black">Видео</span>
                                </button>
                              ) : (
                                <button type="button" onClick={() => openMediaPreview(note.photos || [], index)} className="ds-press h-full w-full"><SafeImage src={photo} alt="Заметка" className="h-full w-full object-cover" /></button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {note.attachments && note.attachments.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {note.attachments.map((attachment, index) => renderAttachmentCard(attachment, index))}
                        </div>
                      )}
                      {note.audios && note.audios.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {note.audios.map((audioItem, index) => {
                            const voice = toVoiceNoteAudio(audioItem);
                            const audioId = `note-${note.id}-${voice.id}-${index}`;
                            const isPlaying = playingAudioId === audioId;
                            const progress = audioProgress[audioId] || 0;
                            const bars = voice.waveform && voice.waveform.length > 0 ? voice.waveform.slice(-40) : getWaveBars(voice.fileUrl.slice(0, 120));
                            return (
                              <div key={audioId} className="rounded-2xl bg-stone-950/[0.04] p-3">
                                <div className="flex items-center gap-2">
                                  <button type="button" onClick={() => toggleAudioPlayback(audioId)} className="ds-press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-950 text-white" aria-label="Прослушать заметку">{isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}</button>
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
                                  <button type="button" onClick={() => removeNoteAudio(note.id, index)} className="ds-press rounded-xl bg-white px-3 py-1.5 text-[10px] font-black text-rose-600">Удалить</button>
                                  <a href={voice.fileUrl} download={`voice-note-${voice.id}.webm`} className="ds-press inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-[10px] font-black text-stone-700"><Download size={11} /> Скачать</a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </article>
                    );
                  })}
                </section>
              )}

            </div>
          )}
        </div>

        <input type="file" ref={partFileRef} onChange={handlePhotoChange} className="hidden" accept="image/*" multiple />
        <input type="file" ref={proofFileRef} onChange={handleProofPhotoChange} className="hidden" accept="image/*" multiple />
        <input type="file" ref={chatMediaInputRef} onChange={handleChatMediaChange} className="hidden" accept="image/*,video/*" multiple />
        <input type="file" ref={chatCameraInputRef} onChange={handleChatMediaChange} className="hidden" accept="image/*,video/*" capture="environment" />
        <input type="file" ref={chatFileInputRef} onChange={handleChatFileChange} className="hidden" multiple />
        <input type="file" ref={noteAudioFileRef} onChange={handleNoteAudioFileChange} className="hidden" accept="audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.webm" multiple />

        {activeTab !== 'finance' && !(activeTab === 'search' && sourcingLocked) && (
        <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-stone-200/70 bg-[#F4F1EA]/96 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[calc(10px+env(safe-area-inset-bottom))] pt-2 shadow-[0_-18px_44px_rgba(23,23,23,0.16)] backdrop-blur-xl" style={{ paddingBottom: ORDER_DETAILS_DOCK_SAFE_PADDING }}>
          {activeTab === 'search' && !sourcingLocked && (
              <form onSubmit={(event) => { event.preventDefault(); addNewPart(); }} className="space-y-2">
                {newPartKind === 'group' && (
                  <div className="max-h-44 space-y-2 overflow-y-auto rounded-2xl bg-white p-2">
                    {newPartGroupItems.map((item, index) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <input type="text" value={item.name} onChange={(event) => updateGroupItemRow(item.id, 'name', event.target.value)} placeholder={`Деталь ${index + 1}`} className="h-10 min-w-0 flex-1 rounded-xl border-0 bg-stone-100 px-3 text-xs font-black text-stone-950 outline-none placeholder:text-stone-400" />
                        <select value={item.quantity} onChange={(event) => updateGroupItemRow(item.id, 'quantity', event.target.value)} className="h-10 w-14 rounded-xl border-0 bg-stone-100 text-center text-xs font-black text-stone-950 outline-none">
                          {Array.from({ length: 20 }, (_, qtyIdx) => String(qtyIdx + 1)).map((qty) => <option key={qty} value={qty}>{qty}</option>)}
                        </select>
                        <button type="button" onClick={() => removeGroupItemRow(item.id)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600" aria-label="Удалить строку"><X size={13} /></button>
                      </div>
                    ))}
                    <button type="button" onClick={addGroupItemRow} className="h-9 w-full rounded-xl bg-stone-950 text-[11px] font-black text-white">Добавить деталь в группу</button>
                  </div>
                )}
                {newPartPhotos.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto rounded-2xl bg-white p-2 no-scrollbar">
                    {newPartPhotos.map((photo, index) => (
                      <div key={`${photo}-${index}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-stone-200">
                        <SafeImage src={photo} alt={`Фото детали ${index + 1}`} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            removeNewPhoto(index);
                          }}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white"
                          aria-label="Удалить фото"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => partFileRef.current?.click()} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-700" aria-label="Фото детали"><ImageIcon size={18} /></button>
                  <button type="button" onClick={() => { setNewPartKind((value) => value === 'group' ? 'single' : 'group'); setNewPartGroupItems((prev) => prev.length > 0 ? prev : [createGroupItemDraft()]); }} className={`ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${newPartKind === 'group' ? 'bg-stone-950 text-white' : 'bg-white text-stone-700'}`} aria-label="Группа деталей"><Package size={17} /></button>
                  <div className="flex min-w-0 flex-1 items-center rounded-2xl bg-white px-3">
                    <input ref={partInputRef} type="text" value={newPartName} onChange={(event) => setNewPartName(event.target.value)} placeholder="Добавить деталь..." className="h-12 min-w-0 flex-1 border-0 bg-transparent text-sm font-black text-stone-950 outline-none placeholder:text-stone-400" />
                  </div>
                  <button type="submit" className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white" aria-label="Добавить деталь"><Plus size={17} /></button>
                </div>
              </form>
          )}
          {activeTab === 'notes' && renderChatComposer('note')}
          {false && activeTab === 'notes' && (
            <form onSubmit={(event) => { event.preventDefault(); addNote(); }} className="space-y-2">
              {(newNoteText.trim().length > 0 || newNotePhotos.length > 0 || newNoteAudios.length > 0) && <div className="rounded-2xl bg-white px-3 py-2 text-xs font-bold text-stone-500">Черновик заметки активен</div>}
              {isRecording ? (
                <div className="rounded-[28px] border border-rose-100 bg-white/96 p-2 shadow-[0_18px_46px_rgba(15,23,42,0.16)] ring-1 ring-white/70">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={requestCancelRecording} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600" aria-label="Отменить запись"><X size={18} /></button>
                    <div className="min-w-0 flex-1 rounded-[22px] bg-[#F4F6F8] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-3 w-3 shrink-0">
                          {!isRecordingPaused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" />}
                          <span className={`relative inline-flex h-3 w-3 rounded-full ${isRecordingPaused ? 'bg-amber-400' : 'bg-rose-500'}`} />
                        </span>
                        <span className="font-mono text-[13px] font-black text-stone-950">{formatSeconds(recordingElapsedSeconds)}</span>
                        <span className="truncate text-[11px] font-black text-stone-400">{isRecordingPaused ? 'Пауза' : 'Голос записывается'}</span>
                      </div>
                      <div className="mt-1.5 flex h-8 items-center gap-0.5">
                        {recordingWaveform.slice(-32).map((height, index) => (
                          <span key={`note-recording-wave-${index}`} className={`block flex-1 rounded-full transition-all ${isRecordingPaused ? 'bg-amber-300' : 'bg-rose-400'}`} style={{ height: `${Math.max(18, height * 0.78)}%` }} />
                        ))}
                      </div>
                    </div>
                    <button type="button" onClick={toggleRecordingPause} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700" aria-label={isRecordingPaused ? 'Продолжить запись' : 'Пауза'}>{isRecordingPaused ? <Play size={17} className="ml-0.5" /> : <Pause size={17} />}</button>
                    <button type="button" onClick={() => void toggleRecording()} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_12px_26px_rgba(16,185,129,0.28)]" aria-label="Сохранить запись"><Check size={20} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => noteFileRef.current?.click()} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-700" aria-label="Прикрепить фото"><ImageIcon size={18} /></button>
                  <button type="button" onClick={() => void toggleRecording()} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-700" aria-label="Записать голос"><Mic size={18} /></button>
                  <div className="min-w-0 flex-1 rounded-2xl bg-white px-3 py-2"><textarea value={newNoteText} onChange={(event) => setNewNoteText(event.target.value)} placeholder="Сообщение..." rows={1} className="no-scrollbar max-h-24 min-h-8 w-full resize-none overflow-hidden border-0 bg-transparent text-sm font-bold leading-6 text-stone-900 outline-none placeholder:text-stone-400" /></div>
                  <button type="submit" disabled={!newNoteText.trim() && newNotePhotos.length === 0 && newNoteAudios.length === 0} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white disabled:bg-stone-200 disabled:text-stone-400" aria-label="Отправить заметку"><Send size={17} /></button>
                </div>
              )}
              <input type="file" ref={noteFileRef} onChange={handleNotePhotoChange} className="hidden" accept="image/*" multiple />
              <input type="file" ref={noteAudioFileRef} onChange={handleNoteAudioFileChange} className="hidden" accept="audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.webm" multiple />
            </form>
          )}
          {activeTab === 'overview' && <button type="button" onClick={() => void shareQuote()} className="ds-press flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 text-xs font-black uppercase tracking-[0.08em] text-white">Отправить / обновить смету<ChevronRight size={15} /></button>}
          {activeTab === 'proof' && renderChatComposer('proof')}
          {false && activeTab === 'proof' && (
            <form onSubmit={(event) => { event.preventDefault(); addClientProofNote(); }} className="space-y-2">
              {(newProofPhotos.length > 0 || newProofAudios.length > 0) && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  {newProofPhotos.map((photo, index) => (
                    <div key={`${photo}-${index}`} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-stone-200">
                      <SafeImage src={photo} alt="Proof draft" className="h-full w-full object-cover" />
                      <button type="button" onClick={() => removeNewProofPhoto(index)} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white" aria-label="Удалить фото"><X size={11} /></button>
                    </div>
                  ))}
                  {newProofAudios.map((audioItem, index) => {
                    const voice = toVoiceNoteAudio(audioItem);
                    return (
                      <button key={`proof-draft-audio-${voice.id}`} type="button" onClick={() => removeNewProofAudio(index)} className="ds-press inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-white px-3 text-[11px] font-black text-stone-700">
                        <Mic size={14} /> {formatSeconds(voice.duration)} <X size={11} />
                      </button>
                    );
                  })}
                </div>
              )}
              {proofComposerMode === 'video' ? (
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => setProofComposerMode('message')} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-700" aria-label="Текст"><FileText size={18} /></button>
                  <div className="min-w-0 flex-1 rounded-2xl bg-white px-3 py-2">
                    <input type="url" value={newProofVideoUrl} onChange={(event) => setNewProofVideoUrl(event.target.value)} placeholder="Ссылка на видео..." className="h-8 w-full border-0 bg-transparent text-sm font-bold text-stone-900 outline-none placeholder:text-stone-400" />
                  </div>
                  <button type="submit" disabled={!newProofVideoUrl.trim()} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white disabled:bg-stone-200 disabled:text-stone-400" aria-label="Отправить видео"><Send size={17} /></button>
                </div>
              ) : isRecording ? (
                <div className="rounded-[28px] border border-rose-100 bg-white/96 p-2 shadow-[0_18px_46px_rgba(15,23,42,0.16)] ring-1 ring-white/70">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={requestCancelRecording} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600" aria-label="Отменить запись"><X size={18} /></button>
                    <div className="min-w-0 flex-1 rounded-[22px] bg-[#F4F6F8] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-3 w-3 shrink-0">
                          {!isRecordingPaused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" />}
                          <span className={`relative inline-flex h-3 w-3 rounded-full ${isRecordingPaused ? 'bg-amber-400' : 'bg-rose-500'}`} />
                        </span>
                        <span className="font-mono text-[13px] font-black text-stone-950">{formatSeconds(recordingElapsedSeconds)}</span>
                        <span className="truncate text-[11px] font-black text-stone-400">{isRecordingPaused ? 'Пауза' : 'Голос записывается'}</span>
                      </div>
                      <div className="mt-1.5 flex h-8 items-center gap-0.5">
                        {recordingWaveform.slice(-32).map((height, index) => (
                          <span key={`proof-recording-wave-${index}`} className={`block flex-1 rounded-full transition-all ${isRecordingPaused ? 'bg-amber-300' : 'bg-rose-400'}`} style={{ height: `${Math.max(18, height * 0.78)}%` }} />
                        ))}
                      </div>
                    </div>
                    <button type="button" onClick={toggleRecordingPause} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700" aria-label={isRecordingPaused ? 'Продолжить запись' : 'Пауза'}>{isRecordingPaused ? <Play size={17} className="ml-0.5" /> : <Pause size={17} />}</button>
                    <button type="button" onClick={() => void toggleRecording()} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_12px_26px_rgba(16,185,129,0.28)]" aria-label="Сохранить запись"><Check size={20} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => proofFileRef.current?.click()} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-700" aria-label="Добавить фото"><ImageIcon size={18} /></button>
                  <button type="button" onClick={() => setProofComposerMode('video')} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-700" aria-label="Добавить видео"><Video size={18} /></button>
                  <button type="button" onClick={() => void toggleRecording('proof')} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-700" aria-label="Записать голос"><Mic size={18} /></button>
                  <div className="min-w-0 flex-1 rounded-2xl bg-white px-3 py-2">
                    <textarea value={newProofText} onChange={(event) => setNewProofText(event.target.value)} placeholder="Текст клиенту..." rows={1} className="no-scrollbar max-h-24 min-h-8 w-full resize-none overflow-hidden border-0 bg-transparent text-sm font-bold leading-6 text-stone-900 outline-none placeholder:text-stone-400" />
                  </div>
                  <button type="submit" disabled={!newProofText.trim() && newProofPhotos.length === 0 && newProofAudios.length === 0} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white disabled:bg-stone-200 disabled:text-stone-400" aria-label="Отправить пруф"><Send size={17} /></button>
                </div>
              )}
            </form>
          )}
        </div>
        )}

        {isAttachmentSheetOpen && (
          <div className="fixed inset-0 z-[58] bg-slate-950/25 backdrop-blur-[2px]" onClick={() => setIsAttachmentSheetOpen(false)}>
            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[32px] border border-slate-200/80 bg-white/96 px-4 pb-[calc(18px+env(safe-area-inset-bottom))] pt-3 text-slate-950 shadow-[0_-22px_56px_rgba(15,23,42,0.16)] backdrop-blur-xl" onClick={(event) => event.stopPropagation()}>
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />
              <div className="grid grid-cols-3 gap-3">
                <button type="button" onClick={() => openMediaPicker(attachmentTargetRef.current)} className="ds-press flex flex-col items-center gap-2 rounded-[22px] bg-slate-50 p-3 text-xs font-black text-slate-800 ring-1 ring-slate-200/70">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-50 text-blue-600"><ImageIcon size={20} /></span>
                  Фото/видео
                </button>
                <button type="button" onClick={() => openCameraPicker(attachmentTargetRef.current)} className="ds-press flex flex-col items-center gap-2 rounded-[22px] bg-slate-50 p-3 text-xs font-black text-slate-800 ring-1 ring-slate-200/70">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-rose-50 text-rose-600"><Camera size={20} /></span>
                  Camera
                </button>
                <button type="button" onClick={() => openFilePicker(attachmentTargetRef.current)} className="ds-press flex flex-col items-center gap-2 rounded-[22px] bg-slate-50 p-3 text-xs font-black text-slate-800 ring-1 ring-slate-200/70">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-50 text-violet-600"><Paperclip size={20} /></span>
                  File
                </button>
                <button type="button" onClick={() => addLocationAttachment(attachmentTargetRef.current)} className="ds-press flex flex-col items-center gap-2 rounded-[22px] bg-slate-50 p-3 text-xs font-black text-slate-800 ring-1 ring-slate-200/70">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><MapPin size={20} /></span>
                  Location
                </button>
                <button type="button" onClick={() => addContactAttachment(attachmentTargetRef.current)} className="ds-press flex flex-col items-center gap-2 rounded-[22px] bg-slate-50 p-3 text-xs font-black text-slate-800 ring-1 ring-slate-200/70">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-50 text-amber-600"><User size={20} /></span>
                  Contact
                </button>
                <button type="button" onClick={() => openAudioPicker(attachmentTargetRef.current)} className="ds-press flex flex-col items-center gap-2 rounded-[22px] bg-slate-50 p-3 text-xs font-black text-slate-800 ring-1 ring-slate-200/70">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-50 text-cyan-600"><FileAudio size={20} /></span>
                  Audio
                </button>
              </div>
            </div>
          </div>
        )}

        {isDepositDialogOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="ds-mode-enter ds-surface w-full max-w-sm space-y-4 rounded-[28px] p-4 text-stone-950 shadow-2xl">
              <div>
                <p className="text-sm font-black">Подтвердить депозит</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-stone-500">Сумма может быть 0. Тогда депозит сохранится только как факт оплаты и не попадёт в расчёты.</p>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(92px,112px)] gap-2">
                <label className="min-w-0 space-y-1">
                  <span className="text-[10px] font-black text-stone-400">Сумма</span>
                  <input type="text" inputMode="decimal" value={depositAmountInput} onChange={(event) => setDepositAmountInput(sanitizeDecimalInput(event.target.value))} placeholder="0" className="ds-input h-12 w-full rounded-2xl border-0 px-3 text-sm font-black text-stone-950 outline-none" />
                </label>
                <label className="min-w-0 space-y-1">
                  <span className="text-[10px] font-black text-stone-400">Валюта</span>
                  <select value={depositCurrencyInput} onChange={(event) => {
                    const currency = event.target.value as NonNullable<Order['searchDepositCurrency']>;
                    setDepositCurrencyInput(currency);
                    setDepositRateInput(String(getDepositRate(currency)));
                  }} className="ds-input h-12 w-full rounded-2xl border-0 px-2 text-xs font-black text-stone-950 outline-none">
                    {(['AED', 'USD', 'RUB', 'TJS', 'KZT', 'UZS'] as const).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                </label>
              </div>
              {depositCurrencyInput !== 'AED' && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-black text-stone-400">1 {depositCurrencyInput} = AED</span>
                  <input type="text" inputMode="decimal" value={depositRateInput} onChange={(event) => setDepositRateInput(sanitizeDecimalInput(event.target.value))} placeholder="0.00" className="ds-input h-12 w-full rounded-2xl border-0 px-3 text-sm font-black text-stone-950 outline-none" />
                </label>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setIsDepositDialogOpen(false)} className="ds-press h-11 rounded-2xl bg-stone-100 text-xs font-black text-stone-700">Отмена</button>
                <button type="button" onClick={submitDeposit} className="ds-press h-11 rounded-2xl bg-stone-950 text-xs font-black text-white">Сохранить</button>
              </div>
            </div>
          </div>
        )}

        {isDiscardConfirmOpen && (
          <div className="fixed inset-0 z-[60] bg-black/50 p-4">
            <div className="ds-mode-enter ds-surface mx-auto mt-28 w-full max-w-sm space-y-3 rounded-[24px] p-4 text-stone-950">
              <p className="text-sm font-black">Удалить запись?</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={confirmDiscardRecording} className="ds-press h-11 rounded-2xl bg-rose-50 text-xs font-black text-rose-700">Удалить</button>
                <button type="button" onClick={() => setIsDiscardConfirmOpen(false)} className="ds-press h-11 rounded-2xl bg-stone-100 text-xs font-black text-stone-700">Продолжить</button>
              </div>
            </div>
          </div>
        )}

        <ConfirmModal isOpen={!!deletePartId} message="Вы уверены, что хотите удалить эту деталь?" onConfirm={confirmDeletePart} onCancel={() => setDeletePartId(null)} />
        <ConfirmModal isOpen={!!deleteNoteConfirmId} message="Удалить заметку? Фото, видео и голос внутри этой заметки тоже удалятся из истории заказа." confirmLabel="Удалить" confirmClass="bg-red-600 active:bg-red-700" onConfirm={confirmDeleteNote} onCancel={() => setDeleteNoteConfirmId(null)} />
        <ConfirmModal isOpen={deleteOrderConfirmOpen} message="Удалить заказ? Это действие удалит заказ и связанные детали." confirmLabel="Удалить" confirmClass="bg-red-600 active:bg-red-700" onConfirm={() => void confirmDeleteOrder()} onCancel={() => setDeleteOrderConfirmOpen(false)} />
        <ConfirmModal isOpen={showSellConfirm} message={order.isSold ? "Вернуть заказ в активные?" : "Отметить заказ как проданный?"} confirmLabel={order.isSold ? "Да, вернуть" : "Да, продано"} confirmClass={order.isSold ? "bg-blue-600 active:bg-blue-700" : "bg-green-600 active:bg-green-700"} onConfirm={confirmSellOrder} onCancel={() => setShowSellConfirm(false)} />

        {videoPreview && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black p-0" onClick={() => setVideoPreview(null)}>
            <button type="button" onClick={() => setVideoPreview(null)} className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] z-20 grid h-11 w-11 place-items-center rounded-full bg-white/12 text-white backdrop-blur" aria-label="Закрыть видео">
              <X size={22} />
            </button>
            <div className="absolute left-4 top-[calc(1rem+env(safe-area-inset-top))] z-20 rounded-full bg-white/12 px-3 py-1 text-xs font-black text-white backdrop-blur">
              {videoPreview.index + 1} / {videoPreview.videos.length}
            </div>
            <video
              key={videoPreview.videos[videoPreview.index]}
              src={videoPreview.videos[videoPreview.index]}
              className="h-[100dvh] w-full bg-black object-contain"
              controls
              autoPlay
              playsInline
              onClick={(event) => event.stopPropagation()}
            />
            {videoPreview.videos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setVideoPreview((current) => current ? { ...current, index: Math.max(0, current.index - 1) } : current);
                  }}
                  disabled={videoPreview.index === 0}
                  className="absolute left-4 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white disabled:opacity-35"
                  aria-label="Предыдущее видео"
                >
                  <ArrowLeft size={22} />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setVideoPreview((current) => current ? { ...current, index: Math.min(current.videos.length - 1, current.index + 1) } : current);
                  }}
                  disabled={videoPreview.index >= videoPreview.videos.length - 1}
                  className="absolute right-4 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white disabled:opacity-35"
                  aria-label="Следующее видео"
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </div>
        )}

        {gallery && (
          <ImagePreview images={gallery.images} initialIndex={gallery.index} shareTitle="Фото автомобиля" shareText={carPhotoShareText || 'Фото автомобиля'} onClose={() => setGallery(null)} />
        )}
        {showCustomerLogs && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-3" onClick={(event) => { if (event.target === event.currentTarget) setShowCustomerLogs(false); }}>
            <div className="ds-mode-enter ds-surface w-full max-w-lg rounded-[28px] p-4 text-stone-950 shadow-2xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] font-black text-stone-600">Активность клиента</p>
                  <h3 className="text-lg font-black text-stone-950">История клиента</h3>
                </div>
                <button type="button" onClick={() => setShowCustomerLogs(false)} className="ds-press rounded-2xl bg-stone-100 px-3 py-2 text-xs font-black text-stone-600">Закрыть</button>
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
