import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock3, EyeOff, HelpCircle, ListChecks, Loader2, MapPinned, MessageCircle, Navigation, PhoneCall, RotateCcw, ShieldAlert, ShieldCheck, Telescope, XCircle } from 'lucide-react';
import { useStore } from '../store';
import { Order, RadarInteraction, RadarInteractionResult, Shop } from '../types';
import { buildNearestShopsChain, buildRoutePlanMapLink, buildShopMapLink, getRadarShopMatches, getShopRecommendationDiagnostics } from '../shopMatching';
import { fetchRadarShops } from '../radarShops';
import { toast } from '../feedback';
import { createUuid } from '../id';
import { offlineDb } from '../storage/offlineDb';
import { NotificationType, createFollowupFromAction, pushNotification } from '../notificationCenter';
import { loadAppSettings } from '../appSettings';

const RADAR_DISMISSED_SHOPS_KEY = 'radar_dismissed_shop_keys';

type RadarFilter = 'all' | 'new_only' | 'used_only';
type RadarMode = 'field' | 'detail';
type TemplateLanguage = 'ru' | 'en' | 'tj';
type TemplateLength = 'short' | 'full';
type BrandMatchMode = 'strict' | 'soft';
type RadarUxMode = 'quick' | 'advanced';

type RadarEntry = ReturnType<typeof getRadarShopMatches>[number] & { order: Order; score: number; recommendation: 'high' | 'medium' | 'low'; reasons: string[]; openNow: boolean | null };

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const RADIUS_STEPS = [2, 5, 10, 20] as const;
const radarSettings = loadAppSettings();
const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: radarSettings.gpsHighAccuracy, maximumAge: 8000, timeout: 15000 };

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

const getDismissKey = (shopId: string, orderId: string) => `order:${orderId}:shop:${shopId}`;
const getLegacyDismissKey = (shop: Shop) => shop.location?.trim().toLowerCase() ? `location:${shop.location.trim().toLowerCase()}` : `id:${shop.id}`;

const templateText = (order: Order, lang: TemplateLanguage, length: TemplateLength) => {
  const parts = order.parts.map((item) => item.name).filter(Boolean);
  const part = parts[0] || 'part';
  const partSuffix = parts.length > 1 ? `, ${parts.slice(1, 3).join(', ')}${parts.length > 3 ? ' и другие' : ''}` : '';
  const baseContext = `${order.brand} ${order.model} ${order.year || ''}`.trim();
  if (lang === 'ru') {
    if (length === 'short') return `Привет! Нужна ${part}${partSuffix} на ${baseContext}. Есть в наличии? Цена?`;
    return `Салам! Нужна ${part}${partSuffix} на ${baseContext}.\nСостояние: new/used. VIN: ${order.vin || 'нет'}.\nЦена? Есть фото? Локация? Ответьте пожалуйста 🙏`;
  }
  if (lang === 'tj') {
    if (length === 'short') return `Салом! Ба ман ${part}${partSuffix} барои ${baseContext} лозим. Ҳаст? Нарх?`;
    return `Салом! Ба ман ${part}${partSuffix} барои ${baseContext} лозим.\nҲолат: new/used. VIN: ${order.vin || 'нест'}.\nНарх? Сурат доред? Локатсия? Раҳмат.`;
  }
  if (length === 'short') return `Hi! Need ${part}${partSuffix} for ${baseContext}. Available? Price?`;
  return `Hi! Need ${part}${partSuffix} for ${baseContext}. VIN: ${order.vin || 'N/A'}. Please share condition (new/used), price, photos, and location.`;
};

