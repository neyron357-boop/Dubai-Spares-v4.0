import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, syncSuppliersFromServer } from '../store';
import { Supplier, SupplierLinkedPartEntry, SupplierLinkedPartStatus, SupplierType } from '../types';
import {
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
import AddSupplierWizard, { WizardFormData } from '../components/AddSupplierWizard';
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

  const [contactEditorSupplierId, setContactEditorSupplierId] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [sortByDistanceRef, setSortByDistanceRef] = useState<{ lat: number; lng: number }>({ lat: 25.2048, lng: 55.2708 });
  const [sortByExtended, setSortByExtended] = useState<'smart' | 'trust' | 'heat' | 'near' | 'name'>('smart');
  const [nameSearch, setNameSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [partCategoryFilter, setPartCategoryFilter] = useState('all');
  const [expandedSupplierIds, setExpandedSupplierIds] = useState<Set<string>>(new Set());
  const [expandedAddedPartsIds, setExpandedAddedPartsIds] = useState<Set<string>>(new Set());
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
    const calcDistanceKm = (supplier: Supplier & { coordinates?: { lat: number; lng: number } }) => {
      if (!supplier.coordinates) return Number.POSITIVE_INFINITY;
      const latDiff = (supplier.coordinates.lat - sortByDistanceRef.lat) * 111;
      const lngDiff = (supplier.coordinates.lng - sortByDistanceRef.lng) * 111;
      return Math.sqrt((latDiff * latDiff) + (lngDiff * lngDiff));
    };

    const selectedYear = Number(yearFilter);
    const hasSelectedYear = yearFilter !== 'all' && Number.isFinite(selectedYear);

    return [...rawSuppliers]
      .filter((supplier) => {
        const nameSearchLower = nameSearch.trim().toLowerCase();
        const brandMatch = brandFilter === 'all' || pickSupplierBrands(supplier).includes(brandFilter);
        const modelMatch = modelFilter === 'all' || (supplier.models || []).includes(modelFilter);
        const supplierYears = normalizeSupplierYears(supplier.years);
        const yearMatch = !hasSelectedYear || supplierYears.includes(selectedYear);
        const categoryMatch = partCategoryFilter === 'all' || (supplier.mainPartCategories || []).includes(partCategoryFilter);
        const nameMatch = !nameSearchLower || supplier.name.toLowerCase().includes(nameSearchLower);
        return brandMatch && modelMatch && yearMatch && categoryMatch && nameMatch;
      })
      .sort((a, b) => {
      const distanceA = calcDistanceKm(a);
      const distanceB = calcDistanceKm(b);

      if (sortByExtended === 'trust') return (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0)) || (Number(b.heatLevel || 0) - Number(a.heatLevel || 0)) || distanceA - distanceB || a.name.localeCompare(b.name);
      if (sortByExtended === 'heat') return (Number(b.heatLevel || 0) - Number(a.heatLevel || 0)) || (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0)) || distanceA - distanceB || a.name.localeCompare(b.name);
      if (sortByExtended === 'near') return distanceA - distanceB || (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0));
      if (sortByExtended === 'name') return a.name.localeCompare(b.name) || distanceA - distanceB;
      return (Number(b.autoTrustScore ?? b.trustLevel ?? 0) - Number(a.autoTrustScore ?? a.trustLevel ?? 0)) || (Number(b.heatLevel || 0) - Number(a.heatLevel || 0)) || distanceA - distanceB || a.name.localeCompare(b.name);
    });
  }, [brandFilter, modelFilter, nameSearch, partCategoryFilter, rawSuppliers, sortByExtended, sortByDistanceRef, yearFilter]);

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

  const handleWizardSave = async (wizardData: WizardFormData) => {
    setIsSavingSupplier(true);
    try {
      const normalizedName = toTitle(wizardData.name.trim());
      const normalizedPhone = normalizePhone(wizardData.phone);
      const resolvedCoordinates = wizardData.coords || await resolveCoordinatesFromLocation(wizardData.location, {
        fallbackQueries: wizardData.name.trim() ? [wizardData.name.trim(), `${wizardData.name.trim()} Dubai`] : [],
        onManualLocationRequired: () => {}
      });
      const inferredZone = wizardData.zone || inferZoneFromCoords(resolvedCoordinates || undefined);
      const parsedModels = wizardData.supplierModelsInput.split(',').map((item) => item.trim()).filter(Boolean);
      const parsedYears = wizardData.supplierYearsInput.split(',').map((item) => Number(item.trim())).filter((year) => Number.isFinite(year));
      const now = Date.now();
      const existingSupplier = editingSupplierId ? suppliers.find((s) => s.id === editingSupplierId) : null;
      const supplierPayload: Supplier = {
        id: existingSupplier?.id || createUuid(),
        name: normalizedName,
        phone: normalizedPhone,
        location: wizardData.location,
        type: wizardData.shopTypes[0] || 'new_parts',
        types: wizardData.shopTypes,
        zone: inferredZone,
        heatLevel: 0,
        brands: wizardData.mainBrands,
        mainBrands: wizardData.mainBrands,
        primaryBrand: wizardData.primaryBrand || wizardData.mainBrands[0] || '',
        models: parsedModels,
        years: parsedYears,
        bodyTypes: existingSupplier?.bodyTypes || [],
        mainPartCategories: wizardData.mainPartCategories,
        photoUrl: wizardData.supplierPhotos[0],
        photos: wizardData.supplierPhotos,
        coordinates: resolvedCoordinates,
        gpsAccuracyMeters: wizardData.gpsAccuracy || undefined,
        workingHours: wizardData.workingHours,
        trustLevel: wizardData.trustLevel,
        hasDelivery: wizardData.hasDelivery,
        hasWhatsapp: isValidE164(normalizedPhone),
        whatsappFast: wizardData.whatsappFast,
        comment: wizardData.comment,
        website: wizardData.website,
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
        try { await upsertSupplierToShops(supplierPayload); }
        catch { updateSupplier({ ...supplierPayload, syncStatus: 'error' }); }
      }
      setIsAdding(false);
      setEditingSupplierId(null);
    } finally {
      setIsSavingSupplier(false);
    }
  };

  const buildWizardInitialValues = (supplierId: string): Partial<WizardFormData> => {
    const s = suppliers.find((supplier) => supplier.id === supplierId);
    if (!s) return {};
    return {
      name: s.name,
      phone: s.phone,
      shopTypes: (s.types && s.types.length > 0 ? s.types : [s.type || 'new_parts']) as SupplierType[],
      location: s.location,
      zone: s.zone || '',
      coords: s.coordinates,
      gpsAccuracy: s.gpsAccuracyMeters,
      hasDelivery: !!s.hasDelivery,
      deliveryDescription: '',
      mainBrands: s.mainBrands || s.brands || [],
      primaryBrand: s.primaryBrand || '',
      supplierModelsInput: (s.models || []).join(', '),
      supplierYearsInput: (normalizeSupplierYears(s.years)).join(', '),
      supplierPhotos: s.photos || (s.photoUrl ? [s.photoUrl] : []),
      mainPartCategories: s.mainPartCategories || [],
      workingHours: s.workingHours || '',
      website: s.website || '',
      trustLevel: Number.isFinite(Number(s.trustLevel)) ? Number(s.trustLevel) : 3,
      whatsappFast: !!s.whatsappFast,
      comment: s.comment || '',
      isDraft: false
    };
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
    updateOrder({ ...order, recommendedShopIds: Array.from(current), updatedAt: Date.now() });
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
    const nextSupplier = { ...supplier, linkedParts: nextEntries, updatedAt: Date.now() };
    updateSupplier(nextSupplier);
    void upsertSupplierToShops(nextSupplier);
    removeRadarManualSelection({ supplierId: supplier.id, orderId: entry.orderId, partId: entry.partId });
    refreshManualSelections();
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
      if (fetchedCount === 0) {
        toast('Сервер вернул 0 поставщиков. Проверьте источник данных.', 'info');
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

      <button
        type="button"
        onClick={() => void forceRefreshSuppliers()}
        disabled={isForceSyncingSuppliers}
        className="w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-700 inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isForceSyncingSuppliers ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {isForceSyncingSuppliers ? 'Загружаю…' : 'Загрузить из сервера поставщиков'}
      </button>

      <div className="rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Filters</p>
          <button
            type="button"
            onClick={() => {
              setSortByExtended('smart');
              setBrandFilter('all');
              setModelFilter('all');
              setYearFilter('all');
              setPartCategoryFilter('all');
              setNameSearch('');
            }}
            className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600"
          >
            Reset
          </button>
        </div>
        {/* Name search */}
        <div className="mb-2">
          <input
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blue-400"
            placeholder="Поиск по названию…"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
          />
        </div>
        <div className="mb-2">
          <select className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold" value={sortByExtended} onChange={(e) => setSortByExtended(e.target.value as any)}>
            <option value="smart">Sort: smart</option>
            <option value="trust">Trust ↓</option>
            <option value="heat">Heat ↓</option>
            <option value="near">Distance ↑</option>
            <option value="name">Name A→Z</option>
          </select>
        </div>
        {/* Brand chips */}
        <div className="mb-2 flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
          {(['all', ...supplierFilterOptions.brands.slice(0, 8)] as string[]).map((brand) => (
            <button
              key={brand}
              type="button"
              onClick={() => setBrandFilter(brand)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold border transition-all ${
                brandFilter === brand
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              {brand === 'all' ? 'All brands' : brand}
            </button>
          ))}
          {supplierFilterOptions.brands.length > 8 && brandFilter !== 'all' && !supplierFilterOptions.brands.slice(0, 8).includes(brandFilter) && (
            <button
              type="button"
              onClick={() => setBrandFilter('all')}
              className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold border bg-blue-600 text-white border-blue-600"
            >
              {brandFilter}
            </button>
          )}
          {supplierFilterOptions.brands.length > 8 && (
            <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold border border-slate-200 bg-slate-50 text-slate-400">
              +{supplierFilterOptions.brands.length - 8}
            </span>
          )}
        </div>
        {/* Category chips */}
        <div className="mb-2 flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
          {(['all', ...supplierFilterOptions.partCategories] as string[]).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setPartCategoryFilter(cat)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold border transition-all ${
                partCategoryFilter === cat
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              {cat === 'all' ? 'All cats' : cat}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold" value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
            <option value="all">Model: all</option>
            {supplierFilterOptions.models.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
          <select className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="all">Year: all</option>
            {supplierFilterOptions.years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
      </div>

      {importError && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 border border-red-100"><AlertTriangle size={16} />{importError}</div>}
      {showSuccess && <div className="bg-green-50 text-green-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 border border-green-100"><CheckCircle2 size={16} />Данные успешно восстановлены!</div>}

      {isAdding && (
        <AddSupplierWizard
          existingSupplierId={editingSupplierId}
          initialValues={editingSupplierId ? buildWizardInitialValues(editingSupplierId) : undefined}
          onSave={handleWizardSave}
          onClose={() => { setIsAdding(false); setEditingSupplierId(null); }}
          suppliers={suppliers}
          brandOptions={brandOptions}
        />
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

        {filteredSuppliers.length === 0 ? (
          <div className="py-20 text-center opacity-30 italic flex flex-col items-center gap-3"><Store size={48} />Поставщики не найдены</div>
        ) : (
          filteredSuppliers.map((s) => {
            const Icon = s.type === 'scrapyard' ? Wrench : Gem;
            const brands = pickSupplierBrands(s);
            const isExpanded = expandedSupplierIds.has(s.id);
            const linkedParts = [...(s.linkedParts || [])].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
            const isManagePartsExpanded = activeOrderLinkShopId === s.id;
            const isAddedPartsExpanded = expandedAddedPartsIds.has(s.id);

            return (
              <div key={s.id} className={`rounded-2xl p-3 shadow-sm space-y-2 border transition-all duration-300 ease-out ${isExpanded ? 'bg-indigo-50/60 border-indigo-200 shadow-indigo-100/70' : 'bg-white border-gray-100 hover:border-slate-200 hover:shadow-md'}`}>
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
                      <p>{isExpanded ? 'Свернуть' : 'Открыть'}</p>
                    </div>
                  </div>

                  <div className="flex items-center flex-wrap gap-2 text-[10px] font-black uppercase">
                    {(() => { const tl = Math.max(1, Math.min(5, Math.round(s.trustLevel || s.autoTrustScore || 1))); return (
                      <span className="rounded-full px-2 py-1 border border-amber-200 bg-amber-50 text-amber-700">
                        {'★'.repeat(tl)}{'☆'.repeat(5 - tl)}
                      </span>
                    ); })()}
                    <span className="rounded-full px-2 py-1 border border-slate-200 bg-slate-50 text-slate-700">{daysAgoLabel(s.lastContactAt)}</span>
                    <span className={`rounded-full px-2 py-1 border text-[10px] font-black uppercase ${
                      (s.phone || '').trim()
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                    }`}>
                      {(s.phone || '').trim() ? 'Контакт ✓' : 'Нет контакта'}
                    </span>
                  </div>
                </button>

                <div className="overflow-hidden transition-all duration-300 ease-out" style={{ maxHeight: isExpanded ? 2200 : 0, opacity: isExpanded ? 1 : 0 }}>
                {isExpanded && <>
                <div className="rounded-xl border border-gray-100 bg-slate-50 p-2 space-y-1">
                  <p className="text-[11px] font-semibold text-slate-700"><span className="font-black">Марки:</span> {(brands.length > 0 ? brands : ['—']).join(', ')}</p>
                  <p className="text-[11px] font-semibold text-slate-700"><span className="font-black">Модели:</span> {((s.models || []).length > 0 ? (s.models || []) : ['—']).join(', ')}</p>
                  <p className="text-[11px] font-semibold text-slate-700"><span className="font-black">Годы:</span> {(normalizeSupplierYears(s.years).length > 0 ? normalizeSupplierYears(s.years).join(', ') : '—')}</p>
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
                  <button type="button" onClick={() => { setEditingSupplierId(s.id); setIsAdding(true); }} className="rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] font-black text-slate-700 inline-flex items-center justify-center gap-1"><Pencil size={12} />Edit</button>
                  <button type="button" onClick={() => setDeleteSupplierId(s.id)} className="rounded-lg bg-rose-50 px-2 py-1.5 text-[10px] font-black text-rose-700 inline-flex items-center justify-center gap-1"><Trash2 size={12} />Delete</button>
                  <button type="button" onClick={() => toggleFavorite(s)} className="rounded-lg bg-pink-50 px-2 py-1.5 text-[10px] font-black text-pink-700 inline-flex items-center justify-center gap-1"><Heart size={12} />Favorite</button>
                  
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
