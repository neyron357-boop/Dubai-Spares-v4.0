import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { OfferAvailability, OfferCondition, PriceVariant } from '../types';
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
  Loader2,
  MoreHorizontal,
  Star,
  Copy,
  MessageCircle,
  ClipboardPaste,
  Clock3,
  Package,
  ChevronDown,
  Check,
  ExternalLink,
  Images
} from 'lucide-react';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';
import { resolveCoordinatesFromLocation } from '../mapsLocation';
import { upsertSupplierToShops } from '../radarShops';
import { createUuid } from '../id';

interface OfferFormState {
  priceAed: string;
  shopName: string;
  phone: string;
  locationText: string;
  mapsUrl: string;
  photos: string[];
  condition: OfferCondition;
  availability: OfferAvailability;
  deliveryEta: 'today' | 'tomorrow' | '2_3_days' | 'week';
  isBest: boolean;
}

const DEFAULT_FORM: OfferFormState = {
  priceAed: '',
  shopName: '',
  phone: '+971',
  locationText: '',
  mapsUrl: '',
  photos: [],
  condition: 'used',
  availability: 'in_stock',
  deliveryEta: 'today',
  isBest: false
};

const conditionLabels: Record<OfferCondition, string> = {
  new: 'NEW',
  used: 'USED',
  scrapyard: 'SCRAPYARD'
};

const availabilityLabels: Record<OfferAvailability, string> = {
  in_stock: 'In stock',
  '1d': '1 day',
  '2_3d': '2–3 days',
  by_order: 'By order'
};

const etaLabels: Record<OfferFormState['deliveryEta'], string> = {
  today: 'Сегодня',
  tomorrow: 'Завтра',
  '2_3_days': '2-3 дня',
  week: 'Неделя'
};


const mergeUniqueStrings = (current: string[] = [], incoming: string[] = []) => {
  const existing = new Set(current.map((item) => item.trim().toLowerCase()).filter(Boolean));
  const next = [...current];
  incoming.forEach((item) => {
    const normalized = item.trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (existing.has(key)) return;
    existing.add(key);
    next.push(normalized);
  });
  return next;
};

const mergeUniqueYears = (current: number[] = [], incoming: number[] = []) => {
  const existing = new Set(current.filter((item) => Number.isFinite(item)).map((item) => Number(item)));
  const next = [...existing];
  incoming.forEach((year) => {
    const normalized = Number(year);
    if (!Number.isFinite(normalized)) return;
    if (existing.has(normalized)) return;
    existing.add(normalized);
    next.push(normalized);
  });
  return next.sort((a, b) => a - b);
};

