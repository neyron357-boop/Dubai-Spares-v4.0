import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, Filter, Loader2, MapPinned, MessageCircle, Navigation, PhoneCall, Radar, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { useStore } from '../store';
import { Order, Shop } from '../types';
import { getRadarShopMatches, buildRoutePlanMapLink } from '../shopMatching';
import { fetchRadarShops } from '../radarShops';
import { toast } from '../feedback';

type SortMode = 'matches' | 'profit' | 'distance' | 'smart';

type SupplierOrderMatch = {
  orderId: string;
  orderLabel: string;
  partLabel: string;
  potentialProfit: number;
};

type SupplierAggregate = {
  supplier_id: string;
  supplier_name: string;
  supplier: Shop;
  distance_km: number | null;
  eta_minutes: number | null;
  match_count: number;
  total_potential_profit: number;
  score: number;
  is_open_now: boolean | null;
  orders: SupplierOrderMatch[];
};

const RADIUS_STEPS = [5, 10, 20, 40];

const hasValidCoordinates = (latitude: number, longitude: number) => Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0;

const parseHourMinute = (value: string) => {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return (hours * 60) + minutes;
};

const parseSlotPair = (raw: unknown): Array<{ start: number; end: number }> => {
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
  if (Array.isArray(raw)) return raw.flatMap((item) => parseSlotPair(item));
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
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayKey = dayKeys[now.getDay()];
  const minutes = (now.getHours() * 60) + now.getMinutes();
  const daySchedule = (shop.businessHours as Record<string, unknown>)[dayKey];
  const slots = parseSlotPair(daySchedule);
  if (slots.length === 0) return null;
  return slots.some((slot) => slot.end < slot.start ? minutes >= slot.start || minutes <= slot.end : minutes >= slot.start && minutes <= slot.end);
};

const getPotentialProfit = (order: Order) => {
  const variantPrices = order.parts.flatMap((part) => part.variants.map((variant) => Number(variant.priceAed) || 0));
  const avg = variantPrices.length > 0 ? variantPrices.reduce((sum, value) => sum + value, 0) / variantPrices.length : 800;
  const markup = Math.max(8, Number(order.markupPercent) || 20);
  return Math.round((avg * markup) / 100);
};

const buildWhatsappLink = (phone: string | undefined, text: string) => {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
};

