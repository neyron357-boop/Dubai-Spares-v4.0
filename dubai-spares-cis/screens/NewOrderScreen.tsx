import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ChevronDown, Mic, UserRound, Wrench, CarFront, ImagePlus, NotebookPen } from 'lucide-react';
import { BRAND_MODELS, BRANDS, DEFAULT_MARKUP, DEFAULT_RATE, YEARS } from '../constants';
import { CHASSIS_BODY_TYPES_BY_BRAND } from '../carDatabase';
import { useStore } from '../store';
import { Order, Priority, Source } from '../types';
import { logger } from '../logging';
import { optimizeImageForUpload } from '../storage/photos';

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
  photos: string[];
};

type DraftNote = {
  id: string;
  text: string;
  photos: string[];
  voices: string[];
};

const POPULAR_BRANDS = ['BMW', 'Mercedes-Benz', 'Toyota', 'Lexus', 'Nissan', 'Hyundai', 'Kia', 'Audi', 'Volkswagen'];

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

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

const createDraftPart = (): DraftPart => ({
  id: createId(),
  name: '',
  photos: []
});

const createDraftNote = (): DraftNote => ({
  id: createId(),
  text: '',
  photos: [],
  voices: []
});

const inputClass = 'h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-100';

const cardClass = 'space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200';

