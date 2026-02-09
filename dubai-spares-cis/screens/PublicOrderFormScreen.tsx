import React, { useMemo, useRef, useState } from 'react';
import { optimizeImageForUpload, ensurePublicImageUrls } from '../storage/photos';
import { isCloudSyncConfigured, supabase } from '../supabase';

type Lang = 'en' | 'ru' | 'tg' | 'uz' | 'kk';

type AIValidationResult = {
  confidenceScore: number;
  needsClarification: boolean;
  clarificationQuestions: string[];
  smartSuggestion: string;
  vinDecoded: {
    make: string;
    model: string;
    engine: string;
    year?: string;
  } | null;
};

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
    aiLow: 'AI сенімділігі төмен. Деректерді нақтылаңыз.',
    aiStale: 'Өрістерді өзгерткен соң AI тексерісін қайта іске қосыңыз.'
  }
};

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const PublicOrderFormScreen: React.FC = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [lang, setLang] = useState<Lang>('ru');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [vin, setVin] = useState('');
  const [partName, setPartName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [aiResult, setAiResult] = useState<AIValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [lastValidatedFingerprint, setLastValidatedFingerprint] = useState('');
  const [vinConfirmed, setVinConfirmed] = useState<boolean | null>(null);

  const t = i18n[lang];

  const currentFingerprint = useMemo(
    () => JSON.stringify({ brand, model, year, vin, partName, customerContact, lang }),
    [brand, model, year, vin, partName, customerContact, lang]
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
    if (!key) {
      alert(t.aiKeyMissing);
      return;
    }

    setIsValidating(true);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                `You are an expert auto parts consultant. Your goal is to ensure the customer provides: Exact Car Model, Year, VIN (if possible), and specific Part Name. If data is vague (e.g., 'engine part'), ask for clarification. Be polite and professional. Respond in ${lang}. Return strict JSON only with keys: confidenceScore (0..1), needsClarification (boolean), clarificationQuestions (string[]), smartSuggestion (string), vinDecoded ({make,model,engine,year} | null).`
            },
            {
              role: 'user',
              content: JSON.stringify({ brand, model, year, vin, partName, customerContact, language: lang })
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
                required: ['confidenceScore', 'needsClarification', 'clarificationQuestions', 'smartSuggestion', 'vinDecoded'],
                additionalProperties: false
              }
            }
          }
        })
      });

      if (!response.ok) throw new Error(`OpenAI error ${response.status}`);

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content as string;
      if (!content) throw new Error('Empty AI response');

      const parsed = JSON.parse(content) as AIValidationResult;
      setAiResult(parsed);
      setLastValidatedFingerprint(currentFingerprint);
      setVinConfirmed(null);
    } catch {
      alert(t.aiFailed);
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

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!brand || !model || !partName || !customerContact) {
      alert(t.missingFields);
      return;
    }

    if (needsRevalidation || !aiResult) {
      alert(t.aiStale);
      return;
    }

    if (!isAiApproved) {
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

      const { error: orderError } = await supabase.from('orders').insert({
        id: orderId,
        brand,
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
          `Language: ${lang}`
        ],
        sales_status: 'new_inquiry',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      if (orderError) throw orderError;

      const { error: partError } = await supabase.from('parts').insert({
        id: partId,
        order_id: orderId,
        name: partName,
        photos: partPhotos,
        photo_url: partPhotos[0] || null,
        is_found: false
      });

      if (partError) throw partError;

      setSuccess(true);
      setBrand('');
      setModel('');
      setYear('');
      setVin('');
      setPartName('');
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

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <h1 className="text-xl font-black">{t.title}</h1>
        <p className="text-xs text-gray-500">{t.subtitle}</p>

        <div className="flex flex-wrap gap-2">
          {(['en', 'ru', 'tg', 'uz', 'kk'] as Lang[]).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                setLang(code);
                resetAi();
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase border ${lang === code ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
            >
              {code}
            </button>
          ))}
        </div>

        {success && <div className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 p-3 rounded-xl">{t.success}</div>}

        <form onSubmit={onSubmit} className="space-y-3">
          <input value={brand} onChange={(e) => { setBrand(e.target.value); resetAi(); }} placeholder={t.brand} className="w-full p-3 rounded-xl border border-gray-200" />
          <input value={model} onChange={(e) => { setModel(e.target.value); resetAi(); }} placeholder={t.model} className="w-full p-3 rounded-xl border border-gray-200" />
          <input value={year} onChange={(e) => { setYear(e.target.value); resetAi(); }} placeholder={t.year} className="w-full p-3 rounded-xl border border-gray-200" />
          <input value={vin} onChange={(e) => { setVin(e.target.value.toUpperCase()); resetAi(); }} placeholder={t.vin} className="w-full p-3 rounded-xl border border-gray-200 uppercase" />
          <input value={partName} onChange={(e) => { setPartName(e.target.value); resetAi(); }} placeholder={t.partName} className="w-full p-3 rounded-xl border border-gray-200" />
          <input value={customerContact} onChange={(e) => { setCustomerContact(e.target.value); resetAi(); }} placeholder={t.contact} className="w-full p-3 rounded-xl border border-gray-200" />

          <div className="space-y-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="w-full p-3 rounded-xl border border-dashed border-gray-300 text-sm font-bold text-gray-500">{t.uploadPhoto}</button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} className="hidden" />
            {photoData && <img src={photoData} className="w-24 h-24 object-cover rounded-lg border border-gray-100" />}
          </div>

          <button
            type="button"
            disabled={isValidating}
            onClick={runAIValidation}
            className="w-full py-3 rounded-xl bg-violet-600 text-white font-bold disabled:opacity-60"
          >
            {isValidating ? '...' : t.runAi}
          </button>

          {aiResult && (
            <div className={`p-3 rounded-xl border text-xs space-y-2 ${isAiApproved ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
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
                    <button type="button" onClick={() => setVinConfirmed(true)} className={`flex-1 py-2 rounded-lg border ${vinConfirmed === true ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-gray-300'}`}>{t.yes}</button>
                    <button type="button" onClick={() => setVinConfirmed(false)} className={`flex-1 py-2 rounded-lg border ${vinConfirmed === false ? 'bg-red-600 text-white border-red-600' : 'bg-white border-gray-300'}`}>{t.no}</button>
                  </div>
                </div>
              )}
              {isAiApproved && <p className="font-semibold">{t.aiReady}</p>}
            </div>
          )}

          <button disabled={isSubmitting || !isAiApproved} className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold disabled:opacity-50">
            {isSubmitting ? t.submitting : t.submit}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PublicOrderFormScreen;
