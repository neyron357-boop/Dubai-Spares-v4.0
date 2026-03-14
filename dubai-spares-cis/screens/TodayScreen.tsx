import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  MapPin,
  Menu,
  MessageCircle,
  Play,
  RefreshCw,
  Settings2,
  X,
} from 'lucide-react';
import { useStore } from '../store';
import { Order, Priority } from '../types';
import { loadAppSettings } from '../appSettings';
import { toast, vibrate } from '../feedback';
import { useDrawer } from '../DrawerContext';
import {
  loadDashboardWidgets,
  reorderWidgets,
  saveDashboardWidgets,
  toggleWidgetVisibility,
  WidgetConfig,
  WidgetId,
} from '../dashboardStore';

/* ─────────────────── helpers ─────────────────── */

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

const startOfToday = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const startOfWeek = (): number => Date.now() - 7 * MS_DAY;

const formatCurrentDate = (): string =>
  new Date().toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });

const formatElapsed = (ms: number): string => {
  const hours = Math.floor(ms / MS_HOUR);
  const minutes = Math.floor((ms % MS_HOUR) / (60 * 1000));
  if (hours > 0) return `${hours}ч ${minutes}м`;
  return `${minutes}м`;
};

const formatDays = (ms: number): string => {
  const days = Math.floor(ms / MS_DAY);
  const hours = Math.floor((ms % MS_DAY) / MS_HOUR);
  if (days > 0) return `${days} д.`;
  return `${hours}ч`;
};

const parseArea = (location: string): string => {
  if (!location || location.toLowerCase() === 'online') return 'Online';
  const match = location.match(/area\s*(\d+)/i);
  if (match) return `Area ${match[1]}`;
  if (/dubai/i.test(location)) return 'Dubai';
  if (location.trim()) return location.trim();
  return 'Другое';
};

const getOrderArea = (order: Order): string => {
  for (const part of order.parts) {
    for (const variant of part.variants || []) {
      if (variant.location && variant.location.toLowerCase() !== 'online') {
        return parseArea(variant.location);
      }
    }
  }
  return 'Другое';
};

const needsPhysicalVisit = (order: Order): boolean => {
  for (const part of order.parts) {
    for (const variant of part.variants || []) {
      if (variant.location && variant.location.toLowerCase() !== 'online') return true;
    }
  }
  const s = order.salesStatus;
  return s === 'Inquiry' || s === 'Paid';
};

const computeWeeklyEarnings = (orders: Order[]): number => {
  const since = startOfWeek();
  return orders
    .filter(
      (o) =>
        o.salesStatus === 'Completed' &&
        Number(o.statusChangedAt || o.updatedAt || 0) >= since,
    )
    .reduce((sum, o) => {
      const costAed = o.parts.reduce((acc, part) => {
        const best = (part.variants || []).reduce((min, v) => {
          const p = Number(v.priceAed || 0);
          return p > 0 ? (min === 0 ? p : Math.min(min, p)) : min;
        }, 0);
        return acc + best;
      }, 0);
      return sum + (costAed * (Number(o.markupPercent) || 0)) / 100;
    }, 0);
};

const computePendingProfit = (orders: Order[]): number => {
  return orders
    .filter((o) => !o.isArchived && !o.isSold && o.salesStatus !== 'Completed')
    .reduce((sum, o) => {
      const costAed = o.parts.reduce((acc, part) => {
        const best = (part.variants || []).reduce((min, v) => {
          const p = Number(v.priceAed || 0);
          return p > 0 ? (min === 0 ? p : Math.min(min, p)) : min;
        }, 0);
        return acc + best;
      }, 0);
      if (costAed <= 0) return sum;
      return sum + (costAed * (Number(o.markupPercent) || 0)) / 100;
    }, 0);
};

const getTaskLabel = (order: Order): string => {
  const carLabel = `${order.brand} ${order.model}`.trim() || 'Авто';
  const firstPart = order.parts[0];
  const partName = firstPart?.name || 'деталь';
  const extra = order.isVip ? ' (VIP)' : '';
  if (order.salesStatus === 'Paid') return `Забрать ${partName} ${carLabel}${extra}`;
  if (order.salesStatus === 'Price Sent' || order.salesStatus === 'Pending Approval')
    return `Уточнить ${partName} ${carLabel}${extra}`;
  return `Найти ${partName} ${carLabel}${extra}`;
};

