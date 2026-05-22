import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  Heart,
  Link2,
  MapPin,
  MessageCircle,
  Phone,
  Pin,
  Plus,
  Search,
  Send,
  Sparkles,
  StickyNote,
  X
} from 'lucide-react';
import { useStore } from '../store';
import { createUuid } from '../id';
import { PriceVariant } from '../types';
import { VariantLibraryItem } from '../variantLibraryStore';
import { optimizeImageForUpload } from '../storage/photos';
import { useNavigate } from 'react-router-dom';

const priceTemplates = [150, 250, 450, 750, 1200, 1800];
const supplierNamePrefixes = ['Desert', 'Falcon', 'Turbo', 'Prime', 'Royal', 'Emirates', 'Golden', 'Rapid', 'Metro', 'Pearl'];
const supplierNameSuffixes = ['Auto', 'Motors', 'Parts', 'Garage', 'Trading', 'Workshop', 'Hub', 'Center', 'Solutions'];

type SortKey = 'updated' | 'created' | 'supplier' | 'price_asc' | 'price_desc' | 'pinned';
type FilterKey = 'all' | 'standalone' | 'order' | 'pinned' | 'favorite' | 'with_photo';
type SyncVisualStatus = 'synced' | 'pending' | 'offline' | 'error';

const filterOptions: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'standalone', label: 'Без заказа' },
  { key: 'order', label: 'Из заказов' },
  { key: 'pinned', label: 'Закреплённые' },
  { key: 'favorite', label: 'Избранное' },
  { key: 'with_photo', label: 'С фото' }
];


const formatPrice = (price: number) => `${new Intl.NumberFormat('ru-RU').format(Number(price || 0))} AED`;
const formatDate = (value?: number) => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value || Date.now()));
const COMPANY_LOGO_PATH = '/icon-192.png';
const normalizePhone = (value: string) => value.replace(/\s+/g, '');
const trimVin = (value: string) => (value.length > 13 ? `${value.slice(0, 13)}…` : value);
const resolveVariantMapUrl = (variant: VariantLibraryItem) => {
  if (variant.mapsUrl) return variant.mapsUrl;
  const source = variant.locationText || variant.location || variant.shopName || '';
  return source ? `https://maps.google.com/?q=${encodeURIComponent(source)}` : '';
};

