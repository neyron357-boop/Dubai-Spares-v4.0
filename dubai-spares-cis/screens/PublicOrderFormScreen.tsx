import React, { useEffect, useMemo, useRef, useState } from 'react';
import { optimizeImageForUpload, ensurePublicImageUrls } from '../storage/photos';
import { isCloudSyncConfigured, supabase } from '../supabase';

type Lang = 'en' | 'ru' | 'tg' | 'uz' | 'kk';

type AIValidationResult = {
  confidenceScore: number;
  needsClarification: boolean;
  clarificationQuestions: string[];
  smartSuggestion: string;
  normalizedBrand: string;
  translatedPartName: string;
  translatedDescription: string;
  photoMatchesPart: boolean;
  photoMatchReason: string;
  vinDecoded: {
    make: string;
    model: string;
    engine: string;
    year?: string;
  } | null;
};

type ValidationInput = {
  brand: string;
  model: string;
  year: string;
  vin: string;
  partName: string;
  description: string;
  customerContact: string;
};

const MAJOR_CAR_BRANDS = [
  'Toyota', 'BMW', 'Mercedes-Benz', 'Nissan', 'Honda', 'Hyundai', 'Kia', 'Ford', 'Chevrolet', 'Lexus', 'Audi',
  'Volkswagen', 'Porsche', 'Mitsubishi', 'Mazda', 'Subaru', 'Suzuki', 'Land Rover', 'Jeep', 'Volvo', 'Peugeot',
  'Renault', 'Skoda', 'Fiat', 'Changan', 'Geely', 'BYD', 'Chery', 'Infiniti', 'Cadillac'
];

const YEARS = Array.from({ length: 2026 - 1990 + 1 }, (_, index) => String(1990 + index));

const AI_CONFIDENCE_THRESHOLD = 0.82;

