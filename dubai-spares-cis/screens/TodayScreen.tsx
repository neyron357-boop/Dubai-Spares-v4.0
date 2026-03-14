import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { loadAppSettings } from '../appSettings';
import { Order, OrderArea } from '../types';
import { MapPin, AlertTriangle, Bike, Clock, MailOpen, CheckCircle2 } from 'lucide-react';

const WEEKLY_GOAL_AED = 2000;

const AREA_LABELS: Record<OrderArea, string> = {
  area2: 'Area 2',
  area3: 'Area 3',
  area4: 'Area 4',
  area6: 'Area 6',
  area8: 'Area 8',
  dubai: 'Dubai',
  online: 'Online',
};

const formatDateRu = (date: Date) => {
  const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
};

const formatElapsed = (ts: number): string => {
  const ms = Date.now() - ts;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}м назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}ч назад`;
  return `${Math.floor(hours / 24)}д назад`;
};

const getNextStep = (order: Order): string => {
  const wf = order.workflowStatus;
  if (wf === 'lead' || order.isLead) return 'Требуется проверка детали';
  if (wf === 'waiting_client') return 'Ждём ответа клиента';
  if (wf === 'paid') return 'Выкупить деталь';
  if (wf === 'found') return 'Забрать деталь';
  if (wf === 'sent') return 'Завершено';
  if (order.salesStatus === 'Price Sent') return 'Ждём ответа клиента';
  if (order.salesStatus === 'Pending Approval') return 'Ждём подтверждения';
  if (order.salesStatus === 'Paid') return 'Выкупить деталь';
  if (order.salesStatus === 'Completed') return 'Завершено';
  if (order.parts.some((p) => p.isFound)) return 'Забрать деталь';
  return 'Найти деталь / Спросить цену';
};

const TodayScreen: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();
  const settings = loadAppSettings();
  const userName = settings.publicManagerName || 'Менеджер';
  const today = new Date();

  // Block 1: Weekly earnings
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weeklyEarnings = useMemo(
    () =>
      orders
        .filter((o) => o.isSold && (o.updatedAt || o.createdAt) >= weekStart)
        .reduce((sum, o) => {
          const profit = o.purchasePrice != null && o.clientPriceAed != null
            ? o.clientPriceAed - o.purchasePrice
            : (o.soldProfitUsd || 0) * (o.exchangeRate || 3.67);
          return sum + profit;
        }, 0),
    [orders, weekStart],
  );

  // Today tasks: orders with workflowStatus in_work / not yet done
  const todayTasks = useMemo(
    () =>
      orders.filter(
        (o) =>
          !o.isArchived &&
          !o.isSold &&
          o.workflowStatus !== 'sent' &&
          o.workflowStatus !== 'archive' &&
          (o.workflowStatus === 'in_work' ||
            o.workflowStatus === 'paid' ||
            o.workflowStatus === 'found' ||
            o.status === 'in_progress'),
      ),
    [orders],
  );

  const completedTodayTasks = useMemo(
    () =>
      todayTasks.filter(
        (o) => o.workflowStatus === 'found' || o.workflowStatus === 'sent' || o.salesStatus === 'Completed',
      ).length,
    [todayTasks],
  );

  const taskProgress = todayTasks.length > 0 ? Math.round((completedTodayTasks / todayTasks.length) * 100) : 0;

  // Block 2: Urgent tasks
  const urgentOrders = useMemo(
    () =>
      orders
        .filter((o) => {
          if (o.isArchived || o.isSold) return false;
          const isUrgentTag = o.priority === 'HIGH';
          const noResponseAfterOffer =
            o.workflowStatus === 'waiting_client' &&
            o.offerSentAt &&
            Date.now() - o.offerSentAt > 2 * 60 * 60 * 1000;
          return isUrgentTag || noResponseAfterOffer;
        })
        .slice(0, 5),
    [orders],
  );

  // Block 3: Route — active orders with a physical area (not online)
  const routeOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          !o.isArchived &&
          !o.isSold &&
          o.area &&
          o.area !== 'online' &&
          (o.workflowStatus === 'in_work' || o.workflowStatus === 'paid' || o.workflowStatus === 'found' || !o.workflowStatus),
      ),
    [orders],
  );

  const routeByArea = useMemo(() => {
    const map = new Map<OrderArea, Order[]>();
    routeOrders.forEach((o) => {
      if (!o.area) return;
      const existing = map.get(o.area) || [];
      map.set(o.area, [...existing, o]);
    });
    // Sort areas by task count descending
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [routeOrders]);

  // Block 4: Clients on pause (waiting_client > 24h)
  const pausedOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          !o.isArchived &&
          !o.isSold &&
          (o.workflowStatus === 'waiting_client' || o.salesStatus === 'Price Sent') &&
          o.offerSentAt &&
          Date.now() - o.offerSentAt > 24 * 60 * 60 * 1000,
      ),
    [orders],
  );

  // Block 5: New leads
  const newLeadsCount = useMemo(
    () => orders.filter((o) => !o.isArchived && !o.isSold && (o.isLead || o.workflowStatus === 'lead')).length,
    [orders],
  );

  const progressPercent = Math.min(100, Math.round((weeklyEarnings / WEEKLY_GOAL_AED) * 100));

  return (
    <div className="space-y-3 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">

      {/* Block 1: Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Привет, {userName}! 👋</h1>
          <p className="text-sm text-slate-500 capitalize">{formatDateRu(today)}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-emerald-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase text-emerald-600">Заработано за неделю</p>
            <p className="text-lg font-black text-emerald-800">{Math.round(weeklyEarnings).toLocaleString()} AED</p>
          </div>
          <div className="rounded-xl bg-blue-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase text-blue-600">Цель на неделю</p>
            <p className="text-lg font-black text-blue-800">{WEEKLY_GOAL_AED.toLocaleString()} AED</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>🔥 Задачи: {completedTodayTasks} / {todayTasks.length} выполнено</span>
              <span className="font-black">{taskProgress}%</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-700"
                style={{ width: `${taskProgress}%` }}
              />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>💰 Цель: {Math.round(weeklyEarnings).toLocaleString()} / {WEEKLY_GOAL_AED.toLocaleString()} AED</span>
              <span className="font-black">{progressPercent}%</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-700"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Block 2: Urgent */}
      {urgentOrders.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-black text-rose-700">
            <AlertTriangle size={16} /> 🚨 Срочное ({urgentOrders.length})
          </h2>
          {urgentOrders.map((order) => {
            const elapsed = order.offerSentAt ? formatElapsed(order.offerSentAt) : null;
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => navigate(`/order/${order.id}`)}
                className="w-full flex items-start gap-3 rounded-xl bg-white border border-rose-200 p-3 text-left active:bg-rose-50"
              >
                <span className="mt-0.5 h-3 w-1 shrink-0 rounded-full bg-rose-500" />
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">{order.brand} {order.model}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {order.workflowStatus === 'waiting_client' ? `Ждёт цены` : 'СРОЧНО'}
                    {elapsed ? ` · Просрочено ${elapsed}` : ''}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Block 3: Route */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-black text-slate-800">
          <Bike size={16} /> 🚲 Маршрут на сегодня
        </h2>
        {routeByArea.length === 0 ? (
          <p className="text-sm text-slate-400">Нет задач с указанной зоной. Добавьте локацию в карточке заказа.</p>
        ) : (
          routeByArea.map(([area, areaOrders], idx) => (
            <div key={area} className="space-y-2">
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-blue-500" />
                <p className="text-xs font-black text-slate-700">
                  {idx === 0 ? '⭐ Сначала едь в ' : '→ Потом в '}{AREA_LABELS[area]} ({areaOrders.length} задач)
                </p>
              </div>
              <div className="space-y-1 pl-5">
                {areaOrders.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => navigate(`/order/${order.id}`)}
                    className="w-full flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-left active:bg-slate-100"
                  >
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-slate-300" />
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-800 truncate">{order.brand} {order.model}</p>
                      <p className="text-[10px] text-slate-500 truncate">{getNextStep(order)}{order.supplierName ? ` · ${order.supplierName}` : ''}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Block 4: Clients on pause */}
      {pausedOrders.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-black text-amber-700">
            <Clock size={16} /> ⏳ Клиенты на паузе ({pausedOrders.length})
          </h2>
          {pausedOrders.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => navigate(`/order/${order.id}`)}
              className="w-full flex items-start gap-3 rounded-xl bg-white border border-amber-200 p-3 text-left active:bg-amber-50"
            >
              <Clock size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 truncate">{order.brand} {order.model}</p>
                <p className="text-xs text-slate-500">
                  Оффер отправлен · {order.offerSentAt ? formatElapsed(order.offerSentAt) : 'давно'} · Нет ответа
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Block 5: New leads CTA */}
      <button
        type="button"
        onClick={() => navigate('/orders?tab=lead')}
        className="w-full flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 active:bg-slate-50"
      >
        <span className="flex items-center gap-2 text-sm font-black text-slate-800">
          <MailOpen size={16} />
          {newLeadsCount > 0
            ? `✉️ ${newLeadsCount} новых заявок (требуют проверки)`
            : '✉️ Новые заявки'}
        </span>
        <span className="text-xs text-slate-400">Открыть →</span>
      </button>

    </div>
  );
};

export default TodayScreen;
