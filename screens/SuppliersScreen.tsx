import { ModalSurface } from '../components/ui';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  Gem,
  Heart,
  Loader2,
  LocateFixed,
  ArrowDownUp,
  X,
  MoreHorizontal,
  Phone,
  SlidersHorizontal,
  Sparkles,
  Store,
  UserPlus,
  Wrench,
} from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useVisibleViewport } from '../hooks/useVisibleViewport';
import { CAR_DATABASE } from '../carDatabase';
import ConfirmModal from '../components/ConfirmModal';
import ImagePreview from '../components/ImagePreview';
import { SearchField } from '../components/ui';
import SupplierCard from '../components/SupplierCard';
import SupplierActions from '../components/SupplierActions';
import SafeImage from '../components/SafeImage';
import SupplierFilterDialog, {
  SupplierSortDialog,
  type SupplierFilterValue,
} from '../components/SupplierFilterDialog';
import {
  getSupplierContacts,
  getSupplierLocationLabel,
  matchesSupplierQuery,
  normalizeSupplierPhone,
  sortSupplierDirectory,
  type SupplierDirectorySort,
} from '../utils/supplierPresentation';
import '../styles/suppliers-directory.css';
import { toast } from '../feedback';
import { playSound } from '../utils/sounds';
import { createUuid } from '../id';
import { resolveCoordinatesFromLocation } from '../mapsLocation';
import { getOrderState } from '../orderStore';
import { getRadarManualSelections, saveRadarManualSelections } from '../radarManualSelections';
import { optimizeLocalImage } from '../storage/photos';
import {
  exportData,
  refreshLocalSuppliers,
  SupplierDeletionBlockedError,
  useStore,
} from '../store';
import { Supplier, SupplierLinkedPartEntry, SupplierType } from '../types';

const FIELD_TYPES: Array<{ value: SupplierType; label: string; icon: React.ReactNode }> = [
  { value: 'new_parts', label: 'Новые детали', icon: <Gem size={12} /> },
  { value: 'scrapyard', label: 'Разбор', icon: <Wrench size={12} /> },
  { value: 'engine_specialist', label: 'Двигатели', icon: <Wrench size={12} /> },
  { value: 'body_parts', label: 'Кузов', icon: <Wrench size={12} /> },
  { value: 'electrical', label: 'Электрика', icon: <Sparkles size={12} /> },
  { value: 'mixed', label: 'Смешанный', icon: <Store size={12} /> },
  { value: 'dealer', label: 'Дилер', icon: <Store size={12} /> },
  { value: 'warehouse', label: 'Склад', icon: <Store size={12} /> },
];

const FIELD_TYPE_RU_LABELS: Record<SupplierType, string> = {
  new_parts: 'Новые детали',
  scrapyard: 'Разбор',
  engine_specialist: 'Двигатели',
  body_parts: 'Кузов',
  electrical: 'Электрика',
  mixed: 'Смешанный',
  dealer: 'Дилер',
  warehouse: 'Склад',
};

const ZONE_GEOFENCES = [
  { name: 'Sajaa', bounds: { minLat: 25.29, maxLat: 25.37, minLng: 55.48, maxLng: 55.58 } },
  { name: 'Ras Al Khor', bounds: { minLat: 25.16, maxLat: 25.21, minLng: 55.34, maxLng: 55.4 } },
  { name: 'Al Qusais', bounds: { minLat: 25.24, maxLat: 25.29, minLng: 55.37, maxLng: 55.44 } },
  {
    name: 'Sharjah Industrial',
    bounds: { minLat: 25.26, maxLat: 25.34, minLng: 55.39, maxLng: 55.47 },
  },
];

const SUPPLIER_PART_CATEGORIES = [
  'ДВС / Двигатели',
  'АКПП / МКПП',
  'Механические детали',
  'Кузовные детали',
  'Электрика / Электроника',
  'Подвеска / Ходовая',
  'Салон / Интерьер',
  'Оптика / Освещение',
];

const normalizePhone = normalizeSupplierPhone;

const isValidE164 = (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone);

const mergeUniqueStrings = (current: string[] = [], incoming: string[] = []) => {
  const seen = new Set(current.map((item) => item.trim().toLowerCase()).filter(Boolean));
  const next = [...current];
  incoming.forEach((item) => {
    const normalized = item.trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    next.push(normalized);
  });
  return next;
};

