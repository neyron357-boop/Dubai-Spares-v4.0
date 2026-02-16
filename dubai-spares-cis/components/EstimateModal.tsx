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

  const totalAed = foundParts.reduce((sum, p) => {
    const costAed = p.variants[0].priceAed;
    const sellAed = (order.markupType || 'percent') === 'fixed'
      ? costAed
      : costAed * (1 + order.markupPercent / 100);
    return sum + sellAed;
  }, 0);

  const logistics = {
    deliveryAed: Number(order.logistics?.deliveryAed || 0),
    packingAed: Number(order.logistics?.packingAed || 0),
    serviceFeeAed: Number(order.logistics?.serviceFeeAed || 0)
  };
  const markupAed = (order.markupType || 'percent') === 'fixed' ? Number(order.markupFixedAed || 0) : 0;
  const subtotalWithoutLogisticsAed = totalAed + markupAed;
  const finalTotalAed = subtotalWithoutLogisticsAed + logistics.deliveryAed + logistics.packingAed + logistics.serviceFeeAed;

  const convertedTotal = finalTotalAed * rates[currency];

  const carPhoto = (order.carPhotos && order.carPhotos.length > 0) ? order.carPhotos[0] : order.carPhotoUrl;

  const previewParts = useMemo(
    () => foundParts.map((part) => {
      const costAed = part.variants[0].priceAed;
      const sellAed = (order.markupType || 'percent') === 'fixed'
        ? costAed
        : costAed * (1 + order.markupPercent / 100);
      const variantPhotos = [part.variants[0]?.photoUrl || '', ...(part.variants[0]?.photos || [])].filter(Boolean);
      const partPhotos = [part.photoUrl || '', ...(part.photos || [])].filter(Boolean);
      const photos = Array.from(new Set((variantPhotos.length > 0 ? variantPhotos : partPhotos) as string[]));
      return {
        part,
        sellConverted: sellAed * rates[currency],
        photo: photos[0] || '',
        photos
      };
    }),
    [currency, foundParts, order.markupPercent, order.markupType, rates]
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
      toast('Server unavailable, try again', 'error');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white w-full max-w-sm rounded-2xl shadow-2xl animate-in fade-in zoom-in duration-300 flex flex-col max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="relative bg-gray-900 text-white p-3 overflow-hidden overflow-y-auto">
          {carPhoto && (
            <div className="absolute inset-0 z-0">
              <img src={carPhoto} className="w-full h-full object-cover opacity-40" />
              <div className="absolute inset-0 bg-gradient-to-b from-gray-900/90 via-gray-900/70 to-gray-900/95" />
            </div>
          )}

          <div className="relative z-10 flex flex-col items-center w-full">
            <button onClick={onClose} className="absolute top-0 right-0 p-1 text-white/50 active:text-white transition-colors"><X size={20} /></button>
            <div className="bg-blue-600 px-2 py-0.5 rounded text-[8px] font-black tracking-widest uppercase mb-1 shadow-sm border border-blue-400/30">DUBAI SPARES CIS</div>
            <h2 className="text-base font-black text-center leading-tight shadow-black drop-shadow-md uppercase tracking-tight">{order.brand} {order.model} {order.year}</h2>
            <div className="mt-1 bg-gray-900/80 backdrop-blur-sm px-2 py-0.5 rounded border border-gray-700">
              <p className="text-[10px] font-mono font-bold tracking-widest text-blue-400 uppercase">{order.vin}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 bg-white space-y-2">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-2">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-wider text-indigo-700">Курсы валют (1 AED =)</p>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    setIsRefreshingRates(true);
                    try {
                      setRates(await fetchLiveQuoteRates());
                      setRateNotice('Курс обновлён автоматически (реальный).');
                    } catch {
                      setRateNotice('Ошибка API. Введите курс вручную.');
                    } finally {
                      setIsRefreshingRates(false);
                    }
                  })();
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-indigo-700"
              >
                <RefreshCcw size={11} className={isRefreshingRates ? 'animate-spin' : ''} /> Обновить
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(CURRENCY_META) as QuoteCurrency[]).map((code) => (
                <label key={code} className="rounded-lg bg-white p-1.5 border border-indigo-100">
                  <span className="text-[9px] font-bold uppercase text-gray-500">{CURRENCY_META[code].label}</span>
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={rates[code]}
                      onChange={(e) => updateRate(code, e.target.value)}
                      className="w-full rounded-md border border-gray-200 px-2 py-1 text-[11px] font-bold"
                    />
                    <span className="text-[9px] font-bold text-gray-400">{code}</span>
                  </div>
                </label>
              ))}
            </div>
            {rateNotice && <p className="mt-1 text-[9px] font-semibold text-indigo-700">{rateNotice}</p>}
          </div>

          <div className="space-y-0.5">
            {previewParts.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-xs italic">Нет найденных деталей</div>
            ) : (
              previewParts.map(({ part, sellConverted, photo, photos }) => (
                <div key={part.id} className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-none">
                  <button type="button" onClick={() => photos.length > 0 && setGallery({ images: photos, index: 0 })} className="w-8 h-8 bg-gray-50 rounded-lg overflow-hidden flex-shrink-0 border border-gray-100 flex items-center justify-center">
                    {photo ? <img src={photo} className="w-full h-full object-cover" /> : <Images size={14} className="text-slate-400" />}
                  </button>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="font-bold text-xs text-gray-800 truncate leading-none">{part.name}</div>
                    <div className="text-[9px] text-green-600 font-bold uppercase tracking-wider mt-0.5 flex items-center gap-1">
                      <CheckCircle2 size={8} /> В наличии
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-black text-gray-900 leading-none">{sellConverted.toFixed(0)} {currency}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-3 bg-gray-50 border-t border-gray-200 shrink-0 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <div className="mb-2 flex gap-1 overflow-x-auto no-scrollbar">
            {(Object.keys(CURRENCY_META) as QuoteCurrency[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setCurrency(code)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-black ${currency === code ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
              >
                {CURRENCY_META[code].symbol}
              </button>
            ))}
          </div>
          <div className="flex justify-between items-end mb-2 border-b border-dashed border-gray-200 pb-2">
            <div>
              <div className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Итого</div>
              <div className="flex items-baseline gap-1.5">
                <div className="text-2xl font-black text-blue-600 leading-none">{convertedTotal.toFixed(0)} {currency}</div>

              </div>
            </div>
            <div className="text-right">
              <div className="text-[8px] font-bold text-gray-300 uppercase leading-none">Комиссия вкл.</div>
              <div className="text-[8px] font-bold text-gray-400 uppercase mt-0.5 leading-none">ID: {order.id.slice(-4)}</div>
            </div>
          </div>
          <div className="space-y-1 rounded-lg bg-white border border-gray-200 p-2 text-[10px] text-gray-600">
            <div className="flex items-center justify-between"><span>Сумма деталей (без логистики/упаковки/комиссии)</span><span className="font-bold text-gray-900">{(subtotalWithoutLogisticsAed * rates[currency]).toFixed(0)} {currency}</span></div>
            {markupAed > 0 && <div className="flex items-center justify-between"><span>Наценка</span><span className="font-bold text-gray-900">{(markupAed * rates[currency]).toFixed(0)} {currency}</span></div>}
            {logistics.deliveryAed > 0 && <div className="flex items-center justify-between"><span>Логистика</span><span>{(logistics.deliveryAed * rates[currency]).toFixed(0)} {currency}</span></div>}
            {logistics.packingAed > 0 && <div className="flex items-center justify-between"><span>Упаковка</span><span>{(logistics.packingAed * rates[currency]).toFixed(0)} {currency}</span></div>}
            {logistics.serviceFeeAed > 0 && <div className="flex items-center justify-between"><span>Комиссия</span><span>{(logistics.serviceFeeAed * rates[currency]).toFixed(0)} {currency}</span></div>}
          </div>
          {(settings.publicDeliveryTerms.trim() || settings.publicWorkTerms.trim()) && <p className="text-[10px] text-gray-500 text-center whitespace-pre-line">{[settings.publicDeliveryTerms.trim(), settings.publicWorkTerms.trim()].filter(Boolean).join('\n')}</p>}
          <button
            type="button"
            onClick={() => void runShare()}
            disabled={isSharing}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white disabled:opacity-50"
>
            <Share2 size={12} /> {isSharing ? 'Creating link...' : 'Share quote link'}
          </button>
          {confirmUrl ? (
            <a href={confirmUrl} target="_blank" rel="noreferrer" className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white">
              <CheckCircle2 size={12} /> Подтвердить по WhatsApp
            </a>
          ) : (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-center text-[10px] font-bold text-emerald-700">WhatsApp number is not configured</div>
          )}
        </div>
      </div>

      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

export default EstimateModal;
