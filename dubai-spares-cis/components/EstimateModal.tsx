import React, { useEffect, useMemo, useState } from 'react';
import { Order } from '../types';
import { X, CheckCircle2, Share2, RefreshCcw } from 'lucide-react';
import { DEFAULT_QUOTE_RATES, QuoteCurrency, QuoteRates } from '../shareUtils';

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

  const totalAed = foundParts.reduce((sum, p) => {
    const costAed = p.variants[0].priceAed;
    const sellAed = costAed * (1 + order.markupPercent / 100);
    return sum + sellAed;
  }, 0);

  const convertedTotal = totalAed * rates[currency];

  useEffect(() => {
    void (async () => {
      setIsRefreshingRates(true);
      try {
        const liveRates = await fetchLiveQuoteRates();
        setRates(liveRates);
        setRateNotice('Курс обновлён автоматически (реальный).');
      } catch {
        setRateNotice('Не удалось обновить автоматически. Используются значения по умолчанию.');
      } finally {
        setIsRefreshingRates(false);
      }
    })();
  }, []);

  const carPhoto = (order.carPhotos && order.carPhotos.length > 0) ? order.carPhotos[0] : order.carPhotoUrl;

  const previewParts = useMemo(
    () => foundParts.map((part) => {
      const costAed = part.variants[0].priceAed;
      const sellAed = costAed * (1 + order.markupPercent / 100);
      return {
        part,
        sellAed,
        sellConverted: sellAed * rates[currency],
        photo: (part.photos && part.photos.length > 0) ? part.photos[0] : part.photoUrl
      };
    }),
    [currency, foundParts, order.markupPercent, rates]
  );

  const updateRate = (code: QuoteCurrency, value: string) => {
    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setRates((current) => ({ ...current, [code]: parsed }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300 flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="relative bg-gray-900 text-white p-3 shrink-0 overflow-hidden">
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
              previewParts.map(({ part, sellAed, sellConverted, photo }) => (
                <div key={part.id} className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-none">
                  <div className="w-8 h-8 bg-gray-50 rounded-lg overflow-hidden flex-shrink-0 border border-gray-100">
                    {photo ? <img src={photo} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-blue-50/30 flex items-center justify-center text-blue-200 font-bold text-[8px]">IMG</div>}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="font-bold text-xs text-gray-800 truncate leading-none">{part.name}</div>
                    <div className="text-[9px] text-green-600 font-bold uppercase tracking-wider mt-0.5 flex items-center gap-1">
                      <CheckCircle2 size={8} /> В наличии
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-black text-gray-900 leading-none">{sellConverted.toFixed(0)} {currency}</div>
                    <div className="text-[8px] text-gray-400 font-bold mt-0.5">{sellAed.toFixed(0)} AED</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-3 bg-gray-50 border-t border-gray-200 shrink-0">
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
                <div className="text-xs font-bold text-gray-400">{totalAed.toFixed(0)} AED</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[8px] font-bold text-gray-300 uppercase leading-none">Комиссия вкл.</div>
              <div className="text-[8px] font-bold text-gray-400 uppercase mt-0.5 leading-none">ID: {order.id.slice(-4)}</div>
            </div>
          </div>
          <p className="text-[8px] text-gray-400 font-bold uppercase tracking-tighter text-center">Срок доставки уточняется при оформлении</p>
          <button
            type="button"
            onClick={() => void onShare({ rates, currency })}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-white"
          >
            <Share2 size={12} /> Share quote link
          </button>
        </div>
      </div>
    </div>
  );
};

export default EstimateModal;
