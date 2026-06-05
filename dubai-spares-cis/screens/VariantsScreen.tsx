import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  Copy,
  Heart,
  Link2,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Pin,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Star,
  StickyNote,
  X
} from 'lucide-react';
import { useStore } from '../store';
import { createUuid } from '../id';
import { PriceVariant } from '../types';
import { cloneVariantForPart, VariantLibraryItem } from '../variantLibraryStore';
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
  const [menuVariant, setMenuVariant] = useState<VariantLibraryItem | null>(null);
  const [orderPickerVariant, setOrderPickerVariant] = useState<VariantLibraryItem | null>(null);
  const [isAddingToOrder, setIsAddingToOrder] = useState(false);

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

  const primaryFilterOptions = filterOptions.filter((option) => ['all', 'standalone', 'order', 'pinned', 'favorite'].includes(option.key));
  const activeOrdersForPicker = useMemo(
    () => orders
      .filter((order) => !order.isArchived && !order.isSold)
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
      .slice(0, 12),
    [orders]
  );

  const showToast = (message: string, tone: 'error' | 'success' | 'info' = 'info') => {
    window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, tone } }));
  };

  const openVariantDetail = (variant: VariantLibraryItem) => {
    setSelectedVariant(variant);
    setIsEditMode(false);
  };

  const toggleVariantFlag = (variant: VariantLibraryItem, key: 'isPinned' | 'isFavorite') => {
    persistVariant({ ...variant, [key]: !variant[key] });
  };

  const getVariantTitle = (variant: VariantLibraryItem) => variant.sourcePartName || variant.vehicleInfo || variant.note || 'Деталь не указана';
  const getVariantLocation = (variant: VariantLibraryItem) => {
    const raw = (variant.locationText || variant.location || '').trim();
    if (!raw) return 'Dubai, UAE';
    if (/^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?$/.test(raw.replace(/[()]/g, ''))) return 'Sharjah, UAE';
    if (/sharjah/i.test(raw)) return 'Sharjah, UAE';
    if (/dubai/i.test(raw)) return 'Dubai, UAE';
    if (/abu\s*dhabi/i.test(raw)) return 'Abu Dhabi, UAE';
    return raw;
  };
  const getVariantSupplier = (variant: VariantLibraryItem) => variant.shopName || 'Без поставщика';
  const getVariantPhone = (variant: VariantLibraryItem) => (variant.phone && variant.phone !== '+971' ? variant.phone : '');

  const getStatusMeta = (variant: VariantLibraryItem) => {
    if (variant.isPinned) return { label: 'Закреплённый', className: 'bg-emerald-50 text-emerald-700' };
    if (variant.origin === 'order') return { label: 'Из заказа', className: 'bg-blue-50 text-blue-700' };
    return { label: 'Без заказа', className: 'bg-slate-100 text-slate-600' };
  };

  const copyVariantData = async (variant: VariantLibraryItem) => {
    const text = [
      getVariantTitle(variant),
      getVariantSupplier(variant),
      getVariantLocation(variant),
      formatPrice(Number((variant.salePriceAed ?? variant.priceAed) || 0)),
      getVariantPhone(variant)
    ].filter(Boolean).join('\n');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast('Данные варианта скопированы', 'success');
      } else {
        window.prompt('Скопируйте данные варианта', text);
      }
    } catch {
      window.prompt('Скопируйте данные варианта', text);
    }
  };

  const attachVariantToOrder = async (orderId: string) => {
    if (!orderPickerVariant) return;
    const targetOrder = orders.find((order) => order.id === orderId);
    if (!targetOrder) return;

    setIsAddingToOrder(true);
    const partId = createUuid();
    const variantClone = { ...cloneVariantForPart(orderPickerVariant, partId), orderId: targetOrder.id };
    const variantPhotos = miniPhotos(orderPickerVariant);
    const nextPart = {
      id: partId,
      orderId: targetOrder.id,
      name: getVariantTitle(orderPickerVariant),
      quantity: 1,
      comment: orderPickerVariant.note || '',
      photoUrl: variantPhotos[0] || '',
      photos: variantPhotos,
      variants: [variantClone],
      isFound: true,
      status: 'found' as const
    };

    const saved = await updateOrder({ ...targetOrder, parts: [nextPart, ...(targetOrder.parts || [])] });
    setIsAddingToOrder(false);
    if (!saved) {
      showToast('Не удалось добавить вариант в заказ', 'error');
      return;
    }
    setOrderPickerVariant(null);
    showToast('Вариант добавлен в заказ', 'success');
    navigate(`/order/${targetOrder.id}`);
  };

  return (
    <div className="min-h-full bg-[#F7F8FA] px-4 pb-36 pt-3 text-[#0F1728]">
      <div className="space-y-3">
        <section className="space-y-2.5">
          <div className="flex items-center gap-3">
            <label className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-[18px] border border-[#E6EAF0] bg-white/88 px-4 text-[#667085] shadow-[0_1px_6px_rgba(15,23,40,0.025)] transition focus-within:border-blue-200 focus-within:bg-white focus-within:text-blue-600">
              <Search size={21} className="shrink-0" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Поставщик, деталь, VIN, телефон"
                className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-[#0F1728] outline-none placeholder:text-[#7A8293]"
              />
              {searchTerm && (
                <button type="button" onClick={() => setSearchTerm('')} className="rounded-full p-1 text-[#98A2B3] transition active:scale-95" aria-label="Очистить поиск">
                  <X size={15} />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={() => setActiveFilter(activeFilter === 'with_photo' ? 'all' : 'with_photo')}
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border bg-white/90 shadow-[0_1px_6px_rgba(15,23,40,0.025)] transition active:scale-[0.97] ${activeFilter === 'with_photo' ? 'border-blue-300 text-blue-600' : 'border-[#E6EAF0] text-[#475467]'}`}
              aria-label="Фильтры"
            >
              <SlidersHorizontal size={22} />
            </button>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {primaryFilterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setActiveFilter(option.key)}
                className={`h-10 shrink-0 whitespace-nowrap rounded-[15px] border px-2.5 text-[12px] font-bold transition active:scale-[0.98] ${activeFilter === option.key ? 'border-blue-500 bg-white text-blue-600 shadow-[0_6px_16px_rgba(37,99,235,0.08)]' : 'border-[#E6EAF0] bg-white/86 text-[#3D4658]'}`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="shrink-0 text-[14px] font-bold text-[#3D4658]">{filteredAndSorted.length} вариантов</p>
            <div className="relative min-w-0">
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} className="h-11 w-[230px] appearance-none rounded-[17px] border border-[#E6EAF0] bg-white pl-4 pr-8 text-[13px] font-bold text-[#0F1728] outline-none shadow-[0_1px_6px_rgba(15,23,40,0.025)]">
                <option value="updated">По дате обновления</option>
                <option value="created">По дате создания</option>
                <option value="price_asc">По цене ↑</option>
                <option value="price_desc">По цене ↓</option>
                <option value="supplier">По поставщику А–Я</option>
                <option value="pinned">Сначала закреплённые</option>
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-3.5 text-[#0F1728]" />
            </div>
          </div>
        </section>

        {filteredAndSorted.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {filteredAndSorted.map((variant) => {
              const photosForCard = miniPhotos(variant);
              const firstPhoto = photosForCard[0];
              const phoneValue = getVariantPhone(variant);
              const statusMeta = getStatusMeta(variant);
              return (
                <article
                  key={`${variant.origin}-${variant.id}-${variant.sourceOrderId || 'none'}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openVariantDetail(variant)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openVariantDetail(variant);
                    }
                  }}
                  onPointerDown={() => startLongPressDelete(variant)}
                  onPointerUp={cancelLongPressDelete}
                  onPointerLeave={cancelLongPressDelete}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setDeleteCandidate(variant);
                  }}
                  className="flex h-[324px] min-w-0 cursor-pointer flex-col overflow-hidden rounded-[20px] border border-[#E9EDF3] bg-white text-left shadow-[0_10px_26px_rgba(15,23,40,0.06)] transition duration-200 active:scale-[0.985]"
                >
                  <div className="relative h-[112px] shrink-0 bg-[#F2F4F7]">
                    {firstPhoto ? (
                      <img src={firstPhoto} alt={getVariantTitle(variant)} className="h-full w-full object-contain p-2" loading="lazy" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-[#98A2B3]">
                        <Camera size={20} />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleVariantFlag(variant, 'isFavorite');
                      }}
                      className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-white/95 text-[#667085] shadow-[0_4px_12px_rgba(15,23,40,0.12)] transition active:scale-95"
                      aria-label="Избранное"
                    >
                      <Star size={14} fill={variant.isFavorite ? '#FBBF24' : 'none'} className={variant.isFavorite ? 'text-amber-400' : ''} />
                    </button>
                    {photosForCard.length > 0 && (
                      <span className="absolute bottom-2 right-2 rounded-full bg-white/82 px-1.5 py-0.5 text-[9px] font-bold text-[#3D4658] shadow-[0_4px_10px_rgba(15,23,40,0.08)]">
                        {photosForCard.length} фото
                      </span>
                    )}
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-3">
                    <h2 className="line-clamp-2 min-h-[36px] shrink-0 text-[14px] font-black leading-[18px] text-[#0B1220]">{getVariantTitle(variant)}</h2>
                    <p className="mt-1.5 shrink-0 truncate text-[12px] font-semibold leading-[15px] text-[#667085]">{getVariantSupplier(variant)}</p>
                    <p className="mt-0.5 shrink-0 truncate text-[12px] font-medium leading-[15px] text-[#7A8293]">{getVariantLocation(variant)}</p>
                    <p className="mt-2 shrink-0 truncate text-[19px] font-black leading-[22px] text-[#0B1220]">{formatPrice(Number((variant.salePriceAed ?? variant.priceAed) || 0))}</p>
                    <span className={`mt-1.5 w-fit max-w-full shrink-0 truncate rounded-[9px] px-2 py-0.5 text-[10.5px] font-black leading-[15px] ${statusMeta.className}`}>{statusMeta.label}</span>

                    <div className="mt-auto grid shrink-0 grid-cols-[32px_minmax(0,1fr)_32px] gap-1.5 pt-3">
                      <button
                        type="button"
                        disabled={!phoneValue}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (phoneValue) window.open(`https://wa.me/${phoneValue.replace(/\D/g, '')}`, '_blank');
                        }}
                        className="grid h-8 place-items-center rounded-[10px] border border-emerald-100 bg-emerald-50 text-emerald-600 transition active:scale-95 disabled:opacity-35"
                        aria-label="WhatsApp"
                      >
                        <MessageCircle size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOrderPickerVariant(variant);
                        }}
                        className="h-8 truncate rounded-[10px] bg-blue-50 px-1.5 text-[10.5px] font-black text-blue-700 transition active:scale-[0.97]"
                      >
                        + В заказ
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuVariant(variant);
                        }}
                        className="grid h-8 place-items-center rounded-[10px] border border-[#E6EAF0] bg-white text-[#475467] transition active:scale-95"
                        aria-label="Еще"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[22px] border border-dashed border-[#D0D5DD] bg-white p-8 text-center shadow-[0_8px_22px_rgba(15,23,40,0.04)]">
            <Sparkles className="mx-auto text-[#98A2B3]" size={24} />
            <p className="mt-3 text-sm font-semibold text-[#0F1728]">Пока нет вариантов</p>
            <p className="mt-1 text-xs text-[#667085]">Создайте первый товарный вариант вручную или добавьте его из заказа.</p>
          </div>
        )}
      </div>

      <div className="pointer-events-none fixed bottom-[calc(92px+env(safe-area-inset-bottom))] left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="pointer-events-auto grid h-14 w-14 place-items-center rounded-full bg-[#2563EB] text-white shadow-[0_18px_36px_rgba(37,99,235,0.34)] ring-4 ring-white/85 transition active:scale-[0.96]"
            aria-label="Новый вариант"
          >
            <Plus size={29} strokeWidth={2.6} />
          </button>
        </div>
      </div>

      {menuVariant && (
        <div className="fixed inset-0 z-[80] bg-black/35" onClick={() => setMenuVariant(null)}>
          <div className="absolute bottom-[calc(112px+env(safe-area-inset-bottom))] left-1/2 max-h-[calc(100dvh-150px)] w-[calc(100%-32px)] max-w-[408px] -translate-x-1/2 overflow-y-auto rounded-[26px] bg-white px-3 pb-3 pt-3 shadow-[0_18px_54px_rgba(15,23,40,0.22)] ring-1 ring-slate-900/[0.04]" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto h-1.5 w-10 rounded-full bg-slate-200" />
            <div className="mt-3 px-1">
              <p className="line-clamp-1 text-[15px] font-black text-[#0F1728]">{getVariantTitle(menuVariant)}</p>
              <p className="mt-0.5 truncate text-[13px] font-semibold text-[#667085]">{getVariantSupplier(menuVariant)}</p>
            </div>
            <div className="mt-3 grid gap-1.5">
              <button type="button" onClick={() => { setSelectedVariant(menuVariant); setIsEditMode(true); setMenuVariant(null); }} className="flex h-11 items-center justify-between rounded-2xl bg-slate-50 px-4 text-[13px] font-bold text-[#0F1728]">
                Редактировать <Check size={16} className="text-slate-400" />
              </button>
              <button type="button" onClick={() => { toggleVariantFlag(menuVariant, 'isPinned'); setMenuVariant(null); }} className="flex h-11 items-center justify-between rounded-2xl bg-slate-50 px-4 text-[13px] font-bold text-[#0F1728]">
                {menuVariant.isPinned ? 'Открепить' : 'Закрепить'} <Pin size={16} className="text-slate-400" />
              </button>
              <button type="button" disabled={!menuVariant.sourceOrderId} onClick={() => { if (menuVariant.sourceOrderId) navigate(`/order/${menuVariant.sourceOrderId}`); setMenuVariant(null); }} className="flex h-11 items-center justify-between rounded-2xl bg-slate-50 px-4 text-[13px] font-bold text-[#0F1728] disabled:opacity-40">
                Открыть заказ <Link2 size={16} className="text-slate-400" />
              </button>
              <button type="button" onClick={() => { void copyVariantData(menuVariant); setMenuVariant(null); }} className="flex h-11 items-center justify-between rounded-2xl bg-slate-50 px-4 text-[13px] font-bold text-[#0F1728]">
                Скопировать данные <Copy size={16} className="text-slate-400" />
              </button>
              <button type="button" onClick={() => { setDeleteCandidate(menuVariant); setMenuVariant(null); }} className="flex h-11 items-center justify-between rounded-2xl bg-rose-50 px-4 text-[13px] font-bold text-rose-600">
                Удалить <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {orderPickerVariant && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/35 px-3 pb-[calc(6.5rem+env(safe-area-inset-bottom))]" onClick={() => setOrderPickerVariant(null)}>
          <div className="max-h-[52dvh] w-full overflow-y-auto rounded-[24px] bg-white px-3 pb-3 pt-2 shadow-[0_18px_56px_rgba(15,23,40,0.22)]" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto h-1 w-9 rounded-full bg-slate-200" />
            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-black text-[#0F1728]">Добавить в заказ</p>
                <p className="mt-0.5 line-clamp-1 text-xs font-semibold text-[#667085]">{getVariantTitle(orderPickerVariant)}</p>
              </div>
              <button type="button" onClick={() => setOrderPickerVariant(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-50 text-[#667085]">
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {activeOrdersForPicker.length > 0 ? activeOrdersForPicker.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  disabled={isAddingToOrder}
                  onClick={() => void attachVariantToOrder(order.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#E7EAF0] bg-white px-3 py-2.5 text-left shadow-[0_4px_14px_rgba(15,23,40,0.035)] disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-[#0F1728]">{order.brand} {order.model}</span>
                    <span className="mt-0.5 block truncate text-xs font-semibold text-[#667085]">{order.year} · VIN {trimVin(order.vin || '—')}</span>
                  </span>
                  <Plus size={18} className="shrink-0 text-blue-600" />
                </button>
              )) : (
                <div className="rounded-xl border border-dashed border-[#D0D5DD] bg-slate-50 p-3 text-center text-xs font-semibold text-[#667085]">
                  Нет активных заказов для добавления.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
                <p className="text-xs text-[#667085]">{getVariantTitle(selectedVariant)}</p>
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
                {selectedVariant.origin === 'standalone' && (
                  <input value={selectedVariant.sourcePartName || ''} onChange={(event) => setSelectedVariant((prev) => prev ? { ...prev, sourcePartName: event.target.value } : prev)} className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm" placeholder="Название детали" />
                )}
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
                  <p className="mt-1 text-sm font-semibold">{getVariantTitle(selectedVariant)}</p>
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