const RadarScreen: React.FC = () => {
  const { orders, suppliers } = useStore();
  const [shops, setShops] = useState<Shop[]>([]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [radiusKm, setRadiusKm] = useState(5);
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [minMatches, setMinMatches] = useState(1);
  const [minProfit, setMinProfit] = useState(0);
  const [maxDistance, setMaxDistance] = useState(40);
  const [brandStrictness, setBrandStrictness] = useState<'soft' | 'strict'>('soft');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('matches');
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(12);
  const [showFilters, setShowFilters] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const cacheRef = useRef(new Map<string, SupplierAggregate[]>());

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchRadarShops(suppliers)
      .then((items) => {
        if (!active) return;
        setShops(items);
      })
      .catch((error) => toast(error instanceof Error ? error.message : 'Radar sync error', 'error'))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [suppliers]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((geo) => setPosition({ lat: geo.coords.latitude, lng: geo.coords.longitude }), () => undefined);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((count) => count + 8);
      }
    }, { rootMargin: '280px' });
    if (bottomRef.current) observer.observe(bottomRef.current);
    return () => observer.disconnect();
  }, []);

  const activeOrders = useMemo(() => orders.filter((order) => !order.isArchived && !order.isSold), [orders]);

  const aggregated = useMemo(() => {
    const cacheKey = JSON.stringify({
      orderIds: activeOrders.map((item) => item.id),
      shopIds: shops.map((item) => item.id),
      position,
      radiusKm,
      openNowOnly,
      minMatches,
      minProfit,
      maxDistance,
      brandStrictness,
      query: debouncedQuery,
      sortMode
    });
    const cached = cacheRef.current.get(cacheKey);
    if (cached) return cached;

    const grouped = new Map<string, SupplierAggregate>();

    activeOrders.forEach((order) => {
      const matches = getRadarShopMatches(order, shops, position)
        .filter((item) => brandStrictness === 'soft' || item.matchScore >= 9)
        .filter((item) => item.distance === null || (item.distance / 1000) <= Math.min(radiusKm, maxDistance));

      matches.forEach((item) => {
        const distanceKm = item.distance === null ? null : item.distance / 1000;
        const existing = grouped.get(item.shop.id);
        const profit = getPotentialProfit(order);
        const partName = order.parts[0]?.name || 'Part';
        const match: SupplierOrderMatch = {
          orderId: order.id,
          orderLabel: `${order.brand} ${order.model}`,
          partLabel: partName,
          potentialProfit: profit
        };

        if (!existing) {
          grouped.set(item.shop.id, {
            supplier_id: item.shop.id,
            supplier_name: item.shop.name,
            supplier: item.shop,
            distance_km: distanceKm,
            eta_minutes: distanceKm === null ? null : Math.max(4, Math.round(distanceKm * 4.2)),
            match_count: 1,
            total_potential_profit: profit,
            score: Math.max(0, Math.round(item.radarScore * 6)),
            is_open_now: getOpenState(item.shop),
            orders: [match]
          });
          return;
        }

        existing.match_count += 1;
        existing.total_potential_profit += profit;
        existing.distance_km = existing.distance_km === null ? distanceKm : (distanceKm === null ? existing.distance_km : Math.min(existing.distance_km, distanceKm));
        existing.eta_minutes = existing.distance_km === null ? null : Math.max(4, Math.round(existing.distance_km * 4.2));
        existing.score = Math.round((existing.score + (item.radarScore * 6)) / 2);
        existing.orders.push(match);
      });
    });

    const q = debouncedQuery.trim().toLowerCase();
    const rows = Array.from(grouped.values())
      .map((item) => ({ ...item, orders: item.orders.slice(0, 12) }))
      .filter((item) => !openNowOnly || item.is_open_now === true)
      .filter((item) => item.match_count >= minMatches)
      .filter((item) => item.total_potential_profit >= minProfit)
      .filter((item) => q.length === 0 || [item.supplier_name, item.supplier.location || '', ...item.orders.map((order) => order.orderLabel)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => {
        if (sortMode === 'profit') return b.total_potential_profit - a.total_potential_profit;
        if (sortMode === 'distance') return (a.distance_km ?? 9999) - (b.distance_km ?? 9999);
        if (sortMode === 'smart') {
          const smartA = (a.match_count * 3) + (a.total_potential_profit / 500) + (a.score / 20) - ((a.distance_km ?? 30) / 2);
          const smartB = (b.match_count * 3) + (b.total_potential_profit / 500) + (b.score / 20) - ((b.distance_km ?? 30) / 2);
          return smartB - smartA;
        }
        return (b.match_count - a.match_count) || ((a.distance_km ?? 9999) - (b.distance_km ?? 9999)) || (b.score - a.score);
      });

    cacheRef.current.set(cacheKey, rows);
    return rows;
  }, [activeOrders, shops, position, radiusKm, openNowOnly, minMatches, minProfit, maxDistance, brandStrictness, debouncedQuery, sortMode]);

  const visibleSuppliers = aggregated.slice(0, visibleCount);
  const offlineCount = shops.filter((shop) => getOpenState(shop) === false).length;

  const toggleExpanded = (supplierId: string) => {
    setExpandedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) next.delete(supplierId);
      else next.add(supplierId);
      return next;
    });
  };

  const toggleSelected = (supplierId: string) => {
    setSelectedSupplierIds((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) next.delete(supplierId);
      else next.add(supplierId);
      return next;
    });
  };

  const openRoute = (supplier: Shop) => {
    if (hasValidCoordinates(supplier.latitude, supplier.longitude)) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${supplier.latitude},${supplier.longitude}`, '_blank');
      return;
    }
    window.open('https://www.google.com/maps', '_blank');
  };

  const buildRoute = () => {
    const selected = aggregated.filter((item) => selectedSupplierIds.has(item.supplier_id)).map((item) => item.supplier);
    if (selected.length === 0) return;
    window.open(buildRoutePlanMapLink(selected, position), '_blank');
  };

  const activeFiltersCount = [openNowOnly, minMatches > 1, minProfit > 0, maxDistance < 40, brandStrictness === 'strict'].filter(Boolean).length;

  return (
    <div className="min-h-full bg-slate-100 px-3 pb-24 pt-3 text-slate-900">
      <section className="sticky top-0 z-20 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search supplier / brand / area" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-sm outline-none" />
          </div>
          <select value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium">
            {RADIUS_STEPS.map((item) => <option key={item} value={item}>{item} km</option>)}
          </select>
          <button type="button" onClick={() => setShowFilters(true)} className="relative inline-flex h-9 items-center rounded-lg border border-slate-200 px-2 text-xs font-medium">
            <Filter className="mr-1 h-4 w-4" />
            Filters
            {activeFiltersCount > 0 && <span className="ml-1 rounded-full bg-slate-900 px-1.5 text-[10px] text-white">{activeFiltersCount}</span>}
          </button>
          <button type="button" onClick={() => window.location.reload()} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </section>

      <p className="px-1 py-2 text-xs text-slate-500">{aggregated.length} suppliers • {aggregated.reduce((sum, item) => sum + item.match_count, 0)} matches • {offlineCount} offline</p>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 h-4 w-1/3 rounded bg-slate-200" />
              <div className="mb-2 h-3 w-2/3 rounded bg-slate-200" />
              <div className="h-9 rounded bg-slate-200" />
            </div>
          ))}
        </div>
      ) : visibleSuppliers.length === 0 ? (
        <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <Radar className="mx-auto mb-3 h-7 w-7 text-slate-400" />
          <p className="text-sm text-slate-700">No suppliers found within selected radius</p>
          <button type="button" onClick={() => setRadiusKm((value) => Math.min(40, value + 5))} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">Increase radius</button>
        </section>
      ) : (
        <section className="space-y-3">
          {visibleSuppliers.map((item) => {
            const expanded = expandedSuppliers.has(item.supplier_id);
            const selected = selectedSupplierIds.has(item.supplier_id);
            return (
              <article key={item.supplier_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-[19px] font-semibold leading-5 text-slate-900">{item.supplier_name}</h2>
                    <p className="mt-1 text-sm font-medium text-slate-600">{item.match_count} matches</p>
                  </div>
                  <div className="text-right text-sm text-slate-600">
                    <p>{item.distance_km === null ? 'n/a' : `${item.distance_km.toFixed(1)} km`}</p>
                    <p className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />~{item.eta_minutes ?? '?'} min</p>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${item.is_open_now === true ? 'bg-emerald-100 text-emerald-700' : item.is_open_now === false ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{item.is_open_now === true ? 'Open' : item.is_open_now === false ? 'Closed' : 'Hours n/a'}</span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <p className="text-base font-bold text-slate-900">Potential value: {item.total_potential_profit.toLocaleString()} AED</p>
                  <p className="text-xs text-slate-500">Score {item.score}</p>
                </div>

                <div className="mt-3 space-y-2">
                  <button type="button" onClick={() => openRoute(item.supplier)} className="inline-flex h-10 w-full items-center justify-center gap-1 rounded-xl bg-slate-900 text-sm font-semibold text-white"><Navigation className="h-4 w-4" />Маршрут</button>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => {
                      const link = buildWhatsappLink(item.supplier.phone, `Hi! Need parts for ${item.orders[0]?.orderLabel || 'vehicle'}.`);
                      if (!link) return;
                      window.open(link, '_blank');
                    }} className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-xl border border-slate-200 text-sm"><MessageCircle className="h-4 w-4" />WhatsApp</button>
                    <button type="button" onClick={() => item.supplier.phone && window.open(`tel:${item.supplier.phone}`, '_self')} className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-xl border border-slate-200 text-sm"><PhoneCall className="h-4 w-4" />Call</button>
                    <button type="button" onClick={() => toggleSelected(item.supplier_id)} className={`inline-flex h-9 items-center justify-center rounded-xl border px-3 text-xs ${selected ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600'}`}>{selected ? 'Selected' : 'Select'}</button>
                  </div>
                </div>

                <button type="button" onClick={() => toggleExpanded(item.supplier_id)} className="mt-3 inline-flex items-center gap-1 text-sm text-slate-600">
                  <SlidersHorizontal className="h-4 w-4" /> {expanded ? 'Hide matches' : 'Show matches'}
                </button>

                <div className={`overflow-hidden transition-all duration-200 ease-in ${expanded ? 'max-h-[420px] opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                  <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                    {expanded ? item.orders.map((order) => (
                      <p key={`${item.supplier_id}-${order.orderId}-${order.partLabel}`}>• {order.orderLabel} — {order.partLabel} — {order.potentialProfit} AED</p>
                    )) : null}
                  </div>
                </div>
              </article>
            );
          })}
          <div ref={bottomRef} className="flex justify-center py-2 text-xs text-slate-400">{visibleSuppliers.length < aggregated.length ? <Loader2 className="h-4 w-4 animate-spin" /> : 'End of list'}</div>
        </section>
      )}

      {selectedSupplierIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white p-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)]">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
            <p className="text-sm text-slate-700">{selectedSupplierIds.size} suppliers selected</p>
            <button type="button" onClick={buildRoute} className="inline-flex h-10 items-center gap-1 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"><MapPinned className="h-4 w-4" />Build route</button>
          </div>
        </div>
      )}

      {showFilters && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowFilters(false)}>
          <div className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white p-4" onClick={(event) => event.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold">Filters</h3>
            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between"><span>Open now</span><input type="checkbox" checked={openNowOnly} onChange={(event) => setOpenNowOnly(event.target.checked)} /></label>
              <label className="block">Min match count
                <input type="number" min={1} value={minMatches} onChange={(event) => setMinMatches(Math.max(1, Number(event.target.value) || 1))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2" />
              </label>
              <label className="block">Min potential profit (AED)
                <input type="number" min={0} value={minProfit} onChange={(event) => setMinProfit(Math.max(0, Number(event.target.value) || 0))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2" />
              </label>
              <label className="block">Max distance (km)
                <input type="number" min={1} max={40} value={maxDistance} onChange={(event) => setMaxDistance(Math.max(1, Math.min(40, Number(event.target.value) || 40)))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2" />
              </label>
              <label className="block">Brand strictness
                <select value={brandStrictness} onChange={(event) => setBrandStrictness(event.target.value as 'soft' | 'strict')} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2">
                  <option value="soft">Soft</option>
                  <option value="strict">Strict</option>
                </select>
              </label>
              <label className="block">Sort mode
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2">
                  <option value="matches">By matches</option>
                  <option value="profit">By profit</option>
                  <option value="distance">By distance</option>
                  <option value="smart">Smart</option>
                </select>
              </label>
              <button type="button" onClick={() => setShowFilters(false)} className="h-10 w-full rounded-xl bg-slate-900 text-white">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RadarScreen;
