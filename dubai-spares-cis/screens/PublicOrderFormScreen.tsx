import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, ChevronDown, ChevronLeft, Loader2, Mic, MicOff, Search, Trash2, Upload } from 'lucide-react';
import { ensurePublicImageUrls, optimizeImageForUpload } from '../storage/photos';
import { leadCreate } from '../serverApi';
import { BRAND_MODELS, BRANDS, YEARS } from '../constants';
import { NotificationType, pushNotification } from '../notificationCenter';
import { logger } from '../logging';
import { Priority, Source } from '../types';
import { useAppSettings } from '../appSettings';
import { addOrderItem } from '../orderStore';
import { cloudFeatureFlags, isCloudConfigured } from '../cloudConfig';
import { runCloudDiagnostics } from '../utils/cloudDiagnostics';
import { CONTACT_CHANNEL_TO_SOURCE, validateStep1, validateStep2, validateStep3 } from '../utils/publicOrderValidation';

type FormStep = 1 | 2 | 3 | 4;

const TOTAL_STEPS = 4;
const MAX_REQUEST_PART_FIELDS = 10;
const DRAFT_KEY = 'public_order_form_draft_v3';
const DRAFT_LINK_ID_KEY = 'public_order_form_draft_link_id_v1';
const MAX_UPLOAD_SIZE_BYTES = 8 * 1024 * 1024;

const STEP_NAMES = ['Автомобиль', 'Детали', 'Контакты', 'Подтверждение'];
const STEP_TITLES: Record<FormStep, string> = {
  1: 'Введите данные автомобиля',
  2: 'Укажите нужные детали',
  3: 'Контакт и доставка',
  4: 'Проверьте и отправьте заявку'
};
const CONTACT_TIME_OPTIONS = [
  '09:00 - 11:00',
  '11:00 - 13:00',
  '13:00 - 15:00',
  '15:00 - 17:00',
  '17:00 - 19:00',
  '19:00 - 21:00'
];

const CONTACT_CHANNEL_LABELS: Record<'whatsapp' | 'telegram' | 'instagram' | 'email' | 'phone', string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  instagram: 'Instagram',
  email: 'E-mail',
  phone: 'Телефон'
};

type ContactChannel = keyof typeof CONTACT_CHANNEL_LABELS;
const isContactChannel = (value: unknown): value is ContactChannel => typeof value === 'string' && value in CONTACT_CHANNEL_LABELS;

const PRIORITY_LABELS: Record<Priority, string> = {
  [Priority.LOW]: 'Низкий',
  [Priority.MEDIUM]: 'Средний',
  [Priority.HIGH]: 'Высокий'
};

const POPULAR_BRANDS = ['Toyota', 'BMW', 'Mercedes-Benz', 'Lexus', 'Kia', 'Hyundai'];
const PART_SUGGESTIONS: Record<string, string[]> = {
  'BMW|5 Series|E39': ['Front bumper', 'Hood', 'Headlight', 'Engine', 'Transmission']
};

const VIN_BRAND_HINTS: Record<string, string> = {
  WBA: 'BMW',
  WBS: 'BMW',
  WDB: 'Mercedes-Benz',
  WDC: 'Mercedes-Benz',
  JTD: 'Toyota',
  JT3: 'Toyota',
  KMH: 'Hyundai',
  KNA: 'Kia',
  SAL: 'Land Rover',
  WAU: 'Audi',
  WVW: 'Volkswagen'
};

const PHONE_CODES = [
  { id: 'uae', label: 'ОАЭ', country: 'ОАЭ', code: '+971' },
  { id: 'ru', label: 'Россия', country: 'Россия', code: '+7' },
  { id: 'tj', label: 'Таджикистан', country: 'Таджикистан', code: '+992' },
  { id: 'uz', label: 'Узбекистан', country: 'Узбекистан', code: '+998' },
  { id: 'kz', label: 'Казахстан', country: 'Казахстан', code: '+7' }
] as const;

const DELIVERY_COUNTRIES = ['ОАЭ', 'Россия', 'Таджикистан', 'Узбекистан', 'Казахстан'] as const;
const DELIVERY_CITIES: Record<(typeof DELIVERY_COUNTRIES)[number], string[]> = {
  'ОАЭ': ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Al Ain'],
  'Россия': ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск'],
  'Таджикистан': ['Душанбе', 'Худжанд', 'Куляб'],
  'Узбекистан': ['Ташкент', 'Самарканд', 'Бухара'],
  'Казахстан': ['Алматы', 'Астана', 'Шымкент']
};

interface RequestedPartInput {
  id: string;
  name: string;
  comment: string;
  photoDataList: string[];
  audioNote?: string | null;
}

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createRequestedPartInput = (): RequestedPartInput => ({
  id: createId(),
  name: '',
  comment: '',
  photoDataList: [],
  audioNote: null
});


const MAX_PART_PHOTOS = 8;
const LEAD_RETRY_QUEUE_KEY = 'public_order_pending_leads_v1';

type PendingLeadPayload = {
  orderId: string;
  leadPayload: Parameters<typeof leadCreate>[0];
};

const readPendingLeadQueue = (): PendingLeadPayload[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEAD_RETRY_QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writePendingLeadQueue = (items: PendingLeadPayload[]) => {
  localStorage.setItem(LEAD_RETRY_QUEUE_KEY, JSON.stringify(items));
};

const normalizeDraftRequestedParts = (input: unknown): RequestedPartInput[] => {
  if (!Array.isArray(input)) return [createRequestedPartInput()];

  const normalized = input.map((item) => {
    if (!item || typeof item !== 'object') return null;
    const part = item as Record<string, unknown>;
    const photoDataList = Array.isArray(part.photoDataList)
      ? part.photoDataList.filter((photo): photo is string => typeof photo === 'string' && photo.startsWith('data:image')).slice(0, MAX_PART_PHOTOS)
      : (typeof part.photoData === 'string' && part.photoData.startsWith('data:image') ? [part.photoData] : []);

    return {
      id: typeof part.id === 'string' && part.id ? part.id : createId(),
      name: typeof part.name === 'string' ? part.name : '',
      comment: typeof part.comment === 'string' ? part.comment : '',
      photoDataList,
      audioNote: typeof part.audioNote === 'string' ? part.audioNote : null
    } satisfies RequestedPartInput;
  }).filter((part): part is RequestedPartInput => Boolean(part));

  return normalized.length ? normalized : [createRequestedPartInput()];
};

const formatVinInput = (value: string) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 17);

const splitParts = (value: string) => value
  .split(/,|\n| и | and |&|;/gi)
  .map((item) => item.trim())
  .filter(Boolean);

const validateAndPrepareLeadPayload = (payload: Parameters<typeof leadCreate>[0]) => {
  const normalizedName = String(payload.name || '').trim();
  const normalizedPhone = String(payload.phone || '').replace(/\s+/g, '');
  if (!normalizedName) {
    throw new Error('Укажите ваше имя перед отправкой заявки.');
  }
  if (!normalizedPhone || normalizedPhone.replace(/\D/g, '').length < 8) {
    throw new Error('Укажите корректный номер телефона для связи.');
  }

  return {
    ...payload,
    name: normalizedName,
    phone: normalizedPhone,
    message: typeof payload.message === 'string' ? payload.message : JSON.stringify(payload.message || {})
  };
};

const resolveTransportPhone = (primaryContactValue: string, whatsappContactValue: string) => {
  const normalizedPrimary = primaryContactValue.replace(/\s+/g, '').trim();
  if (normalizedPrimary.replace(/\D/g, '').length >= 8) {
    return { phone: normalizedPrimary, usedFallback: false };
  }

  const normalizedWhatsapp = whatsappContactValue.replace(/\s+/g, '').trim();
  if (normalizedWhatsapp.replace(/\D/g, '').length >= 8) {
    return { phone: normalizedWhatsapp, usedFallback: false };
  }

  // Технический fallback: backend требует phone, а пользователь мог выбрать Telegram/E-mail.
  // Основной канал связи и реальный контакт остаются в payload.message и notes.
  return { phone: '+00000000', usedFallback: true };
};

const ButtonDropdown: React.FC<{
  value: string;
  placeholder: string;
  options: string[];
  disabled?: boolean;
  required?: boolean;
  onChange: (value: string) => void;
}> = ({ value, placeholder, options, disabled, required, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const justSelectedAtRef = useRef(0);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((item) => item.toLowerCase().includes(normalized));
  }, [options, query]);

  useEffect(() => {
    const onOutsideClick = (event: MouseEvent | PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onOutsideClick);
    return () => document.removeEventListener('pointerdown', onOutsideClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    setOpen(false);
    setQuery('');
  }, [value]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const justSelected = Date.now() - justSelectedAtRef.current < 220;
          if (justSelected) return;
          setOpen((prev) => !prev);
        }}
        style={{ height: '56px', background: '#1F2937', borderRadius: '14px', border: open ? '1px solid #F59E0B' : '1px solid #374151', boxShadow: open ? '0 0 0 3px rgba(245,158,11,0.18)' : 'none' }}
        className="flex w-full items-center justify-between px-4 text-left text-base outline-none transition-all disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span style={{ color: value ? '#F9FAFB' : '#6B7280' }}>{value || `${placeholder}${required ? ' *' : ''}`}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: '#9CA3AF' }} />
      </button>

      {open && (
        <div className="absolute z-40 mt-2 w-full rounded-2xl p-2 shadow-2xl" style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div className="mb-2 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: '#1F2937', border: '1px solid #374151' }}>
            <Search className="h-4 w-4" style={{ color: '#9CA3AF' }} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск..."
              className="w-full bg-transparent text-sm outline-none"
              style={{ color: '#F9FAFB' }}
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filteredOptions.length > 0 ? filteredOptions.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  justSelectedAtRef.current = Date.now();
                  onChange(item);
                  setOpen(false);
                  setQuery('');
                }}
                className="w-full rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-white/10"
                style={{ color: '#F9FAFB' }}
              >
                {item}
              </button>
            )) : <p className="px-3 py-2 text-xs" style={{ color: '#9CA3AF' }}>Ничего не найдено</p>}
          </div>
        </div>
      )}
    </div>
  );
};

