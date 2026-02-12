import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, ChevronLeft, Copy, Mic, MicOff, Upload } from 'lucide-react';
import { ensurePublicImageUrls, optimizeImageForUpload } from '../storage/photos';
import { isCloudSyncConfigured, supabase } from '../supabase';
import { BRAND_MODELS, BRANDS, YEARS } from '../constants';
import { NotificationType, pushNotification } from '../notificationCenter';
import { logger } from '../logging';
import { Source } from '../types';
import { useAppSettings } from '../appSettings';

type FormStep = 1 | 2 | 3 | 4 | 5;

const TOTAL_STEPS = 5;
const MAX_REQUEST_PART_FIELDS = 10;
const DRAFT_KEY = 'public_order_form_draft_v2';

const STEP_NAMES = ['Автомобиль', 'Детали', 'Фото / VIN', 'Контакты', 'Подтверждение'];

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
  photoData: string | null;
  audioNote?: string | null;
}

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createRequestedPartInput = (): RequestedPartInput => ({
  id: createId(),
  name: '',
  photoData: null,
  audioNote: null
});

const formatVinInput = (value: string) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 17);

const splitParts = (value: string) => value
  .split(/,|\n| и | and |&|;/gi)
  .map((item) => item.trim())
  .filter(Boolean);

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
  const [messageSource, setMessageSource] = useState<Source>(Source.WHATSAPP);
  const [clientAlias, setClientAlias] = useState('');
  const [deliveryCountry, setDeliveryCountry] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryAddressNote, setDeliveryAddressNote] = useState('');
  const [showEngineCode, setShowEngineCode] = useState(false);
  const [engineCode, setEngineCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showThanks, setShowThanks] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState('');
  const [recordingPartId, setRecordingPartId] = useState<string | null>(null);
  const [recordingTick, setRecordingTick] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { settings } = useAppSettings();

  const carInputRef = useRef<HTMLInputElement | null>(null);
  const carCameraInputRef = useRef<HTMLInputElement | null>(null);
  const vinInputRef = useRef<HTMLInputElement | null>(null);
  const vinCameraInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const modelOptions = useMemo(() => BRAND_MODELS[brand] || [], [brand]);
  const deliveryCityOptions = useMemo(() => DELIVERY_CITIES[deliveryCountry as keyof typeof DELIVERY_CITIES] || [], [deliveryCountry]);
  const smartSuggestionKey = `${brand}|${model}|${bodyType}`;

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const source = (params.get('source') || '').toLowerCase();
      if (source.includes('insta') || source.includes('ig')) {
        setMessageSource(Source.INSTAGRAM);
      }
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved);
        setBrand(draft.brand || '');
        setModel(draft.model || '');
        setYear(draft.year || '');
        setBodyType((draft.bodyType || '').slice(0, 40));
        setVin(draft.vin || '');
        setRequestedParts(Array.isArray(draft.requestedParts) && draft.requestedParts.length ? draft.requestedParts : [createRequestedPartInput()]);
        setCustomerContact(draft.customerContact || '');
        setContactCountryCode(draft.contactCountryCode || PHONE_CODES[0].code);
        setDeliveryCountry(draft.deliveryCountry || '');
        setDeliveryCity(draft.deliveryCity || '');
        setDeliveryAddressNote(draft.deliveryAddressNote || '');
        setEngineCode(draft.engineCode || '');
        setClientAlias(draft.clientAlias || '');
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      brand, model, year, bodyType, vin, requestedParts, customerContact, contactCountryCode,
      deliveryCountry, deliveryCity, deliveryAddressNote, engineCode, clientAlias
    }));
  }, [brand, model, year, bodyType, vin, requestedParts, customerContact, contactCountryCode, deliveryCountry, deliveryCity, deliveryAddressNote, engineCode, clientAlias]);

  useEffect(() => {
    if (brand === 'BMW') setShowEngineCode(true);
  }, [brand]);

  const handleFileToDataUrl = (file: File, onLoad: (value: string) => void) => {
    const reader = new FileReader();
    reader.onloadend = () => onLoad(String(reader.result || ''));
    reader.readAsDataURL(file);
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

  const validatePhone = () => customerContact.replace(/\D/g, '').length >= 8;

  const isWhatsappValid = validatePhone();

  const canContinue =
    (step === 1 && Boolean(brand && model && year)) ||
    (step === 2 && Boolean(requestedParts.some((part) => part.name.trim()))) ||
    step === 3 ||
    (step === 4 && Boolean(validatePhone() && deliveryCountry)) ||
    step === 5;

  const validateStep = (nextStep = step) => {
    const nextErrors: Record<string, string> = {};
    if (nextStep === 1) {
      if (!brand) nextErrors.brand = 'Выберите марку';
      if (!model) nextErrors.model = 'Выберите модель';
      if (!year) nextErrors.year = 'Выберите год';
      if (bodyType.length > 40) nextErrors.bodyType = 'Максимум 40 символов';
    }
    if (nextStep === 4) {
      if (!validatePhone()) nextErrors.phone = 'Введите корректный WhatsApp';
      if (!deliveryCountry) nextErrors.deliveryCountry = 'Выберите страну доставки';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const goNext = () => {
    if (!canContinue || !validateStep(step)) return;
    setStep((current) => Math.min(TOTAL_STEPS, current + 1) as FormStep);
  };

  const goBack = () => setStep((current) => Math.max(1, current - 1) as FormStep);

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
    setMessageSource(Source.WHATSAPP);
    setDeliveryCountry('');
    setDeliveryCity('');
    setDeliveryAddressNote('');
    setShowEngineCode(false);
    setEngineCode('');
    setClientAlias('');
    localStorage.removeItem(DRAFT_KEY);
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
          if (audioData) updateRequestedPart(index, { audioNote: audioData });
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
    if (!validateStep(1) || !validateStep(4)) return;

    const filledRequestedParts = requestedParts.filter((part) => part.name.trim());
    if (!filledRequestedParts.length) {
      alert('Добавьте минимум одну деталь');
      return;
    }

    if (!isCloudSyncConfigured || !supabase) {
      alert('Форма заявки временно недоступна.');
      return;
    }

    setIsSubmitting(true);

    try {
      const orderId = createId();
      const now = new Date().toISOString();

      let uploadedCarPhotos: string[] = [];
      let uploadedVinPhotos: string[] = [];

      if (carPhotoData) {
        const compressed = await optimizeImageForUpload(carPhotoData, `public-order:${orderId}:car`);
        uploadedCarPhotos = await ensurePublicImageUrls([compressed], `orders/${orderId}/car`);
      }

      if (vinPhotoData) {
        const compressedVin = await optimizeImageForUpload(vinPhotoData, `public-order:${orderId}:vin`);
        uploadedVinPhotos = await ensurePublicImageUrls([compressedVin], `orders/${orderId}/vin`);
      }

      const uploadedAudios = filledRequestedParts.map((part) => part.audioNote || '').filter(Boolean);

      const notes = [{
        id: createId(),
        text: `Public Lead\nИсточник: ${messageSource}\nИмя/ник: ${clientAlias || '—'}\nVIN: ${vin || '—'}\nEngine code: ${engineCode || '—'}\nCountry: ${deliveryCountry}`,
        photos: uploadedVinPhotos,
        audios: uploadedAudios,
        createdAt: Date.now()
      }];

      const { error: orderError } = await supabase.from('orders').insert({
        id: orderId,
        brand: brand.trim(),
        model: model.trim(),
        year: year.trim(),
        body_type: bodyType.trim() || null,
        vin: vin.trim(),
        vin_photo_url: uploadedVinPhotos[0] || null,
        status: 'lead',
        sales_status: 'Inquiry',
        client_name: clientAlias.trim() || 'Public Lead',
        customer_contact: `${contactCountryCode}${customerContact.trim()}`.trim(),
        source: messageSource,
        social_nickname: clientAlias.trim() || null,
        priority: 'MEDIUM',
        car_photo_url: uploadedCarPhotos[0] || null,
        car_photos: uploadedCarPhotos,
        markup_percent: 20,
        exchange_rate: 3.67,
        is_archived: false,
        is_sold: false,
        is_vip: false,
        is_pinned: false,
        is_lead: true,
        lead_unread: true,
        lead_source: 'public_form',
        lead_read_at: null,
        notes,
        created_at: now,
        updated_at: now
      });

      if (orderError) throw orderError;

      const partsToInsert = [];
      for (const part of filledRequestedParts) {
        let uploadedPartPhotos: string[] = [];
        if (part.photoData) {
          const compressedPartPhoto = await optimizeImageForUpload(part.photoData, `public-order:${orderId}:${part.id}`);
          uploadedPartPhotos = await ensurePublicImageUrls([compressedPartPhoto], `orders/${orderId}/parts/${part.id}`);
        }
        partsToInsert.push({
          id: createId(),
          order_id: orderId,
          name: part.name.trim(),
          photos: uploadedPartPhotos,
          photo_url: uploadedPartPhotos[0] || null,
          is_found: false
        });
      }

      const { error: partError } = await supabase.from('parts').insert(partsToInsert);
      if (partError) throw partError;

      pushNotification({
        type: NotificationType.ORDER_NEW,
        title: 'Новая LEAD заявка',
        message: `${brand} ${model} • ${filledRequestedParts.length} детали`,
        orderId,
        source: 'web_form',
        route: `/orders/${orderId}`
      });
      void logger.info('public-form', `Lead created ${orderId}`, { source: messageSource, parts: filledRequestedParts.length });

      setCreatedOrderId(orderId);
      setShowThanks(true);
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось отправить заявку.';
      void logger.error('public-form', 'Lead submit failed', { error: message });
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const progress = (step / TOTAL_STEPS) * 100;

  if (showThanks) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black px-4 py-10 text-white">
        <div className="mx-auto w-full max-w-xl rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-[0_40px_120px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300"><Check className="h-8 w-8" /></div>
          <h1 className="text-3xl font-semibold tracking-tight">Заявка принята</h1>
          <p className="mt-2 text-slate-200">Номер заявки: <b>{createdOrderId}</b></p>
          <p className="mt-1 text-slate-300">Обычно отвечаем в течение 10–20 минут.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <a href={`https://wa.me/${settings.publicWhatsappNumber || '971000000000'}`} target="_blank" rel="noreferrer" className="rounded-2xl bg-emerald-400 px-4 py-3 text-center font-semibold text-slate-900">Перейти в WhatsApp</a>
            <button type="button" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/#public-order/${createdOrderId}`)} className="rounded-2xl border border-white/25 px-4 py-3 text-sm font-semibold">Сохранить ссылку</button>
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
      <div className="mx-auto w-full max-w-2xl rounded-[32px] border border-white/10 bg-white/5 p-5 shadow-[0_25px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
        <p className="text-xs uppercase tracking-[0.26em] text-slate-300">Dubai Spares Concierge</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Премиальная заявка на запчасти</h1>

        <div className="mb-6 mt-6">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-300"><span>Шаг {step} из {TOTAL_STEPS}</span><span>{Math.round(progress)}%</span></div>
          <div className="mb-2 flex gap-2 overflow-x-auto pb-2 text-xs">
            {STEP_NAMES.map((name, index) => (
              <div key={name} className={`rounded-full border px-3 py-1 whitespace-nowrap ${step >= index + 1 ? 'border-amber-200/70 bg-amber-200/15' : 'border-white/20'}`}>{name}</div>
            ))}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-yellow-100 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
        </div>

        <div className="space-y-4 transition-all duration-300">
          {step === 1 && (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">🚗 {brand || 'Марка'} {model || ''} {year || ''}</div>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Марка</span>
                <input list="brands-list" value={brand} onChange={(e) => { setBrand(e.target.value); setModel(''); }} className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-lg outline-none ${errors.brand ? 'border-amber-300' : 'border-white/15'}`} placeholder="BMW" />
                <datalist id="brands-list">
                  {[...POPULAR_BRANDS, ...BRANDS.filter((b) => !POPULAR_BRANDS.includes(b))].map((item) => <option key={item} value={item} />)}
                </datalist>
                {errors.brand && <p className="mt-1 text-xs text-amber-200">{errors.brand}</p>}
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Модель</span>
                {modelOptions.length > 0 && (
                  <select value={model} onChange={(e) => setModel(e.target.value)} className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.model ? 'border-amber-300' : 'border-white/15'}`}>
                    <option value="">Выберите модель</option>
                    {modelOptions.map((item) => <option key={item} value={item} className="text-slate-900">{item}</option>)}
                  </select>
                )}
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Или введите модель вручную" className={`mt-2 h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.model ? 'border-amber-300' : 'border-white/15'}`} />
                {errors.model && <p className="mt-1 text-xs text-amber-200">{errors.model}</p>}
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Год</span>
                  <select value={year} onChange={(e) => setYear(e.target.value)} className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.year ? 'border-amber-300' : 'border-white/15'}`}>
                    <option value="">Выберите год</option>
                    {YEARS.map((item) => <option key={item} value={item} className="text-slate-900">{item}</option>)}
                  </select>
                  {errors.year && <p className="mt-1 text-xs text-amber-200">{errors.year}</p>}
                </label>
                <label>
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Тип кузова (опционально)</span>
                  <input value={bodyType} maxLength={40} onChange={(e) => setBodyType(e.target.value.slice(0, 40))} className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.bodyType ? 'border-amber-300' : 'border-white/15'}`} placeholder="Например: sedan / SUV / coupe / hatchback" />
                  {errors.bodyType && <p className="mt-1 text-xs text-amber-200">{errors.bodyType}</p>}
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">VIN (опционально)</span>
                <input value={vin} onChange={(e) => { const formatted = formatVinInput(e.target.value); setVin(formatted); detectByVin(formatted); }} className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none" placeholder="WDB123456789..." />
              </label>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Фото автомобиля (в начале заявки)</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => carInputRef.current?.click()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold"><Upload className="h-4 w-4" />Галерея</button>
                  <button type="button" onClick={() => carCameraInputRef.current?.click()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold"><Camera className="h-4 w-4" />Камера</button>
                </div>
                <input ref={carInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setCarPhotoData); }} />
                <input ref={carCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setCarPhotoData); }} />
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
                    placeholder="Например: капот и бампер"
                    className="h-14 w-full rounded-2xl border border-white/15 bg-white/10 px-4 outline-none"
                  />
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <input id={`${part.id}-gallery`} type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, (value) => updateRequestedPart(index, { photoData: value })); }} className="hidden" />
                    <input id={`${part.id}-camera`} type="file" accept="image/*" capture="environment" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, (value) => updateRequestedPart(index, { photoData: value })); }} className="hidden" />
                    <label htmlFor={`${part.id}-gallery`} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 text-xs"><Upload className="h-3 w-3" />Фото</label>
                    <label htmlFor={`${part.id}-camera`} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 text-xs"><Camera className="h-3 w-3" />Камера</label>
                    <button type="button" onClick={() => void togglePartVoiceRecording(part.id, index)} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 text-xs">{recordingPartId === part.id ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}{recordingPartId === part.id ? 'Стоп' : 'Голос'}</button>
                  </div>
                  {recordingPartId === part.id && <div className="mt-2 flex h-5 items-end gap-1">{Array.from({ length: 18 }).map((_, waveIndex) => <span key={`${part.id}-record-${waveIndex}`} className="w-1 rounded-full bg-rose-300 transition-all" style={{ height: `${25 + Math.abs(Math.sin((recordingTick + waveIndex) * 0.8)) * 75}%` }} />)}</div>}
                  {part.audioNote && <audio controls src={part.audioNote} className="mt-2 h-8 w-full" />}
                </div>
              ))}

              {requestedParts.length < MAX_REQUEST_PART_FIELDS && <button type="button" onClick={() => addRequestedPart()} className="h-12 w-full rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold">+ Добавить ещё</button>}
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm text-slate-300">VIN помогает подобрать точную запчасть.</p>
              <span className="mb-1 block text-xs uppercase tracking-[0.2em] text-slate-300">Загрузить фото VIN</span>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => vinInputRef.current?.click()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold"><Upload className="h-4 w-4" />Галерея</button>
                <button type="button" onClick={() => vinCameraInputRef.current?.click()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold"><Camera className="h-4 w-4" />Камера</button>
              </div>
              <input ref={vinInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setVinPhotoData); }} />
              <input ref={vinCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setVinPhotoData); }} />

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Ввести VIN вручную</span>
                <input type="text" value={vin} onChange={(e) => setVin(formatVinInput(e.target.value))} placeholder="WDB123456789..." className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none" />
              </label>

              <span className="mb-1 block text-xs uppercase tracking-[0.2em] text-slate-300">Загрузить фото авто</span>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => carInputRef.current?.click()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold"><Upload className="h-4 w-4" />Галерея</button>
                <button type="button" onClick={() => carCameraInputRef.current?.click()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold"><Camera className="h-4 w-4" />Камера</button>
              </div>
              <input ref={carInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setCarPhotoData); }} />
              <input ref={carCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileToDataUrl(file, setCarPhotoData); }} />
            </>
          )}

          {step === 4 && (
            <>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">WhatsApp (обязательное)</span>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <select value={contactCountryCode} onChange={(e) => setContactCountryCode(e.target.value)} className="h-14 rounded-3xl border border-white/15 bg-white/10 px-3 text-sm outline-none">
                    {PHONE_CODES.map((item) => <option key={item.id} value={item.code} className="text-slate-900">{item.label} {item.code}</option>)}
                  </select>
                  <input type="tel" value={customerContact} onChange={(e) => setCustomerContact(formatPhone(e.target.value))} placeholder="901234567" className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-lg outline-none ${errors.phone ? 'border-amber-300' : 'border-white/15'}`} />
                </div>
                {errors.phone && <p className="mt-1 text-xs text-amber-200">{errors.phone}</p>}
                {!errors.phone && customerContact && <p className={`mt-1 text-xs ${isWhatsappValid ? 'text-emerald-200' : 'text-amber-200'}`}>{isWhatsappValid ? 'WhatsApp номер выглядит корректно' : 'Проверьте номер WhatsApp'}</p>}
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Страна доставки (обязательное)</span>
                <select value={deliveryCountry} onChange={(e) => { setDeliveryCountry(e.target.value); setDeliveryCity(''); }} className={`h-14 w-full rounded-3xl border bg-white/10 px-5 text-base outline-none ${errors.deliveryCountry ? 'border-amber-300' : 'border-white/15'}`}>
                  <option value="">Выберите страну</option>
                  {DELIVERY_COUNTRIES.map((item) => <option key={item} value={item} className="text-slate-900">{item}</option>)}
                </select>
                {errors.deliveryCountry && <p className="mt-1 text-xs text-amber-200">{errors.deliveryCountry}</p>}
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Город (опционально)</span>
                <select value={deliveryCity} onChange={(e) => setDeliveryCity(e.target.value)} className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none">
                  <option value="">Выберите город</option>
                  {deliveryCityOptions.map((item) => <option key={item} value={item} className="text-slate-900">{item}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Ваше имя или ник (опционально)</span>
                <input value={clientAlias} onChange={(e) => setClientAlias(e.target.value.slice(0, 60))} placeholder="Напр. @alex" className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none" />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Откуда вы пишете</span>
                <select value={messageSource} onChange={(e) => setMessageSource(e.target.value as Source)} className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none">
                  {[Source.INSTAGRAM, Source.WHATSAPP, Source.TELEGRAM, Source.TIKTOK, Source.FACEBOOK, Source.OTHER].map((item) => <option key={item} value={item} className="text-slate-900">{item}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Комментарий (опционально)</span>
                <textarea value={deliveryAddressNote} onChange={(e) => setDeliveryAddressNote(e.target.value)} rows={3} placeholder="Район, адрес и комментарий" className="w-full rounded-[28px] border border-white/15 bg-white/10 px-5 py-4 text-base outline-none" />
              </label>
            </>
          )}

          {step === 5 && (
            <div className="rounded-3xl border border-amber-200/30 bg-gradient-to-br from-amber-100/15 via-white/10 to-transparent p-5">
              <p className="text-xl font-black tracking-tight">{brand} {model} {year}</p>
              <p className="mt-3 text-sm">🧩 {requestedParts.filter((item) => item.name.trim()).length} детали</p>
              <p className="text-sm">🌍 Доставка: {deliveryCountry || '—'}</p>
              <p className="mt-2 text-xs text-slate-300">📱 {contactCountryCode}{customerContact || '—'}</p>
              <p className="text-xs text-slate-300">👤 {clientAlias || '—'} • {messageSource}</p>
            </div>
          )}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3">
          <button type="button" onClick={goBack} disabled={step === 1 || isSubmitting} className="flex h-12 min-w-[120px] items-center justify-center gap-2 rounded-full border border-white/20 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-35"><ChevronLeft className="h-4 w-4" />Назад</button>
          {step < TOTAL_STEPS ? (
            <button type="button" onClick={goNext} disabled={!canContinue || isSubmitting} className="flex h-12 min-w-[160px] items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-40">Далее<ArrowRight className="h-4 w-4" /></button>
          ) : (
            <button type="button" onClick={submitOrder} disabled={!canContinue || isSubmitting} className="flex h-12 min-w-[180px] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-amber-200 to-white px-6 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-40">{isSubmitting ? 'Отправка...' : 'Подтвердить заявку'}<Copy className="h-4 w-4" /></button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublicOrderFormScreen;
