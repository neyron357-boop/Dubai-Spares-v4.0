import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BadgeCheck, CheckCircle2, ChevronRight, MessageCircle, RefreshCcw } from 'lucide-react';
import { supabase } from '../supabase';
import { Order, PriceVariant } from '../types';
import ImagePreview from '../components/ImagePreview';
import { DEFAULT_QUOTE_RATES, parseQuoteRates, QuoteCurrency, QuoteRates } from '../shareUtils';

const CURRENCY_LABELS: Record<QuoteCurrency, string> = {
  AED: 'Dirham',
  USD: 'Dollar',
  RUB: 'Ruble',
  TJS: 'Somoni'
};

const parseTimestamp = (value: string | number | null | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const d = Date.parse(value);
    if (!Number.isNaN(d)) return d;
  }
  return Date.now();
};

const mapDbOrder = (row: any): Order => ({
  id: String(row.id),
  brand: row.brand || '',
  model: row.model || '',
  year: row.year || '',
  bodyType: row.body_type || '',
  vin: row.vin || '',
  vinPhotoUrl: row.vin_photo_url || '',
  priority: row.priority || 'MEDIUM',
  status: row.status || 'in_progress',
  salesStatus: row.sales_status,
  clientName: row.client_name || '',
  source: row.source || 'WhatsApp',
  carPhotoUrl: row.car_photo_url || row.car_photos?.[0] || row.vin_photo_url || '',
  carPhotos: row.car_photos || [],
  parts: (row.parts || []).map((part: any) => ({
    id: String(part.id),
    orderId: String(part.order_id || row.id),
    name: part.name || 'Part',
    photoUrl: part.photo_url || part.photos?.[0] || '',
    photos: part.photos || [],
    isFound: !!part.is_found,
    variants: (part.price_variants || []).map((variant: any): PriceVariant => ({
      id: String(variant.id),
      partId: String(variant.part_id || part.id),
      priceAed: Number(variant.price_aed || 0),
      shopName: variant.shop_name || '',
      phone: variant.phone || '',
      location: variant.location || '',
      photoUrl: variant.photo_url || variant.photos?.[0] || '',
      photos: variant.photos || [],
      createdAt: parseTimestamp(variant.created_at)
    }))
  })),
  markupPercent: Number(row.markup_percent || 0),
  exchangeRate: Number(row.exchange_rate || 3.67),
  createdAt: parseTimestamp(row.created_at),
  isArchived: !!row.is_archived,
  isSold: !!row.is_sold
});

const quoteStatus = (order: Order) => {
  if (order.salesStatus === 'Pending Approval') return 'Ready for Review';
  if (order.salesStatus === 'Price Sent') return 'Best Price Found';
  if (order.salesStatus === 'Paid') return 'Awaiting Delivery';
  if (order.salesStatus === 'Completed' || order.isSold) return 'Order Confirmed';
  return 'Best Price Found';
};

const fetchLiveQuoteRates = async (): Promise<QuoteRates> => {
  const response = await fetch('https://open.er-api.com/v6/latest/AED');
  if (!response.ok) throw new Error(`Rate API error: ${response.status}`);
  const payload = await response.json();
  const rates = payload?.rates || {};

  return {
    AED: 1,
    USD: Number(rates.USD) > 0 ? Number(rates.USD) : DEFAULT_QUOTE_RATES.USD,
    RUB: Number(rates.RUB) > 0 ? Number(rates.RUB) : DEFAULT_QUOTE_RATES.RUB,
    TJS: Number(rates.TJS) > 0 ? Number(rates.TJS) : DEFAULT_QUOTE_RATES.TJS
  };
};

