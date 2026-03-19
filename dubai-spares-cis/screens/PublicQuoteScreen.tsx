import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  Images,
  Info,
  Instagram,
  MessageCircle,
  RefreshCcw,
  Send,
} from 'lucide-react';
import ImagePreview from '../components/ImagePreview';
import { copyToClipboard, DEFAULT_QUOTE_RATES, parsePublicQuoteKey, parseQuoteRates, type QuoteCurrency } from '../shareUtils';
import { publicQuoteGetPublicContactSettings, publicQuoteGetSnapshot, resolveClientUnitPriceAed } from '../publicQuoteApi';
import { normalizeGroupItems, normalizePartQuantity } from '../utils/groupItems';
import { calculateCargoEstimates } from '../utils/cargo';
import type { Order } from '../types';

type Language = 'ru' | 'en';
type QuoteContact = { whatsapp: string; telegram: string; instagram: string; managerName: string; logoUrl: string; signatureUrl: string; workTerms: string; deliveryTerms: string };
type QuoteItem = { id: string; name: string; qty: number; unitPriceAed: number; totalAed: number; photos: string[]; note?: string; };

type PublicQuoteScreenProps = { orderId: string };

const i18n = {
  ru: {
    loading: 'Загрузка сметы…',
    retry: 'Повторить',
    invalid: 'Публичная ссылка недействительна.',
    notFound: 'Итоговая смета не найдена или срок ссылки истёк.',
    finalOffer: 'Итоговая публичная смета',
    quoteTotal: 'Итого',
    commercialOffer: 'Коммерческое предложение',
    parts: 'Детали',
    logistics: 'Логистика',
    priceBreakdown: 'Разбивка цены',
    partsSubtotal: 'Сумма деталей',
    delivery: 'Доставка',
    packing: 'Упаковка',
    commission: 'Комиссия',
    total: 'Итого',
    qty: 'Кол-во',
    noPhotos: 'Фото пока не добавлены.',
    workTerms: 'Условия и документы',
    cargo: 'Оценка логистики',
    policyTitle: 'Условия оплаты',
    policyBody: 'Перед оплатой подтвердите все позиции, сроки и логистику с менеджером.',
    downloadPdf: 'Скачать PDF',
    contactManager: 'Связаться с менеджером',
    refresh: 'Обновить',
    copied: 'Ссылка скопирована',
    share: 'Скопировать ссылку',
    contacts: 'Контакты',
    noPositions: 'В смете пока нет позиций с ценами.',
  },
  en: {
    loading: 'Loading quote…',
    retry: 'Retry',
    invalid: 'This public link is invalid.',
    notFound: 'Final quote was not found or the link has expired.',
    finalOffer: 'Final public quote',
    quoteTotal: 'Total',
    commercialOffer: 'Commercial offer',
    parts: 'Parts',
    logistics: 'Logistics',
    priceBreakdown: 'Price breakdown',
    partsSubtotal: 'Parts subtotal',
    delivery: 'Delivery',
    packing: 'Packing',
    commission: 'Commission',
    total: 'Total',
    qty: 'Qty',
    noPhotos: 'Photos are not available yet.',
    workTerms: 'Terms and documents',
    cargo: 'Cargo estimate',
    policyTitle: 'Payment policy',
    policyBody: 'Please confirm all positions, timeline, and logistics with your manager before payment.',
    downloadPdf: 'Download PDF',
    contactManager: 'Contact manager',
    refresh: 'Refresh',
    copied: 'Link copied',
    share: 'Copy link',
    contacts: 'Contacts',
    noPositions: 'There are no priced items in this quote yet.',
  }
} as const;

