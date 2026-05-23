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
  Phone
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

type OrderDetailsTab = 'overview' | 'search' | 'proof' | 'finance' | 'notes';

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
  const [deletePartId, setDeletePartId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNotePhotos, setNewNotePhotos] = useState<string[]>([]);
  const [newNoteAudios, setNewNoteAudios] = useState<Array<string | VoiceNoteAudio>>([]);
  const [newProofText, setNewProofText] = useState('');
  const [newProofVideoUrl, setNewProofVideoUrl] = useState('');
  const [newProofPhotos, setNewProofPhotos] = useState<string[]>([]);
  const [newProofAudios, setNewProofAudios] = useState<Array<string | VoiceNoteAudio>>([]);
  const [proofComposerMode, setProofComposerMode] = useState<'message' | 'video'>('message');
  const noteFileRef = useRef<HTMLInputElement>(null);
  const carFileRef = useRef<HTMLInputElement>(null);
  const noteAudioFileRef = useRef<HTMLInputElement>(null);
  const proofFileRef = useRef<HTMLInputElement>(null);

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
  const recordingStopRequestedRef = useRef(false);
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
  const [partCommentDrafts, setPartCommentDrafts] = useState<Record<string, string>>({});
  const [partMediaLinkDrafts, setPartMediaLinkDrafts] = useState<Record<string, string>>({});
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
  const [isLaunchingRadar, setIsLaunchingRadar] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingOverviewBlock, setEditingOverviewBlock] = useState<'client' | 'vehicle' | null>(null);
  const [isQuoteRatesExpanded, setIsQuoteRatesExpanded] = useState(false);
  const [isClientBlockExpanded, setIsClientBlockExpanded] = useState(false);
  const [isVehicleBlockExpanded, setIsVehicleBlockExpanded] = useState(false);
  const [isVehicleDetailsExpanded, setIsVehicleDetailsExpanded] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [deleteOrderConfirmOpen, setDeleteOrderConfirmOpen] = useState(false);
  const [isDepositDialogOpen, setIsDepositDialogOpen] = useState(false);
  const [depositAmountInput, setDepositAmountInput] = useState('');
  const [depositCurrencyInput, setDepositCurrencyInput] = useState<NonNullable<Order['searchDepositCurrency']>>('AED');
  const [depositRateInput, setDepositRateInput] = useState('1');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [markupFixedInput, setMarkupFixedInput] = useState(order?.markupFixedAed?.toString() || '0');
  const [discountFixedInput, setDiscountFixedInput] = useState(order?.discountFixedAed?.toString() || '0');
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
  const discountCommitTimerRef = useRef<number | null>(null);
  const exchangeRateCommitTimerRef = useRef<number | null>(null);
  const deferredFieldTimersRef = useRef<Partial<Record<keyof Order, number>>>({});
  const deferredFieldValuesRef = useRef<Partial<Record<keyof Order, any>>>({});
  const orderRef = useRef<Order | undefined>(order);
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

  if (orderMissing && (isLoading || isRetrying || retryAttempts < MAX_RETRY_ATTEMPTS)) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-10 bg-gray-200 rounded-2xl" />
        <div className="h-24 bg-gray-200 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  if (orderMissing) {
    return (
      <div className="min-h-[60vh] px-4 py-8">
        <div className="mx-auto max-w-md rounded-3xl border border-stone-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-black text-stone-900">Заказ не найден</h1>
          <p className="mt-2 text-sm font-medium text-stone-500">
            Не удалось загрузить карточку заказа. Попробуйте вернуться в список и открыть заказ снова.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button type="button" onClick={() => navigate(backTo)} className="ds-press inline-flex h-11 items-center justify-center rounded-2xl bg-stone-950 px-4 text-xs font-black uppercase tracking-[0.08em] text-white">
              Вернуться к заказам
            </button>
          </div>
        </div>
      </div>
    );
  }

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
      const quoteOrder = {
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
  const pricedPartLines = useMemo(() => getPricedPartLines({
    ...order,
    markupPercent: effectiveMarkupPercent,
    markupFixedAed: markupType === 'fixed' ? Number(markupFixedInput || 0) : order.markupFixedAed,
    discountPercent: effectiveDiscountPercent,
    discountFixedAed: discountType === 'fixed' ? Number(discountFixedInput || 0) : order.discountFixedAed
  }), [discountFixedInput, discountType, effectiveDiscountPercent, effectiveMarkupPercent, markupFixedInput, markupType, order]);
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
    try {
      await navigator.clipboard.writeText(value);
      setToast({ message: success });
    } catch {
      setToast({ message: 'Не удалось скопировать' });
    }
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
    updateOrder({ ...order, logistics: { ...order.logistics, deliveryType: value }, pricingEvents: event ? [event, ...(order.pricingEvents || [])] : order.pricingEvents });
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
    recorderRef.current = null;
    audioChunksRef.current = [];
    recordingStartedAtRef.current = null;
    recordingStopRequestedRef.current = false;
    setIsRecording(false);
    setIsRecordingPaused(false);
    setRecordingStartedAt(null);
    setRecordingElapsedSeconds(0);
    setRecordingWaveform(Array.from({ length: 40 }, () => 10));
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
    if (!isRecording) return;
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingElapsedSeconds((prev) => {
        if (prev >= MAX_VOICE_RECORD_SECONDS) {
          setRecordingError('Recording limit reached');
          stopActiveRecording();
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
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const supportedMimeType = mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      const recorder = new MediaRecorder(stream, supportedMimeType ? { mimeType: supportedMimeType } : undefined);
      recorderRef.current = recorder;
      audioChunksRef.current = [];
      recordingStopRequestedRef.current = false;
      setRecordingError(null);
      setRecordingElapsedSeconds(0);
      setRecordingSavedLocally(false);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onpause = () => setIsRecordingPaused(true);
      recorder.onresume = () => setIsRecordingPaused(false);

      recorder.onstop = () => {
        stopStreamTracks(stream);
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const durationSeconds = Math.max(1, Math.round((Date.now() - (recordingStartedAtRef.current || Date.now())) / 1000));
        resetVoiceRecordingState();

        if (blob.size <= 0) {
          setRecordingError('Запись пустая. Попробуйте ещё раз.');
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
            createdAt: Date.now(),
            author: settings.managerName || 'Manager'
          };
          if (recordingTargetRef.current === 'proof') {
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
      setIsRecording(true);
      setIsRecordingPaused(false);
      setRecordingStartedAt(recordingStartedAtRef.current);
    } catch (e) {
      console.error('Audio recording failed', e);
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
    if (!newProofText.trim() && newProofPhotos.length === 0 && newProofAudios.length === 0 && !videoUrl) return;

    const note: OrderNote = {
      id: Math.random().toString(36).slice(2, 9),
      text: newProofText.trim() || (videoUrl ? 'Видео-пруф' : newProofPhotos.length > 0 ? 'Фото-пруф' : 'Голосовой пруф'),
      photos: newProofPhotos,
      audios: newProofAudios,
      videoUrls: videoUrl ? [videoUrl] : [],
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
    setProofComposerMode('message');
    setToast({ message: nextOrder.publicQuoteToken ? 'Пруф добавлен, публичная смета обновляется' : 'Пруф добавлен в публичную смету' });
  };

  const removeNewProofPhoto = (index: number) => {
    setNewProofPhotos((prev) => prev.filter((_, photoIndex) => photoIndex !== index));
  };

  const removeNewProofAudio = (index: number) => {
    setNewProofAudios((prev) => prev.filter((_, audioIndex) => audioIndex !== index));
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
  const DISCOUNT_OPTIONS = [0, 3, 5, 7, 10, 15, 20];

  const tabSwipeRef = useRef<{ x: number; y: number } | null>(null);

  const handleTabSwipeStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    tabSwipeRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTabSwipeEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = tabSwipeRef.current;
    tabSwipeRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
    const index = ORDER_DETAILS_TABS.findIndex((tab) => tab.id === activeTab);
    if (index < 0) return;
    const nextIndex = dx < 0 ? Math.min(ORDER_DETAILS_TABS.length - 1, index + 1) : Math.max(0, index - 1);
    if (nextIndex !== index) setActiveTab(ORDER_DETAILS_TABS[nextIndex].id);
  };

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
    const nextTab = resolveOrderDetailsTab((location.state as { restoreActiveTab?: unknown; orderActiveTab?: unknown } | null)?.restoreActiveTab)
      || resolveOrderDetailsTab((location.state as { restoreActiveTab?: unknown; orderActiveTab?: unknown } | null)?.orderActiveTab);
    if (nextTab) setActiveTab(nextTab);
    const restoreScrollTop = (location.state as { restoreScrollTop?: unknown } | null)?.restoreScrollTop;
    if (typeof restoreScrollTop !== 'number' || restoreScrollTop < 0) return;
    const mainScroller = document.querySelector('main');
    if (!(mainScroller instanceof HTMLElement)) return;
    window.setTimeout(() => {
      mainScroller.scrollTop = restoreScrollTop;
    }, 80);
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
          setActiveTab('overview');
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
        onClick: () => setActiveTab('search')
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
        onClick: () => setActiveTab('proof')
      };
    }

    if (order.isSold || order.salesStatus === 'Completed') {
      return {
        label: 'Заказ закрыт',
        helper: 'Пруфы собраны, сделка завершена',
        onClick: () => setActiveTab('proof')
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

  return (
      <div className="min-h-full bg-[linear-gradient(to_bottom,#07080A_0,#07080A_260px,#F4F1EA_260px,#F4F1EA_100%)] pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[58px] text-white">
        <div className="fixed left-1/2 top-0 z-40 w-full max-w-md -translate-x-1/2 border-b border-white/10 bg-[#08090B]/92 px-3 py-2 backdrop-blur-xl">
          <div className="flex h-10 items-center justify-between gap-2">
            <button type="button" onClick={handleBackNavigation} className="ds-press flex h-10 w-10 items-center justify-center rounded-full text-white/[0.78] active:bg-white/10" aria-label="Назад">
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-[13px] font-black text-white">{heroCarName}</p>
              <p className="truncate text-[10px] font-semibold tracking-[0.08em] text-white/[0.42]">{stageCopy.label} · {order.id.slice(0, 8)}</p>
            </div>
            <div className="flex h-10 items-center justify-end gap-1">
              <button type="button" onClick={() => void shareSupplierRequest()} className="ds-press flex h-10 w-10 items-center justify-center rounded-full text-white/[0.78] active:bg-white/10" aria-label="Поделиться запросом поставщику">
                <Send size={17} />
              </button>
              <div className="relative flex h-10 w-10 items-center justify-center">
                <button type="button" onClick={() => setShowActionsMenu((value) => !value)} className="ds-press flex h-10 w-10 items-center justify-center rounded-full text-white/[0.72] active:bg-white/10" aria-label="Действия">
                  <MoreVertical size={18} />
                </button>
                {showActionsMenu && (
                  <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#15171D] p-1 text-xs font-bold text-white shadow-2xl">
                    <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/10" onClick={() => { setEditingOverviewBlock(null); setIsEditMode((prev) => !prev); }}><FileText size={14} /> {isEditMode ? 'Закрыть правки' : 'Редактировать'}</button>
                    <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/10" onClick={() => { setShowActionsMenu(false); void shareQuote(); }}><Share2 size={14} /> Отправить / обновить смету</button>
                    <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/10" onClick={() => updateOrderField('isArchived', !order.isArchived)}><Package size={14} /> {order.isArchived ? 'Вернуть из архива' : 'В архив'}</button>
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
                  <img src={heroPhoto} alt={heroCarName} className="h-full w-full object-cover opacity-88 transition duration-500" />
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
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#08090B] via-[#08090B]/[0.42] to-black/[0.12]" />
              <div
                className="relative flex min-h-[118px] flex-col justify-between p-3"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button,input,textarea,select,a')) return;
                  const photos = getCarPhotos();
                  if (photos.length) setGallery({ images: photos, index: 0 });
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="inline-flex items-center gap-2 rounded-full bg-black/[0.28] px-2.5 py-1.5 text-[10px] font-semibold text-white/70 ring-1 ring-white/10 backdrop-blur">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.8)]" />
                    Живой заказ
                  </div>
                  <button type="button" onClick={() => carFileRef.current?.click()} className="ds-press inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-2.5 text-[10px] font-black text-white ring-1 ring-white/[0.12] backdrop-blur">
                    {heroPhoto ? <Camera size={14} /> : <Upload size={14} />}
                    {heroPhoto ? `${heroPhotoCount} фото` : 'Добавить фото'}
                  </button>
                  <input type="file" ref={carFileRef} onChange={handleCarPhotoChange} className="hidden" accept="image/*" multiple />
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-black text-white ring-1 ring-white/10">{stageCopy.label}</span>
                      <span className={`rounded-full px-3 py-1.5 text-[11px] font-black ring-1 ${paymentCopy.tone}`}>{paymentCopy.label}</span>
                    </div>
                    <h1 className="max-w-[16rem] truncate text-[22px] font-black leading-none tracking-normal text-white">{heroCarName}</h1>
                    <p className="mt-1 max-w-[18rem] truncate text-[11px] font-semibold tracking-[0.08em] text-white/[0.62]">VIN {order.vin || 'not set'}</p>
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
                  <span className="max-w-full truncate px-1">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-h-[52dvh] rounded-t-[30px] bg-[#F4F1EA] px-4 pt-6 text-[#171717] shadow-[0_-18px_60px_rgba(0,0,0,0.28)]" style={{ paddingBottom: ORDER_DETAILS_SCROLL_PADDING }} onTouchStart={handleTabSwipeStart} onTouchEnd={handleTabSwipeEnd}>
          {activeTab === 'overview' && (
            <div className="ds-mode-enter space-y-7">
              <section className="hidden">
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
                        <div className="grid grid-cols-2 gap-2">
                          <select value={String(draftFields.source ?? order.source)} onChange={(e) => updateOrderField('source', e.target.value)} className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black text-stone-800 outline-none">
                            {SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
                          </select>
                          <select value={normalizedSelectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)} className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black text-stone-800 outline-none">
                            {messageTemplates.map((template) => <option key={template} value={template}>{template}</option>)}
                          </select>
                        </div>
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
                        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-stone-400">Автомобиль</p>
                        <p className="mt-1 truncate text-lg font-black text-stone-950">{heroCarName}</p>
                        <p className="mt-1 break-all font-mono text-xs font-bold text-stone-500">{order.vin || 'VIN не указан'}</p>
                      </div>
                      <button type="button" onClick={() => { setIsEditMode(false); setEditingOverviewBlock((prev) => prev === 'vehicle' ? null : 'vehicle'); }} className="ds-press flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white" aria-label={isVehicleEditMode ? 'Закрыть редактирование' : 'Редактировать авто'}>{isVehicleEditMode ? <Check size={15} /> : <FileText size={15} />}</button>
                    </div>
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
                    {isVehicleEditMode && (
                      <div className="mt-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input type="text" value={String(draftFields.vin ?? order.vin ?? '')} onChange={(e) => updateOrderField('vin', e.target.value.toUpperCase().slice(0, 17))} onBlur={() => flushDeferredOrderField('vin')} placeholder="VIN" className="ds-input col-span-2 h-12 rounded-2xl border-0 px-4 text-sm font-black uppercase text-stone-950 outline-none" />
                          <button type="button" onClick={pasteVinFromClipboard} className="ds-press h-11 rounded-2xl bg-stone-950 px-3 text-xs font-black text-white">Вставить VIN</button>
                          <button type="button" onClick={() => carFileRef.current?.click()} className="ds-press h-11 rounded-2xl bg-stone-100 px-3 text-xs font-black text-stone-800">Добавить медиа</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <select value={String((draftFields.vehicleDetails?.marketRegion) ?? (order.vehicleDetails?.marketRegion ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), marketRegion: (e.target.value || undefined) })} onBlur={() => flushDeferredOrderField('vehicleDetails')} className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none">
                            <option value="">Рынок</option>
                            {VEHICLE_MARKET_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                          </select>
                          <select value={String((draftFields.vehicleDetails?.transmission) ?? (order.vehicleDetails?.transmission ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), transmission: (e.target.value || undefined) })} onBlur={() => flushDeferredOrderField('vehicleDetails')} className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none">
                            <option value="">КПП</option>
                            {VEHICLE_TRANSMISSION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                          </select>
                          <input type="text" value={String((draftFields.vehicleDetails?.engineType) ?? (order.vehicleDetails?.engineType ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), engineType: e.target.value })} onBlur={() => flushDeferredOrderField('vehicleDetails')} placeholder="Двигатель" className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none" />
                          <input type="text" value={String((draftFields.vehicleDetails?.color) ?? (order.vehicleDetails?.color ?? ''))} onChange={(e) => updateOrderField('vehicleDetails', { ...(order.vehicleDetails || {}), ...(draftFields.vehicleDetails || {}), color: e.target.value })} onBlur={() => flushDeferredOrderField('vehicleDetails')} placeholder="Цвет" className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none" />
                          <input type="text" value={String(draftFields.bodyType ?? order.bodyType ?? '')} onChange={(e) => updateOrderField('bodyType', e.target.value)} onBlur={() => flushDeferredOrderField('bodyType')} placeholder="Кузов" className="ds-input col-span-2 h-11 rounded-2xl border-0 px-3 text-xs font-black outline-none" />
                        </div>
                      </div>
                    )}
                    {getCarPhotos().length > 0 && (
                      <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
                        {getCarPhotos().slice(0, 6).map((photo, index) => (
                          <div key={`${photo}-${index}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-stone-200">
                            <button type="button" onClick={() => setGallery({ images: getCarPhotos(), index })} className="ds-press h-full w-full">
                              <img src={photo} alt="Автомобиль" className="h-full w-full object-cover" />
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
                            <button type="button" onClick={() => setGallery({ images: getCarPhotos(), index })} className="h-full w-full"><img src={photo} alt="Автомобиль" className="h-full w-full object-cover" /></button>
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

              

              <section className="ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Медиа по деталям</p>
                    <p className="mt-1 text-xs font-semibold text-stone-500">Drive-ссылки остаются привязаны к конкретной детали.</p>
                  </div>
                  <Video size={18} className="text-stone-400" />
                </div>
                {(order.parts || []).length > 0 ? (
                  <div className="space-y-2">
                    {order.parts.map((part) => (
                      <div key={`overview-media-${part.id}`} className="rounded-2xl bg-stone-950/[0.04] p-3">
                        <p className="truncate text-sm font-black text-stone-950">{getPartDisplayName(part)}</p>
                        <div className="mt-2 flex gap-2">
                          <input
                            type="url"
                            value={partMediaLinkDrafts[part.id] ?? ''}
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

              <section className="ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Папка медиа заказа</p>
                    <p className="mt-1 text-xs font-semibold text-stone-500">Общая папка для фото, видео и материалов по заказу.</p>
                  </div>
                  <FolderOpen size={19} className="text-stone-400" />
                </div>
                <div className="flex gap-2">
                  <input type="url" value={orderMediaFolderDraft} onChange={(event) => setOrderMediaFolderDraft(event.target.value)} onBlur={(event) => saveOrderMediaFolder(event.target.value)} placeholder="https://drive.google.com/drive/folders/..." className="ds-input h-12 min-w-0 flex-1 rounded-2xl border-0 px-3 text-xs font-bold text-stone-800 outline-none" />
                  <button type="button" onClick={() => {
                    const savedUrl = saveOrderMediaFolder(orderMediaFolderDraft, { showToast: true });
                    checkGoogleDriveLink(savedUrl, 'Добавьте Drive-папку заказа');
                  }} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white" aria-label="Открыть папку"><ExternalLink size={15} /></button>
                </div>
              </section>

              {false && settings.orderZones && settings.orderZones.length > 0 && (
                <section className="space-y-2">
                  <p className="text-[12px] font-black text-stone-600">Зона сервиса</p>
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
                      <option value="">Добавить зону</option>
                      {settings.orderZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                    </select>
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === 'search' && (
            <div className="ds-mode-enter space-y-6">
              <section className="hidden">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold text-white/[0.42]">Полевой поиск</p>
                    <h2 className="mt-1 text-[27px] font-black leading-tight tracking-normal">{sourcingLocked ? 'Поиск закрыт' : 'Работаем быстро'}</h2>
                    <p className="mt-1 text-xs font-semibold leading-5 text-white/[0.58]">{sourcingLocked ? 'Сначала подтвердите депозит.' : `${openPartsCount} открыто · ${recommendedShops.length} поставщика`}</p>
                  </div>
                  <button type="button" onClick={() => setShowOnlyOpenParts((prev) => !prev)} className={`ds-press rounded-full px-3 py-2 text-[11px] font-black ${showOnlyOpenParts ? 'bg-amber-300 text-stone-950' : 'bg-white/10 text-white'}`}>
                    {showOnlyOpenParts ? 'Только открытые' : 'Все детали'}
                  </button>
                </div>
                {sourcingLocked && (
                  <button type="button" onClick={confirmDeposit} className="ds-press mt-4 w-full rounded-2xl bg-amber-300 px-4 py-3 text-xs font-black text-stone-950">
                    Подтвердить депозит
                  </button>
                )}
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => void shareSupplierRequest()} disabled={sourcingLocked} className="ds-press inline-flex h-11 items-center justify-center gap-1 rounded-2xl bg-[#F7F3EA] px-2 text-[10px] font-black text-stone-950 disabled:opacity-35"><Send size={13} /> Запрос</button>
                  <button type="button" onClick={contactAllRecommendedShops} disabled={sourcingLocked || recommendedShops.length === 0} className="ds-press inline-flex h-11 items-center justify-center gap-1 rounded-2xl bg-white/10 px-2 text-[10px] font-black text-white disabled:opacity-35"><Phone size={13} /> Чаты</button>
                  <button type="button" onClick={() => FEATURE_RADAR_V2 ? void launchRadarSession() : navigate('/database')} disabled={sourcingLocked} className="ds-press inline-flex h-11 items-center justify-center gap-1 rounded-2xl bg-white/10 px-2 text-[10px] font-black text-white disabled:opacity-35"><Rocket size={13} /> {isLaunchingRadar ? 'Открываем' : 'Радар'}</button>
                </div>
              </section>

              <section ref={addPartSectionRef} className="hidden">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-black text-stone-600">Добавить деталь</p>
                  <span className="text-[11px] font-black text-stone-500">{order.parts.length} всего</span>
                </div>
                <form onSubmit={(event) => { event.preventDefault(); addNewPart(); }} className="ds-surface rounded-[28px] p-3">
                  <div className="flex items-center gap-2">
                    <div className="ds-input flex h-14 min-w-0 flex-1 items-center gap-2 rounded-2xl px-3">
                      <Search size={18} className="shrink-0 text-stone-400" />
                      <input type="text" value={newPartName} onChange={(event) => setNewPartName(event.target.value)} placeholder="Название детали..." className="h-full min-w-0 flex-1 border-0 bg-transparent text-base font-black text-stone-950 outline-none placeholder:text-stone-400" />
                    </div>
                    <div className="ds-input flex h-14 w-[112px] shrink-0 items-center rounded-2xl p-1">
                      <button type="button" onClick={() => setNewPartQuantity(String(Math.max(1, Number(newPartQuantity || 1) - 1)))} className="ds-press flex h-12 w-9 items-center justify-center rounded-xl text-stone-700 active:bg-white" aria-label="Уменьшить количество"><Minus size={16} /></button>
                      <input type="number" min={1} value={newPartQuantity} onChange={(event) => setNewPartQuantity(event.target.value)} className="h-12 min-w-0 flex-1 border-0 bg-transparent text-center text-base font-black text-stone-950 outline-none" />
                      <button type="button" onClick={() => setNewPartQuantity(String(Math.max(1, Number(newPartQuantity || 1) + 1)))} className="ds-press flex h-12 w-9 items-center justify-center rounded-xl text-stone-700 active:bg-white" aria-label="Увеличить количество"><Plus size={16} /></button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setNewPartKind('single')} className={`ds-press h-10 rounded-2xl text-[11px] font-black ${newPartKind === 'single' ? 'bg-stone-950 text-white' : 'bg-stone-100/80 text-stone-500'}`}>Одна</button>
                    <button type="button" onClick={() => { setNewPartKind('group'); setNewPartGroupItems((prev) => prev.length > 0 ? prev : [createGroupItemDraft()]); }} className={`ds-press h-10 rounded-2xl text-[11px] font-black ${newPartKind === 'group' ? 'bg-stone-950 text-white' : 'bg-stone-100/80 text-stone-500'}`}>Группа</button>
                  </div>
                  {newPartKind === 'group' && (
                    <div className="mt-3 space-y-2 rounded-[22px] bg-stone-100/70 p-3">
                      {newPartGroupItems.map((item, index) => (
                        <div key={item.id} className="flex items-center gap-2">
                          <input type="text" value={item.name} onChange={(event) => updateGroupItemRow(item.id, 'name', event.target.value)} placeholder={`Деталь ${index + 1}`} className="ds-input h-10 min-w-0 flex-1 rounded-xl border-0 px-3 text-xs font-black text-stone-950 outline-none placeholder:text-stone-400" />
                          <select value={item.quantity} onChange={(event) => updateGroupItemRow(item.id, 'quantity', event.target.value)} className="ds-input h-10 w-16 rounded-xl border-0 text-center text-xs font-black text-stone-950 outline-none">
                            {Array.from({ length: 20 }, (_, qtyIdx) => String(qtyIdx + 1)).map((qty) => <option key={qty} value={qty}>{qty}</option>)}
                          </select>
                          <button type="button" onClick={() => removeGroupItemRow(item.id)} className="ds-press flex h-10 w-10 items-center justify-center rounded-xl bg-white text-rose-600" aria-label="Remove group item"><X size={14} /></button>
                        </div>
                      ))}
                      <button type="button" onClick={addGroupItemRow} className="ds-press h-9 rounded-xl bg-white px-3 text-[11px] font-black text-stone-700">Добавить строку</button>
                    </div>
                  )}
                  <textarea value={newPartComment} onChange={(event) => setNewPartComment(event.target.value)} placeholder="Заметка, сторона, комплектация, OEM..." rows={2} className="ds-input mt-3 w-full rounded-2xl border-0 px-3 py-3 text-sm font-bold text-stone-800 outline-none placeholder:text-stone-400" />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto no-scrollbar">
                      <button type="button" onClick={() => partFileRef.current?.click()} className={`ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${newPartPhotos.length > 0 ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-stone-100/80 text-stone-400'}`} aria-label="Прикрепить фото детали">
                        <ImageIcon size={18} />
                      </button>
                      {newPartPhotos.map((photo, index) => (
                        <div key={`${photo}-${index}`} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-stone-200">
                          <img src={photo} alt="Превью детали" className="h-full w-full object-cover" />
                          <button type="button" onClick={() => removeNewPhoto(index)} className="absolute inset-0 flex items-center justify-center bg-black/[0.42] text-white opacity-0 transition hover:opacity-100" aria-label="Удалить фото"><X size={13} /></button>
                        </div>
                      ))}
                      <input type="file" onChange={handlePhotoChange} className="hidden" accept="image/*" multiple />
                    </div>
                    <button type="submit" className="ds-press inline-flex h-12 shrink-0 items-center gap-2 rounded-[20px] bg-stone-950 px-5 text-xs font-black uppercase tracking-[0.1em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_12px_26px_rgba(23,23,23,0.22)]">
                      <Plus size={16} /> Добавить
                    </button>
                  </div>
                </form>
              </section>

              {recommendedShops.length > 0 && (
                <section className="hidden">
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
                            <p className="mt-1 truncate text-[11px] font-bold text-stone-500">{shop.location || shop.category || 'Поставщик'}</p>
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

              <section ref={partsListRef} className="space-y-3">
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
                              {partPhotos[0] ? <img src={partPhotos[0]} alt={partDisplayName} className="h-full w-full object-cover" /> : <Package size={17} className="text-stone-300" />}
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
                className="hidden"
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
                        <img src={photo} alt="Превью детали" className="h-full w-full object-cover" />
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
            <div className="ds-mode-enter space-y-5">
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-black text-stone-600">Лента для клиента</p>
                  <span className="text-[11px] font-black text-stone-500">публично в смете</span>
                </div>
                {clientProofNotes.length > 0 ? (
                  <div className="space-y-3">
                    {clientProofNotes.map((note) => (
                      <article key={note.id} className="ds-surface rounded-[24px] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 whitespace-pre-line text-sm font-bold leading-5 text-stone-800">{note.text || 'Пруф заказа'}</p>
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">client</span>
                        </div>
                        <p className="mt-2 text-[10px] font-black text-stone-400">{new Date(note.createdAt).toLocaleString('ru-RU')}</p>
                        {(note.photos || []).length > 0 && (
                          <div className="mt-3 grid grid-cols-4 gap-2">
                            {(note.photos || []).slice(0, 8).map((photo, index) => (
                              <button key={`${note.id}-${photo}-${index}`} type="button" onClick={() => setGallery({ images: note.photos || [], index })} className="ds-press aspect-square overflow-hidden rounded-2xl bg-stone-200">
                                <img src={photo} alt="Proof" className="h-full w-full object-cover" />
                              </button>
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
                        {(note.audios || []).length > 0 && (
                          <div className="mt-3 space-y-2">
                            {(note.audios || []).map((audioItem, index) => {
                              const voice = toVoiceNoteAudio(audioItem);
                              const audioId = `proof-${note.id}-${voice.id}-${index}`;
                              return (
                                <div key={audioId} className="rounded-2xl bg-stone-100 p-2">
                                  <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => toggleAudioPlayback(audioId)} className="ds-press flex h-9 w-9 items-center justify-center rounded-xl bg-white text-stone-800">
                                      {playingAudioId === audioId ? <Pause size={14} /> : <Play size={14} />}
                                    </button>
                                    <span className="text-xs font-black text-stone-500">{formatSeconds(voice.duration)}</span>
                                    <audio id={audioId} src={voice.fileUrl} preload="metadata" playsInline />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </article>
                    ))}
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
            <div className="ds-mode-enter space-y-5">
              <section className="hidden">
                <p className="text-[11px] font-semibold text-white/[0.42]">Кокпит прибыльности</p>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-semibold text-white/[0.52]">Чистая прибыль</p>
                    <h2 className="mt-1 text-[34px] font-black leading-none tracking-normal">{shownNetProfit !== null ? formatDualMoney(shownNetProfit) : 'Нет данных'}</h2>
                  </div>
                  <span className={`rounded-full px-3 py-2 text-[11px] font-black ${profitTone}`}>{safetySummary.profit.level === 'healthy' ? 'Стоит делать' : safetySummary.profit.level === 'unknown' ? 'Нужны цены' : 'Переделать'}</span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <div className="rounded-2xl bg-white/[0.075] px-3 py-2">
                    <p className="text-[10px] font-black text-white/[0.38]">Клиент</p>
                    <p className="mt-1 truncate text-sm font-black">{formatMoney(sellTotalAed, clientCurrency)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/[0.075] px-3 py-2">
                    <p className="text-[10px] font-black text-white/[0.38]">Buy</p>
                    <p className="mt-1 truncate text-sm font-black">{formatMoney(selectedOfferTotal)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/[0.075] px-3 py-2">
                    <p className="text-[10px] font-black text-white/[0.38]">Маржа</p>
                    <p className="mt-1 truncate text-sm font-black">{marginPercent !== null ? `${marginPercent.toFixed(0)}%` : 'Открыто'}</p>
                  </div>
                </div>
              </section>

              <section className="ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Цены продажи</p>
                    <p className="mt-1 text-xs font-semibold text-stone-500">Закупка берётся из варианта, клиентская цена задаётся здесь.</p>
                  </div>
                  <span className="rounded-full bg-stone-100 px-3 py-2 text-[11px] font-black text-stone-600">{pricedPartsCount}/{partsCount || 0}</span>
                </div>
                {(order.parts || []).length > 0 ? (
                  <div className="space-y-2">
                    {(order.parts || []).map((part) => {
                      const variant = getFinanceVariant(part);
                      const quantity = normalizePartQuantity(part.quantity);
                      const purchasePrice = Number(variant?.purchasePriceAed ?? variant?.priceAed ?? 0);
                      const salePrice = Number(variant?.salePriceAed ?? variant?.priceAed ?? 0);
                      return (
                        <div key={`finance-sale-${part.id}`} className="rounded-2xl bg-stone-950/[0.04] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-stone-950">{getPartDisplayName(part)}</p>
                              <p className="mt-1 truncate text-[11px] font-bold text-stone-500">{variant ? `${variant.shopName || 'Поставщик'} · закуп ${purchasePrice.toFixed(0)} AED · ${quantity} шт` : 'Сначала добавьте вариант с ценой закупки'}</p>
                            </div>
                            <button type="button" onClick={() => openPartDetails(part.id, variant?.id)} className="ds-press flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-stone-700" aria-label="Открыть деталь"><ChevronRight size={15} /></button>
                          </div>
                          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoComplete="off"
                              value={variant && salePrice > 0 ? String(salePrice) : ''}
                              disabled={!variant}
                              onChange={(event) => updatePartSalePrice(part.id, event.target.value)}
                              placeholder="Цена продажи AED"
                              className="ds-input h-12 min-w-0 rounded-2xl border-0 px-3 text-sm font-black text-stone-950 outline-none disabled:opacity-45"
                            />
                            <div className={`flex h-12 min-w-[86px] items-center justify-center rounded-2xl px-3 text-xs font-black ${salePrice >= purchasePrice && salePrice > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
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

              <section ref={markupSectionRef} className="ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Управление маржой</p>
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
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={markupFixedInput} onFocus={() => { if (markupFixedInput === '0') setMarkupFixedInput(''); }} onBlur={() => { if (!markupFixedInput) setMarkupFixedInput('0'); flushMarkupCommit(); }} onChange={handleMarkupFixedChange} placeholder="Markup AED" className="ds-input h-12 w-full rounded-2xl border-0 px-4 text-sm font-black text-stone-950 outline-none" />
                )}
                <label className="flex items-center gap-2 text-xs font-bold text-stone-500">
                  <input type="checkbox" checked={!!order.useMarkupAsDefaultForNewParts} onChange={(event) => updateOrderField('useMarkupAsDefaultForNewParts', event.target.checked)} />
                  Использовать эту маржу для новых деталей
                </label>
              </section>

              <section className="ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Валюта клиента</p>
                    <p className="mt-1 text-xs font-semibold text-stone-500">Смета, текстовая смета и invoice</p>
                  </div>
                  <select
                    value={clientCurrency}
                    onChange={(event) => updateOrderField('clientCurrency', event.target.value as Order['clientCurrency'])}
                    className="ds-input h-11 rounded-2xl border-0 px-3 text-xs font-black text-stone-950 outline-none"
                  >
                    {(['AED', 'USD', 'RUB', 'TJS', 'KZT', 'UZS'] as const).map((currency) => <option key={`finance-currency-${currency}`} value={currency}>{currency}</option>)}
                  </select>
                </div>
              </section>

              <section className="ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Скидка</p>
                    <p className="mt-1 text-xs font-semibold text-stone-500">{discountAed > 0 ? `-${formatDualMoney(discountAed)}` : 'Без скидки'}</p>
                  </div>
                  <div className="inline-flex rounded-full bg-stone-100 p-1">
                    <button type="button" onClick={() => updateOrderField('discountType', 'percent')} className={`ds-press h-9 rounded-full px-4 text-xs font-black ${discountType === 'percent' ? 'bg-stone-950 text-white' : 'text-stone-500'}`}>%</button>
                    <button type="button" onClick={() => updateOrderField('discountType', 'fixed')} className={`ds-press h-9 rounded-full px-4 text-xs font-black ${discountType === 'fixed' ? 'bg-stone-950 text-white' : 'text-stone-500'}`}>AED</button>
                  </div>
                </div>
                {discountType === 'percent' ? (
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {DISCOUNT_OPTIONS.map((option) => (
                      <button key={`finance-discount-${option}`} type="button" onClick={() => updateOrderField('discountPercent', Number(option))} className={`ds-press h-11 shrink-0 rounded-2xl px-4 text-xs font-black ${Number(draftFields.discountPercent ?? order.discountPercent ?? 0) === option ? 'bg-stone-950 text-white' : 'bg-stone-100 text-stone-500'}`}>{option}%</button>
                    ))}
                  </div>
                ) : (
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={discountFixedInput} onFocus={() => { if (discountFixedInput === '0') setDiscountFixedInput(''); }} onBlur={() => { if (!discountFixedInput) setDiscountFixedInput('0'); flushDiscountCommit(); }} onChange={handleDiscountFixedChange} placeholder="Discount AED" className="ds-input h-12 w-full rounded-2xl border-0 px-4 text-sm font-black text-stone-950 outline-none" />
                )}
              </section>

              <section className="ds-surface space-y-3 rounded-[26px] p-4">
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
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={logisticsDraft[field]} onFocus={() => { if (logisticsDraft[field] === '0') onLogisticsDraftChange(field, ''); }} onBlur={() => { if (!logisticsDraft[field]) onLogisticsDraftChange(field, '0'); }} onChange={(event) => onLogisticsDraftChange(field, sanitizeNumericInput(event.target.value))} className="ds-input h-12 w-full rounded-2xl border-0 px-2 text-center text-sm font-black text-stone-950 outline-none" />
                    </label>
                  ))}
                </div>
                <button type="button" onClick={saveLogisticsDraft} disabled={!hasPendingPricingChanges} className={`ds-press h-11 w-full rounded-2xl px-3 text-xs font-black ${hasPendingPricingChanges ? 'bg-stone-950 text-white' : 'bg-stone-100 text-stone-400'}`}>Сохранить услуги</button>
              </section>

              <section className="ds-surface space-y-3 rounded-[26px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-stone-600">Депозит</p>
                    <p className="mt-1 text-xs font-semibold text-stone-500">Добавление и изменение через финансы</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-emerald-700">-{formatMoney(depositAmountAed)}</p>
                    <p className="mt-1 text-xs font-black text-stone-950">К оплате {formatMoney(balanceDueAed, clientCurrency)}</p>
                  </div>
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
                      {(['AED', 'USD', 'RUB', 'TJS', 'KZT', 'UZS'] as const).map((currency) => <option key={`finance-deposit-${currency}`} value={currency}>{currency}</option>)}
                    </select>
                  </label>
                </div>
                {depositCurrencyInput !== 'AED' && (
                  <label className="block space-y-1">
                    <span className="text-[10px] font-black text-stone-400">1 {depositCurrencyInput} = AED</span>
                    <input type="text" inputMode="decimal" value={depositRateInput} onChange={(event) => setDepositRateInput(sanitizeDecimalInput(event.target.value))} placeholder="0.00" className="ds-input h-12 w-full rounded-2xl border-0 px-3 text-sm font-black text-stone-950 outline-none" />
                  </label>
                )}
                <button type="button" onClick={submitDeposit} className="ds-press h-11 w-full rounded-2xl bg-stone-950 px-3 text-xs font-black text-white">Сохранить депозит</button>
              </section>

              {depositAmountAed > 0 && (
                <section className="ds-surface rounded-[26px] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[12px] font-black text-stone-600">Депозит</p>
                      <p className="mt-1 text-xs font-semibold text-stone-500">{order.searchDepositAmount} {order.searchDepositCurrency || 'AED'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-emerald-700">-{formatMoney(depositAmountAed)}</p>
                      <p className="mt-1 text-xs font-black text-stone-950">К оплате {formatMoney(balanceDueAed, clientCurrency)}</p>
                    </div>
                  </div>
                </section>
              )}

              {sellError && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-xs font-black text-rose-700">{sellError}</div>}
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="ds-mode-enter space-y-5">
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
                  {newNotePhotos.map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt="Новая заметка" className="h-12 w-12 shrink-0 rounded-2xl object-cover" />)}
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
                  {(order.notes || []).map((note) => (
                    <article key={note.id} className="ds-surface rounded-[24px] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {note.text && <p className="text-sm font-semibold leading-6 text-stone-800">{note.text}</p>}
                          <p className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-stone-400">{new Date(note.createdAt).toLocaleString()}</p>
                        </div>
                        <button type="button" onClick={() => removeNoteById(note.id)} className="ds-press flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600" aria-label="Удалить заметку"><X size={14} /></button>
                      </div>
                      {note.photos && note.photos.length > 0 && (
                        <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
                          {note.photos.map((photo, index) => (
                            <div key={`${photo}-${index}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl">
                              <button type="button" onClick={() => setGallery({ images: note.photos || [], index })} className="ds-press h-full w-full"><img src={photo} alt="Заметка" className="h-full w-full object-cover" /></button>
                              <button type="button" onClick={() => removeNotePhoto(note.id, index)} className="ds-press absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white" aria-label="Удалить фото"><X size={11} /></button>
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
                  ))}
                </section>
              )}

            </div>
          )}
        </div>

        <input type="file" ref={partFileRef} onChange={handlePhotoChange} className="hidden" accept="image/*" multiple />
        <input type="file" ref={proofFileRef} onChange={handleProofPhotoChange} className="hidden" accept="image/*" multiple />

        {!(activeTab === 'search' && sourcingLocked) && (
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
          {activeTab === 'notes' && (
            <form onSubmit={(event) => { event.preventDefault(); addNote(); }} className="space-y-2">
              {(newNoteText.trim().length > 0 || newNotePhotos.length > 0 || newNoteAudios.length > 0) && <div className="rounded-2xl bg-white px-3 py-2 text-xs font-bold text-stone-500">Черновик заметки активен</div>}
              <div className="flex items-end gap-2">
                <button type="button" onClick={() => noteFileRef.current?.click()} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-700" aria-label="Прикрепить фото"><ImageIcon size={18} /></button>
                <button type="button" onClick={() => void toggleRecording()} className={`ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${isRecording ? 'bg-rose-50 text-rose-700' : 'bg-white text-stone-700'}`} aria-label="Записать голос">{isRecording ? <Square size={17} /> : <Mic size={18} />}</button>
                <div className="min-w-0 flex-1 rounded-2xl bg-white px-3 py-2"><textarea value={newNoteText} onChange={(event) => setNewNoteText(event.target.value)} placeholder="Сообщение..." rows={1} className="no-scrollbar max-h-24 min-h-8 w-full resize-none overflow-hidden border-0 bg-transparent text-sm font-bold leading-6 text-stone-900 outline-none placeholder:text-stone-400" /></div>
                <button type="submit" disabled={!newNoteText.trim() && newNotePhotos.length === 0 && newNoteAudios.length === 0} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white disabled:bg-stone-200 disabled:text-stone-400" aria-label="Отправить заметку"><Send size={17} /></button>
              </div>
              <input type="file" ref={noteFileRef} onChange={handleNotePhotoChange} className="hidden" accept="image/*" multiple />
              <input type="file" ref={noteAudioFileRef} onChange={handleNoteAudioFileChange} className="hidden" accept="audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.webm" multiple />
            </form>
          )}
          {activeTab === 'finance' && <div className="space-y-2"><div className="grid grid-cols-4 gap-2"><div className="rounded-2xl bg-stone-950 px-3 py-2 text-white"><p className="text-[9px] font-black text-white/45">Прибыль</p><p className="mt-0.5 truncate text-[13px] font-black">{shownNetProfit !== null ? formatMoney(shownNetProfit) : '—'}</p></div><div className="rounded-2xl bg-white px-3 py-2"><p className="text-[9px] font-black text-stone-400">К оплате</p><p className="mt-0.5 truncate text-[13px] font-black text-stone-950">{formatMoney(balanceDueAed, clientCurrency)}</p></div><div className="rounded-2xl bg-white px-3 py-2"><p className="text-[9px] font-black text-stone-400">Закуп</p><p className="mt-0.5 truncate text-[13px] font-black text-stone-950">{formatMoney(selectedOfferTotal)}</p></div><div className="rounded-2xl bg-white px-3 py-2"><p className="text-[9px] font-black text-stone-400">Маржа</p><p className="mt-0.5 truncate text-[13px] font-black text-stone-950">{marginPercent !== null ? `${marginPercent.toFixed(0)}%` : '—'}</p></div></div><button type="button" onClick={() => void sendFinanceTextQuote()} className="ds-press flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-xs font-black uppercase tracking-[0.08em] text-white"><MessageCircle size={16} /> Текстовая смета WhatsApp</button></div>}
          {activeTab === 'overview' && <button type="button" onClick={() => void shareQuote()} className="ds-press flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 text-xs font-black uppercase tracking-[0.08em] text-white">Отправить / обновить смету<ChevronRight size={15} /></button>}
          {activeTab === 'proof' && (
            <form onSubmit={(event) => { event.preventDefault(); addClientProofNote(); }} className="space-y-2">
              {(newProofPhotos.length > 0 || newProofAudios.length > 0) && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  {newProofPhotos.map((photo, index) => (
                    <div key={`${photo}-${index}`} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-stone-200">
                      <img src={photo} alt="Proof draft" className="h-full w-full object-cover" />
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
              ) : (
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => proofFileRef.current?.click()} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-700" aria-label="Добавить фото"><ImageIcon size={18} /></button>
                  <button type="button" onClick={() => setProofComposerMode('video')} className="ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-stone-700" aria-label="Добавить видео"><Video size={18} /></button>
                  <button type="button" onClick={() => void toggleRecording('proof')} className={`ds-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${isRecording ? 'bg-rose-50 text-rose-700' : 'bg-white text-stone-700'}`} aria-label="Записать голос">{isRecording ? <Square size={17} /> : <Mic size={18} />}</button>
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

        {isRecording && (
          <div className="fixed inset-0 z-50 bg-slate-950/76 p-4 backdrop-blur-sm">
            <div className="ds-mode-enter ds-surface mx-auto mt-16 w-full max-w-md space-y-3 rounded-[28px] p-4 text-stone-950 shadow-2xl">
              <div className="flex items-center justify-between">
                <p className="text-sm font-black">Запись голоса</p>
                <span className="font-mono text-sm font-black text-rose-700">{formatSeconds(recordingElapsedSeconds)}</span>
              </div>
              <div className="h-16 rounded-2xl bg-rose-50 px-2">
                <canvas id="voice-recorder-wave" className="h-full w-full" aria-label="Волна записи" />
                <div className="-mt-16 flex h-16 items-end gap-0.5">
                  {recordingWaveform.map((height, index) => <span key={`live-wave-${index}`} className="block flex-1 rounded-full bg-rose-400 transition-all" style={{ height: `${height}%` }} />)}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={toggleRecordingPause} className="ds-press h-12 rounded-2xl bg-amber-50 text-xs font-black text-amber-700">{isRecordingPaused ? 'Продолжить' : 'Пауза'}</button>
                <button type="button" onClick={() => void toggleRecording()} className="ds-press h-12 rounded-2xl bg-emerald-50 text-xs font-black text-emerald-700">Готово</button>
                <button type="button" onClick={requestCancelRecording} className="ds-press h-12 rounded-2xl bg-rose-50 text-xs font-black text-rose-700">Отмена</button>
              </div>
              <p className="text-[11px] font-semibold text-stone-500">До 05:00 · максимум 10MB</p>
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
        <ConfirmModal isOpen={deleteOrderConfirmOpen} message="Удалить заказ? Это действие удалит заказ и связанные детали." confirmLabel="Удалить" confirmClass="bg-red-600 active:bg-red-700" onConfirm={() => void confirmDeleteOrder()} onCancel={() => setDeleteOrderConfirmOpen(false)} />
        <ConfirmModal isOpen={showSellConfirm} message={order.isSold ? "Вернуть заказ в активные?" : "Отметить заказ как проданный?"} confirmLabel={order.isSold ? "Да, вернуть" : "Да, продано"} confirmClass={order.isSold ? "bg-blue-600 active:bg-blue-700" : "bg-green-600 active:bg-green-700"} onConfirm={confirmSellOrder} onCancel={() => setShowSellConfirm(false)} />

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