const mergeUniqueYears = (current: number[] = [], incoming: number[] = []) => {
  const seen = new Set(current.filter((item) => Number.isFinite(item)).map((item) => Number(item)));
  const next = [...seen];
  incoming.forEach((item) => {
    const normalized = Number(item);
    if (!Number.isFinite(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    next.push(normalized);
  });
  return next.sort((a, b) => a - b);
};

const daysAgoLabel = (ts?: number) => {
  if (!ts || !Number.isFinite(ts)) return 'нет контактов';
  const diff = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return 'сегодня';
  if (diff === 1) return '1 день назад';
  return `${diff} дней назад`;
};

const pickSupplierBrands = (supplier: Supplier) => {
  const main = Array.isArray(supplier.mainBrands) ? supplier.mainBrands.filter(Boolean) : [];
  const fallback = Array.isArray(supplier.brands) ? supplier.brands.filter(Boolean) : [];
  return main.length > 0 ? main : fallback;
};

const normalizeSupplierYears = (years: unknown): number[] => {
  const parsed = Array.isArray(years) ? years : typeof years === 'string' ? years.split(',') : [];

  const normalized = parsed
    .map((year) => Number(typeof year === 'string' ? year.trim() : year))
    .filter((year) => Number.isFinite(year));

  return Array.from(new Set(normalized)).sort((a, b) => a - b);
};

const upsertLinkedPartEntry = (
  entries: SupplierLinkedPartEntry[] = [],
  entry: SupplierLinkedPartEntry,
): SupplierLinkedPartEntry[] => {
  const index = entries.findIndex(
    (item) => item.orderId === entry.orderId && item.partId === entry.partId,
  );
  if (index === -1) return [entry, ...entries];
  const next = [...entries];
  next[index] = { ...next[index], ...entry, id: next[index].id || entry.id };
  return next;
};

const inferZoneFromCoords = (coords?: { lat: number; lng: number }) => {
  if (!coords) return '';
  const matched = ZONE_GEOFENCES.find(
    (zone) =>
      coords.lat >= zone.bounds.minLat &&
      coords.lat <= zone.bounds.maxLat &&
      coords.lng >= zone.bounds.minLng &&
      coords.lng <= zone.bounds.maxLng,
  );
  return matched?.name || '';
};

function useSupplierFieldVisibility(viewport: { height: number; offsetTop: number }) {
  const editorFieldsRef = useRef<HTMLDivElement>(null);
  const contactFieldsRef = useRef<HTMLDivElement>(null);
  const profileFieldsRef = useRef<HTMLDivElement>(null);
  const pendingFrameRef = useRef<number | null>(null);

  const revealFocusedControl = useCallback(() => {
    const focused = document.activeElement;
    if (
      !(focused instanceof HTMLElement) ||
      !focused.matches('input:not([type="file"]), select, textarea, [contenteditable="true"]')
    )
      return;

    const container = [
      editorFieldsRef.current,
      contactFieldsRef.current,
      profileFieldsRef.current,
    ].find((element) => element?.contains(focused));
    if (!container) return;

    const bounds = container.getBoundingClientRect();
    const stickyHeader = container.querySelector<HTMLElement>('[data-supplier-profile-header]');
    const visibleTop = Math.max(
      bounds.top + 4,
      stickyHeader ? stickyHeader.getBoundingClientRect().bottom + 4 : bounds.top + 4,
    );
    const visibleBottom = bounds.bottom - 4;
    const control = focused.getBoundingClientRect();
    // WebKit can reveal only the caret. Keep the entire control clear of the sheet footer/header.
    if (control.top < visibleTop) {
      container.scrollTop += control.top - visibleTop;
    } else if (control.bottom > visibleBottom) {
      container.scrollTop += control.bottom - visibleBottom;
    }
  }, []);

  const scheduleFocusVisibility = useCallback(() => {
    if (pendingFrameRef.current !== null) cancelAnimationFrame(pendingFrameRef.current);
    pendingFrameRef.current = requestAnimationFrame(() => {
      revealFocusedControl();
      // Allow native focus scrolling and the viewport frame to settle before the final correction.
      pendingFrameRef.current = requestAnimationFrame(() => {
        pendingFrameRef.current = null;
        revealFocusedControl();
      });
    });
  }, [revealFocusedControl]);

  useLayoutEffect(() => {
    scheduleFocusVisibility();
    return () => {
      if (pendingFrameRef.current !== null) cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    };
  }, [scheduleFocusVisibility, viewport.height, viewport.offsetTop]);

  return { editorFieldsRef, contactFieldsRef, profileFieldsRef, scheduleFocusVisibility };
}

const SuppliersScreen: React.FC = () => {
  const visibleViewport = useVisibleViewport();
  const { editorFieldsRef, contactFieldsRef, profileFieldsRef, scheduleFocusVisibility } =
    useSupplierFieldVisibility(visibleViewport);
  const { suppliers, addSupplier, deleteSupplier, orders, updateOrder, updateSupplier } =
    useStore();
  const locationRoute = useLocation();

  const [isAdding, setIsAdding] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const quickPhotoInputRef = useRef<HTMLInputElement>(null);
  const [deleteSupplierId, setDeleteSupplierId] = useState<string | null>(null);
  const [quickPhotoSupplierId, setQuickPhotoSupplierId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [shopType, setShopType] = useState<SupplierType>('new_parts');
  const [shopTypes, setShopTypes] = useState<SupplierType[]>(['new_parts']);
  const [zone, setZone] = useState('');
  const [mainBrands, setMainBrands] = useState<string[]>([]);
  const [primaryBrand, setPrimaryBrand] = useState('');
  const [brandSearch, setBrandSearch] = useState('');
  const [customBrand, setCustomBrand] = useState('');
  const [isFastBrandMode, setIsFastBrandMode] = useState(true);
  const [supplierModelsInput, setSupplierModelsInput] = useState('');
  const [supplierYearsInput, setSupplierYearsInput] = useState('');
  const [supplierPhotos, setSupplierPhotos] = useState<string[]>([]);
  const [isProcessingSupplierPhotos, setIsProcessingSupplierPhotos] = useState(false);
  const supplierPhotoRequestRef = useRef(0);
  const [mainPartCategories, setMainPartCategories] = useState<string[]>([]);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);

  const [workingHours, setWorkingHours] = useState('');
  const [trustLevel, setTrustLevel] = useState(3);
  const [hasDelivery, setHasDelivery] = useState(false);
  const [whatsappFast, setWhatsappFast] = useState(false);
  const [comment, setComment] = useState('');
  const [website, setWebsite] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | undefined>(undefined);

  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const isSavingSupplierRef = useRef(false);
  const supplierDraftIdRef = useRef<string | null>(null);
  const [supplierSaveError, setSupplierSaveError] = useState<string | null>(null);
  const [supplierActionError, setSupplierActionError] = useState<string | null>(null);
  const [isDeletingSupplier, setIsDeletingSupplier] = useState(false);
  const isDeletingSupplierRef = useRef(false);
  const [isSavingSupplierLink, setIsSavingSupplierLink] = useState(false);
  const isSavingSupplierLinkRef = useRef(false);
  const suppliersRef = useRef(suppliers);
  suppliersRef.current = suppliers;
  const [locationParseNotice, setLocationParseNotice] = useState<string | null>(null);
  const [, setActiveOrderLinkShopId] = useState<string | null>(null);
  const [selectedOrderBySupplier, setSelectedOrderBySupplier] = useState<Record<string, string>>(
    {},
  );
  const [fullscreenOrderSearch, setFullscreenOrderSearch] = useState('');
  const [isFullscreenOrderLinkOpen, setIsFullscreenOrderLinkOpen] = useState(false);
  const [pendingOrderRemoval, setPendingOrderRemoval] = useState<{
    supplierId: string;
    orderId: string;
  } | null>(null);
  const [supplierSearchQuery, setSupplierSearchQuery] = useState('');
  const [isInitialSuppliersLoading, setIsInitialSuppliersLoading] = useState(true);

  const [contactEditorSupplierId, setContactEditorSupplierId] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [isSavingContact, setIsSavingContact] = useState(false);
  const isSavingContactRef = useRef(false);
  const [contactSaveError, setContactSaveError] = useState<string | null>(null);
  const [sortByExtended, setSortByExtended] = useState<SupplierDirectorySort>('smart');
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [zoneFilter, setZoneFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [fullscreenSupplierId, setFullscreenSupplierId] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState('all');
  const [partCategoryFilter, setPartCategoryFilter] = useState('all');
  const [favoriteFilter, setFavoriteFilter] = useState<'all' | 'favorites'>('all');
  const [fastWhatsappFilter, setFastWhatsappFilter] = useState<'all' | 'fast'>('all');
  const [visitTodayFilter, setVisitTodayFilter] = useState<'all' | 'visit_today'>('all');
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [actionModalSupplierId, setActionModalSupplierId] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const activeOrders = useMemo(
    () => orders.filter((order) => !order.isArchived && !order.isSold),
    [orders],
  );

  useEffect(() => {
    const params = new URLSearchParams(locationRoute.search);
    const supplierId = params.get('supplierId');
    if (!supplierId) return;
    const hasSupplier = suppliers.some((supplier) => supplier.id === supplierId);
    if (!hasSupplier) return;
    const el = document.getElementById(`supplier-card-${supplierId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [locationRoute.search, suppliers]);

  const brandOptions = useMemo(
    () => Object.keys(CAR_DATABASE).sort((a, b) => a.localeCompare(b)),
    [],
  );

  const existingByName = useMemo(
    () =>
      suppliers
        .filter((supplier) => supplier.id !== editingSupplierId)
        .map((supplier) => supplier.name.trim().toLowerCase()),
    [suppliers, editingSupplierId],
  );
  const nameNormalized = name.trim().toLowerCase();
  const duplicateWarning = useMemo(() => {
    if (!nameNormalized) return '';
    const close = existingByName.find(
      (value) => value.includes(nameNormalized) || nameNormalized.includes(value),
    );
    return close ? `Похожий поставщик уже есть: ${close}` : '';
  }, [existingByName, nameNormalized]);

  const currentPhone = normalizePhone(phone);
  const hasWhatsapp = isValidE164(currentPhone);

  const filteredBrandOptions = useMemo(
    () => brandOptions.filter((brand) => brand.toLowerCase().includes(brandSearch.toLowerCase())),
    [brandOptions, brandSearch],
  );

  const rawSuppliers = useMemo(
    () => Array.from(new Map(suppliers.map((supplier) => [supplier.id, supplier])).values()),
    [suppliers],
  );

  const supplierFilterOptions = useMemo(() => {
    const brands = new Set<string>();
    const models = new Set<string>();
    const years = new Set<string>();
    const partCategories = new Set<string>();
    const zones = new Set<string>();
    const modelsByBrand: Record<string, Set<string>> = {};

    rawSuppliers.forEach((supplier) => {
      if (supplier.zone?.trim()) zones.add(supplier.zone.trim());
      pickSupplierBrands(supplier).forEach((brand) => {
        if (brand) {
          brands.add(brand);
          modelsByBrand[brand] ||= new Set();
          (supplier.models || []).forEach((model) => modelsByBrand[brand].add(model));
        }
      });
      (supplier.models || []).forEach((model) => {
        if (model) models.add(model);
      });
      normalizeSupplierYears(supplier.years).forEach((year) => {
        years.add(String(year));
      });
      (supplier.mainPartCategories || []).forEach((category) => {
        if (category) partCategories.add(category);
      });
    });

    return {
      zones: Array.from(zones).sort((a, b) => a.localeCompare(b)),
      modelsByBrand: Object.fromEntries(
        Object.entries(modelsByBrand).map(([brand, models]) => [
          brand,
          Array.from(models).sort((a, b) => a.localeCompare(b)),
        ]),
      ),
      brands: Array.from(brands).sort((a, b) => a.localeCompare(b)),
      models: Array.from(models).sort((a, b) => a.localeCompare(b)),
      years: Array.from(years).sort((a, b) => Number(b) - Number(a)),
      partCategories: Array.from(new Set([...SUPPLIER_PART_CATEGORIES, ...partCategories])).sort(
        (a, b) => a.localeCompare(b),
      ),
    };
  }, [rawSuppliers]);

  const filteredSuppliers = useMemo(
    () =>
      sortSupplierDirectory(
        rawSuppliers.filter(
          (supplier) =>
            (brandFilter === 'all' || pickSupplierBrands(supplier).includes(brandFilter)) &&
            (modelFilter === 'all' || (supplier.models || []).includes(modelFilter)) &&
            (yearFilter === 'all' ||
              normalizeSupplierYears(supplier.years).includes(Number(yearFilter))) &&
            (partCategoryFilter === 'all' ||
              (supplier.mainPartCategories || []).includes(partCategoryFilter)) &&
            (zoneFilter === 'all' || supplier.zone === zoneFilter) &&
            (favoriteFilter === 'all' || supplier.isFavorite === true) &&
            (fastWhatsappFilter === 'all' ||
              (supplier.whatsappFast === true && !!getSupplierContacts(supplier).whatsapp)) &&
            (visitTodayFilter === 'all' ||
              ((supplier.supplierStatus === 'contacted' ||
                supplier.supplierStatus === 'responded') &&
                !supplier.lastVisitedAt)),
        ),
        sortByExtended,
      ),
    [
      rawSuppliers,
      brandFilter,
      modelFilter,
      yearFilter,
      partCategoryFilter,
      zoneFilter,
      favoriteFilter,
      fastWhatsappFilter,
      visitTodayFilter,
      sortByExtended,
    ],
  );
  const displayedSuppliers = useMemo(
    () =>
      filteredSuppliers.filter((supplier) => matchesSupplierQuery(supplier, supplierSearchQuery)),
    [filteredSuppliers, supplierSearchQuery],
  );
  const favoriteCount = rawSuppliers.filter((supplier) => supplier.isFavorite).length;
  const filterValue: SupplierFilterValue = {
    brand: brandFilter,
    model: modelFilter,
    year: yearFilter,
    category: partCategoryFilter,
    zone: zoneFilter,
    fast: fastWhatsappFilter === 'fast',
    unvisited: visitTodayFilter === 'visit_today',
  };
  const activeFilterChips = [
    {
      label: brandFilter,
      active: brandFilter !== 'all',
      clear: () => {
        setBrandFilter('all');
        setModelFilter('all');
      },
    },
    { label: modelFilter, active: modelFilter !== 'all', clear: () => setModelFilter('all') },
    { label: yearFilter, active: yearFilter !== 'all', clear: () => setYearFilter('all') },
    {
      label: partCategoryFilter,
      active: partCategoryFilter !== 'all',
      clear: () => setPartCategoryFilter('all'),
    },
    { label: zoneFilter, active: zoneFilter !== 'all', clear: () => setZoneFilter('all') },
    {
      label: 'Быстрый ответ',
      active: fastWhatsappFilter === 'fast',
      clear: () => setFastWhatsappFilter('all'),
    },
    {
      label: 'Без визита',
      active: visitTodayFilter === 'visit_today',
      clear: () => setVisitTodayFilter('all'),
    },
  ].filter((item) => item.active);
  const activeSupplierFilterCount = activeFilterChips.length;
  const hasDirectoryQuery =
    activeSupplierFilterCount > 0 || favoriteFilter !== 'all' || !!supplierSearchQuery.trim();
  const resetSupplierFilters = useCallback(() => {
    setBrandFilter('all');
    setModelFilter('all');
    setYearFilter('all');
    setPartCategoryFilter('all');
    setZoneFilter('all');
    setFastWhatsappFilter('all');
    setVisitTodayFilter('all');
    setFavoriteFilter('all');
    setSupplierSearchQuery('');
  }, []);
  const applySupplierFilters = (value: SupplierFilterValue) => {
    setBrandFilter(value.brand);
    setModelFilter(value.model);
    setYearFilter(value.year);
    setPartCategoryFilter(value.category);
    setZoneFilter(value.zone);
    setFastWhatsappFilter(value.fast ? 'fast' : 'all');
    setVisitTodayFilter(value.unvisited ? 'visit_today' : 'all');
    setIsFiltersOpen(false);
    clearSupplierSelection();
  };

  const toggleSupplierSelection = (supplierId: string) => {
    setSelectedSupplierIds((prev) =>
      prev.includes(supplierId) ? prev.filter((id) => id !== supplierId) : [...prev, supplierId],
    );
  };

  const clearSupplierSelection = () => {
    setSelectedSupplierIds([]);
    setIsSelectionMode(false);
  };

  const openSupplierActions = (supplierId: string) => {
    setSupplierActionError(null);
    setActionModalSupplierId(supplierId);
  };
  const fullscreenSupplier = useMemo(
    () => rawSuppliers.find((supplier) => supplier.id === fullscreenSupplierId) || null,
    [rawSuppliers, fullscreenSupplierId],
  );

  const fullscreenSupplierOrders = useMemo(() => {
    if (!fullscreenSupplier) return [] as typeof activeOrders;
    const linkedOrderIds = new Set<string>();
    (fullscreenSupplier.activeOrderIds || []).forEach((orderId) => {
      if (orderId) linkedOrderIds.add(orderId);
    });
    (fullscreenSupplier.linkedParts || []).forEach((entry) => {
      if (entry.orderId) linkedOrderIds.add(entry.orderId);
    });

    return Array.from(linkedOrderIds)
      .map((orderId) => activeOrders.find((order) => order.id === orderId))
      .filter((order): order is (typeof activeOrders)[number] => !!order);
  }, [activeOrders, fullscreenSupplier]);

  const fullscreenOrderOptions = useMemo(() => {
    const query = fullscreenOrderSearch.trim().toLowerCase();
    const uniqueOrders = Array.from(
      new Map(activeOrders.map((order) => [order.id, order])).values(),
    );
    if (!query) return uniqueOrders;
    return uniqueOrders.filter((order) =>
      `${order.brand} ${order.model} ${order.vin}`.toLowerCase().includes(query),
    );
  }, [activeOrders, fullscreenOrderSearch]);

  const openExternalLink = (url: string) => {
    const normalized = String(url || '').trim();
    if (!normalized) return false;
    try {
      const parsed = new URL(normalized);
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      const opened = window.open(parsed.toString(), '_blank');
      return !!opened;
    } catch {
      return false;
    }
  };

  const openSupplierContact = (supplier: Supplier) => {
    setContactSaveError(null);
    setContactPhone(supplier.phone || '');
    setContactWhatsapp(supplier.whatsapp || '');
    setContactEditorSupplierId(supplier.id);
  };
  const openWhatsApp = (supplier: Supplier, message?: string) => {
    const contact = getSupplierContacts(supplier).whatsapp;
    if (!contact) {
      openSupplierContact(supplier);
      return;
    }
    const targetUrl = `https://wa.me/${contact.slice(1)}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
    if (!openExternalLink(targetUrl))
      toast('Не удалось открыть WhatsApp. Проверьте блокировку всплывающих окон.', 'error');
  };
  const openPhone = (supplier: Supplier) => {
    const contact = getSupplierContacts(supplier).phone;
    if (!contact) {
      openSupplierContact(supplier);
      return;
    }
    try {
      window.open(`tel:${contact}`, '_self');
    } catch {
      toast('Не удалось открыть номер телефона.', 'error');
    }
  };

  const startEditSupplier = (supplier: Supplier) => {
    supplierPhotoRequestRef.current += 1;
    setIsProcessingSupplierPhotos(false);
    setSupplierSaveError(null);
    supplierDraftIdRef.current = supplier.id;
    setIsAdding(true);
    setEditingSupplierId(supplier.id);
    setName(supplier.name);
    setPhone(supplier.phone);
    setLocation(supplier.location);
    setShopType(supplier.type || 'new_parts');
    setShopTypes(
      (supplier.types && supplier.types.length > 0
        ? supplier.types
        : [supplier.type || 'new_parts']) as SupplierType[],
    );
    setZone(supplier.zone || '');
    setMainBrands(supplier.mainBrands || supplier.brands || []);
    setPrimaryBrand(supplier.primaryBrand || '');
    setCoords(supplier.coordinates);
    setGpsAccuracy(supplier.gpsAccuracyMeters || null);
    setSupplierModelsInput((supplier.models || []).join(', '));
    setSupplierYearsInput(normalizeSupplierYears(supplier.years).join(', '));
    setSupplierPhotos(supplier.photos || (supplier.photoUrl ? [supplier.photoUrl] : []));
    setMainPartCategories(supplier.mainPartCategories || []);
    setWorkingHours(supplier.workingHours || '');
    setTrustLevel(Number.isFinite(Number(supplier.trustLevel)) ? Number(supplier.trustLevel) : 3);
    setHasDelivery(!!supplier.hasDelivery);
    setWhatsappFast(!!supplier.whatsappFast);
    setComment(supplier.comment || '');
    setWebsite(supplier.website || '');
  };

  const openQuickPhotoPicker = (supplierId: string) => {
    setQuickPhotoSupplierId(supplierId);
    quickPhotoInputRef.current?.click();
  };

  const handleQuickPhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const targetSupplierId = quickPhotoSupplierId;
    event.target.value = '';
    if (!targetSupplierId || files.length === 0) return;
    const targetSupplier = suppliers.find((supplier) => supplier.id === targetSupplierId);
    if (!targetSupplier) {
      setQuickPhotoSupplierId(null);
      return;
    }
    try {
      setSupplierActionError(null);
      const optimized = await Promise.all(
        files
          .slice(0, 4)
          .map(async (file) => optimizeLocalImage(file, `suppliers:quick-photo:${file.name}`)),
      );
      const current = suppliersRef.current.find((supplier) => supplier.id === targetSupplierId);
      if (!current) {
        setSupplierActionError('Поставщик был удалён. Фото не добавлено.');
        return;
      }
      const nextPhotos = [
        ...(current.photos || (current.photoUrl ? [current.photoUrl] : [])),
        ...optimized,
      ].filter(Boolean);
      updateSupplier({
        ...current,
        photos: nextPhotos,
        photoUrl: nextPhotos[0] || current.photoUrl,
        updatedAt: Date.now(),
      });
      toast('Фото поставщика сохранено', 'success');
    } catch (error) {
      console.error('quick_photo_upload_failed', error);
      setSupplierActionError(
        'Не удалось добавить фото. Проверьте свободное место на устройстве и повторите.',
      );
      toast('Не удалось добавить фото', 'error');
    } finally {
      setQuickPhotoSupplierId(null);
    }
  };

  const buildSupplierFallbackQueries = () => {
    const queries = new Set<string>();

    if (name.trim()) {
      queries.add(name.trim());
      queries.add(`${name.trim()} Dubai`);
      queries.add(`${name.trim()} Sharjah`);
    }

    if (location.trim() && name.trim()) {
      queries.add(`${name.trim()} ${location.trim()}`.trim());
    }

    return Array.from(queries);
  };

  const toggleMainBrand = (brand: string) => {
    setMainBrands((prev) =>
      prev.includes(brand) ? prev.filter((item) => item !== brand) : [...prev, brand],
    );
  };

  const toggleShopType = (type: SupplierType) => {
    setShopTypes((prev) => {
      if (prev.includes(type)) {
        const next = prev.filter((item) => item !== type);
        return next.length > 0 ? next : [type];
      }
      return [...prev, type];
    });
    setShopType(type);
  };

  const toggleMainPartCategory = (category: string) => {
    setMainPartCategories((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category],
    );
  };

  const importFromSimilar = () => {
    const query = name.trim().toLowerCase();
    if (!query) return;
    const similar = suppliers.find(
      (supplier) =>
        supplier.name.toLowerCase().includes(query) || query.includes(supplier.name.toLowerCase()),
    );
    if (!similar) return;
    setMainBrands(similar.mainBrands || similar.brands || []);
    setPrimaryBrand(similar.primaryBrand || (similar.mainBrands || [])[0] || '');
  };

  const addCustomBrand = () => {
    const normalized = customBrand.trim();
    if (!normalized) return;
    if (!mainBrands.includes(normalized)) setMainBrands((prev) => [...prev, normalized]);
    if (!primaryBrand) setPrimaryBrand(normalized);
    setCustomBrand('');
  };

  const autofillLocationFromGps = () => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${nextCoords.lat},${nextCoords.lng}`;
        setCoords(nextCoords);
        setGpsAccuracy(Math.round(pos.coords.accuracy));
        if (!location.trim()) {
          setLocation(mapsUrl);
        }
        const inferredZone = inferZoneFromCoords(nextCoords);
        if (!zone && inferredZone) setZone(inferredZone);
      },
      () => {
        setLocationParseNotice('GPS недоступен. Вставьте ссылку Google Maps вручную.');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const resetAddForm = () => {
    supplierPhotoRequestRef.current += 1;
    setIsProcessingSupplierPhotos(false);
    setSupplierSaveError(null);
    supplierDraftIdRef.current = null;
    setEditingSupplierId(null);
    setName('');
    setPhone('');
    setLocation('');
    setMainBrands([]);
    setPrimaryBrand('');
    setSupplierModelsInput('');
    setSupplierYearsInput('');
    setSupplierPhotos([]);
    setMainPartCategories([]);
    setShopType('new_parts');
    setShopTypes(['new_parts']);
    setZone('');
    setLocationParseNotice(null);
    setCoords(undefined);
    setGpsAccuracy(null);
    setWorkingHours('');
    setTrustLevel(3);
    setHasDelivery(false);
    setWhatsappFast(false);
    setComment('');
    setWebsite('');
    setShowAdvanced(false);
  };

  const onSupplierPhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0 || isProcessingSupplierPhotos) {
      event.target.value = '';
      return;
    }
    const requestId = ++supplierPhotoRequestRef.current;
    setIsProcessingSupplierPhotos(true);
    void Promise.all(
      files.map(async (file) => {
        try {
          return await optimizeLocalImage(file, `suppliers:photo:${file.name}`);
        } catch {
          const reader = new FileReader();
          return await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
          });
        }
      }),
    )
      .then((images) => {
        if (requestId !== supplierPhotoRequestRef.current) return;
        setSupplierPhotos((prev) => [...prev, ...images.filter(Boolean)].filter(Boolean));
        if (images.some((image) => !image))
          setSupplierSaveError('Одно из фото не удалось прочитать. Выберите его повторно.');
      })
      .catch(() => {
        if (requestId === supplierPhotoRequestRef.current)
          setSupplierSaveError('Не удалось подготовить фото. Выберите файл повторно.');
      })
      .finally(() => {
        if (requestId === supplierPhotoRequestRef.current) setIsProcessingSupplierPhotos(false);
      });
    event.target.value = '';
  };

  const removeSupplierPhoto = (index: number) => {
    setSupplierPhotos((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSave = async () => {
    if (isSavingSupplierRef.current) return;
    if (isProcessingSupplierPhotos) {
      setSupplierSaveError('Подождите, пока фотографии будут подготовлены.');
      return;
    }
    const normalizedName = name.trim();
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedName) {
      setSupplierSaveError('Укажите название поставщика.');
      return;
    }
    if (phone.trim() && !isValidE164(normalizedPhone)) {
      setSupplierSaveError(
        'Укажите телефон с кодом страны, например +971501234567, или оставьте поле пустым.',
      );
      return;
    }

    supplierDraftIdRef.current ??= createUuid();
    isSavingSupplierRef.current = true;
    setSupplierSaveError(null);
    setIsSavingSupplier(true);
    try {
      const resolvedCoordinates =
        coords ||
        (location.trim()
          ? await resolveCoordinatesFromLocation(location, {
              fallbackQueries: buildSupplierFallbackQueries(),
              onManualLocationRequired: () =>
                setLocationParseNotice(
                  'Координаты не найдены в ссылке. Расположение можно сохранить без них.',
                ),
            })
          : undefined);

      const inferredZone = zone || inferZoneFromCoords(resolvedCoordinates || undefined);

      const parsedModels = supplierModelsInput
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const parsedYears = supplierYearsInput
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map(Number)
        .filter((year) => Number.isFinite(year));
      const now = Date.now();
      const existingSupplier = editingSupplierId
        ? suppliersRef.current.find((supplier) => supplier.id === editingSupplierId)
        : null;
      if (editingSupplierId && !existingSupplier) {
        setSupplierSaveError('Поставщик был удалён. Закройте форму и обновите список.');
        return;
      }
      const supplierPayload: Supplier = {
        ...existingSupplier,
        id: existingSupplier?.id || supplierDraftIdRef.current,
        name: normalizedName,
        phone: normalizedPhone,
        location: location.trim(),
        type: shopType,
        types: shopTypes,
        zone: inferredZone,
        heatLevel: existingSupplier?.heatLevel ?? 0,
        brands: mainBrands,
        mainBrands,
        primaryBrand: primaryBrand || mainBrands[0] || '',
        models: parsedModels,
        years: parsedYears,
        bodyTypes: existingSupplier?.bodyTypes || [],
        mainPartCategories,
        photoUrl: supplierPhotos[0],
        photos: supplierPhotos,
        coordinates: resolvedCoordinates,
        gpsAccuracyMeters: gpsAccuracy || undefined,
        workingHours,
        trustLevel,
        hasDelivery,
        hasWhatsapp: existingSupplier?.hasWhatsapp ?? hasWhatsapp,
        whatsappFast,
        comment,
        website,
        foundCount: existingSupplier?.foundCount || 0,
        notFoundCount: existingSupplier?.notFoundCount || 0,
        wrongInfoCount: existingSupplier?.wrongInfoCount || 0,
        successRate: existingSupplier?.successRate || 0,
        activityScore: existingSupplier?.activityScore || 0,
        lastContactAt: existingSupplier?.lastContactAt || 0,
        isFavorite: existingSupplier?.isFavorite === true,
        createdAt: existingSupplier?.createdAt || now,
        updatedAt: now,
        syncStatus: 'synced',
      };

      if (existingSupplier) updateSupplier(supplierPayload);
      else addSupplier(supplierPayload);
      playSound('success');

      resetAddForm();
      setIsAdding(false);
    } catch {
      setSupplierSaveError(
        'Не удалось сохранить поставщика. Данные остались в форме — освободите место на устройстве и повторите.',
      );
    } finally {
      isSavingSupplierRef.current = false;
      setIsSavingSupplier(false);
    }
  };

  const openMap = (loc: string) => {
    if (!loc) return;
    const targetUrl = loc.startsWith('http')
      ? loc
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`;
    const opened = openExternalLink(targetUrl);
    if (!opened)
      toast('Не удалось открыть карту. Проверьте ссылку и блокировку всплывающих окон.', 'error');
  };

  const confirmDeleteSupplier = async () => {
    if (!deleteSupplierId || deleteSupplierId === '__bulk__' || isDeletingSupplierRef.current)
      return;
    const targetId = deleteSupplierId;
    isDeletingSupplierRef.current = true;
    setIsDeletingSupplier(true);
    setSupplierActionError(null);
    try {
      await deleteSupplier(targetId);
      setSelectedSupplierIds((prev) => prev.filter((id) => id !== targetId));
      if (fullscreenSupplierId === targetId) setFullscreenSupplierId(null);
      setDeleteSupplierId(null);
      playSound('delete');
    } catch (error) {
      setSupplierActionError(
        error instanceof SupplierDeletionBlockedError
          ? error.message
          : 'Не удалось удалить поставщика. Повторите после освобождения места на устройстве.',
      );
    } finally {
      isDeletingSupplierRef.current = false;
      setIsDeletingSupplier(false);
    }
  };

  const confirmBulkDeleteSuppliers = async () => {
    if (selectedSupplierIds.length === 0 || isDeletingSupplierRef.current) return;
    isDeletingSupplierRef.current = true;
    setIsDeletingSupplier(true);
    setSupplierActionError(null);
    const remainingIds = [...selectedSupplierIds];
    try {
      for (const supplierId of selectedSupplierIds) {
        await deleteSupplier(supplierId);
        remainingIds.splice(remainingIds.indexOf(supplierId), 1);
        setSelectedSupplierIds([...remainingIds]);
        if (fullscreenSupplierId === supplierId) setFullscreenSupplierId(null);
      }
      setDeleteSupplierId(null);
      clearSupplierSelection();
      playSound('delete');
    } catch (error) {
      setSupplierActionError(
        error instanceof SupplierDeletionBlockedError
          ? `${error.message} Неудалённые карточки остаются выбранными.`
          : 'Не удалось удалить всех поставщиков. Неудалённые карточки остаются выбранными — повторите действие.',
      );
    } finally {
      isDeletingSupplierRef.current = false;
      setIsDeletingSupplier(false);
    }
  };

  const toggleFavorite = (supplier: Supplier) => {
    setSupplierActionError(null);
    const current = suppliersRef.current.find((item) => item.id === supplier.id);
    if (!current) return false;
    try {
      updateSupplier({ ...current, isFavorite: !current.isFavorite, updatedAt: Date.now() });
      playSound('tap');
      return true;
    } catch {
      setSupplierActionError(
        'Не удалось изменить избранное. Освободите место на устройстве и повторите.',
      );
      return false;
    }
  };

  const togglePinned = (supplier: Supplier) => {
    setSupplierActionError(null);
    const current = suppliersRef.current.find((item) => item.id === supplier.id);
    if (!current) return false;
    try {
      updateSupplier({ ...current, isPinned: !current.isPinned, updatedAt: Date.now() });
      playSound('tap');
      return true;
    } catch {
      setSupplierActionError(
        'Не удалось закрепить поставщика. Освободите место на устройстве и повторите.',
      );
      return false;
    }
  };

  const addSupplierToOrder = async (
    shopId: string,
    orderId: string,
    selectedPartIds: string[] = [],
  ): Promise<boolean> => {
    if (isSavingSupplierLinkRef.current) return false;
    const order = getOrderState().orders.find((item) => item.id === orderId);
    const supplier = exportData().suppliers.find((item) => item.id === shopId);
    if (!order || !supplier) {
      setSupplierActionError('Заказ или поставщик был удалён. Обновите список.');
      return false;
    }
    isSavingSupplierLinkRef.current = true;
    setIsSavingSupplierLink(true);
    setSupplierActionError(null);
    const supplierPhone = (supplier.whatsapp || supplier.phone || '').replace(/\D/g, '');
    const hasVendorContact = (order.vendorContacts || []).some((contact) => {
      const contactPhone = (contact.whatsapp || contact.phone || '').replace(/\D/g, '');
      return (
        contact.name.trim().toLowerCase() === supplier.name.trim().toLowerCase() ||
        (!!supplierPhone && supplierPhone === contactPhone)
      );
    });
    const addedContact = !hasVendorContact
      ? {
          id: createUuid(),
          name: supplier.name,
          phone: supplier.phone || '',
          whatsapp: getSupplierContacts(supplier).whatsapp || '',
          mapUrl: supplier.location || '',
          note: supplier.comment || '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      : null;
    let orderSaved = false;
    let supplierBeforeSave: Supplier | null = null;
    let supplierSaved = false;
    try {
      const saved = await updateOrder({
        ...order,
        vendorContacts: addedContact
          ? [addedContact, ...(order.vendorContacts || [])]
          : order.vendorContacts,
        recommendedShopIds: Array.from(new Set([...(order.recommendedShopIds || []), shopId])),
        dismissedShopIds: (order.dismissedShopIds || []).filter((id) => id !== shopId),
        updatedAt: Date.now(),
      });
      if (!saved) {
        setSupplierActionError(
          getOrderState().error ||
            'Не удалось сохранить связь с заказом. Выбор сохранён — повторите действие.',
        );
        return false;
      }
      orderSaved = true;
      const currentOrder = getOrderState().orders.find((item) => item.id === orderId);
      const currentSupplier = exportData().suppliers.find((item) => item.id === shopId);
      if (!currentOrder || !currentSupplier)
        throw new Error('Supplier or order removed during save');
      const requestedPartIds =
        selectedPartIds.length > 0
          ? selectedPartIds
          : currentOrder.parts[0]
            ? [currentOrder.parts[0].id]
            : [];
      const partIds = [...new Set(requestedPartIds)].filter((partId) =>
        currentOrder.parts.some((part) => part.id === partId),
      );
      const linkedParts = partIds.reduce(
        (entries, partId) => {
          const part = currentOrder.parts.find((item) => item.id === partId)!;
          const existing = entries.find(
            (entry) => entry.orderId === orderId && entry.partId === partId,
          );
          return upsertLinkedPartEntry(entries, {
            id: existing?.id || createUuid(),
            orderId,
            orderLabel: [currentOrder.brand, currentOrder.model, currentOrder.vin]
              .filter(Boolean)
              .join(' · '),
            partId,
            partName: part.name,
            status: existing?.status || 'searching',
            priceAed: existing?.priceAed,
            source: existing?.source || 'manual',
            updatedAt: Date.now(),
          });
        },
        [...(currentSupplier.linkedParts || [])],
      );
      const brands = mergeUniqueStrings(
        currentSupplier.mainBrands || currentSupplier.brands || [],
        [currentOrder.brand],
      );
      supplierBeforeSave = currentSupplier;
      updateSupplier({
        ...currentSupplier,
        mainBrands: brands,
        brands,
        primaryBrand: currentSupplier.primaryBrand || currentOrder.brand,
        models: mergeUniqueStrings(currentSupplier.models || [], [currentOrder.model || '']),
        years: mergeUniqueYears(
          normalizeSupplierYears(currentSupplier.years),
          [Number(currentOrder.year)].filter((year) => year > 0),
        ),
        activeOrderIds: [...new Set([...(currentSupplier.activeOrderIds || []), orderId])],
        linkedParts,
        updatedAt: Date.now(),
      });
      supplierSaved = true;
      saveRadarManualSelections([
        ...getRadarManualSelections(),
        ...partIds.map((partId) => ({
          supplierId: shopId,
          orderId,
          partId,
          source: 'manual' as const,
          createdAt: Date.now(),
        })),
      ]);
      setActiveOrderLinkShopId(null);
      return true;
    } catch {
      let rollbackComplete = true;
      if (supplierSaved && supplierBeforeSave) {
        try {
          const latestSupplier = exportData().suppliers.find((item) => item.id === shopId);
          if (latestSupplier)
            updateSupplier({
              ...latestSupplier,
              activeOrderIds: supplierBeforeSave.activeOrderIds,
              linkedParts: supplierBeforeSave.linkedParts,
              mainBrands: supplierBeforeSave.mainBrands,
              brands: supplierBeforeSave.brands,
              primaryBrand: supplierBeforeSave.primaryBrand,
              models: supplierBeforeSave.models,
              years: supplierBeforeSave.years,
            });
        } catch {
          rollbackComplete = false;
        }
      }
      if (orderSaved) {
        const latestOrder = getOrderState().orders.find((item) => item.id === orderId);
        if (latestOrder) {
          try {
            rollbackComplete =
              (await updateOrder({
                ...latestOrder,
                vendorContacts: addedContact
                  ? (latestOrder.vendorContacts || []).filter(
                      (contact) => contact.id !== addedContact.id,
                    )
                  : latestOrder.vendorContacts,
                recommendedShopIds: (order.recommendedShopIds || []).includes(shopId)
                  ? latestOrder.recommendedShopIds
                  : (latestOrder.recommendedShopIds || []).filter((id) => id !== shopId),
                dismissedShopIds: (order.dismissedShopIds || []).includes(shopId)
                  ? [...new Set([...(latestOrder.dismissedShopIds || []), shopId])]
                  : latestOrder.dismissedShopIds,
              })) && rollbackComplete;
          } catch {
            rollbackComplete = false;
          }
        }
      }
      setSupplierActionError(
        rollbackComplete
          ? 'Не удалось сохранить связь. Выбор сохранён — освободите место на устройстве и повторите.'
          : 'Связь сохранилась частично. Освободите место на устройстве и повторите привязку, чтобы завершить сохранение.',
      );
      return false;
    } finally {
      isSavingSupplierLinkRef.current = false;
      setIsSavingSupplierLink(false);
    }
  };

  const removeSupplierFromOrder = async (supplier: Supplier, orderId: string): Promise<boolean> => {
    if (isSavingSupplierLinkRef.current) return false;
    const order = getOrderState().orders.find((item) => item.id === orderId);
    const currentSupplier = exportData().suppliers.find((item) => item.id === supplier.id);
    if (!order || !currentSupplier) {
      setSupplierActionError('Заказ или поставщик был удалён. Обновите список.');
      return false;
    }
    isSavingSupplierLinkRef.current = true;
    setIsSavingSupplierLink(true);
    setSupplierActionError(null);
    const supplierPhone = (currentSupplier.whatsapp || currentSupplier.phone || '').replace(
      /\D/g,
      '',
    );
    const removedContacts = (order.vendorContacts || []).filter((contact) => {
      const contactPhone = (contact.whatsapp || contact.phone || '').replace(/\D/g, '');
      return (
        contact.name.trim().toLowerCase() === currentSupplier.name.trim().toLowerCase() ||
        (!!supplierPhone && supplierPhone === contactPhone)
      );
    });
    const removedContactIds = new Set(removedContacts.map((contact) => contact.id));
    let orderSaved = false;
    let supplierBeforeSave: Supplier | null = null;
    let supplierSaved = false;
    try {
      const saved = await updateOrder({
        ...order,
        vendorContacts: (order.vendorContacts || []).filter(
          (contact) => !removedContactIds.has(contact.id),
        ),
        recommendedShopIds: (order.recommendedShopIds || []).filter((id) => id !== supplier.id),
        updatedAt: Date.now(),
      });
      if (!saved) {
        setSupplierActionError(
          getOrderState().error || 'Не удалось убрать поставщика из заказа. Повторите действие.',
        );
        return false;
      }
      orderSaved = true;
      const latestSupplier = exportData().suppliers.find((item) => item.id === supplier.id);
      if (!latestSupplier) throw new Error('Supplier removed during save');
      supplierBeforeSave = latestSupplier;
      updateSupplier({
        ...latestSupplier,
        linkedParts: (latestSupplier.linkedParts || []).filter(
          (entry) => entry.orderId !== orderId,
        ),
        activeOrderIds: (latestSupplier.activeOrderIds || []).filter((id) => id !== orderId),
        updatedAt: Date.now(),
      });
      supplierSaved = true;
      saveRadarManualSelections(
        getRadarManualSelections().filter(
          (entry) => !(entry.supplierId === supplier.id && entry.orderId === orderId),
        ),
      );
      return true;
    } catch {
      let rollbackComplete = true;
      if (supplierSaved && supplierBeforeSave) {
        try {
          const latestSupplier = exportData().suppliers.find((item) => item.id === supplier.id);
          if (latestSupplier)
            updateSupplier({
              ...latestSupplier,
              linkedParts: supplierBeforeSave.linkedParts,
              activeOrderIds: supplierBeforeSave.activeOrderIds,
            });
        } catch {
          rollbackComplete = false;
        }
      }
      if (orderSaved) {
        const latestOrder = getOrderState().orders.find((item) => item.id === orderId);
        if (latestOrder) {
          try {
            const contactIds = new Set(
              (latestOrder.vendorContacts || []).map((contact) => contact.id),
            );
            rollbackComplete =
              (await updateOrder({
                ...latestOrder,
                vendorContacts: [
                  ...(latestOrder.vendorContacts || []),
                  ...removedContacts.filter((contact) => !contactIds.has(contact.id)),
                ],
                recommendedShopIds: (order.recommendedShopIds || []).includes(supplier.id)
                  ? [...new Set([...(latestOrder.recommendedShopIds || []), supplier.id])]
                  : latestOrder.recommendedShopIds,
              })) && rollbackComplete;
          } catch {
            rollbackComplete = false;
          }
        }
      }
      setSupplierActionError(
        rollbackComplete
          ? 'Не удалось убрать связь с заказом. Освободите место на устройстве и повторите.'
          : 'Удаление связи сохранилось частично. Освободите место на устройстве и повторите действие, чтобы завершить сохранение.',
      );
      return false;
    } finally {
      isSavingSupplierLinkRef.current = false;
      setIsSavingSupplierLink(false);
    }
  };

  useEffect(() => {
    void refreshLocalSuppliers(true);
  }, []);

  useEffect(() => {
    setIsInitialSuppliersLoading(false);
  }, []);

  const saveSupplierContact = async () => {
    if (!contactEditorSupplierId || isSavingContactRef.current) return;
    setContactSaveError(null);
    const normalizedPhone = normalizePhone(contactPhone);
    if (contactPhone.trim() && !isValidE164(normalizedPhone)) {
      setContactSaveError('Укажите телефон с кодом страны, например +971501234567.');
      return;
    }
    const normalizedWhatsapp = normalizePhone(contactWhatsapp);
    if (contactWhatsapp.trim() && !isValidE164(normalizedWhatsapp)) {
      setContactSaveError('Укажите корректный номер WhatsApp с кодом страны.');
      return;
    }
    if (!normalizedPhone && !normalizedWhatsapp) {
      setContactSaveError('Укажите телефон или WhatsApp с кодом страны.');
      return;
    }
    isSavingContactRef.current = true;
    setIsSavingContact(true);
    try {
      const target = exportData().suppliers.find((item) => item.id === contactEditorSupplierId);
      if (!target) {
        setContactSaveError('Поставщик был удалён. Закройте окно и обновите список.');
        return;
      }
      updateSupplier({
        ...target,
        phone: normalizedPhone,
        whatsapp: normalizedWhatsapp || (target.hasWhatsapp !== false ? normalizedPhone : ''),
        hasWhatsapp: !!normalizedWhatsapp || (target.hasWhatsapp !== false && !!normalizedPhone),
        updatedAt: Date.now(),
      });
      setContactEditorSupplierId(null);
      toast('Контакт сохранён', 'success');
    } catch (error) {
      console.error(error);
      setContactSaveError(
        'Не удалось сохранить контакт. Данные остались в форме — освободите место на устройстве и повторите.',
      );
    } finally {
      isSavingContactRef.current = false;
      setIsSavingContact(false);
    }
  };

  const actionSupplier = rawSuppliers.find((supplier) => supplier.id === actionModalSupplierId);
  const requiredReady = !!name.trim() && (!phone.trim() || isValidE164(currentPhone));

  useEffect(() => {
    setIsFullscreenOrderLinkOpen(false);
    setFullscreenOrderSearch('');
  }, [fullscreenSupplierId]);

  return (
    <div className="ui-page supplier-directory">
      <header className="supplier-directory-header">
        <div>
          <p className="supplier-directory-eyebrow">Контакты и предложения</p>
          <h1>Поставщики</h1>
          <p className="supplier-directory-description">
            Магазины, специализации и история общения.
          </p>
        </div>
        <button
          type="button"
          className="supplier-directory-add"
          aria-label="Добавить поставщика"
          onClick={() => {
            resetAddForm();
            setIsAdding(true);
          }}
        >
          <UserPlus size={18} />
          <span>Добавить</span>
        </button>
      </header>
      <section className="supplier-directory-tools" aria-label="Поиск и разделы поставщиков">
        <div className="supplier-directory-search-row">
          <SearchField
            label="Поиск поставщиков"
            value={supplierSearchQuery}
            onChange={setSupplierSearchQuery}
            placeholder="Название, район, марка или телефон"
          />
          <button
            type="button"
            className={`supplier-directory-filter-button ${activeSupplierFilterCount ? 'is-active' : ''}`}
            aria-label="Фильтры поставщиков"
            onClick={() => setIsFiltersOpen(true)}
          >
            <SlidersHorizontal size={19} />
            {activeSupplierFilterCount > 0 && <span>{activeSupplierFilterCount}</span>}
          </button>
        </div>
        <div className="supplier-directory-tabs" aria-label="Список поставщиков">
          <button
            type="button"
            aria-label="Все поставщики"
            aria-pressed={favoriteFilter === 'all'}
            onClick={() => {
              if (favoriteFilter !== 'all') playSound('navigate');
              setFavoriteFilter('all');
              clearSupplierSelection();
            }}
          >
            Все<span>{rawSuppliers.length}</span>
          </button>
          <button
            type="button"
            aria-label="Избранные поставщики"
            aria-pressed={favoriteFilter === 'favorites'}
            onClick={() => {
              if (favoriteFilter !== 'favorites') playSound('navigate');
              setFavoriteFilter('favorites');
              clearSupplierSelection();
            }}
          >
            <Heart size={14} />
            Избранные<span>{favoriteCount}</span>
          </button>
        </div>
      </section>
      {activeFilterChips.length > 0 && (
        <div className="supplier-directory-chips" aria-label="Применённые фильтры">
          {activeFilterChips.map((item, index) => (
            <button
              type="button"
              key={`${item.label}-${index}`}
              onClick={item.clear}
              aria-label={`Убрать фильтр: ${item.label}`}
            >
              {item.label}
              <X size={13} />
            </button>
          ))}
          <button type="button" className="is-reset" onClick={resetSupplierFilters}>
            Сбросить фильтры
          </button>
        </div>
      )}
      <div className="supplier-directory-results">
        <p role="status">
          {hasDirectoryQuery
            ? `Найдено: ${displayedSuppliers.length}`
            : `В базе: ${rawSuppliers.length}`}
        </p>
        <div>
          <button
            type="button"
            aria-label="Сортировка поставщиков"
            onClick={() => setIsSortOpen(true)}
          >
            <ArrowDownUp size={15} />
            <span>
              {sortByExtended === 'name'
                ? 'По названию'
                : sortByExtended === 'recent'
                  ? 'Недавние'
                  : sortByExtended === 'fast'
                    ? 'Быстрый ответ'
                    : 'Закреплённые'}
            </span>
          </button>
          <button
            type="button"
            disabled={isDeletingSupplier}
            aria-label={isSelectionMode ? 'Отменить выбор поставщиков' : 'Выбрать поставщиков'}
            onClick={() => {
              if (isSelectionMode) clearSupplierSelection();
              else setIsSelectionMode(true);
            }}
            aria-pressed={isSelectionMode}
          >
            <CheckCircle2 size={18} />
          </button>
        </div>
      </div>
      {isSelectionMode && (
        <div className="supplier-directory-selection">
          <p>Выбрано: {selectedSupplierIds.length}</p>
          <button type="button" disabled={isDeletingSupplier} onClick={clearSupplierSelection}>
            Отмена выбора
          </button>
          <button
            type="button"
            disabled={!selectedSupplierIds.length || isDeletingSupplier}
            onClick={() => {
              setSupplierActionError(null);
              setDeleteSupplierId('__bulk__');
            }}
            className="is-danger"
          >
            Удалить
          </button>
        </div>
      )}
      {supplierActionError && (
        <p className="supplier-directory-error" role="alert">
          {supplierActionError}
        </p>
      )}
      {isFiltersOpen && (
        <SupplierFilterDialog
          value={filterValue}
          options={{ ...supplierFilterOptions, categories: supplierFilterOptions.partCategories }}
          onApply={applySupplierFilters}
          onClose={() => setIsFiltersOpen(false)}
        />
      )}
      {isSortOpen && (
        <SupplierSortDialog
          value={sortByExtended}
          onChange={(value) => {
            setSortByExtended(value);
            setIsSortOpen(false);
          }}
          onClose={() => setIsSortOpen(false)}
        />
      )}

      {isAdding && (
        <ModalSurface
          label="Поставщик"
          onClose={() => {
            if (isSavingSupplierRef.current) return;
            setIsAdding(false);
            resetAddForm();
          }}
          className="ui-sheet-layer"
        >
          <div
            className={`supplier-editor-frame ${visibleViewport.height < 480 ? 'is-compact' : ''}`}
            style={{ top: visibleViewport.offsetTop, height: visibleViewport.height }}
            onClick={(event) => {
              if (event.target === event.currentTarget && !isSavingSupplierRef.current) {
                setIsAdding(false);
                resetAddForm();
              }
            }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSave();
              }}
              className="supplier-editor-panel flex max-h-[92dvh] w-full max-w-[460px] flex-col overflow-hidden rounded-t-[32px] bg-[#F5F7FB] shadow-[0_28px_80px_rgba(15,23,42,0.28)] ring-1 ring-white/70 sm:rounded-[32px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 border-b border-slate-200/70 bg-white px-4 pb-4 pt-3">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">
                      {editingSupplierId ? 'Редактирование' : 'Новый контакт'}
                    </p>
                    <h2 className="mt-1 truncate text-[24px] font-bold leading-7 text-slate-950">
                      {editingSupplierId ? 'Поставщик' : 'Добавить поставщика'}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (isSavingSupplierRef.current) return;
                      setIsAdding(false);
                      resetAddForm();
                    }}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-100 text-xl font-bold text-slate-500 shadow-inner transition active:scale-95"
                    disabled={isSavingSupplier}
                    aria-label="Закрыть форму"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div
                ref={editorFieldsRef}
                onFocusCapture={scheduleFocusVisibility}
                className="supplier-editor-fields min-h-0 flex-1 overflow-y-auto px-4 py-4"
              >
                <fieldset disabled={isSavingSupplier} className="min-w-0 space-y-3 border-0 p-0">
                  <section className="overflow-hidden rounded-[24px] border border-white bg-white shadow-[0_12px_34px_rgba(15,23,42,0.055)]">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                      <div>
                        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          Карточка
                        </p>
                        <p className="mt-0.5 text-xs font-semibold text-slate-500">
                          Основные данные поставщика
                        </p>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      <label className="block px-4 py-3">
                        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                          Название
                        </span>
                        <input
                          aria-label="Название поставщика"
                          placeholder="Например, BMW Parts LLC"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          autoComplete="off"
                          className="mt-1 h-9 w-full bg-transparent text-[18px] font-bold text-slate-950 outline-none placeholder:text-slate-300"
                        />
                      </label>
                      <label className="block px-4 py-3">
                        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                          Телефон / WhatsApp
                        </span>
                        <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-2">
                          <input
                            aria-label="Телефон с кодом страны"
                            type="tel"
                            placeholder="+971..."
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            autoComplete="off"
                            className="h-9 min-w-0 bg-transparent text-[17px] font-bold text-slate-950 outline-none placeholder:text-slate-300"
                          />
                          {isValidE164(currentPhone) && (
                            <a
                              href={`tel:${currentPhone}`}
                              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-emerald-50 px-3 text-[11px] font-bold text-emerald-700"
                            >
                              <Phone size={14} /> Звонок
                            </a>
                          )}
                        </div>
                        <span
                          className={`mt-1 block text-[11px] font-bold ${isValidE164(currentPhone) ? 'text-emerald-700' : 'text-slate-400'}`}
                        >
                          {phone.trim() && !isValidE164(currentPhone)
                            ? 'Проверьте номер: например, +971501234567'
                            : 'Телефон необязателен. Добавьте его сейчас или позже.'}
                        </span>
                      </label>
                      <label className="block px-4 py-3">
                        <span className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                          Локация
                          <button
                            type="button"
                            onClick={autofillLocationFromGps}
                            className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-2 py-1 text-[11px] font-bold normal-case tracking-normal text-blue-700"
                          >
                            <LocateFixed size={12} /> GPS
                          </button>
                        </span>
                        <input
                          aria-label="Локация"
                          placeholder="Google Maps или адрес (необязательно)"
                          value={location}
                          onChange={(e) => {
                            setLocation(e.target.value);
                            setCoords(undefined);
                            setGpsAccuracy(null);
                            setLocationParseNotice(null);
                          }}
                          autoComplete="off"
                          className="mt-1 h-9 w-full bg-transparent text-[15px] font-bold text-slate-950 outline-none placeholder:text-slate-300"
                        />
                        {gpsAccuracy !== null && (
                          <span className="mt-1 block text-[11px] font-bold text-blue-700">
                            Точность GPS: {gpsAccuracy}м
                          </span>
                        )}
                      </label>
                      <label className="block px-4 py-3">
                        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                          Зона
                        </span>
                        <input
                          placeholder="Sajaa, Ras Al Khor..."
                          value={zone}
                          onChange={(e) => setZone(e.target.value)}
                          autoComplete="off"
                          className="mt-1 h-9 w-full bg-transparent text-[15px] font-bold text-slate-950 outline-none placeholder:text-slate-300"
                        />
                      </label>
                    </div>
                    {(duplicateWarning || locationParseNotice) && (
                      <div className="space-y-2 border-t border-slate-100 px-4 py-3">
                        {duplicateWarning && (
                          <p className="rounded-2xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
                            {duplicateWarning}
                          </p>
                        )}
                        {locationParseNotice && (
                          <p className="rounded-2xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
                            {locationParseNotice}
                          </p>
                        )}
                      </div>
                    )}
                  </section>

                  <section className="rounded-[24px] border border-white bg-white p-4 shadow-[0_12px_34px_rgba(15,23,42,0.055)]">
                    <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      Профиль
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {FIELD_TYPES.map((type) => (
                        <button
                          key={type.value}
                          type="button"
                          onClick={() => toggleShopType(type.value)}
                          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-2xl border px-2 text-[11px] font-bold transition active:scale-[0.98] ${shopTypes.includes(type.value) ? 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                        >
                          {type.icon} {FIELD_TYPE_RU_LABELS[type.value] || type.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setWhatsappFast((value) => !value)}
                        className={`h-11 rounded-2xl border text-xs font-bold transition active:scale-[0.98] ${whatsappFast ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                      >
                        Быстрый WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={() => setHasDelivery((value) => !value)}
                        className={`h-11 rounded-2xl border text-xs font-bold transition active:scale-[0.98] ${hasDelivery ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                      >
                        Доставка
                      </button>
                    </div>
                  </section>

                  <section className="rounded-[24px] border border-white bg-white p-4 shadow-[0_12px_34px_rgba(15,23,42,0.055)]">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-400">
                        Специализация
                      </p>
                      <button
                        type="button"
                        onClick={() => setIsFastBrandMode((prev) => !prev)}
                        className={`rounded-2xl px-3 py-1.5 text-[11px] font-bold ${isFastBrandMode ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}
                      >
                        Быстрый выбор
                      </button>
                    </div>
                    {mainBrands.length > 0 && (
                      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                        {mainBrands.map((brand) => (
                          <button
                            key={`selected-${brand}`}
                            type="button"
                            onClick={() => toggleMainBrand(brand)}
                            className="shrink-0 rounded-2xl bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-white"
                          >
                            {brand}
                          </button>
                        ))}
                      </div>
                    )}
                    <input
                      aria-label="Поиск бренда"
                      value={brandSearch}
                      onChange={(e) => setBrandSearch(e.target.value)}
                      placeholder="Поиск бренда"
                      className="mt-3 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
                    />
                    <div className="mt-2 max-h-24 overflow-y-auto rounded-[20px] border border-slate-100 bg-slate-50 p-2">
                      <div className="flex flex-wrap gap-1.5">
                        {filteredBrandOptions.map((brand) => (
                          <button
                            key={brand}
                            type="button"
                            onClick={() => toggleMainBrand(brand)}
                            className={`rounded-xl border px-2 py-1 text-[11px] font-bold ${mainBrands.includes(brand) ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                          >
                            {brand}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                      <input
                        aria-label="Свой бренд"
                        value={customBrand}
                        onChange={(e) => setCustomBrand(e.target.value)}
                        placeholder="Свой бренд"
                        className="h-10 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none"
                      />
                      <button
                        type="button"
                        onClick={addCustomBrand}
                        aria-label="Добавить марку"
                        className="h-10 rounded-2xl bg-slate-950 px-3 text-xs font-bold text-white"
                      >
                        Добавить
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                      <select
                        aria-label="Основной бренд"
                        className="h-10 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none"
                        value={primaryBrand}
                        onChange={(e) => setPrimaryBrand(e.target.value)}
                      >
                        <option value="">Основной бренд</option>
                        {mainBrands.map((brand) => (
                          <option key={brand} value={brand}>
                            {brand}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={importFromSimilar}
                        className="h-10 rounded-2xl bg-violet-50 px-3 text-xs font-bold text-violet-700"
                      >
                        Импорт
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input
                        aria-label="Модели"
                        value={supplierModelsInput}
                        onChange={(e) => setSupplierModelsInput(e.target.value)}
                        placeholder="Модели"
                        className="h-10 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none"
                      />
                      <input
                        aria-label="Годы"
                        value={supplierYearsInput}
                        onChange={(e) =>
                          setSupplierYearsInput(e.target.value.replace(/[^\d, ]/g, ''))
                        }
                        placeholder="Годы"
                        className="h-10 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none"
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-1.5">
                      {SUPPLIER_PART_CATEGORIES.map((category) => (
                        <button
                          key={category}
                          type="button"
                          onClick={() => toggleMainPartCategory(category)}
                          className={`min-h-8 rounded-xl border px-2 py-1 text-[11px] font-bold leading-tight ${mainPartCategories.includes(category) ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-[24px] border border-white bg-white p-4 shadow-[0_12px_34px_rgba(15,23,42,0.055)]">
                    <div className="flex items-center justify-between">
                      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-400">
                        Фото
                      </p>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                        {supplierPhotos.length} фото
                      </span>
                    </div>
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      <label className="inline-flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center rounded-[20px] border border-dashed border-slate-300 bg-slate-50 text-[11px] font-bold text-slate-500 transition active:scale-95">
                        <Camera size={18} />
                        Добавить
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          multiple
                          onChange={onSupplierPhotoChange}
                        />
                      </label>
                      {supplierPhotos.map((photo, index) => (
                        <div
                          key={`${photo}-${index}`}
                          className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[20px] border border-slate-200 bg-slate-100"
                        >
                          <button
                            type="button"
                            onClick={() => setGallery({ images: supplierPhotos, index })}
                            className="h-full w-full"
                          >
                            <img
                              src={photo}
                              alt="supplier"
                              className="h-full w-full object-cover"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSupplierPhoto(index)}
                            className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-[11px] font-bold text-white"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-[24px] border border-white bg-white shadow-[0_12px_34px_rgba(15,23,42,0.055)]">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((prev) => !prev)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500"
                    >
                      Дополнительно{' '}
                      <ChevronDown
                        size={16}
                        className={`transition ${showAdvanced ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {showAdvanced && (
                      <div className="space-y-2 border-t border-slate-100 px-4 py-3">
                        <div className="rounded-2xl bg-slate-50 px-3 py-2">
                          <label className="block text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                            Доверие: {trustLevel}/5
                          </label>
                          <input
                            aria-label="Доверие: /5"
                            type="range"
                            min={1}
                            max={5}
                            value={trustLevel}
                            onChange={(e) => setTrustLevel(Number(e.target.value))}
                            className="mt-2 w-full"
                          />
                        </div>
                        <input
                          aria-label="Рабочие часы"
                          value={workingHours}
                          onChange={(e) => setWorkingHours(e.target.value)}
                          placeholder="Рабочие часы"
                          className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none"
                        />
                        <input
                          aria-label="Сайт / профиль"
                          value={website}
                          onChange={(e) => setWebsite(e.target.value)}
                          placeholder="Сайт / профиль"
                          className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none"
                        />
                        <textarea
                          aria-label="Комментарий"
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="Комментарий"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none"
                          rows={2}
                        />
                      </div>
                    )}
                  </section>

                  {!navigator.onLine && (
                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
                      Поставщик сохраняется на устройстве. Интернет не нужен.
                    </div>
                  )}
                </fieldset>
              </div>

              <div className="supplier-editor-footer shrink-0 border-t border-slate-200/80 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 backdrop-blur">
                {supplierSaveError && (
                  <p className="supplier-directory-error" role="alert">
                    {supplierSaveError}
                  </p>
                )}
                {!requiredReady && (
                  <p className="mb-2 text-center text-[11px] font-bold text-slate-400">
                    Укажите название и проверьте формат телефона, если он заполнен.
                  </p>
                )}
                <div className="grid grid-cols-[0.8fr_1.2fr] gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isSavingSupplierRef.current) return;
                      setIsAdding(false);
                      resetAddForm();
                    }}
                    className="h-12 rounded-2xl bg-slate-100 text-sm font-bold text-slate-600 transition active:scale-[0.98]"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingSupplier || isProcessingSupplierPhotos || !requiredReady}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 text-sm font-bold text-white shadow-[0_12px_26px_rgba(37,99,235,0.24)] transition active:scale-[0.98] disabled:bg-slate-300 disabled:shadow-none"
                  >
                    {isSavingSupplier || isProcessingSupplierPhotos ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        Сохранение...
                      </>
                    ) : editingSupplierId ? (
                      'Сохранить'
                    ) : (
                      'Добавить'
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </ModalSurface>
      )}

      <section className="supplier-directory-grid" aria-label="Поставщики в базе">
        {isInitialSuppliersLoading ? (
          <p className="supplier-directory-loading" role="status">
            Открываем базу…
          </p>
        ) : displayedSuppliers.length === 0 ? (
          <div className="supplier-directory-empty">
            <span>
              <Store size={26} strokeWidth={1.6} />
            </span>
            <h2>{hasDirectoryQuery ? 'Ничего не найдено' : 'Добавьте первого поставщика'}</h2>
            <p>
              {hasDirectoryQuery
                ? 'Измените запрос или сбросьте фильтры.'
                : 'Начните с названия. Контакты и специализацию можно заполнить позже.'}
            </p>
            {hasDirectoryQuery ? (
              <button type="button" onClick={resetSupplierFilters}>
                Сбросить фильтры
              </button>
            ) : (
              <button
                type="button"
                aria-label="Создать первого поставщика"
                onClick={() => {
                  resetAddForm();
                  setIsAdding(true);
                }}
              >
                Добавить поставщика
              </button>
            )}
          </div>
        ) : (
          displayedSuppliers.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              selectionMode={isSelectionMode}
              selected={selectedSupplierIds.includes(supplier.id)}
              disabled={isDeletingSupplier}
              onSelect={() => toggleSupplierSelection(supplier.id)}
              onOpen={() => setFullscreenSupplierId(supplier.id)}
              onFavorite={() => toggleFavorite(supplier)}
              onWhatsApp={() => openWhatsApp(supplier)}
              onCall={() => openPhone(supplier)}
              onMenu={() => openSupplierActions(supplier.id)}
              onEditContact={() => openSupplierContact(supplier)}
            />
          ))
        )}
      </section>

      <input
        ref={quickPhotoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleQuickPhotoChange(event);
        }}
      />

      {fullscreenSupplier && (
        <ModalSurface
          label="Карточка поставщика"
          onClose={() => {
            if (!isSavingSupplierLinkRef.current) setFullscreenSupplierId(null);
          }}
          className="overflow-hidden"
        >
          <div
            className="supplier-profile-frame"
            style={{ top: visibleViewport.offsetTop, height: visibleViewport.height }}
            onClick={(event) => {
              if (event.target === event.currentTarget && !isSavingSupplierLinkRef.current)
                setFullscreenSupplierId(null);
            }}
          >
            <div className="supplier-profile-panel flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(92dvh,760px)] sm:max-h-[92dvh] sm:max-w-2xl sm:rounded-3xl">
              <div
                ref={profileFieldsRef}
                onFocusCapture={scheduleFocusVisibility}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]"
              >
                <div
                  data-supplier-profile-header
                  className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur"
                >
                  <button
                    type="button"
                    disabled={isSavingSupplierLink}
                    onClick={() => setFullscreenSupplierId(null)}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                  >
                    Закрыть
                  </button>
                  <p className="min-w-0 flex-1 truncate px-2 text-center text-sm font-bold text-slate-800">
                    {fullscreenSupplier.name}
                  </p>
                  <button
                    type="button"
                    disabled={isSavingSupplierLink}
                    className="supplier-profile-menu"
                    aria-label="Открыть меню поставщика"
                    onClick={() => openSupplierActions(fullscreenSupplier.id)}
                  >
                    <MoreHorizontal size={19} />
                  </button>
                </div>
                <section className="supplier-profile-identity">
                  <button
                    type="button"
                    aria-label="Фото поставщика"
                    disabled={!fullscreenSupplier.photos?.length && !fullscreenSupplier.photoUrl}
                    onClick={() =>
                      setGallery({
                        images: fullscreenSupplier.photos?.length
                          ? fullscreenSupplier.photos
                          : [fullscreenSupplier.photoUrl!],
                        index: 0,
                      })
                    }
                  >
                    {fullscreenSupplier.photos?.[0] || fullscreenSupplier.photoUrl ? (
                      <SafeImage
                        src={fullscreenSupplier.photos?.[0] || fullscreenSupplier.photoUrl!}
                        alt={fullscreenSupplier.name}
                      />
                    ) : (
                      <Store size={27} strokeWidth={1.5} />
                    )}
                  </button>
                  <div>
                    <h2>{fullscreenSupplier.name}</h2>
                    <p>{getSupplierLocationLabel(fullscreenSupplier) || 'Район не указан'}</p>
                    <p>{pickSupplierBrands(fullscreenSupplier).join(', ') || 'Марки не указаны'}</p>
                  </div>
                </section>
                {supplierActionError && (
                  <p className="supplier-directory-error" role="alert">
                    {supplierActionError}
                  </p>
                )}
                <div className="space-y-4 p-5 pb-[calc(7rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Контакты
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => openWhatsApp(fullscreenSupplier)}
                        className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white"
                      >
                        WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={() => openPhone(fullscreenSupplier)}
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700"
                      >
                        Звонок
                      </button>
                      <button
                        type="button"
                        onClick={() => openMap(fullscreenSupplier.location || '')}
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700"
                      >
                        Карта
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-700">
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          Телефон
                        </p>
                        <p className="mt-1 truncate text-sm font-bold text-slate-900">
                          {fullscreenSupplier.phone || '—'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          Последний контакт
                        </p>
                        <p className="mt-1 truncate text-sm font-bold text-slate-900">
                          {daysAgoLabel(fullscreenSupplier.lastContactAt)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Информация
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-700">
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          Зона
                        </p>
                        <p className="mt-1 truncate text-sm font-bold text-slate-900">
                          {fullscreenSupplier.zone || '—'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          Локация
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm font-bold text-slate-900">
                          {fullscreenSupplier.location || '—'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2 text-xs font-semibold text-slate-700">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          Марки
                        </p>
                        <p className="mt-1">
                          {pickSupplierBrands(fullscreenSupplier).join(', ') || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          Модели
                        </p>
                        <p className="mt-1">
                          {(fullscreenSupplier.models || []).join(', ') || '—'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white">
                    <button
                      type="button"
                      disabled={isSavingSupplierLink}
                      onClick={() => setIsFullscreenOrderLinkOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          Привязка
                        </p>
                        <p className="mt-0.5 text-sm font-bold text-slate-900">
                          Привязать к заказу
                        </p>
                      </div>
                      <ChevronDown
                        size={16}
                        className={`text-slate-400 transition-transform ${isFullscreenOrderLinkOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {isFullscreenOrderLinkOpen && (
                      <div className="space-y-2 px-4 pb-4">
                        <input
                          aria-label="Поиск связанного заказа"
                          value={fullscreenOrderSearch}
                          onChange={(e) => setFullscreenOrderSearch(e.target.value)}
                          placeholder="Марка, модель или VIN заказа"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold"
                        />
                        <select
                          disabled={isSavingSupplierLink}
                          aria-label="Выберите заказ"
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold"
                          value={selectedOrderBySupplier[fullscreenSupplier.id] || ''}
                          onChange={(e) =>
                            setSelectedOrderBySupplier((prev) => ({
                              ...prev,
                              [fullscreenSupplier.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Выберите заказ</option>
                          {fullscreenOrderOptions.map((order) => (
                            <option key={order.id} value={order.id}>
                              {order.brand} {order.model} • {order.vin}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={
                            isSavingSupplierLink || !selectedOrderBySupplier[fullscreenSupplier.id]
                          }
                          onClick={async () => {
                            const selectedOrderId = selectedOrderBySupplier[fullscreenSupplier.id];
                            if (!selectedOrderId) return;
                            const selectedOrder = activeOrders.find(
                              (order) => order.id === selectedOrderId,
                            );
                            if (!selectedOrder) return;
                            const saved = await addSupplierToOrder(
                              fullscreenSupplier.id,
                              selectedOrderId,
                              selectedOrder.parts.map((part) => part.id),
                            );
                            if (saved) {
                              setIsFullscreenOrderLinkOpen(false);
                              toast('Поставщик привязан к заказу', 'success');
                            }
                          }}
                          className="w-full rounded-2xl bg-blue-600 px-3 py-2 text-xs font-bold text-white transition active:scale-[0.99]"
                        >
                          Привязать
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Связанные заказы
                    </p>
                    {fullscreenSupplierOrders.length === 0 ? (
                      <p className="mt-2 text-xs font-semibold text-slate-500">
                        Нет связанных заказов.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {fullscreenSupplierOrders.map((order) => (
                          <div
                            key={order.id}
                            className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-900">
                                  {order.brand} {order.model}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                                  VIN: {order.vin || '—'}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setPendingOrderRemoval({
                                    supplierId: fullscreenSupplier.id,
                                    orderId: order.id,
                                  })
                                }
                                className="shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700"
                              >
                                Убрать
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ModalSurface>
      )}

      {actionSupplier && (
        <SupplierActions
          supplier={actionSupplier}
          error={supplierActionError}
          onPin={() => togglePinned(actionSupplier)}
          onFavorite={() => toggleFavorite(actionSupplier)}
          onPhoto={() => openQuickPhotoPicker(actionSupplier.id)}
          onEdit={() => {
            setFullscreenSupplierId(null);
            startEditSupplier(actionSupplier);
          }}
          onContact={() => openSupplierContact(actionSupplier)}
          onDelete={() => {
            setSupplierActionError(null);
            setDeleteSupplierId(actionSupplier.id);
          }}
          onClose={() => setActionModalSupplierId(null)}
        />
      )}

      {contactEditorSupplierId && (
        <ModalSurface
          label="Контакты поставщика"
          onClose={() => {
            if (!isSavingContactRef.current) setContactEditorSupplierId(null);
          }}
          className="ui-sheet-layer"
        >
          <div
            className="supplier-contact-frame"
            style={{ top: visibleViewport.offsetTop, height: visibleViewport.height }}
            onClick={(event) => {
              if (event.target === event.currentTarget && !isSavingContactRef.current)
                setContactEditorSupplierId(null);
            }}
          >
            <form
              className="supplier-contact-panel"
              onSubmit={(event) => {
                event.preventDefault();
                void saveSupplierContact();
              }}
            >
              <header>
                <h2>Контакты поставщика</h2>
                <p>Укажите телефон или номер WhatsApp с кодом страны.</p>
              </header>
              <div
                ref={contactFieldsRef}
                onFocusCapture={scheduleFocusVisibility}
                className="supplier-contact-fields"
              >
                <label>
                  Телефон поставщика
                  <input
                    type="tel"
                    disabled={isSavingContact}
                    aria-label="Телефон поставщика"
                    value={contactPhone}
                    onChange={(event) => setContactPhone(event.target.value)}
                    placeholder="+971 50 123 4567"
                    autoComplete="tel"
                  />
                </label>
                <label>
                  WhatsApp поставщика
                  <input
                    type="tel"
                    disabled={isSavingContact}
                    aria-label="WhatsApp поставщика"
                    value={contactWhatsapp}
                    onChange={(event) => setContactWhatsapp(event.target.value)}
                    placeholder="Если отличается от телефона"
                  />
                </label>
                {contactSaveError && (
                  <p className="supplier-directory-error" role="alert">
                    {contactSaveError}
                  </p>
                )}
              </div>
              <footer>
                <button
                  type="button"
                  disabled={isSavingContact}
                  onClick={() => setContactEditorSupplierId(null)}
                >
                  Отмена
                </button>
                <button type="submit" disabled={isSavingContact}>
                  {isSavingContact ? 'Сохраняю…' : 'Сохранить'}
                </button>
              </footer>
            </form>
          </div>
        </ModalSurface>
      )}

      <ConfirmModal
        isOpen={!!pendingOrderRemoval}
        message="Убрать поставщика из выбранного заказа?"
        loading={isSavingSupplierLink}
        error={supplierActionError}
        onConfirm={async () => {
          if (
            !pendingOrderRemoval ||
            !fullscreenSupplier ||
            pendingOrderRemoval.supplierId !== fullscreenSupplier.id
          )
            return;
          if (await removeSupplierFromOrder(fullscreenSupplier, pendingOrderRemoval.orderId))
            setPendingOrderRemoval(null);
        }}
        onCancel={() => {
          if (!isSavingSupplierLinkRef.current) setPendingOrderRemoval(null);
        }}
      />

      <ConfirmModal
        isOpen={deleteSupplierId === '__bulk__'}
        message={`Удалить выбранных поставщиков (${selectedSupplierIds.length})?`}
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        confirmClass="bg-red-600"
        loading={isDeletingSupplier}
        error={supplierActionError}
        onConfirm={confirmBulkDeleteSuppliers}
        onCancel={() => {
          if (!isDeletingSupplierRef.current) setDeleteSupplierId(null);
        }}
      />
      <ConfirmModal
        isOpen={!!deleteSupplierId && deleteSupplierId !== '__bulk__'}
        message="Вы уверены, что хотите удалить этого поставщика?"
        loading={isDeletingSupplier}
        error={supplierActionError}
        onConfirm={confirmDeleteSupplier}
        onCancel={() => {
          if (!isDeletingSupplierRef.current) setDeleteSupplierId(null);
        }}
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

export default SuppliersScreen;
