import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Gem,
  Heart,
  Loader2,
  LocateFixed,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Pin,
  Search,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Store,
  Trash2,
  UserPlus,
  Wrench,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CAR_DATABASE } from '../carDatabase';
import ConfirmModal from '../components/ConfirmModal';
import ImagePreview from '../components/ImagePreview';
import { PageHeader } from '../components/ui';
import { toast } from '../feedback';
import { createUuid } from '../id';
import { resolveCoordinatesFromLocation } from '../mapsLocation';
import {
  addRadarManualSelection,
  getRadarManualSelections,
  RADAR_MANUAL_SELECTIONS_EVENT,
  removeRadarManualSelection,
} from '../radarManualSelections';
import { optimizeLocalImage } from '../storage/photos';
import { refreshLocalSuppliers, useStore } from '../store';
import {
  Supplier,
  SupplierInteraction,
  SupplierInteractionType,
  SupplierLinkedPartEntry,
  SupplierType,
} from '../types';

const FIELD_TYPES: Array<{ value: SupplierType; label: string; icon: React.ReactNode }> = [
  { value: 'new_parts', label: 'New Parts', icon: <Gem size={12} /> },
  { value: 'scrapyard', label: 'Scrapyard', icon: <Wrench size={12} /> },
  { value: 'engine_specialist', label: 'Engine Specialist', icon: <Wrench size={12} /> },
  { value: 'body_parts', label: 'Body Parts', icon: <Wrench size={12} /> },
  { value: 'electrical', label: 'Electrical', icon: <Sparkles size={12} /> },
  { value: 'mixed', label: 'Mixed', icon: <Store size={12} /> },
  { value: 'dealer', label: 'Dealer', icon: <Store size={12} /> },
  { value: 'warehouse', label: 'Warehouse', icon: <Store size={12} /> },
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

const normalizePhone = (raw: string) => {
  const trimmed = raw.replace(/[\s\-()]/g, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('971')) return `+${digits}`;
  if (digits.startsWith('0')) return `+971${digits.slice(1)}`;
  return `+${digits}`;
};

const isValidE164 = (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone);

const toTitle = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const supplierInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || '')
    .join('') || 'SP';

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

