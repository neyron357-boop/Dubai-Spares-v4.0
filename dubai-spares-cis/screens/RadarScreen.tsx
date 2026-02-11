import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocateFixed, Navigation, ShieldCheck, Telescope, Loader2, EyeOff, RotateCcw, MessageCircle } from 'lucide-react';
import { useStore } from '../store';
import { Order, Shop } from '../types';
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
const LONG_PRESS_MS = 700;

type RadarFilter = 'all' | 'new_only' | 'used_only' | 'open_now';

type RadarEntry = ReturnType<typeof getRadarShopMatches>[number] & { order: Order };

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

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
    if (!raw.trim()) return [];
    if (raw.toLowerCase() === 'closed') return [];
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

  if (Array.isArray(raw)) {
    return raw.flatMap((item) => parseSlotPair(item));
  }

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

const getShopTimeContext = (shop: Shop) => {
  if (!shop.businessHoursTimezone) {
    return { dayKey: DAY_KEYS[new Date().getDay()], minutes: (new Date().getHours() * 60) + new Date().getMinutes() };
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: shop.businessHoursTimezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(new Date());
    const weekday = (parts.find((part) => part.type === 'weekday')?.value || 'sun').toLowerCase();
    const hours = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minutes = Number(parts.find((part) => part.type === 'minute')?.value || 0);

    const weekdayMap: Record<string, typeof DAY_KEYS[number]> = {
      sun: 'sun',
      mon: 'mon',
      tue: 'tue',
      wed: 'wed',
      thu: 'thu',
      fri: 'fri',
      sat: 'sat'
    };

    return {
      dayKey: weekdayMap[weekday.slice(0, 3)] || 'sun',
      minutes: (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0)
    };
  } catch {
    return { dayKey: DAY_KEYS[new Date().getDay()], minutes: (new Date().getHours() * 60) + new Date().getMinutes() };
  }
};

const isShopOpenNow = (shop: Shop) => {
  if (!shop.businessHours) return true;

  const context = getShopTimeContext(shop);
  const daySchedule = (shop.businessHours[context.dayKey] ?? shop.businessHours.default ?? shop.businessHours.all) as unknown;
  const slots = parseSlotPair(daySchedule);
  if (slots.length === 0) return false;

  return slots.some((slot) => {
    if (slot.start <= slot.end) {
      return context.minutes >= slot.start && context.minutes <= slot.end;
    }

    return context.minutes >= slot.start || context.minutes <= slot.end;
  });
};

const getBearingArrow = (origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const toDeg = (value: number) => (value * 180) / Math.PI;
  const lat1 = toRad(origin.lat);
  const lat2 = toRad(destination.lat);
  const dLon = toRad(destination.lng - origin.lng);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;

  const arrows = ['↑', '↗️', '→', '↘️', '↓', '↙️', '←', '↖️'];
  const index = Math.round(bearing / 45) % 8;
  return arrows[index];
};

const formatDistanceWithDirection = (distance: number | null, position: { lat: number; lng: number } | null, shop: Shop) => {
  if (!Number.isFinite(distance)) return 'n/a';
  const base = distance! >= 1000 ? `${(distance! / 1000).toFixed(1)}km` : `${Math.round(distance!)}m`;
  if (!position || !hasValidCoordinates(shop.latitude, shop.longitude)) return base;
  return `${base} ${getBearingArrow(position, { lat: shop.latitude, lng: shop.longitude })}`;
};

const getPrimarySpecializationTag = (shop: Shop, order: Order) => {
  if (shop.specializationTag) return shop.specializationTag;
  if ((shop.specialization || []).length > 0) {
    const matchingBrand = shop.specialization.find((brand) => brand.toLowerCase() === order.brand.toLowerCase());
    if (matchingBrand) return `${matchingBrand} Expert`;
    return `${shop.specialization[0]} Specialist`;
  }
  return shop.type === 'scrapyard' ? 'Used Parts Specialist' : 'New Parts Specialist';
};

const makeWhatsappLink = (shopPhone: string, message: string) => {
  const normalizedPhone = shopPhone.replace(/[^\d+]/g, '');
  if (!normalizedPhone) return null;
  return `https://wa.me/${normalizedPhone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`;
};

