import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { X, ChevronLeft, ChevronRight, Package, Car, Filter, Image as ImageIcon } from 'lucide-react';
import ImagePreview from './ImagePreview';

const VendorSlider: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();
  
  // Only show active orders in vendor view
  const activeOrders = useMemo(() => orders.filter(o => !o.isArchived && !o.isSold), [orders]);

  const [selectedBrand, setSelectedBrand] = useState<string>('All');
  const [index, setIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // Gallery State for Part Photos
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);

  const brands = useMemo(() => {
    const b = new Set(activeOrders.map(o => o.brand));
    return ['All', ...Array.from(b).sort()];
  }, [activeOrders]);

  const filteredOrders = useMemo(() => {
    const list = selectedBrand === 'All' ? activeOrders : activeOrders.filter(o => o.brand === selectedBrand);
    setIndex(0); // Reset index on filter change
    return list;
  }, [activeOrders, selectedBrand]);

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
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    if (isLeftSwipe && index < filteredOrders.length - 1) {
      setIndex(prev => prev + 1);
    }
    if (isRightSwipe && index > 0) {
      setIndex(prev => prev - 1);
    }
  };

  const onClose = () => {
    navigate(-1); // Go back to previous screen
  };

  const openGallery = (e: React.MouseEvent, photos: string[] | undefined, photoUrl: string | undefined) => {
    e.stopPropagation();
    const images = (photos && photos.length > 0) ? photos : (photoUrl ? [photoUrl] : []);
    if (images.length === 0) return;
    setGallery({ images, index: 0 });
  };

  const order = filteredOrders[index];
  const carPhoto = order ? ((order.carPhotos && order.carPhotos.length > 0) ? order.carPhotos[0] : order.carPhotoUrl) : null;

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
        <button onClick={onClose} className="p-2 text-white bg-gray-800 rounded-full active:scale-90 transition-transform"><X size={24} /></button>
      </div>

      {filteredOrders.length > 0 ? (
        <>
          <div className="flex-1 overflow-y-auto no-scrollbar relative">
            <div key={order.id} className="flex flex-col h-full animate-in slide-in-from-right-10 duration-500">
              <div className="relative h-64 bg-gray-900 overflow-hidden shrink-0">
                {carPhoto ? (
                  <img src={carPhoto} className="w-full h-full object-cover opacity-60" alt="Car" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Car size={80} className="text-gray-800" /></div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-gray-950 to-transparent" />
                <div className="absolute bottom-6 left-0 right-0 text-center px-4">
                  <h1 className="text-3xl font-black text-white leading-none">{order.brand} {order.model}</h1>
                  <p className="text-gray-400 font-bold mt-2">{order.year} год выпуска</p>
                </div>
              </div>

              <div className="p-6 space-y-8">
                <div className="bg-blue-600/10 border border-blue-500/20 p-6 rounded-3xl text-center">
                  <div className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] mb-3">VIN НОМЕР</div>
                  <div className="text-2xl font-mono font-black text-white break-all tracking-wider">{order.vin}</div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest flex items-center gap-2"><Package size={14} /> Список запчастей</h3>
                  <div className="grid gap-3">
                    {order.parts.map(p => {
                      const photo = (p.photos && p.photos.length > 0) ? p.photos[0] : p.photoUrl;
                      const hasPhotos = !!photo;
                      
                      return (
                        <div key={p.id} className="bg-gray-900 border border-gray-800 p-4 rounded-2xl flex items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className={`w-3 h-3 rounded-full shrink-0 ${p.variants.length > 0 ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-gray-700'}`} />
                            <span className="text-xl font-bold text-gray-200 leading-tight">{p.name}</span>
                          </div>
                          {hasPhotos && (
                            <button 
                              onClick={(e) => openGallery(e, p.photos, p.photoUrl)}
                              className="w-12 h-12 rounded-xl bg-gray-800 border border-gray-700 overflow-hidden shrink-0 active:scale-95 transition-transform relative"
                            >
                              <img src={photo} className="w-full h-full object-cover" />
                              {(p.photos && p.photos.length > 1) && (
                                <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[9px] font-bold px-1 rounded-tl">
                                  +{p.photos.length - 1}
                                </div>
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
          
          {gallery && (
            <ImagePreview 
              images={gallery.images} 
              initialIndex={gallery.index} 
              onClose={() => setGallery(null)} 
            />
          )}
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
