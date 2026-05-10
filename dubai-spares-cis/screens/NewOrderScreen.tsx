import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, ChevronDown, Mic, Square, Play, Pause, UserRound, Wrench, CarFront, ImagePlus, NotebookPen, Save, Trash2, ClipboardPaste } from 'lucide-react';
import { BRAND_MODELS, BRANDS, DEFAULT_MARKUP, DEFAULT_RATE } from '../constants';
import { CHASSIS_BODY_TYPES_BY_BRAND } from '../carDatabase';
import { useStore } from '../store';
import { Order, Priority, Source } from '../types';
import { logger } from '../logging';
import { optimizeImageForUpload } from '../storage/photos';
import { toast } from '../feedback';
import { readClipboardImageFiles } from '../utils/clipboardImages';

type VinDecoded = {
  brand?: string;
  model?: string;
  year?: string;
};

type Mode = 'quick' | 'full';

type DropdownOption = {
  label: string;
  value: string;
};

type DraftGroupItem = {
  id: string;
  name: string;
  quantity: string;
};

type DraftPart = {
  id: string;
  partKind: 'single' | 'group';
  name: string;
  comment: string;
  photos: string[];
  groupItems: DraftGroupItem[];
};

type DraftNote = {
  id: string;
  text: string;
  photos: string[];
  voices: string[];
};

const POPULAR_BRANDS = ['BMW', 'Mercedes-Benz', 'Toyota', 'Lexus', 'Nissan', 'Hyundai', 'Kia', 'Audi', 'Volkswagen'];
const BODY_TYPE_OPTIONS = ['Седан', 'Кроссовер', 'Купе', 'Хэтчбек', 'Универсал', 'SUV', 'Пикап', 'Минивэн', 'Кабриолет', 'Фургон'];

const VIN_BRAND_MAP: Record<string, string> = {
  JT: 'Toyota',
  JN: 'Nissan',
  WA: 'Audi',
  WV: 'Volkswagen',
  WB: 'BMW',
  WDB: 'Mercedes-Benz',
  KM: 'Hyundai',
  KN: 'Kia'
};

const VIN_YEAR_MAP: Record<string, string> = {
  R: '2024', P: '2023', N: '2022', M: '2021', L: '2020', K: '2019', J: '2018', H: '2017',
  G: '2016', F: '2015', E: '2014', D: '2013', C: '2012', B: '2011', A: '2010'
};

const decodeVin = (rawVin: string): VinDecoded | null => {
  const vin = rawVin.trim().toUpperCase();
  if (vin.length < 8) return null;
  const brand = VIN_BRAND_MAP[vin.slice(0, 3)] || VIN_BRAND_MAP[vin.slice(0, 2)];
  const year = VIN_YEAR_MAP[vin[9]];
  if (!brand && !year) return null;
  return { brand, year };
};

const inferWhatsappLanguage = (country: string, customerContact: string): 'ru' | 'en' | 'ar' => {
  const normalizedCountry = country.trim().toLowerCase();
  const normalizedPhone = customerContact.replace(/\s+/g, '');

  if ([
    'россия', 'таджикистан', 'узбекистан', 'казахстан', 'кыргызстан', 'беларусь', 'украина'
  ].some((item) => normalizedCountry.includes(item))) return 'ru';
  if ([
    'uae', 'оаэ', 'dubai', 'abu dhabi', 'saudi', 'oman', 'qatar', 'bahrain', 'kuwait', 'egypt'
  ].some((item) => normalizedCountry.includes(item))) return 'ar';

  if (normalizedPhone.startsWith('+7') || normalizedPhone.startsWith('+992') || normalizedPhone.startsWith('+998') || normalizedPhone.startsWith('+996')) return 'ru';
  if (normalizedPhone.startsWith('+971') || normalizedPhone.startsWith('+966') || normalizedPhone.startsWith('+968') || normalizedPhone.startsWith('+974') || normalizedPhone.startsWith('+973') || normalizedPhone.startsWith('+965') || normalizedPhone.startsWith('+20')) return 'ar';

  return 'en';
};

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

const createDraftGroupItem = (suffix?: string): DraftGroupItem => ({
  id: `${createId()}${suffix ? `-${suffix}` : ''}`,
  name: '',
  quantity: '1'
});

const createDraftPart = (): DraftPart => ({
  id: createId(),
  partKind: 'single',
  name: '',
  comment: '',
  photos: [],
  groupItems: [createDraftGroupItem()]
});

const createDraftNote = (): DraftNote => ({
  id: createId(),
  text: '',
  photos: [],
  voices: []
});


const DRAFTS_LIST_KEY = 'new-order-drafts-list-v1';

const normalizeDraftList = (items: unknown): Array<{ id: string; createdAt: number; title: string; data: ReturnType<typeof toPersistableDraft> }> => {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items
    .filter((item): item is { id?: string; createdAt?: number; title?: string; data?: ReturnType<typeof toPersistableDraft> } => !!item && typeof item === 'object')
    .map((item) => {
      const id = String(item.id || createId());
      const createdAt = Number(item.createdAt || Date.now());
      const title = String(item.title || 'Черновик без названия');
      const data = toPersistableDraft({
        mode: item.data?.mode || 'quick',
        vin: item.data?.vin || '',
        brand: item.data?.brand || '',
        model: item.data?.model || '',
        year: item.data?.year || '',
        bodyType: item.data?.bodyType || '',
        seriesCode: item.data?.seriesCode || '',
        parts: Array.isArray(item.data?.parts) && item.data?.parts.length ? item.data.parts : [createDraftPart()],
        notes: Array.isArray(item.data?.notes) && item.data?.notes.length ? item.data.notes : [createDraftNote()],
        clientName: item.data?.clientName || '',
        contactValue: item.data?.contactValue || item.data?.customerContact || '',
        leadSource: (item.data?.leadSource || item.data?.source || Source.WHATSAPP) as Source
      });
      return { id, createdAt, title, data };
    })
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 8);
};

