import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, ChevronDown, ChevronLeft, Copy, Loader2, Mic, MicOff, Search, Trash2, Upload } from 'lucide-react';
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
  1: 'Введите, пожалуйста, данные вашего автомобиля',
  2: 'Введите, какую запчасть вы ищете',
  3: 'Укажите контакты для связи и доставки',
  4: 'Проверьте данные и подтвердите отправку заявки'
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
        className="flex h-14 w-full items-center justify-between rounded-3xl border border-white/15 bg-white/10 px-5 text-left text-base outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={value ? 'text-white' : 'text-slate-300'}>{value || `${placeholder}${required ? ' *' : ''}`}</span>
        <ChevronDown className={`h-4 w-4 text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-40 mt-2 w-full rounded-2xl border border-white/15 bg-slate-900/95 p-2 shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2">
            <Search className="h-4 w-4 text-slate-300" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск..."
              className="w-full bg-transparent text-sm text-white outline-none"
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
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/10"
              >
                {item}
              </button>
            )) : <p className="px-3 py-2 text-xs text-slate-300">Ничего не найдено</p>}
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

        await logger.warn('public-form', 'Lead create failed - will save locally', {
          reason: leadResult.error,
          code: leadResult.code,
          orderId
        });

        pushNotification({
          type: NotificationType.SYNC_ERROR,
          title: '⚠️ Частичная ошибка',
          message: '⚠️ Заявка сохранена локально и будет отправлена при восстановлении соединения',
          orderId,
          source: 'web_form',
          route: `/order/${orderId}`,
          severity: 'warning'
        });
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
          socialNickname: clientAlias.trim() || undefined,
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
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black px-4 py-10 text-white">
        <div className="mx-auto w-full max-w-xl rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-[0_40px_120px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300"><Check className="h-8 w-8" /></div>
          <h1 className="text-3xl font-semibold tracking-tight">Заявка принята</h1>
          <p className="mt-2 text-slate-200">Номер заявки: <b>{createdOrderId}</b></p>
          <p className="mt-1 text-slate-300">Обычно отвечаем в течение 10–20 минут.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {whatsappPhone && <a href={`https://wa.me/${whatsappPhone}`} target="_blank" rel="noreferrer" className="rounded-2xl bg-emerald-400 px-4 py-3 text-center font-semibold text-slate-900">Перейти в WhatsApp</a>}
            <button type="button" onClick={() => navigator.clipboard.writeText(publicFormUrl)} className="rounded-2xl border border-white/25 px-4 py-3 text-sm font-semibold">Скопировать ссылку на форму</button>
            {settings.publicTelegramUrl && <a href={settings.publicTelegramUrl} target="_blank" rel="noreferrer" className="rounded-2xl border border-sky-300/40 bg-sky-400/20 px-4 py-3 text-center text-sm font-semibold text-sky-100">Telegram</a>}
            {settings.publicInstagramUrl && <a href={settings.publicInstagramUrl} target="_blank" rel="noreferrer" className="rounded-2xl border border-pink-300/40 bg-pink-400/20 px-4 py-3 text-center text-sm font-semibold text-pink-100">Instagram</a>}
          </div>
          <button type="button" onClick={() => setShowThanks(false)} className="mt-6 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900">Создать новую заявку</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black px-4 py-4 pb-32 text-white sm:py-8">
      {import.meta.env.DEV && (
        <div className="fixed top-2 right-2 z-50 text-xs font-mono bg-black/80 text-white px-3 py-2 rounded-lg">
          Cloud: {isCloudConfigured ? '✅ ON' : (cloudFeatureFlags.clientForm ? '⚠️ PARTIAL' : '❌ OFF')}
          {' | '}
          Form: {cloudFeatureFlags.clientForm ? '✅' : '❌'}
        </div>
      )}
      <div className="mx-auto w-full max-w-2xl rounded-[32px] border border-white/10 bg-white/5 p-5 shadow-[0_25px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.26em] text-slate-300">Dubai Spares Concierge</p>
          {companyLogoUrl && <img src={companyLogoUrl} alt="Company logo" className="h-10 w-auto max-w-[160px] object-contain" />}
        </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <h1 className="text-3xl font-semibold tracking-tight">{stepTitle}</h1>
                  <button type="button" onClick={startNewRequest} className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold">Начать новую заявку</button>
                </div>

        <div className="mb-6 mt-6">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-300"><span>Шаг {step} из {TOTAL_STEPS}</span><span>{Math.round(progress)}%</span></div>
          <div className="mb-2 flex gap-2 overflow-x-auto pb-2 text-xs">
            {STEP_NAMES.map((name, index) => {
              const itemStep = (index + 1) as FormStep;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => goToStep(itemStep)}
                  className={`rounded-full border px-3 py-1 whitespace-nowrap transition ${step >= itemStep ? 'border-amber-200/70 bg-amber-200/15' : 'border-white/20'}`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-yellow-100 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
        </div>

        {step < 4 && stepBlockingErrors.length > 0 && (
          <div className="mb-4 rounded-2xl border border-amber-300/40 bg-amber-200/10 px-4 py-3 text-xs text-amber-100">
            <p className="font-semibold">Заполните обязательные поля:</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {Array.from(new Set(stepBlockingErrors.map((item) => item.message))).map((message) => <li key={message}>{message}</li>)}
            </ul>
          </div>
        )}
        <div className="space-y-4 pr-1 transition-all duration-300">
          {step === 1 && (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">🚗 {brand || 'Марка'} {model || ''} {year || ''}</div>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Марка *</span>
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
                {errors.brand && <p className="mt-1 text-xs text-amber-200">{errors.brand}</p>}
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Модель *</span>
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
                  className="mt-2 text-xs font-semibold text-slate-200 underline underline-offset-2"
                >
                  {manualModelMode ? 'Выбрать модель из списка' : 'Добавить модель вручную'}
                </button>
                {(manualModelMode || (brand && modelOptions.length === 0)) && (
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Введите модель вручную"
                    className={`mt-2 h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.model ? 'border-amber-300' : 'border-white/15'}`}
                  />
                )}
                {errors.model && <p className="mt-1 text-xs text-amber-200">{errors.model}</p>}
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Год *</span>
                  <ButtonDropdown value={year} placeholder="Выберите год" options={YEARS.map((item) => String(item))} required onChange={setYear} />
                  {errors.year && <p className="mt-1 text-xs text-amber-200">{errors.year}</p>}
                </label>
                <label>
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Тип кузова (опционально)</span>
                  <input value={bodyType} onChange={(e) => setBodyType(e.target.value.slice(0, 40))} placeholder="Например: E39, F10, W212" className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.bodyType ? 'border-amber-300' : 'border-white/15'}`} />
                  {errors.bodyType && <p className="mt-1 text-xs text-amber-200">{errors.bodyType}</p>}
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">VIN (опционально)</span>
                <input value={vin} onChange={(e) => { const formatted = formatVinInput(e.target.value); setVin(formatted); if (!formatted) return; detectByVin(formatted); }} className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.vin ? 'border-amber-300' : 'border-white/15'}`} placeholder="WDB12345678901234" />
                {errors.vin && <p className="mt-1 text-xs text-amber-200">{errors.vin}</p>}
              </label>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">VIN фото (опционально, для быстрого подбора)</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => vinInputRef.current?.click()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold"><Upload className="h-4 w-4" />Галерея</button>
                  <button type="button" onClick={() => vinCameraInputRef.current?.click()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold"><Camera className="h-4 w-4" />Камера</button>
                </div>
                <input ref={vinInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setVinPhotoData); e.target.value = ''; }} />
                <input ref={vinCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setVinPhotoData); e.target.value = ''; }} />
                {vinPhotoData && <img src={vinPhotoData} alt="vin-preview" className="mt-2 h-28 w-full rounded-xl object-cover" />}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Фото автомобиля (опционально, для быстрого подбора)</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => carInputRef.current?.click()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold"><Upload className="h-4 w-4" />Галерея</button>
                  <button type="button" onClick={() => carCameraInputRef.current?.click()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold"><Camera className="h-4 w-4" />Камера</button>
                </div>
                <input ref={carInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setCarPhotoData); e.target.value = ''; }} />
                <input ref={carCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setCarPhotoData); e.target.value = ''; }} />
                {carPhotoData && <img src={carPhotoData} alt="car-preview" className="mt-2 h-28 w-full rounded-xl object-cover" />}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {showEngineCode && (
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Код двигателя (для BMW)</span>
                  <input value={engineCode} onChange={(e) => setEngineCode(e.target.value)} placeholder="Например: N52B30" className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none" />
                </label>
              )}

              {(PART_SUGGESTIONS[smartSuggestionKey] || []).length > 0 && (
                <div className="rounded-2xl border border-amber-200/30 bg-amber-200/10 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-amber-100">Популярные детали</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PART_SUGGESTIONS[smartSuggestionKey].map((item) => (
                      <button type="button" key={item} onClick={() => addRequestedPart(item)} className="rounded-full border border-amber-100/40 px-3 py-1 text-xs">{item}</button>
                    ))}
                  </div>
                </div>
              )}

              {requestedParts.map((part, index) => (
                <div key={part.id} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Деталь #{index + 1}</p>
                    <button type="button" onClick={() => setRequestedParts((current) => current.length === 1 ? [createRequestedPartInput()] : current.filter((item) => item.id !== part.id))} className="rounded-lg border border-white/20 p-1 text-slate-200"><Trash2 className="h-4 w-4" /></button>
                  </div>
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
                    placeholder="Наименование детали *"
                    className={`h-12 w-full rounded-2xl border bg-white/10 px-4 outline-none ${errors[`partName-${index}`] ? 'border-amber-300' : 'border-white/15'}`}
                  />
                  <div className="mt-2 grid gap-2">
                    <input value={part.comment} onChange={(e) => updateRequestedPart(index, { comment: e.target.value })} placeholder="Комментарий" className="h-11 rounded-2xl border border-white/15 bg-white/10 px-3 text-sm outline-none" />
                  </div>
                  {errors[`partName-${index}`] && <p className="mt-1 text-xs text-amber-200">{errors[`partName-${index}`]}</p>}
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <input id={`${part.id}-gallery`} type="file" accept="image/*" multiple onChange={(e) => { if (e.target.files?.length) { void handleFilesToDataUrls(e.target.files, (values) => { updateRequestedPart(index, { photoDataList: [...part.photoDataList, ...values].slice(0, MAX_PART_PHOTOS) }); void logger.info('public-form:media', 'Part photo attached from gallery', { partId: part.id, index, count: values.length }); }); } e.target.value = ''; }} className="hidden" />
                    <input id={`${part.id}-camera`} type="file" accept="image/*" capture="environment" onChange={(e) => { if (e.target.files?.length) { void handleFilesToDataUrls(e.target.files, (values) => { updateRequestedPart(index, { photoDataList: [...part.photoDataList, ...values].slice(0, MAX_PART_PHOTOS) }); void logger.info('public-form:media', 'Part photo attached from camera', { partId: part.id, index, count: values.length }); }); } e.target.value = ''; }} className="hidden" />
                    <label htmlFor={`${part.id}-gallery`} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 text-xs"><Upload className="h-3 w-3" />Фото ({part.photoDataList.length})</label>
                    <label htmlFor={`${part.id}-camera`} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 text-xs"><Camera className="h-3 w-3" />Камера</label>
                    {voiceEnabled && <button type="button" onClick={() => void togglePartVoiceRecording(part.id, index)} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 text-xs">{recordingPartId === part.id ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}{recordingPartId === part.id ? 'Стоп' : 'Голос'}</button>}
                  </div>
                  {recordingPartId === part.id && <div className="mt-2 flex h-5 items-end gap-1">{Array.from({ length: 18 }).map((_, waveIndex) => <span key={`${part.id}-record-${waveIndex}`} className="w-1 rounded-full bg-rose-300 transition-all" style={{ height: `${25 + Math.abs(Math.sin((recordingTick + waveIndex) * 0.8)) * 75}%` }} />)}</div>}
                  {part.photoDataList.length > 0 && (
                    <div className="mt-2 rounded-2xl border border-white/20 bg-black/20 p-2">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {part.photoDataList.map((photo, photoIndex) => (
                          <div key={`${part.id}-photo-${photoIndex}`} className="relative">
                            <img src={photo} alt={`part-${index}-preview-${photoIndex}`} className="h-24 w-full rounded-xl object-cover" />
                            <button
                              type="button"
                              onClick={() => {
                                updateRequestedPart(index, { photoDataList: part.photoDataList.filter((_, idx) => idx !== photoIndex) });
                                void logger.info('public-form:media', 'Part photo removed', { partId: part.id, index, photoIndex });
                              }}
                              className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 px-1 text-xs text-slate-300">Фото: {part.photoDataList.length}/{MAX_PART_PHOTOS}</p>
                    </div>
                  )}
                  {part.audioNote && (
                    <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 p-2">
                      <audio controls src={part.audioNote} className="h-8 w-full" />
                      <button
                        type="button"
                        onClick={() => {
                          updateRequestedPart(index, { audioNote: null });
                          void logger.info('public-form:media', 'Part audio removed', { partId: part.id, index });
                        }}
                        className="shrink-0 rounded-lg border border-white/20 px-2 py-1 text-[11px]"
                      >
                        Удалить
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {requestedParts.length < MAX_REQUEST_PART_FIELDS && <button type="button" onClick={() => addRequestedPart()} className="h-12 w-full rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold">+ Добавить ещё</button>}
            </>
          )}

          {step === 3 && (
            <>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Предпочтительный канал связи *</span>
                <select value={preferredContactChannel} onChange={(e) => switchContactChannel(e.target.value as ContactChannel)} className="h-12 w-full rounded-2xl border border-white/20 bg-white/10 px-4 text-sm outline-none">
                  <option value="whatsapp" className="text-slate-900">WhatsApp</option>
                  <option value="telegram" className="text-slate-900">Telegram</option>
                  <option value="instagram" className="text-slate-900">Instagram</option>
                  <option value="email" className="text-slate-900">E-mail</option>
                  <option value="phone" className="text-slate-900">Телефон</option>
                </select>
              </label>

              {preferredContactChannel === 'whatsapp' && (
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">WhatsApp *</span>
                  <div className="grid grid-cols-[130px_1fr] gap-2">
                    <select value={contactCountryCode} onChange={(e) => setContactCountryCode(e.target.value)} className="h-14 rounded-3xl border border-white/15 bg-white/10 px-3 text-sm outline-none">{PHONE_CODES.map((item) => <option key={item.id} value={item.code} className="text-slate-900">{item.label} {item.code}</option>)}</select>
                    <input type="tel" value={customerContact} onChange={(e) => setCustomerContact(formatPhone(e.target.value))} placeholder="901234567" className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-lg outline-none ${errors.phone ? 'border-amber-300' : 'border-white/15'}`} />
                  </div>
                  {errors.phone && <p className="mt-1 text-xs text-amber-200">{errors.phone}</p>}
                  {customerContact && <p className={`mt-1 text-xs ${isWhatsappValid ? 'text-emerald-200' : 'text-red-300'}`}>{isWhatsappValid ? 'WhatsApp номер выглядит корректно' : 'Введите номер полностью'}</p>}
                </label>
              )}

              {preferredContactChannel === 'telegram' && <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Telegram *</span><input value={telegramContact} onChange={(e) => setTelegramContact(e.target.value)} placeholder="@username" className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.telegram ? 'border-amber-300' : 'border-white/15'}`} />{errors.telegram && <p className="mt-1 text-xs text-amber-200">{errors.telegram}</p>}</label>}
              {preferredContactChannel === 'instagram' && <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Instagram</span><input value={instagramContact} onChange={(e) => setInstagramContact(e.target.value)} placeholder="@username или ссылка" className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.instagram ? 'border-amber-300' : 'border-white/15'}`} />{errors.instagram && <p className="mt-1 text-xs text-amber-200">{errors.instagram}</p>}</label>}
              {preferredContactChannel === 'email' && <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">E-mail *</span><input type="email" value={emailContact} onChange={(e) => setEmailContact(e.target.value)} placeholder="you@example.com" className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.email ? 'border-amber-300' : 'border-white/15'}`} />{errors.email && <p className="mt-1 text-xs text-amber-200">{errors.email}</p>}</label>}
              {preferredContactChannel === 'phone' && <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Телефон *</span><input type="tel" value={phoneContact} onChange={(e) => setPhoneContact(e.target.value)} placeholder="+971..." className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.phoneAlt ? 'border-amber-300' : 'border-white/15'}`} />{errors.phoneAlt && <p className="mt-1 text-xs text-amber-200">{errors.phoneAlt}</p>}</label>}

              <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Страна доставки *</span><ButtonDropdown value={deliveryCountry} placeholder="Выберите страну" options={[...DELIVERY_COUNTRIES]} required onChange={(value) => { setDeliveryCountry(value); setDeliveryCity(''); setCityQuery(''); }} />{errors.deliveryCountry && <p className="mt-1 text-xs text-amber-200">{errors.deliveryCountry}</p>}</label>

              <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Город (опционально)</span><div className="rounded-3xl border border-white/15 bg-white/10 p-3"><input value={cityQuery} onChange={(e) => { const query = e.target.value; setCityQuery(query); if (query.trim().length >= 3) setDeliveryCity(''); }} placeholder="Начните вводить минимум 3 буквы" className="h-10 w-full rounded-2xl bg-black/20 px-3 text-sm outline-none" /><div className="mt-2">{filteredCityOptions.map((item) => <button key={item} type="button" onClick={() => { setDeliveryCity(item); setCityQuery(item); }} className={`block w-full rounded-xl px-3 py-2 text-left text-sm ${deliveryCity === item ? 'bg-amber-200/20 text-amber-100' : 'hover:bg-white/10'}`}>{item}</button>)}</div></div></label>

              <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Лучшее время для связи (опционально)</span><ButtonDropdown value={bestContactTime} placeholder="Выберите интервал" options={CONTACT_TIME_OPTIONS} onChange={setBestContactTime} />{errors.bestContactTime && <p className="mt-1 text-xs text-amber-200">{errors.bestContactTime}</p>}</label>
              <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Ваше имя или ник (опционально)</span><input value={clientAlias} onChange={(e) => setClientAlias(e.target.value.slice(0, 60))} placeholder="Напр. @alex" className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none" /></label>
              <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Откуда вы пишете</span><select value={messageSource} onChange={(e) => { setMessageSourceTouched(true); setMessageSource(e.target.value as Source); }} className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none">{[Source.INSTAGRAM, Source.WHATSAPP, Source.TELEGRAM, Source.TIKTOK, Source.FACEBOOK, Source.OTHER].map((item) => <option key={item} value={item} className="text-slate-900">{item}</option>)}</select></label>
              <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Комментарий (опционально)</span><textarea name="delivery-address-note" autoComplete="off" value={deliveryAddressNote} onChange={(e) => setDeliveryAddressNote(e.target.value)} rows={3} placeholder="Комментарий к заказу" className="w-full rounded-[28px] border border-white/15 bg-white/10 px-5 py-4 text-base outline-none" /></label>
            </>
          )}

          {step === 4 && (
            <div className="rounded-3xl border border-amber-200/30 bg-gradient-to-br from-amber-100/15 via-white/10 to-transparent p-5">
              <p className="text-xl font-black tracking-tight">{brand} {model} {year}</p>
              <p className="mt-3 text-sm">🧩 {requestedParts.filter((item) => item.name.trim()).length} детали</p>
              <p className="text-sm">🌍 Доставка: {deliveryCountry || '—'} {deliveryCity ? `(${deliveryCity})` : ''}</p>
              <p className="text-sm">Контакт: {CONTACT_CHANNEL_LABELS[preferredContactChannel]}</p>
              <p className="text-sm">VIN: {vin || 'VIN не указан'}</p>
              <p className="text-sm">Приоритет: {PRIORITY_LABELS[orderPriority]}</p>

              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200">Приоритет заявки</p>
                <div className="grid grid-cols-3 gap-2">
                  {[Priority.LOW, Priority.MEDIUM, Priority.HIGH].map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      onClick={() => setOrderPriority(priority)}
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${orderPriority === priority ? 'border-amber-200 bg-amber-200/20 text-amber-100' : 'border-white/20 text-slate-200 hover:bg-white/10'}`}
                    >
                      {PRIORITY_LABELS[priority]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 space-y-2 text-xs text-slate-100">
                <p className="font-semibold">Детали:</p>
                {requestedParts.filter((item) => item.name.trim()).map((part) => (
                  <div key={part.id} className="rounded-xl border border-white/15 bg-black/20 p-2">
                    <p>{part.name.trim()}</p>
                    <p className="text-slate-300">Комментарий: {part.comment?.trim() || '—'}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2 text-xs text-slate-100">
                <p className="font-semibold">Фото:</p>
                <div>
                  <p className="mb-1">VIN фото</p>
                  {vinPhotoData ? <img src={vinPhotoData} alt="vin-preview" className="h-20 w-28 rounded-lg object-cover" /> : <p className="text-slate-300">Фото не добавлено</p>}
                </div>
                <div>
                  <p className="mb-1">Фото авто</p>
                  {carPhotoData ? <img src={carPhotoData} alt="car-preview" className="h-20 w-28 rounded-lg object-cover" /> : <p className="text-slate-300">Фото не добавлено</p>}
                </div>
                <div>
                  <p className="mb-1">Фото деталей</p>
                  {requestedParts.some((item) => (item.photoDataList || []).length > 0) ? (
                    <div className="grid grid-cols-3 gap-2">
                      {requestedParts.flatMap((item) => (item.photoDataList || []).map((photo, idx) => (
                        <img key={`${item.id}-confirm-${idx}`} src={photo} alt="part-preview" className="h-16 w-full rounded-lg object-cover" />
                      )))}
                    </div>
                  ) : <p className="text-slate-300">Фото не добавлено</p>}
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-xs text-slate-200">
                <button type="button" onClick={() => goToStep(1)} className="rounded-xl border border-white/20 px-3 py-2 text-left">Редактировать автомобиль</button>
                <button type="button" onClick={() => goToStep(2)} className="rounded-xl border border-white/20 px-3 py-2 text-left">Редактировать детали</button>
                <button type="button" onClick={() => goToStep(3)} className="rounded-xl border border-white/20 px-3 py-2 text-left">Редактировать контакты</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3">
          <button type="button" onClick={goBack} disabled={step === 1 || isSubmitting} className="flex h-12 min-w-[120px] items-center justify-center gap-2 rounded-full border border-white/20 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-35"><ChevronLeft className="h-4 w-4" />Назад</button>
          {step < TOTAL_STEPS ? (
          <button type="button" onClick={goNext} disabled={isSubmitting} aria-disabled={!canContinue} className={`flex h-12 min-w-[160px] items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition ${canContinue ? 'bg-white text-slate-950' : 'bg-white/70 text-slate-700'} disabled:cursor-not-allowed disabled:opacity-40`}>Далее<ArrowRight className="h-4 w-4" /></button>
          ) : (
            <>
              <button type="button" onClick={() => setShowSubmitConfirm(true)} disabled={isSubmitting || submitLockedRef.current} className="flex h-12 min-w-[180px] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-amber-200 to-white px-6 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-40">{isSubmitting ? (<><Loader2 className="h-4 w-4 animate-spin" />Отправка... {submitProgress}%</>) : (<>Подтвердить заявку<Copy className="h-4 w-4" /></>)}</button>
              {submitController && <button type="button" onClick={() => submitController.abort('user_cancelled')} className="flex h-12 min-w-[160px] items-center justify-center gap-2 rounded-full border border-white/40 px-6 text-sm font-semibold text-white">Отменить отправку</button>}
            </>
          )}
        </div>
        {isSubmitting && (
          <div className="mx-auto mt-3 w-full max-w-2xl rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-200">
              <span>Отправляем заявку, пожалуйста подождите…</span>
              <span>{submitProgress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-yellow-100 transition-all duration-200" style={{ width: `${submitProgress}%` }} />
            </div>
          </div>
        )}
      </div>

      {showSubmitConfirm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-3xl border border-white/20 bg-slate-900 p-5">
            <h3 className="text-lg font-bold">Подтвердите отправку заявки</h3>
            <div className="mt-3 space-y-1 text-sm text-slate-200">
              <p>Авто: {brand} {model} {year}</p>
              <p>VIN: {vin || 'VIN не указан'}</p>
              <p>Деталей: {requestedParts.filter((item) => item.name.trim()).length}</p>
              <p>Канал: {CONTACT_CHANNEL_LABELS[preferredContactChannel]}</p>
              <p>Страна/город: {deliveryCountry || '—'} {deliveryCity || ''}</p>
            </div>
            <label className="mt-4 flex items-start gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={consentAccepted} onChange={(e) => setConsentAccepted(e.target.checked)} className="mt-0.5" />
              <span>Я согласен(на) на обработку персональных данных для связи и подбора запчастей.</span>
            </label>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowSubmitConfirm(false)} className="flex-1 rounded-2xl border border-white/20 px-3 py-2 text-sm">Отмена</button>
              <button type="button" disabled={!consentAccepted || isSubmitting} onClick={() => { setShowSubmitConfirm(false); void submitOrder(); }} className="flex-1 rounded-2xl bg-amber-200 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-40">Отправить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicOrderFormScreen;