const digits = (value: string | null | undefined) => (value || '').replace(/\D/g, '');
const money = (value: number, currency: string) => `${value.toFixed(2)} ${currency}`;
const firstString = (...values: unknown[]) => values.find((value) => typeof value === 'string' && value.trim()) as string | undefined;
const firstNumber = (...values: unknown[]) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const normalizeItems = (payload: Record<string, any>): QuoteItem[] => {
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  return parts.map((part: any, index: number) => {
    const qty = normalizePartQuantity(part.qty ?? part.quantity ?? 1);
    const groupItems = normalizeGroupItems(part.group_items || part.groupItems || []);
    const displayName = part.part_kind === 'group' && groupItems.length
      ? `${part.name || 'Group'}: ${groupItems.map((item) => `${item.name} ×${item.quantity}`).join(', ')}`
      : (part.name || `Part ${index + 1}`);
    const unitPriceAed = resolveClientUnitPriceAed(part, { markupPercent: 0 });
    return {
      id: String(part.id || `part-${index}`),
      name: displayName,
      qty,
      unitPriceAed,
      totalAed: unitPriceAed * qty,
      photos: Array.isArray(part.photo_urls) ? part.photo_urls.filter(Boolean) : Array.isArray(part.photos) ? part.photos.filter(Boolean) : [],
      note: firstString(part.note, part.comment),
    };
  }).filter((item) => item.totalAed > 0 || item.photos.length > 0 || item.name);
};

