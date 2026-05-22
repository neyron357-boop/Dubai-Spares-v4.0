import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
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
  const [displayCurrency, setDisplayCurrency] = useState<'AED' | 'USD' | 'RUB' | 'TJS' | 'KZT' | 'UZS'>('USD');
  const [translatedItemNames, setTranslatedItemNames] = useState<Record<string, string>>({});
  const [translatedWorkTerms, setTranslatedWorkTerms] = useState('');
  const [translatedDeliveryTerms, setTranslatedDeliveryTerms] = useState('');
  const [activePublicTab, setActivePublicTab] = useState<'quote' | 'proof' | 'deal'>('quote');
  const [isSafeDealOpen, setIsSafeDealOpen] = useState(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [expandedQuoteGroups, setExpandedQuoteGroups] = useState<Record<string, boolean>>({});
  const detailRef = useRef<HTMLDivElement | null>(null);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!isHeaderMenuOpen) return;
    const onOutside = (event: MouseEvent) => {
      if (!headerMenuRef.current?.contains(event.target as Node)) {
        setIsHeaderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [isHeaderMenuOpen]);

  const normalizedSnapshot = useMemo(() => normalizePublicQuoteSnapshotPayload(snapshotPayload), [snapshotPayload]);
  const order = normalizedSnapshot?.order || { brand: '—', model: '', year: '', vin: '—', bodyType: '', carPhotoUrl: '', googleDriveFolderUrl: '' };
  const rates = normalizedSnapshot?.rates || { AED: 1, USD: 0.27, RUB: 21, TJS: 2.6, KZT: 125, UZS: 3400 };
  const currency = normalizedSnapshot?.currency || 'USD';
  const items = normalizedSnapshot?.items || [];
  const subtotalAed = normalizedSnapshot?.subtotalAed || 0;
  const deliveryAed = normalizedSnapshot?.deliveryAed || 0;
  const packingAed = normalizedSnapshot?.packingAed || 0;
  const commissionAed = normalizedSnapshot?.commissionAed || 0;
  const grandTotalAed = normalizedSnapshot?.grandTotalAed || 0;
  const depositAed = normalizedSnapshot?.depositAed || 0;
  const balanceDueAed = normalizedSnapshot?.balanceDueAed ?? grandTotalAed;
  const payableTotalAed = depositAed > 0 ? balanceDueAed : grandTotalAed;
  const orderMediaFolderUrl = normalizedSnapshot?.orderMediaFolderUrl || order.googleDriveFolderUrl || '';
  const proofNotes = normalizedSnapshot?.proofNotes || [];
  const proofPhotoCount = proofNotes.reduce((sum, note) => sum + note.photos.length, 0);
  const proofVideoCount = proofNotes.reduce((sum, note) => sum + note.videoUrls.length, 0);
  const proofAudioCount = proofNotes.reduce((sum, note) => sum + note.audios.length, 0);
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
    ? `Здравствуйте! Подтверждаю смету по ${normalizedSnapshot?.vehicleLabel || 'моему авто'} на сумму ${(payableTotalAed * fx).toFixed(2)} ${activeCurrency}.`
    : `Hello! I confirm the quote for ${normalizedSnapshot?.vehicleLabel || 'my car'} for ${(payableTotalAed * fx).toFixed(2)} ${activeCurrency}.`;
  const whatsappHref = contact.whatsapp ? `https://wa.me/${contact.whatsapp}` : '';
  const whatsappConfirmHref = contact.whatsapp
    ? `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(whatsappConfirmationText)}`
    : '';
  const priceBreakdownRows = [
    { label: t.partsSubtotal, value: money(subtotalAed * fx, activeCurrency), emphasis: false },
    { label: t.delivery, value: money(deliveryAed * fx, activeCurrency), emphasis: false },
    { label: t.packing, value: money(packingAed * fx, activeCurrency), emphasis: false },
    { label: t.commission, value: money(commissionAed * fx, activeCurrency), emphasis: false },
    ...(depositAed > 0 ? [{ label: lang === 'ru' ? 'Депозит' : 'Deposit', value: `-${money(depositAed * fx, activeCurrency)}`, emphasis: true }] : []),
  ];
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
    setDisplayCurrency((normalizedSnapshot?.currency || 'USD') as 'AED' | 'USD' | 'RUB' | 'TJS' | 'KZT' | 'UZS');
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
    <div className="min-h-[100dvh] bg-[#f4f6f8] px-3 pb-[calc(104px+env(safe-area-inset-bottom))] pt-[calc(58px+0.75rem)] sm:px-6">
      <main className="mx-auto flex max-w-5xl flex-col gap-3 sm:gap-4">
        <header className="fixed left-0 right-0 top-0 z-[60] border-b border-white/10 bg-[#08090B] px-3 py-1 text-white shadow-[0_10px_26px_rgba(15,23,42,0.24)] sm:px-6">
          <div className="mx-auto flex h-[50px] max-w-5xl items-center gap-3">
            <button
              type="button"
              onClick={() => order.carPhotoUrl && setGallery({ images: [order.carPhotoUrl], index: 0 })}
              disabled={!order.carPhotoUrl}
              className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/10 text-left shadow-sm transition active:scale-[0.98] disabled:cursor-default"
              aria-label={lang === 'ru' ? 'Открыть фото авто' : 'Open vehicle photo'}
            >
              {order.carPhotoUrl ? (
                <img src={order.carPhotoUrl} alt={`${order.brand} ${order.model}`} className="h-full w-full object-cover" onError={hideOnError} />
              ) : (
                <div className="grid h-full w-full place-items-center text-sm font-black text-white/55">{order.brand?.[0] || '?'}</div>
              )}
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-black leading-5 text-white">
                {order.brand} {order.model} {order.year}
              </p>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] font-bold">
                <span className="truncate text-white/50">{order.bodyType || 'Body'} · VIN {order.vin || '—'}</span>
                <span className="shrink-0 text-emerald-300">{(payableTotalAed * fx).toFixed(2)} {activeCurrency}</span>
              </div>
            </div>

            <div ref={headerMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setIsHeaderMenuOpen((prev) => !prev)}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/10 px-3 text-xs font-black text-white shadow-sm active:scale-[0.98]"
                aria-expanded={isHeaderMenuOpen}
                aria-haspopup="menu"
                aria-label={lang === 'ru' ? 'Настройки сметы' : 'Quote settings'}
              >
                {activeCurrency}
                <ChevronDown size={14} className={`transition-transform ${isHeaderMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isHeaderMenuOpen && (
                <div className="absolute right-0 top-12 z-[70] w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 text-slate-900 shadow-2xl">
                  <p className="px-2 pb-1 pt-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                    {lang === 'ru' ? 'Валюта сметы' : 'Quote currency'}
                  </p>
                  <div className="grid grid-cols-3 gap-1">
                    {(Object.keys(rates) as Array<keyof typeof rates>).map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => {
                          setDisplayCurrency(code);
                          setIsHeaderMenuOpen(false);
                        }}
                        className={`h-9 rounded-xl text-xs font-black ${activeCurrency === code ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
                      >
                        {code}
                      </button>
                    ))}
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-1 border-t border-slate-100 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setLang((prev) => prev === 'ru' ? 'en' : 'ru');
                        setIsHeaderMenuOpen(false);
                      }}
                      className="h-10 rounded-xl bg-slate-50 text-xs font-black text-slate-700 hover:bg-slate-100"
                    >
                      {lang === 'ru' ? 'English' : 'Русский'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsHeaderMenuOpen(false);
                        void loadQuote();
                      }}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-slate-950 text-xs font-black text-white"
                    >
                      <RefreshCcw size={13} /> {t.refresh}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {expiresAt && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 shadow-sm">
            <span className="inline-flex items-center gap-1.5"><Clock3 size={13} /> {t.validUntil}: {new Date(expiresAt).toLocaleDateString()}</span>
          </section>
        )}

        <nav className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Quote tabs">
          <button
            type="button"
            onClick={() => setActivePublicTab('quote')}
            className={`h-10 rounded-lg text-xs font-black transition sm:text-sm ${activePublicTab === 'quote' ? 'bg-slate-950 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            {lang === 'ru' ? 'Смета' : 'Quote'}
          </button>
          <button
            type="button"
            onClick={() => setActivePublicTab('proof')}
            className={`h-10 rounded-lg text-xs font-black transition sm:text-sm ${activePublicTab === 'proof' ? 'bg-slate-950 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            Proof Pack
            {(proofNotes.length > 0 || proofPhotoCount > 0 || proofVideoCount > 0) && <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-[11px]">{proofNotes.length}</span>}
          </button>
          <button
            type="button"
            onClick={() => setActivePublicTab('deal')}
            className={`h-10 rounded-lg text-xs font-black transition sm:text-sm ${activePublicTab === 'deal' ? 'bg-slate-950 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            {lang === 'ru' ? 'Сделка' : 'Deal'}
          </button>
        </nav>

        {activePublicTab === 'quote' ? (
        <>
        {hasCargoRiskMode && (
          <section className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-orange-900 shadow-sm">
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

        <section ref={detailRef} className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.parts}</h2>
          </div>
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.length === 0 && <p className="px-2 text-sm text-slate-500">{t.noPositions}</p>}
            {items.map((item) => {
              const groupItems = item.groupItems || [];
              const isGroupExpanded = !!expandedQuoteGroups[item.id];
              return (
                <article key={item.id} className="grid min-h-[112px] grid-cols-[104px_minmax(0,1fr)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    className="relative flex h-full min-h-[112px] w-full items-center justify-center bg-slate-100"
                    onClick={() => item.photos.length && setGallery({ images: item.photos, index: 0 })}
                    aria-label={lang === 'ru' ? 'Открыть фото детали' : 'Open part photo'}
                  >
                    {item.photos[0]
                      ? <img src={item.photos[0]} alt={translatedItemNames[item.id] || item.name} className="h-full w-full object-cover" onError={hideOnError} />
                      : <div className="flex flex-col items-center gap-1.5 px-2 text-center text-slate-400"><Images size={18} /><span className="text-[10px] font-bold leading-tight">{t.noPhotos}</span></div>
                    }
                    {item.status && (
                      <span className="absolute bottom-1.5 left-1.5 max-w-[88px] truncate rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-slate-700 shadow-sm backdrop-blur-sm">
                        {item.status}
                      </span>
                    )}
                    {item.photos.length > 1 && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-black text-white">
                        +{item.photos.length - 1}
                      </span>
                    )}
                  </button>
                  <div className="min-w-0 p-3">
                    <h3 className="overflow-hidden text-sm font-black leading-5 text-slate-950 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{translatedItemNames[item.id] || item.name}</h3>
                    {item.note && <p className="mt-1 truncate text-xs font-semibold text-slate-500">{item.note}</p>}
                    {groupItems.length > 0 && (
                      <div className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => setExpandedQuoteGroups((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                          className="flex w-full items-center justify-between gap-2 text-left text-[10px] font-black text-slate-600"
                          aria-expanded={isGroupExpanded}
                        >
                          <span className="truncate">{lang === 'ru' ? 'Состав группы' : 'Group items'} · {groupItems.length}</span>
                          <ChevronDown size={12} className={`shrink-0 transition-transform ${isGroupExpanded ? 'rotate-180' : ''}`} />
                        </button>
                        {isGroupExpanded && (
                          <div className="mt-1 grid gap-1">
                            {groupItems.map((groupItem, groupIndex) => (
                              <div key={`${item.id}-group-${groupItem.id || groupIndex}`} className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1 text-[10px] font-bold text-slate-600">
                                <span className="min-w-0 truncate">{groupItem.name}</span>
                                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-500">×{groupItem.quantity}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
                      <div className="rounded-md bg-slate-50 px-2 py-1.5"><span className="block text-[10px] uppercase text-slate-400">{t.qty}</span><strong className="text-slate-900">{item.qty}</strong></div>
                      <div className="rounded-md bg-slate-50 px-2 py-1.5"><span className="block text-[10px] uppercase text-slate-400">{activeCurrency}</span><strong className="text-slate-900">{(item.unitPriceAed * fx).toFixed(2)}</strong></div>
                      <div className="rounded-md bg-slate-950 px-2 py-1.5 text-white"><span className="block text-[10px] uppercase text-white/45">{t.total}</span><strong>{(item.totalAed * fx).toFixed(2)}</strong></div>
                    </div>
                    {item.googleDriveVideoUrl && (
                      <a
                        href={item.googleDriveVideoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 text-xs font-black text-sky-800 shadow-sm transition hover:bg-sky-100 active:scale-[0.99]"
                      >
                        <PlayCircle size={14} /> {lang === 'ru' ? 'Видео' : 'Video'} <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {orderMediaFolderUrl && (
          <section className="rounded-xl border border-sky-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-700">
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
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.99]"
              >
                <FolderOpen size={16} /> {t.openFolder} <ExternalLink size={13} />
              </a>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]"><Info size={14} /> {t.policyTitle}</p>
          {(translatedWorkTerms || contact.workTerms) && <p className="mt-2 whitespace-pre-line">{translatedWorkTerms || contact.workTerms}</p>}
          <p className="mt-2 text-amber-800/90">{t.policyBody}</p>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t.priceBreakdown}</h2>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {priceBreakdownRows.map((row) => (
                <div key={row.label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <span className="block truncate text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{row.label}</span>
                  <strong className={`mt-1 block truncate text-sm ${row.emphasis ? 'text-emerald-700' : 'text-slate-900'}`}>{row.value}</strong>
                </div>
              ))}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-950 px-4 py-3 text-white">
                <span className="block text-[11px] font-bold uppercase tracking-[0.1em] text-white/50">{t.total}</span>
                <strong className="mt-1 block text-lg leading-none">{money(grandTotalAed * fx, activeCurrency)}</strong>
              </div>
              {depositAed > 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
                  <span className="block text-[11px] font-bold uppercase tracking-[0.1em] text-emerald-600">{lang === 'ru' ? 'К оплате' : 'Balance due'}</span>
                  <strong className="mt-1 block text-lg leading-none">{money(balanceDueAed * fx, activeCurrency)}</strong>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.workTerms}</h2></div>
          <div className="space-y-4 p-5">
            {(translatedWorkTerms || contact.workTerms) ? <p className="text-sm whitespace-pre-line text-slate-700">{translatedWorkTerms || contact.workTerms}</p> : <p className="text-sm text-slate-500">—</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleOpenInvoice}
                className="inline-flex h-10 items-center gap-2 self-start rounded-lg border border-[#2b648d]/20 bg-[#f4f8fb] px-3 text-sm font-semibold text-[#2b648d] shadow-sm transition hover:bg-[#edf5fa] active:scale-[0.99]"
              >
                <FileText size={15} /> Invoice A4
              </button>
              {documentButtons.map((doc) => (
                <a key={`${doc.kind}-${doc.href}`} href={doc.href} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 self-start rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]">
                  <Download size={15} /> {doc.label}
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-6 p-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <ul className="space-y-2 text-sm text-slate-700">
                <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {lang === 'ru' ? 'Нам доверяют клиенты из СНГ' : 'Trusted by CIS customers'}</li>
                <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {lang === 'ru' ? 'Мы ежедневно работаем с авторазборками и магазинами Дубая.' : 'We work with Dubai scrap yards & shops daily.'}</li>
                <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {lang === 'ru' ? 'Скорость ответа: обычно 5–15 минут.' : 'Response time: usually 5–15 min.'}</li>
              </ul>
            </div>
            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="inline-flex items-center gap-2 font-bold text-slate-800"><Building2 size={16} /> {t.companyProfile}: Stark Motors</p>
                {contact.logoUrl && <img src={contact.logoUrl} alt="Company logo" className="h-20 w-auto max-w-[360px] object-contain" />}
              </div>
              <p className="text-sm text-slate-600">{t.trustNote}</p>
            </div>
          </div>
        </section>
        </>
        ) : activePublicTab === 'proof' ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Proof Pack</p>
              <h2 className="mt-1 text-xl font-black text-slate-900">{lang === 'ru' ? 'Фото, видео и комментарии по заказу' : 'Photos, videos and order notes'}</h2>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] font-bold text-slate-400">Фото</p><p className="text-sm font-black text-slate-900">{proofPhotoCount}</p></div>
              <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] font-bold text-slate-400">Видео</p><p className="text-sm font-black text-slate-900">{proofVideoCount}</p></div>
              <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] font-bold text-slate-400">Голос</p><p className="text-sm font-black text-slate-900">{proofAudioCount}</p></div>
            </div>
          </div>

          {proofNotes.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <Images size={24} className="mx-auto text-slate-400" />
              <p className="mt-2 text-sm font-bold text-slate-500">{lang === 'ru' ? 'Пруфы пока не добавлены.' : 'No proof items have been added yet.'}</p>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {proofNotes.map((note) => (
                <article key={note.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  {note.createdAt > 0 && (
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                      {new Date(note.createdAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')}
                    </p>
                  )}
                  {note.text && <p className="whitespace-pre-line text-sm font-semibold leading-6 text-slate-700">{note.text}</p>}
                  {note.photos.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {note.photos.map((photo, index) => (
                        <button key={`${note.id}-${photo}-${index}`} type="button" onClick={() => setGallery({ images: note.photos, index })} className="relative aspect-square overflow-hidden rounded-lg bg-slate-200">
                          <img src={photo} alt="Proof" className="h-full w-full object-cover" onError={hideOnError} />
                        </button>
                      ))}
                    </div>
                  )}
                  {note.videoUrls.length > 0 && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {note.videoUrls.map((url, index) => (
                        <a key={`${note.id}-video-${index}`} href={url} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 text-sm font-bold text-sky-800">
                          <PlayCircle size={16} /> {lang === 'ru' ? 'Смотреть видео' : 'Watch video'} <ExternalLink size={13} />
                        </a>
                      ))}
                    </div>
                  )}
                  {note.audios.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {note.audios.map((audio, index) => (
                        <div key={`${note.id}-audio-${audio.id}-${index}`} className="rounded-lg bg-white p-3">
                          <audio src={audio.fileUrl} controls preload="metadata" className="w-full" />
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
        ) : (
        <section className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setIsSafeDealOpen((prev) => !prev)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left"
              aria-expanded={isSafeDealOpen}
            >
              <span className="flex min-w-0 items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                  <ShieldCheck size={19} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-black uppercase tracking-[0.14em] text-slate-500">{lang === 'ru' ? 'Безопасная сделка' : 'Safe sales process'}</span>
                  <span className="mt-1 block text-base font-black text-slate-950">{lang === 'ru' ? 'Условия сделки и защита клиента' : 'Deal terms and client protection'}</span>
                </span>
              </span>
              <ChevronRight size={18} className={`shrink-0 text-slate-400 transition-transform ${isSafeDealOpen ? 'rotate-90' : ''}`} />
            </button>

            {isSafeDealOpen && (
              <div className="border-t border-slate-100 p-4 pt-3">
                <div className="grid gap-2 sm:grid-cols-2">
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
                    <div key={line} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" /> {line}
                    </div>
                  ))}
                </div>
                <a href={trustPageHref} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700">
                  <ShieldCheck size={14} /> {lang === 'ru' ? 'Как мы работаем' : 'How it works'} <ExternalLink size={12} />
                </a>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{lang === 'ru' ? 'Статус заказа' : 'Order timeline'}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {publicTimeline.map((step) => (
                <div key={step.label} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${step.done ? 'bg-emerald-50 text-emerald-800' : step.current ? 'bg-blue-50 text-blue-800' : 'bg-slate-50 text-slate-500'}`}>
                  {step.done ? <CheckCircle2 size={15} className="shrink-0" /> : <Clock3 size={15} className="shrink-0" />}
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500"><Building2 size={15} /> {t.contacts}</p>
              <h2 className="mt-1 text-xl font-black text-slate-900">{contact.managerName}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {whatsappHref && <a href={whatsappHref} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-500 px-3 text-sm font-semibold text-white shadow-sm"><MessageCircle size={15} /> WhatsApp</a>}
              {contact.telegram && <a href={contact.telegram} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 text-sm font-semibold text-sky-800"><Send size={15} /> Telegram</a>}
              {contact.instagram && <a href={contact.instagram} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700"><Instagram size={15} /> Instagram</a>}
            </div>
          </div>
        </section>

        {contact.signatureUrl && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t.officialSignature}</p>
            <div className="mt-3 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{t.signature}</p>
              <div className="mt-2 min-h-[74px]">
                <img src={contact.signatureUrl} alt="Owner signature" className="h-20 w-auto object-contain" />
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
              <p className="text-xl font-black leading-none text-[#0f1f3d]">{(payableTotalAed * fx).toFixed(2)} <span className="text-sm font-semibold text-slate-500">{activeCurrency}</span></p>
            </div>
            <a href={whatsappConfirmHref || whatsappHref} target="_blank" rel="noreferrer" className="inline-flex h-12 shrink-0 items-center gap-2 rounded-lg bg-emerald-500 px-5 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-400 active:scale-[0.98]">
              <MessageCircle size={17} /> {t.contactManager}
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicQuoteScreen;