const i18n: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Order Request',
    subtitle: 'Send your spare part request and we will contact you shortly.',
    brand: 'Car Brand',
    model: 'Model',
    year: 'Year',
    vin: 'VIN',
    partName: 'Part Name',
    description: 'Description',
    contact: 'Phone or Handle',
    uploadPhoto: 'Upload Photo',
    runAi: 'Run AI Validation',
    aiReady: 'AI approved. You can submit now.',
    smartSuggestion: 'Smart Suggestion',
    aiWarning: 'Please answer clarification points before submitting.',
    vinConfirm: 'Is it {year} {make} {model} {engine}?',
    yes: 'Yes',
    no: 'No',
    submit: 'Submit Request',
    submitting: 'Submitting…',
    success: 'Submitted successfully.',
    missingFields: 'Please fill in brand, model, part name, and contact.',
    unavailable: 'Order form is temporarily unavailable.',
    aiKeyMissing: 'AI validator is not configured. Please set VITE_OPENAI_API_KEY.',
    aiFailed: 'AI validation failed. Please try again.',
    aiFallback: 'AI is temporarily unavailable. Basic validation has been applied.',
    aiLow: 'AI confidence is too low. Please improve details first.',
    aiStale: 'Please run AI validation after updating form fields.'
  },
  ru: {
    title: 'Заявка на заказ',
    subtitle: 'Отправьте запрос на запчасть, и мы скоро свяжемся с вами.',
    brand: 'Марка авто',
    model: 'Модель',
    year: 'Год',
    vin: 'VIN',
    partName: 'Название детали',
    description: 'Описание',
    contact: 'Телефон или контакт',
    uploadPhoto: 'Загрузить фото',
    runAi: 'Проверить через ИИ',
    aiReady: 'ИИ одобрил заявку. Теперь можно отправить.',
    smartSuggestion: 'Умная подсказка',
    aiWarning: 'Пожалуйста, уточните замечания ИИ перед отправкой.',
    vinConfirm: 'Это {year} {make} {model} {engine}?',
    yes: 'Да',
    no: 'Нет',
    submit: 'Отправить заявку',
    submitting: 'Отправка…',
    success: 'Заявка успешно отправлена.',
    missingFields: 'Заполните марку, модель, название детали и контакт.',
    unavailable: 'Форма временно недоступна.',
    aiKeyMissing: 'ИИ-валидатор не настроен. Укажите VITE_OPENAI_API_KEY.',
    aiFailed: 'Ошибка проверки ИИ. Попробуйте снова.',
    aiFallback: 'ИИ временно недоступен. Применена базовая проверка.',
    aiLow: 'Низкая уверенность ИИ. Уточните данные.',
    aiStale: 'После изменений снова запустите проверку ИИ.'
  },
  tg: {
    title: 'Дархости фармоиш',
    subtitle: 'Дархости қисмро фиристед, мо ба зудӣ бо шумо тамос мегирем.',
    brand: 'Маркаи мошин',
    model: 'Модел',
    year: 'Сол',
    vin: 'VIN',
    partName: 'Номи қисм',
    description: 'Тавсиф',
    contact: 'Телефон ё контакт',
    uploadPhoto: 'Боркунии акс',
    runAi: 'Санҷиши AI',
    aiReady: 'AI тасдиқ кард. Акнун метавонед фиристонед.',
    smartSuggestion: 'Пешниҳоди оқилона',
    aiWarning: 'Лутфан саволҳои AI-ро равшан кунед.',
    vinConfirm: 'Оё ин {year} {make} {model} {engine} аст?',
    yes: 'Ҳа',
    no: 'Не',
    submit: 'Фиристодани дархост',
    submitting: 'Фиристода истодааст…',
    success: 'Дархост бомуваффақият фиристода шуд.',
    missingFields: 'Марка, модел, номи қисм ва контактро пур кунед.',
    unavailable: 'Форма муваққатан дастнорас аст.',
    aiKeyMissing: 'AI валидатор танзим нашудааст. VITE_OPENAI_API_KEY лозим аст.',
    aiFailed: 'Санҷиши AI ноком шуд. Аз нав кӯшиш кунед.',
    aiFallback: 'AI муваққатан дастнорас аст. Санҷиши базавӣ истифода шуд.',
    aiLow: 'Эътимоди AI паст аст. Маълумотро дақиқ кунед.',
    aiStale: 'Баъди тағйирот санҷиши AI-ро такрор кунед.'
  },
  uz: {
    title: 'Buyurtma so‘rovi',
    subtitle: 'Ehtiyot qism so‘rovini yuboring, tez orada bog‘lanamiz.',
    brand: 'Avto brend',
    model: 'Model',
    year: 'Yil',
    vin: 'VIN',
    partName: 'Qism nomi',
    description: 'Tavsif',
    contact: 'Telefon yoki kontakt',
    uploadPhoto: 'Rasm yuklash',
    runAi: 'AI tekshiruvi',
    aiReady: 'AI tasdiqladi. Endi yuborishingiz mumkin.',
    smartSuggestion: 'Aqlli tavsiya',
    aiWarning: 'Iltimos, AI savollariga aniqlik kiriting.',
    vinConfirm: 'Bu {year} {make} {model} {engine}mi?',
    yes: 'Ha',
    no: 'Yo‘q',
    submit: 'So‘rov yuborish',
    submitting: 'Yuborilmoqda…',
    success: 'So‘rov muvaffaqiyatli yuborildi.',
    missingFields: 'Brend, model, qism nomi va kontaktni kiriting.',
    unavailable: 'Forma vaqtincha mavjud emas.',
    aiKeyMissing: 'AI validator sozlanmagan. VITE_OPENAI_API_KEY kiriting.',
    aiFailed: 'AI tekshiruvi xato berdi. Qayta urinib ko‘ring.',
    aiFallback: 'AI vaqtincha ishlamayapti. Bazaviy tekshiruv qo‘llandi.',
    aiLow: 'AI ishonchi past. Ma’lumotni aniqroq kiriting.',
    aiStale: 'Maydonlar o‘zgarganidan so‘ng AI tekshiruvini qayta ishga tushiring.'
  },
  kk: {
    title: 'Тапсырыс сұранысы',
    subtitle: 'Қосалқы бөлшек сұранысын жіберіңіз, жақын арада хабарласамыз.',
    brand: 'Көлік маркасы',
    model: 'Модель',
    year: 'Жыл',
    vin: 'VIN',
    partName: 'Бөлшек атауы',
    description: 'Сипаттама',
    contact: 'Телефон немесе контакт',
    uploadPhoto: 'Фото жүктеу',
    runAi: 'AI тексеруі',
    aiReady: 'AI мақұлдады. Енді жіберуге болады.',
    smartSuggestion: 'Ақылды ұсыныс',
    aiWarning: 'Жібермес бұрын AI сұрақтарын нақтылаңыз.',
    vinConfirm: 'Бұл {year} {make} {model} {engine} ма?',
    yes: 'Иә',
    no: 'Жоқ',
    submit: 'Сұраныс жіберу',
    submitting: 'Жіберілуде…',
    success: 'Сұраныс сәтті жіберілді.',
    missingFields: 'Марка, модель, бөлшек атауы және контакт толтырыңыз.',
    unavailable: 'Форма уақытша қолжетімсіз.',
    aiKeyMissing: 'AI validator бапталмаған. VITE_OPENAI_API_KEY қажет.',
    aiFailed: 'AI тексерісі сәтсіз. Қайта көріңіз.',
    aiFallback: 'AI уақытша қолжетімсіз. Негізгі тексеру қолданылды.',
    aiLow: 'AI сенімділігі төмен. Деректерді нақтылаңыз.',
    aiStale: 'Өрістерді өзгерткен соң AI тексерісін қайта іске қосыңыз.'
  }
};

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const buildFallbackValidation = (
  values: ValidationInput,
  labels: { brand: string; model: string; year: string; vin: string; partName: string },
  language: Lang
): AIValidationResult => {
  const questions: string[] = [];
  if (!values.brand.trim()) questions.push(`${labels.brand}: ?`);
  if (!values.model.trim()) questions.push(`${labels.model}: ?`);
  if (!values.partName.trim() || values.partName.trim().length < 3) questions.push(`${labels.partName}: ?`);
  if (!values.year.trim() && !values.vin.trim()) questions.push(`${labels.year} / ${labels.vin}: ?`);

  const filledScore = [
    values.brand.trim(),
    values.model.trim(),
    values.partName.trim(),
    values.customerContact.trim(),
    values.year.trim() || values.vin.trim()
  ].filter(Boolean).length;

  const confidence = Math.min(0.95, 0.55 + filledScore * 0.08 - questions.length * 0.12);

  const suggestionByLang: Record<Lang, string> = {
    en: 'Specify part side/position and any OEM code to speed up search.',
    ru: 'Уточните сторону/позицию детали и, если есть, OEM-номер для быстрого подбора.',
    tg: 'Ҷониб/мавқеи қисм ва агар бошад, рақами OEM-ро барои ҷустуҷӯи зудтар нишон диҳед.',
    uz: 'Qismning tomoni/joylashuvi va bo‘lsa OEM kodini kiritsangiz, qidiruv tezlashadi.',
    kk: 'Іздеуді жеделдету үшін бөлшектің жағын/орнын және болса OEM нөмірін нақтылаңыз.'
  };

  return {
    confidenceScore: Number(confidence.toFixed(2)),
    needsClarification: questions.length > 0,
    clarificationQuestions: questions,
    smartSuggestion: suggestionByLang[language],
    normalizedBrand: values.brand.trim(),
    translatedPartName: values.partName.trim(),
    translatedDescription: values.description.trim(),
    photoMatchesPart: true,
    photoMatchReason: 'Photo check was skipped due to AI fallback mode.',
    vinDecoded: null
  };
};

