import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Images,
  Info,
  Instagram,
  MessageCircle,
  PlayCircle,
  RefreshCcw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import ImagePreview from '../components/ImagePreview';
import { parsePublicQuoteKey } from '../shareUtils';
import { publicQuoteGetPublicContactSettings, publicQuoteGetSnapshot } from '../publicQuoteApi';
import { normalizePublicQuoteSnapshotPayload } from '../utils/publicQuoteSnapshot';
import { buildInvoicePayloadFromSnapshot, openInvoicePrintWindow } from '../utils/invoiceDocument';
import { analyzeAutoPartText, resolveAutoPartTranslation } from '../utils/autoPartAi';
import { isFragilePartName } from '../utils/safetySales';

type Language = 'ru' | 'en';
type PublicQuoteScreenProps = { orderId: string };

type QuoteDocument = {
  href: string;
  label: string;
  kind: 'invoice' | 'pdf' | 'document' | 'cargo';
};

const i18n = {
  ru: {
    loading: 'Загрузка сметы…',
    retry: 'Повторить',
    invalid: 'Публичная ссылка недействительна.',
    notFound: 'Итоговая смета не найдена или срок ссылки истёк.',
    finalOffer: 'Итоговая публичная смета',
    quoteTotal: 'Итоговая цена',
    commercialOffer: 'Коммерческое предложение',
    parts: 'Галерея деталей',
    logistics: 'Логистика',
    priceBreakdown: 'Разбивка цены',
    partsSubtotal: 'Сумма деталей',
    delivery: 'Доставка',
    packing: 'Упаковка',
    commission: 'Комиссия',
    total: 'Итого',
    qty: 'Кол-во',
    noPhotos: 'Фотографии для этой детали пока недоступны.',
    watchVideo: 'Смотреть видео',
    orderMaterials: 'Все материалы заказа',
    orderMaterialsHelper: 'Видео, оригинальные фото и дополнительные файлы по вашему заказу.',
    openFolder: 'Открыть папку',
    workTerms: 'Условия и документы',
    cargo: 'Оценка логистики',
    policyTitle: 'Условия оплаты',
    policyBody: 'Перед оплатой подтвердите все позиции, сроки и логистику с менеджером.',
    downloadPdf: 'Скачать PDF смету',
    downloadCargoPdf: 'Карго и логистика',
    downloadFile: 'Скачать документ',
    contactManager: 'Подтвердить в WhatsApp',
    refresh: 'Обновить',
    copied: 'Ссылка скопирована',
    share: 'Скопировать ссылку',
    contacts: 'Контакты',
    noPositions: 'В смете пока нет позиций с ценами.',
    viewParts: 'Перейти к галерее деталей',
    trustedSupplierBadge: 'Проверенный поставщик UAE',
    fastResponseBadge: 'Ответ 5–15 мин',
    validUntil: 'Цена действует до',
    companyProfile: 'Профиль компании',
    trustNote: 'Stark Motors показывает здесь только финальную смету: позиции, фото, суммы, логистику и контакты.',
    signature: 'Подпись',
    signatureMissing: 'Подпись не настроена',
    officialSignature: 'Официальная подпись',
    cargoHelper: 'Информационный расчёт для понимания сроков и бюджета доставки.',
    country: 'Страна',
    weight: 'Вес',
    totalPlaces: 'Мест',
    air: 'Авиа',
    container: 'Контейнер',
    eta: 'Срок',
  },
  en: {
    loading: 'Loading quote…',
    retry: 'Retry',
    invalid: 'This public link is invalid.',
    notFound: 'Final quote was not found or the link has expired.',
    finalOffer: 'Final public quote',
    quoteTotal: 'Quote total',
    commercialOffer: 'Commercial offer',
    parts: 'Parts gallery',
    logistics: 'Logistics',
    priceBreakdown: 'Price breakdown',
    partsSubtotal: 'Parts subtotal',
    delivery: 'Delivery',
    packing: 'Packing',
    commission: 'Commission',
    total: 'Total',
    qty: 'Qty',
    noPhotos: 'Photos are not available for this part yet.',
    watchVideo: 'Watch video',
    orderMaterials: 'All order materials',
    orderMaterialsHelper: 'Videos, original photos, and extra files for your order.',
    openFolder: 'Open folder',
    workTerms: 'Terms and documents',
    cargo: 'Cargo estimates',
    policyTitle: 'Payment policy',
    policyBody: 'Please confirm all positions, timeline, and logistics with your manager before payment.',
    downloadPdf: 'Download PDF Quote',
    downloadCargoPdf: 'Cargo & Logistics',
    downloadFile: 'Download document',
    contactManager: 'Confirm & WhatsApp',
    refresh: 'Refresh',
    copied: 'Link copied',
    share: 'Copy link',
    contacts: 'Contacts',
    noPositions: 'There are no priced items in this quote yet.',
    viewParts: 'Go to Parts Gallery',
    trustedSupplierBadge: 'Verified UAE supplier',
    fastResponseBadge: 'Reply in 5–15 min',
    validUntil: 'Price valid until',
    companyProfile: 'Company profile',
    trustNote: 'Stark Motors shows only the final quote here: parts, photos, totals, logistics, and contacts.',
    signature: 'Signature',
    signatureMissing: 'Signature is not configured',
    officialSignature: 'Official signature',
    cargoHelper: 'Informational estimate for planning delivery timeline and budget.',
    country: 'Country',
    weight: 'Weight',
    totalPlaces: 'Total places',
    air: 'Air',
    container: 'Container',
    eta: 'ETA',
  }
} as const;