const toPersistableDraft = (payload: {
  mode: Mode;
  vin: string;
  brand: string;
  model: string;
  year: string;
  bodyType: string;
  seriesCode: string;
  parts: Array<Partial<DraftPart> & { id?: string }>;
  notes: DraftNote[];
  clientName: string;
  contactValue: string;
  leadSource: Source;
}) => ({
  ...payload,
  parts: (payload.parts || []).map((part) => ({
    id: String(part.id || createId()),
    partKind: part.partKind === 'group' ? 'group' : 'single',
    name: String(part.name || ''),
    comment: String(part.comment || ''),
    photos: [],
    groupItems: Array.isArray((part as DraftPart).groupItems) && (part as DraftPart).groupItems.length
      ? (part as DraftPart).groupItems.map((item) => ({
        id: String(item.id || createId()),
        name: String(item.name || ''),
        quantity: String(item.quantity || '1')
      }))
      : [createDraftGroupItem()]
  })),
  notes: (payload.notes || []).map((note) => ({ ...note, photos: [], voices: [] }))
});

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
};

const inputClass = 'h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-100';

const cardClass = 'space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200';

const SearchableDropdown: React.FC<{
  value: string;
  placeholder: string;
  disabled?: boolean;
  options: DropdownOption[];
  loading?: boolean;
  required?: boolean;
  noOptionsText?: string;
  onChange: (value: string) => void;
}> = ({ value, placeholder, disabled, options, loading, required, noOptionsText = 'Нет доступных вариантов', onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalized));
  }, [options, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHighlighted(0);
    }
  }, [open]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-required={required}
        onClick={() => setOpen((prev) => !prev)}
        className={`${inputClass} relative flex items-center justify-between text-left disabled:cursor-not-allowed disabled:bg-slate-100`}
      >
        <span className={value ? 'text-slate-900' : 'text-slate-400'}>{value || placeholder}</span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-[60] mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlighted((prev) => Math.min(prev + 1, Math.max(filteredOptions.length - 1, 0)));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlighted((prev) => Math.max(prev - 1, 0));
              }
              if (event.key === 'Enter' && filteredOptions[highlighted]) {
                event.preventDefault();
                setOpen(false);
                onChange(filteredOptions[highlighted].value);
              }
              if (event.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder="Поиск..."
            className="mb-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-300"
          />
          {loading ? (
            <div className="space-y-2 p-1">
              <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : (
            <div className="max-h-52 overflow-y-auto">
              {filteredOptions.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                    onChange(option.value);
                  }}
                  className={`flex w-full items-center rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 ${highlighted === index ? 'bg-slate-100' : ''}`}
                >
                  {option.label}
                </button>
              ))}
              {filteredOptions.length === 0 && <p className="px-2 py-2 text-xs text-slate-500">{noOptionsText}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const NewOrderScreen: React.FC = () => {
  const navigate = useNavigate();
  const { addOrder, isSyncing } = useStore();

  const [mode, setMode] = useState<Mode>('quick');
  const [vin, setVin] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [bodyType, setBodyType] = useState('');
  const [seriesCode, setSeriesCode] = useState('');

  const [parts, setParts] = useState<DraftPart[]>([createDraftPart()]);
  const [notes, setNotes] = useState<DraftNote[]>([createDraftNote()]);

  const [clientName, setClientName] = useState('');
  const [contactValue, setContactValue] = useState('');
  const [leadSource, setLeadSource] = useState<Source>(Source.WHATSAPP);

  const [carPhotos, setCarPhotos] = useState<string[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedDrafts, setSavedDrafts] = useState<Array<{ id: string; createdAt: number; title: string; data: ReturnType<typeof toPersistableDraft> }>>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [brandLoading, setBrandLoading] = useState(true);
  const [modelLoading, setModelLoading] = useState(false);
  const [manualModelMode, setManualModelMode] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [recordingNoteId, setRecordingNoteId] = useState<string | null>(null);
  const [recordingTick, setRecordingTick] = useState(0);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const submitLockRef = useRef(false);

  const partPhotoRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const notePhotoRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const carGalleryRef = useRef<HTMLInputElement>(null);
  const carCameraRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const touched = useRef({ brand: false, model: false, year: false });

  const modelOptions = useMemo(() => {
    const base = brand ? BRAND_MODELS[brand] || [] : Array.from(new Set(Object.values(BRAND_MODELS).flat()));
    return base.sort((a, b) => a.localeCompare(b)).map((item) => ({ label: item, value: item }));
  }, [brand]);

  const brandOptions = useMemo(() => {
    const popularSet = new Set(POPULAR_BRANDS);
    const popular = POPULAR_BRANDS.filter((item) => BRANDS.includes(item)).map((item) => ({ label: `⭐ ${item}`, value: item }));
    const rest = BRANDS.filter((item) => !popularSet.has(item)).map((item) => ({ label: item, value: item }));
    return [...popular, ...rest];
  }, []);

  const chassisCodes = useMemo(
    () => (brand ? (CHASSIS_BODY_TYPES_BY_BRAND[brand] || []).map((item) => ({ label: item, value: item })) : []),
    [brand]
  );

  const bodyTypeOptions = useMemo(() => {
    const fromDb = (CHASSIS_BODY_TYPES_BY_BRAND[brand] || []).map((item) => ({ label: item, value: item }));
    const fallback = BODY_TYPE_OPTIONS.map((item) => ({ label: item, value: item }));
    return Array.from(new Map([...fromDb, ...fallback].map((item) => [item.value, item])).values());
  }, [brand]);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1979 }, (_, index) => String(currentYear - index));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setBrandLoading(false), 220);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!brand) return;
    setModelLoading(true);
    const timer = window.setTimeout(() => setModelLoading(false), 180);
    return () => window.clearTimeout(timer);
  }, [brand]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const onResize = () => {
      const offset = Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop));
      setKeyboardOffset(offset);
    };

    viewport.addEventListener('resize', onResize);
    viewport.addEventListener('scroll', onResize);
    onResize();

    return () => {
      viewport.removeEventListener('resize', onResize);
      viewport.removeEventListener('scroll', onResize);
    };
  }, []);

  useEffect(() => {
    if (!manualModelMode && model && modelOptions.length > 0 && !modelOptions.map((item) => item.value).includes(model)) {
      setModel('');
    }
  }, [manualModelMode, model, modelOptions]);

  const applyDraft = (d: ReturnType<typeof toPersistableDraft>) => {
    setMode(d.mode || 'quick');
    setVin(d.vin || '');
    setBrand(d.brand || '');
    setModel(d.model || '');
    setYear(d.year || '');
    setBodyType(d.bodyType || '');
    setSeriesCode(d.seriesCode || '');
    setParts(
      Array.isArray(d.parts) && d.parts.length
        ? d.parts.map((part) => ({
          id: String(part.id || createId()),
          partKind: part.partKind === 'group' ? 'group' : 'single',
          name: String(part.name || ''),
          comment: String(part.comment || ''),
          photos: Array.isArray((part as DraftPart).photos) ? (part as DraftPart).photos : [],
          groupItems: Array.isArray((part as DraftPart).groupItems) && (part as DraftPart).groupItems.length
            ? (part as DraftPart).groupItems.map((item) => ({
              id: String(item.id || createId()),
              name: String(item.name || ''),
              quantity: String(item.quantity || '1')
            }))
            : [createDraftGroupItem()]
        }))
        : [createDraftPart()]
    );
    setNotes(Array.isArray(d.notes) && d.notes.length ? d.notes : [createDraftNote()]);
    setClientName(d.clientName || '');
    setContactValue(d.contactValue || '');
    setLeadSource(d.leadSource || Source.WHATSAPP);
  };

  useEffect(() => {
    const saved = localStorage.getItem('new-order-draft-v2');
    const savedList = localStorage.getItem(DRAFTS_LIST_KEY);
    if (savedList) {
      try {
        setSavedDrafts(normalizeDraftList(JSON.parse(savedList)));
      } catch {
        setSavedDrafts([]);
      }
    }
    if (!saved) return;
    try {
      applyDraft(JSON.parse(saved));
    } catch {
      // noop
    }
  }, []);


  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DRAFTS_LIST_KEY) return;
      try {
        setSavedDrafts(normalizeDraftList(JSON.parse(event.newValue || '[]')));
      } catch {
        setSavedDrafts([]);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const draftData = toPersistableDraft({ mode, vin, brand, model, year, bodyType, seriesCode, parts, notes, clientName, contactValue, leadSource });
    localStorage.setItem('new-order-draft-v2', JSON.stringify(draftData));
  }, [mode, vin, brand, model, year, bodyType, seriesCode, parts, notes, clientName, contactValue, leadSource]);

  useEffect(() => {
    const decoded = decodeVin(vin);
    if (!vin) return;
    if (!decoded) {
      void logger.warn('create-order', 'vin_decode_fail', { vinLength: vin.trim().length });
      return;
    }
    void logger.info('create-order', 'vin_decode_success', { decoded });
    if (decoded.brand && !touched.current.brand) setBrand((prev) => prev || decoded.brand || '');
    if (decoded.model && !touched.current.model) setModel((prev) => prev || decoded.model || '');
    if (decoded.year && !touched.current.year) setYear((prev) => prev || decoded.year || '');
  }, [vin]);

  const validate = () => {
    const next: Record<string, string> = {};
    const currentYear = new Date().getFullYear();
    const parsedYear = Number(year.trim());
    const hasAnyPart = parts.some((item) => (
      item.partKind === 'group'
        ? item.groupItems.some((g) => g.name.trim())
        : item.name.trim()
    ));
    const rawContact = contactValue.trim();
    const isPhone = /^\+[0-9]{9,15}$/.test(rawContact);
    const isUrl = /^https?:\/\//i.test(rawContact);
    const isHandle = /^@?[A-Za-z0-9._]{2,}$/.test(rawContact);
    const isTelegramHandle = /^@?[A-Za-z0-9_]{2,}$/.test(rawContact);
    if (!brand.trim()) next.brand = 'Марка обязательна';
    if (!model.trim()) next.model = 'Модель обязательна';
    if (!year.trim() || !/^\d{4}$/.test(year.trim()) || parsedYear < 1980 || parsedYear > currentYear) next.year = `Год должен быть в диапазоне 1980-${currentYear}`;
    if (!hasAnyPart) next.partName = 'Добавьте хотя бы одну деталь';
    if (vin.trim() && vin.trim().length !== 17) next.vin = 'VIN должен быть 17 символов';
    if (rawContact) {
      if (leadSource === Source.WHATSAPP) {
        if (!isPhone) next.contactValue = 'Телефон: +код и 9–15 цифр без пробелов';
      } else if (leadSource === Source.INSTAGRAM || leadSource === Source.TIKTOK || leadSource === Source.FACEBOOK) {
        if (!isUrl && !isHandle) next.contactValue = 'Укажите ссылку (https://...) или @username';
      } else if (leadSource === Source.TELEGRAM) {
        if (!isUrl && !isTelegramHandle && !isPhone) next.contactValue = 'Укажите ссылку (https://t.me/...) или @username';
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      void logger.warn('create-order', 'create_order_validation_error', { errors: next });
    }
    return next;
  };

  const canCreate = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const parsedYear = Number(year.trim());
    const hasAnyPart = parts.some((item) => (
      item.partKind === 'group'
        ? item.groupItems.some((g) => g.name.trim())
        : item.name.trim()
    ));
    const rawContact = contactValue.trim();
    const isPhone = /^\+[0-9]{9,15}$/.test(rawContact);
    const isUrl = /^https?:\/\//i.test(rawContact);
    const isHandle = /^@?[A-Za-z0-9._]{2,}$/.test(rawContact);
    const isTelegramHandle = /^@?[A-Za-z0-9_]{2,}$/.test(rawContact);
    const contactOk = !rawContact
      ? true
      : leadSource === Source.WHATSAPP
        ? isPhone
        : leadSource === Source.INSTAGRAM || leadSource === Source.TIKTOK || leadSource === Source.FACEBOOK
          ? (isUrl || isHandle)
          : leadSource === Source.TELEGRAM
            ? (isUrl || isTelegramHandle || isPhone)
            : true;
    return !!brand.trim()
      && !!model.trim()
      && /^\d{4}$/.test(year.trim())
      && parsedYear >= 1980
      && parsedYear <= currentYear
      && hasAnyPart
      && (!vin.trim() || vin.trim().length === 17)
      && contactOk;
  }, [brand, model, year, parts, vin, contactValue, leadSource]);

  useEffect(() => {
    if (!recordingNoteId) return;
    const timer = window.setInterval(() => setRecordingTick((prev) => prev + 1), 280);
    return () => window.clearInterval(timer);
  }, [recordingNoteId]);

  useEffect(() => () => {
    recorderRef.current?.stop();
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const toggleNoteRecording = async (noteId: string) => {
    if (recordingNoteId === noteId) {
      recorderRef.current?.stop();
      setRecordingNoteId(null);
      return;
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderStreamRef.current = null;
      setRecordingNoteId(null);
    }

    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorderStreamRef.current = stream;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const audioData = String(reader.result || '');
          if (!audioData) return;
          setNotes((prev) => prev.map((note) => (
            note.id === noteId ? { ...note, voices: [...note.voices, audioData] } : note
          )));
        };
        reader.readAsDataURL(blob);
        recorderRef.current = null;
        recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
        recorderStreamRef.current = null;
        setRecordingNoteId((current) => (current === noteId ? null : current));
      };

      recorder.start();
      setRecordingNoteId(noteId);
    } catch {
      // noop
    }
  };

  const toggleVoicePlayback = (voiceId: string) => {
    const audioEl = document.getElementById(voiceId) as HTMLAudioElement | null;
    if (!audioEl) return;
    if (playingVoiceId === voiceId) {
      audioEl.pause();
      setPlayingVoiceId(null);
      return;
    }
    if (playingVoiceId) {
      const prev = document.getElementById(playingVoiceId) as HTMLAudioElement | null;
      prev?.pause();
    }
    void audioEl.play();
    setPlayingVoiceId(voiceId);
    audioEl.onended = () => setPlayingVoiceId(null);
  };

  const attachCompressedImages = async (
    files: FileList | File[] | null,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    maxCount = 10,
    labelPrefix = 'new-order:image'
  ) => {
    const selected = Array.from(files || []);
    if (!selected.length) return;

    await logger.info('ui:new-order:images', 'image_batch_started', {
      labelPrefix,
      selectedCount: selected.length,
      maxCount
    });

    const prepared: string[] = [];
    for (const file of selected) {
      try {
        const compressed = await optimizeImageForUpload(file, `${labelPrefix}:${file.name}`);
        prepared.push(compressed);
        await logger.debug('ui:new-order:images', 'image_prepared', {
          labelPrefix,
          fileName: file.name,
          fileSizeBytes: file.size,
          fileType: file.type,
          source: 'optimized'
        });
      } catch (error) {
        await logger.warn('ui:new-order:images', 'image_optimization_failed_using_fallback', {
          labelPrefix,
          fileName: file.name,
          fileSizeBytes: file.size,
          fileType: file.type,
          error: serializeError(error)
        });

        await new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            prepared.push(String(reader.result || ''));
            resolve();
          };
          reader.onerror = async () => {
            await logger.error('ui:new-order:images', 'image_file_reader_failed', {
              labelPrefix,
              fileName: file.name,
              fileSizeBytes: file.size,
              fileType: file.type,
              error: serializeError(reader.error)
            });
            resolve();
          };
          reader.readAsDataURL(file);
        });
      }
    }

    try {
      setter((prev) => [...prev, ...prepared].slice(0, maxCount));
      await logger.info('ui:new-order:images', 'image_batch_completed', {
        labelPrefix,
        selectedCount: selected.length,
        preparedCount: prepared.length,
        maxCount
      });
    } catch (error) {
      await logger.error('ui:new-order:images', 'image_batch_state_update_failed', {
        labelPrefix,
        selectedCount: selected.length,
        preparedCount: prepared.length,
        error: serializeError(error)
      });
      throw error;
    }
  };

  const attachImagesFromClipboard = async (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    labelPrefix: string
  ) => {
    try {
      const files = await readClipboardImageFiles();
      if (!files.length) {
        toast('В буфере обмена нет изображений', 'error');
        return;
      }
      await attachCompressedImages(files, setter, 10, `${labelPrefix}:clipboard`);
      toast(`Вставлено фото: ${files.length}`, 'success');
    } catch (error) {
      await logger.warn('ui:new-order:images', 'clipboard_attach_failed', {
        labelPrefix,
        error: serializeError(error)
      });
      toast('Не удалось получить фото из буфера. Разрешите доступ к буферу обмена и попробуйте снова.', 'error');
    }
  };


  const resetForm = () => {
    setVin('');
    setBrand('');
    setModel('');
    setYear('');
    setBodyType('');
    setSeriesCode('');
    setParts([createDraftPart()]);
    setNotes([createDraftNote()]);
    setClientName('');
    setContactValue('');
    setLeadSource(Source.WHATSAPP);
    setCarPhotos([]);
    setErrors({});
  };

  const saveDraft = () => {
    const data = toPersistableDraft({ mode, vin, brand, model, year, bodyType, seriesCode, parts, notes, clientName, contactValue, leadSource });
    const next = [{
      id: createId(),
      createdAt: Date.now(),
      title: `${brand || 'Без марки'} ${model || ''}`.trim() || 'Черновик без названия',
      data
    }, ...savedDrafts].slice(0, 8);
    setSavedDrafts(next);
    localStorage.setItem(DRAFTS_LIST_KEY, JSON.stringify(next));
    toast('Черновик сохранен', 'success');
  };

  const toggleDraftSelection = (draftId: string) => {
    setSelectedDraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(draftId)) next.delete(draftId);
      else next.add(draftId);
      return next;
    });
  };

  const deleteDrafts = (draftIds: string[]) => {
    if (!draftIds.length) return;
    const next = savedDrafts.filter((item) => !draftIds.includes(item.id));
    setSavedDrafts(next);
    setSelectedDraftIds((prev) => {
      const updated = new Set(prev);
      draftIds.forEach((id) => updated.delete(id));
      return updated;
    });
    localStorage.removeItem(DRAFTS_LIST_KEY);
    localStorage.setItem(DRAFTS_LIST_KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent('storage', { key: DRAFTS_LIST_KEY, newValue: JSON.stringify(next) }));
    toast(`Удалено черновиков: ${draftIds.length}`, 'success');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || submitLockRef.current) return;

    submitLockRef.current = true;
    void logger.info('create-order', 'create_order_start', { source: 'manual', mode });

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      const missing = Object.values(validationErrors).slice(0, 3).join('; ');
      toast(missing || 'Заполните обязательные поля', 'error');
      submitLockRef.current = false;
      return;
    }

    if ('vibrate' in navigator) {
      navigator.vibrate(20);
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderStreamRef.current = null;
      setRecordingNoteId(null);
    }

    const now = Date.now();
    const params = new URLSearchParams(window.location.search);
    const fromLead = params.get('from') === 'lead';

    const rawContact = contactValue.trim();
    const looksLikePhone = /^\+[0-9]{9,15}$/.test(rawContact);
    const whatsappTemplateLanguage = inferWhatsappLanguage('', looksLikePhone ? rawContact : '');
    const resolvedCustomerContact = leadSource === Source.WHATSAPP || looksLikePhone ? rawContact : '';
    const resolvedSocialNickname = leadSource !== Source.WHATSAPP && !looksLikePhone ? rawContact : '';
    const preparedParts = parts
      .map((draft) => {
        const kind = draft.partKind === 'group' ? 'group' : 'single';
        const hasSingleName = kind === 'single' && !!draft.name.trim();
        const normalizedGroupItems = kind === 'group'
          ? draft.groupItems
            .map((item) => ({
              name: item.name.trim(),
              quantity: Math.max(1, Number(String(item.quantity || '').replace(/[^\d]/g, '') || 1))
            }))
            .filter((item) => !!item.name)
          : [];
        const hasGroupItems = kind === 'group' && normalizedGroupItems.length > 0;

        if (!hasSingleName && !hasGroupItems) return null;

        return {
          kind,
          name: draft.name.trim(),
          comment: draft.comment.trim(),
          photos: draft.photos,
          groupItems: normalizedGroupItems.map((item, index) => ({ id: `new-group-${draft.id}-${index}`, ...item }))
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const order: Order = {
      id: createId(),
      brand: brand.trim(),
      model: model.trim(),
      year: year.trim(),
      bodyType: bodyType.trim(),
      vin: vin.trim(),
      priority: Priority.MEDIUM,
      clientName: clientName.trim(),
      source: leadSource,
      customerContact: resolvedCustomerContact,
      carPhotos,
      carPhotoUrl: carPhotos[0],
      parts: preparedParts.map((part) => ({
        id: createId(),
        name: part.name,
        partKind: part.kind,
        groupItems: part.kind === 'group' ? part.groupItems : [],
        comment: part.comment,
        photos: part.photos,
        photoUrl: part.photos[0],
        variants: [],
        isFound: false
      })),
      markupPercent: DEFAULT_MARKUP,
      exchangeRate: DEFAULT_RATE,
      clientCurrency: 'AED',
      createdAt: now,
      isArchived: false,
      isSold: false,
      isLead: fromLead,
      leadUnread: fromLead,
      leadSource: fromLead ? 'public_form' : 'manual',
      notes: [
        ...notes
          .filter((note) => note.text.trim() || note.photos.length > 0 || note.voices.length > 0)
          .map((note) => ({
            id: createId(),
            text: [
              note.text.trim(),
              ...note.voices.map((_, index) => `Аудио ${index + 1}`)
            ].filter(Boolean).join('\n'),
            photos: note.photos,
            audios: note.voices,
            createdAt: now
          })),
        ...(seriesCode.trim() ? [{ id: createId(), text: `Series/Code: ${seriesCode.trim()}`, createdAt: now }] : [])
      ],
      socialNickname: resolvedSocialNickname || undefined,
      whatsappTemplateLanguage
    };

    setIsSubmitting(true);
    try {
      const ok = await addOrder(order);
      if (!ok) {
        await logger.warn('create-order', 'create_order_store_rejected', { orderId: order.id, mode });
        toast('Не удалось создать заказ. Проверьте соединение и попробуйте снова.', 'error');
        return;
      }

      localStorage.removeItem('new-order-draft-v2');
      void logger.info('create-order', 'create_order_success', { orderId: order.id });
      toast(`Заказ создан: #${order.id.slice(0, 8)}`, 'success');
      resetForm();
      navigate(`/order/${order.id}`);
    } catch (error) {
      await logger.error('create-order', 'create_order_unexpected_failure', { error: serializeError(error) });
      toast('Не удалось создать заказ. Попробуйте ещё раз.', 'error');
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4 p-4 pb-[210px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"
          >
            <ArrowLeft size={14} /> Назад
          </button>
          <h1 className="text-xl font-black text-slate-900">Создать заказ</h1>
        </div>
        <button type="button" onClick={saveDraft} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700" aria-label="Сохранить черновик"><Save size={14} />Сохранить черновик</button>
      </div>

      {!!savedDrafts.length && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-800">Сохраненные черновики</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSelectedDraftIds((prev) => prev.size === savedDrafts.length ? new Set() : new Set(savedDrafts.map((item) => item.id)))}
              className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-bold text-amber-800"
            >
              {selectedDraftIds.size === savedDrafts.length ? 'Снять выбор' : 'Выбрать все'}
            </button>
            <button
              type="button"
              disabled={selectedDraftIds.size === 0}
              onClick={() => deleteDrafts(Array.from(selectedDraftIds))}
              className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-700 disabled:opacity-40"
            >
              <Trash2 size={12} />Удалить выбранные ({selectedDraftIds.size})
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {savedDrafts.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-2 py-2 text-xs text-slate-700">
                <input type="checkbox" checked={selectedDraftIds.has(item.id)} onChange={() => toggleDraftSelection(item.id)} className="h-4 w-4" />
                <button type="button" onClick={() => applyDraft(item.data)} className="flex flex-1 items-center justify-between text-left">
                  <span>{item.title}</span>
                  <span className="text-[11px] text-slate-500">{new Date(item.createdAt).toLocaleString('ru-RU')}</span>
                </button>
                <button type="button" onClick={() => deleteDrafts([item.id])} className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 p-1 text-rose-700" aria-label="Удалить черновик">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="rounded-2xl bg-slate-100 p-1">
        <div className="grid grid-cols-2 gap-1">
          <button type="button" onClick={() => setMode('quick')} className={`h-10 rounded-xl text-sm font-bold transition ${mode === 'quick' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Быстро</button>
          <button type="button" onClick={() => setMode('full')} className={`h-10 rounded-xl text-sm font-bold transition ${mode === 'full' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Полно</button>
        </div>
      </div>

      <section className={cardClass}>
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-600"><CarFront size={16} /> Автомобиль</h2>
        <p className="text-xs text-slate-500">Поля со звёздочкой (*) обязательны. Сначала марка и модель, затем всё остальное.</p>

        {mode === 'full' && (
          <div className="space-y-1 transition-all duration-200">
            <input autoFocus value={vin} onChange={(e) => setVin(e.target.value.toUpperCase().slice(0, 17))} placeholder="VIN (необязательно)" className={inputClass} />
            {errors.vin && <p className="text-xs text-rose-600">{errors.vin}</p>}
          </div>
        )}

        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">Марка *</span>
          <SearchableDropdown
            value={brand}
            placeholder="Выберите марку"
            options={brandOptions}
            loading={brandLoading}
            required
            onChange={(value) => {
              touched.current.brand = true;
              setBrand(value);
              setModel('');
              setSeriesCode('');
              setManualModelMode(false);
            }}
          />
          {errors.brand && <p className="text-xs text-rose-600">{errors.brand}</p>}
        </label>

        <div className="space-y-1 transition-all duration-200">
          <span className="text-xs font-semibold text-slate-500">Модель *</span>
          <SearchableDropdown
            value={model}
            placeholder="Выберите модель"
            options={modelOptions}
            loading={modelLoading}
            disabled={!brand}
            required
            onChange={(value) => {
              touched.current.model = true;
              setModel(value);
              setManualModelMode(false);
            }}
          />
          {errors.model && <p className="text-xs text-rose-600">{errors.model}</p>}
          <button
            type="button"
            onClick={() => setManualModelMode((prev) => !prev)}
            className="text-xs font-semibold text-slate-600 underline underline-offset-2"
          >
            {manualModelMode ? 'Выбрать модель из списка' : 'Добавить модель вручную'}
          </button>
          {(manualModelMode || (brand && modelOptions.length === 0)) && (
            <input
              value={model}
              onChange={(e) => {
                touched.current.model = true;
                setModel(e.target.value);
              }}
              placeholder="Введите модель вручную"
              className={inputClass}
            />
          )}
          {!!chassisCodes.length && <p className="text-xs text-slate-500">Популярные серии: {chassisCodes.slice(0, 4).map((x) => x.value).join(', ')}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Год *</span>
            <SearchableDropdown
              value={year}
              placeholder="Выберите год"
              options={yearOptions.map((item) => ({ label: item, value: item }))}
              onChange={(value) => {
                touched.current.year = true;
                setYear(value);
              }}
              required
            />
            {errors.year && <p className="text-xs text-rose-600">{errors.year}</p>}
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Тип кузова (необязательно)</span>
            <input
              value={bodyType}
              onChange={(e) => setBodyType(e.target.value)}
              placeholder="Введите тип кузова"
              className={inputClass}
            />
            {!!bodyTypeOptions.length && (
              <p className="text-xs text-slate-500">
                Часто используют: {bodyTypeOptions.slice(0, 6).map((item) => item.value).join(', ')}
              </p>
            )}
          </label>
        </div>

        {mode === 'full' && !!chassisCodes.length && (
          <label className="space-y-1 transition-all duration-200">
            <span className="text-xs font-semibold text-slate-500">Series / Code (необязательно)</span>
            <SearchableDropdown value={seriesCode} placeholder="Выберите серию" options={chassisCodes} onChange={setSeriesCode} />
          </label>
        )}

        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-600">Фото авто (до 10, форматы: jpg/png/heic)</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => carCameraRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><Camera size={14} /> Камера</button>
            <button type="button" onClick={() => carGalleryRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><ImagePlus size={14} /> Галерея</button>
          </div>
          {!!carPhotos.length && (
            <div className="grid grid-cols-3 gap-2">
              {carPhotos.map((photo, index) => (
                <div key={`${photo}-${index}`} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <img src={photo} alt={`car-${index}`} className="h-20 w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setCarPhotos((prev) => prev.filter((_, i) => i !== index))}
                    className="absolute right-1 top-1 h-5 w-5 rounded-full bg-black/60 text-[10px] text-white"
                  >×</button>
                </div>
              ))}
            </div>
          )}
          <input ref={carGalleryRef} type="file" accept=".jpg,.jpeg,.png,.heic,image/heic" multiple className="hidden" onChange={(e) => { void attachCompressedImages(e.target.files, setCarPhotos, 10, 'new-order:car-gallery'); e.target.value = ''; }} />
          <input ref={carCameraRef} type="file" accept=".jpg,.jpeg,.png,.heic,image/heic" capture="environment" className="hidden" onChange={(e) => { void attachCompressedImages(e.target.files, setCarPhotos, 10, 'new-order:car-camera'); e.target.value = ''; }} />
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-600"><Wrench size={16} /> Деталь / запрос</h2>
        <div className="space-y-3">
          {parts.map((part, index) => (
            <div key={part.id} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setParts((prev) => prev.map((item) => item.id === part.id ? { ...item, partKind: 'single' } : item))}
                  className={`rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-wide ${part.partKind === 'single' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500'}`}
                >
                  Обычная деталь
                </button>
                <button
                  type="button"
                  onClick={() => setParts((prev) => prev.map((item) => item.id === part.id ? { ...item, partKind: 'group', groupItems: item.groupItems?.length ? item.groupItems : [createDraftGroupItem()] } : item))}
                  className={`rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-wide ${part.partKind === 'group' ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500'}`}
                >
                  Группа деталей
                </button>
              </div>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-500">{part.partKind === 'group' ? `Группа ${index + 1}` : `Деталь ${index + 1} *`}</span>
                {part.partKind === 'group' ? (
                  <input
                    value={part.name}
                    onChange={(e) => setParts((prev) => prev.map((item) => (item.id === part.id ? { ...item, name: e.target.value } : item)))}
                    placeholder="Название группы (необязательно)"
                    className={inputClass}
                  />
                ) : (
                  <textarea
                    value={part.name}
                    onChange={(e) => setParts((prev) => prev.map((item) => (item.id === part.id ? { ...item, name: e.target.value } : item)))}
                    placeholder="Название детали"
                    rows={2}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none transition-all duration-200 focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                  />
                )}
              </label>
              {part.partKind === 'group' && (
                <div className="space-y-2 rounded-xl border border-violet-100 bg-violet-50/60 p-3">
                  <p className="text-[11px] font-black uppercase tracking-wide text-violet-700">Состав группы</p>
                  {part.groupItems.map((item, groupIndex) => (
                    <div key={item.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        value={item.name}
                        onChange={(e) => setParts((prev) => prev.map((p) => {
                          if (p.id !== part.id) return p;
                          return { ...p, groupItems: p.groupItems.map((g) => g.id === item.id ? { ...g, name: e.target.value } : g) };
                        }))}
                        placeholder={`Деталь #${groupIndex + 1}`}
                        className="w-full flex-1 rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm font-semibold outline-none"
                      />
                      <div className="flex items-center gap-2 sm:shrink-0">
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => setParts((prev) => prev.map((p) => {
                            if (p.id !== part.id) return p;
                            return { ...p, groupItems: p.groupItems.map((g) => g.id === item.id ? { ...g, quantity: e.target.value.replace(/[^\d]/g, '') } : g) };
                          }))}
                          className="w-20 rounded-lg border border-violet-100 bg-white px-2 py-2 text-center text-sm font-bold"
                        />
                        <button
                          type="button"
                          onClick={() => setParts((prev) => prev.map((p) => {
                            if (p.id !== part.id) return p;
                            const filtered = p.groupItems.filter((g) => g.id !== item.id);
                            return { ...p, groupItems: filtered.length ? filtered : [createDraftGroupItem()] };
                          }))}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-2 text-sm font-black text-rose-600"
                          aria-label="Удалить строку"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setParts((prev) => prev.map((p) => p.id === part.id ? { ...p, groupItems: [...p.groupItems, createDraftGroupItem(String(p.groupItems.length))] } : p))}
                    className="w-full rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-black uppercase tracking-wide text-violet-700 sm:w-auto"
                  >
                    + Добавить деталь в группу
                  </button>
                </div>
              )}
              <input value={part.comment} onChange={(e) => setParts((prev) => prev.map((item) => item.id === part.id ? { ...item, comment: e.target.value } : item))} placeholder="Комментарий (необязательно)" className={inputClass} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => partPhotoRefs.current[part.id]?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><Camera size={14} /> Фото детали</button>
                <button
                  type="button"
                  onClick={() => void attachImagesFromClipboard((updater) => {
                    setParts((prev) => prev.map((item) => {
                      if (item.id !== part.id) return item;
                      const nextPhotos = typeof updater === 'function' ? updater(item.photos) : updater;
                      return { ...item, photos: nextPhotos };
                    }));
                  }, `new-order:part:${part.id}`)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"
                >
                  <ClipboardPaste size={14} /> Вставить
                </button>
                {parts.length > 1 && <button type="button" onClick={() => setParts((prev) => prev.filter((item) => item.id !== part.id))} className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold text-rose-600">Удалить</button>}
              </div>
              {!!part.photos.length && (
                <div className="grid grid-cols-3 gap-2">
                  {part.photos.map((photo, photoIndex) => (
                    <div key={`${photo}-${photoIndex}`} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <img src={photo} alt={`part-${index}-${photoIndex}`} className="h-20 w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setParts((prev) => prev.map((item) => item.id === part.id ? { ...item, photos: item.photos.filter((_, i) => i !== photoIndex) } : item))}
                        className="absolute right-1 top-1 h-5 w-5 rounded-full bg-black/60 text-[10px] text-white"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={(el) => { partPhotoRefs.current[part.id] = el; }}
                type="file"
                accept=".jpg,.jpeg,.png,.heic,image/heic"
                multiple
                className="hidden"
                onChange={(e) => { void attachCompressedImages(e.target.files, (updater) => {
                  setParts((prev) => prev.map((item) => {
                    if (item.id !== part.id) return item;
                    const nextPhotos = typeof updater === 'function' ? updater(item.photos) : updater;
                    return { ...item, photos: nextPhotos };
                  }));
                }, 10, 'new-order:part'); e.target.value = ''; }}
              />
            </div>
          ))}
          {errors.partName && <p className="text-xs text-rose-600">{errors.partName}</p>}
          <button type="button" onClick={() => setParts((prev) => [...prev, createDraftPart()])} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">+ Добавить ещё деталь</button>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600">Комментарии / заметки (текст, фото, аудио)</p>
            <button type="button" onClick={() => setMode('full')} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-bold text-slate-700"><NotebookPen size={12} /> Расширенно</button>
          </div>
          {notes.map((note, index) => (
            <div key={note.id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <textarea
                value={note.text}
                onChange={(e) => setNotes((prev) => prev.map((item) => item.id === note.id ? { ...item, text: e.target.value } : item))}
                placeholder={`Комментарий ${index + 1}`}
                rows={2}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none transition-all duration-200 focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => notePhotoRefs.current[note.id]?.click()} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><Camera size={14} /> Фото</button>
                <button
                  type="button"
                  onClick={() => void attachImagesFromClipboard((updater) => {
                    setNotes((prev) => prev.map((item) => {
                      if (item.id !== note.id) return item;
                      const nextPhotos = typeof updater === 'function' ? updater(item.photos) : updater;
                      return { ...item, photos: nextPhotos };
                    }));
                  }, `new-order:note:${note.id}`)}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"
                >
                  <ClipboardPaste size={14} /> Вставить
                </button>
                <button type="button" onClick={() => void toggleNoteRecording(note.id)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">{recordingNoteId === note.id ? <Square size={14} /> : <Mic size={14} />} {recordingNoteId === note.id ? 'Стоп' : 'Голос'}</button>
                {notes.length > 1 && <button type="button" onClick={() => setNotes((prev) => prev.filter((item) => item.id !== note.id))} className="inline-flex h-9 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold text-rose-600">Удалить</button>}
              </div>
              {!!note.voices.length && <p className="text-xs text-slate-500">Голосовых заметок: {note.voices.length}</p>}
              {recordingNoteId === note.id && <div className="flex h-5 items-end gap-1">{Array.from({ length: 20 }).map((_, bar) => <span key={`${note.id}-rec-${bar}`} className="w-1 rounded-full bg-rose-300" style={{ height: `${30 + Math.abs(Math.sin((recordingTick + bar) * 0.9)) * 70}%` }} />)}</div>}
              {!!note.voices.length && (
                <div className="space-y-2">
                  {note.voices.map((voice, voiceIndex) => {
                    const voiceId = `new-note-${note.id}-${voiceIndex}`;
                    const isPlaying = playingVoiceId === voiceId;
                    return (
                      <div key={voiceId} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <button type="button" onClick={() => toggleVoicePlayback(voiceId)} className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white">{isPlaying ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}</button>
                        <audio id={voiceId} src={voice} preload="metadata" />
                        <span className="text-[11px] font-semibold text-slate-600">Аудио {voiceIndex + 1}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {!!note.photos.length && (
                <div className="grid grid-cols-4 gap-2">
                  {note.photos.map((photo, photoIndex) => (
                    <div key={`${photo}-${photoIndex}`} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <img src={photo} alt={`note-${index}-${photoIndex}`} className="h-16 w-full object-cover" />
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={(el) => { notePhotoRefs.current[note.id] = el; }}
                type="file"
                accept=".jpg,.jpeg,.png,.heic,image/heic"
                multiple
                className="hidden"
                onChange={(e) => { void attachCompressedImages(e.target.files, (updater) => {
                  setNotes((prev) => prev.map((item) => {
                    if (item.id !== note.id) return item;
                    const nextPhotos = typeof updater === 'function' ? updater(item.photos) : updater;
                    return { ...item, photos: nextPhotos };
                  }));
                }, 10, 'new-order:note'); e.target.value = ''; }}
              />
            </div>
          ))}
          <button type="button" onClick={() => setNotes((prev) => [...prev, createDraftNote()])} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">+ Добавить комментарий</button>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-600"><UserRound size={16} /> Клиент</h2>
        <div className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">Контакты</span>
          <input
            type={leadSource === Source.WHATSAPP ? 'tel' : 'text'}
            name="contactValue"
            autoComplete={leadSource === Source.WHATSAPP ? 'tel' : 'off'}
            inputMode={leadSource === Source.WHATSAPP ? 'tel' : 'url'}
            value={contactValue}
            onChange={(e) => setContactValue(e.target.value.replace(/\s+/g, ''))}
            placeholder={
              leadSource === Source.WHATSAPP
                ? 'WhatsApp / телефон (+971501234567)'
                : leadSource === Source.INSTAGRAM
                  ? 'Instagram: @username или https://instagram.com/username'
                  : leadSource === Source.TIKTOK
                    ? 'TikTok: @username или https://www.tiktok.com/@username'
                    : leadSource === Source.TELEGRAM
                      ? 'Telegram: @username или https://t.me/username'
                      : leadSource === Source.FACEBOOK
                        ? 'Facebook: ссылка на профиль'
                        : 'Ссылка/контакт'
            }
            className={inputClass}
          />
          {errors.contactValue && <p className="text-xs text-rose-600">{errors.contactValue}</p>}
        </div>
        <input
          type="text"
          name="clientName"
          autoComplete="name"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Имя (необязательно)"
          className={inputClass}
        />

        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">Источник</span>
          <select value={leadSource} onChange={(e) => setLeadSource(e.target.value as Source)} className={inputClass}>
            <option value={Source.INSTAGRAM}>Instagram</option>
            <option value={Source.TIKTOK}>TikTok</option>
            <option value={Source.TELEGRAM}>Telegram</option>
            <option value={Source.FACEBOOK}>Facebook</option>
            <option value={Source.WHATSAPP}>WhatsApp</option>
            <option value={Source.OTHER}>Другое</option>
          </select>
        </label>
      </section>

      <div style={{ bottom: `${keyboardOffset}px` }} className="fixed inset-x-0 z-40 mx-auto w-full max-w-md border-t border-slate-200 bg-white/95 px-3 pt-3 backdrop-blur" >
        <div className="space-y-2 pb-[calc(env(safe-area-inset-bottom)+64px)]">
          <button type="button" onClick={saveDraft} className="h-11 w-full rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700">Сохранить черновик</button>
          <button
            type="submit"
            onClick={(event) => {
              if (canCreate) return;
              event.preventDefault();
              const missing = [];
              if (!brand.trim()) missing.push('марка');
              if (!model.trim()) missing.push('модель');
              if (!year.trim()) missing.push('год');
              if (!parts.some((item) => item.partKind === 'group' ? item.groupItems.some((g) => g.name.trim()) : item.name.trim())) missing.push('деталь');
              toast(`Заполните обязательные поля: ${missing.join(', ')}`, 'error');
            }}
            disabled={isSyncing || isSubmitting}
            className={`h-14 w-full rounded-2xl text-sm font-black uppercase tracking-wide text-white transition-all duration-200 disabled:opacity-40 ${canCreate ? 'bg-emerald-600 shadow-[0_8px_20px_rgba(5,150,105,0.35)]' : 'bg-slate-900'}`}
          >
            {isSubmitting ? 'Создание...' : 'Создать заказ'}
          </button>
        </div>
      </div>
    </form>
  );
};

export default NewOrderScreen;
