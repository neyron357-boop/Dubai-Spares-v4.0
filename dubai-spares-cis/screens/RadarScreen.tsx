import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock3, EyeOff, ListChecks, Loader2, MessageCircle, Navigation, PhoneCall, RotateCcw, ShieldAlert, ShieldCheck, Telescope, XCircle } from 'lucide-react';
import { useStore } from '../store';
import { Order, RadarInteraction, RadarInteractionResult, Shop } from '../types';
import { buildNearestShopsChain, buildRoutePlanMapLink, buildShopMapLink, getRadarShopMatches, getShopRecommendationDiagnostics } from '../shopMatching';
import { fetchRadarShops } from '../radarShops';
import { toast } from '../feedback';
import { createUuid } from '../id';
import { offlineDb } from '../storage/offlineDb';

const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 8000, timeout: 15000 };
const RADAR_DISMISSED_SHOPS_KEY = 'radar_dismissed_shop_keys';

type RadarFilter = 'all' | 'new_only' | 'used_only';
type RadarMode = 'field' | 'detail';
type TemplateLanguage = 'ru' | 'en';
type TemplateLength = 'short' | 'full';
type BrandMatchMode = 'strict' | 'soft';

type RadarEntry = ReturnType<typeof getRadarShopMatches>[number] & { order: Order; score: number; recommendation: 'high' | 'medium' | 'low'; reasons: string[]; openNow: boolean | null };

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const RADIUS_STEPS = [2, 5, 10, 20] as const;

const hasValidCoordinates = (latitude: number, longitude: number) => Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0;

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
    // ignore storage failures
  }
};

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

const getShopTimeContext = (shop: Shop) => {
  if (!shop.businessHoursTimezone) return { dayKey: DAY_KEYS[new Date().getDay()], minutes: (new Date().getHours() * 60) + new Date().getMinutes() };
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: shop.businessHoursTimezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = formatter.formatToParts(new Date());
    const weekday = (parts.find((part) => part.type === 'weekday')?.value || 'sun').toLowerCase();
    const hours = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minutes = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    const weekdayMap: Record<string, typeof DAY_KEYS[number]> = { sun: 'sun', mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat' };
    return { dayKey: weekdayMap[weekday.slice(0, 3)] || 'sun', minutes: (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0) };
  } catch {
    return { dayKey: DAY_KEYS[new Date().getDay()], minutes: (new Date().getHours() * 60) + new Date().getMinutes() };
  }
};

const getOpenState = (shop: Shop): boolean | null => {
  if (!shop.businessHours) return null;
  const context = getShopTimeContext(shop);
  const daySchedule = (shop.businessHours[context.dayKey] ?? shop.businessHours.default ?? shop.businessHours.all) as unknown;
  const slots = parseSlotPair(daySchedule);
  if (slots.length === 0) return false;
  return slots.some((slot) => (slot.start <= slot.end ? context.minutes >= slot.start && context.minutes <= slot.end : context.minutes >= slot.start || context.minutes <= slot.end));
};

const getRecommendation = (score: number): 'high' | 'medium' | 'low' => {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
};

const km = (distance: number | null) => Number.isFinite(distance) ? (distance || 0) / 1000 : Number.POSITIVE_INFINITY;

const makeWhatsappLink = (shopPhone: string, message: string) => {
  const normalizedPhone = shopPhone.replace(/[^\d+]/g, '');
  if (!normalizedPhone) return null;
  return `https://wa.me/${normalizedPhone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`;
};

const getDismissKey = (shop: Shop) => shop.location?.trim().toLowerCase() ? `location:${shop.location.trim().toLowerCase()}` : `id:${shop.id}`;