const PublicOrderFormScreen: React.FC = () => {
  const [step, setStep] = useState<FormStep>(1);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [bodyType, setBodyType] = useState('');
  const [vin, setVin] = useState('');
  const [requestedParts, setRequestedParts] = useState<RequestedPartInput[]>([createRequestedPartInput()]);
  const [carPhotoData, setCarPhotoData] = useState<string | null>(null);
  const [vinPhotoData, setVinPhotoData] = useState<string | null>(null);
  const [contactCountryCode, setContactCountryCode] = useState(PHONE_CODES[0].code);
  const [customerContact, setCustomerContact] = useState('');
  const [preferredContactChannel, setPreferredContactChannel] = useState<ContactChannel>('whatsapp');
  const [telegramContact, setTelegramContact] = useState('');
  const [instagramContact, setInstagramContact] = useState('');
  const [emailContact, setEmailContact] = useState('');
  const [phoneContact, setPhoneContact] = useState('');
  const [bestContactTime, setBestContactTime] = useState('');
  const [messageSource, setMessageSource] = useState<Source>(Source.WHATSAPP);
  const [clientAlias, setClientAlias] = useState('');
  const [deliveryCountry, setDeliveryCountry] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryAddressNote, setDeliveryAddressNote] = useState('');
  const [orderPriority, setOrderPriority] = useState<Priority>(Priority.MEDIUM);
  const [showEngineCode, setShowEngineCode] = useState(false);
  const [engineCode, setEngineCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitController, setSubmitController] = useState<AbortController | null>(null);
  const [showThanks, setShowThanks] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState('');
  const [recordingPartId, setRecordingPartId] = useState<string | null>(null);
  const [recordingTick, setRecordingTick] = useState(0);
  const [manualModelMode, setManualModelMode] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(0);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [messageSourceTouched, setMessageSourceTouched] = useState(false);
  const { settings } = useAppSettings();
  const [draftLinkId, setDraftLinkId] = useState(() => localStorage.getItem(DRAFT_LINK_ID_KEY) || createId());
  const publicFormUrl = `${window.location.origin}${window.location.pathname}?draft=${draftLinkId}#/request`;
  const refCode = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('ref') || '';
    } catch {
      return '';
    }
  }, []);
  const whatsappPhone = (settings.publicWhatsappNumber || '').replace(/\D/g, '');
  const companyLogoUrl = settings.publicCompanyLogoUrl || '';

  const carInputRef = useRef<HTMLInputElement | null>(null);
  const carCameraInputRef = useRef<HTMLInputElement | null>(null);
  const vinInputRef = useRef<HTMLInputElement | null>(null);
  const vinCameraInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const submitLockedRef = useRef(false);
  const submittedDraftIdsRef = useRef<Set<string>>(new Set());

  const modelOptions = useMemo(() => BRAND_MODELS[brand] || [], [brand]);
  const deliveryCityOptions = useMemo(() => DELIVERY_CITIES[deliveryCountry as keyof typeof DELIVERY_CITIES] || [], [deliveryCountry]);
  const [cityQuery, setCityQuery] = useState('');
  const filteredCityOptions = useMemo(() => {
    const normalized = cityQuery.trim().toLowerCase();
    if (!normalized) return deliveryCityOptions;
    return deliveryCityOptions.filter((city) => city.toLowerCase().includes(normalized));
  }, [cityQuery, deliveryCityOptions]);
  const smartSuggestionKey = `${brand}|${model}|${bodyType}`;
  const progress = (step / TOTAL_STEPS) * 100;
  const stepTitle = STEP_TITLES[step];

  useEffect(() => {
    if (!isSubmitting) {
      setSubmitProgress(0);
      return;
    }

    setSubmitProgress(8);
    const progressTimer = window.setInterval(() => {
      setSubmitProgress((current) => {
        if (current >= 92) return current;
        return Math.min(92, current + Math.max(2, Math.round((100 - current) * 0.12)));
      });
    }, 220);

    return () => window.clearInterval(progressTimer);
  }, [isSubmitting]);
  const voiceEnabled = Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (import.meta.env.DEV) {
      void runCloudDiagnostics();
    }
  }, []);

  useEffect(() => {
    const retryPendingLeads = async () => {
      const queued = readPendingLeadQueue();
      if (!queued.length || !navigator.onLine) return;

      for (const item of queued) {
        const retryResult = await leadCreate(item.leadPayload);
        if (!retryResult.ok) {
          void logger.warn('public-form', 'Retry lead sync still failing', { orderId: item.orderId, code: retryResult.code, error: retryResult.error });
          continue;
        }

        await logger.info('public-form', 'Pending lead synced after reconnect', {
          orderId: item.orderId,
          leadId: retryResult.data.leadId
        });
        writePendingLeadQueue(readPendingLeadQueue().filter((queuedItem) => queuedItem.orderId !== item.orderId));
      }
    };

    const onOnline = () => {
      void retryPendingLeads();
    };

    window.addEventListener('online', onOnline);
    void retryPendingLeads();
    return () => window.removeEventListener('online', onOnline);
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const source = (params.get('source') || '').toLowerCase();
      const incomingDraftId = params.get('draft') || localStorage.getItem(DRAFT_LINK_ID_KEY) || createId();
      setDraftLinkId(incomingDraftId);
      localStorage.setItem(DRAFT_LINK_ID_KEY, incomingDraftId);

      if (source.includes('insta') || source.includes('ig')) {
        setMessageSource(Source.INSTAGRAM);
        setMessageSourceTouched(true);
      }
      const saved = localStorage.getItem(`${DRAFT_KEY}_${incomingDraftId}`) || localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved);
        setBrand(draft.brand || '');
        setModel(draft.model || '');
        setYear(draft.year || '');
        setBodyType((draft.bodyType || '').slice(0, 40));
        setVin(draft.vin || '');
        setRequestedParts(normalizeDraftRequestedParts(draft.requestedParts));
        setCustomerContact(draft.customerContact || '');
        setContactCountryCode(draft.contactCountryCode || PHONE_CODES[0].code);
        setPreferredContactChannel(isContactChannel(draft.preferredContactChannel) ? draft.preferredContactChannel : 'whatsapp');
        setTelegramContact(draft.telegramContact || '');
        setInstagramContact(draft.instagramContact || '');
        setEmailContact(draft.emailContact || '');
        setPhoneContact(draft.phoneContact || '');
        setBestContactTime(draft.bestContactTime || '');
        setDeliveryCountry(draft.deliveryCountry || '');
        setDeliveryCity(draft.deliveryCity || '');
        setDeliveryAddressNote(draft.deliveryAddressNote || '');
        setEngineCode(draft.engineCode || '');
        setClientAlias(draft.clientAlias || '');
        setMessageSource(Object.values(Source).includes(draft.messageSource) ? draft.messageSource : Source.WHATSAPP);
        setMessageSourceTouched(Boolean(draft.messageSource));
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_LINK_ID_KEY, draftLinkId);
      localStorage.setItem(`${DRAFT_KEY}_${draftLinkId}`, JSON.stringify({
        brand,
        model,
        year,
        bodyType,
        vin,
        requestedParts,
        customerContact,
        contactCountryCode,
        preferredContactChannel,
        telegramContact,
        instagramContact,
        emailContact,
        phoneContact,
        bestContactTime,
        deliveryCountry,
        deliveryCity,
        deliveryAddressNote,
        engineCode,
        clientAlias,
        messageSource
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      void logger.warn('public-form:draft', 'Draft save skipped', { reason: message });
    }
  }, [brand, model, year, bodyType, vin, requestedParts, customerContact, contactCountryCode, preferredContactChannel, telegramContact, instagramContact, emailContact, phoneContact, bestContactTime, deliveryCountry, deliveryCity, deliveryAddressNote, engineCode, clientAlias, messageSource, draftLinkId]);

  useEffect(() => {
    if (brand === 'BMW') setShowEngineCode(true);
  }, [brand]);

  useEffect(() => {
    if (!deliveryCountry) {
      setDeliveryCity('');
      setCityQuery('');
      return;
    }
    if (cityQuery.length < 3) return;
    const exact = deliveryCityOptions.find((city) => city.toLowerCase() === cityQuery.trim().toLowerCase());
    if (exact) setDeliveryCity(exact);
  }, [cityQuery, deliveryCityOptions, deliveryCountry]);

  const handleFileToDataUrl = (file: File, onLoad: (value: string) => void) => {
    if (!file.type.startsWith('image/')) {
      alert('Разрешены только изображения (JPG/PNG/HEIC/WebP).');
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      alert('Файл слишком большой. Максимум 8MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => onLoad(String(reader.result || ''));
    reader.readAsDataURL(file);
  };


  const handleFilesToDataUrls = async (files: FileList | File[], onLoad: (values: string[]) => void) => {
    const picked = Array.from(files || []).filter((file) => file.type.startsWith('image/') && file.size <= MAX_UPLOAD_SIZE_BYTES);
    if (Array.from(files || []).length && !picked.length) {
      alert('Проверьте формат и размер файлов (только изображения до 8MB).');
    }
    if (!picked.length) return;

    const optimized = await Promise.all(
      picked.map(async (file) => {
        const source = await new Promise<string>((resolve) => handleFileToDataUrl(file, resolve));
        return optimizeImageForUpload(source, `public-form:pick:${file.name || file.type}`);
      })
    );

    onLoad(optimized.filter(Boolean));
  };

  const detectByVin = (value: string) => {
    const normalized = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (normalized.length < 3) return;
    const brandByVin = VIN_BRAND_HINTS[normalized.slice(0, 3)];
    if (brandByVin && !brand) setBrand(brandByVin);
  };

  const addRequestedPart = (value = '') => {
    setRequestedParts((current) => {
      if (current.length >= MAX_REQUEST_PART_FIELDS) return current;
      return [...current, { ...createRequestedPartInput(), name: value }];
    });
  };

  const updateRequestedPart = (index: number, updates: Partial<RequestedPartInput>) => {
    setRequestedParts((current) => current.map((part, i) => (i === index ? { ...part, ...updates } : part)));
  };

  const switchContactChannel = (channel: ContactChannel) => {
    setPreferredContactChannel(channel);
    if (!messageSourceTouched) {
      setMessageSource(CONTACT_CHANNEL_TO_SOURCE[channel]);
    }
    if (channel !== 'whatsapp') setCustomerContact('');
    if (channel !== 'telegram') setTelegramContact('');
    if (channel !== 'instagram') setInstagramContact('');
    if (channel !== 'email') setEmailContact('');
    if (channel !== 'phone') setPhoneContact('');
  };

  const validatePhone = () => {
    const digits = customerContact.replace(/\D/g, '');
    if (contactCountryCode === '+971') return digits.length === 9;
    return digits.length >= 8 && digits.length <= 15;
  };
  const isWhatsappValid = validatePhone();

  const validateStep = (nextStep = step) => {
    const list = nextStep === 1
      ? validateStep1({ brand, model, year, bodyType, vin })
      : nextStep === 2
        ? validateStep2({ requestedParts })
        : validateStep3({
          deliveryCountry,
          preferredContactChannel,
          customerContact,
          contactCountryCode,
          telegramContact,
          instagramContact,
          emailContact,
          phoneContact,
          bestContactTime
        });
    const nextErrors = list.reduce<Record<string, string>>((acc, item) => {
      acc[item.field] = item.message;
      return acc;
    }, {});
    setErrors(nextErrors);
    return list.length === 0;
  };

  const stepBlockingErrors = useMemo(() => {
    if (step === 1) return validateStep1({ brand, model, year, bodyType, vin });
    if (step === 2) return validateStep2({ requestedParts });
    if (step === 3) {
      return validateStep3({
        deliveryCountry,
        preferredContactChannel,
        customerContact,
        contactCountryCode,
        telegramContact,
        instagramContact,
        emailContact,
        phoneContact,
        bestContactTime
      });
    }
    return [];
  }, [step, brand, model, year, bodyType, vin, requestedParts, deliveryCountry, preferredContactChannel, customerContact, contactCountryCode, telegramContact, instagramContact, emailContact, phoneContact, bestContactTime]);

  const canContinue = stepBlockingErrors.length === 0 || step === 4;

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(TOTAL_STEPS, current + 1) as FormStep);
  };

  const goBack = () => setStep((current) => Math.max(1, current - 1) as FormStep);
  const goToStep = (targetStep: FormStep) => {
    if (targetStep === step) return;
    if (targetStep < step) {
      setStep(targetStep);
      return;
    }
    const checkpoints = Array.from({ length: targetStep - 1 }, (_, index) => (index + 1) as FormStep);
    const allPreviousValid = checkpoints.every((checkpoint) => validateStep(checkpoint));
    if (allPreviousValid) setStep(targetStep);
  };

  const resetForm = () => {
    setStep(1);
    setBrand('');
    setModel('');
    setYear('');
    setBodyType('');
    setVin('');
    setRequestedParts([createRequestedPartInput()]);
    setCarPhotoData(null);
    setVinPhotoData(null);
    setContactCountryCode(PHONE_CODES[0].code);
    setCustomerContact('');
    setPreferredContactChannel('whatsapp');
    setTelegramContact('');
    setInstagramContact('');
    setEmailContact('');
    setPhoneContact('');
    setBestContactTime('');
    setMessageSource(Source.WHATSAPP);
    setMessageSourceTouched(false);
    setDeliveryCountry('');
    setDeliveryCity('');
    setDeliveryAddressNote('');
    setOrderPriority(Priority.MEDIUM);
    setShowEngineCode(false);
    setEngineCode('');
    setClientAlias('');
    setConsentAccepted(false);
    setShowSubmitConfirm(false);
    submitLockedRef.current = false;
    localStorage.removeItem(`${DRAFT_KEY}_${draftLinkId}`);
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(DRAFT_LINK_ID_KEY);
  };

  const startNewRequest = () => {
    resetForm();
    const newDraftId = createId();
    setDraftLinkId(newDraftId);
    setVin('');
  };

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.startsWith('998')) {
      setContactCountryCode('+998');
      setDeliveryCountry('Узбекистан');
      return digits.slice(3);
    }
    if (digits.startsWith('992')) {
      setContactCountryCode('+992');
      setDeliveryCountry('Таджикистан');
      return digits.slice(3);
    }
    if (digits.startsWith('971')) {
      setContactCountryCode('+971');
      setDeliveryCountry('ОАЭ');
      return digits.slice(3);
    }
    return digits;
  };

  useEffect(() => {
    if (!recordingPartId) return;
    const timer = window.setInterval(() => setRecordingTick((prev) => prev + 1), 320);
    return () => window.clearInterval(timer);
  }, [recordingPartId]);

  useEffect(() => () => {
    mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const togglePartVoiceRecording = async (partId: string, index: number) => {
    if (recordingPartId === partId) {
      mediaRecorderRef.current?.stop();
      setRecordingPartId(null);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Запись аудио не поддерживается на этом устройстве');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const audioData = String(reader.result || '');
          if (audioData) {
            updateRequestedPart(index, { audioNote: audioData });
            void logger.info('public-form:media', 'Part audio recorded', { partId, index });
          }
        };
        reader.readAsDataURL(blob);
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      };

      recorder.start();
      setRecordingPartId(partId);
    } catch {
      alert('Не удалось начать запись');
    }
  };

  const submitOrder = async () => {
    if (submitLockedRef.current || isSubmitting) return;
    if (submittedDraftIdsRef.current.has(draftLinkId)) return;
    if (!validateStep(1) || !validateStep(2) || !validateStep(3)) {
      pushNotification({
        type: NotificationType.SYNC_ERROR,
        title: 'Ошибка валидации',
        message: 'Пожалуйста, заполните все обязательные поля',
        severity: 'error'
      });
      return;
    }

    const filledRequestedParts = requestedParts.filter((part) => part.name.trim());
    if (!filledRequestedParts.length) {
      pushNotification({
        type: NotificationType.SYNC_ERROR,
        title: 'Нет деталей',
        message: 'Добавьте минимум одну деталь',
        severity: 'error'
      });
      return;
    }

    submitLockedRef.current = true;
    setIsSubmitting(true);
    void logger.info('public-form', 'Lead submit started', {
      source: messageSource,
      parts: filledRequestedParts.length,
      hasCarPhoto: Boolean(carPhotoData),
      hasVinPhoto: Boolean(vinPhotoData)
    });

    try {
      const orderId = createId();
      const now = new Date().toISOString();

      let uploadedCarPhotos: string[] = [];
      let uploadedVinPhotos: string[] = [];

      try {
        [uploadedCarPhotos, uploadedVinPhotos] = await Promise.all([
          (async () => {
            if (!carPhotoData) return [];
            const compressed = await optimizeImageForUpload(carPhotoData, `public-order:${orderId}:car`);
            return ensurePublicImageUrls([compressed], `orders/${orderId}/car`);
          })(),
          (async () => {
            if (!vinPhotoData) return [];
            const compressedVin = await optimizeImageForUpload(vinPhotoData, `public-order:${orderId}:vin`);
            return ensurePublicImageUrls([compressedVin], `orders/${orderId}/vin`);
          })()
        ]);
      } catch (photoError) {
        const photoErrorMsg = photoError instanceof Error ? photoError.message : 'Ошибка загрузки фотографий';
        await logger.warn('public-form', 'Photo upload failed', { reason: photoErrorMsg });
        throw new Error(`Не удалось загрузить фотографии: ${photoErrorMsg}`);
      }

      const uploadedAudios = filledRequestedParts.map((part) => part.audioNote || '').filter(Boolean);
      const primaryContactValue = (
        preferredContactChannel === 'whatsapp'
          ? `${contactCountryCode}${customerContact.trim()}`
          : preferredContactChannel === 'telegram'
            ? telegramContact.trim()
            : preferredContactChannel === 'instagram'
              ? instagramContact.trim()
            : preferredContactChannel === 'email'
              ? emailContact.trim()
              : phoneContact.trim()
      );
      const whatsappContactValue = `${contactCountryCode}${customerContact.trim()}`;
      const transportPhone = resolveTransportPhone(primaryContactValue, whatsappContactValue);

      const notes = [{
        id: createId(),
        text: `Public Lead
Источник: ${messageSource}
Имя/ник: ${clientAlias || '—'}
VIN: ${vin || 'VIN не указан'}
Engine code: ${engineCode || '—'}
Country: ${deliveryCountry}
Priority: ${PRIORITY_LABELS[orderPriority]}
Primary contact: ${CONTACT_CHANNEL_LABELS[preferredContactChannel]} ${primaryContactValue || '—'}
WhatsApp: ${whatsappContactValue || '—'}
Telegram: ${telegramContact.trim() || '—'}
Instagram: ${instagramContact.trim() || '—'}
Email: ${emailContact.trim() || '—'}
Phone: ${phoneContact.trim() || '—'}
Best time: ${bestContactTime || '—'}`,
        photos: uploadedVinPhotos,
        audios: uploadedAudios,
        createdAt: Date.now()
      },
      ...filledRequestedParts
        .filter((part) => part.comment.trim())
        .map((part) => ({
          id: createId(),
          text: `${part.name.trim()} — ${part.comment.trim()}`,
          createdAt: Date.now()
        }))];

      let partsToInsert: typeof requestedParts = [];
      try {
        partsToInsert = await Promise.all(filledRequestedParts.map(async (part) => {
          const uploadedPartPhotos = !part.photoDataList.length
            ? []
            : await (async (photos: string[]) => {
              const compressedPartPhotos = await Promise.all(
                photos.slice(0, MAX_PART_PHOTOS).map((photoData, index) =>
                  optimizeImageForUpload(photoData, `public-order:${orderId}:${part.id}:${index}`)
                )
              );
              return ensurePublicImageUrls(compressedPartPhotos, `orders/${orderId}/parts/${part.id}`);
            })(part.photoDataList);

          return {
            id: createId(),
            name: part.name.trim(),
            photos: uploadedPartPhotos,
            photoUrl: uploadedPartPhotos[0] || null,
            isFound: false
          };
        }));
      } catch (partsError) {
        const partsErrorMsg = partsError instanceof Error ? partsError.message : 'Ошибка загрузки деталей';
        await logger.warn('public-form', 'Part photos upload failed', { reason: partsErrorMsg });
        throw new Error(`Не удалось загрузить детали: ${partsErrorMsg}`);
      }

      const controller = new AbortController();
      setSubmitController(controller);

      const leadPayload = {
        orderId,
        idempotency_key: orderId,
        name: clientAlias.trim() || 'Public Lead',
        phone: transportPhone.phone,
        message: JSON.stringify({
          source: messageSource,
          brand: brand.trim(),
          model: model.trim(),
          year: year.trim(),
          vin: vin.trim(),
          bodyType: bodyType.trim() || null,
          requestedParts: filledRequestedParts.map((part) => ({ name: part.name.trim(), comment: part.comment || null })),
          priority: orderPriority,
          refCode: refCode || null,
          preferredContactChannel,
          customerContact: primaryContactValue || null,
          whatsappContact: whatsappContactValue || null,
          telegramContact: telegramContact.trim() || null,
          instagramContact: instagramContact.trim() || null,
          emailContact: emailContact.trim() || null,
          phoneContact: phoneContact.trim() || null,
          contactCountryCode: contactCountryCode.trim() || null,
          bestContactTime: bestContactTime || null
        }),
        parts: partsToInsert,
        notes,
        refCode: refCode || undefined,
        carPhotos: uploadedCarPhotos,
        vinPhotos: uploadedVinPhotos
      };

      const validatedLeadPayload = validateAndPrepareLeadPayload(leadPayload);
      await logger.info('public-form', 'Lead payload diagnostics', {
        orderId,
        parts: partsToInsert.length,
        hasNotes: notes.length,
        payloadBytes: JSON.stringify(validatedLeadPayload).length,
        transportPhoneFallback: transportPhone.usedFallback
      });

      let leadResult;
      try {
        leadResult = await leadCreate(validatedLeadPayload, { signal: controller.signal });
      } catch (leadCreateError) {
        const leadErrorMsg = leadCreateError instanceof Error ? leadCreateError.message : 'Ошибка подключения к серверу';
        await logger.warn('public-form', 'Lead create request failed', { reason: leadErrorMsg });
        throw new Error(`Не удалось создать лид: ${leadErrorMsg}`);
      } finally {
        setSubmitController(null);
      }

      if (!leadResult.ok) {
        const nextQueue = [...readPendingLeadQueue().filter((item) => item.orderId !== orderId), { orderId, leadPayload: validatedLeadPayload }];
        writePendingLeadQueue(nextQueue);

        await logger.warn('public-form', 'Lead create failed - keeping pending queue entry', {
          reason: leadResult.error,
          code: leadResult.code,
          orderId
        });

        throw new Error(leadResult.error || 'Не удалось отправить заявку в облако. Попробуйте ещё раз.');
      } else {
        await logger.info('public-form', 'Lead successfully created on server', {
          orderId,
          leadId: leadResult.data?.leadId
        });
      }

      try {
        await addOrderItem({
          id: orderId,
          brand: brand.trim(),
          model: model.trim(),
          year: year.trim(),
          bodyType: bodyType.trim() || undefined,
          vin: vin.trim(),
          vinPhotoUrl: uploadedVinPhotos[0],
          status: leadResult.ok ? 'lead' : 'lead_sync_pending',
          priority: orderPriority,
          clientName: clientAlias.trim() || 'Public Lead',
          source: messageSource,
          carPhotoUrl: uploadedCarPhotos[0],
          carPhotos: uploadedCarPhotos,
          parts: partsToInsert,
          markupPercent: 0,
          exchangeRate: 3.67,
          createdAt: Date.now(),
          isArchived: false,
          isSold: false,
          isLead: true,
          notes,
          customerContact: primaryContactValue || `${contactCountryCode}${customerContact.trim()}`.trim(),
          socialNickname: preferredContactChannel === 'telegram'
            ? (telegramContact.trim() || undefined)
            : preferredContactChannel === 'instagram'
              ? (instagramContact.trim() || undefined)
              : undefined,
          leadUnread: true,
          leadSource: 'public_form',
          leadSyncPending: !leadResult.ok,
          leadSyncError: leadResult.ok ? undefined : leadResult.error || 'Lead create failed'
        });

        await logger.info('public-form', `Lead created locally ${orderId}`, {
          source: messageSource,
          parts: filledRequestedParts.length,
          orderId,
          remoteLeadOk: leadResult.ok
        });
      } catch (localError) {
        const localErrorMsg = localError instanceof Error ? localError.message : 'Ошибка локального хранилища';
        await logger.error('public-form', 'Local order save failed', { reason: localErrorMsg });
        throw new Error(`Не удалось сохранить заявку локально: ${localErrorMsg}`);
      }

      submittedDraftIdsRef.current.add(draftLinkId);
      setCreatedOrderId(orderId);
      setShowThanks(true);
      resetForm();

      if (leadResult.ok) {
        pushNotification({
          type: NotificationType.INFO,
          title: '✅ Заявка успешно отправлена!',
          message: `Номер заявки: ${orderId}. Ожидайте ответ в течение 10-20 минут.`,
          orderId,
          source: 'web_form',
          route: `/order/${orderId}`,
          severity: 'success'
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка при отправке заявки';

      await logger.error('public-form', 'Lead submit failed', {
        error: errorMessage,
        source: messageSource,
        brand: brand.trim(),
        model: model.trim(),
        vin: vin.trim() || null
      });

      pushNotification({
        type: NotificationType.SYNC_ERROR,
        title: '❌ Ошибка отправки',
        message: errorMessage,
        severity: 'error'
      });
    } finally {
      setSubmitController(null);
      setIsSubmitting(false);
      submitLockedRef.current = false;
    }
  };

  if (showThanks) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: '#0B1220', color: '#F9FAFB', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="w-full max-w-[640px] rounded-[24px] p-8 text-center" style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: 'rgba(16,185,129,0.15)' }}>
            <Check className="h-8 w-8" style={{ color: '#10B981' }} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Заявка отправлена</h1>
          <p className="mt-3 text-base" style={{ color: '#9CA3AF' }}>Мы свяжемся с вами в течение 10–20 минут.</p>
          <p className="mt-2 text-sm" style={{ color: '#6B7280' }}>Номер заявки: <span style={{ color: '#F9FAFB', fontWeight: 600 }}>{createdOrderId}</span></p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {whatsappPhone && (
              <a href={`https://wa.me/${whatsappPhone}`} target="_blank" rel="noreferrer"
                className="flex items-center justify-center rounded-[14px] py-3 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #F59E0B, #FCD34D)', color: '#0B1220' }}>
                Перейти в WhatsApp
              </a>
            )}
            <button type="button" onClick={() => navigator.clipboard.writeText(publicFormUrl)}
              className="flex items-center justify-center rounded-[14px] py-3 text-sm font-semibold transition-colors hover:bg-white/10"
              style={{ border: '1px solid rgba(255,255,255,0.15)', color: '#F9FAFB' }}>
              Скопировать ссылку
            </button>
            {settings.publicTelegramUrl && (
              <a href={settings.publicTelegramUrl} target="_blank" rel="noreferrer"
                className="flex items-center justify-center rounded-[14px] py-3 text-sm font-semibold"
                style={{ border: '1px solid rgba(125,211,252,0.3)', background: 'rgba(14,165,233,0.12)', color: '#BAE6FD' }}>
                Telegram
              </a>
            )}
            {settings.publicInstagramUrl && (
              <a href={settings.publicInstagramUrl} target="_blank" rel="noreferrer"
                className="flex items-center justify-center rounded-[14px] py-3 text-sm font-semibold"
                style={{ border: '1px solid rgba(244,114,182,0.3)', background: 'rgba(236,72,153,0.1)', color: '#FBCFE8' }}>
                Instagram
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // CSS helpers
  const inputStyle = (hasError = false): React.CSSProperties => ({
    height: '56px',
    background: '#1F2937',
    borderRadius: '14px',
    border: hasError ? '1px solid #F59E0B' : '1px solid #374151',
    paddingLeft: '16px',
    paddingRight: '16px',
    fontSize: '16px',
    color: '#F9FAFB',
    width: '100%',
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s'
  });
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#9CA3AF',
    marginBottom: '6px'
  };
  const cardStyle: React.CSSProperties = {
    background: '#111827',
    borderRadius: '18px',
    padding: '24px',
    border: '1px solid rgba(255,255,255,0.06)'
  };
  const errorTextStyle: React.CSSProperties = {
    marginTop: '4px',
    fontSize: '12px',
    color: '#FCD34D'
  };

  return (
    <div className="min-h-screen pb-[88px]" style={{ background: '#0B1220', color: '#F9FAFB', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {import.meta.env.DEV && (
        <div className="fixed top-2 right-2 z-50 rounded-lg px-3 py-2 text-xs font-mono" style={{ background: 'rgba(0,0,0,0.85)', color: '#F9FAFB' }}>
          Cloud: {isCloudConfigured ? '✅ ON' : (cloudFeatureFlags.clientForm ? '⚠️ PARTIAL' : '❌ OFF')}
          {' | '}
          Form: {cloudFeatureFlags.clientForm ? '✅' : '❌'}
        </div>
      )}

      {/* HEADER */}
      <div className="mx-auto w-full max-w-[640px] px-6" style={{ paddingTop: '28px', paddingBottom: '12px', minHeight: '120px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: '#9CA3AF' }}>Dubai Spares Concierge</span>
          {companyLogoUrl && <img src={companyLogoUrl} alt="Company logo" className="h-9 w-auto max-w-[140px] object-contain" />}
        </div>
        <h1 style={{ fontSize: '36px', fontWeight: 600, lineHeight: 1.2, margin: 0, color: '#F9FAFB' }}>{stepTitle}</h1>
      </div>

      {/* PROGRESS NAVIGATION */}
      <div className="mx-auto w-full max-w-[640px] px-6 pb-4">
        <div className="flex items-center mb-4">
          {STEP_NAMES.map((name, index) => {
            const itemStep = (index + 1) as FormStep;
            const isCompleted = step > itemStep;
            const isActive = step === itemStep;
            return (
              <React.Fragment key={name}>
                <button
                  type="button"
                  onClick={() => goToStep(itemStep)}
                  className="flex items-center gap-1.5 shrink-0 transition-all"
                  style={{ fontSize: '14px', fontWeight: isActive ? 600 : 400, color: (isCompleted || isActive) ? '#F59E0B' : '#6B7280', border: isActive ? '1px solid #F59E0B' : '1px solid transparent', borderRadius: '20px', padding: '4px 10px', background: isActive ? 'rgba(245,158,11,0.08)' : 'transparent', cursor: 'pointer', outline: 'none' }}
                >
                  <span style={{ fontWeight: 700 }}>{itemStep}</span>
                  <span className="hidden sm:inline">{name}</span>
                </button>
                {index < STEP_NAMES.length - 1 && (
                  <div className="flex-1 mx-1" style={{ height: '1px', background: step > itemStep ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.1)' }} />
                )}
              </React.Fragment>
            );
          })}
        </div>
        {/* Progress bar */}
        <div style={{ height: '6px', borderRadius: '99px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: '99px', background: 'linear-gradient(90deg, #F59E0B, #FCD34D)', width: `${progress}%`, transition: 'width 0.4s ease' }} />
        </div>
      </div>

      {/* FORM CONTENT */}
      <div className="mx-auto w-full max-w-[640px] px-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {step < 4 && stepBlockingErrors.length > 0 && (
          <div className="rounded-[14px] px-4 py-3 text-xs" style={{ border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#FCD34D' }}>
            <p className="font-semibold mb-1">Заполните обязательные поля:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {Array.from(new Set(stepBlockingErrors.map((item) => item.message))).map((message) => <li key={message}>{message}</li>)}
            </ul>
          </div>
        )}

        {/* ── STEP 1: АВТОМОБИЛЬ ── */}
        {step === 1 && (
          <>
            {/* Car summary chip */}
            <div className="flex items-center gap-2 rounded-[14px] px-4 py-3 text-sm" style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span>🚗</span>
              <span style={{ color: '#9CA3AF' }}>{[brand, model, year].filter(Boolean).join(' ') || 'Заполните данные ниже'}</span>
            </div>

            {/* Марка + Модель card */}
            <div style={cardStyle}>
              <label className="block mb-5">
                <span style={labelStyle}>Марка *</span>
                <ButtonDropdown
                  value={brand}
                  placeholder="Выберите марку"
                  options={[...POPULAR_BRANDS, ...BRANDS.filter((b) => !POPULAR_BRANDS.includes(b))]}
                  onChange={(value) => {
                    setBrand(value);
                    setModel('');
                    setManualModelMode(false);
                  }}
                />
                {errors.brand && <p style={errorTextStyle}>{errors.brand}</p>}
              </label>

              <label className="block">
                <span style={labelStyle}>Модель *</span>
                <ButtonDropdown
                  value={model}
                  placeholder="Выберите модель"
                  options={modelOptions}
                  disabled={!brand}
                  onChange={(value) => {
                    setModel(value);
                    setManualModelMode(false);
                  }}
                />
                <button
                  type="button"
                  onClick={() => setManualModelMode((prev) => !prev)}
                  className="mt-2 text-xs font-semibold underline underline-offset-2"
                  style={{ color: '#9CA3AF' }}
                >
                  {manualModelMode ? 'Выбрать модель из списка' : 'Добавить модель вручную'}
                </button>
                {(manualModelMode || (brand && modelOptions.length === 0)) && (
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Введите модель вручную"
                    style={{ ...inputStyle(Boolean(errors.model)), marginTop: '8px' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = errors.model ? '#F59E0B' : '#374151'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                )}
                {errors.model && <p style={errorTextStyle}>{errors.model}</p>}
              </label>
            </div>

            {/* Год + Тип кузова card */}
            <div style={cardStyle}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span style={labelStyle}>Год *</span>
                  <ButtonDropdown value={year} placeholder="Год выпуска" options={YEARS.map((item) => String(item))} required onChange={setYear} />
                  {errors.year && <p style={errorTextStyle}>{errors.year}</p>}
                </label>
                <label>
                  <span style={labelStyle}>Тип кузова (опционально)</span>
                  <input
                    value={bodyType}
                    onChange={(e) => setBodyType(e.target.value.slice(0, 40))}
                    placeholder="Напр. E39, F10, W212"
                    style={inputStyle(Boolean(errors.bodyType))}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = errors.bodyType ? '#F59E0B' : '#374151'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                  {errors.bodyType && <p style={errorTextStyle}>{errors.bodyType}</p>}
                </label>
              </div>
            </div>

            {/* VIN card */}
            <div style={cardStyle}>
              <label className="block">
                <span style={labelStyle}>VIN (опционально)</span>
                <div className="relative flex items-center">
                  <input
                    value={vin}
                    onChange={(e) => { const formatted = formatVinInput(e.target.value); setVin(formatted); if (!formatted) return; detectByVin(formatted); }}
                    placeholder="WDB12345678901234"
                    style={{ ...inputStyle(Boolean(errors.vin)), paddingRight: '130px' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = errors.vin ? '#F59E0B' : '#374151'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                  <button
                    type="button"
                    onClick={() => vinCameraInputRef.current?.click()}
                    className="absolute right-2 flex items-center gap-1 rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                    style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)' }}
                  >
                    <Camera className="h-3 w-3" /> Scan VIN
                  </button>
                </div>
                {errors.vin && <p style={errorTextStyle}>{errors.vin}</p>}
              </label>

              {/* VIN photo upload */}
              <div className="mt-5">
                <span style={labelStyle}>VIN фото (опционально)</span>
                {!vinPhotoData ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => vinInputRef.current?.click()}
                      className="flex flex-col items-center justify-center gap-1 transition-colors hover:bg-white/5"
                      style={{ height: '100px', borderRadius: '14px', border: '1.5px dashed rgba(255,255,255,0.2)', fontSize: '13px', color: '#9CA3AF' }}
                    >
                      <Upload className="h-5 w-5 mb-1" />
                      <span>📷 Добавить фото</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => vinCameraInputRef.current?.click()}
                      className="flex flex-col items-center justify-center gap-1 transition-colors hover:bg-white/5"
                      style={{ height: '100px', borderRadius: '14px', border: '1.5px dashed rgba(255,255,255,0.2)', fontSize: '13px', color: '#9CA3AF' }}
                    >
                      <Camera className="h-5 w-5 mb-1" />
                      <span>Сделать фото</span>
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <img src={vinPhotoData} alt="vin-preview" className="w-full rounded-[14px] object-cover" style={{ height: '120px' }} />
                    <button type="button" onClick={() => setVinPhotoData(null)} className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs" style={{ background: 'rgba(0,0,0,0.7)', color: '#F9FAFB' }}>✕</button>
                  </div>
                )}
                <input ref={vinInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setVinPhotoData); e.target.value = ''; }} />
                <input ref={vinCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setVinPhotoData); e.target.value = ''; }} />
              </div>
            </div>

            {/* Car photo upload */}
            <div style={cardStyle}>
              <span style={labelStyle}>Фото автомобиля (опционально)</span>
              {!carPhotoData ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => carInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-1 transition-colors hover:bg-white/5"
                    style={{ height: '100px', borderRadius: '14px', border: '1.5px dashed rgba(255,255,255,0.2)', fontSize: '13px', color: '#9CA3AF' }}
                  >
                    <Upload className="h-5 w-5 mb-1" />
                    <span>📷 Добавить фото</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => carCameraInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-1 transition-colors hover:bg-white/5"
                    style={{ height: '100px', borderRadius: '14px', border: '1.5px dashed rgba(255,255,255,0.2)', fontSize: '13px', color: '#9CA3AF' }}
                  >
                    <Camera className="h-5 w-5 mb-1" />
                    <span>Сделать фото</span>
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <img src={carPhotoData} alt="car-preview" className="w-full rounded-[14px] object-cover" style={{ height: '120px' }} />
                  <button type="button" onClick={() => setCarPhotoData(null)} className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs" style={{ background: 'rgba(0,0,0,0.7)', color: '#F9FAFB' }}>✕</button>
                </div>
              )}
              <input ref={carInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setCarPhotoData); e.target.value = ''; }} />
              <input ref={carCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setCarPhotoData); e.target.value = ''; }} />
            </div>
          </>
        )}

        {/* ── STEP 2: ДЕТАЛИ ── */}
        {step === 2 && (
          <>
            {showEngineCode && (
              <div style={cardStyle}>
                <label className="block">
                  <span style={labelStyle}>Код двигателя (для BMW)</span>
                  <input
                    value={engineCode}
                    onChange={(e) => setEngineCode(e.target.value)}
                    placeholder="Например: N52B30"
                    style={inputStyle()}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                </label>
              </div>
            )}

            {(PART_SUGGESTIONS[smartSuggestionKey] || []).length > 0 && (
              <div className="rounded-[14px] p-4" style={{ border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.07)' }}>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] mb-2" style={{ color: '#FCD34D' }}>Популярные детали</p>
                <div className="flex flex-wrap gap-2">
                  {PART_SUGGESTIONS[smartSuggestionKey].map((item) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => addRequestedPart(item)}
                      className="rounded-full px-3 py-1 text-xs transition-colors hover:bg-amber-400/20"
                      style={{ border: '1px solid rgba(245,158,11,0.35)', color: '#FCD34D' }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {requestedParts.map((part, index) => (
              <div key={part.id} style={{ ...cardStyle, position: 'relative' }}>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: '#9CA3AF' }}>Деталь #{index + 1}</p>
                  <button
                    type="button"
                    onClick={() => setRequestedParts((current) => current.length === 1 ? [createRequestedPartInput()] : current.filter((item) => item.id !== part.id))}
                    className="flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors hover:bg-red-500/15"
                    style={{ border: '1px solid rgba(255,255,255,0.12)', color: '#9CA3AF' }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <label className="block mb-3">
                  <span style={labelStyle}>Название детали *</span>
                  <input
                    value={part.name}
                    onChange={(e) => {
                      const value = e.target.value;
                      const chunks = splitParts(value);
                      if (chunks.length > 1 && !part.name.includes(',') && requestedParts.length < MAX_REQUEST_PART_FIELDS) {
                        updateRequestedPart(index, { name: chunks[0] });
                        chunks.slice(1).forEach((chunk) => addRequestedPart(chunk));
                        return;
                      }
                      updateRequestedPart(index, { name: value });
                    }}
                    placeholder="Наименование детали"
                    style={inputStyle(Boolean(errors[`partName-${index}`]))}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = errors[`partName-${index}`] ? '#F59E0B' : '#374151'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                  {errors[`partName-${index}`] && <p style={errorTextStyle}>{errors[`partName-${index}`]}</p>}
                </label>

                <label className="block mb-4">
                  <span style={labelStyle}>Комментарий</span>
                  <input
                    value={part.comment}
                    onChange={(e) => updateRequestedPart(index, { comment: e.target.value })}
                    placeholder="Описание, артикул, особенности…"
                    style={{ ...inputStyle(), height: '48px' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-3">
                  <input id={`${part.id}-gallery`} type="file" accept="image/*" multiple onChange={(e) => { if (e.target.files?.length) { void handleFilesToDataUrls(e.target.files, (values) => { updateRequestedPart(index, { photoDataList: [...part.photoDataList, ...values].slice(0, MAX_PART_PHOTOS) }); void logger.info('public-form:media', 'Part photo attached from gallery', { partId: part.id, index, count: values.length }); }); } e.target.value = ''; }} className="hidden" />
                  <input id={`${part.id}-camera`} type="file" accept="image/*" capture="environment" onChange={(e) => { if (e.target.files?.length) { void handleFilesToDataUrls(e.target.files, (values) => { updateRequestedPart(index, { photoDataList: [...part.photoDataList, ...values].slice(0, MAX_PART_PHOTOS) }); void logger.info('public-form:media', 'Part photo attached from camera', { partId: part.id, index, count: values.length }); }); } e.target.value = ''; }} className="hidden" />

                  <label
                    htmlFor={`${part.id}-gallery`}
                    className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] text-xs font-medium transition-colors hover:bg-white/10"
                    style={{ border: '1px solid rgba(255,255,255,0.15)', color: '#9CA3AF' }}
                  >
                    📷 Фото ({part.photoDataList.length})
                  </label>
                  <label
                    htmlFor={`${part.id}-camera`}
                    className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] text-xs font-medium transition-colors hover:bg-white/10"
                    style={{ border: '1px solid rgba(255,255,255,0.15)', color: '#9CA3AF' }}
                  >
                    <Camera className="h-3.5 w-3.5" /> Камера
                  </label>
                  {voiceEnabled && (
                    <button
                      type="button"
                      onClick={() => void togglePartVoiceRecording(part.id, index)}
                      className="flex h-10 items-center justify-center gap-2 rounded-[10px] text-xs font-medium transition-colors hover:bg-white/10"
                      style={{ border: recordingPartId === part.id ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(255,255,255,0.15)', color: recordingPartId === part.id ? '#FCA5A5' : '#9CA3AF', background: recordingPartId === part.id ? 'rgba(239,68,68,0.08)' : 'transparent' }}
                    >
                      {recordingPartId === part.id ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                      {recordingPartId === part.id ? 'Стоп' : '🎤 Голос'}
                    </button>
                  )}
                </div>

                {recordingPartId === part.id && (
                  <div className="mt-3 flex h-5 items-end gap-1">
                    {Array.from({ length: 18 }).map((_, waveIndex) => (
                      <span key={`${part.id}-record-${waveIndex}`} className="w-1 rounded-full transition-all" style={{ background: '#FCA5A5', height: `${25 + Math.abs(Math.sin((recordingTick + waveIndex) * 0.8)) * 75}%` }} />
                    ))}
                  </div>
                )}

                {part.photoDataList.length > 0 && (
                  <div className="mt-3 rounded-[14px] p-3" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)' }}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {part.photoDataList.map((photo, photoIndex) => (
                        <div key={`${part.id}-photo-${photoIndex}`} className="relative">
                          <img src={photo} alt={`part-${index}-preview-${photoIndex}`} className="w-full rounded-[10px] object-cover" style={{ height: '80px' }} />
                          <button
                            type="button"
                            onClick={() => {
                              updateRequestedPart(index, { photoDataList: part.photoDataList.filter((_, idx) => idx !== photoIndex) });
                              void logger.info('public-form:media', 'Part photo removed', { partId: part.id, index, photoIndex });
                            }}
                            className="absolute right-1 top-1 rounded-full px-1.5 py-0.5 text-[10px]"
                            style={{ background: 'rgba(0,0,0,0.7)', color: '#F9FAFB' }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 px-1 text-xs" style={{ color: '#6B7280' }}>Фото: {part.photoDataList.length}/{MAX_PART_PHOTOS}</p>
                  </div>
                )}

                {part.audioNote && (
                  <div className="mt-3 flex items-center gap-2 rounded-[14px] p-3" style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}>
                    <audio controls src={part.audioNote} className="h-8 w-full" />
                    <button
                      type="button"
                      onClick={() => {
                        updateRequestedPart(index, { audioNote: null });
                        void logger.info('public-form:media', 'Part audio removed', { partId: part.id, index });
                      }}
                      className="shrink-0 rounded-[10px] px-2 py-1 text-[11px] transition-colors hover:bg-white/10"
                      style={{ border: '1px solid rgba(255,255,255,0.15)', color: '#9CA3AF' }}
                    >
                      Удалить
                    </button>
                  </div>
                )}
              </div>
            ))}

            {requestedParts.length < MAX_REQUEST_PART_FIELDS && (
              <button
                type="button"
                onClick={() => addRequestedPart()}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-[18px] text-sm font-semibold transition-colors hover:bg-white/5"
                style={{ border: '1.5px dashed rgba(255,255,255,0.2)', color: '#9CA3AF' }}
              >
                + Добавить ещё деталь
              </button>
            )}
          </>
        )}

        {/* ── STEP 3: КОНТАКТЫ ── */}
        {step === 3 && (
          <>
            {/* Блок 1 — Контакт */}
            <div style={cardStyle}>
              <p className="text-sm font-semibold mb-4" style={{ color: '#F9FAFB' }}>Способ связи</p>

              <label className="block mb-4">
                <span style={labelStyle}>Предпочтительный канал *</span>
                <div className="grid grid-cols-3 gap-2">
                  {(['whatsapp', 'telegram', 'phone'] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => switchContactChannel(ch)}
                      className="flex h-11 items-center justify-center rounded-[12px] text-sm font-medium transition-all"
                      style={{
                        border: preferredContactChannel === ch ? '1px solid #F59E0B' : '1px solid rgba(255,255,255,0.12)',
                        background: preferredContactChannel === ch ? 'rgba(245,158,11,0.12)' : '#1F2937',
                        color: preferredContactChannel === ch ? '#F59E0B' : '#9CA3AF'
                      }}
                    >
                      {ch === 'whatsapp' ? 'WhatsApp' : ch === 'telegram' ? 'Telegram' : 'Телефон'}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {(['instagram', 'email'] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => switchContactChannel(ch)}
                      className="flex h-11 items-center justify-center rounded-[12px] text-sm font-medium transition-all"
                      style={{
                        border: preferredContactChannel === ch ? '1px solid #F59E0B' : '1px solid rgba(255,255,255,0.12)',
                        background: preferredContactChannel === ch ? 'rgba(245,158,11,0.12)' : '#1F2937',
                        color: preferredContactChannel === ch ? '#F59E0B' : '#9CA3AF'
                      }}
                    >
                      {ch === 'instagram' ? 'Instagram' : 'E-mail'}
                    </button>
                  ))}
                </div>
              </label>

              {preferredContactChannel === 'whatsapp' && (
                <label className="block">
                  <span style={labelStyle}>Номер WhatsApp *</span>
                  <div className="grid gap-2" style={{ gridTemplateColumns: '140px 1fr' }}>
                    <select
                      value={contactCountryCode}
                      onChange={(e) => setContactCountryCode(e.target.value)}
                      style={{ ...inputStyle(), paddingLeft: '12px', paddingRight: '8px', cursor: 'pointer' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                      {PHONE_CODES.map((item) => <option key={item.id} value={item.code} style={{ background: '#1F2937' }}>{item.label} {item.code}</option>)}
                    </select>
                    <input
                      type="tel"
                      value={customerContact}
                      onChange={(e) => setCustomerContact(formatPhone(e.target.value))}
                      placeholder="901234567"
                      style={inputStyle(Boolean(errors.phone))}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = errors.phone ? '#F59E0B' : '#374151'; e.currentTarget.style.boxShadow = 'none'; }}
                    />
                  </div>
                  {errors.phone && <p style={errorTextStyle}>{errors.phone}</p>}
                  {customerContact && <p className="mt-1 text-xs" style={{ color: isWhatsappValid ? '#6EE7B7' : '#FCA5A5' }}>{isWhatsappValid ? 'Номер выглядит корректно ✓' : 'Введите номер полностью'}</p>}
                </label>
              )}

              {preferredContactChannel === 'telegram' && (
                <label className="block">
                  <span style={labelStyle}>Telegram *</span>
                  <input value={telegramContact} onChange={(e) => setTelegramContact(e.target.value)} placeholder="@username" style={inputStyle(Boolean(errors.telegram))}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = errors.telegram ? '#F59E0B' : '#374151'; e.currentTarget.style.boxShadow = 'none'; }} />
                  {errors.telegram && <p style={errorTextStyle}>{errors.telegram}</p>}
                </label>
              )}
              {preferredContactChannel === 'instagram' && (
                <label className="block">
                  <span style={labelStyle}>Instagram</span>
                  <input value={instagramContact} onChange={(e) => setInstagramContact(e.target.value)} placeholder="@username или ссылка" style={inputStyle(Boolean(errors.instagram))}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = errors.instagram ? '#F59E0B' : '#374151'; e.currentTarget.style.boxShadow = 'none'; }} />
                  {errors.instagram && <p style={errorTextStyle}>{errors.instagram}</p>}
                </label>
              )}
              {preferredContactChannel === 'email' && (
                <label className="block">
                  <span style={labelStyle}>E-mail *</span>
                  <input type="email" value={emailContact} onChange={(e) => setEmailContact(e.target.value)} placeholder="you@example.com" style={inputStyle(Boolean(errors.email))}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = errors.email ? '#F59E0B' : '#374151'; e.currentTarget.style.boxShadow = 'none'; }} />
                  {errors.email && <p style={errorTextStyle}>{errors.email}</p>}
                </label>
              )}
              {preferredContactChannel === 'phone' && (
                <label className="block">
                  <span style={labelStyle}>Телефон *</span>
                  <input type="tel" value={phoneContact} onChange={(e) => setPhoneContact(e.target.value)} placeholder="+971..." style={inputStyle(Boolean(errors.phoneAlt))}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = errors.phoneAlt ? '#F59E0B' : '#374151'; e.currentTarget.style.boxShadow = 'none'; }} />
                  {errors.phoneAlt && <p style={errorTextStyle}>{errors.phoneAlt}</p>}
                </label>
              )}

              <label className="block mt-4">
                <span style={labelStyle}>Ваше имя или ник (опционально)</span>
                <input value={clientAlias} onChange={(e) => setClientAlias(e.target.value.slice(0, 60))} placeholder="Напр. @alex" style={inputStyle()}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.boxShadow = 'none'; }} />
              </label>
            </div>

            {/* Блок 2 — Доставка */}
            <div style={cardStyle}>
              <p className="text-sm font-semibold mb-4" style={{ color: '#F9FAFB' }}>Доставка</p>

              <label className="block mb-4">
                <span style={labelStyle}>Страна доставки *</span>
                <ButtonDropdown value={deliveryCountry} placeholder="Выберите страну" options={[...DELIVERY_COUNTRIES]} required onChange={(value) => { setDeliveryCountry(value); setDeliveryCity(''); setCityQuery(''); }} />
                {errors.deliveryCountry && <p style={errorTextStyle}>{errors.deliveryCountry}</p>}
              </label>

              <label className="block mb-4">
                <span style={labelStyle}>Город (опционально)</span>
                <div className="rounded-[14px] p-3" style={{ background: '#1F2937', border: '1px solid #374151' }}>
                  <input
                    value={cityQuery}
                    onChange={(e) => { const query = e.target.value; setCityQuery(query); if (query.trim().length >= 3) setDeliveryCity(''); }}
                    placeholder="Начните вводить минимум 3 буквы"
                    className="w-full rounded-[10px] bg-transparent px-3 py-2 text-sm outline-none"
                    style={{ color: '#F9FAFB' }}
                    onFocus={(e) => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = '#F59E0B'; (e.currentTarget.parentElement as HTMLElement).style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                    onBlur={(e) => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = '#374151'; (e.currentTarget.parentElement as HTMLElement).style.boxShadow = 'none'; }}
                  />
                  {filteredCityOptions.length > 0 && (
                    <div className="mt-2">
                      {filteredCityOptions.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => { setDeliveryCity(item); setCityQuery(item); }}
                          className="block w-full rounded-[10px] px-3 py-2 text-left text-sm transition-colors hover:bg-white/10"
                          style={{ color: deliveryCity === item ? '#F59E0B' : '#F9FAFB', background: deliveryCity === item ? 'rgba(245,158,11,0.1)' : 'transparent' }}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </label>

              <label className="block mb-4">
                <span style={labelStyle}>Лучшее время для связи (опционально)</span>
                <ButtonDropdown value={bestContactTime} placeholder="Выберите интервал" options={CONTACT_TIME_OPTIONS} onChange={setBestContactTime} />
                {errors.bestContactTime && <p style={errorTextStyle}>{errors.bestContactTime}</p>}
              </label>

              <label className="block mb-4">
                <span style={labelStyle}>Откуда вы пишете</span>
                <select
                  value={messageSource}
                  onChange={(e) => { setMessageSourceTouched(true); setMessageSource(e.target.value as Source); }}
                  style={{ ...inputStyle(), cursor: 'pointer' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  {[Source.INSTAGRAM, Source.WHATSAPP, Source.TELEGRAM, Source.TIKTOK, Source.FACEBOOK, Source.OTHER].map((item) => (
                    <option key={item} value={item} style={{ background: '#1F2937' }}>{item}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span style={labelStyle}>Комментарий (опционально)</span>
                <textarea
                  name="delivery-address-note"
                  autoComplete="off"
                  value={deliveryAddressNote}
                  onChange={(e) => setDeliveryAddressNote(e.target.value)}
                  rows={3}
                  placeholder="Комментарий к заказу"
                  style={{ width: '100%', borderRadius: '14px', border: '1px solid #374151', background: '#1F2937', padding: '14px 16px', fontSize: '16px', color: '#F9FAFB', outline: 'none', resize: 'vertical', transition: 'border-color 0.15s, box-shadow 0.15s' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.18)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </label>
            </div>
          </>
        )}

        {/* ── STEP 4: ПОДТВЕРЖДЕНИЕ ── */}
        {step === 4 && (
          <>
            {/* Summary card */}
            <div style={cardStyle}>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] mb-4" style={{ color: '#9CA3AF' }}>Проверьте данные</p>

              <div className="space-y-3">
                <div className="flex items-start justify-between rounded-[12px] px-4 py-3" style={{ background: '#1F2937' }}>
                  <div>
                    <p className="text-xs mb-1" style={{ color: '#9CA3AF' }}>Автомобиль</p>
                    <p className="text-base font-semibold" style={{ color: '#F9FAFB' }}>{[brand, model, year].filter(Boolean).join(' ') || '—'}</p>
                    {vin && <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>VIN: {vin}</p>}
                  </div>
                  <button type="button" onClick={() => goToStep(1)} className="text-xs transition-opacity hover:opacity-70" style={{ color: '#F59E0B' }}>Изменить</button>
                </div>

                <div className="flex items-start justify-between rounded-[12px] px-4 py-3" style={{ background: '#1F2937' }}>
                  <div>
                    <p className="text-xs mb-1" style={{ color: '#9CA3AF' }}>Детали</p>
                    <p className="text-base font-semibold" style={{ color: '#F9FAFB' }}>{requestedParts.filter((item) => item.name.trim()).length} {requestedParts.filter((item) => item.name.trim()).length === 1 ? 'деталь' : 'детали'}</p>
                    <div className="mt-1 space-y-0.5">
                      {requestedParts.filter((item) => item.name.trim()).map((part) => (
                        <p key={part.id} className="text-xs" style={{ color: '#6B7280' }}>• {part.name.trim()}</p>
                      ))}
                    </div>
                  </div>
                  <button type="button" onClick={() => goToStep(2)} className="text-xs transition-opacity hover:opacity-70" style={{ color: '#F59E0B' }}>Изменить</button>
                </div>

                <div className="flex items-start justify-between rounded-[12px] px-4 py-3" style={{ background: '#1F2937' }}>
                  <div>
                    <p className="text-xs mb-1" style={{ color: '#9CA3AF' }}>Доставка</p>
                    <p className="text-base font-semibold" style={{ color: '#F9FAFB' }}>{[deliveryCountry, deliveryCity].filter(Boolean).join(', ') || '—'}</p>
                  </div>
                  <button type="button" onClick={() => goToStep(3)} className="text-xs transition-opacity hover:opacity-70" style={{ color: '#F59E0B' }}>Изменить</button>
                </div>

                <div className="flex items-start justify-between rounded-[12px] px-4 py-3" style={{ background: '#1F2937' }}>
                  <div>
                    <p className="text-xs mb-1" style={{ color: '#9CA3AF' }}>Контакт</p>
                    <p className="text-base font-semibold" style={{ color: '#F9FAFB' }}>{CONTACT_CHANNEL_LABELS[preferredContactChannel]}</p>
                  </div>
                  <button type="button" onClick={() => goToStep(3)} className="text-xs transition-opacity hover:opacity-70" style={{ color: '#F59E0B' }}>Изменить</button>
                </div>
              </div>
            </div>

            {/* Priority segmented control */}
            <div style={cardStyle}>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] mb-3" style={{ color: '#9CA3AF' }}>Приоритет заявки</p>
              <div className="grid grid-cols-3 rounded-[14px] p-1 gap-1" style={{ background: '#1F2937' }}>
                {[Priority.LOW, Priority.MEDIUM, Priority.HIGH].map((priority) => (
                  <button
                    key={priority}
                    type="button"
                    onClick={() => setOrderPriority(priority)}
                    className="h-11 rounded-[10px] text-sm font-semibold transition-all"
                    style={{
                      background: orderPriority === priority ? 'linear-gradient(135deg, #F59E0B, #FCD34D)' : 'transparent',
                      color: orderPriority === priority ? '#0B1220' : '#9CA3AF',
                      border: 'none'
                    }}
                  >
                    {PRIORITY_LABELS[priority]}
                  </button>
                ))}
              </div>
            </div>

            {/* Photos preview */}
            {(vinPhotoData || carPhotoData || requestedParts.some((item) => item.photoDataList.length > 0)) && (
              <div style={cardStyle}>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] mb-3" style={{ color: '#9CA3AF' }}>Прикреплённые фото</p>
                <div className="grid grid-cols-3 gap-2">
                  {vinPhotoData && <img src={vinPhotoData} alt="vin" className="rounded-[10px] object-cover" style={{ height: '80px', width: '100%' }} />}
                  {carPhotoData && <img src={carPhotoData} alt="car" className="rounded-[10px] object-cover" style={{ height: '80px', width: '100%' }} />}
                  {requestedParts.flatMap((item) => item.photoDataList).slice(0, 6).map((photo, idx) => (
                    <img key={`confirm-photo-${idx}`} src={photo} alt="part" className="rounded-[10px] object-cover" style={{ height: '80px', width: '100%' }} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* BOTTOM ACTION BAR */}
      <div className="fixed inset-x-0 bottom-0 z-20" style={{ height: '88px', background: 'rgba(11,18,32,0.97)', borderTop: '1px solid rgba(255,255,255,0.07)', backdropFilter: 'blur(16px)' }}>
        <div className="mx-auto flex h-full w-full max-w-[640px] items-center gap-3 px-6">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1 || isSubmitting}
            className="flex items-center justify-center gap-2 rounded-[14px] text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-35 hover:bg-white/5"
            style={{ height: '56px', minWidth: '100px', border: '1px solid rgba(255,255,255,0.15)', color: '#F9FAFB', background: 'transparent' }}
          >
            <ChevronLeft className="h-4 w-4" /> Назад
          </button>

          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={goNext}
              disabled={isSubmitting}
              aria-disabled={!canContinue}
              className="flex flex-1 items-center justify-center gap-2 rounded-[14px] text-sm font-semibold transition-all disabled:cursor-not-allowed"
              style={{ height: '56px', background: canContinue ? 'linear-gradient(135deg, #F59E0B, #FCD34D)' : 'rgba(245,158,11,0.35)', color: canContinue ? '#0B1220' : '#6B7280', opacity: isSubmitting ? 0.5 : 1 }}
            >
              Далее <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(true)}
                disabled={isSubmitting || submitLockedRef.current}
                className="flex flex-1 items-center justify-center gap-2 rounded-[14px] text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
                style={{ height: '56px', background: 'linear-gradient(135deg, #F59E0B, #FCD34D)', color: '#0B1220' }}
              >
                {isSubmitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Отправка… {submitProgress}%</>
                ) : (
                  <>Отправить заявку <ArrowRight className="h-4 w-4" /></>
                )}
              </button>
              {submitController && (
                <button
                  type="button"
                  onClick={() => submitController.abort('user_cancelled')}
                  className="flex items-center justify-center gap-2 rounded-[14px] text-sm font-semibold transition-all hover:bg-white/5"
                  style={{ height: '56px', minWidth: '120px', border: '1px solid rgba(255,255,255,0.2)', color: '#9CA3AF' }}
                >
                  Отменить
                </button>
              )}
            </>
          )}
        </div>

        {isSubmitting && (
          <div className="absolute bottom-0 left-0 right-0" style={{ height: '3px' }}>
            <div style={{ height: '100%', background: 'linear-gradient(90deg, #F59E0B, #FCD34D)', width: `${submitProgress}%`, transition: 'width 0.2s ease' }} />
          </div>
        )}
      </div>

      {/* SUBMIT CONFIRM MODAL */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-[520px] rounded-[24px] p-6" style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)' }}>
            <h3 className="text-lg font-bold mb-1" style={{ color: '#F9FAFB' }}>Подтвердите отправку</h3>
            <p className="text-sm mb-4" style={{ color: '#9CA3AF' }}>Проверьте данные перед отправкой заявки</p>
            <div className="space-y-2 text-sm rounded-[14px] p-4 mb-4" style={{ background: '#1F2937', color: '#F9FAFB' }}>
              <p>Авто: <span className="font-semibold">{brand} {model} {year}</span></p>
              {vin && <p style={{ color: '#9CA3AF' }}>VIN: {vin}</p>}
              <p>Деталей: <span className="font-semibold">{requestedParts.filter((item) => item.name.trim()).length}</span></p>
              <p>Канал: <span className="font-semibold">{CONTACT_CHANNEL_LABELS[preferredContactChannel]}</span></p>
              <p>Доставка: <span className="font-semibold">{[deliveryCountry, deliveryCity].filter(Boolean).join(', ') || '—'}</span></p>
            </div>
            <label className="flex items-start gap-3 mb-5 cursor-pointer">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded"
                style={{ accentColor: '#F59E0B' }}
              />
              <span className="text-xs" style={{ color: '#9CA3AF' }}>Я согласен(на) на обработку персональных данных для связи и подбора запчастей.</span>
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(false)}
                className="flex-1 rounded-[14px] py-3 text-sm font-semibold transition-colors hover:bg-white/5"
                style={{ border: '1px solid rgba(255,255,255,0.15)', color: '#F9FAFB' }}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!consentAccepted || isSubmitting}
                onClick={() => { setShowSubmitConfirm(false); void submitOrder(); }}
                className="flex-1 rounded-[14px] py-3 text-sm font-semibold transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #F59E0B, #FCD34D)', color: '#0B1220' }}
              >
                Отправить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicOrderFormScreen;
