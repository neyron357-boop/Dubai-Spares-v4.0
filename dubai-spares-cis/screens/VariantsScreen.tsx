import React, { useMemo, useRef, useState } from 'react';
import { Camera, Link2, Plus, Store, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { createUuid } from '../id';
import { PriceVariant } from '../types';
import { VariantLibraryItem } from '../variantLibraryStore';
import { optimizeImageForUpload } from '../storage/photos';

const VariantsScreen: React.FC = () => {
  const { variantLibrary, saveStandaloneVariant, removeStandaloneVariant } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [priceAed, setPriceAed] = useState('');
  const [shopName, setShopName] = useState('');
  const [phone, setPhone] = useState('+971');
  const [location, setLocation] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  const hasData = useMemo(() => variantLibrary.length > 0, [variantLibrary]);

  const resetForm = () => {
    setIsCreating(false);
    setPriceAed('');
    setShopName('');
    setPhone('+971');
    setLocation('');
    setMapsUrl('');
    setNote('');
    setPhotos([]);
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
      shopId: undefined,
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
          <input value={shopName} onChange={(event) => setShopName(event.target.value)} placeholder="Поставщик / магазин" className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" />
          <input value={priceAed} onChange={(event) => setPriceAed(event.target.value)} placeholder="Цена AED" type="number" className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" />
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Телефон" className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" />
          <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Локация" className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" />
          <input value={mapsUrl} onChange={(event) => setMapsUrl(event.target.value)} placeholder="Google Maps URL" className="w-full h-11 rounded-xl border border-gray-200 px-3 text-sm" />
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Комментарий" className="w-full min-h-[88px] rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="h-10 px-3 rounded-xl border border-gray-200 text-xs font-bold flex items-center gap-2"><Camera size={16} /> Фото</button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onPhotosChange} />
            <button type="button" onClick={handleCreateVariant} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-xs font-black">Сохранить вариант</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {hasData ? variantLibrary.map((variant: VariantLibraryItem) => {
          const photosForCard = miniPhotos(variant);
          return (
            <div key={`${variant.origin}-${variant.id}-${variant.sourceOrderId || 'none'}`} className="rounded-2xl bg-white border border-gray-200 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-gray-900">{variant.shopName || 'Без названия'}</p>
                  <p className="text-xs text-gray-500">{variant.origin === 'standalone' ? 'Отдельный вариант' : `Из заказа: ${variant.sourceOrderLabel || '—'}`}</p>
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
                <a href={variant.mapsUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs text-blue-600 font-semibold">
                  <Link2 size={14} /> Открыть карту
                </a>
              )}
              {photosForCard.length > 0 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  {photosForCard.slice(0, 4).map((photo) => (
                    <img key={photo} src={photo} className="w-14 h-14 rounded-lg object-cover border border-gray-200" />
                  ))}
                </div>
              )}
              {variant.note && <p className="text-xs text-gray-600">{variant.note}</p>}
              {variant.origin === 'standalone' && (
                <button type="button" onClick={() => removeStandaloneVariant(variant.id)} className="h-8 px-2 rounded-lg border border-rose-200 text-rose-600 text-xs font-bold flex items-center gap-1">
                  <Trash2 size={14} /> Удалить
                </button>
              )}
            </div>
          );
        }) : (
          <div className="rounded-2xl bg-white border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
            Пока нет вариантов. Создайте первый вариант без заказа.
          </div>
        )}
      </div>
    </div>
  );
};

export default VariantsScreen;
