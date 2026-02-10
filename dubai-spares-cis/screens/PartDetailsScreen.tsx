import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { PriceVariant } from '../types';
import { 
  ArrowLeft, 
  Camera, 
  Phone, 
  MapPin, 
  Trash2, 
  Plus, 
  Store,
  Navigation,
  X,
  Loader2
} from 'lucide-react';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';
import { resolveCoordinatesFromLocation } from '../mapsLocation';
import { upsertSupplierToShops } from '../radarShops';
import { createUuid } from '../id';

const PartDetailsScreen: React.FC = () => {
  const { orderId, partId } = useParams<{ orderId: string, partId: string }>();
  const navigate = useNavigate();
  const { orders, updateOrder, suppliers, addSupplier, updateSupplier } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const order = orders.find(o => o.id === orderId);
  const part = order?.parts.find(p => p.id === partId);

  const [isAdding, setIsAdding] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [deleteVariantId, setDeleteVariantId] = useState<string | null>(null);

  const [priceAed, setPriceAed] = useState('');
  const [shopName, setShopName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  // Multiple photos for variant
  const [variantPhotos, setVariantPhotos] = useState<string[]>([]);
  const [isLocating, setIsLocating] = useState(false);
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [locationParseNotice, setLocationParseNotice] = useState<string | null>(null);

  // LOGIC: Find the most recently added variant within THIS order
  const latestOrderVariant = useMemo(() => {
    if (!order) return null;
    let latest: PriceVariant | null = null;
    
    order.parts.forEach(p => {
      p.variants.forEach(v => {
        if (!latest || v.createdAt > latest.createdAt) {
          latest = v;
        }
      });
    });
    return latest;
  }, [order]);

  useEffect(() => {
    if (isAdding) {
      if (latestOrderVariant) {
        // ✅ FIX: guard against TS inferring "never" by reading via any + fallback
        const v = latestOrderVariant as any;
        setShopName(v?.shopName ?? '');
        setPhone(v?.phone ?? '');
        setLocation(v?.location ?? '');
        setLocationParseNotice(null);
      } else {
        setShopName('');
        setPhone('');
        setLocation('');
        setLocationParseNotice(null);
      }
    }
  }, [isAdding, latestOrderVariant]);

  if (!order || !part) return <div className="p-10 text-center text-gray-400 font-bold">ДЕТАЛЬ НЕ НАЙДЕНА</div>;

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => setVariantPhotos(prev => [...prev, reader.result as string]);
        reader.readAsDataURL(file as Blob);
      });
    }
  };

  const removeVariantPhoto = (index: number) => {
    setVariantPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleShopSelect = (s: any) => {
    setShopName(s.name);
    setPhone(s.phone);
    setLocation(s.location);
    setShowSuggestions(false);
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const link = `https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;
        setLocation(link);
        setIsLocating(false);
      },
      () => setIsLocating(false)
    );
  };


  const buildShopFallbackQueries = () => {
    const cityHints = ['Dubai', 'Sharjah'].filter((city) => location.toLowerCase().includes(city.toLowerCase()));
    const queries = new Set<string>();
    if (shopName.trim()) {
      queries.add(shopName.trim());
      queries.add(`${shopName.trim()} Dubai`);
      queries.add(`${shopName.trim()} Sharjah`);
    }

    const specialization = [order.brand, order.model].filter(Boolean).join(' ').trim();
    if (specialization) {
      const base = `${shopName.trim()} ${specialization}`.trim();
      queries.add(base);
      if (cityHints.length === 0) {
        queries.add(`${base} Dubai`);
        queries.add(`${base} Sharjah`);
      } else {
        cityHints.forEach((city) => queries.add(`${base} ${city}`.trim()));
      }
    }

    return Array.from(queries);
  };

  const saveVariant = async () => {
    if (!priceAed || !shopName) {
      alert('Укажите цену и название магазина');
      return;
    }

    setIsResolvingLocation(true);
    try {
      const existingSupplier = suppliers.find(s => s.name.toLowerCase() === shopName.toLowerCase());
      const resolvedCoordinates = await resolveCoordinatesFromLocation(location, {
        fallbackQueries: buildShopFallbackQueries(),
        onManualLocationRequired: setLocationParseNotice
      });

      if (!existingSupplier) {
        const newSupplier = {
          id: createUuid(),
          name: shopName,
          phone,
          location,
          brands: [order.brand],
          models: order.model ? [order.model] : [],
          years: order.year ? [Number(order.year)].filter(Number.isFinite) : [],
          bodyTypes: order.bodyType ? [order.bodyType] : [],
          coordinates: resolvedCoordinates
        };
        addSupplier(newSupplier);
        await upsertSupplierToShops(newSupplier);
      } else if (!existingSupplier.brands.includes(order.brand) || !existingSupplier.coordinates || (!!order.bodyType && !(existingSupplier.bodyTypes || []).includes(order.bodyType))) {
        const updatedSupplier = {
          ...existingSupplier,
          brands: existingSupplier.brands.includes(order.brand)
            ? existingSupplier.brands
            : [...existingSupplier.brands, order.brand],
          bodyTypes: order.bodyType && !(existingSupplier.bodyTypes || []).includes(order.bodyType)
            ? [...(existingSupplier.bodyTypes || []), order.bodyType]
            : (existingSupplier.bodyTypes || []),
          coordinates: existingSupplier.coordinates || resolvedCoordinates
        };
        updateSupplier(updatedSupplier);
        await upsertSupplierToShops(updatedSupplier);
      }

      const newVariant: PriceVariant = {
        id: Math.random().toString(36).substr(2, 9),
        priceAed: parseFloat(priceAed),
        shopName,
        phone,
        location,
        photos: variantPhotos,
        photoUrl: variantPhotos[0], // Back-compat
        createdAt: Date.now()
      };

      const updatedParts = order.parts.map(p => {
        if (p.id === partId) {
          return {
            ...p,
            isFound: true,
            photoUrl: p.photoUrl || variantPhotos[0], // Set main part photo if none
            photos: (!p.photos || p.photos.length === 0) ? variantPhotos : p.photos,
            variants: [newVariant, ...p.variants]
          };
        }
        return p;
      });

      updateOrder({ ...order, parts: updatedParts });
      setIsAdding(false);
      setPriceAed('');
      setVariantPhotos([]);
      setLocationParseNotice(null);
    } finally {
      setIsResolvingLocation(false);
    }
  };

  const confirmDeleteVariant = () => {
    if (deleteVariantId) {
      const updatedParts = order.parts.map(p => {
        if (p.id === partId) {
          const newVariants = p.variants.filter(v => v.id !== deleteVariantId);
          return { ...p, variants: newVariants, isFound: newVariants.length > 0 };
        }
        return p;
      });
      updateOrder({ ...order, parts: updatedParts });
      setDeleteVariantId(null);
    }
  };

  const getVariantPhotos = (v: PriceVariant) => {
    if (v.photos && v.photos.length > 0) return v.photos;
    if (v.photoUrl) return [v.photoUrl];
    return [];
  };

  const openGallery = (e: React.MouseEvent, variant: PriceVariant) => {
    e.stopPropagation();
    const images = getVariantPhotos(variant);
    if (images.length === 0) return;
    setGallery({ images, index: 0 });
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(shopName.toLowerCase())
  ).slice(0, 3);

  return (
    <div className="flex flex-col min-h-full bg-gray-50 pb-10 overflow-x-hidden">
      <div className="bg-white p-4 border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate(`/order/${orderId}`)} className="p-3 -ml-2 text-gray-600 active:bg-gray-100 rounded-full transition-colors"><ArrowLeft size={24} /></button>
          <div className="text-center flex-1 mx-2">
            <h1 className="font-black text-lg truncate leading-tight uppercase tracking-tight">{part.name}</h1>
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{order.brand} {order.model}</p>
          </div>
          <div className="w-10" />
        </div>
      </div>

      <div className="p-4 space-y-4">
        {!isAdding ? (
          <button 
            type="button"
            onClick={() => setIsAdding(true)}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all uppercase text-xs"
          >
            <Plus size={22} /> Добавить вариант
          </button>
        ) : (
          <form 
            onSubmit={async (e) => { e.preventDefault(); await saveVariant(); }}
            className="bg-white rounded-3xl shadow-xl overflow-hidden border border-blue-50 animate-in slide-in-from-bottom duration-300"
          >
            <div className="p-5 space-y-5">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-blue-600 uppercase tracking-tighter">Новая цена</h3>
                <button type="button" onClick={() => setIsAdding(false)} className="p-2 text-gray-300 active:text-gray-500"><Trash2 size={22} /></button>
              </div>

              <div className="flex flex-col gap-4">
                 {/* Multiple Photo Upload UI */}
                 <div className="flex gap-2 overflow-x-auto no-scrollbar items-center pb-1">
                     <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-24 h-24 bg-gray-50 rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-gray-200 shrink-0 cursor-pointer active:bg-gray-100 transition-colors"
                      >
                         <Camera size={26} className="text-gray-300" />
                         <span className="text-[10px] text-gray-400 font-black tracking-tighter uppercase mt-1">ФОТО</span>
                      </div>
                      {variantPhotos.map((p, i) => (
                          <div key={i} className="relative w-24 h-24 shrink-0 rounded-2xl overflow-hidden border border-gray-200">
                              <img src={p} className="w-full h-full object-cover" />
                              <button 
                                  type="button" 
                                  onClick={() => removeVariantPhoto(i)}
                                  className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 backdrop-blur-sm"
                              >
                                  <X size={12} />
                              </button>
                          </div>
                      ))}
                      <input type="file" ref={fileInputRef} onChange={handlePhotoChange} className="hidden" accept="image/*" multiple />
                 </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Цена (AED)</label>
                  <input 
                    type="number" 
                    autoFocus 
                    value={priceAed} 
                    onChange={(e) => setPriceAed(e.target.value)} 
                    placeholder="0" 
                    className="w-full text-4xl font-black bg-transparent border-b-4 border-blue-500 outline-none p-0 focus:border-blue-600 text-blue-600" 
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Магазин</label>
                  <div className="flex items-center gap-3 mt-1 bg-gray-50 p-4 rounded-2xl border border-gray-100 shadow-inner">
                    <Store size={20} className="text-gray-400" />
                    <input type="text" value={shopName} onChange={(e) => { setShopName(e.target.value); setShowSuggestions(true); }} className="flex-1 bg-transparent outline-none font-bold text-base" placeholder="Dubai Spare..." />
                  </div>
                  {showSuggestions && shopName && filteredSuppliers.length > 0 && (
                    <div className="absolute z-20 top-full left-0 right-0 bg-white shadow-2xl rounded-2xl mt-1 border border-gray-100 overflow-hidden">
                      {filteredSuppliers.map(s => (
                        <button key={s.id} type="button" onClick={() => handleShopSelect(s)} className="w-full text-left p-4 border-b border-gray-50 last:border-none flex items-center justify-between active:bg-blue-50">
                          <div><div className="font-bold text-sm uppercase tracking-tight">{s.name}</div><div className="text-[10px] text-gray-400 font-black">{s.phone}</div></div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Телефон</label>
                  <div className="flex items-center gap-3 mt-1 bg-gray-50 p-4 rounded-2xl border border-gray-100 shadow-inner">
                    <Phone size={20} className="text-gray-400" />
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="flex-1 bg-transparent outline-none font-bold text-base" placeholder="+971..." />
                  </div>
                  {locationParseNotice && (
                    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                      {locationParseNotice}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Локация</label>
                  <div className="flex gap-2 mt-1">
                    <div className="flex-1 flex items-center gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-100 shadow-inner">
                      <MapPin size={20} className="text-gray-400" />
                      <input type="text" value={location} onChange={(e) => { setLocation(e.target.value); setLocationParseNotice(null); }} className="flex-1 bg-transparent outline-none font-bold text-base" placeholder="Ряд / Рядом с..." />
                    </div>
                    <button 
                      type="button"
                      onClick={getCurrentLocation}
                      disabled={isLocating}
                      className={`p-4 rounded-2xl flex items-center justify-center shadow-md transition-all ${isLocating ? 'bg-gray-100 text-gray-400' : 'bg-blue-600 text-white active:scale-95'}`}
                    >
                      <Navigation size={22} className={isLocating ? 'animate-pulse' : ''} />
                    </button>
                  </div>
                </div>
              </div>

              <button type="submit" disabled={isResolvingLocation} className="w-full py-4.5 bg-blue-600 text-white rounded-2xl font-black shadow-xl active:scale-[0.98] transition-all tracking-wider uppercase text-xs inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">{isResolvingLocation ? <><Loader2 size={14} className="animate-spin" /> Поиск координат...</> : 'СОХРАНИТЬ ВАРИАНТ'}</button>
            </div>
          </form>
        )}

        <div className="space-y-4 pt-4">
          <h2 className="font-black text-gray-400 px-1 uppercase text-[10px] tracking-[0.2em]">История цен ({part.variants.length})</h2>
          {part.variants.map(variant => {
             const displayPhotos = getVariantPhotos(variant);
             return (
              <div key={variant.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 flex gap-4">
                  {displayPhotos.length > 0 && (
                    <div className="relative w-24 h-24 shrink-0">
                        <img 
                          src={displayPhotos[0]} 
                          onClick={(e) => openGallery(e, variant)}
                          className="w-full h-full object-cover rounded-2xl cursor-pointer shadow-sm" 
                        />
                        {displayPhotos.length > 1 && (
                            <div className="absolute bottom-0 right-0 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-tl-lg">
                                +{displayPhotos.length - 1}
                            </div>
                        )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex justify-between items-start">
                      <div className="text-2xl font-black text-blue-600 tracking-tight">{variant.priceAed} AED</div>
                      <button 
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDeleteVariantId(variant.id); }}
                        className="p-4 -m-2 text-gray-200 hover:text-red-500 transition-all relative z-20"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                    <h4 className="font-black text-gray-800 mt-1 truncate uppercase tracking-tighter text-sm">{variant.shopName}</h4>
                    <div className="mt-auto pt-2 space-y-1">
                      <div className="flex items-center gap-2 text-xs text-gray-500 font-bold"><Phone size={12} className="shrink-0" /> {variant.phone || '—'}</div>
                      <div className="flex items-center gap-2 text-xs text-gray-400 font-bold truncate"><MapPin size={12} className="shrink-0" /> {variant.location || '—'}</div>
                    </div>
                  </div>
                </div>
              </div>
             );
          })}
        </div>
      </div>

      <ConfirmModal 
        isOpen={!!deleteVariantId} 
        message="Вы уверены, что хотите удалить это предложение?" 
        onConfirm={confirmDeleteVariant} 
        onCancel={() => setDeleteVariantId(null)} 
      />

      {gallery && (
        <ImagePreview 
          images={gallery.images} 
          initialIndex={gallery.index} 
          onClose={() => setGallery(null)} 
        />
      )}
    </div>
  );
};

export default PartDetailsScreen;
