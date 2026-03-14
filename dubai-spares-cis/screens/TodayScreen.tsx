import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckSquare, Clock, MapPin, MessageCircle, Plus, Star } from 'lucide-react';
import { useStore } from '../store';
import { useAppSettings } from '../appSettings';

const ZONE_LABELS: Record<string, string> = {
  Area2: 'Area 2', Area3: 'Area 3', Area4: 'Area 4',
  Area6: 'Area 6', Area8: 'Area 8', Dubai: 'Dubai', Online: 'Online',
};

const formatTimer = (ms: number) => {
  const h = Math.floor(ms / 3600000);
  if (h >= 48) return `${Math.floor(h / 24)} дн.`;
  return `${h}ч`;
};

const TodayScreen: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();
  const { settings } = useAppSettings();

  const now = Date.now();
  const userName = settings?.userName || 'Руслан';
  const weeklyGoal = settings?.weeklyGoalAed || 2000;

  // Calculate this week's earnings from sold orders
  const weekStart = (() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d.getTime();
  })();
  const weekEarnings = useMemo(() => {
    return orders
      .filter((o) => o.isSold && (o.updatedAt || o.createdAt) >= weekStart)
      .reduce((sum, o) => {
        const profit = (o.clientPriceAed || 0) - (o.purchasePriceAed || 0);
        return sum + Math.max(0, profit);
      }, 0);
  }, [orders, weekStart]);
  const progressPct = Math.min(100, Math.round((weekEarnings / weeklyGoal) * 100));

  // Urgent orders: isUrgent OR offer sent > 2h ago with no payment
  const urgentOrders = useMemo(() => orders.filter((o) => {
    if (o.isArchived || o.isSold) return false;
    if (o.isUrgent) return true;
    if (o.offerSentAt && (now - o.offerSentAt) > 2 * 3600000 && o.paidStatus !== 'paid') return true;
    return false;
  }), [orders, now]);

  // Route: active orders grouped by zone
  const routeByZone = useMemo(() => {
    const active = orders.filter((o) => !o.isArchived && !o.isSold && o.locationZone && o.locationZone !== 'Online');
    const map: Record<string, typeof active> = {};
    active.forEach((o) => {
      const z = o.locationZone!;
      if (!map[z]) map[z] = [];
      map[z].push(o);
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [orders]);

  // Paused clients: offer sent > 24h, no payment
  const pausedOrders = useMemo(() => orders.filter((o) => {
    if (o.isArchived || o.isSold) return false;
    if (o.salesStatus === 'Price Sent' && o.offerSentAt && (now - o.offerSentAt) > 24 * 3600000 && o.paidStatus !== 'paid') return true;
    return false;
  }), [orders, now]);

  // New leads
  const newLeads = useMemo(() => orders.filter((o) => o.isLead && !o.isArchived), [orders]);

  const today = new Date();
  const dateStr = today.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const dateCapitalized = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  const sendReminder = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const phone = order.contactLinks?.phone || order.customerContact || '';
    const reminderTemplate = settings?.messageTemplates?.find((t) => t.id === 'reminder');
    const rawText = reminderTemplate?.text || 'Здравствуйте! Напоминаю по вашему запросу {brand} {model} {part}. Актуально предложение?';
    const partName = order.parts[0]?.name || '';
    const message = rawText
      .replace('{brand}', order.brand)
      .replace('{model}', order.model)
      .replace('{part}', partName)
      .replace('{price}', String(order.clientPriceAed || ''));
    if (phone) {
      window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, '_blank');
    }
  };

  const getUrgencyReason = (o: typeof orders[0]) => {
    if (o.isUrgent) return 'Помечено срочным';
    if (o.offerSentAt) {
      const elapsed = now - o.offerSentAt;
      return `Ждёт ответа (просрочено ${formatTimer(elapsed)})`;
    }
    return 'Требует внимания';
  };

  const getTaskAction = (o: typeof orders[0]) => {
    if (o.paidStatus === 'paid') return 'Забрать (оплачено)';
    if (o.salesStatus === 'Price Sent') return 'Ожидать ответ';
    if (o.parts.some((p) => p.isFound)) return 'Деталь найдена';
    return 'Найти и сфоткать';
  };

  return (
    <div className="p-3 space-y-3 pb-6">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 text-white p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-black">Привет, {userName}! 👋</h1>
            <p className="text-slate-300 text-xs mt-0.5">{dateCapitalized}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/new')}
            className="flex items-center gap-1 bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-full"
          >
            <Plus size={14} /> Заказ
          </button>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-300">💰 Заработано за неделю</span>
            <span className="font-bold">{weekEarnings.toFixed(0)} / {weeklyGoal} AED</span>
          </div>
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-right text-slate-400 text-[10px] mt-0.5">{progressPct}%</p>
        </div>
      </div>

      {/* Urgent */}
      {urgentOrders.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-500 shrink-0" />
            <span className="text-sm font-black text-rose-700 uppercase tracking-wide">🚨 Срочно</span>
          </div>
          {urgentOrders.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => navigate(`/order/${o.id}`)}
              className="w-full text-left bg-white border border-rose-100 rounded-xl p-2.5 space-y-0.5"
            >
              <p className="text-sm font-bold text-gray-800">{o.brand} {o.model} {o.year}</p>
              <p className="text-xs text-rose-600">{getUrgencyReason(o)}</p>
              {o.parts[0] && <p className="text-xs text-gray-400">{o.parts[0].name}</p>}
            </button>
          ))}
        </div>
      )}

      {/* Route */}
      {routeByZone.length > 0 ? (
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-blue-500 shrink-0" />
            <span className="text-sm font-black text-blue-700 uppercase tracking-wide">🗺 Маршрут на сегодня</span>
          </div>
          {routeByZone.map(([zone, zoneOrders]) => (
            <div key={zone} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black text-blue-800">
                  Сначала едь в {ZONE_LABELS[zone] || zone} ({zoneOrders.length} задач)
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`/route/${zone}`)}
                  className="text-[10px] font-bold text-blue-600 bg-white border border-blue-200 px-2 py-0.5 rounded-full"
                >
                  Детали
                </button>
              </div>
              {zoneOrders.slice(0, 3).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => navigate(`/order/${o.id}`)}
                  className="w-full text-left flex items-start gap-2 bg-white border border-blue-100 rounded-lg p-2"
                >
                  <CheckSquare size={14} className="text-blue-300 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-800 truncate">
                      {o.parts[0]?.name || 'Деталь'} {o.brand} {o.model}
                    </p>
                    <p className="text-[10px] text-gray-500">{getTaskAction(o)}</p>
                  </div>
                </button>
              ))}
              {zoneOrders.length > 3 && (
                <p className="text-[10px] text-blue-500 pl-6">+ ещё {zoneOrders.length - 3}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-center">
          <MapPin size={24} className="text-gray-300 mx-auto mb-1" />
          <p className="text-sm text-gray-500">Нет активных заказов с зоной</p>
          <p className="text-xs text-gray-400">Назначьте локацию в карточке заказа</p>
        </div>
      )}

      {/* Paused clients */}
      {pausedOrders.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-amber-500 shrink-0" />
            <span className="text-sm font-black text-amber-700 uppercase tracking-wide">
              ⏳ Клиенты на паузе ({pausedOrders.length})
            </span>
          </div>
          {pausedOrders.map((o) => (
            <div key={o.id} className="flex items-center gap-2 bg-white border border-amber-100 rounded-xl p-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-800 truncate">{o.brand} {o.model}</p>
                <p className="text-[10px] text-amber-600">
                  {o.salesStatus} · {o.offerSentAt ? formatTimer(now - o.offerSentAt) : '?'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => sendReminder(o.id)}
                className="shrink-0 flex items-center gap-1 text-[10px] font-bold bg-emerald-500 text-white px-2.5 py-1 rounded-full"
              >
                <MessageCircle size={11} /> Напомнить
              </button>
            </div>
          ))}
        </div>
      )}

      {/* New leads */}
      <div className="rounded-2xl border border-gray-200 bg-white p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star size={16} className="text-violet-500" />
          <div>
            <p className="text-sm font-black">✉️ Новые заявки</p>
            <p className="text-xs text-gray-500">{newLeads.length} лидов ожидают обработки</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/?tab=lead')}
          className="text-xs font-bold bg-violet-500 text-white px-3 py-1.5 rounded-full"
        >
          Проверить
        </button>
      </div>
    </div>
  );
};

export default TodayScreen;
