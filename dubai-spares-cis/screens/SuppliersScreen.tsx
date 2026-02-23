import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Supplier, SupplierType } from '../types';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Ellipsis,
  Filter,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Route,
  Search,
  Upload,
  X
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { resolveCoordinatesFromLocation } from '../mapsLocation';
import { upsertSupplierToShops } from '../radarShops';
import { createUuid } from '../id';
import { CAR_DATABASE } from '../carDatabase';

const FIELD_TYPES: Array<{ value: SupplierType; label: string }> = [
  { value: 'new_parts', label: 'New Parts' },
  { value: 'scrapyard', label: 'Scrapyard' },
  { value: 'engine_specialist', label: 'Engine Specialist' },
  { value: 'body_parts', label: 'Body Parts' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'dealer', label: 'Dealer' },
  { value: 'warehouse', label: 'Warehouse' }
];

const POPULAR_UAE_BRANDS = ['Toyota', 'Nissan', 'Mitsubishi', 'Lexus', 'Honda', 'Hyundai', 'Kia', 'Mercedes-Benz', 'BMW', 'Ford'];

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

const activityLabel = (score = 0, lastContactAt?: number) => {
  const days = lastContactAt ? (Date.now() - lastContactAt) / (1000 * 60 * 60 * 24) : Infinity;
  if (days > 60) return 'dormant';
  if (score >= 14) return 'high';
  if (score >= 7) return 'medium';
  return 'low';
};

