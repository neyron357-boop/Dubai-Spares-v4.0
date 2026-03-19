import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock3,
  Flag,
  Loader2,
  MapPin,
  Navigation,
  Plus,
  Radio,
  Square,
  TrendingDown,
  TrendingUp,
  X,
  XCircle
} from 'lucide-react';
import { useStore } from '../store';
import { HuntSessionStatus, HuntWaypointResult, HuntWaypointRow } from '../types';
import { deriveHuntSyncSnapshot } from '../huntSyncCoordinator';
import { getTrackingProjection, subscribeTrackingProjectionStore } from '../trackingProjectionStore';
import { installHuntProjectionDispatcher } from '../huntProjectionDispatcher';
import { createWaypoint, finishHunt, pauseHunt, resetHuntSession, resumeHunt, startHunt, syncGpsPing, triggerTrackingUpdate, updateHuntStatus } from '../huntDomain';
import {
  deleteHuntWaypoint,
  getActiveHuntSession,
  getHuntWaypoints
} from '../huntSessionApi';
import { toast, vibrate } from '../feedback';
import { uploadImageToStorage } from '../storage/photos';

const GPS_PING_MOVING_INTERVAL_MS = 20 * 1000;
const GPS_PING_IDLE_INTERVAL_MS = 60 * 1000;

const RESULT_LABELS: Record<HuntWaypointResult, string> = {
  found: 'Найдена',
  not_found: 'Не найдена',
  high_price: 'Цена высокая',
  visited: 'Посещено',
  defect: 'Дефект'
};

const RESULT_ICONS: Record<HuntWaypointResult, React.ReactNode> = {
  found: <CheckCircle2 size={16} className="text-emerald-500" />,
  not_found: <XCircle size={16} className="text-red-400" />,
  high_price: <TrendingUp size={16} className="text-amber-500" />,
  visited: <MapPin size={16} className="text-blue-400" />,
  defect: <AlertTriangle size={16} className="text-orange-500" />
};

const RESULT_COLORS: Record<HuntWaypointResult, string> = {
  found: 'bg-emerald-50 border-emerald-200',
  not_found: 'bg-red-50 border-red-200',
  high_price: 'bg-amber-50 border-amber-200',
  visited: 'bg-blue-50 border-blue-200',
  defect: 'bg-orange-50 border-orange-200'
};

interface WaypointFormState {
  shopName: string;
  result: HuntWaypointResult;
  priceAed: string;
  note: string;
  photos: string[]; // data URLs pending upload
  lat: number | null;
  lng: number | null;
  isUploading: boolean;
}

const DEFAULT_FORM: WaypointFormState = {
  shopName: '',
  result: 'visited',
  priceAed: '',
  note: '',
  photos: [],
  lat: null,
  lng: null,
  isUploading: false
};

