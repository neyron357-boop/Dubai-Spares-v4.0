import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ChevronDown, Mic } from 'lucide-react';
import { BRAND_MODELS, BRANDS, DEFAULT_MARKUP, DEFAULT_RATE, YEARS } from '../constants';
import { useStore } from '../store';
import { Order, Priority, Source } from '../types';
import { logger } from '../logging';

type VinDecoded = {
  brand?: string;
  model?: string;
  year?: string;
};

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

const inputClass = 'h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-100';
const selectClass = `${inputClass} appearance-none pr-9`;

const NewOrderScreen: React.FC = () => {
  const navigate = useNavigate();
  const { addOrder, isSyncing } = useStore();

  const [vin, setVin] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [bodyType, setBodyType] = useState('');

  const [partName, setPartName] = useState('');
  const [comment, setComment] = useState('');
  const [partPhotos, setPartPhotos] = useState<string[]>([]);
  const [voiceNote, setVoiceNote] = useState('');

  const [clientName, setClientName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [country, setCountry] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});

  const photoRef = useRef<HTMLInputElement>(null);

  const touched = useRef({ brand: false, model: false, year: false });

  const modelOptions = useMemo(() => {
    if (brand) return BRAND_MODELS[brand] || [];
    return Array.from(new Set(Object.values(BRAND_MODELS).flat())).sort((a, b) => a.localeCompare(b));
  }, [brand]);

  useEffect(() => {
    if (model && modelOptions.length > 0 && !modelOptions.includes(model)) {
      setModel('');
    }
  }, [model, modelOptions]);

  useEffect(() => {
    const saved = localStorage.getItem('new-order-draft-v1');
    if (!saved) return;
    try {
      const d = JSON.parse(saved);
      setVin(d.vin || '');
      setBrand(d.brand || '');
      setModel(d.model || '');
      setYear(d.year || '');
      setBodyType(d.bodyType || '');
      setPartName(d.partName || '');
      setComment(d.comment || '');
      setClientName(d.clientName || '');
      setCustomerContact(d.customerContact || '');
      setCountry(d.country || '');
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('new-order-draft-v1', JSON.stringify({
      vin, brand, model, year, bodyType, partName, comment, clientName, customerContact, country
    }));
  }, [vin, brand, model, year, bodyType, partName, comment, clientName, customerContact, country]);

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
    if (!partName.trim()) next.partName = 'Название детали обязательно';
    if (vin.trim() && vin.trim().length !== 17) next.vin = 'VIN должен быть 17 символов';
    if (customerContact.replace(/\D/g, '').length < 8) next.contact = 'WhatsApp минимум 8 цифр';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      void logger.warn('create-order', 'create_order_validation_error', { errors: next });
    }
    return Object.keys(next).length === 0;
  };

  const canCreate = useMemo(() => (
    !!brand.trim() && !!model.trim() && /^\d{4}$/.test(year.trim()) && !!partName.trim() && customerContact.replace(/\D/g, '').length >= 8 && (!vin.trim() || vin.trim().length === 17)
  ), [brand, model, year, partName, customerContact, vin]);

  const startVoiceInput = () => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'ru-RU';
    rec.onresult = (event: any) => setVoiceNote(event?.results?.[0]?.[0]?.transcript || '');
    rec.start();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    void logger.info('create-order', 'create_order_start', { source: 'manual' });
    if (!validate()) return;

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
      source: Source.WHATSAPP,
      customerContact: customerContact.trim(),
      parts: [{
        id: createId(),
        name: partName.trim(),
        photos: partPhotos,
        photoUrl: partPhotos[0],
        variants: [],
        isFound: false
      }],
      markupPercent: DEFAULT_MARKUP,
      exchangeRate: DEFAULT_RATE,
      createdAt: now,
      isArchived: false,
      isSold: false,
      isLead: fromLead,
      leadUnread: fromLead,
      leadSource: fromLead ? 'public_form' : 'manual',
      notes: [
        ...(comment.trim() ? [{ id: createId(), text: comment.trim(), createdAt: now }] : []),
        ...(voiceNote.trim() ? [{ id: createId(), text: `Voice: ${voiceNote.trim()}`, createdAt: now }] : [])
      ],
      socialNickname: country.trim() || undefined
    };

    const ok = await addOrder(order);
    if (!ok) return;

    localStorage.removeItem('new-order-draft-v1');
    void logger.info('create-order', 'create_order_success', { orderId: order.id });
    navigate(`/orders/${order.id}`);
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4 p-4 pb-28">
      <h1 className="text-xl font-black text-slate-900">Создать заказ</h1>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase tracking-wide text-slate-500">Автомобиль</h2>
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Быстро заполните марку, модель и год через выпадающие списки.
        </div>

        <input autoFocus value={vin} onChange={(e) => setVin(e.target.value.toUpperCase().slice(0, 17))} placeholder="VIN (опционально)" className={inputClass} />
        {errors.vin && <p className="text-xs text-rose-600">{errors.vin}</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Марка *</span>
            <div className="relative">
              <select
                value={brand}
                onChange={(e) => {
                  touched.current.brand = true;
                  setBrand(e.target.value);
                  setModel('');
                }}
                className={selectClass}
              >
                <option value="">Выберите марку</option>
                {BRANDS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            {errors.brand && <p className="text-xs text-rose-600">{errors.brand}</p>}
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Модель *</span>
            <div className="relative">
              <select
                value={model}
                onChange={(e) => {
                  touched.current.model = true;
                  setModel(e.target.value);
                }}
                className={selectClass}
              >
                <option value="">Выберите модель</option>
                {modelOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            {errors.model && <p className="text-xs text-rose-600">{errors.model}</p>}
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Год *</span>
            <div className="relative">
              <select
                value={year}
                onChange={(e) => {
                  touched.current.year = true;
                  setYear(e.target.value);
                }}
                className={selectClass}
              >
                <option value="">Выберите год</option>
                {YEARS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            {errors.year && <p className="text-xs text-rose-600">{errors.year}</p>}
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Тип кузова (текстом)</span>
            <input value={bodyType} onChange={(e) => setBodyType(e.target.value)} placeholder="Например: Sedan / SUV / Coupe" className={inputClass} />
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase text-slate-500">Деталь</h2>
        <input value={partName} onChange={(e) => setPartName(e.target.value)} placeholder="Название детали *" className={inputClass} />
        {errors.partName && <p className="text-xs text-rose-600">{errors.partName}</p>}
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий" rows={3} className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none transition-all duration-200 focus:border-slate-300 focus:ring-4 focus:ring-slate-100" />
        <div className="flex gap-2">
          <button type="button" onClick={() => photoRef.current?.click()} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"><Camera size={14} /> Фото</button>
          <button type="button" onClick={startVoiceInput} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"><Mic size={14} /> Голос</button>
        </div>
        {!!voiceNote && <p className="text-xs text-slate-500">🎤 {voiceNote}</p>}
        <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
          const files = Array.from(e.target.files || []);
          files.forEach((file) => {
            const reader = new FileReader();
            reader.onloadend = () => setPartPhotos((prev) => [...prev, String(reader.result || '')]);
            reader.readAsDataURL(file);
          });
        }} />
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase text-slate-500">Клиент</h2>
        <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Имя клиента" className={inputClass} />
        <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} placeholder="WhatsApp *" className={inputClass} />
        {errors.contact && <p className="text-xs text-rose-600">{errors.contact}</p>}
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Страна / откуда пишет" className={inputClass} />
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <button type="submit" disabled={!canCreate || isSyncing} className="h-14 w-full rounded-2xl bg-slate-900 text-sm font-black uppercase tracking-wide text-white transition-all duration-200 disabled:opacity-40">
            СОЗДАТЬ ЗАКАЗ
          </button>
        </div>
      </div>
    </form>
  );
};

export default NewOrderScreen;
