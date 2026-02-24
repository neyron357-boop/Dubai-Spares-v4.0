import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { fetchRadarShops } from '../radarShops';
import {
  closeRadarSession,
  getRadarEvents,
  getRadarSession,
  getRadarTargets,
  logRadarEvent,
  RadarTargetRow,
  setRadarTargetStatus
} from '../radarSessionService';

const RadarSessionScreen: React.FC = () => {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { suppliers } = useStore();
  const [session, setSession] = useState<any>(null);
  const [targets, setTargets] = useState<RadarTargetRow[]>([]);
  const [shopsMap, setShopsMap] = useState<Record<string, any>>({});
  const [events, setEvents] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      const [sessionRow, targetRows, shops, eventRows] = await Promise.all([
        getRadarSession(sessionId),
        getRadarTargets(sessionId),
        fetchRadarShops(suppliers),
        getRadarEvents(sessionId)
      ]);
      setSession(sessionRow);
      setTargets(targetRows);
      setShopsMap(shops.reduce<Record<string, any>>((acc, shop) => {
        acc[shop.id] = shop;
        return acc;
      }, {}));
      setEvents(eventRows);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, suppliers]);

  useEffect(() => {
    void load();
  }, [load]);

  const targetsCount = targets.length;

  const changeStatus = async (target: RadarTargetRow, next: 'in_route' | 'at_shop' | 'done') => {
    const geoPayload = next === 'at_shop' && navigator.geolocation
      ? await new Promise<Record<string, unknown>>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => resolve({}),
            { timeout: 2000 }
          );
        })
      : {};

    await setRadarTargetStatus(target, next, geoPayload);
    await load();
  };

  const openTel = async (target: RadarTargetRow) => {
    const phone = shopsMap[target.shop_id]?.phone;
    if (!phone) return;
    window.open(`tel:${phone}`, '_blank');
    await logRadarEvent(sessionId, 'call', { targetId: target.id, shopId: target.shop_id });
    await load();
  };

  const openWa = async (target: RadarTargetRow) => {
    const phone = (shopsMap[target.shop_id]?.phone || '').replace(/[^\d]/g, '');
    if (!phone) return;
    window.open(`https://wa.me/${phone}`, '_blank');
    await logRadarEvent(sessionId, 'whatsapp', { targetId: target.id, shopId: target.shop_id });
    await load();
  };

  const markVisited = async (target: RadarTargetRow) => {
    await logRadarEvent(sessionId, 'visited', { targetId: target.id, shopId: target.shop_id });
    await load();
  };

  const handleCloseSession = async () => {
    await closeRadarSession(sessionId);
    await load();
  };

  const sortedTargets = useMemo(() => targets, [targets]);

  return (
    <div className="min-h-full bg-gray-50 p-4 pb-20 space-y-3">
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border border-gray-100 rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => navigate(-1)} className="p-2 rounded-full text-gray-600 hover:bg-gray-100"><ArrowLeft size={18} /></button>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700"><RefreshCw size={14} /> Refresh</button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-gray-400">Order ID:</span> <b>{session?.order_id || '—'}</b></div>
          <div><span className="text-gray-400">Targets:</span> <b>{targetsCount}</b></div>
          <div><span className="text-gray-400">Radius:</span> <b>{session?.radius_km ?? '—'} km</b></div>
          <div><span className="text-gray-400">Mode:</span> <b>{session?.mode || '—'}</b></div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void handleCloseSession()} className="flex-1 rounded-xl bg-gray-900 text-white text-xs font-black py-2">Завершить Radar</button>
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="rounded-xl border border-gray-200 bg-white px-3 text-xs font-black">🕘 История</button>
        </div>
      </div>

      {showHistory && (
        <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-2">
          {events.map((event) => (
            <div key={event.id} className="text-xs border-b border-gray-100 pb-1">
              <p className="font-bold">{event.event_type}</p>
              <p className="text-gray-500">{event.created_at ? new Date(event.created_at).toLocaleString() : '—'}</p>
            </div>
          ))}
          {!events.length && <p className="text-xs text-gray-500">Нет событий.</p>}
        </div>
      )}

      {isLoading && <p className="text-xs text-gray-500">Загрузка...</p>}

      <div className="space-y-2">
        {sortedTargets.map((target) => {
          const shop = shopsMap[target.shop_id];
          return (
            <div key={target.id} className="rounded-2xl bg-white border border-gray-100 p-3 space-y-2">
              <div className="flex justify-between gap-3">
                <div>
                  <p className="text-sm font-black">{shop?.name || target.shop_id}</p>
                  <p className="text-xs text-gray-500">Distance: {(target as any).distance_km ?? '—'} km · Score: {target.score ?? 0}</p>
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-700 font-bold">{target.status}</span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[11px] font-bold">
                <button type="button" onClick={() => void changeStatus(target, 'in_route')} className="rounded-lg bg-blue-50 text-blue-700 py-1">📍 In route</button>
                <button type="button" onClick={() => void changeStatus(target, 'at_shop')} className="rounded-lg bg-amber-50 text-amber-700 py-1">🏪 At shop</button>
                <button type="button" onClick={() => void changeStatus(target, 'done')} className="rounded-lg bg-emerald-50 text-emerald-700 py-1">✅ Done</button>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[11px] font-bold">
                <button type="button" onClick={() => void openTel(target)} className="rounded-lg border border-gray-200 py-1">📞 Call</button>
                <button type="button" onClick={() => void openWa(target)} className="rounded-lg border border-gray-200 py-1">💬 WhatsApp</button>
                <button type="button" onClick={() => void markVisited(target)} className="rounded-lg border border-gray-200 py-1">📍 Visited</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RadarSessionScreen;
