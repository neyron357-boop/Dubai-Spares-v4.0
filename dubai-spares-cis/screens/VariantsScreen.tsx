import React, { useMemo, useRef, useState } from 'react';
import { Camera, ChevronDown, Heart, Link2, MapPin, Pin, Plus, Store, Trash2, WandSparkles } from 'lucide-react';
import { useStore } from '../store';
import { createUuid } from '../id';
import { PriceVariant } from '../types';
import { VariantLibraryItem } from '../variantLibraryStore';
import { optimizeImageForUpload } from '../storage/photos';

const supplierNameTemplates = ['Desert Auto', 'Falcon Parts', 'Turbo Motors', 'Prime Garage', 'Royal Trading'];
const priceTemplates = [150, 250, 450, 750, 1200, 1800];

type SortKey = 'updated' | 'supplier' | 'price_asc' | 'price_desc';

const VariantsScreen: React.FC = () => {
  const { variantLibrary, saveStandaloneVariant, removeStandaloneVariant, suppliers, updatePriceVariant } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [priceAed, setPriceAed] = useState('');
  const [shopName, setShopName] = useState('');
  const [phone, setPhone] = useState('+971');
  const [location, setLocation] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [selectedVariant, setSelectedVariant] = useState<VariantLibraryItem | null>(null);

  const hasData = useMemo(() => variantLibrary.length > 0, [variantLibrary]);

  const sortedVariants = useMemo(() => {
    const list = [...variantLibrary];
    if (sortKey === 'supplier') {
      return list.sort((a, b) => (a.shopName || '').localeCompare(b.shopName || '', 'ru'));
    }
    if (sortKey === 'price_asc') {
      return list.sort((a, b) => Number(a.priceAed || 0) - Number(b.priceAed || 0));
    }
    if (sortKey === 'price_desc') {
      return list.sort((a, b) => Number(b.priceAed || 0) - Number(a.priceAed || 0));
    }
    return list.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  }, [variantLibrary, sortKey]);

  const resetForm = () => {
    setIsCreating(false);
    setPriceAed('');
    setShopName('');
    setPhone('+971');
    setLocation('');
    setMapsUrl('');
    setNote('');
    setPhotos([]);
    setSupplierId('');
  };

  const fillCurrentLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocation((prev) => prev || `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
    }, () => undefined, { enableHighAccuracy: true, timeout: 5000 });
  };

  const handleSupplierChange = (value: string) => {
    setSupplierId(value);
    const supplier = suppliers.find((item) => item.id === value);
    if (!supplier) return;
    setShopName(supplier.name || '');
    setPhone(supplier.phone || '+971');
    setLocation(supplier.location || '');
  };

  const onPhotosChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) return;
    const files = Array.from(event.target.files);
    void Promise.all(files.map(async (file) => {
      try {
        return await optimizeImageForUpload(file, `variants-screen:${file.name}`);
      } catch {
        const reader = new FileReader();
        return await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file as Blob);
        });
      }
    })).then((prepared) => {
      setPhotos((prev) => [...prev, ...prepared.filter(Boolean)]);
    });
    event.target.value = '';
  };

  const handleCreateVariant = () => {
    if (!shopName.trim() || !Number(priceAed)) {
      alert('Укажите магазин и цену');
      return;
    }

    const created: VariantLibraryItem = {
      id: createUuid(),
      partId: undefined,
      origin: 'standalone',
      priceAed: Number(priceAed),
      currency: 'AED',
      shopName: shopName.trim(),
      shopNameManual: shopName.trim(),
      shopId: supplierId || undefined,
      phone: phone.trim(),
      location: location.trim(),
      locationText: location.trim(),
      mapsUrl: mapsUrl.trim(),
      note: note.trim(),
      photos,
      photoUrl: photos[0],
      condition: 'used',
      availability: 'in_stock',
      deliveryEta: 'today',
      isFavorite: false,
      isPinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    saveStandaloneVariant(created);
    resetForm();
  };

  const miniPhotos = (variant: PriceVariant) => {
    const merged = [variant.photoUrl, ...(variant.photos || [])].filter((item): item is string => !!item);
    return Array.from(new Set(merged));
  };

  const persistVariant = (variant: VariantLibraryItem) => {
    if (variant.origin === 'standalone') {
      saveStandaloneVariant({ ...variant, updatedAt: Date.now() });
      return;
    }
    if (!variant.sourcePartId) return;
    void updatePriceVariant(variant.sourcePartId, { ...variant, updatedAt: Date.now() });
  };

  return (
    <div className="p-4 pb-24 space-y-4 bg-gray-50 min-h-full">
      <div className="rounded-2xl bg-white border border-gray-200 p-4">
        <h1 className="text-lg font-black text-gray-900">Варианты</h1>
        <p className="text-xs text-gray-500 mt-1">Здесь собраны варианты из заказов и отдельно созданные варианты.</p>
        <button
          type="button"
          onClick={() => setIsCreating((prev) => !prev)}
          className="mt-3 w-full h-11 rounded-xl bg-blue-600 text-white text-sm font-black flex items-center justify-center gap-2"
        >
          <Plus size={18} />
          {isCreating ? 'Скрыть форму' : 'Создать вариант без заказа'}
        </button>
      </div>

      {isCreating && (
        <div className="rounded-2xl bg-white border border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <label className="text-[11px] font-bold text-gray-500">Поставщик из базы</label>
            <select value={supplierId} onChange={(event) => handleSupplierChange(event.target.value)} className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm">
              <option value="">Выбрать существующего поставщика</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.phone || 'без телефона'}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <input value={shopName} onChange={(event) => setShopName(event.target.value)} placeholder="Поставщик / магазин" className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" />
            <button type="button" onClick={() => setShopName(supplierNameTemplates[Math.floor(Math.random() * supplierNameTemplates.length)])} className="h-11 px-3 rounded-xl border border-violet-200 text-violet-700 text-xs font-black inline-flex items-center gap-1"><WandSparkles size={14} />Имя</button>
          </div>
          <div className="flex gap-2">
            <input value={priceAed} onChange={(event) => setPriceAed(event.target.value)} placeholder="Цена AED" type="number" className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" />
            <button type="button" onClick={() => setPriceAed(String(priceTemplates[Math.floor(Math.random() * priceTemplates.length)]))} className="h-11 px-3 rounded-xl border border-emerald-200 text-emerald-700 text-xs font-black">Шаблон цены</button>
          </div>
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Телефон" className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" />
          <div className="flex gap-2">
            <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Локация" className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" />
            <button type="button" onClick={fillCurrentLocation} className="h-11 px-3 rounded-xl border border-gray-200 text-xs font-black inline-flex items-center gap-1"><MapPin size={14} />Текущая</button>
          </div>
          <input value={mapsUrl} onChange={(event) => setMapsUrl(event.target.value)} placeholder="Google Maps URL" className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" />
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Комментарий" className="w-full min-h-[88px] rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="h-10 px-3 rounded-xl border border-gray-200 text-xs font-bold flex items-center gap-2"><Camera size={16} /> Фото</button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onPhotosChange} />
            <button type="button" onClick={handleCreateVariant} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-xs font-black">Сохранить вариант</button>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white border border-gray-200 p-3">
        <label className="text-[11px] font-bold text-gray-500">Сортировка</label>
        <div className="relative mt-1">
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm appearance-none">
            <option value="updated">По дате обновления</option>
            <option value="supplier">По поставщику</option>
            <option value="price_asc">По цене ↑</option>
            <option value="price_desc">По цене ↓</option>
          </select>
          <ChevronDown size={16} className="absolute right-3 top-3 text-gray-400" />
        </div>
      </div>

      <div className="space-y-3">
        {hasData ? sortedVariants.map((variant: VariantLibraryItem) => {
          const photosForCard = miniPhotos(variant);
          return (
            <button key={`${variant.origin}-${variant.id}-${variant.sourceOrderId || 'none'}`} type="button" onClick={() => setSelectedVariant(variant)} className="w-full text-left rounded-2xl bg-white border border-gray-200 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-gray-900">{variant.shopName || 'Без названия'}</p>
                  <p className="text-xs text-gray-500">{variant.sourcePartName || 'Деталь не выбрана'} · {variant.origin === 'standalone' ? 'Отдельный вариант' : `Заказ: ${variant.sourceOrderLabel || '—'}`}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-emerald-700">{Number(variant.priceAed || 0)} AED</p>
                  <p className="text-[11px] text-gray-500">{new Date(variant.updatedAt || variant.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Store size={14} />
                <span>{variant.phone || 'Телефон не указан'}</span>
              </div>
              {variant.mapsUrl && (
                <span className="flex items-center gap-2 text-xs text-blue-600 font-semibold">
                  <Link2 size={14} /> Открыть карту
                </span>
              )}
              {photosForCard.length > 0 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  {photosForCard.slice(0, 4).map((photo) => (
                    <img key={photo} src={photo} className="w-14 h-14 rounded-lg object-cover border border-gray-200" />
                  ))}
                </div>
              )}
              {variant.note && <p className="text-xs text-gray-600">{variant.note}</p>}
            </button>
          );
        }) : (
          <div className="rounded-2xl bg-white border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
            Пока нет вариантов. Создайте первый вариант без заказа.
          </div>
        )}
      </div>

      {selectedVariant && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end">
          <div className="w-full max-h-[86vh] overflow-y-auto rounded-t-3xl bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-gray-900">{selectedVariant.shopName || 'Вариант'}</h2>
              <button type="button" onClick={() => setSelectedVariant(null)} className="h-8 px-3 rounded-lg border border-gray-200 text-xs font-bold">Закрыть</button>
            </div>
            <p className="text-xs text-gray-500">{selectedVariant.sourcePartName || 'Без детали'} · {Number(selectedVariant.priceAed || 0)} AED</p>
            <input value={selectedVariant.shopName || ''} onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, shopName: event.target.value } : prev)} className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" placeholder="Поставщик" />
            <input value={String(selectedVariant.priceAed || '')} type="number" onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, priceAed: Number(event.target.value || 0) } : prev)} className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" placeholder="Цена" />
            <input value={selectedVariant.phone || ''} onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, phone: event.target.value } : prev)} className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" placeholder="Телефон" />
            <input value={selectedVariant.locationText || selectedVariant.location || ''} onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, locationText: event.target.value, location: event.target.value } : prev)} className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" placeholder="Локация" />
            <textarea value={selectedVariant.note || ''} onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, note: event.target.value } : prev)} className="w-full min-h-[90px] rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="Комментарий" />

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSelectedVariant((prev) => prev ? { ...prev, isFavorite: !prev.isFavorite } : prev)} className={`h-10 rounded-xl border text-xs font-black inline-flex items-center justify-center gap-1 ${selectedVariant.isFavorite ? 'border-pink-300 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-700'}`}><Heart size={14} /> Избранное</button>
              <button type="button" onClick={() => setSelectedVariant((prev) => prev ? { ...prev, isPinned: !prev.isPinned } : prev)} className={`h-10 rounded-xl border text-xs font-black inline-flex items-center justify-center gap-1 ${selectedVariant.isPinned ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-700'}`}><Pin size={14} /> Закрепить</button>
            </div>

            {selectedVariant.mapsUrl && (
              <a href={selectedVariant.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex text-xs font-bold text-blue-700">Открыть карту</a>
            )}
            {(miniPhotos(selectedVariant).length > 0) && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {miniPhotos(selectedVariant).map((photo) => (
                  <img key={photo} src={photo} className="w-20 h-20 rounded-lg object-cover border border-gray-200" />
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { persistVariant(selectedVariant); setSelectedVariant(null); }} className="h-10 rounded-xl bg-emerald-600 text-white text-xs font-black">Сохранить</button>
              {selectedVariant.origin === 'standalone'
                ? <button type="button" onClick={() => { removeStandaloneVariant(selectedVariant.id); setSelectedVariant(null); }} className="h-10 rounded-xl border border-rose-200 text-rose-600 text-xs font-black inline-flex items-center justify-center gap-1"><Trash2 size={14} />Удалить</button>
                : <div />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VariantsScreen;
