import React, { useMemo, useState } from 'react';
import { ensurePublicImageUrls, optimizeImageForUpload } from '../storage/photos';
import { isCloudSyncConfigured, supabase } from '../supabase';
import { Source } from '../types';
import { BRAND_MODELS, SOCIAL_SOURCES } from '../constants';

type Lang = 'en' | 'ru';

const MAJOR_CAR_BRANDS = [
  'Toyota', 'BMW', 'Mercedes-Benz', 'Nissan', 'Honda', 'Hyundai', 'Kia', 'Ford', 'Chevrolet', 'Lexus', 'Audi',
  'Volkswagen', 'Porsche', 'Mitsubishi', 'Mazda', 'Subaru', 'Suzuki', 'Land Rover', 'Jeep', 'Volvo'
];

const YEARS = Array.from({ length: 2026 - 1990 + 1 }, (_, index) => String(2026 - index));

const CHANNEL_OPTIONS: Source[] = SOCIAL_SOURCES;

const i18n: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Quick Order Request',
    subtitle: 'Fill in a short form and we will contact you shortly.',
    brand: 'Car Brand',
    model: 'Model',
    year: 'Year',
    vin: 'VIN (optional)',
    partName: 'Part Name',
    description: 'Comment (optional)',
    contact: 'Phone Number / Contact',
    channel: 'Where are you writing from?',
    uploadPhoto: 'Add car/part photo (optional)',
    uploadVinPhoto: 'Add VIN photo (optional)',
    socialNickname: 'Your nickname (optional)',
    submit: 'Send Request',
    submitting: 'Sending…',
    success: 'Request sent successfully.',
    missingFields: 'Please fill required fields: Part Name, Phone, Channel.',
    unavailable: 'Order form is temporarily unavailable.',
    selectBrand: 'Select or search brand',
    chooseYear: 'Select year',
    chooseChannel: 'Select a channel'
  },
  ru: {
    title: 'Быстрая заявка',
    subtitle: 'Заполните короткую форму — мы скоро свяжемся с вами.',
    brand: 'Марка авто',
    model: 'Модель',
    year: 'Год',
    vin: 'VIN (необязательно)',
    partName: 'Название детали',
    description: 'Комментарий (необязательно)',
    contact: 'Телефон / контакт',
    channel: 'Откуда вы пишете?',
    uploadPhoto: 'Добавить фото авто/детали (необязательно)',
    uploadVinPhoto: 'Добавить фото VIN (необязательно)',
    socialNickname: 'Ваш никнейм',
    submit: 'Отправить заявку',
    submitting: 'Отправка…',
    success: 'Заявка успешно отправлена.',
    missingFields: 'Заполните обязательные поля: деталь, телефон, канал.',
    unavailable: 'Форма временно недоступна.',
    selectBrand: 'Выберите или найдите марку',
    chooseYear: 'Выберите год',
    chooseChannel: 'Выберите канал'
  }
};

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const PublicOrderFormScreen: React.FC = () => {
  const [lang, setLang] = useState<Lang>('ru');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [vin, setVin] = useState('');
  const [partName, setPartName] = useState('');
  const [description, setDescription] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [source, setSource] = useState<Source | ''>('');
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [vinPhotoData, setVinPhotoData] = useState<string | null>(null);
  const [socialNickname, setSocialNickname] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const t = i18n[lang];

  const filteredBrands = useMemo(() => MAJOR_CAR_BRANDS, []);
  const modelOptions = useMemo(() => BRAND_MODELS[brand] || [], [brand]);

  const submitOrder = async () => {
    if (!partName.trim() || !customerContact.trim() || !source) {
      alert(t.missingFields);
      return;
    }

    if (!isCloudSyncConfigured || !supabase) {
      alert(t.unavailable);
      return;
    }

    setIsSubmitting(true);

    try {
      const orderId = createId();
      const partId = createId();
      let uploadedPhotos: string[] = [];
      let uploadedVinPhotos: string[] = [];

      if (photoData) {
        const compressed = await optimizeImageForUpload(photoData, `public-order:${orderId}:${partId}`);
        uploadedPhotos = await ensurePublicImageUrls([compressed], `orders/${orderId}/parts/${partId}`);
      }

      if (vinPhotoData) {
        const compressedVin = await optimizeImageForUpload(vinPhotoData, `public-order:${orderId}:vin`);
        uploadedVinPhotos = await ensurePublicImageUrls([compressedVin], `orders/${orderId}/vin`);
      }

      const now = new Date().toISOString();
      const { error } = await supabase.from('orders').upsert({
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
        social_nickname: socialNickname.trim(),
        source,
        priority: 'MEDIUM',
        car_photos: uploadedPhotos,
        markup_percent: 20,
        exchange_rate: 3.67,
        is_archived: false,
        is_sold: false,
        is_vip: false,
        is_pinned: false,
        is_lead: true,
        notes: [`Part: ${partName.trim()} | ${description.trim() || '-'}`, `Language: ${lang}`],
        created_at: now,
        updated_at: now
      });

      if (error) throw error;

      const { error: partsError } = await supabase.from('parts').upsert({
        id: partId,
        order_id: orderId,
        name: partName.trim(),
        photos: uploadedPhotos,
        photo_url: uploadedPhotos[0] || null,
        is_found: false
      });
      if (partsError) throw partsError;

      setSuccess(true);
      setBrand('');
      setModel('');
      setYear('');
      setVin('');
      setPartName('');
      setSocialNickname('');
      setDescription('');
      setPhotoData(null);
      setVinPhotoData(null);
      setCustomerContact('');
      setSource('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit request.';
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitOrder();
  };

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-4 sm:px-4 sm:py-8 font-sans">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t.title}</h1>
        <p className="mt-1 text-sm leading-5 text-slate-500">{t.subtitle}</p>

        <div className="mt-4 flex gap-2">
          {(['ru', 'en'] as Lang[]).map((code) => (
            <button key={code} type="button" onClick={() => setLang(code)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase ${lang === code ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-600'}`}>
              {code}
            </button>
          ))}
        </div>

        {success && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">✓ {t.success}</div>}

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <select value={brand} onChange={(e) => { setBrand(e.target.value); setModel(''); }} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-700 outline-none focus:border-blue-500">
            <option value="">{t.selectBrand}</option>
            {filteredBrands.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>

          <div className="grid grid-cols-2 gap-2">
            {modelOptions.length > 0 ? (
              <select value={model} onChange={(e) => setModel(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-700 outline-none focus:border-blue-500">
                <option value="">{t.model}</option>
                {modelOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            ) : (
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t.model} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-blue-500" />
            )}
            <select value={year} onChange={(e) => setYear(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-700 outline-none focus:border-blue-500">
              <option value="">{t.chooseYear}</option>
              {YEARS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>

          <input type="text" value={vin} onChange={(e) => setVin(e.target.value)} placeholder={t.vin} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-blue-500" />
          <input value={partName} onChange={(e) => setPartName(e.target.value)} placeholder={t.partName} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-blue-500" required />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t.description} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-blue-500" />
          <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} placeholder={t.contact} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-blue-500" required />

          <select value={source} onChange={(e) => setSource(e.target.value as Source | '')} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-700 outline-none focus:border-blue-500" required>
            <option value="">{t.chooseChannel}</option>
            {CHANNEL_OPTIONS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
          </select>


          {source && (
            <input value={socialNickname} onChange={(e) => setSocialNickname(e.target.value)} placeholder={t.socialNickname} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-blue-500" />
          )}

          <label className="text-xs font-semibold text-slate-500">{t.uploadPhoto}</label>
          <input type="file" accept="image/*" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onloadend = () => setPhotoData(String(reader.result || ''));
            reader.readAsDataURL(file);
          }} className="min-h-11 w-full rounded-xl border border-slate-300 p-2 text-sm" />


          <label className="text-xs font-semibold text-slate-500">{t.uploadVinPhoto}</label>
          <input type="file" accept="image/*" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onloadend = () => setVinPhotoData(String(reader.result || ''));
            reader.readAsDataURL(file);
          }} className="min-h-11 w-full rounded-xl border border-slate-300 p-2 text-sm" />

          <button disabled={isSubmitting} className="min-h-11 w-full rounded-xl bg-blue-600 py-2.5 text-base font-semibold text-white disabled:opacity-50">
            {isSubmitting ? t.submitting : t.submit}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PublicOrderFormScreen;
