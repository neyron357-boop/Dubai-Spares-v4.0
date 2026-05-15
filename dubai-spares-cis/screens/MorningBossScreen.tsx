import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, Priority } from '../types';
import { getGreeting } from '../utils/greeting';

const DAILY_GOAL_ORDERS = 8;
const DAILY_GOAL_PARTS = 20;
const STREAK_DAYS = 12;

const formatDate = (): string => {
  return new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + ' • Шарджа';
};

const foundPartsCount = (order: Order) =>
  order.parts.filter((part) => part.isFound || (part.variants || []).length > 0).length;

const MorningBossScreen: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();
  const [streakBounce, setStreakBounce] = useState(false);

  const activeOrders = useMemo(
    () => orders.filter((o) => !o.isArchived && !o.isSold),
    [orders]
  );

  const urgentOrdersList = useMemo(
    () => activeOrders.filter((o) => o.priority === Priority.HIGH).slice(0, 4),
    [activeOrders]
  );

  const totalFoundParts = useMemo(
    () => activeOrders.reduce((sum, o) => sum + foundPartsCount(o), 0),
    [activeOrders]
  );

  const todayMargin = useMemo(() => {
    return activeOrders.reduce((sum, order) => {
      const costAed = order.parts.reduce((acc, part) => {
        const variants = part.variants || [];
        const bestPrice = variants.reduce((min, v) => {
          const p = Number(v.priceAed || 0);
          if (!p) return min;
          return min === 0 ? p : Math.min(min, p);
        }, 0);
        return acc + bestPrice;
      }, 0);
      if (costAed <= 0) return sum;
      return sum + costAed * (order.markupPercent || 0) / 100;
    }, 0);
  }, [activeOrders]);

  const ordersProgress = DAILY_GOAL_ORDERS > 0
    ? Math.min(100, (Math.min(activeOrders.length, DAILY_GOAL_ORDERS) / DAILY_GOAL_ORDERS) * 100)
    : 0;
  const partsProgress = DAILY_GOAL_PARTS > 0
    ? Math.min(100, (Math.min(totalFoundParts, DAILY_GOAL_PARTS) / DAILY_GOAL_PARTS) * 100)
    : 0;

  const handleStreakTap = () => {
    setStreakBounce(true);
    window.setTimeout(() => setStreakBounce(false), 600);
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#f7f8fc]">
      {/* Scrollable content */}
      <div className="flex-1 px-5 pt-[max(1.5rem,env(safe-area-inset-top))]">

        {/* ── 1. Greeting ── */}
        <div className="mb-6">
          <h1 className="text-[34px] font-black leading-tight tracking-tight text-slate-900">
            {getGreeting()}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{formatDate()}</p>
        </div>

        {/* ── 2. Daily goals ── */}
        <div className="rounded-3xl bg-white border border-slate-200 shadow-sm px-5 py-4 mb-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
            Цель на сегодня
          </p>

          <div className="flex items-end justify-between gap-4 mb-4">
            {/* Orders goal */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1">
                <span className="text-[40px] font-black leading-none text-slate-900">
                  {Math.min(activeOrders.length, DAILY_GOAL_ORDERS)}
                </span>
                <span className="text-base font-bold text-slate-400">
                  /{DAILY_GOAL_ORDERS}
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-500 mt-0.5">заказов</p>
              <div className="mt-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-2 rounded-full bg-blue-500 transition-all duration-700"
                  style={{ width: `${ordersProgress}%` }}
                />
              </div>
            </div>

            <div className="w-px h-12 bg-slate-200 shrink-0" />

            {/* Parts goal */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1">
                <span className="text-[40px] font-black leading-none text-slate-900">
                  {Math.min(totalFoundParts, DAILY_GOAL_PARTS)}
                </span>
                <span className="text-base font-bold text-slate-400">
                  /{DAILY_GOAL_PARTS}
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-500 mt-0.5">деталей</p>
              <div className="mt-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-2 rounded-full bg-blue-500 transition-all duration-700"
                  style={{ width: `${partsProgress}%` }}
                />
              </div>
            </div>
          </div>

          {/* Margin */}
          <div className="rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-1">
              Маржа сегодня
            </p>
            <p className="text-[40px] font-black leading-none text-emerald-600">
              +{Math.round(todayMargin).toLocaleString('ru-RU')}
            </p>
            <p className="text-sm font-bold text-emerald-600 mt-0.5">AED</p>
          </div>
        </div>

        {/* ── 3. Streak ── */}
        <div className="rounded-3xl bg-white border border-slate-200 shadow-sm px-5 py-3.5 mb-4 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-800">
            Стрик: {STREAK_DAYS} дней подряд 🔥
          </p>
          <button
            type="button"
            onClick={handleStreakTap}
            className={`text-[11px] font-semibold text-slate-400 active:scale-95 transition-all duration-150 ${streakBounce ? 'scale-110 text-amber-500' : 'scale-100'}`}
          >
            {streakBounce ? '🔥🔥🔥' : 'Не сломать стрик'}
          </button>
        </div>

        {/* ── 4. Urgent today ── */}
        <div className="mb-6">
          <p className="text-[11px] font-black uppercase tracking-widest text-rose-600 mb-2">
            🔥 СРОЧНО СЕГОДНЯ
          </p>

          {urgentOrdersList.length === 0 ? (
            <div className="rounded-3xl bg-white border border-slate-200 shadow-sm px-5 py-5 text-center">
              <p className="text-sm font-semibold text-slate-600">Отлично! Сегодня всё спокойно ✅</p>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5">
              {urgentOrdersList.map((order) => {
                const thumb = (order.carPhotos && order.carPhotos[0]) || order.carPhotoUrl;
                return (
                  <div
                    key={order.id}
                    className="shrink-0 w-44 rounded-2xl border border-rose-200 bg-white shadow-sm overflow-hidden"
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={`${order.brand} ${order.model}`}
                        className="h-24 w-full object-cover"
                      />
                    ) : (
                      <div className="h-24 w-full bg-rose-50 flex items-center justify-center">
                        <span className="text-3xl font-black text-rose-300">{order.brand?.[0] || '?'}</span>
                      </div>
                    )}
                    <div className="p-2.5 space-y-2">
                      <p className="text-[12px] font-black text-slate-800 truncate">
                        {order.brand} {order.model}
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate(`/order/${order.id}`)}
                        className="w-full rounded-xl bg-rose-500 py-1.5 text-[10px] font-black text-white active:scale-95 transition-transform"
                      >
                        Отправить поставщику
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* ── 5. Fixed CTA button ── */}
      <div className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 bg-[#f7f8fc] border-t border-slate-200 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/orders')}
          className="w-full h-14 rounded-2xl bg-slate-900 text-white text-base font-black tracking-wide shadow-lg active:scale-[0.98] transition-transform"
        >
          Начать работу →
        </button>
      </div>
    </div>
  );
};

export default MorningBossScreen;
