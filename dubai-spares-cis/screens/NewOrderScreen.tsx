import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera,
  CheckCircle2,
  Mic,
  Plus,
  Save,
  Smartphone,
  Sparkles,
  TriangleAlert,
  X
} from 'lucide-react';
import ImagePreview from '../components/ImagePreview';
import { BRAND_MODELS, BRANDS, DEFAULT_MARKUP, DEFAULT_RATE, SOCIAL_SOURCES, YEARS } from '../constants';
import { useStore } from '../store';
import { Order, Priority, Source } from '../types';

const LAST_SOURCE_KEY = 'new_order_last_source';

type Mode = 'quick' | 'full';

type PartDraft = { name: string; photos: string[] };

type VinDecoded = {
  brand: string;
  model?: string;
  year?: string;
  bodyType?: string;
};

const VIN_BRAND_MAP: Record<string, string> = {
  JT: 'Toyota',
  JN: 'Nissan',
  WA: 'Audi',
  WV: 'Volkswagen',
  WB: 'BMW',
  WDB: 'Mercedes-Benz',
  KM: 'Hyundai',
  KN: 'Kia',
  VF: 'Renault',
  ZFA: 'Fiat',
  SAL: 'Land Rover',
  JHM: 'Honda'
};

const VIN_YEAR_MAP: Record<string, string> = {
  R: '2024',
  P: '2023',
  N: '2022',
  M: '2021',
  L: '2020',
  K: '2019',
  J: '2018',
  H: '2017',
  G: '2016',
  F: '2015',
  E: '2014',
  D: '2013',
  C: '2012',
  B: '2011',
  A: '2010'
};

const decodeVin = (rawVin: string): VinDecoded | null => {
  const vin = rawVin.trim().toUpperCase();
  if (vin.length < 8) return null;

  const prefix3 = vin.slice(0, 3);
  const prefix2 = vin.slice(0, 2);
  const brand = VIN_BRAND_MAP[prefix3] || VIN_BRAND_MAP[prefix2] || '';
  const year = VIN_YEAR_MAP[vin[9]];

  if (!brand && !year) return null;
  return { brand, year };
};

const parseCountryByPhone = (phone: string) => {
  const cleaned = phone.replace(/\s+/g, '');
  if (cleaned.startsWith('+971')) return 'UAE';
  if (cleaned.startsWith('+7')) return 'KZ/RU';
  if (cleaned.startsWith('+992')) return 'Tajikistan';
  if (cleaned.startsWith('+998')) return 'Uzbekistan';
  if (cleaned.startsWith('+996')) return 'Kyrgyzstan';
  return 'Unknown';
};