const pluralLead = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return `${n} лидов`;
  if (mod10 === 1) return `${n} лид`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} лида`;
  return `${n} лидов`;
};

/* ─────────────────── types ─────────────────── */

interface RouteZone {
  area: string;
  tasks: Order[];
}

/* ─────────────────── ProgressBar ─────────────────── */

const ProgressBar: React.FC<{
  value: number;
  max: number;
  forecast?: number;
}> = ({ value, max, forecast = 0 }) => {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const forecastPct =
    max > 0 ? Math.min(100 - pct, Math.round((forecast / max) * 100)) : 0;
  return (
    <div className="h-2.5 w-full rounded-full bg-[#2A2A2A] overflow-hidden flex">
      <div
        className="h-2.5 rounded-l-full bg-[#4CAF50] transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
      {forecastPct > 0 && (
        <div
          className="h-2.5 bg-[#4CAF50]/30 transition-all duration-700"
          style={{ width: `${forecastPct}%` }}
          title="Прогноз"
        />
      )}
    </div>
  );
};

/* ─────────────────── UrgentCard ─────────────────── */

const UrgentCard: React.FC<{ order: Order; onClick: () => void }> = ({
  order,
  onClick,
}) => {
  const elapsed = Date.now() - Number(order.statusChangedAt || order.updatedAt || order.createdAt);
  const isOverdue = elapsed > 2 * MS_HOUR;
  const carLabel = `${order.brand} ${order.model}`.trim() || 'Авто';
  const reason = order.isVip ? 'VIP СРОЧНО' : `не отвечает ${formatElapsed(elapsed)}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl bg-[#2A1A1A] border border-[#F44336]/40 p-3 space-y-1 active:scale-[0.98] transition-transform"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-white truncate">{carLabel}</span>
        <span className="text-[11px] font-semibold text-[#F44336] shrink-0">● СРОЧНО</span>
      </div>
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <AlertCircle size={12} className="text-[#F44336] shrink-0" />
        <span className={isOverdue ? 'text-[#F44336] font-semibold' : ''}>{reason}</span>
      </div>
    </button>
  );
};

/* ─────────────────── WaitingCard ─────────────────── */

const WaitingCard: React.FC<{ order: Order; onRemind: () => void }> = ({
  order,
  onRemind,
}) => {
  const elapsed = Date.now() - Number(order.statusChangedAt || order.updatedAt || order.createdAt);
  const carLabel = `${order.brand} ${order.model}`.trim() || 'Авто';
  const statusLabel =
    order.salesStatus === 'Price Sent' ? 'Ожидание ответа' : 'Уточнение';

  return (
    <div className="rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{carLabel}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {statusLabel} {formatDays(elapsed)}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemind}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#25D366]/15 border border-[#25D366]/30 text-[#25D366] text-xs font-semibold"
        >
          <MessageCircle size={12} />
          Пинг
        </button>
      </div>
    </div>
  );
};

/* ─────────────────── RouteTaskRow ─────────────────── */

interface RouteTaskRowProps {
  order: Order;
  checked: boolean;
  onCheck: () => void;
  onClick: () => void;
}

