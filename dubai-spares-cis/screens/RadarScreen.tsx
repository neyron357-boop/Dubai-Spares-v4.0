import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EyeOff, Loader2, MapPinned, MessageCircle, Navigation, PhoneCall, Radar, SlidersHorizontal } from 'lucide-react';
import { useStore } from '../store';
import { Order, RadarInteraction, Shop } from '../types';
import { buildRoutePlanMapLink, buildShopMapLink, getRadarShopMatches } from '../shopMatching';
import { fetchRadarShops } from '../radarShops';
import { toast } from '../feedback';
import { createUuid } from '../id';
import { offlineDb } from '../storage/offlineDb';

const RADAR_DISMISSED_SHOPS_KEY = 'radar_dismissed_shop_keys';
const RADAR_VISITED_SHOPS_KEY = 'radar_visited_shop_keys';
const RADIUS_STEPS = [2, 5, 10, 20] as const;
const PAGE_SIZE = 12;

type BrandMatchMode = 'strict' | 'soft';
type SortMode = 'matches' | 'value' | 'distance' | 'smart';

interface RadarSupplierMatch {
  order_id: string;
  part_id?: string;
  title: string;
  value_aed: number;
}

interface RadarSupplierAggregate {
  supplier_id: string;
  supplier_name: string;
  phone?: string | null;
  distance_km: number | null;
  eta_minutes: number | null;
  is_open_now: boolean | null;
  match_count: number;
  total_potential_value_aed: number;
  smart_score: number;
  matches_preview: RadarSupplierMatch[];
  matches_loaded: boolean;
  matches?: RadarSupplierMatch[];
  shop: Shop;
}

const readSet = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    return new Set<string>(Array.isArray(parsed) ? parsed.map((item) => String(item)) : []);
  } catch {
    return new Set<string>();
  }
};

const writeSet = (key: string, values: Set<string>) => {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(values)));
  } catch {
    // ignore
  }
};

const parseHourMinute = (value: string) => {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return (h * 60) + m;
};

const parseSlots = (raw: unknown): Array<{ start: number; end: number }> => {
  if (!raw) return [];
  if (typeof raw === 'string') {
    if (!raw.trim() || raw.toLowerCase() === 'closed') return [];
    return raw
      .split(',')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => chunk.split('-').map((part) => part.trim()))
      .map(([from, to]) => {
        const start = parseHourMinute(from || '');
        const end = parseHourMinute(to || '');
        return start !== null && end !== null ? { start, end } : null;
      })
      .filter((slot): slot is { start: number; end: number } => !!slot);
  }
  if (Array.isArray(raw)) return raw.flatMap((item) => parseSlots(item));
  if (typeof raw === 'object') {
    const entry = raw as { open?: unknown; close?: unknown; from?: unknown; to?: unknown };
    const from = typeof entry.open === 'string' ? entry.open : typeof entry.from === 'string' ? entry.from : '';
    const to = typeof entry.close === 'string' ? entry.close : typeof entry.to === 'string' ? entry.to : '';
    const start = parseHourMinute(from);
    const end = parseHourMinute(to);
    return start !== null && end !== null ? [{ start, end }] : [];
  }
  return [];
};

const getOpenState = (shop: Shop): boolean | null => {
  if (!shop.businessHours) return null;
  const now = new Date();
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const day = dayKeys[now.getDay()];
  const minutes = (now.getHours() * 60) + now.getMinutes();
  const schedule = (shop.businessHours as Record<string, unknown>)[day];
  const slots = parseSlots(schedule);
  if (slots.length === 0) return null;
  return slots.some(({ start, end }) => end >= start ? minutes >= start && minutes <= end : minutes >= start || minutes <= end);
};

const getPartValue = (order: Order, partId?: string) => {
  const part = partId ? order.parts.find((item) => item.id === partId) : order.parts[0];
  if (!part) return 0;
  const variantPrices = part.variants.map((variant) => Number(variant.priceAed)).filter((price) => Number.isFinite(price) && price > 0);
  if (variantPrices.length > 0) return Math.round(Math.max(...variantPrices));
  return 0;
};

const getPrimaryPartName = (order: Order) => order.parts[0]?.name || 'part';

