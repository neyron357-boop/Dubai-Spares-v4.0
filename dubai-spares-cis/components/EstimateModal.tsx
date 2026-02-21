import React, { useMemo, useState } from 'react';
import { Order } from '../types';
import { X, CheckCircle2, Share2, RefreshCcw, Images } from 'lucide-react';
import { DEFAULT_QUOTE_RATES, QuoteCurrency, QuoteRates } from '../shareUtils';
import ImagePreview from './ImagePreview';
import { useAppSettings } from '../appSettings';
import { toast } from '../feedback';

interface Props {
  order: Order;
  onClose: () => void;
  onShare: (options: { rates: QuoteRates; currency: QuoteCurrency }) => void | Promise<void>;
}

const CURRENCY_META: Record<QuoteCurrency, { label: string; symbol: string }> = {
  AED: { label: 'Дирхам', symbol: 'AED' },
  USD: { label: 'Доллар', symbol: 'USD' },
  RUB: { label: 'Рубль', symbol: 'RUB' },
  TJS: { label: 'Сомони', symbol: 'TJS' }
};

const pickRate = (code: QuoteCurrency, apiRates: Record<string, number>) => {
  const value = apiRates[code];
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_QUOTE_RATES[code];
};

const fetchLiveQuoteRates = async (): Promise<QuoteRates> => {
  const response = await fetch('https://open.er-api.com/v6/latest/AED');
  if (!response.ok) throw new Error(`Currency API error: ${response.status}`);
  const payload = await response.json();
  const apiRates = payload?.rates || {};

  return {
    AED: 1,
    USD: pickRate('USD', apiRates),
    RUB: pickRate('RUB', apiRates),
    TJS: pickRate('TJS', apiRates)
  };
};