const SuppliersScreen: React.FC = () => {
  const navigate = useNavigate();
  const { suppliers, orders, addSupplier, updateSupplier, deleteSupplier, getBackupData, restoreData } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showToolbarMenu, setShowToolbarMenu] = useState(false);
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);

  const [filterType, setFilterType] = useState<'all' | SupplierType>('all');
  const [filterActivity, setFilterActivity] = useState<'all' | 'high' | 'medium' | 'low' | 'dormant'>('all');
  const [filterBrand, setFilterBrand] = useState('all');
  const [filterGps, setFilterGps] = useState<'all' | 'has' | 'missing'>('all');
  const [sortBy, setSortBy] = useState<'activity' | 'success' | 'last_contact'>('activity');
  const [onlyWhatsapp, setOnlyWhatsapp] = useState(false);
  const [onlyDelivery, setOnlyDelivery] = useState(false);
  const [onlyFastReply, setOnlyFastReply] = useState(false);

  const [isAdding, setIsAdding] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);
  const [showSavedToast, setShowSavedToast] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [shopType, setShopType] = useState<SupplierType>('new_parts');
  const [zone, setZone] = useState('');
  const [mainBrands, setMainBrands] = useState<string[]>([]);
  const [primaryBrand, setPrimaryBrand] = useState('');
  const [brandSearch, setBrandSearch] = useState('');
  const [supplierModelsInput, setSupplierModelsInput] = useState('');
  const [supplierYearsInput, setSupplierYearsInput] = useState('');
  const [workingHours, setWorkingHours] = useState('');
  const [website, setWebsite] = useState('');
  const [comment, setComment] = useState('');
  const [trustLevel, setTrustLevel] = useState(3);
  const [hasDelivery, setHasDelivery] = useState(false);
  const [whatsappFast, setWhatsappFast] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);

  const [recentBrands, setRecentBrands] = useState<string[]>([]);

  const [deleteSupplierId, setDeleteSupplierId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<any>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const [showSkeleton, setShowSkeleton] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSkeleton(false), 500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(searchInput), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('suppliers_recent_brands') || '[]');
      if (Array.isArray(stored)) setRecentBrands(stored.slice(0, 10));
    } catch {
      setRecentBrands([]);
    }
  }, []);

  const uniqueBrandsForFilter = useMemo(() => {
    const set = new Set<string>();
    suppliers.forEach((supplier) => (supplier.mainBrands || supplier.brands || []).forEach((brand) => set.add(brand)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [suppliers]);

  const supplierStatsMap = useMemo(() => {
    const stats: Record<string, { found: number; notFound: number; interactions30d: number; responsePoints: number; lastContactAt: number }> = {};
    const monthAgo = Date.now() - 1000 * 60 * 60 * 24 * 30;
    const ensure = (key: string) => {
      if (!stats[key]) stats[key] = { found: 0, notFound: 0, interactions30d: 0, responsePoints: 0, lastContactAt: 0 };
      return stats[key];
    };

    orders.forEach((order) => {
      const ts = Number(order.updatedAt || order.createdAt || 0);
      order.parts.forEach((part) => {
        part.variants.forEach((variant) => {
          const key = (variant.shopName || '').trim().toLowerCase();
          if (!key) return;
          const item = ensure(key);
          if (part.isFound) item.found += 1;
          else item.notFound += 1;
          if (ts >= monthAgo) item.interactions30d += 1;
          item.lastContactAt = Math.max(item.lastContactAt, ts);
          const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
          item.responsePoints += ageHours < 4 ? 4 : ageHours < 24 ? 2 : 1;
        });
      });
    });

    return stats;
  }, [orders]);

  const suppliersWithStats = useMemo(() => suppliers.map((supplier) => {
    const key = supplier.name.trim().toLowerCase();
    const stat = supplierStatsMap[key] || { found: 0, notFound: 0, interactions30d: 0, responsePoints: 0, lastContactAt: 0 };
    const foundCount = supplier.foundCount || stat.found;
    const notFoundCount = supplier.notFoundCount || stat.notFound;
    const total = foundCount + notFoundCount;
    const successRate = total > 0 ? Math.round((foundCount / total) * 100) : 0;
    const activityScore = foundCount * 2 + stat.interactions30d + stat.responsePoints;
    const lastContactAt = Math.max(Number(supplier.lastContactAt || 0), stat.lastContactAt || 0);
    return { ...supplier, successRate, activityScore, lastContactAt, activityState: activityLabel(activityScore, lastContactAt) };
  }), [suppliers, supplierStatsMap]);

  const filtered = useMemo(() => {
    const normalized = searchTerm.toLowerCase();
    const data = suppliersWithStats.filter((s) => {
      const matchesSearch = !normalized
        || s.name.toLowerCase().includes(normalized)
        || s.phone.includes(searchTerm)
        || (s.zone || '').toLowerCase().includes(normalized)
        || (s.mainBrands || s.brands || []).some((b) => b.toLowerCase().includes(normalized));
      const matchesType = filterType === 'all' || s.type === filterType;
      const matchesBrand = filterBrand === 'all' || (s.mainBrands || s.brands || []).includes(filterBrand);
      const hasGps = !!s.coordinates;
      const matchesGps = filterGps === 'all' || (filterGps === 'has' ? hasGps : !hasGps);
      const matchesActivity = filterActivity === 'all' || s.activityState === filterActivity;
      const matchesWhatsapp = !onlyWhatsapp || isValidE164(normalizePhone(s.phone));
      const matchesDelivery = !onlyDelivery || !!s.hasDelivery;
      const matchesFast = !onlyFastReply || !!s.whatsappFast;
      return matchesSearch && matchesType && matchesBrand && matchesGps && matchesActivity && matchesWhatsapp && matchesDelivery && matchesFast;
    });

    return data.sort((a, b) => {
      if (sortBy === 'success') return (b.successRate || 0) - (a.successRate || 0);
      if (sortBy === 'last_contact') return (b.lastContactAt || 0) - (a.lastContactAt || 0);
      return (b.activityScore || 0) - (a.activityScore || 0);
    });
  }, [suppliersWithStats, searchTerm, filterType, filterBrand, filterGps, filterActivity, onlyWhatsapp, onlyDelivery, onlyFastReply, sortBy]);

  const activeFiltersCount = [filterType !== 'all', filterActivity !== 'all', filterBrand !== 'all', filterGps !== 'all', sortBy !== 'activity', onlyWhatsapp, onlyDelivery, onlyFastReply].filter(Boolean).length;

  const filteredBrandOptions = useMemo(
    () => Object.keys(CAR_DATABASE).sort((a, b) => a.localeCompare(b)).filter((brand) => brand.toLowerCase().includes(brandSearch.toLowerCase())),
    [brandSearch]
  );

  const openMaps = (loc: string) => {
    if (!loc) return;
    if (loc.startsWith('http')) window.open(loc, '_blank');
    else window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`, '_blank');
  };

  const openWhatsapp = (supplier: Supplier) => {
    const normalized = normalizePhone(supplier.phone);
    if (!isValidE164(normalized)) return;
    window.open(`https://wa.me/${normalized.replace('+', '')}`, '_blank');
  };

  const resetFilters = () => {
    setFilterType('all');
    setFilterActivity('all');
    setFilterBrand('all');
    setFilterGps('all');
    setSortBy('activity');
    setOnlyWhatsapp(false);
    setOnlyDelivery(false);
    setOnlyFastReply(false);
  };

  const resetAddForm = () => {
    setEditingSupplierId(null);
    setName('');
    setPhone('');
    setLocation('');
    setShopType('new_parts');
    setZone('');
    setMainBrands([]);
    setPrimaryBrand('');
    setSupplierModelsInput('');
    setSupplierYearsInput('');
    setWorkingHours('');
    setWebsite('');
    setComment('');
    setTrustLevel(3);
    setHasDelivery(false);
    setWhatsappFast(false);
    setCoords(undefined);
    setShowAdvanced(false);
    setPhoneTouched(false);
  };

  const openCreate = () => {
    resetAddForm();
    setIsAdding(true);
  };

  const startEdit = (supplier: Supplier) => {
    setEditingSupplierId(supplier.id);
    setIsAdding(true);
    setShowAdvanced(true);
    setName(supplier.name || '');
    setPhone(supplier.phone || '');
    setLocation(supplier.location || '');
    setShopType(supplier.type || 'new_parts');
    setZone(supplier.zone || '');
    setMainBrands(supplier.mainBrands || supplier.brands || []);
    setPrimaryBrand(supplier.primaryBrand || '');
    setSupplierModelsInput((supplier.models || []).join(', '));
    setSupplierYearsInput((supplier.years || []).join(', '));
    setWorkingHours(supplier.workingHours || '');
    setWebsite(supplier.website || '');
    setComment(supplier.comment || '');
    setTrustLevel(supplier.trustLevel || 3);
    setHasDelivery(!!supplier.hasDelivery);
    setWhatsappFast(!!supplier.whatsappFast);
    setCoords(supplier.coordinates);
  };

  const toggleBrand = (brand: string) => {
    setMainBrands((prev) => prev.includes(brand) ? prev.filter((item) => item !== brand) : [...prev, brand]);
  };

  const saveRecentBrands = (brands: string[]) => {
    const next = [...new Set([...brands, ...recentBrands])].slice(0, 10);
    setRecentBrands(next);
    localStorage.setItem('suppliers_recent_brands', JSON.stringify(next));
  };

  const handleSave = async () => {
    const normalizedName = toTitle(name.trim());
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedName || !isValidE164(normalizedPhone) || !location.trim()) {
      setPhoneTouched(true);
      return;
    }
    setIsSavingSupplier(true);
    try {
      const resolvedCoordinates = coords || await resolveCoordinatesFromLocation(location, { fallbackQueries: [normalizedName] });
      const parsedModels = supplierModelsInput.split(',').map((item) => item.trim()).filter(Boolean);
      const parsedYears = supplierYearsInput.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item));
      const existing = editingSupplierId ? suppliers.find((s) => s.id === editingSupplierId) : null;
      const now = Date.now();
      const payload: Supplier = {
        id: existing?.id || createUuid(),
        name: normalizedName,
        phone: normalizedPhone,
        location,
        type: shopType,
        zone,
        brands: mainBrands,
        mainBrands,
        primaryBrand: primaryBrand || mainBrands[0] || '',
        models: parsedModels,
        years: parsedYears,
        coordinates: resolvedCoordinates,
        workingHours,
        trustLevel,
        hasDelivery,
        whatsappFast,
        hasWhatsapp: isValidE164(normalizedPhone),
        comment,
        website,
        isFavorite: existing?.isFavorite || false,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        syncStatus: navigator.onLine ? 'synced' : 'pending_sync'
      };

      if (existing) updateSupplier(payload);
      else addSupplier(payload);
      saveRecentBrands(mainBrands);

      if (navigator.onLine) {
        try {
          await upsertSupplierToShops(payload);
        } catch {
          updateSupplier({ ...payload, syncStatus: 'error' });
        }
      }

      setJustSavedId(payload.id);
      setShowSavedToast(true);
      if (editingSupplierId) {
        setIsAdding(false);
        resetAddForm();
      } else {
        setEditingSupplierId(payload.id);
        setShowAdvanced(false);
      }
    } finally {
      setIsSavingSupplier(false);
    }
  };

  const handleExport = () => {
    const data = getBackupData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dubai_spares_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json.orders) && Array.isArray(json.suppliers)) setImportFile(json);
        else setImportError('Неверный формат файла');
      } catch {
        setImportError('Ошибка чтения файла');
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      window.setTimeout(() => setImportError(null), 2500);
    };
    reader.readAsText(file);
  };

  const activeOrder = useMemo(() => orders.find((order) => !order.isArchived && !order.isSold), [orders]);

  return (
    <div className="p-4 space-y-4 pb-24">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Поиск: имя / телефон / зона / бренд"
            className="w-full rounded-2xl border border-gray-200 bg-white py-3 pl-10 pr-3 text-sm font-medium"
          />
        </div>
        <button type="button" onClick={() => setShowFilters(true)} className="relative rounded-xl border border-gray-200 bg-white p-3"><Filter size={18} />{activeFiltersCount > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 text-[10px] bg-blue-600 text-white rounded-full px-1">{activeFiltersCount}</span>}</button>
        <button type="button" onClick={openCreate} className="rounded-xl bg-blue-600 text-white p-3"><Plus size={18} /></button>
        <div className="relative">
          <button type="button" onClick={() => setShowToolbarMenu((prev) => !prev)} className="rounded-xl border border-gray-200 bg-white p-3"><Ellipsis size={18} /></button>
          {showToolbarMenu && (
            <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-gray-200 bg-white p-1 shadow-xl text-xs font-semibold">
              <button type="button" onClick={() => { handleExport(); setShowToolbarMenu(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 inline-flex items-center gap-2"><Download size={14} />Export</button>
              <button type="button" onClick={() => { fileInputRef.current?.click(); setShowToolbarMenu(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 inline-flex items-center gap-2"><Upload size={14} />Import</button>
            </div>
          )}
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleFileSelect} />

      {importError && <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 inline-flex items-center gap-2"><AlertTriangle size={14} />{importError}</div>}
      {showSuccess && <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-600 inline-flex items-center gap-2"><CheckCircle2 size={14} />Данные восстановлены</div>}

      {showSkeleton ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, idx) => <div key={idx} className="h-24 rounded-2xl bg-gray-200 animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 p-5 text-center space-y-3">
          <p className="text-sm font-semibold">No suppliers found</p>
          <div className="flex items-center justify-center gap-2">
            <button type="button" onClick={resetFilters} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold">Clear filters</button>
            <button type="button" onClick={openCreate} className="rounded-lg bg-blue-600 text-white px-3 py-2 text-xs font-bold">Add supplier</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => {
            const hasWa = isValidE164(normalizePhone(s.phone));
            const trust = s.trustLevel || 3;
            return (
              <button key={s.id} type="button" onClick={() => navigate(`/suppliers/${s.id}`)} className="w-full rounded-2xl border border-gray-200 bg-white p-3 text-left">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-sm">{s.name}</p>
                    <p className="text-[11px] text-gray-500">{s.type || 'new_parts'} {s.isFavorite ? '• ★' : ''}</p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold">{s.type === 'scrapyard' ? 'Scrapyard' : 'New parts'}</span>
                </div>
                <p className="mt-1 text-xs text-gray-600">📍 {s.zone || 'No zone'} • 🕒 {s.lastContactAt ? new Date(s.lastContactAt).toLocaleDateString('ru-RU') : 'нет контактов'} • ⭐ trust {trust}/5</p>
                <p className="mt-1 text-xs text-gray-600">{s.coordinates ? 'GPS saved ✅' : 'No GPS ⚠️'}</p>
                <div className="mt-2 grid grid-cols-4 gap-2" onClick={(e) => e.stopPropagation()}>
                  <button type="button" disabled={!hasWa} onClick={() => openWhatsapp(s)} className="rounded-lg bg-emerald-50 px-2 py-2 text-[11px] font-bold text-emerald-700 disabled:opacity-40 inline-flex items-center justify-center gap-1"><MessageCircle size={13} />WA</button>
                  <button type="button" onClick={() => openMaps(s.location)} className="rounded-lg bg-blue-50 px-2 py-2 text-[11px] font-bold text-blue-700 inline-flex items-center justify-center gap-1"><Route size={13} />Route</button>
                  <button type="button" onClick={() => window.open(`tel:${normalizePhone(s.phone)}`, '_self')} className="rounded-lg bg-slate-100 px-2 py-2 text-[11px] font-bold text-slate-700 inline-flex items-center justify-center gap-1"><Phone size={13} />Call</button>
                  <div className="relative">
                    <button type="button" onClick={() => setCardMenuId(cardMenuId === s.id ? null : s.id)} className="w-full rounded-lg border border-gray-200 px-2 py-2 text-[11px] font-bold inline-flex items-center justify-center"><Ellipsis size={13} /></button>
                    {cardMenuId === s.id && (
                      <div className="absolute right-0 bottom-10 z-20 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-xl text-xs font-semibold">
                        <button type="button" onClick={() => { startEdit(s); setCardMenuId(null); }} className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded">Edit</button>
                        <button type="button" onClick={() => { setDeleteSupplierId(s.id); setCardMenuId(null); }} className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded text-rose-600">Delete</button>
                        <button type="button" onClick={() => { updateSupplier({ ...s, isFavorite: !s.isFavorite, updatedAt: Date.now() }); setCardMenuId(null); }} className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded">Favorite</button>
                        <button type="button" onClick={() => { alert('Analyze скоро будет в профиле'); setCardMenuId(null); }} className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded">Analyze</button>
                        <button type="button" onClick={() => { navigate(`/suppliers/${s.id}`); setCardMenuId(null); }} className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded">History</button>
                        {activeOrder && <button type="button" onClick={() => { const next = new Set(activeOrder.recommendedShopIds || []); next.add(s.id); useStore.getState().updateOrder({ ...activeOrder, recommendedShopIds: Array.from(next), updatedAt: Date.now() }); setCardMenuId(null); }} className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded">Add to order</button>}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showFilters && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowFilters(false)}>
          <div className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white p-4 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">Active filters: {activeFiltersCount}</p>
              <button type="button" onClick={resetFilters} className="text-xs font-bold text-blue-600">Reset</button>
            </div>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value as any)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"><option value="all">Type: all</option>{FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
            <select value={filterActivity} onChange={(e) => setFilterActivity(e.target.value as any)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"><option value="all">Activity: all</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="dormant">Dormant</option></select>
            <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"><option value="all">Brand: all</option>{uniqueBrandsForFilter.map((b) => <option key={b} value={b}>{b}</option>)}</select>
            <select value={filterGps} onChange={(e) => setFilterGps(e.target.value as any)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"><option value="all">GPS: all</option><option value="has">Has GPS</option><option value="missing">Missing GPS</option></select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"><option value="activity">Sort: activity</option><option value="success">Sort: success</option><option value="last_contact">Sort: last contact</option></select>
            <label className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-sm"><span>Only with WhatsApp</span><input type="checkbox" checked={onlyWhatsapp} onChange={(e) => setOnlyWhatsapp(e.target.checked)} /></label>
            <label className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-sm"><span>Has delivery</span><input type="checkbox" checked={onlyDelivery} onChange={(e) => setOnlyDelivery(e.target.checked)} /></label>
            <label className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-sm"><span>Fast WhatsApp reply</span><input type="checkbox" checked={onlyFastReply} onChange={(e) => setOnlyFastReply(e.target.checked)} /></label>
            <label className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-sm opacity-50"><span>Open now</span><input type="checkbox" disabled /></label>
            <button type="button" onClick={() => setShowFilters(false)} className="w-full rounded-xl bg-blue-600 py-2 text-sm font-bold text-white">Close</button>
          </div>
        </div>
      )}

      {isAdding && (
        <div className="fixed inset-0 z-50 bg-black/50 p-3" onClick={() => { setIsAdding(false); resetAddForm(); }}>
          <div className="mx-auto max-w-md rounded-3xl bg-white p-4 max-h-[90vh] overflow-y-auto space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">{editingSupplierId ? 'Edit supplier' : 'Quick Add supplier'}</h3>
              <button type="button" onClick={() => { setIsAdding(false); resetAddForm(); }}><X size={16} /></button>
            </div>
            <input value={name} onChange={(e) => setName(toTitle(e.target.value))} placeholder="Название*" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            <div>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhoneTouched(true)} placeholder="Телефон WhatsApp*" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              <p className="mt-1 text-[11px] text-gray-500">Example: +971501234567</p>
              {phoneTouched && !isValidE164(normalizePhone(phone)) && <p className="text-[11px] text-rose-600">Введите номер WhatsApp в формате +971…</p>}
            </div>
            <div className="rounded-xl border border-gray-200 p-2">
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="GPS/Адрес*" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              {!coords ? (
                <p className="mt-1 text-[11px] text-gray-500">Paste Google Maps link or type address</p>
              ) : (
                <p className="mt-1 text-[11px] text-emerald-600">{zone || 'Area'} • GPS saved ✅</p>
              )}
              <div className="mt-2 flex gap-2">
                {!coords ? (
                  <button type="button" onClick={() => navigator.geolocation.getCurrentPosition((pos) => { const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }; setCoords(c); setLocation(`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`); })} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">📍 Get location</button>
                ) : (
                  <>
                    <button type="button" onClick={() => openMaps(location)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold">Open in Maps</button>
                    <button type="button" onClick={() => setCoords(undefined)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold">Change</button>
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">{FIELD_TYPES.map((t) => <button key={t.value} type="button" onClick={() => setShopType(t.value)} className={`rounded-lg border px-2 py-1.5 text-xs font-bold ${shopType === t.value ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200'}`}>{t.label}</button>)}</div>

            <button type="button" onClick={handleSave} disabled={isSavingSupplier} className="w-full rounded-xl bg-blue-600 py-2 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2">{isSavingSupplier ? <><Loader2 size={14} className="animate-spin" />Saving...</> : 'Save'}</button>

            <button type="button" onClick={() => setShowAdvanced((prev) => !prev)} className="w-full rounded-xl border border-gray-200 py-2 text-sm font-bold">Advanced</button>
            {showAdvanced && (
              <div className="space-y-2 rounded-xl border border-gray-200 p-3">
                <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Zone" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                <div className="space-y-2">
                  <p className="text-xs font-bold">Main brands</p>
                  <div className="flex flex-wrap gap-1">{POPULAR_UAE_BRANDS.map((brand) => <button key={brand} type="button" onClick={() => toggleBrand(brand)} className={`rounded-full px-2 py-1 text-[11px] font-bold ${mainBrands.includes(brand) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{brand}</button>)}</div>
                  <button type="button" onClick={() => setMainBrands((prev) => [...new Set([...prev, ...POPULAR_UAE_BRANDS])])} className="text-xs font-bold text-blue-600">Select all common for UAE</button>
                  {recentBrands.length > 0 && <div className="flex flex-wrap gap-1">{recentBrands.map((brand) => <button key={brand} type="button" onClick={() => toggleBrand(brand)} className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">{brand}</button>)}</div>}
                  <input value={brandSearch} onChange={(e) => setBrandSearch(e.target.value)} placeholder="Search brand" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  <div className="max-h-24 overflow-y-auto rounded-lg border border-gray-200 p-1">{filteredBrandOptions.slice(0, 50).map((brand) => <button key={brand} type="button" onClick={() => toggleBrand(brand)} className={`m-1 rounded-full px-2 py-1 text-[11px] font-bold ${mainBrands.includes(brand) ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700'}`}>{brand}</button>)}</div>
                </div>
                <input value={primaryBrand} onChange={(e) => setPrimaryBrand(e.target.value)} placeholder="Primary brand" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                <input value={supplierModelsInput} onChange={(e) => setSupplierModelsInput(e.target.value)} placeholder="Models (comma separated)" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                <input value={supplierYearsInput} onChange={(e) => setSupplierYearsInput(e.target.value)} placeholder="Years (comma separated)" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                <input value={workingHours} onChange={(e) => setWorkingHours(e.target.value)} placeholder="Working hours" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                <label className="text-xs font-bold">Trust: {trustLevel}/5<input type="range" min={1} max={5} value={trustLevel} onChange={(e) => setTrustLevel(Number(e.target.value))} className="w-full" /></label>
                <label className="flex items-center justify-between text-sm">Has delivery <input type="checkbox" checked={hasDelivery} onChange={(e) => setHasDelivery(e.target.checked)} /></label>
                <label className="flex items-center justify-between text-sm">Fast WhatsApp reply <input type="checkbox" checked={whatsappFast} onChange={(e) => setWhatsappFast(e.target.checked)} /></label>
              </div>
            )}
          </div>
        </div>
      )}

      {showSavedToast && (
        <div className="fixed left-1/2 top-16 z-[70] -translate-x-1/2 rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">
          Supplier saved
          <div className="mt-1 flex gap-2">
            <button type="button" onClick={() => { const s = suppliers.find((item) => item.id === justSavedId); if (s) openWhatsapp(s); }} className="rounded bg-white/20 px-2 py-1">Open WhatsApp</button>
            <button type="button" onClick={() => { setShowAdvanced(true); setShowSavedToast(false); setIsAdding(true); }} className="rounded bg-white/20 px-2 py-1">Add brands (optional)</button>
            {activeOrder && <button type="button" onClick={() => { if (!justSavedId) return; const next = new Set(activeOrder.recommendedShopIds || []); next.add(justSavedId); useStore.getState().updateOrder({ ...activeOrder, recommendedShopIds: Array.from(next), updatedAt: Date.now() }); setShowSavedToast(false); }} className="rounded bg-white/20 px-2 py-1">Add to order</button>}
          </div>
        </div>
      )}

      <ConfirmModal isOpen={!!deleteSupplierId} message="Вы уверены, что хотите удалить поставщика?" onConfirm={async () => { if (!deleteSupplierId) return; await deleteSupplier(deleteSupplierId); setDeleteSupplierId(null); }} onCancel={() => setDeleteSupplierId(null)} />
      <ConfirmModal
        isOpen={!!importFile}
        message={`Восстановить резервную копию?\n\nПоставщиков: ${importFile?.suppliers?.length || 0}`}
        confirmLabel="Восстановить"
        cancelLabel="Отмена"
        onConfirm={() => { restoreData(importFile); setImportFile(null); setShowSuccess(true); window.setTimeout(() => setShowSuccess(false), 3000); }}
        onCancel={() => setImportFile(null)}
      />
    </div>
  );
};

export default SuppliersScreen;