const PublicQuoteScreen: React.FC<PublicQuoteScreenProps> = ({ orderId }) => {
  const [lang, setLang] = useState<Language>('ru');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshotPayload, setSnapshotPayload] = useState<Record<string, any> | null>(null);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const t = i18n[lang];
  const publicKey = useMemo(() => parsePublicQuoteKey(orderId), [orderId]);
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
        publicQuoteGetSnapshot(token, { snapshotId: publicKey?.snapshotId || null }),
        publicQuoteGetPublicContactSettings(),
      ]);
      if (!snapshot?.payload) {
        setSnapshotPayload(null);
        setError(t.notFound);
      } else {
        const payload = snapshot.payload as Record<string, any>;
        payload.public_settings = { ...(payload.public_settings || {}), ...(settings || {}) };
        setSnapshotPayload(payload);
        setExpiresAt(snapshot.expires_at || '');
      }
    } catch (err) {
      setSnapshotPayload(null);
      setError(err instanceof Error ? err.message : t.notFound);
    } finally {
      setIsLoading(false);
    }
  }, [token, publicKey?.snapshotId, t.invalid, t.notFound]);

  useEffect(() => { void loadQuote(); }, [loadQuote]);

  const order = useMemo(() => {
    const raw = snapshotPayload?.order || {};
    return {
      brand: raw.brand || '—',
      model: raw.model || '',
      year: raw.year || '',
      vin: raw.vin || '—',
      bodyType: raw.body_type || raw.bodyType || '',
      logistics: snapshotPayload?.logistics || {},
    } as Partial<Order>;
  }, [snapshotPayload]);

  const rates = useMemo(() => {
    const payloadRates = snapshotPayload?.pricing?.rates || snapshotPayload?.breakdown?.rates || {};
    const parsed = parseQuoteRates(payloadRates, DEFAULT_QUOTE_RATES);
    return parsed;
  }, [snapshotPayload]);

  const currency = useMemo<QuoteCurrency>(() => {
    const raw = String(snapshotPayload?.pricing?.currency || snapshotPayload?.breakdown?.currency || 'USD').toUpperCase();
    return (['AED', 'USD', 'RUB', 'TJS'].includes(raw) ? raw : 'USD') as QuoteCurrency;
  }, [snapshotPayload]);

  const items = useMemo(() => snapshotPayload ? normalizeItems(snapshotPayload) : [], [snapshotPayload]);
  const subtotalAed = useMemo(() => items.reduce((sum, item) => sum + item.totalAed, 0), [items]);
  const deliveryAed = firstNumber(snapshotPayload?.breakdown?.delivery, snapshotPayload?.fees?.logistics, snapshotPayload?.logistics?.deliveryAed, snapshotPayload?.totals?.logistics_aed);
  const packingAed = firstNumber(snapshotPayload?.breakdown?.packaging, snapshotPayload?.fees?.packaging, snapshotPayload?.logistics?.packingAed, snapshotPayload?.totals?.packing_aed);
  const commissionAed = firstNumber(snapshotPayload?.breakdown?.commission, snapshotPayload?.fees?.commission, snapshotPayload?.logistics?.serviceFeeAed, snapshotPayload?.totals?.commission_aed);
  const grandTotalAed = firstNumber(snapshotPayload?.breakdown?.total, snapshotPayload?.totals?.grand_total_aed, subtotalAed + deliveryAed + packingAed + commissionAed);
  const fx = rates[currency] || 1;

  const contact = useMemo<QuoteContact>(() => ({
    whatsapp: digits(firstString(snapshotPayload?.contact?.whatsapp_phone, snapshotPayload?.contacts?.whatsapp, snapshotPayload?.public_contact?.whatsapp, snapshotPayload?.public_settings?.publicWhatsappNumber)),
    telegram: firstString(snapshotPayload?.contact?.telegram, snapshotPayload?.contacts?.telegram, snapshotPayload?.public_contact?.telegram, snapshotPayload?.public_settings?.publicTelegramUrl) || '',
    instagram: firstString(snapshotPayload?.contact?.instagram, snapshotPayload?.contacts?.instagram, snapshotPayload?.public_contact?.instagram, snapshotPayload?.public_settings?.publicInstagramUrl) || '',
    managerName: firstString(snapshotPayload?.public_settings?.publicManagerName, snapshotPayload?.contact?.display_name, snapshotPayload?.owner?.display_name) || 'Dubai Spares UAE',
    logoUrl: firstString(snapshotPayload?.public_settings?.publicCompanyLogoUrl) || '',
    signatureUrl: firstString(snapshotPayload?.public_settings?.publicInvoiceSignatureUrl) || '',
    workTerms: firstString(snapshotPayload?.public_settings?.publicWorkTerms) || '',
    deliveryTerms: firstString(snapshotPayload?.public_settings?.publicDeliveryTerms) || '',
  }), [snapshotPayload]);

  const cargoEstimate = useMemo(() => calculateCargoEstimates({
    logistics: snapshotPayload?.logistics,
    parts: (snapshotPayload?.parts || []).map((part: any) => ({
      quantity: Number(part.qty || part.quantity || 1),
      weightKg: Number(part.weight_kg || part.weightKg || 0),
      places: Number(part.places || 0),
      cargoPlaceGroup: part.cargo_place_group || part.cargoPlaceGroup,
      isOversized: Boolean(part.is_oversized || part.isOversized),
    })),
  } as any, {}), [snapshotPayload]);

  const whatsappHref = contact.whatsapp ? `https://wa.me/${contact.whatsapp}` : '';
  const pdfHref = firstString(snapshotPayload?.pdf_url, snapshotPayload?.invoice_url, snapshotPayload?.documents?.pdf, snapshotPayload?.documents?.invoice) || '';

  const copyLink = async () => {
    await copyToClipboard(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  if (isLoading) {
    return <div className="min-h-screen bg-slate-100 p-6 text-slate-700">{t.loading}</div>;
  }

  if (error || !snapshotPayload) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8">
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
    <div className="min-h-screen bg-slate-100 px-3 py-4 sm:px-6">
      <main className="mx-auto flex max-w-5xl flex-col gap-4 pb-24">
        <section className="rounded-3xl bg-[#0f1f3d] p-6 text-white shadow-[0_16px_40px_rgba(15,31,61,0.24)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">{t.commercialOffer}</p>
              <h1 className="mt-2 text-3xl font-black">{order.brand} {order.model} {order.year}</h1>
              <p className="mt-3 text-sm text-blue-100">{t.finalOffer}</p>
              <div className="mt-4 space-y-1 text-sm text-blue-100">
                <p>VIN: {order.vin}</p>
                {order.bodyType && <p>{order.bodyType}</p>}
                {expiresAt && <p>Valid until: {new Date(expiresAt).toLocaleString()}</p>}
              </div>
            </div>
            <div className="min-w-[220px] rounded-3xl bg-white/10 p-4 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-blue-200">{t.quoteTotal}</p>
              <p className="mt-2 text-4xl font-black">{money(grandTotalAed * fx, currency)}</p>
              <p className="mt-1 text-sm text-blue-100">AED {grandTotalAed.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => setLang((prev) => prev === 'ru' ? 'en' : 'ru')} className="rounded-2xl border border-white/15 px-4 py-2 text-sm font-semibold">{lang === 'ru' ? 'EN' : 'RU'}</button>
            <button type="button" onClick={() => void copyLink()} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 px-4 py-2 text-sm font-semibold"><Copy size={15} /> {copied ? t.copied : t.share}</button>
            <button type="button" onClick={() => void loadQuote()} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 px-4 py-2 text-sm font-semibold"><RefreshCcw size={15} /> {t.refresh}</button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.parts}</h2>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.length === 0 && <p className="px-2 text-sm text-slate-500">{t.noPositions}</p>}
            {items.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                <button type="button" className="flex h-52 w-full items-center justify-center bg-slate-200" onClick={() => item.photos.length && setGallery({ images: item.photos, index: 0 })}>
                  {item.photos[0] ? <img src={item.photos[0]} alt={item.name} className="h-full w-full object-cover" /> : <div className="flex flex-col items-center gap-2 text-slate-500"><Images size={20} /><span className="text-xs">{t.noPhotos}</span></div>}
                </button>
                <div className="space-y-2 p-4">
                  <h3 className="text-base font-bold text-slate-900">{item.name}</h3>
                  {item.note && <p className="text-sm text-slate-500">{item.note}</p>}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-2xl bg-white p-3"><span className="block text-xs uppercase text-slate-400">{t.qty}</span><strong className="text-slate-900">{item.qty}</strong></div>
                    <div className="rounded-2xl bg-white p-3"><span className="block text-xs uppercase text-slate-400">AED</span><strong className="text-slate-900">{item.unitPriceAed.toFixed(2)}</strong></div>
                  </div>
                  <div className="rounded-2xl bg-white p-3 text-sm"><span className="block text-xs uppercase text-slate-400">{t.total}</span><strong className="text-slate-900">{money(item.totalAed * fx, currency)}</strong></div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.priceBreakdown}</h2></div>
            <div className="space-y-3 p-5 text-sm text-slate-700">
              <div className="flex items-center justify-between"><span>{t.partsSubtotal}</span><strong>{money(subtotalAed * fx, currency)}</strong></div>
              <div className="flex items-center justify-between"><span>{t.delivery}</span><strong>{money(deliveryAed * fx, currency)}</strong></div>
              <div className="flex items-center justify-between"><span>{t.packing}</span><strong>{money(packingAed * fx, currency)}</strong></div>
              <div className="flex items-center justify-between"><span>{t.commission}</span><strong>{money(commissionAed * fx, currency)}</strong></div>
              <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base font-bold text-slate-900"><span>{t.total}</span><span>{money(grandTotalAed * fx, currency)}</span></div>
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.logistics}</h2></div>
            <div className="space-y-3 p-5 text-sm text-slate-700">
              <p>{contact.deliveryTerms || '—'}</p>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.cargo}</p>
                <div className="mt-2 space-y-1">
                  <p>Air: {cargoEstimate.air.totalCostUsd.toFixed(2)} USD · ETA {cargoEstimate.air.eta}</p>
                  <p>Container: {cargoEstimate.container.totalCostUsd.toFixed(2)} USD · ETA {cargoEstimate.container.eta}</p>
                  <p>Weight: {cargoEstimate.air.realWeight.toFixed(2)} kg</p>
                  <p>Places: {cargoEstimate.air.totalPlaces}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950 shadow-sm">
          <p className="inline-flex items-center gap-2 font-bold"><Info size={16} /> {t.policyTitle}</p>
          <p className="mt-2">{t.policyBody}</p>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">{t.workTerms}</h2></div>
          <div className="space-y-4 p-5">
            {contact.workTerms ? <p className="text-sm text-slate-700 whitespace-pre-line">{contact.workTerms}</p> : <p className="text-sm text-slate-500">—</p>}
            {pdfHref && <a href={pdfHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"><Download size={15} /> {t.downloadPdf}</a>}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500"><Building2 size={15} /> {t.contacts}</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">{contact.managerName}</h2>
              {contact.logoUrl && <img src={contact.logoUrl} alt="Company logo" className="mt-4 h-16 w-auto object-contain" />}
              {contact.signatureUrl && <img src={contact.signatureUrl} alt="Signature" className="mt-4 h-16 w-auto object-contain" />}
            </div>
            <div className="flex flex-wrap gap-2">
              {whatsappHref && <a href={whatsappHref} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-semibold text-white shadow-sm"><MessageCircle size={15} /> {t.contactManager} <ChevronRight size={14} /></a>}
              {contact.telegram && <a href={contact.telegram} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-800"><Send size={15} /> Telegram</a>}
              {contact.instagram && <a href={contact.instagram} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"><Instagram size={15} /> Instagram</a>}
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600"><CheckCircle2 size={16} className="mt-0.5 text-emerald-500" /> Dubai Spares показывает здесь только финальную смету: позиции, фото, суммы, логистику и контакты.</div>
        </section>
      </main>
      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

export default PublicQuoteScreen;