const PublicOrderFormScreen: React.FC = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [lang, setLang] = useState<Lang>('ru');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [vin, setVin] = useState('');
  const [partName, setPartName] = useState('');
  const [description, setDescription] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [aiResult, setAiResult] = useState<AIValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [lastValidatedFingerprint, setLastValidatedFingerprint] = useState('');
  const [vinConfirmed, setVinConfirmed] = useState<boolean | null>(null);
  const [lastAutoSubmitFingerprint, setLastAutoSubmitFingerprint] = useState('');

  const t = i18n[lang];

  const currentFingerprint = useMemo(
    () => JSON.stringify({ brand, model, year, vin, partName, description, customerContact, lang }),
    [brand, model, year, vin, partName, description, customerContact, lang]
  );

  const needsRevalidation = currentFingerprint !== lastValidatedFingerprint;

  const resetAi = () => {
    setAiResult(null);
    setVinConfirmed(null);
    setLastValidatedFingerprint('');
  };

  const onPickPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setPhotoData(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const runAIValidation = async () => {
    const key = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
    const fallbackResult = buildFallbackValidation({ brand, model, year, vin, partName, description, customerContact }, { brand: t.brand, model: t.model, year: t.year, vin: t.vin, partName: t.partName }, lang);

    if (!key) {
      setAiResult(fallbackResult);
      setLastValidatedFingerprint(currentFingerprint);
      setVinConfirmed(null);
      alert(t.aiFallback);
      return;
    }

    setIsValidating(true);
    try {
      const userContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
        {
          type: 'text',
          text: JSON.stringify({ brand, model, year, vin, partName, description, customerContact, language: lang })
        }
      ];

      if (photoData) {
        userContent.push({ type: 'image_url', image_url: { url: photoData } });
      }

      const openAiRequestBody = {
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              `You are an expert auto parts consultant. Analyze the customer's request and image. Translate partName and description into English. Normalize brand to common canonical format in English (e.g., бмв => BMW). Validate if the image appears to match the requested part and explain briefly. Respond in ${lang}. Return strict JSON only with keys: confidenceScore (0..1), needsClarification (boolean), clarificationQuestions (string[]), smartSuggestion (string), normalizedBrand (string), translatedPartName (string), translatedDescription (string), photoMatchesPart (boolean), photoMatchReason (string), vinDecoded ({make,model,engine,year} | null).`
          },
          {
            role: 'user',
            content: userContent
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'public_order_validation',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                confidenceScore: { type: 'number' },
                needsClarification: { type: 'boolean' },
                clarificationQuestions: { type: 'array', items: { type: 'string' } },
                smartSuggestion: { type: 'string' },
                normalizedBrand: { type: 'string' },
                translatedPartName: { type: 'string' },
                translatedDescription: { type: 'string' },
                photoMatchesPart: { type: 'boolean' },
                photoMatchReason: { type: 'string' },
                vinDecoded: {
                  anyOf: [
                    {
                      type: 'object',
                      properties: {
                        make: { type: 'string' },
                        model: { type: 'string' },
                        engine: { type: 'string' },
                        year: { type: 'string' }
                      },
                      required: ['make', 'model', 'engine', 'year'],
                      additionalProperties: false
                    },
                    { type: 'null' }
                  ]
                }
              },
              required: [
                'confidenceScore',
                'needsClarification',
                'clarificationQuestions',
                'smartSuggestion',
                'normalizedBrand',
                'translatedPartName',
                'translatedDescription',
                'photoMatchesPart',
                'photoMatchReason',
                'vinDecoded'
              ],
              additionalProperties: false
            }
          }
        }
      };

      console.log('[PublicOrderForm] OpenAI request', openAiRequestBody);
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify(openAiRequestBody)
      });

      if (!response.ok) throw new Error(`OpenAI error ${response.status}`);

      const data = await response.json();
      console.log('[PublicOrderForm] OpenAI response', data);
      const content = data?.choices?.[0]?.message?.content as string;
      if (!content) throw new Error('Empty AI response');

      const parsed = JSON.parse(content) as AIValidationResult;
      setAiResult(parsed);
      setLastValidatedFingerprint(currentFingerprint);
      setVinConfirmed(null);
    } catch (error) {
      console.error('[PublicOrderForm] OpenAI validation failed', error);
      setAiResult(fallbackResult);
      setLastValidatedFingerprint(currentFingerprint);
      setVinConfirmed(null);
      alert(t.aiFallback);
    } finally {
      setIsValidating(false);
    }
  };

  const isVinConfirmationRequired = Boolean(vin && aiResult?.vinDecoded);
  const isAiApproved = Boolean(
    aiResult &&
      aiResult.confidenceScore >= AI_CONFIDENCE_THRESHOLD &&
      !aiResult.needsClarification &&
      (!isVinConfirmationRequired || vinConfirmed === true) &&
      !needsRevalidation
  );

  const submitOrder = async () => {
    if (!brand || !model || !partName || !customerContact) {
      console.error('[PublicOrderForm] Validation error: missing required fields', { brand, model, partName, customerContact });
      alert(t.missingFields);
      return;
    }

    if (needsRevalidation || !aiResult) {
      alert(t.aiStale);
      return;
    }

    if (!isAiApproved) {
      console.error('[PublicOrderForm] Validation error: AI not approved', { aiResult, needsRevalidation, vinConfirmed });
      alert(t.aiLow);
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

      let partPhotos: string[] = [];
      if (photoData) {
        const compressed = await optimizeImageForUpload(photoData, `public-order:${orderId}:part:${partId}`);
        partPhotos = await ensurePublicImageUrls([compressed], `orders/${orderId}/parts/${partId}`);
      }

      const normalizedBrand = aiResult.normalizedBrand || brand;

      const { error: orderError } = await supabase.from('orders').upsert({
        id: orderId,
        brand: normalizedBrand,
        model,
        year,
        vin,
        status: 'new_inquiry',
        client_name: 'Public Lead',
        customer_contact: customerContact,
        source: 'public_form',
        priority: 'MEDIUM',
        car_photos: [],
        markup_percent: 20,
        exchange_rate: 3.67,
        is_archived: false,
        is_sold: false,
        is_vip: false,
        is_pinned: false,
        is_lead: true,
        notes: [
          `AI confidence: ${aiResult.confidenceScore}`,
          `AI suggestion: ${aiResult.smartSuggestion}`,
          `AI photo matched: ${aiResult.photoMatchesPart ? 'yes' : 'no'} (${aiResult.photoMatchReason})`,
          `Original part name: ${partName}`,
          `English part name: ${aiResult.translatedPartName || partName}`,
          `Original description: ${description || '-'}`,
          `English description: ${aiResult.translatedDescription || description || '-'}`,
          `Language: ${lang}`
        ],
        sales_status: 'new_inquiry',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      if (orderError) throw orderError;
      console.log('[PublicOrderForm] Supabase upsert confirmation: orders', { orderId, normalizedBrand });

      const { error: partError } = await supabase.from('parts').upsert({
        id: partId,
        order_id: orderId,
        name: aiResult.translatedPartName || partName,
        photos: partPhotos,
        photo_url: partPhotos[0] || null,
        is_found: false
      });

      if (partError) throw partError;
      console.log('[PublicOrderForm] Supabase upsert confirmation: parts', { partId, orderId });

      setSuccess(true);
      setBrand('');
      setModel('');
      setYear('');
      setVin('');
      setPartName('');
      setDescription('');
      setCustomerContact('');
      setPhotoData(null);
      resetAi();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit request.';
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isAiApproved || isSubmitting || success) return;
    if (lastAutoSubmitFingerprint === currentFingerprint) return;
    setLastAutoSubmitFingerprint(currentFingerprint);
    void submitOrder();
  }, [isAiApproved, isSubmitting, success, lastAutoSubmitFingerprint, currentFingerprint]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitOrder();
  };

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-4 sm:px-4 sm:py-8">
      <div className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 space-y-4">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">{t.title}</h1>
        <p className="text-sm leading-5 text-slate-500">{t.subtitle}</p>

        <div className="flex flex-wrap gap-2">
          {(['en', 'ru', 'tg', 'uz', 'kk'] as Lang[]).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                setLang(code);
                resetAi();
              }}
              className={`rounded-full border px-3 py-2 text-xs font-bold uppercase ${lang === code ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-600'}`}
            >
              {code}
            </button>
          ))}
        </div>

        {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{t.success}</div>}

        <form onSubmit={onSubmit} className="space-y-3">
          <input list="car-brands" value={brand} onChange={(e) => { setBrand(e.target.value); resetAi(); }} placeholder={t.brand} className="min-h-12 w-full rounded-2xl border border-slate-300 px-4 text-base" />
          <datalist id="car-brands">
            {MAJOR_CAR_BRANDS.map((item) => <option key={item} value={item} />)}
          </datalist>

          <input value={model} onChange={(e) => { setModel(e.target.value); resetAi(); }} placeholder={t.model} className="min-h-12 w-full rounded-2xl border border-slate-300 px-4 text-base" />
          <select value={year} onChange={(e) => { setYear(e.target.value); resetAi(); }} className="min-h-12 w-full rounded-2xl border border-slate-300 px-4 text-base text-slate-700">
            <option value="">{t.year}</option>
            {YEARS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input value={vin} onChange={(e) => { setVin(e.target.value.toUpperCase()); resetAi(); }} placeholder={t.vin} className="min-h-12 w-full rounded-2xl border border-slate-300 px-4 text-base uppercase" />
          <input value={partName} onChange={(e) => { setPartName(e.target.value); resetAi(); }} placeholder={t.partName} className="min-h-12 w-full rounded-2xl border border-slate-300 px-4 text-base" />
          <textarea value={description} onChange={(e) => { setDescription(e.target.value); resetAi(); }} placeholder={t.description} rows={3} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base" />
          <input value={customerContact} onChange={(e) => { setCustomerContact(e.target.value); resetAi(); }} placeholder={t.contact} className="min-h-12 w-full rounded-2xl border border-slate-300 px-4 text-base" />

          <div className="space-y-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="min-h-12 w-full rounded-2xl border border-dashed border-slate-300 p-3 text-sm font-bold text-slate-500">{t.uploadPhoto}</button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} className="hidden" />
            {photoData && <img src={photoData} className="w-24 h-24 object-cover rounded-lg border border-gray-100" />}
          </div>

          <button
            type="button"
            disabled={isValidating}
            onClick={runAIValidation}
            className="min-h-12 w-full rounded-2xl bg-violet-600 py-3 text-base font-bold text-white disabled:opacity-60"
          >
            {isValidating ? '...' : t.runAi}
          </button>

          {aiResult && (
            <div className={`space-y-2 rounded-2xl border p-3 text-sm ${isAiApproved ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              <p className="font-bold">{t.smartSuggestion}</p>
              <p>{aiResult.smartSuggestion}</p>
              {!isAiApproved && <p className="font-semibold">{t.aiWarning}</p>}
              {aiResult.clarificationQuestions.map((q) => (
                <p key={q}>• {q}</p>
              ))}
              {isVinConfirmationRequired && aiResult.vinDecoded && (
                <div className="space-y-2">
                  <p className="font-semibold">
                    {t.vinConfirm
                      .replace('{year}', aiResult.vinDecoded.year || '')
                      .replace('{make}', aiResult.vinDecoded.make)
                      .replace('{model}', aiResult.vinDecoded.model)
                      .replace('{engine}', aiResult.vinDecoded.engine)}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setVinConfirmed(true)} className={`flex-1 rounded-xl border py-3 ${vinConfirmed === true ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 bg-white'}`}>{t.yes}</button>
                    <button type="button" onClick={() => setVinConfirmed(false)} className={`flex-1 rounded-xl border py-3 ${vinConfirmed === false ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 bg-white'}`}>{t.no}</button>
                  </div>
                </div>
              )}
              {isAiApproved && <p className="font-semibold">{t.aiReady}</p>}
            </div>
          )}

          <button disabled={isSubmitting || !isAiApproved} className="min-h-12 w-full rounded-2xl bg-blue-600 py-3 text-base font-bold text-white disabled:opacity-50">
            {isSubmitting ? t.submitting : t.submit}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PublicOrderFormScreen;
