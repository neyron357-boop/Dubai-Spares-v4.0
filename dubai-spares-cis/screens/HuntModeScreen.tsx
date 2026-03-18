import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
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
import { HuntWaypointResult, HuntWaypointRow } from '../types';
import {
  addHuntWaypoint,
  createHuntSession,
  deleteHuntWaypoint,
  endHuntSession,
  getActiveHuntSession,
  getHuntWaypoints,
  sendGpsPing
} from '../huntSessionApi';
import { toast, vibrate } from '../feedback';
import { uploadImageToStorage } from '../storage/photos';

// GPS ping interval: every 2 minutes
const GPS_PING_INTERVAL_MS = 2 * 60 * 1000;

const RESULT_LABELS: Record<HuntWaypointResult, string> = {
  found: 'Найдена',
  not_found: 'Не найдена',
  high_price: 'Цена высокая',
  visited: 'Посещено'
};

const RESULT_ICONS: Record<HuntWaypointResult, React.ReactNode> = {
  found: <CheckCircle2 size={16} className="text-emerald-500" />,
  not_found: <XCircle size={16} className="text-red-400" />,
  high_price: <TrendingUp size={16} className="text-amber-500" />,
  visited: <MapPin size={16} className="text-blue-400" />
};

const RESULT_COLORS: Record<HuntWaypointResult, string> = {
  found: 'bg-emerald-50 border-emerald-200',
  not_found: 'bg-red-50 border-red-200',
  high_price: 'bg-amber-50 border-amber-200',
  visited: 'bg-blue-50 border-blue-200'
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
  const [waypoints, setWaypoints] = useState<HuntWaypointRow[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<WaypointFormState>(DEFAULT_FORM);
  const [isSavingWaypoint, setIsSavingWaypoint] = useState(false);
  const [currentPos, setCurrentPos] = useState<{ lat: number; lng: number } | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load existing active session ──────────────────────────────────────────

  const loadSession = useCallback(async () => {
    if (!orderId) return;
    setIsLoadingSession(true);
    try {
      const session = await getActiveHuntSession(orderId);
      if (session) {
        setSessionId(session.id);
        const wps = await getHuntWaypoints(session.id);
        setWaypoints(wps);
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
      await sendGpsPing(sid, latitude, longitude, accuracy);
    } catch {
      // Silently ignore GPS errors (device may be indoors)
    }
  }, []);

  const startGpsInterval = useCallback((sid: string) => {
    if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current);
    void pingGps(sid); // immediate first ping
    gpsIntervalRef.current = setInterval(() => void pingGps(sid), GPS_PING_INTERVAL_MS);
  }, [pingGps]);

  const stopGpsInterval = useCallback(() => {
    if (gpsIntervalRef.current) {
      clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (sessionId) startGpsInterval(sessionId);
    return stopGpsInterval;
  }, [sessionId, startGpsInterval, stopGpsInterval]);

  // ── Session controls ───────────────────────────────────────────────────────

  const handleStartHunt = async () => {
    if (!order) return;
    setIsStarting(true);
    try {
      const session = await createHuntSession(orderId);
      setSessionId(session.id);
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

  const handleEndHunt = async () => {
    if (!order || !sessionId) return;
    setIsEnding(true);
    try {
      await endHuntSession(sessionId);
      stopGpsInterval();
      await updateOrder({ ...order, huntStatus: 'final_offer' });
      toast('Охота завершена. Клиент видит финальное предложение.', 'success');
      navigate(`/order/${orderId}`);
    } catch (err) {
      console.error('HuntModeScreen: failed to end hunt', err);
      toast('Не удалось завершить охоту', 'error');
    } finally {
      setIsEnding(false);
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

      const waypoint = await addHuntWaypoint({
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

      setWaypoints((prev) => [...prev, waypoint]);
      setShowAddForm(false);
      setForm(DEFAULT_FORM);
      vibrate(30);
      toast('Точка добавлена!', 'success');
    } catch (err) {
      console.error('HuntModeScreen: failed to save waypoint', err);
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

  const isHunting = !!sessionId;

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
        <div className={`rounded-2xl p-4 border ${isHunting
          ? 'bg-blue-50 border-blue-200'
          : 'bg-amber-50 border-amber-200'}`}
        >
          <div className="flex items-center gap-2 mb-1">
            {isHunting
              ? <Radio size={18} className="text-blue-600 animate-pulse" />
              : <Navigation size={18} className="text-amber-600" />}
            <span className={`text-sm font-bold ${isHunting ? 'text-blue-800' : 'text-amber-800'}`}>
              {isHunting ? 'Активная охота' : 'Готов к старту'}
            </span>
          </div>
          <p className={`text-xs ${isHunting ? 'text-blue-600' : 'text-amber-600'}`}>
            {isHunting
              ? `GPS обновляется каждые 2 мин · Добавлено точек: ${waypoints.length}`
              : 'Нажмите "Начать охоту" чтобы клиент видел вас на карте в реальном времени'}
          </p>
          {isHunting && currentPos && (
            <p className="text-[10px] text-blue-400 mt-1">
              {currentPos.lat.toFixed(5)}, {currentPos.lng.toFixed(5)}
            </p>
          )}
        </div>

        {/* Main action buttons */}
        {!isHunting ? (
          <button
            onClick={handleStartHunt}
            disabled={isStarting}
            className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform disabled:opacity-60"
          >
            {isStarting ? <Loader2 size={20} className="animate-spin" /> : <Flag size={20} />}
            {isStarting ? 'Запускаем...' : 'Начать охоту'}
          </button>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={openAddWaypoint}
              className="flex-1 py-3.5 rounded-2xl bg-blue-600 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow active:scale-95 transition-transform"
            >
              <Plus size={18} />
              Добавить точку
            </button>
            <button
              onClick={handleEndHunt}
              disabled={isEnding}
              className="flex-1 py-3.5 rounded-2xl bg-rose-500 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow active:scale-95 transition-transform disabled:opacity-60"
            >
              {isEnding ? <Loader2 size={18} className="animate-spin" /> : <Square size={18} />}
              {isEnding ? 'Завершаем...' : 'Завершить'}
            </button>
          </div>
        )}

        {/* How it works (when not hunting) */}
        {!isHunting && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Как это работает</p>
            {[
              { icon: '🛵', text: 'Нажми "Начать охоту" перед выездом' },
              { icon: '📍', text: 'GPS отправляется каждые 2 мин — клиент видит тебя на карте' },
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
        {waypoints.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide px-1">
              История посещений ({waypoints.length})
            </p>
            {waypoints.map((wp, idx) => (
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
