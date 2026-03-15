import React, { useMemo } from 'react';
import { Car, MapPin, Layers3, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { useAppSettings } from '../appSettings';
import { Priority } from '../types';

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
      // Count legacy single zone
      const zone = (order.zone || '').trim();
      if (zone) map.set(zone, (map.get(zone) || 0) + 1);
      // Count multi-zones array
      (order.zones || []).forEach((z) => {
        const trimmed = z.trim();
        if (!trimmed || trimmed === zone) return;
        map.set(trimmed, (map.get(trimmed) || 0) + 1);
      });
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

  const brandData = useMemo(() => {
    const map = new Map<string, { orders: number; urgent: number }>();
    activeOrders.forEach((o) => {
      const prev = map.get(o.brand) || { orders: 0, urgent: 0 };
      map.set(o.brand, {
        orders: prev.orders + 1,
        urgent: prev.urgent + (o.priority === Priority.HIGH ? 1 : 0),
      });
    });
    return Array.from(map.entries())
      .map(([brand, stats]) => ({ brand, ...stats }))
      .sort((a, b) => b.orders - a.orders);
  }, [activeOrders]);

  const hasPricedPart = (order: typeof orders[number]) => order.parts.some((part) => part.variants.length > 0);
  const hasOrderSuppliers = (order: typeof orders[number]) => (order.vendorContacts || []).length > 0;

  const statusData = useMemo(() => {
    const urgentList = activeOrders.filter((o) => o.priority === Priority.HIGH);
    const foundList = activeOrders.filter(hasPricedPart);
    const notFoundList = activeOrders.filter((o) => !hasPricedPart(o));
    const noSupplierList = activeOrders.filter((o) => !hasOrderSuppliers(o));
    const needSendList = activeOrders.filter((o) => {
      const contacts = o.vendorContacts || [];
      return contacts.length > 0 && contacts.some((c) => !c.lastWhatsappAt);
    });
    return [
      { key: '__urgent', title: '🔥 Срочные', count: urgentList.length, className: 'border-rose-500/40 bg-rose-900/25 hover:bg-rose-900/40' },
      { key: '__found_with_prices', title: '🟢 Есть варианты', count: foundList.length, className: 'border-emerald-600/40 bg-emerald-900/20 hover:bg-emerald-900/35' },
      { key: '__without_prices', title: '🟡 Нет вариантов', count: notFoundList.length, className: 'border-amber-500/40 bg-amber-900/20 hover:bg-amber-900/35' },
      { key: '__supplier_search', title: '👥 Нет поставщиков', count: noSupplierList.length, className: 'border-fuchsia-600/40 bg-fuchsia-900/20 hover:bg-fuchsia-900/35' },
      { key: '__need_send', title: '📤 Нужно отправить', count: needSendList.length, className: 'border-cyan-500/40 bg-cyan-900/20 hover:bg-cyan-900/35' },
    ];
  }, [activeOrders]);

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0B1220] text-white">
      <div className="mx-auto max-w-4xl px-3 py-4" style={{ paddingTop: 'max(1rem, calc(env(safe-area-inset-top) + 0.5rem))' }}>
        <div className="mb-4 rounded-2xl border border-slate-700/80 bg-slate-900/50 px-3 py-3">
          <p className="text-xl font-black">Vendor Slides</p>
          <p className="mt-1 text-xs text-white/70">Управление слайдами поставщиков</p>
        </div>

        {/* Status columns */}
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <Zap size={12} className="text-yellow-400" />
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Статусы</p>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {statusData.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(`/vendor/slider?brand=${encodeURIComponent(item.key)}`)}
                className={`rounded-xl border px-2 py-2 text-left transition-colors ${item.className}`}
              >
                <p className="text-xs font-black leading-snug">{item.title}</p>
                <p className="mt-0.5 text-[10px] text-white/50">{item.count} зак.</p>
              </button>
            ))}
          </div>
        </div>

        {/* Sharjah zones */}
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

        {/* Location zones */}
        <div className="mb-4">
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

        {/* Car makes / brands */}
        {brandData.length > 0 && (
          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2">
              <Car size={12} className="text-violet-400" />
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Марки авто</p>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {brandData.map(({ brand, orders: orderCount, urgent }) => (
                <button
                  key={brand}
                  type="button"
                  onClick={() => navigate(`/vendor/slider?brand=${encodeURIComponent(brand)}`)}
                  className="rounded-xl border border-violet-500/30 bg-violet-900/20 px-2 py-2 text-left transition-colors hover:bg-violet-900/40 active:bg-violet-900/60"
                >
                  <p className="text-xs font-black truncate" title={brand}>{brand}</p>
                  <p className="mt-0.5 text-[10px] text-white/50">{orderCount} зак.{urgent > 0 ? ` · 🔥${urgent}` : ''}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Open all slides button */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => navigate('/vendor/slider?brand=all')}
            className="w-full rounded-xl border border-blue-500/50 bg-blue-900/25 px-3 py-2 text-left transition-colors hover:bg-blue-900/45"
          >
            <span className="flex items-center gap-2 text-xs font-bold"><Layers3 size={14} /> Открыть все слайды</span>
            <span className="mt-1 block text-[11px] text-white/60">Показать все активные заказы</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default VendorSlidesScreen;