const NewOrderScreen: React.FC = () => {
  const { addOrder, isSyncing, orders } = useStore();
  const navigate = useNavigate();

  const carFileRef = useRef<HTMLInputElement>(null);
  const partFileRef = useRef<HTMLInputElement>(null);
  const vinFileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>('quick');
  const [priority, setPriority] = useState<Priority>(Priority.MEDIUM);
  const [isVip, setIsVip] = useState(false);
  const [isLead, setIsLead] = useState(true);

  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState(YEARS[0]);
  const [bodyType, setBodyType] = useState('');
  const [vin, setVin] = useState('');

  const [clientName, setClientName] = useState('');
  const [customerContact, setCustomerContact] = useState('+971');
  const [source, setSource] = useState<Source>(() => {
    const cached = localStorage.getItem(LAST_SOURCE_KEY);
    return (cached as Source) || Source.WHATSAPP;
  });
  const [socialNickname, setSocialNickname] = useState('');
  const [comments, setComments] = useState('');

  const [vinPhotoUrl, setVinPhotoUrl] = useState('');
  const [carPhotos, setCarPhotos] = useState<string[]>([]);
  const [localOnlyPhotos, setLocalOnlyPhotos] = useState(false);

  const [partInput, setPartInput] = useState('');
  const [partPhotos, setPartPhotos] = useState<string[]>([]);
  const [parts, setParts] = useState<PartDraft[]>([]);

  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);

  const modelOptions = BRAND_MODELS[brand] || [];

  const previousOrderByVin = useMemo(() => orders.find((o) => vin && o.vin === vin), [orders, vin]);
  const previousOrderByPhone = useMemo(() => {
    const cleanCurrent = customerContact.replace(/[^\d+]/g, '');
    if (!cleanCurrent || cleanCurrent.length < 7) return undefined;
    return orders.find((order) => (order.customerContact || '').replace(/[^\d+]/g, '') === cleanCurrent);
  }, [orders, customerContact]);

  const partSuggestions = useMemo(() => {
    const q = partInput.trim().toLowerCase();
    if (!q) return [];
    const fromHistory = orders.flatMap((order) => order.parts.map((item) => item.name));
    const unique = [...new Set(fromHistory)].filter((name) => name.toLowerCase().includes(q));
    return unique.slice(0, 6);
  }, [orders, partInput]);

  const completion = useMemo(() => {
    const checks = [
      carPhotos.length > 0 || vin.trim().length >= 8,
      parts.length > 0,
      customerContact.replace(/\D/g, '').length >= 8,
      Boolean(brand && model)
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [brand, model, customerContact, parts.length, vin, carPhotos.length]);

  useEffect(() => {
    const onStatus = () => setOffline(!navigator.onLine);
    window.addEventListener('online', onStatus);
    window.addEventListener('offline', onStatus);
    return () => {
      window.removeEventListener('online', onStatus);
      window.removeEventListener('offline', onStatus);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(LAST_SOURCE_KEY, source);
  }, [source]);

  useEffect(() => {
    const decoded = decodeVin(vin);
    if (!decoded) return;
    if (decoded.brand && !brand) setBrand(decoded.brand);
    if (decoded.year) setYear(decoded.year);
    if (decoded.model && !model) setModel(decoded.model);
    if (decoded.bodyType && !bodyType) setBodyType(decoded.bodyType);
  }, [vin, brand, model, bodyType]);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (!e.target.files?.length) return;
    const files = Array.from(e.target.files);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => setter((prev) => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
  };

  const removePhoto = (index: number, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter((prev) => prev.filter((_, i) => i !== index));
  };

  const addPart = (name?: string) => {
    const normalized = (name || partInput).trim();
    if (!normalized) return;
    setParts((prev) => [...prev, { name: normalized, photos: [...partPhotos] }]);
    setPartInput('');
    setPartPhotos([]);
  };

  const startVoiceInput = () => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      alert('Голосовой ввод недоступен в этом браузере');
      return;
    }
    const recognition = new Ctor();
    recognition.lang = 'ru-RU';
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) setPartInput(transcript);
    };
    recognition.start();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!brand || !model) {
      alert('Заполните марку и модель или укажите VIN полностью');
      return;
    }

    if (!parts.length) {
      alert('Добавьте хотя бы одну деталь');
      return;
    }

    if (customerContact.replace(/\D/g, '').length < 8) {
      alert('Введите корректный телефон клиента');
      return;
    }

    const now = Date.now();
    const newOrder: Order = {
      id: now.toString(),
      brand,
      model,
      year,
      bodyType,
      vin: vin || '',
      vinPhotoUrl,
      priority,
      clientName: clientName || '',
      customerContact,
      source,
      socialNickname,
      carPhotos,
      carPhotoUrl: carPhotos[0],
      parts: parts.map((p) => ({
        id: Math.random().toString(36).slice(2, 9),
        name: p.name,
        photos: p.photos,
        photoUrl: p.photos[0],
        variants: [],
        isFound: false
      })),
      markupPercent: DEFAULT_MARKUP,
      exchangeRate: DEFAULT_RATE,
      createdAt: now,
      isArchived: false,
      isSold: false,
      isVip,
      isLead,
      isPinned: false,
      localOnlyPhotos: localOnlyPhotos || offline,
      notes: comments.trim() ? [{ id: `note-${now}`, text: comments.trim(), createdAt: now }] : [],
      salesStatus: 'Inquiry',
      updatedAt: now
    };

    const ok = await addOrder(newOrder);
    if (!ok) return;

    navigator.vibrate?.(120);
    if (offline) {
      alert('🟡 Сохранено локально. Синхронизация при подключении.');
    }

    if (window.confirm('Заказ создан. Открыть Radar Live?')) {
      navigate('/radar');
      return;
    }

    navigate('/');
  };

  return (
    <form onSubmit={submit} className="p-4 pb-24 space-y-4">
      <header className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-black text-slate-900">Новый заказ</h1>
          <div className={`text-xs font-bold px-2 py-1 rounded-full ${completion >= 60 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            Готовность: {completion}%
          </div>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full transition-all ${completion >= 60 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${completion}%` }} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setMode('quick')} className={`h-12 rounded-xl text-sm font-bold ${mode === 'quick' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>⚡ Quick Mode</button>
          <button type="button" onClick={() => setMode('full')} className={`h-12 rounded-xl text-sm font-bold ${mode === 'full' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>🧾 Full Mode</button>
        </div>
      </header>

      {offline && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          🟡 Сохранено локально. Синхронизация при подключении.
        </div>
      )}

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
        <button type="button" onClick={() => carFileRef.current?.click()} className="w-full h-44 rounded-2xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-2 text-slate-500">
          <Camera size={28} />
          <span className="text-sm font-bold">Фото авто / VIN</span>
        </button>
        {carPhotos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {carPhotos.map((photo, idx) => (
              <button key={photo + idx} type="button" onClick={() => setGallery({ images: carPhotos, index: idx })} className="relative w-24 h-24 rounded-xl overflow-hidden shrink-0">
                <img src={photo} className="w-full h-full object-cover" />
                <span onClick={(e) => { e.stopPropagation(); removePhoto(idx, setCarPhotos); }} className="absolute right-1 top-1 bg-black/60 text-white rounded-full p-1"><X size={12} /></span>
              </button>
            ))}
          </div>
        )}
        <input ref={carFileRef} type="file" accept="image/*" className="hidden" multiple onChange={(e) => handlePhotoSelect(e, setCarPhotos)} />

        <div>
          <label className="text-xs font-bold uppercase text-slate-400">VIN</label>
          <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="WBA..." className={`mt-1 h-12 w-full rounded-xl border px-3 font-mono font-bold outline-none ${vin ? 'border-slate-200' : 'border-amber-300 bg-amber-50/60'}`} />
          {!vin && <p className="mt-1 text-xs text-amber-700">Мягкое предупреждение: VIN не заполнен.</p>}
          {decodeVin(vin) && (
            <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
              <p className="font-bold inline-flex items-center gap-1"><Sparkles size={12} /> VIN автоопределение</p>
              <p>{brand || '—'} {model || '—'} • {year || '—'} • {bodyType || 'Кузов не определен'}</p>
            </div>
          )}
          {previousOrderByVin && <p className="mt-1 text-xs text-blue-700">Повторить прошлый заказ? Найден заказ по VIN от {new Date(previousOrderByVin.createdAt).toLocaleDateString()}.</p>}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
        <label className="text-xs font-bold uppercase text-slate-400">Детали</label>
        <div className={`rounded-xl border p-2 ${parts.length ? 'border-slate-200' : 'border-amber-300 bg-amber-50/60'}`}>
          <div className="flex gap-2">
            <input value={partInput} onChange={(e) => setPartInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPart())} placeholder="Напр. фара левая" className="h-12 flex-1 rounded-xl bg-slate-50 px-3 text-sm font-bold outline-none" />
            <button type="button" onClick={startVoiceInput} className="h-12 w-12 rounded-xl bg-slate-100 flex items-center justify-center"><Mic size={18} /></button>
            <button type="button" onClick={() => addPart()} className="h-12 w-12 rounded-xl bg-slate-900 text-white flex items-center justify-center"><Plus size={18} /></button>
          </div>
          {partSuggestions.length > 0 && (
            <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
              {partSuggestions.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => addPart(suggestion)} className="h-9 px-3 rounded-full bg-blue-50 text-blue-700 text-xs font-bold whitespace-nowrap">{suggestion}</button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => partFileRef.current?.click()} className="mt-2 h-10 px-3 rounded-xl bg-slate-100 text-xs font-bold inline-flex items-center gap-1"><Camera size={14} /> Фото детали</button>
          <input ref={partFileRef} type="file" accept="image/*" className="hidden" multiple onChange={(e) => handlePhotoSelect(e, setPartPhotos)} />
          {!!partPhotos.length && <p className="mt-1 text-xs text-slate-500">Фото для следующей детали: {partPhotos.length}</p>}
          {!parts.length && <p className="mt-1 text-xs text-amber-700">Добавьте хотя бы одну деталь.</p>}
        </div>
        <div className="space-y-2">
          {parts.map((part, idx) => (
            <div key={`${part.name}-${idx}`} className="h-12 rounded-xl bg-slate-50 border border-slate-200 px-3 flex items-center justify-between">
              <p className="text-sm font-bold truncate">{part.name}</p>
              <button type="button" onClick={() => setParts((prev) => prev.filter((_, i) => i !== idx))} className="text-slate-500"><X size={16} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
        <label className="text-xs font-bold uppercase text-slate-400">Телефон клиента</label>
        <div className="relative">
          <Smartphone size={16} className="absolute left-3 top-3.5 text-slate-400" />
          <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} className="h-12 w-full rounded-xl border border-slate-200 pl-9 pr-3 font-bold outline-none" placeholder="+971..." />
        </div>
        <p className="text-xs text-slate-500">Страна: {parseCountryByPhone(customerContact)}</p>
        {previousOrderByPhone && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            <p className="font-bold inline-flex items-center gap-1"><TriangleAlert size={12} /> Клиент уже существует</p>
            <p>Заказов: {orders.filter((o) => (o.customerContact || '') === (previousOrderByPhone.customerContact || '')).length}</p>
          </div>
        )}
      </section>

      {mode === 'full' && (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setIsLead((v) => !v); setIsVip(false); }} className={`h-12 rounded-xl text-sm font-bold ${isLead ? 'bg-violet-600 text-white' : 'bg-slate-100'}`}>Lead</button>
            <button type="button" onClick={() => { setIsVip((v) => !v); if (!isVip) setIsLead(false); }} className={`h-12 rounded-xl text-sm font-bold ${isVip ? 'bg-amber-500 text-white' : 'bg-slate-100'}`}>VIP</button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[Priority.LOW, Priority.MEDIUM, Priority.HIGH].map((p) => (
              <button key={p} type="button" onClick={() => setPriority(p)} className={`h-12 rounded-xl text-xs font-bold ${priority === p ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{p}</button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select value={brand} onChange={(e) => { setBrand(e.target.value); setModel(''); }} className="h-12 rounded-xl border border-slate-200 px-3 font-bold outline-none">
              <option value="">Марка</option>
              {BRANDS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            {modelOptions.length > 0 ? (
              <select value={model} onChange={(e) => setModel(e.target.value)} className="h-12 rounded-xl border border-slate-200 px-3 font-bold outline-none">
                <option value="">Модель</option>
                {modelOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            ) : (
              <input value={model} onChange={(e) => setModel(e.target.value)} className="h-12 rounded-xl border border-slate-200 px-3 font-bold outline-none" placeholder="Модель" />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select value={year} onChange={(e) => setYear(e.target.value)} className="h-12 rounded-xl border border-slate-200 px-3 font-bold outline-none">
              {YEARS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <input value={bodyType} onChange={(e) => setBodyType(e.target.value)} className="h-12 rounded-xl border border-slate-200 px-3 font-bold outline-none" placeholder="Кузов" />
          </div>

          <div>
            <label className="text-xs font-bold uppercase text-slate-400">Источник</label>
            <div className="mt-1 flex gap-2 overflow-x-auto no-scrollbar">
              {SOCIAL_SOURCES.map((item) => (
                <button key={item} type="button" onClick={() => setSource(item)} className={`h-10 px-3 rounded-full text-xs font-bold whitespace-nowrap ${source === item ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{item}</button>
              ))}
            </div>
          </div>

          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="h-12 w-full rounded-xl border border-slate-200 px-3 font-bold outline-none" placeholder="Имя клиента" />
          <input value={socialNickname} onChange={(e) => setSocialNickname(e.target.value)} className="h-12 w-full rounded-xl border border-slate-200 px-3 font-bold outline-none" placeholder="Никнейм" />

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => vinFileRef.current?.click()} className="h-12 rounded-xl bg-slate-100 text-sm font-bold">Фото VIN</button>
            <button type="button" onClick={() => carFileRef.current?.click()} className="h-12 rounded-xl bg-slate-100 text-sm font-bold">Фото авто</button>
          </div>
          <input ref={vinFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onloadend = () => setVinPhotoUrl(reader.result as string);
            reader.readAsDataURL(file);
          }} />

          <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} className="w-full rounded-xl border border-slate-200 p-3 text-sm font-medium outline-none" placeholder="Комментарии" />

          <label className="h-12 rounded-xl bg-amber-50 border border-amber-200 px-3 flex items-center gap-2 text-sm font-semibold text-amber-800">
            <input type="checkbox" checked={localOnlyPhotos} onChange={(e) => setLocalOnlyPhotos(e.target.checked)} />
            Локальное сохранение фото (IndexedDB)
          </label>
        </section>
      )}

      <button type="submit" disabled={isSyncing} className="sticky bottom-4 w-full h-14 rounded-2xl bg-slate-900 text-white font-black text-base inline-flex items-center justify-center gap-2 disabled:opacity-60">
        {completion >= 75 ? <CheckCircle2 size={18} /> : <Save size={18} />}
        {isSyncing ? 'Сохранение...' : 'Создать'}
      </button>

      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </form>
  );
};

export default NewOrderScreen;
