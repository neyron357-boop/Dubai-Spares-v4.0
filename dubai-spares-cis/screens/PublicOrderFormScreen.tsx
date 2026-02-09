import React, { useMemo, useRef, useState } from 'react';
import { ensurePublicImageUrls, optimizeImageForUpload } from '../storage/photos';
import { isCloudSyncConfigured, supabase } from '../supabase';

type Lang = 'en' | 'ru' | 'tg' | 'uz' | 'kk';

const MAJOR_CAR_BRANDS = [
  'Toyota', 'BMW', 'Mercedes-Benz', 'Nissan', 'Honda', 'Hyundai', 'Kia', 'Ford', 'Chevrolet', 'Lexus', 'Audi',
  'Volkswagen', 'Porsche', 'Mitsubishi', 'Mazda', 'Subaru', 'Suzuki', 'Land Rover', 'Jeep', 'Volvo', 'Peugeot',
  'Renault', 'Skoda', 'Fiat', 'Changan', 'Geely', 'BYD', 'Chery', 'Infiniti', 'Cadillac'
];

const YEARS = Array.from({ length: 2026 - 1990 + 1 }, (_, index) => String(2026 - index));

const i18n: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Order Request',
    subtitle: 'Send your spare part request and we will contact you shortly.',
    brand: 'Car Brand',
    model: 'Model',
    year: 'Year',
    vin: 'VIN (optional)',
    partName: 'Part Name',
    description: 'Description (optional)',
    contact: 'Phone Number / Contact',
    uploadPhoto: 'Add Photo (optional)',
    submit: 'Send Request',
    submitting: 'Sending…',
    success: 'Request sent successfully.',
    missingFields: 'Please fill in Part Name and Phone Number.',
    unavailable: 'Order form is temporarily unavailable.',
    selectBrand: 'Select or search brand',
    chooseYear: 'Select year',
    required: 'Required',
    optional: 'Optional'
  },
  ru: {
    title: 'Заявка на заказ',
    subtitle: 'Отправьте запрос на запчасть, и мы скоро свяжемся с вами.',
    brand: 'Марка авто',
    model: 'Модель',
    year: 'Год',
    vin: 'VIN (необязательно)',
    partName: 'Название детали',
    description: 'Описание (необязательно)',
    contact: 'Номер телефона / контакт',
    uploadPhoto: 'Добавить фото (необязательно)',
    submit: 'Отправить заявку',
    submitting: 'Отправка…',
    success: 'Заявка успешно отправлена.',
    missingFields: 'Заполните название детали и номер телефона.',
    unavailable: 'Форма временно недоступна.',
    selectBrand: 'Выберите или найдите марку',
    chooseYear: 'Выберите год',
    required: 'Обязательно',
    optional: 'Необязательно'
  },
  tg: {
    title: 'Дархости фармоиш',
    subtitle: 'Дархости қисмро фиристед, мо ба зудӣ бо шумо тамос мегирем.',
    brand: 'Маркаи мошин',
    model: 'Модел',
    year: 'Сол',
    vin: 'VIN (ихтиёрӣ)',
    partName: 'Номи қисм',
    description: 'Тавсиф (ихтиёрӣ)',
    contact: 'Рақами телефон / контакт',
    uploadPhoto: 'Иловаи акс (ихтиёрӣ)',
    submit: 'Фиристодани дархост',
    submitting: 'Фиристода истодааст…',
    success: 'Дархост бомуваффақият фиристода шуд.',
    missingFields: 'Номи қисм ва рақами телефонро пур кунед.',
    unavailable: 'Форма муваққатан дастнорас аст.',
    selectBrand: 'Маркаро интихоб ё ҷустуҷӯ кунед',
    chooseYear: 'Солро интихоб кунед',
    required: 'Ҳатмӣ',
    optional: 'Ихтиёрӣ'
  },
  uz: {
    title: 'Buyurtma so‘rovi',
    subtitle: 'Ehtiyot qism so‘rovini yuboring, tez orada siz bilan bog‘lanamiz.',
    brand: 'Avto brend',
    model: 'Model',
    year: 'Yil',
    vin: 'VIN (ixtiyoriy)',
    partName: 'Qism nomi',
    description: 'Tavsif (ixtiyoriy)',
    contact: 'Telefon raqam / kontakt',
    uploadPhoto: 'Rasm qo‘shish (ixtiyoriy)',
    submit: 'So‘rov yuborish',
    submitting: 'Yuborilmoqda…',
    success: 'So‘rov muvaffaqiyatli yuborildi.',
    missingFields: 'Qism nomi va telefon raqamini kiriting.',
    unavailable: 'Forma vaqtincha mavjud emas.',
    selectBrand: 'Brendni tanlang yoki qidiring',
    chooseYear: 'Yilni tanlang',
    required: 'Majburiy',
    optional: 'Ixtiyoriy'
  },
  kk: {
    title: 'Тапсырыс сұранысы',
    subtitle: 'Қосалқы бөлшек сұранысын жіберіңіз, жақын арада хабарласамыз.',
    brand: 'Көлік маркасы',
    model: 'Модель',
    year: 'Жыл',
    vin: 'VIN (міндетті емес)',
    partName: 'Бөлшек атауы',
    description: 'Сипаттама (міндетті емес)',
    contact: 'Телефон нөмірі / контакт',
    uploadPhoto: 'Фото қосу (міндетті емес)',
    submit: 'Сұраныс жіберу',
    submitting: 'Жіберілуде…',
    success: 'Сұраныс сәтті жіберілді.',
    missingFields: 'Бөлшек атауы мен телефон нөмірін толтырыңыз.',
    unavailable: 'Форма уақытша қолжетімсіз.',
    selectBrand: 'Марканы таңдаңыз немесе іздеңіз',
    chooseYear: 'Жылды таңдаңыз',
    required: 'Міндетті',
    optional: 'Міндетті емес'
  }
};

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