const templateText = (order: Order, lang: TemplateLanguage, length: TemplateLength) => {
  const part = order.parts[0]?.name || 'part';
  const baseContext = `${order.brand} ${order.model} ${order.year || ''}`.trim();
  if (lang === 'ru') {
    if (length === 'short') return `Salam. Need: ${part} for ${baseContext}. New/Used? Price AED? Availability today?`;
    return `Salam. Need: ${part} for ${baseContext}.\nVIN: ${order.vin || 'N/A'}.\nQty: 1, urgency: high.\nNew/Used? Price AED? Availability today? Send photo if possible.`;
  }
  if (length === 'short') return `Salam. Need ${part} for ${baseContext}. New/Used? Price AED? Available today?`;
  return `Salam. Need ${part} for ${baseContext}. VIN: ${order.vin || 'N/A'}. Quantity: 1. Urgent. Please confirm New/Used, price AED, availability today, and send photo if possible.`;
};

const RadarScreen: React.FC = () => {
  const { orders, suppliers } = useStore();
  const navigate = useNavigate();
  const [shops, setShops] = useState<Shop[]>([]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [mode, setMode] = useState<RadarMode>('field');
  const [activeFilter, setActiveFilter] = useState<RadarFilter>('all');
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [radiusKm, setRadiusKm] = useState<(typeof RADIUS_STEPS)[number]>(5);
  const [brandMatchMode, setBrandMatchMode] = useState<BrandMatchMode>('strict');
  const [fallbackNearby, setFallbackNearby] = useState(true);
  const [templateLanguage, setTemplateLanguage] = useState<TemplateLanguage>('ru');
  const [templateLength, setTemplateLength] = useState<TemplateLength>('short');
  const [dismissedShopKeys, setDismissedShopKeys] = useState<Set<string>>(() => readDismissedRadarShops());
  const [isFetchingShops, setIsFetchingShops] = useState(true);
  const [chainMode, setChainMode] = useState(false);
  const [chainIndex, setChainIndex] = useState(0);
  const [interactions, setInteractions] = useState<RadarInteraction[]>([]);

  useEffect(() => { void offlineDb.getRadarInteractions().then(setInteractions); }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsFetchingShops(true);
      const loadedShops = await fetchRadarShops(suppliers);
      if (!active) return;
      setShops(loadedShops);
      setIsFetchingShops(false);
    };
    void load();
    return () => { active = false; };
  }, [suppliers]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => undefined, GEO_OPTIONS);
    const id = navigator.geolocation.watchPosition((pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => undefined, GEO_OPTIONS);
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const entries = useMemo<RadarEntry[]>(() => {
    const successfulByShop = new Map<string, number>();
    const badByShop = new Map<string, number>();
    interactions.forEach((item) => {
      if (item.result === 'found') successfulByShop.set(item.shopId, (successfulByShop.get(item.shopId) || 0) + 1);
      if (item.result === 'wrong_info') badByShop.set(item.shopId, (badByShop.get(item.shopId) || 0) + 1);
    });

    return orders
      .filter((o) => !o.isArchived && !o.isSold)
      .flatMap((order) => {
        const candidates = getRadarShopMatches(order, shops, position)
          .filter((item) => brandMatchMode === 'soft' || item.matchScore > 0)
          .filter((item) => !dismissedShopKeys.has(getDismissKey(item.shop)));

        const radiusFiltered = candidates.filter((item) => km(item.distance) <= radiusKm);
        const pool = radiusFiltered.length >= 3 || !fallbackNearby ? radiusFiltered : candidates.filter((item) => km(item.distance) <= radiusKm * 2);

        return pool.map((item) => {
          const openNow = getOpenState(item.shop);
          const diagnostics = getShopRecommendationDiagnostics(item.shop, order);
          const brandCategory = diagnostics.brandMatched ? (diagnostics.modelMatched ? 30 : 22) : 8;
          const distanceFactor = !Number.isFinite(item.distance) ? 5 : Math.max(0, 15 - Math.round((item.distance || 0) / 800));
          const openFactor = openNow === true ? 10 : openNow === null ? 6 : 1;
          const historyFactor = Math.min(20, (successfulByShop.get(item.shop.id) || 0) * 5);
          const responseFactor = interactions.some((x) => x.shopId === item.shop.id && x.result === 'message_sent') ? 8 : 4;
          const reliabilityFactor = Math.max(0, 15 - ((badByShop.get(item.shop.id) || 0) * 5));
          const score = Math.max(0, Math.min(100, brandCategory + distanceFactor + openFactor + historyFactor + responseFactor + reliabilityFactor));

          const reasons = [
            diagnostics.brandMatched ? 'Бренд совпадает' : 'Слабое совпадение по бренду',
            Number.isFinite(item.distance) ? `Дистанция ${(item.distance! / 1000).toFixed(1)} км` : 'Нет точных координат',
            openNow === true ? 'Открыт сейчас' : openNow === false ? 'Сейчас закрыт' : 'Часы неизвестны'
          ];

          return { ...item, order, score, recommendation: getRecommendation(score), reasons, openNow };
        });
      })
      .filter((entry) => {
        if (activeFilter === 'new_only') return entry.shop.type !== 'scrapyard';
        if (activeFilter === 'used_only') return entry.shop.type === 'scrapyard';
        return true;
      })
      .filter((entry) => !openNowOnly || entry.openNow === true)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  }, [orders, shops, position, activeFilter, openNowOnly, radiusKm, fallbackNearby, dismissedShopKeys, interactions, brandMatchMode]);

  const chainRoute = useMemo(() => {
    const preferred = entries.filter((entry) => entry.recommendation === 'high' && entry.openNow !== false).map((entry) => entry.shop);
    const unique = Array.from(new Map(preferred.map((shop) => [shop.id, shop])).values()).slice(0, 12);
    return buildNearestShopsChain(unique, position);
  }, [entries, position]);

  useEffect(() => {
    if (!chainMode || chainRoute.length === 0) {
      setChainIndex(0);
      return;
    }
    setChainIndex((current) => Math.min(current, chainRoute.length - 1));
  }, [chainMode, chainRoute]);

  const currentStop = chainRoute[chainIndex] || null;

  const openShopRoute = (shop: Shop) => {
    if (hasValidCoordinates(shop.latitude, shop.longitude) && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      window.open(`http://maps.apple.com/?daddr=${shop.latitude},${shop.longitude}`, '_blank');
      return;
    }
    window.open(buildShopMapLink(shop), '_blank');
  };

  const openChainRoute = () => {
    if (chainRoute.length === 0) {
      toast('Нет точек для маршрута', 'error');
      return;
    }
    window.open(buildRoutePlanMapLink(chainRoute, position), '_blank');
  };

  const resetDismissed = () => {
    const next = new Set<string>();
    setDismissedShopKeys(next);
    saveDismissedRadarShops(next);
  };

  const hideShop = (shop: Shop) => {
    const next = new Set(dismissedShopKeys);
    next.add(getDismissKey(shop));
    setDismissedShopKeys(next);
    saveDismissedRadarShops(next);
  };

  const addInteraction = async (payload: Omit<RadarInteraction, 'id' | 'createdAt'>) => {
    const interaction: RadarInteraction = { id: createUuid(), createdAt: Date.now(), ...payload };
    await offlineDb.saveRadarInteraction(interaction);
    setInteractions((prev) => [interaction, ...prev]);
    if (navigator.onLine) {
      await offlineDb.markRadarInteractionSynced(interaction.id);
    }
  };

  const onWhatsApp = async (entry: RadarEntry) => {
    const message = templateText(entry.order, templateLanguage, templateLength);
    const link = makeWhatsappLink(entry.shop.phone || '', message);
    if (!link) {
      toast('У точки нет WhatsApp номера', 'error');
      return;
    }
    window.open(link, '_blank');
    await addInteraction({ shopId: entry.shop.id, orderId: entry.order.id, result: 'message_sent', comment: 'WhatsApp opened' });
    toast('Шаблон WhatsApp открыт', 'success');
  };

  const quickResult = async (entry: RadarEntry, result: RadarInteractionResult) => {
    await addInteraction({ shopId: entry.shop.id, orderId: entry.order.id, partId: entry.order.parts[0]?.id, result, availability: result === 'found' ? 'in_stock' : undefined });
    toast('Результат сохранен (offline-first)', 'success');
  };

  const openCalls = (phone?: string) => {
    if (!phone) return;
    window.open(`tel:${phone}`, '_self');
  };

  const pendingSync = interactions.filter((item) => !item.syncedAt).length;

  return (
    <div className="p-4 pb-20 space-y-3 bg-slate-950 min-h-full text-white">
      <section className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-sm font-black uppercase tracking-wider text-emerald-300">Radar Live</h1>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMode('field')} className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase ${mode === 'field' ? 'bg-emerald-400 text-slate-900' : 'border border-emerald-300/50 text-emerald-200'}`}>Field Mode</button>
            <button type="button" onClick={() => setMode('detail')} className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase ${mode === 'detail' ? 'bg-emerald-400 text-slate-900' : 'border border-emerald-300/50 text-emerald-200'}`}>Detail Mode</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <button type="button" onClick={() => setChainMode((v) => !v)} className="inline-flex items-center gap-1 rounded-xl bg-emerald-400 px-3 py-2 font-black uppercase text-slate-950"><Navigation size={12} /> Chain Route</button>
          <button type="button" onClick={openChainRoute} className="rounded-xl border border-emerald-300/40 px-3 py-2 font-black uppercase text-emerald-100">Open route</button>
          <button type="button" onClick={resetDismissed} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-2 font-black uppercase text-slate-200"><RotateCcw size={12} /> Reset hidden</button>
        </div>

        <div className="flex flex-wrap gap-2 text-[10px]">
          {(['all', 'new_only', 'used_only'] as RadarFilter[]).map((item) => (
            <button key={item} type="button" onClick={() => setActiveFilter(item)} className={`rounded-lg px-3 py-1 font-black uppercase ${activeFilter === item ? 'bg-slate-100 text-slate-900' : 'border border-slate-600 text-slate-300'}`}>{item}</button>
          ))}
          <button type="button" onClick={() => setOpenNowOnly((v) => !v)} className={`rounded-lg px-3 py-1 font-black uppercase ${openNowOnly ? 'bg-slate-100 text-slate-900' : 'border border-slate-600 text-slate-300'}`}>Open now</button>
          <button type="button" onClick={() => setBrandMatchMode((v) => (v === 'strict' ? 'soft' : 'strict'))} className="rounded-lg border border-slate-600 px-3 py-1 font-black uppercase text-slate-300">Brand {brandMatchMode}</button>
          <button type="button" onClick={() => setFallbackNearby((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 px-3 py-1 font-black uppercase text-amber-200"><Telescope size={11} /> fallback nearby</button>
        </div>

        <div className="flex items-center flex-wrap gap-2 text-[10px]">
          <span className="text-slate-300">Radius:</span>
          {RADIUS_STEPS.map((step) => (
            <button key={step} type="button" onClick={() => setRadiusKm(step)} className={`rounded px-2 py-1 font-black ${radiusKm === step ? 'bg-emerald-400 text-slate-900' : 'border border-slate-600 text-slate-300'}`}>{step} km</button>
          ))}
          <span className="ml-2 text-slate-300">WA:</span>
          <button type="button" onClick={() => setTemplateLanguage((v) => (v === 'ru' ? 'en' : 'ru'))} className="rounded border border-slate-600 px-2 py-1 text-slate-300 uppercase">{templateLanguage}</button>
          <button type="button" onClick={() => setTemplateLength((v) => (v === 'short' ? 'full' : 'short'))} className="rounded border border-slate-600 px-2 py-1 text-slate-300 uppercase">{templateLength}</button>
        </div>

        <p className="text-[11px] text-emerald-100/80">Активных точек: {entries.length}. Очередь offline sync: {pendingSync}.</p>
      </section>

      {chainMode && currentStop && (
        <section className="rounded-2xl border border-blue-400/30 bg-blue-500/10 p-3 space-y-2">
          <p className="text-xs font-black uppercase text-blue-200">Next stop {chainIndex + 1}/{chainRoute.length}</p>
          <p className="text-sm font-black">{currentStop.name}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openShopRoute(currentStop)} className="rounded-xl bg-blue-400 px-3 py-2 text-[11px] font-black uppercase text-slate-900">Маршрут</button>
            <button type="button" onClick={() => setChainIndex((i) => Math.min(i + 1, chainRoute.length - 1))} className="rounded-xl border border-blue-300/40 px-3 py-2 text-[11px] font-black uppercase text-blue-100">Следующая</button>
          </div>
        </section>
      )}

      {isFetchingShops ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-center text-slate-300"><Loader2 className="mx-auto mb-2 animate-spin" size={18} /> Загрузка точек...</div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center text-xs text-slate-400">Радар пока не нашел подходящих точек.</div>
      ) : entries.map((entry) => {
        const recTone = entry.recommendation === 'high' ? 'bg-emerald-500/20 text-emerald-200' : entry.recommendation === 'medium' ? 'bg-amber-500/20 text-amber-200' : 'bg-rose-500/20 text-rose-200';
        return (
          <article key={`${entry.order.id}-${entry.shop.id}`} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-black truncate">{entry.shop.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{entry.order.brand} {entry.order.model} {entry.order.year || ''}</p>
              </div>
              <div className="text-right">
                <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${recTone}`}>Рекомендация: {entry.recommendation}</span>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-2 text-[10px] text-slate-300">
              <span>{Number.isFinite(entry.distance) ? `${((entry.distance || 0) / 1000).toFixed(1)} км` : 'Distance n/a'}</span>
              <span>•</span>
              {entry.openNow === true ? <span className="text-emerald-300">Open now</span> : entry.openNow === false ? <span className="text-rose-300">Closed</span> : <span>hours unknown</span>}
              <span>•</span>
              <span>Score {Math.round(entry.score)}/100</span>
            </div>

            {mode === 'detail' && (
              <div className="rounded-xl bg-slate-800/70 p-2 text-[11px] text-slate-200 space-y-1">
                {entry.reasons.slice(0, 3).map((reason) => <p key={`${entry.shop.id}-${reason}`}>• {reason}</p>)}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openShopRoute(entry.shop)} className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-black uppercase text-slate-950"><Navigation size={12} /> Маршрут</button>
              <button type="button" onClick={() => onWhatsApp(entry)} className="inline-flex items-center gap-1 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-200"><MessageCircle size={12} /> WhatsApp</button>
              <button type="button" onClick={() => openCalls(entry.shop.phone)} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-2 text-[11px] font-black uppercase text-slate-200"><PhoneCall size={12} /> Call</button>
              <button type="button" onClick={() => hideShop(entry.shop)} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-2 text-[11px] font-black uppercase text-slate-300"><EyeOff size={12} /> Hide</button>
              {mode === 'detail' && <button type="button" onClick={() => navigate(`/order/${entry.order.id}`)} className="rounded-xl border border-slate-600 px-3 py-2 text-[11px] font-black uppercase text-slate-300">Карточка</button>}
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => quickResult(entry, 'found')} className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 px-2 py-1 text-[10px] font-black uppercase text-emerald-200"><CheckCircle2 size={11} /> Found</button>
              <button type="button" onClick={() => quickResult(entry, 'not_found')} className="inline-flex items-center gap-1 rounded-lg border border-rose-400/40 px-2 py-1 text-[10px] font-black uppercase text-rose-200"><XCircle size={11} /> Not found</button>
              <button type="button" onClick={() => quickResult(entry, 'follow_up')} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 px-2 py-1 text-[10px] font-black uppercase text-amber-200"><Clock3 size={11} /> Follow-up</button>
              <button type="button" onClick={() => quickResult(entry, 'wrong_info')} className="inline-flex items-center gap-1 rounded-lg border border-orange-400/40 px-2 py-1 text-[10px] font-black uppercase text-orange-200"><ShieldAlert size={11} /> Wrong info</button>
            </div>
          </article>
        );
      })}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-[11px] text-slate-300 space-y-1">
        <p className="inline-flex items-center gap-1"><ShieldCheck size={12} /> Offline-first: все результаты пишутся в IndexedDB.</p>
        <p className="inline-flex items-center gap-1"><ListChecks size={12} /> One-scale recommendation: High (80-100) / Medium (50-79) / Low (&lt;50).</p>
      </section>
    </div>
  );
};

export default RadarScreen;