const HuntModeScreen: React.FC = () => {
  const { orderId = '' } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { orders, updateOrder } = useStore();

  const order = orders.find((o) => o.id === orderId);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [waypoints, setWaypoints] = useState<HuntWaypointRow[]>([]);
  const [pendingWaypoints, setPendingWaypoints] = useState<Record<string, 'uploading' | 'projection_pending' | 'published_to_client' | 'failed'>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<WaypointFormState>(DEFAULT_FORM);
  const [isSavingWaypoint, setIsSavingWaypoint] = useState(false);
  const [currentPos, setCurrentPos] = useState<{ lat: number; lng: number } | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [actionPulse, setActionPulse] = useState<'start' | 'waypoint' | 'pause' | 'resume' | 'finish' | 'restart' | null>(null);

  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projection = useSyncExternalStore(subscribeTrackingProjectionStore, () => (orderId ? getTrackingProjection(orderId) : null), () => null);

  // ── Load existing active session ──────────────────────────────────────────

  useEffect(() => { installHuntProjectionDispatcher(); }, []);

  const loadSession = useCallback(async () => {
    if (!orderId) return;
    setIsLoadingSession(true);
    try {
      const session = await getActiveHuntSession(orderId);
      if (session) {
        setSessionId(session.id);
        const wps = await getHuntWaypoints(session.id);
        setWaypoints(wps);
      } else {
        setSessionId(null);
        setWaypoints([]);
      }
    } catch (err) {
      console.error('HuntModeScreen: failed to load session', err);
    } finally {
      setIsLoadingSession(false);
    }
  }, [orderId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // ── GPS helpers ────────────────────────────────────────────────────────────

  const getCurrentPosition = (): Promise<GeolocationPosition> =>
    new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000
    }));

  const pingGps = useCallback(async (sid: string) => {
    try {
      const pos = await getCurrentPosition();
      const { latitude, longitude, accuracy } = pos.coords;
      setCurrentPos({ lat: latitude, lng: longitude });
      const distanceFromPrevious = currentPos ? Math.hypot(latitude - currentPos.lat, longitude - currentPos.lng) : 1;
      await syncGpsPing(orderId, sid, latitude, longitude, accuracy);
      if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = setInterval(() => void pingGps(sid), distanceFromPrevious > 0.0008 ? GPS_PING_MOVING_INTERVAL_MS : GPS_PING_IDLE_INTERVAL_MS);
    } catch (err) {
      // Silently ignore GPS errors for UX (device may be indoors / permission denied)
      console.debug('GPS ping failed:', err);
    }
  }, [currentPos, orderId]);

  const startGpsInterval = useCallback((sid: string) => {
    if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current);
    void pingGps(sid);
    gpsIntervalRef.current = setInterval(() => void pingGps(sid), GPS_PING_MOVING_INTERVAL_MS);
  }, [pingGps]);

  const stopGpsInterval = useCallback(() => {
    if (gpsIntervalRef.current) {
      clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
  }, []);

  const sessionStatus: HuntSessionStatus = projection?.operator_presence_state === 'paused'
    ? 'paused'
    : order?.huntStatus === 'final_offer'
      ? 'completed'
      : sessionId
        ? 'active'
        : 'idle';

  useEffect(() => {
    if (sessionId && sessionStatus === 'active') {
      startGpsInterval(sessionId);
    } else {
      stopGpsInterval();
    }
    return stopGpsInterval;
  }, [sessionId, sessionStatus, startGpsInterval, stopGpsInterval]);

  // ── Session controls ───────────────────────────────────────────────────────

  const handleStartHunt = async () => {
    if (!order) return;
    setIsStarting(true);
    try {
      const session = await startHunt(orderId);
      setSessionId(session.id);
      setWaypoints([]);
      setPendingWaypoints({});
      setActionPulse('start');
      await updateHuntStatus(orderId, 'active');
      await triggerTrackingUpdate(orderId);
      await updateOrder({ ...order, huntStatus: 'live_hunt' });
      vibrate([50, 30, 80]);
      toast('Охота начата! GPS активирован.', 'success');
    } catch (err) {
      console.error('HuntModeScreen: failed to start hunt', err);
      toast('Не удалось начать охоту', 'error');
    } finally {
      setIsStarting(false);
    }
  };

  const handlePauseHunt = async () => {
    if (!order || !sessionId) return;
    setIsPausing(true);
    try {
      await pauseHunt(orderId, sessionId);
      await updateHuntStatus(orderId, 'paused');
      await triggerTrackingUpdate(orderId);
      await updateOrder({ ...order, huntStatus: 'live_hunt' });
      stopGpsInterval();
      setActionPulse('pause');
      toast('Охота поставлена на паузу. Клиент видит paused status.', 'success');
    } catch (err) {
      console.error('HuntModeScreen: failed to pause hunt', err);
      toast('Не удалось поставить охоту на паузу', 'error');
    } finally {
      setIsPausing(false);
    }
  };

  const handleResumeHunt = async () => {
    if (!order || !sessionId) return;
    setIsResuming(true);
    try {
      await resumeHunt(orderId, sessionId);
      await updateHuntStatus(orderId, 'active');
      await triggerTrackingUpdate(orderId);
      await updateOrder({ ...order, huntStatus: 'live_hunt' });
      startGpsInterval(sessionId);
      setActionPulse('resume');
      toast('Охота продолжена. Live-tracking снова активен.', 'success');
    } catch (err) {
      console.error('HuntModeScreen: failed to resume hunt', err);
      toast('Не удалось продолжить охоту', 'error');
    } finally {
      setIsResuming(false);
    }
  };

  const handleEndHunt = async () => {
    if (!order || !sessionId) return;
    setIsEnding(true);
    try {
      await finishHunt(orderId, sessionId);
      await updateHuntStatus(orderId, 'completed');
      await triggerTrackingUpdate(orderId);
      setActionPulse('finish');
      stopGpsInterval();
      setSessionId(null);
      await updateOrder({ ...order, huntStatus: 'final_offer' });
      toast('Охота завершена. Клиент видит финальное предложение.', 'success');
    } catch (err) {
      console.error('HuntModeScreen: failed to end hunt', err);
      toast('Не удалось завершить охоту', 'error');
    } finally {
      setIsEnding(false);
    }
  };



  const handleRestartHunt = async () => {
    if (!order) return;
    setIsStarting(true);
    try {
      await resetHuntSession(orderId);
      const session = await startHunt(orderId);
      await updateHuntStatus(orderId, 'active');
      await triggerTrackingUpdate(orderId);
      setSessionId(session.id);
      setWaypoints([]);
      setPendingWaypoints({});
      setActionPulse('restart');
      await updateOrder({ ...order, huntStatus: 'live_hunt' });
      toast('Охота начата заново. Клиент видит новую live-сессию.', 'success');
    } catch (err) {
      console.error('HuntModeScreen: failed to restart hunt', err);
      toast('Не удалось начать охоту заново', 'error');
    } finally {
      setIsStarting(false);
    }
  };

  // ── Waypoint form ──────────────────────────────────────────────────────────

  const openAddWaypoint = async () => {
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const pos = await getCurrentPosition();
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch { /* ignore */ }
    setForm({ ...DEFAULT_FORM, lat, lng });
    setShowAddForm(true);
  };

  const handlePhotoSelect = async (files: FileList | null) => {
    if (!files?.length) return;
    const dataUrls: string[] = [];
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });
      dataUrls.push(dataUrl);
    }
    setForm((prev) => ({ ...prev, photos: [...prev.photos, ...dataUrls] }));
  };

  const handleSaveWaypoint = async () => {
    if (!sessionId || !form.shopName.trim()) {
      toast('Введите название магазина', 'error');
      return;
    }
    setIsSavingWaypoint(true);
    setForm((prev) => ({ ...prev, isUploading: true }));
    const tempKey = `pending-${Date.now()}`;
    try {
      // Upload photos to Supabase Storage
      const uploadedUrls: string[] = [];
      for (let i = 0; i < form.photos.length; i++) {
        try {
          const url = await uploadImageToStorage(
            form.photos[i],
            `orders/${orderId}/hunt`,
            `wp_${Date.now()}_${i}`
          );
          if (url) uploadedUrls.push(url);
        } catch { /* skip failed photos */ }
      }

      setPendingWaypoints((prev) => ({ ...prev, [tempKey]: 'uploading' }));
      const waypoint = await createWaypoint({
        sessionId,
        orderId,
        shopName: form.shopName.trim(),
        result: form.result,
        priceAed: form.priceAed ? Number(form.priceAed) : null,
        note: form.note.trim() || null,
        photoUrls: uploadedUrls,
        lat: form.lat,
        lng: form.lng
      });

      setPendingWaypoints((prev) => ({ ...prev, [tempKey]: 'projection_pending' }));
      setPendingWaypoints((prev) => ({ ...prev, [tempKey]: 'published_to_client' }));
      setWaypoints((prev) => [...prev.filter((item) => item.id !== waypoint.id), waypoint]);
      setActionPulse('waypoint');
      setShowAddForm(false);
      setForm(DEFAULT_FORM);
      vibrate(30);
      toast('Точка добавлена и опубликована в tracking.', 'success');
    } catch (err) {
      console.error('HuntModeScreen: failed to save waypoint', err);
      setPendingWaypoints((prev) => ({ ...prev, [tempKey]: 'failed' }));
      toast('Не удалось сохранить точку', 'error');
    } finally {
      setIsSavingWaypoint(false);
    }
  };

  const handleDeleteWaypoint = async (id: string) => {
    try {
      await deleteHuntWaypoint(id);
      setWaypoints((prev) => prev.filter((wp) => wp.id !== id));
    } catch {
      toast('Не удалось удалить точку', 'error');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const isHunting = !!sessionId && sessionStatus !== 'completed';
  const effectiveWaypoints = projection?.waypoint_rows?.length ? projection.waypoint_rows : waypoints;
  const sync = deriveHuntSyncSnapshot(projection, Object.values(pendingWaypoints).filter((state) => state !== 'published_to_client').length);
  const sessionStatusLabel = sessionStatus === 'active'
    ? 'Активная охота'
    : sessionStatus === 'paused'
      ? 'Пауза'
      : sessionStatus === 'completed'
        ? 'Завершено'
        : 'Готов к старту';
  const sessionStatusHint = sessionStatus === 'active'
    ? `${sync.label} · Точек: ${effectiveWaypoints.length}`
    : sessionStatus === 'paused'
      ? 'Поиск на паузе. GPS остановлен, tracking показывает paused state.'
      : sessionStatus === 'completed'
        ? 'Поиск завершён. Можно начать новую hunt session без потери истории.'
        : 'Нажмите "Начать охоту" чтобы клиент видел вас на карте в реальном времени';
  const waypointDeliveryLabels = Object.entries(pendingWaypoints).map(([key, value]) => ({
    key,
    label: value === 'uploading'
      ? 'Точка сохраняется'
      : value === 'projection_pending'
        ? 'Точка сохранена, публикуем в tracking'
        : value === 'published_to_client'
          ? 'Точка опубликована в tracking'
          : 'Ошибка публикации точки'
  }));
  const lastWaypoint = effectiveWaypoints[effectiveWaypoints.length - 1] || null;
  const huntStats = useMemo(() => ({
    found: effectiveWaypoints.filter((wp) => wp.result === 'found').length,
    visited: effectiveWaypoints.length,
    withPhotos: effectiveWaypoints.filter((wp) => wp.photo_urls.length > 0).length
  }), [effectiveWaypoints]);

  useEffect(() => {
    if (!actionPulse) return undefined;
    const timeout = window.setTimeout(() => setActionPulse(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [actionPulse]);

  if (!order) {
    return (
      <div className="p-6 text-center text-gray-500">
        <p>Заказ не найден</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-blue-600 text-sm">← Назад</button>
      </div>
    );
  }

  if (isLoadingSession) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-gray-50 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 pt-safe">
        <div className="flex items-center gap-3 py-3">
          <button
            onClick={() => navigate(`/order/${orderId}`)}
            className="p-1.5 -ml-1.5 rounded-full hover:bg-gray-100"
            aria-label="Назад"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-gray-900 truncate">
              Режим охоты
            </h1>
            <p className="text-xs text-gray-500 truncate">
              {order.brand} {order.model} · {order.vin || 'без VIN'}
            </p>
          </div>
          {isHunting && currentPos && (
            <div className="flex items-center gap-1 px-2 py-1 bg-emerald-50 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-semibold text-emerald-700">GPS</span>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* Status card */}
        <div className={`rounded-3xl p-4 border shadow-sm transition-all duration-300 ${isHunting
          ? 'bg-gradient-to-br from-sky-50 via-white to-blue-100 border-blue-200 shadow-blue-100/70'
          : 'bg-gradient-to-br from-amber-50 via-white to-orange-50 border-amber-200'} ${actionPulse ? 'scale-[1.01] shadow-lg' : ''}`}
        >
          <div className="flex items-center gap-2 mb-1">
            {isHunting
              ? <Radio size={18} className="text-blue-600 animate-pulse" />
              : <Navigation size={18} className="text-amber-600" />}
            <span className={`text-sm font-bold ${sessionStatus === 'active' ? 'text-blue-800' : sessionStatus === 'paused' ? 'text-amber-800' : sessionStatus === 'completed' ? 'text-slate-800' : 'text-amber-800'}`}>
              {sessionStatusLabel}
            </span>
          </div>
          <p className={`text-xs ${sessionStatus === 'active' ? 'text-blue-600' : sessionStatus === 'paused' ? 'text-amber-600' : sessionStatus === 'completed' ? 'text-slate-600' : 'text-amber-600'}`}>
            {sessionStatusHint}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/80 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Точки</p>
              <p className="mt-1 text-lg font-black text-gray-900">{huntStats.visited}</p>
            </div>
            <div className="rounded-2xl bg-white/80 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Найдено</p>
              <p className="mt-1 text-lg font-black text-emerald-600">{huntStats.found}</p>
            </div>
            <div className="rounded-2xl bg-white/80 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Фото</p>
              <p className="mt-1 text-lg font-black text-blue-600">{huntStats.withPhotos}</p>
            </div>
          </div>
          <div className="mt-3 rounded-2xl border border-white/60 bg-white/70 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Sync state</p>
                <p className="text-sm font-semibold text-gray-900">{sync.label}</p>
                <p className="text-xs text-gray-500">{sync.detail}</p>
              </div>
              <div className="text-right text-[11px] text-gray-500">
                <div>Client: {sync.lastClientUpdateAt ? new Date(sync.lastClientUpdateAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                <div>Pending: {sync.pendingWaypoints}</div>
              </div>
            </div>
            {isHunting && currentPos && <p className="text-[10px] text-blue-400 mt-1">{currentPos.lat.toFixed(5)}, {currentPos.lng.toFixed(5)}</p>}
            {waypointDeliveryLabels.length > 0 && (
              <div className="mt-2 space-y-1">
                {waypointDeliveryLabels.slice(-3).map((item) => (
                  <p key={item.key} className="text-[10px] text-gray-600">{item.label}</p>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main action buttons */}
        {sessionStatus === 'idle' ? (
          <button
            onClick={handleStartHunt}
            disabled={isStarting}
            className={`group relative w-full overflow-hidden py-4 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed ${isStarting ? 'bg-blue-500 scale-[0.99]' : 'bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(14,116,214,0.35)] active:scale-[0.98]'}`}
          >
            <span className="absolute inset-0 opacity-0 transition-all duration-500 group-hover:opacity-100 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.24),transparent)] -translate-x-full group-hover:translate-x-full" />
            {isStarting ? <Loader2 size={20} className="animate-spin" /> : <Flag size={20} />}
            {isStarting ? 'Запускаем...' : 'Начать охоту'}
          </button>
        ) : sessionStatus === 'completed' ? (
          <button
            onClick={handleRestartHunt}
            disabled={isStarting}
            className="group relative w-full overflow-hidden py-4 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed bg-gradient-to-r from-slate-700 via-slate-600 to-slate-500 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
          >
            {isStarting ? <Loader2 size={20} className="animate-spin" /> : <Flag size={20} />}
            {isStarting ? 'Запускаем...' : 'Начать заново'}
          </button>
        ) : sessionStatus === 'active' ? (
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={openAddWaypoint}
              className={`flex-1 py-3.5 rounded-2xl text-white font-semibold text-sm flex items-center justify-center gap-2 shadow transition-all duration-300 ${actionPulse === 'waypoint' ? 'bg-emerald-500 scale-[1.02] shadow-emerald-200' : 'bg-gradient-to-r from-blue-600 to-sky-500 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]'}`}
            >
              <Plus size={18} />
              Добавить точку
            </button>
            <button
              onClick={handlePauseHunt}
              disabled={isPausing}
              className="flex-1 py-3.5 rounded-2xl bg-amber-500 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow transition-all duration-300 disabled:opacity-60"
            >
              {isPausing ? <Loader2 size={18} className="animate-spin" /> : <Clock3 size={18} />}
              {isPausing ? 'Ставим на паузу...' : 'Пауза'}
            </button>
            <button
              onClick={handleEndHunt}
              disabled={isEnding}
              className={`flex-1 py-3.5 rounded-2xl text-white font-semibold text-sm flex items-center justify-center gap-2 shadow transition-all duration-300 disabled:opacity-60 ${isEnding ? 'bg-rose-400 scale-[0.99]' : actionPulse === 'finish' ? 'bg-amber-500 scale-[1.01]' : 'bg-gradient-to-r from-rose-500 to-red-500 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]'}`}
            >
              {isEnding ? <Loader2 size={18} className="animate-spin" /> : <Square size={18} />}
              {isEnding ? 'Завершаем...' : 'Завершить'}
            </button>
          </div>
        ) : (
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={handleResumeHunt}
              disabled={isResuming}
              className="flex-1 py-3.5 rounded-2xl bg-emerald-600 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow transition-all duration-300 disabled:opacity-60"
            >
              {isResuming ? <Loader2 size={18} className="animate-spin" /> : <Radio size={18} />}
              {isResuming ? 'Возобновляем...' : 'Продолжить'}
            </button>
            <button
              onClick={handleEndHunt}
              disabled={isEnding}
              className={`flex-1 py-3.5 rounded-2xl text-white font-semibold text-sm flex items-center justify-center gap-2 shadow transition-all duration-300 disabled:opacity-60 ${isEnding ? 'bg-rose-400 scale-[0.99]' : actionPulse === 'finish' ? 'bg-amber-500 scale-[1.01]' : 'bg-gradient-to-r from-rose-500 to-red-500 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]'}`}
            >
              {isEnding ? <Loader2 size={18} className="animate-spin" /> : <Square size={18} />}
              {isEnding ? 'Завершаем...' : 'Завершить'}
            </button>
          </div>
        )}

        {/* How it works (when not hunting) */}
        {sessionStatus === 'idle' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Как это работает</p>
            {[
              { icon: '🛵', text: 'Нажми "Начать охоту" перед выездом' },
              { icon: '📍', text: 'GPS отправляется каждые 30 сек — клиент видит тебя на карте' },
              { icon: '📸', text: 'На каждой разборке делай фото и добавляй точку' },
              { icon: '🏆', text: 'Нажми "Завершить" — клиент получит смету + историю поиска' }
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-start gap-2.5">
                <span className="text-base leading-tight">{icon}</span>
                <p className="text-xs text-gray-600 leading-snug">{text}</p>
              </div>
            ))}
          </div>
        )}

        {/* Waypoints list */}
        {effectiveWaypoints.length > 0 && (
          <div className="space-y-2">
            {lastWaypoint && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">Последнее обновление</p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-emerald-950 truncate">{lastWaypoint.shop_name}</p>
                    <p className="text-xs text-emerald-700">{RESULT_LABELS[lastWaypoint.result]} · {new Date(lastWaypoint.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm">
                    {RESULT_ICONS[lastWaypoint.result]}
                  </div>
                </div>
              </div>
            )}
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide px-1">
              Операционная timeline ({effectiveWaypoints.length})
            </p>
            {effectiveWaypoints.map((wp, idx) => (
              <div
                key={wp.id}
                className={`rounded-xl border p-3 ${RESULT_COLORS[wp.result]} relative`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-[10px] font-bold text-gray-400 w-5 shrink-0 text-right">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {RESULT_ICONS[wp.result]}
                      <span className="text-sm font-semibold text-gray-800 truncate">
                        {wp.shop_name}
                      </span>
                      <span className="text-[10px] font-medium text-gray-500">
                        {RESULT_LABELS[wp.result]}
                      </span>
                    </div>
                    {wp.price_aed != null && (
                      <p className="text-xs text-gray-600 mt-0.5">
                        💰 {wp.price_aed} AED
                      </p>
                    )}
                    {wp.note && (
                      <p className="text-xs text-gray-500 mt-0.5 italic">{wp.note}</p>
                    )}
                    {wp.photo_urls.length > 0 && (
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {wp.photo_urls.map((url) => (
                          <img
                            key={url}
                            src={url}
                            alt="фото"
                            className="w-12 h-12 object-cover rounded-lg border border-white shadow-sm"
                          />
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1 mt-1">
                      <Clock3 size={10} className="text-gray-400" />
                      <span className="text-[10px] text-gray-400">
                        {new Date(wp.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {wp.lat != null && wp.lng != null && (
                        <a
                          href={`https://maps.google.com/?q=${wp.lat},${wp.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1 text-[10px] text-blue-500 underline"
                        >
                          карта
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleDeleteWaypoint(wp.id)}
                    className="p-1 rounded-full hover:bg-white/60 text-gray-400"
                    aria-label="Удалить"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add waypoint bottom sheet */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-t-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">Добавить точку</h2>
              <button
                onClick={() => setShowAddForm(false)}
                className="p-1.5 rounded-full hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            {/* Shop name */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Название магазина / разборки *
              </label>
              <input
                type="text"
                value={form.shopName}
                onChange={(e) => setForm((p) => ({ ...p, shopName: e.target.value }))}
                placeholder="Например: Al-Sajaa Auto Parts"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Result */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">Результат</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(RESULT_LABELS) as HuntWaypointResult[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, result: r }))}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors
                      ${form.result === r
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-white text-gray-600'}`}
                  >
                    {RESULT_ICONS[r]}
                    {RESULT_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>

            {/* Price */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Цена (AED) — необязательно
              </label>
              <div className="relative">
                <TrendingDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="number"
                  inputMode="decimal"
                  value={form.priceAed}
                  onChange={(e) => setForm((p) => ({ ...p, priceAed: e.target.value }))}
                  placeholder="0"
                  className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Note */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Заметка — необязательно
              </label>
              <textarea
                value={form.note}
                onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                placeholder="Состояние детали, особенности..."
                rows={2}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Photos */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Фото</label>
              <div className="flex gap-2 flex-wrap">
                {form.photos.map((url, idx) => (
                  <div key={idx} className="relative">
                    <img
                      src={url}
                      alt={`фото ${idx + 1}`}
                      className="w-16 h-16 object-cover rounded-xl border border-gray-200"
                    />
                    <button
                      onClick={() => setForm((p) => ({ ...p, photos: p.photos.filter((_, i) => i !== idx) }))}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
                >
                  <Camera size={22} />
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                className="hidden"
                onChange={(e) => void handlePhotoSelect(e.target.files)}
              />
            </div>

            <button
              onClick={handleSaveWaypoint}
              disabled={isSavingWaypoint || !form.shopName.trim()}
              className="w-full py-3.5 rounded-2xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 active:scale-95 transition-transform"
            >
              {isSavingWaypoint
                ? <Loader2 size={18} className="animate-spin" />
                : <MapPin size={18} />}
              {isSavingWaypoint ? 'Сохраняем...' : 'Добавить точку'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HuntModeScreen;
