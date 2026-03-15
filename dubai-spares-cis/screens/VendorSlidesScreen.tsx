import React, { useMemo } from 'react';
import { MapPin, Layers3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { useAppSettings } from '../appSettings';

const SHARJAH_ZONES = ['Zone 2', 'Zone 3', 'Zone 4', 'Zone 6', 'Zone 7', 'Zone 8'];
const LOCATION_ZONES = ['Ajman', 'Sajah', 'Dubai'];
const normalizeZone = (zone?: string) => (zone || '').trim().toLowerCase();

const VendorSlidesScreen: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();
  const { settings } = useAppSettings();

  const activeOrders = useMemo(
    () => orders.filter((order) => !order.isArchived && !order.isSold),
    [orders]
  );

  const zoneCounts = useMemo(() => {
    const map = new Map<string, number>();
    activeOrders.forEach((order) => {
      const zone = (order.zone || '').trim();
      if (!zone) return;
      map.set(zone, (map.get(zone) || 0) + 1);
    });
    return map;
  }, [activeOrders]);

  const availableZones = useMemo(() => {
    const mergedZones = [...SHARJAH_ZONES, ...LOCATION_ZONES, ...(settings.orderZones || [])]
      .map((zone) => zone.trim())
      .filter(Boolean);

    const deduped = new Map<string, string>();
    mergedZones.forEach((zone) => {
      const key = normalizeZone(zone);
      if (!deduped.has(key)) deduped.set(key, zone);
    });

    return Array.from(deduped.values());
  }, [settings.orderZones]);

  const getZoneCount = (zone: string) => {
    const key = normalizeZone(zone);
    let count = 0;
    zoneCounts.forEach((zoneCount, zoneName) => {
      if (normalizeZone(zoneName) === key) count += zoneCount;
    });
    return count;
  };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0B1220] text-white">
      <div className="mx-auto max-w-4xl px-3 py-4">
        <div className="mb-4 rounded-2xl border border-slate-700/80 bg-slate-900/50 px-3 py-3">
          <p className="text-xl font-black">Vendor Slides</p>
          <p className="mt-1 text-xs text-white/70">Раздел слайдов заказов</p>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => navigate('/vendor/slider')}
              className="rounded-xl border border-blue-500/50 bg-blue-900/25 px-3 py-2 text-left transition-colors hover:bg-blue-900/45"
            >
              <span className="flex items-center gap-2 text-xs font-bold"><Layers3 size={14} /> Открыть слайды заказов</span>
              <span className="mt-1 block text-[11px] text-white/60">Переход в режим карточек</span>
            </button>
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <MapPin size={12} className="text-emerald-400" />
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Sharjah · Зоны</p>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {SHARJAH_ZONES.map((zone) => {
              const count = getZoneCount(zone);
              return (
                <button
                  key={zone}
                  type="button"
                  onClick={() => navigate(`/vendor/slider?zone=${encodeURIComponent(zone)}`)}
                  className="rounded-xl border border-emerald-500/30 bg-emerald-900/20 px-2 py-2 text-left transition-colors hover:bg-emerald-900/40 active:bg-emerald-900/60"
                >
                  <p className="text-xs font-black">{zone}</p>
                  <p className="mt-0.5 text-[10px] text-white/50">{count} зак.</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-5">
          <div className="mb-2 flex items-center gap-2">
            <MapPin size={12} className="text-sky-400" />
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Локации</p>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {LOCATION_ZONES.map((zone) => {
              const count = getZoneCount(zone);
              return (
                <button
                  key={zone}
                  type="button"
                  onClick={() => navigate(`/vendor/slider?zone=${encodeURIComponent(zone)}`)}
                  className="rounded-xl border border-sky-500/30 bg-sky-900/20 px-2 py-2 text-left transition-colors hover:bg-sky-900/40 active:bg-sky-900/60"
                >
                  <p className="text-xs font-black">{zone}</p>
                  <p className="mt-0.5 text-[10px] text-white/50">{count} зак.</p>
                </button>
              );
            })}
            {availableZones
              .filter((z) => !SHARJAH_ZONES.some((base) => normalizeZone(base) === normalizeZone(z))
                && !LOCATION_ZONES.some((base) => normalizeZone(base) === normalizeZone(z)))
              .map((zone) => {
                const count = getZoneCount(zone);
                return (
                  <button
                    key={zone}
                    type="button"
                    onClick={() => navigate(`/vendor/slider?zone=${encodeURIComponent(zone)}`)}
                    className="rounded-xl border border-slate-500/30 bg-slate-800/40 px-2 py-2 text-left transition-colors hover:bg-slate-700/40"
                  >
                    <p className="text-xs font-black">{zone}</p>
                    <p className="mt-0.5 text-[10px] text-white/50">{count} зак.</p>
                  </button>
                );
              })}
          </div>
        </div>
      </div>

    </div>
  );
};

export default VendorSlidesScreen;