const RadarScreen: React.FC = () => {
  const { orders, suppliers } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [shops, setShops] = useState<Shop[]>([]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [mode, setMode] = useState<RadarMode>(radarSettings.radarDefaultMode);
  const [activeFilter, setActiveFilter] = useState<RadarFilter>(radarSettings.radarDefaultFilter === 'open_now' ? 'all' : radarSettings.radarDefaultFilter);
  const [openNowOnly, setOpenNowOnly] = useState(radarSettings.radarDefaultFilter === 'open_now');
  const [radiusKm, setRadiusKm] = useState<number>(radarSettings.radarDefaultRadiusKm);
  const [customRadiusKm, setCustomRadiusKm] = useState('25');
  const [isCustomRadius, setIsCustomRadius] = useState(false);
  const [brandMatchMode, setBrandMatchMode] = useState<BrandMatchMode>(radarSettings.radarBrandStrict ? 'strict' : 'soft');
  const [fallbackNearby, setFallbackNearby] = useState(radarSettings.radarFallbackNearby);
  const [templateLanguage, setTemplateLanguage] = useState<TemplateLanguage>((['ru','en'].includes(radarSettings.waTemplateLanguage) ? radarSettings.waTemplateLanguage : 'ru') as TemplateLanguage);
  const [templateLength, setTemplateLength] = useState<TemplateLength>('short');
  const [dismissedShopKeys, setDismissedShopKeys] = useState<Set<string>>(() => readDismissedRadarShops());
  const [isFetchingShops, setIsFetchingShops] = useState(true);
  const [chainMode, setChainMode] = useState(false);
  const [uxMode, setUxMode] = useState<RadarUxMode>('quick');
  const [chainIndex, setChainIndex] = useState(0);
  const [interactions, setInteractions] = useState<RadarInteraction[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedShopIds, setSelectedShopIds] = useState<Set<string>>(new Set());
  const [syncError, setSyncError] = useState<string | null>(null);
  const [proximityAlerts, setProximityAlerts] = useState<Set<string>>(new Set());

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

  const activeOrderId = useMemo(() => new URLSearchParams(location.search).get('orderId'), [location.search]);
  const activeOrder = useMemo(() => orders.find((order) => order.id === activeOrderId) || null, [orders, activeOrderId]);

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
      .filter((order) => !activeOrder || order.id === activeOrder.id)
      .flatMap((order) => {
        const candidates = getRadarShopMatches(order, shops, position)
          .filter((item) => brandMatchMode === 'soft' || item.matchScore >= 0)
          .filter((item) => !dismissedShopKeys.has(getDismissKey(item.shop.id, order.id)) && !dismissedShopKeys.has(getLegacyDismissKey(item.shop)));

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
          const sensitivityBoost = Number.isFinite(item.distance) && (item.distance || 0) <= 2500 ? 8 : 3;
          const score = Math.max(0, Math.min(100, brandCategory + distanceFactor + openFactor + historyFactor + responseFactor + reliabilityFactor + sensitivityBoost));

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
      .filter((entry) => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        return [entry.shop.name, entry.shop.location || '', entry.order.brand, entry.order.model].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  }, [orders, shops, position, activeFilter, openNowOnly, radiusKm, fallbackNearby, dismissedShopKeys, interactions, brandMatchMode, activeOrder, searchQuery]);

  useEffect(() => {
    const nearby = entries.filter((entry) => Number.isFinite(entry.distance) && (entry.distance || 0) <= 200 && entry.recommendation !== 'low');
    if (nearby.length === 0) return;

    nearby.forEach((entry) => {
      if (proximityAlerts.has(entry.shop.id)) return;
      const next = new Set(proximityAlerts);
      next.add(entry.shop.id);
      setProximityAlerts(next);

      pushNotification({
        type: NotificationType.RADAR_RESULT,
        title: `Рядом поставщик: ${entry.shop.name}`,
        message: `До точки около ${Math.max(1, Math.round((entry.distance || 0)))} м. Рекомендуем остановиться.`,
        supplierId: entry.shop.id,
        mapUrl: buildShopMapLink(entry.shop),
        lat: entry.shop.latitude,
        lng: entry.shop.longitude,
        distanceM: entry.distance || undefined,
        source: 'radar',
        severity: 'critical'
      });

      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = 1040;
        gain.gain.value = 0.08;
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } catch {
        // audio may be blocked by browser autoplay policy
      }
    });
  }, [entries, proximityAlerts]);

  const chainRoute = useMemo(() => {
    const selected = entries.filter((entry) => selectedShopIds.has(entry.shop.id)).map((entry) => entry.shop);
    const preferred = (selected.length > 0 ? selected : entries.filter((entry) => entry.recommendation === 'high' && entry.openNow !== false).map((entry) => entry.shop));
    const unique = Array.from(new Map(preferred.map((shop) => [shop.id, shop])).values()).slice(0, 12);
    return buildNearestShopsChain(unique, position);
  }, [entries, position, selectedShopIds]);

  useEffect(() => {
    if (!chainMode || chainRoute.length === 0) {
      setChainIndex(0);
      return;
    }
    setChainIndex((current) => Math.min(current, chainRoute.length - 1));
  }, [chainMode, chainRoute]);

  const currentStop = chainRoute[chainIndex] || null;

  const openShopRoute = (shop: Shop) => {
    if (hasValidCoordinates(shop.latitude, shop.longitude)) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${shop.latitude},${shop.longitude}`, '_blank');
    } else {
      window.open(buildShopMapLink(shop), '_blank');
    }

    pushNotification({
      type: NotificationType.RADAR_ACTION,
      title: `Маршрут открыт: ${shop.name}`,
      message: 'Пользователь открыл маршрут до точки',
      supplierId: shop.id,
      mapUrl: buildShopMapLink(shop),
      lat: shop.latitude,
      lng: shop.longitude,
      source: 'radar',
      severity: 'info'
    });
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

  const hideShop = (entry: RadarEntry) => {
    const next = new Set(dismissedShopKeys);
    next.add(getDismissKey(entry.shop.id, entry.order.id));
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
    pushNotification({
      type: NotificationType.RADAR_ACTION,
      title: `WhatsApp: ${entry.shop.name}`,
      message: 'Отправлен WhatsApp из Radar Live',
      orderId: entry.order.id,
      supplierId: entry.shop.id,
      phone: entry.shop.phone || undefined,
      brand: entry.order.brand,
      carModel: entry.order.model,
      source: 'radar',
      severity: 'info'
    });
    createFollowupFromAction({
      orderId: entry.order.id,
      supplierId: entry.shop.id,
      phone: entry.shop.phone || undefined,
      brand: entry.order.brand,
      carModel: entry.order.model,
      carYear: Number(entry.order.year) || undefined,
      route: `/orders/${entry.order.id}`,
      source: 'radar',
      minutes: 30
    });
    toast('Шаблон WhatsApp открыт', 'success');
  };

  const quickResult = async (entry: RadarEntry, result: RadarInteractionResult) => {
    await addInteraction({ shopId: entry.shop.id, orderId: entry.order.id, partId: entry.order.parts[0]?.id, result, availability: result === 'found' ? 'in_stock' : undefined });
    pushNotification({
      type: NotificationType.RADAR_RESULT,
      title: `Radar: ${entry.shop.name}`,
      message: `Результат: ${result.replace('_', ' ')}`,
      orderId: entry.order.id,
      supplierId: entry.shop.id,
      phone: entry.shop.phone || undefined,
      mapUrl: buildShopMapLink(entry.shop),
      lat: entry.shop.latitude,
      lng: entry.shop.longitude,
      source: 'radar',
      severity: result === 'found' ? 'success' : result === 'wrong_info' ? 'warning' : 'info'
    });
    if (chainMode) {
      if (result === 'found') toast('Точка закрыла потребность. Можно завершить поиск.', 'success');
      else setChainIndex((index) => Math.min(index + 1, Math.max(chainRoute.length - 1, 0)));
    }
    if (loadAppSettings().radarAutoHideAfterAction) {
      setDismissedShopKeys((prev) => {
        const next = new Set(prev);
        next.add(getDismissKey(entry.shop.id, entry.order.id));
        saveDismissedRadarShops(next);
        return next;
      });
    }

    if (loadAppSettings().radarAutoNextPoint && chainMode) {
      setChainIndex((idx) => Math.min(idx + 1, Math.max(0, chainRoute.length - 1)));
    }

    toast('Результат сохранен (offline-first)', 'success');
  };

  const openCalls = (phone?: string, entry?: RadarEntry) => {
    if (!phone) return;
    window.open(`tel:${phone}`, '_self');
    if (entry) {
      pushNotification({
        type: NotificationType.RADAR_ACTION,
        title: `Звонок: ${entry.shop.name}`,
        message: 'Совершен звонок из Radar Live',
        orderId: entry.order.id,
        supplierId: entry.shop.id,
        phone,
        source: 'radar',
        severity: 'info'
      });
      createFollowupFromAction({
        orderId: entry.order.id,
        supplierId: entry.shop.id,
        phone,
        brand: entry.order.brand,
        carModel: entry.order.model,
        carYear: Number(entry.order.year) || undefined,
        route: `/orders/${entry.order.id}`,
        source: 'radar',
        minutes: 30
      });
    }
  };

  const pendingSync = interactions.filter((item) => !item.syncedAt).length;

  const toggleSelected = (shopId: string) => {
    setSelectedShopIds((prev) => {
      const next = new Set(prev);
      if (next.has(shopId)) next.delete(shopId);
      else next.add(shopId);
      return next;
    });
  };

  const contactSelectedShops = async () => {
    const selectedEntries = entries.filter((entry) => selectedShopIds.has(entry.shop.id));
    if (selectedEntries.length === 0) {
      toast('Выберите магазины для массового WhatsApp', 'error');
      return;
    }
    for (const entry of selectedEntries.slice(0, 20)) {
      const message = templateText(entry.order, templateLanguage, templateLength);
      const link = makeWhatsappLink(entry.shop.phone || '', message);
      if (!link) continue;
      window.open(link, '_blank');
      await addInteraction({ shopId: entry.shop.id, orderId: entry.order.id, partId: entry.order.parts[0]?.id, result: 'message_sent', comment: 'Bulk WhatsApp' });
    }
    toast(`Открыто WA чатов: ${Math.min(selectedEntries.length, 20)}`, 'success');
  };

  const syncNow = async () => {
    try {
      setSyncError(null);
      const unsynced = interactions.filter((item) => !item.syncedAt);
      for (const item of unsynced) await offlineDb.markRadarInteractionSynced(item.id);
      setInteractions((prev) => prev.map((item) => item.syncedAt ? item : { ...item, syncedAt: Date.now() }));
      toast('Очередь синхронизирована', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'sync failed';
      setSyncError(message);
      toast('Ошибка sync очереди', 'error');
    }
  };

  return (
    <div className="p-4 pb-20 space-y-3 bg-slate-950 min-h-full text-white">
      <section className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-sm font-black uppercase tracking-wider text-emerald-300">Radar Live</h1>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMode('field')} className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase ${mode === 'field' ? 'bg-emerald-400 text-slate-900' : 'border border-emerald-300/50 text-emerald-200'}`}>Field Mode</button>
            <button type="button" onClick={() => setMode('detail')} className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase ${mode === 'detail' ? 'bg-emerald-400 text-slate-900' : 'border border-emerald-300/50 text-emerald-200'}`}>Detail Mode</button>
          </div>
        </div>

        {activeOrder && (
          <div className="rounded-xl border border-emerald-200/20 bg-slate-900/40 p-2 text-[11px] text-emerald-100">
            <p className="font-black uppercase">Активный заказ: {activeOrder.brand} {activeOrder.model} {activeOrder.year}</p>
            <p className="text-emerald-100/80">Цель поиска: {activeOrder.parts.slice(0, 3).map((part) => part.name).join(', ') || 'детали не указаны'}</p>
          </div>
        )}

        <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Поиск: магазин / район / бренд" className="w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-white outline-none" />

        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-300/30 bg-slate-900/40 p-2">
          <p className="text-[11px] font-black uppercase text-emerald-200">UX mode</p>
          <div className="inline-flex rounded-lg border border-emerald-300/40 p-1">
            <button type="button" onClick={() => setUxMode('quick')} className={`h-9 min-w-[88px] rounded-md px-3 text-[10px] font-black uppercase ${uxMode === 'quick' ? 'bg-emerald-400 text-slate-900' : 'text-emerald-100'}`}>Quick</button>
            <button type="button" onClick={() => setUxMode('advanced')} className={`h-9 min-w-[88px] rounded-md px-3 text-[10px] font-black uppercase ${uxMode === 'advanced' ? 'bg-emerald-400 text-slate-900' : 'text-emerald-100'}`}>Advanced</button>
          </div>
        </div>

        <div className="space-y-1 text-[10px]">
          <p className="text-slate-400 uppercase font-black">A) Маршрут</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setChainMode((v) => !v)} className="inline-flex items-center gap-1 rounded-xl bg-emerald-400 px-3 py-2 font-black uppercase text-slate-950"><Navigation size={12} /> Chain Route</button>
            <button type="button" onClick={openChainRoute} className="rounded-xl border border-emerald-300/40 px-3 py-2 font-black uppercase text-emerald-100">Open route</button>
            <button type="button" onClick={resetDismissed} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-2 font-black uppercase text-slate-200"><RotateCcw size={12} /> Reset hidden</button>
            <button type="button" onClick={contactSelectedShops} className="rounded-xl border border-emerald-300/40 px-3 py-2 font-black uppercase text-emerald-100">Contact selected</button>
          </div>
        </div>

        <div className="space-y-1 text-[10px]">
          <p className="text-slate-400 uppercase font-black">B) Фильтры</p>
          <div className="flex flex-wrap gap-2">
            {uxMode === 'advanced' && (['all', 'new_only', 'used_only'] as RadarFilter[]).map((item) => (
              <button key={item} type="button" onClick={() => setActiveFilter(item)} className={`rounded-lg px-3 py-1 font-black uppercase ${activeFilter === item ? 'bg-slate-100 text-slate-900' : 'border border-slate-600 text-slate-300'}`}>{item}</button>
            ))}
            <button type="button" onClick={() => setOpenNowOnly((v) => !v)} className={`rounded-lg px-3 py-1 font-black uppercase ${openNowOnly ? 'bg-slate-100 text-slate-900' : 'border border-slate-600 text-slate-300'}`}>Open now</button>
            <button type="button" onClick={() => setBrandMatchMode((v) => (v === 'strict' ? 'soft' : 'strict'))} className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-1 font-black uppercase text-slate-300">Brand strict: {brandMatchMode}<HelpCircle size={11} title="Brand strict = показывать только точки с профилем нужного бренда" /></button>
            {uxMode === 'advanced' && <button type="button" onClick={() => setFallbackNearby((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 px-3 py-1 font-black uppercase text-amber-200"><Telescope size={11} /> fallback nearby<HelpCircle size={11} title="Fallback nearby = если мало совпадений, расширить подбор по типу" /></button>}
          </div>
        </div>

        <div className="space-y-1 text-[10px]">
          <p className="text-slate-400 uppercase font-black">C) Радиус</p>
          <div className="flex items-center flex-wrap gap-2">
            {RADIUS_STEPS.map((step) => (
              <button key={step} type="button" onClick={() => { setIsCustomRadius(false); setRadiusKm(step); }} className={`rounded px-2 py-1 font-black ${radiusKm === step ? 'bg-emerald-400 text-slate-900' : 'border border-slate-600 text-slate-300'}`}>{step} км</button>
            ))}
            <button type="button" onClick={() => { setIsCustomRadius(true); const parsed = Number(customRadiusKm); if (Number.isFinite(parsed) && parsed > 0) setRadiusKm(parsed); }} className={`rounded px-2 py-1 font-black ${isCustomRadius ? 'bg-emerald-400 text-slate-900' : 'border border-slate-600 text-slate-300'}`}>Custom</button>
            {isCustomRadius && <input value={customRadiusKm} onChange={(event) => { setCustomRadiusKm(event.target.value); const parsed = Number(event.target.value); if (Number.isFinite(parsed) && parsed > 0) setRadiusKm(parsed); }} className="w-16 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100" placeholder="км" />}
          </div>
        </div>

        {uxMode === 'advanced' && <div className="space-y-1 text-[10px]">
          <p className="text-slate-400 uppercase font-black">D) WA + язык</p>
          <div className="flex items-center flex-wrap gap-2">
            {(['ru', 'en', 'tj'] as TemplateLanguage[]).map((lang) => <button key={lang} type="button" onClick={() => setTemplateLanguage(lang)} className={`rounded border px-2 py-1 uppercase ${templateLanguage === lang ? 'border-emerald-300 text-emerald-200' : 'border-slate-600 text-slate-300'}`}>{lang}</button>)}
            <button type="button" onClick={() => setTemplateLength((v) => (v === 'short' ? 'full' : 'short'))} className="rounded border border-slate-600 px-2 py-1 text-slate-300 uppercase">{templateLength === 'short' ? 'Коротко' : 'Подробно'}</button>
          </div>
        </div>}

        <div className="flex items-center justify-between text-[11px] text-emerald-100/80">
          <p>Активных точек: {entries.length}. Очередь offline sync: {pendingSync > 0 ? `⏳ ${pendingSync}` : '0'}.</p>
          <button type="button" onClick={syncNow} className="rounded-lg border border-emerald-300/50 px-2 py-1 text-[10px] font-black uppercase text-emerald-200">Sync now</button>
        </div>
        {syncError && <p className="text-[10px] text-rose-200">Sync error: {syncError}</p>}
      </section>


      {chainMode && currentStop && (
        <section className="rounded-2xl border border-blue-400/30 bg-blue-500/10 p-3 space-y-2">
          <p className="text-xs font-black uppercase text-blue-200">Route sheet · прогресс {chainIndex + 1}/{chainRoute.length}</p>
          <p className="text-sm font-black">Текущая точка: {currentStop.name}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openShopRoute(currentStop)} className="rounded-xl bg-blue-400 px-3 py-2 text-[11px] font-black uppercase text-slate-900">Navigate</button>
            <button type="button" onClick={() => setChainIndex((i) => Math.min(i + 1, chainRoute.length - 1))} className="rounded-xl border border-blue-300/40 px-3 py-2 text-[11px] font-black uppercase text-blue-100">Next</button>
          </div>
          <div className="max-h-28 overflow-y-auto space-y-1">
            {chainRoute.map((shop, index) => (
              <button key={shop.id} type="button" onClick={() => setChainIndex(index)} className={`w-full text-left rounded-lg px-2 py-1 text-[10px] ${index === chainIndex ? 'bg-blue-500/30 text-blue-50' : 'bg-slate-900/40 text-blue-100/80'}`}>
                {index + 1}. {shop.name}
              </button>
            ))}
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
                <label className="inline-flex items-center gap-1 text-[10px] text-slate-300 mb-1">
                  <input type="checkbox" checked={selectedShopIds.has(entry.shop.id)} onChange={() => toggleSelected(entry.shop.id)} /> Add to route
                </label>
                <p className="text-sm font-black truncate">{entry.shop.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{entry.order.brand} {entry.order.model} {entry.order.year || ''}</p>
              </div>
              <div className="text-right">
                <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${recTone}`}>Рекомендация: {entry.recommendation}</span>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-2 text-[10px] text-slate-300">
              <span>{Number.isFinite(entry.distance) ? `${((entry.distance || 0) / 1000).toFixed(1)} км` : 'Distance n/a'}</span>
              <span>• ETA bike ~{Number.isFinite(entry.distance) ? Math.max(3, Math.round((entry.distance || 0) / 230)) : '?'} мин</span>
              <span>•</span>
              {entry.openNow === true ? <span className="text-emerald-300">Open now</span> : entry.openNow === false ? <span className="text-rose-300">Closed</span> : <span>hours unknown</span>}
              <span>•</span>
              <span>Score {Math.round(entry.score)}/100</span>
            </div>

            {mode === 'detail' && (
              <div className="rounded-xl bg-slate-800/70 p-2 text-[11px] text-slate-200 space-y-1">
                {entry.reasons.slice(0, 3).map((reason) => <p key={`${entry.shop.id}-${reason}`}>• {reason}</p>)}
                <p>Тип: {entry.shop.type || 'unknown'} · Зона: {entry.shop.zone || 'n/a'}</p>
                <p>Последние взаимодействия: {interactions.filter((item) => item.shopId === entry.shop.id).slice(0, 5).map((item) => item.result).join(', ') || 'нет'}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openShopRoute(entry.shop)} className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-black uppercase text-slate-950"><Navigation size={12} /> Маршрут</button>
              <button type="button" onClick={() => onWhatsApp(entry)} className="inline-flex items-center gap-1 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-200"><MessageCircle size={12} /> WhatsApp</button>
              <button type="button" onClick={() => openCalls(entry.shop.phone, entry)} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-2 text-[11px] font-black uppercase text-slate-200"><PhoneCall size={12} /> Call</button>
              <button type="button" onClick={() => hideShop(entry)} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-2 text-[11px] font-black uppercase text-slate-300"><EyeOff size={12} /> Hide</button>
              <button type="button" onClick={() => quickResult(entry, 'follow_up')} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-2 text-[11px] font-black uppercase text-slate-300"><MapPinned size={12} /> Я у магазина</button>
              {mode === 'detail' && <button type="button" onClick={() => navigate(`/order/${entry.order.id}`)} className="rounded-xl border border-slate-600 px-3 py-2 text-[11px] font-black uppercase text-slate-300">Карточка</button>}
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => quickResult(entry, 'found')} className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 px-2 py-1 text-[10px] font-black uppercase text-emerald-200"><CheckCircle2 size={11} /> Found</button>
              <button type="button" onClick={() => quickResult(entry, 'not_found')} className="inline-flex items-center gap-1 rounded-lg border border-rose-400/40 px-2 py-1 text-[10px] font-black uppercase text-rose-200"><XCircle size={11} /> Not found</button>
              <button type="button" onClick={() => quickResult(entry, 'follow_up')} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 px-2 py-1 text-[10px] font-black uppercase text-amber-200"><Clock3 size={11} /> Follow-up</button>
              <button type="button" onClick={() => quickResult(entry, 'wrong_info')} className="inline-flex items-center gap-1 rounded-lg border border-orange-400/40 px-2 py-1 text-[10px] font-black uppercase text-orange-200"><ShieldAlert size={11} /> Wrong info</button>
              {chainMode && <button type="button" onClick={() => setChainIndex((i) => Math.min(i + 1, chainRoute.length - 1))} className="inline-flex items-center gap-1 rounded-lg border border-blue-400/40 px-2 py-1 text-[10px] font-black uppercase text-blue-200">Next</button>}
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
