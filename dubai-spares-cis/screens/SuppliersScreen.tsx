import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, syncSuppliersFromServer } from '../store';
import { Supplier, SupplierLinkedPartEntry, SupplierLinkedPartStatus, SupplierType } from '../types';
import {
  Search,
  Phone,
  MapPin,
  Store,
  UserPlus,
  Upload,
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
  Shuffle
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

const SuppliersScreen: React.FC = () => {
  const { suppliers, addSupplier, deleteSupplier, restoreData, orders, updateOrder, updateSupplier, lastSuppliersSyncError } = useStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteSupplierId, setDeleteSupplierId] = useState<string | null>(null);

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

  const [filterType, setFilterType] = useState<'all' | SupplierType>('all');
  const [filterActivity, setFilterActivity] = useState<'all' | 'high' | 'medium' | 'low' | 'dormant'>('all');
  const [filterBrand, setFilterBrand] = useState('all');
  const [filterGps, setFilterGps] = useState<'all' | 'has' | 'missing'>('all');
  const [sortBy, setSortBy] = useState<'activity' | 'success' | 'last_contact'>('activity');
  const [filterPartCategory, setFilterPartCategory] = useState('all');
  const [quickRadiusKm, setQuickRadiusKm] = useState<'all' | 5 | 10 | 20 | 50>('all');
  const [quickHasContacts, setQuickHasContacts] = useState(false);
  const [quickOpenNow, setQuickOpenNow] = useState(false);
  const [advancedTrustMin, setAdvancedTrustMin] = useState(0);
  const [advancedSuccessMin, setAdvancedSuccessMin] = useState(0);
  const [advancedHeatMin, setAdvancedHeatMin] = useState(0);
  const [advancedHasDelivery, setAdvancedHasDelivery] = useState(false);
  const [advancedFastWhatsapp, setAdvancedFastWhatsapp] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [contactEditorSupplierId, setContactEditorSupplierId] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [sortByDistanceRef, setSortByDistanceRef] = useState<{ lat: number; lng: number }>({ lat: 25.2048, lng: 55.2708 });
  const [sortByExtended, setSortByExtended] = useState<'smart' | 'trust' | 'heat' | 'near' | 'name'>('smart');
  const [expandedSupplierIds, setExpandedSupplierIds] = useState<Set<string>>(new Set());
  const [manualRadarCounts, setManualRadarCounts] = useState<Record<string, number>>({});
  const [manualSelections, setManualSelections] = useState(() => getRadarManualSelections());
  const [isForceSyncingSuppliers, setIsForceSyncingSuppliers] = useState(false);

  const activeOrders = useMemo(
    () => orders.filter((order) => !order.isArchived && !order.isSold),
    [orders]
  );

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

  const uniqueBrandsForFilter = useMemo(() => {
    const set = new Set<string>();
    suppliers.forEach((supplier) => pickSupplierBrands(supplier).forEach((brand) => set.add(brand)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [suppliers]);

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

  const filtered = useMemo(() => {
    const normalized = debouncedSearchTerm.toLowerCase();
    const yFrom = Number(yearFrom);
    const yTo = Number(yearTo);
    const calcDistanceKm = (supplier: Supplier & { coordinates?: { lat: number; lng: number } }) => {
      if (!supplier.coordinates) return Number.POSITIVE_INFINITY;
      const latDiff = (supplier.coordinates.lat - sortByDistanceRef.lat) * 111;
      const lngDiff = (supplier.coordinates.lng - sortByDistanceRef.lng) * 111;
      return Math.sqrt((latDiff * latDiff) + (lngDiff * lngDiff));
    };

    const deduped = new Map<string, (typeof suppliersWithStats)[number]>();
    suppliersWithStats.forEach((item) => {
      const key = `${item.id}:${item.name.trim().toLowerCase()}`;
      if (!deduped.has(key)) deduped.set(key, item);
    });

    const data = Array.from(deduped.values()).filter((s) => {
      const matchesSearch = !normalized
        || s.name.toLowerCase().includes(normalized)
        || s.phone.includes(debouncedSearchTerm)
        || (s.zone || '').toLowerCase().includes(normalized)
        || (s.brands || []).some((b) => b.toLowerCase().includes(normalized))
        || pickSupplierBrands(s).some((b) => b.toLowerCase().includes(normalized));

      const supplierTypes = Array.isArray(s.types) && s.types.length > 0 ? s.types : [s.type || 'new_parts'];
      const matchesQuickType = (filterType === 'all')
        || (filterType === 'new_parts' && supplierTypes.includes('new_parts'))
        || (filterType === 'scrapyard' && supplierTypes.some((type) => ['scrapyard', 'body_parts', 'mixed'].includes(type)))
        || (filterType === 'engine_specialist' && supplierTypes.some((type) => ['engine_specialist', 'electrical', 'dealer', 'warehouse'].includes(type)));
      const matchesType = matchesQuickType;
      const matchesBrand = filterBrand === 'all' || pickSupplierBrands(s).includes(filterBrand);
      const hasGps = !!s.coordinates;
      const matchesGps = filterGps === 'all' || (filterGps === 'has' ? hasGps : !hasGps);
      const matchesActivity = filterActivity === 'all'
        || (filterActivity === 'high' && s.activityState.includes('High'))
        || (filterActivity === 'medium' && s.activityState.includes('Medium'))
        || (filterActivity === 'low' && s.activityState.includes('Low'))
        || (filterActivity === 'dormant' && s.activityState.includes('Dormant'));
      const matchesCategory = filterPartCategory === 'all' || (s.mainPartCategories || []).includes(filterPartCategory);
      const years = s.years || [];
      const matchesYearFrom = !Number.isFinite(yFrom) || years.length === 0 || years.some((year) => year >= yFrom);
      const matchesYearTo = !Number.isFinite(yTo) || years.length === 0 || years.some((year) => year <= yTo);
      const distanceKm = calcDistanceKm(s);
      const matchesRadius = quickRadiusKm === 'all' || distanceKm <= quickRadiusKm;
      const matchesContacts = !quickHasContacts || Boolean((s.phone || '').trim());
      const matchesOpenNow = !quickOpenNow || Boolean((s.workingHours || '').trim());
      const trustScore = Number(s.autoTrustScore ?? s.trustLevel ?? 0);
      const matchesTrust = trustScore >= advancedTrustMin;
      const matchesSuccessMin = Number(s.successRate || 0) >= advancedSuccessMin;
      const matchesHeat = Number(s.heatLevel || 0) >= advancedHeatMin;
      const matchesDelivery = !advancedHasDelivery || s.hasDelivery === true;
      const matchesFastWhatsapp = !advancedFastWhatsapp || s.whatsappFast === true;

      return matchesSearch && matchesType && matchesBrand && matchesGps && matchesActivity && matchesCategory && matchesYearFrom && matchesYearTo
        && matchesRadius && matchesContacts && matchesOpenNow && matchesTrust && matchesSuccessMin && matchesHeat && matchesDelivery && matchesFastWhatsapp;
    });

    return data.sort((a, b) => {
      const distanceA = calcDistanceKm(a);
      const distanceB = calcDistanceKm(b);

      if (sortByExtended === 'trust') return (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0)) || (Number(b.heatLevel || 0) - Number(a.heatLevel || 0)) || distanceA - distanceB || a.name.localeCompare(b.name);
      if (sortByExtended === 'heat') return (Number(b.heatLevel || 0) - Number(a.heatLevel || 0)) || (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0)) || distanceA - distanceB || a.name.localeCompare(b.name);
      if (sortByExtended === 'near') return distanceA - distanceB || (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0));
      if (sortByExtended === 'name') return a.name.localeCompare(b.name) || distanceA - distanceB;
      return (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0)) || (Number(b.heatLevel || 0) - Number(a.heatLevel || 0)) || distanceA - distanceB || a.name.localeCompare(b.name);
    });
  }, [suppliersWithStats, debouncedSearchTerm, filterType, filterBrand, filterGps, filterActivity, filterPartCategory, yearFrom, yearTo, sortByExtended, sortByDistanceRef, quickRadiusKm, quickHasContacts, quickOpenNow, advancedTrustMin, advancedSuccessMin, advancedHeatMin, advancedHasDelivery, advancedFastWhatsapp]);

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
    if (loc.startsWith('http')) {
      window.open(loc, '_blank');
    } else {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`, '_blank');
    }
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

    const current = new Set(order.recommendedShopIds || []);
    current.add(shopId);
    const nextDismissed = (order.dismissedShopIds || []).filter((id) => id !== shopId);
    updateOrder({ ...order, recommendedShopIds: Array.from(current), dismissedShopIds: nextDismissed, updatedAt: Date.now() });

    const partIds = selectedPartIds.length > 0
      ? selectedPartIds
      : (order.parts[0]?.id ? [order.parts[0].id] : []);
    partIds.forEach((partId) => addRadarManualSelection({ supplierId: shopId, orderId, partId, source: 'manual' }));

    const linkedSupplier = suppliers.find((item) => item.id === shopId);
    if (linkedSupplier && order.brand) {
      const currentBrands = linkedSupplier.mainBrands || linkedSupplier.brands || [];
      const nextBrands = mergeUniqueStrings(currentBrands, [order.brand]);
      const nextModels = mergeUniqueStrings(linkedSupplier.models || [], [order.model || '']);
      const nextYears = mergeUniqueYears(linkedSupplier.years || [], [Number(order.year)]);
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
    updateOrder({ ...order, recommendedShopIds: Array.from(current), updatedAt: Date.now() });
    addRadarManualSelection({ supplierId: activeOrderPartLink.supplierId, orderId: activeOrderPartLink.orderId, partId: activeOrderPartLink.partId, source: 'manual' });

    const currentBrands = linkedSupplier.mainBrands || linkedSupplier.brands || [];
    const nextBrands = mergeUniqueStrings(currentBrands, [order.brand]);
    const nextModels = mergeUniqueStrings(linkedSupplier.models || [], [order.model || '']);
    const nextYears = mergeUniqueYears(linkedSupplier.years || [], [Number(order.year)]);
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

  useEffect(() => {
    void syncSuppliersFromServer(true);
  }, []);

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
    const timer = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

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

  const forceRefreshSuppliers = async () => {
    setIsForceSyncingSuppliers(true);
    try {
      const result = await syncSuppliersFromServer(true);
      const fetchedCount = Number(result?.fetchedCount || 0);
      setSearchTerm('');
      setDebouncedSearchTerm('');
      setFilterType('all');
      setFilterActivity('all');
      setFilterBrand('all');
      setFilterGps('all');
      setFilterPartCategory('all');
      setYearFrom('');
      setYearTo('');
      setQuickRadiusKm('all');
      setQuickHasContacts(false);
      setQuickOpenNow(false);
      setAdvancedTrustMin(0);
      setAdvancedSuccessMin(0);
      setAdvancedHeatMin(0);
      setAdvancedHasDelivery(false);
      setAdvancedFastWhatsapp(false);
      if (fetchedCount === 0) {
        toast('Сервер вернул 0 поставщиков. Проверьте фильтры или источник данных.', 'info');
        return;
      }
      toast(`Загружено поставщиков: ${fetchedCount}`, 'success');
    } catch (error) {
      console.error(error);
    } finally {
      setIsForceSyncingSuppliers(false);
    }
  };

  const requiredReady = !!toTitle(name.trim()) && isValidE164(currentPhone) && !!location.trim();

  return (
    <div className="p-4 space-y-4 pb-20 overflow-x-hidden">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">База Поставщиков</h1>
        <div className="flex flex-wrap justify-end gap-2">
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleFileSelect} />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2.5 bg-violet-50 text-violet-600 rounded-xl" title="Импорт"><Upload size={18} /></button>
          <button type="button" onClick={() => setIsAdding(true)} className="p-2.5 bg-blue-600 text-white rounded-xl" title="Добавить"><UserPlus size={20} /></button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Поиск: имя / телефон / зона / бренд"
          autoComplete="off"
          className="w-full pl-11 pr-3 py-2.5 bg-white border border-gray-200 rounded-xl shadow-sm outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
        />
      </div>

      <button
        type="button"
        onClick={() => void forceRefreshSuppliers()}
        disabled={isForceSyncingSuppliers}
        className="w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-700 inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isForceSyncingSuppliers ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {isForceSyncingSuppliers ? 'Загружаю…' : 'Загрузить из сервера поставщиков'}
      </button>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
        Debug: suppliers.length = {suppliers.length} · displayed.length = {filtered.length}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2">
        <p className="text-xs font-bold text-slate-600">Фильтры поставщиков</p>
        <button type="button" onClick={() => setShowFiltersPanel((prev) => !prev)} className="text-xs font-black text-blue-700">
          {showFiltersPanel ? 'Свернуть ▲' : 'Открыть ▼'}
        </button>
      </div>
      {showFiltersPanel && <div className="space-y-1.5 max-h-[20vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
        <select className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}>
          <option value="all">Brand: all</option>
          {uniqueBrandsForFilter.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
        </select>
        <select className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" value={quickRadiusKm} onChange={(e) => setQuickRadiusKm(e.target.value === 'all' ? 'all' : Number(e.target.value) as 5 | 10 | 20 | 50)}>
          <option value="all">Radius: any</option>
          <option value={5}>5 km</option>
          <option value={10}>10 km</option>
          <option value={20}>20 km</option>
          <option value={50}>50 km</option>
        </select>
        <select className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" value={filterType} onChange={(e) => setFilterType(e.target.value as any)}>
          <option value="all">Type: all</option>
          <option value="new_parts">new_parts</option>
          <option value="scrapyard">used_parts</option>
          <option value="engine_specialist">specialist</option>
        </select>
        <label className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold inline-flex items-center gap-2"><input type="checkbox" checked={quickOpenNow} onChange={(e) => setQuickOpenNow(e.target.checked)} /> Open now</label>
        <label className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold inline-flex items-center gap-2"><input type="checkbox" checked={quickHasContacts} onChange={(e) => setQuickHasContacts(e.target.checked)} /> Has contacts</label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        <select className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" value={sortByExtended} onChange={(e) => setSortByExtended(e.target.value as any)}>
          <option value="smart">Sort: smart</option>
          <option value="trust">Sort: trust</option>
          <option value="heat">Sort: heat</option>
          <option value="near">Sort: near</option>
          <option value="name">Sort: name</option>
        </select>
        <select className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" value={filterGps} onChange={(e) => setFilterGps(e.target.value as any)}>
          <option value="all">GPS: все</option>
          <option value="has">Есть GPS</option>
          <option value="missing">Нет GPS</option>
        </select>
        <select className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" value={filterActivity} onChange={(e) => setFilterActivity(e.target.value as any)}>
          <option value="all">Активность: все</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="dormant">Dormant</option>
        </select>
        <button type="button" onClick={() => setShowAdvancedFilters((prev) => !prev)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold">Advanced {showAdvancedFilters ? '▲' : '▼'}</button>
      </div>
      {showAdvancedFilters && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5 rounded-xl border border-gray-100 bg-gray-50 p-2">
          <input value={advancedTrustMin} onChange={(e) => setAdvancedTrustMin(Number(e.target.value || 0))} type="number" min={0} max={100} placeholder="Trust >=" className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" />
          <input value={advancedSuccessMin} onChange={(e) => setAdvancedSuccessMin(Number(e.target.value || 0))} type="number" min={0} max={100} placeholder="Success >=" className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" />
          <input value={advancedHeatMin} onChange={(e) => setAdvancedHeatMin(Number(e.target.value || 0))} type="number" min={0} max={100} placeholder="Heat >=" className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" />
          <label className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold inline-flex items-center gap-2"><input type="checkbox" checked={advancedHasDelivery} onChange={(e) => setAdvancedHasDelivery(e.target.checked)} /> Has delivery</label>
          <label className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold inline-flex items-center gap-2"><input type="checkbox" checked={advancedFastWhatsapp} onChange={(e) => setAdvancedFastWhatsapp(e.target.checked)} /> Fast WhatsApp</label>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        <select className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" value={filterPartCategory} onChange={(e) => setFilterPartCategory(e.target.value)}>
          <option value="all">Категории деталей: все</option>
          {SUPPLIER_PART_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <input value={yearFrom} onChange={(e) => setYearFrom(e.target.value.replace(/[^\d]/g, ''))} placeholder="Год от" className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" />
        <input value={yearTo} onChange={(e) => setYearTo(e.target.value.replace(/[^\d]/g, ''))} placeholder="Год до" className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-semibold" />
        <div className="rounded-xl border border-gray-200 px-2 py-2 text-[11px] font-semibold text-gray-500">Дальние автоматически ниже</div>
      </div>

      </div>}

      {importError && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 border border-red-100"><AlertTriangle size={16} />{importError}</div>}
      {showSuccess && <div className="bg-green-50 text-green-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 border border-green-100"><CheckCircle2 size={16} />Данные успешно восстановлены!</div>}

      {isAdding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={() => { setIsAdding(false); resetAddForm(); }}>
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

      <div className="space-y-3">
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

        {filtered.length === 0 ? (
          <div className="py-20 text-center opacity-30 italic flex flex-col items-center gap-3"><Store size={48} />Поставщики не найдены</div>
        ) : (
          filtered.map((s) => {
            const Icon = s.type === 'scrapyard' ? Wrench : Gem;
            const brands = pickSupplierBrands(s);

            return (
              <div key={s.id} className="bg-white p-3 rounded-2xl shadow-sm space-y-2 border border-gray-100">
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
                        <p className="font-black text-sm leading-tight truncate">{brands.slice(0, 2).join(' • ') || 'Без марки'}</p>
                        <p className="text-[11px] font-semibold text-indigo-600 truncate">{(s.types && s.types.length > 0 ? s.types : [s.type || 'new_parts']).map((value) => FIELD_TYPES.find((t) => t.value === value)?.label || value).join(' + ')}</p>
                        <p className="text-[11px] text-gray-500 truncate">{s.name}</p>
                      </div>
                    </div>
                    <div className="text-right text-[10px] text-slate-500">
                      <p className="font-black">{s.coordinates ? `${Math.max(0.1, Number((Math.abs(s.coordinates.lat - sortByDistanceRef.lat) * 111).toFixed(1)))} km` : 'n/a'}</p>
                      <p>{expandedSupplierIds.has(s.id) ? 'Свернуть' : 'Открыть'}</p>
                    </div>
                  </div>

                  <div className="flex items-center flex-wrap gap-2 text-[10px] font-black uppercase">
                    <span className="rounded-full px-2 py-1 border border-emerald-200 bg-emerald-50 text-emerald-700">⭐ {s.successRate}%</span>
                    <span className="rounded-full px-2 py-1 border border-slate-200 bg-slate-50 text-slate-700">{daysAgoLabel(s.lastContactAt)}</span>
                  </div>
                </button>

                {expandedSupplierIds.has(s.id) && <>
                <div className="rounded-xl border border-gray-100 bg-slate-50 p-2 space-y-1">
                  <p className="text-[11px] font-semibold text-slate-700"><span className="font-black">Марки:</span> {(brands.length > 0 ? brands : ['—']).join(', ')}</p>
                  <p className="text-[11px] font-semibold text-slate-700"><span className="font-black">Модели:</span> {((s.models || []).length > 0 ? (s.models || []) : ['—']).join(', ')}</p>
                  <p className="text-[11px] font-semibold text-slate-700"><span className="font-black">Годы:</span> {((s.years || []).length > 0 ? (s.years || []).join(', ') : '—')}</p>
                </div>
                {Array.isArray(s.mainPartCategories) && s.mainPartCategories.length > 0 && <p className="text-[11px] text-slate-500">Основные детали: {s.mainPartCategories.slice(0, 3).join(', ')}</p>}

                <div className="grid grid-cols-2 md:grid-cols-7 gap-2 border-t border-gray-100 pt-3">
                  <button type="button" onClick={() => openMap(s.location || '')} className="rounded-lg bg-red-50 px-2 py-1.5 text-[10px] font-black text-red-700 inline-flex items-center justify-center gap-1"><Route size={12} />Map</button>
                  {(s.phone || '').trim() ? (
                    <>
                      <a href={`https://wa.me/${((s.whatsapp || s.phone) || '').replace(/[^\d]/g, '')}`} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-50 px-2 py-1.5 text-[10px] font-black text-emerald-700 inline-flex items-center justify-center gap-1"><MessageCircle size={12} />WhatsApp</a>
                      <a href={`tel:${s.phone}`} className="rounded-lg bg-green-50 px-2 py-1.5 text-[10px] font-black text-green-700 inline-flex items-center justify-center gap-1"><Phone size={12} />Call</a>
                    </>
                  ) : (
                    <>
                      <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-black text-amber-700">Нет контакта</span>
                      <button type="button" onClick={() => openContactEditor(s)} className="rounded-lg bg-amber-100 px-2 py-1.5 text-[10px] font-black text-amber-800 inline-flex items-center justify-center gap-1">➕ Добавить контакт</button>
                      <button type="button" onClick={() => { navigator.clipboard.writeText(s.name); alert('Название скопировано'); }} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-black text-slate-700">Скопировать название</button>
                    </>
                  )}
                  <button type="button" onClick={() => { setIsAdding(true); setEditingSupplierId(s.id); setName(s.name); setPhone(s.phone); setLocation(s.location); setShopType(s.type || 'new_parts'); setShopTypes((s.types && s.types.length > 0 ? s.types : [s.type || 'new_parts']) as SupplierType[]); setZone(s.zone || ''); setMainBrands(s.mainBrands || s.brands || []); setPrimaryBrand(s.primaryBrand || ''); setCoords(s.coordinates); setGpsAccuracy(s.gpsAccuracyMeters || null); setSupplierModelsInput((s.models || []).join(', ')); setSupplierYearsInput((s.years || []).join(', ')); setSupplierPhotos(s.photos || (s.photoUrl ? [s.photoUrl] : [])); setMainPartCategories(s.mainPartCategories || []); setWorkingHours(s.workingHours || ''); setTrustLevel(Number.isFinite(Number(s.trustLevel)) ? Number(s.trustLevel) : 3); setHasDelivery(!!s.hasDelivery); setWhatsappFast(!!s.whatsappFast); setComment(s.comment || ''); setWebsite(s.website || ''); }} className="rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] font-black text-slate-700 inline-flex items-center justify-center gap-1"><Pencil size={12} />Edit</button>
                  <button type="button" onClick={() => setDeleteSupplierId(s.id)} className="rounded-lg bg-rose-50 px-2 py-1.5 text-[10px] font-black text-rose-700 inline-flex items-center justify-center gap-1"><Trash2 size={12} />Delete</button>
                  <button type="button" onClick={() => toggleFavorite(s)} className="rounded-lg bg-pink-50 px-2 py-1.5 text-[10px] font-black text-pink-700 inline-flex items-center justify-center gap-1"><Heart size={12} />Favorite</button>
                  <button type="button" onClick={() => alert(`Analyze ${s.name}
Contacts: ${s.activityScore || 0}
Found: ${s.successRate}%
Last: ${daysAgoLabel(s.lastContactAt)}`)} className="rounded-lg bg-blue-50 px-2 py-1.5 text-[10px] font-black text-blue-700 inline-flex items-center justify-center gap-1"><Sparkles size={12} />Analyze</button>
                </div>
                </>}
                {expandedSupplierIds.has(s.id) && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <button type="button" onClick={() => setActiveOrderLinkShopId(activeOrderLinkShopId === s.id ? null : s.id)} className="w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 inline-flex items-center justify-center gap-2"><Link2 size={13} /> Управление деталями поставщика</button>
                  {activeOrderLinkShopId === s.id && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-2 space-y-2">
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
                        <select className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold" value={activeOrderPartLink?.supplierId === s.id ? activeOrderPartLink.orderId : ''} onChange={(e) => setActiveOrderPartLink({ supplierId: s.id, orderId: e.target.value, partId: '' })}>
                          <option value="">Заказ для детали</option>
                          {activeOrders.map((order) => <option key={order.id} value={order.id}>{order.brand} {order.model}</option>)}
                        </select>
                        <select className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold" value={activeOrderPartLink?.supplierId === s.id ? activeOrderPartLink.partId : ''} onChange={(e) => setActiveOrderPartLink((prev) => ({ supplierId: s.id, orderId: (prev?.supplierId === s.id ? prev.orderId : '') || selectedOrderBySupplier[s.id] || '', partId: e.target.value }))}>
                          <option value="">Деталь</option>
                          {(activeOrders.find((order) => order.id === (activeOrderPartLink?.supplierId === s.id ? activeOrderPartLink.orderId : selectedOrderBySupplier[s.id]))?.parts || []).map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
                        </select>
                      </div>
                      <button type="button" onClick={addSupplierToOrderPart} className="w-full rounded-lg bg-violet-100 px-2 py-2 text-[11px] font-black text-violet-800">Добавить деталь в карточку</button>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-black text-slate-700">Добавленные детали ({(s.linkedParts || []).length})</p>
                    </div>
                    {(s.linkedParts || []).length === 0 ? (
                      <p className="text-[11px] text-slate-500">Нет деталей. Добавьте через блок выше или через «Добавить варианты».</p>
                    ) : (s.linkedParts || []).map((entry) => (
                      <div key={entry.id} className="rounded-lg bg-white border border-slate-200 p-2 text-[11px]">
                        <p className="font-bold text-slate-700">{entry.orderLabel}</p>
                        <p className="text-slate-600">{entry.partName}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <select
                            value={entry.status}
                            onChange={(e) => updateLinkedPartStatus(s, entry, e.target.value as SupplierLinkedPartStatus)}
                            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold"
                          >
                            {Object.entries(LINKED_PART_STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                          </select>
                          {entry.priceAed ? <span className="font-black text-emerald-700">{entry.priceAed} AED</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                )}
              </div>
            );
          })
        )}
      </div>


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
      <ConfirmModal isOpen={!!deleteSupplierId} message="Вы уверены, что хотите удалить этого поставщика?" onConfirm={confirmDeleteSupplier} onCancel={() => setDeleteSupplierId(null)} />
      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
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
