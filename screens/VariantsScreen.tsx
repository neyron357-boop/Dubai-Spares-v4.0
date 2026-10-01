import { ModalSurface } from '../components/ui';
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
  Send,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ImagePreview from '../components/ImagePreview';
import SafeImage from '../components/SafeImage';
import { Button, EmptyState, PageHeader, SearchField } from '../components/ui';
import MoneyInput from '../components/MoneyInput';
import { sanitizeMoneyInput } from '../utils/moneyInput';
import VehiclePicker from '../components/VehiclePicker';
import { createUuid } from '../id';
import { optimizeLocalImage } from '../storage/photos';
import { useStore } from '../store';
import { PriceVariant } from '../types';
import { cloneVariantForPart, VariantLibraryItem } from '../variantLibraryStore';

type SortKey = 'updated' | 'created' | 'supplier' | 'price_asc' | 'price_desc' | 'pinned';
type FilterKey = 'all' | 'standalone' | 'order' | 'pinned' | 'favorite' | 'with_photo';

const filterOptions: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'standalone', label: 'Без заказа' },
  { key: 'order', label: 'Из заказов' },
  { key: 'pinned', label: 'Закреплённые' },
  { key: 'favorite', label: 'Избранное' },
  { key: 'with_photo', label: 'С фото' },
];

const formatPrice = (price: number) =>
  `${new Intl.NumberFormat('ru-RU').format(Number(price || 0))} AED`;
const formatDate = (value?: number) =>
  new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(value || Date.now()),
  );
const COMPANY_LOGO_PATH = `${import.meta.env.BASE_URL}icon-192.png`;
const normalizePhone = (value: string) => value.replace(/\s+/g, '');
const trimVin = (value: string) => (value.length > 13 ? `${value.slice(0, 13)}…` : value);
const resolveVariantMapUrl = (variant: VariantLibraryItem) => {
  if (variant.mapsUrl) return variant.mapsUrl;
  const source = variant.locationText || variant.location || variant.shopName || '';
  return source ? `https://maps.google.com/?q=${encodeURIComponent(source)}` : '';
};
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{11,17}$/i;
const splitVehicleAndVin = (value?: string) => {
  const raw = String(value || '').trim();
  if (!raw) return { vehicleInfo: '', vin: '' };
  const normalized = raw.replace(/\s+VIN\s+/i, ' • ').replace(/\s+·\s+/g, ' • ');
  const parts = normalized
    .split('•')
    .map((item) => item.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1]?.replace(/^VIN\s*/i, '').trim() || '';
  if (parts.length > 1 && VIN_PATTERN.test(last)) {
    return { vehicleInfo: parts.slice(0, -1).join(' • '), vin: last.toUpperCase() };
  }
  return { vehicleInfo: raw, vin: '' };
};
const normalizeVariantVehicleFields = (variant: VariantLibraryItem): VariantLibraryItem => {
  const split = splitVehicleAndVin(variant.vehicleInfo || variant.sourceOrderLabel || '');
  return {
    ...variant,
    vehicleInfo: split.vehicleInfo || variant.vehicleInfo || variant.sourceOrderLabel || '',
    vin: String(variant.vin || split.vin || '').trim(),
  };
};

