import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink, Filter, ImageOff, X } from 'lucide-react';
import { useStore } from '../store';
import { Priority, type Order, type Part } from '../types';
import { vibrate } from '../feedback';
import ImagePreview from './ImagePreview';
import SafeImage from './SafeImage';
import { SupplierSlidesErrorBoundary } from './SupplierSlidesErrorBoundary';

const priorityWeight = {
  [Priority.HIGH]: 3,
  [Priority.MEDIUM]: 2,
  [Priority.LOW]: 1,
};

const sanitizeImages = (values: Array<unknown>) => {
  const seen = new Set<string>();
  return values
    .map((value) => (typeof value === 'string' ? value : '').trim())
    .filter((value) => value && value !== 'null' && value !== 'undefined')
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

const VendorSliderContent: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orders } = useStore();

  const initialBrand = searchParams.get('brand');
  const initialSlideId = searchParams.get('slide');

  const [index, setIndex] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>(initialBrand || 'all');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(initialBrand || null);
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | NonNullable<Part['status']>>('all');
  const [sortBy, setSortBy] = useState<'priority' | 'year_asc' | 'year_desc'>('priority');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [partsSheetOpen, setPartsSheetOpen] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<string, true>>({});
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const orderSlides = useMemo(() => {
    const effectiveBrand = selectedBrand || brandFilter;
    return orders
      .filter((o) => !o.isArchived && !o.isSold)
      .filter((o) => effectiveBrand === 'all' || o.brand === effectiveBrand)
      .filter((o) => priorityFilter === 'all' || o.priority === priorityFilter)
      .map((order) => ({
        ...order,
        visibleParts: order.parts.filter((part) => statusFilter === 'all' || part.status === statusFilter)
      }))
      .filter((order) => order.visibleParts.length > 0)
      .sort((a, b) => {
        if (sortBy === 'year_asc') {
          const ya = Number(a.year) || 0;
          const yb = Number(b.year) || 0;
          if (!ya && !yb) return 0;
          if (!ya) return 1;
          if (!yb) return -1;
          return ya - yb;
        }
        if (sortBy === 'year_desc') {
          const ya = Number(a.year) || 0;
          const yb = Number(b.year) || 0;
          if (!ya && !yb) return 0;
          if (!ya) return 1;
          if (!yb) return -1;
          return yb - ya;
        }
        return (priorityWeight[b.priority] - priorityWeight[a.priority]) || (b.createdAt - a.createdAt);
      });
  }, [orders, brandFilter, selectedBrand, priorityFilter, statusFilter, sortBy]);
  const current = orderSlides[index];

  useEffect(() => {
    if (index >= orderSlides.length) setIndex(0);
  }, [index, orderSlides.length]);

  useEffect(() => {
    if (!initialSlideId || orderSlides.length === 0) return;
    const nextIndex = orderSlides.findIndex((slide) => slide.id === initialSlideId);
    if (nextIndex >= 0) setIndex(nextIndex);
  }, [initialSlideId, orderSlides]);

  useEffect(() => {
    if (!selectedBrand && !current?.id) return;
    const next = new URLSearchParams(searchParams);
    if (selectedBrand) next.set('brand', selectedBrand);
    else next.delete('brand');
    if (current?.id) next.set('slide', current.id);
    else next.delete('slide');
    setSearchParams(next, { replace: true });
  }, [selectedBrand, current?.id]);

  const brandOptions = useMemo(() => Array.from(new Set(orders.map((o) => o.brand))).sort((a, b) => a.localeCompare(b)), [orders]);

  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(orderSlides.length - 1, next));
    if (bounded === index) return;
    vibrate(10);
    setIndex(bounded);
  };

  if (!selectedBrand && brandOptions.length > 0) {
    return (
      <div className="absolute inset-0 z-50 bg-[#0B1220] pb-[max(84px,calc(env(safe-area-inset-bottom)+72px))] pt-[max(12px,env(safe-area-inset-top))] text-white px-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-white/70">Выберите марку</p>
          <button type="button" onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45"><X size={18} /></button>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">{brandOptions.map((brand) => <button key={brand} type="button" onClick={() => { setSelectedBrand(brand); setBrandFilter(brand); }} className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-4 text-left text-lg font-black hover:border-[#2563EB]">{brand}</button>)}</div>
      </div>
    );
  }

  if (!current) {
    return <div className="absolute inset-0 z-50 bg-[#0B1220] text-gray-300 flex flex-col items-center justify-center gap-4"><p>Нет данных</p><button type="button" onClick={() => navigate(-1)} className="rounded-xl border border-gray-700 px-4 py-2">Назад</button></div>;
  }

  const carImages = sanitizeImages([
    ...(Array.isArray(current.carPhotos) ? current.carPhotos : []),
    current.carPhotoUrl
  ]);
  const availableCarImages = carImages.filter((image) => !brokenImages[image]);

  return (
    <div className="absolute inset-0 z-50 h-full w-full overflow-hidden bg-[#0B1220] text-white">
      <div className="relative h-[30vh] min-h-[190px] max-h-[260px] overflow-hidden border-b border-slate-800">
        {availableCarImages[0] ? (
          <button type="button" onClick={() => setGallery({ images: availableCarImages, index: 0 })} className="h-full w-full">
            <SafeImage src={availableCarImages[0]} alt="car" className="h-full w-full object-cover" onError={() => setBrokenImages((prev) => ({ ...prev, [availableCarImages[0]]: true }))} />
          </button>
        ) : <div className="h-full w-full bg-slate-900" />}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        <div className="absolute right-3 top-3 flex gap-2">
          <button type="button" onClick={() => setFiltersOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45"><Filter size={18} /></button>
          <button type="button" onClick={() => setSelectedBrand(null)} className="rounded-full bg-black/45 px-3 text-[11px] font-bold">Марки</button>
          <button type="button" onClick={() => navigate(-1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45"><X size={20} /></button>
        </div>
        <div className="absolute bottom-3 left-4 right-4">
          <p className="truncate text-3xl font-black leading-tight">{current.brand} {current.model}</p>
          <p className="mt-1 text-lg font-black text-amber-200">{current.year} · {current.bodyType || '—'} · Серия: {current.priority.toUpperCase()}</p>
          <p className="text-xs text-white/70">VIN: {current.vin || '—'} • {current.visibleParts.length} деталей</p>
        </div>
      </div>

      <div className="h-[calc(100%-30vh)] overflow-y-auto p-3 space-y-2" onTouchStart={(e) => { const t = e.targetTouches[0]; touchStart.current = { x: t.clientX, y: t.clientY }; }} onTouchEnd={(e) => { if (!touchStart.current) return; const t = e.changedTouches[0]; const dx = t.clientX - touchStart.current.x; const dy = t.clientY - touchStart.current.y; if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) * 1.15) goTo(index + (dx > 0 ? -1 : 1)); touchStart.current = null; }}>
        {current.visibleParts.map((part) => {
          const images = sanitizeImages([
            ...(Array.isArray(part.photos) ? part.photos : []),
            part.photoUrl
          ]);
          const availableImages = images.filter((image) => !brokenImages[image]);
          const isFound = part.isFound || part.status === 'found' || part.variants.some((variant) => Number(variant.priceAed) > 0);
          return (
            <div key={part.id} className={`rounded-2xl border p-2 flex gap-3 items-center transition ${isFound ? 'border-emerald-700/80 bg-emerald-900/15 opacity-65' : 'border-slate-700 bg-[#111a2d]'}`}>
              <button type="button" className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-900" onClick={() => availableImages[0] && setGallery({ images: availableImages, index: 0 })}>
                {availableImages[0] ? <SafeImage src={availableImages[0]} alt={part.name} className="h-full w-full object-cover" onError={() => setBrokenImages((prev) => ({ ...prev, [availableImages[0]]: true }))} /> : <div className="h-full w-full grid place-items-center text-slate-500"><ImageOff size={18} /></div>}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-black">{part.name}</p>
                <p className="text-xs text-white/60">Статус: {part.status || 'searching'} • Вариантов: {part.variants.length}</p>
              </div>
              <button type="button" onClick={() => navigate(`/order/${current.id}/part/${part.id}`, { state: { backTo: `/vendor?brand=${encodeURIComponent(selectedBrand || '')}&slide=${current.id}` } })} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-2 py-1.5 text-xs font-semibold text-white/90">Карточка детали <ExternalLink size={12} /></button>
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-3 inset-x-0 px-4 flex items-center justify-between">
        <button type="button" onClick={() => goTo(index - 1)} className="rounded-xl border border-slate-600 px-3 py-2 text-xs">Назад</button>
        <button type="button" onClick={() => setPartsSheetOpen(true)} className="rounded-xl border border-slate-600 px-3 py-2 text-xs">Авто список</button>
        <button type="button" onClick={() => goTo(index + 1)} className="rounded-xl border border-slate-600 px-3 py-2 text-xs">Далее</button>
      </div>

      {filtersOpen && <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setFiltersOpen(false)}><div className="mt-20 rounded-3xl border border-slate-700 bg-[#111a2d] p-4" onClick={(e) => e.stopPropagation()}><p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-white/70">Фильтры</p><div className="space-y-3 text-sm"><div><p className="mb-1 text-xs text-white/70">Марки</p><select value={brandFilter} onChange={(e) => { const value = e.target.value; if (value === '__choose') { setSelectedBrand(null); return; } setBrandFilter(value); setSelectedBrand(value === 'all' ? null : value); }} className="w-full rounded-xl bg-slate-800 px-3 py-2"><option value="all">Все марки</option><option value="__choose">Выбрать экран марок</option>{brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select></div><div><p className="mb-1 text-xs text-white/70">Приоритет</p><select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as any)} className="w-full rounded-xl bg-slate-800 px-3 py-2"><option value="all">Любой</option><option value={Priority.HIGH}>High</option><option value={Priority.MEDIUM}>Medium</option><option value={Priority.LOW}>Low</option></select></div><div><p className="mb-1 text-xs text-white/70">Статус</p><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="w-full rounded-xl bg-slate-800 px-3 py-2"><option value="all">Любой</option><option value="searching">Searching</option><option value="found">Found</option><option value="ordered">Ordered</option><option value="not_found">Not found</option></select></div><div><p className="mb-1 text-xs text-white/70">Сортировка</p><select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="w-full rounded-xl bg-slate-800 px-3 py-2"><option value="priority">По приоритету</option><option value="year_asc">По году (старые сначала)</option><option value="year_desc">По году (новые сначала)</option></select></div></div></div></div>}

      {partsSheetOpen && <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setPartsSheetOpen(false)}><div className="mt-16 rounded-3xl border border-slate-700 bg-[#111a2d] p-4" onClick={(e) => e.stopPropagation()}><p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-white/70">Автомобили</p><div className="max-h-[60vh] space-y-2 overflow-y-auto">{orderSlides.map((slide, idx) => <button key={slide.id} type="button" onClick={() => { setIndex(idx); setPartsSheetOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left ${idx === index ? 'bg-[#2563EB]/25 text-white' : 'bg-slate-800 text-slate-200'}`}><span className="font-semibold">{slide.brand} {slide.model}</span><span className="text-xs opacity-70">{slide.visibleParts.length} деталей</span></button>)}</div></div></div>}

      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

const VendorSlider: React.FC = () => (
  <SupplierSlidesErrorBoundary>
    <VendorSliderContent />
  </SupplierSlidesErrorBoundary>
);

export default VendorSlider;
