import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ChevronDown, Mic, Square, Play, Pause, UserRound, Wrench, CarFront, ImagePlus, NotebookPen, Save, Trash2 } from 'lucide-react';
import { BRAND_MODELS, BRANDS, DEFAULT_MARKUP, DEFAULT_RATE } from '../constants';
import { CHASSIS_BODY_TYPES_BY_BRAND } from '../carDatabase';
import { useStore } from '../store';
import { Order, Priority, Source } from '../types';
import { logger } from '../logging';
import { optimizeImageForUpload } from '../storage/photos';
import { toast } from '../feedback';

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

type DraftPart = {
  id: string;
  name: string;
  comment: string;
  photos: string[];
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

const createDraftPart = (): DraftPart => ({
  id: createId(),
  name: '',
  comment: '',
  photos: []
});

const COUNTRY_CITY_MAP: Record<string, string[]> = {
  'ОАЭ': ['Дубай', 'Абу-Даби', 'Шарджа', 'Аджман'],
  'Россия': ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург'],
  'Казахстан': ['Алматы', 'Астана', 'Шымкент'],
  'Узбекистан': ['Ташкент', 'Самарканд', 'Бухара'],
  'Кыргызстан': ['Бишкек', 'Ош'],
  'Саудовская Аравия': ['Эр-Рияд', 'Джидда', 'Мекка']
};
const COUNTRY_OPTIONS = Object.keys(COUNTRY_CITY_MAP).sort((a, b) => a.localeCompare(b, 'ru'));

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
        customerContact: item.data?.customerContact || '',
        country: item.data?.country || '',
        city: item.data?.city || ''
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
  parts: DraftPart[];
  notes: DraftNote[];
  clientName: string;
  customerContact: string;
  country: string;
  city: string;
}) => ({
  ...payload,
  parts: (payload.parts || []).map((part) => ({ ...part, photos: [] })),
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

const inputClass = 'h-14 w-full rounded-[14px] border border-[#E5E7EB] bg-white px-4 text-base text-[#0F172A] outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-[#2563EB] focus:ring-4 focus:ring-blue-50';

const cardClass = 'space-y-4 rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm transition-all duration-200';

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
                onChange(filteredOptions[highlighted].value);
                setOpen(false);
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
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
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
  const [customerContact, setCustomerContact] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [leadSource, setLeadSource] = useState<Source>(Source.WHATSAPP);

  const [carPhotos, setCarPhotos] = useState<string[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedDrafts, setSavedDrafts] = useState<Array<{ id: string; createdAt: number; title: string; data: ReturnType<typeof toPersistableDraft> }>>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [cityManualMode, setCityManualMode] = useState(false);
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
  const vinCameraRef = useRef<HTMLInputElement>(null);
  const partsEndRef = useRef<HTMLDivElement>(null);
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
    setParts(Array.isArray(d.parts) && d.parts.length ? d.parts : [createDraftPart()]);
    setNotes(Array.isArray(d.notes) && d.notes.length ? d.notes : [createDraftNote()]);
    setClientName(d.clientName || '');
    setCustomerContact(d.customerContact || '');
    setCountry(d.country || '');
    setCity(d.city || '');
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
    const draftData = toPersistableDraft({ mode, vin, brand, model, year, bodyType, seriesCode, parts, notes, clientName, customerContact, country, city });
    localStorage.setItem('new-order-draft-v2', JSON.stringify(draftData));
  }, [mode, vin, brand, model, year, bodyType, seriesCode, parts, notes, clientName, customerContact, country, city]);

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
    if (!brand.trim()) next.brand = 'Марка обязательна';
    if (!model.trim()) next.model = 'Модель обязательна';
    if (!year.trim() || !/^\d{4}$/.test(year.trim()) || parsedYear < 1980 || parsedYear > currentYear) next.year = `Год должен быть в диапазоне 1980-${currentYear}`;
    if (!parts.some((item) => item.name.trim())) next.partName = 'Добавьте хотя бы одну деталь';
    if (vin.trim() && vin.trim().length !== 17) next.vin = 'VIN должен быть 17 символов';
    if (customerContact.trim() && !/^\+[0-9]{9,15}$/.test(customerContact.trim())) next.customerContact = 'Телефон: +код и 9–15 цифр без пробелов';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      void logger.warn('create-order', 'create_order_validation_error', { errors: next });
    }
    return next;
  };

  const canCreate = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const parsedYear = Number(year.trim());
    return !!brand.trim() && !!model.trim() && /^\d{4}$/.test(year.trim()) && parsedYear >= 1980 && parsedYear <= currentYear && parts.some((item) => item.name.trim()) && (!vin.trim() || vin.trim().length === 17) && (!customerContact.trim() || /^\+[0-9]{9,15}$/.test(customerContact.trim()));
  }, [brand, model, year, parts, vin, customerContact]);

  const cityOptions = useMemo(() => {
    if (!country) return [];
    return (COUNTRY_CITY_MAP[country] || []).map((item) => ({ label: item, value: item }));
  }, [country]);

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
    files: FileList | null,
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
    setCustomerContact('');
    setCountry('');
    setCity('');
    setCarPhotos([]);
    setErrors({});
  };

  const saveDraft = () => {
    const data = toPersistableDraft({ mode, vin, brand, model, year, bodyType, seriesCode, parts, notes, clientName, customerContact, country, city });
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

  // Allow React to batch the state update before scrolling to the newly added part.
  const SCROLL_AFTER_ADD_MS = 80;

  const addPart = () => {
    setParts((prev) => [...prev, createDraftPart()]);
    window.setTimeout(() => {
      partsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, SCROLL_AFTER_ADD_MS);
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

    const shippingCountry = country.trim();
    const shippingCity = city.trim();
    const shippingNote = [shippingCountry, shippingCity].filter(Boolean).join(', ');
    const whatsappTemplateLanguage = inferWhatsappLanguage(shippingCountry, customerContact.trim());

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
      customerContact: customerContact.trim(),
      carPhotos,
      carPhotoUrl: carPhotos[0],
      parts: parts.filter((part) => part.name.trim()).map((part) => ({
        id: createId(),
        name: part.name.trim(),
        comment: part.comment.trim(),
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
        ...(shippingNote ? [{ id: createId(), text: `Доставка: ${shippingNote}`, createdAt: now }] : []),
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
      socialNickname: shippingNote || undefined,
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
    <form onSubmit={submit} className="mx-auto max-w-2xl bg-[#F8FAFC] pb-[220px]">

      {/* HEADER */}
      <div className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-[#E5E7EB] bg-white px-4 shadow-sm">
        <h1 style={{ fontSize: '26px', fontWeight: 600 }} className="text-[#0F172A]">Создать заказ</h1>
        <button
          type="button"
          onClick={saveDraft}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm font-semibold text-[#0F172A] transition hover:bg-slate-50"
          aria-label="Сохранить черновик"
        >
          <Save size={15} /> Сохранить черновик
        </button>
      </div>

      <div className="space-y-4 p-4">

        {/* DRAFTS */}
        {!!savedDrafts.length && (
          <section className="rounded-[10px] border border-[#E5E7EB] bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[12px] font-semibold text-[#0F172A]">Черновики</p>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setSelectedDraftIds((prev) => prev.size === savedDrafts.length ? new Set() : new Set(savedDrafts.map((item) => item.id)))}
                  className="text-[12px] font-semibold text-[#0F172A]"
                >
                  {selectedDraftIds.size === savedDrafts.length ? 'Снять выбор' : 'Выбрать все'}
                </button>
                <button
                  type="button"
                  disabled={selectedDraftIds.size === 0}
                  onClick={() => deleteDrafts(Array.from(selectedDraftIds))}
                  className="text-[12px] font-semibold text-[#EF4444] disabled:opacity-40"
                >
                  Удалить выбранные
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              {savedDrafts.map((item) => (
                <div key={item.id} className="flex h-12 items-center gap-3 rounded-[10px] border border-[#E5E7EB] bg-white px-3">
                  <input
                    type="checkbox"
                    checked={selectedDraftIds.has(item.id)}
                    onChange={() => toggleDraftSelection(item.id)}
                    className="h-4 w-4 rounded"
                  />
                  <button type="button" onClick={() => applyDraft(item.data)} className="flex flex-1 items-center justify-between text-left">
                    <span className="text-sm font-medium text-[#0F172A]">{item.title}</span>
                    <span className="text-[11px] text-slate-400">
                      {new Date(item.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* MODE SWITCH */}
        <div className="h-11 rounded-xl bg-[#F3F4F6] p-1">
          <div className="grid h-full grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setMode('quick')}
              className={`h-full rounded-[10px] text-sm font-semibold transition-all duration-200 ${mode === 'quick' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-slate-500'}`}
            >
              Быстро
            </button>
            <button
              type="button"
              onClick={() => setMode('full')}
              className={`h-full rounded-[10px] text-sm font-semibold transition-all duration-200 ${mode === 'full' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-slate-500'}`}
            >
              Полно
            </button>
          </div>
        </div>

        {/* АВТОМОБИЛЬ */}
        <section className={cardClass}>
          <h2 className="flex items-center gap-2 text-[18px] font-semibold text-[#0F172A]">
            <CarFront size={18} className="text-[#2563EB]" /> Автомобиль
          </h2>
          <p className="text-[12px] text-slate-500">Поля со звёздочкой (*) обязательны.</p>

          {/* VIN — always visible */}
          <div className="space-y-1">
            <label className="text-[12px] font-semibold text-slate-500">VIN</label>
            <div className="relative">
              <input
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase().slice(0, 17))}
                placeholder="Введите VIN (необязательно)"
                className={`${inputClass} pr-44`}
              />
              <button
                type="button"
                onClick={() => vinCameraRef.current?.click()}
                className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB]"
              >
                <Camera size={13} /> Сканировать VIN
              </button>
              <input
                ref={vinCameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={() => { toast('Сканирование VIN будет доступно в следующей версии', 'error'); }}
              />
            </div>
            {errors.vin && <p className="text-xs text-rose-600">{errors.vin}</p>}
          </div>

          {/* Марка */}
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-500">Марка *</span>
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

          {/* Модель */}
          <div className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-500">Модель *</span>
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
              className="text-xs font-semibold text-[#2563EB] underline underline-offset-2"
            >
              {manualModelMode ? 'Выбрать из списка' : 'Добавить вручную'}
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
            {!!chassisCodes.length && <p className="text-xs text-slate-400">Серии: {chassisCodes.slice(0, 4).map((x) => x.value).join(', ')}</p>}
          </div>

          {/* Год */}
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-500">Год *</span>
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

          {/* Full mode: additional fields */}
          {mode === 'full' && (
            <div className="space-y-4 border-t border-[#E5E7EB] pt-4">
              {/* Тип кузова */}
              <label className="space-y-1">
                <span className="text-[12px] font-semibold text-slate-500">Тип кузова</span>
                <input
                  value={bodyType}
                  onChange={(e) => setBodyType(e.target.value)}
                  placeholder="Например: Седан, Кроссовер, SUV"
                  className={inputClass}
                />
                {!!bodyTypeOptions.length && (
                  <p className="text-[11px] text-slate-400">{bodyTypeOptions.slice(0, 5).map((item) => item.value).join(' · ')}</p>
                )}
              </label>

              {!!chassisCodes.length && (
                <label className="space-y-1">
                  <span className="text-[12px] font-semibold text-slate-500">Series / Code</span>
                  <SearchableDropdown value={seriesCode} placeholder="Выберите серию" options={chassisCodes} onChange={setSeriesCode} />
                </label>
              )}

              {/* Car Photo Upload Container */}
              <div className="space-y-2">
                <span className="text-[12px] font-semibold text-slate-500">Фото автомобиля</span>
                <div
                  className="flex h-[100px] w-full flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-[#E5E7EB] bg-[#F8FAFC] transition hover:border-[#2563EB] hover:bg-blue-50 cursor-pointer"
                  onClick={() => carGalleryRef.current?.click()}
                >
                  <p className="text-xs font-semibold text-slate-500">+ Добавить фото автомобиля</p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); carCameraRef.current?.click(); }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] shadow-sm"
                    >
                      <Camera size={13} /> Камера
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); carGalleryRef.current?.click(); }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] shadow-sm"
                    >
                      <ImagePlus size={13} /> Галерея
                    </button>
                  </div>
                </div>
                {!!carPhotos.length && (
                  <div className="grid grid-cols-3 gap-2">
                    {carPhotos.map((photo, index) => (
                      <div key={`${photo}-${index}`} className="relative overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
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
            </div>
          )}
        </section>

        {/* ДЕТАЛЬ / ЗАПРОС */}
        <section className={cardClass}>
          <h2 className="flex items-center gap-2 text-[18px] font-semibold text-[#0F172A]">
            <Wrench size={18} className="text-[#2563EB]" /> Деталь / запрос
          </h2>

          <div className="space-y-3">
            {parts.map((part, index) => (
              <div key={part.id} className="space-y-3 rounded-xl border border-[#E5E7EB] bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#0F172A]">Деталь {index + 1}</span>
                  {parts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setParts((prev) => prev.filter((item) => item.id !== part.id))}
                      className="text-xs font-semibold text-[#EF4444]"
                    >
                      Удалить
                    </button>
                  )}
                </div>
                <label className="space-y-1">
                  <span className="text-[12px] font-semibold text-slate-500">Название детали *</span>
                  <textarea
                    value={part.name}
                    onChange={(e) => setParts((prev) => prev.map((item) => (item.id === part.id ? { ...item, name: e.target.value } : item)))}
                    placeholder={'Например:\nПередний амортизатор\nЛевая фара\nРешетка радиатора'}
                    rows={3}
                    className="w-full resize-none rounded-[14px] border border-[#E5E7EB] p-3 text-base text-[#0F172A] outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-[#2563EB] focus:ring-4 focus:ring-blue-50"
                  />
                </label>
                <input
                  value={part.comment}
                  onChange={(e) => setParts((prev) => prev.map((item) => item.id === part.id ? { ...item, comment: e.target.value } : item))}
                  placeholder="Комментарий (необязательно)"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => partPhotoRefs.current[part.id]?.click()}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#0F172A]"
                >
                  <Camera size={14} /> Фото детали
                </button>
                {!!part.photos.length && (
                  <div className="grid grid-cols-3 gap-2">
                    {part.photos.map((photo, photoIndex) => (
                      <div key={`${photo}-${photoIndex}`} className="relative overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
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
            <div ref={partsEndRef} />
          </div>

          <button
            type="button"
            onClick={addPart}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#E5E7EB] text-sm font-semibold text-[#2563EB] transition hover:border-[#2563EB] hover:bg-blue-50"
          >
            + Добавить деталь
          </button>

          {/* КОММЕНТАРИИ / ЗАМЕТКИ */}
          <div className="space-y-3 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-semibold text-[#0F172A]">Комментарий</p>
              <button type="button" onClick={() => setMode('full')} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2 text-[11px] font-semibold text-[#0F172A]"><NotebookPen size={12} /> Расширенно</button>
            </div>
            {notes.map((note, index) => (
              <div key={note.id} className="space-y-2 rounded-xl border border-[#E5E7EB] bg-white p-3">
                <textarea
                  value={note.text}
                  onChange={(e) => setNotes((prev) => prev.map((item) => item.id === note.id ? { ...item, text: e.target.value } : item))}
                  placeholder={`Комментарий ${index + 1}`}
                  rows={2}
                  className="w-full resize-none rounded-[14px] border border-[#E5E7EB] p-3 text-base text-[#0F172A] outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-[#2563EB] focus:ring-4 focus:ring-blue-50"
                />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => notePhotoRefs.current[note.id]?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#0F172A]"><Camera size={13} /> Фото</button>
                  <button type="button" onClick={() => void toggleNoteRecording(note.id)} className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition ${recordingNoteId === note.id ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-[#E5E7EB] bg-white text-[#0F172A]'}`}>{recordingNoteId === note.id ? <Square size={13} /> : <Mic size={13} />} {recordingNoteId === note.id ? 'Стоп' : 'Голос'}</button>
                  {notes.length > 1 && <button type="button" onClick={() => setNotes((prev) => prev.filter((item) => item.id !== note.id))} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#EF4444]">Удалить</button>}
                </div>
                {recordingNoteId === note.id && (
                  <div className="flex h-6 items-end gap-0.5">
                    {Array.from({ length: 24 }).map((_, bar) => (
                      <span key={`${note.id}-rec-${bar}`} className="w-1 rounded-full bg-rose-400" style={{ height: `${30 + Math.abs(Math.sin((recordingTick + bar) * 0.9)) * 70}%` }} />
                    ))}
                  </div>
                )}
                {!!note.voices.length && (
                  <div className="space-y-1.5">
                    {note.voices.map((voice, voiceIndex) => {
                      const voiceId = `new-note-${note.id}-${voiceIndex}`;
                      const isPlaying = playingVoiceId === voiceId;
                      return (
                        <div key={voiceId} className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-2">
                          <button type="button" onClick={() => toggleVoicePlayback(voiceId)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0F172A] text-white">{isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}</button>
                          <audio id={voiceId} src={voice} preload="metadata" />
                          <span className="flex-1 text-xs font-semibold text-[#0F172A]">Аудио {voiceIndex + 1}</span>
                          <button type="button" onClick={() => setNotes((prev) => prev.map((item) => item.id === note.id ? { ...item, voices: item.voices.filter((_, i) => i !== voiceIndex) } : item))} className="text-[#EF4444]"><Trash2 size={13} /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {!!note.photos.length && (
                  <div className="grid grid-cols-4 gap-2">
                    {note.photos.map((photo, photoIndex) => (
                      <div key={`${photo}-${photoIndex}`} className="relative overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
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
            <button type="button" onClick={() => setNotes((prev) => [...prev, createDraftNote()])} className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#0F172A]">+ Добавить комментарий</button>
          </div>
        </section>

        {/* КЛИЕНТ */}
        <section className={cardClass}>
          <h2 className="flex items-center gap-2 text-[18px] font-semibold text-[#0F172A]">
            <UserRound size={18} className="text-[#2563EB]" /> Клиент
          </h2>

          <div className="space-y-1">
            <label className="text-[12px] font-semibold text-slate-500">Телефон / WhatsApp</label>
            <input
              type="tel"
              name="customerContact"
              autoComplete="tel"
              value={customerContact}
              onChange={(e) => setCustomerContact(e.target.value.replace(/\s+/g, ''))}
              placeholder="+971 50 123 4567"
              className={inputClass}
            />
            {errors.customerContact && <p className="text-xs text-rose-600">{errors.customerContact}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-[12px] font-semibold text-slate-500">Имя</label>
            <input
              type="text"
              name="clientName"
              autoComplete="name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Имя клиента (необязательно)"
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[12px] font-semibold text-slate-500">Страна</span>
              <SearchableDropdown
                value={country}
                placeholder="Выберите страну"
                options={COUNTRY_OPTIONS.map((item) => ({ label: item, value: item }))}
                onChange={(value) => { setCountry(value); setCity(''); setCityManualMode(false); }}
                noOptionsText="Страна не найдена"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[12px] font-semibold text-slate-500">Город</span>
              {!country && <span className="ml-1 text-[12px] text-slate-400">(сначала выберите страну)</span>}
              {cityManualMode ? (
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Введите город вручную" className={inputClass} />
              ) : (
                <SearchableDropdown
                  value={city}
                  placeholder={country ? 'Выберите город' : 'Сначала выберите страну'}
                  options={cityOptions}
                  disabled={!country}
                  onChange={setCity}
                  noOptionsText="Город не найден"
                />
              )}
              {!!country && (
                <button type="button" onClick={() => setCityManualMode((prev) => !prev)} className="text-xs font-semibold text-[#2563EB] underline underline-offset-2">
                  {cityManualMode ? 'Выбрать из списка' : 'Нет города в списке? Ввести вручную'}
                </button>
              )}
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-[12px] font-semibold text-slate-500">Источник</span>
              <select value={leadSource} onChange={(e) => setLeadSource(e.target.value as Source)} className={inputClass}>
                <option value={Source.INSTAGRAM}>Instagram</option>
                <option value={Source.TIKTOK}>TikTok</option>
                <option value={Source.WHATSAPP}>WhatsApp</option>
                <option value={Source.OTHER}>Другое</option>
              </select>
            </label>
          </div>
        </section>

      </div>

      {/* STICKY ACTION BAR */}
      <div
        style={{ bottom: `${keyboardOffset}px` }}
        className="fixed inset-x-0 z-40 mx-auto w-full max-w-md border-t border-[#E5E7EB] bg-white/95 px-4 pt-3 backdrop-blur"
      >
        <div className="flex flex-col gap-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
          <button
            type="button"
            onClick={saveDraft}
            className="h-10 w-full rounded-[14px] border border-[#E5E7EB] bg-white text-sm font-semibold text-[#0F172A] transition hover:bg-slate-50"
          >
            Сохранить черновик
          </button>
          <button
            type="submit"
            onClick={(event) => {
              if (canCreate) return;
              event.preventDefault();
              const missing = [];
              if (!brand.trim()) missing.push('марка');
              if (!model.trim()) missing.push('модель');
              if (!year.trim()) missing.push('год');
              if (!parts.some((item) => item.name.trim())) missing.push('деталь');
              toast(`Заполните обязательные поля: ${missing.join(', ')}`, 'error');
            }}
            disabled={isSyncing || isSubmitting}
            className={[
              'h-14 w-full rounded-[14px] text-sm font-semibold uppercase tracking-wide text-white',
              'transition-all duration-200 disabled:opacity-40',
              canCreate
                ? 'bg-[#2563EB] shadow-[0_8px_20px_rgba(37,99,235,0.35)]'
                : 'bg-[#0F172A]'
            ].join(' ')}
          >
            {isSubmitting ? 'Создание...' : 'Создать заказ'}
          </button>
        </div>
      </div>
    </form>
  );
};

export default NewOrderScreen;
