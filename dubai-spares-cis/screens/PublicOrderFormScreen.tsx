import React, { useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, Upload, Camera } from 'lucide-react';
import { ensurePublicImageUrls, optimizeImageForUpload } from '../storage/photos';
import { isCloudSyncConfigured, supabase } from '../supabase';
import { BRAND_MODELS, BRANDS, YEARS } from '../constants';
import { Source } from '../types';

type FormStep = 1 | 2 | 3 | 4;

const TOTAL_STEPS = 4;
const DEFAULT_SOURCE: Source = Source.WHATSAPP;
const REQUEST_PART_FIELDS = 3;

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'tg', label: 'Тоҷикӣ' },
  { value: 'ky', label: 'Кыргызча' },
  { value: 'uz', label: 'O‘zbekcha' }
] as const;

type LanguageCode = (typeof LANGUAGE_OPTIONS)[number]['value'];

const translations = {
  en: {
    title: 'Tell us what your car needs.', subtitle: 'Tell us what your car needs, and our experts will find the best options in Dubai.',
    step: 'Step', of: 'of', brand: 'Brand', selectBrand: 'Select brand', model: 'Model', selectModel: 'Select model', typeModel: 'Type model', year: 'Year', selectYear: 'Select year',
    preferredLanguage: 'Preferred Language', selectLanguage: 'Select language', requestedParts: 'Requested parts (up to 3)', part: 'Part', partExample: 'Example: Front brake pads', partPhoto: 'Part photo (optional)',
    vinStepTitle: 'VIN and vehicle photos (optional)', vinPhoto: 'Scan/Upload VIN Photo', carPhoto: 'Upload Car Photo', vinManual: 'Manual VIN entry',
    phone: 'Phone Number / WhatsApp', deliveryCountry: 'Delivery Country', country: 'Country', deliveryCity: 'Delivery City (optional)', city: 'City', deliveryDetails: 'Delivery details (optional)', detailsPlaceholder: 'Area, address notes, preferred delivery info',
    back: 'Back', next: 'Continue', submit: 'Submit Request', submitting: 'Submitting...',
    completeRequired: 'Please complete the required fields before submitting.', unavailable: 'Order form is temporarily unavailable.', failed: 'Failed to submit request.',
    requestReceived: 'Request Received!', thanks: 'We are searching for your parts now. We will contact you on WhatsApp shortly.', another: 'Submit another request',
    publicRequest: 'Public Request', language: 'Language', requestedPartsLabel: 'Requested Parts', delivery: 'Delivery', details: 'Details'
  },
  ru: {
    title: 'Расскажите, что нужно вашему авто.', subtitle: 'Опишите нужные запчасти, и наши эксперты подберут лучшие варианты в Дубае.',
    step: 'Шаг', of: 'из', brand: 'Марка', selectBrand: 'Выберите марку', model: 'Модель', selectModel: 'Выберите модель', typeModel: 'Введите модель', year: 'Год', selectYear: 'Выберите год',
    preferredLanguage: 'Предпочитаемый язык', selectLanguage: 'Выберите язык', requestedParts: 'Нужные запчасти (до 3)', part: 'Деталь', partExample: 'Например: передние тормозные колодки', partPhoto: 'Фото детали (необязательно)',
    vinStepTitle: 'VIN и фото автомобиля (необязательно)', vinPhoto: 'Скан/загрузка фото VIN', carPhoto: 'Загрузить фото авто', vinManual: 'VIN вручную',
    phone: 'Телефон / WhatsApp', deliveryCountry: 'Страна доставки', country: 'Страна', deliveryCity: 'Город доставки (необязательно)', city: 'Город', deliveryDetails: 'Детали доставки (необязательно)', detailsPlaceholder: 'Район, адрес и другая информация для доставки',
    back: 'Назад', next: 'Далее', submit: 'Отправить заявку', submitting: 'Отправка...',
    completeRequired: 'Пожалуйста, заполните обязательные поля перед отправкой.', unavailable: 'Форма заявки временно недоступна.', failed: 'Не удалось отправить заявку.',
    requestReceived: 'Заявка получена!', thanks: 'Мы уже ищем ваши запчасти. Скоро свяжемся с вами в WhatsApp.', another: 'Отправить еще одну заявку',
    publicRequest: 'Публичная заявка', language: 'Язык', requestedPartsLabel: 'Запрошенные запчасти', delivery: 'Доставка', details: 'Детали'
  }
} as const;

interface RequestedPartInput {
  id: string;
  name: string;
  photoData: string | null;
}

