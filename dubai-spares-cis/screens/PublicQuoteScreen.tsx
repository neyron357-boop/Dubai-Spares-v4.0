import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, MessageCircle, PhoneCall } from 'lucide-react';
import { supabase } from '../supabase';
import { Order, PriceVariant } from '../types';
import ImagePreview from '../components/ImagePreview';

type Currency = 'AED' | 'USD' | 'TJS' | 'KZT' | 'RUB';

const CURRENCY_RATES: Record<Currency, number> = {
  AED: 1,
  USD: 0.27,
  TJS: 2.95,
  KZT: 133,
  RUB: 24.5
};

const CURRENCY_LABELS: Record<Currency, string> = {
  AED: 'AED',
  USD: 'USD',
  TJS: 'Сомони',
  KZT: 'Тенге',
  RUB: '₽'
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

const PublicQuoteScreen: React.FC<{ orderId: string }> = ({ orderId }) => {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>('AED');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);

  useEffect(() => {
    const loadQuote = async () => {
      if (!supabase) {
        setError('Quote service is unavailable.');
        setLoading(false);
        return;
      }

      const { data, error: loadError } = await supabase
        .from('orders')
        .select('id,brand,model,year,body_type,vin,vin_photo_url,priority,client_name,source,car_photo_url,car_photos,markup_percent,exchange_rate,created_at,is_archived,is_sold,parts(*,price_variants(*))')
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
      const baseAed = best?.priceAed || 0;
      const converted = baseAed * CURRENCY_RATES[currency];
      const photos = [...(part.photos || []), ...(best?.photos || []), part.photoUrl || '', best?.photoUrl || ''].filter(Boolean) as string[];
      return {
        part,
        best,
        photos,
        converted,
        baseAed
      };
    });
  }, [order, currency]);

  const totalAed = partCards.reduce((sum, item) => sum + item.baseAed, 0);
  const totalConverted = totalAed * CURRENCY_RATES[currency];
  const whatsappText = encodeURIComponent(`Hello! I reviewed the quote for ${order?.brand || ''} ${order?.model || ''}.`);
  const whatsappUrl = `https://wa.me/?text=${whatsappText}`;

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">Loading quotation…</div>;
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4 text-center">
        <div className="max-w-sm rounded-3xl border border-white/10 bg-white/5 p-6">
          <AlertCircle className="mx-auto mb-3 text-rose-300" />
          <p className="text-sm text-white/90">{error || 'Quote not available.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="relative min-h-[44vh] overflow-hidden">
        {heroPhoto ? (
          <img src={heroPhoto} alt={`${order.brand} ${order.model}`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/55 to-slate-950" />
        <div className="relative px-4 pt-8 pb-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/70">Public quotation</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{order.brand} {order.model}</h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/15 px-3 py-1">Year: {order.year || '—'}</span>
            <span className="rounded-full bg-white/15 px-3 py-1">Body: {order.bodyType || '—'}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-4 w-full max-w-3xl space-y-4 px-3 pb-24">
        <section className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur-xl">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CURRENCY_RATES) as Currency[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setCurrency(code)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${currency === code ? 'bg-white text-slate-900' : 'bg-white/10 text-white/80'}`}
              >
                {code} · {CURRENCY_LABELS[code]}
              </button>
            ))}
          </div>
          <div className="mt-3 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm">
            <p className="text-white/70">Total</p>
            <p className="text-2xl font-semibold">{totalConverted.toFixed(2)} {currency}</p>
            <p className="text-xs text-white/60">Base: {totalAed.toFixed(2)} AED</p>
          </div>
        </section>

        <section className="space-y-3">
          {partCards.map(({ part, best, converted, photos }) => (
            <article key={part.id} className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{part.name}</h2>
                  <p className="mt-1 text-xs text-white/65">Condition: {best ? 'Checked by supplier' : 'On request'}</p>
                  <p className="text-xs text-white/65">Status: {part.isFound ? 'Available' : 'Searching'}</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-semibold">{converted.toFixed(2)} {currency}</p>
                  <p className="text-[11px] text-white/60">{(best?.priceAed || 0).toFixed(2)} AED</p>
                </div>
              </div>

              {photos.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {photos.slice(0, 6).map((photo, idx) => (
                    <button
                      key={`${part.id}-${idx}`}
                      type="button"
                      onClick={() => setGallery({ images: photos, index: idx })}
                      className="overflow-hidden rounded-xl border border-white/10"
                    >
                      <img src={photo} alt={`${part.name} ${idx + 1}`} className="h-20 w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {best?.shopName && (
                <div className="mt-3 flex items-center gap-2 text-xs text-white/70">
                  <CheckCircle2 size={14} className="text-emerald-300" />
                  Supplier: {best.shopName}
                </div>
              )}
            </article>
          ))}
        </section>
      </main>

      <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-slate-950/95 p-3 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl gap-2">
          <a href={whatsappUrl} target="_blank" rel="noreferrer" className="flex min-h-14 flex-[2] items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 text-base font-bold text-white shadow-[0_10px_40px_rgba(16,185,129,0.35)]">
            <MessageCircle size={18} /> WhatsApp Support
          </a>
          <a href={bestPhoneLink(order.parts)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/20 px-4 text-sm font-semibold text-white/90">
            <PhoneCall size={16} /> Approve
          </a>
        </div>
      </div>

      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

const bestPhoneLink = (parts: Order['parts']) => {
  const phone = parts.flatMap((part) => part.variants).find((variant) => variant.phone)?.phone || '';
  const normalized = phone.replace(/[^\d+]/g, '');
  return normalized ? `tel:${normalized}` : '#';
};

export default PublicQuoteScreen;
