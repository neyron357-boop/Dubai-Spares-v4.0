import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Filter, ImageOff, X } from 'lucide-react';
import { vibrate } from '../feedback';
import { useStore } from '../store';
import { Priority, type Order, type Part } from '../types';
import ImagePreview from './ImagePreview';

type VendorSlide = {
  orderId: string;
  partId: string;
  order: Order;
  part: Part;
  images: string[];
};

const priorityWeight = {
  [Priority.HIGH]: 3,
  [Priority.MEDIUM]: 2,
  [Priority.LOW]: 1,
};

const getPrice = (part: Part) => {
  const prices = part.variants.map((item) => item.priceAed).filter((price) => Number.isFinite(price) && price > 0);
  if (!prices.length) return null;
  return Math.min(...prices);
};

const sanitizeImages = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || '').trim())
    .filter((value) => value && value !== 'null' && value !== 'undefined')
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

const getStatusMeta = (part: Part) => {
  if (!part.status) return { label: 'Статус не указан', dot: 'bg-slate-500' };
  if (part.status === 'found') return { label: 'In stock', dot: 'bg-emerald-500' };
  if (part.status === 'ordered') return { label: 'Ordered', dot: 'bg-blue-500' };
  if (part.status === 'not_found') return { label: 'Not found', dot: 'bg-rose-500' };
  return { label: 'Searching', dot: 'bg-slate-500' };
};