const deriveSupplierMetaFromOrderIds = (
  supplier: Supplier,
  orderIds: string[],
  orders: Array<{ id: string; brand?: string; model?: string; year?: number | string }>,
) => {
  const relatedOrders = orderIds
    .map((orderId) => orders.find((order) => order.id === orderId))
    .filter(Boolean) as Array<{
    id: string;
    brand?: string;
    model?: string;
    year?: number | string;
  }>;

  const derivedBrands = mergeUniqueStrings(
    [],
    relatedOrders.map((order) => order.brand || ''),
  );
  const derivedModels = mergeUniqueStrings(
    [],
    relatedOrders.map((order) => order.model || ''),
  );
  const derivedYears = mergeUniqueYears(
    [],
    relatedOrders.map((order) => Number(order.year)),
  );

  return {
    mainBrands: derivedBrands,
    brands: derivedBrands,
    models: derivedModels,
    years: derivedYears,
    primaryBrand: derivedBrands[0] || supplier.primaryBrand || '',
  };
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

const activityLabel = (score: number, lastContactAt?: number) => {
  const days = lastContactAt ? (Date.now() - lastContactAt) / (1000 * 60 * 60 * 24) : Infinity;
  if (days > 60) return '⚫ Dormant';
  if (score >= 14) return '🔥 High';
  if (score >= 7) return '🟡 Medium';
  return '⚪ Low';
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

const calcDistanceKm = (
  supplier: Supplier & { coordinates?: { lat: number; lng: number } },
  reference: { lat: number; lng: number },
) => {
  if (!supplier.coordinates) return Number.POSITIVE_INFINITY;
  const latDiff = (supplier.coordinates.lat - reference.lat) * 111;
  const lngDiff = (supplier.coordinates.lng - reference.lng) * 111;
  return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const SuppliersScreen: React.FC = () => {
  const {
    suppliers,
    addSupplier,
    deleteSupplier,
    restoreData,
    orders,
    updateOrder,
    updateSupplier,
  } = useStore();
  const locationRoute = useLocation();

  const [isAdding, setIsAdding] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const quickPhotoInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressGestureRef = useRef<{
    supplierId: string;
    pointerId: number;
    startX: number;
    startY: number;
    startScrollY: number;
    triggered: boolean;
  } | null>(null);
  const fullscreenMenuRef = useRef<HTMLDivElement>(null);
  const suppressClickSupplierIdRef = useRef<string | null>(null);
  const [deleteSupplierId, setDeleteSupplierId] = useState<string | null>(null);
  const [quickPhotoSupplierId, setQuickPhotoSupplierId] = useState<string | null>(null);
  const [isFullscreenMenuOpen, setIsFullscreenMenuOpen] = useState(false);

  const [importFile, setImportFile] = useState<any>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

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
  const [locationParseNotice, setLocationParseNotice] = useState<string | null>(null);
  const [, setActiveOrderLinkShopId] = useState<string | null>(null);
  const [] = useState<{ supplierId: string; orderId: string; partId: string } | null>(null);
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
  const [sortByDistanceRef] = useState<{ lat: number; lng: number }>({
    lat: 25.2048,
    lng: 55.2708,
  });
  const [sortByExtended, setSortByExtended] = useState<
    'smart' | 'fast' | 'trust' | 'heat' | 'near' | 'name'
  >('smart');
  const [brandFilter, setBrandFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [selectedBrandView, setSelectedBrandView] = useState<string | null>(null);
  const [] = useState<string | null>(null);
  const [fullscreenSupplierId, setFullscreenSupplierId] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState('all');
  const [partCategoryFilter, setPartCategoryFilter] = useState('all');
  const [favoriteFilter, setFavoriteFilter] = useState<'all' | 'favorites'>('all');
  const [fastWhatsappFilter, setFastWhatsappFilter] = useState<'all' | 'fast'>('all');
  const [visitTodayFilter, setVisitTodayFilter] = useState<'all' | 'visit_today'>('all');
  const [visitFormSupplierId, setVisitFormSupplierId] = useState<string | null>(null);
  const [visitOwnerName, setVisitOwnerName] = useState('');
  const [visitPartsCount, setVisitPartsCount] = useState('');
  const [visitShopSize, setVisitShopSize] = useState('');
  const [visitComment, setVisitComment] = useState('');
  const [visitPhotos, setVisitPhotos] = useState<string[]>([]);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isBrandsDrawerOpen, setIsBrandsDrawerOpen] = useState(false);
  const [, setExpandedSupplierIds] = useState<Set<string>>(new Set());
  const [] = useState<Set<string>>(new Set());
  const [, setOverflowSupplierId] = useState<string | null>(null);
  const [] = useState<Set<string>>(new Set());
  const [, setManualRadarCounts] = useState<Record<string, number>>({});
  const [, setManualSelections] = useState(() => getRadarManualSelections());
  const [] = useState<string[]>([]);
  const [] = useState(0);
  const [] = useState<3 | 5 | null>(null);
  const [] = useState<number | null>(null);
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
    setExpandedSupplierIds((current) => {
      if (current.has(supplierId)) return current;
      const next = new Set(current);
      next.add(supplierId);
      return next;
    });
    const el = document.getElementById(`supplier-card-${supplierId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [locationRoute.search, suppliers]);

  const brandOptions = useMemo(
    () => Object.keys(CAR_DATABASE).sort((a, b) => a.localeCompare(b)),
    [],
  );

  const supplierStatsMap = useMemo(() => {
    const stats: Record<
      string,
      {
        interactions30d: number;
        found: number;
        notFound: number;
        wrongInfo: number;
        responsePoints: number;
        lastContactAt: number;
        avgCheck: number;
        orderCount: number;
      }
    > = {};
    const monthAgo = Date.now() - 1000 * 60 * 60 * 24 * 30;

    const ensure = (key: string) => {
      if (!stats[key]) {
        stats[key] = {
          interactions30d: 0,
          found: 0,
          notFound: 0,
          wrongInfo: 0,
          responsePoints: 0,
          lastContactAt: 0,
          avgCheck: 0,
          orderCount: 0,
        };
      }
      return stats[key];
    };

    orders.forEach((order) => {
      const orderTs = Number(order.updatedAt || order.createdAt || 0);
      order.parts.forEach((part) => {
        part.variants.forEach((variant) => {
          const shopName = (variant.shopName || '').trim().toLowerCase();
          if (!shopName) return;
          const item = ensure(shopName);
          if (orderTs >= monthAgo) item.interactions30d += 1;
          if (part.isFound) item.found += 1;
          else item.notFound += 1;
          item.lastContactAt = Math.max(item.lastContactAt, orderTs);
          if (variant.priceAed > 0) {
            item.avgCheck += variant.priceAed;
            item.orderCount += 1;
          }

          const ageHours = (Date.now() - orderTs) / (1000 * 60 * 60);
          if (ageHours < 4) item.responsePoints += 4;
          else if (ageHours < 24) item.responsePoints += 2;
          else item.responsePoints += 1;
        });
      });
    });

    return stats;
  }, [orders]);

  const existingByName = useMemo(
    () => suppliers.map((s) => s.name.trim().toLowerCase()),
    [suppliers],
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

  const suppliersWithStats = useMemo(
    () =>
      suppliers.map((supplier) => {
        const key = supplier.name.trim().toLowerCase();
        const calculated = supplierStatsMap[key] || {
          interactions30d: 0,
          found: 0,
          notFound: 0,
          wrongInfo: 0,
          responsePoints: 0,
          lastContactAt: 0,
          avgCheck: 0,
          orderCount: 0,
        };
        const foundCount =
          Number.isFinite(Number(supplier.foundCount)) && Number(supplier.foundCount) > 0
            ? Number(supplier.foundCount)
            : calculated.found;
        const notFoundCount =
          Number.isFinite(Number(supplier.notFoundCount)) && Number(supplier.notFoundCount) > 0
            ? Number(supplier.notFoundCount)
            : calculated.notFound;
        const wrongInfoCount = Number.isFinite(Number(supplier.wrongInfoCount))
          ? Number(supplier.wrongInfoCount)
          : calculated.wrongInfo;
        const total = foundCount + notFoundCount;
        const successRate = total > 0 ? Math.round((foundCount / total) * 100) : 0;
        const activityScore =
          foundCount * 2 + calculated.interactions30d + calculated.responsePoints;
        const avgCheck =
          calculated.orderCount > 0 ? Math.round(calculated.avgCheck / calculated.orderCount) : 0;
        const lastContactAt = Math.max(
          Number(supplier.lastContactAt || 0),
          calculated.lastContactAt || 0,
        );

        return {
          ...supplier,
          foundCount,
          notFoundCount,
          wrongInfoCount,
          successRate,
          activityScore,
          avgCheck,
          lastContactAt,
          activityState: activityLabel(activityScore, lastContactAt),
        };
      }),
    [suppliers, supplierStatsMap],
  );

  const rawSuppliers = useMemo(() => {
    const deduped = new Map<string, (typeof suppliersWithStats)[number]>();
    suppliersWithStats.forEach((item) => {
      const key = `${item.id}:${item.name.trim().toLowerCase()}`;
      if (!deduped.has(key)) deduped.set(key, item);
    });
    return Array.from(deduped.values());
  }, [suppliersWithStats]);

  const supplierFilterOptions = useMemo(() => {
    const brands = new Set<string>();
    const models = new Set<string>();
    const years = new Set<string>();
    const partCategories = new Set<string>();

    rawSuppliers.forEach((supplier) => {
      pickSupplierBrands(supplier).forEach((brand) => {
        if (brand) brands.add(brand);
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
      brands: Array.from(brands).sort((a, b) => a.localeCompare(b)),
      models: Array.from(models).sort((a, b) => a.localeCompare(b)),
      years: Array.from(years).sort((a, b) => Number(b) - Number(a)),
      partCategories: Array.from(new Set([...SUPPLIER_PART_CATEGORIES, ...partCategories])).sort(
        (a, b) => a.localeCompare(b),
      ),
    };
  }, [rawSuppliers]);

  const filteredSuppliers = useMemo(() => {
    const selectedYear = Number(yearFilter);
    const hasSelectedYear = yearFilter !== 'all' && Number.isFinite(selectedYear);

    return [...rawSuppliers]
      .filter((supplier) => {
        const brandMatch =
          brandFilter === 'all' || pickSupplierBrands(supplier).includes(brandFilter);
        const modelMatch = modelFilter === 'all' || (supplier.models || []).includes(modelFilter);
        const supplierYears = normalizeSupplierYears(supplier.years);
        const yearMatch = !hasSelectedYear || supplierYears.includes(selectedYear);
        const categoryMatch =
          partCategoryFilter === 'all' ||
          (supplier.mainPartCategories || []).includes(partCategoryFilter);
        const favoriteMatch = favoriteFilter === 'all' || supplier.isFavorite === true;
        const fastWhatsappMatch = fastWhatsappFilter === 'all' || supplier.whatsappFast === true;
        const visitTodayMatch =
          visitTodayFilter === 'all' ||
          ((supplier.supplierStatus === 'contacted' || supplier.supplierStatus === 'responded') &&
            !(Number(supplier.lastVisitedAt || 0) > 0));
        return (
          brandMatch &&
          modelMatch &&
          yearMatch &&
          categoryMatch &&
          favoriteMatch &&
          fastWhatsappMatch &&
          visitTodayMatch
        );
      })
      .sort((a, b) => {
        const distanceA = calcDistanceKm(a, sortByDistanceRef);
        const distanceB = calcDistanceKm(b, sortByDistanceRef);

        if (sortByExtended === 'fast') {
          const fastA = a.whatsappFast === true ? 1 : 0;
          const fastB = b.whatsappFast === true ? 1 : 0;
          if (fastA !== fastB) return fastB - fastA;
          return (
            Number(b.trustLevel ?? b.autoTrustScore ?? 0) -
              Number(a.trustLevel ?? a.autoTrustScore ?? 0) ||
            distanceA - distanceB ||
            a.name.localeCompare(b.name)
          );
        }

        if (sortByExtended === 'trust')
          return (
            Number(b.autoTrustScore ?? b.trustLevel ?? 0) -
              Number(a.autoTrustScore ?? a.trustLevel ?? 0) ||
            Number(b.heatLevel || 0) - Number(a.heatLevel || 0) ||
            distanceA - distanceB ||
            a.name.localeCompare(b.name)
          );
        if (sortByExtended === 'heat')
          return (
            Number(b.heatLevel || 0) - Number(a.heatLevel || 0) ||
            Number(b.autoTrustScore ?? b.trustLevel ?? 0) -
              Number(a.autoTrustScore ?? a.trustLevel ?? 0) ||
            distanceA - distanceB ||
            a.name.localeCompare(b.name)
          );
        if (sortByExtended === 'near')
          return (
            distanceA - distanceB ||
            Number(b.autoTrustScore ?? b.trustLevel ?? 0) -
              Number(a.autoTrustScore ?? a.trustLevel ?? 0)
          );
        if (sortByExtended === 'name') return a.name.localeCompare(b.name) || distanceA - distanceB;
        return (
          Number(b.supplierScore || 0) - Number(a.supplierScore || 0) ||
          Number(b.autoTrustScore ?? b.trustLevel ?? 0) -
            Number(a.autoTrustScore ?? a.trustLevel ?? 0) ||
          Number(b.heatLevel || 0) - Number(a.heatLevel || 0) ||
          distanceA - distanceB ||
          a.name.localeCompare(b.name)
        );
      });
  }, [
    brandFilter,
    fastWhatsappFilter,
    favoriteFilter,
    modelFilter,
    partCategoryFilter,
    rawSuppliers,
    sortByExtended,
    sortByDistanceRef,
    visitTodayFilter,
    yearFilter,
  ]);

  const availableBrands = useMemo(() => {
    const brands = new Set<string>();
    rawSuppliers.forEach((supplier) => {
      pickSupplierBrands(supplier).forEach((brand) => {
        if (brand) brands.add(brand);
      });
    });
    return Array.from(brands).sort((a, b) => a.localeCompare(b));
  }, [rawSuppliers]);

  const displayedSuppliers = useMemo(() => {
    const query = supplierSearchQuery.trim().toLowerCase();
    if (!query) return filteredSuppliers;
    return filteredSuppliers.filter((supplier) => {
      const brands = pickSupplierBrands(supplier).join(' ').toLowerCase();
      const models = (supplier.models || []).join(' ').toLowerCase();
      const haystack =
        `${supplier.name} ${supplier.location || ''} ${brands} ${models}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [filteredSuppliers, supplierSearchQuery]);

  const supplierOverview = useMemo(() => {
    const total = rawSuppliers.length;
    const trusted = rawSuppliers.filter(
      (supplier) =>
        Number(supplier.trustLevel ?? supplier.autoTrustScore ?? 0) >= 4 ||
        supplier.supplierStatus === 'trusted',
    ).length;
    const fast = rawSuppliers.filter((supplier) => supplier.whatsappFast === true).length;
    const favorites = rawSuppliers.filter(
      (supplier) => supplier.isFavorite === true || supplier.isPinned === true,
    ).length;
    const missingContacts = rawSuppliers.filter(
      (supplier) => !String(supplier.phone || supplier.whatsapp || '').trim(),
    ).length;
    return { total, trusted, fast, favorites, missingContacts };
  }, [rawSuppliers]);

  const activeSupplierFilterCount = useMemo(
    () =>
      [
        supplierSearchQuery.trim(),
        selectedBrandView,
        sortByExtended !== 'smart' ? sortByExtended : '',
        favoriteFilter !== 'all' ? favoriteFilter : '',
        fastWhatsappFilter !== 'all' ? fastWhatsappFilter : '',
        visitTodayFilter !== 'all' ? visitTodayFilter : '',
        yearFilter !== 'all' ? yearFilter : '',
        partCategoryFilter !== 'all' ? partCategoryFilter : '',
      ].filter(Boolean).length,
    [
      fastWhatsappFilter,
      favoriteFilter,
      partCategoryFilter,
      selectedBrandView,
      sortByExtended,
      supplierSearchQuery,
      visitTodayFilter,
      yearFilter,
    ],
  );

  const resetSupplierFilters = useCallback(() => {
    setSortByExtended('smart');
    setSelectedBrandView(null);
    setBrandFilter('all');
    setModelFilter('all');
    setYearFilter('all');
    setPartCategoryFilter('all');
    setFavoriteFilter('all');
    setFastWhatsappFilter('all');
    setVisitTodayFilter('all');
    setSupplierSearchQuery('');
  }, []);

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
    suppressClickSupplierIdRef.current = supplierId;
    setActionModalSupplierId(supplierId);
    setOverflowSupplierId(null);
  };

  const LONG_PRESS_DELAY_MS = 550;
  const LONG_PRESS_MOVE_THRESHOLD_PX = 10;
  const LONG_PRESS_SCROLL_THRESHOLD_PX = 8;

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressGestureRef.current = null;
  };

  const startLongPress = (supplierId: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, a, [data-no-long-press="true"]')) return;

    cancelLongPress();
    longPressGestureRef.current = {
      supplierId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollY: window.scrollY,
      triggered: false,
    };

    longPressTimerRef.current = window.setTimeout(() => {
      const gesture = longPressGestureRef.current;
      if (!gesture || gesture.supplierId !== supplierId) return;
      gesture.triggered = true;
      openSupplierActions(supplierId);
      longPressTimerRef.current = null;
    }, LONG_PRESS_DELAY_MS);
  };

  const trackLongPressMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = longPressGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.triggered) return;

    const movedX = Math.abs(event.clientX - gesture.startX);
    const movedY = Math.abs(event.clientY - gesture.startY);
    const scrolledY = Math.abs(window.scrollY - gesture.startScrollY);

    if (
      movedX > LONG_PRESS_MOVE_THRESHOLD_PX ||
      movedY > LONG_PRESS_MOVE_THRESHOLD_PX ||
      scrolledY > LONG_PRESS_SCROLL_THRESHOLD_PX
    ) {
      cancelLongPress();
    }
  };

  const finishLongPress = (event?: React.PointerEvent<HTMLDivElement>) => {
    const gesture = longPressGestureRef.current;
    if (!gesture) {
      cancelLongPress();
      return;
    }
    if (event && gesture.pointerId !== event.pointerId) return;
    cancelLongPress();
  };

  const fullscreenSupplier = useMemo(
    () =>
      displayedSuppliers.find((supplier) => supplier.id === fullscreenSupplierId) ||
      filteredSuppliers.find((supplier) => supplier.id === fullscreenSupplierId) ||
      null,
    [displayedSuppliers, filteredSuppliers, fullscreenSupplierId],
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

  const computeSupplierScore = (supplier: Supplier) => {
    const trust = Math.max(0, Math.min(5, Number(supplier.trustLevel ?? 0))) * 20;
    const responseSpeed = supplier.whatsappFast ? 20 : 8;
    const visit =
      supplier.supplierStatus === 'visited' ||
      supplier.supplierStatus === 'verified' ||
      supplier.supplierStatus === 'trusted'
        ? 20
        : 0;
    const ordersCompleted = Math.min(20, Number(supplier.ordersCompleted || 0) * 2);
    const distanceKm = calcDistanceKm(supplier, sortByDistanceRef);
    const distance = Number.isFinite(distanceKm) ? Math.max(0, 20 - Math.round(distanceKm)) : 5;
    return clampScore(trust + responseSpeed + visit + ordersCompleted + distance);
  };

  const addSupplierInteraction = (
    supplier: Supplier,
    type: SupplierInteractionType,
    note: string,
    overrides: Partial<Supplier> = {},
  ) => {
    const now = Date.now();
    const interaction: SupplierInteraction = {
      id: createUuid(),
      supplierId: supplier.id,
      type,
      date: now,
      note,
      createdAt: now,
    };
    const nextSupplier = {
      ...supplier,
      interactions: [interaction, ...(supplier.interactions || [])],
      supplierScore: computeSupplierScore({ ...supplier, ...overrides }),
      updatedAt: now,
      ...overrides,
    };
    updateSupplier(nextSupplier);
  };

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

  const openWhatsApp = (supplier: Supplier, message?: string) => {
    const phone = (supplier.whatsapp || supplier.phone || '').replace(/[^\d]/g, '');
    if (!phone) {
      toast('У поставщика нет WhatsApp контакта', 'error');
      return;
    }
    const targetUrl = message
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/${phone}`;
    const opened = openExternalLink(targetUrl);
    if (!opened) {
      toast('Не удалось открыть WhatsApp. Проверьте блокировку всплывающих окон.', 'error');
      return;
    }
  };

  const openPhone = (supplier: Supplier) => {
    const phone = (supplier.phone || supplier.whatsapp || '').trim();
    if (!phone) {
      toast('У поставщика нет номера телефона', 'error');
      return;
    }
    const opened = window.open(`tel:${phone}`, '_self');
    if (!opened) toast('Не удалось открыть звонилку в этом браузере.', 'error');
  };

  const startEditSupplier = (supplier: Supplier) => {
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
      const optimized = await Promise.all(
        files
          .slice(0, 4)
          .map(async (file) => optimizeLocalImage(file, `suppliers:quick-photo:${file.name}`)),
      );
      const nextPhotos = [...(targetSupplier.photos || []), ...optimized].filter(Boolean);
      updateSupplier({
        ...targetSupplier,
        photos: nextPhotos,
        photoUrl: nextPhotos[0] || targetSupplier.photoUrl,
        updatedAt: Date.now(),
      });
      toast('Фото поставщика сохранено', 'success');
    } catch (error) {
      console.error('quick_photo_upload_failed', error);
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

  const generateUniqueSupplierName = () => {
    const left = ['Dubai', 'Emirates', 'Falcon', 'Desert', 'Turbo', 'Atlas', 'Nova', 'Prime'];
    const right = ['Auto Hub', 'Motors', 'Parts', 'Garage', 'Supply', 'Auto Zone'];
    const exists = new Set(suppliers.map((item) => item.name.trim().toLowerCase()));
    for (let i = 0; i < 200; i += 1) {
      const candidate = `${left[Math.floor(Math.random() * left.length)]} ${right[Math.floor(Math.random() * right.length)]} ${Math.floor(100 + Math.random() * 9000)}`;
      if (!exists.has(candidate.toLowerCase())) {
        setName(candidate);
        return;
      }
    }
    setName(`Supplier ${Date.now()}`);
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
    const normalized = toTitle(customBrand.trim());
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
    void Promise.all(
      files.map(async (file) => {
        try {
          return await optimizeLocalImage(file, `suppliers:photo:${file.name}`);
        } catch {
          const reader = new FileReader();
          return await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(file);
          });
        }
      }),
    ).then((images) => {
      setSupplierPhotos((prev) => [...prev, ...images.filter(Boolean)].filter(Boolean));
    });
    event.target.value = '';
  };

  const removeSupplierPhoto = (index: number) => {
    setSupplierPhotos((prev) => prev.filter((_, idx) => idx !== index));
  };

  const onVisitPhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    void Promise.all(
      files.map(async (file) => optimizeLocalImage(file, `suppliers:visit:${file.name}`)),
    ).then((images) => {
      setVisitPhotos((prev) => [...prev, ...images.filter(Boolean)]);
    });
    event.target.value = '';
  };

  const saveVisitInteraction = () => {
    const supplier = suppliers.find((item) => item.id === visitFormSupplierId);
    if (!supplier) return;
    const note = [
      visitOwnerName ? `Owner: ${visitOwnerName}` : '',
      visitPartsCount ? `Parts qty: ${visitPartsCount}` : '',
      visitShopSize ? `Shop size: ${visitShopSize}` : '',
      visitComment,
    ]
      .filter(Boolean)
      .join('\n');

    addSupplierInteraction(supplier, 'visit', note || 'Visited supplier shop', {
      supplierStatus: 'visited',
      lastVisitedAt: Date.now(),
      lastContactAt: Date.now(),
      shopPhotos: [...(supplier.shopPhotos || []), ...visitPhotos],
      photos: [...(supplier.photos || []), ...visitPhotos],
    });
    setVisitFormSupplierId(null);
    setVisitOwnerName('');
    setVisitPartsCount('');
    setVisitShopSize('');
    setVisitComment('');
    setVisitPhotos([]);
  };

  const handleSave = async () => {
    const normalizedName = toTitle(name.trim());
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedName || !isValidE164(normalizedPhone) || !location.trim()) return;

    setIsSavingSupplier(true);
    try {
      const resolvedCoordinates =
        coords ||
        (await resolveCoordinatesFromLocation(location, {
          fallbackQueries: buildSupplierFallbackQueries(),
          onManualLocationRequired: setLocationParseNotice,
        }));

      const inferredZone = zone || inferZoneFromCoords(resolvedCoordinates || undefined);

      const parsedModels = supplierModelsInput
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const parsedYears = supplierYearsInput
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((year) => Number.isFinite(year));
      const now = Date.now();
      const existingSupplier = editingSupplierId
        ? suppliers.find((supplier) => supplier.id === editingSupplierId)
        : null;
      const supplierPayload: Supplier = {
        id: existingSupplier?.id || createUuid(),
        name: normalizedName,
        phone: normalizedPhone,
        location,
        type: shopType,
        types: shopTypes,
        zone: inferredZone,
        heatLevel: 0,
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
        hasWhatsapp,
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

      resetAddForm();
      setIsAdding(false);
    } finally {
      setIsSavingSupplier(false);
    }
  };

  const confirmRestore = async () => {
    if (importFile) {
      try {
        await restoreData(importFile);
        setImportFile(null);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 3000);
      } catch {
        setImportError('Ошибка при восстановлении данных');
        setTimeout(() => setImportError(null), 3000);
      }
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
    if (!deleteSupplierId || deleteSupplierId === '__bulk__') return;
    await deleteSupplier(deleteSupplierId);
    setSelectedSupplierIds((prev) => prev.filter((id) => id !== deleteSupplierId));
    setDeleteSupplierId(null);
  };

  const confirmBulkDeleteSuppliers = async () => {
    if (selectedSupplierIds.length === 0) return;
    await Promise.all(selectedSupplierIds.map((supplierId) => deleteSupplier(supplierId)));
    setDeleteSupplierId(null);
    clearSupplierSelection();
  };

  const toggleFavorite = (supplier: Supplier) => {
    updateSupplier({ ...supplier, isFavorite: !supplier.isFavorite, updatedAt: Date.now() });
  };

  const togglePinned = (supplier: Supplier) => {
    updateSupplier({ ...supplier, isPinned: !supplier.isPinned, updatedAt: Date.now() });
  };

  const refreshManualSelections = () => {
    const selections = getRadarManualSelections();
    setManualSelections(selections);
    const next: Record<string, number> = {};
    selections
      .filter((item) => (item.source || 'manual') === 'manual')
      .forEach((item) => {
        next[item.supplierId] = (next[item.supplierId] || 0) + 1;
      });
    setManualRadarCounts(next);
  };

  const addSupplierToOrder = (shopId: string, orderId: string, selectedPartIds: string[] = []) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;

    const linkedSupplier = suppliers.find((item) => item.id === shopId);
    const isAlreadyLinked =
      (order.recommendedShopIds || []).includes(shopId) ||
      !!linkedSupplier?.activeOrderIds?.includes(orderId) ||
      !!linkedSupplier?.linkedParts?.some((entry) => entry.orderId === orderId);
    if (isAlreadyLinked) {
      toast('Поставщик уже добавлен в этот заказ', 'error');
      setActiveOrderLinkShopId(null);
      return;
    }
    const normalizedSupplierPhone = (
      linkedSupplier?.whatsapp ||
      linkedSupplier?.phone ||
      ''
    ).replace(/\D/g, '');
    const hasVendorContact = (order.vendorContacts || []).some((contact) => {
      const contactPhone = (contact.whatsapp || contact.phone || '').replace(/\D/g, '');
      return (
        (linkedSupplier &&
          contact.name.trim().toLowerCase() === linkedSupplier.name.trim().toLowerCase()) ||
        (!!normalizedSupplierPhone && normalizedSupplierPhone === contactPhone)
      );
    });
    const nextVendorContacts =
      !hasVendorContact && linkedSupplier
        ? [
            {
              id: createUuid(),
              name: linkedSupplier.name,
              phone: linkedSupplier.phone || '',
              whatsapp: linkedSupplier.whatsapp || linkedSupplier.phone || '',
              mapUrl: linkedSupplier.location || '',
              note: linkedSupplier.comment || '',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            ...(order.vendorContacts || []),
          ]
        : order.vendorContacts || [];

    const current = new Set(order.recommendedShopIds || []);
    current.add(shopId);
    const nextDismissed = (order.dismissedShopIds || []).filter((id) => id !== shopId);
    updateOrder({
      ...order,
      vendorContacts: nextVendorContacts,
      recommendedShopIds: Array.from(current),
      dismissedShopIds: nextDismissed,
      updatedAt: Date.now(),
    });

    const partIds =
      selectedPartIds.length > 0 ? selectedPartIds : order.parts[0]?.id ? [order.parts[0].id] : [];
    partIds.forEach((partId) =>
      addRadarManualSelection({ supplierId: shopId, orderId, partId, source: 'manual' }),
    );

    if (linkedSupplier && order.brand) {
      const currentBrands = linkedSupplier.mainBrands || linkedSupplier.brands || [];
      const nextBrands = mergeUniqueStrings(currentBrands, [order.brand]);
      const nextModels = mergeUniqueStrings(linkedSupplier.models || [], [order.model || '']);
      const nextYears = mergeUniqueYears(normalizeSupplierYears(linkedSupplier.years), [
        Number(order.year),
      ]);
      const nextEntries = partIds.reduce(
        (acc, partId) => {
          const part = order.parts.find((item) => item.id === partId);
          if (!part) return acc;
          return upsertLinkedPartEntry(acc, {
            id: createUuid(),
            orderId: order.id,
            orderLabel: `${order.brand} ${order.model} • ${order.vin}`,
            partId: part.id,
            partName: part.name,
            status: 'searching',
            source: 'manual',
            updatedAt: Date.now(),
          });
        },
        [...(linkedSupplier.linkedParts || [])],
      );
      const updatedSupplier = {
        ...linkedSupplier,
        mainBrands: nextBrands,
        brands: nextBrands,
        primaryBrand: linkedSupplier.primaryBrand || order.brand,
        models: nextModels,
        years: nextYears,
        activeOrderIds: Array.from(new Set([...(linkedSupplier.activeOrderIds || []), order.id])),
        linkedParts: nextEntries,
        updatedAt: Date.now(),
      };
      updateSupplier(updatedSupplier);
    }

    refreshManualSelections();
    setActiveOrderLinkShopId(null);
  };

  const removeSupplierFromOrder = (supplier: Supplier, orderId: string) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;

    const nextEntries = (supplier.linkedParts || []).filter((entry) => entry.orderId !== orderId);
    const nextOrderIds = Array.from(
      new Set(nextEntries.map((entry) => entry.orderId).filter(Boolean)),
    );
    const normalizedSupplierPhone = (supplier.whatsapp || supplier.phone || '').replace(/\D/g, '');
    const nextVendorContacts = (order.vendorContacts || []).filter((contact) => {
      const byName = contact.name.trim().toLowerCase() === supplier.name.trim().toLowerCase();
      const contactPhone = (contact.whatsapp || contact.phone || '').replace(/\D/g, '');
      const byPhone = !!normalizedSupplierPhone && normalizedSupplierPhone === contactPhone;
      return !(byName || byPhone);
    });
    const nextRecommended = (order.recommendedShopIds || []).filter(
      (shopId) => shopId !== supplier.id,
    );

    updateOrder({
      ...order,
      vendorContacts: nextVendorContacts,
      recommendedShopIds: nextRecommended,
      updatedAt: Date.now(),
    });

    const derivedMeta = deriveSupplierMetaFromOrderIds(supplier, nextOrderIds, orders);
    const nextSupplier = {
      ...supplier,
      ...derivedMeta,
      linkedParts: nextEntries,
      activeOrderIds: nextOrderIds,
      updatedAt: Date.now(),
    };
    updateSupplier(nextSupplier);

    (supplier.linkedParts || [])
      .filter((entry) => entry.orderId === orderId)
      .forEach((entry) =>
        removeRadarManualSelection({
          supplierId: supplier.id,
          orderId: entry.orderId,
          partId: entry.partId,
        }),
      );
    refreshManualSelections();
  };

  useEffect(() => {
    void refreshLocalSuppliers(true);
  }, []);

  useEffect(() => {
    if (suppliers.length > 0) {
      setIsInitialSuppliersLoading(false);
      return;
    }
    const timer = window.setTimeout(() => setIsInitialSuppliersLoading(false), 1200);
    return () => window.clearTimeout(timer);
  }, [suppliers.length]);

  useEffect(() => {
    refreshManualSelections();
    const onManualUpdated = () => refreshManualSelections();
    window.addEventListener('focus', onManualUpdated);
    window.addEventListener(RADAR_MANUAL_SELECTIONS_EVENT, onManualUpdated as EventListener);
    return () => {
      window.removeEventListener('focus', onManualUpdated);
      window.removeEventListener(RADAR_MANUAL_SELECTIONS_EVENT, onManualUpdated as EventListener);
    };
  }, [suppliers]);

  useEffect(() => {
    if (!isFullscreenMenuOpen) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (!fullscreenMenuRef.current) return;
      if (!fullscreenMenuRef.current.contains(event.target as Node)) setIsFullscreenMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [isFullscreenMenuOpen]);

  const saveSupplierContact = async () => {
    if (!contactEditorSupplierId) return;
    const normalizedPhone = normalizePhone(contactPhone);
    if (!isValidE164(normalizedPhone))
      return alert('Введите корректный номер в формате E.164 (+971...)');
    const normalizedWhatsapp = normalizePhone(contactWhatsapp || normalizedPhone);
    setIsSavingContact(true);
    try {
      const target = suppliers.find((item) => item.id === contactEditorSupplierId);
      if (!target) return;
      updateSupplier({
        ...target,
        phone: normalizedPhone,
        whatsapp: normalizedWhatsapp,
        updatedAt: Date.now(),
      });
      setContactEditorSupplierId(null);
      toast('Контакт сохранён', 'success');
    } catch (error) {
      console.error(error);
      alert('Не удалось сохранить контакт');
    } finally {
      setIsSavingContact(false);
    }
  };

  const requiredReady = !!toTitle(name.trim()) && isValidE164(currentPhone) && !!location.trim();

  useEffect(() => {
    if (!fullscreenSupplierId) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [fullscreenSupplierId]);

  useEffect(() => {
    setIsFullscreenMenuOpen(false);
    setIsFullscreenOrderLinkOpen(false);
    setFullscreenOrderSearch('');
  }, [fullscreenSupplierId]);

  useEffect(() => () => cancelLongPress(), []);

  useEffect(() => {
    const handleScroll = () => {
      const gesture = longPressGestureRef.current;
      if (!gesture || gesture.triggered) return;
      if (Math.abs(window.scrollY - gesture.startScrollY) > LONG_PRESS_SCROLL_THRESHOLD_PX) {
        cancelLongPress();
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setBrandFilter(selectedBrandView || 'all');
  }, [selectedBrandView]);

  useEffect(() => {
    if (brandFilter !== 'all' && !availableBrands.includes(brandFilter)) {
      setSelectedBrandView(null);
      setBrandFilter('all');
    }
  }, [availableBrands, brandFilter]);

  return (
    <div className="ui-page space-y-5">
      <PageHeader
        title="Поставщики"
        eyebrow="Контакты и предложения"
        description="Ваша база магазинов, история общения и рекомендации."
      />
      <section className="space-y-3">
        <div className="rounded-[26px] border border-white/80 bg-white/75 p-2 shadow-[0_16px_40px_rgba(15,23,42,0.055)] ring-1 ring-slate-900/[0.025] backdrop-blur">
          <div className="flex items-center gap-2">
            <label className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-[20px] bg-slate-50/90 px-3 text-slate-500 ring-1 ring-slate-900/[0.04] transition focus-within:bg-white focus-within:text-blue-600 focus-within:ring-blue-200">
              <Search size={18} className="shrink-0" />
              <input
                value={supplierSearchQuery}
                onChange={(e) => setSupplierSearchQuery(e.target.value)}
                placeholder="Поиск поставщиков · название, зона, бренд..."
                aria-label="Поиск поставщика"
                className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-slate-900 outline-none placeholder:text-slate-400"
              />
            </label>
            <button
              type="button"
              onClick={() => setIsFiltersOpen((prev) => !prev)}
              className={`ds-press inline-flex h-14 w-12 shrink-0 items-center justify-center rounded-[20px] border text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)] ${isFiltersOpen ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200/80 bg-white/90'}`}
              aria-label="Открыть фильтры"
            >
              <SlidersHorizontal size={18} />
            </button>
            <button
              type="button"
              onClick={() => setIsBrandsDrawerOpen(true)}
              className="ds-press inline-flex h-14 w-12 shrink-0 items-center justify-center rounded-[20px] border border-slate-200/80 bg-white/90 text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)]"
              aria-label="Открыть бренды"
            >
              <Menu size={18} />
            </button>
          </div>
        </div>

        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
          <button
            type="button"
            onClick={resetSupplierFilters}
            className={`ds-press shrink-0 rounded-full px-3.5 py-2 text-[11px] font-semibold ${activeSupplierFilterCount === 0 ? 'bg-slate-950 text-white shadow-[0_10px_22px_rgba(15,23,42,0.18)]' : 'border border-slate-200/80 bg-white/85 text-slate-600'}`}
          >
            Все
          </button>
          <button
            type="button"
            onClick={() =>
              setFavoriteFilter((value) => (value === 'favorites' ? 'all' : 'favorites'))
            }
            className={`ds-press shrink-0 rounded-full px-3.5 py-2 text-[11px] font-semibold ${favoriteFilter === 'favorites' ? 'bg-slate-950 text-white shadow-[0_10px_22px_rgba(15,23,42,0.18)]' : 'border border-slate-200/80 bg-white/85 text-slate-600'}`}
          >
            Избранные {supplierOverview.favorites}
          </button>
          <button
            type="button"
            onClick={() => setFastWhatsappFilter((value) => (value === 'fast' ? 'all' : 'fast'))}
            className={`ds-press shrink-0 rounded-full px-3.5 py-2 text-[11px] font-semibold ${fastWhatsappFilter === 'fast' ? 'bg-slate-950 text-white shadow-[0_10px_22px_rgba(15,23,42,0.18)]' : 'border border-slate-200/80 bg-white/85 text-slate-600'}`}
          >
            Быстрый WhatsApp
          </button>
          <button
            type="button"
            onClick={() => setSortByExtended(sortByExtended === 'near' ? 'smart' : 'near')}
            className={`ds-press shrink-0 rounded-full px-3.5 py-2 text-[11px] font-semibold ${sortByExtended === 'near' ? 'bg-slate-950 text-white shadow-[0_10px_22px_rgba(15,23,42,0.18)]' : 'border border-slate-200/80 bg-white/85 text-slate-600'}`}
          >
            Рядом
          </button>
          <button
            type="button"
            onClick={() =>
              setVisitTodayFilter((value) => (value === 'visit_today' ? 'all' : 'visit_today'))
            }
            className={`ds-press shrink-0 rounded-full px-3.5 py-2 text-[11px] font-semibold ${visitTodayFilter === 'visit_today' ? 'bg-slate-950 text-white shadow-[0_10px_22px_rgba(15,23,42,0.18)]' : 'border border-slate-200/80 bg-white/85 text-slate-600'}`}
          >
            Визит сегодня
          </button>
        </div>

        {(isSelectionMode || selectedSupplierIds.length > 0 || selectedBrandView) && (
          <div className="flex flex-wrap items-center gap-2 rounded-[20px] border border-white/80 bg-white/70 p-2 shadow-[0_10px_26px_rgba(15,23,42,0.04)]">
            <button
              type="button"
              onClick={() => {
                if (isSelectionMode || selectedSupplierIds.length > 0) clearSupplierSelection();
                else setIsSelectionMode(true);
              }}
              className={`ds-press rounded-[14px] border px-3 py-2 text-xs font-semibold ${isSelectionMode || selectedSupplierIds.length > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600'}`}
            >
              {isSelectionMode || selectedSupplierIds.length > 0 ? 'Отмена выбора' : 'Выбрать'}
            </button>
            {selectedSupplierIds.length > 0 && (
              <>
                <span className="rounded-[14px] border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                  Выбрано: {selectedSupplierIds.length}
                </span>
                <button
                  type="button"
                  onClick={() => setDeleteSupplierId('__bulk__')}
                  className="ds-press rounded-[14px] bg-rose-600 px-3 py-2 text-xs font-bold text-white"
                >
                  Удалить
                </button>
              </>
            )}
            {selectedBrandView && (
              <span className="rounded-[14px] border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                Бренд: {selectedBrandView}
              </span>
            )}
          </div>
        )}

        {isFiltersOpen && (
          <div className="grid grid-cols-2 gap-2 rounded-[24px] border border-white/80 bg-white/82 p-3 shadow-[0_16px_36px_rgba(15,23,42,0.055)] ring-1 ring-slate-900/[0.025] backdrop-blur">
            <select
              className="rounded-[15px] border border-slate-200/80 bg-slate-50/90 px-2.5 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              value={sortByExtended}
              onChange={(e) => setSortByExtended(e.target.value as any)}
            >
              <option value="smart">Умная сортировка</option>
              <option value="fast">Сначала быстрые</option>
              <option value="trust">По надёжности</option>
              <option value="heat">По активности</option>
              <option value="near">По расстоянию</option>
              <option value="name">A-Z</option>
            </select>
            <select
              className="rounded-[15px] border border-slate-200/80 bg-slate-50/90 px-2.5 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              value={favoriteFilter}
              onChange={(e) => setFavoriteFilter(e.target.value as 'all' | 'favorites')}
            >
              <option value="all">Все поставщики</option>
              <option value="favorites">Избранные</option>
            </select>
            <select
              className="rounded-[15px] border border-slate-200/80 bg-slate-50/90 px-2.5 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              value={fastWhatsappFilter}
              onChange={(e) => setFastWhatsappFilter(e.target.value as 'all' | 'fast')}
            >
              <option value="all">Любая скорость WA</option>
              <option value="fast">Только быстрый WA</option>
            </select>
            <select
              className="rounded-[15px] border border-slate-200/80 bg-slate-50/90 px-2.5 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              value={visitTodayFilter}
              onChange={(e) => setVisitTodayFilter(e.target.value as 'all' | 'visit_today')}
            >
              <option value="all">Без визита</option>
              <option value="visit_today">Визит сегодня</option>
            </select>
            <select
              className="rounded-[15px] border border-slate-200/80 bg-slate-50/90 px-2.5 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
            >
              <option value="all">Все годы</option>
              {supplierFilterOptions.years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <select
              className="rounded-[15px] border border-slate-200/80 bg-slate-50/90 px-2.5 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              value={partCategoryFilter}
              onChange={(e) => setPartCategoryFilter(e.target.value)}
            >
              <option value="all">Все категории</option>
              {supplierFilterOptions.partCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {null}

      {null}

      {importError && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 border border-red-100">
          <AlertTriangle size={16} />
          {importError}
        </div>
      )}
      {showSuccess && (
        <div className="bg-green-50 text-green-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 border border-green-100">
          <CheckCircle2 size={16} />
          Данные успешно восстановлены!
        </div>
      )}

      {isAdding && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/38 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          onClick={() => {
            setIsAdding(false);
            resetAddForm();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
            className="flex max-h-[92dvh] w-full max-w-[460px] flex-col overflow-hidden rounded-t-[32px] bg-[#F5F7FB] shadow-[0_28px_80px_rgba(15,23,42,0.28)] ring-1 ring-white/70 sm:rounded-[32px]"
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
                    setIsAdding(false);
                    resetAddForm();
                  }}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-100 text-xl font-bold text-slate-500 shadow-inner transition active:scale-95"
                  aria-label="Закрыть форму"
                >
                  ×
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <span
                  className={`rounded-2xl px-2.5 py-2 text-center text-[11px] font-bold ${name.trim() ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
                >
                  Имя
                </span>
                <span
                  className={`rounded-2xl px-2.5 py-2 text-center text-[11px] font-bold ${isValidE164(currentPhone) ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
                >
                  Телефон
                </span>
                <span
                  className={`rounded-2xl px-2.5 py-2 text-center text-[11px] font-bold ${location.trim() ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
                >
                  Локация
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
                  <button
                    type="button"
                    onClick={generateUniqueSupplierName}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-2xl bg-blue-50 px-3 text-[11px] font-bold text-blue-700 transition active:scale-95"
                  >
                    <Shuffle size={13} /> Имя
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  <label className="block px-4 py-3">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                      Название
                    </span>
                    <input
                      placeholder="MB Motors"
                      value={name}
                      onChange={(e) => setName(toTitle(e.target.value))}
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
                        placeholder="+971..."
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        autoComplete="off"
                        className="h-9 min-w-0 bg-transparent text-[17px] font-bold text-slate-950 outline-none placeholder:text-slate-300"
                      />
                      {isValidE164(currentPhone) && (
                        <a
                          href={`tel:${currentPhone}`}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-2xl bg-emerald-50 px-3 text-[11px] font-bold text-emerald-700"
                        >
                          <Phone size={14} /> Звонок
                        </a>
                      )}
                    </div>
                    <span
                      className={`mt-1 block text-[11px] font-bold ${isValidE164(currentPhone) ? 'text-emerald-700' : 'text-slate-400'}`}
                    >
                      {isValidE164(currentPhone)
                        ? `${currentPhone} · WhatsApp ${hasWhatsapp ? 'найден' : 'не найден'}`
                        : 'Формат E.164: +971...'}
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
                      placeholder="Google Maps или адрес"
                      value={location}
                      onChange={(e) => {
                        setLocation(e.target.value);
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
                    value={customBrand}
                    onChange={(e) => setCustomBrand(e.target.value)}
                    placeholder="Свой бренд"
                    className="h-10 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none"
                  />
                  <button
                    type="button"
                    onClick={addCustomBrand}
                    className="h-10 rounded-2xl bg-slate-950 px-3 text-xs font-bold text-white"
                  >
                    Добавить
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                  <select
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
                    value={supplierModelsInput}
                    onChange={(e) => setSupplierModelsInput(e.target.value)}
                    placeholder="Модели"
                    className="h-10 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none"
                  />
                  <input
                    value={supplierYearsInput}
                    onChange={(e) => setSupplierYearsInput(e.target.value.replace(/[^\d, ]/g, ''))}
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
                        <img src={photo} alt="supplier" className="h-full w-full object-cover" />
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
                        type="range"
                        min={1}
                        max={5}
                        value={trustLevel}
                        onChange={(e) => setTrustLevel(Number(e.target.value))}
                        className="mt-2 w-full"
                      />
                    </div>
                    <input
                      value={workingHours}
                      onChange={(e) => setWorkingHours(e.target.value)}
                      placeholder="Рабочие часы"
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none"
                    />
                    <input
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="Сайт / профиль"
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none"
                    />
                    <textarea
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
            </div>

            <div className="shrink-0 border-t border-slate-200/80 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 backdrop-blur">
              {!requiredReady && (
                <p className="mb-2 text-center text-[11px] font-bold text-slate-400">
                  Нужно заполнить название, телефон и локацию
                </p>
              )}
              <div className="grid grid-cols-[0.8fr_1.2fr] gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAdding(false);
                    resetAddForm();
                  }}
                  className="h-12 rounded-2xl bg-slate-100 text-sm font-bold text-slate-600 transition active:scale-[0.98]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSavingSupplier || !requiredReady}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 text-sm font-bold text-white shadow-[0_12px_26px_rgba(37,99,235,0.24)] transition active:scale-[0.98] disabled:bg-slate-300 disabled:shadow-none"
                >
                  {isSavingSupplier ? (
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
      )}

      <section className="space-y-2.5">
        {isInitialSuppliersLoading ? (
          <div className="space-y-3.5">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`skeleton-supplier-${index}`}
                className="overflow-hidden rounded-[26px] border border-white/80 bg-white/82 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.055)] ring-1 ring-slate-900/[0.025]"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="h-6 w-6 rounded-full bg-slate-100"
                    style={{
                      backgroundImage:
                        'linear-gradient(90deg, #e5e7eb 0%, #f8fafc 50%, #e5e7eb 100%)',
                      backgroundSize: '200% 100%',
                      animation: 'shimmer 1.2s infinite linear',
                    }}
                  />
                  <div
                    className="h-16 w-16 rounded-full bg-slate-100"
                    style={{
                      backgroundImage:
                        'linear-gradient(90deg, #e5e7eb 0%, #f8fafc 50%, #e5e7eb 100%)',
                      backgroundSize: '200% 100%',
                      animation: 'shimmer 1.2s infinite linear',
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className="h-4 w-2/3 rounded bg-slate-100"
                      style={{
                        backgroundImage:
                          'linear-gradient(90deg, #e5e7eb 0%, #f8fafc 50%, #e5e7eb 100%)',
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 1.2s infinite linear',
                      }}
                    />
                    <div
                      className="mt-3 h-3 w-full rounded bg-slate-100"
                      style={{
                        backgroundImage:
                          'linear-gradient(90deg, #e5e7eb 0%, #f8fafc 50%, #e5e7eb 100%)',
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 1.2s infinite linear',
                      }}
                    />
                    <div
                      className="mt-2 h-3 w-1/2 rounded bg-slate-100"
                      style={{
                        backgroundImage:
                          'linear-gradient(90deg, #e5e7eb 0%, #f8fafc 50%, #e5e7eb 100%)',
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 1.2s infinite linear',
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : displayedSuppliers.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-slate-300/80 bg-white/80 px-5 py-14 text-center text-sm font-semibold text-slate-500 shadow-[0_14px_34px_rgba(15,23,42,0.04)]">
            Поставщики не найдены по текущим фильтрам.
          </div>
        ) : (
          displayedSuppliers.map((supplier) => {
            const isContacted = (supplier.interactions || []).some(
              (item) => item.type === 'whatsapp',
            );
            const isReplied = (supplier.interactions || []).some(
              (item) => item.type === 'whatsapp_reply',
            );
            const distanceKm = calcDistanceKm(supplier, sortByDistanceRef);
            const brands = pickSupplierBrands(supplier);
            const isSelected = selectedSupplierIds.includes(supplier.id);
            const typeLabels = (
              supplier.types && supplier.types.length > 0
                ? supplier.types
                : [supplier.type || 'new_parts']
            )
              .map((value) => FIELD_TYPES.find((item) => item.value === value)?.label || value)
              .slice(0, 2);
            const trustValue = Math.max(
              1,
              Math.min(
                5,
                Math.round(Number(supplier.trustLevel ?? supplier.autoTrustScore ?? 0) || 0),
              ),
            );
            const hasContact = !!String(supplier.whatsapp || supplier.phone || '').trim();
            const avatarPalettes = [
              'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)',
              'linear-gradient(135deg, #0f766e 0%, #34d399 100%)',
              'linear-gradient(135deg, #334155 0%, #94a3b8 100%)',
              'linear-gradient(135deg, #b45309 0%, #fbbf24 100%)',
            ];
            const avatarIndex =
              supplier.name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) %
              avatarPalettes.length;
            const distanceLabel = Number.isFinite(distanceKm)
              ? `${Math.max(0.1, Number(distanceKm.toFixed(1)))} km`
              : 'n/a';
            const contactLabel = hasContact ? 'Контакт есть' : 'Нет контакта';
            const replyLabel = isReplied ? 'Replied' : isContacted ? 'Written' : null;
            return (
              <div
                id={`supplier-card-${supplier.id}`}
                key={supplier.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (isSelectionMode) {
                    toggleSupplierSelection(supplier.id);
                    return;
                  }
                  setFullscreenSupplierId(supplier.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (isSelectionMode) toggleSupplierSelection(supplier.id);
                    else setFullscreenSupplierId(supplier.id);
                  }
                }}
                onPointerDown={(event) => startLongPress(supplier.id, event)}
                onPointerMove={trackLongPressMove}
                onPointerUp={finishLongPress}
                onPointerCancel={() => cancelLongPress()}
                onPointerLeave={() => cancelLongPress()}
                className={`group w-full rounded-[20px] border px-2.5 py-2 text-left shadow-[0_10px_24px_rgba(15,23,42,0.045)] ring-1 ring-white/70 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(15,23,42,0.065)] active:scale-[0.992] ${isSelected ? 'border-blue-300 bg-blue-50/70 ring-blue-100' : 'border-white/85 bg-white/88'}`}
              >
                <div className="flex min-h-[72px] items-center gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsSelectionMode(true);
                      toggleSupplierSelection(supplier.id);
                    }}
                    className={`ds-press inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold shadow-[0_4px_10px_rgba(15,23,42,0.04)] ${isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300/80 bg-white text-transparent'}`}
                    aria-label={isSelected ? 'Снять выбор с поставщика' : 'Выбрать поставщика'}
                  >
                    ✓
                  </button>
                  {(supplier.photos && supplier.photos.length > 0) || supplier.photoUrl ? (
                    <img
                      src={((supplier.photos && supplier.photos[0]) || supplier.photoUrl) as string}
                      alt={supplier.name}
                      className="h-11 w-11 shrink-0 rounded-full object-cover shadow-[0_8px_18px_rgba(15,23,42,0.11)] ring-1 ring-white"
                    />
                  ) : (
                    <div
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-[0_8px_18px_rgba(15,23,42,0.11)] ring-1 ring-white"
                      style={{ background: avatarPalettes[avatarIndex] }}
                    >
                      {supplierInitials(supplier.name)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 self-center">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-[14px] font-bold leading-tight tracking-normal text-slate-950">
                        {supplier.name}
                      </p>
                      {supplier.isPinned && (
                        <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                          PIN
                        </span>
                      )}
                      {supplier.isFavorite && (
                        <Heart size={12} className="shrink-0 fill-rose-500 text-rose-500" />
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] font-semibold leading-tight text-slate-500">
                      {brands.slice(0, 2).join(', ') || 'Марки не указаны'} ·{' '}
                      {supplier.zone || supplier.location || 'Локация не указана'}
                    </p>
                    <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.04em]">
                      <span className="shrink-0 rounded-full bg-slate-100/90 px-1.5 py-1 text-slate-500">
                        Обычн.
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-100/90 px-1.5 py-1 text-slate-500">
                        T{trustValue}/5
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-1 ${hasContact ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-700'}`}
                      >
                        {contactLabel}
                      </span>
                      {replyLabel && (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-1 text-emerald-700">
                          {replyLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-[11px] font-medium leading-none text-slate-400">
                      {typeLabels.join(' + ') || 'Supplier'} ·{' '}
                      {(supplier.models || []).slice(0, 2).join(' • ') || 'Модели не указаны'} ·{' '}
                      {distanceLabel}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openWhatsApp(supplier);
                      }}
                      className="ds-press inline-flex h-9 w-9 items-center justify-center rounded-[14px] bg-emerald-500 text-white shadow-[0_8px_18px_rgba(16,185,129,0.2)]"
                      aria-label="WhatsApp"
                    >
                      <MessageCircle size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPhone(supplier);
                      }}
                      className="ds-press inline-flex h-9 w-9 items-center justify-center rounded-[14px] border border-slate-200/80 bg-slate-50/90 text-slate-700"
                      aria-label="Позвонить"
                    >
                      <Phone size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openSupplierActions(supplier.id);
                      }}
                      className="ds-press inline-flex h-9 w-9 items-center justify-center rounded-[14px] border border-slate-200/80 bg-white/90 text-slate-600"
                      aria-label="Действия поставщика"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>

      {isBrandsDrawerOpen && (
        <div
          className="fixed inset-0 z-[75] bg-black/40"
          onClick={() => setIsBrandsDrawerOpen(false)}
        >
          <div
            className="ml-auto h-full w-[86%] max-w-xs rounded-l-3xl bg-white p-4 shadow-2xl transition-transform duration-300 ease-out translate-x-0"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold uppercase text-slate-900">Марки</p>
                <p className="text-xs font-semibold text-slate-500">
                  Выберите марку, чтобы показать её поставщиков.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsBrandsDrawerOpen(false)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"
              >
                Закрыть
              </button>
            </div>
            <div className="space-y-2 overflow-y-auto pb-6">
              <button
                type="button"
                onClick={() => {
                  setSelectedBrandView(null);
                  setIsBrandsDrawerOpen(false);
                }}
                className={`w-full rounded-2xl px-3 py-3 text-left text-sm font-bold ${!selectedBrandView ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
              >
                Все марки
              </button>
              {availableBrands.map((brand) => (
                <button
                  key={brand}
                  type="button"
                  onClick={() => {
                    setSelectedBrandView(brand);
                    setIsBrandsDrawerOpen(false);
                  }}
                  className={`w-full rounded-2xl px-3 py-3 text-left text-sm font-bold ${selectedBrandView === brand ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
                >
                  {brand}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {null}

      <div className="pointer-events-none fixed bottom-[calc(92px+env(safe-area-inset-bottom))] left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="pointer-events-auto grid h-14 w-14 place-items-center rounded-full bg-blue-600 text-white shadow-[0_18px_36px_rgba(37,99,235,0.34)] ring-4 ring-white/85 transition active:scale-[0.96]"
            aria-label="Добавить поставщика"
          >
            <UserPlus size={25} strokeWidth={2.5} />
          </button>
        </div>
      </div>

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
        <div
          className="fixed inset-0 z-[80] overflow-hidden bg-black/40 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setFullscreenSupplierId(null);
          }}
        >
          <div className="flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(92dvh,760px)] sm:max-h-[92dvh] sm:max-w-2xl sm:rounded-3xl">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]">
              <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
                <button
                  type="button"
                  onClick={() => setFullscreenSupplierId(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                >
                  Закрыть
                </button>
                <p className="truncate px-2 text-sm font-bold text-slate-800">
                  {fullscreenSupplier.name}
                </p>
                <div className="relative" ref={fullscreenMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsFullscreenMenuOpen((prev) => !prev)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-slate-500"
                    aria-label="Открыть меню поставщика"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {isFullscreenMenuOpen && (
                    <div className="absolute right-0 top-9 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setFullscreenSupplierId(null);
                          startEditSupplier(fullscreenSupplier);
                          setIsFullscreenMenuOpen(false);
                        }}
                        className="inline-flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteSupplierId(fullscreenSupplier.id);
                          setIsFullscreenMenuOpen(false);
                        }}
                        className="inline-flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="relative">
                {fullscreenSupplier.photos?.[0] ? (
                  <img
                    src={fullscreenSupplier.photos[0]}
                    alt={fullscreenSupplier.name}
                    className="h-44 w-full object-cover"
                  />
                ) : (
                  <div className="h-44 w-full bg-gradient-to-r from-slate-700 to-slate-900" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
                <div className="absolute bottom-0 w-full px-5 pb-4 text-white">
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-2xl font-bold tracking-tight text-white">
                        {fullscreenSupplier.name}
                      </p>
                      <p className="mt-1 truncate text-xs font-semibold text-white/80">
                        {fullscreenSupplier.zone ||
                          fullscreenSupplier.location ||
                          'Локация не указана'}
                      </p>
                      <p className="mt-1 truncate text-[11px] font-semibold text-white/70">
                        {pickSupplierBrands(fullscreenSupplier).slice(0, 6).join(' • ') ||
                          'Марки не указаны'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] font-bold uppercase tracking-wide text-white/90">
                      <span className="rounded-full bg-white/15 px-2 py-1">
                        ⭐{' '}
                        {Math.max(
                          1,
                          Math.min(
                            5,
                            Math.round(
                              Number(
                                fullscreenSupplier.trustLevel ??
                                  fullscreenSupplier.autoTrustScore ??
                                  0,
                              ) || 0,
                            ),
                          ),
                        )}
                        /5
                      </span>
                      <span className="rounded-full bg-white/15 px-2 py-1">
                        {fullscreenSupplier.whatsappFast ? 'Fast reply' : 'Standard'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
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
                      Map
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
                      <p className="mt-1">{(fullscreenSupplier.models || []).join(', ') || '—'}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => setIsFullscreenOrderLinkOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        Привязка
                      </p>
                      <p className="mt-0.5 text-sm font-bold text-slate-900">Привязать к заказу</p>
                    </div>
                    <ChevronDown
                      size={16}
                      className={`text-slate-400 transition-transform ${isFullscreenOrderLinkOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {isFullscreenOrderLinkOpen && (
                    <div className="space-y-2 px-4 pb-4">
                      <input
                        value={fullscreenOrderSearch}
                        onChange={(e) => setFullscreenOrderSearch(e.target.value)}
                        placeholder="Поиск заказа (brand / model / VIN)"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold"
                      />
                      <select
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
                        onClick={() => {
                          const selectedOrderId = selectedOrderBySupplier[fullscreenSupplier.id];
                          if (!selectedOrderId) return;
                          const selectedOrder = activeOrders.find(
                            (order) => order.id === selectedOrderId,
                          );
                          if (!selectedOrder) return;
                          addSupplierToOrder(
                            fullscreenSupplier.id,
                            selectedOrderId,
                            selectedOrder.parts.map((part) => part.id),
                          );
                          toast('Поставщик привязан к заказу', 'success');
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
      )}

      {visitFormSupplierId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 space-y-2">
            <p className="text-sm font-bold">🏪 Посетил лично</p>
            <input
              value={visitOwnerName}
              onChange={(e) => setVisitOwnerName(e.target.value)}
              placeholder="Имя владельца"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
            />
            <input
              value={visitPartsCount}
              onChange={(e) => setVisitPartsCount(e.target.value)}
              placeholder="Количество деталей"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
            />
            <input
              value={visitShopSize}
              onChange={(e) => setVisitShopSize(e.target.value)}
              placeholder="Размер магазина"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
            />
            <textarea
              value={visitComment}
              onChange={(e) => setVisitComment(e.target.value)}
              placeholder="Комментарий"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold min-h-[88px]"
            />
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={onVisitPhotoChange}
              className="w-full text-xs"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVisitFormSupplierId(null)}
                className="flex-1 rounded-xl bg-gray-100 py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveVisitInteraction}
                className="flex-1 rounded-xl bg-violet-600 text-white py-2 text-xs font-bold"
              >
                Save visit
              </button>
            </div>
          </div>
        </div>
      )}

      {actionModalSupplierId &&
        (() => {
          const actionSupplier = suppliers.find(
            (supplier) => supplier.id === actionModalSupplierId,
          );
          if (!actionSupplier) return null;
          return (
            <div
              className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-3"
              onClick={() => setActionModalSupplierId(null)}
            >
              <div
                className="w-full max-w-sm rounded-[28px] bg-white p-4 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <p className="text-sm font-bold text-slate-900">Действия с карточкой</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{actionSupplier.name}</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      togglePinned(actionSupplier);
                      setActionModalSupplierId(null);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-bold text-slate-700"
                  >
                    <Pin size={14} />
                    {actionSupplier.isPinned ? 'Открепить' : 'Закрепить'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      toggleFavorite(actionSupplier);
                      setActionModalSupplierId(null);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-bold text-slate-700"
                  >
                    <Heart size={14} />
                    {actionSupplier.isFavorite ? 'Убрать' : 'Избранное'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      openQuickPhotoPicker(actionSupplier.id);
                      setActionModalSupplierId(null);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-bold text-slate-700"
                  >
                    <Camera size={14} />
                    Фото
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      startEditSupplier(actionSupplier);
                      setActionModalSupplierId(null);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-bold text-slate-700"
                  >
                    <Pencil size={14} />
                    Редактировать
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteSupplierId(actionSupplier.id);
                      setActionModalSupplierId(null);
                    }}
                    className="col-span-2 inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs font-bold text-rose-700"
                  >
                    <Trash2 size={14} />
                    Удалить
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setActionModalSupplierId(null)}
                  className="mt-3 w-full rounded-2xl bg-slate-900 px-3 py-3 text-xs font-bold text-white"
                >
                  Закрыть
                </button>
              </div>
            </div>
          );
        })()}

      {contactEditorSupplierId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 space-y-3">
            <p className="text-sm font-bold">Добавить контакт</p>
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="Phone (+971...)"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
            />
            <input
              value={contactWhatsapp}
              onChange={(e) => setContactWhatsapp(e.target.value)}
              placeholder="WhatsApp (optional)"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setContactEditorSupplierId(null)}
                className="flex-1 rounded-xl bg-gray-100 py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingContact}
                onClick={saveSupplierContact}
                className="flex-1 rounded-xl bg-blue-600 text-white py-2 text-xs font-bold disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!pendingOrderRemoval}
        message="Убрать поставщика из выбранного заказа?"
        onConfirm={() => {
          if (
            !pendingOrderRemoval ||
            !fullscreenSupplier ||
            pendingOrderRemoval.supplierId !== fullscreenSupplier.id
          )
            return;
          removeSupplierFromOrder(fullscreenSupplier, pendingOrderRemoval.orderId);
          setPendingOrderRemoval(null);
        }}
        onCancel={() => setPendingOrderRemoval(null)}
      />

      <ConfirmModal
        isOpen={deleteSupplierId === '__bulk__'}
        message={`Удалить выбранных поставщиков (${selectedSupplierIds.length})?`}
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        confirmClass="bg-red-600"
        onConfirm={confirmBulkDeleteSuppliers}
        onCancel={() => setDeleteSupplierId(null)}
      />
      <ConfirmModal
        isOpen={!!deleteSupplierId && deleteSupplierId !== '__bulk__'}
        message="Вы уверены, что хотите удалить этого поставщика?"
        onConfirm={confirmDeleteSupplier}
        onCancel={() => setDeleteSupplierId(null)}
      />
      {gallery && (
        <ImagePreview
          images={gallery.images}
          initialIndex={gallery.index}
          onClose={() => setGallery(null)}
        />
      )}

      <ConfirmModal
        isOpen={!!importFile}
        message={`Восстановить резервную копию?\n\nДата: ${importFile?.exportedAt ? new Date(importFile.exportedAt).toLocaleDateString() : 'Неизвестно'}\nЗаказов: ${importFile?.orders?.length || 0}\nПоставщиков: ${importFile?.suppliers?.length || 0}\n\nВНИМАНИЕ: Все текущие данные будут заменены!`}
        confirmLabel="Восстановить"
        cancelLabel="Отмена"
        confirmClass="bg-red-600"
        onConfirm={confirmRestore}
        onCancel={() => setImportFile(null)}
      />
    </div>
  );
};

export default SuppliersScreen;