const createRequestedPartInputs = (): RequestedPartInput[] =>
  Array.from({ length: REQUEST_PART_FIELDS }, (_, index) => ({
    id: `requested-part-${index + 1}`,
    name: '',
    photoData: null
  }));

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const PublicOrderFormScreen: React.FC = () => {
  const [step, setStep] = useState<FormStep>(1);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<LanguageCode | ''>('');
  const [requestedParts, setRequestedParts] = useState<RequestedPartInput[]>(() => createRequestedPartInputs());
  const [vin, setVin] = useState('');
  const [carPhotoData, setCarPhotoData] = useState<string | null>(null);
  const [vinPhotoData, setVinPhotoData] = useState<string | null>(null);
  const [customerContact, setCustomerContact] = useState('');
  const [deliveryCountry, setDeliveryCountry] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryAddressNote, setDeliveryAddressNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showThanks, setShowThanks] = useState(false);

  const carInputRef = useRef<HTMLInputElement | null>(null);
  const vinInputRef = useRef<HTMLInputElement | null>(null);

  const modelOptions = useMemo(() => BRAND_MODELS[brand] || [], [brand]);
  const selectedLanguage: LanguageCode = preferredLanguage || 'en';
  const locale = selectedLanguage === 'ru' ? translations.ru : translations.en;
  const preferredLanguageLabel = LANGUAGE_OPTIONS.find((item) => item.value === preferredLanguage)?.label || preferredLanguage;

  const handleFileToDataUrl = (file: File, onLoad: (value: string) => void) => {
    const reader = new FileReader();
    reader.onloadend = () => onLoad(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const canContinue =
    (step === 1 && Boolean(brand.trim() && model.trim() && year.trim() && preferredLanguage.trim())) ||
    (step === 2 && Boolean(requestedParts.some((part) => part.name.trim()))) ||
    step === 3 ||
    (step === 4 && Boolean(customerContact.trim() && deliveryCountry.trim()));

  const goNext = () => {
    if (!canContinue) return;
    setStep((current) => Math.min(TOTAL_STEPS, current + 1) as FormStep);
  };

  const goBack = () => setStep((current) => Math.max(1, current - 1) as FormStep);

  const resetForm = () => {
    setStep(1);
    setBrand('');
    setModel('');
    setYear('');
    setPreferredLanguage('');
    setRequestedParts(createRequestedPartInputs());
    setVin('');
    setCarPhotoData(null);
    setVinPhotoData(null);
    setCustomerContact('');
    setDeliveryCountry('');
    setDeliveryCity('');
    setDeliveryAddressNote('');
  };

  const updateRequestedPart = (index: number, updates: Partial<RequestedPartInput>) => {
    setRequestedParts((current) => current.map((part, partIndex) => (partIndex === index ? { ...part, ...updates } : part)));
  };

  const submitOrder = async () => {
    const filledRequestedParts = requestedParts.filter((part) => part.name.trim());

    if (
      !brand.trim() ||
      !model.trim() ||
      !year.trim() ||
      !preferredLanguage.trim() ||
      filledRequestedParts.length === 0 ||
      !customerContact.trim() ||
      !deliveryCountry.trim()
    ) {
      alert(locale.completeRequired);
      return;
    }

    if (!isCloudSyncConfigured || !supabase) {
      alert(locale.unavailable);
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

      const requestedPartsSummary = filledRequestedParts
        .map((part, index) => `${index + 1}. ${part.name.trim()}`)
        .join('\n');

      const deliverySummary = [
        `${locale.country}: ${deliveryCountry.trim()}`,
        deliveryCity.trim() ? `${locale.city}: ${deliveryCity.trim()}` : '',
        deliveryAddressNote.trim() ? `${locale.details}: ${deliveryAddressNote.trim()}` : ''
      ]
        .filter(Boolean)
        .join('\n');

      const notes = [
        {
          id: createId(),
          text: `${locale.publicRequest}\n${locale.language}: ${preferredLanguageLabel.trim()}\n\n${locale.requestedPartsLabel}:\n${requestedPartsSummary}\n\n${locale.delivery}:\n${deliverySummary}`,
          photos: [],
          audios: [],
          createdAt: Date.now()
        }
      ];

      const { error: orderError } = await supabase.from('orders').insert({
        id: orderId,
        brand: brand.trim(),
        model: model.trim(),
        year: year.trim(),
        vin: vin.trim(),
        vin_photo_url: uploadedVinPhotos[0] || null,
        status: 'new_inquiry',
        sales_status: 'Inquiry',
        client_name: 'Public Lead',
        customer_contact: customerContact.trim(),
        source: DEFAULT_SOURCE,
        priority: 'MEDIUM',
        car_photos: uploadedCarPhotos,
        markup_percent: 20,
        exchange_rate: 3.67,
        is_archived: false,
        is_sold: false,
        is_vip: false,
        is_pinned: false,
        is_lead: true,
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

      setShowThanks(true);
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : locale.failed;
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
          <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
            <Check className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{locale.requestReceived}</h1>
          <p className="mt-3 text-base text-slate-200">
            {locale.thanks}
          </p>
          <button
            type="button"
            onClick={() => setShowThanks(false)}
            className="mt-8 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:scale-[1.02]"
          >
            {locale.another}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black px-4 py-6 text-white sm:py-10">
      <div className="mx-auto w-full max-w-2xl rounded-[32px] border border-white/10 bg-white/5 p-5 shadow-[0_25px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.26em] text-slate-300">Dubai Spares Concierge</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{locale.title}</h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">
            {locale.subtitle}
          </p>
        </div>

        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
            <span>{locale.step} {step} {locale.of} {TOTAL_STEPS}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-yellow-100 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="space-y-4 transition-all duration-500">
          {step === 1 && (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.brand}</span>
                <select
                  value={brand}
                  onChange={(e) => {
                    setBrand(e.target.value);
                    setModel('');
                  }}
                  className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-lg outline-none transition focus:border-white/50"
                >
                  <option value="">{locale.selectBrand}</option>
                  {BRANDS.map((item) => (
                    <option key={item} value={item} className="text-slate-900">
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.model}</span>
                {modelOptions.length > 0 ? (
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-lg outline-none transition focus:border-white/50"
                  >
                    <option value="">{locale.selectModel}</option>
                    {modelOptions.map((item) => (
                      <option key={item} value={item} className="text-slate-900">
                        {item}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={locale.typeModel}
                    className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-lg outline-none transition placeholder:text-slate-400 focus:border-white/50"
                  />
                )}
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.year}</span>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-lg outline-none transition focus:border-white/50"
                >
                  <option value="">{locale.selectYear}</option>
                  {YEARS.map((item) => (
                    <option key={item} value={item} className="text-slate-900">
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.preferredLanguage}</span>
                <select
                  value={preferredLanguage}
                  onChange={(e) => setPreferredLanguage(e.target.value)}
                  className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-lg outline-none transition focus:border-white/50"
                >
                  <option value="">{locale.selectLanguage}</option>
                  {LANGUAGE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value} className="text-slate-900">
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.requestedParts}</span>
              {requestedParts.map((part, index) => (
                <div key={part.id} className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
                  <label className="block">
                    <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.part} #{index + 1}</span>
                    <input
                      type="text"
                      value={part.name}
                      onChange={(e) => updateRequestedPart(index, { name: e.target.value })}
                      placeholder={locale.partExample}
                      className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none transition placeholder:text-slate-400 focus:border-white/50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.partPhoto}</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileToDataUrl(file, (value) => updateRequestedPart(index, { photoData: value }));
                      }}
                      className="block w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-xs file:font-semibold file:text-slate-900"
                    />
                    {part.photoData && <span className="mt-2 block text-xs text-emerald-300">{selectedLanguage === 'ru' ? 'Фото выбрано ✓' : 'Photo selected ✓'}</span>}
                  </label>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.vinStepTitle}</span>
              <button
                type="button"
                onClick={() => vinInputRef.current?.click()}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-3xl border border-white/20 bg-white/10 text-sm font-semibold transition hover:bg-white/15"
              >
                <Camera className="h-4 w-4" />
                {locale.vinPhoto} {vinPhotoData ? '✓' : ''}
              </button>
              <input
                ref={vinInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileToDataUrl(file, setVinPhotoData);
                }}
              />

              <button
                type="button"
                onClick={() => carInputRef.current?.click()}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-3xl border border-white/20 bg-white/10 text-sm font-semibold transition hover:bg-white/15"
              >
                <Upload className="h-4 w-4" />
                {locale.carPhoto} {carPhotoData ? '✓' : ''}
              </button>
              <input
                ref={carInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileToDataUrl(file, setCarPhotoData);
                }}
              />

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.vinManual}</span>
                <input
                  type="text"
                  value={vin}
                  onChange={(e) => setVin(e.target.value)}
                  placeholder="WDB123456789..."
                  className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none transition placeholder:text-slate-400 focus:border-white/50"
                />
              </label>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.phone}</span>
                <input
                  type="tel"
                  value={customerContact}
                  onChange={(e) => setCustomerContact(e.target.value)}
                  placeholder="+971..."
                  className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-lg outline-none transition placeholder:text-slate-400 focus:border-white/50"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.deliveryCountry}</span>
                <input
                  type="text"
                  value={deliveryCountry}
                  onChange={(e) => setDeliveryCountry(e.target.value)}
                  placeholder={locale.country}
                  className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none transition placeholder:text-slate-400 focus:border-white/50"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.deliveryCity}</span>
                <input
                  type="text"
                  value={deliveryCity}
                  onChange={(e) => setDeliveryCity(e.target.value)}
                  placeholder={locale.city}
                  className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none transition placeholder:text-slate-400 focus:border-white/50"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">{locale.deliveryDetails}</span>
                <textarea
                  value={deliveryAddressNote}
                  onChange={(e) => setDeliveryAddressNote(e.target.value)}
                  rows={3}
                  placeholder={locale.detailsPlaceholder}
                  className="w-full rounded-[28px] border border-white/15 bg-white/10 px-5 py-4 text-base outline-none transition placeholder:text-slate-400 focus:border-white/50"
                />
              </label>
            </div>
          )}
        </div>

        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1 || isSubmitting}
            className="flex h-12 min-w-[120px] items-center justify-center gap-2 rounded-full border border-white/20 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
            {locale.back}
          </button>

          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canContinue || isSubmitting}
              className="flex h-12 min-w-[140px] items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-slate-950 transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {locale.next}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submitOrder}
              disabled={!canContinue || isSubmitting}
              className="h-12 min-w-[160px] rounded-full bg-gradient-to-r from-amber-200 to-white px-6 text-sm font-semibold text-slate-950 transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? locale.submitting : locale.submit}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublicOrderFormScreen;