const VariantsScreen: React.FC = () => {
  const navigate = useNavigate();
  const { variantLibrary, saveStandaloneVariant, removeStandaloneVariant, suppliers, updatePriceVariant, orders, updateOrder } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const randomSupplierCounterRef = useRef(1);
  const longPressTimerRef = useRef<number | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [purchasePriceAed, setPurchasePriceAed] = useState('');
  const [salePriceAed, setSalePriceAed] = useState('');
  const [shopName, setShopName] = useState('');
  const [partName, setPartName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [vehicleInfo, setVehicleInfo] = useState('');
  const [customerOrderRef, setCustomerOrderRef] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedVariant, setSelectedVariant] = useState<VariantLibraryItem | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<VariantLibraryItem | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const resetForm = () => {
    setPurchasePriceAed('');
    setSalePriceAed('');
    setShopName('');
    setPartName('');
    setPhone('');
    setLocation('');
    setMapsUrl('');
    setNote('');
    setPhotos([]);
    setSupplierId('');
    setVehicleInfo('');
    setCustomerOrderRef('');
  };

  const syncState = useMemo<SyncVisualStatus>(() => {
    if (!isOnline) return 'offline';
    if (variantLibrary.some((item) => item.syncStatus === 'error')) return 'error';
    if (variantLibrary.some((item) => item.syncStatus === 'pending')) return 'pending';
    return 'synced';
  }, [variantLibrary, isOnline]);

  const syncStateUi = {
    synced: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    offline: 'bg-slate-100 text-slate-700 border-slate-300',
    error: 'bg-rose-50 text-rose-700 border-rose-200'
  }[syncState];

  const syncLabel = {
    synced: 'Синхронизировано',
    pending: 'Сохраняется...',
    offline: 'Локально, отправим позже',
    error: 'Есть ошибки синхронизации'
  }[syncState];

  const miniPhotos = (variant: PriceVariant) => {
    const merged = [variant.photoUrl, ...(variant.photos || [])].filter((item): item is string => !!item);
    return Array.from(new Set(merged));
  };

  const loadCanvasImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (!src.startsWith('data:')) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image load failed'));
    image.src = src;
  });

  const generateVariantPreview = async (variant: VariantLibraryItem) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 700;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas недоступен');

    context.fillStyle = '#F3F6FB';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = '#FFFFFF';
    context.fillRect(20, 20, canvas.width - 40, canvas.height - 40);

    const imageX = 60;
    const imageY = 140;
    const imageW = 520;
    const imageH = 460;
    context.fillStyle = '#E9EEF6';
    context.fillRect(imageX, imageY, imageW, imageH);

    const firstPhoto = miniPhotos(variant)[0];
    if (firstPhoto) {
      try {
        const photo = await loadCanvasImage(firstPhoto);
        const ratio = Math.max(imageW / photo.width, imageH / photo.height);
        const drawW = photo.width * ratio;
        const drawH = photo.height * ratio;
        const drawX = imageX + (imageW - drawW) / 2;
        const drawY = imageY + (imageH - drawH) / 2;
        context.drawImage(photo, drawX, drawY, drawW, drawH);
      } catch {
        context.fillStyle = '#94A3B8';
        context.font = 'bold 34px Inter, Arial, sans-serif';
        context.fillText('Фото недоступно', imageX + 90, imageY + imageH / 2);
      }
    } else {
      context.fillStyle = '#94A3B8';
      context.font = 'bold 34px Inter, Arial, sans-serif';
      context.fillText('Нет фото детали', imageX + 110, imageY + imageH / 2);
    }

    try {
      const logo = await loadCanvasImage(COMPANY_LOGO_PATH);
      context.drawImage(logo, 60, 50, 96, 96);
    } catch {
      context.fillStyle = '#2563EB';
      context.fillRect(60, 50, 96, 96);
      context.fillStyle = '#FFFFFF';
      context.font = 'bold 16px Inter, Arial, sans-serif';
      context.fillText('LOGO', 84, 104);
    }

    const startX = 630;
    context.fillStyle = '#0F1728';
    context.font = '700 42px Inter, Arial, sans-serif';
    const partName = variant.sourcePartName || 'Деталь не указана';
    context.fillText(partName.slice(0, 34), startX, 190);

    context.fillStyle = '#2563EB';
    context.font = '700 58px Inter, Arial, sans-serif';
    context.fillText(formatPrice(Number((variant.salePriceAed ?? variant.priceAed) || 0)), startX, 280);

    context.fillStyle = '#334155';
    context.font = '500 30px Inter, Arial, sans-serif';
    const vehicleLine = variant.vehicleInfo || variant.sourceOrderLabel || 'Авто: не указано';
    context.fillText(`Авто: ${vehicleLine}`.slice(0, 46), startX, 360);
    const orderLine = variant.customerOrderRef ? `Заказ: ${variant.customerOrderRef}` : 'Заказ: —';
    context.fillText(orderLine.slice(0, 46), startX, 410);

    context.fillStyle = '#64748B';
    context.font = '500 24px Inter, Arial, sans-serif';
    context.fillText(`Поставщик: ${variant.shopName || '—'}`.slice(0, 54), startX, 470);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Не удалось сформировать изображение'));
          return;
        }
        resolve(blob);
      }, 'image/png', 0.95);
    });
  };

  const handleSendVariant = async (variant: VariantLibraryItem) => {
    try {
      const blob = await generateVariantPreview(variant);
      const file = new File([blob], `variant-${variant.id}.png`, { type: 'image/png' });
      const text = `${variant.sourcePartName || 'Деталь'} — ${formatPrice(Number((variant.salePriceAed ?? variant.priceAed) || 0))}`;
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: 'Предложение по детали',
          text,
          files: [file]
        });
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
      window.alert('Картинка сформирована и скачана. Можно отправить клиенту.');
    } catch (error) {
      console.error(error);
      window.alert('Не удалось сформировать картинку для отправки.');
    }
  };

  const filteredAndSorted = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const list = [...variantLibrary].filter((variant) => {
      if (activeFilter === 'standalone' && variant.origin !== 'standalone') return false;
      if (activeFilter === 'order' && variant.origin !== 'order') return false;
      if (activeFilter === 'pinned' && !variant.isPinned) return false;
      if (activeFilter === 'favorite' && !variant.isFavorite) return false;
      if (activeFilter === 'with_photo' && miniPhotos(variant).length === 0) return false;

      if (!query) return true;
      const haystack = [
        variant.shopName,
        variant.sourcePartName,
        variant.sourceOrderLabel,
        variant.phone,
        variant.note,
        variant.mapsUrl,
        variant.location,
        variant.locationText
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });

    return list.sort((a, b) => {
      if (sortKey === 'supplier') return (a.shopName || '').localeCompare(b.shopName || '', 'ru');
      if (sortKey === 'created') return Number(b.createdAt || 0) - Number(a.createdAt || 0);
      if (sortKey === 'price_asc') return Number((a.salePriceAed ?? a.priceAed) || 0) - Number((b.salePriceAed ?? b.priceAed) || 0);
      if (sortKey === 'price_desc') return Number((b.salePriceAed ?? b.priceAed) || 0) - Number((a.salePriceAed ?? a.priceAed) || 0);
      if (sortKey === 'pinned') return Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
      return Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0);
    });
  }, [variantLibrary, activeFilter, searchTerm, sortKey]);

  const handleSupplierChange = (value: string) => {
    setSupplierId(value);
    const supplier = suppliers.find((item) => item.id === value);
    if (!supplier) return;
    setShopName(supplier.name || '');
    setPhone(supplier.phone || '');
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

  const isCreateValid = shopName.trim() && partName.trim() && Number(purchasePriceAed) > 0 && Number(salePriceAed) > 0;

  const handleCreateVariant = () => {
    if (!isCreateValid) return;

    const created: VariantLibraryItem = {
      id: createUuid(),
      partId: undefined,
      origin: 'standalone',
      priceAed: Number(salePriceAed),
      purchasePriceAed: Number(purchasePriceAed),
      salePriceAed: Number(salePriceAed),
      currency: 'AED',
      shopName: shopName.trim(),
      shopNameManual: shopName.trim(),
      shopId: supplierId || undefined,
      phone: normalizePhone(phone.trim()),
      location: location.trim(),
      locationText: location.trim(),
      mapsUrl: mapsUrl.trim(),
      note: note.trim(),
      vehicleInfo: vehicleInfo.trim(),
      customerOrderRef: customerOrderRef.trim(),
      photos,
      photoUrl: photos[0],
      condition: 'used',
      availability: 'in_stock',
      deliveryEta: 'today',
      isFavorite: false,
      isPinned: false,
      sourcePartName: partName.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    setIsSaving(true);
    setTimeout(() => {
      saveStandaloneVariant(created);
      setIsSaving(false);
      setShowCreateModal(false);
      resetForm();
    }, 350);
  };

  const generateUniqueSupplierName = () => {
    const existingNames = new Set(variantLibrary.map((item) => (item.shopName || '').trim().toLowerCase()).filter(Boolean));

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const prefix = supplierNamePrefixes[Math.floor(Math.random() * supplierNamePrefixes.length)];
      const suffix = supplierNameSuffixes[Math.floor(Math.random() * supplierNameSuffixes.length)];
      const serial = randomSupplierCounterRef.current;
      randomSupplierCounterRef.current += 1;
      const candidate = `${prefix} ${suffix} ${serial}`;
      if (!existingNames.has(candidate.toLowerCase())) return candidate;
    }

    return `Supplier ${Date.now()}`;
  };

  const resolveCurrentLocation = async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      window.alert('GPS недоступен в этом браузере.');
      return null;
    }

    setIsResolvingLocation(true);
    const result = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
    setIsResolvingLocation(false);

    if (!result) {
      window.alert('Не удалось получить GPS-координаты. Проверьте разрешения геолокации.');
      return null;
    }
    return result;
  };

  const applyCurrentLocationToCreateForm = async () => {
    const current = await resolveCurrentLocation();
    if (!current) return;
    const coordsText = `${current.lat.toFixed(6)}, ${current.lng.toFixed(6)}`;
    setLocation(coordsText);
    setMapsUrl(`https://maps.google.com/?q=${current.lat},${current.lng}`);
  };

  const applyCurrentLocationToSelected = async () => {
    if (!selectedVariant) return;
    const current = await resolveCurrentLocation();
    if (!current) return;
    const coordsText = `${current.lat.toFixed(6)}, ${current.lng.toFixed(6)}`;
    setSelectedVariant((prev) => prev
      ? {
        ...prev,
        location: coordsText,
        locationText: coordsText,
        mapsUrl: `https://maps.google.com/?q=${current.lat},${current.lng}`
      }
      : prev);
  };

  const persistVariant = (variant: VariantLibraryItem) => {
    if (variant.origin === 'standalone') {
      saveStandaloneVariant({ ...variant, updatedAt: Date.now() });
      return;
    }
    if (!variant.sourcePartId) return;
    void updatePriceVariant(variant.sourcePartId, { ...variant, updatedAt: Date.now() });
  };

  const quickToggle = (key: 'isPinned' | 'isFavorite') => {
    if (!selectedVariant) return;
    const next = { ...selectedVariant, [key]: !selectedVariant[key] };
    setSelectedVariant(next);
    persistVariant(next);
  };

  const removeVariantCompletely = async (variant: VariantLibraryItem) => {
    if (variant.origin === 'standalone') {
      removeStandaloneVariant(variant.id);
      if (selectedVariant?.id === variant.id) setSelectedVariant(null);
      return;
    }
    if (!variant.sourceOrderId || !variant.sourcePartId) return;
    const sourceOrder = orders.find((order) => order.id === variant.sourceOrderId);
    if (!sourceOrder) return;
    const parts = sourceOrder.parts.map((part) => {
      if (part.id !== variant.sourcePartId) return part;
      return { ...part, variants: (part.variants || []).filter((item) => item.id !== variant.id) };
    });
    await updateOrder({ ...sourceOrder, parts });
    if (selectedVariant?.id === variant.id) setSelectedVariant(null);
  };

  const getDeleteWarning = (variant: VariantLibraryItem) => {
    if (variant.origin === 'standalone') {
      return 'Вариант будет удалён из списка «Варианты».';
    }
    return `Этот вариант добавлен в детали заказа ${variant.sourceOrderLabel || ''} (${variant.sourcePartName || 'Деталь'}). При удалении он исчезнет из деталей заказа и всех связанных цепочек.`;
  };

  const startLongPressDelete = (variant: VariantLibraryItem) => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      setDeleteCandidate(variant);
    }, 650);
  };

  const cancelLongPressDelete = () => {
    if (!longPressTimerRef.current) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  return (
    <div className="min-h-full bg-[#F7F8FA] px-4 pb-24 pt-3 text-[#0F1728]">
      <div className="space-y-4">
        <div className="rounded-[20px] border border-[#E7EAF0] bg-white p-4 shadow-[0_2px_12px_rgba(15,23,40,0.04)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-[32px] font-bold leading-[38px]">Варианты</h1>
              <p className="mt-1 max-w-[280px] text-sm text-[#667085]">Все сохранённые варианты из заказов и отдельно созданные позиции.</p>
            </div>
            <div className={`rounded-xl border px-3 py-1.5 text-[11px] font-semibold ${syncStateUi}`}>{syncLabel}</div>
          </div>
          <button type="button" onClick={() => setShowCreateModal(true)} className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#2563EB] text-sm font-bold text-white">
            <Plus size={18} />
            Новый вариант
          </button>
          <div className="mt-4 flex h-12 items-center rounded-2xl border border-[#E7EAF0] bg-[#F7F8FA] px-3">
            <Search size={16} className="text-[#667085]" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Поставщик, деталь, VIN, телефон"
              className="h-full flex-1 bg-transparent px-2 text-sm outline-none"
            />
            {searchTerm && <button type="button" onClick={() => setSearchTerm('')} className="rounded-full p-1 text-[#667085]"><X size={14} /></button>}
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {filterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setActiveFilter(option.key)}
                className={`h-9 whitespace-nowrap rounded-xl border px-3 text-xs font-semibold ${activeFilter === option.key ? 'border-[#2563EB] bg-[#EFF4FF] text-[#2563EB]' : 'border-[#E7EAF0] bg-white text-[#667085]'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-[#667085]">{filteredAndSorted.length} вариантов</p>
            <div className="relative">
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} className="h-9 appearance-none rounded-xl border border-[#E7EAF0] bg-white pl-3 pr-8 text-xs font-semibold text-[#0F1728] outline-none">
                <option value="updated">По дате обновления</option>
                <option value="created">По дате создания</option>
                <option value="price_asc">По цене ↑</option>
                <option value="price_desc">По цене ↓</option>
                <option value="supplier">По поставщику А–Я</option>
                <option value="pinned">Сначала закреплённые</option>
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2 top-2.5 text-[#667085]" />
            </div>
          </div>
        </div>

        {filteredAndSorted.length > 0 ? (
          <div className="space-y-3">
            {filteredAndSorted.map((variant) => {
              const photosForCard = miniPhotos(variant);
              const orderHint = variant.sourceOrderLabel || '';
              const vinCandidate = orderHint.split('•').at(-1)?.trim() || '';
              const phoneValue = variant.phone && variant.phone !== '+971' ? variant.phone : '';
              return (
                <button
                  key={`${variant.origin}-${variant.id}-${variant.sourceOrderId || 'none'}`}
                  type="button"
                  onClick={() => {
                    setSelectedVariant(variant);
                    setIsEditMode(false);
                  }}
                  onPointerDown={() => startLongPressDelete(variant)}
                  onPointerUp={cancelLongPressDelete}
                  onPointerLeave={cancelLongPressDelete}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setDeleteCandidate(variant);
                  }}
                  className="w-full rounded-[20px] border border-[#E7EAF0] bg-white p-4 text-left shadow-[0_2px_10px_rgba(15,23,40,0.04)]"
                >
                  <div className="flex items-start gap-3">
                    {photosForCard[0] ? (
                      <img src={photosForCard[0]} alt={variant.sourcePartName || 'Фото варианта'} className="h-20 w-20 shrink-0 rounded-2xl border border-[#E7EAF0] object-cover" loading="lazy" />
                    ) : (
                      <div className="h-20 w-20 shrink-0 rounded-2xl border border-dashed border-[#D0D5DD] bg-[#F8FAFC] grid place-items-center text-[#98A2B3]">
                        <Camera size={16} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-base font-bold leading-6 text-[#0F1728]">{variant.shopName || 'Без поставщика'}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-[#667085]">{variant.sourcePartName || 'Деталь не указана'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[21px] font-bold leading-6 text-[#0F1728]">{formatPrice(Number((variant.salePriceAed ?? variant.priceAed) || 0))}</p>
                      <p className="mt-1 text-xs text-[#667085]">{formatDate(variant.updatedAt || variant.createdAt)}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-xl bg-[#F2F4F7] px-2 py-1 text-[11px] font-semibold text-[#475467]">{variant.origin === 'order' ? 'Из заказа' : 'Без заказа'}</span>
                    {variant.isPinned && <span className="rounded-xl bg-[#FEF3C7] px-2 py-1 text-[11px] font-semibold text-[#92400E]">Закреплён</span>}
                    {variant.isFavorite && <span className="rounded-xl bg-[#FCE7F3] px-2 py-1 text-[11px] font-semibold text-[#9D174D]">Избранное</span>}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-[#667085]">
                    <p className="truncate">{orderHint ? `${orderHint.split('•')[0]?.trim()} · VIN ${trimVin(vinCandidate)}` : 'Без привязки к заказу'}</p>
                    <div className="flex items-center gap-2 text-[#475467]">
                      {phoneValue && <Phone size={14} />}
                      {photosForCard.length > 0 && <span className="inline-flex items-center gap-1"><Camera size={14} /> {photosForCard.length}</span>}
                      {(variant.location || variant.locationText || variant.mapsUrl) && <MapPin size={14} />}
                      {variant.note && <StickyNote size={14} />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[20px] border border-dashed border-[#D0D5DD] bg-white p-8 text-center">
            <Sparkles className="mx-auto text-[#98A2B3]" size={24} />
            <p className="mt-3 text-sm font-semibold text-[#0F1728]">Пока нет вариантов</p>
            <p className="mt-1 text-xs text-[#667085]">Создайте первый вариант вручную или добавьте его из заказа.</p>
            <button type="button" onClick={() => setShowCreateModal(true)} className="mt-4 h-11 rounded-2xl bg-[#2563EB] px-4 text-sm font-bold text-white">Новый вариант</button>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40">
          <div className="max-h-[92dvh] w-full overflow-y-auto overscroll-contain touch-pan-y rounded-t-[24px] bg-white px-4 pb-[max(6.5rem,calc(env(safe-area-inset-bottom)+4.5rem))] pt-3">
            <div className="mx-auto h-1.5 w-10 rounded-full bg-gray-300" />
            <div className="mt-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Новый вариант</h2>
              <button type="button" onClick={() => setShowCreateModal(false)} className="rounded-full p-2 text-[#667085]"><X size={18} /></button>
            </div>

            <div className="mt-4 space-y-4">
              <section className="space-y-2 rounded-2xl border border-[#E7EAF0] p-3">
                <p className="text-xs font-semibold text-[#667085]">Источник поставщика</p>
                <select value={supplierId} onChange={(event) => handleSupplierChange(event.target.value)} className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none">
                  <option value="">Ввести вручную</option>
                  {suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </section>

              <section className="space-y-2 rounded-2xl border border-[#E7EAF0] p-3">
                <p className="text-xs font-semibold text-[#667085]">Основные данные</p>
                <input value={shopName} onChange={(event) => setShopName(event.target.value)} placeholder="Поставщик" className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none" />
                <input value={partName} onChange={(event) => setPartName(event.target.value)} placeholder="Деталь / название варианта" className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={purchasePriceAed} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" onChange={(event) => setPurchasePriceAed(event.target.value.replace(/[^\d]/g, ''))} placeholder="Цена покупки" className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={salePriceAed} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" onChange={(event) => setSalePriceAed(event.target.value.replace(/[^\d]/g, ''))} placeholder="Цена продажи" className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none" />
                  <div className="flex h-[52px] items-center rounded-2xl border border-[#E7EAF0] px-3 text-sm text-[#667085]">AED</div>
                </div>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Комментарий" className="min-h-[120px] w-full rounded-2xl border border-[#E7EAF0] px-3 py-2 text-sm outline-none" />
                <input value={vehicleInfo} onChange={(event) => setVehicleInfo(event.target.value)} className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none" placeholder="Данные автомобиля (марка/модель/VIN)" />
                <input value={customerOrderRef} onChange={(event) => setCustomerOrderRef(event.target.value)} className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none" placeholder="Номер/ссылка заказа (необязательно)" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setShopName(generateUniqueSupplierName())} className="rounded-xl bg-[#F2F4F7] px-3 py-1.5 text-xs font-semibold text-[#475467]">Случайное имя</button>
                  <button type="button" onClick={() => { const next = String(priceTemplates[Math.floor(Math.random() * priceTemplates.length)]); setPurchasePriceAed(next); setSalePriceAed(next); }} className="rounded-xl bg-[#F2F4F7] px-3 py-1.5 text-xs font-semibold text-[#475467]">Быстрая цена</button>
                </div>
              </section>

              <section className="space-y-2 rounded-2xl border border-[#E7EAF0] p-3">
                <p className="text-xs font-semibold text-[#667085]">Контакты и локация</p>
                <input value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^\d+]/g, ''))} inputMode="numeric" type="tel" placeholder="Телефон" className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none" />
                <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Адрес / район" className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none" />
                <input value={mapsUrl} onChange={(event) => setMapsUrl(event.target.value)} placeholder="Google Maps URL" className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none" />
                <button type="button" onClick={() => void applyCurrentLocationToCreateForm()} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] px-3 text-sm font-semibold text-[#475467] disabled:opacity-50" disabled={isResolvingLocation}>{isResolvingLocation ? 'Определяем GPS...' : '📍 Текущее местоположение'}</button>
              </section>

              <section className="space-y-2 rounded-2xl border border-[#E7EAF0] p-3">
                <p className="text-xs font-semibold text-[#667085]">Фото</p>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] px-3 text-sm font-semibold text-[#475467]">
                  <Camera size={16} /> Добавить фото
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onPhotosChange} />
                {photos.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    {photos.map((photo) => (
                      <img key={photo} src={photo} className="h-16 w-16 rounded-xl border border-[#E7EAF0] object-cover" />
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setShowCreateModal(false)} className="h-12 rounded-2xl border border-[#D0D5DD] text-sm font-semibold text-[#475467]">Отмена</button>
              <button type="button" disabled={!isCreateValid || isSaving} onClick={handleCreateVariant} className="h-12 rounded-2xl bg-[#2563EB] text-sm font-bold text-white disabled:bg-[#98A2B3]">{isSaving ? 'Сохраняем...' : 'Сохранить вариант'}</button>
            </div>
          </div>
        </div>
      )}

      {selectedVariant && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/55">
          <div className="max-h-[92dvh] w-full overflow-y-auto overscroll-contain touch-pan-y rounded-t-[24px] bg-white px-4 pb-[max(6.5rem,calc(env(safe-area-inset-bottom)+4.5rem))] pt-3">
            <div className="mx-auto h-1.5 w-10 rounded-full bg-gray-300" />
            <div className="mt-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-bold">{selectedVariant.shopName || 'Вариант'}</p>
                <p className="text-xs text-[#667085]">{selectedVariant.sourcePartName || 'Деталь не указана'}</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setIsEditMode((prev) => !prev)} className="rounded-xl border border-[#E7EAF0] px-3 py-1.5 text-xs font-semibold">{isEditMode ? 'Просмотр' : 'Редактировать'}</button>
                <button type="button" onClick={() => setSelectedVariant(null)} className="rounded-full p-2 text-[#667085]"><X size={18} /></button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" disabled={!selectedVariant.phone} className="h-11 rounded-xl border border-[#E7EAF0] text-xs font-semibold active:scale-[0.98] disabled:opacity-40" onClick={() => window.open(`tel:${selectedVariant.phone}`, '_self')}><span className="inline-flex items-center gap-1"><Phone size={14} />Позвонить</span></button>
              <button type="button" disabled={!selectedVariant.phone} className="h-11 rounded-xl border border-[#E7EAF0] text-xs font-semibold active:scale-[0.98] disabled:opacity-40" onClick={() => window.open(`https://wa.me/${selectedVariant.phone.replace(/\D/g, '')}`, '_blank')}><span className="inline-flex items-center gap-1"><MessageCircle size={14} />WhatsApp</span></button>
              <button type="button" disabled={!resolveVariantMapUrl(selectedVariant)} className="h-11 rounded-xl border border-[#E7EAF0] text-xs font-semibold active:scale-[0.98] disabled:opacity-40" onClick={() => { const url = resolveVariantMapUrl(selectedVariant); if (url) window.open(url, '_blank', 'noopener,noreferrer'); }}><span className="inline-flex items-center gap-1"><MapPin size={14} />Маршрут</span></button>
              <button type="button" disabled={!selectedVariant.sourceOrderId} className="h-11 rounded-xl border border-[#E7EAF0] text-xs font-semibold active:scale-[0.98] disabled:opacity-40" onClick={() => selectedVariant.sourceOrderId && navigate(`/order/${selectedVariant.sourceOrderId}`)}><span className="inline-flex items-center gap-1"><Link2 size={14} />Открыть заказ</span></button>
            </div>

            {isEditMode ? (
              <div className="mt-4 space-y-2">
                <input value={selectedVariant.shopName || ''} onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, shopName: event.target.value } : prev)} className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm" placeholder="Поставщик" />
                <input value={String((selectedVariant.purchasePriceAed ?? selectedVariant.priceAed) || '')} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" onChange={(event) => {
                  const value = Number(event.target.value.replace(/[^\d]/g, '') || 0);
                  setSelectedVariant((prev) => prev ? { ...prev, purchasePriceAed: value } : prev);
                }} className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm" placeholder="Цена покупки" />
                <input value={String((selectedVariant.salePriceAed ?? selectedVariant.priceAed) || '')} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" onChange={(event) => {
                  const value = Number(event.target.value.replace(/[^\d]/g, '') || 0);
                  setSelectedVariant((prev) => prev ? { ...prev, priceAed: value, salePriceAed: value } : prev);
                }} className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm" placeholder="Цена продажи" />
                <input value={selectedVariant.phone || ''} onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, phone: event.target.value.replace(/[^\d+]/g, '') } : prev)} inputMode="numeric" type="tel" className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm" placeholder="Телефон" />
                <input value={selectedVariant.locationText || selectedVariant.location || ''} onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, locationText: event.target.value, location: event.target.value } : prev)} className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm" placeholder="Локация" />
                <button type="button" onClick={() => void applyCurrentLocationToSelected()} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] px-3 text-sm font-semibold text-[#475467] disabled:opacity-50" disabled={isResolvingLocation}>{isResolvingLocation ? 'Определяем GPS...' : '📍 Текущее местоположение'}</button>
                <input value={selectedVariant.vehicleInfo || ''} onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, vehicleInfo: event.target.value } : prev)} className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm" placeholder="Данные автомобиля" />
                <input value={selectedVariant.customerOrderRef || ''} onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, customerOrderRef: event.target.value } : prev)} className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm" placeholder="Номер/ссылка заказа" />
                <textarea value={selectedVariant.note || ''} onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, note: event.target.value } : prev)} className="min-h-[120px] w-full rounded-2xl border border-[#E7EAF0] px-3 py-2 text-sm" placeholder="Комментарий" />
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-[#E7EAF0] p-3">
                  <p className="text-xs text-[#667085]">Главная информация</p>
                  <p className="mt-1 text-sm font-semibold">{selectedVariant.sourcePartName || 'Деталь не указана'}</p>
                  <p className="mt-1 text-[22px] font-bold">{formatPrice(Number((selectedVariant.salePriceAed ?? selectedVariant.priceAed) || 0))}</p>
                  <p className="mt-1 text-xs text-[#667085]">Покупка: {formatPrice(Number((selectedVariant.purchasePriceAed ?? selectedVariant.priceAed) || 0))} · Маржа: {formatPrice(Number(((selectedVariant.salePriceAed ?? selectedVariant.priceAed) || 0) - ((selectedVariant.purchasePriceAed ?? selectedVariant.priceAed) || 0)))}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-xl bg-[#F2F4F7] px-2 py-1 text-[11px] font-semibold">{selectedVariant.origin === 'order' ? 'Из заказа' : 'Без заказа'}</span>
                    {selectedVariant.isPinned && <span className="rounded-xl bg-[#FEF3C7] px-2 py-1 text-[11px] font-semibold">Закреплён</span>}
                    {selectedVariant.isFavorite && <span className="rounded-xl bg-[#FCE7F3] px-2 py-1 text-[11px] font-semibold">Избранное</span>}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#E7EAF0] p-3 text-sm">
                  <p><span className="text-[#667085]">Телефон:</span> {selectedVariant.phone || 'Не указан'}</p>
                  <p className="mt-1"><span className="text-[#667085]">Локация:</span> {selectedVariant.locationText || selectedVariant.location || 'Не указана'}</p>
                  <p className="mt-1"><span className="text-[#667085]">Комментарий:</span> {selectedVariant.note || 'Комментарий не добавлен'}</p>
                  <p className="mt-1"><span className="text-[#667085]">Авто:</span> {selectedVariant.vehicleInfo || selectedVariant.sourceOrderLabel || 'Не указано'}</p>
                  <p className="mt-1"><span className="text-[#667085]">Заказ:</span> {selectedVariant.customerOrderRef || 'Не указан'}</p>
                </div>
                {miniPhotos(selectedVariant).length > 0 && (
                  <div className="rounded-2xl border border-[#E7EAF0] p-3">
                    <p className="text-xs text-[#667085]">Фото</p>
                    <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
                      {miniPhotos(selectedVariant).map((photo) => (
                        <img key={photo} src={photo} className="h-20 w-20 rounded-xl border border-[#E7EAF0] object-cover" />
                      ))}
                    </div>
                  </div>
                )}
                <div className="rounded-2xl border border-[#E7EAF0] p-3 text-xs text-[#667085]">
                  <p>Создано: {formatDate(selectedVariant.createdAt)}</p>
                  <p className="mt-1">Обновлено: {formatDate(selectedVariant.updatedAt || selectedVariant.createdAt)}</p>
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => quickToggle('isFavorite')} className={`h-11 rounded-xl border text-xs font-bold active:scale-[0.98] ${selectedVariant.isFavorite ? 'border-pink-300 bg-pink-50 text-pink-700' : 'border-[#E7EAF0] text-[#475467]'}`}><span className="inline-flex items-center gap-1"><Heart size={14} />Избранное</span></button>
              <button type="button" onClick={() => quickToggle('isPinned')} className={`h-11 rounded-xl border text-xs font-bold active:scale-[0.98] ${selectedVariant.isPinned ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-[#E7EAF0] text-[#475467]'}`}><span className="inline-flex items-center gap-1"><Pin size={14} />Закрепить</span></button>
              <button type="button" onClick={() => void handleSendVariant(selectedVariant)} className="col-span-2 h-11 rounded-xl bg-[#2563EB] text-xs font-bold text-white"><span className="inline-flex items-center gap-1"><Send size={14} />Отправить</span></button>
            </div>

            {isEditMode && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { persistVariant(selectedVariant); setIsEditMode(false); }} className="h-11 rounded-xl bg-emerald-600 text-xs font-bold text-white"><span className="inline-flex items-center gap-1"><Check size={14} />Сохранить</span></button>
                {selectedVariant.origin === 'standalone' ? (
                  <button type="button" onClick={() => { removeStandaloneVariant(selectedVariant.id); setSelectedVariant(null); }} className="h-11 rounded-xl border border-rose-200 text-xs font-bold text-rose-600">Удалить</button>
                ) : <div />}
              </div>
            )}
          </div>
        </div>
      )}

      {deleteCandidate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <h3 className="text-base font-bold text-[#0F1728]">Удалить вариант?</h3>
            <p className="mt-2 text-sm text-[#475467]">{getDeleteWarning(deleteCandidate)}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setDeleteCandidate(null)} className="h-11 rounded-xl border border-[#D0D5DD] text-sm font-semibold text-[#475467]">Отмена</button>
              <button type="button" onClick={() => { void removeVariantCompletely(deleteCandidate); setDeleteCandidate(null); }} className="h-11 rounded-xl bg-rose-600 text-sm font-bold text-white">Удалить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VariantsScreen;
