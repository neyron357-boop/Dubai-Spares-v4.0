import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore, syncSuppliersFromServer } from '../store';
import { Supplier, SupplierInteraction, SupplierInteractionType, SupplierLinkedPartEntry, SupplierLinkedPartStatus, SupplierStatus, SupplierType } from '../types';
import {
  Phone,
  MapPin,
  Store,
  UserPlus,
  Trash2,
  Tag,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Wrench,
  Gem,
  Link2,
  LocateFixed,
  Sparkles,
  Heart,
  Clock3,
  ChevronDown,
  ChevronUp,
  Route,
  MessageCircle,
  Pencil,
  Shuffle,
  MoreHorizontal
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import ImagePreview from '../components/ImagePreview';
import { resolveCoordinatesFromLocation } from '../mapsLocation';
import { upsertSupplierToShops, updateSupplierContacts } from '../radarShops';
import { createUuid } from '../id';
import { CAR_DATABASE } from '../carDatabase';
import { optimizeImageForUpload } from '../storage/photos';
import { addRadarManualSelection, getRadarManualSelections, RADAR_MANUAL_SELECTIONS_EVENT, removeRadarManualSelection } from '../radarManualSelections';
import { toast } from '../feedback';

const FIELD_TYPES: Array<{ value: SupplierType; label: string; icon: React.ReactNode }> = [
  { value: 'new_parts', label: 'New Parts', icon: <Gem size={12} /> },
  { value: 'scrapyard', label: 'Scrapyard', icon: <Wrench size={12} /> },
  { value: 'engine_specialist', label: 'Engine Specialist', icon: <Wrench size={12} /> },
  { value: 'body_parts', label: 'Body Parts', icon: <Wrench size={12} /> },
  { value: 'electrical', label: 'Electrical', icon: <Sparkles size={12} /> },
  { value: 'mixed', label: 'Mixed', icon: <Store size={12} /> },
  { value: 'dealer', label: 'Dealer', icon: <Store size={12} /> },
  { value: 'warehouse', label: 'Warehouse', icon: <Store size={12} /> }
];

const ZONE_GEOFENCES = [
  { name: 'Sajaa', bounds: { minLat: 25.29, maxLat: 25.37, minLng: 55.48, maxLng: 55.58 } },
  { name: 'Ras Al Khor', bounds: { minLat: 25.16, maxLat: 25.21, minLng: 55.34, maxLng: 55.4 } },
  { name: 'Al Qusais', bounds: { minLat: 25.24, maxLat: 25.29, minLng: 55.37, maxLng: 55.44 } },
  { name: 'Sharjah Industrial', bounds: { minLat: 25.26, maxLat: 25.34, minLng: 55.39, maxLng: 55.47 } }
];

const SUPPLIER_PART_CATEGORIES = [
  'ДВС / Двигатели',
  'АКПП / МКПП',
  'Механические детали',
  'Кузовные детали',
  'Электрика / Электроника',
  'Подвеска / Ходовая',
  'Салон / Интерьер',
  'Оптика / Освещение'
];


const SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  responded: 'Responded',
  visited: 'Visited',
  verified: 'Verified',
  trusted: 'Trusted',
  blacklist: 'Blacklist'
};

const MAIN_STATUS_PRIORITY: SupplierStatus[] = ['trusted', 'visited', 'responded', 'contacted', 'new'];

const pickPriorityStatus = (current: SupplierStatus | undefined, incoming: SupplierStatus): SupplierStatus => {
  if (!current) return incoming;
  const currentRank = MAIN_STATUS_PRIORITY.indexOf(current);
  const incomingRank = MAIN_STATUS_PRIORITY.indexOf(incoming);
  if (currentRank === -1) return incoming;
  if (incomingRank === -1) return current;
  return currentRank <= incomingRank ? current : incoming;
};

const SUPPLIER_STATUS_COLORS: Record<SupplierStatus, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  contacted: 'bg-amber-50 text-amber-700 border-amber-200',
  responded: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  visited: 'bg-violet-50 text-violet-700 border-violet-200',
  verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  trusted: 'bg-green-100 text-green-800 border-green-300',
  blacklist: 'bg-rose-100 text-rose-800 border-rose-300'
};

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

const toTitle = (value: string) => value
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
  .join(' ');

const supplierInitials = (name: string) => name
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


const timelineLabel = (ts?: number) => {
  if (!ts || !Number.isFinite(ts)) return '—';
  const date = new Date(ts);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startEventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startToday - startEventDay) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString();
};

const pickSupplierBrands = (supplier: Supplier) => {
  const main = Array.isArray(supplier.mainBrands) ? supplier.mainBrands.filter(Boolean) : [];
  const fallback = Array.isArray(supplier.brands) ? supplier.brands.filter(Boolean) : [];
  return main.length > 0 ? main : fallback;
};

const normalizeSupplierYears = (years: unknown): number[] => {
  const parsed = Array.isArray(years)
    ? years
    : typeof years === 'string'
      ? years.split(',')
      : [];

  const normalized = parsed
    .map((year) => Number(typeof year === 'string' ? year.trim() : year))
    .filter((year) => Number.isFinite(year));

  return Array.from(new Set(normalized)).sort((a, b) => a - b);
};

const deriveSupplierMetaFromOrderIds = (
  supplier: Supplier,
  orderIds: string[],
  orders: Array<{ id: string; brand?: string; model?: string; year?: number | string }>
) => {
  const relatedOrders = orderIds
    .map((orderId) => orders.find((order) => order.id === orderId))
    .filter(Boolean) as Array<{ id: string; brand?: string; model?: string; year?: number | string }>;

  const derivedBrands = mergeUniqueStrings([], relatedOrders.map((order) => order.brand || ''));
  const derivedModels = mergeUniqueStrings([], relatedOrders.map((order) => order.model || ''));
  const derivedYears = mergeUniqueYears([], relatedOrders.map((order) => Number(order.year)));

  return {
    mainBrands: derivedBrands,
    brands: derivedBrands,
    models: derivedModels,
    years: derivedYears,
    primaryBrand: derivedBrands[0] || supplier.primaryBrand || ''
  };
};


const LINKED_PART_STATUS_LABELS: Record<SupplierLinkedPartStatus, string> = {
  searching: 'В поиске',
  found: 'Найдено',
  not_found: 'Не найдено',
  follow_up: 'Нужен follow-up'
};

const upsertLinkedPartEntry = (entries: SupplierLinkedPartEntry[] = [], entry: SupplierLinkedPartEntry): SupplierLinkedPartEntry[] => {
  const index = entries.findIndex((item) => item.orderId === entry.orderId && item.partId === entry.partId);
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
  const matched = ZONE_GEOFENCES.find((zone) => (
    coords.lat >= zone.bounds.minLat
      && coords.lat <= zone.bounds.maxLat
      && coords.lng >= zone.bounds.minLng
      && coords.lng <= zone.bounds.maxLng
  ));
  return matched?.name || '';
};

const calcDistanceKm = (
  supplier: Supplier & { coordinates?: { lat: number; lng: number } },
  reference: { lat: number; lng: number }
) => {
  if (!supplier.coordinates) return Number.POSITIVE_INFINITY;
  const latDiff = (supplier.coordinates.lat - reference.lat) * 111;
  const lngDiff = (supplier.coordinates.lng - reference.lng) * 111;
  return Math.sqrt((latDiff * latDiff) + (lngDiff * lngDiff));
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const normalizeToken = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const parseCsvTokens = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => normalizeToken(item)).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => normalizeToken(item)).filter(Boolean);
  return [];
};

const inferPartCategory = (part: { name?: string; category?: string } | null) => {
  const explicit = normalizeToken(part?.category);
  if (explicit) return explicit;
  const source = normalizeToken(part?.name);
  if (!source) return '';
  if (/(bumper|bonnet|fender|door)/.test(source)) return 'body';
  if (/(engine|gearbox|transmission)/.test(source)) return 'mechanical';
  if (/(light|headlamp)/.test(source)) return 'optics';
  if (/(sensor|module|ecu)/.test(source)) return 'electrical';
  return '';
};

const mapSupplierCategory = (value: string) => {
  const normalized = normalizeToken(value);
  if (!normalized) return '';
  if (/(кузов|body|bumper|bonnet|fender|door)/.test(normalized)) return 'body';
  if (/(двс|мкпп|акпп|механ|engine|gearbox|transmission|mechanical)/.test(normalized)) return 'mechanical';
  if (/(оптик|light|headlamp|optics)/.test(normalized)) return 'optics';
  if (/(элект|electrical|sensor|module|ecu)/.test(normalized)) return 'electrical';
  return normalized;
};

