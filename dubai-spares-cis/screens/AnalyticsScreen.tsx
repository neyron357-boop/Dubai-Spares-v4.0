import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, TrendingUp } from 'lucide-react';
import { useStore } from '../store';

type Period = 'week' | 'month';

const AnalyticsScreen: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();
  const [period, setPeriod] = useState<Period>('week');

  const now = Date.now();
  const cutoff = period === 'week' ? now - 7 * 86400000 : now - 30 * 86400000;

  const stats = useMemo(() => {
    const periodOrders = orders.filter((o) => (o.updatedAt || o.createdAt) >= cutoff);
    const soldOrders = periodOrders.filter((o) => o.isSold);
    const leads = periodOrders.filter((o) => o.isLead);
    const conversions = leads.length > 0 ? Math.round((soldOrders.length / leads.length) * 100) : 0;

    const totalProfit = soldOrders.reduce((sum, o) => {
      return sum + Math.max(0, (o.clientPriceAed || 0) - (o.purchasePriceAed || 0));
    }, 0);

    const avgMarkup = soldOrders.length > 0
      ? soldOrders.reduce((sum, o) => {
          if (!o.purchasePriceAed || !o.clientPriceAed) return sum;
          return sum + ((o.clientPriceAed - o.purchasePriceAed) / o.purchasePriceAed) * 100;
        }, 0) / soldOrders.length
      : 0;

    // Zone activity
    const zoneMap: Record<string, number> = {};
    periodOrders.forEach((o) => {
      if (!o.locationZone) return;
      zoneMap[o.locationZone] = (zoneMap[o.locationZone] || 0) + 1;
    });

    // Daily earnings for last 7 days
    const daily: { label: string; profit: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = now - i * 86400000;
      const dayEnd = dayStart + 86400000;
      const d = new Date(dayStart);
      const label = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' });
      const profit = orders
        .filter((o) => o.isSold && (o.updatedAt || o.createdAt) >= dayStart && (o.updatedAt || o.createdAt) < dayEnd)
        .reduce((sum, o) => sum + Math.max(0, (o.clientPriceAed || 0) - (o.purchasePriceAed || 0)), 0);
      daily.push({ label, profit });
    }

    const maxDaily = Math.max(...daily.map((d) => d.profit), 1);

    return { totalProfit, soldCount: soldOrders.length, conversions, avgMarkup, zoneMap, daily, maxDaily };
  }, [orders, cutoff, now, period]);

  const recentSold = orders
    .filter((o) => o.isSold)
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .slice(0, 10);

  return (
    <div className="min-h-full bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-3 py-3 flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} className="p-1.5 -ml-1 rounded-lg text-gray-500">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-black flex-1">📊 Аналитика</h1>
        <div className="flex rounded-xl overflow-hidden border border-gray-200">
          {(['week', 'month'] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-bold ${period === p ? 'bg-blue-600 text-white' : 'bg-white text-gray-500'}`}
            >
              {p === 'week' ? 'Неделя' : 'Месяц'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Заработано', value: `${stats.totalProfit.toFixed(0)} AED`, icon: '💰' },
            { label: 'Завершено', value: String(stats.soldCount), icon: '✅' },
            { label: 'Конверсия', value: `${stats.conversions}%`, icon: '🎯' },
            { label: 'Средняя наценка', value: `${stats.avgMarkup.toFixed(1)}%`, icon: '📈' },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white border border-gray-200 rounded-2xl p-3">
              <p className="text-lg">{kpi.icon}</p>
              <p className="text-xl font-black mt-1">{kpi.value}</p>
              <p className="text-xs text-gray-500">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Daily bar chart (7 days) */}
        <div className="bg-white border border-gray-200 rounded-2xl p-3">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={16} className="text-blue-500" />
            <p className="text-xs font-black text-gray-700">ДОХОД ПО ДНЯМ (7 дней)</p>
          </div>
          <div className="flex items-end gap-1 h-20">
            {stats.daily.map((d) => (
              <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-blue-400 rounded-t"
                  style={{ height: `${Math.max(4, (d.profit / stats.maxDaily) * 64)}px` }}
                />
                <p className="text-[9px] text-gray-400 leading-none">{d.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Zone pie (text) */}
        {Object.keys(stats.zoneMap).length > 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl p-3">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={16} className="text-violet-500" />
              <p className="text-xs font-black text-gray-700">АКТИВНОСТЬ ПО ЗОНАМ</p>
            </div>
            <div className="space-y-1.5">
              {Object.entries(stats.zoneMap)
                .sort((a, b) => b[1] - a[1])
                .map(([zone, count]) => {
                  const total = Object.values(stats.zoneMap).reduce((s, c) => s + c, 0);
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={zone}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="font-medium text-gray-700">{zone}</span>
                        <span className="text-gray-500">{count} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Recent sold */}
        {recentSold.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-3 pt-3 pb-1">
              <p className="text-xs font-black text-gray-700">ПОСЛЕДНИЕ ЗАВЕРШЁННЫЕ</p>
            </div>
            {recentSold.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => navigate(`/order/${o.id}`)}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 border-t border-gray-100"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800 truncate">{o.brand} {o.model} {o.year}</p>
                  <p className="text-xs text-gray-500">{o.clientName}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-emerald-600">
                    +{Math.max(0, (o.clientPriceAed || 0) - (o.purchasePriceAed || 0)).toFixed(0)} AED
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsScreen;