const SearchableDropdown: React.FC<{
  value: string;
  placeholder: string;
  disabled?: boolean;
  options: DropdownOption[];
  loading?: boolean;
  onChange: (value: string) => void;
}> = ({ value, placeholder, disabled, options, loading, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
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
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            className="mb-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-300"
            placeholder="Поиск..."
          />
          {loading ? (
            <div className="space-y-2 p-1">
              <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : (
            <div className="max-h-52 overflow-y-auto">
              {filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex w-full items-center rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  {option.label}
                </button>
              ))}
              {filtered.length === 0 && <p className="px-2 py-2 text-xs text-slate-500">Ничего не найдено</p>}
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
  const [brandLoading, setBrandLoading] = useState(true);
  const [modelLoading, setModelLoading] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  const partPhotoRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const notePhotoRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const carGalleryRef = useRef<HTMLInputElement>(null);
  const carCameraRef = useRef<HTMLInputElement>(null);

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
    if (model && modelOptions.length > 0 && !modelOptions.map((item) => item.value).includes(model)) {
      setModel('');
    }
  }, [model, modelOptions]);

  useEffect(() => {
    const saved = localStorage.getItem('new-order-draft-v2');
    if (!saved) return;
    try {
      const d = JSON.parse(saved);
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
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('new-order-draft-v2', JSON.stringify({
      mode, vin, brand, model, year, bodyType, seriesCode, parts, notes, clientName, customerContact, country, city
    }));
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
    if (!brand.trim()) next.brand = 'Марка обязательна';
    if (!model.trim()) next.model = 'Модель обязательна';
    if (!year.trim() || !/^\d{4}$/.test(year.trim())) next.year = 'Год: 4 цифры';
    if (!parts.some((item) => item.name.trim())) next.partName = 'Добавьте хотя бы одну деталь';
    if (vin.trim() && vin.trim().length !== 17) next.vin = 'VIN должен быть 17 символов';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      void logger.warn('create-order', 'create_order_validation_error', { errors: next });
    }
    return Object.keys(next).length === 0;
  };

  const canCreate = useMemo(() => (
    !!brand.trim() && !!model.trim() && /^\d{4}$/.test(year.trim()) && parts.some((item) => item.name.trim()) && (!vin.trim() || vin.trim().length === 17)
  ), [brand, model, year, parts, vin]);

  const startVoiceInput = (noteId: string) => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'ru-RU';
    rec.onresult = (event: any) => {
      const transcript = String(event?.results?.[0]?.[0]?.transcript || '').trim();
      if (!transcript) return;
      setNotes((prev) => prev.map((note) => (
        note.id === noteId ? { ...note, voices: [...note.voices, transcript] } : note
      )));
    };
    rec.start();
  };

  const attachCompressedImages = async (
    files: FileList | null,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    maxCount = 10,
    labelPrefix = 'new-order:image'
  ) => {
    const selected = Array.from(files || []);
    if (!selected.length) return;

    const prepared: string[] = [];
    for (const file of selected) {
      try {
        const compressed = await optimizeImageForUpload(file, `${labelPrefix}:${file.name}`);
        prepared.push(compressed);
      } catch {
        await new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            prepared.push(String(reader.result || ''));
            resolve();
          };
          reader.onerror = () => resolve();
          reader.readAsDataURL(file);
        });
      }
    }

    setter((prev) => [...prev, ...prepared].slice(0, maxCount));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    void logger.info('create-order', 'create_order_start', { source: 'manual', mode });
    if (!validate()) return;

    if ('vibrate' in navigator) {
      navigator.vibrate(20);
    }

    const now = Date.now();
    const params = new URLSearchParams(window.location.search);
    const fromLead = params.get('from') === 'lead';

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
        photos: part.photos,
        photoUrl: part.photos[0],
        variants: [],
        isFound: false
      })),
      markupPercent: DEFAULT_MARKUP,
      exchangeRate: DEFAULT_RATE,
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
              ...note.voices.map((voice, index) => `Voice ${index + 1}: ${voice}`)
            ].filter(Boolean).join('\n'),
            photos: note.photos,
            createdAt: now
          })),
        ...(seriesCode.trim() ? [{ id: createId(), text: `Series/Code: ${seriesCode.trim()}`, createdAt: now }] : [])
      ],
      socialNickname: [country.trim(), city.trim()].filter(Boolean).join(', ') || undefined
    };

    const ok = await addOrder(order);
    if (!ok) return;

    localStorage.removeItem('new-order-draft-v2');
    void logger.info('create-order', 'create_order_success', { orderId: order.id });
    navigate(`/order/${order.id}`);
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4 p-4 pb-[210px]">
      <h1 className="text-xl font-black text-slate-900">Создать заказ</h1>

      <div className="rounded-2xl bg-slate-100 p-1">
        <div className="grid grid-cols-2 gap-1">
          <button type="button" onClick={() => setMode('quick')} className={`h-10 rounded-xl text-sm font-bold transition ${mode === 'quick' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Quick</button>
          <button type="button" onClick={() => setMode('full')} className={`h-10 rounded-xl text-sm font-bold transition ${mode === 'full' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Full</button>
        </div>
      </div>

      <section className={cardClass}>
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-600"><CarFront size={16} /> Автомобиль</h2>
        <p className="text-xs text-slate-500">Сначала марка и модель, затем всё остальное.</p>

        {mode === 'full' && (
          <div className="space-y-1 transition-all duration-200">
            <input autoFocus value={vin} onChange={(e) => setVin(e.target.value.toUpperCase().slice(0, 17))} placeholder="VIN (опционально)" className={inputClass} />
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
            onChange={(value) => {
              touched.current.brand = true;
              setBrand(value);
              setModel('');
              setSeriesCode('');
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
            onChange={(value) => {
              touched.current.model = true;
              setModel(value);
            }}
          />
          {errors.model && <p className="text-xs text-rose-600">{errors.model}</p>}
          {!!chassisCodes.length && <p className="text-xs text-slate-500">Подсказка по серии: {chassisCodes.slice(0, 4).map((x) => x.value).join(', ')}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Год *</span>
            <SearchableDropdown
              value={year}
              placeholder="Выберите год"
              options={YEARS.map((item) => ({ label: String(item), value: String(item) }))}
              onChange={(value) => {
                touched.current.year = true;
                setYear(value);
              }}
            />
            {errors.year && <p className="text-xs text-rose-600">{errors.year}</p>}
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Тип кузова</span>
            <input value={bodyType} onChange={(e) => setBodyType(e.target.value)} placeholder="SUV / Sedan / Coupe / Hatchback..." className={inputClass} />
          </label>
        </div>

        {mode === 'full' && !!chassisCodes.length && (
          <label className="space-y-1 transition-all duration-200">
            <span className="text-xs font-semibold text-slate-500">Series / Code</span>
            <SearchableDropdown value={seriesCode} placeholder="Выберите серию" options={chassisCodes} onChange={setSeriesCode} />
          </label>
        )}

        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-600">Фото авто (до 10)</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => carCameraRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><Camera size={14} /> Camera</button>
            <button type="button" onClick={() => carGalleryRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><ImagePlus size={14} /> Gallery</button>
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
          <input ref={carGalleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void attachCompressedImages(e.target.files, setCarPhotos, 10, 'new-order:car-gallery')} />
          <input ref={carCameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void attachCompressedImages(e.target.files, setCarPhotos, 10, 'new-order:car-camera')} />
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-600"><Wrench size={16} /> Деталь / запрос</h2>
        <div className="space-y-3">
          {parts.map((part, index) => (
            <div key={part.id} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-500">Деталь {index + 1} *</span>
                <input
                  value={part.name}
                  onChange={(e) => setParts((prev) => prev.map((item) => (item.id === part.id ? { ...item, name: e.target.value } : item)))}
                  placeholder="Например: задний фонарь правый"
                  className={inputClass}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => partPhotoRefs.current[part.id]?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><Camera size={14} /> Фото детали</button>
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
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void attachCompressedImages(e.target.files, (updater) => {
                  setParts((prev) => prev.map((item) => {
                    if (item.id !== part.id) return item;
                    const nextPhotos = typeof updater === 'function' ? updater(item.photos) : updater;
                    return { ...item, photos: nextPhotos };
                  }));
                }, 10, 'new-order:part')}
              />
            </div>
          ))}
          {errors.partName && <p className="text-xs text-rose-600">{errors.partName}</p>}
          <button type="button" onClick={() => setParts((prev) => [...prev, createDraftPart()])} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">+ Добавить еще деталь</button>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600">Комментарии / заметки</p>
            <button type="button" onClick={() => setMode('full')} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-bold text-slate-700"><NotebookPen size={12} /> Full</button>
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
                <button type="button" onClick={() => startVoiceInput(note.id)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><Mic size={14} /> Голос</button>
                {notes.length > 1 && <button type="button" onClick={() => setNotes((prev) => prev.filter((item) => item.id !== note.id))} className="inline-flex h-9 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold text-rose-600">Удалить</button>}
              </div>
              {!!note.voices.length && <p className="text-xs text-slate-500">Голосовых заметок: {note.voices.length}</p>}
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
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void attachCompressedImages(e.target.files, (updater) => {
                  setNotes((prev) => prev.map((item) => {
                    if (item.id !== note.id) return item;
                    const nextPhotos = typeof updater === 'function' ? updater(item.photos) : updater;
                    return { ...item, photos: nextPhotos };
                  }));
                }, 10, 'new-order:note')}
              />
            </div>
          ))}
          <button type="button" onClick={() => setNotes((prev) => [...prev, createDraftNote()])} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">+ Добавить комментарий</button>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-600"><UserRound size={16} /> Клиент</h2>
        <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} placeholder="WhatsApp / телефон (опционально)" className={inputClass} />
        <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Имя (опционально)" className={inputClass} />

        {mode === 'full' && (
          <div className="grid grid-cols-1 gap-3 transition-all duration-200 sm:grid-cols-2">
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Страна" className={inputClass} />
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Город" className={inputClass} />
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-slate-500">Источник</span>
              <select value={leadSource} onChange={(e) => setLeadSource(e.target.value as Source)} className={inputClass}>
                <option value={Source.INSTAGRAM}>IG</option>
                <option value={Source.TIKTOK}>TikTok</option>
                <option value={Source.WHATSAPP}>WA</option>
                <option value={Source.OTHER}>Other</option>
              </select>
            </label>
          </div>
        )}
      </section>

      <div style={{ bottom: `${keyboardOffset}px` }} className="fixed inset-x-0 z-40 mx-auto w-full max-w-md border-t border-slate-200 bg-white/95 px-3 pt-3 backdrop-blur" >
        <div className="pb-[calc(env(safe-area-inset-bottom)+64px)]">
          <button type="submit" disabled={!canCreate || isSyncing} className="h-14 w-full rounded-2xl bg-slate-900 text-sm font-black uppercase tracking-wide text-white transition-all duration-200 disabled:opacity-40">
            Создать заказ
          </button>
        </div>
      </div>
    </form>
  );
};

export default NewOrderScreen;