interface PartDraft {
  id: string;
  name: string;
  description: string;
  photoData: string | null;
}

const PublicOrderFormScreen: React.FC = () => {
  const [lang, setLang] = useState<Lang>('ru');
  const [brand, setBrand] = useState('');
  const [brandQuery, setBrandQuery] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [vin, setVin] = useState('');
  const [clientName, setClientName] = useState('');
  const [parts, setParts] = useState<PartDraft[]>([{ id: createId(), name: '', description: '', photoData: null }]);
  const [customerContact, setCustomerContact] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const t = i18n[lang];

  const filteredBrands = useMemo(() => {
    const query = brandQuery.trim().toLowerCase();
    if (!query) return MAJOR_CAR_BRANDS;
    return MAJOR_CAR_BRANDS.filter((item) => item.toLowerCase().includes(query));
  }, [brandQuery]);

  const onPickPhoto = (event: React.ChangeEvent<HTMLInputElement>, partId: string) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const photoData = String(reader.result || '');
      setParts((current) => current.map((part) => (part.id === partId ? { ...part, photoData } : part)));
    };
    reader.readAsDataURL(file);
  };

  const updatePart = (partId: string, patch: Partial<PartDraft>) => {
    setParts((current) => current.map((part) => (part.id === partId ? { ...part, ...patch } : part)));
  };

  const addPart = () => {
    setParts((current) => [...current, { id: createId(), name: '', description: '', photoData: null }]);
  };

  const removePart = (partId: string) => {
    setParts((current) => {
      if (current.length <= 1) return current;
      return current.filter((part) => part.id !== partId);
    });
  };

  const submitOrder = async () => {
    const validParts = parts.filter((part) => part.name.trim());

    if (validParts.length === 0 || !customerContact.trim()) {
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
      const uploadedPartRows = await Promise.all(
        validParts.map(async (part) => {
          let uploadedPhotos: string[] = [];
          if (part.photoData) {
            const compressed = await optimizeImageForUpload(part.photoData, `public-order:${orderId}:${part.id}`);
            uploadedPhotos = await ensurePublicImageUrls([compressed], `orders/${orderId}/parts/${part.id}`);
          }

          return {
            id: createId(),
            order_id: orderId,
            name: part.name.trim(),
            photos: uploadedPhotos,
            photo_url: uploadedPhotos[0] || null,
            is_found: false
          };
        })
      );

      const now = new Date().toISOString();
      const { error } = await supabase.from('orders').upsert({
        id: orderId,
        brand: brand || null,
        model: model || null,
        year: year || null,
        vin: vin || null,
        status: 'new_inquiry',
        sales_status: 'new_inquiry',
        client_name: clientName.trim() || 'Public Lead',
        customer_contact: customerContact,
        source: 'public_form',
        priority: 'MEDIUM',
        car_photos: uploadedPartRows.flatMap((part) => part.photos || []).slice(0, 3),
        markup_percent: 20,
        exchange_rate: 3.67,
        is_archived: false,
        is_sold: false,
        is_vip: false,
        is_pinned: false,
        is_lead: true,
        notes: [
          ...validParts.map((part, index) => `Part ${index + 1}: ${part.name.trim()} | ${part.description.trim() || '-'}`),
          `Language: ${lang}`
        ],
        created_at: now,
        updated_at: now
      });

      if (error) throw error;

      const { error: partsError } = await supabase.from('parts').upsert(uploadedPartRows);
      if (partsError) throw partsError;

      setSuccess(true);
      setBrand('');
      setBrandQuery('');
      setModel('');
      setYear('');
      setVin('');
      setClientName('');
      setParts([{ id: createId(), name: '', description: '', photoData: null }]);
      setCustomerContact('');
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

        <div className="mt-4 flex flex-wrap gap-2">
          {(['en', 'ru', 'tg', 'uz', 'kk'] as Lang[]).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase ${lang === code ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-600'}`}
            >
              {code}
            </button>
          ))}
        </div>

        {success && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">✓</span>
            <span>{t.success}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-slate-700">Имя клиента <span className="text-xs text-slate-400">({t.optional})</span></label>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-blue-500" />

          <label className="block text-sm font-medium text-slate-700">{t.brand}</label>
          <input
            value={brandQuery}
            onChange={(e) => {
              setBrandQuery(e.target.value);
              setBrand(e.target.value);
            }}
            placeholder={t.selectBrand}
            className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-blue-500"
            list="brand-options"
          />
          <datalist id="brand-options">
            {filteredBrands.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>

          <label className="block text-sm font-medium text-slate-700">{t.model}</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-blue-500" />

          <label className="block text-sm font-medium text-slate-700">{t.year}</label>
          <select value={year} onChange={(e) => setYear(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-700 outline-none focus:border-blue-500">
            <option value="">{t.chooseYear}</option>
            {YEARS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>

          <label className="block text-sm font-medium text-slate-700">{t.vin} <span className="text-xs text-slate-400">({t.optional})</span></label>
          <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base uppercase outline-none focus:border-blue-500" />

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            {parts.map((part, index) => (
              <div key={part.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Деталь {index + 1}</p>
                  {parts.length > 1 && (
                    <button type="button" onClick={() => removePart(part.id)} className="text-xs font-semibold text-rose-500">
                      Удалить
                    </button>
                  )}
                </div>
                <label className="block text-sm font-medium text-slate-700">{t.partName} <span className="text-xs text-rose-500">({t.required})</span></label>
                <input value={part.name} onChange={(e) => updatePart(part.id, { name: e.target.value })} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-blue-500" required={index === 0} />

                <label className="block text-sm font-medium text-slate-700">{t.description} <span className="text-xs text-slate-400">({t.optional})</span></label>
                <textarea value={part.description} onChange={(e) => updatePart(part.id, { description: e.target.value })} rows={2} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-blue-500" />

                <input id={`part-photo-${part.id}`} type="file" accept="image/*" onChange={(e) => onPickPhoto(e, part.id)} className="hidden" />
                <button type="button" onClick={() => document.getElementById(`part-photo-${part.id}`)?.click()} className="min-h-11 w-full rounded-xl border border-dashed border-slate-300 p-3 text-sm font-medium text-slate-600">{t.uploadPhoto}</button>
                {part.photoData && <img src={part.photoData} className="h-24 w-24 rounded-lg border border-gray-100 object-cover" />}
              </div>
            ))}

            <button type="button" onClick={addPart} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700">
              + Добавить ещё деталь
            </button>
          </div>

          <label className="block text-sm font-medium text-slate-700">{t.contact} <span className="text-xs text-rose-500">({t.required})</span></label>
          <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-blue-500" required />

          <button disabled={isSubmitting} className="min-h-11 w-full rounded-xl bg-blue-600 py-2.5 text-base font-semibold text-white disabled:opacity-50">
            {isSubmitting ? t.submitting : t.submit}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PublicOrderFormScreen;
