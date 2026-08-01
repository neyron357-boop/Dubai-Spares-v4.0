import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { OfferAvailability, OfferCondition, PriceVariant, Supplier } from '../types';
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
  Pencil,
  ChevronRight,
  Check,
  CheckCheck,
  ExternalLink,
  Images,
  Video
} from 'lucide-react';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';
import { resolveCoordinatesFromLocation } from '../mapsLocation';
import { upsertSupplierToShops } from '../radarShops';
import { createUuid } from '../id';
import { optimizeImageForUpload, uploadImageToStorage } from '../storage/photos';
import { cloneVariantForPart, VariantLibraryItem } from '../variantLibraryStore';
import { logger } from '../logging';
import { readClipboardImageFiles } from '../utils/clipboardImages';
import { toast } from '../feedback';
import { isLikelyGoogleDriveUrl, normalizeExternalMediaUrl, openExternalMediaUrl } from '../utils/externalMedia';
import { normalizeGroupItems } from '../utils/groupItems';

interface OfferFormState {
  purchasePriceAed: string;
  salePriceAed: string;
  shopName: string;
  supplierId?: string;
  phone: string;
  locationText: string;
  mapsUrl: string;
  photos: string[];
  condition: OfferCondition;
  availability: OfferAvailability;
  deliveryEta: 'today' | 'tomorrow' | '2_3_days' | 'week';
  isBest: boolean;
  note: string;
}

const DEFAULT_FORM: OfferFormState = {
  purchasePriceAed: '',
  salePriceAed: '',
  shopName: '',
  supplierId: undefined,
  phone: '+971',
  locationText: '',
  mapsUrl: '',
  photos: [],
  condition: 'used',
  availability: 'in_stock',
  deliveryEta: 'today',
  isBest: false,
  note: ''
};

const conditionLabels: Record<OfferCondition, string> = {
  new: 'Новая',
  used: 'Б/у',
  scrapyard: 'Разбор'
};

const availabilityLabels: Record<OfferAvailability, string> = {
  in_stock: 'В наличии',
  '1d': '1 день',
  '2_3d': '2-3 дня',
  by_order: 'Под заказ'
};

const etaLabels: Record<OfferFormState['deliveryEta'], string> = {
  today: 'Сегодня',
  tomorrow: 'Завтра',
  '2_3_days': '2-3 дня',
  week: 'Неделя'
};

const readImageFileAsDataUrl = (file: Blob) => new Promise<string>((resolve) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(String(reader.result || ''));
  reader.readAsDataURL(file);
});

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

const upsertLinkedPart = (entries: any[] = [], entry: any) => {
  const idx = entries.findIndex((item) => item.orderId === entry.orderId && item.partId === entry.partId);
  if (idx === -1) return [entry, ...entries];
  const next = [...entries];
  next[idx] = { ...next[idx], ...entry, id: next[idx].id || entry.id };
  return next;
};

const normalizePhone = (value: string) => value.replace(/[^\d]/g, '');

const createRandomSupplierName = (usedNames: Set<string>) => {
  const prefixes = ['Desert', 'Falcon', 'Turbo', 'Golden', 'Rapid', 'Prime', 'Royal', 'Nova', 'Metro', 'Apex'];
  const suffixes = ['Auto', 'Parts', 'Motors', 'Garage', 'Trading', 'Hub', 'Store', 'Service'];
  for (let i = 0; i < 200; i += 1) {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    const serial = Math.floor(100 + Math.random() * 900);
    const candidate = `${prefix} ${suffix} ${serial}`;
    if (usedNames.has(candidate.toLowerCase())) continue;
    return candidate;
  }
  return `Поставщик ${Date.now()}`;
};