const RouteTaskRow: React.FC<RouteTaskRowProps> = ({
  order,
  checked,
  onCheck,
  onClick,
}) => {
  const label = getTaskLabel(order);
  const isVip = order.isVip;

  return (
    <div className="flex items-center gap-3 py-2 px-1">
      <button
        type="button"
        aria-label="Отметить задачу выполненной"
        onClick={onCheck}
        className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
          checked
            ? 'bg-[#4CAF50] border-[#4CAF50]'
            : 'border-gray-500 bg-transparent'
        }`}
      >
        {checked && <span className="text-white text-[10px] font-black">✓</span>}
      </button>
      <button
        type="button"
        onClick={onClick}
        className={`flex-1 text-left text-sm ${
          checked ? 'line-through text-gray-500' : 'text-white'
        }`}
      >
        {label}
        {isVip && (
          <span className="ml-1.5 text-[10px] font-bold text-[#FFD700] uppercase">
            VIP
          </span>
        )}
        {order.priority === Priority.HIGH && !isVip && (
          <span className="ml-1.5 text-[10px] font-bold text-[#F44336] uppercase">
            СРОЧНО
          </span>
        )}
      </button>
    </div>
  );
};

/* ─────────────────── ZoneSection ─────────────────── */

interface ZoneSectionProps {
  zone: RouteZone;
  index: number;
  checkedTasks: Set<string>;
  onCheckTask: (orderId: string) => void;
  onOpenOrder: (orderId: string) => void;
  onStartRoute: (area: string) => void;
}

const ZoneSection: React.FC<ZoneSectionProps> = ({
  zone,
  index,
  checkedTasks,
  onCheckTask,
  onOpenOrder,
  onStartRoute,
}) => {
  const [expanded, setExpanded] = useState(true);
  const isPrimary = index === 0;
  const label = isPrimary
    ? `Сначала едь в ${zone.area} (${zone.tasks.length} ${zone.tasks.length === 1 ? 'задача' : 'задач'})`
    : `Потом в ${zone.area} (${zone.tasks.length} ${zone.tasks.length === 1 ? 'задача' : 'задач'})`;

  return (
    <div className="rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <MapPin size={14} className="text-[#2196F3] shrink-0" />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left text-sm font-semibold text-white"
        >
          {label}
        </button>
        <button
          type="button"
          onClick={() => onStartRoute(zone.area)}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-[#2196F3]/20 border border-[#2196F3]/40 text-[#2196F3] text-[11px] font-bold"
        >
          <Play size={10} />
          Начать
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-gray-500"
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-[#2A2A2A] px-3 pb-1 divide-y divide-[#2A2A2A]/50">
          {zone.tasks.map((order) => (
            <RouteTaskRow
              key={order.id}
              order={order}
              checked={checkedTasks.has(order.id)}
              onCheck={() => onCheckTask(order.id)}
              onClick={() => onOpenOrder(order.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* ─────────────────── Widget labels ─────────────────── */

const WIDGET_LABELS: Record<WidgetId, string> = {
  money_pulse: '💰 Money Pulse',
  smart_route: '🗺️ Smart Route',
  vip_focus: '🚨 VIP Focus',
  inbox_cleanup: '📥 Inbox Cleanup',
};

/* ─────────────────── EditModeBar ─────────────────── */

const EditModeBar: React.FC<{
  widgets: WidgetConfig[];
  onToggle: (id: WidgetId) => void;
  onClose: () => void;
}> = ({ widgets, onToggle, onClose }) => (
  <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex flex-col justify-end">
    <div className="bg-[#121212] rounded-t-3xl border-t border-[#2A2A2A] animate-slide-up">
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-10 h-1 rounded-full bg-[#3A3A3A]" />
      </div>
      <div className="px-5 pt-2 pb-8">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">
            Виджеты Dashboard
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#1E1E1E] flex items-center justify-center"
          >
            <X size={16} className="text-gray-400" />
          </button>
        </div>
        <div className="space-y-2">
          {widgets.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between rounded-xl bg-[#1E1E1E] border border-[#2A2A2A] px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <GripVertical size={16} className="text-gray-600" />
                <span className="text-sm font-semibold text-white">
                  {WIDGET_LABELS[w.id]}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onToggle(w.id)}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  w.visible
                    ? 'bg-[#2196F3]/20 text-[#2196F3]'
                    : 'bg-[#2A2A2A] text-gray-600'
                }`}
              >
                {w.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-600 text-center mt-3">
          Удерживайте любой виджет для входа в режим редактирования
        </p>
      </div>
    </div>
  </div>
);

/* ─────────────────── localStorage helpers ─────────────────── */

const TODAY_CHECKED_KEY = 'today_checked_tasks_v1';

