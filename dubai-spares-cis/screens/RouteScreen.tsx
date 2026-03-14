import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckSquare, Square } from 'lucide-react';
import { useStore } from '../store';

const ZONE_LABELS: Record<string, string> = {
  Area2: 'Area 2', Area3: 'Area 3', Area4: 'Area 4',
  Area6: 'Area 6', Area8: 'Area 8', Dubai: 'Dubai', Online: 'Online',
};

const RouteScreen: React.FC = () => {
  const { zone } = useParams<{ zone: string }>();
  const navigate = useNavigate();
  const { orders } = useStore();
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const zoneOrders = useMemo(() =>
    orders.filter((o) => !o.isArchived && !o.isSold && o.locationZone === zone),
    [orders, zone]
  );

  // Group by supplier/vendor
  const grouped = useMemo(() => {
    const map: Record<string, typeof zoneOrders> = {};
    zoneOrders.forEach((o) => {
      const supplierName = o.vendorContacts?.[0]?.name || 'Без поставщика';
      if (!map[supplierName]) map[supplierName] = [];
      map[supplierName].push(o);
    });
    return Object.entries(map);
  }, [zoneOrders]);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const markAllDone = () => {
    setChecked(new Set(zoneOrders.map((o) => o.id)));
  };

  const getActionLabel = (o: typeof zoneOrders[0]) => {
    if (o.paidStatus === 'paid') return 'Забрать (оплачено)';
    if (o.salesStatus === 'Price Sent') return 'Спросить цену';
    if (o.parts.some((p) => p.isFound)) return 'Деталь найдена';
    return 'Найти и сфоткать';
  };

  const zoneLabel = ZONE_LABELS[zone || ''] || zone;

  return (
    <div className="min-h-full bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-3 py-3 flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} className="p-1.5 -ml-1 rounded-lg text-gray-500">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-black">🗺 {zoneLabel}</h1>
          <p className="text-xs text-gray-500">{zoneOrders.length} задач · {checked.size} выполнено</p>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {grouped.map(([supplierName, supplierOrders]) => (
          <div key={supplierName} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-black text-gray-600">{supplierName}</p>
            </div>
            {supplierOrders.map((o) => {
              const done = checked.has(o.id);
              return (
                <div key={o.id} className={`flex items-start gap-3 px-3 py-3 border-t border-gray-100 ${done ? 'opacity-50' : ''}`}>
                  <button
                    type="button"
                    onClick={() => toggle(o.id)}
                    className="shrink-0 mt-0.5 text-blue-400"
                  >
                    {done ? <CheckSquare size={20} /> : <Square size={20} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/order/${o.id}`)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-sm font-bold text-gray-800 truncate">
                      {o.parts[0]?.name || 'Деталь'} — {o.brand} {o.model}
                    </p>
                    <p className="text-xs text-blue-600 mt-0.5">{getActionLabel(o)}</p>
                    {o.clientName && <p className="text-[10px] text-gray-400 mt-0.5">{o.clientName}</p>}
                  </button>
                </div>
              );
            })}
          </div>
        ))}

        {zoneOrders.length === 0 && (
          <div className="text-center py-10 text-gray-400">
            <p className="text-sm">Нет задач в этой зоне</p>
          </div>
        )}

        {zoneOrders.length > 0 && (
          <button
            type="button"
            onClick={markAllDone}
            className="w-full h-11 rounded-xl bg-blue-600 text-white text-sm font-black"
          >
            ✓ Отметить все выполненными в {zoneLabel}
          </button>
        )}
      </div>
    </div>
  );
};

export default RouteScreen;