const VendorSlider: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();

  const [index, setIndex] = useState(0);
  const [imgIndex, setImgIndex] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [partsSheetOpen, setPartsSheetOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | NonNullable<Part['status']>>('all');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);

  const pressTimer = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const lastGestureAt = useRef(0);

  const slides = useMemo<VendorSlide[]>(() => {
    const active = orders.filter((o) => !o.isArchived && !o.isSold)
      .filter((o) => {
        const effectiveBrand = selectedBrand || brandFilter;
        return effectiveBrand === 'all' || o.brand === effectiveBrand;
      })
      .filter((o) => priorityFilter === 'all' || o.priority === priorityFilter);
    return active
      .sort((a, b) => (priorityWeight[b.priority] - priorityWeight[a.priority]) || (b.createdAt - a.createdAt))
      .flatMap((order) => order.parts
        .filter((part) => statusFilter === 'all' || part.status === statusFilter)
        .map((part) => ({
          orderId: order.id,
          partId: part.id,
          order,
          part,
          images: sanitizeImages((part.photos && part.photos.length > 0) ? part.photos : (part.photoUrl ? [part.photoUrl] : [])),
        }))
      );
  }, [orders, brandFilter, selectedBrand, priorityFilter, statusFilter]);

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [index, slides.length]);

  useEffect(() => {
    setImgIndex(0);
    setIsZoomed(false);
  }, [index]);

  useEffect(() => {
    const nextSlides = [slides[index], slides[index + 1], slides[index + 2]].filter(Boolean) as VendorSlide[];
    const preloadUrls = nextSlides.flatMap((slide) => slide.images.slice(0, 2));
    preloadUrls.forEach((url) => {
      const img = new Image();
      img.src = url;
    });
  }, [index, slides]);

  const current = slides[index];
  const brandOptions = useMemo(() => Array.from(new Set(orders.map((o) => o.brand))).sort((a, b) => a.localeCompare(b)), [orders]);

  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(slides.length - 1, next));
    if (bounded === index) return;
    const now = Date.now();
    if (now - lastGestureAt.current < 140) return;
    lastGestureAt.current = now;
    vibrate(12);
    setIndex(bounded);
  };

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (partsSheetOpen) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const isRight = e.clientX > rect.left + rect.width / 2;
    goTo(index + (isRight ? 1 : -1));
  };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.targetTouches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStart.current || partsSheetOpen) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) {
      goTo(index + (dx > 0 ? -1 : 1));
    }
    touchStart.current = null;
  };

  const onLongPressStart = () => {
    pressTimer.current = window.setTimeout(() => {
      setPartsSheetOpen(true);
      vibrate(20);
    }, 420);
  };

  const onLongPressEnd = () => {
    if (!pressTimer.current) return;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };


  if (!selectedBrand && brandOptions.length > 0) {
    return (
      <div className="absolute inset-0 z-50 bg-[#0B1220] pb-[max(84px,calc(env(safe-area-inset-bottom)+72px))] pt-[max(12px,env(safe-area-inset-top))] text-white px-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-white/70">Выберите марку</p>
          <button type="button" onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45">
            <X size={18} />
          </button>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {brandOptions.map((brand) => (
            <button
              key={brand}
              type="button"
              onClick={() => {
                setSelectedBrand(brand);
                setBrandFilter(brand);
              }}
              className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-4 text-left text-lg font-black hover:border-[#2563EB]"
            >
              {brand}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="absolute inset-0 z-50 bg-[#0B1220] text-gray-300 flex flex-col items-center justify-center gap-4">
        <p>Нет деталей для просмотра</p>
        <button type="button" onClick={() => navigate(-1)} className="rounded-xl border border-gray-700 px-4 py-2">Назад</button>
      </div>
    );
  }

  const { order, part, images } = current;
  const statusMeta = getStatusMeta(part);
  const price = getPrice(part);
  const carImage = sanitizeImages([(order.carPhotos && order.carPhotos.length > 0 ? order.carPhotos[0] : order.carPhotoUrl), images[0]])[0] || '';

  return (
    <div className="absolute inset-0 z-50 h-full w-full overflow-hidden bg-[#0B1220] text-white">
      <div className="flex h-full flex-col overflow-hidden">
        <div className="relative h-[28vh] min-h-[170px] max-h-[240px] w-full overflow-hidden border-b border-slate-800">
          {carImage ? <img src={carImage} alt={`${order.brand} ${order.model}`} className="h-full w-full object-cover" onClick={(e) => { e.stopPropagation(); setGallery({ images: [carImage], index: 0 }); }} /> : <div className="h-full w-full bg-slate-900" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/35 to-transparent" />
          <div className="absolute right-3 top-3 flex gap-2">
            <button type="button" onClick={() => setFiltersOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45"><Filter size={18} /></button>
            <button type="button" onClick={() => setSelectedBrand(null)} className="rounded-full bg-black/45 px-3 text-[11px] font-bold">Марки</button>
            <button type="button" onClick={() => navigate(-1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45">
              <X size={20} />
            </button>
          </div>
          <div className="absolute bottom-3 left-4 right-4">
            <p className="truncate text-3xl font-black leading-tight">{order.brand} {order.model}</p>
            <p className="text-sm text-white/90">{order.year} · {order.bodyType || '—'} · {order.parts.length} деталей</p>
            <p className="mt-1 truncate text-xs text-white/70">VIN: {order.vin || '—'}</p>
          </div>
        </div>

        <div
          className="flex-1 space-y-3 overflow-y-auto px-1 py-3"
          onClick={handleTap}
          onDoubleClick={() => setIsZoomed((prev) => !prev)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onMouseDown={onLongPressStart}
          onMouseUp={onLongPressEnd}
          onMouseLeave={onLongPressEnd}
          style={{ touchAction: 'pan-y' }}
        >
          <div className="rounded-3xl border border-slate-700/70 bg-[#111a2d] p-4">
            <p className="truncate text-[34px] font-black uppercase leading-none">{part.name}</p>
            <p className="mt-2 text-[32px] font-black leading-none text-[#60a5fa]">{price ? `${price} AED` : 'Запрос цены'}</p>
            <div className="mt-2 flex items-center gap-2 text-base">
              <span className={`h-3 w-3 rounded-full ${statusMeta.dot}`} />
              <span className="font-semibold text-white/85">{statusMeta.label}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!images.length) return;
                  setGallery({ images, index: imgIndex });
                }}
                className="rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-semibold text-white/90"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/order/${order.id}/part/${part.id}`);
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-semibold text-white/90"
              >
                Карточка детали <ExternalLink size={12} />
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700/70 bg-[#0f172a] p-3">
            <div className="mx-auto h-[32vh] min-h-[200px] max-h-[340px] w-[82%] overflow-hidden rounded-2xl bg-slate-900" onClick={(e) => { e.stopPropagation(); if (!images.length) return; setGallery({ images, index: imgIndex }); }}>
              {images.length > 0 ? (
                <img
                  src={images[imgIndex]}
                  alt={part.name}
                  loading="lazy"
                  className={`h-full w-full object-cover transition-transform duration-200 ${isZoomed ? 'scale-125' : 'scale-100'}`}
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
                  <ImageOff size={30} />
                  <p className="text-sm font-semibold">Фото отсутствует</p>
                </div>
              )}
            </div>

            <div className="mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
              {images.slice(0, 6).map((img, thumbIdx) => (
                <button
                  key={`${img}-${thumbIdx}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setImgIndex(thumbIdx);
                  }}
                  className={`h-14 w-14 shrink-0 snap-start overflow-hidden rounded-xl border ${imgIndex === thumbIdx ? 'border-[#2563EB]' : 'border-slate-700'}`}
                >
                  <img src={img} alt={`${part.name}-${thumbIdx + 1}`} className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>


      {filtersOpen && (
        <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setFiltersOpen(false)}>
          <div className="mt-20 rounded-3xl border border-slate-700 bg-[#111a2d] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-white/70">Фильтры</p>
            <div className="space-y-3 text-sm">
              <div>
                <p className="mb-1 text-xs text-white/70">Марки</p>
                <select value={brandFilter} onChange={(e) => { const value = e.target.value; if (value === "__choose") { setSelectedBrand(null); return; } setBrandFilter(value); setSelectedBrand(value === "all" ? null : value); }} className="w-full rounded-xl bg-slate-800 px-3 py-2">
                  <option value="all">Все марки</option>
                  <option value="__choose">Выбрать экран марок</option>
                  {brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </div>
              <div>
                <p className="mb-1 text-xs text-white/70">Приоритет</p>
                <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as any)} className="w-full rounded-xl bg-slate-800 px-3 py-2">
                  <option value="all">Любой</option><option value={Priority.HIGH}>High</option><option value={Priority.MEDIUM}>Medium</option><option value={Priority.LOW}>Low</option>
                </select>
              </div>
              <div>
                <p className="mb-1 text-xs text-white/70">Статус</p>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="w-full rounded-xl bg-slate-800 px-3 py-2">
                  <option value="all">Любой</option><option value="searching">Searching</option><option value="found">Found</option><option value="ordered">Ordered</option><option value="not_found">Not found</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}

      {partsSheetOpen && (
        <div className="absolute inset-0 z-10 bg-black/70 p-4" onClick={() => setPartsSheetOpen(false)}>
          <div className="mt-16 rounded-3xl border border-slate-700 bg-[#111a2d] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-white/70">Все детали</p>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto">
              {slides.map((slide, slideIdx) => (
                <button
                  key={`${slide.orderId}-${slide.partId}-sheet`}
                  type="button"
                  onClick={() => {
                    setIndex(slideIdx);
                    setPartsSheetOpen(false);
                  }}
                  className={`flex h-12 w-full items-center rounded-xl px-3 text-left ${slideIdx === index ? 'bg-[#2563EB]/25 text-white' : 'bg-slate-800 text-slate-200'}`}
                >
                  <span className="truncate text-base font-semibold">{slide.part.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorSlider;
