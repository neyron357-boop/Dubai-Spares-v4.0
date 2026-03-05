import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink, Filter, ImageOff, MapPin, MessageCircle, Phone, Plus, Users, X } from 'lucide-react';
import { useStore } from '../store';
import { Priority, type OrderVendorContact, type Part, type Supplier } from '../types';
import { vibrate } from '../feedback';
import ImagePreview from './ImagePreview';
import SafeImage from './SafeImage';
import { SupplierSlidesErrorBoundary } from './SupplierSlidesErrorBoundary';
import { ensureUuid } from '../id';

const priorityWeight = {
  [Priority.HIGH]: 3,
  [Priority.MEDIUM]: 2,
  [Priority.LOW]: 1
};

const LEAD_SLIDES_KEY = '__lead';

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

const phoneDigits = (value?: string) => (value || '').replace(/\D/g, '');

const VendorSliderContent: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orders, updateOrder, suppliers, addSupplier } = useStore();

  const initialBrand = searchParams.get('brand');
  const initialSlideId = searchParams.get('slide');

  const [transientDragIndex, setTransientDragIndex] = useState(0);
  const [committedIndex, setCommittedIndex] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>(initialBrand || 'all');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(initialBrand || null);
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | NonNullable<Part['status']>>('all');
  const [sortBy, setSortBy] = useState<'priority' | 'year_asc' | 'year_desc'>('priority');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [partsSheetOpen, setPartsSheetOpen] = useState(false);
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [sharingSupplierId, setSharingSupplierId] = useState<string | null>(null);
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', whatsapp: '', mapUrl: '', note: '' });
  const [brokenImages, setBrokenImages] = useState<Record<string, true>>({});

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const lastUrlSyncAtRef = useRef(0);

  const orderSlides = useMemo(() => {
    const effectiveBrand = selectedBrand || brandFilter;
    return orders
      .filter((o) => !o.isArchived && !o.isSold)
      .filter((o) => {
        if (effectiveBrand === 'all') return true;
        if (effectiveBrand === LEAD_SLIDES_KEY) return o.isLead || o.customerStatus === 'LEAD' || o.status === 'lead';
        return o.brand === effectiveBrand;
      })
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

  const current = orderSlides[transientDragIndex];
  const committedSlide = orderSlides[committedIndex];

  const goTo = (nextIndex: number) => {
    if (orderSlides.length === 0) return;
    const normalized = (nextIndex + orderSlides.length) % orderSlides.length;
    setTransientDragIndex(normalized);
    setCommittedIndex(normalized);
    vibrate(8);
  };

  useEffect(() => {
    if (transientDragIndex >= orderSlides.length) setTransientDragIndex(0);
    if (committedIndex >= orderSlides.length) setCommittedIndex(0);
  }, [transientDragIndex, committedIndex, orderSlides.length]);

  useEffect(() => {
    if (!initialSlideId || orderSlides.length === 0) return;
    const nextIndex = orderSlides.findIndex((slide) => slide.id === initialSlideId);
    if (nextIndex >= 0) {
      setTransientDragIndex(nextIndex);
      setCommittedIndex(nextIndex);
    }
  }, [initialSlideId, orderSlides]);

  useEffect(() => {
    const currentQuery = location.search.startsWith('?') ? location.search.slice(1) : location.search;
    const nextBrand = selectedBrand || '';
    const nextSlide = committedSlide?.id || '';
    const next = new URLSearchParams(searchParams);

    if (nextBrand) next.set('brand', nextBrand);
    else next.delete('brand');

    if (nextSlide) next.set('slide', nextSlide);
    else next.delete('slide');

    const nextQuery = next.toString();
    if (nextQuery === currentQuery) return;

    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
    }

    syncTimerRef.current = window.setTimeout(() => {
      const now = Date.now();
      if (now - lastUrlSyncAtRef.current < 200) return;
      const liveQuery = window.location.search.startsWith('?') ? window.location.search.slice(1) : window.location.search;
      if (liveQuery === nextQuery) return;
      lastUrlSyncAtRef.current = now;
      setSearchParams(next, { replace: true });
    }, 300);

    return () => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [selectedBrand, committedSlide?.id, location.search, searchParams, setSearchParams]);

  useEffect(() => () => {
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
    }
  }, []);

  useEffect(() => {
    setSupplierForm({ name: '', phone: '', whatsapp: '', mapUrl: '', note: '' });
    setAddingSupplier(false);
    setSharingSupplierId(null);
  }, [current?.id]);

  const brandOptions = useMemo(() => Array.from(new Set(orders.map((o) => o.brand))).sort((a, b) => a.localeCompare(b)), [orders]);

  const leadActiveNeedCount = useMemo(
    () => orders
      .filter((order) => !order.isArchived && !order.isSold && (order.isLead || order.customerStatus === 'LEAD' || order.status === 'lead'))
      .reduce((sum, order) => sum + order.parts.filter((part) => !part.isFound && part.status !== 'found').length, 0),
    [orders]
  );

  const brandActiveNeedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    orders.forEach((order) => {
      if (order.isArchived || order.isSold) return;
      const unresolved = order.parts.filter((part) => !part.isFound && part.status !== 'found').length;
      if (unresolved <= 0) return;
      counts.set(order.brand, (counts.get(order.brand) || 0) + unresolved);
    });
    return counts;
  }, [orders]);

  const supplierContacts = current?.vendorContacts || [];

  const buildWhatsappCaption = () => {
    if (!current) return '';
    const carLine = `${current.brand} ${current.model} ${current.year}`.trim();
    return `${carLine}\nVIN: ${current.vin || '—'}`;
  };

  const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-load-failed'));
    image.src = src;
  });

  const makeSlideImageFile = async () => {
    if (!current) return null;

    const width = 1080;
    const height = 1920;
    const headerHeight = 620;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.fillStyle = '#0B1220';
    context.fillRect(0, 0, width, height);

    const carImages = sanitizeImages([...(Array.isArray(current.carPhotos) ? current.carPhotos : []), current.carPhotoUrl]);
    const firstImage = carImages.find((image) => !brokenImages[image]);
    if (firstImage) {
      try {
        const image = await loadImage(firstImage);
        const ratio = Math.max(width / image.width, headerHeight / image.height);
        const drawWidth = image.width * ratio;
        const drawHeight = image.height * ratio;
        const drawX = (width - drawWidth) / 2;
        const drawY = (headerHeight - drawHeight) / 2;
        context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
      } catch {
        context.fillStyle = '#111827';
        context.fillRect(0, 0, width, headerHeight);
      }
    } else {
      context.fillStyle = '#111827';
      context.fillRect(0, 0, width, headerHeight);
    }

    const gradient = context.createLinearGradient(0, headerHeight - 220, 0, headerHeight);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.82)');
    context.fillStyle = gradient;
    context.fillRect(0, headerHeight - 220, width, 220);

    context.fillStyle = '#ffffff';
    context.font = '700 62px Inter, Arial, sans-serif';
    context.fillText(`${current.brand} ${current.model}`.trim(), 44, headerHeight - 132);

    context.fillStyle = '#fcd34d';
    context.font = '700 42px Inter, Arial, sans-serif';
    context.fillText(`${current.year} · ${current.bodyType || '—'} · ${current.visibleParts.length} деталей`, 44, headerHeight - 78);

    context.fillStyle = '#fcd34d';
    context.font = '700 44px Inter, Arial, sans-serif';
    context.fillText(`VIN: ${current.vin || '—'}`, 44, headerHeight - 28);

    let y = headerHeight + 34;
    current.visibleParts.slice(0, 18).forEach((part, idx) => {
      context.fillStyle = '#111a2d';
      context.strokeStyle = 'rgba(71,85,105,0.8)';
      context.lineWidth = 2;
      context.beginPath();
      context.roundRect(30, y, width - 60, 78, 22);
      context.fill();
      context.stroke();

      context.fillStyle = '#ffffff';
      context.font = '700 30px Inter, Arial, sans-serif';
      context.fillText(`${idx + 1}. ${part.name}`.slice(0, 58), 52, y + 42);

      context.fillStyle = 'rgba(255,255,255,0.68)';
      context.font = '500 22px Inter, Arial, sans-serif';
      context.fillText(`Статус: ${part.status || 'searching'} • Вариантов: ${part.variants.length}`, 52, y + 68);
      y += 92;
    });

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) return null;

    const fileName = `order-${current.brand}-${current.model}-${current.vin || 'vin'}-${Date.now()}.jpg`
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9_.-]/g, '');

    return new File([blob], fileName, { type: 'image/jpeg' });
  };

  const openSupplierWhatsapp = async (contact: OrderVendorContact) => {
    const phone = phoneDigits(contact.whatsapp || contact.phone);
    if (!phone || !current) return;

    const caption = buildWhatsappCaption();
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(caption)}`;
    setSharingSupplierId(contact.id);

    try {
      const imageFile = await makeSlideImageFile();
      if (imageFile) {
        const imageUrl = URL.createObjectURL(imageFile);
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = imageFile.name;
        link.click();
        URL.revokeObjectURL(imageUrl);
      }

      window.open(whatsappUrl, '_blank');
    } catch {
      window.open(whatsappUrl, '_blank');
    } finally {
      setSharingSupplierId(null);
    }
  };

  const saveSupplier = async () => {
    if (!current) return;
    const name = supplierForm.name.trim();
    if (!name) return;

    const now = Date.now();
    const nextContact: OrderVendorContact = {
      id: ensureUuid(),
      name,
      phone: supplierForm.phone.trim(),
      whatsapp: supplierForm.whatsapp.trim(),
      mapUrl: supplierForm.mapUrl.trim(),
      note: supplierForm.note.trim(),
      createdAt: now,
      updatedAt: now
    };

    const normalizedName = name.toLowerCase();
    const normalizedPhone = phoneDigits(nextContact.phone || nextContact.whatsapp);
    const existsInBase = suppliers.some((item) => {
      const byName = item.name.trim().toLowerCase() === normalizedName;
      const itemPhone = phoneDigits(item.phone || item.whatsapp || '');
      const byPhone = normalizedPhone.length > 0 && itemPhone === normalizedPhone;
      return byName || byPhone;
    });

    if (!existsInBase) {
      const baseSupplier: Supplier = {
        id: ensureUuid(),
        name,
        phone: nextContact.phone || nextContact.whatsapp || '',
        whatsapp: nextContact.whatsapp || nextContact.phone || '',
        hasWhatsapp: Boolean(nextContact.whatsapp || nextContact.phone),
        location: nextContact.mapUrl || '',
        brands: current.brand ? [current.brand] : [],
        mainBrands: current.brand ? [current.brand] : [],
        primaryBrand: current.brand || '',
        models: current.model ? [current.model] : [],
        years: Number.isFinite(Number(current.year)) ? [Number(current.year)] : [],
        bodyTypes: current.bodyType ? [current.bodyType] : [],
        type: 'mixed',
        activeOrderIds: [current.id],
        linkedParts: current.visibleParts.slice(0, 6).map((part) => ({
          id: ensureUuid(),
          orderId: current.id,
          orderLabel: `${current.brand} ${current.model} • ${current.vin || '—'}`,
          partId: part.id,
          partName: part.name,
          status: part.status === 'found' || part.isFound ? 'found' : 'searching',
          source: 'manual',
          updatedAt: now
        })),
        comment: nextContact.note || '',
        createdAt: now,
        updatedAt: now
      };
      addSupplier(baseSupplier);
    }

    await updateOrder({
      ...current,
      vendorContacts: [nextContact, ...(current.vendorContacts || [])],
      updatedAt: now
    });

    setSupplierForm({ name: '', phone: '', whatsapp: '', mapUrl: '', note: '' });
    setAddingSupplier(false);
  };

  if (!selectedBrand) {
    return (
      <div className="absolute inset-0 z-50 bg-[#0B1220] p-4 text-white">
        <p className="mb-4 text-xl font-black">Выберите марку</p>
        <div className="grid grid-cols-2 gap-3 overflow-auto pb-20">
          <button
            type="button"
            onClick={() => {
              setSelectedBrand(LEAD_SLIDES_KEY);
              setBrandFilter(LEAD_SLIDES_KEY);
            }}
            className="rounded-2xl border border-rose-500 bg-rose-900/45 px-4 py-4 text-left text-lg font-black shadow-[0_0_0_1px_rgba(251,113,133,0.2)] hover:border-rose-400"
          >
            <span className="inline-flex items-center gap-2">🔥 ЛИД</span>
            <span className="mt-1 block text-xs font-semibold text-rose-100/85">Найти заказов: {leadActiveNeedCount}</span>
          </button>
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
              <span>{brand}</span>
              <span className="mt-1 block text-xs font-semibold text-white/65">Найти заказов: {brandActiveNeedCounts.get(brand) || 0}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#0B1220] text-gray-300">
        <p>Нет данных</p>
        <button type="button" onClick={() => navigate(-1)} className="rounded-xl border border-gray-700 px-4 py-2">Назад</button>
      </div>
    );
  }

  const carImages = sanitizeImages([...(Array.isArray(current.carPhotos) ? current.carPhotos : []), current.carPhotoUrl]);
  const availableCarImages = carImages.filter((image) => !brokenImages[image]);

  return (
    <div className="absolute inset-0 z-50 flex h-full w-full flex-col overflow-hidden bg-[#0B1220] text-white">
      <div className="relative h-[32vh] min-h-[210px] max-h-[300px] overflow-hidden border-b border-slate-800">
        {availableCarImages[0] ? (
          <button type="button" onClick={() => setGallery({ images: availableCarImages, index: 0 })} className="h-full w-full">
            <SafeImage
              src={availableCarImages[0]}
              alt="car"
              className="h-full w-full object-cover"
              onError={() => setBrokenImages((prev) => ({ ...prev, [availableCarImages[0]]: true }))}
            />
          </button>
        ) : (
          <div className="h-full w-full bg-slate-900" />
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pb-3 pt-8">
          <p className="truncate text-xl font-black leading-tight">{current.brand} {current.model}</p>
          {(selectedBrand || brandFilter) === LEAD_SLIDES_KEY && <p className="mt-1 text-xs font-black uppercase tracking-[0.2em] text-rose-200">Режим: ЛИД</p>}
          <p className="mt-1 text-base font-black text-amber-200">{current.year} · {current.bodyType || '—'} · {current.visibleParts.length} деталей</p>
          <p className="mt-1 truncate text-sm font-black tracking-[0.16em] text-amber-200">VIN: {current.vin || '—'}</p>

          <div className="pointer-events-auto mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/order/${current.id}`)}
              className="rounded-xl border border-slate-500/90 bg-black/40 px-3 py-1 text-xs font-bold text-white"
            >
              Открыть заказ
            </button>
            <button
              type="button"
              onClick={() => setSuppliersOpen(true)}
              className="inline-flex items-center gap-1 rounded-xl border border-cyan-400/70 bg-cyan-900/30 px-3 py-1 text-xs font-bold text-cyan-100"
            >
              <Users size={13} /> Поставщики ({supplierContacts.length})
            </button>
          </div>
        </div>

        <div className="absolute right-3 top-3 z-10 flex gap-2">
          <button type="button" onClick={() => setFiltersOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45"><Filter size={18} /></button>
          <button type="button" onClick={() => setSelectedBrand(null)} className="rounded-full bg-black/45 px-3 text-[11px] font-bold">Марки</button>
          <button type="button" onClick={() => navigate(-1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45"><X size={20} /></button>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
        onTouchStart={(e) => {
          const t = e.targetTouches[0];
          touchStart.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          if (!touchStart.current) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - touchStart.current.x;
          const dy = t.clientY - touchStart.current.y;
          if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) * 1.15) goTo(committedIndex + (dx > 0 ? -1 : 1));
          touchStart.current = null;
        }}
      >
        {current.visibleParts.map((part) => {
          const images = sanitizeImages([...(Array.isArray(part.photos) ? part.photos : []), part.photoUrl]);
          const availableImages = images.filter((image) => !brokenImages[image]);
          const isFound = part.isFound || part.status === 'found' || part.variants.some((variant) => Number(variant.priceAed) > 0);

          return (
            <div
              key={part.id}
              className={`flex items-center gap-3 rounded-2xl border p-2 transition ${isFound ? 'border-emerald-700/80 bg-emerald-900/15 opacity-65' : 'border-slate-700 bg-[#111a2d]'}`}
            >
              <button type="button" className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-900" onClick={() => availableImages[0] && setGallery({ images: availableImages, index: 0 })}>
                {availableImages[0] ? (
                  <SafeImage
                    src={availableImages[0]}
                    alt={part.name}
                    className="h-full w-full object-cover"
                    onError={() => setBrokenImages((prev) => ({ ...prev, [availableImages[0]]: true }))}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-slate-500"><ImageOff size={18} /></div>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-black">{part.name}</p>
                <p className="text-xs text-white/60">Статус: {part.status || 'searching'} • Вариантов: {part.variants.length}</p>
              </div>

              <button
                type="button"
                onClick={() => navigate(`/order/${current.id}/part/${part.id}`, { replace: false, state: { backTo: `/vendor?brand=${encodeURIComponent(selectedBrand || '')}&slide=${current.id}` } })}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-2 py-1.5 text-xs font-semibold text-white/90"
              >
                Карточка детали <ExternalLink size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="absolute inset-x-0 bottom-3 flex items-center justify-between px-4">
        <button type="button" onClick={() => goTo(committedIndex - 1)} className="rounded-xl border border-slate-600 px-3 py-2 text-xs">Назад</button>
        <button type="button" onClick={() => setPartsSheetOpen(true)} className="rounded-xl border border-slate-600 px-3 py-2 text-xs">Авто список</button>
        <button type="button" onClick={() => goTo(committedIndex + 1)} className="rounded-xl border border-slate-600 px-3 py-2 text-xs">Далее</button>
      </div>

      {filtersOpen && (
        <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setFiltersOpen(false)}>
          <div className="mt-20 rounded-3xl border border-slate-700 bg-[#111a2d] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-white/70">Фильтры</p>
            <div className="space-y-3 text-sm">
              <div>
                <p className="mb-1 text-xs text-white/70">Марки</p>
                <select
                  value={brandFilter}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '__choose') {
                      setSelectedBrand(null);
                      return;
                    }
                    setBrandFilter(value);
                    setSelectedBrand(value === 'all' ? null : value);
                  }}
                  className="w-full rounded-xl bg-slate-800 px-3 py-2"
                >
                  <option value="all">Все марки</option>
                  <option value={LEAD_SLIDES_KEY}>Только ЛИД</option>
                  <option value="__choose">Выбрать экран марок</option>
                  {brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </div>

              <div>
                <p className="mb-1 text-xs text-white/70">Приоритет</p>
                <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as 'all' | Priority)} className="w-full rounded-xl bg-slate-800 px-3 py-2">
                  <option value="all">Любой</option>
                  <option value={Priority.HIGH}>High</option>
                  <option value={Priority.MEDIUM}>Medium</option>
                  <option value={Priority.LOW}>Low</option>
                </select>
              </div>

              <div>
                <p className="mb-1 text-xs text-white/70">Статус</p>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | NonNullable<Part['status']>)} className="w-full rounded-xl bg-slate-800 px-3 py-2">
                  <option value="all">Любой</option>
                  <option value="searching">Searching</option>
                  <option value="found">Found</option>
                  <option value="ordered">Ordered</option>
                  <option value="not_found">Not found</option>
                </select>
              </div>

              <div>
                <p className="mb-1 text-xs text-white/70">Сортировка</p>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'priority' | 'year_asc' | 'year_desc')} className="w-full rounded-xl bg-slate-800 px-3 py-2">
                  <option value="priority">По приоритету</option>
                  <option value="year_asc">По году (старые сначала)</option>
                  <option value="year_desc">По году (новые сначала)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {partsSheetOpen && (
        <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setPartsSheetOpen(false)}>
          <div className="mt-16 rounded-3xl border border-slate-700 bg-[#111a2d] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-white/70">Автомобили</p>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto">
              {orderSlides.map((slide, idx) => (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => {
                    setTransientDragIndex(idx);
                    setCommittedIndex(idx);
                    setPartsSheetOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left ${idx === committedIndex ? 'bg-[#2563EB]/25 text-white' : 'bg-slate-800 text-slate-200'}`}
                >
                  <span className="font-semibold">{slide.brand} {slide.model}</span>
                  <span className="text-xs opacity-70">{slide.visibleParts.length} деталей</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {suppliersOpen && (
        <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setSuppliersOpen(false)}>
          <div className="mt-12 rounded-3xl border border-cyan-700/50 bg-[#0f1f35] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-100">Поставщики заказа</p>
              <button
                type="button"
                onClick={() => setAddingSupplier((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/80 px-2 py-1 text-[11px] font-bold text-cyan-100"
              >
                <Plus size={12} /> Добавить
              </button>
            </div>

            {addingSupplier && (
              <div className="mb-3 space-y-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                <input value={supplierForm.name} onChange={(e) => setSupplierForm((prev) => ({ ...prev, name: e.target.value }))} className="h-10 w-full rounded-lg bg-slate-800 px-3 text-sm" placeholder="Название поставщика" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={supplierForm.phone} onChange={(e) => setSupplierForm((prev) => ({ ...prev, phone: e.target.value }))} className="h-10 w-full rounded-lg bg-slate-800 px-3 text-xs" placeholder="Телефон" />
                  <input value={supplierForm.whatsapp} onChange={(e) => setSupplierForm((prev) => ({ ...prev, whatsapp: e.target.value }))} className="h-10 w-full rounded-lg bg-slate-800 px-3 text-xs" placeholder="WhatsApp" />
                </div>
                <input value={supplierForm.mapUrl} onChange={(e) => setSupplierForm((prev) => ({ ...prev, mapUrl: e.target.value }))} className="h-10 w-full rounded-lg bg-slate-800 px-3 text-xs" placeholder="Ссылка карты" />
                <input value={supplierForm.note} onChange={(e) => setSupplierForm((prev) => ({ ...prev, note: e.target.value }))} className="h-10 w-full rounded-lg bg-slate-800 px-3 text-xs" placeholder="Комментарий" />
                <button type="button" onClick={() => void saveSupplier()} className="h-10 w-full rounded-lg bg-cyan-700 text-xs font-bold">Сохранить поставщика</button>
              </div>
            )}

            <div className="max-h-[48vh] space-y-2 overflow-y-auto">
              {supplierContacts.length === 0 && <p className="rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-4 text-xs text-slate-300">Пока нет добавленных поставщиков для этого заказа.</p>}

              {supplierContacts.map((contact) => (
                <div key={contact.id} className="rounded-xl border border-cyan-900/60 bg-slate-900/60 p-3">
                  <p className="text-sm font-black text-white">{contact.name}</p>
                  {contact.note && <p className="mt-1 text-[11px] text-slate-300">{contact.note}</p>}

                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (contact.mapUrl) window.open(contact.mapUrl, '_blank');
                      }}
                      className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-slate-600 text-[10px] font-bold"
                    >
                      <MapPin size={12} /> Карта
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const phone = contact.phone || contact.whatsapp;
                        if (phone) window.open(`tel:${phone}`, '_self');
                      }}
                      className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-slate-600 text-[10px] font-bold"
                    >
                      <Phone size={12} /> Звонок
                    </button>

                    <button
                      type="button"
                      onClick={() => void openSupplierWhatsapp(contact)}
                      disabled={sharingSupplierId === contact.id}
                      className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-emerald-700 text-[10px] font-bold text-white disabled:opacity-60"
                    >
                      <MessageCircle size={12} /> {sharingSupplierId === contact.id ? 'Генерация...' : 'WhatsApp'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
