import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocateFixed, Radar, Navigation, ShieldCheck, Telescope } from 'lucide-react';
import { useStore } from '../store';
import { Shop } from '../types';
import { buildNearestShopsChain, buildRoutePlanMapLink, buildShopMapLink, getRadarShopMatches, getShopRecommendationLevel } from '../shopMatching';
import { supabase } from '../supabase';
import { fetchRadarShops } from '../radarShops';
import { toast } from '../feedback';

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 8000,
  timeout: 15000
};

const RadarScreen: React.FC = () => {
  const { orders, suppliers } = useStore();
  const navigate = useNavigate();
  const [shops, setShops] = useState<Shop[]>([]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [isFetchingShops, setIsFetchingShops] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsFetchingShops(true);
      const loadedShops = await fetchRadarShops(suppliers);
      if (!active) return;
      setShops(loadedShops);
      setIsFetchingShops(false);
    };

    const scheduleRefresh = () => {
      void load();
    };

    const shopsChannel = supabase
      ?.channel('radar-live-shops')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shops' }, scheduleRefresh)
      .subscribe();

    void load();
    return () => {
      active = false;
      if (shopsChannel) {
        void supabase?.removeChannel(shopsChannel);
      }
    };
  }, [suppliers]);

  useEffect(() => {
    if (!navigator.geolocation) {
      toast('Геолокация не поддерживается: радар покажет рейтинг без дистанции', 'error');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        // silently keep fallback mode
      },
      GEO_OPTIONS
    );

    const id = navigator.geolocation.watchPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => toast('GPS отключен — радар работает в fallback режиме', 'error'),
      GEO_OPTIONS
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const entries = useMemo(() => {
    const activeOrders = orders.filter((o) => !o.isArchived && !o.isSold);
    return activeOrders.flatMap((order) => {
      const ranked = getRadarShopMatches(order, shops, position);
      const withOrderContext = ranked.map((entry) => ({ ...entry, order }));

      const matched = withOrderContext.filter((entry) => entry.isRecommended || entry.isCompatible || entry.matchScore >= 2);
      if (matched.length > 0) return matched.slice(0, 8);

      return withOrderContext
        .filter((entry) => Number.isFinite(entry.distance))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);
    })
      .sort((a, b) => a.distance - b.distance);
  }, [orders, shops, position]);

  const routeChain = useMemo(() => {
    const uniqueShops = Array.from(new Map(entries.map((entry) => [entry.shop.id, entry.shop])).values());
    return buildNearestShopsChain(uniqueShops, position).slice(0, 8);
  }, [entries, position]);

  const openPlannedRoute = () => {
    const routeLink = buildRoutePlanMapLink(routeChain, position);
    window.open(routeLink, '_blank');
  };

  return (
    <div className="p-4 pb-20 space-y-3 bg-slate-950 min-h-full text-white">
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3">
        <div className="flex items-center gap-2 text-emerald-300"><Radar size={18} className="animate-pulse" /><span className="text-sm font-black uppercase tracking-wider">Radar Live</span></div>
        <p className="mt-1 text-xs text-emerald-100/80">Полевой режим: сначала рекомендуемые и совместимые магазины, затем ближайшие резервные точки.</p>
        <div className="mt-2">
          <button type="button" onClick={openPlannedRoute} className="inline-flex items-center gap-1 rounded-xl bg-emerald-400 px-3 py-2 text-[11px] font-black uppercase text-slate-950">
            <Navigation size={12} /> План маршрута по магазинам
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 px-2 py-1 text-emerald-200"><ShieldCheck size={11} /> high confidence</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 px-2 py-1 text-amber-200"><Telescope size={11} /> fallback nearby</span>
        </div>
      </div>
      {isFetchingShops ? (
        Array.from({ length: 3 }).map((_, idx) => (
          <div key={`radar-skeleton-${idx}`} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 space-y-2 animate-pulse">
            <div className="h-4 w-28 rounded bg-slate-700" />
            <div className="h-3 w-44 rounded bg-slate-800" />
            <div className="h-8 w-full rounded-xl bg-slate-800" />
          </div>
        ))
      ) : entries.length === 0 ? <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center text-xs text-slate-400">Активных заявок или магазинов пока нет. Добавьте магазины в базу — радар продолжит работать автоматически.</div> : entries.slice(0, 30).map(({ order, shop, distance, isCompatible, isRecommended, confidence, radarScore }) => {
        const level = getShopRecommendationLevel(shop, order);
        const levelLabel = level === 'high' ? 'Высокая рекомендация' : level === 'medium' ? 'Средняя рекомендация' : level === 'low' ? 'Низкая рекомендация' : 'Резервная точка';

        return (
        <div key={`${order.id}-${shop.id}`} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-black truncate">{shop.name}</p>
              <p className="text-[11px] text-slate-400 truncate">{order.brand} {order.model} • {order.year || '—'} {isRecommended ? '• рекомендован' : !isCompatible ? '• ближайший магазин' : '• совместим'}</p>
            </div>
            <div className="text-[11px] font-black text-emerald-300">{Number.isFinite(distance) ? `${Math.round(distance)}m` : 'n/a'}</div>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className={`rounded-full px-2 py-1 font-black uppercase ${confidence === 'high' ? 'bg-emerald-500/20 text-emerald-200' : confidence === 'medium' ? 'bg-amber-500/20 text-amber-200' : 'bg-slate-700 text-slate-300'}`}>{confidence}</span>
            <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">{levelLabel}</span>
            <span className="text-slate-400">Radar score: {Math.round(radarScore)}</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => window.open(buildShopMapLink(shop), '_blank')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-black uppercase text-slate-950"><Navigation size={12} /> Маршрут</button>
            <button type="button" onClick={() => navigate(`/order/${order.id}`)} className="inline-flex items-center gap-1 rounded-xl border border-slate-700 px-3 py-2 text-[11px] font-black uppercase text-slate-200"><LocateFixed size={12} /> Карточка</button>
          </div>
        </div>
      );})}
    </div>
  );
};

export default RadarScreen;
