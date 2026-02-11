import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Supplier } from '../types';
import {
  Search,
  Phone,
  MapPin,
  Store,
  UserPlus,
  Download,
  Upload,
  Trash2,
  Tag,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Wrench,
  Gem,
  Link2,
  LocateFixed
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { resolveCoordinatesFromLocation } from '../mapsLocation';
import { upsertSupplierToShops } from '../radarShops';
import { createUuid } from '../id';
import { CAR_DATABASE } from '../carDatabase';

const KNOWN_ZONES = [
  { name: 'Sajja Scrapyard', lat: 25.344, lng: 55.54 },
  { name: 'Al Quoz', lat: 25.142, lng: 55.224 },
  { name: 'Ras Al Khor', lat: 25.175, lng: 55.371 },
  { name: 'Umm Ramool', lat: 25.223, lng: 55.364 }
];

const toRad = (v: number) => (v * Math.PI) / 180;
const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const calc = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
};

const suggestZoneFromCoordinates = (coords?: { lat: number; lng: number }) => {
  if (!coords) return '';
  return KNOWN_ZONES
    .map((zone) => ({ ...zone, distance: distanceMeters(coords, zone) }))
    .sort((a, b) => a.distance - b.distance)[0]?.name || '';
};

const SuppliersScreen: React.FC = () => {
  const { suppliers, addSupplier, deleteSupplier, getBackupData, restoreData, orders, updateOrder } = useStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteSupplierId, setDeleteSupplierId] = useState<string | null>(null);

  const [importFile, setImportFile] = useState<any>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [shopType, setShopType] = useState<'new_parts' | 'scrapyard'>('new_parts');
  const [zone, setZone] = useState('');
  const [mainBrands, setMainBrands] = useState<string[]>([]);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [locationParseNotice, setLocationParseNotice] = useState<string | null>(null);
  const [activeOrderLinkShopId, setActiveOrderLinkShopId] = useState<string | null>(null);

  const activeOrders = useMemo(
    () => orders.filter((order) => !order.isArchived && !order.isSold),
    [orders]
  );

  const brandOptions = useMemo(() => Object.keys(CAR_DATABASE).sort((a, b) => a.localeCompare(b)), []);

  const supplierHeatMap = useMemo(() => {
    const successMap: Record<string, number> = {};
    const monthAgo = Date.now() - 1000 * 60 * 60 * 24 * 30;

    orders.forEach((order) => {
      const normalizedOrderAt = Number(order.createdAt || 0);
      if (normalizedOrderAt > 0 && normalizedOrderAt < monthAgo) return;
      order.parts.forEach((part) => {
        const firstVariant = part.variants[0];
        if (!part.isFound || !firstVariant?.shopName) return;
        const key = firstVariant.shopName.trim().toLowerCase();
        if (!key) return;
        successMap[key] = (successMap[key] || 0) + 1;
      });
    });

    return successMap;
  }, [orders]);

  const filtered = suppliers.filter((s) => {
    const normalized = searchTerm.toLowerCase();
    return s.name.toLowerCase().includes(normalized)
      || s.phone.includes(searchTerm)
      || (s.brands || []).some((b) => b.toLowerCase().includes(normalized))
      || (s.mainBrands || []).some((b) => b.toLowerCase().includes(normalized))
      || (s.models || []).some((m) => m.toLowerCase().includes(normalized))
      || (s.years || []).some((y) => String(y).includes(searchTerm))
      || (s.bodyTypes || []).some((bodyType) => bodyType.toLowerCase().includes(normalized));
  });

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

  const autofillLocationFromGps = () => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!location.trim()) {
          setLocation(`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`);
        }
        if (!zone) {
          setZone(suggestZoneFromCoordinates(coords));
        }
      },
      () => {
        // keep manual mode
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleSave = async () => {
    if (!name.trim()) return;

    setIsSavingSupplier(true);
    try {
      const coordinates = await resolveCoordinatesFromLocation(location, {
        fallbackQueries: buildSupplierFallbackQueries(),
        onManualLocationRequired: setLocationParseNotice
      });
      const inferredZone = zone || suggestZoneFromCoordinates(coordinates || undefined);
      const heatLevel = supplierHeatMap[name.trim().toLowerCase()] || 0;

      const newSupplier: Supplier = {
        id: createUuid(),
        name: name.trim(),
        phone,
        location,
        type: shopType,
        zone: inferredZone,
        heatLevel,
        brands: mainBrands,
        mainBrands,
        models: [],
        years: [],
        bodyTypes: [],
        coordinates
      };

      addSupplier(newSupplier);
      await upsertSupplierToShops(newSupplier);

      setName('');
      setPhone('');
      setLocation('');
      setMainBrands([]);
      setShopType('new_parts');
      setZone('');
      setLocationParseNotice(null);
      setIsAdding(false);
    } finally {
      setIsSavingSupplier(false);
    }
  };

  const handleExport = () => {
    try {
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
    } catch {
      alert('Ошибка при создании резервной копии');
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

  const addSupplierToOrder = (shopId: string, orderId: string) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;

    const current = new Set(order.recommendedShopIds || []);
    current.add(shopId);
    const nextDismissed = (order.dismissedShopIds || []).filter((id) => id !== shopId);
    updateOrder({ ...order, recommendedShopIds: Array.from(current), dismissedShopIds: nextDismissed });
    setActiveOrderLinkShopId(null);
  };

  return (
    <div className="p-4 space-y-4 pb-20 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">База Поставщиков</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="p-3 bg-emerald-50 text-emerald-600 rounded-xl active:bg-emerald-100 transition-colors"
            title="Экспорт"
          >
            <Download size={18} />
          </button>
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleFileSelect} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-3 bg-violet-50 text-violet-600 rounded-xl active:bg-violet-100 transition-colors"
            title="Импорт"
          >
            <Upload size={18} />
          </button>
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="p-3 bg-blue-600 text-white rounded-xl active:bg-blue-700 transition-colors"
            title="Добавить"
          >
            <UserPlus size={20} />
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Поиск магазина, телефона или локации..."
          autoComplete="off"
          className="w-full pl-12 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl shadow-sm outline-none focus:ring-2 focus:ring-blue-500 font-medium text-base"
        />
      </div>

      {importError && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-2 border border-red-100">
          <AlertTriangle size={16} />
          {importError}
        </div>
      )}

      {showSuccess && (
        <div className="bg-green-50 text-green-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-2 border border-green-100">
          <CheckCircle2 size={16} />
          Данные успешно восстановлены!
        </div>
      )}

      {isAdding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setIsAdding(false)}>
          <form
            onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
            className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 duration-200 space-y-5 max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold">Field-Add: Новый Поставщик</h2>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Название магазина</label>
                <input
                  placeholder="Dubai Parts LTD"
                  value={name} onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  className="w-full bg-gray-50 border border-gray-100 p-4 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Телефон</label>
                <input
                  placeholder="+971..."
                  value={phone} onChange={(e) => setPhone(e.target.value)}
                  autoComplete="off"
                  className="w-full bg-gray-50 border border-gray-100 p-4 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Тип магазина</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button type="button" onClick={() => setShopType('new_parts')} className={`rounded-xl border px-3 py-2 text-xs font-black inline-flex items-center justify-center gap-2 ${shopType === 'new_parts' ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-white border-gray-200 text-gray-500'}`}><Gem size={14} /> New Parts</button>
                  <button type="button" onClick={() => setShopType('scrapyard')} className={`rounded-xl border px-3 py-2 text-xs font-black inline-flex items-center justify-center gap-2 ${shopType === 'scrapyard' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-gray-200 text-gray-500'}`}><Wrench size={14} /> Scrapyard</button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Локация / Карта</label>
                  <button type="button" onClick={autofillLocationFromGps} className="text-[10px] font-black uppercase text-blue-600 inline-flex items-center gap-1">
                    <LocateFixed size={12} /> GPS
                  </button>
                </div>
                <input
                  placeholder="Ссылка или описание..."
                  value={location} onChange={(e) => { setLocation(e.target.value); setLocationParseNotice(null); }}
                  autoComplete="off"
                  className="w-full bg-gray-50 border border-gray-100 p-4 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Зона (Geo-Fence)</label>
                <input
                  placeholder="Например: Sajja Scrapyard"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  autoComplete="off"
                  className="w-full bg-gray-50 border border-gray-100 p-4 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Main Brands</label>
                <div className="max-h-36 overflow-y-auto rounded-xl border border-gray-100 p-2 bg-gray-50 flex flex-wrap gap-1.5">
                  {brandOptions.map((brand) => (
                    <button key={brand} type="button" onClick={() => toggleMainBrand(brand)} className={`px-2 py-1 rounded-lg text-[10px] font-black border ${mainBrands.includes(brand) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {brand}
                    </button>
                  ))}
                </div>
              </div>
              {locationParseNotice && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                  {locationParseNotice}
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setIsAdding(false)} className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold active:bg-gray-200 transition-colors uppercase text-xs">Отмена</button>
              <button type="submit" disabled={isSavingSupplier} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg active:bg-blue-700 transition-colors uppercase text-xs disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">{isSavingSupplier ? <><Loader2 size={14} className="animate-spin" /> Поиск координат...</> : 'Добавить'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="py-20 text-center opacity-30 italic flex flex-col items-center gap-3">
            <Store size={48} />
            Поставщики не найдены
          </div>
        ) : (
          filtered.map((s) => {
            const heatLevel = Number.isFinite(Number(s.heatLevel)) ? Number(s.heatLevel) : (supplierHeatMap[s.name.trim().toLowerCase()] || 0);
            const Icon = s.type === 'scrapyard' ? Wrench : Gem;

            return (
              <div key={s.id} className="bg-white p-4 rounded-2xl shadow-sm space-y-4 border border-gray-100 active:bg-gray-50 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${s.type === 'scrapyard' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                      <Icon size={24} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-lg leading-tight truncate">{s.name}</h3>
                      <p className="text-xs text-gray-400 flex items-center gap-1 mt-1 truncate">
                        <MapPin size={12} className="shrink-0" /> {s.location || 'Локация не указана'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {s.location && (
                      <button type="button" onClick={() => openMap(s.location)} className="p-3 bg-red-50 text-red-600 rounded-xl active:bg-red-100 transition-colors" title="Карта">
                        <MapPin size={20} />
                      </button>
                    )}
                    <a href={`tel:${s.phone}`} className="p-3 bg-green-50 text-green-600 rounded-xl active:bg-green-100 transition-colors">
                      <Phone size={20} />
                    </a>
                    <button type="button" onClick={() => setDeleteSupplierId(s.id)} className="p-3 bg-gray-50 text-gray-300 hover:text-red-500 active:bg-red-50 rounded-xl transition-colors">
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center flex-wrap gap-2 text-[10px] font-black uppercase">
                  <span className={`rounded-full px-2 py-1 border inline-flex items-center gap-1 ${s.type === 'scrapyard' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}><Icon size={11} /> {s.type === 'scrapyard' ? 'Scrapyard' : 'New Parts'}</span>
                  {s.zone && <span className="rounded-full px-2 py-1 border border-violet-200 bg-violet-50 text-violet-700">Zone: {s.zone}</span>}
                  <span className="rounded-full px-2 py-1 border border-slate-200 bg-slate-50 text-slate-700">Активность: {heatLevel >= 6 ? 'высокая' : heatLevel >= 3 ? 'средняя' : 'низкая'}</span>
                </div>

                {(s.mainBrands || s.brands || []).length > 0 && (
                  <div className="pt-2 flex flex-wrap gap-1.5 border-t border-gray-50">
                    {(s.mainBrands || s.brands || []).map((b) => (
                      <span key={`brand-${s.id}-${b}`} className="bg-gray-50 text-gray-500 text-[9px] font-bold px-2 py-0.5 rounded-md uppercase border border-gray-100 flex items-center gap-1">
                        <Tag size={8} /> {b}
                      </span>
                    ))}
                  </div>
                )}

                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => setActiveOrderLinkShopId(activeOrderLinkShopId === s.id ? null : s.id)}
                    className="w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 inline-flex items-center justify-center gap-2"
                  >
                    <Link2 size={13} /> Add to Active Order
                  </button>
                  {activeOrderLinkShopId === s.id && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-2">
                      <select
                        className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold"
                        defaultValue=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          addSupplierToOrder(s.id, e.target.value);
                          e.currentTarget.value = '';
                        }}
                      >
                        <option value="">Выберите активный заказ...</option>
                        {activeOrders.map((order) => (
                          <option key={order.id} value={order.id}>{order.brand} {order.model} • {order.vin}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteSupplierId}
        message="Вы уверены, что хотите удалить этого поставщика?"
        onConfirm={confirmDeleteSupplier}
        onCancel={() => setDeleteSupplierId(null)}
      />

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