const EstimateModal: React.FC<Props> = ({ order, onClose, onShare }) => {
  const foundParts = order.parts.filter(p => p.isFound && p.variants.length > 0);
  const [rates, setRates] = useState<QuoteRates>(DEFAULT_QUOTE_RATES);
  const [currency, setCurrency] = useState<QuoteCurrency>('USD');
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [rateNotice, setRateNotice] = useState('');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const { settings } = useAppSettings();

  const isFixedMarkup = (order.markupType || 'percent') === 'fixed';
  const fixedMarkupTotal = Number(order.markupFixedAed || 0);
  const fixedMarkupPerPart = isFixedMarkup && foundParts.length > 0 ? fixedMarkupTotal / foundParts.length : 0;

  const totalAed = foundParts.reduce((sum, p) => {
    const costAed = p.variants[0].priceAed;
    const sellAed = isFixedMarkup
      ? costAed + fixedMarkupPerPart
      : costAed * (1 + order.markupPercent / 100);
    return sum + sellAed;
  }, 0);

  const logistics = {
    deliveryAed: Number(order.logistics?.deliveryAed || 0),
    packingAed: Number(order.logistics?.packingAed || 0),
    serviceFeeAed: Number(order.logistics?.serviceFeeAed || 0)
  };
  const finalTotalAed = totalAed + logistics.deliveryAed + logistics.packingAed + logistics.serviceFeeAed;

  const convertedTotal = finalTotalAed * rates[currency];

  const carPhoto = (order.carPhotos && order.carPhotos.length > 0) ? order.carPhotos[0] : order.carPhotoUrl;

  const previewParts = useMemo(
    () => foundParts.map((part) => {
      const costAed = part.variants[0].priceAed;
      const sellAed = isFixedMarkup
        ? costAed + fixedMarkupPerPart
        : costAed * (1 + order.markupPercent / 100);
      const variantPhotos = [part.variants[0]?.photoUrl || '', ...(part.variants[0]?.photos || [])].filter(Boolean);
      const partPhotos = [part.photoUrl || '', ...(part.photos || [])].filter(Boolean);
      const photos = Array.from(new Set((variantPhotos.length > 0 ? variantPhotos : partPhotos) as string[]));
      return {
        part,
        sellAed,
        sellConverted: sellAed * rates[currency],
        photo: photos[0] || '',
        photos
      };
    }),
    [currency, foundParts, order.markupPercent, order.markupType, rates, fixedMarkupPerPart, isFixedMarkup]
  );

  const updateRate = (code: QuoteCurrency, value: string) => {
    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setRates((current) => ({ ...current, [code]: parsed }));
  };

  const whatsappPhone = (settings.publicWhatsappNumber || '').replace(/[^\d]/g, '');
  const confirmMessage = `Здравствуйте! Подтверждаю смету по ${order.brand} ${order.model} ${order.year}. VIN: ${order.vin}`;
  const confirmUrl = whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(confirmMessage)}` : '';

  const runShare = async () => {
    setIsSharing(true);
    try {
      await onShare({ rates, currency });
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message : 'Сервер недоступен, попробуйте снова';
      toast(message, 'error');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md rounded-3xl shadow-2xl animate-in fade-in zoom-in duration-300 flex flex-col max-h-[94vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative overflow-hidden rounded-t-3xl">
          {carPhoto && (
            <div className="absolute inset-0">
              <img src={carPhoto} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-slate-900/70 to-slate-900/90" />
            </div>
          )}
          {!carPhoto && <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900" />}

          <div className="relative z-10 px-5 pt-5 pb-6">
            <div className="flex items-start justify-between mb-4">
              <span className="inline-block rounded-lg bg-blue-600 px-3 py-1 text-[10px] font-black tracking-widest uppercase text-white">DUBAI SPARES</span>
              <button onClick={onClose} className="rounded-full bg-white/10 p-1.5 text-white/70 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight">{order.brand} {order.model} {order.year}</h2>
            <p className="mt-1 font-mono text-xs text-blue-300 tracking-widest uppercase">VIN: {order.vin || '—'}</p>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <p className="text-xs text-white/50 font-semibold uppercase tracking-widest">Итого</p>
                <p className="text-3xl font-black text-white leading-none">{convertedTotal.toFixed(2)} <span className="text-xl text-white/70">{currency}</span></p>
              </div>
              <div className="flex gap-1.5">
                {(Object.keys(CURRENCY_META) as QuoteCurrency[]).map((code) => (
                  <button key={code} type="button" onClick={() => setCurrency(code)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${currency === code ? 'bg-white text-slate-900' : 'bg-white/10 text-white/70'}`}>
                    {code}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto bg-slate-50">

          {/* Part cards */}
          <div className="p-4 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Детали ({foundParts.length})</p>
            {previewParts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Нет найденных деталей</div>
            ) : (
              previewParts.map(({ part, sellConverted, photo, photos }) => (
                <div key={part.id} className="flex items-center gap-3 rounded-2xl bg-white border border-slate-100 p-3 shadow-sm">
                  <button type="button"
                    onClick={() => photos.length > 0 && setGallery({ images: photos, index: 0 })}
                    className="relative shrink-0 h-16 w-16 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center"
                  >
                    {photo
                      ? <img src={photo} className="h-full w-full object-cover" alt={part.name} />
                      : <Images size={20} className="text-slate-400" />}
                    {photos.length > 1 && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[8px] font-bold text-white">{photos.length}</span>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-slate-900 leading-snug">{part.name}</p>
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                      <CheckCircle2 size={9} /> В наличии
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-base font-black text-slate-900">{sellConverted.toFixed(2)}</p>
                    <p className="text-[10px] font-semibold text-slate-400">{currency}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Price breakdown */}
          <div className="mx-4 mb-4 rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Разбивка цены</p>
            </div>
            <div className="px-4 py-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Детали</span>
                <span className="font-bold text-slate-900">{(totalAed * rates[currency]).toFixed(2)} {currency}</span>
              </div>
              {logistics.deliveryAed > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Доставка</span>
                  <span className="font-semibold text-slate-700">{(logistics.deliveryAed * rates[currency]).toFixed(2)} {currency}</span>
                </div>
              )}
              {logistics.packingAed > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Упаковка</span>
                  <span className="font-semibold text-slate-700">{(logistics.packingAed * rates[currency]).toFixed(2)} {currency}</span>
                </div>
              )}
              {logistics.serviceFeeAed > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Комиссия</span>
                  <span className="font-semibold text-slate-700">{(logistics.serviceFeeAed * rates[currency]).toFixed(2)} {currency}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-slate-100 pt-2 mt-1">
                <span className="font-bold text-slate-900">Итого</span>
                <span className="text-lg font-black text-blue-600">{convertedTotal.toFixed(2)} {currency}</span>
              </div>
            </div>
          </div>

          {/* Currency rates */}
          <div className="mx-4 mb-4 rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Курсы (1 AED =)</p>
              <button type="button"
                onClick={() => {
                  void (async () => {
                    setIsRefreshingRates(true);
                    try {
                      setRates(await fetchLiveQuoteRates());
                      setRateNotice('Курс обновлён.');
                    } catch {
                      setRateNotice('Ошибка API. Введите вручную.');
                    } finally {
                      setIsRefreshingRates(false);
                    }
                  })();
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600"
              >
                <RefreshCcw size={10} className={isRefreshingRates ? 'animate-spin' : ''} /> Обновить
              </button>
            </div>
            <div className="grid grid-cols-2 gap-px bg-slate-100">
              {(Object.keys(CURRENCY_META) as QuoteCurrency[]).map((code) => (
                <div key={code} className="bg-white px-3 py-2.5">
                  <p className="text-[9px] font-bold uppercase text-slate-400 mb-1">{CURRENCY_META[code].label}</p>
                  <div className="flex items-center gap-1.5">
                    <input type="number" min="0" step="0.0001" value={rates[code]} onChange={(e) => updateRate(code, e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-900" />
                    <span className="text-[9px] font-bold text-slate-400 shrink-0">{code}</span>
                  </div>
                </div>
              ))}
            </div>
            {rateNotice && <p className="px-4 py-2 text-[10px] font-semibold text-blue-600">{rateNotice}</p>}
          </div>

          {(settings.publicDeliveryTerms.trim() || settings.publicWorkTerms.trim()) && (
            <p className="mx-4 mb-4 text-[10px] text-slate-500 whitespace-pre-line">{[settings.publicDeliveryTerms.trim(), settings.publicWorkTerms.trim()].filter(Boolean).join('\n')}</p>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 bg-white border-t border-slate-100 space-y-2 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => void runShare()} disabled={isSharing}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            <Share2 size={16} /> {isSharing ? 'Создаём ссылку...' : 'Отправить смету'}
          </button>
          {confirmUrl ? (
            <a href={confirmUrl} target="_blank" rel="noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white">
              <CheckCircle2 size={16} /> Подтвердить по WhatsApp
            </a>
          ) : (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-center text-xs font-semibold text-emerald-600">WhatsApp не настроен</div>
          )}
        </div>
      </div>

      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

export default EstimateModal;