const PublicQuoteScreen: React.FC<{ orderId: string }> = ({ orderId }) => {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<QuoteCurrency>('AED');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [rates, setRates] = useState<QuoteRates>(DEFAULT_QUOTE_RATES);
  const [rateSource, setRateSource] = useState('Live market rates');
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedRates = parseQuoteRates(params.get('rates'));
    const sharedCurrency = (params.get('currency') || '').toUpperCase() as QuoteCurrency;

    if (sharedCurrency in DEFAULT_QUOTE_RATES) setCurrency(sharedCurrency);

    if (sharedRates) {
      setRates(sharedRates);
      setRateSource('Manager custom rates');
      return;
    }

    void (async () => {
      setIsRefreshingRates(true);
      try {
        setRates(await fetchLiveQuoteRates());
        setRateSource('Live market rates');
      } catch {
        setRates(DEFAULT_QUOTE_RATES);
        setRateSource('Default rates');
      } finally {
        setIsRefreshingRates(false);
      }
    })();
  }, []);

  useEffect(() => {
    const loadQuote = async () => {
      if (!supabase) {
        setError('Quote service is unavailable.');
        setLoading(false);
        return;
      }

      const { data, error: loadError } = await supabase
        .from('orders')
        .select('id,brand,model,year,body_type,vin,status,sales_status,vin_photo_url,priority,client_name,source,car_photo_url,car_photos,markup_percent,exchange_rate,created_at,is_archived,is_sold,parts(*,price_variants(*))')
        .eq('id', orderId)
        .maybeSingle();

      if (loadError || !data) {
        setError('Quote not found.');
      } else {
        setOrder(mapDbOrder(data));
      }

      setLoading(false);
    };

    void loadQuote();
  }, [orderId]);

  const heroPhoto = useMemo(() => {
    if (!order) return '';
    return order.vinPhotoUrl || order.carPhotoUrl || order.carPhotos[0] || order.parts.find((part) => (part.photos || []).length > 0)?.photos?.[0] || '';
  }, [order]);

  const partCards = useMemo(() => {
    if (!order) return [];
    return order.parts.map((part) => {
      const best = [...part.variants].sort((a, b) => a.priceAed - b.priceAed)[0];
      const supplierAed = best?.priceAed || 0;
      const clientAed = supplierAed * (1 + order.markupPercent / 100);
      const converted = clientAed * rates[currency];
      const photos = [...(part.photos || []), ...(best?.photos || []), part.photoUrl || '', best?.photoUrl || ''].filter(Boolean) as string[];
      const isReady = !!best && part.isFound;
      return {
        part,
        best,
        photos,
        converted,
        clientAed,
        isReady,
        availability: isReady ? 'In stock' : 'In progress'
      };
    });
  }, [order, currency, rates]);

  const { foundParts, pendingParts } = useMemo(() => ({
    foundParts: partCards.filter((item) => item.isReady),
    pendingParts: partCards.filter((item) => !item.isReady)
  }), [partCards]);

  const totals = useMemo(() => {
    const totalSellAed = foundParts.reduce((sum, item) => sum + item.clientAed, 0);
    return {
      totalAed: totalSellAed,
      totalConverted: totalSellAed * rates[currency]
    };
  }, [foundParts, currency, rates]);

  const selectedPartNames = foundParts.map(({ part }) => part.name).join(', ');
  const whatsappText = encodeURIComponent(
    `Hello! I confirmed the quote for ${order?.brand || ''} ${order?.model || ''} ${order?.year || ''} and want to proceed with ${selectedPartNames || 'the selected parts'}.`
  );
  const whatsappUrl = `https://wa.me/971521574546?text=${whatsappText}`;

  if (loading) {
    return <div className="min-h-screen bg-[#f5f5f7] text-slate-900 flex items-center justify-center">Loading quotation…</div>;
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] text-slate-900 flex items-center justify-center px-4 text-center">
        <div className="max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <AlertCircle className="mx-auto mb-3 text-rose-500" />
          <p className="text-sm text-slate-700">{error || 'Quote not available.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-900">
      <div className="sticky top-0 z-40 border-b border-black/5 bg-white/90 px-3 py-2 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Currency</p>
            {(Object.keys(DEFAULT_QUOTE_RATES) as QuoteCurrency[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setCurrency(code)}
                className={`min-h-9 min-w-[62px] rounded-full px-3 text-sm font-semibold transition ${currency === code ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
              >
                {code}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span>Source: {rateSource}</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-slate-700"
              onClick={() => {
                void (async () => {
                  setIsRefreshingRates(true);
                  try {
                    setRates(await fetchLiveQuoteRates());
                    setRateSource('Live market rates');
                  } catch {
                    setRateSource('Default rates');
                  } finally {
                    setIsRefreshingRates(false);
                  }
                })();
              }}
            >
              <RefreshCcw size={12} className={isRefreshingRates ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
        <div className="mx-auto mt-2 grid w-full max-w-4xl grid-cols-2 gap-1 text-[10px] text-slate-500 sm:grid-cols-4">
          {(Object.keys(rates) as QuoteCurrency[]).map((code) => (
            <div key={code} className="rounded-lg bg-slate-100 px-2 py-1">1 AED = {rates[code].toFixed(4)} {code} · {CURRENCY_LABELS[code]}</div>
          ))}
        </div>
      </div>

      <header className="relative min-h-[45vh] overflow-hidden">
        {heroPhoto ? (
          <img src={heroPhoto} alt={`${order.brand} ${order.model}`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-400" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/45 to-black/65" />
        <div className="relative mx-auto flex h-full w-full max-w-4xl flex-col justify-between px-4 pb-6 pt-8 text-white">
          <div className="w-fit rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold backdrop-blur">VIN: {order.vin || 'Not provided'}</div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{order.brand} {order.model} {order.year}</h1>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-500/90 px-4 py-2 text-sm font-semibold shadow-lg shadow-emerald-900/40">
              <BadgeCheck size={16} />
              {quoteStatus(order)}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-8 w-full max-w-4xl space-y-4 px-3 pb-28 sm:px-5">
        <section className="rounded-3xl border border-black/5 bg-gradient-to-br from-white via-white to-slate-50 p-4 shadow-[0_16px_45px_rgba(15,23,42,0.08)] sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Quote total</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900 sm:text-4xl">{totals.totalConverted.toFixed(2)} {currency}</p>
          <p className="mt-1 text-sm text-slate-500">Final client price · {totals.totalAed.toFixed(2)} AED</p>
        </section>

        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Found parts ({foundParts.length})</p>
          {foundParts.map(({ part, best, converted, photos, availability }) => (
            <article key={part.id} className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">{part.name}</h2>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
                    <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">Status: {availability}</span>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-2xl font-semibold text-slate-900">{converted.toFixed(2)} {currency}</p>
                  <p className="text-xs text-slate-500">Final price</p>
                </div>
              </div>

              {photos.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.slice(0, 8).map((photo, idx) => (
                    <button key={`${part.id}-${idx}`} type="button" onClick={() => setGallery({ images: photos, index: idx })} className="min-h-20 overflow-hidden rounded-2xl border border-slate-200">
                      <img src={photo} alt={`${part.name} ${idx + 1}`} className="h-24 w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {best?.shopName && (
                <div className="mt-4 inline-flex items-center gap-2 text-sm text-slate-600">
                  <CheckCircle2 size={16} className="text-emerald-500" />
                  Premium source: {best.shopName}
                </div>
              )}
            </article>
          ))}

          {pendingParts.length > 0 && (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-4 sm:p-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Parts in progress ({pendingParts.length})</p>
              <div className="flex flex-wrap gap-2">
                {pendingParts.map(({ part }) => (
                  <span key={part.id} className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">{part.name}</span>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-black/5 bg-white/95 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur-xl">
        <div className="mx-auto w-full max-w-4xl">
          <a href={whatsappUrl} target="_blank" rel="noreferrer" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-500 to-green-500 px-5 text-base font-bold text-white shadow-[0_14px_42px_rgba(16,185,129,0.42)] transition hover:brightness-105">
            <MessageCircle size={18} /> Confirm & Open WhatsApp Chat <ChevronRight size={18} />
          </a>
        </div>
      </div>

      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

export default PublicQuoteScreen;