const money = (value: number, currency: string) => `${value.toFixed(2)} ${currency}`;

const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  (e.currentTarget as HTMLImageElement).style.display = 'none';
};

const dedupeDocuments = (docs: QuoteDocument[]) => {
  const seen = new Set<string>();
  return docs.filter((doc) => {
    const key = `${doc.kind}:${doc.href}`;
    if (!doc.href || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const PublicQuoteScreen: React.FC<PublicQuoteScreenProps> = ({ orderId }) => {
  const [lang, setLang] = useState<Language>('ru');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshotPayload, setSnapshotPayload] = useState<Record<string, any> | null>(null);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [displayCurrency, setDisplayCurrency] = useState<'AED' | 'USD' | 'RUB' | 'TJS' | 'KZT'>('USD');
  const [translatedItemNames, setTranslatedItemNames] = useState<Record<string, string>>({});
  const [translatedWorkTerms, setTranslatedWorkTerms] = useState('');
  const [translatedDeliveryTerms, setTranslatedDeliveryTerms] = useState('');
  const detailRef = useRef<HTMLDivElement | null>(null);

  const t = i18n[lang];
  const publicKey = useMemo(() => {
    const hash = window.location.hash;
    const queryIdx = hash.indexOf('?');
    const searchStr = queryIdx !== -1 ? hash.slice(queryIdx) : window.location.search;
    return parsePublicQuoteKey(new URLSearchParams(searchStr), orderId);
  }, [orderId]);
  const token = publicKey?.value || orderId;

  const loadQuote = useCallback(async () => {
    if (!token) {
      setError(t.invalid);
      setSnapshotPayload(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [snapshot, settings] = await Promise.all([
        publicQuoteGetSnapshot(token, { snapshotId: publicKey?.snapshotId || publicKey?.urlSnapshot || null }),
        publicQuoteGetPublicContactSettings(),
      ]);
      const normalizedPayload = normalizePublicQuoteSnapshotPayload(snapshot?.payload, settings || {});
      if (!normalizedPayload?.hasRenderableContent) {
        setSnapshotPayload(null);
        setError(snapshot?.isPayloadCorrupted ? 'Не удалось загрузить смету' : t.notFound);
      } else {
        setSnapshotPayload(normalizedPayload.raw);
        setExpiresAt(snapshot?.expires_at || '');
      }
    } catch (err) {
      setSnapshotPayload(null);
      setError(err instanceof Error ? err.message : t.notFound);
    } finally {
      setIsLoading(false);
    }
  }, [token, publicKey?.snapshotId, publicKey?.urlSnapshot, t.invalid, t.notFound]);

  useEffect(() => { void loadQuote(); }, [loadQuote]);

  const normalizedSnapshot = useMemo(() => normalizePublicQuoteSnapshotPayload(snapshotPayload), [snapshotPayload]);
  const order = normalizedSnapshot?.order || { brand: '—', model: '', year: '', vin: '—', bodyType: '', carPhotoUrl: '', googleDriveFolderUrl: '' };
  const rates = normalizedSnapshot?.rates || { AED: 1, USD: 0.27, RUB: 21, TJS: 2.6 };
  const currency = normalizedSnapshot?.currency || 'USD';
  const items = normalizedSnapshot?.items || [];
  const subtotalAed = normalizedSnapshot?.subtotalAed || 0;
  const deliveryAed = normalizedSnapshot?.deliveryAed || 0;
  const packingAed = normalizedSnapshot?.packingAed || 0;
  const commissionAed = normalizedSnapshot?.commissionAed || 0;
  const grandTotalAed = normalizedSnapshot?.grandTotalAed || 0;
  const orderMediaFolderUrl = normalizedSnapshot?.orderMediaFolderUrl || order.googleDriveFolderUrl || '';
  const activeCurrency = (displayCurrency || currency) as keyof typeof rates;
  const fx = rates[activeCurrency] || 1;
  const contact = normalizedSnapshot?.contact || { whatsapp: '', telegram: '', instagram: '', managerName: 'Stark Motors', logoUrl: '', signatureUrl: '', workTerms: '', deliveryTerms: '' };
  const fragileQuoteItems = useMemo(() => items.filter((item) => isFragilePartName(item.name) || item.unitPriceAed >= 2500), [items]);
  const hasCargoRiskMode = fragileQuoteItems.length > 0 || packingAed > 0 || deliveryAed > 0 || Boolean(normalizedSnapshot?.cargoInput?.logistics?.cargoCountry);
  const publicTimeline = useMemo(() => ([
    { label: lang === 'ru' ? 'Заявка получена' : 'Request received', done: true },
    { label: lang === 'ru' ? 'Данные авто проверены' : 'Vehicle data checked', done: Boolean(order.vin && order.vin !== '—') },
    { label: lang === 'ru' ? 'Вариант найден' : 'Option found', done: items.length > 0 },
    { label: lang === 'ru' ? 'Ожидается оплата' : 'Waiting for payment', done: grandTotalAed > 0, current: grandTotalAed > 0 },
    { label: lang === 'ru' ? 'Закупка после оплаты' : 'Purchase after payment', done: false },
    { label: lang === 'ru' ? 'Проверка и упаковка' : 'Inspection and packing', done: false },
    { label: lang === 'ru' ? 'Передача в cargo' : 'Cargo handover', done: false }
  ]), [grandTotalAed, items.length, lang, order.vin]);
  const trustPageHref = `${window.location.origin}${window.location.pathname}#/trust`;

  const whatsappConfirmationText = lang === 'ru'
    ? `Здравствуйте! Подтверждаю смету по ${normalizedSnapshot?.vehicleLabel || 'моему авто'} на сумму ${(grandTotalAed * fx).toFixed(2)} ${activeCurrency}.`
    : `Hello! I confirm the quote for ${normalizedSnapshot?.vehicleLabel || 'my car'} for ${(grandTotalAed * fx).toFixed(2)} ${activeCurrency}.`;
  const whatsappHref = contact.whatsapp ? `https://wa.me/${contact.whatsapp}` : '';
  const whatsappConfirmHref = contact.whatsapp
    ? `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(whatsappConfirmationText)}`
    : '';
  const documentButtons = useMemo(() => {
    const docs = (normalizedSnapshot?.documents || []).filter((doc) => doc.kind !== 'cargo');
    return dedupeDocuments(docs.map((doc) => {
      if (doc.kind === 'invoice') {
        return { ...doc, label: doc.label || t.downloadPdf, kind: 'invoice' as const };
      }
      return { ...doc, label: doc.label || t.downloadFile, kind: doc.kind };
    }));
  }, [normalizedSnapshot?.documents, t.downloadFile, t.downloadPdf]);

  useEffect(() => {
    setDisplayCurrency((normalizedSnapshot?.currency || 'USD') as 'AED' | 'USD' | 'RUB' | 'TJS' | 'KZT');
  }, [normalizedSnapshot?.currency]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(items.map(async (item) => {
      const analysis = await analyzeAutoPartText(item.name);
      return [item.id, resolveAutoPartTranslation(analysis, item.name, lang)] as const;
    })).then((entries) => {
      if (!cancelled) setTranslatedItemNames(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [items, lang]);

  useEffect(() => {
    let cancelled = false;
    const translateBlock = async (value: string, setter: (next: string) => void) => {
      const lines = String(value || '').split(/\n+/).map((item) => item.trim()).filter(Boolean);
      if (!lines.length) {
        setter('');
        return;
      }
      const translated = await Promise.all(lines.map(async (line) => {
        const analysis = await analyzeAutoPartText(line);
        return resolveAutoPartTranslation(analysis, line, lang);
      }));
      if (!cancelled) setter(translated.join('\n'));
    };
    void Promise.all([
      translateBlock(contact.workTerms, setTranslatedWorkTerms),
      translateBlock(contact.deliveryTerms, setTranslatedDeliveryTerms),
    ]);
    return () => {
      cancelled = true;
    };
  }, [contact.deliveryTerms, contact.workTerms, lang]);

  const handleOpenInvoice = () => {
    if (!normalizedSnapshot) return;
    const opened = openInvoicePrintWindow(buildInvoicePayloadFromSnapshot(normalizedSnapshot, {
      currency: activeCurrency,
      rate: fx,
      language: lang,
    }));
    if (!opened) window.alert(lang === 'ru' ? 'Не удалось открыть invoice. Проверьте блокировку всплывающих окон.' : 'Unable to open invoice. Please check your pop-up blocker.');
  };

  if (isLoading) {
    return <div className="min-h-[100dvh] bg-slate-100 p-6 text-slate-700">{t.loading}</div>;
  }

  if (error || !snapshotPayload) {
    return (
      <div className="min-h-[100dvh] bg-slate-100 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-rose-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3 text-rose-700">
            <AlertCircle className="mt-0.5" size={20} />
            <div>
              <h1 className="text-xl font-bold">{t.finalOffer}</h1>
              <p className="mt-2 text-sm">{error || t.notFound}</p>
            </div>
          </div>
          <button type="button" onClick={() => void loadQuote()} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
            <RefreshCcw size={15} /> {t.retry}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-100 px-3 py-4 pb-[calc(104px+env(safe-area-inset-bottom))] sm:px-6">
      <main className="mx-auto flex max-w-5xl flex-col gap-4">
        <section className="overflow-hidden rounded-3xl bg-[#0f1f3d] text-white shadow-[0_16px_40px_rgba(15,31,61,0.24)]">
          {order.carPhotoUrl && (
            <div className="relative h-52 w-full sm:h-64">
              <img
                src={order.carPhotoUrl}
                alt={`${order.brand} ${order.model}`}
                className="h-full w-full object-cover"
                onError={hideOnError}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0f1f3d]/80 via-transparent to-transparent" />
            </div>
          )}
          <div className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">{t.commercialOffer}</p>
                <h1 className="mt-2 text-3xl font-black">🚘 {order.brand} {order.model} {order.year}</h1>
                <p className="mt-3 text-sm text-blue-100">{t.finalOffer}</p>
                <div className="mt-4 space-y-1 text-sm text-blue-100">
                  <p>VIN: {order.vin}</p>
                  {order.bodyType && <p>{order.bodyType}</p>}
                </div>
              </div>
              <div className="min-w-[220px] rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-900 shadow-none">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.quoteTotal}</p>
                <p className="mt-1 text-4xl font-black leading-none text-[#0f1f3d]">{(grandTotalAed * fx).toFixed(2)}</p>
                <p className="mt-0.5 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{activeCurrency}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(Object.keys(rates) as Array<keyof typeof rates>).map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setDisplayCurrency(code)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${activeCurrency === code ? 'bg-[#0f1f3d] text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2.5">
              {whatsappHref && (
                <a href={whatsappHref} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center gap-2 rounded-2xl bg-emerald-500 px-5 text-sm font-semibold text-white transition hover:bg-emerald-400 active:scale-[0.98]">
                  <MessageCircle size={17} /> {t.contactManager} <ChevronRight size={14} />
                </a>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-600">
              {expiresAt && <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-3 py-1.5 text-[11px] font-semibold text-amber-800"><Clock3 size={12} /> {t.validUntil}: {new Date(expiresAt).toLocaleDateString()}</span>}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => setLang((prev) => prev === 'ru' ? 'en' : 'ru')} className="rounded-2xl border border-white/15 px-4 py-2 text-sm font-semibold">{lang === 'ru' ? 'EN' : 'RU'}</button>
              <button type="button" onClick={() => void loadQuote()} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 px-4 py-2 text-sm font-semibold"><RefreshCcw size={15} /> {t.refresh}</button>
            </div>
          </div>
            </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{lang === 'ru' ? 'Безопасная сделка' : 'Safe sales process'}</p>
                <h2 className="mt-2 text-xl font-black text-slate-900">{lang === 'ru' ? 'Сначала условия и оплата, потом закупка' : 'Terms and payment first, purchase second'}</h2>
              </div>
              <a href={trustPageHref} target="_blank" rel="noreferrer" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700">
                <ShieldCheck size={14} /> {lang === 'ru' ? 'Как мы работаем' : 'How it works'}
              </a>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {(lang === 'ru'
                ? [
                  'Депозит запускает реальный поиск и работу с поставщиками.',
                  'Полная предоплата нужна до закупки детали под конкретного клиента.',
                  'Фото, видео и состояние фиксируются в Proof Pack.',
                  'После передачи в cargo ответственность за перевозку несёт перевозчик.'
                ]
                : [
                  'A deposit starts real supplier search and market work.',
                  'Full prepayment is required before buying a client-specific part.',
                  'Photos, videos and condition notes are kept in the Proof Pack.',
                  'After cargo handover, transport liability belongs to the carrier.'
                ]).map((line) => (
                <div key={line} className="flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" /> {line}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{lang === 'ru' ? 'Статус заказа' : 'Order timeline'}</p>
            <div className="mt-4 space-y-2">
              {publicTimeline.map((step) => (
                <div key={step.label} className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold ${step.done ? 'bg-emerald-50 text-emerald-800' : step.current ? 'bg-blue-50 text-blue-800' : 'bg-slate-50 text-slate-500'}`}>
                  {step.done ? <CheckCircle2 size={15} className="shrink-0" /> : <Clock3 size={15} className="shrink-0" />}
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {hasCargoRiskMode && (
          <section className="rounded-3xl border border-orange-200 bg-orange-50 p-5 text-orange-900 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em]">{lang === 'ru' ? 'Fragile item warning' : 'Fragile item warning'}</p>
                <h2 className="mt-2 text-lg font-black">{lang === 'ru' ? 'Хрупкая/дорогая деталь требует отдельного cargo risk' : 'Fragile or high-value parts require cargo risk handling'}</h2>
                <p className="mt-2 text-sm font-semibold text-orange-800">
                  {lang === 'ru'
                    ? 'Нужна усиленная упаковка, фото/видео упаковки и проверка при получении. После передачи в cargo риск повреждения переходит к перевозчику.'
                    : 'Extra packing, packing photos/video and inspection on delivery are required. After cargo handover, damage risk belongs to the carrier.'}
                </p>
                {fragileQuoteItems.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {fragileQuoteItems.slice(0, 4).map((item) => (
                      <span key={item.id} className="rounded-xl bg-white px-2.5 py-1 text-[11px] font-black text-orange-700">{translatedItemNames[item.id] || item.name}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        <section ref={detailRef} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.parts}</h2>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.length === 0 && <p className="px-2 text-sm text-slate-500">{t.noPositions}</p>}
            {items.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                <button type="button" className="relative flex h-52 w-full items-center justify-center bg-slate-200" onClick={() => item.photos.length && setGallery({ images: item.photos, index: 0 })}>
                  {item.photos[0]
                    ? <img src={item.photos[0]} alt={translatedItemNames[item.id] || item.name} className="h-full w-full object-cover" onError={hideOnError} />
                    : <div className="flex flex-col items-center gap-2 text-slate-500"><Images size={20} /><span className="text-xs">{t.noPhotos}</span></div>
                  }
                  {item.status && (
                    <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur-sm">
                      {item.status}
                    </span>
                  )}
                </button>
                <div className="space-y-2 p-4">
                  <h3 className="text-base font-bold text-slate-900">{translatedItemNames[item.id] || item.name}</h3>
                  {item.note && <p className="text-sm text-slate-500">{item.note}</p>}
                  {item.googleDriveVideoUrl && (
                    <a
                      href={item.googleDriveVideoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-3 text-sm font-bold text-sky-800 shadow-sm transition hover:bg-sky-100 active:scale-[0.99]"
                    >
                      <PlayCircle size={16} /> {t.watchVideo} <ExternalLink size={13} />
                    </a>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-2xl bg-white p-3"><span className="block text-xs uppercase text-slate-400">{t.qty}</span><strong className="text-slate-900">{item.qty}</strong></div>
                    <div className="rounded-2xl bg-white p-3"><span className="block text-xs uppercase text-slate-400">{activeCurrency}</span><strong className="text-slate-900">{(item.unitPriceAed * fx).toFixed(2)}</strong></div>
                  </div>
                  <div className="rounded-2xl bg-white p-3 text-sm"><span className="block text-xs uppercase text-slate-400">{t.total}</span><strong className="text-slate-900">{money(item.totalAed * fx, activeCurrency)}</strong></div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {orderMediaFolderUrl && (
          <section className="rounded-3xl border border-sky-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-700">
                  <FolderOpen size={20} />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900">{t.orderMaterials}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t.orderMaterialsHelper}</p>
                </div>
              </div>
              <a
                href={orderMediaFolderUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.99]"
              >
                <FolderOpen size={16} /> {t.openFolder} <ExternalLink size={13} />
              </a>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-3xl border border-amber-200/80 bg-gradient-to-b from-amber-50 to-white p-5 text-sm text-amber-900 shadow-[0_12px_26px_rgba(180,83,9,0.09)]">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]"><Info size={14} /> {t.policyTitle}</p>
          {(translatedWorkTerms || contact.workTerms) && <p className="mt-2 whitespace-pre-line">{translatedWorkTerms || contact.workTerms}</p>}
          <p className="mt-2 text-amber-800/90">{t.policyBody}</p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_26px_rgba(15,23,42,0.06)]">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t.priceBreakdown}</h2>
          </div>
          <div className="divide-y divide-slate-100 px-5">
            <div className="flex items-center justify-between py-3 text-sm"><span className="text-slate-600">{t.partsSubtotal}</span><strong className="text-slate-900">{money(subtotalAed * fx, activeCurrency)}</strong></div>
            <div className="flex items-center justify-between py-3 text-sm"><span className="text-slate-600">{t.delivery}</span><strong className="text-slate-900">{money(deliveryAed * fx, activeCurrency)}</strong></div>
            <div className="flex items-center justify-between py-3 text-sm"><span className="text-slate-600">{t.packing}</span><strong className="text-slate-900">{money(packingAed * fx, activeCurrency)}</strong></div>
            <div className="flex items-center justify-between py-3 text-sm"><span className="text-slate-600">{t.commission}</span><strong className="text-slate-900">{money(commissionAed * fx, activeCurrency)}</strong></div>
            <div className="flex items-center justify-between py-3 text-base font-bold"><span className="text-slate-900">{t.total}</span><span className="text-[#0f1f3d]">{money(grandTotalAed * fx, activeCurrency)}</span></div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.workTerms}</h2></div>
          <div className="space-y-4 p-5">
            {(translatedWorkTerms || contact.workTerms) ? <p className="text-sm whitespace-pre-line text-slate-700">{translatedWorkTerms || contact.workTerms}</p> : <p className="text-sm text-slate-500">—</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleOpenInvoice}
                className="inline-flex h-11 items-center gap-2 self-start rounded-2xl border border-[#2b648d]/20 bg-[#f4f8fb] px-4 text-sm font-semibold text-[#2b648d] shadow-sm transition hover:bg-[#edf5fa] active:scale-[0.99]"
              >
                <FileText size={15} /> Invoice A4
              </button>
              {documentButtons.map((doc) => (
                <a key={`${doc.kind}-${doc.href}`} href={doc.href} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 self-start rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]">
                  <Download size={15} /> {doc.label}
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_26px_rgba(15,23,42,0.06)]">
          <div className="grid gap-6 p-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <ul className="space-y-2 text-sm text-slate-700">
                <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {lang === 'ru' ? 'Нам доверяют клиенты из СНГ' : 'Trusted by CIS customers'}</li>
                <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {lang === 'ru' ? 'Мы ежедневно работаем с авторазборками и магазинами Дубая.' : 'We work with Dubai scrap yards & shops daily.'}</li>
                <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {lang === 'ru' ? 'Скорость ответа: обычно 5–15 минут.' : 'Response time: usually 5–15 min.'}</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-slate-50 to-white p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="inline-flex items-center gap-2 font-bold text-slate-800"><Building2 size={16} /> {t.companyProfile}: {contact.managerName || 'Stark Motors'}</p>
                {contact.logoUrl && <img src={contact.logoUrl} alt="Company logo" className="h-20 w-auto max-w-[360px] object-contain" />}
              </div>
              <p className="text-sm text-slate-600">{t.trustNote}</p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500"><Building2 size={15} /> {t.contacts}</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">{contact.managerName}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {whatsappHref && <a href={whatsappHref} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-semibold text-white shadow-sm"><MessageCircle size={15} /> WhatsApp</a>}
              {contact.telegram && <a href={contact.telegram} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-800"><Send size={15} /> Telegram</a>}
              {contact.instagram && <a href={contact.instagram} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"><Instagram size={15} /> Instagram</a>}
            </div>
          </div>
        </section>

        {(contact.signatureUrl || contact.managerName) && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_10px_26px_rgba(15,23,42,0.06)]">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t.officialSignature}</p>
            <div className="mt-3 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{lang === 'ru' ? 'Имя и фамилия' : 'Name'}</p>
                <p className="mt-2 text-lg font-bold text-[#0f1f3d]">{contact.managerName || (lang === 'ru' ? 'Не указано' : 'Not specified')}</p>
              </div>
              <div className="sm:text-right">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{t.signature}</p>
                <div className="mt-2 min-h-[74px]">
                  {contact.signatureUrl ? (
                    <img src={contact.signatureUrl} alt="Owner signature" className="h-20 w-auto object-contain sm:ml-auto" />
                  ) : (
                    <p className="text-sm text-slate-400">{t.signatureMissing}</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
      {whatsappHref && grandTotalAed > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t.quoteTotal}</p>
              <p className="text-xl font-black leading-none text-[#0f1f3d]">{(grandTotalAed * fx).toFixed(2)} <span className="text-sm font-semibold text-slate-500">{activeCurrency}</span></p>
            </div>
            <a href={whatsappConfirmHref || whatsappHref} target="_blank" rel="noreferrer" className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-emerald-500 px-5 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-400 active:scale-[0.98]">
              <MessageCircle size={17} /> {t.contactManager}
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicQuoteScreen;