const buildWhatsappLink = (phoneRaw: string, text: string) => {
  const digits = phoneRaw.replace(/[^\d+]/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits.replace('+', '')}?text=${encodeURIComponent(text)}`;
};

const RadarScreen: React.FC = () => {
  const { orders, suppliers } = useStore();
  const [shops, setShops] = useState<Shop[]>([]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [isFetchingShops, setIsFetchingShops] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<RadarInteraction[]>([]);

  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [brandMatchMode, setBrandMatchMode] = useState<BrandMatchMode>('soft');
  const [minMatchCount, setMinMatchCount] = useState(0);
  const [minPotentialValue, setMinPotentialValue] = useState(0);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(0);
  const [sortMode, setSortMode] = useState<SortMode>('matches');
  const [showFilters, setShowFilters] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dismissedShopIds, setDismissedShopIds] = useState<Set<string>>(() => readSet(RADAR_DISMISSED_SHOPS_KEY));
  const [visitedShopIds, setVisitedShopIds] = useState<Set<string>>(() => readSet(RADAR_VISITED_SHOPS_KEY));
  const [selectedShopIds, setSelectedShopIds] = useState<Set<string>>(new Set());
  const [expandedShopIds, setExpandedShopIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const cacheRef = useRef<Map<string, RadarSupplierAggregate[]>>(new Map());
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { void offlineDb.getRadarInteractions().then(setInteractions); }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsFetchingShops(true);
      try {
        const loadedShops = await fetchRadarShops(suppliers);
        if (!active) return;
        setShops(loadedShops);
        setSyncError(null);
        cacheRef.current.clear();
      } catch (error) {
        if (!active) return;
        setSyncError(error instanceof Error ? error.message : 'Failed to load shops');
      } finally {
        if (active) setIsFetchingShops(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [suppliers]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    }, () => undefined, { enableHighAccuracy: false, maximumAge: 8000, timeout: 10000 });
  }, []);

  const addInteraction = async (payload: Omit<RadarInteraction, 'id' | 'createdAt'>) => {
    const interaction: RadarInteraction = { ...payload, id: createUuid(), createdAt: Date.now() };
    await offlineDb.addRadarInteraction(interaction);
    setInteractions((prev) => [interaction, ...prev]);
  };

  const cacheKey = useMemo(() => JSON.stringify({
    radiusKm,
    openNowOnly,
    brandMatchMode,
    minMatchCount,
    minPotentialValue,
    maxDistanceKm,
    searchQuery,
    sortMode,
    position,
    shopsVersion: shops.map((s) => s.id).join(','),
    ordersVersion: orders.map((o) => `${o.id}:${o.updatedAt || o.createdAt}`).join(',')
  }), [radiusKm, openNowOnly, brandMatchMode, minMatchCount, minPotentialValue, maxDistanceKm, searchQuery, sortMode, position, shops, orders]);

  const suppliersAggregated = useMemo<RadarSupplierAggregate[]>(() => {
    const cached = cacheRef.current.get(cacheKey);
    if (cached) return cached;

    const grouped = new Map<string, RadarSupplierAggregate>();
    const activeOrders = orders.filter((order) => !order.isArchived && !order.isSold);

    activeOrders.forEach((order) => {
      getRadarShopMatches(order, shops, position)
        .filter((match) => brandMatchMode === 'soft' || match.matchScore >= 0)
        .forEach((match) => {
          const distanceKm = Number.isFinite(match.distance) ? Number((match.distance! / 1000).toFixed(1)) : null;
          if (distanceKm !== null && distanceKm > radiusKm) return;
          if (maxDistanceKm > 0 && distanceKm !== null && distanceKm > maxDistanceKm) return;
          if (dismissedShopIds.has(match.shop.id) || visitedShopIds.has(match.shop.id)) return;

          const partName = getPrimaryPartName(order);
          const value = getPartValue(order, order.parts[0]?.id);
          const matchRow: RadarSupplierMatch = {
            order_id: order.id,
            part_id: order.parts[0]?.id,
            title: `${order.brand} ${order.model} — ${partName}`,
            value_aed: value
          };

          const current = grouped.get(match.shop.id);
          if (!current) {
            grouped.set(match.shop.id, {
              supplier_id: match.shop.id,
              supplier_name: match.shop.name,
              phone: match.shop.phone,
              distance_km: distanceKm,
              eta_minutes: distanceKm === null ? null : Math.max(3, Math.round((distanceKm * 1000) / 230)),
              is_open_now: getOpenState(match.shop),
              match_count: 1,
              total_potential_value_aed: value,
              smart_score: 0,
              matches_preview: [matchRow],
              matches_loaded: false,
              matches: [matchRow],
              shop: match.shop
            });
            return;
          }

          current.match_count += 1;
          current.total_potential_value_aed += value;
          current.matches = [...(current.matches || []), matchRow];
          current.matches_preview = current.matches.slice(0, 3);
          if (current.distance_km === null && distanceKm !== null) current.distance_km = distanceKm;
          if (current.eta_minutes === null && distanceKm !== null) current.eta_minutes = Math.max(3, Math.round((distanceKm * 1000) / 230));
        });
    });

    const filtered = Array.from(grouped.values())
      .map((item) => {
        const smartScore = Math.round((item.match_count * 3) + (item.total_potential_value_aed / 500) - ((item.distance_km ?? 0) / 2));
        return {
          ...item,
          smart_score: smartScore,
          matches_preview: (item.matches || []).slice(0, 3),
          matches_loaded: expandedShopIds.has(item.supplier_id)
        };
      })
      .filter((item) => !openNowOnly || item.is_open_now === true)
      .filter((item) => item.match_count >= minMatchCount)
      .filter((item) => item.total_potential_value_aed >= minPotentialValue)
      .filter((item) => {
        if (!searchQuery) return true;
        const haystack = [item.supplier_name, item.shop.zone || '', ...(item.matches || []).map((m) => m.title)].join(' ').toLowerCase();
        return haystack.includes(searchQuery);
      })
      .sort((a, b) => {
        if (sortMode === 'value') return (b.total_potential_value_aed - a.total_potential_value_aed) || (a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY);
        if (sortMode === 'distance') return ((a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY)) || (b.match_count - a.match_count);
        if (sortMode === 'smart') return (b.smart_score - a.smart_score) || (b.match_count - a.match_count);
        return (b.match_count - a.match_count)
          || ((a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY))
          || (b.smart_score - a.smart_score);
      });

    cacheRef.current.set(cacheKey, filtered);
    return filtered;
  }, [orders, shops, position, brandMatchMode, radiusKm, maxDistanceKm, dismissedShopIds, visitedShopIds, openNowOnly, minMatchCount, minPotentialValue, searchQuery, sortMode, expandedShopIds, cacheKey]);

  useEffect(() => {
    setPage(1);
  }, [suppliersAggregated.length, searchQuery, sortMode, radiusKm, openNowOnly, minMatchCount, minPotentialValue, maxDistanceKm]);

  const visibleSuppliers = suppliersAggregated.slice(0, page * PAGE_SIZE);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      setPage((prev) => (prev * PAGE_SIZE >= suppliersAggregated.length ? prev : prev + 1));
    }, { rootMargin: '200px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [suppliersAggregated.length]);

  const offlineCount = interactions.filter((item) => !item.syncedAt).length;
  const activeFiltersCount = [openNowOnly, minMatchCount > 0, minPotentialValue > 0, brandMatchMode === 'strict', maxDistanceKm > 0].filter(Boolean).length;
  const matchesTotal = suppliersAggregated.reduce((sum, supplier) => sum + supplier.match_count, 0);

  const toggleSelect = (supplierId: string) => {
    setSelectedShopIds((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) next.delete(supplierId);
      else next.add(supplierId);
      return next;
    });
  };

  const toggleExpand = (supplierId: string) => {
    setExpandedShopIds((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) next.delete(supplierId);
      else next.add(supplierId);
      return next;
    });
  };

  const openRoute = async (supplier: RadarSupplierAggregate) => {
    const shop = supplier.shop;
    if (shop.latitude && shop.longitude) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${shop.latitude},${shop.longitude}`, '_blank');
    } else {
      window.open(buildShopMapLink(shop), '_blank');
    }
    await addInteraction({ shopId: shop.id, orderId: supplier.matches?.[0]?.order_id || 'unknown', partId: supplier.matches?.[0]?.part_id, result: 'route_opened', comment: 'Route opened from supplier card' });
  };

  const openWhatsApp = async (supplier: RadarSupplierAggregate) => {
    const phone = supplier.phone || '';
    const firstMatch = supplier.matches?.[0];
    const message = `Hi! Need parts for ${firstMatch?.title || supplier.supplier_name}. Please share availability and price.`;
    const link = buildWhatsappLink(phone, message);
    if (!link) return toast('No WhatsApp phone', 'error');
    window.open(link, '_blank');
    await addInteraction({ shopId: supplier.supplier_id, orderId: firstMatch?.order_id || 'unknown', partId: firstMatch?.part_id, result: 'message_sent', comment: 'WhatsApp opened from supplier card' });
  };

  const openCall = async (supplier: RadarSupplierAggregate) => {
    if (!supplier.phone) return;
    window.open(`tel:${supplier.phone}`, '_self');
    await addInteraction({ shopId: supplier.supplier_id, orderId: supplier.matches?.[0]?.order_id || 'unknown', partId: supplier.matches?.[0]?.part_id, result: 'called', comment: 'Call opened from supplier card' });
  };

  const hideSupplier = async (supplier: RadarSupplierAggregate) => {
    setDismissedShopIds((prev) => {
      const next = new Set(prev);
      next.add(supplier.supplier_id);
      writeSet(RADAR_DISMISSED_SHOPS_KEY, next);
      return next;
    });
    await addInteraction({ shopId: supplier.supplier_id, orderId: supplier.matches?.[0]?.order_id || 'unknown', result: 'hidden', comment: 'Point hidden from radar aggregated mode' });
  };

  const markVisited = async (supplier: RadarSupplierAggregate) => {
    setVisitedShopIds((prev) => {
      const next = new Set(prev);
      next.add(supplier.supplier_id);
      writeSet(RADAR_VISITED_SHOPS_KEY, next);
      return next;
    });
    await addInteraction({ shopId: supplier.supplier_id, orderId: supplier.matches?.[0]?.order_id || 'unknown', result: 'visited', comment: 'Supplier marked as visited' });
  };

  const buildSelectedRoute = async () => {
    const selected = suppliersAggregated.filter((supplier) => selectedShopIds.has(supplier.supplier_id)).map((supplier) => supplier.shop);
    if (selected.length === 0) return;
    window.open(buildRoutePlanMapLink(selected, position), '_blank');

    for (const supplier of suppliersAggregated.filter((item) => selectedShopIds.has(item.supplier_id))) {
      await addInteraction({ shopId: supplier.supplier_id, orderId: supplier.matches?.[0]?.order_id || 'unknown', result: 'route_opened', comment: 'Build route action for selected suppliers' });
    }
  };

  return (
    <div className="bg-slate-100 min-h-full pb-28">
      <section className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 h-[56px]">
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search supplier / brand / zone" className="h-10 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none" />
          <select value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))} className="h-10 rounded-xl border border-slate-300 bg-white px-2 text-sm">
            {RADIUS_STEPS.map((step) => <option key={step} value={step}>{step} km</option>)}
          </select>
          <button type="button" onClick={() => setShowFilters((v) => !v)} className="relative h-10 rounded-xl border border-slate-300 px-3 text-sm inline-flex items-center gap-1"><SlidersHorizontal size={16} />Filters{activeFiltersCount > 0 && <span className="absolute -top-1 -right-1 rounded-full bg-emerald-600 text-white text-[10px] px-1">{activeFiltersCount}</span>}</button>
          <button type="button" className="h-10 w-10 rounded-xl border border-slate-300 inline-flex items-center justify-center" title="Offline sync queue">
            {isFetchingShops ? <Loader2 size={16} className="animate-spin text-slate-500" /> : <span className={`h-2.5 w-2.5 rounded-full ${offlineCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />}
          </button>
        </div>
        <p className="text-sm text-slate-600">{suppliersAggregated.length} suppliers • {matchesTotal} matches • {offlineCount} offline</p>
      </section>

      {showFilters && (
        <section className="fixed bottom-0 left-0 right-0 z-30 rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="flex items-center justify-between gap-2 border rounded-xl p-2">Open now<input type="checkbox" checked={openNowOnly} onChange={(event) => setOpenNowOnly(event.target.checked)} /></label>
            <label className="border rounded-xl p-2">Min matches<input type="number" min={0} value={minMatchCount} onChange={(event) => setMinMatchCount(Number(event.target.value) || 0)} className="mt-1 w-full border rounded-lg px-2 py-1" /></label>
            <label className="border rounded-xl p-2">Min value (AED)<input type="number" min={0} value={minPotentialValue} onChange={(event) => setMinPotentialValue(Number(event.target.value) || 0)} className="mt-1 w-full border rounded-lg px-2 py-1" /></label>
            <label className="border rounded-xl p-2">Max distance (km)<input type="number" min={0} value={maxDistanceKm} onChange={(event) => setMaxDistanceKm(Number(event.target.value) || 0)} className="mt-1 w-full border rounded-lg px-2 py-1" /></label>
            <label className="border rounded-xl p-2">Brand strictness<select value={brandMatchMode} onChange={(event) => setBrandMatchMode(event.target.value as BrandMatchMode)} className="mt-1 w-full border rounded-lg px-2 py-1"><option value="strict">Strict</option><option value="soft">Soft</option></select></label>
            <label className="border rounded-xl p-2">Sort<select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="mt-1 w-full border rounded-lg px-2 py-1"><option value="matches">By matches</option><option value="value">By value</option><option value="distance">By distance</option><option value="smart">Smart</option></select></label>
          </div>
          <button type="button" onClick={() => setShowFilters(false)} className="w-full h-11 rounded-xl bg-slate-900 text-white">Apply</button>
        </section>
      )}

      <main className="p-4 space-y-3">
        {syncError && <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{syncError}</div>}

        {isFetchingShops && Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-4 animate-pulse space-y-2">
            <div className="h-5 bg-slate-200 rounded w-2/3" />
            <div className="h-4 bg-slate-200 rounded w-1/3" />
            <div className="h-10 bg-slate-200 rounded" />
          </div>
        ))}

        {!isFetchingShops && suppliersAggregated.length === 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-3">
            <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 inline-flex items-center justify-center"><Radar size={20} /></div>
            <p className="text-slate-700">No suppliers found within selected radius</p>
            <button type="button" onClick={() => {
              const idx = RADIUS_STEPS.findIndex((step) => step === radiusKm);
              setRadiusKm(RADIUS_STEPS[Math.min(idx + 1, RADIUS_STEPS.length - 1)]);
            }} className="h-10 px-4 rounded-xl bg-emerald-600 text-white">Increase radius</button>
          </section>
        )}

        {visibleSuppliers.map((supplier) => {
          const expanded = expandedShopIds.has(supplier.supplier_id);
          return (
            <article key={supplier.supplier_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <label className="text-xs text-slate-500 inline-flex items-center gap-1 mb-1"><input type="checkbox" checked={selectedShopIds.has(supplier.supplier_id)} onChange={() => toggleSelect(supplier.supplier_id)} />Select</label>
                  <h3 className="text-lg font-semibold text-slate-900">{supplier.supplier_name}</h3>
                  <p className="text-sm text-slate-500">{supplier.match_count} matches</p>
                </div>
                <div className="text-right text-sm text-slate-600">
                  <p>{supplier.distance_km === null ? '—' : `${supplier.distance_km.toFixed(1)} km`}</p>
                  <p>{supplier.eta_minutes === null ? '—' : `~${supplier.eta_minutes} min`}</p>
                  <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs">{supplier.is_open_now === null ? '—' : supplier.is_open_now ? 'Open' : 'Closed'}</span>
                </div>
              </div>

              <div className="mt-2">
                <p className="text-xl font-semibold text-emerald-700">Potential value: {supplier.total_potential_value_aed.toLocaleString()} AED</p>
                <p className="text-sm text-slate-500">Score {supplier.smart_score}</p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void openRoute(supplier)} className="h-10 flex-1 min-w-[150px] rounded-xl bg-emerald-600 text-white inline-flex items-center justify-center gap-1"><Navigation size={14} />Route</button>
                <button type="button" onClick={() => void openWhatsApp(supplier)} className="h-10 rounded-xl border border-slate-300 px-3 inline-flex items-center gap-1"><MessageCircle size={14} />WhatsApp</button>
                <button type="button" onClick={() => void openCall(supplier)} className="h-10 rounded-xl border border-slate-300 px-3 inline-flex items-center gap-1"><PhoneCall size={14} />Call</button>
                <button type="button" onClick={() => void hideSupplier(supplier)} className="h-10 rounded-xl border border-slate-300 px-3 inline-flex items-center gap-1"><EyeOff size={14} />Hide</button>
                <button type="button" onClick={() => void markVisited(supplier)} className="h-10 rounded-xl border border-slate-300 px-3 inline-flex items-center gap-1"><MapPinned size={14} />Я у магазина</button>
              </div>

              <button type="button" onClick={() => toggleExpand(supplier.supplier_id)} className="mt-3 text-sm text-slate-600">{expanded ? '▲ Hide matches' : '▼ Show matches'}</button>

              <div className={`overflow-hidden transition-all duration-200 ease-in-out ${expanded ? 'max-h-72 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                {(supplier.matches || []).map((match) => <p key={`${supplier.supplier_id}-${match.order_id}-${match.part_id || 'x'}`} className="text-sm text-slate-700">• {match.title} — {match.value_aed.toLocaleString()} AED</p>)}
              </div>
            </article>
          );
        })}

        <div ref={loadMoreRef} />
      </main>

      {selectedShopIds.size > 0 && (
        <section className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-slate-700">{selectedShopIds.size} suppliers selected</p>
          <button type="button" onClick={() => void buildSelectedRoute()} className="h-10 px-4 rounded-xl bg-slate-900 text-white">Build route</button>
        </section>
      )}
    </div>
  );
};

export default RadarScreen;