const PartDetailsScreen: React.FC = () => {
  const { orderId, partId } = useParams<{ orderId: string; partId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { orders, updateOrder, suppliers, addSupplier, updateSupplier, variantLibrary } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sampleFileInputRef = useRef<HTMLInputElement>(null);
  const variantsListRef = useRef<HTMLDivElement>(null);
  const formSessionRef = useRef<string | null>(null);
  const generatedSupplierNamesRef = useRef<Set<string>>(new Set());
  const swipeStartRef = useRef<{ x: number; y: number; at: number } | null>(null);

  const order = orders.find((o) => o.id === orderId);
  const part = order?.parts.find((p) => p.id === partId);
  const partVariants = useMemo(() => (Array.isArray(part?.variants) ? part.variants : []), [part?.variants]);
  const groupItems = useMemo(() => normalizeGroupItems((part as any)?.groupItems), [part?.groupItems]);
  const backTo = typeof (location.state as { backTo?: unknown } | null)?.backTo === 'string'
    ? String((location.state as { backTo?: unknown }).backTo)
    : `/order/${orderId}`;
  const requestedVariantId = typeof (location.state as { openVariantId?: unknown } | null)?.openVariantId === 'string'
    ? String((location.state as { openVariantId?: unknown }).openVariantId)
    : '';
  const orderActiveTab = typeof (location.state as { orderActiveTab?: unknown } | null)?.orderActiveTab === 'string'
    ? String((location.state as { orderActiveTab?: unknown }).orderActiveTab)
    : undefined;

  const [isAdding, setIsAdding] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [deleteVariantId, setDeleteVariantId] = useState<string | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [showAfterSaveSheet, setShowAfterSaveSheet] = useState(false);
  const [brokenPhotoUrls, setBrokenPhotoUrls] = useState<Record<string, true>>({});
  const [isEditingPartName, setIsEditingPartName] = useState(false);
  const [partNameDraft, setPartNameDraft] = useState('');
  const [isEditingPartDescription, setIsEditingPartDescription] = useState(false);
  const [partDescriptionDraft, setPartDescriptionDraft] = useState('');
  const [partMediaLinkDraft, setPartMediaLinkDraft] = useState('');
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [showAddOptionsSheet, setShowAddOptionsSheet] = useState(false);
  const [swipeSlide, setSwipeSlide] = useState<'next' | 'prev' | null>(null);

  const [form, setForm] = useState<OfferFormState>(DEFAULT_FORM);
  const [isLocating, setIsLocating] = useState(false);
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [locationParseNotice, setLocationParseNotice] = useState<string | null>(null);

  const isEditing = !!editingVariantId;

  const latestOrderVariant = useMemo<PriceVariant | null>(() => {
    if (!order) return null;
    let latest: PriceVariant | null = null;
    order.parts.forEach((p) => {
      (Array.isArray(p.variants) ? p.variants : []).forEach((v) => {
        if (!latest || v.createdAt > latest.createdAt) latest = v;
      });
    });
    return latest;
  }, [order]);

  const numericPurchasePrice = Number(form.purchasePriceAed.replace(/\s+/g, ''));
  const numericSalePrice = Number((form.salePriceAed || form.purchasePriceAed).replace(/\s+/g, ''));
  const isPurchasePriceValid = Number.isFinite(numericPurchasePrice) && numericPurchasePrice > 0;
  const canSave = isPurchasePriceValid && !!form.shopName.trim();

  const historyPrices = useMemo(() => partVariants.map((v) => Number((v.salePriceAed ?? v.priceAed) || 0)).filter(Boolean), [partVariants]);

  useEffect(() => {
    setPartMediaLinkDraft(String((part as any)?.googleDriveVideoUrl || ''));
  }, [part?.id, (part as any)?.googleDriveVideoUrl]);

  useEffect(() => {
    if (!requestedVariantId) return;
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`variant-${requestedVariantId}`);
      (target || variantsListRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [requestedVariantId, part?.id]);

  useEffect(() => {
    setSwipeSlide(null);
    swipeStartRef.current = null;
  }, [partId]);

  useEffect(() => {
    if (!isAdding) {
      formSessionRef.current = null;
      return;
    }

    const nextSession = isEditing ? `edit:${editingVariantId || ''}` : 'create';
    if (formSessionRef.current === nextSession) return;
    formSessionRef.current = nextSession;

    if (isEditing && part) {
      const editable = partVariants.find((v) => v.id === editingVariantId);
      if (!editable) return;
      setForm({
        purchasePriceAed: String((editable.purchasePriceAed ?? editable.priceAed) || ''),
        salePriceAed: String((editable.salePriceAed ?? editable.priceAed) || ''),
        shopName: editable.shopName || '',
        phone: editable.phone || '+971',
        locationText: editable.locationText || editable.location || '',
        mapsUrl: editable.mapsUrl || '',
        photos: editable.photos || (editable.photoUrl ? [editable.photoUrl] : []),
        condition: editable.condition || 'used',
        availability: editable.availability || 'in_stock',
        deliveryEta: editable.deliveryEta || 'today',
        isBest: part.bestOfferId === editable.id,
        note: editable.note || ''
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
        availability: latestOrderVariant.availability || prev.availability,
        note: ''
      }));
    } else {
      setForm(DEFAULT_FORM);
    }
    setLocationParseNotice(null);
  }, [isAdding, isEditing, part, partVariants, editingVariantId, latestOrderVariant]);

  if (!order || !part) return <div className="p-10 text-center text-gray-400 font-bold">ДЕТАЛЬ НЕ НАЙДЕНА</div>;
  const depositPaid = order.searchDepositStatus === 'paid' || order.paymentStatus === 'search_deposit_paid' || order.paymentStatus === 'full_prepayment_paid';
  const currentPartIndex = order.parts.findIndex((entry) => entry.id === part.id);
  const canSwipeParts = order.parts.length > 1 && currentPartIndex >= 0 && !isAdding && !gallery && !showLibraryPicker && !showAddOptionsSheet;

  const goBack = () => {
    const restoreScrollTop = (location.state as { orderScrollTop?: unknown } | null)?.orderScrollTop;
    const backState = {
      ...(typeof restoreScrollTop === 'number' ? { restoreScrollTop } : {}),
      ...(orderActiveTab ? { restoreActiveTab: orderActiveTab } : {})
    };
    navigate(backTo, { state: backState });
  };

  const goToSiblingPart = (direction: 'next' | 'prev') => {
    if (!canSwipeParts || swipeSlide) return;
    const nextIndex = direction === 'next'
      ? (currentPartIndex + 1) % order.parts.length
      : (currentPartIndex - 1 + order.parts.length) % order.parts.length;
    const nextPart = order.parts[nextIndex];
    if (!nextPart || nextPart.id === part.id) return;

    setSwipeSlide(direction);
    const state: Record<string, unknown> = {
      ...((location.state && typeof location.state === 'object') ? location.state as Record<string, unknown> : {}),
      backTo,
      ...(orderActiveTab ? { orderActiveTab } : {})
    };
    delete state.openVariantId;

    window.setTimeout(() => {
      navigate(`/order/${order.id}/part/${nextPart.id}`, { state });
    }, 120);
  };

  const handleSwipePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canSwipeParts) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    swipeStartRef.current = { x: event.clientX, y: event.clientY, at: Date.now() };
  };

  const handleSwipePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || !canSwipeParts) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const elapsed = Date.now() - start.at;
    const isHorizontalSwipe = Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 1.35 && elapsed < 650;
    if (!isHorizontalSwipe) return;
    event.preventDefault();
    event.stopPropagation();
    goToSiblingPart(dx < 0 ? 'next' : 'prev');
  };

  const isPhotoVisible = (url: string) => !!String(url || '').trim() && !brokenPhotoUrls[url];

  const handleFormPatch = <T extends keyof OfferFormState>(key: T, value: OfferFormState[T]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    void Promise.all(files.map(async (file) => {
      try {
        return await optimizeImageForUpload(file, `part-details:variant:${file.name}`);
      } catch {
        const reader = new FileReader();
        return await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file as Blob);
        });
      }
    })).then((photos) => {
      setForm((prev) => ({ ...prev, photos: [...prev.photos, ...photos.filter(Boolean)] }));
    });
    e.target.value = '';
  };

  const handleVariantPhotosFromClipboard = async () => {
    try {
      const files = await readClipboardImageFiles();
      if (!files.length) {
        alert('В буфере обмена нет изображений');
        return;
      }
      const photos = await Promise.all(files.map(async (file) => {
        try {
          return await optimizeImageForUpload(file, `part-details:variant:clipboard:${file.name}`);
        } catch {
          const reader = new FileReader();
          return await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(file as Blob);
          });
        }
      }));
      setForm((prev) => ({ ...prev, photos: mergeUniqueStrings(prev.photos, photos.filter(Boolean)) }));
    } catch {
      alert('Не удалось получить фото из буфера обмена');
    }
  };

  const removeVariantPhoto = (index: number) => {
    setForm((prev) => ({ ...prev, photos: prev.photos.filter((_, i) => i !== index) }));
  };

  const handleShopSelect = (supplier: any) => {
    setForm((prev) => ({
      ...prev,
      shopName: supplier.name,
      supplierId: supplier.id,
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

  const attachVariantFromLibrary = async (item: VariantLibraryItem) => {
    if (!depositPaid) {
      toast('Сначала подтвердите депозит в заказе.', 'error');
      return;
    }
    const variant = { ...cloneVariantForPart(item, part.id), orderId: order.id };
    const updatedParts = order.parts.map((p) => {
      if (p.id !== part.id) return p;
      return {
        ...p,
        isFound: true,
        status: 'found' as const,
        variants: [variant, ...(Array.isArray(p.variants) ? p.variants : [])]
      };
    });
    const saved = await updateOrder({ ...order, parts: updatedParts });
    if (!saved) {
      toast('Не удалось прикрепить вариант к детали.', 'error');
      return;
    }
    setShowLibraryPicker(false);
    toast('Вариант прикреплён к детали', 'success');
  };

  const saveVariant = async () => {
    if (!depositPaid) {
      alert('Сначала подтвердите депозит в заказе. После этого можно добавлять варианты.');
      return;
    }
    if (!canSave) {
      alert('Введите цену покупки и магазин');
      return;
    }

    setIsResolvingLocation(true);
    try {
      const normalizedShopName = form.shopName.trim().toLowerCase();
      const normalizedFormPhone = normalizePhone(form.phone || '');
      const existingSupplierByPhone = normalizedFormPhone
        ? suppliers.find((supplier) => normalizePhone(supplier.phone || '') === normalizedFormPhone)
        : undefined;
      const existingSupplierByNameOrId = suppliers.find((s) => {
        if (form.supplierId && s.id === form.supplierId) return true;
        return s.name.trim().toLowerCase() === normalizedShopName;
      });
      const existingSupplier = existingSupplierByNameOrId || existingSupplierByPhone;
      const locationSource = form.mapsUrl || form.locationText;
      const resolvedCoordinates = await resolveCoordinatesFromLocation(locationSource, {
        fallbackQueries: buildShopFallbackQueries(),
        onManualLocationRequired: setLocationParseNotice
      });

      let targetSupplierId = existingSupplier?.id;

      if (!existingSupplier) {
        const nextBrandPool = mergeUniqueStrings([], [order.brand]);
        const nextModels = mergeUniqueStrings([], [order.model || '']);
        const nextYears = mergeUniqueYears([], [Number(order.year)]);
        const nextBodyTypes = mergeUniqueStrings([], [order.bodyType || '']);
        const newSupplier: Supplier = {
          id: createUuid(),
          name: form.shopName.trim(),
          phone: form.phone,
          location: form.locationText,
          type: form.condition === 'new' ? 'new_parts' : 'scrapyard',
          brands: nextBrandPool,
          mainBrands: nextBrandPool,
          primaryBrand: nextBrandPool[0] || '',
          models: nextModels,
          years: nextYears,
          bodyTypes: nextBodyTypes,
          activeOrderIds: [order.id],
          linkedParts: [{
            id: createUuid(),
            orderId: order.id,
            orderLabel: `${order.brand} ${order.model} • ${order.vin}`,
            partId: part.id,
            partName: part.name,
            status: 'found' as const,
            source: 'variant',
            priceAed: numericPurchasePrice,
            updatedAt: Date.now()
          }],
          photoUrl: '',
          photos: [],
          coordinates: resolvedCoordinates
        };
        addSupplier(newSupplier);
        void upsertSupplierToShops(newSupplier).catch((error) => {
          void logger.warn('part-details:supplier-sync-failed', 'Supplier cloud sync failed after local save', {
            supplierId: newSupplier.id,
            error: error instanceof Error ? error.message : String(error)
          });
        });
        targetSupplierId = newSupplier.id;
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
          activeOrderIds: Array.from(new Set([...(existingSupplier.activeOrderIds || []), order.id])),
          linkedParts: upsertLinkedPart(existingSupplier.linkedParts || [], {
            id: createUuid(),
            orderId: order.id,
            orderLabel: `${order.brand} ${order.model} • ${order.vin}`,
            partId: part.id,
            partName: part.name,
            status: 'found' as const,
            source: 'variant',
            priceAed: numericPurchasePrice,
            updatedAt: Date.now()
          }),
          photoUrl: existingSupplier.photoUrl || '',
          photos: existingSupplier.photos || [],
          coordinates: existingSupplier.coordinates || resolvedCoordinates
        };
        updateSupplier(updatedSupplier);
        void upsertSupplierToShops(updatedSupplier).catch((error) => {
          void logger.warn('part-details:supplier-sync-failed', 'Supplier cloud sync failed after local update', {
            supplierId: updatedSupplier.id,
            error: error instanceof Error ? error.message : String(error)
          });
        });
        targetSupplierId = updatedSupplier.id;
      }

      const variantId = editingVariantId || createUuid();
      const persistedVariantPhotos = await Promise.all((form.photos || []).map(async (photo, index) => {
        const raw = String(photo || '').trim();
        if (!raw) return '';
        if (!raw.startsWith('data:image')) return raw;
        // Use the same per-variant subfolder that withUploadedPhotos expects,
        // so that cleanupExtraFiles logic stays consistent.
        // The filename pattern (0.jpg, 1.jpg…) must match what withUploadedPhotos generates
        // so that x-upsert overwrites the correct file when re-syncing.
        // uploadImageToStorage compresses internally and stores the result regardless of the
        // .jpg extension label (the actual format depends on browser canvas support).
        const fileName = `${index}.jpg`;
        const uploaded = await uploadImageToStorage(raw, `orders/${order.id}/parts/${part.id}/variants/${variantId}`, fileName);
        await logger.info('part-details:variant-photo-persisted', 'Variant photo persisted', {
          orderId: order.id,
          partId: part.id,
          variantId,
          index,
          storageUrl: uploaded
        });
        return uploaded;
      }));
      const variantPhotos = persistedVariantPhotos.filter(Boolean);
      const resolvedShopName = form.shopName.trim() || existingSupplier?.name || '';
      const newVariant: PriceVariant = {
        id: variantId,
        orderId: order.id,
        partId: part.id,
        priceAed: numericSalePrice || numericPurchasePrice,
        purchasePriceAed: numericPurchasePrice,
        salePriceAed: numericSalePrice || numericPurchasePrice,
        currency: 'AED',
        shopName: resolvedShopName,
        shopId: targetSupplierId,
        shopNameManual: form.shopName.trim(),
        phone: form.phone,
        location: form.locationText,
        locationText: form.locationText,
        mapsUrl: form.mapsUrl,
        lat: resolvedCoordinates?.lat,
        lng: resolvedCoordinates?.lng,
        photos: variantPhotos,
        photoUrl: variantPhotos[0],
        condition: form.condition,
        availability: form.availability,
        deliveryEta: form.deliveryEta,
        isBest: form.isBest,
        syncStatus: navigator.onLine ? 'synced' : 'pending',
        note: form.note.trim(),
        createdAt: editingVariantId ? partVariants.find((v) => v.id === editingVariantId)?.createdAt || Date.now() : Date.now(),
        updatedAt: Date.now()
      };

      const updatedParts = order.parts.map((p) => {
        if (p.id !== partId) return p;
        const currentVariants = Array.isArray(p.variants) ? p.variants : [];
        const exists = currentVariants.some((v) => v.id === variantId);
        const variants = exists
          ? currentVariants.map((v) => (v.id === variantId ? newVariant : v))
          : [newVariant, ...currentVariants];

        const bestOfferId = form.isBest ? variantId : p.bestOfferId === variantId ? undefined : p.bestOfferId;
        return {
          ...p,
          isFound: true,
          status: 'found' as const,
          bestOfferId,
          photoUrl: p.photoUrl || '',
          photos: p.photos || [],
          variants: variants.map((v) => ({ ...v, isBest: form.isBest ? v.id === variantId : v.isBest && v.id !== variantId }))
        };
      });

      const saved = await updateOrder({ ...order, parts: updatedParts });
      if (!saved) {
        toast('Не удалось сохранить вариант. Проверьте ошибку синхронизации и попробуйте ещё раз.', 'error');
        return;
      }
      toast(isEditing ? 'Вариант обновлён' : 'Вариант сохранён', 'success');
      setShowAfterSaveSheet(!editingVariantId);
      closeEditor();
    } catch (error) {
      await logger.error('part-details:variant-save-failed', 'Variant save failed', {
        orderId: order.id,
        partId: part.id,
        error
      });
      toast('Supabase не сохранил вариант. Данные не закрыты, можно повторить сохранение.', 'error');
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
    const photos = [
      ...(Array.isArray(variant.photos) ? variant.photos : []),
      variant.photoUrl
    ]
      .filter((photo): photo is string => typeof photo === 'string')
      .map((photo) => photo.trim())
      .filter(Boolean);

    return Array.from(new Set(photos));
  };

  const openGallery = (e: React.MouseEvent, variant: PriceVariant) => {
    e.stopPropagation();
    const images = getVariantPhotos(variant);
    if (!images.length) return;
    setGallery({ images, index: 0 });
  };

  const filteredSuppliers = suppliers.filter((s) => s.name.toLowerCase().includes(form.shopName.toLowerCase())).slice(0, 5);

  const generateShopName = () => {
    const usedNames = new Set([
      ...suppliers.map((supplier) => supplier.name.toLowerCase()),
      ...orders.flatMap((entry) => entry.parts.flatMap((entryPart) => (Array.isArray(entryPart.variants) ? entryPart.variants : []).map((variant) => variant.shopName.toLowerCase()))),
      ...generatedSupplierNamesRef.current
    ]);
    const name = createRandomSupplierName(usedNames);
    generatedSupplierNamesRef.current.add(name.toLowerCase());
    handleFormPatch('shopName', name);
    handleFormPatch('supplierId', undefined);
  };

  const openRoute = (variant: PriceVariant) => {
    const query = variant.mapsUrl || variant.locationText || variant.location;
    if (!query) return;
    const normalized = query.startsWith('http') ? query : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    window.open(normalized, '_blank');
  };

  const openWhatsapp = (variant: PriceVariant) => {
    const phoneRaw = (variant.phone || '').replace(/[^\d+]/g, '');
    if (!phoneRaw) return;
    const message = `Здравствуйте. Нужна деталь: ${part.name} для ${order.brand} ${order.model} ${order.year}.\nЕсть в наличии? Какая цена и состояние?\nОтправьте, пожалуйста, фото и номер детали.${order.vin ? `\nVIN: ${order.vin}` : ''}`;
    window.open(`https://wa.me/${phoneRaw.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const formatPhone = (value: string) => {
    const cleaned = value.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned;
    if (!cleaned) return '+971';
    return `+${cleaned}`;
  };

  const pasteFromClipboard = async (target: 'purchasePriceAed' | 'salePriceAed' | 'phone' | 'locationText' | 'mapsUrl') => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      if (target === 'phone') handleFormPatch('phone', formatPhone(text));
      else handleFormPatch(target, text as never);
    } catch {
      alert('Буфер обмена недоступен');
    }
  };


  const startEditPartName = () => {
    setPartNameDraft(part.name || '');
    setIsEditingPartName(true);
  };

  const startEditPartDescription = () => {
    setPartDescriptionDraft(String(part.comment || ''));
    setIsEditingPartDescription(true);
  };

  const submitPartDescription = () => {
    const nextDescription = partDescriptionDraft.trim();
    const currentDescription = String(part.comment || '').trim();
    if (nextDescription === currentDescription) {
      setIsEditingPartDescription(false);
      return;
    }
    const updatedParts = order.parts.map((p) => (p.id === part.id ? { ...p, comment: nextDescription } : p));
    updateOrder({ ...order, parts: updatedParts });
    setIsEditingPartDescription(false);
  };

  const savePartMediaLink = (rawValue = partMediaLinkDraft, options?: { showToast?: boolean }) => {
    if (!order || !part) return String(rawValue || '').trim();
    const nextValue = String(rawValue || '').trim();
    const currentValue = String((part as any).googleDriveVideoUrl || '').trim();
    if (nextValue !== currentValue) {
      const updatedParts = order.parts.map((p) => (p.id === part.id ? { ...p, googleDriveVideoUrl: nextValue } : p));
      void updateOrder({ ...order, parts: updatedParts });
      if (options?.showToast) toast(nextValue ? 'Медиа-ссылка сохранена' : 'Медиа-ссылка очищена', 'success');
    }
    return nextValue;
  };

  const checkPartMediaLink = () => {
    const savedUrl = savePartMediaLink(partMediaLinkDraft, { showToast: false });
    const url = normalizeExternalMediaUrl(savedUrl);
    if (!url) {
      toast('Добавьте Google Drive ссылку для детали', 'error');
      return;
    }
    if (!isLikelyGoogleDriveUrl(url)) {
      toast('Нужна ссылка Google Drive: drive.google.com или docs.google.com', 'error');
      return;
    }
    openExternalMediaUrl(url);
    toast('Ссылка открыта. Проверьте доступ: любой по ссылке может просматривать.', 'success');
  };



  const getSamplePhotos = () => {
    if (part.photos && part.photos.length > 0) return part.photos;
    if (part.photoUrl) return [part.photoUrl];
    return [];
  };

  const replaceSamplePhotos = (photos: string[]) => {
    const nextPhotos = mergeUniqueStrings([], photos);
    const updatedParts = order.parts.map((p) => (p.id === part.id ? { ...p, photos: nextPhotos, photoUrl: nextPhotos[0] || '' } : p));
    void updateOrder({ ...order, parts: updatedParts });
  };

  const removeSamplePhoto = (photoIndex: number) => {
    const next = getSamplePhotos().filter((_, index) => index !== photoIndex);
    replaceSamplePhotos(next);
  };

  const handleSamplePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const photoIndex = getSamplePhotos().length;
    Promise.all(files.map(async (file, fileIndex) => {
      try {
        const optimized = await optimizeImageForUpload(file, `part-details:sample:${file.name}`);
        // Use the same "example" folder that orderStore.withUploadedPhotos uses to keep paths consistent
        const fileName = `${photoIndex + fileIndex}.jpg`;
        const uploaded = await uploadImageToStorage(
          optimized,
          `orders/${order.id}/parts/${part.id}/example`,
          fileName
        );
        await logger.info('part-details:sample-photo-persisted', 'Sample photo persisted to cloud storage', {
          orderId: order.id,
          partId: part.id,
          fileName,
          name: file.name,
          storageUrl: uploaded,
          isHttpUrl: uploaded.startsWith('http')
        });
        return uploaded.startsWith('local://') ? optimized : uploaded;
      } catch (err) {
        void logger.warn('part-details:sample-photo-persist-failed', 'Sample photo upload to cloud failed', {
          orderId: order.id,
          partId: part.id,
          name: file.name,
          error: String(err)
        });
        return await readImageFileAsDataUrl(file);
      }
    })).then((photos) => {
      const merged = Array.from(new Set([...(getSamplePhotos() || []), ...photos.filter(Boolean)]));
      void logger.info('part-details:sample-photos-saved', 'Sample photos merged and saved', {
        orderId: order.id,
        partId: part.id,
        totalPhotos: merged.length,
        newPhotos: photos.filter(Boolean).length,
        allHttpUrls: merged.every(u => u.startsWith('http'))
      });
      replaceSamplePhotos(merged);
    }).finally(() => {
      e.target.value = '';
    });
  };

  const handleSamplePhotosFromClipboard = async () => {
    try {
      const files = await readClipboardImageFiles();
      if (!files.length) {
        alert('В буфере обмена нет изображений');
        return;
      }
      const photoIndex = getSamplePhotos().length;
      const photos = await Promise.all(files.map(async (file, fileIndex) => {
        try {
          const optimized = await optimizeImageForUpload(file, `part-details:sample:clipboard:${file.name}`);
          const fileName = `${photoIndex + fileIndex}.jpg`;
          const uploaded = await uploadImageToStorage(
            optimized,
            `orders/${order.id}/parts/${part.id}/example`,
            fileName
          );
          return uploaded.startsWith('local://') ? optimized : uploaded;
        } catch {
          return await readImageFileAsDataUrl(file);
        }
      }));
      const merged = Array.from(new Set([...(getSamplePhotos() || []), ...photos.filter(Boolean)]));
      replaceSamplePhotos(merged);
    } catch {
      alert('Не удалось получить фото из буфера обмена');
    }
  };

  const copyText = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore clipboard errors
    }
  };

  const submitPartName = () => {
    const nextName = partNameDraft.trim();
    if (!nextName || nextName === part.name) {
      setIsEditingPartName(false);
      return;
    }
    const updatedParts = order.parts.map((p) => (p.id === part.id ? { ...p, name: nextName } : p));
    updateOrder({ ...order, parts: updatedParts });
    setIsEditingPartName(false);
  };

  const formatAed = (value: number | undefined) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return '— AED';
    return `${amount.toLocaleString('en-US').replace(/,/g, ' ')} AED`;
  };

  const selectVariantAsBest = (variant: PriceVariant) => {
    const updatedParts = order.parts.map((p) => (
      p.id === part.id
        ? {
          ...p,
          isFound: true,
          status: 'found' as const,
          bestOfferId: variant.id,
          variants: (Array.isArray(p.variants) ? p.variants : []).map((v) => ({ ...v, isBest: v.id === variant.id }))
        }
        : p
    ));
    void updateOrder({ ...order, parts: updatedParts });
    toast('Вариант выбран как лучший', 'success');
  };

  const samplePhotos = getSamplePhotos();
  const variantPhotoPool = partVariants.flatMap((variant) => getVariantPhotos(variant));
  const heroPhotos = Array.from(new Set([...samplePhotos, ...variantPhotoPool].filter(Boolean)));
  const heroPhoto = heroPhotos.find((photo) => isPhotoVisible(photo));
  const heroSamplePhotoIndex = heroPhoto ? samplePhotos.findIndex((photo) => photo === heroPhoto) : -1;
  const sortedVariants = [...partVariants].sort((a, b) => {
    const aBest = part.bestOfferId === a.id || !!a.isBest;
    const bBest = part.bestOfferId === b.id || !!b.isBest;
    if (aBest !== bBest) return aBest ? -1 : 1;
    return Number((a.purchasePriceAed ?? a.priceAed) || 0) - Number((b.purchasePriceAed ?? b.priceAed) || 0);
  });
  const partFound = partVariants.length > 0;
  const photosCountLabel = `${heroPhotos.length || samplePhotos.length || variantPhotoPool.length} фото`;

  return (
    <div className="flex min-h-full flex-col overflow-x-hidden bg-[#F7F9FC] pb-[calc(5.25rem+env(safe-area-inset-bottom))]">
      <div className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <button onClick={goBack} className="-ml-2 grid h-11 w-11 place-items-center rounded-full text-slate-950 transition-colors active:bg-slate-100"><ArrowLeft size={24} /></button>
          <div className="text-center flex-1">
            {isEditingPartName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={partNameDraft}
                  onChange={(e) => setPartNameDraft(e.target.value)}
                  onBlur={submitPartName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitPartName();
                    }
                    if (e.key === 'Escape') setIsEditingPartName(false);
                  }}
                  className="h-10 w-full rounded-xl border border-blue-200 px-3 text-sm font-black text-center"
                />
                <button type="button" onClick={submitPartName} className="rounded-lg bg-blue-600 px-2 py-2 text-white"><Check size={14} /></button>
              </div>
            ) : (
              <button type="button" onClick={startEditPartName} className="mx-auto block max-w-full truncate text-[22px] font-black uppercase leading-7 tracking-tight text-slate-950 hover:text-blue-700">
                {part.name}
              </button>
            )}
            <div className="mt-0.5 flex items-center justify-center gap-2">
              <p className="truncate text-[13px] font-bold text-slate-500">{order.brand} {order.model} · {order.year || '—'}</p>
              <button type="button" onClick={() => void copyText(order.vin || '')} disabled={!order.vin} className="rounded-lg bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700 disabled:opacity-40">VIN</button>
            </div>
          </div>
          <div className="relative">
            <button onClick={() => setShowMenu((prev) => !prev)} className="grid h-11 w-11 place-items-center rounded-full text-slate-950 active:bg-slate-100"><MoreHorizontal size={23} /></button>
            {showMenu && (
              <div className="absolute top-12 right-0 w-56 rounded-2xl bg-white border border-gray-100 shadow-2xl overflow-hidden">
                <button type="button" onClick={() => { variantsListRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowMenu(false); }} className="w-full px-4 py-3 text-left text-sm font-bold hover:bg-gray-50">Показать все варианты</button>
                <button type="button" onClick={() => { alert(historyPrices.length ? `История цен: ${historyPrices.join(', ')} AED` : 'История пока пустая'); setShowMenu(false); }} className="w-full px-4 py-3 text-left text-sm font-bold hover:bg-gray-50">История цен</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        onPointerDown={handleSwipePointerDown}
        onPointerUp={handleSwipePointerUp}
        onPointerCancel={() => { swipeStartRef.current = null; }}
        style={{ touchAction: 'pan-y' }}
        className={`space-y-4 px-4 pt-4 transition-[transform,opacity] duration-150 ease-out will-change-transform ${swipeSlide === 'next' ? '-translate-x-8 opacity-55' : swipeSlide === 'prev' ? 'translate-x-8 opacity-55' : 'translate-x-0 opacity-100'}`}
      >
        {!isAdding ? (
          <>
            <div className="relative aspect-[1.74] w-full overflow-hidden rounded-[24px] bg-slate-200 shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
              <button
                type="button"
                disabled={!heroPhoto}
                onClick={() => heroPhotos.length > 0 && setGallery({ images: heroPhotos, index: 0 })}
                className="absolute inset-0 block h-full w-full text-left disabled:cursor-default"
                aria-label={heroPhoto ? 'Открыть фото детали' : 'Фото детали не добавлено'}
              >
                {heroPhoto ? (
                  <img src={heroPhoto} alt={part.name} className="h-full w-full object-cover" onError={() => setBrokenPhotoUrls((prev) => ({ ...prev, [heroPhoto]: true }))} />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400">
                    <Images size={38} />
                  </div>
                )}
              </button>
              <span className="absolute right-4 top-4 z-10 rounded-2xl bg-slate-950/90 px-3 py-2 text-sm font-black text-white shadow-lg">
                {heroPhotos.length > 0 ? `1 / ${heroPhotos.length}` : '0 / 0'}
              </span>
              {heroPhotos.length > 1 && (
                <span className="absolute inset-x-0 bottom-4 z-10 flex justify-center gap-2">
                  {heroPhotos.slice(0, 6).map((photo, index) => (
                    <span key={`${photo}-${index}`} className={`h-2 w-2 rounded-full ${index === 0 ? 'bg-white' : 'bg-white/45'}`} />
                  ))}
                </span>
              )}
            </div>

            <div className="-mt-1 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => sampleFileInputRef.current?.click()}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-[11px] font-black text-white shadow-sm active:scale-[0.98]"
              >
                <Camera size={14} /> Фото
              </button>
              <button
                type="button"
                onClick={() => void handleSamplePhotosFromClipboard()}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-700 shadow-sm active:scale-[0.98]"
              >
                <ClipboardPaste size={14} /> Вставить
              </button>
              <button
                type="button"
                disabled={heroSamplePhotoIndex < 0}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (heroSamplePhotoIndex >= 0) removeSamplePhoto(heroSamplePhotoIndex);
                }}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-rose-100 bg-white px-3 text-[11px] font-black text-rose-600 shadow-sm active:scale-[0.98] disabled:text-slate-300 disabled:opacity-60"
              >
                <Trash2 size={14} /> Удалить текущее
              </button>
            </div>

            {samplePhotos.length > 0 && (
              <div className="-mt-1 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {samplePhotos.map((photo, index) => {
                  const galleryIndex = Math.max(0, heroPhotos.findIndex((item) => item === photo));
                  return (
                    <div key={`${photo}-${index}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white bg-slate-100 shadow-sm">
                      <button type="button" onClick={() => setGallery({ images: heroPhotos, index: galleryIndex })} className="h-full w-full">
                        {isPhotoVisible(photo)
                          ? <img src={photo} alt={`Фото детали ${index + 1}`} className="h-full w-full object-cover" onError={() => setBrokenPhotoUrls((prev) => ({ ...prev, [photo]: true }))} />
                          : <span className="grid h-full w-full place-items-center text-slate-400"><Images size={18} /></span>}
                      </button>
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          removeSamplePhoto(index);
                        }}
                        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-slate-950/75 text-white shadow-sm"
                        aria-label={`Удалить фото ${index + 1}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <section className="rounded-[24px] border border-white bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.07)]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-base font-black leading-5 text-slate-900">
                    {part.comment || 'Описание детали не добавлено'}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold">
                    <span className="inline-flex items-center gap-2 text-slate-500"><Images size={18} /> {photosCountLabel}</span>
                    <span
                      className={`inline-grid h-8 w-8 place-items-center rounded-full ${partFound ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}
                      aria-label={partFound ? 'Найдено' : 'Не найдено'}
                      title={partFound ? 'Найдено' : 'Не найдено'}
                    >
                      {partFound ? <CheckCheck size={20} strokeWidth={2.6} /> : <Check size={18} strokeWidth={2.3} />}
                    </span>
                  </div>
                </div>
                <button type="button" onClick={startEditPartDescription} className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-blue-700 shadow-sm active:scale-[0.98]">
                  <Pencil size={18} /> Изменить
                </button>
              </div>
              {isEditingPartDescription && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Редактирование описания</p>
                    <button type="button" onClick={() => setIsEditingPartDescription(false)} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-500 active:scale-95" aria-label="Закрыть редактирование описания">
                      <X size={14} />
                    </button>
                  </div>
                  <textarea autoFocus value={partDescriptionDraft} onChange={(e) => setPartDescriptionDraft(e.target.value)} rows={3} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none" placeholder="Добавьте описание детали" />
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setIsEditingPartDescription(false)} className="h-10 rounded-xl bg-slate-100 text-xs font-black text-slate-700">Отмена</button>
                    <button type="button" onClick={submitPartDescription} className="h-10 rounded-xl bg-blue-600 text-xs font-black text-white">Сохранить</button>
                  </div>
                </div>
              )}
            </section>

            <input type="file" ref={sampleFileInputRef} onChange={handleSamplePhotoChange} className="hidden" accept="image/*" multiple />

            <section ref={variantsListRef} className="space-y-3 pt-2">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[19px] font-black uppercase tracking-[0.12em] text-slate-500">Варианты ({partVariants.length})</h2>
              </div>

              {sortedVariants.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-slate-200 bg-white p-7 text-center shadow-sm">
                  <p className="text-sm font-black text-slate-800">Пока нет вариантов</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Добавьте новый или найдите из базы данных.</p>
                </div>
              ) : sortedVariants.map((variant, index) => {
                const displayPhotos = getVariantPhotos(variant);
                const photo = displayPhotos.find((item) => isPhotoVisible(item));
                const isBest = part.bestOfferId === variant.id || !!variant.isBest || index === 0;
                const price = Number((variant.purchasePriceAed ?? variant.priceAed) || 0);
                const locationText = variant.locationText || variant.location || 'Локация не указана';
                return (
                  <article
                    id={`variant-${variant.id}`}
                    key={variant.id}
                    className={`overflow-hidden rounded-[24px] border p-3.5 shadow-[0_14px_40px_rgba(15,23,42,0.06)] ${
                      isBest
                        ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white'
                        : requestedVariantId === variant.id
                          ? 'border-blue-200 bg-white ring-2 ring-blue-100'
                          : 'border-slate-100 bg-white'
                    }`}
                  >
                    {isBest && (
                      <div className="-mx-3.5 -mt-3.5 mb-3 inline-flex items-center gap-2 rounded-br-[24px] bg-emerald-50 px-4 py-2 text-[12px] font-black uppercase tracking-wide text-emerald-700">
                        <Star size={16} fill="currentColor" /> Лучший вариант
                      </div>
                    )}
                    <div className="grid grid-cols-[112px_1fr_auto] gap-3">
                      <button type="button" onClick={(e) => openGallery(e, variant)} className="h-28 w-28 overflow-hidden rounded-2xl bg-slate-100 shadow-inner">
                        {photo ? (
                          <img src={photo} className="h-full w-full object-cover" onError={() => setBrokenPhotoUrls((prev) => ({ ...prev, [photo]: true }))} />
                        ) : (
                          <span className="grid h-full w-full place-items-center text-slate-400"><Images size={24} /></span>
                        )}
                      </button>
                      <div className="min-w-0 py-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[18px] font-black uppercase text-slate-950">{variant.shopName || 'Поставщик'}</p>
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-white"><Check size={13} /></span>
                        </div>
                        <p className="mt-2 flex items-center gap-1.5 truncate text-sm font-semibold text-slate-500"><MapPin size={16} /> {locationText}</p>
                        <span className="mt-2 inline-flex rounded-lg bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">{availabilityLabels[variant.availability || 'in_stock']}</span>
                      </div>
                      <div className="flex min-w-[116px] flex-col items-end py-1">
                        <p className="text-right text-[25px] font-black leading-7 text-slate-950">{formatAed(price)}</p>
                        <p className="mt-2 text-right text-xs font-semibold text-slate-500">{conditionLabels[variant.condition || 'used']}</p>
                        <div className="mt-auto grid w-full gap-2">
                          <button type="button" onClick={() => openWhatsapp(variant)} className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl text-sm font-black ${isBest ? 'bg-emerald-600 text-white shadow-[0_12px_28px_rgba(22,163,74,0.24)]' : 'border border-emerald-100 bg-white text-emerald-700'}`}>
                            <MessageCircle size={17} /> WhatsApp
                          </button>
                          <button type="button" onClick={() => selectVariantAsBest(variant)} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)]">
                            <Plus size={18} /> Добавить
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-1.5">
                      <button type="button" onClick={() => { setIsAdding(true); setEditingVariantId(variant.id); }} className="rounded-xl px-3 py-2 text-xs font-black text-slate-500 active:bg-slate-100">Редактировать</button>
                      <button type="button" onClick={() => setDeleteVariantId(variant.id)} className="rounded-xl px-3 py-2 text-xs font-black text-rose-500 active:bg-rose-50">Удалить</button>
                    </div>
                  </article>
                );
              })}

              <button
                type="button"
                onClick={() => setShowAddOptionsSheet(true)}
                className="flex w-full items-center gap-3 rounded-[20px] border border-dashed border-slate-200 bg-white px-4 py-3 text-left shadow-sm active:scale-[0.99]"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-blue-100 bg-blue-50 text-blue-600"><Plus size={26} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-black text-slate-950">Нет подходящего варианта?</span>
                  <span className="block text-sm font-semibold text-slate-500">Добавьте новый или найдите в базе данных</span>
                </span>
                <ChevronRight size={22} className="text-slate-400" />
              </button>
            </section>

            {!depositPaid && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                Активный поиск и варианты откроются после подтверждения депозита в заказе.
              </div>
            )}
            {latestOrderVariant && (
              <button type="button" onClick={() => setForm((prev) => ({ ...prev, shopName: latestOrderVariant.shopName || '', phone: latestOrderVariant.phone || prev.phone, locationText: latestOrderVariant.locationText || latestOrderVariant.location || '' }))} className="w-full rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">Последний магазин: {latestOrderVariant.shopName}</button>
            )}
          </>
        ) : (
          <form onSubmit={async (e) => { e.preventDefault(); await saveVariant(); }} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.14em] text-gray-400">{isEditing ? 'Правка варианта' : 'Новый вариант'}</p>
                  <h3 className="mt-0.5 text-base font-black text-gray-950">{isEditing ? 'Обновить предложение' : 'Добавить цену поставщика'}</h3>
                </div>
                <button type="button" onClick={closeEditor} className="flex h-8 w-8 items-center justify-center rounded-xl bg-gray-100 text-gray-600"><X size={16} /></button>
              </div>
            </div>

            <div className="space-y-3 p-3">
              <section className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-black text-gray-700">Фото варианта</label>
                  <span className="text-[10px] font-bold text-gray-400">{form.photos.length} фото</span>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 text-gray-500"><Camera size={15} /><span className="mt-0.5 text-[9px] font-black">Фото</span></button>
                  <button type="button" onClick={() => void handleVariantPhotosFromClipboard()} className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500"><ClipboardPaste size={15} /><span className="mt-0.5 text-[9px] font-black">Вставить</span></button>
                  {form.photos.map((photo, index) => (
                    <div key={`${photo}-${index}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                      {isPhotoVisible(photo)
                        ? <img src={photo} className="h-full w-full object-cover" onError={() => setBrokenPhotoUrls((prev) => ({ ...prev, [photo]: true }))} />
                        : <div className="grid h-full w-full place-items-center text-gray-400"><Images size={14} /></div>}
                      <button type="button" onClick={() => removeVariantPhoto(index)} className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white"><X size={11} /></button>
                    </div>
                  ))}
                  <input type="file" ref={fileInputRef} onChange={handlePhotoChange} className="hidden" accept="image/*" multiple />
                </div>
              </section>

              <section className="space-y-1">
                <label className="text-[11px] font-black text-gray-700">Цена покупки, AED</label>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" autoFocus value={form.purchasePriceAed} onChange={(e) => handleFormPatch('purchasePriceAed', e.target.value.replace(/[^\d]/g, ''))} placeholder="200" className="h-11 min-w-0 rounded-xl border border-gray-200 px-3 text-lg font-black text-gray-950 outline-none" />
                  <button type="button" onClick={() => pasteFromClipboard('purchasePriceAed')} className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-gray-600"><ClipboardPaste size={15} /></button>
                </div>
                <p className="text-[10px] font-semibold text-gray-500">Продажа задаётся в финансах заказа.</p>
              </section>

              <section className="space-y-2 rounded-xl bg-gray-50 p-2.5">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wide text-gray-500">Состояние</label>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {(Object.keys(conditionLabels) as OfferCondition[]).map((condition) => (
                      <button key={condition} type="button" onClick={() => handleFormPatch('condition', condition)} className={`h-8 rounded-lg text-[11px] font-black ${form.condition === condition ? 'bg-gray-950 text-white' : 'bg-white text-gray-700'}`}>{conditionLabels[condition]}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wide text-gray-500">Наличие</label>
                    <div className="mt-1.5 grid grid-cols-2 gap-1">
                      {(Object.keys(availabilityLabels) as OfferAvailability[]).map((value) => (
                        <button key={value} type="button" onClick={() => handleFormPatch('availability', value)} className={`h-8 rounded-lg text-[10px] font-bold ${form.availability === value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}>{availabilityLabels[value]}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wide text-gray-500">Срок</label>
                    <div className="mt-1.5 grid grid-cols-2 gap-1">
                      {(Object.keys(etaLabels) as OfferFormState['deliveryEta'][]).map((value) => (
                        <button key={value} type="button" onClick={() => handleFormPatch('deliveryEta', value)} className={`h-8 rounded-lg text-[10px] font-bold ${form.deliveryEta === value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}>{etaLabels[value]}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <div className="relative">
                  <label className="text-[11px] font-black text-gray-700">Магазин</label>
                  <div className="mt-1 grid h-10 grid-cols-[auto_1fr_auto] items-center gap-2 rounded-xl border border-gray-200 px-2.5">
                    <Store size={14} className="text-gray-500" />
                    <input value={form.shopName} onChange={(e) => { handleFormPatch('shopName', e.target.value); handleFormPatch('supplierId', undefined); setShowSuggestions(true); }} className="min-w-0 bg-transparent text-xs font-bold outline-none" placeholder="Поиск или новый магазин" />
                    <button type="button" onClick={generateShopName} className="rounded-lg bg-violet-50 px-2 py-1 text-[9px] font-black text-violet-700">Рандом</button>
                  </div>
                  {showSuggestions && form.shopName && filteredSuppliers.length > 0 && (
                    <div className="absolute left-0 right-0 top-16 z-20 max-h-56 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl">
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
                  <label className="text-[11px] font-black text-gray-700">Телефон</label>
                  <div className="mt-1 grid grid-cols-[1fr_auto_auto_auto] gap-1.5">
                    <div className="flex h-10 min-w-0 items-center gap-2 rounded-xl border border-gray-200 px-2.5">
                      <Phone size={14} className="shrink-0 text-gray-500" />
                      <input value={form.phone} onChange={(e) => handleFormPatch('phone', formatPhone(e.target.value))} className="min-w-0 flex-1 bg-transparent text-xs font-bold outline-none" />
                    </div>
                    <button type="button" onClick={() => pasteFromClipboard('phone')} className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200"><ClipboardPaste size={14} /></button>
                    <button type="button" onClick={() => navigator.clipboard.writeText(form.phone)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200"><Copy size={14} /></button>
                    <button type="button" onClick={() => openWhatsapp({ ...DEFAULT_FORM, ...form, id: 'tmp', priceAed: numericSalePrice, purchasePriceAed: numericPurchasePrice, salePriceAed: numericSalePrice, location: form.locationText, createdAt: Date.now() } as PriceVariant)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><MessageCircle size={14} /></button>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <label className="block">
                  <span className="text-[11px] font-black text-gray-700">Локация</span>
                  <div className="mt-1 grid grid-cols-[1fr_auto] gap-1.5">
                    <div className="flex h-10 min-w-0 items-center gap-2 rounded-xl border border-gray-200 px-2.5">
                      <MapPin size={14} className="shrink-0 text-gray-500" />
                      <input value={form.locationText} onChange={(e) => { handleFormPatch('locationText', e.target.value); setLocationParseNotice(null); }} className="min-w-0 flex-1 bg-transparent text-xs font-bold outline-none" placeholder="Ряд / зона / адрес" />
                    </div>
                    <button type="button" onClick={getCurrentLocation} disabled={isLocating} className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white disabled:opacity-60"><Navigation size={14} className={isLocating ? 'animate-pulse' : ''} /></button>
                  </div>
                </label>
                <div className="grid grid-cols-[1fr_auto] gap-1.5">
                  <input value={form.mapsUrl} onChange={(e) => handleFormPatch('mapsUrl', e.target.value)} className="h-10 min-w-0 rounded-xl border border-gray-200 px-2.5 text-xs font-bold outline-none" placeholder="Google Maps URL" />
                  <button type="button" onClick={() => pasteFromClipboard('mapsUrl')} className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200"><ClipboardPaste size={14} /></button>
                </div>
                {locationParseNotice && <p className="text-xs text-amber-700">{locationParseNotice}</p>}
              </section>

              <section className="space-y-1.5">
                <label className="text-[11px] font-black text-gray-700">Заметка по варианту</label>
                <textarea value={form.note} onChange={(e) => handleFormPatch('note', e.target.value)} rows={2} placeholder="Комментарий для этого варианта" className="w-full rounded-xl border border-gray-200 px-2.5 py-2 text-xs font-semibold outline-none" />
                <button type="button" onClick={() => handleFormPatch('isBest', !form.isBest)} className={`flex h-9 w-full items-center justify-center gap-2 rounded-xl font-black text-xs ${form.isBest ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-gray-100 text-gray-700'}`}><Star size={14} /> Лучший вариант</button>
                {isEditing && <p className="text-xs text-gray-500">Создан: {new Date(partVariants.find((v) => v.id === editingVariantId)?.createdAt || Date.now()).toLocaleString()}</p>}
              </section>
            </div>

            <div className="sticky bottom-0 z-20 border-t border-gray-100 bg-white/95 p-2 shadow-[0_-8px_22px_rgba(15,23,42,0.06)] backdrop-blur">
              <div className="grid grid-cols-[0.8fr_1.2fr] gap-2">
                <button type="button" onClick={closeEditor} className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-700">Отмена</button>
                <button type="submit" disabled={!canSave || isResolvingLocation} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 text-xs font-black text-white disabled:opacity-50">{isResolvingLocation ? <><Loader2 size={13} className="animate-spin" /> Сохранение...</> : isEditing ? 'Сохранить изменения' : 'Сохранить вариант'}</button>
              </div>
              {!canSave && <p className="mt-1 text-[10px] text-gray-500">Введите цену покупки и магазин.</p>}
              {!navigator.onLine && <p className="mt-1 text-[10px] text-amber-700">Нет интернета: вариант будет синхронизирован позже.</p>}
            </div>
          </form>
        )}

      </div>

      {!isAdding && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/80 bg-white/95 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-8px_22px_rgba(15,23,42,0.045)] backdrop-blur-xl">
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={!depositPaid}
              onClick={() => { if (!depositPaid) return; setIsAdding(true); setEditingVariantId(null); }}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 text-sm font-black text-white shadow-[0_8px_20px_rgba(37,99,235,0.2)] active:scale-[0.98] disabled:opacity-45"
            >
              <Plus size={21} /> Добавить вариант
            </button>
            <button
              type="button"
              disabled={!depositPaid}
              onClick={() => setShowLibraryPicker(true)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-950 shadow-sm active:scale-[0.98] disabled:opacity-45"
            >
              <ClipboardPaste size={18} /> Из базы данных
            </button>
          </div>
        </div>
      )}

      {showAddOptionsSheet && (
        <div className="fixed inset-0 z-[120] flex items-end bg-black/35 backdrop-blur-sm" onClick={() => setShowAddOptionsSheet(false)}>
          <div className="w-full rounded-t-[28px] bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200" />
            <div className="space-y-2">
              <button type="button" disabled={!depositPaid} onClick={() => { setShowAddOptionsSheet(false); if (!depositPaid) return; setIsAdding(true); setEditingVariantId(null); }} className="flex h-14 w-full items-center gap-3 rounded-2xl bg-blue-600 px-4 text-left text-sm font-black text-white disabled:opacity-45">
                <Plus size={22} /> Добавить новый вариант
              </button>
              <button type="button" disabled={!depositPaid} onClick={() => { setShowAddOptionsSheet(false); setShowLibraryPicker(true); }} className="flex h-14 w-full items-center gap-3 rounded-2xl border border-slate-200 px-4 text-left text-sm font-black text-slate-900 disabled:opacity-45">
                <ClipboardPaste size={20} /> Найти из базы
              </button>
              <button type="button" onClick={() => { setShowAddOptionsSheet(false); navigate('/database'); }} className="flex h-14 w-full items-center gap-3 rounded-2xl border border-slate-200 px-4 text-left text-sm font-black text-slate-900">
                <Store size={20} /> Добавить поставщика
              </button>
            </div>
          </div>
        </div>
      )}

      {showAfterSaveSheet && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-end" onClick={() => setShowAfterSaveSheet(false)}>
          <div className="w-full bg-white rounded-t-3xl p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-black text-gray-900">✅ Вариант добавлен</p>
            <button type="button" onClick={() => {
              const newest = partVariants[0];
              if (!newest) return;
              const updatedParts = order.parts.map((p) => p.id === part.id ? { ...p, bestOfferId: newest.id } : p);
              updateOrder({ ...order, parts: updatedParts });
              setShowAfterSaveSheet(false);
            }} className="w-full h-11 rounded-xl border border-gray-200 text-sm font-bold">Сделать лучшим</button>
            <button type="button" onClick={() => { if (partVariants[0]) openWhatsapp(partVariants[0]); }} className="w-full h-11 rounded-xl border border-gray-200 text-sm font-bold">Открыть WhatsApp магазина</button>
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


      {showLibraryPicker && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-4 shadow-2xl max-h-[82dvh] overflow-y-auto space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black">Выбрать вариант</h3>
              <button type="button" onClick={() => setShowLibraryPicker(false)} className="p-2 rounded-lg hover:bg-gray-100"><X size={16} /></button>
            </div>
            {(variantLibrary as VariantLibraryItem[]).filter((item) => item.sourcePartId !== part.id).slice(0, 60).map((item) => (
              <button type="button" key={`${item.origin}-${item.id}-${item.sourceOrderId || 'n'}`} onClick={() => attachVariantFromLibrary(item)} className="w-full text-left p-3 rounded-xl border border-gray-200">
                <p className="text-sm font-bold text-gray-900">{item.shopName || 'Без названия'} · {Number((item.purchasePriceAed ?? item.priceAed) || 0)} AED</p>
                <p className="text-xs text-gray-500">{item.origin === 'standalone' ? 'Отдельный вариант' : `Из заказа: ${item.sourceOrderLabel || '—'}`}</p>
              </button>
            ))}
          </div>
        </div>
      )}
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