const loadChecked = (): Set<string> => {
  try {
    const raw = localStorage.getItem(TODAY_CHECKED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { date: string; ids: string[] };
    const today = new Date().toDateString();
    if (parsed.date !== today) return new Set();
    return new Set(parsed.ids);
  } catch {
    return new Set();
  }
};

const saveChecked = (ids: Set<string>) => {
  try {
    localStorage.setItem(
      TODAY_CHECKED_KEY,
      JSON.stringify({ date: new Date().toDateString(), ids: Array.from(ids) }),
    );
  } catch {
    // ignore
  }
};

interface SnackbarState {
  orderId: string;
  message: string;
}

/* ─────────────────── Widget: Money Pulse ─────────────────── */

const MoneyPulseWidget: React.FC<{
  weeklyEarnings: number;
  weeklyGoal: number;
  pendingProfit: number;
  activeTasks: number;
  completedTodayCount: number;
  leadCount: number;
  onStartRoute: () => void;
}> = ({
  weeklyEarnings,
  weeklyGoal,
  pendingProfit,
  activeTasks,
  completedTodayCount,
  leadCount,
  onStartRoute,
}) => {
  const [showDetail, setShowDetail] = useState(false);
  const progressPct =
    weeklyGoal > 0 ? Math.min(100, Math.round((weeklyEarnings / weeklyGoal) * 100)) : 0;
  const [prevEarnings, setPrevEarnings] = useState(weeklyEarnings);
  const [jumpKey, setJumpKey] = useState(0);

  useEffect(() => {
    if (weeklyEarnings !== prevEarnings) {
      setJumpKey((k) => k + 1);
      setPrevEarnings(weeklyEarnings);
    }
  }, [weeklyEarnings, prevEarnings]);

  return (
    <div className="rounded-2xl bg-[#121212] border border-[#1E1E1E] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">
          💰 Money Pulse
        </p>
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="text-[11px] text-[#2196F3] font-semibold flex items-center gap-1"
        >
          {showDetail ? 'Скрыть' : 'Детали'}
          {showDetail ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span
          key={jumpKey}
          className={`text-3xl font-black text-[#4CAF50] ${jumpKey > 0 ? 'animate-number-jump' : ''}`}
        >
          {Math.round(weeklyEarnings).toLocaleString('ru-RU')}
        </span>
        <span className="text-base font-bold text-gray-400">
          / {weeklyGoal.toLocaleString('ru-RU')} AED
        </span>
        <span className="ml-auto text-sm font-bold text-[#4CAF50]">{progressPct}%</span>
      </div>

      <ProgressBar value={weeklyEarnings} max={weeklyGoal} forecast={pendingProfit} />

      {showDetail && (
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="rounded-xl bg-[#1A1A1A] p-2.5 text-center">
            <p className="text-lg font-black text-[#4CAF50]">
              +{Math.round(pendingProfit).toLocaleString('ru-RU')}
            </p>
            <p className="text-[10px] text-gray-500 font-semibold mt-0.5">В пути</p>
          </div>
          <div className="rounded-xl bg-[#1A1A1A] p-2.5 text-center">
            <p className="text-lg font-black text-white">{activeTasks}</p>
            <p className="text-[10px] text-gray-500 font-semibold mt-0.5">Задач</p>
          </div>
          <div className="rounded-xl bg-[#1A1A1A] p-2.5 text-center">
            <p className="text-lg font-black text-[#2196F3]">{leadCount}</p>
            <p className="text-[10px] text-gray-500 font-semibold mt-0.5">Лидов</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-sm text-gray-300">
          Сегодня:{' '}
          <span className="font-bold text-white">{activeTasks} задач</span>
          {', выполнено '}
          <span className="font-bold text-[#4CAF50]">{completedTodayCount}</span>
        </p>
        <button
          type="button"
          onClick={onStartRoute}
          className="shrink-0 w-10 h-10 rounded-full bg-[#F44336] flex items-center justify-center shadow-lg active:scale-90 transition-transform"
          aria-label="Старт"
        >
          <Play size={16} className="text-white ml-0.5" />
        </button>
      </div>
    </div>
  );
};

/* ─────────────────── Widget: Smart Route ─────────────────── */

const SmartRouteWidget: React.FC<{
  routeZones: RouteZone[];
  checkedTasks: Set<string>;
  onCheckTask: (orderId: string) => void;
  onOpenOrder: (orderId: string) => void;
  onStartRoute: (area: string) => void;
  onGoToOrders: () => void;
}> = ({
  routeZones,
  checkedTasks,
  onCheckTask,
  onOpenOrder,
  onStartRoute,
  onGoToOrders,
}) => (
  <div className="rounded-2xl bg-[#121212] border border-[#1E1E1E] p-4 space-y-3">
    <div className="flex items-center gap-2">
      <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 flex-1">
        🗺️ Smart Route
      </p>
      <span className="text-xs font-semibold text-gray-400">
        {routeZones.reduce((s, z) => s + z.tasks.length, 0)} задач
      </span>
    </div>

    {routeZones.length === 0 ? (
      <div className="py-6 flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-gray-400">
          На сегодня задач нет. Можно добавить новые заявки.
        </p>
        <button
          type="button"
          onClick={onGoToOrders}
          className="px-4 py-2 rounded-xl bg-[#2196F3]/20 border border-[#2196F3]/40 text-[#2196F3] text-sm font-semibold"
        >
          Перейти к заявкам
        </button>
      </div>
    ) : (
      <div className="space-y-2">
        {routeZones.map((zone, index) => (
          <ZoneSection
            key={zone.area}
            zone={zone}
            index={index}
            checkedTasks={checkedTasks}
            onCheckTask={onCheckTask}
            onOpenOrder={onOpenOrder}
            onStartRoute={onStartRoute}
          />
        ))}
      </div>
    )}
  </div>
);

/* ─────────────────── Widget: VIP Focus ─────────────────── */

const VipFocusWidget: React.FC<{
  urgentOrders: Order[];
  onOpenOrder: (id: string) => void;
}> = ({ urgentOrders, onOpenOrder }) => {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? urgentOrders : urgentOrders.slice(0, 3);

  return (
    <div className="rounded-2xl bg-[#121212] border border-[#1E1E1E] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-[#F44336] flex-1">
          🚨 VIP Focus
        </p>
        <span className="text-xs font-semibold text-gray-400">
          {urgentOrders.length} горячих
        </span>
      </div>

      {urgentOrders.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">Всё спокойно 👌</p>
      ) : (
        <>
          <div className="space-y-2">
            {displayed.map((order) => (
              <UrgentCard
                key={order.id}
                order={order}
                onClick={() => onOpenOrder(order.id)}
              />
            ))}
          </div>
          {urgentOrders.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs text-[#2196F3] font-semibold flex items-center gap-1"
            >
              {showAll ? 'Скрыть' : `Ещё ${urgentOrders.length - 3}`}
              {showAll ? <ChevronUp size={12} /> : <ChevronRight size={12} />}
            </button>
          )}
        </>
      )}
    </div>
  );
};

/* ─────────────────── Widget: Inbox Cleanup ─────────────────── */

const InboxCleanupWidget: React.FC<{
  waitingOrders: Order[];
  leadOrders: Order[];
  onRemind: (order: Order) => void;
  onPingAll: () => void;
  onGoToOrders: () => void;
}> = ({ waitingOrders, leadOrders, onRemind, onPingAll, onGoToOrders }) => {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? waitingOrders : waitingOrders.slice(0, 3);

  return (
    <div className="rounded-2xl bg-[#121212] border border-[#1E1E1E] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 flex-1">
          📥 Inbox Cleanup
        </p>
        {waitingOrders.length > 0 && (
          <button
            type="button"
            onClick={onPingAll}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#25D366]/15 border border-[#25D366]/30 text-[#25D366] text-[11px] font-bold"
          >
            <MessageCircle size={12} />
            Пинг всем
          </button>
        )}
      </div>

      {waitingOrders.length === 0 && leadOrders.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">Входящих нет ✅</p>
      ) : (
        <>
          {waitingOrders.length > 0 && (
            <div className="space-y-2">
              {displayed.map((order) => (
                <WaitingCard
                  key={order.id}
                  order={order}
                  onRemind={() => onRemind(order)}
                />
              ))}
              {waitingOrders.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="text-xs text-[#2196F3] font-semibold flex items-center gap-1"
                >
                  {showAll ? 'Скрыть' : `Ещё ${waitingOrders.length - 3}`}
                  {showAll ? <ChevronUp size={12} /> : <ChevronRight size={12} />}
                </button>
              )}
            </div>
          )}

          {leadOrders.length > 0 && (
            <button
              type="button"
              onClick={onGoToOrders}
              className="w-full rounded-xl bg-[#1A1A1A] border border-[#2196F3]/30 p-3 flex items-center gap-3 active:scale-[0.98] transition-transform"
            >
              <span className="text-xl">✉️</span>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold text-white">
                  {pluralLead(leadOrders.length)} новых
                </p>
                <p className="text-xs text-gray-400">Требуют проверки</p>
              </div>
              <ChevronRight size={18} className="text-[#2196F3]" />
            </button>
          )}
        </>
      )}
    </div>
  );
};

/* ─────────────────── Main screen ─────────────────── */

const LONG_PRESS_MS = 600;

const TodayScreen: React.FC = () => {
  const navigate = useNavigate();
  const { openMenu } = useDrawer();
  const { orders } = useStore();
  const [settings, setSettings] = useState(() => loadAppSettings());
  const [checkedTasks, setCheckedTasks] = useState<Set<string>>(loadChecked);
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const snackbarTimerRef = useRef<number | null>(null);
  const [widgets, setWidgets] = useState<WidgetConfig[]>(loadDashboardWidgets);
  const [editMode, setEditMode] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const onFocus = () => setSettings(loadAppSettings());
    window.addEventListener('focus', onFocus);
    window.addEventListener('app-settings-updated', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('app-settings-updated', onFocus);
    };
  }, []);

  /* ── derived data ── */

  const activeOrders = useMemo(
    () => orders.filter((o) => !o.isArchived && !o.isSold && !o.isLead),
    [orders],
  );

  const weeklyEarnings = useMemo(() => computeWeeklyEarnings(orders), [orders]);
  const pendingProfit = useMemo(() => computePendingProfit(orders), [orders]);

  const activeTasks = useMemo(
    () => activeOrders.filter((o) => o.salesStatus !== 'Completed').length,
    [activeOrders],
  );

  const completedTodayCount = useMemo(() => {
    const todayStart = startOfToday();
    return (
      orders.filter(
        (o) =>
          o.salesStatus === 'Completed' &&
          Number(o.statusChangedAt || o.updatedAt || 0) >= todayStart,
      ).length + checkedTasks.size
    );
  }, [orders, checkedTasks]);

  const urgentOrders = useMemo(() => {
    return activeOrders.filter((o) => {
      if (o.salesStatus === 'Completed') return false;
      if (o.isVip || o.priority === Priority.HIGH) return true;
      if (o.salesStatus === 'Price Sent') {
        const elapsed = Date.now() - Number(o.statusChangedAt || o.createdAt);
        return elapsed > 2 * MS_HOUR;
      }
      return false;
    });
  }, [activeOrders]);

  const routeOrders = useMemo(
    () =>
      activeOrders.filter(
        (o) =>
          o.salesStatus !== 'Completed' &&
          needsPhysicalVisit(o) &&
          !checkedTasks.has(o.id),
      ),
    [activeOrders, checkedTasks],
  );

  const routeZones = useMemo((): RouteZone[] => {
    const byArea = new Map<string, Order[]>();
    routeOrders.forEach((o) => {
      const area = getOrderArea(o);
      if (area === 'Online') return;
      const arr = byArea.get(area) || [];
      arr.push(o);
      byArea.set(area, arr);
    });
    return Array.from(byArea.entries())
      .map(([area, tasks]) => ({ area, tasks }))
      .sort((a, b) => b.tasks.length - a.tasks.length);
  }, [routeOrders]);

  const waitingOrders = useMemo(
    () =>
      activeOrders.filter((o) => {
        if (o.salesStatus !== 'Price Sent' && o.salesStatus !== 'Pending Approval')
          return false;
        const elapsed = Date.now() - Number(o.statusChangedAt || o.createdAt);
        return elapsed > MS_DAY;
      }),
    [activeOrders],
  );

  const leadOrders = useMemo(
    () => orders.filter((o) => o.isLead && !o.isArchived),
    [orders],
  );

  const userName = settings.publicManagerName || settings.userName || 'Руслан';
  const weeklyGoal = settings.weeklyGoalAed || 2000;

  /* ── widget interactions ── */

  const handleToggleWidget = useCallback(
    (id: WidgetId) => {
      const next = toggleWidgetVisibility(widgets, id);
      setWidgets(next);
      saveDashboardWidgets(next);
      vibrate(30);
    },
    [widgets],
  );

  /* ── drag & drop ── */

  const handleDragStart = (index: number) => {
    setDragIndex(index);
    vibrate(20);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const next = reorderWidgets(widgets, dragIndex, index);
    setDragIndex(index);
    setWidgets(next);
    saveDashboardWidgets(next);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  /* ── long-press ── */

  const handleWidgetPressStart = () => {
    if (longPressTimerRef.current !== null) return;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      setEditMode(true);
      vibrate([30, 30, 80]);
    }, LONG_PRESS_MS);
  };

  const handleWidgetPressEnd = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  /* ── task check ── */

  const handleCheckTask = useCallback(
    (orderId: string) => {
      const next = new Set(checkedTasks);
      if (next.has(orderId)) {
        next.delete(orderId);
        saveChecked(next);
        setCheckedTasks(next);
        return;
      }
      next.add(orderId);
      saveChecked(next);
      setCheckedTasks(next);
      vibrate([30, 30]);
      if (snackbarTimerRef.current !== null) window.clearTimeout(snackbarTimerRef.current);
      setSnackbar({ orderId, message: 'Задача выполнена' });
      snackbarTimerRef.current = window.setTimeout(() => setSnackbar(null), 5000);
    },
    [checkedTasks],
  );

  const handleUndoCheck = useCallback(() => {
    if (!snackbar) return;
    const next = new Set(checkedTasks);
    next.delete(snackbar.orderId);
    saveChecked(next);
    setCheckedTasks(next);
    setSnackbar(null);
    if (snackbarTimerRef.current !== null) window.clearTimeout(snackbarTimerRef.current);
  }, [snackbar, checkedTasks]);

  const handleRemind = useCallback((order: Order) => {
    const part = order.parts[0];
    const partName = part?.name || 'деталь';
    const phone = order.contactLinks?.phone || order.customerContact || '';
    const msg = encodeURIComponent(
      `Здравствуйте! Напоминаю о вашем запросе на ${partName} (${order.brand} ${order.model}). Жду обратной связи.`,
    );
    const url = phone
      ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${msg}`
      : `https://wa.me/?text=${msg}`;
    window.open(url, '_blank');
    vibrate([30, 50]);
    toast(`Напоминание отправлено для ${order.brand} ${order.model}`, 'success');
  }, []);

  const handlePingAll = useCallback(() => {
    if (waitingOrders.length === 0) return;
    const count = waitingOrders.length;
    const msg = encodeURIComponent(
      'Здравствуйте! Напоминаю о вашем запросе на запчасти. Жду обратной связи.',
    );
    const first = waitingOrders[0];
    const phone = first.contactLinks?.phone || first.customerContact || '';
    const url = phone
      ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${msg}`
      : `https://wa.me/?text=${msg}`;
    window.open(url, '_blank');
    vibrate([30, 30, 80]);
    toast(`Пинг отправлен ${count} клиентам`, 'success');
  }, [waitingOrders]);

  const handleStartRoute = useCallback((area: string) => {
    toast(`Маршрут по ${area} начат`, 'info');
    vibrate(20);
  }, []);

  const handlePullRefresh = () => {
    toast('Данные обновлены', 'success');
  };

  /* ── render widget ── */

  const renderWidget = (widget: WidgetConfig, index: number) => {
    if (!widget.visible) return null;

    const shakeClass = editMode ? 'animate-widget-shake' : '';
    const dragClass = dragIndex === index ? 'opacity-50 scale-[0.97]' : '';

    const wrapperAttrs = {
      key: widget.id,
      draggable: editMode,
      onDragStart: editMode ? () => handleDragStart(index) : undefined,
      onDragOver: editMode ? (e: React.DragEvent) => handleDragOver(e, index) : undefined,
      onDragEnd: editMode ? handleDragEnd : undefined,
      onMouseDown: handleWidgetPressStart,
      onMouseUp: handleWidgetPressEnd,
      onTouchStart: handleWidgetPressStart,
      onTouchEnd: handleWidgetPressEnd,
      className: `transition-all duration-200 ${shakeClass} ${dragClass} ${editMode ? 'cursor-grab' : ''}`,
    };

    let content: React.ReactNode;
    switch (widget.id) {
      case 'money_pulse':
        content = (
          <MoneyPulseWidget
            weeklyEarnings={weeklyEarnings}
            weeklyGoal={weeklyGoal}
            pendingProfit={pendingProfit}
            activeTasks={activeTasks}
            completedTodayCount={completedTodayCount}
            leadCount={leadOrders.length}
            onStartRoute={() => {
              const firstZone = routeZones[0];
              if (firstZone) toast(`Маршрут по ${firstZone.area} начат`, 'info');
              else navigate('/orders');
            }}
          />
        );
        break;
      case 'smart_route':
        content = (
          <SmartRouteWidget
            routeZones={routeZones}
            checkedTasks={checkedTasks}
            onCheckTask={handleCheckTask}
            onOpenOrder={(id) => navigate(`/order/${id}`)}
            onStartRoute={handleStartRoute}
            onGoToOrders={() => navigate('/orders')}
          />
        );
        break;
      case 'vip_focus':
        content = (
          <VipFocusWidget
            urgentOrders={urgentOrders}
            onOpenOrder={(id) => navigate(`/order/${id}`)}
          />
        );
        break;
      case 'inbox_cleanup':
        content = (
          <InboxCleanupWidget
            waitingOrders={waitingOrders}
            leadOrders={leadOrders}
            onRemind={handleRemind}
            onPingAll={handlePingAll}
            onGoToOrders={() => navigate('/orders')}
          />
        );
        break;
      default:
        return null;
    }

    return (
      <div {...wrapperAttrs}>
        {content}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[#000000] text-white overflow-hidden">
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-6 space-y-4">

          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-[22px] font-black leading-tight">
                Привет, {userName}! 👋
              </h1>
              <p className="text-sm text-gray-400 mt-0.5 capitalize">{formatCurrentDate()}</p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                aria-label="Настроить виджеты"
                onClick={() => {
                  setEditMode(true);
                  vibrate([30, 30, 80]);
                }}
                className="w-9 h-9 rounded-xl bg-[#1E1E1E] flex items-center justify-center text-gray-400 active:bg-[#2A2A2A]"
              >
                <Settings2 size={16} />
              </button>
              <button
                type="button"
                aria-label="Обновить"
                onClick={handlePullRefresh}
                className="w-9 h-9 rounded-xl bg-[#1E1E1E] flex items-center justify-center text-gray-400 active:bg-[#2A2A2A]"
              >
                <RefreshCw size={16} />
              </button>
              <button
                type="button"
                aria-label="Открыть меню"
                onClick={openMenu}
                className="w-9 h-9 rounded-xl bg-[#1E1E1E] flex items-center justify-center text-gray-400 active:bg-[#2A2A2A]"
              >
                <Menu size={20} />
              </button>
            </div>
          </div>

          {/* Widgets */}
          {widgets.map((widget, index) => renderWidget(widget, index))}

        </div>
      </div>

      {/* Edit mode overlay */}
      {editMode && (
        <EditModeBar
          widgets={widgets}
          onToggle={handleToggleWidget}
          onClose={() => setEditMode(false)}
        />
      )}

      {/* Snackbar */}
      {snackbar && (
        <div className="fixed bottom-20 left-4 right-4 z-50 flex items-center gap-3 rounded-xl bg-[#333] px-4 py-3 shadow-2xl border border-[#444]">
          <span className="flex-1 text-sm font-semibold text-white">
            {snackbar.message}
          </span>
          <button
            type="button"
            onClick={handleUndoCheck}
            className="text-[#2196F3] text-sm font-bold"
          >
            Отмена
          </button>
        </div>
      )}
    </div>
  );
};

export default TodayScreen;