const VariantsScreen: React.FC = () => {
  const navigate = useNavigate();
  const {
    variantLibrary,
    saveStandaloneVariant,
    removeStandaloneVariant,
    suppliers,
    updatePriceVariant,
    orders,
    updateOrder,
  } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailFileInputRef = useRef<HTMLInputElement>(null);

  const longPressTimerRef = useRef<number | null>(null);
  const isAttachingVariantRef = useRef(false);

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
  const [vin, setVin] = useState('');
  const [customerOrderRef, setCustomerOrderRef] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedVariant, setSelectedVariant] = useState<VariantLibraryItem | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<VariantLibraryItem | null>(null);
  const [menuVariant, setMenuVariant] = useState<VariantLibraryItem | null>(null);
  const [orderPickerVariant, setOrderPickerVariant] = useState<VariantLibraryItem | null>(null);
  const [isAddingToOrder, setIsAddingToOrder] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);

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
    setVin('');
    setCustomerOrderRef('');
  };

  const miniPhotos = (variant: PriceVariant) => {
    const merged = [variant.photoUrl, ...(variant.photos || [])].filter(
      (item): item is string => !!item,
    );
    return Array.from(new Set(merged));
  };

  const loadCanvasImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
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
    context.fillStyle = '#172333';
    context.font = '700 42px Inter, Arial, sans-serif';
    const partName = variant.sourcePartName || 'Деталь не указана';
    context.fillText(partName.slice(0, 34), startX, 190);

    context.fillStyle = '#2563EB';
    context.font = '700 58px Inter, Arial, sans-serif';
    context.fillText(
      formatPrice(Number((variant.salePriceAed ?? variant.priceAed) || 0)),
      startX,
      280,
    );

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
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Не удалось сформировать изображение'));
            return;
          }
          resolve(blob);
        },
        'image/png',
        0.95,
      );
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
          files: [file],
        });
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
      showToast('Изображение скачано. Его можно отправить клиенту.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Не удалось сформировать картинку для отправки.', 'error');
    }
  };

  const getVariantDedupeKey = (variant: VariantLibraryItem) =>
    [
      variant.sourcePartName || '',
      variant.shopName || '',
      (variant.phone || '').replace(/\D/g, ''),
      variant.locationText || variant.location || '',
      variant.mapsUrl || '',
      Number((variant.purchasePriceAed ?? variant.priceAed) || 0),
      Number((variant.salePriceAed ?? variant.priceAed) || 0),
      variant.note || '',
      miniPhotos(variant).join(','),
    ]
      .map((item) => String(item).trim().toLowerCase())
      .join('|');

  const visibleVariantLibrary = useMemo(() => {
    const orderVariantKeys = new Set(
      variantLibrary.filter((variant) => variant.origin === 'order').map(getVariantDedupeKey),
    );

    return variantLibrary.filter((variant) => {
      if (variant.origin !== 'standalone') return true;
      return !orderVariantKeys.has(getVariantDedupeKey(variant));
    });
  }, [variantLibrary]);

  const filteredAndSorted = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const list = [...visibleVariantLibrary].filter((variant) => {
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
        variant.locationText,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });

    return list.sort((a, b) => {
      if (sortKey === 'supplier') return (a.shopName || '').localeCompare(b.shopName || '', 'ru');
      if (sortKey === 'created') return Number(b.createdAt || 0) - Number(a.createdAt || 0);
      if (sortKey === 'price_asc')
        return (
          Number((a.salePriceAed ?? a.priceAed) || 0) - Number((b.salePriceAed ?? b.priceAed) || 0)
        );
      if (sortKey === 'price_desc')
        return (
          Number((b.salePriceAed ?? b.priceAed) || 0) - Number((a.salePriceAed ?? a.priceAed) || 0)
        );
      if (sortKey === 'pinned') return Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
      return Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0);
    });
  }, [visibleVariantLibrary, activeFilter, searchTerm, sortKey]);

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
    void Promise.all(
      files.map(async (file) => {
        try {
          return await optimizeLocalImage(file, `variants-screen:${file.name}`);
        } catch {
          const reader = new FileReader();
          return await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(file as Blob);
          });
        }
      }),
    ).then((prepared) => {
      setPhotos((prev) => [...prev, ...prepared.filter(Boolean)]);
    });
    event.target.value = '';
  };

  const prepareVariantPhotos = async (files: File[], context: string) => {
    return await Promise.all(
      files.map(async (file) => {
        try {
          return await optimizeLocalImage(file, `${context}:${file.name}`);
        } catch {
          const reader = new FileReader();
          return await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(file as Blob);
          });
        }
      }),
    );
  };

  const updateSelectedVariantPhotos = (nextPhotos: string[]) => {
    const cleanPhotos = Array.from(new Set(nextPhotos.filter(Boolean)));
    setSelectedVariant((prev) =>
      prev ? { ...prev, photos: cleanPhotos, photoUrl: cleanPhotos[0] || '' } : prev,
    );
  };

  const onSelectedVariantPhotosChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0 || !selectedVariant) return;
    const files = Array.from(event.target.files);
    const currentPhotos = miniPhotos(selectedVariant);
    void prepareVariantPhotos(files, 'variants-screen-detail').then((prepared) => {
      updateSelectedVariantPhotos([...currentPhotos, ...prepared.filter(Boolean)]);
    });
    event.target.value = '';
  };

  const removeSelectedVariantPhoto = (indexToRemove: number) => {
    if (!selectedVariant) return;
    updateSelectedVariantPhotos(
      miniPhotos(selectedVariant).filter((_, index) => index !== indexToRemove),
    );
  };

  const makeSelectedVariantPhotoPrimary = (indexToPromote: number) => {
    if (!selectedVariant) return;
    const currentPhotos = miniPhotos(selectedVariant);
    const targetPhoto = currentPhotos[indexToPromote];
    if (!targetPhoto) return;
    updateSelectedVariantPhotos([
      targetPhoto,
      ...currentPhotos.filter((_, index) => index !== indexToPromote),
    ]);
  };

  const isCreateValid =
    shopName.trim() && partName.trim() && Number(purchasePriceAed) > 0 && Number(salePriceAed) > 0;

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
      vin: vin.trim().toUpperCase(),
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
      updatedAt: Date.now(),
    };

    setIsSaving(true);
    try {
      saveStandaloneVariant(created);
      setShowCreateModal(false);
      resetForm();
      showToast('Вариант сохранён', 'success');
    } catch {
      showToast(
        'Не удалось сохранить вариант. Освободите место в хранилище браузера и повторите.',
        'error',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const resolveCurrentLocation = async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      showToast('GPS недоступен в этом браузере.', 'error');
      return null;
    }

    setIsResolvingLocation(true);
    const result = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
    setIsResolvingLocation(false);

    if (!result) {
      showToast('Не удалось получить GPS-координаты. Проверьте разрешения геолокации.', 'error');
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
    setSelectedVariant((prev) =>
      prev
        ? {
            ...prev,
            location: coordsText,
            locationText: coordsText,
            mapsUrl: `https://maps.google.com/?q=${current.lat},${current.lng}`,
          }
        : prev,
    );
  };

  const persistVariant = async (variant: VariantLibraryItem) => {
    try {
      if (variant.origin === 'standalone') {
        saveStandaloneVariant({ ...variant, updatedAt: Date.now() });
        return true;
      }
      if (!variant.sourcePartId) return false;
      const saved = await updatePriceVariant(variant.sourcePartId, {
        ...variant,
        updatedAt: Date.now(),
      });
      if (!saved) showToast('Не удалось сохранить изменения. Повторите попытку.', 'error');
      return Boolean(saved);
    } catch {
      showToast(
        'Изменения не сохранены. Освободите место в хранилище браузера и повторите.',
        'error',
      );
      return false;
    }
  };
  const quickToggle = async (key: 'isPinned' | 'isFavorite') => {
    if (!selectedVariant) return;
    const next = { ...selectedVariant, [key]: !selectedVariant[key] };
    if (await persistVariant(next)) setSelectedVariant(next);
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

  const primaryFilterOptions = filterOptions.filter((option) =>
    ['all', 'standalone', 'order', 'pinned', 'favorite'].includes(option.key),
  );
  const activeOrdersForPicker = useMemo(
    () =>
      orders
        .filter((order) => !order.isArchived && !order.isSold)
        .sort(
          (a, b) =>
            Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0),
        )
        .slice(0, 12),
    [orders],
  );
  const vehicleInfoOptions = useMemo(() => {
    const seen = new Set<string>();
    return orders
      .filter((order) => !order.isArchived && !order.isSold)
      .sort(
        (a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0),
      )
      .flatMap((order) => {
        const carTitle = [order.brand, order.model, order.year]
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .join(' ');
        const vin = String(order.vin || '').trim();
        const value = carTitle || order.clientName || `Заказ ${String(order.id || '').slice(0, 8)}`;
        const seenKey = `${value}|${vin}`;
        if (!value || seen.has(seenKey)) return [];
        seen.add(seenKey);
        const partsPreview = (order.parts || [])
          .map((part) => part.name)
          .filter(Boolean)
          .slice(0, 2)
          .join(', ');
        return [
          {
            id: order.id,
            value,
            vin,
            orderRef: order.id,
            meta: [partsPreview, vin ? `VIN ${vin}` : '', order.clientName || 'Активный заказ']
              .filter(Boolean)
              .join(' · '),
          },
        ];
      })
      .slice(0, 24);
  }, [orders]);
  const filteredVehicleInfoOptions = useMemo(() => {
    const query = vehicleInfo.trim().toLowerCase();
    if (!query) return vehicleInfoOptions.slice(0, 8);
    return vehicleInfoOptions
      .filter((option) =>
        `${option.value} ${option.vin} ${option.meta}`.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [vehicleInfo, vehicleInfoOptions]);

  const filteredSelectedVehicleInfoOptions = useMemo(() => {
    const query = String(selectedVariant?.vehicleInfo || '')
      .trim()
      .toLowerCase();
    if (!query) return vehicleInfoOptions.slice(0, 8);
    return vehicleInfoOptions
      .filter((option) =>
        `${option.value} ${option.vin} ${option.meta}`.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [selectedVariant?.vehicleInfo, vehicleInfoOptions]);

  const selectVehicleInfo = (option: { value: string; vin?: string; orderRef?: string }) => {
    setVehicleInfo(option.value);
    setVin(String(option.vin || '').toUpperCase());
    setCustomerOrderRef(option.orderRef || '');
  };

  const selectVehicleInfoForSelected = (option: {
    value: string;
    vin?: string;
    orderRef?: string;
  }) => {
    setSelectedVariant((prev) =>
      prev
        ? {
            ...prev,
            vehicleInfo: option.value,
            vin: String(option.vin || '').toUpperCase(),
            customerOrderRef: option.orderRef || prev.customerOrderRef || '',
          }
        : prev,
    );
  };

  const showToast = (message: string, tone: 'error' | 'success' | 'info' = 'info') => {
    window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, tone } }));
  };

  const openVariantDetail = (variant: VariantLibraryItem) => {
    setSelectedVariant(normalizeVariantVehicleFields(variant));
    setIsEditMode(false);
  };

  const toggleVariantFlag = (variant: VariantLibraryItem, key: 'isPinned' | 'isFavorite') => {
    persistVariant({ ...variant, [key]: !variant[key] });
  };

  const getVariantTitle = (variant: VariantLibraryItem) =>
    variant.sourcePartName || variant.vehicleInfo || variant.note || 'Деталь не указана';
  const isAttachedToExistingOrder = (variant: VariantLibraryItem) =>
    Boolean(variant.sourceOrderId && orders.some((order) => order.id === variant.sourceOrderId));
  const getVariantLocation = (variant: VariantLibraryItem) => {
    const raw = (variant.locationText || variant.location || '').trim();
    if (!raw) return 'Dubai, UAE';
    if (/^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?$/.test(raw.replace(/[()]/g, '')))
      return 'Sharjah, UAE';
    if (/sharjah/i.test(raw)) return 'Sharjah, UAE';
    if (/dubai/i.test(raw)) return 'Dubai, UAE';
    if (/abu\s*dhabi/i.test(raw)) return 'Abu Dhabi, UAE';
    return raw;
  };
  const getVariantSupplier = (variant: VariantLibraryItem) => variant.shopName || 'Без поставщика';
  const getVariantPhone = (variant: VariantLibraryItem) =>
    variant.phone && variant.phone !== '+971' ? variant.phone : '';

  const getStatusMeta = (variant: VariantLibraryItem) => {
    if (variant.isPinned)
      return { label: 'Закреплённый', className: 'bg-emerald-50 text-emerald-700' };
    if (variant.origin === 'order')
      return { label: 'Из заказа', className: 'bg-blue-50 text-blue-700' };
    return { label: 'Без заказа', className: 'bg-slate-100 text-slate-600' };
  };

  const copyVariantData = async (variant: VariantLibraryItem) => {
    const text = [
      getVariantTitle(variant),
      getVariantSupplier(variant),
      getVariantLocation(variant),
      formatPrice(Number((variant.salePriceAed ?? variant.priceAed) || 0)),
      getVariantPhone(variant),
    ]
      .filter(Boolean)
      .join('\n');
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
    if (!orderPickerVariant || isAttachingVariantRef.current) return;
    const variantToAttach = orderPickerVariant;
    const targetOrder = orders.find((order) => order.id === orderId);
    if (!targetOrder) return;

    isAttachingVariantRef.current = true;
    setIsAddingToOrder(true);
    const partId = createUuid();
    const variantClone = {
      ...cloneVariantForPart(variantToAttach, partId),
      orderId: targetOrder.id,
    };
    const variantPhotos = miniPhotos(variantToAttach);
    const nextPart = {
      id: partId,
      orderId: targetOrder.id,
      name: getVariantTitle(variantToAttach),
      quantity: 1,
      comment: variantToAttach.note || '',
      photoUrl: variantPhotos[0] || '',
      photos: variantPhotos,
      variants: [variantClone],
      isFound: true,
      status: 'found' as const,
    };

    try {
      const saved = await updateOrder({
        ...targetOrder,
        parts: [nextPart, ...(targetOrder.parts || [])],
      });
      if (!saved) {
        showToast('Не удалось добавить вариант в заказ', 'error');
        return;
      }
      if (variantToAttach.origin === 'standalone') {
        removeStandaloneVariant(variantToAttach.id);
        if (selectedVariant?.id === variantToAttach.id) setSelectedVariant(null);
      }
      setOrderPickerVariant(null);
      showToast('Вариант добавлен в заказ', 'success');
      navigate(`/order/${targetOrder.id}`);
    } finally {
      isAttachingVariantRef.current = false;
      setIsAddingToOrder(false);
    }
  };

  const selectedVariantPhotos = selectedVariant ? miniPhotos(selectedVariant) : [];

  return (
    <div className="ui-page">
      <PageHeader
        title="Варианты"
        eyebrow="Каталог предложений"
        description="Цены и фотографии деталей. Добавляйте подходящие варианты в заказ."
        actions={
          <Button icon={Plus} onClick={() => setShowCreateModal(true)}>
            Новый вариант
          </Button>
        }
      />
      <div className="space-y-5">
        <section className="space-y-2.5">
          <div className="flex items-center gap-3">
            <SearchField
              className="min-w-0 flex-1"
              label="Поиск вариантов"
              placeholder="Поставщик, деталь, VIN, телефон"
              value={searchTerm}
              onChange={setSearchTerm}
            />
            <button
              type="button"
              onClick={() => setActiveFilter(activeFilter === 'with_photo' ? 'all' : 'with_photo')}
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border bg-white/90 shadow-[0_1px_6px_rgba(15,23,40,0.025)] transition active:scale-[0.97] ${activeFilter === 'with_photo' ? 'border-blue-300 text-blue-600' : 'border-[#e5eaf1] text-[#475467]'}`}
              aria-label="Только с фотографиями"
              aria-pressed={activeFilter === 'with_photo'}
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
                aria-pressed={activeFilter === option.key}
                className={`h-10 shrink-0 whitespace-nowrap rounded-[15px] border px-2.5 text-[12px] font-bold transition active:scale-[0.98] ${activeFilter === option.key ? 'border-blue-500 bg-white text-blue-600 shadow-[0_6px_16px_rgba(37,99,235,0.08)]' : 'border-[#e5eaf1] bg-white/86 text-[#3D4658]'}`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="shrink-0 text-[14px] font-bold text-[#3D4658]">
              {filteredAndSorted.length} вариантов
            </p>
            <div className="relative min-w-0 flex-1 max-w-[230px]">
              <select
                aria-label="Сортировка вариантов"
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className="h-11 w-full sm:w-[230px] appearance-none rounded-[17px] border border-[#e5eaf1] bg-white pl-4 pr-8 text-[13px] font-bold text-[#172333] outline-none shadow-[0_1px_6px_rgba(15,23,40,0.025)]"
              >
                <option value="updated">По дате обновления</option>
                <option value="created">По дате создания</option>
                <option value="price_asc">По цене ↑</option>
                <option value="price_desc">По цене ↓</option>
                <option value="supplier">По поставщику А–Я</option>
                <option value="pinned">Сначала закреплённые</option>
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-3.5 text-[#172333]"
              />
            </div>
          </div>
        </section>

        {filteredAndSorted.length > 0 ? (
          <div className="variant-catalog-grid grid grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSorted.map((variant) => {
              const photosForCard = miniPhotos(variant);
              const firstPhoto = photosForCard[0];
              const phoneValue = getVariantPhone(variant);
              const statusMeta = getStatusMeta(variant);
              const opensExistingOrder = isAttachedToExistingOrder(variant);
              return (
                <article
                  key={`${variant.origin}-${variant.id}-${variant.sourceOrderId || 'none'}`}
                  onClick={() => openVariantDetail(variant)}
                  onPointerDown={() => startLongPressDelete(variant)}
                  onPointerUp={cancelLongPressDelete}
                  onPointerLeave={cancelLongPressDelete}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setDeleteCandidate(variant);
                  }}
                  className="flex h-[324px] min-w-0 cursor-pointer flex-col overflow-hidden rounded-[20px] border border-[#e5eaf1] bg-white text-left shadow-sm transition duration-200 active:scale-[0.985]"
                >
                  <div className="relative h-[112px] shrink-0 bg-[#f1f4f8]">
                    {firstPhoto ? (
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setGallery({ images: photosForCard, index: 0 });
                        }}
                        className="h-full w-full"
                        aria-label="Открыть фото варианта"
                      >
                        <SafeImage
                          src={firstPhoto}
                          alt={getVariantTitle(variant)}
                          className="h-full w-full object-contain p-2"
                          loading="lazy"
                        />
                      </button>
                    ) : (
                      <SafeImage
                        src=""
                        alt={`Фото недоступно: ${getVariantTitle(variant)}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleVariantFlag(variant, 'isFavorite');
                      }}
                      className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-white/95 text-[#667085] shadow-[0_4px_12px_rgba(15,23,40,0.12)] transition active:scale-95"
                      aria-label="Избранное"
                      aria-pressed={Boolean(variant.isFavorite)}
                    >
                      <Star
                        size={14}
                        fill={variant.isFavorite ? '#FBBF24' : 'none'}
                        className={variant.isFavorite ? 'text-amber-400' : ''}
                      />
                    </button>
                    {photosForCard.length > 0 && (
                      <span className="absolute bottom-2 right-2 rounded-full bg-white/82 px-1.5 py-0.5 text-[11px] font-bold text-[#3D4658] shadow-[0_4px_10px_rgba(15,23,40,0.08)]">
                        {photosForCard.length} фото
                      </span>
                    )}
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-3">
                    <h2 className="line-clamp-2 min-h-[36px] shrink-0 text-[14px] font-bold leading-[18px] text-[#0B1220]">
                      <button
                        type="button"
                        className="w-full text-left"
                        aria-label={`Открыть вариант: ${getVariantTitle(variant)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openVariantDetail(variant);
                        }}
                      >
                        {getVariantTitle(variant)}
                      </button>
                    </h2>
                    <p className="mt-1.5 shrink-0 truncate text-[12px] font-semibold leading-[15px] text-[#667085]">
                      {getVariantSupplier(variant)}
                    </p>
                    <p className="mt-0.5 shrink-0 truncate text-[12px] font-medium leading-[15px] text-[#7A8293]">
                      {getVariantLocation(variant)}
                    </p>
                    <p className="mt-2 shrink-0 truncate text-[19px] font-bold leading-[22px] text-[#0B1220]">
                      {formatPrice(Number((variant.salePriceAed ?? variant.priceAed) || 0))}
                    </p>
                    <span
                      className={`mt-1.5 w-fit max-w-full shrink-0 truncate rounded-[9px] px-2 py-0.5 text-[10.5px] font-bold leading-[15px] ${statusMeta.className}`}
                    >
                      {statusMeta.label}
                    </span>

                    <div className="variant-card-actions mt-auto grid shrink-0 grid-cols-[44px_minmax(0,1fr)_44px] gap-1.5 pt-3">
                      <button
                        type="button"
                        disabled={!phoneValue}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (phoneValue)
                            window.open(`https://wa.me/${phoneValue.replace(/\D/g, '')}`, '_blank');
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
                          if (opensExistingOrder && variant.sourceOrderId) {
                            navigate(`/order/${variant.sourceOrderId}`);
                            return;
                          }
                          setOrderPickerVariant(variant);
                        }}
                        aria-label={opensExistingOrder ? 'Открыть заказ' : 'В заказ'}
                        className="h-11 truncate rounded-[10px] bg-blue-50 px-1.5 text-[10.5px] font-bold text-blue-700 transition active:scale-[0.97]"
                      >
                        <span className="inline-flex max-w-full items-center justify-center gap-1 truncate">
                          {opensExistingOrder ? <Link2 size={12} /> : <Plus size={12} />}
                          <span className="variant-order-label hidden sm:inline">
                            {opensExistingOrder ? 'Открыть заказ' : 'В заказ'}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuVariant(variant);
                        }}
                        className="grid h-8 place-items-center rounded-[10px] border border-[#e5eaf1] bg-white text-[#475467] transition active:scale-95"
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
          <EmptyState
            icon={Camera}
            title={
              searchTerm || activeFilter !== 'all' ? 'Варианты не найдены' : 'Пока нет вариантов'
            }
            description={
              searchTerm || activeFilter !== 'all'
                ? 'Попробуйте другой запрос или сбросьте фильтры.'
                : 'Сохраните предложение поставщика: деталь, закупочную цену, цену продажи и фотографии.'
            }
            action={
              <Button
                onClick={() => {
                  if (searchTerm || activeFilter !== 'all') {
                    setSearchTerm('');
                    setActiveFilter('all');
                  } else setShowCreateModal(true);
                }}
              >
                {searchTerm || activeFilter !== 'all' ? 'Сбросить фильтры' : 'Добавить вариант'}
              </Button>
            }
          />
        )}
      </div>

      {menuVariant && (
        <ModalSurface
          label="Действия с вариантом"
          onClose={() => setMenuVariant(null)}
          className=""
        >
          <div
            className="absolute bottom-[calc(112px+env(safe-area-inset-bottom))] left-1/2 max-h-[calc(100dvh-150px)] w-[calc(100%-32px)] max-w-[408px] -translate-x-1/2 overflow-y-auto rounded-[26px] bg-white px-3 pb-3 pt-3 shadow-[0_18px_54px_rgba(15,23,40,0.22)] ring-1 ring-slate-900/[0.04]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto h-1.5 w-10 rounded-full bg-slate-200" />
            <div className="mt-3 px-1">
              <p className="line-clamp-1 text-[15px] font-bold text-[#172333]">
                {getVariantTitle(menuVariant)}
              </p>
              <p className="mt-0.5 truncate text-[13px] font-semibold text-[#667085]">
                {getVariantSupplier(menuVariant)}
              </p>
            </div>
            <div className="mt-3 grid gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedVariant(menuVariant);
                  setIsEditMode(true);
                  setMenuVariant(null);
                }}
                className="flex h-11 items-center justify-between rounded-2xl bg-slate-50 px-4 text-[13px] font-bold text-[#172333]"
              >
                Редактировать <Check size={16} className="text-slate-400" />
              </button>
              <button
                type="button"
                onClick={() => {
                  toggleVariantFlag(menuVariant, 'isPinned');
                  setMenuVariant(null);
                }}
                className="flex h-11 items-center justify-between rounded-2xl bg-slate-50 px-4 text-[13px] font-bold text-[#172333]"
              >
                {menuVariant.isPinned ? 'Открепить' : 'Закрепить'}{' '}
                <Pin size={16} className="text-slate-400" />
              </button>
              <button
                type="button"
                disabled={!menuVariant.sourceOrderId}
                onClick={() => {
                  if (menuVariant.sourceOrderId) navigate(`/order/${menuVariant.sourceOrderId}`);
                  setMenuVariant(null);
                }}
                className="flex h-11 items-center justify-between rounded-2xl bg-slate-50 px-4 text-[13px] font-bold text-[#172333] disabled:opacity-40"
              >
                Открыть заказ <Link2 size={16} className="text-slate-400" />
              </button>
              <button
                type="button"
                onClick={() => {
                  void copyVariantData(menuVariant);
                  setMenuVariant(null);
                }}
                className="flex h-11 items-center justify-between rounded-2xl bg-slate-50 px-4 text-[13px] font-bold text-[#172333]"
              >
                Скопировать данные <Copy size={16} className="text-slate-400" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleteCandidate(menuVariant);
                  setMenuVariant(null);
                }}
                className="flex h-11 items-center justify-between rounded-2xl bg-rose-50 px-4 text-[13px] font-bold text-rose-600"
              >
                Удалить <X size={16} />
              </button>
            </div>
          </div>
        </ModalSurface>
      )}

      {orderPickerVariant && (
        <ModalSurface
          label="Добавить в заказ"
          onClose={() => setOrderPickerVariant(null)}
          className="ui-sheet-layer flex items-end  px-3 pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
        >
          <div
            className="max-h-[52dvh] w-full overflow-y-auto rounded-[24px] bg-white px-3 pb-3 pt-2 shadow-[0_18px_56px_rgba(15,23,40,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto h-1 w-9 rounded-full bg-slate-200" />
            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-bold text-[#172333]">Добавить в заказ</p>
                <p className="mt-0.5 line-clamp-1 text-xs font-semibold text-[#667085]">
                  {getVariantTitle(orderPickerVariant)}
                </p>
              </div>
              <button
                aria-label="Закрыть"
                title="Закрыть"
                type="button"
                onClick={() => setOrderPickerVariant(null)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-50 text-[#667085]"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {activeOrdersForPicker.length > 0 ? (
                activeOrdersForPicker.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    disabled={isAddingToOrder}
                    onClick={() => void attachVariantToOrder(order.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#E7EAF0] bg-white px-3 py-2.5 text-left shadow-[0_4px_14px_rgba(15,23,40,0.035)] disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-[#172333]">
                        {order.brand} {order.model}
                      </span>
                      <span className="mt-0.5 block truncate text-xs font-semibold text-[#667085]">
                        {order.year} · VIN {trimVin(order.vin || '—')}
                      </span>
                    </span>
                    <Plus size={18} className="shrink-0 text-blue-600" />
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-[#D0D5DD] bg-slate-50 p-3 text-center text-xs font-semibold text-[#667085]">
                  Нет активных заказов для добавления.
                </div>
              )}
            </div>
          </div>
        </ModalSurface>
      )}

      {showCreateModal && (
        <ModalSurface
          label="Новый вариант"
          onClose={() => setShowCreateModal(false)}
          className="ui-sheet-layer flex items-end"
        >
          <div className="max-h-[92dvh] w-full overflow-y-auto overscroll-contain touch-pan-y rounded-t-[24px] bg-white px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
            <div className="mx-auto h-1.5 w-10 rounded-full bg-gray-300" />
            <div className="mt-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Новый вариант</h2>
              <button
                aria-label="Закрыть"
                title="Закрыть"
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-full p-2 text-[#667085]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <section className="space-y-2 rounded-2xl border border-[#E7EAF0] p-3">
                <p className="text-xs font-semibold text-[#667085]">Источник поставщика</p>
                <select
                  aria-label="Поставщик из базы"
                  value={supplierId}
                  onChange={(event) => handleSupplierChange(event.target.value)}
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none"
                >
                  <option value="">Ввести вручную</option>
                  {suppliers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </section>

              <section className="space-y-2 rounded-2xl border border-[#E7EAF0] p-3">
                <p className="text-xs font-semibold text-[#667085]">Основные данные</p>
                <input
                  aria-label="Название поставщика"
                  value={shopName}
                  onChange={(event) => setShopName(event.target.value)}
                  placeholder="Поставщик"
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none"
                />
                <input
                  aria-label="Название детали"
                  value={partName}
                  onChange={(event) => setPartName(event.target.value)}
                  placeholder="Деталь / название варианта"
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    aria-label="Цена закупки, AED"
                    value={purchasePriceAed}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    onChange={(event) =>
                      setPurchasePriceAed(sanitizeMoneyInput(event.target.value))
                    }
                    placeholder="Цена покупки"
                    className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    aria-label="Цена продажи, AED"
                    value={salePriceAed}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    onChange={(event) => setSalePriceAed(sanitizeMoneyInput(event.target.value))}
                    placeholder="Цена продажи"
                    className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none"
                  />
                  <div className="flex h-[52px] items-center rounded-2xl border border-[#E7EAF0] px-3 text-sm text-[#667085]">
                    AED
                  </div>
                </div>
                <textarea
                  aria-label="Комментарий"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Комментарий"
                  className="min-h-[120px] w-full rounded-2xl border border-[#E7EAF0] px-3 py-2 text-sm outline-none"
                />
                <VehiclePicker
                  value={vehicleInfo}
                  options={filteredVehicleInfoOptions}
                  onChange={setVehicleInfo}
                  onSelect={selectVehicleInfo}
                />
                <input
                  aria-label="VIN автомобиля"
                  value={vin}
                  onChange={(event) =>
                    setVin(
                      event.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, '')
                        .slice(0, 17),
                    )
                  }
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm uppercase outline-none"
                  placeholder="VIN"
                  autoComplete="off"
                />
                <input
                  aria-label="Номер заказа клиента"
                  value={customerOrderRef}
                  onChange={(event) => setCustomerOrderRef(event.target.value)}
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none"
                  placeholder="Номер/ссылка заказа (необязательно)"
                />
                <div className="flex flex-wrap gap-2"></div>
              </section>

              <section className="space-y-2 rounded-2xl border border-[#E7EAF0] p-3">
                <p className="text-xs font-semibold text-[#667085]">Контакты и локация</p>
                <input
                  aria-label="Телефон"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value.replace(/[^\d+]/g, ''))}
                  inputMode="numeric"
                  type="tel"
                  placeholder="Телефон"
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none"
                />
                <input
                  aria-label="Адрес поставщика"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="Адрес / район"
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none"
                />
                <input
                  aria-label="Ссылка на карту"
                  value={mapsUrl}
                  onChange={(event) => setMapsUrl(event.target.value)}
                  placeholder="Google Maps URL"
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => void applyCurrentLocationToCreateForm()}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] px-3 text-sm font-semibold text-[#475467] disabled:opacity-50"
                  disabled={isResolvingLocation}
                >
                  {isResolvingLocation ? 'Определяем GPS...' : '📍 Текущее местоположение'}
                </button>
              </section>

              <section className="space-y-2 rounded-2xl border border-[#E7EAF0] p-3">
                <p className="text-xs font-semibold text-[#667085]">Фото</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] px-3 text-sm font-semibold text-[#475467]"
                >
                  <Camera size={16} /> Добавить фото
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={onPhotosChange}
                />
                {photos.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    {photos.map((photo, index, images) => (
                      <button
                        key={photo}
                        type="button"
                        onClick={() => setGallery({ images, index })}
                        className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-[#E7EAF0] bg-[#f1f4f8]"
                        aria-label={`Открыть фото ${index + 1}`}
                      >
                        <img
                          src={photo}
                          className="h-full w-full object-cover"
                          alt={`Фото варианта ${index + 1}`}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="h-12 rounded-2xl border border-[#D0D5DD] text-sm font-semibold text-[#475467]"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!isCreateValid || isSaving}
                onClick={handleCreateVariant}
                className="h-12 rounded-2xl bg-[#2563EB] text-sm font-bold text-white disabled:bg-[#98A2B3]"
              >
                {isSaving ? 'Сохраняем...' : 'Сохранить вариант'}
              </button>
            </div>
          </div>
        </ModalSurface>
      )}

      {selectedVariant && (
        <ModalSurface
          label="Карточка варианта"
          onClose={() => {
            setSelectedVariant(null);
            setIsEditMode(false);
          }}
          className="ui-sheet-layer flex items-end"
        >
          <div className="max-h-[92dvh] w-full overflow-y-auto overscroll-contain touch-pan-y rounded-t-[24px] bg-white px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-0">
            <input
              ref={detailFileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onSelectedVariantPhotosChange}
            />
            {selectedVariantPhotos.length > 0 ? (
              <div className="-mx-4 relative overflow-hidden rounded-t-[24px] bg-[#f1f4f8]">
                <div
                  className="flex snap-x snap-mandatory overflow-x-auto no-scrollbar"
                  data-horizontal-scroll="true"
                >
                  {selectedVariantPhotos.map((photo, index, images) => (
                    <button
                      key={`${photo}-${index}`}
                      type="button"
                      onClick={() => setGallery({ images, index })}
                      className="h-[280px] min-w-full snap-center bg-[#F7F8FA]"
                      aria-label={`Открыть фото ${index + 1}`}
                    >
                      <SafeImage
                        src={photo}
                        alt={`Фото варианта ${index + 1}`}
                        className="h-full w-full object-contain p-3"
                      />
                    </button>
                  ))}
                </div>
                <div className="pointer-events-none absolute left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-black/18" />
                <span className="absolute bottom-3 right-3 rounded-full bg-black/68 px-2.5 py-1 text-[11px] font-bold text-white">
                  {selectedVariantPhotos.length} фото
                </span>
                {isEditMode && (
                  <button
                    type="button"
                    onClick={() => detailFileInputRef.current?.click()}
                    className="absolute bottom-3 left-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/92 px-3 text-[11px] font-bold text-[#172333] shadow-sm active:scale-[0.98]"
                  >
                    <Camera size={14} /> Изменить фото
                  </button>
                )}
              </div>
            ) : isEditMode ? (
              <div className="-mx-4 relative rounded-t-[24px] bg-[#f1f4f8] px-4 pb-4 pt-8">
                <div className="absolute left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-black/18" />
                <button
                  type="button"
                  onClick={() => detailFileInputRef.current?.click()}
                  className="flex h-36 w-full flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-[#B8C4D6] bg-white/70 text-sm font-bold text-[#475467] active:scale-[0.99]"
                >
                  <Camera size={22} />
                  Добавить фото
                </button>
              </div>
            ) : (
              <div className="mx-auto h-1.5 w-10 rounded-full bg-gray-300" />
            )}
            <div className="mt-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-bold">{selectedVariant.shopName || 'Вариант'}</p>
                <p className="text-xs text-[#667085]">{getVariantTitle(selectedVariant)}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsEditMode((prev) => !prev)}
                  className="rounded-xl border border-[#E7EAF0] px-3 py-1.5 text-xs font-semibold"
                >
                  {isEditMode ? 'Просмотр' : 'Редактировать'}
                </button>
                <button
                  aria-label="Закрыть"
                  title="Закрыть"
                  type="button"
                  onClick={() => setSelectedVariant(null)}
                  className="rounded-full p-2 text-[#667085]"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!selectedVariant.phone}
                className="h-11 rounded-xl border border-[#E7EAF0] text-xs font-semibold active:scale-[0.98] disabled:opacity-40"
                onClick={() => window.open(`tel:${selectedVariant.phone}`, '_self')}
              >
                <span className="inline-flex items-center gap-1">
                  <Phone size={14} />
                  Позвонить
                </span>
              </button>
              <button
                type="button"
                disabled={!selectedVariant.phone}
                className="h-11 rounded-xl border border-[#E7EAF0] text-xs font-semibold active:scale-[0.98] disabled:opacity-40"
                onClick={() =>
                  window.open(`https://wa.me/${selectedVariant.phone.replace(/\D/g, '')}`, '_blank')
                }
              >
                <span className="inline-flex items-center gap-1">
                  <MessageCircle size={14} />
                  WhatsApp
                </span>
              </button>
              <button
                type="button"
                disabled={!resolveVariantMapUrl(selectedVariant)}
                className="h-11 rounded-xl border border-[#E7EAF0] text-xs font-semibold active:scale-[0.98] disabled:opacity-40"
                onClick={() => {
                  const url = resolveVariantMapUrl(selectedVariant);
                  if (url) window.open(url, '_blank', 'noopener,noreferrer');
                }}
              >
                <span className="inline-flex items-center gap-1">
                  <MapPin size={14} />
                  Маршрут
                </span>
              </button>
              <button
                type="button"
                disabled={!selectedVariant.sourceOrderId}
                className="h-11 rounded-xl border border-[#E7EAF0] text-xs font-semibold active:scale-[0.98] disabled:opacity-40"
                onClick={() =>
                  selectedVariant.sourceOrderId &&
                  navigate(`/order/${selectedVariant.sourceOrderId}`)
                }
              >
                <span className="inline-flex items-center gap-1">
                  <Link2 size={14} />
                  Открыть заказ
                </span>
              </button>
            </div>

            {isEditMode ? (
              <div className="mt-4 space-y-2">
                <section className="space-y-2 rounded-2xl border border-[#E7EAF0] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[#667085]">Фото</p>
                    <button
                      type="button"
                      onClick={() => detailFileInputRef.current?.click()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#D0D5DD] px-3 text-xs font-bold text-[#475467] active:scale-[0.98]"
                    >
                      <Camera size={14} /> Добавить
                    </button>
                  </div>
                  {selectedVariantPhotos.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {selectedVariantPhotos.map((photo, index, images) => (
                        <div
                          key={`${photo}-${index}-edit`}
                          className="relative overflow-hidden rounded-2xl border border-[#E7EAF0] bg-[#f1f4f8]"
                        >
                          <button
                            type="button"
                            onClick={() => setGallery({ images, index })}
                            className="block aspect-square w-full"
                            aria-label={`Открыть фото ${index + 1}`}
                          >
                            <SafeImage
                              src={photo}
                              alt={`Фото варианта ${index + 1}`}
                              className="h-full w-full object-cover"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSelectedVariantPhoto(index)}
                            className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/62 text-white"
                            aria-label={`Удалить фото ${index + 1}`}
                          >
                            <X size={13} />
                          </button>
                          {index === 0 ? (
                            <span className="absolute bottom-1 left-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                              Главная
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => makeSelectedVariantPhotoPrimary(index)}
                              className="absolute bottom-1 left-1 inline-flex h-7 items-center gap-1 rounded-full bg-white/92 px-2 text-[11px] font-bold text-[#475467]"
                            >
                              <Star size={11} /> Главная
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => detailFileInputRef.current?.click()}
                      className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#D0D5DD] bg-[#F7F8FA] text-xs font-bold text-[#667085]"
                    >
                      <Camera size={18} />
                      Добавить фото варианта
                    </button>
                  )}
                </section>
                <input
                  aria-label="Название поставщика"
                  value={selectedVariant.shopName || ''}
                  onChange={(event) =>
                    setSelectedVariant((prev) =>
                      prev ? { ...prev, shopName: event.target.value } : prev,
                    )
                  }
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm"
                  placeholder="Поставщик"
                />
                {selectedVariant.origin === 'standalone' && (
                  <input
                    aria-label="Название детали"
                    value={selectedVariant.sourcePartName || ''}
                    onChange={(event) =>
                      setSelectedVariant((prev) =>
                        prev ? { ...prev, sourcePartName: event.target.value } : prev,
                      )
                    }
                    className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm"
                    placeholder="Название детали"
                  />
                )}
                <MoneyInput
                  aria-label="Цена закупки, AED"
                  value={Number(selectedVariant.purchasePriceAed ?? selectedVariant.priceAed ?? 0)}
                  onCommit={(value) =>
                    setSelectedVariant((prev) =>
                      prev ? { ...prev, purchasePriceAed: value } : prev,
                    )
                  }
                  className="ui-input"
                  placeholder="Цена закупки, AED"
                />
                <MoneyInput
                  aria-label="Цена продажи, AED"
                  value={Number(selectedVariant.salePriceAed ?? selectedVariant.priceAed ?? 0)}
                  onCommit={(value) =>
                    setSelectedVariant((prev) =>
                      prev ? { ...prev, priceAed: value, salePriceAed: value } : prev,
                    )
                  }
                  className="ui-input"
                  placeholder="Цена продажи, AED"
                />
                <input
                  aria-label="Телефон"
                  value={selectedVariant.phone || ''}
                  onChange={(event) =>
                    setSelectedVariant((prev) =>
                      prev ? { ...prev, phone: event.target.value.replace(/[^\d+]/g, '') } : prev,
                    )
                  }
                  inputMode="numeric"
                  type="tel"
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm"
                  placeholder="Телефон"
                />
                <input
                  aria-label="Адрес поставщика"
                  value={selectedVariant.locationText || selectedVariant.location || ''}
                  onChange={(event) =>
                    setSelectedVariant((prev) =>
                      prev
                        ? {
                            ...prev,
                            locationText: event.target.value,
                            location: event.target.value,
                          }
                        : prev,
                    )
                  }
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm"
                  placeholder="Локация"
                />
                <button
                  type="button"
                  onClick={() => void applyCurrentLocationToSelected()}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] px-3 text-sm font-semibold text-[#475467] disabled:opacity-50"
                  disabled={isResolvingLocation}
                >
                  {isResolvingLocation ? 'Определяем GPS...' : '📍 Текущее местоположение'}
                </button>
                <VehiclePicker
                  value={selectedVariant.vehicleInfo || ''}
                  options={filteredSelectedVehicleInfoOptions}
                  onChange={(value) =>
                    setSelectedVariant((prev) => (prev ? { ...prev, vehicleInfo: value } : prev))
                  }
                  onSelect={selectVehicleInfoForSelected}
                />
                <input
                  aria-label="VIN автомобиля"
                  value={selectedVariant.vin || ''}
                  onChange={(event) =>
                    setSelectedVariant((prev) =>
                      prev
                        ? {
                            ...prev,
                            vin: event.target.value
                              .toUpperCase()
                              .replace(/[^A-Z0-9]/g, '')
                              .slice(0, 17),
                          }
                        : prev,
                    )
                  }
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm uppercase"
                  placeholder="VIN"
                  autoComplete="off"
                />
                <input
                  aria-label="Номер заказа клиента"
                  value={selectedVariant.customerOrderRef || ''}
                  onChange={(event) =>
                    setSelectedVariant((prev) =>
                      prev ? { ...prev, customerOrderRef: event.target.value } : prev,
                    )
                  }
                  className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 text-sm"
                  placeholder="Номер/ссылка заказа"
                />
                <textarea
                  aria-label="Комментарий"
                  value={selectedVariant.note || ''}
                  onChange={(event) =>
                    setSelectedVariant((prev) =>
                      prev ? { ...prev, note: event.target.value } : prev,
                    )
                  }
                  className="min-h-[120px] w-full rounded-2xl border border-[#E7EAF0] px-3 py-2 text-sm"
                  placeholder="Комментарий"
                />
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-[#E7EAF0] p-3">
                  <p className="text-xs text-[#667085]">Главная информация</p>
                  <p className="mt-1 text-sm font-semibold">{getVariantTitle(selectedVariant)}</p>
                  <p className="mt-1 text-[22px] font-bold">
                    {formatPrice(
                      Number((selectedVariant.salePriceAed ?? selectedVariant.priceAed) || 0),
                    )}
                  </p>
                  <p className="mt-1 text-xs text-[#667085]">
                    Покупка:{' '}
                    {formatPrice(
                      Number((selectedVariant.purchasePriceAed ?? selectedVariant.priceAed) || 0),
                    )}{' '}
                    · Маржа:{' '}
                    {formatPrice(
                      Number(
                        ((selectedVariant.salePriceAed ?? selectedVariant.priceAed) || 0) -
                          ((selectedVariant.purchasePriceAed ?? selectedVariant.priceAed) || 0),
                      ),
                    )}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-xl bg-[#f1f4f8] px-2 py-1 text-[11px] font-semibold">
                      {selectedVariant.origin === 'order' ? 'Из заказа' : 'Без заказа'}
                    </span>
                    {selectedVariant.isPinned && (
                      <span className="rounded-xl bg-[#FEF3C7] px-2 py-1 text-[11px] font-semibold">
                        Закреплён
                      </span>
                    )}
                    {selectedVariant.isFavorite && (
                      <span className="rounded-xl bg-[#FCE7F3] px-2 py-1 text-[11px] font-semibold">
                        Избранное
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#E7EAF0] p-3 text-sm">
                  <p>
                    <span className="text-[#667085]">Телефон:</span>{' '}
                    {selectedVariant.phone || 'Не указан'}
                  </p>
                  <p className="mt-1">
                    <span className="text-[#667085]">Локация:</span>{' '}
                    {selectedVariant.locationText || selectedVariant.location || 'Не указана'}
                  </p>
                  <p className="mt-1">
                    <span className="text-[#667085]">Комментарий:</span>{' '}
                    {selectedVariant.note || 'Комментарий не добавлен'}
                  </p>
                  <p className="mt-1">
                    <span className="text-[#667085]">Авто:</span>{' '}
                    {selectedVariant.vehicleInfo ||
                      selectedVariant.sourceOrderLabel ||
                      'Не указано'}
                  </p>
                  <p className="mt-1">
                    <span className="text-[#667085]">VIN:</span>{' '}
                    {selectedVariant.vin || 'Не указан'}
                  </p>
                  <p className="mt-1">
                    <span className="text-[#667085]">Заказ:</span>{' '}
                    {selectedVariant.customerOrderRef || 'Не указан'}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#E7EAF0] p-3 text-xs text-[#667085]">
                  <p>Создано: {formatDate(selectedVariant.createdAt)}</p>
                  <p className="mt-1">
                    Обновлено: {formatDate(selectedVariant.updatedAt || selectedVariant.createdAt)}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => quickToggle('isFavorite')}
                className={`h-11 rounded-xl border text-xs font-bold active:scale-[0.98] ${selectedVariant.isFavorite ? 'border-pink-300 bg-pink-50 text-pink-700' : 'border-[#E7EAF0] text-[#475467]'}`}
              >
                <span className="inline-flex items-center gap-1">
                  <Heart size={14} />
                  Избранное
                </span>
              </button>
              <button
                type="button"
                onClick={() => quickToggle('isPinned')}
                className={`h-11 rounded-xl border text-xs font-bold active:scale-[0.98] ${selectedVariant.isPinned ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-[#E7EAF0] text-[#475467]'}`}
              >
                <span className="inline-flex items-center gap-1">
                  <Pin size={14} />
                  Закрепить
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleSendVariant(selectedVariant)}
                className="col-span-2 h-11 rounded-xl bg-[#2563EB] text-xs font-bold text-white"
              >
                <span className="inline-flex items-center gap-1">
                  <Send size={14} />
                  Отправить
                </span>
              </button>
            </div>

            {isEditMode && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (await persistVariant(selectedVariant)) setIsEditMode(false);
                  }}
                  className="h-11 rounded-xl bg-emerald-600 text-xs font-bold text-white"
                >
                  <span className="inline-flex items-center gap-1">
                    <Check size={14} />
                    Сохранить
                  </span>
                </button>
                {selectedVariant.origin === 'standalone' ? (
                  <button
                    type="button"
                    onClick={() => {
                      removeStandaloneVariant(selectedVariant.id);
                      setSelectedVariant(null);
                    }}
                    className="h-11 rounded-xl border border-rose-200 text-xs font-bold text-rose-600"
                  >
                    Удалить
                  </button>
                ) : (
                  <div />
                )}
              </div>
            )}
          </div>
        </ModalSurface>
      )}

      {deleteCandidate && (
        <ModalSurface
          label="Удалить вариант"
          onClose={() => setDeleteCandidate(null)}
          className="flex items-center justify-center  px-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <h3 className="text-base font-bold text-[#172333]">Удалить вариант?</h3>
            <p className="mt-2 text-sm text-[#475467]">{getDeleteWarning(deleteCandidate)}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDeleteCandidate(null)}
                className="h-11 rounded-xl border border-[#D0D5DD] text-sm font-semibold text-[#475467]"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  void removeVariantCompletely(deleteCandidate);
                  setDeleteCandidate(null);
                }}
                className="h-11 rounded-xl bg-rose-600 text-sm font-bold text-white"
              >
                Удалить
              </button>
            </div>
          </div>
        </ModalSurface>
      )}

      {gallery && (
        <ImagePreview
          images={gallery.images}
          initialIndex={gallery.index}
          onClose={() => setGallery(null)}
          shareTitle="Фото варианта"
          shareText="Фото варианта детали"
        />
      )}
    </div>
  );
};

export default VariantsScreen;