const RadarScreen: React.FC = () => {
  const { orders, suppliers } = useStore();
  const navigate = useNavigate();
  const [shops, setShops] = useState<Shop[]>([]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [isFetchingShops, setIsFetchingShops] = useState(true);
  const [dismissedShopKeys, setDismissedShopKeys] = useState<Set<string>>(() => readDismissedRadarShops());
  const [activeFilter, setActiveFilter] = useState<RadarFilter>('all');
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);

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

  const entries = useMemo<RadarEntry[]>(() => {
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
        .sort((a, b) => (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY))
        .slice(0, 3);
    })
      .filter((entry) => !dismissedShopKeys.has(getRadarDismissKey(entry.shop)))
      .sort((a, b) => ((a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY)));
  }, [orders, shops, position, dismissedShopKeys]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (activeFilter === 'new_only') return entry.shop.type !== 'scrapyard';
      if (activeFilter === 'used_only') return entry.shop.type === 'scrapyard';
      if (activeFilter === 'open_now') return isShopOpenNow(entry.shop);
      return true;
    });
  }, [entries, activeFilter]);

  const routeChain = useMemo(() => {
    const recommendedShops = filteredEntries
      .filter((entry) => entry.isRecommended)
      .map((entry) => entry.shop);
    const uniqueShops = Array.from(new Map(recommendedShops.map((shop) => [shop.id, shop])).values());
    return buildNearestShopsChain(uniqueShops, position).slice(0, 8);
  }, [filteredEntries, position]);

  const tieredEntries = useMemo(() => {
    const grouped = {
      high: [] as typeof filteredEntries,
      medium: [] as typeof filteredEntries,
      low: [] as typeof filteredEntries
    };

    filteredEntries.forEach((entry) => {
      const level = getShopRecommendationLevel(entry.shop, entry.order);
      if (level === 'high') grouped.high.push(entry);
      else if (level === 'medium') grouped.medium.push(entry);
      else grouped.low.push(entry);
    });

    return grouped;
  }, [filteredEntries]);

  const tierConfigs: Array<{ key: keyof typeof tieredEntries; title: string; tone: string }> = [
    { key: 'high', title: 'High Tier', tone: 'text-emerald-300 border-emerald-400/30' },
    { key: 'medium', title: 'Medium Tier', tone: 'text-amber-300 border-amber-400/30' },
    { key: 'low', title: 'Low Tier', tone: 'text-slate-300 border-slate-700' }
  ];

  const openPlannedRoute = () => {
    if (routeChain.length === 0) {
      toast('Нет рекомендованных магазинов для построения multi-stop маршрута', 'error');
      return;
    }

    const routeLink = buildRoutePlanMapLink(routeChain, position);
    void logger.info('RADAR_GEO', 'Opening smart chain route for recommended shops', {
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
    toast(`Локация ${shop.name} скрыта из радара`, 'success');
  };

  const resetDismissedShops = () => {
    const next = new Set<string>();
    setDismissedShopKeys(next);
    saveDismissedRadarShops(next);
    toast('Скрытые точки радара восстановлены', 'success');
  };

  const openWhatsApp = (shop: Shop, order: Order, extendedTemplate: boolean) => {
    const partList = order.parts.map((part) => `• ${part.name}`).join('\n') || '• Need parts list';
    const message = extendedTemplate
      ? `Mission Control inquiry\nBrand/Model: ${order.brand} ${order.model} ${order.year || ''}\nVIN: ${order.vin || 'N/A'}\nVIN Photo: ${order.vinPhotoUrl || 'N/A'}\nRequested parts:\n${partList}`
      : `Hi! Need parts for ${order.brand} ${order.model} ${order.year || ''}. VIN: ${order.vin || 'N/A'}.`;

    const link = makeWhatsappLink(shop.phone || '', message);
    if (!link) {
      toast('У магазина нет WhatsApp номера', 'error');
      return;
    }

    window.open(link, '_blank');
  };

  const beginLongPress = (shop: Shop, order: Order) => {
    longPressTriggered.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      openWhatsApp(shop, order, true);
      toast('Открыт WhatsApp шаблон с Part List + VIN', 'success');
    }, LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleWhatsappTap = (shop: Shop, order: Order) => {
    if (!longPressTriggered.current) {
      openWhatsApp(shop, order, false);
    }
    longPressTriggered.current = false;
    cancelLongPress();
  };

  const filterButtons: Array<{ key: RadarFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'new_only', label: 'New Only' },
    { key: 'used_only', label: 'Used/Scrapyard' },
    { key: 'open_now', label: 'Open Now' }
  ];

  return (
    <div className="p-4 pb-20 space-y-3 bg-slate-950 min-h-full text-white">
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3">
        <div className="flex items-center gap-2 text-emerald-300">
          <span className="relative inline-flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-80" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-200" />
          </span>
          <span className="text-sm font-black uppercase tracking-wider">Radar Live</span>
        </div>
        <p className="mt-1 text-xs text-emerald-100/80">Полевой режим: строгий match по бренду + live статус магазинов и multi-stop маршрут для рекомендованных.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {filterButtons.map((button) => (
            <button
              key={button.key}
              type="button"
              onClick={() => setActiveFilter(button.key)}
              className={`rounded-lg border px-3 py-1 text-[10px] font-black uppercase ${activeFilter === button.key ? 'border-emerald-300 bg-emerald-300/20 text-emerald-100' : 'border-emerald-400/30 text-emerald-200/80'}`}
            >
              {button.label}
            </button>
          ))}
        </div>
        <div className="mt-2">
          <button type="button" onClick={openPlannedRoute} disabled={routeChain.length === 0} className="inline-flex items-center gap-1 rounded-xl bg-emerald-400 px-3 py-2 text-[11px] font-black uppercase text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
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
      ) : filteredEntries.length === 0 ? <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center text-xs text-slate-400">Радар пока не нашел подходящих магазинов для выбранного фильтра.</div> : tierConfigs.map((tier) => {
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
              const openNow = isShopOpenNow(shop);
              const specializationTag = getPrimarySpecializationTag(shop, order);

              return (
                <div key={`${order.id}-${shop.id}`} className={`rounded-2xl border p-3 space-y-2 ${openNow ? 'border-slate-800 bg-slate-900/80' : 'border-slate-700 bg-slate-900/50 grayscale'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black truncate">{shop.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{order.brand} {order.model} • {order.year || '—'} {isRecommended ? '• рекомендован' : !isCompatible ? '• ближайший магазин' : '• совместим'}</p>
                    </div>
                    <div className="text-right">
                      {!openNow && <span className="mb-1 inline-flex rounded-full border border-rose-400/40 bg-rose-500/20 px-2 py-0.5 text-[10px] font-black uppercase text-rose-200">Closed</span>}
                      <div className="text-[11px] font-black text-emerald-300">{hasValidCoordinates(shop.latitude, shop.longitude) ? formatDistanceWithDirection(distance, position, shop) : 'Location Unknown'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] flex-wrap">
                    <span className={`rounded-full px-2 py-1 font-black uppercase ${confidence === 'high' ? 'bg-emerald-500/20 text-emerald-200' : confidence === 'medium' ? 'bg-amber-500/20 text-amber-200' : 'bg-slate-700 text-slate-300'}`}>{confidence}</span>
                    <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">{levelLabel}</span>
                    <span className="rounded-full bg-blue-500/20 px-2 py-1 text-blue-200">{specializationTag}</span>
                    <span className="text-slate-400">Radar score: {Math.round(radarScore)}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={() => window.open(buildShopMapLink(shop), '_blank')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-black uppercase text-slate-950"><Navigation size={12} /> Маршрут</button>
                    <button type="button" onClick={() => navigate(`/order/${order.id}`)} className="inline-flex items-center gap-1 rounded-xl border border-slate-700 px-3 py-2 text-[11px] font-black uppercase text-slate-200"><LocateFixed size={12} /> Карточка</button>
                    <button
                      type="button"
                      onMouseDown={() => beginLongPress(shop, order)}
                      onMouseUp={() => handleWhatsappTap(shop, order)}
                      onMouseLeave={cancelLongPress}
                      onTouchStart={() => beginLongPress(shop, order)}
                      onTouchEnd={() => handleWhatsappTap(shop, order)}
                      className="inline-flex items-center gap-1 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-200"
                    >
                      <MessageCircle size={12} /> WhatsApp
                    </button>
                    <button type="button" onClick={() => dismissShopFromRadar(shop)} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-2 text-[11px] font-black uppercase text-slate-300"><EyeOff size={12} /> Hide</button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
};

export default RadarScreen;
