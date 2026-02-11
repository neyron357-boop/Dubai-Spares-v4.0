import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocateFixed, Radar, Navigation, ShieldCheck, Telescope, Loader2, EyeOff, RotateCcw } from 'lucide-react';
import { useStore } from '../store';
import { Shop } from '../types';
import { buildNearestShopsChain, buildRoutePlanMapLink, buildShopMapLink, getRadarShopMatches, getShopRecommendationLevel } from '../shopMatching';
import { supabase } from '../supabase';
import { fetchRadarShops } from '../radarShops';
import { toast } from '../feedback';
import { logger } from '../logging';

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 8000,
  timeout: 15000
};

const RADAR_DISMISSED_SHOPS_KEY = 'radar_dismissed_shop_keys';

const getRadarDismissKey = (shop: Shop) => {
  const location = (shop.location || '').trim().toLowerCase();
  if (location) return `location:${location}`;
  return `id:${shop.id}`;
};

const readDismissedRadarShops = () => {
  try {
    const raw = localStorage.getItem(RADAR_DISMISSED_SHOPS_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    return new Set<string>(Array.isArray(parsed) ? parsed.map((item) => String(item)) : []);
  } catch {
    return new Set<string>();
  }
};

const saveDismissedRadarShops = (keys: Set<string>) => {
  try {
    localStorage.setItem(RADAR_DISMISSED_SHOPS_KEY, JSON.stringify(Array.from(keys)));
  } catch {
    // ignore private mode/localStorage failures
  }
};

const RadarScreen: React.FC = () => {
  const { orders, suppliers } = useStore();
  const navigate = useNavigate();
  const [shops, setShops] = useState<Shop[]>([]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [isFetchingShops, setIsFetchingShops] = useState(true);
  const [dismissedShopKeys, setDismissedShopKeys] = useState<Set<string>>(() => readDismissedRadarShops());

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
      const dismissedShopIds = new Set(order.dismissedShopIds || []);
      const withOrderContext = ranked
        .filter((entry) => !dismissedShopIds.has(entry.shop.id))
        .map((entry) => ({ ...entry, order }));

      const matched = withOrderContext.filter((entry) => entry.isRecommended || entry.isCompatible || entry.matchScore >= 2);
      if (matched.length > 0) return matched.slice(0, 8);

      return withOrderContext
        .filter((entry) => Number.isFinite(entry.distance))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);
    })
      .filter((entry) => !dismissedShopKeys.has(getRadarDismissKey(entry.shop)))
      .sort((a, b) => a.distance - b.distance);
  }, [orders, shops, position, dismissedShopKeys]);

  const routeChain = useMemo(() => {
    const uniqueShops = Array.from(new Map(entries.map((entry) => [entry.shop.id, entry.shop])).values());
    return buildNearestShopsChain(uniqueShops, position).slice(0, 8);
  }, [entries, position]);


  const tieredEntries = useMemo(() => {
    const grouped = {
      high: [] as typeof entries,
      medium: [] as typeof entries,
      low: [] as typeof entries
    };

    entries.forEach((entry) => {
      const level = getShopRecommendationLevel(entry.shop, entry.order);
      if (level === 'high') grouped.high.push(entry);
      else if (level === 'medium') grouped.medium.push(entry);
      else grouped.low.push(entry);
    });

    return grouped;
  }, [entries]);

  const tierConfigs: Array<{ key: keyof typeof tieredEntries; title: string; tone: string }> = [
    { key: 'high', title: 'High Tier', tone: 'text-emerald-300 border-emerald-400/30' },
    { key: 'medium', title: 'Medium Tier', tone: 'text-amber-300 border-amber-400/30' },
    { key: 'low', title: 'Low Tier', tone: 'text-slate-300 border-slate-700' }
  ];

  const openPlannedRoute = () => {
    const routeLink = buildRoutePlanMapLink(routeChain, position);
    void logger.info('RADAR_GEO', 'Opening smart chain route', {
      origin: position,
      shopCount: routeChain.length,
      shopIds: routeChain.map((shop) => shop.id),
      routeLink
    });
    window.open(routeLink, '_blank');
  };

  const dismissShopFromRadar = (shop: Shop) => {
    const key = getRadarDismissKey(shop);
    const next = new Set(dismissedShopKeys);
    next.add(key);
    setDismissedShopKeys(next);
    saveDismissedRadarShops(next);
    toast(`Локация ${shop.name} отмечена как проверенная`, 'success');
  };

  const resetDismissedShops = () => {
    const next = new Set<string>();
    setDismissedShopKeys(next);
    saveDismissedRadarShops(next);
    toast('Скрытые точки радара восстановлены', 'success');
  };

  return (
    <div className="p-4 pb-20 space-y-3 bg-slate-950 min-h-full text-white">
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3">
        <div className="flex items-center gap-2 text-emerald-300"><Radar size={18} className="animate-pulse" /><span className="text-sm font-black uppercase tracking-wider">Radar Live</span></div>
        <p className="mt-1 text-xs text-emerald-100/80">Полевой режим: сначала рекомендуемые и совместимые магазины, затем ближайшие резервные точки.</p>
        <div className="mt-2">
          <button type="button" onClick={openPlannedRoute} className="inline-flex items-center gap-1 rounded-xl bg-emerald-400 px-3 py-2 text-[11px] font-black uppercase text-slate-950">
            <Navigation size={12} /> Chain Route
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-emerald-100/90">
          {isFetchingShops ? <><Loader2 size={12} className="animate-spin" /> Обновляем радар и разворачиваем локации…</> : <span>Данные радара актуальны.</span>}
          {dismissedShopKeys.size > 0 && (
            <button type="button" onClick={resetDismissedShops} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300/40 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">
              <RotateCcw size={10} /> Вернуть скрытые ({dismissedShopKeys.size})
            </button>
          )}
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
      ) : entries.length === 0 ? <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center text-xs text-slate-400">Радар пока не нашел подходящих магазинов в выбранном радиусе. Попробуйте увеличить радиус поиска или добавить больше совместимых магазинов.</div> : tierConfigs.map((tier) => {
        const tierEntries = tieredEntries[tier.key];
        if (tierEntries.length === 0) return null;

        return (
          <section key={tier.key} className="space-y-2">
            <div className={`rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-widest ${tier.tone}`}>
              {tier.title} · {tierEntries.length}
            </div>
            {tierEntries.slice(0, 14).map(({ order, shop, distance, isCompatible, isRecommended, confidence, radarScore }) => {
              const level = getShopRecommendationLevel(shop, order);
              const levelLabel = level === 'high' ? 'Высокая рекомендация' : level === 'medium' ? 'Средняя рекомендация' : level === 'low' ? 'Низкая рекомендация' : 'Резервная точка';

              return (
              <div key={`${order.id}-${shop.id}`} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black truncate">{shop.name}</p>
                    <p className="text-[11px] text-slate-400 truncate">{order.brand} {order.model} • {order.year || '—'} {isRecommended ? '• рекомендован' : !isCompatible ? '• ближайший магазин' : '• совместим'}</p>
                  </div>
                  <div className="text-[11px] font-black text-emerald-300">{(Number.isFinite(shop.latitude) && Number.isFinite(shop.longitude) && shop.latitude !== 0 && shop.longitude !== 0) ? (Number.isFinite(distance) ? `${Math.round(distance)}m` : 'n/a') : 'Location Unknown'}</div>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={`rounded-full px-2 py-1 font-black uppercase ${confidence === 'high' ? 'bg-emerald-500/20 text-emerald-200' : confidence === 'medium' ? 'bg-amber-500/20 text-amber-200' : 'bg-slate-700 text-slate-300'}`}>{confidence}</span>
                  <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">{levelLabel}</span>
                  <span className="text-slate-400">Radar score: {Math.round(radarScore)}</span>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => window.open(buildShopMapLink(shop), '_blank')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-black uppercase text-slate-950"><Navigation size={12} /> Маршрут</button>
                  <button type="button" onClick={() => navigate(`/order/${order.id}`)} className="inline-flex items-center gap-1 rounded-xl border border-slate-700 px-3 py-2 text-[11px] font-black uppercase text-slate-200"><LocateFixed size={12} /> Карточка</button>
                  <button type="button" onClick={() => dismissShopFromRadar(shop)} className="inline-flex items-center gap-1 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] font-black uppercase text-amber-200"><EyeOff size={12} /> Проверено</button>
                </div>
              </div>
            );})}
          </section>
        );
      })}
    </div>
  );
};

export default RadarScreen;
