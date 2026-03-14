import React, { useMemo, useState } from 'react';
import { MapPin, Users, Layers3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { useAppSettings } from '../appSettings';

const SHARJAH_ZONES = ['Zone 2', 'Zone 3', 'Zone 4', 'Zone 6', 'Zone 7', 'Zone 8'];
const LOCATION_ZONES = ['Ajman', 'Sajah', 'Dubai'];

const VendorSlidesScreen: React.FC = () => {
  const navigate = useNavigate();
  const { orders, suppliers } = useStore();
  const { settings } = useAppSettings();
  const [zoneModalZone, setZoneModalZone] = useState<string | null>(null);

  const availableZones = useMemo(() => settings.orderZones || [], [settings.orderZones]);

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0B1220] text-white">
      <div className="mx-auto max-w-4xl px-3 py-4">
        <div className="mb-4 rounded-2xl border border-slate-700/80 bg-slate-900/50 px-3 py-3">
          <p className="text-xl font-black">Vendor Slides</p>
          <p className="mt-1 text-xs text-white/70">Единый раздел управления поставщиками и заказами</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => navigate('/vendor/slider')}
              className="rounded-xl border border-blue-500/50 bg-blue-900/25 px-3 py-2 text-left transition-colors hover:bg-blue-900/45"
            >
              <span className="flex items-center gap-2 text-xs font-bold"><Layers3 size={14} /> Слайды поставщиков</span>
              <span className="mt-1 block text-[11px] text-white/60">Работа с карточками заказов</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/database')}
              className="rounded-xl border border-emerald-500/50 bg-emerald-900/25 px-3 py-2 text-left transition-colors hover:bg-emerald-900/45"
            >
              <span className="flex items-center gap-2 text-xs font-bold"><Users size={14} /> Управление поставщиками</span>
              <span className="mt-1 block text-[11px] text-white/60">{suppliers.length} поставщиков в базе</span>
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
              const count = orders.filter((o) => (o.zone || '') === zone).length;
              return (
                <button
                  key={zone}
                  type="button"
                  onClick={() => setZoneModalZone(zone)}
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
              const count = orders.filter((o) => (o.zone || '') === zone).length;
              return (
                <button
                  key={zone}
                  type="button"
                  onClick={() => setZoneModalZone(zone)}
                  className="rounded-xl border border-sky-500/30 bg-sky-900/20 px-2 py-2 text-left transition-colors hover:bg-sky-900/40 active:bg-sky-900/60"
                >
                  <p className="text-xs font-black">{zone}</p>
                  <p className="mt-0.5 text-[10px] text-white/50">{count} зак.</p>
                </button>
              );
            })}
            {availableZones
              .filter((z) => !SHARJAH_ZONES.includes(z) && !LOCATION_ZONES.includes(z))
              .map((zone) => {
                const count = orders.filter((o) => (o.zone || '') === zone).length;
                return (
                  <button
                    key={zone}
                    type="button"
                    onClick={() => setZoneModalZone(zone)}
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

      {zoneModalZone && (
        <div className="fixed inset-0 z-20 bg-black/70 p-4" onClick={() => setZoneModalZone(null)}>
          <div className="mx-auto mt-6 max-w-3xl rounded-3xl border border-slate-700 bg-[#111a2d] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-base font-black">{zoneModalZone}</p>
                <p className="text-xs text-white/60">Заказы в этой зоне</p>
              </div>
              <button type="button" onClick={() => setZoneModalZone(null)} className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold">Закрыть</button>
            </div>
            {(() => {
              const zoneOrders = orders.filter((o) => (o.zone || '') === zoneModalZone).sort((a, b) => b.createdAt - a.createdAt);
              if (zoneOrders.length === 0) {
                return <p className="rounded-xl border border-dashed border-slate-600 bg-slate-900/40 px-3 py-4 text-sm text-white/70">Нет заказов в этой зоне.</p>;
              }
              return (
                <div className="max-h-[65vh] overflow-y-auto space-y-2 pr-1">
                  {zoneOrders.map((order) => (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => {
                        setZoneModalZone(null);
                        navigate(`/order/${order.id}`);
                      }}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-left hover:bg-slate-800/70"
                    >
                      <p className="text-sm font-black">#{order.id.slice(0, 6)} · {order.brand} {order.model}</p>
                      <p className="text-xs text-white/60">{order.parts.length} дет. · {new Date(order.createdAt).toLocaleDateString()}</p>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorSlidesScreen;