const SuppliersScreen: React.FC = () => {
  const { suppliers, addSupplier, deleteSupplier, restoreData, orders, updateOrder, updateSupplier, lastSuppliersSyncError } = useStore();
  const locationRoute = useLocation();

  const [isAdding, setIsAdding] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quickPhotoInputRef = useRef<HTMLInputElement>(null);
  const fullscreenMenuRef = useRef<HTMLDivElement>(null);
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
  const [activeOrderLinkShopId, setActiveOrderLinkShopId] = useState<string | null>(null);
  const [activeOrderPartLink, setActiveOrderPartLink] = useState<{ supplierId: string; orderId: string; partId: string } | null>(null);
  const [selectedOrderBySupplier, setSelectedOrderBySupplier] = useState<Record<string, string>>({});
  const [fullscreenOrderSearch, setFullscreenOrderSearch] = useState('');
  const [pendingOrderRemoval, setPendingOrderRemoval] = useState<{ supplierId: string; orderId: string } | null>(null);
  const [supplierSearchQuery, setSupplierSearchQuery] = useState('');
  const [isInitialSuppliersLoading, setIsInitialSuppliersLoading] = useState(true);

  const [contactEditorSupplierId, setContactEditorSupplierId] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [sortByDistanceRef, setSortByDistanceRef] = useState<{ lat: number; lng: number }>({ lat: 25.2048, lng: 55.2708 });
  const [sortByExtended, setSortByExtended] = useState<'smart' | 'fast' | 'trust' | 'heat' | 'near' | 'name'>('smart');
  const [brandFilter, setBrandFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [selectedBrandView, setSelectedBrandView] = useState<string | null>(null);
  const [selectedModelView, setSelectedModelView] = useState<string | null>(null);
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
  const [expandedSupplierIds, setExpandedSupplierIds] = useState<Set<string>>(new Set());
  const [expandedAddedPartsIds, setExpandedAddedPartsIds] = useState<Set<string>>(new Set());
  const [overflowSupplierId, setOverflowSupplierId] = useState<string | null>(null);
  const [fullHistorySupplierIds, setFullHistorySupplierIds] = useState<Set<string>>(new Set());
  const [manualRadarCounts, setManualRadarCounts] = useState<Record<string, number>>({});
  const [manualSelections, setManualSelections] = useState(() => getRadarManualSelections());
  const [topRequest, setTopRequest] = useState<{ orderId: string; partId: string } | null>(null);
  const [bulkSendQueueSupplierIds, setBulkSendQueueSupplierIds] = useState<string[]>([]);
  const [bulkSendIndex, setBulkSendIndex] = useState(0);
  const [bulkSendMode, setBulkSendMode] = useState<3 | 5 | null>(null);
  const [bulkSendStartedAt, setBulkSendStartedAt] = useState<number | null>(null);


  const activeOrders = useMemo(
    () => orders.filter((order) => !order.isArchived && !order.isSold),
    [orders]
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

  const manualSelectionsBySupplier = useMemo(() => {
    const grouped: Record<string, Array<{ orderId: string; orderLabel: string; partId: string; partName: string }>> = {};
    manualSelections
      .filter((item) => (item.source || 'manual') === 'manual')
      .forEach((item) => {
        const order = activeOrders.find((row) => row.id === item.orderId);
        if (!order) return;
        const part = order.parts.find((row) => row.id === item.partId);
        if (!part) return;
        if (!grouped[item.supplierId]) grouped[item.supplierId] = [];
        grouped[item.supplierId].push({
          orderId: order.id,
          orderLabel: `${order.brand} ${order.model} • ${order.vin}`,
          partId: part.id,
          partName: part.name
        });
      });
    return grouped;
  }, [manualSelections, activeOrders]);

  const brandOptions = useMemo(() => Object.keys(CAR_DATABASE).sort((a, b) => a.localeCompare(b)), []);

  const supplierStatsMap = useMemo(() => {
    const stats: Record<string, { interactions30d: number; found: number; notFound: number; wrongInfo: number; responsePoints: number; lastContactAt: number; avgCheck: number; orderCount: number }> = {};
    const monthAgo = Date.now() - 1000 * 60 * 60 * 24 * 30;

    const ensure = (key: string) => {
      if (!stats[key]) {
        stats[key] = { interactions30d: 0, found: 0, notFound: 0, wrongInfo: 0, responsePoints: 0, lastContactAt: 0, avgCheck: 0, orderCount: 0 };
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

  const existingByName = useMemo(() => suppliers.map((s) => s.name.trim().toLowerCase()), [suppliers]);
  const nameNormalized = name.trim().toLowerCase();
  const duplicateWarning = useMemo(() => {
    if (!nameNormalized) return '';
    const close = existingByName.find((value) => value.includes(nameNormalized) || nameNormalized.includes(value));
    return close ? `Похожий поставщик уже есть: ${close}` : '';
  }, [existingByName, nameNormalized]);

  const currentPhone = normalizePhone(phone);
  const hasWhatsapp = isValidE164(currentPhone);

  const filteredBrandOptions = useMemo(
    () => brandOptions.filter((brand) => brand.toLowerCase().includes(brandSearch.toLowerCase())),
    [brandOptions, brandSearch]
  );


  const suppliersWithStats = useMemo(() => suppliers.map((supplier) => {
    const key = supplier.name.trim().toLowerCase();
    const calculated = supplierStatsMap[key] || { interactions30d: 0, found: 0, notFound: 0, wrongInfo: 0, responsePoints: 0, lastContactAt: 0, avgCheck: 0, orderCount: 0 };
    const foundCount = Number.isFinite(Number(supplier.foundCount)) && Number(supplier.foundCount) > 0 ? Number(supplier.foundCount) : calculated.found;
    const notFoundCount = Number.isFinite(Number(supplier.notFoundCount)) && Number(supplier.notFoundCount) > 0 ? Number(supplier.notFoundCount) : calculated.notFound;
    const wrongInfoCount = Number.isFinite(Number(supplier.wrongInfoCount)) ? Number(supplier.wrongInfoCount) : calculated.wrongInfo;
    const total = foundCount + notFoundCount;
    const successRate = total > 0 ? Math.round((foundCount / total) * 100) : 0;
    const activityScore = foundCount * 2 + calculated.interactions30d + calculated.responsePoints;
    const avgCheck = calculated.orderCount > 0 ? Math.round(calculated.avgCheck / calculated.orderCount) : 0;
    const lastContactAt = Math.max(Number(supplier.lastContactAt || 0), calculated.lastContactAt || 0);

    return {
      ...supplier,
      foundCount,
      notFoundCount,
      wrongInfoCount,
      successRate,
      activityScore,
      avgCheck,
      lastContactAt,
      activityState: activityLabel(activityScore, lastContactAt)
    };
  }), [suppliers, supplierStatsMap]);

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
      partCategories: Array.from(new Set([...SUPPLIER_PART_CATEGORIES, ...partCategories])).sort((a, b) => a.localeCompare(b))
    };
  }, [rawSuppliers]);

  const filteredSuppliers = useMemo(() => {
    const selectedYear = Number(yearFilter);
    const hasSelectedYear = yearFilter !== 'all' && Number.isFinite(selectedYear);

    return [...rawSuppliers]
      .filter((supplier) => {
        const brandMatch = brandFilter === 'all' || pickSupplierBrands(supplier).includes(brandFilter);
        const modelMatch = modelFilter === 'all' || (supplier.models || []).includes(modelFilter);
        const supplierYears = normalizeSupplierYears(supplier.years);
        const yearMatch = !hasSelectedYear || supplierYears.includes(selectedYear);
        const categoryMatch = partCategoryFilter === 'all' || (supplier.mainPartCategories || []).includes(partCategoryFilter);
        const favoriteMatch = favoriteFilter === 'all' || supplier.isFavorite === true;
        const fastWhatsappMatch = fastWhatsappFilter === 'all' || supplier.whatsappFast === true;
        const visitTodayMatch = visitTodayFilter === 'all' || ((supplier.supplierStatus === 'contacted' || supplier.supplierStatus === 'responded') && supplier.supplierStatus !== 'visited' && !(Number(supplier.lastVisitedAt || 0) > 0));
        return brandMatch && modelMatch && yearMatch && categoryMatch && favoriteMatch && fastWhatsappMatch && visitTodayMatch;
      })
      .sort((a, b) => {
      const distanceA = calcDistanceKm(a, sortByDistanceRef);
      const distanceB = calcDistanceKm(b, sortByDistanceRef);

      if (sortByExtended === 'fast') {
        const fastA = a.whatsappFast === true ? 1 : 0;
        const fastB = b.whatsappFast === true ? 1 : 0;
        if (fastA !== fastB) return fastB - fastA;
        return (Number(b.trustLevel ?? b.autoTrustScore ?? 0) - Number(a.trustLevel ?? a.autoTrustScore ?? 0))
          || distanceA - distanceB
          || a.name.localeCompare(b.name);
      }

      if (sortByExtended === 'trust') return (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0)) || (Number(b.heatLevel || 0) - Number(a.heatLevel || 0)) || distanceA - distanceB || a.name.localeCompare(b.name);
      if (sortByExtended === 'heat') return (Number(b.heatLevel || 0) - Number(a.heatLevel || 0)) || (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0)) || distanceA - distanceB || a.name.localeCompare(b.name);
      if (sortByExtended === 'near') return distanceA - distanceB || (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0));
      if (sortByExtended === 'name') return a.name.localeCompare(b.name) || distanceA - distanceB;
      return (Number(b.supplierScore || 0) - Number(a.supplierScore || 0)) || (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0)) || (Number(b.heatLevel || 0) - Number(a.heatLevel || 0)) || distanceA - distanceB || a.name.localeCompare(b.name);
    });
  }, [brandFilter, fastWhatsappFilter, favoriteFilter, modelFilter, partCategoryFilter, rawSuppliers, sortByExtended, sortByDistanceRef, visitTodayFilter, yearFilter]);



  const activeOrderForTop = useMemo(() => {
    if (!topRequest?.orderId) return null;
    return activeOrders.find((order) => order.id === topRequest.orderId) || null;
  }, [activeOrders, topRequest?.orderId]);

  const selectedPartForTop = useMemo(() => {
    if (!activeOrderForTop || !topRequest?.partId) return null;
    return activeOrderForTop.parts.find((part) => part.id === topRequest.partId) || null;
  }, [activeOrderForTop, topRequest?.partId]);

  const topSuppliers = useMemo(() => {
    if (!activeOrderForTop || !selectedPartForTop) return [];

    const targetBrand = normalizeToken(activeOrderForTop.brand);
    const targetModel = normalizeToken(activeOrderForTop.model);
    const targetYear = Number(activeOrderForTop.year);
    const targetCategory = inferPartCategory(selectedPartForTop as { name?: string; category?: string });

    return filteredSuppliers
      .map((supplier) => {
        const distanceKm = calcDistanceKm(supplier, sortByDistanceRef);
        const brands = [supplier.primaryBrand, ...(supplier.mainBrands || []), ...(supplier.brands || [])]
          .map((item) => normalizeToken(item))
          .filter(Boolean);
        const models = parseCsvTokens(supplier.models);
        const years = normalizeSupplierYears(supplier.years);
        const categories = (supplier.mainPartCategories || []).map((item) => mapSupplierCategory(item)).filter(Boolean);

        const speedScore = supplier.whatsappFast === true ? 40 : supplier.whatsappFast === false ? 0 : 10;
        const trustRaw = Number(supplier.trustLevel ?? supplier.autoTrustScore ?? 0);
        const trustScore = Math.round((Math.max(0, Math.min(5, trustRaw)) / 5) * 20);

        const distanceScore = !Number.isFinite(distanceKm)
          ? 10
          : distanceKm <= 1 ? 20 : distanceKm <= 3 ? 16 : distanceKm <= 7 ? 12 : distanceKm <= 15 ? 8 : 4;

        const ageMs = Date.now() - Number(supplier.lastContactAt || 0);
        const freshnessPenalty = Number(supplier.lastContactAt || 0) <= 0
          ? 0
          : ageMs < 2 * 60 * 60 * 1000 ? -15 : ageMs < 24 * 60 * 60 * 1000 ? -8 : ageMs < 3 * 24 * 60 * 60 * 1000 ? -3 : 0;

        const brandMatch = targetBrand && brands.some((brand) => brand === targetBrand || brand.includes(targetBrand) || targetBrand.includes(brand));
        const modelMatch = targetModel && models.some((model) => model === targetModel || model.includes(targetModel) || targetModel.includes(model));
        const yearMatch = Number.isFinite(targetYear) && years.includes(targetYear);
        const categoryMatch = !!targetCategory && categories.some((category) => category === targetCategory || category.includes(targetCategory));
        const matchScore = categories.length === 0 && models.length === 0 && years.length === 0 && brands.length === 0
          ? 5
          : (brandMatch ? 15 : 0) + (modelMatch ? 10 : 0) + (yearMatch ? 5 : 0) + (categoryMatch ? 10 : 0);

        return {
          supplier,
          score: clampScore(speedScore + trustScore + distanceScore + freshnessPenalty + matchScore),
          distanceKm,
          speedLabel: supplier.whatsappFast === true ? 'FAST' : supplier.whatsappFast === false ? 'SLOW' : '?'
        };
      })
      .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm || a.supplier.name.localeCompare(b.supplier.name))
      .slice(0, 5);
  }, [activeOrderForTop, filteredSuppliers, selectedPartForTop, sortByDistanceRef]);

  const availableBrands = useMemo(() => {
    const brands = new Set<string>();
    rawSuppliers.forEach((supplier) => {
      pickSupplierBrands(supplier).forEach((brand) => {
        if (brand) brands.add(brand);
      });
    });
    return Array.from(brands).sort((a, b) => a.localeCompare(b));
  }, [rawSuppliers]);

  const modelsForSelectedBrand = useMemo(() => {
    if (!selectedBrandView) return [];
    const models = new Set<string>();
    rawSuppliers
      .filter((supplier) => pickSupplierBrands(supplier).includes(selectedBrandView))
      .forEach((supplier) => {
        (supplier.models || []).forEach((model) => {
          if (model) models.add(model);
        });
      });
    return Array.from(models).sort((a, b) => a.localeCompare(b));
  }, [rawSuppliers, selectedBrandView]);

  const suppliersForSelectedModel = useMemo(() => {
    if (!selectedBrandView || !selectedModelView) return [];
    return filteredSuppliers.filter((supplier) => (
      pickSupplierBrands(supplier).includes(selectedBrandView) && (supplier.models || []).includes(selectedModelView)
    ));
  }, [filteredSuppliers, selectedBrandView, selectedModelView]);

  const fullscreenSupplier = useMemo(
    () => suppliersForSelectedModel.find((supplier) => supplier.id === fullscreenSupplierId) || null,
    [fullscreenSupplierId, suppliersForSelectedModel]
  );


  const displayedSuppliersForSelectedModel = useMemo(() => {
    const query = supplierSearchQuery.trim().toLowerCase();
    if (!query) return suppliersForSelectedModel;
    return suppliersForSelectedModel.filter((supplier) => {
      const brands = pickSupplierBrands(supplier).join(' ').toLowerCase();
      const models = (supplier.models || []).join(' ').toLowerCase();
      const haystack = `${supplier.name} ${supplier.location || ''} ${brands} ${models}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [supplierSearchQuery, suppliersForSelectedModel]);

  const fullscreenSupplierOrders = useMemo(() => {
    if (!fullscreenSupplier) return [] as typeof activeOrders;
    const linkedOrderIds = new Set<string>();
    (fullscreenSupplier.activeOrderIds || []).forEach((orderId) => { if (orderId) linkedOrderIds.add(orderId); });
    (fullscreenSupplier.linkedParts || []).forEach((entry) => { if (entry.orderId) linkedOrderIds.add(entry.orderId); });

    return Array.from(linkedOrderIds)
      .map((orderId) => activeOrders.find((order) => order.id === orderId))
      .filter((order): order is (typeof activeOrders)[number] => !!order);
  }, [activeOrders, fullscreenSupplier]);

  const fullscreenOrderOptions = useMemo(() => {
    const query = fullscreenOrderSearch.trim().toLowerCase();
    const uniqueOrders = Array.from(new Map(activeOrders.map((order) => [order.id, order])).values());
    if (!query) return uniqueOrders;
    return uniqueOrders.filter((order) => (`${order.brand} ${order.model} ${order.vin}`).toLowerCase().includes(query));
  }, [activeOrders, fullscreenOrderSearch]);

  const buildAskPriceMessage = (orderId: string, partId: string) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return 'Hello\n\nNeed price and photo please.';
    const part = order.parts.find((item) => item.id === partId);
    const vehicleLine = [order.brand, order.model, order.year].map((item) => String(item || '').trim()).filter(Boolean).join(' ');
    return ['Hello', '', vehicleLine, part?.name || '', '', 'Need price and photo please.', '', 'I will send car photo.', 'Thanks']
      .filter((line, index, arr) => line || (arr[index - 1] && arr[index - 1] !== ''))
      .join('\n')
      .trim();
  };

  const openAskPrice = (supplier: Supplier, orderId: string, partId: string) => {
    const phone = (supplier.whatsapp || supplier.phone || '').replace(/[^\d]/g, '');
    if (!phone) {
      toast('У поставщика нет WhatsApp контакта', 'error');
      return;
    }
    const message = buildAskPriceMessage(orderId, partId);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
    updateSupplier({ ...supplier, lastContactAt: Date.now(), updatedAt: Date.now() });
  };


  const computeSupplierScore = (supplier: Supplier) => {
    const trust = Math.max(0, Math.min(5, Number(supplier.trustLevel ?? 0))) * 20;
    const responseSpeed = supplier.whatsappFast ? 20 : 8;
    const visit = supplier.supplierStatus === 'visited' || supplier.supplierStatus === 'verified' || supplier.supplierStatus === 'trusted' ? 20 : 0;
    const ordersCompleted = Math.min(20, Number(supplier.ordersCompleted || 0) * 2);
    const distanceKm = calcDistanceKm(supplier, sortByDistanceRef);
    const distance = Number.isFinite(distanceKm) ? Math.max(0, 20 - Math.round(distanceKm)) : 5;
    return clampScore(trust + responseSpeed + visit + ordersCompleted + distance);
  };

  const addSupplierInteraction = (supplier: Supplier, type: SupplierInteractionType, note: string, overrides: Partial<Supplier> = {}) => {
    const now = Date.now();
    const interaction: SupplierInteraction = {
      id: createUuid(),
      supplierId: supplier.id,
      type,
      date: now,
      note,
      createdAt: now
    };
    const nextSupplier = {
      ...supplier,
      interactions: [interaction, ...(supplier.interactions || [])],
      supplierScore: computeSupplierScore({ ...supplier, ...overrides }),
      updatedAt: now,
      ...overrides
    };
    updateSupplier(nextSupplier);
  };

  const markContacted = (supplier: Supplier) => {
    const isActive = (supplier.interactions || []).some((item) => item.type === 'whatsapp');
    if (isActive) {
      const nextSupplier = {
        ...supplier,
        interactions: (supplier.interactions || []).filter((item) => item.type !== 'whatsapp'),
        updatedAt: Date.now()
      };
      updateSupplier(nextSupplier);
      return;
    }
    addSupplierInteraction(supplier, 'whatsapp', 'WhatsApp message sent', {
      supplierStatus: pickPriorityStatus(supplier.supplierStatus, 'contacted'),
      lastContactAt: Date.now()
    });
  };

  const markResponded = (supplier: Supplier) => {
    const isActive = (supplier.interactions || []).some((item) => item.type === 'whatsapp_reply');
    if (isActive) {
      const nextSupplier = {
        ...supplier,
        interactions: (supplier.interactions || []).filter((item) => item.type !== 'whatsapp_reply'),
        updatedAt: Date.now()
      };
      updateSupplier(nextSupplier);
      return;
    }
    addSupplierInteraction(supplier, 'whatsapp_reply', 'Supplier replied in WhatsApp', {
      supplierStatus: pickPriorityStatus(supplier.supplierStatus, 'responded'),
      lastRespondedAt: Date.now(),
      lastContactAt: Date.now()
    });
  };

  const markVisitedQuick = (supplier: Supplier) => {
    const isActive = (supplier.interactions || []).some((item) => item.type === 'visit');
    if (isActive) {
      const nextSupplier = {
        ...supplier,
        interactions: (supplier.interactions || []).filter((item) => item.type !== 'visit'),
        updatedAt: Date.now()
      };
      updateSupplier(nextSupplier);
      toast('Отметка "Посетил" снята', 'success');
      return;
    }
    addSupplierInteraction(supplier, 'visit', 'Visited supplier', {
      supplierStatus: pickPriorityStatus(supplier.supplierStatus, 'visited'),
      lastVisitedAt: Date.now(),
      lastContactAt: Date.now()
    });
    toast('Статус "Посетил" сохранён', 'success');
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

  const resolveMainStatus = (supplier: Supplier): SupplierStatus => {
    const statusSet = new Set<SupplierStatus>();
    if (supplier.supplierStatus && MAIN_STATUS_PRIORITY.includes(supplier.supplierStatus)) {
      statusSet.add(supplier.supplierStatus);
    }
    (supplier.interactions || []).forEach((item) => {
      if (item.type === 'visit') statusSet.add('visited');
      if (item.type === 'whatsapp_reply') statusSet.add('responded');
      if (item.type === 'whatsapp' || item.type === 'call' || item.type === 'price_request') statusSet.add('contacted');
    });
    if (statusSet.size === 0) return 'new';
    return MAIN_STATUS_PRIORITY.find((status) => statusSet.has(status)) || 'new';
  };

  const startEditSupplier = (supplier: Supplier) => {
    setIsAdding(true);
    setEditingSupplierId(supplier.id);
    setName(supplier.name);
    setPhone(supplier.phone);
    setLocation(supplier.location);
    setShopType(supplier.type || 'new_parts');
    setShopTypes((supplier.types && supplier.types.length > 0 ? supplier.types : [supplier.type || 'new_parts']) as SupplierType[]);
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
      const optimized = await Promise.all(files.slice(0, 4).map(async (file) => optimizeImageForUpload(file, `suppliers:quick-photo:${file.name}`)));
      const nextPhotos = [...(targetSupplier.photos || []), ...optimized].filter(Boolean);
      updateSupplier({
        ...targetSupplier,
        photos: nextPhotos,
        photoUrl: nextPhotos[0] || targetSupplier.photoUrl,
        updatedAt: Date.now()
      });
      toast('Фото поставщика сохранено', 'success');
    } catch (error) {
      console.error('quick_photo_upload_failed', error);
      toast('Не удалось добавить фото', 'error');
    } finally {
      setQuickPhotoSupplierId(null);
    }
  };

  const startBulkSend = (mode: 3 | 5) => {
    if (!topRequest || topSuppliers.length === 0) return;
    const queue = topSuppliers.slice(0, mode).map((item) => item.supplier.id);
    setBulkSendQueueSupplierIds(queue);
    setBulkSendIndex(0);
    setBulkSendMode(mode);
    setBulkSendStartedAt(Date.now());
  };

  const cancelBulkSend = () => {
    setBulkSendQueueSupplierIds([]);
    setBulkSendIndex(0);
    setBulkSendMode(null);
    setBulkSendStartedAt(null);
  };

  const openBulkSendNext = () => {
    if (!topRequest || bulkSendQueueSupplierIds.length === 0) return;
    const supplierId = bulkSendQueueSupplierIds[bulkSendIndex];
    const supplier = suppliers.find((item) => item.id === supplierId);
    if (!supplier) return;
    openAskPrice(supplier, topRequest.orderId, topRequest.partId);
    if (bulkSendIndex >= bulkSendQueueSupplierIds.length - 1) {
      setBulkSendIndex(bulkSendQueueSupplierIds.length);
      return;
    }
    setBulkSendIndex((prev) => prev + 1);
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
    setMainBrands((prev) => prev.includes(brand) ? prev.filter((item) => item !== brand) : [...prev, brand]);
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
      const candidate = `${left[Math.floor(Math.random() * left.length)]} ${right[Math.floor(Math.random() * right.length)]} ${Math.floor(100 + (Math.random() * 9000))}`;
      if (!exists.has(candidate.toLowerCase())) {
        setName(candidate);
        return;
      }
    }
    setName(`Supplier ${Date.now()}`);
  };

  const toggleMainPartCategory = (category: string) => {
    setMainPartCategories((prev) => prev.includes(category)
      ? prev.filter((item) => item !== category)
      : [...prev, category]);
  };

  const importFromSimilar = () => {
    const query = name.trim().toLowerCase();
    if (!query) return;
    const similar = suppliers.find((supplier) => supplier.name.toLowerCase().includes(query) || query.includes(supplier.name.toLowerCase()));
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
      { enableHighAccuracy: true, timeout: 15000 }
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
    void Promise.all(files.map(async (file) => {
      try {
        return await optimizeImageForUpload(file, `suppliers:photo:${file.name}`);
      } catch {
        const reader = new FileReader();
        return await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file);
        });
      }
    })).then((images) => {
      setSupplierPhotos((prev) => [...prev, ...images.filter(Boolean)].filter(Boolean));
    });
    event.target.value = '';
  };

  const removeSupplierPhoto = (index: number) => {
    setSupplierPhotos((prev) => prev.filter((_, idx) => idx !== index));
  };

  const onVisitPhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    void Promise.all(files.map(async (file) => optimizeImageForUpload(file, `suppliers:visit:${file.name}`))).then((images) => {
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
      visitComment
    ].filter(Boolean).join('\n');

    addSupplierInteraction(supplier, 'visit', note || 'Visited supplier shop', {
      supplierStatus: 'visited',
      lastVisitedAt: Date.now(),
      lastContactAt: Date.now(),
      shopPhotos: [...(supplier.shopPhotos || []), ...visitPhotos],
      photos: [...(supplier.photos || []), ...visitPhotos]
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
      const resolvedCoordinates = coords || await resolveCoordinatesFromLocation(location, {
        fallbackQueries: buildSupplierFallbackQueries(),
        onManualLocationRequired: setLocationParseNotice
      });

      const inferredZone = zone || inferZoneFromCoords(resolvedCoordinates || undefined);

      const parsedModels = supplierModelsInput.split(',').map((item) => item.trim()).filter(Boolean);
      const parsedYears = supplierYearsInput.split(',').map((item) => Number(item.trim())).filter((year) => Number.isFinite(year));
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
        syncStatus: navigator.onLine ? 'synced' : 'pending_sync'
      };

      if (existingSupplier) updateSupplier(supplierPayload);
      else addSupplier(supplierPayload);

      if (navigator.onLine) {
        try {
          await upsertSupplierToShops(supplierPayload);
        } catch {
          updateSupplier({ ...supplierPayload, syncStatus: 'error' });
        }
      }

      resetAddForm();
      setIsAdding(false);
    } finally {
      setIsSavingSupplier(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json.orders) && Array.isArray(json.suppliers)) {
          setImportFile(json);
          setImportError(null);
        } else {
          setImportError('Неверный формат файла (отсутствуют заказы или поставщики)');
          setTimeout(() => setImportError(null), 3000);
        }
      } catch {
        setImportError('Ошибка чтения файла. Убедитесь, что это корректный JSON.');
        setTimeout(() => setImportError(null), 3000);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const confirmRestore = () => {
    if (importFile) {
      try {
        restoreData(importFile);
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
    if (!opened) toast('Не удалось открыть карту. Проверьте ссылку и блокировку всплывающих окон.', 'error');
  };

  const confirmDeleteSupplier = async () => {
    if (!deleteSupplierId) return;
    await deleteSupplier(deleteSupplierId);
    setDeleteSupplierId(null);
  };

  const toggleFavorite = (supplier: Supplier) => {
    updateSupplier({ ...supplier, isFavorite: !supplier.isFavorite, updatedAt: Date.now() });
  };

  const refreshManualSelections = () => {
    const selections = getRadarManualSelections();
    setManualSelections(selections);
    const next: Record<string, number> = {};
    selections
      .filter((item) => (item.source || 'manual') === 'manual')
      .forEach((item) => { next[item.supplierId] = (next[item.supplierId] || 0) + 1; });
    setManualRadarCounts(next);
  };

  const addSupplierToOrder = (shopId: string, orderId: string, selectedPartIds: string[] = []) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;

    const linkedSupplier = suppliers.find((item) => item.id === shopId);
    const isAlreadyLinked = (order.recommendedShopIds || []).includes(shopId)
      || !!linkedSupplier?.activeOrderIds?.includes(orderId)
      || !!linkedSupplier?.linkedParts?.some((entry) => entry.orderId === orderId);
    if (isAlreadyLinked) {
      toast('Поставщик уже добавлен в этот заказ', 'error');
      setActiveOrderLinkShopId(null);
      return;
    }
    const normalizedSupplierPhone = (linkedSupplier?.whatsapp || linkedSupplier?.phone || '').replace(/\D/g, '');
    const hasVendorContact = (order.vendorContacts || []).some((contact) => {
      const contactPhone = (contact.whatsapp || contact.phone || '').replace(/\D/g, '');
      return (linkedSupplier && contact.name.trim().toLowerCase() === linkedSupplier.name.trim().toLowerCase())
        || (!!normalizedSupplierPhone && normalizedSupplierPhone === contactPhone);
    });
    const nextVendorContacts = (!hasVendorContact && linkedSupplier)
      ? [{
        id: createUuid(),
        name: linkedSupplier.name,
        phone: linkedSupplier.phone || '',
        whatsapp: linkedSupplier.whatsapp || linkedSupplier.phone || '',
        mapUrl: linkedSupplier.location || '',
        note: linkedSupplier.comment || '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }, ...(order.vendorContacts || [])]
      : (order.vendorContacts || []);

    const current = new Set(order.recommendedShopIds || []);
    current.add(shopId);
    const nextDismissed = (order.dismissedShopIds || []).filter((id) => id !== shopId);
    updateOrder({ ...order, vendorContacts: nextVendorContacts, recommendedShopIds: Array.from(current), dismissedShopIds: nextDismissed, updatedAt: Date.now() });

    const partIds = selectedPartIds.length > 0
      ? selectedPartIds
      : (order.parts[0]?.id ? [order.parts[0].id] : []);
    partIds.forEach((partId) => addRadarManualSelection({ supplierId: shopId, orderId, partId, source: 'manual' }));

    if (linkedSupplier && order.brand) {
      const currentBrands = linkedSupplier.mainBrands || linkedSupplier.brands || [];
      const nextBrands = mergeUniqueStrings(currentBrands, [order.brand]);
      const nextModels = mergeUniqueStrings(linkedSupplier.models || [], [order.model || '']);
      const nextYears = mergeUniqueYears(normalizeSupplierYears(linkedSupplier.years), [Number(order.year)]);
      const nextEntries = partIds.reduce((acc, partId) => {
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
          updatedAt: Date.now()
        });
      }, [...(linkedSupplier.linkedParts || [])]);
      const updatedSupplier = {
        ...linkedSupplier,
        mainBrands: nextBrands,
        brands: nextBrands,
        primaryBrand: linkedSupplier.primaryBrand || order.brand,
        models: nextModels,
        years: nextYears,
        activeOrderIds: Array.from(new Set([...(linkedSupplier.activeOrderIds || []), order.id])),
        linkedParts: nextEntries,
        updatedAt: Date.now()
      };
      updateSupplier(updatedSupplier);
      void upsertSupplierToShops(updatedSupplier);
    }

    refreshManualSelections();
    setActiveOrderLinkShopId(null);
  };

  const addSupplierToOrderPart = () => {
    if (!activeOrderPartLink?.supplierId || !activeOrderPartLink.orderId || !activeOrderPartLink.partId) {
      alert('Выберите заказ и деталь перед добавлением.');
      return;
    }

    const order = orders.find((item) => item.id === activeOrderPartLink.orderId);
    if (!order) {
      alert('Заказ не найден. Обновите список и попробуйте снова.');
      return;
    }

    const part = order.parts.find((item) => item.id === activeOrderPartLink.partId);
    if (!part) {
      alert('Деталь не найдена. Выберите деталь заново.');
      return;
    }

    const linkedSupplier = suppliers.find((item) => item.id === activeOrderPartLink.supplierId);
    if (!linkedSupplier) {
      alert('Карточка поставщика не найдена. Обновите страницу.');
      return;
    }

    const current = new Set(order.recommendedShopIds || []);
    current.add(activeOrderPartLink.supplierId);
    const normalizedSupplierPhone = (linkedSupplier?.whatsapp || linkedSupplier?.phone || '').replace(/\D/g, '');
    const hasVendorContact = (order.vendorContacts || []).some((contact) => {
      const contactPhone = (contact.whatsapp || contact.phone || '').replace(/\D/g, '');
      return contact.name.trim().toLowerCase() === linkedSupplier.name.trim().toLowerCase()
        || (!!normalizedSupplierPhone && normalizedSupplierPhone === contactPhone);
    });
    const nextVendorContacts = hasVendorContact
      ? (order.vendorContacts || [])
      : [{
        id: createUuid(),
        name: linkedSupplier.name,
        phone: linkedSupplier.phone || '',
        whatsapp: linkedSupplier.whatsapp || linkedSupplier.phone || '',
        mapUrl: linkedSupplier.location || '',
        note: linkedSupplier.comment || '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }, ...(order.vendorContacts || [])];

    updateOrder({ ...order, vendorContacts: nextVendorContacts, recommendedShopIds: Array.from(current), updatedAt: Date.now() });
    addRadarManualSelection({ supplierId: activeOrderPartLink.supplierId, orderId: activeOrderPartLink.orderId, partId: activeOrderPartLink.partId, source: 'manual' });

    const currentBrands = linkedSupplier.mainBrands || linkedSupplier.brands || [];
    const nextBrands = mergeUniqueStrings(currentBrands, [order.brand]);
    const nextModels = mergeUniqueStrings(linkedSupplier.models || [], [order.model || '']);
    const nextYears = mergeUniqueYears(normalizeSupplierYears(linkedSupplier.years), [Number(order.year)]);
    const updatedSupplier = {
      ...linkedSupplier,
      mainBrands: nextBrands,
      brands: nextBrands,
      primaryBrand: linkedSupplier.primaryBrand || order.brand,
      models: nextModels,
      years: nextYears,
      activeOrderIds: Array.from(new Set([...(linkedSupplier.activeOrderIds || []), order.id])),
      linkedParts: upsertLinkedPartEntry(linkedSupplier.linkedParts || [], {
        id: createUuid(),
        orderId: order.id,
        orderLabel: `${order.brand} ${order.model} • ${order.vin}`,
        partId: part.id,
        partName: part.name,
        status: 'searching',
        source: 'manual',
        updatedAt: Date.now()
      }),
      updatedAt: Date.now()
    };
    updateSupplier(updatedSupplier);
    void upsertSupplierToShops(updatedSupplier);

    refreshManualSelections();
    setActiveOrderPartLink(null);
    alert('Деталь добавлена в блок активных заказов поставщика.');
  };

  const updateLinkedPartStatus = (supplier: Supplier, entry: SupplierLinkedPartEntry, status: SupplierLinkedPartStatus) => {
    const nextEntries = (supplier.linkedParts || []).map((item) => (
      item.id === entry.id ? { ...item, status, updatedAt: Date.now() } : item
    ));
    const nextSupplier = { ...supplier, linkedParts: nextEntries, updatedAt: Date.now() };
    updateSupplier(nextSupplier);
    void upsertSupplierToShops(nextSupplier);
  };

  const removeLinkedPartEntry = (supplier: Supplier, entry: SupplierLinkedPartEntry) => {
    const nextEntries = (supplier.linkedParts || []).filter((item) => item.id !== entry.id);
    const nextOrderIds = Array.from(new Set(nextEntries.map((item) => item.orderId).filter(Boolean)));
    const derivedMeta = deriveSupplierMetaFromOrderIds(supplier, nextOrderIds, orders);
    const nextSupplier = {
      ...supplier,
      ...derivedMeta,
      linkedParts: nextEntries,
      activeOrderIds: nextOrderIds,
      updatedAt: Date.now()
    };
    updateSupplier(nextSupplier);
    void upsertSupplierToShops(nextSupplier);
    removeRadarManualSelection({ supplierId: supplier.id, orderId: entry.orderId, partId: entry.partId });
    refreshManualSelections();
  };

  const removeSupplierFromOrder = (supplier: Supplier, orderId: string) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;

    const nextEntries = (supplier.linkedParts || []).filter((entry) => entry.orderId !== orderId);
    const nextOrderIds = Array.from(new Set(nextEntries.map((entry) => entry.orderId).filter(Boolean)));
    const normalizedSupplierPhone = (supplier.whatsapp || supplier.phone || '').replace(/\D/g, '');
    const nextVendorContacts = (order.vendorContacts || []).filter((contact) => {
      const byName = contact.name.trim().toLowerCase() === supplier.name.trim().toLowerCase();
      const contactPhone = (contact.whatsapp || contact.phone || '').replace(/\D/g, '');
      const byPhone = !!normalizedSupplierPhone && normalizedSupplierPhone === contactPhone;
      return !(byName || byPhone);
    });
    const nextRecommended = (order.recommendedShopIds || []).filter((shopId) => shopId !== supplier.id);

    updateOrder({ ...order, vendorContacts: nextVendorContacts, recommendedShopIds: nextRecommended, updatedAt: Date.now() });

    const derivedMeta = deriveSupplierMetaFromOrderIds(supplier, nextOrderIds, orders);
    const nextSupplier = {
      ...supplier,
      ...derivedMeta,
      linkedParts: nextEntries,
      activeOrderIds: nextOrderIds,
      updatedAt: Date.now()
    };
    updateSupplier(nextSupplier);
    void upsertSupplierToShops(nextSupplier);
    (supplier.linkedParts || [])
      .filter((entry) => entry.orderId === orderId)
      .forEach((entry) => removeRadarManualSelection({ supplierId: supplier.id, orderId: entry.orderId, partId: entry.partId }));
    refreshManualSelections();
  };

  useEffect(() => {
    void syncSuppliersFromServer(true);
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
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => setSortByDistanceRef({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => undefined);
  }, []);

  useEffect(() => {
    if (!isFullscreenMenuOpen) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (!fullscreenMenuRef.current) return;
      if (!fullscreenMenuRef.current.contains(event.target as Node)) setIsFullscreenMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [isFullscreenMenuOpen]);


  const openContactEditor = (supplier: Supplier) => {
    setContactEditorSupplierId(supplier.id);
    setContactPhone(supplier.phone || '');
    setContactWhatsapp((supplier.whatsapp || supplier.phone || '').trim());
  };

  const saveSupplierContact = async () => {
    if (!contactEditorSupplierId) return;
    const normalizedPhone = normalizePhone(contactPhone);
    if (!isValidE164(normalizedPhone)) return alert('Введите корректный номер в формате E.164 (+971...)');
    const normalizedWhatsapp = normalizePhone(contactWhatsapp || normalizedPhone);
    setIsSavingContact(true);
    try {
      const target = suppliers.find((item) => item.id === contactEditorSupplierId);
      if (!target) return;
      updateSupplier({ ...target, phone: normalizedPhone, whatsapp: normalizedWhatsapp, updatedAt: Date.now() });
      await updateSupplierContacts(contactEditorSupplierId, normalizedPhone, normalizedWhatsapp);
      setContactEditorSupplierId(null);
      alert('Контакт сохранён ✅');
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
  }, [fullscreenSupplierId]);

  useEffect(() => {
    if (!selectedBrandView) {
      setBrandFilter('all');
      setModelFilter('all');
      setSelectedModelView(null);
      return;
    }
    setBrandFilter(selectedBrandView);
    if (!selectedModelView) {
      setModelFilter('all');
      return;
    }
    setModelFilter(selectedModelView);
  }, [selectedBrandView, selectedModelView]);

  return (
    <div className="p-4 space-y-4 pb-32 overflow-x-hidden">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold">База Поставщиков</h1>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">{filteredSuppliers.length} suppliers</span>
        </div>
        <div className="grid grid-cols-3 rounded-2xl border border-slate-200 bg-white p-1 text-xs font-black">
          <button type="button" onClick={() => { setSelectedBrandView(null); setSelectedModelView(null); }} className={`rounded-xl px-2 py-2 ${!selectedBrandView ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>All suppliers</button>
          <button type="button" onClick={() => { if (!selectedBrandView) setSelectedBrandView(availableBrands[0] || null); setSelectedModelView(null); }} className={`rounded-xl px-2 py-2 ${selectedBrandView && !selectedModelView ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Brands</button>
          <button type="button" onClick={() => { if (selectedBrandView && modelsForSelectedBrand.length > 0) setSelectedModelView(modelsForSelectedBrand[0]); }} className={`rounded-xl px-2 py-2 ${selectedModelView ? 'bg-slate-900 text-white' : 'text-slate-600'} ${!selectedBrandView ? 'opacity-50' : ''}`}>Models</button>
        </div>
      </div>

      {selectedModelView && <div className="rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsFiltersOpen((prev) => !prev)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-slate-600"
          >
            Filters {isFiltersOpen ? '▲' : '▼'}
          </button>
          <button
            type="button"
            onClick={() => {
              setSortByExtended('smart');
              setBrandFilter('all');
              setModelFilter('all');
              setYearFilter('all');
              setPartCategoryFilter('all');
              setFavoriteFilter('all');
              setFastWhatsappFilter('all');
              setVisitTodayFilter('all');
            }}
            className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600"
          >
            Reset
          </button>
        </div>
        {isFiltersOpen && (
          <>
            <div className="mb-2">
              <select className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold" value={sortByExtended} onChange={(e) => setSortByExtended(e.target.value as any)}>
                <option value="smart">Sort: smart</option>
                <option value="fast">Fast first</option>
                <option value="trust">Trust ↓</option>
                <option value="heat">Heat ↓</option>
                <option value="near">Nearest</option>
                <option value="name">Name A→Z</option>
              </select>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold" value={fastWhatsappFilter} onChange={(e) => setFastWhatsappFilter(e.target.value as 'all' | 'fast')}>
                <option value="all">Fast WhatsApp: all</option>
                <option value="fast">Fast WhatsApp only</option>
              </select>
              <select className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold" value={favoriteFilter} onChange={(e) => setFavoriteFilter(e.target.value as 'all' | 'favorites')}>

                <option value="all">Suppliers: all</option>
                <option value="favorites">Избранные поставщики</option>
              </select>
              <select className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold" value={visitTodayFilter} onChange={(e) => setVisitTodayFilter(e.target.value as 'all' | 'visit_today')}>
                <option value="all">VISIT TODAY: off</option>
                <option value="visit_today">VISIT TODAY</option>
              </select>
              <select className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
                <option value="all">Brand: all</option>
                {supplierFilterOptions.brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
              </select>
              <select className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold" value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
                <option value="all">Model: all</option>
                {supplierFilterOptions.models.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
              <select className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                <option value="all">Year: all</option>
                {supplierFilterOptions.years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
              <select className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold" value={partCategoryFilter} onChange={(e) => setPartCategoryFilter(e.target.value)}>
                <option value="all">Part category: all</option>
                {supplierFilterOptions.partCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
          </>
        )}
      </div>}



      {importError && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 border border-red-100"><AlertTriangle size={16} />{importError}</div>}
      {showSuccess && <div className="bg-green-50 text-green-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 border border-green-100"><CheckCircle2 size={16} />Данные успешно восстановлены!</div>}

      {isAdding && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={() => { setIsAdding(false); resetAddForm(); }}>
          <form onSubmit={(e) => { e.preventDefault(); void handleSave(); }} className="bg-white w-full max-w-md rounded-3xl p-4 sm:p-5 shadow-2xl space-y-4 max-h-[85vh] sm:max-h-[90vh] overflow-y-auto overflow-x-hidden pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">{editingSupplierId ? "Редактировать поставщика" : "Добавить поставщика"}</h2>
                <p className="text-xs text-gray-400 font-semibold">Field Mode</p>
              </div>
              <button type="button" onClick={() => { setIsAdding(false); resetAddForm(); }} className="text-xs font-black text-gray-500">Cancel</button>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Название *</label>
                <button type="button" onClick={generateUniqueSupplierName} className="text-[10px] font-black uppercase text-blue-700 inline-flex items-center gap-1"><Shuffle size={11} /> Генерировать</button>
              </div>
              <input placeholder="Dubai Parts LTD" value={name} onChange={(e) => setName(toTitle(e.target.value))} autoComplete="off" className="w-full bg-gray-50 border border-gray-100 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base" />
              {duplicateWarning && <p className="text-[11px] text-amber-700 font-semibold mt-1">⚠️ {duplicateWarning}</p>}
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Телефон (E.164) *</label>
              <div className="flex gap-2">
                <input placeholder="+971..." value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" className="flex-1 bg-gray-50 border border-gray-100 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base" />
                {currentPhone && <a href={`tel:${currentPhone}`} className="px-3 rounded-xl bg-green-50 text-green-700 text-[10px] font-black inline-flex items-center gap-1"><Phone size={12} />Call</a>}
              </div>
              <p className={`text-[10px] mt-1 font-semibold ${isValidE164(currentPhone) ? 'text-green-700' : 'text-red-600'}`}>{isValidE164(currentPhone) ? `✔ ${currentPhone} · WhatsApp ${hasWhatsapp ? 'detected' : 'not detected'}` : 'Введите корректный E.164 (+971...)'}</p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">GPS / Maps *</label>
                <button type="button" onClick={autofillLocationFromGps} className="text-[10px] font-black uppercase text-blue-600 inline-flex items-center gap-1"><LocateFixed size={12} /> Определить местоположение</button>
              </div>
              <input placeholder="Ссылка Google Maps или адрес" value={location} onChange={(e) => { setLocation(e.target.value); setLocationParseNotice(null); }} autoComplete="off" className="w-full bg-gray-50 border border-gray-100 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base" />
              {gpsAccuracy !== null && <p className="text-[10px] text-blue-700 font-semibold mt-1">Точность: {gpsAccuracy}м</p>}
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Тип магазина</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {FIELD_TYPES.map((type) => (
                  <button key={type.value} type="button" onClick={() => toggleShopType(type.value)} className={`rounded-xl border px-3 py-2 text-[10px] font-black inline-flex items-center justify-center gap-2 ${shopTypes.includes(type.value) ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-white border-gray-200 text-gray-500'}`}>{type.icon} {type.label}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Зона (Geo-Fence)</label>
              <input placeholder="Автоподсказка по GPS" value={zone} onChange={(e) => setZone(e.target.value)} autoComplete="off" className="w-full bg-gray-50 border border-gray-100 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Main Brands</label>
                <button type="button" onClick={() => setIsFastBrandMode((prev) => !prev)} className="text-[10px] font-black text-blue-700">Multi-select fast mode: {isFastBrandMode ? 'ON' : 'OFF'}</button>
              </div>
              <input value={brandSearch} onChange={(e) => setBrandSearch(e.target.value)} placeholder="Поиск бренда" className="w-full bg-gray-50 border border-gray-100 p-2 rounded-xl outline-none text-xs font-semibold" />
              <div className="max-h-28 overflow-y-auto rounded-xl border border-gray-100 p-2 bg-gray-50 flex flex-wrap gap-1.5">
                {filteredBrandOptions.map((brand) => (
                  <button key={brand} type="button" onClick={() => toggleMainBrand(brand)} className={`px-2 py-1 rounded-lg text-[10px] font-black border ${mainBrands.includes(brand) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                    {brand}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={customBrand} onChange={(e) => setCustomBrand(e.target.value)} placeholder="Добавить свой бренд" className="flex-1 bg-gray-50 border border-gray-100 p-2 rounded-xl outline-none text-xs font-semibold" />
                <button type="button" onClick={addCustomBrand} className="px-3 rounded-xl bg-gray-100 text-gray-700 text-xs font-black">+ Add</button>
                <button type="button" onClick={importFromSimilar} className="px-3 rounded-xl bg-violet-50 text-violet-700 text-xs font-black">Импорт похожего</button>
              </div>
              <select className="w-full bg-gray-50 border border-gray-100 p-2 rounded-xl outline-none text-xs font-semibold" value={primaryBrand} onChange={(e) => setPrimaryBrand(e.target.value)}>
                <option value="">Primary brand</option>
                {mainBrands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
              </select>
              <div className="rounded-xl border border-gray-100 bg-white p-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Категория: Марка → Модель → Год</p>
                <p className="text-[11px] text-slate-600">
                  {(mainBrands[0] || '—')} → {(supplierModelsInput.split(',').map((item) => item.trim()).filter(Boolean)[0] || '—')} → {(supplierYearsInput.split(',').map((item) => item.trim()).filter(Boolean)[0] || '—')}
                </p>
              </div>
              <input value={supplierModelsInput} onChange={(e) => setSupplierModelsInput(e.target.value)} placeholder="Модели через запятую (Camry, Corolla)" className="w-full bg-gray-50 border border-gray-100 p-2 rounded-xl outline-none text-xs font-semibold" />
              <input value={supplierYearsInput} onChange={(e) => setSupplierYearsInput(e.target.value.replace(/[^\d, ]/g, ''))} placeholder="Годы через запятую (2018, 2019)" className="w-full bg-gray-50 border border-gray-100 p-2 rounded-xl outline-none text-xs font-semibold" />
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Основные категории деталей</label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SUPPLIER_PART_CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => toggleMainPartCategory(category)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-black border ${mainPartCategories.includes(category) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200'}`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Фото поставщика (опционально)</label>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  <label className="inline-flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-[10px] font-black text-gray-500">
                    +Фото
                    <input type="file" className="hidden" accept="image/*" multiple onChange={onSupplierPhotoChange} />
                  </label>
                  {supplierPhotos.map((photo, index) => (
                    <div key={`${photo}-${index}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200">
                      <button type="button" onClick={() => setGallery({ images: supplierPhotos, index })} className="h-full w-full">
                        <img src={photo} alt="supplier" className="h-full w-full object-cover" />
                      </button>
                      <button type="button" onClick={() => removeSupplierPhoto(index)} className="absolute right-0.5 top-0.5 rounded-full bg-black/60 px-1 text-[9px] text-white">×</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50">
              <button type="button" onClick={() => setShowAdvanced((prev) => !prev)} className="w-full p-3 text-left text-xs font-black text-gray-600 inline-flex items-center justify-between">Дополнительно <ChevronDown size={14} className={showAdvanced ? 'rotate-180' : ''} /></button>
              {showAdvanced && (
                <div className="p-3 pt-0 space-y-2">
                  <input value={workingHours} onChange={(e) => setWorkingHours(e.target.value)} placeholder="Рабочие часы" className="w-full bg-white border border-gray-200 p-2 rounded-lg text-xs font-semibold" />
                  <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website (AI suggest)" className="w-full bg-white border border-gray-200 p-2 rounded-lg text-xs font-semibold" />
                  <label className="text-xs font-semibold text-gray-600">Уровень доверия: {trustLevel}/5</label>
                  <input type="range" min={1} max={5} value={trustLevel} onChange={(e) => setTrustLevel(Number(e.target.value))} className="w-full" />
                  <label className="text-xs font-semibold text-gray-700 inline-flex items-center gap-2"><input type="checkbox" checked={hasDelivery} onChange={(e) => setHasDelivery(e.target.checked)} /> Есть доставка</label>
                  <label className="text-xs font-semibold text-gray-700 inline-flex items-center gap-2"><input type="checkbox" checked={whatsappFast} onChange={(e) => setWhatsappFast(e.target.checked)} /> Быстро отвечает в WhatsApp</label>
                  <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий" className="w-full bg-white border border-gray-200 p-2 rounded-lg text-xs font-semibold" rows={2} />
                </div>
              )}
            </div>

            {locationParseNotice && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{locationParseNotice}</div>}
            {!navigator.onLine && <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">⏳ Offline mode: поставщик будет сохранён как pending sync.</div>}

            <div className="sticky bottom-0 -mx-4 sm:-mx-5 mt-1 px-4 sm:px-5 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] bg-white/95 backdrop-blur border-t border-gray-100 flex gap-3">
              <button type="button" onClick={() => { setIsAdding(false); resetAddForm(); }} className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-2xl font-bold uppercase text-xs">Cancel</button>
              <button type="submit" disabled={isSavingSupplier || !requiredReady} className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-bold uppercase text-xs disabled:opacity-40 inline-flex items-center justify-center gap-2">{isSavingSupplier ? <><Loader2 size={14} className="animate-spin" />Сохранение...</> : (editingSupplierId ? 'Update' : 'Save')}</button>
            </div>
          </form>
        </div>
      )}

      {!selectedBrandView && (
        <section className="grid grid-cols-2 gap-3">
          {availableBrands.map((brand) => (
            <button
              key={brand}
              type="button"
              onClick={() => setSelectedBrandView(brand)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm font-black text-slate-800 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
            >
              {brand}
            </button>
          ))}
        </section>
      )}

      {selectedBrandView && !selectedModelView && (
        <section className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Модели {selectedBrandView}</p>
          <div className="grid grid-cols-2 gap-3">
            {modelsForSelectedBrand.map((model) => (
              <button
                key={model}
                type="button"
                onClick={() => setSelectedModelView(model)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm font-bold text-slate-800 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
              >
                {model}
              </button>
            ))}
          </div>
        </section>
      )}

      {selectedBrandView && selectedModelView && (
        <section className="space-y-3">
          <input
            value={supplierSearchQuery}
            onChange={(e) => setSupplierSearchQuery(e.target.value)}
            placeholder="Search supplier..."
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold"
          />
          {isInitialSuppliersLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`skeleton-supplier-${index}`} className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_6px_24px_rgba(15,23,42,0.08)]">
                  <div className="h-24 rounded-2xl bg-slate-100/80" style={{ backgroundImage: 'linear-gradient(90deg, #e5e7eb 0%, #f8fafc 50%, #e5e7eb 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.2s infinite linear' }} />
                  <div className="mt-3 h-4 w-2/3 rounded bg-slate-100" style={{ backgroundImage: 'linear-gradient(90deg, #e5e7eb 0%, #f8fafc 50%, #e5e7eb 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.2s infinite linear' }} />
                  <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" style={{ backgroundImage: 'linear-gradient(90deg, #e5e7eb 0%, #f8fafc 50%, #e5e7eb 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.2s infinite linear' }} />
                </div>
              ))}
            </div>
          ) : displayedSuppliersForSelectedModel.map((supplier) => {
            const isContacted = (supplier.interactions || []).some((item) => item.type === 'whatsapp');
            const isReplied = (supplier.interactions || []).some((item) => item.type === 'whatsapp_reply');
            const distanceKm = calcDistanceKm(supplier, sortByDistanceRef);
            const brands = pickSupplierBrands(supplier);
            return (
            <div key={supplier.id} role="button" tabIndex={0} onClick={() => setFullscreenSupplierId(supplier.id)} onKeyDown={(e) => { if (e.key === 'Enter') setFullscreenSupplierId(supplier.id); }} className="w-full rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-[0_8px_28px_rgba(15,23,42,0.08)] space-y-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(15,23,42,0.12)] active:scale-[0.99]">
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-900 p-3 text-white shadow-inner">
                <div className="pointer-events-none absolute inset-0 bg-white/10 mix-blend-overlay" />
                <div className="pointer-events-none absolute -right-7 -top-8 h-20 w-20 rounded-full bg-white/20 blur-2xl" />
                <div className="flex items-center gap-3">
                {((supplier.photos && supplier.photos.length > 0) || supplier.photoUrl) ? (
                  <img src={((supplier.photos && supplier.photos[0]) || supplier.photoUrl) as string} alt={supplier.name} className="h-12 w-12 rounded-2xl border border-slate-200 object-cover" />
                ) : (
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-sm font-black text-white backdrop-blur-sm">{supplierInitials(supplier.name)}</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-black uppercase">{supplier.name}</p>
                  <p className="truncate text-xs font-semibold text-blue-100">{supplier.location || 'Location not set'}</p>
                  <p className="mt-1 truncate text-[11px] font-semibold text-white/90">{Number.isFinite(distanceKm) ? `📍 ${distanceKm.toFixed(1)} km away` : '📍 Distance unavailable'}</p>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openQuickPhotoPicker(supplier.id);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-white/15 text-sm backdrop-blur-sm"
                  title="Добавить фото"
                >
                  📷
                </button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase">
                <span className={`rounded-full px-2 py-1 ${isContacted ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>✓ Contacted</span>
                <span className={`rounded-full px-2 py-1 ${isReplied ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>✓ Replied</span>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-black uppercase text-slate-500">Brands</p>
                <div className="flex flex-wrap gap-1.5">
                  {(brands.length > 0 ? brands : ['N/A']).slice(0, 4).map((brand) => <span key={`${supplier.id}-brand-${brand}`} className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-black text-indigo-700">{brand.toUpperCase()}</span>)}
                </div>
                <p className="pt-1 text-[11px] font-black uppercase text-slate-500">Models</p>
                <div className="flex flex-wrap gap-1.5">
                  {((supplier.models || []).length > 0 ? (supplier.models || []) : ['N/A']).slice(0, 4).map((model) => <span key={`${supplier.id}-model-${model}`} className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-700">{model}</span>)}
                </div>
              </div>
              <div className="sticky bottom-2 z-10 rounded-2xl border border-slate-200/90 bg-white/95 p-2 shadow-sm backdrop-blur">
                <button type="button" onClick={(e) => { e.stopPropagation(); openWhatsApp(supplier); }} className="w-full rounded-xl bg-emerald-500 px-2 py-2 text-xs font-black text-white">🟢 WhatsApp</button>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={(e) => { e.stopPropagation(); openPhone(supplier); }} className="rounded-xl border border-slate-300 bg-white px-2 py-2 text-center text-xs font-black text-slate-700">📞 Call</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); openMap(supplier.location || ''); }} className="rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs font-black text-slate-700">📍 Map</button>
                </div>
              </div>
            </div>
          );})}
        </section>
      )}

      <div className="hidden space-y-3">
        {lastSuppliersSyncError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-red-700 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-black uppercase">Ошибка загрузки поставщиков</p>
                <p className="text-xs font-semibold">{lastSuppliersSyncError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void syncSuppliersFromServer(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700"
            >
              <Shuffle size={13} />
              Повторить
            </button>
          </div>
        )}


        <section className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3 space-y-3">
          <div>
            <p className="text-xs font-black uppercase text-indigo-700">🔥 TOP-5 for current request</p>
            <p className="text-[10px] font-semibold text-indigo-600">Based on: Brand / Model / Year / Category / Speed / Trust / Distance</p>
          </div>

          {!activeOrderForTop || !selectedPartForTop ? (
            <p className="rounded-xl border border-dashed border-indigo-200 bg-white px-3 py-3 text-xs font-semibold text-indigo-600">Выберите активный заказ и деталь</p>
          ) : (
            <>
              <div className="space-y-2">
                {topSuppliers.map((entry, index) => {
                  const supplier = entry.supplier;
                  const typeLabel = FIELD_TYPES.find((item) => item.value === (supplier.type || 'new_parts'))?.label || supplier.type || 'Supplier';
                  const trustDisplay = Math.max(1, Math.min(5, Math.round(Number(supplier.trustLevel ?? supplier.autoTrustScore ?? 0) || 0)));
                  const isBestMatch = index === 0;
                  return (
                    <article key={`top-${supplier.id}`} className={`rounded-xl border bg-white px-3 py-2 ${isBestMatch ? 'border-emerald-300 ring-2 ring-emerald-200/80 shadow-[0_0_0_2px_rgba(16,185,129,0.12)]' : 'border-indigo-100'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black text-slate-800">{supplier.name}</p>
                          <p className="text-[10px] font-semibold text-indigo-600">{typeLabel} {isBestMatch ? '• Best match' : ''}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-black">
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">⚡ {entry.speedLabel}</span>
                            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-violet-700">⭐ {trustDisplay}/5</span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">📍 {Number.isFinite(entry.distanceKm) ? `${Math.max(0.1, Number(entry.distanceKm.toFixed(1)))} km` : 'n/a'}</span>
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">🎯 Score {entry.score}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openAskPrice(supplier, activeOrderForTop.id, selectedPartForTop.id)}
                          className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-black text-emerald-700 inline-flex items-center gap-1"
                        >
                          <MessageCircle size={12} />
                          Ask price
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {bulkSendMode && bulkSendQueueSupplierIds.length > 0 ? (
                  <>
                    <button type="button" onClick={openBulkSendNext} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white">
                      {bulkSendIndex >= bulkSendQueueSupplierIds.length ? 'Done' : `Next (${Math.min(bulkSendIndex + 1, bulkSendQueueSupplierIds.length)}/${bulkSendQueueSupplierIds.length})`}
                    </button>
                    <button type="button" onClick={cancelBulkSend} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700">Cancel bulk send</button>
                    {bulkSendStartedAt ? <span className="text-[10px] font-semibold text-slate-500">Started {new Date(bulkSendStartedAt).toLocaleTimeString()}</span> : null}
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => startBulkSend(3)} className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-700 disabled:opacity-40" disabled={topSuppliers.length < 3}>Send to TOP-3</button>
                    <button type="button" onClick={() => startBulkSend(5)} className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-700 disabled:opacity-40" disabled={topSuppliers.length < 5}>Send to TOP-5</button>
                  </>
                )}
              </div>
            </>
          )}
        </section>

        {filteredSuppliers.length === 0 ? (
          <div className="py-20 text-center opacity-30 italic flex flex-col items-center gap-3"><Store size={48} />Поставщики не найдены</div>
        ) : (
          filteredSuppliers.map((s) => {
            const Icon = s.type === 'scrapyard' ? Wrench : Gem;
            const brands = pickSupplierBrands(s);
            const isExpanded = expandedSupplierIds.has(s.id);
            const linkedParts = [...(s.linkedParts || [])].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
            const linkedFoundCount = linkedParts.filter((entry) => entry.status === 'found').length;
            const linkedNotFoundCount = linkedParts.filter((entry) => entry.status === 'not_found').length;
            const isManagePartsExpanded = activeOrderLinkShopId === s.id;
            const isAddedPartsExpanded = expandedAddedPartsIds.has(s.id);
            const distanceKm = calcDistanceKm(s, sortByDistanceRef);
            const trustDisplay = Number.isFinite(Number(s.trustLevel)) ? Number(s.trustLevel) : Number(s.autoTrustScore || 0);
            const mainStatus = resolveMainStatus(s);
            const showFullHistory = fullHistorySupplierIds.has(s.id);
            const historyItems = showFullHistory ? (s.interactions || []) : (s.interactions || []).slice(0, 3);
            const responseSpeed = s.whatsappFast === true
              ? { label: 'FAST', classes: 'border-slate-200 bg-slate-100 text-slate-700' }
              : s.whatsappFast === false
                ? { label: 'SLOW', classes: 'border-amber-200 bg-amber-50 text-amber-700' }
                : { label: '?', classes: 'border-slate-200 bg-slate-100 text-slate-600' };

            return (
              <div id={`supplier-card-${s.id}`} key={s.id} className={`rounded-2xl p-3 shadow-sm space-y-2 border transition-all duration-300 ease-out ${s.whatsappFast === true ? 'ring-1 ring-emerald-200' : ''} ${isExpanded ? 'bg-indigo-50/60 border-indigo-200 shadow-indigo-100/70' : 'bg-white border-gray-100 hover:border-slate-200 hover:shadow-md'}`}>
                <button type="button" onClick={() => setExpandedSupplierIds((prev) => { const next = new Set(prev); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })} className="w-full text-left space-y-2">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {((s.photos && s.photos.length > 0) || s.photoUrl) ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const images = ((s.photos && s.photos.length > 0) ? s.photos : [s.photoUrl || '']).filter(Boolean) as string[];
                            if (images.length > 0) setGallery({ images, index: 0 });
                          }}
                          className="w-12 h-12 rounded-xl overflow-hidden border border-gray-200 shrink-0"
                        >
                          <img src={((s.photos && s.photos[0]) || s.photoUrl) as string} alt={s.name} className="h-full w-full object-cover" />
                        </button>
                      ) : (
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${s.type === 'scrapyard' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}><Icon size={24} /></div>
                      )}
                      <div className="min-w-0">
                        <p className="font-black text-sm leading-tight truncate">{s.name}</p>
                        <p className="text-[11px] text-slate-600 truncate">{`${brands[0] || 'Unknown brand'} • ${(s.types && s.types.length > 0 ? s.types : [s.type || 'new_parts']).map((value) => FIELD_TYPES.find((t) => t.value === value)?.label || value).join(' + ')}`}</p>
                        <p className="text-[10px] text-slate-500 truncate"><span className="font-bold">Марки:</span> {(brands.length > 0 ? brands : ['—']).join(', ')}</p>
                        <p className="text-[10px] text-slate-500 truncate"><span className="font-bold">Модели:</span> {((s.models || []).length > 0 ? (s.models || []) : ['—']).join(', ')}</p>
                        <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${SUPPLIER_STATUS_COLORS[mainStatus]}`}>{SUPPLIER_STATUS_LABELS[mainStatus]}</span>
                      </div>
                    </div>
                    <div className="relative text-right text-[10px] text-slate-500" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setExpandedSupplierIds((prev) => { const next = new Set(prev); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })}
                          className="rounded-full border border-slate-200 p-1 text-slate-500"
                          aria-label={isExpanded ? 'Свернуть карточку' : 'Раскрыть карточку'}
                        >
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setOverflowSupplierId((prev) => prev === s.id ? null : s.id)}
                          className="rounded-full border border-slate-200 p-1 text-slate-500"
                          aria-label="Открыть меню действий"
                        >
                          <MoreHorizontal size={12} />
                        </button>
                      </div>
                      {overflowSupplierId === s.id && (
                        <div className="absolute right-3 mt-1 z-20 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg text-left">
                          <button type="button" onClick={() => { openMap(s.location || ''); setOverflowSupplierId(null); }} className="w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1"><Route size={12} />Map</button>
                          <button type="button" onClick={() => { startEditSupplier(s); setOverflowSupplierId(null); }} className="w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1"><Pencil size={12} />Edit</button>
                          <button type="button" onClick={() => { setDeleteSupplierId(s.id); setOverflowSupplierId(null); }} className="w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1"><Trash2 size={12} />Delete</button>
                          <button
                            type="button"
                            onClick={() => {
                              toggleFavorite(s);
                              setOverflowSupplierId(null);
                            }}
                            className="w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1"
                          ><Heart size={12} />Favorite</button>
                          <button type="button" onClick={() => { navigator.clipboard.writeText(s.name); toast('Название скопировано', 'success'); setOverflowSupplierId(null); }} className="w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1"><Tag size={12} />Copy name</button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center flex-wrap gap-2 text-[10px] font-black uppercase">
                    <span className={`rounded-full border px-2 py-1 ${responseSpeed.classes}`}>🕒 {responseSpeed.label}</span>
                    <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-slate-700">⭐ {Math.max(1, Math.min(5, Math.round(trustDisplay || 0)))}/5</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">📍 {Number.isFinite(distanceKm) ? `${Math.max(0.1, Number(distanceKm.toFixed(1)))} km` : 'n/a'}</span>
                  </div>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  {(s.phone || '').trim() ? (
                    <>
                      <button type="button" onClick={() => openWhatsApp(s)} className="rounded-lg bg-blue-600 px-2 py-2 text-[10px] font-black text-white inline-flex items-center justify-center gap-1 active:scale-[0.98] transition"><MessageCircle size={12} />WhatsApp</button>
                      <button type="button" onClick={() => openPhone(s)} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-[10px] font-black text-slate-700 inline-flex items-center justify-center gap-1"><Phone size={12} />Call</button>
                    </>
                  ) : (
                    <>
                      <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-[10px] font-black text-amber-700 inline-flex items-center justify-center">Нет контакта</span>
                      <button type="button" onClick={() => openContactEditor(s)} className="rounded-lg bg-amber-100 px-2 py-2 text-[10px] font-black text-amber-800 inline-flex items-center justify-center gap-1">➕ Добавить контакт</button>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10px] font-black">
                  <button type="button" onClick={() => markContacted(s)} className="h-8 rounded-full border border-slate-300 bg-white px-2 text-slate-700">✉️ Написал</button>
                  <button type="button" onClick={() => markResponded(s)} className="h-8 rounded-full border border-emerald-200 bg-emerald-50 px-2 text-emerald-700">✅ Ответил</button>
                  <button type="button" onClick={() => setVisitFormSupplierId(s.id)} className="h-8 rounded-full border border-slate-300 bg-white px-2 text-slate-700">📍 Посетил</button>
                </div>

                <div className="overflow-hidden transition-all duration-300 ease-out" style={{ maxHeight: isExpanded ? 2200 : 0, opacity: isExpanded ? 1 : 0 }}>
                {isExpanded && <>
                <div className="rounded-xl border border-gray-100 bg-slate-50 p-2 space-y-1">
                  <p className="text-[11px] font-semibold text-slate-700"><span className="font-black">Марки:</span> {(brands.length > 0 ? brands : ['—']).join(', ')}</p>
                  <p className="text-[11px] font-semibold text-slate-700"><span className="font-black">Модели:</span> {((s.models || []).length > 0 ? (s.models || []) : ['—']).join(', ')}</p>
                  <p className="text-[11px] font-semibold text-slate-700"><span className="font-black">Годы:</span> {(normalizeSupplierYears(s.years).length > 0 ? normalizeSupplierYears(s.years).join(', ') : '—')}</p>
                </div>
                {Array.isArray(s.mainPartCategories) && s.mainPartCategories.length > 0 && <p className="text-[11px] text-slate-500">Основные детали: {s.mainPartCategories.slice(0, 3).join(', ')}</p>}
                {s.supplierStatus === 'blacklist' ? <p className="rounded-lg border border-rose-300 bg-rose-100 px-2 py-1 text-xs font-black text-rose-800">🔴 WARNING · Опасный поставщик</p> : null}

                
                <div className="rounded-xl border border-slate-200 bg-white p-2 space-y-1">
                  <p className="text-[11px] font-black text-slate-700">SUPPLIER HISTORY</p>
                  {historyItems.map((item) => <p key={item.id} className="text-[10px] text-slate-600">{new Date(item.date).toLocaleDateString()} — {item.type} {item.note ? `· ${item.note}` : ''}</p>)}
                  {(!s.interactions || s.interactions.length === 0) ? <p className="text-[10px] text-slate-500">История пока пустая.</p> : null}
                  {(s.interactions || []).length > 3 && (
                    <button
                      type="button"
                      onClick={() => setFullHistorySupplierIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.id)) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      })}
                      className="text-[10px] font-black text-blue-700"
                    >
                      {showFullHistory ? 'Скрыть' : 'Показать все'}
                    </button>
                  )}
                  <textarea value={s.internalNotes || ''} onChange={(e) => updateSupplier({ ...s, internalNotes: e.target.value, updatedAt: Date.now() })} placeholder="internal notes" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] font-semibold" />
                </div>


                <div className="flex items-center flex-wrap gap-2 text-[10px] font-black uppercase">
                  <span className="rounded-full px-2 py-1 border border-emerald-200 bg-emerald-50 text-emerald-700">⭐ {s.successRate}%</span>
                  <span className="rounded-full px-2 py-1 border border-blue-200 bg-blue-50 text-blue-700">Score: {computeSupplierScore(s)}</span>
                  <span className="rounded-full px-2 py-1 border border-slate-200 bg-slate-50 text-slate-700">{daysAgoLabel(s.lastContactAt)}</span>
                  <span className="rounded-full px-2 py-1 border border-indigo-200 bg-indigo-50 text-indigo-700">Добавлено: {linkedParts.length}</span>
                  <span className="rounded-full px-2 py-1 border border-emerald-200 bg-emerald-50 text-emerald-700">Найдено: {linkedFoundCount}</span>
                  <span className="rounded-full px-2 py-1 border border-rose-200 bg-rose-50 text-rose-700">Не найдено: {linkedNotFoundCount}</span>
                </div>
                </>}
                {isExpanded && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <button type="button" onClick={() => setActiveOrderLinkShopId(isManagePartsExpanded ? null : s.id)} className="w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 inline-flex items-center justify-between gap-2"><span className="inline-flex items-center gap-2"><Link2 size={13} /> Управление деталями поставщика</span>{isManagePartsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
                  <div className="overflow-hidden transition-all duration-300 ease-out" style={{ maxHeight: isManagePartsExpanded ? 800 : 0, opacity: isManagePartsExpanded ? 1 : 0 }}>
                  {isManagePartsExpanded && (
                    <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50 p-2 space-y-2">
                      <select
                        className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold"
                        value={selectedOrderBySupplier[s.id] || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setSelectedOrderBySupplier((prev) => ({ ...prev, [s.id]: value }));
                          setActiveOrderPartLink((prev) => ({ supplierId: s.id, orderId: value, partId: prev?.partId || '' }));
                        }}
                      >
                        <option value="">Выберите активный заказ...</option>
                        {activeOrders.map((order) => <option key={order.id} value={order.id}>{order.brand} {order.model} • {order.vin}</option>)}
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          const selectedOrderId = selectedOrderBySupplier[s.id];
                          if (!selectedOrderId) return;
                          const selectedOrder = activeOrders.find((order) => order.id === selectedOrderId);
                          if (!selectedOrder) return;
                          const selectedPartIds = activeOrderPartLink?.supplierId === s.id && activeOrderPartLink.partId
                            ? [activeOrderPartLink.partId]
                            : selectedOrder.parts.map((part) => part.id);
                          addSupplierToOrder(s.id, selectedOrderId, selectedPartIds);
                          alert('Поставщик добавлен в активный заказ.');
                        }}
                        className="w-full rounded-lg bg-blue-100 px-2 py-2 text-[11px] font-black text-blue-800"
                      >
                        Сохранить в активный заказ
                      </button>

                      <div className="grid grid-cols-2 gap-2">
                        <select className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold" value={activeOrderPartLink?.supplierId === s.id ? activeOrderPartLink.orderId : ''} onChange={(e) => { setActiveOrderPartLink({ supplierId: s.id, orderId: e.target.value, partId: '' }); setTopRequest((prev) => ({ orderId: e.target.value, partId: prev?.orderId === e.target.value ? prev.partId : '' })); }}>
                          <option value="">Заказ для детали</option>
                          {activeOrders.map((order) => <option key={order.id} value={order.id}>{order.brand} {order.model}</option>)}
                        </select>
                        <select className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold" value={activeOrderPartLink?.supplierId === s.id ? activeOrderPartLink.partId : ''} onChange={(e) => { const nextOrderId = (activeOrderPartLink?.supplierId === s.id ? activeOrderPartLink.orderId : selectedOrderBySupplier[s.id]) || ''; setActiveOrderPartLink((prev) => ({ supplierId: s.id, orderId: (prev?.supplierId === s.id ? prev.orderId : '') || selectedOrderBySupplier[s.id] || '', partId: e.target.value })); setTopRequest({ orderId: nextOrderId, partId: e.target.value }); }}>
                          <option value="">Деталь</option>
                          {(activeOrders.find((order) => order.id === (activeOrderPartLink?.supplierId === s.id ? activeOrderPartLink.orderId : selectedOrderBySupplier[s.id]))?.parts || []).map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
                        </select>
                      </div>
                      <button type="button" onClick={addSupplierToOrderPart} className="w-full rounded-lg bg-violet-100 px-2 py-2 text-[11px] font-black text-violet-800">Добавить деталь в карточку</button>
                    </div>
                  )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 space-y-2">
                    <button
                      type="button"
                      onClick={() => setExpandedAddedPartsIds((prev) => { const next = new Set(prev); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })}
                      className="w-full inline-flex items-center justify-between text-[11px] font-black text-slate-700"
                    >
                      <span>Добавленные детали ({linkedParts.length})</span>
                      {isAddedPartsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <div className="overflow-hidden transition-all duration-300 ease-out" style={{ maxHeight: isAddedPartsExpanded ? 900 : 0, opacity: isAddedPartsExpanded ? 1 : 0 }}>
                    {isAddedPartsExpanded && (linkedParts.length === 0 ? (
                      <p className="text-[11px] text-slate-500">Нет деталей. Добавьте через блок выше или через «Добавить варианты».</p>
                    ) : linkedParts.map((entry) => (
                      <div key={entry.id} className="mb-1.5 rounded-md bg-white border border-slate-200 p-1.5 text-[10px]">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-bold text-slate-700">{entry.orderLabel}</p>
                            <p className="text-slate-600">{entry.partName}</p>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${entry.source === 'variant' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                            {entry.source === 'variant' ? 'Вариант' : 'Вручную'}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <select
                            value={entry.status}
                            onChange={(e) => updateLinkedPartStatus(s, entry, e.target.value as SupplierLinkedPartStatus)}
                            className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold"
                          >
                            {Object.entries(LINKED_PART_STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                          </select>
                          <button
                            type="button"
                            onClick={() => removeLinkedPartEntry(s, entry)}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-black text-rose-700"
                          >
                            <Trash2 size={11} />
                            Убрать
                          </button>
                          {entry.priceAed ? <span className="font-black text-[10px] text-emerald-700">{entry.priceAed} AED</span> : null}
                        </div>
                      </div>
                    ))) }
                    </div>
                  </div>
                </div>
                )}
                </div>
              </div>
            );
          })
        )}
      </div>


      <input
        ref={quickPhotoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => { void handleQuickPhotoChange(event); }}
      />


      {fullscreenSupplier && (
        <div className="fixed inset-0 z-[80] bg-black/40 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) setFullscreenSupplierId(null); }}>
          <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[92vh] sm:max-w-2xl sm:rounded-3xl">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]">
              <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
                <button type="button" onClick={() => setFullscreenSupplierId(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700">Закрыть</button>
                <p className="truncate px-2 text-sm font-black text-slate-800">{fullscreenSupplier.name}</p>
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
                      ><Pencil size={12} />Edit</button>
                      <button
                        type="button"
                        onClick={() => { setDeleteSupplierId(fullscreenSupplier.id); setIsFullscreenMenuOpen(false); }}
                        className="inline-flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                      ><Trash2 size={12} />Delete</button>
                    </div>
                  )}
                </div>
              </div>
          <div className="relative">
            {fullscreenSupplier.photos?.[0] ? (
              <img src={fullscreenSupplier.photos[0]} alt={fullscreenSupplier.name} className="h-64 w-full object-cover" />
            ) : (
              <div className="h-56 w-full bg-gradient-to-r from-indigo-600 to-blue-600" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent" />
            <div className="absolute bottom-0 w-full px-5 pb-5 text-white">
              <p className="text-3xl font-black tracking-tight uppercase">{fullscreenSupplier.name}</p>
              <p className="mt-1 text-sm font-semibold text-white/95">📍 {fullscreenSupplier.zone || fullscreenSupplier.location || 'Location not set'}</p>
              <p className="mt-2 text-xs font-semibold text-white/90">{(pickSupplierBrands(fullscreenSupplier).join(' • ') || '—')}</p>
              <p className="text-xs font-semibold text-white/80">{((fullscreenSupplier.models || []).join(' • ') || '—')}</p>
            </div>
          </div>
          <div className="space-y-4 p-5 pb-24">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 space-y-2">
              <button type="button" onClick={() => openWhatsApp(fullscreenSupplier)} className="w-full rounded-xl bg-emerald-500 px-3 py-3 text-sm font-black text-white shadow-sm">🟢 WhatsApp</button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => openPhone(fullscreenSupplier)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-center text-xs font-black text-slate-700 shadow-sm">📞 Call</button>
                <button type="button" onClick={() => openMap(fullscreenSupplier.location || '')} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm">📍 Map</button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-semibold text-slate-700 space-y-2">
              <p className="flex items-center gap-2"><span className="font-black">Локация:</span> {fullscreenSupplier.location ? <button type="button" onClick={() => openMap(fullscreenSupplier.location || '')} className="text-blue-700 underline">📍 Open location in Google Maps</button> : '—'}</p>
              <p><span className="font-black">Марки:</span> {(pickSupplierBrands(fullscreenSupplier).join(', ') || '—')}</p>
              <p><span className="font-black">Модели:</span> {((fullscreenSupplier.models || []).join(', ') || '—')}</p>
              <p><span className="font-black">Last contact:</span> {daysAgoLabel(fullscreenSupplier.lastContactAt)}</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <p className="text-xs font-black uppercase tracking-wide text-slate-700">Contact status</p>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={(fullscreenSupplier.interactions || []).some((item) => item.type === 'whatsapp')} onChange={() => markContacted(fullscreenSupplier)} /> Written</label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={(fullscreenSupplier.interactions || []).some((item) => item.type === 'whatsapp_reply')} onChange={() => markResponded(fullscreenSupplier)} /> Replied</label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={(fullscreenSupplier.interactions || []).some((item) => item.type === 'visit')} onChange={() => markVisitedQuick(fullscreenSupplier)} /> Visited</label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-700">Activity</p>
              {(fullscreenSupplier.interactions || []).length === 0 ? <p className="text-xs text-slate-500">История пока пустая.</p> : Array.from(new Map((fullscreenSupplier.interactions || []).map((item) => [`${item.type}:${item.note || ''}`, item])).values()).map((item) => (
                <div key={item.id} className="mb-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-700">{item.type === 'whatsapp' ? '💬 WhatsApp message' : item.type === 'whatsapp_reply' ? '✅ Supplier replied' : item.type === 'visit' ? '📍 Visited supplier' : item.type === 'call' ? '📞 Call supplier' : item.note || item.type}</p>
                  <p className="text-[11px] font-semibold text-slate-500">{timelineLabel(item.date)}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-2">
              <p className="text-xs font-black uppercase tracking-wide text-blue-700">Add supplier to order</p>
              <input
                value={fullscreenOrderSearch}
                onChange={(e) => setFullscreenOrderSearch(e.target.value)}
                placeholder="Search order (brand / model / VIN)"
                className="w-full rounded-lg border border-blue-200 bg-white px-2 py-2 text-xs font-semibold"
              />
              <select
                className="w-full rounded-lg border border-blue-200 bg-white px-2 py-2 text-xs font-semibold"
                value={selectedOrderBySupplier[fullscreenSupplier.id] || ''}
                onChange={(e) => setSelectedOrderBySupplier((prev) => ({ ...prev, [fullscreenSupplier.id]: e.target.value }))}
              >
                <option value="">Select order</option>
                {fullscreenOrderOptions.map((order) => <option key={order.id} value={order.id}>{order.brand} {order.model} • {order.vin}</option>)}
              </select>
              <button
                type="button"
                onClick={() => {
                  const selectedOrderId = selectedOrderBySupplier[fullscreenSupplier.id];
                  if (!selectedOrderId) return;
                  const selectedOrder = activeOrders.find((order) => order.id === selectedOrderId);
                  if (!selectedOrder) return;
                  addSupplierToOrder(fullscreenSupplier.id, selectedOrderId, selectedOrder.parts.map((part) => part.id));
                  toast('✓ Supplier added to order', 'success');
                }}
                className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white transition active:scale-[0.99]"
              >
                + Add to order
              </button>
            </div>

            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-violet-700">Orders</p>
              {fullscreenSupplierOrders.length === 0 ? (
                <p className="mt-2 text-xs font-semibold text-violet-600">No linked orders yet.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {fullscreenSupplierOrders.map((order) => (
                    <div key={order.id} className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                      <p className="font-black text-slate-800">{order.brand} {order.model}</p>
                      <p className="text-[11px] text-slate-500">VIN: {order.vin || '—'}</p>
                      <button
                        type="button"
                        onClick={() => setPendingOrderRemoval({ supplierId: fullscreenSupplier.id, orderId: order.id })}
                        className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700"
                      >
                        remove
                      </button>
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
            <p className="text-sm font-black">🏪 Посетил лично</p>
            <input value={visitOwnerName} onChange={(e) => setVisitOwnerName(e.target.value)} placeholder="Имя владельца" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold" />
            <input value={visitPartsCount} onChange={(e) => setVisitPartsCount(e.target.value)} placeholder="Количество деталей" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold" />
            <input value={visitShopSize} onChange={(e) => setVisitShopSize(e.target.value)} placeholder="Размер магазина" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold" />
            <textarea value={visitComment} onChange={(e) => setVisitComment(e.target.value)} placeholder="Комментарий" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold min-h-[88px]" />
            <input type="file" accept="image/*" multiple onChange={onVisitPhotoChange} className="w-full text-xs" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setVisitFormSupplierId(null)} className="flex-1 rounded-xl bg-gray-100 py-2 text-xs font-black">Cancel</button>
              <button type="button" onClick={saveVisitInteraction} className="flex-1 rounded-xl bg-violet-600 text-white py-2 text-xs font-black">Save visit</button>
            </div>
          </div>
        </div>
      )}


      {contactEditorSupplierId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 space-y-3">
            <p className="text-sm font-black">Добавить контакт</p>
            <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Phone (+971...)" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold" />
            <input value={contactWhatsapp} onChange={(e) => setContactWhatsapp(e.target.value)} placeholder="WhatsApp (optional)" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setContactEditorSupplierId(null)} className="flex-1 rounded-xl bg-gray-100 py-2 text-xs font-black">Cancel</button>
              <button type="button" disabled={isSavingContact} onClick={saveSupplierContact} className="flex-1 rounded-xl bg-blue-600 text-white py-2 text-xs font-black disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!pendingOrderRemoval}
        message="Убрать поставщика из выбранного заказа?"
        onConfirm={() => {
          if (!pendingOrderRemoval || !fullscreenSupplier || pendingOrderRemoval.supplierId !== fullscreenSupplier.id) return;
          removeSupplierFromOrder(fullscreenSupplier, pendingOrderRemoval.orderId);
          setPendingOrderRemoval(null);
        }}
        onCancel={() => setPendingOrderRemoval(null)}
      />

      <ConfirmModal isOpen={!!deleteSupplierId} message="Вы уверены, что хотите удалить этого поставщика?" onConfirm={confirmDeleteSupplier} onCancel={() => setDeleteSupplierId(null)} />
      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
      <button
        type="button"
        onClick={() => setIsAdding(true)}
        className="fixed bottom-7 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.45)] transition active:scale-95"
        aria-label="Add supplier"
      >
        <UserPlus size={20} />
      </button>

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