const PartDetailsScreen: React.FC = () => {
  const { orderId, partId } = useParams<{ orderId: string; partId: string }>();
  const navigate = useNavigate();
  const { orders, updateOrder, suppliers, addSupplier, updateSupplier } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const variantsListRef = useRef<HTMLDivElement>(null);
  const formSessionRef = useRef<string | null>(null);

  const order = orders.find((o) => o.id === orderId);
  const part = order?.parts.find((p) => p.id === partId);

  const [isAdding, setIsAdding] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [deleteVariantId, setDeleteVariantId] = useState<string | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [showAfterSaveSheet, setShowAfterSaveSheet] = useState(false);

  const [form, setForm] = useState<OfferFormState>(DEFAULT_FORM);
  const [isLocating, setIsLocating] = useState(false);
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [locationParseNotice, setLocationParseNotice] = useState<string | null>(null);

  const isEditing = !!editingVariantId;

  const latestOrderVariant = useMemo(() => {
    if (!order) return null;
    let latest: PriceVariant | null = null;
    order.parts.forEach((p) => {
      p.variants.forEach((v) => {
        if (!latest || v.createdAt > latest.createdAt) latest = v;
      });
    });
    return latest;
  }, [order]);

  const numericPrice = Number(form.priceAed.replace(/\s+/g, ''));
  const isPriceValid = Number.isFinite(numericPrice) && numericPrice > 0;
  const canSave = isPriceValid && !!form.shopName.trim();

  const historyPrices = useMemo(() => part?.variants.map((v) => v.priceAed).filter(Boolean) || [], [part?.variants]);
  const avgHistoryPrice = historyPrices.length ? historyPrices.reduce((a, b) => a + b, 0) / historyPrices.length : 0;
  const isPriceOutlier = avgHistoryPrice > 0 && isPriceValid && (numericPrice < avgHistoryPrice * 0.6 || numericPrice > avgHistoryPrice * 1.6);

  const approxClientPrice = useMemo(() => {
    if (!isPriceValid || !order?.exchangeRate) return null;
    const currency = order.clientCurrency || 'USD';
    if (currency === 'AED') return `${numericPrice.toFixed(0)} AED`;
    return `${(numericPrice / order.exchangeRate).toFixed(0)} ${currency}`;
  }, [isPriceValid, numericPrice, order?.exchangeRate, order?.clientCurrency]);

  useEffect(() => {
    if (!isAdding) {
      formSessionRef.current = null;
      return;
    }

    const nextSession = isEditing ? `edit:${editingVariantId || ''}` : 'create';
    if (formSessionRef.current === nextSession) return;
    formSessionRef.current = nextSession;

    if (isEditing && part) {
      const editable = part.variants.find((v) => v.id === editingVariantId);
      if (!editable) return;
      setForm({
        priceAed: String(editable.priceAed || ''),
        shopName: editable.shopName || '',
        phone: editable.phone || '+971',
        locationText: editable.locationText || editable.location || '',
        mapsUrl: editable.mapsUrl || '',
        photos: editable.photos || (editable.photoUrl ? [editable.photoUrl] : []),
        condition: editable.condition || 'used',
        availability: editable.availability || 'in_stock',
        deliveryEta: editable.deliveryEta || 'today',
        isBest: part.bestOfferId === editable.id
      });
      return;
    }

    if (latestOrderVariant) {
      setForm((prev) => ({
        ...prev,
        shopName: latestOrderVariant.shopName ?? '',
        phone: latestOrderVariant.phone || '+971',
        locationText: latestOrderVariant.locationText || latestOrderVariant.location || '',
        mapsUrl: latestOrderVariant.mapsUrl || '',
        condition: latestOrderVariant.condition || prev.condition,
        availability: latestOrderVariant.availability || prev.availability
      }));
    } else {
      setForm(DEFAULT_FORM);
    }
    setLocationParseNotice(null);
  }, [isAdding, isEditing, part, editingVariantId, latestOrderVariant]);

  if (!order || !part) return <div className="p-10 text-center text-gray-400 font-bold">ДЕТАЛЬ НЕ НАЙДЕНА</div>;

  const handleFormPatch = <T extends keyof OfferFormState>(key: T, value: OfferFormState[T]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm((prev) => ({ ...prev, photos: [...prev.photos, reader.result as string] }));
      };
      reader.readAsDataURL(file as Blob);
    });
    e.target.value = '';
  };

  const removeVariantPhoto = (index: number) => {
    setForm((prev) => ({ ...prev, photos: prev.photos.filter((_, i) => i !== index) }));
  };

  const handleShopSelect = (supplier: any) => {
    setForm((prev) => ({
      ...prev,
      shopName: supplier.name,
      phone: supplier.phone || prev.phone,
      locationText: supplier.location || prev.locationText
    }));
    setShowSuggestions(false);
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const mapsUrl = `https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;
        setForm((prev) => ({
          ...prev,
          mapsUrl,
          locationText: prev.locationText || `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`
        }));
        setIsLocating(false);
      },
      () => setIsLocating(false)
    );
  };

  const buildShopFallbackQueries = () => {
    const location = form.locationText;
    const cityHints = ['Dubai', 'Sharjah'].filter((city) => location.toLowerCase().includes(city.toLowerCase()));
    const queries = new Set<string>();
    if (form.shopName.trim()) {
      queries.add(form.shopName.trim());
      queries.add(`${form.shopName.trim()} Dubai`);
      queries.add(`${form.shopName.trim()} Sharjah`);
    }

    const specialization = [order.brand, order.model].filter(Boolean).join(' ').trim();
    if (specialization) {
      const base = `${form.shopName.trim()} ${specialization}`.trim();
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

  const closeEditor = () => {
    setIsAdding(false);
    setEditingVariantId(null);
    setForm(DEFAULT_FORM);
    setLocationParseNotice(null);
  };

  const saveVariant = async () => {
    if (!canSave) {
      alert('Введите цену и магазин');
      return;
    }

    setIsResolvingLocation(true);
    try {
      const existingSupplier = suppliers.find((s) => s.name.toLowerCase() === form.shopName.toLowerCase());
      const locationSource = form.mapsUrl || form.locationText;
      const resolvedCoordinates = await resolveCoordinatesFromLocation(locationSource, {
        fallbackQueries: buildShopFallbackQueries(),
        onManualLocationRequired: setLocationParseNotice
      });

      if (!existingSupplier) {
        const nextBrandPool = mergeUniqueStrings([], [order.brand]);
        const nextModels = mergeUniqueStrings([], [order.model || '']);
        const nextYears = mergeUniqueYears([], [Number(order.year)]);
        const nextBodyTypes = mergeUniqueStrings([], [order.bodyType || '']);
        const newSupplier = {
          id: createUuid(),
          name: form.shopName,
          phone: form.phone,
          location: form.locationText,
          type: form.condition === 'new' ? 'new_parts' : 'scrapyard',
          brands: nextBrandPool,
          mainBrands: nextBrandPool,
          primaryBrand: nextBrandPool[0] || '',
          models: nextModels,
          years: nextYears,
          bodyTypes: nextBodyTypes,
          photoUrl: '',
          photos: [],
          coordinates: resolvedCoordinates
        };
        addSupplier(newSupplier);
        await upsertSupplierToShops(newSupplier);
      } else {
        const currentBrands = existingSupplier.mainBrands || existingSupplier.brands || [];
        const nextBrands = mergeUniqueStrings(currentBrands, [order.brand]);
        const nextModels = mergeUniqueStrings(existingSupplier.models || [], [order.model || '']);
        const nextYears = mergeUniqueYears(existingSupplier.years || [], [Number(order.year)]);
        const nextBodyTypes = mergeUniqueStrings(existingSupplier.bodyTypes || [], [order.bodyType || '']);
        const updatedSupplier = {
          ...existingSupplier,
          phone: existingSupplier.phone || form.phone,
          location: existingSupplier.location || form.locationText,
          brands: nextBrands,
          mainBrands: nextBrands,
          primaryBrand: existingSupplier.primaryBrand || nextBrands[0] || '',
          models: nextModels,
          years: nextYears,
          bodyTypes: nextBodyTypes,
          photoUrl: existingSupplier.photoUrl || '',
          photos: existingSupplier.photos || [],
          coordinates: existingSupplier.coordinates || resolvedCoordinates
        };
        updateSupplier(updatedSupplier);
        await upsertSupplierToShops(updatedSupplier);
      }

      const variantId = editingVariantId || createUuid();
      const newVariant: PriceVariant = {
        id: variantId,
        partId: part.id,
        priceAed: Number(form.priceAed.replace(/\s+/g, '')),
        currency: 'AED',
        shopName: form.shopName.trim(),
        shopNameManual: form.shopName.trim(),
        phone: form.phone,
        location: form.locationText,
        locationText: form.locationText,
        mapsUrl: form.mapsUrl,
        lat: resolvedCoordinates?.lat,
        lng: resolvedCoordinates?.lng,
        photos: form.photos,
        photoUrl: form.photos[0],
        condition: form.condition,
        availability: form.availability,
        deliveryEta: form.deliveryEta,
        isBest: form.isBest,
        syncStatus: navigator.onLine ? 'synced' : 'pending',
        createdAt: editingVariantId ? part.variants.find((v) => v.id === editingVariantId)?.createdAt || Date.now() : Date.now(),
        updatedAt: Date.now()
      };

      const updatedParts = order.parts.map((p) => {
        if (p.id !== partId) return p;
        const exists = p.variants.some((v) => v.id === variantId);
        const variants = exists
          ? p.variants.map((v) => (v.id === variantId ? newVariant : v))
          : [newVariant, ...p.variants];

        const bestOfferId = form.isBest ? variantId : p.bestOfferId === variantId ? undefined : p.bestOfferId;
        return {
          ...p,
          isFound: true,
          bestOfferId,
          photoUrl: p.photoUrl || form.photos[0],
          photos: p.photos?.length ? p.photos : form.photos,
          variants: variants.map((v) => ({ ...v, isBest: form.isBest ? v.id === variantId : v.isBest && v.id !== variantId }))
        };
      });

      updateOrder({ ...order, parts: updatedParts });
      setShowAfterSaveSheet(!editingVariantId);
      closeEditor();
    } finally {
      setIsResolvingLocation(false);
    }
  };

  const confirmDeleteVariant = () => {
    if (!deleteVariantId) return;
    const updatedParts = order.parts.map((p) => {
      if (p.id !== partId) return p;
      const newVariants = p.variants.filter((v) => v.id !== deleteVariantId);
      return {
        ...p,
        variants: newVariants,
        isFound: newVariants.length > 0,
        bestOfferId: p.bestOfferId === deleteVariantId ? undefined : p.bestOfferId
      };
    });
    updateOrder({ ...order, parts: updatedParts });
    setDeleteVariantId(null);
  };

  const getVariantPhotos = (variant: PriceVariant) => {
    if (variant.photos?.length) return variant.photos;
    if (variant.photoUrl) return [variant.photoUrl];
    return [];
  };

  const openGallery = (e: React.MouseEvent, variant: PriceVariant) => {
    e.stopPropagation();
    const images = getVariantPhotos(variant);
    if (!images.length) return;
    setGallery({ images, index: 0 });
  };

  const filteredSuppliers = suppliers.filter((s) => s.name.toLowerCase().includes(form.shopName.toLowerCase())).slice(0, 5);

  const openRoute = (variant: PriceVariant) => {
    const query = variant.mapsUrl || variant.locationText || variant.location;
    if (!query) return;
    const normalized = query.startsWith('http') ? query : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    window.open(normalized, '_blank');
  };

  const openWhatsapp = (variant: PriceVariant) => {
    const phoneRaw = (variant.phone || '').replace(/[^\d+]/g, '');
    if (!phoneRaw) return;
    const message = `Привет! Нужна ${part.name} на ${order.brand} ${order.model} ${order.year}.\nЕсть в наличии? Цена? Состояние?\nМожно фото/номер детали? 🙏${order.vin ? `\nVIN: ${order.vin}` : ''}`;
    window.open(`https://wa.me/${phoneRaw.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const formatPhone = (value: string) => {
    const cleaned = value.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned;
    if (!cleaned) return '+971';
    return `+${cleaned}`;
  };

  const pasteFromClipboard = async (target: 'priceAed' | 'phone' | 'locationText' | 'mapsUrl') => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      if (target === 'phone') handleFormPatch('phone', formatPhone(text));
      else handleFormPatch(target, text as never);
    } catch {
      alert('Буфер обмена недоступен');
    }
  };

  const duplicateTopVariant = () => {
    const source = part.variants[0];
    if (!source) return;
    setIsAdding(true);
    setEditingVariantId(null);
    setForm({
      priceAed: String(source.priceAed || ''),
      shopName: source.shopName || '',
      phone: source.phone || '+971',
      locationText: source.locationText || source.location || '',
      mapsUrl: source.mapsUrl || '',
      photos: source.photos || [],
      condition: source.condition || 'used',
      availability: source.availability || 'in_stock',
      deliveryEta: source.deliveryEta || 'today',
      isBest: false
    });
  };

  return (
    <div className="flex flex-col min-h-full bg-gray-50 pb-28 overflow-x-hidden">
      <div className="bg-white p-4 border-b border-gray-100 sticky top-0 z-20 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <button onClick={() => navigate(`/order/${orderId}`)} className="p-3 -ml-2 text-gray-600 active:bg-gray-100 rounded-full transition-colors"><ArrowLeft size={22} /></button>
          <div className="text-center flex-1">
            <h1 className="font-black text-lg truncate leading-tight uppercase tracking-tight">{part.name}</h1>
            <p className="text-[11px] text-gray-600 font-bold">{order.brand} {order.model} · {order.year || '—'} {order.vin ? `· VIN ${order.vin}` : ''}</p>
          </div>
          <div className="relative">
            <button onClick={() => setShowMenu((prev) => !prev)} className="p-3 text-gray-600 rounded-full active:bg-gray-100"><MoreHorizontal size={20} /></button>
            {showMenu && (
              <div className="absolute top-12 right-0 w-56 rounded-2xl bg-white border border-gray-100 shadow-2xl overflow-hidden">
                <button type="button" onClick={() => { variantsListRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowMenu(false); }} className="w-full px-4 py-3 text-left text-sm font-bold hover:bg-gray-50">Показать все варианты</button>
                <button type="button" onClick={() => { alert(historyPrices.length ? `История цен: ${historyPrices.join(', ')} AED` : 'История пока пустая'); setShowMenu(false); }} className="w-full px-4 py-3 text-left text-sm font-bold hover:bg-gray-50">История цен</button>
                <button type="button" onClick={() => { duplicateTopVariant(); setShowMenu(false); }} className="w-full px-4 py-3 text-left text-sm font-bold hover:bg-gray-50">Дублировать вариант</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {!isAdding ? (
          <div className="space-y-3">
            <button type="button" onClick={() => { setIsAdding(true); setEditingVariantId(null); }} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg uppercase text-xs"><Plus size={20} /> Добавить вариант</button>
            {latestOrderVariant && (
              <button type="button" onClick={() => setForm((prev) => ({ ...prev, shopName: latestOrderVariant.shopName || '', phone: latestOrderVariant.phone || prev.phone, locationText: latestOrderVariant.locationText || latestOrderVariant.location || '' }))} className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-xs font-black">Последний магазин: {latestOrderVariant.shopName}</button>
            )}
          </div>
        ) : (
          <form onSubmit={async (e) => { e.preventDefault(); await saveVariant(); }} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-blue-700">{isEditing ? 'Редактировать вариант' : 'Новая цена'}</h3>
                <button type="button" onClick={closeEditor} className="p-2 text-gray-400 active:text-gray-600"><X size={20} /></button>
              </div>

              <div>
                <label className="text-xs font-black text-gray-700">Фото</label>
                <div className="flex gap-2 overflow-x-auto mt-2 pb-1">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 flex flex-col justify-center items-center shrink-0"><Camera size={20} className="text-gray-400" /><span className="text-[10px] font-black text-gray-500">+ Фото</span></button>
                  {form.photos.map((photo, index) => (
                    <div key={`${photo}-${index}`} className="relative w-24 h-24 shrink-0 rounded-xl overflow-hidden border border-gray-200">
                      <img src={photo} className="w-full h-full object-cover" />
                      <button type="button" onClick={() => removeVariantPhoto(index)} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"><X size={12} /></button>
                    </div>
                  ))}
                  <input type="file" ref={fileInputRef} onChange={handlePhotoChange} className="hidden" accept="image/*" multiple />
                </div>
              </div>

              <div>
                <label className="text-xs font-black text-gray-700">Цена (AED)</label>
                <div className="flex items-center gap-2">
                  <input type="text" autoFocus value={form.priceAed} onChange={(e) => handleFormPatch('priceAed', e.target.value.replace(/[^\d]/g, ''))} placeholder="1250" className="h-12 px-4 text-2xl font-black text-blue-700 w-full border border-gray-200 rounded-xl" />
                  <button type="button" onClick={() => pasteFromClipboard('priceAed')} className="h-12 w-12 rounded-xl border border-gray-200 flex items-center justify-center"><ClipboardPaste size={16} /></button>
                </div>
                <div className="flex gap-2 mt-2">
                  {[50, 100, 200].map((delta) => (
                    <button key={delta} type="button" onClick={() => handleFormPatch('priceAed', String((Number(form.priceAed || 0) + delta)))} className="px-3 h-8 rounded-lg bg-gray-100 text-xs font-black">+{delta}</button>
                  ))}
                </div>
                {approxClientPrice && <p className="text-xs text-gray-600 mt-1">≈ {approxClientPrice}</p>}
                {isPriceOutlier && <p className="text-xs text-amber-700 mt-1">Проверь цену ⚠️ относительно истории.</p>}
              </div>

              <div>
                <label className="text-xs font-black text-gray-700">Состояние</label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {(Object.keys(conditionLabels) as OfferCondition[]).map((condition) => (
                    <button key={condition} type="button" onClick={() => handleFormPatch('condition', condition)} className={`h-10 rounded-xl text-xs font-black border ${form.condition === condition ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-700'}`}>{conditionLabels[condition]}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-black text-gray-700">Наличие</label>
                  <div className="mt-1 space-y-1">
                    {(Object.keys(availabilityLabels) as OfferAvailability[]).map((value) => (
                      <button key={value} type="button" onClick={() => handleFormPatch('availability', value)} className={`w-full h-9 rounded-lg border text-xs font-bold ${form.availability === value ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-gray-200'}`}>{availabilityLabels[value]}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-black text-gray-700">Срок до склада</label>
                  <div className="mt-1 space-y-1">
                    {(Object.keys(etaLabels) as OfferFormState['deliveryEta'][]).map((value) => (
                      <button key={value} type="button" onClick={() => handleFormPatch('deliveryEta', value)} className={`w-full h-9 rounded-lg border text-xs font-bold ${form.deliveryEta === value ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-gray-200'}`}>{etaLabels[value]}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="relative">
                <label className="text-xs font-black text-gray-700">Магазин</label>
                <div className="flex items-center gap-2 h-12 px-3 mt-1 border border-gray-200 rounded-xl">
                  <Store size={16} className="text-gray-500" />
                  <input value={form.shopName} onChange={(e) => { handleFormPatch('shopName', e.target.value); setShowSuggestions(true); }} className="flex-1 bg-transparent outline-none text-sm font-bold" placeholder="Поиск или новый магазин" />
                </div>
                {showSuggestions && form.shopName && filteredSuppliers.length > 0 && (
                  <div className="absolute top-16 left-0 right-0 z-20 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                    {filteredSuppliers.map((supplier) => (
                      <button key={supplier.id} type="button" onClick={() => handleShopSelect(supplier)} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50">
                        <p className="font-bold">{supplier.name}</p>
                        <p className="text-xs text-gray-500">{supplier.phone || 'без телефона'} · {supplier.location || 'без локации'}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-black text-gray-700">Телефон</label>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex items-center gap-2 h-12 px-3 border border-gray-200 rounded-xl flex-1">
                    <Phone size={16} className="text-gray-500" />
                    <input value={form.phone} onChange={(e) => handleFormPatch('phone', formatPhone(e.target.value))} className="flex-1 bg-transparent outline-none text-sm font-bold" />
                  </div>
                  <button type="button" onClick={() => pasteFromClipboard('phone')} className="h-12 w-12 rounded-xl border border-gray-200 flex items-center justify-center"><ClipboardPaste size={16} /></button>
                  <button type="button" onClick={() => navigator.clipboard.writeText(form.phone)} className="h-12 w-12 rounded-xl border border-gray-200 flex items-center justify-center"><Copy size={16} /></button>
                  <button type="button" onClick={() => openWhatsapp({ ...DEFAULT_FORM, ...form, id: 'tmp', priceAed: numericPrice, location: form.locationText, createdAt: Date.now() } as PriceVariant)} className="h-12 w-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center"><MessageCircle size={16} /></button>
                </div>
              </div>

              <div>
                <label className="text-xs font-black text-gray-700">Локация</label>
                <div className="grid grid-cols-[1fr_auto] gap-2 mt-1">
                  <div className="h-12 px-3 border border-gray-200 rounded-xl flex items-center gap-2">
                    <MapPin size={16} className="text-gray-500" />
                    <input value={form.locationText} onChange={(e) => { handleFormPatch('locationText', e.target.value); setLocationParseNotice(null); }} className="flex-1 bg-transparent outline-none text-sm font-bold" placeholder="Ряд / зона / адрес" />
                  </div>
                  <button type="button" onClick={getCurrentLocation} disabled={isLocating} className="h-12 w-12 rounded-xl bg-blue-600 text-white flex items-center justify-center disabled:opacity-60"><Navigation size={16} className={isLocating ? 'animate-pulse' : ''} /></button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input value={form.mapsUrl} onChange={(e) => handleFormPatch('mapsUrl', e.target.value)} className="h-11 px-3 border border-gray-200 rounded-xl flex-1 text-sm font-bold" placeholder="Google Maps URL" />
                  <button type="button" onClick={() => pasteFromClipboard('mapsUrl')} className="h-11 w-11 rounded-xl border border-gray-200 flex items-center justify-center"><ClipboardPaste size={15} /></button>
                </div>
                {locationParseNotice && <p className="text-xs text-amber-700 mt-1">{locationParseNotice}</p>}
              </div>

              <button type="button" onClick={() => handleFormPatch('isBest', !form.isBest)} className={`w-full h-11 rounded-xl border font-black text-sm flex items-center justify-center gap-2 ${form.isBest ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600'}`}><Star size={16} /> Лучший вариант</button>

              {isEditing && (
                <p className="text-xs text-gray-500">Создан: {new Date(part.variants.find((v) => v.id === editingVariantId)?.createdAt || Date.now()).toLocaleString()}</p>
              )}
            </div>

            <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-gray-100 p-3">
              <button type="submit" disabled={!canSave || isResolvingLocation} className="w-full h-12 rounded-xl bg-blue-600 text-white font-black text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2">{isResolvingLocation ? <><Loader2 size={14} className="animate-spin" /> Сохранение...</> : isEditing ? 'Сохранить изменения' : 'Сохранить вариант'}</button>
              {!canSave && <p className="text-xs text-gray-500 mt-1">Введите цену и магазин.</p>}
              {!navigator.onLine && <p className="text-xs text-amber-700 mt-1">⏳ Нет интернета: вариант будет синхронизирован позже.</p>}
            </div>
          </form>
        )}

        <div className="space-y-3 pt-2" ref={variantsListRef}>
          <h2 className="font-black text-gray-500 uppercase text-[11px] tracking-[0.18em]">Варианты ({part.variants.length})</h2>
          {part.variants.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
              <p className="text-sm font-black text-gray-700">Пока нет вариантов.</p>
            </div>
          ) : part.variants.map((variant) => {
            const displayPhotos = getVariantPhotos(variant);
            const isBest = part.bestOfferId === variant.id || !!variant.isBest;
            return (
              <div key={variant.id} className={`bg-white rounded-2xl border overflow-hidden ${isBest ? 'border-emerald-300' : 'border-gray-100'}`}>
                <div className="p-4 flex gap-3">
                  <button type="button" onClick={(e) => openGallery(e, variant)} className="w-20 h-20 rounded-xl border border-gray-100 overflow-hidden shrink-0 bg-gray-50 flex items-center justify-center">
                    {displayPhotos[0] ? <img src={displayPhotos[0]} className="w-full h-full object-cover" /> : <Images size={18} className="text-gray-300" />}
                  </button>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <p className="text-2xl font-black text-blue-700 leading-none">{variant.priceAed} AED</p>
                        <p className="text-xs text-gray-500 font-bold">{variant.shopName}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => {
                          const updatedParts = order.parts.map((p) => p.id === part.id ? { ...p, bestOfferId: p.bestOfferId === variant.id ? undefined : variant.id, variants: p.variants.map((v) => ({ ...v, isBest: v.id === variant.id && p.bestOfferId !== variant.id })) } : p);
                          updateOrder({ ...order, parts: updatedParts });
                        }} className={`p-2 rounded-lg ${isBest ? 'text-emerald-600 bg-emerald-50' : 'text-gray-300'}`}><Star size={16} fill={isBest ? 'currentColor' : 'none'} /></button>
                        <button type="button" onClick={() => { setIsAdding(true); setEditingVariantId(variant.id); }} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"><ChevronDown size={16} /></button>
                        <button type="button" onClick={() => setDeleteVariantId(variant.id)} className="p-2 rounded-lg text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 text-[11px] font-bold">
                      <span className="px-2 py-1 rounded-lg bg-gray-100">{conditionLabels[variant.condition || 'used']}</span>
                      <span className="px-2 py-1 rounded-lg bg-gray-100">{availabilityLabels[variant.availability || 'in_stock']}</span>
                      {isBest && <span className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700">Лучший</span>}
                    </div>
                    <p className="text-xs text-gray-600 truncate">{variant.locationText || variant.location || 'Локация не указана'}</p>
                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => openWhatsapp(variant)} className="h-8 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-black">WhatsApp</button>
                      <button type="button" onClick={() => openRoute(variant)} className="h-8 px-3 rounded-lg bg-blue-50 text-blue-700 text-xs font-black">Маршрут</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showAfterSaveSheet && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-end" onClick={() => setShowAfterSaveSheet(false)}>
          <div className="w-full bg-white rounded-t-3xl p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-black text-gray-900">✅ Вариант добавлен</p>
            <button type="button" onClick={() => {
              const newest = part.variants[0];
              if (!newest) return;
              const updatedParts = order.parts.map((p) => p.id === part.id ? { ...p, bestOfferId: newest.id } : p);
              updateOrder({ ...order, parts: updatedParts });
              setShowAfterSaveSheet(false);
            }} className="w-full h-11 rounded-xl border border-gray-200 text-sm font-bold">Сделать лучшим</button>
            <button type="button" onClick={() => { if (part.variants[0]) openWhatsapp(part.variants[0]); }} className="w-full h-11 rounded-xl border border-gray-200 text-sm font-bold">Открыть WhatsApp магазина</button>
            <button type="button" onClick={() => { setIsAdding(true); setShowAfterSaveSheet(false); }} className="w-full h-11 rounded-xl border border-gray-200 text-sm font-bold">Добавить ещё вариант</button>
            <button type="button" onClick={() => navigate(`/order/${order.id}`)} className="w-full h-11 rounded-xl bg-blue-600 text-white text-sm font-black">Вернуться к деталям</button>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteVariantId}
        message="Удалить этот вариант?"
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
