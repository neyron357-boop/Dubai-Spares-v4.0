import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { X, ChevronLeft, ChevronRight, Package, Car, Filter, ArrowUpDown } from 'lucide-react';
import ImagePreview from './ImagePreview';
import { Priority } from '../types';

const priorityWeight = {
  [Priority.HIGH]: 3,
  [Priority.MEDIUM]: 2,
  [Priority.LOW]: 1,
};

type VendorSortType = 'priority' | 'date_desc' | 'date_asc' | 'brand' | 'model' | 'status' | 'parts' | 'type';

const sortOptions: { value: VendorSortType; label: string }[] = [
  { value: 'priority', label: 'Приоритет' },
  { value: 'date_desc', label: 'Дата (новые)' },
  { value: 'date_asc', label: 'Дата (старые)' },
  { value: 'brand', label: 'Марка A-Я' },
  { value: 'model', label: 'Модель A-Я' },
  { value: 'status', label: 'Статус поиска' },
  { value: 'parts', label: 'Кол-во деталей' },
  { value: 'type', label: 'Тип заказа' },
];

const VendorSlider: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();

  const activeOrders = useMemo(() => orders.filter(o => !o.isArchived && !o.isSold), [orders]);

  const [selectedBrand, setSelectedBrand] = useState<string>('All');
  const [sortBy, setSortBy] = useState<VendorSortType>('priority');
  const [index, setIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);

  const brands = useMemo(() => {
    const b = new Set(activeOrders.map(o => o.brand));
    return ['All', ...Array.from(b).sort()];
  }, [activeOrders]);

  const filteredOrders = useMemo(() => {
    const list = selectedBrand === 'All' ? activeOrders : activeOrders.filter(o => o.brand === selectedBrand);
    const statusScore = (partsCount: number, foundCount: number) => {
      if (partsCount === 0) return 0;
      if (foundCount === partsCount) return 3;
      if (foundCount > 0) return 2;
      return 1;
    };

    const orderTypeScore = (order: typeof list[number]) => {
      if (order.status === 'new_inquiry') return 5;
      if (order.isLead) return 4;
      if (order.isVip) return 3;
      if (order.isArchived) return 1;
      return 2;
    };

    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'date_desc':
          return b.createdAt - a.createdAt;
        case 'date_asc':
          return a.createdAt - b.createdAt;
        case 'brand':
          return a.brand.localeCompare(b.brand) || b.createdAt - a.createdAt;
        case 'model':
          return a.model.localeCompare(b.model) || b.createdAt - a.createdAt;
        case 'status': {
          const aFound = a.parts.filter(p => p.variants.length > 0).length;
          const bFound = b.parts.filter(p => p.variants.length > 0).length;
          return statusScore(b.parts.length, bFound) - statusScore(a.parts.length, aFound) || b.createdAt - a.createdAt;
        }
        case 'parts':
          return b.parts.length - a.parts.length || b.createdAt - a.createdAt;
        case 'type':
          return orderTypeScore(b) - orderTypeScore(a) || b.createdAt - a.createdAt;
        case 'priority':
        default:
          return (priorityWeight[b.priority] - priorityWeight[a.priority]) || (b.createdAt - a.createdAt);
      }
    });
  }, [activeOrders, selectedBrand, sortBy]);

  useEffect(() => {
    setIndex(0);
  }, [selectedBrand, sortBy]);

  useEffect(() => {
    if (index >= filteredOrders.length) setIndex(0);
  }, [filteredOrders.length, index]);

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    if (distance > 50 && index < filteredOrders.length - 1) setIndex(prev => prev + 1);
    if (distance < -50 && index > 0) setIndex(prev => prev - 1);
  };

  const openGallery = (e: React.MouseEvent, images: string[]) => {
    e.stopPropagation();
    if (images.length === 0) return;
    setGallery({ images, index: 0 });
  };

  const onClose = () => navigate(-1);
  const order = filteredOrders[index];
  const carPhotos = order ? ((order.carPhotos && order.carPhotos.length > 0) ? order.carPhotos : (order.carPhotoUrl ? [order.carPhotoUrl] : [])) : [];

  return (
    <div
      className="absolute inset-0 z-50 bg-gray-950 flex flex-col h-full w-full"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="p-4 flex items-center justify-between border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-400" />
          <select
            value={selectedBrand}
            onChange={(e) => setSelectedBrand(e.target.value)}
            className="bg-transparent text-white font-bold text-sm outline-none border-none py-1"
          >
            {brands.map(b => <option key={b} value={b} className="bg-gray-900">{b}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-2 rounded-xl bg-gray-800 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
            <ArrowUpDown size={12} />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as VendorSortType)}
              className="bg-transparent text-white outline-none border-none"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value} className="bg-gray-900">
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button onClick={onClose} className="p-2 text-white bg-gray-800 rounded-full active:scale-90 transition-transform"><X size={24} /></button>
        </div>
      </div>

      {filteredOrders.length > 0 && order ? (
        <>
          <div className="flex-1 overflow-y-auto no-scrollbar relative">
            <div key={order.id} className="flex flex-col h-full animate-in slide-in-from-right-10 duration-500">
              <div className="relative h-64 bg-gray-900 overflow-hidden shrink-0">
                {carPhotos.length > 0 ? (
                  <button type="button" onClick={(e) => openGallery(e, carPhotos)} className="w-full h-full block">
                    <img src={carPhotos[0]} className="w-full h-full object-cover opacity-60" alt="Car" />
                    {carPhotos.length > 1 && (
                      <div className="absolute top-3 right-3 bg-blue-600 text-white text-[11px] font-bold px-2 py-1 rounded-lg">
                        +{carPhotos.length - 1}
                      </div>
                    )}
                  </button>
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Car size={80} className="text-gray-800" /></div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-gray-950 to-transparent pointer-events-none" />
                <div className="absolute bottom-6 left-0 right-0 text-center px-4 pointer-events-none">
                  <h1 className="text-3xl font-black text-white leading-none line-clamp-2 break-words">{order.brand || '—'} {order.model || ''}</h1>
                  <p className="text-gray-400 font-bold mt-2 truncate">{order.year || 'Год не указан'} год выпуска</p>
                  <div className="mt-3 flex items-center justify-center gap-2">
                    <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">{order.salesStatus || 'Inquiry'}</span>
                    {order.status === 'new_inquiry' ? (
                      <span className="rounded-full bg-rose-500/85 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white animate-pulse">NEW LEAD</span>
                    ) : order.isLead ? (
                      <span className="rounded-full bg-purple-500/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">LEAD</span>
                    ) : order.isVip ? (
                      <span className="rounded-full bg-amber-500/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">VIP</span>
                    ) : (
                      <span className="rounded-full bg-sky-500/75 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">ACTIVE</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-8">
                <div className="bg-blue-600/10 border border-blue-500/20 p-6 rounded-3xl text-center">
                  <div className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] mb-3">VIN НОМЕР</div>
                  <div className="text-xl font-mono font-black text-white break-all tracking-wider">{order.vin || '—'}</div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest flex items-center gap-2"><Package size={14} /> Список запчастей</h3>
                  <div className="grid gap-3">
                    {order.parts.map(p => {
                      const photos = (p.photos && p.photos.length > 0) ? p.photos : (p.photoUrl ? [p.photoUrl] : []);
                      return (
                        <div key={p.id} className="bg-gray-900 border border-gray-800 p-4 rounded-2xl flex items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className={`w-3 h-3 rounded-full shrink-0 ${p.variants.length > 0 ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-gray-700'}`} />
                            <span className="text-lg font-bold text-gray-200 leading-tight break-words line-clamp-2">{p.name}</span>
                          </div>
                          {photos.length > 0 && (
                            <button
                              onClick={(e) => openGallery(e, photos)}
                              className="w-12 h-12 rounded-xl bg-gray-800 border border-gray-700 overflow-hidden shrink-0 active:scale-95 transition-transform relative"
                            >
                              <img src={photos[0]} className="w-full h-full object-cover" />
                              {photos.length > 1 && (
                                <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[9px] font-bold px-1 rounded-tl">+{photos.length - 1}</div>
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 bg-gray-950 border-t border-gray-900 flex items-center justify-between gap-4 shrink-0 pb-10">
            <button disabled={index === 0} onClick={() => setIndex(index - 1)} className="flex-1 py-4 bg-gray-900 text-white rounded-2xl flex items-center justify-center disabled:opacity-30 active:scale-95 transition-all"><ChevronLeft size={24} /></button>
            <div className="text-white font-mono text-sm">{index + 1} / {filteredOrders.length}</div>
            <button disabled={index === filteredOrders.length - 1} onClick={() => setIndex(index + 1)} className="flex-1 py-4 bg-gray-900 text-white rounded-2xl flex items-center justify-center disabled:opacity-30 active:scale-95 transition-all"><ChevronRight size={24} /></button>
          </div>

          {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4">
          <Car size={48} className="opacity-20" />
          <p>Нет заказов для этой марки</p>
        </div>
      )}
    </div>
  );
};

export default VendorSlider;
